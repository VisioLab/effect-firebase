/**
 * The In-memory Firestore: its documents held in a `SubscriptionRef`, and the
 * hooks {@link Firestore.make} builds the portable service from.
 *
 * Every write goes through {@link commit}, which applies a batch of writes as
 * one atomic change of the state, resolving their sentinels and bumping the
 * version of each path it touches. Listeners stream the state's changes, and
 * transactions check versions at commit.
 */
import {
  Array as Arr,
  Clock,
  Data,
  Effect,
  Equivalence,
  HashMap,
  Option,
  Order,
  Predicate,
  Random,
  Ref,
  Result,
  Stream,
  SubscriptionRef,
} from "effect";
import type * as Firestore from "../Firestore.ts";
import type * as FirestoreValue from "../FirestoreValue.ts";
import * as fieldValue from "./fieldValue.ts";
import { FirestoreError } from "./firestoreError.ts";
import * as firestoreValueWalk from "./firestoreValueWalk.ts";
import * as timestamp from "./timestamp.ts";

type DocumentData = Firestore.DocumentData;
type Value = FirestoreValue.FirestoreValue;

/**
 * The documents of one In-memory Firestore, keyed by full path, and how many
 * commits have written each path, deletes included, so a deleted document
 * never comes back at a version it had before. A path never written is at
 * version 0.
 *
 * @internal
 */
export interface State {
  readonly documents: HashMap.HashMap<string, DocumentData>;
  readonly versions: HashMap.HashMap<string, number>;
}

/** @internal */
export type Store = SubscriptionRef.SubscriptionRef<State>;

/** @internal */
export const makeStore: Effect.Effect<Store> = SubscriptionRef.make<State>({
  documents: HashMap.empty(),
  versions: HashMap.empty(),
});

const versionOf = (state: State, path: string): number =>
  Option.getOrElse(HashMap.get(state.versions, path), () => 0);

const dataAt = (state: State, path: string): DocumentData | undefined =>
  Option.getOrUndefined(HashMap.get(state.documents, path));

/**
 * One write of a commit. `Update` data is keyed by field path, segments joined
 * with `"."`.
 *
 * @internal
 */
export type Write = Data.TaggedEnum<{
  Set: { readonly path: string; readonly data: DocumentData };
  Update: { readonly path: string; readonly data: DocumentData };
  Delete: { readonly path: string };
}>;

const Write = Data.taggedEnum<Write>();

const isMap = (u: unknown): u is DocumentData => firestoreValueWalk.isMap(u);

const isSentinel = (u: unknown): boolean =>
  fieldValue.isServerTimestamp(u) ||
  fieldValue.isIncrement(u) ||
  fieldValue.isDeleteField(u) ||
  fieldValue.isArrayUnion(u) ||
  fieldValue.isArrayRemove(u);

/** Whether `value` holds a sentinel anywhere inside it. */
const containsSentinel = (value: unknown): boolean =>
  isSentinel(value) ||
  (Array.isArray(value)
    ? value.some(containsSentinel)
    : isMap(value) && Object.values(value).some(containsSentinel));

/**
 * What `value` stores as, written over `before`, with every sentinel in it
 * resolved at `now`, or nothing when it deletes the field. A map replaces
 * what was there, so the sentinels inside it resolve over nothing.
 */
const resolve = (value: Value, before: Value | undefined, now: number): Option.Option<Value> => {
  if (fieldValue.isDeleteField(value)) return Option.none();
  if (fieldValue.isServerTimestamp(value)) return Option.some(timestamp.fromMillisUnsafe(now));
  if (fieldValue.isIncrement(value)) {
    return Option.some(typeof before === "number" ? before + value.by : value.by);
  }
  if (fieldValue.isArrayUnion(value)) {
    return Option.some(
      value.elements.reduce<ReadonlyArray<Value>>(
        (elements, element) =>
          elements.some((present) => firestoreValueWalk.equals(present, element))
            ? elements
            : [...elements, element],
        Array.isArray(before) ? before : [],
      ),
    );
  }
  if (fieldValue.isArrayRemove(value)) {
    return Option.some(
      Array.isArray(before)
        ? before.filter(
            (element) => !value.elements.some((gone) => firestoreValueWalk.equals(gone, element)),
          )
        : [],
    );
  }
  if (isMap(value)) return Option.some(resolveMap(value, now));
  return Option.some(value);
};

/** `map` with every sentinel inside it resolved over nothing. */
const resolveMap = (map: DocumentData, now: number): DocumentData =>
  Object.fromEntries(
    Object.entries(map).flatMap(([field, value]) =>
      Option.toArray(Option.map(resolve(value, undefined, now), (after) => [field, after])),
    ),
  );

/**
 * `data` with each value at a dotted field path written into it and its
 * sentinels resolved at `now`, creating maps along the way and replacing
 * whatever was there that isn't one. Deleting a field that isn't there
 * changes nothing.
 */
const applyUpdate = (data: DocumentData, update: DocumentData, now: number): DocumentData => {
  const setAt = (
    target: DocumentData,
    [field, ...rest]: ReadonlyArray<string>,
    value: Value,
  ): DocumentData => {
    if (field === undefined) return target;
    const { [field]: before, ...others } = target;
    if (rest.length === 0) {
      return Option.match(resolve(value, before, now), {
        onNone: () => others,
        onSome: (after) => ({ ...target, [field]: after }),
      });
    }
    if (!isMap(before) && fieldValue.isDeleteField(value)) return target;
    return { ...target, [field]: setAt(isMap(before) ? before : {}, rest, value) };
  };
  return Object.entries(update).reduce(
    (next, [fieldPath, value]) => setAt(next, fieldPath.split("."), value),
    data,
  );
};

/**
 * What the document `write` touches becomes, its sentinels resolved at `now`:
 * `undefined` when it is deleted, or the error that refuses the write.
 */
const written = (
  state: State,
  write: Write,
  now: number,
): Result.Result<DocumentData | undefined, FirestoreError> =>
  Write.$match(write, {
    Set: ({ data }) => Result.succeed(resolveMap(data, now)),
    Update: ({ path, data }) =>
      Option.match(HashMap.get(state.documents, path), {
        onNone: () =>
          Result.fail(
            new FirestoreError({
              message: `Failed to update the document "${path}"`,
              code: "not-found",
              cause: new Error(`No document to update: ${path}`),
            }),
          ),
        onSome: (before) => Result.succeed(applyUpdate(before, data, now)),
      }),
    Delete: () => Result.succeed(undefined),
  });

/**
 * `state` with every write of the batch applied in order, its sentinels
 * resolved at `now`, and the version of each path written bumped, or the
 * error that refuses the whole batch.
 */
const stage = (
  state: State,
  writes: ReadonlyArray<Write>,
  now: number,
): Result.Result<State, FirestoreError> =>
  writes.reduce<Result.Result<State, FirestoreError>>(
    (staged, write) =>
      Result.flatMap(staged, (state) =>
        Result.map(written(state, write, now), (data) => ({
          documents:
            data === undefined
              ? HashMap.remove(state.documents, write.path)
              : HashMap.set(state.documents, write.path, data),
          versions: HashMap.set(state.versions, write.path, versionOf(state, write.path) + 1),
        })),
      ),
    Result.succeed(state),
  );

/**
 * Applies `writes` as one commit: all of them or, when one is refused, none.
 * Fails with what `check` fails with, applying nothing, when the state no
 * longer holds what the commit counted on.
 *
 * **Details**
 *
 * The check and the writes are one `SubscriptionRef.modifySome`, so no other
 * fiber commits in between, and listeners see the commit as one change, or
 * none when it is refused. `Clock` is read before, so every `serverTimestamp`
 * of a commit resolves to the same time.
 *
 * @internal
 */
export const commit = <E = never>(
  store: Store,
  writes: ReadonlyArray<Write>,
  check: (state: State) => Result.Result<void, E> = () => Result.void,
): Effect.Effect<void, FirestoreError | E> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      SubscriptionRef.modifySome(store, (state) => {
        const next = Result.flatMap(check(state), () => stage(state, writes, now));
        return [next, Result.getSuccess(next)] as const;
      }),
    ),
    Effect.flatMap(Effect.fromResult),
    Effect.asVoid,
  );

/** How many times a transaction runs its body when the caller doesn't say, as on the SDKs. */
const defaultMaxAttempts = 5;

/**
 * Stands in for the round trip of a read to a server: other fibers run in the
 * meantime, so transactions running at the same time interleave and can
 * conflict.
 */
const roundTrip = Effect.yieldNow;

const ConflictTag = "@visiolab/effect-firebase/firestore/memory/Conflict";

/** A document a transaction read changed before the transaction committed. */
class Conflict extends Data.TaggedError(ConflictTag) {}

/** Fails with a {@link Conflict} when a path in `reads` is no longer at the version recorded for it. */
const unchangedSince =
  (reads: HashMap.HashMap<string, number>) =>
  (state: State): Result.Result<void, Conflict> =>
    HashMap.some(reads, (version, path) => versionOf(state, path) !== version)
      ? Result.fail(new Conflict())
      : Result.void;

const readAfterWrite = (path: string) =>
  new FirestoreError({
    message: `Failed to read the document "${path}"`,
    code: "invalid-argument",
    cause: new Error("Firestore transactions require all reads to be executed before all writes."),
  });

/**
 * Runs `body` as an optimistic transaction over `store`, with no lock.
 *
 * **Details**
 *
 * Each attempt reads committed data, records the version of every document
 * it reads, missing ones included, and buffers its writes. A read after a
 * write fails as it does on the SDKs. When the body succeeds, it commits the
 * buffered writes, checking those versions. When one changed, the body runs
 * again, up to `maxAttempts` times, and then the transaction fails with
 * `code: "aborted"`. A body that fails or dies applies nothing and isn't
 * retried.
 */
const runTransaction = <A, E>(
  store: Store,
  body: (operations: Firestore.TransactionOperations) => Effect.Effect<A, E>,
  maxAttempts: number,
): Effect.Effect<A, E | FirestoreError> =>
  Effect.gen(function* () {
    const reads = yield* Ref.make(HashMap.empty<string, number>());
    const writes = yield* Ref.make<ReadonlyArray<Write>>([]);
    const buffer = (write: Write) => Ref.update(writes, (buffered) => [...buffered, write]);
    const a = yield* body({
      getDoc: (path) =>
        Effect.gen(function* () {
          if ((yield* Ref.get(writes)).length > 0) return yield* readAfterWrite(path);
          const state = yield* SubscriptionRef.get(store);
          yield* Ref.update(reads, (recorded) =>
            HashMap.has(recorded, path)
              ? recorded
              : HashMap.set(recorded, path, versionOf(state, path)),
          );
          yield* roundTrip;
          return { data: dataAt(state, path) };
        }),
      setDoc: (path, data) => buffer(Write.Set({ path, data })),
      updateDoc: (path, data) => buffer(Write.Update({ path, data })),
      deleteDoc: (path) => buffer(Write.Delete({ path })),
    });
    yield* commit(store, yield* Ref.get(writes), unchangedSince(yield* Ref.get(reads)));
    return a;
  }).pipe(
    Effect.retry({ while: Predicate.isTagged(ConflictTag), times: maxAttempts - 1 }),
    Effect.catchTag(ConflictTag, () =>
      Effect.fail(
        new FirestoreError({
          message: "Failed to run a transaction",
          code: "aborted",
          cause: new Error(
            `The documents the transaction read changed before it committed, ${maxAttempts} times`,
          ),
        }),
      ),
    ),
  );

/** The characters of an id Firestore picks: letters and digits. */
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A new 20-character document id, drawn from `Random`. */
const newId: Effect.Effect<string> = Effect.map(
  Effect.replicateEffect(Random.nextIntBetween(0, alphabet.length, { halfOpen: true }), 20),
  (indexes) => indexes.map((i) => alphabet[i]).join(""),
);

/**
 * Orders documents by path, segment by segment, as Firestore orders the
 * results of a query with no order of its own.
 */
const byPath: Order.Order<Firestore.QueryDocumentRead> = Order.mapInput(
  Order.Array(Order.String),
  (doc) => doc.path.split("/"),
);

/**
 * Whether the document at `path` is one `selector` covers.
 *
 * **Details**
 *
 * A collection covers the documents directly in it, not those in its
 * subcollections. A collection group covers the documents of every
 * collection whose last segment is its id, under any parent document.
 * Matching each one to a collection the group defines is left to
 * {@link Firestore.make}, which fails on one it doesn't.
 */
const covers = (selector: Firestore.CollectionSelector, path: string): boolean => {
  if (selector._tag === "CollectionGroup") return path.split("/").at(-2) === selector.id;
  const prefix = `${selector.path}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
};

/** The documents `selector` covers, in the order of their paths. */
const docsOf = (state: State, selector: Firestore.CollectionSelector): Firestore.QueryRead => ({
  docs: state.documents.pipe(
    HashMap.filter((_, path) => covers(selector, path)),
    HashMap.map((data, path) => ({ path, data })),
    HashMap.toValues,
    Arr.sort(byPath),
  ),
});

const docOf = (state: State, path: string): Firestore.DocumentRead => ({
  data: dataAt(state, path),
});

const sameData: Equivalence.Equivalence<DocumentData | undefined> = Equivalence.make(
  firestoreValueWalk.equals,
);

const sameDoc: Equivalence.Equivalence<Firestore.DocumentRead> = Equivalence.mapInput(
  sameData,
  (read) => read.data,
);

const sameDocs: Equivalence.Equivalence<Firestore.QueryRead> = Equivalence.mapInput(
  Equivalence.Array(Equivalence.Struct({ path: Equivalence.String, data: sameData })),
  (read) => read.docs,
);

/**
 * A live listener on what `select` picks from the state: it emits that when
 * it starts, and again after each commit that changes it, by `same`. It never
 * completes on its own, and interrupting it unsubscribes. A reader that falls
 * behind only sees the latest state, as {@link Firestore.MakeOptions} asks.
 */
const listen = <A>(
  store: Store,
  select: (state: State) => A,
  same: Equivalence.Equivalence<A>,
): Stream.Stream<A> =>
  SubscriptionRef.changes(store).pipe(
    Stream.buffer({ capacity: 1, strategy: "sliding" }),
    Stream.map(select),
    Stream.changesWith(same),
  );

/**
 * The hooks of the In-memory Firestore over `store`.
 *
 * @internal
 */
export const hooks = (store: Store): Firestore.MakeOptions => {
  const read = <A>(select: (state: State) => A) => Effect.map(SubscriptionRef.get(store), select);
  return {
    getDoc: (path) => read((state) => docOf(state, path)),
    getDocs: (selector) => read((state) => docsOf(state, selector)),
    setDoc: (path, data) => commit(store, [Write.Set({ path, data })]),
    updateDoc: (path, data) => commit(store, [Write.Update({ path, data })]),
    deleteDoc: (path) => commit(store, [Write.Delete({ path })]),
    addDoc: (path, data) =>
      Effect.tap(newId, (id) => commit(store, [Write.Set({ path: `${path}/${id}`, data })])),
    streamDoc: (path) => listen(store, (state) => docOf(state, path), sameDoc),
    streamDocs: (selector) => listen(store, (state) => docsOf(state, selector), sameDocs),
    runTransaction: {
      run: (body, { maxAttempts = defaultMaxAttempts }) => runTransaction(store, body, maxAttempts),
    },
  };
};

/**
 * The {@link Firestore.MemoryDriver} over `store`.
 *
 * @internal
 */
export const driver = (store: Store): Firestore.MemoryDriver => ({
  get: (path) =>
    Effect.map(SubscriptionRef.get(store), (state) => HashMap.get(state.documents, path)),
  set: (path, data) =>
    Effect.gen(function* () {
      // Sentinels are Firestore Values, so `isFirestoreValue` alone lets them through.
      if (containsSentinel(data)) {
        return yield* Effect.die(
          new Error(`MemoryDriver.set stores raw data, so it takes no sentinel, as at "${path}"`),
        );
      }
      if (!firestoreValueWalk.isFirestoreValue(data)) {
        return yield* Effect.die(
          new Error(`MemoryDriver.set takes Firestore Values, as at "${path}"`),
        );
      }
      yield* Effect.orDie(commit(store, [Write.Set({ path, data })]));
    }),
  delete: (path) => Effect.orDie(commit(store, [Write.Delete({ path })])),
  documents: Effect.map(SubscriptionRef.get(store), (state) => state.documents),
});

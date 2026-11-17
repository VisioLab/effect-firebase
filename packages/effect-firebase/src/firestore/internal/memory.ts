/**
 * The In-memory Firestore: a store of documents in the running process, and
 * the hooks {@link Firestore.make} builds the portable service from.
 *
 * Every write goes through {@link commit}, which applies a batch of writes at
 * once, resolving their sentinels, bumps the version of each path it touches
 * and wakes the listeners. Listeners and transactions build on it.
 */
import { Clock, Effect, Random, Result, Stream } from "effect";
import type * as Firestore from "../Firestore.ts";
import * as fieldValue from "./fieldValue.ts";
import { FirestoreError } from "./firestoreError.ts";
import * as firestoreValueWalk from "./firestoreValueWalk.ts";
import { streamFromListener } from "./streamFromListener.ts";
import * as timestamp from "./timestamp.ts";

type DocumentData = Firestore.DocumentData;

/**
 * The documents of one In-memory Firestore, keyed by full path.
 *
 * @internal
 */
export interface Store {
  readonly documents: Map<string, DocumentData>;
  /**
   * How many commits have written each path, deletes included, so a deleted
   * document never comes back at a version it had before. A path never
   * written is at version 0.
   */
  readonly versions: Map<string, number>;
  /** Called after each commit, with nothing: each listener reads what it covers. */
  readonly listeners: Set<() => void>;
}

/** @internal */
export const makeStore = (): Store => ({
  documents: new Map(),
  versions: new Map(),
  listeners: new Set(),
});

/**
 * The version of the document at `path`, which every commit that writes it
 * bumps.
 *
 * @internal
 */
export const versionOf = (store: Store, path: string): number => store.versions.get(path) ?? 0;

/**
 * One write of a commit. `Update` data is keyed by field path, segments joined
 * with `"."`.
 *
 * @internal
 */
export type Write =
  | { readonly _tag: "Set"; readonly path: string; readonly data: DocumentData }
  | { readonly _tag: "Update"; readonly path: string; readonly data: DocumentData }
  | { readonly _tag: "Delete"; readonly path: string };

/** A plain object whose keys are fields: a Firestore map. */
const isMap = (u: unknown): u is { readonly [field: string]: unknown } => {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return false;
  const proto = Object.getPrototypeOf(u);
  return proto === Object.prototype || proto === null;
};

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

/** What a `deleteField` resolves to: the field goes away. */
const removed: unique symbol = Symbol("removed");

/**
 * What `value` stores as, written over `before`, with every sentinel in it
 * resolved at `now`. A map replaces what was there, so the sentinels inside
 * it resolve over nothing.
 */
const resolve = (value: unknown, before: unknown, now: number): unknown => {
  if (fieldValue.isServerTimestamp(value)) return timestamp.fromMillisUnsafe(now);
  if (fieldValue.isIncrement(value)) {
    return typeof before === "number" ? before + value.by : value.by;
  }
  if (fieldValue.isArrayUnion(value)) {
    return value.elements.reduce<ReadonlyArray<unknown>>(
      (elements, element) =>
        elements.some((present) => firestoreValueWalk.equals(present, element))
          ? elements
          : [...elements, element],
      Array.isArray(before) ? before : [],
    );
  }
  if (fieldValue.isArrayRemove(value)) {
    return Array.isArray(before)
      ? before.filter(
          (element) => !value.elements.some((gone) => firestoreValueWalk.equals(gone, element)),
        )
      : [];
  }
  if (fieldValue.isDeleteField(value)) return removed;
  if (isMap(value)) return resolveMap(value, now);
  return value;
};

/** `map` with every sentinel inside it resolved over nothing. */
const resolveMap = (
  map: { readonly [field: string]: unknown },
  now: number,
): { readonly [field: string]: unknown } =>
  Object.fromEntries(
    Object.entries(map)
      .map(([field, value]) => [field, resolve(value, undefined, now)] as const)
      .filter(([, value]) => value !== removed),
  );

/**
 * `data` with each value at a dotted field path written into it and its
 * sentinels resolved at `now`, creating maps along the way and replacing
 * whatever was there that isn't one. Deleting a field that isn't there
 * changes nothing.
 */
const applyUpdate = (data: DocumentData, update: DocumentData, now: number): DocumentData => {
  const setAt = (
    target: { readonly [field: string]: unknown },
    [field, ...rest]: ReadonlyArray<string>,
    value: unknown,
  ): { readonly [field: string]: unknown } => {
    if (field === undefined) return target;
    if (rest.length === 0) {
      const { [field]: before, ...others } = target;
      const after = resolve(value, before, now);
      return after === removed ? others : { ...target, [field]: after };
    }
    const child = target[field];
    if (!isMap(child) && fieldValue.isDeleteField(value)) return target;
    return { ...target, [field]: setAt(isMap(child) ? child : {}, rest, value) };
  };
  return Object.entries(update).reduce(
    (next, [fieldPath, value]) => setAt(next, fieldPath.split("."), value),
    data as { readonly [field: string]: unknown },
  ) as DocumentData;
};

/**
 * What the document at each path written becomes, with every write of the
 * batch applied in order and its sentinels resolved at `now`, or the error
 * that refuses the whole batch.
 */
const stage = (
  store: Store,
  writes: ReadonlyArray<Write>,
  now: number,
): Map<string, DocumentData | undefined> | FirestoreError => {
  const staged = new Map<string, DocumentData | undefined>();
  const current = (path: string) =>
    staged.has(path) ? staged.get(path) : store.documents.get(path);
  for (const write of writes) {
    switch (write._tag) {
      case "Set":
        staged.set(write.path, resolveMap(write.data, now) as DocumentData);
        break;
      case "Update": {
        const before = current(write.path);
        if (before === undefined) {
          return new FirestoreError({
            message: `Failed to update the document "${write.path}"`,
            code: "not-found",
            cause: new Error(`No document to update: ${write.path}`),
          });
        }
        staged.set(write.path, applyUpdate(before, write.data, now));
        break;
      }
      case "Delete":
        staged.set(write.path, undefined);
        break;
    }
  }
  return staged;
};

/**
 * Applies `writes` as one commit: all of them or, when one is refused, none.
 * It bumps the version of every path written and then wakes every listener
 * once. Succeeds with `false`, applying nothing, when a path in `reads` is no
 * longer at the version recorded for it there.
 *
 * **Details**
 *
 * Checking `reads` and applying happen in one synchronous step, so no other
 * fiber sees half a commit, or commits in between. `Clock` is read before
 * that step, so every `serverTimestamp` of a commit resolves to the same
 * time.
 *
 * @internal
 */
export const commit = (
  store: Store,
  writes: ReadonlyArray<Write>,
  reads: ReadonlyMap<string, number> = new Map(),
): Effect.Effect<boolean, FirestoreError> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => {
    for (const [path, version] of reads) {
      if (versionOf(store, path) !== version) return Effect.succeed(false);
    }
    const staged = stage(store, writes, now);
    if (staged instanceof FirestoreError) return Effect.fail(staged);
    for (const [path, data] of staged) {
      if (data === undefined) store.documents.delete(path);
      else store.documents.set(path, data);
      store.versions.set(path, versionOf(store, path) + 1);
    }
    for (const listener of store.listeners) listener();
    return Effect.succeed(true);
  });

/** How many times a transaction runs its body when the caller doesn't say, as on the SDKs. */
const defaultMaxAttempts = 5;

/**
 * Runs `body` as an optimistic transaction over `store`, with no lock.
 *
 * **Details**
 *
 * Each attempt reads committed data, records the version of every document
 * it reads, missing ones included, and buffers its writes. A read after a
 * write fails as it does on the SDKs. When the body succeeds, {@link commit}
 * checks those versions and applies every buffered write at once. When one
 * changed, the body runs again, up to `maxAttempts` times, and then the
 * transaction fails with `code: "aborted"`. A body that fails or dies applies
 * nothing and isn't retried.
 *
 * A read yields to other fibers, as a read from a server would, so that
 * transactions running at the same time interleave and can conflict.
 */
const runTransaction = <A, E>(
  store: Store,
  body: (operations: Firestore.TransactionOperations) => Effect.Effect<A, E>,
  maxAttempts: number,
): Effect.Effect<A, E | FirestoreError> => {
  const attempt = (n: number): Effect.Effect<A, E | FirestoreError> =>
    Effect.suspend(() => {
      const reads = new Map<string, number>();
      const writes: Array<Write> = [];
      const buffer = (write: Write) =>
        Effect.sync(() => {
          writes.push(write);
        });
      const operations: Firestore.TransactionOperations = {
        getDoc: (path) =>
          writes.length > 0
            ? Effect.fail(
                new FirestoreError({
                  message: `Failed to read the document "${path}"`,
                  code: "invalid-argument",
                  cause: new Error(
                    "Firestore transactions require all reads to be executed before all writes.",
                  ),
                }),
              )
            : Effect.sync(() => {
                if (!reads.has(path)) reads.set(path, versionOf(store, path));
                return { data: store.documents.get(path) };
              }).pipe(Effect.tap(() => Effect.yieldNow)),
        setDoc: (path, data) => buffer({ _tag: "Set", path, data }),
        updateDoc: (path, data) => buffer({ _tag: "Update", path, data }),
        deleteDoc: (path) => buffer({ _tag: "Delete", path }),
      };
      return Effect.flatMap(body(operations), (a) =>
        Effect.flatMap(commit(store, writes, reads), (committed) =>
          committed
            ? Effect.succeed(a)
            : n < maxAttempts
              ? attempt(n + 1)
              : Effect.fail(
                  new FirestoreError({
                    message: "Failed to run a transaction",
                    code: "aborted",
                    cause: new Error(
                      `The documents the transaction read changed before it committed, ${n} times`,
                    ),
                  }),
                ),
        ),
      );
    });
  return attempt(1);
};

/** The characters of an id Firestore picks: letters and digits. */
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A new 20-character document id, drawn from `Random`. */
const newId: Effect.Effect<string> = Effect.map(
  Effect.forEach(Array.from({ length: 20 }), () =>
    Random.nextIntBetween(0, alphabet.length, { halfOpen: true }),
  ),
  (indexes) => indexes.map((i) => alphabet[i]).join(""),
);

/**
 * Orders documents by path, segment by segment, as Firestore orders the
 * results of a query with no order of its own.
 */
const byPath = (a: Firestore.QueryDocumentRead, b: Firestore.QueryDocumentRead): number => {
  const as = a.path.split("/");
  const bs = b.path.split("/");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] !== bs[i]) return as[i]! < bs[i]! ? -1 : 1;
  }
  return as.length - bs.length;
};

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
const docsOf = (
  store: Store,
  selector: Firestore.CollectionSelector,
): ReadonlyArray<Firestore.QueryDocumentRead> =>
  Array.from(store.documents)
    .filter(([doc]) => covers(selector, doc))
    .map(([doc, data]) => ({ path: doc, data }))
    .toSorted(byPath);

/**
 * A live listener on what `read` covers: it emits that state when it starts,
 * and again after each commit that changes it, by `same`.
 *
 * **Details**
 *
 * Each run registers a callback in `store.listeners`, which every commit calls
 * once after applying all of its writes, so a listener never sees half of
 * one. The callback reads the state again and emits it only when it isn't
 * `same` as the last one emitted. The stream never completes on its own, and
 * interrupting it removes the callback. A reader that falls behind only sees
 * the latest state, as with an SDK listener.
 */
const listen = <A>(
  store: Store,
  read: () => A,
  same: (self: A, that: A) => boolean,
): Stream.Stream<A, FirestoreError> =>
  streamFromListener<A, A>({
    subscribe: (onNext) => {
      let last = read();
      onNext(last);
      const listener = () => {
        const next = read();
        if (same(last, next)) return;
        last = next;
        onNext(next);
      };
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    // An In-memory listener has nothing that could fail it.
    onError: (cause) => new FirestoreError({ message: "Failed to listen", cause }),
    map: Result.succeed,
  });

/**
 * The hooks of the In-memory Firestore over `store`.
 *
 * @internal
 */
export const hooks = (store: Store): Firestore.MakeOptions => {
  const write = (...writes: ReadonlyArray<Write>) => Effect.asVoid(commit(store, writes));
  return {
    getDoc: (path) => Effect.sync(() => ({ data: store.documents.get(path) })),
    getDocs: (selector) => Effect.sync(() => ({ docs: docsOf(store, selector) })),
    setDoc: (path, data) => write({ _tag: "Set", path, data }),
    updateDoc: (path, data) => write({ _tag: "Update", path, data }),
    deleteDoc: (path) => write({ _tag: "Delete", path }),
    addDoc: (path, data) =>
      Effect.tap(newId, (id) => write({ _tag: "Set", path: `${path}/${id}`, data })),
    streamDoc: (path) =>
      listen(
        store,
        () => ({ data: store.documents.get(path) }),
        (a, b) => firestoreValueWalk.equals(a.data, b.data),
      ),
    streamDocs: (selector) =>
      listen(
        store,
        () => ({ docs: docsOf(store, selector) }),
        (a, b) =>
          a.docs.length === b.docs.length &&
          a.docs.every(
            (doc, i) =>
              doc.path === b.docs[i]!.path && firestoreValueWalk.equals(doc.data, b.docs[i]!.data),
          ),
      ),
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
  get: (path) => Effect.sync(() => store.documents.get(path)),
  set: (path, data) =>
    Effect.suspend(() =>
      // Sentinels are Firestore Values, so `isFirestoreValue` alone lets them through.
      containsSentinel(data)
        ? Effect.die(
            new Error(`MemoryDriver.set stores raw data, so it takes no sentinel, as at "${path}"`),
          )
        : !firestoreValueWalk.isFirestoreValue(data)
          ? Effect.die(new Error(`MemoryDriver.set takes Firestore Values, as at "${path}"`))
          : Effect.orDie(Effect.asVoid(commit(store, [{ _tag: "Set", path, data }]))),
    ),
  delete: (path) => Effect.orDie(Effect.asVoid(commit(store, [{ _tag: "Delete", path }]))),
  documents: Effect.sync((): ReadonlyMap<string, DocumentData> => new Map(store.documents)),
});

/**
 * The In-memory Firestore: a store of documents in the running process, and
 * the hooks {@link Firestore.make} builds the portable service from.
 *
 * Every write goes through {@link commit}, which applies a batch of writes at
 * once, resolving their sentinels, bumps the version of each path it touches
 * and wakes the listeners. Listeners and transactions build on it.
 */
import { Clock, Effect, Random, Stream } from "effect";
import type * as Firestore from "../Firestore.ts";
import * as fieldValue from "./fieldValue.ts";
import { FirestoreError } from "./firestoreError.ts";
import * as firestoreValueWalk from "./firestoreValueWalk.ts";
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

/**
 * The defect a part of the In-memory Firestore that isn't built yet dies with.
 *
 * @internal
 */
export const notYetSupported = (what: string): Error =>
  new Error(`${what} are not yet supported by the In-memory Firestore`);

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
 * once.
 *
 * **Details**
 *
 * Checking and applying happen in one synchronous step, so no other fiber
 * sees half a commit; a transaction's version check belongs in that step too.
 * `Clock` is read before that step, so every `serverTimestamp` of a commit
 * resolves to the same time.
 *
 * @internal
 */
export const commit = (
  store: Store,
  writes: ReadonlyArray<Write>,
): Effect.Effect<void, FirestoreError> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const staged = stage(store, writes, now);
    if (staged instanceof FirestoreError) return Effect.fail(staged);
    for (const [path, data] of staged) {
      if (data === undefined) store.documents.delete(path);
      else store.documents.set(path, data);
      store.versions.set(path, versionOf(store, path) + 1);
    }
    for (const listener of store.listeners) listener();
    return Effect.void;
  });

/** The characters of an id Firestore picks: letters and digits. */
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A new 20-character document id, drawn from `Random`. */
const newId: Effect.Effect<string> = Effect.map(
  Effect.forEach(Array.from({ length: 20 }), () =>
    Random.nextIntBetween(0, alphabet.length, { halfOpen: true }),
  ),
  (indexes) => indexes.map((i) => alphabet[i]).join(""),
);

/** The documents directly in the collection at `path`, not in its subcollections. */
const inCollection = (store: Store, path: string): ReadonlyArray<Firestore.QueryDocumentRead> => {
  const prefix = `${path}/`;
  return Array.from(store.documents)
    .filter(([doc]) => doc.startsWith(prefix) && !doc.slice(prefix.length).includes("/"))
    .map(([doc, data]) => ({ path: doc, data }));
};

/**
 * The documents of every collection whose last segment is `id`, under any
 * parent document. Matching each one to a collection the group defines is
 * left to {@link Firestore.make}, which fails on one it doesn't.
 */
const inCollectionGroup = (store: Store, id: string): ReadonlyArray<Firestore.QueryDocumentRead> =>
  Array.from(store.documents)
    .filter(([doc]) => doc.split("/").at(-2) === id)
    .map(([doc, data]) => ({ path: doc, data }));

/**
 * The hooks of the In-memory Firestore over `store`.
 *
 * @internal
 */
export const hooks = (store: Store): Firestore.MakeOptions => {
  const write = (...writes: ReadonlyArray<Write>) => commit(store, writes);
  return {
    getDoc: (path) => Effect.sync(() => ({ data: store.documents.get(path) })),
    getDocs: (selector) =>
      selector._tag === "Collection"
        ? Effect.sync(() => ({ docs: inCollection(store, selector.path) }))
        : Effect.sync(() => ({ docs: inCollectionGroup(store, selector.id) })),
    setDoc: (path, data) => write({ _tag: "Set", path, data }),
    updateDoc: (path, data) => write({ _tag: "Update", path, data }),
    deleteDoc: (path) => write({ _tag: "Delete", path }),
    addDoc: (path, data) =>
      Effect.tap(newId, (id) => write({ _tag: "Set", path: `${path}/${id}`, data })),
    streamDoc: () => Stream.die(notYetSupported("Listeners")),
    streamDocs: () => Stream.die(notYetSupported("Listeners")),
    runTransaction: { run: () => Effect.die(notYetSupported("Transactions")) },
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
      containsSentinel(data)
        ? Effect.die(
            new Error(`MemoryDriver.set stores raw data, so it takes no sentinel, as at "${path}"`),
          )
        : !firestoreValueWalk.isFirestoreValue(data)
          ? Effect.die(new Error(`MemoryDriver.set takes Firestore Values, as at "${path}"`))
          : Effect.orDie(commit(store, [{ _tag: "Set", path, data }])),
    ),
  delete: (path) => Effect.orDie(commit(store, [{ _tag: "Delete", path }])),
  documents: Effect.sync((): ReadonlyMap<string, DocumentData> => new Map(store.documents)),
});

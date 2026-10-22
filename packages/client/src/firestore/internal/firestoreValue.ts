import { Result } from "effect";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type { FirestoreValue } from "@visiolab/effect-firebase/firestore/FirestoreValue";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import * as Client from "firebase/firestore";

const isPlainObject = (u: object): u is Record<string, unknown> => {
  const proto = Object.getPrototypeOf(u);
  return proto === Object.prototype || proto === null;
};

const mapValues = (
  u: Record<string, unknown>,
  f: (value: unknown, key: string) => unknown,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(u)) out[key] = f(u[key], key);
  return out;
};

/** @internal */
export const toClient = (value: FirestoreValue, firestore: Client.Firestore): unknown => {
  const go = (u: unknown): unknown => {
    if (typeof u !== "object" || u === null) return u;
    // The client SDK refuses a raw `Uint8Array`, as a custom object.
    if (u instanceof Uint8Array) return Client.Bytes.fromUint8Array(u);
    if (Timestamp.isTimestamp(u)) return new Client.Timestamp(u.seconds, u.nanoseconds);
    if (GeoPoint.isGeoPoint(u)) return new Client.GeoPoint(u.latitude, u.longitude);
    if (Collection.isDocumentReference(u)) return Client.doc(firestore, u.path);
    if (FieldValue.isServerTimestamp(u)) return Client.serverTimestamp();
    if (FieldValue.isIncrement(u)) return Client.increment(u.by);
    if (FieldValue.isDeleteField(u)) return Client.deleteField();
    if (FieldValue.isArrayUnion(u)) return Client.arrayUnion(...u.elements.map(go));
    if (FieldValue.isArrayRemove(u)) return Client.arrayRemove(...u.elements.map(go));
    if (Array.isArray(u)) return u.map(go);
    if (isPlainObject(u)) return mapValues(u, go);
    // The client SDK's own values, which the `FirestoreSchema` codecs still
    // build through `FirestoreEncoder`, pass through untouched until they stop
    // doing so (#77).
    return u;
  };
  return go(value);
};

/**
 * The model behind the collections a reference read back is placed in. A
 * reference Firestore hands back names its path but not the collection it was
 * defined through, so it is placed in one that holds anything, and
 * `FirestoreSchema.DocumentReference(collection)` resolves it by its path.
 */
class Untyped extends FirestoreModel.Class<Untyped>("Untyped")({}) {}

/**
 * The collections references are read back into, one per path of collection
 * ids, so two references read to the same document are equal.
 */
const collections = new Map<string, Collection.Any>();

const collectionOf = (segments: ReadonlyArray<string>): Collection.Any => {
  const key = segments.join("/");
  let collection = collections.get(key);
  if (collection === undefined) {
    collection =
      segments.length === 1
        ? Collection.make(segments[0], Untyped)
        : collectionOf(segments.slice(0, -1)).subcollection(segments[segments.length - 1], Untyped);
    collections.set(key, collection);
  }
  return collection;
};

const referenceOf = (
  ref: Client.DocumentReference,
): Collection.DocumentReference<Collection.Any> => {
  const parts = ref.path.split("/");
  const segments = parts.filter((_, i) => i % 2 === 0);
  const ids = parts.filter((_, i) => i % 2 === 1);
  // The ids are typed per collection, which a collection built at runtime has
  // no types for.
  const collection: { doc(...ids: ReadonlyArray<string>): unknown } = collectionOf(segments);
  return collection.doc(...ids) as Collection.DocumentReference<Collection.Any>;
};

const describe = (u: object): string => u.constructor?.name ?? "an object with no prototype";

const formatPath = (path: ReadonlyArray<string | number>): string =>
  path.length === 0
    ? "the document"
    : `"${path
        .map((key, i) => (typeof key === "number" ? `[${key}]` : i === 0 ? key : `.${key}`))
        .join("")}"`;

/** @internal */
export const fromClient = (value: unknown): Result.Result<FirestoreValue, FirestoreError> => {
  const path: Array<string | number> = [];
  let failure: FirestoreError | undefined;
  const fail = (u: unknown, kind: string): undefined => {
    failure = new FirestoreError({
      message: `Firestore holds ${kind} at ${formatPath(path)}, which is not a Firestore Value`,
      code: undefined,
      cause: u,
    });
    return undefined;
  };
  const within = <A>(key: string | number, f: () => A): A => {
    path.push(key);
    try {
      return f();
    } finally {
      path.pop();
    }
  };
  const go = (u: unknown): unknown => {
    if (failure !== undefined) return undefined;
    switch (typeof u) {
      case "boolean":
      case "number":
      case "string":
        return u;
      case "object":
        break;
      default:
        return fail(u, `a value of type ${typeof u}`);
    }
    if (u === null) return u;
    if (u instanceof Client.Timestamp) return Timestamp.makeUnsafe(u.seconds, u.nanoseconds);
    if (u instanceof Client.GeoPoint) return GeoPoint.makeUnsafe(u.latitude, u.longitude);
    if (u instanceof Client.DocumentReference) return referenceOf(u);
    if (u instanceof Client.Bytes) return u.toUint8Array();
    if (Array.isArray(u)) return u.map((e, i) => within(i, () => go(e)));
    if (isPlainObject(u)) return mapValues(u, (v, key) => within(key, () => go(v)));
    return fail(u, `a ${describe(u)}`);
  };
  const out = go(value);
  return failure === undefined ? Result.succeed(out as FirestoreValue) : Result.fail(failure);
};

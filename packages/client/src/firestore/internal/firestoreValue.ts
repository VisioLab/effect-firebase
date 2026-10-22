import { Data, Result } from "effect";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type { FirestoreValue } from "@visiolab/effect-firebase/firestore/FirestoreValue";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import * as Client from "firebase/firestore";

/** @internal */
export class UnsupportedSdkValue extends Data.TaggedError("UnsupportedSdkValue")<{
  readonly path: ReadonlyArray<string | number>;
  readonly value: unknown;
}> {
  override get message(): string {
    const at = this.path.length === 0 ? "the document" : `"${this.path.join(".")}"`;
    return `Unsupported value at ${at}: ${describe(this.value)} is not a Firestore Value`;
  }
}

const describe = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (typeof value !== "object" || value === null) return typeof value;
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === "string" && name.length > 0 ? `a ${name}` : "an object";
};

const isPlainObject = (u: unknown): u is Record<string, unknown> => {
  if (typeof u !== "object" || u === null) return false;
  const proto = Object.getPrototypeOf(u);
  return proto === Object.prototype || proto === null;
};

/**
 * Values the encoder-backed `FirestoreSchema` codecs build: they are the
 * client SDK's own already, so they are written as they are.
 *
 * Temporary: it goes with the encoder (#77).
 */
const isSdkValue = (u: unknown): boolean =>
  u instanceof Client.Timestamp ||
  u instanceof Client.GeoPoint ||
  u instanceof Client.DocumentReference ||
  u instanceof Client.Bytes ||
  u instanceof Client.FieldValue;

/** @internal */
export const toSdkValue = (firestore: Client.Firestore, value: FirestoreValue): unknown => {
  const go = (u: unknown): unknown => {
    if (typeof u !== "object" || u === null) return u;
    if (u instanceof Uint8Array) return Client.Bytes.fromUint8Array(u);
    if (Timestamp.isTimestamp(u)) return new Client.Timestamp(u.seconds, u.nanoseconds);
    if (GeoPoint.isGeoPoint(u)) return new Client.GeoPoint(u.latitude, u.longitude);
    if (Collection.isDocumentReference(u)) return Client.doc(firestore, u.path);
    if (FieldValue.isServerTimestamp(u)) return Client.serverTimestamp();
    if (FieldValue.isIncrement(u)) return Client.increment(u.by);
    if (FieldValue.isDeleteField(u)) return Client.deleteField();
    if (FieldValue.isArrayUnion(u)) return Client.arrayUnion(...u.elements.map(go));
    if (FieldValue.isArrayRemove(u)) return Client.arrayRemove(...u.elements.map(go));
    if (isSdkValue(u)) return u;
    if (Array.isArray(u)) return u.map(go);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(u)) out[key] = go((u as Record<string, unknown>)[key]);
    return out;
  };
  return go(value);
};

/**
 * The model behind the collections a reference read back is built against. A
 * reference read from Firestore says nothing of the collection it was defined
 * through, only its path, so it is placed in a collection that holds anything.
 * `FirestoreSchema.DocumentReference(collection)` resolves it by its path.
 */
class Untyped extends FirestoreModel.Class<Untyped>("Untyped")({}) {}

/**
 * The collection definitions references are read back against, one per
 * path of collection ids, so two references read to the same document are
 * equal.
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
  return (
    collectionOf(segments).doc as (
      ...ids: Array<string>
    ) => Collection.DocumentReference<Collection.Any>
  )(...ids);
};

/** @internal */
export const fromSdkValue = (
  value: unknown,
): Result.Result<FirestoreValue, UnsupportedSdkValue> => {
  const path: Array<string | number> = [];
  const go = (u: unknown): FirestoreValue => {
    if (u === null || typeof u === "boolean" || typeof u === "number" || typeof u === "string") {
      return u;
    }
    if (u instanceof Client.Timestamp) return Timestamp.makeUnsafe(u.seconds, u.nanoseconds);
    if (u instanceof Client.GeoPoint) return GeoPoint.makeUnsafe(u.latitude, u.longitude);
    if (u instanceof Client.DocumentReference) return referenceOf(u);
    if (u instanceof Client.Bytes) return u.toUint8Array();
    if (Array.isArray(u)) {
      return u.map((item, i) => {
        path.push(i);
        const mapped = go(item);
        path.pop();
        return mapped;
      });
    }
    if (isPlainObject(u)) {
      const out: Record<string, FirestoreValue> = {};
      for (const key of Object.keys(u)) {
        path.push(key);
        out[key] = go(u[key]);
        path.pop();
      }
      return out;
    }
    throw new UnsupportedSdkValue({ path: [...path], value: u });
  };
  try {
    return Result.succeed(go(value));
  } catch (error) {
    if (error instanceof UnsupportedSdkValue) return Result.fail(error);
    throw error;
  }
};

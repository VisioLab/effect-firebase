import { Option, Predicate, type Result } from "effect";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import type { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreValue from "@visiolab/effect-firebase/firestore/FirestoreValue";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import * as Admin from "firebase-admin/firestore";

/** How the Admin SDK writes each kind of Firestore Value into `firestore`. */
const writer = (firestore: Admin.Firestore): FirestoreValue.Writer => ({
  bytes: (bytes) => bytes,
  timestamp: (ts) => new Admin.Timestamp(ts.seconds, ts.nanoseconds),
  geoPoint: (point) => new Admin.GeoPoint(point.latitude, point.longitude),
  documentReference: (ref) => firestore.doc(ref.path),
  serverTimestamp: () => Admin.FieldValue.serverTimestamp(),
  increment: (increment) => Admin.FieldValue.increment(increment.by),
  deleteField: () => Admin.FieldValue.delete(),
  arrayUnion: (union, walk) => Admin.FieldValue.arrayUnion(...union.elements.map(walk)),
  arrayRemove: (remove, walk) => Admin.FieldValue.arrayRemove(...remove.elements.map(walk)),
});

/** @internal */
export const toAdmin = (
  value: FirestoreValue.FirestoreValue,
  firestore: Admin.Firestore,
): unknown => FirestoreValue.toSdk(value, writer(firestore));

/** The sentinels' names, as the Admin SDK keeps them. */
interface AdminSentinel {
  readonly methodName?: string;
  readonly operand?: number;
  readonly elements?: ReadonlyArray<unknown>;
}

/** How the Admin SDK's own values read back as Firestore Values. */
const reader: FirestoreValue.Reader = (u, { walk, fail }) => {
  if (u instanceof Uint8Array) {
    // The Admin SDK reads bytes as a Node `Buffer`.
    return u.constructor === Uint8Array ? u : new Uint8Array(u.buffer, u.byteOffset, u.length);
  }
  if (u instanceof Admin.Timestamp) return Timestamp.makeUnsafe(u.seconds, u.nanoseconds);
  if (u instanceof Admin.GeoPoint) return GeoPoint.makeUnsafe(u.latitude, u.longitude);
  if (u instanceof Admin.DocumentReference) {
    const ref = Collection.fromPathUntyped(u.path);
    return Option.isSome(ref) ? ref.value : fail(`a reference to "${u.path}"`);
  }
  if (u instanceof Admin.FieldValue) {
    const sentinel = u as AdminSentinel;
    switch (sentinel.methodName) {
      case "FieldValue.serverTimestamp":
        return FieldValue.serverTimestamp;
      case "FieldValue.delete":
        return FieldValue.deleteField;
      case "FieldValue.increment":
        if (Predicate.isNumber(sentinel.operand)) return FieldValue.increment(sentinel.operand);
        break;
      case "FieldValue.arrayUnion":
        if (Array.isArray(sentinel.elements))
          return FieldValue.arrayUnion(...sentinel.elements.map(walk));
        break;
      case "FieldValue.arrayRemove":
        if (Array.isArray(sentinel.elements))
          return FieldValue.arrayRemove(...sentinel.elements.map(walk));
        break;
    }
    return fail(`the sentinel ${sentinel.methodName ?? u.constructor.name}`);
  }
  return undefined;
};

/** @internal */
export const fromAdmin = (
  value: unknown,
): Result.Result<FirestoreValue.FirestoreValue, FirestoreError> =>
  FirestoreValue.fromSdk(value, reader);

/**
 * What the Admin SDK read for the document at `path`, as Firestore Values, or
 * `undefined` for a document that is not there.
 *
 * @internal
 */
export const readDocument = (
  path: string,
  data: Admin.DocumentData | undefined,
): Result.Result<FirestoreValue.FirestoreValue | undefined, FirestoreError> =>
  FirestoreValue.readDocument(path, data, reader);

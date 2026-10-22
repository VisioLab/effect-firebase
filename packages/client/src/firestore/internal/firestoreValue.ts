import type { Result } from "effect";
import * as DocumentPath from "@visiolab/effect-firebase/firestore/DocumentPath";
import type { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreValue from "@visiolab/effect-firebase/firestore/FirestoreValue";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import * as Client from "firebase/firestore";

/** How the client SDK writes each kind of Firestore Value into `firestore`. */
const writer = (firestore: Client.Firestore): FirestoreValue.Writer => ({
  // The client SDK refuses a raw `Uint8Array`, as a custom object.
  bytes: (bytes) => Client.Bytes.fromUint8Array(bytes),
  timestamp: (ts) => new Client.Timestamp(ts.seconds, ts.nanoseconds),
  geoPoint: (point) => new Client.GeoPoint(point.latitude, point.longitude),
  documentPath: (ref) => Client.doc(firestore, ref.path),
  serverTimestamp: () => Client.serverTimestamp(),
  increment: (increment) => Client.increment(increment.by),
  deleteField: () => Client.deleteField(),
  arrayUnion: (union, walk) => Client.arrayUnion(...union.elements.map(walk)),
  arrayRemove: (remove, walk) => Client.arrayRemove(...remove.elements.map(walk)),
});

/** @internal */
export const toClient = (
  value: FirestoreValue.FirestoreValue,
  firestore: Client.Firestore,
): unknown => FirestoreValue.toSdk(value, writer(firestore));

/**
 * How the client SDK's own values read back as Firestore Values. Its
 * sentinels are not read back: a read never hands one back, and the names it
 * keeps them by are internal to it.
 */
const reader: FirestoreValue.Reader = (u) => {
  if (u instanceof Client.Timestamp) return Timestamp.makeUnsafe(u.seconds, u.nanoseconds);
  if (u instanceof Client.GeoPoint) return GeoPoint.makeUnsafe(u.latitude, u.longitude);
  if (u instanceof Client.DocumentReference) return DocumentPath.makeUnsafe(u.path);
  if (u instanceof Client.Bytes) return u.toUint8Array();
  return undefined;
};

/** @internal */
export const fromClient = (
  value: unknown,
): Result.Result<FirestoreValue.FirestoreValue, FirestoreError> =>
  FirestoreValue.fromSdk(value, reader);

/**
 * What the client SDK read for the document at `path`, as Firestore Values,
 * or `undefined` for a document that is not there.
 *
 * @internal
 */
export const readDocument = (
  path: string,
  data: Client.DocumentData | undefined,
): Result.Result<FirestoreValue.FirestoreValue | undefined, FirestoreError> =>
  FirestoreValue.readDocument(path, data, reader);

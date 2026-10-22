/**
 * The client SDK's implementation of {@link FirestoreEncoder.FirestoreEncoder}.
 *
 * `firestore/Firestore.layerWithEncoder` provides one for the database it
 * opens, so this is only needed to encode against a database built some other
 * way.
 *
 * @stability unstable
 * @since 0.1.0
 */
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  GeoPoint,
  increment,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

/**
 * Builds the values the client SDK writes into `firestore`.
 *
 * A reference is built against `firestore`, so it points into that database.
 * Every other value is the same whichever database it is written to.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = (firestore: Firestore): FirestoreEncoder =>
  FirestoreEncoder.of({
    timestamp: ({ seconds, nanoseconds }) => new Timestamp(seconds, nanoseconds),
    geoPoint: ({ latitude, longitude }) => new GeoPoint(latitude, longitude),
    documentReference: (ref) => doc(firestore, ref.path),
    serverTimestamp: () => serverTimestamp(),
    increment: (by) => increment(by),
    deleteField: () => deleteField(),
    arrayUnion: (elements) => arrayUnion(...elements),
    arrayRemove: (elements) => arrayRemove(...elements),
  });

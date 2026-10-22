/**
 * The Admin SDK's implementation of {@link FirestoreEncoder.FirestoreEncoder}.
 *
 * `firestore/AdminFirestore.layerWithEncoder` provides one for the database it
 * opens, so this is only needed to encode against a database built some other
 * way.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import { FieldValue, GeoPoint, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

/**
 * Builds the values the Admin SDK writes into `firestore`.
 *
 * A reference is built against `firestore`, so it points into that database.
 * Every other value is the same whichever database it is written to.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make = (firestore: Firestore): FirestoreEncoder =>
  FirestoreEncoder.of({
    timestamp: ({ seconds, nanoseconds }) => new Timestamp(seconds, nanoseconds),
    geoPoint: ({ latitude, longitude }) => new GeoPoint(latitude, longitude),
    documentReference: (ref) => firestore.doc(ref.path),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    increment: (by) => FieldValue.increment(by),
    deleteField: () => FieldValue.delete(),
    arrayUnion: (elements) => FieldValue.arrayUnion(...elements),
    arrayRemove: (elements) => FieldValue.arrayRemove(...elements),
  });

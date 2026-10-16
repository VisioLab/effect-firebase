/**
 * The Admin SDK's implementation of {@link FirestoreEncoder.FirestoreEncoder}.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Layer } from "effect";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Builds the values the Admin SDK writes.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: FirestoreEncoder = {
  timestamp: ({ seconds, nanoseconds }) => new Timestamp(seconds, nanoseconds),
  serverTimestamp: () => FieldValue.serverTimestamp(),
  increment: (by) => FieldValue.increment(by),
  deleteField: () => FieldValue.delete(),
  arrayUnion: (elements) => FieldValue.arrayUnion(...elements),
  arrayRemove: (elements) => FieldValue.arrayRemove(...elements),
};

/**
 * A layer providing {@link make}.
 *
 * @stability unstable
 * @category layers
 * @since 0.2.0
 */
export const layer: Layer.Layer<FirestoreEncoder> = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of(make),
);

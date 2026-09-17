/**
 * The Admin SDK's implementation of {@link FirestoreEncoder.FirestoreEncoder}.
 *
 * @since 0.0.0
 */
import { Layer } from "effect";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Builds the values the Admin SDK writes.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make: FirestoreEncoder = {
  timestamp: ({ seconds, nanoseconds }) => new Timestamp(seconds, nanoseconds),
};

/**
 * A layer providing {@link make}.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<FirestoreEncoder> = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of(make),
);

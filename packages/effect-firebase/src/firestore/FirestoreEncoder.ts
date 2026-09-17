/**
 * Building the values an SDK writes.
 *
 * Firestore decides what a field is by the class of the value it is handed, so
 * a timestamp has to become the SDK's own before it is written - handed over as
 * it is, it would be stored as a nested map rather than as a timestamp, and
 * nothing would report it.
 *
 * @since 0.0.0
 */
import { Context } from "effect";
import type * as Timestamp from "./Timestamp.ts";

/**
 * Builds the values one SDK writes.
 *
 * @category models
 * @since 0.0.0
 */
export interface FirestoreEncoder {
  readonly timestamp: (value: Timestamp.Timestamp) => Timestamp.TimestampLike;
}

/**
 * Service key for the encoder a document is written through.
 *
 * Encoding a document asks for this and decoding one does not, because a
 * timestamp an SDK hands back is already a {@link Timestamp.TimestampLike}.
 *
 * @category services
 * @since 0.0.0
 */
export const FirestoreEncoder = Context.Service<FirestoreEncoder>(
  "@visiolab/effect-firebase/firestore/FirestoreEncoder",
);

/**
 * Building the values an SDK writes.
 *
 * Firestore decides what a field is by the class of the value it is handed, so
 * a timestamp has to become the SDK's own before it is written - handed over as
 * it is, it would be stored as a nested map rather than as a timestamp, and
 * nothing would report it.
 *
 * @since 0.2.0
 */
import { Context } from "effect";
import type * as Timestamp from "./Timestamp.ts";

/**
 * Builds the values one SDK writes.
 *
 * @category models
 * @since 0.2.0
 */
export interface FirestoreEncoder {
  readonly timestamp: (value: Timestamp.Timestamp) => Timestamp.TimestampLike;
  /**
   * The sentinel standing in for the instant the server applies the write.
   *
   * There is nothing to hand over, because the sentinel carries nothing. What
   * comes back is whatever that SDK's `FieldValue` is, which is opaque here: it
   * goes straight back to the SDK that built it, and a document never reads one
   * back.
   */
  readonly serverTimestamp: () => unknown;
  /**
   * The sentinel standing in for the number a field holds, moved by `by`.
   *
   * Firestore has the one sentinel for both directions, so a `by` below zero is
   * how a field comes down. What comes back is that SDK's `FieldValue`, which
   * is as opaque here as the one above.
   */
  readonly increment: (by: number) => unknown;
  /**
   * The sentinel standing in for a field the write removes.
   *
   * It carries nothing, as the server timestamp carries nothing, and what
   * comes back is that SDK's `FieldValue`, as opaque here as the others.
   */
  readonly deleteField: () => unknown;
}

/**
 * Service key for the encoder a document is written through.
 *
 * Encoding a document asks for this and decoding one does not, because a
 * timestamp an SDK hands back is already a {@link Timestamp.TimestampLike}, and
 * a sentinel is gone by the time a document is read.
 *
 * @category services
 * @since 0.2.0
 */
export const FirestoreEncoder = Context.Service<FirestoreEncoder>(
  "@visiolab/effect-firebase/firestore/FirestoreEncoder",
);

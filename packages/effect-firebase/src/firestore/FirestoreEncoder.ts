/**
 * Building the values an SDK writes.
 *
 * Firestore decides what a field is by the class of the value it is handed, so
 * a timestamp has to become the SDK's own before it is written - handed over as
 * it is, it would be stored as a nested map rather than as a timestamp, and
 * nothing would report it.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Context } from "effect";
import type * as Collection from "./Collection.ts";
import type * as Timestamp from "./Timestamp.ts";

/**
 * Builds the values one SDK writes.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface FirestoreEncoder {
  readonly timestamp: (value: Timestamp.Timestamp) => Timestamp.TimestampLike;
  /**
   * That SDK's own reference to the document `ref` points at.
   *
   * Handed over as it is, a reference would be stored as a nested map rather
   * than as a reference, the way a timestamp would. Building one takes the
   * database it points into, which is why an encoder that answers this is
   * built from one.
   */
  readonly documentReference: (
    ref: Collection.DocumentReference<Collection.Any>,
  ) => Collection.DocumentReferenceLike;
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
  /**
   * The sentinel standing in for an array grown by whichever of `elements` it
   * lacks.
   *
   * The elements are already encoded, so a timestamp among them is this SDK's
   * own by the time it gets here. What comes back is that SDK's `FieldValue`,
   * as opaque here as the others.
   */
  readonly arrayUnion: (elements: ReadonlyArray<unknown>) => unknown;
  /**
   * The sentinel standing in for an array rid of every element equal to one of
   * `elements`.
   *
   * The elements are already encoded, as they are for the one above, and what
   * comes back is as opaque.
   */
  readonly arrayRemove: (elements: ReadonlyArray<unknown>) => unknown;
}

/**
 * Service key for the encoder a document is written through.
 *
 * Encoding a document asks for this and decoding one does not, because a
 * timestamp an SDK hands back is already a {@link Timestamp.TimestampLike}, a
 * reference is already a {@link Collection.DocumentReferenceLike}, and a
 * sentinel is gone by the time a document is read.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const FirestoreEncoder = Context.Service<FirestoreEncoder>(
  "@visiolab/effect-firebase/firestore/FirestoreEncoder",
);

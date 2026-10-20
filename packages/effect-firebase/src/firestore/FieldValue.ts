/**
 * Values that only exist on the way to the database.
 *
 * Firestore accepts a handful of sentinels in place of a value - a timestamp the
 * server fills in, a counter it increments, a field it removes - and resolves
 * each one when the write lands. They are never read back: a document always
 * comes back holding whatever the sentinel resolved to.
 *
 * This module owns those markers without depending on an SDK, the same way
 * `Timestamp` owns the instant. The sentinel an SDK actually writes is built by
 * a {@link FirestoreEncoder.FirestoreEncoder}, and the codecs that reach for it
 * live in `firestore/FirestoreSchema`.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Equal, Inspectable } from "effect";
import * as fieldValue from "./internal/fieldValue.ts";

const ServerTimestampTypeId = fieldValue.ServerTimestampTypeId;

/**
 * A stand-in for the instant the server applied the write.
 *
 * There is nothing to carry: the value is the request, and the server answers
 * it. Writing one is how a document gets a time that every client agrees on,
 * rather than the time at whichever client happened to write it.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ServerTimestamp extends Inspectable.Inspectable {
  readonly [ServerTimestampTypeId]: typeof ServerTimestampTypeId;
}

/**
 * The only {@link ServerTimestamp} there is.
 *
 * It carries nothing, so one is enough, and equality falls out of that: two
 * requests for the server's time are the same request.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const serverTimestamp: ServerTimestamp = fieldValue.serverTimestamp;

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isServerTimestamp: (u: unknown) => u is ServerTimestamp = fieldValue.isServerTimestamp;

const IncrementTypeId = fieldValue.IncrementTypeId;

/**
 * A stand-in for the number a field already holds, moved by `by`.
 *
 * The server reads the field, adds `by`, and writes the sum, so two clients
 * that each add one leave the field two higher - which is not what reading a
 * number and writing it back would do, since each would have read the same
 * number and written the same sum.
 *
 * A field that holds no number yet, or holds something else entirely, counts as
 * zero, so an increment lands on a document whether or not the field was there.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Increment extends Equal.Equal, Inspectable.Inspectable {
  readonly [IncrementTypeId]: typeof IncrementTypeId;
  /** How far the field moves, which is negative where it comes down. */
  readonly by: number;
}

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isIncrement: (u: unknown) => u is Increment = fieldValue.isIncrement;

/**
 * Asks the server to raise a field by `by`.
 *
 * Throws for a `by` Firestore would refuse, which is to say one that is not a
 * finite number. Both integers and doubles go through; an integer added to a
 * double comes back a double.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const increment: (by: number) => Increment = fieldValue.increment;

/**
 * Asks the server to lower a field by `by`.
 *
 * Firestore has the one sentinel, so this is {@link increment} of the negation
 * and reads back as such: `decrement(2).by` is `-2`. It is here because a call
 * site that counts down should say so rather than negate by hand.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const decrement: (by: number) => Increment = fieldValue.decrement;

const DeleteFieldTypeId = fieldValue.DeleteFieldTypeId;

/**
 * A stand-in for a field the write removes.
 *
 * Leaving a field out of an update leaves it as it is, so taking one away has
 * to be asked for. This is how: the server drops the field from the document,
 * and a read that follows finds no key at all rather than one holding nothing.
 *
 * Only an update asks for it. A document written whole - `set` without
 * `merge` - removes a field by leaving it out, and Firestore refuses the
 * sentinel there.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface DeleteField extends Inspectable.Inspectable {
  readonly [DeleteFieldTypeId]: typeof DeleteFieldTypeId;
}

/**
 * The only {@link DeleteField} there is.
 *
 * It carries nothing, as {@link serverTimestamp} carries nothing, so one is
 * enough. It is not called `delete`, which is a word JavaScript keeps for
 * itself - the web SDK calls its own `deleteField` for the same reason.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const deleteField: DeleteField = fieldValue.deleteField;

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isDeleteField: (u: unknown) => u is DeleteField = fieldValue.isDeleteField;

const ArrayUnionTypeId = fieldValue.ArrayUnionTypeId;

/**
 * A stand-in for an array, grown by whichever of `elements` it lacks.
 *
 * The server reads the array, appends each element it does not already hold,
 * and writes the result, so two clients that each add one leave both in place -
 * which is not what reading the array and writing it back would do, since the
 * second write would carry the array as it was before the first.
 *
 * A field that holds no array yet, or holds something else entirely, ends up
 * holding just `elements`.
 *
 * Whether an element is already there is the server's to say, and it compares
 * by value, all the way down: a map matches one with the same keys holding the
 * same values, whatever order they were written in.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ArrayUnion<A> extends Inspectable.Inspectable {
  readonly [ArrayUnionTypeId]: typeof ArrayUnionTypeId;
  /** What the array is to gain, in the order it is appended. */
  readonly elements: ReadonlyArray<A>;
}

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isArrayUnion: (u: unknown) => u is ArrayUnion<unknown> = fieldValue.isArrayUnion;

/**
 * Asks the server to add `elements` to an array, skipping any it holds already.
 *
 * Handed nothing, it changes nothing - though a field that held no array comes
 * back holding an empty one.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const arrayUnion: <A>(...elements: ReadonlyArray<A>) => ArrayUnion<A> =
  fieldValue.arrayUnion;

const ArrayRemoveTypeId = fieldValue.ArrayRemoveTypeId;

/**
 * A stand-in for an array, rid of every element equal to one of `elements`.
 *
 * The server reads the array, drops each element that matches, and writes what
 * is left, so it lands whatever else was written to the array in the meantime.
 *
 * A match is by value, as {@link ArrayUnion} has it, and it is exact: an element
 * holding a key the stored one lacks, or a number where the stored one holds
 * another, is a different element and leaves the stored one where it is. Taking
 * a map out of an array means handing over every key it holds as it holds it,
 * so where an element has an identity of its own, a map keyed by it is the
 * easier thing to take one out of.
 *
 * A field that holds no array, or holds something else entirely, ends up
 * holding an empty one.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ArrayRemove<A> extends Inspectable.Inspectable {
  readonly [ArrayRemoveTypeId]: typeof ArrayRemoveTypeId;
  /** What the array is to lose, wherever it holds it. */
  readonly elements: ReadonlyArray<A>;
}

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isArrayRemove: (u: unknown) => u is ArrayRemove<unknown> = fieldValue.isArrayRemove;

/**
 * Asks the server to take every element equal to one of `elements` out of an
 * array.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const arrayRemove: <A>(...elements: ReadonlyArray<A>) => ArrayRemove<A> =
  fieldValue.arrayRemove;

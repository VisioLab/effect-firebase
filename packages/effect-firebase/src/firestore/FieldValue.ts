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
 * @since 0.0.0
 */
import { Equal, Hash, Inspectable, Predicate } from "effect";

const ServerTimestampTypeId = "~@visiolab/effect-firebase/firestore/FieldValue/ServerTimestamp";

/**
 * A stand-in for the instant the server applied the write.
 *
 * There is nothing to carry: the value is the request, and the server answers
 * it. Writing one is how a document gets a time that every client agrees on,
 * rather than the time at whichever client happened to write it.
 *
 * @category models
 * @since 0.0.0
 */
export interface ServerTimestamp extends Inspectable.Inspectable {
  readonly [ServerTimestampTypeId]: typeof ServerTimestampTypeId;
}

const ServerTimestampProto: ServerTimestamp = {
  ...Inspectable.BaseProto,
  [ServerTimestampTypeId]: ServerTimestampTypeId,
  toJSON() {
    return { _id: "ServerTimestamp" };
  },
};

/**
 * The only {@link ServerTimestamp} there is.
 *
 * It carries nothing, so one is enough, and equality falls out of that: two
 * requests for the server's time are the same request.
 *
 * @category constructors
 * @since 0.0.0
 */
export const serverTimestamp: ServerTimestamp = Object.create(
  ServerTimestampProto,
) as ServerTimestamp;

/**
 * @category guards
 * @since 0.0.0
 */
export const isServerTimestamp = (u: unknown): u is ServerTimestamp =>
  Predicate.hasProperty(u, ServerTimestampTypeId);

const IncrementTypeId = "~@visiolab/effect-firebase/firestore/FieldValue/Increment";

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
 * @category models
 * @since 0.0.0
 */
export interface Increment extends Equal.Equal, Inspectable.Inspectable {
  readonly [IncrementTypeId]: typeof IncrementTypeId;
  /** How far the field moves, which is negative where it comes down. */
  readonly by: number;
}

/**
 * @category guards
 * @since 0.0.0
 */
export const isIncrement = (u: unknown): u is Increment =>
  Predicate.hasProperty(u, IncrementTypeId);

const IncrementProto: Omit<Increment, "by"> = {
  ...Inspectable.BaseProto,
  [IncrementTypeId]: IncrementTypeId,
  toJSON(this: Increment) {
    return { _id: "Increment", by: this.by };
  },
  [Equal.symbol](this: Increment, that: unknown): boolean {
    return isIncrement(that) && this.by === that.by;
  },
  [Hash.symbol](this: Increment): number {
    return Hash.combine(Hash.string(IncrementTypeId), Hash.number(this.by));
  },
};

/**
 * Asks the server to raise a field by `by`.
 *
 * Throws for a `by` Firestore would refuse, which is to say one that is not a
 * finite number. Both integers and doubles go through; an integer added to a
 * double comes back a double.
 *
 * @category constructors
 * @since 0.0.0
 */
export const increment = (by: number): Increment => {
  if (!Number.isFinite(by)) {
    throw new Error(`Invalid Firestore increment: by must be a finite number, got ${by}`);
  }
  return Object.assign(Object.create(IncrementProto) as typeof IncrementProto, { by });
};

/**
 * Asks the server to lower a field by `by`.
 *
 * Firestore has the one sentinel, so this is {@link increment} of the negation
 * and reads back as such: `decrement(2).by` is `-2`. It is here because a call
 * site that counts down should say so rather than negate by hand.
 *
 * @category constructors
 * @since 0.0.0
 */
export const decrement = (by: number): Increment => increment(-by);

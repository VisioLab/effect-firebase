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
import { Inspectable, Predicate } from "effect";

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

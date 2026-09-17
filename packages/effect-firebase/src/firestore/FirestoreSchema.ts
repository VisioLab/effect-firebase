/**
 * Schemas for the values Firestore stores.
 *
 * Firestore holds a handful of values that are not plain JSON, and hands each
 * back as an instance belonging to whichever SDK read it. The codecs here decode
 * those shapes into values this library owns, and encode them back through an
 * {@link FirestoreEncoder}, so a document schema is written once and reads the same under
 * the Admin SDK and the web SDK.
 *
 * @since 0.0.0
 */
import { DateTime, Effect, Equal, Schema, SchemaGetter } from "effect";
import { FirestoreEncoder } from "./FirestoreEncoder.ts";
import * as Timestamp_ from "./Timestamp.ts";

/** Accepts a timestamp in the shape Firestore hands back, whichever SDK read it. */
const TimestampLikeValue = Schema.declare<Timestamp_.TimestampLike>(Timestamp_.isTimestampLike, {
  representation: { id: "@visiolab/effect-firebase/firestore/Timestamp/Like", payload: null },
  expected: "a Firestore timestamp",
  toEquivalence: () => (self, that) =>
    self.seconds === that.seconds && self.nanoseconds === that.nanoseconds,
});

const TimestampValue = Schema.declare<Timestamp_.Timestamp>(Timestamp_.isTimestamp, {
  representation: { id: "@visiolab/effect-firebase/firestore/Timestamp", payload: null },
  expected: "a Firestore Timestamp",
  toEquivalence: () => Equal.equals,
});

/**
 * Type-level representation of {@link Timestamp}.
 *
 * @category models
 * @since 0.0.0
 */
export interface Timestamp extends Schema.decodeTo<
  Schema.declare<Timestamp_.Timestamp>,
  Schema.declare<Timestamp_.TimestampLike>,
  never,
  FirestoreEncoder
> {
  readonly Rebuild: Timestamp;
}

/**
 * Schema that decodes a Firestore timestamp into a `Timestamp`.
 *
 * Nothing is lost in either direction, so reach for this over
 * {@link DateTimeUtcFromTimestamp} when a document is read, written back, and
 * expected to come out unchanged.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Timestamp: Timestamp = TimestampLikeValue.pipe(
  Schema.decodeTo(TimestampValue, {
    decode: SchemaGetter.transform(Timestamp_.fromTimestampLikeUnsafe),
    encode: SchemaGetter.transformOrFail((timestamp: Timestamp_.Timestamp) =>
      Effect.map(FirestoreEncoder, (encoder) => encoder.timestamp(timestamp)),
    ),
  }),
);

/**
 * Type-level representation of {@link DateTimeUtcFromTimestamp}.
 *
 * @category models
 * @since 0.0.0
 */
export interface DateTimeUtcFromTimestamp extends Schema.decodeTo<
  Schema.DateTimeUtc,
  Schema.declare<Timestamp_.TimestampLike>,
  never,
  FirestoreEncoder
> {
  readonly Rebuild: DateTimeUtcFromTimestamp;
}

/**
 * Schema that decodes a Firestore timestamp into a `DateTime.Utc`.
 *
 * `DateTime.Utc` counts in milliseconds, so the finer digits of a timestamp
 * Firestore filled in - a server timestamp, say - are dropped on the way in and
 * do not come back on the way out. Reach for {@link Timestamp} where that
 * matters.
 *
 * @category schemas
 * @since 0.0.0
 */
export const DateTimeUtcFromTimestamp: DateTimeUtcFromTimestamp = TimestampLikeValue.pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transform((like: Timestamp_.TimestampLike) =>
      Timestamp_.toDateTime(Timestamp_.fromTimestampLikeUnsafe(like)),
    ),
    encode: SchemaGetter.transformOrFail((dateTime: DateTime.Utc) =>
      Effect.map(FirestoreEncoder, (encoder) =>
        encoder.timestamp(Timestamp_.fromDateTimeUnsafe(dateTime)),
      ),
    ),
  }),
);

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
import * as FieldValue from "./FieldValue.ts";
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
    encode: SchemaGetter.transformEffect((timestamp: Timestamp_.Timestamp) =>
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
    encode: SchemaGetter.transformEffect((dateTime: DateTime.Utc) =>
      Effect.map(FirestoreEncoder, (encoder) =>
        encoder.timestamp(Timestamp_.fromDateTimeUnsafe(dateTime)),
      ),
    ),
  }),
);

const ServerTimestampValue = Schema.declare<FieldValue.ServerTimestamp>(
  FieldValue.isServerTimestamp,
  {
    representation: {
      id: "@visiolab/effect-firebase/firestore/FieldValue/ServerTimestamp",
      payload: null,
    },
    expected: "a server timestamp",
  },
);

interface ServerTimestampSentinel extends Schema.decodeTo<
  Schema.declare<FieldValue.ServerTimestamp>,
  Schema.Unknown,
  never,
  FirestoreEncoder
> {
  readonly Rebuild: ServerTimestampSentinel;
}

const ServerTimestampSentinel: ServerTimestampSentinel = Schema.Unknown.pipe(
  Schema.decodeTo(ServerTimestampValue, {
    decode: SchemaGetter.forbidden(
      () => "A server timestamp is only ever written, never read back",
    ),
    encode: SchemaGetter.transformEffect(() =>
      Effect.map(FirestoreEncoder, (encoder) => encoder.serverTimestamp()),
    ),
  }),
);

/**
 * Type-level representation of {@link ServerTimestamp}.
 *
 * @category models
 * @since 0.0.0
 */
export interface ServerTimestamp extends Schema.withConstructorDefault<ServerTimestampSentinel> {
  readonly Rebuild: ServerTimestamp;
}

/**
 * Schema that writes the sentinel standing in for the instant the server
 * applies the write.
 *
 * There is only one value it accepts, so there is nothing to say at a call
 * site: the constructor fills the sentinel in, the way `Schema.tag` fills in a
 * tag. Hand it to {@link Schema.Struct} and the field is written without ever
 * being named.
 *
 * This one only goes one way. Decoding fails, because a document never holds a
 * sentinel: by the time it is read, the server has replaced it with the
 * timestamp it resolved to, which is what the field reads as on the way back -
 * see {@link FirestoreModel.Timestamp} for the pair.
 *
 * @category schemas
 * @since 0.0.0
 */
export const ServerTimestamp: ServerTimestamp = ServerTimestampSentinel.pipe(
  Schema.withConstructorDefault(Effect.succeed(FieldValue.serverTimestamp)),
);

/**
 * Type-level representation of {@link TimestampOrServer}.
 *
 * @category models
 * @since 0.0.0
 */
export interface TimestampOrServer extends Schema.Union<readonly [Timestamp, ServerTimestamp]> {
  readonly Rebuild: TimestampOrServer;
}

/**
 * Schema for a field written either as an instant this client picked or as the
 * one the server picks.
 *
 * This is the write side of a timestamp. A read is only ever a
 * {@link Timestamp} - the sentinel is gone by then - so this belongs in the
 * variants a document is written through, against a `read` of {@link Timestamp}.
 *
 * @category schemas
 * @since 0.0.0
 */
export const TimestampOrServer: TimestampOrServer = Schema.Union([Timestamp, ServerTimestamp]);

const IncrementValue = Schema.declare<FieldValue.Increment>(FieldValue.isIncrement, {
  representation: {
    id: "@visiolab/effect-firebase/firestore/FieldValue/Increment",
    payload: null,
  },
  expected: "an increment",
  toEquivalence: () => Equal.equals,
});

/**
 * Type-level representation of {@link Increment}.
 *
 * @category models
 * @since 0.0.0
 */
export interface Increment extends Schema.decodeTo<
  Schema.declare<FieldValue.Increment>,
  Schema.Unknown,
  never,
  FirestoreEncoder
> {
  readonly Rebuild: Increment;
}

/**
 * Schema that writes the sentinel standing in for a field moved by a number.
 *
 * A call site hands it {@link FieldValue.increment} or
 * {@link FieldValue.decrement}, and the encoder turns it into the sentinel its
 * SDK writes.
 *
 * This one only goes one way, as {@link ServerTimestamp} does. A document holds
 * the sum the server wrote rather than the request to add, so a read of the
 * same field is a plain number - see {@link NumberOrIncrement} for the pair.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Increment: Increment = Schema.Unknown.pipe(
  Schema.decodeTo(IncrementValue, {
    decode: SchemaGetter.forbidden(() => "An increment is only ever written, never read back"),
    encode: SchemaGetter.transformEffect((value: FieldValue.Increment) =>
      Effect.map(FirestoreEncoder, (encoder) => encoder.increment(value.by)),
    ),
  }),
);

/**
 * Type-level representation of {@link IncrementOr}.
 *
 * @category models
 * @since 0.0.0
 */
export interface IncrementOr<
  S extends Schema.Codec<unknown, number, unknown, unknown>,
> extends Schema.Union<readonly [S, Increment]> {
  readonly Rebuild: IncrementOr<S>;
}

/**
 * Schema for a field written either as the number it is to hold or as a move
 * from whatever it holds already.
 *
 * This is the write side of a number the server counts, and `schema` is the
 * read side it is built from, which is where a call site says what the number
 * may be: `Schema.Finite`, or `Schema.Int` for a field counted in whole steps,
 * or either of them checked further. All that is asked of it is that it is
 * stored as a number, since that is what the server adds to.
 *
 * A read is only ever that schema - the sentinel resolved to a number before
 * the document came back - so this belongs in the variants a document is
 * written through, against a `read` of the same.
 *
 * @category schemas
 * @since 0.0.0
 */
export const IncrementOr = <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
): IncrementOr<S> => Schema.Union([schema, Increment]);

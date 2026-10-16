/**
 * Firestore timestamps.
 *
 * Firestore stores an instant as a count of seconds since the Unix epoch plus a
 * non-negative fraction of a second, and hands it back as a `Timestamp`
 * belonging to whichever SDK read it. This module owns that value without
 * depending on an SDK, so a document schema stays portable between them.
 *
 * The codecs that read and write it live in `Firestore/FirestoreSchema`, which keeps this
 * module free of the schema machinery.
 *
 * @since 0.2.0
 */
import type { DateTime, Effect, Equal, Inspectable, Option, Order as order } from "effect";
import * as timestamp from "./internal/timestamp.ts";

const TypeId = timestamp.TypeId;

/**
 * The minimal shape of a Firestore timestamp, whoever built it.
 *
 * Both the Admin SDK and the web SDK hand back a `Timestamp` carrying these two
 * fields, so this is the shape a document arrives in whichever one read it.
 *
 * @category models
 * @since 0.2.0
 */
export interface TimestampLike {
  /** Seconds since the Unix epoch, which is negative before it. */
  readonly seconds: number;
  /** The fraction of that second, which is never negative. */
  readonly nanoseconds: number;
}

/**
 * An instant, held the way Firestore holds it.
 *
 * Firestore stores timestamps to microsecond precision, which is finer than a
 * `DateTime.Utc` can hold, so this is the representation that survives a round
 * trip through the database intact.
 *
 * @category models
 * @since 0.2.0
 */
export interface Timestamp extends TimestampLike, Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
}

/**
 * Whether `u` is a {@link Timestamp} this module built.
 *
 * @category guards
 * @since 0.2.0
 */
export const isTimestamp: (u: unknown) => u is Timestamp = timestamp.isTimestamp;

/**
 * Whether `u` is shaped like a Firestore timestamp and holds an instant
 * Firestore can address.
 *
 * This is what makes a timestamp readable without depending on an SDK: an SDK's
 * own `Timestamp` passes, because it carries the same two fields.
 *
 * @category guards
 * @since 0.2.0
 */
export const isTimestampLike: (u: unknown) => u is TimestampLike = timestamp.isTimestampLike;

/**
 * Builds a timestamp from the two fields Firestore stores, throwing when they
 * do not describe an instant Firestore can address.
 *
 * @see {@link make} for the same check without the throw.
 *
 * @category constructors
 * @since 0.2.0
 */
export const makeUnsafe: (seconds: number, nanoseconds: number) => Timestamp = timestamp.makeUnsafe;

/**
 * Builds a timestamp from the two fields Firestore stores, or `None` when they
 * do not describe an instant Firestore can address.
 *
 * @category constructors
 * @since 0.2.0
 */
export const make: (seconds: number, nanoseconds: number) => Option.Option<Timestamp> =
  timestamp.make;

/**
 * Builds a timestamp from milliseconds since the Unix epoch, throwing when they
 * fall outside the range Firestore addresses.
 *
 * @category constructors
 * @since 0.2.0
 */
export const fromMillisUnsafe: (millis: number) => Timestamp = timestamp.fromMillisUnsafe;

/**
 * Builds a timestamp from milliseconds since the Unix epoch, or `None` when
 * they fall outside the range Firestore addresses.
 *
 * @category constructors
 * @since 0.2.0
 */
export const fromMillis: (millis: number) => Option.Option<Timestamp> = timestamp.fromMillis;

/**
 * Builds a timestamp from a `DateTime.Utc`, which only carries milliseconds.
 *
 * Throws for the handful of instants a `DateTime` can hold and Firestore cannot,
 * which is to say those outside the years 1 to 9999.
 *
 * @category constructors
 * @since 0.2.0
 */
export const fromDateTimeUnsafe: (dateTime: DateTime.Utc) => Timestamp =
  timestamp.fromDateTimeUnsafe;

/**
 * Builds a timestamp from a `DateTime.Utc`, or `None` for the handful of
 * instants a `DateTime` can hold and Firestore cannot.
 *
 * @category constructors
 * @since 0.2.0
 */
export const fromDateTime: (dateTime: DateTime.Utc) => Option.Option<Timestamp> =
  timestamp.fromDateTime;

/**
 * Takes over a timestamp read through an SDK, leaving one of ours alone.
 *
 * Throws when the fields fall outside the range Firestore addresses.
 *
 * @category constructors
 * @since 0.2.0
 */
export const fromTimestampLikeUnsafe: (like: TimestampLike) => Timestamp =
  timestamp.fromTimestampLikeUnsafe;

/**
 * The current instant, read from the `Clock`, to the millisecond it reports.
 *
 * This is the time here rather than the time at the database.
 *
 * @category constructors
 * @since 0.2.0
 */
export const now: Effect.Effect<Timestamp> = timestamp.now;

/**
 * Milliseconds since the Unix epoch, dropping the finer digits.
 *
 * @category conversions
 * @since 0.2.0
 */
export const toMillis: (self: Timestamp) => number = timestamp.toMillis;

/**
 * The same instant as a `DateTime.Utc`, to the millisecond.
 *
 * @category conversions
 * @since 0.2.0
 */
export const toDateTime: (self: Timestamp) => DateTime.Utc = timestamp.toDateTime;

/**
 * Orders timestamps by when they happened, to the full precision they carry.
 *
 * @category ordering
 * @since 0.2.0
 */
export const Order: order.Order<TimestampLike> = timestamp.Order;

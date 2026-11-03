/**
 * Firestore timestamps, independent of either SDK.
 *
 * Firestore stores an instant as whole seconds since the Unix epoch plus a
 * non-negative count of nanoseconds, and each SDK reads it back as its own
 * `Timestamp` class. This module owns a portable version of that value, so a
 * document schema works the same under the Admin SDK and the client SDK.
 *
 * Its schema is {@link FirestoreSchema.Timestamp}.
 *
 * @see {@link FirestoreSchema.Timestamp} for storing a `Timestamp` in a document
 * @see {@link FirestoreModel.Timestamp} for a timestamp field the server may fill in
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { DateTime, Effect, Equal, Inspectable, Option, Order as order } from "effect";
import * as timestamp from "./internal/timestamp.ts";

const TypeId = timestamp.TypeId;

/**
 * An instant, stored the way Firestore stores it.
 *
 * **When to use**
 *
 * Use when a document is read, written back, and has to come out unchanged.
 * Firestore keeps timestamps to the microsecond, which `DateTime.Utc` and
 * `Date` cannot hold, so this is the only representation that round-trips
 * exactly.
 *
 * **Details**
 *
 * Two timestamps are equal when their `seconds` and `nanoseconds` are.
 * Firestore addresses instants from the start of year 1 to the end of year
 * 9999, and every constructor here checks for that range.
 *
 * @see {@link FirestoreSchema.Timestamp} for the schema of this value
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Timestamp extends Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /** Seconds since the Unix epoch, negative before it. */
  readonly seconds: number;
  /** The fraction of that second, from 0 to 999,999,999. */
  readonly nanoseconds: number;
}

/**
 * Checks whether `u` is a {@link Timestamp} built by this module.
 *
 * An SDK's own `Timestamp` is not one.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isTimestamp: (u: unknown) => u is Timestamp = timestamp.isTimestamp;

/**
 * Builds a timestamp from seconds and nanoseconds, throwing on values
 * Firestore cannot store.
 *
 * **When to use**
 *
 * Use for values known to be valid, such as constants. Use {@link make} for
 * values you have not checked.
 *
 * **Details**
 *
 * Throws unless `seconds` is an integer from year 1 to year 9999, and
 * `nanoseconds` is an integer from 0 to 999,999,999.
 *
 * @example Building a timestamp
 * ```ts
 * import { Timestamp } from "@visiolab/effect-firebase/firestore";
 *
 * const epoch = Timestamp.makeUnsafe(0, 0);
 * ```
 *
 * @see {@link make} for the same check returning an `Option`
 * @see {@link fromMillisUnsafe} for building one from milliseconds
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const makeUnsafe: (seconds: number, nanoseconds: number) => Timestamp = timestamp.makeUnsafe;

/**
 * Builds a timestamp from seconds and nanoseconds, or `None` for values
 * Firestore cannot store.
 *
 * **When to use**
 *
 * Use when the fields come from outside the program, such as a request body,
 * and may be invalid.
 *
 * **Details**
 *
 * Returns `None` unless `seconds` is an integer from year 1 to year 9999, and
 * `nanoseconds` is an integer from 0 to 999,999,999.
 *
 * @example Building a timestamp from untrusted input
 * ```ts
 * import { Option } from "effect";
 * import { Timestamp } from "@visiolab/effect-firebase/firestore";
 *
 * const valid = Timestamp.make(1_700_000_000, 500); // Option.some(...)
 * const invalid = Timestamp.make(0, -1); // Option.none()
 *
 * Option.isSome(valid); // true
 * Option.isNone(invalid); // true
 * ```
 *
 * @see {@link makeUnsafe} for the same check throwing instead
 * @see {@link fromMillis} for building one from milliseconds
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: (seconds: number, nanoseconds: number) => Option.Option<Timestamp> =
  timestamp.make;

/**
 * Builds a timestamp from milliseconds since the Unix epoch, throwing outside
 * the range Firestore stores.
 *
 * **When to use**
 *
 * Use with millisecond values known to be in range, such as `Date.now()`.
 *
 * @example Building a timestamp from milliseconds
 * ```ts
 * import { Timestamp } from "@visiolab/effect-firebase/firestore";
 *
 * const timestamp = Timestamp.fromMillisUnsafe(Date.now());
 * ```
 *
 * @see {@link fromMillis} for the same check returning an `Option`
 * @see {@link makeUnsafe} for building one from seconds and nanoseconds
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromMillisUnsafe: (millis: number) => Timestamp = timestamp.fromMillisUnsafe;

/**
 * Builds a timestamp from milliseconds since the Unix epoch, or `None` outside
 * the range Firestore stores.
 *
 * **When to use**
 *
 * Use with millisecond values that may be out of range or not finite.
 *
 * @see {@link fromMillisUnsafe} for the same check throwing instead
 * @see {@link toMillis} for the reverse conversion
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromMillis: (millis: number) => Option.Option<Timestamp> = timestamp.fromMillis;

/**
 * Builds a timestamp from a `DateTime.Utc`, throwing outside the range
 * Firestore stores.
 *
 * **When to use**
 *
 * Use with a `DateTime` known to fall between year 1 and year 9999, which
 * covers almost every real date.
 *
 * **Details**
 *
 * A `DateTime.Utc` only carries milliseconds, so the result has no finer
 * digits.
 *
 * @example Converting a DateTime
 * ```ts
 * import { DateTime } from "effect";
 * import { Timestamp } from "@visiolab/effect-firebase/firestore";
 *
 * const timestamp = Timestamp.fromDateTimeUnsafe(DateTime.makeUnsafe("2024-01-01T00:00:00Z"));
 * ```
 *
 * @see {@link fromDateTime} for the same check returning an `Option`
 * @see {@link toDateTime} for the reverse conversion
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromDateTimeUnsafe: (dateTime: DateTime.Utc) => Timestamp =
  timestamp.fromDateTimeUnsafe;

/**
 * Builds a timestamp from a `DateTime.Utc`, or `None` outside the range
 * Firestore stores.
 *
 * **When to use**
 *
 * Use with a `DateTime` that may fall outside year 1 to year 9999, such as one
 * parsed from user input.
 *
 * **Details**
 *
 * A `DateTime.Utc` only carries milliseconds, so the result has no finer
 * digits.
 *
 * @see {@link fromDateTimeUnsafe} for the same check throwing instead
 * @see {@link toDateTime} for the reverse conversion
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromDateTime: (dateTime: DateTime.Utc) => Option.Option<Timestamp> =
  timestamp.fromDateTime;

/**
 * The current instant, read from Effect's `Clock`, to the millisecond.
 *
 * **When to use**
 *
 * Use when the time this program sees is the one to store, and when a test
 * should control it through `TestClock`.
 *
 * **Details**
 *
 * This is the local clock, not the database's. Clients with skewed clocks
 * write different times for the same moment.
 *
 * @example Reading the current time
 * ```ts
 * import { Effect } from "effect";
 * import { Timestamp } from "@visiolab/effect-firebase/firestore";
 *
 * const program = Effect.gen(function* () {
 *   const now = yield* Timestamp.now;
 *   return Timestamp.toMillis(now);
 * });
 * ```
 *
 * @see {@link FieldValue.serverTimestamp} for the time the server applies the write
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const now: Effect.Effect<Timestamp> = timestamp.now;

/**
 * Converts a timestamp to milliseconds since the Unix epoch, dropping the
 * finer digits.
 *
 * @see {@link fromMillis} for the reverse conversion
 * @see {@link toDateTime} for converting to a `DateTime.Utc`
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const toMillis: (self: Timestamp) => number = timestamp.toMillis;

/**
 * Converts a timestamp to a `DateTime.Utc`, dropping the digits finer than a
 * millisecond.
 *
 * @see {@link fromDateTime} for the reverse conversion
 * @see {@link toMillis} for converting to milliseconds
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const toDateTime: (self: Timestamp) => DateTime.Utc = timestamp.toDateTime;

/**
 * Orders timestamps from earliest to latest, at full precision.
 *
 * @example Sorting timestamps
 * ```ts
 * import { Array } from "effect";
 * import { Timestamp } from "@visiolab/effect-firebase/firestore";
 *
 * const sorted = Array.sort(
 *   [Timestamp.makeUnsafe(2, 0), Timestamp.makeUnsafe(1, 500)],
 *   Timestamp.Order,
 * );
 * ```
 *
 * @stability unstable
 * @category ordering
 * @since 0.2.0
 */
export const Order: order.Order<Timestamp> = timestamp.Order;

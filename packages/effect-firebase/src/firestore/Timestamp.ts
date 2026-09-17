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
 * @since 0.0.0
 */
import {
  DateTime,
  Effect,
  Equal,
  Hash,
  Inspectable,
  Option,
  Order as order,
  Predicate,
} from "effect";

const TypeId = "~@visiolab/effect-firebase/firestore/Timestamp";

/** `0001-01-01T00:00:00Z`, the earliest instant Firestore addresses. */
const minSeconds = -62_135_596_800;
/** `9999-12-31T23:59:59Z`, the latest. */
const maxSeconds = 253_402_300_799;
const maxNanoseconds = 999_999_999;
const nanosecondsPerMillisecond = 1_000_000;

/**
 * The minimal shape of a Firestore timestamp, whoever built it.
 *
 * Both the Admin SDK and the web SDK hand back a `Timestamp` carrying these two
 * fields, so this is the shape a document arrives in whichever one read it.
 *
 * @category models
 * @since 0.0.0
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
 * @since 0.0.0
 */
export interface Timestamp extends TimestampLike, Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
}

/** Kept apart from the guards below, which narrow a `number` to `never`. */
const inSecondsRange = (n: number): boolean =>
  Number.isInteger(n) && n >= minSeconds && n <= maxSeconds;

const inNanosecondsRange = (n: number): boolean =>
  Number.isInteger(n) && n >= 0 && n <= maxNanoseconds;

/**
 * Whether `u` is a {@link Timestamp} this module built.
 *
 * @category guards
 * @since 0.0.0
 */
export const isTimestamp = (u: unknown): u is Timestamp => Predicate.hasProperty(u, TypeId);

/**
 * Whether `u` is shaped like a Firestore timestamp and holds an instant
 * Firestore can address.
 *
 * This is what makes a timestamp readable without depending on an SDK: an SDK's
 * own `Timestamp` passes, because it carries the same two fields.
 *
 * @category guards
 * @since 0.0.0
 */
export const isTimestampLike = (u: unknown): u is TimestampLike =>
  Predicate.hasProperty(u, "seconds") &&
  Predicate.hasProperty(u, "nanoseconds") &&
  Predicate.isNumber(u.seconds) &&
  Predicate.isNumber(u.nanoseconds) &&
  inSecondsRange(u.seconds) &&
  inNanosecondsRange(u.nanoseconds);

const Proto: Omit<Timestamp, keyof TimestampLike> = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: Timestamp) {
    return { _id: "Timestamp", seconds: this.seconds, nanoseconds: this.nanoseconds };
  },
  [Equal.symbol](this: Timestamp, that: unknown): boolean {
    return (
      isTimestamp(that) && this.seconds === that.seconds && this.nanoseconds === that.nanoseconds
    );
  },
  [Hash.symbol](this: Timestamp): number {
    return Hash.combine(Hash.number(this.seconds), Hash.number(this.nanoseconds));
  },
};

const makeUnchecked = (seconds: number, nanoseconds: number): Timestamp =>
  Object.assign(Object.create(Proto) as typeof Proto, { seconds, nanoseconds });

/**
 * Builds a timestamp from the two fields Firestore stores, throwing when they
 * do not describe an instant Firestore can address.
 *
 * @see {@link make} for the same check without the throw.
 *
 * @category constructors
 * @since 0.0.0
 */
export const makeUnsafe = (seconds: number, nanoseconds: number): Timestamp => {
  if (!inSecondsRange(seconds)) {
    throw new Error(
      `Invalid Firestore timestamp: seconds must be an integer between ${minSeconds} and ${maxSeconds}, got ${seconds}`,
    );
  }
  if (!inNanosecondsRange(nanoseconds)) {
    throw new Error(
      `Invalid Firestore timestamp: nanoseconds must be an integer between 0 and ${maxNanoseconds}, got ${nanoseconds}`,
    );
  }
  return makeUnchecked(seconds, nanoseconds);
};

/**
 * Builds a timestamp from the two fields Firestore stores, or `None` when they
 * do not describe an instant Firestore can address.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = (seconds: number, nanoseconds: number): Option.Option<Timestamp> =>
  inSecondsRange(seconds) && inNanosecondsRange(nanoseconds)
    ? Option.some(makeUnchecked(seconds, nanoseconds))
    : Option.none();

/** Splits milliseconds into the second and the fraction of it Firestore stores. */
const partsOfMillis = (millis: number): readonly [seconds: number, nanoseconds: number] => {
  const seconds = Math.floor(millis / 1000);
  return [seconds, Math.floor((millis - seconds * 1000) * nanosecondsPerMillisecond)];
};

/**
 * Builds a timestamp from milliseconds since the Unix epoch, throwing when they
 * fall outside the range Firestore addresses.
 *
 * @category constructors
 * @since 0.0.0
 */
export const fromMillisUnsafe = (millis: number): Timestamp => makeUnsafe(...partsOfMillis(millis));

/**
 * Builds a timestamp from milliseconds since the Unix epoch, or `None` when
 * they fall outside the range Firestore addresses.
 *
 * @category constructors
 * @since 0.0.0
 */
export const fromMillis = (millis: number): Option.Option<Timestamp> =>
  make(...partsOfMillis(millis));

/**
 * Builds a timestamp from a `DateTime.Utc`, which only carries milliseconds.
 *
 * Throws for the handful of instants a `DateTime` can hold and Firestore cannot,
 * which is to say those outside the years 1 to 9999.
 *
 * @category constructors
 * @since 0.0.0
 */
export const fromDateTimeUnsafe = (dateTime: DateTime.Utc): Timestamp =>
  fromMillisUnsafe(DateTime.toEpochMillis(dateTime));

/**
 * Builds a timestamp from a `DateTime.Utc`, or `None` for the handful of
 * instants a `DateTime` can hold and Firestore cannot.
 *
 * @category constructors
 * @since 0.0.0
 */
export const fromDateTime = (dateTime: DateTime.Utc): Option.Option<Timestamp> =>
  fromMillis(DateTime.toEpochMillis(dateTime));

/**
 * Takes over a timestamp read through an SDK, leaving one of ours alone.
 *
 * Throws when the fields fall outside the range Firestore addresses.
 *
 * @category constructors
 * @since 0.0.0
 */
export const fromTimestampLikeUnsafe = (like: TimestampLike): Timestamp =>
  isTimestamp(like) ? like : makeUnsafe(like.seconds, like.nanoseconds);

/**
 * The current instant, read from the `Clock`, to the millisecond it reports.
 *
 * This is the time here rather than the time at the database.
 *
 * @category constructors
 * @since 0.0.0
 */
export const now: Effect.Effect<Timestamp> = Effect.map(DateTime.now, fromDateTimeUnsafe);

/**
 * Milliseconds since the Unix epoch, dropping the finer digits.
 *
 * @category conversions
 * @since 0.0.0
 */
export const toMillis = (self: Timestamp): number =>
  self.seconds * 1000 + Math.floor(self.nanoseconds / nanosecondsPerMillisecond);

/**
 * The same instant as a `DateTime.Utc`, to the millisecond.
 *
 * @category conversions
 * @since 0.0.0
 */
export const toDateTime = (self: Timestamp): DateTime.Utc => DateTime.makeUnsafe(toMillis(self));

/**
 * Orders timestamps by when they happened, to the full precision they carry.
 *
 * @category ordering
 * @since 0.0.0
 */
export const Order: order.Order<TimestampLike> = order.make((self, that) =>
  self.seconds === that.seconds
    ? order.Number(self.nanoseconds, that.nanoseconds)
    : order.Number(self.seconds, that.seconds),
);

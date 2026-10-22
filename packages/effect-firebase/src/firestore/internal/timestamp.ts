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
import type * as Timestamp from "../Timestamp.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/Timestamp";

/** `0001-01-01T00:00:00Z`, the earliest instant Firestore addresses. */
const minSeconds = -62_135_596_800;
/** `9999-12-31T23:59:59Z`, the latest. */
const maxSeconds = 253_402_300_799;
const maxNanoseconds = 999_999_999;
const nanosecondsPerMillisecond = 1_000_000;

/** Kept apart from the guards below, which narrow a `number` to `never`. */
const inSecondsRange = (n: number): boolean =>
  Number.isInteger(n) && n >= minSeconds && n <= maxSeconds;

const inNanosecondsRange = (n: number): boolean =>
  Number.isInteger(n) && n >= 0 && n <= maxNanoseconds;

/** @internal */
export const isTimestamp = (u: unknown): u is Timestamp.Timestamp =>
  Predicate.hasProperty(u, TypeId) &&
  u[TypeId] === TypeId &&
  Predicate.hasProperty(u, "seconds") &&
  Predicate.hasProperty(u, "nanoseconds") &&
  Predicate.isNumber(u.seconds) &&
  Predicate.isNumber(u.nanoseconds) &&
  inSecondsRange(u.seconds) &&
  inNanosecondsRange(u.nanoseconds);

const Proto: Omit<Timestamp.Timestamp, "seconds" | "nanoseconds"> = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: Timestamp.Timestamp) {
    return { _id: "Timestamp", seconds: this.seconds, nanoseconds: this.nanoseconds };
  },
  [Equal.symbol](this: Timestamp.Timestamp, that: unknown): boolean {
    return (
      isTimestamp(that) && this.seconds === that.seconds && this.nanoseconds === that.nanoseconds
    );
  },
  [Hash.symbol](this: Timestamp.Timestamp): number {
    return Hash.combine(Hash.number(this.seconds), Hash.number(this.nanoseconds));
  },
};

const makeUnchecked = (seconds: number, nanoseconds: number): Timestamp.Timestamp =>
  Object.assign(Object.create(Proto) as typeof Proto, { seconds, nanoseconds });

/** @internal */
export const makeUnsafe = (seconds: number, nanoseconds: number): Timestamp.Timestamp => {
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

/** @internal */
export const make = (seconds: number, nanoseconds: number): Option.Option<Timestamp.Timestamp> =>
  inSecondsRange(seconds) && inNanosecondsRange(nanoseconds)
    ? Option.some(makeUnchecked(seconds, nanoseconds))
    : Option.none();

/** Splits milliseconds into the second and the fraction of it Firestore stores. */
const partsOfMillis = (millis: number): readonly [seconds: number, nanoseconds: number] => {
  const seconds = Math.floor(millis / 1000);
  return [seconds, Math.floor((millis - seconds * 1000) * nanosecondsPerMillisecond)];
};

/** @internal */
export const fromMillisUnsafe = (millis: number): Timestamp.Timestamp =>
  makeUnsafe(...partsOfMillis(millis));

/** @internal */
export const fromMillis = (millis: number): Option.Option<Timestamp.Timestamp> =>
  make(...partsOfMillis(millis));

/** @internal */
export const fromDateTimeUnsafe = (dateTime: DateTime.Utc): Timestamp.Timestamp =>
  fromMillisUnsafe(DateTime.toEpochMillis(dateTime));

/** @internal */
export const fromDateTime = (dateTime: DateTime.Utc): Option.Option<Timestamp.Timestamp> =>
  fromMillis(DateTime.toEpochMillis(dateTime));

/** @internal */
export const now: Effect.Effect<Timestamp.Timestamp> = Effect.map(DateTime.now, fromDateTimeUnsafe);

/** @internal */
export const toMillis = (self: Timestamp.Timestamp): number =>
  self.seconds * 1000 + Math.floor(self.nanoseconds / nanosecondsPerMillisecond);

/** @internal */
export const toDateTime = (self: Timestamp.Timestamp): DateTime.Utc =>
  DateTime.makeUnsafe(toMillis(self));

/** @internal */
export const Order: order.Order<Timestamp.Timestamp> = order.make((self, that) =>
  self.seconds === that.seconds
    ? order.Number(self.nanoseconds, that.nanoseconds)
    : order.Number(self.seconds, that.seconds),
);

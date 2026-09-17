import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Hash, HashSet, Option } from "effect";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

/** The shape an SDK hands back, which is not one of ours. */
const native = (seconds: number, nanoseconds: number): Timestamp.TimestampLike => ({
  seconds,
  nanoseconds,
});

describe("makeUnsafe", () => {
  it("carries the two fields Firestore stores", () => {
    const timestamp = Timestamp.makeUnsafe(1_700_000_000, 123_456_789);
    expect(timestamp.seconds).toBe(1_700_000_000);
    expect(timestamp.nanoseconds).toBe(123_456_789);
  });

  it("accepts the ends of the range Firestore addresses", () => {
    expect(Timestamp.makeUnsafe(-62_135_596_800, 0).seconds).toBe(-62_135_596_800);
    expect(Timestamp.makeUnsafe(253_402_300_799, 999_999_999).nanoseconds).toBe(999_999_999);
  });

  it("rejects instants Firestore cannot address", () => {
    expect(() => Timestamp.makeUnsafe(-62_135_596_801, 0)).toThrow("seconds must be an integer");
    expect(() => Timestamp.makeUnsafe(253_402_300_800, 0)).toThrow("seconds must be an integer");
    expect(() => Timestamp.makeUnsafe(1.5, 0)).toThrow("seconds must be an integer");
    expect(() => Timestamp.makeUnsafe(Number.NaN, 0)).toThrow("seconds must be an integer");
    expect(() => Timestamp.makeUnsafe(0, -1)).toThrow("nanoseconds must be an integer");
    expect(() => Timestamp.makeUnsafe(0, 1_000_000_000)).toThrow("nanoseconds must be an integer");
  });
});

describe("make", () => {
  it("builds the same timestamp without the throw", () => {
    const timestamp = Option.getOrThrow(Timestamp.make(1, 2));
    expect(Equal.equals(timestamp, Timestamp.makeUnsafe(1, 2))).toBe(true);
  });

  it("is None for an instant Firestore cannot address", () => {
    expect(Option.isNone(Timestamp.make(253_402_300_800, 0))).toBe(true);
    expect(Option.isNone(Timestamp.make(0, 1_000_000_000))).toBe(true);
    expect(Option.isNone(Timestamp.make(Number.NaN, 0))).toBe(true);
  });

  it("carries through the constructors built on it", () => {
    expect(Option.isNone(Timestamp.fromMillis(Number.NaN))).toBe(true);
    expect(Option.isSome(Timestamp.fromMillis(1_700_000_000_123))).toBe(true);
    expect(Option.isSome(Timestamp.fromDateTime(DateTime.makeUnsafe(0)))).toBe(true);
  });
});

describe("conversions", () => {
  it("round-trips milliseconds", () => {
    expect(Timestamp.toMillis(Timestamp.fromMillisUnsafe(1_700_000_000_123))).toBe(
      1_700_000_000_123,
    );
    expect(Timestamp.fromMillisUnsafe(1_700_000_000_123).nanoseconds).toBe(123_000_000);
  });

  it("splits an instant before the epoch into a negative second and a positive fraction", () => {
    const timestamp = Timestamp.fromMillisUnsafe(-1);
    expect(timestamp.seconds).toBe(-1);
    expect(timestamp.nanoseconds).toBe(999_000_000);
    expect(Timestamp.toMillis(timestamp)).toBe(-1);
  });

  it("drops the digits finer than a millisecond rather than rounding them", () => {
    expect(Timestamp.toMillis(Timestamp.makeUnsafe(1, 999_999_999))).toBe(1_999);
  });

  it("converts at both ends of the range without leaving what a number or a DateTime holds", () => {
    const min = Timestamp.makeUnsafe(-62_135_596_800, 0);
    const max = Timestamp.makeUnsafe(253_402_300_799, 999_999_999);
    for (const timestamp of [min, max]) {
      expect(Number.isSafeInteger(Timestamp.toMillis(timestamp))).toBe(true);
      expect(Math.abs(Timestamp.toMillis(timestamp))).toBeLessThan(8.64e15);
      expect(() => Timestamp.toDateTime(timestamp)).not.toThrow();
    }
  });

  it("round-trips a DateTime.Utc", () => {
    const dateTime = DateTime.makeUnsafe("2024-01-01T00:00:00.500Z");
    expect(Timestamp.toDateTime(Timestamp.fromDateTimeUnsafe(dateTime))).toStrictEqual(dateTime);
  });

  it("takes over a timestamp read through an SDK, leaving one of ours alone", () => {
    const taken = Timestamp.fromTimestampLikeUnsafe(native(1, 2));
    expect(Timestamp.isTimestamp(taken)).toBe(true);
    expect(taken.seconds).toBe(1);

    const ours = Timestamp.makeUnsafe(1, 2);
    expect(Timestamp.fromTimestampLikeUnsafe(ours)).toBe(ours);
  });

  it.effect("reads the current instant from the clock", () =>
    Effect.gen(function* () {
      const before = yield* DateTime.now;
      const timestamp = yield* Timestamp.now;
      expect(Timestamp.toMillis(timestamp)).toBeGreaterThanOrEqual(
        DateTime.toEpochMillis(before) - 1,
      );
      expect(timestamp.nanoseconds % 1_000_000).toBe(0);
    }),
  );
});

describe("guards", () => {
  it("tells ours apart from the shape alone", () => {
    expect(Timestamp.isTimestamp(Timestamp.makeUnsafe(0, 0))).toBe(true);
    expect(Timestamp.isTimestamp(native(0, 0))).toBe(false);
    expect(Timestamp.isTimestampLike(Timestamp.makeUnsafe(0, 0))).toBe(true);
    expect(Timestamp.isTimestampLike(native(0, 0))).toBe(true);
  });

  it("accepts an SDK timestamp, whose fields are getters on its prototype", () => {
    class SdkTimestamp {
      constructor(
        private readonly _seconds: number,
        private readonly _nanoseconds: number,
      ) {}
      get seconds() {
        return this._seconds;
      }
      get nanoseconds() {
        return this._nanoseconds;
      }
    }
    const sdk = new SdkTimestamp(1, 2);

    expect(Object.hasOwn(sdk, "seconds")).toBe(false);
    expect(Timestamp.isTimestampLike(sdk)).toBe(true);
    expect(Timestamp.toMillis(Timestamp.fromTimestampLikeUnsafe(sdk))).toBe(1_000);
  });

  it("rejects what Firestore would not have handed back", () => {
    expect(Timestamp.isTimestampLike(null)).toBe(false);
    expect(Timestamp.isTimestampLike({ seconds: 0 })).toBe(false);
    expect(Timestamp.isTimestampLike({ seconds: "0", nanoseconds: 0 })).toBe(false);
    expect(Timestamp.isTimestampLike(native(0, -1))).toBe(false);
    expect(Timestamp.isTimestampLike(native(0, 1_000_000_000))).toBe(false);
    expect(Timestamp.isTimestampLike(native(253_402_300_800, 0))).toBe(false);
    expect(Timestamp.isTimestampLike(DateTime.makeUnsafe(0))).toBe(false);
  });
});

describe("Order", () => {
  it("orders by when they happened, down to the nanosecond", () => {
    expect(Timestamp.Order(Timestamp.makeUnsafe(1, 0), Timestamp.makeUnsafe(2, 0))).toBe(-1);
    expect(Timestamp.Order(Timestamp.makeUnsafe(2, 0), Timestamp.makeUnsafe(1, 999_999_999))).toBe(
      1,
    );
    expect(Timestamp.Order(Timestamp.makeUnsafe(1, 1), Timestamp.makeUnsafe(1, 2))).toBe(-1);
    expect(Timestamp.Order(Timestamp.makeUnsafe(1, 1), Timestamp.makeUnsafe(1, 1))).toBe(0);
  });

  it("orders a timestamp read through an SDK alongside ours", () => {
    expect(Timestamp.Order(native(1, 0), Timestamp.makeUnsafe(2, 0))).toBe(-1);
  });
});

describe("equality", () => {
  it("compares the instant rather than the identity", () => {
    expect(Equal.equals(Timestamp.makeUnsafe(1, 2), Timestamp.makeUnsafe(1, 2))).toBe(true);
    expect(Equal.equals(Timestamp.makeUnsafe(1, 2), Timestamp.makeUnsafe(1, 3))).toBe(false);
  });

  it("hashes consistently with equality", () => {
    expect(Hash.hash(Timestamp.makeUnsafe(1, 2))).toBe(Hash.hash(Timestamp.makeUnsafe(1, 2)));
    expect(HashSet.size(HashSet.make(Timestamp.makeUnsafe(1, 2), Timestamp.makeUnsafe(1, 2)))).toBe(
      1,
    );
  });
});

describe("inspection", () => {
  it("prints the fields it holds", () => {
    expect(Timestamp.makeUnsafe(1, 2).toJSON()).toEqual({
      _id: "Timestamp",
      seconds: 1,
      nanoseconds: 2,
    });
    expect(Timestamp.makeUnsafe(1, 2).toString()).toContain("Timestamp");
  });
});

import { describe, expect, it } from "@effect/vitest";
import { Equal, Hash, HashSet, Option } from "effect";
import * as GeoPoint from "../../src/firestore/GeoPoint.ts";

/** The shape an SDK hands back, which is not one of ours. */
const native = (latitude: number, longitude: number) => ({ latitude, longitude });

describe("makeUnsafe", () => {
  it("carries the two fields Firestore stores", () => {
    const point = GeoPoint.makeUnsafe(52.52, 13.405);
    expect(point.latitude).toBe(52.52);
    expect(point.longitude).toBe(13.405);
  });

  it("accepts the ends of the range Firestore stores", () => {
    expect(GeoPoint.makeUnsafe(-90, -180).latitude).toBe(-90);
    expect(GeoPoint.makeUnsafe(90, 180).longitude).toBe(180);
  });

  it("rejects places Firestore cannot store", () => {
    expect(() => GeoPoint.makeUnsafe(90.1, 0)).toThrow("latitude must be a number");
    expect(() => GeoPoint.makeUnsafe(-90.1, 0)).toThrow("latitude must be a number");
    expect(() => GeoPoint.makeUnsafe(Number.NaN, 0)).toThrow("latitude must be a number");
    expect(() => GeoPoint.makeUnsafe(0, 180.1)).toThrow("longitude must be a number");
    expect(() => GeoPoint.makeUnsafe(0, -180.1)).toThrow("longitude must be a number");
    expect(() => GeoPoint.makeUnsafe(0, Number.POSITIVE_INFINITY)).toThrow(
      "longitude must be a number",
    );
  });
});

describe("make", () => {
  it("builds the same geopoint without the throw", () => {
    const point = Option.getOrThrow(GeoPoint.make(1, 2));
    expect(Equal.equals(point, GeoPoint.makeUnsafe(1, 2))).toBe(true);
  });

  it("is None for a place Firestore cannot store", () => {
    expect(Option.isNone(GeoPoint.make(91, 0))).toBe(true);
    expect(Option.isNone(GeoPoint.make(0, 181))).toBe(true);
    expect(Option.isNone(GeoPoint.make(Number.NaN, 0))).toBe(true);
  });
});

describe("guards", () => {
  it("tells ours apart from the shape alone", () => {
    expect(GeoPoint.isGeoPoint(GeoPoint.makeUnsafe(0, 0))).toBe(true);
    expect(GeoPoint.isGeoPoint(native(0, 0))).toBe(false);
  });
});

describe("equality", () => {
  it("compares the place rather than the identity", () => {
    expect(Equal.equals(GeoPoint.makeUnsafe(1, 2), GeoPoint.makeUnsafe(1, 2))).toBe(true);
    expect(Equal.equals(GeoPoint.makeUnsafe(1, 2), GeoPoint.makeUnsafe(2, 1))).toBe(false);
  });

  it("hashes consistently with equality", () => {
    expect(Hash.hash(GeoPoint.makeUnsafe(1, 2))).toBe(Hash.hash(GeoPoint.makeUnsafe(1, 2)));
    expect(HashSet.size(HashSet.make(GeoPoint.makeUnsafe(1, 2), GeoPoint.makeUnsafe(1, 2)))).toBe(
      1,
    );
  });
});

describe("inspection", () => {
  it("prints the fields it holds", () => {
    expect(GeoPoint.makeUnsafe(1, 2).toJSON()).toEqual({
      _id: "GeoPoint",
      latitude: 1,
      longitude: 2,
    });
    expect(GeoPoint.makeUnsafe(1, 2).toString()).toContain("GeoPoint");
  });
});

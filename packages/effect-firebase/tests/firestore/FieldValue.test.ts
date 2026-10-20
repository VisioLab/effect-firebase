import { describe, expect, it } from "@effect/vitest";
import { Equal, Hash, HashSet } from "effect";
import * as FieldValue from "../../src/firestore/FieldValue.ts";

describe("serverTimestamp", () => {
  it("is the one sentinel there is", () => {
    expect(FieldValue.isServerTimestamp(FieldValue.serverTimestamp)).toBe(true);
    expect(FieldValue.isServerTimestamp({})).toBe(false);
    expect(Equal.equals(FieldValue.serverTimestamp, FieldValue.serverTimestamp)).toBe(true);
  });

  it("says what it is when printed", () => {
    expect(FieldValue.serverTimestamp.toJSON()).toEqual({ _id: "ServerTimestamp" });
    expect(FieldValue.serverTimestamp.toString()).toContain("ServerTimestamp");
  });
});

describe("increment", () => {
  it("carries how far the field moves", () => {
    expect(FieldValue.increment(1).by).toBe(1);
    expect(FieldValue.increment(2.5).by).toBe(2.5);
    expect(FieldValue.increment(-3).by).toBe(-3);
  });

  it("rejects what Firestore would refuse to add", () => {
    expect(() => FieldValue.increment(Number.NaN)).toThrow("must be a finite number");
    expect(() => FieldValue.increment(Number.POSITIVE_INFINITY)).toThrow("must be a finite number");
    expect(() => FieldValue.decrement(Number.NEGATIVE_INFINITY)).toThrow("must be a finite number");
  });

  it("is told apart from the other sentinel", () => {
    expect(FieldValue.isIncrement(FieldValue.increment(1))).toBe(true);
    expect(FieldValue.isIncrement(FieldValue.serverTimestamp)).toBe(false);
    expect(FieldValue.isServerTimestamp(FieldValue.increment(1))).toBe(false);
    expect(FieldValue.isIncrement(1)).toBe(false);
  });

  it("is equal to another that moves the field as far", () => {
    expect(Equal.equals(FieldValue.increment(2), FieldValue.increment(2))).toBe(true);
    expect(Equal.equals(FieldValue.increment(2), FieldValue.increment(3))).toBe(false);
    expect(Equal.equals(FieldValue.increment(2), FieldValue.decrement(2))).toBe(false);
  });

  it("hashes by how far it moves", () => {
    expect(Hash.hash(FieldValue.increment(2))).toBe(Hash.hash(FieldValue.increment(2)));
    expect(HashSet.size(HashSet.make(FieldValue.increment(2), FieldValue.increment(2)))).toBe(1);
  });

  it("says what it is when printed", () => {
    expect(FieldValue.increment(2).toJSON()).toEqual({ _id: "Increment", by: 2 });
    expect(FieldValue.increment(2).toString()).toContain("Increment");
  });
});

describe("decrement", () => {
  it("is an increment of the negation, since Firestore has the one sentinel", () => {
    expect(FieldValue.decrement(2).by).toBe(-2);
    expect(Equal.equals(FieldValue.decrement(2), FieldValue.increment(-2))).toBe(true);
  });
});

describe("deleteField", () => {
  it("is the one sentinel there is", () => {
    expect(FieldValue.isDeleteField(FieldValue.deleteField)).toBe(true);
    expect(FieldValue.isDeleteField({})).toBe(false);
    expect(Equal.equals(FieldValue.deleteField, FieldValue.deleteField)).toBe(true);
  });

  it("is told apart from the other sentinels", () => {
    expect(FieldValue.isDeleteField(FieldValue.serverTimestamp)).toBe(false);
    expect(FieldValue.isDeleteField(FieldValue.increment(1))).toBe(false);
    expect(FieldValue.isServerTimestamp(FieldValue.deleteField)).toBe(false);
    expect(FieldValue.isIncrement(FieldValue.deleteField)).toBe(false);
  });

  it("says what it is when printed", () => {
    expect(FieldValue.deleteField.toJSON()).toEqual({ _id: "DeleteField" });
    expect(FieldValue.deleteField.toString()).toContain("DeleteField");
  });
});

describe("arrayUnion", () => {
  it("carries the elements the array is to gain, in order", () => {
    expect(FieldValue.arrayUnion("a", "b").elements).toEqual(["a", "b"]);
    expect(FieldValue.arrayUnion().elements).toEqual([]);
  });

  it("is told apart from the other sentinels", () => {
    expect(FieldValue.isArrayUnion(FieldValue.arrayUnion("a"))).toBe(true);
    expect(FieldValue.isArrayUnion(FieldValue.arrayRemove("a"))).toBe(false);
    expect(FieldValue.isArrayUnion(FieldValue.deleteField)).toBe(false);
    expect(FieldValue.isArrayUnion(["a"])).toBe(false);
    expect(FieldValue.isArrayRemove(FieldValue.arrayUnion("a"))).toBe(false);
    expect(FieldValue.isIncrement(FieldValue.arrayUnion("a"))).toBe(false);
  });

  it("says what it is when printed", () => {
    expect(FieldValue.arrayUnion("a").toJSON()).toEqual({ _id: "ArrayUnion", elements: ["a"] });
    expect(FieldValue.arrayUnion("a").toString()).toContain("ArrayUnion");
  });
});

describe("arrayRemove", () => {
  it("carries the elements the array is to lose", () => {
    expect(FieldValue.arrayRemove(1, 2).elements).toEqual([1, 2]);
  });

  it("is told apart from the other sentinels", () => {
    expect(FieldValue.isArrayRemove(FieldValue.arrayRemove("a"))).toBe(true);
    expect(FieldValue.isArrayRemove(FieldValue.serverTimestamp)).toBe(false);
    expect(FieldValue.isArrayRemove(["a"])).toBe(false);
  });

  it("says what it is when printed", () => {
    expect(FieldValue.arrayRemove("a").toJSON()).toEqual({ _id: "ArrayRemove", elements: ["a"] });
    expect(FieldValue.arrayRemove("a").toString()).toContain("ArrayRemove");
  });
});

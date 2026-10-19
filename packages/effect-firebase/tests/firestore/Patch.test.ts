import { describe, expect, it } from "@effect/vitest";
import * as Patch from "../../src/firestore/Patch.ts";

describe("replace", () => {
  it("carries the value the group is written as", () => {
    const value = { city: "Berlin" };
    expect(Patch.replace(value).value).toBe(value);
  });

  it("is told apart from a plain value", () => {
    expect(Patch.isReplace(Patch.replace({}))).toBe(true);
    expect(Patch.isReplace({ value: {} })).toBe(false);
  });

  it("says what it is when printed", () => {
    expect(Patch.replace({ city: "Berlin" }).toJSON()).toStrictEqual({
      _id: "Replace",
      value: { city: "Berlin" },
    });
  });
});

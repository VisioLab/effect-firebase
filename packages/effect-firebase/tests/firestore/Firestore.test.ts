import { describe, expect, it } from "@effect/vitest";
import * as Firestore from "../../src/firestore/Firestore.ts";

describe("FirestoreError", () => {
  it("carries what went wrong, and the code where there was one", () => {
    const error = new Firestore.FirestoreError({ message: "Failed to read", code: "unavailable" });
    expect(error._tag).toBe("FirestoreError");
    expect(error.message).toBe("Failed to read");
    expect(error.code).toBe("unavailable");
  });
});

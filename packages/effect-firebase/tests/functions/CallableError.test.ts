import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Callable from "../../src/functions/Callable.ts";
import * as CallableError from "../../src/functions/CallableError.ts";

describe("built-in errors", () => {
  it("each carries its documented code", () => {
    expect(Callable.getErrorCode(CallableError.NotFound)).toBe("not-found");
    expect(Callable.getErrorCode(CallableError.PermissionDenied)).toBe("permission-denied");
    expect(Callable.getErrorCode(CallableError.Unauthenticated)).toBe("unauthenticated");
    expect(Callable.getErrorCode(CallableError.InvalidArgument)).toBe("invalid-argument");
    expect(Callable.getErrorCode(CallableError.AlreadyExists)).toBe("already-exists");
    expect(Callable.getErrorCode(CallableError.FailedPrecondition)).toBe("failed-precondition");
    expect(Callable.getErrorCode(CallableError.ResourceExhausted)).toBe("resource-exhausted");
    expect(Callable.getErrorCode(CallableError.Unavailable)).toBe("unavailable");
  });

  it("take an optional message", () => {
    expect(new CallableError.NotFound().message).toBe("");
    expect(new CallableError.NotFound({ message: "No such user" }).message).toBe("No such user");
  });
});

describe("Callable.errorCode", () => {
  class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}

  it("sets the code of an error schema", () => {
    expect(Callable.getErrorCode(Missing.pipe(Callable.errorCode("not-found")))).toBe("not-found");
  });

  it("defaults to internal", () => {
    expect(Callable.getErrorCode(Missing)).toBe("internal");
  });

  it("is read from a TaggedError's own annotations", () => {
    class Taken extends Schema.TaggedError<Taken>()(
      "Taken",
      {},
      { callableErrorCode: "already-exists" },
    ) {}
    expect(Callable.getErrorCode(Taken)).toBe("already-exists");
  });
});

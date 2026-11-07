import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as App from "../../src/app/App.ts";
import * as CallableClient from "../../src/functions/CallableClient.ts";
import * as ClientFunctions from "../../src/functions/ClientFunctions.ts";
import {
  Banned,
  Fail,
  Greet,
  NameTaken,
  Unexplained,
} from "../../../functions/tests/fixture/src/contract.ts";
import { FunctionsError } from "firebase/functions";
import { emulator } from "./emulator.ts";

// The project the emulator serves the fixture under. A named app keeps this
// suite apart from the others in the package.
const AppLive = App.layer({ projectId: "demo-effect-firebase" }, "callable-client");
const FunctionsLive = ClientFunctions.layer({ emulator }).pipe(Layer.provide(AppLive));

/** The `CallableError` reason a call to `fail` ends with. */
const reasonOf = <A, E>(effect: Effect.Effect<A, E | CallableError.CallableError>) =>
  Effect.flip(effect).pipe(
    Effect.map((error) => (error instanceof CallableError.CallableError ? error.reason : error)),
  );

describe("CallableClient", () => {
  it.effect("calls a Callable in no group and decodes what it answers", () =>
    Effect.gen(function* () {
      const { greet } = yield* CallableClient.make(Greet);
      const result = yield* greet({ name: "Ada", at: new Date("2026-01-01T12:00:00.000Z") });
      expect(result).toEqual({
        message: "Hello, Ada!",
        nextDay: new Date("2026-01-02T12:00:00.000Z"),
      });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("decodes a declared error whose code its annotations set into its class", () =>
    Effect.gen(function* () {
      const { fail } = yield* CallableClient.make(Fail);
      const caught = yield* fail({ with: "NameTaken" }).pipe(
        Effect.as(undefined),
        Effect.catchTag("NameTaken", (error) => Effect.succeed(error)),
      );
      expect(caught).toBeInstanceOf(NameTaken);
      expect(caught).toMatchObject({
        username: "Ada",
        since: new Date("2026-01-01T12:00:00.000Z"),
      });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("decodes a declared error whose code Callable.errorCode set into its class", () =>
    Effect.gen(function* () {
      const { fail } = yield* CallableClient.make(Fail);
      const caught = yield* fail({ with: "Banned" }).pipe(
        Effect.as(undefined),
        Effect.catchTag("Banned", (error) => Effect.succeed(error)),
      );
      expect(caught).toBeInstanceOf(Banned);
      expect(caught?.message).toBe("Ada is banned");
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("decodes a declared error without a code, sent as internal, into its class", () =>
    Effect.gen(function* () {
      const { fail } = yield* CallableClient.make(Fail);
      const caught = yield* fail({ with: "Unexplained" }).pipe(
        Effect.as(undefined),
        Effect.catchTag("Unexplained", (error) => Effect.succeed(error)),
      );
      expect(caught).toBeInstanceOf(Unexplained);
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("decodes a built-in error into its class", () =>
    Effect.gen(function* () {
      const { fail } = yield* CallableClient.make(Fail);
      const caught = yield* fail({ with: "NotFound" }).pipe(
        Effect.as(undefined),
        Effect.catchTag("NotFound", (error) => Effect.succeed(error)),
      );
      expect(caught).toBeInstanceOf(CallableError.NotFound);
      expect(caught?.message).toBe("No such user");
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("fails with a ResponseError of code internal and no details on a defect", () =>
    Effect.gen(function* () {
      const { fail } = yield* CallableClient.make(Fail);
      const reason = yield* reasonOf(fail({ with: "defect" }));
      expect(reason).toBeInstanceOf(CallableError.ResponseError);
      expect(reason).toMatchObject({ code: "internal", message: "INTERNAL", details: undefined });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("fails with a ResponseError of code unavailable when the handler is interrupted", () =>
    Effect.gen(function* () {
      const { fail } = yield* CallableClient.make(Fail);
      const reason = yield* reasonOf(fail({ with: "interrupt" }));
      expect(reason).toMatchObject({ _tag: "ResponseError", code: "unavailable" });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("fails with a DecodeError when the details don't match the declared error", () =>
    Effect.gen(function* () {
      // The client's contract has drifted from the server's: same tag and
      // code, different fields.
      class SkewedNameTaken extends Schema.TaggedError<
        SkewedNameTaken,
        { readonly brand: unique symbol }
      >()("NameTaken", { username: Schema.Finite }, { callableErrorCode: "already-exists" }) {}
      const SkewedFail = Callable.make("fail", {
        payload: Fail.payload,
        error: SkewedNameTaken,
      });
      const { fail } = yield* CallableClient.make(SkewedFail);
      const reason = yield* reasonOf(fail({ with: "NameTaken" }));
      expect(reason).toBeInstanceOf(CallableError.DecodeError);
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("fails with a ResponseError for a code no declared error carries", () =>
    Effect.gen(function* () {
      const Undeclared = Callable.make("fail", { payload: Fail.payload });
      const { fail } = yield* CallableClient.make(Undeclared);
      const reason = yield* reasonOf(fail({ with: "NameTaken" }));
      expect(reason).toMatchObject({
        _tag: "ResponseError",
        code: "already-exists",
        message: "NameTaken",
        details: { _tag: "NameTaken", username: "Ada", since: "2026-01-01T12:00:00.000Z" },
      });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("fails with a TransportError when no response arrives", () =>
    Effect.gen(function* () {
      const { greet } = yield* CallableClient.make(Greet);
      const reason = yield* reasonOf(greet({ name: "Ada", at: new Date() }));
      expect(reason).toBeInstanceOf(CallableError.TransportError);
      // The client tells a network failure from a server's `internal` only by
      // the HTTP status 0 the SDK appends to the message. This pins that, so a
      // change in the SDK fails here.
      const { cause } = reason as CallableError.TransportError;
      expect(cause).toBeInstanceOf(FunctionsError);
      expect(cause).toMatchObject({
        code: "functions/internal",
        message: expect.stringMatching(/ \[0\]$/),
      });
    }).pipe(
      // Nothing listens on port 1.
      Effect.provide(
        ClientFunctions.layer({ emulator: { host: "127.0.0.1", port: 1 } }).pipe(
          Layer.provide(App.layer({ projectId: "demo-effect-firebase" }, "callable-transport")),
        ),
      ),
    ),
  );
});

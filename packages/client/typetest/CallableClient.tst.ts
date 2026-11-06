import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as CallableClient from "@visiolab/effect-firebase-client/functions/CallableClient";
import type * as ClientFunctions from "@visiolab/effect-firebase-client/functions/ClientFunctions";
import { Effect, Schema } from "effect";
import { describe, expect, test } from "tstyche";

const Greet = Callable.make("greet", {
  payload: { name: Schema.String, at: Schema.Date },
  success: Schema.Struct({ message: Schema.String }),
});
const Ping = Callable.make("ping");

describe("CallableClient.make", () => {
  test("needs ClientFunctions and never fails", () => {
    expect(CallableClient.make(Greet)).type.toBe<
      Effect.Effect<CallableClient.Client<typeof Greet>, never, ClientFunctions.ClientFunctions>
    >();
  });

  test("is a record keyed by the Callable's name", () => {
    expect<keyof CallableClient.Client<typeof Greet>>().type.toBe<"greet">();
  });

  test("types the Payload, the success value and the error", () => {
    expect<CallableClient.Client<typeof Greet>["greet"]>().type.toBe<
      (payload: {
        readonly name: string;
        readonly at: Date;
      }) => Effect.Effect<{ readonly message: string }, CallableError.CallableError>
    >();
  });

  test("fails with exactly the declared errors or a CallableError", () => {
    const Get = Callable.make("get", {
      payload: { id: Schema.String },
      error: [CallableError.NotFound, CallableError.PermissionDenied],
    });
    expect<ReturnType<CallableClient.Client<typeof Get>["get"]>>().type.toBe<
      Effect.Effect<
        void,
        CallableError.NotFound | CallableError.PermissionDenied | CallableError.CallableError
      >
    >();
  });

  test("a Callable without a Payload is called with no argument", () => {
    void Effect.gen(function* () {
      const { ping } = yield* CallableClient.make(Ping);
      expect(ping()).type.toBe<Effect.Effect<void, CallableError.CallableError>>();
    });
  });

  test("a wrong Payload type is a type error", () => {
    void Effect.gen(function* () {
      const { greet } = yield* CallableClient.make(Greet);
      // @ts-expect-error Type 'string' is not assignable to type 'Date'
      void greet({ name: "Ada", at: "2026-01-01" });
    });
  });
});

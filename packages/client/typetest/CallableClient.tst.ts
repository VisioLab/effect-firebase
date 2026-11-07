import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as CallableMiddleware from "@visiolab/effect-firebase/functions/CallableMiddleware";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";
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

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });

class Users extends CallableGroup.make("users").add(CreateUser, DeleteUser) {}

describe("CallableClient.make with a group", () => {
  test("needs ClientFunctions and never fails", () => {
    expect(CallableClient.make(Users)).type.toBe<
      Effect.Effect<CallableClient.Client<typeof Users>, never, ClientFunctions.ClientFunctions>
    >();
  });

  test("is a record keyed by the members' names", () => {
    expect<keyof CallableClient.Client<typeof Users>>().type.toBe<"create" | "delete">();
  });

  test("types each member by its own contract", () => {
    expect<CallableClient.Client<typeof Users>["create"]>().type.toBe<
      (payload: { readonly name: string }) => Effect.Effect<string, CallableError.CallableError>
    >();
    expect<CallableClient.Client<typeof Users>["delete"]>().type.toBe<
      (payload: { readonly id: string }) => Effect.Effect<void, CallableError.CallableError>
    >();
  });
});

describe("CallableClient.make with middleware", () => {
  test("fails with the middleware's errors too", () => {
    const WhoAmI = Callable.make("whoAmI", {
      success: Schema.String,
      error: CallableError.NotFound,
    }).middleware(Caller.Authenticated);
    expect<ReturnType<CallableClient.Client<typeof WhoAmI>["whoAmI"]>>().type.toBe<
      Effect.Effect<
        string,
        CallableError.NotFound | CallableError.Unauthenticated | CallableError.CallableError
      >
    >();
  });

  test("fails with the group middleware's errors too, for every member", () => {
    class Admin extends CallableMiddleware.Service<Admin>()("test/Admin", {
      error: CallableError.PermissionDenied,
    }) {}
    const Purge = Callable.make("purge", { error: CallableError.NotFound }).middleware(Admin);
    class Admins extends CallableGroup.make("admins")
      .add(Purge)
      .middleware(Caller.Authenticated)
      .add(CreateUser) {}
    expect<ReturnType<CallableClient.Client<typeof Admins>["purge"]>>().type.toBe<
      Effect.Effect<
        void,
        | CallableError.NotFound
        | CallableError.PermissionDenied
        | CallableError.Unauthenticated
        | CallableError.CallableError
      >
    >();
    expect<ReturnType<CallableClient.Client<typeof Admins>["create"]>>().type.toBe<
      Effect.Effect<string, CallableError.Unauthenticated | CallableError.CallableError>
    >();
  });
});

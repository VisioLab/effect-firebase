// The tests pass Layers with requirements left on purpose, to check they are
// type errors; the language service would flag each of them a second time.
// @effect-diagnostics missing-layer-context:off
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import * as CallableFunction from "@visiolab/effect-firebase-functions/https/CallableFunction";
import { Context, Effect, Layer, Schema } from "effect";
import { describe, expect, test } from "tstyche";

const Greet = Callable.make("greet", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const Ping = Callable.make("ping");

const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
const PingLive = Callable.toLayer(Ping, () => Effect.void);

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<Date> }>()("test/Clock") {}

describe("CallableFunction.make", () => {
  test("exports one Callable Function under the Callable's name", () => {
    const exports = CallableFunction.make(Greet, GreetLive);
    expect(exports).type.toBe<{ readonly greet: CallableFunction.Export }>();
  });

  test("a typo in the destructured export is a type error", () => {
    // @ts-expect-error Property 'gret' does not exist
    const { gret } = CallableFunction.make(Greet, GreetLive);
    void gret;
  });

  test("a Live without the Callable's handler is a type error", () => {
    // @ts-expect-error not assignable
    CallableFunction.make(Greet, PingLive);
  });

  test("a Live that leaves a requirement is a type error", () => {
    const NeedsClock = Callable.toLayer(Greet, ({ name }) =>
      Effect.map(Effect.service(Clock), () => name),
    );
    // @ts-expect-error not assignable
    CallableFunction.make(Greet, NeedsClock);
  });

  test("a Live that provides more is accepted", () => {
    expect(CallableFunction.make(Greet, Layer.merge(GreetLive, PingLive))).type.toBe<{
      readonly greet: CallableFunction.Export;
    }>();
  });
});

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const GetUser = Callable.make("get", { payload: { id: Schema.String }, success: Schema.String });

class Users extends CallableGroup.make("users").add(CreateUser, GetUser) {}
class Orders extends CallableGroup.make("orders").add(GetUser) {}

const UsersLive = Layer.mergeAll(
  Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
  Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id)),
);

describe("CallableFunction.group", () => {
  test("exports the members under the group's name", () => {
    expect(CallableFunction.group(Users, UsersLive)).type.toBe<{
      readonly users: {
        readonly create: CallableFunction.Export;
        readonly get: CallableFunction.Export;
      };
    }>();
  });

  test("a typo in the destructured export is a type error", () => {
    // @ts-expect-error Property 'user' does not exist
    const { user } = CallableFunction.group(Users, UsersLive);
    void user;
  });

  test("takes options per member, by name", () => {
    CallableFunction.group(Users, UsersLive, { get: { region: "europe-west1" } });
    // @ts-expect-error Object literal may only specify known properties
    CallableFunction.group(Users, UsersLive, { update: { region: "europe-west1" } });
  });

  test("a Live without a member's handler is a type error", () => {
    const GetOnly = Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id));
    // @ts-expect-error not assignable
    CallableFunction.group(Users, GetOnly);
  });

  test("the handler of the standalone Callable doesn't serve the member", () => {
    const Live = Layer.mergeAll(
      Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
      Callable.toLayer(GetUser, ({ id }) => Effect.succeed(id)),
    );
    // @ts-expect-error not assignable
    CallableFunction.group(Users, Live);
  });

  test("the handler of users.get doesn't serve orders.get", () => {
    // @ts-expect-error not assignable
    CallableFunction.group(Orders, UsersLive);
  });

  test("a Live with the handlers of each group serves both", () => {
    const OrdersLive = Callable.toLayer(Orders, "get", ({ id }) => Effect.succeed(id));
    expect(CallableFunction.group(Orders, Layer.merge(UsersLive, OrdersLive))).type.toBe<{
      readonly orders: { readonly get: CallableFunction.Export };
    }>();
  });
});

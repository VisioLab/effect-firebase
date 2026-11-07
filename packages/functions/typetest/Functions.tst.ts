// The tests pass Layers with requirements left on purpose, to check they are
// type errors; the language service would flag each of them a second time.
// @effect-diagnostics missingLayerContext:off
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import * as CallableMiddleware from "@visiolab/effect-firebase/functions/CallableMiddleware";
import * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";
import * as Functions from "@visiolab/effect-firebase-functions/Functions";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { describe, expect, test } from "tstyche";

const Greet = Callable.make("greet", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const Ping = Callable.make("ping");

const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
const PingLive = Callable.toLayer(Ping, () => Effect.void);

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<Date> }>()("test/Clock") {}

describe("Functions.make", () => {
  test("exports one Callable Function under the Callable's name", () => {
    const exports = Functions.make(Greet, GreetLive);
    expect(exports).type.toBe<{ readonly greet: Functions.CallableExport }>();
  });

  test("a typo in the destructured export is a type error", () => {
    // @ts-expect-error Property 'gret' does not exist
    const { gret } = Functions.make(Greet, GreetLive);
    void gret;
  });

  test("a Live without the Callable's handler is a type error", () => {
    // @ts-expect-error not assignable
    Functions.make(Greet, PingLive);
  });

  test("a Live that leaves a requirement is a type error", () => {
    const NeedsClock = Callable.toLayer(Greet, ({ name }) =>
      Effect.map(Effect.service(Clock), () => name),
    );
    // @ts-expect-error not assignable
    Functions.make(Greet, NeedsClock);
  });

  test("a Live that provides more is accepted", () => {
    expect(Functions.make(Greet, Layer.merge(GreetLive, PingLive))).type.toBe<{
      readonly greet: Functions.CallableExport;
    }>();
  });
});

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const GetUser = Callable.make("get", { payload: { id: Schema.String }, success: Schema.String });

class Users extends FunctionGroup.make("users").add(CreateUser, GetUser) {}
class Orders extends FunctionGroup.make("orders").add(GetUser) {}

const UsersLive = Layer.mergeAll(
  Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
  Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id)),
);

describe("Functions.group", () => {
  test("exports the members under the group's name", () => {
    expect(Functions.group(Users, UsersLive)).type.toBe<{
      readonly users: {
        readonly create: Functions.CallableExport;
        readonly get: Functions.CallableExport;
      };
    }>();
  });

  test("a typo in the destructured export is a type error", () => {
    // @ts-expect-error Property 'user' does not exist
    const { user } = Functions.group(Users, UsersLive);
    void user;
  });

  test("takes options per member, by name", () => {
    Functions.group(Users, UsersLive, { get: { region: "europe-west1" } });
    // @ts-expect-error Object literal may only specify known properties
    Functions.group(Users, UsersLive, { update: { region: "europe-west1" } });
  });

  test("a Live without a member's handler is a type error", () => {
    const GetOnly = Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id));
    // @ts-expect-error not assignable
    Functions.group(Users, GetOnly);
  });

  test("the handler of the standalone Callable doesn't serve the member", () => {
    const Live = Layer.mergeAll(
      Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
      Callable.toLayer(GetUser, ({ id }) => Effect.succeed(id)),
    );
    // @ts-expect-error not assignable
    Functions.group(Users, Live);
  });

  test("the handler of users.get doesn't serve orders.get", () => {
    // @ts-expect-error not assignable
    Functions.group(Orders, UsersLive);
  });

  test("a Live with the handlers of each group serves both", () => {
    const OrdersLive = Callable.toLayer(Orders, "get", ({ id }) => Effect.succeed(id));
    expect(Functions.group(Orders, Layer.merge(UsersLive, OrdersLive))).type.toBe<{
      readonly orders: { readonly get: Functions.CallableExport };
    }>();
  });
});

const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(Caller.Authenticated);
const WhoAmILive = Callable.toLayer(WhoAmI, () =>
  Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
);

describe("Functions.make with middleware", () => {
  test("a Live with the handler and every middleware implementation is accepted", () => {
    expect(Functions.make(WhoAmI, Layer.merge(WhoAmILive, Caller.Authenticated.layer))).type.toBe<{
      readonly whoAmI: Functions.CallableExport;
    }>();
  });

  test("a Live without a middleware implementation is a type error", () => {
    // @ts-expect-error not assignable
    Functions.make(WhoAmI, WhoAmILive);
  });
});

class Signed extends FunctionGroup.make("signed").add(
  GetUser,
  CreateUser.middleware(Caller.Authenticated),
) {}

const SignedLive = Layer.mergeAll(
  Callable.toLayer(Signed, "create", () =>
    Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
  ),
  Callable.toLayer(Signed, "get", ({ id }) => Effect.succeed(id)),
);

describe("Functions.group with a member's middleware", () => {
  test("a Live with the handlers and the member's middleware implementation is accepted", () => {
    expect(Functions.group(Signed, Layer.merge(SignedLive, Caller.Authenticated.layer))).type.toBe<{
      readonly signed: {
        readonly create: Functions.CallableExport;
        readonly get: Functions.CallableExport;
      };
    }>();
  });

  test("a Live without the member's middleware implementation is a type error", () => {
    // @ts-expect-error not assignable
    Functions.group(Signed, SignedLive);
  });
});

class ReadsRequest extends CallableMiddleware.Service<ReadsRequest>()("test/ReadsRequest") {}

const ReadsRequestLive = Layer.succeed(ReadsRequest, (effect) =>
  Effect.andThen(
    Effect.map(Effect.service(CallableRequest.CallableRequest), ({ rawRequest }) =>
      Option.getOrNull(rawRequest.remoteAddress),
    ),
    effect,
  ),
);

const userAgent = Effect.map(Effect.service(CallableRequest.CallableRequest), ({ rawRequest }) =>
  String(rawRequest.headers["user-agent"]),
);

const Audited = Callable.make("audited").middleware(ReadsRequest);
const AuditedLive = Callable.toLayer(Audited, () => Effect.void);

const UserAgent = Callable.make("userAgent", { success: Schema.String });
const UserAgentLive = Callable.toLayer(UserAgent, () => userAgent);

class Reading extends FunctionGroup.make("reading").add(UserAgent.middleware(ReadsRequest)) {}
const ReadingLive = Callable.toLayer(Reading, "userAgent", () => userAgent);

describe("CallableRequest.rawRequest, provided per call", () => {
  test("a middleware that reads it needs no Live to provide it", () => {
    expect(Functions.make(Audited, Layer.merge(AuditedLive, ReadsRequestLive))).type.toBe<{
      readonly audited: Functions.CallableExport;
    }>();
  });

  test("a handler that reads it needs no Live to provide it", () => {
    expect(Functions.make(UserAgent, UserAgentLive)).type.toBe<{
      readonly userAgent: Functions.CallableExport;
    }>();
  });

  test("a group member's handler and middleware that read it need no Live to provide it", () => {
    expect(Functions.group(Reading, Layer.merge(ReadingLive, ReadsRequestLive))).type.toBe<{
      readonly reading: { readonly userAgent: Functions.CallableExport };
    }>();
  });

  test("another requirement next to it is still a type error", () => {
    const NeedsClock = Callable.toLayer(UserAgent, () =>
      Effect.andThen(Effect.service(Clock), userAgent),
    );
    // @ts-expect-error not assignable
    Functions.make(UserAgent, NeedsClock);
  });
});

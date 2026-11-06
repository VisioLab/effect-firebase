// PROTOTYPE, throwaway. Type-level checks: each @ts-expect-error must fire.
import { Effect, Layer, Schema } from "effect";
import * as Callable from "./core.ts";
import * as CallableClient from "./client.ts";
import * as CallableFunction from "./server.ts";
import { CreateUser, GetUser, Slow, Users } from "./contract.ts";

declare const users: Effect.Success<ReturnType<typeof CallableClient.make<"users", (typeof Users)["callables"][number]>>>;
export const created = users.create({ name: "x", birthday: new Date() });
//           ^? Effect<User, NameTaken | Unauthenticated | CallableError>
export const _c: Effect.Effect<unknown, Callable.NotFound | Callable.Unauthenticated | Callable.CallableError> = users.get({ id: "x" });
// @ts-expect-error Unauthenticated (from the middleware) is part of the error type
const _d: Effect.Effect<unknown, Callable.NotFound | Callable.CallableError> = users.get({ id: "x" });
// @ts-expect-error birthday must be a Date
users.create({ name: "x", birthday: "1815" });

// Handler Layer: requires Authenticated (the middleware impl), not Caller.
const live = Callable.toLayer(GetUser, () => Effect.gen(function* () { yield* Callable.Caller; return yield* Effect.die("x"); }));
export const _l: Layer.Layer<Callable.Handler<"get">, never, Callable.Authenticated> = live;

// @ts-expect-error a handler failing with an undeclared error
Callable.toLayer(Slow, () => Effect.fail(new Callable.NotFound({})));

// Missing handler for `slow` in Live.
const partial = Layer.mergeAll(
  Callable.toLayer(CreateUser, () => Effect.die("x")),
  Callable.toLayer(GetUser, () => Effect.die("x")),
);
// @ts-expect-error Live lacks the slow handler
CallableFunction.group(Users, partial);

// @ts-expect-error typo in the destructured export
export const { userz } = CallableFunction.group(Users, Layer.mergeAll(partial, Callable.toLayer(Slow, () => Effect.succeed(1))));

// Group-level .middleware() makes new Callable values: the exported CreateUser
// is not the one inside Users, so its handler Layer leaks Caller.
const createLive = Callable.toLayer(CreateUser, () =>
  Effect.gen(function* () {
    yield* Callable.Caller;
    return yield* Effect.die("x");
  }),
);
export const _leak: Layer.Layer<Callable.Handler<"create">, never, Callable.Caller> = createLive;
// (The prototype's middleware instance type is `{}`, so Caller vs Authenticated
// can't be told apart structurally here; the line above shows R is Caller.)
// Two Callables named "get" share one handler type:
const OrdersGet = Callable.make("get", { payload: { orderId: Schema.String } });
export const _collide: Layer.Layer<Callable.Handler<"get">, never, never> = Callable.toLayer(OrdersGet, () => Effect.void);

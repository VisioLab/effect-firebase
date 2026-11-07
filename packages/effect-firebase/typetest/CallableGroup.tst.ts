import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import * as CallableMiddleware from "@visiolab/effect-firebase/functions/CallableMiddleware";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";
import { Effect, type Layer, Schema } from "effect";
import { describe, expect, test } from "tstyche";

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });
const GetUser = Callable.make("get", { payload: { id: Schema.String }, success: Schema.String });

class Users extends CallableGroup.make("users").add(CreateUser, DeleteUser, GetUser) {}
class Orders extends CallableGroup.make("orders").add(GetUser) {}

describe("CallableGroup.make", () => {
  test("keeps the identifier as a literal type", () => {
    expect(Users.identifier).type.toBe<"users">();
  });

  test("collects the members added", () => {
    expect<CallableGroup.Callables<typeof Users>>().type.toBe<
      typeof CreateUser | typeof DeleteUser | typeof GetUser
    >();
    expect<CallableGroup.Names<typeof Users>>().type.toBe<"create" | "delete" | "get">();
  });

  test("adding to a class adds to the group", () => {
    const More = Orders.add(CreateUser);
    expect<CallableGroup.Names<typeof More>>().type.toBe<"get" | "create">();
  });

  test("a group can't be added to a group", () => {
    // @ts-expect-error not assignable
    CallableGroup.make("all").add(Users);
  });
});

describe("Callable.toLayer with a group", () => {
  test("provides the handler of the member, keyed by the group", () => {
    const layer = Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name));
    expect(layer).type.toBe<Layer.Layer<Callable.Handler<"users", "create">>>();
  });

  test("a name that isn't a member is a type error", () => {
    // @ts-expect-error not assignable
    Callable.toLayer(Users, "update", () => Effect.void);
  });

  test("the handler of users.get is not one of orders.get", () => {
    const layer = Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(id));
    expect(layer).type.not.toBeAssignableTo<Layer.Layer<Callable.Handler<"orders", "get">>>();
  });

  test("the handler of a standalone Callable is not one of a group member", () => {
    const layer = Callable.toLayer(GetUser, ({ id }) => Effect.succeed(id));
    expect(layer).type.not.toBeAssignableTo<Layer.Layer<Callable.Handler<"users", "get">>>();
  });

  test("the handler is typed by the member", () => {
    // @ts-expect-error Property 'id' does not exist
    Callable.toLayer(Users, "create", ({ id }) => Effect.succeed(id));
  });
});

/** Requires the Caller from a middleware outside it. */
class Admin extends CallableMiddleware.Service<Admin, { requires: Caller.Caller }>()("test/Admin", {
  error: CallableError.PermissionDenied,
}) {}

class Signed extends CallableGroup.make("signed")
  .add(GetUser)
  .middleware(Caller.Authenticated)
  .add(CreateUser) {}

describe("CallableGroup.middleware", () => {
  test("adds the group middleware's errors to each member's, added before or after", () => {
    expect<
      Callable.Error<CallableGroup.Member<typeof Signed, "get">>
    >().type.toBe<CallableError.Unauthenticated>();
    expect<
      Callable.Error<CallableGroup.Member<typeof Signed, "create">>
    >().type.toBe<CallableError.Unauthenticated>();
  });

  test("leaves the same Callable alone outside the group", () => {
    expect<Callable.Error<typeof GetUser>>().type.toBe<never>();
    expect<Callable.Error<CallableGroup.Member<typeof Orders, "get">>>().type.toBe<never>();
  });

  test("removes what the group middleware provides from a member's handler Layer", () => {
    expect(
      Callable.toLayer(Signed, "create", () =>
        Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
      ),
    ).type.toBe<Layer.Layer<Callable.Handler<"signed", "create">>>();
  });

  test("lets a member's middleware require what the group middleware provides", () => {
    const Purge = Callable.make("purge").middleware(Admin);
    class Admins extends CallableGroup.make("admins").add(Purge).middleware(Caller.Authenticated) {}
    expect<
      Callable.MiddlewareServices<CallableGroup.Member<typeof Admins, "purge">>
    >().type.toBe<never>();
    expect(Callable.handler(Admins, "purge")).type.toBe<
      Effect.Effect<
        Callable.HandlerCall<CallableGroup.Member<typeof Admins, "purge">>,
        never,
        Callable.Handler<"admins", "purge"> | Admin | Caller.Authenticated
      >
    >();
  });

  test("leaves a requirement no outer group middleware provides for the chain", () => {
    class Admins extends CallableGroup.make("admins")
      .add(Callable.make("purge"))
      .middleware(Caller.Authenticated)
      .middleware(Admin) {}
    expect<
      Callable.MiddlewareServices<CallableGroup.Member<typeof Admins, "purge">>
    >().type.toBe<Caller.Caller>();
  });

  test("Callable.handler requires the group middleware's implementation", () => {
    const Live = Callable.toLayer(Signed, "get", ({ id }) => Effect.succeed(id));
    expect(Effect.provide(Callable.handler(Signed, "get"), Live)).type.toBe<
      Effect.Effect<
        Callable.HandlerCall<CallableGroup.Member<typeof Signed, "get">>,
        never,
        Caller.Authenticated
      >
    >();
  });
});

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Callable from "../../src/functions/Callable.ts";
import * as CallableError from "../../src/functions/CallableError.ts";
import * as CallableGroup from "../../src/functions/CallableGroup.ts";
import * as CallableMiddleware from "../../src/functions/CallableMiddleware.ts";
import * as Caller from "../../src/functions/Caller.ts";

/** Records that it ran, before and after the call it wraps. */
class Outer extends CallableMiddleware.Service<Outer>()("test/Outer") {}
class Inner extends CallableMiddleware.Service<Inner>()("test/Inner") {}

const logging = (order: Array<string>) =>
  Layer.mergeAll(
    Layer.succeed(Outer, (effect) =>
      Effect.sync(() => order.push("group before")).pipe(
        Effect.andThen(effect),
        Effect.tap(() => Effect.sync(() => order.push("group after"))),
      ),
    ),
    Layer.succeed(Inner, (effect) =>
      Effect.sync(() => order.push("callable before")).pipe(
        Effect.andThen(effect),
        Effect.tap(() => Effect.sync(() => order.push("callable after"))),
      ),
    ),
  );

describe("CallableGroup.middleware", () => {
  it.effect("runs group middleware outside the Callable's own", () =>
    Effect.gen(function* () {
      const order: Array<string> = [];
      const CreateUser = Callable.make("create", { success: Schema.String }).middleware(Inner);
      class Users extends CallableGroup.make("users").add(CreateUser).middleware(Outer) {}
      const create = yield* Callable.handler(Users, "create").pipe(
        Effect.provide(
          Layer.merge(
            Callable.toLayer(Users, "create", () =>
              Effect.sync(() => {
                order.push("handler");
                return "created";
              }),
            ),
            logging(order),
          ),
        ),
      );
      expect(yield* create(undefined, {})).toBe("created");
      expect(order).toEqual([
        "group before",
        "callable before",
        "handler",
        "callable after",
        "group after",
      ]);
    }),
  );

  it.effect("covers a member added after the middleware", () =>
    Effect.gen(function* () {
      const CreateUser = Callable.make("create", { success: Schema.String });
      const DeleteUser = Callable.make("delete");
      class Users extends CallableGroup.make("users")
        .add(CreateUser)
        .middleware(Caller.Authenticated)
        .add(DeleteUser) {}
      const Live = Layer.mergeAll(
        Callable.toLayer(Users, "create", () =>
          Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
        ),
        Callable.toLayer(Users, "delete", () => Effect.void),
        Caller.Authenticated.layer,
      );
      const [create, remove] = yield* Effect.all([
        Callable.handler(Users, "create"),
        Callable.handler(Users, "delete"),
      ]).pipe(Effect.provide(Live));
      expect(yield* Effect.flip(create(undefined, {}))).toBeInstanceOf(
        CallableError.Unauthenticated,
      );
      expect(yield* Effect.flip(remove(undefined, {}))).toBeInstanceOf(
        CallableError.Unauthenticated,
      );
      expect(yield* create(undefined, { auth: { uid: "ada", token: {} } })).toBe("ada");
    }),
  );

  it.effect("leaves the same Callable in another group without it", () =>
    Effect.gen(function* () {
      const GetUser = Callable.make("get", { success: Schema.String });
      class Users extends CallableGroup.make("users")
        .add(GetUser)
        .middleware(Caller.Authenticated) {}
      class Public extends CallableGroup.make("public").add(GetUser) {}
      const Live = Layer.mergeAll(
        Callable.toLayer(Users, "get", () => Effect.succeed("users")),
        Callable.toLayer(Public, "get", () => Effect.succeed("public")),
        Caller.Authenticated.layer,
      );
      const [users, open] = yield* Effect.all([
        Callable.handler(Users, "get"),
        Callable.handler(Public, "get"),
      ]).pipe(Effect.provide(Live));
      expect(yield* Effect.flip(users(undefined, {}))).toBeInstanceOf(
        CallableError.Unauthenticated,
      );
      expect(yield* open(undefined, {})).toBe("public");
    }),
  );

  it("lists the group middleware's errors among a member's", () => {
    const GetUser = Callable.make("get", { error: CallableError.NotFound });
    class Users extends CallableGroup.make("users").add(GetUser).middleware(Caller.Authenticated) {}
    expect(Callable.errorSchemas(Users, "get")).toEqual([
      CallableError.NotFound,
      CallableError.Unauthenticated,
    ]);
    expect(Callable.errorSchemas(GetUser)).toEqual([CallableError.NotFound]);
  });
});

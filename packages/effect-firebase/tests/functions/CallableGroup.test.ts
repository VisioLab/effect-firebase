import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Callable from "../../src/functions/Callable.ts";
import * as CallableError from "../../src/functions/CallableError.ts";
import * as CallableGroup from "../../src/functions/CallableGroup.ts";
import * as CallableRequest from "../../src/functions/CallableRequest.ts";

const GetUser = Callable.make("get", { payload: { id: Schema.String }, success: Schema.String });
const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });

class Users extends CallableGroup.make("users").add(GetUser, DeleteUser) {}
class Admins extends CallableGroup.make("admins").add(GetUser) {}

const call = <A, E, R>(
  serve: Effect.Effect<(request: CallableRequest.CallableRequest) => Effect.Effect<A, E>, never, R>,
) => serve.pipe(Effect.flatMap((run) => run(CallableRequest.make({ data: { id: "ada" } }))));

describe("CallableGroup", () => {
  it("serves its members under their names", () => {
    expect(Users.identifier).toBe("users");
    expect(Object.keys(Users.callables)).toEqual(["get", "delete"]);
    expect(Users.callables.get).toBe(GetUser);
  });

  it("throws when a name is already taken in the group", () => {
    expect(() => Users.add(Callable.make("get"))).toThrow(
      'The Callable Group "users" already has a Callable named "get"',
    );
  });

  it.effect("serves one Callable in two groups, each with its own handler", () =>
    Effect.gen(function* () {
      const Live = Layer.mergeAll(
        Callable.toLayer(Users, "get", ({ id }) => Effect.succeed(`user ${id}`)),
        Callable.toLayer(Admins, "get", ({ id }) => Effect.succeed(`admin ${id}`)),
        Callable.toLayer(GetUser, ({ id }) => Effect.succeed(`alone ${id}`)),
      );
      const answers = yield* Effect.all([
        call(Callable.serve(Users, "get")),
        call(Callable.serve(Admins, "get")),
        call(Callable.serve(GetUser)),
      ]).pipe(Effect.provide(Live));
      expect(answers).toEqual(["user ada", "admin ada", "alone ada"]);
    }),
  );

  it.effect("names the deployed function, <group>-<name>, in a member's CallableError", () =>
    Effect.gen(function* () {
      const Find = Callable.make("find", {
        payload: { id: Schema.String },
        error: CallableError.NotFound,
      });
      class Lookups extends CallableGroup.make("lookups").add(Find) {}
      const Live = Layer.mergeAll(
        Callable.toLayer(Lookups, "find", () => Effect.fail(new CallableError.NotFound())),
        Callable.toLayer(Find, () => Effect.fail(new CallableError.NotFound())),
      );
      const [grouped, alone] = yield* Effect.all([
        Effect.flip(call(Callable.serve(Lookups, "find"))),
        Effect.flip(call(Callable.serve(Find))),
      ]).pipe(Effect.provide(Live));
      expect(grouped.callable).toBe("lookups-find");
      expect(grouped.reason).toMatchObject({ _tag: "ResponseError", code: "not-found" });
      expect(alone.callable).toBe("find");
    }),
  );
});

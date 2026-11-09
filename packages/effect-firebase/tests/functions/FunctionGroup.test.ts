import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Callable from "../../src/functions/Callable.ts";
import * as CallableError from "../../src/functions/CallableError.ts";
import * as FunctionGroup from "../../src/functions/FunctionGroup.ts";
import * as CallableRequest from "../../src/functions/CallableRequest.ts";

const GetUser = Callable.make("get", { payload: { id: Schema.String }, success: Schema.String });
const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });

class Users extends FunctionGroup.make("users").add(GetUser, DeleteUser) {}
class Admins extends FunctionGroup.make("admins").add(GetUser) {}

const call = <A, E, R>(
  serve: Effect.Effect<(request: CallableRequest.CallableRequest) => Effect.Effect<A, E>, never, R>,
) =>
  serve.pipe(
    Effect.flatMap((run) =>
      run({
        data: { id: "ada" },
        rawRequest: HttpServerRequest.fromWeb(new Request("http://localhost/", { method: "POST" })),
      }),
    ),
  );

describe("FunctionGroup", () => {
  it("serves its members under their names", () => {
    expect(Users.identifier).toBe("users");
    expect(Object.keys(Users.functions)).toEqual(["get", "delete"]);
    expect(Users.functions.get).toBe(GetUser);
  });

  it("throws when a name is already taken in the group", () => {
    expect(() => Users.add(Callable.make("get"))).toThrow(
      'The Function Group "users" already has a Function named "get"',
    );
  });

  it("throws when a name is taken by a member of another kind", () => {
    // A Function of a kind other than Callable, standing in for a Document Trigger.
    const OnGet = { kind: "Other", name: "get" } as const;
    expect(() => Users.add(OnGet)).toThrow(
      'The Function Group "users" already has a Function named "get"',
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
      class Lookups extends FunctionGroup.make("lookups").add(Find) {}
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

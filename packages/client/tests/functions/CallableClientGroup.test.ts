import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as App from "../../src/app/App.ts";
import * as CallableClient from "../../src/functions/CallableClient.ts";
import * as ClientFunctions from "../../src/functions/ClientFunctions.ts";
import { Admins, CreateUser, Users } from "../../../functions/tests/fixture/src/contract.ts";
import { emulator } from "./emulator.ts";

/** Functions in `region`, under a named app of its own. */
const functionsIn = (region?: string) =>
  ClientFunctions.layer({ emulator, regionOrCustomDomain: region }).pipe(
    Layer.provide(
      App.layer({ projectId: "demo-effect-firebase" }, `callable-client-group-${region}`),
    ),
  );

const FunctionsLive = functionsIn();
const EuropeLive = functionsIn("europe-west1");

/** The code of the `ResponseError` an Effect fails with, or else its error. */
const responseCode = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) =>
      error instanceof CallableError.CallableError && error.reason._tag === "ResponseError"
        ? error.reason.code
        : error,
    ),
  );

describe("CallableClient with a group", () => {
  it.effect("calls each member as <group>-<name>", () =>
    Effect.gen(function* () {
      const users = yield* CallableClient.make(Users);
      const user = yield* users.create({ name: "Ada", birthday: new Date("1815-12-10") });
      expect(user).toEqual({ id: "ada", name: "Ada", birthday: new Date("1815-12-10") });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("calls a Callable in two groups through each group's own function", () =>
    Effect.gen(function* () {
      const users = yield* CallableClient.make(Users);
      const admins = yield* CallableClient.make(Admins);
      expect(yield* users.get({ id: "ada" })).toEqual({ id: "ada", servedBy: "users" });
      expect(yield* admins.get({ id: "ada" })).toEqual({ id: "ada", servedBy: "admins" });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("calls a member served in another region under that region's Functions", () =>
    Effect.gen(function* () {
      const users = yield* CallableClient.make(Users);
      yield* users.delete({ id: "ada" });
    }).pipe(Effect.provide(EuropeLive)),
  );

  it.effect("gets not-found under the wrong region", () =>
    Effect.gen(function* () {
      const users = yield* CallableClient.make(Users);
      expect(yield* responseCode(users.create({ name: "Ada", birthday: new Date() }))).toBe(
        "not-found",
      );
    }).pipe(Effect.provide(EuropeLive)),
  );

  it.effect("gets not-found when built from a grouped member on its own", () =>
    Effect.gen(function* () {
      const { create } = yield* CallableClient.make(CreateUser);
      expect(yield* responseCode(create({ name: "Ada", birthday: new Date() }))).toBe("not-found");
    }).pipe(Effect.provide(FunctionsLive)),
  );
});

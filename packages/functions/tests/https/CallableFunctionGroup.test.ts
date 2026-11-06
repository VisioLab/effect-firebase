import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import { deleteApp, initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import * as CallableFunction from "../../src/https/CallableFunction.ts";
import { Users } from "../fixture/src/contract.ts";

const [host = "127.0.0.1", port = "5001"] = (process.env["FUNCTIONS_EMULATOR_HOST"] ?? "").split(
  ":",
);

/**
 * The client SDK's Functions in `region`, pointed at the emulator, outside any
 * Effect API of ours.
 */
const functionsIn = (region?: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const app = initializeApp(
        { apiKey: "demo", projectId: "demo-effect-firebase", appId: "demo" },
        `callable-function-group-test-${region ?? "default"}`,
      );
      const functions = getFunctions(app, region);
      connectFunctionsEmulator(functions, host, Number(port));
      return functions;
    }),
    (functions) => Effect.promise(() => deleteApp(functions.app)),
  );

/** Calls the function `name` with a plain `httpsCallable`, and answers its data. */
const call = (name: string, data?: unknown, region?: string) =>
  Effect.gen(function* () {
    const callable = httpsCallable(yield* functionsIn(region), name);
    return (yield* Effect.promise(() => callable(data))).data;
  }).pipe(Effect.scoped);

describe("CallableFunction.group", () => {
  it.effect("serves each member as <group>-<name>", () =>
    Effect.gen(function* () {
      const user = yield* call("users-create", {
        name: "Ada",
        birthday: "1815-12-10T00:00:00.000Z",
      });
      expect(user).toEqual({ id: "ada", name: "Ada", birthday: "1815-12-10T00:00:00.000Z" });
    }),
  );

  it.effect("serves a Callable in two groups, each with its own handler", () =>
    Effect.gen(function* () {
      expect(yield* call("users-get", { id: "ada" })).toEqual({ id: "ada", servedBy: "users" });
      expect(yield* call("admins-get", { id: "ada" })).toEqual({ id: "ada", servedBy: "admins" });
    }),
  );

  it.effect("passes a member's options to its own export", () =>
    Effect.gen(function* () {
      expect(yield* call("users-delete", { id: "ada" }, "europe-west1")).toBeNull();
    }),
  );

  it.effect("builds the Layer in each worker for that worker's function only", () =>
    Effect.gen(function* () {
      expect(yield* call("workers-first")).toEqual({ target: "workers.first", builds: 1 });
      expect(yield* call("workers-second")).toEqual({ target: "workers.second", builds: 1 });
      expect(yield* call("workers-first")).toEqual({ target: "workers.first", builds: 1 });
    }),
  );

  it("passes the options by member name, and none to the others", () => {
    const { users } = CallableFunction.group(
      Users,
      Layer.mergeAll(
        Callable.toLayer(Users, "create", () => Effect.die("not called")),
        Callable.toLayer(Users, "get", () => Effect.die("not called")),
        Callable.toLayer(Users, "delete", () => Effect.void),
      ),
      { delete: { region: "europe-west1", memory: "512MiB" } },
    );
    expect(users.delete.__endpoint.region).toEqual(["europe-west1"]);
    expect(users.delete.__endpoint.availableMemoryMb).toBe(512);
    expect(users.create.__endpoint.region).toBeUndefined();
    expect(users.get.__endpoint.availableMemoryMb).not.toBe(512);
  });

  it.effect("sends a member's declared error with its code and encoded details", () =>
    Effect.gen(function* () {
      const fail = httpsCallable(yield* functionsIn(), "failing-fail");
      const error = yield* Effect.flip(
        Effect.tryPromise(() => fail({ with: "NameTaken" })).pipe(
          Effect.mapError((error) => error.cause),
        ),
      );
      expect(error).toMatchObject({
        code: "functions/already-exists",
        message: "NameTaken [409]",
        details: { _tag: "NameTaken", username: "Ada", since: "2026-01-01T12:00:00.000Z" },
      });
    }).pipe(Effect.scoped),
  );
});

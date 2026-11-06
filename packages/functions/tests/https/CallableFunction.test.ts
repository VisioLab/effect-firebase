import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import { deleteApp, initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import * as CallableFunction from "../../src/https/CallableFunction.ts";

const [host = "127.0.0.1", port = "5001"] = (process.env["FUNCTIONS_EMULATOR_HOST"] ?? "").split(
  ":",
);

/** The client SDK's Functions, pointed at the emulator, outside any Effect API of ours. */
const functions = Effect.acquireRelease(
  Effect.sync(() => {
    const app = initializeApp(
      { apiKey: "demo", projectId: "demo-effect-firebase", appId: "demo" },
      "callable-function-test",
    );
    const functions = getFunctions(app);
    connectFunctionsEmulator(functions, host, Number(port));
    return functions;
  }),
  (functions) => Effect.promise(() => deleteApp(functions.app)),
);

describe("CallableFunction", () => {
  it.effect("answers a plain httpsCallable call with plain toCodecJson output", () =>
    Effect.gen(function* () {
      const greet = httpsCallable(yield* functions, "greet");
      const result = yield* Effect.promise(() =>
        greet({ name: "Ada", at: "2026-01-01T12:00:00.000Z" }),
      );
      expect(result.data).toEqual({
        message: "Hello, Ada!",
        nextDay: "2026-01-02T12:00:00.000Z",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("builds the Layer once, however many calls arrive at once", () =>
    Effect.gen(function* () {
      const layerBuilds = httpsCallable(yield* functions, "layerBuilds");
      const first = yield* Effect.forEach(
        Array.from({ length: 3 }),
        () => Effect.promise(() => layerBuilds()),
        { concurrency: "unbounded" },
      );
      const later = yield* Effect.promise(() => layerBuilds());
      for (const result of [...first, later]) {
        expect(result.data).toEqual({ builds: 1 });
      }
    }).pipe(Effect.scoped),
  );

  it("builds nothing when the export is made or discovered", () => {
    const Ping = Callable.make("ping", { success: Schema.Finite });
    let builds = 0;
    const { ping } = CallableFunction.make(
      Ping,
      Callable.toLayer(
        Ping,
        Effect.sync(() => {
          builds += 1;
          return () => Effect.succeed(builds);
        }),
      ),
    );
    // What firebase-tools reads from each export to discover it.
    expect(ping.__endpoint.callableTrigger).toBeDefined();
    expect(builds).toBe(0);
  });
});

import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFunctionsEmulator,
  FunctionsError,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as CallableFunction from "../../src/https/CallableFunction.ts";

/** Where the fixture's logger writes what the server logs, one JSON line per entry. */
const serverLog = fileURLToPath(new URL("../server.log", import.meta.url));

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

  it.effect("sends a declared error as its code, a readable message and the encoded error", () =>
    Effect.gen(function* () {
      const fail = httpsCallable(yield* functions, "fail");
      const error = yield* Effect.flip(
        Effect.tryPromise(() => fail({ with: "NameTaken" })).pipe(
          Effect.mapError((error) => error.cause),
        ),
      );
      expect(error).toBeInstanceOf(FunctionsError);
      expect(error).toMatchObject({
        code: "functions/already-exists",
        message: "NameTaken [409]",
        details: { _tag: "NameTaken", username: "Ada", since: "2026-01-01T12:00:00.000Z" },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("answers a Payload that doesn't decode with invalid-argument and no details", () =>
    Effect.gen(function* () {
      const greet = httpsCallable(yield* functions, "greet");
      const error = yield* Effect.flip(
        Effect.tryPromise(() => greet({ name: 1, at: "yesterday" })).pipe(
          Effect.mapError((error) => error.cause),
        ),
      );
      expect(error).toMatchObject({ code: "functions/invalid-argument", details: undefined });
    }).pipe(Effect.scoped),
  );

  it.effect("answers a defect with a bare internal, and logs its Cause", () =>
    Effect.gen(function* () {
      const fail = httpsCallable(yield* functions, "fail");
      const error = yield* Effect.flip(
        Effect.tryPromise(() => fail({ with: "defect" })).pipe(
          Effect.mapError((error) => error.cause),
        ),
      );
      expect(error).toMatchObject({
        code: "functions/internal",
        message: "INTERNAL [500]",
        details: undefined,
      });
      const log = readFileSync(serverLog, "utf8");
      expect(log).toContain("Boom: the handler broke");
    }).pipe(Effect.scoped),
  );

  it.effect(
    "fails a call whose Layer fails to build with internal, and builds it again on the next",
    () =>
      Effect.gen(function* () {
        const flaky = httpsCallable(yield* functions, "flaky");
        // A warm instance from an earlier run has built the Layer already, so
        // the failed first build shows only in the count it answers with.
        const first = yield* Effect.result(
          Effect.tryPromise(() => flaky()).pipe(Effect.mapError((error) => error.cause)),
        );
        if (first._tag === "Failure") {
          expect(first.failure).toMatchObject({ code: "functions/internal", details: undefined });
        }
        const result = yield* Effect.promise(() => flaky());
        expect(result.data).toEqual({ builds: 2 });
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

  it.effect("hands each call's handler its own HTTP request", () =>
    Effect.gen(function* () {
      const tags = Array.from({ length: 3 }, () => crypto.randomUUID());
      const answers = yield* Effect.forEach(
        tags,
        (tag) =>
          Effect.promise(async () => {
            const response = await fetch(
              `http://${host}:${port}/demo-effect-firebase/us-central1/requestHeader`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Test-Tag": tag },
                body: JSON.stringify({ data: null }),
              },
            );
            return (await response.json()) as unknown;
          }),
        { concurrency: "unbounded" },
      );
      expect(answers).toEqual(tags.map((tag) => ({ result: tag })));
    }),
  );
});

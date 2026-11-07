import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { deleteApp, initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const [host = "127.0.0.1", port = "5001"] = (process.env["FUNCTIONS_EMULATOR_HOST"] ?? "").split(
  ":",
);

const functions = Effect.acquireRelease(
  Effect.sync(() => {
    const app = initializeApp(
      { apiKey: "demo", projectId: "demo-effect-firebase", appId: "demo" },
      "fixture-test",
    );
    const functions = getFunctions(app);
    connectFunctionsEmulator(functions, host, Number(port));
    return functions;
  }),
  (functions) => Effect.promise(() => deleteApp(functions.app)),
);

describe("the functions fixture", () => {
  it.effect("serves a plain onCall function through the emulator", () =>
    Effect.gen(function* () {
      const echo = httpsCallable<{ readonly message: string }, { readonly echoed: string }>(
        yield* functions,
        "echo",
      );
      const result = yield* Effect.promise(() => echo({ message: "hello" }));
      expect(result.data).toEqual({ echoed: "hello" });
    }).pipe(Effect.scoped),
  );
});

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFunctionsEmulator,
  FunctionsError,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const [host = "127.0.0.1", port = "5001"] = (process.env["FUNCTIONS_EMULATOR_HOST"] ?? "").split(
  ":",
);

/**
 * Calls the function `name` signed out, with a plain `httpsCallable`, and
 * answers the `FunctionsError` it fails with.
 */
const failureOf = (name: string, data: unknown) =>
  Effect.gen(function* () {
    const functions = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const app = initializeApp(
          { apiKey: "demo", projectId: "demo-effect-firebase", appId: "demo" },
          "callable-function-middleware-test",
        );
        const functions = getFunctions(app);
        connectFunctionsEmulator(functions, host, Number(port));
        return functions;
      }),
      (functions) => Effect.promise(() => deleteApp(functions.app)),
    );
    const error = yield* Effect.flip(
      Effect.tryPromise(() => httpsCallable(functions, name)(data)).pipe(
        Effect.mapError((error) => error.cause),
      ),
    );
    if (!(error instanceof FunctionsError)) return yield* Effect.die(error);
    return { code: error.code, message: error.message, details: error.details };
  }).pipe(Effect.scoped);

describe("CallableFunction with middleware", () => {
  it.effect("answers a signed-out call to an Authenticated Callable with unauthenticated", () =>
    Effect.gen(function* () {
      expect(yield* failureOf("whoAmI", { greeting: "Hello" })).toMatchObject({
        code: "functions/unauthenticated",
        message: "Unauthenticated [401]",
        details: { _tag: "Unauthenticated" },
      });
    }),
  );

  it.effect("runs the middleware before the Payload is decoded", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf("whoAmI", { greeting: 42 });
      expect(failure.code).toBe("functions/unauthenticated");
    }),
  );
});

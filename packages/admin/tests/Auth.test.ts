import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as Admin from "firebase-admin/app";
import * as App from "../src/App.ts";
import * as Auth from "../src/Auth.ts";

// A named app keeps each run independent of whatever the default app is, and of
// the apps the other suites register.
const layer = Auth.layer.pipe(Layer.provide(App.layer({ projectId: "demo-auth" }, "auth")));

describe("Auth", () => {
  it.effect("builds on top of the app in context", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Auth;
      const app = yield* auth.use((auth) => auth.app);
      assert.strictEqual(app.name, "auth");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("carries the Admin SDK error code", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Auth;

      // The SDK rejects an empty uid before it goes anywhere near the network.
      const error = yield* Effect.flip(auth.getUser(""));

      assert.strictEqual(error._tag, "AuthError");
      assert.strictEqual(error.code, "auth/invalid-uid");
      assert.strictEqual(error.message, 'Failed to get the user ""');
    }).pipe(Effect.provide(layer)),
  );

  it.effect("leaves the code off an error the SDK did not raise", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Auth;

      const error = yield* Effect.flip(
        auth.use(() => {
          throw new Error("boom");
        }),
      );

      assert.strictEqual(error._tag, "AuthError");
      assert.strictEqual(error.code, undefined);
      assert.strictEqual((error.cause as Error).message, "boom");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("dies rather than failing when the app was already deleted", () =>
    Effect.gen(function* () {
      const deleted = Admin.initializeApp({ projectId: "demo-deleted" }, "deleted");
      yield* Effect.promise(() => Admin.deleteApp(deleted));

      // Reaching for Auth on a dead app is a wiring mistake, so it stays out of
      // the error channel that `AuthError` reserves for failed calls.
      const defect = yield* Effect.provide(
        Auth.Auth,
        Auth.layer.pipe(Layer.provide(Layer.succeed(App.App, deleted))),
      ).pipe(Effect.catchDefect(Effect.succeed));

      assert.strictEqual((defect as Admin.FirebaseError).code, "app/app-deleted");
    }),
  );
});

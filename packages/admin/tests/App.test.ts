import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { defaultAppName } from "effect-firebase/App";
import * as Admin from "firebase-admin/app";
import * as App from "../src/App.ts";

const isRegistered = (name: string) => Admin.getApps().some((app) => app.name === name);

describe("App", () => {
  it.effect("initializes an app and deletes it when the scope closes", () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const app = yield* App.make({ projectId: "demo-owned", name: "owned" });
          assert.strictEqual(app.name, "owned");
          assert.isTrue(isRegistered("owned"));
        }),
      );

      assert.isFalse(isRegistered("owned"));
    }),
  );

  it.effect("initializes the default app from the environment", () =>
    Effect.gen(function* () {
      const app = yield* App.App;
      assert.strictEqual(app.name, defaultAppName);
    }).pipe(Effect.provide(App.layer)),
  );

  it.effect("adopts an app that was initialized elsewhere and leaves it alive", () =>
    Effect.gen(function* () {
      const existing = Admin.initializeApp({ projectId: "demo-adopted" }, "adopted");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const app = yield* App.make({ projectId: "demo-adopted", name: "adopted" });
          assert.strictEqual(app, existing);
        }),
      );

      assert.isTrue(isRegistered("adopted"));
      yield* Effect.promise(() => Admin.deleteApp(existing));
    }),
  );

  it.effect("fails when an app is initialized with a conflicting configuration", () =>
    Effect.gen(function* () {
      const existing = Admin.initializeApp({ projectId: "demo-conflict" }, "conflict");

      const error = yield* Effect.flip(
        Effect.scoped(App.make({ projectId: "other-project", name: "conflict" })),
      );

      assert.strictEqual(error._tag, "AppError");
      yield* Effect.promise(() => Admin.deleteApp(existing));
    }),
  );
});

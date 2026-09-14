import { describe, expect, it } from "@effect/vitest";
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
          const app = yield* App.make({ projectId: "demo-owned" }, "owned");
          expect(app.name).toBe("owned");
          expect(isRegistered("owned")).toBe(true);
        }),
      );

      expect(isRegistered("owned")).toBe(false);
    }),
  );

  it.effect("initializes the default app from the environment", () =>
    Effect.gen(function* () {
      const app = yield* App.App;
      expect(app.name).toBe(defaultAppName);
    }).pipe(Effect.provide(App.layer())),
  );

  it.effect("adopts an app that was initialized elsewhere and leaves it alive", () =>
    Effect.gen(function* () {
      const existing = Admin.initializeApp({ projectId: "demo-adopted" }, "adopted");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const app = yield* App.make({ projectId: "demo-adopted" }, "adopted");
          expect(app).toBe(existing);
        }),
      );

      expect(isRegistered("adopted")).toBe(true);
      yield* Effect.promise(() => Admin.deleteApp(existing));
    }),
  );

  it.effect("fails when an app is initialized with a conflicting configuration", () =>
    Effect.gen(function* () {
      const existing = Admin.initializeApp({ projectId: "demo-conflict" }, "conflict");

      const error = yield* Effect.flip(
        Effect.scoped(App.make({ projectId: "other-project" }, "conflict")),
      );

      expect(error._tag).toBe("AppError");
      yield* Effect.promise(() => Admin.deleteApp(existing));
    }),
  );
});

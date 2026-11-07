import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import { connectAuthEmulator, getAuth, signInAnonymously, signOut } from "firebase/auth";
import * as App from "../../src/app/App.ts";
import * as CallableClient from "../../src/functions/CallableClient.ts";
import * as ClientFunctions from "../../src/functions/ClientFunctions.ts";
import { Accounts, Admins } from "../../../functions/tests/fixture/src/contract.ts";
import { emulator } from "./emulator.ts";

// The project the emulator serves the fixture under. A named app keeps this
// suite apart from the others in the package, and its Auth apart from theirs.
const AppLive = App.layer(
  { apiKey: "demo", projectId: "demo-effect-firebase" },
  "callable-client-group-middleware",
);
const FunctionsLive = ClientFunctions.layer({ emulator }).pipe(Layer.provideMerge(AppLive));

/** The app's Auth, pointed at the Auth emulator once. */
const auth = Effect.map(Effect.service(App.App), (app) => {
  const auth = getAuth(app);
  if (auth.emulatorConfig === null) {
    connectAuthEmulator(auth, `http://${process.env["FIREBASE_AUTH_EMULATOR_HOST"]}`, {
      disableWarnings: true,
    });
  }
  return auth;
});

describe("CallableClient with group middleware", () => {
  it.effect("fails a signed-out call to each member of a group behind Authenticated", () =>
    Effect.gen(function* () {
      const signedIn = yield* auth;
      yield* Effect.promise(() => signOut(signedIn));
      const accounts = yield* CallableClient.make(Accounts);
      // `get` was added before the middleware, `me` after it.
      const errors = yield* Effect.all([
        Effect.flip(accounts.get({ id: "ada" })),
        Effect.flip(accounts.me()),
      ]);
      expect(errors[0]).toBeInstanceOf(CallableError.Unauthenticated);
      expect(errors[1]).toBeInstanceOf(CallableError.Unauthenticated);
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("accepts a signed-out call to the same Callable in a group without it", () =>
    Effect.gen(function* () {
      const signedIn = yield* auth;
      yield* Effect.promise(() => signOut(signedIn));
      const admins = yield* CallableClient.make(Admins);
      expect(yield* admins.get({ id: "ada" })).toEqual({ id: "ada", servedBy: "admins" });
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("serves a signed-in call, with the Caller the group middleware provides", () =>
    Effect.gen(function* () {
      const signedIn = yield* auth;
      const { user } = yield* Effect.promise(() => signInAnonymously(signedIn));
      const accounts = yield* CallableClient.make(Accounts);
      expect(yield* accounts.get({ id: "ada" })).toEqual({ id: "ada", servedBy: "accounts" });
      expect(yield* accounts.me()).toBe(user.uid);
    }).pipe(Effect.provide(FunctionsLive)),
  );
});

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import { connectAuthEmulator, getAuth, signInAnonymously, signOut } from "firebase/auth";
import * as App from "../../src/app/App.ts";
import * as CallableClient from "../../src/functions/CallableClient.ts";
import * as ClientFunctions from "../../src/functions/ClientFunctions.ts";
import { WhoAmI } from "../../../functions/tests/fixture/src/contract.ts";
import { emulator } from "./emulator.ts";

// The project the emulator serves the fixture under. A named app keeps this
// suite apart from the others in the package, and its Auth apart from theirs.
const AppLive = App.layer(
  { apiKey: "demo", projectId: "demo-effect-firebase" },
  "callable-client-middleware",
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

describe("CallableClient with Authenticated", () => {
  it.effect("calls as the signed-in user, whose uid the handler reads from the Caller", () =>
    Effect.gen(function* () {
      const signedIn = yield* auth;
      const { user } = yield* Effect.promise(() => signInAnonymously(signedIn));
      const { whoAmI } = yield* CallableClient.make(WhoAmI);
      expect(yield* whoAmI({ greeting: "Hello" })).toBe(`Hello, ${user.uid}!`);
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("fails a signed-out call with Unauthenticated", () =>
    Effect.gen(function* () {
      const signedIn = yield* auth;
      yield* Effect.promise(() => signOut(signedIn));
      const { whoAmI } = yield* CallableClient.make(WhoAmI);
      const error = yield* Effect.flip(whoAmI({ greeting: "Hello" }));
      expect(error).toBeInstanceOf(CallableError.Unauthenticated);
    }).pipe(Effect.provide(FunctionsLive)),
  );
});

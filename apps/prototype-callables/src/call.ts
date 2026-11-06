// PROTOTYPE, throwaway. Calls the emulator through the typed client and prints
// what comes back. Run with `vp run call` while `vp run emulator` is up.
import { Effect, Layer } from "effect";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, signOut } from "firebase/auth";
import * as CallableClient from "./client.ts";
import { Greet, Users } from "./contract.ts";

const app = initializeApp({ apiKey: "demo", projectId: "demo-effect-firebase", appId: "demo" });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

const show = (label: string) => <A, E>(self: Effect.Effect<A, E>) =>
  self.pipe(
    Effect.exit,
    Effect.tap((exit) =>
      Effect.sync(() =>
        console.dir(
          exit._tag === "Success" ? { label, ok: exit.value } : { label, failed: exit.cause.reasons.map((r: any) => r._tag === "Fail" ? { Fail: r.error } : r) },
          { depth: 6 },
        ),
      ),
    ),
  );

const program = Effect.gen(function* () {
  const { create, get, slow } = yield* CallableClient.make(Users);
  const { greet } = yield* CallableClient.make(Greet);

  yield* show("greet (no auth needed)")(greet({ name: "Ada" }));
  yield* show("users.get signed out -> Unauthenticated")(get({ id: "u1" }));

  yield* Effect.promise(() => signInAnonymously(auth));

  const birthday = new Date("1815-12-10T00:00:00Z");
  const name = `Ada-${Date.now()}`;
  const created = yield* show("users.create")(create({ name, birthday }));
  yield* show("users.create again -> NameTaken")(create({ name, birthday }));
  const id = created._tag === "Success" ? created.value.id : "u1";
  yield* show("users.get created id (birthday is a Date again?)")(
    get({ id }).pipe(Effect.tap((u) => Effect.log("birthday instanceof Date:", u.birthday instanceof Date))),
  );
  yield* show("users.get missing -> NotFound")(get({ id: "nope" }));
  yield* show("catchTag on the typed error")(
    get({ id: "nope" }).pipe(Effect.catchTag("NotFound", (e) => Effect.succeed(`recovered: ${e.message}`))),
  );
  yield* show("slow 3000 aborted after 500ms (client interrupt)")(
    slow({ ms: 3000 }).pipe(Effect.timeout("500 millis")),
  );

  if (process.argv.includes("--hold")) {
    // Leaves a call in flight so the emulator can be stopped with Ctrl-C.
    yield* show("slow 60000 (stop the emulator now)")(slow({ ms: 60_000 }));
  }

  yield* Effect.promise(() => signOut(auth));
});

const FunctionsLive = Layer.unwrap(
  Effect.sync(() =>
    CallableClient.ClientFunctions.layer(app, { emulator: { host: "127.0.0.1", port: 5001 } }),
  ),
);

await Effect.runPromise(program.pipe(Effect.provide(FunctionsLive)));
process.exit(0);

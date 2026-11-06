import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Callable from "../../src/functions/Callable.ts";
import * as CallableError from "../../src/functions/CallableError.ts";
import * as Caller from "../../src/functions/Caller.ts";

const WhoAmI = Callable.make("whoAmI", {
  payload: { greeting: Schema.String },
  success: Schema.String,
}).middleware(Caller.Authenticated);

const WhoAmILive = Callable.toLayer(WhoAmI, ({ greeting }) =>
  Effect.map(Effect.service(Caller.Caller), ({ uid }) => `${greeting}, ${uid}!`),
);

describe("Callable.handler", () => {
  it.effect("runs the handler behind Authenticated for a signed-in call", () =>
    Effect.gen(function* () {
      const whoAmI = yield* Callable.handler(WhoAmI);
      const answer = yield* whoAmI({ greeting: "Hello" }, { auth: { uid: "ada", token: {} } });
      expect(answer).toBe("Hello, ada!");
    }).pipe(Effect.provide(Layer.merge(WhoAmILive, Caller.Authenticated.layer))),
  );

  it.effect("fails a signed-out call with Unauthenticated", () =>
    Effect.gen(function* () {
      const whoAmI = yield* Callable.handler(WhoAmI);
      const error = yield* Effect.flip(whoAmI({ greeting: "Hello" }, {}));
      expect(error).toBeInstanceOf(CallableError.Unauthenticated);
    }).pipe(Effect.provide(Layer.merge(WhoAmILive, Caller.Authenticated.layer))),
  );
});

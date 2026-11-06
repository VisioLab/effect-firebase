import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Callable from "../../src/functions/Callable.ts";
import * as CallableError from "../../src/functions/CallableError.ts";
import * as CallableMiddleware from "../../src/functions/CallableMiddleware.ts";
import * as CallableRequest from "../../src/functions/CallableRequest.ts";
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

  it.effect("runs the handler with a stub middleware that provides a fake Caller", () =>
    Effect.gen(function* () {
      const whoAmI = yield* Callable.handler(WhoAmI);
      // Signed out, yet the stub lets the call through as Grace.
      expect(yield* whoAmI({ greeting: "Hi" }, {})).toBe("Hi, grace!");
    }).pipe(
      Effect.provide(
        Layer.merge(
          WhoAmILive,
          Layer.succeed(Caller.Authenticated, (effect) =>
            Effect.provideService(effect, Caller.Caller, {
              uid: "grace",
              token: {},
              rawToken: "",
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("hands middleware the Payload as it would arrive on the wire", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = [];
      const Remind = Callable.make("remind", { payload: { at: Schema.Date } }).middleware(Recorder);
      const remind = yield* Callable.handler(Remind).pipe(
        Effect.provide(
          Layer.merge(
            Callable.toLayer(Remind, () => Effect.void),
            Layer.succeed(Recorder, (effect) =>
              Effect.flatMap(Effect.service(CallableRequest.CallableRequest), ({ data }) => {
                seen.push(data);
                return effect;
              }),
            ),
          ),
        ),
      );
      yield* remind({ at: new Date("2026-11-06T12:00:00.000Z") }, {});
      expect(seen).toEqual([{ at: "2026-11-06T12:00:00.000Z" }]);
    }),
  );

  it.effect("lets a middleware that wraps the call catch the handler's error", () =>
    Effect.gen(function* () {
      const Lookup = Callable.make("lookup", {
        success: Schema.String,
        error: CallableError.NotFound,
      }).middleware(Recorder);
      const lookup = yield* Callable.handler(Lookup).pipe(
        Effect.provide(
          Layer.merge(
            Callable.toLayer(Lookup, () => Effect.fail(new CallableError.NotFound())),
            Layer.succeed(Recorder, (effect) =>
              Effect.catch(effect, () => Effect.succeed("fallback")),
            ),
          ),
        ),
      );
      expect(yield* lookup(undefined, {})).toBe("fallback");
    }),
  );

  it.effect("runs the setup of a handler built from an Effect once across calls", () =>
    Effect.gen(function* () {
      let setups = 0;
      const Count = Callable.make("count", { success: Schema.Finite });
      const count = yield* Callable.handler(Count).pipe(
        Effect.provide(
          Callable.toLayer(
            Count,
            Effect.sync(() => {
              setups += 1;
              return () => Effect.succeed(setups);
            }),
          ),
        ),
      );
      yield* count(undefined, {});
      yield* count(undefined, {});
      expect(setups).toBe(1);
    }),
  );

  it.effect("wraps earlier middleware in later middleware, so an outer one provides", () =>
    Effect.gen(function* () {
      const order: Array<string> = [];
      // `Admin` requires the Caller, which `Authenticated`, attached after it
      // and so outside it, provides.
      const Purge = Callable.make("purge", { success: Schema.String })
        .middleware(Admin)
        .middleware(Caller.Authenticated);
      const purge = yield* Callable.handler(Purge).pipe(
        Effect.provide(
          Layer.mergeAll(
            Callable.toLayer(Purge, () => Effect.succeed("purged")),
            Layer.succeed(Admin, (effect) =>
              Effect.gen(function* () {
                const { uid } = yield* Effect.service(Caller.Caller);
                order.push(`admin ${uid}`);
                if (uid !== "root") return yield* new CallableError.PermissionDenied();
                return yield* effect;
              }),
            ),
            Layer.succeed(Caller.Authenticated, (effect) => {
              order.push("authenticated");
              return Effect.provideService(effect, Caller.Caller, {
                uid: "root",
                token: {},
                rawToken: "",
              });
            }),
          ),
        ),
      );
      expect(yield* purge(undefined, {})).toBe("purged");
      expect(order).toEqual(["authenticated", "admin root"]);
    }),
  );
});

/** A middleware that provides and requires nothing. */
class Recorder extends CallableMiddleware.Service<Recorder>()("test/Recorder") {}

/** A middleware that requires the Caller from a middleware outside it. */
class Admin extends CallableMiddleware.Service<Admin, { requires: Caller.Caller }>()("test/Admin", {
  error: CallableError.PermissionDenied,
}) {}

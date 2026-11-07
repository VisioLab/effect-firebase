import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Callable from "../../src/functions/Callable.ts";
import * as CallableError from "../../src/functions/CallableError.ts";
import * as CallableGroup from "../../src/functions/CallableGroup.ts";
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

  it.effect("hands middleware the HTTP request it is given", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = [];
      const Ping = Callable.make("ping").middleware(Recorder);
      const ping = yield* Callable.handler(Ping).pipe(
        Effect.provide(
          Layer.merge(
            Callable.toLayer(Ping, () => Effect.void),
            Layer.succeed(Recorder, (effect) =>
              Effect.flatMap(Effect.service(CallableRequest.CallableRequest), ({ rawRequest }) => {
                seen.push(rawRequest.headers["user-agent"], rawRequest.remoteAddress);
                return effect;
              }),
            ),
          ),
        ),
      );
      const rawRequest = HttpServerRequest.fromWeb(
        new Request("https://example.com/ping", {
          method: "POST",
          headers: { "user-agent": "curl/8.7.1" },
        }),
      ).modify({ remoteAddress: Option.some("203.0.113.7") });
      yield* ping(undefined, { rawRequest });
      expect(seen).toEqual(["curl/8.7.1", Option.some("203.0.113.7")]);
    }),
  );

  it.effect("hands middleware a JSON POST to the deployed name when no request is given", () =>
    Effect.gen(function* () {
      const seen: Array<unknown> = [];
      const Create = Callable.make("create", { payload: { name: Schema.String } }).middleware(
        Recorder,
      );
      class Users extends CallableGroup.make("users").add(Create) {}
      const create = yield* Callable.handler(Users, "create").pipe(
        Effect.provide(
          Layer.merge(
            Callable.toLayer(Users, "create", () => Effect.void),
            Layer.succeed(Recorder, (effect) =>
              Effect.gen(function* () {
                const { rawRequest } = yield* CallableRequest.CallableRequest;
                seen.push(
                  rawRequest.method,
                  rawRequest.url,
                  rawRequest.headers["content-type"],
                  yield* Effect.orDie(rawRequest.json),
                );
                return yield* effect;
              }),
            ),
          ),
        ),
      );
      yield* create({ name: "ada" }, {});
      expect(seen).toEqual(["POST", "/users-create", "application/json", { name: "ada" }]);
    }),
  );

  it.effect("reads back the whole Payload from the request it makes when none is given", () =>
    Effect.gen(function* () {
      const seen: Array<string> = [];
      const Note = Callable.make("note", { payload: { text: Schema.String } }).middleware(Recorder);
      const note = yield* Callable.handler(Note).pipe(
        Effect.provide(
          Layer.merge(
            Callable.toLayer(Note, () => Effect.void),
            Layer.succeed(Recorder, (effect) =>
              Effect.gen(function* () {
                const { rawRequest } = yield* CallableRequest.CallableRequest;
                seen.push(yield* Effect.orDie(rawRequest.text));
                return yield* effect;
              }),
            ),
          ),
        ),
      );
      const text = "x".repeat(1_000_000);
      yield* note({ text }, {});
      expect(seen).toEqual([`{"text":"${text}"}`]);
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

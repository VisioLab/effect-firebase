// The tests run Effects with requirements left on purpose, to check they are
// type errors; the language service would flag each of them a second time.
// @effect-diagnostics missingEffectContext:off
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as CallableMiddleware from "@visiolab/effect-firebase/functions/CallableMiddleware";
import * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";
import { Context, Effect, Layer, Schema } from "effect";
import { describe, expect, test } from "tstyche";

class Config extends Context.Service<Config, { readonly greeting: string }>()("test/Config") {}

/** Requires the Caller from a middleware outside it. */
class Admin extends CallableMiddleware.Service<Admin, { requires: Caller.Caller }>()("test/Admin", {
  error: CallableError.PermissionDenied,
}) {}

const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(Caller.Authenticated);

describe("CallableMiddleware.Service", () => {
  test("keeps what the middleware provides, requires and fails with", () => {
    expect<CallableMiddleware.Provides<Caller.Authenticated>>().type.toBe<Caller.Caller>();
    expect<CallableMiddleware.Requires<Admin>>().type.toBe<Caller.Caller>();
    expect<CallableMiddleware.Error<Admin>>().type.toBe<CallableError.PermissionDenied>();
  });

  test("an implementation gets the call needing what it provides", () => {
    // @ts-expect-error not assignable
    Layer.succeed(Caller.Authenticated, (effect) => effect);
  });

  test("an implementation may read the CallableRequest without requiring it", () => {
    expect(
      Layer.succeed(Admin, (effect) => Effect.flatMap(Effect.service(Caller.Caller), () => effect)),
    ).type.toBe<Layer.Layer<Admin>>();
  });
});

describe("Callable.middleware", () => {
  test("adds the middleware's errors to the Callable's", () => {
    expect<Callable.Error<typeof WhoAmI>>().type.toBe<CallableError.Unauthenticated>();
  });

  test("removes what the middleware provides from the handler's Layer", () => {
    expect(
      Callable.toLayer(WhoAmI, () => Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid)),
    ).type.toBe<Layer.Layer<Callable.Handler<Callable.NoGroup, "whoAmI">>>();
  });

  test("keeps the handler's own services in its Layer", () => {
    expect(
      Callable.toLayer(WhoAmI, () =>
        Effect.flatMap(Effect.service(Caller.Caller), () =>
          Effect.map(Effect.service(Config), ({ greeting }) => greeting),
        ),
      ),
    ).type.toBe<Layer.Layer<Callable.Handler<Callable.NoGroup, "whoAmI">, never, Config>>();
  });

  test("never requires the CallableRequest in the handler's Layer", () => {
    expect(
      Callable.toLayer(WhoAmI, () =>
        Effect.map(Effect.service(CallableRequest.CallableRequest), ({ data }) => String(data)),
      ),
    ).type.toBe<Layer.Layer<Callable.Handler<Callable.NoGroup, "whoAmI">>>();
  });

  test("a requirement an outer middleware provides is met", () => {
    const Purge = Callable.make("purge").middleware(Admin).middleware(Caller.Authenticated);
    expect<Callable.MiddlewareServices<typeof Purge>>().type.toBe<never>();
  });

  test("a requirement no outer middleware provides is left for the chain", () => {
    const Purge = Callable.make("purge").middleware(Caller.Authenticated).middleware(Admin);
    expect<Callable.MiddlewareServices<typeof Purge>>().type.toBe<Caller.Caller>();
  });
});

describe("Callable.handler", () => {
  test("requires the handler and every middleware implementation", () => {
    expect(Callable.handler(WhoAmI)).type.toBe<
      Effect.Effect<
        Callable.HandlerCall<typeof WhoAmI>,
        never,
        Callable.Handler<Callable.NoGroup, "whoAmI"> | Caller.Authenticated
      >
    >();
  });

  test("yields a function of the Payload and the request that fails with the middleware's errors", () => {
    expect<Callable.HandlerCall<typeof WhoAmI>>().type.toBe<
      (
        payload: void,
        request: CallableRequest.Input,
      ) => Effect.Effect<string, CallableError.Unauthenticated>
    >();
  });

  test("a middleware whose requires no outer middleware provides is a type error where the Layers are provided", () => {
    const Purge = Callable.make("purge").middleware(Caller.Authenticated).middleware(Admin);
    const program = Callable.handler(Purge).pipe(
      Effect.provide(
        Layer.mergeAll(
          Callable.toLayer(Purge, () => Effect.void),
          Caller.Authenticated.layer,
          Layer.succeed(Admin, (effect) => effect),
        ),
      ),
    );
    // @ts-expect-error not assignable
    void Effect.runPromise(program);
  });
});

/**
 * The Caller: the signed-in user making a call, and the built-in
 * `Authenticated` middleware that provides it.
 *
 * A Callable that requires a signed-in caller attaches {@link Authenticated}.
 * Its handler then reads the {@link Caller} instead of the raw request, and a
 * signed-out call fails with `CallableError.Unauthenticated` before its
 * Payload is decoded.
 *
 * @example Reading the Caller in a handler
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable, Caller } from "@visiolab/effect-firebase/functions";
 *
 * const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(
 *   Caller.Authenticated,
 * );
 *
 * const WhoAmILive = Callable.toLayer(WhoAmI, () =>
 *   Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
 * );
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import { Context, Effect, Layer } from "effect";
import * as CallableError from "./CallableError.ts";
import * as CallableMiddleware from "./CallableMiddleware.ts";
import * as CallableRequest from "./CallableRequest.ts";

/**
 * The signed-in user making a call.
 *
 * **Details**
 *
 * A portable shape, not `firebase-admin`'s `DecodedIdToken`. There is no
 * constructor: {@link Authenticated} provides it from the request, and a test
 * provides a fake one from a stub middleware Layer.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Caller {
  /** The user's uid. */
  readonly uid: string;
  /** The decoded claims of the user's ID token. */
  readonly token: Readonly<Record<string, unknown>>;
  /** The ID token as the client sent it. */
  readonly rawToken: string;
}

/**
 * The service key of the {@link Caller}.
 *
 * @stability unstable
 * @category services
 * @since 0.3.0
 */
export const Caller: Context.Service<Caller, Caller> = Context.Service<Caller>(
  "@visiolab/effect-firebase/functions/Caller",
);

/**
 * The built-in middleware that requires a signed-in caller and provides the
 * {@link Caller}.
 *
 * **When to use**
 *
 * Use on every Callable that only a signed-in user may call. Write a
 * middleware of your own with {@link CallableMiddleware.Service} for other
 * requirements, such as a custom claim.
 *
 * **Details**
 *
 * A call without auth fails with `CallableError.Unauthenticated`, before its
 * Payload is decoded. Provide {@link Authenticated.layer} where the chain
 * runs, or a stub Layer that provides a fake Caller in tests.
 *
 * @example Stubbing the Caller in process
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Callable, Caller } from "@visiolab/effect-firebase/functions";
 *
 * const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(
 *   Caller.Authenticated,
 * );
 *
 * const WhoAmILive = Callable.toLayer(WhoAmI, () =>
 *   Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
 * );
 *
 * const AsAda = Layer.succeed(Caller.Authenticated, (effect) =>
 *   Effect.provideService(effect, Caller.Caller, { uid: "ada", token: {}, rawToken: "" }),
 * );
 *
 * const program = Effect.gen(function* () {
 *   const whoAmI = yield* Callable.handler(WhoAmI);
 *   return yield* whoAmI(undefined, {});
 * }).pipe(Effect.provide(Layer.merge(WhoAmILive, AsAda)));
 * ```
 *
 * @see {@link Caller} for what it provides
 * @see {@link CallableMiddleware.Service} for declaring a middleware of your own
 *
 * @stability unstable
 * @category middleware
 * @since 0.3.0
 */
export class Authenticated extends CallableMiddleware.Service<
  Authenticated,
  { provides: Caller }
>()("@visiolab/effect-firebase/functions/Caller/Authenticated", {
  error: CallableError.Unauthenticated,
}) {
  /**
   * The implementation of {@link Authenticated}: provides the {@link Caller}
   * from the request's auth, and fails with `CallableError.Unauthenticated`
   * when there is none.
   *
   * **When to use**
   *
   * Use where the chain runs, in production and in process alike.
   *
   * @stability unstable
   * @category layers
   * @since 0.3.0
   */
  static readonly layer: Layer.Layer<Authenticated> = Layer.succeed(this, (effect) =>
    Effect.gen(function* () {
      const { auth } = yield* Effect.service(CallableRequest.CallableRequest);
      if (auth === undefined) return yield* new CallableError.Unauthenticated();
      return yield* Effect.provideService(effect, Caller, {
        uid: auth.uid,
        token: auth.token,
        rawToken: auth.rawToken,
      });
    }),
  );
}

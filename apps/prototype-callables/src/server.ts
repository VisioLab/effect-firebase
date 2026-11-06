// PROTOTYPE, throwaway. Rough stand-in for @visiolab/effect-firebase-functions/https
// (CallableFunction, CallableRequest).
import { Cause, Context, Effect, Exit, Layer, Schema, Scope } from "effect";
import { HttpsError, onCall, type CallableOptions, type CallableRequest as FbRequest } from "firebase-functions/v2/https";
import {
  allErrors,
  Authenticated,
  Caller,
  getErrorCode,
  Unauthenticated,
  type AnyCallable,
  type Callable,
  type CallableGroup,
  type Handler,
} from "./core.ts";

/** The raw request, minus `data`. Always in scope for middleware. */
export class CallableRequest extends Context.Service<
  CallableRequest,
  Omit<FbRequest<unknown>, "data"> & { readonly data: unknown }
>()("effect-firebase-functions/CallableRequest") {}

// ---------------------------------------------------------------------------
// Process-wide memo map + scope, disposed on SIGTERM

const memoMap = Layer.makeMemoMapUnsafe();
const scope = Effect.runSync(Scope.make());

process.once("SIGTERM", () => {
  const t0 = Date.now();
  console.log(`[prototype] SIGTERM received, closing memo map scope`);
  Effect.runPromise(Scope.close(scope, Exit.void)).then(() =>
    console.log(`[prototype] scope closed after ${Date.now() - t0}ms`),
  );
});

// Built on first call, concurrent first calls share one build, a failure is
// not cached. Layer.buildWithMemoMap already shares builds of the same Layer
// reference; we only have to forget a failed one.
const contextFor = (live: Layer.Layer<any, any, any>) => {
  let pending: Promise<Context.Context<any>> | undefined;
  return () => {
    pending ??= Effect.runPromise(Layer.buildWithMemoMap(live as Layer.Layer<any>, memoMap, scope)).catch((e) => {
      pending = undefined;
      throw e;
    });
    return pending;
  };
};

// ---------------------------------------------------------------------------
// One call

const AuthenticatedLive = Layer.succeed(Authenticated, ((effect: Effect.Effect<unknown, unknown, Caller>) =>
  Effect.gen(function* () {
    const request = yield* CallableRequest;
    if (!request.auth) return yield* new Unauthenticated({ message: "Sign in first" });
    return yield* Effect.provideService(effect, Caller, {
      uid: request.auth.uid,
      claims: request.auth.token,
      token: request.auth.rawToken,
    });
  })) as any);

const toHttpsError = (callable: AnyCallable, error: unknown) =>
  Effect.gen(function* () {
    for (const schema of allErrors(callable)) {
      if (!Schema.is(schema)(error)) continue;
      const details = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(error);
      const message =
        typeof (error as any)?.message === "string" && (error as any).message !== ""
          ? (error as any).message
          : ((error as any)?._tag ?? getErrorCode(schema));
      return new HttpsError(getErrorCode(schema), message, details);
    }
    return yield* Effect.die(error);
  });

const runCall = (
  callable: AnyCallable,
  context: Context.Context<any>,
  request: FbRequest<unknown>,
) => {
  const handler = Context.get(context, callable.handlerKey);
  // Middleware runs before decode, as in HttpApiBuilder.
  let effect: Effect.Effect<unknown, unknown, any> = Schema.decodeUnknownEffect(
    Schema.toCodecJson(callable.payload),
  )(request.data).pipe(
    Effect.catchTag("SchemaError", (e) =>
      Effect.logDebug("Payload failed to decode", e).pipe(
        Effect.andThen(Effect.die(new HttpsError("invalid-argument", "Invalid payload"))),
      ),
    ),
    Effect.flatMap(handler),
    Effect.flatMap((value) =>
      Schema.encodeUnknownEffect(Schema.toCodecJson(callable.success))(value).pipe(Effect.orDie),
    ),
  );
  for (const m of [...callable.middlewares].reverse()) {
    effect = Context.get(context, m)(effect, { callable });
  }
  return effect.pipe(
    Effect.provideService(CallableRequest, request),
    Effect.catch((error) => toHttpsError(callable, error).pipe(Effect.flatMap(Effect.fail))),
  );
};

const makeOnCall = (
  callable: AnyCallable,
  name: string,
  getContext: () => Promise<Context.Context<any>>,
  options: CallableOptions = {},
) =>
  onCall(options, async (request, response) => {
    let context: Context.Context<any>;
    try {
      context = await getContext();
    } catch (cause) {
      console.error(`[${name}] Layer failed to build`, cause);
      throw new HttpsError("internal", "INTERNAL");
    }
    const exit = await Effect.runPromiseExit(runCall(callable, context, request) as Effect.Effect<unknown, unknown>, {
      signal: response?.signal,
    });
    if (Exit.isSuccess(exit)) return exit.value;
    const fail = exit.cause.reasons.find(Cause.isFailReason);
    if (fail) throw fail.error;
    const die = exit.cause.reasons.find(Cause.isDieReason);
    if (die && die.defect instanceof HttpsError) throw die.defect;
    if (Cause.hasInterruptsOnly(exit.cause)) {
      throw new HttpsError(response?.signal?.aborted ? "cancelled" : "unavailable", "Interrupted");
    }
    console.error(`[${name}] defect`, Cause.pretty(exit.cause));
    throw new HttpsError("internal", "INTERNAL");
  });

// ---------------------------------------------------------------------------
// Public shape

type Live<C> = Layer.Layer<C extends Callable<infer N, any, any, any, any> ? Handler<N> : never, any, Authenticated>;

export const make = <C extends Callable<any, any, any, any, any>>(
  callable: C,
  live: Live<C>,
  options?: CallableOptions,
): { readonly [K in C["name"]]: ReturnType<typeof onCall> } => {
  const getContext = contextFor(Layer.provideMerge(live as Layer.Layer<any, any, any>, AuthenticatedLive));
  return { [callable.name]: makeOnCall(callable, callable.name, getContext, options) } as any;
};

export const group = <Name extends string, Members extends Callable<any, any, any, any, any>>(
  g: CallableGroup<Name, Members>,
  live: Live<Members>,
  options?: { readonly [K in Members["name"]]?: CallableOptions },
): { readonly [K in Name]: { readonly [N in Members["name"]]: ReturnType<typeof onCall> } } => {
  const getContext = contextFor(Layer.provideMerge(live as Layer.Layer<any, any, any>, AuthenticatedLive));
  const exports: Record<string, unknown> = {};
  for (const c of g.callables) {
    exports[c.name] = makeOnCall(c, `${g.name}-${c.name}`, getContext, (options as any)?.[c.name]);
  }
  return { [g.name]: exports } as any;
};


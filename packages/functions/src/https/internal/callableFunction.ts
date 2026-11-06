/** @internal */
import { Cause, Effect, Exit, Layer, Scope, type Context, type Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import type * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import * as Https from "firebase-functions/v2/https";
import { DeferredTracer, externalParent } from "./serverSpan.ts";

/**
 * The memo map and scope every Layer of this process is built in, so a Layer
 * that several exports share is built once. The scope is never closed:
 * functions-framework exits the process without waiting for finalizers.
 */
const memoMap = Layer.makeMemoMapUnsafe();
const scope = Scope.makeUnsafe();

/**
 * Builds `live` on the first call, and hands every later call the same
 * services. Concurrent first calls share one build. The build runs under the
 * span and Tracer of the call that starts it, so it nests under that call.
 */
const lazyContext = <R, E>(live: Layer.Layer<R, E>) => {
  let pending: Promise<Exit.Exit<Context.Context<R>, E>> | undefined;
  return Effect.flatMap(Effect.context<never>(), (caller) => {
    pending ??= Effect.runPromiseExit(
      Layer.buildWithMemoMap(live, memoMap, scope).pipe(Effect.provideContext(caller)),
    ).then((exit) => {
      if (Exit.isFailure(exit)) pending = undefined;
      return exit;
    });
    const attempt = pending;
    return Effect.flatten(Effect.promise(() => attempt));
  });
};

const internalError = () => new Https.HttpsError("internal", "INTERNAL");

/**
 * The one Callable Function of `callable`, in `group` or in no group. Each
 * export builds `live` on its own first call, so a worker that serves one
 * export builds nothing for the others.
 *
 * @internal
 */
export const onCall = <R, E>(
  group: CallableGroup.Any | undefined,
  callable: Callable.Any,
  live: Layer.Layer<R, E>,
  options: Https.CallableOptions = {},
) => {
  const context = lazyContext(live);
  const serve: Effect.Effect<
    (data: unknown) => Effect.Effect<unknown, Schema.SchemaError>,
    never,
    Callable.Handler<unknown, string>
  > = group === undefined ? Callable.serve(callable) : Callable.serve(group, callable.name);
  const deployedName = group === undefined ? callable.name : `${group.identifier}-${callable.name}`;
  const spanOptions = {
    kind: "server",
    attributes: {
      "rpc.system": "firebase_callable",
      "rpc.method": callable.name,
      ...(group === undefined ? {} : { "rpc.service": group.identifier }),
      "faas.name": deployedName,
    },
  } as const;
  return Https.onCall<unknown, Promise<unknown>>(options, async (request) => {
    const parent = externalParent();
    const deferred = new DeferredTracer();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const services = yield* context.pipe(
          Effect.tapCause((cause) =>
            Effect.logError("The Layer of a Callable failed to build", Cause.pretty(cause)),
          ),
        );
        deferred.attach(services as Context.Context<never>);
        return yield* serve.pipe(
          Effect.flatMap((run) => run(request.data)),
          Effect.tapCause((cause) => Effect.logError("A Callable failed", Cause.pretty(cause))),
          // The public signatures check that `live` provides the handler.
          Effect.provideContext(services as Context.Context<any>),
        );
      }).pipe(
        Effect.withSpan(`CallableFunction.${deployedName}`, { ...spanOptions, parent }),
        Effect.withTracer(deferred.tracer),
      ),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw internalError();
  });
};

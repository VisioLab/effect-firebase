/** @internal */
import { Cause, Effect, Exit, Layer, Scope, type Context, type Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import type * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import * as Https from "firebase-functions/v2/https";

/**
 * The memo map and scope every Layer of this process is built in, so a Layer
 * that several exports share is built once. The scope is never closed:
 * functions-framework exits the process without waiting for finalizers.
 */
const memoMap = Layer.makeMemoMapUnsafe();
const scope = Scope.makeUnsafe();

/**
 * Builds `live` on the first call, and hands every later call the same
 * services. Concurrent first calls share one build.
 */
const lazyContext = <R, E>(live: Layer.Layer<R, E>) => {
  let pending: Promise<Context.Context<R>> | undefined;
  return () => {
    pending ??= Effect.runPromise(Layer.buildWithMemoMap(live, memoMap, scope)).catch(
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
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
  return Https.onCall<unknown, Promise<unknown>>(options, async (request) => {
    let services: Context.Context<R>;
    try {
      services = await context();
    } catch (error) {
      await Effect.runPromise(Effect.logError("The Layer of a Callable failed to build", error));
      throw internalError();
    }
    const exit = await Effect.runPromiseExit(
      serve.pipe(
        Effect.flatMap((run) => run(request.data)),
        // The public signatures check that `live` provides the handler.
        Effect.provideContext(services as Context.Context<any>),
      ),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    await Effect.runPromise(Effect.logError("A Callable failed", Cause.pretty(exit.cause)));
    throw internalError();
  });
};

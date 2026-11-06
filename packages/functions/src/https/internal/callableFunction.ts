/** @internal */
import { Cause, Effect, Exit, Layer, Scope, type Context } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
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

/** @internal */
export const onCall = <C extends Callable.Any, E>(
  callable: C,
  live: Layer.Layer<Callable.HandlerFor<C>, E>,
  options: Https.CallableOptions = {},
) => {
  const context = lazyContext(live);
  return Https.onCall<unknown, Promise<unknown>>(options, async (request) => {
    let services: Context.Context<Callable.HandlerFor<C>>;
    try {
      services = await context();
    } catch (error) {
      await Effect.runPromise(Effect.logError("The Layer of a Callable failed to build", error));
      throw internalError();
    }
    const exit = await Effect.runPromiseExit(
      Callable.serve(callable).pipe(
        Effect.flatMap((serve) => serve(request.data)),
        Effect.provideContext(services),
      ),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    await Effect.runPromise(Effect.logError("A Callable failed", Cause.pretty(exit.cause)));
    throw internalError();
  });
};

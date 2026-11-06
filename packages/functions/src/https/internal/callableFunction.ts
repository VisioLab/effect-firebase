/** @internal */
import { Cause, Effect, Exit, Layer, Scope, type Context } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as Https from "firebase-functions/v2/https";

/**
 * The memo map and scope every Layer of this process is built in, so a Layer
 * that several exports share is built once. The scope is never closed:
 * functions-framework exits the process without waiting for finalizers.
 */
const memoMap = Layer.makeMemoMapUnsafe();
const scope = Scope.makeUnsafe();

const internalError = () => new Https.HttpsError("internal", "INTERNAL");

/**
 * Builds `live` on the first call, and hands every later call the same
 * services. Concurrent first calls share one build.
 *
 * A failed build fails the call with a bare `internal` and is tried again on
 * the next call. A Layer that fails closes the scope it was built in, which
 * drops its failed entries from the memo map, so the retry builds anew.
 */
const lazyContext = <R, E>(live: Layer.Layer<R, E>) => {
  let pending: Promise<Context.Context<R>> | undefined;
  const build = async () => {
    const exit = await Effect.runPromiseExit(Layer.buildWithMemoMap(live, memoMap, scope));
    if (Exit.isSuccess(exit)) return exit.value;
    pending = undefined;
    await Effect.runPromise(
      Effect.logError("The Layer of a Callable failed to build", Cause.pretty(exit.cause)),
    );
    throw internalError();
  };
  return () => (pending ??= build());
};

/**
 * The `HttpsError` a failed call answers with. A failure is already the
 * answer `Callable.serve` chose. An interrupt is `cancelled` when the client
 * went away and `unavailable` otherwise. Anything else is a bare `internal`,
 * and its Cause is logged.
 */
const toHttpsError = (cause: Cause.Cause<unknown>, aborted: boolean) => {
  const failure = cause.reasons.find(Cause.isFailReason)?.error;
  if (failure instanceof CallableError.CallableError && failure.reason._tag === "ResponseError") {
    const { code, message, details } = failure.reason;
    return Effect.succeed(new Https.HttpsError(code, message, details));
  }
  if (Cause.hasInterruptsOnly(cause)) {
    return Effect.succeed(
      aborted
        ? new Https.HttpsError("cancelled", "CANCELLED")
        : new Https.HttpsError("unavailable", "UNAVAILABLE"),
    );
  }
  return Effect.as(Effect.logError("A Callable failed", Cause.pretty(cause)), internalError());
};

/** @internal */
export const onCall = <C extends Callable.Any, E>(
  callable: C,
  live: Layer.Layer<Callable.HandlerFor<C>, E>,
  options: Https.CallableOptions = {},
) => {
  const context = lazyContext(live);
  return Https.onCall<unknown, Promise<unknown>>(options, async (request, response) => {
    const services = await context();
    const signal = response?.signal;
    const exit = await Effect.runPromiseExit(
      Callable.serve(callable).pipe(
        Effect.flatMap((serve) => serve(request.data)),
        Effect.provideContext(services),
      ),
      signal === undefined ? undefined : { signal },
    );
    if (Exit.isSuccess(exit)) return exit.value;
    // Logged with the services of `live`, so a logger it provides is used.
    throw await Effect.runPromise(
      toHttpsError(exit.cause, signal?.aborted === true).pipe(Effect.provideContext(services)),
    );
  });
};

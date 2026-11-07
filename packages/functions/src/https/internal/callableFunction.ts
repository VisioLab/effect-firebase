/** @internal */
import { Cause, Context, Effect, Exit, Layer, Logger, Scope } from "effect";
import * as CloudLogging from "../../logger/CloudLogging.ts";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import type * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import type * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import * as Https from "firebase-functions/v2/https";
import * as FunctionsCallableRequest from "../FunctionsCallableRequest.ts";
import { DeferredTracer, externalParent } from "./serverSpan.ts";

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
 * services. Concurrent first calls share one build. The build runs under the
 * span and Tracer of the call that starts it, so it nests under that call.
 *
 * A failed build fails the call and is tried again on the next call. A Layer
 * that fails closes the scope it was built in, which drops its failed entries
 * from the memo map, so the retry builds anew.
 */
const lazyContext = <R, E>(
  live: Layer.Layer<R, E, FunctionsCallableRequest.FunctionsCallableRequest>,
) => {
  // The request is provided to each call, and the handler Layers that list it
  // read it only then, so the build itself needs nothing.
  const build = live as Layer.Layer<R, E>;
  let pending: Promise<Exit.Exit<Context.Context<R>, E>> | undefined;
  return Effect.flatMap(Effect.context<never>(), (caller) => {
    pending ??= Effect.runPromiseExit(
      Layer.buildWithMemoMap(build, memoMap, scope).pipe(Effect.provideContext(caller)),
    ).then((exit) => {
      if (Exit.isFailure(exit)) pending = undefined;
      return exit;
    });
    const attempt = pending;
    return Effect.flatten(Effect.promise(() => attempt));
  });
};

/** Whether `cause` is a failure `Callable.serve` already turned into an answer. */
const isAnswer = <E>(cause: Cause.Cause<E>) => {
  const failure = cause.reasons.find(Cause.isFailReason)?.error;
  return failure instanceof CallableError.CallableError && failure.reason._tag === "ResponseError";
};

/**
 * Logs the Cause of a call that failed unexpectedly: a defect, or a failure
 * that isn't an answer. Answers and interrupts aren't logged.
 */
const logUnexpected =
  (message: string) =>
  <E>(cause: Cause.Cause<E>) =>
    isAnswer(cause) || Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.logError(message, cause);

/**
 * The `HttpsError` a failed call answers with. A failure is already the
 * answer `Callable.serve` chose. An interrupt is `cancelled` when the client
 * went away and `unavailable` otherwise. Anything else, logged in the call's
 * span by {@link logUnexpected}, is a bare `internal`.
 */
const toHttpsError = (cause: Cause.Cause<unknown>, aborted: boolean) => {
  const failure = cause.reasons.find(Cause.isFailReason)?.error;
  if (failure instanceof CallableError.CallableError && failure.reason._tag === "ResponseError") {
    const { code, message, details } = failure.reason;
    return new Https.HttpsError(code, message, details);
  }
  if (Cause.hasInterruptsOnly(cause)) {
    return aborted
      ? new Https.HttpsError("cancelled", "CANCELLED")
      : new Https.HttpsError("unavailable", "UNAVAILABLE");
  }
  return internalError();
};

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
  live: Layer.Layer<R, E, FunctionsCallableRequest.FunctionsCallableRequest>,
  options: Https.CallableOptions = {},
) => {
  const context = lazyContext(live);
  const serve: Effect.Effect<
    (
      request: CallableRequest.CallableRequest,
    ) => Effect.Effect<unknown, CallableError.CallableError>,
    never,
    unknown
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
  return Https.onCall<unknown, Promise<unknown>>(options, async (request, response) => {
    const parent = externalParent();
    const deferred = new DeferredTracer();
    const signal = response?.signal;
    const callRequest = FunctionsCallableRequest.make(request);
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const services = yield* context.pipe(
          // With no services to take a Tracer from, the call's spans and held
          // logs go to the native Tracer, so the failure is logged in one trace.
          Effect.onError(() => Effect.sync(() => deferred.attach(Context.empty()))),
          Effect.onError(logUnexpected("The Layer of a Callable failed to build")),
        );
        deferred.attach(services as Context.Context<never>);
        return yield* serve.pipe(
          Effect.flatMap((run) => run(callRequest)),
          // Logged with the services of `live`, so a logger it provides is used.
          Effect.onError(logUnexpected("A Callable failed")),
          // Firebase's request, under both keys, over the services of `live`.
          Effect.provideContext(FunctionsCallableRequest.context(callRequest)),
          // The public signatures check that `live` provides the handler and
          // every middleware implementation.
          Effect.provideContext(services as Context.Context<any>),
        );
      }).pipe(
        Effect.withSpan(`CallableFunction.${deployedName}`, { ...spanOptions, parent }),
        // Logs from before `live` is built wait for the spans' real ids.
        Effect.updateService(Logger.CurrentLoggers, (loggers) => deferred.holdLogs(loggers)),
        // Beneath `live`: a logger that `live` provides replaces this one.
        Effect.provide(CloudLogging.layer),
        Effect.withTracer(deferred.tracer),
      ),
      signal === undefined ? undefined : { signal },
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw toHttpsError(exit.cause, signal?.aborted === true);
  });
};

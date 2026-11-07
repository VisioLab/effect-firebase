/**
 * What every kind of Function runs an event or a call under: the lazy,
 * memoized build of its Layer, its server span, its Tracer and its logs.
 *
 * A kind's runtime turns what `firebase-functions` hands over into the input
 * of its core `serve`, and passes that to {@link make}'s run function, which
 * does the rest.
 *
 * @internal
 */
import { type Cause, Context, Effect, Exit, Layer, Logger, Scope } from "effect";
import * as CloudLogging from "../logger/CloudLogging.ts";
import { DeferredTracer, externalParent } from "./serverSpan.ts";

/**
 * The memo map and scope every Layer of this process is built in, so a Layer
 * that several exports share is built once. The scope is never closed:
 * functions-framework exits the process without waiting for finalizers.
 */
const memoMap = Layer.makeMemoMapUnsafe();
const scope = Scope.makeUnsafe();

/**
 * Builds `live` on the first event, and hands every later event the same
 * services. Concurrent first events share one build. The build runs under the
 * span and Tracer of the event that starts it, so it nests under that event.
 *
 * A failed build fails the event and is tried again on the next one. A Layer
 * that fails closes the scope it was built in, which drops its failed entries
 * from the memo map, so the retry builds anew.
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

/**
 * How one export runs each event or call.
 *
 * @internal
 */
export interface Options {
  /** The name of the `kind: "server"` span each event or call runs in. */
  readonly span: string;
  /** The attributes of that span. */
  readonly attributes: Readonly<Record<string, unknown>>;
  /**
   * Logs the Cause of a Layer that failed to build, in the span of the event
   * or call that built it.
   */
  readonly onBuildFailure: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
}

/**
 * The run function of one export: it builds `live` on the export's first
 * event or call, so a worker that serves one export builds nothing for the
 * others, and runs each `body` with the services of `live` provided.
 *
 * The run happens in a `kind: "server"` span, parented on the trace context
 * Firebase read from the event or request. Its spans go to the Tracer of
 * `live`, its logs go through `CloudLogging.layer` unless `live` provides a
 * logger, and logs from before `live` is built wait until the spans have
 * their final ids.
 *
 * Read the trace context synchronously, at the start of the SDK's handler:
 * call the run function there.
 *
 * @internal
 */
export const make = <R, E>(live: Layer.Layer<R, E>, options: Options) => {
  const context = lazyContext(live);
  const spanOptions = { kind: "server", attributes: options.attributes } as const;
  return <A>(
    body: Effect.Effect<A, unknown, unknown>,
    signal?: AbortSignal,
  ): Promise<Exit.Exit<A, unknown>> => {
    const parent = externalParent();
    const deferred = new DeferredTracer();
    return Effect.runPromiseExit(
      Effect.gen(function* () {
        const services = yield* context.pipe(
          // With no services to take a Tracer from, the run's spans and held
          // logs go to the native Tracer, so the failure is logged in one trace.
          Effect.onError(() => Effect.sync(() => deferred.attach(Context.empty()))),
          Effect.onError(options.onBuildFailure),
        );
        deferred.attach(services as Context.Context<never>);
        // The public signatures check that `live` provides what `body` needs.
        return yield* Effect.provideContext(body, services as Context.Context<any>);
      }).pipe(
        Effect.withSpan(options.span, { ...spanOptions, parent }),
        // Logs from before `live` is built wait for the spans' real ids.
        Effect.updateService(Logger.CurrentLoggers, (loggers) => deferred.holdLogs(loggers)),
        // Beneath `live`: a logger that `live` provides replaces this one.
        Effect.provide(CloudLogging.layer),
        Effect.withTracer(deferred.tracer),
      ),
      signal === undefined ? undefined : { signal },
    );
  };
};

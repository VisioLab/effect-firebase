/**
 * A Logger that writes Effect logs as Cloud Logging structured entries, one
 * JSON line each, tied to the trace of the fiber's current span.
 *
 * `CallableFunction` installs it for every call, beneath the Layer you serve,
 * so you need this module only to log the same way elsewhere, or to change
 * how a Callable Function logs.
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Cause, Console, Effect, Formatter, Inspectable, Layer, Logger, References } from "effect";
import type * as LogLevel from "effect/LogLevel";

const severities: Record<LogLevel.LogLevel, string> = {
  All: "DEFAULT",
  Trace: "DEBUG",
  Debug: "DEBUG",
  Info: "INFO",
  Warn: "WARNING",
  Error: "ERROR",
  Fatal: "CRITICAL",
  None: "DEFAULT",
};

/**
 * The Cloud Logging logger: writes each entry as one JSON line, the format
 * Firebase's own `logger` writes, to `console.error` for Error and Fatal and
 * to `console.log` for everything else.
 *
 * **When to use**
 *
 * Use with `Logger.layer` to combine it with other loggers. To replace
 * Effect's default logger with it, use {@link layer}.
 *
 * **Details**
 *
 * Each entry is a JSON object with these fields:
 *
 * - `severity`: Trace and Debug are `DEBUG`, Info is `INFO`, Warn is
 *   `WARNING`, Error is `ERROR` and Fatal is `CRITICAL`.
 * - `message`: the first value logged. A non-empty Cause is appended as
 *   `Cause.pretty` output, with its stacks, so Error Reporting picks up
 *   defects.
 * - `args`: the other values logged, if any.
 * - `spans`: the log spans, as `{ label: milliseconds }`, if any.
 * - `logging.googleapis.com/trace`, `logging.googleapis.com/spanId` and
 *   `logging.googleapis.com/trace_sampled`: the trace of the fiber's current
 *   span, with the project from `GCLOUD_PROJECT`. Left out when there is no
 *   span.
 * - Every log annotation, as a field of its own. `severity`, `message` and the
 *   `logging.googleapis.com/` fields win over an annotation of the same name.
 *
 * The trace comes from the fiber, never from Firebase's `traceContext`, so
 * concurrent requests on one instance each log under their own trace. Lines go
 * to the `Console` service, which is the global `console` unless you provide
 * another. Entries carry no uid: add one with `Effect.annotateLogs`.
 *
 * @example Logging under a uid
 * ```ts
 * import { Effect } from "effect";
 * import { CloudLogging } from "@visiolab/effect-firebase-functions/logger";
 *
 * const program = Effect.log("Order placed").pipe(
 *   Effect.annotateLogs({ uid: "user-1" }),
 *   Effect.provide(CloudLogging.layer),
 * );
 * ```
 *
 * @see {@link layer} for replacing Effect's default logger with it
 *
 * @stability unstable
 * @category loggers
 * @since 0.1.0
 */
export const logger: Logger.Logger<unknown, void> = Logger.make(
  ({ cause, date, fiber, logLevel, message }) => {
    const values = Array.isArray(message) ? message : [message];
    const [first, ...args] = values;
    let text =
      values.length === 0
        ? ""
        : typeof first === "string"
          ? first
          : Inspectable.toStringUnknown(first);
    if (cause.reasons.length > 0) {
      const pretty = Cause.pretty(cause);
      text = text === "" ? pretty : `${text}\n${pretty}`;
    }

    const entry: Record<string, unknown> = { ...fiber.getRef(References.CurrentLogAnnotations) };
    if (args.length > 0) entry["args"] = args;
    const logSpans = fiber.getRef(References.CurrentLogSpans);
    if (logSpans.length > 0) {
      const now = date.getTime();
      entry["spans"] = Object.fromEntries(logSpans.map(([label, start]) => [label, now - start]));
    }
    for (const key of Object.keys(entry)) {
      if (key.startsWith("logging.googleapis.com/")) delete entry[key];
    }
    entry["severity"] = severities[logLevel];
    entry["message"] = text;
    const span = fiber.cache.span;
    if (span !== undefined) {
      entry["logging.googleapis.com/trace"] =
        `projects/${process.env["GCLOUD_PROJECT"]}/traces/${span.traceId}`;
      entry["logging.googleapis.com/spanId"] = span.spanId;
      entry["logging.googleapis.com/trace_sampled"] = span.sampled;
    }

    const console = fiber.getRef(Console.Console);
    const line = Formatter.formatJson(entry);
    if (logLevel === "Error" || logLevel === "Fatal") console.error(line);
    else console.log(line);
  },
);

/**
 * Replaces Effect's default logger with the Cloud Logging {@link logger},
 * and keeps every other logger, such as the one that records logs as span
 * events.
 *
 * **When to use**
 *
 * Use to log as Cloud Logging entries outside a Callable Function, in any
 * Effect program that runs on Google Cloud. Callable Functions already log
 * this way.
 *
 * **Details**
 *
 * Provided in the Layer of a Callable Function, it changes nothing. To log
 * differently there, provide your own `Logger.layer`, which wins over this one.
 *
 * @example Logging from a scheduled job
 * ```ts
 * import { Effect } from "effect";
 * import { CloudLogging } from "@visiolab/effect-firebase-functions/logger";
 *
 * const job = Effect.log("Cleaning up").pipe(
 *   Effect.withSpan("cleanup"),
 *   Effect.provide(CloudLogging.layer),
 * );
 * ```
 *
 * @see {@link logger} for the logger on its own
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer: Layer.Layer<never> = Layer.effect(
  Logger.CurrentLoggers,
  Effect.withFiber((fiber) => {
    const loggers = new Set(fiber.getRef(Logger.CurrentLoggers));
    loggers.delete(Logger.defaultLogger);
    loggers.add(logger);
    return Effect.succeed(loggers);
  }),
);

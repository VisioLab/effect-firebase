import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Layer, Logger, References, Tracer } from "effect";
import { TestConsole } from "effect/testing";
import * as CloudLogging from "../../src/logger/CloudLogging.ts";

const project = "demo-effect-firebase";

/** Runs `effect` with the Cloud Logging logger, and returns what it wrote to each console method. */
const captured = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const value = yield* effect;
    const parse = (lines: ReadonlyArray<unknown>) =>
      lines.map((line) => JSON.parse(String(line)) as Record<string, unknown>);
    return {
      value,
      log: parse(yield* TestConsole.logLines),
      error: parse(yield* TestConsole.errorLines),
    };
  }).pipe(Effect.provide(Layer.merge(CloudLogging.layer, TestConsole.layer)));

describe("CloudLogging", () => {
  it.effect("writes the trace of the current span", () =>
    Effect.gen(function* () {
      const parent = Tracer.externalSpan({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        sampled: true,
      });
      const { value: span, log } = yield* captured(
        Effect.gen(function* () {
          const span = yield* Effect.currentSpan;
          yield* Effect.log("hello");
          return span;
        }).pipe(Effect.withSpan("request", { parent }), Effect.orDie),
      );
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        severity: "INFO",
        message: "hello",
        "logging.googleapis.com/trace": `projects/${project}/traces/4bf92f3577b34da6a3ce929d0e0e4736`,
        "logging.googleapis.com/trace_sampled": true,
      });
      expect(log[0]?.["logging.googleapis.com/spanId"]).toBe(span.spanId);
      expect(span.spanId).not.toBe("00f067aa0ba902b7");
    }),
  );

  it.effect("leaves the trace out without a span", () =>
    Effect.gen(function* () {
      const { log } = yield* captured(Effect.log("hello"));
      expect(log).toEqual([{ severity: "INFO", message: "hello" }]);
    }),
  );

  it.effect("sets the trace of a root span", () =>
    Effect.gen(function* () {
      const { value: span, log } = yield* captured(
        Effect.log("hello").pipe(
          Effect.andThen(Effect.currentSpan),
          Effect.withSpan("root"),
          Effect.orDie,
        ),
      );
      expect(log).toEqual([
        {
          severity: "INFO",
          message: "hello",
          "logging.googleapis.com/trace": `projects/${project}/traces/${span.traceId}`,
          "logging.googleapis.com/spanId": span.spanId,
          "logging.googleapis.com/trace_sampled": true,
        },
      ]);
    }),
  );

  it.live("logs concurrent fibers each under its own trace", () =>
    Effect.gen(function* () {
      const traceIds = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
      const { log } = yield* captured(
        Effect.forEach(
          traceIds,
          (traceId) =>
            Effect.gen(function* () {
              yield* Effect.log("first");
              yield* Effect.yieldNow;
              yield* Effect.sleep("1 millis");
              yield* Effect.log("second");
            }).pipe(
              Effect.annotateLogs({ expected: traceId }),
              Effect.withSpan("request", {
                parent: Tracer.externalSpan({ traceId, spanId: "0".repeat(15) + "1" }),
              }),
            ),
          { concurrency: "unbounded" },
        ),
      );
      expect(log).toHaveLength(6);
      // Interleaved, so a trace read from shared state would show up here.
      expect(log.slice(0, 3).map((entry) => entry["message"])).toEqual(["first", "first", "first"]);
      for (const entry of log) {
        expect(entry["logging.googleapis.com/trace"]).toBe(
          `projects/${project}/traces/${String(entry["expected"])}`,
        );
      }
    }),
  );

  it.effect("maps each level to its severity and console method", () =>
    Effect.gen(function* () {
      const { log, error } = yield* captured(
        Effect.gen(function* () {
          yield* Effect.logTrace("trace");
          yield* Effect.logDebug("debug");
          yield* Effect.logInfo("info");
          yield* Effect.logWarning("warn");
          yield* Effect.logError("error");
          yield* Effect.logFatal("fatal");
        }).pipe(Effect.provideService(References.MinimumLogLevel, "All")),
      );
      expect(log).toEqual([
        { severity: "DEBUG", message: "trace" },
        { severity: "DEBUG", message: "debug" },
        { severity: "INFO", message: "info" },
        { severity: "WARNING", message: "warn" },
      ]);
      expect(error).toEqual([
        { severity: "ERROR", message: "error" },
        { severity: "CRITICAL", message: "fatal" },
      ]);
    }),
  );

  it.effect("keeps Effect's minimum level", () =>
    Effect.gen(function* () {
      const { log } = yield* captured(Effect.logDebug("debug"));
      expect(log).toEqual([]);
    }),
  );

  it.effect(
    "puts annotations at the top level, other values under args and log spans under spans",
    () =>
      Effect.gen(function* () {
        const { log } = yield* captured(
          Effect.log("placed", { id: 1 }, 2).pipe(
            Effect.annotateLogs({
              uid: "user-1",
              severity: "annotated",
              message: "annotated",
              "logging.googleapis.com/trace": "annotated",
            }),
            Effect.withLogSpan("checkout"),
          ),
        );
        expect(log).toEqual([
          {
            uid: "user-1",
            severity: "INFO",
            message: "placed",
            args: [{ id: 1 }, 2],
            spans: { checkout: expect.any(Number) },
          },
        ]);
      }),
  );

  it.effect("appends a Cause to the message, with its stack", () =>
    Effect.gen(function* () {
      const { error } = yield* captured(Effect.logError("It broke", Cause.die(new Error("Boom"))));
      expect(error).toHaveLength(1);
      expect(error[0]?.["severity"]).toBe("ERROR");
      expect(error[0]?.["message"]).toMatch(/^It broke\nError: Boom\n\s+at /);
    }),
  );

  it.effect("replaces Effect's default logger and keeps the others", () =>
    Effect.gen(function* () {
      const loggers = yield* Effect.withFiber((fiber) =>
        Effect.succeed(fiber.getRef(Logger.CurrentLoggers)),
      ).pipe(Effect.provide(CloudLogging.layer));
      expect(loggers).toEqual(new Set([Logger.tracerLogger, CloudLogging.logger]));
    }),
  );
});

import { describe, expect, it } from "@effect/vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

const emulatorHost = process.env["FUNCTIONS_EMULATOR_HOST"] ?? "127.0.0.1:5001";
const project = "demo-effect-firebase";

/** Where the fixture copies what the functions write to the console, one JSON line per write. */
const consoleLog = fileURLToPath(new URL("../console.log", import.meta.url));
/** Where the fixture's test Tracer writes the spans it ends, one JSON line each. */
const spansLog = fileURLToPath(new URL("../spans.log", import.meta.url));
/** Where the fixture's own logger, which `fail` provides in its Layer, writes. */
const serverLog = fileURLToPath(new URL("../server.log", import.meta.url));

const readLines = <A>(path: string): ReadonlyArray<A> =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as A)
    : [];

/** A Cloud Logging entry the functions wrote, with the console method that wrote it. */
type Entry = Record<string, unknown> & { readonly method: "log" | "error" };

/** The Cloud Logging entries the functions wrote. Other console output is skipped. */
const readEntries = () =>
  readLines<{ readonly method: "log" | "error"; readonly line: string }>(consoleLog).flatMap(
    ({ method, line }) => {
      try {
        const entry = JSON.parse(line) as unknown;
        return typeof entry === "object" && entry !== null && "severity" in entry
          ? [{ ...entry, method } as Entry]
          : [];
      } catch {
        return [];
      }
    },
  );

const randomTraceId = () => crypto.randomUUID().replaceAll("-", "");

/**
 * Calls the Callable Function `deployedName` with `data`, under the trace
 * `traceId`, the way the platform sends it, and returns the HTTP status.
 */
const call = (deployedName: string, traceId: string, data: unknown = null) =>
  Effect.promise(async () => {
    const response = await fetch(`http://${emulatorHost}/${project}/us-central1/${deployedName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cloud-Trace-Context": `${traceId}/1;o=1`,
      },
      body: JSON.stringify({ data }),
    });
    return response.status;
  });

const traceField = (traceId: string) => `projects/${project}/traces/${traceId}`;

interface RecordedSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly attributes: Record<string, unknown>;
}

describe("CallableFunction logging", () => {
  it.effect("logs from a handler under the call's server span", () =>
    Effect.gen(function* () {
      const traceId = randomTraceId();
      const callId = crypto.randomUUID();
      expect(yield* call("logged", traceId, { callId })).toBe(200);
      const server = readLines<RecordedSpan>(spansLog).find(
        (span) => span.name === "CallableFunction.logged" && span.attributes["callId"] === callId,
      );
      expect(server).toBeDefined();
      const entries = readEntries().filter((entry) => entry["callId"] === callId);
      expect(entries.map((entry) => entry["message"])).toEqual(["first", "second"]);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          method: "log",
          severity: "INFO",
          "logging.googleapis.com/trace": traceField(traceId),
          "logging.googleapis.com/spanId": server?.spanId,
          "logging.googleapis.com/trace_sampled": true,
        });
      }
    }),
  );

  it.effect("logs the Layer build under the span of the call that runs it", () =>
    Effect.gen(function* () {
      expect(yield* call("logged", randomTraceId(), { callId: crypto.randomUUID() })).toBe(200);
      const builds = readEntries().filter((entry) => entry["message"] === "Building logged");
      expect(builds.length).toBeGreaterThan(0);
      const servers = readLines<RecordedSpan>(spansLog).filter(
        (span) => span.name === "CallableFunction.logged",
      );
      for (const build of builds) {
        const server = servers.find(
          (span) => span.spanId === build["logging.googleapis.com/spanId"],
        );
        expect(server).toBeDefined();
        expect(build["logging.googleapis.com/trace"]).toBe(traceField(server!.traceId));
      }
    }),
  );

  it.effect(
    "logs from middleware, and its rejection of a signed-out call, under the call's span",
    () =>
      Effect.gen(function* () {
        const traceId = randomTraceId();
        const callId = crypto.randomUUID();
        expect(yield* call("audited", traceId, { callId })).toBe(401);
        const server = readLines<RecordedSpan>(spansLog).find(
          (span) =>
            span.name === "CallableFunction.audited" && span.attributes["callId"] === callId,
        );
        expect(server).toBeDefined();
        const entries = readEntries().filter((entry) => entry["callId"] === callId);
        expect(entries.map((entry) => [entry["message"], entry["severity"]])).toEqual([
          ["Audit", "INFO"],
          ["Rejected", "WARNING"],
        ]);
        // Firebase's request reaches the middleware, inside the call's span.
        expect(entries[0]?.["hasRawRequest"]).toBe(true);
        for (const entry of entries) {
          expect(entry).toMatchObject({
            "logging.googleapis.com/trace": traceField(traceId),
            "logging.googleapis.com/spanId": server?.spanId,
            "logging.googleapis.com/trace_sampled": true,
          });
        }
      }),
  );

  it.effect("logs concurrent calls each under its own trace", () =>
    Effect.gen(function* () {
      const calls = Array.from({ length: 4 }, () => ({
        traceId: randomTraceId(),
        callId: crypto.randomUUID(),
      }));
      yield* Effect.forEach(calls, ({ traceId, callId }) => call("logged", traceId, { callId }), {
        concurrency: "unbounded",
      });
      const entries = readEntries();
      for (const { traceId, callId } of calls) {
        const own = entries.filter((entry) => entry["callId"] === callId);
        expect(own).toHaveLength(2);
        for (const entry of own) {
          expect(entry["logging.googleapis.com/trace"]).toBe(traceField(traceId));
        }
      }
    }),
  );

  it.effect("logs a handler's defect as an ERROR with the pretty Cause", () =>
    Effect.gen(function* () {
      const traceId = randomTraceId();
      expect(yield* call("failing-fail", traceId, { with: "defect" })).toBe(500);
      const errors = readEntries().filter(
        (entry) => entry["logging.googleapis.com/trace"] === traceField(traceId),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ method: "error", severity: "ERROR" });
      expect(errors[0]?.["message"]).toMatch(
        /^A Callable failed\n[^]*Error: Boom: the handler broke\n\s+at /,
      );
    }),
  );

  it.effect("logs a failed Layer build as an ERROR with the pretty Cause", () =>
    Effect.gen(function* () {
      const traceId = randomTraceId();
      expect(yield* call("brokenBuild", traceId)).toBe(500);
      const errors = readEntries().filter(
        (entry) => entry["logging.googleapis.com/trace"] === traceField(traceId),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ method: "error", severity: "ERROR" });
      expect(errors[0]?.["message"]).toMatch(
        /^The Layer of a Callable failed to build\n[^]*LayerBroke: The Layer broke\n\s+at /,
      );
    }),
  );

  it.effect("leaves logging to a logger the Layer provides", () =>
    Effect.gen(function* () {
      const traceId = randomTraceId();
      const before = readLines(serverLog).length;
      expect(yield* call("fail", traceId, { with: "defect" })).toBe(500);
      expect(readLines(serverLog).length).toBeGreaterThan(before);
      expect(
        readEntries().filter(
          (entry) => entry["logging.googleapis.com/trace"] === traceField(traceId),
        ),
      ).toEqual([]);
    }),
  );
});

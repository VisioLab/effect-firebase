import { describe, expect, it } from "@effect/vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

const emulatorHost = process.env["FUNCTIONS_EMULATOR_HOST"] ?? "127.0.0.1:5001";

/** Where the fixture's test Tracer writes the spans it ends, one JSON line each. */
const spansLog = fileURLToPath(new URL("../spans.log", import.meta.url));

interface RecordedSpan {
  readonly name: string;
  readonly kind: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
  readonly attributes: Record<string, unknown>;
  readonly parent: {
    readonly traceId: string;
    readonly spanId: string;
    readonly sampled: boolean;
  } | null;
  readonly startTime: string;
  readonly endTime: string;
}

const readSpans = (): ReadonlyArray<RecordedSpan> =>
  existsSync(spansLog)
    ? readFileSync(spansLog, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as RecordedSpan)
    : [];

/**
 * Calls the Callable Function `deployedName` with a fresh call id, sending
 * `headers` as they are, the way any HTTP client would.
 */
const call = (deployedName: string, headers: Record<string, string> = {}) =>
  Effect.promise(async () => {
    const callId = crypto.randomUUID();
    const response = await fetch(
      `http://${emulatorHost}/demo-effect-firebase/us-central1/${deployedName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ data: { callId } }),
      },
    );
    expect(response.status).toBe(200);
    return callId;
  });

/** The server span of the call `callId`: the parent of the span its handler opened. */
const serverSpanOf = (callId: string) => {
  const spans = readSpans();
  const handler = spans.find(
    (span) => span.name === "fixture.handler" && span.attributes["callId"] === callId,
  );
  expect(handler).toBeDefined();
  const server = spans.find((span) => span.spanId === handler?.parent?.spanId);
  expect(server).toBeDefined();
  expect(handler?.parent?.traceId).toBe(server?.traceId);
  return server!;
};

const childrenOf = (span: RecordedSpan) =>
  readSpans().filter((child) => child.parent?.spanId === span.spanId);

describe("CallableFunction spans", () => {
  it.effect("runs each call of a Callable in no group in a root server span", () =>
    Effect.gen(function* () {
      const first = serverSpanOf(yield* call("traced"));
      const second = serverSpanOf(yield* call("traced"));
      expect(second.spanId).not.toBe(first.spanId);
      for (const span of [first, second]) {
        expect(span).toMatchObject({
          name: "CallableFunction.traced",
          kind: "server",
          parent: null,
          attributes: {
            "rpc.system": "firebase_callable",
            "rpc.method": "traced",
            "faas.name": "traced",
          },
        });
        expect(span.attributes).not.toHaveProperty("rpc.service");
      }
    }),
  );

  it.effect(
    "names a member's span after its deployed name and nests the Layer build in the first call",
    () =>
      Effect.gen(function* () {
        const builtBefore = readSpans().some((span) => span.name === "fixture.build");
        const first = serverSpanOf(yield* call("tracing-traced"));
        const second = serverSpanOf(yield* call("tracing-traced"));
        for (const span of [first, second]) {
          expect(span).toMatchObject({
            name: "CallableFunction.tracing-traced",
            kind: "server",
            parent: null,
            attributes: {
              "rpc.system": "firebase_callable",
              "rpc.method": "traced",
              "rpc.service": "tracing",
              "faas.name": "tracing-traced",
            },
          });
        }
        // On a warm emulator an earlier run's first call built the Layer.
        if (!builtBefore) {
          const build = childrenOf(first).find((span) => span.name === "fixture.build");
          expect(build).toBeDefined();
          expect(BigInt(build!.startTime)).toBeGreaterThanOrEqual(BigInt(first.startTime));
          expect(BigInt(build!.endTime)).toBeLessThanOrEqual(BigInt(first.endTime));
        }
        expect(childrenOf(second).map((span) => span.name)).toEqual(["fixture.handler"]);
        for (const build of readSpans().filter((span) => span.name === "fixture.build")) {
          expect(build.parent).not.toBeNull();
        }
      }),
  );

  describe("parents the server span on Firebase's trace context", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

    it.effect("from an X-Cloud-Trace-Context header", () =>
      Effect.gen(function* () {
        const span = serverSpanOf(
          yield* call("traced", { "X-Cloud-Trace-Context": `${traceId}/255;o=1` }),
        );
        expect(span.parent).toEqual({ traceId, spanId: "00000000000000ff", sampled: true });
        expect(span.traceId).toBe(traceId);
      }),
    );

    it.effect("from a traceparent header", () =>
      Effect.gen(function* () {
        const span = serverSpanOf(
          yield* call("traced", { traceparent: `00-${traceId}-00f067aa0ba902b7-00` }),
        );
        expect(span.parent).toEqual({ traceId, spanId: "00f067aa0ba902b7", sampled: false });
        expect(span.sampled).toBe(false);
      }),
    );

    it.effect("from the Cloud header when both are sent", () =>
      Effect.gen(function* () {
        const span = serverSpanOf(
          yield* call("traced", {
            "X-Cloud-Trace-Context": `${traceId}/4096;o=0`,
            traceparent: `00-${"a".repeat(32)}-00f067aa0ba902b7-01`,
          }),
        );
        expect(span.parent).toEqual({ traceId, spanId: "0000000000001000", sampled: false });
      }),
    );
  });
});

/**
 * The functions module the Functions emulator serves to the tests.
 *
 * The root `firebase.json` points its `functions` source at this fixture, and
 * `vp run emulator` bundles it into `dist` before it starts the emulator.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Layer, Option, Tracer } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableFunction from "../../../src/https/CallableFunction.ts";
import { onCall } from "firebase-functions/v2/https";
import { Admins, Greet, LayerBuilds, Traced, Tracing, Users, Workers } from "./contract.ts";

/** Answers with the message it was sent. */
export const echo = onCall<{ readonly message: string }>((request) => ({
  echoed: request.data.message,
}));

export const { greet } = CallableFunction.make(
  Greet,
  Callable.toLayer(Greet, ({ name, at }) =>
    Effect.succeed({
      message: `Hello, ${name}!`,
      nextDay: new Date(at.getTime() + 24 * 60 * 60 * 1000),
    }),
  ),
);

/** How often the Layer of `layerBuilds` was built in this process. */
let builds = 0;

export const { layerBuilds } = CallableFunction.make(
  LayerBuilds,
  Callable.toLayer(
    LayerBuilds,
    Effect.sync(() => {
      builds += 1;
      return () => Effect.sync(() => ({ builds }));
    }),
  ),
);

export const { users } = CallableFunction.group(
  Users,
  Layer.mergeAll(
    Callable.toLayer(Users, "create", ({ name, birthday }) =>
      Effect.succeed({ id: name.toLowerCase(), name, birthday }),
    ),
    Callable.toLayer(Users, "get", ({ id }) => Effect.succeed({ id, servedBy: "users" })),
    Callable.toLayer(Users, "delete", () => Effect.void),
  ),
  { delete: { region: "europe-west1" } },
);

export const { admins } = CallableFunction.group(
  Admins,
  Callable.toLayer(Admins, "get", ({ id }) => Effect.succeed({ id, servedBy: "admins" })),
);

/** How often the Layer of `workers` was built in this process. */
let workerBuilds = 0;

/** One Layer for both members, which records the function it was built for. */
const WorkersLive = Layer.unwrap(
  Effect.sync(() => {
    workerBuilds += 1;
    const builtBy = { target: process.env["FUNCTION_TARGET"] ?? "", builds: workerBuilds };
    return Layer.mergeAll(
      Callable.toLayer(Workers, "first", () => Effect.succeed(builtBy)),
      Callable.toLayer(Workers, "second", () => Effect.succeed(builtBy)),
    );
  }),
);

export const { workers } = CallableFunction.group(Workers, WorkersLive);

/**
 * Where {@link SpanRecorder} writes the spans it ends, one JSON line each:
 * `packages/functions/tests/spans.log`, outside the fixture source the
 * emulator watches. The tests read it back.
 */
const spansLog = fileURLToPath(new URL("../../spans.log", import.meta.url));

/** A span that writes itself to {@link spansLog} when it ends. */
class RecordedSpan extends Tracer.NativeSpan {
  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
    super.end(endTime, exit);
    const parent = Option.getOrUndefined(this.parent);
    const line = {
      name: this.name,
      kind: this.kind,
      traceId: this.traceId,
      spanId: this.spanId,
      sampled: this.sampled,
      attributes: Object.fromEntries(this.attributes),
      parent:
        parent === undefined
          ? null
          : { traceId: parent.traceId, spanId: parent.spanId, sampled: parent.sampled },
      startTime: String(this.startTime),
      endTime: String(endTime),
      success: Exit.isSuccess(exit),
    };
    appendFileSync(spansLog, `${JSON.stringify(line)}\n`);
  }
}

/** The test Tracer: a `Live` that provides it has its spans recorded. */
const SpanRecorder = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({ span: (options) => new RecordedSpan(options) }),
);

/** Opens a span tagged with the call's id, as an app's handler would open its own. */
const handleTraced = ({ callId }: { readonly callId: string }) =>
  Effect.void.pipe(Effect.withSpan("fixture.handler", { attributes: { callId } }));

export const { traced } = CallableFunction.make(
  Traced,
  Layer.mergeAll(Callable.toLayer(Traced, handleTraced), SpanRecorder),
);

export const { tracing } = CallableFunction.group(
  Tracing,
  Layer.mergeAll(
    Callable.toLayer(
      Tracing,
      "traced",
      Effect.sleep("50 millis").pipe(Effect.withSpan("fixture.build"), Effect.as(handleTraced)),
    ),
    SpanRecorder,
  ),
);

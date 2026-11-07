/**
 * The functions module the Functions emulator serves to the tests.
 *
 * The root `firebase.json` points its `functions` source at this fixture, and
 * `vp run emulator` bundles it into `dist` before it starts the emulator.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Cause,
  Context,
  Data,
  DateTime,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Tracer,
} from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as Caller from "@visiolab/effect-firebase/functions/Caller";
import * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import * as DocumentTrigger from "@visiolab/effect-firebase/functions/DocumentTrigger";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as Functions from "../../../src/Functions.ts";
import { onCall } from "firebase-functions/v2/https";
import {
  Accounts,
  Admins,
  Audit,
  Audited,
  Banned,
  BrokenBuild,
  Fail,
  Failing,
  Flaky,
  Greet,
  LayerBuilds,
  Logged,
  OnPostCreated,
  OnPostDeleted,
  OnPostUpdated,
  OnPostWritten,
  Post,
  Posts,
  RequestHeader,
  Traced,
  Tracing,
  NameTaken,
  Sleep,
  TooSlow,
  Unexplained,
  Users,
  WhoAmI,
  Workers,
} from "./contract.ts";

/** Answers with the message it was sent. */
export const echo = onCall<{ readonly message: string }>((request) => ({
  echoed: request.data.message,
}));

export const { greet } = Functions.make(
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

export const { layerBuilds } = Functions.make(
  LayerBuilds,
  Callable.toLayer(
    LayerBuilds,
    Effect.sync(() => {
      builds += 1;
      return () => Effect.sync(() => ({ builds }));
    }),
  ),
);

export const { users } = Functions.group(
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

export const { admins } = Functions.group(
  Admins,
  Callable.toLayer(Admins, "get", ({ id }) => Effect.succeed({ id, servedBy: "admins" })),
);

export const { accounts } = Functions.group(
  Accounts,
  Layer.mergeAll(
    Callable.toLayer(Accounts, "get", ({ id }) => Effect.succeed({ id, servedBy: "accounts" })),
    Callable.toLayer(Accounts, "me", () =>
      Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
    ),
    Caller.Authenticated.layer,
  ),
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

export const { workers } = Functions.group(Workers, WorkersLive);

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

export const { traced } = Functions.make(
  Traced,
  Layer.mergeAll(Callable.toLayer(Traced, handleTraced), SpanRecorder),
);

export const { tracing } = Functions.group(
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

/**
 * Where the fixture's own logger writes, one JSON line per entry, so the tests
 * can read what the server logged. It lies outside the functions source, next
 * to the tests.
 */
const serverLog = fileURLToPath(new URL("../../server.log", import.meta.url));

const ServerLogLive = Logger.layer([
  Logger.make(({ cause, logLevel, message }) => {
    const values = (Array.isArray(message) ? message : [message]).map(String);
    if (cause.reasons.length > 0) values.push(Cause.pretty(cause));
    appendFileSync(serverLog, `${JSON.stringify({ level: logLevel, message: values })}\n`);
  }),
]);

/** The handler of `fail`, in no group and in `failing`. */
const failWith = ({ with: failure }: Callable.Payload<typeof Fail>) => {
  switch (failure) {
    case "NameTaken":
      return Effect.fail(
        new NameTaken({ username: "Ada", since: new Date("2026-01-01T12:00:00.000Z") }),
      );
    case "Banned":
      return Effect.fail(new Banned({ message: "Ada is banned" }));
    case "Unexplained":
      return Effect.fail(new Unexplained());
    case "NotFound":
      return Effect.fail(new CallableError.NotFound({ message: "No such user" }));
    case "TooSlow":
      return Effect.fail(new TooSlow());
    case "defect":
      return Effect.die(new Error("Boom: the handler broke"));
    case "interrupt":
      return Effect.interrupt;
  }
};

export const { fail } = Functions.make(
  Fail,
  Callable.toLayer(Fail, failWith).pipe(Layer.merge(ServerLogLive)),
);

export const { failing } = Functions.group(Failing, Callable.toLayer(Failing, "fail", failWith));

/** How often the connection of `flaky` was built in this process. */
let connectionBuilds = 0;

/**
 * A service the handler of `flaky` needs, whose first build fails, as a
 * database connection might while the database starts up.
 */
class Connection extends Context.Service<Connection, { readonly builds: number }>()(
  "fixture/Connection",
) {}

class ConnectionRefused extends Data.TaggedError("ConnectionRefused")<{
  readonly message: string;
}> {}

const ConnectionLive = Layer.effect(
  Connection,
  Effect.suspend(() => {
    connectionBuilds += 1;
    return connectionBuilds === 1
      ? Effect.fail(new ConnectionRefused({ message: "The first build of the connection fails" }))
      : Effect.succeed({ builds: connectionBuilds });
  }),
);

export const { flaky } = Functions.make(
  Flaky,
  Callable.toLayer(
    Flaky,
    Effect.map(
      Effect.service(Connection),
      ({ builds }) =>
        () =>
          Effect.succeed({ builds }),
    ),
  ).pipe(Layer.provide(ConnectionLive)),
);

export const { whoAmI } = Functions.make(
  WhoAmI,
  Layer.merge(
    Callable.toLayer(WhoAmI, ({ greeting }) =>
      Effect.map(Effect.service(Caller.Caller), ({ uid }) => `${greeting}, ${uid}!`),
    ),
    Caller.Authenticated.layer,
  ),
);

/**
 * Where the fixture copies every `console.log` and `console.error` line, as
 * JSON `{ method, line }`, so the tests can read what the Cloud Logging logger
 * wrote. It lies outside the functions source, next to the tests.
 */
const consoleLog = fileURLToPath(new URL("../../console.log", import.meta.url));

for (const method of ["log", "error"] as const) {
  const write = console[method].bind(console);
  console[method] = (...args: Array<unknown>) => {
    appendFileSync(consoleLog, `${JSON.stringify({ method, line: args.map(String).join(" ") })}\n`);
    write(...args);
  };
}

export const { logged } = Functions.make(
  Logged,
  Layer.mergeAll(
    Callable.toLayer(
      Logged,
      Effect.log("Building logged").pipe(
        Effect.as(({ callId }: Callable.Payload<typeof Logged>) =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan("callId", callId);
            yield* Effect.log("first");
            yield* Effect.sleep("50 millis");
            yield* Effect.log("second");
          }).pipe(Effect.annotateLogs({ callId })),
        ),
      ),
    ),
    SpanRecorder,
  ),
);

class LayerBroke extends Data.TaggedError("LayerBroke")<{ readonly message: string }> {}

export const { brokenBuild } = Functions.make(
  BrokenBuild,
  Callable.toLayer(BrokenBuild, Effect.fail(new LayerBroke({ message: "The Layer broke" }))),
);

/**
 * Tags the call's span and logs with the call's id from the raw data, logs
 * the trace header and the caller's address from the call's HTTP request, and
 * logs "Rejected" when the call it wraps fails.
 */
const AuditLive = Layer.succeed(Audit, (effect) =>
  Effect.gen(function* () {
    const { data, rawRequest } = yield* CallableRequest.CallableRequest;
    const callId = String((data as { readonly callId?: unknown } | null)?.callId);
    yield* Effect.annotateCurrentSpan("callId", callId);
    yield* Effect.log("Audit").pipe(
      Effect.annotateLogs({
        callId,
        traceHeader: rawRequest.headers["x-cloud-trace-context"],
        remoteAddress: Option.getOrNull(rawRequest.remoteAddress),
      }),
    );
    return yield* effect.pipe(
      Effect.tapCause(() => Effect.logWarning("Rejected").pipe(Effect.annotateLogs({ callId }))),
    );
  }),
);

export const { audited } = Functions.make(
  Audited,
  Layer.mergeAll(
    Callable.toLayer(Audited, () => Effect.void),
    Caller.Authenticated.layer,
    AuditLive,
    SpanRecorder,
  ),
);

export const { requestHeader } = Functions.make(
  RequestHeader,
  Callable.toLayer(RequestHeader, () =>
    Effect.map(
      Effect.service(CallableRequest.CallableRequest),
      ({ rawRequest }) => rawRequest.headers["x-test-tag"] ?? null,
    ),
  ),
);

export const { sleep } = Functions.make(
  Sleep,
  Callable.toLayer(Sleep, ({ millis }) => Effect.sleep(millis)),
);

/**
 * Where the fixture's triggers record each event they receive, one JSON line
 * each: `packages/functions/tests/triggers.log`, next to the tests, which wait
 * for their own document's line.
 */
const triggersLog = fileURLToPath(new URL("../../triggers.log", import.meta.url));

export const { onPostCreated } = Functions.make(
  OnPostCreated,
  DocumentTrigger.toLayer(OnPostCreated, (event) =>
    Effect.map(event.snapshot.data, (post) => {
      const line = {
        trigger: OnPostCreated.name,
        eventId: event.id,
        time: event.time,
        path: event.ref.path,
        ancestors: event.ref.ancestors,
        id: event.ref.id,
        data: { title: post.title, publishedAt: DateTime.formatIso(post.publishedAt) },
      };
      appendFileSync(triggersLog, `${JSON.stringify(line)}\n`);
    }),
  ),
);

/** A decoded post as the triggers record it, with `publishedAt` as ISO. */
const recordedPost = (post: Post) => ({
  title: post.title,
  publishedAt: DateTime.formatIso(post.publishedAt),
});

/** One side of a change as recorded: the decoded post, or `null` when missing. */
const recordedSide = (snapshot: DocumentSnapshot.DocumentSnapshot<typeof Posts>) =>
  DocumentSnapshot.isExisting(snapshot)
    ? Effect.map(snapshot.data, recordedPost)
    : Effect.succeed(null);

/** Appends what every trigger records of an event, and `fields`, to the triggers log. */
const recordEvent = (
  trigger: string,
  event: DocumentTrigger.BaseEvent<typeof Posts>,
  fields: object,
) =>
  Effect.sync(() => {
    const line = {
      trigger,
      eventId: event.id,
      time: event.time,
      path: event.ref.path,
      ancestors: event.ref.ancestors,
      id: event.ref.id,
      ...fields,
    };
    appendFileSync(triggersLog, `${JSON.stringify(line)}\n`);
  });

export const { onPostDeleted } = Functions.make(
  OnPostDeleted,
  DocumentTrigger.toLayer(OnPostDeleted, (event) =>
    Effect.flatMap(event.snapshot.data, (post) =>
      recordEvent(OnPostDeleted.name, event, { data: recordedPost(post) }),
    ),
  ),
);

export const { onPostUpdated } = Functions.make(
  OnPostUpdated,
  DocumentTrigger.toLayer(OnPostUpdated, (event) =>
    Effect.gen(function* () {
      const before = recordedPost(yield* event.before.data);
      const after = recordedPost(yield* event.after.data);
      yield* recordEvent(OnPostUpdated.name, event, { before, after });
    }),
  ),
);

export const { onPostWritten } = Functions.make(
  OnPostWritten,
  DocumentTrigger.toLayer(OnPostWritten, (event) =>
    Effect.gen(function* () {
      const before = yield* recordedSide(event.before);
      const after = yield* recordedSide(event.after);
      yield* recordEvent(OnPostWritten.name, event, { before, after });
    }),
  ),
);

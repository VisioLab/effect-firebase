import { describe, expect, it } from "@effect/vitest";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Data, Effect, Schema } from "effect";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as DocumentTrigger from "@visiolab/effect-firebase/functions/DocumentTrigger";
import * as Functions from "../../src/Functions.ts";
import { readLines, waitForLine } from "../records.ts";

const project = "demo-effect-firebase";

/** Where the fixture's triggers record each event they receive, one JSON line each. */
const triggersLog = fileURLToPath(new URL("../triggers.log", import.meta.url));
/** Where the fixture's test Tracer writes the spans it ends, one JSON line each. */
const spansLog = fileURLToPath(new URL("../spans.log", import.meta.url));
/** Where the fixture copies what the functions write to the console, one JSON line per write. */
const consoleLog = fileURLToPath(new URL("../console.log", import.meta.url));

interface TaskAttempt {
  readonly trigger: string;
  readonly id: string;
  readonly eventId: string;
  readonly attempt: number;
}

interface RecordedSpan {
  readonly name: string;
  readonly kind: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
  readonly attributes: Record<string, unknown>;
  readonly success: boolean;
}

interface ConsoleLine {
  readonly method: "log" | "error";
  readonly line: string;
}

/** A Cloud Logging entry the functions wrote, or undefined for other console output. */
const entryOf = ({ method, line }: ConsoleLine): Record<string, unknown> | undefined => {
  try {
    const entry = JSON.parse(line) as unknown;
    return typeof entry === "object" && entry !== null && "severity" in entry
      ? { ...entry, method }
      : undefined;
  } catch {
    return undefined;
  }
};

/** Waits for the first Cloud Logging entry that `match` accepts. */
const waitForEntry = (match: (entry: Record<string, unknown>) => boolean) =>
  Effect.map(
    waitForLine<ConsoleLine>(consoleLog, (line) => {
      const entry = entryOf(line);
      return entry !== undefined && match(entry);
    }),
    (line) => entryOf(line)!,
  );

/** The server span of the event about the task `taskId`, once it has ended. */
const waitForTaskSpan = (taskId: string) =>
  waitForLine<RecordedSpan>(
    spansLog,
    (span) => span.name === "DocumentTrigger.onTaskCreated" && span.attributes["taskId"] === taskId,
  );

/**
 * The Firestore of the project the Functions emulator registered the fixture's
 * triggers for. Writes to another project fire nothing.
 */
const firestore = () =>
  getFirestore(
    getApps().find((app) => app.name === "triggers") ??
      initializeApp({ projectId: project }, "triggers"),
  );

const create = (path: string, data: Record<string, unknown>) =>
  Effect.promise(() => firestore().doc(path).create(data));

/** Creates a task whose first attempt ends as `firstAttempt` asks, and returns its id. */
const createTask = (firstAttempt: "succeed" | "fail" | "die" | "interrupt") =>
  Effect.gen(function* () {
    const id = `task-${randomUUID()}`;
    yield* create(`tasks/${id}`, { firstAttempt });
    return id;
  });

class Thing extends FirestoreModel.Class<Thing>("Thing")({ name: Schema.String }) {}

/** A trigger the tests deploy in process, outside the fixture. */
const OnThingCreated = DocumentTrigger.created("onThingCreated", Collection.make("things", Thing));

class LayerBroke extends Data.TaggedError("LayerBroke")<{ readonly message: string }> {}

/** What `onDocumentCreated` hands the handler for the thing `id`, as the SDK builds it. */
const thingCreated = (id: string) =>
  ({
    id: randomUUID(),
    time: new Date().toISOString(),
    document: `things/${id}`,
    data: { data: () => ({ name: id }) },
  }) as never;

const traceField = (traceId: string) => `projects/${project}/traces/${traceId}`;

describe("DocumentTrigger failures", () => {
  describe("logs a failed event as an ERROR in the event's span, with the pretty Cause", () => {
    for (const [firstAttempt, cause] of [
      ["fail", (id: string) => new RegExp(`TaskFailed: Task ${id} failed\\n\\s+at `)],
      ["die", (id: string) => new RegExp(`Error: Boom: task ${id} broke\\n\\s+at `)],
      ["interrupt", () => /interrupt/i],
    ] as const) {
      it.live(
        `when the handler ends with ${firstAttempt}`,
        () =>
          Effect.gen(function* () {
            const id = yield* createTask(firstAttempt);
            const span = yield* waitForTaskSpan(id);
            expect(span.success).toBe(false);
            const error = yield* waitForEntry(
              (entry) =>
                entry["logging.googleapis.com/spanId"] === span.spanId &&
                entry["severity"] === "ERROR",
            );
            expect(error).toMatchObject({
              method: "error",
              "logging.googleapis.com/trace": traceField(span.traceId),
              "logging.googleapis.com/trace_sampled": span.sampled,
            });
            expect(error["message"]).toMatch(/^A Document Trigger failed\n/);
            expect(error["message"]).toMatch(cause(id));
          }),
        30_000,
      );
    }
  });

  it.live(
    "adds no retry of its own: a failed event runs once unless Firebase delivers it again",
    () =>
      Effect.gen(function* () {
        const id = yield* createTask("fail");
        yield* waitForTaskSpan(id);
        // The Functions emulator never delivers an event again, even with
        // `retry`, so any second attempt would be the library's own.
        yield* Effect.sleep("2 seconds");
        const attempts = readLines<TaskAttempt>(triggersLog).filter(
          (line) => line.trigger === "onTaskCreated" && line.id === id,
        );
        expect(attempts.map((line) => line.attempt)).toEqual([1]);
      }),
    30_000,
  );

  it.live("builds a Layer that failed to build on an event again on the next one", () =>
    Effect.gen(function* () {
      // In process: the Functions emulator replaces a worker whose function
      // threw, so every event after a failure meets a Layer not built yet.
      let builds = 0;
      const handled: Array<{ readonly id: string; readonly builds: number }> = [];
      const { onThingCreated } = Functions.make(
        OnThingCreated,
        DocumentTrigger.toLayer(
          OnThingCreated,
          Effect.suspend(() => {
            builds += 1;
            const built = builds;
            return built === 1
              ? Effect.fail(new LayerBroke({ message: "The first build fails" }))
              : Effect.succeed((event: DocumentTrigger.Event<typeof OnThingCreated>) =>
                  Effect.sync(() => handled.push({ id: event.ref.id, builds: built })),
                );
          }),
        ),
      );
      const failed = yield* Effect.promise(() =>
        Promise.resolve(onThingCreated.run(thingCreated("first"))).then(
          () => undefined,
          (error: unknown) => error,
        ),
      );
      expect(failed).toMatchObject({ _tag: "LayerBroke" });
      yield* Effect.promise(() => onThingCreated.run(thingCreated("second")));
      expect(handled).toEqual([{ id: "second", builds: 2 }]);
    }),
  );

  it("deploys with Firebase's retry only when `retry` is set", () => {
    const live = DocumentTrigger.toLayer(OnThingCreated, () => Effect.void);
    const retried = Functions.make(OnThingCreated, live, { retry: true }).onThingCreated;
    const dropped = Functions.make(OnThingCreated, live).onThingCreated;
    const off = Functions.make(OnThingCreated, live, { retry: false }).onThingCreated;
    // What firebase-tools reads from each export to deploy it.
    expect(retried.__endpoint.eventTrigger?.retry).toBe(true);
    expect(dropped.__endpoint.eventTrigger?.retry).toBe(false);
    expect(off.__endpoint.eventTrigger?.retry).toBe(false);
  });
});

describe("DocumentTrigger spans and logs", () => {
  it.live(
    "runs each event in a server span named after the deployed function",
    () =>
      Effect.gen(function* () {
        const first = yield* waitForTaskSpan(yield* createTask("succeed"));
        const second = yield* waitForTaskSpan(yield* createTask("succeed"));
        expect(second.spanId).not.toBe(first.spanId);
        for (const span of [first, second]) {
          expect(span).toMatchObject({
            name: "DocumentTrigger.onTaskCreated",
            kind: "server",
            success: true,
            attributes: { "faas.name": "onTaskCreated", "faas.trigger": "datasource" },
          });
        }
      }),
    30_000,
  );

  it.live(
    "names a group member's span after its deployed name, <group>-<name>",
    () =>
      Effect.gen(function* () {
        const path = `authors/author-${randomUUID()}/posts/post-${randomUUID()}`;
        yield* create(path, {
          title: "Hello",
          publishedAt: Timestamp.fromDate(new Date("2026-11-07T12:00:00.000Z")),
        });
        const span = yield* waitForLine<RecordedSpan>(
          spansLog,
          (span) =>
            span.name.startsWith("DocumentTrigger.") && span.attributes["documentPath"] === path,
        );
        expect(span).toMatchObject({
          name: "DocumentTrigger.posts-onCreated",
          kind: "server",
          success: true,
          attributes: { "faas.name": "posts-onCreated", "faas.trigger": "datasource" },
        });
      }),
    30_000,
  );

  it.live(
    "logs from the handler through Cloud Logging with the trace of the event's span",
    () =>
      Effect.gen(function* () {
        const id = yield* createTask("succeed");
        const span = yield* waitForTaskSpan(id);
        const entry = yield* waitForEntry((entry) => entry["taskId"] === id);
        expect(entry).toMatchObject({
          method: "log",
          severity: "INFO",
          message: "Handling task",
          "logging.googleapis.com/trace": traceField(span.traceId),
          "logging.googleapis.com/spanId": span.spanId,
          "logging.googleapis.com/trace_sampled": span.sampled,
        });
      }),
    30_000,
  );
});

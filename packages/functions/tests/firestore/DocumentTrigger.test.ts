import { describe, expect, it } from "@effect/vitest";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { waitForLine } from "../records.ts";

/** Where the fixture's triggers record each event they receive, one JSON line each. */
const triggersLog = fileURLToPath(new URL("../triggers.log", import.meta.url));

interface RecordedEvent {
  readonly trigger: string;
  readonly eventId: string;
  readonly time: string;
  readonly path: string;
  readonly ancestors: ReadonlyArray<string>;
  readonly id: string;
  readonly data: unknown;
}

/**
 * The Firestore of the project the Functions emulator registered the fixture's
 * triggers for. Writes to another project fire nothing.
 */
const firestore = () =>
  getFirestore(
    getApps().find((app) => app.name === "triggers") ??
      initializeApp({ projectId: "demo-effect-firebase" }, "triggers"),
  );

describe("DocumentTrigger.created", () => {
  it.live(
    "runs on a document created in a subcollection, with its typed ref, the event's id and time, and its decoded data",
    () =>
      Effect.gen(function* () {
        const author = `author-${randomUUID()}`;
        const post = `post-${randomUUID()}`;
        const path = `authors/${author}/posts/${post}`;
        const before = Date.now();
        yield* Effect.promise(() =>
          firestore()
            .doc(path)
            .create({
              title: "Hello",
              publishedAt: Timestamp.fromDate(new Date("2026-11-07T12:00:00.000Z")),
            }),
        );
        const recorded = yield* waitForLine<RecordedEvent>(
          triggersLog,
          (line) => line.trigger === "onPostCreated" && line.path === path,
        );
        expect(recorded).toMatchObject({
          ancestors: [author],
          id: post,
          data: { title: "Hello", publishedAt: "2026-11-07T12:00:00.000Z" },
        });
        expect(recorded.eventId).toMatch(/.+/);
        // The event's time is when the document was written.
        expect(Date.parse(recorded.time)).toBeGreaterThanOrEqual(before - 1000);
        expect(Date.parse(recorded.time)).toBeLessThanOrEqual(Date.now());
      }),
    30_000,
  );
});

/** What the fixture records of a post: its title and `publishedAt` as ISO. */
interface RecordedPost {
  readonly title: string;
  readonly publishedAt: string;
}

/** A line of a trigger with a document on each side; `null` for a missing one. */
interface RecordedChange {
  readonly trigger: string;
  readonly eventId: string;
  readonly path: string;
  readonly ancestors: ReadonlyArray<string>;
  readonly id: string;
  readonly before: RecordedPost | null;
  readonly after: RecordedPost | null;
}

const publishedAt = "2026-11-07T12:00:00.000Z";

const post = (title: string) => ({
  title,
  publishedAt: Timestamp.fromDate(new Date(publishedAt)),
});

/** A fresh path under a fresh author, so each test waits for its own lines. */
const freshPath = () => {
  const author = `author-${randomUUID()}`;
  const id = `post-${randomUUID()}`;
  return { author, id, path: `authors/${author}/posts/${id}` };
};

const write = (f: () => Promise<unknown>) => Effect.promise(f);

describe("DocumentTrigger.deleted", () => {
  it.live(
    "runs on a deleted document, with its last data",
    () =>
      Effect.gen(function* () {
        const { author, id, path } = freshPath();
        yield* write(() => firestore().doc(path).create(post("First")));
        yield* write(() => firestore().doc(path).update({ title: "Last" }));
        yield* write(() => firestore().doc(path).delete());
        const recorded = yield* waitForLine<RecordedEvent>(
          triggersLog,
          (line) => line.trigger === "onPostDeleted" && line.path === path,
        );
        expect(recorded).toMatchObject({
          ancestors: [author],
          id,
          data: { title: "Last", publishedAt },
        });
        expect(recorded.eventId).toMatch(/.+/);
      }),
    30_000,
  );
});

describe("DocumentTrigger.updated", () => {
  it.live(
    "runs on an updated document, with the old data before and the new data after",
    () =>
      Effect.gen(function* () {
        const { author, id, path } = freshPath();
        yield* write(() => firestore().doc(path).create(post("Draft")));
        yield* write(() => firestore().doc(path).update({ title: "Final" }));
        const recorded = yield* waitForLine<RecordedChange>(
          triggersLog,
          (line) => line.trigger === "onPostUpdated" && line.path === path,
        );
        expect(recorded).toMatchObject({
          ancestors: [author],
          id,
          before: { title: "Draft", publishedAt },
          after: { title: "Final", publishedAt },
        });
      }),
    30_000,
  );
});

describe("DocumentTrigger.written", () => {
  it.live(
    "runs on a create with before missing, on an update, and on a delete with after missing",
    () =>
      Effect.gen(function* () {
        const { author, id, path } = freshPath();
        const written = (match: (line: RecordedChange) => boolean) =>
          waitForLine<RecordedChange>(
            triggersLog,
            (line) => line.trigger === "onPostWritten" && line.path === path && match(line),
          );

        yield* write(() => firestore().doc(path).create(post("Draft")));
        const created = yield* written((line) => line.before === null);
        expect(created).toMatchObject({
          ancestors: [author],
          id,
          before: null,
          after: { title: "Draft", publishedAt },
        });

        yield* write(() => firestore().doc(path).update({ title: "Final" }));
        const updated = yield* written((line) => line.before !== null && line.after !== null);
        expect(updated).toMatchObject({
          before: { title: "Draft", publishedAt },
          after: { title: "Final", publishedAt },
        });

        yield* write(() => firestore().doc(path).delete());
        const deleted = yield* written((line) => line.after === null);
        expect(deleted).toMatchObject({
          ancestors: [author],
          id,
          before: { title: "Final", publishedAt },
          after: null,
        });
      }),
    60_000,
  );
});

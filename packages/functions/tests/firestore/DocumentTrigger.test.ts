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

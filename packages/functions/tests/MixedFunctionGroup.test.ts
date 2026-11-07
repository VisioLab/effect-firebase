import { describe, expect, it } from "@effect/vitest";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { deleteApp, initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { waitForLine } from "./records.ts";

const [host = "127.0.0.1", port = "5001"] = (process.env["FUNCTIONS_EMULATOR_HOST"] ?? "").split(
  ":",
);

/** Where the fixture's triggers record each event they receive, one JSON line each. */
const triggersLog = fileURLToPath(new URL("triggers.log", import.meta.url));

interface RecordedEvent {
  readonly trigger: string;
  readonly target: string;
  readonly path: string;
  readonly ancestors: ReadonlyArray<string>;
  readonly id: string;
  readonly data: unknown;
}

/** Calls the function `name` with a plain `httpsCallable`, and answers its data. */
const call = (name: string, data?: unknown) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const app = initializeApp(
        { apiKey: "demo", projectId: "demo-effect-firebase", appId: "demo" },
        `mixed-function-group-test-${randomUUID()}`,
      );
      const functions = getFunctions(app);
      connectFunctionsEmulator(functions, host, Number(port));
      return functions;
    }),
    (functions) => Effect.promise(() => deleteApp(functions.app)),
  ).pipe(
    Effect.flatMap((functions) => Effect.promise(() => httpsCallable(functions, name)(data))),
    Effect.map((result) => result.data),
    Effect.scoped,
  );

/**
 * The Firestore of the project the Functions emulator registered the fixture's
 * triggers for. Writes to another project fire nothing.
 */
const firestore = () =>
  getFirestore(
    getAdminApps().find((app) => app.name === "mixed-function-group") ??
      initializeAdminApp({ projectId: "demo-effect-firebase" }, "mixed-function-group"),
  );

describe("Functions.group with a Callable and a Document Trigger", () => {
  it.effect("serves the Callable as <group>-<name>", () =>
    Effect.gen(function* () {
      expect(yield* call("posts-shout", { title: "Hello" })).toBe("HELLO");
    }),
  );

  it.live(
    "runs the trigger as <group>-<name> on a document created in its collection",
    () =>
      Effect.gen(function* () {
        const author = `author-${randomUUID()}`;
        const post = `post-${randomUUID()}`;
        const path = `authors/${author}/posts/${post}`;
        yield* Effect.promise(() =>
          firestore()
            .doc(path)
            .create({
              title: "Grouped",
              publishedAt: Timestamp.fromDate(new Date("2026-11-07T12:00:00.000Z")),
            }),
        );
        const recorded = yield* waitForLine<RecordedEvent>(
          triggersLog,
          (line) => line.trigger === "posts-onCreated" && line.path === path,
        );
        expect(recorded).toMatchObject({
          // How the emulator names the function it deployed as `posts-onCreated`.
          target: "posts.onCreated",
          ancestors: [author],
          id: post,
          data: { title: "Grouped", publishedAt: "2026-11-07T12:00:00.000Z" },
        });
      }),
    30_000,
  );
});

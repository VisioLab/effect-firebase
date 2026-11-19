import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { Effect, Layer, Queue, Schema, Stream } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { clear, emulator, listening } from "./emulator.ts";
import { listeners } from "./listeners.ts";

vi.mock("firebase/firestore", async (importOriginal) =>
  (await import("./listeners.ts")).wrapOnSnapshot(await importOriginal()),
);

const projectId = "demo-client-streams";

const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId }, "streams")),
);

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

const fresh = Effect.gen(function* () {
  yield* clear(projectId);
  listeners.reset();
  return yield* Firestore;
});

// How a listener follows changes is in the conformance suite, which runs in a
// file of its own: this one wraps `onSnapshot` for every test in it.

describe("ClientFirestore.streamDoc", () => {
  it.effect("detaches its listener once the stream stops", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      const first = yield* firestore.streamDoc(hello).pipe(Stream.take(1), Stream.runCollect);

      expect(first.map(DocumentSnapshot.isMissing)).toEqual([true]);
      expect(listeners.detached).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails with a FirestoreError when Firestore drops the listener", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      // The emulator runs without security rules, so it never refuses a
      // listener; the SDK reporting a failure is stood in for instead.
      const cause = new Error("dropped");
      listeners.failWith = cause;

      const error = yield* Effect.flip(Stream.runDrain(firestore.streamDoc(hello)));

      expect(error).toBeInstanceOf(FirestoreError);
      expect(error.message).toContain(hello.path);
      expect(error.cause).toBe(cause);
    }).pipe(Effect.provide(layer)),
  );
});

describe("ClientFirestore streams, Snapshot Metadata", () => {
  // A listener hears of this client's own write before the server has
  // acknowledged it, which is what its metadata says.
  it.effect("streamDoc emits each snapshot with the metadata it arrived with", () =>
    Effect.gen(function* () {
      yield* fresh;
      const firestore = yield* ClientFirestore.ClientFirestore;
      const snapshots = yield* listening(firestore.streamDoc(hello));

      const missing = yield* Queue.take(snapshots);
      expect(missing._tag).toBe("Missing");
      expect(missing.metadata).toEqual({ fromCache: false, hasPendingWrites: false });

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const written = yield* Queue.take(snapshots);
      expect(written._tag).toBe("Existing");
      expect(written.metadata).toEqual({ fromCache: false, hasPendingWrites: true });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("streamDocs emits each snapshot with the metadata of the read and its documents", () =>
    Effect.gen(function* () {
      yield* fresh;
      const firestore = yield* ClientFirestore.ClientFirestore;
      const snapshots = yield* listening(firestore.streamDocs(Posts.collection()));

      const empty = yield* Queue.take(snapshots);
      expect(empty.docs).toEqual([]);
      expect(empty.metadata).toEqual({ fromCache: false, hasPendingWrites: false });

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const written = yield* Queue.take(snapshots);
      expect(written.metadata).toEqual({ fromCache: false, hasPendingWrites: true });
      expect(written.docs.map((doc) => doc.metadata)).toEqual([
        { fromCache: false, hasPendingWrites: true },
      ]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});

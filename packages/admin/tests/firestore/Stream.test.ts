import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Layer, Queue, Schema, Stream } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { DocumentReference } from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/Firestore.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-streams";

const layer = AdminFirestore.layer().pipe(Layer.provide(App.layer({ projectId }, "streams")));

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

const fresh = clear(projectId).pipe(Effect.andThen(Firestore));

const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
  DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

/**
 * Runs `stream` into a queue for the rest of the test.
 *
 * Each snapshot is taken before the next write, so none is dropped for
 * arriving while another was still waiting to be read.
 */
const listening = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.toQueue(stream, { capacity: "unbounded" });

describe("Firestore.streamDoc", () => {
  it.effect("starts with the document as it is, and follows each change to it", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      const snapshots = yield* listening(firestore.streamDoc(hello));

      expect(DocumentSnapshot.isMissing(yield* Queue.take(snapshots))).toBe(true);

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      expect(yield* read(yield* Queue.take(snapshots))).toMatchObject({ title: "Hello", views: 1 });

      yield* firestore.updateDoc(hello, { views: 2 });
      expect(yield* read(yield* Queue.take(snapshots))).toMatchObject({ title: "Hello", views: 2 });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("detaches its listener once the stream stops", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      const unsubscribed = vi.fn();
      const spy = vi
        .spyOn(DocumentReference.prototype, "onSnapshot")
        .mockImplementation((onNext) => {
          onNext({ data: () => undefined } as never);
          return unsubscribed;
        });
      yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()));

      const first = yield* firestore.streamDoc(hello).pipe(Stream.take(1), Stream.runCollect);

      expect(first.map(DocumentSnapshot.isMissing)).toEqual([true]);
      expect(unsubscribed).toHaveBeenCalledOnce();
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("fails with a FirestoreError when Firestore drops the listener", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      // The Admin SDK skips security rules, so the emulator never refuses it a
      // listener; the SDK reporting a failure is stood in for instead.
      const cause = new Error("dropped");
      const spy = vi
        .spyOn(DocumentReference.prototype, "onSnapshot")
        .mockImplementation((_onNext, onError) => {
          onError?.(cause);
          return () => {};
        });
      yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()));

      const error = yield* Effect.flip(Stream.runDrain(firestore.streamDoc(hello)));

      expect(error).toBeInstanceOf(FirestoreError);
      expect(error.message).toContain(hello.path);
      expect(error.cause).toBe(cause);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});

describe("Firestore.streamDocs", () => {
  it.effect("starts with the collection as it is, and follows each change to it", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      const lists = yield* listening(firestore.streamDocs(Posts.collection()));

      expect(yield* Queue.take(lists)).toEqual([]);

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      expect((yield* Queue.take(lists)).map((snapshot) => snapshot.id)).toEqual([hello.id]);

      const added = yield* firestore.addDoc(Posts.collection(), { title: "Added", views: 2 });
      expect((yield* Queue.take(lists)).map((snapshot) => snapshot.id).toSorted()).toEqual(
        [hello.id, added.id].toSorted(),
      );
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});

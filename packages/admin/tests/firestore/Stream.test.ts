import { describe, expect, it, vi } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { DocumentReference } from "firebase-admin/firestore";
import * as App from "../../src/app/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

// How a listener follows changes is in the conformance suite; these tests stand
// in for the SDK's listener to see it detached and failing.

const projectId = "demo-streams";

const layer = AdminFirestore.layer().pipe(Layer.provide(App.layer({ projectId }, "streams")));

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

const fresh = clear(projectId).pipe(Effect.andThen(Firestore));

describe("Firestore.streamDoc", () => {
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

import { assert, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { Cause, Context, Effect, Layer, Option, Queue, Schema } from "effect";
import { FirebaseError } from "firebase/app";
import * as Sdk from "firebase/firestore";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import * as FirestoreAtom from "../../src/firestore/FirestoreAtom.ts";
import { clear, emulator, listening } from "./emulator.ts";
import { listeners } from "./listeners.ts";

vi.mock("firebase/firestore", async (importOriginal) =>
  (await import("./listeners.ts")).wrapOnSnapshot(await importOriginal()),
);

const projectId = "demo-client-firestore-atom";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

// Each registry builds the layer anew, so each test gets an app of its own
// and does not wait on the previous test's app being deleted.
let apps = 0;

class Db extends FirestoreAtom.Service<Db>()("test/Db", {
  layer: () =>
    ClientFirestore.layer({ emulator }).pipe(
      Layer.provide(App.layer({ projectId }, `firestore-atom-${++apps}`)),
    ),
}) {}

/**
 * A registry for the rest of the test, with `Db`'s runtime mounted, and the
 * Client Firestore that runtime holds, for writing through the same client the
 * atoms listen with.
 */
const fresh = Effect.gen(function* () {
  yield* clear(projectId);
  listeners.reset();
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() => AtomRegistry.make()),
    (registry) => Effect.sync(() => registry.dispose()),
  );
  yield* AtomRegistry.mount(registry, Db.runtime);
  const context = yield* AtomRegistry.getResult(registry, Db.runtime);
  return { registry, firestore: Context.get(context, Db) };
});

/** The next result in `results` that is not `Initial`, as a `Success`. */
const next = <A, E, Done>(results: Queue.Dequeue<AsyncResult.AsyncResult<A, E>, Done>) =>
  Effect.gen(function* () {
    let result = yield* Queue.take(results);
    while (AsyncResult.isInitial(result)) {
      result = yield* Queue.take(results);
    }
    assert(AsyncResult.isSuccess(result), `expected a Success, got ${result._tag}`);
    return result;
  });

describe("FirestoreAtom.Service doc", () => {
  it.live("is Initial until the first snapshot, then holds the decoded document", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));

      expect(AsyncResult.isInitial(yield* Queue.take(results))).toBe(true);
      const result = yield* Queue.take(results);
      assert(AsyncResult.isSuccess(result));
      assert(result.value._tag === "Existing");
      expect(result.value.data).toBeInstanceOf(Post);
      expect(result.value.data).toMatchObject({ title: "Hello", views: 1 });
      expect(result.value.id).toBe("hello");
      expect(result.waiting).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("holds a Missing snapshot as a success for a document that is not there", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;

      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));

      yield* Queue.take(results);
      const result = yield* Queue.take(results);
      assert(AsyncResult.isSuccess(result));
      expect(result.value._tag).toBe("Missing");
      expect(result.value.ref).toEqual(hello);
    }).pipe(Effect.scoped),
  );

  it.live("shows a local write at once, with pending writes", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));
      yield* next(results);

      yield* Effect.forkChild(firestore.setDoc(hello, { title: "Hello", views: 1 }));

      const result = yield* next(results);
      assert(result.value._tag === "Existing");
      expect(result.value.data).toMatchObject({ title: "Hello", views: 1 });
      expect(result.value.metadata.hasPendingWrites).toBe(true);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service doc failures", () => {
  it.live("fails on data that does not decode, and recovers on the next valid write", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));
      const before = yield* next(results);

      // The model is bypassed, so data it rejects reaches Firestore.
      yield* Effect.promise(() =>
        Sdk.setDoc(Sdk.doc(firestore.instance, hello.path), { title: "Hello", views: "many" }),
      );

      const failed = yield* Queue.take(results);
      assert(AsyncResult.isFailure(failed));
      expect(Cause.squash(failed.cause)).toBeInstanceOf(Schema.SchemaError);
      expect(failed.previousSuccess).toEqual(Option.some(before));

      yield* firestore.setDoc(hello, { title: "Hello", views: 2 });

      const recovered = yield* next(results);
      assert(recovered.value._tag === "Existing");
      expect(recovered.value.data.views).toBe(2);
      expect(listeners.attached).toBe(1);
      expect(listeners.detached).toBe(0);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service doc listen errors", () => {
  it.live("fails when Firestore drops the listen, and listens again only on a refresh", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const atom = Db.doc(hello);
      const results = yield* listening(AtomRegistry.toStream(registry, atom));
      const before = yield* next(results);

      listeners.drop(
        new FirebaseError("permission-denied", "Missing or insufficient permissions."),
      );

      const failed = yield* Queue.take(results);
      assert(AsyncResult.isFailure(failed));
      const error = Cause.squash(failed.cause);
      assert(error instanceof FirestoreError);
      expect(error.code).toBe("permission-denied");
      expect(failed.previousSuccess).toEqual(Option.some(before));

      // Give a retry the time it would need to show up.
      yield* Effect.sleep("200 millis");
      expect(listeners.attached).toBe(1);
      expect(listeners.active).toBe(0);
      expect(registry.get(atom)).toBe(failed);

      registry.refresh(atom);

      const refreshing = yield* Queue.take(results);
      expect(AsyncResult.isFailure(refreshing) && refreshing.waiting).toBe(true);
      const recovered = yield* next(results);
      assert(recovered.value._tag === "Existing");
      expect(recovered.waiting).toBe(false);
      expect(listeners.attached).toBe(2);
      expect(listeners.active).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("detaches and reattaches its listener on a refresh while healthy", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      const atom = Db.doc(hello);
      const results = yield* listening(AtomRegistry.toStream(registry, atom));
      yield* next(results);

      registry.refresh(atom);

      const refreshing = yield* Queue.take(results);
      expect(AsyncResult.isSuccess(refreshing) && refreshing.waiting).toBe(true);
      expect((yield* next(results)).waiting).toBe(false);
      expect(listeners.attached).toBe(2);
      expect(listeners.detached).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service runtime", () => {
  it.live("gives Client Firestore to `yield* Db` in a derived atom", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const title = Db.runtime.atom(
        Effect.gen(function* () {
          const db = yield* Db;
          const snapshot = yield* db.getDoc(hello);
          return snapshot._tag === "Existing" ? (yield* snapshot.data).title : undefined;
        }),
      );

      expect(yield* AtomRegistry.getResult(registry, title)).toBe("Hello");
    }).pipe(Effect.scoped),
  );
});

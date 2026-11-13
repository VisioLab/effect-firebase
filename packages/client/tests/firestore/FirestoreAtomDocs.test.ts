import { assert, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { Cause, Context, Effect, Layer, Option, Queue, Schema } from "effect";
import { FirebaseError } from "firebase/app";
import * as Sdk from "firebase/firestore";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import {
  FirestoreError,
  UndefinedCollectionError,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import * as FirestoreAtom from "../../src/firestore/FirestoreAtom.ts";
import { clear, emulator, listening } from "./emulator.ts";
import { listeners } from "./listeners.ts";

vi.mock("firebase/firestore", async (importOriginal) =>
  (await import("./listeners.ts")).wrapOnSnapshot(await importOriginal()),
);

const projectId = "demo-client-firestore-atom-docs";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const Posts = Collection.make("posts", Post);
const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);
/** Every `posts` collection: the root one and each user's. */
const AllPosts = CollectionGroup.make(Posts, UserPosts);

const hello = Posts.doc(Posts.id.make("hello"));
const alice = Users.id.make("alice");
const alicesIntro = UserPosts.doc(alice, UserPosts.id.make("intro"));

// Each registry builds the layer anew, so each test gets an app of its own.
let apps = 0;

class Db extends FirestoreAtom.Service<Db>()("test/Db", {
  layer: () =>
    ClientFirestore.layer({ emulator }).pipe(
      Layer.provide(App.layer({ projectId }, `firestore-atom-docs-${++apps}`)),
    ),
}) {}

/**
 * A registry for the rest of the test, with `Db`'s runtime mounted, and the
 * Client Firestore that runtime holds.
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

/** The paths of the documents in a query snapshot, sorted. */
const paths = (snapshot: {
  readonly docs: ReadonlyArray<{ readonly ref: { readonly path: string } }>;
}) => snapshot.docs.map((doc) => doc.ref.path).toSorted();

describe("FirestoreAtom.Service docs", () => {
  it.live("is Initial until the first snapshot, then follows adds, edits and removes", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const results = yield* listening(
        AtomRegistry.toStream(registry, Db.docs(Posts.collection())),
      );

      expect(AsyncResult.isInitial(yield* Queue.take(results))).toBe(true);
      const first = yield* Queue.take(results);
      assert(AsyncResult.isSuccess(first));
      expect(first.waiting).toBe(false);
      expect(first.value.docs).toHaveLength(1);
      expect(first.value.docs[0]!.data).toBeInstanceOf(Post);
      expect(first.value.docs[0]).toMatchObject({
        id: "hello",
        data: { title: "Hello", views: 1 },
        metadata: { hasPendingWrites: false },
      });
      expect(first.value.metadata).toMatchObject({ hasPendingWrites: false });

      const other = Posts.doc(Posts.id.make("other"));
      yield* Effect.forkChild(firestore.setDoc(other, { title: "Other", views: 2 }));
      const added = yield* next(results);
      expect(paths(added.value)).toEqual(["posts/hello", "posts/other"]);
      expect(added.value.metadata.hasPendingWrites).toBe(true);

      yield* Effect.forkChild(firestore.updateDoc(other, { views: 3 }));
      const edited = yield* next(results);
      expect(edited.value.docs.find((doc) => doc.id === "other")?.data.views).toBe(3);

      yield* Effect.forkChild(
        Effect.promise(() => Sdk.deleteDoc(Sdk.doc(firestore.instance, hello.path))),
      );
      const removed = yield* next(results);
      expect(paths(removed.value)).toEqual(["posts/other"]);
    }).pipe(Effect.scoped),
  );

  it.live("holds the documents of each member collection of a Collection Group", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      yield* firestore.setDoc(alicesIntro, { title: "Intro", views: 2 });

      const result = yield* next(
        yield* listening(AtomRegistry.toStream(registry, Db.docs(AllPosts))),
      );

      expect(paths(result.value)).toEqual(["posts/hello", "users/alice/posts/intro"]);
      const intro = result.value.docs.find((doc) => doc.id === "intro");
      expect(intro?.ref.ancestors).toEqual([alice]);
      expect(intro?.data).toMatchObject({ title: "Intro", views: 2 });
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service docs failures", () => {
  it.live("fails on one document that does not decode, and recovers once it is fixed", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const results = yield* listening(
        AtomRegistry.toStream(registry, Db.docs(Posts.collection())),
      );
      const before = yield* next(results);

      // The model is bypassed, so data it rejects reaches Firestore.
      const bad = Posts.doc(Posts.id.make("bad"));
      yield* Effect.promise(() =>
        Sdk.setDoc(Sdk.doc(firestore.instance, bad.path), { title: "Bad", views: "many" }),
      );

      const failed = yield* Queue.take(results);
      assert(AsyncResult.isFailure(failed));
      expect(Cause.squash(failed.cause)).toBeInstanceOf(Schema.SchemaError);
      expect(failed.previousSuccess).toEqual(Option.some(before));

      yield* firestore.setDoc(bad, { title: "Bad", views: 2 });

      const recovered = yield* next(results);
      expect(paths(recovered.value)).toEqual(["posts/bad", "posts/hello"]);
      expect(listeners.attached).toBe(1);
      expect(listeners.detached).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.live("fails a group on a document outside its members, and does not listen again", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(alicesIntro, { title: "Intro", views: 2 });
      const atom = Db.docs(CollectionGroup.make(UserPosts));
      const results = yield* listening(AtomRegistry.toStream(registry, atom));
      const before = yield* next(results);

      // A root `posts` document, which the group does not define.
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const failed = yield* Queue.take(results);
      assert(AsyncResult.isFailure(failed));
      const error = Cause.squash(failed.cause);
      assert(error instanceof UndefinedCollectionError);
      expect(error.path).toBe("posts/hello");
      expect(failed.previousSuccess).toEqual(Option.some(before));

      yield* Effect.sleep("200 millis");
      expect(listeners.attached).toBe(1);
      expect(listeners.active).toBe(0);
      expect(registry.get(atom)).toBe(failed);
    }).pipe(Effect.scoped),
  );

  it.live("fails when Firestore drops the listen, and listens again only on a refresh", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      const atom = Db.docs(Posts.collection());
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

      yield* Effect.sleep("200 millis");
      expect(listeners.attached).toBe(1);

      registry.refresh(atom);

      const refreshing = yield* Queue.take(results);
      expect(AsyncResult.isFailure(refreshing) && refreshing.waiting).toBe(true);
      expect((yield* next(results)).waiting).toBe(false);
      expect(listeners.attached).toBe(2);
      expect(listeners.active).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service docs sharing", () => {
  it.live("gives the same atom and one listener for equal keys", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      const collection = Db.docs(Posts.collection());
      const group = Db.docs(AllPosts);
      const equalCollections = [
        Db.docs(Posts.collection(), {}),
        Db.docs(Posts.collection(), { source: "default", includeMetadataChanges: false }),
      ];
      // Built apart, and with the members in another order.
      const equalGroups = [
        Db.docs(AllPosts, {}),
        Db.docs(CollectionGroup.make(Posts, UserPosts)),
        Db.docs(CollectionGroup.make(UserPosts, Posts)),
      ];
      for (const other of equalCollections) {
        expect(other).toBe(collection);
      }
      for (const other of equalGroups) {
        expect(other).toBe(group);
      }

      yield* next(yield* listening(AtomRegistry.toStream(registry, collection)));
      yield* next(yield* listening(AtomRegistry.toStream(registry, group)));
      for (const other of [...equalCollections, ...equalGroups]) {
        yield* AtomRegistry.mount(registry, other);
      }

      expect(listeners.attached).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.live("never shares an atom between a collection and a group with the same id", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      yield* firestore.setDoc(alicesIntro, { title: "Intro", views: 2 });
      const atoms = [
        Db.docs(Posts.collection()),
        Db.docs(CollectionGroup.make(Posts)),
        Db.docs(AllPosts),
        Db.docs(Posts.collection(), { timeToLive: "1 minute" }),
        Db.docs(AllPosts, { includeMetadataChanges: true }),
      ];
      expect(new Set(atoms).size).toBe(atoms.length);

      const collection = yield* next(yield* listening(AtomRegistry.toStream(registry, atoms[0]!)));
      const group = yield* next(yield* listening(AtomRegistry.toStream(registry, atoms[2]!)));

      expect(paths(collection.value)).toEqual(["posts/hello"]);
      expect(paths(group.value)).toEqual(["posts/hello", "users/alice/posts/intro"]);
      expect(listeners.active).toBe(2);
    }).pipe(Effect.scoped),
  );
});

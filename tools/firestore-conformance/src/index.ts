/**
 * The conformance suite every Firestore backend in the workspace runs.
 *
 * Passing it is what "behaves like the SDKs" means: the Admin backend, the
 * client backend and the In-memory Firestore each run it against a layer of
 * their own.
 *
 * @packageDocumentation
 */
import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Equal, Layer, Queue, Schema, Stream } from "effect";
import {
  Collection,
  CollectionGroup,
  DocumentSnapshot,
  FirestoreModel,
  Patch,
  QuerySnapshot,
} from "@visiolab/effect-firebase/firestore";
import {
  Firestore,
  FirestoreError,
  Transaction,
  UndefinedCollectionError,
} from "@visiolab/effect-firebase/firestore/Firestore";

/**
 * What a backend tells the suite about itself, where a shared test can't hold
 * for every backend as written.
 *
 * **Details**
 *
 * Add an option only when a shared test genuinely can't hold for one backend,
 * the way Effect's `testLayer` suites take their options.
 */
export interface Options {
  /**
   * What the backend can't do yet, whose tests the suite skips.
   *
   * Only the In-memory Firestore sets it while it is being built: its
   * transactions land with #249, which drops them from here.
   */
  readonly unsupported?: ReadonlyArray<Capability> | undefined;
}

/**
 * Something a shared test needs that a backend may not offer yet.
 */
export type Capability = "transactions";

/**
 * Registers the conformance tests against `layer`, inside the caller's
 * `describe`.
 *
 * **Details**
 *
 * `layer` is built for each test, and must start with an empty database each
 * time it is. The emulator backends clear their project as they build it; an
 * in-memory one is empty by construction.
 *
 * @example Running the suite against a backend
 * ```ts
 * import { describe } from "@effect/vitest";
 * import { testFirestore } from "@visiolab/firestore-conformance";
 *
 * describe("MyFirestore, conformance", () => {
 *   testFirestore(layer);
 * });
 * ```
 */
export const testFirestore = <E>(layer: Layer.Layer<Firestore, E>, options: Options = {}): void => {
  const run = <A, E2>(effect: Effect.Effect<A, E2, Firestore>) =>
    effect.pipe(Effect.provide(layer));

  /** `it.effect`, skipped on a backend that can't do all of `needs` yet. */
  const needing = (...needs: ReadonlyArray<Capability>) =>
    it.effect.skipIf(needs.some((need) => options.unsupported?.includes(need) === true));

  describe("single documents", () => {
    it.effect("reads back what it wrote", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
          const snapshot = yield* firestore.getDoc(Posts.doc(hello));

          expect(snapshot._tag).toBe("Existing");
          expect(yield* read(snapshot)).toMatchObject({ title: "Hello", views: 1 });
        }),
      ),
    );

    it.effect("hands back a missing snapshot for a document that is not there", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          const snapshot = yield* firestore.getDoc(Posts.doc(hello));

          expect(snapshot._tag).toBe("Missing");
          expect(snapshot.id).toBe(hello);
        }),
      ),
    );

    it.effect("adds a document under an id Firestore picks, and reads it among the others", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
          const added = yield* firestore.addDoc(Posts.collection(), { title: "Added", views: 2 });
          const snapshot = yield* firestore.getDocs(Posts.collection());

          expect(added.id).not.toBe(hello);
          assert(QuerySnapshot.isQuerySnapshot(snapshot));
          expect(snapshot.docs.map((doc) => doc.id).toSorted()).toEqual(
            [hello, added.id].toSorted(),
          );
        }),
      ),
    );

    it.effect("updates the fields it is given, and leaves the others alone", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
          yield* firestore.updateDoc(Posts.doc(hello), { views: 2 });

          expect(yield* read(yield* firestore.getDoc(Posts.doc(hello)))).toMatchObject({
            title: "Hello",
            views: 2,
          });
        }),
      ),
    );

    // Only that it fails: the Admin backend gives no string `code` yet (#243).
    it.effect("refuses to update a document that is not there", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          const error = yield* Effect.flip(firestore.updateDoc(Posts.doc(hello), { views: 2 }));

          expect(error).toBeInstanceOf(FirestoreError);
        }),
      ),
    );

    it.effect("deletes a document, so that a read finds it missing", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
          yield* firestore.deleteDoc(Posts.doc(hello));

          expect((yield* firestore.getDoc(Posts.doc(hello)))._tag).toBe("Missing");
        }),
      ),
    );

    it.effect("deletes a document that is not there without failing", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.deleteDoc(Posts.doc(hello));

          expect((yield* firestore.getDoc(Posts.doc(hello)))._tag).toBe("Missing");
        }),
      ),
    );
  });

  describe("on a collection of a union", () => {
    needing("transactions")(
      "writes each member, reads it back as that member, and switches it with a set",
      () =>
        run(
          Effect.gen(function* () {
            const firestore = yield* Firestore;

            yield* firestore.setDoc(task, { version: 1, title: "t", state: { status: "pending" } });
            const first = yield* read(yield* firestore.getDoc(task));
            assert(first instanceof TaskV1);
            expect(first.state).toStrictEqual({ status: "pending" });

            yield* firestore.setDoc(task, {
              version: 2,
              title: "t",
              state: { status: "done", uri: "gs://x" },
              priority: 1,
            });
            const second = yield* firestore.runTransaction(
              Effect.gen(function* () {
                const tx = yield* Transaction;
                return yield* read(yield* tx.getDoc(task));
              }),
            );
            assert(second.version === 2);
            expect(second).toBeInstanceOf(TaskV2);
            expect(second.state).toStrictEqual({ status: "done", uri: "gs://x" });
            expect(second.priority).toBe(1);

            const added = yield* firestore.addDoc(Tasks.collection(), {
              version: 1,
              title: "a",
              state: { status: "pending" },
            });
            const snapshot = yield* firestore.getDocs(Tasks.collection());
            const members = yield* Effect.forEach(snapshot.docs, (doc) =>
              Effect.map(doc.data, (data) => [doc.id, data.constructor] as const),
            );
            expect(new Map(members)).toStrictEqual(
              new Map<string, unknown>([
                [task.id, TaskV2],
                [added.id, TaskV1],
              ]),
            );
          }),
        ),
    );

    it.effect("updates a Shared Field whichever member the document holds", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(task, { version: 1, title: "t", state: { status: "pending" } });
          yield* firestore.updateDoc(task, { title: "u" });

          expect(yield* read(yield* firestore.getDoc(task))).toMatchObject({
            version: 1,
            title: "u",
            state: { status: "pending" },
          });
        }),
      ),
    );

    it.effect("updates a key only one member holds, unchecked alone", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(task, {
            version: 2,
            title: "t",
            state: { status: "pending" },
            priority: 1,
          });
          const checked = yield* Effect.flip(
            // The types refuse this patch, as a first-version task holds no
            // `priority`; cast past them to see the schema refuse it too.
            firestore.updateDoc(task, { priority: 2 } as never),
          );
          expect(checked._tag).toBe("SchemaError");
          yield* firestore.updateDoc(task, { priority: 2 }, { mode: "unchecked" });

          expect(yield* read(yield* firestore.getDoc(task))).toMatchObject({
            version: 2,
            title: "t",
            priority: 2,
          });
        }),
      ),
    );

    it.effect("replaces and patches the union every member holds, through an update", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(task, { version: 1, title: "t", state: { status: "pending" } });
          yield* firestore.updateDoc(task, {
            state: Patch.replace({ status: "done", uri: "gs://x" }),
          });
          expect((yield* read(yield* firestore.getDoc(task))).state).toStrictEqual({
            status: "done",
            uri: "gs://x",
          });

          // Only a done state holds a `uri`, which the caller vouches for.
          yield* firestore.updateDoc(task, { state: { uri: "gs://y" } }, { mode: "unchecked" });
          expect(yield* read(yield* firestore.getDoc(task))).toMatchObject({
            version: 1,
            title: "t",
            state: { status: "done", uri: "gs://y" },
          });
        }),
      ),
    );

    it.effect("streams the document and the collection, each read as its member", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(task, {
            version: 2,
            title: "t",
            state: { status: "pending" },
            priority: 1,
          });

          const [doc] = yield* firestore.streamDoc(task).pipe(Stream.take(1), Stream.runCollect);
          const streamed = yield* read(doc);
          assert(streamed.version === 2);
          expect(streamed).toBeInstanceOf(TaskV2);
          expect(streamed.priority).toBe(1);

          const [docs] = yield* firestore
            .streamDocs(Tasks.collection())
            .pipe(Stream.take(1), Stream.runCollect);
          const [listed] = yield* Effect.forEach(docs.docs, (snapshot) => snapshot.data);
          assert(listed.version === 2);
          expect(listed).toBeInstanceOf(TaskV2);
          expect(listed.priority).toBe(1);
        }),
      ),
    );

    it.effect("fails to read a document matching no member, with a schema issue", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(Strays.doc(Strays.id.make("task")), { title: "t", views: 1 });
          const error = yield* Effect.flip(read(yield* firestore.getDoc(task)));

          expect(Schema.isSchemaError(error)).toBe(true);
        }),
      ),
    );
  });

  describe("collection and Collection Group reads", () => {
    it.effect("reads only the documents directly in a collection, not in its subcollections", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(Users.doc(alice), { name: "Alice" });
          yield* firestore.setDoc(UserPosts.doc(alice, intro), { title: "Intro", views: 1 });

          const users = yield* firestore.getDocs(Users.collection());
          const posts = yield* firestore.getDocs(UserPosts.collection(alice));

          expect(users.docs.map((doc) => doc.ref.path)).toEqual(["users/alice"]);
          expect(posts.docs.map((doc) => doc.ref.path)).toEqual(["users/alice/posts/intro"]);
        }),
      ),
    );

    it.effect("reads every document of a Collection Group, across all of its parents", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(UserPosts.doc(alice, greeting), { title: "Hello", views: 1 });
          yield* firestore.setDoc(UserPosts.doc(alice, again), { title: "Again", views: 2 });
          yield* firestore.setDoc(UserPosts.doc(bob, intro), { title: "Intro", views: 3 });

          const snapshot = yield* firestore.getDocs(AllUserPosts);

          const read = yield* Effect.forEach(snapshot.docs, (doc) =>
            Effect.map(doc.data, (data) => ({ doc, data })),
          );
          const byPath = read.toSorted((a, b) => a.doc.ref.path.localeCompare(b.doc.ref.path));

          expect(byPath.map(({ doc }) => doc.ref.path)).toEqual([
            "users/alice/posts/again",
            "users/alice/posts/hello",
            "users/bob/posts/intro",
          ]);
          expect(byPath.map(({ doc }) => doc.ref.ancestors)).toEqual([[alice], [alice], [bob]]);
          expect(byPath.map(({ doc }) => doc.id)).toEqual([again, greeting, intro]);
          expect(Equal.equals(byPath[2].doc.ref, UserPosts.doc(bob, intro))).toBe(true);
          expect(byPath.map(({ data }) => data)).toEqual([
            { title: "Again", views: 2 },
            { title: "Hello", views: 1 },
            { title: "Intro", views: 3 },
          ]);
        }),
      ),
    );

    it.effect("reads a Collection Group with nothing in it as a snapshot with no documents", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          const snapshot = yield* firestore.getDocs(AllUserPosts);

          expect(snapshot.docs).toEqual([]);
        }),
      ),
    );

    it.effect(
      "fails on a document under the collection id at a path the group does not define",
      () =>
        run(
          Effect.gen(function* () {
            const firestore = yield* Firestore;

            yield* firestore.setDoc(UserPosts.doc(alice, greeting), { title: "Hello", views: 1 });
            yield* firestore.setDoc(Posts.doc(Posts.id.make("stray")), {
              title: "Stray",
              views: 0,
            });

            const error = yield* Effect.flip(firestore.getDocs(AllUserPosts));

            expect(error).toBeInstanceOf(UndefinedCollectionError);
            expect(error).toMatchObject({ path: "posts/stray", collectionId: "posts" });
          }),
        ),
    );

    it.effect(
      "reads each document of a Collection Group as one of the collection it lives in",
      () =>
        run(
          Effect.gen(function* () {
            const firestore = yield* Firestore;

            yield* firestore.setDoc(UserPosts.doc(alice, greeting), { title: "Hello", views: 1 });
            yield* firestore.setDoc(OrgPosts.doc(acme, launch), {
              headline: "Launch",
              pinned: true,
            });

            const { docs } = yield* firestore.getDocs(AllPosts);

            const userPosts = docs.filter(UserPosts.contains);
            const orgPosts = docs.filter(OrgPosts.contains);

            expect(userPosts.map((doc) => doc.ref.path)).toEqual(["users/alice/posts/hello"]);
            expect(userPosts.map((doc) => doc.ref.ancestors)).toEqual([[alice]]);
            expect(Equal.equals(userPosts[0].ref, UserPosts.doc(alice, greeting))).toBe(true);
            expect(yield* userPosts[0].data).toEqual({ title: "Hello", views: 1 });

            expect(orgPosts.map((doc) => doc.ref.path)).toEqual(["orgs/acme/posts/launch"]);
            expect(orgPosts.map((doc) => doc.ref.ancestors)).toEqual([[acme]]);
            expect(Equal.equals(orgPosts[0].ref, OrgPosts.doc(acme, launch))).toBe(true);
            expect(yield* orgPosts[0].data).toEqual({ headline: "Launch", pinned: true });
          }),
        ),
    );

    it.effect(
      "fails on a document under the collection id that no collection of the group defines",
      () =>
        run(
          Effect.gen(function* () {
            const firestore = yield* Firestore;

            yield* firestore.setDoc(UserPosts.doc(alice, greeting), { title: "Hello", views: 1 });
            yield* firestore.setDoc(
              TeamPosts.doc(Teams.id.make("red"), TeamPosts.id.make("stray")),
              {
                title: "Stray",
                views: 0,
              },
            );

            const error = yield* Effect.flip(firestore.getDocs(AllPosts));

            expect(error).toBeInstanceOf(UndefinedCollectionError);
            expect(error).toMatchObject({ path: "teams/red/posts/stray", collectionId: "posts" });
          }),
        ),
    );
  });

  // Each test asserts that a listener eventually emits a snapshot holding what
  // it expects, not an exact sequence: the client emits an extra snapshot for
  // a write that hasn't reached the server yet.
  describe("listeners", () => {
    it.effect("streamDoc starts with the document as it is, and follows each change to it", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          const snapshots = yield* listening(firestore.streamDoc(Posts.doc(hello)));

          yield* eventually(snapshots, (snapshot) =>
            Effect.succeed(DocumentSnapshot.isMissing(snapshot)),
          );

          yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
          yield* eventually(snapshots, holdsPost({ title: "Hello", views: 1 }));

          yield* firestore.updateDoc(Posts.doc(hello), { views: 2 });
          yield* eventually(snapshots, holdsPost({ title: "Hello", views: 2 }));
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("streamDocs starts with the collection as it is, and follows each change to it", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          const snapshots = yield* listening(firestore.streamDocs(Posts.collection()));

          yield* eventually(snapshots, holdsPaths([]));

          yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
          yield* eventually(snapshots, holdsPaths(["posts/hello"]));

          const added = yield* firestore.addDoc(Posts.collection(), { title: "Added", views: 2 });
          yield* eventually(snapshots, holdsPaths(["posts/hello", added.path]));
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("streams a Collection Group, and follows a change under any parent", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(UserPosts.doc(alice, greeting), { title: "Hello", views: 1 });

          const snapshots = yield* listening(firestore.streamDocs(AllUserPosts));

          const first = yield* eventually(snapshots, holdsPaths(["users/alice/posts/hello"]));
          expect(first.docs.map((doc) => doc.ref.ancestors)).toEqual([[alice]]);
          expect(yield* Effect.forEach(first.docs, (doc) => doc.data)).toEqual([
            { title: "Hello", views: 1 },
          ]);

          yield* firestore.setDoc(UserPosts.doc(bob, intro), { title: "Intro", views: 2 });
          yield* eventually(
            snapshots,
            holdsPaths(["users/alice/posts/hello", "users/bob/posts/intro"]),
          );

          yield* firestore.updateDoc(UserPosts.doc(alice, greeting), { views: 3 });
          const updated = yield* eventually(snapshots, (snapshot) =>
            Effect.map(viewsByPath(snapshot), (views) => views.join() === "3,2"),
          );
          expect(updated.docs.map((doc) => doc.ref.path).toSorted()).toEqual([
            "users/alice/posts/hello",
            "users/bob/posts/intro",
          ]);
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("streams a Collection Group of several collections, and follows each of them", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(UserPosts.doc(alice, greeting), { title: "Hello", views: 1 });

          const snapshots = yield* listening(firestore.streamDocs(AllPosts));
          yield* eventually(snapshots, holdsPaths(["users/alice/posts/hello"]));

          yield* firestore.setDoc(OrgPosts.doc(acme, launch), {
            headline: "Launch",
            pinned: false,
          });
          const added = yield* eventually(
            snapshots,
            holdsPaths(["orgs/acme/posts/launch", "users/alice/posts/hello"]),
          );
          const orgPost = added.docs.find(OrgPosts.contains);
          assert(orgPost !== undefined);
          expect(orgPost.ref.ancestors).toEqual([acme]);
          expect(yield* orgPost.data).toEqual({ headline: "Launch", pinned: false });

          yield* firestore.updateDoc(UserPosts.doc(alice, greeting), { views: 2 });
          const updated = yield* eventually(snapshots, (snapshot) =>
            Effect.gen(function* () {
              const userPost = snapshot.docs.find(UserPosts.contains);
              return userPost !== undefined && (yield* userPost.data).views === 2;
            }),
          );
          expect(updated.docs.filter(OrgPosts.contains)).toHaveLength(1);
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("fails a Collection Group stream once a document appears at an undefined path", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(UserPosts.doc(alice, greeting), { title: "Hello", views: 1 });

          const snapshots = yield* listening(firestore.streamDocs(AllUserPosts));
          yield* eventually(snapshots, holdsPaths(["users/alice/posts/hello"]));

          yield* firestore.setDoc(Posts.doc(Posts.id.make("stray")), { title: "Stray", views: 0 });

          const error = yield* Effect.flip(eventually(snapshots, () => Effect.succeed(false)));

          expect(error).toBeInstanceOf(UndefinedCollectionError);
          expect(error).toMatchObject({ path: "posts/stray", collectionId: "posts" });
        }).pipe(Effect.scoped),
      ),
    );
  });
};

/**
 * Runs `stream` into a queue for the rest of the scope, so no snapshot is
 * dropped for arriving while the test was busy writing.
 */
const listening = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.toQueue(stream, { capacity: "unbounded" });

/**
 * Takes snapshots off `snapshots` until one `holds`, and returns it. Fails
 * when the stream does.
 */
const eventually = <A, E, E2>(
  snapshots: Queue.Dequeue<A, E>,
  holds: (snapshot: A) => Effect.Effect<boolean, E2>,
): Effect.Effect<A, E | E2> =>
  Effect.flatMap(Queue.take(snapshots), (snapshot) =>
    Effect.flatMap(holds(snapshot), (held) =>
      held ? Effect.succeed(snapshot) : eventually(snapshots, holds),
    ),
  );

/** Whether a document snapshot holds a post with the `expected` fields. */
const holdsPost =
  (expected: { readonly title: string; readonly views: number }) =>
  (snapshot: DocumentSnapshot.DocumentSnapshot<typeof Posts>) =>
    DocumentSnapshot.isExisting(snapshot)
      ? Effect.map(
          snapshot.data,
          (post) => post.title === expected.title && post.views === expected.views,
        )
      : Effect.succeed(false);

interface Listed {
  readonly docs: ReadonlyArray<{ readonly ref: { readonly path: string } }>;
}

/** Whether a query snapshot holds exactly the documents at `paths`, in any order. */
const holdsPaths = (paths: ReadonlyArray<string>) => (snapshot: Listed) =>
  Effect.succeed(
    snapshot.docs
      .map((doc) => doc.ref.path)
      .toSorted()
      .join() === paths.toSorted().join(),
  );

/** The views of each post in a query snapshot, in the order of their paths. */
const viewsByPath = <E>(snapshot: {
  readonly docs: ReadonlyArray<{
    readonly ref: { readonly path: string };
    readonly data: Effect.Effect<Post, E>;
  }>;
}) =>
  Effect.forEach(
    snapshot.docs.toSorted((a, b) => a.ref.path.localeCompare(b.ref.path)),
    (doc) => Effect.map(doc.data, (post) => post.views),
  );

const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
  DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.id.make("hello");

const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending") });
const Done = FirestoreModel.Struct({ status: Schema.Literal("done"), uri: Schema.String });

class TaskV1 extends FirestoreModel.Class<TaskV1>("TaskV1")({
  version: Schema.Literal(1),
  title: Schema.String,
  state: FirestoreModel.Union([Pending, Done]),
}) {}

class TaskV2 extends FirestoreModel.Class<TaskV2>("TaskV2")({
  version: Schema.Literal(2),
  title: Schema.String,
  state: FirestoreModel.Union([Pending, Done]),
  priority: Schema.Finite,
}) {}

const Tasks = Collection.make("tasks", FirestoreModel.Union([TaskV1, TaskV2]));
// The same collection under another model, to put a document there that
// matches no member.
const Strays = Collection.make("tasks", Post);
const task = Tasks.doc(Tasks.id.make("task"));

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({
  headline: Schema.String,
  pinned: Schema.Boolean,
}) {}

const Users = Collection.make("users", User);
const Orgs = Collection.make("orgs", Org);
const UserPosts = Users.subcollection("posts", Post);
const OrgPosts = Orgs.subcollection("posts", OrgPost);
const AllUserPosts = CollectionGroup.make(UserPosts);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);
// A `posts` under `teams`, which no Collection Group here defines. `Posts`, at
// the root, is another.
const Teams = Collection.make("teams", Org);
const TeamPosts = Teams.subcollection("posts", Post);

const alice = Users.id.make("alice");
const bob = Users.id.make("bob");
const acme = Orgs.id.make("acme");
const greeting = UserPosts.id.make("hello");
const again = UserPosts.id.make("again");
const intro = UserPosts.id.make("intro");
const launch = OrgPosts.id.make("launch");

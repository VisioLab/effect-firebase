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
import {
  Array,
  Clock,
  Context,
  DateTime,
  Deferred,
  Effect,
  Equal,
  Equivalence,
  Exit,
  Fiber,
  Layer,
  Option,
  Order,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import {
  Collection,
  CollectionGroup,
  DocumentSnapshot,
  FieldValue,
  FirestoreModel,
  FirestoreSchema,
  GeoPoint,
  Patch,
  QuerySnapshot,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import {
  type DocumentData,
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
export interface Options<R> {
  /**
   * Stores `data` at `path` as it is, past every model, for the tests that
   * seed data no model would write.
   *
   * The emulator backends write through the raw SDK; the In-memory Firestore
   * through `MemoryDriver.set`. It may need any service `layer` provides.
   */
  readonly seedRaw: (path: string, data: DocumentData) => Effect.Effect<void, never, R>;
  /**
   * The code a test's own error carries where the backend's SDK would read it
   * as a conflict, to show that such an error fails the transaction as it is
   * and isn't retried.
   *
   * The Admin SDK reads the number `10` as ABORTED; the client SDK reads the
   * string `"aborted"`.
   */
  readonly abortCode: number | string;
}

/**
 * Registers the conformance tests against `layer`, inside the caller's
 * `describe`.
 *
 * **Details**
 *
 * `layer` is built for each test, and must start with an empty database each
 * time it is. The emulator backends clear their project as they build it; an
 * in-memory one is empty by construction. Besides `Firestore`, it provides
 * whatever `options.seedRaw` needs.
 *
 * @example Running the suite against a backend
 * ```ts
 * import { describe } from "@effect/vitest";
 * import { Effect } from "effect";
 * import { Firestore } from "@visiolab/effect-firebase/firestore";
 * import type { DocumentData } from "@visiolab/effect-firebase/firestore/Firestore";
 * import { testFirestore } from "@visiolab/firestore-conformance";
 *
 * const layer = Firestore.layerMemory;
 * const seedRaw = (path: string, data: DocumentData) =>
 *   Effect.flatMap(Firestore.MemoryDriver, (driver) => driver.set(path, data));
 *
 * describe("MyFirestore, conformance", () => {
 *   testFirestore(layer, { seedRaw, abortCode: "aborted" });
 * });
 * ```
 */
export const testFirestore = <E, R = never>(
  layer: Layer.Layer<Firestore | R, E>,
  options: Options<R>,
): void => {
  const run = <A, E2>(effect: Effect.Effect<A, E2, Firestore | R>) =>
    effect.pipe(Effect.provide(layer));

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
          expect(
            Array.sort(
              snapshot.docs.map((doc) => doc.id),
              Order.String,
            ),
          ).toEqual(Array.sort([hello, added.id], Order.String));
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
    it.effect("writes each member, reads it back as that member, and switches it with a set", () =>
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

          const byPath = yield* Effect.forEach(
            Array.sort(snapshot.docs, Order.mapInput(Order.String, pathOf)),
            (doc) => Effect.map(doc.data, (data) => ({ doc, data })),
          );

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
            Effect.map(viewsByPath(snapshot), (views) =>
              Equivalence.Array(Equivalence.Number)(views, [3, 2]),
            ),
          );
          expect(Array.sort(updated.docs.map(pathOf), Order.String)).toEqual([
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

  describe("codec and sentinels", () => {
    it.effect("reads back a plain model equal to what was written", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(launchEvent, event);
          const data = yield* read(yield* firestore.getDoc(launchEvent));

          expect(data.title).toBe("Launch");
          expect(DateTime.toEpochMillis(data.at)).toBe(DateTime.toEpochMillis(event.at));
          expect(data.day.getTime()).toBe(event.day.getTime());
          expect([...data.payload]).toEqual([1, 2, 3]);
          expect(data.note).toEqual(Option.some("on time"));
        }),
      ),
    );

    it.effect("reads back FirestoreSchema values equal to what was written", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(hall, venue);
          const data = yield* read(yield* firestore.getDoc(hall));

          expect(Equal.equals(data.openedAt, venue.openedAt)).toBe(true);
          expect(Equal.equals(data.where, venue.where)).toBe(true);
          expect(Equal.equals(data.owner, ada)).toBe(true);
          expect(data.owner.collection).toBe(Members);
          expect(DateTime.toEpochMillis(data.createdAt)).toBe(
            DateTime.toEpochMillis(venue.createdAt),
          );
          expect(data.checkedAt.getTime()).toBe(venue.checkedAt.getTime());
        }),
      ),
    );

    // `before` comes from `Clock`, which `it.effect` pins to 0 with `TestClock`,
    // so the bound holds for the server's time and for the In-memory one alike.
    it.effect("takes a server timestamp on create, read back as the schema holds it", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          const before = yield* Clock.currentTimeMillis;
          yield* firestore.setDoc(hall, {
            ...venue,
            createdAt: FieldValue.serverTimestamp,
            checkedAt: FieldValue.serverTimestamp,
          });
          const data = yield* read(yield* firestore.getDoc(hall));

          expect(DateTime.isDateTime(data.createdAt)).toBe(true);
          expect(DateTime.toEpochMillis(data.createdAt)).toBeGreaterThanOrEqual(before - 60_000);
          expect(data.checkedAt).toBeInstanceOf(Date);
          expect(data.checkedAt.getTime()).toBeGreaterThanOrEqual(before - 60_000);
        }),
      ),
    );

    it.effect("takes a server timestamp on update", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(poll, tally);

          const before = yield* Clock.currentTimeMillis;
          yield* firestore.updateDoc(poll, { updatedAt: FieldValue.serverTimestamp });
          const data = yield* read(yield* firestore.getDoc(poll));

          expect(DateTime.toEpochMillis(data.updatedAt)).toBeGreaterThanOrEqual(before - 60_000);
          expect(DateTime.toEpochMillis(data.updatedAt)).not.toBe(
            DateTime.toEpochMillis(tally.updatedAt),
          );
        }),
      ),
    );

    it.effect("moves a number up by an increment and down by a decrement", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(poll, tally);

          yield* firestore.updateDoc(poll, { views: FieldValue.increment(3) });
          yield* firestore.updateDoc(poll, { views: FieldValue.decrement(2) });

          expect((yield* read(yield* firestore.getDoc(poll))).views).toBe(6);
        }),
      ),
    );

    it.effect("replaces a missing field, or one holding no number, with the increment", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* options.seedRaw("counters/missing", { tags: ["a"] });
          yield* options.seedRaw("counters/text", { count: "many", tags: ["a"] });

          yield* firestore.updateDoc(missing, { count: FieldValue.increment(3) });
          yield* firestore.updateDoc(text, { count: FieldValue.decrement(2) });

          expect((yield* read(yield* firestore.getDoc(missing))).count).toBe(3);
          expect((yield* read(yield* firestore.getDoc(text))).count).toBe(-2);
        }),
      ),
    );

    it.effect("deletes a field, at the top level and inside a struct", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(poll, tally);

          yield* firestore.updateDoc(poll, {
            nickname: FieldValue.deleteField,
            address: { note: FieldValue.deleteField },
          });
          const data = yield* read(yield* firestore.getDoc(poll));

          expect(data.nickname).toBeUndefined();
          expect(data.address).toEqual({ city: "Berlin" });
        }),
      ),
    );

    it.effect("grows an array by a union and shrinks it by a removal", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(poll, tally);

          yield* firestore.updateDoc(poll, { tags: FieldValue.arrayUnion("b", "a") });
          expect((yield* read(yield* firestore.getDoc(poll))).tags).toEqual(["a", "b"]);
          yield* firestore.updateDoc(poll, { tags: FieldValue.arrayRemove("a") });
          expect((yield* read(yield* firestore.getDoc(poll))).tags).toEqual(["b"]);
        }),
      ),
    );

    it.effect("adds only elements not yet there, and removes every equal one", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* options.seedRaw("counters/text", { count: 1, tags: ["a", "b", "a"] });

          yield* firestore.updateDoc(text, { tags: FieldValue.arrayUnion("a", "c") });
          expect((yield* read(yield* firestore.getDoc(text))).tags).toEqual(["a", "b", "a", "c"]);
          yield* firestore.updateDoc(text, { tags: FieldValue.arrayRemove("a") });
          expect((yield* read(yield* firestore.getDoc(text))).tags).toEqual(["b", "c"]);
        }),
      ),
    );

    it.effect("replaces a field holding no array with what a union or removal leaves", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* options.seedRaw("counters/missing", { count: 1, tags: "none" });
          yield* options.seedRaw("counters/text", { count: 1, tags: "none" });

          yield* firestore.updateDoc(missing, { tags: FieldValue.arrayUnion("a", "b") });
          yield* firestore.updateDoc(text, { tags: FieldValue.arrayRemove("a") });

          expect((yield* read(yield* firestore.getDoc(missing))).tags).toEqual(["a", "b"]);
          expect((yield* read(yield* firestore.getDoc(text))).tags).toEqual([]);
        }),
      ),
    );

    it.effect("grows and shrinks an array of timestamps, matching elements by value", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;
          yield* firestore.setDoc(poll, tally);

          const later = at("2024-06-01T12:00:00.002Z");
          yield* firestore.updateDoc(poll, { seenAt: FieldValue.arrayUnion(later) });
          expect((yield* read(yield* firestore.getDoc(poll))).seenAt).toHaveLength(2);

          // A removal matches what a union wrote, since both encode the same way.
          yield* firestore.updateDoc(poll, {
            seenAt: FieldValue.arrayRemove(at("2024-01-01T00:00:00.001Z")),
          });
          const data = yield* read(yield* firestore.getDoc(poll));
          expect(data.seenAt.map(DateTime.toEpochMillis)).toEqual([DateTime.toEpochMillis(later)]);
        }),
      ),
    );
  });

  describe("transactions", () => {
    /** The error a test's body fails with, carrying the backend's abort code. */
    const refused = () => new Refused({ code: options.abortCode });

    it.effect("commits what the body writes, and hands back what it returns", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);

          const n = yield* firestore.runTransaction(increment);

          expect(n).toBe(2);
          expect(yield* valueOf(counter)).toBe(2);
        }),
      ),
    );

    it.effect(
      "runs the body again when other transactions get in the way",
      () =>
        run(
          Effect.gen(function* () {
            const firestore = yield* fresh(0);
            const runs = yield* Ref.make(0);

            const results = yield* Effect.replicateEffect(
              firestore.runTransaction(
                Ref.update(runs, (n) => n + 1).pipe(Effect.andThen(increment)),
                { maxAttempts: 20 },
              ),
              4,
              { concurrency: "unbounded" },
            );

            // Every one of them counted from what the one before it wrote,
            // which only holds where the ones that read too early ran again.
            expect(Array.sort(results, Order.Number)).toEqual([1, 2, 3, 4]);
            expect(yield* valueOf(counter)).toBe(4);
            expect(yield* Ref.get(runs)).toBeGreaterThan(4);
          }),
        ),
      // The SDKs back off between attempts, on timers of their own.
      { timeout: 20_000 },
    );

    it.effect(
      "gives up after maxAttempts, failing with a FirestoreError",
      () =>
        run(
          Effect.gen(function* () {
            const firestore = yield* fresh(0);

            const exits = yield* Effect.replicateEffect(
              Effect.exit(firestore.runTransaction(increment, { maxAttempts: 1 })),
              8,
              { concurrency: "unbounded" },
            );

            const failures = exits.filter(Exit.isFailure);
            expect(failures.length).toBeGreaterThan(0);
            for (const exit of failures) {
              expect(exit.cause.reasons).toMatchObject([
                { _tag: "Fail", error: expect.any(FirestoreError) },
              ]);
            }
            // What did commit, counted.
            expect(yield* valueOf(counter)).toBe(exits.length - failures.length);
          }),
        ),
      { timeout: 20_000 },
    );

    it.effect("fails with the body's own error unchanged, and does not retry it", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);
          const runs = yield* Ref.make(0);

          // It carries the code the SDK would take for a conflict if it
          // reached it as it is.
          const error = yield* Effect.flip(
            firestore.runTransaction(
              Effect.gen(function* () {
                yield* Ref.update(runs, (n) => n + 1);
                yield* increment;
                return yield* refused();
              }),
            ),
          );

          expect(error).toBeInstanceOf(Refused);
          expect(yield* Ref.get(runs)).toBe(1);
          expect(yield* valueOf(counter)).toBe(1);
        }),
      ),
    );

    it.effect("dies with the body's defect, and does not retry it", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);
          const runs = yield* Ref.make(0);

          const exit = yield* Effect.exit(
            firestore.runTransaction(
              Ref.update(runs, (n) => n + 1).pipe(Effect.andThen(Effect.die("boom"))),
            ),
          );

          expect(Exit.isFailure(exit) && exit.cause.reasons).toMatchObject([
            { _tag: "Die", defect: "boom" },
          ]);
          expect(yield* Ref.get(runs)).toBe(1);
        }),
      ),
    );

    it.effect("rolls back a write that does not encode", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);

          const error = yield* Effect.flip(
            firestore.runTransaction(
              Effect.gen(function* () {
                const tx = yield* Transaction;
                yield* tx.setDoc(other, { n: 1 });
                yield* tx.setDoc(counter, { n: Number.NaN });
              }),
            ),
          );

          expect(error._tag).toBe("SchemaError");
          expect(yield* valueOf(other)).toBeUndefined();
          expect(yield* valueOf(counter)).toBe(1);
        }),
      ),
    );

    it.effect("deletes a document when it commits", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);

          yield* firestore.runTransaction(
            Effect.gen(function* () {
              const tx = yield* Transaction;
              yield* tx.getDoc(counter);
              yield* tx.deleteDoc(counter);
            }),
          );

          expect(yield* valueOf(counter)).toBeUndefined();
        }),
      ),
    );

    it.effect("deletes a document that is not there without failing", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);

          yield* firestore.runTransaction(
            Effect.gen(function* () {
              const tx = yield* Transaction;
              yield* tx.deleteDoc(other);
            }),
          );

          expect(yield* valueOf(other)).toBeUndefined();
          expect(yield* valueOf(counter)).toBe(1);
        }),
      ),
    );

    it.effect("keeps a document it deleted when the body fails afterwards", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);

          const error = yield* Effect.flip(
            firestore.runTransaction(
              Effect.gen(function* () {
                const tx = yield* Transaction;
                yield* tx.deleteDoc(counter);
                return yield* Effect.fail("Changed my mind" as const);
              }),
            ),
          );

          expect(error).toBe("Changed my mind");
          expect(yield* valueOf(counter)).toBe(1);
        }),
      ),
    );

    it.effect("fails a read after a write with the body's own error", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);

          const error = yield* Effect.flip(
            firestore.runTransaction(
              Effect.gen(function* () {
                const tx = yield* Transaction;
                yield* tx.setDoc(other, { n: 1 });
                return yield* tx.getDoc(counter);
              }),
            ),
          );

          // Not one wrapped around it on the way out.
          expect(error).toBeInstanceOf(FirestoreError);
          expect(error.message).toBe('Failed to read the document "counters/counter"');
          expect(yield* valueOf(other)).toBeUndefined();
        }),
      ),
    );

    // Live, because the body runs on the caller's clock, and a test clock
    // would never let it finish cleaning up.
    it.live("rolls back when interrupted, and waits for the body to stop", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);
          const queued = yield* Deferred.make<void>();
          const stopped = yield* Ref.make(false);

          const fiber = yield* Effect.forkChild(
            firestore.runTransaction(
              Effect.gen(function* () {
                yield* increment;
                yield* Deferred.succeed(queued, undefined);
                return yield* Effect.never;
              }).pipe(
                Effect.onInterrupt(() =>
                  Effect.sleep("50 millis").pipe(Effect.andThen(Ref.set(stopped, true))),
                ),
              ),
            ),
          );
          yield* Deferred.await(queued);
          yield* Fiber.interrupt(fiber);

          expect(yield* Ref.get(stopped)).toBe(true);
          expect(yield* valueOf(counter)).toBe(1);
        }),
      ),
    );

    it.effect("commits a transaction run inside another on its own", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* fresh(1);

          yield* Effect.flip(
            firestore.runTransaction(
              Effect.gen(function* () {
                yield* increment;
                yield* firestore.runTransaction(
                  Effect.gen(function* () {
                    const tx = yield* Transaction;
                    yield* tx.setDoc(other, { n: 1 });
                  }),
                );
                return yield* Effect.fail("Changed my mind" as const);
              }),
            ),
          );

          // The outer one rolled back, and the inner one stayed.
          expect(yield* valueOf(counter)).toBe(1);
          expect(yield* valueOf(other)).toBe(1);
        }),
      ),
    );

    it.effect("hands the body the services of the caller, and asks for no Transaction", () =>
      run(
        Effect.gen(function* () {
          interface Step {
            readonly by: number;
          }
          const Step = Context.Service<Step>("Step");
          const firestore = yield* fresh(1);

          const body = firestore.runTransaction(
            Effect.gen(function* () {
              const { by } = yield* Step;
              const tx = yield* Transaction;
              yield* tx.setDoc(counter, { n: by });
              return by;
            }),
          );
          expect(yield* Effect.provideService(body, Step, { by: 5 })).toBe(5);
          expect(yield* valueOf(counter)).toBe(5);
        }),
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
): Effect.Effect<A, E | E2> => Effect.repeat(Queue.take(snapshots), { until: holds });

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

/** The path of a document in a query snapshot. */
const pathOf = (doc: Listed["docs"][number]): string => doc.ref.path;

const samePaths = Equivalence.Array(Equivalence.String);

/** Whether a query snapshot holds exactly the documents at `paths`, in any order. */
const holdsPaths = (paths: ReadonlyArray<string>) => (snapshot: Listed) =>
  Effect.succeed(
    samePaths(
      Array.sort(Array.map(snapshot.docs, pathOf), Order.String),
      Array.sort(paths, Order.String),
    ),
  );

/** The views of each post in a query snapshot, in the order of their paths. */
const viewsByPath = <E>(snapshot: {
  readonly docs: ReadonlyArray<{
    readonly ref: { readonly path: string };
    readonly data: Effect.Effect<Post, E>;
  }>;
}) =>
  Effect.forEach(Array.sort(snapshot.docs, Order.mapInput(Order.String, pathOf)), (doc) =>
    Effect.map(doc.data, (post) => post.views),
  );

/** The data of a document snapshot, decoded, dying when the document is missing. */
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

// A model of plain Effect schemas: nothing in it names how Firestore stores it.
class Event extends FirestoreModel.Class<Event>("Event")({
  title: Schema.String,
  at: Schema.DateTimeUtc,
  day: Schema.Date,
  payload: Schema.Uint8Array,
  note: Schema.Option(Schema.String),
}) {}

const Events = Collection.make("events", Event);
const launchEvent = Events.doc(Events.id.make("launch"));

const event = {
  title: "Launch",
  at: DateTime.makeUnsafe("2024-05-06T07:08:09.123Z"),
  day: new Date("2001-02-03T04:05:06.789Z"),
  payload: new Uint8Array([1, 2, 3]),
  note: Option.some("on time"),
};

class Member extends FirestoreModel.Class<Member>("Member")({ name: Schema.String }) {}
const Members = Collection.make("members", Member);
const ada = Members.doc(Members.id.make("ada"));

// The portable types Effect has no schema for, plus timestamps held either way.
class Venue extends FirestoreModel.Class<Venue>("Venue")({
  openedAt: FirestoreSchema.Timestamp,
  where: FirestoreSchema.GeoPoint,
  owner: FirestoreSchema.DocumentReference(Members),
  createdAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
  checkedAt: FirestoreModel.Timestamp(Schema.Date),
}) {}

const Venues = Collection.make("venues", Venue);
const hall = Venues.doc(Venues.id.make("hall"));

const venue = {
  // Firestore keeps a timestamp to the microsecond.
  openedAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_000),
  where: GeoPoint.makeUnsafe(52.52, 13.405),
  owner: ada,
  createdAt: DateTime.makeUnsafe("2024-05-06T07:08:09.123Z"),
  checkedAt: new Date("2001-02-03T04:05:06.789Z"),
};

// Every sentinel, with plain Effect schemas for what each field reads as.
class Tally extends FirestoreModel.Class<Tally>("Tally")({
  title: Schema.String,
  updatedAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
  views: FirestoreModel.Number(Schema.Int),
  nickname: FirestoreModel.Optional(Schema.String),
  tags: FirestoreModel.Array(Schema.String),
  seenAt: FirestoreModel.Array(Schema.DateTimeUtc),
  address: FirestoreModel.Struct({
    city: Schema.String,
    note: FirestoreModel.Optional(Schema.String),
  }),
}) {}

const Tallies = Collection.make("tallies", Tally);
const poll = Tallies.doc(Tallies.id.make("poll"));

const at = (iso: string) => DateTime.makeUnsafe(iso);

const tally = {
  title: "Poll",
  updatedAt: at("2001-01-01T00:00:00.000Z"),
  views: 5,
  nickname: "polly",
  tags: ["a"],
  seenAt: [at("2024-01-01T00:00:00.001Z")],
  address: { city: "Berlin", note: "by the river" },
};

// A counter the tests seed through `seedRaw` with fields no model would write,
// to see what a sentinel makes of them.
class Counter extends FirestoreModel.Class<Counter>("Counter")({
  count: FirestoreModel.Number(Schema.Finite),
  tags: FirestoreModel.Array(Schema.String),
}) {}

const Counters = Collection.make("counters", Counter);
const missing = Counters.doc(Counters.id.make("missing"));
const text = Counters.doc(Counters.id.make("text"));

// The one counter of the transaction tests, under a model of its own.
class Count extends FirestoreModel.Class<Count>("Count")({
  n: Schema.Finite,
}) {}

const Counts = Collection.make("counters", Count);
const counter = Counts.doc(Counts.id.make("counter"));
const other = Counts.doc(Counts.id.make("other"));

/** Stores the one counter at `n`, and hands back `Firestore`. */
const fresh = (n: number) =>
  Effect.gen(function* () {
    const firestore = yield* Firestore;
    yield* firestore.setDoc(counter, { n });
    return firestore;
  });

const valueOf = Effect.fn(function* (ref: Collection.DocumentReference<typeof Counts>) {
  const firestore = yield* Firestore;
  const snapshot = yield* firestore.getDoc(ref);
  return DocumentSnapshot.isExisting(snapshot) ? (yield* snapshot.data).n : undefined;
});

/** Reads the counter and writes it back one higher, as part of a transaction. */
const increment = Effect.gen(function* () {
  const tx = yield* Transaction;
  const snapshot = yield* tx.getDoc(counter);
  const n = DocumentSnapshot.isExisting(snapshot) ? (yield* snapshot.data).n : 0;
  yield* tx.updateDoc(counter, { n: n + 1 });
  return n + 1;
});

/** A transaction body's own error, carrying a code its backend's SDK reads. */
class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  code: Schema.Union([Schema.Finite, Schema.String]),
}) {}

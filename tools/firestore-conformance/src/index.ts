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
import { Effect, Layer, Schema, Stream } from "effect";
import {
  Collection,
  DocumentSnapshot,
  FirestoreModel,
  Patch,
  QuerySnapshot,
} from "@visiolab/effect-firebase/firestore";
import {
  Firestore,
  FirestoreError,
  Transaction,
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
   * listeners land with #248 and its transactions with #249, which drop them
   * from here.
   */
  readonly unsupported?: ReadonlyArray<Capability> | undefined;
}

/**
 * Something a shared test needs that a backend may not offer yet.
 */
export type Capability = "listeners" | "transactions";

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

    needing("listeners")("streams the document and the collection, each read as its member", () =>
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
};

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

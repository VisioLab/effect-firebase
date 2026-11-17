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
import { Clock, DateTime, Effect, Equal, Layer, Option, Schema, Stream } from "effect";
import {
  Collection,
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
 * in-memory one is empty by construction. Besides `Firestore`, it provides
 * whatever `options.seedRaw` needs.
 *
 * @example Running the suite against a backend
 * ```ts
 * import { describe } from "@effect/vitest";
 * import { testFirestore } from "@visiolab/firestore-conformance";
 *
 * describe("MyFirestore, conformance", () => {
 *   testFirestore(layer, { seedRaw });
 * });
 * ```
 */
export const testFirestore = <E, R = never>(
  layer: Layer.Layer<Firestore | R, E>,
  options: Options<R>,
): void => {
  const run = <A, E2>(effect: Effect.Effect<A, E2, Firestore | R>) =>
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

  describe("codec and sentinels", () => {
    it.effect("reads back a plain model equal to what was written", () =>
      run(
        Effect.gen(function* () {
          const firestore = yield* Firestore;

          yield* firestore.setDoc(launch, event);
          const data = yield* read(yield* firestore.getDoc(launch));

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

// A model of plain Effect schemas: nothing in it names how Firestore stores it.
class Event extends FirestoreModel.Class<Event>("Event")({
  title: Schema.String,
  at: Schema.DateTimeUtc,
  day: Schema.Date,
  payload: Schema.Uint8Array,
  note: Schema.Option(Schema.String),
}) {}

const Events = Collection.make("events", Event);
const launch = Events.doc(Events.id.make("launch"));

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

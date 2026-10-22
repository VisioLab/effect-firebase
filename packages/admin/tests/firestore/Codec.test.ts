import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Layer, Option, Schema, Stream } from "effect";
import { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import * as Admin from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-firestore-codec";

const layer = AdminFirestore.layer().pipe(
  Layer.provideMerge(App.layer({ projectId }, "firestore-codec")),
);

// A model of plain Effect schemas: nothing in it names how Firestore stores it.
class Event extends FirestoreModel.Class<Event>("Event")({
  title: Schema.String,
  at: Schema.DateTimeUtc,
  day: Schema.Date,
  payload: Schema.Uint8Array,
  note: Schema.Option(Schema.String),
}) {}

const Events = Collection.make("events", Event);
const launch = Events.id.make("launch");

const event = {
  title: "Launch",
  at: DateTime.makeUnsafe("2024-05-06T07:08:09.123Z"),
  day: new Date("2001-02-03T04:05:06.789Z"),
  payload: new Uint8Array([1, 2, 3]),
  note: Option.some("on time"),
};

// Cleared before each test rather than after, so a failed test leaves its
// documents behind to look at.
const fresh = clear(projectId).pipe(Effect.andThen(AdminFirestore.AdminFirestore));

const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
  DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

describe("A plain model, against the emulator", () => {
  it.effect("reads back equal to what was written", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Events.doc(launch), event);
      const data = yield* read(yield* firestore.getDoc(Events.doc(launch)));

      expect(data.title).toBe("Launch");
      expect(DateTime.toEpochMillis(data.at)).toBe(DateTime.toEpochMillis(event.at));
      expect(data.day.getTime()).toBe(event.day.getTime());
      expect([...data.payload]).toEqual([1, 2, 3]);
      expect(data.note).toEqual(Option.some("on time"));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("is stored as the Admin SDK's own timestamps and bytes", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Events.doc(launch), event);
      const raw = yield* Effect.promise(() => firestore.instance.doc("events/launch").get());

      const at = raw.get("at");
      expect(at).toBeInstanceOf(Admin.Timestamp);
      expect((at as Admin.Timestamp).isEqual(new Admin.Timestamp(1_714_979_289, 123_000_000))).toBe(
        true,
      );
      expect(raw.get("day")).toBeInstanceOf(Admin.Timestamp);
      expect(raw.get("payload")).toBeInstanceOf(Uint8Array);
      expect([...raw.get("payload")]).toEqual([1, 2, 3]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails to read a document holding a value outside Firestore Values", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* Effect.promise(() =>
        firestore.instance
          .doc("events/launch")
          .set({ title: "Launch", embedding: Admin.FieldValue.vector([1, 2]) }),
      );

      const error = yield* Effect.flip(firestore.getDoc(Events.doc(launch)));
      expect(error).toBeInstanceOf(FirestoreError);
      expect(error.message).toContain('"events/launch"');
      expect(error.message).toContain('"embedding"');
      expect(error.message).toContain("VectorValue");

      // Reading the whole collection, or listening, fails the same way.
      const all = yield* Effect.flip(firestore.getDocs(Events.collection()));
      expect(all.message).toContain('"embedding"');
      const streamed = yield* Effect.flip(Stream.runHead(firestore.streamDoc(Events.doc(launch))));
      expect(streamed.message).toContain('"embedding"');
    }).pipe(Effect.provide(layer)),
  );
});

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

describe("FirestoreSchema values, against the emulator", () => {
  it.effect("are stored as the Admin SDK's own timestamp, geopoint and reference", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(hall, venue);
      const raw = yield* Effect.promise(() => firestore.instance.doc("venues/hall").get());

      const openedAt = raw.get("openedAt") as Admin.Timestamp;
      expect(openedAt).toBeInstanceOf(Admin.Timestamp);
      expect(openedAt.isEqual(new Admin.Timestamp(1_700_000_000, 123_456_000))).toBe(true);
      const where = raw.get("where") as Admin.GeoPoint;
      expect(where).toBeInstanceOf(Admin.GeoPoint);
      expect(where.isEqual(new Admin.GeoPoint(52.52, 13.405))).toBe(true);
      const owner = raw.get("owner") as Admin.DocumentReference;
      expect(owner).toBeInstanceOf(Admin.DocumentReference);
      expect(owner.path).toBe("members/ada");
      expect(raw.get("createdAt")).toBeInstanceOf(Admin.Timestamp);
      expect(raw.get("checkedAt")).toBeInstanceOf(Admin.Timestamp);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("read back equal to what was written", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(hall, venue);
      const data = yield* read(yield* firestore.getDoc(hall));

      expect(Equal.equals(data.openedAt, venue.openedAt)).toBe(true);
      expect(Equal.equals(data.where, venue.where)).toBe(true);
      expect(Equal.equals(data.owner, ada)).toBe(true);
      expect(data.owner.collection).toBe(Members);
      expect(DateTime.toEpochMillis(data.createdAt)).toBe(DateTime.toEpochMillis(venue.createdAt));
      expect(data.checkedAt.getTime()).toBe(venue.checkedAt.getTime());
    }).pipe(Effect.provide(layer)),
  );

  it.effect("take a server timestamp on create, read back as the schema holds it", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      const before = Date.now();
      yield* firestore.setDoc(hall, {
        ...venue,
        createdAt: FieldValue.serverTimestamp,
        checkedAt: FieldValue.serverTimestamp,
      });
      const data = yield* read(yield* firestore.getDoc(hall));

      expect(DateTime.isDateTime(data.createdAt)).toBe(true);
      expect(DateTime.toEpochMillis(data.createdAt)).toBeGreaterThan(before - 60_000);
      expect(data.checkedAt).toBeInstanceOf(Date);
      expect(data.checkedAt.getTime()).toBeGreaterThan(before - 60_000);
    }).pipe(Effect.provide(layer)),
  );
});

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

describe("sentinels, against the emulator", () => {
  it.effect("take a server timestamp on update", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      yield* firestore.setDoc(poll, tally);

      const before = Date.now();
      yield* firestore.updateDoc(poll, { updatedAt: FieldValue.serverTimestamp });
      const data = yield* read(yield* firestore.getDoc(poll));

      expect(DateTime.toEpochMillis(data.updatedAt)).toBeGreaterThan(before - 60_000);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("move a number up by an increment and down by a decrement", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      yield* firestore.setDoc(poll, tally);

      yield* firestore.updateDoc(poll, { views: FieldValue.increment(3) });
      yield* firestore.updateDoc(poll, { views: FieldValue.decrement(2) });
      const data = yield* read(yield* firestore.getDoc(poll));

      expect(data.views).toBe(6);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("delete a field, at the top level and inside a struct", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      yield* firestore.setDoc(poll, tally);

      yield* firestore.updateDoc(poll, {
        nickname: FieldValue.deleteField,
        address: { note: FieldValue.deleteField },
      });
      const data = yield* read(yield* firestore.getDoc(poll));

      expect(data.nickname).toBeUndefined();
      expect(data.address).toEqual({ city: "Berlin" });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("grow an array by a union and shrink it by a removal", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      yield* firestore.setDoc(poll, tally);

      yield* firestore.updateDoc(poll, { tags: FieldValue.arrayUnion("b", "a") });
      expect((yield* read(yield* firestore.getDoc(poll))).tags).toEqual(["a", "b"]);
      yield* firestore.updateDoc(poll, { tags: FieldValue.arrayRemove("a") });
      expect((yield* read(yield* firestore.getDoc(poll))).tags).toEqual(["b"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("grow and shrink an array of timestamps, stored as the Admin SDK's own", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      yield* firestore.setDoc(poll, tally);

      const later = at("2024-06-01T12:00:00.002Z");
      yield* firestore.updateDoc(poll, { seenAt: FieldValue.arrayUnion(later) });
      const raw = yield* Effect.promise(() => firestore.instance.doc("tallies/poll").get());
      const stored = raw.get("seenAt") as ReadonlyArray<unknown>;
      expect(stored).toHaveLength(2);
      for (const element of stored) expect(element).toBeInstanceOf(Admin.Timestamp);

      // A removal matches what a union wrote, since both encode the same way.
      yield* firestore.updateDoc(poll, {
        seenAt: FieldValue.arrayRemove(at("2024-01-01T00:00:00.001Z")),
      });
      const data = yield* read(yield* firestore.getDoc(poll));
      expect(data.seenAt.map(DateTime.toEpochMillis)).toEqual([DateTime.toEpochMillis(later)]);
    }).pipe(Effect.provide(layer)),
  );
});

import { assert, describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Fiber, Layer, Option, Schema, Stream } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import {
  Collection,
  DocumentSnapshot,
  FieldValue,
  FirestoreModel,
  FirestoreSchema,
  GeoPoint,
  QuerySnapshot,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import * as Client from "firebase/app";
import {
  Bytes,
  connectFirestoreEmulator,
  disableNetwork,
  DocumentReference,
  enableNetwork,
  Firestore as SdkFirestore,
  GeoPoint as SdkGeoPoint,
  getDoc,
  doc,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  setDoc,
  Timestamp as SdkTimestamp,
  vector,
} from "firebase/firestore";
import * as App from "../../src/App.ts";
import * as ClientDocumentSnapshot from "../../src/firestore/ClientDocumentSnapshot.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import * as ClientQuerySnapshot from "../../src/firestore/ClientQuerySnapshot.ts";
import { clear, emulator, fresh, holding, offline } from "./emulator.ts";

const projectId = "demo-client-firestore";

// A named app keeps each run independent of whatever the default app is, and of
// the apps the other suites register.
const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provideMerge(App.layer({ projectId }, "firestore")),
);

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);

class Place extends FirestoreModel.Class<Place>("Place")({
  name: Schema.String,
  billing: FirestoreModel.Optional(FirestoreModel.Struct({ zip: Schema.Finite })),
}) {}

const Places = Collection.make("places", Place);

class Note extends FirestoreModel.Class<Note>("Note")({
  body: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

const Notes = Collection.make("notes", Note);
const hello = Posts.id.make("hello");

describe("ClientFirestore", () => {
  it.effect("builds on top of the app in context", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;
      expect(typeof firestore.getDoc).toBe("function");
      expect(typeof firestore.getDocs).toBe("function");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("provides one Client Firestore under its own tag and the portable one", () =>
    Effect.gen(function* () {
      const client = yield* ClientFirestore.ClientFirestore;
      const portable = yield* Firestore;

      expect(client).toBe(portable);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("layerWithEncoder provides both tags and the encoder", () =>
    Effect.gen(function* () {
      const client = yield* ClientFirestore.ClientFirestore;
      const portable = yield* Firestore;
      const encoder = yield* FirestoreEncoder;

      expect(client).toBe(portable);
      expect(typeof encoder.documentReference).toBe("function");
    }).pipe(
      Effect.provide(
        ClientFirestore.layerWithEncoder({ emulator }).pipe(
          Layer.provideMerge(App.layer({ projectId }, "firestore-encoder")),
        ),
      ),
    ),
  );

  it.effect("exposes the client SDK's own Firestore object as instance", () =>
    Effect.gen(function* () {
      const client = yield* ClientFirestore.ClientFirestore;

      expect(client.instance).toBeInstanceOf(SdkFirestore);
      expect(client.instance).toBe(getFirestore(yield* App.App));
    }).pipe(Effect.provide(layer)),
  );

  it("is a Firestore that also holds the SDK's own object", () => {
    expectTypeOf<ClientFirestore.ClientFirestore>().toExtend<Firestore>();
    expectTypeOf<ClientFirestore.ClientFirestore["instance"]>().toEqualTypeOf<SdkFirestore>();
    expectTypeOf<Firestore>().not.toHaveProperty("instance");
    expectTypeOf(ClientFirestore.layer()).toEqualTypeOf<
      Layer.Layer<ClientFirestore.ClientFirestore | Firestore, never, App.App>
    >();
    expectTypeOf(ClientFirestore.layerWithEncoder()).toEqualTypeOf<
      Layer.Layer<ClientFirestore.ClientFirestore | Firestore | FirestoreEncoder, never, App.App>
    >();
  });

  // The SDK memoizes a database on the app and refuses to reopen one under
  // settings that disagree, which is what makes it observable from here whether
  // the options reached it at all.
  const opened = (name: string, options: ClientFirestore.Options) =>
    Effect.fn(function* (app: App.App) {
      return yield* Effect.provide(
        Firestore,
        ClientFirestore.layer(options).pipe(Layer.provide(Layer.succeed(App.App, app))),
      ).pipe(Effect.catchDefect(Effect.succeed), Effect.withSpan(name));
    });

  it.effect("hands the settings over to the database it opens", () =>
    Effect.gen(function* () {
      const app = Client.initializeApp({ projectId: "demo-fs-settings" }, "fs-settings");
      initializeFirestore(app, { localCache: memoryLocalCache() });

      const reopened = yield* opened("settings", { localCache: persistentLocalCache() })(app);

      expect(String(reopened)).toContain("already been called");
      yield* Effect.promise(() => Client.deleteApp(app));
    }),
  );

  it.effect("opens the database the options name, and leaves the others alone", () =>
    Effect.gen(function* () {
      const app = Client.initializeApp({ projectId: "demo-fs-database" }, "fs-database");
      initializeFirestore(app, { localCache: memoryLocalCache() }, "other");

      // The default database was never opened, so settings of its own are fine.
      const byDefault = yield* opened("default", { localCache: persistentLocalCache() })(app);
      expect(byDefault).not.toBeInstanceOf(Error);

      // The named one was, under settings that disagree with these.
      const named = yield* opened("named", {
        localCache: persistentLocalCache(),
        databaseId: "other",
      })(app);
      expect(String(named)).toContain("already been called");

      yield* Effect.promise(() => Client.deleteApp(app));
    }),
  );

  it.effect("dies rather than failing when the emulator comes after the database was used", () =>
    Effect.gen(function* () {
      const app = Client.initializeApp({ projectId: "demo-fs-started" }, "fs-started");
      const started = getFirestore(app);
      connectFirestoreEmulator(started, emulator.host, emulator.port);
      yield* Effect.promise(() => getDoc(doc(started, "posts/hello")));

      const defect = yield* opened("started", {
        emulator: { host: emulator.host, port: emulator.port + 1 },
      })(app);

      expect(String(defect)).toContain("already been started");
      yield* Effect.promise(() => Client.deleteApp(app));
    }),
  );

  it.effect("asks the caller for nothing the SDK answers for itself", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;

      // `NaN` is not a number Firestore stores, so this never reaches the
      // database: encoding happens first and is where it stops.
      const write = firestore.setDoc(Posts.doc(hello), { title: "Hello", views: Number.NaN });
      expectTypeOf(write).toEqualTypeOf<Effect.Effect<void, FirestoreError | Schema.SchemaError>>();

      const error = yield* Effect.flip(write);
      expect(error._tag).toBe("SchemaError");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("encodes a patch through the schema its mode names", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;
      const ref = Places.doc(Places.id.make("a"));
      const patch = { billing: { zip: Number.NaN } };

      const checked = yield* Effect.flip(firestore.updateDoc(ref, patch as never));
      expect(checked._tag).toBe("SchemaError");
      expect(checked.message).not.toContain("Expected a finite number");

      const unchecked = yield* Effect.flip(firestore.updateDoc(ref, patch, { mode: "unchecked" }));
      expect(unchecked._tag).toBe("SchemaError");
      expect(unchecked.message).toContain("Expected a finite number");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("dies rather than failing when the app was already deleted", () =>
    Effect.gen(function* () {
      const deleted = Client.initializeApp({ projectId: "demo-deleted-firestore" }, "deleted-fs");
      yield* Effect.promise(() => Client.deleteApp(deleted));

      const defect = yield* Effect.provide(
        Firestore,
        ClientFirestore.layer().pipe(Layer.provide(Layer.succeed(App.App, deleted))),
      ).pipe(Effect.catchDefect(Effect.succeed));

      expect(String(defect)).toContain("deleted-fs");
    }),
  );

  it.effect(
    "layerWithEncoder provides the encoder it writes through, pointing into the same database",
    () =>
      Effect.gen(function* () {
        const app = Client.initializeApp({ projectId: "demo-fs-encoder" }, "fs-encoder");

        const encoder = yield* Effect.provide(
          FirestoreEncoder,
          ClientFirestore.layerWithEncoder({ databaseId: "other" }).pipe(
            Layer.provide(Layer.succeed(App.App, app)),
          ),
        );

        // A reference is the one value built against a database, so it is what
        // tells which database the encoder was built from.
        const ref = encoder.documentReference(Posts.doc(hello));
        expect(ref).toBeInstanceOf(DocumentReference);
        expect((ref as DocumentReference).firestore).toBe(getFirestore(app, "other"));

        yield* Effect.promise(() => Client.deleteApp(app));
      }),
  );
});

describe("ClientFirestore, against the emulator", () => {
  // Cleared before each test rather than after, so a failed test leaves its
  // documents behind to look at.
  const freshFirestore = clear(projectId).pipe(Effect.andThen(Firestore));

  const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
    DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

  it.effect("reads back what it wrote", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      const snapshot = yield* firestore.getDoc(Posts.doc(hello));

      expect(snapshot._tag).toBe("Existing");
      expect(yield* read(snapshot)).toMatchObject({ title: "Hello", views: 1 });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("hands back a missing snapshot for a document that is not there", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      const snapshot = yield* firestore.getDoc(Posts.doc(hello));

      expect(snapshot._tag).toBe("Missing");
      expect(snapshot.id).toBe(hello);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("adds a document under an id Firestore picks, and reads it among the others", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      const added = yield* firestore.addDoc(Posts.collection(), { title: "Added", views: 2 });
      const snapshot = yield* firestore.getDocs(Posts.collection());

      expect(added.id).not.toBe(hello);
      assert(QuerySnapshot.isQuerySnapshot(snapshot));
      expect(snapshot.docs.map((doc) => doc.id).toSorted()).toEqual([hello, added.id].toSorted());
    }).pipe(Effect.provide(layer)),
  );

  it.effect("updates the fields it is given, and leaves the others alone", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      yield* firestore.updateDoc(Posts.doc(hello), { views: 2 });

      expect(yield* read(yield* firestore.getDoc(Posts.doc(hello)))).toMatchObject({
        title: "Hello",
        views: 2,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses to update a document that is not there, with the SDK's code", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      const error = yield* Effect.flip(firestore.updateDoc(Posts.doc(hello), { views: 2 }));

      expect(error).toMatchObject({ _tag: "FirestoreError", code: "not-found" });
    }).pipe(Effect.provide(layer)),
  );

  // Live, because the write waits on the SDK's own connection rather than on
  // the test clock.
  // The network is toggled through `instance`, the SDK's own object, since this
  // library does not wrap that.
  it.live("waits offline for the server, and reads a pending server timestamp as an estimate", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const sdk = (yield* ClientFirestore.ClientFirestore).instance;
      const note = Notes.doc(Notes.id.make("note"));

      yield* Effect.promise(() => disableNetwork(sdk));
      const write = yield* Effect.forkChild(
        firestore.setDoc(note, { body: "offline", createdAt: FieldValue.serverTimestamp }),
      );
      // Lets the write reach the SDK, which queues it ahead of the read.
      yield* Effect.yieldNow;

      // Offline, the read falls back to the local cache, where the write is
      // already applied but its timestamp not yet settled.
      const pending = yield* read(yield* firestore.getDoc(note));
      expect(Timestamp.isTimestamp(pending.createdAt)).toBe(true);
      expect(write.pollUnsafe()).toBeUndefined();

      yield* Effect.promise(() => enableNetwork(sdk));
      yield* Fiber.join(write);

      const settled = yield* read(yield* firestore.getDoc(note));
      expect(settled.body).toBe("offline");
    }).pipe(Effect.provide(layer)),
  );
});

class Event extends FirestoreModel.Class<Event>("Event")({
  at: Schema.DateTimeUtc,
  on: Schema.Date,
  payload: Schema.Uint8Array,
  note: Schema.Option(Schema.String),
}) {}

const Events = Collection.make("events", Event);

describe("ClientFirestore, Firestore Values", () => {
  const freshFirestore = clear(projectId).pipe(Effect.andThen(Firestore));

  const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
    DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

  const event = new Event({
    at: DateTime.makeUnsafe("2026-10-22T12:34:56.789Z"),
    on: new Date("2001-02-03T04:05:06.007Z"),
    payload: new Uint8Array([1, 2, 3]),
    note: Option.some("hello"),
  });

  it.effect("reads back a plain model it wrote", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const ref = Events.doc(Events.id.make("e"));

      yield* firestore.setDoc(ref, event);

      expect(yield* read(yield* firestore.getDoc(ref))).toEqual(event);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("stores times and bytes as the SDK's own types", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const { instance } = yield* ClientFirestore.ClientFirestore;

      yield* firestore.setDoc(Events.doc(Events.id.make("e")), event);
      const raw = (yield* Effect.promise(() => getDoc(doc(instance, "events/e")))).data();

      assert(raw !== undefined);
      expect(raw["at"]).toBeInstanceOf(SdkTimestamp);
      expect((raw["at"] as SdkTimestamp).toMillis()).toBe(Date.parse("2026-10-22T12:34:56.789Z"));
      expect(raw["on"]).toBeInstanceOf(SdkTimestamp);
      expect(raw["payload"]).toBeInstanceOf(Bytes);
      expect((raw["payload"] as Bytes).toUint8Array()).toEqual(new Uint8Array([1, 2, 3]));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails to read a document holding a value outside the Firestore Value union", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const { instance } = yield* ClientFirestore.ClientFirestore;
      yield* Effect.promise(() =>
        setDoc(doc(instance, "posts/hello"), { title: "Hello", embedding: [vector([1, 2])] }),
      );

      const error = yield* Effect.flip(firestore.getDoc(Posts.doc(hello)));
      expect(error).toMatchObject({ _tag: "FirestoreError" });
      expect(error.message).toContain("posts/hello");
      expect(error.message).toContain('"embedding[0]"');
      expect(error.message).toContain("VectorValue");

      const listed = yield* Effect.flip(firestore.getDocs(Posts.collection()));
      expect(listed.message).toContain("VectorValue");
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

describe("ClientFirestore, FirestoreSchema values", () => {
  const freshFirestore = clear(projectId).pipe(Effect.andThen(Firestore));
  const hall = Venues.doc(Venues.id.make("hall"));

  const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
    DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

  const venue = {
    // Firestore keeps a timestamp to the microsecond.
    openedAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_000),
    where: GeoPoint.makeUnsafe(52.52, 13.405),
    owner: ada,
    createdAt: DateTime.makeUnsafe("2024-05-06T07:08:09.123Z"),
    checkedAt: new Date("2001-02-03T04:05:06.789Z"),
  };

  it.effect("are stored as the client SDK's own timestamp, geopoint and reference", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const { instance } = yield* ClientFirestore.ClientFirestore;

      yield* firestore.setDoc(hall, venue);
      const raw = (yield* Effect.promise(() => getDoc(doc(instance, "venues/hall")))).data();

      assert(raw !== undefined);
      expect(raw["openedAt"]).toBeInstanceOf(SdkTimestamp);
      expect(
        (raw["openedAt"] as SdkTimestamp).isEqual(new SdkTimestamp(1_700_000_000, 123_456_000)),
      ).toBe(true);
      expect(raw["where"]).toBeInstanceOf(SdkGeoPoint);
      expect((raw["where"] as SdkGeoPoint).isEqual(new SdkGeoPoint(52.52, 13.405))).toBe(true);
      expect(raw["owner"]).toBeInstanceOf(DocumentReference);
      expect((raw["owner"] as DocumentReference).path).toBe("members/ada");
      expect(raw["createdAt"]).toBeInstanceOf(SdkTimestamp);
      expect(raw["checkedAt"]).toBeInstanceOf(SdkTimestamp);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("read back equal to what was written", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

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
      const firestore = yield* fresh(projectId);

      const before = Date.now();
      yield* firestore.setDoc(hall, {
        ...venue,
        createdAt: FieldValue.serverTimestamp,
        checkedAt: FieldValue.serverTimestamp,
      });
      const data = yield* read(yield* firestore.getDoc(hall, { source: "server" }));

      expect(DateTime.isDateTime(data.createdAt)).toBe(true);
      expect(DateTime.toEpochMillis(data.createdAt)).toBeGreaterThan(before - 60_000);
      expect(data.checkedAt).toBeInstanceOf(Date);
      expect(data.checkedAt.getTime()).toBeGreaterThan(before - 60_000);
    }).pipe(Effect.provide(layer)),
  );
});

describe("ClientFirestore, Snapshot Metadata", () => {
  it("hands back client snapshots that are portable ones as well", () => {
    type Metadata = { readonly fromCache: boolean; readonly hasPendingWrites: boolean };
    expectTypeOf<ClientDocumentSnapshot.SnapshotMetadata>().toEqualTypeOf<Metadata>();
    expectTypeOf<ClientDocumentSnapshot.Existing<typeof Posts>>().toExtend<
      DocumentSnapshot.Existing<typeof Posts>
    >();
    expectTypeOf<ClientDocumentSnapshot.Missing<typeof Posts>>().toExtend<
      DocumentSnapshot.Missing<typeof Posts>
    >();
    expectTypeOf<ClientDocumentSnapshot.ClientDocumentSnapshot<typeof Posts>>().toExtend<
      DocumentSnapshot.DocumentSnapshot<typeof Posts>
    >();
    expectTypeOf<ClientQuerySnapshot.ClientQuerySnapshot<typeof Posts>>().toExtend<
      QuerySnapshot.QuerySnapshot<typeof Posts>
    >();

    type Service = ClientFirestore.ClientFirestore;
    expectTypeOf<Service>().toExtend<Firestore>();
    expectTypeOf<ReturnType<Service["getDoc"]>>().toEqualTypeOf<
      Effect.Effect<ClientDocumentSnapshot.ClientDocumentSnapshot<Collection.Any>, FirestoreError>
    >();
    expectTypeOf<ReturnType<Service["getDocs"]>>().toEqualTypeOf<
      Effect.Effect<ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>, FirestoreError>
    >();
    expectTypeOf<ReturnType<Service["streamDoc"]>>().toEqualTypeOf<
      Stream.Stream<ClientDocumentSnapshot.ClientDocumentSnapshot<Collection.Any>, FirestoreError>
    >();
    expectTypeOf<ReturnType<Service["streamDocs"]>>().toEqualTypeOf<
      Stream.Stream<ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>, FirestoreError>
    >();
    // The portable service is left as it was.
    expectTypeOf<ReturnType<Firestore["getDoc"]>>().toEqualTypeOf<
      Effect.Effect<DocumentSnapshot.DocumentSnapshot<Collection.Any>, FirestoreError>
    >();
  });

  it.effect("reads a document the server acknowledged as from the server, nothing pending", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      const snapshot = yield* firestore.getDoc(Posts.doc(hello));

      expect(snapshot.metadata).toEqual({ fromCache: false, hasPendingWrites: false });
    }).pipe(Effect.provide(layer)),
  );

  // Live, because the write waits on the SDK's own connection rather than on
  // the test clock. The network is toggled through `instance`.
  it.live("reads a write the server has not acknowledged as pending, from the cache", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);

      yield* Effect.promise(() => disableNetwork(firestore.instance));
      const write = yield* Effect.forkChild(
        firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 }),
      );
      yield* Effect.yieldNow;

      const pending = yield* firestore.getDoc(Posts.doc(hello));
      expect(pending._tag).toBe("Existing");
      expect(pending.metadata).toEqual({ fromCache: true, hasPendingWrites: true });

      yield* Effect.promise(() => enableNetwork(firestore.instance));
      yield* Fiber.join(write);

      const settled = yield* firestore.getDoc(Posts.doc(hello));
      expect(settled.metadata).toEqual({ fromCache: false, hasPendingWrites: false });
    }).pipe(Effect.provide(layer)),
  );

  // A default read never hands back a missing document from the cache: offline,
  // the SDK fails it as unavailable rather than say it is gone.
  it.effect("reads a missing document with the metadata of the read", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);

      const snapshot = yield* firestore.getDoc(Posts.doc(hello));

      expect(snapshot._tag).toBe("Missing");
      expect(snapshot.metadata).toEqual({ fromCache: false, hasPendingWrites: false });
    }).pipe(Effect.provide(layer)),
  );

  it.live("reads a document while offline from the cache", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      yield* holding(firestore.streamDoc(Posts.doc(hello)));
      const snapshot = yield* offline(firestore.getDoc(Posts.doc(hello)));

      expect(snapshot._tag).toBe("Existing");
      expect(snapshot.metadata).toEqual({ fromCache: true, hasPendingWrites: false });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live("reads a collection while offline from the cache, even where it finds nothing", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      const online = yield* firestore.getDocs(Posts.collection());
      expect(online.metadata).toEqual({ fromCache: false, hasPendingWrites: false });
      expect(online.docs.map((doc) => doc.metadata)).toEqual([
        { fromCache: false, hasPendingWrites: false },
      ]);

      yield* holding(firestore.streamDocs(Posts.collection()));
      const [cached, empty] = yield* offline(
        Effect.all([firestore.getDocs(Posts.collection()), firestore.getDocs(Places.collection())]),
      );

      expect(cached.metadata).toEqual({ fromCache: true, hasPendingWrites: false });
      expect(cached.docs.map((doc) => [doc.id, doc.metadata])).toEqual([
        [hello, { fromCache: true, hasPendingWrites: false }],
      ]);
      expect(empty.docs).toEqual([]);
      expect(empty.metadata).toEqual({ fromCache: true, hasPendingWrites: false });
    }).pipe(Effect.scoped, Effect.provide(layer)),
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

describe("ClientFirestore, sentinels", () => {
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

  const read = Effect.gen(function* () {
    const firestore = yield* ClientFirestore.ClientFirestore;
    const snapshot = yield* firestore.getDoc(poll, { source: "server" });
    return DocumentSnapshot.isExisting(snapshot)
      ? yield* snapshot.data
      : yield* Effect.die("missing");
  });

  const seeded = fresh(projectId).pipe(Effect.tap((firestore) => firestore.setDoc(poll, tally)));

  it.effect("take a server timestamp on update", () =>
    Effect.gen(function* () {
      const firestore = yield* seeded;

      const before = Date.now();
      yield* firestore.updateDoc(poll, { updatedAt: FieldValue.serverTimestamp });

      expect(DateTime.toEpochMillis((yield* read).updatedAt)).toBeGreaterThan(before - 60_000);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("move a number up by an increment and down by a decrement", () =>
    Effect.gen(function* () {
      const firestore = yield* seeded;

      yield* firestore.updateDoc(poll, { views: FieldValue.increment(3) });
      yield* firestore.updateDoc(poll, { views: FieldValue.decrement(2) });

      expect((yield* read).views).toBe(6);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("delete a field, at the top level and inside a struct", () =>
    Effect.gen(function* () {
      const firestore = yield* seeded;

      yield* firestore.updateDoc(poll, {
        nickname: FieldValue.deleteField,
        address: { note: FieldValue.deleteField },
      });
      const data = yield* read;

      expect(data.nickname).toBeUndefined();
      expect(data.address).toEqual({ city: "Berlin" });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("grow an array by a union and shrink it by a removal", () =>
    Effect.gen(function* () {
      const firestore = yield* seeded;

      yield* firestore.updateDoc(poll, { tags: FieldValue.arrayUnion("b", "a") });
      expect((yield* read).tags).toEqual(["a", "b"]);
      yield* firestore.updateDoc(poll, { tags: FieldValue.arrayRemove("a") });
      expect((yield* read).tags).toEqual(["b"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("grow and shrink an array of timestamps, stored as the client SDK's own", () =>
    Effect.gen(function* () {
      const firestore = yield* seeded;

      const later = at("2024-06-01T12:00:00.002Z");
      yield* firestore.updateDoc(poll, { seenAt: FieldValue.arrayUnion(later) });
      const raw = (yield* Effect.promise(() =>
        getDoc(doc(firestore.instance, "tallies/poll")),
      )).data();
      assert(raw !== undefined);
      const stored = raw["seenAt"] as ReadonlyArray<unknown>;
      expect(stored).toHaveLength(2);
      for (const element of stored) expect(element).toBeInstanceOf(SdkTimestamp);

      // A removal matches what a union wrote, since both encode the same way.
      yield* firestore.updateDoc(poll, {
        seenAt: FieldValue.arrayRemove(at("2024-01-01T00:00:00.001Z")),
      });
      expect((yield* read).seenAt.map(DateTime.toEpochMillis)).toEqual([
        DateTime.toEpochMillis(later),
      ]);
    }).pipe(Effect.provide(layer)),
  );
});

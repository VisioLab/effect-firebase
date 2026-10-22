import { assert, describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Schema } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import {
  Collection,
  DocumentSnapshot,
  FieldValue,
  FirestoreModel,
  FirestoreSchema,
  QuerySnapshot,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import * as Client from "firebase/app";
import {
  connectFirestoreEmulator,
  disableNetwork,
  DocumentReference,
  enableNetwork,
  getDoc,
  doc,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
} from "firebase/firestore";
import * as App from "../../src/App.ts";
import * as ClientFirestore from "../../src/firestore/Firestore.ts";
import { clear, emulator } from "./emulator.ts";

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

describe("Firestore", () => {
  it.effect("builds on top of the app in context", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;
      expect(typeof firestore.getDoc).toBe("function");
      expect(typeof firestore.getDocs).toBe("function");
    }).pipe(Effect.provide(layer)),
  );

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

describe("Firestore, against the emulator", () => {
  // Cleared before each test rather than after, so a failed test leaves its
  // documents behind to look at.
  const fresh = clear(projectId).pipe(Effect.andThen(Firestore));

  const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
    DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

  it.effect("reads back what it wrote", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      const snapshot = yield* firestore.getDoc(Posts.doc(hello));

      expect(snapshot._tag).toBe("Existing");
      expect(yield* read(snapshot)).toMatchObject({ title: "Hello", views: 1 });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("hands back a missing snapshot for a document that is not there", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      const snapshot = yield* firestore.getDoc(Posts.doc(hello));

      expect(snapshot._tag).toBe("Missing");
      expect(snapshot.id).toBe(hello);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("adds a document under an id Firestore picks, and reads it among the others", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

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
      const firestore = yield* fresh;

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
      const firestore = yield* fresh;

      const error = yield* Effect.flip(firestore.updateDoc(Posts.doc(hello), { views: 2 }));

      expect(error).toMatchObject({ _tag: "FirestoreError", code: "not-found" });
    }).pipe(Effect.provide(layer)),
  );

  // Live, because the write waits on the SDK's own connection rather than on
  // the test clock.
  it.live("waits offline for the server, and reads a pending server timestamp as an estimate", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      const sdk = getFirestore(yield* App.App);
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

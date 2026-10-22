import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as Admin from "firebase-admin/app";
import { DocumentReference, initializeFirestore } from "firebase-admin/firestore";
import type * as AdminSdk from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

// A named app keeps each run independent of whatever the default app is, and of
// the apps the other suites register.
const layer = AdminFirestore.layer().pipe(
  Layer.provide(App.layer({ projectId: "demo-firestore" }, "firestore")),
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
  const opened = (name: string, options: AdminFirestore.Options) =>
    Effect.fn(function* (app: App.App) {
      return yield* Effect.provide(
        Firestore,
        AdminFirestore.layer(options).pipe(Layer.provide(Layer.succeed(App.App, app))),
      ).pipe(Effect.catchDefect(Effect.succeed), Effect.withSpan(name));
    });

  it.effect("hands the settings over to the database it opens", () =>
    Effect.gen(function* () {
      const app = Admin.initializeApp({ projectId: "demo-fs-settings" }, "fs-settings");
      initializeFirestore(app, { preferRest: true });

      const reopened = yield* opened("settings", { preferRest: false })(app);

      expect(String(reopened)).toContain("already been called");
      yield* Effect.promise(() => Admin.deleteApp(app));
    }),
  );

  it.effect("opens the database the options name, and leaves the others alone", () =>
    Effect.gen(function* () {
      const app = Admin.initializeApp({ projectId: "demo-fs-database" }, "fs-database");
      initializeFirestore(app, { preferRest: true }, "other");

      // The default database was never opened, so settings of its own are fine.
      const byDefault = yield* opened("default", { preferRest: false })(app);
      expect(byDefault).not.toBeInstanceOf(Error);

      // The named one was, under settings that disagree with these.
      const named = yield* opened("named", { preferRest: false, databaseId: "other" })(app);
      expect(String(named)).toContain("already been called");

      yield* Effect.promise(() => Admin.deleteApp(app));
    }),
  );

  it.effect("asks the caller for nothing the SDK answers for itself", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;

      // `NaN` is not a number Firestore stores, so this never reaches the
      // database: encoding happens first and is where it stops. The type says
      // as much - the encoder a document is written through is composed into
      // the layer, so nothing is left for the caller to provide.
      const write = firestore.setDoc(Posts.doc(hello), { title: "Hello", views: Number.NaN });
      expectTypeOf(write).toEqualTypeOf<Effect.Effect<void, FirestoreError | Schema.SchemaError>>();

      const error = yield* Effect.flip(write);
      expect(error._tag).toBe("SchemaError");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("stops a document that does not encode before adding it", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;

      const error = yield* Effect.flip(
        firestore.addDoc(Posts.collection(), { title: "Hello", views: Number.NaN }),
      );
      expect(error._tag).toBe("SchemaError");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("stops a patch that does not encode before updating", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;

      const update = firestore.updateDoc(Posts.doc(hello), { views: Number.NaN });
      expectTypeOf(update).toEqualTypeOf<
        Effect.Effect<void, FirestoreError | Schema.SchemaError>
      >();

      const error = yield* Effect.flip(update);
      expect(error._tag).toBe("SchemaError");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("encodes a patch through the schema its mode names", () =>
    Effect.gen(function* () {
      const firestore = yield* Firestore;
      const ref = Places.doc(Places.id.make("a"));

      // Neither of these reaches the database, so the test needs neither the
      // emulator nor credentials. What tells the modes apart is why encoding
      // stops: checked refuses a patch into an optional struct at all, while
      // unchecked takes it and only stops at the `NaN` it carries.
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
      const deleted = Admin.initializeApp({ projectId: "demo-deleted-firestore" }, "deleted-fs");
      yield* Effect.promise(() => Admin.deleteApp(deleted));

      // Reaching for Firestore on a dead app is a wiring mistake, so it stays
      // out of the error channel that `FirestoreError` reserves for failed
      // calls.
      const defect = yield* Effect.provide(
        Firestore,
        AdminFirestore.layer().pipe(Layer.provide(Layer.succeed(App.App, deleted))),
      ).pipe(Effect.catchDefect(Effect.succeed));

      expect(String(defect)).toContain("deleted-fs");
    }),
  );

  it.effect(
    "layerWithEncoder provides the encoder it writes through, pointing into the same database",
    () =>
      Effect.gen(function* () {
        const app = Admin.initializeApp({ projectId: "demo-fs-encoder" }, "fs-encoder");

        const encoder = yield* Effect.provide(
          FirestoreEncoder,
          AdminFirestore.layerWithEncoder({ databaseId: "other" }).pipe(
            Layer.provide(Layer.succeed(App.App, app)),
          ),
        );

        // A reference is the one value built against a database, so it is what
        // tells which database the encoder was built from.
        const ref = encoder.documentReference(Posts.doc(hello));
        expect(ref).toBeInstanceOf(DocumentReference);
        expect((ref as DocumentReference).firestore.databaseId).toBe("other");

        yield* Effect.promise(() => Admin.deleteApp(app));
      }),
  );
});

describe("Firestore, against the emulator", () => {
  // Cleared before each test rather than after, so a failed test leaves its
  // documents behind to look at.
  const fresh = clear("demo-firestore").pipe(Effect.andThen(Firestore));

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
      const snapshots = yield* firestore.getDocs(Posts.collection());

      expect(added.id).not.toBe(hello);
      expect(snapshots.map((snapshot) => snapshot.id).toSorted()).toEqual(
        [hello, added.id].toSorted(),
      );
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

  it.effect("refuses to update a document that is not there", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      const error = yield* Effect.flip(firestore.updateDoc(Posts.doc(hello), { views: 2 }));

      expect(error).toBeInstanceOf(FirestoreError);
    }).pipe(Effect.provide(layer)),
  );
});

describe("AdminFirestore, against the emulator", () => {
  const projectId = "demo-admin-firestore";
  const adminLayer = AdminFirestore.layer().pipe(
    Layer.provide(App.layer({ projectId }, "admin-firestore")),
  );

  it.effect("is provided as Firestore too, as one and the same object", () =>
    Effect.gen(function* () {
      yield* clear(projectId);
      const admin = yield* AdminFirestore.AdminFirestore;
      const firestore = yield* Firestore;

      expect(admin).toBe(firestore);

      // Portable code and admin code talk to the same database.
      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      expect((yield* admin.getDoc(Posts.doc(hello)))._tag).toBe("Existing");
    }).pipe(Effect.provide(adminLayer)),
  );

  it.effect("layerWithEncoder provides the encoder alongside both, as the same service", () =>
    Effect.gen(function* () {
      const admin = yield* AdminFirestore.AdminFirestore;
      const firestore = yield* Firestore;
      const encoder = yield* FirestoreEncoder;

      expect(admin).toBe(firestore);
      // The encoder writes references into the database the service reads.
      const ref = encoder.documentReference(Posts.doc(hello));
      expect((ref as DocumentReference).firestore).toBe(admin.instance);
    }).pipe(
      Effect.provide(
        AdminFirestore.layerWithEncoder().pipe(
          Layer.provide(App.layer({ projectId }, "admin-firestore-encoder")),
        ),
      ),
    ),
  );

  it.effect("hands out the Admin SDK's own Firestore, for what the service does not wrap", () =>
    Effect.gen(function* () {
      yield* clear(projectId);
      const admin = yield* AdminFirestore.AdminFirestore;

      yield* Effect.promise(() =>
        admin.instance.doc(`posts/${hello}`).set({ title: "Raw", views: 3 }),
      );
      const snapshot = yield* admin.getDoc(Posts.doc(hello));

      expect(DocumentSnapshot.isExisting(snapshot) && snapshot.raw).toEqual({
        title: "Raw",
        views: 3,
      });
    }).pipe(Effect.provide(adminLayer)),
  );

  it.effect("hands out the database the options name", () =>
    Effect.gen(function* () {
      const admin = yield* AdminFirestore.AdminFirestore;

      expect(admin.instance.databaseId).toBe("other");
    }).pipe(
      Effect.provide(
        AdminFirestore.layer({ databaseId: "other" }).pipe(
          Layer.provide(App.layer({ projectId }, "admin-firestore-other")),
        ),
      ),
    ),
  );

  it("is a Firestore, and the only one of the two with the SDK's instance", () => {
    expectTypeOf<AdminFirestore.AdminFirestore>().toExtend<Firestore>();
    expectTypeOf<AdminFirestore.AdminFirestore["instance"]>().toEqualTypeOf<AdminSdk.Firestore>();
    expectTypeOf<Firestore>().not.toHaveProperty("instance");
  });
});

describe("AdminFirestore layers", () => {
  it("provide AdminFirestore and Firestore, and the encoder with layerWithEncoder", () => {
    expectTypeOf(AdminFirestore.layer()).toEqualTypeOf<
      Layer.Layer<AdminFirestore.AdminFirestore | Firestore, never, App.App>
    >();
    expectTypeOf(AdminFirestore.layerWithEncoder()).toEqualTypeOf<
      Layer.Layer<AdminFirestore.AdminFirestore | Firestore | FirestoreEncoder, never, App.App>
    >();
  });
});

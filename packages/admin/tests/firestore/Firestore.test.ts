import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as Admin from "firebase-admin/app";
import { DocumentReference, initializeFirestore } from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/Firestore.ts";

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

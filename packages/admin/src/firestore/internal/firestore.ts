import { Effect, Schema } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import type { Create, WriteServices } from "@visiolab/effect-firebase/firestore/Firestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import { FirebaseError } from "firebase-admin/app";
import * as Admin from "firebase-admin/firestore";
import * as App from "../../App.ts";
import type * as AdminFirestore from "../Firestore.ts";
import * as Encoder from "../FirestoreEncoder.ts";

/**
 * Opens the database the options name.
 *
 * Settings can only be handed over through `initializeFirestore`, which refuses
 * a database already opened with different ones, so they are only passed along
 * when there are some: asking for the default database twice keeps working, and
 * asking for it twice with settings that disagree is the mistake it reports.
 */
const open = (app: App.App, options: AdminFirestore.Options | undefined): Admin.Firestore => {
  const databaseId = options?.databaseId;
  if (options?.preferRest === undefined) {
    return databaseId === undefined ? Admin.getFirestore(app) : Admin.getFirestore(app, databaseId);
  }
  const settings = { preferRest: options.preferRest };
  return databaseId === undefined
    ? Admin.initializeFirestore(app, settings)
    : Admin.initializeFirestore(app, settings, databaseId);
};

const firestoreError = (message: string) => (cause: unknown) =>
  new FirestoreError({
    message,
    // Firestore answers over gRPC, whose statuses are numbered rather than
    // named, so a code only comes back for the failures the Admin SDK raises
    // itself.
    code: cause instanceof FirebaseError ? cause.code : undefined,
    cause,
  });

/**
 * Opens the database the options name on the {@link App.App} in context,
 * together with the encoder that writes into it.
 *
 * The SDK memoizes a database on the app itself, so there is nothing to release
 * here.
 *
 * @internal
 */
export const openWithEncoder = Effect.fnUntraced(function* (options?: AdminFirestore.Options) {
  const app = yield* App.App;
  const firestore = open(app, options);
  // Built from the database just opened rather than taken from context, so a
  // reference written into a document points into the database it is written
  // to, whichever one the options name.
  return { firestore, encoder: Encoder.make(firestore) };
});

/**
 * The service over a database already opened, writing through `encoder`.
 *
 * The encoder is handed in rather than built here so that `layerWithEncoder`
 * can put the very same one into context.
 *
 * @internal
 */
export const fromDatabase = (firestore: Admin.Firestore, encoder: FirestoreEncoder): Firestore => {
  const call = <A>(
    span: string,
    message: string,
    f: (firestore: Admin.Firestore) => PromiseLike<A> | A,
  ): Effect.Effect<A, FirestoreError> =>
    Effect.tryPromise({
      try: () => Promise.resolve(f(firestore)),
      catch: firestoreError(message),
    }).pipe(Effect.withSpan(`Firestore.${span}`));

  /**
   * Turns a document, in its model's `create` shape, into the values the
   * Admin SDK writes.
   *
   * The encoder is answered for here rather than by the caller, since writing
   * through an SDK is the whole reason there is one. Whatever else the schema
   * encodes through is left where it is, for the caller to provide.
   */
  const encode = <C extends Collection.Any>(collection: C, data: Create<C>) => {
    // Named so that the encoder is built against the schema `C` was defined
    // with rather than against `Schema.Top`, which keeps the services it
    // encodes through in the type instead of erasing them to `unknown`.
    const schema: Collection.DocumentSchema<C>["create"] = collection.schema.create;
    return Effect.provideService(
      Schema.encodeEffect(schema)(data),
      FirestoreEncoder,
      encoder,
    ) as Effect.Effect<Admin.DocumentData, Schema.SchemaError, WriteServices<C>>;
  };

  return Firestore.of({
    getDoc: <C extends Collection.Any>(ref: Collection.DocumentReference<C>) =>
      Effect.gen(function* () {
        const snapshot = yield* call(
          "getDoc",
          `Failed to read the document "${ref.path}"`,
          (firestore) => firestore.doc(ref.path).get(),
        );

        // `data()` hands back `undefined` for a document that is not there,
        // which is what tells the two apart.
        return DocumentSnapshot.make(ref, snapshot.data());
      }),

    getDocs: <C extends Collection.Any>(ref: Collection.CollectionReference<C>) =>
      Effect.gen(function* () {
        const query = yield* call(
          "getDocs",
          `Failed to read the collection "${ref.path}"`,
          (firestore) => firestore.collection(ref.path).get(),
        );

        return query.docs.map((snapshot) =>
          DocumentSnapshot.existing(ref.doc(ref.collection.id.make(snapshot.id)), snapshot.data()),
        );
      }),

    setDoc: <C extends Collection.Any>(ref: Collection.DocumentReference<C>, data: Create<C>) =>
      Effect.gen(function* () {
        const encoded = yield* encode(ref.collection, data);

        yield* call("setDoc", `Failed to write the document "${ref.path}"`, (firestore) =>
          firestore.doc(ref.path).set(encoded),
        );
      }),

    addDoc: <C extends Collection.Any>(ref: Collection.CollectionReference<C>, data: Create<C>) =>
      Effect.gen(function* () {
        const encoded = yield* encode(ref.collection, data);

        const added = yield* call(
          "addDoc",
          `Failed to add a document to "${ref.path}"`,
          (firestore) => firestore.collection(ref.path).add(encoded),
        );

        return ref.doc(ref.collection.id.make(added.id));
      }),
  });
};

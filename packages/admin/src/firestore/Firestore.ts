/**
 * Firestore for a single app, as exposed by the Firebase Admin SDK.
 *
 * @since 0.0.0
 */
import { Effect, Layer, Schema } from "effect";
import { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import type { WriteServices } from "@visiolab/effect-firebase/firestore/Firestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import * as Snapshot from "@visiolab/effect-firebase/firestore/Snapshot";
import { FirebaseError } from "firebase-admin/app";
import * as Admin from "firebase-admin/firestore";
import * as App from "../App.ts";
// The Admin SDK's own encoder, under the name it is reached by from outside.
// `FirestoreEncoder` is taken here by the service it implements, which is what
// the writes below ask context for.
import * as Encoder from "./FirestoreEncoder.ts";

/**
 * How to open a database.
 *
 * Both of these are settled when the database is opened rather than per call,
 * which is why they are a layer's business and not a method's.
 *
 * The emulator is not among them: the Admin SDK picks it up from the
 * `FIRESTORE_EMULATOR_HOST` environment variable, which has to be set before
 * the database is opened and is read by every app in the process rather than by
 * one layer.
 *
 * @category models
 * @since 0.0.0
 */
export interface Options {
  /**
   * The database to read, where the project holds more than the one it is
   * given by default.
   */
  readonly databaseId?: string | undefined;
  /**
   * Talk HTTP/1.1 rather than gRPC, until something is asked for that gRPC is
   * the only way to do.
   *
   * Worth it where a process handles a request or two and exits, since it
   * saves loading the gRPC libraries and opening a channel. Listening to a
   * document is the one thing that needs gRPC, at which point the SDK loads it
   * and stays on it.
   */
  readonly preferRest?: boolean | undefined;
}

/**
 * Opens the database the options name.
 *
 * Settings can only be handed over through `initializeFirestore`, which refuses
 * a database already opened with different ones, so they are only passed along
 * when there are some: asking for the default database twice keeps working, and
 * asking for it twice with settings that disagree is the mistake it reports.
 */
const open = (app: App.App, options: Options | undefined): Admin.Firestore => {
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
 * Builds {@link Firestore} on top of the {@link App.App} in context.
 *
 * Constructing the service cannot fail: opening a database only throws when the
 * app has already been deleted, when it was handed something that is not an
 * app, or when the same database was already opened with settings that
 * disagree. All three mean the app was wired up wrong rather than that a call
 * went wrong, so they surface as defects and `FirestoreError` keeps its single
 * meaning of "a Firestore call failed".
 *
 * The Admin SDK has no way to abort a request in flight, so these effects run
 * their call to completion even when the fiber is interrupted.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fn("Firestore.make")(function* (options?: Options) {
  const app = yield* App.App;

  // Taken from context rather than reached for directly, so that what a
  // document is written through is settled where the layers are put together.
  const encoder = yield* FirestoreEncoder;

  // The SDK memoizes a database on the app itself, so there is nothing to
  // release here.
  const firestore = open(app, options);

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
   * Turns a document into the values the Admin SDK writes.
   *
   * The encoder is answered for here rather than by the caller, since writing
   * through an SDK is the whole reason there is one. Whatever else the schema
   * encodes through is left where it is, for the caller to provide.
   */
  const encode = <C extends Collection.Any>(collection: C, data: Collection.Document<C>) => {
    // Named so that the encoder is built against the schema `C` was defined
    // with rather than against `Schema.Top`, the same way reading one is.
    const schema: Collection.DocumentSchema<C> = collection.schema;
    return Effect.provideService(
      Schema.encodeEffect(schema)(data),
      FirestoreEncoder,
      encoder,
    ) as Effect.Effect<Admin.DocumentData, Schema.SchemaError, WriteServices<C>>;
  };

  return Firestore.of({
    getDoc: <C extends Collection.Any>(ref: Collection.DocumentReference<C>) =>
      call("getDoc", `Failed to read the document "${ref.path}"`, (firestore) =>
        firestore.doc(ref.path).get(),
      ).pipe(
        Effect.map((document) =>
          // `data()` walks every field the document arrived with, so it goes
          // behind an effect: whether that is worth doing is the reader's to
          // decide.
          document.exists
            ? Snapshot.make(
                ref,
                Effect.sync(() => document.data()),
              )
            : Snapshot.missing(ref),
        ),
      ),

    getDocs: <C extends Collection.Any>(ref: Collection.CollectionReference<C>) =>
      call("getDocs", `Failed to read the collection "${ref.path}"`, (firestore) =>
        firestore.collection(ref.path).get(),
      ).pipe(
        Effect.map((query) =>
          // Every document a query answers with is one that was there, and its
          // id addresses the collection it came out of, so it is branded off
          // that collection rather than taken as a bare string.
          query.docs.map((document) =>
            Snapshot.make(
              ref.doc(ref.collection.id.make(document.id)),
              Effect.sync(() => document.data()),
            ),
          ),
        ),
      ),

    setDoc: <C extends Collection.Any>(
      ref: Collection.DocumentReference<C>,
      data: Collection.Document<C>,
    ) =>
      encode(ref.collection, data).pipe(
        Effect.flatMap((document) =>
          call("setDoc", `Failed to write the document "${ref.path}"`, (firestore) =>
            firestore.doc(ref.path).set(document),
          ),
        ),
        // The Admin SDK reports when the write landed and the web SDK does not,
        // so what comes back is what they agree on, which is nothing.
        Effect.asVoid,
      ),

    addDoc: <C extends Collection.Any>(
      ref: Collection.CollectionReference<C>,
      data: Collection.Document<C>,
    ) =>
      encode(ref.collection, data).pipe(
        Effect.flatMap((document) =>
          call("addDoc", `Failed to add a document to "${ref.path}"`, (firestore) =>
            firestore.collection(ref.path).add(document),
          ),
        ),
        // The id Firestore picked addresses this collection and nothing else,
        // so it is branded off it on the way back out.
        Effect.map((added) => ref.doc(ref.collection.id.make(added.id))),
      ),
  });
});

/**
 * A layer that provides {@link Firestore} for the {@link App.App} in context.
 *
 * Passing no options reads the database the project is given by default, over
 * gRPC.
 *
 * The encoder a document is written through is composed in here rather than
 * asked of the caller, since it is the Admin SDK's own and there is nothing to
 * decide about it from outside.
 *
 * @see {@link make} for why building the service cannot fail.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer = (options?: Options): Layer.Layer<Firestore, never, App.App> =>
  Layer.effect(Firestore, make(options)).pipe(Layer.provide(Encoder.layer));

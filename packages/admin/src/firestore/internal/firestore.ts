import { Cause, Context, Effect, Exit, Option, Queue, Schema, Stream } from "effect";
import { constVoid } from "effect/Function";
import {
  Firestore,
  FirestoreError,
  Transaction,
} from "@visiolab/effect-firebase/firestore/Firestore";
import type {
  Create,
  Update,
  UpdateOptions,
  UpdateSchema,
  TransactionOptions,
  UpdateServices,
  WriteServices,
} from "@visiolab/effect-firebase/firestore/Firestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import type * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
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
 * What a transaction callback throws when its body fails with anything but a
 * `FirestoreError`.
 *
 * It carries no `code` on purpose: the SDK decides whether to retry by the
 * code of what it caught, and a body's own error that happens to carry one
 * would otherwise be retried as if Firestore had raised it.
 */
class BodyFailed {
  readonly cause: Cause.Cause<unknown>;
  constructor(cause: Cause.Cause<unknown>) {
    this.cause = cause;
  }
}

/**
 * What a transaction callback throws for a body that failed with `cause`.
 *
 * A `FirestoreError` goes back as the SDK's own error behind it, so the SDK
 * decides by its own rules whether to retry it - a conflict, or an outage that
 * passes - rather than by a copy of them kept here. That goes for any
 * `FirestoreError`, whichever call raised it, just as the SDK treats whatever
 * its own callback throws. Anything else goes back as {@link BodyFailed},
 * which it never retries.
 *
 * The tests do not reach the first case. Firestore can answer a read inside a
 * transaction with ABORTED when other transactions contend for the same
 * documents, and that is the conflict this hands back. The emulator never
 * does: it has a contended read wait for the lock instead, and only ever
 * reports a conflict at commit, which the SDK retries without the body's
 * failure being involved.
 */
const thrownFor = (cause: Cause.Cause<unknown>): unknown => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return error instanceof FirestoreError && error.cause !== undefined
    ? error.cause
    : new BodyFailed(cause);
};

/** The documents `query` read from the collection at `ref`. */
const existingIn = <C extends Collection.Any>(
  ref: Collection.CollectionReference<C>,
  query: Admin.QuerySnapshot,
): ReadonlyArray<DocumentSnapshot.Existing<C>> =>
  query.docs.map((snapshot) =>
    DocumentSnapshot.existing(ref.doc(ref.collection.id.make(snapshot.id)), snapshot.data()),
  );

/**
 * Where reads and writes go: straight to the database, or into a transaction.
 */
interface Target {
  readonly name: string;
  readonly getDoc: (ref: Admin.DocumentReference) => Promise<Admin.DocumentSnapshot>;
  readonly setDoc: (ref: Admin.DocumentReference, data: Admin.DocumentData) => unknown;
  readonly updateDoc: (
    ref: Admin.DocumentReference,
    data: Admin.UpdateData<Admin.DocumentData>,
  ) => unknown;
}

const databaseTarget: Target = {
  name: "Firestore",
  getDoc: (ref) => ref.get(),
  setDoc: (ref, data) => ref.set(data),
  updateDoc: (ref, data) => ref.update(data),
};

const transactionTarget = (tx: Admin.Transaction): Target => ({
  name: "Firestore.Transaction",
  getDoc: (ref) => tx.get(ref),
  // Writes into a transaction are queued rather than sent, so these return
  // straight away - or throw, where the transaction refuses them.
  setDoc: (ref, data) => tx.set(ref, data),
  updateDoc: (ref, data) => tx.update(ref, data),
});

/**
 * The reads and writes a {@link Firestore} and a {@link Transaction} share,
 * made against `target`.
 */
const operations = (firestore: Admin.Firestore, encoder: FirestoreEncoder, target: Target) => {
  const call = <A>(
    span: string,
    message: string,
    f: () => PromiseLike<A> | A,
  ): Effect.Effect<A, FirestoreError> =>
    Effect.tryPromise({
      try: () => Promise.resolve(f()),
      catch: firestoreError(message),
    }).pipe(Effect.withSpan(`${target.name}.${span}`));

  /**
   * Turns what is written, in the shape `schema` takes, into the values the
   * Admin SDK writes.
   *
   * The encoder is answered for here rather than by the caller, since writing
   * through an SDK is the whole reason there is one. Whatever else the schema
   * encodes through is left where it is, for the caller to provide.
   */
  const encode = <S extends Schema.Top>(schema: S, data: S["Type"]) =>
    Effect.provideService(Schema.encodeEffect(schema)(data), FirestoreEncoder, encoder);

  /** A document, in its model's `create` shape. */
  const encodeCreate = <C extends Collection.Any>(collection: C, data: Create<C>) => {
    // Named so that the encoder is built against the schema `C` was defined
    // with rather than against `Schema.Top`, which keeps the services it
    // encodes through in the type instead of erasing them to `unknown`.
    const schema: Collection.DocumentSchema<C>["create"] = collection.schema.create;
    return encode(schema, data) as Effect.Effect<
      Admin.DocumentData,
      Schema.SchemaError,
      WriteServices<C>
    >;
  };

  /**
   * A patch, in its model's update shape for `mode`, which encodes to the
   * paths it writes at - the very keys `update` reads as field paths.
   */
  const encodeUpdate = <C extends Collection.Any, Mode extends FirestoreModel.UpdateMode>(
    collection: C,
    data: Update<C, Mode>,
    mode: Mode | undefined,
  ) => {
    const schema = (
      mode === "unchecked" ? collection.schema.updateUnchecked : collection.schema.update
    ) as UpdateSchema<C, Mode>;
    return encode(schema, data) as Effect.Effect<
      Admin.UpdateData<Admin.DocumentData>,
      Schema.SchemaError,
      UpdateServices<C>
    >;
  };

  return {
    call,
    encodeCreate,
    getDoc: <C extends Collection.Any>(ref: Collection.DocumentReference<C>) =>
      Effect.gen(function* () {
        const snapshot = yield* call("getDoc", `Failed to read the document "${ref.path}"`, () =>
          target.getDoc(firestore.doc(ref.path)),
        );

        // `data()` hands back `undefined` for a document that is not there,
        // which is what tells the two apart.
        return DocumentSnapshot.make(ref, snapshot.data());
      }),

    setDoc: <C extends Collection.Any>(ref: Collection.DocumentReference<C>, data: Create<C>) =>
      Effect.gen(function* () {
        const encoded = yield* encodeCreate(ref.collection, data);

        yield* call("setDoc", `Failed to write the document "${ref.path}"`, () =>
          target.setDoc(firestore.doc(ref.path), encoded),
        );
      }),

    updateDoc: <C extends Collection.Any, Mode extends FirestoreModel.UpdateMode = "checked">(
      ref: Collection.DocumentReference<C>,
      data: Update<C, Mode>,
      options?: UpdateOptions<Mode>,
    ) =>
      Effect.gen(function* () {
        const encoded = yield* encodeUpdate(ref.collection, data, options?.mode);

        yield* call("updateDoc", `Failed to update the document "${ref.path}"`, () =>
          target.updateDoc(firestore.doc(ref.path), encoded),
        );
      }),
  };
};

/**
 * A stream of what `subscribe` hands its listener, each turned into an element
 * by `toElement`.
 *
 * The listener is attached once the stream runs and detached when it stops,
 * so every run listens on its own. Only the latest element is kept for a
 * reader that falls behind, which is sound because each one is a whole
 * snapshot rather than a change to the last.
 */
const listen = <S, A>(
  span: string,
  message: string,
  subscribe: (onNext: (snapshot: S) => void, onError: (error: Error) => void) => () => void,
  toElement: (snapshot: S) => A,
): Stream.Stream<A, FirestoreError> =>
  Stream.callback<A, FirestoreError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          subscribe(
            (snapshot) => Queue.offerUnsafe(queue, toElement(snapshot)),
            (cause) => Queue.failCauseUnsafe(queue, Cause.fail(firestoreError(message)(cause))),
          ),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: "sliding" },
  ).pipe(Stream.withSpan(`Firestore.${span}`));

/**
 * The service over a database already opened, writing through `encoder`.
 *
 * The encoder is handed in rather than built here so that `layerWithEncoder`
 * can put the very same one into context.
 *
 * @internal
 */
export const fromDatabase = (firestore: Admin.Firestore, encoder: FirestoreEncoder): Firestore => {
  const { call, encodeCreate, ...database } = operations(firestore, encoder, databaseTarget);

  const makeTransaction = (tx: Admin.Transaction): Transaction => {
    const { getDoc, setDoc, updateDoc } = operations(firestore, encoder, transactionTarget(tx));
    return Transaction.of({ getDoc, setDoc, updateDoc });
  };

  return Firestore.of({
    ...database,

    getDocs: <C extends Collection.Any>(ref: Collection.CollectionReference<C>) =>
      Effect.gen(function* () {
        const query = yield* call("getDocs", `Failed to read the collection "${ref.path}"`, () =>
          firestore.collection(ref.path).get(),
        );

        return existingIn(ref, query);
      }),

    addDoc: <C extends Collection.Any>(ref: Collection.CollectionReference<C>, data: Create<C>) =>
      Effect.gen(function* () {
        const encoded = yield* encodeCreate(ref.collection, data);

        const added = yield* call("addDoc", `Failed to add a document to "${ref.path}"`, () =>
          firestore.collection(ref.path).add(encoded),
        );

        return ref.doc(ref.collection.id.make(added.id));
      }),

    streamDoc: <C extends Collection.Any>(ref: Collection.DocumentReference<C>) =>
      listen(
        "streamDoc",
        `Failed to listen to the document "${ref.path}"`,
        (onNext, onError) => firestore.doc(ref.path).onSnapshot(onNext, onError),
        (snapshot: Admin.DocumentSnapshot) => DocumentSnapshot.make(ref, snapshot.data()),
      ),

    streamDocs: <C extends Collection.Any>(ref: Collection.CollectionReference<C>) =>
      listen(
        "streamDocs",
        `Failed to listen to the collection "${ref.path}"`,
        (onNext, onError) => firestore.collection(ref.path).onSnapshot(onNext, onError),
        (query: Admin.QuerySnapshot) => existingIn(ref, query),
      ),

    runTransaction: Effect.fn("Firestore.runTransaction")(function* <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      options?: TransactionOptions,
    ) {
      // Captured inside the span, so the body's own spans hang off it.
      const context = yield* Effect.context<Exclude<R, Transaction>>();

      return yield* Effect.uninterruptibleMask((restore) => {
        const controller = new AbortController();
        // The last thing the body failed with, and what was thrown for it, so
        // that a failure the SDK hands back without retrying it comes back as
        // the body's own rather than wrapped a second time.
        let failure: { readonly thrown: unknown; readonly cause: Cause.Cause<unknown> } | undefined;
        const running = firestore.runTransaction(
          async (tx) => {
            const exit = await Effect.runPromiseExitWith(
              Context.add(context, Transaction, makeTransaction(tx)) as Context.Context<R>,
            )(effect, { signal: controller.signal });
            if (Exit.isSuccess(exit)) return exit.value;
            const thrown = thrownFor(exit.cause);
            failure = { thrown, cause: exit.cause };
            throw thrown;
          },
          { maxAttempts: options?.maxAttempts },
        );

        return restore(
          Effect.tryPromise({
            try: () => running,
            catch: (cause) =>
              failure !== undefined && cause === failure.thrown
                ? new BodyFailed(failure.cause)
                : firestoreError("Failed to run a transaction")(cause),
          }),
        ).pipe(
          // Interrupting the body is what makes the callback reject, and so
          // what makes the SDK roll back - which is waited for, so that
          // nothing of the transaction is left running once this is done.
          Effect.onInterrupt(() => {
            controller.abort();
            return Effect.promise(() => running.then(constVoid, constVoid));
          }),
          Effect.catchIf(
            (error): error is BodyFailed => error instanceof BodyFailed,
            (failed) => Effect.failCause(failed.cause as Cause.Cause<E>),
          ),
        );
      });
    }),
  });
};

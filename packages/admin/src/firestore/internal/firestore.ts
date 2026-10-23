import { Cause, Context, Effect, Exit, Option, Queue, Result, Schema, Stream } from "effect";
import { constVoid } from "effect/Function";
import {
  FirestoreError,
  Transaction,
  UndefinedCollectionError,
} from "@visiolab/effect-firebase/firestore/Firestore";
import type {
  Firestore,
  Create,
  Update,
  UpdateOptions,
  UpdateSchema,
  TransactionOptions,
} from "@visiolab/effect-firebase/firestore/Firestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import {
  type FirestoreValue,
  toCodecFirestore,
} from "@visiolab/effect-firebase/firestore/FirestoreValue";
import type * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { FirebaseError } from "firebase-admin/app";
import * as Admin from "firebase-admin/firestore";
import * as App from "../../App.ts";
import type * as AdminFirestore from "../AdminFirestore.ts";
import * as firestoreValue from "./firestoreValue.ts";

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
 * Opens the database the options name on the {@link App.App} in context.
 *
 * The SDK memoizes a database on the app itself, so there is nothing to release
 * here.
 *
 * @internal
 */
export const openDatabase = Effect.fnUntraced(function* (options?: AdminFirestore.Options) {
  const app = yield* App.App;
  return open(app, options);
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

/**
 * Reads a document's data as Firestore Values.
 *
 * A document holding a value outside the Firestore Value union, such as a
 * vector, fails to read: it could only ever be decoded as an untyped object.
 * `data()` hands back `undefined` for a document that is not there, which is
 * kept as it is.
 */
const dataOf = (
  path: string,
  snapshot: Admin.DocumentSnapshot,
): Result.Result<FirestoreValue | undefined, FirestoreError> =>
  firestoreValue.readDocument(path, snapshot.data());

/**
 * A snapshot of the document at `ref`, as `snapshot` read it.
 *
 * `data()` hands back `undefined` for a document that is not there, which is
 * what tells the two apart.
 */
const documentSnapshotOf = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  snapshot: Admin.DocumentSnapshot,
): Result.Result<DocumentSnapshot.DocumentSnapshot<C>, FirestoreError> =>
  Result.map(dataOf(ref.path, snapshot), (data) => DocumentSnapshot.make(ref, data));

/**
 * A snapshot of the documents `query` read, each addressed by `refOf`, which
 * fails for a document it cannot address.
 */
const querySnapshotOf = <C extends Collection.Any, E>(
  query: Admin.QuerySnapshot,
  refOf: (
    snapshot: Admin.QueryDocumentSnapshot,
  ) => Result.Result<Collection.DocumentReference<C>, E>,
): Result.Result<QuerySnapshot.QuerySnapshot<C>, FirestoreError | E> =>
  Result.map(
    Result.all(
      query.docs.map((snapshot) =>
        Result.flatMap(refOf(snapshot), (doc) =>
          Result.map(dataOf(doc.path, snapshot), (data) => DocumentSnapshot.existing(doc, data)),
        ),
      ),
    ),
    (docs) => QuerySnapshot.make(docs),
  );

/** A snapshot of the documents `query` read from the collection at `ref`. */
const collectionSnapshotOf = <C extends Collection.Any>(
  ref: Collection.CollectionReference<C>,
  query: Admin.QuerySnapshot,
): Result.Result<QuerySnapshot.QuerySnapshot<C>, FirestoreError> =>
  querySnapshotOf(query, (snapshot) =>
    Result.succeed(ref.doc(ref.collection.id.make(snapshot.id))),
  );

/**
 * A snapshot of the documents `query` read from `group`, each matched by its
 * path to the collection of the group it lives in.
 */
const groupSnapshotOf = (
  group: CollectionGroup.Any,
  query: Admin.QuerySnapshot,
): Result.Result<
  QuerySnapshot.QuerySnapshot<Collection.Any>,
  FirestoreError | UndefinedCollectionError
> =>
  querySnapshotOf(query, (snapshot) =>
    Result.fromOption(
      CollectionGroup.fromPath(group, snapshot.ref.path),
      () => new UndefinedCollectionError({ path: snapshot.ref.path, collectionId: group.id }),
    ),
  );

/**
 * Where reads and writes go: straight to the database, or into a transaction.
 */
interface Target {
  readonly name: string;
  readonly getDoc: (ref: Admin.DocumentReference) => Promise<Admin.DocumentSnapshot>;
  readonly getDocs: (query: Admin.Query) => Promise<Admin.QuerySnapshot>;
  readonly setDoc: (ref: Admin.DocumentReference, data: Admin.DocumentData) => unknown;
  readonly updateDoc: (
    ref: Admin.DocumentReference,
    data: Admin.UpdateData<Admin.DocumentData>,
  ) => unknown;
}

const databaseTarget: Target = {
  name: "Firestore",
  getDoc: (ref) => ref.get(),
  getDocs: (query) => query.get(),
  setDoc: (ref, data) => ref.set(data),
  updateDoc: (ref, data) => ref.update(data),
};

const transactionTarget = (tx: Admin.Transaction): Target => ({
  name: "Firestore.Transaction",
  getDoc: (ref) => tx.get(ref),
  getDocs: (query) => tx.get(query),
  // Writes into a transaction are queued rather than sent, so these return
  // straight away - or throw, where the transaction refuses them.
  setDoc: (ref, data) => tx.set(ref, data),
  updateDoc: (ref, data) => tx.update(ref, data),
});

/**
 * The reads and writes a {@link Firestore} and an
 * {@link AdminFirestore.AdminTransaction} share,
 * made against `target`.
 */
const operations = (firestore: Admin.Firestore, target: Target) => {
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
   * Admin SDK writes: encoded to Firestore Values through the codec derived
   * from `schema`, then mapped to the Admin SDK's own. Whatever services the
   * schema encodes through are left for the caller to provide.
   */
  const encode = <S extends Schema.Top>(schema: S, data: S["Type"]) =>
    Schema.encodeEffect(toCodecFirestore(schema))(data).pipe(
      Effect.map((encoded) => firestoreValue.toAdmin(encoded, firestore)),
    );

  /** A document, in its model's `create` shape. */
  const encodeCreate = <C extends Collection.Any>(collection: C, data: Create<C>) => {
    // Named so that the codec is derived from the schema `C` was defined
    // with rather than from `Schema.Top`, which keeps the services it
    // encodes through in the type instead of erasing them to `unknown`.
    const schema: Collection.DocumentSchema<C>["create"] = collection.schema.create;
    return encode(schema, data) as Effect.Effect<
      Admin.DocumentData,
      Schema.SchemaError,
      Collection.DocumentSchema<C>["create"]["EncodingServices"]
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
      Collection.DocumentSchema<C>["update"]["EncodingServices"]
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

        return yield* Effect.fromResult(documentSnapshotOf(ref, snapshot));
      }),

    getDocs: ((source: Collection.CollectionReference<Collection.Any> | CollectionGroup.Any) =>
      CollectionGroup.isCollectionGroup(source)
        ? Effect.gen(function* () {
            const query = yield* call(
              "getDocs",
              `Failed to read the collection group "${source.id}"`,
              () => target.getDocs(firestore.collectionGroup(source.id)),
            );

            return yield* Effect.fromResult(groupSnapshotOf(source, query));
          })
        : Effect.gen(function* () {
            const query = yield* call(
              "getDocs",
              `Failed to read the collection "${source.path}"`,
              () => target.getDocs(firestore.collection(source.path)),
            );

            return yield* Effect.fromResult(collectionSnapshotOf(source, query));
          })) as Firestore["getDocs"],

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
const listen = <S, A, E = FirestoreError>(
  span: string,
  message: string,
  subscribe: (onNext: (snapshot: S) => void, onError: (error: Error) => void) => () => void,
  toElement: (snapshot: S) => Result.Result<A, E>,
): Stream.Stream<A, FirestoreError | E> =>
  Stream.callback<A, FirestoreError | E>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          subscribe(
            (snapshot) => {
              // Runs inside the SDK's callback, so a snapshot that does not
              // map fails the stream rather than throwing back into the SDK.
              const element = toElement(snapshot);
              if (Result.isSuccess(element)) Queue.offerUnsafe(queue, element.success);
              else Queue.failCauseUnsafe(queue, Cause.fail(element.failure));
            },
            (cause) => Queue.failCauseUnsafe(queue, Cause.fail(firestoreError(message)(cause))),
          ),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: "sliding" },
  ).pipe(Stream.withSpan(`Firestore.${span}`));

/**
 * The service over a database already opened.
 *
 * The key a transaction body finds its
 * {@link AdminFirestore.AdminTransaction} under is handed in by the public
 * module that defines it, so that this one only imports it as a type and the
 * two do not import each other.
 *
 * @internal
 */
export const fromDatabase = (
  firestore: Admin.Firestore,
  AdminTransaction: typeof AdminFirestore.AdminTransaction,
): AdminFirestore.AdminFirestore => {
  const { call, encodeCreate, ...database } = operations(firestore, databaseTarget);

  const makeTransaction = (tx: Admin.Transaction): AdminFirestore.AdminTransaction => {
    const { getDoc, getDocs, setDoc, updateDoc } = operations(firestore, transactionTarget(tx));
    return AdminTransaction.of({ getDoc, getDocs, setDoc, updateDoc });
  };

  return {
    instance: firestore,

    ...database,

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
        (snapshot: Admin.DocumentSnapshot) => documentSnapshotOf(ref, snapshot),
      ),

    streamDocs: ((source: Collection.CollectionReference<Collection.Any> | CollectionGroup.Any) =>
      CollectionGroup.isCollectionGroup(source)
        ? listen(
            "streamDocs",
            `Failed to listen to the collection group "${source.id}"`,
            (onNext, onError) => firestore.collectionGroup(source.id).onSnapshot(onNext, onError),
            (query: Admin.QuerySnapshot) => groupSnapshotOf(source, query),
          )
        : listen(
            "streamDocs",
            `Failed to listen to the collection "${source.path}"`,
            (onNext, onError) => firestore.collection(source.path).onSnapshot(onNext, onError),
            (query: Admin.QuerySnapshot) => collectionSnapshotOf(source, query),
          )) as Firestore["streamDocs"],

    runTransaction: Effect.fn("Firestore.runTransaction")(function* <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      options?: TransactionOptions,
    ) {
      // Captured inside the span, so the body's own spans hang off it.
      const context =
        yield* Effect.context<Exclude<R, AdminFirestore.AdminTransaction | Transaction>>();

      return yield* Effect.uninterruptibleMask((restore) => {
        const controller = new AbortController();
        // The last thing the body failed with, and what was thrown for it, so
        // that a failure the SDK hands back without retrying it comes back as
        // the body's own rather than wrapped a second time.
        let failure: { readonly thrown: unknown; readonly cause: Cause.Cause<unknown> } | undefined;
        const running = firestore.runTransaction(
          async (tx) => {
            // One transaction, under both tags, so portable helpers and
            // admin ones in the same body read and write through it alike.
            const transaction = makeTransaction(tx);
            const exit = await Effect.runPromiseExitWith(
              context.pipe(
                Context.add(Transaction, transaction),
                Context.add(AdminTransaction, transaction),
              ) as Context.Context<R>,
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
  };
};

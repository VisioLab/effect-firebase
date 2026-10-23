import { Cause, Context, Effect, Exit, Option, Queue, Result, Schema, Stream } from "effect";
import { constVoid } from "effect/Function";
import {
  FirestoreError,
  Transaction,
  UndefinedCollectionError,
} from "@visiolab/effect-firebase/firestore/Firestore";
import type {
  Create,
  Update,
  UpdateOptions,
  UpdateSchema,
  TransactionOptions,
} from "@visiolab/effect-firebase/firestore/Firestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as ClientQuerySnapshot from "../ClientQuerySnapshot.ts";
import type * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import {
  type FirestoreValue,
  toCodecFirestore,
} from "@visiolab/effect-firebase/firestore/FirestoreValue";
import { FirebaseError } from "firebase/app";
import * as Client from "firebase/firestore";
import * as App from "../../App.ts";
import * as ClientDocumentSnapshot from "../ClientDocumentSnapshot.ts";
import type * as ClientFirestore from "../ClientFirestore.ts";
import * as firestoreValue from "./firestoreValue.ts";

/**
 * Opens the database the options name.
 *
 * Settings can only be handed over through `initializeFirestore`, which refuses
 * a database already opened, so they are only passed along when there are
 * some: asking for the default database twice keeps working, and asking for it
 * twice with settings is the mistake it reports.
 *
 * The emulator is connected after, which the SDK takes as often as it is asked
 * for the same one, but only before the database is first used.
 */
const open = (app: App.App, options: ClientFirestore.Options | undefined): Client.Firestore => {
  const databaseId = options?.databaseId;
  const firestore =
    options?.localCache === undefined
      ? databaseId === undefined
        ? Client.getFirestore(app)
        : Client.getFirestore(app, databaseId)
      : Client.initializeFirestore(app, { localCache: options.localCache }, databaseId);
  if (options?.emulator !== undefined) {
    Client.connectFirestoreEmulator(firestore, options.emulator.host, options.emulator.port);
  }
  return firestore;
};

const firestoreError = (message: string) => (cause: unknown) =>
  new FirestoreError({
    message,
    // The client SDK names every failure it reports, such as
    // `permission-denied`, whether it raised it itself or the database did.
    code: cause instanceof FirebaseError ? cause.code : undefined,
    cause,
  });

/**
 * Reads a document's data as Firestore Values, with the server timestamps it
 * is still waiting on estimated, rather than left `null` where a timestamp is
 * expected.
 *
 * A document holding a value outside the Firestore Value union, such as a
 * vector, fails to read: it could only ever be decoded as an untyped object.
 * `data()` hands back `undefined` for a document that is not there, which is
 * kept as it is.
 */
const dataOf = (
  path: string,
  snapshot: Client.DocumentSnapshot,
): Result.Result<FirestoreValue | undefined, FirestoreError> =>
  firestoreValue.readDocument(path, snapshot.data({ serverTimestamps: "estimate" }));

/**
 * A portable snapshot of the document at `ref`, as `snapshot` read it.
 *
 * `data()` hands back `undefined` for a document that is not there, which is
 * what tells the two apart.
 */
const portableSnapshotOf = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  snapshot: Client.DocumentSnapshot,
): Result.Result<DocumentSnapshot.DocumentSnapshot<C>, FirestoreError> =>
  Result.map(dataOf(ref.path, snapshot), (data) => DocumentSnapshot.make(ref, data));

/**
 * A snapshot of the document at `ref`, as `snapshot` read it, with the
 * metadata the SDK reported for it.
 */
const documentSnapshotOf = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  snapshot: Client.DocumentSnapshot,
): Result.Result<ClientDocumentSnapshot.ClientDocumentSnapshot<C>, FirestoreError> =>
  Result.map(dataOf(ref.path, snapshot), (data) =>
    ClientDocumentSnapshot.make(ref, data, snapshot.metadata),
  );

/**
 * A snapshot of the documents `query` read, each addressed by `refOf`, which
 * fails for a document it cannot address.
 */
const querySnapshotOf = <C extends Collection.Any, E>(
  query: Client.QuerySnapshot,
  refOf: (
    snapshot: Client.QueryDocumentSnapshot,
  ) => Result.Result<Collection.DocumentReference<C>, E>,
): Result.Result<ClientQuerySnapshot.ClientQuerySnapshot<C>, FirestoreError | E> =>
  Result.map(
    Result.all(
      query.docs.map((snapshot) =>
        Result.flatMap(refOf(snapshot), (doc) =>
          Result.map(dataOf(doc.path, snapshot), (data) =>
            ClientDocumentSnapshot.existing(doc, data, snapshot.metadata),
          ),
        ),
      ),
    ),
    (docs) => ClientQuerySnapshot.make(docs, query.metadata),
  );

/** What `getDocs` and `streamDocs` read from: a collection, or a group. */
type Source = Collection.CollectionReference<Collection.Any> | CollectionGroup.Any;

/**
 * The client SDK query that reads `source`, what it is called in a failure,
 * and how a snapshot of it maps to one of the documents of `source`: each
 * addressed in the collection read, or, for a group, matched by its path to the
 * collection of the group it lives in.
 */
const queryOf = (
  firestore: Client.Firestore,
  source: Source,
): {
  readonly query: Client.Query;
  readonly name: string;
  readonly snapshotOf: (
    query: Client.QuerySnapshot,
  ) => Result.Result<
    ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>,
    FirestoreError | UndefinedCollectionError
  >;
} =>
  CollectionGroup.isCollectionGroup(source)
    ? {
        query: Client.collectionGroup(firestore, source.id),
        name: `the collection group "${source.id}"`,
        snapshotOf: (query) =>
          querySnapshotOf(query, (snapshot) =>
            CollectionGroup.documentAt(source, snapshot.ref.path),
          ),
      }
    : {
        query: Client.collection(firestore, source.path),
        name: `the collection "${source.path}"`,
        snapshotOf: (query) =>
          querySnapshotOf(query, (snapshot) =>
            Result.succeed(source.doc(source.collection.id.make(snapshot.id))),
          ),
      };

/**
 * Opens the database the options name on the {@link App.App} in context.
 *
 * The SDK memoizes a database on the app itself, and deleting the app
 * terminates it, so there is nothing to release here.
 *
 * @internal
 */
export const openDatabase = Effect.fnUntraced(function* (options?: ClientFirestore.Options) {
  const app = yield* App.App;
  return open(app, options);
});

/**
 * What a transaction callback throws when its body fails with anything but a
 * `FirestoreError`.
 *
 * It is not a `FirebaseError` on purpose: the SDK only retries what is one,
 * by its code, and a body's own error that happens to carry a code would
 * otherwise be retried as if Firestore had raised it.
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
 * passes - rather than by a copy of them kept here. Anything else goes back as
 * {@link BodyFailed}, which it never retries.
 */
const thrownFor = (cause: Cause.Cause<unknown>): unknown => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return error instanceof FirestoreError && error.cause !== undefined
    ? error.cause
    : new BodyFailed(cause);
};

/**
 * Where reads and writes go: straight to the database, or into a transaction.
 */
interface Target {
  readonly name: string;
  readonly getDoc: (
    ref: Client.DocumentReference,
    source: ClientFirestore.ReadSource | undefined,
  ) => Promise<Client.DocumentSnapshot>;
  readonly setDoc: (ref: Client.DocumentReference, data: Client.DocumentData) => unknown;
  readonly updateDoc: (
    ref: Client.DocumentReference,
    data: Client.UpdateData<Client.DocumentData>,
  ) => unknown;
}

/** The SDK's own reads, for one {@link ClientFirestore.ReadSource}. */
interface Reads {
  readonly getDoc: (ref: Client.DocumentReference) => Promise<Client.DocumentSnapshot>;
  readonly getDocs: (query: Client.Query) => Promise<Client.QuerySnapshot>;
}

const reads: Record<ClientFirestore.ReadSource, Reads> = {
  default: { getDoc: Client.getDoc, getDocs: Client.getDocs },
  server: { getDoc: Client.getDocFromServer, getDocs: Client.getDocsFromServer },
  cache: { getDoc: Client.getDocFromCache, getDocs: Client.getDocsFromCache },
};

/** The SDK's reads from where `source` names, `"default"` where it names none. */
const readsFrom = (source: ClientFirestore.ReadSource | undefined): Reads =>
  reads[source ?? "default"];

const databaseTarget: Target = {
  name: "Firestore",
  getDoc: (ref, source) => readsFrom(source).getDoc(ref),
  setDoc: (ref, data) => Client.setDoc(ref, data),
  updateDoc: (ref, data) => Client.updateDoc(ref, data),
};

const transactionTarget = (tx: Client.Transaction): Target => ({
  name: "Firestore.Transaction",
  // A transaction reads from the server alone, so it is never handed a source.
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
const operations = (firestore: Client.Firestore, target: Target) => {
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
   * client SDK writes: encoded to Firestore Values through the codec derived
   * from `schema`, then mapped to the SDK's own. Whatever services the schema
   * encodes through are left for the caller to provide.
   */
  const encode = <S extends Schema.Top>(schema: S, data: S["Type"]) =>
    Effect.map(Schema.encodeEffect(toCodecFirestore(schema))(data), (encoded) =>
      firestoreValue.toClient(encoded, firestore),
    );

  /** A document, in its model's `create` shape. */
  const encodeCreate = <C extends Collection.Any>(collection: C, data: Create<C>) => {
    // Named so that the codec is derived from the schema `C` was defined
    // with rather than from `Schema.Top`, which keeps the services it
    // encodes through in the type instead of erasing them to `unknown`.
    const schema: Collection.DocumentSchema<C>["create"] = collection.schema.create;
    return encode(schema, data) as Effect.Effect<
      Client.DocumentData,
      Schema.SchemaError,
      Collection.DocumentSchema<C>["create"]["EncodingServices"]
    >;
  };

  /**
   * A patch, in its model's update shape for `mode`, which encodes to the
   * paths it writes at - the very keys `updateDoc` reads as field paths.
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
      Client.UpdateData<Client.DocumentData>,
      Schema.SchemaError,
      Collection.DocumentSchema<C>["update"]["EncodingServices"]
    >;
  };

  return {
    call,
    encodeCreate,
    /**
     * Reads one document, handing back the SDK's own snapshot for the caller
     * to turn into the one it hands on: a database read keeps its metadata, a
     * transaction's read does not.
     */
    readDoc: <C extends Collection.Any>(
      ref: Collection.DocumentReference<C>,
      source?: ClientFirestore.ReadSource,
    ) =>
      call("getDoc", `Failed to read the document "${ref.path}"`, () =>
        target.getDoc(Client.doc(firestore, ref.path), source),
      ),

    setDoc: <C extends Collection.Any>(ref: Collection.DocumentReference<C>, data: Create<C>) =>
      Effect.gen(function* () {
        const encoded = yield* encodeCreate(ref.collection, data);

        yield* call("setDoc", `Failed to write the document "${ref.path}"`, () =>
          target.setDoc(Client.doc(firestore, ref.path), encoded),
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
          target.updateDoc(Client.doc(firestore, ref.path), encoded),
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
 * The SDK's listen options for `options`, leaving out what is not given rather
 * than handing the SDK an `undefined` in its place.
 */
const snapshotListenOptions = (
  options: ClientFirestore.ListenOptions | undefined,
): Client.SnapshotListenOptions => ({
  ...(options?.includeMetadataChanges === undefined
    ? {}
    : { includeMetadataChanges: options.includeMetadataChanges }),
  ...(options?.source === undefined ? {} : { source: options.source }),
});

/**
 * The service over a database already opened.
 *
 * @internal
 */
export const fromDatabase = (firestore: Client.Firestore): ClientFirestore.ClientFirestore => {
  const { call, encodeCreate, readDoc, ...database } = operations(firestore, databaseTarget);

  const makeTransaction = (tx: Client.Transaction): Transaction => {
    const { readDoc, setDoc, updateDoc } = operations(firestore, transactionTarget(tx));
    return Transaction.of({
      // A transaction reads from the server alone and never holds writes of
      // its own that are pending, so its metadata says nothing and is left
      // out: what it hands back is the portable snapshot.
      getDoc: (ref) =>
        Effect.flatMap(readDoc(ref), (snapshot) =>
          Effect.fromResult(portableSnapshotOf(ref, snapshot)),
        ),
      setDoc,
      updateDoc,
    });
  };

  return {
    instance: firestore,
    ...database,

    getDoc: <C extends Collection.Any>(
      ref: Collection.DocumentReference<C>,
      options?: ClientFirestore.ReadOptions,
    ) =>
      Effect.flatMap(readDoc(ref, options?.source), (snapshot) =>
        Effect.fromResult(documentSnapshotOf(ref, snapshot)),
      ),

    getDocs: ((source: Source, options?: ClientFirestore.ReadOptions) =>
      Effect.gen(function* () {
        const { query, name, snapshotOf } = queryOf(firestore, source);
        const snapshot = yield* call("getDocs", `Failed to read ${name}`, () =>
          readsFrom(options?.source).getDocs(query),
        );

        return yield* Effect.fromResult(snapshotOf(snapshot));
      })) as ClientFirestore.ClientFirestore["getDocs"],

    addDoc: <C extends Collection.Any>(ref: Collection.CollectionReference<C>, data: Create<C>) =>
      Effect.gen(function* () {
        const encoded = yield* encodeCreate(ref.collection, data);

        const added = yield* call("addDoc", `Failed to add a document to "${ref.path}"`, () =>
          Client.addDoc(Client.collection(firestore, ref.path), encoded),
        );

        return ref.doc(ref.collection.id.make(added.id));
      }),

    // The client SDK hands a listener the documents as this client last wrote
    // them, before the database has taken the writes, so each write is seen
    // straight away rather than once it is acknowledged.
    streamDoc: <C extends Collection.Any>(
      ref: Collection.DocumentReference<C>,
      options?: ClientFirestore.ListenOptions,
    ) =>
      listen(
        "streamDoc",
        `Failed to listen to the document "${ref.path}"`,
        (onNext, onError) =>
          Client.onSnapshot(
            Client.doc(firestore, ref.path),
            snapshotListenOptions(options),
            onNext,
            onError,
          ),
        (snapshot: Client.DocumentSnapshot) => documentSnapshotOf(ref, snapshot),
      ),

    streamDocs: ((source: Source, options?: ClientFirestore.ListenOptions) => {
      const { query, name, snapshotOf } = queryOf(firestore, source);
      return listen(
        "streamDocs",
        `Failed to listen to ${name}`,
        (onNext, onError) =>
          Client.onSnapshot(query, snapshotListenOptions(options), onNext, onError),
        snapshotOf,
      );
    }) as ClientFirestore.ClientFirestore["streamDocs"],

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
        const running = Client.runTransaction(
          firestore,
          async (tx) => {
            const exit = await Effect.runPromiseExitWith(
              Context.add(context, Transaction, makeTransaction(tx)) as Context.Context<R>,
            )(effect, { signal: controller.signal });
            if (Exit.isSuccess(exit)) return exit.value;
            const thrown = thrownFor(exit.cause);
            failure = { thrown, cause: exit.cause };
            throw thrown;
          },
          // Left out rather than passed as `undefined` where it is not given:
          // the SDK spreads it over its defaults, and an `undefined` there
          // turns retrying off altogether.
          options?.maxAttempts === undefined ? undefined : { maxAttempts: options.maxAttempts },
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

import { Effect, Result } from "effect";
import * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import { FirebaseError } from "firebase/app";
import * as Client from "firebase/firestore";
import * as App from "../../app/App.ts";
import type * as ClientFirestore from "../ClientFirestore.ts";
import * as firestoreValue from "./firestoreValue.ts";
import * as snapshotMetadata from "./snapshotMetadata.ts";

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

const firestoreError = (message: string) => (cause: unknown) =>
  new Firestore.FirestoreError({
    message,
    // The client SDK names every failure it reports, such as
    // `permission-denied`, whether it raised it itself or the database did.
    code: cause instanceof FirebaseError ? cause.code : undefined,
    cause,
  });

/** Runs one call to the SDK, turning what it throws or rejects with into a `FirestoreError`. */
const call = <A>(
  message: string,
  f: () => PromiseLike<A> | A,
): Effect.Effect<A, Firestore.FirestoreError> =>
  Effect.tryPromise({
    try: () => Promise.resolve(f()),
    catch: firestoreError(message),
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
): Result.Result<Firestore.DocumentData | undefined, Firestore.FirestoreError> =>
  firestoreValue.readDocument(
    path,
    snapshot.data({ serverTimestamps: "estimate" }),
  ) as Result.Result<Firestore.DocumentData | undefined, Firestore.FirestoreError>;

/** What the client knows about a read beyond the portable snapshot. */
type Extra = ReturnType<typeof snapshotMetadata.extraOf>;

/** A read of one document, with the metadata the SDK reported for it. */
const documentReadOf = (
  snapshot: Client.DocumentSnapshot,
): Result.Result<Firestore.DocumentRead<Extra>, Firestore.FirestoreError> =>
  Result.map(dataOf(snapshot.ref.path, snapshot), (data) => ({
    data,
    extra: snapshotMetadata.extraOf(snapshot.metadata),
  }));

/** A read of many documents, each and as a whole with the metadata the SDK reported. */
const queryReadOf = (
  query: Client.QuerySnapshot,
): Result.Result<Firestore.QueryRead<Extra>, Firestore.FirestoreError> =>
  Result.map(
    Result.all(
      query.docs.map((snapshot) =>
        Result.map(dataOf(snapshot.ref.path, snapshot), (data) => ({
          path: snapshot.ref.path,
          // A query only hands back documents that are there.
          data: data as Firestore.DocumentData,
          extra: snapshotMetadata.extraOf(snapshot.metadata),
        })),
      ),
    ),
    (docs) => ({ docs, extra: snapshotMetadata.extraOf(query.metadata) }),
  );

/** The client SDK query `selector` names, and what it is called in a failure. */
const queryOf = (
  firestore: Client.Firestore,
  selector: Firestore.CollectionSelector,
): { readonly query: Client.Query; readonly name: string } =>
  selector._tag === "CollectionGroup"
    ? {
        query: Client.collectionGroup(firestore, selector.id),
        name: `the collection group "${selector.id}"`,
      }
    : {
        query: Client.collection(firestore, selector.path),
        name: `the collection "${selector.path}"`,
      };

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

/** The SDK's reads from where `options` names, `"default"` where it names none. */
const readsFrom = (options: ClientFirestore.ReadOptions | undefined): Reads =>
  reads[options?.source ?? "default"];

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
  const docOf = (path: string) => Client.doc(firestore, path);
  const toClient = (data: Firestore.DocumentData) =>
    firestoreValue.toClient(data, firestore) as Client.DocumentData;

  const made = Firestore.make({
    getDoc: (path, options: ClientFirestore.ReadOptions | undefined) =>
      Effect.flatMap(
        call(`Failed to read the document "${path}"`, () => readsFrom(options).getDoc(docOf(path))),
        (snapshot) => Effect.fromResult(documentReadOf(snapshot)),
      ),

    getDocs: (selector, options: ClientFirestore.ReadOptions | undefined) => {
      const { query, name } = queryOf(firestore, selector);
      return Effect.flatMap(
        call(`Failed to read ${name}`, () => readsFrom(options).getDocs(query)),
        (snapshot) => Effect.fromResult(queryReadOf(snapshot)),
      );
    },

    setDoc: (path, data) =>
      call(`Failed to write the document "${path}"`, () =>
        Client.setDoc(docOf(path), toClient(data)),
      ),

    updateDoc: (path, data) =>
      call(`Failed to update the document "${path}"`, () =>
        Client.updateDoc(docOf(path), toClient(data)),
      ),

    addDoc: (path, data) =>
      Effect.map(
        call(`Failed to add a document to "${path}"`, () =>
          Client.addDoc(Client.collection(firestore, path), toClient(data)),
        ),
        (added) => added.id,
      ),

    // The client SDK hands a listener the documents as this client last wrote
    // them, before the database has taken the writes, so each write is seen
    // straight away rather than once it is acknowledged.
    streamDoc: (path, options: ClientFirestore.ListenOptions | undefined) =>
      Firestore.streamFromListener({
        subscribe: (onNext, onError) =>
          Client.onSnapshot(docOf(path), snapshotListenOptions(options), onNext, onError),
        onError: firestoreError(`Failed to listen to the document "${path}"`),
        map: documentReadOf,
      }),

    streamDocs: (selector, options: ClientFirestore.ListenOptions | undefined) => {
      const { query, name } = queryOf(firestore, selector);
      return Firestore.streamFromListener({
        subscribe: (onNext, onError) =>
          Client.onSnapshot(query, snapshotListenOptions(options), onNext, onError),
        onError: firestoreError(`Failed to listen to ${name}`),
        map: queryReadOf,
      });
    },

    runTransaction: Firestore.transactionFromCallback({
      run: (callback, options) => Client.runTransaction(firestore, callback, options),
      operations: (tx: Client.Transaction) => ({
        // A transaction reads from the server alone and never holds writes of
        // its own that are pending, so its metadata says nothing and is left
        // out: what it hands back is the portable snapshot.
        getDoc: (path) =>
          Effect.flatMap(
            call(`Failed to read the document "${path}"`, () => tx.get(docOf(path))),
            (snapshot) =>
              Effect.fromResult(Result.map(dataOf(path, snapshot), (data) => ({ data }))),
          ),
        // Writes into a transaction are queued rather than sent, so these return
        // straight away - or throw, where the transaction refuses them.
        setDoc: (path, data) =>
          call(`Failed to write the document "${path}"`, () => {
            tx.set(docOf(path), toClient(data));
          }),
        updateDoc: (path, data) =>
          call(`Failed to update the document "${path}"`, () => {
            tx.update(docOf(path), toClient(data));
          }),
      }),
      onError: firestoreError("Failed to run a transaction"),
    }),
  });

  // `make` infers the read source and listen options its hooks are handed and
  // the metadata they read with each snapshot, so the client's interface is
  // checked against what it built here.
  const service: ClientFirestore.ClientFirestore = Object.assign(made, { instance: firestore });
  return service;
};

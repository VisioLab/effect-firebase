import { Context, Effect, Result } from "effect";
import * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
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
  new Firestore.FirestoreError({
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
 * Calls the Admin SDK, failing with `message` for whatever it throws or
 * rejects with. Writes into a transaction are queued rather than sent, so they
 * answer straight away - or throw, where the transaction refuses them.
 */
const call = <A>(message: string, f: () => PromiseLike<A> | A) =>
  Effect.tryPromise({ try: () => Promise.resolve(f()), catch: firestoreError(message) });

/**
 * A document's data as Firestore Values, or `undefined` for one that is not
 * there. A document holding a value outside the Firestore Value union, such as
 * a vector, fails to read.
 */
const dataOf = (
  path: string,
  data: Admin.DocumentData | undefined,
): Result.Result<Firestore.DocumentData | undefined, Firestore.FirestoreError> =>
  firestoreValue.readDocument(path, data) as Result.Result<
    Firestore.DocumentData | undefined,
    Firestore.FirestoreError
  >;

const documentReadOf = (
  path: string,
  snapshot: Admin.DocumentSnapshot,
): Result.Result<Firestore.DocumentRead, Firestore.FirestoreError> =>
  Result.map(dataOf(path, snapshot.data()), (data) => ({ data }));

const queryReadOf = (
  query: Admin.QuerySnapshot,
): Result.Result<Firestore.QueryRead, Firestore.FirestoreError> =>
  Result.map(
    Result.all(
      query.docs.map((snapshot) =>
        // A document read as one of many is always there.
        Result.map(dataOf(snapshot.ref.path, snapshot.data()), (data) => ({
          path: snapshot.ref.path,
          data: data as Firestore.DocumentData,
        })),
      ),
    ),
    (docs) => ({ docs }),
  );

/** The Admin SDK query `selector` names, and what it is called in a failure. */
const queryOf = (firestore: Admin.Firestore, selector: Firestore.CollectionSelector) =>
  selector._tag === "CollectionGroup"
    ? {
        query: (): Admin.Query => firestore.collectionGroup(selector.id),
        name: `the collection group "${selector.id}"`,
      }
    : {
        query: (): Admin.Query => firestore.collection(selector.path),
        name: `the collection "${selector.path}"`,
      };

/** Reads many documents, through the database or a transaction. */
const getDocs =
  (firestore: Admin.Firestore, get: (query: Admin.Query) => Promise<Admin.QuerySnapshot>) =>
  (selector: Firestore.CollectionSelector) => {
    const { query, name } = queryOf(firestore, selector);
    return Effect.flatMap(
      call(`Failed to read ${name}`, () => get(query())),
      (snapshot) => Effect.fromResult(queryReadOf(snapshot)),
    );
  };

/**
 * The reads and writes of one attempt at a transaction, which, unlike the
 * client's, can read many documents.
 */
const transactionOperations = (
  firestore: Admin.Firestore,
  tx: Admin.Transaction,
): Required<Firestore.TransactionOperations> => ({
  getDoc: (path) =>
    Effect.flatMap(
      call(`Failed to read the document "${path}"`, () => tx.get(firestore.doc(path))),
      (snapshot) => Effect.fromResult(documentReadOf(path, snapshot)),
    ),
  getDocs: getDocs(firestore, (query) => tx.get(query)),
  setDoc: (path, data) =>
    call(`Failed to write the document "${path}"`, () => {
      tx.set(firestore.doc(path), firestoreValue.toAdmin(data, firestore) as Admin.DocumentData);
    }),
  updateDoc: (path, data) =>
    call(`Failed to update the document "${path}"`, () => {
      tx.update(
        firestore.doc(path),
        firestoreValue.toAdmin(data, firestore) as Admin.UpdateData<Admin.DocumentData>,
      );
    }),
});

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
  const toAdmin = (data: Firestore.DocumentData) => firestoreValue.toAdmin(data, firestore);

  const service = Firestore.make({
    getDoc: (path) =>
      Effect.flatMap(
        call(`Failed to read the document "${path}"`, () => firestore.doc(path).get()),
        (snapshot) => Effect.fromResult(documentReadOf(path, snapshot)),
      ),

    getDocs: getDocs(firestore, (query) => query.get()),

    setDoc: (path, data) =>
      Effect.asVoid(
        call(`Failed to write the document "${path}"`, () =>
          firestore.doc(path).set(toAdmin(data) as Admin.DocumentData),
        ),
      ),

    updateDoc: (path, data) =>
      Effect.asVoid(
        call(`Failed to update the document "${path}"`, () =>
          firestore.doc(path).update(toAdmin(data) as Admin.UpdateData<Admin.DocumentData>),
        ),
      ),

    addDoc: (path, data) =>
      Effect.map(
        call(`Failed to add a document to "${path}"`, () =>
          firestore.collection(path).add(toAdmin(data) as Admin.DocumentData),
        ),
        (added) => added.id,
      ),

    streamDoc: (path) =>
      Firestore.streamFromListener({
        subscribe: (onNext, onError) => firestore.doc(path).onSnapshot(onNext, onError),
        onError: firestoreError(`Failed to listen to the document "${path}"`),
        map: (snapshot: Admin.DocumentSnapshot) => documentReadOf(path, snapshot),
      }),

    streamDocs: (selector) => {
      const { query, name } = queryOf(firestore, selector);
      return Firestore.streamFromListener({
        subscribe: (onNext, onError) => query().onSnapshot(onNext, onError),
        onError: firestoreError(`Failed to listen to ${name}`),
        map: queryReadOf,
      });
    },

    runTransaction: Firestore.transactionFromCallback({
      run: (callback, options) => firestore.runTransaction(callback, options),
      operations: (tx: Admin.Transaction) => transactionOperations(firestore, tx),
      onError: firestoreError("Failed to run a transaction"),
      // The operations read many documents, so the transaction core builds
      // has a `getDocs`, and is an Admin Transaction as it is.
      context: (transaction) => Context.make(AdminTransaction, transaction),
    }),
  });

  // The Admin interface is checked against what `make` built here, except for
  // the Admin Transaction its `context` offers: the compiler does not check
  // transaction services on assignment, so the AdminTransaction tests do.
  const admin: AdminFirestore.AdminFirestore = Object.assign(service, { instance: firestore });
  return admin;
};

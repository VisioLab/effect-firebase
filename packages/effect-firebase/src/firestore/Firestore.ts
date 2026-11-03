/**
 * Reading and writing Firestore documents as an Effect service.
 *
 * {@link Firestore} is the portable service: it reads, listens to, writes and
 * updates documents, and runs transactions, the same way on every backend.
 * Every call is addressed by a reference built from a
 * {@link Collection.Collection}, whose {@link FirestoreModel} encodes what is
 * written and decodes what is read.
 *
 * - Define documents with {@link FirestoreModel.Class} and where they live with
 *   {@link Collection.make}.
 * - Provide the service with {@link AdminFirestore.layer} on a server, or
 *   {@link ClientFirestore.layer} in a browser or app. Each layer also provides
 *   its richer service, {@link AdminFirestore.AdminFirestore} or
 *   {@link ClientFirestore.ClientFirestore}, as the same object.
 * - Implement a backend of your own with {@link make}.
 *
 * @example Reading and writing a document
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, DocumentSnapshot, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   const alice = Users.doc(Users.id.make("alice"));
 *
 *   yield* firestore.setDoc(alice, { name: "Alice" });
 *
 *   const snapshot = yield* firestore.getDoc(alice);
 *   if (DocumentSnapshot.isExisting(snapshot)) {
 *     const user = yield* snapshot.data;
 *     yield* Effect.log(user.name);
 *   }
 * });
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Context } from "effect";
import type { Effect, Schema, Stream } from "effect";
import type * as Result from "effect/Result";
import type * as Collection from "./Collection.ts";
import type * as CollectionGroup from "./CollectionGroup.ts";
import type * as DocumentSnapshot from "./DocumentSnapshot.ts";
import type * as FirestoreModel from "./FirestoreModel.ts";
import type { FirestoreValue } from "./FirestoreValue.ts";
import * as firestore from "./internal/firestore.ts";
import type { FirestoreError, UndefinedCollectionError } from "./internal/firestoreError.ts";
import * as internalStreamFromListener from "./internal/streamFromListener.ts";
import * as internalTransactionFromCallback from "./internal/transactionFromCallback.ts";
import type * as QuerySnapshot from "./QuerySnapshot.ts";

export {
  /**
   * The error every Firestore call fails with when the backend fails it.
   *
   * It carries the backend's original error as its `cause`, and its `code`
   * where the SDK names one, such as `permission-denied`. The client SDK
   * always names it. The Admin SDK reports gRPC statuses by number, so there
   * `code` is often absent.
   *
   * @stability unstable
   * @category errors
   * @since 0.2.0
   */
  FirestoreError,
  /**
   * The error a read of a {@link CollectionGroup.CollectionGroup} fails with
   * when it finds a document at a path none of the group's collections define.
   * For example, a root-level `posts` document when the group is made of
   * `users/{id}/posts`.
   *
   * **Details**
   *
   * It is separate from {@link FirestoreError} because the call to Firestore
   * succeeded: the data contradicts the model. It is an error rather than a
   * defect because the database contents decide whether it happens, so
   * correct code cannot rule it out. If you treat it as a bug, `Effect.orDie`
   * it.
   *
   * @stability unstable
   * @category errors
   * @since 0.2.0
   */
  UndefinedCollectionError,
} from "./internal/firestoreError.ts";

/**
 * The data {@link With.setDoc} and {@link With.addDoc} take for a document in
 * `C`: the `create` shape of the collection's model.
 *
 * @see {@link Update} for the data {@link With.updateDoc} takes
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Create<C extends Collection.Any> = Collection.DocumentSchema<C>["create"]["Type"];

/**
 * The schema an update to a document in `C` is encoded through in `Mode`: the
 * model's `update` schema, or its `updateUnchecked` schema.
 *
 * @see {@link Update} for the patch type itself
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdateSchema<
  C extends Collection.Any,
  Mode extends FirestoreModel.UpdateMode = "checked",
> = Mode extends "unchecked"
  ? Collection.DocumentSchema<C>["updateUnchecked"]
  : Collection.DocumentSchema<C>["update"];

/**
 * The patch {@link With.updateDoc} takes for a document in `C` in `Mode`.
 *
 * @see {@link Create} for the data {@link With.setDoc} takes
 * @see {@link FirestoreModel.UpdateMode} for which patches each mode accepts
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Update<
  C extends Collection.Any,
  Mode extends FirestoreModel.UpdateMode = "checked",
> = UpdateSchema<C, Mode>["Type"];

/**
 * Options for {@link With.updateDoc}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface UpdateOptions<Mode extends FirestoreModel.UpdateMode = "checked"> {
  /**
   * Which patches the update accepts.
   *
   * **When to use**
   *
   * Leave it at `"checked"`, the default, which only accepts patches that
   * leave every document readable. Use `"unchecked"` to write into an optional
   * struct or a union member's key, when you know the document holds it, for
   * example from an earlier read in the same transaction.
   *
   * @see {@link FirestoreModel.UpdateMode} for exactly which patches each mode accepts
   */
  readonly mode?: Mode | undefined;
}

/**
 * Options for {@link With.runTransaction}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface TransactionOptions {
  /**
   * How many times the body runs before a transaction that keeps conflicting
   * with other writes gives up. Defaults to the SDK's own default, 5.
   */
  readonly maxAttempts?: number | undefined;
}

/**
 * The transaction a {@link With.runTransaction} body reads and writes
 * through.
 *
 * **When to use**
 *
 * Ask for it in a helper that must run inside a transaction. Requiring it in
 * the type says the helper belongs in a transaction and may run more than
 * once.
 *
 * **Details**
 *
 * It follows Firestore's transaction rules: every read comes before every
 * write, and writes are queued and only sent when the body finishes, so they
 * cannot be read back inside the transaction.
 *
 * It reads one document at a time, never a whole collection, because the
 * client SDK's transactions only read documents.
 *
 * @see {@link AdminFirestore.AdminTransaction} for an Admin SDK transaction that can also read a whole collection
 *
 * @example Moving a counter inside a transaction
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, DocumentSnapshot, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Counter extends FirestoreModel.Class<Counter>("Counter")({ count: Schema.Finite }) {}
 *
 * const Counters = Collection.make("counters", Counter);
 *
 * const bump = (id: string) =>
 *   Effect.gen(function* () {
 *     const transaction = yield* Firestore.Transaction;
 *     const ref = Counters.doc(Counters.id.make(id));
 *     const snapshot = yield* transaction.getDoc(ref);
 *     const count = DocumentSnapshot.isExisting(snapshot) ? (yield* snapshot.data).count : 0;
 *     yield* transaction.setDoc(ref, { count: count + 1 });
 *   });
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   yield* firestore.runTransaction(bump("visits"));
 * });
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Transaction {
  /**
   * Reads one document as part of the transaction. Works like
   * {@link With.getDoc}.
   *
   * Every read must come before the transaction's first write.
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
  ) => Effect.Effect<DocumentSnapshot.DocumentSnapshot<C>, FirestoreError>;

  /**
   * Queues a write of one whole document. Works like {@link With.setDoc}.
   */
  readonly setDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    data: Create<C>,
  ) => Effect.Effect<
    void,
    FirestoreError | Schema.SchemaError,
    Collection.DocumentSchema<C>["create"]["EncodingServices"]
  >;

  /**
   * Queues an update of one document. Works like {@link With.updateDoc}.
   */
  readonly updateDoc: <
    C extends Collection.Any,
    Mode extends FirestoreModel.UpdateMode = "checked",
  >(
    ref: Collection.DocumentReference<C>,
    data: Update<C, Mode>,
    options?: UpdateOptions<Mode>,
  ) => Effect.Effect<
    void,
    FirestoreError | Schema.SchemaError,
    Collection.DocumentSchema<C>["update"]["EncodingServices"]
  >;
}

/**
 * Service key for the {@link Transaction} a {@link With.runTransaction} body
 * runs in.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const Transaction = Context.Service<Transaction>(
  "@visiolab/effect-firebase/firestore/Firestore/Transaction",
);

/**
 * The trailing parameters a {@link With} read or listen takes: none when
 * `Options` is `never`, as on the portable {@link Firestore}, and an optional
 * `options` otherwise.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type OptionsParameter<Options> = [Options] extends [never] ? [] : [options?: Options];

/**
 * The Firestore service with a backend's additions: the options its reads and
 * listens take, the extra fields its snapshots carry, and further services a
 * transaction body can ask for.
 *
 * **When to use**
 *
 * Use it to type a backend's richer service, as
 * {@link AdminFirestore.AdminFirestore} and
 * {@link ClientFirestore.ClientFirestore} do, or for what {@link make}
 * returns. Application code asks for {@link Firestore}, or for a backend's own
 * service where it needs that backend's features.
 *
 * **Details**
 *
 * - `ReadOptions`: what {@link With.getDoc} and {@link With.getDocs} take
 *   besides a reference, such as the client's read `source`. None by default.
 * - `ListenOptions`: what {@link With.streamDoc} and {@link With.streamDocs}
 *   take besides a reference. None by default.
 * - `Extra`: what a backend knows about a read beyond the portable snapshot,
 *   such as the client's `metadata`. It is on every document snapshot, on
 *   each document of a query snapshot, and on the query snapshot itself.
 * - `TransactionServices`: services a {@link With.runTransaction} body can ask
 *   for besides {@link Transaction}, such as a backend's own richer
 *   transaction. Give each its own nominal key, such as a class-style
 *   `Context.Service`. A key whose type is the transaction's own type is
 *   absorbed by {@link Transaction} and dropped from the body's requirements
 *   by every Firestore, so nothing would check that it is provided.
 *
 * TypeScript does not compare `TransactionServices` when one `With` is
 * assigned to another, so a backend should test that a transaction body can
 * ask for each service it claims to offer.
 *
 * @see {@link Firestore} for the portable service, which is this with every parameter at its default
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface With<
  ReadOptions = never,
  ListenOptions = never,
  Extra extends object = {},
  TransactionServices = never,
> {
  /**
   * Reads one document.
   *
   * **When to use**
   *
   * Use to read a document once. A missing document is not a failure: you get
   * a {@link DocumentSnapshot.Missing} snapshot, and
   * {@link DocumentSnapshot.isExisting} tells the two cases apart.
   *
   * **Details**
   *
   * The snapshot's data is decoded through the collection's model only when
   * you run its `data` effect, so a document that does not match the model
   * fails there, not here.
   *
   * @see {@link With.streamDoc} to keep receiving the document as it changes
   * @see {@link With.getDocs} to read every document in a collection
   *
   * @example Reading a document
   * ```ts
   * import { Effect, Schema } from "effect";
   * import { Collection, DocumentSnapshot, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   *
   * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
   *
   * const Users = Collection.make("users", User);
   *
   * const program = Effect.gen(function* () {
   *   const firestore = yield* Firestore.Firestore;
   *   const snapshot = yield* firestore.getDoc(Users.doc(Users.id.make("alice")));
   *   if (DocumentSnapshot.isMissing(snapshot)) return undefined;
   *   return yield* snapshot.data;
   * });
   * ```
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    ...options: OptionsParameter<ReadOptions>
  ) => Effect.Effect<DocumentSnapshot.DocumentSnapshot<C> & Extra, FirestoreError>;

  /**
   * Reads every document in a collection, or in a
   * {@link CollectionGroup.CollectionGroup}.
   *
   * **When to use**
   *
   * Use to read a whole collection once. Pass a collection reference to read
   * one collection under one parent, or a Collection Group to read every
   * collection of the group under every parent.
   *
   * **Details**
   *
   * Returns a {@link QuerySnapshot.QuerySnapshot} whose `docs` are
   * {@link DocumentSnapshot.Existing} snapshots, one per document found. An
   * empty collection reads as a snapshot with no `docs`.
   *
   * Reading a group matches each document by its path to the group's
   * collection it lives in, and addresses and decodes it as that collection's.
   * A document under the group's collection id at a path none of its
   * collections define fails the read with an
   * {@link UndefinedCollectionError}. Reading a collection reference fails
   * with {@link FirestoreError} only.
   *
   * @see {@link With.streamDocs} to keep receiving the documents as they change
   * @see {@link With.getDoc} to read one document
   *
   * @example Reading a collection
   * ```ts
   * import { Effect, Schema } from "effect";
   * import { Collection, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   *
   * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
   *
   * const Users = Collection.make("users", User);
   *
   * const program = Effect.gen(function* () {
   *   const firestore = yield* Firestore.Firestore;
   *   const snapshot = yield* firestore.getDocs(Users.collection());
   *   return yield* Effect.forEach(snapshot.docs, (doc) => doc.data);
   * });
   * ```
   */
  readonly getDocs: {
    <C extends Collection.Any>(
      ref: Collection.CollectionReference<C>,
      ...options: OptionsParameter<ReadOptions>
    ): Effect.Effect<QuerySnapshot.QuerySnapshot<C, Extra> & Extra, FirestoreError>;
    <G extends CollectionGroup.Any>(
      group: G,
      ...options: OptionsParameter<ReadOptions>
    ): Effect.Effect<
      QuerySnapshot.QuerySnapshot<CollectionGroup.Members<G>, Extra> & Extra,
      FirestoreError | UndefinedCollectionError
    >;
  };

  /**
   * Listens to one document, emitting a snapshot each time it changes.
   *
   * **When to use**
   *
   * Use to keep a view of a document up to date. For a one-off read, use
   * {@link With.getDoc}.
   *
   * **Details**
   *
   * The first snapshot is the document as it is when the listener attaches. A
   * document that is not there, or is deleted later, comes through as
   * {@link DocumentSnapshot.Missing}.
   *
   * Each snapshot is the whole document, so a reader slower than the changes
   * only sees the latest one: a snapshot not pulled before the next arrives is
   * dropped.
   *
   * The stream never ends on its own. Each run attaches its own listener, which
   * stays until the stream is interrupted. The stream fails with a
   * {@link FirestoreError} when Firestore drops the listener.
   *
   * @see {@link With.getDoc} to read the document once
   * @see {@link With.streamDocs} to listen to a whole collection
   *
   * @example Logging each change to a document
   * ```ts
   * import { Effect, Schema, Stream } from "effect";
   * import { Collection, DocumentSnapshot, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   *
   * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
   *
   * const Users = Collection.make("users", User);
   *
   * const program = Effect.gen(function* () {
   *   const firestore = yield* Firestore.Firestore;
   *   yield* firestore.streamDoc(Users.doc(Users.id.make("alice"))).pipe(
   *     Stream.filter(DocumentSnapshot.isExisting),
   *     Stream.mapEffect((snapshot) => snapshot.data),
   *     Stream.runForEach((user) => Effect.log(user.name)),
   *   );
   * });
   * ```
   */
  readonly streamDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    ...options: OptionsParameter<ListenOptions>
  ) => Stream.Stream<DocumentSnapshot.DocumentSnapshot<C> & Extra, FirestoreError>;

  /**
   * Listens to every document in a collection, or in a
   * {@link CollectionGroup.CollectionGroup}, emitting all of them each time
   * any of them changes.
   *
   * **When to use**
   *
   * Use to keep a view of a whole collection up to date. For a one-off read,
   * use {@link With.getDocs}.
   *
   * **Details**
   *
   * Each element is a {@link QuerySnapshot.QuerySnapshot} of every document
   * there at that moment, as {@link With.getDocs} would return it. As with
   * {@link With.streamDoc}, a snapshot not pulled before the next arrives is
   * dropped, and the stream never ends on its own.
   *
   * Listening to a group matches each document to its collection as
   * {@link With.getDocs} does. The stream fails with an
   * {@link UndefinedCollectionError} at the first snapshot holding a document
   * at a path none of the group's collections define. Listening to a
   * collection reference fails with {@link FirestoreError} only.
   *
   * @see {@link With.getDocs} to read the documents once
   * @see {@link With.streamDoc} to listen to one document
   */
  readonly streamDocs: {
    <C extends Collection.Any>(
      ref: Collection.CollectionReference<C>,
      ...options: OptionsParameter<ListenOptions>
    ): Stream.Stream<QuerySnapshot.QuerySnapshot<C, Extra> & Extra, FirestoreError>;
    <G extends CollectionGroup.Any>(
      group: G,
      ...options: OptionsParameter<ListenOptions>
    ): Stream.Stream<
      QuerySnapshot.QuerySnapshot<CollectionGroup.Members<G>, Extra> & Extra,
      FirestoreError | UndefinedCollectionError
    >;
  };

  /**
   * Writes a whole document under an id you choose, replacing whatever was
   * there.
   *
   * **When to use**
   *
   * Use to create a document at a known id, or to overwrite one completely.
   *
   * **Details**
   *
   * The data is the model's `create` shape and is written whole: fields left
   * out are removed, not kept. The model asks for every field, so this is
   * rarely a surprise.
   *
   * The data is encoded before anything is sent, so a value that does not
   * encode fails with a `SchemaError` and nothing is written.
   *
   * @see {@link With.addDoc} to write under an id Firestore picks
   * @see {@link With.updateDoc} to change some fields and keep the rest
   *
   * @example Writing a document
   * ```ts
   * import { Effect, Schema } from "effect";
   * import { Collection, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   *
   * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
   *
   * const Users = Collection.make("users", User);
   *
   * const program = Effect.gen(function* () {
   *   const firestore = yield* Firestore.Firestore;
   *   yield* firestore.setDoc(Users.doc(Users.id.make("alice")), { name: "Alice" });
   * });
   * ```
   */
  readonly setDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    data: Create<C>,
  ) => Effect.Effect<
    void,
    FirestoreError | Schema.SchemaError,
    Collection.DocumentSchema<C>["create"]["EncodingServices"]
  >;

  /**
   * Writes a new document under an id Firestore picks, and returns its
   * reference.
   *
   * **When to use**
   *
   * Use to create a document when its id does not matter.
   *
   * **Details**
   *
   * The data is the model's `create` shape, as for {@link With.setDoc}, and
   * is encoded before anything is sent.
   *
   * @see {@link With.setDoc} to write under an id you choose
   *
   * @example Adding a document
   * ```ts
   * import { Effect, Schema } from "effect";
   * import { Collection, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const program = Effect.gen(function* () {
   *   const firestore = yield* Firestore.Firestore;
   *   const ref = yield* firestore.addDoc(Posts.collection(), { title: "Hello" });
   *   yield* Effect.log(`Added ${ref.id}`);
   * });
   * ```
   */
  readonly addDoc: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
    data: Create<C>,
  ) => Effect.Effect<
    Collection.DocumentReference<C>,
    FirestoreError | Schema.SchemaError,
    Collection.DocumentSchema<C>["create"]["EncodingServices"]
  >;

  /**
   * Changes some fields of an existing document and keeps the rest.
   *
   * **When to use**
   *
   * Use to change part of a document without reading and rewriting it, for
   * example with {@link FieldValue.increment} or
   * {@link FieldValue.serverTimestamp}.
   *
   * **Details**
   *
   * The patch is encoded through the model's `update` schema, or its
   * `updateUnchecked` schema when `mode` is `"unchecked"`. A nested struct in
   * the patch is written field by field at its paths. Wrap it in
   * {@link Patch.replace} to write it whole.
   *
   * The document must exist: Firestore fails the update with a
   * {@link FirestoreError} when it does not, and also rejects an empty patch.
   *
   * Both modes encode the same fields at the same paths, so they require the
   * same services.
   *
   * @see {@link With.setDoc} to write a whole document, existing or not
   * @see {@link UpdateOptions.mode} for when to use `"unchecked"`
   *
   * @example Updating a field
   * ```ts
   * import { Effect, Schema } from "effect";
   * import { Collection, FieldValue, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   *   views: FirestoreModel.Number(Schema.Finite),
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const program = Effect.gen(function* () {
   *   const firestore = yield* Firestore.Firestore;
   *   yield* firestore.updateDoc(Posts.doc(Posts.id.make("hello")), {
   *     views: FieldValue.increment(1),
   *   });
   * });
   * ```
   */
  readonly updateDoc: <
    C extends Collection.Any,
    Mode extends FirestoreModel.UpdateMode = "checked",
  >(
    ref: Collection.DocumentReference<C>,
    data: Update<C, Mode>,
    options?: UpdateOptions<Mode>,
  ) => Effect.Effect<
    void,
    FirestoreError | Schema.SchemaError,
    Collection.DocumentSchema<C>["update"]["EncodingServices"]
  >;

  /**
   * Runs `effect` in a transaction, providing the {@link Transaction} it reads
   * and writes through.
   *
   * **When to use**
   *
   * Use when writes depend on what was read, and must not be based on data
   * another write has changed in the meantime.
   *
   * **Details**
   *
   * When another write conflicts, the SDK discards the queued writes and runs
   * `effect` again from the start. Anything else `effect` does, such as
   * sending an email, writing through the service rather than the
   * transaction, or running another transaction, happens once per attempt, so
   * do it after the transaction instead.
   *
   * A `FirestoreError` is retried where the SDK would retry it: a conflict, or
   * a passing outage such as the database being briefly unavailable. That
   * holds for any `FirestoreError` `effect` fails with, including one from a
   * call outside the transaction. Any other failure, such as an error of your
   * own, a defect, or a write that does not encode, rolls the transaction back
   * and fails with exactly that error.
   *
   * A transaction run inside another is independent: it commits when it is
   * done, whatever happens to the outer one.
   *
   * Interrupting it interrupts `effect`, rolls the transaction back, and
   * returns once the rollback is done.
   *
   * A backend that offers `TransactionServices` provides the same transaction
   * object under each of them, so `effect` does not need them from its caller.
   *
   * @see {@link Transaction} for what the body can read and write
   * @see {@link TransactionOptions} for how many attempts it makes
   *
   * @example Running a transaction
   * ```ts
   * import { Effect, Schema } from "effect";
   * import { Collection, DocumentSnapshot, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   *
   * class Account extends FirestoreModel.Class<Account>("Account")({ balance: Schema.Finite }) {}
   *
   * const Accounts = Collection.make("accounts", Account);
   *
   * const withdraw = (id: string, amount: number) =>
   *   Effect.gen(function* () {
   *     const firestore = yield* Firestore.Firestore;
   *     yield* firestore.runTransaction(
   *       Effect.gen(function* () {
   *         const transaction = yield* Firestore.Transaction;
   *         const ref = Accounts.doc(Accounts.id.make(id));
   *         const snapshot = yield* transaction.getDoc(ref);
   *         if (DocumentSnapshot.isMissing(snapshot)) return yield* Effect.fail("NoSuchAccount" as const);
   *         const { balance } = yield* snapshot.data;
   *         if (balance < amount) return yield* Effect.fail("InsufficientFunds" as const);
   *         yield* transaction.updateDoc(ref, { balance: balance - amount });
   *       }),
   *       { maxAttempts: 3 },
   *     );
   *   });
   * ```
   */
  readonly runTransaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: TransactionOptions,
  ) => Effect.Effect<A, E | FirestoreError, Exclude<R, Transaction | TransactionServices>>;
}

/**
 * The portable Firestore service for a single app, which every backend
 * provides.
 *
 * **When to use**
 *
 * Ask for it in code that should run on any backend, the Admin SDK or the
 * client SDK. Its methods are documented on {@link With}.
 *
 * @see {@link With} for each method, and for what a backend's richer service adds
 * @see {@link AdminFirestore.AdminFirestore} for the Admin SDK's richer service
 * @see {@link ClientFirestore.ClientFirestore} for the client SDK's richer service
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Firestore extends With {}

/**
 * Service key for the portable {@link Firestore}.
 *
 * Provide it with {@link AdminFirestore.layer} or
 * {@link ClientFirestore.layer}.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const Firestore = Context.Service<Firestore>(
  "@visiolab/effect-firebase/firestore/Firestore",
);

/**
 * What a {@link MakeOptions} read or listen hook for many documents reads:
 * one collection, by its path, or every collection with one collection id,
 * wherever it sits.
 *
 * **Details**
 *
 * {@link make} builds it from the collection reference or
 * {@link CollectionGroup.CollectionGroup} the caller passed, and keeps the
 * group itself, so a hook only turns it into its backend's query.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type CollectionSelector =
  | {
      readonly _tag: "Collection";
      /** The collection's path, such as `users/alice/posts`. */
      readonly path: string;
    }
  | {
      readonly _tag: "CollectionGroup";
      /** The collection id every collection read shares, such as `posts`. */
      readonly id: string;
    };

/**
 * A document's data as a {@link MakeOptions} hook reads and writes it: a map
 * of Firestore Values.
 *
 * **Details**
 *
 * For a write it is either a whole document, for `setDoc` and `addDoc`, or a
 * map from field paths such as `address.city` to the values written there, for
 * `updateDoc`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type DocumentData = { readonly [field: string]: FirestoreValue };

/**
 * The `extra` field of what a {@link MakeOptions} read hook returns: what the
 * backend knows about the read beyond the portable snapshot.
 *
 * **Details**
 *
 * Each field of `extra` is put on the snapshot and shown when it prints, as
 * {@link DocumentSnapshot.make} does. Its fields must not clash with the
 * snapshot's own.
 *
 * - When `Extra` has required fields, `extra` is required, so a snapshot never
 *   claims extra data its read did not return.
 * - When every field is optional, `extra` may be left out.
 * - When `Extra` has no fields, `extra` must be left out, so a hook cannot
 *   return extra data the snapshots do not carry.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type ReadExtra<Extra extends object> = [keyof Extra] extends [never]
  ? { readonly extra?: undefined }
  : {} extends Extra
    ? { readonly extra?: Extra | undefined }
    : { readonly extra: Extra };

/**
 * What a {@link MakeOptions} hook returns for one document, with the `Extra`
 * the backend knows about it.
 *
 * @see {@link QueryDocumentRead} for one document of many
 * @see {@link ReadExtra} for its `extra`
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type DocumentRead<Extra extends object = {}> = {
  /**
   * The document's data, or `undefined` when it is not there. Data that is not
   * made of Firestore Values fails the read with a {@link FirestoreError}.
   */
  readonly data: DocumentData | undefined;
} & ReadExtra<Extra>;

/**
 * What a {@link MakeOptions} hook returns for one document of many: always one
 * that exists, with the `Extra` the backend knows about it.
 *
 * @see {@link DocumentRead} for a single document, which may be missing
 * @see {@link ReadExtra} for its `extra`
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type QueryDocumentRead<Extra extends object = {}> = {
  /**
   * The document's full path, such as `users/alice/posts/hello`. It matches a
   * document of a Collection Group to the collection it lives in.
   */
  readonly path: string;
  /**
   * The document's data. Data that is not made of Firestore Values fails the
   * read with a {@link FirestoreError}.
   */
  readonly data: DocumentData;
} & ReadExtra<Extra>;

/**
 * What a {@link MakeOptions} hook returns for many documents, with the
 * `Extra` the backend knows about each of them and about the read as a whole.
 *
 * **Details**
 *
 * The read's own `extra` is put on the {@link QuerySnapshot.QuerySnapshot}, as
 * {@link QuerySnapshot.make} does.
 *
 * @see {@link ReadExtra} for its `extra`
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type QueryRead<Extra extends object = {}> = {
  /** Every document read. */
  readonly docs: ReadonlyArray<QueryDocumentRead<Extra>>;
} & ReadExtra<Extra>;

/**
 * The reads and writes of one transaction attempt, which a
 * {@link RunTransaction.run} hook hands to the body. {@link make} builds the
 * {@link Transaction} the body uses from them.
 *
 * **Details**
 *
 * Writes in a transaction are queued until it commits, so a backend may
 * complete `setDoc` and `updateDoc` straight away.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface TransactionOperations {
  /** Reads the document at `path` as part of the transaction. */
  readonly getDoc: (path: string) => Effect.Effect<DocumentRead, FirestoreError>;
  /** Queues a write of the whole document at `path`. */
  readonly setDoc: (path: string, data: DocumentData) => Effect.Effect<void, FirestoreError>;
  /** Queues an update of the document at `path`, with `data` keyed by field path. */
  readonly updateDoc: (path: string, data: DocumentData) => Effect.Effect<void, FirestoreError>;
  /**
   * Reads many documents as part of the transaction, for a backend that can.
   *
   * When it is given, the transaction {@link make} builds has a `getDocs` that
   * works like {@link With.getDocs}, which {@link RunTransaction.context} can
   * offer under a key of its own.
   */
  readonly getDocs?:
    | ((selector: CollectionSelector) => Effect.Effect<QueryRead, FirestoreError>)
    | undefined;
}

/**
 * The transaction {@link make} builds from `Operations` and hands to
 * {@link RunTransaction.context}: a {@link Transaction}, plus a `getDocs` that
 * works like {@link With.getDocs} when `Operations` has `getDocs`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type BuiltTransaction<Operations extends TransactionOperations> = Transaction &
  (Operations extends { readonly getDocs: NonNullable<TransactionOperations["getDocs"]> }
    ? { readonly getDocs: Firestore["getDocs"] }
    : {});

/**
 * The {@link MakeOptions.runTransaction} hook: how a backend runs a
 * transaction, and which further services a body can find the transaction
 * under.
 *
 * **Details**
 *
 * `Operations` is what the backend can do in a transaction. It decides
 * whether the transaction {@link make} builds can read many documents.
 *
 * @see {@link transactionFromCallback} to build one for an SDK that runs transactions as a callback
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface RunTransaction<
  Operations extends TransactionOperations = TransactionOperations,
  TransactionServices = never,
> {
  /**
   * Runs `body` in a transaction, once per attempt, with that attempt's
   * operations. Fails with what the body failed with, or with a
   * {@link FirestoreError} of its own. Backs {@link With.runTransaction}.
   *
   * The body needs nothing from context: everything the caller's effect
   * needs, including the transaction's span, is already provided, so it may
   * run on a runtime of its own, such as inside an SDK callback.
   */
  readonly run: <A, E>(
    body: (operations: Operations) => Effect.Effect<A, E>,
    options: TransactionHookOptions,
  ) => Effect.Effect<A, E | FirestoreError>;

  /**
   * Further services a transaction body can find the transaction under,
   * besides {@link Transaction}, such as a backend's own richer transaction.
   *
   * It is handed the transaction {@link make} built for the attempt, and each
   * service holds that same object, so the body reads and writes through one
   * transaction whichever key it asks for.
   */
  readonly context?:
    | ((transaction: BuiltTransaction<Operations>) => Context.Context<TransactionServices>)
    | undefined;
}

/**
 * The options a {@link RunTransaction.run} hook is handed.
 *
 * @stability unstable
 * @category options
 * @since 0.3.0
 */
export interface TransactionHookOptions {
  /**
   * Only present when the caller set it, so a backend that passes these
   * options on unchanged keeps its SDK's default otherwise. The client SDK,
   * for one, turns retrying off when `maxAttempts` is present but
   * `undefined`.
   */
  readonly maxAttempts?: number;
}

/**
 * The hooks {@link make} builds a Firestore service from.
 *
 * **Details**
 *
 * Each hook works in Firestore's own terms: document paths, a
 * {@link CollectionSelector}, and {@link DocumentData}. It converts between
 * its backend's values and Firestore Values. Each returns an `Effect`, or a
 * `Stream` for listening, that fails with a {@link FirestoreError} built from
 * the backend's error, with its `code` and `cause`. {@link make} passes that
 * error on unchanged.
 *
 * - `ReadOptions` and `ListenOptions`: what a backend's reads and listens
 *   take on top of the portable ones, such as the client's read source. The
 *   hook receives whatever the caller passed, or `undefined`.
 * - `Extra`: what the read and listen hooks know about a read beyond the
 *   portable snapshot, such as the client's `metadata`. It is inferred from
 *   `getDoc`, and `getDocs`, `streamDoc` and `streamDocs` must return the
 *   same, or the hooks do not compile.
 * - `Operations` and `TransactionServices`: those of the
 *   {@link RunTransaction} hook.
 *
 * @stability unstable
 * @category options
 * @since 0.3.0
 */
export interface MakeOptions<
  ReadOptions = never,
  ListenOptions = never,
  Extra extends object = {},
  Operations extends TransactionOperations = TransactionOperations,
  TransactionServices = never,
> {
  /** Reads the document at `path`. Backs {@link With.getDoc}. */
  readonly getDoc: (
    path: string,
    options: ReadOptions | undefined,
  ) => Effect.Effect<DocumentRead<Extra>, FirestoreError>;

  /**
   * Reads every document `selector` names. Backs {@link With.getDocs}, which
   * matches each document of a Collection Group to its collection.
   */
  readonly getDocs: (
    selector: CollectionSelector,
    options: ReadOptions | undefined,
  ) => Effect.Effect<QueryRead<NoInfer<Extra>>, FirestoreError>;

  /**
   * Writes the whole document at `path`, replacing whatever was there. Backs
   * {@link With.setDoc}.
   */
  readonly setDoc: (path: string, data: DocumentData) => Effect.Effect<void, FirestoreError>;

  /**
   * Updates the document at `path`, with `data` keyed by field path. Backs
   * {@link With.updateDoc}.
   */
  readonly updateDoc: (path: string, data: DocumentData) => Effect.Effect<void, FirestoreError>;

  /**
   * Writes a document under a new id in the collection at `path`, and returns
   * that id. Backs {@link With.addDoc}.
   */
  readonly addDoc: (path: string, data: DocumentData) => Effect.Effect<string, FirestoreError>;

  /**
   * Listens to the document at `path`, emitting a read each time it changes.
   * Backs {@link With.streamDoc}.
   *
   * Each run of the stream should attach its own listener and detach it when
   * the run stops, keeping only the latest read for a reader that falls
   * behind. {@link streamFromListener} does this for an SDK listener.
   */
  readonly streamDoc: (
    path: string,
    options: ListenOptions | undefined,
  ) => Stream.Stream<DocumentRead<NoInfer<Extra>>, FirestoreError>;

  /**
   * Listens to every document `selector` names, as
   * {@link MakeOptions.streamDoc} listens to one. Backs
   * {@link With.streamDocs}.
   */
  readonly streamDocs: (
    selector: CollectionSelector,
    options: ListenOptions | undefined,
  ) => Stream.Stream<QueryRead<NoInfer<Extra>>, FirestoreError>;

  /**
   * Runs a transaction, and offers it under further services. Backs
   * {@link With.runTransaction}.
   *
   * @see {@link RunTransaction} for what it has to do
   * @see {@link transactionFromCallback} to build it for an SDK that runs transactions as a callback
   */
  readonly runTransaction: RunTransaction<Operations, TransactionServices>;
}

/**
 * Builds a Firestore service from one backend's hooks.
 *
 * **When to use**
 *
 * Use to implement a backend, such as a new SDK or an in-memory fake for
 * tests. Applications use a backend's layer instead, such as
 * {@link AdminFirestore.layer} or {@link ClientFirestore.layer}.
 *
 * **Details**
 *
 * The hooks only move Firestore Values to and from the backend. `make`
 * handles everything above them, the same way for every backend:
 *
 * - encoding writes through the collection's model, in its `create` shape or
 *   the update shape for the requested mode
 * - decoding reads into snapshots, with any extra the hooks return
 * - matching each document of a Collection Group to its collection
 * - tracing spans
 * - providing the {@link Transaction} a transaction body runs in
 *
 * The return type is inferred from the hooks: a {@link With} whose reads and
 * listens take the options the hooks take, whose snapshots carry the extra
 * they return, and whose transaction bodies get the services the transaction
 * hook's `context` offers. Hooks with none of those build a service
 * assignable to the portable {@link Firestore}.
 *
 * A backend's richer service extends what this returns, as
 * {@link AdminFirestore.AdminFirestore} does with its `instance`.
 *
 * @see {@link transactionFromCallback} to build the `runTransaction` hook from an SDK callback
 * @see {@link streamFromListener} to build the `streamDoc` and `streamDocs` hooks from an SDK listener
 *
 * @example An in-memory backend
 * ```ts
 * import { Effect, Layer, Stream } from "effect";
 * import { Firestore } from "@visiolab/effect-firebase/firestore";
 *
 * const documents = new Map<string, Firestore.DocumentData>();
 *
 * const getDoc = (path: string) => Effect.sync(() => ({ data: documents.get(path) }));
 * const setDoc = (path: string, data: Firestore.DocumentData) =>
 *   Effect.sync(() => void documents.set(path, data));
 * const updateDoc = (path: string, data: Firestore.DocumentData) =>
 *   Effect.sync(() => void documents.set(path, { ...documents.get(path), ...data }));
 * const getDocs = (selector: Firestore.CollectionSelector) =>
 *   Effect.sync(() => ({
 *     docs: [...documents]
 *       .filter(([path]) => selector._tag === "Collection" && path.startsWith(`${selector.path}/`))
 *       .map(([path, data]) => ({ path, data })),
 *   }));
 *
 * const firestore = Firestore.make({
 *   getDoc,
 *   getDocs,
 *   setDoc,
 *   updateDoc,
 *   addDoc: (path, data) => {
 *     const id = crypto.randomUUID();
 *     return Effect.as(setDoc(`${path}/${id}`, data), id);
 *   },
 *   streamDoc: (path) => Stream.fromEffect(getDoc(path)),
 *   streamDocs: (selector) => Stream.fromEffect(getDocs(selector)),
 *   runTransaction: { run: (body) => body({ getDoc, setDoc, updateDoc }) },
 * });
 *
 * const FirestoreInMemory = Layer.succeed(Firestore.Firestore, firestore);
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make: <
  ReadOptions = never,
  ListenOptions = never,
  Extra extends object = {},
  Operations extends TransactionOperations = TransactionOperations,
  TransactionServices = never,
>(
  options: MakeOptions<ReadOptions, ListenOptions, Extra, Operations, TransactionServices>,
) => With<ReadOptions, ListenOptions, Extra, TransactionServices> = (options) =>
  firestore.make(options, Transaction);

/**
 * Options for {@link transactionFromCallback}: how to drive an SDK that runs
 * a transaction as a callback and retries it.
 *
 * **Details**
 *
 * `T` is the SDK's own transaction object, handed to each attempt. It is
 * inferred from `operations` alone, so annotate that parameter, as in
 * `operations: (tx: Admin.Transaction) => ...`. `Operations` and
 * `TransactionServices` are those of the {@link RunTransaction} hook it
 * builds.
 *
 * The fields may come in any order, with one exception: put `context` after
 * an `operations` that builds its object inline with unannotated functions,
 * such as `getDoc: (path) => ...`. TypeScript types `context` as soon as it
 * reaches it, and only learns `Operations` from such an `operations` once it
 * reaches that.
 *
 * @stability unstable
 * @category options
 * @since 0.3.0
 */
export interface TransactionFromCallbackOptions<
  T,
  Operations extends TransactionOperations = TransactionOperations,
  TransactionServices = never,
> {
  /**
   * Runs `callback` in a transaction and retries it by the SDK's own rules,
   * such as the Admin SDK's `firestore.runTransaction(callback, options)`.
   * `options` are the hook's own, passed on unchanged, so `maxAttempts` is
   * only present when the caller set it.
   *
   * The callback takes whatever the SDK passes it and hands it to
   * `operations` as the SDK's transaction. It is typed `unknown` rather than
   * `T` because TypeScript would settle `T` from `run` before seeing
   * `operations` whenever `run` comes first.
   */
  readonly run: <A>(
    callback: (transaction: unknown) => Promise<A>,
    options: TransactionHookOptions,
  ) => Promise<A>;
  /** The reads and writes of one attempt, over the SDK's transaction. */
  readonly operations: (transaction: T) => Operations;
  /**
   * Builds the error for a rejection of `run` that does not come from the
   * body, such as a failed commit, with the SDK's `code` and `cause`.
   */
  readonly onError: (cause: unknown) => FirestoreError;
  /**
   * Further services a body can find the transaction under.
   *
   * @see {@link RunTransaction.context}
   */
  readonly context?: RunTransaction<Operations, TransactionServices>["context"];
}

/**
 * Builds the {@link MakeOptions.runTransaction} hook for an SDK that runs a
 * transaction as a callback and retries it. It is the counterpart of Effect's
 * `SqlClient.makeWithTransaction`.
 *
 * **When to use**
 *
 * Use when implementing a backend over an SDK with a
 * `runTransaction(callback)` API, such as the Admin or client SDK.
 *
 * **Details**
 *
 * Each attempt runs the body over that attempt's operations. What the
 * callback throws for a failed body decides whether the SDK retries it:
 *
 * - A {@link FirestoreError} with a `cause` throws that cause, so the SDK
 *   retries by its own rules, as for a read answered with `ABORTED`.
 * - Any other failure throws a marker without a `code`, which the SDK never
 *   retries, even when the body's own error carries a `code`.
 *
 * A failure the SDK returns without retrying comes back as the body's own
 * error, unwrapped. Anything else the SDK rejects with goes through
 * `onError`. Interrupting the transaction interrupts the body and waits for
 * the SDK to roll back.
 *
 * `Operations` is inferred from `operations`, so `context` receives a
 * transaction with `getDocs` exactly when `operations` has one.
 *
 * @see {@link make} for the service this hook is part of
 * @see {@link streamFromListener} for the matching helper for listeners
 *
 * @example Wrapping an SDK's runTransaction
 * ```ts
 * import { Effect } from "effect";
 * import { Firestore } from "@visiolab/effect-firebase/firestore";
 *
 * interface SdkTransaction {
 *   get(path: string): Promise<Firestore.DocumentData | undefined>;
 *   set(path: string, data: Firestore.DocumentData): void;
 *   update(path: string, data: Firestore.DocumentData): void;
 * }
 *
 * declare const db: {
 *   runTransaction<A>(callback: (tx: SdkTransaction) => Promise<A>, options?: object): Promise<A>;
 * };
 *
 * const fail = (cause: unknown) => new Firestore.FirestoreError({ message: "Transaction failed", cause });
 *
 * const runTransaction = Firestore.transactionFromCallback({
 *   run: (callback, options) => db.runTransaction(callback, options),
 *   operations: (tx: SdkTransaction) => ({
 *     getDoc: (path: string) =>
 *       Effect.tryPromise({ try: () => tx.get(path), catch: fail }).pipe(
 *         Effect.map((data) => ({ data })),
 *       ),
 *     setDoc: (path: string, data: Firestore.DocumentData) => Effect.sync(() => tx.set(path, data)),
 *     updateDoc: (path: string, data: Firestore.DocumentData) =>
 *       Effect.sync(() => tx.update(path, data)),
 *   }),
 *   onError: fail,
 * });
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const transactionFromCallback: <
  T,
  Operations extends TransactionOperations,
  TransactionServices = never,
>(
  options: TransactionFromCallbackOptions<T, Operations, TransactionServices>,
) => RunTransaction<Operations, TransactionServices> =
  internalTransactionFromCallback.transactionFromCallback;

/**
 * Options for {@link streamFromListener}: how to listen through an SDK
 * listener.
 *
 * `S` is the snapshot the SDK's listener receives, and `A` what the stream
 * emits for it.
 *
 * @stability unstable
 * @category options
 * @since 0.3.0
 */
export interface StreamFromListenerOptions<S, A> {
  /** Attaches a listener, and returns the function that detaches it. */
  readonly subscribe: (
    onNext: (snapshot: S) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  /** Builds the error the stream fails with from what the listener received. */
  readonly onError: (error: unknown) => FirestoreError;
  /** Maps a snapshot the listener received to what the stream emits. */
  readonly map: (snapshot: S) => Result.Result<A, FirestoreError>;
}

/**
 * Builds a listen hook's stream, such as {@link MakeOptions.streamDoc}, from
 * an SDK listener that returns a function to stop listening.
 *
 * **When to use**
 *
 * Use when implementing a backend over an SDK with an `onSnapshot`-style
 * listener.
 *
 * **Details**
 *
 * Each run of the stream attaches its own listener through `subscribe`, and
 * detaches it when the run stops. A reader that falls behind only sees the
 * latest snapshot.
 *
 * `map` turns each snapshot into what the stream emits. A snapshot it fails on
 * fails the stream instead of throwing into the SDK. An error the listener
 * receives fails the stream with what `onError` builds from it.
 *
 * @see {@link make} for the service this hook is part of
 * @see {@link transactionFromCallback} for the matching helper for transactions
 *
 * @example Wrapping an SDK listener
 * ```ts
 * import { Result } from "effect";
 * import { Firestore } from "@visiolab/effect-firebase/firestore";
 *
 * declare const sdk: {
 *   onSnapshot(
 *     path: string,
 *     onNext: (data: Firestore.DocumentData | undefined) => void,
 *     onError: (error: unknown) => void,
 *   ): () => void;
 * };
 *
 * const streamDoc = (path: string) =>
 *   Firestore.streamFromListener({
 *     subscribe: (onNext, onError) => sdk.onSnapshot(path, onNext, onError),
 *     onError: (cause) =>
 *       new Firestore.FirestoreError({ message: `Failed to listen to "${path}"`, cause }),
 *     map: (data) => Result.succeed({ data }),
 *   });
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const streamFromListener: <S, A>(
  options: StreamFromListenerOptions<S, A>,
) => Stream.Stream<A, FirestoreError> = internalStreamFromListener.streamFromListener;

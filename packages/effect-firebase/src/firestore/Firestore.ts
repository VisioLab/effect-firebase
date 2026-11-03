/**
 * Firestore for a single app.
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
   * Raised when a Firestore call fails.
   *
   * @stability unstable
   * @category errors
   * @since 0.2.0
   */
  FirestoreError,
  /**
   * Raised when a read of a {@link CollectionGroup.CollectionGroup} finds a
   * document under the group's collection id at a path none of its
   * collections define, such as a root-level `posts` when the group is made of
   * `users/{id}/posts`.
   *
   * It is apart from {@link FirestoreError} because the call to Firestore
   * succeeded: it is the data that contradicts the model. It is an error
   * rather than a defect because what is in the database decides whether it
   * happens, so correct code cannot rule it out. A caller who treats it as a
   * bug can `orDie` it.
   *
   * @stability unstable
   * @category errors
   * @since 0.2.0
   */
  UndefinedCollectionError,
} from "./internal/firestoreError.ts";

/**
 * What writing a whole document in `C` takes: the `create` shape of the
 * collection's model, which is the one `set` writes.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Create<C extends Collection.Any> = Collection.DocumentSchema<C>["create"]["Type"];

/**
 * The schema an update to a document in `C` is written through in `Mode`: the
 * collection's model's `update`, or its `updateUnchecked`.
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
 * What updating a document in `C` takes in `Mode`: the patch its model's
 * update schema is handed.
 *
 * @see {@link FirestoreModel.UpdateMode} for which patches each mode takes.
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
 * How to update a document.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface UpdateOptions<Mode extends FirestoreModel.UpdateMode = "checked"> {
  /**
   * Which patches the update takes. `checked` by default, which only takes
   * patches that leave any document readable.
   *
   * @see {@link FirestoreModel.UpdateMode}
   */
  readonly mode?: Mode | undefined;
}

/**
 * How to run a transaction.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface TransactionOptions {
  /**
   * How many times the body is run before a transaction that keeps running
   * into other writes gives up. The SDK's own default, 5, where left out.
   */
  readonly maxAttempts?: number | undefined;
}

/**
 * The transaction a {@link Firestore.runTransaction} body runs in.
 *
 * It reads and writes the way {@link Firestore} does, with the two rules a
 * Firestore transaction holds to: every read comes before every write, and
 * nothing written is there to read until the transaction commits - it is
 * queued, and only sent once the body is done.
 *
 * Asking for it in a helper is what says that helper belongs inside a
 * transaction, and so that it may run more than once.
 *
 * It reads documents one at a time and never a whole collection, since the
 * client SDK's transactions can only be asked for a document.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Transaction {
  /**
   * Reads one document, as {@link Firestore.getDoc} does, as part of the
   * transaction.
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
  ) => Effect.Effect<DocumentSnapshot.DocumentSnapshot<C>, FirestoreError>;

  /**
   * Queues a write of one whole document, as {@link Firestore.setDoc} writes
   * it.
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
   * Queues an update of one document, as {@link Firestore.updateDoc} writes
   * it.
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
 * Service key for the transaction a {@link Firestore.runTransaction} body runs
 * in.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const Transaction = Context.Service<Transaction>(
  "@visiolab/effect-firebase/firestore/Firestore/Transaction",
);

/**
 * The parameters a {@link With} read or listen takes for its options: none
 * where `Options` is `never`, so the portable reads take a reference alone, and
 * otherwise an optional `options`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type OptionsParameter<Options> = [Options] extends [never] ? [] : [options?: Options];

const TransactionServicesTypeId = firestore.TransactionServicesTypeId;

/**
 * Firestore for a single app, with what one backend adds to the portable
 * {@link Firestore}: the options its reads and listens take, the extra its
 * snapshots carry, and further services a transaction body finds the
 * transaction under.
 *
 * Reads are addressed by the references a {@link Collection.Collection} builds,
 * which is what ties a snapshot back to the model its data decodes through.
 *
 * - `ReadOptions` is what {@link With.getDoc} and {@link With.getDocs} take
 *   beyond a reference, such as the client's read source. None by default.
 * - `ListenOptions` is what {@link With.streamDoc} and {@link With.streamDocs}
 *   take beyond a reference. None by default.
 * - `Extra` is what a backend knows about a read beyond the portable snapshot,
 *   such as the client's `metadata`. It is on every document snapshot, on each
 *   document of a query snapshot, and on the query snapshot as a whole.
 * - `TransactionServices` are the services a {@link With.runTransaction} body
 *   finds the transaction under next to {@link Transaction}, such as a
 *   backend's own richer transaction. Give each its own nominal key, such as a
 *   class-style `Context.Service`: a key whose type is the transaction's own
 *   type, which extends {@link Transaction}, is dropped from what a body asks
 *   for by every Firestore, the portable one included, so nothing would check
 *   that it is provided. A Firestore that offers more of them may stand in for
 *   one that offers fewer, and not the other way round.
 *
 * The portable {@link Firestore} is this with every parameter at its default.
 * {@link make} returns it with what it inferred from its hooks, and a
 * backend's richer service extends it with its own arguments.
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
   * Holds `TransactionServices` for the compiler alone, and is never there at
   * runtime. TypeScript does not see through {@link With.runTransaction} that
   * a Firestore whose transactions offer none of `TransactionServices` cannot
   * stand in for one whose transactions do, so this tells it.
   */
  readonly [TransactionServicesTypeId]?:
    | ((transactionServices: TransactionServices) => void)
    | undefined;

  /**
   * Reads one document.
   *
   * A document that is not there is an answer rather than a failure, so this
   * hands back a snapshot either way and {@link DocumentSnapshot.isExisting}
   * is what tells the two apart.
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    ...options: OptionsParameter<ReadOptions>
  ) => Effect.Effect<DocumentSnapshot.DocumentSnapshot<C> & Extra, FirestoreError>;

  /**
   * Reads every document in one collection, or in a Collection Group.
   *
   * Named for what it hands back rather than for what it is given, since what
   * comes back is a {@link QuerySnapshot.QuerySnapshot} of documents and not a
   * collection. Its `docs` are every document the read found, each of one that
   * was there, which is why these are {@link DocumentSnapshot.Existing}. A
   * collection or group with nothing in it reads as a snapshot with no `docs`.
   *
   * Two overloads rather than one with a conditional error, so that reading a
   * collection says in its type that it fails with {@link FirestoreError}
   * alone.
   */
  readonly getDocs: {
    /** Reads every document in the collection at `ref`. */
    <C extends Collection.Any>(
      ref: Collection.CollectionReference<C>,
      ...options: OptionsParameter<ReadOptions>
    ): Effect.Effect<QuerySnapshot.QuerySnapshot<C, Extra> & Extra, FirestoreError>;
    /**
     * Reads every document of a {@link CollectionGroup.CollectionGroup}: every
     * document in each of its collections, under every parent.
     *
     * Each document is matched by its path to the one collection of the group
     * it lives in, and comes back addressed, with its ancestors, and decoded
     * as that collection's. A document under the group's collection id at a
     * path none of its collections define fails the read with an
     * {@link UndefinedCollectionError}.
     */
    <G extends CollectionGroup.Any>(
      group: G,
      ...options: OptionsParameter<ReadOptions>
    ): Effect.Effect<
      QuerySnapshot.QuerySnapshot<CollectionGroup.Members<G>, Extra> & Extra,
      FirestoreError | UndefinedCollectionError
    >;
  };

  /**
   * Listens to one document, emitting a snapshot of it each time it changes.
   *
   * The first snapshot is the document as it is when the listener attaches,
   * and one that is not there - or is deleted later - comes through as
   * {@link DocumentSnapshot.Missing}, as {@link getDoc} hands it back.
   *
   * Each snapshot is the whole document rather than what changed, so one that
   * is not pulled before the next arrives is dropped: whoever reads the stream
   * slower than the document changes sees its latest state, not every state it
   * passed through.
   *
   * The stream never ends on its own. Running it attaches a listener of its
   * own, which stays until the stream is interrupted, and fails the stream
   * when Firestore drops it.
   */
  readonly streamDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    ...options: OptionsParameter<ListenOptions>
  ) => Stream.Stream<DocumentSnapshot.DocumentSnapshot<C> & Extra, FirestoreError>;

  /**
   * Listens to every document in one collection, or in a Collection Group,
   * emitting all of them each time any of them changes.
   *
   * Each element is a {@link QuerySnapshot.QuerySnapshot} of every document
   * there at that moment, as {@link getDocs} would have handed it back, and as
   * with {@link streamDoc}, one that is not pulled before the next arrives is
   * dropped.
   *
   * Two overloads, as for {@link getDocs}, so that listening to a collection
   * says in its type that it fails with {@link FirestoreError} alone.
   */
  readonly streamDocs: {
    /** Listens to every document in the collection at `ref`. */
    <C extends Collection.Any>(
      ref: Collection.CollectionReference<C>,
      ...options: OptionsParameter<ListenOptions>
    ): Stream.Stream<QuerySnapshot.QuerySnapshot<C, Extra> & Extra, FirestoreError>;
    /**
     * Listens to every document of a {@link CollectionGroup.CollectionGroup},
     * emitting the whole group each time a document in any of its collections,
     * under any parent, changes.
     *
     * Each document is matched to its collection as {@link getDocs} does. The
     * stream fails with an {@link UndefinedCollectionError} at the first
     * snapshot holding a document at a path none of its collections define.
     */
    <G extends CollectionGroup.Any>(
      group: G,
      ...options: OptionsParameter<ListenOptions>
    ): Stream.Stream<
      QuerySnapshot.QuerySnapshot<CollectionGroup.Members<G>, Extra> & Extra,
      FirestoreError | UndefinedCollectionError
    >;
  };

  /**
   * Writes one document, replacing whatever was there.
   *
   * The whole document goes over, in the model's `create` shape, so fields
   * left out of it are gone rather than left alone - which a model makes less
   * of a trap than it sounds, since the shape it asks for is the whole one.
   *
   * Encoding it can fail on its own, and unlike reading there is nowhere to put
   * that off to: the contents have to become values Firestore stores before
   * there is anything to send.
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
   * Writes one document under an id Firestore picks, and hands back where it
   * put it.
   *
   * @see {@link setDoc} for writing to an id of your own.
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
   * Changes some fields of one document, leaving the rest as they are.
   *
   * The patch is written through the collection's model, in its `update`
   * shape - or its `updateUnchecked` one, where `mode` is `"unchecked"` - so
   * a struct it reaches into is written field by field at its paths, and one
   * handed `Patch.replace` is written whole.
   *
   * Unlike {@link setDoc}, this needs the document to be there: Firestore
   * refuses to update one that is not, and so does an empty patch.
   *
   * It asks for the services the model's `update` schema encodes through.
   * Both modes encode the same fields at the same paths, so they ask for the
   * same.
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
   * Runs `effect` in a transaction, with the {@link Transaction} it reads and
   * writes through provided.
   *
   * When another write gets in the way, the SDK throws the queued writes away
   * and runs `effect` again from the start, so anything it does besides
   * reading and writing through the transaction - an email, a write through
   * this service, another transaction - happens once per attempt. Those belong
   * after the transaction instead.
   *
   * A failure from Firestore is retried where the SDK would retry it: a
   * conflict, or an outage that passes, such as the database being unavailable
   * for a moment. That goes for any `FirestoreError` `effect` fails with,
   * whichever call raised it - one outside the transaction, or a transaction
   * run inside it, included - as it does for the SDK's own transactions.
   * `effect` failing in any other way - with an error of its own, a defect, or
   * a write that does not encode - rolls the transaction back and fails with
   * exactly what `effect` failed with.
   *
   * A transaction run inside another is its own: it commits when it is done,
   * whatever becomes of the one around it.
   *
   * Interrupting it interrupts `effect`, rolls the transaction back, and only
   * returns once the rollback is done.
   *
   * The transaction is also provided under each of `TransactionServices`, as
   * the same object, so `effect` asks its caller for none of them either.
   */
  readonly runTransaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: TransactionOptions,
  ) => Effect.Effect<A, E | FirestoreError, Exclude<R, Transaction | TransactionServices>>;
}

/**
 * Firestore for a single app: the portable one, which every backend offers.
 *
 * Reads are addressed by the references a {@link Collection.Collection} builds,
 * which is what ties a snapshot back to the model its data decodes through.
 *
 * @see {@link With} for each of its methods, and for what a backend's richer
 * service adds to them.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Firestore extends With {}

/**
 * Service key for Firestore.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const Firestore = Context.Service<Firestore>(
  "@visiolab/effect-firebase/firestore/Firestore",
);

/**
 * What a read of many documents reads from, as a {@link MakeOptions} hook is
 * handed it: one collection, by its path, or every collection with one
 * collection id, wherever it sits.
 *
 * {@link make} builds it from the collection reference or
 * {@link CollectionGroup.CollectionGroup} the caller read, and keeps the group
 * itself, so a hook only builds its backend's query from it.
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
 * A document's data as a {@link MakeOptions} hook reads and writes it: a map of
 * Firestore Values.
 *
 * Written, it is either a whole document, for a create, or a map from field
 * paths, such as `address.city`, to the values written there, for an update.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type DocumentData = { readonly [field: string]: FirestoreValue };

/**
 * The `extra` of what a {@link MakeOptions} hook read: what the backend knows
 * about the read beyond the portable snapshot. Each of its fields is put on
 * the snapshot, and shown when it prints, as {@link DocumentSnapshot.make}
 * does with an `extra`. Its fields must not be named like the snapshot's own.
 *
 * It must be there where `Extra` has required fields, so that a snapshot never
 * claims an extra its read did not hand back. It may be left out where every
 * field is optional. Where `Extra` has no fields at all it is never there, so
 * that a read handing back an extra its snapshots do not carry does not
 * compile either.
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
 * What a {@link MakeOptions} hook read for one document, with the `Extra` the
 * backend knows about it, none by default.
 *
 * @see {@link ReadExtra} for its `extra`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type DocumentRead<Extra extends object = {}> = {
  /**
   * The document's data, or `undefined` when it is not there. Data that is
   * not made of Firestore Values fails the read with a {@link FirestoreError}.
   */
  readonly data: DocumentData | undefined;
} & ReadExtra<Extra>;

/**
 * What a {@link MakeOptions} hook read for one document of many: always one
 * that is there, with the `Extra` the backend knows about it, none by default.
 *
 * @see {@link ReadExtra} for its `extra`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type QueryDocumentRead<Extra extends object = {}> = {
  /**
   * The document's full path, such as `users/alice/posts/hello`. It is what
   * matches a document of a Collection Group back to the collection it lives
   * in.
   */
  readonly path: string;
  /**
   * The document's data. Data that is not made of Firestore Values fails the
   * read with a {@link FirestoreError}.
   */
  readonly data: DocumentData;
} & ReadExtra<Extra>;

/**
 * What a {@link MakeOptions} hook read for many documents, with the `Extra` the
 * backend knows about each of them and about the read as a whole, none by
 * default. The read's own `extra` is put on the
 * {@link QuerySnapshot.QuerySnapshot} as {@link QuerySnapshot.make} does with
 * an `extra`.
 *
 * @see {@link ReadExtra} for its `extra`.
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
 * The reads and writes of one attempt at a transaction, which the
 * {@link MakeOptions.runTransaction} hook hands the body: {@link make} builds
 * the {@link Transaction} the body reads and writes through from them.
 *
 * Writes into a transaction are queued until it commits, so a backend may
 * answer them straight away.
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
  /** Queues an update of the document at `path`, `data` keyed by field path. */
  readonly updateDoc: (path: string, data: DocumentData) => Effect.Effect<void, FirestoreError>;
  /**
   * Reads many documents as part of the transaction, for a backend that can.
   * Where it is given, the transaction {@link make} builds has a `getDocs` that
   * reads through it as {@link Firestore.getDocs} does, for
   * {@link RunTransaction.context} to offer under a tag of its own.
   */
  readonly getDocs?:
    | ((selector: CollectionSelector) => Effect.Effect<QueryRead, FirestoreError>)
    | undefined;
}

/**
 * The transaction {@link make} builds from `Operations`, as
 * {@link RunTransaction.context} is handed it: the {@link Transaction} a body
 * reads and writes through, with a `getDocs` that reads as
 * {@link Firestore.getDocs} does exactly where `Operations` has a `getDocs`.
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
 * transaction, over each attempt's `Operations`, and the further services a
 * body finds the transaction under.
 *
 * `Operations` is what the backend can do in a transaction, which decides
 * whether the transaction {@link make} builds can read many documents.
 * {@link transactionFromCallback} builds one for an SDK that runs a
 * transaction as a callback.
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
   * operations, and fails with what the body failed with or with a
   * {@link FirestoreError} of its own. Backs {@link Firestore.runTransaction}.
   *
   * The body needs nothing from context: everything the caller's effect needs,
   * the transaction's span included, is already provided to it, so it may run
   * on a runtime of its own, such as inside an SDK's callback.
   */
  readonly run: <A, E>(
    body: (operations: Operations) => Effect.Effect<A, E>,
    options: TransactionHookOptions,
  ) => Effect.Effect<A, E | FirestoreError>;

  /**
   * Further services a transaction body finds the transaction under, next to
   * {@link Transaction}, such as a backend's own richer transaction. It is
   * handed the transaction {@link make} built for the attempt, and the
   * services hold that same object, so a body reads and writes through one
   * transaction whichever tag it asks for.
   */
  readonly context?:
    | ((transaction: BuiltTransaction<Operations>) => Context.Context<TransactionServices>)
    | undefined;
}

/**
 * The options the {@link MakeOptions.runTransaction} hook is handed.
 *
 * `maxAttempts` is only there where the caller set it, so a backend that
 * passes these on as they are keeps its own default otherwise. The client
 * SDK, for one, turns retrying off for a `maxAttempts` that is there but
 * `undefined`.
 *
 * @stability unstable
 * @category options
 * @since 0.3.0
 */
export interface TransactionHookOptions {
  readonly maxAttempts?: number;
}

/**
 * The hooks {@link make} builds a {@link Firestore} from.
 *
 * Each speaks in Firestore's own terms - document paths, a
 * {@link CollectionSelector} and {@link DocumentData} - and maps between its
 * backend's values and Firestore Values. Each returns an `Effect`, or a
 * `Stream` for listening, that fails with a {@link FirestoreError} it builds
 * from what its backend raised, with the backend's `code` and `cause`:
 * {@link make} hands that error on as it is.
 *
 * `ReadOptions` and `ListenOptions` are what a backend's richer service takes
 * on top of the portable reads and listens, such as the client's read source.
 * Whatever the caller passed is handed to the hook as it is, or `undefined`.
 *
 * `Extra` is what the read and listen hooks know about each read beyond the
 * portable snapshot, such as the client's `metadata`: the same for all four
 * of them, for one document, for each document of many, and for a read of
 * many as a whole. It is inferred from what `getDoc` hands back, and the other
 * three must hand back the same, so a hook that hands back none, or another,
 * does not compile. Nor does one that hands back an extra where `getDoc`
 * hands back none, as an extra with no fields is never there.
 *
 * `Operations` and `TransactionServices` are those of the
 * {@link RunTransaction} hook.
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
  /** Reads the document at `path`. Backs {@link Firestore.getDoc}. */
  readonly getDoc: (
    path: string,
    options: ReadOptions | undefined,
  ) => Effect.Effect<DocumentRead<Extra>, FirestoreError>;

  /**
   * Reads every document `selector` names. Backs {@link Firestore.getDocs},
   * which matches each document of a Collection Group to its collection.
   */
  readonly getDocs: (
    selector: CollectionSelector,
    options: ReadOptions | undefined,
  ) => Effect.Effect<QueryRead<NoInfer<Extra>>, FirestoreError>;

  /**
   * Writes the whole document at `path`, replacing whatever was there. Backs
   * {@link Firestore.setDoc}.
   */
  readonly setDoc: (path: string, data: DocumentData) => Effect.Effect<void, FirestoreError>;

  /**
   * Updates the document at `path`, `data` keyed by field path. Backs
   * {@link Firestore.updateDoc}.
   */
  readonly updateDoc: (path: string, data: DocumentData) => Effect.Effect<void, FirestoreError>;

  /**
   * Writes a document under a new id in the collection at `path`, and hands
   * back that id. Backs {@link Firestore.addDoc}.
   */
  readonly addDoc: (path: string, data: DocumentData) => Effect.Effect<string, FirestoreError>;

  /**
   * Listens to the document at `path`, emitting what it read each time it
   * changes. Backs {@link Firestore.streamDoc}.
   *
   * Running the stream should attach a listener of its own, and stopping it
   * detach that listener, keeping only the latest read for a reader that falls
   * behind.
   */
  readonly streamDoc: (
    path: string,
    options: ListenOptions | undefined,
  ) => Stream.Stream<DocumentRead<NoInfer<Extra>>, FirestoreError>;

  /**
   * Listens to every document `selector` names, as
   * {@link MakeOptions.streamDoc} listens to one. Backs
   * {@link Firestore.streamDocs}.
   */
  readonly streamDocs: (
    selector: CollectionSelector,
    options: ListenOptions | undefined,
  ) => Stream.Stream<QueryRead<NoInfer<Extra>>, FirestoreError>;

  /**
   * Runs a transaction, and offers it under further tags. Backs
   * {@link Firestore.runTransaction}.
   *
   * @see {@link RunTransaction}
   */
  readonly runTransaction: RunTransaction<Operations, TransactionServices>;
}

/**
 * Builds a {@link Firestore} from the hooks of one backend.
 *
 * The hooks only move Firestore Values to and from the backend. Everything
 * above them happens here, the same for every backend: encoding writes
 * through the collection's model, in its `create` shape or its update shape
 * for the mode asked for; decoding reads into snapshots, with any extra the
 * hooks handed back; matching each document of a Collection Group to its
 * collection; spans; and providing the {@link Transaction} a transaction body
 * runs in.
 *
 * What it returns is inferred from the hooks: the {@link With} that takes the
 * options its read and listen hooks are handed, carries the extra they hand
 * back, and provides a transaction body with the services the transaction
 * hook's `context` offers. Hooks with none of those build something assignable
 * to the portable {@link Firestore}. Read and listen hooks that hand back
 * different extras do not compile.
 *
 * A backend's richer service widens what this returns, as an SDK package's
 * does with its `instance`.
 *
 * ```ts
 * const firestore = Firestore.make({
 *   getDoc: (path) => Effect.succeed({ data: documents.get(path) }),
 *   // ...and the other hooks.
 * });
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
 * How {@link transactionFromCallback} drives a backend whose SDK runs a
 * transaction as a callback, and retries it.
 *
 * `T` is the SDK's own transaction object, handed to each attempt. It is
 * inferred from `operations` alone, so annotate its parameter, as in
 * `operations: (tx: Admin.Transaction) => ...`. `Operations` and
 * `TransactionServices` are those of the {@link RunTransaction} hook it builds.
 *
 * They are inferred wherever `run` and `operations` stand in the object.
 * `context` may stand anywhere too, except before an `operations` that builds
 * its object inline with unannotated functions, such as `getDoc: (path) =>
 * ...`: TypeScript types `context`'s transaction as soon as it reaches it, and
 * only learns `Operations` from such an `operations` once it reaches that, so
 * put `context` after it.
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
   * `options` are the hook's own, handed on as they are, so `maxAttempts` is
   * only there where the caller set it.
   *
   * The callback takes whatever the SDK hands it, and hands it to
   * `operations` as the SDK's transaction. It is not typed by `T`: TypeScript
   * would settle `T` when it typed `run`, before it had seen `operations`
   * wherever `run` came first.
   */
  readonly run: <A>(
    callback: (transaction: unknown) => Promise<A>,
    options: TransactionHookOptions,
  ) => Promise<A>;
  /** The reads and writes of one attempt, over the SDK's transaction. */
  readonly operations: (transaction: T) => Operations;
  /**
   * The error for what `run` rejected with that has nothing to do with the
   * body, such as a failed commit, with the SDK's `code` and `cause`.
   */
  readonly onError: (cause: unknown) => FirestoreError;
  /**
   * Further services a body finds the transaction under.
   *
   * @see {@link RunTransaction.context}
   */
  readonly context?: RunTransaction<Operations, TransactionServices>["context"];
}

/**
 * Builds the {@link MakeOptions.runTransaction} hook for an SDK that runs a
 * callback in a transaction and retries it, the counterpart of Effect's
 * `SqlClient.makeWithTransaction`.
 *
 * Each attempt runs the body over that attempt's operations, and what the
 * callback throws for a failed body decides whether the SDK retries it:
 *
 * - A {@link FirestoreError} with a `cause` throws that cause, so the SDK
 *   retries by its own rules, as for a read answered with ABORTED.
 * - Any other failure throws a marker without a `code`, which the SDK never
 *   retries, even for a body's own error that carries one.
 *
 * A failure the SDK hands back without retrying it comes back as the body's
 * own, unwrapped. Anything else the SDK rejects with goes through `onError`.
 * Interrupting the transaction interrupts the body, and waits for the SDK to
 * roll back.
 *
 * `Operations` is inferred from `operations`, so `context` is handed a
 * transaction with a `getDocs` exactly where `operations` has one.
 *
 * ```ts
 * const runTransaction = Firestore.transactionFromCallback({
 *   run: (callback, options) => db.runTransaction(callback, options),
 *   operations: (tx: Sdk.Transaction) => operationsOver(tx),
 *   onError: (cause) =>
 *     new Firestore.FirestoreError({ message: "Failed to run a transaction", cause }),
 *   context: (transaction) => Context.make(RichTransaction, transaction),
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
 * How {@link streamFromListener} listens through an SDK listener.
 *
 * `S` is the snapshot the SDK's listener hears, and `A` what the stream emits
 * for it.
 *
 * @stability unstable
 * @category options
 * @since 0.3.0
 */
export interface StreamFromListenerOptions<S, A> {
  /** Attaches a listener, handing back the function that detaches it. */
  readonly subscribe: (
    onNext: (snapshot: S) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  /** Builds the error the stream fails with from what the listener heard. */
  readonly onError: (error: unknown) => FirestoreError;
  /** Maps a snapshot the listener heard to what the stream emits. */
  readonly map: (snapshot: S) => Result.Result<A, FirestoreError>;
}

/**
 * Builds the stream of a listen hook, such as {@link MakeOptions.streamDoc},
 * from an SDK listener that hands back a function to stop listening.
 *
 * Each run of the stream attaches a listener of its own through `subscribe`,
 * and detaches it when the run stops. A reader that falls behind sees only the
 * latest snapshot. `map` turns each snapshot the listener hears into what the
 * stream emits, and a snapshot it fails on fails the stream rather than
 * throwing back into the SDK. An error the listener hears fails the stream
 * with what `onError` builds from it.
 *
 * ```ts
 * streamDoc: (path) =>
 *   Firestore.streamFromListener({
 *     subscribe: (onNext, onError) => sdk.doc(path).onSnapshot(onNext, onError),
 *     onError: (cause) => new Firestore.FirestoreError({ message: `Failed to listen to "${path}"`, cause }),
 *     map: (snapshot) => Result.map(readDocument(path, snapshot.data()), (data) => ({ data })),
 *   }),
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const streamFromListener: <S, A>(
  options: StreamFromListenerOptions<S, A>,
) => Stream.Stream<A, FirestoreError> = internalStreamFromListener.streamFromListener;

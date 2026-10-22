/**
 * Firestore for a single app.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Context, Schema } from "effect";
import type { Effect, Stream } from "effect";
import type * as Collection from "./Collection.ts";
import type * as DocumentSnapshot from "./DocumentSnapshot.ts";
import type { FirestoreEncoder } from "./FirestoreEncoder.ts";
import type * as FirestoreModel from "./FirestoreModel.ts";

/**
 * Raised when a Firestore call fails.
 *
 * @stability unstable
 * @category errors
 * @since 0.2.0
 */
export class FirestoreError extends Schema.TaggedError<FirestoreError>()("FirestoreError", {
  message: Schema.String,
  /**
   * The code the SDK reported, where it reported one it can be named by.
   *
   * The client SDK names every failure, such as `permission-denied`. The Admin
   * SDK answers for Firestore over gRPC, which numbers its statuses rather than
   * naming them, so there this is often absent even where something went wrong
   * at the database.
   */
  code: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

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
 * What writing a document in `C` asks for, beyond the service itself.
 *
 * Encoding a document goes through a {@link FirestoreEncoder}, and an
 * implementation has one of its own - it is the whole reason it can write the
 * values its SDK stores - so that one is answered for here rather than by the
 * caller. Anything else a document schema encodes through is not, and stays.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type WriteServices<C extends Collection.Any> = Exclude<
  Collection.DocumentSchema<C>["create"]["EncodingServices"],
  FirestoreEncoder
>;

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
 * What updating a document in `C` asks for, beyond the service itself.
 *
 * Not {@link WriteServices}: an update encodes the keys of each Record it
 * writes into as well, and those may take services `set` never asks for. Both
 * modes encode the same fields at the same paths, so they ask for the same.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdateServices<C extends Collection.Any> = Exclude<
  Collection.DocumentSchema<C>["update"]["EncodingServices"],
  FirestoreEncoder
>;

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
  ) => Effect.Effect<void, FirestoreError | Schema.SchemaError, WriteServices<C>>;

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
  ) => Effect.Effect<void, FirestoreError | Schema.SchemaError, UpdateServices<C>>;
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
 * Firestore for a single app.
 *
 * Reads are addressed by the references a {@link Collection.Collection} builds,
 * which is what ties a snapshot back to the model its data decodes through.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Firestore {
  /**
   * Reads one document.
   *
   * A document that is not there is an answer rather than a failure, so this
   * hands back a snapshot either way and {@link DocumentSnapshot.isExisting}
   * is what tells the two apart.
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
  ) => Effect.Effect<DocumentSnapshot.DocumentSnapshot<C>, FirestoreError>;

  /**
   * Reads every document in one collection.
   *
   * Named for what it hands back rather than for what it is given, since what
   * comes back is a list of snapshots and not a collection. Every one of them
   * is of a document that was there, which is why these are
   * {@link DocumentSnapshot.Existing}.
   */
  readonly getDocs: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
  ) => Effect.Effect<ReadonlyArray<DocumentSnapshot.Existing<C>>, FirestoreError>;

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
  ) => Stream.Stream<DocumentSnapshot.DocumentSnapshot<C>, FirestoreError>;

  /**
   * Listens to every document in one collection, emitting all of them each
   * time any of them changes.
   *
   * Each element is what {@link getDocs} would have handed back at that
   * moment, and as with {@link streamDoc}, one that is not pulled before the
   * next arrives is dropped.
   */
  readonly streamDocs: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
  ) => Stream.Stream<ReadonlyArray<DocumentSnapshot.Existing<C>>, FirestoreError>;

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
  ) => Effect.Effect<void, FirestoreError | Schema.SchemaError, WriteServices<C>>;

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
    WriteServices<C>
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
   */
  readonly updateDoc: <
    C extends Collection.Any,
    Mode extends FirestoreModel.UpdateMode = "checked",
  >(
    ref: Collection.DocumentReference<C>,
    data: Update<C, Mode>,
    options?: UpdateOptions<Mode>,
  ) => Effect.Effect<void, FirestoreError | Schema.SchemaError, UpdateServices<C>>;

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
   */
  readonly runTransaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: TransactionOptions,
  ) => Effect.Effect<A, E | FirestoreError, Exclude<R, Transaction>>;
}

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

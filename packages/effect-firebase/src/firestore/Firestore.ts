/**
 * Firestore for a single app.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type * as Collection from "./Collection.ts";
import type * as DocumentSnapshot from "./DocumentSnapshot.ts";
import type { FirestoreEncoder } from "./FirestoreEncoder.ts";

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
   * The Admin SDK answers for Firestore over gRPC, which numbers its statuses
   * rather than naming them, so this is often absent even where something went
   * wrong at the database.
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

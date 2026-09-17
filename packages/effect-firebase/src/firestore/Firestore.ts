/**
 * Firestore for a single app.
 *
 * @since 0.0.0
 */
import { Context, Effect, Schema } from "effect";
import type * as Collection from "./Collection.ts";
import type { FirestoreEncoder } from "./FirestoreEncoder.ts";
import type * as Snapshot from "./Snapshot.ts";

/**
 * Raised when a Firestore call fails.
 *
 * @category errors
 * @since 0.0.0
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
 * What writing a document in `C` asks for, beyond the service itself.
 *
 * Encoding a document goes through a {@link FirestoreEncoder}, and an
 * implementation has one of its own - it is the whole reason it can write the
 * values its SDK stores - so that one is answered for here rather than by the
 * caller. Anything else a document schema encodes through is not, and stays.
 *
 * @category models
 * @since 0.0.0
 */
export type WriteServices<C extends Collection.Any> = Exclude<
  Collection.DocumentSchema<C>["EncodingServices"],
  FirestoreEncoder
>;

/**
 * Firestore for a single app.
 *
 * Reads are addressed by the references a {@link Collection.Collection} builds,
 * which is what ties a reading back to the schema its contents decode through.
 *
 * @category models
 * @since 0.0.0
 */
export interface Firestore {
  /**
   * Reads one document.
   *
   * A document that is not there is an answer rather than a failure, so this
   * hands back a reading either way and {@link Snapshot.exists} is what tells
   * the two apart.
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
  ) => Effect.Effect<Snapshot.DocumentSnapshot<C>, FirestoreError>;

  /**
   * Reads every document in one collection.
   *
   * Named for what it hands back rather than for what it is given, since what
   * comes back is a list of readings and not a collection. Every one of them is
   * of a document that was there, which is why these are
   * {@link Snapshot.QueryDocumentSnapshot}s.
   */
  readonly getDocs: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
  ) => Effect.Effect<ReadonlyArray<Snapshot.QueryDocumentSnapshot<C>>, FirestoreError>;

  /**
   * Writes one document, replacing whatever was there.
   *
   * The whole document goes over, so fields left out of it are gone rather than
   * left alone - which a schema makes less of a trap than it sounds, since the
   * document it asks for is the whole one.
   *
   * Encoding it can fail on its own, and unlike reading there is nowhere to put
   * that off to: the contents have to become values Firestore stores before
   * there is anything to send.
   */
  readonly setDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    data: Collection.Document<C>,
  ) => Effect.Effect<void, FirestoreError | Schema.SchemaError, WriteServices<C>>;

  /**
   * Writes one document under an id Firestore picks, and hands back where it
   * put it.
   *
   * @see {@link setDoc} for writing to an id of your own.
   */
  readonly addDoc: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
    data: Collection.Document<C>,
  ) => Effect.Effect<
    Collection.DocumentReference<C>,
    FirestoreError | Schema.SchemaError,
    WriteServices<C>
  >;
}

/**
 * Service key for Firestore.
 *
 * @category services
 * @since 0.0.0
 */
export const Firestore = Context.Service<Firestore>(
  "@visiolab/effect-firebase/firestore/Firestore",
);

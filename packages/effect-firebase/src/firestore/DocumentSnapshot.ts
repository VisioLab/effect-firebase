/**
 * What a read of one document returns.
 *
 * A document's id is in its path, not in its data, so the data alone cannot
 * say which document it is. A snapshot pairs the two: the reference the
 * document was read at, and what it held, or that it was not there.
 *
 * The data is kept as the SDK read it, and only decoded through the
 * collection's model when you ask for it. Checking whether the document is
 * there, or which one it is, never decodes, and a document that does not match
 * the model only fails the code that reads its data.
 *
 * @example Reading a document that may be missing
 * ```ts
 * import {
 *   Collection,
 *   DocumentSnapshot,
 *   Firestore,
 *   FirestoreModel,
 * } from "@visiolab/effect-firebase/firestore";
 * import { Effect, Option, Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   const snapshot = yield* firestore.getDoc(Users.doc(Users.id.make("alice")));
 *   if (DocumentSnapshot.isMissing(snapshot)) return Option.none();
 *   const user = yield* snapshot.data;
 *   return Option.some(user.name);
 * });
 * ```
 *
 * @see {@link QuerySnapshot} for what a read of many documents returns
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Effect, Inspectable, Schema } from "effect";
import type * as Collection from "./Collection.ts";
import * as documentSnapshot from "./internal/documentSnapshot.ts";

const TypeId = documentSnapshot.TypeId;

/**
 * What a document in `C` decodes into: the `read` variant of its model.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Data<C extends Collection.Any> = Collection.DocumentSchema<C>["Type"];

/**
 * The services decoding a document in `C` requires, which
 * {@link Existing.data} asks for.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type DecodingServices<C extends Collection.Any> =
  Collection.DocumentSchema<C>["DecodingServices"];

/**
 * A snapshot of a document that was there when it was read.
 *
 * **Details**
 *
 * Its tag is `"Existing"`. {@link Existing.data} decodes what it held through
 * the collection's model. Every document of a {@link QuerySnapshot.QuerySnapshot}
 * is one of these.
 *
 * @see {@link Missing} for a document that was not there
 * @see {@link isExisting} for narrowing a {@link DocumentSnapshot} to this
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Existing<C extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  readonly _tag: "Existing";
  /** The reference the document was read at. */
  readonly ref: Collection.DocumentReference<C>;
  /** The document's own id, the same as `ref.id`. */
  readonly id: Collection.Id<C>;
  /**
   * The document's data as the SDK read it, before the collection's model has
   * decoded it.
   *
   * **Details**
   *
   * It is what the document held at the time of the read. Do not change it: a
   * snapshot is a record of that read, not a handle on the document.
   *
   * @see {@link Existing.data} for the decoded data
   */
  readonly raw: unknown;
  /**
   * Decodes {@link Existing.raw} through the collection's model.
   *
   * **Details**
   *
   * Nothing is decoded until this runs, and it decodes again on each run.
   * Fails with a `Schema.SchemaError` when the data does not match the model.
   */
  readonly data: Effect.Effect<Data<C>, Schema.SchemaError, DecodingServices<C>>;
}

/**
 * A snapshot of a document that was not there when it was read.
 *
 * **Details**
 *
 * Its tag is `"Missing"`. It holds no data, so a missing document is never
 * confused with one that failed to decode.
 *
 * @see {@link Existing} for a document that was there
 * @see {@link isMissing} for narrowing a {@link DocumentSnapshot} to this
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Missing<C extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  readonly _tag: "Missing";
  /** The reference the document was read at. */
  readonly ref: Collection.DocumentReference<C>;
  /** The document's own id, the same as `ref.id`. */
  readonly id: Collection.Id<C>;
}

/**
 * A document in `C` as a read found it: {@link Existing} or {@link Missing}.
 *
 * **Details**
 *
 * {@link Firestore.With.getDoc} and {@link Firestore.With.streamDoc} return
 * one. A missing document is a result, not a failure. Tell the two apart with
 * {@link isExisting} or {@link isMissing}, or by `_tag`.
 *
 * @see {@link QuerySnapshot.QuerySnapshot} for the result of a read of many documents
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type DocumentSnapshot<C extends Collection.Any> = Existing<C> | Missing<C>;

/**
 * Checks whether a value is a {@link DocumentSnapshot}, existing or missing.
 *
 * @see {@link isExisting} and {@link isMissing} for telling the two kinds apart
 * @see {@link QuerySnapshot.isQuerySnapshot} for a snapshot of many documents
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isDocumentSnapshot: (u: unknown) => u is DocumentSnapshot<Collection.Any> =
  documentSnapshot.isDocumentSnapshot;

/**
 * Narrows a {@link DocumentSnapshot} to an {@link Existing} one.
 *
 * **When to use**
 *
 * Use after {@link Firestore.With.getDoc} to get at the data of a document
 * that was there.
 *
 * @see {@link isMissing} for the opposite check
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isExisting: <C extends Collection.Any>(
  self: DocumentSnapshot<C>,
) => self is Existing<C> = documentSnapshot.isExisting;

/**
 * Narrows a {@link DocumentSnapshot} to a {@link Missing} one.
 *
 * **When to use**
 *
 * Use after {@link Firestore.With.getDoc} to handle a document that was not
 * there, such as returning early.
 *
 * @see {@link isExisting} for the opposite check
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isMissing: <C extends Collection.Any>(
  self: DocumentSnapshot<C>,
) => self is Missing<C> = documentSnapshot.isMissing;

/**
 * Builds a snapshot of the document at `ref` from what an SDK's
 * `snapshot.data()` returned: {@link Missing} for `undefined`, and
 * {@link Existing} otherwise.
 *
 * **When to use**
 *
 * Use when implementing a backend or a test double, to turn an SDK snapshot
 * into a portable one. Application code gets snapshots from
 * {@link Firestore.With.getDoc} instead.
 *
 * **Details**
 *
 * Both SDKs return `undefined` from `data()` for a document that is not there.
 * An SDK that knows more about the read, such as the client's `metadata`,
 * passes it as `extra`: each of its fields is put on the snapshot and shown
 * when it prints. Its fields must not have the same names as the snapshot's
 * own.
 *
 * @example Building a snapshot with extra fields
 * ```ts
 * import {
 *   Collection,
 *   DocumentSnapshot,
 *   FirestoreModel,
 * } from "@visiolab/effect-firebase/firestore";
 * import { Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 * const ref = Users.doc(Users.id.make("alice"));
 *
 * const snapshot = DocumentSnapshot.make(ref, { name: "Alice" }, {
 *   metadata: { fromCache: false, hasPendingWrites: false },
 * });
 *
 * snapshot.metadata.fromCache; // false
 * ```
 *
 * @see {@link existing} for a document known to be there
 * @see {@link missing} for a document known not to be there
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: {
  <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    data: unknown,
  ): DocumentSnapshot<C>;
  <C extends Collection.Any, E extends object>(
    ref: Collection.DocumentReference<C>,
    data: unknown,
    extra: E,
  ): DocumentSnapshot<C> & E;
} = documentSnapshot.make;

/**
 * Builds an {@link Existing} snapshot of the document at `ref`, with the
 * fields of `extra` when given, as {@link make} adds them.
 *
 * **When to use**
 *
 * Use in a backend for a document known to be there, such as each document a
 * query returned.
 *
 * @see {@link make} for a document that may or may not be there
 * @see {@link missing} for a document known not to be there
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const existing: {
  <C extends Collection.Any>(ref: Collection.DocumentReference<C>, data: unknown): Existing<C>;
  <C extends Collection.Any, E extends object>(
    ref: Collection.DocumentReference<C>,
    data: unknown,
    extra: E,
  ): Existing<C> & E;
} = documentSnapshot.existing;

/**
 * Builds a {@link Missing} snapshot of the document at `ref`, with the fields
 * of `extra` when given, as {@link make} adds them.
 *
 * **When to use**
 *
 * Use in a backend or a test double for a document known not to be there.
 *
 * @see {@link make} for a document that may or may not be there
 * @see {@link existing} for a document known to be there
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const missing: {
  <C extends Collection.Any>(ref: Collection.DocumentReference<C>): Missing<C>;
  <C extends Collection.Any, E extends object>(
    ref: Collection.DocumentReference<C>,
    extra: E,
  ): Missing<C> & E;
} = documentSnapshot.missing;

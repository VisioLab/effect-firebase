/**
 * What a read hands back.
 *
 * A document's id lives in its path rather than in its data, so the data alone
 * cannot say which document it is. A snapshot pairs the two: the reference a
 * document was read at, and what it held - or that it was not there at all.
 *
 * What it held is kept as the SDK read it, and only decoded through the
 * collection's schema once it is asked for. Telling whether a document is
 * there, or which one it is, never touches the schema, and a document that does
 * not match it fails only the caller who reads its data.
 *
 * ```ts
 * import { DocumentSnapshot } from "@visiolab/effect-firebase/firestore";
 *
 * const snapshot = DocumentSnapshot.make(Users.doc(alice), sdkSnapshot.data());
 *
 * if (DocumentSnapshot.isExisting(snapshot)) {
 *   const user = yield* snapshot.data;
 * }
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Effect, Inspectable, Schema } from "effect";
import type * as Collection from "./Collection.ts";
import * as documentSnapshot from "./internal/documentSnapshot.ts";

const TypeId = documentSnapshot.TypeId;

/**
 * What a document in `C` decodes into.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Data<C extends Collection.Any> = Collection.DocumentSchema<C>["Type"];

/**
 * What decoding a document in `C` asks for.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type DecodingServices<C extends Collection.Any> =
  Collection.DocumentSchema<C>["DecodingServices"];

/**
 * A document that was there when it was read.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Existing<C extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  readonly _tag: "Existing";
  /** Where it was read. */
  readonly ref: Collection.DocumentReference<C>;
  /** Its own id, which is the one `ref` carries. */
  readonly id: Collection.Id<C>;
  /**
   * What the SDK read, before the collection's schema has seen it.
   *
   * It is what the document held at the time of the read, and is not meant to
   * change after: a snapshot is a record of that read, not a handle on the
   * document.
   */
  readonly raw: unknown;
  /**
   * Decodes {@link Existing.raw} through the collection's schema.
   *
   * Nothing is decoded until this is run, and it decodes afresh each time, so
   * a document that does not match the schema fails only where its data is
   * read.
   */
  readonly data: Effect.Effect<Data<C>, Schema.SchemaError, DecodingServices<C>>;
}

/**
 * A document that was not there when it was read.
 *
 * It holds no data, so there is nothing to decode: a document that is missing
 * is told apart by its tag, and never reads as one that failed to decode.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Missing<C extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  readonly _tag: "Missing";
  /** Where it was read. */
  readonly ref: Collection.DocumentReference<C>;
  /** Its own id, which is the one `ref` carries. */
  readonly id: Collection.Id<C>;
}

/**
 * A document in `C`, as a read found it.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type DocumentSnapshot<C extends Collection.Any> = Existing<C> | Missing<C>;

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isDocumentSnapshot: (u: unknown) => u is DocumentSnapshot<Collection.Any> =
  documentSnapshot.isDocumentSnapshot;

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isExisting: <C extends Collection.Any>(
  self: DocumentSnapshot<C>,
) => self is Existing<C> = documentSnapshot.isExisting;

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isMissing: <C extends Collection.Any>(
  self: DocumentSnapshot<C>,
) => self is Missing<C> = documentSnapshot.isMissing;

/**
 * A snapshot of the document at `ref`, from what an SDK's `snapshot.data()`
 * returned.
 *
 * Both SDKs hand back `undefined` for a document that is not there, and data
 * for one that is, so this is all an SDK needs to turn its own snapshot into
 * one of these.
 *
 * An SDK that knows more about the read than the portable snapshot holds, such
 * as the client's `metadata`, passes it as `extra`: each of its fields is put
 * on the snapshot, and shown when it prints. Its fields must not be named like
 * the snapshot's own.
 *
 * ```ts
 * const snapshot = DocumentSnapshot.make(Users.doc(alice), sdkSnapshot.data(), {
 *   metadata: { fromCache: false, hasPendingWrites: false },
 * });
 *
 * snapshot.metadata.fromCache; // false
 * ```
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
 * A snapshot of a document known to be there, such as one a query returned,
 * with the fields of `extra`, when it is given, as for {@link make}.
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
 * A snapshot of a document known not to be there, with the fields of `extra`,
 * when it is given, as for {@link make}.
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

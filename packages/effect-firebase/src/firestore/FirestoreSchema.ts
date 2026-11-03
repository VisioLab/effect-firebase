/**
 * Schemas for the Firestore Values that Effect has no schema for.
 *
 * - Values: {@link Timestamp}, {@link GeoPoint}, {@link DocumentPath}, and
 *   typed references with {@link DocumentReference}.
 * - Sentinels, for writes only: {@link ServerTimestamp}, {@link Increment},
 *   {@link DeleteField}, {@link ArrayUnion} and {@link ArrayRemove}.
 * - A field's write side, combining a value with the sentinels it accepts:
 *   {@link ServerTimestampOr}, {@link IncrementOr}, {@link DeleteFieldOr} and
 *   {@link ArrayOr}.
 *
 * Each schema holds a portable value this library owns, so a document schema
 * reads the same under the Admin SDK and the client SDK. Each SDK package turns
 * those values into its own SDK's on the way out, and back on the way in.
 *
 * Most models use these through the {@link FirestoreModel} field helpers,
 * which pair a field's read schema with the write schemas here.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { DateTime, Schema } from "effect";
import type * as Collection from "./Collection.ts";
import type * as DocumentPath_ from "./DocumentPath.ts";
import type * as FieldValue from "./FieldValue.ts";
import type * as GeoPoint_ from "./GeoPoint.ts";
import * as firestoreSchema from "./internal/firestoreSchema.ts";
import type * as Timestamp_ from "./Timestamp.ts";

/**
 * Type-level representation of {@link Timestamp}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Timestamp extends Schema.declare<Timestamp_.Timestamp> {
  readonly Rebuild: Timestamp;
}

/**
 * Schema for a Firestore timestamp, held as the portable
 * {@link Timestamp.Timestamp}.
 *
 * **When to use**
 *
 * Use when a document is read, written back, and has to come out unchanged.
 * Use `Schema.DateTimeUtc` or `Schema.Date` when a millisecond is precise
 * enough and that value is easier to work with: Firestore stores both as a
 * timestamp too, but they drop the digits finer than a millisecond.
 *
 * **Details**
 *
 * It serializes with `Schema.toCodecJson` as `{ seconds, nanoseconds }`, so the
 * same model can be sent over HTTP.
 *
 * @example Storing a timestamp at full precision
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Event = Schema.Struct({ at: FirestoreSchema.Timestamp });
 * ```
 *
 * @see {@link FirestoreModel.Timestamp} for a timestamp field the server may also fill in
 * @see {@link ServerTimestampOr} for the write side of such a field
 * @see {@link TimeSchema} for every schema Firestore stores as a timestamp
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Timestamp: Timestamp = firestoreSchema.Timestamp;

/**
 * A schema Firestore stores as a timestamp: {@link Timestamp},
 * `Schema.DateTimeUtc`, `Schema.Date`, or any schema transformed into one of
 * them.
 *
 * **Details**
 *
 * The check is on the encoded type alone, so it accepts any schema whose
 * encoded side is a {@link Timestamp.Timestamp}, a `DateTime.Utc` or a `Date`.
 * A declaration of your own, such as `Schema.declare<Date>(...)`, type-checks
 * but is not stored as a timestamp: {@link FirestoreValue.toCodecFirestore}
 * only stores `Schema.Date` and `Schema.DateTimeUtc` as one, so it fails to
 * encode, or is written through its own `toCodecJson`. The types cannot tell
 * the two apart, since `Schema.Date` has the same type as any
 * `Schema.declare<Date>`.
 *
 * @see {@link ServerTimestampOr} for a timestamp the server may fill in
 * @see {@link FirestoreModel.Timestamp} for the matching model field
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type TimeSchema = Schema.Codec<
  unknown,
  Timestamp_.Timestamp | DateTime.Utc | globalThis.Date,
  unknown,
  unknown
>;

/**
 * Type-level representation of {@link GeoPoint}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface GeoPoint extends Schema.declare<GeoPoint_.GeoPoint> {
  readonly Rebuild: GeoPoint;
}

/**
 * Schema for a Firestore geopoint, held as the portable
 * {@link GeoPoint.GeoPoint}.
 *
 * **When to use**
 *
 * Use for a location field. A hand-written struct of `latitude` and
 * `longitude` would be stored as a map; this schema is stored as Firestore's
 * own geopoint.
 *
 * @example Storing a location
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Place = Schema.Struct({ name: Schema.String, location: FirestoreSchema.GeoPoint });
 * ```
 *
 * @see {@link GeoPoint.make} for building a geopoint
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const GeoPoint: GeoPoint = firestoreSchema.GeoPoint;

/**
 * Type-level representation of {@link DocumentPath}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface DocumentPath extends Schema.declare<DocumentPath_.DocumentPath> {
  readonly Rebuild: DocumentPath;
}

/**
 * Schema for an untyped reference to a document, held as the portable
 * {@link DocumentPath.DocumentPath}.
 *
 * **When to use**
 *
 * Use for a reference whose target collection the model does not know. Use
 * {@link DocumentReference} when the field always points into a known
 * collection.
 *
 * **Details**
 *
 * It is stored as the SDK's own reference, built against the database the
 * document is written to.
 *
 * @see {@link DocumentReference} for a reference typed by its collection
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const DocumentPath: DocumentPath = firestoreSchema.DocumentPath;

/**
 * Type-level representation of {@link DocumentReference}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface DocumentReference<C extends Collection.Any> extends Schema.declare<
  Collection.DocumentReference<C>
> {
  readonly Rebuild: DocumentReference<C>;
}

/**
 * Schema for a reference to a document in `collection`, held as a typed
 * {@link Collection.DocumentReference}.
 *
 * **When to use**
 *
 * Use for a field that points to a document in a known collection, so the
 * reference keeps its ids and model typed. For a field that may point into
 * several collections, use a `Schema.Union` of one of these per collection.
 * Use {@link DocumentPath} when the target collection is unknown.
 *
 * **Details**
 *
 * Firestore stores a reference as the document's path alone, so it is written
 * as a {@link DocumentPath.DocumentPath}. Reading it back checks the path
 * against the collection's segments and rebuilds the collection's own
 * reference, equal to one built from `collection`. A path into any other
 * collection, even one with the same last segment, fails to decode.
 * `Schema.is` only accepts references built from `collection`.
 *
 * @example Referencing the author of a post
 * ```ts
 * import { Schema } from "effect";
 * import { Collection, FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * const Users = Collection.make("users", User);
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   author: FirestoreSchema.DocumentReference(Users),
 * }) {}
 * ```
 *
 * @see {@link DocumentPath} for an untyped reference
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const DocumentReference: <C extends Collection.Any>(collection: C) => DocumentReference<C> =
  firestoreSchema.DocumentReference;

interface ServerTimestampSentinel extends Schema.declare<FieldValue.ServerTimestamp> {
  readonly Rebuild: ServerTimestampSentinel;
}

/**
 * Type-level representation of {@link ServerTimestamp}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ServerTimestamp extends Schema.withConstructorDefault<ServerTimestampSentinel> {
  readonly Rebuild: ServerTimestamp;
}

/**
 * Schema that always writes the {@link FieldValue.serverTimestamp} sentinel,
 * and fills it in when the value is constructed.
 *
 * **When to use**
 *
 * Use in a write-only schema for a field that is always the server's time,
 * such as `updatedAt` on every update. Use {@link ServerTimestampOr} when the
 * field may also be written with a time of your own.
 *
 * **Details**
 *
 * It accepts only the sentinel, and its constructor default fills it in, the
 * way `Schema.tag` fills in a tag, so a call site never names the field. A
 * document never holds the sentinel: the field reads back as the timestamp the
 * server wrote, so the read side is a timestamp schema.
 *
 * @example Stamping every update with the server's time
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Touch = Schema.Struct({ updatedAt: FirestoreSchema.ServerTimestamp });
 *
 * const update = Touch.make({}); // { updatedAt: FieldValue.serverTimestamp }
 * ```
 *
 * @see {@link ServerTimestampOr} for a field that may also take a time of your own
 * @see {@link FirestoreModel.Timestamp} for the matching model field
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const ServerTimestamp: ServerTimestamp = firestoreSchema.ServerTimestamp;

/**
 * Type-level representation of {@link ServerTimestampOr}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ServerTimestampOr<S extends TimeSchema> extends Schema.Union<
  readonly [S, ServerTimestamp]
> {
  readonly Rebuild: ServerTimestampOr<S>;
}

/**
 * Schema for a timestamp field written either as a time of your own or as
 * {@link FieldValue.serverTimestamp}.
 *
 * **When to use**
 *
 * Use as the write side of a timestamp field when building model variants by
 * hand. Most models use {@link FirestoreModel.Timestamp}, which pairs this with
 * the read side for you.
 *
 * **Details**
 *
 * `schema` is the read side: {@link Timestamp} to keep digits finer than a
 * millisecond, or `Schema.DateTimeUtc` or `Schema.Date` (see
 * {@link TimeSchema}). A read never sees the sentinel, so the read variant
 * uses `schema` alone.
 *
 * @example A timestamp the server may fill in
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const UpdatedAt = FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtc);
 *
 * Schema.is(UpdatedAt)(FieldValue.serverTimestamp); // true
 * ```
 *
 * @see {@link FirestoreModel.Timestamp} for the model field built on it
 * @see {@link ServerTimestamp} for a field that always writes the sentinel
 * @see {@link FieldValue.serverTimestamp} for the sentinel itself
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const ServerTimestampOr: <S extends TimeSchema>(schema: S) => ServerTimestampOr<S> =
  firestoreSchema.ServerTimestampOr;

/**
 * Type-level representation of {@link Increment}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Increment extends Schema.declare<FieldValue.Increment> {
  readonly Rebuild: Increment;
}

/**
 * Schema for the {@link FieldValue.Increment} sentinel, as built by
 * {@link FieldValue.increment} and {@link FieldValue.decrement}.
 *
 * **When to use**
 *
 * Use in a write-only schema for a field that is only ever moved, never set.
 * Use {@link IncrementOr} for a field that may be set outright too.
 *
 * **Details**
 *
 * A document holds the sum the server wrote, so the read side of the same
 * field is a plain number.
 *
 * @see {@link IncrementOr} for a number that may also be set outright
 * @see {@link FirestoreModel.Number} for the matching model field
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Increment: Increment = firestoreSchema.Increment;

/**
 * Type-level representation of {@link IncrementOr}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface IncrementOr<
  S extends Schema.Codec<unknown, number, unknown, unknown>,
> extends Schema.Union<readonly [S, Increment]> {
  readonly Rebuild: IncrementOr<S>;
}

/**
 * Schema for a number field written either as a number or as an
 * {@link FieldValue.increment} or {@link FieldValue.decrement}.
 *
 * **When to use**
 *
 * Use as the write side of a counter when building model variants by hand.
 * Most models use {@link FirestoreModel.Number}, which pairs this with the
 * read side for you.
 *
 * **Details**
 *
 * `schema` is the read side and says what the number may be: `Schema.Finite`,
 * `Schema.Int` for whole steps, or either with further checks. It must be
 * stored as a number, since that is what the server adds to. A read never sees
 * the sentinel, so the read variant uses `schema` alone.
 *
 * @example A counter the server may move
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Visits = FirestoreSchema.IncrementOr(Schema.Int);
 *
 * Schema.is(Visits)(FieldValue.increment(1)); // true
 * ```
 *
 * @see {@link FirestoreModel.Number} for the model field built on it
 * @see {@link Increment} for a field that is only ever moved
 * @see {@link FieldValue.increment} for the sentinel itself
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const IncrementOr: <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
) => IncrementOr<S> = firestoreSchema.IncrementOr;

/**
 * Type-level representation of {@link DeleteField}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface DeleteField extends Schema.declare<FieldValue.DeleteField> {
  readonly Rebuild: DeleteField;
}

/**
 * Schema for the {@link FieldValue.deleteField} sentinel.
 *
 * **When to use**
 *
 * Use when building an update schema by hand. Most models get it through
 * {@link DeleteFieldOr}, or through {@link FirestoreModel.Optional}.
 *
 * **Details**
 *
 * Unlike {@link ServerTimestamp}, it has no constructor default: a field is
 * only removed when you ask for it. A removed field is not there to read, so
 * the read side of the same field is an optional key.
 *
 * @see {@link DeleteFieldOr} for a field an update may write or remove
 * @see {@link FirestoreModel.Optional} for the matching model field
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const DeleteField: DeleteField = firestoreSchema.DeleteField;

/**
 * Type-level representation of {@link DeleteFieldOr}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface DeleteFieldOr<S extends Schema.Top> extends Schema.Union<
  readonly [DeleteField, S]
> {
  readonly Rebuild: DeleteFieldOr<S>;
}

/**
 * Schema for a field an update either writes or removes with
 * {@link FieldValue.deleteField}.
 *
 * **When to use**
 *
 * Use as the update side of an optional field when building model variants by
 * hand. Most models use {@link FirestoreModel.Optional}, which does this for
 * you.
 *
 * **Details**
 *
 * `schema` is what the field holds while it is there. Only an update accepts
 * it: a read never holds the sentinel, and Firestore refuses it in a document
 * written whole.
 *
 * The sentinel is tried first, since a schema that accepts any object, such
 * as a struct whose keys are all optional, would accept it too and strip it to
 * `{}`.
 *
 * @example An optional field an update may remove
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Nickname = FirestoreSchema.DeleteFieldOr(Schema.String);
 *
 * Schema.is(Nickname)(FieldValue.deleteField); // true
 * ```
 *
 * @see {@link FirestoreModel.Optional} for the model field built on it
 * @see {@link FieldValue.deleteField} for the sentinel itself
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const DeleteFieldOr: <S extends Schema.Top>(schema: S) => DeleteFieldOr<S> =
  firestoreSchema.DeleteFieldOr;

/**
 * Type-level representation of {@link ArrayUnion}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ArrayUnion<S extends Schema.Top> extends Schema.declareConstructor<
  FieldValue.ArrayUnion<S["Type"]>,
  FieldValue.ArrayUnion<S["Encoded"]>,
  readonly [S]
> {
  readonly Rebuild: ArrayUnion<S>;
}

/**
 * Schema for the {@link FieldValue.arrayUnion} sentinel, with each element
 * encoded through `item`.
 *
 * **When to use**
 *
 * Use when building an update schema by hand. Most models get it through
 * {@link ArrayOr}, or through {@link FirestoreModel.Array}.
 *
 * **Details**
 *
 * Each element is encoded through `item`, then stored the way
 * {@link FirestoreValue.toCodecFirestore} stores `item`, so a `DateTimeUtc`
 * among them is stored as a timestamp, and an element `item` rejects is
 * rejected here too.
 *
 * Firestore requires two things of `item`: it is not an array itself, since
 * arrays may not nest, and it does not write a sentinel, since one may not sit
 * inside an array.
 *
 * A document holds the array the server wrote, so the read side of the same
 * field is the array.
 *
 * @see {@link ArrayRemove} for removing elements
 * @see {@link ArrayOr} for an array field written whole, grown or shrunk
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const ArrayUnion: <S extends Schema.Top>(item: S) => ArrayUnion<S> =
  firestoreSchema.ArrayUnion;

/**
 * Type-level representation of {@link ArrayRemove}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ArrayRemove<S extends Schema.Top> extends Schema.declareConstructor<
  FieldValue.ArrayRemove<S["Type"]>,
  FieldValue.ArrayRemove<S["Encoded"]>,
  readonly [S]
> {
  readonly Rebuild: ArrayRemove<S>;
}

/**
 * Schema for the {@link FieldValue.arrayRemove} sentinel, with each element
 * encoded through `item`.
 *
 * **When to use**
 *
 * Use when building an update schema by hand. Most models get it through
 * {@link ArrayOr}, or through {@link FirestoreModel.Array}.
 *
 * **Details**
 *
 * Each element is encoded through `item`, as for {@link ArrayUnion}. Encode
 * through the same schema the array was written with: the server only removes
 * elements that match exactly.
 *
 * @see {@link ArrayUnion} for adding elements
 * @see {@link ArrayOr} for an array field written whole, grown or shrunk
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const ArrayRemove: <S extends Schema.Top>(item: S) => ArrayRemove<S> =
  firestoreSchema.ArrayRemove;

/**
 * Type-level representation of {@link ArrayOr}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ArrayOr<S extends Schema.Top> extends Schema.Union<
  readonly [Schema.$Array<S>, ArrayUnion<S>, ArrayRemove<S>]
> {
  readonly Rebuild: ArrayOr<S>;
}

/**
 * Schema for an array field written whole, or grown or shrunk by the server
 * with {@link FieldValue.arrayUnion} and {@link FieldValue.arrayRemove}.
 *
 * **When to use**
 *
 * Use as the update side of an array of `item` when building model variants by
 * hand, against a read of `Schema.Array(item)`. Most models use
 * {@link FirestoreModel.Array}, which pairs the two for you.
 *
 * **Details**
 *
 * Writing the array whole replaces what the server holds, so a client that
 * read it, added an element and wrote it back loses whatever another client
 * added in between. Growing or shrinking it does not. A read never sees the
 * sentinels, so the read variant is the array alone.
 *
 * @example An array the server may grow or shrink
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Tags = FirestoreSchema.ArrayOr(Schema.String);
 *
 * Schema.is(Tags)(["news"]); // true
 * Schema.is(Tags)(FieldValue.arrayUnion("news")); // true
 * ```
 *
 * @see {@link FirestoreModel.Array} for the model field built on it
 * @see {@link ArrayUnion} for the growing sentinel's schema
 * @see {@link ArrayRemove} for the shrinking sentinel's schema
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const ArrayOr: <S extends Schema.Top>(item: S) => ArrayOr<S> = firestoreSchema.ArrayOr;

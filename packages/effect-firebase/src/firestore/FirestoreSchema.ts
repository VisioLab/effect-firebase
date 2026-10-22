/**
 * Schemas for the Firestore Values Effect has no schema of its own for.
 *
 * Each is a plain schema of a portable value this library owns - a
 * `Timestamp`, a `GeoPoint`, a typed document reference - with no encoding step
 * of its own. `toCodecFirestore` keeps them as they are, and each SDK package
 * turns them into the SDK's own values on the way out and back on the way in,
 * so a document schema is written once and reads the same under the Admin SDK
 * and the web SDK.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { DateTime, Schema } from "effect";
import type * as Collection from "./Collection.ts";
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
 * Schema for a Firestore timestamp, held as the portable `Timestamp`.
 *
 * Nothing is lost in either direction, so reach for this over
 * `Schema.DateTimeUtc` or `Schema.Date` - which Firestore stores as a
 * timestamp just the same, but which stop at the millisecond - when a
 * document is read, written back, and expected to come out unchanged.
 *
 * It serializes with `Schema.toCodecJson` as `{ seconds, nanoseconds }`, so
 * the same model can be sent over HTTP.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Timestamp: Timestamp = firestoreSchema.Timestamp;

/**
 * A schema whose encoded side Firestore stores as a timestamp:
 * {@link Timestamp}, `Schema.DateTimeUtc` or `Schema.Date`, or any schema
 * transformed into one of them.
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
 * Schema for a Firestore geopoint, held as the portable `GeoPoint`.
 *
 * Declaring the shape by hand - a struct of `latitude` and `longitude` - would
 * be stored as a map. This one is stored as the SDK's own `GeoPoint`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const GeoPoint: GeoPoint = firestoreSchema.GeoPoint;

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
 * Schema for a reference to a document in `collection`.
 *
 * A reference Firestore hands back names its path but not the collection it
 * was defined through, so it is read back as one built by
 * `Collection.fromPathUntyped`. This schema takes such a reference, checks its
 * path against the collection's segments and turns it into the collection's
 * own, so a reference read back is equal to one built from `collection`. A
 * reference into any other collection - one sharing its last segment
 * included - is refused rather than read as one into this. A field that may
 * point into more than one collection is a `Schema.Union` of one of these per
 * collection.
 *
 * It is stored as the SDK's own reference, built against the database the
 * document is written to.
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
 * Schema that writes the sentinel standing in for the instant the server
 * applies the write.
 *
 * There is only one value it accepts, so there is nothing to say at a call
 * site: the constructor fills the sentinel in, the way `Schema.tag` fills in a
 * tag. Hand it to {@link Schema.Struct} and the field is written without ever
 * being named.
 *
 * It is a plain schema of the portable sentinel, which each SDK package turns
 * into its own on the way out, and it belongs in a write only. A document
 * never holds a sentinel: by the time it is read, the server has replaced it
 * with the timestamp it resolved to, which is what the field reads as on the
 * way back - see {@link FirestoreModel.Timestamp} for the pair.
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
 * Schema for a field written either as an instant this client picked or as the
 * one the server picks.
 *
 * This is the write side of a timestamp, and `schema` is the read side it is
 * built from: {@link Timestamp} where the finer digits are to survive a round
 * trip, or `Schema.DateTimeUtc` or `Schema.Date` where one of those is what
 * the document is to hold - see {@link TimeSchema}.
 *
 * A read is only ever that schema - the sentinel is gone by then - so this
 * belongs in the variants a document is written through, against a `read` of
 * the same.
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
 * Schema that writes the sentinel standing in for a field moved by a number.
 *
 * A call site hands it {@link FieldValue.increment} or
 * {@link FieldValue.decrement}. It is a plain schema of the portable sentinel,
 * which each SDK package turns into its own on the way out.
 *
 * It belongs in a write only, as {@link ServerTimestamp} does. A document holds
 * the sum the server wrote rather than the request to add, so a read of the
 * same field is a plain number - see {@link IncrementOr} for the pair.
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
 * Schema for a field written either as the number it is to hold or as a move
 * from whatever it holds already.
 *
 * This is the write side of a number the server counts, and `schema` is the
 * read side it is built from, which is where a call site says what the number
 * may be: `Schema.Finite`, or `Schema.Int` for a field counted in whole steps,
 * or either of them checked further. All that is asked of it is that it is
 * stored as a number, since that is what the server adds to.
 *
 * A read is only ever that schema - the sentinel resolved to a number before
 * the document came back - so this belongs in the variants a document is
 * written through, against a `read` of the same.
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
 * Schema that writes the sentinel standing in for a field the write removes.
 *
 * A call site hands it {@link FieldValue.deleteField}, the portable sentinel,
 * which each SDK package turns into its own on the way out. Unlike
 * {@link ServerTimestamp} it does not fill itself in, since a field is removed
 * on purpose or not at all.
 *
 * It belongs in a write only, as the other sentinels do. A field removed is
 * not there to read, so a read of the same is an optional key - see
 * {@link DeleteFieldOr} for the pair.
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
 * Schema for a field an update either writes or removes.
 *
 * This is the update side of an optional field, and `schema` is what the field
 * holds while it is there. It belongs in an update and nowhere else: a read
 * never holds the sentinel, and a document written whole refuses it.
 *
 * The sentinel is tried first. A schema that takes any object - a struct whose
 * every key is optional, say - would take it too, and strip it to nothing.
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
 * Schema that writes the sentinel standing in for an array grown by the
 * elements it lacks.
 *
 * A call site hands it {@link FieldValue.arrayUnion}, and each element is
 * encoded through `item`, and then by `toCodecFirestore` the way `item` is
 * stored, before the SDK package turns the portable sentinel into its own - so
 * a `DateTimeUtc` among them is stored as a timestamp, and an element `item`
 * refuses is refused here too.
 *
 * `item` is what the array holds, and Firestore asks two things of it: that it
 * is not an array itself, since an array may not hold one, and that it does not
 * write a sentinel, since one may not sit inside an array.
 *
 * It belongs in a write only, as the other sentinels do. A document holds the
 * array the server wrote rather than the request to grow it - see
 * {@link ArrayOr} for the pair.
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
 * Schema that writes the sentinel standing in for an array rid of the elements
 * it matches.
 *
 * A call site hands it {@link FieldValue.arrayRemove}, and each element is
 * encoded through `item` as {@link ArrayUnion} has it. Encoding through the same
 * schema the array was written with is what gives a match a chance: the server
 * compares what it is handed with what it holds, exactly.
 *
 * It belongs in a write only, as the other sentinels do - see {@link ArrayOr}
 * for the pair.
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
 * Schema for an array written whole, or grown or shrunk by the server.
 *
 * This is the update side of an array of `item`, against a read of
 * `Schema.Array(item)`. Writing the array whole replaces whatever the server
 * holds, so a client that read it, added one and wrote it back loses whatever
 * was added in between; growing or shrinking it is what does not.
 *
 * A read is only ever the array - the sentinels resolved before the document
 * came back - so this belongs in the variants a document is written through.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const ArrayOr: <S extends Schema.Top>(item: S) => ArrayOr<S> = firestoreSchema.ArrayOr;

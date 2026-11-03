/**
 * Sentinels: values Firestore resolves when a write lands.
 *
 * In place of a value, a write can ask the server for its current time, to
 * move a number, to delete a field, or to add or remove array elements. The
 * server resolves each sentinel when it applies the write, so a document read
 * back never holds one.
 *
 * Each sentinel here is portable: a Firestore Value that each SDK package
 * turns into its own SDK's sentinel. Hand one to a field whose model accepts
 * it, which the {@link FirestoreModel} field helpers and the
 * {@link FirestoreSchema} `*Or` schemas do.
 *
 * | Sentinel | Schema | Model field |
 * | --- | --- | --- |
 * | {@link serverTimestamp} | {@link FirestoreSchema.ServerTimestampOr} | {@link FirestoreModel.Timestamp} |
 * | {@link increment}, {@link decrement} | {@link FirestoreSchema.IncrementOr} | {@link FirestoreModel.Number} |
 * | {@link deleteField} | {@link FirestoreSchema.DeleteFieldOr} | {@link FirestoreModel.Optional} |
 * | {@link arrayUnion}, {@link arrayRemove} | {@link FirestoreSchema.ArrayOr} | {@link FirestoreModel.Array} |
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Equal, Inspectable } from "effect";
import * as fieldValue from "./internal/fieldValue.ts";

const ServerTimestampTypeId = fieldValue.ServerTimestampTypeId;

/**
 * The sentinel for the time the server applies the write. Its only value is
 * {@link serverTimestamp}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ServerTimestamp extends Inspectable.Inspectable {
  readonly [ServerTimestampTypeId]: typeof ServerTimestampTypeId;
}

/**
 * Asks the server to write the time it applies the write.
 *
 * **When to use**
 *
 * Use for fields such as `createdAt` and `updatedAt` that every client should
 * agree on. The local clock differs between clients, the server's does not.
 *
 * **Details**
 *
 * It carries nothing, so there is only this one value. The field reads back as
 * the timestamp the server wrote.
 *
 * @example Stamping a document with the server's time
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   updatedAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
 * }) {}
 *
 * Post.update.make({ updatedAt: FieldValue.serverTimestamp });
 * ```
 *
 * @see {@link Timestamp.now} for the local time instead
 * @see {@link FirestoreModel.Timestamp} for a model field that accepts it
 * @see {@link FirestoreSchema.ServerTimestampOr} for a schema that accepts it
 * @see {@link FirestoreSchema.ServerTimestamp} for a schema that always writes it
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const serverTimestamp: ServerTimestamp = fieldValue.serverTimestamp;

/**
 * Checks whether `u` is the {@link ServerTimestamp} sentinel.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isServerTimestamp: (u: unknown) => u is ServerTimestamp = fieldValue.isServerTimestamp;

const IncrementTypeId = fieldValue.IncrementTypeId;

/**
 * The sentinel for a number the server moves by `by`. Built by
 * {@link increment} and {@link decrement}.
 *
 * **Details**
 *
 * The server adds `by` to what the field holds. A field that holds no number,
 * or is missing, counts as zero. Two sentinels are equal when their `by` is.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Increment extends Equal.Equal, Inspectable.Inspectable {
  readonly [IncrementTypeId]: typeof IncrementTypeId;
  /** How far the field moves; negative to lower it. */
  readonly by: number;
}

/**
 * Checks whether `u` is an {@link Increment} sentinel.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isIncrement: (u: unknown) => u is Increment = fieldValue.isIncrement;

/**
 * Asks the server to raise a number field by `by`.
 *
 * **When to use**
 *
 * Use for counters and totals that several clients may change at once. Two
 * clients that each read a number and write back the sum lose one of the
 * changes; two increments do not.
 *
 * **Details**
 *
 * Throws unless `by` is a finite number. Integers and doubles both work; an
 * integer added to a double gives a double. A field that holds no number, or
 * is missing, counts as zero.
 *
 * @example Counting a visit
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Page extends FirestoreModel.Class<Page>("Page")({
 *   visits: FirestoreModel.Number(Schema.Int),
 * }) {}
 *
 * Page.update.make({ visits: FieldValue.increment(1) });
 * ```
 *
 * @see {@link decrement} for lowering a field
 * @see {@link FirestoreModel.Number} for a model field that accepts it
 * @see {@link FirestoreSchema.IncrementOr} for a schema that accepts it
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const increment: (by: number) => Increment = fieldValue.increment;

/**
 * Asks the server to lower a number field by `by`.
 *
 * **When to use**
 *
 * Use where the code counts down, so it reads that way rather than as an
 * increment by a negative number.
 *
 * **Details**
 *
 * It is {@link increment} of `-by`: `decrement(2).by` is `-2`.
 *
 * @see {@link increment} for raising a field
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const decrement: (by: number) => Increment = fieldValue.decrement;

const DeleteFieldTypeId = fieldValue.DeleteFieldTypeId;

/**
 * The sentinel for a field an update removes. Its only value is
 * {@link deleteField}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface DeleteField extends Inspectable.Inspectable {
  readonly [DeleteFieldTypeId]: typeof DeleteFieldTypeId;
}

/**
 * Asks the server to remove a field.
 *
 * **When to use**
 *
 * Use in an update to remove an optional field. Leaving a field out of an
 * update keeps it as it is, so removing one has to be asked for.
 *
 * **Details**
 *
 * After the write, the document has no key at all for the field, not one
 * holding `null`. Only an update accepts it: a document written whole with
 * `setDoc` drops a field by leaving it out, and Firestore refuses the sentinel
 * there.
 *
 * It carries nothing, so there is only this one value. It is not called
 * `delete` because that is a reserved word in JavaScript, which is also why the
 * client SDK calls its own `deleteField`.
 *
 * @example Removing an optional field
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   nickname: FirestoreModel.Optional(Schema.String),
 * }) {}
 *
 * User.update.make({ nickname: FieldValue.deleteField });
 * ```
 *
 * @see {@link FirestoreModel.Optional} for a model field that accepts it
 * @see {@link FirestoreSchema.DeleteFieldOr} for a schema that accepts it
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const deleteField: DeleteField = fieldValue.deleteField;

/**
 * Checks whether `u` is the {@link DeleteField} sentinel.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isDeleteField: (u: unknown) => u is DeleteField = fieldValue.isDeleteField;

const ArrayUnionTypeId = fieldValue.ArrayUnionTypeId;

/**
 * The sentinel for an array the server adds `elements` to. Built by
 * {@link arrayUnion}.
 *
 * **Details**
 *
 * The server appends each element the array does not already hold. It compares
 * by value, all the way down: a map matches one with the same keys holding the
 * same values, whatever their order. A field that holds no array, or is
 * missing, ends up holding just `elements`.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ArrayUnion<A> extends Inspectable.Inspectable {
  readonly [ArrayUnionTypeId]: typeof ArrayUnionTypeId;
  /** The elements to add, in the order they are appended. */
  readonly elements: ReadonlyArray<A>;
}

/**
 * Checks whether `u` is an {@link ArrayUnion} sentinel.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isArrayUnion: (u: unknown) => u is ArrayUnion<unknown> = fieldValue.isArrayUnion;

/**
 * Asks the server to add `elements` to an array, skipping any it holds already.
 *
 * **When to use**
 *
 * Use to add to an array that several clients may change at once. A client
 * that reads the array, adds an element and writes it back loses whatever
 * another client added in between; `arrayUnion` does not.
 *
 * **Details**
 *
 * Elements are compared by value, as {@link ArrayUnion} describes. With no
 * elements it changes nothing, except that a field that held no array ends up
 * holding an empty one.
 *
 * @example Adding a tag
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Article extends FirestoreModel.Class<Article>("Article")({
 *   tags: FirestoreModel.Array(Schema.String),
 * }) {}
 *
 * Article.update.make({ tags: FieldValue.arrayUnion("news") });
 * ```
 *
 * @see {@link arrayRemove} for removing elements
 * @see {@link FirestoreModel.Array} for a model field that accepts it
 * @see {@link FirestoreSchema.ArrayOr} for a schema that accepts it
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const arrayUnion: <A>(...elements: ReadonlyArray<A>) => ArrayUnion<A> =
  fieldValue.arrayUnion;

const ArrayRemoveTypeId = fieldValue.ArrayRemoveTypeId;

/**
 * The sentinel for an array the server removes `elements` from. Built by
 * {@link arrayRemove}.
 *
 * **Details**
 *
 * The server drops every element equal to one of `elements`. The match is by
 * value, as for {@link ArrayUnion}, and exact: an element with an extra key, or
 * a different number, is a different element and stays. To remove a map from
 * an array you must pass every key it holds, with the same values. Where
 * elements have an id of their own, a map keyed by that id is easier to remove
 * from. A field that holds no array, or is missing, ends up holding an empty
 * one.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ArrayRemove<A> extends Inspectable.Inspectable {
  readonly [ArrayRemoveTypeId]: typeof ArrayRemoveTypeId;
  /** The elements to remove, wherever they are in the array. */
  readonly elements: ReadonlyArray<A>;
}

/**
 * Checks whether `u` is an {@link ArrayRemove} sentinel.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isArrayRemove: (u: unknown) => u is ArrayRemove<unknown> = fieldValue.isArrayRemove;

/**
 * Asks the server to remove every element equal to one of `elements` from an
 * array.
 *
 * **When to use**
 *
 * Use to remove from an array that several clients may change at once, keeping
 * whatever they add in the meantime.
 *
 * **Details**
 *
 * The match is exact, as {@link ArrayRemove} describes.
 *
 * @example Removing a tag
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Article extends FirestoreModel.Class<Article>("Article")({
 *   tags: FirestoreModel.Array(Schema.String),
 * }) {}
 *
 * Article.update.make({ tags: FieldValue.arrayRemove("draft") });
 * ```
 *
 * @see {@link arrayUnion} for adding elements
 * @see {@link FirestoreModel.Array} for a model field that accepts it
 * @see {@link FirestoreSchema.ArrayOr} for a schema that accepts it
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const arrayRemove: <A>(...elements: ReadonlyArray<A>) => ArrayRemove<A> =
  fieldValue.arrayRemove;

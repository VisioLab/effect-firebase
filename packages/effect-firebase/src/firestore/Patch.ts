/**
 * Patches: what an update writes, and how.
 *
 * A patch has the shape of the document it changes. Each part of it says how
 * that part is written:
 *
 * - A plain object handed to a {@link FirestoreModel.Struct} field is a nested
 *   patch, written field by field: `{ address: { city } }` writes
 *   `"address.city"` and leaves the rest of `address` as it is.
 * - {@link replace} handed to a {@link FirestoreModel.Struct} field writes the
 *   struct whole, dropping any field the value leaves out.
 * - Any other value is written whole where it stands. A sentinel from
 *   {@link FieldValue} may stand at any depth.
 *
 * Firestore itself tells a merge from a replace by the key: a dotted path
 * merges, a map handed to a field replaces it. A patch tells them apart by the
 * value instead, so the same patch means the same thing wherever it is
 * written, and replacing a map is asked for by name.
 *
 * Which patches a document accepts is up to its model.
 *
 * @example Replacing one struct and deleting a field
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel, Patch } from "@visiolab/effect-firebase/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   address: FirestoreModel.Struct({ city: Schema.String, zip: Schema.String }),
 *   nickname: FirestoreModel.Optional(Schema.String),
 * }) {}
 *
 * const patch = User.update.make({
 *   address: Patch.replace({ city: "Berlin", zip: "10115" }),
 *   nickname: FieldValue.deleteField,
 * });
 * ```
 *
 * @see {@link Firestore.With.updateDoc} for writing a patch
 * @see {@link FirestoreModel.Update} for which patches a model accepts
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Inspectable } from "effect";
import * as patch from "./internal/patch.ts";

const ReplaceTypeId = patch.ReplaceTypeId;

/**
 * A struct written whole, as the map `value`. Built by {@link replace}.
 *
 * **Details**
 *
 * Unlike the sentinels in {@link FieldValue}, it never reaches Firestore. It
 * only tells the update how to write the struct, and is the plain map by the
 * time the update is encoded.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Replace<A> extends Inspectable.Inspectable {
  readonly [ReplaceTypeId]: typeof ReplaceTypeId;
  /** What the struct holds once the update lands. */
  readonly value: A;
}

/**
 * Checks whether `u` is a {@link Replace}.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isReplace: (u: unknown) => u is Replace<unknown> = patch.isReplace;

/**
 * Marks a {@link FirestoreModel.Struct} field in a patch to be written whole,
 * rather than field by field.
 *
 * **When to use**
 *
 * Use to replace a struct field outright, dropping any keys the new value leaves
 * out. It is also the safe choice when the struct may not be in the document
 * yet: a nested patch writes only some of its fields there, while `replace`
 * writes all of them.
 *
 * **Details**
 *
 * `value` is the whole struct, in the shape `setDoc` writes it in. A plain
 * object in the same place is a nested patch that only touches the fields it
 * names. A field declared with a plain `Schema.Struct` is a value, always
 * written whole, and takes neither.
 *
 * @example Replacing a struct
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel, Patch } from "@visiolab/effect-firebase/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   address: FirestoreModel.Struct({ city: Schema.String, zip: Schema.String }),
 * }) {}
 *
 * // Writes `address` as `{ city: "Berlin", zip: "10115" }`, whatever it held.
 * User.update.make({ address: Patch.replace({ city: "Berlin", zip: "10115" }) });
 *
 * // Writes `address.city` only, and leaves `address.zip` as it is.
 * User.update.make({ address: { city: "Berlin" } });
 * ```
 *
 * @see {@link Firestore.With.updateDoc} for writing the patch
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const replace: <const A>(value: A) => Replace<A> = patch.replace;

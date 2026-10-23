/**
 * What an update is handed: the fields that change, and how.
 *
 * A patch reads like the document it changes, and each part of it says how it
 * is written:
 *
 * - A plain object, handed to a struct, is a patch of its own, written field by
 *   field at its paths: `{ address: { city } }` writes `"address.city"` and
 *   leaves the rest of the map as it is.
 * - {@link replace}, handed to a struct, writes the struct whole, as a map,
 *   dropping whatever it held that the value leaves out.
 * - Any other value is written whole where it stands, and a sentinel from
 *   `FieldValue` may stand at any depth.
 *
 * Firestore has the same two writes, and tells them apart by the key: a dotted
 * path merges, a map handed to a field replaces it. A patch tells them apart by
 * the value instead, so the same patch means the same thing wherever it is
 * written, and replacing a map is asked for by name.
 *
 * Which patches a document takes is the model's to say - see
 * `FirestoreModel.Update`.
 *
 * ```ts
 * import { FieldValue, Patch } from "@visiolab/effect-firebase/firestore";
 *
 * User.update.make({
 *   address: Patch.replace({ city: "Berlin", zip: "10115" }),
 *   nickname: FieldValue.deleteField,
 * });
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Inspectable } from "effect";
import * as patch from "./internal/patch.ts";

const ReplaceTypeId = patch.ReplaceTypeId;

/**
 * A struct written whole, as the map `value`.
 *
 * Unlike the sentinels in `FieldValue`, it never reaches Firestore: it only
 * says how the update writes the struct, and by the time the update is encoded
 * it is the map itself.
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
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isReplace: (u: unknown) => u is Replace<unknown> = patch.isReplace;

/**
 * Writes a struct whole, rather than field by field.
 *
 * The struct comes out holding `value` and nothing else, so a field it held
 * that `value` leaves out is gone. That is also what makes it safe where the
 * struct may be missing: `value` is a whole struct, the shape `set` would write
 * it in, so the struct is there in full whatever the document held before.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const replace: <const A>(value: A) => Replace<A> = patch.replace;

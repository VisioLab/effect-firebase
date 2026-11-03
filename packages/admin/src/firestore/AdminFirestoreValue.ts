/**
 * Maps between Firestore Values, the portable values a model encodes to, and
 * the values the Admin SDK reads and writes.
 *
 * {@link AdminFirestore} applies it on every read and write. Use it directly to
 * read or write a model through the Admin SDK itself, such as through
 * {@link AdminFirestore.instance}.
 *
 * @example Writing a model through the Admin SDK
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel, FirestoreValue } from "@visiolab/effect-firebase/firestore";
 * import { AdminFirestoreValue } from "@visiolab/effect-firebase-admin/firestore";
 * import { type DocumentData, getFirestore } from "firebase-admin/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   title: Schema.String,
 * }) {}
 *
 * const firestore = getFirestore();
 * const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(Post.create))({
 *   title: "Hello",
 * });
 * await firestore
 *   .doc("posts/hello")
 *   .set(AdminFirestoreValue.toAdmin(encoded, firestore) as DocumentData);
 * ```
 *
 * @see {@link ClientFirestoreValue} for the client SDK's mapping
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Result } from "effect";
import type { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import type { FirestoreValue } from "@visiolab/effect-firebase/firestore/FirestoreValue";
import type { Firestore } from "firebase-admin/firestore";
import * as internal from "./internal/firestoreValue.ts";

/**
 * Turns a Firestore Value into the value the Admin SDK writes into
 * `firestore`.
 *
 * **When to use**
 *
 * Use to write what a model encodes to through the Admin SDK itself.
 *
 * **Details**
 *
 * The portable `Timestamp`, `GeoPoint`, bytes and sentinels become the Admin
 * SDK's own. A `DocumentPath` becomes `firestore.doc(path)`, so it points into
 * that database. Map keys are kept as they are, so the dotted field paths of an
 * update stay field paths.
 *
 * It throws for anything that is not a Firestore Value, such as one of the
 * Admin SDK's own values or a class instance cast past the type. What
 * {@link FirestoreValue.toCodecFirestore} encodes is always a Firestore Value.
 *
 * @see {@link fromAdmin} for the other direction
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const toAdmin: (value: FirestoreValue, firestore: Firestore) => unknown = internal.toAdmin;

/**
 * Turns a value the Admin SDK read into a Firestore Value.
 *
 * **When to use**
 *
 * Use to decode what the Admin SDK itself read through a model, with
 * {@link FirestoreValue.toCodecFirestore}.
 *
 * **Details**
 *
 * The Admin SDK's `Timestamp`, `GeoPoint`, bytes and sentinels become their
 * portable forms. A `DocumentReference` becomes the `DocumentPath` it points
 * at, since Firestore stores nothing else of it;
 * {@link FirestoreSchema.DocumentReference} reads that back into the collection
 * it names.
 *
 * Fails with a {@link Firestore.FirestoreError} naming the field for a value
 * that is not a Firestore Value, such as a vector.
 *
 * @see {@link toAdmin} for the other direction
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const fromAdmin: (value: unknown) => Result.Result<FirestoreValue, FirestoreError> =
  internal.fromAdmin;

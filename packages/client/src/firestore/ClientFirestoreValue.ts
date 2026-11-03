/**
 * Maps between Firestore Values, the portable values a model encodes to, and
 * the values the client SDK reads and writes.
 *
 * {@link ClientFirestore} applies it on every read and write. Use it directly
 * to read or write a model through the client SDK itself, such as through
 * {@link ClientFirestore.instance}.
 *
 * @example Writing a model through the client SDK
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel, FirestoreValue } from "@visiolab/effect-firebase/firestore";
 * import { ClientFirestoreValue } from "@visiolab/effect-firebase-client/firestore";
 * import { type DocumentData, doc, getFirestore, setDoc } from "firebase/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   title: Schema.String,
 * }) {}
 *
 * const firestore = getFirestore();
 * const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(Post.create))({
 *   title: "Hello",
 * });
 * await setDoc(
 *   doc(firestore, "posts/hello"),
 *   ClientFirestoreValue.toClient(encoded, firestore) as DocumentData,
 * );
 * ```
 *
 * @see {@link AdminFirestoreValue} for the Admin SDK's mapping
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Result } from "effect";
import type { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import type { FirestoreValue } from "@visiolab/effect-firebase/firestore/FirestoreValue";
import type { Firestore } from "firebase/firestore";
import * as internal from "./internal/firestoreValue.ts";

/**
 * Turns a Firestore Value into the value the client SDK writes into
 * `firestore`.
 *
 * **When to use**
 *
 * Use to write what a model encodes to through the client SDK itself.
 *
 * **Details**
 *
 * The portable `Timestamp`, `GeoPoint` and bytes become the SDK's `Timestamp`,
 * `GeoPoint` and `Bytes`, and the sentinels its `FieldValue`s. A `DocumentPath`
 * becomes `doc(firestore, path)`, so it points into that database. Map keys are
 * kept as they are, so the dotted field paths of an update stay field paths.
 *
 * It throws for anything that is not a Firestore Value, such as one of the
 * client SDK's own values or a class instance cast past the type. What
 * {@link FirestoreValue.toCodecFirestore} encodes is always a Firestore Value.
 *
 * @see {@link fromClient} for the other direction
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const toClient: (value: FirestoreValue, firestore: Firestore) => unknown = internal.toClient;

/**
 * Turns a value the client SDK read into a Firestore Value.
 *
 * **When to use**
 *
 * Use to decode what the client SDK itself read through a model, with
 * {@link FirestoreValue.toCodecFirestore}.
 *
 * **Details**
 *
 * The SDK's `Timestamp`, `GeoPoint` and `Bytes` become the portable
 * `Timestamp`, `GeoPoint` and `Uint8Array`. A `DocumentReference` becomes the
 * `DocumentPath` it points at, since Firestore stores nothing else of it;
 * {@link FirestoreSchema.DocumentReference} reads that back into the
 * collection it names.
 *
 * Fails with a {@link Firestore.FirestoreError} naming the field for a value
 * that is not a Firestore Value, such as a vector.
 *
 * @see {@link toClient} for the other direction
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const fromClient: (value: unknown) => Result.Result<FirestoreValue, FirestoreError> =
  internal.fromClient;

/**
 * The client SDK's side of Firestore Values: the two-way mapping between the
 * portable values `toCodecFirestore` encodes a model to and the values the
 * client SDK reads and writes.
 *
 * `ClientFirestore` applies it on every read and write. It is exported
 * for writes made through the raw SDK, so the library's models can be used for
 * those too:
 *
 * ```ts
 * const encoded = Schema.encodeSync(toCodecFirestore(Post))(post)
 * await setDoc(doc(firestore, "posts/hello"), ClientFirestoreValue.toClient(encoded, firestore))
 * ```
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
 * The portable `Timestamp`, `GeoPoint` and bytes become the SDK's `Timestamp`,
 * `GeoPoint` and `Bytes`, and the sentinels its `FieldValue`s. A reference is
 * built against `firestore`, so it points into that database. The keys of a
 * map are kept as they are, so the dotted field paths of an update stay field
 * paths.
 *
 * A value that is already the client SDK's own is left as it is.
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const toClient: (value: FirestoreValue, firestore: Firestore) => unknown = internal.toClient;

/**
 * Turns a value the client SDK read into a Firestore Value.
 *
 * Its `Timestamp`, `GeoPoint` and `Bytes` become the portable `Timestamp`,
 * `GeoPoint` and `Uint8Array`. A `DocumentReference` becomes a portable one
 * that keeps its path: what was read does not name the collection definition
 * it belongs to, so `FirestoreSchema.DocumentReference(collection)` resolves it
 * by that path. It fails on a value outside the Firestore Value union, such as
 * a vector, naming the field that holds it.
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const fromClient: (value: unknown) => Result.Result<FirestoreValue, FirestoreError> =
  internal.fromClient;

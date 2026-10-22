/**
 * The Admin SDK's side of Firestore Values: the two-way mapping between the
 * portable values `toCodecFirestore` encodes a model to and the values the
 * Admin SDK reads and writes.
 *
 * {@link AdminFirestore} applies it on every read and write. It is exported for
 * writes made through the raw SDK, so the library's models can be used for
 * those too:
 *
 * ```ts
 * const encoded = Schema.encodeSync(toCodecFirestore(Post))(post)
 * await firestore.doc("posts/hello").set(AdminFirestoreValue.toAdmin(encoded, firestore))
 * ```
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
 * A `DocumentPath` becomes `firestore.doc(path)`, so it points into that
 * database.
 * Every other value is the same whichever database it is written to. The keys
 * of a map are kept as they are, so the dotted field paths of an update stay
 * field paths.
 *
 * It is total over Firestore Values and takes nothing else: a value outside
 * the union, such as the Admin SDK's own or a class instance cast past the type,
 * throws rather than reaching the SDK. A value `toCodecFirestore` encoded is
 * always a Firestore Value.
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const toAdmin: (value: FirestoreValue, firestore: Firestore) => unknown = internal.toAdmin;

/**
 * Turns a value the Admin SDK read into a Firestore Value.
 *
 * Its `Timestamp`, `GeoPoint` and bytes become their portable forms, and its
 * sentinels the portable sentinels. It fails on a value outside the Firestore
 * Value union, such as a vector, naming the field that holds it.
 *
 * A `DocumentReference` becomes the `DocumentPath` it points at, since
 * Firestore stores nothing else of it. `FirestoreSchema.DocumentReference`
 * reads that back into the collection it names.
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const fromAdmin: (value: unknown) => Result.Result<FirestoreValue, FirestoreError> =
  internal.fromAdmin;

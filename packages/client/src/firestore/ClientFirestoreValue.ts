/**
 * The client SDK's mapping between Firestore Values and its own values.
 *
 * Client Firestore writes through {@link toSdkValue} and reads through
 * {@link fromSdkValue}. They are exported for writes the service does not
 * make: encode a document with `toCodecFirestore(model)`, then hand
 * {@link toSdkValue} what it encodes to before writing it through the raw SDK.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Result } from "effect";
import type { FirestoreValue } from "@visiolab/effect-firebase/firestore/FirestoreValue";
import type { Firestore } from "firebase/firestore";
import * as internal from "./internal/firestoreValue.ts";

/**
 * What {@link fromSdkValue} fails with for a value outside the Firestore Value
 * union, such as a vector: the value, and the path to it within what was read.
 *
 * @stability unstable
 * @category errors
 * @since 0.2.0
 */
export const UnsupportedSdkValue: typeof internal.UnsupportedSdkValue =
  internal.UnsupportedSdkValue;

/**
 * @stability unstable
 * @category errors
 * @since 0.2.0
 */
export type UnsupportedSdkValue = internal.UnsupportedSdkValue;

/**
 * Turns a Firestore Value into the client SDK's own value to write.
 *
 * A portable `Timestamp`, `GeoPoint` and bytes become the SDK's `Timestamp`,
 * `GeoPoint` and `Bytes`, a sentinel becomes the SDK's `FieldValue`, and a
 * document reference is built against `firestore`, so it points into that
 * database. Arrays and maps are mapped through, keys kept as they are.
 *
 * @stability unstable
 * @category converting
 * @since 0.2.0
 */
export const toSdkValue: (firestore: Firestore, value: FirestoreValue) => unknown =
  internal.toSdkValue;

/**
 * Turns a value the client SDK read into a Firestore Value.
 *
 * The SDK's `Timestamp`, `GeoPoint` and `Bytes` become the portable
 * `Timestamp`, `GeoPoint` and `Uint8Array`. A reference holds its path only,
 * since nothing read says which collection definition it belongs to, and
 * `FirestoreSchema.DocumentReference(collection)` resolves it by that path. A
 * value outside the Firestore Value union fails with {@link UnsupportedSdkValue}.
 *
 * @stability unstable
 * @category converting
 * @since 0.2.0
 */
export const fromSdkValue: (value: unknown) => Result.Result<FirestoreValue, UnsupportedSdkValue> =
  internal.fromSdkValue;

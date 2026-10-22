/**
 * Marks an `Unknown` node whose value an encoder built for an SDK, so
 * `toCodecFirestore` passes it through instead of asking for a Firestore Value.
 *
 * Temporary, for the encoder-backed `FirestoreSchema` codecs while they still
 * exist (#75, #76).
 *
 * @internal
 */
export const sdkValue = "~@visiolab/effect-firebase/firestore/FirestoreValue/sdkValue";

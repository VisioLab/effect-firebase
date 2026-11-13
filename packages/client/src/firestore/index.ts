/**
 * What a read of one document through Client Firestore returns, with the
 * Snapshot Metadata of the read.
 *
 * @stability unstable
 * @since 0.1.0
 */
export * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
/**
 * Firestore on the Firebase client SDK, for browsers.
 *
 * @stability unstable
 * @since 0.1.0
 */
export * as ClientFirestore from "./ClientFirestore.ts";
/**
 * Maps between Firestore Values and the values the client SDK reads and writes.
 *
 * @stability unstable
 * @since 0.3.0
 */
export * as ClientFirestoreValue from "./ClientFirestoreValue.ts";
/**
 * What a read of many documents through Client Firestore returns, with the
 * Snapshot Metadata of the read.
 *
 * @stability unstable
 * @since 0.1.0
 */
export * as ClientQuerySnapshot from "./ClientQuerySnapshot.ts";
/**
 * Firestore atoms on Client Firestore: live reads that hold Decoded Snapshots,
 * built on `effect/reactivity`.
 *
 * @stability unstable
 * @since 0.4.0
 */
export * as FirestoreAtom from "./FirestoreAtom.ts";

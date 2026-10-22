/**
 * What reading one document through `ClientFirestore` hands back: a
 * portable {@link DocumentSnapshot.DocumentSnapshot} that also carries the
 * {@link SnapshotMetadata} the client SDK reported for it.
 *
 * Each variant extends its portable one, so a client snapshot can be handed to
 * portable code as is, and the portable guards tell its variants apart.
 *
 * ```ts
 * import { ClientDocumentSnapshot } from "@visiolab/effect-firebase-client/firestore";
 *
 * const snapshot = yield* clientFirestore.getDoc(Users.doc(alice));
 *
 * if (snapshot.metadata.fromCache) {
 *   // Served from the local cache, and so possibly out of date.
 * }
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import { withMetadata } from "./internal/snapshot.ts";

/**
 * What the client SDK reports about where a snapshot came from.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface SnapshotMetadata {
  /**
   * Whether it was served from the local cache rather than confirmed by the
   * server, such as while offline, and so may be out of date.
   */
  readonly fromCache: boolean;
  /**
   * Whether it reflects writes made by this client that the server has not
   * acknowledged yet.
   */
  readonly hasPendingWrites: boolean;
}

/**
 * A document that was there when it was read, with the
 * {@link SnapshotMetadata} of that read.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Existing<C extends Collection.Any> extends DocumentSnapshot.Existing<C> {
  readonly metadata: SnapshotMetadata;
}

/**
 * A document that was not there when it was read, with the
 * {@link SnapshotMetadata} of that read: `fromCache` tells "the cache says it
 * is gone" from "the server says it is gone".
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Missing<C extends Collection.Any> extends DocumentSnapshot.Missing<C> {
  readonly metadata: SnapshotMetadata;
}

/**
 * A document in `C`, as a read through `ClientFirestore`
 * found it.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type ClientDocumentSnapshot<C extends Collection.Any> = Existing<C> | Missing<C>;

/**
 * A snapshot of the document at `ref`, from what the client SDK's
 * `snapshot.data()` returned and the `snapshot.metadata` it reported.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  raw: unknown,
  metadata: SnapshotMetadata,
): ClientDocumentSnapshot<C> =>
  withMetadata(DocumentSnapshot.make(ref, raw), metadata) as ClientDocumentSnapshot<C>;

/**
 * A snapshot of a document known to be there, such as one a query returned.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const existing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  raw: unknown,
  metadata: SnapshotMetadata,
): Existing<C> => withMetadata(DocumentSnapshot.existing(ref, raw), metadata);

/**
 * A snapshot of a document known not to be there.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const missing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  metadata: SnapshotMetadata,
): Missing<C> => withMetadata(DocumentSnapshot.missing(ref), metadata);

/**
 * What a read of one document through {@link ClientFirestore.ClientFirestore}
 * returns: a portable {@link DocumentSnapshot.DocumentSnapshot} that also
 * carries the {@link SnapshotMetadata} the client SDK reported for the read.
 *
 * Each variant extends its portable one, so a client snapshot can be handed to
 * portable code as it is, and the portable guards, such as
 * {@link DocumentSnapshot.isExisting}, tell its variants apart.
 *
 * @example Checking whether a read came from the cache
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   name: Schema.String,
 * }) {}
 *
 * const Users = Collection.make("users", User);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* ClientFirestore.ClientFirestore;
 *   const snapshot = yield* firestore.getDoc(Users.doc(Users.id.make("alice")));
 *   if (snapshot.metadata.fromCache) {
 *     // Served from the local cache, so possibly out of date.
 *   }
 * });
 * ```
 *
 * @see {@link ClientQuerySnapshot} for what a read of many documents returns
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as snapshotMetadata from "./internal/snapshotMetadata.ts";

/**
 * What the client SDK reports about where a snapshot came from: the SDK's
 * `SnapshotMetadata`.
 *
 * @see {@link ClientFirestore.ListenOptions} for hearing a change to it on a listen
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface SnapshotMetadata {
  /**
   * Whether it was served from the local cache instead of confirmed by the
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
 * @see {@link DocumentSnapshot.Existing} for the portable snapshot it extends
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Existing<C extends Collection.Any> extends DocumentSnapshot.Existing<C> {
  readonly metadata: SnapshotMetadata;
}

/**
 * A document that was not there when it was read, with the
 * {@link SnapshotMetadata} of that read. Its `fromCache` tells "the cache says
 * it is gone" from "the server says it is gone".
 *
 * @see {@link DocumentSnapshot.Missing} for the portable snapshot it extends
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Missing<C extends Collection.Any> extends DocumentSnapshot.Missing<C> {
  readonly metadata: SnapshotMetadata;
}

/**
 * A document in `C`, as a read through {@link ClientFirestore.ClientFirestore}
 * found it: {@link Existing} or {@link Missing}.
 *
 * @see {@link DocumentSnapshot.DocumentSnapshot} for the portable snapshot
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ClientDocumentSnapshot<C extends Collection.Any> = Existing<C> | Missing<C>;

/**
 * Builds a snapshot of the document at `ref` from what the client SDK's
 * `snapshot.data()` returned and the `snapshot.metadata` it reported.
 *
 * **When to use**
 *
 * Use to turn a snapshot read through the client SDK itself into this
 * library's. An `undefined` `data` builds {@link Missing}, anything else
 * {@link Existing}.
 *
 * @see {@link existing} for a document known to be there
 * @see {@link missing} for a document known not to be there
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  data: unknown,
  metadata: SnapshotMetadata,
): ClientDocumentSnapshot<C> =>
  DocumentSnapshot.make(ref, data, snapshotMetadata.extraOf(metadata));

/**
 * Builds a snapshot of a document known to be there, such as one a query
 * returned.
 *
 * @see {@link make} for a document that may or may not be there
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const existing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  data: unknown,
  metadata: SnapshotMetadata,
): Existing<C> => DocumentSnapshot.existing(ref, data, snapshotMetadata.extraOf(metadata));

/**
 * Builds a snapshot of a document known not to be there.
 *
 * @see {@link make} for a document that may or may not be there
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const missing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  metadata: SnapshotMetadata,
): Missing<C> => DocumentSnapshot.missing(ref, snapshotMetadata.extraOf(metadata));

/**
 * What reading many documents through `ClientFirestore` hands back: a portable
 * {@link QuerySnapshot.QuerySnapshot} that also carries the
 * {@link ClientDocumentSnapshot.SnapshotMetadata} the client SDK reported for
 * the read as a whole, and whose documents carry their own.
 *
 * The query's own metadata is what says where a read that found nothing came
 * from, since there is no document to ask.
 *
 * ```ts
 * import { ClientQuerySnapshot } from "@visiolab/effect-firebase-client/firestore";
 *
 * const snapshot = yield* clientFirestore.getDocs(Users.collection());
 *
 * if (snapshot.docs.length === 0 && snapshot.metadata.fromCache) {
 *   // Nothing in the local cache, which says nothing of the server.
 * }
 * ```
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
import * as snapshotMetadata from "./internal/snapshotMetadata.ts";

/**
 * A client snapshot of a document that was there when it was read, in
 * whichever of the collections `C` it is in, as
 * {@link QuerySnapshot.Existing} is for the portable one.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Existing<C extends Collection.Any> = C extends Collection.Any
  ? ClientDocumentSnapshot.Existing<C>
  : never;

/**
 * The documents in `C` a read of many found, with the
 * {@link ClientDocumentSnapshot.SnapshotMetadata} of that read.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClientQuerySnapshot<
  C extends Collection.Any,
> extends QuerySnapshot.QuerySnapshot<C> {
  /**
   * Every document the read found, in the order Firestore returned them, each
   * with its own metadata, and each of the one collection of `C` it is in.
   */
  readonly docs: ReadonlyArray<Existing<C>>;
  /** Where the read as a whole came from. */
  readonly metadata: ClientDocumentSnapshot.SnapshotMetadata;
}

/**
 * A snapshot of the documents a read of many found, with the
 * `snapshot.metadata` the client SDK reported for the read.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = <C extends Collection.Any>(
  docs: ReadonlyArray<ClientDocumentSnapshot.Existing<C>>,
  metadata: ClientDocumentSnapshot.SnapshotMetadata,
): ClientQuerySnapshot<C> =>
  // The portable `make` types its documents as portable snapshots, though it
  // holds the client ones it was given as they are.
  QuerySnapshot.make(docs, snapshotMetadata.extraOf(metadata)) as ClientQuerySnapshot<C>;

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
 * @since 0.2.0
 */
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
import { withMetadata } from "./internal/snapshot.ts";

/**
 * The documents in `C` a read of many found, with the
 * {@link ClientDocumentSnapshot.SnapshotMetadata} of that read.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ClientQuerySnapshot<
  C extends Collection.Any,
> extends QuerySnapshot.QuerySnapshot<C> {
  /**
   * Every document the read found, in the order Firestore returned them, each
   * with its own metadata.
   */
  readonly docs: ReadonlyArray<ClientDocumentSnapshot.Existing<C>>;
  /** Where the read as a whole came from. */
  readonly metadata: ClientDocumentSnapshot.SnapshotMetadata;
}

/**
 * A snapshot of the documents a read of many found, with the
 * `snapshot.metadata` the client SDK reported for the read.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make = <C extends Collection.Any>(
  docs: ReadonlyArray<ClientDocumentSnapshot.Existing<C>>,
  metadata: ClientDocumentSnapshot.SnapshotMetadata,
): ClientQuerySnapshot<C> =>
  withMetadata(QuerySnapshot.make(docs), metadata) as ClientQuerySnapshot<C>;

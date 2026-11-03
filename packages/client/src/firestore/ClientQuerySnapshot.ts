/**
 * What a read of many documents through
 * {@link ClientFirestore.ClientFirestore} returns: a portable
 * {@link QuerySnapshot.QuerySnapshot} that also carries the
 * {@link ClientDocumentSnapshot.SnapshotMetadata} the client SDK reported for
 * the read as a whole, and whose documents carry their own.
 *
 * The snapshot's own metadata says where a read that found nothing came from,
 * since there is no document to ask.
 *
 * @example Telling an empty cache from an empty collection
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
 *   const snapshot = yield* firestore.getDocs(Users.collection());
 *   if (snapshot.docs.length === 0 && snapshot.metadata.fromCache) {
 *     // Nothing in the local cache, which says nothing of the server.
 *   }
 * });
 * ```
 *
 * @see {@link ClientDocumentSnapshot} for what a read of one document returns
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
import * as snapshotMetadata from "./internal/snapshotMetadata.ts";

/**
 * A client snapshot of a document that was there when it was read, of
 * whichever of the collections in `C` it is in.
 *
 * @see {@link QuerySnapshot.Existing} for the portable type
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
 * Each of its `docs` carries its own metadata too, and is of the one
 * collection in `C` it is in.
 *
 * @see {@link QuerySnapshot.QuerySnapshot} for the portable snapshot it extends
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClientQuerySnapshot<C extends Collection.Any> extends QuerySnapshot.QuerySnapshot<
  C,
  { readonly metadata: ClientDocumentSnapshot.SnapshotMetadata }
> {
  /** Where the read as a whole came from. */
  readonly metadata: ClientDocumentSnapshot.SnapshotMetadata;
}

/**
 * Builds a snapshot of the documents a read of many found, with the
 * `snapshot.metadata` the client SDK reported for the read.
 *
 * **When to use**
 *
 * Use to turn a query snapshot read through the client SDK itself into this
 * library's. Build each document with {@link ClientDocumentSnapshot.existing}.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = <C extends Collection.Any>(
  docs: ReadonlyArray<ClientDocumentSnapshot.Existing<C>>,
  metadata: ClientDocumentSnapshot.SnapshotMetadata,
): ClientQuerySnapshot<C> => QuerySnapshot.make(docs, snapshotMetadata.extraOf(metadata));

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
import type { Effect, Schema } from "effect";
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
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
 * @since 0.3.0
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

/**
 * A decoded client snapshot of a document that was there, of whichever of the
 * collections in `C` it is in.
 *
 * @see {@link QuerySnapshot.DecodedExisting} for the portable type
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export type DecodedExisting<C extends Collection.Any> = C extends Collection.Any
  ? ClientDocumentSnapshot.DecodedExisting<C>
  : never;

/**
 * A {@link ClientQuerySnapshot} whose documents' data has already been read
 * through their models, with the {@link ClientDocumentSnapshot.SnapshotMetadata}
 * of the read.
 *
 * **Details**
 *
 * Each of its `docs` carries its own metadata too, and is of the one
 * collection in `C` it is in.
 *
 * @see {@link QuerySnapshot.DecodedQuerySnapshot} for the portable decoded snapshot it extends
 * @see {@link ClientDocumentSnapshot.DecodedClientDocumentSnapshot} for a decoded read of one document
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export interface DecodedClientQuerySnapshot<
  C extends Collection.Any,
> extends QuerySnapshot.DecodedQuerySnapshot<
  C,
  { readonly metadata: ClientDocumentSnapshot.SnapshotMetadata }
> {
  /** Where the read as a whole came from. */
  readonly metadata: ClientDocumentSnapshot.SnapshotMetadata;
}

/**
 * Reads every document of a {@link ClientQuerySnapshot} through its model
 * once, and returns the Decoded Snapshot with the
 * {@link ClientDocumentSnapshot.SnapshotMetadata} of the read and of each
 * document.
 *
 * **When to use**
 *
 * Use on snapshots read through {@link ClientFirestore.ClientFirestore}, such
 * as each snapshot of a live read, to keep `metadata` in the decoded type.
 * Use {@link QuerySnapshot.decode} in portable code.
 *
 * **Details**
 *
 * Decodes all documents or fails as a whole with a `Schema.SchemaError` when
 * any one does not match its model. No document is dropped. Requires the
 * decoding services of every collection in `C`.
 *
 * @example Decoding a live read of a collection
 * ```ts
 * import { Effect, Schema, Stream } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import {
 *   ClientFirestore,
 *   ClientQuerySnapshot,
 * } from "@visiolab/effect-firebase-client/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   name: Schema.String,
 * }) {}
 *
 * const Users = Collection.make("users", User);
 *
 * const names = Stream.unwrap(
 *   Effect.map(ClientFirestore.ClientFirestore, (firestore) =>
 *     firestore.streamDocs(Users.collection()).pipe(
 *       Stream.mapEffect(ClientQuerySnapshot.decode),
 *       Stream.map((snapshot) => ({
 *         names: snapshot.docs.map((user) => user.data.name),
 *         fromCache: snapshot.metadata.fromCache,
 *       })),
 *     ),
 *   ),
 * );
 * ```
 *
 * @see {@link QuerySnapshot.decode} for the portable decode, which drops the read's `metadata` from the type
 * @see {@link ClientDocumentSnapshot.decode} for decoding a read of one document
 *
 * @stability unstable
 * @category decoding
 * @since 0.4.0
 */
export const decode: <C extends Collection.Any>(
  self: ClientQuerySnapshot<C>,
) => Effect.Effect<
  DecodedClientQuerySnapshot<C>,
  Schema.SchemaError,
  DocumentSnapshot.DecodingServices<C>
> = QuerySnapshot.decode as any;

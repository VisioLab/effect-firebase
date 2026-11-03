/**
 * What a read of many documents hands back.
 *
 * Reading a collection finds any number of documents, and a query snapshot
 * holds them as one result rather than as a bare list. That leaves a place for
 * what is said about the read as a whole rather than about any one document,
 * which an SDK's own Firestore can add to.
 *
 * ```ts
 * import { QuerySnapshot } from "@visiolab/effect-firebase/firestore";
 *
 * const snapshot = yield* firestore.getDocs(Users.ref);
 *
 * for (const user of snapshot.docs) {
 *   console.log(user.id);
 * }
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Inspectable } from "effect";
import type * as Collection from "./Collection.ts";
import type * as DocumentSnapshot from "./DocumentSnapshot.ts";
import * as querySnapshot from "./internal/querySnapshot.ts";

const TypeId = querySnapshot.TypeId;

/**
 * A snapshot of a document that was there when it was read, in whichever of
 * the collections `C` it is in: `Existing<A> | Existing<B>` rather than
 * `Existing<A | B>`, so that its id, ancestors, reference and data all speak
 * of the same collection.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Existing<C extends Collection.Any> = C extends Collection.Any
  ? DocumentSnapshot.Existing<C>
  : never;

/**
 * The documents in `C` a read of many found.
 *
 * `C` is a union when the read was of a Collection Group made of several
 * collections, and each document is then one of theirs.
 *
 * `DocumentExtra` is what an SDK knows about each document beyond the portable
 * snapshot, such as the client's `metadata`, and is on every one of them. What
 * it knows about the read as a whole is not part of this type: it is an
 * intersection where the snapshot is used, as `QuerySnapshot<C, E> & E`.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface QuerySnapshot<C extends Collection.Any, DocumentExtra extends object = {}>
  extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /**
   * Every document the read found, in the order Firestore returned them.
   *
   * Each was there when it was read, which is why these are
   * {@link DocumentSnapshot.Existing}, each of the one collection of `C` it
   * is in, with the `DocumentExtra` each carries.
   */
  readonly docs: ReadonlyArray<Existing<C> & DocumentExtra>;
}

/**
 * What a document snapshot `D` carries beyond the portable one: each of its
 * fields that {@link DocumentSnapshot.Existing} does not have.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type ExtraOf<D extends DocumentSnapshot.Existing<Collection.Any>> = {
  [K in keyof D as K extends keyof DocumentSnapshot.Existing<Collection.Any> ? never : K]: D[K];
};

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isQuerySnapshot: (u: unknown) => u is QuerySnapshot<Collection.Any> =
  querySnapshot.isQuerySnapshot;

/**
 * A snapshot of the documents a read of many found.
 *
 * An SDK that knows more about the read as a whole, such as the client's
 * `metadata`, passes it as `extra`: each of its fields is put on the snapshot,
 * and shown when it prints, as {@link DocumentSnapshot.make} does for one
 * document. Its fields must not be named like the snapshot's own.
 *
 * The documents are held as they are given, so an extra each of them carries
 * stays on them, and in the snapshot's type.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: {
  <C extends Collection.Any, D extends DocumentSnapshot.Existing<C> = DocumentSnapshot.Existing<C>>(
    docs: ReadonlyArray<D> & ReadonlyArray<DocumentSnapshot.Existing<C>>,
  ): QuerySnapshot<C, ExtraOf<D>>;
  <C extends Collection.Any, D extends DocumentSnapshot.Existing<C>, E extends object>(
    docs: ReadonlyArray<D> & ReadonlyArray<DocumentSnapshot.Existing<C>>,
    extra: E,
  ): QuerySnapshot<C, ExtraOf<D>> & E;
} = querySnapshot.make;

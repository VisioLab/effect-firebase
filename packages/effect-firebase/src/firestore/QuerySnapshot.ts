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
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface QuerySnapshot<C extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /**
   * Every document the read found, in the order Firestore returned them.
   *
   * Each was there when it was read, which is why these are
   * {@link DocumentSnapshot.Existing}, each of the one collection of `C` it
   * is in.
   */
  readonly docs: ReadonlyArray<Existing<C>>;
}

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
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: <C extends Collection.Any>(
  docs: ReadonlyArray<DocumentSnapshot.Existing<C>>,
) => QuerySnapshot<C> = querySnapshot.make;

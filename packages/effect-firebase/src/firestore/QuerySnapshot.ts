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
 * The documents in `C` a read of many found.
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
   * {@link DocumentSnapshot.Existing}.
   */
  readonly docs: ReadonlyArray<DocumentSnapshot.Existing<C>>;
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

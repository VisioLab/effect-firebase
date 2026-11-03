/**
 * What a read of many documents returns.
 *
 * A read of a collection or a Collection Group finds any number of documents.
 * A query snapshot holds them as one result rather than a bare array, which
 * leaves room for what a backend knows about the read as a whole, such as the
 * client's `metadata`.
 *
 * @example Reading every document in a collection
 * ```ts
 * import { Collection, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { Effect, Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   const snapshot = yield* firestore.getDocs(Users.collection());
 *   return yield* Effect.forEach(snapshot.docs, (user) => user.data);
 * });
 * ```
 *
 * @see {@link DocumentSnapshot} for what a read of one document returns
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
 * A {@link DocumentSnapshot.Existing} snapshot in whichever of the collections
 * `C` it is in.
 *
 * **Details**
 *
 * For a union `C` it is `Existing<A> | Existing<B>` rather than
 * `Existing<A | B>`, so a document's id, ancestors, reference and data all
 * belong to the same collection.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Existing<C extends Collection.Any> = C extends Collection.Any
  ? DocumentSnapshot.Existing<C>
  : never;

/**
 * The documents of `C` that a read of many documents found.
 *
 * **Details**
 *
 * {@link Firestore.With.getDocs} returns one, and
 * {@link Firestore.With.streamDocs} emits one per change. `C` is a union when
 * the read was of a Collection Group with several members, and each document
 * is then in one of them.
 *
 * `DocumentExtra` is what a backend adds to each document beyond the portable
 * snapshot, such as the client's `metadata`. What it adds to the read as a
 * whole is not part of this type: it is intersected where the snapshot is
 * used, as `QuerySnapshot<C, E> & E`.
 *
 * @see {@link DocumentSnapshot.DocumentSnapshot} for the result of a read of one document
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
   * Empty when there were none.
   *
   * **Details**
   *
   * Each was there when it was read, so each is a
   * {@link DocumentSnapshot.Existing} in the collection of `C` it lives in,
   * with the `DocumentExtra` of the read.
   *
   * @see {@link Collection.Collection.contains} for keeping the documents of one collection
   */
  readonly docs: ReadonlyArray<Existing<C> & DocumentExtra>;
}

/**
 * The fields a document snapshot `D` has beyond the portable
 * {@link DocumentSnapshot.Existing}, such as the client's `metadata`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type ExtraOf<D extends DocumentSnapshot.Existing<Collection.Any>> = {
  [K in keyof D as K extends keyof DocumentSnapshot.Existing<Collection.Any> ? never : K]: D[K];
};

/**
 * Checks whether a value is a {@link QuerySnapshot}.
 *
 * @see {@link DocumentSnapshot.isDocumentSnapshot} for a snapshot of one document
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isQuerySnapshot: (u: unknown) => u is QuerySnapshot<Collection.Any> =
  querySnapshot.isQuerySnapshot;

/**
 * Builds a {@link QuerySnapshot} from the documents a read found.
 *
 * **When to use**
 *
 * Use when implementing a backend or a test double. Application code gets
 * query snapshots from {@link Firestore.With.getDocs} instead.
 *
 * **Details**
 *
 * An SDK that knows more about the read as a whole, such as the client's
 * `metadata`, passes it as `extra`: each of its fields is put on the snapshot
 * and shown when it prints, as {@link DocumentSnapshot.make} does for one
 * document. Its fields must not have the same names as the snapshot's own.
 *
 * The documents are kept as given, so any extra fields on them stay, and stay
 * in the snapshot's type.
 *
 * @see {@link DocumentSnapshot.existing} for building each document
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

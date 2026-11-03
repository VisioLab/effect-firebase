/**
 * Collection Groups: every collection with one collection id, wherever it
 * sits, read together.
 *
 * A group is built from the {@link Collection.Collection} definitions it
 * covers, not from a bare collection id. Each document a read of the group
 * finds is matched to the collection it lives in, and comes back typed,
 * addressed and decoded as that collection's.
 *
 * @example Reading every post of every user
 * ```ts
 * import {
 *   Collection,
 *   CollectionGroup,
 *   Firestore,
 *   FirestoreModel,
 * } from "@visiolab/effect-firebase/firestore";
 * import { Effect, Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 * const UserPosts = Users.subcollection("posts", Post);
 * const AllPosts = CollectionGroup.make(UserPosts);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   const snapshot = yield* firestore.getDocs(AllPosts);
 *   return snapshot.docs.map((post) => post.ref.path);
 * });
 * ```
 *
 * @see {@link Collection} for defining the collections a group is made of
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Inspectable, Result } from "effect";
import type * as Collection from "./Collection.ts";
import type { UndefinedCollectionError } from "./Firestore.ts";
import * as collectionGroup from "./internal/collectionGroup.ts";

const TypeId = collectionGroup.TypeId;

/**
 * The definition of a Collection Group: the collections in `Members`, which
 * all share one collection id.
 *
 * **Details**
 *
 * Like a {@link Collection.Collection}, a group does not point at any data. It
 * has no ids to fill in, so {@link Firestore.With.getDocs} and
 * {@link Firestore.With.streamDocs} take it as it is. Build one with
 * {@link make}.
 *
 * @see {@link Collection.CollectionReference} for reading one collection, under one parent
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface CollectionGroup<Members extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /** The collections it was defined from, in the order they were given. */
  readonly members: ReadonlyArray<Members>;
  /** The collection id its members share, which Firestore reads the group by. */
  readonly id: string;
}

/**
 * Any Collection Group, whatever collections it is made of. Use it as a type
 * bound.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Any = CollectionGroup<any>;

/**
 * The collections `G` was defined from, as a union.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Members<G extends Any> = G extends CollectionGroup<infer M> ? M : never;

/**
 * A reference to a document in one of the collections of `G`, typed by the one
 * it lives in: `DocumentReference<A> | DocumentReference<B>` rather than a
 * reference to `A | B`.
 *
 * @see {@link Collection.DocumentReference} for a reference into one known collection
 * @see {@link Collection.Collection.contains} for narrowing it to one member
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type DocumentReference<G extends Any> =
  Members<G> extends infer C extends Collection.Any
    ? C extends Collection.Any
      ? Collection.DocumentReference<C>
      : never
    : never;

/** Whether `A` and `B` are the same type, rather than one fitting the other. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Whether `A` and `B` are the same path. A path with a segment only known as
 * `string` could be any path, so it is never taken for another here.
 */
type SamePath<A extends ReadonlyArray<string>, B extends ReadonlyArray<string>> = string extends
  | A[number]
  | B[number]
  ? false
  : Same<A, B>;

/** Whether a member of `Members` other than the one at `K` sits at `C`'s path. */
type PathTakenElsewhere<
  Members extends ReadonlyArray<Collection.Any>,
  K,
  C extends Collection.Any,
> = true extends {
  [J in keyof Members]: J extends K ? false : SamePath<Members[J]["path"], C["path"]>;
}[number]
  ? true
  : false;

/**
 * The collections {@link make} accepts as `Members`: each one as it is, or, in
 * place of one that breaks a rule, a message naming the rule. Every member must
 * share the first one's collection id, and no two may sit at the same path.
 *
 * **Details**
 *
 * Members are told apart by their paths, so the same collection listed twice
 * and two definitions built separately at the same path are both refused: a
 * document at that path could belong to either. A path with a segment typed
 * only as `string` is not checked here; {@link make} checks it at runtime.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Valid<Members extends ReadonlyArray<Collection.Any>> = {
  readonly [K in keyof Members]: Members[K] extends Collection.Any
    ? Members[K]["segment"] extends Members[0]["segment"]
      ? PathTakenElsewhere<Members, K, Members[K]> extends true
        ? `Collection Group member '${Members[K]["segment"]}' has the same path as another member`
        : Members[K]
      : `Collection Group member '${Members[K]["segment"]}' does not share the collection id '${Members[0]["segment"]}'`
    : never;
};

/**
 * Checks whether a value is a {@link CollectionGroup}.
 *
 * @see {@link Collection.isCollection} for a collection definition
 * @see {@link Collection.isCollectionReference} for a reference to one collection
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isCollectionGroup: (u: unknown) => u is Any = collectionGroup.isCollectionGroup;

/**
 * Defines a Collection Group from the collections it covers.
 *
 * **When to use**
 *
 * Use to read or listen to documents across every parent at once, such as
 * every user's posts. To read the collection under one parent, pass a
 * {@link Collection.CollectionReference} to {@link Firestore.With.getDocs}
 * instead.
 *
 * **Details**
 *
 * List every collection with the collection id you want to read. A read of
 * the group fails with an `UndefinedCollectionError` when it finds a document
 * under that collection id at a path none of the members define.
 *
 * The type checker refuses members that do not share the first one's
 * collection id, and two members at the same path. The same checks run at
 * runtime: it throws when given no collection, members with different
 * collection ids, or two members at the same path, whether the same one twice
 * or two built separately. An invalid definition is a programming error, as
 * for {@link Collection.make}.
 *
 * @example Grouping collections under different parents
 * ```ts
 * import {
 *   Collection,
 *   CollectionGroup,
 *   Firestore,
 *   FirestoreModel,
 * } from "@visiolab/effect-firebase/firestore";
 * import { Effect, Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const UserPosts = Collection.make("users", User).subcollection("posts", Post);
 * const OrgPosts = Collection.make("orgs", Org).subcollection("posts", Post);
 * const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   const snapshot = yield* firestore.getDocs(AllPosts);
 *   // Only the posts under a user.
 *   return snapshot.docs.filter(UserPosts.contains);
 * });
 * ```
 *
 * @see {@link Collection.make} for defining the member collections
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: <const Members extends readonly [Collection.Any, ...Array<Collection.Any>]>(
  ...members: Valid<Members>
) => CollectionGroup<Members[number]> = collectionGroup.make;

// How the SDK packages match each document a group read finds to its
// collection. Not API: they reach it here because a package can only import
// another's public modules.

/**
 * References the document at `path` in whichever collection of `group` sits
 * there, or fails with the {@link UndefinedCollectionError} a group read
 * reports for a document none of them define.
 *
 * @internal
 */
export const documentAt: <G extends Any>(
  group: G,
  path: string,
) => Result.Result<DocumentReference<G>, UndefinedCollectionError> = collectionGroup.documentAt;

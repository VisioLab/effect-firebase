/**
 * Collection Groups: the collections the model defines under one collection
 * id, wherever each sits, read together as one.
 *
 * A group is built from the {@link Collection.Collection} definitions it stands
 * for rather than from a bare collection id, so that every document a read of
 * it finds still belongs to the one collection it lives in, and comes back
 * typed, addressed and decoded as that collection's.
 *
 * ```ts
 * import { CollectionGroup } from "@visiolab/effect-firebase/firestore";
 *
 * const Users = Collection.make("users", User);
 * const UserPosts = Users.subcollection("posts", Post);
 * const AllPosts = CollectionGroup.make(UserPosts);
 *
 * // Every post of every user.
 * const snapshot = yield* firestore.getDocs(AllPosts);
 * ```
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
 * The definition of a Collection Group: the collections in `Members`, all
 * sharing one collection id.
 *
 * Like a collection definition, a group is inert. It describes what to read
 * without pointing at a database, and has no ids to fill in, so it is read as
 * it is.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface CollectionGroup<Members extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /** The collections it was defined from, in the order they were given. */
  readonly members: ReadonlyArray<Members>;
  /** The collection id they share, which Firestore reads the group by. */
  readonly id: string;
}

/**
 * Any Collection Group, whatever collections it is made of.
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
 * it lives in.
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
 * The collections `Members` a group may be made of: each one as it is, or, in
 * place of one that breaks the rules of a group, a message saying which rule
 * it breaks. Members must share the collection id of the first, and no two
 * may sit at the same path.
 *
 * Members are told apart by their paths, so a collection listed twice and two
 * definitions built separately at the same path are refused alike: a document
 * at that path could not be said to belong to one rather than the other. A
 * path with a segment only known as `string` is left for {@link make} to check
 * when the group is defined.
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
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isCollectionGroup: (u: unknown) => u is Any = collectionGroup.isCollectionGroup;

/**
 * Defines a Collection Group from the collections it stands for.
 *
 * Collections that do not share the collection id of the first, and two
 * collections at the same path, are refused by the type checker.
 *
 * Throws when it is given no collection, collections that do not share their
 * collection id, or two collections at the same path - the same one twice, or
 * two built separately - because a group like that is a mistake in the
 * definition rather than something a caller can recover from, as
 * {@link Collection.make} does for a segment it cannot address.
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

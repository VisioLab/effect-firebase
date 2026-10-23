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
import type { Inspectable, Option } from "effect";
import type * as Collection from "./Collection.ts";
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

/**
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isCollectionGroup: (u: unknown) => u is Any = collectionGroup.isCollectionGroup;

/**
 * Defines a Collection Group from the collections it stands for.
 *
 * Throws when it is given no collection, collections that do not share their
 * collection id, or the same collection twice, because a group like that is a
 * mistake in the definition rather than something a caller can recover from,
 * as {@link Collection.make} does for a segment it cannot address.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: <const Members extends readonly [Collection.Any, ...Array<Collection.Any>]>(
  ...members: Members
) => CollectionGroup<Members[number]> = collectionGroup.make;

/**
 * References the document found at `path` in whichever collection of `group`
 * defines that path, such as `users/alice/posts/hello`.
 *
 * Each collection is checked as {@link Collection.fromPath} checks it, so a
 * path under the group's collection id that none of its collections define
 * comes back as `None`.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromPath: <G extends Any>(
  group: G,
  path: string,
) => Option.Option<DocumentReference<G>> = collectionGroup.fromPath;

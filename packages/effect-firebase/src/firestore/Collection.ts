/**
 * Typed Firestore collections.
 *
 * A collection is defined once - where it sits, how its documents are
 * addressed, and what they hold - and every reference into it is derived from
 * that definition, so a path can only be built out of the ids that actually
 * locate it.
 *
 * @since 0.0.0
 */
import type { Brand, Equal, Inspectable, Schema } from "effect";
import * as collection from "./internal/collection.ts";

const CollectionTypeId = collection.CollectionTypeId;
const CollectionReferenceTypeId = collection.CollectionReferenceTypeId;
const DocumentReferenceTypeId = collection.DocumentReferenceTypeId;

/**
 * A path segment together with the schema of the documents stored under it.
 *
 * @category models
 * @since 0.0.0
 */
export type Level = readonly [segment: string, schema: Schema.Top];

/**
 * The chain of {@link Level}s running from a root collection down to a
 * collection itself.
 *
 * Carrying the whole chain rather than just the collection's own segment is
 * what lets the ids that address a collection stay typed all the way up.
 *
 * @category models
 * @since 0.0.0
 */
export type Levels = readonly [Level, ...ReadonlyArray<Level>];

type Join<S extends ReadonlyArray<string>> = S extends readonly [
  infer Head extends string,
  ...infer Tail extends ReadonlyArray<string>,
]
  ? Tail extends readonly []
    ? Head
    : `${Head}/${Join<Tail>}`
  : never;

/** The last link of the chain. */
type Leaf<L extends Levels> = L extends readonly [...ReadonlyArray<Level>, infer T extends Level]
  ? T
  : never;

/** The segments of a chain, as a tuple. */
type SegmentsOf<L extends Levels> = { readonly [K in keyof L]: L[K][0] };

/**
 * Document ids are branded with the collection's path, so an id only ever fits
 * the collection it came from. Two collections that share a segment - `posts`
 * under `users` and `posts` under `orgs` - still get distinct ids, because the
 * brand is the whole path rather than the last segment.
 */
type IdOf<L extends Levels> = string & Brand.Brand<Join<SegmentsOf<L>>>;

/**
 * One id per ancestor, ordered from the root down. A root collection needs
 * none, which is why the recursion bottoms out at the empty tuple.
 *
 * The parent chain is matched inline rather than looked up through an alias, so
 * that the recursion stays deferred until `L` is a concrete chain. Going
 * through an alias makes it eager, and the compiler gives up on the depth.
 */
type AncestorsOf<L extends Levels> = L extends readonly [...infer I, Level]
  ? I extends Levels
    ? [...AncestorsOf<I>, IdOf<I>]
    : []
  : [];

/**
 * The schema of a document id: decodes a string, and brands it so it cannot
 * address anything else.
 *
 * `Schema.Codec` leaves its constructor input as the `unknown` that
 * `Schema.Top` declares, so pinning it to `string` here is what makes minting
 * an id a compile-time check rather than a runtime throw.
 *
 * @category models
 * @since 0.0.0
 */
export interface IdSchema<T extends string> extends Schema.Codec<T, string> {
  readonly "~type.make.in": string;
}

/**
 * The definition of a collection: where it lives, how its documents are
 * addressed, and what they hold.
 *
 * A definition is inert. It describes a collection without pointing at one, and
 * {@link Collection.collection} and {@link Collection.doc} turn it into a
 * reference once the ids that address it are known.
 *
 * @category models
 * @since 0.0.0
 */
export interface Collection<L extends Levels> extends Inspectable.Inspectable {
  readonly [CollectionTypeId]: typeof CollectionTypeId;
  /**
   * The chain this collection was built from.
   *
   * Only ever read at the type level, by the extractors below. It exists
   * because `L` appears nowhere else in an inferrable position, so without it
   * `C extends Collection<infer L>` has nothing to infer from.
   */
  readonly "~levels": L;
  /** The path segments, from the root collection down. */
  readonly path: SegmentsOf<L>;
  /** The last segment, which is the collection id Firestore knows it by. */
  readonly segment: Leaf<L>[0];
  /** Decodes a document id. */
  readonly id: IdSchema<IdOf<L>>;
  /** The schema of the documents in this collection. */
  readonly schema: Leaf<L>[1];

  /**
   * Defines a subcollection of the documents in this collection.
   *
   * @category constructors
   */
  subcollection<const Segment extends string, S extends Schema.Top>(
    segment: Segment,
    schema: S,
  ): Collection<readonly [...L, readonly [Segment, S]]>;

  /**
   * References this collection, given one id per ancestor.
   *
   * @category constructors
   */
  collection(...ids: AncestorsOf<L>): CollectionReference<Collection<L>>;

  /**
   * References a document in this collection, given one id per ancestor
   * followed by the document's own.
   *
   * @category constructors
   */
  doc(...ids: [...AncestorsOf<L>, IdOf<L>]): DocumentReference<Collection<L>>;
}

/**
 * Any collection, whatever it is nested under and whatever it holds.
 *
 * `Collection<Levels>` would be the honest bound, but `L` sits in an argument
 * position in {@link Collection.doc}, which makes it invariant.
 *
 * @category models
 * @since 0.0.0
 */
export type Any = Collection<any>;

/**
 * The id of a document in `C`.
 *
 * @category models
 * @since 0.0.0
 */
export type Id<C extends Any> = IdOf<C["~levels"]>;

/**
 * One id per ancestor of `C`, ordered from the root down.
 *
 * @category models
 * @since 0.0.0
 */
export type Ancestors<C extends Any> = AncestorsOf<C["~levels"]>;

/**
 * The schema of the documents in `C`.
 *
 * @category models
 * @since 0.0.0
 */
export type DocumentSchema<C extends Any> = Leaf<C["~levels"]>[1];

/**
 * A reference to one collection, addressed by the ids of its ancestors.
 *
 * @category models
 * @since 0.0.0
 */
export interface CollectionReference<C extends Any> extends Inspectable.Inspectable, Equal.Equal {
  readonly [CollectionReferenceTypeId]: typeof CollectionReferenceTypeId;
  /** The definition this reference was built from. */
  readonly collection: C;
  /** The ids that address it, from the root down. */
  readonly ancestors: Readonly<Ancestors<C>>;
  /** The collection id Firestore knows it by, which is the last segment. */
  readonly id: Leaf<C["~levels"]>[0];
  /** The full path, such as `users/alice/posts`. */
  readonly path: string;

  /**
   * References a document in this collection.
   *
   * @category constructors
   */
  doc(id: Id<C>): DocumentReference<C>;
}

/**
 * A reference to one document.
 *
 * @category models
 * @since 0.0.0
 */
export interface DocumentReference<C extends Any> extends Inspectable.Inspectable, Equal.Equal {
  readonly [DocumentReferenceTypeId]: typeof DocumentReferenceTypeId;
  /** The definition of the collection holding it. */
  readonly collection: C;
  /** The ids addressing that collection, from the root down. */
  readonly ancestors: Readonly<Ancestors<C>>;
  /** Its own id. */
  readonly id: Id<C>;
  /** The full path, such as `users/alice/posts/hello`. */
  readonly path: string;
  /** The collection holding it. */
  readonly parent: CollectionReference<C>;
}

/**
 * @category guards
 * @since 0.0.0
 */
export const isCollection: (u: unknown) => u is Any = collection.isCollection;

/**
 * @category guards
 * @since 0.0.0
 */
export const isCollectionReference: (u: unknown) => u is CollectionReference<Any> =
  collection.isCollectionReference;

/**
 * @category guards
 * @since 0.0.0
 */
export const isDocumentReference: (u: unknown) => u is DocumentReference<Any> =
  collection.isDocumentReference;

/**
 * Defines a root collection.
 *
 * Subcollections hang off the result through {@link Collection.subcollection},
 * so a collection is always defined in terms of where it actually sits.
 *
 * Throws when the segment is not one Firestore can address, because a path that
 * cannot be built is a mistake in the definition rather than something a caller
 * can recover from.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make: <const Segment extends string, S extends Schema.Top>(
  segment: Segment,
  schema: S,
) => Collection<readonly [readonly [Segment, S]]> = collection.make;

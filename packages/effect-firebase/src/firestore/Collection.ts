/**
 * Typed Firestore collections.
 *
 * A collection is defined once - where it sits, how its documents are
 * addressed, and what they hold - and every reference into it is derived from
 * that definition, so a path can only be built out of the ids that actually
 * locate it.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type { Brand, Equal, Inspectable, Option, Schema } from "effect";
import type * as FirestoreModel from "./FirestoreModel.ts";
import * as collection from "./internal/collection.ts";
import * as untypedReference from "./internal/untypedReference.ts";

const CollectionTypeId = collection.CollectionTypeId;
const CollectionReferenceTypeId = collection.CollectionReferenceTypeId;
const DocumentReferenceTypeId = collection.DocumentReferenceTypeId;

/**
 * A path segment together with the model of the documents stored under it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Level = readonly [segment: string, schema: FirestoreModel.Any];

/**
 * The chain of {@link Level}s running from a root collection down to a
 * collection itself.
 *
 * Carrying the whole chain rather than just the collection's own segment is
 * what lets the ids that address a collection stay typed all the way up.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
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
 * @stability unstable
 * @category models
 * @since 0.1.0
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
 * @stability unstable
 * @category models
 * @since 0.1.0
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
  /**
   * The model of the documents in this collection, which they are read
   * through, and whose {@link FirestoreModel.Class.create} and
   * {@link FirestoreModel.Class.update} they are written through.
   */
  readonly schema: Leaf<L>[1];

  /**
   * Defines a subcollection of the documents in this collection.
   *
   * @category constructors
   */
  subcollection<const Segment extends string, S extends FirestoreModel.Any>(
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Any = Collection<any>;

/**
 * The id of a document in `C`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id<C extends Any> = IdOf<C["~levels"]>;

/**
 * One id per ancestor of `C`, ordered from the root down.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Ancestors<C extends Any> = AncestorsOf<C["~levels"]>;

/**
 * The model of the documents in `C`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DocumentSchema<C extends Any> = Leaf<C["~levels"]>[1];

/**
 * A reference to one collection, addressed by the ids of its ancestors.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
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
 * @stability unstable
 * @category models
 * @since 0.1.0
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
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCollection: (u: unknown) => u is Any = collection.isCollection;

/**
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCollectionReference: (u: unknown) => u is CollectionReference<Any> =
  collection.isCollectionReference;

/**
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDocumentReference: (u: unknown) => u is DocumentReference<Any> =
  collection.isDocumentReference;

/**
 * Defines a root collection.
 *
 * Subcollections hang off the result through {@link Collection.subcollection},
 * so a collection is always defined in terms of where it actually sits.
 *
 * Its documents are described by a {@link FirestoreModel.Class} rather than a
 * plain schema, since a document is written in other shapes than it is read
 * in, and a model is what carries them.
 *
 * Throws when the segment is not one Firestore can address, because a path that
 * cannot be built is a mistake in the definition rather than something a caller
 * can recover from.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make: <const Segment extends string, S extends FirestoreModel.Any>(
  segment: Segment,
  schema: S,
) => Collection<readonly [readonly [Segment, S]]> = collection.make;

/**
 * References the document in `collection` found at `path`, such as
 * `users/alice/posts/hello`.
 *
 * The path is checked against the segments the collection was defined with,
 * so a path into any other collection - one sharing its last segment included -
 * comes back as `None`.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromPath: <C extends Any>(
  collection: C,
  path: string,
) => Option.Option<DocumentReference<C>> = collection.fromPath;

/**
 * References the document found at `path`, without knowing the collection it
 * was defined through.
 *
 * This is how a reference read back from Firestore is held before a schema
 * claims it, since its path is all Firestore hands back. Every reference built
 * from the same path is equal to every other, but not to one built from a
 * collection defined with {@link make}: `FirestoreSchema.DocumentReference`
 * turns it into one of those by its path.
 *
 * Comes back as `None` when `path` does not address a document.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromPathUntyped: (path: string) => Option.Option<DocumentReference<Any>> =
  untypedReference.fromPathUntyped;

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
import type { Brand } from "effect";
import { Equal, Hash, Inspectable, Predicate, Schema } from "effect";

const CollectionTypeId = "~@visiolab/effect-firebase/Firestore/Collection";
const CollectionReferenceTypeId = "~@visiolab/effect-firebase/Firestore/CollectionReference";
const DocumentReferenceTypeId = "~@visiolab/effect-firebase/Firestore/DocumentReference";

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
export const isCollection = (u: unknown): u is Any => Predicate.hasProperty(u, CollectionTypeId);

/**
 * @category guards
 * @since 0.0.0
 */
export const isCollectionReference = (u: unknown): u is CollectionReference<Any> =>
  Predicate.hasProperty(u, CollectionReferenceTypeId);

/**
 * @category guards
 * @since 0.0.0
 */
export const isDocumentReference = (u: unknown): u is DocumentReference<Any> =>
  Predicate.hasProperty(u, DocumentReferenceTypeId);

const encoder = new TextEncoder();

/** Rejects the segments Firestore cannot address, before they reach a path. */
const validateSegment = (segment: string): void => {
  const reject = (reason: string): never => {
    throw new Error(`Invalid Firestore collection id "${segment}": ${reason}`);
  };
  if (segment.length === 0) reject("it must not be empty");
  if (segment.includes("/")) reject('it must not contain "/"');
  if (segment === "." || segment === "..") reject('it must not be "." or ".."');
  if (/^__.*__$/.test(segment)) reject('it must not match "__.*__"');
  if (encoder.encode(segment).length > 1500) reject("it must be at most 1500 bytes");
};

const brandId = (path: ReadonlyArray<string>) => Schema.String.pipe(Schema.brand(path.join("/")));

/** Interleaves the segments with the ids addressing them: `a/1/b/2/c`. */
const joinPath = (segments: ReadonlyArray<string>, ancestors: ReadonlyArray<string>): string => {
  let path = segments[0];
  for (let i = 0; i < ancestors.length; i++) path += `/${ancestors[i]}/${segments[i + 1]}`;
  return path;
};

/**
 * The untyped shapes behind the exported ones.
 *
 * Everything below works on plain segments and ids. The types above are what
 * make a path only buildable out of the ids that address it, so the runtime has
 * no work left to do beyond joining strings.
 */
interface CollectionImpl {
  readonly path: ReadonlyArray<string>;
  readonly segment: string;
  readonly schema: Schema.Top;
  readonly id: Schema.Top;
  subcollection(segment: string, schema: Schema.Top): CollectionImpl;
  collection(...ancestors: ReadonlyArray<string>): CollectionReferenceImpl;
  doc(...ids: ReadonlyArray<string>): DocumentReferenceImpl;
}

interface CollectionReferenceImpl {
  readonly collection: CollectionImpl;
  readonly ancestors: ReadonlyArray<string>;
  readonly id: string;
  readonly path: string;
  doc(id: string): DocumentReferenceImpl;
}

interface DocumentReferenceImpl {
  readonly collection: CollectionImpl;
  readonly ancestors: ReadonlyArray<string>;
  readonly id: string;
  readonly path: string;
  readonly parent: CollectionReferenceImpl;
}

const CollectionProto = {
  ...Inspectable.BaseProto,
  [CollectionTypeId]: CollectionTypeId,
  toJSON(this: CollectionImpl) {
    return { _id: "Collection", path: this.path.join("/") };
  },
  subcollection(this: CollectionImpl, segment: string, schema: Schema.Top): CollectionImpl {
    validateSegment(segment);
    const path = [...this.path, segment];
    return makeCollection(path, schema, brandId(path));
  },
  collection(this: CollectionImpl, ...ancestors: ReadonlyArray<string>): CollectionReferenceImpl {
    return makeCollectionReference(this, ancestors);
  },
  doc(this: CollectionImpl, ...ids: ReadonlyArray<string>): DocumentReferenceImpl {
    const parent = makeCollectionReference(this, ids.slice(0, -1));
    return makeDocumentReference(parent, ids[ids.length - 1]);
  },
};

/**
 * The target is asserted as the prototype rather than as the finished shape, so
 * that the result type is inferred from the fields below. The return annotation
 * then catches a field that is missing, misspelled or of the wrong type -
 * asserting the finished shape up front would check none of the three.
 */
const makeCollection = (
  path: ReadonlyArray<string>,
  schema: Schema.Top,
  id: Schema.Top,
): CollectionImpl =>
  Object.assign(Object.create(CollectionProto) as typeof CollectionProto, {
    path,
    segment: path[path.length - 1],
    schema,
    id,
  });

const CollectionReferenceProto = {
  ...Inspectable.BaseProto,
  [CollectionReferenceTypeId]: CollectionReferenceTypeId,
  toJSON(this: CollectionReferenceImpl) {
    return { _id: "CollectionReference", path: this.path };
  },
  // The definition is compared by reference: it is written once and named, and
  // `Equal.equals` would otherwise walk the whole schema behind it.
  [Equal.symbol](this: CollectionReferenceImpl, that: unknown): boolean {
    return (
      isCollectionReference(that) && this.path === that.path && this.collection === that.collection
    );
  },
  [Hash.symbol](this: CollectionReferenceImpl): number {
    return Hash.combine(Hash.string(this.path), Hash.random(this.collection));
  },
  doc(this: CollectionReferenceImpl, id: string): DocumentReferenceImpl {
    return makeDocumentReference(this, id);
  },
};

const makeCollectionReference = (
  collection: CollectionImpl,
  ancestors: ReadonlyArray<string>,
): CollectionReferenceImpl =>
  Object.assign(Object.create(CollectionReferenceProto) as typeof CollectionReferenceProto, {
    collection,
    ancestors,
    id: collection.segment,
    path: joinPath(collection.path, ancestors),
  });

const DocumentReferenceProto = {
  ...Inspectable.BaseProto,
  [DocumentReferenceTypeId]: DocumentReferenceTypeId,
  toJSON(this: DocumentReferenceImpl) {
    return { _id: "DocumentReference", path: this.path };
  },
  // The definition is compared by reference: it is written once and named, and
  // `Equal.equals` would otherwise walk the whole schema behind it.
  [Equal.symbol](this: DocumentReferenceImpl, that: unknown): boolean {
    return (
      isDocumentReference(that) && this.path === that.path && this.collection === that.collection
    );
  },
  [Hash.symbol](this: DocumentReferenceImpl): number {
    return Hash.combine(Hash.string(this.path), Hash.random(this.collection));
  },
};

/** A document is always built from the collection holding it, which it keeps. */
const makeDocumentReference = (
  parent: CollectionReferenceImpl,
  id: string,
): DocumentReferenceImpl =>
  Object.assign(Object.create(DocumentReferenceProto) as typeof DocumentReferenceProto, {
    collection: parent.collection,
    ancestors: parent.ancestors,
    id,
    path: `${parent.path}/${id}`,
    parent,
  });

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
export const make = <const Segment extends string, S extends Schema.Top>(
  segment: Segment,
  schema: S,
): Collection<readonly [readonly [Segment, S]]> => {
  validateSegment(segment);
  const path = [segment];
  return makeCollection(path, schema, brandId(path)) as unknown as Collection<
    readonly [readonly [Segment, S]]
  >;
};

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
import { Schema } from "effect";

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
 * what lets the ids that address a collection, and its parent, stay typed all
 * the way up.
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
 * The collection a chain is nested under, or `undefined` at the root.
 *
 * Inferring the head of a tuple drops its `readonly`, so it goes back on before
 * the chain is handed to `Collection`, which would otherwise hold a chain that
 * no collection can actually have.
 */
type ParentOf<L extends Levels> = L extends readonly [...infer I, Level]
  ? Readonly<I> extends infer P extends Levels
    ? Collection<P>
    : undefined
  : undefined;

/** The document a chain is nested under, or `undefined` at the root. */
type ParentDocumentOf<L extends Levels> = L extends readonly [...infer I, Level]
  ? Readonly<I> extends infer P extends Levels
    ? DocumentReference<Collection<P>>
    : undefined
  : undefined;

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
export interface Collection<L extends Levels> {
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
  /** Decodes a document id, and brands it so it cannot address anything else. */
  readonly id: Schema.Codec<IdOf<L>, string>;
  /** The schema of the documents in this collection. */
  readonly schema: Leaf<L>[1];
  /** The collection this one is nested under, or `undefined` at the root. */
  readonly parent: ParentOf<L>;

  /**
   * Defines a subcollection of the documents in this collection.
   *
   * @category constructors
   */
  subcollection<const Segment extends string, S extends Schema.Top>(
    segment: Segment,
    schema: S,
    options?: Options,
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
 * @category models
 * @since 0.0.0
 */
export interface Options {
  /**
   * Decodes a document id. Defaults to any string.
   *
   * Whatever is passed is branded with the collection's path on top of its own
   * checks, so ids stay distinct per collection.
   */
  readonly id?: Schema.Codec<string, string> | undefined;
}

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
 * The collection `C` is nested under, or `undefined` when `C` is a root
 * collection.
 *
 * @category models
 * @since 0.0.0
 */
export type Parent<C extends Any> = ParentOf<C["~levels"]>;

/**
 * A reference to one collection, addressed by the ids of its ancestors.
 *
 * @category models
 * @since 0.0.0
 */
export interface CollectionReference<C extends Any> {
  /** The definition this reference was built from. */
  readonly collection: C;
  /** The ids that address it, from the root down. */
  readonly ancestors: Readonly<Ancestors<C>>;
  /** The collection id Firestore knows it by, which is the last segment. */
  readonly id: Leaf<C["~levels"]>[0];
  /** The full path, such as `users/alice/posts`. */
  readonly path: string;
  /** The document it is nested under, or `undefined` at the root. */
  readonly parent: ParentDocumentOf<C["~levels"]>;

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
export interface DocumentReference<C extends Any> {
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

/** Rejects the segments Firestore cannot address, before they reach a path. */
const validateSegment = (segment: string): void => {
  const reject = (reason: string): never => {
    throw new Error(`Invalid Firestore collection id "${segment}": ${reason}`);
  };
  if (segment.length === 0) reject("it must not be empty");
  if (segment.includes("/")) reject('it must not contain "/"');
  if (segment === "." || segment === "..") reject('it must not be "." or ".."');
  if (/^__.*__$/.test(segment)) reject('it must not match "__.*__"');
  if (new TextEncoder().encode(segment).length > 1500) reject("it must be at most 1500 bytes");
};

const brandId = (path: ReadonlyArray<string>, id: Schema.Codec<string, string> | undefined) =>
  (id ?? Schema.String).pipe(Schema.brand(path.join("/")));

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
  readonly schema: Schema.Top;
  readonly id: Schema.Top;
  readonly parent: CollectionImpl | undefined;
  readonly segment: string;
  subcollection(segment: string, schema: Schema.Top, options?: Options): CollectionImpl;
  collection(...ancestors: ReadonlyArray<string>): CollectionReferenceImpl;
  doc(...ids: ReadonlyArray<string>): DocumentReferenceImpl;
}

interface CollectionReferenceImpl {
  readonly collection: CollectionImpl;
  readonly ancestors: ReadonlyArray<string>;
  readonly id: string;
  readonly path: string;
  readonly parent: DocumentReferenceImpl | undefined;
  doc(id: string): DocumentReferenceImpl;
}

interface DocumentReferenceImpl {
  readonly collection: CollectionImpl;
  readonly ancestors: ReadonlyArray<string>;
  readonly id: string;
  readonly path: string;
  readonly parent: CollectionReferenceImpl;
}

const CollectionProto: ThisType<CollectionImpl> = {
  get segment(): string {
    return this.path[this.path.length - 1];
  },
  subcollection(segment: string, schema: Schema.Top, options?: Options): CollectionImpl {
    validateSegment(segment);
    const path = [...this.path, segment];
    return makeCollection(path, schema, brandId(path, options?.id), this);
  },
  collection(...ancestors: ReadonlyArray<string>): CollectionReferenceImpl {
    return makeCollectionReference(this, ancestors);
  },
  doc(...ids: ReadonlyArray<string>): DocumentReferenceImpl {
    return makeDocumentReference(this, ids.slice(0, -1), ids[ids.length - 1]);
  },
};

const makeCollection = (
  path: ReadonlyArray<string>,
  schema: Schema.Top,
  id: Schema.Top,
  parent: CollectionImpl | undefined,
): CollectionImpl =>
  Object.assign(Object.create(CollectionProto) as CollectionImpl, { path, schema, id, parent });

const CollectionReferenceProto: ThisType<CollectionReferenceImpl> = {
  get id(): string {
    return this.collection.segment;
  },
  get path(): string {
    return joinPath(this.collection.path, this.ancestors);
  },
  // The last ancestor id is the id of the document this collection sits under,
  // and the rest address that document's own collection.
  get parent(): DocumentReferenceImpl | undefined {
    const parent = this.collection.parent;
    return parent === undefined
      ? undefined
      : makeDocumentReference(
          parent,
          this.ancestors.slice(0, -1),
          this.ancestors[this.ancestors.length - 1],
        );
  },
  doc(id: string): DocumentReferenceImpl {
    return makeDocumentReference(this.collection, this.ancestors, id);
  },
};

const makeCollectionReference = (
  collection: CollectionImpl,
  ancestors: ReadonlyArray<string>,
): CollectionReferenceImpl =>
  Object.assign(Object.create(CollectionReferenceProto) as CollectionReferenceImpl, {
    collection,
    ancestors,
  });

const DocumentReferenceProto: ThisType<DocumentReferenceImpl> = {
  get path(): string {
    return `${joinPath(this.collection.path, this.ancestors)}/${this.id}`;
  },
  get parent(): CollectionReferenceImpl {
    return makeCollectionReference(this.collection, this.ancestors);
  },
};

const makeDocumentReference = (
  collection: CollectionImpl,
  ancestors: ReadonlyArray<string>,
  id: string,
): DocumentReferenceImpl =>
  Object.assign(Object.create(DocumentReferenceProto) as DocumentReferenceImpl, {
    collection,
    ancestors,
    id,
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
  options?: Options,
): Collection<readonly [readonly [Segment, S]]> => {
  validateSegment(segment);
  const path = [segment];
  return makeCollection(
    path,
    schema,
    brandId(path, options?.id),
    undefined,
  ) as unknown as Collection<readonly [readonly [Segment, S]]>;
};

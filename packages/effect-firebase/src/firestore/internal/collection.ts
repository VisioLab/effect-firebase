import { Equal, Hash, Inspectable, Option, Predicate, Schema } from "effect";
import type * as Collection from "../Collection.ts";
import type * as FirestoreModel from "../FirestoreModel.ts";

/** @internal */
export const CollectionTypeId = "~@visiolab/effect-firebase/firestore/Collection";

/** @internal */
export const CollectionReferenceTypeId = "~@visiolab/effect-firebase/firestore/CollectionReference";

/** @internal */
export const DocumentReferenceTypeId = "~@visiolab/effect-firebase/firestore/DocumentReference";

/** @internal */
export const isCollection = (u: unknown): u is Collection.Any =>
  Predicate.hasProperty(u, CollectionTypeId);

/** @internal */
export const isCollectionReference = (
  u: unknown,
): u is Collection.CollectionReference<Collection.Any> =>
  Predicate.hasProperty(u, CollectionReferenceTypeId);

/** @internal */
export const isDocumentReference = (
  u: unknown,
): u is Collection.DocumentReference<Collection.Any> =>
  Predicate.hasProperty(u, DocumentReferenceTypeId);

/**
 * An SDK's reference is told apart from a map that happens to hold an `id` and
 * a `path` by the `parent` and `firestore` both SDKs hang off it, which a map
 * read back from Firestore never carries.
 *
 * @internal
 */
export const isDocumentReferenceLike = (u: unknown): u is Collection.DocumentReferenceLike =>
  isDocumentReference(u) ||
  (Predicate.hasProperty(u, "id") &&
    Predicate.hasProperty(u, "path") &&
    Predicate.hasProperty(u, "parent") &&
    Predicate.hasProperty(u, "firestore") &&
    Predicate.isString(u.id) &&
    Predicate.isString(u.path));

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

/**
 * Brands an id schema with the path addressing it.
 *
 * The path is only known at runtime, and `Schema.brand` rejects an open `string`
 * key. Narrowing the key to a placeholder literal keeps the real path on the
 * annotation: the static brand is erased where `makeCollection` takes the schema
 * as `Schema.Top`, and the public id types are built above it.
 */
const brandId = (path: ReadonlyArray<string>) =>
  Schema.String.pipe(Schema.brand(path.join("/") as "~firestore/collection-path"));

/** Interleaves the segments with the ids addressing them: `a/1/b/2/c`. */
const joinPath = (segments: ReadonlyArray<string>, ancestors: ReadonlyArray<string>): string => {
  let path = segments[0];
  for (let i = 0; i < ancestors.length; i++) path += `/${ancestors[i]}/${segments[i + 1]}`;
  return path;
};

/**
 * The untyped shapes behind the exported ones.
 *
 * Everything below works on plain segments and ids. The public types are what
 * make a path only buildable out of the ids that address it, so the runtime has
 * no work left to do beyond joining strings.
 */
interface CollectionImpl {
  readonly path: ReadonlyArray<string>;
  readonly segment: string;
  readonly schema: FirestoreModel.Any;
  readonly id: Schema.Top;
  subcollection(segment: string, schema: FirestoreModel.Any): CollectionImpl;
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
  subcollection(this: CollectionImpl, segment: string, schema: FirestoreModel.Any): CollectionImpl {
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
  schema: FirestoreModel.Any,
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

/** @internal */
export const make = <const Segment extends string, S extends FirestoreModel.Any>(
  segment: Segment,
  schema: S,
): Collection.Collection<readonly [readonly [Segment, S]]> => {
  validateSegment(segment);
  const path = [segment];
  return makeCollection(path, schema, brandId(path)) as unknown as Collection.Collection<
    readonly [readonly [Segment, S]]
  >;
};

/** @internal */
export const fromPath = <C extends Collection.Any>(
  collection: C,
  path: string,
): Option.Option<Collection.DocumentReference<C>> => {
  const self = collection as unknown as CollectionImpl;
  const parts = path.split("/");
  if (parts.length !== self.path.length * 2) return Option.none();
  const ids: Array<string> = [];
  for (let i = 0; i < self.path.length; i++) {
    const id = parts[2 * i + 1];
    if (parts[2 * i] !== self.path[i] || id.length === 0) return Option.none();
    ids.push(id);
  }
  return Option.some(self.doc(...ids) as unknown as Collection.DocumentReference<C>);
};

/**
 * The path a document in `collection` is found at, with `{id}` standing in for
 * each id: `users/{id}/posts/{id}`.
 *
 * @internal
 */
export const pattern = (collection: Collection.Any): string =>
  (collection as unknown as CollectionImpl).path.map((segment) => `${segment}/{id}`).join("/");

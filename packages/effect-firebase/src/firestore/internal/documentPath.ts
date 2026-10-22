import { Equal, Hash, Inspectable, Option, Predicate } from "effect";
import type * as DocumentPath from "../DocumentPath.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/DocumentPath";

/** A collection id, then a document id, and so on: an even number of non-empty segments. */
const addressesDocument = (path: string): boolean => {
  const segments = path.split("/");
  return segments.length % 2 === 0 && segments.every((segment) => segment.length > 0);
};

/** @internal */
export const isDocumentPath = (u: unknown): u is DocumentPath.DocumentPath =>
  Predicate.hasProperty(u, TypeId) &&
  u[TypeId] === TypeId &&
  Predicate.hasProperty(u, "path") &&
  Predicate.isString(u.path);

const Proto: Omit<DocumentPath.DocumentPath, "path"> = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: DocumentPath.DocumentPath) {
    return { _id: "DocumentPath", path: this.path };
  },
  [Equal.symbol](this: DocumentPath.DocumentPath, that: unknown): boolean {
    return isDocumentPath(that) && this.path === that.path;
  },
  [Hash.symbol](this: DocumentPath.DocumentPath): number {
    return Hash.string(this.path);
  },
};

/**
 * Builds the value without checking `path`, for one that already addresses a
 * document, such as a reference's own.
 *
 * @internal
 */
export const makeUnchecked = (path: string): DocumentPath.DocumentPath =>
  Object.assign(Object.create(Proto) as typeof Proto, { path });

/** @internal */
export const make = (path: string): Option.Option<DocumentPath.DocumentPath> =>
  addressesDocument(path) ? Option.some(makeUnchecked(path)) : Option.none();

/** @internal */
export const makeUnsafe = (path: string): DocumentPath.DocumentPath => {
  if (!addressesDocument(path)) {
    throw new Error(`Invalid Firestore document path "${path}": it must address a document`);
  }
  return makeUnchecked(path);
};

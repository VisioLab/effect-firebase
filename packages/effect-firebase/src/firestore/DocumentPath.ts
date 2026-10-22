/**
 * Firestore document paths.
 *
 * Firestore stores a reference to a document as the document's path and
 * nothing else, and hands it back as a `DocumentReference` belonging to
 * whichever SDK read it. This module owns that value without depending on an
 * SDK: it is the Firestore Value a reference is written and read as.
 *
 * It is not a `Collection.DocumentReference`, which also knows the collection
 * it was defined through, and so the model of the document it points at.
 * `FirestoreSchema.DocumentReference(collection)` turns one into the other.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Equal, Inspectable, Option } from "effect";
import * as documentPath from "./internal/documentPath.ts";

const TypeId = documentPath.TypeId;

/**
 * A reference to a document as Firestore stores it: the document's path, such
 * as `users/alice/posts/hello`. Two are equal when their paths are.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface DocumentPath extends Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /** The path of the document, from the root of the database. */
  readonly path: string;
}

/**
 * Whether `u` is a {@link DocumentPath} this module built.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isDocumentPath: (u: unknown) => u is DocumentPath = documentPath.isDocumentPath;

/**
 * The document found at `path`, or `None` when `path` does not address a
 * document: when it is empty, holds an empty segment, or ends in a collection.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: (path: string) => Option.Option<DocumentPath> = documentPath.make;

/**
 * The document found at `path`, throwing when `path` does not address a
 * document.
 *
 * @see {@link make} for the same check without the throw.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const makeUnsafe: (path: string) => DocumentPath = documentPath.makeUnsafe;

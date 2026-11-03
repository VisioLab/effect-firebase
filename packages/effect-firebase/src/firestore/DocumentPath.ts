/**
 * Untyped references to Firestore documents, independent of either SDK.
 *
 * Firestore stores a reference to a document as the document's path alone,
 * and each SDK reads it back as its own `DocumentReference` class. This module
 * owns a portable version of that value: the Firestore Value a reference is
 * written and read as.
 *
 * A `DocumentPath` does not know which collection it points into, or what the
 * document holds. A {@link Collection.DocumentReference} does.
 *
 * @see {@link FirestoreSchema.DocumentPath} for storing an untyped reference in a document
 * @see {@link FirestoreSchema.DocumentReference} for storing a typed reference in a document
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Equal, Inspectable, Option } from "effect";
import * as documentPath from "./internal/documentPath.ts";

const TypeId = documentPath.TypeId;

/**
 * A reference to a document as Firestore stores it: the document's path, such
 * as `users/alice/posts/hello`.
 *
 * **When to use**
 *
 * Use for a reference whose target collection the model does not know, or
 * does not care about. Prefer {@link Collection.DocumentReference}, through
 * {@link FirestoreSchema.DocumentReference}, when the field always points into
 * a known collection: it keeps the target's ids and model typed.
 *
 * **Details**
 *
 * Two are equal when their paths are.
 *
 * @see {@link Collection.DocumentReference} for a reference that knows its collection and model
 * @see {@link FirestoreSchema.DocumentPath} for the schema of this value
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
 * Checks whether `u` is a {@link DocumentPath} built by this module.
 *
 * An SDK's own `DocumentReference` is not one.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isDocumentPath: (u: unknown) => u is DocumentPath = documentPath.isDocumentPath;

/**
 * Builds a reference to the document at `path`, or `None` when `path` does not
 * address a document.
 *
 * **When to use**
 *
 * Use when the path comes from outside the program and may be invalid.
 *
 * **Details**
 *
 * Returns `None` when `path` is empty, has an empty segment, or has an odd
 * number of segments and so ends in a collection.
 *
 * @example Building a reference from untrusted input
 * ```ts
 * import { DocumentPath } from "@visiolab/effect-firebase/firestore";
 *
 * DocumentPath.make("users/alice"); // Option.some(...)
 * DocumentPath.make("users"); // Option.none()
 * ```
 *
 * @see {@link makeUnsafe} for the same check throwing instead
 * @see {@link Collection.Collection} for typed references built from ids
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: (path: string) => Option.Option<DocumentPath> = documentPath.make;

/**
 * Builds a reference to the document at `path`, throwing when `path` does not
 * address a document.
 *
 * **When to use**
 *
 * Use for paths known to be valid, such as constants. Use {@link make} for
 * paths you have not checked.
 *
 * @example Building a reference
 * ```ts
 * import { DocumentPath } from "@visiolab/effect-firebase/firestore";
 *
 * const post = DocumentPath.makeUnsafe("users/alice/posts/hello");
 * ```
 *
 * @see {@link make} for the same check returning an `Option`
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const makeUnsafe: (path: string) => DocumentPath = documentPath.makeUnsafe;

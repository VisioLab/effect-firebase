/**
 * The errors of the Firestore module, defined apart from it so that the
 * modules it builds on can raise them without importing it back: the public
 * module imports its implementation, and an import cycle through it would
 * leave these unset while a bundle evaluates.
 */
import { Schema } from "effect";

/**
 * Raised when a Firestore call fails.
 *
 * @stability unstable
 * @category errors
 * @since 0.2.0
 */
export class FirestoreError extends Schema.TaggedError<
  FirestoreError,
  { readonly brand: unique symbol }
>()("FirestoreError", {
  message: Schema.String,
  /**
   * The code the SDK reported, where it reported one it can be named by.
   *
   * The client SDK names every failure, such as `permission-denied`. The Admin
   * SDK answers for Firestore over gRPC, which numbers its statuses rather than
   * naming them, so there this is often absent even where something went wrong
   * at the database.
   */
  code: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Raised when a read of a `CollectionGroup` finds a
 * document under the group's collection id at a path none of its collections
 * define, such as a root-level `posts` when the group is made of
 * `users/{id}/posts`.
 *
 * It is apart from {@link FirestoreError} because the call to Firestore
 * succeeded: it is the data that contradicts the model. It is an error rather
 * than a defect because what is in the database decides whether it happens, so
 * correct code cannot rule it out. A caller who treats it as a bug can `orDie`
 * it.
 *
 * @stability unstable
 * @category errors
 * @since 0.2.0
 */
export class UndefinedCollectionError extends Schema.TaggedError<
  UndefinedCollectionError,
  { readonly brand: unique symbol }
>()("UndefinedCollectionError", {
  /** The full path of the document no collection of the group defines. */
  path: Schema.String,
  /** The collection id of the group that was read. */
  collectionId: Schema.String,
}) {}

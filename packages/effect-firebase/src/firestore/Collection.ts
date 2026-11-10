/**
 * Typed Firestore collections.
 *
 * Define each collection once: where it sits, how its documents are addressed,
 * and the {@link FirestoreModel.Class} its documents hold. Every collection and
 * document reference is built from that definition, so a path can only be
 * built from the ids that locate it, and every read and write through
 * {@link Firestore.With} is typed by the collection's model.
 *
 * @example Defining collections and referencing documents
 * ```ts
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 * const UserPosts = Users.subcollection("posts", Post);
 *
 * const alice = Users.id.make("alice");
 * const hello = UserPosts.id.make("hello");
 *
 * UserPosts.collection(alice).path; // "users/alice/posts"
 * UserPosts.doc(alice, hello).path; // "users/alice/posts/hello"
 * ```
 *
 * @see {@link CollectionGroup} for reading every collection with one collection id at once
 * @see {@link DocumentPath} for a reference to a document as Firestore stores it in a field
 *
 * @stability unstable
 * @since 0.1.0
 */
import type { Brand, Equal, Inspectable, Option, Schema } from "effect";
import type * as DocumentSnapshot from "./DocumentSnapshot.ts";
import type * as FirestoreModel from "./FirestoreModel.ts";
import * as collection from "./internal/collection.ts";

const CollectionTypeId = collection.CollectionTypeId;
const CollectionReferenceTypeId = collection.CollectionReferenceTypeId;
const DocumentReferenceTypeId = collection.DocumentReferenceTypeId;

/**
 * One link of a collection's path: a segment and the model of the documents
 * stored under it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Level = readonly [segment: string, schema: FirestoreModel.Any];

/**
 * The {@link Level}s from a root collection down to a collection itself.
 *
 * **Details**
 *
 * A {@link Collection} carries the whole chain rather than only its own
 * segment, so the id of every ancestor stays typed.
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
 * What {@link Collection.contains} narrows each member of `V` to: the members
 * already in `C` are kept, the ones in another collection are dropped, and one
 * whose collection is left open is narrowed to `C`.
 *
 * Every branch is `V` or an intersection with it, which is what lets the
 * compiler see the result is assignable to `V`, as a type predicate must be.
 */
type Contained<V, C extends Any> =
  V extends DocumentReference<Any>
    ? NarrowTo<V, DocumentReference<C>>
    : V extends DocumentSnapshot.Existing<Any>
      ? NarrowTo<V, DocumentSnapshot.Existing<C>>
      : V extends DocumentSnapshot.Missing<Any>
        ? NarrowTo<V, DocumentSnapshot.Missing<C>>
        : never;

/**
 * `V` when it is `T`, and `never` when it is not. A `V` whose collection is
 * `any` passes the check without saying anything about it, so it is narrowed
 * by intersecting it with `T` instead.
 */
type NarrowTo<V, T> = V extends T ? (0 extends 1 & LevelsOf<V> ? V & T : V) : never;

/** The chain of the collection a reference or snapshot is in. */
type LevelsOf<V> =
  V extends DocumentReference<Collection<infer L>>
    ? L
    : V extends { readonly ref: DocumentReference<Collection<infer L>> }
      ? L
      : never;

/**
 * The schema of a document id in one collection. It decodes a string and
 * brands it with the collection's full path, so the id only fits that
 * collection.
 *
 * **When to use**
 *
 * Use `collection.id.make(raw)` to turn a string you trust into an id, and
 * `Schema.decodeUnknownEffect(collection.id)` to check one from outside.
 *
 * **Details**
 *
 * The brand is the whole path, so `posts` under `users` and `posts` under
 * `orgs` have different id types. Its constructor takes a `string`, which
 * makes passing anything else a type error rather than a runtime throw.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface IdSchema<T extends string> extends Schema.Codec<T, string> {
  readonly "~type.make.in": string;
}

/**
 * The definition of a collection: where it sits, how its documents are
 * addressed, and the model they hold.
 *
 * **Details**
 *
 * A definition does not point at any data. It describes a collection, and
 * {@link Collection.collection} and {@link Collection.doc} turn it into a
 * reference once you have the ids that address it. Build one with
 * {@link make}, and nest one with {@link Collection.subcollection}.
 *
 * @see {@link CollectionReference} for a reference to one collection, with its ancestor ids filled in
 * @see {@link CollectionGroup.CollectionGroup} for every collection with one collection id, read together
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Collection<L extends Levels> extends Inspectable.Inspectable {
  readonly [CollectionTypeId]: typeof CollectionTypeId;
  // `L` appears nowhere else in an inferrable position, so without it
  // `C extends Collection<infer L>` has nothing to infer from.
  /** The chain this collection was built from. Only read at the type level. */
  readonly "~levels": L;
  /** The path segments, from the root collection down, such as `["users", "posts"]`. */
  readonly path: SegmentsOf<L>;
  /** The last segment: the collection id Firestore knows the collection by. */
  readonly segment: Leaf<L>[0];
  /**
   * The schema of the ids of documents in this collection.
   *
   * @see {@link IdSchema} for how to make and decode one
   */
  readonly id: IdSchema<IdOf<L>>;
  /**
   * The model of the documents in this collection. Reads decode through it,
   * and writes encode through its {@link FirestoreModel.Class.create} and
   * {@link FirestoreModel.Class.update} variants.
   */
  readonly schema: Leaf<L>[1];

  /**
   * Checks whether a Document Reference or Document Snapshot belongs to this
   * collection, and narrows it to this collection's types when it does.
   *
   * **When to use**
   *
   * Use to pick out the documents of one collection from a mixed result, such
   * as a read of a {@link CollectionGroup.CollectionGroup} with several
   * members: `snapshot.docs.filter(UserPosts.contains)`.
   *
   * **Details**
   *
   * Two definitions are the same collection only when they are the same
   * object, so a definition built separately at the same path does not
   * contain this one's documents. It does not use `this`, so it can be passed
   * on unbound.
   *
   * @see {@link isDocumentReference} for checking that a value is a reference to any collection
   */
  readonly contains: <V extends DocumentReference<Any> | DocumentSnapshot.DocumentSnapshot<Any>>(
    value: V,
  ) => value is Contained<V, Collection<L>>;

  /**
   * Defines a subcollection under the documents of this collection.
   *
   * **When to use**
   *
   * Use for a nested collection, such as `posts` under each user. Use
   * {@link make} for a root collection.
   *
   * **Details**
   *
   * Throws when `segment` is not a collection id Firestore accepts: empty,
   * containing `/`, `.` or `..`, matching `__.*__`, or longer than 1500
   * bytes. An invalid definition is a programming error, not a failure to
   * recover from.
   */
  subcollection<const Segment extends string, S extends FirestoreModel.Any>(
    segment: Segment,
    schema: S,
  ): Collection<readonly [...L, readonly [Segment, S]]>;

  /**
   * References this collection, given one id per ancestor, from the root down.
   * A root collection takes none.
   *
   * **When to use**
   *
   * Use to address the collection itself, as {@link Firestore.With.getDocs},
   * {@link Firestore.With.streamDocs} and {@link Firestore.With.addDoc} take
   * it.
   *
   * @see {@link Collection.doc} for referencing one document in it
   */
  collection(...ids: AncestorsOf<L>): CollectionReference<Collection<L>>;

  /**
   * References a document in this collection, given one id per ancestor
   * followed by the document's own.
   *
   * **When to use**
   *
   * Use to address one document, as {@link Firestore.With.getDoc},
   * {@link Firestore.With.setDoc} and {@link Firestore.With.updateDoc} take it.
   *
   * @see {@link Collection.collection} for referencing the collection itself
   * @see {@link fromPath} for a reference from a path string
   */
  doc(...ids: [...AncestorsOf<L>, IdOf<L>]): DocumentReference<Collection<L>>;
}

/**
 * Any collection, whatever it is nested under and whatever it holds. Use it as
 * a type bound.
 *
 * **Details**
 *
 * It is `Collection<any>` rather than `Collection<Levels>` because `L` sits in
 * an argument position in {@link Collection.doc}, which makes it invariant.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Any = Collection<any>;

/**
 * A name for a collection that a model's own fields can use before the
 * collection is defined.
 *
 * **When to use**
 *
 * Use only for a {@link FirestoreSchema.DocumentReference} field that closes a
 * cycle: a model referencing its own collection, a subcollection of it, or a
 * collection whose model references it back. Extend it once per such
 * collection, as `interface UsersKey extends Collection.Key<typeof Users> {}`.
 * Every other reference field names the collection directly.
 *
 * **Details**
 *
 * A model's fields cannot name `typeof Users` while `Users` is still being
 * built from the model. An interface that extends this one only holds the
 * collection in a member, which TypeScript reads once the reference is used,
 * so the key can be named inside the model. A
 * {@link FirestoreSchema.DocumentReference} typed by the key reads back as
 * the same {@link DocumentReference} the collection gives.
 *
 * A model that backs several collections, such as `users` and
 * `archivedUsers`, needs one key per collection, and references through them
 * stay distinct types.
 *
 * @example Referencing a document of the model's own collection
 * ```ts
 * import { Schema } from "effect";
 * import { Collection, FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * interface UsersKey extends Collection.Key<typeof Users> {}
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   name: Schema.String,
 *   bestFriend: Schema.NullOr(
 *     Schema.suspend(
 *       (): FirestoreSchema.DocumentReference<UsersKey> => FirestoreSchema.DocumentReference(Users),
 *     ),
 *   ),
 * }) {}
 * const Users = Collection.make("users", User);
 * ```
 *
 * @see {@link FirestoreSchema.DocumentReference} for the schema typed by a key or a collection
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export interface Key<C extends Any> {
  // Held in a member, not checked against `Collection`, so naming a key does
  // not ask for the collection's type until a reference through it is used.
  /** The collection this key names. Only read at the type level. */
  readonly "~collection": C;
}

/**
 * The id of a document in `C`, branded with `C`'s path.
 *
 * @see {@link IdSchema} for how to make one
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Id<C extends Any> = IdOf<C["~levels"]>;

/**
 * The ids that address `C`: one per ancestor, from the root down. Empty for a
 * root collection.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Ancestors<C extends Any> = AncestorsOf<C["~levels"]>;

/**
 * The model of the documents in `C`, as {@link make} or
 * {@link Collection.subcollection} was given it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DocumentSchema<C extends Any> = Leaf<C["~levels"]>[1];

/**
 * A reference to one collection, with the ids of its ancestors filled in.
 *
 * **Details**
 *
 * Build one with {@link Collection.collection}. Two references are
 * `Equal` when they have the same path and come from the same definition.
 *
 * @see {@link Collection} for the definition it is built from
 * @see {@link DocumentReference} for a reference to one document
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
  /** The collection id Firestore knows it by: the last segment of its path. */
  readonly id: Leaf<C["~levels"]>[0];
  /** The full path, such as `users/alice/posts`. */
  readonly path: string;

  /**
   * References a document in this collection, by its own id.
   *
   * @see {@link Collection.doc} for referencing it from the definition with every id
   */
  doc(id: Id<C>): DocumentReference<C>;
}

/**
 * A typed reference to one document in a collection.
 *
 * **Details**
 *
 * It knows the {@link Collection} it was built from, so reads through it
 * decode with that collection's model and writes encode with it. Build one
 * with {@link Collection.doc}, {@link CollectionReference.doc} or
 * {@link fromPath}. Two references are `Equal` when they have the same path and
 * come from the same definition.
 *
 * @see {@link CollectionGroup.DocumentReference} for a reference into any collection of a group
 * @see {@link DocumentPath.DocumentPath} for the untyped path a reference is stored as in a field
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface DocumentReference<C extends Any> extends Inspectable.Inspectable, Equal.Equal {
  readonly [DocumentReferenceTypeId]: typeof DocumentReferenceTypeId;
  /** The definition of the collection holding it. */
  readonly collection: C;
  /** The ids that address its collection, from the root down. */
  readonly ancestors: Readonly<Ancestors<C>>;
  /** The document's own id. */
  readonly id: Id<C>;
  /** The full path, such as `users/alice/posts/hello`. */
  readonly path: string;
  /** A reference to the collection holding it. */
  readonly parent: CollectionReference<C>;
}

/**
 * Checks whether a value is a collection definition.
 *
 * @see {@link isCollectionReference} for a reference to a collection
 * @see {@link CollectionGroup.isCollectionGroup} for a Collection Group
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCollection: (u: unknown) => u is Any = collection.isCollection;

/**
 * Checks whether a value is a {@link CollectionReference}.
 *
 * @see {@link isCollection} for a collection definition
 * @see {@link isDocumentReference} for a reference to a document
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCollectionReference: (u: unknown) => u is CollectionReference<Any> =
  collection.isCollectionReference;

/**
 * Checks whether a value is a {@link DocumentReference} into any collection.
 *
 * @see {@link Collection.contains} for checking that a reference belongs to one collection, with narrowing
 * @see {@link isCollectionReference} for a reference to a collection
 * @see {@link DocumentPath.isDocumentPath} for the untyped path stored in a field
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDocumentReference: (u: unknown) => u is DocumentReference<Any> =
  collection.isDocumentReference;

/**
 * Defines a root collection and the model of its documents.
 *
 * **When to use**
 *
 * Use once per root collection, at module level, and build every reference to
 * it from the result. Use {@link Collection.subcollection} on the result for a
 * collection nested under its documents.
 *
 * **Details**
 *
 * The documents are described by a {@link FirestoreModel.Class} rather than a
 * plain schema, since a document is written in other shapes than it is read
 * in, and the model carries each of them. Pass a {@link FirestoreModel.Union}
 * of classes for a collection that holds several document shapes.
 *
 * Throws when `segment` is not a collection id Firestore accepts: empty,
 * containing `/`, `.` or `..`, matching `__.*__`, or longer than 1500 bytes. An
 * invalid definition is a programming error, not a failure to recover from.
 *
 * @example Defining a collection with a subcollection
 * ```ts
 * import { Collection, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { Effect, Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 * const UserPosts = Users.subcollection("posts", Post);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   const alice = Users.id.make("alice");
 *
 *   yield* firestore.setDoc(Users.doc(alice), { name: "Alice" });
 *   const post = yield* firestore.addDoc(UserPosts.collection(alice), { title: "Hello" });
 *   return post.path; // "users/alice/posts/<generated id>"
 * });
 * ```
 *
 * @see {@link fromPath} for a reference to a document of an existing collection from a path string
 * @see {@link CollectionGroup.make} for reading several collections with one collection id together
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
 * References the document of `collection` at a path string, such as
 * `users/alice/posts/hello`, or returns `None` when the path is not in that
 * collection.
 *
 * **When to use**
 *
 * Use when a path arrives as a string, such as from a URL, a message or a
 * stored {@link DocumentPath.DocumentPath}, and you know which collection it
 * should be in.
 *
 * **Details**
 *
 * The path is checked against every segment the collection was defined with,
 * so a path into another collection returns `None`, even one with the same
 * last segment. Every id in the path must be non-empty.
 *
 * @example Parsing a path
 * ```ts
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { Option, Schema } from "effect";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 * const UserPosts = Users.subcollection("posts", Post);
 *
 * Option.isSome(Collection.fromPath(UserPosts, "users/alice/posts/hello")); // true
 * Option.isSome(Collection.fromPath(UserPosts, "orgs/acme/posts/hello")); // false
 * ```
 *
 * @see {@link Collection.doc} for a reference built from typed ids
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromPath: <C extends Any>(
  collection: C,
  path: string,
) => Option.Option<DocumentReference<C>> = collection.fromPath;

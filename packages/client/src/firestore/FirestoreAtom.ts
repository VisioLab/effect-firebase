/**
 * Firestore atoms on Client Firestore: live reads that hold Decoded Snapshots,
 * and mutation atoms that write documents, built on `effect/reactivity`.
 *
 * Declare one {@link Service} class for the app over a layer that provides
 * {@link ClientFirestore.ClientFirestore}. Its statics give the atoms, and its
 * {@link Service.runtime} runs your own effects next to them.
 *
 * @stability unstable
 * @since 0.4.0
 */
import { Cause, Context, Duration, Effect, Equal, Exit, Hash, Layer, Stream } from "effect";
import type { Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type {
  Create,
  Firestore,
  FirestoreError,
  UndefinedCollectionError,
  Update,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
import * as ClientFirestore from "./ClientFirestore.ts";
import * as ClientQuerySnapshot from "./ClientQuerySnapshot.ts";

/**
 * A live read of the document at a ref: the latest Decoded Snapshot, or why
 * it could not be read.
 *
 * **Details**
 *
 * It is `Initial` until the first snapshot arrives, then `Success` with a
 * {@link ClientDocumentSnapshot.DecodedExisting} or a
 * {@link ClientDocumentSnapshot.DecodedMissing}. A missing document is a
 * `Success`, not a failure.
 *
 * It fails with a `Schema.SchemaError` when the stored data does not match the
 * model, and with a `FirestoreError` when Firestore drops the listen, such as on
 * `permission-denied`.
 *
 * @see {@link DocsResult} for a live read of a whole collection
 * @see {@link GroupDocsResult} for a live read of a Collection Group
 * @see {@link Service.doc} for the atom that holds it
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export type DocResult<C extends Collection.Any> = AsyncResult.AsyncResult<
  ClientDocumentSnapshot.DecodedClientDocumentSnapshot<C>,
  FirestoreError | Schema.SchemaError
>;

/**
 * A live read of every document in a collection: the latest Decoded Snapshot
 * of the collection, or why it could not be read.
 *
 * **Details**
 *
 * It is `Initial` until the first snapshot arrives, then `Success` with a
 * {@link ClientQuerySnapshot.DecodedClientQuerySnapshot}: every document
 * decoded, with Snapshot Metadata on each document and on the whole read.
 *
 * It fails with a `Schema.SchemaError` when any one document does not match the
 * model, and with a `FirestoreError` when Firestore drops the listen, such as on
 * `permission-denied`.
 *
 * @see {@link GroupDocsResult} for a live read of a Collection Group
 * @see {@link DocResult} for a live read of one document
 * @see {@link Service.docs} for the atom that holds it
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export type DocsResult<C extends Collection.Any> = AsyncResult.AsyncResult<
  ClientQuerySnapshot.DecodedClientQuerySnapshot<C>,
  FirestoreError | Schema.SchemaError
>;

/**
 * A live read of every document in a Collection Group: the latest Decoded
 * Snapshot of the group, or why it could not be read.
 *
 * **Details**
 *
 * It holds the same {@link ClientQuerySnapshot.DecodedClientQuerySnapshot} as
 * {@link DocsResult}, over the union of the group's member collections, so each
 * document is typed by the collection it lives in.
 *
 * Beyond the failures of {@link DocsResult}, it fails with an
 * `UndefinedCollectionError` when a collection with the group's id holds a
 * document at a path none of the group's members defines.
 *
 * @see {@link DocsResult} for a live read of one collection
 * @see {@link DocResult} for a live read of one document
 * @see {@link Service.docs} for the atom that holds it
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export type GroupDocsResult<G extends CollectionGroup.Any> = AsyncResult.AsyncResult<
  ClientQuerySnapshot.DecodedClientQuerySnapshot<CollectionGroup.Members<G>>,
  FirestoreError | Schema.SchemaError | UndefinedCollectionError
>;

/**
 * How a read atom listens, and how long it lives once nothing reads it: the
 * listen options of {@link ClientFirestore.ListenOptions} and the atom option
 * `timeToLive`, in one flat object.
 *
 * **Details**
 *
 * Read atoms are shared: equal refs with equal options give the same atom,
 * with one SDK listener and one decode per snapshot, however many readers it
 * has. Options are compared once the defaults are filled in, so leaving the
 * options out, passing `{}` and passing the defaults (`source: "default"`,
 * `includeMetadataChanges: false`) give the same atom. Different listen
 * options or a different `timeToLive` give a different atom, with a listener
 * of its own.
 *
 * - `source: "cache"` listens to the local cache alone, so the atom only sees
 *   what this client has written or already read.
 * - `includeMetadataChanges: true` also updates the atom when only the
 *   snapshot's metadata changes, such as when the server acknowledges a
 *   pending write. Without it, the atom only updates when the data changes.
 * - `timeToLive` is how long the atom keeps listening after its last reader
 *   leaves. A finite duration sets the atom's idle TTL, and `Infinity` keeps
 *   the atom, and its listener, alive for as long as the registry lives.
 *   Without it, the registry's `defaultIdleTTL` applies, and without that the
 *   atom stops listening as soon as nothing reads it. `"1 minute"` and
 *   `Duration.minutes(1)` give the same atom.
 *
 * @example Keeping a read alive for a minute after it is left
 * ```ts
 * import { Layer, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { App } from "@visiolab/effect-firebase-client/app";
 * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   title: Schema.String,
 * }) {}
 *
 * const Posts = Collection.make("posts", Post);
 * const hello = Posts.doc(Posts.id.make("hello"));
 *
 * const FirestoreLive = ClientFirestore.layer().pipe(
 *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
 * );
 *
 * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
 *
 * const post = Db.doc(hello, { includeMetadataChanges: true, timeToLive: "1 minute" });
 * const cached = Db.doc(hello, { source: "cache", timeToLive: Infinity });
 * ```
 *
 * @see {@link Service.doc} for the read atom of a document that takes them
 * @see {@link Service.docs} for the read atom of a collection or Collection Group that takes them
 * @see {@link ClientFirestore.ListenOptions} for the same listen options on a stream
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export interface ReadAtomOptions extends ClientFirestore.ListenOptions {
  /**
   * How long the atom keeps listening after its last reader leaves. A finite
   * duration sets the atom's idle TTL, and `Infinity` keeps it alive. Left
   * out, the registry's `defaultIdleTTL` applies.
   */
  readonly timeToLive?: Duration.Input | undefined;
}

/**
 * The ref that `doc` takes when the service's layer provides everything the
 * model in `C` needs to decode, and a ref that names the missing services
 * otherwise, so the call does not type-check.
 *
 * @see {@link DecodableCollection} for the Collection Reference `docs` takes
 * @see {@link DecodableGroup} for the Collection Group `docs` takes
 * @see {@link EncodableRef} for the ref the mutation atoms take, checked for Encoding Services
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type DecodableRef<C extends Collection.Any, R> = Collection.DocumentReference<C> &
  Decodable<C, R>;

/**
 * The Collection Reference that `docs` takes when the service's layer provides
 * everything the model in `C` needs to decode, and one that names the missing
 * services otherwise, so the call does not type-check.
 *
 * @see {@link DecodableRef} for the ref `doc` takes
 * @see {@link DecodableGroup} for the Collection Group `docs` takes
 * @see {@link EncodableCollection} for the Collection Reference `addDoc` takes, checked for Encoding Services
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type DecodableCollection<C extends Collection.Any, R> = Collection.CollectionReference<C> &
  Decodable<C, R>;

/**
 * The Collection Group that `docs` takes when the service's layer provides
 * everything the models of its members need to decode, and one that names the
 * missing services otherwise, so the call does not type-check.
 *
 * @see {@link DecodableRef} for the ref `doc` takes
 * @see {@link DecodableCollection} for the Collection Reference `docs` takes
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type DecodableGroup<G extends CollectionGroup.Any, R> = G &
  Decodable<CollectionGroup.Members<G>, R>;

/**
 * `unknown` when `R` holds every service in `Needed`, and an object naming the
 * missing ones otherwise, so that a value intersected with it does not
 * type-check.
 */
type Provides<Needed, R> = [Exclude<Needed, R>] extends [never]
  ? unknown
  : { readonly "the service's layer does not provide": Exclude<Needed, R> };

/** {@link Provides} for the Decoding Services of `C`. */
type Decodable<C extends Collection.Any, R> = Provides<DocumentSnapshot.DecodingServices<C>, R>;

/**
 * Which of a model's schemas a write encodes through: `"create"` for
 * {@link Service.setDoc} and {@link Service.addDoc}, `"update"` for
 * {@link Service.updateDoc}.
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export type WriteSchema = "create" | "update";

/**
 * The Encoding Services a write to a document in `C` through `Schema` needs.
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type EncodingServices<
  C extends Collection.Any,
  Schema extends WriteSchema,
> = Collection.DocumentSchema<C>[Schema]["EncodingServices"];

/** {@link Provides} for the Encoding Services of a write to `C` through `Schema`. */
type Encodable<C extends Collection.Any, R, Schema extends WriteSchema> = Provides<
  EncodingServices<C, Schema>,
  R
>;

/**
 * The ref that a mutation atom takes when the service's layer provides every
 * Encoding Service the model in `C` needs to write through `Schema`, and a ref
 * that names the missing services otherwise, so the call does not type-check.
 *
 * @see {@link EncodableCollection} for the Collection Reference `addDoc` takes
 * @see {@link DecodableRef} for the ref `doc` takes, checked for Decoding Services
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type EncodableRef<
  C extends Collection.Any,
  R,
  Schema extends WriteSchema,
> = Collection.DocumentReference<C> & Encodable<C, R, Schema>;

/**
 * The Collection Reference that {@link Service.addDoc} takes when the
 * service's layer provides every Encoding Service the model in `C` needs to
 * create a document, and one that names the missing services otherwise, so
 * the call does not type-check.
 *
 * @see {@link EncodableRef} for the ref the other mutation atoms take
 * @see {@link DecodableCollection} for the Collection Reference `docs` takes, checked for Decoding Services
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type EncodableCollection<C extends Collection.Any, R> = Collection.CollectionReference<C> &
  Encodable<C, R, "create">;

/**
 * What {@link Service.setDoc} and {@link Service.addDoc} take: the document to
 * write.
 *
 * @see {@link UpdateArg} for what {@link Service.updateDoc} takes
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export interface CreateArg<C extends Collection.Any> {
  /** The document to write, as the model's `create` schema takes it. */
  readonly data: Create<C>;
}

/**
 * What {@link Service.updateDoc} takes: a patch, and the mode it is checked
 * in.
 *
 * **Details**
 *
 * `mode` defaults to `"checked"`. A patch only the model's `updateUnchecked`
 * schema takes needs `mode: "unchecked"`, so it is never sent unchecked by
 * mistake.
 *
 * @see {@link CreateArg} for what {@link Service.setDoc} and {@link Service.addDoc} take
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export type UpdateArg<C extends Collection.Any> =
  | { readonly data: Update<C, "checked">; readonly mode?: "checked" | undefined }
  | { readonly data: Update<C, "unchecked">; readonly mode: "unchecked" };

/**
 * A {@link Service} class: a Context service for Client Firestore under the
 * app's own id, with Firestore atoms as statics.
 *
 * **Details**
 *
 * `R` is everything the service's layer provides, beyond
 * {@link ClientFirestore.ClientFirestore}: the Decoding and Encoding Services
 * of the app's models, for example. Its atom caches belong to the class, so the same
 * arguments give the same atom.
 *
 * @see {@link Service} for declaring one
 *
 * @stability unstable
 * @category models
 * @since 0.4.0
 */
export interface Service<Self, Id extends string, R> extends Context.Service<
  Self,
  ClientFirestore.ClientFirestore & Firestore
> {
  new (_: never): Context.ServiceClass.Shape<Id, ClientFirestore.ClientFirestore & Firestore>;

  /**
   * The atom runtime the service's atoms run in. It provides the service
   * class itself, {@link ClientFirestore.ClientFirestore} and everything else
   * the service's layer provides.
   *
   * **When to use**
   *
   * Use to build your own atoms next to the service's, such as a derived
   * read with `Db.runtime.atom` or a multi-step write with `Db.runtime.fn`,
   * where `yield* Db` gives Client Firestore.
   *
   * **Details**
   *
   * A failure of the service's layer becomes a defect, so it is not in the
   * error type of any atom built on the runtime.
   *
   * @example Deriving an atom from a read through the service
   * ```ts
   * import { Effect, Layer, Schema } from "effect";
   * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * const postCount = Db.runtime.atom(
   *   Effect.gen(function* () {
   *     const db = yield* Db;
   *     const snapshot = yield* db.getDocs(Posts.collection());
   *     return snapshot.docs.length;
   *   }),
   * );
   * ```
   *
   * @see {@link Service.doc} for a live read of a document the service builds for you
   * @see {@link Service.setDoc} for a mutation atom the service builds for you
   * @see {@link Service.updateDoc} for a mutation atom that patches a document
   * @see {@link Service.addDoc} for a mutation atom that adds a document
   */
  readonly runtime: Atom.AtomRuntime<Self | ClientFirestore.ClientFirestore | R>;

  /**
   * A live read of the document at `ref`, holding its latest Decoded Snapshot.
   *
   * **When to use**
   *
   * Use to render a document that stays up to date: with your own writes,
   * which show at once with `metadata.hasPendingWrites`, and with everyone
   * else's.
   *
   * **Details**
   *
   * The atom listens while something reads it, and stops listening once it is
   * disposed: as soon as nothing reads it, or after `options.timeToLive` (see
   * {@link ReadAtomOptions}). Equal refs with equal options give the same
   * atom, so every reader shares one listener and one decode. It is `Initial` until the first snapshot, then `Success`, and a
   * missing document is a `Success` holding a `Missing` snapshot. `waiting` is
   * `false` after the first snapshot, whether it came from the cache or the
   * server, except while a refresh waits for its next snapshot.
   *
   * - When a snapshot does not decode, the atom fails with a
   *   `Schema.SchemaError` and keeps listening, so the next snapshot that
   *   decodes brings it back to `Success`.
   * - When Firestore drops the listen, such as on `permission-denied`, the
   *   atom fails with a `FirestoreError` and does not listen again by itself.
   *   Refresh the atom, or let it be disposed and read it again, to retry.
   * - Refreshing the atom detaches its listener and attaches a new one, in any
   *   state.
   *
   * A failed atom keeps the last `Success` as `previousSuccess`. After a
   * `permission-denied`, that may be data the user is no longer allowed to
   * see: check the failure before you show it.
   *
   * The ref only type-checks when the service's layer provides every Decoding
   * Service the collection's model needs.
   *
   * @example Rendering a post in React
   * ```tsx
   * import { useAtomValue } from "@effect/atom-react";
   * import { AsyncResult } from "effect/reactivity";
   * import { Layer, Schema } from "effect";
   * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * function PostTitle({ id }: { id: string }) {
   *   const result = useAtomValue(Db.doc(Posts.doc(Posts.id.make(id))));
   *   return AsyncResult.match(result, {
   *     onInitial: () => <p>Loading…</p>,
   *     onFailure: () => <p>Could not load the post.</p>,
   *     onSuccess: ({ value }) =>
   *       value._tag === "Existing" ? (
   *         <h1>
   *           {value.data.title}
   *           {value.metadata.hasPendingWrites ? " (saving…)" : ""}
   *         </h1>
   *       ) : (
   *         <p>No such post.</p>
   *       ),
   *   });
   * }
   * ```
   *
   * @see {@link Service.docs} for a live read of a whole collection or Collection Group
   * @see {@link DocResult} for what the atom holds
   * @see {@link ClientDocumentSnapshot.decode} for decoding a live read without atoms
   * @see {@link ReadAtomOptions} for how it listens, how long it lives and when it is shared
   * @see {@link Service.runtime} for building atoms of your own
   */
  readonly doc: <C extends Collection.Any>(
    ref: DecodableRef<C, R>,
    options?: ReadAtomOptions,
  ) => Atom.Atom<DocResult<C>>;

  /**
   * A live read of every document in a collection or a Collection Group,
   * holding its latest Decoded Snapshot, `{ docs, metadata }`.
   *
   * **When to use**
   *
   * Use to render a list that stays up to date: a whole collection, or every
   * collection of a Collection Group, whose documents are typed by the member
   * collection each one lives in.
   *
   * **Details**
   *
   * It follows the same rules as {@link Service.doc}. The atom listens while
   * something reads it, and stops listening once it is disposed: as soon as
   * nothing reads it, or after `options.timeToLive` (see
   * {@link ReadAtomOptions}). Equal collections, or groups of the same
   * members, with equal options give the same atom, so every reader shares one
   * listener and one decode. A Collection Reference and a Collection Group
   * never share an atom, even with the same collection id. It is `Initial`
   * until the first snapshot, then `Success`. `waiting` is `false` after the
   * first snapshot, except while a refresh waits for its next snapshot.
   *
   * - When any one document does not decode, the atom fails with a
   *   `Schema.SchemaError` and keeps listening, so the next snapshot whose
   *   documents all decode brings it back to `Success`.
   * - When Firestore drops the listen, such as on `permission-denied`, the
   *   atom fails with a `FirestoreError` and does not listen again by itself.
   *   Refresh the atom, or let it be disposed and read it again, to retry.
   * - A group read fails the same way with an `UndefinedCollectionError` when
   *   a collection with the group's id holds a document at a path none of the
   *   group's members defines.
   * - Refreshing the atom detaches its listener and attaches a new one, in any
   *   state.
   *
   * A failed atom keeps the last `Success` as `previousSuccess`. After a
   * `permission-denied`, that may be data the user is no longer allowed to
   * see: check the failure before you show it.
   *
   * The collection or group only type-checks when the service's layer
   * provides every Decoding Service its models need.
   *
   * @example Rendering every post in React
   * ```tsx
   * import { useAtomValue } from "@effect/atom-react";
   * import { AsyncResult } from "effect/reactivity";
   * import { Layer, Schema } from "effect";
   * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * function PostList() {
   *   const result = useAtomValue(Db.docs(Posts.collection(), { timeToLive: Infinity }));
   *   return AsyncResult.match(result, {
   *     onInitial: () => <p>Loading…</p>,
   *     onFailure: () => <p>Could not load the posts.</p>,
   *     onSuccess: ({ value }) => (
   *       <ul>
   *         {value.docs.map((post) => (
   *           <li key={post.id}>{post.data.title}</li>
   *         ))}
   *       </ul>
   *     ),
   *   });
   * }
   * ```
   *
   * @example Reading a Collection Group
   * ```ts
   * import { Layer, Schema } from "effect";
   * import { Collection, CollectionGroup, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
   * class Comment extends FirestoreModel.Class<Comment>("Comment")({ body: Schema.String }) {}
   *
   * const Posts = Collection.make("posts", Post);
   * const PostComments = Posts.subcollection("comments", Comment);
   * const Comments = Collection.make("comments", Comment);
   * const AllComments = CollectionGroup.make(PostComments, Comments);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * // Fails with FirestoreError | SchemaError | UndefinedCollectionError
   * const comments = Db.docs(AllComments, { includeMetadataChanges: true });
   * ```
   *
   * @see {@link Service.doc} for a live read of one document
   * @see {@link DocsResult} for what the atom holds for a collection
   * @see {@link GroupDocsResult} for what the atom holds for a Collection Group
   * @see {@link ClientQuerySnapshot.decode} for decoding a live read without atoms
   * @see {@link ReadAtomOptions} for how it listens, how long it lives and when it is shared
   */
  readonly docs: {
    <C extends Collection.Any>(
      collection: DecodableCollection<C, R>,
      options?: ReadAtomOptions,
    ): Atom.Atom<DocsResult<C>>;
    <G extends CollectionGroup.Any>(
      group: DecodableGroup<G, R>,
      options?: ReadAtomOptions,
    ): Atom.Atom<GroupDocsResult<G>>;
  };

  /**
   * A mutation atom that writes a whole document at `ref`, creating it or
   * replacing what is there.
   *
   * **When to use**
   *
   * Use to write a document from the UI and show the write's progress and
   * failure, such as an editor's save button.
   *
   * **Details**
   *
   * Set it with `{ data }`. The atom is `waiting` while any write through it
   * is unacknowledged by the server, which lasts as long as the client is
   * offline, and succeeds once they all are. It fails when any of them fails,
   * with the error of {@link ClientFirestore.ClientFirestore}'s `setDoc`.
   *
   * There is one atom per ref, so writes to different documents never share
   * `waiting` or a failure, but every write to the same document does. A read
   * atom on the document shows the write at once, with
   * `metadata.hasPendingWrites`.
   *
   * To follow your own write's outcome, or to run several writes as one step,
   * write through `Db.runtime.fn` and `yield* Db` instead.
   *
   * The ref only type-checks when the service's layer provides every Encoding
   * Service the collection's model needs to create a document.
   *
   * @example Saving a post from React
   * ```tsx
   * import { useAtom } from "@effect/atom-react";
   * import { Layer, Schema } from "effect";
   * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * function SaveButton({ id, title }: { id: string; title: string }) {
   *   const [result, save] = useAtom(Db.setDoc(Posts.doc(Posts.id.make(id))));
   *   return (
   *     <button disabled={result.waiting} onClick={() => save({ data: { title } })}>
   *       {result._tag === "Failure" ? "Retry" : "Save"}
   *     </button>
   *   );
   * }
   * ```
   *
   * @example Following your own write with Db.runtime.fn
   * ```ts
   * import { Effect, Layer, Schema } from "effect";
   * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * // An atom of its own for each caller, writing two posts as one step.
   * const publishPair = Db.runtime.fn<{ readonly title: string }>()(
   *   Effect.fnUntraced(function* ({ title }) {
   *     const db = yield* Db;
   *     yield* db.setDoc(Posts.doc(Posts.id.make("draft")), { title });
   *     yield* db.setDoc(Posts.doc(Posts.id.make("published")), { title });
   *   }),
   * );
   * ```
   *
   * @see {@link Service.updateDoc} for changing some fields of a document that exists
   * @see {@link Service.addDoc} for writing under an id Firestore picks
   * @see {@link Service.runtime} for writes whose outcome is your own
   */
  readonly setDoc: <C extends Collection.Any>(
    ref: EncodableRef<C, R, "create">,
  ) => Atom.AtomResultFn<CreateArg<C>, void, FirestoreError | Schema.SchemaError>;

  /**
   * A mutation atom that changes some fields of the document at `ref`.
   *
   * **When to use**
   *
   * Use to patch a document that exists from the UI, such as a like button
   * that bumps a counter, and show the write's progress and failure.
   *
   * **Details**
   *
   * Set it with `{ data }`, a patch checked against the model's `update`
   * schema. A patch only the model's `updateUnchecked` schema takes needs
   * `{ data, mode: "unchecked" }`: leaving `mode` out is a type error, so an
   * unchecked patch is never sent by mistake.
   *
   * The atom is `waiting` while any write through it is unacknowledged by the
   * server, and succeeds once they all are. It fails when any of them fails,
   * with the error of {@link ClientFirestore.ClientFirestore}'s `updateDoc`:
   * a `FirestoreError` with code `not-found` when the document is not there.
   *
   * There is one atom per ref, so writes to different documents never share
   * `waiting` or a failure, but every write to the same document does. To
   * follow your own write's outcome, or to run several writes as one step,
   * write through `Db.runtime.fn` and `yield* Db` instead.
   *
   * The ref only type-checks when the service's layer provides every Encoding
   * Service the collection's model needs to update a document.
   *
   * @example Counting a view from React
   * ```tsx
   * import { useAtomSet } from "@effect/atom-react";
   * import { Layer, Schema } from "effect";
   * import { Collection, FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   *   views: FirestoreModel.Number(Schema.Int),
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * function ViewButton({ id }: { id: string }) {
   *   const view = useAtomSet(Db.updateDoc(Posts.doc(Posts.id.make(id))));
   *   return <button onClick={() => view({ data: { views: FieldValue.increment(1) } })}>View</button>;
   * }
   * ```
   *
   * @see {@link Service.setDoc} for writing a whole document
   * @see {@link Service.addDoc} for writing a new document under an id Firestore picks
   * @see {@link Service.runtime} for writes whose outcome is your own
   */
  readonly updateDoc: <C extends Collection.Any>(
    ref: EncodableRef<C, R, "update">,
  ) => Atom.AtomResultFn<UpdateArg<C>, void, FirestoreError | Schema.SchemaError>;

  /**
   * A mutation atom that writes a new document into the collection at `ref`,
   * under an id Firestore picks, and succeeds with the new document's ref.
   *
   * **When to use**
   *
   * Use to add a document from the UI when no one else needs its id before
   * the write is acknowledged, such as a comment form.
   *
   * **Details**
   *
   * Set it with `{ data }`. The atom is `waiting` while any add through it is
   * unacknowledged by the server, and succeeds once they all are. It fails
   * when any of them fails, with the error of
   * {@link ClientFirestore.ClientFirestore}'s `addDoc`.
   *
   * There is one atom per Collection Reference, shared by every add into it. With
   * several adds in flight, as happens offline, the atom succeeds with the
   * oldest one's ref, not the latest. When you need the ref of your own add,
   * make it yourself with `Posts.doc(...)` and write through
   * {@link Service.setDoc}, or add through `Db.runtime.fn`.
   *
   * Collection Groups get no mutation atoms: a group is not one collection to
   * add into.
   *
   * The ref only type-checks when the service's layer provides every Encoding
   * Service the collection's model needs to create a document.
   *
   * @example Adding a post from React
   * ```tsx
   * import { useAtom } from "@effect/atom-react";
   * import { AsyncResult } from "effect/reactivity";
   * import { Layer, Schema } from "effect";
   * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
   * import { App } from "@visiolab/effect-firebase-client/app";
   * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
   *
   * class Post extends FirestoreModel.Class<Post>("Post")({
   *   title: Schema.String,
   * }) {}
   *
   * const Posts = Collection.make("posts", Post);
   *
   * const FirestoreLive = ClientFirestore.layer().pipe(
   *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
   * );
   *
   * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
   *
   * function NewPost() {
   *   const [result, add] = useAtom(Db.addDoc(Posts.collection()));
   *   return (
   *     <>
   *       <button onClick={() => add({ data: { title: "Untitled" } })}>New post</button>
   *       {AsyncResult.isSuccess(result) ? <a href={`/${result.value.path}`}>Open it</a> : null}
   *     </>
   *   );
   * }
   * ```
   *
   * @see {@link Service.setDoc} for writing under an id you pick
   * @see {@link Service.updateDoc} for changing some fields of a document that exists
   * @see {@link Service.runtime} for writes whose outcome is your own
   */
  readonly addDoc: <C extends Collection.Any>(
    ref: EncodableCollection<C, R>,
  ) => Atom.AtomResultFn<
    CreateArg<C>,
    Collection.DocumentReference<C>,
    FirestoreError | Schema.SchemaError
  >;
}

/**
 * {@link ClientDocumentSnapshot.decode} for a document of any model, whose
 * Decoding Services the runtime holds: {@link Service.doc} only takes a ref
 * whose model's services the service's layer provides.
 */
const decodeDoc: (
  snapshot: ClientDocumentSnapshot.ClientDocumentSnapshot<Collection.Any>,
) => Effect.Effect<
  ClientDocumentSnapshot.DecodedClientDocumentSnapshot<Collection.Any>,
  Schema.SchemaError
> = ClientDocumentSnapshot.decode as any;

/**
 * {@link ClientQuerySnapshot.decode} for a read of any collection, whose
 * Decoding Services the runtime holds: {@link Service.docs} only takes a
 * collection or group whose models' services the service's layer provides.
 */
const decodeDocs: (
  snapshot: ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>,
) => Effect.Effect<
  ClientQuerySnapshot.DecodedClientQuerySnapshot<Collection.Any>,
  Schema.SchemaError
> = ClientQuerySnapshot.decode as any;

/**
 * What a `docs` atom reads, as a {@link ReadKey} target: a Collection
 * Reference, which is `Equal` by path, or a Collection Group, compared by its
 * members whatever their order. A collection and a group are never equal, even
 * with the same collection id.
 */
type DocsTarget = CollectionTarget | GroupTarget;

class CollectionTarget implements Equal.Equal {
  readonly _tag = "Collection";
  constructor(readonly collection: Collection.CollectionReference<Collection.Any>) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof CollectionTarget && Equal.equals(this.collection, that.collection);
  }
  [Hash.symbol](): number {
    return Hash.combine(Hash.string("Collection"))(Hash.hash(this.collection));
  }
}

class GroupTarget implements Equal.Equal {
  readonly _tag = "Group";
  constructor(readonly group: CollectionGroup.Any) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    if (!(that instanceof GroupTarget)) return false;
    const members: ReadonlyArray<Collection.Any> = this.group.members;
    const others: ReadonlyArray<Collection.Any> = that.group.members;
    return members.length === others.length && members.every((member) => others.includes(member));
  }
  [Hash.symbol](): number {
    // Members are compared by identity, and in any order.
    return Hash.combine(Hash.string("Group"))(Hash.string(this.group.id));
  }
}

/**
 * The family key of a read atom: what it reads, its listen options with every
 * default filled in, and its `timeToLive` as a `Duration`. Keys are compared
 * with `Equal`, so every field is always present, and `undefined`, `{}` and
 * explicit defaults give equal keys.
 *
 * `target` is the ref, or whatever else tells reads apart: it must be `Equal`
 * by what it reads, and never equal between kinds of read, such as a
 * Collection Reference and a Collection Group with the same collection id.
 */
interface ReadKey<Target> {
  readonly target: Target;
  readonly listen: {
    readonly [K in keyof ClientFirestore.ListenOptions]-?: Exclude<
      ClientFirestore.ListenOptions[K],
      undefined
    >;
  };
  readonly timeToLive: Duration.Duration | undefined;
}

/** The {@link ReadKey} for reading `target` with `options`. */
const readKey = <Target>(
  target: Target,
  options: ReadAtomOptions | undefined,
): ReadKey<Target> => ({
  target,
  listen: {
    source: options?.source ?? "default",
    includeMetadataChanges: options?.includeMetadataChanges ?? false,
  },
  timeToLive:
    options?.timeToLive === undefined ? undefined : Duration.fromInputUnsafe(options.timeToLive),
});

/**
 * A read atom that listens with `key`'s listen options while it is read, and
 * stays alive after its last reader for `key.timeToLive`: as `AtomRpc` and
 * `AtomHttpApi` do, a finite one sets the atom's idle TTL, `Infinity` keeps it
 * alive, and none leaves it to the registry's `defaultIdleTTL`.
 *
 * `listen` gives one decode per snapshot. A decode that fails fails the atom
 * but not the listen, so the next snapshot that decodes brings it back.
 */
const liveRead = <Target, A, E>(
  key: ReadKey<Target>,
  runtime: Atom.AtomRuntime<any>,
  listen: (
    firestore: ClientFirestore.ClientFirestore,
    options: ClientFirestore.ListenOptions,
  ) => Stream.Stream<Effect.Effect<A, E>, E | FirestoreError>,
): Atom.Atom<AsyncResult.AsyncResult<A, E | FirestoreError>> => {
  type Result = AsyncResult.AsyncResult<A, E | FirestoreError>;
  const atom = Atom.readable((get): Result => {
    const previous = get.self<Result>();
    const services = get(runtime);
    if (services._tag !== "Success") {
      return AsyncResult.replacePrevious(services, previous) as Result;
    }
    const firestore = Context.get(services.value, ClientFirestore.ClientFirestore);
    const fail = (cause: Cause.Cause<E | FirestoreError>) =>
      get.setSelf(AsyncResult.failureWithPrevious(cause, { previous: get.self<Result>() }));
    const run = listen(firestore, key.listen).pipe(
      Stream.runForEach((decode) =>
        Effect.map(Effect.exit(decode), (exit) =>
          Exit.isSuccess(exit) ? get.setSelf(AsyncResult.success(exit.value)) : fail(exit.cause),
        ),
      ),
      // The SDK has dropped the listener; it stays dropped until a refresh.
      Effect.catchCause((cause) =>
        Effect.sync(() => (Cause.hasInterruptsOnly(cause) ? undefined : fail(cause))),
      ),
    );
    const fiber = Effect.runForkWith(services.value)(run);
    get.addFinalizer(() => fiber.interruptUnsafe());
    return AsyncResult.waitingFrom(previous);
  });
  if (key.timeToLive === undefined) {
    return atom;
  }
  return Duration.isFinite(key.timeToLive)
    ? Atom.setIdleTTL(atom, key.timeToLive)
    : Atom.keepAlive(atom);
};

/**
 * Client Firestore's writes for a document of any model, whose Encoding
 * Services the runtime holds: the mutation atoms only take a ref whose model's
 * services the service's layer provides.
 */
interface ErasedClientFirestoreWrites {
  readonly setDoc: (
    ref: Collection.DocumentReference<Collection.Any>,
    data: Create<Collection.Any>,
  ) => Effect.Effect<void, FirestoreError | Schema.SchemaError>;
  readonly updateDoc: (
    ref: Collection.DocumentReference<Collection.Any>,
    data: Update<Collection.Any, "checked" | "unchecked">,
    options: { readonly mode?: "checked" | "unchecked" | undefined },
  ) => Effect.Effect<void, FirestoreError | Schema.SchemaError>;
  readonly addDoc: (
    ref: Collection.CollectionReference<Collection.Any>,
    data: Create<Collection.Any>,
  ) => Effect.Effect<
    Collection.DocumentReference<Collection.Any>,
    FirestoreError | Schema.SchemaError
  >;
}

type LayerInput<ROut, E> = Layer.Layer<ROut, E> | ((get: Atom.AtomContext) => Layer.Layer<ROut, E>);

/**
 * Declares the app's Firestore atom service: a class that is a Context service
 * for Client Firestore under `id`, with the app's Firestore atoms as statics.
 *
 * **When to use**
 *
 * Use once per app that renders Firestore data with `effect/reactivity`, and
 * read every document through its atoms, so they share one runtime and one
 * atom cache.
 *
 * **Details**
 *
 * `layer` provides {@link ClientFirestore.ClientFirestore}, as a `Layer` or as
 * a function of the atom context that returns one, so the layer can depend on
 * other atoms. It also provides every Decoding and Encoding Service the app's
 * models need:
 * an atom for a model whose services it lacks does not type-check. A failure
 * of the layer is a defect in the atoms, not part of their error type.
 *
 * The class's statics are {@link Service.runtime}, the read atoms
 * {@link Service.doc} and {@link Service.docs}, and the mutation atoms
 * {@link Service.setDoc}, {@link Service.updateDoc} and {@link Service.addDoc}.
 * `yield* Db` gives Client Firestore in any effect run on `Db.runtime`.
 *
 * @example Declaring the service
 * ```ts
 * import { Layer } from "effect";
 * import { App } from "@visiolab/effect-firebase-client/app";
 * import { ClientFirestore, FirestoreAtom } from "@visiolab/effect-firebase-client/firestore";
 *
 * const FirestoreLive = ClientFirestore.layer().pipe(
 *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
 * );
 *
 * class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}
 * ```
 *
 * @see {@link ClientFirestore.layer} for the layer it takes
 *
 * @stability unstable
 * @category constructors
 * @since 0.4.0
 */
export const Service =
  <Self>() =>
  <const Id extends string, R, ER>(
    id: Id,
    options: { readonly layer: LayerInput<ClientFirestore.ClientFirestore | R, ER> },
  ): Service<Self, Id, R> => {
    const self: any = Context.Service<Self, ClientFirestore.ClientFirestore & Firestore>()(id);
    const withSelf = (layer: Layer.Layer<ClientFirestore.ClientFirestore | R, ER>) =>
      Layer.provideMerge(
        Layer.effect(self, Effect.service(ClientFirestore.ClientFirestore)),
        Layer.orDie(layer),
      );
    const { layer } = options;
    const runtime: Atom.AtomRuntime<any> = Atom.runtime(
      typeof layer === "function" ? (get) => withSelf(layer(get)) : withSelf(layer),
    );

    const docFamily = Atom.family((key: ReadKey<Collection.DocumentReference<Collection.Any>>) =>
      liveRead(key, runtime, (firestore, options) =>
        firestore.streamDoc(key.target, options).pipe(Stream.map(decodeDoc)),
      ),
    );

    const docsFamily = Atom.family((key: ReadKey<DocsTarget>) =>
      liveRead<
        DocsTarget,
        ClientQuerySnapshot.DecodedClientQuerySnapshot<Collection.Any>,
        Schema.SchemaError | UndefinedCollectionError
      >(key, runtime, (firestore, options) => {
        const { target } = key;
        const snapshots: Stream.Stream<
          ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>,
          FirestoreError | UndefinedCollectionError
        > = target._tag === "Collection"
          ? firestore.streamDocs(target.collection, options)
          : firestore.streamDocs(target.group, options);
        return snapshots.pipe(Stream.map(decodeDocs));
      }),
    );

    // Every mutation atom runs its writes side by side: it waits for all of
    // them, and fails when any of them fails.
    const mutation = <Arg, A>(
      write: (
        firestore: ErasedClientFirestoreWrites,
        arg: Arg,
      ) => Effect.Effect<A, FirestoreError | Schema.SchemaError>,
    ) =>
      runtime.fn<Arg>()(
        (arg) =>
          Effect.flatMap(Effect.service(ClientFirestore.ClientFirestore), (firestore) =>
            write(firestore as any as ErasedClientFirestoreWrites, arg),
          ),
        { concurrent: true },
      );

    const setDocFamily = Atom.family((ref: Collection.DocumentReference<Collection.Any>) =>
      mutation((firestore, { data }: CreateArg<Collection.Any>) => firestore.setDoc(ref, data)),
    );
    const updateDocFamily = Atom.family((ref: Collection.DocumentReference<Collection.Any>) =>
      mutation((firestore, { data, mode }: UpdateArg<Collection.Any>) =>
        firestore.updateDoc(ref, data, { mode }),
      ),
    );
    const addDocFamily = Atom.family((ref: Collection.CollectionReference<Collection.Any>) =>
      mutation((firestore, { data }: CreateArg<Collection.Any>) => firestore.addDoc(ref, data)),
    );

    self.runtime = runtime;
    self.doc = (ref: Collection.DocumentReference<Collection.Any>, options?: ReadAtomOptions) =>
      docFamily(readKey(ref, options));
    self.docs = (
      source: Collection.CollectionReference<Collection.Any> | CollectionGroup.Any,
      options?: ReadAtomOptions,
    ) =>
      docsFamily(
        readKey(
          CollectionGroup.isCollectionGroup(source)
            ? new GroupTarget(source)
            : new CollectionTarget(source),
          options,
        ),
      );
    self.setDoc = setDocFamily;
    self.updateDoc = updateDocFamily;
    self.addDoc = addDocFamily;
    return self;
  };

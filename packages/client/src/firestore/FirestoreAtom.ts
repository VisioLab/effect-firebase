/**
 * Firestore atoms on Client Firestore: live reads that hold Decoded Snapshots,
 * built on `effect/reactivity`.
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
  Firestore,
  FirestoreError,
  UndefinedCollectionError,
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
 * @see {@link Service.doc} for the read atom that takes them
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
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type DecodableGroup<G extends CollectionGroup.Any, R> = G &
  Decodable<CollectionGroup.Members<G>, R>;

/** Nothing when `R` holds the Decoding Services of `C`, the missing ones otherwise. */
type Decodable<C extends Collection.Any, R> = [
  Exclude<DocumentSnapshot.DecodingServices<C>, R>,
] extends [never]
  ? unknown
  : {
      readonly "the service's layer does not provide": Exclude<
        DocumentSnapshot.DecodingServices<C>,
        R
      >;
    };

/**
 * A {@link Service} class: a Context service for Client Firestore under the
 * app's own id, with Firestore atoms as statics.
 *
 * **Details**
 *
 * `R` is everything the service's layer provides, beyond
 * {@link ClientFirestore.ClientFirestore}: the Decoding Services of the app's
 * models, for example. Its atom caches belong to the class, so the same
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
  readonly source: "default" | "cache";
  readonly includeMetadataChanges: boolean;
  readonly timeToLive: Duration.Duration | undefined;
}

/** The {@link ReadKey} for reading `target` with `options`. */
const readKey = <Target>(
  target: Target,
  options: ReadAtomOptions | undefined,
): ReadKey<Target> => ({
  target,
  source: options?.source ?? "default",
  includeMetadataChanges: options?.includeMetadataChanges ?? false,
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
  const options: ClientFirestore.ListenOptions = {
    source: key.source,
    includeMetadataChanges: key.includeMetadataChanges,
  };
  const atom = Atom.readable((get): Result => {
    const previous = get.self<Result>();
    const services = get(runtime);
    if (services._tag !== "Success") {
      return AsyncResult.replacePrevious(services, previous) as Result;
    }
    const firestore = Context.get(services.value, ClientFirestore.ClientFirestore);
    const fail = (cause: Cause.Cause<E | FirestoreError>) =>
      get.setSelf(AsyncResult.failureWithPrevious(cause, { previous: get.self<Result>() }));
    const run = listen(firestore, options).pipe(
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
 * other atoms. It also provides every Decoding Service the app's models need:
 * an atom for a model whose services it lacks does not type-check. A failure
 * of the layer is a defect in the atoms, not part of their error type.
 *
 * The class's statics are {@link Service.runtime} and the read atoms
 * {@link Service.doc} and {@link Service.docs}.
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
    return self;
  };

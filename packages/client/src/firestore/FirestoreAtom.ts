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
import { Cause, Context, Effect, Exit, Layer, Stream } from "effect";
import type { Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type {
  Create,
  Firestore,
  FirestoreError,
  Update,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
import * as ClientFirestore from "./ClientFirestore.ts";

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
 * The ref that `doc` takes when the service's layer provides everything the
 * model in `C` needs to decode, and a ref that names the missing services
 * otherwise, so the call does not type-check.
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type DecodableRef<C extends Collection.Any, R> = Collection.DocumentReference<C> &
  ([Exclude<DocumentSnapshot.DecodingServices<C>, R>] extends [never]
    ? unknown
    : {
        readonly "the service's layer does not provide": Exclude<
          DocumentSnapshot.DecodingServices<C>,
          R
        >;
      });

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

/**
 * `unknown` when `R` holds every Encoding Service a write to a document in `C`
 * through `Schema` needs, and an object naming the missing services otherwise,
 * so that a ref intersected with it does not type-check.
 */
type Encodable<C extends Collection.Any, R, Schema extends WriteSchema> = [
  Exclude<EncodingServices<C, Schema>, R>,
] extends [never]
  ? unknown
  : {
      readonly "the service's layer does not provide": Exclude<EncodingServices<C, Schema>, R>;
    };

/**
 * The ref that a mutation atom takes when the service's layer provides every
 * Encoding Service the model in `C` needs to write through `Schema`, and a ref
 * that names the missing services otherwise, so the call does not type-check.
 *
 * @see {@link EncodableCollectionRef} for the collection ref `addDoc` takes
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
 * The collection ref that {@link Service.addDoc} takes when the service's layer
 * provides every Encoding Service the model in `C` needs to create a document,
 * and a ref that names the missing services otherwise, so the call does not
 * type-check.
 *
 * @see {@link EncodableRef} for the document ref the other mutation atoms take
 *
 * @stability unstable
 * @category type-level
 * @since 0.4.0
 */
export type EncodableCollectionRef<
  C extends Collection.Any,
  R,
> = Collection.CollectionReference<C> & Encodable<C, R, "create">;

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
   * disposed. It is `Initial` until the first snapshot, then `Success`, and a
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
   * @see {@link ClientDocumentSnapshot.decode} for decoding a live read without atoms
   * @see {@link Service.runtime} for building atoms of your own
   */
  readonly doc: <C extends Collection.Any>(ref: DecodableRef<C, R>) => Atom.Atom<DocResult<C>>;

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
   * There is one atom per collection ref, shared by every add into it. With
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
   * @see {@link Service.runtime} for writes whose outcome is your own
   */
  readonly addDoc: <C extends Collection.Any>(
    ref: EncodableCollectionRef<C, R>,
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
 * Client Firestore's writes for a document of any model, whose Encoding
 * Services the runtime holds: the mutation atoms only take a ref whose model's
 * services the service's layer provides.
 */
interface AnyWrites {
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
 * The class's statics are {@link Service.runtime}, the read atom
 * {@link Service.doc}, and the mutation atoms {@link Service.setDoc},
 * {@link Service.updateDoc} and {@link Service.addDoc}.
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

    const docFamily = Atom.family((ref: Collection.DocumentReference<Collection.Any>) =>
      Atom.readable((get): DocResult<Collection.Any> => {
        const previous = get.self<DocResult<Collection.Any>>();
        const services = get(runtime);
        if (services._tag !== "Success") {
          return AsyncResult.replacePrevious(services, previous) as DocResult<Collection.Any>;
        }
        const firestore = Context.get(services.value, ClientFirestore.ClientFirestore);
        const fail = (cause: Cause.Cause<FirestoreError | Schema.SchemaError>) =>
          get.setSelf(
            AsyncResult.failureWithPrevious(cause, {
              previous: get.self<DocResult<Collection.Any>>(),
            }),
          );
        const listen = firestore.streamDoc(ref).pipe(
          // A snapshot that does not decode fails the atom, but not the
          // listen, so the next snapshot can bring the atom back.
          Stream.runForEach((snapshot) =>
            Effect.map(Effect.exit(decodeDoc(snapshot)), (exit) =>
              Exit.isSuccess(exit)
                ? get.setSelf(AsyncResult.success(exit.value))
                : fail(exit.cause),
            ),
          ),
          // The SDK has dropped the listener; it stays dropped until a refresh.
          Effect.catchCause((cause) =>
            Effect.sync(() => (Cause.hasInterruptsOnly(cause) ? undefined : fail(cause))),
          ),
        );
        const fiber = Effect.runForkWith(services.value)(listen);
        get.addFinalizer(() => fiber.interruptUnsafe());
        return AsyncResult.waitingFrom(previous);
      }),
    );

    // Every mutation atom runs its writes side by side: it waits for all of
    // them, and fails when any of them fails.
    const mutation = <Arg, A>(
      write: (
        firestore: AnyWrites,
        arg: Arg,
      ) => Effect.Effect<A, FirestoreError | Schema.SchemaError>,
    ) =>
      runtime.fn<Arg>()(
        (arg) =>
          Effect.flatMap(Effect.service(ClientFirestore.ClientFirestore), (firestore) =>
            write(firestore as any as AnyWrites, arg),
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
    self.doc = docFamily;
    self.setDoc = setDocFamily;
    self.updateDoc = updateDocFamily;
    self.addDoc = addDocFamily;
    return self;
  };

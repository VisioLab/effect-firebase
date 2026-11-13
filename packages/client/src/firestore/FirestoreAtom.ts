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
import { Cause, Context, Effect, Exit, Layer, Stream } from "effect";
import type { Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
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
 * The class's statics are {@link Service.runtime} and {@link Service.doc}.
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

    self.runtime = runtime;
    self.doc = docFamily;
    return self;
  };

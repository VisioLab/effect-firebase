/**
 * Firestore on the Firebase client SDK, for browsers.
 *
 * {@link layer} provides one service under two keys: the portable
 * {@link Firestore}, which code that runs on either SDK asks for, and
 * {@link ClientFirestore}, which adds what only the client SDK can do: read
 * sources, listen options, and the
 * {@link ClientDocumentSnapshot.SnapshotMetadata} of every read. Both reach the
 * same database.
 *
 * Where it behaves differently from the Admin SDK:
 *
 * - The emulator is a layer option, not an environment variable.
 * - A write only succeeds once the server acknowledges it, so a write made
 *   offline waits for the connection. It is applied to the local cache at once
 *   and sent when it can be; interrupting the write does not take it back.
 * - A pending server timestamp reads as the local clock's estimate, not `null`,
 *   so it decodes as a timestamp before the server has settled it.
 * - Error codes are always named, such as `permission-denied`.
 *
 * @example Reading a document, and where the read came from
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { App } from "@visiolab/effect-firebase-client";
 * import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   title: Schema.String,
 * }) {}
 *
 * const Posts = Collection.make("posts", Post);
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* ClientFirestore.ClientFirestore;
 *   const snapshot = yield* firestore.getDoc(Posts.doc(Posts.id.make("hello")));
 *   yield* Effect.log(snapshot.metadata.fromCache ? "from the cache" : "from the server");
 * });
 *
 * const FirestoreLive = ClientFirestore.layer().pipe(
 *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
 * );
 *
 * program.pipe(Effect.provide(FirestoreLive));
 * ```
 *
 * @see {@link AdminFirestore} for the same service on the Admin SDK, for servers
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context, Effect, Layer } from "effect";
import { Firestore, type With } from "@visiolab/effect-firebase/firestore/Firestore";
import type { Firestore as SdkFirestore, FirestoreLocalCache } from "firebase/firestore";
import type * as App from "../App.ts";
import type * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
// Only {@link ClientFirestore}'s documentation links to it.
// oxlint-disable-next-line no-unused-vars
import type * as ClientQuerySnapshot from "./ClientQuerySnapshot.ts";
import * as internalFirestore from "./internal/firestore.ts";

/**
 * The portable {@link Firestore}, plus what only the client SDK can do.
 *
 * **When to use**
 *
 * Ask for it where code needs the client SDK: a read from the server or the
 * cache alone, metadata changes on a listen, a snapshot's
 * {@link ClientDocumentSnapshot.SnapshotMetadata}, or the SDK itself through
 * {@link ClientFirestore.instance}. Everywhere else ask for {@link Firestore},
 * so the code also runs on the Admin SDK.
 *
 * **Details**
 *
 * Its reads take {@link ReadOptions} and its listens {@link ListenOptions}.
 * Every document snapshot, each document of a query snapshot, and each query
 * snapshot as a whole carries the `metadata` of its read, as a
 * {@link ClientDocumentSnapshot.ClientDocumentSnapshot} or
 * {@link ClientQuerySnapshot.ClientQuerySnapshot} does.
 *
 * It can be handed to code that expects a {@link Firestore} as it is. Its
 * transactions are the portable {@link Firestore.Transaction}: the client SDK's
 * transactions read one document at a time.
 *
 * The client SDK cannot abort a request in flight, so interrupting a call does
 * not stop it: the request still runs to completion.
 *
 * @see {@link Firestore.With} for each read and write it offers
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ClientFirestore extends With<
  ReadOptions,
  ListenOptions,
  { readonly metadata: ClientDocumentSnapshot.SnapshotMetadata }
> {
  /**
   * The client SDK's own `Firestore`, for the database the service was opened
   * on.
   *
   * **When to use**
   *
   * Use for what this service does not wrap, such as queries or
   * `disableNetwork` and `enableNetwork`. Prefer the service's own methods
   * where one exists.
   *
   * **Details**
   *
   * Calls through it skip the collection's model, take and return the SDK's
   * own values, and throw the SDK's own errors. To write a model through it,
   * encode with {@link FirestoreValue.toCodecFirestore} and map with
   * {@link ClientFirestoreValue.toClient}.
   *
   * @see {@link ClientFirestoreValue} for mapping between the SDK's values and Firestore Values
   */
  readonly instance: SdkFirestore;
}

/**
 * How `streamDoc` and `streamDocs` on {@link ClientFirestore} listen, named as
 * in the client SDK's own listen options.
 *
 * **When to use**
 *
 * Use to also hear metadata changes, such as a pending write being
 * acknowledged, or to listen to the local cache alone. Left out, a listen
 * behaves as the SDK's does by default: it emits only when the data changes.
 *
 * **Details**
 *
 * Every snapshot a listen emits carries the
 * {@link ClientDocumentSnapshot.SnapshotMetadata} it arrived with. The portable
 * {@link Firestore.With.streamDoc} takes no options, because the Admin SDK's
 * listeners take none.
 *
 * @example Waiting for the server to acknowledge a write
 * ```ts
 * import { Effect, Schema, Stream } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   title: Schema.String,
 * }) {}
 *
 * const Posts = Collection.make("posts", Post);
 * const hello = Posts.doc(Posts.id.make("hello"));
 *
 * const acknowledged = Effect.gen(function* () {
 *   const firestore = yield* ClientFirestore.ClientFirestore;
 *   yield* firestore.streamDoc(hello, { includeMetadataChanges: true }).pipe(
 *     Stream.filter((snapshot) => !snapshot.metadata.hasPendingWrites),
 *     Stream.runHead,
 *   );
 * });
 * ```
 *
 * @see {@link ReadOptions} for the options of a one-off read
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ListenOptions {
  /**
   * Whether to also emit when only the
   * {@link ClientDocumentSnapshot.SnapshotMetadata} changes, such as when the
   * server acknowledges a pending write or the cache catches up with the
   * server. Without it, a listen only emits when the data changes.
   */
  readonly includeMetadataChanges?: boolean | undefined;
  /**
   * Where to listen. `"default"` listens to the server and the local cache.
   * `"cache"` listens to the local cache alone and never reaches the server, so
   * it only sees what this client has written or already read.
   */
  readonly source?: "default" | "cache" | undefined;
}

/**
 * Service key for {@link ClientFirestore}.
 *
 * @see {@link Firestore} for the portable key, which {@link layer} provides the same service under
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export const ClientFirestore = Context.Service<ClientFirestore>(
  "@visiolab/effect-firebase-client/firestore/ClientFirestore",
);

/**
 * Where a one-off read is served from.
 *
 * - `"default"`: the server when it can be reached, otherwise the local cache.
 *   What a read does when no source is given.
 * - `"server"`: the server alone. Fails with the SDK's code when the server
 *   cannot be reached, instead of falling back to the cache.
 * - `"cache"`: the local cache alone, without asking the server.
 *
 * The two reads report what the cache lacks differently, as the SDK does. A
 * cached `getDoc` of a document the cache has never seen fails with a
 * {@link Firestore.FirestoreError} whose code is `unavailable`, and one the
 * cache knows was deleted reads as `Missing`. A cached `getDocs` never fails
 * for what the cache lacks: it returns whatever the cache holds, which may be
 * nothing, with `fromCache: true`.
 *
 * @see {@link ReadOptions} for passing it to a read
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ReadSource = "default" | "server" | "cache";

/**
 * How `getDoc` and `getDocs` on {@link ClientFirestore} read a document, a
 * collection, or a Collection Group.
 *
 * **When to use**
 *
 * Use to read from the server alone, such as to confirm a value before acting
 * on it, or from the local cache alone, such as to render at once while
 * offline. Left out, a read behaves as the SDK's does by default.
 *
 * **Details**
 *
 * With `source: "cache"`, a `getDoc` of a document the cache has never seen
 * fails with a {@link Firestore.FirestoreError} whose code is `unavailable`:
 * not being cached is not the same as not existing. One the cache knows was
 * deleted reads as `Missing`. A `getDocs` never fails for what the cache lacks:
 * it returns whatever the cache holds, which may be nothing, with `fromCache:
 * true`. So, unlike `getDoc`, an empty result cannot tell "nothing cached" from
 * "nothing there".
 *
 * The portable {@link Firestore.With.getDoc} takes no options, because the
 * Admin SDK's reads take none.
 *
 * @example Reading from the server alone
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   title: Schema.String,
 * }) {}
 *
 * const Posts = Collection.make("posts", Post);
 *
 * const fresh = Effect.gen(function* () {
 *   const firestore = yield* ClientFirestore.ClientFirestore;
 *   return yield* firestore.getDoc(Posts.doc(Posts.id.make("hello")), { source: "server" });
 * });
 * ```
 *
 * @see {@link ReadSource} for where a read can be served from
 * @see {@link ListenOptions} for the options of a listen
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface ReadOptions {
  /**
   * Where the read is served from. Left out, it is `"default"`.
   *
   * @see {@link ReadSource} for each source, and what a cached read does with what the cache lacks
   */
  readonly source?: ReadSource | undefined;
}

/**
 * Where the Firestore emulator listens, such as `{ host: "127.0.0.1", port:
 * 8080 }`.
 *
 * @see {@link Options.emulator} for connecting to it
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Emulator {
  readonly host: string;
  readonly port: number;
}

/**
 * How {@link layer} opens a database. All of them are fixed once the database
 * is open.
 *
 * @see {@link AdminFirestore.Options} for the Admin SDK's, which read the emulator from the environment
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * The database to open, where the project has more than its default one.
   * Leave it out for the default database.
   */
  readonly databaseId?: string | undefined;
  /**
   * The emulator to talk to instead of the project's database.
   *
   * Unlike the Admin SDK, the client SDK takes the emulator per database, not
   * from the environment, and only before the database is first used.
   */
  readonly emulator?: Emulator | undefined;
  /**
   * Where the SDK keeps the documents it has seen and the writes it has yet to
   * send: `memoryLocalCache()`, the SDK's default, or `persistentLocalCache()`,
   * which keeps them in IndexedDB across reloads.
   */
  readonly localCache?: FirestoreLocalCache | undefined;
}

/**
 * Builds {@link ClientFirestore} on the {@link App.App} in context.
 *
 * **When to use**
 *
 * Use to build the service inside an effect of your own. Most programs provide
 * it with {@link layer} instead, which also provides it as {@link Firestore}.
 *
 * **Details**
 *
 * Building the service cannot fail. Opening a database only throws for an app
 * that was already deleted, or a database already opened or used with other
 * settings. Both are wiring mistakes, so they are defects, and a
 * {@link Firestore.FirestoreError} only ever means that a call failed.
 *
 * A write only succeeds once the server acknowledges it, so a write made
 * offline waits for the connection. It is applied to the local cache at once
 * and sent when it can be: interrupting the write, or timing it out, does not
 * take it back.
 *
 * A server timestamp the server has not settled yet reads as the local clock's
 * estimate, so the field decodes as a timestamp.
 *
 * @see {@link layer} for the same as a layer
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make: (options?: Options) => Effect.Effect<ClientFirestore, never, App.App> =
  Effect.fn("ClientFirestore.make")(function* (options?: Options) {
    const firestore = yield* internalFirestore.openDatabase(options);
    return internalFirestore.fromDatabase(firestore);
  });

/** The one service, under both its own tag and the portable one. */
const both = (service: ClientFirestore) =>
  Context.make(ClientFirestore, service).pipe(Context.add(Firestore, service));

/**
 * A layer that provides {@link ClientFirestore} for the {@link App.App} in
 * context, and the same service as the portable {@link Firestore}.
 *
 * **When to use**
 *
 * Use in a browser, or anywhere the client SDK runs. On a server, use
 * {@link AdminFirestore.layer} instead.
 *
 * **Details**
 *
 * With no options it opens the project's default database with the SDK's
 * defaults.
 *
 * @example Providing Firestore with a persistent cache
 * ```ts
 * import { Layer } from "effect";
 * import { persistentLocalCache } from "firebase/firestore";
 * import { App } from "@visiolab/effect-firebase-client";
 * import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";
 *
 * const FirestoreLive = ClientFirestore.layer({
 *   localCache: persistentLocalCache(),
 *   emulator: import.meta.env.DEV ? { host: "127.0.0.1", port: 8080 } : undefined,
 * }).pipe(
 *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
 * );
 * ```
 *
 * @see {@link make} for why building the service cannot fail
 * @see {@link AdminFirestore.layer} for the Admin SDK's layer, for servers
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = (
  options?: Options,
): Layer.Layer<ClientFirestore | Firestore, never, App.App> =>
  Layer.effectContext(Effect.map(make(options), both));

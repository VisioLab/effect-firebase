/**
 * Client Firestore: a {@link Firestore} for a single app that also offers what
 * only the Firebase client SDK can do.
 *
 * Its layers provide one service under both the {@link ClientFirestore} tag and
 * the portable {@link Firestore} one, so portable code and client-specific code
 * share the same database, settings and encoder.
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context, Effect, Layer } from "effect";
import type { Stream } from "effect";
import { Firestore } from "@visiolab/effect-firebase/firestore/Firestore";
import type { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import type { Firestore as SdkFirestore, FirestoreLocalCache } from "firebase/firestore";
import type * as App from "../App.ts";
import type * as ClientDocumentSnapshot from "./ClientDocumentSnapshot.ts";
import type * as ClientQuerySnapshot from "./ClientQuerySnapshot.ts";
import * as internalFirestore from "./internal/firestore.ts";

/**
 * A {@link Firestore} that also offers what only the client SDK can do.
 *
 * It is assignable wherever a {@link Firestore} is expected, so it can be
 * handed to portable code as is.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ClientFirestore extends Firestore {
  /**
   * The client SDK's own Firestore object behind this service.
   *
   * For what this library does not wrap, such as turning the network off and
   * on. What is done through it goes around the schemas and the typed errors.
   */
  readonly instance: SdkFirestore;

  /**
   * Reads one document, as {@link Firestore.getDoc} does, with the
   * {@link ClientDocumentSnapshot.SnapshotMetadata} of the read.
   *
   * With `source: "cache"`, a document the cache has never seen fails with a
   * `FirestoreError` whose code is `unavailable`: not being cached is not the
   * same as not existing. One the cache knows was deleted reads as `Missing`.
   *
   * @see {@link ReadOptions} for where a read can be served from.
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    options?: ReadOptions,
  ) => Effect.Effect<ClientDocumentSnapshot.ClientDocumentSnapshot<C>, FirestoreError>;

  /**
   * Reads every document in one collection, as {@link Firestore.getDocs}
   * does, with the {@link ClientDocumentSnapshot.SnapshotMetadata} of the read
   * as a whole and of each document.
   *
   * With `source: "cache"`, it never fails for what the cache lacks: it hands
   * back whatever the cache holds, which may be nothing, with `fromCache:
   * true`. Unlike {@link getDoc}, an empty result cannot tell "nothing cached"
   * from "nothing there".
   *
   * @see {@link ReadOptions} for where a read can be served from.
   */
  readonly getDocs: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
    options?: ReadOptions,
  ) => Effect.Effect<ClientQuerySnapshot.ClientQuerySnapshot<C>, FirestoreError>;

  /**
   * Listens to one document, as {@link Firestore.streamDoc} does, each
   * snapshot with the {@link ClientDocumentSnapshot.SnapshotMetadata} it
   * arrived with, listening as `options` says.
   */
  readonly streamDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    options?: ListenOptions,
  ) => Stream.Stream<ClientDocumentSnapshot.ClientDocumentSnapshot<C>, FirestoreError>;

  /**
   * Listens to one collection, as {@link Firestore.streamDocs} does, each
   * snapshot with the {@link ClientDocumentSnapshot.SnapshotMetadata} it
   * arrived with, listening as `options` says.
   */
  readonly streamDocs: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
    options?: ListenOptions,
  ) => Stream.Stream<ClientQuerySnapshot.ClientQuerySnapshot<C>, FirestoreError>;
}

/**
 * How {@link ClientFirestore.streamDoc} and {@link ClientFirestore.streamDocs}
 * listen, named as in the client SDK's own listen options.
 *
 * Leaving them out listens as the SDK does by default. The Admin SDK's
 * listeners take no options, which is why the portable streams do not either.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ListenOptions {
  /**
   * Whether to emit as well when only the
   * {@link ClientDocumentSnapshot.SnapshotMetadata} changes, such as when the
   * server acknowledges a pending write or the cache catches up with the
   * server. Without it, a snapshot is only emitted when what was read changes.
   */
  readonly includeMetadataChanges?: boolean | undefined;
  /**
   * Where to listen: `"default"` listens to the server and the local cache,
   * `"cache"` to the local cache alone, never reaching the server and so only
   * seeing what this client has written or already read.
   */
  readonly source?: "default" | "cache" | undefined;
}

/**
 * Service key for {@link ClientFirestore}.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const ClientFirestore = Context.Service<ClientFirestore>(
  "@visiolab/effect-firebase-client/firestore/ClientFirestore",
);

/**
 * Where a one-off read is served from.
 *
 * - `"default"`: the server when it can be reached, the local cache when it
 *   cannot - what a read does when no source is given.
 * - `"server"`: the server alone. Fails when it cannot be reached, with the
 *   SDK's code, rather than fall back to the cache.
 * - `"cache"`: the local cache alone, without asking the server.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type ReadSource = "default" | "server" | "cache";

/**
 * How {@link ClientFirestore.getDoc} and {@link ClientFirestore.getDocs} read.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface ReadOptions {
  /** Where the read is served from. Left out, it is `"default"`. */
  readonly source?: ReadSource | undefined;
}

/**
 * Where an emulator listens.
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
 * How to open a database.
 *
 * All of these are settled when the database is opened rather than per call,
 * which is why they are a layer's business and not a method's.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /**
   * The database to read, where the project holds more than the one it is
   * given by default.
   */
  readonly databaseId?: string | undefined;
  /**
   * The emulator to talk to instead of the project's database.
   *
   * Unlike the Admin SDK, the client SDK takes this per database rather than
   * from the environment, and only before the database is first used.
   */
  readonly emulator?: Emulator | undefined;
  /**
   * Where the SDK keeps the documents it has seen and the writes it has yet to
   * send: `memoryLocalCache()`, the SDK's own default, or
   * `persistentLocalCache()`, which keeps them in IndexedDB across reloads.
   */
  readonly localCache?: FirestoreLocalCache | undefined;
}

/**
 * Builds {@link ClientFirestore} on top of the {@link App.App} in context.
 *
 * Constructing the service cannot fail: opening a database only throws when the
 * app has already been deleted, or when the same database was already opened -
 * or already used - with settings that disagree. Both mean the app was wired up
 * wrong rather than that a call went wrong, so they surface as defects and
 * `FirestoreError` keeps its single meaning of "a Firestore call failed".
 *
 * The client SDK has no way to abort a request in flight, so these effects run
 * their call to completion even when the fiber is interrupted.
 *
 * A write only succeeds once the server has acknowledged it, so a write made
 * offline waits for the connection to come back. It is applied to the local
 * cache straight away, though, and sent whenever it can be: interrupting the
 * effect, or timing it out, does not take it back.
 *
 * A document is read with the server timestamps it is still waiting on
 * estimated from the local clock, so a field one was written into reads back
 * as a timestamp even before the server has settled it.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make: (options?: Options) => Effect.Effect<ClientFirestore, never, App.App> =
  Effect.fn("ClientFirestore.make")(function* (options?: Options) {
    const { firestore, encoder } = yield* internalFirestore.openWithEncoder(options);
    return internalFirestore.fromDatabase(firestore, encoder);
  });

/** The one service, under both its own tag and the portable one. */
const both = (service: ClientFirestore) =>
  Context.make(ClientFirestore, service).pipe(Context.add(Firestore, service));

/**
 * A layer that provides {@link ClientFirestore} for the {@link App.App} in
 * context, as both {@link ClientFirestore} and the portable {@link Firestore}.
 * Both resolve to the same object.
 *
 * Passing no options reads the project's default database, opened with the
 * SDK's own defaults.
 *
 * The encoder a document is written through is built in here rather than
 * asked of the caller, since it is the client SDK's own and has to point into
 * the database the options name. It stays inside the service:
 * {@link layerWithEncoder} provides it as well.
 *
 * @see {@link make} for why building the service cannot fail.
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = (
  options?: Options,
): Layer.Layer<ClientFirestore | Firestore, never, App.App> =>
  Layer.effectContext(Effect.map(make(options), both));

/**
 * {@link layer}, providing the {@link FirestoreEncoder} the service writes
 * through as well.
 *
 * For encoding a write the service does not make itself. The encoder is the
 * service's own rather than a second one, so a reference it writes points into
 * the same database the service reads and writes.
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layerWithEncoder = (
  options?: Options,
): Layer.Layer<ClientFirestore | Firestore | FirestoreEncoder, never, App.App> =>
  Layer.effectContext(
    Effect.map(internalFirestore.openWithEncoder(options), ({ firestore, encoder }) =>
      both(internalFirestore.fromDatabase(firestore, encoder)).pipe(
        Context.add(FirestoreEncoder, encoder),
      ),
    ),
  );

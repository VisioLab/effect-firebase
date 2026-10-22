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
   */
  readonly getDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
  ) => Effect.Effect<ClientDocumentSnapshot.ClientDocumentSnapshot<C>, FirestoreError>;

  /**
   * Reads every document in one collection, as {@link Firestore.getDocs}
   * does, with the {@link ClientDocumentSnapshot.SnapshotMetadata} of the read
   * as a whole and of each document.
   */
  readonly getDocs: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
  ) => Effect.Effect<ClientQuerySnapshot.ClientQuerySnapshot<C>, FirestoreError>;

  /**
   * Listens to one document, as {@link Firestore.streamDoc} does, each
   * snapshot with the {@link ClientDocumentSnapshot.SnapshotMetadata} it
   * arrived with.
   */
  readonly streamDoc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
  ) => Stream.Stream<ClientDocumentSnapshot.ClientDocumentSnapshot<C>, FirestoreError>;

  /**
   * Listens to one collection, as {@link Firestore.streamDocs} does, each
   * snapshot with the {@link ClientDocumentSnapshot.SnapshotMetadata} it
   * arrived with.
   */
  readonly streamDocs: <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
  ) => Stream.Stream<ClientQuerySnapshot.ClientQuerySnapshot<C>, FirestoreError>;
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

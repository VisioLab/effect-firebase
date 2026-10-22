/**
 * Firestore for a single app, as exposed by the Firebase client SDK.
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context, Effect, Layer } from "effect";
import { Firestore } from "@visiolab/effect-firebase/firestore/Firestore";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import type { FirestoreLocalCache } from "firebase/firestore";
import type * as App from "../App.ts";
import * as internalFirestore from "./internal/firestore.ts";

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
 * Builds {@link Firestore} on top of the {@link App.App} in context.
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
export const make = Effect.fn("Firestore.make")(function* (options?: Options) {
  const { firestore, encoder } = yield* internalFirestore.openWithEncoder(options);
  return internalFirestore.fromDatabase(firestore, encoder);
});

/**
 * A layer that provides {@link Firestore} for the {@link App.App} in context.
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
export const layer = (options?: Options): Layer.Layer<Firestore, never, App.App> =>
  Layer.effect(Firestore, make(options));

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
): Layer.Layer<Firestore | FirestoreEncoder, never, App.App> =>
  Layer.effectContext(
    Effect.map(internalFirestore.openWithEncoder(options), ({ firestore, encoder }) =>
      Context.make(Firestore, internalFirestore.fromDatabase(firestore, encoder)).pipe(
        Context.add(FirestoreEncoder, encoder),
      ),
    ),
  );

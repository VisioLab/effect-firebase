/**
 * Firestore for a single app, as exposed by the Firebase Admin SDK.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Context, Effect, Layer } from "effect";
import { Firestore } from "@visiolab/effect-firebase/firestore/Firestore";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import type * as App from "../App.ts";
import * as internalFirestore from "./internal/firestore.ts";

/**
 * How to open a database.
 *
 * Both of these are settled when the database is opened rather than per call,
 * which is why they are a layer's business and not a method's.
 *
 * The emulator is not among them: the Admin SDK picks it up from the
 * `FIRESTORE_EMULATOR_HOST` environment variable, which has to be set before
 * the database is opened and is read by every app in the process rather than by
 * one layer.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Options {
  /**
   * The database to read, where the project holds more than the one it is
   * given by default.
   */
  readonly databaseId?: string | undefined;
  /**
   * Talk HTTP/1.1 rather than gRPC, until something is asked for that gRPC is
   * the only way to do.
   *
   * Worth it where a process handles a request or two and exits, since it
   * saves loading the gRPC libraries and opening a channel. Listening to a
   * document is the one thing that needs gRPC, at which point the SDK loads it
   * and stays on it.
   */
  readonly preferRest?: boolean | undefined;
}

/**
 * Builds {@link Firestore} on top of the {@link App.App} in context.
 *
 * Constructing the service cannot fail: opening a database only throws when the
 * app has already been deleted, when it was handed something that is not an
 * app, or when the same database was already opened with settings that
 * disagree. All three mean the app was wired up wrong rather than that a call
 * went wrong, so they surface as defects and `FirestoreError` keeps its single
 * meaning of "a Firestore call failed".
 *
 * The Admin SDK has no way to abort a request in flight, so these effects run
 * their call to completion even when the fiber is interrupted.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
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
 * asked of the caller, since it is the Admin SDK's own and has to point into
 * the database the options name. It stays inside the service:
 * {@link layerWithEncoder} provides it as well.
 *
 * @see {@link make} for why building the service cannot fail.
 *
 * @stability unstable
 * @category layers
 * @since 0.2.0
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
 * @since 0.2.0
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

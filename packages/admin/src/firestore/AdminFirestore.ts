/**
 * Admin Firestore for a single app: a {@link Firestore}, plus what only the
 * Firebase Admin SDK can do.
 *
 * Its layers provide one service under both {@link AdminFirestore} and the
 * portable {@link Firestore}, so portable code and code that needs the Admin
 * SDK share one database.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Context, Effect, Layer } from "effect";
import { Firestore, type With } from "@visiolab/effect-firebase/firestore/Firestore";
import type { Transaction } from "@visiolab/effect-firebase/firestore/Firestore";
import type * as Admin from "firebase-admin/firestore";
import type * as App from "../App.ts";
import * as internalFirestore from "./internal/firestore.ts";

/**
 * A {@link Firestore} that also offers what only the Admin SDK can do.
 *
 * It only ever widens {@link Firestore}, so it can be handed to portable code
 * as it is. A {@link Firestore.runTransaction} body finds its transaction both
 * as the {@link AdminTransaction} and as the portable {@link Transaction}: the
 * same transaction, so portable transaction helpers and ones that need the
 * Admin SDK can run in the same body, and neither is left for the caller to
 * provide.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface AdminFirestore extends With<never, never, {}, AdminTransaction> {
  /**
   * The Admin SDK's own Firestore, for the database the service was opened
   * on.
   *
   * For what this service does not wrap yet. What goes through it skips the
   * collection's model and comes back as the SDK's own values and errors.
   */
  readonly instance: Admin.Firestore;
}

/**
 * Service key for a {@link Transaction} that can also read every document in
 * a collection or a Collection Group, which only the Admin SDK's transactions
 * can. An {@link AdminFirestore.runTransaction} body runs in one. The
 * transaction itself is an `AdminTransaction["Service"]`.
 *
 * It holds to the same rules as {@link Transaction}: a read of many is a
 * read, so it comes before every write.
 *
 * The key is a class, not the transaction's own type, so a body asking for it
 * is told apart from one asking for {@link Transaction}: run through the
 * portable {@link Firestore}, such a body still asks its caller for it.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export class AdminTransaction extends Context.Service<
  AdminTransaction,
  Transaction & {
    /**
     * Reads every document in a collection or a Collection Group, as
     * {@link Firestore.getDocs} does, as part of the transaction.
     *
     * Every document it hands back is locked for the rest of the transaction,
     * so another write to one of them makes the transaction run again. A group
     * read that fails with an `UndefinedCollectionError` fails the body,
     * which rolls the transaction back without running it again.
     */
    readonly getDocs: Firestore["getDocs"];
  }
>()("@visiolab/effect-firebase-admin/firestore/AdminFirestore/AdminTransaction") {}

/**
 * Service key for {@link AdminFirestore}.
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const AdminFirestore = Context.Service<AdminFirestore>(
  "@visiolab/effect-firebase-admin/firestore/AdminFirestore",
);

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
 * Builds {@link AdminFirestore} on top of the {@link App.App} in context.
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
export const make = Effect.fn("AdminFirestore.make")(function* (options?: Options) {
  const firestore = yield* internalFirestore.openDatabase(options);
  return internalFirestore.fromDatabase(firestore, AdminTransaction);
});

/** The one service, under both its own tag and the portable one. */
const both = (service: AdminFirestore) =>
  Context.make(AdminFirestore, service).pipe(Context.add(Firestore, service));

/**
 * A layer that provides {@link AdminFirestore} for the {@link App.App} in
 * context, and the same service as {@link Firestore} too.
 *
 * Passing no options reads the project's default database, opened with the
 * SDK's own defaults.
 *
 * A document written through the service is encoded with `toCodecFirestore`
 * and mapped by `AdminFirestoreValue.toAdmin` into the database the options
 * name. A write the service does not make itself takes those two directly.
 *
 * @see {@link make} for why building the service cannot fail.
 *
 * @stability unstable
 * @category layers
 * @since 0.2.0
 */
export const layer = (options?: Options): Layer.Layer<AdminFirestore | Firestore, never, App.App> =>
  Layer.effectContext(Effect.map(make(options), both));

/**
 * Firestore on the Firebase Admin SDK, for servers.
 *
 * {@link layer} provides one service under two keys: the portable
 * {@link Firestore}, which code that runs on either SDK asks for, and
 * {@link AdminFirestore}, which adds what only the Admin SDK can do. Both reach
 * the same database.
 *
 * @example Reading and writing a document
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Collection, Firestore, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { App } from "@visiolab/effect-firebase-admin";
 * import { AdminFirestore } from "@visiolab/effect-firebase-admin/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   title: Schema.String,
 * }) {}
 *
 * const Posts = Collection.make("posts", Post);
 * const hello = Posts.doc(Posts.id.make("hello"));
 *
 * const program = Effect.gen(function* () {
 *   const firestore = yield* Firestore.Firestore;
 *   yield* firestore.setDoc(hello, { title: "Hello" });
 *   return yield* firestore.getDoc(hello);
 * });
 *
 * const FirestoreLive = AdminFirestore.layer().pipe(Layer.provide(App.layer()));
 *
 * program.pipe(Effect.provide(FirestoreLive));
 * ```
 *
 * @see {@link ClientFirestore} for the same service on the client SDK, for browsers
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
 * The portable {@link Firestore}, plus what only the Admin SDK can do.
 *
 * **When to use**
 *
 * Ask for it where code needs the Admin SDK: {@link AdminTransaction} reads of
 * many documents, or the SDK itself through {@link AdminFirestore.instance}.
 * Everywhere else ask for {@link Firestore}, so the code also runs on the
 * client SDK.
 *
 * **Details**
 *
 * It only adds to {@link Firestore}, so it can be handed to portable code as it
 * is. A {@link Firestore.With.runTransaction} body finds its transaction both
 * as {@link AdminTransaction} and as the portable
 * {@link Firestore.Transaction}. They are the same transaction, so portable
 * helpers and Admin-only ones can run in the same body.
 *
 * The Admin SDK cannot abort a request in flight, so interrupting a call does
 * not stop it: the request still runs to completion.
 *
 * @see {@link Firestore.With} for each read and write it offers
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface AdminFirestore extends With<never, never, {}, AdminTransaction> {
  /**
   * The Admin SDK's own `Firestore`, for the database the service was opened
   * on.
   *
   * **When to use**
   *
   * Use for what this service does not wrap, such as queries, batched writes
   * or `recursiveDelete`. Prefer the service's own methods where one exists.
   *
   * **Details**
   *
   * Calls through it skip the collection's model, take and return the SDK's
   * own values, and throw the SDK's own errors. To write a model through it,
   * encode with {@link FirestoreValue.toCodecFirestore} and map with
   * {@link AdminFirestoreValue.toAdmin}.
   *
   * @see {@link AdminFirestoreValue} for mapping between the SDK's values and Firestore Values
   */
  readonly instance: Admin.Firestore;
}

/**
 * Service key for a {@link Firestore.Transaction} that can also read every
 * document in a collection or a Collection Group, which only the Admin SDK's
 * transactions can.
 *
 * **When to use**
 *
 * Ask for it in a transaction body that reads many documents. A body that only
 * reads single documents should ask for the portable
 * {@link Firestore.Transaction}, so it also runs on the client SDK.
 *
 * **Details**
 *
 * A body run through {@link AdminFirestore} finds it next to
 * {@link Firestore.Transaction}; the transaction itself is an
 * `AdminTransaction["Service"]`. A body that asks for it and runs through the
 * portable {@link Firestore} still needs it provided, so the compiler catches
 * Admin-only code handed to portable code.
 *
 * The same rules hold as for {@link Firestore.Transaction}: a read of many is a
 * read, so it comes before every write.
 *
 * @example Reading a collection in a transaction
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { AdminFirestore } from "@visiolab/effect-firebase-admin/firestore";
 *
 * class Seat extends FirestoreModel.Class<Seat>("Seat")({
 *   taken: Schema.Boolean,
 * }) {}
 *
 * const Seats = Collection.make("seats", Seat);
 *
 * const takeAnySeat = Effect.gen(function* () {
 *   const firestore = yield* AdminFirestore.AdminFirestore;
 *   return yield* firestore.runTransaction(
 *     Effect.gen(function* () {
 *       const tx = yield* AdminFirestore.AdminTransaction;
 *       const { docs } = yield* tx.getDocs(Seats.collection());
 *       for (const seat of docs) {
 *         if (!(yield* seat.data).taken) {
 *           yield* tx.updateDoc(seat.ref, { taken: true });
 *           return seat.id;
 *         }
 *       }
 *       return undefined;
 *     }),
 *   );
 * });
 * ```
 *
 * @see {@link Firestore.Transaction} for the portable transaction, which reads one document at a time
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export class AdminTransaction extends Context.Service<
  AdminTransaction,
  Transaction & {
    /**
     * Reads every document in a collection or a Collection Group as part of the
     * transaction, as {@link Firestore.With.getDocs} does outside one.
     *
     * Every document it returns is locked for the rest of the transaction, so
     * another write to one of them makes the transaction run again. A group
     * read that fails with an {@link Firestore.UndefinedCollectionError} fails
     * the body, which rolls the transaction back without running it again.
     */
    readonly getDocs: Firestore["getDocs"];
  }
>()("@visiolab/effect-firebase-admin/firestore/AdminFirestore/AdminTransaction") {}

/**
 * Service key for {@link AdminFirestore}.
 *
 * @see {@link Firestore} for the portable key, which {@link layer} provides the same service under
 *
 * @stability unstable
 * @category services
 * @since 0.2.0
 */
export const AdminFirestore = Context.Service<AdminFirestore>(
  "@visiolab/effect-firebase-admin/firestore/AdminFirestore",
);

/**
 * How {@link layer} opens a database. Both are fixed once the database is open.
 *
 * There is no emulator option. The Admin SDK reads the emulator from the
 * `FIRESTORE_EMULATOR_HOST` environment variable, which must be set before the
 * database is opened and applies to every app in the process.
 *
 * @see {@link ClientFirestore.Options} for the client SDK's, which take the emulator per database
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Options {
  /**
   * The database to open, where the project has more than its default one.
   * Leave it out for the default database.
   */
  readonly databaseId?: string | undefined;
  /**
   * Talk HTTP/1.1 instead of gRPC until something needs gRPC.
   *
   * Use it where a process handles a request or two and exits, such as a
   * function: it saves loading the gRPC libraries and opening a channel.
   * Listening is the one thing that needs gRPC; the first listen loads it and
   * the SDK stays on it.
   */
  readonly preferRest?: boolean | undefined;
}

/**
 * Builds {@link AdminFirestore} on the {@link App.App} in context.
 *
 * **When to use**
 *
 * Use to build the service inside an effect of your own. Most programs provide
 * it with {@link layer} instead, which also provides it as {@link Firestore}.
 *
 * **Details**
 *
 * Building the service cannot fail. Opening a database only throws for an app
 * that was already deleted, something that is not an app, or a database already
 * opened with other settings. All three are wiring mistakes, so they are
 * defects, and a {@link Firestore.FirestoreError} only ever means that a call
 * failed.
 *
 * @see {@link layer} for the same as a layer
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
 * context, and the same service as the portable {@link Firestore}.
 *
 * **When to use**
 *
 * Use on a server, or anywhere the Admin SDK runs. In a browser, use
 * {@link ClientFirestore.layer} instead.
 *
 * **Details**
 *
 * With no options it opens the project's default database with the SDK's
 * defaults.
 *
 * @example Providing Firestore against the emulator
 * ```ts
 * import { Layer } from "effect";
 * import { App } from "@visiolab/effect-firebase-admin";
 * import { AdminFirestore } from "@visiolab/effect-firebase-admin/firestore";
 *
 * // The Admin SDK reads FIRESTORE_EMULATOR_HOST, such as "127.0.0.1:8080".
 * const FirestoreLive = AdminFirestore.layer({ preferRest: true }).pipe(
 *   Layer.provide(App.layer({ projectId: "demo-project" })),
 * );
 * ```
 *
 * @see {@link make} for why building the service cannot fail
 * @see {@link ClientFirestore.layer} for the client SDK's layer, for browsers
 *
 * @stability unstable
 * @category layers
 * @since 0.2.0
 */
export const layer = (options?: Options): Layer.Layer<AdminFirestore | Firestore, never, App.App> =>
  Layer.effectContext(Effect.map(make(options), both));

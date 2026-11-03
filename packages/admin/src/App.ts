/**
 * The Firebase Admin SDK app as an Effect service.
 *
 * Every other service in this package, such as {@link Auth.Auth} and
 * {@link AdminFirestore.AdminFirestore}, is built on the {@link App} in
 * context. Provide it with {@link layer}, or hand it an app the host already
 * initialized.
 *
 * @example Initializing the app for a program
 * ```ts
 * import { Effect } from "effect";
 * import { App } from "@visiolab/effect-firebase-admin";
 *
 * const program = Effect.gen(function* () {
 *   const app = yield* App.App;
 *   yield* Effect.log(`Running against ${app.name}`);
 * });
 *
 * program.pipe(Effect.provide(App.layer()));
 * ```
 *
 * @see [Add the Firebase Admin SDK to your server](https://firebase.google.com/docs/admin/setup)
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import type * as Admin from "firebase-admin/app";
// Only the module's documentation links to these.
// oxlint-disable-next-line no-unused-vars
import type * as Auth from "./Auth.ts";
// oxlint-disable-next-line no-unused-vars
import type * as AdminFirestore from "./firestore/AdminFirestore.ts";
import * as internalApp from "./internal/app.ts";

/**
 * A Firebase Admin SDK app: the SDK's own `App`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface App extends Admin.App {}

/**
 * Service key for the Firebase Admin SDK app.
 *
 * **When to use**
 *
 * Use to provide an app the host already initialized, such as one from
 * `getApp()`, with `Layer.succeed`. Nothing deletes an app provided this way.
 *
 * @example Providing an app the host initialized
 * ```ts
 * import { Layer } from "effect";
 * import { getApp } from "firebase-admin/app";
 * import { App } from "@visiolab/effect-firebase-admin";
 *
 * const AppLive = Layer.succeed(App.App, getApp());
 * ```
 *
 * @see {@link layer} for initializing the app for the lifetime of a layer
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export const App = Context.Service<App>("@visiolab/effect-firebase-admin/App");

/**
 * Fails {@link make} and {@link layer} when the Admin SDK refuses to initialize
 * the app, with what it threw as the `cause`.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class AppError extends Schema.TaggedError<AppError, { readonly brand: unique symbol }>()(
  "AppError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * Initializes a Firebase Admin SDK app, and deletes it again when the
 * surrounding scope closes.
 *
 * **When to use**
 *
 * Use to build the app inside an effect of your own. Most programs provide it
 * with {@link layer} instead.
 *
 * **Details**
 *
 * Takes the arguments of `initializeApp(options, name)`. With no options, the
 * Admin SDK initializes the app from the `FIREBASE_CONFIG` environment variable
 * and application default credentials.
 *
 * An app already registered under the same name is not deleted when the scope
 * closes. The Admin SDK only hands back that app when the request matches how
 * it was created: it rejects auto-init against explicit options, and rejects
 * reuse outright when either side carries a credential or an `httpAgent`. To
 * pick up an app the host initialized, provide `getApp()` as {@link App}.
 *
 * Fails with an {@link AppError} when the Admin SDK refuses to initialize the
 * app. A failure to delete the app is logged as a warning, not raised.
 *
 * @see {@link layer} for the same as a layer
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = Effect.fn("App.make")(function* (options?: Admin.AppOptions, name?: string) {
  const { app } = yield* Effect.acquireRelease(
    Effect.try({
      try: () => internalApp.initialize(options, name),
      catch: (cause) =>
        new AppError({ message: "Failed to initialize the Firebase Admin SDK app", cause }),
    }),
    internalApp.release,
  );
  return app;
});

/**
 * A layer that initializes a Firebase Admin SDK app for the lifetime of the
 * layer.
 *
 * **When to use**
 *
 * Use when this program owns the app. Where the host has already initialized
 * one, provide that app as {@link App} instead.
 *
 * **Details**
 *
 * Takes the arguments of `initializeApp(options, name)`. With no options, the
 * Admin SDK initializes the app from the `FIREBASE_CONFIG` environment variable
 * and application default credentials.
 *
 * @example Initializing a named app with explicit options
 * ```ts
 * import { App } from "@visiolab/effect-firebase-admin";
 *
 * const AppLive = App.layer({ projectId: "my-project" }, "secondary");
 * ```
 *
 * @see {@link make} for how the app is initialized and torn down
 * @see {@link App} for providing an app the host initialized
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = (options?: Admin.AppOptions, name?: string): Layer.Layer<App, AppError> =>
  Layer.effect(App, make(options, name));

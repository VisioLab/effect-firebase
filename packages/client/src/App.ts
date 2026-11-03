/**
 * The Firebase client SDK app as an Effect service.
 *
 * Every other service in this package, such as
 * {@link ClientFirestore.ClientFirestore}, is built on the {@link App} in
 * context. Provide it with {@link layer}, or hand it an app initialized
 * elsewhere.
 *
 * @example Initializing the app for a program
 * ```ts
 * import { Effect } from "effect";
 * import { App } from "@visiolab/effect-firebase-client";
 *
 * const program = Effect.gen(function* () {
 *   const app = yield* App.App;
 *   yield* Effect.log(`Running against ${app.name}`);
 * });
 *
 * program.pipe(
 *   Effect.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
 * );
 * ```
 *
 * @see [Add Firebase to your JavaScript project](https://firebase.google.com/docs/web/setup)
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import type * as Client from "firebase/app";
// Only the module's documentation links to it.
// oxlint-disable-next-line no-unused-vars
import type * as ClientFirestore from "./firestore/ClientFirestore.ts";
import * as internalApp from "./internal/app.ts";

/**
 * A Firebase client SDK app: the SDK's own `FirebaseApp`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface App extends Client.FirebaseApp {}

/**
 * Service key for the Firebase client SDK app.
 *
 * **When to use**
 *
 * Use to provide an app initialized elsewhere, such as one from `getApp()`,
 * with `Layer.succeed`. Nothing deletes an app provided this way.
 *
 * @example Providing an app initialized elsewhere
 * ```ts
 * import { Layer } from "effect";
 * import { getApp } from "firebase/app";
 * import { App } from "@visiolab/effect-firebase-client";
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
export const App = Context.Service<App>("@visiolab/effect-firebase-client/App");

/**
 * Fails {@link make} and {@link layer} when the client SDK refuses to
 * initialize the app, with what it threw as the `cause`.
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
 * Initializes a Firebase client SDK app, and deletes it again when the
 * surrounding scope closes.
 *
 * **When to use**
 *
 * Use to build the app inside an effect of your own. Most programs provide it
 * with {@link layer} instead.
 *
 * **Details**
 *
 * Takes the arguments of `initializeApp(options, name)`. Unlike the Admin SDK's,
 * the options are required: they are the config the Firebase console gives a
 * web app, which the client SDK only finds on its own when served from
 * Firebase Hosting.
 *
 * An app already registered under the same name is not deleted when the scope
 * closes. The client SDK only hands back that app when it was initialized with
 * the same options, and throws otherwise.
 *
 * Fails with an {@link AppError} when the client SDK refuses to initialize the
 * app. A failure to delete the app is logged as a warning, not raised.
 *
 * @see {@link layer} for the same as a layer
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = Effect.fn("App.make")(function* (
  options: Client.FirebaseOptions,
  name?: string,
) {
  const { app } = yield* Effect.acquireRelease(
    Effect.try({
      try: () => internalApp.initialize(options, name),
      catch: (cause) =>
        new AppError({ message: "Failed to initialize the Firebase client SDK app", cause }),
    }),
    internalApp.release,
  );
  return app;
});

/**
 * A layer that initializes a Firebase client SDK app for the lifetime of the
 * layer.
 *
 * **When to use**
 *
 * Use when this program owns the app. Where something else already initialized
 * it, provide that app as {@link App} instead.
 *
 * **Details**
 *
 * Takes the arguments of `initializeApp(options, name)`.
 *
 * @example Initializing the app from the console's config
 * ```ts
 * import { App } from "@visiolab/effect-firebase-client";
 *
 * const AppLive = App.layer({
 *   apiKey: "<api key>",
 *   authDomain: "my-project.firebaseapp.com",
 *   projectId: "my-project",
 *   appId: "<app id>",
 * });
 * ```
 *
 * @see {@link make} for how the app is initialized and torn down
 * @see {@link App} for providing an app initialized elsewhere
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = (options: Client.FirebaseOptions, name?: string): Layer.Layer<App, AppError> =>
  Layer.effect(App, make(options, name));

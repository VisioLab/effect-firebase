/**
 * The Firebase client SDK app.
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import type * as Client from "firebase/app";
import * as internalApp from "./internal/app.ts";

/**
 * A Firebase client SDK app.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface App extends Client.FirebaseApp {}

/**
 * Service key for the Firebase client SDK app.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export const App = Context.Service<App>("@visiolab/effect-firebase-client/App");

/**
 * Raised when an app cannot be initialized.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class AppError extends Schema.TaggedError<AppError>()("AppError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Initializes a Firebase client SDK app, deleting it again when the surrounding
 * scope closes.
 *
 * Unlike the Admin SDK's, the options are not optional: the client SDK only
 * finds them on its own when served from Firebase Hosting, so they are the
 * config the Firebase console hands out for a web app.
 *
 * An app that is already registered under the same name is left alone when the
 * scope closes rather than deleted. The client SDK only hands back that
 * existing app when it was initialized with the same options, and refuses
 * otherwise.
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
 * Mirrors `initializeApp(options, name)`.
 *
 * @see {@link make} for how the app is initialized and torn down.
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = (options: Client.FirebaseOptions, name?: string): Layer.Layer<App, AppError> =>
  Layer.effect(App, make(options, name));

/**
 * The Firebase Admin SDK app.
 *
 * @since 0.1.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import type * as Admin from "firebase-admin/app";
import * as internalApp from "./internal/app.ts";

/**
 * A Firebase Admin SDK app.
 *
 * @category models
 * @since 0.1.0
 */
export interface App extends Admin.App {}

/**
 * Service key for the Firebase Admin SDK app.
 *
 * @category services
 * @since 0.1.0
 */
export const App = Context.Service<App>("@visiolab/effect-firebase-admin/App");

/**
 * Raised when an app cannot be initialized.
 *
 * @category errors
 * @since 0.1.0
 */
export class AppError extends Schema.TaggedError<AppError>()("AppError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Initializes a Firebase Admin SDK app, deleting it again when the surrounding
 * scope closes.
 *
 * Passing no options initializes the app the way the Admin SDK does by
 * default: from the `FIREBASE_CONFIG` environment variable and application
 * default credentials.
 *
 * An app that is already registered under the same name is left alone when the
 * scope closes rather than deleted. The Admin SDK only hands back that existing
 * app when the request matches how it was created, though: it rejects auto-init
 * against explicit options, and rejects reuse outright when either side carries
 * a credential or an `httpAgent`. Reach for `Admin.getApp` to pick up an app the
 * host initialized.
 *
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
 * Mirrors `initializeApp(options, name)`: omitting the options initializes the
 * app the way the Admin SDK does by default, from the `FIREBASE_CONFIG`
 * environment variable and application default credentials.
 *
 * @see {@link make} for how the app is initialized and torn down.
 *
 * @category layers
 * @since 0.1.0
 */
export const layer = (options?: Admin.AppOptions, name?: string): Layer.Layer<App, AppError> =>
  Layer.effect(App, make(options, name));

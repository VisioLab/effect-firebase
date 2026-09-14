/**
 * The Firebase Admin SDK app.
 *
 * @since 0.0.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import { defaultAppName } from "effect-firebase/App";
import * as Admin from "firebase-admin/app";

/**
 * A Firebase Admin SDK app.
 *
 * @category models
 * @since 0.0.0
 */
export interface App extends Admin.App {}

/**
 * Service key for the Firebase Admin SDK app.
 *
 * @category services
 * @since 0.0.0
 */
export const App = Context.Service<App>("@effect-firebase/admin/App");

/**
 * Raised when an app cannot be initialized.
 *
 * @category errors
 * @since 0.0.0
 */
export class AppError extends Schema.TaggedError<AppError>()("AppError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/**
 * Options for initializing a Firebase Admin SDK app.
 *
 * @category models
 * @since 0.0.0
 */
export interface Options extends Admin.AppOptions {
  /** The name to initialize the app under. Defaults to `"[DEFAULT]"`. */
  readonly name?: string | undefined;
}

/** The app together with whether we are the ones who initialized it. */
interface Initialized {
  readonly app: App;
  readonly owned: boolean;
}

const initialize = (options?: Options): Initialized => {
  const { name, ...appOptions } = options ?? {};
  // An app that is already registered under this name was initialized by
  // somebody else - typically the hosting runtime - so ending its lifecycle is
  // not ours to do. `initializeApp` still throws when that app was configured
  // differently, so conflicting configuration is not swallowed here.
  const owned = !Admin.getApps().some((app) => app.name === (name ?? defaultAppName));
  // Calling `initializeApp()` without options is not the same as calling it
  // with an empty one: only the former reads `FIREBASE_CONFIG` and falls back
  // to application default credentials.
  const app = options === undefined ? Admin.initializeApp() : Admin.initializeApp(appOptions, name);
  return { app, owned };
};

const release = ({ app, owned }: Initialized) =>
  owned
    ? Effect.tryPromise(() => Admin.deleteApp(app)).pipe(
        Effect.ignore({
          log: "Warn",
          message: `Failed to delete the Firebase Admin SDK app "${app.name}"`,
        }),
      )
    : Effect.void;

/**
 * Initializes a Firebase Admin SDK app, deleting it again when the surrounding
 * scope closes.
 *
 * Passing no options initializes the app the way the Admin SDK does by
 * default: from the `FIREBASE_CONFIG` environment variable and application
 * default credentials.
 *
 * An app that is already registered under the same name is adopted instead of
 * initialized, and is left alone when the scope closes.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fn("App.make")(function* (options?: Options) {
  const { app } = yield* Effect.acquireRelease(
    Effect.try({
      try: () => initialize(options),
      catch: (cause) =>
        new AppError({ message: "Failed to initialize the Firebase Admin SDK app", cause }),
    }),
    release,
  );
  return app;
});

/**
 * A layer that initializes the default Firebase Admin SDK app for the lifetime
 * of the layer, the way the Admin SDK does by default: from the
 * `FIREBASE_CONFIG` environment variable and application default credentials.
 *
 * @see {@link layerOptions} to configure the app explicitly.
 * @see {@link make} for how the app is initialized and torn down.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<App, AppError> = Layer.effect(App, make());

/**
 * A layer that initializes a Firebase Admin SDK app from explicit options for
 * the lifetime of the layer.
 *
 * @see {@link make} for how the app is initialized and torn down.
 *
 * @category layers
 * @since 0.0.0
 */
export const layerOptions = (options: Options): Layer.Layer<App, AppError> =>
  Layer.effect(App, make(options));

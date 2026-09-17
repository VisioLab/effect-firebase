/**
 * Firebase Authentication, as exposed by the Firebase Admin SDK.
 *
 * @since 0.0.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import { FirebaseError } from "firebase-admin/app";
import * as Admin from "firebase-admin/auth";
import * as App from "./App.ts";

/**
 * Raised when a Firebase Authentication call fails.
 *
 * @category errors
 * @since 0.0.0
 */
export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  message: Schema.String,
  /** The `service/string-code` the Admin SDK reported, such as `auth/user-not-found`. */
  code: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

const authError = (message: string) => (cause: unknown) =>
  new AuthError({
    message,
    code: cause instanceof FirebaseError ? cause.code : undefined,
    cause,
  });

/**
 * Firebase Authentication for a single app.
 *
 * This covers the handful of calls most server code reaches for. Anything else
 * the Admin SDK offers is available through {@link Auth.use}.
 *
 * @category models
 * @since 0.0.0
 */
export interface Auth {
  /**
   * Runs `f` against the underlying Admin SDK handle, turning a rejection into
   * an `AuthError`.
   *
   * This is the escape hatch for the parts of the SDK that are not wrapped
   * here yet.
   */
  readonly use: <A>(f: (auth: Admin.Auth) => PromiseLike<A> | A) => Effect.Effect<A, AuthError>;
  readonly verifyIdToken: (
    idToken: string,
    checkRevoked?: boolean,
  ) => Effect.Effect<Admin.DecodedIdToken, AuthError>;
  readonly createCustomToken: (
    uid: string,
    developerClaims?: object,
  ) => Effect.Effect<string, AuthError>;
  readonly getUser: (uid: string) => Effect.Effect<Admin.UserRecord, AuthError>;
  readonly getUserByEmail: (email: string) => Effect.Effect<Admin.UserRecord, AuthError>;
  readonly createUser: (
    properties: Admin.CreateRequest,
  ) => Effect.Effect<Admin.UserRecord, AuthError>;
  readonly updateUser: (
    uid: string,
    properties: Admin.UpdateRequest,
  ) => Effect.Effect<Admin.UserRecord, AuthError>;
  readonly deleteUser: (uid: string) => Effect.Effect<void, AuthError>;
}

/**
 * Service key for Firebase Authentication.
 *
 * @category services
 * @since 0.0.0
 */
export const Auth = Context.Service<Auth>("@visiolab/effect-firebase-admin/Auth");

/**
 * Builds {@link Auth} on top of the {@link App.App} in context.
 *
 * Constructing the service cannot fail: `getAuth` only throws when the app has
 * already been deleted or when it was handed something that is not an app at
 * all. Both mean the app was wired up wrong rather than that a call went wrong,
 * so they surface as defects and `AuthError` keeps its single meaning of "a
 * Firebase Authentication call failed".
 *
 * The Admin SDK has no way to abort a request in flight, so these effects run
 * their call to completion even when the fiber is interrupted.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.gen(function* () {
  const app = yield* App.App;

  // `getAuth` memoizes the service on the app itself, so there is nothing to
  // release here.
  const auth = Admin.getAuth(app);

  const call = <A>(
    span: string,
    message: string,
    f: (auth: Admin.Auth) => PromiseLike<A> | A,
  ): Effect.Effect<A, AuthError> =>
    Effect.tryPromise({
      // `Promise.resolve` covers the calls that hand back a plain value, and
      // keeps a synchronous throw on the `catch` path rather than the die one.
      try: () => Promise.resolve(f(auth)),
      catch: authError(message),
    }).pipe(Effect.withSpan(`Auth.${span}`));

  return Auth.of({
    use: (f) => call("use", "A Firebase Authentication call failed", f),
    verifyIdToken: (idToken, checkRevoked) =>
      call("verifyIdToken", "Failed to verify the ID token", (auth) =>
        auth.verifyIdToken(idToken, checkRevoked),
      ),
    createCustomToken: (uid, developerClaims) =>
      call("createCustomToken", `Failed to create a custom token for "${uid}"`, (auth) =>
        auth.createCustomToken(uid, developerClaims),
      ),
    getUser: (uid) =>
      call("getUser", `Failed to get the user "${uid}"`, (auth) => auth.getUser(uid)),
    getUserByEmail: (email) =>
      call("getUserByEmail", `Failed to get the user with the email "${email}"`, (auth) =>
        auth.getUserByEmail(email),
      ),
    createUser: (properties) =>
      call("createUser", "Failed to create the user", (auth) => auth.createUser(properties)),
    updateUser: (uid, properties) =>
      call("updateUser", `Failed to update the user "${uid}"`, (auth) =>
        auth.updateUser(uid, properties),
      ),
    deleteUser: (uid) =>
      call("deleteUser", `Failed to delete the user "${uid}"`, (auth) => auth.deleteUser(uid)),
  });
});

/**
 * A layer that provides {@link Auth} for the {@link App.App} in context.
 *
 * @see {@link make} for why building the service cannot fail.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<Auth, never, App.App> = Layer.effect(Auth, make);

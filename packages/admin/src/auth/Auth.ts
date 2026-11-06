/**
 * Firebase Authentication on the Admin SDK, as an Effect service.
 *
 * {@link Auth} wraps the calls server code uses most, such as verifying ID
 * tokens and managing users. Every call fails with an {@link AuthError}, and
 * {@link Auth.use} reaches the rest of the Admin SDK.
 *
 * @example Verifying an ID token
 * ```ts
 * import { Effect, Layer } from "effect";
 * import { App } from "@visiolab/effect-firebase-admin/app";
 * import { Auth } from "@visiolab/effect-firebase-admin/auth";
 *
 * const uidOf = (idToken: string) =>
 *   Effect.gen(function* () {
 *     const auth = yield* Auth.Auth;
 *     const token = yield* auth.verifyIdToken(idToken, true);
 *     return token.uid;
 *   });
 *
 * const AuthLive = Auth.layer.pipe(Layer.provide(App.layer()));
 *
 * uidOf("<id token>").pipe(Effect.provide(AuthLive));
 * ```
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context, Effect, Layer, Schema } from "effect";
import { FirebaseError } from "firebase-admin/app";
import * as Admin from "firebase-admin/auth";
import * as App from "../app/App.ts";

/**
 * Fails a call on {@link Auth} when the Admin SDK rejects it, with what it
 * threw as the `cause`.
 *
 * Match on `code` to tell failures apart, such as `auth/user-not-found` or
 * `auth/id-token-revoked`.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class AuthError extends Schema.TaggedError<AuthError, { readonly brand: unique symbol }>()(
  "AuthError",
  {
    message: Schema.String,
    /** The `service/string-code` the Admin SDK reported, such as `auth/user-not-found`. */
    code: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const authError = (message: string) => (cause: unknown) =>
  new AuthError({
    message,
    code: cause instanceof FirebaseError ? cause.code : undefined,
    cause,
  });

/**
 * Firebase Authentication for a single app.
 *
 * Each call is the Admin SDK's method of the same name, with the same
 * arguments, failing with an {@link AuthError} and traced as a span named
 * `Auth.<method>`. Use {@link Auth.use} for anything else the Admin SDK offers.
 *
 * The Admin SDK cannot abort a request in flight, so interrupting a call does
 * not stop it: the request still runs to completion.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Auth {
  /**
   * Runs `f` against the Admin SDK's own `Auth`, failing with an
   * {@link AuthError} when it throws or rejects.
   *
   * **When to use**
   *
   * Use for the Admin SDK calls this service does not wrap, such as
   * `setCustomUserClaims` or `listUsers`. Prefer the wrapped methods where one
   * exists: they name the failure in the error's message.
   *
   * @example Setting custom claims
   * ```ts
   * import { Effect } from "effect";
   * import { Auth } from "@visiolab/effect-firebase-admin/auth";
   *
   * const makeAdmin = (uid: string) =>
   *   Effect.gen(function* () {
   *     const auth = yield* Auth.Auth;
   *     yield* auth.use((sdk) => sdk.setCustomUserClaims(uid, { admin: true }));
   *   });
   * ```
   */
  readonly use: <A>(f: (auth: Admin.Auth) => PromiseLike<A> | A) => Effect.Effect<A, AuthError>;
  /**
   * Verifies a Firebase ID token and decodes it.
   *
   * With `checkRevoked`, it also fails for a token whose session was revoked or
   * whose user is disabled, at the cost of a request to the Auth backend.
   *
   * @see {@link Auth.createCustomToken} for minting a token a client signs in with
   */
  readonly verifyIdToken: (
    idToken: string,
    checkRevoked?: boolean,
  ) => Effect.Effect<Admin.DecodedIdToken, AuthError>;
  /**
   * Mints a custom token for `uid`, which a client signs in with through
   * `signInWithCustomToken`.
   *
   * `developerClaims` end up in the ID tokens of that session.
   *
   * @see {@link Auth.verifyIdToken} for checking the ID token a client sends back
   */
  readonly createCustomToken: (
    uid: string,
    developerClaims?: object,
  ) => Effect.Effect<string, AuthError>;
  /**
   * Reads the user with `uid`.
   *
   * Fails with `auth/user-not-found` when there is none.
   *
   * @see {@link Auth.getUserByEmail} for looking a user up by email
   */
  readonly getUser: (uid: string) => Effect.Effect<Admin.UserRecord, AuthError>;
  /**
   * Reads the user with `email`.
   *
   * Fails with `auth/user-not-found` when there is none.
   *
   * @see {@link Auth.getUser} for looking a user up by uid
   */
  readonly getUserByEmail: (email: string) => Effect.Effect<Admin.UserRecord, AuthError>;
  /**
   * Creates a user, under the `uid` in `properties` or one the Auth backend
   * picks.
   *
   * @see {@link Auth.updateUser} for changing a user that exists
   */
  readonly createUser: (
    properties: Admin.CreateRequest,
  ) => Effect.Effect<Admin.UserRecord, AuthError>;
  /**
   * Changes the properties of the user with `uid`.
   *
   * @see {@link Auth.createUser} for creating one
   */
  readonly updateUser: (
    uid: string,
    properties: Admin.UpdateRequest,
  ) => Effect.Effect<Admin.UserRecord, AuthError>;
  /**
   * Deletes the user with `uid`.
   */
  readonly deleteUser: (uid: string) => Effect.Effect<void, AuthError>;
}

/**
 * Service key for Firebase Authentication.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export const Auth = Context.Service<Auth>("@visiolab/effect-firebase-admin/auth/Auth");

/**
 * Builds {@link Auth} on the {@link App.App} in context.
 *
 * **When to use**
 *
 * Use to build the service inside an effect of your own. Most programs provide
 * it with {@link layer} instead.
 *
 * **Details**
 *
 * Building the service cannot fail. `getAuth` only throws for an app that was
 * already deleted or is not an app at all. Both are wiring mistakes, so they
 * are defects, and {@link AuthError} only ever means that a call failed.
 *
 * @see {@link layer} for the same as a layer
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
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
 * @example Providing Auth
 * ```ts
 * import { Layer } from "effect";
 * import { App } from "@visiolab/effect-firebase-admin/app";
 * import { Auth } from "@visiolab/effect-firebase-admin/auth";
 *
 * const AuthLive = Auth.layer.pipe(Layer.provide(App.layer()));
 * ```
 *
 * @see {@link make} for why building the service cannot fail
 * @see {@link App.layer} for the app it needs
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer: Layer.Layer<Auth, never, App.App> = Layer.effect(Auth, make);

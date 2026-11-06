import { Effect } from "effect";
import { defaultAppName } from "@visiolab/effect-firebase/app/App";
import * as Client from "firebase/app";
import type * as App from "../App.ts";

/**
 * The app together with whether we are the ones who initialized it.
 *
 * @internal
 */
export interface Initialized {
  readonly app: App.App;
  readonly owned: boolean;
}

/** @internal */
export const initialize = (options: Client.FirebaseOptions, name?: string): Initialized => {
  // An app that is already registered under this name was initialized by
  // somebody else, so ending its lifecycle is not ours to do. `initializeApp`
  // still throws when that app was configured differently, so conflicting
  // configuration is not swallowed here.
  const owned = !Client.getApps().some((app) => app.name === (name ?? defaultAppName));
  return { app: Client.initializeApp(options, name), owned };
};

/** @internal */
export const release = ({ app, owned }: Initialized): Effect.Effect<void> =>
  owned
    ? Effect.tryPromise(() => Client.deleteApp(app)).pipe(
        Effect.ignore({
          log: "Warn",
          message: `Failed to delete the Firebase client SDK app "${app.name}"`,
        }),
      )
    : Effect.void;

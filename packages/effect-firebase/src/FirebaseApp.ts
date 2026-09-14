/**
 * @since 0.0.0
 */
import { Context } from "effect";

/**
 * Identity of the Firebase app the surrounding code is running against.
 *
 * @category models
 * @since 0.0.0
 */
export interface FirebaseApp {
  /** `"[DEFAULT]"` unless the app was initialized under a name. */
  readonly name: string;
  /** The project the app talks to. */
  readonly projectId: string;
}

/**
 * Service key for the Firebase app the surrounding code is running against.
 *
 * @category services
 * @since 0.0.0
 */
export const FirebaseApp = Context.Service<FirebaseApp>("~effect-firebase/FirebaseApp");

/**
 * The name Firebase gives an app that was initialized without an explicit one.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultAppName = "[DEFAULT]";

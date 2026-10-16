/**
 * @stability unstable
 * @since 0.1.0
 */
import { Context } from "effect";

/**
 * Identity of the Firebase app the surrounding code is running against.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface App {
  /** `"[DEFAULT]"` unless the app was initialized under a name. */
  readonly name: string;
}

/**
 * Service key for the Firebase app the surrounding code is running against.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export const App = Context.Service<App>("@visiolab/effect-firebase/App");

/**
 * The name Firebase gives an app that was initialized without an explicit one.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const defaultAppName = "[DEFAULT]";

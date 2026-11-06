/**
 * What the SDK packages' `App` modules share.
 *
 * The app service itself belongs to each SDK package: see the `App` modules
 * of [`@visiolab/effect-firebase-admin`](/api/admin/app/App/) and
 * [`@visiolab/effect-firebase-client`](/api/client/app/App/).
 *
 * @stability unstable
 * @since 0.1.0
 */

/**
 * The name Firebase gives an app that was initialized without one.
 *
 * **When to use**
 *
 * Use to compare against an app's `name`, or to name the default app
 * explicitly.
 *
 * @stability unstable
 * @category constants
 * @since 0.1.0
 */
export const defaultAppName = "[DEFAULT]";

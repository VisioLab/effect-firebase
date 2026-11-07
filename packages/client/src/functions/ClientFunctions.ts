/**
 * Cloud Functions for Firebase on the client SDK: the `Functions` instance
 * that a Callable Client calls through, for one region.
 *
 * A call that fails with `not-found` usually went to the wrong region, or to a
 * name the server doesn't export: build the client of a Function Group's
 * member from its group, so it calls `<group>-<name>`.
 *
 * @example Pointing the client at a region
 * ```ts
 * import { Layer } from "effect";
 * import { App } from "@visiolab/effect-firebase-client/app";
 * import { ClientFunctions } from "@visiolab/effect-firebase-client/functions";
 *
 * const FunctionsLive = ClientFunctions.layer({ regionOrCustomDomain: "europe-west1" }).pipe(
 *   Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
 * );
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import { Context, Effect, Layer } from "effect";
import * as Client from "firebase/functions";
import * as App from "../app/App.ts";
// Only the documentation links to it.
// oxlint-disable-next-line no-unused-vars
import type * as CallableClient from "./CallableClient.ts";

/**
 * The client SDK's `Functions` instance for one region.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface ClientFunctions {
  /** The SDK's own `Functions` instance, for what this package doesn't wrap. */
  readonly instance: Client.Functions;
}

/**
 * Service key for {@link ClientFunctions}.
 *
 * **When to use**
 *
 * Use to give every Callable Client one region and emulator setting. Provide
 * it with {@link layer}. A {@link CallableClient.make} client reads it once,
 * when it is built.
 *
 * @see {@link layer} for providing it
 * @see {@link CallableClient.make} for the clients that call through it
 *
 * @stability unstable
 * @category services
 * @since 0.3.0
 */
export const ClientFunctions = Context.Service<ClientFunctions>(
  "@visiolab/effect-firebase-client/functions/ClientFunctions",
);

/**
 * Where the Functions emulator runs.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Emulator {
  readonly host: string;
  readonly port: number;
}

/**
 * Options for {@link make} and {@link layer}.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Options {
  /**
   * The region the functions are deployed to, such as `europe-west1`, or a
   * custom domain that serves them. Defaults to the SDK's, `us-central1`. A
   * function called in a region it isn't deployed to fails with `not-found`.
   */
  readonly regionOrCustomDomain?: string | undefined;
  /** Calls the Functions emulator at this address instead of the deployed functions. */
  readonly emulator?: Emulator | undefined;
}

/**
 * Gets the client SDK's `Functions` instance of the {@link App.App} in
 * context, for one region.
 *
 * **When to use**
 *
 * Use to build the service inside an effect of your own. Most programs provide
 * it with {@link layer} instead.
 *
 * **Details**
 *
 * Wraps `getFunctions(app, regionOrCustomDomain)`, and connects the emulator
 * when `emulator` is given. For a second region, build a second service.
 *
 * @see {@link layer} for the same as a layer
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make: (options?: Options) => Effect.Effect<ClientFunctions, never, App.App> =
  Effect.fn("ClientFunctions.make")(function* (options?: Options) {
    const app = yield* App.App;
    const instance = Client.getFunctions(app, options?.regionOrCustomDomain);
    if (options?.emulator !== undefined) {
      Client.connectFunctionsEmulator(instance, options.emulator.host, options.emulator.port);
    }
    return { instance };
  });

/**
 * A layer that provides {@link ClientFunctions} for the {@link App.App} in
 * context.
 *
 * **When to use**
 *
 * Use to set the region and the emulator once, for every Callable Client built
 * on it.
 *
 * @example Calling the Functions emulator
 * ```ts
 * import { Layer } from "effect";
 * import { App } from "@visiolab/effect-firebase-client/app";
 * import { ClientFunctions } from "@visiolab/effect-firebase-client/functions";
 *
 * const FunctionsLive = ClientFunctions.layer({
 *   emulator: { host: "127.0.0.1", port: 5001 },
 * }).pipe(Layer.provide(App.layer({ projectId: "demo-project" })));
 * ```
 *
 * @see {@link make} for what it wraps
 *
 * @stability unstable
 * @category layers
 * @since 0.3.0
 */
export const layer = (options?: Options): Layer.Layer<ClientFunctions, never, App.App> =>
  Layer.effect(ClientFunctions, make(options));

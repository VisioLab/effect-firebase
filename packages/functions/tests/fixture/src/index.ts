/**
 * The functions module the Functions emulator serves to the tests.
 *
 * The root `firebase.json` points its `functions` source at this fixture, and
 * `vp run emulator` bundles it into `dist` before it starts the emulator.
 */
import { Effect } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableFunction from "../../../src/https/CallableFunction.ts";
import { onCall } from "firebase-functions/v2/https";
import { Greet, LayerBuilds } from "./contract.ts";

/** Answers with the message it was sent. */
export const echo = onCall<{ readonly message: string }>((request) => ({
  echoed: request.data.message,
}));

export const { greet } = CallableFunction.make(
  Greet,
  Callable.toLayer(Greet, ({ name, at }) =>
    Effect.succeed({
      message: `Hello, ${name}!`,
      nextDay: new Date(at.getTime() + 24 * 60 * 60 * 1000),
    }),
  ),
);

/** How often the Layer of `layerBuilds` was built in this process. */
let builds = 0;

export const { layerBuilds } = CallableFunction.make(
  LayerBuilds,
  Callable.toLayer(
    LayerBuilds,
    Effect.sync(() => {
      builds += 1;
      return () => Effect.sync(() => ({ builds }));
    }),
  ),
);

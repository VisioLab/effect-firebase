/**
 * The functions module the Functions emulator serves to the tests.
 *
 * The root `firebase.json` points its `functions` source at this fixture, and
 * `vp run emulator` bundles it into `dist` before it starts the emulator.
 */
import { Effect, Layer } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableFunction from "../../../src/https/CallableFunction.ts";
import { onCall } from "firebase-functions/v2/https";
import { Admins, Greet, LayerBuilds, Users, Workers } from "./contract.ts";

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

export const { users } = CallableFunction.group(
  Users,
  Layer.mergeAll(
    Callable.toLayer(Users, "create", ({ name, birthday }) =>
      Effect.succeed({ id: name.toLowerCase(), name, birthday }),
    ),
    Callable.toLayer(Users, "get", ({ id }) => Effect.succeed({ id, servedBy: "users" })),
    Callable.toLayer(Users, "delete", () => Effect.void),
  ),
  { delete: { region: "europe-west1" } },
);

export const { admins } = CallableFunction.group(
  Admins,
  Callable.toLayer(Admins, "get", ({ id }) => Effect.succeed({ id, servedBy: "admins" })),
);

/** How often the Layer of `workers` was built in this process. */
let workerBuilds = 0;

/** One Layer for both members, which records the function it was built for. */
const WorkersLive = Layer.unwrap(
  Effect.sync(() => {
    workerBuilds += 1;
    const builtBy = { target: process.env["FUNCTION_TARGET"] ?? "", builds: workerBuilds };
    return Layer.mergeAll(
      Callable.toLayer(Workers, "first", () => Effect.succeed(builtBy)),
      Callable.toLayer(Workers, "second", () => Effect.succeed(builtBy)),
    );
  }),
);

export const { workers } = CallableFunction.group(Workers, WorkersLive);

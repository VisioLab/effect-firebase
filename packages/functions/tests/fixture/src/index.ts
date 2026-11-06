/**
 * The functions module the Functions emulator serves to the tests.
 *
 * The root `firebase.json` points its `functions` source at this fixture, and
 * `vp run emulator` bundles it into `dist` before it starts the emulator.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Context, Data, Effect, Layer, Logger } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as CallableFunction from "../../../src/https/CallableFunction.ts";
import { onCall } from "firebase-functions/v2/https";
import { Banned, Fail, Flaky, Greet, LayerBuilds, NameTaken, Unexplained } from "./contract.ts";

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

/**
 * Where the fixture's own logger writes, one JSON line per entry, so the tests
 * can read what the server logged. It lies outside the functions source, next
 * to the tests.
 */
const serverLog = fileURLToPath(new URL("../../server.log", import.meta.url));

const ServerLogLive = Logger.layer([
  Logger.make(({ logLevel, message }) => {
    appendFileSync(
      serverLog,
      `${JSON.stringify({ level: logLevel, message: (Array.isArray(message) ? message : [message]).map(String) })}\n`,
    );
  }),
]);

export const { fail } = CallableFunction.make(
  Fail,
  Callable.toLayer(Fail, ({ with: failure }) => {
    switch (failure) {
      case "NameTaken":
        return Effect.fail(
          new NameTaken({ username: "Ada", since: new Date("2026-01-01T12:00:00.000Z") }),
        );
      case "Banned":
        return Effect.fail(new Banned({ message: "Ada is banned" }));
      case "Unexplained":
        return Effect.fail(new Unexplained());
      case "NotFound":
        return Effect.fail(new CallableError.NotFound({ message: "No such user" }));
      case "defect":
        return Effect.die(new Error("Boom: the handler broke"));
      case "interrupt":
        return Effect.interrupt;
    }
  }).pipe(Layer.merge(ServerLogLive)),
);

/** How often the connection of `flaky` was built in this process. */
let connectionBuilds = 0;

/**
 * A service the handler of `flaky` needs, whose first build fails, as a
 * database connection might while the database starts up.
 */
class Connection extends Context.Service<Connection, { readonly builds: number }>()(
  "fixture/Connection",
) {}

class ConnectionRefused extends Data.TaggedError("ConnectionRefused")<{
  readonly message: string;
}> {}

const ConnectionLive = Layer.effect(
  Connection,
  Effect.suspend(() => {
    connectionBuilds += 1;
    return connectionBuilds === 1
      ? Effect.fail(new ConnectionRefused({ message: "The first build of the connection fails" }))
      : Effect.succeed({ builds: connectionBuilds });
  }),
);

export const { flaky } = CallableFunction.make(
  Flaky,
  Callable.toLayer(
    Flaky,
    Effect.map(
      Effect.service(Connection),
      ({ builds }) =>
        () =>
          Effect.succeed({ builds }),
    ),
  ).pipe(Layer.provide(ConnectionLive)),
);

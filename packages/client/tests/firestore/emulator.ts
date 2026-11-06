import { Effect, Layer, Queue, Stream } from "effect";
import { disableNetwork, enableNetwork } from "firebase/firestore";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";

const host = process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080";

/** The emulator the tests talk to, in the shape the layer takes it. */
export const emulator = {
  host: host.slice(0, host.lastIndexOf(":")),
  port: Number(host.slice(host.lastIndexOf(":") + 1)),
} satisfies ClientFirestore.Emulator;

/**
 * Deletes every document in the default database of `projectId`, so a test
 * starts from an empty one.
 *
 * The emulator keeps each project's data apart, which is what lets the suites
 * run side by side as long as each keeps to a project of its own.
 */
export const clear = (projectId: string) =>
  Effect.promise(() =>
    fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
      method: "DELETE",
    }),
  ).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.void
        : Effect.die(new Error(`Failed to clear ${projectId}: ${response.status}`)),
    ),
  );

/**
 * The {@link ClientFirestore.ClientFirestore} in context, once every document
 * of `projectId` is deleted.
 */
export const fresh = (projectId: string) =>
  clear(projectId).pipe(Effect.andThen(ClientFirestore.ClientFirestore));

/**
 * A second client of `projectId`, under an app `name`d apart from the test's
 * own, with a cache of its own.
 */
export const otherClient = (projectId: string, name: string) =>
  ClientFirestore.layer({ emulator }).pipe(Layer.provide(App.layer({ projectId }, name)));

/**
 * Runs `stream` into a queue for the rest of the test.
 *
 * Each snapshot is taken before the next write, so none is dropped for
 * arriving while another was still waiting to be read.
 */
export const listening = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.toQueue(stream, { capacity: "unbounded" });

/**
 * Keeps a listener on what `stream` follows for the rest of the test, once it
 * has heard from the server, so the SDK's cache keeps hold of it: without one,
 * what a read has seen is dropped from the memory cache again.
 */
export const holding = <A, E>(stream: Stream.Stream<A, E>) =>
  listening(stream).pipe(Effect.flatMap(Queue.take));

/** Runs `effect` with the network off, toggled through `instance`. */
export const offline = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { instance } = yield* ClientFirestore.ClientFirestore;
    yield* Effect.promise(() => disableNetwork(instance));
    return yield* effect.pipe(Effect.ensuring(Effect.promise(() => enableNetwork(instance))));
  });

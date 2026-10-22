import { Effect } from "effect";
import type * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";

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

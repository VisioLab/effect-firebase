import { Effect } from "effect";

/**
 * Deletes every document in the default database of `projectId`, so a test
 * starts from an empty one.
 *
 * The emulator keeps each project's data apart, which is what lets the suites
 * run side by side as long as each keeps to a project of its own.
 */
export const clear = (projectId: string) =>
  Effect.promise(() =>
    fetch(
      `http://${process.env["FIRESTORE_EMULATOR_HOST"]}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
      { method: "DELETE" },
    ),
  ).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.void
        : Effect.die(new Error(`Failed to clear ${projectId}: ${response.status}`)),
    ),
  );

/**
 * Stops the run before it starts when the Firestore emulator is not there.
 *
 * The emulator is started and stopped outside the tests - `vp run emulator`
 * from the root, or `firebase emulators:exec` in CI - so all this does is ask
 * whether it answers. Without it, every test that reaches the database would
 * fail on its own, each after a timeout of its own.
 */
import type { TestProject } from "vite-plus/test/node";

export default async function (project: TestProject) {
  const host = project.config.env["FIRESTORE_EMULATOR_HOST"];
  try {
    await fetch(`http://${host}/`, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error(
      `The Firestore emulator is not running at ${host}. Start it with \`vp run emulator\` from the repository root.`,
    );
  }
}

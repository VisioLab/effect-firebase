/**
 * Stops the run before it starts when the Functions emulator is not there.
 *
 * The emulator is started and stopped outside the tests - `vp run emulator`
 * from the root, or `firebase emulators:exec` in CI - so all this does is ask
 * whether it answers. Without it, every test that calls a function would fail
 * on its own, each after a timeout of its own.
 */
import type { TestProject } from "vite-plus/test/node";

export default async function (project: TestProject) {
  const host = project.config.env["FUNCTIONS_EMULATOR_HOST"];
  try {
    await fetch(`http://${host}/`, { signal: AbortSignal.timeout(2000) });
  } catch {
    // Known issue: the reporter prints `TypeError: code.charCodeAt is not a
    // function` in place of this message. Vite's module runner fails to map
    // this file's stack trace through its source map.
    throw new Error(
      `The Functions emulator is not running at ${host}. Start it with \`vp run emulator\` from the repository root.`,
    );
  }
}

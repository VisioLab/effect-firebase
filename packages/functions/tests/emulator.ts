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
    const message = `The Functions emulator is not running at ${host}. Start it with \`vp run emulator\` from the repository root.`;
    // A stack of its own, so the reporter prints the message: mapping the
    // setup file's stack trace through Vite's module runner throws, and the
    // reporter then prints that error in place of this one.
    throw Object.assign(new Error(message), { stack: `Error: ${message}` });
  }
}

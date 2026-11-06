/**
 * Stops the run before it starts when an emulator the tests need is not there.
 *
 * The emulators are started and stopped outside the tests - `vp run emulator`
 * from the root, or `firebase emulators:exec` in CI - so all this does is ask
 * whether each answers. Without it, every test that reaches one would fail on
 * its own, each after a timeout of its own.
 */
import type { TestProject } from "vite-plus/test/node";

const answers = async (host: string | undefined) => {
  try {
    await fetch(`http://${host}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

export default async function (project: TestProject) {
  for (const [name, variable] of [
    ["Firestore", "FIRESTORE_EMULATOR_HOST"],
    ["Functions", "FUNCTIONS_EMULATOR_HOST"],
  ] as const) {
    const host = project.config.env[variable];
    if (await answers(host)) continue;
    const message = `The ${name} emulator is not running at ${host}. Start it with \`vp run emulator\` from the repository root.`;
    // A stack of its own, so the reporter prints the message: mapping the
    // setup file's stack trace through Vite's module runner throws, and the
    // reporter then prints that error in place of this one.
    throw Object.assign(new Error(message), { stack: `Error: ${message}` });
  }
}

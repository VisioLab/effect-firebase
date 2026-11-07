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
    ["Auth", "FIREBASE_AUTH_EMULATOR_HOST"],
  ] as const) {
    const host = project.config.env[variable];
    if (await answers(host)) continue;
    // Known issue: the reporter prints `TypeError: code.charCodeAt is not a
    // function` in place of this message. Vite's module runner fails to map
    // this file's stack trace through its source map.
    throw new Error(
      `The ${name} emulator is not running at ${host}. Start it with \`vp run emulator\` from the repository root.`,
    );
  }
}

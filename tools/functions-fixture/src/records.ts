/**
 * Where the fixture records what the tests read back: files of JSON lines at
 * the root of this package, which it appends to and never truncates.
 *
 * Each path resolves the same from the source the tests import and from the
 * bundle the emulator loads, as both sit one folder below the package root.
 * The Functions emulator does not reload on changes to `.log` files.
 */
import { fileURLToPath } from "node:url";

/** Where the fixture's test Tracer writes the spans it ends, one JSON line each. */
export const spansLog = fileURLToPath(new URL("../spans.log", import.meta.url));

/** Where the fixture's own logger writes what the server logs, one JSON line per entry. */
export const serverLog = fileURLToPath(new URL("../server.log", import.meta.url));

/**
 * Where the fixture copies every `console.log` and `console.error` line, as
 * JSON `{ method, line }`, one JSON line per write.
 */
export const consoleLog = fileURLToPath(new URL("../console.log", import.meta.url));

/** Where the fixture's triggers record each event they receive, one JSON line each. */
export const triggersLog = fileURLToPath(new URL("../triggers.log", import.meta.url));

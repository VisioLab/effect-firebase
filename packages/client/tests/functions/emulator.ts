import type * as ClientFunctions from "../../src/functions/ClientFunctions.ts";

const host = process.env["FUNCTIONS_EMULATOR_HOST"] ?? "127.0.0.1:5001";

/** The Functions emulator the tests talk to, in the shape the layer takes it. */
export const emulator = {
  host: host.slice(0, host.lastIndexOf(":")),
  port: Number(host.slice(host.lastIndexOf(":") + 1)),
} satisfies ClientFunctions.Emulator;

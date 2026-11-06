import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    env: {
      // Read by the tests to point the client SDK at the emulator, which it
      // takes per database rather than from the environment.
      FIRESTORE_EMULATOR_HOST: process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080",
      // The same for the Functions emulator, which serves the fixture of
      // `@visiolab/effect-firebase-functions` to the `CallableClient` tests.
      FUNCTIONS_EMULATOR_HOST: process.env["FUNCTIONS_EMULATOR_HOST"] ?? "127.0.0.1:5001",
    },
    globalSetup: ["./tests/emulator.ts"],
  },
  pack: {
    // One entry per module, so consumers can reach `App` as
    // `@visiolab/effect-firebase-client/app/App` without loading the whole barrel.
    // Internal modules stay out of the entries, and so out of `exports`: they
    // are the implementation behind the public modules, not API of their own.
    entry: ["src/**/*.ts", "!src/**/internal/**"],
    unbundle: true,
    sourcemap: true,
    dts: {
      generator: "tsgo",
    },
    // Resolve to source inside the workspace and to dist on publish, so
    // sibling packages typecheck without a build step first.
    exports: { devExports: true },
  },
});

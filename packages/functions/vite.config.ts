import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    env: {
      // Read by the tests to point the client SDK at the emulator, which it
      // takes per Functions instance rather than from the environment.
      FUNCTIONS_EMULATOR_HOST: process.env["FUNCTIONS_EMULATOR_HOST"] ?? "127.0.0.1:5001",
      // The project the Cloud Logging logger names in its trace field, as
      // Cloud Functions sets it.
      GCLOUD_PROJECT: "demo-effect-firebase",
    },
    globalSetup: ["./tests/emulator.ts"],
  },
  pack: {
    // One entry per module, so consumers can reach a module without loading
    // the whole barrel. Internal modules stay out of the entries, and so out
    // of `exports`: they are the implementation behind the public modules, not
    // API of their own.
    entry: ["src/**/*.ts", "!src/**/internal/**"],
    unbundle: true,
    // Keep `src/https/index.ts` at `dist/https/index.mjs` and so the `./https`
    // export, even while it is the only entry: left to itself, the root
    // narrows to the entries' common directory.
    root: "src",
    sourcemap: true,
    dts: {
      generator: "tsgo",
    },
    // Resolve to source inside the workspace and to dist on publish, so
    // sibling packages typecheck without a build step first.
    exports: { devExports: true },
  },
});

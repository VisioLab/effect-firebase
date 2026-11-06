import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    env: {
      // Set here rather than left to the shell, so the Admin SDK in a test can
      // only ever reach the emulator, never a real project.
      FIRESTORE_EMULATOR_HOST: process.env["FIRESTORE_EMULATOR_HOST"] ?? "127.0.0.1:8080",
    },
    globalSetup: ["./tests/emulator.ts"],
  },
  pack: {
    // One entry per module, so consumers can reach `App` as
    // `@visiolab/effect-firebase-admin/app/App` without loading the whole barrel.
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

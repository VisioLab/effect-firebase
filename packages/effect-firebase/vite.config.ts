import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // One entry per top-level module, so consumers can reach `App` as
    // `effect-firebase/App` without loading the whole barrel.
    entry: ["src/*.ts"],
    // Keep one output file per source module instead of one bundle, so
    // consumers only pull in what they import and stack traces stay readable.
    unbundle: true,
    dts: {
      tsgo: true,
    },
    // Resolve to source inside the workspace and to dist on publish, so
    // sibling packages typecheck without a build step first.
    exports: { devExports: true },
  },
});

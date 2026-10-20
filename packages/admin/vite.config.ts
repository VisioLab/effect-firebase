import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // One entry per module, so consumers can reach `App` as
    // `@visiolab/effect-firebase-admin/App` without loading the whole barrel.
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

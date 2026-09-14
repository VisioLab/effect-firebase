import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // One entry per top-level module, so consumers can reach `AdminApp` as
    // `@effect-firebase/admin/AdminApp` without loading the whole barrel.
    entry: ["src/*.ts"],
    unbundle: true,
    sourcemap: true,
    dts: {
      tsgo: true,
    },
    // Resolve to source inside the workspace and to dist on publish, so
    // sibling packages typecheck without a build step first.
    exports: { devExports: true },
  },
});

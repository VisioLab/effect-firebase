import { maintainers, recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    extends: [recommended, maintainers],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "effecttsgo/unstable-api-usage": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    // Run each package under its own config, so a root `vp test` picks up each
    // package's `test` settings, such as the emulator `env` and `globalSetup`.
    projects: ["packages/*"],
  },
  run: {
    cache: true,
  },
});

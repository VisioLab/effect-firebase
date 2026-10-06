import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    extends: [recommended],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // `VariantSchema` is unstable, and this is the only module that depends
        // on it: everything it builds is a plain `Schema`, so a breaking change
        // lands here and nowhere else.
        files: ["packages/effect-firebase/src/firestore/FirestoreModel.ts"],
        rules: { "effecttsgo/unstable-api-usage": "off" },
      },
    ],
  },
  run: {
    cache: true,
  },
});

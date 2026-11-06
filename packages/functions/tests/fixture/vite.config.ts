import { defineConfig } from "vite-plus";

// Bundles the fixture into the module the Functions emulator loads. Everything
// is bundled except the Firebase SDKs: firebase-tools must load the real
// `firebase-functions` to discover each export's `__endpoint`. Node resolves
// it from the functions package's own `node_modules`.
export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: "esm",
    outDir: "dist",
    dts: false,
    platform: "node",
    deps: {
      neverBundle: [
        "firebase-functions",
        /^firebase-functions\//,
        "firebase-admin",
        /^firebase-admin\//,
      ],
    },
  },
});

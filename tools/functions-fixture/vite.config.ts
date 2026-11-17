import { defineConfig } from "vite-plus";

// Bundles the fixture into the module the Functions emulator loads. Everything
// is bundled except the Firebase SDKs: firebase-tools must load the real
// `firebase-functions` to discover each export's `__endpoint`. Node resolves
// them from this package's own `node_modules`, so they are its only
// `dependencies`. What the bundle inlines, such as the workspace packages,
// whose exports resolve to TypeScript source, is in `devDependencies`.
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

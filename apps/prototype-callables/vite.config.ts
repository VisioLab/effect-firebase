import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/functions.ts"],
    format: "esm",
    outDir: "dist",
    dts: false,
    platform: "node",
    // firebase-tools must see the real firebase-functions to discover `__endpoint`.
    external: ["firebase-functions", /^firebase-functions\//, "firebase-admin", /^firebase-admin\//],
  },
});

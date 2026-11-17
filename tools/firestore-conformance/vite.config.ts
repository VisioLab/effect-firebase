import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Each backend's package runs the suite against its own layer. Until a
    // backend lives here, this package has no test file of its own.
    passWithNoTests: true,
  },
});

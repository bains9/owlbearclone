import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so unit tests don't start the Workers runtime.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so unit tests don't start the Workers runtime.
// A test's console output (timings, verdicts) shows only when it fails, so `npm test` and a
// deploy stay readable; VERBOSE=1 (or PERF=1, for the timings) shows it all.
const verbose = !!(process.env.VERBOSE || process.env.PERF);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    silent: verbose ? false : "passed-only",
  },
});

import { defineConfig } from "vitest/config";
import { localEnv } from "./scripts/local.mjs";

// Kept separate from vite.config.ts so unit tests don't start the Workers runtime.
// A test's console output (timings, verdicts) shows only when it fails, so `npm test` and a
// deploy stay readable; VERBOSE=1 (or PERF=1, for the timings) shows it all.
const verbose = !!(process.env.VERBOSE || process.env.PERF);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    silent: verbose ? false : "passed-only",
    // Some tests analyse whole maps: on a busy computer they pass 5 seconds, and failed deploys at random.
    testTimeout: 20_000,
    // The same for what runs before them: dungeonSeasons loads every Dungeon object first, which
    // passed vitest's 10 seconds and stopped a deploy on a busy computer (2026-11-22).
    hookTimeout: 20_000,
    // Where this computer keeps the maps that can't go in the code (DD_FIXTURES, DD_PRIVATE...):
    // the "env" of local.jsonc, for whatever isn't already set for this run. The tests that read
    // them are skipped on a computer without them (test/helpers/ddFixtures.ts).
    env: localEnv(),
  },
});

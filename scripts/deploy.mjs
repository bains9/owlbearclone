// npm run deploy: checks everything, builds the app and puts it live.
//
// It won't go without local.jsonc (scripts/local.mjs; local.example.jsonc shows what's in it).
// That file says where this table is served and holds its own settings, and it's laid over
// wrangler.jsonc when the app is built. A deploy without it would publish the app as
// wrangler.jsonc alone describes it, and so drop a table's own address and settings: refused,
// rather than found out afterwards.
//
// In order: the private-words check (scripts/private-words.mjs), the type check, the tests, the
// layout check in a real browser, the build, then `wrangler deploy`. Anything after `--` goes
// to wrangler: npm run deploy -- --dry-run

import { spawnSync } from "node:child_process";
import { ROOT, LOCAL_FILE, readLocal } from "./local.mjs";
import { report } from "./private-words.mjs";

function run(command, args) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  // npm and npx are scripts on Windows, so they go through the shell.
  const done = spawnSync([command, ...args].join(" "), { cwd: ROOT, stdio: "inherit", shell: true });
  if (done.status !== 0) {
    console.error(`\nStopped: "${command} ${args.join(" ")}" failed. Nothing was deployed.`);
    process.exit(done.status ?? 1);
  }
}

let local;
try {
  local = readLocal(ROOT);
} catch (err) {
  console.error(`${err.message}\nNothing was deployed.`);
  process.exit(1);
}
if (!local) {
  console.error(
    `There's no ${LOCAL_FILE} here, so nothing was deployed.\n` +
      `Copy local.example.jsonc to ${LOCAL_FILE} and say in it where your table is served (leave it as it comes for a workers.dev address).`,
  );
  process.exit(1);
}

const routes = Array.isArray(local.wrangler.routes) ? local.wrangler.routes.map((r) => (typeof r === "string" ? r : r?.pattern)).filter(Boolean) : [];
console.log(`Settings: ${local.path}`);
console.log(`Served at: ${routes.length ? routes.join(", ") : "the account's workers.dev address"}`);

if (report(ROOT) > 0) {
  console.error("\nStopped: private words in the files. Nothing was deployed.");
  process.exit(1);
}

run("npm", ["run", "typecheck"]);
run("npm", ["test"]);
run("npm", ["run", "smoke:layout"]);
run("npm", ["run", "build"]);
run("npx", ["wrangler", "deploy", ...process.argv.slice(2)]);

// Lets plain Node run the Dungeondraft scripts in scripts/dd against src/client/dd, whose imports
// are extensionless ("./model", as Vite and vitest resolve them):
//
//   node --import ./scripts/dd/register.mjs scripts/dd/measure-sprites.ts
//
// Two hooks, nothing else resolved or loaded differently:
// - resolve adds the missing ".ts" (or "/index.ts") to a relative import that names no file;
// - load compiles .ts files with Node's own stripTypeScriptTypes in "transform" mode, so the
//   TypeScript that type stripping alone refuses (parameter properties, enums) loads too.
// (Node 24 prints one ExperimentalWarning for stripTypeScriptTypes; it is harmless.)

import { readFile } from "node:fs/promises";
import { register, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

// (The loader thread loads this module too, to find the hooks; only the main thread registers it.)
if (isMainThread) register("./register.mjs", import.meta.url);

/** Adds ".ts" to an extensionless relative import (Node calls it on the loader thread). */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!relative || /\.[cm]?[jt]sx?$/.test(specifier) || err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    for (const tail of [".ts", ".tsx", "/index.ts"]) {
      try {
        return await next(specifier + tail, context);
      } catch {
        // try the next
      }
    }
    throw err;
  }
}

/** Compiles a .ts module (types removed, parameter properties and enums transformed). */
export async function load(url, context, next) {
  if (!url.startsWith("file:") || !/\.m?ts$/.test(new URL(url).pathname)) return next(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  return { format: "module", source: stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url }), shortCircuit: true };
}

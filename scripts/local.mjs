// This checkout's private settings: local.jsonc, a file that is never committed (it's in
// .gitignore; local.example.jsonc shows what goes in it). It holds what is one table's own and
// so stays out of the code:
//
//   "wrangler"       laid over wrangler.jsonc whenever the app is built: where this table is
//                    served, its own settings (DUNGEON_URL, LOADING_LINES), any extra bindings
//   "private_words"  words that must never appear in the files (scripts/private-words.mjs)
//   "env"            settings for this computer's tests and scripts (folders of private maps)
//
// Looked for in this checkout first and then, in a git worktree, in the main checkout, so one
// file serves every worktree. LOCAL_SETTINGS names another file altogether.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_FILE = "local.jsonc";

/** The checkout this script is in. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * JSON with comments and trailing commas, as wrangler.jsonc is written. Comments are only
 * dropped outside strings, so "https://example.com" keeps its slashes.
 */
export function parseJsonc(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // A comma with nothing after it but a closing bracket. Strings are skipped over again, so a
  // comma inside one is left alone.
  let clean = "";
  for (i = 0; i < out.length; ) {
    const c = out[i];
    if (c === '"') {
      const start = i++;
      while (i < out.length && out[i] !== '"') i += out[i] === "\\" ? 2 : 1;
      clean += out.slice(start, ++i);
    } else if (c === "," && /^\s*[}\]]/.test(out.slice(i + 1))) {
      i++;
    } else {
      clean += c;
      i++;
    }
  }
  return JSON.parse(clean);
}

/** The main checkout's folder when `root` is a git worktree of it; null otherwise, or without git. */
function mainCheckout(root) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const main = common ? dirname(common) : "";
    return main && resolve(main) !== resolve(root) ? main : null;
  } catch {
    return null;
  }
}

/** Where the private settings are, or null when this checkout has none. */
export function findLocal(root = ROOT, env = process.env) {
  if (env.LOCAL_SETTINGS) return existsSync(env.LOCAL_SETTINGS) ? resolve(env.LOCAL_SETTINGS) : null;
  const here = join(root, LOCAL_FILE);
  if (existsSync(here)) return here;
  const main = mainCheckout(root);
  const there = main ? join(main, LOCAL_FILE) : null;
  return there && existsSync(there) ? there : null;
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The private settings: { path, wrangler, privateWords, env }, each part empty when the file
 * doesn't have it. Null when there's no file. A file that can't be read as JSON, or has a part
 * of the wrong kind, is an error rather than no settings: a deploy must never carry on without
 * settings it was given.
 */
export function readLocal(root = ROOT, env = process.env) {
  const path = findLocal(root, env);
  if (!path) return null;
  let raw;
  try {
    raw = parseJsonc(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path} isn't valid JSON: ${err.message}`);
  }
  if (!isObject(raw)) throw new Error(`${path} must hold one object.`);
  const { wrangler = {}, private_words: privateWords = [], env: vars = {} } = raw;
  if (!isObject(wrangler)) throw new Error(`${path}: "wrangler" must be an object.`);
  if (!Array.isArray(privateWords) || privateWords.some((w) => typeof w !== "string")) {
    throw new Error(`${path}: "private_words" must be a list of words.`);
  }
  if (!isObject(vars) || Object.values(vars).some((v) => typeof v !== "string")) {
    throw new Error(`${path}: "env" must be an object of names and text values.`);
  }
  return { path, wrangler, privateWords, env: vars };
}

/**
 * The "env" part, for whatever of it isn't already set where this runs: something set by hand
 * (DD_FIXTURES=... npm test) wins over the file.
 */
export function localEnv(root = ROOT, env = process.env) {
  const local = readLocal(root, env);
  const out = {};
  for (const [name, value] of Object.entries(local?.env ?? {})) if (env[name] === undefined) out[name] = value;
  return out;
}

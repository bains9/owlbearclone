// Checks that none of this table's private words is in the files, or in their names. The
// words are the "private_words" of local.jsonc (scripts/local.mjs): real names, a table's own
// address, a campaign's characters and places... whatever must never go out with the code. The
// list itself is private, so it's never in the code either; a checkout without one has nothing
// to check.
//
//   node scripts/private-words.mjs                  the files git knows, and new ones it would add
//   node scripts/private-words.mjs --log main..HEAD  also the messages and authors of those commits
//
// It exits with 1 when it finds any, having said where. `npm test` runs the same check
// (test/privateWords.test.ts), and so does `npm run deploy`, before anything else.
//
// How a word matches. Text is read as a run of words: letters or digits, with a new word at
// each capital or digit inside a name, so someNameHere and SOME_NAME are "some", "name",
// "here". A private word matches a whole word, whatever its case: "Name" finds Name, NAME,
// DD_NAME and haveNameExport, but not "names" or "rename". One of several words ("Two Words",
// "table.example.com") matches those words in a row. "=Word" matches only as written.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, readLocal } from "./local.mjs";

/** A run of capitals that isn't the start of a word, a word, or a number. */
const WORD = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g;
/** Checksums (package-lock.json's): random letters, where any short word turns up sooner or later. */
const CHECKSUM = /sha(?:1|256|384|512)-[A-Za-z0-9+/=]{20,}/g;
/** Words in a row have at most this much between them: "Two  Words", "a.b.c", "C:/Users". */
const MAX_GAP = 3;

/** The words of a line of text, each with where it starts and ends. */
export function wordsOf(line) {
  const out = [];
  for (const m of line.matchAll(WORD)) out.push({ raw: m[0], low: m[0].toLowerCase(), at: m.index, end: m.index + m[0].length });
  return out;
}

/** A private word as it's looked for: its words, and whether their case counts. */
export function pattern(entry) {
  const exact = entry.startsWith("=");
  const text = exact ? entry.slice(1) : entry;
  const parts = wordsOf(text).map((w) => (exact ? w.raw : w.low));
  return { entry, exact, parts, letters: parts.join("").length };
}

/** The private words found in one line: [{ entry, at }], each entry once. */
export function findInLine(line, patterns) {
  const words = wordsOf(line.replace(CHECKSUM, (m) => " ".repeat(m.length)));
  const found = [];
  for (const p of patterns) {
    if (!p.parts.length) continue;
    for (let i = 0; i + p.parts.length <= words.length; i++) {
      let ok = true;
      for (let k = 0; k < p.parts.length && ok; k++) {
        const w = words[i + k];
        if ((p.exact ? w.raw : w.low) !== p.parts[k]) ok = false;
        else if (k > 0 && w.at - words[i + k - 1].end > MAX_GAP) ok = false;
      }
      if (ok) {
        found.push({ entry: p.entry, at: words[i].at });
        break;
      }
    }
  }
  return found;
}

/** The private words in a text: [{ entry, line }] with lines counted from 1. */
export function findInText(text, patterns) {
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    if (!lines[n]) continue;
    for (const f of findInLine(lines[n], patterns)) found.push({ entry: f.entry, line: n + 1 });
  }
  return found;
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** The files to check: those git has, and new ones it would take (not the ignored ones). */
export function filesToCheck(root = ROOT) {
  const list = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
  return [...new Set(list)].sort();
}

/**
 * Every private word found under `root`: [{ file, line, entry }], line 0 for a file's own name.
 * A file that isn't text (a picture) is only checked for the longer words: among random bytes,
 * a short one turns up by chance.
 */
export function findPrivateWords(root = ROOT, entries = [], files = filesToCheck(root)) {
  const patterns = entries.map(pattern).filter((p) => p.parts.length);
  const long = patterns.filter((p) => p.letters >= 6);
  const found = [];
  if (!patterns.length) return found;
  for (const file of files) {
    for (const f of findInLine(file, patterns)) found.push({ file, line: 0, entry: f.entry });
    let bytes;
    try {
      bytes = readFileSync(join(root, file));
    } catch {
      continue; // Deleted since git listed it.
    }
    const binary = bytes.subarray(0, 8000).includes(0);
    for (const f of findInText(bytes.toString(binary ? "latin1" : "utf8"), binary ? long : patterns)) found.push({ file, ...f });
  }
  return found;
}

/** Every private word in the messages and authors of the commits in `range`: [{ commit, entry }]. */
export function findInLog(root, entries, range) {
  const patterns = entries.map(pattern).filter((p) => p.parts.length);
  const found = [];
  if (!patterns.length) return found;
  const log = git(root, ["log", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e", range]);
  for (const record of log.split("\x1e")) {
    const [hash, ...rest] = record.trim().split("\x1f");
    if (!hash) continue;
    const seen = new Set();
    for (const f of findInText(rest.join("\n"), patterns)) {
      if (seen.has(f.entry)) continue;
      seen.add(f.entry);
      found.push({ commit: hash.slice(0, 7), entry: f.entry });
    }
  }
  return found;
}

/** The check, said in words. Returns how many were found. */
export function report(root = ROOT, args = [], say = console.log) {
  const local = readLocal(root);
  if (!local || !local.privateWords.length) {
    say("Private words: no list here (local.jsonc has no private_words), so nothing was checked.");
    return 0;
  }
  const files = filesToCheck(root);
  const found = findPrivateWords(root, local.privateWords, files);
  for (const f of found) say(`  ${f.file}${f.line ? `:${f.line}` : " (its name)"}: ${f.entry}`);
  const at = args.indexOf("--log");
  const range = at >= 0 ? args[at + 1] : null;
  const inLog = range ? findInLog(root, local.privateWords, range) : [];
  for (const f of inLog) say(`  commit ${f.commit}: ${f.entry}`);
  const total = found.length + inLog.length;
  const where = `${files.length} files${range ? ` and the commits of ${range}` : ""}`;
  if (total) say(`Private words: ${total} found in ${where}. Take them out before this goes anywhere.`);
  else say(`Private words: none of the ${local.privateWords.length} in ${where}.`);
  return total;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let total;
  try {
    total = report(ROOT, process.argv.slice(2));
  } catch (err) {
    console.error(`Private words: the check couldn't run. ${err.message}`);
    process.exit(2);
  }
  process.exit(total ? 1 : 0);
}

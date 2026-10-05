// Builds src/client/npcs/table.ts (the races and classes of the GM's NPCs list) and
// src/client/npcs/icons.ts (their head and emblem icons) from the table in
// scripts/npc-icons/list.tsv (kind, id, name, icon, colour, size, group: the races and classes
// from the group's own campaign handbook, each with its icon as author_icon) and the
// game-icons.net SVGs in scripts/npc-icons/svg. The table goes in the main download (the list's
// pickers need it at once), the icons only in the chunk loaded when the list opens. A race's head
// icon and a class's emblem can be shared (three elf races use one face), so the icons are keyed
// by icon, not by race or class. Each icon must be one path on a 512 x 512 view box. Also works
// out where each icon's drawing sits in that box (the middle of its bounding box, and how far
// from there its farthest painted pixel is), so the token art can centre it. To add a race or
// class: put its SVG in the folder (named author_icon.svg), add a line to list.tsv, and run
// `node scripts/npc-icons.mjs`. Uses sharp (installed with the Cloudflare tools, through miniflare).

import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const sharp = require("sharp");

const SOURCE = process.argv[2] ?? join(root, "scripts", "npc-icons");
const OUT = join(root, "src", "client", "npcs", "icons.ts");
const TABLE_OUT = join(root, "src", "client", "npcs", "table.ts");
const KINDS = ["race", "class"];
const SIZES = ["small", "medium"];
/** The groups the list shows races and classes under (RaceGroup and ClassGroup in npcs.ts). */
const GROUPS = { race: ["Elves", "Dwerves and gnomes", "Humans", "NPC races"], class: ["Classes", "NPC classes"] };

/** The painted part of an icon: its bounding box's middle, and the farthest painted pixel from there. */
async function fitOf(svg) {
  const { data, info } = await sharp(Buffer.from(svg)).resize(512, 512).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => data[(y * info.width + x) * info.channels + 3];
  let x0 = 512, y0 = 512, x1 = -1, y1 = -1;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      if (alpha(x, y) < 64) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  if (x1 < 0) throw new Error("nothing painted");
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let r = 0;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      if (alpha(x, y) >= 64) r = Math.max(r, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
    }
  }
  const round = (v) => Math.round(v * 10) / 10;
  return [round(cx), round(cy), round(r + 0.5)];
}

const [header, ...rows] = readFileSync(join(SOURCE, "list.tsv"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => l.split("\t"));
if (header.join("\t") !== "kind\tid\tname\ticon\tcolour\tsize\tgroup") throw new Error("list.tsv: unexpected columns");

const ids = new Set();
const wanted = new Map();
const races = [];
const classes = [];
for (const [kind, id, name, icon, colour, size, group] of rows) {
  if (!KINDS.includes(kind)) throw new Error(`${id}: unknown kind ${kind}`);
  if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error(`${id}: bad or repeated id`);
  if (!name) throw new Error(`${id}: no name`);
  if (!GROUPS[kind].includes(group)) throw new Error(`${id}: unknown ${kind} group "${group}"`);
  if (!/^#[0-9a-f]{6}$/.test(colour)) throw new Error(`${id}: bad colour ${colour}`);
  if (kind === "race" ? !SIZES.includes(size) : size) throw new Error(`${id}: bad size "${size}"`);
  if (!/^[a-z0-9-]+_[a-z0-9-]+$/.test(icon)) throw new Error(`${id}: bad icon ${icon}`);
  ids.add(id);
  wanted.set(icon, [...(wanted.get(icon) ?? []), id]);
  if (kind === "race") races.push({ id, name, group, size, icon, tint: colour });
  else classes.push({ id, name, group, icon, color: colour });
}
if (!races.length || !classes.length) throw new Error("list.tsv: no races, or no classes");
const files = readdirSync(join(SOURCE, "svg")).filter((f) => f.endsWith(".svg"));
for (const f of files) if (!wanted.has(f.slice(0, -4))) throw new Error(`${f}: not in list.tsv`);

const icons = [];
for (const [icon, users] of wanted) {
  if (!files.includes(`${icon}.svg`)) throw new Error(`${icon}: no SVG (used by ${users.join(", ")})`);
  const svg = readFileSync(join(SOURCE, "svg", `${icon}.svg`), "utf8");
  if (!svg.includes('viewBox="0 0 512 512"')) throw new Error(`${icon}: not a 512 x 512 icon`);
  if (/transform|<(g|circle|rect|ellipse|polygon|polyline|line|use)\b/.test(svg)) throw new Error(`${icon}: more than one plain path`);
  const paths = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length !== 1) throw new Error(`${icon}: ${paths.length} paths`);
  icons.push({ id: icon, source: icon.replace("_", "/"), fit: await fitOf(svg), path: paths[0] });
}

/** A race or class as a line of table.ts, its fields in the order given. */
const row = (o) => `  { ${Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} },`;
const table = [
  "// Generated by scripts/npc-icons.mjs from scripts/npc-icons/list.tsv: don't edit by hand.",
  "// The races and classes are the group's own, from its campaign handbook. See CREDITS.md.",
  "",
  'import type { NpcClass, NpcRace } from "./npcs";',
  "",
  "/** The races in the order the list shows them (within each group). */",
  "export const NPC_RACES: readonly NpcRace[] = [",
  ...races.map(row),
  "];",
  "",
  "/** The classes in the order the list shows them (within each group). */",
  "export const NPC_CLASSES: readonly NpcClass[] = [",
  ...classes.map(row),
  "];",
  "",
];
writeFileSync(TABLE_OUT, table.join("\n"));
console.log(`${races.length} races and ${classes.length} classes written to ${TABLE_OUT}`);

const lines = [
  "// Generated by scripts/npc-icons.mjs from scripts/npc-icons: don't edit by hand.",
  "// Icons from game-icons.net by Delapouite, Lorc, Cathelineau and Caro Asercion,",
  "// under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). See CREDITS.md.",
  "",
  'import type { NpcIcon } from "./npcs";',
  "",
  "export const NPC_ICONS: Readonly<Record<string, NpcIcon>> = {",
  ...icons.map(
    (i) => `  ${JSON.stringify(i.id)}: { source: ${JSON.stringify(i.source)}, fit: [${i.fit.join(", ")}], path: ${JSON.stringify(i.path)} },`,
  ),
  "};",
  "",
];
writeFileSync(OUT, lines.join("\n"));
console.log(`${icons.length} icons written to ${OUT}`);

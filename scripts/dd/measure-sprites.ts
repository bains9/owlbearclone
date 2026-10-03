// Measures every object of the sample pairs with measureObjects (design 2.5), draws an overlay of
// each measured instance for a human check, and extends SPRITE_SIZES: per default name not in the
// hand check, the median of its measured instances' reach, normalised to scale 1 and the sprite's
// own frame (spriteFrameReach).
//
//   node --import ./scripts/dd/register.mjs scripts/dd/measure-sprites.ts [--write] [--pps 32] [pair ...]
//
// Overlays go to renders/sizes/<pair>/<index>-<name>.png (outside the repo): the prior in magenta,
// the measured reach in cyan (yellow when capped, red when the picture doesn't show it), the
// centre as a dot; plus renders/sizes/<pair>.png with every footprint over the whole picture.
// --write rewrites the MEASURED block of src/client/dd/spriteSizes.ts; without it the table is
// only printed. Only instances measured at scale 0.3-4, seen in every direction (none running off
// the picture) and clamped in at most 3 of 16 directions (at 0.4 or 1.3 x the prior, or 0.8 or
// 2.6 x when measured on the second try at twice it) count, and a name needs at least 2 of them
// (or 1 with nothing clamped).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { GRID } from "../../src/client/dd/model";
import { defaultName, objectRole } from "../../src/client/dd/roles";
import { MEASURE, measureObjects, measureSummary, priorReach, spriteFrameReach, type Measured, type SpriteSizes } from "../../src/client/dd/measure";
import { REACH_DIRS } from "../../src/client/dd/raster";
import { HAND_NAMES, SPRITE_SIZES } from "../../src/client/dd/spriteSizes";
import { Canvas, PAIRS, RENDERS, encodePng, loadSample } from "./lib";

const args = process.argv.slice(2);
const write = args.includes("--write");
const ppsAt = args.indexOf("--pps");
const PPS = ppsAt >= 0 ? Number(args[ppsAt + 1]) : 32;
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--pps");

/**
 * The priors to measure with: the hand check only, never an earlier run's MEASURED table, so the
 * table can't feed on itself.
 */
const HAND_SIZES: SpriteSizes = Object.freeze(Object.fromEntries([...HAND_NAMES].map((n) => [n, SPRITE_SIZES[n]])));

/**
 * Whether a measured reach (as a share of the prior) is where the clamp holds it: 0.4 or 1.3 x the
 * prior, or 0.8 or 2.6 x for an object measured on the second try, at twice its prior
 * (measureObjects doesn't say which try it was, and a float reach is within 0.1% of its clamp).
 */
function isClamped(q: number): boolean {
  const lo = MEASURE.clampMin, hi = MEASURE.clampMax, k = MEASURE.retryPrior;
  return q <= lo * (1 + 1e-3) || q >= hi * k * (1 - 1e-3) || Math.abs(q - hi) <= 1e-3 * hi || Math.abs(q - lo * k) <= 1e-3 * lo * k;
}

const MAGENTA = [255, 0, 255], CYAN = [0, 255, 255], YELLOW = [255, 230, 0], RED = [255, 40, 40];

/** The 16-gon through reach[k] * REACH_DIRS[k] round (x, y), in picture pixels. */
function gon(x: number, y: number, reach: ArrayLike<number>, upp: number): number[] {
  const pts: number[] = [];
  for (let k = 0; k < 16; k++) pts.push(x + (REACH_DIRS[k * 2] * reach[k]) / upp, y + (REACH_DIRS[k * 2 + 1] * reach[k]) / upp);
  return pts;
}

const samples = new Map<string, Float64Array[]>();
const out = `${RENDERS}/sizes`;
for (const p of PAIRS) {
  if (only.length && !only.includes(p.name)) continue;
  const L = await loadSample(p, PPS);
  if (!L) {
    console.log(`${p.name}: not found, skipped`);
    continue;
  }
  const objs = L.level.objects;
  const roles = objs.map((o) => objectRole(defaultName(o.texture)));
  const notes: string[] = [];
  measureObjects(L.level, roles, L.pic, L.rect, null, HAND_SIZES); // warm up (colour table, JIT)
  const t0 = performance.now();
  const ms: Measured[] = measureObjects(L.level, roles, L.pic, L.rect, null, HAND_SIZES, notes);
  const dt = performance.now() - t0;
  const sum = measureSummary(ms, roles);
  const measured = ms.filter((m) => m.measured).length;
  console.log(`${p.name}: ${L.pic.w}x${L.pic.h} at ${L.pps.toFixed(1)} px/sq, ${objs.length} objects, ${measured} measured, ` +
    `${sum.tested} tested, ${sum.dropped} dropped (trees ${sum.treesDropped}/${sum.trees}${sum.lowerFit ? ", fit lowered" : ""}), ` +
    `${ms.filter((m) => m.capped).length} capped, ${dt.toFixed(0)} ms${notes.length ? "\n  " + notes.join("\n  ") : ""}`);

  const [x0, y0] = L.rect.rect;
  const upp = GRID / L.pps;
  const dir = `${out}/${p.name}`;
  mkdirSync(dir, { recursive: true });
  const whole = new Canvas(L.pic, 0, 0, L.pic.w, L.pic.h, 1);
  objs.forEach((o, i) => {
    const m = ms[i];
    const name = defaultName(o.texture);
    const cx = (o.position.x - x0) / upp, cy = (o.position.y - y0) / upp;
    const prior = priorReach(o, roles[i], HAND_SIZES);
    const colour = m.present === false ? RED : m.capped ? YELLOW : CYAN;
    whole.poly(gon(cx, cy, m.reach, upp), m.measured || m.present === false ? colour : MAGENTA, 0.9);
    if (!m.measured && m.present !== false) return;
    const R = Math.max(...prior, ...m.reach) / upp;
    const half = Math.ceil(Math.max(0.6 * L.pps, 1.6 * R));
    const bx = Math.floor(cx) - half, by = Math.floor(cy) - half;
    const c = new Canvas(L.pic, bx, by, 2 * half, 2 * half, 3);
    c.poly(gon(cx - bx, cy - by, prior, upp), MAGENTA, 0.7);
    c.poly(gon(cx - bx, cy - by, m.reach, upp), colour, 1);
    c.dot(cx - bx, cy - by, colour, 2);
    writeFileSync(`${dir}/${i}-${(name ?? "pack").split("/").pop()}.png`, c.png());
    // Normalised samples for the table.
    const s = Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y));
    if (!m.measured || !name || HAND_NAMES.has(name) || s < 0.3 || s > 4) return;
    let clamped = 0, unseen = 0;
    for (let k = 0; k < 16; k++) {
      const q = m.reach[k] / prior[k];
      if (m.reach[k] === prior[k]) unseen++;
      else if (isClamped(q)) clamped++;
    }
    if (clamped > 3 || unseen) return;
    const list = samples.get(name) ?? [];
    const sf = spriteFrameReach(o, m.reach);
    (sf as Float64Array & { clamped?: number }).clamped = clamped;
    list.push(sf);
    samples.set(name, list);
  });
  writeFileSync(`${out}/${p.name}.png`, encodePng(whole.w, whole.h, whole.data));
}

// The table: per name, the median of each direction.
const rows: string[] = [];
for (const [name, list] of [...samples].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const clean = list.filter((s) => !(s as Float64Array & { clamped?: number }).clamped);
  if (list.length < 2 && clean.length < 1) continue;
  const reach: number[] = [];
  for (let k = 0; k < 16; k++) {
    const v = list.map((s) => s[k]).sort((a, b) => a - b);
    const mid = v.length >> 1;
    reach.push(Math.round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2));
  }
  rows.push(`  ${JSON.stringify(name)}: { r: ${Math.max(...reach)}, reach: [${reach.join(", ")}] }, // ${list.length} instance${list.length > 1 ? "s" : ""}`);
}
console.log(`\n${rows.length} names measured (hand-checked names left alone):\n${rows.join("\n")}`);
if (write) {
  const file = fileURLToPath(new URL("../../src/client/dd/spriteSizes.ts", import.meta.url));
  const src = readFileSync(file, "utf8");
  const block = `// BEGIN MEASURED\nconst MEASURED: Record<string, Size> = {${rows.length ? "\n" + rows.join("\n") + "\n" : ""}};\n// END MEASURED`;
  const next = src.replace(/\/\/ BEGIN MEASURED[\s\S]*?\/\/ END MEASURED/, block);
  if (next === src && !src.includes(block)) throw new Error("spriteSizes.ts has no MEASURED markers");
  writeFileSync(file, next);
  console.log(`wrote ${rows.length} names to ${file}`);
}

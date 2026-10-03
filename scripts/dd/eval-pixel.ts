// The evaluation harness for the pixel-guessing path (design section 10; the plan in
// snow-melt\section10-plan.md, section 2): skeleton v0. It runs the picture's own snowy-map
// detection (analysePixelSnowy) over a corpus at the app's analysis size through several shrink
// kernels, checks the false-positive and true-positive gates, and scores the analysis against
// Dungeondraft ground truth where a map file is paired with the picture.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/eval-pixel.ts [options]
//
//   --set fp,tp,cov,amb,dd   only these sets (default: all)
//   --kernels linear,cubic   shrink kernels (default: linear, cubic, lanczos3, mitchell, box, nearest)
//   --quick                  linear only
//   --engine a.ts[,b.ts]     seasonPixels modules to run (default: src/client/room/seasonPixels.ts);
//                            with two, the report diffs their verdicts (A/B)
//   --time                   warm best-of-3 analysis time per entry
//   --run name               the report folder's name (default: a timestamp)
//   --strict                 the known misses below fail too: the gate for turning pixel snowy
//                            detection back on (section 10 item 6)
//
// Corpus: DD_CORPUS (default snow-melt\corpus\manifest.json), entries
//   { id, file, grid, set: "fp" | "tp" | "cov" | "amb" | "looks" | "dd", ddMap?, level? }
// with file and ddMap relative to the manifest's folder unless absolute. Without a manifest it
// falls back to the Dungeondraft pairs (scripts/dd/lib.ts PAIRS) and Vern's pictures.
//
// Output: RENDERS/eval/<run>/report.json and report.md. The exit code is 1 when a gate fails:
// - fp: no detection with any gating kernel (nearest is report-only);
// - tp: detected with every gating kernel;
// - dd: the green pairs (snowShare < 0.5) never detected, and the snowy ones (snowShare >= 0.5)
//   detected with every gating kernel, except KNOWN_MISSES (reported, and failed with --strict).
// The report counts the snowy pairs missed and says whether pixel snowy detection is ready to be
// turned back on: no false positive, every tp entry and every snowy pair detected.
//
// Ground truth (Phase A, ddRaster + roles.ts; Phase B moves to exactLayers(extractSidecar(...))
// once WP2-WP4 land): outdoor SNOW, WATER, EARTH (with SAND), indoor (floors, tiles, caves) and
// what must never melt (indoor, roofs, walls, structures). Scored by precision and recall where
// the verdict is snowy; objects by centre hits within 0.6 square and kind accuracy, plus false
// bare trees per 100 squares. Green pairs are scored on analyse()'s ground, water and canopy.
//
// Not yet (later harness versions, section10-plan.md 2 and 4): the rejecting gate and every gate
// number (needs a debug hook in seasonPixels.ts, WP4's), forced-mode scoring of maps the verdict
// rejects (same hook), variants (grids, tilings, colour shifts, JPEG, pads, crops), Chrome mode,
// Kdir's labels (scripts/dd/kdir-labels.json), paired seasons and contact sheets.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { parseDungeondraftMap } from "../../src/client/dd/parse";
import type { Level } from "../../src/client/dd/model";
import { GRID } from "../../src/client/dd/model";
import { fillEllipse, fillPolygons, rasterBitGrid, rasterTiles, rasterWater, sampleTerrainSlot, strokeRibbon, workBudget, type RasterSpec } from "../../src/client/dd/ddRaster";
import { objectFootprint, roofPolygon, wallRibbon } from "../../src/client/dd/geometry";
import { OR, TR, defaultName, objectRole, terrainRole, type ObjectRole, type TerrainRole } from "../../src/client/dd/roles";
import { ROLE_RADIUS } from "../../src/client/dd/measure";
import { SPRITE_SIZES } from "../../src/client/dd/spriteSizes";
import type * as SeasonPixels from "../../src/client/room/seasonPixels";
import { PAIRS, RENDERS, VERN, pickLevel, readPicture, samplePath, sharp } from "./lib";

// ------------------------------------------------------------------ options

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const GATING = ["linear", "cubic", "lanczos3", "mitchell", "box"];
const kernels = argv.includes("--quick") ? ["linear"] : (opt("kernels")?.split(",") ?? [...GATING, "nearest"]);
const sets = opt("set")?.split(",");
const engines = (opt("engine")?.split(",") ?? [new URL("../../src/client/room/seasonPixels.ts", import.meta.url).href])
  .map((e) => (e.startsWith("file:") ? e : pathToFileURL(resolve(e)).href));
const run = opt("run") ?? new Date().toISOString().replace(/[:.]/g, "-");
const timing = argv.includes("--time");
const strict = argv.includes("--strict");

/**
 * Snowy Dungeondraft pairs that v0's pixel path doesn't take for snowy (run wp8-fix-before,
 * 2026-09-30, linear kernel): pelcs (truth snowShare 0.997), tulgi (0.85) and cavern (1.0). A miss
 * of one of these is reported, not failed, so the harness gates regressions today; take a pair off
 * once the pixel path finds it (the report says when it does), and --strict fails them all.
 */
const KNOWN_MISSES: ReadonlySet<string> = new Set(["pelcs", "tulgi", "cavern"]);

// ------------------------------------------------------------------ corpus

interface Entry {
  id: string;
  file: string;
  /** The scene's grid, picture pixels a square. */
  grid: number;
  set: "fp" | "tp" | "cov" | "amb" | "looks" | "dd";
  ddMap?: string;
  level?: string;
}

const MANIFEST = process.env.DD_CORPUS ?? "C:/Users/G/tabletop-work/snow-melt/corpus/manifest.json";

function corpus(): Entry[] {
  if (existsSync(MANIFEST)) {
    const dir = dirname(MANIFEST);
    const abs = (p: string) => (isAbsolute(p) ? p : resolve(dir, p));
    return (JSON.parse(readFileSync(MANIFEST, "utf8")) as Entry[]).map((e) => ({ ...e, file: abs(e.file), ddMap: e.ddMap && abs(e.ddMap) }));
  }
  console.log(`(no corpus manifest at ${MANIFEST}: the Dungeondraft pairs and Vern's pictures only)`);
  const out: Entry[] = PAIRS.map((p) => ({ id: p.name, file: samplePath(p.picture), grid: 0, set: "dd" as const, ddMap: samplePath(p.map), level: p.level }));
  out.push({ id: "kdir", file: `${VERN}/kdir-vtt.png`, grid: 72, set: "tp" });
  out.push({ id: "swampbridge-winter", file: `${VERN}/swampbridge-winter.vtt.png`, grid: 72, set: "cov" });
  out.push({ id: "swampbridge-summer", file: `${VERN}/swampbridge-summer.vtt.png`, grid: 72, set: "fp" });
  return out.filter((e) => existsSync(e.file) && (!e.ddMap || existsSync(e.ddMap)));
}

// ------------------------------------------------------------------ the app's analysis input

/**
 * The analysis size the app uses: the scene's grid as board.ts clamps it (an eighth to a 160th of
 * the long side), then seasons.ts's 512-1024 px at about 20 px a square. (To be replaced by WP5's
 * analysisGeometry export when it lands.)
 */
function analysisGeometry(W: number, H: number, grid: number): { aw: number; ah: number; cellA: number } {
  const long = Math.max(W, H);
  const square = Math.min(long / 8, Math.max(long / 160, grid));
  const kA = Math.min(1, Math.min(1024 / long, Math.max(512 / long, 20 / square)));
  return { aw: Math.max(1, Math.round(W * kA)), ah: Math.max(1, Math.round(H * kA)), cellA: square * kA };
}

/** The picture shrunk to aw x ah with a sharp kernel, or "box" (an area average, as mipmaps do). */
async function shrink(src: string | Buffer, aw: number, ah: number, kernel: string): Promise<Uint8ClampedArray> {
  const s = sharp();
  if (kernel !== "box") {
    const buf: Buffer = await s(src).removeAlpha().ensureAlpha().resize(aw, ah, { fit: "fill", kernel, fastShrinkOnLoad: false }).raw().toBuffer();
    return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length);
  }
  const { data, info } = await s(src).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, out = new Uint8ClampedArray(aw * ah * 4);
  for (let y = 0; y < ah; y++) {
    const y0 = Math.floor((y * H) / ah), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / ah));
    for (let x = 0; x < aw; x++) {
      const x0 = Math.floor((x * W) / aw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / aw));
      const acc = [0, 0, 0, 0];
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) for (let c = 0; c < 4; c++) acc[c] += data[(yy * W + xx) * 4 + c];
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 4; c++) out[(y * aw + x) * 4 + c] = Math.round(acc[c] / n);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Dungeondraft ground truth (Phase A)

interface Truth {
  aw: number;
  ah: number;
  /** Visible outdoor terrain by role (1 where the role holds most of the weight). */
  snow: Uint8Array;
  earth: Uint8Array;
  soft: Uint8Array;
  water: Uint8Array;
  indoor: Uint8Array;
  /** Must never melt: indoor, roofs, walls and structures. */
  never: Uint8Array;
  /** Crowns of deciduous and evergreen trees (prior footprints). */
  canopy: Uint8Array;
  snowShare: number;
  /** Object centres (analysis pixels) and roles, of the roles the finders look for. */
  objects: Array<{ x: number; y: number; role: ObjectRole }>;
  squares: number;
}

/** Design 4.2's snowShare per pair, for the self-check. */
const EXPECTED_SNOW: Record<string, number> = { waterfall: 1, pelcs: 0.998, tulgi: 0.85, cavern: 1, forest: 0, mill: 0, river: 0, hobble: 0 };

function truth(level: Level, rect: [number, number, number, number], aw: number, ah: number): Truth {
  const [x0, y0, x1, y1] = rect;
  const spec: RasterSpec = { width: aw, height: ah, originX: x0, originY: y0, unitsPerPx: (x1 - x0) / aw };
  const budget = workBudget(spec);
  const N = aw * ah;
  const byRole = new Map<TerrainRole, Float32Array>();
  const t = level.terrain;
  if (t && t.enabled) {
    for (let s = 0; s < t.slotCount; s++) {
      const role = terrainRole(defaultName(t.slots[s] ?? null));
      const w = sampleTerrainSlot(t, s, spec);
      const acc = byRole.get(role) ?? new Float32Array(N);
      for (let k = 0; k < N; k++) acc[k] += w[k];
      byRole.set(role, acc);
    }
  }
  const water = rasterWater(level.water, spec);
  const indoor = new Uint8Array(N);
  if (level.floorPolygons.length) fillPolygons(indoor, spec, level.floorPolygons, 255, "nonzero");
  if (level.tiles) {
    const tiles = rasterTiles(level.tiles, spec);
    for (let k = 0; k < N; k++) indoor[k] |= tiles[k];
  }
  if (level.cave?.floor) {
    const cave = rasterBitGrid(level.cave.floor, spec);
    for (let k = 0; k < N; k++) indoor[k] |= cave[k];
  }
  const never = new Uint8Array(indoor);
  if (level.roofs.length) fillPolygons(never, spec, level.roofs.map(roofPolygon), 255, "nonzero");
  for (const w of level.walls) strokeRibbon(never, spec, wallRibbon(w), 255, budget);
  const canopy = new Uint8Array(N);
  const objects: Truth["objects"] = [];
  for (const o of level.objects) {
    const role = objectRole(defaultName(o.texture));
    const name = defaultName(o.texture);
    const r = (name && SPRITE_SIZES[name]?.r) || ROLE_RADIUS[role];
    if (role === OR.STRUCTURE) fillEllipse(never, spec, objectFootprint(o, r), 255, budget);
    if (role === OR.DECIDUOUS || role === OR.EVERGREEN) fillEllipse(canopy, spec, objectFootprint(o, r), 255, budget);
    objects.push({ x: (o.position.x - x0) / spec.unitsPerPx, y: (o.position.y - y0) / spec.unitsPerPx, role });
  }
  const snow = new Uint8Array(N), earth = new Uint8Array(N), soft = new Uint8Array(N);
  let sSnow = 0, sSoft = 0;
  const at = (role: TerrainRole, k: number) => byRole.get(role)?.[k] ?? 0;
  for (let k = 0; k < N; k++) {
    if (water[k] || never[k]) continue;
    const sn = at(TR.SNOW, k), ic = at(TR.ICE, k), gr = at(TR.GRASS, k), ea = at(TR.EARTH, k) + at(TR.SAND, k);
    sSnow += sn;
    sSoft += sn + ic + gr + ea;
    if (sn >= 128) snow[k] = 1;
    if (ea >= 128) earth[k] = 1;
    if (gr + ea >= 128) soft[k] = 1;
  }
  return { aw, ah, snow, earth, soft, water, indoor, never, canopy, snowShare: sSoft > 0 ? sSnow / sSoft : 0, objects, squares: ((x1 - x0) * (y1 - y0)) / (GRID * GRID) };
}

/** Precision and recall of a predicted mask against a true one. */
function pr(pred: (k: number) => boolean, want: Uint8Array): { p: number; r: number } {
  let tp = 0, fp = 0, fn = 0;
  for (let k = 0; k < want.length; k++) {
    const a = pred(k), b = want[k] !== 0;
    if (a && b) tp++; else if (a) fp++; else if (b) fn++;
  }
  return { p: tp + fp ? tp / (tp + fp) : 1, r: tp + fn ? tp / (tp + fn) : 1 };
}

// ------------------------------------------------------------------ one entry

type Engine = typeof SeasonPixels;

interface Result {
  id: string;
  set: Entry["set"];
  kernel: string;
  engine: number;
  aw: number;
  ah: number;
  cellA: number;
  snowy: boolean;
  ms?: number;
  kinds?: Record<string, number>;
  truth?: { snowShare: number; expected?: number };
  scores?: Record<string, number>;
}

const KIND_NAME: Record<number, string> = { 1: "capped", 2: "evergreen", 3: "bare", 4: "prop" };
/** Which Dungeondraft roles each pixel-path kind stands for, for kind accuracy. */
const KIND_ROLES: Record<number, ReadonlySet<ObjectRole>> = {
  1: new Set<ObjectRole>([OR.EVERGREEN, OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB]),
  2: new Set<ObjectRole>([OR.EVERGREEN, OR.SHRUB, OR.FLOWER_SHRUB]),
  3: new Set<ObjectRole>([OR.BARE]),
  4: new Set<ObjectRole>([OR.ROCK, OR.STRUCTURE, OR.DEADWOOD, OR.STUMP, OR.OPAQUE]),
};

async function evaluate(e: Entry, eng: Engine, ei: number): Promise<Result[]> {
  const { src, res } = readPicture(e.file);
  const meta = await sharp()(src).metadata();
  const W: number = meta.width, H: number = meta.height;
  let grid = e.grid;
  let rect: [number, number, number, number] | null = null;
  let level: Level | null = null;
  if (e.ddMap) {
    const map = parseDungeondraftMap(readFileSync(e.ddMap, "utf8"));
    level = pickLevel(map, e.level);
    const ox = res?.map_origin?.x ?? 0, oy = res?.map_origin?.y ?? 0;
    const sw = res?.map_size?.x ?? map.world.width, sh = res?.map_size?.y ?? map.world.height;
    rect = [ox * GRID, oy * GRID, (ox + sw) * GRID, (oy + sh) * GRID];
    if (!grid) grid = W / sw;
  }
  const { aw, ah, cellA } = analysisGeometry(W, H, grid || 70);
  const tr = level && rect ? truth(level, rect, aw, ah) : null;
  const out: Result[] = [];
  for (const kernel of kernels) {
    const rgba = await shrink(src, aw, ah, kernel);
    const a = eng.analysePixelSnowy(rgba, aw, ah, cellA);
    const r: Result = { id: e.id, set: e.set, kernel, engine: ei, aw, ah, cellA: +cellA.toFixed(2), snowy: a.snow !== null };
    if (timing) {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        eng.analysePixelSnowy(rgba, aw, ah, cellA);
        best = Math.min(best, performance.now() - t0);
      }
      r.ms = +best.toFixed(1);
    }
    const sn = a.snow;
    if (sn) {
      const kinds: Record<string, number> = {};
      for (let t = 0; t < sn.nTrees; t++) {
        const k = KIND_NAME[sn.trees[t * eng.TREE_N + 3]] ?? "other";
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
      r.kinds = kinds;
    }
    if (tr) {
      r.truth = { snowShare: +tr.snowShare.toFixed(3), expected: EXPECTED_SNOW[e.id] };
      const s: Record<string, number> = {};
      if (sn) {
        const NSN = eng.NSN, at = (k: number, ch: number) => sn.s[k * NSN + ch] >= 128;
        const g = pr((k) => at(k, eng.SN_GROUND), tr.snow);
        const w = pr((k) => at(k, eng.SN_WATER) || at(k, eng.SN_ICE), tr.water);
        const ea = pr((k) => at(k, eng.SN_EARTH), tr.earth);
        Object.assign(s, { groundP: g.p, groundR: g.r, waterP: w.p, waterR: w.r, earthP: ea.p, earthR: ea.r });
        let leak = 0, nev = 0;
        for (let k = 0; k < tr.never.length; k++) if (tr.never[k]) { nev++; if (at(k, eng.SN_GROUND)) leak++; }
        s.meltLeak = nev ? leak / nev : 0;
        // Objects: a find hits a Dungeondraft object within 0.6 square; its kind is right when the
        // object's role is one the kind stands for.
        const lim = 0.6 * cellA;
        let hits = 0, right = 0, falseBare = 0;
        for (let t = 0; t < sn.nTrees; t++) {
          const b = t * eng.TREE_N, x = sn.trees[b], y = sn.trees[b + 1], kind = sn.trees[b + 3];
          let best: ObjectRole | null = null, bd = lim;
          for (const o of tr.objects) {
            const d = Math.hypot(o.x - x, o.y - y);
            if (d <= bd) { bd = d; best = o.role; }
          }
          if (best !== null) { hits++; if (KIND_ROLES[kind]?.has(best)) right++; }
          if (kind === 3 && best !== OR.BARE) falseBare++;
        }
        Object.assign(s, { finds: sn.nTrees, hitRate: sn.nTrees ? hits / sn.nTrees : 1, kindRight: hits ? right / hits : 1, falseBarePer100: (100 * falseBare) / tr.squares });
      } else if (tr.snowShare < 0.5) {
        const F = eng.NF, at = (k: number, ch: number) => a.f[k * F + ch] >= 128;
        const g = pr((k) => at(k, eng.F_GROUND), tr.soft);
        const w = pr((k) => at(k, eng.F_WATER), tr.water);
        const c = pr((k) => at(k, eng.F_CANOPY), tr.canopy);
        Object.assign(s, { groundP: g.p, groundR: g.r, waterP: w.p, waterR: w.r, canopyP: c.p, canopyR: c.r, crowns: a.nCrowns });
      }
      for (const k of Object.keys(s)) s[k] = +s[k].toFixed(3);
      r.scores = s;
    }
    out.push(r);
  }
  return out;
}

// ------------------------------------------------------------------ main

const entries = corpus().filter((e) => !sets || sets.includes(e.set));
const mods: Engine[] = [];
for (const e of engines) mods.push((await import(e)) as Engine);
const results: Result[] = [];
for (const e of entries) {
  for (let ei = 0; ei < mods.length; ei++) {
    try {
      results.push(...(await evaluate(e, mods[ei], ei)));
    } catch (err) {
      console.log(`${e.id}: ${(err as Error).message}`);
    }
  }
}

// Gates.
const failures: string[] = [];
/** Snowy Dungeondraft pairs: id -> missed with some gating kernel. */
const snowyPairs = new Map<string, boolean>();
const knownMissed: string[] = [];
let ready = true;
for (const r of results) {
  if (r.engine !== 0 || !GATING.includes(r.kernel)) continue;
  if (r.set === "fp" && r.snowy) failures.push(`false positive: ${r.id} (${r.kernel})`);
  if (r.set === "tp" && !r.snowy) failures.push(`missed: ${r.id} (${r.kernel})`);
  if (r.set === "dd" && r.truth && r.truth.snowShare < 0.5 && r.snowy) failures.push(`green Dungeondraft map taken for snow: ${r.id} (${r.kernel})`);
  if (r.set === "dd" && r.truth && r.truth.snowShare >= 0.5) {
    snowyPairs.set(r.id, (snowyPairs.get(r.id) ?? false) || !r.snowy);
    if (!r.snowy) {
      ready = false;
      if (strict || !KNOWN_MISSES.has(r.id)) failures.push(`snowy Dungeondraft map missed: ${r.id} (${r.kernel}, truth snowShare ${r.truth.snowShare})`);
      else knownMissed.push(`${r.id} (${r.kernel})`);
    }
  }
  if (r.truth?.expected !== undefined && Math.abs(r.truth.snowShare - r.truth.expected) > 0.02) failures.push(`truth self-check: ${r.id} snowShare ${r.truth.snowShare}, design says ${r.truth.expected}`);
}
if (failures.length) ready = false;
const missedPairs = [...snowyPairs].filter(([, m]) => m).map(([id]) => id);
const nowFound = [...KNOWN_MISSES].filter((id) => snowyPairs.get(id) === false);
const diffs = mods.length > 1
  ? results.filter((r) => r.engine === 0).filter((r) => {
    const b = results.find((q) => q.engine === 1 && q.id === r.id && q.kernel === r.kernel);
    return b && b.snowy !== r.snowy;
  }).map((r) => `${r.id} (${r.kernel}): A ${r.snowy ? "snowy" : "not"}, B ${r.snowy ? "not" : "snowy"}`)
  : [];

const dir = `${RENDERS}/eval/${run}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/report.json`, JSON.stringify({
  run, engines, kernels, strict, failures: [...new Set(failures)], snowyPairs: snowyPairs.size, snowyMissed: missedPairs, knownMissed, nowFound, ready, diffs, results,
}, null, 1));
const md: string[] = [`# eval-pixel ${run}`, "", `Engines: ${engines.join(", ")}`, `Kernels: ${kernels.join(", ")}`, ""];
md.push("| id | set | kernel | snowy | truth snowShare | scores | kinds | ms |", "|---|---|---|---|---|---|---|---|");
for (const r of results.filter((q) => q.engine === 0)) {
  md.push(`| ${r.id} | ${r.set} | ${r.kernel} | ${r.snowy ? "yes" : "no"} | ${r.truth?.snowShare ?? ""} | ${r.scores ? Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join(", ") : ""} | ${r.kinds ? JSON.stringify(r.kinds) : ""} | ${r.ms ?? ""} |`);
}
md.push("", `## Snowy Dungeondraft pairs missed: ${missedPairs.length} of ${snowyPairs.size}`, "");
if (missedPairs.length) md.push(`Missed: ${missedPairs.join(", ")}${knownMissed.length && !strict ? ` (known, not failed: ${[...new Set(knownMissed)].join(", ")})` : ""}.`);
if (nowFound.length) md.push(`Now detected, so take them off KNOWN_MISSES: ${nowFound.join(", ")}.`);
md.push("", `Ready to turn pixel snowy detection back on: ${ready ? "yes" : "no"} (it needs no false positive, and every tp entry and every snowy pair detected).`);
md.push("", `## Gate failures (${new Set(failures).size})`, "", ...[...new Set(failures)].map((f) => `- ${f}`));
if (diffs.length) md.push("", "## A/B verdict differences", "", ...diffs.map((d) => `- ${d}`));
writeFileSync(`${dir}/report.md`, md.join("\n") + "\n");
console.log(md.slice(4).join("\n"));
console.log(`\nwrote ${dir}/report.md`);
process.exitCode = failures.length ? 1 : 0;

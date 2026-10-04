// M2 contact sheets (design 7.0 step 4, 6.3 "Real maps"): for each snowy pair, As drawn and all 12
// looks, exact (Dungeondraft data) against pixel (today's guess), baked with the browser's own
// geometry (seasons.ts: the scene is the picture at its export grid, the analysis about 20 px a
// square) from the sidecar as every device gets it (the worker's prepare, packPng, SidecarCache,
// decodeSidecar). One sheet per map, crop sheets of chosen windows at a readable size, waterfall
// with packs "guess" against the default, and numbers that say what moved where (what's kept,
// what melts, where leaves and autumn colours land). Overlays of the round-tripped sidecar over
// the picture (6.3 "Real maps": render.ts from the sidecar, not the raw parse) go in the same folder.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-sheets.ts [pair ...] [--no-crops] [--packs]

import { GRID } from "../../src/client/dd/model";
import { AR, OR, TR, type ObjectRole } from "../../src/client/dd/roles";
import { rasterSidecar } from "../../src/client/dd/raster";
import { NO_NAME, SIDECAR_UNITS, type SeasonSidecar } from "../../src/client/dd/sidecar";
import type { PictureSample } from "../../src/client/dd/extract";
import { objectRole } from "../../src/client/dd/roles";
import { exactLayers } from "../../src/client/room/seasonExact";
import { colourTable, lutIndex, type SeasonAnalysis } from "../../src/client/room/seasonPixels";
import type { SeasonLook } from "../../src/shared/types";
import {
  LEVELS, LEVEL_NAME, LOOKS, OUT, SNOWY, baseTile, bakeTile, differs, dilated, eroded, exactOrReason, fmt, havePair, hueSat, loadFull,
  pair, pct, pixelAnalysis, prepare, roundTrip, savePng, sceneOf, sheet, writeText, type Full, type Scene, type Tile, type Window,
} from "./m2-lib";

const argv = process.argv.slice(2);
const want = argv.filter((a) => !a.startsWith("--"));
const names = want.length ? want : SNOWY;
const crops = !argv.includes("--no-crops");
const packsToo = argv.includes("--packs") || names.includes("waterfall");

/** Crop windows per map, in squares [x, y, w, h], with what they show. */
const WINDOWS: Record<string, Array<{ name: string; win: Window }>> = {
  waterfall: [
    { name: "nw-oak-eucalyptus-pines-log", win: [0, 0, 16, 12] },
    { name: "se-dead-trees-pack-rock-mangrove", win: [28, 22, 16, 12] },
    { name: "mid-waterfall-water-cave", win: [10, 12, 16, 12] },
    { name: "sw-oak-pines-stump-tufts", win: [0, 22, 16, 12] },
  ],
  pelcs: [{ name: "w-houses-roofs-trail", win: [0, 0, 10, 8] }, { name: "e-trees-snow-objects", win: [10, 8, 10, 8] }],
  tulgi: [{ name: "nw-roots-pines", win: [0, 0, 10, 8] }, { name: "se-hut-stumps", win: [10, 8, 10, 8] }],
  cavern: [{ name: "w-cave-pools-roots", win: [0, 6, 14, 10] }, { name: "e-pines-rocks-trail", win: [20, 0, 14, 10] }],
};

/** Tile pixels a square for a whole-map sheet: about 600 px across. */
const tilePps = (sqW: number) => Math.max(8, Math.min(24, Math.floor(600 / sqW)));
const CROP_PPS = 30;

const T = colourTable();
const vegAt = (p: PictureSample, i: number) => T[lutIndex(p.rgba[i * 4], p.rgba[i * 4 + 1], p.rgba[i * 4 + 2])] >= 128;

interface Baked { exact: Record<string, PictureSample>; pixel: Record<string, PictureSample>; base: PictureSample }
const key = (look: SeasonLook, level: number) => `${look}${level}`;

async function bakeAll(f: Full, s: Scene, win: Window, pps: number, a: SeasonAnalysis | null, b: SeasonAnalysis | null): Promise<Baked> {
  const base = await baseTile(f.full, f.exportPps, win, pps);
  const out: Baked = { exact: {}, pixel: {}, base };
  for (const look of LOOKS) for (const level of LEVELS) {
    if (a) out.exact[key(look, level)] = bakeTile(base, s, f.exportPps, win, a, look, level);
    if (b) out.pixel[key(look, level)] = bakeTile(base, s, f.exportPps, win, b, look, level);
  }
  return out;
}

/** The season rows of a sheet: per look, left L1-3, right L1-3. */
function seasonRows(bk: Baked, left: Record<string, PictureSample>, right: Record<string, PictureSample>, leftName: string, rightName: string): Tile[][] {
  return LOOKS.map((look) => [
    ...LEVELS.map((lv): Tile => ({ pic: left[key(look, lv)], label: `${leftName}: ${look} ${LEVEL_NAME[look][lv - 1]}` })),
    ...LEVELS.map((lv): Tile => ({ pic: right[key(look, lv)], label: `${rightName}: ${look} ${LEVEL_NAME[look][lv - 1]}` })),
  ]);
}

// ---------------------------------------------------------------- the numbers

const RN: Record<number, string> = Object.fromEntries(Object.entries(OR).map(([k, v]) => [v, k]));

/** Masks at tile size from the sidecar, as the runtime sees it. */
function masks(sc: SeasonSidecar, w: number, h: number) {
  const L = exactLayers(sc, w, h);
  const n = w * h;
  const zero = new Uint8Array(n);
  const terr = (r: number) => L.layers.terrain.get(r as never) ?? zero;
  const obj = (r: ObjectRole) => L.layers.objects.get(r) ?? zero;
  const area = (r: number) => L.layers.area.get(r as never) ?? zero;
  const snow = terr(TR.SNOW), rock = terr(TR.ROCK), top = L.layers.top;
  const pureSnow = new Uint8Array(n), pureRock = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const open = L.outdoor[i] >= 200 && top[i] === 0 && L.keep[i] < 64;
    if (open && snow[i] >= 230) pureSnow[i] = 255;
    if (open && rock[i] >= 230) pureRock[i] = 255;
  }
  const union = (rs: ObjectRole[]) => {
    const m = new Uint8Array(n);
    for (const r of rs) { const p = obj(r); for (let i = 0; i < n; i++) if (p[i] >= 128) m[i] = 255; }
    return m;
  };
  return {
    L, pureSnow: eroded(pureSnow, w, h, 1), pureRock: eroded(pureRock, w, h, 1), keep: eroded(L.keep, w, h, 2),
    water: area(AR.WATER), keepWater: zero,
    ever: union([OR.EVERGREEN]), broad: union([OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB]), bare: union([OR.BARE]),
    trees: dilated(union([OR.EVERGREEN, OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB, OR.BARE]), w, h, 1),
    indoor: L.indoor,
  };
}

function share(mask: Uint8Array, test: (i: number) => boolean): string {
  let n = 0, k = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] >= 128) { n++; if (test(i)) k++; }
  return n ? `${pct(k / n)} of ${n}` : "-";
}

/** Hue classes of the changed, coloured pixels inside a mask: green, yellow, orange, red, other. */
function hues(base: PictureSample, out: PictureSample, mask: Uint8Array): string {
  const c = { green: 0, yellow: 0, orange: 0, red: 0, other: 0 };
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] < 128 || !differs(base, out, i, 6)) continue;
    const [h, s] = hueSat(out, i);
    const lum = 0.299 * out.rgba[i * 4] + 0.587 * out.rgba[i * 4 + 1] + 0.114 * out.rgba[i * 4 + 2];
    if (s < 0.3 || lum < 50) continue;
    n++;
    if (h >= 70 && h < 170) c.green++;
    else if (h >= 45 && h < 70) c.yellow++;
    else if (h >= 18 && h < 45) c.orange++;
    else if (h < 18 || h >= 335) c.red++;
    else c.other++;
  }
  if (!n) return "no coloured change";
  return `${n} px: green ${pct(c.green / n, 0)}, yellow ${pct(c.yellow / n, 0)}, orange ${pct(c.orange / n, 0)}, red ${pct(c.red / n, 0)}, other ${pct(c.other / n, 0)}`;
}

function numbers(sc: SeasonSidecar, bk: Baked): string[] {
  const { base } = bk;
  const w = base.w, h = base.h;
  const m = masks(sc, w, h);
  const lines: string[] = [];
  lines.push(`  masks at ${w}x${h}: open snow ${share(m.pureSnow, () => true).split(" of ")[1]} px, open rock ${share(m.pureRock, () => true).split(" of ")[1]} px, kept (eroded 2 px) ${share(m.keep, () => true).split(" of ")[1]} px, trees ${share(m.trees, () => true).split(" of ")[1]} px`);
  for (const look of LOOKS) for (const level of LEVELS) {
    const out = bk.exact[key(look, level)];
    if (!out) continue;
    const ch = (i: number) => differs(base, out, i, 2);
    const parts = [
      `kept changed ${share(m.keep, ch)}`,
      `open snow changed ${share(m.pureSnow, ch)}`,
      `open rock changed ${share(m.pureRock, ch)}`,
      `water changed ${share(m.water, ch)}`,
      `indoor changed ${share(m.indoor, ch)}`,
    ];
    if (look === "autumn") {
      parts.push(`evergreen footprints: ${hues(base, out, m.ever)}`);
      parts.push(`broadleaf footprints: ${hues(base, out, m.broad)}`);
      parts.push(`bare-tree footprints: ${hues(base, out, m.bare)}`);
      // Red where no tree is: a leak.
      let redOut = 0, redIn = 0;
      for (let i = 0; i < w * h; i++) {
        if (!differs(base, out, i, 6)) continue;
        const [hh, s] = hueSat(out, i);
        const [h0, s0] = hueSat(base, i);
        const lum = 0.299 * out.rgba[i * 4] + 0.587 * out.rgba[i * 4 + 1] + 0.114 * out.rgba[i * 4 + 2];
        const red = (hh < 22 || hh >= 335) && s > 0.45 && lum > 60;
        const wasRed = (h0 < 22 || h0 >= 335) && s0 > 0.45;
        if (red && !wasRed) { if (m.trees[i] >= 128) redIn++; else redOut++; }
      }
      parts.push(`new red pixels: ${redIn} in tree footprints, ${redOut} outside`);
    }
    if (look === "summer" && level === 2) {
      // Vegetation colour that appears outside trees: melted snow becoming grass (expected on snow), or a leak elsewhere.
      let onSnow = 0, elsewhere = 0;
      for (let i = 0; i < w * h; i++) {
        if (vegAt(base, i) || !vegAt(out, i) || m.trees[i] >= 128) continue;
        if (m.pureSnow[i] >= 128) onSnow++; else elsewhere++;
      }
      parts.push(`new vegetation colour outside trees: ${onSnow} px on open snow, ${elsewhere} px elsewhere (edges, partial snow, lawns)`);
    }
    lines.push(`  ${look} L${level}: ${parts.join("; ")}`);
  }
  return lines;
}

// ---------------------------------------------------------------- overlays

const OVER: Record<string, [number, number, number]> = {
  snow: [0, 230, 255], water: [40, 90, 255], ice: [180, 240, 255], keep: [255, 60, 255], floor: [255, 200, 0], wall: [255, 40, 40], roof: [255, 140, 0],
  cave: [255, 100, 200], rim: [200, 120, 255], pathEarth: [200, 140, 60], pathKeep: [255, 0, 255], paved: [220, 220, 220],
  evergreen: [0, 160, 60], deciduous: [120, 255, 60], bare: [200, 120, 40], small: [255, 255, 0], prop: [170, 170, 170], opaque: [255, 0, 255], keepObj: [255, 255, 255],
};

/** The round-tripped sidecar's outlines over the picture at pps: areas and terrain snow by role colour, objects by kind. */
async function overlay(f: Full, sc: SeasonSidecar, pps: number): Promise<PictureSample> {
  const win: Window = [0, 0, f.sqW, f.sqH];
  const base = await baseTile(f.full, f.exportPps, win, pps);
  const w = base.w, h = base.h, n = w * h;
  const Ly = rasterSidecar(sc, { w, h });
  const out = { rgba: base.rgba.slice(), w, h };
  const zero = new Uint8Array(n);
  const edge = (m: Uint8Array, thr: number, c: [number, number, number], a = 1) => {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const on = m[i] >= thr;
      if (!on) continue;
      if (m[i - 1] >= thr && m[i + 1] >= thr && m[i - w] >= thr && m[i + w] >= thr) continue;
      const o = i * 4;
      out.rgba[o] += (c[0] - out.rgba[o]) * a; out.rgba[o + 1] += (c[1] - out.rgba[o + 1]) * a; out.rgba[o + 2] += (c[2] - out.rgba[o + 2]) * a;
    }
  };
  edge(Ly.terrain.get(TR.SNOW) ?? zero, 128, OVER.snow, 0.8);
  edge(Ly.terrain.get(TR.KEEP) ?? zero, 128, OVER.keep, 0.8);
  const A: Array<[number, [number, number, number]]> = [
    [AR.WATER, OVER.water], [AR.ICE, OVER.ice], [AR.KEEP, OVER.keep], [AR.FLOOR, OVER.floor], [AR.WALL, OVER.wall], [AR.ROOF, OVER.roof],
    [AR.CAVE, OVER.cave], [AR.CAVE_RIM, OVER.rim], [AR.PATH_EARTH, OVER.pathEarth], [AR.PATH_KEEP, OVER.pathKeep], [AR.PATH_PAVED, OVER.paved], [AR.PAVED, OVER.paved],
  ];
  for (const [r, c] of A) edge(Ly.area.get(r as never) ?? zero, 128, c);
  // Objects: the top object's boundary, coloured by its runtime role.
  const o = sc.objects;
  const roleOf = (i: number): ObjectRole => {
    const nm = o.name[i];
    return nm !== NO_NAME && nm < sc.meta.names.length ? objectRole(sc.meta.names[nm]) : (o.role[i] as ObjectRole);
  };
  const colourOf = (r: ObjectRole): [number, number, number] =>
    r === OR.EVERGREEN ? OVER.evergreen : r === OR.DECIDUOUS || r === OR.SHRUB || r === OR.FLOWER_SHRUB ? OVER.deciduous : r === OR.BARE ? OVER.bare
      : r === OR.OPAQUE ? OVER.opaque : r === OR.ROCK || r === OR.DEADWOOD || r === OR.STUMP || r === OR.ROOTS ? OVER.prop
      : r === OR.STRUCTURE || r === OR.FIRE || r === OR.MUSHROOM || r === OR.ICE || r === OR.EFFECT || r === OR.WATER_FX || r === OR.LITTER ? OVER.keepObj : OVER.small;
  const top = Ly.top;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, t = top[i];
    if (!t) continue;
    if (top[i - 1] === t && top[i + 1] === t && top[i - w] === t && top[i + w] === t) continue;
    const c = colourOf(roleOf(t - 1)), q = i * 4;
    out.rgba[q] = c[0]; out.rgba[q + 1] = c[1]; out.rgba[q + 2] = c[2];
  }
  // Centres as dots.
  const [x0, y0, x1, y1] = sc.meta.rect;
  for (let i = 0; i < o.n; i++) {
    const cx = Math.round(((o.x[i] / SIDECAR_UNITS.coord - x0) / (x1 - x0)) * w), cy = Math.round(((o.y[i] / SIDECAR_UNITS.coord - y0) / (y1 - y0)) * h);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = (yy * w + xx) * 4;
      out.rgba[q] = 255; out.rgba[q + 1] = 255; out.rgba[q + 2] = 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------- main

const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };

for (const name of names) {
  const p = pair(name);
  if (!havePair(p)) { say(`== ${name}: files missing`); continue; }
  const f = await loadFull(p);
  const pr = await prepare(f);
  const { sc } = await roundTrip(pr.sidecar);
  const s = sceneOf(f.full, f.exportPps);
  const ex = exactOrReason(s, sc);
  const px = pixelAnalysis(s);
  say(`\n== ${name}: ${f.sqW}x${f.sqH} squares at ${fmt(f.exportPps, 1)} px/sq; scene ${s.sceneW}x${s.sceneH}, square ${fmt(s.square, 1)}, analysis ${s.aw}x${s.ah} (cellA ${fmt(s.cellA, 1)}); fit ${pr.report.fit.verdict}; exact ${ex.a ? "ok" : `refused: ${ex.reason}`}`);
  // Overlays from the round-tripped sidecar (green maps too): outlines at 24 px a square, and the dialog's own preview.
  const ov = await overlay(f, sc, Math.min(24, f.exportPps));
  await savePng(`${OUT}/${name}-overlay.png`, ov);
  await savePng(`${OUT}/${name}-preview.png`, pr.preview);
  say(`  overlays: ${OUT}/${name}-overlay.png (${ov.w}x${ov.h}), ${OUT}/${name}-preview.png`);
  if (!ex.a) continue;
  const a = ex.a;

  // The whole-map sheet.
  const pps = tilePps(f.sqW);
  const win: Window = [0, 0, f.sqW, f.sqH];
  const bk = await bakeAll(f, s, win, pps, a, px);
  const header: Tile[] = [
    { pic: bk.base, label: "As drawn (the export)" },
    { pic: pr.preview, label: "Attach dialog: preview overlay" },
    { pic: pr.compare?.exact ?? null, label: "Attach dialog Compare: exact Summer L2" },
    { pic: pr.compare?.guessed ?? null, label: "Attach dialog Compare: guessed Summer L2" },
    { pic: null, label: "" }, { pic: null, label: "" },
  ];
  // The dialog pictures are 512 wide; show them at the tile's size.
  for (const t of header) if (t.pic && t.pic !== bk.base) t.pic = fit(t.pic, bk.base.w, bk.base.h);
  const path = `${OUT}/${name}-sheet.png`;
  await sheet(path, `${name}: exact (Dungeondraft data) against pixel (today's guess); As drawn and 12 looks; ${pps} px a square`,
    [header, ...seasonRows(bk, bk.exact, bk.pixel, "exact", "pixel")]);
  say(`  sheet: ${path}`);
  for (const l of numbers(sc, bk)) say(l);

  // Crops.
  if (crops) {
    for (const c of WINDOWS[name] ?? []) {
      const cb = await bakeAll(f, s, c.win, CROP_PPS, a, px);
      const rows: Tile[][] = LOOKS.map((look) => [
        { pic: cb.base, label: "As drawn" },
        ...LEVELS.map((lv): Tile => ({ pic: cb.exact[key(look, lv)], label: `exact: ${look} ${LEVEL_NAME[look][lv - 1]}` })),
        { pic: cb.pixel[key(look, 3)], label: `pixel: ${look} ${LEVEL_NAME[look][2]}` },
      ]);
      const cp = `${OUT}/${name}-crop-${c.name}.png`;
      await sheet(cp, `${name}: squares ${c.win[0]},${c.win[1]} to ${c.win[0] + c.win[2]},${c.win[1] + c.win[3]} at ${CROP_PPS} px a square`, rows);
      say(`  crop: ${cp}`);
    }
  }

  // Bare trees "dead" (per-scene switch): one row of summer and autumn L2 for the maps with bare trees.
  if (Array.from(sc.objects.role).includes(OR.BARE)) {
    const dead = exactOrReason(s, sc, { bare: "dead" }).a!;
    const db = await bakeAll(f, s, win, pps, dead, null);
    const dp = `${OUT}/${name}-bare-dead.png`;
    await sheet(dp, `${name}: bare trees "Stay dead" (left) against "Come into leaf" (right)`, [
      [{ pic: db.exact.summer2, label: "dead: summer Dry" }, { pic: bk.exact.summer2, label: "leaf: summer Dry" }],
      [{ pic: db.exact.autumn2, label: "dead: autumn Autumn" }, { pic: bk.exact.autumn2, label: "leaf: autumn Autumn" }],
      [{ pic: db.exact.winter3, label: "dead: winter L3" }, { pic: bk.exact.winter3, label: "leaf: winter L3" }],
    ]);
    say(`  bare trees dead: ${dp}`);
  }

  // Waterfall with packs "guess" against the default.
  if (name === "waterfall" && packsToo) {
    const g = exactOrReason(s, sc, { packs: "guess" });
    if (g.a) {
      const gb = await bakeAll(f, s, win, pps, g.a, null);
      const gp = `${OUT}/waterfall-packs-guess.png`;
      await sheet(gp, `waterfall: pack items left as drawn (left, the default) against packs "guess" (right); ${pps} px a square`,
        seasonRows(bk, bk.exact, gb.exact, "as drawn", "guess"));
      say(`  packs guess: ${gp}`);
      const cw: Window = [28, 22, 16, 12];
      const gc = await bakeAll(f, s, cw, CROP_PPS, g.a, null), dc = await bakeAll(f, s, cw, CROP_PPS, a, null);
      await sheet(`${OUT}/waterfall-packs-guess-crop.png`, `waterfall: the pack rock and cliffs, squares 28,22 to 44,34: default (left) against packs "guess" (right)`,
        LOOKS.map((look) => [
          { pic: dc.base, label: "As drawn" },
          { pic: dc.exact[key(look, 2)], label: `default: ${look} ${LEVEL_NAME[look][1]}` },
          { pic: gc.exact[key(look, 2)], label: `guess: ${look} ${LEVEL_NAME[look][1]}` },
          { pic: dc.exact[key(look, 3)], label: `default: ${look} ${LEVEL_NAME[look][2]}` },
          { pic: gc.exact[key(look, 3)], label: `guess: ${look} ${LEVEL_NAME[look][2]}` },
        ]));
      say(`  packs guess crop: ${OUT}/waterfall-packs-guess-crop.png`);
    } else say(`  packs guess refused: ${g.reason}`);
  }
}
writeText(`${OUT}/sheets.log`, log.join("\n"));

/** A picture resampled into w x h (the dialog's 512-px pictures beside a tile). */
function fit(p: PictureSample, w: number, h: number): PictureSample {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(p.w - 1, Math.floor(((x + 0.5) * p.w) / w)), sy = Math.min(p.h - 1, Math.floor(((y + 0.5) * p.h) / h));
    const i = (sy * p.w + sx) * 4, o = (y * w + x) * 4;
    out[o] = p.rgba[i]; out[o + 1] = p.rgba[i + 1]; out[o + 2] = p.rgba[i + 2]; out[o + 3] = 255;
  }
  return { rgba: out, w, h };
}

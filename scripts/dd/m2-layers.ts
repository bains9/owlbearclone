// M2, 7.0 step 4 and checklist 6.6 item 2: the [L] draw layers of design 3.3 (caves -350, floors
// and wall-loop interiors -300, materials at their own layer, patterns at theirs, walls 600, roofs
// 800, "Below Ground" -400 and "Above Roofs" 900 objects) checked against the real exports, and
// the wall-loop rule of 4.1 on the Mill, Hobblestone, Pelcs and Tulgi.
//
// Layer order: every drawable group of the round-tripped sidecar (each bitmap and shape by role
// and layer, the objects by layer) is rasterised alone at 24 px a square. For every pair of groups
// of different layers that overlap, the picture's pixels in the overlap are classed by which
// group's own colour (the median RGB where that group shows alone) they are nearer: a share near
// 100% "looks like the upper" means the export draws them in the sidecar's order.
// Wall loops: each closed wall (not cave type) with its area in square squares, the FLOOR share
// and the indoor share inside it from the sidecar, and for the Mill the wood pattern's FLOOR share
// (no street snow on its floor, 4.1).
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-layers.ts [pair ...]

import { GRID } from "../../src/client/dd/model";
import { AR, OR } from "../../src/client/dd/roles";
import { rasterSidecar } from "../../src/client/dd/raster";
import { fillPolygons, type RasterSpec } from "../../src/client/dd/ddRaster";
import { patternPolygon } from "../../src/client/dd/geometry";
import { defaultName } from "../../src/client/dd/roles";
import { exactLayers } from "../../src/client/room/seasonExact";
import type { ObjectTable, SeasonSidecar } from "../../src/client/dd/sidecar";
import { resample } from "../../src/client/dd/ddWorker";
import { OUT, fmt, havePair, loadFull, median, pair, pct, prepare, roundTrip, writeText } from "./m2-lib";

const AN: Record<number, string> = Object.fromEntries(Object.entries(AR).map(([k, v]) => [v, k]));
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["waterfall", "pelcs", "tulgi", "cavern", "hobble", "mill"];
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
const NO_OBJECTS: ObjectTable = {
  n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0),
  flags: new Uint8Array(0), name: new Uint16Array(0), reach: new Uint16Array(0),
};
function objectsWhere(o: ObjectTable, keep: (i: number) => boolean): ObjectTable {
  const idx: number[] = [];
  for (let i = 0; i < o.n; i++) if (keep(i)) idx.push(i);
  const n = idx.length;
  const out: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * 16),
  };
  idx.forEach((i, k) => {
    out.role[k] = o.role[i]; out.layer[k] = o.layer[i]; out.x[k] = o.x[i]; out.y[k] = o.y[i]; out.rot[k] = o.rot[i];
    out.flags[k] = o.flags[i]; out.name[k] = o.name[i]; out.reach.set(o.reach.subarray(i * 16, i * 16 + 16), k * 16);
  });
  return out;
}

interface Group { label: string; layer: number; mask: Uint8Array; px: number }

for (const name of names) {
  const p = pair(name);
  if (!havePair(p)) { say(`\n== ${name}: files missing`); continue; }
  const f = await loadFull(p);
  const pr = await prepare(f, { compare: false });
  const { sc } = await roundTrip(pr.sidecar);
  const L = f.map.world.levels.find((l) => l.key === pr.report.level) ?? f.map.world.levels[0];
  const pps = Math.min(24, f.exportPps);
  const W = Math.round(f.sqW * pps), H = Math.round(f.sqH * pps), N = W * H;
  const pic = resample(f.full, W, H);
  say(`\n== ${name} (level ${L.label}) at ${pps} px/sq, ${W}x${H}`);

  // ---- the groups
  const groups: Group[] = [];
  const add = (label: string, layer: number, mask: Uint8Array) => {
    let px = 0;
    for (let i = 0; i < N; i++) if (mask[i] >= 128) px++;
    if (px) groups.push({ label, layer, mask, px });
  };
  const byKey = new Map<string, { layer: number; sub: SeasonSidecar }>();
  for (const b of sc.bitmaps) {
    const k = `BITS ${AN[b.role]}@${b.layer}`;
    const e = byKey.get(k) ?? { layer: b.layer, sub: { ...sc, bitmaps: [], shapes: [], objects: NO_OBJECTS } };
    e.sub.bitmaps.push(b);
    byKey.set(k, e);
  }
  for (const s of sc.shapes) {
    const k = `${AN[s.role]}@${s.layer}`;
    const e = byKey.get(k) ?? { layer: s.layer, sub: { ...sc, bitmaps: [], shapes: [], objects: NO_OBJECTS } };
    e.sub.shapes.push(s);
    byKey.set(k, e);
  }
  for (const [k, e] of byKey) {
    const Ly = rasterSidecar(e.sub, { w: W, h: H });
    const m = new Uint8Array(N);
    for (const a of Ly.area.values()) for (let i = 0; i < N; i++) if (a[i] >= 128) m[i] = 255;
    add(k, e.layer, m);
  }
  const layers = [...new Set(Array.from(sc.objects.layer))].sort((a, b) => a - b);
  for (const ly of layers) {
    const sub: SeasonSidecar = { ...sc, bitmaps: [], shapes: [], objects: objectsWhere(sc.objects, (i) => sc.objects.layer[i] === ly && sc.objects.role[i] !== OR.EFFECT) };
    const Ly = rasterSidecar(sub, { w: W, h: H });
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (Ly.top[i]) m[i] = 255;
    add(`objects@${ly} (${sub.objects.n})`, ly, m);
  }
  say(`  groups: ${groups.map((g) => `${g.label} ${g.px} px`).join("; ")}`);

  // ---- pairs of overlapping groups of different layers
  const any = new Uint8Array(N);
  const count = new Uint8Array(N);
  for (const g of groups) for (let i = 0; i < N; i++) if (g.mask[i] >= 128) { any[i] = 255; count[i]++; }
  const medianColour = (sel: (i: number) => boolean): [number, number, number] | null => {
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let i = 0; i < N; i++) if (sel(i)) { rs.push(pic[i * 4]); gs.push(pic[i * 4 + 1]); bs.push(pic[i * 4 + 2]); }
    return rs.length >= 50 ? [median(rs), median(gs), median(bs)] : null;
  };
  const alone = new Map<Group, [number, number, number] | null>();
  for (const g of groups) alone.set(g, medianColour((i) => g.mask[i] >= 128 && count[i] === 1));
  for (let a = 0; a < groups.length; a++) for (let b = 0; b < groups.length; b++) {
    const A = groups[a], B = groups[b];
    if (A.layer >= B.layer) continue;
    let overlap = 0, upper = 0, lower = 0;
    const cA = alone.get(A), cB = alone.get(B);
    for (let i = 0; i < N; i++) {
      if (A.mask[i] < 128 || B.mask[i] < 128) continue;
      overlap++;
      if (!cA || !cB) continue;
      const o = i * 4;
      const dA = Math.abs(pic[o] - cA[0]) + Math.abs(pic[o + 1] - cA[1]) + Math.abs(pic[o + 2] - cA[2]);
      const dB = Math.abs(pic[o] - cB[0]) + Math.abs(pic[o + 1] - cB[1]) + Math.abs(pic[o + 2] - cB[2]);
      if (dB < dA) upper++; else if (dA < dB) lower++;
    }
    if (overlap < 100) continue;
    const sep = cA && cB ? Math.abs(cA[0] - cB[0]) + Math.abs(cA[1] - cB[1]) + Math.abs(cA[2] - cB[2]) : 0;
    say(`  ${A.label} under ${B.label}: overlap ${overlap} px${cA && cB ? `; looks like the upper ${pct(upper / overlap)}, the lower ${pct(lower / overlap)} (own colours rgb(${cA.join(",")}) vs rgb(${cB.join(",")}), apart by ${sep}${sep < 60 ? ": too alike to tell" : ""})` : "; a group never shows alone: can't tell"}`);
  }

  // ---- wall loops (4.1)
  const Ly = rasterSidecar(sc, { w: W, h: H });
  const floorM = Ly.area.get(AR.FLOOR) ?? new Uint8Array(N);
  const EL = exactLayers(sc, W, H);
  const spec: RasterSpec = { width: W, height: H, originX: sc.meta.rect[0], originY: sc.meta.rect[1], unitsPerPx: GRID / pps };
  const shareIn = (poly: Float64Array, m: Uint8Array): { n: number; share: number } => {
    const mask = new Uint8Array(N);
    fillPolygons(mask, spec, [poly], 255, "nonzero");
    let n = 0, k = 0;
    for (let i = 0; i < N; i++) if (mask[i] >= 128) { n++; if (m[i] >= 128) k++; }
    return { n, share: n ? k / n : NaN };
  };
  const area = (poly: Float64Array): number => {
    let s = 0;
    for (let i = 0, n = poly.length / 2; i < n; i++) { const j = (i + 1) % n; s += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1]; }
    return Math.abs(s) / 2 / (GRID * GRID);
  };
  const loops = L.walls.filter((w) => w.loop && w.type !== 2 && w.points.length >= 6);
  say(`  wall loops (closed walls, not cave): ${loops.length}; open walls ${L.walls.length - loops.length}`);
  for (const w of loops) {
    const fl = shareIn(w.points, floorM), ind = shareIn(w.points, EL.indoor);
    say(`    loop of ${w.points.length / 2} points, ${fmt(area(w.points), 1)} sq², ${fl.n} px: FLOOR ${pct(fl.share)}, indoor ${pct(ind.share)}${area(w.points) <= 36 ? " (a room by size)" : " (bigger than a room: its own floors only)"}`);
  }
  for (const pt of L.patterns) {
    const poly = patternPolygon(pt);
    const fl = shareIn(poly, floorM), ind = shareIn(poly, EL.indoor);
    say(`    pattern ${defaultName(pt.texture) ?? "pack"}@${pt.layer}, ${fmt(area(poly), 1)} sq²: FLOOR ${pct(fl.share)}, indoor ${pct(ind.share)}`);
  }
}
writeText(`${OUT}/layers.txt`, lines.join("\n"));

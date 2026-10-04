// M2: prototype of a size-aware sharpness for the object-centre fit (design 2.4). Per object, the
// luminance spread in the 0.3-square box at its centre against the mean over the four half-square
// neighbours, by the object's prior radius (priorReach, SPRITE_SIZES): big crowns' centres are
// not peaks (their box stays inside the crown), small things' are. Then the verdicts a rule that
// takes sharpness from the small objects only would give on every pair, swapped pair and shift.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-fit2.ts [--small 0.6]

import { GRID, type Level } from "../../src/client/dd/model";
import { FIT } from "../../src/client/dd/fit";
import { OR, defaultName, objectRole } from "../../src/client/dd/roles";
import { priorReach } from "../../src/client/dd/measure";
import { SPRITE_SIZES } from "../../src/client/dd/spriteSizes";
import type { PictureRect, PictureSample } from "../../src/client/dd/extract";
import { resample } from "../../src/client/dd/ddWorker";
import { PAIRS, pickLevel } from "./lib";
import { fmt, havePair, loadFull, type Full } from "./m2-lib";

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SMALL = Number(opt("small", "0.6"));

/** Centres and prior radii (squares) of a level's default objects, effects left out. */
function inputs(L: Level): { c: Float64Array; r: Float64Array; roles: number[] } {
  const c: number[] = [], r: number[] = [], roles: number[] = [];
  for (const o of L.objects) {
    if (o.texture?.source !== "default") continue;
    const role = objectRole(defaultName(o.texture));
    if (role === OR.EFFECT) continue;
    const pr = priorReach(o, role, SPRITE_SIZES);
    let m = 0;
    for (let k = 0; k < 16; k++) m += pr[k] / 16;
    c.push(o.position.x, o.position.y); r.push(m / GRID); roles.push(role);
  }
  return { c: Float64Array.from(c), r: Float64Array.from(r), roles };
}

interface Scored { s0: number; best: number; bx: number; by: number; sharpAll: number; sharpSmall: number; peakAll: number; peakSmall: number; nSmall: number; inside: number; perObj: Array<{ r: number; sharp: number; role: number }> }

/** objectFit's scoring, with per-object sharpness and a sharpness over the small objects. */
function score(c: Float64Array, radii: Float64Array, roles: number[], rect: PictureRect, pic: PictureSample, small: number): Scored {
  const [x0, y0, x1, y1] = rect.rect;
  const sqW = (x1 - x0) / GRID, sqH = (y1 - y0) / GRID;
  const W = Math.round(sqW * FIT.pxPerSquare), H = Math.round(sqH * FIT.pxPerSquare);
  const rgba = pic.w === W && pic.h === H ? pic.rgba : resample(pic, W, H);
  const L = new Float32Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) L[i] = ((0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) * rgba[o + 3]) / 255;
  const W1 = W + 1;
  const S = new Float64Array(W1 * (H + 1)), Q = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < W; x++) {
      const v = L[y * W + x];
      rs += v; rq += v * v;
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs;
      Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + rq;
    }
  }
  const ppx = W / sqW, ppy = H / sqH;
  const rr = Math.max(2, Math.round(FIT.box * Math.min(ppx, ppy)));
  const side = 2 * rr + 1, area = side * side;
  const n = c.length >> 1;
  const px = new Float64Array(n), py = new Float64Array(n);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    px[i] = ((c[i * 2] - x0) / (x1 - x0)) * W; py[i] = ((c[i * 2 + 1] - y0) / (y1 - y0)) * H;
    if (c[i * 2] >= x0 && c[i * 2] < x1 && c[i * 2 + 1] >= y0 && c[i * 2 + 1] < y1) inside++;
  }
  const one = (i: number, ox: number, oy: number): number => {
    const bx = Math.floor(px[i] + ox * ppx) - rr, by = Math.floor(py[i] + oy * ppy) - rr;
    if (!(bx >= 0 && by >= 0 && bx + side <= W && by + side <= H)) return NaN;
    const a = by * W1 + bx, b = (by + side) * W1 + bx;
    const sum = S[b + side] - S[a + side] - S[b] + S[a], sq = Q[b + side] - Q[a + side] - Q[b] + Q[a];
    const m = sum / area, v = sq / area - m * m;
    return v > 0 ? Math.sqrt(v) : 0;
  };
  const mean = (ox: number, oy: number, use: (i: number) => boolean): number => {
    let s = 0, k = 0;
    for (let i = 0; i < n; i++) { if (!use(i)) continue; const v = one(i, ox, oy); if (!Number.isNaN(v)) { s += v; k++; } }
    return k >= FIT.minObjects ? s / k : NaN;
  };
  const all = () => true, sm = (i: number) => radii[i] <= small;
  const sharp = (ox: number, oy: number, use: (i: number) => boolean) => {
    const at = mean(ox, oy, use);
    let s = 0, k = 0;
    for (const [ax, ay] of [[FIT.step, 0], [-FIT.step, 0], [0, FIT.step], [0, -FIT.step]]) { const v = mean(ox + ax, oy + ay, use); if (!Number.isNaN(v)) { s += v; k++; } }
    return k && at > 0 ? s / k / at : NaN;
  };
  // The best half-square neighbour over the centre (a peak has none better: <= 1).
  const peak = (use: (i: number) => boolean) => {
    const at = mean(0, 0, use);
    let m = 0;
    for (const [ax, ay] of [[FIT.step, 0], [-FIT.step, 0], [0, FIT.step], [0, -FIT.step]]) { const v = mean(ax, ay, use); if (!Number.isNaN(v)) m = Math.max(m, v); }
    return at > 0 ? m / at : NaN;
  };
  const s0 = mean(0, 0, all);
  let best = NaN, bx = 0, by = 0;
  const steps = Math.round(FIT.range / FIT.step);
  for (let j = -steps; j <= steps; j++) for (let i = -steps; i <= steps; i++) {
    const dx = i * FIT.step, dy = j * FIT.step;
    if (Math.hypot(dx, dy) < FIT.minShift) continue;
    const v = mean(dx, dy, all);
    if (!Number.isNaN(v) && (Number.isNaN(best) || v > best)) { best = v; bx = dx; by = dy; }
  }
  const perObj: Scored["perObj"] = [];
  for (let i = 0; i < n; i++) {
    const at = one(i, 0, 0);
    if (Number.isNaN(at) || at <= 0) continue;
    let s = 0, k = 0;
    for (const [ax, ay] of [[FIT.step, 0], [-FIT.step, 0], [0, FIT.step], [0, -FIT.step]]) { const v = one(i, ax, ay); if (!Number.isNaN(v)) { s += v; k++; } }
    if (k) perObj.push({ r: radii[i], sharp: s / k / at, role: roles[i] });
  }
  let nSmall = 0;
  for (let i = 0; i < n; i++) if (sm(i)) nSmall++;
  return { s0, best, bx, by, sharpAll: sharp(0, 0, all), sharpSmall: sharp(0, 0, sm), peakAll: peak(all), peakSmall: peak(sm), nSmall, inside, perObj };
}

function verdict(sc: Scored, useSmall: boolean, peakRule = false): string {
  const small = useSmall && sc.nSmall >= FIT.minObjects && !Number.isNaN(sc.sharpSmall);
  const sharp = small ? sc.sharpSmall : sc.sharpAll;
  const peak = small ? sc.peakSmall : sc.peakAll;
  if (!(sc.inside >= FIT.minObjects) || Number.isNaN(sc.s0) || Number.isNaN(sc.best)) return "unsure";
  if (sc.s0 >= sc.best && sharp <= FIT.yesSharp && (!peakRule || peak <= 1)) return "yes";
  if (sc.s0 < FIT.noLead * sc.best) return "no";
  return "unsure";
}

const RN: Record<number, string> = Object.fromEntries(Object.entries(OR).map(([k, v]) => [v, k]));
const BINS = [0, 0.3, 0.45, 0.6, 0.8, 1, 1.5, 9];
const loaded = new Map<string, Full>();
for (const p of PAIRS) if (havePair(p)) loaded.set(p.name, await loadFull(p));

console.log(`per-object sharpness (neighbours' spread / centre spread; < 1 is a peak) by prior radius in squares; median [n]`);
console.log(`map        ${BINS.slice(0, -1).map((b, i) => `${b}-${BINS[i + 1]}`.padStart(11)).join("")}`);
const allObj: Array<{ r: number; sharp: number }> = [];
for (const [name, f] of loaded) {
  const L = pickLevel(f.map, f.pair.level);
  const inp = inputs(L);
  const x0 = (f.vtt?.resolution.map_origin.x ?? 0) * GRID, y0 = (f.vtt?.resolution.map_origin.y ?? 0) * GRID;
  const rect: PictureRect = { rect: [x0, y0, x0 + f.sqW * GRID, y0 + f.sqH * GRID] };
  const sc = score(inp.c, inp.r, inp.roles, rect, f.full, SMALL);
  allObj.push(...sc.perObj);
  const cells = BINS.slice(0, -1).map((b, i) => {
    const xs = sc.perObj.filter((o) => o.r >= b && o.r < BINS[i + 1]).map((o) => o.sharp).sort((a, c) => a - c);
    return xs.length ? `${fmt(xs[xs.length >> 1], 2)} [${xs.length}]`.padStart(11) : "-".padStart(11);
  });
  console.log(`${name.padEnd(10)} ${cells.join("")}`);
}
const cells = BINS.slice(0, -1).map((b, i) => {
  const xs = allObj.filter((o) => o.r >= b && o.r < BINS[i + 1]).map((o) => o.sharp).sort((a, c) => a - c);
  return xs.length ? `${fmt(xs[xs.length >> 1], 2)} [${xs.length}]`.padStart(11) : "-".padStart(11);
});
console.log(`${"all".padEnd(10)} ${cells.join("")}`);

console.log(`\nverdicts: today's rule / with sharpness from objects of prior radius <= ${SMALL} squares (when at least ${FIT.minObjects}); lead, sharpAll, sharpSmall [nSmall]`);
const SHIFTS: Array<[number, number]> = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5], [-0.5, 0], [1, 0], [0, -1], [2, 0], [0, 2]];
for (const [name, f] of loaded) {
  const L = pickLevel(f.map, f.pair.level);
  const inp = inputs(L);
  const x0 = (f.vtt?.resolution.map_origin.x ?? 0) * GRID, y0 = (f.vtt?.resolution.map_origin.y ?? 0) * GRID;
  const line: string[] = [];
  for (const [ox, oy] of SHIFTS) {
    const rect: PictureRect = { rect: [x0 + ox * GRID, y0 + oy * GRID, x0 + (f.sqW + ox) * GRID, y0 + (f.sqH + oy) * GRID] };
    const sc = score(inp.c, inp.r, inp.roles, rect, f.full, SMALL);
    line.push(`${ox},${oy}: ${verdict(sc, false)}/${verdict(sc, true)}/${verdict(sc, true, true)} (${fmt(sc.s0 / sc.best, 2)}, ${fmt(sc.sharpAll, 2)}, ${fmt(sc.sharpSmall, 2)} pk ${fmt(sc.peakSmall, 2)} [${sc.nSmall}])`);
  }
  console.log(`${name}: ${line.join("  ")}`);
}
// Swapped: forest's objects on Hobble's picture and the other way round (both 48 x 27).
const forest = loaded.get("forest"), hobble = loaded.get("hobble");
if (forest && hobble) {
  for (const [a, b] of [[forest, hobble], [hobble, forest]]) {
    const inp = inputs(pickLevel(a.map, a.pair.level));
    const rect: PictureRect = { rect: [0, 0, 48 * GRID, 27 * GRID] };
    const sc = score(inp.c, inp.r, inp.roles, rect, b.full, SMALL);
    console.log(`swapped ${a.pair.name} on ${b.pair.name}: ${verdict(sc, false)}/${verdict(sc, true)}/${verdict(sc, true, true)} (${fmt(sc.s0 / sc.best, 2)}, ${fmt(sc.sharpAll, 2)}, ${fmt(sc.sharpSmall, 2)} [${sc.nSmall}])`);
  }
}

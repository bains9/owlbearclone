// M2, item 8: Kdir Topside's export (Vern's kdir-vtt.dd2vtt, no project file): the 48 x 27 grid at
// 72 px a square confirmed against the picture's own baked dotted grid, found by autocorrelation
// of the darkness of the picture's columns and rows (the period) and the phase of the darkest
// column and row (the offset). Observations only; what the pixel path would need is in the report.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-kdir.ts

import { existsSync } from "node:fs";
import { OUT, baseTile, fmt, loadVern, sheet, writeText } from "./m2-lib";
import { VERN } from "./lib";
import { colourTable, lutIndex } from "../../src/client/room/seasonPixels";
import { resample } from "../../src/client/dd/ddWorker";

if (!existsSync(`${VERN}/kdir-vtt.dd2vtt`)) { console.log("kdir-vtt.dd2vtt missing: skipped"); process.exit(0); }
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
const k = await loadVern("kdir-vtt");
const { full, vtt } = k;
say(`kdir-vtt.dd2vtt: picture ${full.w}x${full.h}; resolution map_size ${vtt!.resolution.map_size.x}x${vtt!.resolution.map_size.y}, pixels_per_grid ${vtt!.resolution.pixels_per_grid}, origin ${vtt!.resolution.map_origin.x},${vtt!.resolution.map_origin.y} -> ${fmt(full.w / vtt!.resolution.map_size.x, 2)} px/sq across, ${fmt(full.h / vtt!.resolution.map_size.y, 2)} down`);

// Column and row darkness: the mean luma of each column (and row), high-pass filtered over 9 px.
const luma = (i: number) => 0.299 * full.rgba[i * 4] + 0.587 * full.rgba[i * 4 + 1] + 0.114 * full.rgba[i * 4 + 2];
const colL = new Float64Array(full.w), rowL = new Float64Array(full.h);
for (let y = 0; y < full.h; y++) for (let x = 0; x < full.w; x++) { const l = luma(y * full.w + x); colL[x] += l; rowL[y] += l; }
for (let x = 0; x < full.w; x++) colL[x] /= full.h;
for (let y = 0; y < full.h; y++) rowL[y] /= full.w;
const highPass = (v: Float64Array): Float64Array => {
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    let s = 0, n = 0;
    for (let d = -4; d <= 4; d++) { const j = i + d; if (j >= 0 && j < v.length) { s += v[j]; n++; } }
    out[i] = v[i] - s / n;
  }
  return out;
};
const period = (v: Float64Array, name: string): { best: number; score: number } => {
  const hp = highPass(v);
  let best = 0, bestC = -Infinity;
  const table: string[] = [];
  for (let lag = 40; lag <= 160; lag++) {
    let c = 0;
    for (let i = 0; i + lag < hp.length; i++) c += hp[i] * hp[i + lag];
    c /= hp.length - lag;
    if ([64, 70, 72, 75, 80, 96, 100, 128, 144].includes(lag)) table.push(`${lag}: ${fmt(c, 2)}`);
    if (c > bestC) { bestC = c; best = lag; }
  }
  say(`${name}: autocorrelation of the darkness (lags 40..160) peaks at ${best} px (${fmt(bestC, 2)}); at ${table.join(", ")}`);
  return { best, score: bestC };
};
const px = period(colL, "columns"), py = period(rowL, "rows");
// The phase: the darkest residue of column index mod the period.
const phase = (v: Float64Array, p: number): { at: number; depth: number } => {
  const hp = highPass(v);
  const acc = new Float64Array(p), cnt = new Float64Array(p);
  for (let i = 0; i < hp.length; i++) { acc[i % p] += hp[i]; cnt[i % p]++; }
  let at = 0, min = Infinity;
  for (let r = 0; r < p; r++) { const m = acc[r] / cnt[r]; if (m < min) { min = m; at = r; } }
  return { at, depth: -min };
};
const phx = phase(colL, px.best), phy = phase(rowL, py.best);
say(`grid lines: columns every ${px.best} px, darkest at x = ${phx.at} mod ${px.best} (depth ${fmt(phx.depth, 2)}); rows every ${py.best} px, darkest at y = ${phy.at} mod ${py.best} (depth ${fmt(phy.depth, 2)})`);
say(`so the picture holds ${fmt(full.w / px.best, 2)} x ${fmt(full.h / py.best, 2)} squares; the .dd2vtt says ${vtt!.resolution.map_size.x} x ${vtt!.resolution.map_size.y} at ${vtt!.resolution.pixels_per_grid}: ${px.best === vtt!.resolution.pixels_per_grid && py.best === vtt!.resolution.pixels_per_grid && Math.round(full.w / px.best) === vtt!.resolution.map_size.x && Math.round(full.h / py.best) === vtt!.resolution.map_size.y ? "AGREE" : "DISAGREE"}; the lines sit at ${phx.at === 0 || phx.at === px.best - 1 ? "the square edges" : `${phx.at} px into the square`} (x) and ${phy.at === 0 || phy.at === py.best - 1 ? "the square edges" : `${phy.at} px into the square`} (y)`);

// Is it dotted? Along a grid column, the share of pixels that are darker than their neighbours off the line.
{
  const x = phx.at + px.best * 10;
  let dark = 0, n = 0;
  for (let y = 0; y < full.h; y++) {
    const on = luma(y * full.w + x), off = (luma(y * full.w + x - 3) + luma(y * full.w + x + 3)) / 2;
    n++;
    if (on < off - 12) dark++;
  }
  say(`along grid column x = ${x}: ${fmt((100 * dark) / n, 0)}% of its pixels are darker than 3 px either side by 12 or more (a solid line is near 100%, a dotted line much less)`);
}

// What the pixel path makes of it (today's guess): the colour classes and the analysis verdict.
{
  const T = colourTable();
  const W = vtt!.resolution.map_size.x * 24, H = vtt!.resolution.map_size.y * 24;
  const small = resample(full, W, H);
  let snow = 0, veg = 0, water = 0;
  for (let i = 0; i < W * H; i++) {
    const kk = lutIndex(small[i * 4], small[i * 4 + 1], small[i * 4 + 2]);
    if (T[kk + 3] >= 128) snow++;
    if (T[kk] >= 128) veg++;
    if (T[kk + 1] >= 128) water++;
  }
  say(`colour table at 24 px/sq: snow-coloured ${fmt((100 * snow) / (W * H), 1)}%, vegetation-coloured ${fmt((100 * veg) / (W * H), 1)}%, water-coloured ${fmt((100 * water) / (W * H), 1)}%`);
}

// A crop of the grid at the top-left corner, 4 x 3 squares at 2x, with the found grid drawn in red.
{
  const Z = 2;
  const tile = await baseTile(full, px.best, [0, 0, 4, 3], px.best * Z);
  const over = { rgba: tile.rgba.slice(), w: tile.w, h: tile.h };
  for (let gx = phx.at; gx < 4 * px.best; gx += px.best) for (let y = 0; y < over.h; y++) { const o = (y * over.w + gx * Z) * 4; over.rgba[o] = 255; over.rgba[o + 1] = 40; over.rgba[o + 2] = 40; }
  for (let gy = phy.at; gy < 3 * py.best; gy += py.best) for (let x = 0; x < over.w; x++) { const o = (gy * Z * over.w + x) * 4; over.rgba[o] = 255; over.rgba[o + 1] = 40; over.rgba[o + 2] = 40; }
  await sheet(`${OUT}/kdir-grid.png`, `Kdir Topside (export only): squares 0,0 to 4,3 at ${px.best * Z} px a square; right: the grid found in the picture (period ${px.best} x ${py.best} px) in red`,
    [[{ pic: tile, label: "As exported" }, { pic: over, label: "found grid" }]]);
  say(`crop: ${OUT}/kdir-grid.png`);
}
writeText(`${OUT}/kdir.txt`, lines.join("\n"));

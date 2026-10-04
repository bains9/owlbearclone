// M2, checklist 6.6 item 1 on waterfall's Dungeondraft 1.2 export: the terrain texel convention
// under smooth_blending false (the design's texel-check.ts, adapted to the project's modules), the
// export's sizing and origin, and the water body's classification (2.6) with a crop.
//
// Texel convention: texel (tx, ty) is centred at world ((tx + 0.5) * 64, (ty + 0.5) * 64) (design
// 3.3 [H]). Over the whole export at 24 px a square, the snow slot's 50% mask is compared with the
// picture's snow-coloured pixels (the colour table's snow channel) for shifts of the texel grid
// from -48 to +48 world units in steps of 8: the agreement must peak at 0. Then a zoomed crop with
// the 50% contour drawn for the centre convention (green) and the corner convention (red, +32).
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-texel.ts

import { GRID } from "../../src/client/dd/model";
import { sampleTerrainSlot, type RasterSpec } from "../../src/client/dd/ddRaster";
import { defaultName } from "../../src/client/dd/roles";
import { AR } from "../../src/client/dd/roles";
import { SIDECAR_UNITS } from "../../src/client/dd/sidecar";
import { colourTable, lutIndex } from "../../src/client/room/seasonPixels";
import type { PictureSample } from "../../src/client/dd/extract";
import { OUT, baseTile, fmt, loadFull, pair, pct, prepare, roundTrip, savePng, sheet, writeText, type Window } from "./m2-lib";
import { resample } from "../../src/client/dd/ddWorker";

const f = await loadFull(pair("waterfall"));
const L = f.map.world.levels[0];
const t = L.terrain!;
const snowSlot = t.slots.findIndex((s) => defaultName(s) === "terrain_snow");
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

// ---- sizing and origin
say(`export: ${f.full.w}x${f.full.h} px; .dd2vtt map_size ${f.vtt!.resolution.map_size.x}x${f.vtt!.resolution.map_size.y}, origin ${f.vtt!.resolution.map_origin.x},${f.vtt!.resolution.map_origin.y}, pixels_per_grid ${f.vtt!.resolution.pixels_per_grid}; map ${f.map.world.width}x${f.map.world.height}; ${f.full.w / f.vtt!.resolution.map_size.x} px/sq across, ${f.full.h / f.vtt!.resolution.map_size.y} down`);
say(`terrain: ${t.width}x${t.height} texels = ${t.width / f.map.world.width} a square, smooth_blending ${t.smoothBlending}, slots ${t.slots.map((s) => defaultName(s) ?? "pack").join(" | ")}, snow slot ${snowSlot}`);

// ---- texel convention, whole map at 24 px a square
const T = colourTable();
const PPS = 24;
const W = f.sqW * PPS, H = f.sqH * PPS;
const small = resample(f.full, W, H);
const snowy = new Uint8Array(W * H);
let nSnowy = 0;
for (let i = 0; i < W * H; i++) if (T[lutIndex(small[i * 4], small[i * 4 + 1], small[i * 4 + 2]) + 3] >= 128) { snowy[i] = 1; nSnowy++; }
say(`snow-coloured pixels at ${PPS} px/sq: ${pct(nSnowy / (W * H))} (the file: snow on ${pct(share(t, snowSlot))} of texels)`);
const agreement = (shiftX: number, shiftY: number): { agree: number; iou: number } => {
  const spec: RasterSpec = { width: W, height: H, originX: -shiftX, originY: -shiftY, unitsPerPx: GRID / PPS };
  const m = sampleTerrainSlot(t, snowSlot, spec);
  let both = 0, either = 0, agree = 0;
  for (let i = 0; i < W * H; i++) {
    const a = m[i] >= 128 ? 1 : 0, b = snowy[i];
    if (a === b) agree++;
    if (a && b) both++;
    if (a || b) either++;
  }
  return { agree: agree / (W * H), iou: both / either };
};
say(`\nagreement of the snow slot's 50% mask with the snow-coloured pixels, by shift of the texel grid (world units; 64 = one texel, 32 = the corner convention):`);
say(`shift      ${[-48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 48].map((s) => String(s).padStart(7)).join("")}`);
for (const axis of ["x", "y"] as const) {
  const row = [-48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 48].map((s) => {
    const r = axis === "x" ? agreement(s, 0) : agreement(0, s);
    return pct(r.iou).padStart(7);
  });
  say(`${axis} IoU      ${row.join("")}`);
}
const peak = [-48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 48].flatMap((sx) => [-16, -8, 0, 8, 16].map((sy) => ({ sx, sy, ...agreement(sx, sy) }))).sort((a, b) => b.iou - a.iou)[0];
say(`best shift over a grid: ${peak.sx},${peak.sy} (IoU ${pct(peak.iou)}); at 0,0: IoU ${pct(agreement(0, 0).iou)}, agreement ${pct(agreement(0, 0).agree)}`);

// ---- the zoomed crop (texel-check.ts): a window of 8 x 6 squares with a jagged snow/rock edge, at 72 px a square x 2
const win: Window = [20, 2, 8, 6];
const Z = 2;
const cpps = f.exportPps * Z;
const base = await baseTile(f.full, f.exportPps, win, cpps);
const out = { rgba: base.rgba.slice(), w: base.w, h: base.h };
const specAt = (shift: number): RasterSpec => ({ width: base.w, height: base.h, originX: win[0] * GRID - shift, originY: win[1] * GRID - shift, unitsPerPx: GRID / cpps });
const contour = (m: Uint8Array, c: [number, number, number]) => {
  const w = base.w, h = base.h;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const on = m[i] >= 128;
    if (!on) continue;
    if (m[i - 1] >= 128 && m[i + 1] >= 128 && m[i - w] >= 128 && m[i + w] >= 128) continue;
    for (const j of [i, i + 1, i + w]) { const o = j * 4; out.rgba[o] = c[0]; out.rgba[o + 1] = c[1]; out.rgba[o + 2] = c[2]; }
  }
};
contour(sampleTerrainSlot(t, snowSlot, specAt(32)), [255, 40, 40]);
contour(sampleTerrainSlot(t, snowSlot, specAt(0)), [40, 255, 40]);
await sheet(`${OUT}/waterfall-texel-check.png`, `waterfall 1.2 export, squares ${win[0]},${win[1]} to ${win[0] + win[2]},${win[1] + win[3]} at ${cpps} px a square: snow slot 50% contour, GREEN = texel centres at (t+0.5)*64 (the parser's), RED = corners (+32 units)`,
  [[{ pic: base, label: "As drawn" }, { pic: out, label: "contours" }]]);
say(`crop: ${OUT}/waterfall-texel-check.png`);

// ---- the water body (2.6) with a crop
const pr = await prepare(f, { compare: false });
const { sc } = await roundTrip(pr.sidecar);
const water = sc.shapes.filter((s) => s.layer === -50);
say(`\nwater: ${water.length} body, role ${water.map((s) => Object.entries(AR).find(([, v]) => v === s.role)?.[0]).join(",")}; report.water ${pr.report.water}; file deep_color ${JSON.stringify(L.water.root?.children[0]?.deepColor ?? null)} shallow ${JSON.stringify(L.water.root?.children[0]?.shallowColor ?? null)}`);
// Pixels inside the body at least a quarter square from its edge: how many pass the water test, the snow/ice test, and their median colour.
{
  const wW = f.sqW * PPS, wH = f.sqH * PPS;
  const Ly = (await import("../../src/client/dd/raster")).rasterSidecar(sc, { w: wW, h: wH });
  const km = Ly.area.get(water[0].role) ?? new Uint8Array(wW * wH);
  const inner = (await import("./m2-lib")).eroded(km, wW, wH, Math.round(PPS / 4));
  let n = 0, wet = 0, white = 0;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0; i < wW * wH; i++) {
    if (inner[i] < 128 || Ly.top[i]) continue;
    n++;
    const o = i * 4;
    const k = lutIndex(small[o], small[o + 1], small[o + 2]);
    if (T[k + 1] >= 128) wet++;
    if (T[k + 3] >= 128) white++;
    rs.push(small[o]); gs.push(small[o + 1]); bs.push(small[o + 2]);
  }
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
  say(`inside the body (${n} px at ${PPS} px/sq, a quarter square in, no objects): water-coloured ${pct(wet / n)}, snow/ice-coloured ${pct(white / n)}, median colour rgb(${med(rs)}, ${med(gs)}, ${med(bs)}) -> ${pr.report.water[0]} (WATER needs half water-coloured, ICE half snow- or ice-coloured)`);
}
{
  const cw: Window = [10, 12, 16, 12];
  const cb = await baseTile(f.full, f.exportPps, cw, 36);
  const ov = { rgba: cb.rgba.slice(), w: cb.w, h: cb.h };
  const Ly = (await import("../../src/client/dd/raster")).rasterSidecar(sc, { w: f.sqW * 36, h: f.sqH * 36 });
  const km = Ly.area.get(water[0].role)!;
  const WW = f.sqW * 36;
  for (let y = 1; y < cb.h - 1; y++) for (let x = 1; x < cb.w - 1; x++) {
    const gx = cw[0] * 36 + x, gy = cw[1] * 36 + y, i = gy * WW + gx;
    if (km[i] < 128) continue;
    if (km[i - 1] >= 128 && km[i + 1] >= 128 && km[i - WW] >= 128 && km[i + WW] >= 128) continue;
    const o = (y * cb.w + x) * 4;
    ov.rgba[o] = 40; ov.rgba[o + 1] = 90; ov.rgba[o + 2] = 255;
  }
  await sheet(`${OUT}/waterfall-water-crop.png`, `waterfall: the water body (squares 10,12 to 26,24 at 36 px a square): as drawn, and its outline from the sidecar (blue); classified ${pr.report.water[0]} by 2.6`,
    [[{ pic: cb, label: "As drawn" }, { pic: ov, label: `body outline; role ${pr.report.water[0]}` }]]);
  say(`water crop: ${OUT}/waterfall-water-crop.png`);
}
writeText(`${OUT}/waterfall-texel-check.txt`, lines.join("\n"));

function share(tt: NonNullable<typeof L.terrain>, slot: number): number {
  const n = tt.width * tt.height;
  let s = 0;
  for (let i = 0; i < n; i++) s += tt.weights[slot * n + i];
  return s / (255 * n);
}

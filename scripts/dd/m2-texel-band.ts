// M2, 6.6 item 1: the texel convention measured where it matters, at the painted snow edges. At 36
// px a square (a texel is 9 px) over waterfall's 1.2 export, the band of pixels within 2 px of the
// picture's own snow / not-snow boundary, outside objects, cliffs and water (the round-tripped
// sidecar says where those are), is compared with the snow slot's 50% mask for shifts of the texel
// grid from -48 to +48 world units (a texel is 64; the corner convention is +32). The agreement
// must peak at 0 for the centre convention.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-texel-band.ts

import { GRID } from "../../src/client/dd/model";
import { sampleTerrainSlot, type RasterSpec } from "../../src/client/dd/ddRaster";
import { defaultName } from "../../src/client/dd/roles";
import { rasterSidecar } from "../../src/client/dd/raster";
import { AR } from "../../src/client/dd/roles";
import { colourTable, lutIndex } from "../../src/client/room/seasonPixels";
import { resample } from "../../src/client/dd/ddWorker";
import { OUT, loadFull, pair, pct, prepare, roundTrip, writeText } from "./m2-lib";
import { appendFileSync } from "node:fs";

const f = await loadFull(pair("waterfall"));
const t = f.map.world.levels[0].terrain!;
const snowSlot = t.slots.findIndex((s) => defaultName(s) === "terrain_snow");
const pr = await prepare(f, { compare: false });
const { sc } = await roundTrip(pr.sidecar);
const PPS = 36;
const W = f.sqW * PPS, H = f.sqH * PPS, N = W * H;
const pic = resample(f.full, W, H);
const T = colourTable();
const snowy = new Uint8Array(N);
for (let i = 0; i < N; i++) snowy[i] = T[lutIndex(pic[i * 4], pic[i * 4 + 1], pic[i * 4 + 2]) + 3] >= 128 ? 1 : 0;
const Ly = rasterSidecar(sc, { w: W, h: H });
const zero = new Uint8Array(N);
const keepA = Ly.area.get(AR.KEEP) ?? zero, pathKeep = Ly.area.get(AR.PATH_KEEP) ?? zero, rim = Ly.area.get(AR.CAVE_RIM) ?? zero, cave = Ly.area.get(AR.CAVE) ?? zero;
// The band: within R px of a snow / not-snow boundary in the picture, clear of objects and kept areas (grown by 3 px).
const R = 2, CLEAR = 3;
const band = new Uint8Array(N);
let nBand = 0;
for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
  const i = y * W + x;
  let clear = true;
  for (let dy = -CLEAR; clear && dy <= CLEAR; dy++) for (let dx = -CLEAR; clear && dx <= CLEAR; dx++) {
    const j = (y + dy) * W + x + dx;
    if (j < 0 || j >= N) continue;
    if (Ly.top[j] || keepA[j] >= 64 || pathKeep[j] >= 64 || rim[j] >= 64 || cave[j] >= 64) clear = false;
  }
  if (!clear) continue;
  let edge = false;
  for (let dy = -R; !edge && dy <= R; dy++) for (let dx = -R; !edge && dx <= R; dx++) if (snowy[(y + dy) * W + x + dx] !== snowy[i]) edge = true;
  if (edge) { band[i] = 1; nBand++; }
}
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
say(`edge band at ${PPS} px/sq: ${nBand} px (${pct(nBand / N, 2)} of the map), within ${R} px of the picture's snow boundary, ${CLEAR} px clear of objects, cliffs, cave and water`);
const agree = (sx: number, sy: number): number => {
  const spec: RasterSpec = { width: W, height: H, originX: -sx, originY: -sy, unitsPerPx: GRID / PPS };
  const m = sampleTerrainSlot(t, snowSlot, spec);
  let k = 0;
  for (let i = 0; i < N; i++) if (band[i] && (m[i] >= 128 ? 1 : 0) === snowy[i]) k++;
  return k / nBand;
};
const SHIFTS = [-48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 48];
say(`shift (world units)  ${SHIFTS.map((s) => String(s).padStart(7)).join("")}`);
say(`agreement, x shift   ${SHIFTS.map((s) => pct(agree(s, 0)).padStart(7)).join("")}`);
say(`agreement, y shift   ${SHIFTS.map((s) => pct(agree(0, s)).padStart(7)).join("")}`);
say(`agreement, both      ${SHIFTS.map((s) => pct(agree(s, s)).padStart(7)).join("")}`);
let best = { s: 0, v: 0 };
for (const s of SHIFTS) { const v = agree(s, s); if (v > best.v) best = { s, v }; }
say(`best diagonal shift: ${best.s} (centre convention is 0, corner convention is 32): ${best.s === 0 ? "the parser's texel-centre convention holds" : "CHECK"}`);
appendFileSync(`${OUT}/waterfall-texel-check.txt`, "\n\n" + lines.join("\n"));

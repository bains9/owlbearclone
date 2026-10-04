// M2, item 7: a reference sheet of Vern's own swamp bridge, summer and winter (he drew the winter
// one himself; exports only, no project file), beside what the engine makes of each through the
// pixel path (today's guess: no raw file, so no exact data). Observations only.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-swamp.ts

import { existsSync } from "node:fs";
import type { PictureSample } from "../../src/client/dd/extract";
import type { SeasonLook } from "../../src/shared/types";
import { LEVELS, LEVEL_NAME, LOOKS, OUT, baseTile, bakeTile, fmt, loadVern, pixelAnalysis, sceneOf, sheet, writeText, type Tile, type Window } from "./m2-lib";
import { VERN } from "./lib";

const NAMES = ["swampbridge-summer.vtt", "swampbridge-winter.vtt"];
if (!NAMES.every((n) => existsSync(`${VERN}/${n}.dd2vtt`))) { console.log("swamp bridge exports missing: skipped"); process.exit(0); }
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

const vs = await Promise.all(NAMES.map((n) => loadVern(n)));
const sq = vs[0].vtt!.resolution.map_size;
const pps = Math.max(8, Math.min(24, Math.floor(600 / sq.x)));
const win: Window = [0, 0, sq.x, sq.y];
const baked: Array<{ base: PictureSample; looks: Record<string, PictureSample> }> = [];
for (const [i, v] of vs.entries()) {
  say(`${NAMES[i]}: ${v.full.w}x${v.full.h}, ${sq.x}x${sq.y} squares at ${fmt(v.pps, 1)} px/sq`);
  const s = sceneOf(v.full, v.pps);
  const a = pixelAnalysis(s);
  say(`  pixel analyse(): ${a.snow ? "snowy" : "green"}, ${a.nCrowns} crowns, frac ${fmt(a.frac, 2)}${a.snow ? ` (nTrees ${a.snow.nTrees})` : ""}`);
  const base = await baseTile(v.full, v.pps, win, pps);
  const looks: Record<string, PictureSample> = {};
  for (const look of LOOKS) for (const level of LEVELS) looks[`${look}${level}`] = bakeTile(base, s, v.pps, win, a, look as SeasonLook, level);
  baked.push({ base, looks });
}
const rows: Tile[][] = [[{ pic: baked[0].base, label: "Vern's summer export, as drawn" }, { pic: baked[1].base, label: "Vern's winter export, as drawn (drawn by hand)" }]];
for (const look of LOOKS) {
  rows.push([
    ...LEVELS.map((lv): Tile => ({ pic: baked[0].looks[`${look}${lv}`], label: `summer export, pixel path: ${look} ${LEVEL_NAME[look][lv - 1]}` })),
  ]);
  rows.push([
    ...LEVELS.map((lv): Tile => ({ pic: baked[1].looks[`${look}${lv}`], label: `winter export, pixel path: ${look} ${LEVEL_NAME[look][lv - 1]}` })),
  ]);
}
const path = `${OUT}/swampbridge-reference.png`;
await sheet(path, `swamp bridge: Vern's summer and winter exports (top), and the pixel path's 12 looks from each (no project file: today's guess); ${pps} px a square`, rows);
say(`sheet: ${path}`);
// A crop of the bridge at a readable size: the middle 12 x 9 squares, As drawn against winter L2 and summer Dry from each.
{
  const cw: Window = [Math.floor(sq.x / 2) - 6, Math.floor(sq.y / 2) - 4, 12, 9];
  const crop: Tile[][] = [];
  for (const [i, v] of vs.entries()) {
    const s = sceneOf(v.full, v.pps);
    const a = pixelAnalysis(s);
    const base = await baseTile(v.full, v.pps, cw, 30);
    crop.push([
      { pic: base, label: `${i ? "winter" : "summer"} export, as drawn` },
      { pic: bakeTile(base, s, v.pps, cw, a, "winter", 2), label: "pixel: winter L2" },
      { pic: bakeTile(base, s, v.pps, cw, a, "summer", 2), label: "pixel: summer Dry" },
      { pic: bakeTile(base, s, v.pps, cw, a, "autumn", 2), label: "pixel: autumn Autumn" },
    ]);
  }
  await sheet(`${OUT}/swampbridge-crop.png`, `swamp bridge: squares ${cw[0]},${cw[1]} to ${cw[0] + cw[2]},${cw[1] + cw[3]} at 30 px a square`, crop);
  say(`crop: ${OUT}/swampbridge-crop.png`);
}
writeText(`${OUT}/swampbridge.txt`, lines.join("\n"));

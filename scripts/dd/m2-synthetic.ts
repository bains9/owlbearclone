// M2, 7.0 step 4: the synthetic snowy map (WP9's snowyMap) and its fake export, end to end through
// the code the browser runs (parse, rankLevels, extractSidecar, encodeSidecar, packPng, unpackPng,
// decodeSidecar, rasterSidecar, analyseExact, bake), and the extractor's sidecar compared with
// WP9's hand-built one: META, the terrain planes, the shapes and bitmaps (by role and layer, and
// as rasters), the objects (role, layer, centre, flags, reach), and the bakes made from each.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-synthetic.ts

import { parseDungeondraftMap } from "../../src/client/dd/parse";
import { GRID } from "../../src/client/dd/model";
import { chooseLevel, extractSidecar, pictureRect, rankLevels } from "../../src/client/dd/extract";
import { decodeSidecar, encodeSidecar, OBJ_FLAG, SIDECAR_UNITS, type SeasonSidecar } from "../../src/client/dd/sidecar";
import { packPng, unpackPng } from "../../src/client/dd/pngBox";
import { rasterSidecar } from "../../src/client/dd/raster";
import { AR, OR, TR } from "../../src/client/dd/roles";
import { analyseExact } from "../../src/client/room/seasonExact";
import { bake } from "../../src/client/room/seasonPixels";
import { analysisGeometry, seasonSquare } from "../../src/client/room/seasons";
import { resample } from "../../src/client/dd/ddWorker";
import { FIXTURE_SPRITES, snowyMap } from "../../test/fixtures/ddSynthetic";
import { fakeExportFromMap } from "../../test/fixtures/fakeExport";
import { OUT, fmt, pct, sheet, writeText } from "./m2-lib";

const RN: Record<number, string> = Object.fromEntries(Object.entries(OR).map(([k, v]) => [v, k]));
const AN: Record<number, string> = Object.fromEntries(Object.entries(AR).map(([k, v]) => [v, k]));
const TN: Record<number, string> = Object.fromEntries(Object.entries(TR).map(([k, v]) => [v, k]));
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

const sm = snowyMap();
const map = parseDungeondraftMap(sm.text);
const PPS = 32;
const pic = fakeExportFromMap(map, sm.levelKey, PPS);
const rect = pictureRect(map, pic.w, pic.h);
if ("error" in rect) throw new Error(rect.error);
const ranks = rankLevels(map, pic, rect);
const choice = chooseLevel(ranks);
say(`synthetic snowy map ${sm.w}x${sm.h}, fake export ${pic.w}x${pic.h} at ${PPS} px/sq: levels ${ranks.map((l) => `${l.key}:${l.label}(${l.why}, fit ${l.fit?.verdict})`).join("; ")} -> ${choice?.key} (clear ${choice?.clear})`);
const t0 = performance.now();
const ex = extractSidecar(map, choice!.key, rect, pic, FIXTURE_SPRITES, { levels: ranks });
say(`extractSidecar ${fmt(performance.now() - t0, 1)} ms: fit ${ex.report.fit.verdict} (lead ${fmt(ex.report.fit.lead, 2)}, sharp ${fmt(ex.report.fit.sharp, 2)}), snowShare ${fmt(ex.report.snowShare, 3)} -> ${ex.report.drawn}, dropped ${ex.report.dropped}, packs ${ex.report.packItems}, water ${ex.report.water.join(",")}, warnings: ${ex.report.warnings.join(" | ") || "none"}`);
const bytes = encodeSidecar(ex.sidecar);
const { blob } = await packPng(bytes);
const back = await unpackPng(blob);
const len = new DataView(back.buffer, back.byteOffset, back.byteLength).getUint32(8, true);
const sc = decodeSidecar(back.slice(0, 16 + len));
const same = bytes.length === back.slice(0, 16 + len).length && bytes.every((v, i) => v === back[i]);
say(`encode ${bytes.length} B, PNG ${blob.size} B, unpack == encoded: ${same}`);
const hb = sm.sidecar;

// ---- META
say(`\nMETA extractor: ${JSON.stringify(sc.meta)}`);
say(`META hand:      ${JSON.stringify(hb.meta)}`);

// ---- terrain
if (sc.terrain && hb.terrain) {
  const a = sc.terrain, b = hb.terrain;
  say(`\nTERR extractor: tps ${a.tps}, ${a.tw}x${a.th} at ${a.tx0},${a.ty0}, slots ${a.slots.map((s) => `${s.name === 0xffff ? "pack" : sc.meta.names[s.name]}:${TN[s.role]}`).join(" ")}`);
  say(`TERR hand:      tps ${b.tps}, ${b.tw}x${b.th} at ${b.tx0},${b.ty0}, slots ${b.slots.map((s) => `${s.name === 0xffff ? "pack" : hb.meta.names[s.name]}:${TN[s.role]}`).join(" ")}`);
  if (a.tw === b.tw && a.th === b.th && a.slots.length === b.slots.length) {
    const n = a.tw * a.th;
    for (let s = 0; s < a.slots.length; s++) {
      let diff = 0, maxd = 0;
      for (let i = 0; i < n; i++) { const d = Math.abs(a.w[s * n + i] - b.w[s * n + i]); if (d) diff++; if (d > maxd) maxd = d; }
      say(`  slot ${s}: ${diff} of ${n} texels differ (largest difference ${maxd})`);
    }
  } else say("  (different crops or slot counts: compared as rasters below)");
}

// ---- shapes and bitmaps, by role and layer
const tally = (s: SeasonSidecar) => {
  const m: Record<string, { n: number; rings: number; pts: number }> = {};
  for (const sh of s.shapes) {
    const k = `${AN[sh.role]}@${sh.layer} rule ${sh.rule}`;
    const e = (m[k] ??= { n: 0, rings: 0, pts: 0 });
    e.n++; e.rings += sh.ringEnds.length; e.pts += sh.pts.length / 2;
  }
  for (const b of s.bitmaps) {
    const k = `BITS ${AN[b.role]}@${b.layer} step ${b.step}`;
    const e = (m[k] ??= { n: 0, rings: 0, pts: 0 });
    e.n++; e.pts += b.w * b.h;
  }
  return m;
};
say(`\nSHAP/BITS extractor: ${Object.entries(tally(sc)).map(([k, v]) => `${k}: ${v.n} (${v.rings} rings, ${v.pts} pts)`).join("; ")}`);
say(`SHAP/BITS hand:      ${Object.entries(tally(hb)).map(([k, v]) => `${k}: ${v.n} (${v.rings} rings, ${v.pts} pts)`).join("; ")}`);

// ---- rasters: IoU per terrain, area and object role at 16 px a square
const w = sm.w * 16, h = sm.h * 16;
const A = rasterSidecar(sc, { w, h }), B = rasterSidecar(hb, { w, h });
const iou = (a: Uint8Array | undefined, b: Uint8Array | undefined, thr = 128): string => {
  const z = new Uint8Array(w * h);
  a ??= z; b ??= z;
  let both = 0, either = 0, na = 0, nb = 0;
  for (let i = 0; i < w * h; i++) {
    const x = a[i] >= thr, y = b[i] >= thr;
    if (x) na++; if (y) nb++;
    if (x && y) both++;
    if (x || y) either++;
  }
  return either ? `IoU ${pct(both / either)} (${na} vs ${nb} px)` : "both empty";
};
say(`\nrasters at 16 px/sq (extractor vs hand):`);
for (const r of new Set([...A.terrain.keys(), ...B.terrain.keys()])) say(`  terrain ${TN[r]}: ${iou(A.terrain.get(r), B.terrain.get(r))}`);
for (const r of new Set([...A.area.keys(), ...B.area.keys()])) say(`  area ${AN[r]}: ${iou(A.area.get(r), B.area.get(r))}`);
for (const r of new Set([...A.objects.keys(), ...B.objects.keys()])) say(`  objects ${RN[r]}: ${iou(A.objects.get(r), B.objects.get(r))}`);

// ---- objects one by one
say(`\nobjects (extractor ${sc.objects.n}, hand ${hb.objects.n}):`);
const reachOf = (s: SeasonSidecar, i: number) => Array.from(s.objects.reach.subarray(i * 16, i * 16 + 16), (v) => v / SIDECAR_UNITS.reach);
for (let i = 0; i < Math.max(sc.objects.n, hb.objects.n); i++) {
  const a = i < sc.objects.n ? sc.objects : null, b = i < hb.objects.n ? hb.objects : null;
  const nm = (s: SeasonSidecar, o: typeof sc.objects) => (o.name[i] !== 0xffff ? s.meta.names[o.name[i]] : "-");
  const pos = (o: typeof sc.objects) => `(${fmt(o.x[i] / SIDECAR_UNITS.coord / GRID, 2)},${fmt(o.y[i] / SIDECAR_UNITS.coord / GRID, 2)})`;
  let reach = "";
  if (a && b) {
    const ra = reachOf(sc, i), rb = reachOf(hb, i);
    const ratios = ra.map((v, k) => (rb[k] ? v / rb[k] : NaN)).filter((v) => !Number.isNaN(v));
    const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    reach = `reach ratio mean ${fmt(mean, 2)} (min ${fmt(Math.min(...ratios), 2)}, max ${fmt(Math.max(...ratios), 2)})`;
  }
  say(`  #${i}: extractor ${a ? `${RN[a.role[i]]}@${a.layer[i]} ${nm(sc, a)} ${pos(a)} rot ${a.rot[i]} flags ${a.flags[i]}${a.flags[i] & OBJ_FLAG.MEASURED ? " measured" : " prior"}` : "-"}; hand ${b ? `${RN[b.role[i]]}@${b.layer[i]} ${nm(hb, b)} ${pos(b)} rot ${b.rot[i]} flags ${b.flags[i]}` : "-"}; ${reach}`);
}

// ---- the analyses and bakes from each sidecar, at the browser's geometry for this picture
const square = seasonSquare(pic.w, pic.h, PPS);
const g = analysisGeometry(pic.w, pic.h, square);
const small = resample(pic, g.aw, g.ah);
const aA = analyseExact(small, g.aw, g.ah, g.cellA, sc, {}), aB = analyseExact(small, g.aw, g.ah, g.cellA, hb, {});
say(`\nanalyseExact: extractor ${aA.snow!.nTrees} trees frac ${fmt(aA.frac, 2)}; hand ${aB.snow!.nTrees} trees frac ${fmt(aB.frac, 2)}`);
const tiles: Array<{ pic: { rgba: Uint8ClampedArray; w: number; h: number }; label: string }[]> = [];
for (const [look, level] of [["spring", 2], ["summer", 2], ["autumn", 2], ["winter", 3]] as const) {
  const outA = pic.rgba.slice(), outB = pic.rgba.slice();
  const o = { x0: 0, y0: 0, scale: 1, cell: square, seed: 1, look, level, sceneW: pic.w, sceneH: pic.h } as const;
  bake(outA, pic.w, pic.h, { ...o, a: aA });
  bake(outB, pic.w, pic.h, { ...o, a: aB });
  let diff = 0, big = 0;
  for (let i = 0; i < pic.w * pic.h; i++) {
    const d = Math.abs(outA[i * 4] - outB[i * 4]) + Math.abs(outA[i * 4 + 1] - outB[i * 4 + 1]) + Math.abs(outA[i * 4 + 2] - outB[i * 4 + 2]);
    if (d > 6) diff++;
    if (d > 60) big++;
  }
  say(`bake ${look} L${level}: ${pct(diff / (pic.w * pic.h), 2)} of pixels differ by more than 6 (sum of RGB), ${pct(big / (pic.w * pic.h), 2)} by more than 60`);
  tiles.push([{ pic: { rgba: pic.rgba, w: pic.w, h: pic.h }, label: "fake export" }, { pic: { rgba: outA, w: pic.w, h: pic.h }, label: `extractor's sidecar: ${look} L${level}` }, { pic: { rgba: outB, w: pic.w, h: pic.h }, label: `hand-built sidecar: ${look} L${level}` }]);
}
await sheet(`${OUT}/synthetic-sheet.png`, "synthetic snowy map (WP9) and its fake export: bakes from the extractor's sidecar against WP9's hand-built one", tiles);
say(`sheet: ${OUT}/synthetic-sheet.png`);
writeText(`${OUT}/synthetic.txt`, lines.join("\n"));

// M2: the attach path end to end on the real pairs, through the worker's own handler: parse, level
// ranking, fit, measurement, compile, encode (prepare); packPng, fetch through SidecarCache,
// unpackPng, decodeSidecar (round trip); analyseExact or the fallback to analyse() (the seasons
// worker's rule). Prints the report every pair would show the GM, the round trip's checks, and
// where waterfall's things are (to pick the crop windows of the contact sheets).
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-attach.ts [pair ...]

import { GRID } from "../../src/client/dd/model";
import { AR, OR } from "../../src/client/dd/roles";
import { SIDECAR_UNITS, decodeSidecar, encodeSidecar } from "../../src/client/dd/sidecar";
import { isSnowy } from "../../src/client/room/seasonExact";
import { sceneDataState, SidecarCache } from "../../src/client/room/mapData";
import { GREEN, SNOWY, exactOrReason, havePair, loadFull, pair, pixelAnalysis, pct, prepare, roundTrip, sceneOf, fmt } from "./m2-lib";

const want = process.argv.slice(2).length ? process.argv.slice(2) : [...SNOWY, ...GREEN];
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const RN: Record<number, string> = Object.fromEntries(Object.entries(OR).map(([k, v]) => [v, k]));
const AN: Record<number, string> = Object.fromEntries(Object.entries(AR).map(([k, v]) => [v, k]));

for (const name of want) {
  const p = pair(name);
  if (!havePair(p)) { console.log(`\n== ${name}: files missing, skipped`); continue; }
  const f = await loadFull(p);
  console.log(`\n== ${name}: ${f.full.w}x${f.full.h}, ${f.sqW}x${f.sqH} squares, ${fmt(f.exportPps, 2)} px/sq, ${f.vtt ? `dd2vtt origin ${f.vtt.resolution.map_origin.x},${f.vtt.resolution.map_origin.y}` : "plain picture"}`);
  const pr = await prepare(f);
  const r = pr.report;
  console.log(`  prepare ${fmt(pr.ms, 0)} ms; progress: ${pr.progress.filter((s, i, a) => a.indexOf(s) === i).join(" | ")}`);
  console.log(`  levels: ${r.levels.map((l) => `${l.key}:${l.label}(${l.why}${l.vttScore !== undefined ? `, vtt ${fmt(l.vttScore, 2)}` : ""}${l.fit ? `, fit ${l.fit.verdict}` : ""})`).join("; ")} -> level ${r.level}${r.hold ? `, HOLD (${r.hold})` : ""}`);
  console.log(`  fit: ${r.fit.verdict} lead ${fmt(r.fit.lead, 3)} sharp ${fmt(r.fit.sharp, 3)} best ${r.fit.best} objects ${r.fit.objects}${r.shifted ? ` shifted ${r.shifted}` : ""}`);
  console.log(`  grid ${fmt(r.gridPxPerSquare, 2)} px/sq; snowShare ${fmt(r.snowShare, 3)} -> ${r.drawn}; packs: ${r.packItems} things, ${r.packPaths} paths, share ${pct(r.packShare)} (${r.packNames.join(", ") || "none"}); dropped ${r.dropped} of ${r.dropped + r.objects}; water ${r.water.join(",") || "-"}; lowRes ${r.lowRes}`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  console.log(`  sidecar ${pr.sidecar.length} bytes encoded`);

  // Round trip.
  const rt = await roundTrip(pr.sidecar);
  const scDirect = decodeSidecar(pr.sidecar);
  const reenc = encodeSidecar(rt.sc);
  console.log(`  PNG box ${rt.pngBytes} bytes; cache bytes == posted: ${same(rt.bytes, pr.sidecar)}; unpackPng == posted: ${same(rt.direct, pr.sidecar)}; re-encode of the decoded == posted: ${same(reenc, pr.sidecar)}; decoded meta equal: ${JSON.stringify(rt.sc.meta) === JSON.stringify(scDirect.meta)}`);
  const sc = rt.sc;
  console.log(`  META: rect ${sc.meta.rect} (squares ${(sc.meta.rect[2] - sc.meta.rect[0]) / GRID}x${(sc.meta.rect[3] - sc.meta.rect[1]) / GRID}), squares ${sc.meta.squares}, extractor ${sc.meta.extractor}, snowShare ${sc.meta.snowShare}, packShare ${sc.meta.packShare}, packItems ${sc.meta.packItems}, dropped ${sc.meta.dropped}, names ${sc.meta.names.length}`);
  console.log(`  TERR: ${sc.terrain ? `tps ${sc.terrain.tps}, ${sc.terrain.tw}x${sc.terrain.th} at ${sc.terrain.tx0},${sc.terrain.ty0}, slots ${sc.terrain.slots.length}` : "none"}; BITS ${sc.bitmaps.map((b) => `${AN[b.role]}@${b.layer}`).join(",") || "-"}; SHAP ${sc.shapes.length}: ${Object.entries(sc.shapes.reduce((m: Record<string, number>, s) => { const k = `${AN[s.role]}@${s.layer}`; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k}x${v}`).join(" ")}`);
  const roles: Record<string, number> = {};
  for (let i = 0; i < sc.objects.n; i++) roles[RN[sc.objects.role[i]]] = (roles[RN[sc.objects.role[i]]] ?? 0) + 1;
  console.log(`  OBJS ${sc.objects.n}: ${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  // The runtime's verdict on the main thread (sceneDataState) and in the worker (analyseExact or the fallback).
  const snowy = isSnowy(sc.meta);
  const cache = new SidecarCache(() => {});
  (cache as unknown as { entries: Map<string, unknown> }).entries.set("asset", { state: "ok", roomId: "room", failures: 0, bytes: rt.bytes, meta: sc.meta });
  const st = sceneDataState({ mapAssetId: "pic", mapData: { assetId: "asset", forAssetId: "pic" } }, cache, new Set());
  const s = sceneOf(f.full, f.exportPps);
  const ex = exactOrReason(s, sc);
  const px = pixelAnalysis(s);
  console.log(`  runtime: snowy ${snowy}, sceneDataState ${st}; analysis ${s.aw}x${s.ah} cellA ${fmt(s.cellA, 2)}: exact ${ex.a ? `ok (${ex.a.snow!.nTrees} trees, frac ${fmt(ex.a.frac, 2)})` : `REFUSED: ${ex.reason}`}; pixel analyse(): ${px.snow ? "snowy" : "green"} (${px.nCrowns} crowns, frac ${fmt(px.frac, 2)})`);
  if (pr.compare) console.log(`  compare: ${pr.compare.exact.w}x${pr.compare.exact.h}, exact is the guess: ${pr.compare.exact.rgba === pr.compare.guessed.rgba || same(pr.compare.exact.rgba as unknown as Uint8Array, pr.compare.guessed.rgba as unknown as Uint8Array)}`);

  if (name === "waterfall" || process.argv.includes("--where")) {
    const o = sc.objects;
    const by: Record<string, string[]> = {};
    for (let i = 0; i < o.n; i++) {
      const rn = RN[o.role[i]];
      const x = o.x[i] / SIDECAR_UNITS.coord / GRID, y = o.y[i] / SIDECAR_UNITS.coord / GRID;
      let reach = 0;
      for (let k = 0; k < 16; k++) reach += o.reach[i * 16 + k] / SIDECAR_UNITS.reach / GRID / 16;
      const nm = o.name[i] !== 0xffff ? sc.meta.names[o.name[i]].split("/").pop() : "";
      (by[rn] ??= []).push(`#${i} ${nm} (${fmt(x)},${fmt(y)}) r${fmt(reach, 2)}${o.flags[i] & 2 ? " capped" : ""}${o.flags[i] & 8 ? "" : " prior"}`);
    }
    for (const [k, v] of Object.entries(by)) console.log(`    ${k}: ${v.join("; ")}`);
    for (const sh of sc.shapes) {
      if (sh.role !== AR.WATER && sh.role !== AR.ICE && !(sh.role === AR.KEEP && sh.layer === -50)) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < sh.pts.length; i += 2) {
        const x = sh.pts[i] / SIDECAR_UNITS.coord / GRID, y = sh.pts[i + 1] / SIDECAR_UNITS.coord / GRID;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      console.log(`    water body ${AN[sh.role]}@${sh.layer}: ${sh.ringEnds.length} rings, bbox (${fmt(x0)},${fmt(y0)})-(${fmt(x1)},${fmt(y1)}) squares`);
    }
  }
}

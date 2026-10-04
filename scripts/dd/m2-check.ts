// M2 spot checks on things the contact sheets raised:
// - Pelcs: its snow objects by layer and what lies under each one's centre (roof, wall, floor,
//   ground); a zoom of the house's walls, As drawn against summer Dry and winter L3, with the
//   pixels that change at summer Dry marked; what the "indoor changed" pixels are.
// - cavern: the mottled open snow by the cave wall (squares 4,8 to 12,16): the snow weight, the
//   colour table's snow class and the change at summer Dry, pixel by pixel; the pools' colours
//   against the water-colour test (2.6).
// - waterfall: the shore blend measured in the picture (6.6 item 3, blend_distance 1.5): the ring
//   colours inside the body by distance from its edge.
// - Tulgi: FLOOR outside the round hut's wall loop (the floorShape fix).
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-check.ts

import { GRID } from "../../src/client/dd/model";
import { AR, OR, TR } from "../../src/client/dd/roles";
import { rasterSidecar } from "../../src/client/dd/raster";
import { fillPolygons, type RasterSpec } from "../../src/client/dd/ddRaster";
import { NO_NAME, SIDECAR_UNITS, type ObjectTable, type SeasonSidecar } from "../../src/client/dd/sidecar";
import { objectRole } from "../../src/client/dd/roles";
import { exactLayers } from "../../src/client/room/seasonExact";
import { colourTable, lutIndex } from "../../src/client/room/seasonPixels";
import { resample } from "../../src/client/dd/ddWorker";
import type { PictureSample } from "../../src/client/dd/extract";
import { OUT, baseTile, bakeTile, differs, eroded, exactOrReason, fmt, loadFull, median, pair, pct, prepare, roundTrip, sceneOf, sheet, writeText, type Window } from "./m2-lib";

const AN: Record<number, string> = Object.fromEntries(Object.entries(AR).map(([k, v]) => [v, k]));
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };
const T = colourTable();
const NO_OBJECTS: ObjectTable = {
  n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0),
  flags: new Uint8Array(0), name: new Uint16Array(0), reach: new Uint16Array(0),
};
const runtimeRole = (sc: SeasonSidecar, i: number) => (sc.objects.name[i] !== NO_NAME ? objectRole(sc.meta.names[sc.objects.name[i]]) : sc.objects.role[i]);

async function load(name: string) {
  const f = await loadFull(pair(name));
  const pr = await prepare(f, { compare: false });
  const { sc } = await roundTrip(pr.sidecar);
  const s = sceneOf(f.full, f.exportPps);
  return { f, pr, sc, s, a: exactOrReason(s, sc).a! };
}

// ---------------------------------------------------------------- Pelcs
{
  const { f, sc, s, a } = await load("pelcs");
  say(`== pelcs`);
  const pps = 24, W = f.sqW * pps, H = f.sqH * pps;
  const ground = rasterSidecar({ ...sc, objects: NO_OBJECTS }, { w: W, h: H });
  const under = (x: number, y: number): string => {
    const px = Math.floor(((x - sc.meta.rect[0]) / (sc.meta.rect[2] - sc.meta.rect[0])) * W), py = Math.floor(((y - sc.meta.rect[1]) / (sc.meta.rect[3] - sc.meta.rect[1])) * H);
    const i = py * W + px;
    if (i < 0 || i >= W * H) return "outside";
    for (const r of [AR.ROOF, AR.WALL, AR.FLOOR, AR.KEEP, AR.PATH_EARTH]) if ((ground.area.get(r)?.[i] ?? 0) >= 128) return AN[r];
    return "ground";
  };
  const tally: Record<string, number> = {};
  for (let i = 0; i < sc.objects.n; i++) {
    if (runtimeRole(sc, i) !== OR.SNOW) continue;
    const k = `layer ${sc.objects.layer[i]} over ${under(sc.objects.x[i] / SIDECAR_UNITS.coord, sc.objects.y[i] / SIDECAR_UNITS.coord)}`;
    tally[k] = (tally[k] ?? 0) + 1;
  }
  say(`  snow objects by layer and what lies under their centres: ${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  // Indoor pixels that change at summer Dry, at the sheet's tile size: under a roof-layer snow object, under a wall, else.
  const tw = 480, th = 384;
  const base = await baseTile(f.full, f.exportPps, [0, 0, f.sqW, f.sqH], tw / f.sqW);
  const out = bakeTile(base, s, f.exportPps, [0, 0, f.sqW, f.sqH], a, "summer", 2);
  const EL = exactLayers(sc, tw, th);
  const highSnow = rasterSidecar({ ...sc, objects: filterObjects(sc.objects, (i) => sc.objects.layer[i] >= 800 && runtimeRole(sc, i) === OR.SNOW), bitmaps: [], shapes: [] }, { w: tw, h: th });
  const wall = EL.layers.area.get(AR.WALL) ?? new Uint8Array(tw * th);
  let n = 0, snowy = 0, onWall = 0, rest = 0;
  for (let i = 0; i < tw * th; i++) {
    if (EL.indoor[i] < 128 || !differs(base, out, i, 2)) continue;
    n++;
    if (highSnow.top[i]) snowy++;
    else if (wall[i] >= 128) onWall++;
    else rest++;
  }
  say(`  indoor pixels changed at summer Dry (${tw}x${th}): ${n}: under a snow object at layer >= 800 ${snowy}, on a wall ${onWall}, elsewhere ${rest}`);
  // The zoom.
  const win: Window = [1, 3, 6, 5];
  const Z = 72;
  const zb = await baseTile(f.full, f.exportPps, win, Z);
  const zs = bakeTile(zb, s, f.exportPps, win, a, "summer", 2);
  const zw = bakeTile(zb, s, f.exportPps, win, a, "winter", 3);
  const mark = { rgba: zb.rgba.slice(), w: zb.w, h: zb.h };
  for (let i = 0; i < zb.w * zb.h; i++) if (differs(zb, zs, i, 6)) { const o = i * 4; mark.rgba[o] = 255; mark.rgba[o + 1] = 40; mark.rgba[o + 2] = 40; }
  await sheet(`${OUT}/pelcs-zoom-walls.png`, `pelcs: squares ${win[0]},${win[1]} to ${win[0] + win[2]},${win[1] + win[3]} at ${Z} px a square: the house's walls`, [[
    { pic: zb, label: "As drawn" }, { pic: zs, label: "exact: summer Dry" }, { pic: zw, label: "exact: winter L3" }, { pic: mark, label: "red: changed at summer Dry" },
  ]]);
  say(`  zoom: ${OUT}/pelcs-zoom-walls.png`);
}

// ---------------------------------------------------------------- cavern
{
  const { f, sc, s, a, pr } = await load("cavern");
  say(`\n== cavern`);
  const pps = 24, W = f.sqW * pps, H = f.sqH * pps;
  const pic = resample(f.full, W, H);
  const base: PictureSample = { rgba: pic, w: W, h: H };
  const out = bakeTile(base, s, f.exportPps, [0, 0, f.sqW, f.sqH], a, "summer", 2);
  const Ly = rasterSidecar(sc, { w: W, h: H });
  const snow = Ly.terrain.get(TR.SNOW) ?? new Uint8Array(W * H);
  const rock = Ly.terrain.get(TR.ROCK) ?? new Uint8Array(W * H);
  const win: Window = [4, 8, 8, 8];
  const c = { pure: [0, 0, 0], edge: [0, 0, 0], none: [0, 0, 0] } as Record<string, number[]>;
  for (let y = win[1] * pps; y < (win[1] + win[3]) * pps; y++) for (let x = win[0] * pps; x < (win[0] + win[2]) * pps; x++) {
    const i = y * W + x;
    if (Ly.top[i]) continue;
    const cls = snow[i] >= 230 ? "pure" : snow[i] >= 26 ? "edge" : "none";
    c[cls][0]++;
    if (T[lutIndex(pic[i * 4], pic[i * 4 + 1], pic[i * 4 + 2]) + 3] >= 128) c[cls][1]++;
    if (differs(base, out, i, 2)) c[cls][2]++;
  }
  say(`  squares ${win.join(",")} (no objects), by the SNOW weight: ${Object.entries(c).map(([k, v]) => `${k}: ${v[0]} px, snow-coloured ${pct(v[1] / v[0])}, changed at summer Dry ${pct(v[2] / v[0])}`).join("; ")}`);
  // The pure-snow pixels that don't change: their median colour, against the ones that do.
  const stay: number[][] = [[], [], []], go: number[][] = [[], [], []];
  for (let y = win[1] * pps; y < (win[1] + win[3]) * pps; y++) for (let x = win[0] * pps; x < (win[0] + win[2]) * pps; x++) {
    const i = y * W + x;
    if (Ly.top[i] || snow[i] < 230) continue;
    const d = differs(base, out, i, 2) ? go : stay;
    for (let k = 0; k < 3; k++) d[k].push(pic[i * 4 + k]);
  }
  say(`  pure snow there: unchanged pixels' median rgb(${stay.map(median).join(",")}) (${stay[0].length}), changed pixels' median rgb(${go.map(median).join(",")}) (${go[0].length})`);
  {
    let rs = 0, n = 0;
    for (let y = win[1] * pps; y < (win[1] + win[3]) * pps; y++) for (let x = win[0] * pps; x < (win[0] + win[2]) * pps; x++) {
      const i = y * W + x;
      if (Ly.top[i] || snow[i] < 230 || differs(base, out, i, 2)) continue;
      rs += rock[i]; n++;
    }
    say(`  (mean ROCK weight under those unchanged pure-snow pixels: ${fmt(rs / Math.max(1, n) / 255, 2)})`);
  }
  // A zoom: As drawn, summer Dry, and the colour table's snow class.
  const zb = await baseTile(f.full, f.exportPps, win, 48);
  const zs = bakeTile(zb, s, f.exportPps, win, a, "summer", 2);
  const cls = { rgba: zb.rgba.slice(), w: zb.w, h: zb.h };
  for (let i = 0; i < zb.w * zb.h; i++) {
    const o = i * 4;
    const sn = T[lutIndex(zb.rgba[o], zb.rgba[o + 1], zb.rgba[o + 2]) + 3] >= 128;
    if (!sn) { cls.rgba[o] = 255; cls.rgba[o + 1] = 40; cls.rgba[o + 2] = 40; }
  }
  await sheet(`${OUT}/cavern-zoom-snow.png`, `cavern: squares ${win.join(",")} at 48 px a square: the open snow by the cave wall`, [[
    { pic: zb, label: "As drawn" }, { pic: zs, label: "exact: summer Dry" }, { pic: cls, label: "red: not snow-coloured by the colour table" },
  ]]);
  say(`  zoom: ${OUT}/cavern-zoom-snow.png`);
  // The pools (2.6).
  const PPS = 24;
  for (const sh of sc.shapes) {
    if (sh.layer !== -50) continue;
    const sub: SeasonSidecar = { ...sc, bitmaps: [], shapes: [sh], objects: NO_OBJECTS };
    const m = rasterSidecar(sub, { w: W, h: H }).area.get(sh.role)!;
    const inner = eroded(m, W, H, Math.round(PPS / 4));
    let n = 0, wet = 0, white = 0;
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (inner[i] < 128 || Ly.top[i]) continue;
      n++;
      const k = lutIndex(pic[i * 4], pic[i * 4 + 1], pic[i * 4 + 2]);
      if (T[k + 1] >= 128) wet++;
      if (T[k + 3] >= 128) white++;
      rs.push(pic[i * 4]); gs.push(pic[i * 4 + 1]); bs.push(pic[i * 4 + 2]);
    }
    say(`  water body ${AN[sh.role]}: ${n} px a quarter square in: water-coloured ${pct(wet / Math.max(1, n))}, snow-coloured ${pct(white / Math.max(1, n))}, median rgb(${n ? [median(rs), median(gs), median(bs)].join(",") : "-"}); report ${pr.report.water.join(",")}`);
  }
}

// ---------------------------------------------------------------- waterfall: the shore blend
{
  const { f, sc } = await load("waterfall");
  say(`\n== waterfall: the shore blend (file blend_distance ${f.map.world.levels[0].water.root?.children[0]?.blendDistance})`);
  const pps = 36, W = f.sqW * pps, H = f.sqH * pps;
  const pic = resample(f.full, W, H);
  const body = sc.shapes.find((s) => s.layer === -50)!;
  const m = rasterSidecar({ ...sc, bitmaps: [], shapes: [body], objects: NO_OBJECTS }, { w: W, h: H }).area.get(body.role)!;
  const top = rasterSidecar(sc, { w: W, h: H }).top;
  const deep = [255, 204, 85];
  let prev = m;
  const rows: string[] = [];
  for (let d = 0.125; d <= 2.5; d += 0.125) {
    const er = eroded(m, W, H, Math.round(d * pps));
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let i = 0; i < W * H; i++) if (prev[i] >= 128 && er[i] < 128 && !top[i]) { rs.push(pic[i * 4]); gs.push(pic[i * 4 + 1]); bs.push(pic[i * 4 + 2]); }
    if (rs.length > 50) {
      const med = [median(rs), median(gs), median(bs)];
      const dist = Math.abs(med[0] - deep[0]) + Math.abs(med[1] - deep[1]) + Math.abs(med[2] - deep[2]);
      rows.push(`${fmt(d - 0.125, 3)}-${fmt(d, 3)} sq: rgb(${med.join(",")}), ${dist} from the deep colour`);
    }
    prev = er;
  }
  say(`  ring medians by distance inside the body's edge (no objects):\n    ${rows.join("\n    ")}`);
}

// ---------------------------------------------------------------- Tulgi: FLOOR outside the round hut
{
  const { f, sc } = await load("tulgi");
  say(`\n== tulgi (extractor ${sc.meta.extractor})`);
  const pps = 24, W = f.sqW * pps, H = f.sqH * pps;
  const L = f.map.world.levels.find((l) => l.label === "Ground")!;
  const loop = L.walls.find((w) => w.loop)!;
  const spec: RasterSpec = { width: W, height: H, originX: sc.meta.rect[0], originY: sc.meta.rect[1], unitsPerPx: GRID / pps };
  const inLoop = new Uint8Array(W * H);
  fillPolygons(inLoop, spec, [loop.points], 255, "nonzero");
  const grown = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let on = false;
    for (let dy = -3; !on && dy <= 3; dy++) for (let dx = -3; !on && dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && inLoop[yy * W + xx] >= 128) on = true; }
    if (on) grown[y * W + x] = 255;
  }
  const floor = rasterSidecar({ ...sc, objects: NO_OBJECTS }, { w: W, h: H }).area.get(AR.FLOOR) ?? new Uint8Array(W * H);
  let inside = 0, outside = 0, loopPx = 0;
  for (let i = 0; i < W * H; i++) { if (inLoop[i] >= 128) loopPx++; if (floor[i] < 128) continue; if (grown[i] >= 128) inside++; else outside++; }
  say(`  the round hut's wall loop: ${loopPx} px at ${pps} px/sq; FLOOR inside it (3 px grown) ${inside} px, outside ${outside} px (${fmt(outside / (pps * pps), 2)} sq²)`);
}
writeText(`${OUT}/checks.txt`, lines.join("\n"));

function filterObjects(o: ObjectTable, keep: (i: number) => boolean): ObjectTable {
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

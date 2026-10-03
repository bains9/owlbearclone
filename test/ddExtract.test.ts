// Extraction (design 6.3 "Extraction and attach", WP3): the picture's rectangle (2.3), level choice
// (2.2), the compiled sidecar against WP9's hand-built one and the map text (roles, crop, wall
// loops, drawn path widths, roofs, water by the picture, pack share), privacy (3.5), measurement
// through the extractor (2.5), the automatic shift (2.4), caps, and the preview. Real files:
// waterfall (committed) on a fake export and on Vern's 1.2 export when DD_VERN has it; the
// public samples when DD_FIXTURES has them. Both skip cleanly when absent.
import { describe, expect, it } from "vitest";
import { parseDungeondraftMap } from "../src/client/dd/parse";
import { GRID, MS_EDGE_BUFFER, type DDMap, type MapObject } from "../src/client/dd/model";
import { rasterSidecar, type SidecarLayers } from "../src/client/dd/raster";
import { AR, NAMED_ROLES, OR, TR, defaultName, objectRole, terrainRole, type ObjectRole } from "../src/client/dd/roles";
import {
  DD_LAYER, NO_NAME, OBJ_FLAG, REACH_N, SIDECAR_UNITS, decodeSidecar, encodeSidecar, type SeasonSidecar,
} from "../src/client/dd/sidecar";
import {
  EXTRACT, EXTRACTOR_VERSION, ExtractError, chooseLevel, extractSidecar, pictureRect, previewOverlay, previewSize, rankLevels,
  type ExtractOptions, type PictureRect, type PictureSample,
} from "../src/client/dd/extract";
import { levelCentres, objectFit } from "../src/client/dd/fit";
import { pathRibbon } from "../src/client/dd/geometry";
import { SPRITE_SIZES } from "../src/client/dd/spriteSizes";
import type { SpriteSizes } from "../src/client/dd/measure";
import {
  FIXTURE_SPRITES, PACK_ID, PACK_NAME, PACK_PREFIX, croppedDd2vtt, editedPicture, fitPairs, interiorsMap, mapText, pelcsLike, scatterMap, snowyMap,
  transformsMap, twinLevels, worldReach, type ObjSpec, type Pt,
} from "./fixtures/ddSynthetic";
import { FAKE_COLOURS, fakeExportFromMap, type FakeMapOptions } from "./fixtures/fakeExport";
import {
  SAMPLE_PAIRS, SWAPPED_PAIRS, atPxPerSquare, havePair, haveVernExport, readPicture, sampleText, vernPicture, waterfallText,
  type SamplePair,
} from "./helpers/ddFixtures";

const wholeMap = (m: DDMap): PictureRect => ({ rect: [0, 0, m.world.width * GRID, m.world.height * GRID] });

/** Extracts `key` of `text` against a fake export of `picText` (default: the same map) at pps. */
function run(text: string, key: string, pic: { pps?: number; opts?: FakeMapOptions; text?: string } = {},
  sizes: SpriteSizes = FIXTURE_SPRITES, opts: ExtractOptions = {}) {
  const map = parseDungeondraftMap(text);
  const pps = pic.pps ?? 32;
  const picture = fakeExportFromMap(pic.text ? parseDungeondraftMap(pic.text) : map, key, pps, pic.opts);
  const rect = pictureRect(map, picture.w, picture.h);
  if ("error" in rect) throw new Error(rect.error);
  const t0 = performance.now();
  const out = extractSidecar(map, key, rect, picture, sizes, { levels: [], ...opts });
  return { map, picture, rect, ms: performance.now() - t0, ...out };
}

/** The raster of a sidecar at pps over its META.rect. */
function raster(sc: SeasonSidecar, pps = 16): SidecarLayers {
  const [x0, y0, x1, y1] = sc.meta.rect;
  return rasterSidecar(sc, { w: Math.round(((x1 - x0) / GRID) * pps), h: Math.round(((y1 - y0) / GRID) * pps) });
}

/** Pixel index of world square (x, y) on a raster of `L` over `rect` at pps. */
const at = (L: SidecarLayers, rect: [number, number, number, number], pps: number, x: number, y: number) =>
  Math.floor((y - rect[1] / GRID) * pps) * L.w + Math.floor((x - rect[0] / GRID) * pps);

const runtimeRole = (sc: SeasonSidecar, i: number): ObjectRole =>
  (sc.objects.name[i] !== NO_NAME ? objectRole(sc.meta.names[sc.objects.name[i]]) : sc.objects.role[i]) as ObjectRole;

const reachOf = (sc: SeasonSidecar, i: number) =>
  Array.from(sc.objects.reach.subarray(i * REACH_N, (i + 1) * REACH_N), (v) => v / SIDECAR_UNITS.reach);

const rectPts = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Even-odd point in a ring of world units. */
function inRing(r: ArrayLike<number>, x: number, y: number): boolean {
  let c = false;
  const n = r.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Repaints a whole-map picture at pps px a square where `f` (pixel centre, in squares) gives a colour. */
function paint(pic: PictureSample, pps: number, f: (x: number, y: number) => readonly number[] | null): void {
  for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
    const c = f((x + 0.5) / pps, (y + 0.5) / pps);
    if (!c) continue;
    const o = (y * pic.w + x) * 4;
    pic.rgba[o] = c[0]; pic.rgba[o + 1] = c[1]; pic.rgba[o + 2] = c[2]; pic.rgba[o + 3] = 255;
  }
}

/** A 16 x 10 map of snow (or grass) with one water body `ring` (squares) and `objects`. */
function waterMap(ring: Pt[], opts: { green?: boolean; objects?: ObjSpec[] } = {}): DDMap {
  return parseDungeondraftMap(mapText({ w: 16, h: 10, levels: [{
    key: "0", label: "Ground", terrain: { slots: [opts.green ? "terrain_grass" : "terrain_snow"], weights: () => [255] },
    water: [{ ring }], objects: opts.objects ?? [],
  }] }));
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

/** Every role mask (>= 128) of `a` and `b` agrees on at least `min` of the pixels where either has it. */
function agreement(a: SidecarLayers, b: SidecarLayers): Array<{ what: string; share: number; pixels: number }> {
  const out: Array<{ what: string; share: number; pixels: number }> = [];
  const cmp = (what: string, p: Uint8Array | undefined, q: Uint8Array | undefined) => {
    let union = 0, both = 0;
    for (let i = 0; i < a.w * a.h; i++) {
      const x = (p?.[i] ?? 0) >= 128, y = (q?.[i] ?? 0) >= 128;
      if (x || y) union++;
      if (x && y) both++;
    }
    if (union > 0) out.push({ what, share: both / union, pixels: union });
  };
  for (const k of new Set([...a.terrain.keys(), ...b.terrain.keys()])) cmp(`terrain ${k}`, a.terrain.get(k), b.terrain.get(k));
  for (const k of new Set([...a.area.keys(), ...b.area.keys()])) cmp(`area ${k}`, a.area.get(k), b.area.get(k));
  for (const k of new Set([...a.objects.keys(), ...b.objects.keys()])) cmp(`objects ${k}`, a.objects.get(k), b.objects.get(k));
  return out;
}

// ------------------------------------------------------------------ the picture's rectangle

describe("pictureRect (2.3)", () => {
  const map = parseDungeondraftMap(snowyMap().text); // 20 x 12

  it("a plain export is the whole map, at any size within 2 px of the map's aspect", () => {
    expect(pictureRect(map, 640, 384)).toEqual({ rect: [0, 0, 20 * GRID, 12 * GRID] });
    expect(pictureRect(map, 6144, Math.round((6144 * 12) / 20))).toEqual({ rect: [0, 0, 20 * GRID, 12 * GRID] });
    expect(pictureRect(map, 641, 385)).toEqual({ rect: [0, 0, 20 * GRID, 12 * GRID] });
  });

  it("refuses a plain picture of the wrong shape, saying why", () => {
    const r = pictureRect(map, 3456, 1944);
    expect("error" in r && r.error).toBe(
      "This picture is 3456×1944 but the map is 20×12 squares, so it isn't an export of the whole map. If you exported part of it, choose its .dd2vtt export too.");
  });

  it("a .dd2vtt's rectangle is its origin and size in squares, at any picture size of its aspect", () => {
    const c = croppedDd2vtt(32);
    const want = { rect: [2 * GRID, 1 * GRID, 18 * GRID, 11 * GRID] };
    expect(pictureRect(map, 512, 320, c.vtt)).toEqual(want);
    expect(pictureRect(map, 6144, 3840, c.vtt)).toEqual(want);
    expect(pictureRect(map, 6144, 3860, c.vtt)).toEqual(want); // within 1%
    // The scene's mapRect stands in for the .dd2vtt.
    expect(pictureRect(map, 512, 320, undefined, [2, 1, 16, 10])).toEqual(want);
  });

  it("refuses a .dd2vtt picture of another shape, or a rectangle mostly off the map", () => {
    const c = croppedDd2vtt(32);
    const r = pictureRect(map, 512, 400, c.vtt);
    expect("error" in r && r.error).toMatch(/^This picture is 512×400, which isn't the shape of its export \(16×10 squares\)/);
    const off = { ...c.vtt, resolution: { ...c.vtt.resolution, map_origin: { x: 14, y: 0 } } };
    expect("error" in pictureRect(map, 512, 320, off)).toBe(true);
    expect("error" in pictureRect(map, 0, 320, c.vtt)).toBe(true);
  });
});

// ------------------------------------------------------------------ the snowy map

describe("the snowy synthetic map", () => {
  const sn = snowyMap();
  const r = run(sn.text, sn.levelKey);
  const sc = r.sidecar;

  it("encodes, decodes to itself, and is version EXTRACTOR_VERSION", () => {
    const bytes = encodeSidecar(sc);
    expect(decodeSidecar(bytes)).toEqual(sc);
    expect(sc.meta.extractor).toBe(EXTRACTOR_VERSION);
    expect(sc.meta.rect).toEqual([0, 0, 20 * GRID, 12 * GRID]);
    expect(sc.meta.squares).toEqual([20, 12]);
    console.log(`snowy map: extracted in ${r.ms.toFixed(0)} ms, ${bytes.length} bytes`);
  });

  it("agrees role by role with WP9's hand-built sidecar of the same text (terrain and areas; objects by their measured outlines)", () => {
    // Terrain and areas without the objects (whose measured outlines differ a little from the truth).
    const bare = (s: SeasonSidecar): SeasonSidecar => ({ ...s, objects: emptyObjects() });
    const a = agreement(raster(bare(sc)), raster(bare(sn.sidecar)));
    console.log(a.map((x) => `${x.what} ${(100 * x.share).toFixed(1)}% of ${x.pixels}`).join(", "));
    expect(a.map((x) => x.what).sort()).toEqual(["area 1", "area 2", "area 5", "area 6", "terrain 1", "terrain 3", "terrain 6"]);
    for (const x of a) expect(x.share, x.what).toBeGreaterThan(0.98);
    // With the objects: the crowns, the pack item and the dead tree agree on most of their pixels.
    const b = agreement(raster(sc), raster(sn.sidecar));
    console.log(b.filter((x) => x.what.startsWith("objects")).map((x) => `${x.what} ${(100 * x.share).toFixed(1)}%`).join(", "));
    for (const role of [OR.EVERGREEN, OR.DECIDUOUS, OR.BARE, OR.OPAQUE]) {
      expect(b.find((x) => x.what === `objects ${role}`)!.share, `objects ${role}`).toBeGreaterThan(0.8);
    }
  });

  it("stores every object, in the map's order, with roles, layers and flags; names only for natural things", () => {
    const L = r.map.world.levels[0];
    expect(sc.objects.n).toBe(L.objects.length);
    for (let i = 0; i < sc.objects.n; i++) {
      const o = L.objects[i];
      const nm = defaultName(o.texture);
      expect(sc.objects.role[i]).toBe(objectRole(nm));
      expect(sc.objects.x[i]).toBe(Math.round(o.position.x * SIDECAR_UNITS.coord));
      expect(sc.objects.layer[i]).toBe(o.layer);
      if (nm !== null && NAMED_ROLES.has(objectRole(nm))) expect(sc.meta.names[sc.objects.name[i]]).toBe(nm);
      else expect(sc.objects.name[i]).toBe(NO_NAME);
      expect(sc.objects.flags[i] & OBJ_FLAG.MEASURED, `object ${i}`).toBe(OBJ_FLAG.MEASURED);
    }
    expect(sc.objects.role[sn.objects.pack]).toBe(OR.OPAQUE);
    expect(sc.objects.role[sn.objects.crate]).toBe(OR.STRUCTURE);
    expect(sc.objects.layer[sn.objects.roofSnow]).toBe(DD_LAYER.ABOVE_ROOFS);
    // Measured on a picture drawn with the true outlines (the prior here): close to the truth.
    for (const i of [sn.objects.pine, sn.objects.oak, sn.objects.boulder]) {
      const truth = sn.sidecar.objects.reach.subarray(i * REACH_N, (i + 1) * REACH_N);
      const err = reachOf(sc, i).map((v, k) => Math.abs(v - truth[k] / 4) / (truth[k] / 4));
      expect(err.reduce((s, e) => s + e, 0) / REACH_N, `object ${i} mean`).toBeLessThan(0.08);
      if (i !== sn.objects.boulder) expect(Math.max(...err), `object ${i} worst`).toBeLessThan(0.25);
    }
  });

  it("names only natural objects and terrain slots, never a structure's or a pack item's", () => {
    for (const n of sc.meta.names) {
      const natural = NAMED_ROLES.has(objectRole(n));
      const ground = terrainRole(n) !== TR.KEEP;
      expect(natural || ground, n).toBe(true);
    }
    expect(sc.meta.names).not.toContain("supplies/crates/crate_01");
  });

  it("terrain: 4 texels a square, the whole map, only slots with weight, roles from the names", () => {
    const t = sc.terrain!;
    expect([t.tps, t.tx0, t.ty0, t.tw, t.th]).toEqual([4, 0, 0, 80, 48]);
    expect(t.slots.map((s) => sc.meta.names[s.name])).toEqual(["terrain_snow", "terrain_grass", "terrain_rocky"]);
    expect(t.slots.map((s) => s.role)).toEqual([TR.SNOW, TR.GRASS, TR.ROCK]);
    expect(t.w).toEqual(sn.sidecar.terrain!.w);
  });

  it("water is one shape a body, even-odd with its island; the hut is FLOOR inside its walls; the roof ROOF", () => {
    const water = sc.shapes.filter((s) => s.role === AR.WATER);
    expect(water.length).toBe(1);
    expect([water[0].rule, water[0].ringEnds.length, water[0].layer]).toEqual([0, 2, DD_LAYER.WATER]);
    const L = raster(sc, 16);
    const R = sc.meta.rect;
    const area = (role: number, x: number, y: number) => L.area.get(role as never)?.[at(L, R, 16, x, y)] ?? 0;
    const [hx0, hy0, hx1, hy1] = sn.layout.hut;
    expect(area(AR.FLOOR, (hx0 + hx1) / 2, (sn.layout.openFloor[1] + hy1) / 2)).toBe(255);
    expect(area(AR.ROOF, hx0 + 0.4, 1.3)).toBe(255); // (its middle is under the roof snow)
    expect(area(AR.WALL, hx0, 4)).toBe(255);
    expect(hy0).toBe(1);
    expect(area(AR.WATER, 3.6, 3.6)).toBe(255);
    expect(area(AR.WATER, 5.3, 3.7)).toBe(0); // the island
  });

  it("reports the map: winter, its snow share, the pack item and its pack's name, the grid", () => {
    const rep = r.report;
    expect(rep.drawn).toBe("winter");
    expect(Math.abs(rep.snowShare - sn.sidecar.meta.snowShare)).toBeLessThan(0.03);
    expect(rep.snowShare).toBe(sc.meta.snowShare);
    expect([rep.packItems, rep.packPaths, rep.packNames]).toEqual([1, 0, [PACK_NAME]]);
    expect(Math.abs(rep.packShare - sn.sidecar.meta.packShare)).toBeLessThan(0.03);
    expect([rep.water, rep.dropped, rep.objects, rep.hold, rep.lowRes, rep.level]).toEqual([["WATER"], 0, 14, null, false, "0"]);
    expect(rep.gridPxPerSquare).toBe(32);
    expect(rep.fit.verdict).toBe("yes");
    expect(rep.warnings).toEqual([]);
  });

  it("the picture's full size sets gridPxPerSquare; below 16 px a square it is low-resolution", () => {
    const big = extractSidecar(r.map, "0", r.rect, r.picture, FIXTURE_SPRITES, { levels: [], picSize: [2160, 1296] });
    expect(big.report.gridPxPerSquare).toBe(108);
    expect(run(sn.text, sn.levelKey, { pps: 12 }).report.lowRes).toBe(true);
  });

  it("is a green map's when the snow is grass", () => {
    const g = run(snowyMap({ green: true }).text, "0");
    expect(g.report.drawn).toBe("green");
    expect(g.report.snowShare).toBe(0);
  });
});

// ------------------------------------------------------------------ privacy (3.5)

describe("privacy: what a player's browser could read", () => {
  const banned = (sc: SeasonSidecar, extra: string[]) => {
    const s = latin1(encodeSidecar(sc));
    return ["res://", "packs/", "Icewind", PACK_ID, PACK_NAME, "portal", "light", "editor_state", "door", ...extra].filter((w) => s.includes(w));
  };

  it("the snowy map with a pack roof: no paths, pack ids or names, portals, lights, level label", () => {
    const sn = snowyMap({ packRoof: true });
    const r = run(sn.text, sn.levelKey);
    expect(banned(r.sidecar, ["Ground", "crate", "snowy_fir", "frosted_shingles", "round_slate_gray", "tileset"])).toEqual([]);
    expect(r.report.packItems).toBe(2);
  });

  it("the Pelcs-like map's Ground level: nothing of the Roof level or the doors and lights", () => {
    const pl = pelcsLike();
    const r = run(pl.text, pl.groundKey, { pps: 24 });
    expect(banned(r.sidecar, ["Ground", "Roof", "wagon_trail", "stone"])).toEqual([]);
    // Only the Ground level's things: no roof snow from the Roof level.
    expect(r.sidecar.objects.n).toBe(14);
  });

  it("waterfall (Vern's map): no pack, file or level names", () => {
    const map = parseDungeondraftMap(waterfallText());
    const pic = fakeExportFromMap(map, "0", 12);
    const r = extractSidecar(map, "0", wholeMap(map), pic, SPRITE_SIZES, { levels: [] });
    expect(banned(r.sidecar, ["Ground", "waterfall", "Skront", "Bathroom", "Wooden", "Treasure", "Alchemy", "vMx90ykn"])).toEqual([]);
    expect(r.report.packNames).toEqual(["Icewind Dale"]);
  });
});

// ------------------------------------------------------------------ the crop and alignment

describe("a cropped .dd2vtt (origin 2,1, 16 x 10 squares)", () => {
  const c = croppedDd2vtt(32);
  const map = parseDungeondraftMap(c.text);
  const pic = fakeExportFromMap(map, c.levelKey, 32, { crop: c.crop });
  const rect = pictureRect(map, pic.w, pic.h, c.vtt) as PictureRect;
  const { sidecar: sc, report } = extractSidecar(map, c.levelKey, rect, pic, FIXTURE_SPRITES, { levels: [] });

  it("lines up: objects sit at world minus the origin in the picture", () => {
    expect(sc.meta.rect).toEqual([2 * GRID, GRID, 18 * GRID, 11 * GRID]);
    expect(report.fit.verdict).not.toBe("no"); // (7 objects score inside it: too few for "yes")
    const L = raster(sc, 32);
    const pine = c.snowy.objects.pine;
    const o = map.world.levels[0].objects[pine];
    const k = sc.objects.x.indexOf(Math.round(o.position.x * SIDECAR_UNITS.coord));
    expect(L.top[at(L, sc.meta.rect, 32, o.position.x / GRID, o.position.y / GRID)]).toBe(k + 1);
    expect(L.top[Math.floor((o.position.y / GRID - 1) * 32) * L.w + Math.floor((o.position.x / GRID - 2) * 32)]).toBe(k + 1);
  });

  it("leaves out objects more than a square outside the rectangle, and everything else beyond it", () => {
    expect(sc.objects.n).toBe(map.world.levels[0].objects.length - c.snowy.objects.outsideCrop.length);
    const xs = new Set(Array.from(sc.objects.x));
    for (const i of c.snowy.objects.outsideCrop) {
      expect(xs.has(Math.round(map.world.levels[0].objects[i].position.x * SIDECAR_UNITS.coord))).toBe(false);
    }
    const box = [1 * GRID, 0, 19 * GRID, 12 * GRID].map((v) => v * SIDECAR_UNITS.coord);
    for (const s of sc.shapes) {
      for (let i = 0; i < s.pts.length; i += 2) {
        expect(s.pts[i]).toBeGreaterThanOrEqual(box[0]);
        expect(s.pts[i]).toBeLessThanOrEqual(box[2]);
        expect(s.pts[i + 1]).toBeGreaterThanOrEqual(box[1]);
        expect(s.pts[i + 1]).toBeLessThanOrEqual(box[3]);
      }
    }
    const t = sc.terrain!;
    // The crop (1 to 19 squares across, 0 to 12 down) plus a texel, clamped to the map.
    expect([t.tx0, t.ty0, t.tx0 + t.tw, t.ty0 + t.th]).toEqual([3, 0, 77, 48]);
  });
});

describe("the fit, through the extractor (2.4)", () => {
  const pairs = fitPairs();
  const shifted = pairs.find((p) => p.name === "shifted 2 squares")!;

  it("a picture shifted 2 squares: \"no\" with best -2, and the automatic shift lines it up (\"yes\")", () => {
    const r = run(shifted.mapText, shifted.levelKey, { pps: 24, opts: shifted.picture });
    expect(r.report.shifted).toEqual([-2, 0]);
    expect(r.report.fit.verdict).toBe("yes");
    expect(r.report.hold).toBe(null);
    expect(r.sidecar.meta.rect).toEqual([2 * GRID, 0, 22 * GRID, 12 * GRID]);
  });

  it("without the automatic shift it is held (\"fit\"); the dialog's shift does the same as the automatic one", () => {
    const held = run(shifted.mapText, shifted.levelKey, { pps: 24, opts: shifted.picture }, FIXTURE_SPRITES, { autoShift: false });
    expect(held.report.fit.verdict).toBe("no");
    expect(held.report.fit.shiftSq).toEqual([-2, 0]);
    expect(held.report.hold).toBe("fit");
    expect(held.report.shifted).toBeUndefined();
    const lined = run(shifted.mapText, shifted.levelKey, { pps: 24, opts: shifted.picture }, FIXTURE_SPRITES, { shift: [-2, 0] });
    expect(lined.report.shifted).toEqual([-2, 0]);
    expect(lined.report.fit.verdict).toBe("yes");
  });

  it("swapped, half-square and half-scale pictures are never \"yes\" and never shifted to one", () => {
    for (const p of pairs.filter((q) => q.expect === "not-yes")) {
      const r = run(p.mapText, p.levelKey, { pps: 24, text: p.pictureText, opts: p.picture });
      expect(r.report.fit.verdict, p.name).not.toBe("yes");
    }
  });

  it("an edited picture: the trees it doesn't show are dropped; the rest line up", () => {
    const e = editedPicture();
    const r = run(e.text, e.levelKey, { pps: 32, text: e.pictureText });
    const L = r.map.world.levels[0];
    const kept = new Set(Array.from({ length: r.sidecar.objects.n }, (_, i) => `${r.sidecar.objects.x[i]},${r.sidecar.objects.y[i]}`));
    const key = (o: MapObject) => `${Math.round(o.position.x * 16)},${Math.round(o.position.y * 16)}`;
    expect(kept.has(key(L.objects[e.erased]))).toBe(false);
    expect(kept.has(key(L.objects[e.moved]))).toBe(false);
    expect(r.report.dropped).toBe(2);
    expect(r.sidecar.meta.dropped).toBe(2);
    expect(r.report.objects).toBe(L.objects.length - 2);
  });

  it("more than a tenth of the trees missing from the picture lowers a \"yes\" to \"unsure\" (2.5 item 5), attached", () => {
    const s = scatterMap(1);
    const map = parseDungeondraftMap(s.text);
    const L = map.world.levels[0];
    const roles = L.objects.map((o) => objectRole(defaultName(o.texture)));
    const trees = roles.filter((role) => role === OR.EVERGREEN || role === OR.DECIDUOUS || role === OR.BARE).length;
    const crowns = roles.flatMap((role, i) => (role === OR.EVERGREEN || role === OR.DECIDUOUS ? [i] : []));
    // Two crowns erased: more than a tenth of the trees.
    const erase = crowns.slice(0, 2);
    expect(erase.length).toBe(2);
    expect(2 / trees).toBeGreaterThan(0.1);
    // The fit alone still says "yes"; presence finds the two trees gone.
    const pic = fakeExportFromMap(map, "0", 24, { erase });
    expect(objectFit(levelCentres(L), wholeMap(map), pic).verdict).toBe("yes");
    const r = run(s.text, "0", { pps: 24, opts: { erase } });
    expect(r.report.dropped).toBe(2);
    expect(r.report.fit.verdict).toBe("unsure");
    expect(r.report.hold).toBe(null);
    // Nothing erased: "yes".
    expect(run(s.text, "0", { pps: 24 }).report.fit.verdict).toBe("yes");
  });
});

describe("the automatic shift on wrong maps (2.4): only a placement that scores \"yes\" is taken", () => {
  /** Map `a` (24 objects) on the picture of map `b`. */
  const wrong = (a: number, b: number) => {
    const text = scatterMap(a, 24).text;
    const r = run(text, "0", { pps: 24, text: scatterMap(b, 24).text });
    const L = r.map.world.levels[0];
    return { r, L, centres: levelCentres(L) };
  };

  it("map 1 on map 8's picture: \"no\" with a whole-square best whose own fit isn't \"yes\": not shifted, held", () => {
    const { r, centres } = wrong(1, 8);
    expect(r.report.fit.verdict).toBe("no");
    const s = r.report.fit.shiftSq!;
    expect(s).toEqual([-1, 0]);
    expect(objectFit(centres, { rect: [-s[0] * GRID, -s[1] * GRID, (20 - s[0]) * GRID, (12 - s[1]) * GRID] }, r.picture).verdict).not.toBe("yes");
    expect(r.report.shifted).toBeUndefined();
    expect(r.report.hold).toBe("fit");
    expect(r.sidecar.meta.rect).toEqual([0, 0, 20 * GRID, 12 * GRID]);
  });

  it("maps 3 on 1, 10 on 9, 1 on 9: the best of the search fits \"yes\" there by chance, but most trees aren't in the picture: not shifted, held", () => {
    for (const [a, b] of [[3, 1], [10, 9], [1, 9]]) {
      const { r, centres } = wrong(a, b);
      expect(r.report.fit.verdict, `${a} on ${b}`).toBe("no");
      const s = r.report.fit.shiftSq!;
      expect(objectFit(centres, { rect: [-s[0] * GRID, -s[1] * GRID, (20 - s[0]) * GRID, (12 - s[1]) * GRID] }, r.picture).verdict, `${a} on ${b}`).toBe("yes");
      expect(r.report.shifted, `${a} on ${b}`).toBeUndefined();
      expect(r.report.hold, `${a} on ${b}`).toBe("fit");
    }
  });

  /** As a whole map's text: map `seed`'s 40 scattered objects (scatterMap) less its trees, on snow. */
  const noTrees = (seed: number) => {
    const L = parseDungeondraftMap(scatterMap(seed, 40).text).world.levels[0];
    const objects: ObjSpec[] = L.objects.filter((o) => ![OR.EVERGREEN, OR.DECIDUOUS, OR.BARE].includes(objectRole(defaultName(o.texture)) as never))
      .map((o) => ({ name: defaultName(o.texture)!, at: [o.position.x / GRID, o.position.y / GRID], rot: o.rotation, scale: [o.scale.x, o.scale.y], mirror: o.mirror }));
    return mapText({ w: 20, h: 12, levels: [{ key: "0", label: "Ground", terrain: { slots: ["terrain_snow"], weights: () => [255] }, objects }] });
  };

  it("no trees (map 1's rocks, crates, bushes and logs on map 2's picture): the shifted fit says \"yes\", but most things aren't there: not shifted", () => {
    const text = noTrees(1);
    const r = run(text, "0", { pps: 24, text: noTrees(2) });
    const centres = levelCentres(r.map.world.levels[0]);
    expect(r.report.fit.verdict).toBe("no");
    const s = r.report.fit.shiftSq!;
    expect(objectFit(centres, { rect: [-s[0] * GRID, -s[1] * GRID, (20 - s[0]) * GRID, (12 - s[1]) * GRID] }, r.picture).verdict).toBe("yes");
    expect(r.report.shifted).toBeUndefined();
    expect(r.report.hold).toBe("fit");
    // The same map drawn 2 squares off: lined up.
    const ok = run(text, "0", { pps: 24, opts: { shift: [-2, 0] } });
    expect([ok.report.shifted, ok.report.fit.verdict]).toEqual([[-2, 0], "yes"]);
  });

  it("nothing tested for presence (30 tufts on grass, on another 30's picture): the fit of the shifted placement alone decides, and it isn't \"yes\"", () => {
    const tufts = (seed: number) => {
      let s = seed;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
      const objects: ObjSpec[] = [];
      for (let i = 0; i < 30; i++) {
        objects.push({ name: "vegetation/grass/grass_13", at: [Math.round((1 + rnd() * 18) * 16) / 16, Math.round((1 + rnd() * 10) * 16) / 16], rot: Math.round(rnd() * 600) / 100, scale: 1.6 });
      }
      return mapText({ w: 20, h: 12, levels: [{ key: "0", label: "Ground", terrain: { slots: ["terrain_grass"], weights: () => [255] }, objects }] });
    };
    const r = run(tufts(1), "0", { pps: 24, text: tufts(7) });
    expect(r.report.fit.verdict).toBe("no");
    const s = r.report.fit.shiftSq!;
    expect(s).toEqual([-2, 0]);
    expect(objectFit(levelCentres(r.map.world.levels[0]), { rect: [-s[0] * GRID, -s[1] * GRID, (20 - s[0]) * GRID, (12 - s[1]) * GRID] }, r.picture).verdict).not.toBe("yes");
    expect(r.report.shifted).toBeUndefined();
    expect(r.report.hold).toBe("fit");
  });
});

// ------------------------------------------------------------------ levels (2.2)

describe("choosing the level (2.2)", () => {
  const pl = pelcsLike();
  const map = parseDungeondraftMap(pl.text);
  const ground = fakeExportFromMap(map, pl.groundKey, 24);

  it("a Pelcs-like pair picks Ground by the export's doors and lights, clearly", () => {
    const ranks = rankLevels(map, ground, wholeMap(map), pl.vtt);
    expect(ranks.map((l) => [l.key, l.label, l.why])).toEqual([[pl.groundKey, "Ground", "vtt"], [pl.roofKey, "Roof", "vtt"]]);
    expect(ranks[0].vttScore).toBeGreaterThanOrEqual(0.8);
    expect(chooseLevel(ranks)).toEqual({ key: pl.groundKey, clear: true });
  });

  it("without the export: a roof level with terrain off ranks last against an opaque picture", () => {
    const ranks = rankLevels(map, ground, wholeMap(map));
    expect(ranks.map((l) => [l.key, l.terrainOn, l.why])).toEqual([[pl.groundKey, true, "ground"], [pl.roofKey, false, "ground"]]);
    expect(chooseLevel(ranks)!.clear).toBe(true);
  });

  it("... and first against a see-through roof picture", () => {
    const roof = fakeExportFromMap(map, pl.roofKey, 24);
    const ranks = rankLevels(map, roof, wholeMap(map));
    expect(ranks[0].key).toBe(pl.roofKey);
  });

  it("two terrain levels, no export and no clear object winner: on hold", () => {
    const tw = twinLevels();
    const m = parseDungeondraftMap(tw.text);
    const pic = fakeExportFromMap(m, tw.keys[0], 24);
    const ranks = rankLevels(m, pic, wholeMap(m));
    const choice = chooseLevel(ranks)!;
    expect(choice.clear).toBe(false);
    const r = extractSidecar(m, choice.key, wholeMap(m), pic, FIXTURE_SPRITES, { levels: ranks, holdLevel: !choice.clear });
    expect(r.report.hold).toBe("level");
    expect(r.report.levels).toBe(ranks);
  });

  it("a single level is \"only\"; an unknown key is refused", () => {
    const s = scatterMap(1);
    const m = parseDungeondraftMap(s.text);
    const pic = fakeExportFromMap(m, "0", 24);
    expect(rankLevels(m, pic, wholeMap(m)).map((l) => l.why)).toEqual(["only"]);
    expect(() => extractSidecar(m, "9", wholeMap(m), pic, FIXTURE_SPRITES)).toThrow(ExtractError);
  });
});

// ------------------------------------------------------------------ measurement through the extractor

describe("measurement, presence and caps, as stored (2.5)", () => {
  const tm = transformsMap();
  const r = run(tm.text, tm.levelKey, { pps: 32, opts: { capped: tm.capped, stroke: 0.5 } }, SPRITE_SIZES);
  const sc = r.sidecar;
  const L = r.map.world.levels[0];

  it("the turned, mirrored tree: measured within 8% of its true outline, flagged MIRROR and MEASURED", () => {
    const i = tm.objects.turned, o = L.objects[i];
    const truth = worldReach(FIXTURE_SPRITES["vegetation/trees/tree_big_green_02"].reach, o.rotation, [o.scale.x, o.scale.y], o.mirror);
    const got = reachOf(sc, i);
    const err = got.map((v, k) => Math.abs(v - truth[k]) / truth[k]);
    expect(Math.max(...err)).toBeLessThan(0.08);
    expect(sc.objects.flags[i] & (OBJ_FLAG.MIRROR | OBJ_FLAG.MEASURED)).toBe(OBJ_FLAG.MIRROR | OBJ_FLAG.MEASURED);
  });

  it("caps: the snow-capped crown is CAPPED; the small green tree whose prior overshoots is not", () => {
    expect(sc.objects.flags[tm.objects.capped] & OBJ_FLAG.CAPPED).toBe(OBJ_FLAG.CAPPED);
    expect(sc.objects.flags[tm.objects.small] & OBJ_FLAG.CAPPED).toBe(0);
  });

  it("the thin-stroked bare tree is present and measured from its strokes", () => {
    expect(r.report.dropped).toBe(0);
    expect(runtimeRole(sc, tm.objects.bare)).toBe(OR.BARE);
    expect(sc.objects.flags[tm.objects.bare] & OBJ_FLAG.MEASURED).toBe(OBJ_FLAG.MEASURED);
  });

  it("the pack crown's measured extent covers its 2-square crown; erased, it is kept with about the 1.5-square disc", () => {
    const p = tm.objects.pack;
    expect(sc.objects.role[p]).toBe(OR.OPAQUE);
    expect(Math.min(...reachOf(sc, p))).toBeGreaterThan(0.9 * GRID);
    const gone = run(tm.text, tm.levelKey, { pps: 32, opts: { capped: tm.capped, stroke: 0.5, erase: [p] } }, SPRITE_SIZES);
    expect(gone.sidecar.objects.n).toBe(sc.objects.n); // pack items are never dropped
    const disc = reachOf(gone.sidecar, p);
    console.log(`erased pack crown: ${disc.map((v) => v.toFixed(0)).join(" ")}`);
    for (const v of disc) expect(v).toBeGreaterThanOrEqual(0.8 * 1.5 * GRID);
  });

  it("presence: an erased tree is dropped, exactly that one; an erased tuft on grass isn't tested, so it stays", () => {
    const sn = snowyMap();
    const grassTuft = sn.objects.tufts.find((i) => parseDungeondraftMap(sn.text).world.levels[0].objects[i].position.x > 13 * GRID)!;
    const e = run(sn.text, sn.levelKey, { pps: 32, opts: { erase: [sn.objects.oak, grassTuft] } });
    expect(e.report.dropped).toBe(1);
    expect(e.sidecar.objects.n).toBe(13);
    const L0 = e.map.world.levels[0];
    const xs = Array.from(e.sidecar.objects.x);
    expect(xs).not.toContain(Math.round(L0.objects[sn.objects.oak].position.x * 16));
    expect(xs).toContain(Math.round(L0.objects[grassTuft].position.x * 16));
  });
});

// ------------------------------------------------------------------ areas: interiors, paths, roofs, water

describe("areas (4.1)", () => {
  it("wall loops: the Mill-like loop over a wood pattern and the 4 x 4 hut of two walls are FLOOR; the 10 x 10 yard and the cave loop are not", () => {
    const im = interiorsMap();
    const r = run(im.text, im.levelKey, { pps: 16 });
    const L = raster(r.sidecar, 16);
    const R = r.sidecar.meta.rect;
    const floor = (x: number, y: number) => L.area.get(AR.FLOOR)?.[at(L, R, 16, x, y)] ?? 0;
    const mid = (b: [number, number, number, number]): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    expect(floor(...mid(im.mill))).toBe(255);
    expect(floor(im.mill[0] + 0.5, im.mill[1] + 0.5)).toBe(255);
    expect(floor(im.hut[2] - 0.7, im.hut[1] + 0.7)).toBe(255); // (a boulder sits in the middle)
    expect(floor(im.hut[0] + 0.4, im.hut[3] - 0.4)).toBe(255);
    expect(floor(...mid(im.yard))).toBe(0);
    expect(floor(im.yard[0] + 1.5, im.yard[1] + 1.5)).toBe(0);
    expect(floor(...mid(im.caveLoop))).toBe(0);
    expect(L.terrain.get(TR.GRASS)![at(L, R, 16, im.yard[0] + 1.5, im.yard[1] + 1.5)]).toBe(255);
  });

  it("a walled town (a 24 x 14 loop) stays outdoors: its cobbled street PAVED, its yard SNOW, its houses' wood FLOOR; a 5 x 5 walled room is FLOOR, its cobbles too", () => {
    const W = 36, H = 18;
    const text = mapText({ w: W, h: H, levels: [{
      key: "0", label: "Ground", terrain: { slots: ["terrain_snow"], weights: () => [255] },
      walls: [
        { pts: rectPts(2, 2, 26, 16), loop: true, type: 1, texture: "stone" },
        { pts: rectPts(28, 6, 33, 11), loop: true, type: 1, texture: "stone" },
      ],
      patterns: [
        { pts: rectPts(3, 8, 25, 10), texture: "simple/tileset_cobble" },
        { pts: rectPts(3, 3, 25, 7.5), texture: "simple/tileset_wood_interlaced" },
        { pts: rectPts(3, 10.5, 25, 13), texture: "simple/tileset_wood_interlaced" },
        { pts: rectPts(28.5, 6.5, 32.5, 10.5), texture: "simple/tileset_cobble" },
      ],
    }] });
    const r = run(text, "0", { pps: 16 });
    const L = raster(r.sidecar, 16);
    const R = r.sidecar.meta.rect;
    const area = (role: number, x: number, y: number) => L.area.get(role as never)?.[at(L, R, 16, x, y)] ?? 0;
    const snow = (x: number, y: number) => L.terrain.get(TR.SNOW)?.[at(L, R, 16, x, y)] ?? 0;
    // Together the houses and the street cover more than half the town: still outdoors.
    expect([area(AR.PAVED, 14, 9), area(AR.FLOOR, 14, 9)]).toEqual([255, 0]);
    expect([snow(14, 14.5), area(AR.FLOOR, 14, 14.5)]).toEqual([255, 0]);
    expect(area(AR.FLOOR, 14, 5)).toBe(255);
    expect([area(AR.FLOOR, 30.5, 8.5), area(AR.PAVED, 30.5, 8.5)]).toEqual([255, 0]);
    expect(area(AR.FLOOR, 28.3, 6.3)).toBe(255); // the room's edge, outside its pattern
    expect(snow(34.5, 14)).toBe(255);
    expect(r.report.warnings).toEqual([]);
  });

  it("a cobbled pattern in the open stays PAVED; mirrored and turned, it lands where the map puts it", () => {
    const tm = transformsMap();
    const r = run(tm.text, tm.levelKey, { pps: 16 }, SPRITE_SIZES);
    const pat = r.sidecar.shapes.filter((s) => s.role === AR.PAVED);
    expect(pat.length).toBe(1);
    const L = raster(r.sidecar, 16);
    expect(L.area.get(AR.PAVED)![at(L, r.sidecar.meta.rect, 16, 14.4, 7.3)]).toBe(255);
  });

  it("PATH_EARTH covers 0.55 of a default trail's ribbon; a pack path is PATH_KEEP, the whole ribbon", () => {
    const pl = pelcsLike();
    const r = run(pl.text, pl.groundKey, { pps: 24 });
    const path = r.map.world.levels.find((l) => l.key === pl.groundKey)!.paths[0];
    const rb = pathRibbon(path);
    let len = 0;
    for (let i = 2; i < rb.line.length; i += 2) len += Math.hypot(rb.line[i] - rb.line[i - 2], rb.line[i + 1] - rb.line[i - 1]);
    const shape = r.sidecar.shapes.find((s) => s.role === AR.PATH_EARTH)!;
    const alone: SeasonSidecar = { ...r.sidecar, terrain: null, bitmaps: [], shapes: [shape], objects: emptyObjects() };
    const A = raster(alone, 32);
    const sq = Array.from(A.area.get(AR.PATH_EARTH)!).reduce((s, v) => s + v / 255, 0) / (32 * 32);
    const want = (len / GRID) * (path.width / GRID) * 0.55;
    expect(Math.abs(sq - want) / want).toBeLessThan(0.05);
    const tm = transformsMap();
    const t = run(tm.text, tm.levelKey, { pps: 16 }, SPRITE_SIZES);
    expect(t.sidecar.shapes.some((s) => s.role === AR.PATH_KEEP)).toBe(true);
    // The pack crown is a thing, the pack cliff a path (6.1: "1 thing and 1 path come from asset packs").
    expect([t.report.packItems, t.report.packPaths, t.sidecar.meta.packItems]).toEqual([1, 1, 1]);
    expect(t.sidecar.shapes.filter((s) => s.role === AR.PATH_EARTH).length).toBe(1);
  });

  it("the pack share counts paths: a default trail and a pack path of the same size, nothing else, is half", () => {
    const text = mapText({ w: 16, h: 10, levels: [{
      key: "0", label: "Ground", terrain: { slots: ["terrain_snow"], weights: () => [255] },
      paths: [
        { at: [2, 3], pts: [[0, 0], [6, 0], [12, 0]], texture: "wagon_trail", width: 1 },
        { at: [2, 7], pts: [[0, 0], [6, 0], [12, 0]], texture: `${PACK_PREFIX}icy_cliff`, width: 1 },
      ],
    }] });
    const r = run(text, "0", { pps: 16 });
    expect([r.report.packItems, r.report.packPaths]).toEqual([0, 1]);
    expect(r.report.packShare).toBeCloseTo(0.5, 2);
    expect(r.sidecar.meta.packShare).toBe(r.report.packShare);
  });

  it("a pack roof is KEEP; a default roof ROOF", () => {
    const sn = snowyMap({ packRoof: true });
    const r = run(sn.text, sn.levelKey);
    const roofs = r.sidecar.shapes.filter((s) => s.layer === DD_LAYER.ROOF);
    expect(roofs.map((s) => s.role).sort()).toEqual([AR.ROOF, AR.KEEP].sort());
    const L = raster(r.sidecar, 16);
    const [x0, y0, x1, y1] = sn.layout.packRoof!;
    expect(L.area.get(AR.KEEP)![at(L, r.sidecar.meta.rect, 16, (x0 + x1) / 2, (y0 + y1) / 2)]).toBe(255);
  });

  it("water by the picture (2.6): orange water is KEEP; icy water on a snowy map ICE, on a green map KEEP", () => {
    const sn = snowyMap();
    const keep = run(sn.text, sn.levelKey, { opts: { water: ["KEEP"] } });
    expect(keep.report.water).toEqual(["KEEP"]);
    expect(keep.sidecar.shapes.filter((s) => s.layer === DD_LAYER.WATER).map((s) => s.role)).toEqual([AR.KEEP]);
    expect(run(sn.text, sn.levelKey, { opts: { water: ["ICE"] } }).report.water).toEqual(["ICE"]);
    const green = snowyMap({ green: true });
    expect(run(green.text, green.levelKey, { opts: { water: ["ICE"] } }).report.water).toEqual(["KEEP"]);
    expect(run(green.text, green.levelKey).report.water).toEqual(["WATER"]);
  });

  it("water drawn pale blue or cyan on a snowy map is ICE (the pixel path's ice test, ahead of its water test); on a green map not ICE", () => {
    const ring = rectPts(5, 3, 11, 7);
    const cases: Array<[readonly number[], boolean, string]> = [
      [[170, 236, 246], false, "ICE"], [[160, 190, 210], false, "ICE"], [[150, 170, 180], false, "ICE"], [[140, 180, 200], false, "ICE"],
      [FAKE_COLOURS.water, false, "WATER"], [[170, 236, 246], true, "KEEP"], [[140, 180, 200], true, "WATER"], [FAKE_COLOURS.keep, false, "KEEP"],
      // Navy as dark as ink: water-like, but the pixel path's guard never changes it (its water test is water x guard).
      [[10, 20, 43], true, "KEEP"], [[10, 20, 43], false, "KEEP"],
    ];
    for (const [colour, green, want] of cases) {
      const map = waterMap(ring, { green });
      const pic = fakeExportFromMap(map, "0", 32);
      paint(pic, 32, (x, y) => (x > 5 && x < 11 && y > 3 && y < 7 ? colour : null));
      const r = extractSidecar(map, "0", wholeMap(map), pic, FIXTURE_SPRITES, { levels: [] });
      expect(r.report.drawn).toBe(green ? "green" : "winter");
      expect(r.report.water, `${colour} on a ${green ? "green" : "snowy"} map`).toEqual([want]);
    }
  });

  it("water is judged outside the objects in it: a pond mostly under a grey boulder is WATER", () => {
    const map = waterMap(rectPts(5, 3.5, 11, 6.5), { objects: [{ name: "clutter/boulders/boulder_08", at: [8, 5], scale: 3 }] });
    const pic = fakeExportFromMap(map, "0", 32);
    // Most of the pond's middle (a quarter square in from its shore) shows the boulder, not water.
    let n = 0, rock = 0;
    for (let y = 3.75 * 32; y < 6.25 * 32; y++) for (let x = 5.25 * 32; x < 10.75 * 32; x++) {
      const o = (y * pic.w + x) * 4, c = FAKE_COLOURS.water;
      n++;
      if (Math.abs(pic.rgba[o] - c[0]) + Math.abs(pic.rgba[o + 1] - c[1]) + Math.abs(pic.rgba[o + 2] - c[2]) > 60) rock++;
    }
    expect(rock / n).toBeGreaterThan(0.55);
    const r = extractSidecar(map, "0", wholeMap(map), pic, FIXTURE_SPRITES, { levels: [] });
    expect(r.sidecar.objects.n).toBe(1);
    expect(r.report.water).toEqual(["WATER"]);
  });

  it("water is judged a quarter square in from its shore: a thin stream with a sandy shore band is WATER", () => {
    const [x0, y0, x1, y1] = [2, 4.5, 14, 5.4];
    const map = waterMap(rectPts(x0, y0, x1, y1));
    const pic = fakeExportFromMap(map, "0", 32);
    let band = 0, all = 0;
    paint(pic, 32, (x, y) => {
      if (!(x > x0 && x < x1 && y > y0 && y < y1)) return null;
      all++;
      if (Math.min(x - x0, x1 - x, y - y0, y1 - y) >= 0.27) return null;
      band++;
      return FAKE_COLOURS.keep;
    });
    expect(band / all).toBeGreaterThan(0.55);
    const r = extractSidecar(map, "0", wholeMap(map), pic, FIXTURE_SPRITES, { levels: [] });
    expect(r.report.water).toEqual(["WATER"]);
  });

  it("a cave: CAVE floor (step 64) and a CAVE_RIM band round it", () => {
    const sn = snowyMap({ cave: true });
    const r = run(sn.text, sn.levelKey);
    const cave = r.sidecar.bitmaps.find((b) => b.role === AR.CAVE)!;
    expect(cave.step).toBe(64);
    expect(r.sidecar.bitmaps.some((b) => b.role === AR.CAVE_RIM)).toBe(true);
    const L = raster(r.sidecar, 16);
    const R = r.sidecar.meta.rect;
    const [cx0, cy0, cx1] = sn.layout.cave!;
    expect(L.area.get(AR.CAVE)![at(L, R, 16, cx0 + 0.4, cy0 + 0.35)]).toBe(255); // (the pool is in its middle)
    expect(L.area.get(AR.CAVE_RIM)![at(L, R, 16, (cx0 + cx1) / 2, cy0 - 0.2)]).toBeGreaterThan(128);
    expect(L.area.get(AR.CAVE_RIM)?.[at(L, R, 16, (cx0 + cx1) / 2, cy0 - 0.8)] ?? 0).toBe(0);
    expect(r.report.water.length).toBe(2);
  });

  it("a cave's rim is left out where the cave is blasted open (its entrance)", () => {
    const sn = snowyMap({ cave: true });
    const map = parseDungeondraftMap(sn.text);
    const cave = map.world.levels[0].cave!;
    const f = cave.floor!;
    const bits = new Uint8Array(f.bits.length);
    for (let j = 0; j < f.height; j++) for (let i = 0; i < f.width; i++) {
      const x = ((i - MS_EDGE_BUFFER) * f.step) / GRID, y = ((j - MS_EDGE_BUFFER) * f.step) / GRID;
      if (x >= 1.5 && x <= 2.5 && y >= 9 && y <= 10.25) bits[j * f.width + i] = 1;
    }
    cave.entrance = { ...f, bits };
    const pic = fakeExportFromMap(parseDungeondraftMap(sn.text), sn.levelKey, 32);
    const r = extractSidecar(map, sn.levelKey, wholeMap(map), pic, FIXTURE_SPRITES, { levels: [] });
    const L = raster(r.sidecar, 16);
    const R = r.sidecar.meta.rect;
    const cy0 = sn.layout.cave![1];
    expect(L.area.get(AR.CAVE_RIM)?.[at(L, R, 16, 2, cy0 - 0.2)] ?? 0).toBe(0);
    expect(L.area.get(AR.CAVE_RIM)![at(L, R, 16, 1, cy0 - 0.2)]).toBeGreaterThan(128);
    expect(L.area.get(AR.CAVE_RIM)![at(L, R, 16, 3, cy0 - 0.2)]).toBeGreaterThan(128);
  });
});

function emptyObjects(): SeasonSidecar["objects"] {
  return { n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0),
    flags: new Uint8Array(0), name: new Uint16Array(0), reach: new Uint16Array(0) };
}

// ------------------------------------------------------------------ terrain weights

describe("terrain weights", () => {
  const sn = snowyMap();
  const pic = fakeExportFromMap(parseDungeondraftMap(sn.text), sn.levelKey, 16);
  /** The snowy map with the texels of squares x0..x1 (all rows) given weights by `f`. */
  const edited = (x0: number, x1: number, f: (w: number) => number) => {
    const m = parseDungeondraftMap(sn.text);
    const t = m.world.levels[0].terrain!;
    const n = t.width * t.height;
    for (let s = 0; s < t.slotCount; s++) for (let y = 0; y < t.height; y++) for (let x = x0 * 4; x < x1 * 4; x++) {
      t.weights[s * n + y * t.width + x] = f(t.weights[s * n + y * t.width + x]);
    }
    return m;
  };

  it("texels saved under 255 (older maps) are scaled to sum to 255", () => {
    const m = edited(0, 10, (w) => Math.round(w * 0.6));
    const r = extractSidecar(m, "0", wholeMap(m), pic, FIXTURE_SPRITES, { levels: [] });
    const t = r.sidecar.terrain!;
    const n = t.tw * t.th;
    for (const tx of [2, 20, 38]) {
      let sum = 0;
      for (let k = 0; k < t.slots.length; k++) sum += t.w[k * n + 20 * t.tw + tx];
      expect(Math.abs(sum - 255), `texel ${tx}`).toBeLessThanOrEqual(2);
    }
    expect(r.report.warnings).toEqual([]);
  });

  it("texels with next to no weight (a mod's slot) stay empty, and the GM is told", () => {
    const m = edited(0, 3, () => 0);
    const r = extractSidecar(m, "0", wholeMap(m), pic, FIXTURE_SPRITES, { levels: [] });
    const t = r.sidecar.terrain!;
    expect(t.w[20 * t.tw + 2]).toBe(0);
    expect(r.report.warnings).toContain("Some terrain couldn't be read (a mod?): it stays as drawn.");
  });

  it.skipIf(!havePair(SAMPLE_PAIRS.find((p) => p.map === "hd_forest")!))("hd_forest (sums of 125-255 saved) reads without a warning", () => {
    const map = parseDungeondraftMap(sampleText("hd_forest"));
    const fpic = atPxPerSquare(readPicture("hd_forest.png"), 48, 27, 16);
    const r = extractSidecar(map, "0", wholeMap(map), fpic, SPRITE_SIZES, { levels: [] });
    expect(r.report.warnings.filter((w) => /terrain/.test(w))).toEqual([]);
  });
});

// ------------------------------------------------------------------ caps and the preview

describe("caps and the preview", () => {
  it("over 20,000 objects: \"This map is too big for exact seasons.\"", () => {
    const s = scatterMap(1);
    const map = parseDungeondraftMap(s.text);
    const L = map.world.levels[0];
    const base = L.objects[0];
    for (let i = 0; i < 20_001; i++) L.objects.push({ ...base, position: { x: (i % 200) * 25, y: Math.floor(i / 200) * 30 }, index: L.objects.length });
    const pic = fakeExportFromMap(parseDungeondraftMap(s.text), "0", 8);
    expect(() => extractSidecar(map, "0", wholeMap(map), pic, FIXTURE_SPRITES, { levels: [] })).toThrow("This map is too big for exact seasons.");
  });

  it("bounded work: thousands of walled rooms over thousands of paving patterns finish, the rooms left unchecked said so", () => {
    const s = scatterMap(1);
    const map = parseDungeondraftMap(s.text);
    const L = map.world.levels[0];
    const ring = (x0: number, y0: number, x1: number, y1: number) => Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1].map((v) => v * GRID));
    const wall = { ...parseDungeondraftMap(interiorsMap().text).world.levels[0].walls[0] };
    const pattern = parseDungeondraftMap(transformsMap().text).world.levels[0].patterns[0];
    for (let i = 0; i < 3000; i++) {
      // A 6 x 6 room (36 square squares), and a paving pattern over most of the map, mostly outside it.
      L.walls.push({ ...wall, points: ring(2, 2, 8, 8), loop: true, portals: [] });
      L.patterns.push({ ...pattern, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, shapeRotation: 0, points: ring(1, 1, 19, 11) });
    }
    const pic = fakeExportFromMap(parseDungeondraftMap(s.text), "0", 16);
    const t0 = performance.now();
    const r = extractSidecar(map, "0", wholeMap(map), pic, FIXTURE_SPRITES, { levels: [] });
    const ms = performance.now() - t0;
    console.log(`3,000 rooms and 3,000 paving patterns: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(10_000);
    expect(r.report.warnings).toContain("This map has more walled rooms than could all be checked; paving in some of them counts as outdoors.");
    expect(r.sidecar.shapes.filter((x) => x.role === AR.PAVED).length).toBe(3000);
    expect(EXTRACT.loopWork).toBeGreaterThan(0);
  });

  it("bounded work on floors: big wall loops over 15,000 tiny floor polygons finish quickly; too many polygons, or too much work filling or clipping them, are refused at once", () => {
    const s = scatterMap(1);
    const ring = (x0: number, y0: number, x1: number, y1: number) => Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1].map((v) => v * GRID));
    const wall = { ...parseDungeondraftMap(interiorsMap().text).world.levels[0].walls[0] };
    const pic = fakeExportFromMap(parseDungeondraftMap(s.text), "0", 16);
    const timed = (f: () => void) => { const t0 = performance.now(); f(); return performance.now() - t0; };
    // 40 big loops (yards: no work) and 15,000 tiny polygons, no tiles.
    const a = parseDungeondraftMap(s.text);
    const La = a.world.levels[0];
    for (let i = 0; i < 40; i++) La.walls.push({ ...wall, points: ring(1, 1, 19, 11), loop: true, portals: [] });
    La.tiles = null;
    for (let i = 0; i < 15_000; i++) {
      const x = GRID + ((i * 7919) % (18 * GRID)), y = GRID + ((i * 104729) % (10 * GRID));
      La.floorPolygons.push(Float64Array.from([x, y, x + 1, y, x, y + 1]));
    }
    const msA = timed(() => extractSidecar(a, "0", wholeMap(a), pic, FIXTURE_SPRITES, { levels: [] }));
    // 25,000 tiny polygons (next to no work): more rings than a sidecar holds.
    const b = parseDungeondraftMap(s.text);
    b.world.levels[0].tiles = null;
    for (let i = 0; i < 25_000; i++) {
      const x = GRID + ((i * 7919) % (18 * GRID)), y = GRID + ((i * 104729) % (10 * GRID));
      b.world.levels[0].floorPolygons.push(Float64Array.from([x, y, x + 1, y, x, y + 1]));
    }
    const msB = timed(() => expect(() => extractSidecar(b, "0", wholeMap(b), pic, FIXTURE_SPRITES, { levels: [] })).toThrow("This map is too big for exact seasons."));
    // 19,000 polygons each over the whole 60 x 60 map, on a checkerboard of tiles: refused by the work it would take.
    const c = parseDungeondraftMap(s.text);
    c.world.width = 60;
    c.world.height = 60;
    const cells = new Int32Array(60 * 60);
    for (let i = 0; i < cells.length; i++) cells[i] = ((i % 60) + Math.floor(i / 60)) % 2 ? 0 : -1;
    c.world.levels[0].tiles = { cells, width: 60, height: 60, colors: null, lookup: new Map() };
    for (let i = 0; i < 19_000; i++) c.world.levels[0].floorPolygons.push(ring(0, 0, 60, 60));
    const msC = timed(() => expect(() => extractSidecar(c, "0", wholeMap(c), pic, FIXTURE_SPRITES, { levels: [] })).toThrow("This map is too big for exact seasons."));
    // 2,000 of them: little to fill, but clipped to each of the 1,800 tiled cells, 3.6 million rings: refused on the way.
    c.world.levels[0].floorPolygons.length = 2000;
    const msE = timed(() => expect(() => extractSidecar(c, "0", wholeMap(c), pic, FIXTURE_SPRITES, { levels: [] })).toThrow("This map is too big for exact seasons."));
    // 19,000 polygons over the whole map, no tiles, a 1280 x 768 picture: refused before measuring
    // fills them all in (that took 5 s, and grows with the picture's rows).
    const d = parseDungeondraftMap(s.text);
    d.world.levels[0].tiles = null;
    for (let i = 0; i < 19_000; i++) d.world.levels[0].floorPolygons.push(ring(0, 0, 20, 12));
    const big = fakeExportFromMap(parseDungeondraftMap(s.text), "0", 64);
    const msD = timed(() => expect(() => extractSidecar(d, "0", wholeMap(d), big, FIXTURE_SPRITES, { levels: [] })).toThrow("This map is too big for exact seasons."));
    console.log(`floors: 15,000 tiny polygons ${msA.toFixed(0)} ms; 25,000 refused in ${msB.toFixed(0)} ms; 19,000 over a checkerboard refused in ${msC.toFixed(0)} ms, 2,000 in ${msE.toFixed(0)} ms; 19,000 over a big picture refused in ${msD.toFixed(0)} ms`);
    // Timed alone (PERF=1) the bounds are tight; in the full suite they only catch a real slowdown.
    const perf = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PERF;
    expect(msA).toBeLessThan(perf ? 500 : 2000);
    expect(msB).toBeLessThan(perf ? 100 : 1000);
    expect(msC).toBeLessThan(perf ? 100 : 1000);
    expect(msD).toBeLessThan(perf ? 100 : 1000);
    expect(msE).toBeLessThan(perf ? 500 : 2000);
  });

  it("previewSize: the long side is `size`, the other by the aspect", () => {
    expect(previewSize(640, 384, 512)).toEqual([512, 307]);
    expect(previewSize(384, 640, 512)).toEqual([307, 512]);
    expect(previewSize(1, 4000, 100)).toEqual([1, 100]);
  });

  it("the preview is the picture at its size with the layers over it: water blue, roof grey, snow hatched", () => {
    const sn = snowyMap();
    const r = run(sn.text, sn.levelKey);
    const pv = previewOverlay(r.sidecar, r.picture, 512);
    expect(pv.length).toBe(512 * 307 * 4);
    const pps = 512 / 20;
    const px = (x: number, y: number) => (Math.floor(y * pps) * 512 + Math.floor(x * pps)) * 4;
    const w = px(3.6, 3.6);
    expect(pv[w + 2]).toBeGreaterThan(pv[w] + 40); // blue
    const roof = px(16, 1.5);
    expect(Math.abs(pv[roof] - pv[roof + 2])).toBeLessThan(30); // grey
    // Snow: the hatch lines (every 6th diagonal pair) are paler than the picture between them.
    let on = 0, off = 0, nOn = 0, nOff = 0;
    for (let y = 20; y < 40; y++) for (let x = 20; x < 60; x++) {
      const o = (y * 512 + x) * 4, v = pv[o] + pv[o + 1] + pv[o + 2];
      if ((x + y) % 6 < 2) { on += v; nOn++; } else { off += v; nOff++; }
    }
    expect(on / nOn).toBeGreaterThan(off / nOff + 15);
    const tall = previewOverlay(r.sidecar, { rgba: r.picture.rgba, w: r.picture.w, h: r.picture.h }, 100);
    expect(tall.length).toBe(100 * 60 * 4);
  });
});

// ------------------------------------------------------------------ waterfall

describe("waterfall (Vern's map, committed)", () => {
  const map = parseDungeondraftMap(waterfallText());
  const pic = fakeExportFromMap(map, "0", 16, { water: ["KEEP"] });
  const { sidecar: sc, report } = extractSidecar(map, "0", wholeMap(map), pic, SPRITE_SIZES, { levels: [] });

  it("the role counts of 4.1", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < sc.objects.n; i++) counts.set(runtimeRole(sc, i), (counts.get(runtimeRole(sc, i)) ?? 0) + 1);
    expect(Object.fromEntries([...counts].sort((a, b) => a[0] - b[0]))).toEqual({
      [OR.EVERGREEN]: 27, [OR.DECIDUOUS]: 2, [OR.BARE]: 8, [OR.GRASS]: 21, [OR.REEDS]: 7, [OR.DEADWOOD]: 1, [OR.STUMP]: 1,
      [OR.ROCK]: 2, [OR.WATER_FX]: 1, [OR.OPAQUE]: 1,
    });
    expect(sc.shapes.filter((s) => s.role === AR.PATH_KEEP).length).toBe(2);
    // 1 pack rock and 2 pack cliff paths (1.2): "1 thing and 2 paths come from asset packs".
    expect([report.packItems, report.packPaths, sc.meta.packItems]).toEqual([1, 2, 1]);
  });

  it("snow on 81.1% of the texels, rock the rest; snowShare 1; rect 0,0 to 12800 x 8960", () => {
    const t = sc.terrain!;
    const n = t.tw * t.th;
    let snow = 0, all = 0;
    t.slots.forEach((s, k) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += t.w[k * n + i];
      all += sum;
      if (s.role === TR.SNOW) snow += sum;
    });
    expect(Math.abs((100 * snow) / all - 81.1)).toBeLessThan(0.2);
    expect(t.slots.every((s) => s.role === TR.SNOW || s.role === TR.ROCK)).toBe(true);
    expect(sc.meta.snowShare).toBe(1);
    expect(report.drawn).toBe("winter");
    expect(sc.meta.rect).toEqual([0, 0, 12800, 8960]);
  });

  it("water: one body with 6 islands, KEEP when the picture shows it yellow-orange; a cave bitmap", () => {
    const water = sc.shapes.filter((s) => s.layer === DD_LAYER.WATER);
    expect(water.map((s) => [s.ringEnds.length, s.rule])).toEqual([[7, 0]]);
    expect(report.water).toEqual(["KEEP"]);
    expect(sc.bitmaps.some((b) => b.role === AR.CAVE && b.step === 64)).toBe(true);
  });

  it.skipIf(!haveVernExport("waterfall.vtt"))("on Vern's 1.2 export: the same, with its yellow-orange water KEEP and nothing dropped", () => {
    const full = vernPicture("waterfall.vtt");
    const rect = pictureRect(map, full.w, full.h, full.vtt) as PictureRect;
    expect(rect.rect).toEqual([0, 0, 12800, 8960]);
    const p = atPxPerSquare(full, 50, 35, 32);
    const t0 = performance.now();
    const r = extractSidecar(map, "0", rect, p, SPRITE_SIZES, { levels: [], picSize: [full.w, full.h] });
    const ms = performance.now() - t0;
    console.log(`waterfall on Vern's export at 32 px a square: ${ms.toFixed(0)} ms, fit ${r.report.fit.verdict} (lead ${r.report.fit.lead.toFixed(2)}, sharp ${r.report.fit.sharp.toFixed(2)}), ` +
      `dropped ${r.report.dropped}, water ${r.report.water}, packShare ${r.report.packShare}, ${encodeSidecar(r.sidecar).length} bytes`);
    expect(r.report.water).toEqual(["KEEP"]);
    expect(r.report.dropped).toBe(0);
    expect(r.report.fit.verdict).not.toBe("no");
    expect(r.report.gridPxPerSquare).toBe(72);
    expect(r.sidecar.objects.n).toBe(71);
    expect([r.report.packItems, r.report.packPaths]).toEqual([1, 2]);
  });
});

// ------------------------------------------------------------------ the public samples

/** A sample pair at 24 px a square: its rectangle from the .dd2vtt or the whole map, its level from the pair or rankLevels. */
function loadSample(p: SamplePair): { map: DDMap; key: string; rect: PictureRect; pic: PictureSample } {
  const map = parseDungeondraftMap(sampleText(p.map));
  const full = readPicture(p.picture);
  const rect = pictureRect(map, full.w, full.h, full.vtt) as PictureRect;
  const pic = atPxPerSquare(full, (rect.rect[2] - rect.rect[0]) / GRID, (rect.rect[3] - rect.rect[1]) / GRID, 24);
  return { map, key: p.level ?? chooseLevel(rankLevels(map, pic, rect, full.vtt))!.key, rect, pic };
}

describe("the public samples (DD_FIXTURES)", () => {
  const SNOW: Record<string, number> = { fs_pelcs: 0.998, fs_tulgi: 0.85, fs_cavern: 1 };
  for (const p of SAMPLE_PAIRS) {
    it.skipIf(!havePair(p))(`${p.map}: compiles, encodes, ${p.snowy ? "snowy" : "green"}`, () => {
      const map = parseDungeondraftMap(sampleText(p.map));
      const full = readPicture(p.picture);
      const rect = pictureRect(map, full.w, full.h, full.vtt) as PictureRect;
      const pic = atPxPerSquare(full, (rect.rect[2] - rect.rect[0]) / GRID, (rect.rect[3] - rect.rect[1]) / GRID, 24);
      const ranks = rankLevels(map, pic, rect, full.vtt);
      const choice = chooseLevel(ranks)!;
      if (p.level) expect(choice.key).toBe(p.level);
      const t0 = performance.now();
      const r = extractSidecar(map, choice.key, rect, pic, SPRITE_SIZES, { levels: ranks, holdLevel: !choice.clear });
      const ms = performance.now() - t0;
      const bytes = encodeSidecar(r.sidecar);
      console.log(`${p.map}: level ${choice.key} (${ranks[0].why}${choice.clear ? "" : ", unclear"}), ${ms.toFixed(0)} ms, ${bytes.length} bytes, ` +
        `fit ${r.report.fit.verdict}, snowShare ${r.report.snowShare}, packShare ${r.report.packShare}, dropped ${r.report.dropped}/${r.report.dropped + r.report.objects}, water ${r.report.water}`);
      expect(r.report.drawn).toBe(p.snowy ? "winter" : "green");
      if (SNOW[p.map] !== undefined) expect(Math.abs(r.report.snowShare - SNOW[p.map])).toBeLessThan(0.02);
      expect(decodeSidecar(bytes)).toEqual(r.sidecar);
      expect(r.report.fit.verdict).not.toBe("no");
      // Privacy (3.5): no paths, pack ids or names, portals, lights, editor state, level label or file name.
      const text = latin1(bytes);
      const label = map.world.levels.find((l) => l.key === choice.key)!.label;
      const words = ["res://", "packs/", "portal", "light", "editor_state", p.map, label, ...map.header.packs.flatMap((q) => [q.id, q.name])];
      expect(words.filter((w) => w.length > 0 && text.includes(w))).toEqual([]);
    });
  }

  it.skipIf(!havePair(SAMPLE_PAIRS.find((p) => p.map === "hd_mill")!))("the Mill: indoors inside its closed wood wall, by its wood pattern (4.1)", () => {
    const map = parseDungeondraftMap(sampleText("hd_mill"));
    const full = readPicture("hd_mill.png");
    const pic = atPxPerSquare(full, 35, 20, 16);
    const r = extractSidecar(map, "0", wholeMap(map), pic, SPRITE_SIZES, { levels: [] });
    const loops = map.world.levels[0].walls.filter((w) => w.loop && w.type !== 2);
    expect(loops.length).toBe(1);
    // A 70-square loop: not a room by size, so its floor is the wood pattern's (FLOOR).
    expect(r.sidecar.shapes.filter((s) => s.layer !== DD_LAYER.WALL && s.role !== AR.WATER).map((s) => s.role)).toContain(AR.FLOOR);
    const L = raster(r.sidecar, 8);
    let n = 0, indoor = 0;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (!inRing(loops[0].points, ((x + 0.5) * GRID) / 8, ((y + 0.5) * GRID) / 8)) continue;
      n++;
      const i = y * L.w + x;
      const objects = [...L.objects.values()].some((m) => m[i] >= 128);
      if (objects || (L.area.get(AR.FLOOR)?.[i] ?? 0) + (L.area.get(AR.WALL)?.[i] ?? 0) >= 128) indoor++;
    }
    console.log(`the Mill: ${(n / 64).toFixed(1)} squares inside its wall, ${((100 * indoor) / n).toFixed(1)}% indoor or under things`);
    expect(indoor / n).toBeGreaterThan(0.98);
  });

  const tulgi = SAMPLE_PAIRS.find((p) => p.map === "fs_tulgi")!;
  it.skipIf(!havePair(tulgi))("the samples moved by whole squares: lined up by exactly the correction (river, Tulgi, Pelcs every time), or held with it offered", () => {
    const always = new Set(["hd_river", "fs_tulgi", "fs_pelcs"]);
    const lines: string[] = [];
    for (const p of SAMPLE_PAIRS) {
      if (!havePair(p)) continue;
      const s = loadSample(p);
      for (const [dx, dy] of [[2, 0], [0, -1], [1, 0], [0, 2]] as const) {
        const moved: PictureRect = { rect: [s.rect.rect[0] + dx * GRID, s.rect.rect[1] + dy * GRID, s.rect.rect[2] + dx * GRID, s.rect.rect[3] + dy * GRID] };
        const r = extractSidecar(s.map, s.key, moved, s.pic, SPRITE_SIZES, { levels: [] });
        const f = r.report.fit;
        lines.push(`${p.map} moved ${dx},${dy}: ${f.verdict}, shifted ${r.report.shifted ?? "-"}, hold ${r.report.hold}, shiftSq ${f.shiftSq ?? "-"}`);
        if (r.report.shifted) {
          expect(r.report.shifted, p.map).toEqual([dx, dy]);
          expect(f.verdict, p.map).toBe("yes");
          expect(r.sidecar.meta.rect).toEqual(s.rect.rect);
        } else if (f.verdict === "no") {
          expect(r.report.hold, p.map).toBe("fit");
          if (f.shiftSq) expect(f.shiftSq, p.map).toEqual([dx, dy]);
        }
        if (always.has(p.map)) expect(r.report.shifted, `${p.map} moved ${dx},${dy}`).toEqual([dx, dy]);
      }
    }
    for (const p of SWAPPED_PAIRS) {
      if (!havePair(p)) continue;
      const s = loadSample(p);
      const r = extractSidecar(s.map, s.key, s.rect, s.pic, SPRITE_SIZES, { levels: [] });
      lines.push(`swapped ${p.map} on ${p.picture}: ${r.report.fit.verdict}, shifted ${r.report.shifted ?? "-"}`);
      expect(r.report.fit.verdict).not.toBe("yes");
      expect(r.report.shifted).toBeUndefined();
    }
    console.log(lines.join("\n"));
  }, 120_000);
});


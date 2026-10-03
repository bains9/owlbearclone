// The exact-seasons fixtures (WP9): the synthetic maps parse as intended, the hand-built sidecars
// are valid and say what the map text says, the fake exports look as the colour gates of
// seasonPixels.ts expect and follow their options (erase, shift, crop, size, grid), and the
// DD_FIXTURES / DD_VERN readers work when those folders are present (they skip otherwise).
// Renders go to DD_RENDERS (renders/fixtures in the design's working folder) for a human look.
import { describe, expect, it } from "vitest";
import { parseDungeondraftMap } from "../src/client/dd/parse";
import { GRID, type DDMap } from "../src/client/dd/model";
import { REACH_DIRS, rasterSidecar, type SidecarLayers } from "../src/client/dd/raster";
import { AR, NAMED_ROLES, OR, TR, defaultName, materialRole, objectRole, type ObjectRole } from "../src/client/dd/roles";
import {
  DD_LAYER, NO_NAME, OBJ_FLAG, REACH_N, SIDECAR_UNITS, decodeSidecar, encodeSidecar, type ObjectTable, type SeasonSidecar,
} from "../src/client/dd/sidecar";
import { alignDd2vtt, alignPlainImage, matchDd2vttLevel } from "../src/client/dd/align";
import { priorReach } from "../src/client/dd/measure";
import { SPRITE_SIZES } from "../src/client/dd/spriteSizes";
import { colourTable, lutIndex } from "../src/client/room/seasonPixels";
import {
  FIXTURE_SPRITES, PACK_ID, PACK_NAME, PACK_PREFIX, PACK_SPRITE, croppedDd2vtt, dd2vttText, editedPicture, fitPairs, frozenLake,
  interiorsMap, jaggedEdge, mapText, pelcsLike, scatterMap, sidecarSnowShare, snowyMap, transformsMap, twinLevels, worldReach, type Pt,
} from "./fixtures/ddSynthetic";
import { FAKE_COLOURS, INK, fakeExport, fakeExportFromMap, pictureSidecar, type FakePicture } from "./fixtures/fakeExport";
import {
  DD_FIXTURES, DD_VERN, SAMPLE_PAIRS, SWAPPED_PAIRS, atPxPerSquare, dd2vttPicture, downsample, encodePng, havePair, haveSample,
  haveSamples, haveVern, haveVernExport, pngPicture, readPicture, sampleText, vernPicture, vttMetaOf, waterfallText, writeRender,
} from "./helpers/ddFixtures";

const T = colourTable();
/** The colour table's channel (0 vegetation, 1 water, 2 guard, 3 snow) of pixel i. */
const chan = (p: FakePicture, i: number, c: number) => T[lutIndex(p.rgba[i * 4], p.rgba[i * 4 + 1], p.rgba[i * 4 + 2]) + c];
const rgbAt = (p: FakePicture, i: number) => [p.rgba[i * 4], p.rgba[i * 4 + 1], p.rgba[i * 4 + 2]];
/** Pixel index of the point (x, y) in squares on a whole-map picture at pps. */
const px = (p: FakePicture, pps: number, x: number, y: number) => Math.floor(y * pps) * p.w + Math.floor(x * pps);

function share(n: number, test: (i: number) => boolean, where: (i: number) => boolean): { share: number; count: number } {
  let k = 0, m = 0;
  for (let i = 0; i < n; i++) if (where(i)) { m++; if (test(i)) k++; }
  return { share: m ? k / m : NaN, count: m };
}

const snowy = snowyMap();
const snowyParsed = parseDungeondraftMap(snowy.text);

// ------------------------------------------------------------------ the map texts

describe("synthetic maps parse as intended", () => {
  it("the snowy map: terrain, water, the hut, roof, objects and the pack", () => {
    const m = snowyParsed;
    expect(m.warnings).toEqual([]);
    expect([m.world.width, m.world.height, m.world.format]).toEqual([20, 12, 3]);
    expect(m.header.packs.map((p) => [p.id, p.name])).toEqual([[PACK_ID, PACK_NAME]]);
    const L = m.world.levels[0];
    expect(L.key).toBe(snowy.levelKey);
    expect(L.terrain!.slots.slice(0, 4).map(defaultName)).toEqual(["terrain_snow", "terrain_grass", "terrain_rocky", "terrain_dirt"]);
    const n = L.terrain!.width * L.terrain!.height;
    const at = (s: number, x: number, y: number) => L.terrain!.weights[s * n + Math.floor(y * 4) * L.terrain!.width + Math.floor(x * 4)];
    expect([at(0, 6, 8), at(1, 18, 10), at(2, 1, 11)]).toEqual([255, 255, 255]);
    for (let i = 0; i < n; i++) expect(L.terrain!.weights[i] + L.terrain!.weights[n + i] + L.terrain!.weights[2 * n + i] + L.terrain!.weights[3 * n + i]).toBe(255);
    const bodies = L.water.root!.children;
    expect(bodies.length).toBe(1);
    expect(bodies[0].children.map((c) => c.depth)).toEqual([2]);
    expect(L.walls.length).toBe(1);
    expect(L.walls[0].loop).toBe(true);
    expect(L.walls[0].portals.length).toBe(1);
    expect(L.floorPolygons.length).toBe(1);
    expect(Array.from(L.tiles!.cells).filter((c) => c >= 0).length).toBe(16);
    expect(L.roofs.length).toBe(1);
    expect(L.lights.length).toBe(1);
    const roles = L.objects.map((o) => objectRole(defaultName(o.texture)));
    const { pine, oak, dead, boulder, crate, pack, roofSnow, tufts } = snowy.objects;
    expect([roles[pine], roles[oak], roles[dead], roles[boulder], roles[crate], roles[pack], roles[roofSnow]])
      .toEqual([OR.EVERGREEN, OR.DECIDUOUS, OR.BARE, OR.ROCK, OR.STRUCTURE, OR.OPAQUE, OR.SNOW]);
    expect(tufts.map((i) => roles[i])).toEqual(tufts.map(() => OR.GRASS));
    expect(L.objects[pack].texture!.source).toBe("pack");
    expect(L.objects[roofSnow].layer).toBe(900);
    // At least 8 default objects for the object-centre fit (2.4).
    expect(roles.filter((r) => r !== OR.OPAQUE).length).toBeGreaterThanOrEqual(8);
  });

  it("the snowy map's variants: a cave with a pool; green", () => {
    const cave = parseDungeondraftMap(snowyMap({ cave: true }).text).world.levels[0];
    expect(cave.cave!.floor).not.toBeNull();
    expect(cave.water.root!.children.length).toBe(2);
    const green = parseDungeondraftMap(snowyMap({ green: true }).text).world.levels[0];
    expect(defaultName(green.terrain!.slots[0])).toBe("terrain_grass");
    expect(snowyMap({ green: true }).sidecar.meta.snowShare).toBe(0);
  });

  it("the snowy map with a pack roof: a second roof from the pack, KEEP in the sidecar (4.1)", () => {
    const sm = snowyMap({ packRoof: true });
    const L = parseDungeondraftMap(sm.text).world.levels[0];
    expect(L.roofs.length).toBe(2);
    expect(L.roofs[1].texture!.source).toBe("pack");
    expect(defaultName(L.roofs[1].texture)).toBeNull();
    const [x0, y0, x1, y1] = sm.layout.packRoof!;
    const pps = 16;
    const R = rasterSidecar(sm.sidecar, { w: sm.w * pps, h: sm.h * pps });
    expect(cover(R, pps, "area", AR.KEEP, (x0 + x1) / 2, (y0 + y1) / 2)).toBe(255);
    expect(cover(R, pps, "area", AR.ROOF, (x0 + x1) / 2, (y0 + y1) / 2)).toBe(0);
    // The picture's own compile of the text agrees.
    const P = rasterSidecar(pictureSidecar(parseDungeondraftMap(sm.text), sm.levelKey), { w: sm.w * pps, h: sm.h * pps });
    expect(cover(P, pps, "area", AR.KEEP, (x0 + x1) / 2, (y0 + y1) / 2)).toBe(255);
    // Clear of every object, and on the snow.
    expect(R.top[Math.floor(((y0 + y1) / 2) * pps) * R.w + Math.floor(((x0 + x1) / 2) * pps)]).toBe(0);
    expect(x1).toBeLessThanOrEqual(sm.layout.snowEdge[0] + 1);
  });

  it("mapText writes materials: ice, lava, cobbles and a pack's, 2 samples a square", () => {
    const text = mapText({ w: 8, h: 6, levels: [{ key: "0", label: "Ground", terrain: { slots: ["terrain_snow"], weights: () => [255] }, materials: [
      { texture: "ice_tile", rects: [[1, 1, 3, 3]] },
      { texture: "lava_tile", rects: [[4, 1, 5, 2]] },
      { texture: "cobblestone_tile", rects: [[1, 4, 7, 5]], layer: -200 },
      { texture: `${PACK_PREFIX}frost_moss`, rects: [[6, 1, 7, 2]] },
    ] }] });
    const m = parseDungeondraftMap(text);
    expect(m.warnings).toEqual([]);
    const mats = m.world.levels[0].materials;
    expect(mats.length).toBe(4);
    const byName = new Map(mats.map((x) => [x.texture!.source === "pack" ? "pack" : defaultName(x.texture)!, x]));
    expect(materialRole(defaultName(byName.get("ice_tile")!.texture))).toBe(AR.ICE);
    expect(materialRole(defaultName(byName.get("lava_tile")!.texture))).toBe(AR.KEEP);
    expect(materialRole(defaultName(byName.get("cobblestone_tile")!.texture))).toBe(AR.PAVED);
    expect(materialRole(defaultName(byName.get("pack")!.texture))).toBe(AR.KEEP);
    expect(byName.get("cobblestone_tile")!.layer).toBe(-200);
    expect(byName.get("ice_tile")!.layer).toBe(DD_LAYER.BELOW_GROUND);
    // The ice's mask: samples every half square, sample i at world (i - 1) * 128.
    const g = byName.get("ice_tile")!.mask!;
    expect([g.step, g.width, g.height]).toEqual([GRID / 2, 8 * 2 + 3, 6 * 2 + 3]);
    const bit = (x: number, y: number) => g.bits[(y * 2 + 1) * g.width + (x * 2 + 1)];
    expect([bit(1, 1), bit(2, 2), bit(3, 3), bit(3.5, 2), bit(0.5, 2), bit(4, 1)]).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it("the frozen lake: water more than 3 squares from every shore, an island off the middle", () => {
    const fl = frozenLake();
    const L = parseDungeondraftMap(fl.text).world.levels[0];
    expect(L.water.root!.children.length).toBe(1);
    expect(L.water.root!.children[0].children.length).toBe(1);
    expect(fl.deepDistance).toBeGreaterThan(3.5);
    const pps = 16;
    const R = rasterSidecar(fl.sidecar, { w: fl.w * pps, h: fl.h * pps });
    const water = R.area.get(AR.WATER)!;
    // At least 3 square² of water lies over 3.25 squares from every shore; the island is dry.
    let open = 0;
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
      if (water[y * R.w + x] === 255 && fl.shoreDistance((x + 0.5) / pps, (y + 0.5) / pps) > 3.25) open++;
    }
    expect(open / (pps * pps)).toBeGreaterThan(3);
    expect(cover(R, pps, "area", AR.WATER, fl.deep[0], fl.deep[1])).toBe(255);
    const ic = fl.island.reduce((a, p) => [a[0] + p[0] / fl.island.length, a[1] + p[1] / fl.island.length], [0, 0]);
    expect(cover(R, pps, "area", AR.WATER, ic[0], ic[1])).toBe(0);
    expect(cover(R, pps, "terrain", TR.SNOW, ic[0], ic[1])).toBe(255);
    expect(fl.sidecar.meta.snowShare).toBe(1);
  });

  it("the jagged edge: snow 0.7, 0.5 and 0.3 across a zigzag band", () => {
    const j = jaggedEdge();
    const L = parseDungeondraftMap(j.text).world.levels[0];
    const t = L.terrain!;
    const n = t.width * t.height;
    const seen = new Set<number>();
    for (let ty = 0; ty < t.height; ty++) {
      const [a, b] = j.band(ty);
      expect(b - a).toBe(2);
      for (let tx = 0; tx < t.width; tx++) {
        const w = t.weights[ty * t.width + tx];
        expect(w).toBe(Math.round(255 * j.snow(tx, ty)));
        expect(w + t.weights[n + ty * t.width + tx]).toBe(255);
        if (tx >= a && tx <= b) seen.add(w);
      }
    }
    expect([...seen].sort((p, q) => p - q)).toEqual([77, 128, 179]);
  });

  it("the Pelcs-like map: a Roof level without terrain, and Ground picked by the export's doors and lights", () => {
    const p = pelcsLike();
    const m = parseDungeondraftMap(p.text);
    expect(m.warnings).toEqual([]);
    expect(m.world.levels.map((l) => [l.key, l.label, l.terrain!.enabled])).toEqual([["0", "Roof", false], ["1", "Ground", true]]);
    expect(m.header.currentLevel).toBe(p.currentLevel);
    const roof = m.world.levels.find((l) => l.key === p.roofKey)!;
    expect(roof.roofs.length).toBe(2);
    expect(roof.objects.every((o) => o.layer === 900 && objectRole(defaultName(o.texture)) === OR.SNOW)).toBe(true);
    const match = matchDd2vttLevel(m, p.vtt);
    expect(match[0].level.key).toBe(p.groundKey);
    expect(match[0].score).toBeGreaterThanOrEqual(0.8);
    expect(match[1].score).toBe(0);
    expect(alignDd2vtt(p.vtt.resolution, 16 * 64, 12 * 64, m)!.fullMap).toBe(true);
  });

  it("twin levels: two levels labelled Ground with the same objects", () => {
    const t = twinLevels();
    const m = parseDungeondraftMap(t.text);
    expect(m.world.levels.map((l) => l.label)).toEqual(["Ground", "Ground"]);
    const pos = (k: number) => m.world.levels[k].objects.map((o) => [o.position.x, o.position.y]);
    expect(pos(0)).toEqual(pos(1));
    expect(pos(0).length).toBeGreaterThanOrEqual(8);
  });

  it("the transforms map: a turned, mirrored tree, path and pattern; the measurement cases", () => {
    const t = transformsMap();
    const L = parseDungeondraftMap(t.text).world.levels[0];
    const o = L.objects[t.objects.turned];
    expect(o.rotation).toBeCloseTo(Math.PI / 6, 6);
    expect(o.mirror).toBe(true);
    expect([o.scale.x, o.scale.y]).toEqual([1.1, 0.9]);
    expect(L.paths[t.paths.trail].scale.y).toBe(-1);
    expect(L.paths[t.paths.packCliff].texture!.source).toBe("pack");
    expect(L.patterns[t.pattern].scale.x).toBeLessThan(0);
    expect(L.patterns[t.pattern].shapeRotation).toBeCloseTo(Math.PI / 6, 6);
    expect(objectRole(defaultName(L.objects[t.objects.bare].texture))).toBe(OR.BARE);
    expect(L.objects[t.objects.pack].texture!.source).toBe("pack");
    // The small tree's prior (SPRITE_SIZES) overshoots its drawn sprite by about 1.3.
    expect(FIXTURE_SPRITES["vegetation/trees/tree_green_simple_01"].r * 1.3).toBeCloseTo(262, -1);
  });

  it("interiors: the Mill-like loop over a wood pattern, a hut of two walls meeting, a yard, a cave loop", () => {
    const im = interiorsMap();
    const L = parseDungeondraftMap(im.text).world.levels[0];
    expect(L.walls.map((w) => [w.loop, w.type])).toEqual([[true, 1], [false, 1], [false, 1], [true, 1], [true, 2]]);
    const [a, b] = [L.walls[1].points, L.walls[2].points];
    const end = (p: Float64Array) => [p[p.length - 2], p[p.length - 1]];
    expect(Math.hypot(end(a)[0] - b[0], end(a)[1] - b[1])).toBeLessThan(GRID / 4);
    expect(Math.hypot(end(b)[0] - a[0], end(b)[1] - a[1])).toBeLessThan(GRID / 4);
    expect(defaultName(L.patterns[0].texture)).toBe("simple/tileset_wood_interlaced");
    expect((im.hut[2] - im.hut[0]) * (im.hut[3] - im.hut[1])).toBeLessThanOrEqual(36);
    expect((im.yard[2] - im.yard[0]) * (im.yard[3] - im.yard[1])).toBe(100);
  });

  it("the fit's maps: scattered objects, the edited picture, the pairs", () => {
    for (const seed of [1, 2]) {
      const s = scatterMap(seed);
      expect(s.objects).toBe(20);
      expect(parseDungeondraftMap(s.text).world.levels[0].objects.length).toBe(20);
    }
    const e = editedPicture();
    const saved = parseDungeondraftMap(e.text).world.levels[0].objects;
    const shown = parseDungeondraftMap(e.pictureText).world.levels[0].objects;
    expect(saved.length).toBe(shown.length);
    expect(defaultName(shown[e.movedFrom].texture)).toBe("more_trees/oak_04");
    expect(saved[e.moved].position.x - shown[e.movedFrom].position.x).toBeCloseTo(e.movedBy[0] * GRID, 6);
    expect(saved[e.moved].position.y - shown[e.movedFrom].position.y).toBeCloseTo(e.movedBy[1] * GRID, 6);
    expect(defaultName(saved[e.erased].texture)).toBe("vegetation/trees/pine_tree_02");
    expect(defaultName(shown[shown.length - 1].texture)).toBe("clutter/boulders/boulder_08");
    // Nothing the picture shows reaches the cores (2.5: 0.7 x the prior) of the two the picture
    // lacks, the moved oak's old crown included, so presence must drop both.
    for (const i of [e.erased, e.moved]) {
      const o = saved[i];
      const core = 0.7 * SPRITE_SIZES[defaultName(o.texture)!].r * o.scale.x;
      for (const p of shown) {
        const r = FIXTURE_SPRITES[defaultName(p.texture)!].r * p.scale.x;
        expect(Math.hypot(p.position.x - o.position.x, p.position.y - o.position.y), `object ${i}`).toBeGreaterThan(r + core);
      }
    }
    const pairs = fitPairs();
    expect(pairs.map((p) => p.expect)).toEqual(["yes", "not-yes", "no", "not-yes", "not-yes"]);
  });
});

// ------------------------------------------------------------------ the hand-built sidecars

/** Visible coverage of a role at the point (x, y) in squares, on a whole-map raster at pps. */
function cover(L: SidecarLayers, pps: number, kind: "terrain" | "area" | "objects", role: number, x: number, y: number): number {
  const m = (L[kind] as Map<number, Uint8Array>).get(role);
  return m ? m[Math.floor(y * pps) * L.w + Math.floor(x * pps)] : 0;
}

/** The sidecar with only objects `keep` (indices), plus one round object when given (world units). */
function withObjects(sc: SeasonSidecar, keep: number[], extra?: { role: ObjectRole; layer: number; x: number; y: number; r: number }): SeasonSidecar {
  const t = sc.objects, n = keep.length + (extra ? 1 : 0);
  const o: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  keep.forEach((i, k) => {
    o.role[k] = t.role[i]; o.layer[k] = t.layer[i]; o.x[k] = t.x[i]; o.y[k] = t.y[i]; o.rot[k] = t.rot[i]; o.flags[k] = t.flags[i]; o.name[k] = t.name[i];
    o.reach.set(t.reach.subarray(i * REACH_N, (i + 1) * REACH_N), k * REACH_N);
  });
  if (extra) {
    const k = n - 1;
    o.role[k] = extra.role; o.layer[k] = extra.layer; o.name[k] = NO_NAME; o.flags[k] = OBJ_FLAG.MEASURED;
    o.x[k] = Math.round(extra.x * SIDECAR_UNITS.coord); o.y[k] = Math.round(extra.y * SIDECAR_UNITS.coord);
    o.reach.fill(Math.round(extra.r * SIDECAR_UNITS.reach), k * REACH_N, n * REACH_N);
  }
  return { ...sc, objects: o };
}

describe("hand-built sidecars", () => {
  const cases: Array<[string, SeasonSidecar]> = [
    ["snowy", snowy.sidecar], ["snowy with a cave", snowyMap({ cave: true }).sidecar], ["snowy with a pack roof", snowyMap({ packRoof: true }).sidecar],
    ["jagged edge", jaggedEdge().sidecar], ["frozen lake", frozenLake().sidecar],
  ];

  it.each(cases)("%s: encodes, decodes to itself, and keeps no pack, structure or source names", (_, sc) => {
    const bytes = encodeSidecar(sc);
    expect(decodeSidecar(bytes)).toEqual(sc);
    const text = new TextDecoder("latin1").decode(bytes);
    for (const bad of ["res://", "packs/", PACK_ID, PACK_NAME, "Icewind", "portal", "light", "crate", "snowy_fir", "frosted_shingles", "Ground"]) expect(text).not.toContain(bad);
    for (const n of sc.meta.names) expect(/^terrain_/.test(n) || NAMED_ROLES.has(objectRole(n))).toBe(true);
  });

  it("the snowy map's roles lie where the text puts them", () => {
    const pps = 16;
    const L = rasterSidecar(snowy.sidecar, { w: 20 * pps, h: 12 * pps });
    expect(L.skipped ?? 0).toBe(0);
    expect(cover(L, pps, "terrain", TR.SNOW, 10.5, 0.5)).toBe(255);
    expect(cover(L, pps, "terrain", TR.GRASS, 19.5, 9.5)).toBe(255);
    expect(cover(L, pps, "terrain", TR.ROCK, 1, 11.5)).toBe(255);
    expect(cover(L, pps, "area", AR.WATER, 3.2, 3.6)).toBe(255);
    expect(cover(L, pps, "area", AR.WATER, 5.3, 3.7)).toBe(0);
    expect(cover(L, pps, "terrain", TR.SNOW, 5.3, 3.7)).toBe(255);
    const [fx0, fy0, fx1, fy1] = snowy.layout.openFloor;
    expect(cover(L, pps, "area", AR.FLOOR, (fx0 + fx1) / 2, (fy0 + fy1) / 2)).toBe(255);
    expect(cover(L, pps, "area", AR.ROOF, 14.4, 2)).toBe(255);
    expect(cover(L, pps, "area", AR.WALL, 14, 4.5)).toBeGreaterThan(200);
    const o = snowy.objects;
    const top = (x: number, y: number) => L.top[Math.floor(y * pps) * L.w + Math.floor(x * pps)];
    expect(top(9.3, 2.2)).toBe(o.pine + 1);
    expect(top(9.2, 8.2)).toBe(o.oak + 1);
    expect(top(16.2, 8.8)).toBe(o.pack + 1);
    expect(top(16, 2)).toBe(o.roofSnow + 1);
    expect(cover(L, pps, "objects", OR.STRUCTURE, 11, 5.2)).toBe(255);
    expect(cover(L, pps, "objects", OR.OPAQUE, 16.2, 8.8)).toBe(255);
    expect(snowy.sidecar.meta.snowShare).toBeGreaterThanOrEqual(0.5);
    expect(snowy.sidecar.meta.snowShare).toBeLessThan(0.8);
    expect(snowy.sidecar.meta.packItems).toBe(1);
    expect(snowy.sidecar.meta.packShare).toBeGreaterThan(0);
    expect(jaggedEdge().sidecar.meta.snowShare).toBe(1);
  });

  it("snowShare follows 4.2: only opaque items hide the terrain; ground-level snow objects count as snow", () => {
    const sc = snowy.sidecar;
    expect(sidecarSnowShare(sc)).toBe(sc.meta.snowShare);
    // The tufts, trees, crate and boulder hide nothing: the share is the same without them.
    const keep = (pred: (i: number) => boolean) => { const k: number[] = []; for (let i = 0; i < sc.objects.n; i++) if (pred(i)) k.push(i); return k; };
    const opaqueOnly = withObjects(sc, keep((i) => sc.objects.role[i] === OR.OPAQUE));
    expect(sidecarSnowShare(opaqueOnly)).toBe(sc.meta.snowShare);
    // The pack item hides grass: without it, more grass shows. Another on the snow hides snow.
    expect(sidecarSnowShare(withObjects(sc, []))).toBeLessThan(sc.meta.snowShare - 0.005);
    const all = keep(() => true);
    expect(sidecarSnowShare(withObjects(sc, all, { role: OR.OPAQUE, layer: 100, x: 6.5 * GRID, y: 7 * GRID, r: GRID }))).toBeLessThan(sc.meta.snowShare - 0.005);
    // A snow drift on the grass counts as snow; on the roof (layer 900) it doesn't.
    const drift = (layer: number) => withObjects(sc, keep(() => true), { role: OR.SNOW, layer, x: 17 * GRID, y: 10.5 * GRID, r: 0.9 * GRID });
    expect(sidecarSnowShare(drift(100))).toBeGreaterThan(sc.meta.snowShare + 0.005);
    expect(sidecarSnowShare(drift(DD_LAYER.ABOVE_ROOFS))).toBe(sc.meta.snowShare);
  });

  it("the snowy objects: roles, names only for natural things, measured reaches from the fixture sprites", () => {
    const ob = snowy.sidecar.objects;
    const L = snowyParsed.world.levels[0];
    expect(ob.n).toBe(L.objects.length);
    for (let i = 0; i < ob.n; i++) {
      const o = L.objects[i];
      const role = objectRole(defaultName(o.texture)) as ObjectRole;
      expect(ob.role[i]).toBe(role);
      expect(ob.name[i] === NO_NAME).toBe(!NAMED_ROLES.has(role));
      expect(ob.flags[i] & OBJ_FLAG.MEASURED).toBe(OBJ_FLAG.MEASURED);
      expect([ob.x[i], ob.y[i]]).toEqual([Math.round(o.position.x * SIDECAR_UNITS.coord), Math.round(o.position.y * SIDECAR_UNITS.coord)]);
      const sprite = o.texture!.source === "pack" ? PACK_SPRITE.reach : FIXTURE_SPRITES[defaultName(o.texture)!].reach;
      const want = worldReach(sprite, o.rotation, [o.scale.x, o.scale.y], o.mirror);
      for (let k = 0; k < REACH_N; k++) expect(Math.abs(ob.reach[i * REACH_N + k] / SIDECAR_UNITS.reach - want[k])).toBeLessThanOrEqual(0.125);
    }
  });

  it("agrees with the picture's own compile of the text (pictureSidecar), role by role", () => {
    const pps = 16;
    const a = rasterSidecar(snowy.sidecar, { w: 20 * pps, h: 12 * pps });
    const b = rasterSidecar(pictureSidecar(snowyParsed, snowy.levelKey), { w: 20 * pps, h: 12 * pps });
    for (const kind of ["terrain", "area", "objects"] as const) {
      const ma = a[kind] as Map<number, Uint8Array>, mb = b[kind] as Map<number, Uint8Array>;
      expect([...ma.keys()].sort()).toEqual([...mb.keys()].sort());
      for (const [role, p] of ma) {
        const q = mb.get(role)!;
        let off = 0;
        for (let i = 0; i < p.length; i++) if (Math.abs(p[i] - q[i]) > 8) off++;
        expect(off, `${kind} ${role}`).toBeLessThanOrEqual(p.length * 0.002);
      }
    }
  });
});

// ------------------------------------------------------------------ worldReach against measure.ts

describe("sprite outlines in the world frame", () => {
  it("a round sprite scales; a turned one turns", () => {
    const r = worldReach(new Array(16).fill(100), 1.234, [2, 2], true);
    for (const v of r) expect(Math.abs(v - 200)).toBeLessThan(0.05);
    // An ellipse long along x turned a quarter: the long reach moves from sample 0 (near +x) to sample 4 (near +y).
    const flat = worldReach(FIXTURE_SPRITES["vegetation/fallen/log_02"].reach, 0, [1, 1], false);
    const turned = worldReach(FIXTURE_SPRITES["vegetation/fallen/log_02"].reach, Math.PI / 2, [1, 1], false);
    for (let k = 0; k < 16; k++) expect(turned[(k + 4) % 16]).toBeCloseTo(flat[k], 0);
  });

  it("a positive rotation turns clockwise on screen: the egg's long end moves from sample 0 to sample 1", () => {
    const egg = FIXTURE_SPRITES["vegetation/trees/tree_big_green_02"].reach;
    const argmax = (r: number[]) => r.indexOf(Math.max(...r));
    expect([0, 15]).toContain(argmax(worldReach(egg, 0, [1, 1], false)));
    const t = Math.PI / 6;
    const turned = worldReach(egg, t, [1, 1], false);
    expect(argmax(turned)).toBe(1);
    // Every sample against the egg's own outline (520 toward +x, 380 toward -x, 430 across) at the
    // sprite-frame direction R(-t) * d (within the 16 samples' interpolation).
    for (let k = 0; k < 16; k++) {
      const dx = REACH_DIRS[k * 2], dy = REACH_DIRS[k * 2 + 1];
      const u = Math.cos(t) * dx + Math.sin(t) * dy, v = -Math.sin(t) * dx + Math.cos(t) * dy;
      const a = u >= 0 ? 520 : 380;
      const want = 1 / Math.hypot(u / a, v / 430);
      expect(Math.abs(turned[k] / want - 1), `sample ${k}`).toBeLessThan(0.03);
    }
  });

  it("mirroring flips the egg's long end from +x to -x", () => {
    const egg = FIXTURE_SPRITES["vegetation/trees/tree_big_green_02"].reach;
    const plain = worldReach(egg, 0, [1, 1], false), mirrored = worldReach(egg, 0, [1, 1], true);
    expect(plain[0]).toBeGreaterThan(plain[8] * 1.2);
    // Sample k's mirror image along x is sample 7 - k.
    for (let k = 0; k < 16; k++) expect(mirrored[(23 - k) % 16]).toBeCloseTo(plain[k], 6);
  });

  it("measure.ts's priorReach turns, scales and mirrors the same way (within the 16-gon's chord sag)", () => {
    const t = transformsMap();
    const L = parseDungeondraftMap(t.text).world.levels[0];
    for (const i of [t.objects.turned, t.objects.small, t.objects.capped, t.objects.bare]) {
      const o = L.objects[i];
      const prior = priorReach(o, objectRole(defaultName(o.texture)), FIXTURE_SPRITES);
      const mine = worldReach(FIXTURE_SPRITES[defaultName(o.texture)!].reach, o.rotation, [o.scale.x, o.scale.y], o.mirror);
      for (let k = 0; k < 16; k++) expect(Math.abs(prior[k] / mine[k] - 1), `object ${i} sample ${k}`).toBeLessThan(0.05);
    }
  });
});

// ------------------------------------------------------------------ the fake exports

describe("fake exports", () => {
  const pps = 24;
  const fromSidecar = fakeExport(snowy.sidecar, pps);
  const fromMap = fakeExportFromMap(snowyParsed, snowy.levelKey, pps);
  const layers = rasterSidecar(snowy.sidecar, { w: fromSidecar.w, h: fromSidecar.h });
  const N = fromSidecar.w * fromSidecar.h;
  const nothingOver = (i: number) => {
    for (const p of layers.area.values()) if (p[i]) return false;
    for (const p of layers.objects.values()) if (p[i]) return false;
    return true;
  };
  const pure = (r: number) => (i: number) => layers.terrain.get(r as never)![i] >= 250 && nothingOver(i);

  it("are the map's size, opaque, and the same from the sidecar as from the text", () => {
    expect([fromSidecar.w, fromSidecar.h]).toEqual([20 * pps, 12 * pps]);
    for (let i = 3; i < fromSidecar.rgba.length; i += 4) if (fromSidecar.rgba[i] !== 255) throw new Error("not opaque");
    let same = 0;
    for (let i = 0; i < N * 4; i++) if (fromSidecar.rgba[i] === fromMap.rgba[i]) same++;
    expect(same / (N * 4)).toBeGreaterThan(0.995);
  });

  it("pass seasonPixels's colour gates: snow is snow, grass is vegetation, water is water, rock is neither", () => {
    expect(share(N, (i) => chan(fromSidecar, i, 3) >= 128, pure(TR.SNOW)).share).toBeGreaterThan(0.97);
    expect(share(N, (i) => chan(fromSidecar, i, 0) >= 128, pure(TR.GRASS)).share).toBeGreaterThan(0.97);
    expect(share(N, (i) => chan(fromSidecar, i, 3) < 64 && chan(fromSidecar, i, 0) < 64, pure(TR.ROCK)).share).toBeGreaterThan(0.97);
    const water = layers.area.get(AR.WATER)!;
    expect(share(N, (i) => chan(fromSidecar, i, 1) >= 128, (i) => water[i] >= 250).share).toBeGreaterThan(0.97);
    // Roofs and walls are grey.
    const grey = (i: number) => { const [r, g, b] = rgbAt(fromSidecar, i); return Math.max(r, g, b) - Math.min(r, g, b) < 16; };
    const roof = layers.area.get(AR.ROOF)!, wall = layers.area.get(AR.WALL)!;
    expect(share(N, grey, (i) => roof[i] >= 250 && !layers.objects.get(OR.SNOW)![i]).share).toBe(1);
    expect(share(N, grey, (i) => wall[i] >= 250).share).toBe(1);
  });

  it("outline crowns in ink, and put vegetation colours on the snow only inside objects", () => {
    const o = snowy.sidecar.objects;
    for (const i of [snowy.objects.pine, snowy.objects.oak, snowy.objects.boulder, snowy.objects.pack]) {
      let ink = 0, n = 0;
      for (let a = 0; a < 64; a++) {
        const t = (a / 64) * 2 * Math.PI;
        const k = Math.round((Math.atan2(Math.sin(t), Math.cos(t)) / (2 * Math.PI)) * 16 + 16) % 16;
        // Just inside the outline along REACH_DIRS[k]: a pixel in.
        const r = o.reach[i * 16 + k] / 4 - (1 * GRID) / pps;
        const x = o.x[i] / 16 + r * REACH_DIRS[k * 2], y = o.y[i] / 16 + r * REACH_DIRS[k * 2 + 1];
        const j = Math.floor((y / GRID) * pps) * fromSidecar.w + Math.floor((x / GRID) * pps);
        n++;
        const [r0, g0, b0] = rgbAt(fromSidecar, j);
        if (r0 + g0 + b0 < 3 * 60) ink++;
      }
      expect(ink / n, `object ${i}`).toBeGreaterThan(0.6);
    }
    // Crowns and tufts, or the dark ink of other objects' outlines.
    const inObject = (i: number) => { for (const m of layers.objects.values()) if (m[i]) return true; return false; };
    const snowSide = (i: number) => (i % fromSidecar.w) < 11.5 * pps && layers.terrain.get(TR.SNOW)![i] > 0;
    expect(share(N, inObject, (i) => snowSide(i) && chan(fromSidecar, i, 0) >= 128).share).toBe(1);
    const crowns = (i: number) => (layers.objects.get(OR.EVERGREEN)?.[i] ?? 0) + (layers.objects.get(OR.DECIDUOUS)?.[i] ?? 0) + (layers.objects.get(OR.GRASS)?.[i] ?? 0) > 0;
    expect(share(N, crowns, (i) => snowSide(i) && chan(fromSidecar, i, 0) >= 128 && (rgbAt(fromSidecar, i).reduce((a, b) => a + b) > 3 * 60)).share).toBe(1);
  });

  it("draw bare trees as warm strokes inside their footprint, with the ground between", () => {
    const d = snowy.objects.dead;
    const inFoot = (i: number) => layers.top[i] === d + 1;
    const bark = (i: number) => rgbAt(fromSidecar, i).every((v, c) => v === FAKE_COLOURS.bark[c]);
    const strokes = share(N, bark, inFoot);
    expect(strokes.share).toBeGreaterThan(0.08);
    expect(share(N, (i) => chan(fromSidecar, i, 3) >= 128, inFoot).share).toBeGreaterThan(0.4);
    // No bark anywhere else.
    expect(share(N, bark, (i) => !inFoot(i)).share).toBe(0);
    // Strokes reach out to most of the 16 directions.
    const o = snowy.sidecar.objects;
    let reached = 0;
    for (let k = 0; k < 16; k++) {
      for (let f = 0.75; f <= 1; f += 0.02) {
        const r = (o.reach[d * 16 + k] / 4) * f;
        const x = o.x[d] / 16 + r * REACH_DIRS[k * 2], y = o.y[d] / 16 + r * REACH_DIRS[k * 2 + 1];
        const j = Math.floor((y / GRID) * pps) * fromSidecar.w + Math.floor((x / GRID) * pps);
        if (bark(j) || rgbAt(fromSidecar, j).every((v, c) => v === INK[c])) { reached++; break; }
      }
    }
    expect(reached).toBeGreaterThanOrEqual(14);
  });

  it("erase an object: the ground shows where it was, and nothing else changes", () => {
    const pine = snowy.objects.pine;
    const erased = fakeExportFromMap(snowyParsed, snowy.levelKey, pps, { erase: [pine] });
    const foot = (i: number) => (layers.objects.get(OR.EVERGREEN)?.[i] ?? 0) > 0;
    let changedOutside = 0;
    for (let i = 0; i < N; i++) {
      const diff = rgbAt(erased, i).some((v, c) => v !== fromMap.rgba[i * 4 + c]);
      if (diff && !foot(i)) changedOutside++;
    }
    expect(changedOutside).toBe(0);
    expect(share(N, (i) => chan(erased, i, 3) >= 128, (i) => (layers.objects.get(OR.EVERGREEN)?.[i] ?? 0) >= 250).share).toBeGreaterThan(0.97);
  });

  it("shift by whole squares: the same pixels, moved", () => {
    const shifted = fakeExportFromMap(snowyParsed, snowy.levelKey, pps, { shift: [2, -1] });
    let same = 0, n = 0;
    for (let y = pps + 1; y < shifted.h - 1; y++) for (let x = 2 * pps + 1; x < shifted.w - 1; x++) {
      const a = (y * shifted.w + x) * 4, b = ((y + pps) * fromMap.w + (x - 2 * pps)) * 4;
      if (y + pps >= fromMap.h - 1) continue;
      n++;
      if (shifted.rgba[a] === fromMap.rgba[b] && shifted.rgba[a + 1] === fromMap.rgba[b + 1] && shifted.rgba[a + 2] === fromMap.rgba[b + 2]) same++;
    }
    expect(same / n).toBeGreaterThan(0.995);
  });

  it("crop: the part of the whole picture; size: any pixel size", () => {
    const crop = fakeExportFromMap(snowyParsed, snowy.levelKey, pps, { crop: [2, 1, 16, 10] });
    expect([crop.w, crop.h]).toEqual([16 * pps, 10 * pps]);
    let same = 0;
    for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
      const a = (y * crop.w + x) * 4, b = ((y + pps) * fromMap.w + x + 2 * pps) * 4;
      if (crop.rgba[a] === fromMap.rgba[b] && crop.rgba[a + 1] === fromMap.rgba[b + 1] && crop.rgba[a + 2] === fromMap.rgba[b + 2]) same++;
    }
    expect(same / (crop.w * crop.h)).toBeGreaterThan(0.995);
    const odd = fakeExportFromMap(snowyParsed, snowy.levelKey, pps, { size: [500, 288] });
    expect([odd.w, odd.h]).toEqual([500, 288]);
    expect(alignPlainImage(snowyParsed, odd.w, odd.h)).toBeNull();
    expect(alignPlainImage(snowyParsed, fromMap.w, fromMap.h)).not.toBeNull();
  });

  it("bake a dotted or solid grid on every square's lines only", () => {
    const pps2 = 32;
    const plain = fakeExport(snowy.sidecar, pps2), dotted = fakeExport(snowy.sidecar, pps2, { grid: "dotted" }), solid = fakeExport(snowy.sidecar, pps2, { grid: "solid" });
    let onD = 0, onS = 0, line = 0, off = 0;
    for (let y = 0; y < plain.h; y++) for (let x = 0; x < plain.w; x++) {
      const i = (y * plain.w + x) * 4;
      const isLine = x % pps2 === 0 || y % pps2 === 0;
      const dD = dotted.rgba[i + 2] < plain.rgba[i + 2], dS = solid.rgba[i + 2] < plain.rgba[i + 2];
      if (isLine) { line++; if (dD) onD++; if (dS) onS++; } else if (dD || dS) off++;
    }
    expect(off).toBe(0);
    expect(onS / line).toBeGreaterThan(0.97);
    expect(onD / line).toBeGreaterThan(0.4);
    expect(onD / line).toBeLessThan(0.6);
  });

  it("the jagged edge: every band pixel is snow or rock, in about the texel's shares", () => {
    const j = jaggedEdge();
    const p = fakeExport(j.sidecar, 32);
    const by = new Map<number, [number, number]>();
    let mixed = 0, n = 0;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const w = j.snow(Math.floor(x / 8), Math.floor(y / 8));
      if (w <= 0 || w >= 1) continue;
      const i = y * p.w + x, s = chan(p, i, 3);
      n++;
      if (s > 40 && s < 160) mixed++;
      const e = by.get(w) ?? [0, 0];
      e[1]++;
      if (s >= 128) e[0]++;
      by.set(w, e);
    }
    expect(mixed / n).toBeLessThan(0.01);
    for (const [w, [k, m]] of by) expect(Math.abs(k / m - w), `weight ${w}`).toBeLessThan(0.15);
  });

  it("a Roof level's picture is transparent where the level has nothing", () => {
    const pl = pelcsLike();
    const m = parseDungeondraftMap(pl.text);
    const roof = fakeExportFromMap(m, pl.roofKey, 16);
    let clear = 0;
    for (let i = 3; i < roof.rgba.length; i += 4) if (roof.rgba[i] === 0) clear++;
    expect(clear / (roof.w * roof.h)).toBeGreaterThan(0.6);
    const ground = fakeExportFromMap(m, pl.groundKey, 16);
    for (let i = 3; i < ground.rgba.length; i += 4) if (ground.rgba[i] !== 255) throw new Error("ground not opaque");
  });

  it("the cropped .dd2vtt: origin 2,1 lines up, its walls sit on the picture's walls, and it round-trips as a file", () => {
    const c = croppedDd2vtt(16);
    const pic = fakeExportFromMap(snowyParsed, c.levelKey, c.pixelsPerGrid, { crop: c.crop });
    const al = alignDd2vtt(c.vtt.resolution, pic.w, pic.h, snowyParsed)!;
    expect([al.spec.originX, al.spec.originY, al.fullMap]).toEqual([2 * GRID, GRID, false]);
    // The walls alone (the roof hides part of them in the picture).
    const sc = pictureSidecar(snowyParsed, c.levelKey, { crop: c.crop });
    const L = rasterSidecar({ ...sc, shapes: sc.shapes.filter((s) => s.role === AR.WALL) }, { w: pic.w, h: pic.h });
    const wall = L.area.get(AR.WALL)!;
    for (const line of c.vtt.line_of_sight) for (const q of line) {
      const x = Math.min(pic.w - 1, Math.floor((q.x - c.crop[0]) * c.pixelsPerGrid)), y = Math.min(pic.h - 1, Math.floor((q.y - c.crop[1]) * c.pixelsPerGrid));
      expect(wall[y * pic.w + x]).toBeGreaterThan(100);
    }
    // Two tufts lie more than a square outside the rectangle (the extractor drops them).
    const objs = snowyParsed.world.levels[0].objects;
    for (const i of snowy.objects.outsideCrop) {
      const o = objs[i], r = (FIXTURE_SPRITES[defaultName(o.texture)!].r * o.scale.x) / GRID;
      const [x, y] = [o.position.x / GRID, o.position.y / GRID];
      const out = Math.max(c.crop[0] - (x + r), x - r - (c.crop[0] + c.crop[2]), c.crop[1] - (y + r), y - r - (c.crop[1] + c.crop[3]));
      expect(out).toBeGreaterThan(1);
    }
    const file = dd2vttPicture(dd2vttText(c.vtt, encodePng(pic.rgba, pic.w, pic.h)));
    expect([file.w, file.h]).toEqual([pic.w, pic.h]);
    expect(file.rgba).toEqual(pic.rgba);
    expect(file.vtt).toEqual(c.vtt);
  });

  it("the fit pairs' pictures: the swapped one differs, the shifted one moves, the crop is the map's aspect", () => {
    for (const p of fitPairs()) {
      const pic = fakeExportFromMap(parseDungeondraftMap(p.pictureText), p.levelKey, 24, p.picture);
      const crop = p.picture.crop;
      expect([pic.w, pic.h]).toEqual(crop ? [crop[2] * 24, crop[3] * 24] : [20 * 24, 12 * 24]);
      if (crop) expect(alignPlainImage(parseDungeondraftMap(p.mapText), pic.w, pic.h)).not.toBeNull();
    }
  });
});

// ------------------------------------------------------------------ the object-centre fit on the fake exports

/**
 * The prototype's object-centre fit (final-work/objfit2.ts, design 2.4), copied here so the
 * fixtures are checked against the rule the design measured on real pairs, not against fit.ts's
 * own tuning: 0.299/0.587/0.114 luminance; a box of half-side max(2, round(0.3 x px a square)) at
 * each default object's centre (Math.round), off-picture boxes skipped; a score needs 8 boxes;
 * shifts on a half-square grid within 3 squares, at least 1 from 0. The picture is the whole map
 * (as a plain picture is read). `offset` (squares) is added to every centre first.
 */
function protoFit(map: DDMap, levelKey: string, pic: FakePicture, offset: Pt = [0, 0]) {
  const L0 = map.world.levels.find((l) => l.key === levelKey)!;
  const W = pic.w, H = pic.h, pps = W / map.world.width, upp = GRID / pps;
  const S = new Float64Array((W + 1) * (H + 1)), Q = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = 0.299 * pic.rgba[i] + 0.587 * pic.rgba[i + 1] + 0.114 * pic.rgba[i + 2];
      rs += v; rq += v * v;
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + rs;
      Q[(y + 1) * (W + 1) + x + 1] = Q[y * (W + 1) + x + 1] + rq;
    }
  }
  const objs = L0.objects.filter((o) => o.texture?.source === "default").map((o) => [o.position.x / upp + offset[0] * pps, o.position.y / upp + offset[1] * pps]);
  const r = Math.max(2, Math.round(0.3 * pps));
  const sd = (px: number, py: number) => {
    const x0 = Math.round(px) - r, y0 = Math.round(py) - r, x1 = x0 + 2 * r + 1, y1 = y0 + 2 * r + 1;
    if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) return NaN;
    const n = (x1 - x0) * (y1 - y0);
    const a = S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
    const q = Q[y1 * (W + 1) + x1] - Q[y0 * (W + 1) + x1] - Q[y1 * (W + 1) + x0] + Q[y0 * (W + 1) + x0];
    return Math.sqrt(Math.max(0, q / n - (a / n) ** 2));
  };
  const score = (ox: number, oy: number) => {
    let t = 0, n = 0;
    for (const [x, y] of objs) { const c = sd(x + ox * pps, y + oy * pps); if (!Number.isNaN(c)) { t += c; n++; } }
    return n >= 8 ? t / n : NaN;
  };
  const s0 = score(0, 0);
  let best = -1, bx = 0, by = 0;
  for (let dy = -3; dy <= 3; dy += 0.5) for (let dx = -3; dx <= 3; dx += 0.5) {
    if (Math.hypot(dx, dy) < 1) continue;
    const v = score(dx, dy);
    if (v > best) { best = v; bx = dx; by = dy; }
  }
  const sharpAt = (x: number, y: number) => {
    const nb = [score(x + 0.5, y), score(x - 0.5, y), score(x, y + 0.5), score(x, y - 0.5)].filter((v) => !Number.isNaN(v));
    return nb.reduce((a, b) => a + b, 0) / nb.length / score(x, y);
  };
  const sharp = sharpAt(0, 0), sharpB = sharpAt(bx, by), lead = s0 / best;
  const verdict = objs.length < 8 ? "unsure" : lead >= 1 && sharp <= 0.95 ? "yes" : lead < 0.85 || (best >= 1.1 * s0 && sharpB <= 0.92) ? "no" : "unsure";
  return { verdict, lead, sharp, best: [bx, by] as Pt };
}

describe("the object-centre fit (2.4, the prototype's rule) on the fake exports", () => {
  it("gives every fit pair its verdict, and lines the shifted one up with its best shift", () => {
    for (const p of fitPairs()) {
      const map = parseDungeondraftMap(p.mapText);
      const pic = fakeExportFromMap(parseDungeondraftMap(p.pictureText), p.levelKey, 24, p.picture);
      const f = protoFit(map, p.levelKey, pic);
      if (p.expect === "not-yes") expect(f.verdict, p.name).not.toBe("yes");
      else expect(f.verdict, p.name).toBe(p.expect);
      if (p.best) {
        expect(f.best, p.name).toEqual(p.best);
        // The automatic shift (2.4): the centres moved by the best shift give "yes".
        expect(protoFit(map, p.levelKey, pic, f.best).verdict, `${p.name}, lined up`).toBe("yes");
      }
      if (p.expect === "yes") expect(f.sharp).toBeLessThan(0.85);
    }
  });

  // Half a square off diagonally, as the design measured it (objfit2 --shift 0.5,0.5): along one
  // axis the rule can't tell (score(0) and score(1, 0) lie half a square either side of the peak).
  it("over 12 scatter seeds: correct is yes, 2 squares off is no at exactly the correction, half a square off and swapped are never yes", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const map = parseDungeondraftMap(scatterMap(seed).text);
      const ok = protoFit(map, "0", fakeExportFromMap(map, "0", 24));
      expect(ok.verdict, `seed ${seed}`).toBe("yes");
      for (const shift of [[-2, 0], [1, -2]] as Pt[]) {
        const off = protoFit(map, "0", fakeExportFromMap(map, "0", 24, { shift }));
        expect([off.verdict, ...off.best], `seed ${seed} shifted ${shift}`).toEqual(["no", ...shift]);
      }
      for (const shift of [[0.5, 0.5], [-0.5, 0.5]] as Pt[]) {
        expect(protoFit(map, "0", fakeExportFromMap(map, "0", 24, { shift })).verdict, `seed ${seed} shifted ${shift}`).not.toBe("yes");
      }
      const other = parseDungeondraftMap(scatterMap(seed + 100).text);
      expect(protoFit(map, "0", fakeExportFromMap(other, "0", 24)).verdict, `seed ${seed} swapped`).not.toBe("yes");
    }
    // A finer export box-averaged to 24 px a square, as the attach worker samples it.
    const map = parseDungeondraftMap(scatterMap(3).text);
    expect(protoFit(map, "0", downsample(fakeExportFromMap(map, "0", 40), 20 * 24, 12 * 24) as FakePicture).verdict).toBe("yes");
  }, 30_000); // about 4 s alone: over vitest's 5 s default when test files run side by side

  it("every object kind's luminance spread peaks at its centre, as real sprites' does", () => {
    const pps = 24, r = Math.round(0.3 * pps);
    const acc = new Map<string, [number, number]>();
    for (let seed = 1; seed <= 10; seed++) {
      const map = parseDungeondraftMap(scatterMap(seed).text);
      const pic = fakeExportFromMap(map, "0", pps);
      const lum = (x: number, y: number) => { const i = (y * pic.w + x) * 4; return 0.299 * pic.rgba[i] + 0.587 * pic.rgba[i + 1] + 0.114 * pic.rgba[i + 2]; };
      const sd = (cx: number, cy: number) => {
        const x0 = Math.round(cx) - r, y0 = Math.round(cy) - r;
        if (x0 < 0 || y0 < 0 || x0 + 2 * r + 1 > pic.w || y0 + 2 * r + 1 > pic.h) return NaN;
        let a = 0, q = 0, n = 0;
        for (let y = y0; y <= y0 + 2 * r; y++) for (let x = x0; x <= x0 + 2 * r; x++) { const v = lum(x, y); a += v; q += v * v; n++; }
        return Math.sqrt(Math.max(0, q / n - (a / n) ** 2));
      };
      for (const o of map.world.levels[0].objects) {
        const x = (o.position.x / GRID) * pps, y = (o.position.y / GRID) * pps, h = pps / 2;
        const c = sd(x, y), nb = [sd(x + h, y), sd(x - h, y), sd(x, y + h), sd(x, y - h)];
        if ([c, ...nb].some(Number.isNaN)) continue;
        const k = defaultName(o.texture)!;
        const e = acc.get(k) ?? [0, 0];
        e[0] += c; e[1] += (nb[0] + nb[1] + nb[2] + nb[3]) / 4;
        acc.set(k, e);
      }
    }
    expect(acc.size).toBe(9);
    for (const [k, [c, nb]] of acc) expect(nb / c, k).toBeLessThan(0.92);
  });
});

// ------------------------------------------------------------------ real files

// Each test skips on the files it reads, so a partly filled folder skips rather than fails.
describe.skipIf(!haveSamples)("DD_FIXTURES: the public sample maps", () => {
  for (const p of [...SAMPLE_PAIRS, ...SWAPPED_PAIRS]) it.skipIf(!havePair(p))(`${p.map} on ${p.picture}: the map parses, and a level given is its Ground`, () => {
    const m: DDMap = parseDungeondraftMap(sampleText(p.map));
    expect(m.world.levels.length).toBeGreaterThan(0);
    // A map of several levels names the one its picture shows (Tulgi's and Pelcs's: Ground, not the Roof).
    if (m.world.levels.length > 1) expect(p.level, p.map).toBeDefined();
    if (p.level) expect(m.world.levels.find((l) => l.key === p.level)?.label).toBe("Ground");
  });

  it.skipIf(!haveSample("hd_brawl.dd2vtt"))("reads a .dd2vtt export: its picture and what parseUniversalVtt keeps", () => {
    const pic = readPicture("hd_brawl.dd2vtt");
    expect([pic.w, pic.h]).toEqual([11 * 128, 8 * 128]);
    expect(pic.vtt!.resolution).toEqual({ map_origin: { x: 0, y: 0 }, map_size: { x: 11, y: 8 }, pixels_per_grid: 128 });
    const small = atPxPerSquare(pic, 11, 8, 24);
    expect([small.w, small.h]).toEqual([264, 192]);
    expect(DD_FIXTURES.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!haveVern)("DD_VERN: Vern's exports", () => {
  it.skipIf(!haveVernExport("waterfall.vtt"))("waterfall's 1.2 export pairs with the committed map: 50 x 35 squares at 72 px, origin 0,0", () => {
    const pic = vernPicture("waterfall.vtt");
    expect([pic.w, pic.h]).toEqual([3600, 2520]);
    expect(pic.vtt!.resolution).toEqual({ map_origin: { x: 0, y: 0 }, map_size: { x: 50, y: 35 }, pixels_per_grid: 72 });
    expect(pic.vtt!.line_of_sight.length).toBe(2);
    const m = parseDungeondraftMap(waterfallText());
    expect([m.world.width, m.world.height]).toEqual([50, 35]);
    expect(alignDd2vtt(pic.vtt!.resolution, pic.w, pic.h, m)!.fullMap).toBe(true);
    expect(DD_VERN.length).toBeGreaterThan(0);
  });

  it.skipIf(!haveVernExport("kdir-vtt"))("Kdir's export is 48 x 27 squares at 72 px", () => {
    const pic = vernPicture("kdir-vtt");
    expect([pic.w, pic.h]).toEqual([48 * 72, 27 * 72]);
    expect(pic.vtt!.resolution.map_size).toEqual({ x: 48, y: 27 });
  });
});

describe("helpers", () => {
  it("encodePng round-trips through decodePng", () => {
    const rgba = new Uint8ClampedArray(7 * 5 * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 255;
    const back = pngPicture(encodePng(rgba, 7, 5));
    expect([back.w, back.h]).toEqual([7, 5]);
    expect(back.rgba).toEqual(rgba);
  });

  it("downsample averages boxes, weighted by alpha", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 9, 9, 9, 0]);
    const d = downsample({ rgba, w: 2, h: 2 }, 1, 1);
    expect(Array.from(d.rgba)).toEqual([128, 0, 128, 128]);
    expect(() => downsample({ rgba, w: 2, h: 2 }, 3, 3)).toThrow();
  });

  it("vttMetaOf keeps positions only, and no more than VTT_META_POINTS", () => {
    const many = Array.from({ length: 30_000 }, (_, i) => ({ position: { x: i, y: 1 }, extra: "x" }));
    const v = vttMetaOf({ resolution: { map_origin: { x: 1, y: 2 }, map_size: { x: 3, y: 4 }, pixels_per_grid: 50 }, portals: many, lights: [{ position: { x: "bad" } }] });
    expect(v.portals.length).toBe(20_000);
    expect(v.portals[0]).toEqual({ position: { x: 0, y: 1 } });
    expect(v.lights).toEqual([]);
  });
});

// ------------------------------------------------------------------ renders for a human look

describe("renders", () => {
  it("writes the fixtures' pictures to DD_RENDERS", () => {
    const tm = transformsMap(), pl = pelcsLike(), plm = parseDungeondraftMap(pl.text), e = editedPicture();
    const out: Array<[string, FakePicture]> = [
      ["snowy", fakeExport(snowy.sidecar, 32)],
      ["snowy-grid-dotted", fakeExportFromMap(snowyParsed, "0", 32, { grid: "dotted" })],
      ["snowy-cave", fakeExport(snowyMap({ cave: true }).sidecar, 32)],
      ["snowy-pack-roof", fakeExport(snowyMap({ packRoof: true }).sidecar, 32)],
      ["frozen-lake", fakeExport(frozenLake().sidecar, 32)],
      ["snowy-cropped-dd2vtt", fakeExportFromMap(snowyParsed, "0", 32, { crop: croppedDd2vtt().crop })],
      ["jagged-edge", fakeExport(jaggedEdge().sidecar, 48)],
      ["transforms", fakeExportFromMap(parseDungeondraftMap(tm.text), "0", 32, { capped: tm.capped, stroke: 0.5 })],
      ["interiors", fakeExportFromMap(parseDungeondraftMap(interiorsMap().text), "0", 24)],
      ["pelcs-ground", fakeExportFromMap(plm, pl.groundKey, 32)],
      ["pelcs-roof", fakeExportFromMap(plm, pl.roofKey, 32)],
      ["scatter-1", fakeExportFromMap(parseDungeondraftMap(scatterMap(1).text), "0", 24)],
      ["scatter-2", fakeExportFromMap(parseDungeondraftMap(scatterMap(2).text), "0", 24)],
      ["edited-saved", fakeExportFromMap(parseDungeondraftMap(e.text), "0", 24)],
      ["edited-picture", fakeExportFromMap(parseDungeondraftMap(e.pictureText), "0", 24)],
    ];
    for (const [name, pic] of out) {
      writeRender(name, pic);
      expect(pic.w * pic.h).toBeGreaterThan(0);
    }
  });
});

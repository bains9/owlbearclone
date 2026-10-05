// The Dungeondraft map parser (src/client/dd): synthetic maps with known answers, malformed and
// hostile input, the committed waterfall fixture, and the public sample maps when DD_FIXTURES
// points at them (they aren't committed; the tests skip without them).
import { describe, expect, it } from "vitest";
import { DDParseError, parseDungeondraftMap } from "../src/client/dd/parse";
import { DEFAULT_LIMITS, GRID } from "../src/client/dd/model";
import type { DDMap } from "../src/client/dd/model";
import { parseColor, parseNodeId, parsePoolByteArray, parsePoolVector2Array, parseVector2, num } from "../src/client/dd/godot";
import { MAX_SMOOTH_POINTS, pathRibbon, portalSegment, roofPolygon, smoothPolyline, type Ribbon } from "../src/client/dd/geometry";
import {
  fillEllipse, fillPolygons, mapSpec, rasterBitGrid, rasterTiles, rasterWater, sampleTerrainSlot, strokeRibbon, workBudget, type RasterSpec,
} from "../src/client/dd/ddRaster";
import { MATCH_WORK, MAX_VTT_COORD, MAX_VTT_POINTS, PointHash, alignDd2vtt, alignPlainImage, matchDd2vttLevel } from "../src/client/dd/align";
import { OR, defaultName, objectRole } from "../src/client/dd/roles";

type FsLike = { readFileSync(path: string | URL, encoding: "utf8"): string; existsSync(path: string | URL): boolean };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as FsLike;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** The public sample maps (not committed): DD_FIXTURES, or the design's working folder on Par's machine. */
const SAMPLES = (env.DD_FIXTURES ?? "C:/Users/G/tabletop-work/dd-raw/docs/samples").replace(/[\\/]+$/, "");
const haveSamples = fs.existsSync(`${SAMPLES}/fs_pelcs.dungeondraft_map`);
const waterfallText = () => fs.readFileSync(new URL("./fixtures/dd/waterfall.dungeondraft_map", import.meta.url), "utf8");

// ------------------------------------------------------------------ synthetic map builder

const W = 4, H = 3; // squares
const pool = (name: string, xs: ArrayLike<number>) => `${name}( ${Array.from(xs).join(", ")} )`;
function bits(w: number, h: number, on: (i: number, j: number) => boolean): string {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (on(i, j)) { const o = j * w + i; bytes[o >> 3] |= 1 << (o & 7); }
  return pool("PoolByteArray", bytes);
}
/** A document under construction: tests poke at any field, broken ones included. */
type Doc = any;
function synthetic(): Doc {
  const tw = W * 4, th = H * 4;
  const splat = new Uint8Array(tw * th * 4), splat2 = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const i = (ty * tw + tx) * 4;
    if (tx < 8) splat2[i] = 255; // slot 5 (snow) on squares x 0..1
    else splat[i] = 255;         // slot 1 elsewhere
  }
  const cw = W * 4 + 3, ch = H * 4 + 3;
  const mw = W * 2 + 3, mh = H * 2 + 3;
  return {
    header: {
      creation_build: "1.2.0.1 opulent kirin",
      asset_manifest: [{ name: "P", id: "AbCd1234", version: "1", author: "x", allow_3rd_party_mapping_software_to_read: false }],
      editor_state: { current_level: 0, camera_position: "Vector2( 1, 2 )" },
    },
    world: {
      format: 3, width: W, height: H, next_node_id: "1f",
      levels: {
        "0": {
          label: "Ground",
          layers: { "100": "User Layer 1", "-400": "Below Ground" },
          environment: { ambient_light: "ff102030" },
          terrain: {
            enabled: true, expand_slots: true, smooth_blending: false,
            texture_1: "res://textures/terrain/terrain_dirt.png", texture_5: "res://textures/terrain/terrain_snow.png",
            splat: pool("PoolByteArray", splat), splat2: pool("PoolByteArray", splat2),
          },
          // cave samples set for world x,y in [256, 512] (sample i at (i-1)*64)
          cave: { bitmap: bits(cw, ch, (i, j) => i >= 5 && i <= 9 && j >= 5 && j <= 9), entrance_bitmap: "PoolByteArray(  )", ground_color: "ff7f7e71" },
          // material samples set for world x in [512, 768], y in [128, 384] (step 128)
          materials: { "-400": [{ bitmap: bits(mw, mh, (i, j) => i >= 5 && i <= 7 && j >= 2 && j <= 4), texture: "res://textures/materials/ice_tile.png", smooth: false }] },
          water: {
            tree: {
              ref: 1, polygon: "PoolVector2Array(  )", children: [{
                ref: 2, polygon: "PoolVector2Array( 0, 0, 1024, 0, 1024, 768, 0, 768 )", deep_color: "ff3aa19a", shallow_color: "ff8bceb0", blend_distance: 1.5,
                children: [{ ref: 3, polygon: "PoolVector2Array( 256, 256, 512, 256, 512, 512, 256, 512 )", deep_color: "00000000",
                  children: [{ ref: 4, polygon: "PoolVector2Array( 320, 320, 448, 320, 448, 448, 320, 448 )", children: [] }] }],
              }],
            },
          },
          tiles: {
            cells: pool("PoolIntArray", [-1, 0, 0, -1, -1, 5, 5, -1, -1, -1, -1, -1]),
            colors: new Array(W * H).fill("ffffffff"),
            lookup: { "0": "res://textures/tilesets/simple/tileset_wood_damaged.png", "5": "res://packs/AbCd1234/textures/tilesets/x.png" },
          },
          shapes: { polygons: ["PoolVector2Array( 256, 0, 768, 0, 768, 512, 256, 512 )"], walls: [27, "1b"] },
          walls: [{
            points: "PoolVector2Array( 256, 0, 768, 0, 768, 512, 256, 512 )", texture: "res://textures/walls/stone.png", color: "ff705e4b",
            loop: true, type: 0, joint: 1, normalize_uv: true, shadow: true, node_id: "1b",
            portals: [{ position: "Vector2( 768, 256 )", rotation: 1.570796, scale: "Vector2( 1, 1 )", direction: "Vector2( 0, 1 )", texture: "res://textures/portals/door_00.png", radius: 128, wall_id: 27, wall_distance: 1.5, closed: true, node_id: "1c" }],
          }],
          portals: [],
          paths: [{ position: "Vector2( 512, 256 )", rotation: Math.PI / 2, scale: "Vector2( 1, 1 )", edit_points: "PoolVector2Array( 0, 0, 256, 0, 256, 0 )", smoothness: 1, texture: "res://packs/AbCd1234/textures/paths/cliff.png", width: 64, layer: 100, node_id: "a" }],
          objects: [
            { position: "Vector2( 128, 128 )", rotation: 0.523599, scale: "Vector2( 1.5, 1.5 )", mirror: false, texture: "res://textures/objects/vegetation/trees/pine_tree_01.png", layer: 100, node_id: "b" },
            { position: "Vector2( 640, 640 )", rotation: 0, scale: "Vector2( 1, 1 )", mirror: true, texture: "res://textures/objects/camp/campfire_06.png", layer: 900, custom_color: "ff6b3834", node_id: "c" },
            { position: "Vector2( 900, 100 )", rotation: 0, scale: "Vector2( 1, 1 )", texture: "res://packs/AbCd1234/textures/objects/pine_tree.png", layer: 100, node_id: "d" },
            { position: "junk" },
          ],
          lights: [{ position: "Vector2( 100, 100 )", range: 2.1, intensity: 1, color: "ffffad58", texture: "res://textures/lights/point.png", shadows: true, node_id: "e3" }],
          roofs: { shade: true, shade_contrast: 0.5, sun_direction: 45, roofs: [{ position: "Vector2( 0, 0 )", rotation: 0, scale: "Vector2( 1, 1 )", points: "PoolVector2Array( 256, 256, 768, 256 )", texture: "res://textures/roofs/x/tiles.png", width: 128, type: 1, node_id: "f" }] },
          patterns: [], texts: [],
        },
        "abc": { label: "not a level key" },
      },
    },
  };
}
const parseSynthetic = (): DDMap => parseDungeondraftMap(JSON.stringify(synthetic()));

const at = (m: Uint8Array, s: RasterSpec, x: number, y: number) => m[Math.floor((y - s.originY) / s.unitsPerPx) * s.width + Math.floor((x - s.originX) / s.unitsPerPx)];

// ------------------------------------------------------------------ the prototype's tests, ported

describe("parser: synthetic map", () => {
  it("parses", () => {
    const map = parseSynthetic();
    expect(map.world.width).toBe(4);
    expect(map.world.levels.length, "non-integer level keys are skipped").toBe(1);
    expect(map.world.nextNodeId).toBe(0x1f);
    expect(map.header.currentLevel).toBe(0);
    expect(map.header.packs[0].allowThirdParty).toBe(false);
    const L = map.world.levels[0];
    expect(L.ambientLight).toEqual({ a: 255, r: 0x10, g: 0x20, b: 0x30 });
    expect(L.layers.get(-400)).toBe("Below Ground");
    expect(L.objects.length, "an object without a position is dropped").toBe(3);
    expect(L.floorWallIds, "decimal ints and hex strings both resolve").toEqual([27, 27]);
    expect(L.walls[0].nodeId).toBe(27);
    expect(L.walls[0].portals[0].wallId).toBe(27);
    expect(L.tiles!.lookup.get(5)!.source).toBe("pack");
    expect(L.cave!.entrance, "empty PoolByteArray = no entrance").toBeNull();
  });

  it("terrain: 4 texels per square, texel centres, slot planes", () => {
    const t = parseSynthetic().world.levels[0].terrain!;
    expect([t.width, t.height, t.slotCount]).toEqual([16, 12, 8]);
    expect(defaultName(t.slots[4])).toBe("terrain_snow");
    const s = mapSpec(W, H, 64); // 4 world units per px
    const snow = sampleTerrainSlot(t, 4, s), dirt = sampleTerrainSlot(t, 0, s);
    expect(at(snow, s, 100, 100)).toBe(255);
    expect(at(snow, s, 700, 100)).toBe(0);
    expect(at(dirt, s, 700, 100)).toBe(255);
    // the 50% crossing is at the texel boundary x = 8 * 64 = 512 (between texel centres 480 and 544)
    expect(at(snow, s, 506, 100)).toBeGreaterThan(128);
    expect(at(snow, s, 518, 100)).toBeLessThan(128);
  });

  it("cave bitmap: (4W+3)x(4H+3), LSB first, sample i at (i-1)*64, iso 0.5", () => {
    const g = parseSynthetic().world.levels[0].cave!.floor!;
    expect([g.width, g.height, g.step]).toEqual([19, 15, 64]);
    const s = mapSpec(W, H, 64);
    const m = rasterBitGrid(g, s);
    expect(at(m, s, 384, 384)).toBe(255);
    expect(at(m, s, 100, 100)).toBe(0);
    // set samples span world 256..512; half a sample step outside is the iso-line: 224 and 544
    expect([at(m, s, 230, 384), at(m, s, 218, 384)]).toEqual([255, 0]);
    expect([at(m, s, 538, 384), at(m, s, 550, 384)]).toEqual([255, 0]);
  });

  it("material bitmap: (2W+3)x(2H+3), step 128", () => {
    const mat = parseSynthetic().world.levels[0].materials[0];
    expect(mat.layer).toBe(-400);
    expect([mat.mask!.width, mat.mask!.step]).toEqual([11, 128]);
    const s = mapSpec(W, H, 64);
    const m = rasterBitGrid(mat.mask!, s);
    expect(at(m, s, 640, 256)).toBe(255);
    expect(at(m, s, 440, 256)).toBe(0); // iso at 512 - 64 = 448
    expect(at(m, s, 456, 256)).toBe(255);
  });

  it("water: PolyTree even-odd (body, island, pond on island)", () => {
    const w = parseSynthetic().world.levels[0].water;
    expect(w.root!.children[0].children[0].depth).toBe(2);
    const s = mapSpec(W, H, 64);
    const m = rasterWater(w, s);
    expect(at(m, s, 100, 100)).toBe(255); // body
    expect(at(m, s, 280, 280)).toBe(0);   // island
    expect(at(m, s, 384, 384)).toBe(255); // pond on the island
  });

  it("tiles, floor polygons, walls, portals", () => {
    const L = parseSynthetic().world.levels[0];
    const s = mapSpec(W, H, 16);
    const m = rasterTiles(L.tiles!, s);
    expect([at(m, s, 300, 100), at(m, s, 100, 100), at(m, s, 300, 300)]).toEqual([255, 0, 255]);
    const f = new Uint8Array(s.width * s.height);
    fillPolygons(f, s, L.floorPolygons);
    expect([at(f, s, 500, 300), at(f, s, 900, 300)]).toEqual([255, 0]);
    const [a, b] = portalSegment(L.walls[0].portals[0]);
    expect(a.x).toBeCloseTo(768, 6);
    expect(a.y).toBeCloseTo(128, 3);
    expect(b.y).toBeCloseTo(384, 3);
  });

  it("path transform: world = position + R(rotation) * (scale * local)", () => {
    const r = pathRibbon(parseSynthetic().world.levels[0].paths[0]);
    const n = r.line.length;
    expect(r.line[0]).toBeCloseTo(512, 6);
    expect(r.line[1]).toBeCloseTo(256, 6);
    expect(r.line[n - 2], "rotated +90deg points down (y+)").toBeCloseTo(512, 3);
    expect(r.line[n - 1]).toBeCloseTo(512, 3);
    const s = mapSpec(W, H, 64);
    const m = new Uint8Array(s.width * s.height);
    strokeRibbon(m, s, r);
    expect([at(m, s, 520, 400), at(m, s, 600, 400)]).toEqual([255, 0]);
  });

  it("roof footprint: ridge swept +-width, flat ends", () => {
    const p = roofPolygon(parseSynthetic().world.levels[0].roofs[0]);
    const xs = [...p].filter((_, i) => i % 2 === 0), ys = [...p].filter((_, i) => i % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([256, 768, 128, 384]);
  });

  it("object roles through defaultName; packs opaque whatever their name", () => {
    const [pine, fire, pack] = parseSynthetic().world.levels[0].objects;
    expect(defaultName(pine.texture)).toBe("vegetation/trees/pine_tree_01");
    expect(objectRole(defaultName(pine.texture))).toBe(OR.EVERGREEN);
    expect(objectRole(defaultName(fire.texture)), "campfire must not match 'fir'").toBe(OR.FIRE);
    expect(defaultName(pack.texture)).toBeNull();
    expect(objectRole(defaultName(pack.texture))).toBe(OR.OPAQUE);
    expect([fire.mirror, fire.layer]).toEqual([true, 900]);
    expect(fire.customColor).toEqual({ a: 255, r: 0x6b, g: 0x38, b: 0x34 });
    expect(pine.rotation).toBeCloseTo(Math.PI / 6, 5);
  });

  it("alignment maths", () => {
    const map = parseSynthetic();
    const a = alignDd2vtt({ map_origin: { x: 1, y: 0.5 }, map_size: { x: 2, y: 2 }, pixels_per_grid: 100 }, 200, 200, map)!;
    expect([a.spec.originX, a.spec.originY, a.spec.unitsPerPx, a.fullMap]).toEqual([256, 128, 2.56, false]);
    const half = alignDd2vtt({ map_origin: { x: 0, y: 0 }, map_size: { x: 4, y: 3 }, pixels_per_grid: 256 }, 512, 384, map)!;
    expect(half.spec.unitsPerPx, "a picture shrunk after export keeps its world mapping").toBe(2);
    expect(alignPlainImage(map, 400, 300)!.ppg).toBe(100);
    expect(alignPlainImage(map, 400, 400), "wrong aspect = cropped or not this map").toBeNull();
  });
});

describe("parser: value readers", () => {
  it("reads Godot values and refuses anything else", () => {
    expect(parseColor("7f000000")).toEqual({ a: 127, r: 0, g: 0, b: 0 });
    expect(parseColor("#ff8800")).toEqual({ r: 255, g: 136, b: 0, a: 255 });
    expect(parseColor("zz")).toBeNull();
    expect([parseNodeId("5b"), parseNodeId(27), parseNodeId("-1")]).toEqual([91, 27, -1]);
    expect(parseNodeId("xyz")).toBeNull();
    expect(parseNodeId("123456789")).toBeNull();
    expect(parseVector2("Vector2( 5113.22, -4556.35 )")).toEqual({ x: 5113.22, y: -4556.35 });
    expect(parseVector2("Vector2( 1e3, 2 )")).toEqual({ x: 1000, y: 2 });
    expect(parseVector2("Vector2( 1, 2, 3 )")).toBeNull();
    expect(parseVector2("Vector3( 1, 2 )")).toBeNull();
    expect(parseVector2("Vector2( nan, 2 )")).toBeNull();
    expect([...parsePoolByteArray("PoolByteArray( 0, 255 )", 10)!]).toEqual([0, 255]);
    expect(parsePoolByteArray("PoolByteArray( 0, 256 )", 10)).toBeNull();
    expect(parsePoolByteArray("PoolByteArray( 1, 2, 3 )", 2), "over the limit").toBeNull();
    expect(parsePoolByteArray("PoolByteArray( 1,, 2 )", 10)).toBeNull();
    expect(parsePoolByteArray("PoolIntArray( 1 )", 10), "wrong type name").toBeNull();
    expect(parsePoolByteArray("PoolByteArray(  )", 10)!.length).toBe(0);
    expect([...parsePoolByteArray([1, 2], 10)!]).toEqual([1, 2]);
    expect(parsePoolVector2Array("PoolVector2Array( 1, 2, 3 )", 10), "odd count").toBeNull();
  });

  it("number readers are linear on long digit runs (no regex backtracking)", () => {
    const long = "1".repeat(200_000) + "x";
    const t0 = performance.now();
    expect(num(long)).toBeNull();
    expect(num(" ".repeat(100_000) + "5")).toBe(5);
    expect(parsePoolVector2Array(`PoolVector2Array( ${"9".repeat(100_000)}.5x, 1 )`, 10)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
    // the unambiguous pattern accepts exactly what the old one did
    for (const s of ["1", "-1.", ".5", "+2.5e-3", " 7 ", "1e", "1.2.3", "--1", ".", "e5", "1_000"]) {
      const old = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/.test(s) ? Number(s) : null;
      expect(num(s), s).toBe(old);
    }
  });
});

// ------------------------------------------------------------------ malformed input

function throwsParse(text: string, what: string): void {
  expect(() => parseDungeondraftMap(text), what).toThrow(DDParseError);
}

describe("parser: malformed input", () => {
  it("refuses what isn't a map", () => {
    throwsParse("not json", "not json");
    throwsParse("[]", "array");
    throwsParse("{}", "no world");
    throwsParse(JSON.stringify({ world: { width: 0, height: 3 } }), "zero width");
    throwsParse(JSON.stringify({ world: { width: 1e6, height: 3 } }), "huge width");
    throwsParse(JSON.stringify({ world: { width: 2.5, height: 3 } }), "fractional width");
    expect(() => parseDungeondraftMap("x".repeat(100), { maxChars: 50 })).toThrow(DDParseError);
    // minimal valid
    expect(parseDungeondraftMap(JSON.stringify({ world: { width: 2, height: 2 } })).world.levels.length).toBe(0);
    // BOM + nan tokens
    const withNan = "\ufeff" + JSON.stringify({ world: { width: 2, height: 2, levels: { "0": { lights: [{ position: "Vector2( 1, 1 )", range: 1 }] } } } }).replace('"range":1', '"range":nan');
    expect(parseDungeondraftMap(withNan).world.levels[0].lights[0].range).toBe(0);
  });

  it("degrades broken fields with warnings", () => {
    const doc = synthetic();
    const L = doc.world.levels["0"];
    L.terrain.splat = "PoolByteArray( 1, 2, 3 )";          // wrong size
    L.terrain.splat2 = "PoolByteArray( 999 )";              // bad value
    L.cave.bitmap = "PoolByteArray( 1, 2 )";                // wrong size
    L.tiles.cells = "PoolIntArray( 1, 2 )";                 // wrong size
    L.water.tree.children[0].polygon = "PoolVector2Array( 1, 2, 3 )";
    L.objects = { not: "an array" };
    L.walls = [null, 5, { points: "garbage" }];
    L.paths = [{ edit_points: "PoolVector2Array( 0, 0 )" }];
    L.roofs = "nope";
    L.layers = { "x": "bad", "100": 5 };
    const m = parseDungeondraftMap(JSON.stringify(doc));
    const lv = m.world.levels[0];
    expect(m.warnings.length, m.warnings.join("\n")).toBeGreaterThanOrEqual(4);
    expect(lv.terrain!.weights[0], "no splat -> slot 1 everywhere").toBe(255);
    expect(lv.cave).toBeNull();
    expect(lv.tiles).toBeNull();
    expect(lv.objects.length).toBe(0);
    expect(lv.walls.length).toBe(0);
    expect(lv.paths.length, "a path needs two points").toBe(0);
    expect(lv.roofs.length).toBe(0);
    expect(lv.layers.size).toBe(0);
    expect(lv.water.root!.children[0].polygon.length).toBe(0);
  });

  it("limits: deep water tree, point budget, item count", () => {
    let node: Doc = { polygon: "PoolVector2Array( 0, 0, 1, 0, 1, 1 )", children: [] };
    for (let i = 0; i < 200; i++) node = { polygon: "PoolVector2Array( 0, 0, 1, 0, 1, 1 )", children: [node] };
    const doc = { world: { width: 2, height: 2, levels: { "0": { water: { tree: node }, objects: new Array(50).fill({ position: "Vector2( 1, 1 )" }) } } } };
    const m = parseDungeondraftMap(JSON.stringify(doc), { maxWaterDepth: 64, maxItemsPerKind: 10, maxTotalPoints: 30 });
    let depth = 0, n = m.world.levels[0].water.root;
    while (n && n.children.length) { n = n.children[0]; depth++; }
    expect(depth).toBeLessThanOrEqual(64);
    expect(m.world.levels[0].objects.length).toBe(10);
    expect(m.warnings.some((w) => w.includes("points")), "point budget warning").toBe(true);
  });

  it("fuzz: truncations and byte flips never throw anything but DDParseError", () => {
    const base = JSON.stringify(synthetic());
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const alphabet = '0123456789,.-e(){}[]":aZ PoolByteArrayVector2';
    for (let k = 0; k < 1500; k++) {
      let t = base;
      if (rnd() < 0.3) t = t.slice(0, Math.floor(rnd() * t.length));
      else {
        const chars = t.split("");
        const flips = 1 + Math.floor(rnd() * 8);
        for (let f = 0; f < flips; f++) chars[Math.floor(rnd() * chars.length)] = alphabet[Math.floor(rnd() * alphabet.length)];
        t = chars.join("");
      }
      try {
        const m = parseDungeondraftMap(t);
        // and the rasterisers accept whatever came out
        const s = mapSpec(m.world.width, m.world.height, 8);
        for (const L of m.world.levels) {
          if (L.terrain) sampleTerrainSlot(L.terrain, 0, s);
          rasterWater(L.water, s);
          if (L.cave?.floor) rasterBitGrid(L.cave.floor, s);
          for (const p of L.paths) strokeRibbon(new Uint8Array(s.width * s.height), s, pathRibbon(p));
          for (const r of L.roofs) roofPolygon(r);
        }
      } catch (e) {
        if (!(e instanceof DDParseError)) throw new Error(`${String(e)} on input ${t.slice(0, 300)}`);
      }
    }
  });
});

// ------------------------------------------------------------------ hostile input (the GM opens files from anywhere)

describe("parser: hostile input", () => {
  it("__proto__, constructor and prototype keys are inert", () => {
    // Built with stand-in keys, renamed in the text: JSON.parse makes "__proto__" an own key, as a file would.
    const doc = synthetic();
    const L = doc.world.levels["0"];
    doc.PROTO = { polluted: 1 };
    doc.CTOR = { prototype: { polluted: 1 } };
    doc.world.PROTO = { width: 1 };
    doc.header.asset_manifest.push({ id: "__proto__", name: "x" }, { id: "constructor", name: "y" });
    doc.world.levels.PROTO = { label: "x" };
    doc.world.levels.CTOR = {};
    L.layers = { PROTO: "x", "100": "ok" };
    L.tiles.lookup = { PROTO: "res://textures/x.png", "0": "res://textures/tilesets/simple/t.png" };
    L.materials = { PROTO: [{ bitmap: "PoolByteArray( )" }] };
    L.objects.push({ PROTO: { position: "Vector2( 1, 1 )" }, position: "Vector2( 2, 2 )", texture: "res://packs/__proto__/textures/objects/a.png" });
    L.paths.push({ ...L.paths[0], texture: "res://textures/paths/__proto__.png" });
    const text = JSON.stringify(doc).replaceAll('"PROTO":', '"__proto__":').replaceAll('"CTOR":', '"constructor":');
    expect(text).toContain('"__proto__":{"polluted":1}');
    const m = parseDungeondraftMap(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(m.world.levels.map((l) => l.key)).toEqual(["0"]);
    const lv = m.world.levels[0];
    expect([...lv.layers.entries()]).toEqual([[100, "ok"]]);
    expect([...lv.tiles!.lookup.keys()]).toEqual([0]);
    expect(lv.materials.length).toBe(0);
    expect(lv.objects.at(-1)!.position).toEqual({ x: 2, y: 2 });
    expect(objectRole(defaultName(lv.objects.at(-1)!.texture))).toBe(OR.OPAQUE);
    expect(m.header.packs.map((p) => p.id)).toContain("__proto__");
    expect(Object.getPrototypeOf(lv.objects.at(-1))).toBe(Object.prototype);
  });

  it("a default-looking path that climbs out of res://textures is not a default asset", () => {
    const doc = synthetic();
    doc.world.levels["0"].objects = [
      { position: "Vector2( 1, 1 )", texture: "res://textures/../packs/AbCd1234/textures/objects/pine_tree.png" },
      { position: "Vector2( 1, 1 )", texture: "res://textures/objects/./vegetation/trees/pine_tree_01.png" },
      { position: "Vector2( 1, 1 )", texture: "res://textures/objects\\..\\x/pine_tree_01.png" },
    ];
    const objs = parseDungeondraftMap(JSON.stringify(doc)).world.levels[0].objects;
    for (const o of objs) {
      expect(o.texture!.source).toBe("unknown");
      expect(objectRole(defaultName(o.texture))).toBe(OR.OPAQUE);
    }
  });

  it("deeply nested JSON is refused before JSON.parse builds it", () => {
    const deep = "[".repeat(200_000) + "]".repeat(200_000);
    for (const text of [deep, `{"world":{"width":2,"height":2,"levels":{"0":{"objects":${deep}}}}}`]) {
      expect(() => parseDungeondraftMap(text)).toThrow(/nested deeper than 512/);
    }
    // 31 M brackets fit under maxChars and cost JSON.parse 3 GB; the pre-scan stops at bracket 513
    const t0 = performance.now();
    expect(() => parseDungeondraftMap("[".repeat(31_000_000))).toThrow(/nested deeper/);
    expect(performance.now() - t0).toBeLessThan(3000);
    // exactly at the limit is fine (the map's own fields sit 2 deep)
    const nest = (d: number) => `{"world":{"width":2,"height":2,"x":${"[".repeat(d - 2)}${"]".repeat(d - 2)}}}`;
    expect(parseDungeondraftMap(nest(512)).world.width).toBe(2);
    expect(() => parseDungeondraftMap(nest(513))).toThrow(DDParseError);
    // a water tree cut at maxWaterDepth nests about twice as deep in the text, and must still be read
    expect(DEFAULT_LIMITS.maxJsonDepth).toBeGreaterThanOrEqual(2 * DEFAULT_LIMITS.maxWaterDepth + 16);
  });

  it("the JSON pre-scan counts only structure outside strings", () => {
    // brackets, commas and escaped quotes inside strings don't count; an even run of backslashes ends a string
    const label = '[[[[{{{{\\"[[[[,,,,';
    const text = `{"world":{"width":2,"height":2,"levels":{"0":{"label":${JSON.stringify(label)},"texts":["x\\\\","[[",1]}}}}`;
    const lim = { maxJsonDepth: 5, maxJsonContainers: 5, maxJsonValues: 10 };
    const m = parseDungeondraftMap(text, lim);
    expect(m.world.levels[0].label).toBe(label);
    expect(m.world.levels[0].textCount).toBe(3);
    // one more of anything is refused
    expect(() => parseDungeondraftMap(text, { ...lim, maxJsonDepth: 4 })).toThrow(/nested deeper than 4/);
    expect(() => parseDungeondraftMap(text, { ...lim, maxJsonContainers: 4 })).toThrow(/more than 4 objects and arrays/);
    expect(() => parseDungeondraftMap(text, { ...lim, maxJsonValues: 9 })).toThrow(/more than 9 values/);
  });

  it("floods of small values are refused before JSON.parse (its memory is not bounded otherwise)", () => {
    const wrap = (inner: string) => `{"world":{"width":2,"height":2,"levels":{"0":{"objects":[${inner}]}}}}`;
    const t0 = performance.now();
    expect(() => parseDungeondraftMap(wrap(new Array(DEFAULT_LIMITS.maxJsonContainers + 1).fill("{}").join(",")))).toThrow(/objects and arrays/);
    expect(() => parseDungeondraftMap(wrap(new Array(DEFAULT_LIMITS.maxJsonValues + 1).fill("0").join(",")))).toThrow(/values/);
    expect(performance.now() - t0).toBeLessThan(5000);
    // real maps are far inside the limits (the samples are checked too, below)
    expect(parseDungeondraftMap(waterfallText()).world.levels.length).toBe(1);
  });

  it("decoded grids share a whole-map byte budget", () => {
    // 20 levels of 100x100 squares, each with a terrain but no splat: 8 bytes a texel each (1.28 MB).
    const levels: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) levels[String(i)] = { terrain: { enabled: true } };
    const text = JSON.stringify({ world: { width: 100, height: 100, levels } });
    const m = parseDungeondraftMap(text, { maxGridBytes: 5_000_000 });
    expect(m.world.levels.length).toBe(20);
    expect(m.world.levels.filter((l) => l.terrain).length).toBe(3);
    expect(m.warnings.some((w) => w.includes("memory budget"))).toBe(true);
    // the default budget is what keeps a 500x500 map with 64 such levels from asking for 2 GB
    expect(DEFAULT_LIMITS.maxGridBytes).toBeLessThanOrEqual(256 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxChars).toBe(60 * 1024 * 1024);
  });

  it("items share a whole-map budget across kinds and levels", () => {
    const o = { position: "Vector2( 1, 1 )" };
    const lv = { objects: new Array(40).fill(o), lights: new Array(40).fill(o), portals: new Array(40).fill(o) };
    const m = parseDungeondraftMap(JSON.stringify({ world: { width: 2, height: 2, levels: { "0": lv, "1": lv } } }), { maxTotalItems: 100 });
    const count = m.world.levels.reduce((s, l) => s + l.objects.length + l.lights.length + l.portals.length, 0);
    expect(count).toBe(100);
    expect(m.warnings.some((w) => w.includes("only the first"))).toBe(true);
  });

  it("odd limits are ignored, not trusted", () => {
    const text = JSON.stringify({ world: { width: 2, height: 2, levels: { "0": { objects: [{ position: "Vector2( 1, 1 )" }] } } } });
    const odd = { maxItemsPerKind: -1, maxTotalItems: Number.NaN, maxSide: "9" as unknown as number, maxChars: undefined };
    expect(parseDungeondraftMap(text, odd).world.levels[0].objects.length).toBe(1);
  });

  it("error messages don't echo huge values", () => {
    try {
      parseDungeondraftMap(JSON.stringify({ world: { width: "9".repeat(10_000), height: 2 } }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DDParseError);
      expect((e as Error).message.length).toBeLessThan(100);
    }
  });

  it("a path of many far-apart points smooths to a bounded line", () => {
    const n = 20_000;
    const pts = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) { pts[i * 2] = (i % 2) * 1e6; pts[i * 2 + 1] = i * 1e4; }
    const line = smoothPolyline(pts, 1, false);
    expect(line.length / 2).toBeLessThanOrEqual(MAX_SMOOTH_POINTS + n);
    expect(line.length / 2).toBeGreaterThan(n);
    expect(line[line.length - 1]).toBe((n - 1) * 1e4);
  });

  it("clamps scales, widths and radii, so no item covers the world", () => {
    const doc = synthetic();
    const L = doc.world.levels["0"];
    L.objects[0].scale = "Vector2( 1e300, -1e300 )";
    L.objects[1].scale = "Vector2( 16, -16 )";
    L.paths[0].width = 1e300;
    L.paths[0].scale = "Vector2( 1, 1e300 )";
    L.roofs.roofs[0].width = 1e300;
    L.roofs.roofs[0].scale = "Vector2( -1e300, 2 )";
    L.walls[0].portals[0].radius = -1e300;
    L.portals = [{ position: "Vector2( 1, 1 )", scale: "Vector2( 1e308, 1 )", radius: 1e300 }];
    L.patterns = [{ position: "Vector2( 0, 0 )", scale: "Vector2( 1e300, 1e300 )", points: "PoolVector2Array( 0, 0, 1, 0, 1, 1 )" }];
    const m = parseDungeondraftMap(JSON.stringify(doc));
    const lv = m.world.levels[0];
    const { maxScale: S, maxWidth: Wd } = DEFAULT_LIMITS;
    expect([S, Wd]).toEqual([16, 16 * GRID]);
    expect(lv.objects[0].scale).toEqual({ x: S, y: -S });
    expect(lv.objects[1].scale, "at the limit: untouched").toEqual({ x: 16, y: -16 });
    expect([lv.paths[0].width, lv.paths[0].scale.y]).toEqual([Wd, S]);
    expect([lv.roofs[0].width, lv.roofs[0].scale.x]).toEqual([Wd, -S]);
    expect(lv.walls[0].portals[0].radius).toBe(-Wd);
    expect([lv.portals[0].radius, lv.portals[0].scale.x]).toEqual([Wd, S]);
    expect(lv.patterns[0].scale).toEqual({ x: S, y: S });
    expect(m.warnings.filter((w) => w.includes("clamped")), "one warning for them all").toEqual([expect.stringMatching(/^11 scales, widths or radii/)]);
    // the drawn width (width x scale.y) is capped too
    const r = pathRibbon(lv.paths[0]);
    expect(Math.max(...r.halfWidth)).toBe(Wd / 2);
    // the limits are limits like the others
    expect(parseSynthetic().world.levels[0].objects[0].scale.x, "real values untouched").toBe(1.5);
    expect(parseDungeondraftMap(JSON.stringify(synthetic()), { maxScale: 1 }).world.levels[0].objects[0].scale.x).toBe(1);
  });

  it("strokeRibbon: exact as before whenever it fits the budget", () => {
    /** The prototype's stroke, kept as the reference. */
    function strokeRef(mask: Uint8Array, s: RasterSpec, r: Ribbon): void {
      const L = r.line, n = L.length / 2, upp = s.unitsPerPx;
      for (let i = 0; i < n - 1; i++) {
        const ax = (L[i * 2] - s.originX) / upp, ay = (L[i * 2 + 1] - s.originY) / upp;
        const bx = (L[i * 2 + 2] - s.originX) / upp, by = (L[i * 2 + 3] - s.originY) / upp;
        const ha = r.halfWidth[i] / upp, hb = r.halfWidth[i + 1] / upp, hm = Math.max(ha, hb);
        const u0 = Math.max(0, Math.floor(Math.min(ax, bx) - hm)), u1 = Math.min(s.width - 1, Math.ceil(Math.max(ax, bx) + hm));
        const v0 = Math.max(0, Math.floor(Math.min(ay, by) - hm)), v1 = Math.min(s.height - 1, Math.ceil(Math.max(ay, by) + hm));
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
          let t = len2 > 0 ? ((u + 0.5 - ax) * dx + (v + 0.5 - ay) * dy) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + t * dx - u - 0.5, qy = ay + t * dy - v - 0.5, h = ha + (hb - ha) * t;
          if (qx * qx + qy * qy <= h * h) mask[v * s.width + u] = 255;
        }
      }
    }
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const s: RasterSpec = { width: 97, height: 61, originX: -300, originY: 100, unitsPerPx: 7.3 };
    for (let k = 0; k < 40; k++) {
      const n = 2 + Math.floor(rnd() * 30);
      const line = new Float64Array(n * 2), hw = new Float64Array(n);
      for (let i = 0; i < n; i++) { line[i * 2] = -400 + rnd() * 900; line[i * 2 + 1] = 50 + rnd() * 550; hw[i] = rnd() * 60; }
      if (k === 0) line[3] = Number.NaN;
      if (k === 1) line[2] = Number.POSITIVE_INFINITY;
      const got = new Uint8Array(s.width * s.height), want = new Uint8Array(s.width * s.height);
      expect(strokeRibbon(got, s, { line, halfWidth: hw, closed: false })).toBe(true);
      strokeRef(want, s, { line, halfWidth: hw, closed: false });
      expect(got, `ribbon ${k}`).toEqual(want);
    }
    // the budget is charged what was spent, and a shared one runs out
    const r: Ribbon = { line: Float64Array.from([0, 300, 700, 300]), halfWidth: Float64Array.from([70, 70]), closed: false };
    const b = { left: 5000 };
    expect(strokeRibbon(new Uint8Array(s.width * s.height), s, r, 255, b)).toBe(true);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.left).toBeLessThan(5000);
    expect(strokeRibbon(new Uint8Array(s.width * s.height), s, r, 255, { left: 10 })).toBe(false);
  });

  it("strokeRibbon: a dense ribbon over budget is thinned by under a pixel's worth; a hopeless one is skipped", () => {
    const s: RasterSpec = { width: 1000, height: 100, originX: 0, originY: 0, unitsPerPx: 1 };
    const n = 2000;
    const line = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) { line[i * 2] = 100 + i * 0.4; line[i * 2 + 1] = 50; }
    const r: Ribbon = { line, halfWidth: new Float64Array(n).fill(20), closed: false };
    const exact = new Uint8Array(s.width * s.height), thin = new Uint8Array(s.width * s.height);
    expect(strokeRibbon(exact, s, r, 255, { left: 1e9 })).toBe(true);
    const b = { left: 500_000 };
    expect(strokeRibbon(thin, s, r, 255, b)).toBe(true);
    expect(b.left).toBeGreaterThanOrEqual(0);
    let painted = 0, diff = 0;
    for (let i = 0; i < exact.length; i++) { if (exact[i]) painted++; if (exact[i] !== thin[i]) diff++; }
    expect(painted).toBeGreaterThan(30_000);
    expect(diff).toBeLessThan(painted * 0.01);
    // a zigzag across the whole picture, 10k times: nothing drawn, nothing charged, fast
    const z = new Float64Array(20_000);
    for (let i = 0; i < 10_000; i++) { z[i * 2] = (i % 2) * 999; z[i * 2 + 1] = (i % 2) * 99; }
    const zz = new Uint8Array(s.width * s.height), zb = workBudget(s), before = zb.left;
    const t0 = performance.now();
    expect(strokeRibbon(zz, s, { line: z, halfWidth: new Float64Array(10_000).fill(3), closed: false }, 255, zb)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(zz.some((v) => v !== 0)).toBe(false);
    expect(zb.left).toBe(before);
  });

  it("a crafted path (20k far-apart points, width 1e300) strokes or gives up quickly", () => {
    const pts = Array.from({ length: 20_000 }, (_, i) => `${(i % 2) * 1e9}, ${i}`).join(",");
    const text = JSON.stringify({ world: { width: 20, height: 20, levels: { "0": { paths: [{ position: "Vector2( 0, 0 )", edit_points: `PoolVector2Array( ${pts} )`, width: 1e300, smoothness: 1 }] } } } });
    const m = parseDungeondraftMap(text);
    const spec = mapSpec(20, 20, 32);
    const t0 = performance.now();
    const r = pathRibbon(m.world.levels[0].paths[0]);
    expect(r.line.length / 2).toBeGreaterThan(500_000);
    strokeRibbon(new Uint8Array(spec.width * spec.height), spec, r);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it("fillEllipse: a shared budget bounds many huge footprints", () => {
    const s = mapSpec(10, 10, 10);
    const lab = new Int32Array(s.width * s.height);
    const big = { cx: 1280, cy: 1280, rx: 16 * 4096, ry: 16 * 4096, rotation: 1e308 };
    const b = { left: 3 * s.width * s.height };
    let drawn = 0;
    for (let i = 1; i <= 1000; i++) if (fillEllipse(lab, s, big, i, b)) drawn++;
    expect(drawn).toBe(3);
    expect(lab[0]).toBe(3);
    expect(fillEllipse(lab, s, big, 7), "no budget: always drawn").toBe(true);
    expect(fillEllipse(lab, s, { ...big, cx: 1e300 }, 8, { left: 0 }), "off the raster costs nothing").toBe(true);
  });
});

// ------------------------------------------------------------------ level matching (spatial hash)

describe("matchDd2vttLevel", () => {
  /** The prototype's O(n·m) version, kept here as the reference. */
  function bruteForce(map: DDMap, d: { portals?: unknown; lights?: unknown; line_of_sight?: unknown }, tol = 0.05) {
    type P = { x: number; y: number };
    const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const pts = (v: unknown): P[] => (Array.isArray(v) ? v.slice(0, 20000).filter((p): p is P => !!p && typeof p === "object" && fin(p.x) && fin(p.y)) : []);
    const exP = Array.isArray(d.portals) ? pts(d.portals.map((p: { position?: unknown }) => p?.position)) : [];
    const exL = Array.isArray(d.lights) ? pts(d.lights.map((p: { position?: unknown }) => p?.position)) : [];
    const exLos: P[] = [];
    if (Array.isArray(d.line_of_sight)) for (const line of d.line_of_sight.slice(0, 5000)) exLos.push(...pts(line));
    return map.world.levels.map((L) => {
      const portals: P[] = [...L.walls.flatMap((w) => w.portals), ...L.portals].map((p) => ({ x: p.position.x / GRID, y: p.position.y / GRID }));
      const lights = L.lights.map((l) => ({ x: l.position.x / GRID, y: l.position.y / GRID }));
      const wallPts: P[] = [];
      for (const w of L.walls) {
        for (let i = 0; i < w.points.length; i += 2) wallPts.push({ x: w.points[i] / GRID, y: w.points[i + 1] / GRID });
        for (const p of w.portals) for (const e of portalSegment(p)) wallPts.push({ x: e.x / GRID, y: e.y / GRID });
      }
      const near = (q: P, set: P[]) => set.some((p) => Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol);
      let hit = 0, checked = 0, losHit = 0;
      for (const q of exP) { checked++; if (near(q, portals)) hit++; }
      for (const q of exL) { checked++; if (near(q, lights)) hit++; }
      for (const q of exLos) if (near(q, wallPts)) losHit++;
      const losScore = exLos.length ? losHit / exLos.length : 0;
      return { key: L.key, score: checked ? (hit / checked) * 0.7 + losScore * 0.3 : losScore, checked: checked + exLos.length };
    }).sort((a, b) => b.score - a.score);
  }

  it("gives exactly the brute-force scores, including points at the tolerance's edge", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const levels: Record<string, unknown> = {};
    for (let k = 0; k < 3; k++) {
      const wallPts: number[] = [];
      for (let i = 0; i < 400; i++) wallPts.push(Math.round(rnd() * 40 * GRID), Math.round(rnd() * 30 * GRID));
      levels[String(k)] = {
        walls: [{ points: pool("PoolVector2Array", wallPts), portals: [{ position: `Vector2( ${Math.round(rnd() * 10240)}, ${Math.round(rnd() * 7680)} )`, radius: 128 }] }],
        lights: Array.from({ length: 30 }, () => ({ position: `Vector2( ${Math.round(rnd() * 10240)}, ${Math.round(rnd() * 7680)} )` })),
      };
    }
    const map = parseDungeondraftMap(JSON.stringify({ world: { width: 40, height: 30, levels } }));
    const L1 = map.world.levels[1];
    const tol = 0.05;
    const los: Array<Array<{ x: number; y: number }>> = [[]];
    for (let i = 0; i < L1.walls[0].points.length; i += 2) {
      const x = L1.walls[0].points[i] / GRID, y = L1.walls[0].points[i + 1] / GRID;
      const j = (i / 2) % 4; // exact, at +tol, just past tol, far
      los[0].push(j === 0 ? { x, y } : j === 1 ? { x: x + tol, y: y - tol } : j === 2 ? { x: x + tol * 1.001, y } : { x: x + 3, y: y + 3 });
    }
    const vtt = {
      portals: L1.walls[0].portals.map((p) => ({ position: { x: p.position.x / GRID, y: p.position.y / GRID } })),
      lights: [...L1.lights.map((l) => ({ position: { x: l.position.x / GRID + tol, y: l.position.y / GRID } })), { position: { x: "1", y: 2 } }, null, 5],
      line_of_sight: [...los, "junk", [null]],
    };
    const got = matchDd2vttLevel(map, vtt, tol).map((m) => ({ key: m.level.key, score: m.score, checked: m.checked }));
    expect(got).toEqual(bruteForce(map, vtt, tol));
    expect(got[0].key).toBe("1");
    for (const t of [0, 1e-12, 0.5, 3]) {
      expect(matchDd2vttLevel(map, vtt, t).map((m) => m.score), `tol ${t}`).toEqual(bruteForce(map, vtt, t).map((m) => m.score));
    }
  });

  it("reads a bounded number of export points", () => {
    const map = parseSynthetic();
    const line = Array.from({ length: 20000 }, () => ({ x: 1, y: 1 }));
    const vtt = { line_of_sight: new Array(5000).fill(line) };
    const t0 = performance.now();
    const [m] = matchDd2vttLevel(map, vtt);
    expect(m.checked).toBe(MAX_VTT_POINTS);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it("ends on far-out coordinates (the hash's cell index passes 2^53)", () => {
    const map = parseDungeondraftMap(JSON.stringify({ world: { width: 4, height: 4, levels: { "0": {
      walls: [{ points: "PoolVector2Array( 0, 0, 1e300, 768, 256, 256 )" }],
      lights: [{ position: "Vector2( 2.56e18, 768 )" }],
    } } } }));
    const t0 = performance.now();
    for (const x of [1000, 4e14, 4.6e14, 1e16, 1e300, -1e300, MAX_VTT_COORD, MAX_VTT_COORD * 1.5]) {
      const r = matchDd2vttLevel(map, { portals: [{ position: { x, y: 3 } }], lights: [{ position: { x: 1, y: x } }], line_of_sight: [[{ x, y: 3 }, { x: 1, y: 1 }]] });
      expect(r[0].checked, `x ${x}`).toBe(Math.abs(x) <= MAX_VTT_COORD ? 4 : 1);
    }
    expect(performance.now() - t0).toBeLessThan(2000);
    // the hash itself, where cell + 1 === cell
    const c = 1e16 / 0.05;
    expect(Math.floor(c) + 1).toBe(Math.floor(c));
    const h = new PointHash(0.05);
    h.add(1e16, 3);
    h.add(1e300, -1e300);
    expect(h.near({ x: 1e16, y: 3 })).toBe(true);
    expect(h.near({ x: 1e300, y: -1e300 })).toBe(true);
    expect(h.near({ x: -1e300, y: 1e300 })).toBe(false);
    expect(new PointHash(0).near({ x: 1e300, y: 1e300 })).toBe(false);
  });

  it("counts the points its searches read, in one counter for several hashes", () => {
    const work = { read: 0 };
    const a = new PointHash(0.05, work), b = new PointHash(0.05, work);
    for (let i = 0; i < 10; i++) a.add(0, 0);
    b.add(5, 5);
    expect(a.near({ x: 0.07, y: 0 })).toBe(false);
    expect(work.read).toBe(10);
    expect(b.near({ x: 5, y: 5 })).toBe(true);
    expect(work.read).toBe(11);
    expect(new PointHash(0.05).work).toEqual({ read: 0 });
  });

  it("stops when the searches read too many map points, and the export then tells nothing", () => {
    // A crafted file: every wall point of a level in one cell, and export points just outside the
    // tolerance beside it, so each search reads all of them (O(points x queries) without the budget).
    const n = 200_000;
    const crowd = new Array<number>(2 * n).fill(0);
    const map = parseDungeondraftMap(JSON.stringify({ world: { width: 50, height: 35, levels: {
      "0": { walls: [{ points: pool("PoolVector2Array", crowd) }] },
      "1": { walls: [{ points: pool("PoolVector2Array", [256, 256, 512, 256]) }] },
    } } }));
    expect(map.world.levels[0].walls[0].points.length).toBe(2 * n);
    const line = Array.from({ length: 20_000 }, (_, i) => (i % 2 ? { x: 0.099, y: 0 } : { x: 0, y: 0 }));
    const t0 = performance.now();
    const got = matchDd2vttLevel(map, { line_of_sight: [line] });
    const ms = performance.now() - t0;
    expect(got.map((m) => [m.score, m.checked])).toEqual([[0, 0], [0, 0]]);
    // 20,000 searches of 200,000 points would read 4e9 of them (seconds); the budget stops it near MATCH_WORK.
    expect(ms).toBeLessThan((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PERF ? 500 : 3000);
    // Under the budget, the same search gives the brute-force answer: half the line on level 0's walls.
    const few = parseDungeondraftMap(JSON.stringify({ world: { width: 50, height: 35, levels: {
      "0": { walls: [{ points: pool("PoolVector2Array", new Array<number>(200).fill(0)) }] },
      "1": { walls: [{ points: pool("PoolVector2Array", [256, 256, 512, 256]) }] },
    } } }));
    expect(matchDd2vttLevel(few, { line_of_sight: [line] }).map((m) => [m.level.key, m.score])).toEqual([["0", 0.5], ["1", 0]]);
    // The same, with a budget it can't keep: as an export with no clues.
    expect(matchDd2vttLevel(few, { line_of_sight: [line] }, 0.05, 1000).map((m) => [m.level.key, m.score, m.checked])).toEqual([["0", 0, 0], ["1", 0, 0]]);
    expect(MATCH_WORK).toBe(50_000_000);
  }, 30_000);
});

// ------------------------------------------------------------------ real files

describe("waterfall.dungeondraft_map (Vern's, committed)", () => {
  it("parses cleanly", () => {
    const m = parseDungeondraftMap(waterfallText());
    expect(m.warnings, m.warnings.join("\n")).toEqual([]);
    expect([m.world.width, m.world.height]).toEqual([50, 35]);
    const L = m.world.levels[0];
    expect(L.terrain!.slotCount).toBe(8);
    expect(L.objects.length).toBe(71);
    expect(L.paths.length).toBe(2);
    expect(L.cave!.floor!.width).toBe(203);
    const n = L.terrain!.width * L.terrain!.height;
    for (let i = 0; i < n; i += 97) {
      let s = 0;
      for (let k = 0; k < 8; k++) s += L.terrain!.weights[k * n + i];
      expect(s).toBeGreaterThanOrEqual(250);
      expect(s).toBeLessThanOrEqual(255);
    }
  });
});

describe.skipIf(!haveSamples)("public sample maps (DD_FIXTURES)", () => {
  const read = (name: string) => fs.readFileSync(`${SAMPLES}/${name}`, "utf8");
  const maps = ["ak_hobble", "fs_cavern", "fs_pelcs", "fs_tulgi", "hd_brawl", "hd_forest", "hd_mill", "hd_river"];
  // The counts the prototype parser gives (the port was compared with it model for model).
  const objects: Record<string, number> = { ak_hobble: 88, fs_cavern: 230, fs_pelcs: 316, fs_tulgi: 168, hd_brawl: 3, hd_forest: 135, hd_mill: 376, hd_river: 91 };

  it("every sample parses, with the prototype's object counts", () => {
    for (const name of maps) {
      const m = parseDungeondraftMap(read(`${name}.dungeondraft_map`));
      expect(m.world.levels.reduce((s, l) => s + l.objects.length, 0), name).toBe(objects[name]);
      expect(m.warnings.filter((w) => w.includes("clamped")), `${name}: real values are within the clamps`).toEqual([]);
      // every path strokes exactly within one default budget, at well under one pixel test a pixel
      const spec = mapSpec(m.world.width, m.world.height, 32);
      const budget = workBudget(spec), start = budget.left, mask = new Uint8Array(spec.width * spec.height);
      for (const L of m.world.levels) for (const p of L.paths) expect(strokeRibbon(mask, spec, pathRibbon(p), 255, budget), name).toBe(true);
      expect((start - budget.left) / (spec.width * spec.height), name).toBeLessThan(2);
    }
  });

  it("Pelcs's export matches its Ground level by doors and lights, and not its roof", () => {
    const m = parseDungeondraftMap(read("fs_pelcs.dungeondraft_map"));
    const vtt = JSON.parse(read("fs_pelcs.dd2vtt")) as { resolution: object; portals: unknown; lights: unknown; line_of_sight: unknown };
    const ranked = matchDd2vttLevel(m, vtt);
    expect(ranked.map((r) => [r.level.label, r.score])).toEqual([["Ground", 1], ["Roof", 0]]);
    expect(alignDd2vtt(vtt.resolution, 1000, 1000, m)).not.toBeNull();
  });
});

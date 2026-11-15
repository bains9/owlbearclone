// A picture map's own data in the 3D view (room/view3dMapData.ts): a Dungeon export's trees,
// shrubs and rocks standing where the picture paints them, its rooms as buildings, and whether
// it's outdoors. On the Old Keep fixture (a real Dungeon export), through the same sidecar the
// seasons read.
import { describe, expect, it } from "vitest";
import { parseDungeonPayload } from "../src/client/dd/fromDungeon";
import { OR } from "../src/client/dd/roles";
import { NO_NAME, REACH_N, SIDECAR_UNITS, type ObjectTable } from "../src/client/dd/sidecar";
import { WORLD_SQUARE, floorCells, inside, mapLooksOutdoors, mapObjects, roleShape, toScene, toWorld, type MapPlacement } from "../src/client/room/view3dMapData";
import { objectMesh } from "../src/client/room/view3dObjects";
import { buildingsOf } from "../src/client/room/view3dRoofs";
import { pictureSidecar } from "./fixtures/fakeExport";

type Fs = { readFileSync(path: string | URL, encoding: "utf8"): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
const FIXTURE = JSON.parse(fs.readFileSync(new URL("./fixtures/dungeon-old-keep.dd2vtt", import.meta.url), "utf8")) as {
  dungeon: { objects: { asset: string; x: number; y: number }[]; floors: { shape: number[][][][] }[]; width: number; height: number };
};
const { map } = parseDungeonPayload(JSON.stringify(FIXTURE.dungeon));
const sidecar = pictureSidecar(map, map.world.levels[0].key);
/** The picture laid on a 128-pixel grid, the whole map. */
const PX = 128;
const place: MapPlacement = { rect: sidecar.meta.rect, width: ((sidecar.meta.rect[2] - sidecar.meta.rect[0]) / WORLD_SQUARE) * PX, height: ((sidecar.meta.rect[3] - sidecar.meta.rect[1]) / WORLD_SQUARE) * PX };

describe("a map's own trees and rocks", () => {
  const objects = mapObjects(sidecar.objects, sidecar.meta, place, PX);
  const kinds = (k: string) => objects.filter((o) => o.shape?.kind === k);

  it("stands up the Old Keep's trees, pines, bushes and rocks", () => {
    expect(kinds("tree")).toHaveLength(FIXTURE.dungeon.objects.filter((o) => o.asset === "b:tree").length);
    expect(kinds("pine")).toHaveLength(2);
    expect(kinds("bush")).toHaveLength(4);
    expect(kinds("rock").length).toBeGreaterThanOrEqual(1);
    expect(objects.every((o) => o.id === null && o.paint)).toBe(true);
  });

  it("stands up everything else placed in Dungeon in its own shape, as the Build tool's do, turned as placed", () => {
    const count = (asset: string) => FIXTURE.dungeon.objects.filter((o) => o.asset === asset).length;
    expect(kinds("column")).toHaveLength(count("b:pillar"));
    expect(kinds("statue")).toHaveLength(count("b:statue"));
    expect(kinds("well")).toHaveLength(count("b:well"));
    expect(kinds("table").length).toBeGreaterThanOrEqual(count("b:table"));
    expect(kinds("barrel").length).toBeGreaterThanOrEqual(count("b:barrel"));
    // Chairs, crates, beds and chests are blocks.
    expect(kinds("box").length).toBeGreaterThanOrEqual(count("b:chair") + count("b:crate"));
    // Candles, torches, a rug, bones and a campfire have no shape: they stay painted.
    const flat = ["b:candles", "b:torch", "b:rug", "b:bones", "b:campfire"].reduce((n, a) => n + count(a), 0);
    expect(objects.length).toBeLessThanOrEqual(FIXTURE.dungeon.objects.length - flat);
    expect(objects.every((o) => Number.isFinite(o.deg))).toBe(true);
  });

  it("puts each tree where the map has it, in scene units", () => {
    for (const t of FIXTURE.dungeon.objects.filter((o) => o.asset === "b:tree")) {
      const near = kinds("tree").some((o) => Math.hypot(o.x - t.x * PX, o.y - t.y * PX) < PX);
      expect(near, `tree at ${t.x}, ${t.y}`).toBe(true);
    }
  });

  it("makes trees about as wide as the map draws them, in the scene's squares", () => {
    for (const t of kinds("tree")) {
      expect(t.size).toBeGreaterThan(1);
      expect(t.size).toBeLessThan(5);
    }
  });

  it("stands them up as shapes, coloured from the picture where they stand", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    for (let i = 0; i < 16; i++) rgba.set([30, 120, 40, 255], i * 4);
    const paint = { x0: 0, y0: 0, k: 4 / place.width, w: 4, h: 4, rgba };
    const m = objectMesh(kinds("tree").slice(0, 1), PX, null, false, paint);
    expect(m.position.length).toBeGreaterThan(0);
    // The crown takes the picture's green (the trunk keeps its bark).
    const greens = [];
    for (let i = 0; i < m.color.length; i += 3) if (m.color[i + 1] > m.color[i] * 2) greens.push(i);
    expect(greens.length).toBeGreaterThan(0);
  });
});

describe("a map's rooms", () => {
  const cells = floorCells(sidecar.bitmaps, sidecar.shapes);

  it("knows the squares the Old Keep's floors cover", () => {
    // The first floor runs from square (4, 4) to (16, 12).
    const keys = new Set(cells.map(([c, r]) => `${c},${r}`));
    expect(keys.has("4,4")).toBe(true);
    expect(keys.has("15,11")).toBe(true);
    expect(keys.has("10,8")).toBe(true);
    expect(keys.has("0,0")).toBe(false);
    expect(cells.length).toBeGreaterThanOrEqual(12 * 8);
  });

  it("makes buildings of them, as a built map's rooms are", () => {
    const houses = buildingsOf(cells);
    expect(houses.length).toBeGreaterThanOrEqual(1);
    expect(houses.reduce((n, h) => n + h.cells.length, 0)).toBe(cells.length);
  });

  it("calls the Old Keep outdoors (grass and trees): its buildings get roofs", () => {
    expect(mapLooksOutdoors(sidecar)).toBe(true);
  });

  it("calls a map with no trees and no grass indoors", () => {
    const none: Pick<ObjectTable, "n" | "role"> = { n: 0, role: new Uint8Array(0) };
    expect(mapLooksOutdoors({ objects: none, terrain: null })).toBe(false);
  });
});

describe("inside a floor's outline", () => {
  const u = SIDECAR_UNITS.coord;
  // A square ring with a square hole, as two rings.
  const ring = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1].map((v) => v * u);
  const pts = Int32Array.from([...ring(0, 0, 100, 100), ...ring(25, 25, 75, 75)]);

  it("leaves a hole out by even-odd", () => {
    const s = { pts, ringEnds: Uint32Array.of(4, 8), rule: 0 as const };
    expect(inside(s, 10 * u, 10 * u)).toBe(true);
    expect(inside(s, 50 * u, 50 * u)).toBe(false);
    expect(inside(s, 150 * u, 50 * u)).toBe(false);
  });

  it("fills where the rings wind round it, by non-zero", () => {
    const s = { pts, ringEnds: Uint32Array.of(4, 8), rule: 1 as const };
    // Both rings wind the same way: the middle is wound twice, still inside.
    expect(inside(s, 50 * u, 50 * u)).toBe(true);
  });
});

describe("the picture's place", () => {
  it("turns world points into scene points and back", () => {
    const p: MapPlacement = { rect: [512, 256, 512 + 10 * WORLD_SQUARE, 256 + 5 * WORLD_SQUARE], width: 1000, height: 500 };
    expect(toScene(p, 512, 256)).toEqual({ x: 0, y: 0 });
    expect(toScene(p, 512 + 5 * WORLD_SQUARE, 256)).toEqual({ x: 500, y: 0 });
    const back = toWorld(p, 250, 125);
    expect(back.x).toBeCloseTo(512 + 2.5 * WORLD_SQUARE);
    expect(back.y).toBeCloseTo(256 + 1.25 * WORLD_SQUARE);
  });

  it("gives each nature role its shape, and leaves grass, flowers and fire painted", () => {
    expect(roleShape(OR.DECIDUOUS, null)?.kind).toBe("tree");
    expect(roleShape(OR.EVERGREEN, "vegetation/trees/palm_01")?.kind).toBe("palm");
    expect(roleShape(OR.EVERGREEN, "dungeon/pine")?.kind).toBe("pine");
    expect(roleShape(OR.ROCK, null)?.kind).toBe("rock");
    for (const r of [OR.GRASS, OR.FLOWERS, OR.FIRE, OR.STRUCTURE, OR.LITTER]) expect(roleShape(r, null)).toBeNull();
  });

  it("leaves a pebble painted: too small to stand up", () => {
    const tiny: ObjectTable = {
      n: 1,
      role: Uint8Array.of(OR.ROCK),
      layer: Int16Array.of(200),
      x: Int32Array.of(100 * SIDECAR_UNITS.coord),
      y: Int32Array.of(100 * SIDECAR_UNITS.coord),
      rot: Uint8Array.of(0),
      flags: Uint8Array.of(0),
      name: Uint16Array.of(NO_NAME),
      reach: new Uint16Array(REACH_N).fill(10 * SIDECAR_UNITS.reach),
    };
    expect(mapObjects(tiny, { names: [] }, { rect: [0, 0, 2560, 2560], width: 1280, height: 1280 }, 128)).toEqual([]);
  });
});

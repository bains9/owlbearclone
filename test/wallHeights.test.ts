// Walls of any height from Dungeon (17 November 2026): Dungeon's walls can stand from 2 to 10 m.
// In the 3D view a wall stands at its height, a door and a window keep their size, and a
// building's roof starts on top of its walls; in Dungeon's builder's view (look3d/lookSource.ts)
// and in a scene, whose map data (sidecar WALH) carries them. Walls without say 3 m, as before.
import { describe, expect, it } from "vitest";
import { WALL_HEIGHT, WINDOW_SILL, WINDOW_TOP, piecesWithHeights, tallAt, wallMesh, wallPieces, type Walls3d } from "../src/client/room/view3dModel";
import { buildingsOf, eavesOf, roofMesh } from "../src/client/room/view3dRoofs";
import { lookBuildings, lookWalls } from "../src/client/look3d/lookSource";
import { mapTallWalls } from "../src/client/room/view3dMapData";
import { SECTION, SIDECAR_HEADER_BYTES, SidecarError, decodeSidecar, encodeSidecar, type SeasonSidecar } from "../src/client/dd/sidecar";
import { wallHeightLines } from "../src/client/dd/extract";
import { parseDungeonPayload } from "../src/client/dd/fromDungeon";
import { NO_NAME, REACH_N } from "../src/client/dd/sidecar";
import { crc32 } from "../src/client/crc32";

type Fs = { readFileSync(p: URL, e: string): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
const FIXTURE = fs.readFileSync(new URL("./fixtures/dungeon-old-keep.dd2vtt", import.meta.url), "utf8");
const export0 = JSON.parse(FIXTURE) as { dungeon: Record<string, any> };

const CELL = 64;
const top = (m: { position: Float32Array }) => {
  let hi = -Infinity;
  for (let i = 1; i < m.position.length; i += 3) hi = Math.max(hi, m.position[i]);
  return hi;
};
const bottom = (m: { position: Float32Array }) => {
  let lo = Infinity;
  for (let i = 1; i < m.position.length; i += 3) lo = Math.min(lo, m.position[i]);
  return lo;
};

describe("walls at their heights", () => {
  it("stand a built wall at its own height, and a door at a door's in any wall", () => {
    const w: Walls3d = { walls: [], built: [[0, 0, CELL, 0], [0, CELL, CELL, CELL]], builtH: [10 / 3, WALL_HEIGHT], doors: [{ line: [0, 2 * CELL, CELL, 2 * CELL], open: false }] };
    const pieces = wallPieces(w, CELL, null, true);
    const tall = pieces.filter((p) => p.y0 === 0);
    expect(tall.every((p) => p.h === 10 / 3)).toBe(true);
    // 3 m keeps no height of its own, and a door never has one.
    expect(pieces.filter((p) => p.y0 === CELL).every((p) => p.h === undefined)).toBe(true);
    expect(pieces.filter((p) => p.door).every((p) => p.h === undefined)).toBe(true);
    expect(top(wallMesh(tall, CELL))).toBeCloseTo(10 / 3);
    expect(top(wallMesh(pieces.filter((p) => p.door), CELL))).toBeCloseTo(0.7 * WALL_HEIGHT);
  });

  it("keep a window's sill and lintel where they always are, the wall above going up to its top", () => {
    const m = wallMesh([{ x0: 0, y0: 0, x1: CELL, y1: 0, door: false, light: 1, window: true, h: 4 }], CELL);
    const ys = new Set<number>();
    for (let i = 1; i < m.position.length; i += 3) ys.add(Math.round(m.position[i] * 1000) / 1000);
    expect([...ys].sort((a, b) => a - b)).toEqual([0, WINDOW_SILL * WALL_HEIGHT, WINDOW_TOP * WALL_HEIGHT, 4].map((v) => Math.round(v * 1000) / 1000));
  });

  it("stand a map's wall as tall as the tall wall it lies along", () => {
    const tall = [{ line: [0, 0, 4 * CELL, 0] as [number, number, number, number], h: 3 }];
    expect(tallAt(tall, 2 * CELL, 0.05 * CELL, CELL)).toBe(3);
    expect(tallAt(tall, 2 * CELL, 0.5 * CELL, CELL)).toBeUndefined();
    const pieces = wallPieces({ walls: [[0, 0, 4 * CELL, 0], [0, CELL, 4 * CELL, CELL]], built: [], doors: [], tall }, CELL, null, true);
    expect(pieces.filter((p) => p.y0 === 0).every((p) => p.h === 3)).toBe(true);
    expect(pieces.filter((p) => p.y0 === CELL).every((p) => p.h === undefined)).toBe(true);
  });
});

describe("roofs on top of the walls", () => {
  /** A 4 by 3 building at (0, 0), its outline as walls, all `h` squares tall but its north wall `north`. */
  const house = (h: number, north = h) => {
    const C = CELL;
    return [
      { line: [0, 0, 4 * C, 0], h: north },
      { line: [4 * C, 0, 4 * C, 3 * C], h },
      { line: [4 * C, 3 * C, 0, 3 * C], h },
      { line: [0, 3 * C, 0, 0], h },
    ];
  };
  const cells: [number, number][] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cells.push([c, r]);
  const b = buildingsOf(cells)[0];
  const at = (x: number) => x / CELL;

  it("start at the height most of a building's walls stand", () => {
    expect(eavesOf(b, house(10 / 3), at, at, CELL)).toBeCloseTo(10 / 3);
    // A raised north wall (a tower front) doesn't lift the roof off the rest.
    expect(eavesOf(b, house(WALL_HEIGHT, 4), at, at, CELL)).toBe(WALL_HEIGHT);
    // Walls of another building aren't this one's.
    expect(eavesOf(b, [{ line: [10 * CELL, 0, 12 * CELL, 0], h: 5 }], at, at, CELL)).toBe(WALL_HEIGHT);
  });

  it("are made from there up", () => {
    const rects = [{ x0: 0, y0: 0, x1: 4 * CELL, y1: 3 * CELL }];
    expect(bottom(roofMesh(rects, CELL, [0.5, 0.3, 0.2], 1))).toBeCloseTo(WALL_HEIGHT);
    expect(bottom(roofMesh(rects, CELL, [0.5, 0.3, 0.2], 1, 10 / 3))).toBeCloseTo(10 / 3);
  });

  it("in Dungeon's builder's view: each wall at the height Dungeon sends (metres), each roof on its walls", () => {
    const m = {
      walls: [[0, 0, 4, 0], [4, 0, 4, 3], [4, 3, 0, 3], [0, 3, 0, 0]],
      wallTexture: "wall-stone",
      wallHeights: [5, 5, 5, 5],
      rock: [],
      doors: [],
      roofed: cells,
    };
    expect(lookWalls(m).builtH).toEqual([10 / 3, 10 / 3, 10 / 3, 10 / 3]);
    expect(lookBuildings(m, true)[0].eaves).toBeCloseTo(10 / 3);
    // A Dungeon from before sends no heights: 3 m, as ever.
    const { wallHeights: _h, ...before } = m;
    expect(lookWalls(before).builtH).toBeUndefined();
    expect(lookBuildings(before, true)[0].eaves).toBeUndefined();
  });

  it("weigh a map's walls by the pieces along its tall walls", () => {
    const tall = [{ line: [0, 0, 4 * CELL, 0] as [number, number, number, number], h: 4 }];
    const pieces = piecesWithHeights([[0, 0, 4 * CELL, 0], [0, CELL, 4 * CELL, CELL]], tall, CELL);
    expect(pieces.filter((p) => p.h === 4)).toHaveLength(8);
    expect(pieces.filter((p) => p.h === WALL_HEIGHT)).toHaveLength(8);
  });
});

describe("heights in a scene's map data", () => {
  it("come in from a Dungeon map: one for each segment, or none when every wall is 3 m", () => {
    const p = structuredClone(export0.dungeon);
    const walls = p.shapes.walls as { points: number[]; closed: boolean; height?: number; heights?: number[] }[];
    walls[0].height = 5;
    const segs = walls[0].closed ? walls[0].points.length / 2 : walls[0].points.length / 2 - 1;
    const { map } = parseDungeonPayload(JSON.stringify(p));
    const got = map.world.levels[0].walls[0];
    expect(got.heights).toEqual(new Array(segs).fill(5));
    expect(map.world.levels[0].walls.slice(1).every((w) => w.heights === undefined)).toBe(true);
    // A payload from before has none.
    const plain = parseDungeonPayload(JSON.stringify(export0.dungeon)).map;
    expect(plain.world.levels[0].walls.every((w) => w.heights === undefined)).toBe(true);
  });

  it("are kept as lines of one height, other than 3 m, cut to the map", () => {
    const S = 256;
    const w = { points: Float64Array.from([0, 0, 4 * S, 0, 4 * S, 3 * S, 0, 3 * S]), loop: true, heights: [5, 5, 3, 4.5] };
    const lines = wallHeightLines(w, [-S, -S, 10 * S, 10 * S]);
    expect(lines.map((l) => l.cm)).toEqual([500, 450]);
    expect(Array.from(lines[0].pts)).toEqual([0, 0, 4 * S * 16, 0, 4 * S * 16, 3 * S * 16]);
    // Cut at the box's edge.
    const cut = wallHeightLines(w, [-S, -S, 2 * S, 10 * S]);
    expect(Array.from(cut[0].pts)).toEqual([0, 0, 2 * S * 16, 0]);
  });

  it("go through the sidecar and back, and a sidecar without them reads as before", () => {
    const base = (): SeasonSidecar => ({
      meta: { rect: [0, 0, 2560, 2560], squares: [10, 10], extractor: 2, snowShare: 0, packShare: 0, packItems: 0, dropped: 0, names: [] },
      terrain: null,
      bitmaps: [],
      shapes: [],
      objects: { n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0), flags: new Uint8Array(0), name: new Uint16Array(0).fill(NO_NAME), reach: new Uint16Array(0 * REACH_N) },
    });
    const s = { ...base(), wallHeights: [{ cm: 500, pts: Int32Array.from([0, 0, 4096, 0, 4096, 4096]) }] };
    const back = decodeSidecar(encodeSidecar(s));
    expect(back.wallHeights).toEqual(s.wallHeights);
    expect(decodeSidecar(encodeSidecar(base())).wallHeights).toBeUndefined();
    // Without heights the bytes are what they always were: no WALH section.
    expect(encodeSidecar(base())).toEqual(encodeSidecar({ ...base(), wallHeights: [] }));
    // In the scene: scene units, heights in squares.
    const place = { rect: [0, 0, 2560, 2560] as [number, number, number, number], width: 1000, height: 1000 };
    const tall = mapTallWalls(back.wallHeights!, place);
    expect(tall).toHaveLength(2);
    expect(tall[0].h).toBeCloseTo(10 / 3);
    expect(tall[0].line).toEqual([0, 0, 100, 0]);
  });

  it("are refused when a WALH section is malformed", () => {
    const s = { ...{ meta: { rect: [0, 0, 2560, 2560] as [number, number, number, number], squares: [10, 10] as [number, number], extractor: 2, snowShare: 0, packShare: 0, packItems: 0, dropped: 0, names: [] }, terrain: null, bitmaps: [], shapes: [], objects: { n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0), flags: new Uint8Array(0), name: new Uint16Array(0), reach: new Uint16Array(0) } }, wallHeights: [{ cm: 500, pts: Int32Array.from([0, 0, 16, 0]) }] };
    const b = encodeSidecar(s);
    // Find WALH's section and say it has a million lines.
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = SIDECAR_HEADER_BYTES;
    while (b[p] !== SECTION.WALH) p += 5 + dv.getUint32(p + 1, true);
    dv.setUint32(p + 5, 1_000_000, true);
    dv.setUint32(12, crc32(b.subarray(SIDECAR_HEADER_BYTES)), true);
    expect(() => decodeSidecar(b)).toThrow(SidecarError);
    expect(() => encodeSidecar({ ...s, wallHeights: [{ cm: 0, pts: Int32Array.from([0, 0, 16, 0]) }] })).toThrow(SidecarError);
  });
});

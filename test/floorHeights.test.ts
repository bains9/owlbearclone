// Raised floors from Dungeon (17 November 2026): floor standing above the ground in the 3D view,
// with what's on it (objects, figures, spells) standing on it, and walls and roofs still standing
// from the ground. In Dungeon's builder's view (look3d/lookSource.ts) and in a scene, whose map
// data (sidecar FLRS) carries them.
import { describe, expect, it } from "vitest";
import { floorAt, heightAt, onFloor, withRaised } from "../src/client/room/view3dGround";
import { lookRaised } from "../src/client/look3d/lookSource";
import { mapRaised } from "../src/client/room/view3dMapData";
import { NO_NAME, SECTION, SIDECAR_HEADER_BYTES, SidecarError, decodeSidecar, encodeSidecar, type SeasonSidecar } from "../src/client/dd/sidecar";
import { parseDungeonPayload } from "../src/client/dd/fromDungeon";
import { crc32 } from "../src/client/crc32";

type Fs = { readFileSync(p: URL, e: string): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
const FIXTURE = fs.readFileSync(new URL("./fixtures/dungeon-old-keep.dd2vtt", import.meta.url), "utf8");
const export0 = JSON.parse(FIXTURE) as { dungeon: Record<string, any> };

const CELL = 64;
const area = { x0: 0, y0: 0, x1: 10 * CELL, y1: 8 * CELL };
/** A dais (0..10 by 0..2 squares) 0.4 squares up, with a hole (a pit, 4..6 by 0.5..1.5) left on the ground. */
const dais = [{ rings: [[0, 0, 10 * CELL, 0, 10 * CELL, 2 * CELL, 0, 2 * CELL], [4 * CELL, 0.5 * CELL, 6 * CELL, 0.5 * CELL, 6 * CELL, 1.5 * CELL, 4 * CELL, 1.5 * CELL]], h: 0.4 }];

describe("raised floors in the 3D view", () => {
  it("stand the floor up where they are, holes and the rest on the ground", () => {
    const g = withRaised(null, dais, area, CELL)!;
    expect(floorAt(g, 1 * CELL, 1 * CELL)).toBeCloseTo(0.4);
    expect(floorAt(g, 5 * CELL, 1 * CELL)).toBe(0);
    expect(floorAt(g, 5 * CELL, 5 * CELL)).toBe(0);
    // Walls and roofs go by the ground alone: a raised floor doesn't lift them.
    expect(heightAt(g, 1 * CELL, 1 * CELL)).toBe(0);
  });

  it("lift what stands on them, and nothing when there are none", () => {
    const g = withRaised(null, dais, area, CELL);
    const pos = Float32Array.from([1, 0.5, 1, 1, 0.5, 5]);
    onFloor(pos, g, CELL);
    expect(pos[1]).toBeCloseTo(0.9);
    expect(pos[4]).toBeCloseTo(0.5);
    expect(withRaised(null, [], area, CELL)).toBeNull();
  });

  it("come from Dungeon's builder in its units (cells, metres) as the page's (scene units, squares)", () => {
    const r = lookRaised({ raised: [{ rings: [[0, 0, 2, 0, 2, 1]], m: 0.6 }] }, CELL);
    expect(r[0].rings[0]).toEqual([0, 0, 2 * CELL, 0, 2 * CELL, CELL]);
    expect(r[0].h).toBeCloseTo(0.4);
    expect(lookRaised({})).toEqual([]);
  });
});

describe("raised floors in a scene's map data", () => {
  const base = (): SeasonSidecar => ({
    meta: { rect: [0, 0, 2560, 2560], squares: [10, 10], extractor: 2, snowShare: 0, packShare: 0, packItems: 0, dropped: 0, names: [] },
    terrain: null,
    bitmaps: [],
    shapes: [],
    objects: { n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0), flags: new Uint8Array(0), name: new Uint16Array(0).fill(NO_NAME), reach: new Uint16Array(0) },
  });

  it("come in from a Dungeon map, in world units and metres", () => {
    const p = structuredClone(export0.dungeon);
    p.shapes.raised = [{ rings: [[1, 1, 3, 1, 3, 2, 1, 2]], m: 0.6 }, { rings: [[0, 0, 1, 0]], m: 0.6 }, { rings: [[0, 0, 1, 0, 1, 1]], m: -1 }];
    const L = parseDungeonPayload(JSON.stringify(p)).map.world.levels[0];
    expect(L.raised).toHaveLength(1);
    expect(L.raised![0].m).toBe(0.6);
    expect(Array.from(L.raised![0].rings[0])).toEqual([256, 256, 768, 256, 768, 512, 256, 512]);
    expect(parseDungeonPayload(JSON.stringify(export0.dungeon)).map.world.levels[0].raised).toBeUndefined();
  });

  it("go through the sidecar and back, and a sidecar without them is as it was", () => {
    const s = { ...base(), raised: [{ cm: 60, rings: [Int32Array.from([0, 0, 4096, 0, 4096, 4096, 0, 4096]), Int32Array.from([16, 16, 32, 16, 32, 32])] }] };
    expect(decodeSidecar(encodeSidecar(s)).raised).toEqual(s.raised);
    expect(decodeSidecar(encodeSidecar(base())).raised).toBeUndefined();
    expect(encodeSidecar(base())).toEqual(encodeSidecar({ ...base(), raised: [] }));
    // In the scene: scene units, heights in squares.
    const place = { rect: [0, 0, 2560, 2560] as [number, number, number, number], width: 1000, height: 1000 };
    const r = mapRaised(s.raised, place);
    expect(r[0].rings[0].slice(0, 4)).toEqual([0, 0, 100, 0]);
    expect(r[0].h).toBeCloseTo(0.4);
  });

  it("are refused when the FLRS section is malformed", () => {
    expect(() => encodeSidecar({ ...base(), raised: [{ cm: 0, rings: [Int32Array.from([0, 0, 16, 0, 16, 16])] }] })).toThrow(SidecarError);
    expect(() => encodeSidecar({ ...base(), raised: [{ cm: 60, rings: [Int32Array.from([0, 0, 16, 0])] }] })).toThrow(SidecarError);
    const b = encodeSidecar({ ...base(), raised: [{ cm: 60, rings: [Int32Array.from([0, 0, 16, 0, 16, 16])] }] });
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = SIDECAR_HEADER_BYTES;
    while (b[p] !== SECTION.FLRS) p += 5 + dv.getUint32(p + 1, true);
    dv.setUint32(p + 5, 1_000_000, true);
    dv.setUint32(12, crc32(b.subarray(SIDECAR_HEADER_BYTES)), true);
    expect(() => decodeSidecar(b)).toThrow(SidecarError);
  });
});

import { describe, expect, it } from "vitest";
import { applyOps } from "../src/shared/ops";
import type { ItemMap } from "../src/shared/ops";
import { sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import { GRID_STAMPS_PER_CHUNK, MAX_STAMPS_PER_CHUNK, STAMP_POS_STEP, cleanStamps, makeStamp, snapPos, stampsOnGrid, terrainId } from "../src/shared/terrain";
import type { Stamp, StampId } from "../src/shared/terrain";
import type { TerrainItem } from "../src/shared/types";
import { BuildEdit, BuildModel, SHELTERED, buildUndo, computeExposure, indexTerrain, refOf } from "../src/client/room/build";
import { blockOf, clampShift, groupFits, onGrid, placeGroupAt, placedOf, rescaleAnchor, shiftGroup, turnGroup } from "../src/client/room/stampGeom";
import type { Placed } from "../src/client/room/stampGeom";

// Objects off the grid (Snap to squares unticked in the Build tool): anywhere, to a sixteenth
// of a square, up to 256 in a chunk.

const SCENE = "Scene1234567";
const P = (col: number, row: number, deg = 0, size = 1, id: StampId = "chair"): Placed => ({ id, col, row, deg, size });
/** A scene 20 squares wide and 10 high. */
const scene = { c0: 0, r0: 0, c1: 19, r1: 9 };
const huge = { c0: -1000, r0: -1000, c1: 1000, r1: 1000 };
const sixteenths = (n: number) => Number.isInteger(n / STAMP_POS_STEP);

function chunk(cx: number, cy: number, stamps: Stamp[] = [], cells = ".".repeat(256)): TerrainItem {
  return { id: terrainId(SCENE, cx, cy), sceneId: SCENE, kind: "terrain", z: 0, owner: "@gm", cx, cy, cells, edges: ".".repeat(512), stamps };
}
const toMap = (items: TerrainItem[]): ItemMap => Object.fromEntries(items.map((i) => [i.id, i]));
const stampsIn = (items: ItemMap, cx = 0, cy = 0) => (items[terrainId(SCENE, cx, cy)] as TerrainItem | undefined)?.stamps ?? [];
function model(items: ItemMap): BuildModel {
  const m = new BuildModel();
  m.index = indexTerrain(Object.values(items) as TerrainItem[]);
  return m;
}

describe("objects off the grid, as stored", () => {
  it("are written to a sixteenth of a square, with no -0", () => {
    expect(snapPos(1.03)).toBe(1);
    expect(snapPos(1.04)).toBe(1.0625);
    expect(Object.is(snapPos(-0.01), 0)).toBe(true);
    expect(makeStamp("chair", 2.5, 3.03, 0, 1)).toEqual(["chair", 2.5, 3, 0, 1]);
    expect(makeStamp("table", 0.3, 15.9, 100, 1.5)).toEqual(["table", 0.3125, 15.875, 1, 1.5, 10]);
  });

  it("are kept by the server to a sixteenth of a square within the chunk, and nothing finer", () => {
    const t = sanitizeItem(chunk(0, 0), "@gm")!;
    const free: Stamp[] = [["chair", 2.5, 15.9375, 0, 1], ["table", 0.0625, 0, 1, 1.5, 15]];
    expect(cleanStamps(free)).toEqual(free);
    expect(sanitizeSet(t, { stamps: free })).toEqual({ stamps: free });
    for (const bad of [1.03, 16, -0.0625, 0.1, NaN]) {
      expect(cleanStamps([["chair", bad, 0, 0, 1]]), String(bad)).toBeUndefined();
      expect(cleanStamps([["chair", 0, bad, 0, 1]]), String(bad)).toBeUndefined();
    }
  });

  it("go up to 256 in a chunk", () => {
    const many = (n: number): Stamp[] => Array.from({ length: n }, (_, i) => ["rock", i % 16, Math.floor(i / 16) % 16, 0, 0.5]);
    expect(MAX_STAMPS_PER_CHUNK).toBe(256);
    expect(cleanStamps(many(256))).toHaveLength(256);
    expect(cleanStamps(many(257))).toBeUndefined();
    // And the Build tool fills one that far (see "a chunk holds at most" in build.test.ts).
  });

  it("need new code (protocol 6) when any is off the grid, or there are more than 64", () => {
    const grid = (n: number): Stamp[] => Array.from({ length: n }, (_, i) => ["rock", i % 16, Math.floor(i / 16), 0, 1]);
    expect(GRID_STAMPS_PER_CHUNK).toBe(64);
    expect(stampsOnGrid([])).toBe(true);
    expect(stampsOnGrid(grid(64))).toBe(true);
    expect(stampsOnGrid(grid(65))).toBe(false);
    expect(stampsOnGrid([["chair", 2, 3, 0, 1], ["chair", 2, 3.5, 0, 1]])).toBe(false);
    expect(stampsOnGrid([["chair", 2.25, 3, 0, 1]])).toBe(false);
  });
});

describe("where an object off the grid stands", () => {
  it("stands on every square its block overlaps", () => {
    expect(blockOf(P(2.5, 3.25))).toEqual({ c0: 2, r0: 3, c1: 3, r1: 4 });
    expect(blockOf(P(2, 3))).toEqual({ c0: 2, r0: 3, c1: 2, r1: 3 });
    expect(blockOf(P(-0.5, 0, 0, 2))).toEqual({ c0: -1, r0: 0, c1: 1, r1: 1 });
    expect(onGrid(P(2, 3))).toBe(true);
    expect(onGrid(P(2, 3.5))).toBe(false);
  });

  it("is sized about its middle exactly", () => {
    // Middle at 2.75 before (2.25 + a half) and after (1.75 + 1).
    expect(rescaleAnchor(2.25, 1, 2)).toBe(1.75);
    expect(rescaleAnchor(1.75, 2, 1)).toBe(2.25);
    // On the grid it stays on the grid, as before.
    expect(rescaleAnchor(3, 1, 2)).toBe(2);
  });

  it("is kept on the scene by its edges, not by whole squares", () => {
    expect(clampShift([P(18.5, 0)], 1, 0, scene)).toEqual({ dCol: 0.5, dRow: 0 });
    expect(clampShift([P(0.25, 8.75)], -1, 1, scene)).toEqual({ dCol: -0.25, dRow: 0.25 });
    expect(shiftGroup([P(18.5, 0)], 0.25, 0, scene)).toEqual([P(18.75, 0)]);
    expect(groupFits([P(19, 9)], scene)).toBe(true);
    expect(groupFits([P(19.0625, 9)], scene)).toBe(false);
  });
});

describe("placing and turning off the grid", () => {
  it("centres a group on a point, to a sixteenth of a square", () => {
    const pair = [P(0, 0), P(1, 0)];
    expect(placeGroupAt(pair, 5.3, 4.7, scene, true)).toEqual([P(4.3125, 4.1875), P(5.3125, 4.1875)]);
    // Off the grid already: they keep their places from each other.
    expect(placeGroupAt([P(0, 0), P(0.25, 0.5)], 10, 5, scene, true)).toEqual([P(9.375, 4.25), P(9.625, 4.75)]);
    // Kept on the scene, or not placed if it's bigger.
    expect(placeGroupAt(pair, 0.2, 0.2, scene, true)).toEqual([P(0, 0), P(1, 0)]);
    expect(placeGroupAt([P(0, 0), P(25, 0)], 5, 5, scene, true)).toBeNull();
    // Snapped, as before: centred on the cell.
    expect(placeGroupAt(pair, 5, 4, scene)).toEqual([P(4, 4), P(5, 4)]);
  });

  it("turns one object where it stands, and a group exactly about its middle", () => {
    expect(turnGroup([P(2.5, 3.25)], 90, scene, true)).toEqual([P(2.5, 3.25, 90)]);
    const pair = [P(0, 0), P(1, 0)];
    expect(turnGroup(pair, 90, huge, true)).toEqual([P(0.5, -0.5, 90), P(0.5, 0.5, 90)]);
    expect(turnGroup(pair, 180, huge, true)).toEqual([P(1, 0, 180), P(0, 0, 180)]);
    expect(turnGroup(pair, 0, huge, true)).toEqual(pair);
    for (let deg = 0; deg < 360; deg += 5) {
      for (const q of turnGroup([P(3, 3), P(4.25, 3.5, 0, 1.5), P(3, 5.0625)], deg, scene, true)) {
        expect(sixteenths(q.col) && sixteenths(q.row), `${deg}`).toBe(true);
        expect(groupFits([q], scene)).toBe(true);
      }
    }
  });
});

describe("building with objects off the grid", () => {
  it("puts them closer together than squares allow: four the same a quarter square apart", () => {
    const e = new BuildEdit({}, SCENE);
    const r = e.addGroup([P(2, 2), P(2.25, 2), P(2.5, 2), P(2.75, 2)]);
    expect(r.ok).toBe(true);
    const after = applyOps({}, e.ops());
    expect(stampsIn(after)).toEqual([["chair", 2, 2, 0, 1], ["chair", 2.25, 2, 0, 1], ["chair", 2.5, 2, 0, 1], ["chair", 2.75, 2, 0, 1]]);
    // Exactly on top of the same one is still refused.
    expect(new BuildEdit(after, SCENE).addPlaced(P(2.25, 2))).toEqual({ ok: false, reason: "same" });
  });

  it("finds, erases and removes one by any square it overlaps", () => {
    const items = toMap([chunk(0, 0, [["table", 2.5, 2.5, 0, 1]])]);
    const m = model(items);
    for (const [c, r] of [[2, 2], [3, 2], [2, 3], [3, 3]]) expect(m.stampAt(c, r)?.stamp[0], `${c},${r}`).toBe("table");
    expect(m.stampAt(4, 3)).toBeNull();
    expect(m.stampAt(1, 2)).toBeNull();
    const e = new BuildEdit(items, SCENE);
    e.erase(3, 3);
    expect(applyOps(items, e.ops())[terrainId(SCENE, 0, 0)]).toBeUndefined();
    const e2 = new BuildEdit(items, SCENE);
    expect(e2.removeStampAt(3, 2)).toBe(true);
  });

  it("finds one reaching into the next chunk from the one before", () => {
    // A 3-square block from 13.5 reaches 16.5: square 16 is in the next chunk.
    const m = model(toMap([chunk(0, 0, [["bed", 13.5, 0, 0, 3]])]));
    expect(m.stampAt(16, 1)?.stamp[0]).toBe("bed");
    expect(m.stampAt(17, 1)).toBeNull();
  });

  it("moves one across a chunk border, to a quarter square, as one step that undoes", () => {
    const items = toMap([chunk(0, 0, [["chair", 15.5, 0, 0, 1]])]);
    const big = { c0: 0, r0: 0, c1: 63, r1: 63 };
    const from = model(items).stampAt(15, 0)!;
    const e = new BuildEdit(items, SCENE);
    expect(e.place([refOf(from)], shiftGroup([placedOf(from.cx, from.cy, from.stamp)], 0.75, 0, big)).ok).toBe(true);
    const ops = e.ops();
    const after = applyOps(items, ops);
    expect(stampsIn(after, 0, 0)).toEqual([]);
    expect(stampsIn(after, 1, 0)).toEqual([["chair", 0.25, 0, 0, 1]]);
    const undo = buildUndo(items, SCENE, ops, e.pairs());
    expect(stampsIn(applyOps(after, undo.undo(after)))).toEqual([["chair", 15.5, 0, 0, 1]]);
  });

  it("a plant off the grid makes every square it stands on outdoors", () => {
    const cells = "DDD" + ".".repeat(253);
    const e = computeExposure(model(toMap([chunk(0, 0, [["tree", 0.5, 0, 0, 1]], cells)])));
    expect([0, 1, 2].map((c) => e.dist(c, 0))).toEqual([0, 0, 1]);
    const onGridTree = computeExposure(model(toMap([chunk(0, 0, [["tree", 0, 0, 0, 1]], cells)])));
    expect([0, 1, 2].map((c) => onGridTree.dist(c, 0))).toEqual([0, 1, 2]);
    expect(e.dist(0, 1)).toBe(SHELTERED);
  });
});

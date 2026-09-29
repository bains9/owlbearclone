import { describe, expect, it } from "vitest";
import { applyOps, inverseOps } from "../src/shared/ops";
import type { ItemMap } from "../src/shared/ops";
import { canCreate, canDelete, canPatch, visibleToPlayer } from "../src/shared/permissions";
import { DEFAULT_SETTINGS, sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import { chunkOf, cleanStamps, inChunk, looksLikeTerrainId, makeStamp, sceneCells, snapDeg, snapSize, stampBlock, stampDeg, terrainId } from "../src/shared/terrain";
import type { Stamp } from "../src/shared/terrain";
import type { TerrainItem } from "../src/shared/types";
import {
  BuildEdit,
  BuildModel,
  BuildRenderer,
  buildUndo,
  cellKey,
  composeBuildUndo,
  cycleDoor,
  edgeKey,
  setPortal,
  floorChar,
  indexTerrain,
  opsBetween,
  refOf,
  setWall,
  wallsFor,
} from "../src/client/room/build";
import type { StampRef } from "../src/client/room/build";
import { placedOf, shiftGroup, sizeGroup, stampFor, turnGroup } from "../src/client/room/stampGeom";

const SCENE = "Scene1234567";
const noCells = ".".repeat(256);
const noEdges = ".".repeat(512);
const gm = { userId: "@gm", role: "gm" as const };
const player = { userId: "alice", role: "player" as const };

function chunk(cx: number, cy: number, extra: Partial<TerrainItem> = {}): TerrainItem {
  return {
    id: terrainId(SCENE, cx, cy),
    sceneId: SCENE,
    kind: "terrain",
    z: 0,
    owner: "@gm",
    cx,
    cy,
    cells: noCells,
    edges: noEdges,
    stamps: [],
    ...extra,
  };
}

function cellsWith(cells: [number, number, string][]): string {
  const a = [...noCells];
  for (const [col, row, ch] of cells) a[inChunk(row) * 16 + inChunk(col)] = ch;
  return a.join("");
}

function toMap(items: TerrainItem[]): ItemMap {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

/** The objects of the chunk at (cx, cy). */
const stampsIn = (items: ItemMap, cx = 0, cy = 0) => (items[terrainId(SCENE, cx, cy)] as TerrainItem | undefined)?.stamps ?? [];
/** Refs to the objects at these indexes of the chunk at (cx, cy). */
const refsTo = (items: ItemMap, cx: number, cy: number, ...is: number[]): StampRef[] =>
  is.map((i) => refOf({ cx, cy, i, stamp: stampsIn(items, cx, cy)[i] }));
/** An edit made to items: what the edit call returned, its ops, what it leaves, and its undo. */
function edit<T>(items: ItemMap, change: (e: BuildEdit) => T) {
  const e = new BuildEdit(items, SCENE);
  const result = change(e);
  const ops = e.ops();
  return { result, ops, after: applyOps(items, ops), undo: buildUndo(items, SCENE, ops, e.pairs()) };
}
const refsOf = (r: unknown) => (r as { refs: StampRef[] }).refs;

describe("terrain ids and chunk maths", () => {
  it("derives one id per scene and place, negative places included", () => {
    expect(terrainId(SCENE, 3, -1)).toBe(`t3_m1_${SCENE}`);
    expect(looksLikeTerrainId(terrainId(SCENE, -12, 40))).toBe(true);
    expect(looksLikeTerrainId("AbCdEfGhIjKl")).toBe(false);
  });

  it("finds chunks and positions for negative cells", () => {
    expect([chunkOf(-1), inChunk(-1)]).toEqual([-1, 15]);
    expect([chunkOf(-16), inChunk(-16)]).toEqual([-1, 0]);
    expect([chunkOf(-17), inChunk(-17)]).toEqual([-2, 15]);
    expect([chunkOf(15), inChunk(15)]).toEqual([0, 15]);
    expect([chunkOf(16), inChunk(16)]).toEqual([1, 0]);
  });

  it("covers the cells a scene overlaps, with an offset grid", () => {
    expect(sceneCells(700, 350, { size: 70, offsetX: 0, offsetY: 0 } as never)).toEqual({ c0: 0, r0: 0, c1: 9, r1: 4 });
    expect(sceneCells(700, 350, { size: 70, offsetX: 20, offsetY: -10 } as never)).toEqual({ c0: -1, r0: 0, c1: 9, r1: 5 });
  });
});

describe("terrain validation", () => {
  it("accepts a chunk, owned by the GM whoever claims it", () => {
    const t = sanitizeItem({ ...chunk(0, 0, { cells: cellsWith([[0, 0, "s"]]) }), owner: "alice", z: 5 }, "alice");
    expect(t).toMatchObject({ kind: "terrain", owner: "@gm", z: 0, cx: 0, cy: 0 });
  });

  it("refuses a chunk under any id but its own", () => {
    expect(sanitizeItem({ ...chunk(0, 0), id: terrainId(SCENE, 1, 0) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), id: "AbCdEfGhIjKl" }, "@gm")).toBeNull();
  });

  it("refuses bad cells, edges, objects and places", () => {
    expect(sanitizeItem({ ...chunk(0, 0), cells: "x" + noCells.slice(1) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), cells: noCells.slice(1) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), edges: "q" + noEdges.slice(1) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), stamps: [["throne", 0, 0, 0, 1]] }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), stamps: [["table", 16, 0, 0, 1]] }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), stamps: [["table", 0, 0, 4, 1]] }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), stamps: [["table", 0, 0, 0, 4]] }, "@gm")).toBeNull();
    const many: Stamp[] = Array.from({ length: 65 }, () => ["rock", 0, 0, 0, 1]);
    expect(sanitizeItem({ ...chunk(0, 0), stamps: many }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(1001, 0), id: terrainId(SCENE, 1001, 0) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), cx: 0.5 }, "@gm")).toBeNull();
  });

  it("never lets a secret door into a chunk players see", () => {
    expect(sanitizeItem({ ...chunk(0, 0), edges: "s" + noEdges.slice(1) }, "@gm")).toBeNull();
    const t = sanitizeItem(chunk(0, 0), "@gm")!;
    expect(sanitizeSet(t, { edges: "s" + noEdges.slice(1) })).toBeNull();
    expect(sanitizeSet(t, { edges: "d" + noEdges.slice(1) })).toEqual({ edges: "d" + noEdges.slice(1) });
  });

  it("keeps hidden chunks to secret doors only, under ids that can't be a chunk's", () => {
    const marker = { ...chunk(0, 0), id: "AbCdEfGhIjKl", hidden: true, edges: "s" + noEdges.slice(1) };
    const ok = sanitizeItem(marker, "@gm")!;
    expect(ok).toMatchObject({ hidden: true });
    expect(sanitizeItem({ ...marker, id: terrainId(SCENE, 0, 0) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...marker, id: terrainId(SCENE, 5, 5) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...marker, edges: "w" + noEdges.slice(1) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...marker, cells: "s" + noCells.slice(1) }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...marker, stamps: [["rock", 0, 0, 0, 1]] }, "@gm")).toBeNull();
    expect(sanitizeSet(ok, { edges: "w" + noEdges.slice(1) })).toBeNull();
    expect(sanitizeSet(ok, { cells: "s" + noCells.slice(1) })).toBeNull();
    // Whether it's hidden, and where it is, never change.
    expect(sanitizeSet(ok, { hidden: false })).toBeNull();
    expect(sanitizeSet(ok, { cx: 1 } as never)).toBeNull();
  });

  it("patches only a chunk's contents", () => {
    const t = sanitizeItem(chunk(0, 0), "@gm")!;
    expect(sanitizeSet(t, { cells: cellsWith([[1, 1, "w"]]) })).toBeTruthy();
    expect(sanitizeSet(t, { stamps: [["tree", 3, 3, 1, 2]] })).toEqual({ stamps: [["tree", 3, 3, 1, 2]] });
    expect(sanitizeSet(t, { points: [0, 0, 1, 1] })).toBeNull();
    expect(sanitizeSet(t, { x: 5 })).toBeNull();
  });

  it("keeps objects as they were always written, and ones turned finer or sized in quarters with all they say", () => {
    const t = sanitizeItem(chunk(0, 0), "@gm")!;
    const legacy: Stamp[] = [["tree", 3, 3, 1, 2], ["chair", 0, 15, 3, 1], ["bed", 15, 0, 0, 3]];
    expect(sanitizeSet(t, { stamps: legacy })).toEqual({ stamps: legacy });
    expect(cleanStamps(legacy)!.map((s) => s.length)).toEqual([5, 5, 5]);
    const turned: Stamp[] = [["table", 2, 0, 1, 1.5, 15], ["rock", 0, 0, 0, 0.5], ["well", 9, 9, 3, 2.75, 85]];
    expect(sanitizeSet(t, { stamps: turned })).toEqual({ stamps: turned });
    expect(sanitizeItem({ ...chunk(0, 0), stamps: turned }, "@gm")).toMatchObject({ stamps: turned });
  });

  it("refuses objects written any other way, rather than putting them right", () => {
    const t = sanitizeItem(chunk(0, 0), "@gm")!;
    const bad: unknown[][] = [
      // Fine degrees of 0, a whole quarter turn, not a multiple of 5, below 0, or missing.
      ["table", 2, 0, 1, 1.5, 0],
      ["table", 2, 0, 1, 1.5, 90],
      ["table", 2, 0, 1, 1.5, 7],
      ["table", 2, 0, 1, 1.5, -5],
      ["table", 2, 0, 1, 1.5, null],
      ["table", 2, 0, 1, 1.5, "15"],
      // Sizes that aren't quarter squares from half a square to 3.
      ["table", 2, 0, 1, 0.25],
      ["table", 2, 0, 1, 3.25],
      ["table", 2, 0, 1, 1.1],
      ["table", 2, 0, 1, "1"],
      ["table", 2, 0, 1, Infinity],
      // Too short, too long, too many quarter turns.
      ["table", 2, 0, 1],
      ["table", 2, 0, 1, 1, 15, 0],
      ["table", 2, 0, 4, 1],
    ];
    for (const s of bad) {
      expect(sanitizeSet(t, { stamps: [s] as never }), JSON.stringify(s)).toBeNull();
      expect(cleanStamps([["rock", 0, 0, 0, 1], s]), JSON.stringify(s)).toBeUndefined();
    }
  });
});

describe("terrain permissions", () => {
  const t = chunk(0, 0);
  const marker = { ...chunk(0, 0), id: "AbCdEfGhIjKl", hidden: true };
  it("only the GM builds", () => {
    expect(canCreate(t, player, DEFAULT_SETTINGS)).toBe(false);
    expect(canPatch(t, { cells: noCells }, player, DEFAULT_SETTINGS)).toBe(false);
    expect(canDelete(t, player)).toBe(false);
    expect(canCreate(t, gm, DEFAULT_SETTINGS)).toBe(true);
  });
  it("players see the build on the live scene, never the secret doors", () => {
    expect(visibleToPlayer(t, SCENE)).toBe(true);
    expect(visibleToPlayer(t, "Other1234567")).toBe(false);
    expect(visibleToPlayer(marker, SCENE)).toBe(false);
  });
});

describe("walls", () => {
  const model = (cells: [number, number, string][], edges: Partial<Record<number, string>> = {}) => {
    const e = [...noEdges];
    for (const [i, ch] of Object.entries(edges)) e[Number(i)] = ch!;
    const m = new BuildModel();
    m.index = indexTerrain([chunk(0, 0, { cells: cellsWith(cells), edges: e.join("") })]);
    return m;
  };
  const WALL = 1;
  const NONE = 0;
  const DOOR = 2;

  it("walls stone, wood and dirt where they meet empty space, and nowhere else", () => {
    const m = model([
      [1, 1, "s"],
      [2, 1, "s"],
    ]);
    expect(m.state(1, 1, "t")).toBe(WALL);
    expect(m.state(1, 1, "l")).toBe(WALL);
    expect(m.state(2, 1, "l")).toBe(NONE); // between two floor cells
    expect(m.state(3, 1, "l")).toBe(WALL); // the right side, stored on the empty cell there
    expect(m.state(1, 2, "t")).toBe(WALL); // the bottom
  });

  it("walls a room against terrain too (terrain lies under buildings), but not against another room", () => {
    const m = model([
      [4, 4, "s"],
      [5, 4, "g"],
      [4, 5, "a"],
      [3, 4, "W"],
    ]);
    expect(m.state(5, 4, "l")).toBe(WALL); // stone meets grass
    expect(m.state(4, 5, "t")).toBe(WALL); // stone meets water
    expect(m.state(4, 4, "l")).toBe(NONE); // stone meets an unwalled wood patch: both room floors
    expect(m.state(6, 4, "l")).toBe(NONE); // grass meets empty space: terrain has no walls
  });

  it("leaves grass, water, lava and unwalled floor open", () => {
    for (const ch of ["g", "a", "l", "S", "W", "D"]) {
      const m = model([[4, 4, ch]]);
      expect(m.state(4, 4, "t")).toBe(NONE);
      expect(m.state(5, 4, "l")).toBe(NONE);
    }
  });

  it("an opening removes an automatic wall; explicit walls and doors go anywhere", () => {
    // Cell (1,1) is index 17: its top edge is 34, its left edge 35.
    const m = model([[1, 1, "s"]], { 34: "o", 35: "d", 0: "w" });
    expect(m.state(1, 1, "t")).toBe(NONE);
    expect(m.state(1, 1, "l")).toBe(DOOR);
    expect(m.state(0, 0, "t")).toBe(WALL);
  });

  it("walls a floor at a chunk's edge against the empty chunk next to it", () => {
    const m = model([[15, 15, "s"]]);
    expect(m.state(16, 15, "l")).toBe(WALL);
    expect(m.state(15, 16, "t")).toBe(WALL);
  });

  it("the draft shows over the stored build", () => {
    const m = model([[1, 1, "s"], [1, 2, "s"]]);
    m.draft = { cells: new Map([[cellKey(1, 2), "."], [cellKey(6, 6), "w"]]), walls: new Map([[edgeKey(8, 8, "l"), "add" as const]]) };
    expect(m.cell(1, 2)).toBe(".");
    expect(m.cell(6, 6)).toBe("w");
    expect(m.state(1, 2, "t")).toBe(WALL); // (1,1) now meets an erased cell
    expect(m.state(6, 6, "t")).toBe(WALL);
    expect(m.state(8, 8, "l")).toBe(WALL);
    m.draft = null;
    expect(m.cell(1, 2)).toBe("s");
    expect(m.state(1, 2, "t")).toBe(NONE);
  });

  it("erasing terrain beside a building leaves the building's door alone", () => {
    // Stone at (1,1), grass at (2,1), a door on the edge between them.
    const m = model(
      [
        [1, 1, "s"],
        [2, 1, "g"],
      ],
      { [(1 * 16 + 2) * 2 + 1]: "d" },
    );
    expect(m.state(2, 1, "l")).toBe(DOOR);
    m.draft = { cells: new Map([[cellKey(2, 1), "."]]), walls: new Map(), groundOnly: true };
    expect(m.state(2, 1, "l")).toBe(DOOR);
    // Erasing a room (not ground only) takes the doors round it.
    m.draft = { cells: new Map([[cellKey(1, 1), "."]]), walls: new Map() };
    expect(m.state(2, 1, "l")).toBe(NONE);
  });

  it("the draft hides secret doors that erasing or a wall would remove", () => {
    const m = model([
      [1, 1, "s"],
      [1, 2, "s"],
    ]);
    m.index.secrets.set(m.index.chunks.keys().next().value!, [
      { ...chunk(0, 0), id: "AbCdEfGhIjKl", hidden: true, edges: [...noEdges].map((c, i) => (i === (2 * 16 + 1) * 2 ? "s" : c)).join("") },
    ]);
    expect(m.secret(1, 2, "t")).toBe(true);
    m.draft = { cells: new Map([[cellKey(1, 2), "."]]), walls: new Map() };
    expect(m.secret(1, 2, "t")).toBe(false);
    m.draft = { cells: new Map(), walls: new Map([[edgeKey(1, 2, "t"), "add" as const]]) };
    expect(m.secret(1, 2, "t")).toBe(false);
  });
});

describe("build edits", () => {
  it("creates a chunk under its derived id, and deletes it when it's emptied", () => {
    const e = new BuildEdit({}, SCENE);
    e.setCell(-1, -1, "s");
    const ops = e.ops();
    expect(ops.upsert).toHaveLength(1);
    expect(ops.upsert![0]).toMatchObject({ id: `tm1_m1_${SCENE}`, cx: -1, cy: -1, owner: "@gm" });
    expect(sanitizeItem(ops.upsert![0], "@gm")).toBeTruthy();
    const items = applyOps({}, ops);
    const e2 = new BuildEdit(items, SCENE);
    e2.erase(-1, -1);
    expect(e2.ops()).toEqual({ delete: [`tm1_m1_${SCENE}`] });
  });

  it("patches only what changed", () => {
    const items = toMap([chunk(0, 0, { cells: cellsWith([[0, 0, "s"]]) })]);
    const e = new BuildEdit(items, SCENE);
    e.setCell(1, 0, "w");
    const ops = e.ops();
    expect(ops.patch).toEqual([{ id: terrainId(SCENE, 0, 0), set: { cells: cellsWith([[0, 0, "s"], [1, 0, "w"]]) } }]);
    // Undo puts back exactly the cells.
    const after = applyOps(items, ops);
    expect(applyOps(after, inverseOps(items, ops))).toEqual(items);
  });

  it("changing nothing sends nothing", () => {
    const items = toMap([chunk(0, 0, { cells: cellsWith([[0, 0, "s"]]) })]);
    const e = new BuildEdit(items, SCENE);
    e.setCell(0, 0, "s");
    e.setEdge(3, 3, "t", ".");
    expect(e.ops()).toEqual({});
  });

  it("erasing takes the walls, doors and objects with it, across chunks", () => {
    const items = toMap([
      // A 2x2 table with its corner in the first chunk, reaching into the next.
      chunk(0, 0, { cells: cellsWith([[15, 0, "s"]]), stamps: [["table", 15, 0, 0, 2]] }),
      chunk(1, 0, { cells: cellsWith([[16, 0, "s"]]) }),
    ]);
    const e = new BuildEdit(items, SCENE);
    setWall(e, 16, 0, "l", "add");
    e.erase(16, 0);
    const ops = e.ops();
    expect(ops.delete).toContain(terrainId(SCENE, 1, 0));
    expect(ops.patch?.find((p) => p.id === terrainId(SCENE, 0, 0))?.set.stamps).toEqual([]);
  });

  it("turns the object on top at a square where it is; removing takes the top one", () => {
    const items = toMap([chunk(0, 0, { stamps: [["chair", 2, 2, 3, 1], ["table", 2, 2, 0, 2]] })]);
    const m = new BuildModel();
    m.index = indexTerrain(Object.values(items) as TerrainItem[]);
    const top = m.stampAt(3, 3)!;
    const e = new BuildEdit(items, SCENE);
    expect(e.place([refOf(top)], [{ ...placedOf(top.cx, top.cy, top.stamp), deg: 90 }]).ok).toBe(true);
    expect(e.ops().patch![0].set.stamps).toEqual([["chair", 2, 2, 3, 1], ["table", 2, 2, 1, 2]]);
    const e2 = new BuildEdit(items, SCENE);
    expect(e2.removeStampAt(2, 2)).toBe(true);
    expect(e2.ops().patch![0].set.stamps).toEqual([["chair", 2, 2, 3, 1]]);
    expect(m.stampAt(9, 9)).toBeNull();
  });

  it("a chunk holds at most 64 objects", () => {
    const e = new BuildEdit({}, SCENE);
    for (let i = 0; i < 64; i++) expect(e.addStamp("rock", i % 16, Math.floor(i / 16), 0, 1)).toBe(true);
    expect(e.addStamp("rock", 5, 5, 0, 1)).toBe(false);
  });

  it("walls: added on an automatic wall it stays automatic; removed, it opens", () => {
    const items = toMap([chunk(0, 0, { cells: cellsWith([[1, 1, "s"]]) })]);
    const e = new BuildEdit(items, SCENE);
    setWall(e, 1, 1, "t", "add"); // already a wall: nothing to store
    setWall(e, 5, 5, "t", "add"); // open ground: an explicit wall
    setWall(e, 1, 1, "l", "remove"); // automatic: an opening
    const set = e.ops().patch![0].set;
    expect(set.edges![34]).toBe(".");
    expect(set.edges![(5 * 16 + 5) * 2]).toBe("w");
    expect(set.edges![35]).toBe("o");
  });

  it("doors cycle wall, door, secret door, wall; the secret lives in a hidden chunk", () => {
    let items = toMap([chunk(0, 0, { cells: cellsWith([[1, 1, "s"]]) })]);
    const step = () => {
      const e = new BuildEdit(items, SCENE);
      cycleDoor(e, 1, 1, "t");
      const ops = e.ops();
      items = applyOps(items, ops);
      return ops;
    };
    step();
    expect(items[terrainId(SCENE, 0, 0)]).toMatchObject({ edges: expect.stringMatching(/^.{34}d/) });
    const secret = step();
    const marker = secret.upsert?.find((i) => i.kind === "terrain" && i.hidden) as TerrainItem;
    expect(marker).toBeTruthy();
    expect(sanitizeItem(marker, "@gm")).toBeTruthy();
    expect(marker.edges[34]).toBe("s");
    // Players see the wall it's in (automatic here).
    expect((items[terrainId(SCENE, 0, 0)] as TerrainItem).edges[34]).toBe(".");
    const back = step();
    expect(back.delete).toEqual([marker.id]);
    expect(Object.values(items).some((i) => i.kind === "terrain" && i.hidden)).toBe(false);
  });

  it("merges hidden chunks made for one place at once", () => {
    const a = { ...chunk(0, 0), id: "AaaaaaaaaaaA", hidden: true, edges: "s" + noEdges.slice(1) };
    const b = { ...chunk(0, 0), id: "BbbbbbbbbbbB", hidden: true, edges: ".s" + noEdges.slice(2) };
    const items = toMap([chunk(0, 0, { edges: "ww" + noEdges.slice(2) }), a, b]);
    const e = new BuildEdit(items, SCENE);
    e.setSecret(2, 0, "t", true);
    const ops = e.ops();
    expect(ops.patch).toEqual([{ id: a.id, set: { edges: "ss..s" + noEdges.slice(5) } }]);
    expect(ops.delete).toEqual([b.id]);
  });
});

describe("door styles (the Portal tool)", () => {
  // A stone cell at (1,1): its top edge (index 34) has an automatic wall.
  const room = () => toMap([chunk(0, 0, { cells: cellsWith([[1, 1, "s"]]) })]);
  const apply = (items: ItemMap, style: Parameters<typeof setPortal>[4], col = 1, row = 1, side: "t" | "l" = "t") => {
    const e = new BuildEdit(items, SCENE);
    setPortal(e, col, row, side, style);
    return applyOps(items, e.ops());
  };
  const edge = (items: ItemMap, i = 34) => (items[terrainId(SCENE, 0, 0)] as TerrainItem).edges[i];
  const secretOn = (items: ItemMap) =>
    Object.values(items).some((t) => t.kind === "terrain" && t.hidden && t.edges[34] === "s");

  it("puts a door in a wall, and the same style again gives the wall back", () => {
    const door = apply(room(), "door");
    expect(edge(door)).toBe("d");
    expect(edge(apply(door, "door"))).toBe(".");
  });

  it("a secret door is a wall to players, and a marker for the GM", () => {
    const secret = apply(room(), "secret");
    expect(edge(secret)).toBe(".");
    expect(secretOn(secret)).toBe(true);
    const back = apply(secret, "secret");
    expect(secretOn(back)).toBe(false);
    // From a door straight to secret, and Alt (style "wall") back to a plain wall.
    const viaDoor = apply(apply(room(), "door"), "secret");
    expect(edge(viaDoor)).toBe(".");
    expect(secretOn(viaDoor)).toBe(true);
    const wall = apply(viaDoor, "wall");
    expect(secretOn(wall)).toBe(false);
    expect(edge(wall)).toBe(".");
  });

  it("taking a door away puts back what was there: the wall it was in, or nothing on a bare line", () => {
    expect(edge(apply(apply(room(), "open"), "open"))).toBe(".");
    expect(edge(apply(apply(room(), "open"), "wall"))).toBe(".");
    // A door on a bare grid line (over an uploaded map), taken away again: no wall is left.
    const bare = apply(room(), "door", 8, 8, "t");
    expect(edge(bare, (8 * 16 + 8) * 2)).toBe("d");
    expect(edge(apply(bare, "door", 8, 8, "t"), (8 * 16 + 8) * 2)).toBe(".");
    // Alt+click (style "wall") where there's no door: nothing changes.
    const e = new BuildEdit(room(), SCENE);
    setPortal(e, 9, 9, "l", "wall");
    expect(e.ops()).toEqual({});
  });

  it("a door, secret door or opening in a hand-drawn wall gives the wall back when taken away", () => {
    // A one-square wall drawn across open floor (a partition), then each style and back again.
    const drawn = () => {
      const e = new BuildEdit(room(), SCENE);
      setWall(e, 6, 6, "t", "add");
      return applyOps(room(), e.ops());
    };
    const i = (6 * 16 + 6) * 2;
    for (const style of ["door", "secret", "open"] as const) {
      const once = apply(drawn(), style, 6, 6, "t");
      expect(edge(apply(once, style, 6, 6, "t"), i)).toBe("w");
      expect(edge(apply(once, "wall", 6, 6, "t"), i)).toBe("w");
    }
    expect(edge(apply(drawn(), "door", 6, 6, "t"), i)).toBe("D");
    expect(edge(apply(drawn(), "open", 6, 6, "t"), i)).toBe("o");
  });

  it("taking one leaf of a double door off bare lines leaves no wall", () => {
    const both = apply(apply(room(), "door", 5, 9, "t"), "door", 6, 9, "t");
    const one = apply(both, "door", 6, 9, "t");
    expect(edge(one, (9 * 16 + 6) * 2)).toBe(".");
    expect(edge(one, (9 * 16 + 5) * 2)).toBe("d");
  });

  it("an opening is a gap in a wall, and does nothing where there's no wall", () => {
    expect(edge(apply(room(), "open"))).toBe("o");
    expect(edge(apply(apply(room(), "door"), "open"))).toBe("o");
    // Open ground: no wall to open, so no change at all.
    const e = new BuildEdit(room(), SCENE);
    setPortal(e, 8, 8, "t", "open");
    expect(e.ops()).toEqual({});
  });
});

describe("moving objects", () => {
  const moved = (items: ItemMap, i: number, col: number, row: number) => ({ ...placedOf(0, 0, stampsIn(items)[i]), col, row });

  it("moves an object across a chunk border, as one step that undoes", () => {
    const items = toMap([chunk(0, 0, { stamps: [["table", 14, 3, 1, 2]] })]);
    const t = edit(items, (e) => e.place(refsTo(items, 0, 0, 0), [moved(items, 0, 17, 3)]));
    expect(t.result.ok).toBe(true);
    expect(stampsIn(t.after)).toEqual([]);
    expect(stampsIn(t.after, 1, 0)).toEqual([["table", 1, 3, 1, 2]]);
    const back = applyOps(t.after, t.undo.undo(t.after));
    expect(stampsIn(back)).toEqual([["table", 14, 3, 1, 2]]);
    expect(back[terrainId(SCENE, 1, 0)]).toBeUndefined();
  });

  it("does nothing when dropped where it was, or where there's nothing to move", () => {
    const items = toMap([chunk(0, 0, { stamps: [["chair", 2, 2, 0, 1]] })]);
    const still = edit(items, (e) => e.place(refsTo(items, 0, 0, 0), [moved(items, 0, 2, 2)]));
    expect(still.result).toEqual({ ok: true, refs: refsTo(items, 0, 0, 0) });
    expect(still.ops).toEqual({});
    const m = new BuildModel();
    m.index = indexTerrain(Object.values(items) as TerrainItem[]);
    expect(m.stampAt(9, 9)).toBeNull();
  });

  it("moves only the object picked up: one that's no longer as it was is left out", () => {
    const items = toMap([chunk(0, 0, { stamps: [["table", 2, 2, 0, 2]] })]);
    // The chair that was picked up has gone (undone meanwhile): the table under it stays put.
    const chair = refOf({ cx: 0, cy: 0, i: 0, stamp: ["chair", 2, 2, 0, 1] });
    const e = new BuildEdit(items, SCENE);
    expect(e.place([chair], [{ id: "chair", col: 6, row: 6, deg: 0, size: 1 }])).toEqual({ ok: false, reason: "gone" });
    expect(e.ops()).toEqual({});
    expect(edit(items, (e) => e.place(refsTo(items, 0, 0, 0), [moved(items, 0, 6, 6)])).result.ok).toBe(true);
  });
});

describe("undo of build steps", () => {
  const painted = (items: ItemMap) =>
    Object.values(items)
      .filter((i): i is TerrainItem => i.kind === "terrain" && !i.hidden)
      .reduce((n, t) => n + t.cells.replace(/\./g, "").length, 0);
  // Two GM tabs share the room: a step made in one, then another's, then the first undone.
  const step = (items: ItemMap, change: (e: BuildEdit) => void) => {
    const e = new BuildEdit(items, SCENE);
    change(e);
    const ops = e.ops();
    return { ops, after: applyOps(items, ops), undo: buildUndo(items, SCENE, ops, e.pairs()) };
  };

  it("undoing a step never wipes what another tab built since in the same chunk", () => {
    const a = step({}, (e) => e.setCell(2, 2, "s")); // tab A creates the chunk
    const b = step(a.after, (e) => {
      for (let r = 4; r < 14; r++) for (let c = 4; c < 14; c++) e.setCell(c, r, "s"); // tab B's room
    });
    expect(painted(b.after)).toBe(101);
    const undone = applyOps(b.after, a.undo.undo(b.after));
    expect(painted(undone)).toBe(100);
    expect((undone[terrainId(SCENE, 0, 0)] as TerrainItem).cells[2 * 16 + 2]).toBe(".");
    // Tab B can still undo and redo its own room.
    const bUndone = applyOps(undone, b.undo.undo(undone));
    expect(painted(bUndone)).toBe(0);
    expect(bUndone[terrainId(SCENE, 0, 0)]).toBeUndefined();
    const bRedone = applyOps(bUndone, b.undo.redo(bUndone));
    expect(painted(bRedone)).toBe(100);
    // And A's redo brings back only its own cell.
    expect(painted(applyOps(bRedone, a.undo.redo(bRedone)))).toBe(101);
  });

  it("leaves alone a cell someone else has changed since", () => {
    const a = step({}, (e) => e.setCell(0, 0, "s"));
    const b = step(a.after, (e) => e.setCell(0, 0, "w"));
    const undone = applyOps(b.after, a.undo.undo(b.after));
    expect((undone[terrainId(SCENE, 0, 0)] as TerrainItem).cells[0]).toBe("w");
  });

  it("counts identical objects: undoing a second copy takes away one, and undo brings both back", () => {
    const one = applyOps({}, (() => {
      const e = new BuildEdit({}, SCENE);
      e.addStamp("table", 13, 5, 0, 1);
      return e.ops();
    })());
    const two = step(one, (e) => e.addStamp("table", 13, 5, 0, 1));
    const stamps = (items: ItemMap) => (items[terrainId(SCENE, 0, 0)] as TerrainItem | undefined)?.stamps ?? [];
    expect(stamps(two.after)).toHaveLength(2);
    expect(stamps(applyOps(two.after, two.undo.undo(two.after)))).toHaveLength(1);
    const cleared = step(two.after, (e) => e.erase(13, 5));
    expect(stamps(applyOps(cleared.after, cleared.undo.undo(cleared.after)))).toHaveLength(2);
  });

  it("undoing a turn turns the object back in place, keeping the drawing order", () => {
    const base = applyOps({}, (() => {
      const e = new BuildEdit({}, SCENE);
      e.addStamp("table", 2, 2, 0, 2);
      e.addStamp("chair", 3, 3, 0, 1);
      return e.ops();
    })());
    const stamps = (items: ItemMap) => (items[terrainId(SCENE, 0, 0)] as TerrainItem).stamps;
    const turnTable = (e: BuildEdit) => e.place(refsTo(base, 0, 0, 0), [{ ...placedOf(0, 0, stamps(base)[0]), deg: 90 }]);
    const turn = step(base, turnTable);
    expect(stamps(turn.after)[0]).toEqual(["table", 2, 2, 1, 2]);
    expect(stamps(applyOps(turn.after, turn.undo.undo(turn.after)))).toEqual([["table", 2, 2, 0, 2], ["chair", 3, 3, 0, 1]]);
    const erase = step(base, (e) => e.erase(2, 2));
    expect(stamps(erase.after)).toEqual([["chair", 3, 3, 0, 1]]);
    expect(stamps(applyOps(erase.after, erase.undo.undo(erase.after)))).toEqual([["table", 2, 2, 0, 2], ["chair", 3, 3, 0, 1]]);
    // Turned again in another tab since: undo leaves it, rather than adding a second table.
    const again = applyOps(turn.after, { patch: [{ id: terrainId(SCENE, 0, 0), set: { stamps: [["table", 2, 2, 2, 2], ["chair", 3, 3, 0, 1]] } }] });
    expect(stamps(applyOps(again, turn.undo.undo(again)))).toEqual([["table", 2, 2, 2, 2], ["chair", 3, 3, 0, 1]]);
    // A step that doesn't say what it moved (made before pairs were kept) still undoes the
    // same way: the objects are matched up by what they are.
    const unpaired = buildUndo(base, SCENE, turn.ops);
    expect(stamps(applyOps(turn.after, unpaired.undo(turn.after)))).toEqual([["table", 2, 2, 0, 2], ["chair", 3, 3, 0, 1]]);
    expect(stamps(applyOps(again, unpaired.undo(again)))).toEqual([["table", 2, 2, 2, 2], ["chair", 3, 3, 0, 1]]);
  });

  it("brings back an erased chunk, and a removed secret door, without duplicating objects", () => {
    const base = applyOps({}, (() => {
      const e = new BuildEdit({}, SCENE);
      e.setCell(1, 1, "s");
      e.addStamp("table", 1, 1, 0, 1);
      return e.ops();
    })());
    const withSecret = applyOps(base, (() => {
      const e = new BuildEdit(base, SCENE);
      cycleDoor(e, 1, 1, "t");
      return e.ops();
    })());
    const secretOn = applyOps(withSecret, (() => {
      const e = new BuildEdit(withSecret, SCENE);
      cycleDoor(e, 1, 1, "t");
      return e.ops();
    })());
    expect(Object.values(secretOn).some((i) => i.kind === "terrain" && i.hidden)).toBe(true);
    const erase = step(secretOn, (e) => e.erase(1, 1));
    expect(erase.after[terrainId(SCENE, 0, 0)]).toBeUndefined();
    expect(Object.values(erase.after).some((i) => i.kind === "terrain" && i.hidden)).toBe(false);
    const back = applyOps(erase.after, erase.undo.undo(erase.after));
    const chunk = back[terrainId(SCENE, 0, 0)] as TerrainItem;
    expect(chunk.cells[17]).toBe("s");
    expect(chunk.stamps).toEqual([["table", 1, 1, 0, 1]]);
    expect(Object.values(back).some((i) => i.kind === "terrain" && i.hidden && i.edges[34] === "s")).toBe(true);
    // Undoing twice (a stale second tab) doesn't add the table again.
    expect(applyOps(back, erase.undo.undo(back))).toEqual(back);
  });
});

describe("floor painting", () => {
  it("paints walled floor on blank scenes and unwalled over maps, unless the GM chose", () => {
    const blank = { id: "blank1234567", mapAssetId: null } as never;
    const mapped = { id: "mapped123456", mapAssetId: "map123456789" } as never;
    expect(wallsFor(blank, {})).toBe(true);
    expect(wallsFor(mapped, {})).toBe(false);
    expect(wallsFor(mapped, { mapped123456: true })).toBe(true);
    // A choice made on one scene stays with that scene.
    expect(wallsFor(blank, { mapped123456: false })).toBe(true);
    expect(floorChar("s", true)).toBe("s");
    expect(floorChar("s", false)).toBe("S");
    expect(floorChar("g", false)).toBe("g");
  });
});

describe("objects at any angle and size", () => {
  it("are written one way only: the fine degrees only when there are some", () => {
    for (let deg = 0; deg < 360; deg += 5) {
      for (let size = 0.5; size <= 3; size += 0.25) {
        const s = makeStamp("table", 3, 4, deg, size);
        expect(stampDeg(s)).toBe(deg);
        expect(s[4]).toBe(size);
        expect(s).toHaveLength(deg % 90 ? 6 : 5);
        // And the server takes it just as it is.
        expect(cleanStamps([s])).toEqual([s]);
      }
    }
    expect(makeStamp("table", 3, 4, 105, 1.5)).toEqual(["table", 3, 4, 1, 1.5, 15]);
    expect(makeStamp("table", 3, 4, -90, 1.1)).toEqual(["table", 3, 4, 3, 1]);
  });

  it("stand on 1, 2 or 3 squares, and snap to 5 degrees and quarter squares", () => {
    expect([0.5, 1.25, 1.5, 2.25, 2.5, 3].map(stampBlock)).toEqual([1, 1, 2, 2, 3, 3]);
    expect([snapDeg(-15), snapDeg(362), snapDeg(357.6), snapDeg(-0), snapDeg(720)]).toEqual([345, 0, 0, 0, 0]);
    expect([snapSize(0.3), snapSize(1.1), snapSize(1.2), snapSize(3.4)]).toEqual([0.5, 1, 1.25, 3]);
  });
});

describe("moving, turning and sizing objects", () => {
  const base = toMap([chunk(0, 0, { stamps: [["chair", 2, 2, 0, 1], ["table", 2, 2, 0, 2], ["rock", 9, 9, 0, 1]] })]);
  const placed = (items: ItemMap, cx: number, cy: number, i: number) => placedOf(cx, cy, stampsIn(items, cx, cy)[i]);
  const scene = { c0: 0, r0: 0, c1: 63, r1: 63 };

  it("turns an object where it is in the drawing order, and undoes it", () => {
    const t = edit(base, (e) => e.place(refsTo(base, 0, 0, 1), [{ ...placed(base, 0, 0, 1), deg: 15 }]));
    expect(stampsIn(t.after)).toEqual([["chair", 2, 2, 0, 1], ["table", 2, 2, 0, 2, 15], ["rock", 9, 9, 0, 1]]);
    expect(t.result).toEqual({ ok: true, refs: [{ cx: 0, cy: 0, i: 1, key: "table,2,2,0,2,15" }] });
    expect(t.ops.patch).toHaveLength(1);
    expect(stampsIn(applyOps(t.after, t.undo.undo(t.after)))).toEqual(stampsIn(base));
  });

  it("sizes an object about its middle", () => {
    const bigger = sizeGroup([placed(base, 0, 0, 0)], 0.5, scene);
    const t = edit(base, (e) => e.place(refsTo(base, 0, 0, 0), bigger));
    expect(stampsIn(t.after)[0]).toEqual(["chair", 1, 1, 0, 1.5]);
    const back = edit(t.after, (e) => e.place(refsOf(t.result), sizeGroup(bigger, -0.5, scene)));
    expect(stampsIn(back.after)).toEqual(stampsIn(base));
  });

  it("moves an object across a chunk border as one step that undoes, on top in its new chunk", () => {
    const items = toMap([chunk(0, 0, { stamps: [["table", 14, 3, 1, 2, 15]] }), chunk(1, 0, { stamps: [["rock", 5, 5, 0, 1]] })]);
    const t = edit(items, (e) => e.place(refsTo(items, 0, 0, 0), shiftGroup([placed(items, 0, 0, 0)], 3, 0, scene)));
    expect(t.after[terrainId(SCENE, 0, 0)]).toBeUndefined();
    expect(stampsIn(t.after, 1, 0)).toEqual([["rock", 5, 5, 0, 1], ["table", 1, 3, 1, 2, 15]]);
    expect(t.result).toEqual({ ok: true, refs: [{ cx: 1, cy: 0, i: 1, key: "table,1,3,1,2,15" }] });
    const back = applyOps(t.after, t.undo.undo(t.after));
    expect(stampsIn(back)).toEqual([["table", 14, 3, 1, 2, 15]]);
    expect(stampsIn(back, 1, 0)).toEqual([["rock", 5, 5, 0, 1]]);
  });

  it("keeps what it did to each object, for undo", () => {
    const e = new BuildEdit(base, SCENE);
    e.place(refsTo(base, 0, 0, 0, 2), [{ ...placed(base, 0, 0, 0), col: 20 }, { ...placed(base, 0, 0, 2), deg: 90 }]);
    expect(e.pairs()).toEqual([
      { from: { cx: 0, cy: 0, i: 0, stamp: ["chair", 2, 2, 0, 1] }, to: { cx: 1, cy: 0, i: 0, stamp: ["chair", 4, 2, 0, 1] } },
      { from: { cx: 0, cy: 0, i: 2, stamp: ["rock", 9, 9, 0, 1] }, to: { cx: 0, cy: 0, i: 1, stamp: ["rock", 9, 9, 1, 1] } },
    ]);
    expect(new BuildEdit(base, SCENE).pairs()).toEqual([]);
  });

  it("moves objects in three chunks as one step, and undo puts them all back", () => {
    const items = toMap([
      chunk(0, 0, { stamps: [["chair", 15, 15, 0, 1], ["bed", 3, 3, 0, 2]] }),
      chunk(1, 0, { stamps: [["chair", 0, 15, 2, 1]] }),
      chunk(0, 1, { stamps: [["table", 15, 0, 0, 1, 45]] }),
    ]);
    const refs = [...refsTo(items, 0, 0, 0), ...refsTo(items, 1, 0, 0), ...refsTo(items, 0, 1, 0)];
    const ps = [placed(items, 0, 0, 0), placed(items, 1, 0, 0), placed(items, 0, 1, 0)];
    const t = edit(items, (e) => e.place(refs, shiftGroup(ps, 1, 1, scene)));
    expect(stampsIn(t.after)).toEqual([["bed", 3, 3, 0, 2]]);
    expect(t.after[terrainId(SCENE, 1, 0)]).toBeUndefined();
    expect(t.after[terrainId(SCENE, 0, 1)]).toBeUndefined();
    expect(stampsIn(t.after, 1, 1)).toEqual([["chair", 0, 0, 0, 1], ["chair", 1, 0, 2, 1], ["table", 0, 1, 0, 1, 45]]);
    // What it returns finds the objects where they now are.
    const m = new BuildModel();
    m.index = indexTerrain(Object.values(t.after) as TerrainItem[]);
    expect(m.resolve(refsOf(t.result)).refs).toEqual(refsOf(t.result));
    expect(m.resolve(refsOf(t.result)).hits.map((h) => placedOf(h.cx, h.cy, h.stamp))).toEqual(shiftGroup(ps, 1, 1, scene));
    const back = applyOps(t.after, t.undo.undo(t.after));
    for (const id of Object.keys(items)) expect((back[id] as TerrainItem).stamps).toEqual((items[id] as TerrainItem).stamps);
    expect(back[terrainId(SCENE, 1, 1)]).toBeUndefined();
    const again = applyOps(back, t.undo.redo(back));
    expect(stampsIn(again, 1, 1)).toEqual(stampsIn(t.after, 1, 1));
  });

  it("turns a group as a whole, as one step", () => {
    const items = toMap([chunk(0, 0, { stamps: [["chair", 4, 5, 0, 1], ["table", 5, 5, 0, 2], ["chair", 7, 5, 0, 1]] })]);
    const ps = [0, 1, 2].map((i) => placed(items, 0, 0, i));
    const t = edit(items, (e) => e.place(refsTo(items, 0, 0, 0, 1, 2), turnGroup(ps, 90, scene)));
    expect(stampsIn(t.after)).toEqual([["chair", 6, 4, 1, 1], ["table", 5, 5, 1, 2], ["chair", 6, 7, 1, 1]]);
    expect(stampsIn(applyOps(t.after, t.undo.undo(t.after)))).toEqual(stampsIn(items));
  });

  it("changes nothing if a chunk would hold too many, however the objects come and go", () => {
    const full: Stamp[] = Array.from({ length: 64 }, (_, i) => ["rock", i % 16, Math.floor(i / 16), 0, 1]);
    const items = toMap([chunk(0, 0, { stamps: [["chair", 15, 0, 0, 1]] }), chunk(1, 0, { stamps: full })]);
    const into = new BuildEdit(items, SCENE);
    expect(into.place(refsTo(items, 0, 0, 0), shiftGroup([placed(items, 0, 0, 0)], 1, 0, scene))).toEqual({ ok: false, reason: "full" });
    expect(into.ops()).toEqual({});
    expect(into.pairs()).toEqual([]);
    // Within the full chunk, or one out as another comes in, it's fine.
    expect(edit(items, (e) => e.place(refsTo(items, 1, 0, 5), [{ ...placed(items, 1, 0, 5), deg: 90 }])).result.ok).toBe(true);
    const swap = edit(items, (e) =>
      e.place([...refsTo(items, 0, 0, 0), ...refsTo(items, 1, 0, 0)], [{ ...placed(items, 0, 0, 0), col: 20 }, { ...placed(items, 1, 0, 0), col: 3 }]),
    );
    expect(swap.result.ok).toBe(true);
    expect(stampsIn(swap.after, 1, 0)).toHaveLength(64);
  });

  it("skips objects that have gone, does nothing if they all have, and nothing for no change", () => {
    const gone = refOf({ cx: 0, cy: 0, i: 0, stamp: ["bed", 2, 2, 0, 1] });
    expect(new BuildEdit(base, SCENE).place([gone], [placed(base, 0, 0, 0)])).toEqual({ ok: false, reason: "gone" });
    // A chair picked up has gone (undone meanwhile): the other object picked up still moves.
    const one = edit(base, (e) => e.place([gone, ...refsTo(base, 0, 0, 2)], [{ ...placed(base, 0, 0, 0), col: 12 }, { ...placed(base, 0, 0, 2), col: 10 }]));
    expect(stampsIn(one.after)).toEqual([["chair", 2, 2, 0, 1], ["table", 2, 2, 0, 2], ["rock", 10, 9, 0, 1]]);
    expect(refsOf(one.result)).toEqual([{ cx: 0, cy: 0, i: 2, key: "rock,10,9,0,1" }]);
    const same = edit(base, (e) => e.place(refsTo(base, 0, 0, 0, 2), [placed(base, 0, 0, 0), placed(base, 0, 0, 2)]));
    expect(same.result).toEqual({ ok: true, refs: refsTo(base, 0, 0, 0, 2) });
    expect(same.ops).toEqual({});
    expect(() => new BuildEdit(base, SCENE).place(refsTo(base, 0, 0, 0), [])).toThrow();
  });

  it("keeps the places of the rest when one before them leaves the chunk", () => {
    const t = edit(base, (e) => e.place(refsTo(base, 0, 0, 0, 2), [{ ...placed(base, 0, 0, 0), col: 20 }, { ...placed(base, 0, 0, 2), deg: 90 }]));
    expect(stampsIn(t.after)).toEqual([["table", 2, 2, 0, 2], ["rock", 9, 9, 1, 1]]);
    expect(refsOf(t.result).map((r) => [r.cx, r.i])).toEqual([[1, 0], [0, 1]]);
    expect(stampsIn(applyOps(t.after, t.undo.undo(t.after)))).toEqual(stampsIn(base));
  });

  /** The object drawn on top at a point (in cells) in these items. */
  const topAt = (items: ItemMap, u: number, v: number) => {
    const m = new BuildModel();
    m.index = indexTerrain(Object.values(items) as TerrainItem[]);
    return m.stampAtPoint(u, v, 0)?.stamp[0];
  };

  it("keeps a group stacked as it was across a chunk border, whatever order it was picked in", () => {
    // A chair on a 2-square table, picked chair first (clicked, then the table Shift+clicked),
    // moved 6 squares right into the next chunk.
    const items = toMap([chunk(0, 0, { stamps: [["table", 12, 4, 0, 2], ["chair", 13, 4, 0, 1]] })]);
    const ps = [placed(items, 0, 0, 1), placed(items, 0, 0, 0)];
    const t = edit(items, (e) => e.place(refsTo(items, 0, 0, 1, 0), shiftGroup(ps, 6, 0, scene)));
    expect(stampsIn(t.after, 1, 0)).toEqual([["table", 2, 4, 0, 2], ["chair", 3, 4, 0, 1]]);
    expect(topAt(t.after, 19.5, 4.5)).toBe("chair");
    // What it returns is in the order given, where each now is.
    expect(refsOf(t.result)).toEqual([
      { cx: 1, cy: 0, i: 1, key: "chair,3,4,0,1" },
      { cx: 1, cy: 0, i: 0, key: "table,2,4,0,2" },
    ]);
    const back = applyOps(t.after, t.undo.undo(t.after));
    expect(stampsIn(back)).toEqual(stampsIn(items));
    expect(back[terrainId(SCENE, 1, 0)]).toBeUndefined();
    expect(stampsIn(applyOps(back, t.undo.redo(back)), 1, 0)).toEqual(stampsIn(t.after, 1, 0));
  });

  it("and when part of it comes into a chunk under one of it that was already there", () => {
    // A 3-square table just before a chunk border, and a chair on it just past the border,
    // between two other objects: nudged 2 squares right, the table comes into the chair's chunk.
    const items = toMap([
      chunk(0, 0, { stamps: [["table", 14, 4, 0, 3]] }),
      chunk(1, 0, { stamps: [["rock", 9, 9, 0, 1], ["chair", 0, 5, 0, 1], ["crate", 9, 12, 0, 1]] }),
    ]);
    const ps = [placed(items, 0, 0, 0), placed(items, 1, 0, 1)];
    const t = edit(items, (e) => e.place([...refsTo(items, 0, 0, 0), ...refsTo(items, 1, 0, 1)], shiftGroup(ps, 2, 0, scene)));
    expect(stampsIn(t.after, 1, 0)).toEqual([["rock", 9, 9, 0, 1], ["table", 0, 4, 0, 3], ["chair", 2, 5, 0, 1], ["crate", 9, 12, 0, 1]]);
    expect(topAt(t.after, 18.5, 5.5)).toBe("chair");
    expect(refsOf(t.result).map((r) => [r.cx, r.i])).toEqual([[1, 1], [1, 2]]);
    const back = applyOps(t.after, t.undo.undo(t.after));
    for (const id of Object.keys(items)) expect((back[id] as TerrainItem).stamps).toEqual((items[id] as TerrainItem).stamps);
    const again = applyOps(back, t.undo.redo(back));
    expect(stampsIn(again, 1, 0)).toEqual(stampsIn(t.after, 1, 0));
    expect(again[terrainId(SCENE, 0, 0)]).toBeUndefined();
  });
});

describe("placing and deleting objects", () => {
  const P = (col: number, row: number, deg = 0, size = 1) => ({ id: "chair" as const, col, row, deg, size });

  it("won't put one exactly on top of the same, though it will on top of another", () => {
    const one = edit({}, (e) => e.addPlaced(P(3, 3, 15, 1.5)));
    expect(one.result).toEqual({ ok: true, refs: [{ cx: 0, cy: 0, i: 0, key: "chair,3,3,0,1.5,15" }] });
    expect(new BuildEdit(one.after, SCENE).addPlaced(P(3, 3, 15, 1.5))).toEqual({ ok: false, reason: "same" });
    expect(edit(one.after, (e) => e.addPlaced(P(3, 3, 20, 1.5))).result.ok).toBe(true);
    expect(edit(one.after, (e) => e.addPlaced(P(3, 3, 15, 1.25))).result.ok).toBe(true);
    // (Adding the raw way still stacks them.)
    expect(new BuildEdit(one.after, SCENE).addStamp("chair", 3, 3, 0, 1.5)).toBe(true);
  });

  it("places a group in its order, all of it or none", () => {
    const t = edit({}, (e) => e.addGroup([P(15, 2), P(16, 2, 90), P(15, 2)]));
    expect(stampsIn(t.after)).toEqual([["chair", 15, 2, 0, 1], ["chair", 15, 2, 0, 1]]);
    expect(stampsIn(t.after, 1, 0)).toEqual([["chair", 0, 2, 1, 1]]);
    expect(refsOf(t.result).map((r) => [r.cx, r.i])).toEqual([[0, 0], [1, 0], [0, 1]]);
    expect(new BuildEdit(t.after, SCENE).addGroup([P(1, 1), P(16, 2, 90)])).toEqual({ ok: false, reason: "same" });
    const nearlyFull = toMap([chunk(1, 0, { stamps: Array.from({ length: 63 }, (_, i): Stamp => ["rock", i % 16, Math.floor(i / 16), 0, 1]) })]);
    const e = new BuildEdit(nearlyFull, SCENE);
    expect(e.addGroup([P(1, 1), P(17, 5), P(18, 5)])).toEqual({ ok: false, reason: "full" });
    expect(e.ops()).toEqual({});
    expect(edit(nearlyFull, (e) => e.addGroup([P(1, 1), P(17, 5)])).result.ok).toBe(true);
  });

  it("takes away the objects picked, if they're still there", () => {
    const items = toMap([
      chunk(0, 0, { stamps: [["chair", 1, 1, 0, 1], ["table", 2, 2, 0, 2], ["rock", 9, 9, 0, 1]] }),
      chunk(1, 0, { stamps: [["bed", 0, 0, 0, 2]] }),
    ]);
    const stale = refOf({ cx: 0, cy: 0, i: 1, stamp: ["crate", 2, 2, 0, 2] });
    const t = edit(items, (e) => e.removeRefs([...refsTo(items, 0, 0, 0, 2), ...refsTo(items, 1, 0, 0), stale]));
    expect(t.result).toBe(3);
    expect(stampsIn(t.after)).toEqual([["table", 2, 2, 0, 2]]);
    expect(t.after[terrainId(SCENE, 1, 0)]).toBeUndefined();
    const back = applyOps(t.after, t.undo.undo(t.after));
    expect(stampsIn(back)).toEqual(stampsIn(items));
    expect(stampsIn(back, 1, 0)).toEqual(stampsIn(items, 1, 0));
  });
});

describe("taking doors away", () => {
  // A stone cell at (1,1): its top edge (index 34) has an automatic wall.
  const room = () => toMap([chunk(0, 0, { cells: cellsWith([[1, 1, "s"]]) })]);
  const apply = (items: ItemMap, change: (e: BuildEdit) => void) => {
    const e = new BuildEdit(items, SCENE);
    change(e);
    return applyOps(items, e.ops());
  };
  const edges = (items: ItemMap, ...is: number[]) => is.map((i) => (items[terrainId(SCENE, 0, 0)] as TerrainItem).edges[i]);
  const at = (col: number, row: number) => (row * 16 + col) * 2;

  it("leaves what was there before each door: the wall it was cut into, or nothing", () => {
    // In an automatic wall, in a hand-drawn one, and on a bare line.
    let items = apply(room(), (e) => {
      setPortal(e, 1, 1, "t", "door");
      setWall(e, 6, 6, "t", "add");
      setPortal(e, 8, 8, "t", "door");
    });
    items = apply(items, (e) => setPortal(e, 6, 6, "t", "door"));
    expect(edges(items, at(1, 1), at(6, 6), at(8, 8))).toEqual(["d", "D", "d"]);
    let n = 0;
    items = apply(items, (e) => {
      n = e.removeDoors([{ col: 1, row: 1, side: "t" }, { col: 6, row: 6, side: "t" }, { col: 8, row: 8, side: "t" }]);
    });
    expect(n).toBe(3);
    expect(edges(items, at(1, 1), at(6, 6), at(8, 8))).toEqual([".", "w", "."]);
  });

  it("takes a secret door away, leaving the wall players always saw", () => {
    const items = apply(room(), (e) => setPortal(e, 1, 1, "t", "secret"));
    const marker = Object.values(items).find((t) => t.kind === "terrain" && t.hidden)!;
    const e = new BuildEdit(items, SCENE);
    expect(e.removeDoors([{ col: 1, row: 1, side: "t" }])).toBe(1);
    expect(e.ops()).toEqual({ delete: [marker.id] });
  });

  it("takes one of two secret doors in a chunk away, keeping the other", () => {
    const items = apply(room(), (e) => {
      setPortal(e, 1, 1, "t", "secret");
      setPortal(e, 1, 1, "l", "secret");
    });
    const marker = Object.values(items).find((t) => t.kind === "terrain" && t.hidden)!;
    const e = new BuildEdit(items, SCENE);
    expect(e.removeDoors([{ col: 1, row: 1, side: "t" }])).toBe(1);
    expect(e.ops()).toEqual({ patch: [{ id: marker.id, set: { edges: ".".repeat(35) + "s" + ".".repeat(476) } }] });
  });

  it("skips openings, walls, lines with nothing on them, and a door listed twice", () => {
    const items = apply(room(), (e) => {
      setPortal(e, 1, 1, "t", "open");
      setPortal(e, 5, 5, "t", "door");
    });
    const e = new BuildEdit(items, SCENE);
    const door = { col: 5, row: 5, side: "t" as const };
    expect(e.removeDoors([{ col: 1, row: 1, side: "t" }, { col: 1, row: 1, side: "l" }, { col: 9, row: 9, side: "t" }, door, door])).toBe(1);
    expect(e.ops().patch).toHaveLength(1);
  });
});

describe("undo steps made of several", () => {
  const base = toMap([chunk(0, 0, { stamps: [["table", 2, 2, 0, 2], ["chair", 9, 9, 0, 1]] })]);
  const turn = (items: ItemMap, i: number, deg: number) => edit(items, (e) => e.place(refsTo(items, 0, 0, i), [{ ...placedOf(0, 0, stampsIn(items)[i]), deg }]));

  it("undoes two turns in one, and redoes them", () => {
    const a = turn(base, 0, 15);
    const b = turn(a.after, 0, 30);
    const both = composeBuildUndo(a.undo, b.undo);
    const back = applyOps(b.after, both.undo(b.after));
    expect(stampsIn(back)).toEqual(stampsIn(base));
    expect(stampsIn(applyOps(back, both.redo(back)))).toEqual(stampsIn(b.after));
  });

  it("leaves alone what another tab changed in between", () => {
    const a = turn(base, 0, 15);
    // Another tab turns the chair.
    const b = turn(turn(a.after, 1, 90).after, 0, 30);
    const both = composeBuildUndo(a.undo, b.undo);
    const ops = both.undo(b.after);
    const back = applyOps(b.after, ops);
    expect(stampsIn(back)).toEqual([["table", 2, 2, 0, 2], ["chair", 9, 9, 1, 1]]);
    // Just the one chunk, and only its objects.
    expect(ops).toEqual({ patch: [{ id: terrainId(SCENE, 0, 0), set: { stamps: stampsIn(back) } }] });
    expect(stampsIn(applyOps(back, both.redo(back)))).toEqual(stampsIn(b.after));
    // Three in a row, the way repeated steps are folded together.
    const c = turn(b.after, 0, 45);
    const three = composeBuildUndo(both, c.undo);
    expect(stampsIn(applyOps(c.after, three.undo(c.after)))).toEqual([["table", 2, 2, 0, 2], ["chair", 9, 9, 1, 1]]);
  });

  it("works out the operations between two states: deleted, added, and only what changed", () => {
    const secret = { ...chunk(0, 0), id: "AaaaaaaaaaaA", hidden: true, edges: "s" + noEdges.slice(1) };
    const moved = { ...secret, id: "BbbbbbbbbbbB" };
    const now = toMap([chunk(0, 0, { cells: cellsWith([[1, 1, "s"]]), stamps: [["rock", 1, 1, 0, 1]] }), chunk(1, 0), secret]);
    const final = toMap([chunk(0, 0, { cells: cellsWith([[1, 1, "s"]]), stamps: [["rock", 1, 1, 0, 1, 15]] }), chunk(0, 1), moved]);
    const ops = opsBetween(now, final, [...Object.keys(now), ...Object.keys(final), terrainId(SCENE, 5, 5)]);
    expect(ops).toEqual({
      upsert: [final[terrainId(SCENE, 0, 1)], moved],
      patch: [{ id: terrainId(SCENE, 0, 0), set: { stamps: [["rock", 1, 1, 0, 1, 15]] } }],
      delete: [terrainId(SCENE, 1, 0), secret.id],
    });
    expect(applyOps(now, ops)).toEqual(final);
    expect(opsBetween(now, { ...now }, Object.keys(now))).toEqual({});
  });
});

describe("objects that differ only by their fine degrees", () => {
  it("are told apart, whichever way round", () => {
    const fine = toMap([chunk(0, 0, { stamps: [["table", 2, 2, 0, 1, 15]] })]);
    const plain = toMap([chunk(0, 0, { stamps: [["table", 2, 2, 0, 1]] })]);
    for (const [from, to, deg] of [[fine, plain, 0], [plain, fine, 15]] as const) {
      const t = edit(from, (e) => e.place(refsTo(from, 0, 0, 0), [{ ...placedOf(0, 0, stampsIn(from)[0]), deg }]));
      expect(t.ops).toEqual({ patch: [{ id: terrainId(SCENE, 0, 0), set: { stamps: stampsIn(to) } }] });
      const r = new BuildRenderer();
      r.update(Object.values(from) as TerrainItem[]);
      const dirty = (r as unknown as { paintDirty: Set<number> }).paintDirty;
      dirty.clear();
      expect(r.update(Object.values(to) as TerrainItem[])).toBe(true);
      expect(dirty.size).toBe(1);
    }
  });
});

describe("undoing moves, turns and size changes while another tab builds too", () => {
  const scene = { c0: -100, r0: -100, c1: 100, r1: 100 };
  const placed = (items: ItemMap, cx: number, cy: number, i: number) => placedOf(cx, cy, stampsIn(items, cx, cy)[i]);
  const base = toMap([chunk(0, 0, { stamps: [["chair", 2, 2, 0, 1], ["table", 4, 4, 0, 2], ["rock", 9, 9, 0, 1]] })]);

  it("puts back a turn, a finer turn or a new size where the object was in the drawing order, and redoes it", () => {
    const table = placed(base, 0, 0, 1);
    for (const next of [{ ...table, deg: 90 }, { ...table, deg: 105 }, sizeGroup([table], 0.75, scene)[0], sizeGroup([table], -1.5, scene)[0]]) {
      const t = edit(base, (e) => e.place(refsTo(base, 0, 0, 1), [next]));
      expect(stampsIn(t.after)[1]).toEqual(stampFor(next).stamp);
      const back = applyOps(t.after, t.undo.undo(t.after));
      expect(stampsIn(back)).toEqual(stampsIn(base));
      expect(stampsIn(applyOps(back, t.undo.redo(back)))).toEqual(stampsIn(t.after));
    }
  });

  it("puts one back under what it was under, when another tab has taken away an object before it", () => {
    // A chair on a 3-square table, after a chest and a crate.
    const set = toMap([chunk(0, 0, { stamps: [["chest", 1, 1, 0, 1], ["crate", 2, 1, 0, 1], ["table", 4, 4, 0, 3], ["chair", 5, 5, 0, 1]] })]);
    const table = placed(set, 0, 0, 2);
    const chestGone = (items: ItemMap) => edit(items, (e) => e.removeRefs(refsTo(items, 0, 0, 0))).after;
    // Turned; then the chest deleted in another tab.
    const turn = edit(set, (e) => e.place(refsTo(set, 0, 0, 2), [{ ...table, deg: 15 }]));
    const turned = chestGone(turn.after);
    const back = applyOps(turned, turn.undo.undo(turned));
    expect(stampsIn(back)).toEqual([["crate", 2, 1, 0, 1], ["table", 4, 4, 0, 3], ["chair", 5, 5, 0, 1]]);
    expect(stampsIn(applyOps(back, turn.undo.redo(back)))).toEqual([["crate", 2, 1, 0, 1], ["table", 4, 4, 0, 3, 15], ["chair", 5, 5, 0, 1]]);
    // Moved into the next chunk and back, the same.
    const move = edit(set, (e) => e.place(refsTo(set, 0, 0, 2), [{ ...table, col: 20 }]));
    const moved = chestGone(move.after);
    const undone = applyOps(moved, move.undo.undo(moved));
    expect(stampsIn(undone)).toEqual([["crate", 2, 1, 0, 1], ["table", 4, 4, 0, 3], ["chair", 5, 5, 0, 1]]);
    expect(undone[terrainId(SCENE, 1, 0)]).toBeUndefined();
    // Undone, then an object put in its chunk in another tab: redo puts it back on top of the rest there, as before.
    const busy = edit(undone, (e) => e.addPlaced({ id: "barrel", col: 22, row: 2, deg: 0, size: 1 })).after;
    const redone = applyOps(busy, move.undo.redo(busy));
    expect(stampsIn(redone)).toEqual([["crate", 2, 1, 0, 1], ["chair", 5, 5, 0, 1]]);
    expect(stampsIn(redone, 1, 0)).toEqual([["barrel", 6, 2, 0, 1], ["table", 4, 4, 0, 3]]);
  });

  it("puts back only what's still as the step left it: an object another tab deleted stays deleted", () => {
    // Chairs A and C, in two chunks, moved 6 squares right together: A into C's chunk, C into the next.
    const items = toMap([chunk(0, 0, { stamps: [["chair", 15, 3, 0, 1]] }), chunk(1, 0, { stamps: [["chair", 10, 3, 0, 1]] })]);
    const ps = [placed(items, 0, 0, 0), placed(items, 1, 0, 0)];
    const t = edit(items, (e) => e.place([...refsTo(items, 0, 0, 0), ...refsTo(items, 1, 0, 0)], shiftGroup(ps, 6, 0, scene)));
    expect(stampsIn(t.after, 1, 0)).toEqual([["chair", 5, 3, 0, 1]]);
    expect(stampsIn(t.after, 2, 0)).toEqual([["chair", 0, 3, 0, 1]]);
    // Another tab deletes A where it now is.
    const other = edit(t.after, (e) => e.removeRefs(refsTo(t.after, 1, 0, 0))).after;
    const back = applyOps(other, t.undo.undo(other));
    // C is back where it was, and gone from where it was moved to; A isn't brought back.
    expect(back[terrainId(SCENE, 0, 0)]).toBeUndefined();
    expect(stampsIn(back, 1, 0)).toEqual([["chair", 10, 3, 0, 1]]);
    expect(back[terrainId(SCENE, 2, 0)]).toBeUndefined();
    // Redone, C moves again, and A still isn't.
    const again = applyOps(back, t.undo.redo(back));
    expect(again[terrainId(SCENE, 0, 0)]).toBeUndefined();
    expect(again[terrainId(SCENE, 1, 0)]).toBeUndefined();
    expect(stampsIn(again, 2, 0)).toEqual([["chair", 0, 3, 0, 1]]);
  });

  it("leaves an object moved to another chunk alone once another tab has turned it: no second copy", () => {
    const items = toMap([chunk(0, 0, { stamps: [["table", 14, 3, 0, 2], ["rock", 1, 1, 0, 1]] })]);
    const t = edit(items, (e) => e.place(refsTo(items, 0, 0, 0), shiftGroup([placed(items, 0, 0, 0)], 4, 0, scene)));
    expect(stampsIn(t.after, 1, 0)).toEqual([["table", 2, 3, 0, 2]]);
    const turned = edit(t.after, (e) => e.place(refsTo(t.after, 1, 0, 0), [{ ...placed(t.after, 1, 0, 0), deg: 90 }])).after;
    expect(t.undo.undo(turned)).toEqual({});
    expect(t.undo.redo(turned)).toEqual({});
    expect(stampsIn(turned)).toEqual([["rock", 1, 1, 0, 1]]);
    expect(stampsIn(turned, 1, 0)).toEqual([["table", 2, 3, 1, 2]]);
  });

  it("the same for one moved within its chunk", () => {
    const t = edit(base, (e) => e.place(refsTo(base, 0, 0, 1), shiftGroup([placed(base, 0, 0, 1)], 3, 3, scene)));
    const turned = edit(t.after, (e) => e.place(refsTo(t.after, 0, 0, 1), [{ ...placed(t.after, 0, 0, 1), deg: 45 }])).after;
    const want = [["chair", 2, 2, 0, 1], ["table", 7, 7, 0, 2, 45], ["rock", 9, 9, 0, 1]];
    expect(stampsIn(turned)).toEqual(want);
    expect(stampsIn(applyOps(turned, t.undo.undo(turned)))).toEqual(want);
    // Undone, then turned in another tab: redo leaves it too.
    const undone = applyOps(t.after, t.undo.undo(t.after));
    const turnedBack = edit(undone, (e) => e.place(refsTo(undone, 0, 0, 1), [{ ...placed(undone, 0, 0, 1), deg: 45 }])).after;
    expect(t.undo.redo(turnedBack)).toEqual({});
  });

  it("leaves an object where it is if its old chunk has been filled since, and still undoes a swap in a full one", () => {
    const items = toMap([chunk(0, 0, { stamps: [["chair", 15, 0, 0, 1]] })]);
    const t = edit(items, (e) => e.place(refsTo(items, 0, 0, 0), shiftGroup([placed(items, 0, 0, 0)], 1, 0, scene)));
    const rocks = Array.from({ length: 64 }, (_, i) => ({ id: "rock" as const, col: i % 16, row: Math.floor(i / 16), deg: 0, size: 1 }));
    const filled = edit(t.after, (e) => e.addGroup(rocks)).after;
    const back = applyOps(filled, t.undo.undo(filled));
    expect(stampsIn(back)).toHaveLength(64);
    expect(stampsIn(back, 1, 0)).toEqual([["chair", 0, 0, 0, 1]]);
    // A chair into a full chunk as a rock comes out of it: undone, each goes back.
    const full: Stamp[] = Array.from({ length: 64 }, (_, i) => ["rock", i % 16, Math.floor(i / 16), 0, 1]);
    const two = toMap([chunk(0, 0, { stamps: [["chair", 15, 0, 0, 1]] }), chunk(1, 0, { stamps: full })]);
    const swap = edit(two, (e) =>
      e.place([...refsTo(two, 0, 0, 0), ...refsTo(two, 1, 0, 0)], [{ ...placed(two, 0, 0, 0), col: 20 }, { ...placed(two, 1, 0, 0), col: 3 }]),
    );
    const swapped = applyOps(swap.after, swap.undo.undo(swap.after));
    expect(stampsIn(swapped)).toEqual(stampsIn(two));
    expect(stampsIn(swapped, 1, 0)).toEqual(full);
  });

  it("moves back the one of two identical objects that moved", () => {
    const items = toMap([chunk(0, 0, { stamps: [["chair", 2, 2, 0, 1], ["table", 5, 5, 0, 1], ["chair", 2, 2, 0, 1]] })]);
    const t = edit(items, (e) => e.place(refsTo(items, 0, 0, 2), [{ ...placed(items, 0, 0, 2), col: 20 }]));
    expect(stampsIn(t.after)).toEqual([["chair", 2, 2, 0, 1], ["table", 5, 5, 0, 1]]);
    expect(stampsIn(applyOps(t.after, t.undo.undo(t.after)))).toEqual(stampsIn(items));
  });

  it("keeps one pair for an object placed twice in one edit, and none for one put back as it was", () => {
    const e = new BuildEdit(base, SCENE);
    const first = e.place(refsTo(base, 0, 0, 1), [{ ...placed(base, 0, 0, 1), deg: 15 }]);
    e.place(refsOf(first), [{ ...placed(base, 0, 0, 1), col: 20, deg: 30 }]);
    expect(e.pairs()).toEqual([{ from: { cx: 0, cy: 0, i: 1, stamp: ["table", 4, 4, 0, 2] }, to: { cx: 1, cy: 0, i: 0, stamp: ["table", 4, 4, 0, 2, 30] } }]);
    const ops = e.ops();
    const after = applyOps(base, ops);
    expect(stampsIn(applyOps(after, buildUndo(base, SCENE, ops, e.pairs()).undo(after)))).toEqual(stampsIn(base));
    const still = new BuildEdit(base, SCENE);
    const turned = still.place(refsTo(base, 0, 0, 1), [{ ...placed(base, 0, 0, 1), deg: 15 }]);
    still.place(refsOf(turned), [placed(base, 0, 0, 1)]);
    expect(still.pairs()).toEqual([]);
    expect(still.ops()).toEqual({});
  });
});

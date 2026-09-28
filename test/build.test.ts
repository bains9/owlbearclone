import { describe, expect, it } from "vitest";
import { applyOps, inverseOps } from "../src/shared/ops";
import type { ItemMap } from "../src/shared/ops";
import { canCreate, canDelete, canPatch, visibleToPlayer } from "../src/shared/permissions";
import { DEFAULT_SETTINGS, sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import { chunkOf, inChunk, looksLikeTerrainId, sceneCells, terrainId } from "../src/shared/terrain";
import type { Stamp } from "../src/shared/terrain";
import type { TerrainItem } from "../src/shared/types";
import { BuildEdit, BuildModel, buildUndo, cellKey, cycleDoor, edgeKey, setPortal, floorChar, indexTerrain, setWall, wallsFor } from "../src/client/room/build";

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

  it("a click on an object turns it; removing takes the top one", () => {
    const items = toMap([chunk(0, 0, { stamps: [["chair", 2, 2, 3, 1], ["table", 2, 2, 0, 2]] })]);
    const e = new BuildEdit(items, SCENE);
    expect(e.rotateStampAt(3, 3)).toBe(true);
    expect(e.ops().patch![0].set.stamps).toEqual([["chair", 2, 2, 3, 1], ["table", 2, 2, 1, 2]]);
    const e2 = new BuildEdit(items, SCENE);
    expect(e2.removeStampAt(2, 2)).toBe(true);
    expect(e2.ops().patch![0].set.stamps).toEqual([["chair", 2, 2, 3, 1]]);
    expect(new BuildEdit(items, SCENE).rotateStampAt(9, 9)).toBe(false);
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
  it("moves the top object across a chunk border, as one step that undoes", () => {
    const items = toMap([chunk(0, 0, { stamps: [["table", 14, 3, 1, 2]] })]);
    const e = new BuildEdit(items, SCENE);
    expect(e.moveStamp(15, 4, 17, 3)).toBe(true);
    const ops = e.ops();
    const after = applyOps(items, ops);
    expect((after[terrainId(SCENE, 0, 0)] as TerrainItem | undefined)?.stamps ?? []).toEqual([]);
    expect((after[terrainId(SCENE, 1, 0)] as TerrainItem).stamps).toEqual([["table", 1, 3, 1, 2]]);
    const undo = buildUndo(items, SCENE, ops);
    const back = applyOps(after, undo.undo(after));
    expect((back[terrainId(SCENE, 0, 0)] as TerrainItem).stamps).toEqual([["table", 14, 3, 1, 2]]);
    expect(back[terrainId(SCENE, 1, 0)]).toBeUndefined();
  });

  it("does nothing when dropped where it was, or where there's nothing to move", () => {
    const items = toMap([chunk(0, 0, { stamps: [["chair", 2, 2, 0, 1]] })]);
    expect(new BuildEdit(items, SCENE).moveStamp(2, 2, 2, 2)).toBe(false);
    expect(new BuildEdit(items, SCENE).moveStamp(9, 9, 3, 3)).toBe(false);
  });

  it("moves only the object picked up, not whatever is there now", () => {
    const items = toMap([chunk(0, 0, { stamps: [["table", 2, 2, 0, 2]] })]);
    // The chair that was picked up has gone (undone meanwhile): the table under it stays put.
    expect(new BuildEdit(items, SCENE).moveStamp(2, 2, 6, 6, ["chair", 2, 2, 0, 1])).toBe(false);
    expect(new BuildEdit(items, SCENE).moveStamp(2, 2, 6, 6, ["table", 2, 2, 0, 2])).toBe(true);
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
    return { ops, after: applyOps(items, ops), undo: buildUndo(items, SCENE, ops) };
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
    const turn = step(base, (e) => e.rotateStampAt(2, 2));
    expect(stamps(turn.after)[0]).toEqual(["table", 2, 2, 1, 2]);
    expect(stamps(applyOps(turn.after, turn.undo.undo(turn.after)))).toEqual([["table", 2, 2, 0, 2], ["chair", 3, 3, 0, 1]]);
    const erase = step(base, (e) => e.erase(2, 2));
    expect(stamps(erase.after)).toEqual([["chair", 3, 3, 0, 1]]);
    expect(stamps(applyOps(erase.after, erase.undo.undo(erase.after)))).toEqual([["table", 2, 2, 0, 2], ["chair", 3, 3, 0, 1]]);
    // Turned again in another tab since: undo leaves it, rather than adding a second table.
    const again = applyOps(turn.after, { patch: [{ id: terrainId(SCENE, 0, 0), set: { stamps: [["table", 2, 2, 2, 2], ["chair", 3, 3, 0, 1]] } }] });
    expect(stamps(applyOps(again, turn.undo.undo(again)))).toEqual([["table", 2, 2, 2, 2], ["chair", 3, 3, 0, 1]]);
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

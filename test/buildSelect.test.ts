import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { terrainId } from "../src/shared/terrain";
import type { Stamp } from "../src/shared/terrain";
import type { GridSettings, Scene, TerrainItem } from "../src/shared/types";
import { BuildModel, BuildRenderer, doorSegment, drawStampAt, indexTerrain, refOf } from "../src/client/room/build";
import type { StampRef } from "../src/client/room/build";

const SCENE = "Scene1234567";
const noCells = ".".repeat(256);
const noEdges = ".".repeat(512);

function chunk(cx: number, cy: number, extra: Partial<TerrainItem> = {}): TerrainItem {
  return { id: terrainId(SCENE, cx, cy), sceneId: SCENE, kind: "terrain", z: 0, owner: "@gm", cx, cy, cells: noCells, edges: noEdges, stamps: [], ...extra };
}

function model(...items: TerrainItem[]): BuildModel {
  const m = new BuildModel();
  m.index = indexTerrain(items);
  return m;
}

/** The edge index of a cell's top ("t") or left ("l") edge within its chunk. */
const edge = (col: number, row: number, side: "t" | "l") => ((row % 16) * 16 + (col % 16)) * 2 + (side === "l" ? 1 : 0);

const at = (m: BuildModel, u: number, v: number, pad = 0) => m.stampsAtPoint(u, v, pad).map((h) => `${h.cx},${h.cy}:${h.i}`);

describe("picking objects with a click", () => {
  const m = model(
    // A table across the border of two chunks, a rug on it, and a chair anchored in the next chunk.
    chunk(0, 0, { stamps: [["table", 15, 3, 0, 2], ["rock", 15, 3, 0, 2]] }),
    chunk(1, 0, { stamps: [["chair", 0, 3, 0, 1]] }),
  );

  it("finds everything under the pointer, the one drawn on top first, across chunks", () => {
    expect(at(m, 16.5, 3.5)).toEqual(["1,0:0", "0,0:1", "0,0:0"]);
    expect(at(m, 15.5, 4.5)).toEqual(["0,0:1", "0,0:0"]);
    expect(m.stampAtPoint(16.5, 3.5, 0)).toMatchObject({ cx: 1, cy: 0, i: 0, stamp: ["chair", 0, 3, 0, 1] });
    expect(m.stampAtPoint(20, 20, 0)).toBeNull();
  });

  it("goes by the drawing: a small object isn't under the floor round it, and a turned one's corners are", () => {
    const small = model(chunk(0, 0, { stamps: [["rock", 5, 5, 0, 0.5]] }));
    expect(at(small, 5.5, 5.5)).toHaveLength(1);
    expect(at(small, 5.1, 5.1)).toEqual([]);
    // A finger reaches further.
    expect(at(small, 5.1, 5.1, 0.2)).toHaveLength(1);
    // 3 squares at 45 degrees, anchored in the next chunk: its corner reaches back into this one.
    const turned = model(chunk(1, 0, { stamps: [["table", 0, 5, 0, 3, 45]] }));
    expect(at(turned, 15.9, 6.5)).toEqual(["1,0:0"]);
    expect(at(turned, 15.9, 5.1)).toEqual([]);
    // And one anchored in this chunk reaching three cells on, into the next.
    const far = model(chunk(0, 0, { stamps: [["table", 13, 13, 0, 3, 45]] }));
    expect(at(far, 16.1, 14.5)).toEqual(["0,0:0"]);
    expect(at(far, 14.5, 16.1)).toEqual(["0,0:0"]);
  });
});

describe("picking objects with a box", () => {
  const m = model(
    chunk(0, 0, { stamps: [["table", 14, 2, 0, 2], ["chair", 3, 3, 0, 1]] }),
    chunk(1, 0, { stamps: [["chair", 0, 2, 0, 1]] }),
    chunk(0, -1, { stamps: [["rock", 15, 15, 0, 1]] }),
  );
  const box = (u0: number, v0: number, u1: number, v1: number) => m.stampsInBox(u0, v0, u1, v1).map((h) => h.stamp[0] + h.i);

  it("takes the objects whose middle is in it, in the order they're drawn, across chunks", () => {
    // The table's middle is at (15, 3), the chair's next to it at (16.5, 2.5), the rock's at (15.5, -0.5).
    expect(box(14.5, -1, 17, 3)).toEqual(["rock0", "table0", "chair0"]);
    // Corners either way round; edges count.
    expect(box(17, 3, 14.5, -1)).toEqual(["rock0", "table0", "chair0"]);
    expect(box(15, 3, 16, 3)).toEqual(["table0"]);
    // Over part of the table but not its middle: not the table.
    expect(box(13, 1, 14.9, 4)).toEqual([]);
  });
});

describe("finding picked objects again", () => {
  const stamps: Stamp[] = [["chair", 1, 1, 0, 1], ["table", 2, 2, 0, 2], ["table", 2, 2, 0, 2]];
  const refs = [0, 1, 2].map((i) => refOf({ cx: 0, cy: 0, i, stamp: stamps[i] }));

  it("finds them where they were, or nearby when another tab added or took away objects before them", () => {
    expect(model(chunk(0, 0, { stamps })).resolve(refs).refs).toEqual(refs);
    const shifted = model(chunk(0, 0, { stamps: [["rock", 9, 9, 0, 1], ...stamps] })).resolve(refs);
    expect(shifted.refs.map((r) => r.i)).toEqual([1, 2, 3]);
    expect(shifted.hits.map((h) => h.stamp)).toEqual(stamps);
    const three: Stamp[] = [["chair", 1, 1, 0, 1], ["bed", 4, 4, 0, 2], ["rock", 9, 9, 0, 1]];
    const picked = [1, 2].map((i) => refOf({ cx: 0, cy: 0, i, stamp: three[i] }));
    const fewer = model(chunk(0, 0, { stamps: three.slice(1) })).resolve(picked);
    expect(fewer.refs).toEqual([{ ...picked[0], i: 0 }, { ...picked[1], i: 1 }]);
    expect(fewer.hits.map((h) => h.stamp)).toEqual(three.slice(1));
  });

  it("finds two identical objects on one square as two, and one listed twice once", () => {
    expect(model(chunk(0, 0, { stamps })).resolve([refs[1], refs[2]]).refs.map((r) => r.i)).toEqual([1, 2]);
    expect(model(chunk(0, 0, { stamps })).resolve([refs[1], refs[1]]).refs.map((r) => r.i)).toEqual([1]);
    expect(model(chunk(0, 0, { stamps })).resolve([refs[0], refs[0]]).refs.map((r) => r.i)).toEqual([0]);
    // One of the two tables taken away elsewhere: only one is found.
    expect(model(chunk(0, 0, { stamps: stamps.slice(0, 2) })).resolve([refs[1], refs[2]]).refs.map((r) => r.i)).toEqual([1]);
  });

  it("leaves out one that has changed, or gone with its chunk", () => {
    const turned = model(chunk(0, 0, { stamps: [["chair", 1, 1, 1, 1], stamps[1]] })).resolve(refs.slice(0, 2));
    expect(turned.refs).toEqual([refs[1]]);
    expect(model().resolve(refs).refs).toEqual([]);
  });
});

describe("picking doors", () => {
  // A 3 by 3 stone room at (1, 1): a door at the top of (2, 1), a secret door at the left of
  // (1, 2), an opening at the top of (3, 1), and a door on the open line inside, left of (3, 2).
  const cells = [...noCells];
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) cells[r * 16 + c] = "s";
  const edges = [...noEdges];
  edges[edge(2, 1, "t")] = "d";
  edges[edge(3, 1, "t")] = "o";
  edges[edge(3, 2, "l")] = "D";
  const secret = { ...chunk(0, 0), id: "AbCdEfGhIjKl", hidden: true, edges: noEdges.slice(0, edge(1, 2, "l")) + "s" + noEdges.slice(edge(1, 2, "l") + 1) };
  const m = model(chunk(0, 0, { cells: cells.join(""), edges: edges.join("") }), secret);

  it("finds doors and secret doors near the pointer", () => {
    expect(m.doorAt(2.5, 1.05, 0.2)).toEqual({ col: 2, row: 1, side: "t", style: "door" });
    expect(m.doorAt(2.5, 0.9, 0.2)).toEqual({ col: 2, row: 1, side: "t", style: "door" });
    expect(m.doorAt(0.97, 2.5, 0.2)).toEqual({ col: 1, row: 2, side: "l", style: "secret" });
    expect(m.doorStyle({ col: 1, row: 2, side: "l" })).toBe("secret");
    expect(m.doorStyle({ col: 3, row: 2, side: "l" })).toBe("door");
  });

  it("finds nothing on a wall, an opening, or out of reach", () => {
    expect(m.doorAt(1.5, 1.02, 0.2)).toBeNull();
    expect(m.doorAt(3.5, 1, 0.2)).toBeNull();
    expect(m.doorAt(2.5, 1.4, 0.2)).toBeNull();
    expect(m.doorStyle({ col: 1, row: 1, side: "t" })).toBeNull();
    expect(m.doorStyle({ col: 3, row: 1, side: "t" })).toBeNull();
  });

  it("of the lines across and down, takes the nearer", () => {
    // By the corner where the inside door meets the room's middle row.
    const both = model(chunk(0, 0, { cells: cells.join(""), edges: Object.assign([...edges], { [edge(3, 2, "t")]: "d" }).join("") }));
    expect(both.doorAt(3.1, 2.05, 0.2)).toMatchObject({ col: 3, row: 2, side: "t" });
    expect(both.doorAt(3.05, 2.1, 0.2)).toMatchObject({ col: 3, row: 2, side: "l" });
    // The nearer line has no door: the other one, if it's within reach.
    expect(m.doorAt(3.1, 2.05, 0.2)).toMatchObject({ col: 3, row: 2, side: "l" });
  });

  it("knows where a door is drawn", () => {
    const g = { size: 100, offsetX: 10, offsetY: 20 } as GridSettings;
    const px = (s: Record<string, number>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));
    expect(px(doorSegment(g, { col: 2, row: 1, side: "t" }))).toEqual({ x0: 228, y0: 120, x1: 292, y1: 120 });
    expect(px(doorSegment(g, { col: 1, row: 2, side: "l" }))).toEqual({ x0: 110, y0: 238, x1: 110, y1: 302 });
  });
});

// ---------------------------------------------------------------- drawing

const fmt = (v: unknown): string => (typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : typeof v === "string" ? JSON.stringify(v) : "{}");

/** A canvas stand-in that writes down every call. */
function fakeContext(log: string[] = []): CanvasRenderingContext2D & { log: string[] } {
  return new Proxy({ log } as Record<string, unknown>, {
    get: (t, p) => (p in t ? t[p as string] : (...a: unknown[]) => log.push(`${String(p)}(${a.map(fmt).join(",")})`)),
    set: (t, p, v) => {
      log.push(`${String(p)}=${fmt(v)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & { log: string[] };
}

const g = globalThis as Record<string, unknown>;
const saved = { Path2D: g.Path2D };
beforeAll(() => {
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
    rect() {}
  };
});
afterAll(() => Object.assign(g, saved));

const scene = { id: SCENE, width: 32 * 70, height: 10 * 70, grid: { type: "square", size: 70, offsetX: 0, offsetY: 0 } } as unknown as Scene;

/** The objects drawn straight onto the board, as where the canvas was moved to for each (to be turned and scaled). */
function drawn(r: BuildRenderer): string[] {
  const c = fakeContext();
  r.draw(c, scene, { x0: 0, y0: 0, x1: scene.width, y1: scene.height }, 2, 2, true);
  return c.log.filter((l, i, log) => l.startsWith("translate(") && log[i - 1] === "save()" && log[i + 1].startsWith("rotate(") && log[i + 2].startsWith("scale("));
}

describe("hiding objects while they're dragged", () => {
  const build = (stamps0: Stamp[], stamps1: Stamp[] = []) => [chunk(0, 0, { stamps: stamps0 }), chunk(1, 0, { stamps: stamps1 })];
  const table: Stamp = ["table", 2, 2, 0, 2];
  const chair: Stamp = ["chair", 5, 5, 0, 1];
  const rock: Stamp = ["rock", 1, 1, 0, 1];

  it("doesn't draw them where they are until they're shown again", () => {
    const r = new BuildRenderer();
    r.update(build([table, chair], [rock]));
    expect(drawn(r)).toEqual(["translate(210,210)", "translate(385,385)", "translate(1225,105)"]);
    const refs: StampRef[] = [refOf({ cx: 0, cy: 0, i: 0, stamp: table }), refOf({ cx: 1, cy: 0, i: 0, stamp: rock })];
    r.hideStamps(refs);
    expect(drawn(r)).toEqual(["translate(385,385)"]);
    r.hideStamps([]);
    expect(drawn(r)).toHaveLength(3);
  });

  it("finds them again when another tab changes their chunk, and stops hiding those that have gone", () => {
    const r = new BuildRenderer();
    r.update(build([table, chair], [rock]));
    r.hideStamps([refOf({ cx: 0, cy: 0, i: 0, stamp: table }), refOf({ cx: 1, cy: 0, i: 0, stamp: rock })]);
    // Another tab puts a crate before the table and takes the rock away.
    r.update(build([["crate", 9, 9, 0, 1], table, chair], []));
    expect(r.model.hidden).toEqual([{ cx: 0, cy: 0, i: 1, key: table.join() }]);
    expect(drawn(r)).toEqual(["translate(665,665)", "translate(385,385)"]);
    r.reset();
    expect(r.model.hidden).toEqual([]);
  });
});

describe("drawing an object where it stands", () => {
  it("draws it just as the build does, at any angle and size", () => {
    for (const stamp of [["table", 2, 2, 1, 2], ["table", 2, 2, 1, 1.5, 15], ["rock", 3, 4, 0, 0.5, 85]] as Stamp[]) {
      const r = new BuildRenderer();
      r.update([chunk(0, 0, { stamps: [stamp] })]);
      const board = fakeContext();
      r.draw(board, scene, { x0: 0, y0: 0, x1: scene.width, y1: scene.height }, 2, 2, true);
      const alone = fakeContext();
      drawStampAt(alone, scene.grid, { id: stamp[0], col: stamp[1], row: stamp[2], deg: stamp[3] * 90 + (stamp[5] ?? 0), size: stamp[4] }, null);
      const from = board.log.indexOf("save()", board.log.findIndex((l) => l.startsWith("clip(")) + 1);
      expect(board.log.slice(from, from + alone.log.length)).toEqual(alone.log);
    }
  });

  it("turns and sizes it about the middle of its block", () => {
    const c = fakeContext();
    drawStampAt(c, scene.grid, { id: "table", col: 2, row: 2, deg: 105, size: 1.5 }, null);
    expect(c.log.slice(0, 4)).toEqual(["save()", "translate(210,210)", `rotate(${fmt(Math.PI / 2 + Math.PI / 12)})`, "scale(105,105)"]);
  });
});

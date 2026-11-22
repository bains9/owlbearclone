import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyOps } from "../src/shared/ops";
import type { ItemMap } from "../src/shared/ops";
import { sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import { PLAIN_WALL, WALL_TYPE_CHARS, decodeWallTypes, encodeWallTypes, inChunk, sceneWallType, terrainId } from "../src/shared/terrain";
import type { Scene, TerrainItem } from "../src/shared/types";
import {
  BuildEdit,
  BuildModel,
  BuildRenderer,
  buildUndo,
  edgeKey,
  indexTerrain,
  repaintWall,
  saveWallTypes,
  sceneTerrain,
  setPortal,
  setWall,
} from "../src/client/room/build";
import { wallsOf } from "../src/client/room/view3dModel";
import { parseDungeonPayload } from "../src/client/dd/fromDungeon";
import { GUIDE } from "../src/client/guide";

// Each built wall keeps the look it was built with (15 November 2026): Build > Walls' picker is
// the look for walls built from then on, a map from before looks as it did, and Repaint changes
// walls already built on purpose (shared/terrain.ts WALL_TYPE_CHARS, room/build.ts).

const SCENE = "Scene1234567";
const STONE = "wall-stone";
const BRICK = "wall-brick";
const IRON = "wall-iron";
const noCells = ".".repeat(256);
const noEdges = ".".repeat(512);

function chunk(cx: number, cy: number, extra: Partial<TerrainItem> = {}): TerrainItem {
  return { id: terrainId(SCENE, cx, cy), sceneId: SCENE, kind: "terrain", z: 0, owner: "@gm", cx, cy, cells: noCells, edges: noEdges, stamps: [], ...extra };
}

/** A chunk's cells with a stone room (walls round it) over [c0, c1] x [r0, r1]. */
function room(c0: number, r0: number, c1: number, r1: number, cells = noCells): string {
  const a = [...cells];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) a[inChunk(r) * 16 + inChunk(c)] = "s";
  return a.join("");
}

function edgesWith(list: [number, number, "t" | "l", string][]): string {
  const a = [...noEdges];
  for (const [col, row, side, ch] of list) a[(inChunk(row) * 16 + inChunk(col)) * 2 + (side === "l" ? 1 : 0)] = ch;
  return a.join("");
}

const toMap = (items: TerrainItem[]): ItemMap => Object.fromEntries(items.map((i) => [i.id, i]));
const terrainOf = (items: ItemMap) => sceneTerrain(items, SCENE);

/** A map built before walls had looks: a stone room from (1, 1) to (4, 3), and a wall drawn by hand down x = 8. */
function oldBuild(): ItemMap {
  return toMap([
    chunk(0, 0, {
      cells: room(1, 1, 4, 3),
      edges: edgesWith([
        [8, 1, "l", "w"],
        [8, 2, "l", "w"],
        [8, 3, "l", "w"],
      ]),
    }),
  ]);
}

function model(items: ItemMap): BuildModel {
  const m = new BuildModel();
  m.index = indexTerrain(terrainOf(items));
  return m;
}

/** Every built wall's look as the scene shows it: its own, or the scene's. */
function looks(items: ItemMap, scene: Pick<Scene, "wallTexture">): string[] {
  const lines = model(items).sightLines();
  return [...new Set(lines.wallTypes.map((t) => t || sceneWallType(scene)))].sort();
}

/** The look of the wall on one edge, as the scene shows it. */
function lookAt(items: ItemMap, scene: Pick<Scene, "wallTexture">, col: number, row: number, side: "t" | "l"): string {
  return model(items).wallType(col, row, side) || sceneWallType(scene);
}

const apply = (items: ItemMap, edit: BuildEdit) => applyOps(items, edit.ops());

describe("a map built before walls had looks", () => {
  it("has none of its own, so every wall wears the scene's, as it did", () => {
    const items = oldBuild();
    expect(model(items).sightLines().wallTypes.every((t) => t === "")).toBe(true);
    expect(looks(items, { wallTexture: STONE })).toEqual([STONE]);
    expect(looks(items, {})).toEqual([PLAIN_WALL]);
  });

  it("keeps its walls' look when the picker changes: they're given the one they had first", () => {
    const items = oldBuild();
    const saved = applyOps(items, saveWallTypes(items, SCENE, STONE));
    // The scene's look is brick now; the walls already built are stone, as they were.
    expect(looks(saved, { wallTexture: BRICK })).toEqual([STONE]);
    expect(lookAt(saved, { wallTexture: BRICK }, 2, 1, "t")).toBe(STONE);
    expect(lookAt(saved, { wallTexture: BRICK }, 8, 2, "l")).toBe(STONE);
    // Plain walls keep plain the same way.
    const plain = applyOps(items, saveWallTypes(items, SCENE, PLAIN_WALL));
    expect(looks(plain, { wallTexture: IRON })).toEqual([PLAIN_WALL]);
  });

  it("is saved only once: walls that have a look aren't given another", () => {
    const items = applyOps(oldBuild(), saveWallTypes(oldBuild(), SCENE, STONE));
    expect(saveWallTypes(items, SCENE, BRICK)).toEqual({});
  });

  it("draws exactly as before the picker changed", () => {
    const items = oldBuild();
    const before = drawLog(items, { wallTexture: STONE });
    expect(before.filter((l) => l.startsWith("stroke(")).length).toBe(3);
    const saved = applyOps(items, saveWallTypes(items, SCENE, STONE));
    expect(drawLog(saved, { wallTexture: BRICK })).toEqual(before);
  });
});

describe("walls built after the picker changes", () => {
  const saved = () => applyOps(oldBuild(), saveWallTypes(oldBuild(), SCENE, STONE));

  it("wear the new look; those already built keep theirs", () => {
    let items = saved();
    // A wall drawn now, and a room painted now, with the picker on brick.
    const edit = new BuildEdit(items, SCENE, BRICK);
    setWall(edit, 10, 1, "l", "add");
    for (let r = 6; r <= 8; r++) for (let c = 1; c <= 3; c++) edit.setCell(c, r, "s");
    items = apply(items, edit);
    const scene = { wallTexture: BRICK };
    expect(lookAt(items, scene, 10, 1, "l")).toBe(BRICK);
    expect(lookAt(items, scene, 1, 6, "l")).toBe(BRICK);
    expect(lookAt(items, scene, 2, 9, "t")).toBe(BRICK);
    expect(lookAt(items, scene, 2, 1, "t")).toBe(STONE);
    expect(lookAt(items, scene, 8, 2, "l")).toBe(STONE);
    // And picking iron later changes none of them.
    const again = applyOps(items, saveWallTypes(items, SCENE, BRICK));
    expect(looks(again, { wallTexture: IRON })).toEqual([BRICK, STONE]);
  });

  it("extend a room: the new part's walls in the new look, the old part's as they were", () => {
    let items = saved();
    const edit = new BuildEdit(items, SCENE, BRICK);
    for (let r = 1; r <= 3; r++) edit.setCell(5, r, "s");
    items = apply(items, edit);
    const scene = { wallTexture: BRICK };
    expect(lookAt(items, scene, 2, 1, "t")).toBe(STONE);
    expect(lookAt(items, scene, 1, 2, "l")).toBe(STONE);
    expect(lookAt(items, scene, 5, 1, "t")).toBe(BRICK);
    expect(lookAt(items, scene, 6, 2, "l")).toBe(BRICK);
    // The wall that was between them has gone, and so has its look.
    expect(model(items).state(5, 2, "l")).toBe(0);
  });

  it("painting a room's floor again leaves its walls' look alone", () => {
    let items = saved();
    const edit = new BuildEdit(items, SCENE, BRICK);
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 4; c++) edit.setCell(c, r, "w");
    items = apply(items, edit);
    expect(looks(items, { wallTexture: BRICK })).toEqual([STONE]);
  });

  it("a door cut into a wall sits in its look, and the wall keeps it when the door goes", () => {
    let items = saved();
    let edit = new BuildEdit(items, SCENE, BRICK);
    setPortal(edit, 8, 2, "l", "door");
    items = apply(items, edit);
    expect(lookAt(items, { wallTexture: BRICK }, 8, 2, "l")).toBe(STONE);
    edit = new BuildEdit(items, SCENE, BRICK);
    setPortal(edit, 8, 2, "l", "wall");
    items = apply(items, edit);
    expect(lookAt(items, { wallTexture: BRICK }, 8, 2, "l")).toBe(STONE);
  });
});

describe("secrets", () => {
  it("a secret door looks like the wall it's in", () => {
    // A brick wall by hand, then the picker on iron and a gap in it made a door, then a secret door.
    let items = toMap([chunk(0, 0, { edges: edgesWith([[8, 1, "l", "w"], [8, 3, "l", "w"]]) })]);
    items = applyOps(items, saveWallTypes(items, SCENE, BRICK));
    let edit = new BuildEdit(items, SCENE, IRON);
    setPortal(edit, 8, 2, "l", "door");
    items = apply(items, edit);
    // A door in the gap: its posts in the wall's look.
    expect(lookAt(items, { wallTexture: IRON }, 8, 2, "l")).toBe(BRICK);
    edit = new BuildEdit(items, SCENE, IRON);
    setPortal(edit, 8, 2, "l", "secret");
    items = apply(items, edit);
    expect(lookAt(items, { wallTexture: IRON }, 8, 2, "l")).toBe(BRICK);
    // The players' chunk has only the wall and its look; the secret is in the hidden chunk, which never has a look.
    const hidden = Object.values(items).filter((i) => i.kind === "terrain" && i.hidden) as TerrainItem[];
    expect(hidden).toHaveLength(1);
    expect(hidden[0].wt).toBeUndefined();
  });

  it("a hidden chunk with walls' looks is refused", () => {
    const raw = { ...chunk(0, 0), id: "hiddenAbcdefgh", hidden: true, edges: edgesWith([[2, 2, "t", "s"]]), ...encodeWallTypes(types([[300, BRICK]]))! };
    expect(sanitizeItem(raw, "@gm")).toBeNull();
  });
});

describe("Repaint", () => {
  it("changes only the walls dragged over", () => {
    let items = applyOps(oldBuild(), saveWallTypes(oldBuild(), SCENE, STONE));
    const edit = new BuildEdit(items, SCENE, IRON);
    repaintWall(edit, 2, 1, "t", IRON);
    repaintWall(edit, 8, 2, "l", IRON);
    // A bare line has nothing to repaint.
    repaintWall(edit, 12, 5, "t", IRON);
    items = apply(items, edit);
    const scene = { wallTexture: IRON };
    expect(lookAt(items, scene, 2, 1, "t")).toBe(IRON);
    expect(lookAt(items, scene, 3, 1, "t")).toBe(STONE);
    expect(lookAt(items, scene, 8, 2, "l")).toBe(IRON);
    expect(lookAt(items, scene, 8, 1, "l")).toBe(STONE);
    expect(model(items).state(12, 5, "t")).toBe(0);
  });

  it("is undone and redone like any build change", () => {
    const items = applyOps(oldBuild(), saveWallTypes(oldBuild(), SCENE, STONE));
    const edit = new BuildEdit(items, SCENE, IRON);
    repaintWall(edit, 2, 1, "t", IRON);
    const ops = edit.ops();
    const after = applyOps(items, ops);
    const undo = buildUndo(items, SCENE, ops);
    const back = applyOps(after, undo.undo(after));
    expect(lookAt(back, { wallTexture: IRON }, 2, 1, "t")).toBe(STONE);
    const again = applyOps(back, undo.redo(back));
    expect(lookAt(again, { wallTexture: IRON }, 2, 1, "t")).toBe(IRON);
  });

  it("shows in the draft as it's dragged, and leaves a secret door secret", () => {
    const m = model(applyOps(oldBuild(), saveWallTypes(oldBuild(), SCENE, STONE)));
    m.newWallType = IRON;
    m.draft = { cells: new Map(), walls: new Map([[edgeKey(2, 1, "t"), "repaint"]]) };
    expect(m.wallType(2, 1, "t")).toBe(IRON);
    expect(m.edge(2, 1, "t")).toBe(".");
  });
});

/** Looks at places (index, look), the rest none. */
function types(list: [number, string][]): string[] {
  const out = Array<string>(WALL_TYPE_CHARS).fill("");
  for (const [i, t] of list) out[i] = t;
  return out;
}

describe("the chunk's wt and wpal", () => {
  it("encode and decode each place's look", () => {
    const t = types([[3, STONE], [300, BRICK], [767, PLAIN_WALL]]);
    const enc = encodeWallTypes(t)!;
    expect(enc.wt).toHaveLength(768);
    expect(enc.wpal).toEqual([STONE, BRICK, PLAIN_WALL]);
    expect(decodeWallTypes(enc)).toEqual(t);
    expect(encodeWallTypes(types([]))).toEqual({ wt: "", wpal: [] });
  });

  it("are checked by the server: a pair, every look a wall look, encoded as the browser does", () => {
    const enc = encodeWallTypes(types([[3, STONE]]))!;
    expect(sanitizeItem({ ...chunk(0, 0), ...enc }, "@gm")).toMatchObject(enc);
    expect(sanitizeItem({ ...chunk(0, 0), wt: enc.wt }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), ...enc, wpal: ["marble"] }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...chunk(0, 0), wt: enc.wt.replace("0", "1"), wpal: [STONE, BRICK] }, "@gm")).toBeNull();
    // A chunk from before has neither, as it always had.
    expect(sanitizeItem(chunk(0, 0), "@gm")).not.toHaveProperty("wt");
    const item = chunk(0, 0);
    expect(sanitizeSet(item, enc)).toEqual(enc);
    expect(sanitizeSet(item, { wt: "", wpal: [] })).toEqual({ wt: "", wpal: [] });
    expect(sanitizeSet(item, { wt: enc.wt })).toBeNull();
  });
});

describe("the 3D view", () => {
  it("gets each built wall's own look", () => {
    let items = applyOps(oldBuild(), saveWallTypes(oldBuild(), SCENE, STONE));
    const edit = new BuildEdit(items, SCENE, IRON);
    repaintWall(edit, 8, 2, "l", IRON);
    items = apply(items, edit);
    const lines = model(items).sightLines();
    const w = wallsOf(undefined, { ...lines, wallTypes: lines.wallTypes, windowTypes: lines.windowTypes }, { size: 1, offsetX: 0, offsetY: 0 });
    expect(w.builtTex).toHaveLength(w.built.length);
    const at = (x: number, y: number) => w.builtTex![w.built.findIndex((s) => s[0] === x && s[1] === y && s[2] === x)];
    expect(at(8, 2)).toBe(IRON);
    expect(at(8, 1)).toBe(STONE);
  });
});

describe("a map from Dungeon", () => {
  // Made by Dungeon's own code (its io/payload.ts): a keep from before walls had styles (stone),
  // then the picker set to brick and a wing added, a wall drawn in iron, and a door in the brick part.
  async function fixture(): Promise<string> {
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    return fs.readFileSync(new URL("./fixtures/dungeon-wall-styles.json", import.meta.url), "utf8");
  }

  it("comes in with each wall in its own texture, a room's wall split where its style changes", async () => {
    const { map } = parseDungeonPayload(await fixture());
    const walls = map.world.levels[0].walls.filter((w) => w.type !== 2);
    const name = (w: (typeof walls)[number]) => w.texture?.segments.at(-1);
    expect(walls.map(name)).toEqual(["wall-brick", "wall-stone", "wall-iron"]);
    // The room's two parts meet end to end, round the whole outline.
    const [brick, stone] = walls;
    expect([...stone.points.slice(-2)]).toEqual([...brick.points.slice(0, 2)]);
    expect([...brick.points.slice(-2)]).toEqual([...stone.points.slice(0, 2)]);
    // The door is in the brick part, where Dungeon put it.
    expect(brick.portals).toHaveLength(1);
    const d = brick.portals[0];
    const k = Math.floor(d.wallDistance!);
    const t = d.wallDistance! - k;
    const x = brick.points[k * 2] + (brick.points[k * 2 + 2] - brick.points[k * 2]) * t;
    const y = brick.points[k * 2 + 1] + (brick.points[k * 2 + 3] - brick.points[k * 2 + 1]) * t;
    expect([x, y]).toEqual([d.position.x, d.position.y]);
  });

  it("from a Dungeon before, comes in with every wall in the map's style, as it did", async () => {
    const payload = JSON.parse(await fixture());
    for (const w of payload.shapes.walls) {
      delete w.style;
      delete w.styles;
    }
    const { map } = parseDungeonPayload(JSON.stringify(payload));
    const walls = map.world.levels[0].walls.filter((w) => w.type !== 2);
    expect(walls.map((w) => w.texture?.segments.at(-1))).toEqual(["wall-brick", "wall-brick"]);
    expect(walls[0].loop).toBe(true);
  });
});

describe("the guide", () => {
  it("says so in What's new and under Walls, with the bar's words", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[5].title).toBe("Walls keep the look they're built in (15 November 2026)");
    expect(news.parts[5].steps.join(" ")).toContain("**Repaint**");
    const walls = JSON.stringify(GUIDE.find((s) => s.id === "building-maps"));
    expect(walls).toContain("Pick **Walls**, then **Add**, **Remove** or **Repaint**.");
    expect(walls).not.toContain("It's for the whole scene");
  });
});

// ---------------------------------------------------------------- drawing

const fmt = (v: unknown): string =>
  typeof v === "number" ? String(Math.round(v * 1000) / 1000) : typeof v === "object" && v && "desc" in v ? (v as { desc: () => string }).desc() : JSON.stringify(v);

class FakePath {
  ops: string[] = [];
  desc = () => `path{${this.ops.join(";")}}`;
  constructor() {
    return new Proxy(this, {
      get: (t, p) => (p in t ? t[p as keyof FakePath] : (...a: unknown[]) => t.ops.push(`${String(p)}(${a.map(fmt).join(",")})`)),
    });
  }
}

function fakeContext(log: string[]): CanvasRenderingContext2D {
  return new Proxy({} as Record<string, unknown>, {
    get: (t, p) => {
      if (p in t) return t[p as string];
      if (p === "createPattern") return () => ({ setTransform: () => undefined, desc: () => "pattern" });
      return (...a: unknown[]) => log.push(`${String(p)}(${a.map(fmt).join(",")})`);
    },
    set: (t, p, v) => {
      log.push(`${String(p)}=${fmt(v)}`);
      t[p as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const g = globalThis as Record<string, unknown>;
const saved = { Path2D: g.Path2D, DOMMatrix: g.DOMMatrix, document: g.document };
beforeAll(() => {
  g.Path2D = FakePath;
  g.DOMMatrix = class {
    desc = () => "matrix";
  };
});
afterAll(() => Object.assign(g, saved));

/** What drawing the walls does, zoomed in (walls are always drawn straight onto the board). */
function drawLog(items: ItemMap, look: Pick<Scene, "wallTexture">): string[] {
  const scene = { id: SCENE, width: 16 * 70, height: 16 * 70, grid: { type: "square", size: 70, offsetX: 0, offsetY: 0 }, ...look } as unknown as Scene;
  const r = new BuildRenderer();
  r.update(terrainOf(items));
  const log: string[] = [];
  (r as unknown as { drawWalls: (...a: unknown[]) => void }).drawWalls(fakeContext(log), scene, 0, 0, 16, 16, 2, true);
  return log;
}

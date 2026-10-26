import { describe, expect, it } from "vitest";
import { applyOps } from "../src/shared/ops";
import type { ItemMap } from "../src/shared/ops";
import { DUNGEON_MATERIALS } from "../src/shared/dungeonCatalog";
import { sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import { MAX_TEXTURES_PER_CHUNK, decodeTextures, encodeTextures, isTextureId, terrainId, texturesOk } from "../src/shared/terrain";
import type { TerrainItem } from "../src/shared/types";
import { afterAll, beforeAll } from "vitest";
import { BuildEdit, BuildModel, BuildRenderer, buildUndo, cellKey, computeExposure, indexTerrain, paintCode } from "../src/client/room/build";
import { TEXTURE_GROUPS, overlayRuleFor, textureChoice, textureFloor, textureKind } from "../src/client/room/dungeonTextures";
import { FLOOR_GROUPS, floorCount, floorName, isFloorFor, searchFloors } from "../src/client/ui/floorGroups";

// Dungeon's floor and ground textures on built maps: a texture per cell beside the cell's
// character, which still says what the cell is.

const SCENE = "Scene1234567";
const noCells = ".".repeat(256);
const noEdges = ".".repeat(512);
const at = (col: number, row: number) => row * 16 + col;

function chunk(extra: Partial<TerrainItem> = {}): TerrainItem {
  return { id: terrainId(SCENE, 0, 0), sceneId: SCENE, kind: "terrain", z: 0, owner: "@gm", cx: 0, cy: 0, cells: noCells, edges: noEdges, stamps: [], ...extra };
}

const texturesIn = (items: ItemMap) => decodeTextures((items[terrainId(SCENE, 0, 0)] as TerrainItem | undefined) ?? {});

describe("a chunk's textures", () => {
  it("are Dungeon's floor and ground textures, not its walls", () => {
    expect(isTextureId("meadow")).toBe(true);
    expect(isTextureId("flagstone")).toBe(true);
    expect(isTextureId("wall-stone")).toBe(false);
    expect(isTextureId("__proto__")).toBe(false);
    expect(DUNGEON_MATERIALS.filter((m) => m.group !== "wall").every((m) => isTextureId(m.id))).toBe(true);
  });

  it("encode as an index a cell into a palette in order of first use, and back", () => {
    const cells = Array<string>(256).fill("");
    cells[at(3, 0)] = "meadow";
    cells[at(4, 0)] = "flagstone";
    cells[at(5, 0)] = "meadow";
    const enc = encodeTextures(cells)!;
    expect(enc.pal).toEqual(["meadow", "flagstone"]);
    expect(enc.tex.slice(0, 6)).toBe("...010");
    expect(decodeTextures(enc)).toEqual(cells);
    expect(texturesOk(enc.tex, enc.pal)).toBe(true);
    expect(encodeTextures(Array<string>(256).fill(""))).toEqual({ tex: "", pal: [] });
    expect(decodeTextures({ tex: "", pal: [] })).toBeNull();
  });

  it("hold at most a chunk's worth of different textures", () => {
    const ids = DUNGEON_MATERIALS.filter((m) => m.group !== "wall").map((m) => m.id);
    expect(ids.length).toBeGreaterThan(MAX_TEXTURES_PER_CHUNK);
    const cells = Array.from({ length: 256 }, (_, i) => ids[i % ids.length]);
    expect(encodeTextures(cells)).toBeNull();
  });

  it("are checked by the server: as a pair, every index in the palette, the palette as encoded", () => {
    const enc = encodeTextures(["meadow", "flagstone", ...Array<string>(254).fill("")])!;
    const ok = sanitizeItem(chunk({ cells: "gs" + noCells.slice(2), ...enc }), "@gm") as TerrainItem;
    expect(ok).toMatchObject({ tex: enc.tex, pal: enc.pal });
    // Without textures, stored as it always was.
    expect("tex" in (sanitizeItem(chunk(), "@gm") as TerrainItem)).toBe(false);
    for (const bad of [
      { tex: enc.tex }, // no palette
      { tex: "10" + enc.tex.slice(2), pal: enc.pal }, // not in order of first use
      { tex: enc.tex, pal: ["meadow", "flagstone", "moss"] }, // one never used
      { tex: enc.tex, pal: ["meadow", "wall-stone"] }, // a wall
      { tex: "2" + enc.tex.slice(1), pal: enc.pal }, // an index past the palette
      { tex: enc.tex.slice(1), pal: enc.pal }, // too short
    ]) {
      expect(sanitizeItem(chunk({ cells: "gs" + noCells.slice(2), ...bad } as Partial<TerrainItem>), "@gm"), JSON.stringify(bad).slice(0, 60)).toBeNull();
    }
    // A patch: the pair, or nothing; taking them away is "" and [].
    const item = chunk({ cells: "gs" + noCells.slice(2), ...enc });
    expect(sanitizeSet(item, { tex: "", pal: [] })).toEqual({ tex: "", pal: [] });
    expect(sanitizeSet(item, { tex: "" })).toBeNull();
    expect(sanitizeSet(item, { tex: enc.tex, pal: ["moss", "flagstone"] })).toEqual({ tex: enc.tex, pal: ["moss", "flagstone"] });
    // Never on a hidden (secret door) chunk.
    expect(sanitizeItem({ ...chunk({ ...enc }), id: "abcdefghijkl", hidden: true }, "@gm")).toBeNull();
  });
});

describe("painting with a texture", () => {
  it("keeps the cell's character and puts the texture beside it, and Tabletop's own floor takes it off", () => {
    const e = new BuildEdit({}, SCENE);
    e.setCell(1, 1, "g", "meadow");
    e.setCell(2, 1, "s", "flagstone");
    e.setCell(3, 1, "g");
    const after = applyOps({}, e.ops());
    const t = after[terrainId(SCENE, 0, 0)] as TerrainItem;
    expect(t.cells.slice(at(1, 1), at(4, 1))).toBe("gsg");
    expect(texturesIn(after)!.slice(at(1, 1), at(4, 1))).toEqual(["meadow", "flagstone", ""]);
    // Painting plain grass over the meadow, and erasing the flagstones, leaves no textures.
    const e2 = new BuildEdit(after, SCENE);
    e2.setCell(1, 1, "g");
    e2.erase(2, 1);
    const ops = e2.ops();
    expect(ops.patch?.[0].set).toMatchObject({ tex: "", pal: [] });
    expect(texturesIn(applyOps(after, ops))).toBeNull();
  });

  it("is undone and redone, leaving alone a cell another tab has painted since", () => {
    const step = (items: ItemMap, change: (e: BuildEdit) => void) => {
      const e = new BuildEdit(items, SCENE);
      change(e);
      const ops = e.ops();
      return { after: applyOps(items, ops), undo: buildUndo(items, SCENE, ops, e.pairs()) };
    };
    const a = step({}, (e) => {
      e.setCell(0, 0, "g", "meadow");
      e.setCell(1, 0, "g", "meadow");
    });
    const b = step(a.after, (e) => e.setCell(1, 0, "g", "moss"));
    const undone = applyOps(b.after, a.undo.undo(b.after));
    expect(texturesIn(undone)?.slice(0, 2)).toEqual(["", "moss"]);
    const redone = applyOps(undone, a.undo.redo(undone));
    expect(texturesIn(redone)?.slice(0, 2)).toEqual(["meadow", "moss"]);
  });

  it("shows in the draft before it's committed", () => {
    const m = new BuildModel();
    m.index = indexTerrain([chunk({ cells: "g" + noCells.slice(1), ...encodeTextures(["moss", ...Array<string>(255).fill("")])! })]);
    expect([m.cell(0, 0), m.texture(0, 0)]).toEqual(["g", "moss"]);
    m.draft = { cells: new Map([[cellKey(0, 0), paintCode("g", "meadow")]]), walls: new Map() };
    expect([m.cell(0, 0), m.texture(0, 0), m.storedTexture(0, 0)]).toEqual(["g", "meadow", "moss"]);
    m.draft.cells.set(cellKey(0, 0), paintCode("g", ""));
    expect([m.cell(0, 0), m.texture(0, 0)]).toEqual(["g", ""]);
    expect(paintCode(".", "meadow")).toBe(".");
  });
});

const g = globalThis as Record<string, unknown>;
const saved = { Path2D: g.Path2D };
beforeAll(() => {
  g.Path2D = class {
    rect() {}
  };
});
afterAll(() => Object.assign(g, saved));

describe("what a texture paints", () => {
  it("in the Building tool, a room's floor; in the Terrain tool, ground", () => {
    expect(textureFloor("wood-parquet", "building", true)).toBe("w");
    expect(textureFloor("carpet-blue", "building", true)).toBe("w");
    expect(textureFloor("marble-white", "building", true)).toBe("s");
    expect(textureFloor("cobble-mossy", "building", false)).toBe("S");
    expect(textureFloor("cave-brown", "building", true)).toBe("d");
    expect(textureFloor("meadow", "terrain", true)).toBe("g");
    expect(textureFloor("desert-sand", "terrain", true)).toBe("g");
    expect(textureFloor("water", "terrain", true)).toBe("a");
    expect(textureFloor("lava", "terrain", true)).toBe("l");
    expect(textureKind("heather")).toBe("grass");
    expect(textureKind("ash")).toBe("earth");
  });

  it("in a season, ground keeps its texture with the season laid over it", () => {
    expect(overlayRuleFor("g", "meadow", "winter")).toBe("S");
    expect(overlayRuleFor("g", "meadow", "autumn")).toBe("g");
    expect(overlayRuleFor("g", "meadow", "spring")).toBe("");
    expect(overlayRuleFor("g", "pebbles", "spring")).toBe("S");
    expect(overlayRuleFor("S", "flagstone", "winter")).toBe("S");
  });

  it("textured ground is outdoors as grass is, and a textured room indoors", () => {
    const m = new BuildModel();
    const cells = Array<string>(256).fill("");
    cells[0] = "desert-sand";
    cells[5] = "marble-white";
    m.index = indexTerrain([chunk({ cells: "gSSSSssss" + noCells.slice(9), ...encodeTextures(cells)! })]);
    const e = computeExposure(m);
    expect(e.dist(0, 0)).toBe(0);
    expect(e.dist(5, 0)).toBeGreaterThan(6);
  });

  it("is drawn from its own pattern, with no seams between cells of the same texture", () => {
    // Outside a browser a texture is its swatch colour: what each fill is drawn with is logged.
    const fills: string[] = [];
    let style = "";
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get(_, name) {
        if (name === "fill") return () => fills.push(style);
        return () => undefined;
      },
      set(_, name, v) {
        if (name === "fillStyle") style = String(v);
        return true;
      },
    });
    const r = new BuildRenderer();
    const cells = Array<string>(256).fill("");
    cells[0] = cells[1] = "meadow";
    cells[2] = "moss";
    r.update([chunk({ cells: "ggg" + noCells.slice(3), ...encodeTextures(cells)! })]);
    const drawFloors = (r as unknown as { drawFloors(c: CanvasRenderingContext2D, s: unknown, ...a: number[]): void }).drawFloors.bind(r);
    drawFloors(ctx, { grid: { size: 70, offsetX: 0, offsetY: 0 } }, 0, 0, 2, 0);
    // One fill for the two meadow cells, one for the moss.
    expect(fills).toEqual(["#5a8a3a", "#4a6a2a"]);
  });
});

describe("the floor picker", () => {
  it("offers Tabletop's floors first, then Dungeon's textures for that tool", () => {
    expect(FLOOR_GROUPS.building[0]).toEqual({ name: "Tabletop", ids: ["s", "w", "d"] });
    expect(FLOOR_GROUPS.terrain[0]).toEqual({ name: "Tabletop", ids: ["g", "a", "l"] });
    const building = FLOOR_GROUPS.building.flatMap((g) => g.ids);
    const terrain = FLOOR_GROUPS.terrain.flatMap((g) => g.ids);
    // Every texture is offered somewhere, and walls nowhere; water and lava only as terrain.
    for (const m of DUNGEON_MATERIALS) {
      const id = `t:${m.id}`;
      if (m.group === "wall") expect(building.includes(id as never) || terrain.includes(id as never), m.id).toBe(false);
      else expect(building.includes(id as never) || terrain.includes(id as never), m.id).toBe(true);
    }
    expect(building).not.toContain("t:water");
    expect(terrain).toContain("t:water");
    expect(floorCount("building") + floorCount("terrain")).toBe(6 + DUNGEON_MATERIALS.filter((m) => m.group === "floor").length + 2 * DUNGEON_MATERIALS.filter((m) => m.group === "terrain").length - 2);
    for (const g of [...TEXTURE_GROUPS.building, ...TEXTURE_GROUPS.terrain]) expect(g.ids.length, g.name).toBeGreaterThan(0);
  });

  it("names, finds and checks them", () => {
    expect(floorName("s")).toBe("Stone");
    expect(floorName("t:meadow")).toBe("Meadow");
    expect(textureChoice("t:meadow")).toBe("meadow");
    expect(textureChoice("t:wall-stone")).toBeNull();
    expect(textureChoice("g")).toBeNull();
    expect(searchFloors("terrain", "sand")).toEqual(expect.arrayContaining(["t:beach-sand", "t:dunes-sand", "t:desert-sand"]));
    expect(searchFloors("building", "marble").length).toBeGreaterThanOrEqual(3);
    expect(isFloorFor("terrain", "t:water")).toBe(true);
    expect(isFloorFor("building", "t:water")).toBe(false);
    expect(isFloorFor("building", "g")).toBe(false);
  });
});

describe("a scene's wall texture", () => {
  const scene = { id: "Scene1234567", name: "S", order: 0, mapAssetId: null, width: 700, height: 700, background: "#000", fogCover: false, createdAt: 1 };
  it("is one of Dungeon's wall textures, kept until it's changed, and null goes back to plain walls", async () => {
    const { sanitizeScene } = await import("../src/shared/sanitize");
    const walled = sanitizeScene({ ...scene, wallTexture: "wall-brick" })!;
    expect(walled.wallTexture).toBe("wall-brick");
    expect(sanitizeScene({ id: scene.id, name: "Renamed" }, walled)!.wallTexture).toBe("wall-brick");
    // A floor's texture, or one Dungeon doesn't have, keeps what the scene had.
    expect(sanitizeScene({ id: scene.id, wallTexture: "meadow" }, walled)!.wallTexture).toBe("wall-brick");
    expect(sanitizeScene({ ...scene, wallTexture: "nope" })!.wallTexture).toBeUndefined();
    expect("wallTexture" in sanitizeScene({ id: scene.id, wallTexture: null }, walled)!).toBe(false);
    expect("wallTexture" in sanitizeScene(scene)!).toBe(false);
  });
});

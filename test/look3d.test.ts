// Dungeon's builder's 3D view (the /look3d page, src/client/look3d/): the level Dungeon sends is
// checked (dungeonLib/look3d.ts cleanLookMap) and read as the 3D view reads a scene: walls in the
// map's wall texture, cave edges as rock, doors shut, objects in the forms Dungeon gave them, and
// rooms on open ground roofed, lifted off when the builder asks. And the Build tool keeps the 3D
// view beside the flat map (ui/view3dBeside.ts).
import { describe, expect, it } from "vitest";
import { cleanLookMap } from "../src/client/dungeonLib/look3d";
import { LOOK_CELL, lookBuildings, lookObjects, lookWalls } from "../src/client/look3d/lookSource";
import { besideBuild, keeps3d } from "../src/client/ui/view3dBeside";

/** A stand-in for an ImageBitmap (a real one can't be made without a canvas). */
const BITMAP = { width: 40, height: 30, close() {} } as unknown as ImageBitmap;
const isBitmap = (b: unknown): b is ImageBitmap => b === BITMAP;

const table = { parts: [{ k: "box", x0: -1, x1: 1, z0: -0.5, z1: 0.5, y0: 0.7, y1: 0.76, top: 1, c: "#946438" }], surface: 0.76 };
const sent = () => ({
  key: "Keep|20x15|0",
  width: 20,
  height: 15,
  floor: BITMAP,
  walls: [[1, 1, 9, 1], [9, 1, 9, 6]],
  wallTexture: "wall-brick",
  rock: [[12, 2, 14, 3]],
  doors: [[4, 6, 5, 6]],
  objects: [{ id: "table", x: 5, y: 4, size: 2, deg: 90, form: table, color: [0.5, 0.4, 0.3] }],
  roofed: [[1, 1], [2, 1], [1, 2]],
});

describe("what Dungeon sends", () => {
  it("takes a level as sent", () => {
    const m = cleanLookMap(sent(), isBitmap)!;
    expect(m).not.toBeNull();
    expect(m.objects).toHaveLength(1);
    expect(m.objects[0].form).toEqual(table);
    expect(m.roofed).toEqual([[1, 1], [2, 1], [1, 2]]);
  });

  it("refuses anything that isn't a level: no picture, a bad wall, a bad texture name, an absurd size", () => {
    expect(cleanLookMap({ ...sent(), floor: {} }, isBitmap)).toBeNull();
    expect(cleanLookMap({ ...sent(), walls: [[1, 2, 3]] }, isBitmap)).toBeNull();
    expect(cleanLookMap({ ...sent(), walls: [[1, 2, 3, NaN]] }, isBitmap)).toBeNull();
    expect(cleanLookMap({ ...sent(), wallTexture: "../evil" }, isBitmap)).toBeNull();
    expect(cleanLookMap({ ...sent(), width: 1e9 }, isBitmap)).toBeNull();
    expect(cleanLookMap({ ...sent(), roofed: [[1.5, 2]] }, isBitmap)).toBeNull();
    expect(cleanLookMap(null, isBitmap)).toBeNull();
    expect(cleanLookMap("map", isBitmap)).toBeNull();
  });

  it("drops an object whose form isn't a form, and keeps the rest", () => {
    const bad = { ...sent(), objects: [...sent().objects, { id: "x", x: 1, y: 1, size: 1, deg: 0, form: { parts: [{ k: "teapot", c: "#fff" }] }, color: null }, { id: "y", x: 1, y: 1, size: 1, deg: 0, form: { parts: [{ k: "box", x0: "a", c: "#fff" }] }, color: null }] };
    // A part of an unknown kind, or not a number where one goes: that object isn't stood up.
    expect(cleanLookMap(bad, isBitmap)!.objects.map((o) => o.id)).toEqual(["table"]);
    const flat = { ...sent(), objects: [...sent().objects, { id: "rug", x: 1, y: 1, size: 1, deg: 0, form: { flat: "a rug" }, color: null }] };
    expect(cleanLookMap(flat, isBitmap)!.objects.map((o) => o.id)).toEqual(["table"]);
  });
});

describe("the level as the 3D view reads it", () => {
  const m = cleanLookMap(sent(), isBitmap)!;

  it("puts walls in the map's texture, cave edges as rock and doors shut, in scene units", () => {
    const w = lookWalls(m);
    expect(w.built).toEqual([[LOOK_CELL, LOOK_CELL, 9 * LOOK_CELL, LOOK_CELL], [9 * LOOK_CELL, LOOK_CELL, 9 * LOOK_CELL, 6 * LOOK_CELL]]);
    expect(w.walls).toEqual([[12 * LOOK_CELL, 2 * LOOK_CELL, 14 * LOOK_CELL, 3 * LOOK_CELL]]);
    expect(w.doors).toEqual([{ line: [4 * LOOK_CELL, 6 * LOOK_CELL, 5 * LOOK_CELL, 6 * LOOK_CELL], open: false }]);
  });

  it("stands objects up in the forms Dungeon sent, where and as turned as placed", () => {
    const [o] = lookObjects(m);
    expect(o).toMatchObject({ id: "d:table", x: 5 * LOOK_CELL, y: 4 * LOOK_CELL, size: 2, deg: 90, form: table, color: [0.5, 0.4, 0.3] });
  });

  it("roofs the rooms, and lifts the roofs off when the builder asks", () => {
    const on = lookBuildings(m, true);
    expect(on).toHaveLength(1);
    expect(on[0].inside).toBe(false);
    expect(on[0].rects.length).toBeGreaterThan(0);
    expect(lookBuildings(m, false)[0].inside).toBe(true);
  });
});

describe("the Build tool and the 3D view", () => {
  it("keeps the 3D view when Build is picked, and goes back to the flat map for any other tool", () => {
    expect(keeps3d("build")).toBe(true);
    for (const t of ["select", "draw", "erase", "fog", "measure", "pointer", "spell"]) expect(keeps3d(t), t).toBe(false);
  });

  it("puts the 3D view beside the flat map while building with room for both; over it on a phone", () => {
    expect(besideBuild(true, "build", false)).toBe(true);
    expect(besideBuild(true, "build", true)).toBe(false);
    expect(besideBuild(true, "select", false)).toBe(false);
    expect(besideBuild(false, "build", false)).toBe(false);
  });
});

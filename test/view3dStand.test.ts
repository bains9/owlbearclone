// Standing on things in the 3D view (room/view3dStand.ts, view3dObjects.ts standMesh): a figure
// whose middle is over a pillar, a crate, a table or a rock stands on its top; one under a tree
// stays under it.
import { describe, expect, it } from "vitest";
import { standMesh, standsOn, type Object3d } from "../src/client/room/view3dObjects";
import { topAt, topsOf } from "../src/client/room/view3dStand";

const CELL = 100;
/** An object at (x, y) squares, `size` squares across. */
const at = (o: Partial<Object3d>, x: number, y: number, size = 1): Object3d => ({ id: null, x: x * CELL, y: y * CELL, size, deg: 0, color: null, ...o });
const tops = (objects: Object3d[]) => topsOf(standMesh(objects, CELL, null, true).position);

describe("standing on things", () => {
  it("finds the top of what faces up, not its sides", () => {
    // A square top 2 squares up over (1, 1) to (2, 2), and a side wall going up to 5.
    const position = Float32Array.from([
      1, 2, 1, 2, 2, 1, 2, 2, 2,
      1, 2, 1, 2, 2, 2, 1, 2, 2,
      3, 0, 1, 3, 5, 1, 3, 5, 2,
    ]);
    const t = topsOf(position)!;
    expect(topAt(t, 1.5, 1.5)).toBeCloseTo(2);
    expect(topAt(t, 3, 1.5)).toBe(0);
    expect(topAt(t, 6, 6)).toBe(0);
    expect(topAt(null, 1.5, 1.5)).toBe(0);
  });

  it("stands a figure on a pillar's top, and on the ground beside it", () => {
    const t = tops([at({ id: "pillar" }, 5, 5)]);
    expect(topAt(t, 5, 5)).toBeGreaterThan(1);
    expect(topAt(t, 7, 5)).toBe(0);
  });

  it("stands one on a crate, a table and a rock", () => {
    expect(topAt(tops([at({ id: "crate" }, 2, 2)]), 2, 2)).toBeGreaterThan(0.2);
    expect(topAt(tops([at({ id: "table" }, 2, 2, 2)]), 2, 2)).toBeGreaterThan(0.2);
    expect(topAt(tops([at({ shape: { kind: "rock", h: 1 } }, 2, 2)]), 2, 2)).toBeGreaterThan(0.2);
  });

  it("leaves one under a tree or among bushes, as Dungeon's library and the map's own data have them", () => {
    expect(standsOn(at({ id: "tree" }, 2, 2))).toBe(false);
    expect(standsOn(at({ id: "bush" }, 2, 2))).toBe(false);
    expect(standsOn(at({ shape: { kind: "pine", h: 0 } }, 2, 2))).toBe(false);
    expect(standsOn(at({ shape: { kind: "box", h: 1 } }, 2, 2))).toBe(true);
    // Dungeon's canopy: a tree's crown.
    expect(standsOn(at({ id: "d:oak-tree-small-rounded" }, 2, 2))).toBe(false);
    expect(topAt(tops([at({ id: "tree" }, 2, 2, 2)]), 2, 2)).toBe(0);
  });
});

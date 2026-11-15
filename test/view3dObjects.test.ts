// The built map's objects standing up in the 3D view (room/view3dObjects.ts): each of Dungeon's
// objects as the form its own library gives it (dungeonLib/solid.ts), Tabletop's own sixteen as
// theirs, kinds of shape for things from a map's data, and what a page has seen.
import { beforeAll, describe, expect, it } from "vitest";
import { DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import { STAMP_IDS, type StampId } from "../src/shared/terrain";
import { WALL_HEIGHT, shadeOf, type CoverMap } from "../src/client/room/view3dModel";
import { BASE_FORMS, footprintOf, objectLight, objectMesh, shapeOf, type Object3d } from "../src/client/room/view3dObjects";
import { dungeonObjects, loadDungeonObjects } from "../src/client/room/dungeonStamps";
import { SQUARE_M, formOf, isFlat } from "../src/client/dungeonLib/solid";

const CELL = 100;
const d = (id: string) => `d:${id}` as StampId;
const at = (id: StampId, size = 1, deg = 0, color: Object3d["color"] = null, x = 500, y = 500): Object3d => ({ id, x, y, size, deg, color });

/** The mesh's points as [x, y, z] in squares. */
function points(m: { position: Float32Array }): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.position.length; i += 3) out.push([m.position[i], m.position[i + 1], m.position[i + 2]]);
  return out;
}

beforeAll(async () => {
  await loadDungeonObjects();
});

describe("which objects stand up", () => {
  it("gives every one of Dungeon's objects the form its library has, next to its drawing", () => {
    const lib = dungeonObjects()!;
    expect(lib).toBeTruthy();
    for (const p of DUNGEON_PROPS) {
      const f = formOf(lib.prop(p.id)!);
      if (isFlat(f)) expect(shapeOf(d(p.id)), p.id).toBeNull();
      else expect(shapeOf(d(p.id)), p.id).toBe(f);
    }
  });

  it("stands up nearly all of them, and leaves what lies flat painted", () => {
    const standing = DUNGEON_PROPS.filter((p) => shapeOf(d(p.id)));
    expect(standing.length).toBeGreaterThan(1900);
    for (const id of ["rug", "stairs", "bones", "trapdoor", "blood-pool-small", "lily-pads"]) expect(shapeOf(d(id)), id).toBeNull();
    for (const id of ["oak-tree-medium-rounded", "pine-tree-large", "tankards-pewter", "candles", "rubble", "flowers-red"]) expect(shapeOf(d(id)), id).not.toBeNull();
  });

  it("gives Tabletop's own sixteen a form each: all stand but the stairs", () => {
    for (const id of STAMP_IDS) expect(BASE_FORMS[id], id).toBeTruthy();
    expect(STAMP_IDS.filter((id) => shapeOf(id)).length).toBe(15);
    expect(shapeOf("stairs")).toBeNull();
  });

  it("takes an object's footprint from its drawing's proportions", () => {
    expect(footprintOf(d("table"), 2)).toEqual({ w: 2, d: 1 });
    expect(footprintOf(d("coffin"), 2)).toEqual({ w: 0.8, d: 2 });
    expect(footprintOf("chair", 1.5)).toEqual({ w: 1.5, d: 1.5 });
  });
});

describe("the forms", () => {
  it("wind every triangle the way its normal faces, so WebGL draws its outside", () => {
    const ids = ["oak-tree-medium-rounded", "pine-tree-large", "palm-tree-medium", "boulder-grey", "column-granite-whole", "statue-figure-marble-robed", "table-square-pale-bare", "fountain", "barrel-banded-pale-ale", "crate"];
    const m = objectMesh(ids.map((id, i) => at(d(id), 1.5, i * 35, null, 300 + i * 400)), CELL, null, false);
    expect(m.position.length % 9).toBe(0);
    const p = points(m);
    for (let t = 0; t < p.length; t += 3) {
      const [a, b, c] = [p[t], p[t + 1], p[t + 2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = [m.normal[t * 3], m.normal[t * 3 + 1], m.normal[t * 3 + 2]];
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
      expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it("stands a tree taller than the walls, a table at table height and a rock low", () => {
    const ys = (id: StampId, size: number) => points(objectMesh([at(id, size)], CELL, null, false)).map((q) => q[1]);
    expect(Math.max(...ys(d("oak-tree-medium-rounded"), 2.76))).toBeGreaterThan(WALL_HEIGHT * 1.5);
    expect(Math.max(...ys(d("pine-tree-large"), 3.74))).toBeGreaterThan(WALL_HEIGHT * 3);
    // A 2 by 1 table at its own size: its top 0.76 m up.
    expect(Math.max(...ys(d("table"), 2))).toBeCloseTo(0.76 / SQUARE_M, 2);
    expect(Math.min(...ys(d("table"), 2))).toBe(0);
    expect(Math.max(...ys(d("rock-grey-large"), 0.8))).toBeLessThan(0.6);
    expect(Math.min(...ys(d("oak-tree-medium-rounded"), 2.76))).toBe(0);
  });

  it("stands where the object is, in squares, turned as on the map", () => {
    const flat = points(objectMesh([at(d("table"), 2, 0)], CELL, null, false));
    const turned = points(objectMesh([at(d("table"), 2, 90)], CELL, null, false));
    const span = (ps: [number, number, number][], i: number) => Math.max(...ps.map((q) => q[i])) - Math.min(...ps.map((q) => q[i]));
    expect(span(flat, 0)).toBeGreaterThan(span(flat, 2) * 1.5);
    expect(span(turned, 2)).toBeGreaterThan(span(turned, 0) * 1.5);
    const xs = flat.map((q) => q[0]), zs = flat.map((q) => q[2]);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(5);
    expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(5);
  });

  it("sits a tankard put on a table on its top, and one on the floor on the floor", () => {
    const low = (objs: Object3d[]) => {
      const p = points(objectMesh(objs, CELL, null, false));
      // The tankards are made last: their lowest point.
      const n = objectMesh([objs[objs.length - 1]], CELL, null, false).position.length / 3;
      return Math.min(...p.slice(p.length - n).map((q) => q[1]));
    };
    expect(low([at(d("table"), 2), at(d("tankards-pewter"), 0.5, 0, null, 520, 500)])).toBeCloseTo(0.76 / SQUARE_M, 2);
    expect(low([at(d("table"), 2), at(d("tankards-pewter"), 0.5, 0, null, 900, 900)])).toBeCloseTo(0, 5);
  });

  it("keeps flames apart, to be drawn unlit", () => {
    const m = objectMesh([at(d("candles"), 0.5)], CELL, null, false);
    expect(m.glow.position.length).toBeGreaterThan(0);
    expect(m.position.length).toBeGreaterThan(0);
  });

  it("paints leaves in the drawing's colour (its season's look), and made things in their own", () => {
    const red: Object3d["color"] = [1, 0, 0];
    const tree = objectMesh([at(d("oak-tree-medium-rounded"), 2.76, 0, red)], CELL, null, false);
    expect(Array.from(tree.color).some((c, i) => i % 3 === 0 && c === 1)).toBe(true);
    const table = objectMesh([at(d("table"), 2, 0, red)], CELL, null, false);
    expect(Array.from(table.color).every((c, i) => i % 3 !== 1 || c > 0.2)).toBe(true);
  });

  it("dims an object as lit as where it stands", () => {
    const cover: CoverMap = { x0: 0, y0: 0, k: 1 / CELL, w: 10, h: 10, alpha: new Uint8ClampedArray(100).fill(Math.round(255 * 0.55)) };
    const lit = objectMesh([at("crate", 1, 0, [1, 0, 0])], CELL, null, false);
    const dim = objectMesh([at("crate", 1, 0, [1, 0, 0])], CELL, cover, false);
    expect(dim.color[0] / lit.color[0]).toBeCloseTo(shadeOf(0.45), 1);
  });

  it("uses an object's own form when it brings one (Dungeon's builder's view sends each object's)", () => {
    const tall = objectMesh([{ ...at(d("table"), 2), form: { parts: [{ k: "box", x0: -1, x1: 1, z0: -0.5, z1: 0.5, y0: 0, y1: 3, top: 1, c: "#808080" }] } }], CELL, null, false);
    expect(Math.max(...points(tall).map((q) => q[1]))).toBeCloseTo(2, 5);
  });

  it("stands a map's own trees and stumps up by their kind of shape", () => {
    const tree = objectMesh([{ id: null, shape: { kind: "tree", h: 0 }, x: 500, y: 500, size: 2, w: 2, d: 2, deg: 0, color: null, paint: true }], CELL, null, false);
    expect(Math.max(...points(tree).map((q) => q[1]))).toBeGreaterThan(2);
    const stump = objectMesh([{ id: null, shape: { kind: "barrel", h: 0.3 }, x: 500, y: 500, size: 0.6, w: 0.6, d: 0.6, deg: 0, color: null, paint: true }], CELL, null, false);
    expect(Math.max(...points(stump).map((q) => q[1]))).toBeCloseTo(0.3, 2);
  });

  it("makes the same lumps every time for the same object", () => {
    const a = objectMesh([at(d("boulder-grey"), 1.6)], CELL, null, false);
    const b = objectMesh([at(d("boulder-grey"), 1.6)], CELL, null, false);
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
  });

  it("makes nothing for objects that lie flat", () => {
    expect(objectMesh([at(d("rug"), 2), at("stairs")], CELL, null, true).position.length).toBe(0);
  });
});

describe("what a page has seen", () => {
  // Clear left of x = 500, covered right of it.
  const cover: CoverMap = { x0: 0, y0: 0, k: 1 / CELL, w: 10, h: 10, alpha: new Uint8ClampedArray(100).map((_, i) => (i % 10 < 5 ? 0 : 255)) };

  it("doesn't stand an object up for a player under the fog or in the dark not explored", () => {
    expect(objectMesh([at(d("oak-tree-medium-rounded"), 2.76, 0, null, 800, 500)], CELL, cover, false).position.length).toBe(0);
    expect(objectMesh([at(d("oak-tree-medium-rounded"), 2.76, 0, null, 200, 500)], CELL, cover, false).position.length).toBeGreaterThan(0);
  });

  it("stands every one up for the GM", () => {
    expect(objectMesh([at(d("oak-tree-medium-rounded"), 2.76, 0, null, 800, 500)], CELL, cover, true).position.length).toBeGreaterThan(0);
  });

  it("counts one seen at its edge as seen", () => {
    expect(objectLight({ x: 520, y: 500 }, 40, cover)).toBe(1);
    expect(objectLight({ x: 800, y: 500 }, 40, cover)).toBe(0);
  });
});

// The built map's objects standing up in the 3D view (room/view3dObjects.ts): which shape each kind
// of object gets, that floor things stay painted, and the shapes themselves.
import { describe, expect, it } from "vitest";
import { DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import { STAMP_IDS, type StampId } from "../src/shared/terrain";
import { WALL_HEIGHT, shadeOf, type CoverMap } from "../src/client/room/view3dModel";
import { SHAPED_GROUPS, footprintOf, objectLight, objectMesh, shapeOf, type Object3d } from "../src/client/room/view3dObjects";

const CELL = 100;
const d = (id: string) => `d:${id}` as StampId;
const at = (id: StampId, size = 1, deg = 0, color: Object3d["color"] = null, x = 500, y = 500): Object3d => ({ id, x, y, size, deg, color });

/** The mesh's points as [x, y, z] in squares. */
function points(m: { position: Float32Array }): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.position.length; i += 3) out.push([m.position[i], m.position[i + 1], m.position[i + 2]]);
  return out;
}

describe("which objects stand up", () => {
  it("gives trees, evergreens, palms and dead trees shapes of their own", () => {
    expect(shapeOf(d("oak-tree-medium-rounded"))?.kind).toBe("tree");
    expect(shapeOf(d("oak-tree-medium-spreading"))?.kind).toBe("spreading");
    expect(shapeOf(d("pine-tree-large"))?.kind).toBe("pine");
    expect(shapeOf(d("cypress-tree-small"))?.kind).toBe("cypress");
    expect(shapeOf(d("palm-tree-medium"))?.kind).toBe("palm");
    expect(shapeOf(d("dead-tree-twisted"))?.kind).toBe("bare");
    expect(shapeOf("tree")?.kind).toBe("tree");
  });

  it("tells a group's things apart by their names", () => {
    expect(shapeOf(d("rock-spire-grey"))?.kind).toBe("spire");
    expect(shapeOf(d("boulder-mossy"))?.kind).toBe("rock");
    expect(shapeOf(d("column-marble-fallen"))?.kind).toBe("box");
    expect(shapeOf(d("column-marble-whole"))?.kind).toBe("column");
    expect(shapeOf(d("statue-figure-granite-warrior"))?.kind).toBe("statue");
    expect(shapeOf(d("table-round-walnut-set"))?.kind).toBe("roundTable");
    expect(shapeOf(d("table-square-walnut-set"))?.kind).toBe("table");
    expect(shapeOf(d("barrel-tipped-honey"))).toEqual({ kind: "box", h: 0.55 });
    expect(shapeOf(d("stump-mossy"))?.kind).toBe("barrel");
    expect(shapeOf(d("fountain"))?.kind).toBe("fountain");
    expect(shapeOf(d("village-well-granite"))?.kind).toBe("well");
  });

  it("leaves what lies on the floor and small things painted", () => {
    for (const id of ["rug", "rubble-grey-small", "bones", "stairs", "tankards-pewter", "glass-jar-red", "candles", "offering-bowl-gold"]) {
      expect(shapeOf(d(id)), id).toBeNull();
    }
    expect(shapeOf("stairs")).toBeNull();
    expect(shapeOf("campfire")).toBeNull();
    // Nothing on Dungeon's floor layer ever stands up.
    for (const p of DUNGEON_PROPS) if (p.layer === "floor") expect(shapeOf(d(p.id)), p.id).toBeNull();
  });

  it("names only groups the catalog has, so a renamed group isn't missed quietly", () => {
    const groups = new Set(DUNGEON_PROPS.map((p) => p.group));
    for (const g of SHAPED_GROUPS) expect(groups.has(g), g).toBe(true);
  });

  it("stands up a good part of the catalog, and most of Tabletop's own objects", () => {
    const shaped = DUNGEON_PROPS.filter((p) => shapeOf(d(p.id)));
    expect(shaped.length).toBeGreaterThan(700);
    expect(STAMP_IDS.filter((id) => shapeOf(id)).length).toBe(13);
  });

  it("takes an object's footprint from its drawing's proportions", () => {
    expect(footprintOf(d("table"), 2)).toEqual({ w: 2, d: 1 });
    expect(footprintOf(d("coffin"), 2)).toEqual({ w: 0.8, d: 2 });
    expect(footprintOf("chair", 1.5)).toEqual({ w: 1.5, d: 1.5 });
  });
});

describe("the shapes", () => {
  it("wind every triangle the way its normal faces, so WebGL draws its outside", () => {
    const ids = [
      "oak-tree-medium-rounded",
      "pine-tree-large",
      "palm-tree-medium",
      "boulder-grey",
      "column-granite-whole",
      "statue-figure-marble-robed",
      "table-square-pale-bare",
      "table-round-pale-bare",
      "fountain",
      "barrel-banded-pale-ale",
      "crate",
    ];
    const m = objectMesh(
      ids.map((id, i) => at(d(id), 1.5, i * 35, null, 300 + i * 400)),
      CELL,
      null,
      false,
    );
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

  it("faces a box's sides away from its middle", () => {
    const m = objectMesh([at("crate", 1)], CELL, null, false);
    const p = points(m);
    for (let t = 0; t < p.length; t += 3) {
      const mx = (p[t][0] + p[t + 1][0] + p[t + 2][0]) / 3 - 5;
      const my = (p[t][1] + p[t + 1][1] + p[t + 2][1]) / 3 - 0.3;
      const mz = (p[t][2] + p[t + 1][2] + p[t + 2][2]) / 3 - 5;
      expect(mx * m.normal[t * 3] + my * m.normal[t * 3 + 1] + mz * m.normal[t * 3 + 2]).toBeGreaterThan(0);
    }
  });

  it("stands a tree taller than the walls, a rock low and a table at table height, on the floor", () => {
    const ys = (id: StampId, size: number) => points(objectMesh([at(id, size)], CELL, null, false)).map((q) => q[1]);
    expect(Math.max(...ys(d("oak-tree-medium-rounded"), 2.76))).toBeGreaterThan(WALL_HEIGHT * 2);
    expect(Math.max(...ys(d("pine-tree-large"), 3.74))).toBeGreaterThan(WALL_HEIGHT * 3);
    expect(Math.max(...ys(d("rock-grey-large"), 0.8))).toBeLessThan(0.5);
    expect(Math.max(...ys(d("table-square-pale-bare"), 1.2))).toBeCloseTo(0.5);
    expect(Math.min(...ys(d("table-square-pale-bare"), 1.2))).toBe(0);
    expect(Math.min(...ys(d("oak-tree-medium-rounded"), 2.76))).toBe(0);
  });

  it("stands where the object is, in squares, turned as on the map", () => {
    const flat = points(objectMesh([at(d("table"), 2, 0)], CELL, null, false));
    const turned = points(objectMesh([at(d("table"), 2, 90)], CELL, null, false));
    const span = (ps: [number, number, number][], i: number) => Math.max(...ps.map((q) => q[i])) - Math.min(...ps.map((q) => q[i]));
    // A 2 by 1 table: long across the map, then long down it once turned a quarter.
    expect(span(flat, 0)).toBeGreaterThan(span(flat, 2) * 1.5);
    expect(span(turned, 2)).toBeGreaterThan(span(turned, 0) * 1.5);
    const xs = flat.map((q) => q[0]);
    const zs = flat.map((q) => q[2]);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(5);
    expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(5);
  });

  it("is painted its drawing's colour, as lit as where it stands, or a stand-in colour before that's known", () => {
    const red = objectMesh([at("crate", 1, 0, [1, 0, 0])], CELL, null, false);
    expect([red.color[0], red.color[1], red.color[2]]).toEqual([1, 0, 0]);
    const cover: CoverMap = { x0: 0, y0: 0, k: 1 / CELL, w: 10, h: 10, alpha: new Uint8ClampedArray(100).fill(Math.round(255 * 0.55)) };
    const dim = objectMesh([at("crate", 1, 0, [1, 0, 0])], CELL, cover, false);
    expect(dim.color[0]).toBeCloseTo(shadeOf(0.45), 1);
    const standIn = objectMesh([at("crate", 1)], CELL, null, false);
    expect(standIn.color[0]).toBeGreaterThan(0.3);
  });

  it("makes the same lumps every time for the same object", () => {
    const a = objectMesh([at(d("boulder-grey"), 1.6)], CELL, null, false);
    const b = objectMesh([at(d("boulder-grey"), 1.6)], CELL, null, false);
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
  });

  it("makes nothing for objects that stay painted", () => {
    expect(objectMesh([at(d("rug"), 2), at("stairs")], CELL, null, true).position.length).toBe(0);
  });
});

describe("what a page has seen", () => {
  // Clear left of x = 500, covered right of it.
  const cover: CoverMap = {
    x0: 0,
    y0: 0,
    k: 1 / CELL,
    w: 10,
    h: 10,
    alpha: new Uint8ClampedArray(100).map((_, i) => (i % 10 < 5 ? 0 : 255)),
  };

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

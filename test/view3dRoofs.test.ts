// Roofs on a built map's buildings in the 3D view (room/view3dRoofs.ts): which rooms make a
// building, the rectangles roofs go on, when a roof shows, and the roof itself.
import { describe, expect, it } from "vitest";
import { WALL_HEIGHT, type CoverMap } from "../src/client/room/view3dModel";
import { MAX_RIDGE, OVERHANG, ROOF_COLOURS, buildingsOf, rectsOf, roofColour, roofMesh, roofShown, samplesOf } from "../src/client/room/view3dRoofs";

const CELL = 100;
const block = (c0: number, r0: number, c1: number, r1: number) => {
  const out: [number, number][] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c, r]);
  return out;
};

describe("buildings", () => {
  it("makes one building of rooms that touch, and another of rooms apart", () => {
    const houses = buildingsOf([...block(0, 0, 2, 1), ...block(3, 0, 4, 1), ...block(8, 5, 9, 6)]);
    expect(houses).toHaveLength(2);
    expect(houses[0].cells).toHaveLength(10);
    expect(houses[1].cells).toHaveLength(4);
  });

  it("doesn't join rooms that only touch at a corner", () => {
    expect(buildingsOf([...block(0, 0, 1, 1), ...block(2, 2, 3, 3)])).toHaveLength(2);
  });

  it("tiles a building with rectangles that cover each square once", () => {
    // An L: a 4 by 2 block and a 2 by 2 one below its left end.
    const cells = [...block(0, 0, 3, 1), ...block(0, 2, 1, 3)];
    const rects = rectsOf(cells);
    expect(rects).toEqual([
      { c0: 0, r0: 0, c1: 3, r1: 1 },
      { c0: 0, r0: 2, c1: 1, r1: 3 },
    ]);
    const covered = rects.reduce((n, r) => n + (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1), 0);
    expect(covered).toBe(cells.length);
  });

  it("looks for whether it's been seen inside it and just outside its walls", () => {
    const [b] = buildingsOf(block(1, 1, 2, 1));
    const samples = samplesOf(b, (c) => c * CELL, (r) => r * CELL, CELL);
    // Two squares inside; outside: two above, two below, one at each end.
    expect(samples).toHaveLength(8);
    expect(samples).toContainEqual({ x: 150, y: 150 });
    expect(samples).toContainEqual({ x: 50, y: 150 });
    expect(samples).toContainEqual({ x: 150, y: 50 });
  });
});

describe("when a roof shows", () => {
  const cover = (covered: (c: number, r: number) => boolean): CoverMap => ({
    x0: 0,
    y0: 0,
    k: 1 / CELL,
    w: 10,
    h: 10,
    alpha: new Uint8ClampedArray(100).map((_, i) => (covered(i % 10, Math.floor(i / 10)) ? 255 : 0)),
  });
  const [b] = buildingsOf(block(4, 4, 5, 5));
  const house = { samples: samplesOf(b, (c) => c * CELL, (r) => r * CELL, CELL), inside: false };

  it("shows a player a building seen from outside", () => {
    // All covered but the square west of the house.
    expect(roofShown(house, cover((c, r) => !(c === 3 && r === 4)), false)).toBe(true);
  });

  it("hides a building a player hasn't seen at all, under the fog or in the dark", () => {
    expect(roofShown(house, cover(() => true), false)).toBe(false);
  });

  it("shows the GM every one", () => {
    expect(roofShown(house, cover(() => true), true)).toBe(true);
  });

  it("lifts it off while the party's inside", () => {
    expect(roofShown({ ...house, inside: true }, null, true)).toBe(false);
  });
});

describe("the roof", () => {
  const verts = (m: { position: Float32Array }) => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < m.position.length; i += 3) out.push([m.position[i], m.position[i + 1], m.position[i + 2]]);
    return out;
  };

  it("sits on the walls, reaches past them, and rises to a ridge along the longer side", () => {
    // 4 squares across, 2 down.
    const m = roofMesh([{ x0: 0, y0: 0, x1: 400, y1: 200 }], CELL, ROOF_COLOURS[0], 1);
    const p = verts(m);
    const ys = p.map((q) => q[1]), xs = p.map((q) => q[0]), zs = p.map((q) => q[2]);
    expect(Math.min(...ys)).toBeCloseTo(WALL_HEIGHT);
    expect(Math.max(...ys)).toBeGreaterThan(WALL_HEIGHT + 0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(WALL_HEIGHT + MAX_RIDGE);
    expect(Math.min(...xs)).toBeCloseTo(-OVERHANG);
    expect(Math.max(...xs)).toBeCloseTo(4 + OVERHANG);
    // The ridge's points are all over the middle of the shorter way.
    for (const q of p) if (q[1] > WALL_HEIGHT + 0.5) expect(q[2]).toBeCloseTo(1);
    expect(Math.min(...zs)).toBeCloseTo(-OVERHANG);
  });

  it("turns its ridge for a building longer down the map than across", () => {
    const p = verts(roofMesh([{ x0: 0, y0: 0, x1: 200, y1: 500 }], CELL, ROOF_COLOURS[1], 1));
    for (const q of p) if (q[1] > WALL_HEIGHT + 0.5) expect(q[0]).toBeCloseTo(1);
  });

  it("faces its slopes up and its gable ends out, wound so WebGL draws them", () => {
    const m = roofMesh([{ x0: 0, y0: 0, x1: 300, y1: 200 }], CELL, ROOF_COLOURS[2], 1);
    const p = verts(m);
    for (let t = 0; t < p.length; t += 3) {
      const [a, b, c] = [p[t], p[t + 1], p[t + 2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = [m.normal[t * 3], m.normal[t * 3 + 1], m.normal[t * 3 + 2]];
      expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2]).toBeGreaterThan(0);
      // Nothing faces down, into the house.
      expect(n[1]).toBeGreaterThanOrEqual(0);
      // A gable end faces away from the middle.
      if (Math.abs(n[1]) < 1e-6) expect((a[0] + b[0] + c[0]) / 3 - 1.5).toSatisfy((dx: number) => Math.sign(dx) === Math.sign(n[0]) || Math.abs(n[0]) < 1e-6);
    }
  });

  it("is darker on a building only half seen, and one of the village's colours, the same each time", () => {
    const lit = roofMesh([{ x0: 0, y0: 0, x1: 100, y1: 100 }], CELL, ROOF_COLOURS[0], 1);
    const dim = roofMesh([{ x0: 0, y0: 0, x1: 100, y1: 100 }], CELL, ROOF_COLOURS[0], 0.4);
    expect(dim.color[0]).toBeLessThan(lit.color[0]);
    expect(ROOF_COLOURS).toContain(roofColour("4,5"));
    expect(roofColour("4,5")).toBe(roofColour("4,5"));
    const many = new Set(Array.from({ length: 40 }, (_, i) => roofColour(`${i},${i * 3}`)));
    expect(many.size).toBeGreaterThan(1);
  });
});

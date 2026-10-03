// The shared rasteriser of season sidecars (design 5.3, 2.3, 2.9; 6.3 "Sidecar, PNG box and
// rasteriser"): the pixel-centre rule, reach directions, draw order, fill rules, terrain sampling,
// role re-derivation, the work budget and the capped worst case's time at 1024 px.
import { describe, expect, it } from "vitest";
import { RASTER_BUDGET, RASTER_MAX_PIXELS, REACH_DIRS, rasterPlan, rasterSidecar, type SidecarLayers } from "../src/client/dd/raster";
import { AR, OR, TR, type AreaRole, type ObjectRole } from "../src/client/dd/roles";
import {
  NO_NAME, REACH_N, SIDECAR_CAPS, decodeSidecar, encodeSidecar, type BitmapLayer, type ObjectTable, type SeasonSidecar,
  type ShapeLayer,
} from "../src/client/dd/sidecar";

const SQ = 256;

function sidecar(rect: [number, number, number, number], parts: Partial<SeasonSidecar> = {}, names: string[] = []): SeasonSidecar {
  return {
    meta: { rect, squares: [Math.ceil((rect[2] - rect[0]) / SQ), Math.ceil((rect[3] - rect[1]) / SQ)], extractor: 1, snowShare: 1,
      packShare: 0, packItems: 0, dropped: 0, names },
    terrain: null, bitmaps: [], shapes: [], objects: objects([]), ...parts,
  };
}

interface Obj { role: ObjectRole; x: number; y: number; reach: number | number[]; layer?: number; name?: number }

/** Objects at world (x, y), reach in world units (one for all 16, or 16). */
function objects(list: Obj[]): ObjectTable {
  const n = list.length;
  const o: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n).fill(NO_NAME), reach: new Uint16Array(n * REACH_N),
  };
  list.forEach((b, i) => {
    o.role[i] = b.role;
    o.layer[i] = b.layer ?? 100;
    o.x[i] = Math.round(b.x * 16);
    o.y[i] = Math.round(b.y * 16);
    if (b.name !== undefined) o.name[i] = b.name;
    for (let k = 0; k < REACH_N; k++) o.reach[i * REACH_N + k] = Math.round((typeof b.reach === "number" ? b.reach : b.reach[k]) * 4);
  });
  return o;
}

/** A shape of rings given in world units. */
function shape(role: AreaRole, layer: number, rings: number[][], rule: 0 | 1 = 0): ShapeLayer {
  const pts: number[] = [];
  const ends: number[] = [];
  for (const r of rings) {
    for (const v of r) pts.push(Math.round(v * 16));
    ends.push(pts.length / 2);
  }
  return { role, layer, rule, pts: new Int32Array(pts), ringEnds: new Uint32Array(ends) };
}

const box = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

function bitmap(role: AreaRole, layer: number, step: number, ox: number, oy: number, rows: string[]): BitmapLayer {
  const w = rows[0].length, h = rows.length;
  const bits = new Uint8Array(Math.ceil((w * h) / 8));
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === "#") bits[(y * w + x) >> 3] |= 1 << ((y * w + x) & 7); }));
  return { role, layer, step, ox, oy, w, h, bits };
}

const at = (l: SidecarLayers, p: Uint8Array | undefined, x: number, y: number) => (p ? p[y * l.w + x] : 0);

/** Each plane's role and a hash of its bytes (comparing the planes themselves element by element is slow). */
function digest(l: SidecarLayers): string[] {
  const hash = (b: ArrayLike<number>) => {
    let x = 2166136261;
    for (let i = 0; i < b.length; i++) x = Math.imul(x ^ b[i], 16777619);
    return (x >>> 0).toString(16);
  };
  const out = [`${l.w}x${l.h}`, `top ${hash(l.top)}`];
  for (const [kind, m] of [["terrain", l.terrain], ["area", l.area], ["objects", l.objects]] as const) {
    for (const [role, p] of [...m].sort((a, b) => a[0] - b[0])) out.push(`${kind} ${role} ${hash(p)}`);
  }
  return out;
}

describe("rasterSidecar: the pixel-centre rule (2.3)", () => {
  // A 10 x 5 square map, and one square's box at squares (2..3, 1..2).
  const sc = sidecar([0, 0, 10 * SQ, 5 * SQ], { shapes: [shape(AR.FLOOR, 0, [box(2 * SQ, SQ, 3 * SQ, 2 * SQ)])] });

  it("covers exactly the box's pixels at whole resolutions", () => {
    for (const k of [1, 2, 8]) {
      const l = rasterSidecar(sc, { w: 10 * k, h: 5 * k });
      const p = l.area.get(AR.FLOOR);
      for (let y = 0; y < l.h; y++) {
        for (let x = 0; x < l.w; x++) {
          const inside = x >= 2 * k && x < 3 * k && y >= k && y < 2 * k;
          expect(at(l, p, x, y)).toBe(inside ? 255 : 0);
        }
      }
    }
  });

  it("covers edge pixels by exact horizontal area and 4 sub-scanlines at an odd resolution", () => {
    // 15 x 7: the box spans x 3..4.5 and y 1.4..2.8 in pixels.
    const l = rasterSidecar(sc, { w: 15, h: 7 });
    const p = l.area.get(AR.FLOOR);
    const col = (x: number) => Math.max(0, Math.min(x + 1, 4.5) - Math.max(x, 3));
    const row = (y: number) => [0.125, 0.375, 0.625, 0.875].filter((f) => y + f >= 1.4 && y + f < 2.8).length / 4;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 15; x++) expect(at(l, p, x, y)).toBe(Math.round(col(x) * row(y) * 255));
    expect(at(l, p, 3, 2)).toBe(191);
  });

  it("measures from the rectangle's corner, not world 0", () => {
    const moved = { ...sc, meta: { ...sc.meta, rect: [SQ, SQ, 11 * SQ, 6 * SQ] as [number, number, number, number] } };
    const l = rasterSidecar(moved, { w: 10, h: 5 });
    expect(at(l, l.area.get(AR.FLOOR), 1, 0)).toBe(255);
    expect(at(l, l.area.get(AR.FLOOR), 2, 1)).toBe(0);
  });

  it("puts a floor-cell bitmap's edges on the cells' edges (cut at 0.5, 1-pixel ramp)", () => {
    // Floor cells: samples at the cells' centres; cells 1..3 x 1..2 set, 16 px a square.
    const b = bitmap(AR.FLOOR, -300, SQ, SQ / 2, SQ / 2, [".....", ".###.", ".###.", "....."]);
    const l = rasterSidecar(sidecar([0, 0, 5 * SQ, 4 * SQ], { bitmaps: [b] }), { w: 80, h: 64 });
    const p = l.area.get(AR.FLOOR);
    expect(at(l, p, 40, 32)).toBe(255);
    for (const [x, y, v] of [[15, 32, 0], [16, 32, 255], [63, 32, 255], [64, 32, 0], [40, 15, 0], [40, 16, 255], [40, 47, 255], [40, 48, 0]]) {
      expect(at(l, p, x, y)).toBe(v);
    }
  });
});

describe("rasterSidecar: objects and reach directions (2.9)", () => {
  // 8 squares at 16 world units a pixel, the object centred on pixel (64, 64).
  const c = (64 + 0.5) * 16;
  const pixelAlong = (k: number, dist: number): [number, number] =>
    [Math.floor((c + dist * REACH_DIRS[k * 2]) / 16), Math.floor((c + dist * REACH_DIRS[k * 2 + 1]) / 16)];

  it("covers the pixels along REACH_DIRS[k] for a reach in direction k only", () => {
    // A spike of no width: the pixels its line passes near are half covered, nothing else.
    for (let k = 0; k < 16; k++) {
      const reach = new Array(16).fill(0);
      reach[k] = 3 * SQ;
      const l = rasterSidecar(sidecar([0, 0, 8 * SQ, 8 * SQ], { objects: objects([{ role: OR.ROCK, x: c, y: c, reach }]) }), { w: 128, h: 128 });
      const p = l.objects.get(OR.ROCK);
      for (const dist of [1 * SQ, 2 * SQ]) {
        const [x, y] = pixelAlong(k, dist);
        let best = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.max(best, at(l, p, x + dx, y + dy));
        expect(best).toBeGreaterThan(0);
        expect(best).toBeLessThanOrEqual(128);
        for (const other of [k + 2, k + 4, k + 8, k + 12, k + 14]) {
          const [ox, oy] = pixelAlong(other & 15, dist);
          expect(at(l, p, ox, oy)).toBe(0);
        }
      }
      // The covered pixels' mean direction is REACH_DIRS[k] (within 2 degrees).
      let mx = 0, my = 0;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { mx += (x + 0.5 - 64.5) * at(l, p, x, y); my += (y + 0.5 - 64.5) * at(l, p, x, y); }
      const cos = (mx * REACH_DIRS[k * 2] + my * REACH_DIRS[k * 2 + 1]) / Math.hypot(mx, my);
      expect(cos).toBeGreaterThan(Math.cos((2 * Math.PI) / 180));
    }
  });

  it("runs k clockwise from just below +x: sample 4 points down the screen", () => {
    const reach = new Array(16).fill(0);
    reach[4] = 2 * SQ;
    const l = rasterSidecar(sidecar([0, 0, 8 * SQ, 8 * SQ], { objects: objects([{ role: OR.ROCK, x: c, y: c, reach }]) }), { w: 128, h: 128 });
    const p = l.objects.get(OR.ROCK);
    let sx = 0, sy = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { sx += (x - 64) * at(l, p, x, y); sy += (y - 64) * at(l, p, x, y); }
    expect(sy).toBeGreaterThan(0);
    expect(Math.abs(sx)).toBeLessThan(sy * 0.3);
  });

  it("fills an even reach as a 16-gon, soft over about a pixel", () => {
    const l = rasterSidecar(sidecar([0, 0, 8 * SQ, 8 * SQ], { objects: objects([{ role: OR.EVERGREEN, x: c, y: c, reach: 2 * SQ }]) }), { w: 128, h: 128 });
    const p = l.objects.get(OR.EVERGREEN);
    // Radius 32 px; the 16-gon's edges dip to 32 * cos(11.25 deg) = 31.4 px between vertices.
    for (let k = 0; k < 16; k++) {
      const a = (2 * Math.PI * k) / 16;
      expect(at(l, p, Math.floor(64.5 + 29 * Math.cos(a)), Math.floor(64.5 + 29 * Math.sin(a)))).toBe(255);
      expect(at(l, p, Math.floor(64.5 + 34 * Math.cos(a)), Math.floor(64.5 + 34 * Math.sin(a)))).toBe(0);
    }
    let sum = 0;
    for (const v of p ?? []) sum += v / 255;
    // The samples are evenly spaced by diamond(), not by angle, so the 16-gon is a little uneven.
    let area = 0;
    for (let k = 0; k < 16; k++) {
      const j = (k + 1) & 15;
      area += 0.5 * 32 * 32 * (REACH_DIRS[k * 2] * REACH_DIRS[j * 2 + 1] - REACH_DIRS[k * 2 + 1] * REACH_DIRS[j * 2]);
    }
    expect(Math.abs(sum - area) / area).toBeLessThan(0.02);
    expect(l.top[64 * 128 + 64]).toBe(1);
  });

  it("re-derives an object's role from its stored name, whatever the name now gives, and keeps the stored role without one", () => {
    // A tree stored as DECIDUOUS whose table now says EVERGREEN; a stored "tree" whose name the
    // table now calls furniture (STRUCTURE, not a named role: a table fix still reaches it); and
    // an object without a name, which keeps its stored role.
    const names = ["vegetation/trees/pine_tree_02", "furniture/chair_01"];
    const l = rasterSidecar(sidecar([0, 0, 8 * SQ, 8 * SQ], {
      objects: objects([
        { role: OR.DECIDUOUS, x: 2 * SQ, y: 2 * SQ, reach: SQ / 2, name: 0 },
        { role: OR.DECIDUOUS, x: 6 * SQ, y: 6 * SQ, reach: SQ / 2, name: 1 },
        { role: OR.ROCK, x: 2 * SQ, y: 6 * SQ, reach: SQ / 2 },
      ]),
    }, names), { w: 64, h: 64 });
    expect([...l.objects.keys()].sort((a, b) => a - b)).toEqual([OR.EVERGREEN, OR.ROCK, OR.STRUCTURE].sort((a, b) => a - b));
    expect(at(l, l.objects.get(OR.EVERGREEN), 16, 16)).toBe(255);
    expect(at(l, l.objects.get(OR.STRUCTURE), 48, 48)).toBe(255);
    expect(at(l, l.objects.get(OR.ROCK), 16, 48)).toBe(255);
  });

  it("finds each pixel's sector in world directions on non-square pixels (a star at 4:1)", () => {
    // A 16-pointed star (reaches alternating 3 and 0.75 squares) on a square map drawn 128 x 32:
    // pixels 4 times as wide as tall. Every pixel more than a pixel from the outline is wholly in
    // or out; binning by the pixel-space direction picks the wrong edges in the star's notches.
    const reach = Array.from({ length: 16 }, (_, k) => (k % 2 ? 0.75 * SQ : 3 * SQ));
    const cw = 4 * SQ + 37, ch = 4 * SQ - 21;
    const l = rasterSidecar(sidecar([0, 0, 8 * SQ, 8 * SQ], { objects: objects([{ role: OR.ROCK, x: cw, y: ch, reach }]) }), { w: 128, h: 32 });
    const p = l.objects.get(OR.ROCK);
    const sx = 128 / (8 * SQ), sy = 32 / (8 * SQ);
    const vx: number[] = [], vy: number[] = [];
    for (let k = 0; k < 16; k++) {
      vx.push((cw + Math.round(reach[k] * 4) / 4 * REACH_DIRS[k * 2]) * sx);
      vy.push((ch + Math.round(reach[k] * 4) / 4 * REACH_DIRS[k * 2 + 1]) * sy);
    }
    const segDist = (px: number, py: number, k: number) => {
      const j = (k + 1) & 15, ex = vx[j] - vx[k], ey = vy[j] - vy[k];
      const t = Math.max(0, Math.min(1, ((px - vx[k]) * ex + (py - vy[k]) * ey) / (ex * ex + ey * ey)));
      return Math.hypot(px - vx[k] - t * ex, py - vy[k] - t * ey);
    };
    let checked = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 128; x++) {
        const px = x + 0.5, py = y + 0.5;
        let d = Infinity, inside = false;
        for (let k = 0; k < 16; k++) {
          d = Math.min(d, segDist(px, py, k));
          const j = (k + 1) & 15;
          if ((vy[k] > py) !== (vy[j] > py) && px < vx[k] + ((py - vy[k]) * (vx[j] - vx[k])) / (vy[j] - vy[k])) inside = !inside;
        }
        if (d < 1) continue;
        checked++;
        expect(at(l, p, x, y), `pixel ${x}, ${y}`).toBe(inside ? 255 : 0);
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it("names a pixel's top object only where its visible share reaches 50%", () => {
    const l = rasterSidecar(sidecar([0, 0, 8 * SQ, 8 * SQ], { objects: objects([{ role: OR.ROCK, x: 4 * SQ + 9, y: 4 * SQ - 5, reach: 1.3 * SQ }]) }), { w: 64, h: 64 });
    const p = l.objects.get(OR.ROCK) ?? new Uint8Array(0);
    let partial = 0, half = 0;
    for (let k = 0; k < p.length; k++) {
      // t >= 0.5 is round(255 t) >= 128, exactly.
      expect(l.top[k], `pixel ${k}`).toBe(p[k] >= 128 ? 1 : 0);
      if (p[k] > 0 && p[k] < 128) partial++;
      if (p[k] >= 128 && p[k] < 255) half++;
    }
    expect(partial).toBeGreaterThan(10);
    expect(half).toBeGreaterThan(10);
  });
});

describe("rasterSidecar: draw order", () => {
  const rect: [number, number, number, number] = [0, 0, 4 * SQ, 4 * SQ];
  const whole = box(0, 0, 4 * SQ, 4 * SQ);

  it("covers an earlier layer with a later one, whatever the table order", () => {
    const l = rasterSidecar(sidecar(rect, { shapes: [shape(AR.ROOF, 800, [box(SQ, SQ, 3 * SQ, 3 * SQ)]), shape(AR.FLOOR, -300, [whole])] }), { w: 16, h: 16 });
    expect(at(l, l.area.get(AR.ROOF), 8, 8)).toBe(255);
    expect(at(l, l.area.get(AR.FLOOR), 8, 8)).toBe(0);
    expect(at(l, l.area.get(AR.FLOOR), 1, 1)).toBe(255);
  });

  it("draws bitmaps, then shapes, then objects at an equal layer, then in table order", () => {
    const bm = bitmap(AR.CAVE, 0, SQ, SQ / 2, SQ / 2, ["####", "####", "####", "####"]);
    const sh = shape(AR.WATER, 0, [whole]);
    const ob = objects([{ role: OR.ROCK, x: 2 * SQ, y: 2 * SQ, reach: SQ, layer: 0 }]);
    const all = rasterSidecar(sidecar(rect, { bitmaps: [bm], shapes: [sh], objects: ob }), { w: 16, h: 16 });
    expect(at(all, all.objects.get(OR.ROCK), 8, 8)).toBe(255);
    expect(at(all, all.area.get(AR.WATER), 8, 8)).toBe(0);
    expect(at(all, all.area.get(AR.WATER), 1, 1)).toBe(255);
    expect(at(all, all.area.get(AR.CAVE), 1, 1)).toBe(0);
    const noObj = rasterSidecar(sidecar(rect, { bitmaps: [bm], shapes: [sh] }), { w: 16, h: 16 });
    expect(at(noObj, noObj.area.get(AR.WATER), 8, 8)).toBe(255);
    expect(at(noObj, noObj.area.get(AR.CAVE), 8, 8)).toBe(0);
    // Equal layer and kind: the later in the table is on top.
    const two = rasterSidecar(sidecar(rect, { shapes: [shape(AR.WATER, 5, [whole]), shape(AR.ICE, 5, [whole])] }), { w: 16, h: 16 });
    expect(at(two, two.area.get(AR.ICE), 8, 8)).toBe(255);
    expect(at(two, two.area.get(AR.WATER), 8, 8)).toBe(0);
  });

  it("attenuates what is below by 1 - c and adds c to its own role", () => {
    // Water everywhere; a floor over the left half of column 2 (x 0..2.5 px).
    const l = rasterSidecar(sidecar(rect, { shapes: [shape(AR.WATER, 0, [whole]), shape(AR.FLOOR, 1, [box(0, 0, 2.5 * 64, 4 * SQ)])] }), { w: 16, h: 16 });
    expect(at(l, l.area.get(AR.FLOOR), 2, 5)).toBe(128);
    expect(at(l, l.area.get(AR.WATER), 2, 5)).toBe(128);
    expect(at(l, l.area.get(AR.WATER), 1, 5)).toBe(0);
  });

  it("keeps terrain under everything, and names the top-most visible object", () => {
    const terrain = { tps: 1 as const, tx0: 0, ty0: 0, tw: 4, th: 4, slots: [{ name: NO_NAME, role: TR.SNOW }], w: new Uint8Array(16).fill(255) };
    const ob = objects([
      { role: OR.ROCK, x: 1.5 * SQ, y: 2 * SQ, reach: SQ / 2, layer: 100 },
      { role: OR.EVERGREEN, x: 2 * SQ, y: 2 * SQ, reach: SQ / 2, layer: 200 },
    ]);
    const roof = shape(AR.ROOF, 800, [box(0, 3 * SQ, 4 * SQ, 4 * SQ)]);
    const under = objects([{ role: OR.ROCK, x: 2 * SQ, y: 3.5 * SQ, reach: SQ / 4 }]);
    const l = rasterSidecar(sidecar(rect, { terrain, objects: ob, shapes: [roof] }), { w: 16, h: 16 });
    const snow = l.terrain.get(TR.SNOW);
    expect(at(l, snow, 0, 0)).toBe(255);
    expect(at(l, snow, 8, 8)).toBe(0);
    expect(at(l, snow, 8, 14)).toBe(0);
    expect(l.top[8 * 16 + 8]).toBe(2); // the evergreen, on top
    expect(l.top[8 * 16 + 5]).toBe(1); // the rock, where the evergreen doesn't reach
    expect(l.top[0]).toBe(0);
    const covered = rasterSidecar(sidecar(rect, { objects: under, shapes: [roof] }), { w: 16, h: 16 });
    expect(covered.top[14 * 16 + 8]).toBe(0);
    expect(at(covered, covered.objects.get(OR.ROCK), 8, 14)).toBe(0);
  });
});

describe("rasterSidecar: fill rules", () => {
  // A lake (squares 0..10), an island in it (3..7) and a pond on the island (4..6), at 8 px a square.
  const rings = [box(0, 0, 10 * SQ, 10 * SQ), box(3 * SQ, 3 * SQ, 7 * SQ, 7 * SQ), box(4 * SQ, 4 * SQ, 6 * SQ, 6 * SQ)];
  const rect: [number, number, number, number] = [0, 0, 10 * SQ, 10 * SQ];

  it("even-odd: water, the island dry, and the pond on the island wet", () => {
    const l = rasterSidecar(sidecar(rect, { shapes: [shape(AR.WATER, -50, rings, 0)] }), { w: 80, h: 80 });
    const p = l.area.get(AR.WATER);
    expect(at(l, p, 12, 12)).toBe(255); // the lake
    expect(at(l, p, 28, 28)).toBe(0); // the island
    expect(at(l, p, 40, 40)).toBe(255); // the pond
    expect(at(l, p, 23, 40)).toBe(255);
    expect(at(l, p, 24, 40)).toBe(0);
  });

  it("non-zero: the same rings, all one way round, fill everything; a reversed island is a hole", () => {
    const filled = rasterSidecar(sidecar(rect, { shapes: [shape(AR.WATER, -50, rings, 1)] }), { w: 80, h: 80 });
    expect(at(filled, filled.area.get(AR.WATER), 28, 28)).toBe(255);
    const rev = (r: number[]) => { const o: number[] = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; };
    const holed = rasterSidecar(sidecar(rect, { shapes: [shape(AR.WATER, -50, [rings[0], rev(rings[1])], 1)] }), { w: 80, h: 80 });
    expect(at(holed, holed.area.get(AR.WATER), 28, 28)).toBe(0);
    expect(at(holed, holed.area.get(AR.WATER), 12, 12)).toBe(255);
  });

  it("anti-aliases a diagonal edge and clips shapes far outside the picture", () => {
    const tri = shape(AR.PAVED, 0, [[0, 0, 10 * SQ, 0, 0, 10 * SQ], [-2147483648 / 16, -2147483648 / 16, 2147483647 / 16, -2147483648 / 16, 0, 2147483647 / 16]], 1);
    const l = rasterSidecar(sidecar(rect, { shapes: [tri] }), { w: 80, h: 80 });
    expect(l.area.get(AR.PAVED)?.every((v) => v === 255)).toBe(true);
    const half = rasterSidecar(sidecar(rect, { shapes: [shape(AR.PAVED, 0, [[0, 0, 10 * SQ, 0, 0, 10 * SQ]])] }), { w: 80, h: 80 });
    expect(at(half, half.area.get(AR.PAVED), 10, 69)).toBe(128); // on the diagonal
    expect(at(half, half.area.get(AR.PAVED), 10, 10)).toBe(255);
  });
});

describe("rasterSidecar: terrain", () => {
  it("samples slot planes bilinearly between texel centres, clamped, summed per runtime role", () => {
    // One square, 4 texels a square: texel centres at 32, 96, 160, 224.
    const w = new Uint8Array(4 * 4 * 3);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      w[y * 4 + x] = x * 60; // slot 0, named snow
      w[16 + y * 4 + x] = 255 - x * 60; // slot 1, stored rock
      w[32 + y * 4 + x] = 10; // slot 2, also rock (by its name)
    }
    const terrain = { tps: 4 as const, tx0: 0, ty0: 0, tw: 4, th: 4, w,
      slots: [{ name: 0, role: TR.KEEP }, { name: NO_NAME, role: TR.ROCK }, { name: 1, role: TR.KEEP }] };
    const sc = sidecar([0, 0, SQ, SQ], { terrain }, ["terrain_snow", "terrain_rocky"]);
    const at4 = rasterSidecar(sc, { w: 4, h: 4 });
    expect([...at4.terrain.keys()].sort()).toEqual([TR.SNOW, TR.ROCK].sort());
    expect([...(at4.terrain.get(TR.SNOW) ?? new Uint8Array(0)).subarray(0, 4)]).toEqual([0, 60, 120, 180]);
    expect([...(at4.terrain.get(TR.ROCK) ?? new Uint8Array(0)).subarray(0, 4)]).toEqual([255, 205, 145, 85]);
    const at8 = rasterSidecar(sc, { w: 8, h: 8 });
    // Pixel centres at 16, 48, 80, ...: the first clamps to texel 0, then quarter steps.
    expect([...(at8.terrain.get(TR.SNOW) ?? new Uint8Array(0)).subarray(0, 8)]).toEqual([0, 15, 45, 75, 105, 135, 165, 180]);
  });

  it("samples down the rows the same way (half a texel in, clamped)", () => {
    const w = new Uint8Array(16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) w[y * 4 + x] = y * 60;
    const terrain = { tps: 4 as const, tx0: 0, ty0: 0, tw: 4, th: 4, w, slots: [{ name: NO_NAME, role: TR.EARTH }] };
    const sc = sidecar([0, 0, SQ, SQ], { terrain });
    const col = (l: SidecarLayers) => Array.from({ length: l.h }, (_, y) => at(l, l.terrain.get(TR.EARTH), 0, y));
    expect(col(rasterSidecar(sc, { w: 4, h: 4 }))).toEqual([0, 60, 120, 180]);
    expect(col(rasterSidecar(sc, { w: 8, h: 8 }))).toEqual([0, 15, 45, 75, 105, 135, 165, 180]);
    // An offset crop down the map: texel rows 2 and 3 at 1 a square, centred at world 640 and 896.
    const off = { tps: 1 as const, tx0: 0, ty0: 2, tw: 1, th: 2, w: new Uint8Array([40, 240]), slots: [{ name: NO_NAME, role: TR.EARTH }] };
    const l = rasterSidecar(sidecar([0, 0, SQ, 4 * SQ], { terrain: off }), { w: 1, h: 8 });
    expect(col(l)).toEqual([40, 40, 40, 40, 40, 90, 190, 240]);
  });

  it("re-derives a slot's role from its stored name, KEEP included, and keeps the stored role without one", () => {
    // terrain_lava gives KEEP on purpose: a slot stored as SNOW under that name is KEEP now (a
    // table fix that moves a name to KEEP needs no re-attach). An unnamed slot keeps its role.
    const terrain = { tps: 1 as const, tx0: 0, ty0: 0, tw: 1, th: 1, w: new Uint8Array([100, 50, 30]),
      slots: [{ name: 0, role: TR.SNOW }, { name: NO_NAME, role: TR.ICE }, { name: 1, role: TR.KEEP }] };
    const l = rasterSidecar(sidecar([0, 0, SQ, SQ], { terrain }, ["terrain_lava", "terrain_grass"]), { w: 2, h: 2 });
    expect([...l.terrain.keys()].sort((a, b) => a - b)).toEqual([TR.ICE, TR.GRASS, TR.KEEP].sort((a, b) => a - b));
    expect(at(l, l.terrain.get(TR.KEEP), 0, 0)).toBe(100);
    expect(at(l, l.terrain.get(TR.ICE), 0, 0)).toBe(50);
    expect(at(l, l.terrain.get(TR.GRASS), 0, 0)).toBe(30);
  });

  it("reads an offset crop in absolute texels", () => {
    const terrain = { tps: 2 as const, tx0: 4, ty0: 0, tw: 2, th: 1, w: new Uint8Array([0, 200]), slots: [{ name: NO_NAME, role: TR.GRASS }] };
    // Texels 4 and 5 at 2 a square: centres at world 576 and 704; pixel centres at 32, 96, ...
    const l = rasterSidecar(sidecar([0, 0, 4 * SQ, SQ], { terrain }), { w: 16, h: 4 });
    const g = l.terrain.get(TR.GRASS) ?? new Uint8Array(0);
    expect([...g.subarray(0, 16)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 150, 200, 200, 200, 200, 200]);
  });
});

describe("rasterSidecar: limits", () => {
  it("throws only on a bad spec", () => {
    const sc = sidecar([0, 0, SQ, SQ]);
    expect(() => rasterSidecar(sc, { w: 0, h: 1 })).toThrow();
    expect(() => rasterSidecar(sc, { w: 1.5, h: 1 })).toThrow();
    expect(() => rasterSidecar(sc, { w: 4097, h: 4096 })).toThrow();
    expect(4096 * 4096).toBe(RASTER_MAX_PIXELS);
    const l = rasterSidecar(sc, { w: 1, h: 1 });
    expect(l.terrain.size + l.area.size + l.objects.size).toBe(0);
    expect(l.skipped).toBe(0);
  });

  it("gives the same bytes every time", () => {
    const sc = worstCase(0.02);
    const a = rasterSidecar(sc, { w: 333, h: 251 });
    const b = rasterSidecar(decodeSidecar(encodeSidecar(sc)), { w: 333, h: 251 });
    expect(digest(b)).toEqual(digest(a));
    expect(b.skipped).toBe(a.skipped);
    expect(a.objects.size).toBeGreaterThan(10);
  });

  it("leaves out the same drawables at every raster size, area drawables kept before objects", () => {
    // Water and a floor under 20,000 objects each as big as the map: the objects can't all fit.
    const side = 20 * SQ;
    const big = objects(Array.from({ length: SIDECAR_CAPS.objects }, (_, i) => ({
      role: OR.ROCK, x: side / 2 + (i % 50), y: side / 2, layer: 100 + (i % 7), reach: Array.from({ length: 16 }, (_, k) => (k % 2 ? 4000 : 9)),
    })));
    const sc = sidecar([0, 0, side, side], {
      shapes: [shape(AR.WATER, -50, [box(0, 0, side, side / 2)]), shape(AR.FLOOR, -300, [box(0, side / 2, side, side)])], objects: big,
    });
    const plan = rasterPlan(sc);
    expect(plan.skipped).toBeGreaterThan(SIDECAR_CAPS.objects / 2);
    expect(plan.work).toBeLessThanOrEqual(RASTER_BUDGET);
    const sizes = [[64, 64], [333, 251], [512, 512], [1024, 1024], [97, 1500]] as const;
    const drawn: number[] = [];
    for (const [w, h] of sizes) {
      const l = rasterSidecar(sc, { w, h });
      expect(l.skipped).toBe(plan.skipped);
      // Water and floor are drawn wherever the objects leave them visible.
      expect(at(l, l.area.get(AR.WATER), 0, 0)).toBe(255);
      expect(at(l, l.area.get(AR.FLOOR), 0, h - 1)).toBe(255);
      // The same objects drawn: the top-most object index anywhere is the same set at every size.
      const tops = new Set(l.top);
      tops.delete(0);
      drawn.push(Math.max(...tops));
    }
    expect(new Set(drawn).size).toBe(1);
    // The plan doesn't depend on the raster: an elongated map plans on its own 1024 px long side.
    const tall = sidecar([0, 0, side / 4, side], { objects: big });
    expect(rasterSidecar(tall, { w: 8, h: 32 }).skipped).toBe(rasterPlan(tall).skipped);
    expect(rasterSidecar(tall, { w: 256, h: 1024 }).skipped).toBe(rasterPlan(tall).skipped);
  });

  it("costs a drawable at least a unit a pixel it covers on the reference raster, and charges what it leaves out", () => {
    const side = 20 * SQ, px = 1024 * 1024;
    const empty = rasterPlan(sidecar([0, 0, side, side])).work;
    expect(empty).toBe(0);
    // A shape over the whole picture, one ring or many: its pixels count, not just its points.
    expect(rasterPlan(sidecar([0, 0, side, side], { shapes: [shape(AR.WATER, 0, [box(0, 0, side, side)])] })).work).toBeGreaterThan(px);
    // An object as big as the picture, round (its rows and pixels) or a star (most of it tested).
    const round = objects([{ role: OR.ROCK, x: side / 2, y: side / 2, reach: side }]);
    expect(rasterPlan(sidecar([0, 0, side, side], { objects: round })).work).toBeGreaterThan(px);
    const star = objects([{ role: OR.ROCK, x: side / 2, y: side / 2, reach: Array.from({ length: 16 }, (_, k) => (k % 2 ? side : 1)) }]);
    expect(rasterPlan(sidecar([0, 0, side, side], { objects: star })).work).toBeGreaterThan(10 * px);
    // Left out, each still costs its planning: 20,000 such stars cost more than 10,000, though
    // the same few are drawn.
    const stars = (n: number) => rasterPlan(sidecar([0, 0, side, side], {
      objects: objects(Array.from({ length: n }, () => ({ role: OR.ROCK, x: side / 2, y: side / 2, reach: Array.from({ length: 16 }, (_, k) => (k % 2 ? side : 1)) }))),
    }));
    const half = stars(SIDECAR_CAPS.objects / 2), all = stars(SIDECAR_CAPS.objects);
    expect(all.skipped - half.skipped).toBe(SIDECAR_CAPS.objects / 2);
    expect(all.work).toBeGreaterThan(half.work + SIDECAR_CAPS.objects / 2);
    expect(all.work).toBeLessThanOrEqual(RASTER_BUDGET);
  });

  it("plans a big real map without leaving anything out", () => {
    // 100 x 100 squares: 5,000 objects of about a square, 400 floors and paths, a cave, 4 terrain roles.
    const plan = rasterPlan(bigMap());
    expect(plan.skipped).toBe(0);
    expect(plan.work).toBeLessThan(RASTER_BUDGET * 0.75);
  });

  it("rasterises the capped worst cases at 1024 px in under 150 ms (timed and reported)", () => {
    const results: string[] = [];
    const spread = worstCase(1);
    const cases: Array<[string, SeasonSidecar]> = [
      ["capped, spread", spread],
      ["capped, all over the picture", hostile()],
      ["20,000 small shapes and 16 full bitmaps", shapesAndBitmaps()],
      ["terrain at its cap and 7 full bitmaps", { ...shapesAndBitmaps(0, 7), terrain: cappedTerrain() }],
      ["20,000 small shapes of 3 points", smallShapes(3)],
      ["20,000 star objects", stars()],
    ];
    for (const [name, sc] of cases) {
      expect(encodeSidecar(sc).length).toBeLessThanOrEqual(16 + SIDECAR_CAPS.bytes); // a sidecar decodeSidecar accepts
      rasterSidecar(sc, { w: 256, h: 256 }); // warm up
      const times: number[] = [];
      let l: SidecarLayers | null = null;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        l = rasterSidecar(sc, { w: 1024, h: 1024 });
        times.push(performance.now() - t0);
      }
      const best = Math.min(...times);
      results.push(`${name}: ${best.toFixed(0)} ms (skipped ${l?.skipped}, ${(rasterPlan(sc).work / 1e6).toFixed(0)}M units)`);
      // The target is 150 ms on a desktop. Timed alone (PERF=1) the bound leaves a third more;
      // in the full suite, where test files run side by side, it only catches a real slowdown.
      const perf = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PERF;
      expect(best).toBeLessThan(perf ? 200 : 600);
    }
    console.log(`rasterSidecar at 1024 px: ${results.join("; ")}`);
  });
});

/**
 * A sidecar at the caps, laid out like a big real map (200 x 200 squares): every object, ring and
 * shape point, then what the 8 MiB payload leaves: 3 MiB of terrain and one 4 Mbit bitmap. Scale < 1
 * shrinks the counts.
 */
function worstCase(scale: number): SeasonSidecar {
  const side = 200 * SQ;
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const nObj = Math.round(SIDECAR_CAPS.objects * scale);
  const roles = Object.values(OR);
  const list: Obj[] = [];
  for (let i = 0; i < nObj; i++) {
    list.push({ role: roles[i % roles.length], x: rand() * side, y: rand() * side, layer: Math.floor(rand() * 600) - 300,
      reach: Array.from({ length: 16 }, () => (0.5 + rand()) * SQ) });
  }
  // Shapes: the ring and point caps, as 1,000 shapes of 20 rings of 20 points.
  const shapes: ShapeLayer[] = [];
  const nShapes = Math.round(1000 * scale);
  const aroles = Object.values(AR);
  for (let s = 0; s < nShapes; s++) {
    const rings: number[][] = [];
    for (let r = 0; r < 20; r++) {
      const cx = rand() * side, cy = rand() * side, rad = (0.5 + rand() * 3) * SQ;
      const ring: number[] = [];
      for (let k = 0; k < 20; k++) ring.push(cx + rad * Math.cos((k * Math.PI) / 10), cy + rad * Math.sin((k * Math.PI) / 10));
      rings.push(ring);
    }
    shapes.push(shape(aroles[s % aroles.length], Math.floor(rand() * 1200) - 400, rings, (s & 1) as 0 | 1));
  }
  // A bitmap of 4 Mbit (2048 x 2048 samples at 25 world units: the whole map).
  const bitmaps: BitmapLayer[] = [];
  for (let b = 0; b < 1; b++) {
    const n = 2048;
    const bits = new Uint8Array((n * n) / 8);
    for (let i = 0; i < bits.length; i++) bits[i] = rand() < 0.5 ? 0xff : rand() * 256;
    bitmaps.push({ role: aroles[b % aroles.length], layer: -400 + b, step: 25, ox: 0, oy: 0, w: n, h: n, bits });
  }
  // Terrain: 3 MiB of planes, 8 slots of 512 x 768 texels.
  const tw = 512, th = 768, ns = 8;
  const w = new Uint8Array(tw * th * ns);
  for (let i = 0; i < w.length; i++) w[i] = (i * 2654435761) >>> 24;
  const terrain = { tps: 4 as const, tx0: 0, ty0: 0, tw, th, w,
    slots: Array.from({ length: ns }, (_, s) => ({ name: NO_NAME, role: (s + 1) as (typeof TR)[keyof typeof TR] })) };
  return sidecar([0, 0, side, side], { terrain, bitmaps, shapes, objects: objects(list) });
}

/**
 * The caps spent on covering the whole picture (20 squares) many times over: every object as big
 * as it can be, every ring a zig-zag across it, 16 bitmaps of a few huge samples.
 */
function hostile(): SeasonSidecar {
  const side = 20 * SQ;
  const list: Obj[] = [];
  for (let i = 0; i < SIDECAR_CAPS.objects; i++) {
    list.push({ role: OR.OPAQUE, x: side / 2, y: side / 2, layer: i % 7, reach: Array.from({ length: 16 }, (_, k) => (k % 2 ? 16383 : 1)) });
  }
  const shapes: ShapeLayer[] = [];
  // 20,000 rings of 20 points, each a zig-zag spanning the picture (many crossings a row).
  for (let s = 0; s < 1000; s++) {
    const rings: number[][] = [];
    for (let r = 0; r < 20; r++) {
      const ring: number[] = [];
      for (let k = 0; k < 20; k++) ring.push(((k * 37 + r) % 20) * (side / 19), k % 2 ? 0 : side);
      rings.push(ring);
    }
    shapes.push(shape(AR.WATER, s, rings, 1));
  }
  const bitmaps: BitmapLayer[] = [];
  for (let b = 0; b < 16; b++) {
    bitmaps.push({ role: AR.CAVE, layer: 1000, step: 4096, ox: -2048, oy: -2048, w: 3, h: 3, bits: new Uint8Array([0x55, 0]) });
  }
  return sidecar([0, 0, side, side], { bitmaps, shapes, objects: objects(list) });
}

/** 20,000 shapes of 20 points, each a small circle on the picture, over 16 bitmaps of random bits as big as the payload allows. */
function shapesAndBitmaps(nShapes: number = SIDECAR_CAPS.rings, nBitmaps = 16): SeasonSidecar {
  const side = 20 * SQ;
  let seed = 99;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const shapes: ShapeLayer[] = [];
  for (let s = 0; s < nShapes; s++) {
    const cx = rand() * side, cy = rand() * side, ring: number[] = [];
    for (let k = 0; k < 20; k++) ring.push(cx + 2.5 * Math.cos((k * Math.PI) / 10), cy + 2.5 * Math.sin((k * Math.PI) / 10));
    shapes.push(shape(AR.WATER, 30000, [ring], 1));
  }
  // 16 x 1448^2 bits fill what the payload's 8 MiB leaves; step 4 puts several samples in a pixel.
  const bitmaps: BitmapLayer[] = [];
  for (let b = 0; b < nBitmaps; b++) {
    const n = 1448;
    const bits = new Uint8Array(Math.ceil((n * n) / 8));
    for (let i = 0; i < bits.length; i++) bits[i] = (rand() * 256) | 0;
    bits[bits.length - 1] &= (1 << ((n * n) & 7)) - 1;
    bitmaps.push({ role: AR.CAVE, layer: b, step: 4, ox: 0, oy: 0, w: n, h: n, bits });
  }
  return sidecar([0, 0, side, side], { shapes, bitmaps });
}

/** Terrain at its cap: 8 slots of every terrain role, 6 MiB of planes. */
function cappedTerrain(): NonNullable<SeasonSidecar["terrain"]> {
  const tw = 512, th = 1536, ns = 8;
  const w = new Uint8Array(tw * th * ns);
  for (let i = 0; i < w.length; i++) w[i] = (i * 2654435761) >>> 24;
  return { tps: 4, tx0: 0, ty0: 0, tw, th, w, slots: Array.from({ length: ns }, (_, s) => ({ name: NO_NAME, role: (s + 1) as (typeof TR)[keyof typeof TR] })) };
}

/** 20,000 shapes of n points, small (the fixed cost a shape). */
function smallShapes(n: number): SeasonSidecar {
  const side = 20 * SQ;
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const shapes: ShapeLayer[] = [];
  for (let s = 0; s < SIDECAR_CAPS.rings; s++) {
    const cx = rand() * side, cy = rand() * side, ring: number[] = [];
    for (let k = 0; k < n; k++) ring.push(cx + 3 * Math.cos((2 * k * Math.PI) / n), cy + 3 * Math.sin((2 * k * Math.PI) / n));
    shapes.push(shape(AR.FLOOR, s % 100, [ring], (s & 1) as 0 | 1));
  }
  return sidecar([0, 0, side, side], { shapes });
}

/** 20,000 objects of a square or so, every one a star (deep notches: most of the box is tested). */
function stars(): SeasonSidecar {
  const side = 20 * SQ;
  let seed = 3;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const list: Obj[] = [];
  for (let i = 0; i < SIDECAR_CAPS.objects; i++) {
    list.push({ role: OR.ROCK, x: rand() * side, y: rand() * side, layer: i % 50, reach: Array.from({ length: 16 }, (_, k) => (k % 2 ? 200 : 1)) });
  }
  return sidecar([0, 0, side, side], { objects: objects(list) });
}

/** A big real map: 100 x 100 squares, 5,000 objects of about a square, 400 floors and paths, a cave, 4 terrain roles. */
function bigMap(): SeasonSidecar {
  const n = 100, side = n * SQ;
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const list: Obj[] = [];
  for (let i = 0; i < 5000; i++) {
    const r = (0.4 + rand() * 0.4) * SQ; // measured: within 10% of a smooth outline
    list.push({ role: (i % 3 ? OR.EVERGREEN : OR.SHRUB), x: rand() * side, y: rand() * side, layer: 100 + (i % 4),
      reach: Array.from({ length: 16 }, () => r * (0.9 + rand() * 0.2)) });
  }
  const shapes: ShapeLayer[] = [];
  for (let s = 0; s < 200; s++) {
    const x = rand() * side, y = rand() * side, a = (1 + rand() * 6) * SQ, b = (1 + rand() * 6) * SQ;
    shapes.push(shape(AR.FLOOR, -300, [box(x, y, x + a, y + b)]));
  }
  for (let s = 0; s < 200; s++) {
    // A path: a ribbon half a square wide, 10 to 30 squares long, at any angle.
    const x = rand() * side, y = rand() * side, len = (10 + rand() * 20) * SQ, ang = rand() * 2 * Math.PI;
    const dx = Math.cos(ang), dy = Math.sin(ang), hw = SQ / 4;
    shapes.push(shape(AR.PATH_EARTH, 50, [[x - dy * hw, y + dx * hw, x + len * dx - dy * hw, y + len * dy + dx * hw,
      x + len * dx + dy * hw, y + len * dy - dx * hw, x + dy * hw, y - dx * hw]]));
  }
  // A cave over a quarter of the map.
  const cw = n * 2, bits = new Uint8Array((cw * cw) / 8);
  for (let i = 0; i < bits.length; i++) bits[i] = rand() < 0.3 ? 0xff : 0;
  // Terrain as Dungeondraft saves it: snow everywhere but where rock, earth and sand are painted
  // (blobs over about 40% of the map in all), the weights of a texel summing to 255.
  const tw = n * 4, texels = tw * tw, w = new Uint8Array(texels * 4);
  const blobs = Array.from({ length: 60 }, () => [rand() * tw, rand() * tw, 5 + rand() * 25, 1 + Math.floor(rand() * 3)]);
  for (let y = 0; y < tw; y++) for (let x = 0; x < tw; x++) {
    let left = 255;
    for (const [bx, by, br, s] of blobs) {
      const d = Math.hypot(x - bx, y - by);
      if (d < br && w[s * texels + y * tw + x] === 0) {
        const v = Math.min(left, Math.round(255 * Math.min(1, (br - d) / 4)));
        w[s * texels + y * tw + x] = v;
        left -= v;
      }
    }
    w[y * tw + x] = left;
  }
  const terrain = { tps: 4 as const, tx0: 0, ty0: 0, tw, th: tw, w,
    slots: [{ name: NO_NAME, role: TR.SNOW }, { name: NO_NAME, role: TR.ROCK }, { name: NO_NAME, role: TR.EARTH }, { name: NO_NAME, role: TR.SAND }] };
  return sidecar([0, 0, side, side], { terrain, shapes, objects: objects(list),
    bitmaps: [{ role: AR.CAVE, layer: -350, step: 64, ox: 32, oy: 32, w: cw, h: cw, bits }] });
}

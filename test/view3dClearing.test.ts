// The painted trees taken off the 3D floor (room/view3dClearing.ts), and which of a map's things
// they are (room/view3dMapData.ts mapHoles, withoutStanding): on made-up pictures of textured
// ground with dark green discs painted on it.
import { describe, expect, it } from "vitest";
import { AR, OR } from "../src/client/dd/roles";
import { NO_NAME, REACH_N, SIDECAR_UNITS, type ObjectTable } from "../src/client/dd/sidecar";
import { Clearing, clearingMasks, reachAt, type ClearingMasks, type Hole } from "../src/client/room/view3dClearing";
import { mapHoles, mapObjects, withoutStanding } from "../src/client/room/view3dMapData";

const W = 160, H = 120;

/** Ground: a grey from `left` to `right` across, with a fine texture on it. */
function ground(left = 210, right = 210): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const base = left + ((right - left) * x) / (W - 1);
      const tex = (((x * 7 + y * 13) % 17) - 8) * 1.5;
      const p = (y * W + x) * 4;
      px.set([base + tex, base + tex + 4, base + tex + 10, 255], p);
    }
  }
  return px;
}

/** A painted tree: a dark green disc with a darker edge. */
function paintTree(px: Uint8ClampedArray, cx: number, cy: number, r: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < r) px.set(d > r - 2 ? [10, 40, 15, 255] : [30, 95, 40, 255], (y * W + x) * 4);
    }
  }
}

const round = (cx: number, cy: number, r: number): Hole => ({ x: cx, y: cy, r: new Float64Array(16).fill(r) });

const green = (px: Uint8ClampedArray, p: number) => px[p * 4 + 1] - px[p * 4] > 25 && px[p * 4] < 120;

function run(px: Uint8ClampedArray, holes: Hole[], masks: ClearingMasks | null = null): Clearing {
  const job = new Clearing(W, H, px, holes, masks);
  expect(job.step(() => false)).toBe(true);
  return job;
}

function inDisc(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r) out.push(y * W + x);
  return out;
}

describe("taking painted trees off the floor", () => {
  it("fills a tree's footprint, its painted edge too, with ground like that round it, and leaves the rest alone", () => {
    const px = ground();
    paintTree(px, 80, 60, 16);
    run(px, [round(80, 60, 16)]);
    for (const p of inDisc(80, 60, 16)) {
      expect(px[p * 4 + 3]).toBe(255);
      expect(green(px, p)).toBe(false);
      expect(px[p * 4]).toBeGreaterThan(185);
    }
    // Outside its grown footprint: see-through, so the picture shows as it was.
    for (const p of [0, W * H - 1, 60 * W + 80 + 25]) expect(px[p * 4 + 3]).toBe(0);
  });

  it("matches the ground's colour where it changes across the map, with no seam", () => {
    const px = ground(60, 220);
    paintTree(px, 80, 60, 16);
    run(px, [round(80, 60, 16)]);
    const expected = (x: number) => 60 + (160 * x) / (W - 1);
    for (const x of [66, 80, 94]) {
      const p = 60 * W + x;
      expect(Math.abs(px[p * 4] - expected(x))).toBeLessThan(22);
    }
  });

  it("leaves a building or water under a tree as painted", () => {
    const px = ground();
    paintTree(px, 80, 60, 16);
    // The map's right half is kept (a building).
    const keep = new Uint8Array(W * H).map((_, p) => (p % W >= 80 ? 1 : 0));
    run(px, [round(80, 60, 16)], { w: W, h: H, keep, avoid: new Uint8Array(W * H) });
    expect(px[(60 * W + 72) * 4 + 3]).toBe(255);
    expect(green(px, 60 * W + 72)).toBe(false);
    expect(px[(60 * W + 88) * 4 + 3]).toBe(0);
    expect(green(px, 60 * W + 88)).toBe(true);
  });

  it("never copies something else painted on the ground", () => {
    const px = ground();
    paintTree(px, 80, 60, 12);
    // Red crates all round it, a little way off.
    const avoid = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - 80, y - 60);
        if (d > 22 && d < 34) {
          px.set([200, 30, 30, 255], (y * W + x) * 4);
          avoid[y * W + x] = 1;
        }
      }
    }
    run(px, [round(80, 60, 12)], { w: W, h: H, keep: new Uint8Array(W * H), avoid });
    for (const p of inDisc(80, 60, 12)) {
      expect(px[p * 4] - px[p * 4 + 1]).toBeLessThan(60);
      expect(green(px, p)).toBe(false);
    }
  });

  it("clears a wood of trees grown together, from its edge in", () => {
    const px = ground();
    const holes: Hole[] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        paintTree(px, 50 + i * 18, 40 + j * 18, 12);
        holes.push(round(50 + i * 18, 40 + j * 18, 12));
      }
    }
    run(px, holes);
    let left = 0;
    for (let p = 0; p < W * H; p++) if (green(px, p) && px[p * 4 + 3] === 255) left++;
    let painted = 0;
    for (const h of holes) for (const p of inDisc(h.x, h.y, 12)) if (px[p * 4 + 3] !== 255) painted++;
    expect(left).toBe(0);
    expect(painted).toBe(0);
  });

  it("does the work a slice at a time, to the same end", () => {
    const a = ground(), b = ground();
    for (const px of [a, b]) {
      paintTree(px, 60, 50, 14);
      paintTree(px, 100, 70, 10);
    }
    const holes = [round(60, 50, 14), round(100, 70, 10)];
    run(a, holes);
    const job = new Clearing(W, H, b, holes, null);
    let steps = 1;
    while (!job.step(() => true)) steps++;
    expect(steps).toBeGreaterThan(2);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("follows a footprint's reach in each direction", () => {
    const r = new Float64Array(16).fill(10);
    expect(reachAt(r, 1)).toBeCloseTo(10);
    r[0] = 20; // just below +x
    expect(reachAt(r, 0.2)).toBeGreaterThan(18);
    expect(reachAt(r, Math.PI)).toBeCloseTo(10);
  });
});

describe("which things come off, and what's under them", () => {
  it("keeps buildings, water and cliffs, and avoids copying anything but grass, flowers and the like", () => {
    const area = new Map([[AR.WALL, Uint8Array.from([255, 100, 0, 0])], [AR.PATH_KEEP, Uint8Array.from([0, 0, 200, 0])]]);
    const top = Uint16Array.from([0, 1, 2, 0]);
    const m = clearingMasks({ w: 4, h: 1, area: area as never, top }, [OR.GRASS, OR.OPAQUE]);
    expect(Array.from(m.keep)).toEqual([1, 0, 1, 0]);
    expect(Array.from(m.avoid)).toEqual([0, 0, 1, 0]);
  });

  /** A pine, a grass tuft and a pebble: only the pine stands up. */
  function table(): ObjectTable {
    const n = 3, reach = new Uint16Array(n * REACH_N);
    const world = [128, 128, 10];
    for (let i = 0; i < n; i++) reach.fill(world[i] * SIDECAR_UNITS.reach, i * REACH_N, (i + 1) * REACH_N);
    const at = (v: number) => v * 256 * SIDECAR_UNITS.coord;
    return {
      n,
      role: Uint8Array.from([OR.EVERGREEN, OR.GRASS, OR.ROCK]),
      layer: new Int16Array(n),
      x: Int32Array.from([at(4), at(6), at(8)]),
      y: Int32Array.from([at(3), at(5), at(7)]),
      rot: new Uint8Array(n),
      flags: new Uint8Array(n),
      name: new Uint16Array(n).fill(NO_NAME),
      reach,
    };
  }
  const place = { rect: [0, 0, 16 * 256, 12 * 256] as const, width: 1600, height: 1200 };

  it("takes off just what stands up, where the picture paints it, as far as it reaches", () => {
    const t = table();
    const holes = mapHoles(t, { names: [] }, place, 100, 0.48);
    expect(holes).toHaveLength(mapObjects(t, { names: [] }, place, 100).length);
    expect(holes).toHaveLength(1);
    expect(holes[0].x).toBeCloseTo(192);
    expect(holes[0].y).toBeCloseTo(144);
    // Half a square at 48 pixels a square.
    for (const r of holes[0].r) expect(r).toBeCloseTo(24, 0);
  });

  it("draws the map data without what stands up, so what's under it shows", () => {
    const rest = withoutStanding(table(), { names: [] }, place, 100);
    expect(rest.n).toBe(2);
    expect(Array.from(rest.role)).toEqual([OR.GRASS, OR.ROCK]);
    expect(rest.reach.length).toBe(2 * REACH_N);
    expect(rest.x[0]).toBe(6 * 256 * SIDECAR_UNITS.coord);
  });
});

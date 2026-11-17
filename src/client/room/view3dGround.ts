// High and low ground in the 3D view (view3d.ts): a cliff is a drop, so the land on one side of it
// is level with its top and the land on the other side lies below. Most of the map (the part the
// play is on) stays level with the cliffs' tops; what the cliffs cut off from it lies a cliff's
// height lower, and everything standing on it (objects, walls, figures, spells) with it. The
// cliffs (Dungeondraft's own, or found in the picture: view3dCliffs.ts, view3dFound.ts) are walls
// between the two: pieces a few squares apart are taken as one cliff (a building often stands in
// the gap), and an end near the map's edge as running to it. Cliffs that cut nothing off leave
// the ground flat, and stand up as ridges as before. Kept apart from three.js, so it's tested.

import { cliffHeight, type Cliff3d } from "./view3dCliffs";

/** The ground: which of its cells (4 a square) lie low, and how far down, in squares. */
export interface Ground {
  /** Scene units of its top-left, and its cells a scene unit. */
  x0: number;
  y0: number;
  k: number;
  w: number;
  h: number;
  low: Uint8Array;
  drop: number;
  /**
   * How far each cell's floor stands above the ground, in squares (17 November 2026: Dungeon's
   * raised floors). It lifts the floor and what's on it (objects, figures, spells), not walls or
   * roofs, which stand from the ground. Missing: none.
   */
  raise?: Float32Array;
}

/** A raised floor, as a source gives it: its polygon's rings (flat x, y lists in scene units: the outline, then holes) and how high it stands, in squares. */
export interface RaisedFloor {
  rings: readonly (readonly number[])[];
  h: number;
}

/** Cells a square. */
const PER_SQUARE = 4;
/** Cliff ends this close (squares) are one cliff; an end this close to the map's edge runs to it. */
const JOIN = 3;
const EDGE = 3;
/** Land cut off smaller than this (square squares) is a nook, not low ground. */
const SMALLEST = 2;

type Seg = { ax: number; ay: number; bx: number; by: number; r: number };

/**
 * The ground for these cliffs over the scene's area (scene units; `cell` a square in them), or null
 * when they cut nothing off (or there are none).
 */
export function groundOf(cliffs: readonly Cliff3d[], area: { x0: number; y0: number; x1: number; y1: number }, cell: number): Ground | null {
  if (!cliffs.length || !(cell > 0)) return null;
  const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
  const k = Math.min(PER_SQUARE / cell, 512 / Math.max(aw, ah));
  const w = Math.max(1, Math.ceil(aw * k)), h = Math.max(1, Math.ceil(ah * k));
  const segs: Seg[] = [];
  const ends: { x: number; y: number; r: number; cliff: number; dir: [number, number] }[] = [];
  cliffs.forEach((c, ci) => {
    const r = Math.max(c.halfWidth, 0.6 / k);
    const n = c.pts.length / 2;
    for (let i = 1; i < n; i++) segs.push({ ax: c.pts[i * 2 - 2], ay: c.pts[i * 2 - 1], bx: c.pts[i * 2], by: c.pts[i * 2 + 1], r });
    if (n >= 2) {
      // Each end, and which way the cliff runs out of it.
      const dir = (x0: number, y0: number, x1: number, y1: number): [number, number] => {
        const l = Math.hypot(x1 - x0, y1 - y0) || 1;
        return [(x1 - x0) / l, (y1 - y0) / l];
      };
      ends.push({ x: c.pts[0], y: c.pts[1], r, cliff: ci, dir: dir(c.pts[2], c.pts[3], c.pts[0], c.pts[1]) });
      ends.push({ x: c.pts[n * 2 - 2], y: c.pts[n * 2 - 1], r, cliff: ci, dir: dir(c.pts[n * 2 - 4], c.pts[n * 2 - 3], c.pts[n * 2 - 2], c.pts[n * 2 - 1]) });
    }
  });
  // An end near another cliff's end is joined to it; else near the map's edge, run to the edge.
  const joined = new Set<number>();
  ends.forEach((e, i) => {
    let best = -1, bestD = JOIN * cell;
    ends.forEach((f, j) => {
      if (j === i || f.cliff === e.cliff) return;
      const d = Math.hypot(f.x - e.x, f.y - e.y);
      if (d < bestD) [best, bestD] = [j, d];
    });
    if (best >= 0) {
      if (!joined.has(best)) segs.push({ ax: e.x, ay: e.y, bx: ends[best].x, by: ends[best].y, r: Math.min(e.r, ends[best].r) });
      joined.add(i);
      joined.add(best);
    }
  });
  ends.forEach((e, i) => {
    if (joined.has(i)) return;
    const edges: [number, number, number][] = [
      [e.x - area.x0, area.x0, e.y],
      [area.x1 - e.x, area.x1, e.y],
      [e.y - area.y0, e.x, area.y0],
      [area.y1 - e.y, e.x, area.y1],
    ];
    const [d, ex, ey] = edges.sort((a, b) => a[0] - b[0])[0];
    if (d <= EDGE * cell) segs.push({ ax: e.x, ay: e.y, bx: ex, by: ey, r: e.r });
  });
  // The cliffs as walls on the grid.
  const wall = new Uint8Array(w * h);
  for (const s of segs) {
    const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - s.r - area.x0) * k)), x1 = Math.min(w - 1, Math.ceil((Math.max(s.ax, s.bx) + s.r - area.x0) * k));
    const y0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - s.r - area.y0) * k)), y1 = Math.min(h - 1, Math.ceil((Math.max(s.ay, s.by) + s.r - area.y0) * k));
    const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1;
    for (let j = y0; j <= y1; j++) {
      const py = area.y0 + (j + 0.5) / k;
      for (let i = x0; i <= x1; i++) {
        const px = area.x0 + (i + 0.5) / k;
        const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / l2));
        if (Math.hypot(px - s.ax - dx * t, py - s.ay - dy * t) <= s.r) wall[j * w + i] = 1;
      }
    }
  }
  // The ground's parts between them.
  const part = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (wall[s0] || part[s0] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    part[s0] = id;
    stack.push(s0);
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1]) {
        if (q < 0 || wall[q] || part[q] >= 0) continue;
        part[q] = id;
        stack.push(q);
      }
    }
    sizes.push(n);
  }
  if (sizes.length < 2) return null;
  const main = sizes.indexOf(Math.max(...sizes));
  const least = SMALLEST * PER_SQUARE * PER_SQUARE;
  const low = new Uint8Array(w * h);
  let any = false;
  for (let p = 0; p < w * h; p++) {
    const id = part[p];
    if (id >= 0 && id !== main && sizes[id] >= least) {
      low[p] = 1;
      any = true;
    }
  }
  if (!any) return null;
  const drop = Math.max(...cliffs.map((c) => cliffHeight(c.halfWidth / cell)));
  return { x0: area.x0, y0: area.y0, k, w, h, low, drop };
}

/** The ground's height at a scene point, in squares: 0 on the main ground, minus the drop below the cliffs. */
export function heightAt(g: Ground | null, x: number, y: number): number {
  if (!g) return 0;
  const i = Math.floor((x - g.x0) * g.k), j = Math.floor((y - g.y0) * g.k);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 0;
  return g.low[j * g.w + i] ? -g.drop : 0;
}

/** Lowers a mesh's corners (positions in squares, three a corner) to the ground under each. */
export function onGround(position: Float32Array, g: Ground | null, cell: number): void {
  if (!g) return;
  for (let i = 0; i < position.length; i += 3) position[i + 1] += heightAt(g, position[i] * cell, position[i + 2] * cell);
}

/** The floor's height at a scene point, in squares: the ground's, and a raised floor's on it. */
export function floorAt(g: Ground | null, x: number, y: number): number {
  if (!g) return 0;
  const base = heightAt(g, x, y);
  if (!g.raise) return base;
  const i = Math.floor((x - g.x0) * g.k), j = Math.floor((y - g.y0) * g.k);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return base;
  return base + g.raise[j * g.w + i];
}

/** Puts a mesh's corners (positions in squares) on the floor under each: the ground, and a raised floor. */
export function onFloor(position: Float32Array, g: Ground | null, cell: number): void {
  if (!g) return;
  for (let i = 0; i < position.length; i += 3) position[i + 1] += floorAt(g, position[i] * cell, position[i + 2] * cell);
}

/**
 * The ground with raised floors on it: a ground of its own (flat, its cells as groundOf's) when
 * there are raised floors and no cliffs, the same ground when there are none. A cell stands as high
 * as the raised floor its middle is in (the rings even-odd, so holes stay down).
 */
export function withRaised(g: Ground | null, raised: readonly RaisedFloor[], area: { x0: number; y0: number; x1: number; y1: number }, cell: number): Ground | null {
  if (!raised.length || !(cell > 0)) return g;
  const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
  const k = g ? g.k : Math.min(PER_SQUARE / cell, 512 / Math.max(aw, ah));
  const w = g ? g.w : Math.max(1, Math.ceil(aw * k)), h = g ? g.h : Math.max(1, Math.ceil(ah * k));
  const x0 = g ? g.x0 : area.x0, y0 = g ? g.y0 : area.y0;
  const raise = new Float32Array(w * h);
  let any = false;
  for (const r of raised) {
    if (!(r.h > 0) || !r.rings.length) continue;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const ring of r.rings) for (let i = 0; i + 1 < ring.length; i += 2) {
      bx0 = Math.min(bx0, ring[i]);
      bx1 = Math.max(bx1, ring[i]);
      by0 = Math.min(by0, ring[i + 1]);
      by1 = Math.max(by1, ring[i + 1]);
    }
    const i0 = Math.max(0, Math.floor((bx0 - x0) * k)), i1 = Math.min(w - 1, Math.ceil((bx1 - x0) * k));
    const j0 = Math.max(0, Math.floor((by0 - y0) * k)), j1 = Math.min(h - 1, Math.ceil((by1 - y0) * k));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) / k;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) / k;
        let inside = false;
        for (const ring of r.rings) {
          const n = ring.length / 2;
          for (let a = 0, b = n - 1; a < n; b = a++) {
            const ax = ring[a * 2], ay = ring[a * 2 + 1], bx = ring[b * 2], by = ring[b * 2 + 1];
            if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
          }
        }
        if (inside) {
          raise[j * w + i] = r.h;
          any = true;
        }
      }
    }
  }
  if (!any) return g;
  return g ? { ...g, raise } : { x0, y0, k, w, h, low: new Uint8Array(w * h), drop: 0, raise };
}

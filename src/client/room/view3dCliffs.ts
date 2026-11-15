// Cliffs in the 3D view (view3d.ts): a Dungeondraft map's cliff paths (its own or an asset pack's), from its map data (the
// sidecar's CLIF: dd/sidecar.ts), stand up as rock faces along where the picture paints them: a
// ridge as wide as the cliff is drawn, its height going up and down a little like rock, in the
// colour the picture paints it. As with walls, a stretch a player hasn't seen doesn't stand up.
// Which side of a cliff is the high ground the data doesn't say, so the ridge rises from both.
// Kept apart from three.js, so it's tested.

import type { CliffLine } from "../dd/sidecar";
import { SIDECAR_UNITS } from "../dd/sidecar";
import { toScene, type MapPlacement } from "./view3dMapData";
import { WALL_SEEN, brightnessAt, paintAt, shadeOf, wallTint, type CoverMap, type PaintMap, type WallMesh } from "./view3dModel";

/** A cliff in the scene: its centre line and half its width, in scene units. */
export interface Cliff3d {
  pts: Float64Array;
  halfWidth: number;
}

/** The map data's cliffs in scene units. */
export function mapCliffs(cliffs: readonly CliffLine[], place: MapPlacement): Cliff3d[] {
  const sx = place.width / Math.max(1e-9, place.rect[2] - place.rect[0]);
  return cliffs.map((c) => {
    const pts = new Float64Array(c.pts.length);
    for (let i = 0; i < c.pts.length; i += 2) {
      const at = toScene(place, c.pts[i] / SIDECAR_UNITS.coord, c.pts[i + 1] / SIDECAR_UNITS.coord);
      pts[i] = at.x;
      pts[i + 1] = at.y;
    }
    return { pts, halfWidth: c.halfWidth * sx };
  });
}

/** How tall a cliff stands for its width (squares): about 2.4 times its half width, within these. */
export const CLIFF_LOWEST = 0.8;
export const CLIFF_HIGHEST = 2.2;
/** A cliff's line is followed in steps at most this long (squares). */
const STEP = 0.5;
/** Its crest is this much of its width. */
const CREST = 0.25;
/** Rock where the picture paints nothing. */
const ROCK: readonly [number, number, number] = [0.52, 0.51, 0.5];

/** A cliff's height for its half width, both in squares. */
export function cliffHeight(halfWidth: number): number {
  return Math.max(CLIFF_LOWEST, Math.min(CLIFF_HIGHEST, halfWidth * 2.4));
}

/** A number from 0 to 1, the same for the same place (the rock's ups and downs stay put). */
function noise(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 7) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(y * 7) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** A cliff's line, followed in steps at most STEP squares long: [x, y, ...] in scene units. */
export function resample(pts: Float64Array, cell: number): number[] {
  const out: number[] = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (STEP * cell)));
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  }
  return out;
}

/**
 * The cliffs as one mesh, in squares: along each line, a left slope, a crest and a right slope
 * between each step and the next, with an end at each end of every stretch that stands. A
 * player sees a stretch only where the ground just either side of it, or its line, has been
 * seen; the GM (`all`) sees all of it.
 */
export function cliffMesh(cliffs: readonly Cliff3d[], cell: number, cover: CoverMap | null, all: boolean, paint: PaintMap | null): WallMesh {
  const position: number[] = [], normal: number[] = [], color: number[] = [];
  const face = (a: number[], b: number[], c: number[], col: readonly number[], out: readonly number[]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-12)) return;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      [b, c] = [c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const p of [a, b, c]) {
      position.push(p[0], p[1], p[2]);
      normal.push(nx / len, ny / len, nz / len);
      color.push(col[0], col[1], col[2]);
    }
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], col: readonly number[], out: readonly number[]) => {
    face(a, b, c, col, out);
    face(a, c, d, col, out);
  };
  for (const cliff of cliffs) {
    const line = resample(cliff.pts, cell);
    const n = line.length / 2;
    if (n < 2) continue;
    const hw = cliff.halfWidth / cell;
    const h0 = cliffHeight(hw);
    // Each step's point, its sideways direction (averaged at a bend), height, colour and whether it's seen.
    const steps = Array.from({ length: n }, (_, i) => {
      const x = line[i * 2], y = line[i * 2 + 1];
      const prev = Math.max(0, i - 1), next = Math.min(n - 1, i + 1);
      let tx = line[next * 2] - line[prev * 2], ty = line[next * 2 + 1] - line[prev * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const nx = -ty, ny = tx;
      const reach = cliff.halfWidth + 0.3 * cell;
      const light = Math.max(brightnessAt(cover, x, y), brightnessAt(cover, x + nx * reach, y + ny * reach), brightnessAt(cover, x - nx * reach, y - ny * reach));
      const painted = paintAt(paint, x, y);
      const base = painted ? wallTint(painted) : ROCK;
      const s = shadeOf(light);
      return {
        x: x / cell,
        z: y / cell,
        nx,
        nz: ny,
        tx,
        tz: ty,
        h: h0 * (0.82 + 0.36 * noise(x / cell, y / cell)),
        side: base.map((v) => v * s),
        top: base.map((v) => Math.min(1, v * 1.12) * s),
        seen: all || light >= WALL_SEEN,
      };
    });
    type Step = (typeof steps)[number];
    const corners = (s: Step) => ({
      l: [s.x + s.nx * hw, 0, s.z + s.nz * hw],
      cl: [s.x + s.nx * hw * CREST, s.h, s.z + s.nz * hw * CREST],
      cr: [s.x - s.nx * hw * CREST, s.h, s.z - s.nz * hw * CREST],
      r: [s.x - s.nx * hw, 0, s.z - s.nz * hw],
    });
    const end = (s: Step, dir: number) => {
      const c = corners(s);
      const out = [s.tx * dir, 0, s.tz * dir];
      quad(c.l, c.cl, c.cr, c.r, s.side, out);
    };
    let open = false;
    for (let i = 0; i + 1 < n; i++) {
      const a = steps[i], b = steps[i + 1];
      const draw = a.seen || b.seen;
      if (draw && !open) end(a, -1);
      if (!draw && open) end(a, 1);
      open = draw;
      if (!draw) continue;
      const ca = corners(a), cb = corners(b);
      quad(ca.l, cb.l, cb.cl, ca.cl, a.side, [a.nx, 0.5, a.nz]);
      quad(ca.cl, cb.cl, cb.cr, ca.cr, a.top, [0, 1, 0]);
      quad(ca.cr, cb.cr, cb.r, ca.r, a.side, [-a.nx, 0.5, -a.nz]);
    }
    if (open) end(steps[n - 1], 1);
  }
  return { position: Float32Array.from(position), normal: Float32Array.from(normal), color: Float32Array.from(color) };
}

// The one shared rasteriser of a season sidecar (design 5.3). The attach preview, the Compare
// bakes, the fit check and every device's runtime all call rasterSidecar, so the GM approves
// exactly what bakes. (ddRaster.ts rasterises the raw parsed map instead, at attach time only.)
//
// Contract (M0):
// - Pixel centres (2.3). Pixel (px, py) of a w x h raster has its centre at world
//   (x0 + (px + 0.5)*(x1 - x0)/w, y0 + (py + 0.5)*(y1 - y0)/h), with [x0, y0, x1, y1] = meta.rect.
// - Terrain. Slot planes are sampled bilinearly between texel centres (clamped at the crop's
//   edge), then summed per runtime role (terrainRole(name) when the slot has a stored name,
//   else the stored role).
// - Draw order. Everything else is composited painter-style: by layer, then bitmaps before shapes
//   before objects at an equal layer, then table order. A drawable with coverage c attenuates
//   everything below it by 1 - c and adds c to its own role. Terrain lies under everything.
// - Coverage. Shapes: scanline fill with the stored rule, exact horizontal coverage and 4x vertical
//   supersampling. Bitmaps: bilinear between the 0/1 samples, cut at 0.5 with a 1-pixel ramp.
//   Objects: the 16-gon through reach[k] * REACH_DIRS[k] around the centre, soft over 1 pixel.
// - Object roles are re-derived like terrain: objectRole(name) when the object has a stored name,
//   else the stored role.
// - Arithmetic: only + - * /, sqrt, floor, ceil, round, min and max, so every device gets the same bytes.
//
// How (WP2):
// - Painter-style is computed front to back, which is the same sum: each pixel keeps the share
//   still visible (vis, from 1); a drawable adds c * vis to its role and leaves vis - c * vis.
//   Terrain, last, adds weight * vis. Planes are bytes, each contribution rounded on its own.
// - Roles from names: a stored name always wins, KEEP included (terrainRole gives KEEP on purpose
//   for lava, magma, water and acid, and for names it doesn't know, which the attach-time table
//   didn't know either), so a table fix reaches old attachments. The stored role is only for
//   what has no name: the extractor drops the name of anything whose role mustn't be re-derived.
// - Terrain: slots are summed per role texel by texel (exact integers), then sampled: down the
//   column first, then along the row.
// - Objects: a pixel lies in the triangle (centre, vertex k, vertex k+1) of its sector k (found as
//   the pixel path does, by diamond() of its world direction); its coverage is 0.5 plus its
//   distance in pixels to the nearest of the outline's edges k-1, k, k+1, signed (+ inside),
//   clamped to 0..1. So a reach in one direction alone still shows, as a half-covered line.
//   Pixels within the outline's inner circle less half a pixel are 1 and those beyond its outer
//   circle plus half a pixel 0 without that work; both give what the full test would.
// - Bitmaps: the ramp is 1 pixel wide where samples are a pixel or more apart, else the bilinear
//   value itself (c = 0.5 + (b - 0.5) * max(1, step in pixels)).
// - The `top` object is the first one, front to back, whose visible share (c * vis) reaches 0.5.
// - Work is bounded whatever the sidecar holds, and the same drawables are drawn at every size:
//   before drawing, each drawable's work is costed (COST, units of about a nanosecond) on the
//   reference raster (RASTER_REF px on the long side), from its geometry alone and never less
//   than the drawing loops would do there. Terrain, always drawn, takes its share of
//   RASTER_BUDGET first (its caps bound it; only a crafted grid takes it all); then area
//   drawables are costed, then objects, each front to back, and whatever doesn't fit in what is
//   left is left out and counted in `skipped` (still charged for its costing). The plan uses only
//   the arithmetic above, so every device and every raster size (preview, Compare, runtime)
//   leaves out the same ones. The sample maps use 10-25% of the budget; tiled 5 x 7 (up to 250
//   squares across or 13,000 objects), at most two thirds.

import { objectRole, terrainRole, type AreaRole, type ObjectRole, type TerrainRole } from "./roles";
import {
  NO_NAME, REACH_N, SIDECAR_UNITS, type BitmapLayer, type ObjectTable, type SeasonSidecar, type ShapeLayer,
  type TerrainGrid,
} from "./sidecar";

/**
 * Unit vectors (x right, y down) of the 16 reach samples, x and y interleaved (design 2.9). Sample
 * k lies along the direction whose diamond() position (seasonPixels.ts) is k + 0.5, the centre of
 * the sector [k, k+1) the pixel path bins into: with p = ((k & 3) + 0.5)/4, the direction of
 * (1-p, p) for k 0-3, (-p, 1-p) for 4-7, (p-1, -p) for 8-11 and (p, p-1) for 12-15, so k runs
 * clockwise on screen from just below +x. Used by the extractor's measurement, rasterSidecar's
 * 16-gons and the exact path of treeIndex (which interpolates at pos - 0.5).
 */
export const REACH_DIRS: Float64Array = reachDirs();

function reachDirs(): Float64Array {
  const out = new Float64Array(32);
  for (let k = 0; k < 16; k++) {
    const p = ((k & 3) + 0.5) / 4;
    const q = k >> 2;
    const x = q === 0 ? 1 - p : q === 1 ? -p : q === 2 ? p - 1 : p;
    const y = q === 0 ? p : q === 1 ? 1 - p : q === 2 ? -p : p - 1;
    const len = Math.sqrt(x * x + y * y);
    out[k * 2] = x / len;
    out[k * 2 + 1] = y / len;
  }
  return out;
}

/** The raster: meta.rect mapped onto w x h, pixel centres at +0.5 (see above). */
export interface RasterSpec {
  w: number;
  h: number;
}

export interface SidecarLayers {
  w: number;
  h: number;
  /** Visible weight per terrain role, 0..255 (runtime roles, from stored names where they give one). */
  terrain: Map<TerrainRole, Uint8Array>;
  /** Visible coverage per area role, 0..255. */
  area: Map<AreaRole, Uint8Array>;
  /** Visible coverage per object role, 0..255 (only roles present). */
  objects: Map<ObjectRole, Uint8Array>;
  /** Top-most visible object's index + 1 per pixel where its coverage is at least 50% (0: none). */
  top: Uint16Array;
  /**
   * Drawables left out because the work budget ran out (RASTER_BUDGET): the same ones at every
   * raster size. 0 for real maps; more means a crafted, broken or enormous sidecar (the attach
   * dialog should say so: rasterPlan tells it without drawing).
   */
  skipped?: number;
}

/** The most pixels rasterSidecar draws (4096 x 4096). */
export const RASTER_MAX_PIXELS = 4096 * 4096;
/** The long side, in pixels, of the reference raster the drawables' work is costed on. */
export const RASTER_REF = 1024;
/** Work units (COST) a sidecar may spend on the reference raster: terrain's share first, then the drawables'. */
export const RASTER_BUDGET = 130_000_000;

/**
 * Work units, about a nanosecond each on a modest desktop, fitted on WP2's timings of each kind
 * of drawable alone (many small ones and a few huge ones), so that no mix runs over by much.
 */
const COST = {
  object: 1300,
  /** A row and a pixel of an object's box, and a pixel tested against the outline. */
  objectRow: 130,
  objectPixel: 3,
  objectTest: 40,
  bitmap: 500,
  /** A pixel of a bitmap's box, and one sampled. */
  bitmapPixel: 3,
  bitmapSample: 22,
  shape: 800,
  /** A shape's point, a pixel row it spans, an edge crossing a sub-scanline, a pixel it covers. */
  edge: 100,
  shapeRow: 64,
  crossing: 48,
  shapePixel: 10,
  /** What costing a drawable takes, charged too when it is left out: an object, a shape and its points. */
  objectPlan: 600,
  shapePlan: 300,
  edgePlan: 40,
  /** A texel of a terrain slot, a texel column a row of a role, and a pixel of a role sampled. */
  terrainTexel: 2,
  terrainCol: 6,
  terrainPixel: 10,
} as const;
/** Sub-scanlines a pixel row (4x vertical supersampling). */
const SUB = 4;
/** Rows of objects the plan may count tests in and then leave out (bounding its own work). */
const PLAN_ROWS = 1 << 18;

/**
 * Rasterises a sidecar that decodeSidecar accepted. Throws only on a bad spec (w, h not positive
 * integers, or too many pixels). The capped worst case must take under 150 ms at 1024 px.
 */
export function rasterSidecar(sc: SeasonSidecar, spec: RasterSpec): SidecarLayers {
  const { w, h } = spec;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > RASTER_MAX_PIXELS) {
    throw new Error(`rasterSidecar: a ${w} x ${h} raster is not allowed`);
  }
  const order = drawOrder(sc);
  const sums = terrainSums(sc);
  const plan = planWork(sc, order, sums);
  const r = new Raster(sc, w, h);
  const o = sc.objects;
  const nb = sc.bitmaps.length, ns = sc.shapes.length;
  // Objects' runtime roles: a stored name's role (once a name, objectRole reads the whole name).
  const names = sc.meta.names;
  const nameRole = new Int8Array(names.length).fill(-1);
  for (let d = order.length - 1; d >= 0; d--) {
    const id = order[d];
    if (plan.skip[id]) continue;
    if (id < nb) {
      const b = sc.bitmaps[id];
      r.bitmap(b, plane(r.area, b.role, r.n));
    } else if (id < nb + ns) {
      const s = sc.shapes[id - nb];
      r.shape(s, plane(r.area, s.role, r.n));
    } else {
      const i = id - nb - ns;
      const nm = o.name[i];
      let role = o.role[i] as ObjectRole;
      if (nm !== NO_NAME && nm < names.length) {
        if (nameRole[nm] < 0) nameRole[nm] = objectRole(names[nm]);
        role = nameRole[nm] as ObjectRole;
      }
      r.object(i, plane(r.objects, role, r.n));
    }
  }
  const terrain = new Map<TerrainRole, Uint8Array>();
  r.terrain(sums, terrain);
  return { w, h, terrain, area: r.area, objects: r.objects, top: r.top, skipped: plan.skipped };
}

/**
 * What rasterSidecar leaves out of this sidecar at any raster size, and the work units it plans for
 * the rest on the reference raster, without drawing anything (for the attach dialog's warning).
 */
export function rasterPlan(sc: SeasonSidecar): { skipped: number; work: number } {
  const { skipped, work } = planWork(sc, drawOrder(sc), terrainSums(sc));
  return { skipped, work };
}

/** Draw order, bottom first, as numbers: bitmaps, then shapes, then objects, each by its index in its own list. */
function drawOrder(sc: SeasonSidecar): Int32Array {
  const o = sc.objects;
  const nb = sc.bitmaps.length, ns = sc.shapes.length, total = nb + ns + o.n;
  const layer = new Int32Array(total);
  for (let i = 0; i < nb; i++) layer[i] = sc.bitmaps[i].layer;
  for (let i = 0; i < ns; i++) layer[nb + i] = sc.shapes[i].layer;
  for (let i = 0; i < o.n; i++) layer[nb + ns + i] = o.layer[i];
  const order = new Int32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;
  order.sort((a, b) => layer[a] - layer[b] || a - b); // kinds and table order are in the numbering
  return order;
}

function plane<K>(m: Map<K, Uint8Array>, k: K, n: number): Uint8Array {
  let p = m.get(k);
  if (!p) {
    p = new Uint8Array(n);
    m.set(k, p);
  }
  return p;
}

/** Terrain slots summed per runtime role, texel by texel (exact integers, at most 255 * 255). */
function terrainSums(sc: SeasonSidecar): Map<TerrainRole, Uint16Array> {
  const t = sc.terrain, names = sc.meta.names;
  const sums = new Map<TerrainRole, Uint16Array>();
  if (!t) return sums;
  const texels = t.tw * t.th;
  t.slots.forEach((sl, s) => {
    const role = sl.name !== NO_NAME && sl.name < names.length ? terrainRole(names[sl.name]) : sl.role;
    let sum = sums.get(role);
    if (!sum) {
      sum = new Uint16Array(texels);
      sums.set(role, sum);
    }
    const base = s * texels, wt = t.w;
    for (let q = 0; q < texels; q++) sum[q] += wt[base + q];
  });
  return sums;
}

/**
 * Where a w x h raster samples the terrain: each column's and row's texels and fraction (pixel
 * centres in texels, half a texel in, clamped to the crop). When the texel columns sampled are
 * few (under 2 a pixel), each row's are interpolated once, and the pixels of texel column c
 * (c0 = c) are run[c - cMin] to run[c - cMin + 1] - 1.
 */
interface TerrainSampling {
  c0: Int32Array;
  c1: Int32Array;
  cf: Float64Array;
  r0: Int32Array;
  r1: Int32Array;
  rf: Float64Array;
  few: boolean;
  cMin: number;
  cMax: number;
  run: Int32Array;
}

function terrainSampling(t: TerrainGrid, rect: readonly number[], w: number, h: number): TerrainSampling {
  const [x0, y0, x1, y1] = rect;
  const c0 = new Int32Array(w), c1 = new Int32Array(w), cf = new Float64Array(w);
  for (let i = 0; i < w; i++) {
    const cx = x0 + ((i + 0.5) * (x1 - x0)) / w;
    const u = Math.min(t.tw - 1, Math.max(0, (cx * t.tps) / 256 - 0.5 - t.tx0));
    c0[i] = Math.floor(u);
    c1[i] = Math.min(t.tw - 1, c0[i] + 1);
    cf[i] = u - c0[i];
  }
  const r0 = new Int32Array(h), r1 = new Int32Array(h), rf = new Float64Array(h);
  for (let j = 0; j < h; j++) {
    const cy = y0 + ((j + 0.5) * (y1 - y0)) / h;
    const v = Math.min(t.th - 1, Math.max(0, (cy * t.tps) / 256 - 0.5 - t.ty0));
    r0[j] = Math.floor(v);
    r1[j] = Math.min(t.th - 1, r0[j] + 1);
    rf[j] = v - r0[j];
  }
  const cMin = c0[0], cMax = c1[w - 1], few = cMax - cMin < 2 * w;
  const run = new Int32Array(few ? cMax - cMin + 2 : 0);
  if (few) {
    for (let i = 0; i < w; i++) run[c0[i] - cMin + 1]++;
    for (let c = 1; c < run.length; c++) run[c] += run[c - 1];
  }
  return { c0, c1, cf, r0, r1, rf, few, cMin, cMax, run };
}

/** Diamond position 0..4 of a direction, clockwise from +x (y down): seasonPixels.ts's diamond(). */
function diamond(dx: number, dy: number): number {
  const ad = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
  if (ad <= 0) return 0;
  return dy >= 0 ? (dx >= 0 ? dy / ad : 2 - dy / ad) : dx < 0 ? 2 - dy / ad : 4 + dy / ad;
}

/** Squared distance from (px, py) to the segment from (ax, ay) along (ex, ey); inv is 1/|e|^2 (0 for a point). */
function segDist2(px: number, py: number, ax: number, ay: number, ex: number, ey: number, inv: number): number {
  const dx = px - ax, dy = py - ay;
  const t = Math.min(1, Math.max(0, (dx * ex + dy * ey) * inv));
  const qx = dx - t * ex, qy = dy - t * ey;
  return qx * qx + qy * qy;
}

/** meta.rect on a w x h raster: pixels per world unit, and the rectangle's corner. */
interface Frame {
  w: number;
  h: number;
  sx: number;
  sy: number;
  x0: number;
  y0: number;
}

function frameOf(sc: SeasonSidecar, w: number, h: number): Frame {
  const [x0, y0, x1, y1] = sc.meta.rect;
  return { w, h, sx: w / (x1 - x0), sy: h / (y1 - y0), x0, y0 };
}

/** An object's 16-gon on a frame, in pixels: what drawing it and costing it both start from. */
class Outline {
  /** Vertices, edges (vertex k to k + 1) and 1/|edge|^2. */
  readonly vx = new Float64Array(REACH_N);
  readonly vy = new Float64Array(REACH_N);
  readonly ex = new Float64Array(REACH_N);
  readonly ey = new Float64Array(REACH_N);
  readonly inv = new Float64Array(REACH_N);
  /** The centre, the pixel box (clipped to the raster), and the inner and outer radii. */
  cx = 0;
  cy = 0;
  i0 = 0;
  i1 = -1;
  j0 = 0;
  j1 = -1;
  rin = 0;
  rout = 0;
  quickIn = -1;
  quickOut = 0;

  /** Object i's outline; false when its box misses the raster. */
  set(f: Frame, o: ObjectTable, i: number): boolean {
    const { sx, sy, x0, y0, w, h } = f;
    const { vx, vy, ex, ey, inv } = this;
    const cw = o.x[i] / SIDECAR_UNITS.coord, ch = o.y[i] / SIDECAR_UNITS.coord;
    const cxp = (cw - x0) * sx, cyp = (ch - y0) * sy;
    let minX = cxp, maxX = cxp, minY = cyp, maxY = cyp, rout = 0;
    for (let k = 0; k < REACH_N; k++) {
      const reach = o.reach[i * REACH_N + k] / SIDECAR_UNITS.reach;
      vx[k] = (cw + reach * REACH_DIRS[k * 2] - x0) * sx;
      vy[k] = (ch + reach * REACH_DIRS[k * 2 + 1] - y0) * sy;
      minX = Math.min(minX, vx[k]);
      maxX = Math.max(maxX, vx[k]);
      minY = Math.min(minY, vy[k]);
      maxY = Math.max(maxY, vy[k]);
      const dx = vx[k] - cxp, dy = vy[k] - cyp;
      rout = Math.max(rout, dx * dx + dy * dy);
    }
    this.cx = cxp;
    this.cy = cyp;
    this.i0 = Math.max(0, Math.floor(minX - 1));
    this.i1 = Math.min(w - 1, Math.floor(maxX + 1));
    this.j0 = Math.max(0, Math.floor(minY - 1));
    this.j1 = Math.min(h - 1, Math.floor(maxY + 1));
    if (!(this.i0 <= this.i1 && this.j0 <= this.j1)) return false;
    let rin = Infinity;
    for (let k = 0; k < REACH_N; k++) {
      const k1 = (k + 1) & 15;
      ex[k] = vx[k1] - vx[k];
      ey[k] = vy[k1] - vy[k];
      const l2 = ex[k] * ex[k] + ey[k] * ey[k];
      inv[k] = l2 > 0 ? 1 / l2 : 0;
      rin = Math.min(rin, segDist2(cxp, cyp, vx[k], vy[k], ex[k], ey[k], inv[k]));
    }
    this.rin = Math.sqrt(rin);
    this.rout = Math.sqrt(rout);
    // Inside the inner circle less half a pixel: 1; beyond the outer circle plus half a pixel: 0.
    this.quickIn = this.rin > 0.5 ? (this.rin - 0.5) * (this.rin - 0.5) : -1;
    this.quickOut = (this.rout + 0.5) * (this.rout + 0.5);
    return true;
  }

  /** At most the pixels tested against the outline (between quickIn and quickOut), from the circles' areas. */
  testsBound(): number {
    // Their unit squares lie between the circles widened by sqrt(1/2) (0.71 here) on each side,
    // so they are at most that ring's area (pi < 3.1416).
    const ro = this.rout + 0.5 + 0.71, ri = this.rin - 0.5 - 0.71;
    return Math.min((this.i1 - this.i0 + 1) * (this.j1 - this.j0 + 1), 3.1416 * (ro * ro - (ri > 0 ? ri * ri : 0)));
  }

  /** The pixels of the box tested against the outline (between quickIn and quickOut), counted a row at a time. */
  tests(): number {
    let n = 0;
    for (let j = this.j0; j <= this.j1; j++) {
      const dy = j + 0.5 - this.cy;
      n += this.within(dy, this.quickOut, 0) - this.within(dy, this.quickIn, 1);
    }
    return n;
  }

  /**
   * The pixels of row dy (from the centre) in the box whose r2, computed as object() does, is under
   * q (or at most q, with orEqual 1): an interval, found by sqrt and fixed at its ends by that test.
   */
  private within(dy: number, q: number, orEqual: number): number {
    const rem = q - dy * dy;
    if (rem < 0) return 0;
    const cx = this.cx, half = Math.sqrt(rem);
    let a = Math.max(this.i0, Math.floor(cx - half - 0.5) - 1), b = Math.min(this.i1, Math.floor(cx + half - 0.5) + 2);
    for (; a <= b; a++) {
      const dx = a + 0.5 - cx, r2 = dx * dx + dy * dy;
      if (r2 < q || (orEqual && r2 === q)) break;
    }
    for (; b >= a; b--) {
      const dx = b + 0.5 - cx, r2 = dx * dx + dy * dy;
      if (r2 < q || (orEqual && r2 === q)) break;
    }
    return b >= a ? b - a + 1 : 0;
  }
}

/** A bitmap's pixel box on a frame ([i0, i1, j0, j1], clipped): beyond one step from the grid, coverage is 0. */
function bitmapBox(f: Frame, b: BitmapLayer, out: Int32Array): boolean {
  const { sx, sy, x0, y0, w, h } = f;
  const xa = (b.ox - b.step - x0) * sx, xb = (b.ox + b.w * b.step - x0) * sx;
  const ya = (b.oy - b.step - y0) * sy, yb = (b.oy + b.h * b.step - y0) * sy;
  out[0] = Math.max(0, Math.floor(xa - 0.5));
  out[1] = Math.min(w - 1, Math.floor(xb + 0.5));
  out[2] = Math.max(0, Math.floor(ya - 0.5));
  out[3] = Math.min(h - 1, Math.floor(yb + 0.5));
  return out[0] <= out[1] && out[2] <= out[3];
}

const grownF64 = (a: Float64Array, n: number): Float64Array => (a.length >= n ? a : new Float64Array(Math.max(n, a.length * 2)));
const grownI32 = (a: Int32Array, n: number): Int32Array => (a.length >= n ? a : new Int32Array(Math.max(n, a.length * 2)));

/**
 * A shape's edges on a frame, from their top end: x and y there, dx/dy, direction (1 downwards),
 * and the sub-scanlines [ja, jb) they cross, sub-scanline j lying at y = (j + 0.5) / SUB. Edges
 * that cross none are left out. The arrays are reused from shape to shape.
 */
class Edges {
  tx = new Float64Array(64);
  ty = new Float64Array(64);
  slope = new Float64Array(64);
  down = new Uint8Array(64);
  ja = new Int32Array(64);
  jb = new Int32Array(64);
  /** Per ring, the number of edges up to and including it. */
  ringEnd: Int32Array = new Int32Array(16);
  ne = 0;
  crossings = 0;
  jMin = 0;
  jMax = 0;

  set(f: Frame, s: ShapeLayer): void {
    const { sx, sy, x0, y0, h } = f;
    const pts = s.pts, ends = s.ringEnds, U = SIDECAR_UNITS.coord;
    const m = pts.length / 2;
    if (this.tx.length < m) {
      const n = Math.max(m, this.tx.length * 2);
      this.tx = new Float64Array(n);
      this.ty = new Float64Array(n);
      this.slope = new Float64Array(n);
      this.down = new Uint8Array(n);
      this.ja = new Int32Array(n);
      this.jb = new Int32Array(n);
    }
    this.ringEnd = grownI32(this.ringEnd, ends.length);
    const { tx, ty, slope, down, ja, jb, ringEnd } = this;
    let ne = 0, crossings = 0, jMin = SUB * h, jMax = 0, start = 0;
    for (let r = 0; r < ends.length; r++) {
      const end = ends[r];
      for (let a = start; a < end; a++) {
        const b = a + 1 < end ? a + 1 : start;
        const ax = (pts[a * 2] / U - x0) * sx, ay = (pts[a * 2 + 1] / U - y0) * sy;
        const bx = (pts[b * 2] / U - x0) * sx, by = (pts[b * 2 + 1] / U - y0) * sy;
        if (ay === by) continue;
        const dn = ay < by;
        const topY = dn ? ay : by, botY = dn ? by : ay;
        const lo = Math.max(0, Math.ceil(topY * SUB - 0.5)), hi = Math.min(SUB * h, Math.ceil(botY * SUB - 0.5));
        if (!(lo < hi)) continue;
        tx[ne] = dn ? ax : bx;
        ty[ne] = topY;
        slope[ne] = (dn ? bx - ax : ax - bx) / (botY - topY);
        down[ne] = dn ? 1 : 0;
        ja[ne] = lo;
        jb[ne] = hi;
        crossings += hi - lo;
        jMin = Math.min(jMin, lo);
        jMax = Math.max(jMax, hi);
        ne++;
      }
      ringEnd[r] = ne;
      start = end;
    }
    this.ne = ne;
    this.crossings = crossings;
    this.jMin = jMin;
    this.jMax = jMax;
  }

  /** Pixel rows the shape's sub-scanlines span. */
  rows(): number {
    return this.ne === 0 ? 0 : Math.ceil(this.jMax / SUB) - Math.floor(this.jMin / SUB);
  }
}

// ---------------------------------------------------------------- the plan

/**
 * Costs every drawable on the reference raster (see the header) and marks those left out. Each
 * cost is at least what the drawing loops do there (vis can only make them do less): an
 * object's box and the pixels between its inner and outer circle (counted by area, which bounds
 * the pixel centres there), a bitmap's box, and a shape's edges, crossings, rows and, a row, the
 * pixels within each ring's extent (a span's pixels lie within some ring's, at either fill rule).
 */
function planWork(sc: SeasonSidecar, order: Int32Array, sums: Map<TerrainRole, Uint16Array>): { skip: Uint8Array; skipped: number; work: number } {
  const [x0, y0, x1, y1] = sc.meta.rect;
  const W = x1 - x0, H = y1 - y0;
  const rw = W >= H ? RASTER_REF : Math.max(1, Math.round((RASTER_REF * W) / H));
  const rh = H >= W ? RASTER_REF : Math.max(1, Math.round((RASTER_REF * H) / W));
  const f = frameOf(sc, rw, rh);
  const o = sc.objects;
  const nb = sc.bitmaps.length, ns = sc.shapes.length, total = order.length;
  const skip = new Uint8Array(total);
  // Terrain is always drawn: its share comes off first.
  let left = RASTER_BUDGET, skipped = 0;
  if (sc.terrain) left -= terrainCost(sc.terrain, sums, terrainSampling(sc.terrain, sc.meta.rect, rw, rh), rw);
  // A drawable left out still costs its planning (planned); once nothing is left, the rest are
  // left out unplanned.
  const take = (id: number, cost: number, planned: number) => {
    if (cost > left) {
      skip[id] = 1;
      skipped++;
      left = Math.max(0, left - planned);
    } else {
      left -= cost;
    }
  };
  const out = (id: number) => {
    skip[id] = 1;
    skipped++;
  };
  const box = new Int32Array(4);
  const edges = new Edges();
  const lo = new Float64Array(rh).fill(Infinity), hi = new Float64Array(rh).fill(-Infinity), sum = new Float64Array(rh);
  // Area drawables first, so water, floors and caves are kept before objects.
  for (let d = total - 1; d >= 0; d--) {
    const id = order[d];
    if (id >= nb + ns) continue;
    if (left <= 0) {
      out(id);
    } else if (id < nb) {
      const b = sc.bitmaps[id];
      const n = bitmapBox(f, b, box) ? (box[1] - box[0] + 1) * (box[3] - box[2] + 1) : 0;
      take(id, COST.bitmap + n * (COST.bitmapPixel + COST.bitmapSample), COST.bitmap);
    } else {
      const s = sc.shapes[id - nb];
      edges.set(f, s);
      const planned = COST.shapePlan + (s.pts.length / 2) * COST.edgePlan;
      let cost = COST.shape + (s.pts.length / 2) * COST.edge;
      if (edges.ne > 0) {
        cost += edges.crossings * COST.crossing + edges.rows() * COST.shapeRow;
        if (cost <= left) cost += coveredBound(edges, s.ringEnds.length, rw, lo, hi, sum) * COST.shapePixel;
      }
      take(id, cost, planned);
    }
  }
  const g = new Outline();
  let counted = 0;
  for (let d = total - 1; d >= 0; d--) {
    const id = order[d];
    if (id < nb + ns) continue;
    if (left <= 0) {
      out(id);
      continue;
    }
    let cost: number = COST.object;
    if (g.set(f, o, id - nb - ns)) {
      const rows = g.j1 - g.j0 + 1;
      cost += rows * COST.objectRow + rows * (g.i1 - g.i0 + 1) * COST.objectPixel;
      if (cost <= left) {
        // The tests counted row by row, which the rows' cost covers when the object is drawn; one
        // that might not fit is counted only while PLAN_ROWS lasts, then costed by area (more).
        const bound = cost + g.testsBound() * COST.objectTest;
        if (bound <= left || counted + rows <= PLAN_ROWS) {
          if (bound > left) counted += rows;
          cost += g.tests() * COST.objectTest;
        } else {
          cost = bound;
        }
      }
    }
    take(id, cost, COST.objectPlan);
  }
  return { skip, skipped, work: RASTER_BUDGET - left };
}

/**
 * Terrain's work on a raster sampled by `ts`, w wide: the texels summed, each role's rows of
 * texel columns, and its pixels whose texels around aren't all 0 (Raster.terrain skips the rest).
 * A row's are at most the pixels next to a non-zero texel in its upper texel row plus, unless it
 * lies on that row exactly, in its lower one; a texel row's are the runs of the texel columns
 * whose texel or the next one isn't 0.
 */
function terrainCost(t: TerrainGrid, sums: Map<TerrainRole, Uint16Array>, ts: TerrainSampling, w: number): number {
  let cost = t.w.length * COST.terrainTexel;
  const { r0, r1, rf, few, cMin, cMax, run } = ts;
  const h = r0.length, tw = t.tw;
  const npx = new Float64Array(t.th);
  for (const d of sums.values()) {
    if (!few) {
      cost += w * h * COST.terrainPixel;
      continue;
    }
    for (let r = 0; r < t.th; r++) {
      const base = r * tw;
      let n = 0;
      for (let c = cMin; c <= cMax; c++) {
        if (d[base + c] !== 0 || d[base + Math.min(tw - 1, c + 1)] !== 0) n += run[c - cMin + 1] - run[c - cMin];
      }
      npx[r] = n;
    }
    let px = 0;
    for (let j = 0; j < h; j++) px += Math.min(w, npx[r0[j]] + (rf[j] > 0 ? npx[r1[j]] : 0));
    cost += px * COST.terrainPixel + h * (cMax - cMin + 1) * COST.terrainCol;
  }
  return cost;
}

/**
 * At least the pixels shape() composites: a row's, at most the raster's width and at most the sum
 * over rings of the pixels between the ring's leftmost and rightmost crossing in that row
 * (computed as shape() computes crossings, so exactly on the frame it was set on). lo and hi are
 * +-Infinity and sum 0 on entry, a row each, and are left so.
 */
function coveredBound(e: Edges, rings: number, w: number, lo: Float64Array, hi: Float64Array, sum: Float64Array): number {
  const { tx, ty, slope, ja, jb, ringEnd } = e;
  let q = 0;
  for (let r = 0; r < rings; r++) {
    let ra = Infinity, rb = -Infinity;
    for (; q < ringEnd[r]; q++) {
      const rowA = Math.floor(ja[q] / SUB), rowB = Math.floor((jb[q] - 1) / SUB);
      for (let row = rowA; row <= rowB; row++) {
        const j1 = Math.max(ja[q], row * SUB), j2 = Math.min(jb[q], row * SUB + SUB) - 1;
        const xa = tx[q] + ((j1 + 0.5) / SUB - ty[q]) * slope[q], xb = tx[q] + ((j2 + 0.5) / SUB - ty[q]) * slope[q];
        lo[row] = Math.min(lo[row], xa, xb);
        hi[row] = Math.max(hi[row], xa, xb);
      }
      ra = Math.min(ra, rowA);
      rb = Math.max(rb, rowB);
    }
    for (let row = ra; row <= rb; row++) {
      const a = Math.max(0, Math.floor(lo[row])), b = Math.min(w - 1, Math.floor(hi[row]));
      if (b >= a) sum[row] += b - a + 1;
      lo[row] = Infinity;
      hi[row] = -Infinity;
    }
  }
  let n = 0;
  const r0 = Math.floor(e.jMin / SUB), r1 = Math.ceil(e.jMax / SUB);
  for (let row = r0; row < r1; row++) {
    n += Math.min(w, sum[row]);
    sum[row] = 0;
  }
  return n;
}

// ---------------------------------------------------------------- drawing

class Raster implements Frame {
  readonly sc: SeasonSidecar;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  /** The share of each pixel still visible above what is drawn next (front to back). */
  readonly vis: Float32Array;
  readonly top: Uint16Array;
  readonly area = new Map<AreaRole, Uint8Array>();
  readonly objects = new Map<ObjectRole, Uint8Array>();
  /** Pixels per world unit, and the world position of each column's and row's pixel centre. */
  readonly sx: number;
  readonly sy: number;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly x0: number;
  readonly y0: number;
  /** A row's coverage while a shape is filled (zero between rows). */
  private readonly acc: Float64Array;
  private readonly outline = new Outline();
  private readonly edges = new Edges();
  private readonly box = new Int32Array(4);
  /** Scratch reused from shape to shape (see shape()). */
  private count: Int32Array = new Int32Array(64);
  private byStart: Int32Array = new Int32Array(64);
  private active: Int32Array = new Int32Array(64);
  private xa: Float64Array = new Float64Array(64);
  private xd: Float64Array = new Float64Array(64);
  private spans: Float64Array = new Float64Array(64);
  private ui: Int32Array = new Int32Array(64);
  private uf: Float64Array = new Float64Array(64);

  constructor(sc: SeasonSidecar, w: number, h: number) {
    this.sc = sc;
    this.w = w;
    this.h = h;
    this.n = w * h;
    this.vis = new Float32Array(this.n).fill(1);
    this.top = new Uint16Array(this.n);
    const [x0, y0, x1, y1] = sc.meta.rect;
    this.x0 = x0;
    this.y0 = y0;
    this.sx = w / (x1 - x0);
    this.sy = h / (y1 - y0);
    this.cx = new Float64Array(w);
    this.cy = new Float64Array(h);
    for (let i = 0; i < w; i++) this.cx[i] = x0 + ((i + 0.5) * (x1 - x0)) / w;
    for (let j = 0; j < h; j++) this.cy[j] = y0 + ((j + 0.5) * (y1 - y0)) / h;
    this.acc = new Float64Array(w);
  }

  // ---------------------------------------------------------------- objects

  object(i: number, p: Uint8Array): void {
    const g = this.outline;
    if (!g.set(this, this.sc.objects, i)) return;
    const { sx, sy, w, vis, top } = this;
    const { vx, vy, ex, ey, inv, cx: cxp, cy: cyp, i0, i1, j0, j1, quickIn, quickOut } = g;
    for (let j = j0; j <= j1; j++) {
      const py = j + 0.5, dy = py - cyp;
      for (let ii = i0, k = j * w + i0; ii <= i1; ii++, k++) {
        const v = vis[k];
        if (v <= 0) continue;
        const px = ii + 0.5, dx = px - cxp;
        const r2 = dx * dx + dy * dy;
        if (r2 >= quickOut) continue;
        let c = 1;
        if (r2 > quickIn) {
          // The sector in world directions (pixels scaled back by sy/sx keep diamond()'s ratios).
          const s = Math.floor(diamond(dx * sy, dy * sx) * 4 - 0.5) & 15;
          const inside = ex[s] * (py - vy[s]) - ey[s] * (px - vx[s]) > 0;
          const a = (s + 15) & 15, b = (s + 1) & 15;
          const d2 = Math.min(segDist2(px, py, vx[s], vy[s], ex[s], ey[s], inv[s]),
            Math.min(segDist2(px, py, vx[a], vy[a], ex[a], ey[a], inv[a]), segDist2(px, py, vx[b], vy[b], ex[b], ey[b], inv[b])));
          const d = Math.sqrt(d2);
          c = inside ? Math.min(1, 0.5 + d) : 0.5 - d;
          if (c <= 0) continue;
        }
        const t = c * v;
        p[k] = Math.min(255, p[k] + Math.round(t * 255));
        vis[k] = v - t;
        if (t >= 0.5 && top[k] === 0) top[k] = i + 1;
      }
    }
  }

  // ---------------------------------------------------------------- bitmaps

  bitmap(b: BitmapLayer, p: Uint8Array): void {
    const box = this.box;
    if (!bitmapBox(this, b, box)) return;
    const { sx, sy, w, cx, cy, vis } = this;
    const i0 = box[0], j0 = box[2], j1 = box[3];
    const ramp = Math.max(1, b.step * Math.min(sx, sy));
    const cols = box[1] - i0 + 1;
    const ui = (this.ui = grownI32(this.ui, cols)), uf = (this.uf = grownF64(this.uf, cols));
    for (let c = 0; c < cols; c++) {
      const u = (cx[i0 + c] - b.ox) / b.step;
      ui[c] = Math.floor(u);
      uf[c] = u - ui[c];
    }
    const bits = b.bits, bw = b.w, bh = b.h;
    for (let j = j0; j <= j1; j++) {
      const v = (cy[j] - b.oy) / b.step;
      const vi = Math.floor(v), vf = v - vi;
      const row0 = vi >= 0 && vi < bh, row1 = vi + 1 >= 0 && vi + 1 < bh;
      const at0 = vi * bw, at1 = at0 + bw;
      for (let c = 0, k = j * w + i0; c < cols; c++, k++) {
        const vk = vis[k];
        if (vk <= 0) continue;
        const x = ui[c], f = uf[c];
        const in0 = x >= 0 && x < bw, in1 = x + 1 >= 0 && x + 1 < bw;
        const b00 = row0 && in0 ? (bits[(at0 + x) >> 3] >> ((at0 + x) & 7)) & 1 : 0;
        const b10 = row0 && in1 ? (bits[(at0 + x + 1) >> 3] >> ((at0 + x + 1) & 7)) & 1 : 0;
        const b01 = row1 && in0 ? (bits[(at1 + x) >> 3] >> ((at1 + x) & 7)) & 1 : 0;
        const b11 = row1 && in1 ? (bits[(at1 + x + 1) >> 3] >> ((at1 + x + 1) & 7)) & 1 : 0;
        if (b00 + b10 + b01 + b11 === 0) continue;
        const t0 = b00 + (b10 - b00) * f, t1 = b01 + (b11 - b01) * f;
        const cov = Math.min(1, 0.5 + (t0 + (t1 - t0) * vf - 0.5) * ramp);
        if (cov <= 0) continue;
        const t = cov * vk;
        p[k] = Math.min(255, p[k] + Math.round(t * 255));
        vis[k] = vk - t;
      }
    }
  }

  // ---------------------------------------------------------------- shapes

  shape(s: ShapeLayer, p: Uint8Array): void {
    const e = this.edges;
    e.set(this, s);
    const { ne, jMin, jMax, tx, ty, slope, down, ja, jb } = e;
    if (ne === 0) return;
    const { w, vis } = this;

    // Edges by first sub-scanline, then table order (a counting sort over the shape's own rows).
    const count = (this.count = grownI32(this.count, jMax - jMin + 1));
    count.fill(0, 0, jMax - jMin + 1);
    for (let q = 0; q < ne; q++) count[ja[q] - jMin + 1]++;
    for (let q = 1; q <= jMax - jMin; q++) count[q] += count[q - 1];
    const byStart = (this.byStart = grownI32(this.byStart, ne));
    for (let q = 0; q < ne; q++) byStart[count[ja[q] - jMin]++] = q;
    const active = (this.active = grownI32(this.active, ne));
    // Crossings of a sub-scanline: all (even-odd), or downward and upward apart (non-zero).
    const xa = (this.xa = grownF64(this.xa, ne)), xd = (this.xd = grownF64(this.xd, ne));
    // A row's spans as [first, last] pixels, packed first * 2^24 + last (w <= 2^24).
    let spans = this.spans;
    let nsp = 0;
    const acc = this.acc;
    const span = (a: number, b: number) => {
      a = Math.max(0, a);
      b = Math.min(w, b);
      if (b <= a) return;
      const ia = Math.floor(a), ib = Math.floor(b);
      if (ia === ib) {
        acc[ia] += (b - a) / SUB;
      } else {
        acc[ia] += (ia + 1 - a) / SUB;
        for (let q = ia + 1; q < ib; q++) acc[q] += 1 / SUB;
        if (ib < w) acc[ib] += (b - ib) / SUB;
      }
      if (nsp === spans.length) {
        const grown = new Float64Array(nsp * 2);
        grown.set(spans);
        spans = this.spans = grown;
      }
      spans[nsp++] = ia * 16777216 + Math.min(w - 1, ib);
    };
    let na = 0, next = 0;
    for (let row = Math.floor(jMin / SUB); row * SUB < jMax; row++) {
      for (let j = row * SUB; j < row * SUB + SUB; j++) {
        while (next < ne && ja[byStart[next]] <= j) active[na++] = byStart[next++];
        let k = 0;
        for (let q = 0; q < na; q++) {
          const ed = active[q];
          if (jb[ed] > j) active[k++] = ed;
        }
        na = k;
        if (na === 0) continue;
        const y = (j + 0.5) / SUB;
        if (s.rule === 0) {
          for (let q = 0; q < na; q++) {
            const ed = active[q];
            xa[q] = tx[ed] + (y - ty[ed]) * slope[ed];
          }
          sortNumbers(xa, na);
          for (let q = 0; q + 1 < na; q += 2) span(xa[q], xa[q + 1]);
        } else {
          let nd = 0, nu = 0;
          for (let q = 0; q < na; q++) {
            const ed = active[q];
            const x = tx[ed] + (y - ty[ed]) * slope[ed];
            if (down[ed]) xd[nd++] = x;
            else xa[nu++] = x;
          }
          sortNumbers(xd, nd);
          sortNumbers(xa, nu);
          const ds = xd, us = xa;
          // Merge, a downward crossing first at a tie; spans where the winding isn't 0.
          let wind = 0, from = 0;
          for (let a = 0, b = 0; a < nd || b < nu;) {
            const takeDown = b >= nu || (a < nd && ds[a] <= us[b]);
            const x = takeDown ? ds[a++] : us[b++];
            const was = wind;
            wind += takeDown ? 1 : -1;
            if (was === 0) from = x;
            else if (wind === 0) span(from, x);
          }
        }
      }
      if (nsp === 0) continue;
      // Composite the union of the row's spans, then clear their coverage.
      sortNumbers(spans, nsp);
      const sorted = spans;
      const base = row * w;
      let q = -1;
      for (let i = 0; i < nsp; i++) {
        const first = Math.floor(sorted[i] / 16777216), last = sorted[i] - first * 16777216;
        for (let x = Math.max(first, q + 1); x <= last; x++) {
          const c = acc[x];
          acc[x] = 0;
          if (c <= 0) continue;
          const k = base + x, v = vis[k];
          if (v <= 0) continue;
          const t = Math.min(1, c) * v;
          p[k] = Math.min(255, p[k] + Math.round(t * 255));
          vis[k] = v - t;
        }
        q = Math.max(q, last);
      }
      nsp = 0;
    }
  }

  // ---------------------------------------------------------------- terrain

  terrain(sums: Map<TerrainRole, Uint16Array>, out: Map<TerrainRole, Uint8Array>): void {
    const t = this.sc.terrain;
    if (!t) return;
    const { w, h, vis } = this;
    const { c0, c1, cf, r0, r1, rf, few, cMin, cMax, run } = terrainSampling(t, this.sc.meta.rect, w, h);
    const tw = t.tw;
    // Down the texel columns once a row when they are few (the same numbers either way), then
    // along the row, leaving out the runs of pixels whose texels around are all 0.
    const col = new Float64Array(few ? cMax - cMin + 1 : 0);
    for (const [role, d] of sums) {
      const p = new Uint8Array(this.n);
      out.set(role, p);
      for (let j = 0; j < h; j++) {
        const a0 = r0[j] * tw, a1 = r1[j] * tw, f = rf[j], k0 = j * w;
        if (few) {
          for (let c = cMin; c <= cMax; c++) col[c - cMin] = d[a0 + c] + (d[a1 + c] - d[a0 + c]) * f;
          for (let c = cMin; c <= cMax; c++) {
            const l = col[c - cMin], r = col[Math.min(tw - 1, c + 1) - cMin];
            if (l === 0 && r === 0) continue;
            for (let i = run[c - cMin], k = k0 + i; i < run[c - cMin + 1]; i++, k++) {
              p[k] = Math.min(255, Math.round((l + (r - l) * cf[i]) * vis[k]));
            }
          }
        } else {
          for (let i = 0, k = k0; i < w; i++, k++) {
            const x0 = a0 + c0[i], x1 = a0 + c1[i];
            const l = d[x0] + (d[a1 + c0[i]] - d[x0]) * f, r = d[x1] + (d[a1 + c1[i]] - d[x1]) * f;
            p[k] = Math.min(255, Math.round((l + (r - l) * cf[i]) * vis[k]));
          }
        }
      }
    }
  }
}

/** Sorts the first n numbers in place, ascending (insertion sort when few, as most rows are). */
function sortNumbers(a: Float64Array, n: number): void {
  if (n > 24) {
    a.subarray(0, n).sort();
    return;
  }
  for (let i = 1; i < n; i++) {
    const x = a[i];
    let j = i - 1;
    for (; j >= 0 && a[j] > x; j--) a[j + 1] = a[j];
    a[j + 1] = x;
  }
}

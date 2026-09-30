// Rasterise the parsed model into masks on any pixel grid that maps linearly to world space, e.g.
// the map picture itself (see align.ts) or a Seasons analysis grid (~20 px per square).
// Pure; typed arrays only. This works on the raw DDMap (attach time, scripts); raster.ts is the
// one shared rasteriser of the compiled sidecar that every device runs.

import type { Terrain, Water, WaterNode, BitGrid, Tiles } from "./model";
import { GRID, MS_EDGE_BUFFER } from "./model";
import type { Ribbon, Footprint } from "./geometry";

/** Pixel (u, v)'s CENTRE is at world (originX + (u + 0.5) * unitsPerPx, originY + (v + 0.5) * unitsPerPx). */
export interface RasterSpec {
  width: number;
  height: number;
  originX: number;
  originY: number;
  unitsPerPx: number;
}

export const MAX_RASTER_PIXELS = 64_000_000;

export function checkSpec(s: RasterSpec): void {
  if (!(s.width > 0 && s.height > 0 && Number.isInteger(s.width) && Number.isInteger(s.height)) || s.width * s.height > MAX_RASTER_PIXELS) {
    throw new RangeError(`raster ${s.width}x${s.height} out of range`);
  }
  if (!(s.unitsPerPx > 0) || !Number.isFinite(s.originX) || !Number.isFinite(s.originY)) throw new RangeError("bad raster transform");
}

/** A raster covering the whole map at `pxPerSquare`. */
export function mapSpec(mapWidth: number, mapHeight: number, pxPerSquare: number): RasterSpec {
  return { width: Math.round(mapWidth * pxPerSquare), height: Math.round(mapHeight * pxPerSquare), originX: 0, originY: 0, unitsPerPx: GRID / pxPerSquare };
}

// ------------------------------------------------------------------ polygons

/**
 * Fills polygons (interleaved world coords) into `mask` with `value`.
 * rule "evenodd" treats all rings together (holes by nesting); "nonzero" uses winding.
 */
export function fillPolygons(mask: Uint8Array, s: RasterSpec, polys: Float64Array[], value = 255, rule: "evenodd" | "nonzero" = "evenodd"): void {
  checkSpec(s);
  // Edges in pixel space.
  const ex0: number[] = [], ey0: number[] = [], ex1: number[] = [], ey1: number[] = [];
  let minY = Infinity, maxY = -Infinity;
  for (const p of polys) {
    const n = p.length / 2;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = (p[i * 2] - s.originX) / s.unitsPerPx, y0 = (p[i * 2 + 1] - s.originY) / s.unitsPerPx;
      const x1 = (p[j * 2] - s.originX) / s.unitsPerPx, y1 = (p[j * 2 + 1] - s.originY) / s.unitsPerPx;
      if (y0 === y1) continue;
      ex0.push(x0); ey0.push(y0); ex1.push(x1); ey1.push(y1);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
  }
  if (ex0.length === 0) return;
  // Bucket edges by starting row for speed.
  const vStart = Math.max(0, Math.floor(minY - 0.5)), vEnd = Math.min(s.height - 1, Math.ceil(maxY - 0.5));
  const xs: number[] = [], ws: number[] = [];
  const order = ex0.map((_, i) => i).sort((a, b) => Math.min(ey0[a], ey1[a]) - Math.min(ey0[b], ey1[b]));
  const active: number[] = [];
  let next = 0;
  for (let v = vStart; v <= vEnd; v++) {
    const yc = v + 0.5;
    while (next < order.length && Math.min(ey0[order[next]], ey1[order[next]]) <= yc) active.push(order[next++]);
    xs.length = 0; ws.length = 0;
    for (let k = active.length - 1; k >= 0; k--) {
      const e = active[k];
      const ya = ey0[e], yb = ey1[e];
      const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      if (hi <= yc) { active.splice(k, 1); continue; }
      if (lo > yc) continue;
      // half-open [lo, hi) so shared vertices count once
      const t = (yc - ya) / (yb - ya);
      xs.push(ex0[e] + t * (ex1[e] - ex0[e]));
      ws.push(yb > ya ? 1 : -1);
    }
    if (xs.length < 2) continue;
    const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const row = v * s.width;
    let wind = 0;
    for (let k = 0; k < idx.length - 1; k++) {
      const i = idx[k];
      wind = rule === "evenodd" ? wind ^ 1 : wind + ws[i];
      if (wind === 0) continue;
      const xa = xs[i], xb = xs[idx[k + 1]];
      const u0 = Math.max(0, Math.ceil(xa - 0.5)), u1 = Math.min(s.width - 1, Math.floor(xb - 0.5));
      for (let u = u0; u <= u1; u++) mask[row + u] = value;
    }
  }
}

/** Water: every contour of the PolyTree, even-odd (body = depth 1, island = depth 2, pond on island = 3...). */
export function rasterWater(w: Water, s: RasterSpec): Uint8Array {
  const mask = new Uint8Array(s.width * s.height);
  if (!w.root) return mask;
  const polys: Float64Array[] = [];
  const stack: WaterNode[] = [w.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.polygon.length >= 6 && !n.isOpen) polys.push(n.polygon);
    for (const c of n.children) stack.push(c);
  }
  fillPolygons(mask, s, polys, 255, "evenodd");
  return mask;
}

/** Distance (in world units) from each water pixel to the nearest non-water pixel; 0 outside. Two-pass chamfer. */
export function waterDepth(mask: Uint8Array, s: RasterSpec): Float32Array {
  const W = s.width, H = s.height;
  const d = new Float32Array(W * H);
  const INF = 1e9;
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!d[i]) continue;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + a); else m = Math.min(m, a);
    if (y > 0) {
      m = Math.min(m, d[i - W] + a);
      if (x > 0) m = Math.min(m, d[i - W - 1] + b);
      if (x < W - 1) m = Math.min(m, d[i - W + 1] + b);
    } else m = Math.min(m, a);
    d[i] = m;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (!d[i]) continue;
    let m = d[i];
    if (x < W - 1) m = Math.min(m, d[i + 1] + a); else m = Math.min(m, a);
    if (y < H - 1) {
      m = Math.min(m, d[i + W] + a);
      if (x < W - 1) m = Math.min(m, d[i + W + 1] + b);
      if (x > 0) m = Math.min(m, d[i + W - 1] + b);
    } else m = Math.min(m, a);
    d[i] = m;
  }
  for (let i = 0; i < W * H; i++) d[i] *= s.unitsPerPx;
  return d;
}

// ------------------------------------------------------------------ ribbons and ellipses

/**
 * Pixel tests that rasterising calls may still make. strokeRibbon and fillEllipse charge it before
 * drawing and draw nothing (returning false) when a shape would overspend it. Parse clamps keep
 * each shape local, but a file can hold very many of them: pass one budget to every call for a
 * picture to bound their total.
 */
export interface WorkBudget {
  left: number;
}

/**
 * `perPixel` tests per raster pixel, and at least 4 M. The sample maps' paths together cost at most
 * 1.1 tests a pixel at 32 px a square, so the default leaves real maps untouched.
 */
export function workBudget(s: RasterSpec, perPixel = 32): WorkBudget {
  return { left: Math.max(1 << 22, perPixel * s.width * s.height) };
}

/**
 * Paints a ribbon: each segment sweeps a disc whose radius runs from one vertex's half-width to the
 * next's. Exact when every segment fits `budget` (default: a fresh workBudget). Otherwise the
 * centre line is thinned, keeping vertices at least tol px apart for tol = 0.5, 1, 2, ... up to a
 * quarter of the widest half-width, so the painted area moves by at most tol; if even that does
 * not fit, nothing is drawn and it returns false. Only absurd paths (hundreds of thousands of
 * samples, or retracing the picture) get that far.
 */
export function strokeRibbon(mask: Uint8Array, s: RasterSpec, r: Ribbon, value = 255, budget: WorkBudget = workBudget(s)): boolean {
  checkSpec(s);
  const L = r.line, n = L.length / 2;
  if (n < 2) return true;
  const upp = s.unitsPerPx;
  const X = new Float64Array(n), Y = new Float64Array(n), Hw = new Float64Array(n);
  let hmax = 0;
  for (let i = 0; i < n; i++) {
    X[i] = (L[i * 2] - s.originX) / upp;
    Y[i] = (L[i * 2 + 1] - s.originY) / upp;
    Hw[i] = r.halfWidth[i] / upp;
    if (Hw[i] > hmax) hmax = Hw[i];
  }
  // Segment a-b's pixel box, clipped to the raster; empty (or NaN) boxes are skipped.
  let u0 = 0, u1 = 0, v0 = 0, v1 = 0;
  const box = (a: number, b: number): boolean => {
    const hm = Math.max(Hw[a], Hw[b]);
    u0 = Math.max(0, Math.floor(Math.min(X[a], X[b]) - hm)); u1 = Math.min(s.width - 1, Math.ceil(Math.max(X[a], X[b]) + hm));
    v0 = Math.max(0, Math.floor(Math.min(Y[a], Y[b]) - hm)); v1 = Math.min(s.height - 1, Math.ceil(Math.max(Y[a], Y[b]) + hm));
    return u1 >= u0 && v1 >= v0;
  };
  const keep = new Uint32Array(n);
  let k = 0;
  for (let tol = 0; ; tol = tol ? tol * 2 : 0.5) {
    if (tol > hmax / 4) return false;
    k = 0;
    keep[k++] = 0;
    for (let i = 1; i < n - 1; i++) {
      const j = keep[k - 1];
      if (tol === 0 || Math.hypot(X[i] - X[j], Y[i] - Y[j]) >= tol) keep[k++] = i;
    }
    keep[k++] = n - 1;
    let work = 0;
    for (let q = 0; q < k - 1 && work <= budget.left; q++) if (box(keep[q], keep[q + 1])) work += (u1 - u0 + 1) * (v1 - v0 + 1);
    if (work <= budget.left) { budget.left -= work; break; }
  }
  for (let q = 0; q < k - 1; q++) {
    const a = keep[q], b = keep[q + 1];
    if (!box(a, b)) continue;
    const ax = X[a], ay = Y[a], bx = X[b], by = Y[b], ha = Hw[a], hb = Hw[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let v = v0; v <= v1; v++) {
      const py = v + 0.5;
      for (let u = u0; u <= u1; u++) {
        const px = u + 0.5;
        let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + t * dx - px, qy = ay + t * dy - py;
        const h = ha + (hb - ha) * t;
        if (qx * qx + qy * qy <= h * h) mask[v * s.width + u] = value;
      }
    }
  }
  return true;
}

/**
 * Writes `value` inside a rotated ellipse. With a `budget`, charges it the ellipse's pixel box and
 * draws nothing (false) when that would overspend it.
 */
export function fillEllipse(mask: Uint8Array | Uint16Array | Int32Array, s: RasterSpec, f: Footprint, value: number, budget?: WorkBudget): boolean {
  checkSpec(s);
  const upp = s.unitsPerPx;
  const cx = (f.cx - s.originX) / upp, cy = (f.cy - s.originY) / upp;
  const rx = f.rx / upp, ry = f.ry / upp;
  if (!(rx > 0 && ry > 0)) return true;
  const R = Math.max(rx, ry);
  const c = Math.cos(f.rotation), sn = Math.sin(f.rotation);
  const u0 = Math.max(0, Math.floor(cx - R)), u1 = Math.min(s.width - 1, Math.ceil(cx + R));
  const v0 = Math.max(0, Math.floor(cy - R)), v1 = Math.min(s.height - 1, Math.ceil(cy + R));
  if (!(u1 >= u0 && v1 >= v0)) return true;
  if (budget) {
    const work = (u1 - u0 + 1) * (v1 - v0 + 1);
    if (work > budget.left) return false;
    budget.left -= work;
  }
  for (let v = v0; v <= v1; v++) {
    const dy = v + 0.5 - cy;
    for (let u = u0; u <= u1; u++) {
      const dx = u + 0.5 - cx;
      const lx = c * dx + sn * dy, ly = -sn * dx + c * dy; // into the ellipse's frame
      if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) mask[v * s.width + u] = value;
    }
  }
  return true;
}

// ------------------------------------------------------------------ sampled fields

/**
 * Terrain weight of one slot (0..255) at each pixel, bilinear between texel centres
 * (texel (tx, ty) centre = world ((tx + 0.5) * 64, (ty + 0.5) * 64)).
 */
export function sampleTerrainSlot(t: Terrain, slot: number, s: RasterSpec): Uint8Array {
  checkSpec(s);
  const out = new Uint8Array(s.width * s.height);
  if (slot < 0 || slot >= t.slotCount) return out;
  const tw = t.width, th = t.height, n = tw * th;
  const base = slot * n;
  const texel = GRID / 4;
  for (let v = 0; v < s.height; v++) {
    const wy = s.originY + (v + 0.5) * s.unitsPerPx;
    let fy = wy / texel - 0.5;
    fy = fy < 0 ? 0 : fy > th - 1 ? th - 1 : fy;
    const y0 = Math.floor(fy), y1 = Math.min(th - 1, y0 + 1), ty = fy - y0;
    for (let u = 0; u < s.width; u++) {
      const wx = s.originX + (u + 0.5) * s.unitsPerPx;
      let fx = wx / texel - 0.5;
      fx = fx < 0 ? 0 : fx > tw - 1 ? tw - 1 : fx;
      const x0 = Math.floor(fx), x1 = Math.min(tw - 1, x0 + 1), tx = fx - x0;
      const a = t.weights[base + y0 * tw + x0], b = t.weights[base + y0 * tw + x1];
      const c = t.weights[base + y1 * tw + x0], d = t.weights[base + y1 * tw + x1];
      out[v * s.width + u] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
    }
  }
  return out;
}

/**
 * Marching-squares bitmap (cave, material) -> mask. Sample (i, j) sits at world
 * ((i - 1) * step, (j - 1) * step) (one sample of edge buffer). Bilinear interpolation of the
 * 0/1 samples thresholded at 0.5 reproduces the marching-squares iso-line (without the
 * cosmetic msi jitter).
 */
export function rasterBitGrid(g: BitGrid, s: RasterSpec, value = 255): Uint8Array {
  checkSpec(s);
  const out = new Uint8Array(s.width * s.height);
  const W = g.width, H = g.height;
  for (let v = 0; v < s.height; v++) {
    const wy = s.originY + (v + 0.5) * s.unitsPerPx;
    const fy = wy / g.step + MS_EDGE_BUFFER;
    if (fy < 0 || fy > H - 1) continue;
    const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
    for (let u = 0; u < s.width; u++) {
      const wx = s.originX + (u + 0.5) * s.unitsPerPx;
      const fx = wx / g.step + MS_EDGE_BUFFER;
      if (fx < 0 || fx > W - 1) continue;
      const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
      const a = g.bits[y0 * W + x0], b = g.bits[y0 * W + x1], c = g.bits[y1 * W + x0], d = g.bits[y1 * W + x1];
      const val = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      if (val >= 0.5) out[v * s.width + u] = value;
    }
  }
  return out;
}

/** Building-tool tile cells -> mask (whole squares). `pred` picks cells (default: any floor). */
export function rasterTiles(t: Tiles, s: RasterSpec, pred: (cell: number) => boolean = (c) => c >= 0, value = 255): Uint8Array {
  checkSpec(s);
  const out = new Uint8Array(s.width * s.height);
  for (let v = 0; v < s.height; v++) {
    const cy = Math.floor((s.originY + (v + 0.5) * s.unitsPerPx) / GRID);
    if (cy < 0 || cy >= t.height) continue;
    for (let u = 0; u < s.width; u++) {
      const cx = Math.floor((s.originX + (u + 0.5) * s.unitsPerPx) / GRID);
      if (cx < 0 || cx >= t.width) continue;
      if (pred(t.cells[cy * t.width + cx])) out[v * s.width + u] = value;
    }
  }
  return out;
}

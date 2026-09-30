// World-space geometry for the parsed model: path ribbons, object footprints, roof outlines,
// wall strokes. Pure; no DOM.

import type { Vec2, Path, MapObject, Roof, Pattern, Wall, Portal } from "./model";
import { DEFAULT_LIMITS } from "./model";

/** Godot Node2D transform: world = position + R(rotation) * (scale * local). y down, clockwise-positive. */
export function applyTransform(local: Float64Array, position: Vec2, rotation: number, scale: Vec2): Float64Array {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  const out = new Float64Array(local.length);
  for (let i = 0; i < local.length; i += 2) {
    const x = local[i] * scale.x, y = local[i + 1] * scale.y;
    out[i] = position.x + c * x - s * y;
    out[i + 1] = position.y + s * x + c * y;
  }
  return out;
}

/** Drops consecutive duplicate points (Dungeondraft often repeats the last edit point). */
export function dedupe(p: Float64Array, eps = 1e-6): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 2) {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2] - p[i]) < eps && Math.abs(out[n - 1] - p[i + 1]) < eps) continue;
    out.push(p[i], p[i + 1]);
  }
  return Float64Array.from(out);
}

/** Spline samples `smoothPolyline` aims to stay under for one path (plus one per segment at worst). */
export const MAX_SMOOTH_POINTS = 1_000_000;

/**
 * Approximates Dungeondraft's path smoothing: a Catmull-Rom spline through the edit points,
 * blended with the straight polyline by `smoothness` (0 = straight segments, 1 = full spline).
 * The exact curve Dungeondraft draws is not documented; this is close enough for masks
 * (paths are "leave as drawn" areas, and their ribbons are wide).
 */
export function smoothPolyline(p: Float64Array, smoothness: number, loop: boolean, step = 32): Float64Array {
  const pts = dedupe(p);
  const n = pts.length / 2;
  if (n < 2) return pts;
  const t = Math.max(0, Math.min(1, smoothness));
  const get = (i: number): [number, number] => {
    if (loop) i = ((i % n) + n) % n;
    else i = Math.max(0, Math.min(n - 1, i));
    return [pts[i * 2], pts[i * 2 + 1]];
  };
  const segs = loop ? n : n - 1;
  const ks = new Uint16Array(segs);
  let total = 0;
  for (let i = 0; i < segs; i++) {
    const p1 = get(i), p2 = get(i + 1);
    ks[i] = Math.max(1, Math.min(256, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step)));
    total += ks[i];
  }
  // Bounded output: a path of a million far-apart points would otherwise ask for 256 samples a
  // segment. Over the cap every segment gets proportionally fewer (at least one).
  if (total > MAX_SMOOTH_POINTS) {
    const f = MAX_SMOOTH_POINTS / total;
    for (let i = 0; i < segs; i++) ks[i] = Math.max(1, Math.floor(ks[i] * f));
  }
  const out: number[] = [];
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const k = ks[i];
    for (let j = 0; j < k; j++) {
      const u = j / k, u2 = u * u, u3 = u2 * u;
      const cx = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
      const cy = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
      const lx = p1[0] + (p2[0] - p1[0]) * u, ly = p1[1] + (p2[1] - p1[1]) * u;
      out.push(lx + (cx - lx) * t, ly + (cy - ly) * t);
    }
  }
  const last = loop ? get(0) : get(n - 1);
  out.push(last[0], last[1]);
  return Float64Array.from(out);
}

export interface Ribbon {
  /** Centre line in world units, interleaved. */
  line: Float64Array;
  /** Half-width at each centre-line vertex (tapers for grow/shrink). */
  halfWidth: Float64Array;
  closed: boolean;
}

/** The area a path paints: its smoothed centre line and width (with grow/shrink tapers). */
export function pathRibbon(p: Path): Ribbon {
  const world = applyTransform(p.editPoints, p.position, p.rotation, p.scale);
  const line = smoothPolyline(world, p.smoothness, p.loop);
  const n = line.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(line[i * 2] - line[i * 2 - 2], line[i * 2 + 1] - line[i * 2 - 1]);
  const total = cum[n - 1] || 1;
  const sx = Math.abs(p.scale.y) || 1; // Line2D width is in local units; scale.y thickens it
  // Drawn width capped like the file's own width (parse clamps width and scale separately).
  const half = Math.min(p.width * sx, DEFAULT_LIMITS.maxWidth) / 2;
  const taper = Math.min(total / 2, p.width * 2);
  const hw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let f = 1;
    if (p.grow && taper > 0) f = Math.min(f, cum[i] / taper);
    if (p.shrink && taper > 0) f = Math.min(f, (total - cum[i]) / taper);
    hw[i] = half * Math.max(0.05, f);
  }
  return { line, halfWidth: hw, closed: p.loop };
}

/** Wall centre line as a ribbon. Wall art thickness is not in the file; ~0.25 square is typical. */
export function wallRibbon(w: Wall, halfWidth = 32): Ribbon {
  const n = w.points.length / 2;
  const line = w.loop && n > 2 ? Float64Array.from([...w.points, w.points[0], w.points[1]]) : w.points;
  return { line, halfWidth: new Float64Array(line.length / 2).fill(halfWidth), closed: w.loop };
}

/** A wall portal's world endpoints (position +- direction * radius). */
export function portalSegment(p: Portal): [Vec2, Vec2] {
  let dx = p.direction ? p.direction.x : Math.cos(p.rotation);
  let dy = p.direction ? p.direction.y : Math.sin(p.rotation);
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const r = p.radius * (Math.abs(p.scale.x) || 1);
  return [{ x: p.position.x - dx * r, y: p.position.y - dy * r }, { x: p.position.x + dx * r, y: p.position.y + dy * r }];
}

export function patternPolygon(p: Pattern): Float64Array {
  return applyTransform(p.points, p.position, p.shapeRotation, p.scale);
}

/**
 * Roof footprint. `points` is the roof's centre line (the ridge axis) and `width` the slope
 * width to each side. Checked against real exports (Frozen Sick "Pelcs", hip and gable): the
 * roof covers the centre line swept +-width, ending FLAT at the first/last point for both
 * types; a hip roof's visible ridge is inset by `width` at each end, a gable's is not.
 */
export function roofPolygon(r: Roof): Float64Array {
  const ridge = dedupe(applyTransform(r.points, r.position, r.rotation, r.scale));
  const n = ridge.length / 2;
  if (n === 1) {
    const x = ridge[0], y = ridge[1], w = r.width;
    return Float64Array.from([x - w, y - w, x + w, y - w, x + w, y + w, x - w, y + w]);
  }
  const ext = 0;
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let tx = ridge[i1 * 2] - ridge[i0 * 2], ty = ridge[i1 * 2 + 1] - ridge[i0 * 2 + 1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    let x = ridge[i * 2], y = ridge[i * 2 + 1];
    if (i === 0) { x -= tx * ext; y -= ty * ext; }
    if (i === n - 1) { x += tx * ext; y += ty * ext; }
    const nx = -ty * r.width, ny = tx * r.width;
    left.push(x + nx, y + ny);
    right.push(x - nx, y - ny);
  }
  const out: number[] = [...left];
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(right[i], right[i + 1]);
  return Float64Array.from(out);
}

export interface Footprint {
  /** Rotated ellipse (world units). */
  cx: number; cy: number; rx: number; ry: number; rotation: number;
}

/**
 * Estimated footprint of a placed object. The sprite size is NOT in the map and we do not read
 * Dungeondraft's asset files, so this is a nominal radius (world units at scale 1, e.g. a role's
 * prior) times the object's scale; Seasons treats it as "search here" and measures the real
 * extent from the picture's pixels.
 */
export function objectFootprint(o: MapObject, r: number): Footprint {
  return {
    cx: o.position.x,
    cy: o.position.y,
    rx: r * Math.abs(o.scale.x || 1),
    ry: r * Math.abs(o.scale.y || 1),
    rotation: o.rotation,
  };
}

/** Ellipse outline as a polygon (for rasterisers that only fill polygons). */
export function ellipsePolygon(f: Footprint, segments = 24): Float64Array {
  const out = new Float64Array(segments * 2);
  const c = Math.cos(f.rotation), s = Math.sin(f.rotation);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * f.rx, y = Math.sin(a) * f.ry;
    out[i * 2] = f.cx + c * x - s * y;
    out[i * 2 + 1] = f.cy + s * x + c * y;
  }
  return out;
}

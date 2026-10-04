import type { GridSettings, GridType } from "./types";

export interface Point {
  x: number;
  y: number;
}

const SQRT3 = Math.sqrt(3);

/** Scenes saved before hex grids existed have no type; they're square. */
export function gridType(grid: GridSettings): GridType {
  return grid.type ?? "square";
}

export function isHex(grid: GridSettings): boolean {
  return gridType(grid) !== "square";
}

// ---------------------------------------------------------------- hex grids
//
// grid.size is the distance between the centres of two neighbouring hexes (the
// width across the flat sides). Pointy-top hexes sit in rows; flat-top hexes sit
// in columns. Coordinates use the axial (q, r) system.

/** Horizontal and vertical distance between neighbouring rows/columns of cells. */
export function cellSpacing(grid: GridSettings): { x: number; y: number } {
  const t = gridType(grid);
  if (t === "hex-pointy") return { x: grid.size, y: (grid.size * SQRT3) / 2 };
  if (t === "hex-flat") return { x: (grid.size * SQRT3) / 2, y: grid.size };
  return { x: grid.size, y: grid.size };
}

export interface Hex {
  q: number;
  r: number;
}

function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function pointToHex(p: Point, grid: GridSettings): Hex {
  const x = p.x - grid.offsetX;
  const y = p.y - grid.offsetY;
  const s = grid.size;
  if (gridType(grid) === "hex-flat") {
    const q = x / ((s * SQRT3) / 2);
    return hexRound(q, y / s - q / 2);
  }
  const r = y / ((s * SQRT3) / 2);
  return hexRound(x / s - r / 2, r);
}

export function hexCenter(h: Hex, grid: GridSettings): Point {
  const s = grid.size;
  if (gridType(grid) === "hex-flat") {
    return { x: grid.offsetX + ((s * SQRT3) / 2) * h.q, y: grid.offsetY + s * (h.r + h.q / 2) };
  }
  return { x: grid.offsetX + s * (h.q + h.r / 2), y: grid.offsetY + ((s * SQRT3) / 2) * h.r };
}

/** The six corners of a hex, as a flat [x0, y0, x1, y1, ...] list. */
export function hexCorners(center: Point, grid: GridSettings): number[] {
  const radius = grid.size / SQRT3;
  const start = gridType(grid) === "hex-flat" ? 0 : 30;
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((start + 60 * i) * Math.PI) / 180;
    out.push(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a));
  }
  return out;
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Where a token's centre lands when dropped. Odd sizes (1, 3) sit in the middle of
 * a cell, even sizes (2, 4) on a grid intersection, and sizes under one cell snap
 * to a sub-grid of their own size. On hex grids every token sits in a hex centre.
 */
export function snapTokenCenter(p: Point, size: number, grid: GridSettings): Point {
  if (isHex(grid)) return hexCenter(pointToHex(p, grid), grid);
  const g = grid.size;
  if (size < 1) {
    const step = g * size;
    return {
      x: grid.offsetX + (Math.floor((p.x - grid.offsetX) / step) + 0.5) * step,
      y: grid.offsetY + (Math.floor((p.y - grid.offsetY) / step) + 0.5) * step,
    };
  }
  const odd = Math.round(size) % 2 === 1;
  if (odd) {
    return {
      x: grid.offsetX + (Math.floor((p.x - grid.offsetX) / g) + 0.5) * g,
      y: grid.offsetY + (Math.floor((p.y - grid.offsetY) / g) + 0.5) * g,
    };
  }
  return {
    x: grid.offsetX + Math.round((p.x - grid.offsetX) / g) * g,
    y: grid.offsetY + Math.round((p.y - grid.offsetY) / g) * g,
  };
}

/** Whether a token's centre is where snapping would put it (to within half a pixel). */
export function isOnGrid(p: Point, size: number, grid: GridSettings): boolean {
  const q = snapTokenCenter(p, size, grid);
  return Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5;
}

/**
 * The hex `dx` steps right and `dy` steps down from `h`. Pointy-top hexes have no
 * neighbour straight above, so going up or down zigzags between the two, keeping to
 * one column instead of drifting sideways; flat-top hexes do the same going left or right.
 */
export function hexStep(h: Hex, dx: number, dy: number, grid: GridSettings): Hex {
  let { q, r } = h;
  const half = (n: number) => Math.floor(n / 2);
  if (gridType(grid) === "hex-flat") {
    r += dy;
    for (let i = 0; i < Math.abs(dx); i++) {
      const row = r + half(q);
      q += Math.sign(dx);
      r = row - half(q);
    }
  } else {
    q += dx;
    for (let i = 0; i < Math.abs(dy); i++) {
      const col = q + half(r);
      r += Math.sign(dy);
      q = col - half(r);
    }
  }
  return { q, r };
}

/** A point moved by whole cells, `dx` across and `dy` down, keeping where it sits within its cell. */
export function stepByCells(p: Point, dx: number, dy: number, grid: GridSettings): Point {
  if (!isHex(grid)) return { x: p.x + dx * grid.size, y: p.y + dy * grid.size };
  const h = pointToHex(p, grid);
  const from = hexCenter(h, grid);
  const to = hexCenter(hexStep(h, dx, dy, grid), grid);
  return { x: p.x + to.x - from.x, y: p.y + to.y - from.y };
}

/** Nearest grid intersection (on hex grids, the nearest hex corner). */
export function snapToVertex(p: Point, grid: GridSettings): Point {
  if (isHex(grid)) {
    const corners = hexCorners(hexCenter(pointToHex(p, grid), grid), grid);
    let best = { x: corners[0], y: corners[1] };
    for (let i = 2; i < corners.length; i += 2) {
      if (Math.hypot(corners[i] - p.x, corners[i + 1] - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) {
        best = { x: corners[i], y: corners[i + 1] };
      }
    }
    return best;
  }
  const g = grid.size;
  return {
    x: grid.offsetX + Math.round((p.x - grid.offsetX) / g) * g,
    y: grid.offsetY + Math.round((p.y - grid.offsetY) / g) * g,
  };
}

/** Centre of the cell containing p. */
export function snapToCellCenter(p: Point, grid: GridSettings): Point {
  return snapTokenCenter(p, 1, grid);
}

/** Distance between two points in grid cells, using the scene's diagonal rule. */
export function cellDistance(a: Point, b: Point, grid: GridSettings): number {
  const g = grid.size;
  if (isHex(grid)) return hexDistance(pointToHex(a, grid), pointToHex(b, grid));
  if (grid.diagonal === "euclidean") {
    return Math.hypot(b.x - a.x, b.y - a.y) / g;
  }
  const dx = Math.abs(Math.floor((b.x - grid.offsetX) / g) - Math.floor((a.x - grid.offsetX) / g));
  const dy = Math.abs(Math.floor((b.y - grid.offsetY) / g) - Math.floor((a.y - grid.offsetY) / g));
  const long = Math.max(dx, dy);
  const short = Math.min(dx, dy);
  if (grid.diagonal === "alternating") return long + Math.floor(short / 2);
  return long;
}

/**
 * A distance in the scene's unit, to 0.1 with no trailing ".0" and no float noise: "30 ft",
 * "4.5 m", "6 m" (never "6.0 m" or "4.499999 m"). Under 0.05 it keeps two decimals.
 */
export function formatDistance(cells: number, grid: GridSettings): string {
  const value = cells * grid.unit;
  let rounded = Math.round(value * 10) / 10;
  if (rounded === 0) rounded = Math.round(value * 100) / 100;
  // Never "-0".
  const text = String(rounded || 0);
  return grid.unitName ? `${text} ${grid.unitName}` : text;
}

/**
 * A reasonable first guess at a map's cell size from its pixel dimensions: the
 * common battle-map resolutions if one divides both sides evenly, otherwise about
 * 70px cells.
 */
export function guessGridSize(width: number, height: number): number {
  for (const s of [140, 128, 120, 100, 96, 72, 70, 64, 60, 50]) {
    const cols = width / s;
    const rows = height / s;
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 6 && rows >= 6 && cols <= 80 && rows <= 80) {
      return s;
    }
  }
  const cols = Math.max(1, Math.round(width / 70));
  return width / cols;
}

/** Axis-aligned bounds of a flat [x0,y0,x1,y1,...] list. */
export function bounds(points: number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Ramer–Douglas–Peucker simplification of a flat point list, so a freehand stroke
 * doesn't keep thousands of nearly collinear points.
 */
export function simplify(points: number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a * 2];
    const ay = points[a * 2 + 1];
    const bx = points[b * 2];
    const by = points[b * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      let d2: number;
      if (len2 === 0) {
        d2 = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

// ---------------------------------------------------------------- area templates

export type TemplateShape = "circle" | "cone" | "square" | "beam";

export interface TemplateGeometry {
  /** Size in cells: radius (circle), length (cone, line) or side (square). */
  cells: number;
  /** Circle only: centre and radius in world units. */
  circle: { x: number; y: number; r: number } | null;
  /** Everything else: a closed outline as [x0, y0, x1, y1, ...]. */
  polygon: number[] | null;
  label: string;
}

/**
 * The area a spell template covers, dragged from `a` (its origin) towards `b`.
 * Sizes snap to whole cells when the grid snaps. Cones follow the 5e rule: as wide
 * at the end as they are long. Lines are one cell wide.
 */
export function templateGeometry(shape: TemplateShape, a: Point, b: Point, grid: GridSettings): TemplateGeometry {
  const g = grid.size;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const round = (cells: number) => (grid.snap ? Math.max(1, Math.round(cells)) : Math.max(0.1, cells));
  if (shape === "square") {
    const cells = round(Math.max(Math.abs(dx), Math.abs(dy)) / g);
    const side = cells * g;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    return {
      cells,
      circle: null,
      polygon: [a.x, a.y, a.x + sx * side, a.y, a.x + sx * side, a.y + sy * side, a.x, a.y + sy * side],
      label: `${formatDistance(cells, grid)} cube`,
    };
  }
  const dist = Math.hypot(dx, dy);
  const cells = round(dist / g);
  const length = cells * g;
  if (shape === "circle") {
    return { cells, circle: { x: a.x, y: a.y, r: length }, polygon: null, label: `${formatDistance(cells, grid)} radius` };
  }
  const ux = dist > 0 ? dx / dist : 1;
  const uy = dist > 0 ? dy / dist : 0;
  const px = -uy;
  const py = ux;
  const ex = a.x + ux * length;
  const ey = a.y + uy * length;
  if (shape === "cone") {
    const h = length / 2;
    return {
      cells,
      circle: null,
      polygon: [a.x, a.y, ex + px * h, ey + py * h, ex - px * h, ey - py * h],
      label: `${formatDistance(cells, grid)} cone`,
    };
  }
  const w = g / 2;
  return {
    cells,
    circle: null,
    polygon: [a.x + px * w, a.y + py * w, ex + px * w, ey + py * w, ex - px * w, ey - py * w, a.x - px * w, a.y - py * w],
    label: `${formatDistance(cells, grid)} line`,
  };
}

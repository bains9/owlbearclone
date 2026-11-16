// Roofs on a built map's buildings in the 3D view (view3d.ts). A building is the rooms the
// Building tool made (walled floors: stone, wood, dirt), touching one another: a house of
// several rooms is one building. Only on a map with open ground (grass, trees outside, an
// outdoor picture): a dungeon of rooms and corridors underground gets none. Each building is
// split into rectangles, each with a gabled roof sitting on the walls, in one of a village's
// roofing colours. A roof lifts off while the party is inside, so you see in; the GM sees roofs
// half see-through. Kept apart from three.js, so it's tested without WebGL.

import { WALL_HEIGHT, WALL_SEEN, brightnessAt, shadeOf, type CoverMap, type WallMesh } from "./view3dModel";

/** A rectangle of whole squares, from (c0, r0) to (c1, r1), inclusive. */
export interface CellRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** A building: its squares, and those squares as rectangles that tile it. */
export interface BuildingCells {
  cells: [number, number][];
  rects: CellRect[];
}

const keyOf = (c: number, r: number) => `${c},${r}`;

/** The buildings among room squares: squares touching side by side are one building. */
export function buildingsOf(cells: Iterable<readonly [number, number]>): BuildingCells[] {
  const all = new Map<string, [number, number]>();
  for (const [c, r] of cells) all.set(keyOf(c, r), [c, r]);
  const seen = new Set<string>();
  const out: BuildingCells[] = [];
  // In order down the map then across, so a building's first square (and its colour) stays put.
  const order = [...all.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const start of order) {
    const k0 = keyOf(start[0], start[1]);
    if (seen.has(k0)) continue;
    seen.add(k0);
    const group: [number, number][] = [];
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i];
      group.push([c, r]);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = keyOf(c + dc, r + dr);
        const next = all.get(k);
        if (next && !seen.has(k)) {
          seen.add(k);
          queue.push(next);
        }
      }
    }
    out.push({ cells: group, rects: rectsOf(group) });
  }
  return out;
}

/**
 * Rectangles that tile a set of squares exactly: from each square not yet covered (down the map,
 * then across), as far right as the squares go, then down while every row of that width is there.
 */
export function rectsOf(cells: readonly (readonly [number, number])[]): CellRect[] {
  const left = new Set(cells.map(([c, r]) => keyOf(c, r)));
  const order = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: CellRect[] = [];
  for (const [c0, r0] of order) {
    if (!left.has(keyOf(c0, r0))) continue;
    let c1 = c0;
    while (left.has(keyOf(c1 + 1, r0))) c1++;
    let r1 = r0;
    for (;;) {
      let full = true;
      for (let c = c0; c <= c1 && full; c++) full = left.has(keyOf(c, r1 + 1));
      if (!full) break;
      r1++;
    }
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) left.delete(keyOf(c, r));
    out.push({ c0, r0, c1, r1 });
  }
  return out;
}

/** A wall's stretch, [x0, y0, x1, y1], in scene units. */
type Seg = readonly [number, number, number, number];

/** Whether two stretches cross (touching at an end counts). */
function crosses(a: Seg, b: Seg): boolean {
  const d = (p: number, q: number, r: number, s: number, t: number, u: number) => (r - p) * (u - q) - (s - q) * (t - p);
  const d1 = d(b[0], b[1], b[2], b[3], a[0], a[1]), d2 = d(b[0], b[1], b[2], b[3], a[2], a[3]);
  const d3 = d(a[0], a[1], a[2], a[3], b[0], b[1]), d4 = d(a[0], a[1], a[2], a[3], b[2], b[3]);
  return ((d1 <= 0 && d2 >= 0) || (d1 >= 0 && d2 <= 0)) && ((d3 <= 0 && d4 >= 0) || (d3 >= 0 && d4 <= 0));
}

/** Rooms smaller than this (squares) aren't buildings: a gap between two walls, a chimney. */
const SMALLEST_ROOM = 2;

/**
 * The squares the walls close off from the map's edge: a map with only walls (a Dungeondraft or
 * Universal VTT map's, with no project file to say where its floors are) has rooms where its
 * walls (doors counted as walls, shut or open) leave no way out. Walking square to square from
 * every square on the map's edge, a step between two squares is blocked where a wall crosses the
 * line between their middles; the squares never reached are inside. A room whose wall has a
 * gap (an archway) is part of the outside. As [col, row] on the scene's grid.
 */
export function enclosedCells(
  walls: readonly Seg[],
  area: { x0: number; y0: number; x1: number; y1: number },
  grid: { size: number; offsetX: number; offsetY: number },
): [number, number][] {
  const { size, offsetX, offsetY } = grid;
  if (!(size > 0) || !walls.length) return [];
  const c0 = Math.floor((area.x0 - offsetX) / size), r0 = Math.floor((area.y0 - offsetY) / size);
  const c1 = Math.ceil((area.x1 - offsetX) / size) - 1, r1 = Math.ceil((area.y1 - offsetY) / size) - 1;
  const cols = c1 - c0 + 1, rows = r1 - r0 + 1;
  if (cols <= 0 || rows <= 0 || cols * rows > 250_000) return [];
  // Walls by the squares they pass over, so a step only tests the walls near it.
  const buckets = new Map<number, Seg[]>();
  for (const w of walls) {
    const a0 = Math.floor((Math.min(w[0], w[2]) - offsetX) / size), a1 = Math.floor((Math.max(w[0], w[2]) - offsetX) / size);
    const b0 = Math.floor((Math.min(w[1], w[3]) - offsetY) / size), b1 = Math.floor((Math.max(w[1], w[3]) - offsetY) / size);
    for (let r = b0; r <= b1; r++) {
      for (let c = a0; c <= a1; c++) {
        if (c < c0 || c > c1 || r < r0 || r > r1) continue;
        const k = (r - r0) * cols + (c - c0);
        const list = buckets.get(k);
        if (list) list.push(w);
        else buckets.set(k, [w]);
      }
    }
  }
  const mid = (c: number, r: number): [number, number] => [offsetX + (c + 0.5) * size, offsetY + (r + 0.5) * size];
  const blocked = (ca: number, ra: number, cb: number, rb: number) => {
    const [ax, ay] = mid(ca, ra), [bx, by] = mid(cb, rb);
    const step: Seg = [ax, ay, bx, by];
    for (const [c, r] of [[ca, ra], [cb, rb]]) {
      for (const w of buckets.get((r - r0) * cols + (c - c0)) ?? []) if (crosses(step, w)) return true;
    }
    return false;
  };
  const reached = new Uint8Array(cols * rows);
  const queue: number[] = [];
  for (let c = 0; c < cols; c++) for (const r of [0, rows - 1]) queue.push(r * cols + c);
  for (let r = 0; r < rows; r++) for (const c of [0, cols - 1]) queue.push(r * cols + c);
  for (const k of queue) reached[k] = 1;
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const c = k % cols, r = Math.floor(k / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nk = nr * cols + nc;
      if (reached[nk] || blocked(c + c0, r + r0, nc + c0, nr + r0)) continue;
      reached[nk] = 1;
      queue.push(nk);
    }
  }
  const inside: [number, number][] = [];
  for (let k = 0; k < reached.length; k++) if (!reached[k]) inside.push([(k % cols) + c0, Math.floor(k / cols) + r0]);
  // Pockets too small to be rooms stay without a roof.
  return buildingsOf(inside)
    .filter((b) => b.cells.length >= SMALLEST_ROOM)
    .flatMap((b) => b.cells);
}

/** A building as the 3D view gets it from the board (board.ts source3d), in scene units. */
export interface Building3d {
  /** The same for the same building while it isn't changed: its first square. */
  id: string;
  /** Its rectangles, each from (x0, y0) to (x1, y1). */
  rects: { x0: number; y0: number; x1: number; y1: number }[];
  /** Where to look to tell whether it's been seen: its squares' middles, and just outside its walls. */
  samples: { x: number; y: number }[];
  /** A character the party plays (or a player's token) stands inside: its roof lifts off. */
  inside: boolean;
}

/** The scene points that tell whether a building has been seen: each square's middle, and the ground half a square outside each outer edge. */
export function samplesOf(b: BuildingCells, toX: (col: number) => number, toY: (row: number) => number, size: number): { x: number; y: number }[] {
  const has = new Set(b.cells.map(([c, r]) => keyOf(c, r)));
  const out: { x: number; y: number }[] = [];
  for (const [c, r] of b.cells) {
    const x = toX(c) + size / 2, y = toY(r) + size / 2;
    out.push({ x, y });
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!has.has(keyOf(c + dc, r + dr))) out.push({ x: x + dc * size, y: y + dr * size });
  }
  return out;
}

/** How lit a building is for this page: the brightest place it's been seen from. */
export function buildingLight(b: Pick<Building3d, "samples">, cover: CoverMap | null): number {
  let best = 0;
  for (const p of b.samples) {
    best = Math.max(best, brightnessAt(cover, p.x, p.y));
    if (best >= 1) break;
  }
  return best;
}

/**
 * Whether a building's roof shows for this page: not while the party is inside (it's lifted off),
 * and for a player only once the building has been seen, from inside or out (not under the fog,
 * nor in the dark not explored). The GM sees every one.
 */
export function roofShown(b: Pick<Building3d, "samples" | "inside">, cover: CoverMap | null, all: boolean): boolean {
  if (b.inside) return false;
  return all || buildingLight(b, cover) >= WALL_SEEN;
}

type Rgb = readonly [number, number, number];

/** A village's roofs: slate, red tiles, wooden shingles, thatch. */
export const ROOF_COLOURS: readonly Rgb[] = [
  [0.3, 0.33, 0.39],
  [0.55, 0.25, 0.18],
  [0.42, 0.3, 0.21],
  [0.62, 0.52, 0.31],
];

/** A building's roof colour: one of the village's, the same every time for the same building. */
export function roofColour(id: string): Rgb {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ROOF_COLOURS[(h >>> 0) % ROOF_COLOURS.length];
}

/** How far a roof reaches past its walls, in squares. */
export const OVERHANG = 0.18;
/** A roof's pitch: its ridge rises this much for each square from the eaves in. */
export const PITCH = 0.6;
/**
 * The highest a ridge stands above the eaves, in squares (12 m). A roof keeps its pitch as its
 * building widens, so a great hall's stands far taller than a cottage's (it was 2, which flattened
 * every big building's roof to 3 m; raised for Dungeon's Town hall, "very tall roofs", 16 November 2026).
 */
export const MAX_RIDGE = 8;

/**
 * A building's roof as triangles, in squares: on each rectangle, a gable roof from the top of the
 * walls, its ridge along the rectangle's longer side, sloping down to eaves a little past the
 * walls, with a gable end at each end. Shaded by `light` (how lit the building is).
 */
export function roofMesh(rects: readonly { x0: number; y0: number; x1: number; y1: number }[], cell: number, colour: Rgb, light: number): WallMesh {
  const position: number[] = [], normal: number[] = [], color: number[] = [];
  const s = shadeOf(light);
  const slope: Rgb = [colour[0] * s, colour[1] * s, colour[2] * s];
  const gable: Rgb = [colour[0] * s * 0.75, colour[1] * s * 0.75, colour[2] * s * 0.75];
  /** A triangle facing the way `out` points (wound so WebGL draws that side). */
  const face = (a: number[], b: number[], c: number[], col: Rgb, out: readonly number[]) => {
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
  const h0 = WALL_HEIGHT;
  const up = [0, 1, 0];
  for (const r of rects) {
    const x0 = r.x0 / cell - OVERHANG, x1 = r.x1 / cell + OVERHANG;
    const z0 = r.y0 / cell - OVERHANG, z1 = r.y1 / cell + OVERHANG;
    const w = x1 - x0, d = z1 - z0;
    if (w >= d) {
      // The ridge runs along x, over the middle.
      const zm = (z0 + z1) / 2, h1 = h0 + Math.min(MAX_RIDGE, (d / 2) * PITCH);
      face([x0, h0, z0], [x1, h0, z0], [x1, h1, zm], slope, up);
      face([x0, h0, z0], [x1, h1, zm], [x0, h1, zm], slope, up);
      face([x0, h0, z1], [x0, h1, zm], [x1, h1, zm], slope, up);
      face([x0, h0, z1], [x1, h1, zm], [x1, h0, z1], slope, up);
      face([x0, h0, z0], [x0, h0, z1], [x0, h1, zm], gable, [-1, 0, 0]);
      face([x1, h0, z0], [x1, h0, z1], [x1, h1, zm], gable, [1, 0, 0]);
    } else {
      const xm = (x0 + x1) / 2, h1 = h0 + Math.min(MAX_RIDGE, (w / 2) * PITCH);
      face([x0, h0, z0], [xm, h1, z0], [xm, h1, z1], slope, up);
      face([x0, h0, z0], [xm, h1, z1], [x0, h0, z1], slope, up);
      face([x1, h0, z0], [x1, h0, z1], [xm, h1, z1], slope, up);
      face([x1, h0, z0], [xm, h1, z1], [xm, h1, z0], slope, up);
      face([x0, h0, z0], [x1, h0, z0], [xm, h1, z0], gable, [0, 0, -1]);
      face([x0, h0, z1], [x1, h0, z1], [xm, h1, z1], gable, [0, 0, 1]);
    }
  }
  return { position: Float32Array.from(position), normal: Float32Array.from(normal), color: Float32Array.from(color) };
}

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
/** The highest a ridge stands above the eaves, in squares. */
export const MAX_RIDGE = 2;

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

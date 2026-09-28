// Built maps: floors, walls, doors and objects the GM paints onto a scene's square
// grid with the Build tool. They're stored as "terrain" items, one per 16 x 16 block
// of grid cells (a chunk), so an edit only rewrites the chunks it touches.

import type { GridSettings, TerrainItem } from "./types";

/** Cells along each side of a chunk. */
export const CHUNK = 16;
export const CHUNK_CELLS = CHUNK * CHUNK;
/** Chunk coordinates stay within this range (far beyond the biggest scene at the smallest grid). */
export const CHUNK_RANGE = 1000;
/** Objects one chunk can hold. */
export const MAX_STAMPS_PER_CHUNK = 64;

/**
 * One character per cell, row by row. "." is empty. A lowercase room floor (stone, wood,
 * dirt) gets walls where it meets anything but another room floor: empty space, grass,
 * water or lava (terrain lies under buildings, as in Dungeondraft). The uppercase letter
 * is the same floor without them, for patching an uploaded map.
 */
export type FloorId = "s" | "w" | "d" | "g" | "a" | "l";
export const FLOORS: { id: FloorId; name: string; color: string; walls: boolean }[] = [
  { id: "s", name: "Stone", color: "#cfc8ba", walls: true },
  { id: "w", name: "Wood", color: "#a8723d", walls: true },
  { id: "d", name: "Dirt", color: "#977650", walls: true },
  { id: "g", name: "Grass", color: "#6e9a45", walls: false },
  { id: "a", name: "Water", color: "#3f7fb0", walls: false },
  { id: "l", name: "Lava", color: "#d9531e", walls: false },
];
export const EMPTY = ".";
const CELLS_RE = /^[.swdgalSWD]{256}$/;
const EMPTY_CELLS = EMPTY.repeat(CHUNK_CELLS);

/**
 * Two characters per cell: its top edge, then its left edge. (A cell's right and bottom
 * edges are the left and top edges of its neighbours.)
 *   "."  automatic: a wall if a walled room floor meets anything but a room floor here, otherwise open
 *   "o"  open, even where a wall would be drawn automatically
 *   "w"  wall
 *   "d"  door (on a line with no wall, or in an automatic one)
 *   "D"  door cut into a hand-drawn wall (taking it away puts that wall back)
 * Secret doors live only in hidden chunks (players never receive those), where an edge
 * is "." (nothing) or "s" (the wall there is a secret door).
 */
export type EdgeChar = "." | "o" | "w" | "d" | "D";
const EDGES_RE = /^[.owdD]{512}$/;
const SECRET_EDGES_RE = /^[.s]{512}$/;
const EMPTY_EDGES = EMPTY.repeat(CHUNK_CELLS * 2);

/** Objects: furniture and scenery drawn on the floor. */
export const STAMP_IDS = [
  "table",
  "chair",
  "bed",
  "chest",
  "barrel",
  "crate",
  "shelf",
  "stairs",
  "pillar",
  "statue",
  "well",
  "tree",
  "bush",
  "rock",
  "campfire",
  "rubble",
] as const;
export type StampId = (typeof STAMP_IDS)[number];
export const STAMP_NAMES: Record<StampId, string> = {
  table: "Table",
  chair: "Chair",
  bed: "Bed",
  chest: "Chest",
  barrel: "Barrel",
  crate: "Crate",
  shelf: "Bookshelf",
  stairs: "Stairs",
  pillar: "Pillar",
  statue: "Statue",
  well: "Well",
  tree: "Tree",
  bush: "Bush",
  rock: "Rock",
  campfire: "Campfire",
  rubble: "Rubble",
};
export const STAMP_SIZE_MAX = 3;

/**
 * An object: what it is, the column and row of its top-left cell within the chunk,
 * quarter turns clockwise, and how many cells wide (and tall) it is.
 */
export type Stamp = [id: StampId, col: number, row: number, turns: number, size: number];

export function emptyCells(): string {
  return EMPTY_CELLS;
}

export function emptyEdges(): string {
  return EMPTY_EDGES;
}

function enc(n: number): string {
  return n < 0 ? `m${-n}` : String(n);
}

/**
 * The id of a scene's chunk at (cx, cy). Derived, not random, so there's only ever one
 * chunk per place: two tabs creating it at once both write the same item.
 */
export function terrainId(sceneId: string, cx: number, cy: number): string {
  return `t${enc(cx)}_${enc(cy)}_${sceneId}`;
}

/** Ids that look like a chunk's: hidden (secret door) chunks must not use one. */
export function looksLikeTerrainId(id: string): boolean {
  return /^tm?\d+_m?\d+_/.test(id);
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Floor division that works for negative numbers. */
export function chunkOf(n: number): number {
  return Math.floor(n / CHUNK);
}

/** Position within a chunk (0-15), for negative numbers too. */
export function inChunk(n: number): number {
  return ((n % CHUNK) + CHUNK) % CHUNK;
}

export function isWalledFloor(ch: string): boolean {
  return ch === "s" || ch === "w" || ch === "d";
}

/** A room's floor (stone, wood or dirt, with walls or without), as the Building tool paints. */
export function isBuildingFloor(ch: string): boolean {
  return ch === "s" || ch === "w" || ch === "d" || ch === "S" || ch === "W" || ch === "D";
}

/** Grass, water or lava, as the Terrain tool paints. */
export function isTerrainFloor(ch: string): boolean {
  return ch === "g" || ch === "a" || ch === "l";
}

/** The grid cell (column, row) containing a point. */
export function cellAt(x: number, y: number, grid: GridSettings): { col: number; row: number } {
  return { col: Math.floor((x - grid.offsetX) / grid.size), row: Math.floor((y - grid.offsetY) / grid.size) };
}

/** The range of cells that overlap a scene of this size: [c0, c1] x [r0, r1], inclusive. */
export function sceneCells(width: number, height: number, grid: GridSettings): { c0: number; r0: number; c1: number; r1: number } {
  return {
    // (|| 0: no -0.)
    c0: Math.floor(-grid.offsetX / grid.size) || 0,
    r0: Math.floor(-grid.offsetY / grid.size) || 0,
    c1: Math.ceil((width - grid.offsetX) / grid.size) - 1,
    r1: Math.ceil((height - grid.offsetY) / grid.size) - 1,
  };
}

// ---------------------------------------------------------------- validation

function chunkCoord(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= CHUNK_RANGE ? v : undefined;
}

export function cleanCells(v: unknown): string | undefined {
  return typeof v === "string" && CELLS_RE.test(v) ? v : undefined;
}

export function cleanEdges(v: unknown): string | undefined {
  return typeof v === "string" && (EDGES_RE.test(v) || SECRET_EDGES_RE.test(v)) ? v : undefined;
}

export function cleanStamps(v: unknown): Stamp[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_STAMPS_PER_CHUNK) return undefined;
  const out: Stamp[] = [];
  for (const s of v) {
    if (!Array.isArray(s) || s.length !== 5) return undefined;
    const [id, col, row, turns, size] = s as unknown[];
    const kind = STAMP_IDS.find((k) => k === id);
    const cell = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < CHUNK;
    if (!kind || !cell(col) || !cell(row)) return undefined;
    if (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0 || turns > 3) return undefined;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > STAMP_SIZE_MAX) return undefined;
    out.push([kind, col as number, row as number, turns, size]);
  }
  return out;
}

/** Whether a set of terrain fields is right for a public chunk, or for a hidden (secret door) one. */
export function terrainFieldsOk(hidden: boolean, f: { cells?: string; edges?: string; stamps?: Stamp[] }): boolean {
  if (hidden) {
    if (f.cells !== undefined && f.cells !== EMPTY_CELLS) return false;
    if (f.edges !== undefined && !SECRET_EDGES_RE.test(f.edges)) return false;
    if (f.stamps !== undefined && f.stamps.length) return false;
    return true;
  }
  return f.edges === undefined || EDGES_RE.test(f.edges);
}

/** Validates a terrain item. The owner is always the GM: only the GM builds. */
export function sanitizeTerrain(r: Record<string, unknown>, id: string, sceneId: string, owner: string): TerrainItem | null {
  const cx = chunkCoord(r.cx);
  const cy = chunkCoord(r.cy);
  if (cx === undefined || cy === undefined) return null;
  const hidden = r.hidden === true;
  if (hidden ? looksLikeTerrainId(id) : id !== terrainId(sceneId, cx, cy)) return null;
  if (id.length > 64) return null;
  const cells = cleanCells(r.cells);
  const edges = cleanEdges(r.edges);
  const stamps = cleanStamps(r.stamps ?? []);
  if (cells === undefined || edges === undefined || stamps === undefined) return null;
  if (!terrainFieldsOk(hidden, { cells, edges, stamps })) return null;
  return {
    id,
    sceneId,
    kind: "terrain",
    z: 0,
    owner,
    cx,
    cy,
    cells,
    edges,
    stamps,
    ...(hidden ? { hidden: true } : {}),
  };
}

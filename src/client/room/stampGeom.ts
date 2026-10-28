// Objects on the grid, as the Build tool's Objects and Select modes handle them: where
// one stands, what it covers when drawn, what a click hits, and how a group of them moves,
// turns and changes size. All in grid cells, with nothing to draw on.
//
// An object stands on a block of whole cells (1, 2 or 3 on a side, from its size) and is
// drawn centred on it, turned to any 5 degrees and sized in quarter squares. Chunks,
// erasing, what's outdoors and undo go by the block, so they stay cell by cell; clicks
// and outlines go by the drawing, so what you see is what you click.
//
// Placed off the grid (Snap to squares unticked), the block's top-left can be anywhere, to
// a sixteenth of a square (STAMP_POS_STEP); the cells it then stands on are every cell the
// block overlaps. Moving, turning, sizing and pasting keep an object on the grid if it was,
// and off the grid exactly where it lands (see the `free` flags).

import {
  CHUNK,
  STAMP_DEG_STEP,
  STAMP_POS_STEP,
  STAMP_SIZE_MAX,
  STAMP_SIZE_MIN,
  STAMP_SIZE_STEP,
  chunkOf,
  inChunk,
  isStampId,
  makeStamp,
  snapDeg,
  snapPos,
  snapSize,
  stampBlock,
  stampDeg,
} from "../../shared/terrain";
import type { CellBounds, Stamp, StampId } from "../../shared/terrain";

/** An object where it stands: col and row are the scene cell of its block's top-left (in sixteenths, off the grid). */
export interface Placed {
  id: StampId;
  col: number;
  row: number;
  /** Degrees clockwise, 0-355 in steps of 5. */
  deg: number;
  /** Squares, 0.5-3 in quarter squares. */
  size: number;
}

/**
 * How far an object's drawing can reach from its block's top-left cell: 1 cell before it
 * and 3 after (3 squares, turned 45 degrees).
 */
export const STAMP_DRAW_BEFORE = 1;
export const STAMP_DRAW_AFTER = 3;
/** The most objects copied (and pasted) at once. */
export const CLIPBOARD_MAX = 256;

/** An object stored in the chunk at (cx, cy), where it stands in the scene. */
export function placedOf(cx: number, cy: number, s: Stamp): Placed {
  return { id: s[0], col: cx * CHUNK + s[1], row: cy * CHUNK + s[2], deg: stampDeg(s), size: s[4] };
}

/** The chunk an object belongs to (its block's top-left cell's) and the object as stored there. */
export function stampFor(p: Placed): { cx: number; cy: number; stamp: Stamp } {
  return { cx: chunkOf(p.col), cy: chunkOf(p.row), stamp: makeStamp(p.id, inChunk(p.col), inChunk(p.row), p.deg, p.size) };
}

/** The middle of its block: a cell's middle for 1 and 3 squares, a grid corner for 2. */
export function centreOf(p: Placed): { x: number; y: number } {
  const n = stampBlock(p.size);
  return { x: p.col + n / 2, y: p.row + n / 2 };
}

/** The cells it stands on: every cell its block overlaps (n by n on the grid, n + 1 off it). */
export function blockOf(p: Placed): CellBounds {
  const n = stampBlock(p.size);
  return { c0: Math.floor(p.col), r0: Math.floor(p.row), c1: Math.ceil(p.col + n) - 1, r1: Math.ceil(p.row + n) - 1 };
}

/** Whether it stands on whole cells. */
export function onGrid(p: Placed): boolean {
  return Number.isInteger(p.col) && Number.isInteger(p.row);
}

/** The cosine and sine of an angle in degrees, exact for quarter turns. */
function cosSin(deg: number): [number, number] {
  switch (((deg % 360) + 360) % 360) {
    case 0:
      return [1, 0];
    case 90:
      return [0, 1];
    case 180:
      return [-1, 0];
    case 270:
      return [0, -1];
  }
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** The cells its drawing (its size square, turned) reaches into. */
export function drawnBounds(p: Placed): CellBounds {
  const { x, y } = centreOf(p);
  const [cos, sin] = cosSin(p.deg);
  // Half the width of the turned square's bounding box: exactly half its size for quarter turns.
  const h = (p.size / 2) * (Math.abs(cos) + Math.abs(sin));
  return { c0: Math.floor(x - h), r0: Math.floor(y - h), c1: Math.ceil(x + h) - 1, r1: Math.ceil(y + h) - 1 };
}

/** Whether a point (in cells, fractional) is on its drawing, grown by pad cells all round. */
export function hitsPoint(p: Placed, u: number, v: number, pad: number): boolean {
  const { x, y } = centreOf(p);
  const [cos, sin] = cosSin(p.deg);
  const dx = u - x;
  const dy = v - y;
  // Turned back by its angle, the drawing is an upright square round the origin.
  const r = p.size / 2 + pad;
  return Math.abs(dx * cos + dy * sin) <= r && Math.abs(-dx * sin + dy * cos) <= r;
}

/**
 * The top-left cell (on one axis) of a block of toN squares centred where a block of fromN
 * squares at a is. When that falls between cells, growing rounds towards the top left and
 * shrinking away from it, so one step up and one down always come back to the same place
 * (unless something moves it in between, as the scene's edge can: see sizeGroup).
 */
export function rescaleAnchor(a: number, fromN: number, toN: number): number {
  const x = (2 * a + fromN - toN) / 2;
  // Off the grid, exactly about its middle (a sixteenth plus half a whole is still a sixteenth).
  if (!Number.isInteger(a)) return snapPos(x);
  // (|| 0: no -0.)
  return (Number.isInteger(x) ? x : toN > fromN ? Math.floor(x) : Math.ceil(x)) || 0;
}

export function samePlaced(a: Placed, b: Placed): boolean {
  return a.id === b.id && a.col === b.col && a.row === b.row && a.deg === b.deg && a.size === b.size;
}

/** The cells a group's blocks cover, as one box. */
export function groupBlock(ps: Placed[]): CellBounds {
  const out = { c0: Infinity, r0: Infinity, c1: -Infinity, r1: -Infinity };
  for (const p of ps) {
    const b = blockOf(p);
    out.c0 = Math.min(out.c0, b.c0);
    out.r0 = Math.min(out.r0, b.r0);
    out.c1 = Math.max(out.c1, b.c1);
    out.r1 = Math.max(out.r1, b.r1);
  }
  return out;
}

/**
 * A move of a group, cut short so every block stays within b. On an axis where the group
 * can't fit at all, it doesn't move that way. (One already off the scene, because the scene
 * was made smaller, is pulled back on by the first move.)
 */
export function clampShift(ps: Placed[], dCol: number, dRow: number, b: CellBounds): { dCol: number; dRow: number } {
  let loC = -Infinity;
  let hiC = Infinity;
  let loR = -Infinity;
  let hiR = Infinity;
  for (const p of ps) {
    // The block's far edge stays on or before the far edge of b's last cell.
    const n = stampBlock(p.size);
    loC = Math.max(loC, b.c0 - p.col);
    hiC = Math.min(hiC, b.c1 + 1 - (p.col + n));
    loR = Math.max(loR, b.r0 - p.row);
    hiR = Math.min(hiR, b.r1 + 1 - (p.row + n));
  }
  const clamp = (d: number, lo: number, hi: number) => (lo <= hi ? Math.min(hi, Math.max(lo, d)) : 0);
  return { dCol: clamp(dCol, loC, hiC), dRow: clamp(dRow, loR, hiR) };
}

/** A group moved together (see clampShift). */
export function shiftGroup(ps: Placed[], dCol: number, dRow: number, b: CellBounds): Placed[] {
  const s = clampShift(ps, dCol, dRow, b);
  return ps.map((p) => ({ ...p, col: p.col + s.dCol, row: p.row + s.dRow }));
}

/**
 * Each object made bigger or smaller where it stands (about its own middle), kept to
 * the sizes there are, and then kept within b. One already at the limit stays as it is.
 *
 * base, if given, is the same objects (in the same order) as they were when this run of
 * steps began, and each is sized about the middle it had then. Coming back to the size it
 * started at then brings it back to where it started, even where the scene's edge moved
 * it on the way. (Step by step that can't be done there: on the edge, one a square bigger
 * stands in the same place whether it came from the edge or from a square in.)
 */
export function sizeGroup(ps: Placed[], dSize: number, b: CellBounds, base: Placed[] = ps): Placed[] {
  return ps.map((p, k) => {
    const size = snapSize(p.size + dSize);
    if (size === p.size) return { ...p };
    const from = base[k] ?? p;
    const to = stampBlock(size);
    const col = Math.max(b.c0, Math.min(b.c1 - to + 1, rescaleAnchor(from.col, stampBlock(from.size), to)));
    const row = Math.max(b.r0, Math.min(b.r1 - to + 1, rescaleAnchor(from.row, stampBlock(from.size), to)));
    return { ...p, col, row, size };
  });
}

/**
 * A group turned deg degrees clockwise as a whole, about the middle of its blocks, each
 * object turned the same and standing on the cells nearest where it lands; then kept
 * within b. Turned from the same base each time (not from the last result), so six turns
 * of 15 degrees are exactly one quarter turn. Quarter turns are worked out in whole
 * numbers: exact, or, when the group is an odd number of cells wider than it is tall (or
 * the other way), every object shifted the same half cell. One object turns where it is.
 * A group that, turned, is bigger than b one way can't be kept within it whole: each object
 * that would be off it is then moved just onto it (as sizing does), so none is ever left
 * where it isn't drawn and can't be picked.
 */
export function turnGroup(base: Placed[], deg: number, b: CellBounds, free = false): Placed[] {
  if (!base.length) return [];
  if (free) return turnFree(base, deg, b);
  const g = groupBlock(base);
  const w = g.c1 - g.c0 + 1;
  const h = g.r1 - g.r0 + 1;
  const d = ((deg % 360) + 360) % 360;
  let turned: Placed[];
  if (d % 90 === 0) {
    // Twice the coordinates: every middle (of a cell, or a corner) is then a whole number.
    const px = 2 * g.c0 + w;
    const py = 2 * g.r0 + h;
    turned = base.map((p) => {
      const n = stampBlock(p.size);
      const x = 2 * p.col + n - px;
      const y = 2 * p.row + n - py;
      const [rx, ry] = d === 90 ? [-y, x] : d === 180 ? [-x, -y] : d === 270 ? [y, -x] : [x, y];
      // The block whose middle is nearest, halves rounded up: floor(middle - n/2 + 1/2), doubled.
      return { ...p, col: Math.floor((px + rx - n + 1) / 2), row: Math.floor((py + ry - n + 1) / 2), deg: snapDeg(p.deg + deg) };
    });
  } else {
    const [cos, sin] = cosSin(d);
    const px = g.c0 + w / 2;
    const py = g.r0 + h / 2;
    turned = base.map((p) => {
      const n = stampBlock(p.size);
      const x = p.col + n / 2 - px;
      const y = p.row + n / 2 - py;
      const mx = px + x * cos - y * sin;
      const my = py + x * sin + y * cos;
      return { ...p, col: Math.floor(mx - n / 2 + 0.5), row: Math.floor(my - n / 2 + 0.5), deg: snapDeg(p.deg + deg) };
    });
  }
  return keepWithin(shiftGroup(turned, 0, 0, b), b);
}

/** The box a group's blocks fill exactly (off the grid, not rounded out to whole cells). */
function groupBox(ps: Placed[]): { x0: number; y0: number; x1: number; y1: number } {
  const out = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of ps) {
    const n = stampBlock(p.size);
    out.x0 = Math.min(out.x0, p.col);
    out.y0 = Math.min(out.y0, p.row);
    out.x1 = Math.max(out.x1, p.col + n);
    out.y1 = Math.max(out.y1, p.row + n);
  }
  return out;
}

/** Keeps every block within b, each moved just onto it if it's off (as sizing does). */
function keepWithin(ps: Placed[], b: CellBounds): Placed[] {
  return ps.map((p) => {
    const n = stampBlock(p.size);
    return { ...p, col: Math.max(b.c0, Math.min(b.c1 + 1 - n, p.col)), row: Math.max(b.r0, Math.min(b.r1 + 1 - n, p.row)) };
  });
}

/**
 * turnGroup off the grid: each object's middle turned about the middle of the group's
 * blocks, exactly, to a sixteenth of a square; then kept within b.
 */
function turnFree(base: Placed[], deg: number, b: CellBounds): Placed[] {
  const g = groupBox(base);
  const px = (g.x0 + g.x1) / 2;
  const py = (g.y0 + g.y1) / 2;
  const [cos, sin] = cosSin(((deg % 360) + 360) % 360);
  const turned = base.map((p) => {
    const n = stampBlock(p.size);
    const x = p.col + n / 2 - px;
    const y = p.row + n / 2 - py;
    return { ...p, col: snapPos(px + x * cos - y * sin - n / 2), row: snapPos(py + x * sin + y * cos - n / 2), deg: snapDeg(p.deg + deg) };
  });
  return keepWithin(shiftGroup(turned, 0, 0, b), b);
}

/** Whether any of them can be made bigger (dir 1) or smaller (-1). */
export function canResize(ps: Placed[], dir: 1 | -1): boolean {
  return ps.some((p) => (dir > 0 ? p.size < STAMP_SIZE_MAX : p.size > STAMP_SIZE_MIN));
}

/** Whether every block is within b. */
export function groupFits(ps: Placed[], b: CellBounds): boolean {
  return ps.every((p) => {
    const n = stampBlock(p.size);
    return p.col >= b.c0 && p.row >= b.r0 && p.col + n <= b.c1 + 1 && p.row + n <= b.r1 + 1;
  });
}

/**
 * A group moved so its blocks are centred on the cell (col, row), as near as whole cells
 * allow (their top-left at col - floor(width / 2), row - floor(height / 2)), and kept
 * within b; null if it's bigger than b. With free, (col, row) is a point in cells
 * (fractional) and the group is centred on it exactly, to a sixteenth of a square.
 */
export function placeGroupAt(ps: Placed[], col: number, row: number, b: CellBounds, free = false): Placed[] | null {
  if (!ps.length) return [];
  if (free) {
    const g = groupBox(ps);
    const w = g.x1 - g.x0;
    const h = g.y1 - g.y0;
    if (w > b.c1 - b.c0 + 1 || h > b.r1 - b.r0 + 1) return null;
    const x = snapPos(Math.max(b.c0, Math.min(b.c1 + 1 - w, col - w / 2)));
    const y = snapPos(Math.max(b.r0, Math.min(b.r1 + 1 - h, row - h / 2)));
    return ps.map((p) => ({ ...p, col: snapPos(p.col + x - g.x0), row: snapPos(p.row + y - g.y0) }));
  }
  const g = groupBlock(ps);
  const w = g.c1 - g.c0 + 1;
  const h = g.r1 - g.r0 + 1;
  if (w > b.c1 - b.c0 + 1 || h > b.r1 - b.r0 + 1) return null;
  const x = Math.max(b.c0, Math.min(b.c1 - w + 1, col - Math.floor(w / 2)));
  const y = Math.max(b.r0, Math.min(b.r1 - h + 1, row - Math.floor(h / 2)));
  return ps.map((p) => ({ ...p, col: p.col + x - g.c0, row: p.row + y - g.r0 }));
}

// ---------------------------------------------------------------- the clipboard

const CLIP_TAG = "build-objects";
/** Far beyond the biggest scene: a pasted group is kept within the scene anyway. */
const CLIP_SPAN = 4095;

/**
 * Objects as text for the system clipboard, so they can be pasted into another scene,
 * tab or room: each as [id, column, row, degrees, size], the columns and rows counted
 * from the group's top-left (in sixteenths of a square, for objects off the grid).
 */
export function encodeObjects(ps: Placed[]): string {
  let c0 = Infinity;
  let r0 = Infinity;
  for (const p of ps) {
    c0 = Math.min(c0, p.col);
    r0 = Math.min(r0, p.row);
  }
  return JSON.stringify({ tabletop: CLIP_TAG, v: 1, objects: ps.map((p) => [p.id, p.col - c0, p.row - r0, p.deg, p.size]) });
}

/**
 * Objects from clipboard text, or null if it isn't objects copied from Tabletop (or has
 * anything wrong with it). Their columns and rows are counted from the group's top-left.
 */
export function decodeObjects(text: string): Placed[] | null {
  if (typeof text !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { tabletop, v, objects } = data as Record<string, unknown>;
  if (tabletop !== CLIP_TAG || v !== 1 || !Array.isArray(objects)) return null;
  if (objects.length < 1 || objects.length > CLIPBOARD_MAX) return null;
  const whole = (n: unknown, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
  // A column or row: a whole cell, or a sixteenth of a square off the grid.
  const pos = (n: unknown, max: number): n is number => typeof n === "number" && Number.isInteger(n / STAMP_POS_STEP) && n >= 0 && n <= max;
  const out: Placed[] = [];
  for (const o of objects) {
    // Anything after the size is left for later versions.
    if (!Array.isArray(o) || o.length < 5) return null;
    const [id, col, row, deg, size] = o as unknown[];
    const kind = isStampId(id) ? id : undefined;
    if (!kind || !pos(col, CLIP_SPAN) || !pos(row, CLIP_SPAN) || !whole(deg, 360 - STAMP_DEG_STEP) || deg % STAMP_DEG_STEP) return null;
    if (typeof size !== "number" || !Number.isInteger(size / STAMP_SIZE_STEP) || size < STAMP_SIZE_MIN || size > STAMP_SIZE_MAX) return null;
    out.push({ id: kind, col, row, deg, size });
  }
  let c0 = Infinity;
  let r0 = Infinity;
  for (const p of out) {
    c0 = Math.min(c0, p.col);
    r0 = Math.min(r0, p.row);
  }
  return out.map((p) => ({ ...p, col: p.col - c0, row: p.row - r0 }));
}

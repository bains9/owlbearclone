// What the party has explored on a scene with lighting and line of sight (client/room/vision.ts):
// every place they've seen stays on the map for players, dimmed, after they've moved on. It's
// kept for the whole party on a grid of half squares over the scene's area, one bit a cell. The
// browsers say which cells they've just seen (ClientAction "explore"); the Room keeps them and
// tells everyone. The grid's key changes when the scene's grid or area does, and what was kept
// for the old one is let go.

import type { Scene } from "./types";
import { sceneBounds } from "./types";

/** At most this many cells a scene (a cell grows on a huge scene): its bits stay small. */
export const MAX_EXPLORE_CELLS = 1_000_000;
/** At most this many cells in one message. */
export const MAX_EXPLORE_BATCH = 50_000;

export interface ExploreGrid {
  /** The area's top-left corner, in scene units. */
  x0: number;
  y0: number;
  /** A cell's side, in scene units. */
  cell: number;
  cols: number;
  rows: number;
  /** Stands for all of the above: kept bits are only used with the same key. */
  key: string;
}

export function exploreGrid(scene: Pick<Scene, "width" | "height" | "grid" | "bounds">): ExploreGrid {
  const area = sceneBounds(scene);
  const w = area.x1 - area.x0, h = area.y1 - area.y0;
  let cell = Math.max(1, scene.grid.size / 2);
  if ((w / cell) * (h / cell) > MAX_EXPLORE_CELLS) cell = Math.sqrt((w * h) / MAX_EXPLORE_CELLS) * 1.01;
  const cols = Math.max(1, Math.ceil(w / cell)), rows = Math.max(1, Math.ceil(h / cell));
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x0: area.x0, y0: area.y0, cell, cols, rows, key: `${cols}x${rows}@${r(area.x0)},${r(area.y0)}/${r(cell)}` };
}

/** How many cells a key's grid has (0 if it isn't one). */
export function keyCells(key: string): number {
  const m = /^(\d+)x(\d+)@/.exec(key);
  const n = m ? Number(m[1]) * Number(m[2]) : 0;
  return n > 0 && n <= MAX_EXPLORE_CELLS * 1.05 ? n : 0;
}

/** Bits enough for `cells` cells, all unexplored. */
export function emptyBits(cells: number): Uint8Array {
  return new Uint8Array(Math.ceil(cells / 8));
}

export function hasCell(bits: Uint8Array, i: number): boolean {
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}

/** Marks the cells explored; returns the ones that weren't (each once, in range, whole numbers). */
export function addCells(bits: Uint8Array, cells: readonly unknown[], total: number): number[] {
  const fresh: number[] = [];
  for (const c of cells) {
    if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= total || c >= bits.length * 8) continue;
    if (hasCell(bits, c)) continue;
    bits[c >> 3] |= 1 << (c & 7);
    fresh.push(c);
  }
  return fresh;
}

/** Bits as text (base64), to keep and to send. */
export function bitsToText(bits: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bits.length; i += 0x8000) s += String.fromCharCode(...bits.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Text from bitsToText as bits for `cells` cells (padded or cut to fit); empty if it isn't base64. */
export function textToBits(text: string, cells: number): Uint8Array {
  const out = emptyBits(cells);
  try {
    const s = atob(text);
    for (let i = 0; i < Math.min(s.length, out.length); i++) out[i] = s.charCodeAt(i);
  } catch {
    // Not base64: nothing explored.
  }
  return out;
}

/** What a browser keeps of a scene's explored cells. */
export interface Explored {
  key: string;
  bits: Uint8Array;
}

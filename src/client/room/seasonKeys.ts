// The little the page needs from the season code before any season is made: the versions and the
// seed that go into a bake's key, and whether an attached map is snowy. The season code itself
// (seasonPixels.ts, seasonExact.ts) runs in the season worker, and on a page without one is loaded
// the first time it's needed (seasons.ts), so it isn't part of every page.

import type { SidecarMeta } from "../dd/sidecar";

/** Goes up with every change to how pictures are analysed or baked; part of every bake's key. */
export const ALGO_VERSION = 4;

/** Goes up with every role table or kernel change for exact scenes; part of their bake keys. */
export const EXACT_VERSION = 1;

/** Snowy when snow is at least this share of the visible open soft ground (4.2). */
export const SNOWY_SHARE = 0.5;

/** A scene's own number for its season's randomness, from its id (0 to 65535). */
export function seedFrom(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return ((h >>> 16) ^ h) & 0xffff;
}

/** Whether an attached map is snowy: the GM's "drawn in", else META.snowShare (4.2). */
export function isSnowy(meta: SidecarMeta, drawn?: "winter" | "green"): boolean {
  return drawn ? drawn === "winter" : meta.snowShare >= SNOWY_SHARE;
}

// Copied from Dungeon (src/render/scatter.ts) by scripts/sync-dungeon-library.mjs, Dungeon 9bae40f. Change it there and run the script again.
// The scatter brush: objects painted at random under a circle, for forests on the fly. Shared
// by Dungeon's Object tool and Table's Build tool (Table copies this file with the rest of the
// library), so the two scatter alike. Each dab tries random spots in the circle and keeps those
// far enough from what already stands there, so going over the same ground again only fills
// the gaps. Distances are in squares. No drawing here, and nothing imported.

export type ScatterDensity = "sparse" | "medium" | "dense";

/** The brush's sizes: how many squares across its circle is. */
export const SCATTER_BRUSHES = [2, 4, 6, 8, 12] as const;

export const SCATTER_DENSITY_LABELS: Record<ScatterDensity, string> = { sparse: "Sparse", medium: "Medium", dense: "Dense" };

/**
 * How close two things of the same layer may stand, as a share of the sum of their half
 * sizes: sparse leaves gaps, medium lets them touch a little, dense overlaps (treetops crowding).
 */
export const SCATTER_SPACING: Record<ScatterDensity, number> = { sparse: 1.1, medium: 0.75, dense: 0.45 };

/** Each thing is up to this much bigger or smaller than it would be by hand. */
export const SCATTER_SIZE_SPREAD = 0.2;

/** The most spots one dab tries. */
const MAX_TRIES = 150;

/** How much further than the brush to look for things a new one could be too close to. */
const REACH = 6;

/** Something standing on the map, as the brush keeps its distance: its middle, half its size, its layer. */
export interface ScatterSpot {
  x: number;
  y: number;
  r: number;
  layer: string | number;
}

export interface ScatterDabOptions<T> {
  /** The middle of the brush. */
  x: number;
  y: number;
  /** How many squares across the brush is. */
  brush: number;
  density: ScatterDensity;
  /**
   * One new thing with its middle at about (x, y): `turn` is a share of a full turn (0 to 1),
   * `grow` how much bigger or smaller (1 give or take SCATTER_SIZE_SPREAD), `rand` for picking
   * which. Returns it and where it really stands, or null if it can't go there (off the map).
   */
  make: (x: number, y: number, turn: number, grow: number, rand: () => number) => { item: T; spot: ScatterSpot } | null;
  /** What already stands with its middle within r squares of (x, y). */
  near: (x: number, y: number, r: number) => ScatterSpot[];
  /** Math.random, or a stand-in for tests. */
  rand?: () => number;
}

/** One dab of the brush: the things to add, in the order to add them. */
export function scatterDab<T>(d: ScatterDabOptions<T>): T[] {
  const rand = d.rand ?? Math.random;
  const k = SCATTER_SPACING[d.density];
  const radius = d.brush / 2;
  const around = d.near(d.x, d.y, radius + REACH);
  const kept: ScatterSpot[] = [];
  const out: T[] = [];
  const tries = Math.min(MAX_TRIES, Math.max(6, Math.ceil(Math.PI * radius * radius * 1.2)));
  for (let t = 0; t < tries; t++) {
    // A spot evenly spread over the circle.
    const a = rand() * 2 * Math.PI;
    const r = radius * Math.sqrt(rand());
    const made = d.make(d.x + r * Math.cos(a), d.y + r * Math.sin(a), rand(), 1 + (rand() * 2 - 1) * SCATTER_SIZE_SPREAD, rand);
    if (!made) continue;
    const s = made.spot;
    // Only things in the same layer keep apart: treetops spread over flowers, bushes fit under trees.
    const crowded = (q: ScatterSpot) => q.layer === s.layer && Math.hypot(q.x - s.x, q.y - s.y) < k * (s.r + q.r);
    if (around.some(crowded) || kept.some(crowded)) continue;
    kept.push(s);
    out.push(made.item);
  }
  return out;
}

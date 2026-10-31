// Build › Objects › Scatter: a brush that paints objects at random, for forests on the fly.
// Each dab tries random spots in a circle round the pointer and keeps those far enough from
// the objects already there, so going over the same ground again fills it up to the density
// chosen and no further. Objects go anywhere (to a sixteenth of a square), each turned at
// random and a little bigger or smaller than its own size. No drawing here, so it can be tested.

import { naturalStampSize, snapDeg, snapPos, snapSize, stampBlock, stampLayer } from "../../shared/terrain";
import type { CellBounds, StampId } from "../../shared/terrain";
import { blockOf, centreOf } from "./stampGeom";
import type { Placed } from "./stampGeom";

export type ScatterDensity = "sparse" | "medium" | "dense";

/** The brush's sizes: how many squares across its circle is. */
export const SCATTER_BRUSHES = [2, 4, 6, 8, 12] as const;

export const SCATTER_DENSITY_LABELS: Record<ScatterDensity, string> = { sparse: "Sparse", medium: "Medium", dense: "Dense" };

/**
 * How close two objects of the same layer may stand, as a share of the sum of their half
 * sizes: sparse leaves gaps, medium lets them touch a little, dense overlaps (treetops crowding).
 */
export const SCATTER_SPACING: Record<ScatterDensity, number> = { sparse: 1.1, medium: 0.75, dense: 0.45 };

/** Each object is up to this much bigger or smaller than its own size. */
export const SCATTER_SIZE_SPREAD = 0.2;

/** The most spots one dab tries. */
const MAX_TRIES = 150;

export interface ScatterSpec {
  /** What to scatter: one object, or a group of them mixed. */
  ids: readonly StampId[];
  /** The circle's size in squares across. */
  brush: number;
  density: ScatterDensity;
}

/**
 * One dab of the brush, centred on (u, v) in cells: the objects to add, in the order to add
 * them. near(u, v, r) gives the objects already there whose middles are within r cells;
 * inside says whether an object's squares are all on the scene; rand is Math.random or a
 * stand-in for tests.
 */
export function scatterDab(
  spec: ScatterSpec,
  u: number,
  v: number,
  near: (u: number, v: number, r: number) => Placed[],
  inside: (b: CellBounds) => boolean,
  rand: () => number = Math.random,
): Placed[] {
  if (!spec.ids.length) return [];
  const k = SCATTER_SPACING[spec.density];
  const radius = spec.brush / 2;
  // Everything a new object could be too close to: the biggest object is 3 squares.
  const around = near(u, v, radius + 3);
  const added: Placed[] = [];
  const tries = Math.min(MAX_TRIES, Math.max(6, Math.ceil(Math.PI * radius * radius * 1.2)));
  for (let t = 0; t < tries; t++) {
    // A spot evenly spread over the circle.
    const a = rand() * 2 * Math.PI;
    const d = radius * Math.sqrt(rand());
    const x = u + d * Math.cos(a);
    const y = v + d * Math.sin(a);
    const id = spec.ids[Math.min(spec.ids.length - 1, Math.floor(rand() * spec.ids.length))];
    const size = snapSize(naturalStampSize(id) * (1 + (rand() * 2 - 1) * SCATTER_SIZE_SPREAD));
    const n = stampBlock(size);
    const p: Placed = { id, col: snapPos(x - n / 2), row: snapPos(y - n / 2), deg: snapDeg(rand() * 360), size };
    if (!inside(blockOf(p))) continue;
    const m = centreOf(p);
    const layer = stampLayer(id);
    const crowded = (q: Placed) => {
      if (stampLayer(q.id) !== layer) return false;
      const c = centreOf(q);
      return Math.hypot(c.x - m.x, c.y - m.y) < k * (p.size / 2 + q.size / 2);
    };
    if (around.some(crowded) || added.some(crowded)) continue;
    added.push(p);
  }
  return added;
}

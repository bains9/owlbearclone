// Build › Objects › Scatter, in the Build tool's own terms. The brush itself is Dungeon's
// (dungeonLib/scatter.ts, copied from Dungeon), so the two scatter alike; here it places Build
// objects: anywhere to a sixteenth of a square, turned to 5 degrees, sized to a quarter square
// round each object's own size. No drawing here, so it can be tested.

import { naturalStampSize, snapDeg, snapPos, snapSize, stampBlock, stampLayer } from "../../shared/terrain";
import type { CellBounds, StampId } from "../../shared/terrain";
import { scatterDab as dab, type ScatterDensity, type ScatterSpot } from "../dungeonLib/scatter";
import { blockOf, centreOf } from "./stampGeom";
import type { Placed } from "./stampGeom";

export { SCATTER_BRUSHES, SCATTER_DENSITY_LABELS, SCATTER_SIZE_SPREAD, SCATTER_SPACING } from "../dungeonLib/scatter";
export type { ScatterDensity } from "../dungeonLib/scatter";

export interface ScatterSpec {
  /** What to scatter: one object, or a group of them mixed. */
  ids: readonly StampId[];
  /** The circle's size in squares across. */
  brush: number;
  density: ScatterDensity;
}

/** An object as the brush keeps its distance: the middle of its squares, half its size, its layer. */
function spotOf(p: Placed): ScatterSpot {
  return { ...centreOf(p), r: p.size / 2, layer: stampLayer(p.id) };
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
  const { ids } = spec;
  if (!ids.length) return [];
  return dab<Placed>({
    x: u,
    y: v,
    brush: spec.brush,
    density: spec.density,
    rand,
    near: (x, y, r) => near(x, y, r).map(spotOf),
    make: (x, y, turn, grow, pick) => {
      const id = ids[Math.min(ids.length - 1, Math.floor(pick() * ids.length))];
      const size = snapSize(naturalStampSize(id) * grow);
      const n = stampBlock(size);
      const p: Placed = { id, col: snapPos(x - n / 2), row: snapPos(y - n / 2), deg: snapDeg(turn * 360), size };
      return inside(blockOf(p)) ? { item: p, spot: spotOf(p) } : null;
    },
  });
}

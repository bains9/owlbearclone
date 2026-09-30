// Does the data line up with the picture? The object-centre fit (design 2.4): a picture shows its
// objects where they are, so the luminance spread at the objects' centres peaks at the right
// placement. Used by extract, by rankLevels and by the dd worker's "check" message.

import type { FitResult, PictureRect, PictureSample } from "./extract";

/** The fit's numbers (design 2.4). */
export const FIT = {
  /** The picture is scored at this many px a square. */
  pxPerSquare: 24,
  /** The box at each centre has side 2 * round(box * pxPerSquare) + 1 px. */
  box: 0.3,
  /** Fewer default objects inside the picture: "unsure". */
  minObjects: 8,
  /** Shifts tried: a grid of step squares within range squares, at least minShift from 0. */
  step: 0.5,
  range: 3,
  minShift: 1,
  /** yes: s0 >= best and sharp(0) <= yesSharp. */
  yesSharp: 0.95,
  /** no: s0 < noLead * best, or best >= noBest * s0 with sharp(best) <= noSharp. */
  noLead: 0.85,
  noBest: 1.1,
  noSharp: 0.92,
} as const;

/** `centres`: the default objects' world x, y, interleaved (packs left out). */
export function objectFit(centres: Float64Array, rect: PictureRect, pic: PictureSample): FitResult {
  throw new Error("not implemented: objectFit");
}

// Compiling one level of a parsed Dungeondraft map into a season sidecar, lined up with the
// picture the scene uses (design 2.2 to 2.7). Pure (no DOM): it runs in the GM's dd worker.
//
// It covers the picture's rectangle (2.3), ranking the levels (2.2), cropping to the rectangle
// plus one square, the transforms to world shapes, patterns and wall loops, drawn path widths,
// water bodies by what the picture shows (2.6), the pack share, and the measured footprints
// (measure.ts). Nothing it stores names a pack, a structure, a level or the source file.

import type { DDMap } from "./model";
import type { SpriteSizes } from "./measure";
import type { SeasonSidecar } from "./sidecar";

/** Bumped with every geometry change; stored in each sidecar (roles are re-derived at run time instead). */
export const EXTRACTOR_VERSION = 1;

/** Most portal, light and line-of-sight points a VttMeta keeps, in all. */
export const VTT_META_POINTS = 20_000;

/**
 * What a .dd2vtt says about where its picture lies and which level it shows, kept by
 * parseUniversalVtt (mapImport.ts). The fields keep the file's own names and shapes, so
 * `resolution` goes to alignDd2vtt and the whole object to matchDd2vttLevel as they are.
 * Positions are in squares; at most VTT_META_POINTS points in all.
 */
export interface VttMeta {
  resolution: {
    map_origin: { x: number; y: number };
    map_size: { x: number; y: number };
    pixels_per_grid: number;
  };
  portals: Array<{ position: { x: number; y: number } }>;
  lights: Array<{ position: { x: number; y: number } }>;
  line_of_sight: Array<Array<{ x: number; y: number }>>;
}

/** The picture's rectangle in world units, [x0, y0, x1, y1] (pixel centres as in raster.ts). */
export interface PictureRect {
  rect: [number, number, number, number];
}

/** The picture's pixels, at 24-32 px a square and at most 2048 px (4096 on big desktops) on the long side. */
export interface PictureSample {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
}

/** The object-centre fit (fit.ts, design 2.4). */
export interface FitResult {
  verdict: "yes" | "unsure" | "no";
  /** score(0, 0) over the best shifted score. */
  lead: number;
  /** sharp(0, 0): the mean of the four half-square neighbours' scores over score(0, 0). */
  sharp: number;
  /** The best shift, in squares. */
  best: [number, number];
  /** On "no" with a whole-square best: the shift that lines it up, in squares. */
  shiftSq?: [number, number];
  /** Default objects whose centres lie inside the picture. */
  objects: number;
}

/** One level, ranked for the picture (2.2). */
export interface LevelRank {
  /** level.key (labels can repeat). */
  key: string;
  label: string;
  terrainOn: boolean;
  /** matchDd2vttLevel's score, when a .dd2vtt was given. */
  vttScore?: number;
  fit?: FitResult;
  /** Why it is where it is: the export's doors and lights, the only level with ground, the objects' fit, open when saved, the only level. */
  why: "vtt" | "ground" | "objects" | "current" | "only";
}

/** What the attach dialog and the import report show. Only the GM sees it; none of it is uploaded. */
export interface AttachReport {
  levels: LevelRank[];
  /** The chosen level's key. */
  level: string;
  fit: FitResult;
  /** The whole-square shift applied to line it up, in squares. */
  shifted?: [number, number];
  /** Attach on hold: it didn't line up, or the level was unclear. */
  hold: null | "fit" | "level";
  /** Picture pixels a square, from the data (the scene's grid can be set from it). */
  gridPxPerSquare: number;
  snowShare: number;
  drawn: "winter" | "green";
  packItems: number;
  packPaths: number;
  packShare: number;
  /** Pack names, shown to the GM, never stored. */
  packNames: string[];
  dropped: number;
  objects: number;
  /** Each water body, by what the picture shows (2.6). */
  water: Array<"WATER" | "ICE" | "KEEP">;
  /** The picture is below 16 px a square: bare trees keep their priors. */
  lowRes: boolean;
  warnings: string[];
}

/**
 * The picture's rectangle (2.3): from the .dd2vtt (or the scene's mapRect, in squares), else
 * the whole map for a plain export. An error when the hard checks fail (aspect, overlap).
 */
export function pictureRect(map: DDMap, picW: number, picH: number, vtt?: VttMeta,
  mapRect?: [number, number, number, number]): PictureRect | { error: string } {
  throw new Error("not implemented: pictureRect");
}

/** The levels, best first (2.2). */
export function rankLevels(map: DDMap, pic: PictureSample, rect: PictureRect, vtt?: VttMeta): LevelRank[] {
  throw new Error("not implemented: rankLevels");
}

/** Compiles one level (by level.key). Throws when the map is over a SIDECAR_CAPS limit. */
export function extractSidecar(map: DDMap, levelKey: string, rect: PictureRect, pic: PictureSample,
  sizes: SpriteSizes): { sidecar: SeasonSidecar; report: AttachReport } {
  throw new Error("not implemented: extractSidecar");
}

/** The dialog's preview (2.7): the picture at `size` px on its long side with the sidecar's layers over it, via rasterSidecar. */
export function previewOverlay(sc: SeasonSidecar, pic: PictureSample, size: number): Uint8ClampedArray {
  throw new Error("not implemented: previewOverlay");
}

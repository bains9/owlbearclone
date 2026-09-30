// Seasons from exact Dungeondraft data (design 5.4): the sidecar is rasterised at analysis size
// (rasterSidecar) and turned into the same structures analyse() finds in a picture, so the
// existing kernels bake it. Pure; never writes into the picture's pixels, so the fallback
// analyse() sees them unchanged.

import type { SidecarLayers } from "../dd/raster";
import type { SeasonSidecar, SidecarMeta } from "../dd/sidecar";
import type { SeasonAnalysis } from "./seasonPixels";

/** Goes up with every role table or kernel change for exact scenes; part of their bake keys. */
export const EXACT_VERSION = 1;

/** Snowy when snow is at least this share of the visible open soft ground (4.2). */
export const SNOWY_SHARE = 0.5;

/** Whether an attached map is snowy: the GM's "drawn in", else META.snowShare (4.2). */
export function isSnowy(meta: SidecarMeta, drawn?: "winter" | "green"): boolean {
  return drawn ? drawn === "winter" : meta.snowShare >= SNOWY_SHARE;
}

/** The derived masks at analysis size (aw x ah), 0..255 a pixel. */
export interface ExactLayers {
  aw: number;
  ah: number;
  layers: SidecarLayers;
  /** Visible terrain + PATH_* + PAVED + WATER + ICE, not under FLOOR, CAVE, ROOF or WALL. */
  outdoor: Uint8Array;
  /** FLOOR + CAVE. */
  indoor: Uint8Array;
  /**
   * Left as drawn: KEEP, PATH_KEEP, CAVE_RIM, WALL, pack roofs, and objects of the roles OPAQUE,
   * STRUCTURE, EFFECT, WATER_FX, LITTER, MUSHROOM, ICE and FIRE. With packs "guess", OPAQUE
   * footprints are left out (the pixel analysis treats what it finds there).
   */
  keep: Uint8Array;
  /** Distance inside WATER to its edge, in 1/16 square. */
  shore: Uint8Array;
  /** Visible snow's share of the open soft ground, measured at this size. */
  snowShare: number;
}

export function exactLayers(sc: SeasonSidecar, aw: number, ah: number, opts?: { packs?: "guess" }): ExactLayers {
  throw new Error("not implemented: exactLayers");
}

/**
 * analyse() for a scene with Dungeondraft data. v1: snowy maps only; it throws on a green one,
 * and the caller falls back to analyse(). Never writes into rgba.
 * packs "guess": the pixel snowAnalysis runs too, and its trees and caps are kept only where their
 * centres lie in OPAQUE footprints (design 1.2 (b)); pack files are never opened.
 */
export function analyseExact(rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number, sc: SeasonSidecar,
  opts: { bare?: "leaf" | "dead"; drawn?: "winter" | "green"; packs?: "guess" }): SeasonAnalysis {
  throw new Error("not implemented: analyseExact");
}

// The one shared rasteriser of a season sidecar (design 5.3). The attach preview, the Compare
// bakes, the fit check and every device's runtime all call rasterSidecar, so the GM approves
// exactly what bakes. (ddRaster.ts rasterises the raw parsed map instead, at attach time only.)
//
// Contract (M0):
// - Pixel centres (2.3). Pixel (px, py) of a w x h raster has its centre at world
//   (x0 + (px + 0.5)*(x1 - x0)/w, y0 + (py + 0.5)*(y1 - y0)/h), with [x0, y0, x1, y1] = meta.rect.
// - Terrain. Slot planes are sampled bilinearly between texel centres (clamped at the crop's
//   edge), then summed per runtime role (terrainRole(name) when the slot's stored name gives one,
//   else the stored role).
// - Draw order. Everything else is composited painter-style: by layer, then bitmaps before shapes
//   before objects at an equal layer, then table order. A drawable with coverage c attenuates
//   everything below it by 1 - c and adds c to its own role. Terrain lies under everything.
// - Coverage. Shapes: scanline fill with the stored rule, exact horizontal coverage and 4x vertical
//   supersampling. Bitmaps: bilinear between the 0/1 samples, cut at 0.5 with a 1-pixel ramp.
//   Objects: the 16-gon through reach[k] * REACH_DIRS[k] around the centre, soft over 1 pixel.
// - Object roles are re-derived like terrain: objectRole(name) when the stored name gives a
//   NAMED_ROLES role, else the stored role.
// - Arithmetic: only + - * /, sqrt, floor, round, min and max, so every device gets the same bytes.

import type { AreaRole, ObjectRole, TerrainRole } from "./roles";
import type { SeasonSidecar } from "./sidecar";

/**
 * Unit vectors (x right, y down) of the 16 reach samples, x and y interleaved (design 2.9). Sample
 * k lies along the direction whose diamond() position (seasonPixels.ts) is k + 0.5, the centre of
 * the sector [k, k+1) the pixel path bins into: with p = ((k & 3) + 0.5)/4, the direction of
 * (1-p, p) for k 0-3, (-p, 1-p) for 4-7, (p-1, -p) for 8-11 and (p, p-1) for 12-15, so k runs
 * clockwise on screen from just below +x. Used by the extractor's measurement, rasterSidecar's
 * 16-gons and the exact path of treeIndex (which interpolates at pos - 0.5).
 */
export const REACH_DIRS: Float64Array = reachDirs();

function reachDirs(): Float64Array {
  const out = new Float64Array(32);
  for (let k = 0; k < 16; k++) {
    const p = ((k & 3) + 0.5) / 4;
    const q = k >> 2;
    const x = q === 0 ? 1 - p : q === 1 ? -p : q === 2 ? p - 1 : p;
    const y = q === 0 ? p : q === 1 ? 1 - p : q === 2 ? -p : p - 1;
    const len = Math.sqrt(x * x + y * y);
    out[k * 2] = x / len;
    out[k * 2 + 1] = y / len;
  }
  return out;
}

/** The raster: meta.rect mapped onto w x h, pixel centres at +0.5 (see above). */
export interface RasterSpec {
  w: number;
  h: number;
}

export interface SidecarLayers {
  w: number;
  h: number;
  /** Visible weight per terrain role, 0..255 (runtime roles, from stored names where they give one). */
  terrain: Map<TerrainRole, Uint8Array>;
  /** Visible coverage per area role, 0..255. */
  area: Map<AreaRole, Uint8Array>;
  /** Visible coverage per object role, 0..255 (only roles present). */
  objects: Map<ObjectRole, Uint8Array>;
  /** Top-most visible object's index + 1 per pixel where its coverage is at least 50% (0: none). */
  top: Uint16Array;
}

/**
 * Rasterises a sidecar that decodeSidecar accepted. Throws only on a bad spec (w, h not positive
 * integers, or too many pixels). The capped worst case must take under 150 ms at 1024 px.
 */
export function rasterSidecar(sc: SeasonSidecar, spec: RasterSpec): SidecarLayers {
  throw new Error("not implemented: rasterSidecar");
}

// Measuring object footprints, presence and snow caps from the picture, at attach time on the GM's
// device (design 2.5). Dungeondraft stores an object's centre, rotation, scale and mirror flag but
// not its sprite's size, so each footprint starts from a prior (SPRITE_SIZES, else ROLE_RADIUS)
// and is measured from the picture's pixels; the result is stored in the sidecar, so every device
// uses the same geometry.

import type { Level } from "./model";
import { GRID } from "./model";
import { OR, type ObjectRole } from "./roles";
import { REACH_DIRS } from "./raster";
import type { PictureRect, PictureSample } from "./extract";

/**
 * Sprite reach profiles by default short name: r (world units at scale 1) and 16 reaches in the
 * sprite's own frame (REACH_DIRS order, world units at scale 1, before mirror and rotation).
 */
export type SpriteSizes = Readonly<Record<string, { r: number; reach: number[] }>>;

/**
 * A role's prior radius in world units at scale 1, for names missing from SPRITE_SIZES. The
 * prototype's nominal radii (by the role's old object kind), except OPAQUE: a pack item's
 * generous 1.5-square disc (2.5 item 7), so its measured reach (clamped to 0.4-1.3 x the prior)
 * can cover a 2-square crown.
 */
export const ROLE_RADIUS: Readonly<Record<ObjectRole, number>> = Object.freeze({
  [OR.EVERGREEN]: 300,
  [OR.DECIDUOUS]: 400,
  [OR.SHRUB]: 140,
  [OR.FLOWER_SHRUB]: 140,
  [OR.BARE]: 300,
  [OR.GRASS]: 90,
  [OR.FLOWERS]: 80,
  [OR.REEDS]: 110,
  [OR.CROP]: 80,
  [OR.MUSHROOM]: 60,
  [OR.ROOTS]: 200,
  [OR.LITTER]: 80,
  [OR.DEADWOOD]: 200,
  [OR.STUMP]: 150,
  [OR.ROCK]: 130,
  [OR.SNOW]: 150,
  [OR.ICE]: 100,
  [OR.WATER_FX]: 250,
  [OR.EFFECT]: 200,
  [OR.FIRE]: 110,
  [OR.STRUCTURE]: 110,
  [OR.OPAQUE]: 1.5 * GRID,
});

/** The measurement's numbers (design 2.5), as shares of the prior unless said otherwise. */
export const MEASURE = {
  /** The local ground model's annulus. */
  annulusIn: 1.3,
  annulusOut: 1.8,
  /** "Object" when the RGB L1 distance to the annulus median exceeds max(minDist, madK * MAD). */
  minDist: 24,
  madK: 3,
  /** Measured reach is clamped to this range of the prior. */
  clampMin: 0.4,
  clampMax: 1.3,
  /** Gaps the reach may cross, in squares. */
  gapSquares: 0.1,
  /** The core, for presence (of the prior) and caps (of the measured reach). */
  core: 0.7,
  /** Present when at least this share of the core is "object". */
  presentCore: 0.25,
  /** Bare trees: present when at least this many of the 16 rays meet stroke pixels within the prior. */
  bareRays: 6,
  /** Bare trees: the quantile of warm stroke pixels a direction that sets its reach. */
  bareQuantile: 0.85,
  /** Capped when at least this share of the object pixels in the core is snow-coloured. */
  cappedShare: 0.35,
  /** Above this share of tested trees dropped, the fit is lowered to "unsure". */
  dropTrees: 0.1,
  /** A pack item whose measurement fails gets this disc, in squares x max(scale). */
  packDiscSquares: 1.5,
  /** Below this many picture pixels a square, bare trees keep their priors. */
  minPxPerSquare: 16,
} as const;

export interface Measured {
  /** 16 reaches in world units, REACH_DIRS order (world frame). */
  reach: Float32Array;
  /** Whether the picture shows it; null when not tested (low-contrast roles, covered objects, packs). */
  present: boolean | null;
  /** A crown-like object carrying a snow cap (2.5 item 6). */
  capped: boolean;
  /** Its own colour (median of its non-snow pixels), RGB 0..255; the prior's is 0, 0, 0. */
  own: [number, number, number];
  /** False: the reach is the prior. */
  measured: boolean;
}

/**
 * Measures level.objects (roles[i] is level.objects[i]'s role), one result each, in order.
 * `grid` describes a grid baked into the picture (its lines are masked), null when there is none.
 *
 * M1 stub (design 7.0): returns the priors, ROLE_RADIUS as an ellipse scaled by the object's
 * scale and turned by its rotation; nothing is tested, measured or capped. WP8 replaces it.
 */
export function measureObjects(level: Level, roles: readonly ObjectRole[], pic: PictureSample, rect: PictureRect,
  grid: { pxPerSquare: number; offsetX: number; offsetY: number } | null, sizes: SpriteSizes): Measured[] {
  return level.objects.map((o, i) => {
    const r = ROLE_RADIUS[roles[i]] ?? ROLE_RADIUS[OR.OPAQUE];
    const a = r * Math.abs(o.scale.x || 1), b = r * Math.abs(o.scale.y || 1);
    const c = Math.cos(o.rotation), s = Math.sin(o.rotation);
    const reach = new Float32Array(16);
    for (let k = 0; k < 16; k++) {
      // The direction in the sprite's frame (rotated back), then the ellipse's radius along it.
      const dx = REACH_DIRS[k * 2], dy = REACH_DIRS[k * 2 + 1];
      const ux = c * dx + s * dy, uy = -s * dx + c * dy;
      reach[k] = 1 / Math.sqrt((ux / a) * (ux / a) + (uy / b) * (uy / b));
    }
    return { reach, present: null, capped: false, own: [0, 0, 0], measured: false };
  });
}

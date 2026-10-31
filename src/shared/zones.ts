// Spell effects that stay on the map (the Spells tool's zones): a circle or a rectangle drawing
// carrying one of these looks (DrawingItem.fx). On its own, so the item checks can use it.

/**
 * Each look: which layer it's drawn in (ground: under tokens; air: over them), what it does to
 * the lighting (block: players can't see into or through it; dark: that, and lights in it go
 * out; light: a light), and whether it keeps moving while it lasts.
 */
export const ZONE_LOOKS = {
  fog: { layer: "air", sight: "block", moving: true },
  "poison-cloud": { layer: "air", sight: "block", moving: true },
  darkness: { layer: "air", sight: "dark", moving: false },
  light: { layer: "ground", sight: "light", moving: false },
  moonbeam: { layer: "ground", sight: "light", moving: true },
  vines: { layer: "ground", sight: null, moving: true },
  spikes: { layer: "ground", sight: null, moving: false },
  pit: { layer: "ground", sight: null, moving: false },
  water: { layer: "ground", sight: null, moving: true },
  hypnotic: { layer: "air", sight: null, moving: true },
  marked: { layer: "ground", sight: null, moving: false },
} as const satisfies Record<string, { layer: "ground" | "air"; sight: "block" | "dark" | "light" | null; moving: boolean }>;

export type ZoneLook = keyof typeof ZONE_LOOKS;

export function isZoneLook(v: unknown): v is ZoneLook {
  return typeof v === "string" && Object.hasOwn(ZONE_LOOKS, v);
}

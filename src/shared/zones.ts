// Spell effects that stay on the map (the Spells tool): a circle or a rectangle drawing carrying
// one of these looks (DrawingItem.fx). A zone's look is drawn where its drawing is; a token's
// look on the token its drawing names (DrawingItem.on), wherever that token goes. On its own,
// so the item checks can use it.

/**
 * Each zone look: which layer it's drawn in (ground: under tokens; air: over them), what it does
 * to the lighting (block: players can't see into or through it; dark: that, and lights in it go
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
  // Conjured things: a glowing weapon its caster moves round, a bridge, a path through plants.
  "spirit-weapon": { layer: "air", sight: null, moving: true },
  bridge: { layer: "ground", sight: null, moving: false },
  path: { layer: "ground", sight: null, moving: false },
} as const satisfies Record<string, { layer: "ground" | "air"; sight: "block" | "dark" | "light" | null; moving: boolean }>;

export type ZoneLook = keyof typeof ZONE_LOOKS;

export function isZoneLook(v: unknown): v is ZoneLook {
  return typeof v === "string" && Object.hasOwn(ZONE_LOOKS, v);
}

/**
 * Each look a spell gives a token while it lasts, and whether it keeps moving. Some change the
 * token itself: unseen (others don't see it), spectral (see-through), flying (lifted),
 * treeform (drawn as a tree).
 */
export const TOKEN_LOOKS = {
  outline: { moving: true },
  unseen: { moving: true },
  shell: { moving: false },
  weapon: { moving: true },
  "red-hot": { moving: true },
  held: { moving: false },
  slowed: { moving: false },
  flying: { moving: true },
  treeform: { moving: false },
  swarm: { moving: true },
  spectral: { moving: true },
} as const satisfies Record<string, { moving: boolean }>;

export type TokenLook = keyof typeof TOKEN_LOOKS;

export function isTokenLook(v: unknown): v is TokenLook {
  return typeof v === "string" && Object.hasOwn(TOKEN_LOOKS, v);
}

/** A drawing's spell look: a zone's, or a token's. */
export type SpellLook = ZoneLook | TokenLook;

/** Whether a look keeps moving (the board keeps drawing while one is on the map). */
export function spellLookMoves(look: SpellLook): boolean {
  return isZoneLook(look) ? ZONE_LOOKS[look].moving : TOKEN_LOOKS[look].moving;
}

/** Zone looks that came with spells on tokens (31 October 2026, protocol 7). */
const LATER_ZONES: ReadonlySet<SpellLook> = new Set<SpellLook>(["spirit-weapon", "bridge", "path"]);

/**
 * The oldest protocol version whose code can draw a look. Code from before 7 knows only the first
 * zones, and would stop drawing the map at a look it doesn't know.
 */
export function lookVersion(look: SpellLook): number {
  return isTokenLook(look) || LATER_ZONES.has(look) ? 7 : 1;
}

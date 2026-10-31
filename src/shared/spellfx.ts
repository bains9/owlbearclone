// Spell effects: the looks the Spells tool plays on the map, and the group's spells that use them,
// with their sizes from the character sheets' spell lists (metres). Shared, so the Room can
// check an effect before passing it on. The first set: the party's own one-off spells.

import type { Ephemeral } from "./protocol";
import { LIMITS } from "./sanitize";
import type { ZoneLook } from "./zones";

/** How a look is cast: where it's aimed from and to. */
export type FxCast =
  /** An area round a point: let go where it goes. */
  | "burst"
  /** A fan from the caster: press at the caster, let go towards where it goes. */
  | "cone"
  /** From the caster to a target: press at the caster, let go on the target. */
  | "bolt"
  /** From the sky onto a point. */
  | "strike"
  /** From one place to another (a teleport). */
  | "jump";

export const FX_LOOKS = {
  "frost-fan": { cast: "cone", ms: 1000 },
  "colour-spray": { cast: "cone", ms: 1000 },
  downpour: { cast: "burst", ms: 1600 },
  "earth-maw": { cast: "burst", ms: 1400 },
  "needle-burst": { cast: "burst", ms: 1000 },
  "force-darts": { cast: "bolt", ms: 1200 },
  orb: { cast: "bolt", ms: 1000 },
  "sky-lightning": { cast: "strike", ms: 900 },
  "holy-bolt": { cast: "bolt", ms: 1000 },
  ray: { cast: "bolt", ms: 1100 },
  sparkle: { cast: "burst", ms: 1300 },
  teleport: { cast: "jump", ms: 1300 },
} as const satisfies Record<string, { cast: FxCast; ms: number }>;

export type FxLook = keyof typeof FX_LOOKS;

export function isFxLook(v: unknown): v is FxLook {
  return typeof v === "string" && Object.hasOwn(FX_LOOKS, v);
}

/** A spell as the Spells tool casts it. */
export interface SpellFx {
  /** As the character sheets name it. */
  name: string;
  look: FxLook;
  /** Metres: a burst's radius, a cone's length. Bolts and jumps go as far as they're aimed. */
  size?: number;
  /** A cone's width, in degrees. */
  spread?: number;
  /** The look's colour, for looks that take one. */
  color?: string;
}

/**
 * The party's one-off spells, by what they look like. Sizes are the sheets' areas: Frost Hands'
 * "120-degree arc" of 2 m, Cloudburst's 10 m diameter, Earthmaw's 5 m, Call lightning's 3 m radius.
 */
export const SPELL_FX: SpellFx[] = [
  { name: "Frost Hands", look: "frost-fan", size: 2, spread: 120 },
  { name: "Colour Spray", look: "colour-spray", size: 7, spread: 50 },
  { name: "Cloudburst", look: "downpour", size: 5 },
  { name: "Earthmaw", look: "earth-maw", size: 2.5 },
  { name: "Needlestorm", look: "needle-burst", size: 4.5, color: "#9ccf6a" },
  { name: "Splinter Wood", look: "needle-burst", size: 3, color: "#c79a5a" },
  { name: "Magic Missile", look: "force-darts", color: "#c08bff" },
  { name: "Chromatic Orb", look: "orb", color: "#ff5ad0" },
  { name: "Ball Lightning", look: "orb", color: "#9fd0ff" },
  { name: "Call lightning", look: "sky-lightning", size: 3 },
  { name: "Divine bolt", look: "holy-bolt", color: "#ffd65a" },
  { name: "Paralysis Bolt", look: "ray", color: "#9f7bff" },
  { name: "Bless", look: "sparkle", size: 3, color: "#ffe68a" },
  { name: "Cure wounds", look: "sparkle", size: 1, color: "#8fffb0" },
  { name: "Portal I", look: "teleport", color: "#c9b8ff" },
  { name: "Misty Step", look: "teleport", color: "#dfe6ee" },
];

export function spellFx(name: string): SpellFx | undefined {
  return SPELL_FX.find((s) => s.name === name);
}

/** The Spells tool's groups for spells that go off once, as its picker shows them (zones come after). */
export const FX_GROUPS: { name: string; casts: FxCast[] }[] = [
  { name: "Bursts", casts: ["burst", "cone", "strike"] },
  { name: "Bolts and rays", casts: ["bolt"] },
  { name: "Comings and goings", casts: ["jump"] },
];

/** A spell that stays on the map as a zone. */
export interface ZoneSpell {
  name: string;
  look: ZoneLook;
  /** A circle (a click places it, a drag sets its radius) or a rectangle (a drag goes corner to corner). */
  shape: "circle" | "square";
  /** Metres: a circle's radius, or a square's side, as the spell list has it at its lowest level. */
  size: number;
}

/**
 * The party's spells that stay on the map, and a few like them. Sizes from the character sheets
 * at the lowest spell level: Fog Cloud "8m*SL sphere" (8 m across), Wall of Fog "6*SL+7m cube",
 * Spike Growth "7-m-radius sphere", Pit "7m pit"; a drag makes any of them bigger or smaller.
 */
export const ZONE_SPELLS: ZoneSpell[] = [
  { name: "Fog Cloud", look: "fog", shape: "circle", size: 4 },
  { name: "Wall of Fog", look: "fog", shape: "square", size: 13 },
  { name: "Stinking Cloud", look: "poison-cloud", shape: "square", size: 7 },
  { name: "Acid Cloud", look: "poison-cloud", shape: "circle", size: 10 },
  { name: "Darkness", look: "darkness", shape: "circle", size: 5 },
  { name: "Blackness", look: "darkness", shape: "circle", size: 7 },
  { name: "Light", look: "light", shape: "circle", size: 5 },
  { name: "Lasting flame", look: "light", shape: "circle", size: 4 },
  { name: "Continual Light", look: "light", shape: "circle", size: 5 },
  { name: "Daylight", look: "light", shape: "circle", size: 20 },
  { name: "Moonbeam", look: "moonbeam", shape: "circle", size: 2 },
  { name: "Entangle", look: "vines", shape: "square", size: 8 },
  { name: "Plant Growth", look: "vines", shape: "circle", size: 6 },
  { name: "Briartangle", look: "vines", shape: "circle", size: 6 },
  { name: "Spike Growth", look: "spikes", shape: "circle", size: 7 },
  { name: "Pit", look: "pit", shape: "square", size: 7 },
  { name: "Wall of Water", look: "water", shape: "square", size: 6 },
  { name: "Create Spring", look: "water", shape: "circle", size: 1.5 },
  { name: "Hypnotic Pattern", look: "hypnotic", shape: "circle", size: 5 },
  { name: "Silence", look: "marked", shape: "circle", size: 5 },
  { name: "Battle Song", look: "marked", shape: "circle", size: 10 },
  { name: "Zone of Truth", look: "marked", shape: "circle", size: 5 },
  { name: "Prayer", look: "marked", shape: "circle", size: 20 },
  { name: "Hallucinatory Forest", look: "marked", shape: "square", size: 8 },
];

export function zoneSpell(name: string): ZoneSpell | undefined {
  return ZONE_SPELLS.find((s) => s.name === name);
}

/** A colour the Room passes on: #rrggbb. */
export const FX_COLOR = /^#[0-9a-f]{6}$/i;

type FxEvent = Extract<Ephemeral, { k: "fx" }>;

/** A spell effect as the Room passes it on, or null when it isn't one (a look it doesn't know, points off any map). */
export function cleanFx(raw: unknown): FxEvent | null {
  const e = raw as Partial<FxEvent> | null;
  if (!e || typeof e !== "object" || typeof e.sceneId !== "string" || !isFxLook(e.look)) return null;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LIMITS.coord;
  const point = (p: unknown): [number, number] | null =>
    Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) ? [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] : null;
  const a = point(e.a);
  const b = point(e.b);
  if (!a || !b || !finite(e.r) || e.r < 0 || !Number.isInteger(e.seed)) return null;
  return {
    k: "fx",
    sceneId: e.sceneId,
    look: e.look,
    a,
    b,
    r: Math.round(e.r * 100) / 100,
    ...(finite(e.spread) && e.spread > 0 && e.spread <= 360 ? { spread: e.spread } : {}),
    ...(typeof e.color === "string" && FX_COLOR.test(e.color) ? { color: e.color } : {}),
    seed: (e.seed as number) >>> 0,
  };
}

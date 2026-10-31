// Spell effects: the looks the Spells tool plays on the map, and the group's spells that use them,
// with their sizes from the character sheets' spell lists (metres). Shared, so the Room can
// check an effect before passing it on. The first set: the party's own one-off spells.

import type { Ephemeral } from "./protocol";
import { LIMITS } from "./sanitize";

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

/** The Spells tool's groups, as its picker shows them. */
export const FX_GROUPS: { name: string; casts: FxCast[] }[] = [
  { name: "Bursts", casts: ["burst", "cone", "strike"] },
  { name: "Bolts and rays", casts: ["bolt"] },
  { name: "Comings and goings", casts: ["jump"] },
];

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

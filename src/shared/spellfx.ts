// Spell effects: the looks the Spells tool plays on the map, and the group's spells that use them,
// with their sizes from the character sheets' spell lists (metres). Shared, so the Room can
// check an effect before passing it on. Every look in the approval doc, and its spells.

import type { Character, CharacterSpell } from "./characters";
import type { Ephemeral } from "./protocol";
import { LIMITS } from "./sanitize";
import type { TokenLook, ZoneLook } from "./zones";

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
  // The rest of the doc's looks (31 October 2026, protocol 8).
  "fire-burst": { cast: "burst", ms: 1300 },
  "flame-fan": { cast: "cone", ms: 1000 },
  "cold-burst": { cast: "burst", ms: 1400 },
  "falling-stones": { cast: "burst", ms: 1700 },
  thunderclap: { cast: "burst", ms: 1100 },
  "holy-flash": { cast: "burst", ms: 1000 },
  lightning: { cast: "bolt", ms: 900 },
  "fire-bolt": { cast: "bolt", ms: 1100 },
  "ice-shard": { cast: "bolt", ms: 1100 },
  "acid-arrow": { cast: "bolt", ms: 2600 },
} as const satisfies Record<string, { cast: FxCast; ms: number }>;

export type FxLook = keyof typeof FX_LOOKS;

export function isFxLook(v: unknown): v is FxLook {
  return typeof v === "string" && Object.hasOwn(FX_LOOKS, v);
}

/** The first looks, which every page that plays effects knows. */
const FIRST_FX: ReadonlySet<FxLook> = new Set<FxLook>(["frost-fan", "colour-spray", "downpour", "earth-maw", "needle-burst", "force-darts", "orb", "sky-lightning", "holy-bolt", "ray", "sparkle", "teleport"]);

/**
 * The oldest protocol version whose code can play a look. Older code can't draw one it doesn't
 * know (it would stop drawing the map's top layer), so the Room doesn't send it one.
 */
export function fxVersion(look: FxLook): number {
  return FIRST_FX.has(look) ? 1 : 8;
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
  /** Metres its size grows for each level it's cast above its own (Fireball's "SL+1 m"). */
  perLevel?: number;
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
  { name: "Teleport Object", look: "teleport", color: "#c9b8ff" },
  { name: "Dispel Magic", look: "teleport", color: "#9fe8ff" },
  { name: "Healing word", look: "sparkle", size: 1, color: "#8fffb0" },
  { name: "Magic Fist", look: "force-darts", color: "#c08bff" },
  { name: "Bladeleap", look: "force-darts", color: "#d8dee6" },
  { name: "Lightning Ball", look: "orb", color: "#9fd0ff" },
  { name: "Fog bolt", look: "orb", color: "#d8dee6" },
  { name: "Retribution", look: "holy-bolt", color: "#ffd65a" },
  { name: "Fist of retribution", look: "holy-bolt", color: "#ffd65a" },
  { name: "Ray of Fatigue", look: "ray", color: "#a0a8b8" },
  { name: "Ray of clumsiness", look: "ray", color: "#e0a040" },
  { name: "Ray of weakness", look: "ray", color: "#6ac06a" },
  // The rest of the doc's looks. A sphere's metres are its radius (as Fog Cloud's own text has
  // it), a cube is a circle as wide.
  { name: "Fireball", look: "fire-burst", size: 2, perLevel: 1 },
  { name: "Elemental Burst", look: "fire-burst", size: 3 },
  { name: "Fire burst", look: "fire-burst", size: 1.5 },
  { name: "Fiery Cube", look: "fire-burst", size: 1.5 },
  { name: "Fire Rain", look: "fire-burst", size: 5 },
  { name: "Burning Hands", look: "flame-fan", size: 2, spread: 120 },
  { name: "Frost bolt", look: "cold-burst", size: 2, perLevel: 1 },
  { name: "Snowball Storm", look: "cold-burst", size: 10 },
  { name: "Hail of Stones", look: "falling-stones", size: 3, perLevel: 2 },
  { name: "Scatterspray", look: "falling-stones", size: 1.5 },
  { name: "Stormvoice", look: "thunderclap", size: 5 },
  { name: "Breath of Bewilderment", look: "thunderclap", size: 1.5 },
  { name: "Battering Ram", look: "thunderclap", size: 0.75 },
  { name: "Sunburst", look: "holy-flash", size: 15 },
  { name: "Return to earth", look: "holy-flash", size: 15 },
  { name: "Lightning Bolt", look: "lightning", color: "#bfe0ff" },
  { name: "Lightning Strike", look: "lightning", color: "#bfe0ff" },
  { name: "Lightning Lance", look: "lightning", color: "#bfe0ff" },
  { name: "Static Shock", look: "lightning", color: "#d8ecff" },
  { name: "Flame Arrow", look: "fire-bolt", color: "#ff8a3a" },
  { name: "Fire Arrows", look: "fire-bolt", color: "#ff8a3a" },
  { name: "Fire Lance", look: "fire-bolt", color: "#ff6a2a" },
  { name: "Minute Meteors", look: "fire-bolt", color: "#ffb23a" },
  { name: "Scorcher", look: "fire-bolt", color: "#ff6a2a" },
  { name: "Ice bolt", look: "ice-shard", color: "#bfeaff" },
  { name: "Ice Lance", look: "ice-shard", color: "#bfeaff" },
  { name: "Ice knife", look: "ice-shard", color: "#dff6ff" },
  { name: "Acid Arrow", look: "acid-arrow", color: "#8fe04a" },
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
  /** Metres: a rectangle this narrow instead of a square (a bridge), `size` long, across the map. */
  width?: number;
  /** Metres `size` grows for each level it's cast above its own (Fog Cloud's "8 m × SL"). */
  perLevel?: number;
  /** Rounds it lasts at its own level, where the sheets give rounds; more for each level above. */
  rounds?: number;
  roundsPerLevel?: number;
}

/**
 * The party's spells that stay on the map, and a few like them. Sizes from the character sheets
 * at the spell's own level, growing for each level above where the sheet says so: Fog Cloud
 * "8m*SL sphere" (an 8 m radius a level, as its own text has it), Wall of Fog "6*SL+7m cube",
 * Spike Growth "7-m-radius sphere", Pit "7m pit"; a drag makes any of them bigger or smaller.
 * Rounds where the sheets give a duration in rounds (Wall of Fog "2*SL+2d4+2", taking 2d4 as 5).
 */
export const ZONE_SPELLS: ZoneSpell[] = [
  { name: "Fog Cloud", look: "fog", shape: "circle", size: 8, perLevel: 8 },
  { name: "Wall of Fog", look: "fog", shape: "square", size: 13, perLevel: 6, rounds: 9, roundsPerLevel: 2 },
  { name: "Stinking Cloud", look: "poison-cloud", shape: "square", size: 7, rounds: 2, roundsPerLevel: 1 },
  { name: "Acid Cloud", look: "poison-cloud", shape: "circle", size: 10 },
  { name: "Darkness", look: "darkness", shape: "circle", size: 5 },
  { name: "Blackness", look: "darkness", shape: "circle", size: 7 },
  { name: "Light", look: "light", shape: "circle", size: 5 },
  { name: "Lasting flame", look: "light", shape: "circle", size: 4 },
  { name: "Continual Light", look: "light", shape: "circle", size: 10 },
  { name: "Daylight", look: "light", shape: "circle", size: 20 },
  { name: "Moonbeam", look: "moonbeam", shape: "circle", size: 2 },
  { name: "Entangle", look: "vines", shape: "square", size: 8, perLevel: 2 },
  { name: "Plant Growth", look: "vines", shape: "circle", size: 6 },
  { name: "Briartangle", look: "vines", shape: "circle", size: 24, perLevel: 6 },
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
  { name: "Sound Bubble", look: "marked", shape: "circle", size: 3 },
  // The doc's other spells for these looks. Lights on an object get a few metres; a drag sizes any.
  { name: "Magic Mist", look: "fog", shape: "circle", size: 21, perLevel: 7 },
  { name: "Smoke Sphere", look: "fog", shape: "circle", size: 3, rounds: 1 },
  { name: "Create Smoke", look: "fog", shape: "circle", size: 20, rounds: 4 },
  { name: "Inkwater", look: "fog", shape: "circle", size: 25, perLevel: 5 },
  { name: "Pyrotechnics", look: "fog", shape: "circle", size: 6 },
  { name: "Chilling Darkness", look: "darkness", shape: "square", size: 15 },
  { name: "Light (reversed)", look: "darkness", shape: "circle", size: 5 },
  { name: "Lasting Light (reversed)", look: "darkness", shape: "circle", size: 5 },
  { name: "Light (cantrip)", look: "light", shape: "circle", size: 2.5 },
  { name: "Lasting Light", look: "light", shape: "circle", size: 5 },
  { name: "Dancing Lights", look: "light", shape: "circle", size: 1.5 },
  { name: "Glowing Globe", look: "light", shape: "circle", size: 3 },
  { name: "Enchanted Torch", look: "light", shape: "circle", size: 3 },
  { name: "Forge fire", look: "light", shape: "circle", size: 3 },
  { name: "Flare", look: "light", shape: "circle", size: 5 },
  { name: "Banner", look: "light", shape: "circle", size: 3 },
  { name: "Wall of Moonlight", look: "moonbeam", shape: "square", size: 10, width: 1 },
  { name: "Beam of Light", look: "moonbeam", shape: "circle", size: 1 },
  { name: "Hold Plant", look: "vines", shape: "square", size: 15 },
  { name: "Earthen Grasp", look: "vines", shape: "circle", size: 0.75 },
  { name: "Foothold", look: "spikes", shape: "circle", size: 3.5 },
  { name: "Entomb", look: "pit", shape: "square", size: 10 },
  { name: "Soften earth and stone", look: "pit", shape: "square", size: 3 },
  { name: "Lower Water", look: "water", shape: "circle", size: 6 },
  { name: "Still Water", look: "water", shape: "square", size: 10 },
  { name: "Spring", look: "water", shape: "circle", size: 1.5 },
  { name: "Minor Illusion", look: "hypnotic", shape: "square", size: 6 },
  // The rest of the doc's zones (31 October 2026, protocol 8).
  { name: "Circle of Flame", look: "fire-ring", shape: "circle", size: 2 },
  { name: "Affect Fires", look: "fire-ring", shape: "circle", size: 3 },
  { name: "Acid Rain", look: "acid", shape: "square", size: 20, rounds: 8, roundsPerLevel: 2 },
  { name: "Corrosive Solvent", look: "acid", shape: "circle", size: 0.75 },
  { name: "Web", look: "web", shape: "square", size: 6 },
  { name: "Mystic Rope", look: "web", shape: "circle", size: 1.5 },
  { name: "Grease", look: "grease", shape: "square", size: 3 },
  { name: "Lubricity", look: "grease", shape: "circle", size: 3 },
  { name: "Force Umbrella", look: "force-dome", shape: "circle", size: 3.5 },
  { name: "Tiny Hut", look: "force-dome", shape: "circle", size: 7 },
  { name: "Minor Ward", look: "force-dome", shape: "circle", size: 5 },
  { name: "Magic Circle", look: "force-dome", shape: "circle", size: 4 },
  { name: "Protection from Spirits", look: "force-dome", shape: "circle", size: 3 },
  { name: "Ward against Undead", look: "force-dome", shape: "circle", size: 15, perLevel: 5 },
  { name: "Spell Vortex", look: "force-dome", shape: "circle", size: 1 },
  { name: "Forceward", look: "force-dome", shape: "square", size: 24, width: 0.5, perLevel: 6 },
  { name: "Line of defence", look: "force-dome", shape: "square", size: 30, width: 1 },
];

/**
 * Spells that put something new on the map, as zones: a glowing weapon its caster drags round,
 * a bridge or stairs of light, a path opening through plants (a click lays one across the map,
 * a drag corner to corner sets which way it goes).
 */
export const CONJURED_SPELLS: ZoneSpell[] = [
  { name: "Spiritual Weapon", look: "spirit-weapon", shape: "circle", size: 0.75 },
  { name: "Moonbridge", look: "bridge", shape: "square", size: 9, width: 1.5 },
  { name: "Shimmering Stairs", look: "bridge", shape: "square", size: 6, width: 1.5 },
  { name: "Plant Door", look: "path", shape: "square", size: 9, width: 1.5 },
];

export function zoneSpell(name: string): ZoneSpell | undefined {
  return ZONE_SPELLS.find((s) => s.name === name) ?? CONJURED_SPELLS.find((s) => s.name === name);
}

/** A spell put on a token: its look follows the token until the spell is ended. */
export interface TokenSpell {
  name: string;
  look: TokenLook;
  /** The look's colour: a shell's (blue for force, gold for holy), an outline's, a weapon's flames. */
  color: string;
  /** Rounds it lasts at its own level, where the sheets give rounds; more for each level above. */
  rounds?: number;
  roundsPerLevel?: number;
}

/**
 * The party's spells that change how a token looks, and the others that look the same (the
 * approval doc's section 4). Faerie Fire also shows an unseen token; a weapon is fire or ice by
 * its colour.
 */
export const TOKEN_SPELLS: TokenSpell[] = [
  { name: "Faerie Fire", look: "outline", color: "#c77dff" },
  { name: "Aura fire", look: "outline", color: "#ff7a2a" },
  { name: "Brightmantle", look: "outline", color: "#ffd86a" },
  { name: "Invisibility", look: "unseen", color: "#ffffff" },
  { name: "Chameleon", look: "unseen", color: "#ffffff" },
  { name: "Camouflage", look: "unseen", color: "#ffffff" },
  { name: "Meld into Stone", look: "unseen", color: "#ffffff" },
  { name: "Fireform", look: "unseen", color: "#ffffff" },
  { name: "Mage Armor", look: "shell", color: "#5aa8ff" },
  { name: "Shield", look: "shell", color: "#5aa8ff" },
  { name: "Improved Shield", look: "shell", color: "#5aa8ff" },
  { name: "Sanctuary", look: "shell", color: "#ffd65a" },
  { name: "Shield of Faith", look: "shell", color: "#ffd65a" },
  { name: "Divine Armour", look: "shell", color: "#ffd65a" },
  { name: "Barkskin", look: "shell", color: "#9a6a3a" },
  { name: "Shellskin", look: "shell", color: "#9a6a3a" },
  { name: "Plant Armour", look: "shell", color: "#5cbf4a" },
  { name: "Flame Blade", look: "weapon", color: "#ff7a2a" },
  { name: "Bladefire", look: "weapon", color: "#ff7a2a" },
  { name: "Blazing Sword", look: "weapon", color: "#ff7a2a" },
  { name: "Ice Blade", look: "weapon", color: "#8fd8ff" },
  { name: "Ice Claws", look: "weapon", color: "#8fd8ff" },
  { name: "Heat Metal", look: "red-hot", color: "#ff4a1a" },
  { name: "Hold Person", look: "held", color: "#8fa8c8" },
  { name: "Hold animal", look: "held", color: "#8fa8c8" },
  { name: "Hold Undead", look: "held", color: "#8fa8c8" },
  { name: "Slow", look: "slowed", color: "#8fa8c8" },
  { name: "Fly", look: "flying", color: "#ffffff" },
  { name: "Levitate", look: "flying", color: "#ffffff" },
  { name: "Feather Fall", look: "flying", color: "#ffffff" },
  { name: "Treeform", look: "treeform", color: "#3e7a2e" },
  { name: "Summon Insects", look: "swarm", color: "#2a2a1a" },
  { name: "Spectral animal", look: "spectral", color: "#9fe8ff" },
  { name: "Fire Phantom", look: "spectral", color: "#ff9a4a" },
  { name: "Raging Griffon", look: "spectral", color: "#9fe8ff" },
  { name: "Guardian", look: "spectral", color: "#9fe8ff" },
  { name: "Phantom Steed", look: "spectral", color: "#9fe8ff" },
  { name: "Mirror Image", look: "mirror", color: "#ffffff" },
  { name: "Blur", look: "blur", color: "#ffffff" },
  { name: "Displace Self", look: "blur", color: "#ffffff" },
  { name: "Duplicate self", look: "blur", color: "#ffffff" },
  { name: "Blink", look: "blink", color: "#b48cff" },
  { name: "Shadow Blink", look: "blink", color: "#5a3a8a" },
  { name: "Haste", look: "haste", color: "#ffe066" },
];

export function tokenSpell(name: string): TokenSpell | undefined {
  return TOKEN_SPELLS.find((s) => s.name === name);
}

/** A spell's name as the sheets and Table might both spell it: lower case, plain quotes, no "(R)" or "(1)" after it. */
function spellKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s*\((r|\d+)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

let tableNames: Map<string, string> | null = null;

/**
 * The Spells tool's spells for one on a character's sheet: its own ("Light (R)" is Light), and for a
 * reversible one ("(R)") the reverse too, where Table has it (Light (reversed), which is darkness).
 * None for a spell with nothing to show.
 */
export function tableSpellsFor(sheetName: string): string[] {
  tableNames ??= new Map([...SPELL_FX, ...ZONE_SPELLS, ...CONJURED_SPELLS, ...TOKEN_SPELLS].map((s) => [spellKey(s.name), s.name]));
  const key = spellKey(sheetName);
  const out: string[] = [];
  const own = tableNames.get(key);
  if (own) out.push(own);
  const reverse = /\(r\)\s*$/i.test(sheetName) ? tableNames.get(`${key} (reversed)`) : undefined;
  if (reverse) out.push(reverse);
  return out;
}

/** One of a character's spells that the Spells tool can show, for the Spells list on their card. */
export interface CastSpell {
  /** The Spells tool's name for it. */
  name: string;
  /** The spell on the sheet it comes from. */
  sheet: CharacterSpell;
  /** It has to be prayed for (Pray) or memorised (Memorize) each day before it can be cast. */
  prayer: boolean;
  /** Casts left today, for one that has to be prayed for. */
  left: number;
  /** The sheet says it can't be cast yet ("Level 4: not castable yet"). */
  locked: boolean;
  /** It can take more spell points ("2+" on the sheet): cast at a higher level. */
  raise: boolean;
}

/**
 * The spells on a character's sheet that the Spells tool can show, with what's been prayed for
 * today: the castable ones first, by level, then the ones the sheet says can't be cast yet.
 */
export function castList(c: Pick<Character, "spells" | "prayed">): CastSpell[] {
  const out: CastSpell[] = [];
  const seen = new Set<string>();
  for (const s of c.spells ?? []) {
    const prayer = /^(pray|memori[sz]e)$/i.test(s.prayer);
    const locked = /not castable/i.test(s.note);
    for (const name of tableSpellsFor(s.name)) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, sheet: s, prayer, left: prayer ? (c.prayed?.[s.name] ?? 0) : 0, locked, raise: s.sp.includes("+") });
    }
  }
  return out.sort((a, b) => Number(a.locked) - Number(b.locked) || (a.sheet.level ?? 99) - (b.sheet.level ?? 99) || a.name.localeCompare(b.name));
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

/** The highest level a character casts at: the highest of their spells the sheet doesn't say they can't cast yet. */
export function highestLevel(list: readonly CastSpell[]): number {
  return Math.min(9, Math.max(0, ...list.filter((s) => !s.locked).map((s) => s.sheet.level ?? 0)));
}

/** A spell's size cast `above` levels above its own: its own, grown by `perLevel` metres a level. */
export function sizeAt(size: number | undefined, perLevel: number | undefined, above: number): number | undefined {
  return size === undefined ? undefined : size + (perLevel ?? 0) * Math.max(0, above);
}

/**
 * How many rounds a spell that stays lasts, cast `above` levels above its own, where the sheets give
 * it in rounds; null (until it's ended) where they don't.
 */
export function roundsAt(name: string, above: number): number | null {
  const s = zoneSpell(name) ?? tokenSpell(name);
  return s?.rounds ? s.rounds + (s.roundsPerLevel ?? 0) * Math.max(0, above) : null;
}

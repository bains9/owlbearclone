// Dice sets (4 November 2026): how a roll's dice look in the chat. Each character in the party has
// a set of their own, chosen in the Party list by their player or the GM (kept by the Worker, for
// every room, one character to a set), so a roll from their card, or from the dice tray of the
// browser playing them, comes in their dice. The GM's own rolls are the villains', in one of three
// sets only the GM rolls, the GM's pick (kept by the Worker, for every room). Their numbers are plain
// and solid, to read at a glance: the menace is in the die. Everyone else's, and rolls from before,
// are Classic.
import type { Role } from "./types";

export const DICE_SET_IDS = ["classic", "pearl", "bone", "ruby", "emerald", "sapphire", "amethyst", "copper", "frost", "galaxy", "villain", "blood", "hellfire"] as const;

export type DiceSetId = (typeof DICE_SET_IDS)[number];

export interface DiceSet {
  id: DiceSetId;
  name: string;
  /** What they look like, in a few words. */
  look: string;
  /** The GM's alone: no character can have them. */
  gmOnly?: true;
}

export const DICE_SETS: readonly DiceSet[] = [
  { id: "classic", name: "Classic", look: "plain grey, as dice always were here" },
  { id: "pearl", name: "Pearl", look: "pearl paint with a purple shimmer, gold numbers" },
  { id: "bone", name: "Bone", look: "old ivory, black numbers" },
  { id: "ruby", name: "Ruby", look: "red glass, gold numbers" },
  { id: "emerald", name: "Emerald", look: "green glass, white numbers" },
  { id: "sapphire", name: "Sapphire", look: "blue glass, silver numbers" },
  { id: "amethyst", name: "Amethyst", look: "purple glass, white numbers" },
  { id: "copper", name: "Copper", look: "polished copper, dark numbers" },
  { id: "frost", name: "Frost", look: "ice, deep blue numbers" },
  { id: "galaxy", name: "Night sky", look: "stars on deep blue, white numbers" },
  // The GM's: the id "villain" stays, so rolls from before keep their set.
  { id: "villain", name: "Obsidian and bone", look: "black obsidian, bone-white numbers, a blood-red glow", gmOnly: true },
  { id: "blood", name: "Blood and bone", look: "deep red, bone-white numbers, a black edge", gmOnly: true },
  { id: "hellfire", name: "Hellfire", look: "black, fire-gold numbers, an ember glow", gmOnly: true },
];

/** Anyone's who has no set: a character nobody chose for, a player who plays nobody. */
export const PLAIN_DICE: DiceSetId = "classic";

/** The GM's own rolls, until they pick another: they roll for the villains. */
export const GM_DICE: DiceSetId = "villain";

export function isDiceSet(v: unknown): v is DiceSetId {
  return typeof v === "string" && (DICE_SET_IDS as readonly string[]).includes(v);
}

export function diceSet(id: DiceSetId): DiceSet {
  return DICE_SETS.find((s) => s.id === id) ?? DICE_SETS[0];
}

/** A set a character may have: any but the GM's own. */
export function isCharacterDice(v: unknown): v is DiceSetId {
  return isDiceSet(v) && !diceSet(v).gmOnly;
}

/** The sets a character can be given, in the order they're offered. */
export const CHARACTER_DICE: readonly DiceSet[] = DICE_SETS.filter((s) => !s.gmOnly);

/** The villains' sets, only the GM's, in the order they're offered. */
export const GM_SETS: readonly DiceSet[] = DICE_SETS.filter((s) => s.gmOnly);

/** A set the GM may pick for their own rolls. */
export function isGmDice(v: unknown): v is DiceSetId {
  return isDiceSet(v) && !!diceSet(v).gmOnly;
}

/**
 * The set a roll is made in. `set` is a character's: the one whose card it's rolled from
 * (`forCharacter`), or for a roll from the dice tray, the one this browser plays. For the GM's own
 * rolls, from the tray, it's the villains' set the GM picked (Obsidian and bone until they do).
 */
export function rollingSet(role: Role, forCharacter: boolean, set: unknown): DiceSetId {
  if (!forCharacter && role === "gm") return isGmDice(set) ? set : GM_DICE;
  return isCharacterDice(set) ? set : PLAIN_DICE;
}

/** The set a message's dice are drawn in: the one it was rolled in, or Classic. */
export function messageDice(m: { dice?: unknown }): DiceSetId {
  return isDiceSet(m.dice) ? m.dice : PLAIN_DICE;
}

/** The classes that paint dice in a set (styles.css), on whatever holds them; none for Classic. */
export function diceClass(id: DiceSetId): string {
  return id === PLAIN_DICE ? "" : `dice-painted dice-set-${id}`;
}

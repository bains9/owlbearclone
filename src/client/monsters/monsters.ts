// The GM's Monsters list: ready-made creatures sized to the map's grid by their D&D size. Each
// becomes an ordinary picture token: the first time a creature is used in a room, the browser
// draws its token (art.ts) and uploads it like any token picture, named so it's found again
// next time. The icons themselves (icons.ts, generated) are loaded only when the list opens.
// Kept apart from the board and the panel so the rules can be tested.

import type { Asset } from "../../shared/types";
import { numberedCopy } from "../room/actions";
import { DND_SQUARES } from "../room/tokenSizes";
import type { DndSize } from "../room/tokenSizes";

export type CreatureType =
  | "humanoid"
  | "undead"
  | "beast"
  | "monstrosity"
  | "giant"
  | "dragon"
  | "fiend"
  | "elemental"
  | "construct"
  | "plant"
  | "fey";

export interface MonsterIcon {
  id: string;
  name: string;
  size: DndSize;
  type: CreatureType;
  /** Where it came from on game-icons.net: author/icon. */
  source: string;
  /** Where the drawing sits in its 512 x 512 box: its middle (x, y) and how far it reaches from there. */
  fit: readonly [number, number, number];
  /** The icon's SVG path data, on a 512 x 512 box. */
  path: string;
}

/** The types in the order the filter lists them. */
export const CREATURE_TYPES: readonly CreatureType[] = [
  "humanoid",
  "undead",
  "beast",
  "monstrosity",
  "giant",
  "dragon",
  "fiend",
  "elemental",
  "construct",
  "plant",
  "fey",
];

export const TYPE_NAMES: Record<CreatureType, string> = {
  humanoid: "Humanoid",
  undead: "Undead",
  beast: "Beast",
  monstrosity: "Monstrosity",
  giant: "Giant",
  dragon: "Dragon",
  fiend: "Fiend",
  elemental: "Elemental",
  construct: "Construct",
  plant: "Plant",
  fey: "Fey",
};

/**
 * The ring round each type's tokens: one colour each, far enough apart to tell at a glance (by
 * lightness as well as hue, so they still differ for red-green colour-blind eyes) and bright
 * enough to read against the token's dark disc (and on a map, past its dark rim).
 */
export const TYPE_COLORS: Record<CreatureType, string> = {
  humanoid: "#f4d062",
  undead: "#7de3c2",
  beast: "#07b854",
  monstrosity: "#e57a00",
  giant: "#a97664",
  dragon: "#f43437",
  fiend: "#f659a7",
  elemental: "#00a8ff",
  construct: "#bac5dc",
  plant: "#b9df00",
  fey: "#a268cf",
};

/** The letter the list shows for each size. */
export const SIZE_LETTERS: Record<DndSize, string> = {
  tiny: "T",
  small: "S",
  medium: "M",
  large: "L",
  huge: "H",
  gargantuan: "G",
};

/** How many squares across a creature's token is. */
export function monsterSquares(m: Pick<MonsterIcon, "size">): number {
  return DND_SQUARES[m.size];
}

/** The pixels across a creature's token picture (big enough to stay sharp on a 6-square token up close). */
export const ART_PX = 768;

/** The name of a creature's uploaded token picture, which is how it's found again. */
export function monsterAssetName(m: Pick<MonsterIcon, "name">): string {
  return `Monster: ${m.name}`;
}

/**
 * A creature's token picture, if this room has one already: a token image with its name, square
 * and as big as the browser draws them (a picture someone renamed, or a different one that
 * happens to have the name, isn't it).
 */
export function findMonsterAsset(assets: Record<string, Asset>, m: Pick<MonsterIcon, "name">): Asset | undefined {
  const name = monsterAssetName(m);
  return Object.values(assets)
    .filter((a) => a.kind === "token" && a.name === name && a.width === ART_PX && a.height === ART_PX)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}

/**
 * A new creature's name: its own, or numbered like a duplicate when a token on the scene already
 * has it ("Goblin" -> "Goblin 2", then one more than the highest number there).
 */
export function monsterLabel(name: string, taken: string[]): string {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*\\d+)?$`);
  return taken.some((t) => re.test(t)) ? numberedCopy(name, taken) : name;
}

/** The creatures with a word in their name or type starting with each word of `query`, of `type` if one is picked. */
export function filterMonsters<T extends Pick<MonsterIcon, "name" | "type">>(
  list: readonly T[],
  query: string,
  type: CreatureType | "",
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((m) => {
    if (type && m.type !== type) return false;
    const own = `${m.name} ${TYPE_NAMES[m.type]}`.toLowerCase().split(/[\s-]+/);
    return words.every((w) => own.some((o) => o.startsWith(w)));
  });
}

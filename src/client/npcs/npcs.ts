// The GM's NPCs list: ready-made people by race and class, from the group's own campaign
// handbook (the names and colours are its, not any official list; they're in table.ts, generated
// from scripts/npc-icons/list.tsv). Each race + class pair becomes an ordinary picture token: the
// first time a pair is used in a room, the browser draws its token (art.ts) and uploads it like
// any token picture, named so it's found again next time. The icons themselves (icons.ts,
// generated from the same table) are loaded only when the list opens. Kept apart from the board
// and the panel so the rules can be tested.

import type { Asset } from "../../shared/types";
import { numberedCopy } from "../room/actions";
import { DND_SIZE_NAMES, DND_SQUARES, sizeOptionLabel } from "../room/tokenSizes";
import type { DndSize } from "../room/tokenSizes";
import { NPC_CLASSES, NPC_RACES } from "./table";

export { NPC_CLASSES, NPC_RACES };

export type RaceGroup = "Elves" | "Dwerves and gnomes" | "Humans" | "NPC races";
export type ClassGroup = "Classes" | "NPC classes";

export interface NpcRace {
  id: string;
  name: string;
  group: RaceGroup;
  /** Its D&D size, for the token's squares. */
  size: DndSize;
  /** The icon of its head (a key of NPC_ICONS). */
  icon: string;
  /** The colour its head is drawn in. */
  tint: string;
}

export interface NpcClass {
  id: string;
  name: string;
  group: ClassGroup;
  /** The icon of its emblem (a key of NPC_ICONS). */
  icon: string;
  /** The colour of the token's ring and badge, and of the token on the map. */
  color: string;
}

/** A head or emblem icon, from icons.ts. */
export interface NpcIcon {
  /** Where it came from on game-icons.net: author/icon. */
  source: string;
  /** Where the drawing sits in its 512 x 512 box: its middle (x, y) and how far it reaches from there. */
  fit: readonly [number, number, number];
  /** The icon's SVG path data, on a 512 x 512 box. */
  path: string;
}

/** The icons by their key (author_icon), as icons.ts has them. */
export type NpcIcons = Readonly<Record<string, NpcIcon>>;

/** The race groups in the order the list shows them, and the classes'. */
export const RACE_GROUPS: readonly RaceGroup[] = ["Elves", "Dwerves and gnomes", "Humans", "NPC races"];
export const CLASS_GROUPS: readonly ClassGroup[] = ["Classes", "NPC classes"];

/** The race with `id`, if there is one. */
export function findRace(id: string): NpcRace | undefined {
  return NPC_RACES.find((r) => r.id === id);
}

/** The class with `id`, if there is one. */
export function findClass(id: string): NpcClass | undefined {
  return NPC_CLASSES.find((c) => c.id === id);
}

/** The races by group, in the order the list shows them (for a picker with a heading per group). */
export function racesByGroup(): { group: RaceGroup; races: NpcRace[] }[] {
  return RACE_GROUPS.map((group) => ({ group, races: NPC_RACES.filter((r) => r.group === group) }));
}

/** The classes by group, in the order the list shows them. */
export function classesByGroup(): { group: ClassGroup; classes: NpcClass[] }[] {
  return CLASS_GROUPS.map((group) => ({ group, classes: NPC_CLASSES.filter((c) => c.group === group) }));
}

/** What an NPC of this race and class is called: "Octran Crusader". */
export function npcName(race: Pick<NpcRace, "name">, cls: Pick<NpcClass, "name">): string {
  return `${race.name} ${cls.name}`;
}

/** How many squares across an NPC's token is (by its race's D&D size). */
export function npcSquares(race: Pick<NpcRace, "size">): number {
  return DND_SQUARES[race.size];
}

/** An NPC as the list describes it when pointed at: "Octran Crusader: Medium, 1×1 squares". */
export function npcDescription(race: Pick<NpcRace, "name" | "size">, cls: Pick<NpcClass, "name">): string {
  return `${npcName(race, cls)}: ${DND_SIZE_NAMES[race.size]}, ${sizeOptionLabel(npcSquares(race), false)} squares`;
}

/** The pixels across an NPC's token picture (the same as a creature's, so it stays sharp up close). */
export const ART_PX = 768;

/** The name of an NPC's uploaded token picture, which is how it's found again. */
export function npcAssetName(race: Pick<NpcRace, "name">, cls: Pick<NpcClass, "name">): string {
  return `NPC: ${npcName(race, cls)}`;
}

/**
 * An NPC's token picture, if this room has one already: a token image with its name, square
 * and as big as the browser draws them (a picture someone renamed, or a different one that
 * happens to have the name, isn't it).
 */
export function findNpcAsset(
  assets: Record<string, Asset>,
  race: Pick<NpcRace, "name">,
  cls: Pick<NpcClass, "name">,
): Asset | undefined {
  const name = npcAssetName(race, cls);
  return Object.values(assets)
    .filter((a) => a.kind === "token" && a.name === name && a.width === ART_PX && a.height === ART_PX)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}

/**
 * A new NPC's label: its name, or numbered like a duplicate when a token on the scene already
 * has it ("Octran Crusader" -> "Octran Crusader 2", then one more than the highest number there).
 */
export function npcLabel(name: string, taken: string[]): string {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*\\d+)?$`);
  return taken.some((t) => re.test(t)) ? numberedCopy(name, taken) : name;
}

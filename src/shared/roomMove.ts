// Tokens moved to another of the GM's rooms (asked for on 2026-11-22: a GM had NPCs with their stats
// and HP filled in in one room, and wanted them in another). The GM selects them and clicks **Move
// to another room…** on their bar, then picks the room and one of its maps. The Worker
// (worker/moveRoutes.ts) copies them into that room first, with their pictures, stats and HP, their
// campaign notes' links and the spells on them, and takes them out of this one only once that room
// has them all: if anything fails on the way, nothing leaves, and the GM is told. Nobody's view
// changes: nobody goes with them.
//
// Only the GM's own tokens that aren't characters' go (canChangeRoom). A character's token stands for
// someone playing at this table: moved away, its player would be left here without it (sending
// characters and their players to another room together is a step for later). Players' own tokens
// stay theirs, here. A compass belongs to its map.

import type { GridSettings, Asset, DrawingItem, TokenItem } from "./types";
import type { TokenStats } from "./tokenStats";
import { GM_OWNER } from "./sanitize";

/** Tokens one move takes at most (a selection that big is a map's worth). */
export const MAX_MOVE = 100;

/**
 * Where a token that moved to another room was: its id stays taken here, for good, and only by it.
 * Undo can't bring it back (it's in the other room now), and a player's page can't reuse it. Not
 * an id anyone could have (shared/sanitize.ts isId).
 */
export const MOVED_AWAY = "@moved";

/** A token the GM can move to another room: one of theirs, not a character's, not a compass. */
export function canChangeRoom(t: TokenItem): boolean {
  return !t.art && !t.character && t.owner === GM_OWNER;
}

/** Tokens leaving a room (worker/room.ts exportTokens): everything that goes with them. */
export interface MoveBundle {
  /** The scene they were on, and its grid (they keep their places around each other). */
  sceneId: string;
  grid: GridSettings;
  tokens: TokenItem[];
  /** The spells on them: drawings with `on`. */
  spells: DrawingItem[];
  /** Their stats and HP, by token id (GM only, never a player's). */
  stats: Record<string, TokenStats>;
  /** Their campaign notes' links, by token id (GM only). */
  notes: Record<string, string>;
  /** Their pictures, as the room they're leaving has them. */
  assets: Asset[];
}

/** Tokens arriving in a room (worker/room.ts importTokens). */
export interface MoveArrival extends MoveBundle {
  /** The scene they go to. */
  to: string;
  /** Each picture of the bundle (by its id there) to this room's: one it had already, or one of `made`. Missing: none. */
  pictures: Record<string, string>;
  /** Pictures made for them in this room: their files are copied already. */
  made: Asset[];
}

/** A map of a room, for the GM choosing where tokens go. */
export interface RoomMap {
  id: string;
  name: string;
  /** The one players see. */
  live: boolean;
}

/** What the GM's told once they've gone. */
export interface MoveResult {
  /** The names of the tokens that went. */
  moved: string[];
  room: { id: string; name: string };
  map: { id: string; name: string };
  /** They're in the other room, but couldn't be taken off this map: the GM deletes them here. */
  stuck?: boolean;
}

/**
 * Two of a room's pictures that are the same picture: the same name, size and kind of file. Moving a
 * goblin to a room that has its picture already (a built-in monster's, say, or one moved there
 * before) uses that one rather than making another.
 */
export function samePicture(a: Asset, b: Asset): boolean {
  return a.kind === "token" && b.kind === "token" && a.name === b.name && a.bytes === b.bytes && a.width === b.width && a.height === b.height && a.mime === b.mime;
}

/** "Goblin", "Goblin and Orc", "Goblin and 2 others"; "3 tokens" when none has a name. */
export function movedNames(labels: readonly string[]): string {
  const named = labels.filter((l) => l.trim());
  const n = labels.length;
  if (!named.length) return n === 1 ? "1 token" : `${n} tokens`;
  if (n === 1) return named[0];
  if (n === 2 && named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named[0]} and ${n - 1} other${n - 1 === 1 ? "" : "s"}`;
}

/** "Bram", "Bram and Cora", "Bram, Cora and Ula". */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Why tokens chosen to move stay, in words for the GM: characters' (their players would be left here
 * without them), players' own, and compasses (they belong to their maps). One line each; none when
 * all of them go.
 */
export function whyStaying(tokens: readonly TokenItem[]): string[] {
  const out: string[] = [];
  const stays = (list: readonly TokenItem[]) => `${listed(list.map((t) => t.label.trim() || "A token"))} ${list.length === 1 ? "stays" : "stay"} here`;
  const characters = tokens.filter((t) => !canChangeRoom(t) && !t.art && t.character);
  const players = tokens.filter((t) => !canChangeRoom(t) && !t.art && !t.character && t.owner !== GM_OWNER);
  if (characters.length) out.push(`${stays(characters)}: a character's token doesn't move to another room, or their player would be left here without it.`);
  if (players.length) out.push(`${stays(players)}: tokens players put down stay theirs, in this room.`);
  if (tokens.some((t) => t.art === "compass")) out.push("Compasses stay with their maps.");
  return out;
}

/** "Goblin and 2 others moved to “Northreach” › “Coast”." */
export function movedText(labels: readonly string[], room: string, map: string): string {
  return `${movedNames(labels)} moved to “${room}” › “${map}”.`;
}

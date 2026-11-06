// Initiative from the map: a token's entry in the list (a character rolls the handbook's d10 with
// their sheet's initiative bonus, their INT bonus; anything else a plain d10), and creatures the
// GM puts on the map joining the list by themselves, their rolls kept from the players.

import { initiativeRoll } from "../shared/characters";
import { randomId } from "../shared/ids";
import type { InitEntry, TokenItem } from "../shared/types";
import { isCompass } from "../shared/types";
import type { RoomClient } from "./room/client";

/** Whether a token fights as a creature of the GM's: not a player's character, a prop or a compass. */
export function isCreature(t: TokenItem): boolean {
  return !t.character && t.layer !== "prop" && !isCompass(t);
}

/** A token's entry, rolled: the GM's creatures are kept from the players (the GM can show one). */
export function initEntryFor(room: RoomClient, t: TokenItem): InitEntry {
  return {
    id: randomId(10),
    name: t.label || "Token",
    value: initiativeRoll(room.characterOf(t) ?? room.state.tokenStats[t.id] ?? null),
    color: t.color,
    tokenId: t.id,
    ...(room.isGm && isCreature(t) ? { hidden: true } : {}),
  };
}

export const AUTO_KEY = "tabletop-initiative-auto";

/** The choice made on this page, for when the browser won't store it (a private window, say). */
let autoHere = true;

/** Whether creatures the GM places roll and join the list by themselves, on this device (on unless turned off). */
export function loadAutoInitiative(): boolean {
  try {
    const v = localStorage.getItem(AUTO_KEY);
    return v === null ? autoHere : v === "1";
  } catch {
    return autoHere;
  }
}

export function saveAutoInitiative(on: boolean): void {
  autoHere = on;
  try {
    localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    // No storage: it lasts as long as the page.
  }
}

/**
 * GM: creatures just put on the map (placed, dropped or copied) roll and join the initiative list,
 * kept from the players. Only on the scene everyone's on, so creatures set out on a scene still
 * being got ready don't take turns in a fight elsewhere (Add selected adds them when it's time).
 */
export function creaturesJoin(room: RoomClient, tokens: readonly TokenItem[]): void {
  if (!room.isGm || !loadAutoInitiative()) return;
  const live = room.state.activeSceneId;
  const have = new Set(room.state.initiative.entries.map((e) => e.tokenId));
  for (const t of tokens) {
    if (t.sceneId !== live || !isCreature(t) || have.has(t.id)) continue;
    room.initiativeOp({ op: "add", entry: initEntryFor(room, t) });
  }
}

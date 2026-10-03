// Who may do what. The Room Durable Object enforces these; the browser uses the
// same functions to decide what to offer, so the UI never invites an action the
// server will refuse.

import type { Item, MutableFields, Role, RoomSettings } from "./types";
import { isCompass } from "./types";

export interface Actor {
  userId: string;
  role: Role;
}

/**
 * Whether a player can see an item at all. GMs see everything. (Hidden terrain holds
 * the secret doors: players see those as plain walls.)
 */
export function visibleToPlayer(item: Item, activeSceneId: string | null): boolean {
  if (item.sceneId !== activeSceneId) return false;
  if ((item.kind === "token" || item.kind === "drawing" || item.kind === "terrain") && item.hidden) return false;
  return true;
}

// Only the GM builds: every rule below refuses players anything but tokens and drawings.
// Compass roses are the GM's part of the map: players see them and change nothing about them.

export function canCreate(item: Item, actor: Actor, settings: RoomSettings): boolean {
  if (actor.role === "gm") return true;
  if (item.kind === "token") return settings.playersCanAddTokens && !item.hidden && !item.locked && !item.art;
  if (item.kind === "drawing") return settings.playersCanDraw && !item.hidden;
  return false;
}

export function canMove(item: Item, actor: Actor, settings: RoomSettings): boolean {
  if (actor.role === "gm") return true;
  if (item.kind === "token") {
    if (item.hidden || item.locked || isCompass(item)) return false;
    return settings.playersMoveAll || item.owner === actor.userId;
  }
  if (item.kind === "drawing") return item.owner === actor.userId && !item.hidden;
  return false;
}

export function canPatch(item: Item, set: Partial<MutableFields>, actor: Actor, settings: RoomSettings): boolean {
  if (actor.role === "gm") return true;
  if ("hidden" in set || "locked" in set) return false;
  return canMove(item, actor, settings);
}

/** Replacing an existing item wholesale (undo of a change, for example). */
export function canReplace(existing: Item, next: Item, actor: Actor, settings: RoomSettings): boolean {
  if (actor.role === "gm") return true;
  if (existing.kind !== next.kind) return false;
  if (existing.kind === "token" && next.kind === "token") {
    if (existing.hidden !== next.hidden || existing.locked !== next.locked) return false;
    // Built-in art (a compass) can't be put on a token, or taken off one.
    if ((existing.art ?? null) !== (next.art ?? null)) return false;
  }
  if (existing.kind === "drawing" && next.kind === "drawing" && !!existing.hidden !== !!next.hidden) return false;
  return canMove(existing, actor, settings);
}

export function canDelete(item: Item, actor: Actor): boolean {
  if (actor.role === "gm") return true;
  if (item.kind === "token") return item.owner === actor.userId && !item.locked && !item.hidden && !isCompass(item);
  if (item.kind === "drawing") return item.owner === actor.userId && !item.hidden;
  return false;
}

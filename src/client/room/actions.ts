// Actions on the current selection, shared by the keyboard shortcuts and the
// selection bar.

import { stepByCells } from "../../shared/geometry";
import { randomId } from "../../shared/ids";
import { canDelete } from "../../shared/permissions";
import type { ItemPatch, TokenItem } from "../../shared/types";
import { isCompass } from "../../shared/types";
import type { RoomClient } from "./client";

function selectedItems(room: RoomClient) {
  const s = room.state;
  return s.selection.map((id) => s.items[id]).filter((i) => i !== undefined);
}

function selectedTokens(room: RoomClient): TokenItem[] {
  return selectedItems(room).filter((i): i is TokenItem => i.kind === "token");
}

export function deleteSelection(room: RoomClient): void {
  const me = room.state.me;
  if (!me) return;
  const ids = selectedItems(room)
    .filter((i) => canDelete(i, me))
    .map((i) => i.id);
  if (!ids.length) return;
  room.change({ delete: ids });
  room.select([]);
}

/**
 * The label for a copy: "Goblin" -> "Goblin 2", "Goblin 2" -> the next number not
 * among `taken`, "Goblin #2" -> "Goblin #3", "7" -> "8".
 */
export function numberedCopy(label: string, taken: string[]): string {
  if (!label.trim()) return label;
  const m = /^(.*?)(\s*)(\d+)$/.exec(label);
  // What comes before the number, and whatever separated it (a space, or nothing).
  const base = m ? m[1] : label.trimEnd();
  const sep = m ? m[2] : " ";
  let max = m ? Number(m[3]) : 1;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}\\s*(\\d+)$`);
  for (const t of taken) {
    const mm = re.exec(t);
    if (mm) max = Math.max(max, Number(mm[1]));
  }
  return `${base}${sep}${max + 1}`.slice(0, 60);
}

export function duplicateSelection(room: RoomClient): void {
  const s = room.state;
  if (!s.me) return;
  // Players can't add compasses, so theirs never come into it.
  let tokens = selectedTokens(room).filter((t) => room.isGm || !isCompass(t));
  if (!tokens.length) return;
  if (!room.isGm && !s.room?.settings.playersCanAddTokens) return;
  const scene = room.viewScene;
  if (!scene) return;
  // Only as many compass copies as the scene has room for.
  let fit = room.isGm ? room.compassesFit(tokens[0].sceneId, tokens.filter(isCompass).length) : 0;
  tokens = tokens.filter((t) => !isCompass(t) || fit-- > 0);
  if (!tokens.length) return;
  let z = room.nextZ(tokens[0].sceneId, "token");
  const taken = Object.values(s.items)
    .filter((i): i is TokenItem => i.kind === "token" && i.sceneId === tokens[0].sceneId)
    .map((t) => t.label);
  const copies: TokenItem[] = tokens.map((t) => {
    // A compass keeps its "N" (no numbering: it never shows a label).
    const label = isCompass(t) ? t.label : numberedCopy(t.label, taken);
    taken.push(label);
    // One cell to the right (on hex grids, the next hex over).
    const p = stepByCells(t, 1, 0, scene.grid);
    return {
      ...t,
      id: randomId(12),
      owner: s.me!.userId,
      label,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      z: z++,
      // Players can't create hidden or locked tokens; copies of GM tokens come out plain.
      ...(room.isGm ? {} : { hidden: false, locked: false }),
    };
  });
  room.change({ upsert: copies });
  room.select(copies.map((c) => c.id));
}

export function patchSelection(room: RoomClient, set: ItemPatch["set"], only: "token" | "any" = "token"): void {
  const items = only === "token" ? selectedTokens(room) : selectedItems(room);
  const patches = items.filter((i) => room.canMoveItem(i)).map((i) => ({ id: i.id, set }));
  if (patches.length) room.change({ patch: patches });
}

/** GM: hide the selected tokens, drawings and notes from players, or show them again. */
export function toggleHidden(room: RoomClient): void {
  if (!room.isGm) return;
  const items = selectedItems(room).filter((i) => i.kind === "token" || i.kind === "drawing");
  if (!items.length) return;
  const hidden = !items.every((i) => (i.kind === "token" || i.kind === "drawing") && i.hidden);
  room.change({ patch: items.map((i) => ({ id: i.id, set: { hidden } })) });
}

export function toggleLocked(room: RoomClient): void {
  if (!room.isGm) return;
  const tokens = selectedTokens(room);
  if (!tokens.length) return;
  const locked = !tokens.every((t) => t.locked);
  room.change({ patch: tokens.map((t) => ({ id: t.id, set: { locked } })) });
}

export function rotateSelection(room: RoomClient, degrees: number): void {
  const patches = selectedTokens(room)
    .filter((t) => room.canMoveItem(t))
    .map((t) => ({ id: t.id, set: { rotation: (((t.rotation + degrees) % 360) + 360) % 360 } }));
  if (patches.length) room.change({ patch: patches });
}

export function nudgeSelection(room: RoomClient, dx: number, dy: number): void {
  const scene = room.viewScene;
  if (!scene) return;
  const patches = selectedTokens(room)
    .filter((t) => room.canMoveItem(t))
    .map((t) => {
      // On hex grids, to a neighbouring hex (zigzagging where there's none straight up or across).
      const p = stepByCells(t, dx, dy, scene.grid);
      return { id: t.id, set: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 } };
    });
  if (patches.length) room.change({ patch: patches });
}

export function reorderSelection(room: RoomClient, where: "front" | "back"): void {
  const items = selectedItems(room).filter((i) => room.canMoveItem(i));
  if (!items.length) return;
  const patches: ItemPatch[] = [];
  for (const kind of ["token", "drawing"] as const) {
    const ofKind = items.filter((i) => i.kind === kind);
    if (!ofKind.length) continue;
    let z = where === "front" ? room.nextZ(ofKind[0].sceneId, kind) : room.minZ(ofKind[0].sceneId, kind);
    for (const i of ofKind) {
      patches.push({ id: i.id, set: { z } });
      z += where === "front" ? 1 : -1;
    }
  }
  room.change({ patch: patches });
}

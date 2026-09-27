// Actions on the current selection, shared by the keyboard shortcuts and the
// selection bar.

import { cellSpacing, isHex, snapTokenCenter } from "../../shared/geometry";
import { randomId } from "../../shared/ids";
import { canDelete } from "../../shared/permissions";
import type { ItemPatch, TokenItem } from "../../shared/types";
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

/** "Goblin" -> "Goblin 2", "Goblin 2" -> the next free number among `taken`. */
export function numberedCopy(label: string, taken: string[]): string {
  if (!label.trim()) return label;
  const m = /^(.*?)\s*(\d+)$/.exec(label);
  const base = (m ? m[1] : label).trim() || label;
  let max = m ? Number(m[2]) : 1;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}\\s*(\\d+)$`);
  for (const t of taken) {
    const mm = re.exec(t);
    if (mm) max = Math.max(max, Number(mm[1]));
  }
  return `${base} ${max + 1}`.slice(0, 60);
}

export function duplicateSelection(room: RoomClient): void {
  const s = room.state;
  if (!s.me) return;
  const tokens = selectedTokens(room);
  if (!tokens.length) return;
  if (!room.isGm && !s.room?.settings.playersCanAddTokens) return;
  const scene = room.viewScene;
  const step = scene?.grid.size ?? 70;
  let z = room.nextZ(tokens[0].sceneId, "token");
  const taken = Object.values(s.items)
    .filter((i): i is TokenItem => i.kind === "token" && i.sceneId === tokens[0].sceneId)
    .map((t) => t.label);
  const copies: TokenItem[] = tokens.map((t) => {
    const label = numberedCopy(t.label, taken);
    taken.push(label);
    return {
      ...t,
      id: randomId(12),
      owner: s.me!.userId,
      label,
      x: t.x + step,
      y: t.y,
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
  const step = cellSpacing(scene.grid);
  const hex = isHex(scene.grid);
  const patches = selectedTokens(room)
    .filter((t) => room.canMoveItem(t))
    .map((t) => {
      const raw = { x: t.x + dx * step.x, y: t.y + dy * step.y };
      // Hex rows are staggered, so land on the nearest hex centre.
      const p = hex ? snapTokenCenter(raw, t.size, scene.grid) : raw;
      return { id: t.id, set: { x: p.x, y: p.y } };
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

// Putting a creature from the Monsters list on the map (GM): its token picture is found, or drawn
// and uploaded the first time, then it's placed like any picture token, sized by its D&D size and
// named after it (numbered when the scene already has one). "Add hidden" is remembered on the device.

import type { Point } from "../../shared/geometry";
import type { TokenItem } from "../../shared/types";
import type { RoomClient } from "../room/client";
import { monsterArtFile } from "./art";
import { TYPE_COLORS, findMonsterAsset, monsterLabel, monsterSquares } from "./monsters";
import type { MonsterIcon } from "./monsters";

/** What a creature dragged from the list carries: its id, and whether it's added hidden. */
export const MONSTER_DRAG_TYPE = "application/x-tabletop-monster";

export interface MonsterDrag {
  id: string;
  hidden: boolean;
}

/**
 * The drag data for a creature, carrying the Add hidden the GM sees on the list (another tab can
 * change the stored setting meanwhile, and a drop must do what a click there would).
 */
export function monsterDragData(id: string, hidden: boolean): string {
  return JSON.stringify({ id, hidden } satisfies MonsterDrag);
}

/** A creature's drag data read back, or null if it isn't one. */
export function readMonsterDrag(data: string | undefined): MonsterDrag | null {
  if (!data) return null;
  try {
    const v = JSON.parse(data) as Partial<MonsterDrag> | null;
    if (v && typeof v.id === "string" && v.id) return { id: v.id, hidden: v.hidden === true };
  } catch {
    // Not ours.
  }
  return null;
}

let icons: Promise<readonly MonsterIcon[]> | null = null;

/** The creatures, loaded the first time they're wanted (they're kept out of the main download). */
export function loadMonsters(): Promise<readonly MonsterIcon[]> {
  icons ??= import("./icons").then(
    (m) => m.MONSTER_ICONS,
    (err: unknown) => {
      // Try again next time (a dropped connection, or a deploy that replaced the file).
      icons = null;
      throw err;
    },
  );
  return icons;
}

export const HIDDEN_KEY = "tabletop-monsters-hidden";

/** The choice made on this page, for when the browser won't store it (a private window, say). */
let hiddenHere = false;

/** Whether creatures are added hidden from players on this device (remembered in the browser). */
export function loadAddHidden(): boolean {
  try {
    const v = localStorage.getItem(HIDDEN_KEY);
    return v === null ? hiddenHere : v === "1";
  } catch {
    return hiddenHere;
  }
}

export function saveAddHidden(on: boolean): void {
  hiddenHere = on;
  try {
    localStorage.setItem(HIDDEN_KEY, on ? "1" : "0");
  } catch {
    // No storage: it lasts as long as the page.
  }
}

/**
 * Token pictures being drawn and uploaded, by room and creature, so a second click waits for the
 * first. Only within this page: two tabs (or two GMs) using a creature for the first time at the
 * same moment each upload one. Both work, findMonsterAsset settles on the older one afterwards,
 * and the spare stays in the Tokens tab, where the GM can delete it.
 */
const making = new Map<string, Promise<string | null>>();

/** The id of a creature's token picture in this room, drawn and uploaded first if it hasn't one. */
function monsterAsset(room: RoomClient, m: MonsterIcon): Promise<string | null> {
  const have = findMonsterAsset(room.state.assets, m);
  if (have) return Promise.resolve(have.id);
  const key = `${room.roomId}|${m.id}`;
  let job = making.get(key);
  if (!job) {
    job = (async () => {
      try {
        const [asset] = await room.upload([await monsterArtFile(m)], "token");
        // A failed upload has already said why.
        return asset?.id ?? null;
      } catch (err) {
        room.toast(`${m.name}: ${(err as Error).message}`, "error");
        return null;
      } finally {
        making.delete(key);
      }
    })();
    making.set(key, job);
  }
  return job;
}

/**
 * GM: puts creature `id` on the scene in view, at `at` (where it was dropped) or in the middle
 * of the view, and selects it. The first of a creature in a room takes a moment (its picture is
 * uploaded); after that it's at once. If the GM moves to another scene meanwhile, it isn't
 * placed (`at` was on the old one): the picture is ready, so placing it again is at once.
 */
export async function placeMonster(
  room: RoomClient,
  id: string,
  at?: Point,
  hidden = loadAddHidden(),
): Promise<TokenItem | null> {
  if (!room.isGm) return null;
  // The scene it's meant for (and `at` is on).
  const sceneId = room.state.viewSceneId;
  const m = (await loadMonsters()).find((x) => x.id === id);
  if (!m) return null;
  const assetId = await monsterAsset(room, m);
  const scene = room.viewScene;
  if (!assetId || !scene) return null;
  if (scene.id !== sceneId) {
    room.toast(`${m.name} is ready. You moved to another scene, so place it again here.`);
    return null;
  }
  const taken = Object.values(room.state.items)
    .filter((i): i is TokenItem => i.kind === "token" && i.sceneId === scene.id)
    .map((t) => t.label);
  return room.addToken(
    { assetId, label: monsterLabel(m.name, taken), size: monsterSquares(m), color: TYPE_COLORS[m.type], hidden },
    at,
  );
}

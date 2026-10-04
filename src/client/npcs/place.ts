// Putting an NPC from the NPCs list on the map (GM): the token picture of its race + class is
// found, or drawn and uploaded the first time, then it's placed like any picture token, sized by
// its race's D&D size and named "<Race> <Class>" (numbered when the scene already has one).
// "Add hidden" is the Monsters list's, remembered on the device, so the two tabs agree.

import type { Point } from "../../shared/geometry";
import type { TokenItem } from "../../shared/types";
import { loadAddHidden } from "../monsters/place";
import type { RoomClient } from "../room/client";
import { npcArtFile } from "./art";
import { findClass, findNpcAsset, findRace, npcLabel, npcName, npcSquares } from "./npcs";
import type { NpcClass, NpcIcons, NpcRace } from "./npcs";

/** What an NPC dragged from the list carries: its race and class, and whether it's added hidden. */
export const NPC_DRAG_TYPE = "application/x-tabletop-npc";

export interface NpcDrag {
  raceId: string;
  classId: string;
  hidden: boolean;
}

/**
 * The drag data for an NPC, carrying the Add hidden the GM sees on the list (another tab can
 * change the stored setting meanwhile, and a drop must do what a click there would).
 */
export function npcDragData(raceId: string, classId: string, hidden: boolean): string {
  return JSON.stringify({ raceId, classId, hidden } satisfies NpcDrag);
}

/** An NPC's drag data read back, or null if it isn't one. */
export function readNpcDrag(data: string | undefined): NpcDrag | null {
  if (!data) return null;
  try {
    const v = JSON.parse(data) as Partial<NpcDrag> | null;
    if (v && typeof v.raceId === "string" && v.raceId && typeof v.classId === "string" && v.classId) {
      return { raceId: v.raceId, classId: v.classId, hidden: v.hidden === true };
    }
  } catch {
    // Not ours.
  }
  return null;
}

/** What the list, or a drop, says when the icons can't be loaded (the browser's own words for it aren't plain). */
export const NPCS_LOAD_FAILED = "Couldn't load the NPCs. Check the connection, then try again.";

let icons: Promise<NpcIcons> | null = null;

/** The head and emblem icons, loaded the first time they're wanted (they're kept out of the main download). */
export function loadNpcs(): Promise<NpcIcons> {
  icons ??= import("./icons").then(
    (m) => m.NPC_ICONS,
    (err: unknown) => {
      // Try again next time (a dropped connection, or a deploy that replaced the file).
      icons = null;
      throw err;
    },
  );
  return icons;
}

/**
 * Token pictures being drawn and uploaded, by room, race and class, so a second click waits for
 * the first. Only within this page: two tabs (or two GMs) using a pair for the first time at the
 * same moment each upload one. Both work, findNpcAsset settles on the older one afterwards, and
 * the spare stays in the Tokens tab, where the GM can delete it.
 */
const making = new Map<string, Promise<string | null>>();

/** The id of an NPC's token picture in this room, drawn and uploaded first if it hasn't one. */
function npcAsset(room: RoomClient, race: NpcRace, cls: NpcClass): Promise<string | null> {
  const have = findNpcAsset(room.state.assets, race, cls);
  if (have) return Promise.resolve(have.id);
  const key = `${room.roomId}|${race.id}|${cls.id}`;
  let job = making.get(key);
  if (!job) {
    job = (async () => {
      try {
        // A drop from another page of the room can come before this page has the icons.
        const icons = await loadNpcs().catch(() => null);
        if (!icons) {
          room.toast(NPCS_LOAD_FAILED, "error");
          return null;
        }
        const [asset] = await room.upload([await npcArtFile(race, cls, icons)], "token");
        // A failed upload has already said why.
        return asset?.id ?? null;
      } catch (err) {
        room.toast(`${npcName(race, cls)}: ${(err as Error).message}`, "error");
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
 * GM: puts an NPC of race `raceId` and class `classId` on the scene in view, at `at` (where it
 * was dropped) or in the middle of the view, and selects it. The first of a pair in a room takes
 * a moment (its picture is uploaded); after that it's at once. If the GM moves to another scene
 * meanwhile, it isn't placed (`at` was on the old one): the picture is ready, so placing it
 * again is at once.
 */
export async function placeNpc(
  room: RoomClient,
  raceId: string,
  classId: string,
  at?: Point,
  hidden = loadAddHidden(),
): Promise<TokenItem | null> {
  if (!room.isGm) return null;
  // The scene it's meant for (and `at` is on).
  const sceneId = room.state.viewSceneId;
  const race = findRace(raceId);
  const cls = findClass(classId);
  if (!race || !cls) return null;
  const assetId = await npcAsset(room, race, cls);
  const scene = room.viewScene;
  if (!assetId || !scene) return null;
  const name = npcName(race, cls);
  if (scene.id !== sceneId) {
    room.toast(`${name} is ready. You moved to another scene, so place it again here.`);
    return null;
  }
  const taken = Object.values(room.state.items)
    .filter((i): i is TokenItem => i.kind === "token" && i.sceneId === scene.id)
    .map((t) => t.label);
  return room.addToken({ assetId, label: npcLabel(name, taken), size: npcSquares(race), color: cls.color, hidden }, at);
}

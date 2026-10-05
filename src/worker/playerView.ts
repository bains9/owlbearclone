// What a connection is sent of the room's assets and scenes: kept apart from the Room so tests
// can check it without the Workers runtime. The GM gets everything; players and table displays
// get their own uploads and the live scene, and the live scene's Dungeondraft data only while
// it is in use (design 3.5: the sidecar holds what the picture shows).

import { GM_OWNER } from "../shared/sanitize";
import type { Asset, Player, Scene } from "../shared/types";

type Viewer = Pick<Player, "role" | "userId">;

/** Whether a connection may know of an asset: the GM all of them, anyone else only their own uploads. */
export function canSeeAsset(a: Pick<Asset, "owner">, c: Viewer): boolean {
  return c.role === "gm" || (a.owner !== GM_OWNER && a.owner === c.userId);
}

/**
 * The scene as players and displays get it. Dungeondraft data on hold (it didn't line up, or the
 * level was unclear) or paused (made for another picture) is left out: their devices don't use it
 * then (mapData.ts sceneDataState), and it may describe a level or a map the picture doesn't show.
 * When the GM puts it to use, the next scene update carries it.
 */
export function playerScene(s: Scene): Scene {
  const md = s.mapData;
  if (!md || (!md.hold && md.forAssetId === s.mapAssetId)) return s;
  const { mapData: _held, ...rest } = s;
  return rest;
}

/** The scene a connection is sent: the GM's as stored; anyone else's only when it is live, as playerScene gives it. */
export function sceneFor(s: Scene, c: Pick<Player, "role">, activeSceneId: string | null): Scene | null {
  if (c.role === "gm") return s;
  return s.id === activeSceneId ? playerScene(s) : null;
}

/** The scenes a hello carries: every one for the GM, the live one (if any) for anyone else. */
export function helloScenes(scenes: Iterable<Scene>, c: Pick<Player, "role">, activeSceneId: string | null): Scene[] {
  const out: Scene[] = [];
  for (const s of scenes) {
    const v = sceneFor(s, c, activeSceneId);
    if (v) out.push(v);
  }
  return out;
}

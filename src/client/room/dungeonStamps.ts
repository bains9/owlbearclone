// Dungeon's built-in objects (dungeon.parhome.ca) as Build tool objects: ids "d:<dungeon id>",
// drawn by Dungeon's own drawings (src/client/dungeonLib/, copied by
// scripts/sync-dungeon-library.mjs) into the unit square drawStamp promises, with the longer
// side filling it.

import type { DungeonStampId } from "../../shared/terrain";
import type { SeasonLook } from "../../shared/types";
import { prop } from "../dungeonLib/props";
import type { StampLook } from "./buildArt";

/** Whether a Dungeon object looks different in a season. */
export function dungeonHasSeasonalArt(_id: DungeonStampId, _look: SeasonLook): boolean {
  return false;
}

/** Draws a Dungeon object into the unit square centred on the origin, as drawStamp does. */
export function drawDungeonStamp(c: CanvasRenderingContext2D, id: DungeonStampId, _look: StampLook | null, _turns: number, _fine: number): void {
  const def = prop(id.slice(2));
  if (!def) return;
  const k = 1 / Math.max(def.w, def.h);
  c.save();
  c.lineJoin = "round";
  c.scale(k, k);
  def.draw(c);
  c.restore();
}

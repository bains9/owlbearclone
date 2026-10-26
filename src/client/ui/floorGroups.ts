// The Build tool's floors in the picker's groups: Tabletop's own first, then Dungeon's
// textures (dungeonTextures.ts) that each tool paints. No drawing here, so tests can check it.

import { FLOORS, type FloorId } from "../../shared/terrain";
import { TEXTURE_GROUPS, textureChoice, textureName } from "../room/dungeonTextures";
import type { TextureFloor } from "../room/client";
import { libraryCount, libraryGroupOf, searchLibrary, type LibraryGroup } from "./library";

/** A floor the picker offers: one of Tabletop's ("s", "g") or a texture ("t:meadow"). */
export type FloorChoice = FloorId | TextureFloor;
export type FloorTool = "building" | "terrain";

export const FLOOR_GROUPS: Record<FloorTool, LibraryGroup<FloorChoice>[]> = {
  building: [
    { name: "Tabletop", ids: FLOORS.filter((f) => f.walls).map((f) => f.id) },
    ...TEXTURE_GROUPS.building.map((g) => ({ name: g.name, ids: g.ids.map((id): FloorChoice => `t:${id}`) })),
  ],
  terrain: [
    { name: "Tabletop", ids: FLOORS.filter((f) => !f.walls).map((f) => f.id) },
    ...TEXTURE_GROUPS.terrain.map((g) => ({ name: g.name, ids: g.ids.map((id): FloorChoice => `t:${id}`) })),
  ],
};

export function floorCount(tool: FloorTool): number {
  return libraryCount(FLOOR_GROUPS[tool]);
}

export function floorName(id: FloorChoice): string {
  const texture = textureChoice(id);
  return texture ? textureName(texture) : (FLOORS.find((f) => f.id === id)?.name ?? id);
}

/** Whether a floor is one the tool offers (a texture from another tool's list isn't). */
export function isFloorFor(tool: FloorTool, id: unknown): id is FloorChoice {
  return typeof id === "string" && FLOOR_GROUPS[tool].some((g) => (g.ids as string[]).includes(id));
}

export function searchFloors(tool: FloorTool, query: string): FloorChoice[] {
  return searchLibrary(FLOOR_GROUPS[tool], floorName, query);
}

export function floorGroupOf(tool: FloorTool, id: FloorChoice): string {
  return libraryGroupOf(FLOOR_GROUPS[tool], id);
}

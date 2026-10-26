// The Build tool's objects in the picker's groups, and its search. No drawing here, so tests
// can check it.

import { STAMP_IDS, stampName, type StampId } from "../../shared/terrain";
import { DUNGEON_PROPS } from "../../shared/dungeonCatalog";
import { PROP_CATEGORIES } from "../dungeonLib/propkit";
import { libraryCount, libraryGroupOf, searchLibrary, type LibraryGroup } from "./library";

export type ObjectGroup = LibraryGroup<StampId>;

/** Tabletop's own sixteen first (they have seasonal drawings), then Dungeon's groups in its order. */
export const OBJECT_GROUPS: ObjectGroup[] = [
  { name: "Tabletop", ids: [...STAMP_IDS] },
  ...PROP_CATEGORIES.map((cat) => ({ name: cat, ids: DUNGEON_PROPS.filter((p) => p.category === cat).map((p) => `d:${p.id}` as StampId) })),
];

export const OBJECT_COUNT = libraryCount(OBJECT_GROUPS);

/** The objects whose name (or group) has every word of the search in it, in the groups' order. */
export function searchObjects(query: string): StampId[] {
  return searchLibrary(OBJECT_GROUPS, stampName, query);
}

export function groupOf(id: StampId): string {
  return libraryGroupOf(OBJECT_GROUPS, id);
}

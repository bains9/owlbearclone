// The Build tool's objects in the picker's groups, and its search. No drawing here, so tests
// can check it.

import { STAMP_IDS, stampName, type StampId } from "../../shared/terrain";
import { DUNGEON_PROPS } from "../../shared/dungeonCatalog";
import { PROP_CATEGORIES } from "../dungeonLib/propkit";
import { libraryCount, libraryGroupOf, searchLibrary, type LibraryGroup } from "./library";

export type ObjectGroup = LibraryGroup<StampId>;

/** One of Dungeon's categories, folding into its groups ("Tables", "Seating"...) in Dungeon's order. */
function category(cat: string): ObjectGroup {
  const props = DUNGEON_PROPS.filter((p) => p.category === cat);
  const parts = new Map<string, StampId[]>();
  for (const p of props) {
    if (!parts.has(p.group)) parts.set(p.group, []);
    parts.get(p.group)!.push(`d:${p.id}` as StampId);
  }
  // Listed group by group, so a search finds them in the order the folds show them.
  return { name: cat, ids: [...parts.values()].flat(), parts: [...parts].map(([name, ids]) => ({ name, ids })) };
}

/** Tabletop's own sixteen first (they have seasonal drawings), then Dungeon's categories in its order. */
export const OBJECT_GROUPS: ObjectGroup[] = [{ name: "Tabletop", ids: [...STAMP_IDS] }, ...PROP_CATEGORIES.map(category)];

export const OBJECT_COUNT = libraryCount(OBJECT_GROUPS);

/** The objects whose name (or group) has every word of the search in it, in the groups' order. */
export function searchObjects(query: string): StampId[] {
  return searchLibrary(OBJECT_GROUPS, stampName, query);
}

export function groupOf(id: StampId): string {
  return libraryGroupOf(OBJECT_GROUPS, id);
}

/**
 * The fold a Dungeon object is in, in the picker ("Leafy trees" in Nature): what the scatter
 * brush mixes. Null for Tabletop's own sixteen, which have no fold.
 */
export function foldOf(id: StampId): { name: string; ids: StampId[] } | null {
  for (const g of OBJECT_GROUPS) for (const p of g.parts ?? []) if (p.ids.includes(id)) return p;
  return null;
}

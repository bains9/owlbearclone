// The Build tool's objects in the picker's groups, and its search. No drawing here, so tests
// can check it.

import { STAMP_IDS, stampName, type StampId } from "../../shared/terrain";
import { DUNGEON_PROPS } from "../../shared/dungeonCatalog";
import { PROP_CATEGORIES } from "../dungeonLib/propkit";

export interface ObjectGroup {
  name: string;
  ids: StampId[];
}

/** Tabletop's own sixteen first (they have seasonal drawings), then Dungeon's groups in its order. */
export const OBJECT_GROUPS: ObjectGroup[] = [
  { name: "Tabletop", ids: [...STAMP_IDS] },
  ...PROP_CATEGORIES.map((cat) => ({ name: cat, ids: DUNGEON_PROPS.filter((p) => p.category === cat).map((p) => `d:${p.id}` as StampId) })),
];

export const OBJECT_COUNT = OBJECT_GROUPS.reduce((n, g) => n + g.ids.length, 0);

/** The objects whose name (or group) has every word of the search in it, in the groups' order. */
export function searchObjects(query: string): StampId[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: StampId[] = [];
  for (const g of OBJECT_GROUPS) {
    for (const id of g.ids) {
      const text = `${stampName(id)} ${g.name}`.toLowerCase();
      if (words.every((w) => text.includes(w))) out.push(id);
    }
  }
  return out;
}

export function groupOf(id: StampId): string {
  return OBJECT_GROUPS.find((g) => g.ids.includes(id))?.name ?? OBJECT_GROUPS[0].name;
}

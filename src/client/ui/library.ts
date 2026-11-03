// What the Build tool's pickers (objects, floors) have in common, with no drawing, so tests
// can check it: items in named groups, and a search over their names.

export interface LibraryGroup<T extends string> {
  name: string;
  ids: T[];
  /** The group's own folds, when it has them (Dungeon's "Tables" in Furniture): every id is in one. */
  parts?: { name: string; ids: T[] }[];
}

/** Search shows at most this many items at once; typing more narrows it. */
export const MAX_FOUND = 120;

export function libraryCount<T extends string>(groups: readonly LibraryGroup<T>[]): number {
  return groups.reduce((n, g) => n + g.ids.length, 0);
}

/** The items whose name (or group) has every word of the search in it, in the groups' order. */
export function searchLibrary<T extends string>(groups: readonly LibraryGroup<T>[], name: (id: T) => string, query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: T[] = [];
  for (const g of groups) {
    for (const id of g.ids) {
      const text = `${name(id)} ${g.name}`.toLowerCase();
      if (words.every((w) => text.includes(w))) out.push(id);
    }
  }
  return out;
}

/** The part of its group an item is in, or "" for a group without parts. */
export function libraryPartOf<T extends string>(groups: readonly LibraryGroup<T>[], id: T): string {
  for (const g of groups) for (const p of g.parts ?? []) if (p.ids.includes(id)) return p.name;
  return "";
}

/** The group an item is in (the first group for one that's in none). */
export function libraryGroupOf<T extends string>(groups: readonly LibraryGroup<T>[], id: T): string {
  return groups.find((g) => g.ids.includes(id))?.name ?? groups[0].name;
}

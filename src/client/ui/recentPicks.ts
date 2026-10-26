// What the GM picked last in the Build tool's pickers (objects; each tool's floors), newest
// first, kept in this browser.

/** Where each list is kept. */
export const RECENT_OBJECTS = "tabletop.recentObjects";
export const recentFloorsKey = (tool: "building" | "terrain") => `tabletop.recentFloors.${tool}`;
/** How many the bar shows, and keeps. */
export const RECENT_MAX = 6;

/** `id` moved to the front of `list`, without repeats, at most RECENT_MAX long. */
export function withRecent<T extends string>(list: readonly T[], id: T): T[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}

/** A kept list, with anything no longer offered (`valid`) left out. */
export function loadRecent<T extends string>(key: string, valid: (id: unknown) => id is T): T[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter(valid).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecent(key: string, list: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Private windows and full storage: the list just isn't remembered.
  }
}

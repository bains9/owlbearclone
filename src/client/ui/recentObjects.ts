// The objects the GM picked last in the Build tool, newest first, kept in this browser.

import { isStampId, type StampId } from "../../shared/terrain";

const KEY = "tabletop.recentObjects";
/** How many the Objects bar shows, and keeps. */
export const RECENT_MAX = 6;

/** `id` moved to the front of `list`, without repeats, at most RECENT_MAX long. */
export function withRecent(list: readonly StampId[], id: StampId): StampId[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}

export function loadRecent(): StampId[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter(isStampId).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: readonly StampId[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private windows and full storage: the list just isn't remembered.
  }
}

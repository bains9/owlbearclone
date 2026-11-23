// Moving between pages without reloading: when the GM sends everyone to another room, the
// page switches rooms in place, so the voice chat connection (room/voiceLink.ts) carries on.

/** Goes to another page of Tabletop without reloading (App listens for popstate). */
export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** A message for the next room page to show as it opens, and (GM) a scene of it to look at. */
export interface Arrival {
  text: string;
  sceneId?: string;
}

let arrival: Arrival | null = null;

/**
 * A message for the next room page to show as it opens ("The GM moved the game to …"); with
 * `sceneId`, the GM looks at that scene of it (tokens just moved there, say).
 */
export function noteArrival(text: string, sceneId?: string): void {
  arrival = { text, ...(sceneId ? { sceneId } : {}) };
}

export function takeArrival(): Arrival | null {
  const a = arrival;
  arrival = null;
  return a;
}

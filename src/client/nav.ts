// Moving between pages without reloading: when the GM sends everyone to another room, the
// page switches rooms in place, so the voice chat connection (room/voiceLink.ts) carries on.

/** Goes to another page of Tabletop without reloading (App listens for popstate). */
export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

let arrival: string | null = null;

/** A message for the next room page to show as it opens ("The GM moved the game to …"). */
export function noteArrival(text: string): void {
  arrival = text;
}

export function takeArrival(): string | null {
  const text = arrival;
  arrival = null;
  return text;
}

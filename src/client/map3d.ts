// The map in 3D (room/view3d.ts) on this device: whether it's offered (This device, under Change your
// name or colour: on to begin with, so every player has the 3D button; until 15 November 2026 it was
// off to begin with while it was new), and whether the map was last shown in 3D, so it opens that way
// again. A table display has no settings: its link says (?view=3d), and the GM's
// Table display dialog adds that to it.

const OFFER_KEY = "tabletop-map-3d";
const VIEW_KEY = "tabletop-map-3d-view";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Not remembered, but still applies until the page reloads.
  }
}

/** Whether this device offers the 3D view (a 3D button by the zoom buttons): yes, unless it was turned off here. */
export function loadMap3d(): boolean {
  try {
    return localStorage.getItem(OFFER_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveMap3d(on: boolean): void {
  try {
    localStorage.setItem(OFFER_KEY, on ? "1" : "0");
  } catch {
    // Not remembered, but still applies until the page reloads.
  }
}

/** Whether this device was last showing the map in 3D. */
export function loadView3d(): boolean {
  return read(VIEW_KEY);
}

export function saveView3d(on: boolean): void {
  write(VIEW_KEY, on);
}

/** Whether a table display's address asks for the map in 3D. */
export function displayWants3d(search: string): boolean {
  return new URLSearchParams(search).get("view") === "3d";
}

/** A table display's link, asking for the map in 3D or not. */
export function display3dLink(link: string, on: boolean): string {
  const u = new URL(link);
  if (on) u.searchParams.set("view", "3d");
  else u.searchParams.delete("view");
  return u.toString();
}

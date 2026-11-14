// Table and Dungeon (the map maker) link to each other, on a table that has a Dungeon. Each
// opens the other in a tab of its own, and once that tab is open, brings it forward rather than
// loading it again, so a room here (with voice chat), or a map being drawn there, carries on as
// it was. Dungeon has the same code the other way round (its src/ui/tableLink.ts).
//
// Where Dungeon is, is one of the table's own settings (shared/table.ts): the server says when
// the page asks who it is (the home page) and when it joins a room, and it's kept here for the
// links and the bridge (dungeonBridge.ts). A table without one shows no Dungeon button.
//
// Dungeon signs in with Table's GM sign-in (src/worker/dungeon.ts). Someone who isn't signed
// in yet is sent to the home page first, and taken on to Dungeon once they are.

let dungeon: string | null = null;

/** Where this table's Dungeon is ("https://dungeon.example.com/"), or null: it has none, or the server hasn't said yet. */
export function dungeonUrl(): string | null {
  return dungeon;
}

/** What the server said: Dungeon's address, or null for a table without one. */
export function setDungeonUrl(url: string | null): void {
  dungeon = url;
}

/** The names the two apps give each other's tabs when they open them. */
const DUNGEON_TAB = "dungeon";
const TABLE_TAB = "tabletop";

/**
 * Brings Dungeon's tab forward, or opens it. False when the browser wouldn't open a tab (or
 * this table has no Dungeon); the button is a link to Dungeon, so the caller lets the link do
 * it then.
 */
export function openDungeon(): boolean {
  const url = dungeon;
  if (!url) return false;
  // A tab Dungeon opened: Dungeon is the tab that opened it.
  const opener = window.name === TABLE_TAB && window.opener && !window.opener.closed ? (window.opener as Window) : null;
  const tab = opener ?? window.open("", DUNGEON_TAB);
  if (!tab) return false;
  let blank = false;
  try {
    blank = tab.location.href === "about:blank";
  } catch {
    // Another site's page, so Dungeon is open there already.
  }
  if (blank) {
    tab.location.replace(url);
    return true;
  }
  tab.focus();
  // A browser may refuse to bring another tab forward. If this one still has the focus, load
  // Dungeon afresh in its tab: it opens the map where it was saved.
  window.setTimeout(() => {
    if (document.hasFocus()) window.open(url, DUNGEON_TAB);
  }, 300);
  return true;
}

const NEXT_KEY = "tt-dungeon-next";
const NEXT_MS = 10 * 60_000;
// Kept here too, for a browser that won't keep it in sessionStorage. That one loses it on
// the way through Google sign-in, which only means staying on the home page afterwards.
let next: { to: string; until: number } | null = null;

/**
 * Where on Dungeon to go once signed in, when Dungeon sent this browser here to sign in
 * (/?then=dungeon&to=…). Read from the address once, which is then tidied, and kept for ten
 * minutes, so it survives the trip to Google and back.
 */
export function dungeonNext(): string | null {
  const params = new URLSearchParams(location.search);
  if (params.get("then") === "dungeon") {
    next = { to: params.get("to") ?? "/", until: Date.now() + NEXT_MS };
    try {
      sessionStorage.setItem(NEXT_KEY, JSON.stringify(next));
    } catch {
      // Kept in memory only.
    }
    params.delete("then");
    params.delete("to");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  }
  if (!next) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(NEXT_KEY) ?? "null") as { to?: unknown; until?: unknown } | null;
      if (saved && typeof saved.to === "string" && typeof saved.until === "number") next = { to: saved.to, until: saved.until };
    } catch {
      // Nothing saved.
    }
  }
  return next && next.until > Date.now() ? next.to : null;
}

/** Signed in now: on to Dungeon, back through the hop, which hands it a sign-in code. */
export function continueToDungeon(to: string): void {
  next = null;
  try {
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // Nothing to forget.
  }
  location.replace(`/api/dungeon/hop${to === "/" ? "" : `?to=${encodeURIComponent(to)}`}`);
}

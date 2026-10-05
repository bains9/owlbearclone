// What the board says over itself about the current scene's map: "Loading map…" (with a
// line about Baldr) while its picture downloads, "Couldn't load the map…" while it's tried
// again or once it's been given up on, and "Making the season…" in a corner while its
// seasonal look is made. Only the timing lives here, with no DOM, so it can be tested.

import type { ImageStatus } from "./images";

/** "Loading map…" waits this long, so a map the browser already has never flickers it. */
export const LOADING_DELAY_MS = 400;
/** "Making the season…" waits this long, so a quick bake never shows it. */
export const SEASON_DELAY_MS = 500;

/** The current scene's map on this device, as the board last saw it (kept in the room's state). */
export interface MapLoad {
  /** Its picture (null: no scene, or a scene without a map). */
  url: string | null;
  status: ImageStatus;
  /** The seasonal look being made for it, by key (null: none on its way, or seasons off here). */
  season: string | null;
}

export const NO_MAP_LOAD: MapLoad = { url: null, status: "ready", season: null };

export function sameMapLoad(a: MapLoad, b: MapLoad): boolean {
  return a.url === b.url && a.status === b.status && a.season === b.season;
}

/** A map picture's load, as the overlay follows it. */
export interface LoadTrack {
  url: string | null;
  status: ImageStatus;
  /** When it started loading: the overlay shows once LOADING_DELAY_MS have passed since. */
  since: number;
  /** Its Baldr line, an index into BALDR_LINES: -1 until "Loading map…" first shows (see withLine). */
  line: number;
}

export type Overlay = { kind: "hidden" } | { kind: "loading"; line: number } | { kind: "retrying" } | { kind: "failed" };

const HIDDEN: Overlay = { kind: "hidden" };

function onItsWay(s: ImageStatus): boolean {
  return s === "loading" || s === "retrying";
}

/**
 * The load followed on from `prev`, now the board reports `load`. A map that starts loading
 * (a new scene's, or one tried again after it was given up on) starts without a line: it
 * gets one from withLine when "Loading map…" first shows. If the overlay was already up, it
 * stays up rather than going away for the wait and coming back: switching from one loading
 * map to another, say.
 */
export function trackLoad(prev: LoadTrack | null, load: MapLoad, now: number): LoadTrack {
  const { url, status } = load;
  const line = prev?.line ?? -1;
  if (!url || status === "ready") {
    if (prev && prev.url === url && prev.status === "ready") return prev;
    return { url, status: "ready", since: now, line };
  }
  const same = prev !== null && prev.url === url;
  if (status === "failed") {
    if (same && prev.status === "failed") return prev;
    return { url, status, since: same ? prev.since : now, line };
  }
  if (same && onItsWay(prev.status)) return prev.status === status ? prev : { ...prev, status };
  const up = prev !== null && overlayAt(prev, now).kind !== "hidden";
  return { url, status, since: up ? now - LOADING_DELAY_MS : now, line: -1 };
}

/**
 * The load with its Baldr line, picked by `pick` the moment "Loading map…" first shows at
 * `now`. Picked then rather than when the load starts, so a map that arrives within the wait
 * (or one that only ever says it's trying again) uses up no line: the device's last line is
 * always the last one someone could read.
 */
export function withLine(t: LoadTrack | null, now: number, pick: () => number): LoadTrack | null {
  if (!t || t.line >= 0 || overlayAt(t, now).kind !== "loading") return t;
  return { ...t, line: pick() };
}

/** What the overlay shows at `now`. */
export function overlayAt(t: LoadTrack | null, now: number): Overlay {
  if (!t || !t.url) return HIDDEN;
  // A real problem shows at once, and without a joke.
  if (t.status === "failed") return { kind: "failed" };
  if (t.status === "ready" || now - t.since < LOADING_DELAY_MS) return HIDDEN;
  return t.status === "retrying" ? { kind: "retrying" } : { kind: "loading", line: t.line };
}

/** How long until the overlay changes by itself (its wait runs out), or null if it won't. */
export function overlayDue(t: LoadTrack | null, now: number): number | null {
  if (!t || !t.url || !onItsWay(t.status)) return null;
  const left = t.since + LOADING_DELAY_MS - now;
  return left > 0 ? left : null;
}

/** A seasonal look being made, as the corner note follows it. */
export interface SeasonTrack {
  key: string | null;
  /** When it was first wanted: the note shows once SEASON_DELAY_MS have passed since. */
  since: number;
}

export function trackSeason(prev: SeasonTrack | null, key: string | null, now: number): SeasonTrack {
  if (prev && prev.key === key) return prev;
  return { key, since: now };
}

/** Whether "Making the season…" shows at `now`. */
export function seasonNoteAt(t: SeasonTrack | null, now: number): boolean {
  return !!t && t.key !== null && now - t.since >= SEASON_DELAY_MS;
}

/** How long until the note shows by itself, or null if it won't. */
export function seasonNoteDue(t: SeasonTrack | null, now: number): number | null {
  if (!t || t.key === null) return null;
  const left = t.since + SEASON_DELAY_MS - now;
  return left > 0 ? left : null;
}

/**
 * Where the note goes, in px from the board's top, when it can't keep to its place in the
 * style sheet (null: it can). On a phone it's at the top, and a tool's options bar (top left,
 * as wide as the screen allows, and over the note) would hide it: it goes just below the bar
 * then, whatever the bar's height (it wraps). `bar` is the bar's top and height, null if none.
 */
export function seasonNoteTop(bar: { top: number; height: number } | null, narrow: boolean): number | null {
  return bar && narrow ? bar.top + bar.height + 8 : null;
}

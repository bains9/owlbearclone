// How wide Campaign notes are read wide (ui/notesWide.tsx): most of the screen, the map keeping the rest.

/** Screens at least this wide can read wide. */
export const WIDE_FROM = 900;
/** The map keeps at least this much beside the reader, and the reader is at least this wide. */
export const MAP_MIN = 320;
export const WIDE_MIN = 560;
/** Without a width dragged to, the reader takes this much of the screen (Obsidian's share on Vern's). */
export const WIDE_SHARE = 0.75;

/** The reader's width on a screen this wide: the one dragged to, or its share; never squeezing the map out. */
export function wideWidth(screen: number, dragged: number | null): number {
  const want = dragged ?? Math.round(screen * WIDE_SHARE);
  return Math.round(Math.min(Math.max(want, WIDE_MIN), screen - MAP_MIN));
}

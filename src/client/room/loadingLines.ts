// The line shown under "Loading map…" while a map picture downloads: one of the table's own
// lines, a different one each time, never the same one twice in a row on a device. The lines
// are one of the table's settings (shared/table.ts), not part of the code: a table that has
// set none shows "Loading map…" alone. Only which line comes next is worked out here.

const LAST_LINE_KEY = "tabletop-loading-line";

/**
 * A line (its index among `count`) chosen at random, never `last` (-1: none yet). Each of the
 * others is equally likely, so over many loads every line comes up. -1 when there are no lines.
 */
export function pickLine(last: number, count: number, random: () => number = Math.random): number {
  const pick = (n: number) => Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
  if (count < 1) return -1;
  if (count < 2) return 0;
  if (last < 0 || last >= count) return pick(count);
  // One of the other count - 1, skipping over the last one.
  const i = pick(count - 1);
  return i >= last ? i + 1 : i;
}

/** The line shown last on this device, while the page has no storage (a private window, say). */
let lastHere = -1;

/**
 * The next of the table's `count` lines for this device: never the one it showed last
 * (remembered in the browser). -1, and nothing remembered, when the table has no lines.
 */
export function nextLine(count: number, random: () => number = Math.random): number {
  if (count < 1) return -1;
  let last = lastHere;
  try {
    const stored = localStorage.getItem(LAST_LINE_KEY);
    if (stored !== null) last = Number(stored);
  } catch {
    // No storage: go by this page alone.
  }
  const line = pickLine(Number.isInteger(last) ? last : -1, count, random);
  lastHere = line;
  try {
    localStorage.setItem(LAST_LINE_KEY, String(line));
  } catch {
    // As above.
  }
  return line;
}

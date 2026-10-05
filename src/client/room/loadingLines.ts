// The lines shown under "Loading map…" while a map picture downloads: one about Baldr, a
// different one each time, never the same one twice in a row on a device. Approved by Par
// word for word, so they're kept exactly as written.

export const BALDR_LINES: readonly string[] = [
  "Baldr doesn't roll initiative. Initiative waits for Baldr.",
  "Baldr once rolled a natural 1. The die apologised and rolled again.",
  "Dragons hoard gold. Baldr hoards dragons.",
  "Baldr's armour class is \"no\".",
  "Baldr doesn't make saving throws. Saving throws are made against Baldr.",
  "When Baldr takes a long rest, the dungeon takes a short one.",
  "Mimics pretend to be chests. Around Baldr, chests pretend to be mimics.",
  "Beholders have ten eyestalks. Nine of them are watching for Baldr.",
  "Baldr failed a Stealth check on purpose once. The guards are still in therapy.",
  "Baldr's beard has a higher Strength score than your barbarian.",
  "Baldr doesn't get advantage. Advantage gets Baldr.",
  "Gelatinous cubes go around Baldr. They've heard about the beard.",
  "A lich hides its soul so Baldr can't find it. It isn't working.",
  "Baldr's tankard is a +3 weapon. The ale is +5.",
  "Baldr took the Lucky feat. Luck took the Baldr feat.",
  "Owlbears sleep with a night light, in case of Baldr.",
  "The DM doesn't hide behind the screen for secrecy. It's for safety from Baldr.",
  "Baldr doesn't need a map. The map needs Baldr. That's why it's loading.",
];

const LAST_LINE_KEY = "tabletop-baldr-line";

/**
 * A line (its index) chosen at random, never `last` (-1: none yet). Each of the others is
 * equally likely, so over many loads every line comes up.
 */
export function pickLine(last: number, random: () => number = Math.random, count = BALDR_LINES.length): number {
  const pick = (n: number) => Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
  if (count < 2) return 0;
  if (last < 0 || last >= count) return pick(count);
  // One of the other count - 1, skipping over the last one.
  const i = pick(count - 1);
  return i >= last ? i + 1 : i;
}

/** The line shown last on this device, while the page has no storage (a private window, say). */
let lastHere = -1;

/** The next line for this device: never the one it showed last (remembered in the browser). */
export function nextLine(random: () => number = Math.random): number {
  let last = lastHere;
  try {
    const stored = localStorage.getItem(LAST_LINE_KEY);
    if (stored !== null) last = Number(stored);
  } catch {
    // No storage: go by this page alone.
  }
  const line = pickLine(Number.isInteger(last) ? last : -1, random);
  lastHere = line;
  try {
    localStorage.setItem(LAST_LINE_KEY, String(line));
  } catch {
    // As above.
  }
  return line;
}

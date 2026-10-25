// The dice picked in the chat panel's dice tray before they're rolled together: how many of
// each die, kept within what one roll may hold (shared/dice.ts).

/** Picked dice: sides -> how many. */
export type Pool = Record<number, number>;

/** At most this many of one die, and of all of them, in one roll (as shared/dice.ts allows). */
export const MAX_OF_A_DIE = 100;
export const MAX_DICE = 200;

export function poolSize(pool: Pool): number {
  return Object.values(pool).reduce((n, c) => n + c, 0);
}

/** The pool with one die's count changed by delta (a count that reaches 0 drops out), within the limits. */
export function changeDie(pool: Pool, sides: number, delta: number): Pool {
  const now = pool[sides] ?? 0;
  const room = MAX_DICE - poolSize(pool);
  const next = Math.max(0, Math.min(MAX_OF_A_DIE, now + Math.min(delta, room)));
  const out = { ...pool };
  if (next > 0) out[sides] = next;
  else delete out[sides];
  return out;
}

/** Whether one more of this die fits. */
export function canAdd(pool: Pool, sides: number): boolean {
  return (pool[sides] ?? 0) < MAX_OF_A_DIE && poolSize(pool) < MAX_DICE;
}

/** Twice as many of every die (a critical hit), when that still fits. */
export function canDouble(pool: Pool): boolean {
  const counts = Object.values(pool);
  return counts.length > 0 && counts.every((c) => c * 2 <= MAX_OF_A_DIE) && poolSize(pool) * 2 <= MAX_DICE;
}

export function doubled(pool: Pool): Pool {
  if (!canDouble(pool)) return pool;
  return Object.fromEntries(Object.entries(pool).map(([s, c]) => [s, c * 2]));
}

/** The pool as a roll, smallest die first: "3d6+1d8" (empty for no dice). */
export function poolExpr(pool: Pool): string {
  return Object.keys(pool)
    .map(Number)
    .sort((a, b) => a - b)
    .map((s) => `${pool[s]}d${s}`)
    .join("+");
}

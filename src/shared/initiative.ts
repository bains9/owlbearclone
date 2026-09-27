import type { InitEntry, Initiative } from "./types";

/**
 * Changes to the initiative list are sent as operations, not whole lists, so two
 * people adding someone at the same moment both land.
 */
export type InitOp =
  | { op: "add"; entry: InitEntry }
  | { op: "update"; id: string; name?: string; value?: number }
  | { op: "remove"; id: string }
  /**
   * from: the entry whose turn is ending, as the sender saw it (null: someone they
   * can't see). A step whose "from" is out of date is ignored, so two people ending
   * the same turn at once don't skip the next combatant.
   */
  | { op: "step"; dir: 1 | -1; from?: string | null }
  | { op: "clear" };

/** Highest first; ties keep the order they're already in. */
export function sortInitiative(entries: InitEntry[]): InitEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.value - a.e.value || a.i - b.i)
    .map((x) => x.e);
}

/**
 * A new initiative state with `next` as its entries, keeping the turn on the same
 * combatant. A turn of -1 means "on someone you can't see" (players don't get
 * entries for hidden tokens) and stays -1 unless a turn is given.
 */
export function withEntries(init: Initiative, next: InitEntry[], turnId?: string, round = init.round): Initiative {
  const entries = sortInitiative(next);
  if (!turnId && init.turn < 0) return { entries, turn: -1, round };
  const id = turnId ?? init.entries[init.turn]?.id;
  const found = id ? entries.findIndex((e) => e.id === id) : -1;
  return { entries, turn: Math.max(0, found), round };
}

export function applyInitOp(init: Initiative, op: InitOp): Initiative {
  switch (op.op) {
    case "add":
      if (init.entries.some((e) => e.id === op.entry.id)) return init;
      return withEntries(init, [...init.entries, op.entry]);
    case "update": {
      if (!init.entries.some((e) => e.id === op.id)) return init;
      const entries = init.entries.map((e) =>
        e.id === op.id ? { ...e, ...(op.name !== undefined ? { name: op.name } : {}), ...(op.value !== undefined ? { value: op.value } : {}) } : e,
      );
      return withEntries(init, entries);
    }
    case "remove": {
      const idx = init.entries.findIndex((e) => e.id === op.id);
      if (idx < 0) return init;
      const entries = init.entries.filter((e) => e.id !== op.id);
      if (idx !== init.turn) return withEntries(init, entries);
      // The combatant whose turn it was is gone: the turn passes to whoever came next,
      // and past the end of the order that's the top of the next round.
      if (!entries.length) return { entries, turn: 0, round: init.round };
      if (idx >= entries.length) return { entries, turn: 0, round: init.round + 1 };
      return { entries, turn: idx, round: init.round };
    }
    case "step": {
      const n = init.entries.length;
      if (!n) return init;
      // -1: the turn is on someone you can't see; carry on from either end of your list.
      if (init.turn < 0) return { ...init, turn: op.dir > 0 ? 0 : n - 1 };
      let turn = init.turn + op.dir;
      let round = init.round;
      if (turn >= n) {
        turn = 0;
        round++;
      } else if (turn < 0) {
        turn = n - 1;
        round = Math.max(1, round - 1);
      }
      return { ...init, turn, round };
    }
    case "clear":
      return { entries: [], turn: 0, round: 1 };
  }
}

// How a roll's dice look in the chat: in the set they were rolled in (shared/diceSets.ts), a painted
// set's dice tumbling in while the roll is new, and Pearl's total in gold. Classic dice are in their
// roller's colour (the one beside their name), so whose roll it is shows at a glance. The highest and
// lowest rolls still stand out. Looks only: every set rolls exactly as any other.

import { PLAIN_DICE, diceClass, messageDice } from "../../shared/diceSets";
import type { ChatMessage, RollResult } from "../../shared/types";

/** How long after a roll arrives its painted dice tumble in (ms); older ones just shimmer. */
export const FRESH_MS = 10_000;

/** A roll's look: classes for its box (Pearl's gold total, the tumble while new) and for its dice. */
export function rollLook(m: Pick<ChatMessage, "dice" | "ts">, now = Date.now()): { box: string; dice: string; fresh: boolean } {
  const set = messageDice(m);
  const fresh = set !== PLAIN_DICE && now - m.ts < FRESH_MS;
  return { box: [set === "pearl" ? "pearl" : "", fresh ? "fresh" : ""].filter(Boolean).join(" "), dice: diceClass(set), fresh };
}

/** A die's outline in a 100 by 100 box, and where its number sits (per cent from the top). */
export interface DieShape {
  key: "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d2";
  /** The outline as a polygon's points; none for a coin (a circle). */
  points?: string;
  /** The same as a clip-path, for its paint. */
  clip: string;
  /** Lines on its face (a d20's middle triangle). */
  facets?: string;
  numY: number;
  /** Wider than tall: the percentile die, whose numbers go to 100. */
  wide?: true;
}

const poly = (points: string) => `polygon(${points
  .split(" ")
  .map((p) => p.split(",").map((n) => `${n}%`).join(" "))
  .join(", ")})`;

const SHAPES: Record<DieShape["key"], Omit<DieShape, "clip" | "wide">> = {
  d4: { key: "d4", points: "50,6 96,90 4,90", numY: 64 },
  d6: { key: "d6", points: "10,10 90,10 90,90 10,90", numY: 50 },
  d8: { key: "d8", points: "50,3 97,50 50,97 3,50", numY: 50 },
  // A kite with the V of its upper faces, so it isn't taken for a d8.
  d10: { key: "d10", points: "50,2 96,36 50,98 4,36", facets: "4,36 50,50 96,36", numY: 60 },
  d12: { key: "d12", points: "50,3 97,38 79,95 21,95 3,38", numY: 57 },
  d20: { key: "d20", points: "50,2 94,26 94,74 50,98 6,74 6,26", facets: "50,22 80,72 20,72 50,22", numY: 56 },
  d2: { key: "d2", numY: 50 },
};

/** The shape a die is drawn in, by its sides: as the real thing; null for one that has none (a d7, say). */
export function dieShape(sides: number | "F"): DieShape | null {
  const key = sides === "F" ? "d6" : sides === 3 ? "d4" : sides === 100 ? "d10" : (`d${sides}` as DieShape["key"]);
  const s = SHAPES[key as DieShape["key"]];
  if (!s) return null;
  return { ...s, clip: s.points ? poly(s.points) : "circle(46% at 50% 50%)", ...(sides === 100 ? { wide: true as const } : {}) };
}

/**
 * How a roll's total is outlined, as Roll20 outlines an inline roll: green when a die rolled its
 * highest face, red when one rolled a 1, blue when both did; null for neither (or no dice). A roll
 * to hit goes by the group's handbook instead (critOf: a natural 20 or 2 on the two d10).
 */
export function totalOutline(roll: Pick<RollResult, "terms">, handbookCrit: "hit" | "fail" | null = null): "hit" | "fail" | "both" | null {
  if (handbookCrit) return handbookCrit;
  let high = false;
  let low = false;
  for (const t of roll.terms) {
    if (t.kind !== "dice") continue;
    for (const d of t.rolls) {
      if (d.dropped) continue;
      if (t.sides === "F") {
        high ||= d.v > 0;
        low ||= d.v < 0;
      } else if (t.sides > 1) {
        high ||= d.v === t.sides;
        low ||= d.v === 1;
      }
    }
  }
  return high && low ? "both" : high ? "hit" : low ? "fail" : null;
}

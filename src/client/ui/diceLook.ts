// How a roll's dice look in the chat: in the set they were rolled in (shared/diceSets.ts), a painted
// set's dice tumbling in while the roll is new, and Pearl's total in gold. Classic dice are in their
// roller's colour (the one beside their name), so whose roll it is shows at a glance. The highest and
// lowest rolls still stand out. Looks only: every set rolls exactly as any other.

import { PLAIN_DICE, diceClass, messageDice } from "../../shared/diceSets";
import type { ChatMessage } from "../../shared/types";

/** How long after a roll arrives its painted dice tumble in (ms); older ones just shimmer. */
export const FRESH_MS = 10_000;

/** A roll's look: classes for its box (Pearl's gold total, the tumble while new) and for its dice. */
export function rollLook(m: Pick<ChatMessage, "dice" | "ts">, now = Date.now()): { box: string; dice: string; fresh: boolean } {
  const set = messageDice(m);
  const fresh = set !== PLAIN_DICE && now - m.ts < FRESH_MS;
  return { box: [set === "pearl" ? "pearl" : "", fresh ? "fresh" : ""].filter(Boolean).join(" "), dice: diceClass(set), fresh };
}

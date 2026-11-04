// How a roll's dice look in the chat. Every die is in its roller's colour (the one beside their
// name), so whose roll it is shows at a glance; the highest and lowest rolls still stand out.
// Malspar's dice are pearl with gold numbers, a shimmer, and a tumble as the roll arrives: the
// developer's own dice, for looks only. They roll exactly as anyone's do.

import { characterLabel, type CharactersReply } from "../../shared/characters";
import type { ChatMessage } from "../../shared/types";

/** The character whose dice are pearl. */
export const PEARL_CHARACTER = "Malspar";
/** How long after a roll arrives its pearl dice tumble in (ms); older ones just shimmer. */
export const PEARL_FRESH_MS = 10_000;

/**
 * Whether a roll is Malspar's: rolled from his card (its label starts with his name), or by a
 * player who plays him. The GM's own rolls count only from his card, so the GM's creatures keep
 * plain dice.
 */
export function isPearlRoll(m: Pick<ChatMessage, "kind" | "text" | "userId" | "role">, party: Pick<CharactersReply, "characters"> | null | undefined): boolean {
  if (m.kind !== "roll") return false;
  if (m.text.startsWith(`${PEARL_CHARACTER}:`)) return true;
  if (m.role === "gm") return false;
  return !!party?.characters.some((c) => characterLabel(c) === PEARL_CHARACTER && c.players?.some((p) => p.userId === m.userId));
}

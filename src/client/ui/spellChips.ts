// How the Spells bar names a spell left on the map.

import type { DrawingItem, Item } from "../../shared/types";

/**
 * A spell's name, and the token it's on ("Faerie Fire on Goblin") or that its token is gone, and
 * the rounds it has left if it lasts so many.
 */
export function spellChipLabel(d: DrawingItem, items: Readonly<Record<string, Item>>): string {
  const name = d.spell ?? "Spell";
  return `${spellOn(name, d, items)}${roundsLeft(d)}`;
}

function spellOn(name: string, d: DrawingItem, items: Readonly<Record<string, Item>>): string {
  if (!d.on) return name;
  const t = items[d.on];
  if (t?.kind !== "token" || t.sceneId !== d.sceneId) return `${name} (its token is gone)`;
  return t.label ? `${name} on ${t.label}` : name;
}

/** " · 3 rounds" for a spell that lasts so many, "" for one that lasts until it's ended. */
export function roundsLeft(d: Pick<DrawingItem, "rounds">): string {
  return d.rounds ? ` · ${d.rounds} round${d.rounds === 1 ? "" : "s"}` : "";
}

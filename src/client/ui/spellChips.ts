// How the Spells bar names a spell left on the map.

import type { DrawingItem, Item } from "../../shared/types";

/** A spell's name, and the token it's on ("Faerie Fire on Goblin"), or that its token is gone. */
export function spellChipLabel(d: DrawingItem, items: Readonly<Record<string, Item>>): string {
  const name = d.spell ?? "Spell";
  if (!d.on) return name;
  const t = items[d.on];
  if (t?.kind !== "token" || t.sceneId !== d.sceneId) return `${name} (its token is gone)`;
  return t.label ? `${name} on ${t.label}` : name;
}

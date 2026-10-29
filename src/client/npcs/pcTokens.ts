// A character from their sheet, in Table's races and classes (the group's handbook, as the NPC
// lists have them): their race (for humans, their culture), their classes, and their figure.

import type { Character } from "../../shared/characters";
import type { NpcClass, NpcRace } from "./npcs";
import { figureFor } from "./pcArt";
import { NPC_CLASSES, NPC_RACES, PC_FIGURE_CHOICES } from "./table";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A race the lists don't have: a plain human head, in a plain tint. */
const SOMEONE: NpcRace = { id: "someone", name: "Someone", group: "Humans", size: "medium", icon: "delapouite_character", tint: "#e8d3b8" };

/** Their race in the lists: a human's culture (Wyddin, Danae...), else the race itself. */
export function raceOf(c: Pick<Character, "race" | "culture">): NpcRace {
  const name = same(c.race, "human") && c.culture ? c.culture : c.race;
  return NPC_RACES.find((r) => same(r.name, name) || same(r.id, name)) ?? SOMEONE;
}

/** Their classes in the lists, the first first (a fighter's when the sheet's isn't there). */
export function classesOf(c: Pick<Character, "cls" | "cls2">): NpcClass[] {
  const find = (name: string) => (name ? NPC_CLASSES.find((k) => same(k.name, name) || same(k.id, name)) : undefined);
  const found = [find(c.cls), find(c.cls2)].filter((k): k is NpcClass => !!k);
  return found.length ? found : [NPC_CLASSES.find((k) => k.id === "fighter")!];
}

/** Their figure: the one the GM chose for them, else their first class's (or its subclass's when that has its own). */
export function figureOf(c: Pick<Character, "cls" | "cls2" | "subclass" | "figure">): string {
  return c.figure && PC_FIGURE_CHOICES.some((f) => f.icon === c.figure) ? c.figure : classFigureOf(c);
}

/** Their class's figure, what they have unless the GM chooses another. */
export function classFigureOf(c: Pick<Character, "cls" | "cls2" | "subclass">): string {
  return figureFor(classesOf(c)[0], c.subclass);
}

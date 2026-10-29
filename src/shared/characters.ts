// The party's characters, read from their character sheets (the group's own Player's Handbook
// sheet, one Google Sheet per character) by a small Apps Script of the GM's
// (scripts/character-sheets.gs) and passed on by the Worker (worker/characters.ts): what Table
// shows on a character's token and card, and rolls from. Read-only: the sheet stays the one place
// a character is kept.

import { secureRng } from "./dice";

/** One of a character's attacks, as the sheet words it. */
export interface CharacterAttack {
  weapon: string;
  /** Dice, as "1d8". */
  damage: string;
  range: string;
  /** As the sheet has it: "+1", "0 missile", "+1 · thrown 0". */
  toHit: string;
  /** As the sheet has it: "dmg +2", "no STR bonus". */
  bonus: string;
}

export interface Character {
  /** The sheet's id (its Google Sheets id). */
  id: string;
  /** "Testa Brightwood". */
  name: string;
  /** Who plays them ("" when the sheet doesn't say). */
  player: string;
  race: string;
  /** For humans, their culture (Wyddin, Danae...), which is their race in Table's lists. */
  culture: string;
  cls: string;
  subclass: string;
  /** A second class, when they have one. */
  cls2: string;
  subclass2: string;
  /** The sheet's one-line summary: "Human (Wyddin) • Level 4 Ranger — Bushmaster / Level 5 Shaman". */
  summary: string;
  hp: number | null;
  maxHp: number | null;
  /** "5", and with a shield on the attack's side, "7". */
  ac: string;
  acShield: string;
  /** Added to the initiative roll. */
  init: number | null;
  /** Spell points, for casters (null for the rest). */
  sp: number | null;
  maxSp: number | null;
  attacks: CharacterAttack[];
  /** The sheet itself, to open. */
  url: string;
  /** The version of the token picture the GM chose for them, when there is one (else their figure is drawn). */
  picture?: string;
}

/** What the Worker answers for the party. */
export interface CharactersReply {
  /** Whether the GM has set up the character sheets (Room settings › Character sheets). */
  configured: boolean;
  characters: Character[];
  /** When the sheets were read (ms). */
  readAt: number;
  /** Why they couldn't be read just now, in plain words. */
  error?: string;
}

const SHEET_ID = /^[A-Za-z0-9_-]{20,80}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => {
  const m = typeof v === "number" ? String(v) : typeof v === "string" ? v.replace(/,/g, "").match(/^\s*([+-]?\d+(\.\d+)?)/)?.[1] : undefined;
  if (m === undefined) return null;
  const n = Number(m);
  return Number.isFinite(n) && Math.abs(n) < 100000 ? n : null;
};
/** A bonus as the dice take it: a whole number, and not a silly one (a sheet's typo of +99999). */
const bonus = (n: number) => Math.max(-100, Math.min(100, Math.round(n))) || 0;

/** A character as the script sent it, made safe and plain; null when it isn't one. */
export function cleanCharacter(raw: unknown): Character | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  if (!SHEET_ID.test(id)) return null;
  const name = text(r.name, 80);
  if (!name) return null;
  const init = num(r.init);
  const attacks =(Array.isArray(r.attacks) ? r.attacks : [])
    .slice(0, 12)
    .map((a) => {
      const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      return { weapon: text(x.weapon, 60), damage: text(x.damage, 30), range: text(x.range, 30), toHit: text(x.toHit, 40), bonus: text(x.bonus, 60) };
    })
    .filter((a) => a.weapon);
  return {
    id,
    name,
    player: text(r.player, 40),
    race: text(r.race, 40),
    culture: text(r.culture, 40),
    cls: text(r.cls, 40),
    subclass: text(r.subclass, 40),
    cls2: text(r.cls2, 40),
    subclass2: text(r.subclass2, 40),
    summary: text(r.summary, 160),
    hp: num(r.hp),
    maxHp: num(r.maxHp),
    ac: text(r.ac, 10),
    acShield: text(r.acShield, 10),
    init: init === null ? null : bonus(init),
    sp: num(r.sp),
    maxSp: num(r.maxSp),
    attacks,
    // Made from the id, so a card only ever opens that character's own sheet.
    url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
  };
}

/** A token's label for a character: their first name. */
export function characterLabel(c: Pick<Character, "name">): string {
  return c.name.split(/\s+/)[0] ?? c.name;
}

/**
 * The to-hit modifier a sheet's "To-hit" cell gives (its first number: "+1 · thrown 0" is +1,
 * "0 missile" is 0), and the damage bonus its last column gives ("dmg +2" is +2; "no STR bonus" 0).
 */
export function attackModifiers(a: Pick<CharacterAttack, "toHit" | "bonus">): { toHit: number; damage: number } {
  const first = (s: string) => bonus(Number(s.match(/[+-]?\d+/)?.[0] ?? 0));
  const dmg = a.bonus.match(/dmg\s*([+-]\s*\d+)/i)?.[1]?.replace(/\s+/g, "");
  return { toHit: first(a.toHit), damage: dmg ? bonus(Number(dmg)) : 0 };
}

/** A token's initiative as it's added to the list: a d20 and the sheet's bonus for a character, 0 for others. */
export function initiativeRoll(c: Pick<Character, "init"> | null): number {
  return c && c.init !== null ? secureRng(20) + 1 + c.init : 0;
}

/** The chat keeps a roll's label to 60 characters. */
const LABEL_MAX = 60;

/** An attack roll's label, "Testa: Longbow to hit": a long weapon's name is shortened rather than "to hit". */
export function attackLabel(who: string, weapon: string, what: "to hit" | "damage"): string {
  const room = LABEL_MAX - `${who}:  ${what}`.length;
  const name = weapon.length > room ? `${weapon.slice(0, Math.max(1, room - 1)).trimEnd()}…` : weapon;
  return `${who}: ${name} ${what}`.slice(0, LABEL_MAX);
}

/** The die rolled to hit, by the group's handbook (as Table reads it). */
export const TO_HIT_DIE = "1d20";

/** A dice expression with a modifier: "1d20+1", "1d6+2", "1d8". */
export function withModifier(dice: string, mod: number): string {
  return mod > 0 ? `${dice}+${mod}` : mod < 0 ? `${dice}${mod}` : dice;
}

/** A character's damage dice, when the sheet's cell is dice ("1d8", "2d6"); null otherwise. */
export function damageDice(a: Pick<CharacterAttack, "damage">): string | null {
  const m = a.damage.replace(/\s+/g, "").match(/^(\d{0,2})d(\d{1,3})$/i);
  return m ? `${m[1] || "1"}d${m[2]}` : null;
}

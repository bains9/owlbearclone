// The party's characters, read from their character sheets (the group's own Player's Handbook
// sheet, one Google Sheet per character) by a small Apps Script of the GM's
// (scripts/character-sheets.gs) and passed on by the Worker (worker/characters.ts): what Table
// shows on a character's token and card, and rolls from. Read-only: the sheet stays the one place
// a character is kept.

import { secureRng } from "./dice";
import type { ChatMessage } from "./types";

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
  /** A rogue's Sneak Attack rank, from the sheet's skills (null for anyone without it): its d6s on a sneak attack. */
  sneakRank?: number | null;
  /** Their STR damage bonus, the sheet's "Melee damage" (null when it isn't there). */
  strBonus?: number | null;
  /**
   * The ranged weapons (by the sheet's name for them) the GM marked as matched to their strength,
   * which add their STR bonus to damage like a melee weapon (kept by the Worker, for every room).
   */
  strMatched?: string[];
  /** The sheet itself, to open. */
  url: string;
  /** The version of the token picture the GM chose for them, when there is one (else their figure is drawn). */
  picture?: string;
  /** The figure the GM chose for them (an icon of PC_FIGURE_CHOICES), when it isn't their class's. */
  figure?: string;
  /**
   * The browsers playing them, with the name each joined under: picked by the player in the Party
   * list, or by the GM (kept by the Worker, for every room). Per-player sight sees through them.
   */
  players?: CharacterPlayer[];
  /** Their spells, as their sheet's Spells tab lists them (missing from scripts before version 4). */
  spells?: CharacterSpell[];
  /**
   * The spells prayed for (or memorised) today, chosen in Table by their player or the GM: how
   * many casts each has left, by the sheet's name for it (kept by the Worker, for every room).
   */
  prayed?: Record<string, number>;
}

/** One of a character's spells, as their sheet's Spells tab has it. */
export interface CharacterSpell {
  /** As the sheet names it: "Light (R)", "Detect Magic (1)". */
  name: string;
  /** 0 for a cantrip; null when the sheet doesn't say. */
  level: number | null;
  /** Spell points as the sheet words them: "2", "2+" (it can take more), "7/day" (a cantrip). */
  sp: string;
  /** How it's had: "Free", "Freecast", "Pray", "Memorize", "Ask DM", or "" (a mage's own). */
  prayer: string;
  /** The sheet's note on it, such as "Level 4: not castable yet". */
  note: string;
}

/** How many casts of one spell can be prayed for in a day, and how many spells a character can have prayed for. */
export const MAX_PRAYED = 9;
export const MAX_PRAYED_SPELLS = 60;

export interface CharacterPlayer {
  userId: string;
  name: string;
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

/**
 * Nightvision, as the group's handbook has it: black-and-white sight by moon or starlight (not in
 * total darkness, like underground), to 100 m for the elves (Nyloran, Sylvan, Duga) and to 50 m
 * for half-elves (partial nightvision). Dwerv, Gnome and Human have none.
 */
export const NIGHTVISION_M = 100;
export const PARTIAL_NIGHTVISION_M = 50;

/** How far a character's nightvision reaches, in metres (0 for none), from their sheet's race (and culture). */
export function nightvisionOf(c: Pick<Character, "race" | "culture"> | null | undefined): number {
  if (!c) return 0;
  const names = [c.race, c.culture].map((s) => (s ?? "").toLowerCase().replace(/[^a-z]/g, ""));
  if (names.some((n) => n.includes("halfel"))) return PARTIAL_NIGHTVISION_M;
  if (names.some((n) => /nylor|sylvan|duga|elf/.test(n))) return NIGHTVISION_M;
  return 0;
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
  const rank = num(r.sneakRank);
  const str = num(r.strBonus);
  const attacks =(Array.isArray(r.attacks) ? r.attacks : [])
    .slice(0, 12)
    .map((a) => {
      const x = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      return { weapon: text(x.weapon, 60), damage: text(x.damage, 30), range: text(x.range, 30), toHit: text(x.toHit, 40), bonus: text(x.bonus, 60) };
    })
    .filter((a) => a.weapon);
  const spells = Array.isArray(r.spells)
    ? r.spells
        .slice(0, 400)
        .map((s) => {
          const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
          const level = num(x.level);
          return {
            name: text(x.name, 60),
            level: level === null ? null : Math.max(0, Math.min(9, Math.round(level))),
            sp: text(x.sp, 12),
            prayer: text(x.prayer, 16),
            note: text(x.note, 160),
          };
        })
        .filter((s) => s.name)
    : null;
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
    sneakRank: rank !== null && rank >= 1 ? Math.min(20, Math.round(rank)) : null,
    strBonus: str === null ? null : bonus(str),
    // Made from the id, so a card only ever opens that character's own sheet.
    url: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    ...(spells ? { spells } : {}),
  };
}

/** A spell's name as something to pray for: what the sheet calls it, trimmed and not silly. */
export function isSpellName(v: unknown): v is string {
  return typeof v === "string" && v.trim() === v && v.length >= 1 && v.length <= 60 && !/[\u0000-\u001f\u007f]/.test(v);
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

/** A token's initiative as it's added to the list: a d10 (INITIATIVE_DIE) and the sheet's bonus for a character, 0 for others. */
export function initiativeRoll(c: Pick<Character, "init"> | null): number {
  return c && c.init !== null ? secureRng(10) + 1 + c.init : 0;
}

/** The chat keeps a roll's label to 60 characters. */
const LABEL_MAX = 60;

/** What an attack roll is for, the end of its label. */
export type AttackRollKind = "to hit" | "damage" | "crit damage" | "sneak damage" | "crit sneak damage";
/** The damage rolls among them: the ones that come after a hit. */
export const DAMAGE_ROLLS: readonly AttackRollKind[] = ["damage", "crit damage", "sneak damage", "crit sneak damage"];

/** An attack roll's label, "Testa: Longbow to hit": a long weapon's name is shortened rather than "to hit". */
export function attackLabel(who: string, weapon: string, what: AttackRollKind): string {
  const room = LABEL_MAX - `${who}:  ${what}`.length;
  const name = weapon.length > room ? `${weapon.slice(0, Math.max(1, room - 1)).trimEnd()}…` : weapon;
  return `${who}: ${name} ${what}`.slice(0, LABEL_MAX);
}

/**
 * The dice rolled to hit, by the group's handbook: two d10, with the sheet's to-hit added (its
 * DEX bonus for a weapon the character is proficient with, and the rest the sheet works out).
 */
export const TO_HIT_DIE = "2d10";

/** The die rolled for initiative, by the group's handbook: one d10, with the sheet's initiative bonus (its INT bonus) added. */
export const INITIATIVE_DIE = "1d10";

/** A dice expression with a modifier: "2d10+1", "1d6+2", "1d8". */
export function withModifier(dice: string, mod: number): string {
  return mod > 0 ? `${dice}+${mod}` : mod < 0 ? `${dice}${mod}` : dice;
}

/** A character's damage dice, when the sheet's cell is dice ("1d8", "2d6"); null otherwise. */
export function damageDice(a: Pick<CharacterAttack, "damage">): string | null {
  const m = a.damage.replace(/\s+/g, "").match(/^(\d{0,2})d(\d{1,3})$/i);
  return m ? `${m[1] || "1"}d${m[2]}` : null;
}

/**
 * A critical hit's damage, by the group's handbook: the weapon's damage with its dice's most added
 * again, bonuses not doubled ("1d8" and dmg +2: 1d8+10; "2d6": 2d6+12); null when the sheet's
 * damage isn't dice.
 */
export function critDamage(a: Pick<CharacterAttack, "damage" | "bonus">): string | null {
  const dice = damageDice(a);
  return dice ? damageRoll({ dice, damage: attackModifiers({ toHit: "", bonus: a.bonus }).damage, sneak: null }, { crit: true }) : null;
}

/**
 * One way to use an attack on the card: the weapon itself, and for one the sheet gives a thrown
 * to-hit too ("+3 · thrown +2"), thrown. `sneak` is a rogue's sneak attack dice for it, as the
 * sheet works them out in the last column ("sneak 4d6", "sneak 4d6 / 3d6 thrown"; a ranged
 * weapon's already one fewer), else null.
 */
export interface AttackWay {
  name: string;
  /** The sheet's name for the weapon (a thrown way's too). */
  weapon: string;
  /** What the sheet says of it (range, to-hit, bonus), for a tooltip. */
  detail: string;
  toHit: number;
  /** Its damage dice ("1d8"), or null when the sheet's damage isn't dice. */
  dice: string | null;
  /** Its damage bonus: the sheet's, and the STR bonus for a ranged weapon matched to their strength. */
  damage: number;
  sneak: string | null;
  /** A missile weapon (bow, crossbow): one that can be matched to their strength. */
  ranged: boolean;
  /** A ranged weapon the GM marked as matched to their strength (its damage has their STR bonus). */
  strMatched: boolean;
}

/** What else of a character's goes into their attacks. */
export interface AttackOptions {
  /** Their Sneak Attack rank (Character.sneakRank). */
  sneakRank?: number | null;
  /** Their STR damage bonus (Character.strBonus). */
  strBonus?: number | null;
  /** Their ranged weapons matched to their strength (Character.strMatched). */
  strMatched?: readonly string[];
}

/**
 * A character's ways of attacking with a weapon. With their Sneak Attack rank (`sneakRank`, from
 * their skills), a sneak attack is that many d6 in melee and one fewer at range (a missile weapon,
 * or one thrown), by the handbook (p75; the DM: always d6). Without it, the sheet's own words for
 * the weapon are used. A ranged weapon matched to their strength adds their STR bonus to damage
 * (the sheet gives a melee weapon's itself).
 */
export function attackWays(a: CharacterAttack, o: AttackOptions = {}): AttackWay[] {
  const { sneakRank = null } = o;
  const mods = attackModifiers(a);
  const dice = damageDice(a);
  const s = a.bonus.match(/sneak(?:\s+attack)?\s*(\d{1,2})d(\d{1,3})(?:\s*\/\s*(\d{1,2})d(\d{1,3})\s*thrown)?/i);
  const d6 = (n: number) => (n >= 1 ? `${n}d6` : null);
  const ranged = /missile/i.test(a.toHit);
  const strMatched = ranged && !!o.strMatched?.includes(a.weapon);
  const damage = mods.damage + (strMatched ? (o.strBonus ?? 0) : 0);
  const sneak = sneakRank ? d6(ranged ? sneakRank - 1 : sneakRank) : s ? `${s[1]}d${s[2]}` : null;
  const detail = [a.range && `Range ${a.range}`, a.toHit && `To hit ${a.toHit}`, a.bonus].filter(Boolean).join(" · ");
  const ways: AttackWay[] = [{ name: a.weapon, weapon: a.weapon, detail, toHit: mods.toHit, dice, damage, sneak, ranged, strMatched }];
  const thrown = a.toHit.match(/thrown\s*([+-]?\d+)/i);
  if (thrown) {
    // Thrown is ranged: one die fewer (the sheet's own thrown sneak attack, when there's no rank).
    const thrownSneak = sneakRank ? d6(sneakRank - 1) : s?.[3] ? `${s[3]}d${s[4]}` : s ? d6(Number(s[1]) - 1) : null;
    ways.push({ name: `${a.weapon}, thrown`, weapon: a.weapon, detail, toHit: bonus(Number(thrown[1])), dice, damage: mods.damage, sneak: thrownSneak, ranged: false, strMatched: false });
  }
  return ways;
}

/**
 * The damage roll for a way of attacking: its dice and bonus, with the sneak attack dice when
 * `sneak` (and it has them), and on a crit the most its own dice can roll added again (not the
 * sneak attack's, nor the bonus). Null when its damage isn't dice.
 */
export function damageRoll(w: Pick<AttackWay, "dice" | "damage" | "sneak">, opts: { crit?: boolean; sneak?: boolean } = {}): string | null {
  if (!w.dice) return null;
  const [count, sides] = w.dice.split("d").map(Number);
  const dice = opts.sneak && w.sneak ? `${w.dice}+${w.sneak}` : w.dice;
  return withModifier(dice, w.damage + (opts.crit ? count * sides : 0));
}

/**
 * What a to-hit roll in the chat came to, by the group's handbook: a natural 20 on the two d10 (both
 * tens) is a critical hit, a natural 2 (both ones) a critical failure. A to-hit roll is one whose
 * label ends "to hit" (attackLabel) and whose first dice are two d10; anything else is null.
 */
export function critOf(m: Pick<ChatMessage, "kind" | "text" | "roll">): "hit" | "fail" | null {
  const first = m.roll?.terms[0];
  if (m.kind !== "roll" || !/ to hit$/.test(m.text) || first?.kind !== "dice" || first.sign !== 1 || first.count !== 2 || first.sides !== 10) return null;
  if (first.rolls.length !== 2 || first.rolls.some((d) => d.dropped)) return null;
  const natural = first.rolls[0].v + first.rolls[1].v;
  return natural === 20 ? "hit" : natural === 2 ? "fail" : null;
}

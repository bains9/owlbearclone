// A monster's or NPC's stats, entered by hand on its token by the GM (ui/MonsterCard.tsx): HP, AC,
// initiative and attacks, the same things a character's sheet gives its card. They're the GM's
// alone: kept apart from the token (worker/room.ts), so they never reach a player's browser. Attacks
// roll as characters' do, by the group's handbook: two d10 to hit (TO_HIT_DIE), both tens a critical
// hit, both ones a critical failure.
import { damageDice, damageRoll, withModifier } from "./characters";

export interface MonsterAttack {
  name: string;
  /** Added to the two d10. */
  toHit: number;
  /** Its dice ("1d8"), or "" for none: an attack with no damage to roll. */
  dice: string;
  /** Added to the damage dice. */
  damage: number;
}

export interface TokenStats {
  hp: number;
  maxHp: number;
  /** As the GM writes it: "15", or "5 (9 with shield)". */
  ac: string;
  /** Added to the d10 for initiative. */
  init: number;
  attacks: MonsterAttack[];
}

export const STATS_LIMITS = { hp: 99_999, hpLow: -999, ac: 24, attackName: 40, bonus: 99, attacks: 12 };

function whole(v: unknown, low: number, high: number): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(low, Math.min(high, Math.trunc(v))) : null;
}

function text(v: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

/** Stats as they're kept, from whatever a browser sent; null when it's not stats at all. */
export function sanitizeTokenStats(raw: unknown): TokenStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const maxHp = whole(r.maxHp, 0, STATS_LIMITS.hp);
  const hp = whole(r.hp, STATS_LIMITS.hpLow, STATS_LIMITS.hp);
  const init = whole(r.init, -STATS_LIMITS.bonus, STATS_LIMITS.bonus);
  if (maxHp === null || hp === null || init === null || !Array.isArray(r.attacks) || r.attacks.length > STATS_LIMITS.attacks) return null;
  const attacks: MonsterAttack[] = [];
  for (const a of r.attacks as Record<string, unknown>[]) {
    const name = text(a?.name, STATS_LIMITS.attackName);
    const toHit = whole(a?.toHit, -STATS_LIMITS.bonus, STATS_LIMITS.bonus);
    const damage = whole(a?.damage, -STATS_LIMITS.bonus, STATS_LIMITS.bonus);
    if (!name || toHit === null || damage === null || typeof a.dice !== "string") return null;
    const dice = a.dice === "" ? "" : damageDice({ damage: a.dice });
    if (dice === null) return null;
    attacks.push({ name, toHit, dice, damage });
  }
  return { hp, maxHp, ac: text(r.ac, STATS_LIMITS.ac), init, attacks };
}

/** Damage as the GM types it, "1d8+1" or "d6": its dice and bonus; "" for none; null when it isn't damage. */
export function parseDamage(typed: string): { dice: string; damage: number } | null {
  const t = typed.replace(/\s+/g, "");
  if (!t) return { dice: "", damage: 0 };
  const m = t.match(/^(\d{0,2}d\d{1,3})([+-]\d{1,2})?$/i);
  const dice = m ? damageDice({ damage: m[1] }) : null;
  return dice ? { dice, damage: Number(m![2] ?? 0) } : null;
}

export function damageText(a: Pick<MonsterAttack, "dice" | "damage">): string {
  return a.dice ? withModifier(a.dice, a.damage) : "";
}

/** The damage roll for an attack, with the most its dice can roll added on a crit; null with no damage dice. */
export function attackDamage(a: Pick<MonsterAttack, "dice" | "damage">, crit: boolean): string | null {
  return damageRoll({ dice: a.dice || null, damage: a.damage, sneak: null }, { crit });
}

/** What the stats form holds: everything as it was typed. */
export interface StatsDraft {
  hp: string;
  maxHp: string;
  ac: string;
  init: string;
  attacks: { name: string; toHit: string; damage: string }[];
}

export function draftOf(s: TokenStats | null | undefined): StatsDraft {
  if (!s) return { hp: "", maxHp: "", ac: "", init: "", attacks: [{ name: "", toHit: "", damage: "" }] };
  return {
    hp: String(s.hp),
    maxHp: s.maxHp ? String(s.maxHp) : "",
    ac: s.ac,
    init: s.init ? String(s.init) : "",
    attacks: s.attacks.map((a) => ({ name: a.name, toHit: a.toHit ? String(a.toHit) : "", damage: damageText(a) })),
  };
}

function typedNumber(v: string): number | null {
  const t = v.trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * The stats a filled-in form comes to, or what's wrong with it in words for the GM. A row with no
 * name or damage is left out. HP left empty means full; so does HP that was full before when the
 * most it can be changes, the usual reason for changing it.
 */
export function statsFromDraft(d: StatsDraft, before?: TokenStats | null): { stats: TokenStats } | { error: string } {
  const maxHp = typedNumber(d.maxHp);
  const typedHp = typedNumber(d.hp);
  const init = typedNumber(d.init);
  if (maxHp === null || maxHp < 0) return { error: "Max HP is a number." };
  if (typedHp === null) return { error: "HP is a number." };
  if (init === null) return { error: "Initiative is a number, like 2 or -1." };
  const wasFull = !!before && before.hp === before.maxHp && String(before.hp) === d.hp.trim();
  const hp = !d.hp.trim() || wasFull ? maxHp : typedHp;
  const attacks: MonsterAttack[] = [];
  for (const row of d.attacks) {
    if (!row.name.trim() && !row.damage.trim()) continue;
    const toHit = typedNumber(row.toHit);
    if (toHit === null) return { error: `${row.name.trim() || "An attack"}: its to-hit bonus is a number, like 2 or -1.` };
    const damage = parseDamage(row.damage);
    if (!damage) return { error: `${row.name.trim() || "An attack"}: its damage is dice, like 1d8+1.` };
    attacks.push({ name: row.name.trim() || "Attack", toHit, ...damage });
  }
  const stats = sanitizeTokenStats({ hp, maxHp, ac: d.ac, init, attacks });
  return stats ? { stats } : { error: `A token has at most ${STATS_LIMITS.attacks} attacks.` };
}

/** Whether the form was left with nothing in it. */
export function isBlank(s: TokenStats): boolean {
  return !s.maxHp && !s.hp && !s.ac && !s.init && !s.attacks.length;
}

/** HP after damage (a negative change) or healing, which stops at the most it can be. HP can go below 0. */
export function changedHp(s: Pick<TokenStats, "hp" | "maxHp">, change: number): number {
  const next = s.hp + change;
  if (change > 0) return Math.min(next, Math.max(s.hp, s.maxHp));
  return Math.max(STATS_LIMITS.hpLow, next);
}

/** A duplicate is a new creature of the same kind: unhurt. */
export function freshCopy(s: TokenStats): TokenStats {
  return { ...s, hp: s.maxHp, attacks: s.attacks.map((a) => ({ ...a })) };
}

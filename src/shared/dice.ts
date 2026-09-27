// Dice expressions: "d20", "2d6+3", "4d6dl1", "2d20kh1", "d%", "4dF", "1d8+1d6-2".
// Rolled on the server so nobody can fudge a result from their browser.

import type { DieRoll, RollResult, RollTerm } from "./types";

/** Returns a uniformly random integer in [0, maxExclusive). */
export type Rng = (maxExclusive: number) => number;

export class DiceError extends Error {}

const MAX_DICE_PER_TERM = 100;
const MAX_DICE_TOTAL = 200;
const MAX_SIDES = 1000;
const MAX_TERMS = 20;
const MAX_CONSTANT = 100000;

type Modifier = "kh" | "kl" | "dh" | "dl";

interface DiceSpec {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number | "F";
  mod: Modifier | null;
  modN: number;
}
interface NumSpec {
  kind: "num";
  sign: 1 | -1;
  value: number;
}

const TERM = /^(\d*)d(\d+|%|f)(kh|kl|dh|dl|k|d)?(\d*)|^(\d+)/;

export function parseDice(input: string): (DiceSpec | NumSpec)[] {
  const expr = input.replace(/\s+/g, "").toLowerCase();
  if (!expr) throw new DiceError("Nothing to roll");
  if (expr.length > 120) throw new DiceError("That roll is too long");
  const terms: (DiceSpec | NumSpec)[] = [];
  let i = 0;
  let totalDice = 0;
  while (i < expr.length) {
    let sign: 1 | -1 = 1;
    const c = expr[i];
    if (c === "+" || c === "-") {
      sign = c === "-" ? -1 : 1;
      i++;
    } else if (terms.length > 0) {
      throw new DiceError(`Unexpected "${c}"`);
    }
    const m = TERM.exec(expr.slice(i));
    if (!m) throw new DiceError(`Can't read "${expr.slice(i) || expr}"`);
    i += m[0].length;
    if (m[5] !== undefined) {
      const value = Number(m[5]);
      if (value > MAX_CONSTANT) throw new DiceError("That number is too large");
      terms.push({ kind: "num", sign, value });
    } else {
      const count = m[1] ? Number(m[1]) : 1;
      const sides: number | "F" = m[2] === "%" ? 100 : m[2] === "f" ? "F" : Number(m[2]);
      if (count < 1) throw new DiceError("Roll at least one die");
      if (count > MAX_DICE_PER_TERM) throw new DiceError(`At most ${MAX_DICE_PER_TERM} dice at once`);
      if (sides !== "F" && (sides < 1 || sides > MAX_SIDES)) throw new DiceError(`Dice need 1 to ${MAX_SIDES} sides`);
      let mod: Modifier | null = null;
      let modN = 0;
      if (m[3]) {
        mod = m[3] === "k" ? "kh" : m[3] === "d" ? "dl" : (m[3] as Modifier);
        modN = m[4] ? Number(m[4]) : 1;
        if (modN < 0 || modN > count) throw new DiceError(`Can't keep or drop ${modN} of ${count} dice`);
      }
      totalDice += count;
      if (totalDice > MAX_DICE_TOTAL) throw new DiceError(`At most ${MAX_DICE_TOTAL} dice per roll`);
      terms.push({ kind: "dice", sign, count, sides, mod, modN });
    }
    if (terms.length > MAX_TERMS) throw new DiceError("Too many parts in that roll");
  }
  return terms;
}

function notation(t: DiceSpec): string {
  const sides = t.sides === "F" ? "F" : t.sides === 100 ? "%" : String(t.sides);
  return `${t.count}d${sides}${t.mod ? `${t.mod}${t.modN}` : ""}`;
}

export function rollDice(input: string, rng: Rng): RollResult {
  const specs = parseDice(input);
  const terms: RollTerm[] = [];
  let total = 0;
  for (const s of specs) {
    if (s.kind === "num") {
      terms.push({ kind: "num", sign: s.sign, value: s.value });
      total += s.sign * s.value;
      continue;
    }
    const rolls: DieRoll[] = [];
    for (let n = 0; n < s.count; n++) {
      const v = s.sides === "F" ? rng(3) - 1 : rng(s.sides) + 1;
      rolls.push({ v, dropped: false });
    }
    if (s.mod) {
      // Order indices by value; ties keep roll order so the result is deterministic.
      const order = rolls.map((_, idx) => idx).sort((a, b) => rolls[a].v - rolls[b].v || a - b);
      let drop: number[] = [];
      if (s.mod === "kh") drop = order.slice(0, s.count - s.modN);
      if (s.mod === "kl") drop = order.slice(s.modN);
      if (s.mod === "dl") drop = order.slice(0, s.modN);
      if (s.mod === "dh") drop = order.slice(s.count - s.modN);
      for (const idx of drop) rolls[idx].dropped = true;
    }
    const subtotal = rolls.reduce((sum, r) => sum + (r.dropped ? 0 : r.v), 0);
    total += s.sign * subtotal;
    terms.push({ kind: "dice", sign: s.sign, notation: notation(s), count: s.count, sides: s.sides, rolls, subtotal });
  }
  const expr = terms
    .map((t, idx) => {
      const body = t.kind === "num" ? String(t.value) : t.notation;
      if (idx === 0) return t.sign < 0 ? `-${body}` : body;
      return `${t.sign < 0 ? "-" : "+"}${body}`;
    })
    .join("");
  return { expr, total, terms };
}

/** Unbiased integer in [0, max) from the platform CSPRNG. */
export function secureRng(max: number): number {
  if (max <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

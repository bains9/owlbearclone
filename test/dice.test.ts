import { describe, expect, it } from "vitest";
import { DiceError, parseDice, rollDice, secureRng } from "../src/shared/dice";
import type { Rng } from "../src/shared/dice";

/** An RNG that returns a fixed sequence of 0-based values. */
function seq(...values: number[]): Rng {
  let i = 0;
  return (max) => {
    const v = values[i++ % values.length];
    if (v >= max) throw new Error(`test value ${v} out of range for ${max}`);
    return v;
  };
}

describe("parseDice", () => {
  it("reads common expressions", () => {
    expect(parseDice("d20")).toEqual([{ kind: "dice", sign: 1, count: 1, sides: 20, mod: null, modN: 0 }]);
    expect(parseDice("2d6 + 3")).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 6, mod: null, modN: 0 },
      { kind: "num", sign: 1, value: 3 },
    ]);
    expect(parseDice("d%")[0]).toMatchObject({ sides: 100 });
    expect(parseDice("4dF")[0]).toMatchObject({ sides: "F", count: 4 });
    expect(parseDice("4d6dl1")[0]).toMatchObject({ mod: "dl", modN: 1 });
    expect(parseDice("2d20k1")[0]).toMatchObject({ mod: "kh", modN: 1 });
    expect(parseDice("2d20kl")[0]).toMatchObject({ mod: "kl", modN: 1 });
    expect(parseDice("-1d4")[0]).toMatchObject({ sign: -1 });
  });

  it("rejects nonsense and abuse", () => {
    for (const bad of ["", "abc", "2d", "d0", "1001d6", "d1001", "2d6x", "3d6kh4", "2d6+", "d20 d20"]) {
      expect(() => parseDice(bad), bad).toThrow(DiceError);
    }
    expect(() => parseDice("100d6+100d6+1d6")).toThrow(DiceError);
  });
});

describe("rollDice", () => {
  it("sums dice and constants", () => {
    const r = rollDice("2d6+3", seq(0, 5));
    expect(r.total).toBe(1 + 6 + 3);
    expect(r.expr).toBe("2d6+3");
  });

  it("keeps the highest for advantage", () => {
    const r = rollDice("2d20kh1", seq(4, 16));
    expect(r.total).toBe(17);
    const t = r.terms[0];
    expect(t.kind === "dice" && t.rolls).toEqual([
      { v: 5, dropped: true },
      { v: 17, dropped: false },
    ]);
  });

  it("keeps the lowest for disadvantage", () => {
    expect(rollDice("2d20kl1", seq(4, 16)).total).toBe(5);
  });

  it("drops the lowest of 4d6", () => {
    expect(rollDice("4d6dl1", seq(0, 2, 5, 3)).total).toBe(3 + 6 + 4);
  });

  it("drops the highest", () => {
    expect(rollDice("3d6dh1", seq(5, 0, 2)).total).toBe(1 + 3);
  });

  it("handles negative terms and fudge dice", () => {
    expect(rollDice("1d8-2", seq(0)).total).toBe(-1);
    expect(rollDice("4dF", seq(0, 1, 2, 2)).total).toBe(-1 + 0 + 1 + 1);
  });

  it("secureRng stays in range and hits every value", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = secureRng(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
});

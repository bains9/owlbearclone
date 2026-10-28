// The dice tray's pool: picking dice, fewer and more, ×2, the roll it makes, staying within
// what one roll may hold, and the guide's words for it.
import { describe, expect, it } from "vitest";
import { MAX_DICE, MAX_OF_A_DIE, canAdd, canDouble, changeDie, doubled, poolExpr, poolSize } from "../src/client/ui/dicePool";
import type { Pool } from "../src/client/ui/dicePool";
import { parseDice } from "../src/shared/dice";
import { GUIDE } from "../src/client/guide";

const pick = (...sides: number[]): Pool => sides.reduce((p, s) => changeDie(p, s, 1), {} as Pool);

describe("the dice pool", () => {
  it("picks one more with each click, and rolls smallest die first", () => {
    const pool = pick(8, 6, 6);
    expect(pool).toEqual({ 6: 2, 8: 1 });
    expect(poolExpr(pool)).toBe("2d6+1d8");
    expect(poolSize(pool)).toBe(3);
    expect(poolExpr({})).toBe("");
  });

  it("drops a die whose count reaches nothing, however far it's taken down", () => {
    expect(changeDie({ 6: 1, 8: 1 }, 6, -1)).toEqual({ 8: 1 });
    expect(changeDie({ 6: 3 }, 6, -5)).toEqual({});
    expect(changeDie({}, 6, -1)).toEqual({});
  });

  it("caps a big jump at both limits at once, and leaves a pool that can't double as it was", () => {
    expect(changeDie({ 8: 150 }, 6, 80)).toEqual({ 8: 150, 6: 50 });
    expect(changeDie({}, 6, 500)).toEqual({ 6: MAX_OF_A_DIE });
    const full = { 6: 60 };
    expect(doubled(full)).toBe(full);
  });

  it("doubles every die for a critical hit", () => {
    expect(doubled({ 6: 2, 8: 1 })).toEqual({ 6: 4, 8: 2 });
    expect(canDouble({})).toBe(false);
  });

  it("stays within what one roll may hold, as the dice roller allows", () => {
    let pool: Pool = {};
    for (let i = 0; i < MAX_OF_A_DIE + 5; i++) pool = changeDie(pool, 6, 1);
    expect(pool[6]).toBe(MAX_OF_A_DIE);
    expect(canAdd(pool, 6)).toBe(false);
    expect(canDouble(pool)).toBe(false);
    pool = changeDie(pool, 8, 150);
    expect(poolSize(pool)).toBe(MAX_DICE);
    expect(canAdd(pool, 10)).toBe(false);
    expect(canDouble({ 6: 51 })).toBe(false);
    expect(canDouble({ 6: 50 })).toBe(true);
    // The biggest pool still parses.
    expect(() => parseDice(poolExpr({ 4: 100, 6: 100 }) + "+5")).not.toThrow();
    expect(() => parseDice(poolExpr({ 4: 1, 6: 1, 8: 1, 10: 1, 12: 1, 20: 1, 100: 1 }) + "-3")).not.toThrow();
  });
});

describe("the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const part = GUIDE.flatMap((s) => s.parts).find((p) => p.title === "Roll dice from the dice tray")!;
  const text = (p: { steps: string[]; notes: string[] }) => [...p.steps, ...p.notes].join("\n");

  it("has rolling several dice ninth in What's new, under the Build tool's library, maps from Dungeon, Dungeon's sign-in, extending maps and voice chat", () => {
    expect(news.parts[8].title).toBe("Roll several dice at once (25 October 2026)");
    expect(news.intro).toContain("The latest updates came out on 27 October 2026.");
    const entry = text(news.parts[8]);
    for (const what of ["**Roll**", "**−**", "**+**", "**×2**", "critical hit", "**d20**, then **Roll**", "See **Roll dice from the dice tray**"]) expect(entry).toContain(what);
  });

  it("says how to pick and roll, with the buttons' own words", async () => {
    const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
    const panel = await readFile(new URL("../src/client/ui/ChatPanel.tsx", import.meta.url), "utf8");
    for (const label of ["Roll", "×2", "Put the picked dice back", "Pick a d${d} to roll", "One d${d} fewer", "One more d${d}"]) expect(panel, label).toContain(label);
    // − and + are the buttons' own text, as the guide shows them.
    expect(panel).toMatch(/onClick=\{\(\) => setPool\(\(p\) => changeDie\(p, d, -1\)\)\}>\s*−\s*<\/button>/);
    expect(panel).toMatch(/>\s*\+\s*<\/button>/);
    // The picked dice sit above the dice, so picking one doesn't move the buttons.
    expect(panel.indexOf('class="dice-hint"')).toBeLessThan(panel.indexOf("Pick a d"));
    expect(panel.indexOf("dice-pool")).toBeLessThan(panel.indexOf("Pick a d"));
    const words = text(part);
    for (const what of ["Each click picks one more", "**×2**", "**Roll**", "**Put the picked dice back**", "100 of one die, and 200 in all"]) expect(words).toContain(what);
    expect(words).not.toMatch(/Click a die button/);
  });
});

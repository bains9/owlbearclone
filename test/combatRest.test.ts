// Combat rest from a character's card (3 November 2026). The sheets' script's version 10 reads each
// character's combat rest (the dice the sheet works out for their class, from Ref Classes and their
// F-level), their body points, and whether their class lets a spellcaster rest magical damage; the
// Worker rolls the dice and the script adds the roll to Current HP, never past what fatigue gives
// back (lost body points stay lost).
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeCombatRest } from "../src/client/party";
import { RoomClient } from "../src/client/room/client";
import { SCRIPT_VERSION, cleanCharacter, type CharactersReply, combatRestCap, combatRestDice, combatRestText, fatigueToRegain, magicRestDice, type Character } from "../src/shared/characters";
import { castList, highestLevel } from "../src/shared/spellfx";
import { DEFAULT_SETTINGS } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = read("scripts/character-sheets.gs");
interface Party {
  healOnSheet(source: string, key: string, sheetId: string, gain: number, fetcher: typeof fetch): Promise<{ hp: number; was: number } | { error: string }>;
  keepHp(env: unknown, cache: Cache | null, sheetId: string, hp: number, now?: number): Promise<void>;
  readParty(env: unknown, cache: Cache | null, fetcher: typeof fetch, now?: number): Promise<CharactersReply>;
}
const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";

describe("the dice the sheet works out for each class", () => {
  it("are read from its Combat rest (after a fight), as Table rolls them", () => {
    // Fighter, Crusader, Ranger, War Cleric: d3 + d(F-level / 2), at most d5.
    expect(combatRestDice("d3 + d2 · F-level 4")).toBe("1d3+1d2");
    expect(combatRestDice("d3 + 1 · F-level 2")).toBe("1d3+1");
    expect(combatRestDice("d3 + d5 · F-level 12 · 3 attacks/2 rounds")).toBe("1d3+1d5");
    // Samurai: d4 + d(their level); a level-1 Samurai's d1 is 1.
    expect(combatRestDice("d4 + d6 · F-level 6")).toBe("1d4+1d6");
    expect(combatRestDice("d4 + d1 · F-level 1")).toBe("1d4+1");
    // Rogue: d3 + d(F-level / 3), at most d3. Everyone else: d2.
    expect(combatRestDice("d3 + d3 · F-level 9")).toBe("1d3+1d3");
    expect(combatRestDice("d2 · F-level 1")).toBe("1d2");
    for (const bad of ["", "—", "Pick a class", "d3 + d2 + d200", 7, null]) expect(combatRestDice(bad)).toBeNull();
    expect(combatRestText("1d3+1d2")).toBe("d3 + d2");
    expect(combatRestText("1d3+1")).toBe("d3 + 1");
  });

  it("a spellcaster's after magical damage: d3 + d(highest spell level), for a class that gives the choice", () => {
    expect(magicRestDice({ magicRest: true }, 3)).toBe("1d3+1d3");
    expect(magicRestDice({ magicRest: true }, 1)).toBe("1d3+1");
    // Cantrips only, or a class without the choice: none.
    expect(magicRestDice({ magicRest: true }, 0)).toBeNull();
    expect(magicRestDice({}, 4)).toBeNull();
    // The highest level they cast, as casting from the card has it: spells the sheet says can't be cast yet don't count.
    const c = cleanCharacter({
      id: SHEET,
      name: "Nancael",
      magicRest: true,
      spells: [
        { name: "Cure Wounds", level: 2, sp: "2", prayer: "Free", note: "" },
        { name: "Dispel Magic", level: 3, sp: "3", prayer: "Free", note: "" },
        { name: "Fire Purge", level: 4, sp: "5", prayer: "Free", note: "Level 4: not castable yet" },
      ],
    })!;
    expect(magicRestDice(c, highestLevel(castList(c)))).toBe("1d3+1d3");
  });

  it("come through cleanCharacter with body points and the choice, and nothing for an older script", () => {
    const c = cleanCharacter({ id: SHEET, name: "Grimmdark", hp: "30", maxHp: "37", combatRest: "d3 + d2 · F-level 4", bodyPoints: "4", magicRest: true })!;
    expect(c).toMatchObject({ combatRest: "1d3+1d2", bodyPoints: 4, magicRest: true });
    const old = cleanCharacter({ id: SHEET, name: "Grimmdark", hp: "30", maxHp: "37" })!;
    expect("combatRest" in old || "bodyPoints" in old || "magicRest" in old).toBe(false);
    expect(SCRIPT_VERSION).toBe(10);
    expect(code).toContain("const VERSION = 10;");
    expect(code).toContain("combatRest: at(5, 'Combat rest (after a fight)'),");
    expect(code).toContain("bodyPoints: at(0, 'Body points'),");
  });
});

describe("what a combat rest can give back", () => {
  const who = (hp: number, maxHp = 37, bodyPoints: number | undefined = 4): Pick<Character, "hp" | "maxHp" | "bodyPoints"> => ({ hp, maxHp, ...(bodyPoints !== undefined ? { bodyPoints } : {}) });

  it("is fatigue only: lost body points stay lost", () => {
    expect(combatRestCap(who(20))).toBe(37);
    // 2 of 4 body points lost: back to 2 + 33 fatigue at most.
    expect(combatRestCap(who(2))).toBe(35);
    expect(combatRestCap(who(20, 37, undefined))).toBe(37);
    expect(fatigueToRegain(who(36))).toBe(true);
    expect(fatigueToRegain(who(37))).toBe(false);
    expect(fatigueToRegain(who(2))).toBe(true);
    expect(fatigueToRegain({ hp: null, maxHp: 37 })).toBe(false);
  });

  const sheetOf = (cells: { hp: string; max?: string; body?: string; formula?: string }) => {
    const v = Array.from({ length: 160 }, () => ["", ""]);
    v[16] = ["Current HP", cells.hp];
    v[17] = ["Maximum HP", cells.max ?? "37"];
    v[18] = ["Body points", cells.body ?? "4"];
    const written: [number, number, number][] = [];
    return {
      written,
      sheet: {
        getRange: (a: string | number, col?: number) =>
          typeof a === "string"
            ? { getDisplayValues: () => v }
            : { getFormula: () => cells.formula ?? "", getValue: () => (cells.hp === "" ? "" : Number(cells.hp)), setValue: (x: number) => void written.push([a, col!, x]) },
      },
    };
  };
  const healOn = new Function(`${code}\nreturn healOn;`)() as (sheet: unknown, gain: number) => { hp?: number; was?: number; error?: string };

  it("the script adds the roll to Current HP, stopping at what fatigue gives back", () => {
    const ok = sheetOf({ hp: "20" });
    expect(healOn(ok.sheet, 5)).toEqual({ hp: 25, was: 20 });
    expect(ok.written).toEqual([[17, 2, 25]]);
    expect(healOn(sheetOf({ hp: "35" }).sheet, 5)).toEqual({ hp: 37, was: 35 });
    // In their body points: fatigue comes back, the lost body points don't.
    expect(healOn(sheetOf({ hp: "2" }).sheet, 50)).toEqual({ hp: 35, was: 2 });
    const full = sheetOf({ hp: "37" });
    expect(healOn(full.sheet, 4)).toEqual({ hp: 37, was: 37 });
    expect(full.written).toEqual([]);
  });

  it("never over a formula, and not on an empty Current HP", () => {
    const formula = sheetOf({ hp: "20", formula: "=B18-B22" });
    expect(healOn(formula.sheet, 5)).toMatchObject({ error: expect.stringContaining("works out Current HP itself") });
    expect(formula.written).toEqual([]);
    expect(healOn(sheetOf({ hp: "" }).sheet, 5)).toMatchObject({ error: expect.stringContaining("Current HP is empty") });
  });

  it("the script knows a class that lets a spellcaster rest magical damage by its Ref Classes", () => {
    const magicRestOf = new Function(`${code}\nreturn magicRestOf;`)() as (ss: unknown, classes: string[]) => boolean;
    const header = Array<string>(24).fill("");
    header[0] = "Class";
    header[19] = "Combat rest";
    const row = (cls: string, rest: string) => Object.assign(Array<string>(24).fill(""), { 0: cls, 19: rest });
    const rows = [
      header,
      row("Ranger", "d3+d(F-level/2), capped at d3+d5"),
      row("Mage", "Others: d2 (p90). Spellcasters: if at least half of the damage sustained was magical in nature, may opt to combat rest at d3+d(max spell level ability) instead"),
      row("Shaman", "Others: d2 (p90). Spellcasters: if at least half of the damage sustained was magical in nature, may opt..."),
      row("Cleric", "d2"),
    ];
    const ss = { getSheetByName: (n: string) => (n === "Ref Classes" ? { getRange: () => ({ getDisplayValues: () => rows }) } : null) };
    expect(magicRestOf(ss, ["Ranger", "Shaman"])).toBe(true);
    expect(magicRestOf(ss, ["Mage", ""])).toBe(true);
    expect(magicRestOf(ss, ["Ranger", ""])).toBe(false);
    expect(magicRestOf(ss, ["Cleric", "Ranger"])).toBe(false);
    expect(magicRestOf({ getSheetByName: () => null }, ["Mage"])).toBe(false);
    expect(code).toContain("if (healing) return reply(healOn(sheet, heal));");
  });
});

describe("taking a combat rest from Table", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks the GM's script with Tabletop's key, and knows an old script by its answer", async () => {
    const fetcher = vi.fn(async () => Response.json({ hp: 25, was: 20 }));
    expect(await party.healOnSheet("https://script.example/exec", "k".repeat(43), SHEET, 5, fetcher as unknown as typeof fetch)).toEqual({ hp: 25, was: 20 });
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ key: "k".repeat(43), id: SHEET, heal: 5 });
    const old = vi.fn(async () => Response.json({ error: "That isn’t a number of spell points." }));
    expect(await party.healOnSheet("https://script.example/exec", "k", SHEET, 5, old as unknown as typeof fetch)).toMatchObject({ error: expect.stringContaining("needs to update it") });
    const said = vi.fn(async () => Response.json({ error: "Their sheet works out Current HP itself, so it isn’t changed." }));
    expect(await party.healOnSheet("https://script.example/exec", "k", SHEET, 5, said as unknown as typeof fetch)).toEqual({ error: "The HP wasn't added: Their sheet works out Current HP itself, so it isn’t changed." });
  });

  it("keeps their new HP in the Worker's reading, so pages told to read the party again don't all ask the sheets", async () => {
    const kept = new Map<string, string>();
    const cache = {
      match: async (r: Request) => (kept.has(r.url) ? new Response(kept.get(r.url)) : undefined),
      put: async (r: Request, res: Response) => void kept.set(r.url, await res.text()),
    } as unknown as Cache;
    const source = "https://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec";
    const env = {
      directory: { charactersSource: async () => source, characterFigures: async () => ({}), characterStrMatched: async () => ({}), characterPlayers: async () => ({}), characterPrayed: async () => ({}), characterDice: async () => ({}) },
      files: { head: async () => null },
    };
    const fetcher = vi.fn(async () => Response.json({ version: 10, characters: [{ id: SHEET, name: "Grimmdark", hp: "30", maxHp: "37", combatRest: "d3 + d2 · F-level 4", bodyPoints: "4" }] }));
    expect((await party.readParty(env, cache, fetcher as unknown as typeof fetch, 1000)).characters[0].hp).toBe(30);
    await party.keepHp(env, cache, SHEET, 34, 40_000);
    const after = await party.readParty(env, cache, fetcher as unknown as typeof fetch, 45_000);
    expect(after.characters[0].hp).toBe(34);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(read("src/worker/index.ts")).toContain("await keepHp({ directory }, caches.default, sheetId, done.hp);");
  });

  it("from the card: the kind of rest asked for, and their HP shown here at once", async () => {
    const me: Player = { connId: "c2", userId: "player1abcdef", name: "P", color: "#00ff00", role: "player" };
    const c: Character = { ...cleanCharacter({ id: SHEET, name: "Grimmdark", hp: 30, maxHp: 37, combatRest: "d3 + d2", bodyPoints: 4, magicRest: true })!, players: [{ userId: me.userId, name: "P" }] };
    const room = new RoomClient("AbCdEf123456", { uid: me.userId, name: me.name, color: me.color });
    room.store.set({ me, room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } }, party: { configured: true, readAt: 1, characters: [c] } });
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, hp: 34, was: 30, total: 4 }));
    expect(await takeCombatRest(room, c, true)).toEqual({ hp: 34, was: 30 });
    expect(room.state.party!.characters[0].hp).toBe(34);
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/characters/${SHEET}/combat-rest?room=AbCdEf123456`);
    expect(JSON.parse(String(init.body))).toEqual({ kind: "magical" });
    sent.mockImplementation(async () => Response.json({ error: "Only their player or the GM can take their combat rest." }, { status: 403 }));
    await expect(takeCombatRest(room, c)).rejects.toThrow("Only their player or the GM");
  });

  it("is rolled by the Worker from the sheet's dice, and the room is told", () => {
    const index = read("src/worker/index.ts");
    expect(index).toContain("const dice = magical ? magicRestDice(who, highestLevel(castList(who))) : who.combatRest;");
    expect(index).toContain("const roll = rollDice(dice, secureRng);");
    expect(index).toContain(".combatRested(userId, roll,");
    expect(read("src/worker/room.ts")).toContain('this.broadcast({ t: "party" });');
    expect(read("src/client/room/client.ts")).toContain('case "party":\n        void this.refreshParty();');
  });
});

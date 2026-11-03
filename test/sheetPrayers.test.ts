// Prayers by the character sheet (1 November 2026: a player's sheet said one Moonbeam was left and
// the card said none, because Table only knew prayers made on the card). The script's version 9
// reads the sheet's own PRAYED FOR TODAY list; the card counts by it (prayed − cast); casting a
// prayed spell from Table ticks Cast on the sheet. A sheet with nothing on that list still uses
// the card's Pray for today.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cantCast, spendPrayer } from "../src/client/party";
import { RoomClient } from "../src/client/room/client";
import { cleanCharacter, prayedOnSheet, type Character } from "../src/shared/characters";
import { castList } from "../src/shared/spellfx";
import { DEFAULT_SETTINGS } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = read("scripts/character-sheets.gs");
interface Party {
  castOnSheet(source: string, key: string, sheetId: string, spell: string, fetcher: typeof fetch): Promise<{ prayed: number; cast: number } | { error: string }>;
}
const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";

/** The Character tab's PRAYED FOR TODAY part, as a sheet has it, 160 rows of 8. */
function tab(rows: string[][]): string[][] {
  const v = Array.from({ length: 160 }, () => Array<string>(8).fill(""));
  v[68][0] = "PRAYED FOR TODAY (p9)";
  v[69] = ["Spell (prayed for or memorized)", "Prayed", "Cast", "Left · SP per casting", "", "Spell points", "SP", ""];
  rows.forEach((r, i) => (v[70 + i] = [...r, ...Array<string>(8 - r.length).fill("")]));
  return v;
}
const prayedRows = tab([
  ["Beast sense", "2", "", "Left: 2 of 2 · 2 SP each"],
  ["Mindwhisper", "4", "1", "Freecast: no need to pray for it"],
  ["Augury", "", "", "How many castings?"],
  ["Moonbeam", "2", "1", "Left: 1 of 2 · 2 SP each"],
]);

describe("the script reads the sheet's prayers", () => {
  const prayedOf = new Function(`${code}\nreturn prayedOf;`)() as (v: string[][]) => unknown;

  it("as prayed and cast, for each spell prayed for, to the first blank row", () => {
    expect(prayedOf(prayedRows)).toEqual([
      { spell: "Beast sense", prayed: 2, cast: 0 },
      { spell: "Mindwhisper", prayed: 4, cast: 1 },
      { spell: "Moonbeam", prayed: 2, cast: 1 },
    ]);
    // A sheet without the list: null (Table's own prayers are used).
    expect(prayedOf(Array.from({ length: 160 }, () => Array<string>(8).fill("")))).toBeNull();
    expect(code).toContain("prayedToday: prayedOf(v),");
  });

  it("ticks one more Cast for a spell cast from Table, never past what was prayed, never over a formula", () => {
    const castOn = new Function(`${code}\nreturn castOn;`)() as (sheet: unknown, spell: string) => { prayed?: number; cast?: number; error?: string };
    const sheetOf = (v: string[][], formula = "") => {
      const written: [number, number, number][] = [];
      return {
        written,
        sheet: {
          getRange: (a: string | number, col?: number) =>
            typeof a === "string" ? { getDisplayValues: () => v } : { getFormula: () => formula, setValue: (x: number) => void written.push([a, col!, x]) },
        },
      };
    };
    const ok = sheetOf(prayedRows);
    expect(castOn(ok.sheet, "Moonbeam")).toEqual({ prayed: 2, cast: 2 });
    // Row 74 (Moonbeam), column C (Cast).
    expect(ok.written).toEqual([[74, 3, 2]]);
    // By name, any "(R)" aside and any case.
    expect(castOn(sheetOf(prayedRows).sheet, "beast sense (R)")).toEqual({ prayed: 2, cast: 1 });
    const spent = tab([["Moonbeam", "2", "2"]]);
    expect(castOn(sheetOf(spent).sheet, "Moonbeam")).toMatchObject({ error: "None of Moonbeam left today (2 of 2 cast)." });
    expect(castOn(sheetOf(prayedRows).sheet, "Fireball")).toMatchObject({ error: expect.stringContaining("isn’t prayed for") });
    const formula = sheetOf(prayedRows, "=B74-1");
    expect(castOn(formula.sheet, "Moonbeam")).toMatchObject({ error: expect.stringContaining("works out Cast itself") });
    expect(formula.written).toEqual([]);
  });
});

describe("the card counts by the sheet", () => {
  const spells = [
    { name: "Moonbeam", level: 2, sp: "2+", prayer: "Pray", note: "" },
    { name: "Light (R)", level: 1, sp: "1+", prayer: "Pray", note: "" },
    { name: "Fog Cloud", level: 1, sp: "1+", prayer: "Pray", note: "" },
  ];

  it("prayed less cast, when the sheet lists any; Table's own count when it doesn't", () => {
    const c = cleanCharacter({ id: SHEET, name: "Testa", spells, prayedToday: [{ spell: "Moonbeam", prayed: 2, cast: 1 }, { spell: "light", prayed: "1", cast: "" }, { spell: "", prayed: 1 }] })!;
    expect(c.prayedToday).toEqual([
      { spell: "Moonbeam", prayed: 2, cast: 1 },
      { spell: "light", prayed: 1, cast: 0 },
    ]);
    const left = (x: Character) => Object.fromEntries(castList(x).map((s) => [s.sheet.name, s.left]));
    expect(left(c)).toMatchObject({ Moonbeam: 1, "Light (R)": 1, "Fog Cloud": 0 });
    // Table's own prayers count only for a sheet without any on its list.
    expect(left({ ...c, prayed: { "Fog Cloud": 2 } })["Fog Cloud"]).toBe(0);
    expect(left({ ...c, prayedToday: [], prayed: { "Fog Cloud": 2 } })["Fog Cloud"]).toBe(2);
    expect(prayedOnSheet({ prayedToday: null }, "Moonbeam")).toBeNull();
    // None left: the sheet says so, not "pray on their card".
    const fog = castList(c).find((s) => s.sheet.name === "Fog Cloud")!;
    expect(cantCast({ character: c, entry: fog, level: null })).toContain("sheet's Prayed for today list");
  });
});

describe("casting a prayed spell from Table", () => {
  const me: Player = { connId: "c2", userId: "player1abcdef", name: "P", color: "#00ff00", role: "player" };
  afterEach(() => vi.restoreAllMocks());

  it("ticks Cast on the sheet, and shows it here at once", async () => {
    const c: Character = {
      ...cleanCharacter({ id: SHEET, name: "Testa", spells: [{ name: "Moonbeam", level: 2, sp: "2+", prayer: "Pray", note: "" }], prayedToday: [{ spell: "Moonbeam", prayed: 2, cast: 1 }] })!,
      players: [{ userId: me.userId, name: "P" }],
    };
    const room = new RoomClient("AbCdEf123456", { uid: me.userId, name: me.name, color: me.color });
    room.store.set({ me, room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } }, party: { configured: true, readAt: 1, characters: [c] } });
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, prayed: 2, cast: 2 }));
    spendPrayer(room, { character: c, entry: castList(c)[0] });
    expect(room.state.party!.characters[0].prayedToday).toEqual([{ spell: "Moonbeam", prayed: 2, cast: 2 }]);
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/characters/${SHEET}/cast?room=AbCdEf123456`);
    expect(JSON.parse(String(init.body))).toEqual({ spell: "Moonbeam" });
  });

  it("asks the GM's script with Tabletop's key, and knows an old script by its answer", async () => {
    const fetcher = vi.fn(async () => Response.json({ prayed: 2, cast: 2 }));
    expect(await party.castOnSheet("https://script.example/exec", "k".repeat(43), SHEET, "Moonbeam", fetcher as unknown as typeof fetch)).toEqual({ prayed: 2, cast: 2 });
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ key: "k".repeat(43), id: SHEET, cast: "Moonbeam" });
    const old = vi.fn(async () => Response.json({ error: "That isn’t a number of spell points." }));
    expect(await party.castOnSheet("https://script.example/exec", "k", SHEET, "Moonbeam", old as unknown as typeof fetch)).toMatchObject({ error: expect.stringContaining("needs to update it") });
  });

  it("is the card's way when the sheet keeps the prayers: no Pray for today there", () => {
    const card = read("src/client/ui/CharacterCard.tsx");
    expect(card).toContain("{can && prayers.length > 0 && !fromSheet && (");
    expect(card).toContain("prayed for on the sheet");
    expect(read("src/worker/index.ts")).toContain("const done = await castOnSheet(source, await directory.charactersKey(), sheetId, spell);");
  });
});

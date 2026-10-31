import { describe, expect, it, vi } from "vitest";
import {
  INITIATIVE_DIE,
  TO_HIT_DIE,
  attackLabel,
  attackModifiers,
  attackWays,
  characterLabel,
  cleanCharacter,
  critDamage,
  critOf,
  damageDice,
  damageRoll,
  initiativeRoll,
  withModifier,
  type Character,
  type CharactersReply,
} from "../src/shared/characters";
import { parseDice } from "../src/shared/dice";
import { sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import { figureFor } from "../src/client/npcs/pcArt";
import { classFigureOf, classesOf, figureOf, raceOf } from "../src/client/npcs/pcTokens";
import { characterAssetName, setCharacterPlayer } from "../src/client/party";
import { RoomClient } from "../src/client/room/client";
import { GUIDE } from "../src/client/guide";
import type { Item, TokenItem } from "../src/shared/types";

// The party's character sheets in Tabletop (shared/characters.ts, worker/characters.ts, the
// GM's Apps Script scripts/character-sheets.gs, and the tokens, cards and rolls). The sheets here
// are made up, in the layout of the group's Player's Handbook sheet.

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

interface Party {
  askScript(source: string, fetcher: typeof fetch): Promise<{ characters: ReturnType<typeof cleanCharacter>[]; error?: string }>;
  readParty(env: unknown, cache: Cache | null, fetcher: typeof fetch, now?: number): Promise<CharactersReply>;
  forgetParty(env: unknown, cache: Cache | null): Promise<void>;
  SCRIPT_URL: RegExp;
  FIGURE_ICON: RegExp;
  isWeaponName(v: unknown): boolean;
}
const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const raw = {
  id: SHEET,
  name: "Testa Brightwood",
  player: "Sam",
  race: "Human",
  culture: "Wyddin",
  cls: "Ranger",
  subclass: "Bushmaster",
  cls2: "Shaman",
  subclass2: "",
  summary: "Human (Wyddin) • Level 4 Ranger — Bushmaster / Level 5 Shaman",
  hp: "34",
  maxHp: "49",
  init: "+2",
  sp: "30",
  maxSp: "39",
  strBonus: "+2",
  ac: "5",
  acShield: "7",
  attacks: [
    { weapon: "Longbow", damage: "1d8", range: "50/250", toHit: "0 missile", bonus: "no STR bonus" },
    { weapon: "Dagger", damage: "1d4", range: "7/20", toHit: "+1 · thrown 0", bonus: "dmg +2" },
  ],
  url: `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
};

describe("a character from their sheet", () => {
  it("comes through with its numbers as numbers", () => {
    const c = cleanCharacter(raw)!;
    expect(c).toMatchObject({ name: "Testa Brightwood", player: "Sam", hp: 34, maxHp: 49, init: 2, sp: 30, maxSp: 39, ac: "5", acShield: "7" });
    expect(c.attacks).toHaveLength(2);
    expect(characterLabel(c)).toBe("Testa");
  });

  it("leaves out what isn't a character, and what isn't the sheet's own link", () => {
    expect(cleanCharacter({ ...raw, id: "../x" })).toBeNull();
    expect(cleanCharacter({ ...raw, name: "" })).toBeNull();
    expect(cleanCharacter(null)).toBeNull();
    const c = cleanCharacter({ ...raw, url: "https://evil.example/phish", sp: "", maxSp: "", hp: "1,234" })!;
    expect(c.url).toBe(`https://docs.google.com/spreadsheets/d/${SHEET}/edit`);
    expect([c.sp, c.maxSp, c.hp]).toEqual([null, null, 1234]);
    // A Google address that wanders off elsewhere isn't taken either: the link is made from the id.
    expect(cleanCharacter({ ...raw, url: "https://docs.google.com/spreadsheets/d/x/../../../url?q=https://evil.example" })!.url).toBe(
      `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
    );
  });

  it("reads the sheet's to-hit and damage the way it words them", () => {
    expect(attackModifiers({ toHit: "0 missile", bonus: "no STR bonus" })).toEqual({ toHit: 0, damage: 0 });
    expect(attackModifiers({ toHit: "+1 · thrown 0", bonus: "dmg +2" })).toEqual({ toHit: 1, damage: 2 });
    expect(attackModifiers({ toHit: "-1", bonus: "dmg -1 · sneak attack 2d6" })).toEqual({ toHit: -1, damage: -1 });
    expect([damageDice({ damage: "1d8" }), damageDice({ damage: "d6" }), damageDice({ damage: "2d6" }), damageDice({ damage: "special" })]).toEqual(["1d8", "1d6", "2d6", null]);
    // To hit is two d10 and the sheet's to-hit; initiative one d10 and its bonus (the group's handbook).
    expect([withModifier(TO_HIT_DIE, 1), withModifier("1d6", 0), withModifier("1d4", -1)]).toEqual(["2d10+1", "1d6", "1d4-1"]);
    expect(withModifier(INITIATIVE_DIE, 2)).toBe("1d10+2");
    // And the chat's dice take them as they are.
    for (const expr of [withModifier(TO_HIT_DIE, 3), withModifier(TO_HIT_DIE, -2), withModifier(TO_HIT_DIE, 0), withModifier(INITIATIVE_DIE, 1)]) {
      expect(() => parseDice(expr), expr).not.toThrow();
    }
  });

  it("gives the dice whole, sensible bonuses whatever the sheet says", () => {
    // A typo of a huge number would make "1d20+1e+22", which the dice can't roll.
    expect(attackModifiers({ toHit: "+9999999999999999999999", bonus: "dmg -500" })).toEqual({ toHit: 100, damage: -100 });
    expect(cleanCharacter({ ...raw, init: "+1.5" })!.init).toBe(2);
    expect(cleanCharacter({ ...raw, init: "-0.4" })!.init).toBe(0);
    expect(cleanCharacter({ ...raw, init: "" })!.init).toBeNull();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const v = initiativeRoll({ init: 3 });
      expect(Number.isInteger(v) && v >= 4 && v <= 13, String(v)).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect([initiativeRoll(null), initiativeRoll({ init: null })]).toEqual([0, 0]);
  });

  it("labels each roll with who, what and which, within the chat's 60 characters", () => {
    expect(attackLabel("Testa", "Longbow", "to hit")).toBe("Testa: Longbow to hit");
    const long = attackLabel("Abelard", "Katana of the Seven Winds and the Long Forgotten Shore", "damage");
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.startsWith("Abelard: Katana of the Seven")).toBe(true);
    expect(long.endsWith("… damage")).toBe(true);
    expect(attackLabel("Testa", "Longbow", "crit damage")).toBe("Testa: Longbow crit damage");
  });

  it("gives a rogue's sneak attack its rank in d6, one fewer at range or thrown", () => {
    // A made-up rogue's attacks, worded as the handbook's sheet words them.
    const rapier = { weapon: "Rapier", damage: "1d8", range: "", toHit: "+3", bonus: "dmg 0 · sneak 4d6" };
    const dagger = { weapon: "Dagger", damage: "1d4", range: "7/20", toHit: "+3 · thrown +2", bonus: "dmg 0 · sneak 4d6 / 3d6 thrown" };
    const bow = { weapon: "Longbow", damage: "1d8", range: "50/250", toHit: "+2 missile", bonus: "no STR bonus · sneak 3d6" };
    const pick = (ws: ReturnType<typeof attackWays>) => ws.map((w) => [w.name, w.toHit, w.sneak]);
    // By their rank (5, say, after the sheet's words went stale): the rank wins.
    expect(pick(attackWays(rapier, { sneakRank: 5 }))).toEqual([["Rapier", 3, "5d6"]]);
    expect(pick(attackWays(dagger, { sneakRank: 5 }))).toEqual([
      ["Dagger", 3, "5d6"],
      ["Dagger, thrown", 2, "4d6"],
    ]);
    expect(pick(attackWays(bow, { sneakRank: 5 }))).toEqual([["Longbow", 2, "4d6"]]);
    expect(pick(attackWays(bow, { sneakRank: 1 }))).toEqual([["Longbow", 2, null]]);
    // Without a rank, the sheet's own words.
    expect(pick(attackWays(dagger))).toEqual([
      ["Dagger", 3, "4d6"],
      ["Dagger, thrown", 2, "3d6"],
    ]);
    // Anyone else: no sneak attack, and a thrown line only when the sheet gives a thrown to-hit.
    expect(pick(attackWays({ weapon: "Dagger", damage: "1d4", range: "7/20", toHit: "+1 · thrown 0", bonus: "dmg +2" }))).toEqual([
      ["Dagger", 1, null],
      ["Dagger, thrown", 0, null],
    ]);
    // The damage: the sneak attack dice added when it's ticked; a crit adds the weapon's most, not theirs.
    const w = attackWays(rapier, { sneakRank: 4 })[0];
    expect([damageRoll(w), damageRoll(w, { sneak: true }), damageRoll(w, { sneak: true, crit: true })]).toEqual(["1d8", "1d8+4d6", "1d8+4d6+8"]);
    expect(damageRoll({ dice: "1d6", damage: 2, sneak: null }, { sneak: true })).toBe("1d6+2");
    for (const expr of ["1d8+4d6", "1d8+4d6+8", "1d4+3d6-1"]) expect(() => parseDice(expr), expr).not.toThrow();
    expect(attackLabel("Testa", "Dagger, thrown", "crit sneak damage")).toBe("Testa: Dagger, thrown crit sneak damage");
    // The rank as the sheet has it.
    expect([cleanCharacter({ ...raw, sneakRank: "4" })!.sneakRank, cleanCharacter({ ...raw, sneakRank: "" })!.sneakRank, cleanCharacter({ ...raw, sneakRank: "0" })!.sneakRank]).toEqual([4, null, null]);
  });

  it("adds their STR bonus to a ranged weapon matched to their strength, and only that", () => {
    const bow = { weapon: "Longbow", damage: "1d8", range: "50/250", toHit: "0 missile", bonus: "no STR bonus" };
    const specialised = { weapon: "Shortbow", damage: "1d6", range: "30/110", toHit: "+3 missile", bonus: "dmg +2 · specialised, 3 attacks / 2 rds" };
    const dagger = { weapon: "Dagger", damage: "1d4", range: "7/20", toHit: "+1 · thrown 0", bonus: "dmg +2" };
    const roll = (a: typeof bow, o: Parameters<typeof attackWays>[1]) => attackWays(a, o).map((w) => [w.name, damageRoll(w), w.strMatched]);
    expect(roll(bow, { strBonus: 2 })).toEqual([["Longbow", "1d8", false]]);
    expect(roll(bow, { strBonus: 2, strMatched: ["Longbow"] })).toEqual([["Longbow", "1d8+2", true]]);
    expect(roll(specialised, { strBonus: 1, strMatched: ["Shortbow"] })).toEqual([["Shortbow", "1d6+3", true]]);
    // A melee weapon has its STR bonus from the sheet already; marking it changes nothing.
    expect(roll(dagger, { strBonus: 2, strMatched: ["Dagger"] })).toEqual([
      ["Dagger", "1d4+2", false],
      ["Dagger, thrown", "1d4+2", false],
    ]);
    expect(attackWays(bow)[0].ranged).toBe(true);
    expect(attackWays(dagger)[0].ranged).toBe(false);
    // A crit doubles the dice's most, not the STR bonus.
    expect(damageRoll(attackWays(bow, { strBonus: 2, strMatched: ["Longbow"] })[0], { crit: true })).toBe("1d8+10");
    expect([cleanCharacter({ ...raw, strBonus: "+2" })!.strBonus, cleanCharacter({ ...raw, strBonus: "0" })!.strBonus, cleanCharacter({ ...raw, strBonus: "" })!.strBonus]).toEqual([2, 0, null]);
  });

  it("calls a natural 20 to hit a critical hit, and a natural 2 a critical failure", () => {
    const toHit = (rolls: number[], text = "Testa: Longbow to hit", extra: { dropped?: boolean }[] = []) => ({
      kind: "roll" as const,
      text,
      roll: {
        expr: "2d10+1",
        total: rolls.reduce((a, b) => a + b, 1),
        terms: [
          { kind: "dice" as const, sign: 1 as const, notation: "2d10", count: 2, sides: 10, rolls: rolls.map((v, i) => ({ v, dropped: extra[i]?.dropped ?? false })), subtotal: rolls.reduce((a, b) => a + b, 0) },
          { kind: "num" as const, sign: 1 as const, value: 1 },
        ],
      },
    });
    expect(critOf(toHit([10, 10]))).toBe("hit");
    expect(critOf(toHit([1, 1]))).toBe("fail");
    expect(critOf(toHit([10, 9]))).toBeNull();
    expect(critOf(toHit([1, 2]))).toBeNull();
    // Not a roll to hit: damage, initiative, or a plain roll in the chat.
    expect(critOf(toHit([10, 10], "Testa: Longbow damage"))).toBeNull();
    expect(critOf(toHit([10, 10], ""))).toBeNull();
    expect(critOf({ kind: "chat", text: "Testa: Longbow to hit" })).toBeNull();
    // Kept or dropped dice aren't the plain two d10.
    expect(critOf(toHit([1, 1], "Testa: Longbow to hit", [{ dropped: true }]))).toBeNull();
    // The crit's damage: the most the weapon's dice can roll, added again; the bonus only once.
    expect(critDamage({ damage: "1d8", bonus: "dmg +2" })).toBe("1d8+10");
    expect(critDamage({ damage: "2d6", bonus: "no STR bonus" })).toBe("2d6+12");
    expect(critDamage({ damage: "3d4", bonus: "dmg +1" })).toBe("3d4+13");
    expect(critDamage({ damage: "1d4", bonus: "dmg -1" })).toBe("1d4+3");
    expect(critDamage({ damage: "special", bonus: "" })).toBeNull();
    expect(() => parseDice(critDamage({ damage: "1d8", bonus: "dmg +2" })!)).not.toThrow();
  });

  it("gets a figure by class, in their race's colouring, unless the GM chose another", () => {
    const c = cleanCharacter(raw)!;
    expect(raceOf(c).id).toBe("wyddin");
    expect(raceOf({ race: "Half-elf", culture: "" }).id).toBe("half-elf");
    expect(raceOf({ race: "Starborn", culture: "" }).id).toBe("someone");
    expect(classesOf(c).map((k) => k.id)).toEqual(["ranger", "shaman"]);
    expect(classesOf({ cls: "", cls2: "" }).map((k) => k.id)).toEqual(["fighter"]);
    expect(figureOf(c)).toBe("lorc_bowman");
    // A swashbuckler is a rogue in a hood, like any rogue (the GM can choose the fencer).
    expect(figureFor({ id: "rogue" }, "Swashbuckler")).toBe("darkzaitzev_hooded-assassin");
    expect(figureFor({ id: "samurai" })).toBe("darkzaitzev_running-ninja");
    // The GM's choice, if it's one of the figures.
    const chosen: Character = { ...c, figure: "lorc_bowman-woman" };
    expect(figureOf(chosen)).toBe("lorc_bowman-woman");
    expect(classFigureOf(chosen)).toBe("lorc_bowman");
    expect(figureOf({ ...c, figure: "lorc_no-such-figure" })).toBe("lorc_bowman");
  });

  it("uploads their figure under a name for what it's drawn from, so a changed sheet gets a new one", () => {
    const c = cleanCharacter(raw)!;
    const name = characterAssetName(c);
    expect(name).toMatch(/^Testa Brightwood · figure [0-9a-z]+$/);
    expect(characterAssetName({ ...c })).toBe(name);
    // A second class, a corrected race, or another sheet of the same name: another figure.
    expect(characterAssetName({ ...c, cls2: "Mage" })).not.toBe(name);
    expect(characterAssetName({ ...c, culture: "Danae" })).not.toBe(name);
    expect(characterAssetName({ ...c, id: "1Another0000000000000000000000000" })).not.toBe(name);
    // Another figure chosen by the GM is another token; one that isn't a figure changes nothing.
    expect(characterAssetName({ ...c, figure: "lorc_bowman-woman" })).not.toBe(name);
    expect(characterAssetName({ ...c, figure: "lorc_no-such-figure" })).toBe(name);
    // HP and the rest don't change the drawing.
    expect(characterAssetName({ ...c, hp: 3 } as Character)).toBe(name);
    expect(characterAssetName({ ...c, picture: "abcdef1234" })).toBe("Testa Brightwood · picture abcdef12");
    expect(characterAssetName({ ...c, name: "N".repeat(80) }).length).toBeLessThanOrEqual(60);
  });
});

/** A made-up Character tab, in the sheet's layout: labels in A and F, values beside them. */
function characterTab(): string[][] {
  const v = Array.from({ length: 160 }, () => Array<string>(8).fill(""));
  const put = (row: number, col: number, label: string, value: string) => {
    v[row][col] = label;
    v[row][col + 1] = value;
  };
  v[0][0] = "Testa Brightwood";
  v[0][7] = "Human (Wyddin) • Level 4 Ranger — Bushmaster / Level 5 Shaman";
  put(5, 0, "Player", "Sam");
  put(6, 0, "Race", "Human");
  put(7, 0, "Culture (humans)", "Wyddin");
  put(8, 0, "Class", "Ranger");
  put(9, 0, "Subclass / path", "Bushmaster");
  put(11, 0, "Second class (optional)", "Shaman");
  put(12, 0, "Second subclass / path", "");
  put(16, 0, "Current HP", "34");
  put(16, 5, "Combat AC", "5");
  put(17, 0, "Maximum HP", "49");
  put(20, 0, "Initiative bonus", "+2");
  put(22, 0, "Current spell points", "30");
  put(22, 5, "AC with shield", "7");
  put(23, 0, "Maximum spell points", "39");
  put(27, 5, "Melee damage", "+2");
  v[44] = ["Weapon", "Damage", "Range", "Properties · inventory", "", "Proficient?", "To-hit", "Damage bonus · sneak attack"];
  v[45] = ["Longbow", "1d8", "50/250", "Ammunition", "", "Yes", "0 missile", "no STR bonus"];
  v[46] = ["Dagger", "1d4", "7/20", "Finesse", "", "Yes", "+1 · thrown 0", "dmg +2"];
  return v;
}

/** The Apps Script, run here with Google's services played by stand-ins. */
async function runScript(
  folderId: string | null,
  files: { id: string; tab: string[][] | null; spells?: string[][]; tabs?: Record<string, string[][]>; trashed?: boolean; broken?: boolean }[],
) {
  const code = await source("scripts/character-sheets.gs");
  const services = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => (k === "FOLDER_ID" ? folderId : null) }) },
    DriveApp: {
      getFolderById: (id: string) => {
        if (id !== "folder1") throw new Error("not found");
        let i = 0;
        return {
          getFilesByType: () => ({
            hasNext: () => i < files.length,
            next: () => {
              const f = files[i++];
              return { getId: () => f.id, isTrashed: () => f.trashed === true };
            },
          }),
        };
      },
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        const f = files.find((x) => x.id === id)!;
        if (f.broken) throw new Error("Service Spreadsheets timed out");
        return {
          getId: () => id,
          getName: () => "Sheet",
          getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
          getSheetByName: (n: string) => {
            const tab = n === "Character" ? f.tab : n === "Spells" ? f.spells : (f.tabs?.[n] ?? null);
            return tab ? { getRange: () => ({ getDisplayValues: () => tab }) } : null;
          },
        };
      },
    },
    MimeType: { GOOGLE_SHEETS: "sheets" },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  const run = new Function(...Object.keys(services), `${code}\nreturn doGet();`);
  return run(...Object.values(services)) as { characters?: unknown[]; unread?: string[]; error?: string };
}

describe("the GM's Apps Script", () => {
  it("reads each character sheet in the folder by its labels, and leaves out anything else", async () => {
    const out = await runScript("folder1", [
      { id: SHEET, tab: characterTab() },
      { id: "1NotACharacterSheet000000000000000", tab: null },
      { id: "1InTheBin0000000000000000000000000", tab: characterTab(), trashed: true },
    ]);
    expect(out.characters).toHaveLength(1);
    // (No Spells tab here: an empty list of spells.)
    expect(cleanCharacter(out.characters![0])).toEqual({ ...cleanCharacter(raw), spells: [] });
    expect(out.unread).toEqual([]);
  });

  it("reads a rogue's Sneak Attack rank from the skills, however far down the tab they are", async () => {
    const tab = characterTab();
    tab[118] = ["Skill", "Rank", "Points", "What it gives you", "", "", "", ""];
    tab[119] = ["Sneak Attack", "4", "11", "· Rogue only", "", "", "", ""];
    // The sheet's note about the rule isn't the skill.
    tab[60] = ["Sneak Attack (p75; DM: always d6): melee adds rank × d6, ranged adds (rank − 1)d6.", "", "", "", "", "", "", ""];
    const out = await runScript("folder1", [{ id: SHEET, tab }]);
    expect(cleanCharacter(out.characters![0])!.sneakRank).toBe(4);
    const plain = await runScript("folder1", [{ id: SHEET, tab: characterTab() }]);
    expect(cleanCharacter(plain.characters![0])!.sneakRank).toBeNull();
  });

  it("reads the spells under the Spells tab's heading, without what the sheet says was prayed for", async () => {
    const spells = Array.from({ length: 400 }, () => Array<string>(11).fill(""));
    spells[0] = ["Spells", "Mage spells →", "", "", "", "", "", "Cleric spells →", "", "", "HP 34 / 34"];
    spells[3] = ["Spell (your classes' list)", "Level", "SP", "Prayer", "Prayed today", "Type", "Kind", "Class", "Quick use", "Component", "Notes"];
    spells[4] = ["Light (R)", "1", "1+", "Pray", "1", "Utility", "", "Cleric", "Light, or darkness", "None", ""];
    spells[6] = ["Magic Missile", "1", "1+", "", "", "Damage", "Rune", "Mage", "Darts", "None", ""];
    spells[7] = ["Earthmaw", "4", "5+", "Pray", "", "Damage", "", "Cleric", "Ground bites", "None", "Level 4: not castable yet"];
    const out = await runScript("folder1", [{ id: SHEET, tab: characterTab(), spells }]);
    expect(cleanCharacter(out.characters![0])!.spells).toEqual([
      { name: "Light (R)", level: 1, sp: "1+", prayer: "Pray", note: "" },
      { name: "Magic Missile", level: 1, sp: "1+", prayer: "", note: "" },
      { name: "Earthmaw", level: 4, sp: "5+", prayer: "Pray", note: "Level 4: not castable yet" },
    ]);
  });

  it("reads a Samurai's ki: the pool for their level from the level table, and the ki abilities they have", async () => {
    const tab = characterTab();
    tab[8] = ["Class", "Samurai", "", "", "", "", "", ""];
    tab[10] = ["Level · XP", "6", "XP", "40,000", "", "", "", ""];
    tab[11] = ["Second class (optional)", "Cleric", "", "", "", "", "", ""];
    tab[13] = ["Second class level · XP", "3", "XP", "4,000", "", "", "", ""];
    const ref = Array.from({ length: 400 }, () => Array<string>(11).fill(""));
    ref[0] = ["Key", "Class", "Level", "XP", "Hit dice", "Dice", "Flat HP", "Weapon prof gained", "Spell points", "Spell level", "Extra columns"];
    ref[42] = ["Samurai|5", "Samurai", "5", "", "", "", "", "", "", "", "KI Abilities 2; KI 12"];
    ref[43] = ["Samurai|6", "Samurai", "6", "", "", "", "", "", "", "", "KI 14"];
    ref[60] = ["Cleric|3", "Cleric", "3", "", "", "", "", "", "", "", ""];
    const features = Array.from({ length: 200 }, () => Array<string>(5).fill(""));
    features[3] = ["Level", "Feature", "From", "Status", "Summary"];
    features[4] = ["2", "Disarm", "Samurai ki (choose)", "Choose", "Cost: 3 ki. After a successful weapon attack..."];
    features[5] = ["2", "Ki abilities", "Samurai", "Active", "Gains Omen plus two other Ki abilities of choice and a ki pool (see ki / level table)."];
    features[6] = ["2", "Omen", "Samurai ki (choose)", "Active", "Cost: 3 ki. Divination: a natural worldly event hints at what the near future may hold."];
    const out = await runScript("folder1", [{ id: SHEET, tab, tabs: { "Ref Levels": ref, Features: features } }]);
    expect(cleanCharacter(out.characters![0])!.ki).toEqual({
      max: 14,
      abilities: [{ name: "Omen", cost: 3, note: "Cost: 3 ki. Divination: a natural worldly event hints at what the near future may hold." }],
    });
    // Another class: no ki.
    const plain = await runScript("folder1", [{ id: SHEET, tab: characterTab(), tabs: { "Ref Levels": ref, Features: features } }]);
    expect(cleanCharacter(plain.characters![0])!.ki).toBeUndefined();
  });

  it("says which sheets it couldn't open just now, rather than leaving them out silently", async () => {
    const out = await runScript("folder1", [
      { id: SHEET, tab: characterTab() },
      { id: "1Busy00000000000000000000000000000", tab: characterTab(), broken: true },
    ]);
    expect(out.characters).toHaveLength(1);
    expect(out.unread).toEqual(["1Busy00000000000000000000000000000"]);
  });

  it("says what's wrong when it isn't set up", async () => {
    expect((await runScript(null, [])).error).toMatch(/FOLDER_ID/);
    expect((await runScript("elsewhere", [])).error).toMatch(/isn.t a folder/);
  });
});

/** A stand-in for the Workers cache. */
function memoryCache() {
  const kept = new Map<string, string>();
  return {
    kept,
    cache: {
      match: async (r: Request) => (kept.has(r.url) ? new Response(kept.get(r.url)) : undefined),
      put: async (r: Request, res: Response) => void kept.set(r.url, await res.text()),
      delete: async (r: Request) => kept.delete(r.url),
    } as unknown as Cache,
  };
}

describe("the Worker's reading of the party", () => {
  const URL_ = "https://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec";
  const env = (
    source: string | null,
    pictures: Record<string, string> = {},
    figures: Record<string, string> = {},
    matched: Record<string, string[]> = {},
    players: Record<string, { userId: string; name: string }[]> = {},
    prayed: Record<string, Record<string, number>> = {},
  ) => ({
    directory: {
      charactersSource: async () => source,
      characterFigures: async () => figures,
      characterStrMatched: async () => matched,
      characterPlayers: async () => players,
      characterPrayed: async () => prayed,
    },
    files: { head: async (key: string) => (pictures[key] ? { httpEtag: `"${pictures[key]}"` } : null) },
  });

  it("gives each character the browsers playing them, at once and without reading the sheets again", async () => {
    const { cache } = memoryCache();
    const fetcher = vi.fn(async () => Response.json({ characters: [raw] }));
    const before = await party.readParty(env(URL_), cache, fetcher as unknown as typeof fetch, 1000);
    expect(before.characters[0].players).toBeUndefined();
    const playing = [{ userId: "browserAAAA1234", name: "Ann" }];
    const picked = await party.readParty(env(URL_, {}, {}, {}, { [SHEET]: playing }), cache, fetcher as unknown as typeof fetch, 2000);
    expect(picked.characters[0].players).toEqual(playing);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // A sheet can't name its own players.
    const sneaky = vi.fn(async () => Response.json({ characters: [{ ...raw, players: playing }] }));
    const read = await party.readParty(env(URL_), memoryCache().cache, sneaky as unknown as typeof fetch, 3000);
    expect(read.characters[0].players).toBeUndefined();
  });

  it("gives each character the ranged weapons the GM marked as matched to their strength", async () => {
    const { cache } = memoryCache();
    const fetcher = vi.fn(async () => Response.json({ characters: [raw] }));
    const r = await party.readParty(env(URL_, {}, {}, { [SHEET]: ["Longbow"] }), cache, fetcher as unknown as typeof fetch, 1000);
    expect(r.characters[0].strMatched).toEqual(["Longbow"]);
    expect(r.characters[0].strBonus).toBe(2);
    const none = await party.readParty(env(URL_), cache, fetcher as unknown as typeof fetch, 2000);
    expect(none.characters[0].strMatched).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const ok of ["Longbow", "Crossbow, heavy"]) expect(party.isWeaponName(ok), ok).toBe(true);
    for (const bad of ["", " Longbow", "x".repeat(61), "bow\u0000", 3]) expect(party.isWeaponName(bad), String(bad)).toBe(false);
  });

  it("gives each character the figure the GM chose, at once and without reading the sheets again", async () => {
    const { cache } = memoryCache();
    const fetcher = vi.fn(async () => Response.json({ characters: [raw] }));
    const before = await party.readParty(env(URL_), cache, fetcher as unknown as typeof fetch, 1000);
    expect(before.characters[0].figure).toBeUndefined();
    const chosen = await party.readParty(env(URL_, {}, { [SHEET]: "lorc_bowman-woman" }), cache, fetcher as unknown as typeof fetch, 2000);
    expect(chosen.characters[0].figure).toBe("lorc_bowman-woman");
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Back to their class's: gone from the reading too (the kept one never had it).
    const back = await party.readParty(env(URL_), cache, fetcher as unknown as typeof fetch, 3000);
    expect(back.characters[0].figure).toBeUndefined();
    expect(party.FIGURE_ICON.test("lorc_bowman-woman")).toBe(true);
    for (const bad of ["../x", "lorc", "Lorc_Bowman", "lorc_bowman/../../x", `a_${"b".repeat(60)}`]) expect(party.FIGURE_ICON.test(bad), bad).toBe(false);
  });

  it("asks the script, keeps the answer half a minute, and marks a chosen picture", async () => {
    const { cache } = memoryCache();
    const fetcher = vi.fn(async () => Response.json({ characters: [raw, { ...raw, id: "1Another0000000000000000000000000", name: "Abel Ash" }] }));
    const first = await party.readParty(env(URL_, { [`characters/${SHEET}`]: "etag123" }), cache, fetcher as unknown as typeof fetch, 1000);
    expect(first.configured).toBe(true);
    expect(first.characters.map((c) => c.name)).toEqual(["Abel Ash", "Testa Brightwood"]);
    expect(first.characters[1].picture).toBe("etag123");
    expect(first.characters[0].picture).toBeUndefined();
    await party.readParty(env(URL_), cache, fetcher as unknown as typeof fetch, 20_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await party.readParty(env(URL_), cache, fetcher as unknown as typeof fetch, 40_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("says when it isn't set up, and passes on why the sheets couldn't be read (without keeping that)", async () => {
    const { cache, kept } = memoryCache();
    expect(await party.readParty(env(null), cache, fetch, 5)).toEqual({ configured: false, characters: [], readAt: 5 });
    const broken = vi.fn(async () => new Response("<html>sign in</html>", { status: 200 }));
    const r = await party.readParty(env(URL_), cache, broken as unknown as typeof fetch);
    expect(r.error).toMatch(/didn't answer properly/);
    expect(kept.size).toBe(0);
    const says = vi.fn(async () => Response.json({ error: "FOLDER_ID is not set." }));
    expect((await party.askScript(URL_, says as unknown as typeof fetch)).error).toBe("The character sheets' script says: FOLDER_ID is not set.");
    const down = vi.fn(async () => Promise.reject(new Error("timeout")));
    expect((await party.askScript(URL_, down as unknown as typeof fetch)).error).toMatch(/didn't answer in time/);
  });

  it("gives the last good reading, with why, when the sheets can't be read", async () => {
    const { cache } = memoryCache();
    const good = vi.fn(async () => Response.json({ characters: [raw] }));
    await party.readParty(env(URL_), cache, good as unknown as typeof fetch, 1000);
    const down = vi.fn(async () => Promise.reject(new Error("timeout")));
    const r = await party.readParty(env(URL_), cache, down as unknown as typeof fetch, 60_000);
    expect(r.error).toMatch(/didn't answer in time/);
    expect(r.characters.map((c) => c.name)).toEqual(["Testa Brightwood"]);
    // And once they can be read again, they are.
    const back = vi.fn(async () => Response.json({ characters: [{ ...raw, hp: "20" }] }));
    const again = await party.readParty(env(URL_), cache, back as unknown as typeof fetch, 61_000);
    expect([again.error, again.characters[0].hp]).toEqual([undefined, 20]);
  });

  it("keeps a sheet's last reading when the script couldn't open it just now, and only then", async () => {
    const { cache } = memoryCache();
    const other = { ...raw, id: "1Another0000000000000000000000000", name: "Abel Ash" };
    const both = vi.fn(async () => Response.json({ characters: [raw, other] }));
    await party.readParty(env(URL_), cache, both as unknown as typeof fetch, 1000);
    const busy = vi.fn(async () => Response.json({ characters: [raw], unread: [other.id, "../x"] }));
    const r = await party.readParty(env(URL_), cache, busy as unknown as typeof fetch, 40_000);
    expect(r.characters.map((c) => c.name)).toEqual(["Abel Ash", "Testa Brightwood"]);
    // A sheet that's gone from the folder is gone from the party.
    const gone = vi.fn(async () => Response.json({ characters: [raw] }));
    const later = await party.readParty(env(URL_), cache, gone as unknown as typeof fetch, 80_000);
    expect(later.characters.map((c) => c.name)).toEqual(["Testa Brightwood"]);
  });

  it("reads the sheets again after a new picture, still with the last reading to fall back on", async () => {
    const { cache } = memoryCache();
    const good = vi.fn(async () => Response.json({ characters: [raw] }));
    const now = Date.now();
    await party.readParty(env(URL_), cache, good as unknown as typeof fetch, now);
    await party.forgetParty(env(URL_), cache);
    const down = vi.fn(async () => new Response("nope", { status: 500 }));
    const r = await party.readParty(env(URL_), cache, down as unknown as typeof fetch, now + 1000);
    expect(down).toHaveBeenCalledTimes(1);
    expect(r.characters).toHaveLength(1);
    expect(r.error).toBeTruthy();
  });

  it("takes only an Apps Script web app's address", () => {
    expect(party.SCRIPT_URL.test(URL_)).toBe(true);
    for (const bad of ["https://evil.example/exec", "https://script.google.com/macros/s/x/exec", `${URL_}?x=1`, "http://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec"]) {
      expect(party.SCRIPT_URL.test(bad), bad).toBe(false);
    }
  });
});

describe("a token for a character", () => {
  const token = { id: "tok1", sceneId: "scene1", kind: "token", x: 10, y: 10, size: 1, assetId: null, color: "#ff0000", label: "Testa" };
  it("keeps its sheet's id, and drops one that isn't", () => {
    expect((sanitizeItem({ ...token, character: SHEET }, "@gm") as TokenItem).character).toBe(SHEET);
    expect((sanitizeItem({ ...token, character: "../x" }, "@gm") as TokenItem).character).toBeUndefined();
    expect((sanitizeItem(token, "@gm") as TokenItem).character).toBeUndefined();
  });

  it("can be linked to a sheet, or unlinked, afterwards", () => {
    const item = sanitizeItem(token, "@gm") as Item;
    expect(sanitizeSet(item, { character: SHEET })).toEqual({ character: SHEET });
    expect(sanitizeSet(item, { character: null })).toEqual({ character: null });
    expect(sanitizeSet(item, { character: "nope" })).toBeNull();
  });
});

describe("a page's party", () => {
  const reply = (over: Partial<CharactersReply>): CharactersReply => ({ configured: true, characters: [cleanCharacter(raw)!], readAt: 1, ...over });
  const answering = (body: CharactersReply) => vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body));

  it("follows the sheets, and keeps the last reading when the Worker has none to give", async () => {
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    try {
      answering(reply({}));
      await room.refreshParty();
      expect(room.state.party?.characters.map((c) => c.name)).toEqual(["Testa Brightwood"]);
      expect(room.characterOf({ character: SHEET })?.hp).toBe(34);
      answering(reply({ characters: [], error: "The character sheets didn't answer in time." }));
      await room.refreshParty();
      expect(room.state.party?.characters).toHaveLength(1);
      expect(room.state.party?.error).toMatch(/didn't answer/);
      // Stopping reading them (or an empty folder) does empty it.
      answering(reply({ characters: [] }));
      await room.refreshParty();
      expect(room.state.party?.characters).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("shows who plays whom at once, from the answer, without reading the sheets again", async () => {
    const room = new RoomClient("AbCdEf123456", { uid: "user1abcdef", name: "Ann", color: "#ff0000" });
    try {
      answering(reply({}));
      await room.refreshParty();
      const c = room.state.party!.characters[0];
      const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, players: { [SHEET]: [{ userId: "user1abcdef", name: "Ann" }] } }));
      sent.mockClear();
      const reread = vi.spyOn(room, "refreshParty");
      await setCharacterPlayer(room, c, true);
      const [url, init] = sent.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/characters/${SHEET}/player?room=AbCdEf123456`);
      expect((init.headers as Record<string, string>)["X-Tabletop-User"]).toBe("user1abcdef");
      expect(JSON.parse(String(init.body))).toEqual({ playing: true, name: "Ann" });
      expect(room.state.party!.characters[0].players).toEqual([{ userId: "user1abcdef", name: "Ann" }]);
      expect(reread).not.toHaveBeenCalled();
      // Nobody plays them any more: gone from the list too.
      sent.mockImplementation(async () => Response.json({ ok: true, players: {} }));
      await setCharacterPlayer(room, c, false);
      expect(room.state.party!.characters[0].players).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("in Tabletop", () => {
  it("puts the party at the top of Tokens & images, a card on a character's token, and their bonus on initiative", async () => {
    const library = await source("src/client/ui/LibraryPanel.tsx");
    expect(library.indexOf("<PartySection />")).toBeGreaterThan(0);
    expect(library.indexOf("<PartySection />")).toBeLessThan(library.indexOf("<h3>Quick token</h3>"));
    // The card stands beside the bar, not in it (a phone's bar scrolls when it's very tall, which would
    // clip it): over it on a phone, docked to the right above it on a bigger screen. It's guarded, so a
    // card that fails to draw leaves the bar.
    const bar = await source("src/client/ui/SelectionBar.tsx");
    expect(bar).toMatch(
      /<div class="selbar-stack".*\r?\n\s*<Guard name="the character card" retry=\{\(s\) => s\.party\}>\r?\n\s*<CharacterCard c=\{character\} tokenId=\{t\.id\} \/>\r?\n\s*<\/Guard>\r?\n\s*\{bar\}/,
    );
    expect(bar).toMatch(
      /<div class="card-dock".*\r?\n\s*<Guard name="the character card" retry=\{\(s\) => s\.party\}>\r?\n\s*<CharacterCard c=\{character\} tokenId=\{t\.id\} \/>/,
    );
    expect(bar).toContain("value: initiativeRoll(character)");
    expect(await source("src/client/ui/InitiativePanel.tsx")).toContain("value: initiativeRoll(room.characterOf(t))");
  });

  it("is in What's new and has a section of its own, which Room settings links to", async () => {
    expect(GUIDE[0].parts[18].title).toBe("The party's own tokens, cards and rolls, from their character sheets (28 October 2026)");
    expect(GUIDE[0].intro).toContain("The latest updates came out on 31 October 2026.");
    const section = GUIDE.find((s) => s.id === "character-sheets")!;
    expect(section.parts.map((p) => p.title)).toEqual(["Place your character", "A character's card", "Initiative from the sheet", "Set up the character sheets (GM)", "A character's figure, or a picture of your own (GM)"]);
    expect(await source("src/client/ui/CharacterSheetsSettings.tsx")).toContain('href="/guide#character-sheets"');
  });
});

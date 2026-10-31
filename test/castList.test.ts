// A character's Spells list on their card (31 October 2026): their sheet's spells that the Spells
// tool can show, matched by name; what they've prayed for today, chosen in Table by their player or
// the GM (not read from the sheet); casting from their token; and a cast using a prayer and its
// spell points up (the points on the sheet itself, through the GM's script).
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { cantCast, castAs, castFromCard, castLine, castRaise, castRounds, castingAs, mayPray, newPrayerDay, payForCast, setPrayed, spendPrayer, spendSpellPoints } from "../src/client/party";
import { RoomClient } from "../src/client/room/client";
import { MAX_PRAYED, MAX_SPEND, castCost, cleanCharacter, spellCost, type Character, type CharactersReply } from "../src/shared/characters";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import { castList, highestLevel, roundsAt, sizeAt, tableSpellsFor, zoneSpell } from "../src/shared/spellfx";
import type { Player, Scene, TokenItem } from "../src/shared/types";

interface Party {
  readParty(env: unknown, cache: Cache | null, fetcher: typeof fetch, now?: number): Promise<CharactersReply>;
  playsCharacter(directory: unknown, sheetId: string, userId: string | null): Promise<boolean>;
  prayedChange(body: unknown): unknown;
  spendOnSheet(source: string, key: string, sheetId: string, spend: number, fetcher: typeof fetch): Promise<{ sp: number } | { error: string }>;
}
const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;
const nodeFs = await import(/* @vite-ignore */ "node:" + "fs");

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const spell = (name: string, level: number, prayer: string, note = "") => ({ name, level, sp: `${level}+`, prayer, note });
const caster = (over: Partial<Character> = {}): Character => ({
  ...cleanCharacter({
    id: SHEET,
    name: "Testa Brightwood",
    hp: "20",
    maxHp: "20",
    sp: "12",
    maxSp: "12",
    attacks: [],
    spells: [
      spell("Light (R)", 1, "Pray"),
      spell("Faerie Fire", 1, "Free"),
      spell("battle song", 2, "Pray"),
      spell("Detect Magic (1)", 1, "Free"),
      spell("Moonbeam", 2, "Memorize"),
      spell("Dispel Magic", 3, "Ask DM"),
      spell("Earthmaw", 4, "Pray", "Level 4: not castable yet"),
      spell("Magic Missile", 1, ""),
    ],
  })!,
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a sheet's spells, as the Spells tool knows them", () => {
  it("are matched however the sheet writes them", () => {
    expect(tableSpellsFor("Light (R)")).toEqual(["Light", "Light (reversed)"]);
    expect(tableSpellsFor("Cure wounds (R)")).toEqual(["Cure wounds"]);
    expect(tableSpellsFor("battle song")).toEqual(["Battle Song"]);
    expect(tableSpellsFor("Protection from spirits")).toEqual(["Protection from Spirits"]);
    expect(tableSpellsFor("Detect Magic (1)")).toEqual([]);
    expect(tableSpellsFor("Bat’s Ear")).toEqual([]);
  });

  it("list them all, castable first by level, with the prayed-for ones' casts left", () => {
    const list = castList(caster({ prayed: { "Light (R)": 2 } }));
    expect(list.map((s) => s.name)).toEqual(["Detect Magic", "Faerie Fire", "Light", "Light (reversed)", "Magic Missile", "Battle Song", "Moonbeam", "Dispel Magic", "Earthmaw"]);
    const of = (name: string) => list.find((s) => s.name === name)!;
    expect(of("Light")).toMatchObject({ prayer: true, left: 2, locked: false });
    expect(of("Light (reversed)")).toMatchObject({ prayer: true, left: 2 });
    expect(of("Moonbeam")).toMatchObject({ prayer: true, left: 0 });
    expect(of("Faerie Fire")).toMatchObject({ prayer: false });
    expect(of("Magic Missile")).toMatchObject({ prayer: false });
    expect(of("Dispel Magic").prayer).toBe(false);
    expect(of("Earthmaw").locked).toBe(true);
  });

  it("come through the Worker clipped and plain, and are missing from an older script", () => {
    const long = cleanCharacter({ id: SHEET, name: "A", spells: [{ name: "x".repeat(99), level: "12", sp: 3, prayer: "Pray", note: "" }, { name: "" }] })!;
    expect(long.spells).toEqual([{ name: "x".repeat(60), level: 9, sp: "3", prayer: "Pray", note: "" }]);
    expect("spells" in cleanCharacter({ id: SHEET, name: "A" })!).toBe(false);
  });
});

describe("what's been prayed for, at the Worker", () => {
  it("is given with each character, as chosen", async () => {
    const directory = {
      charactersSource: async () => "https://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec",
      characterFigures: async () => ({}),
      characterStrMatched: async () => ({}),
      characterPlayers: async () => ({}),
      characterPrayed: async () => ({ [SHEET]: { "Light (R)": 1 } }),
    };
    const fetcher = vi.fn(async () => Response.json({ characters: [{ id: SHEET, name: "Testa Brightwood", spells: [spell("Light (R)", 1, "Pray")] }] }));
    const reply = await party.readParty({ directory, files: { head: async () => null } }, null, fetcher as unknown as typeof fetch, 1000);
    expect(reply.characters[0].prayed).toEqual({ "Light (R)": 1 });
  });

  it("is chosen by a browser playing the character (or the GM), not anyone else", async () => {
    const directory = { characterPlayers: async () => ({ [SHEET]: [{ userId: "player1abcdef", name: "P" }] }) };
    expect(await party.playsCharacter(directory, SHEET, "player1abcdef")).toBe(true);
    expect(await party.playsCharacter(directory, SHEET, "someone1else")).toBe(false);
    expect(await party.playsCharacter(directory, SHEET, null)).toBe(false);
    expect(await party.playsCharacter(directory, "1Another00000000000000000000", "player1abcdef")).toBe(false);
  });

  it("changes a spell's casts left, or starts a new day, and nothing else", () => {
    expect(party.prayedChange({ spell: "Light (R)", left: 2 })).toEqual({ spell: "Light (R)", left: 2 });
    expect(party.prayedChange({ newDay: true })).toEqual({ newDay: true });
    for (const bad of [{ spell: "Light", left: -1 }, { spell: "Light", left: MAX_PRAYED + 1 }, { spell: "Light", left: 1.5 }, { spell: " Light", left: 1 }, { spell: "", left: 1 }, { spell: "x".repeat(61), left: 1 }, null]) {
      expect(party.prayedChange(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

function page(me: Player) {
  const room = new RoomClient("AbCdEf123456", { uid: me.userId, name: me.name, color: me.color });
  const scene: Scene = { id: "scene1", name: "Crypt", order: 0, mapAssetId: null, width: 1400, height: 1000, background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 0 };
  const token: TokenItem = {
    id: "tok1",
    sceneId: "scene1",
    kind: "token",
    z: 1,
    owner: GM_OWNER,
    x: 140,
    y: 140,
    size: 1,
    rotation: 0,
    assetId: null,
    color: "#d62f2f",
    label: "Testa",
    hidden: false,
    locked: false,
    rings: [],
    character: SHEET,
  };
  room.store.set({
    me,
    room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    scenes: { scene1: scene },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
    items: { tok1: token },
    party: { configured: true, readAt: 1, characters: [caster({ players: [{ userId: "player1abcdef", name: "P" }], prayed: { "Light (R)": 1 } })] },
  });
  return room;
}
const gm: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };
const theirPlayer: Player = { connId: "c2", userId: "player1abcdef", name: "P", color: "#00ff00", role: "player" };
const otherPlayer: Player = { connId: "c3", userId: "someone1else", name: "O", color: "#0000ff", role: "player" };

describe("on a page", () => {
  it("lets the GM and the character's player choose their prayers, and no one else", () => {
    for (const [me, can] of [
      [gm, true],
      [theirPlayer, true],
      [otherPlayer, false],
    ] as const) {
      const room = page(me);
      expect(mayPray(room, room.state.party!.characters[0]), me.name).toBe(can);
    }
  });

  it("shows a prayer chosen at once, and sends it for the character's player", async () => {
    const room = page(theirPlayer);
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, prayed: { "Light (R)": 1, Moonbeam: 2 } }));
    const done = setPrayed(room, room.state.party!.characters[0], "Moonbeam", 2);
    expect(room.state.party!.characters[0].prayed).toEqual({ "Light (R)": 1, Moonbeam: 2 });
    await done;
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/characters/${SHEET}/prayed?room=AbCdEf123456`);
    expect((init.headers as Record<string, string>)["X-Tabletop-User"]).toBe("player1abcdef");
    expect(JSON.parse(String(init.body))).toEqual({ spell: "Moonbeam", left: 2 });
    sent.mockImplementation(async () => Response.json({ ok: true, prayed: {} }));
    await newPrayerDay(room, room.state.party!.characters[0]);
    expect(room.state.party!.characters[0].prayed).toEqual({});
  });

  it("casts a spell picked from the card from the character's token, and uses a prayer up", () => {
    const room = page(theirPlayer);
    castAs(room, "tok1", "Light");
    expect(room.state.tool).toBe("spell");
    expect(room.state.spellOpts).toMatchObject({ spell: "Light", caster: "tok1" });
    const as = castingAs(room, "Light")!;
    expect(as.character.name).toBe("Testa Brightwood");
    expect(cantCast(as)).toBeNull();
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, prayed: {} }));
    spendPrayer(room, as);
    expect(room.state.party!.characters[0].prayed).toEqual({});
    expect(JSON.parse(String((sent.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ spell: "Light (R)", left: 0 });
    // None left: it isn't cast again until it's prayed for.
    expect(cantCast(castingAs(room, "Light")!)).toMatch(/hasn't prayed for Light today/);
    // A spell that needn't be prayed for is always there, and uses nothing up.
    sent.mockClear();
    const free = castingAs(room, "Faerie Fire")!;
    expect(cantCast(free)).toBeNull();
    spendPrayer(room, free);
    expect(sent).not.toHaveBeenCalled();
  });

  it("doesn't use up another player's character's prayers", () => {
    const room = page(otherPlayer);
    castAs(room, "tok1", "Light");
    const sent = vi.spyOn(globalThis, "fetch");
    spendPrayer(room, castingAs(room, "Light")!);
    expect(sent).not.toHaveBeenCalled();
    expect(room.state.party!.characters[0].prayed).toEqual({ "Light (R)": 1 });
  });
});

describe("spell points", () => {
  it("cost what the sheet's SP says at the spell's own level, and a cantrip nothing", () => {
    expect(spellCost("2")).toBe(2);
    expect(spellCost("2+")).toBe(2);
    expect(spellCost("5+")).toBe(5);
    expect(spellCost("7/day")).toBe(0);
    expect(spellCost("")).toBe(0);
    expect(spellCost("99")).toBe(MAX_SPEND);
  });

  it("stop a spell the character can't afford", () => {
    const room = page(theirPlayer);
    room.store.set({ party: { ...room.state.party!, characters: [{ ...room.state.party!.characters[0], sp: 1, prayed: { Moonbeam: 1 } }] } });
    castAs(room, "tok1", "Moonbeam");
    expect(cantCast(castingAs(room, "Moonbeam")!)).toBe("Testa has 1 spell point left, and Moonbeam costs 2.");
    expect(cantCast(castingAs(room, "Faerie Fire")!)).toBeNull();
  });

  it("come off the sheet when the character's player casts, shown at once", async () => {
    const room = page(theirPlayer);
    castAs(room, "tok1", "Moonbeam");
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, sp: 9 }));
    spendSpellPoints(room, castingAs(room, "Moonbeam")!);
    expect(room.state.party!.characters[0].sp).toBe(10);
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/characters/${SHEET}/spend?room=AbCdEf123456`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Tabletop-User"]).toBe("player1abcdef");
    expect(JSON.parse(String(init.body))).toEqual({ spend: 2 });
    await vi.waitFor(() => expect(room.state.party!.characters[0].sp).toBe(9));
  });

  it("say so when the sheet couldn't be changed, and read it again", async () => {
    const room = page(gm);
    castAs(room, "tok1", "Faerie Fire");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ error: "The script can't change spell points yet." }, { status: 502 }));
    const reread = vi.spyOn(room, "refreshParty").mockImplementation(async () => {});
    spendSpellPoints(room, castingAs(room, "Faerie Fire")!);
    await vi.waitFor(() => expect(reread).toHaveBeenCalled());
    expect(room.state.toasts.at(-1)).toMatchObject({ kind: "error", text: "The script can't change spell points yet." });
  });

  it("aren't spent by another player's page, or for a cantrip", () => {
    const sent = vi.spyOn(globalThis, "fetch");
    const other = page(otherPlayer);
    castAs(other, "tok1", "Faerie Fire");
    spendSpellPoints(other, castingAs(other, "Faerie Fire")!);
    const theirs = page(theirPlayer);
    castAs(theirs, "tok1", "Faerie Fire");
    spendSpellPoints(theirs, { ...castingAs(theirs, "Faerie Fire")!, entry: { ...castingAs(theirs, "Faerie Fire")!.entry!, sheet: { name: "Spark", level: 0, sp: "7/day", prayer: "", note: "" } } });
    expect(sent).not.toHaveBeenCalled();
  });

  it("are sent to the GM's script with Tabletop's key, and its answer read", async () => {
    const fetcher = vi.fn(async () => Response.json({ sp: 7 }));
    expect(await party.spendOnSheet("https://script.example/exec", "k".repeat(43), SHEET, 3, fetcher as unknown as typeof fetch)).toEqual({ sp: 7 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://script.example/exec");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ key: "k".repeat(43), id: SHEET, spend: 3 });
    const says = vi.fn(async () => Response.json({ error: "Not enough spell points.", sp: 1 }));
    expect(await party.spendOnSheet("https://script.example/exec", "k", SHEET, 3, says as unknown as typeof fetch)).toEqual({ error: "The spell points weren't taken off: Not enough spell points." });
    const old = vi.fn(async () => new Response("<html>Script function not found: doPost</html>", { status: 200 }));
    expect(await party.spendOnSheet("https://script.example/exec", "k", SHEET, 3, old as unknown as typeof fetch)).toMatchObject({ error: expect.stringContaining("needs to update it") });
  });
});

/** The GM's Apps Script's doPost, run here with Google's services played by stand-ins. */
async function runPost(body: unknown, sheet: { value: number; most?: number; formula?: string; inFolder?: boolean; trashed?: boolean; key?: string | null }) {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  const code = fs.readFileSync(new URL("../scripts/character-sheets.gs", import.meta.url), "utf8");
  const props: Record<string, string> = { FOLDER_ID: "folder1", ...(sheet.key ? { TABLE_KEY: sheet.key } : {}) };
  const written: number[] = [];
  const labels = Array.from({ length: 160 }, () => [""]);
  labels[22] = ["Current spell points", String(sheet.value)];
  if (sheet.most !== undefined) labels[23] = ["Maximum spell points", String(sheet.most)];
  const services = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null, setProperty: (k: string, v: string) => void (props[k] = v) }) },
    DriveApp: {
      getFileById: (id: string) => {
        if (id !== SHEET) throw new Error("not found");
        const parents = [{ getId: () => (sheet.inFolder === false ? "elsewhere" : "folder1") }];
        let i = 0;
        return { getId: () => id, isTrashed: () => sheet.trashed === true, getParents: () => ({ hasNext: () => i < parents.length, next: () => parents[i++] }) };
      },
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (n: string) =>
          n === "Character"
            ? {
                getRange: (a: string | number, col?: number) =>
                  typeof a === "string"
                    ? { getDisplayValues: () => labels }
                    : {
                        getFormula: () => (a === 23 && col === 2 ? (sheet.formula ?? "") : ""),
                        getValue: () => sheet.value,
                        setValue: (v: number) => void written.push(v),
                      },
              }
            : null,
      }),
    },
    MimeType: { GOOGLE_SHEETS: "sheets" },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  const run = new Function(...Object.keys(services), "e", `${code}\nreturn doPost(e);`);
  const out = run(...Object.values(services), { postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }) as { sp?: number; error?: string };
  return { out, written, props };
}

describe("casting at a higher level", () => {
  it("costs the sheets' points for the level cast at (a cantrip nothing)", () => {
    expect(castCost("1+", 1, 1)).toBe(1);
    expect(castCost("1+", 1, 3)).toBe(3);
    expect(castCost("1+", 1, 4)).toBe(5);
    expect(castCost("2+", 2, 5)).toBe(8);
    expect(castCost("7/day", 0, 3)).toBe(0);
  });

  it("goes up to the highest level the character casts at, and is its own level unless chosen", () => {
    const room = page(theirPlayer);
    castAs(room, "tok1", "Light");
    expect(castingAs(room, "Light")!.level).toBe(1);
    room.store.set({ spellOpts: { ...room.state.spellOpts, level: 3 } });
    expect(castingAs(room, "Light")!.level).toBe(3);
    expect(castRaise(room, "Light")).toBe(2);
    room.store.set({ spellOpts: { ...room.state.spellOpts, level: 9 } });
    // Their highest spell they can cast yet is Dispel Magic, at 3 (Earthmaw, at 4, isn't castable yet).
    expect(castingAs(room, "Light")!.level).toBe(3);
    expect(highestLevel(castList(room.state.party!.characters[0]))).toBe(3);
  });

  it("is refused when they can't afford that level, and says so", () => {
    const room = page(theirPlayer);
    room.store.set({ party: { ...room.state.party!, characters: [{ ...room.state.party!.characters[0], sp: 2 }] } });
    castAs(room, "tok1", "Light");
    room.store.set({ spellOpts: { ...room.state.spellOpts, level: 3 } });
    expect(cantCast(castingAs(room, "Light")!)).toBe("Testa has 2 spell points left, and Light costs 3.");
  });

  it("grows a spell whose area grows with its level", () => {
    expect(zoneSpell("Fog Cloud")).toMatchObject({ size: 8, perLevel: 8 });
    expect(sizeAt(8, 8, 2)).toBe(24);
    expect(sizeAt(5, undefined, 2)).toBe(5);
    expect(sizeAt(undefined, 2, 1)).toBeUndefined();
  });
});

describe("how long a spell left on the map lasts", () => {
  it("is the sheets' rounds where they give them, growing with the level", () => {
    expect(roundsAt("Wall of Fog", 0)).toBe(9);
    expect(roundsAt("Wall of Fog", 1)).toBe(11);
    expect(roundsAt("Fog Cloud", 0)).toBeNull();
  });

  it("is what's chosen in the Spells bar for that spell, or else the sheets'", () => {
    const room = page(gm);
    expect(castRounds(room, "Wall of Fog")).toBe(9);
    room.store.set({ spellOpts: { ...room.state.spellOpts, lasts: { spell: "Wall of Fog", rounds: 3 } } });
    expect(castRounds(room, "Wall of Fog")).toBe(3);
    expect(castRounds(room, "Acid Rain")).toBe(8);
    room.store.set({ spellOpts: { ...room.state.spellOpts, lasts: { spell: "Wall of Fog", rounds: null } } });
    expect(castRounds(room, "Wall of Fog")).toBeNull();
  });
});

describe("a cast in the chat", () => {
  it("says who cast what, at what level, on whom, for how much, and the prayers left", () => {
    const room = page(theirPlayer);
    castAs(room, "tok1", "Light");
    room.store.set({ spellOpts: { ...room.state.spellOpts, level: 3 } });
    expect(castLine(castingAs(room, "Light")!)).toBe("Testa casts Light at level 3 (3 SP, 0 prayed left today).");
    castAs(room, "tok1", "Faerie Fire");
    expect(castLine(castingAs(room, "Faerie Fire")!, { target: "Goblin", rounds: 4 })).toBe("Testa casts Faerie Fire on Goblin (1 SP, lasts 4 rounds).");
  });

  it("is posted by the page that pays for it, and not by another player's", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, sp: 11, prayed: {} }));
    const theirs = page(theirPlayer);
    castAs(theirs, "tok1", "Faerie Fire");
    const said = vi.spyOn(theirs, "sendChat").mockImplementation(() => {});
    payForCast(theirs, castingAs(theirs, "Faerie Fire")!, { target: "Goblin" });
    expect(said).toHaveBeenCalledWith("Testa casts Faerie Fire on Goblin (1 SP).");
    const other = page(otherPlayer);
    castAs(other, "tok1", "Faerie Fire");
    const quiet = vi.spyOn(other, "sendChat").mockImplementation(() => {});
    payForCast(other, castingAs(other, "Faerie Fire")!);
    expect(quiet).not.toHaveBeenCalled();
  });
});

describe("a spell with nothing on the map", () => {
  it("is on the card by its sheet's name, and not in the Spells tool's list", () => {
    const list = castList(caster());
    expect(list.find((s) => s.name === "Detect Magic")).toMatchObject({ onMap: false, sheet: { name: "Detect Magic (1)" } });
    expect(list.filter((s) => !s.onMap).map((s) => s.name)).toEqual(["Detect Magic"]);
    expect(list.find((s) => s.name === "Light")!.onMap).toBe(true);
    const fs = (nodeFs as { readFileSync(path: URL, encoding: "utf8"): string });
    expect(fs.readFileSync(new URL("../src/client/ui/Toolbar.tsx", import.meta.url), "utf8")).toContain("filter((sp) => sp.onMap && !sp.locked)");
  });

  it("is cast from the card: a line in the chat and its points off the sheet, at the level chosen", async () => {
    const room = page(theirPlayer);
    const entry = castList(room.state.party!.characters[0]).find((s) => s.name === "Detect Magic")!;
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, sp: 9 }));
    const said = vi.spyOn(room, "sendChat").mockImplementation(() => {});
    expect(castFromCard(room, room.state.party!.characters[0], entry, 3)).toBe(true);
    expect(said).toHaveBeenCalledWith("Testa casts Detect Magic at level 3 (3 SP).");
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/characters/${SHEET}/spend?room=AbCdEf123456`);
    expect(JSON.parse(String(init.body))).toEqual({ spend: 3 });
    await vi.waitFor(() => expect(room.state.party!.characters[0].sp).toBe(9));
    // At its own level unless one's chosen, and never above the highest they cast at (3).
    expect(castFromCard(room, room.state.party!.characters[0], entry)).toBe(true);
    expect(said).toHaveBeenLastCalledWith("Testa casts Detect Magic (1 SP).");
    expect(castFromCard(room, room.state.party!.characters[0], entry, 9)).toBe(true);
    expect(said).toHaveBeenLastCalledWith("Testa casts Detect Magic at level 3 (3 SP).");
  });

  it("isn't cast when they can't pay for it, or from another player's page", () => {
    const sent = vi.spyOn(globalThis, "fetch");
    const room = page(gm);
    const broke = { ...room.state.party!.characters[0], sp: 0 };
    const entry = castList(broke).find((s) => s.name === "Detect Magic")!;
    const said = vi.spyOn(room, "sendChat").mockImplementation(() => {});
    expect(castFromCard(room, broke, entry)).toBe(false);
    expect(room.state.toasts.at(-1)).toMatchObject({ kind: "error", text: "Testa has 0 spell points left, and Detect Magic costs 1." });
    const other = page(otherPlayer);
    const quiet = vi.spyOn(other, "sendChat").mockImplementation(() => {});
    expect(castFromCard(other, other.state.party!.characters[0], entry)).toBe(false);
    expect(said).not.toHaveBeenCalled();
    expect(quiet).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("the GM's script, changing spell points", () => {
  const KEY = "k".repeat(43);

  it("puts them back to the sheet's Maximum for a new day, never over a formula", async () => {
    const rest = await runPost({ key: KEY, id: SHEET, rest: true }, { value: 4, most: 15, key: KEY });
    expect(rest.out).toEqual({ sp: 15 });
    expect(rest.written).toEqual([15]);
    // Full already: nothing written.
    expect((await runPost({ key: KEY, id: SHEET, rest: true }, { value: 15, most: 15, key: KEY })).written).toEqual([]);
    for (const sheet of [{ value: 4, most: 15, key: KEY, formula: "=B24" }, { value: 4, key: KEY }]) {
      const { out, written } = await runPost({ key: KEY, id: SHEET, rest: true }, sheet);
      expect(out.error).toMatch(/works out Current spell points|no Maximum spell points/);
      expect(written).toEqual([]);
    }
    expect((await runPost({ key: "x".repeat(43), id: SHEET, rest: true }, { value: 4, most: 15, key: KEY })).out.error).toMatch(/key doesn.t match/);
  });

  it("keeps the first key it's sent, takes the points off, and then wants that key", async () => {
    const first = await runPost({ key: KEY, id: SHEET, spend: 3 }, { value: 12 });
    expect(first.out).toEqual({ sp: 9 });
    expect(first.written).toEqual([9]);
    expect(first.props.TABLE_KEY).toBe(KEY);
    const stranger = await runPost({ key: "x".repeat(43), id: SHEET, spend: 3 }, { value: 12, key: KEY });
    expect(stranger.out.error).toMatch(/key doesn.t match/);
    expect(stranger.written).toEqual([]);
    expect((await runPost({ key: "short", id: SHEET, spend: 1 }, { value: 12 })).out.error).toMatch(/key doesn.t match/);
  });

  it("changes nothing for a sheet outside the folder, a formula, too few points or a silly amount", async () => {
    for (const [body, sheet, why] of [
      [{ key: KEY, id: SHEET, spend: 1 }, { value: 12, key: KEY, inFolder: false }, /isn.t in the character sheets/],
      [{ key: KEY, id: SHEET, spend: 1 }, { value: 12, key: KEY, trashed: true }, /isn.t in the character sheets/],
      [{ key: KEY, id: "1Unknown0000000000000000", spend: 1 }, { value: 12, key: KEY }, /can.t be opened/],
      [{ key: KEY, id: SHEET, spend: 1 }, { value: 12, key: KEY, formula: "=B24-3" }, /works out Current spell points/],
      [{ key: KEY, id: SHEET, spend: 5 }, { value: 4, key: KEY }, /Not enough/],
      [{ key: KEY, id: SHEET, spend: 0 }, { value: 4, key: KEY }, /number of spell points/],
      [{ key: KEY, id: SHEET, spend: 1.5 }, { value: 4, key: KEY }, /number of spell points/],
      ["not json", { value: 4, key: KEY }, /isn.t a change/],
    ] as const) {
      const { out, written } = await runPost(body, sheet);
      expect(out.error, JSON.stringify(body)).toMatch(why);
      expect(written, JSON.stringify(body)).toEqual([]);
    }
  });
});

describe("in the guide", () => {
  it("leads What's new, and says how to cast from a card, pray for spells, what spell points come off, levels, rounds and the chat", async () => {
    expect(GUIDE[0].parts[5].title).toBe("Every spell on a caster's card, even with nothing to show on the map (31 October 2026)");
    expect(GUIDE[0].parts[6].title).toBe("Spells that end by themselves, casts in the chat, and casting at a higher level (31 October 2026)");
    expect(GUIDE[0].parts[7].title).toBe("Cast a character's spells from their card: prayers and spell points used up (31 October 2026)");
    const text = JSON.stringify(GUIDE.find((s) => s.id === "spells"));
    for (const words of ["**Pray for today**", "**New day**", "**Spells**", "**Spell points:**", "**A higher level:**", "**Lasts:**", "**In the chat:**", "**Nothing on the map:**", "**Cast**"]) expect(text).toContain(words);
    const bar = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const toolbar = bar.readFileSync(new URL("../src/client/ui/Toolbar.tsx", import.meta.url), "utf8");
    for (const words of ["<span>Level</span>", "<span>Lasts</span>", "<span>rounds</span>"]) expect(toolbar).toContain(words);
    expect(JSON.stringify(GUIDE.find((s) => s.id === "character-sheets"))).toContain("TABLE_KEY");
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const card = fs.readFileSync(new URL("../src/client/ui/CharacterCard.tsx", import.meta.url), "utf8");
    for (const words of ["Pray for today", "New day", "<span>Spells</span>", "<span>Level</span>", 'class="spell-cast"']) expect(card).toContain(words);
  });
});

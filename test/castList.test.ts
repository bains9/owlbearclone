// A character's Spells list on their card (31 October 2026): their sheet's spells that the Spells
// tool can show, matched by name; what they've prayed for today, chosen in Table by their player or
// the GM (not read from the sheet); casting from their token; and a cast using a prayer up.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { cantCast, castAs, castingAs, mayPray, newPrayerDay, setPrayed, spendPrayer } from "../src/client/party";
import { RoomClient } from "../src/client/room/client";
import { MAX_PRAYED, cleanCharacter, type Character, type CharactersReply } from "../src/shared/characters";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import { castList, tableSpellsFor } from "../src/shared/spellfx";
import type { Player, Scene, TokenItem } from "../src/shared/types";

interface Party {
  readParty(env: unknown, cache: Cache | null, fetcher: typeof fetch, now?: number): Promise<CharactersReply>;
  playsCharacter(directory: unknown, sheetId: string, userId: string | null): Promise<boolean>;
  prayedChange(body: unknown): unknown;
}
const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;

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

  it("list what can be shown, castable first by level, with the prayed-for ones' casts left", () => {
    const list = castList(caster({ prayed: { "Light (R)": 2 } }));
    expect(list.map((s) => s.name)).toEqual(["Faerie Fire", "Light", "Light (reversed)", "Magic Missile", "Battle Song", "Moonbeam", "Dispel Magic", "Earthmaw"]);
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

describe("in the guide", () => {
  it("leads What's new, and says how to cast from a card and pray for spells", async () => {
    expect(GUIDE[0].parts[0].title).toBe("Cast a character's spells from their card, with what they've prayed for (31 October 2026)");
    const text = JSON.stringify(GUIDE.find((s) => s.id === "spells"));
    for (const words of ["**Pray for today**", "**New day**", "**Spells**"]) expect(text).toContain(words);
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const card = fs.readFileSync(new URL("../src/client/ui/CharacterCard.tsx", import.meta.url), "utf8");
    for (const words of ["Pray for today", "New day", "<span>Spells</span>"]) expect(card).toContain(words);
  });
});

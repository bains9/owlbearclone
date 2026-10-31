// A Samurai's ki on their card, and a new day for the party (31 October 2026, from Par's "do all"):
// the sheets' script (version 6) reads the ki pool for their level and their ki abilities; the ki
// left today is kept with what's been prayed for (KI_KEY), so a new day fills it; and the GM's new
// day for the party can put everyone's spell points back to full on their sheets.
import { afterEach, describe, expect, it, vi } from "vitest";
import { kiLeft, kiLine, newPartyDay, spendKi } from "../src/client/party";
import { RoomClient } from "../src/client/room/client";
import { KI_KEY, MAX_KI, cleanCharacter, type Character, type CharactersReply } from "../src/shared/characters";
import { DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";

interface Party {
  readParty(env: unknown, cache: Cache | null, fetcher: typeof fetch, now?: number): Promise<CharactersReply>;
  prayedChange(body: unknown): unknown;
  restOnSheet(source: string, key: string, sheetId: string, fetcher: typeof fetch): Promise<{ sp: number } | { error: string }>;
}
const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const OMEN = { name: "Omen", cost: 3, note: "Cost: 3 ki. Divination." };
const samurai = (over: Partial<Character> = {}): Character => ({
  ...cleanCharacter({ id: SHEET, name: "Hana Kiri", hp: "51", maxHp: "51", sp: "15", maxSp: "15", attacks: [], ki: { max: 14, abilities: [OMEN] } })!,
  players: [{ userId: "player1abcdef", name: "P" }],
  ...over,
});

function page(me: Player, c: Character = samurai()) {
  const room = new RoomClient("AbCdEf123456", { uid: me.userId, name: me.name, color: me.color });
  room.store.set({ me, room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } }, party: { configured: true, readAt: 1, characters: [c] } });
  return room;
}
const gm: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };
const theirs: Player = { connId: "c2", userId: "player1abcdef", name: "P", color: "#00ff00", role: "player" };
const other: Player = { connId: "c3", userId: "someone1else", name: "O", color: "#0000ff", role: "player" };

afterEach(() => vi.restoreAllMocks());

describe("ki, at the Worker", () => {
  it("is kept with what's been prayed for, under a name no spell has, and given apart from it", async () => {
    expect(party.prayedChange({ ki: 11 })).toEqual({ spell: KI_KEY, left: 11 });
    for (const bad of [{ ki: -1 }, { ki: MAX_KI + 1 }, { ki: 1.5 }, { ki: "3" }]) expect(party.prayedChange(bad), JSON.stringify(bad)).toBeNull();
    const directory = (kept: Record<string, number>) => ({
      charactersSource: async () => "https://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec",
      characterFigures: async () => ({}),
      characterStrMatched: async () => ({}),
      characterPlayers: async () => ({}),
      characterPrayed: async () => ({ [SHEET]: kept }),
    });
    const fetcher = vi.fn(async () => Response.json({ characters: [{ id: SHEET, name: "Hana Kiri", ki: { max: 14, abilities: [OMEN] } }] }));
    const read = (kept: Record<string, number>) => party.readParty({ directory: directory(kept), files: { head: async () => null } }, null, fetcher as unknown as typeof fetch, 1000);
    const both = (await read({ "Light (R)": 1, [KI_KEY]: 11 })).characters[0];
    expect([both.prayed, both.kiLeft, both.ki?.max]).toEqual([{ "Light (R)": 1 }, 11, 14]);
    const kiOnly = (await read({ [KI_KEY]: 0 })).characters[0];
    expect("prayed" in kiOnly).toBe(false);
    expect(kiOnly.kiLeft).toBe(0);
  });
});

describe("ki on the card", () => {
  it("is full until some is used", () => {
    expect(kiLeft(samurai())).toBe(14);
    expect(kiLeft(samurai({ kiLeft: 5 }))).toBe(5);
    expect(kiLeft(cleanCharacter({ id: SHEET, name: "Testa" })!)).toBe(0);
  });

  it("is used by their player or the GM: its cost off, shown at once, and a line in the chat", async () => {
    const room = page(theirs);
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, prayed: { [KI_KEY]: 11 } }));
    const said = vi.spyOn(room, "sendChat").mockImplementation(() => {});
    expect(spendKi(room, room.state.party!.characters[0], OMEN)).toBe(true);
    expect(said).toHaveBeenCalledWith("Hana uses Omen (3 ki, 11 left).");
    expect(room.state.party!.characters[0].kiLeft).toBe(11);
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/characters/${SHEET}/prayed?room=AbCdEf123456`);
    expect([init.method, JSON.parse(String(init.body))]).toEqual(["PUT", { ki: 11 }]);
    await vi.waitFor(() => expect(room.state.party!.characters[0].kiLeft).toBe(11));
    expect(kiLine(samurai(), OMEN, 2)).toBe("Hana uses Omen (3 ki, 2 left).");
  });

  it("isn't used when there isn't enough, or from another player's page", () => {
    const sent = vi.spyOn(globalThis, "fetch");
    const low = page(gm, samurai({ kiLeft: 2 }));
    expect(spendKi(low, low.state.party!.characters[0], OMEN)).toBe(false);
    expect(low.state.toasts.at(-1)).toMatchObject({ kind: "error", text: "Hana has 2 ki left, and Omen costs 3." });
    const stranger = page(other);
    expect(spendKi(stranger, stranger.state.party!.characters[0], OMEN)).toBe(false);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("a new day for the party", () => {
  it("clears everyone's prayers and fills their ki, and puts their spell points back on their sheets", async () => {
    const room = page(gm, samurai({ sp: 4, kiLeft: 2, prayed: { Silence: 1 } }));
    vi.spyOn(room, "refreshParty").mockImplementation(async () => {});
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("/rest?") ? Response.json({ ok: true, sp: 15 }) : Response.json({ ok: true, prayed: {} }),
    );
    expect(await newPartyDay(room, true)).toEqual({ done: 1, error: null });
    const c = room.state.party!.characters[0];
    expect([c.prayed, c.kiLeft, c.sp]).toEqual([{}, undefined, 15]);
    const calls = sent.mock.calls.map(([u, i]) => [String(u).replace(/\?.*/, ""), (i as RequestInit).method, (i as RequestInit).body ?? null]);
    expect(calls).toEqual([
      [`/api/characters/${SHEET}/prayed`, "PUT", JSON.stringify({ newDay: true })],
      [`/api/characters/${SHEET}/rest`, "POST", null],
    ]);
    // Without the spell points, only the day.
    sent.mockClear();
    await newPartyDay(room, false);
    expect(sent.mock.calls.map(([u]) => String(u).replace(/\?.*/, ""))).toEqual([`/api/characters/${SHEET}/prayed`]);
  });

  it("says what went wrong, such as a script that can't fill spell points up yet", async () => {
    const room = page(gm);
    vi.spyOn(room, "refreshParty").mockImplementation(async () => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("/rest?") ? Response.json({ error: "The character sheets' script can't fill spell points up yet." }, { status: 502 }) : Response.json({ ok: true, prayed: {} }),
    );
    const out = await newPartyDay(room, true);
    expect(out.error).toMatch(/can't fill spell points up yet/);
  });

  it("asks the GM's script for the rest with Tabletop's key, and knows an old script by its answer", async () => {
    const fetcher = vi.fn(async () => Response.json({ sp: 15 }));
    expect(await party.restOnSheet("https://script.example/exec", "k".repeat(43), SHEET, fetcher as unknown as typeof fetch)).toEqual({ sp: 15 });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ key: "k".repeat(43), id: SHEET, rest: true });
    const old = vi.fn(async () => Response.json({ error: "That isn’t a number of spell points." }));
    expect(await party.restOnSheet("https://script.example/exec", "k", SHEET, old as unknown as typeof fetch)).toMatchObject({ error: expect.stringContaining("needs to update it") });
  });
});

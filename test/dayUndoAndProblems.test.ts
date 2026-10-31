// A new day for the party asks first and can be taken back; the GM can fill one character's spell
// points up from their card; the sheets' script says its version, so the GM hears when it's old;
// and what fails on someone's device reaches the GM (31 October 2026, Par's second "do all").
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { newPartyDay, restSpellPoints, undoNewDay } from "../src/client/party";
import { pageErrorOf } from "../src/client/pageErrors";
import { RoomClient } from "../src/client/room/client";
import { SCRIPT_VERSION, cleanCharacter, type Character } from "../src/shared/characters";
import { MAX_PROBLEMS, addProblem, deviceOf, type Problem } from "../src/shared/problems";
import { DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
interface Party {
  askScript(source: string, fetcher: typeof fetch): Promise<{ characters: Character[]; version?: number; error?: string }>;
}
const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const testa = (over: Partial<Character> = {}): Character => ({
  ...cleanCharacter({ id: SHEET, name: "Testa Kiri", hp: "20", maxHp: "20", sp: "4", maxSp: "15", attacks: [], ki: { max: 6, abilities: [] } })!,
  ...over,
});
const gm: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };

function page(c: Character) {
  const room = new RoomClient("AbCdEf123456", { uid: gm.userId, name: gm.name, color: gm.color });
  room.store.set({ me: gm, room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } }, party: { configured: true, readAt: 1, characters: [c] } });
  vi.spyOn(room, "refreshParty").mockImplementation(async () => {});
  return room;
}
const calls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([u, i]) => [String(u).replace(/\?.*/, "").replace(`/api/characters/${SHEET}/`, ""), (i as RequestInit).method, (i as RequestInit).body ?? null]);

afterEach(() => vi.restoreAllMocks());

describe("a new day for the party", () => {
  it("asks first, saying what it'll do to how many, and offers Undo for half an hour", () => {
    const ui = read("src/client/ui/PartySection.tsx");
    expect(ui).toContain("onClick={() => setAsking(true)}");
    expect(ui).toContain("A new day for {who}: prayers cleared and ki full{rest ? \", and spell points back to full on their sheets\" : \"\"}.");
    for (const words of ["Start the new day", "Cancel", "Undo the new day"]) expect(ui).toContain(words);
    expect(read("src/client/party.ts")).toContain("export const NEW_DAY_UNDO_MS = 30 * 60 * 1000;");
  });

  it("is taken back: prayers and ki as they were, and the spell points it added taken off again", async () => {
    const room = page(testa({ prayed: { "Light (R)": 1, Bless: 0 }, kiLeft: 2 }));
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/rest?")) return Response.json({ ok: true, sp: 15 });
      if (url.includes("/spend?")) return Response.json({ ok: true, sp: 15 - JSON.parse(String(init?.body)).spend });
      return Response.json({ ok: true, prayed: {} });
    });
    await newPartyDay(room, true);
    expect(room.state.newDayUndo?.characters).toEqual([{ id: SHEET, prayed: { "Light (R)": 1, Bless: 0 }, kiLeft: 2, added: 11 }]);
    // A spell cast since: 3 off, so 12 now.
    room.store.set({ party: { ...room.state.party!, characters: [{ ...room.state.party!.characters[0], sp: 12 }] } });
    sent.mockClear();
    expect(await undoNewDay(room)).toBeNull();
    expect(calls(sent)).toEqual([
      ["prayed", "PUT", JSON.stringify({ spell: "Light (R)", left: 1 })],
      ["prayed", "PUT", JSON.stringify({ spell: "Bless", left: 0 })],
      ["prayed", "PUT", JSON.stringify({ ki: 2 })],
      ["spend", "POST", JSON.stringify({ spend: 11 })],
    ]);
    expect(room.state.newDayUndo).toBeNull();
    expect(room.state.party!.characters[0].sp).toBe(4);
  });

  it("takes back no more spell points than they have now", async () => {
    const room = page(testa());
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("/rest?") ? Response.json({ ok: true, sp: 15 }) : Response.json({ ok: true, sp: 0, prayed: {} }),
    );
    await newPartyDay(room, true);
    room.store.set({ party: { ...room.state.party!, characters: [{ ...room.state.party!.characters[0], sp: 5 }] } });
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, sp: 0, prayed: {} }));
    await undoNewDay(room);
    expect(calls(sent).at(-1)).toEqual(["spend", "POST", JSON.stringify({ spend: 5 })]);
  });
});

describe("one character's spell points back to full", () => {
  it("is the GM's, beside their spell points on the card, when they're short", () => {
    const card = read("src/client/ui/CharacterCard.tsx");
    expect(card).toContain("{gm && c.sp < c.maxSp && (");
    expect(card).toContain('aria-label="Spell points back to full on their sheet"');
  });

  it("fills their sheet up and says how many it added", async () => {
    const room = page(testa());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, sp: 15 }));
    expect(await restSpellPoints(room, room.state.party!.characters[0])).toBe(11);
    expect(room.state.party!.characters[0].sp).toBe(15);
  });
});

describe("the sheets' script's version", () => {
  it("is the one Tabletop expects, said with every reading", () => {
    const gs = read("scripts/character-sheets.gs");
    expect(gs).toContain(`const VERSION = ${SCRIPT_VERSION};`);
    expect(gs).toContain("return reply({ version: VERSION, characters: characters, unread: unread });");
  });

  it("is read from the script's answer, and the GM is told when it's older", async () => {
    const answer = (body: unknown) => vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
    expect((await party.askScript("https://script.example/exec", answer({ version: 7, characters: [] }))).version).toBe(7);
    expect("version" in (await party.askScript("https://script.example/exec", answer({ characters: [] })))).toBe(false);
    expect("version" in (await party.askScript("https://script.example/exec", answer({ version: "7", characters: [] })))).toBe(false);
    expect(read("src/worker/characters.ts")).toContain("...(version ? { scriptVersion: version } : {})");
    expect(read("src/client/ui/PartySection.tsx")).toContain("{gm && !party.error && (party.scriptVersion ?? 0) < SCRIPT_VERSION && (");
  });
});

describe("problems on devices", () => {
  const p = (over: Partial<Problem> = {}): Omit<Problem, "times"> => ({ at: 1, name: "Pat", device: "iPad · Safari", where: "the character card", message: "x is undefined", ...over });

  it("keep the newest first, count the same one again, and keep only the last few", () => {
    let list = addProblem([], p());
    list = addProblem(list, p({ at: 2, where: "the toolbar" }));
    list = addProblem(list, p({ at: 3 }));
    expect(list.map((x) => [x.where, x.times, x.at])).toEqual([
      ["the character card", 2, 3],
      ["the toolbar", 1, 2],
    ]);
    for (let i = 0; i < 30; i++) list = addProblem(list, p({ message: `m${i}` }));
    expect(list).toHaveLength(MAX_PROBLEMS);
    expect(list[0].message).toBe("m29");
  });

  it("name a device in a few words", () => {
    const ipad = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const ipadAsMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    const pixel = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
    const tab = "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0";
    expect([deviceOf(ipad), deviceOf(ipadAsMac, true), deviceOf(ipadAsMac), deviceOf(pixel), deviceOf(tab), deviceOf(edge), deviceOf("")]).toEqual([
      "iPad · Safari",
      "iPad · Safari",
      "Mac · Safari",
      "Android phone · Chrome",
      "Android tablet · Chrome",
      "Windows · Edge",
      "a device · a browser",
    ]);
  });

  it("leave out what isn't Tabletop's fault: the browser's resize note, other sites' scripts, a dropped connection", () => {
    const here = "https://table.parhome.ca";
    expect(pageErrorOf({ message: "x is undefined", filename: `${here}/assets/index.js` }, here)).toBe("x is undefined");
    for (const e of [
      { message: "ResizeObserver loop completed with undelivered notifications." },
      { message: "Script error." },
      { message: "boom", filename: "chrome-extension://abc/content.js" },
      { message: "TypeError: Failed to fetch" },
      { message: "Load failed" },
      { message: "" },
    ])
      expect(pageErrorOf(e, here), e.message).toBeNull();
  });

  it("are told once a page, only while connected, and a table display tells too", () => {
    const room = new RoomClient("AbCdEf123456", { uid: gm.userId, name: gm.name, color: gm.color });
    const send = vi.fn();
    const r = room as unknown as { ws: { readyState: number; send: typeof send } | null; ready: boolean };
    r.ws = { readyState: 1, send };
    r.ready = true;
    room.reportProblem("the character card", new Error("x is undefined"));
    room.reportProblem("the character card", new Error("x is undefined"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({ t: "problem", where: "the character card", message: "x is undefined" });
    r.ws.readyState = 3;
    room.reportProblem("the toolbar", new Error("y"));
    expect(send).toHaveBeenCalledTimes(1);
    const roomTs = read("src/worker/room.ts");
    expect(roomTs).toContain('if (conn.display && msg.t !== "problem") return;');
    expect(roomTs).toContain("if (count.n >= MAX_PROBLEMS_PER_WINDOW) return;");
    expect(roomTs).toContain('case "problems.clear":\n        if (!gm) return this.deny(ws);');
    expect(roomTs).toContain('this.broadcast({ t: "problems", problems: this.problems }, (c) => c.role === "gm" && !c.display);');
  });

  it("come from a bar that fails and from errors on the page, and the GM finds them under More", () => {
    expect(read("src/client/ui/common.tsx")).toContain("room.reportProblem(props.name, err);");
    expect(read("src/client/ui/RoomPage.tsx")).toContain("const unwatchErrors = watchPageErrors(room);");
    const page = read("src/client/ui/RoomPage.tsx");
    expect(page).toContain("<TriangleAlert size={16} /> Problems on devices");
    expect(page).toContain('{props.problems > 0 && <span class="problem-dot" />}');
  });
});

describe("in the guide", () => {
  it("leads What's new, and says how", () => {
    expect(GUIDE[0].parts[0].title).toBe("New day asks first and can be undone, one character's spell points, and problems on devices (31 October 2026)");
    const all = JSON.stringify(GUIDE);
    for (const words of ["**Start the new day**", "**Undo the new day**", "**Problems on devices**", "version 7 says which it is"]) expect(all).toContain(words);
  });
});


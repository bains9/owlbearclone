// Dice sets (4 November 2026): each character's own dice, kept by the Directory (one character to a
// set) and chosen by their player or the GM; a roll from their card, or from the tray of the browser
// playing them, comes in them; the GM's own rolls are the villains'. The chat draws each roll's dice
// in the set it was rolled in, and the tray in the set the page rolls in.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { mayChooseDice, setCharacterDice } from "../src/client/party";
import { RoomClient } from "../src/client/room/client";
import { cleanCharacter, type CharactersReply } from "../src/shared/characters";
import { CHARACTER_DICE, DICE_SETS, DICE_SET_IDS, GM_DICE, GM_SETS, PLAIN_DICE, diceClass, isCharacterDice, isGmDice, messageDice, rollingSet } from "../src/shared/diceSets";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const OTHER = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210zyxw";

describe("the sets", () => {
  it("are Classic and nine more for characters, and the villains' three for the GM alone", () => {
    expect(DICE_SETS.map((s) => s.id)).toEqual([...DICE_SET_IDS]);
    expect(CHARACTER_DICE.map((s) => s.id)).not.toContain("villain");
    expect(GM_SETS.map((s) => [s.id, s.name])).toEqual([
      ["villain", "Obsidian and bone"],
      ["blood", "Blood and bone"],
      ["hellfire", "Hellfire"],
    ]);
    expect([isGmDice("hellfire"), isGmDice("pearl"), isGmDice("glitter")]).toEqual([true, false, false]);
    expect(CHARACTER_DICE).toHaveLength(10);
    expect(DICE_SETS.find((s) => s.id === "pearl")?.look).toBe("pearl paint with a purple shimmer, gold numbers");
    expect([isCharacterDice("pearl"), isCharacterDice("villain"), isCharacterDice("glitter"), isCharacterDice(7)]).toEqual([true, false, false, false]);
  });

  it("roll in the character's for a card, the villains' for the GM's tray, Classic otherwise", () => {
    // The GM's own rolls, from the tray, whatever they'd send.
    // The GM's own rolls, from the tray: the villains' set they picked, Obsidian and bone until they do.
    expect(rollingSet("gm", false, null)).toBe(GM_DICE);
    expect(rollingSet("gm", false, "hellfire")).toBe("hellfire");
    expect(rollingSet("gm", false, "pearl")).toBe("villain");
    // From a character's card, the character's, whoever rolls; Classic when they have none.
    expect(rollingSet("gm", true, "pearl")).toBe("pearl");
    expect(rollingSet("gm", true, null)).toBe(PLAIN_DICE);
    expect(rollingSet("player", true, "ruby")).toBe("ruby");
    // A player's tray: the character they play's.
    expect(rollingSet("player", false, "frost")).toBe("frost");
    expect(rollingSet("player", false, null)).toBe("classic");
    // Never the villains' for a character, nor a set nobody knows.
    expect(rollingSet("player", false, "villain")).toBe("classic");
    expect(rollingSet("player", true, "glitter")).toBe("classic");
  });

  it("draw a message in the set it was rolled in, older ones in Classic", () => {
    expect(messageDice({ dice: "pearl" })).toBe("pearl");
    expect(messageDice({})).toBe("classic");
    expect(messageDice({ dice: "glitter" })).toBe("classic");
    expect(diceClass("pearl")).toBe("dice-painted dice-set-pearl");
    expect(diceClass("classic")).toBe("");
  });

  it("each have their paint, Pearl its purple shimmer and gold numbers, the villains' their red", async () => {
    const css = await source("src/client/styles.css");
    for (const id of DICE_SET_IDS.filter((x) => x !== "classic")) expect(css).toContain(`.dice-set-${id} {`);
    const pearl = css.slice(css.indexOf(".dice-set-pearl {"), css.indexOf("}", css.indexOf("--d-sheen", css.indexOf(".dice-set-pearl {"))));
    expect(pearl).toMatch(/--d-ink: #a87a00;/);
    expect(pearl).toMatch(/rgba\(176, 116, 255, 0\.6\)/);
    // The villains' sets read at a glance on Vern's screen (Par, 4 November: the white outline "not
    // readable"): plain, solid numbers, a hard shadow at most; the menace in the die's edge and glow.
    const villains = css.slice(css.indexOf(".dice-set-villain {"), css.indexOf(".dice-set-bone {")).replace(/\r\n/g, "\n");
    expect(villains).toMatch(/\.dice-set-villain \{\n {2}--d-paint: radial-gradient\(circle at 32% 26%, #34262a[^}]*--d-ink: #f4ead6;\n {2}--d-ink-shadow: 0 1px 0 #000;\n {2}--d-glow: 0 0 6px rgba\(220, 20, 30, 0\.75\);/);
    expect(villains).toMatch(/\.dice-set-blood \{[^}]*--d-ink: #fff3df;/);
    expect(villains).toMatch(/\.dice-set-hellfire \{[^}]*--d-ink: #ffc43d;\n {2}--d-ink-shadow: 0 1px 0 #000;/);
    expect(villains).not.toContain("#fff, -1px");
    expect(css).not.toContain("villain-ember");
    expect(css).toContain("    var(--d-glow, 0 0 0 transparent);");
    // Still marked: the highest face and a 1, as rings.
    expect(css).toMatch(/\.dice-painted \.die:not\(\.die-shaped\)\.max \{\r?\n {2}outline: 2px solid var\(--ok\);/);
    // A shaped one: its outline green.
    expect(css).toMatch(/\.die-shaped\.max \.die-edge \{\r?\n {2}stroke: var\(--ok\);/);
    // Moving paint only for those who don't mind it.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\r?\n {2}\.dice-painted :is\(\.die, \.die-pick\),/);
  });
});

// ---------------------------------------------------------------- the Directory

interface DirectoryInside {
  characterDice(): Record<string, string>;
  setCharacterDice(sheetId: string, dice: string | null): boolean;
  diceFor(sheetId: string | null, userId: string | null): string | null;
  setCharacterPlayer(userId: string, sheetId: string | null, name: string): void;
}

/** A Directory over a real SQLite database in memory (node:sqlite), as the Durable Object's. */
async function directory(): Promise<DirectoryInside> {
  const { DatabaseSync } = (await import(/* @vite-ignore */ "node:" + "sqlite")) as {
    DatabaseSync: new (path: string) => { prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] } };
  };
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(q: string, ...b: unknown[]) {
      const rows = db.prepare(q).all(...b);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
  const { Directory } = (await import(/* @vite-ignore */ "../src/worker/" + "directory")) as { Directory: new (ctx: unknown, env: unknown) => DirectoryInside };
  return new Directory({ storage: { sql }, blockConcurrencyWhile: (f: () => unknown) => f() }, {});
}

describe("the Directory", () => {
  it("keeps one character to a set, Classic as none, for every room", async () => {
    const d = await directory();
    expect(d.characterDice()).toEqual({});
    expect(d.setCharacterDice(SHEET, "pearl")).toBe(true);
    // Another character can't have them too.
    expect(d.setCharacterDice(OTHER, "pearl")).toBe(false);
    expect(d.characterDice()).toEqual({ [SHEET]: "pearl" });
    expect(d.setCharacterDice(OTHER, "ruby")).toBe(true);
    // Their own again is fine; changing frees the old set.
    expect(d.setCharacterDice(SHEET, "pearl")).toBe(true);
    expect(d.setCharacterDice(SHEET, "frost")).toBe(true);
    expect(d.setCharacterDice(OTHER, "pearl")).toBe(true);
    expect(d.characterDice()).toEqual({ [SHEET]: "frost", [OTHER]: "pearl" });
    d.setCharacterDice(SHEET, null);
    expect(d.characterDice()).toEqual({ [OTHER]: "pearl" });
  });

  it("says which dice a roll comes in: the card's character's, or the one the browser plays", async () => {
    const d = await directory();
    d.setCharacterDice(SHEET, "pearl");
    d.setCharacterDice(OTHER, "emerald");
    expect(d.diceFor(SHEET, null)).toBe("pearl");
    // A card's character, whoever plays whom.
    d.setCharacterPlayer("user1abcdef", OTHER, "Ann");
    expect(d.diceFor(SHEET, "user1abcdef")).toBe("pearl");
    // From the tray: the character they play.
    expect(d.diceFor(null, "user1abcdef")).toBe("emerald");
    expect(d.diceFor(null, "user2abcdef")).toBeNull();
    expect(d.diceFor(null, null)).toBeNull();
    d.setCharacterPlayer("user1abcdef", null, "");
    expect(d.diceFor(null, "user1abcdef")).toBeNull();
  });
});

// ---------------------------------------------------------------- the party's reading

interface Party {
  readParty(env: unknown, cache: Cache | null, fetcher: typeof fetch, now?: number): Promise<CharactersReply>;
}

describe("the party's reading", () => {
  it("gives each character their dice, but never the GM's own or a set nobody knows, nor the sheets' say", async () => {
    const party = (await import(/* @vite-ignore */ "../src/worker/" + "characters")) as Party;
    const THIRD = "1QqQqQqQqQqQqQqQqQqQqQqQqQqQqQqQqQqQqQqQ";
    const env = {
      directory: {
        charactersSource: async () => "https://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec",
        characterFigures: async () => ({}),
        characterStrMatched: async () => ({}),
        characterPlayers: async () => ({}),
        characterPrayed: async () => ({}),
        characterDice: async () => ({ [SHEET]: "pearl", [OTHER]: "villain", [THIRD]: "glitter" }),
      },
      files: { head: async () => null },
    };
    const fetcher = vi.fn(async () =>
      Response.json({ characters: [{ id: SHEET, name: "Testa" }, { id: OTHER, name: "Oth" }, { id: THIRD, name: "Third", dice: "ruby" }] }),
    );
    const reply = await party.readParty(env, null, fetcher as unknown as typeof fetch, 1000);
    expect(Object.fromEntries(reply.characters.map((c) => [c.id, c.dice]))).toEqual({ [SHEET]: "pearl", [OTHER]: undefined, [THIRD]: undefined });
  });
});

// ---------------------------------------------------------------- the Room

interface Conn extends Player {
  sid: string;
  v?: number;
}

interface Sent {
  t: string;
  message?: { dice?: string; text?: string };
}

interface Sock {
  conn: Conn;
  sent: Sent[];
  send(data: string): void;
  deserializeAttachment(): Conn;
  serializeAttachment(c: Conn): void;
}

interface RoomInside {
  handle(ws: Sock, conn: Conn, msg: unknown, seq: number | undefined): Promise<void>;
}

let RoomClass: { prototype: object };

beforeAll(async () => {
  RoomClass = ((await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } }).Room;
});

function sock(conn: Conn): Sock {
  const s: Sock = {
    conn,
    sent: [],
    send(data) {
      s.sent.push(JSON.parse(data) as Sent);
    },
    deserializeAttachment: () => s.conn,
    serializeAttachment(c) {
      s.conn = c;
    },
  };
  return s;
}

/** A Room as in initiativeAuto.test.ts, asking a Directory whose `diceFor` and `gmDice` are given. */
function room(
  socks: Sock[],
  diceFor: (sheetId: string | null, userId: string | null) => Promise<string | null>,
  gmDice: () => Promise<string | null> = async () => null,
): RoomInside {
  const r = Object.create(RoomClass.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => socks },
    env: { DIRECTORY: { getByName: () => ({ diceFor, gmDice }) } },
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    activeSceneId: "scene1",
    scenes: new Map([["scene1", { id: "scene1", name: "s", order: 0, mapAssetId: null, width: 100, height: 100, background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 0 }]]),
    items: new Map(),
    initiative: { entries: [], turn: 0, round: 1 },
  });
  return r;
}

const gmConn = (): Conn => ({ connId: "gmc", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm", sid: "gmsid", v: 8 });
const playerConn = (): Conn => ({ connId: "alicec", userId: "alice1abcdef", name: "alice", color: "#00ff00", role: "player", sid: "alicesid", v: 8 });
const lastRoll = (s: Sock) => s.sent.filter((x) => x.t === "chat").at(-1)?.message;

describe("a roll in the Room", () => {
  it("comes in the villains' set the GM picked from the GM's tray, Obsidian and bone until they pick", async () => {
    const gm = sock(gmConn());
    const asked = vi.fn(async (): Promise<string | null> => "pearl");
    const picked = vi.fn(async (): Promise<string | null> => "hellfire");
    const r = room([gm], asked, picked);
    await r.handle(gm, gm.conn, { t: "roll", expr: "1d20" }, 1);
    expect(lastRoll(gm)?.dice).toBe("hellfire");
    expect(asked).not.toHaveBeenCalled();
    picked.mockResolvedValueOnce(null);
    await r.handle(gm, gm.conn, { t: "roll", expr: "1d20" }, 2);
    expect(lastRoll(gm)?.dice).toBe("villain");
    // Never a character's set, and still the villains' when the Directory can't be asked.
    picked.mockResolvedValueOnce("pearl");
    await r.handle(gm, gm.conn, { t: "roll", expr: "1d20" }, 3);
    expect(lastRoll(gm)?.dice).toBe("villain");
    picked.mockRejectedValueOnce(new Error("down"));
    await r.handle(gm, gm.conn, { t: "roll", expr: "1d20" }, 4);
    expect(lastRoll(gm)?.dice).toBe("villain");
  });

  it("in a character's dice from their card, whoever rolls (the GM rolling for an NPC of the party too)", async () => {
    const gm = sock(gmConn());
    const asked = vi.fn(async (): Promise<string | null> => "pearl");
    const r = room([gm], asked);
    await r.handle(gm, gm.conn, { t: "roll", expr: "2d10+3", label: "Testa: Sword to hit", character: SHEET }, 1);
    expect(asked).toHaveBeenCalledWith(SHEET, null);
    expect(lastRoll(gm)).toMatchObject({ dice: "pearl", text: "Testa: Sword to hit" });
    // A character with none: Classic, nothing kept on the message.
    asked.mockResolvedValueOnce(null);
    await r.handle(gm, gm.conn, { t: "roll", expr: "1d6", character: SHEET }, 2);
    expect(lastRoll(gm)).not.toHaveProperty("dice");
  });

  it("from a player's tray, in the dice of the character their browser plays; never the GM's", async () => {
    const alice = sock(playerConn());
    const asked = vi.fn(async (): Promise<string | null> => "frost");
    const r = room([alice], asked);
    await r.handle(alice, alice.conn, { t: "roll", expr: "1d20" }, 1);
    expect(asked).toHaveBeenCalledWith(null, "alice1abcdef");
    expect(lastRoll(alice)?.dice).toBe("frost");
    asked.mockResolvedValueOnce("villain");
    await r.handle(alice, alice.conn, { t: "roll", expr: "1d20" }, 2);
    expect(lastRoll(alice)).not.toHaveProperty("dice");
    // A card id that isn't one is the tray's.
    await r.handle(alice, alice.conn, { t: "roll", expr: "1d20", character: "nope" }, 3);
    expect(asked).toHaveBeenLastCalledWith(null, "alice1abcdef");
  });

  it("still rolls, in Classic, when the Directory can't be asked", async () => {
    const alice = sock(playerConn());
    await room([alice], async () => {
      throw new Error("down");
    }).handle(alice, alice.conn, { t: "roll", expr: "1d20" }, 1);
    expect(lastRoll(alice)).toBeDefined();
    expect(lastRoll(alice)).not.toHaveProperty("dice");
  });
});

// ---------------------------------------------------------------- choosing them

describe("choosing a character's dice", () => {
  afterEach(() => vi.restoreAllMocks());

  function client(me: Player): RoomClient {
    const room = new RoomClient("AbCdEf123456", { uid: me.userId, name: me.name, color: me.color });
    const c = cleanCharacter({ id: SHEET, name: "Testa" })!;
    const o = cleanCharacter({ id: OTHER, name: "Oth" })!;
    room.store.set({ me, party: { configured: true, readAt: 1, characters: [{ ...c, players: [{ userId: "user1abcdef", name: "Ann" }] }, { ...o, dice: "ruby" }] } });
    return room;
  }

  it("is their player's or the GM's", () => {
    const ann = client({ connId: "c1", userId: "user1abcdef", name: "Ann", color: "#ff0000", role: "player" });
    const [mine, theirs] = ann.state.party!.characters;
    expect([mayChooseDice(ann, mine), mayChooseDice(ann, theirs)]).toEqual([true, false]);
    const gm = client({ connId: "c2", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" });
    expect(gm.state.party!.characters.map((c) => mayChooseDice(gm, c))).toEqual([true, true]);
  });

  it("asks the Worker as this browser, and shows everyone's dice from the answer at once", async () => {
    const ann = client({ connId: "c1", userId: "user1abcdef", name: "Ann", color: "#ff0000", role: "player" });
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ ok: true, dice: { [SHEET]: "pearl" } }));
    await setCharacterDice(ann, ann.state.party!.characters[0], "pearl");
    const [url, init] = sent.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/characters/${SHEET}/dice?room=AbCdEf123456`);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["X-Tabletop-User"]).toBe("user1abcdef");
    expect(JSON.parse(String(init.body))).toEqual({ dice: "pearl" });
    // Oth's ruby went (someone changed it meanwhile): the answer is everyone's.
    expect(ann.state.party!.characters.map((c) => c.dice)).toEqual(["pearl", undefined]);
    // Refused: the Worker's words.
    sent.mockImplementation(async () => Response.json({ error: "Another character has those dice." }, { status: 409 }));
    await expect(setCharacterDice(ann, ann.state.party!.characters[0], "ruby")).rejects.toThrow("Another character has those dice.");
  });

  it("from the Party list; a card's rolls say whose they are, and the chat and tray are painted", async () => {
    const list = await source("src/client/ui/PartySection.tsx");
    expect(list).toContain("{mayChooseDice(room, c) && <DicePick c={c} busy={busy} act={act} />}");
    expect(list).toMatch(/<PlayedBy c=\{c\} busy=\{busy\} act=\{act\} \/>\r?\n\s*<DicePick c=\{c\} busy=\{busy\} act=\{act\} \/>/);
    expect(list).toContain("<option key={s.id} value={s.id} disabled={!!other}>");
    const card = await source("src/client/ui/CharacterCard.tsx");
    expect(card).toContain("room.roll(expr, { label, character: c.id })");
    expect(card).toContain("{ label: `${who}: initiative`, initiative, character: c.id }");
    const chat = await source("src/client/ui/ChatPanel.tsx");
    // Each roll's dice in its set (diceLook.ts; diceLook.test.ts has the rest).
    expect(chat).toContain(`<div class={cx("roll-dice", look.dice)}>`);
    expect(chat).toContain("const myDice = gm ? (gmDice ?? GM_DICE) : rollingSet(\"player\", false, played?.dice);");
    // The GM's pick: the die beside Hidden, a list of the villains' sets over it.
    expect(chat).toContain(`<select aria-label="Your dice (the villains')" value={myDice} onChange={(e) => void setGmDice(room, e.currentTarget.value as DiceSetId)}>`);
    expect(chat).toContain("{GM_SETS.map((s) => (");
    expect(chat).toContain(`<div class={cx("dice-row", diceClass(myDice))}>`);
  });

  it("at the Worker: by their player or the GM, at one of the GM's tables, never the GM's own set", async () => {
    const worker = await source("src/worker/index.ts");
    const route = worker.slice(worker.indexOf("const diceMatch"), worker.indexOf("// What a character has prayed for today"));
    expect(route).toContain("if (!known) return fail(404");
    expect(route).toContain(`if (!gm && !(await playsCharacter(directory, sheetId, request.headers.get("X-Tabletop-User")))) {`);
    expect(route).toContain(`isDiceSet(dice) ? "Those are the GM's own dice."`);
    expect(route).toContain('return fail(409, "Another character has those dice.")');
    // A combat rest from their card comes in their dice too.
    expect(worker).toContain("line, who.dice);");
    expect(await source("src/worker/room.ts")).toContain('text: rollLabel(label, false), roll, ...(isCharacterDice(dice) ? { dice } : {}) });');
  });
});

describe("the guide", () => {
  it("leads What's new with them", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.intro).toContain("The latest updates came out on 6 November 2026.");
    const top = news.parts[6];
    expect(top.title).toBe("Every character rolls in dice of their own, and the GM in the villains' (4 November 2026)");
    expect(top.steps.join(" ")).toContain("pearl paint with a purple shimmer, gold numbers");
    expect(top.steps.join(" ")).toContain("**Obsidian and bone** (black, bone-white numbers, a blood-red glow), **Blood and bone** (deep red, bone-white numbers) or **Hellfire**");
    expect(top.steps.join(" ")).toContain("Pick yours with the die at the end of your dice tray, beside **Hidden**: it's the same on every device and in every room.");
    const sheets = GUIDE.find((s) => s.id === "character-sheets")!;
    expect(sheets.parts.at(-1)!.title).toBe("A character's dice");
  });
});

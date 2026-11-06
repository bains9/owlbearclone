// Monsters' and NPCs' stats, entered by hand on their tokens (6 November 2026): HP, AC, initiative and
// attacks that roll as characters' do, two d10 to hit. They're the GM's alone: what matters most below
// is that a player's browser is never sent them, by any route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { initEntryFor } from "../src/client/initiative";
import { RoomClient } from "../src/client/room/client";
import { duplicateSelection } from "../src/client/room/actions";
import { TO_HIT_DIE, attackLabel, critOf, withModifier } from "../src/shared/characters";
import { attackDamage, changedHp, damageText, draftOf, freshCopy, isBlank, parseDamage, sanitizeTokenStats, statsFromDraft, type TokenStats } from "../src/shared/tokenStats";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { ChatMessage, Scene, TokenItem } from "../src/shared/types";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const { DatabaseSync } = (await import(/* @vite-ignore */ "node:" + "sqlite")) as {
  DatabaseSync: new (path: string) => { prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] } };
};
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));

const GOBLIN: TokenStats = {
  hp: 9,
  maxHp: 12,
  ac: "5 (9 with shield)",
  init: 2,
  attacks: [
    { name: "Longsword", toHit: 2, dice: "1d8", damage: 1 },
    { name: "Bite", toHit: -1, dice: "", damage: 0 },
  ],
};

const token = (id: string, more: Partial<TokenItem> = {}): TokenItem => ({
  id,
  sceneId: "scene1",
  kind: "token",
  z: 0,
  owner: GM_OWNER,
  x: 140,
  y: 140,
  size: 1,
  rotation: 0,
  assetId: null,
  color: "#e4572e",
  label: "Goblin",
  hidden: false,
  locked: false,
  rings: [],
  ...more,
});

describe("the rules", () => {
  it("keeps stats within bounds, and refuses what isn't stats", () => {
    expect(sanitizeTokenStats(GOBLIN)).toEqual(GOBLIN);
    expect(sanitizeTokenStats(null)).toBeNull();
    expect(sanitizeTokenStats({ hp: "lots", maxHp: 1, init: 0, attacks: [] })).toBeNull();
    expect(sanitizeTokenStats({ hp: 1, maxHp: 1, init: 0, attacks: "none" })).toBeNull();
    expect(sanitizeTokenStats({ hp: 1, maxHp: 1, init: 0, attacks: [{ name: "Bad", toHit: 0, dice: "rm -rf", damage: 0 }] })).toBeNull();
    expect(sanitizeTokenStats({ hp: 1, maxHp: 1, init: 0, attacks: [{ name: "", toHit: 0, dice: "1d6", damage: 0 }] })).toBeNull();
    expect(sanitizeTokenStats({ hp: 1, maxHp: 1, init: 0, attacks: Array(13).fill({ name: "A", toHit: 0, dice: "", damage: 0 }) })).toBeNull();
    const big = sanitizeTokenStats({ hp: 1e9, maxHp: 1e9, ac: "x".repeat(99), init: 1e9, attacks: [] })!;
    expect([big.hp, big.maxHp, big.ac.length, big.init]).toEqual([99_999, 99_999, 24, 99]);
    expect(sanitizeTokenStats({ hp: 1.9, maxHp: 2.9, init: 0, attacks: [], ac: "1\u0000" })).toEqual({ hp: 1, maxHp: 2, ac: "1", init: 0, attacks: [] });
  });

  it("reads damage as the GM types it", () => {
    expect(parseDamage("1d8+1")).toEqual({ dice: "1d8", damage: 1 });
    expect(parseDamage(" d6 ")).toEqual({ dice: "1d6", damage: 0 });
    expect(parseDamage("2D6-1")).toEqual({ dice: "2d6", damage: -1 });
    expect(parseDamage("")).toEqual({ dice: "", damage: 0 });
    expect(parseDamage("bite")).toBeNull();
    expect(parseDamage("3")).toBeNull();
    expect(damageText({ dice: "1d8", damage: 1 })).toBe("1d8+1");
    expect(damageText({ dice: "", damage: 3 })).toBe("");
  });

  it("rolls two d10 to hit with its bonus, and damage with the crit added on a critical hit", () => {
    expect(TO_HIT_DIE).toBe("2d10");
    expect(withModifier(TO_HIT_DIE, 2)).toBe("2d10+2");
    expect(withModifier(TO_HIT_DIE, -1)).toBe("2d10-1");
    expect(attackDamage(GOBLIN.attacks[0], false)).toBe("1d8+1");
    expect(attackDamage(GOBLIN.attacks[0], true)).toBe("1d8+9");
    expect(attackDamage({ dice: "2d6", damage: 0 }, true)).toBe("2d6+12");
    expect(attackDamage(GOBLIN.attacks[1], false)).toBeNull();
  });

  it("its rolls count as critical hits and failures in the chat, as characters' do", () => {
    const rolled = (a: number, b: number) =>
      ({
        kind: "roll",
        text: attackLabel("Goblin 2", "Longsword", "to hit"),
        roll: { terms: [{ kind: "dice", sign: 1, count: 2, sides: 10, rolls: [{ v: a }, { v: b }] }] },
      }) as unknown as ChatMessage;
    expect(rolled(10, 10).text).toBe("Goblin 2: Longsword to hit");
    expect(critOf(rolled(10, 10))).toBe("hit");
    expect(critOf(rolled(1, 1))).toBe("fail");
    expect(critOf(rolled(10, 9))).toBeNull();
  });

  it("makes stats from a filled-in form, saying what's wrong", () => {
    const row = (name: string, toHit: string, damage: string) => ({ name, toHit, damage });
    const made = statsFromDraft({ hp: "", maxHp: "20", ac: " 15 ", init: "-1", attacks: [row("Club", "+3", "d6+1"), row("", "", "")] });
    expect(made).toEqual({ stats: { hp: 20, maxHp: 20, ac: "15", init: -1, attacks: [{ name: "Club", toHit: 3, dice: "1d6", damage: 1 }] } });
    expect(statsFromDraft({ hp: "", maxHp: "abc", ac: "", init: "", attacks: [] })).toEqual({ error: "Max HP is a number." });
    expect(statsFromDraft({ hp: "", maxHp: "1", ac: "", init: "x", attacks: [] })).toMatchObject({ error: expect.stringMatching(/Initiative/) });
    expect(statsFromDraft({ hp: "", maxHp: "1", ac: "", init: "", attacks: [row("Club", "x", "d6")] })).toEqual({ error: "Club: its to-hit bonus is a number, like 2 or -1." });
    expect(statsFromDraft({ hp: "", maxHp: "1", ac: "", init: "", attacks: [row("Club", "", "a lot")] })).toEqual({ error: "Club: its damage is dice, like 1d8+1." });
    // A damage with no name is still an attack.
    expect(statsFromDraft({ hp: "", maxHp: "1", ac: "", init: "", attacks: [row("", "", "d4")] })).toMatchObject({ stats: { attacks: [{ name: "Attack" }] } });
  });

  it("comes back through the form as it went in, keeps hurt HP, and follows a full one up", () => {
    expect(statsFromDraft(draftOf(GOBLIN), GOBLIN)).toEqual({ stats: GOBLIN });
    const full = { ...GOBLIN, hp: 12 };
    const raised = { ...draftOf(full), maxHp: "20" };
    expect(statsFromDraft(raised, full)).toMatchObject({ stats: { hp: 20, maxHp: 20 } });
    // Hurt, it stays as hurt as it was.
    expect(statsFromDraft({ ...draftOf(GOBLIN), maxHp: "20" }, GOBLIN)).toMatchObject({ stats: { hp: 9, maxHp: 20 } });
    // The GM set it by hand.
    expect(statsFromDraft({ ...draftOf(full), hp: "3" }, full)).toMatchObject({ stats: { hp: 3 } });
    expect(isBlank((statsFromDraft(draftOf(null)) as { stats: TokenStats }).stats)).toBe(true);
  });

  it("damage can take it below 0, healing stops at its most, and a copy is unhurt", () => {
    expect(changedHp({ hp: 5, maxHp: 12 }, -8)).toBe(-3);
    expect(changedHp({ hp: 5, maxHp: 12 }, 100)).toBe(12);
    expect(changedHp({ hp: 15, maxHp: 12 }, 2)).toBe(15);
    expect(changedHp({ hp: 0, maxHp: 12 }, -9999)).toBe(-999);
    const copy = freshCopy(GOBLIN);
    expect(copy.hp).toBe(12);
    copy.attacks[0].name = "Changed";
    expect(GOBLIN.attacks[0].name).toBe("Longsword");
  });
});

// ---------------------------------------------------------------- the Room

interface RoomInside {
  create(id: string, name: string): unknown;
  items: Map<string, TokenItem>;
  tombstones: Map<string, string>;
  tokenStats: Map<string, TokenStats>;
  sql: { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };
  load(): void;
  hello(conn: unknown): { items: TokenItem[]; tokenStats?: Record<string, TokenStats>; tokenNotes?: unknown };
  webSocketMessage(ws: unknown, message: string): Promise<void>;
  backupSnapshot(key: string): Promise<{ gz: Uint8Array } | null>;
  restoreSnapshot(id: string, name: string, gz: Uint8Array, key: string): Promise<unknown>;
}

function sqlStore() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(q: string, ...b: unknown[]) {
      const rows = db.prepare(q).all(...b);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
}

const conn = (role: string, more: Record<string, unknown> = {}) => ({ connId: `c-${role}${more.display ? "d" : ""}`, userId: role === "gm" ? GM_OWNER : "player000000001", name: role, color: "#888888", role, sid: `s-${role}`, v: 8, ...more });

function socket(c: ReturnType<typeof conn>) {
  const sent: Record<string, unknown>[] = [];
  return { sent, send: (m: string) => void sent.push(JSON.parse(m)), deserializeAttachment: () => c, serializeAttachment: () => undefined, close: () => undefined };
}

async function aRoom() {
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  const { Room } = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: new (c: unknown, e: unknown) => RoomInside };
  const gm = socket(conn("gm"));
  const player = socket(conn("player"));
  const display = socket(conn("player", { display: true }));
  const sockets = [gm, player, display];
  const sql = sqlStore();
  const ctx = {
    storage: { sql, transactionSync: (f: () => unknown) => f(), deleteAll: async () => undefined },
    blockConcurrencyWhile: (f: () => unknown) => f(),
    getWebSockets: () => sockets,
    setWebSocketAutoResponse: () => undefined,
  };
  const room = new Room(ctx, { FILES: {}, DIRECTORY: { getByName: () => ({ touchRoom: () => undefined, gmDice: () => null, characterDice: () => null }) } });
  room.create("AbCdEf123456", "Room");
  const add = (t: TokenItem) => {
    room.items.set(t.id, t);
    room.sql.exec(`INSERT INTO items (id, scene_id, data) VALUES (?, ?, ?)`, t.id, t.sceneId, JSON.stringify(t));
  };
  const send = (ws: ReturnType<typeof socket>, msg: unknown) => room.webSocketMessage(ws, JSON.stringify(msg));
  return { room, gm, player, display, add, send, ctx };
}

describe("the Room", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps them for the GM alone: never on a token, and never sent to a player or a display", async () => {
    const { room, gm, player, display, add, send } = await aRoom();
    add(token("goblin000001"));
    await send(gm, { t: "token.stats", id: "goblin000001", stats: GOBLIN });
    expect(room.tokenStats.get("goblin000001")).toEqual(GOBLIN);
    // Told to the GM's pages, not to anyone else's.
    expect(gm.sent.at(-1)).toEqual({ t: "tokenStats", id: "goblin000001", stats: GOBLIN });
    const everything = (s: { sent: unknown[] }) => JSON.stringify(s.sent);
    for (const other of [player, display]) {
      expect(everything(other)).not.toContain("tokenStats");
      expect(everything(other)).not.toContain("Longsword");
    }
    // A page joining: the GM gets them, a player and a display don't, though they see the token.
    expect(room.hello(conn("gm")).tokenStats).toEqual({ goblin000001: GOBLIN });
    for (const who of [conn("player"), conn("player", { display: true })]) {
      const hello = room.hello(who);
      expect(hello.tokenStats).toBeUndefined();
      const text = JSON.stringify(hello);
      expect(text).not.toContain("Longsword");
      expect(text).not.toContain("9 with shield");
    }
    // And they aren't on the token, where anything sending tokens would carry them.
    expect(JSON.stringify(room.items.get("goblin000001"))).not.toContain("Longsword");
  });

  it("refuses a player setting them", async () => {
    const { room, player, add, send } = await aRoom();
    add(token("goblin000001"));
    await send(player, { t: "token.stats", id: "goblin000001", stats: GOBLIN });
    expect(room.tokenStats.size).toBe(0);
    expect(room.sql.exec(`SELECT id FROM token_stats`).toArray()).toEqual([]);
  });

  it("only for a real token, not a character's or a compass, and only real stats", async () => {
    const { room, gm, add, send } = await aRoom();
    add(token("goblin000001"));
    add(token("hero00000001", { character: "sheet1234567890abcdef" }));
    add(token("compass00001", { art: "compass" } as Partial<TokenItem>));
    await send(gm, { t: "token.stats", id: "nothing00001", stats: GOBLIN });
    await send(gm, { t: "token.stats", id: "hero00000001", stats: GOBLIN });
    await send(gm, { t: "token.stats", id: "compass00001", stats: GOBLIN });
    await send(gm, { t: "token.stats", id: "goblin000001", stats: { hp: "lots" } });
    expect(room.tokenStats.size).toBe(0);
  });

  it("takes them off, and tells the GM", async () => {
    const { room, gm, add, send } = await aRoom();
    add(token("goblin000001"));
    await send(gm, { t: "token.stats", id: "goblin000001", stats: GOBLIN });
    await send(gm, { t: "token.stats", id: "goblin000001", stats: null });
    expect(room.tokenStats.size).toBe(0);
    expect(room.sql.exec(`SELECT id FROM token_stats`).toArray()).toEqual([]);
    expect(gm.sent.at(-1)).toEqual({ t: "tokenStats", id: "goblin000001", stats: null });
  });

  it("are still there after the room sleeps, while Undo could bring a deleted token back, and then go", async () => {
    const { room, gm, add, send } = await aRoom();
    add(token("goblin000001"));
    add(token("goblin000002"));
    add(token("goblin000003"));
    for (const id of ["goblin000001", "goblin000002", "goblin000003"]) await send(gm, { t: "token.stats", id, stats: GOBLIN });
    // One deleted a moment ago, one long gone.
    room.sql.exec(`DELETE FROM items WHERE id IN ('goblin000002', 'goblin000003')`);
    room.sql.exec(`INSERT INTO tombstones (id, owner, at) VALUES ('goblin000002', ?, ?)`, GM_OWNER, Date.now());
    room.load();
    expect([...room.tokenStats.keys()].sort()).toEqual(["goblin000001", "goblin000002"]);
    expect(room.sql.exec(`SELECT id FROM token_stats ORDER BY id`).toArray().map((r) => r.id)).toEqual(["goblin000001", "goblin000002"]);
  });

  it("are in the room's backups, and come back with it", async () => {
    const { room, gm, add, send } = await aRoom();
    add(token("goblin000001"));
    await send(gm, { t: "token.stats", id: "goblin000001", stats: GOBLIN });
    const packed = await room.backupSnapshot("a-key");
    const { Room } = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: new (c: unknown, e: unknown) => RoomInside };
    const empty = new Room(
      {
        storage: { sql: sqlStore(), transactionSync: (f: () => unknown) => f(), deleteAll: async () => undefined },
        blockConcurrencyWhile: (f: () => unknown) => f(),
        getWebSockets: () => [],
        setWebSocketAutoResponse: () => undefined,
      },
      {},
    );
    await empty.restoreSnapshot("ZzZzZzZzZzZz", "Back", packed!.gz, "a-key");
    expect(empty.tokenStats.get("goblin000001")).toEqual(GOBLIN);
  });
});

// ---------------------------------------------------------------- the page

describe("the GM's page", () => {
  const scene = { id: "scene1", name: "S", order: 0, mapAssetId: null, width: 2100, height: 1400, background: "#000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 1 } as unknown as Scene;
  let room: RoomClient;
  let sent: unknown[];

  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    room = new RoomClient("AbCdEf123456", { uid: "gmuid0000001", name: "GM", color: "#ff0000" });
    sent = [];
    (room as unknown as { submit(m: unknown): void }).submit = (m: unknown) => void sent.push(m);
    room.store.set({
      me: { connId: "c", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" } as never,
      room: { id: "AbCdEf123456", name: "R", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
      scenes: { scene1: scene },
      viewSceneId: "scene1",
      activeSceneId: "scene1",
      items: { goblin000001: token("goblin000001") },
      selection: ["goblin000001"],
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a change at once, and sends it", () => {
    room.setTokenStats("goblin000001", GOBLIN);
    expect(room.state.tokenStats.goblin000001).toEqual(GOBLIN);
    expect(sent).toContainEqual({ t: "token.stats", id: "goblin000001", stats: GOBLIN });
    room.setTokenStats("goblin000001", null);
    expect(room.state.tokenStats.goblin000001).toBeUndefined();
  });

  it("a monster's initiative rolls a d10 with its bonus, at most 10", () => {
    room.store.set({ tokenStats: { goblin000001: { ...GOBLIN, init: 99 } } });
    expect(initEntryFor(room, token("goblin000001")).value).toBe(10);
    room.store.set({ tokenStats: { goblin000001: { ...GOBLIN, init: -99 } } });
    expect(initEntryFor(room, token("goblin000001")).value).toBeLessThan(0);
  });

  it("a duplicate has its stats, unhurt, sent after the token it belongs to", () => {
    room.store.set({ tokenStats: { goblin000001: GOBLIN } });
    room.change = ((ops: { upsert?: TokenItem[] }) => {
      sent.push({ t: "items", ops });
      room.store.set({ items: { ...room.state.items, ...Object.fromEntries((ops.upsert ?? []).map((t) => [t.id, t])) } });
    }) as never;
    duplicateSelection(room);
    const copyId = room.state.selection[0];
    expect(copyId).not.toBe("goblin000001");
    expect(room.state.items[copyId]).toMatchObject({ label: "Goblin 2" });
    expect(room.state.tokenStats[copyId]).toEqual({ ...GOBLIN, hp: 12 });
    expect(room.state.tokenStats.goblin000001.hp).toBe(9);
    const order = sent.map((m) => (m as { t: string }).t);
    expect(order.indexOf("items")).toBeLessThan(order.indexOf("token.stats"));
  });

  it("no stats, no copy of them", () => {
    room.change = (() => undefined) as never;
    duplicateSelection(room);
    expect(sent.filter((m) => (m as { t: string }).t === "token.stats")).toEqual([]);
  });

  it("the card and bar are wired in, for creatures and the GM only; the map's HP bar reads them", async () => {
    const bar = await source("src/client/ui/SelectionBar.tsx");
    expect(bar).toContain("{isCreature(t) && <StatsButton id={t.id} />}");
    expect(bar).toContain(`return gm && t?.kind === "token" && isCreature(t) && (has || editing) ? t : null;`);
    const board = await source("src/client/room/board.ts");
    expect(board).toContain("const stats = this.room.state.tokenStats[t.id];");
  });
});

describe("the guide", () => {
  it("says how, in What's new and in Monsters", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!.parts[0];
    expect(news.title).toBe("GM: monsters with HP, AC and attacks that roll two d10 (6 November 2026)");
    const part = GUIDE.find((s) => s.id === "monsters")!.parts.find((p) => p.title === "Give a monster stats and attacks")!;
    const text = [...part.steps, ...part.notes].join("\n");
    for (const words of ["**Give it stats**", "**Max HP**", "two d10", "**Crit**", "**Damage**", "**Heal**", "**Hidden**", "**Ctrl+D**", "Only you see", "never sent"]) expect(text).toContain(words);
  });
});

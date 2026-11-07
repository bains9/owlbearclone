// Monsters' and NPCs' stats, entered by hand on their tokens (6 November 2026): HP, AC, initiative and
// attacks that roll as characters' do, two d10 to hit. They're the GM's alone: what matters most below
// is that a player's browser is never sent them, by any route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { initEntryFor } from "../src/client/initiative";
import { RoomClient } from "../src/client/room/client";
import { duplicateSelection } from "../src/client/room/actions";
import { TO_HIT_DIE, attackLabel, critOf, withModifier } from "../src/shared/characters";
import { SAVED_LIMITS, attackDamage, changedHp, creatureKey, creatureName, damageText, draftOf, freshCopy, isBlank, isCreatureKey, parseDamage, sanitizeTokenStats, statsFromDraft, type TokenStats } from "../src/shared/tokenStats";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Asset, ChatMessage, Scene, TokenItem } from "../src/shared/types";

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

  it("Player view shows no monster's HP bar, as the players never see one; a character's stays", async () => {
    const board = await source("src/client/room/board.ts");
    const hpOf = board.slice(board.indexOf("private hpOf(t: TokenItem)"), board.indexOf("private buildToken("));
    // The character's line comes first: everyone sees those.
    expect(hpOf.indexOf("if (c) return c.hp")).toBeGreaterThan(-1);
    expect(hpOf.indexOf("if (c) return c.hp")).toBeLessThan(hpOf.indexOf("fogOpts.preview"));
    expect(hpOf.indexOf('if (this.room.state.fogOpts.preview) return "";')).toBeLessThan(hpOf.indexOf("tokenStats[t.id]"));
  });
});

describe("what a kind of creature starts with", () => {
  const ASSET = { id: "pic000000001", name: "Monster: Goblin", kind: "token", width: 1, height: 1, mime: "image/png", bytes: 1, owner: GM_OWNER, createdAt: 1 } as Asset;

  it("goes by the picture: the same built-in monster in any room, and the GM's own by its entry", () => {
    expect(creatureKey(ASSET)).toBe("pic:Monster: Goblin");
    const again: Asset = { ...ASSET, id: "another00001" };
    expect(creatureKey(again)).toBe("pic:Monster: Goblin");
    expect(creatureKey({ ...ASSET, library: "AbCdEfGhIjKlMnOp", name: "Renamed since" })).toBe("lib:AbCdEfGhIjKlMnOp");
    expect(creatureKey({ ...ASSET, kind: "map" })).toBeNull();
    expect(creatureKey({ ...ASSET, name: "x".repeat(500) })!.length).toBe(120);
    expect(creatureName(ASSET)).toBe("Goblin");
    expect(creatureName({ name: "NPC: Elf Wizard" })).toBe("Elf Wizard");
    expect(creatureName({ name: "Boyce" })).toBe("Boyce");
    expect([isCreatureKey("pic:Monster: Goblin"), isCreatureKey("lib:Abc"), isCreatureKey("nope"), isCreatureKey("pic:"), isCreatureKey(3), isCreatureKey(`pic:${"x".repeat(200)}`)]).toEqual([true, true, false, false, false, false]);
  });

  describe("kept by the Directory", () => {
    interface DirectoryInside {
      creatureStatsAll(): Record<string, TokenStats>;
      setCreatureStats(key: string, stats: TokenStats | null): boolean;
    }
    async function directory() {
      const { Directory } = (await import(/* @vite-ignore */ "../src/worker/" + "directory")) as { Directory: new (c: unknown, e: unknown) => DirectoryInside };
      return new Directory({ storage: { sql: sqlStore(), transactionSync: (f: () => unknown) => f() }, blockConcurrencyWhile: (f: () => unknown) => f() }, {});
    }
    async function route(d: DirectoryInside, method: string, body?: unknown, gm = true) {
      vi.resetModules();
      vi.doMock("../src/worker/auth", () => ({ isGm: async () => gm }));
      const { libraryRoute } = (await import(/* @vite-ignore */ "../src/worker/" + "libraryRoutes")) as { libraryRoute(r: Request, e: unknown, p: string, m: string): Promise<Response | null> };
      const res = await libraryRoute(new Request("https://t.test/api/creature-stats", { method, body: body === undefined ? undefined : JSON.stringify(body) }), { DIRECTORY: { getByName: () => d } }, "/api/creature-stats", method);
      return { status: res!.status, data: (await res!.json()) as Record<string, unknown> };
    }
    afterEach(() => vi.doUnmock("../src/worker/auth"));

    it("saves them unhurt, changes them, and forgets them", async () => {
      const d = await directory();
      expect(d.setCreatureStats("pic:Monster: Goblin", GOBLIN)).toBe(true);
      expect(d.creatureStatsAll()).toEqual({ "pic:Monster: Goblin": { ...GOBLIN, hp: 12 } });
      d.setCreatureStats("pic:Monster: Goblin", { ...GOBLIN, ac: "7" });
      expect(d.creatureStatsAll()["pic:Monster: Goblin"].ac).toBe("7");
      d.setCreatureStats("pic:Monster: Goblin", null);
      expect(d.creatureStatsAll()).toEqual({});
    });

    it("are the GM's alone, and only real stats for a real kind", async () => {
      const d = await directory();
      d.setCreatureStats("pic:Monster: Goblin", GOBLIN);
      for (const [method, body] of [["GET", undefined], ["PUT", { key: "pic:Monster: Orc", stats: GOBLIN }]] as const) expect((await route(d, method, body, false)).status).toBe(401);
      expect(Object.keys(d.creatureStatsAll())).toEqual(["pic:Monster: Goblin"]);
      expect((await route(d, "GET")).data).toEqual({ "pic:Monster: Goblin": { ...GOBLIN, hp: 12 } });
      expect((await route(d, "PUT", { key: "nope", stats: GOBLIN })).status).toBe(400);
      expect((await route(d, "PUT", { key: "pic:X", stats: { hp: "lots" } })).status).toBe(400);
      expect((await route(d, "PUT", { key: "pic:Monster: Orc", stats: GOBLIN })).status).toBe(200);
      expect(Object.keys(d.creatureStatsAll()).sort()).toEqual(["pic:Monster: Goblin", "pic:Monster: Orc"]);
      expect((await route(d, "PUT", { key: "pic:Monster: Orc", stats: null })).status).toBe(200);
      expect(Object.keys(d.creatureStatsAll())).toEqual(["pic:Monster: Goblin"]);
    });

    it("has room for only so many kinds, but a known one can always change", async () => {
      const d = await directory();
      for (let i = 0; i < SAVED_LIMITS.kinds; i++) d.setCreatureStats(`pic:${i}`, GOBLIN);
      expect(d.setCreatureStats("pic:one more", GOBLIN)).toBe(false);
      expect(d.setCreatureStats("pic:0", { ...GOBLIN, ac: "9" })).toBe(true);
    }, 30_000);

    it("come back with the monsters and NPCs from a backup", async () => {
      const d = (await directory()) as DirectoryInside & { backupSnapshot(): Promise<{ gz: Uint8Array }> };
      d.setCreatureStats("pic:Monster: Goblin", GOBLIN);
      const { gz } = await d.backupSnapshot();
      d.setCreatureStats("pic:Monster: Goblin", null);
      await (d as unknown as { restoreParts(g: Uint8Array, p: string[]): Promise<void>; ctx: unknown }).restoreParts(gz, ["library"]);
      expect(d.creatureStatsAll()["pic:Monster: Goblin"].ac).toBe(GOBLIN.ac);
    });
  });

  describe("on the GM's page", () => {
    const scene = { id: "scene1", name: "S", order: 0, mapAssetId: null, width: 2100, height: 1400, background: "#000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 1 } as unknown as Scene;
    let room: RoomClient;
    let sent: { t: string; id?: string; stats?: TokenStats }[];
    let puts: unknown[];

    function page(role: "gm" | "player") {
      vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
      puts = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
          return Response.json({});
        }),
      );
      room = new RoomClient("AbCdEf123456", { uid: "gmuid0000001", name: "GM", color: "#ff0000" });
      sent = [];
      (room as unknown as { submit(m: never): void }).submit = (m: never) => void sent.push(m);
      room.store.set({
        me: { connId: "c", userId: role === "gm" ? GM_OWNER : "player000000001", name: "x", color: "#ff0000", role } as never,
        room: { id: "AbCdEf123456", name: "R", createdAt: 0, settings: { ...DEFAULT_SETTINGS, playersCanAddTokens: true } },
        scenes: { scene1: scene },
        viewSceneId: "scene1",
        activeSceneId: "scene1",
        assets: { pic000000001: ASSET },
        creatureStats: { "pic:Monster: Goblin": { ...GOBLIN, hp: 12, init: 99 } },
      });
    }
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("a new one starts with them, unhurt, and rolls initiative with its bonus", () => {
      page("gm");
      const t = room.addToken({ assetId: "pic000000001", label: "Goblin" })!;
      expect(room.state.tokenStats[t.id]).toEqual({ ...GOBLIN, hp: 12, init: 99 });
      expect(sent.map((m) => m.t).filter((n) => n === "token.stats")).toHaveLength(1);
      // A second is its own.
      const again = room.addToken({ assetId: "pic000000001", label: "Goblin 2" })!;
      room.setTokenStats(again.id, { ...room.state.tokenStats[again.id], hp: 1 });
      expect(room.state.tokenStats[t.id].hp).toBe(12);
    });

    it("the token's stats go after the token, so the server knows it", () => {
      page("gm");
      const order: string[] = [];
      const change = room.change.bind(room);
      room.change = ((...a: Parameters<typeof change>) => {
        order.push("token");
        change(...a);
      }) as never;
      (room as unknown as { submit(m: { t: string }): void }).submit = (m: { t: string }) => void order.push(m.t);
      room.addToken({ assetId: "pic000000001", label: "Goblin" });
      expect(order.indexOf("token")).toBeLessThan(order.indexOf("token.stats"));
    });

    it("nothing for another picture, a plain token, a character or before they're read", () => {
      page("gm");
      room.store.set({ assets: { ...room.state.assets, other0000001: { ...ASSET, id: "other0000001", name: "Monster: Orc" } } });
      for (const opts of [{ assetId: "other0000001" }, {}, { assetId: "pic000000001", character: "sheet1234567890abcdef" }]) {
        const t = room.addToken(opts)!;
        expect(room.state.tokenStats[t.id]).toBeUndefined();
      }
      room.store.set({ creatureStats: null });
      const t = room.addToken({ assetId: "pic000000001" })!;
      expect(room.state.tokenStats[t.id]).toBeUndefined();
    });

    it("a player's token never gets them, even if the page somehow held some", () => {
      page("player");
      const t = room.addToken({ assetId: "pic000000001" })!;
      expect(t).toBeTruthy();
      expect(room.state.tokenStats[t.id]).toBeUndefined();
      expect(sent.filter((m) => m.t === "token.stats")).toEqual([]);
    });

    it("saves them unhurt on the page at once, tells the server, and forgets them", () => {
      page("gm");
      room.saveCreatureStats("pic:Monster: Orc", { ...GOBLIN, hp: 1 });
      expect(room.state.creatureStats!["pic:Monster: Orc"].hp).toBe(12);
      expect(puts).toEqual([{ key: "pic:Monster: Orc", stats: { ...GOBLIN, hp: 1 } }]);
      room.saveCreatureStats("pic:Monster: Orc", null);
      expect(room.state.creatureStats!["pic:Monster: Orc"]).toBeUndefined();
      expect(puts.at(-1)).toEqual({ key: "pic:Monster: Orc", stats: null });
    });

    it("the form starts a token without stats from what its kind has; only asking changes what its kind has", async () => {
      const card = await source("src/client/ui/MonsterCard.tsx");
      expect(card).toContain("useState<StatsDraft>(() => draftOf(stats ?? saved))");
      // Ticked only when its kind has nothing yet, so a boss among goblins can't change every goblin by accident.
      expect(card).toContain("useState(() => !saved)");
      // Saved only with the box ticked, and nothing about the box forgets: that's its own button.
      expect(card).toContain("if (kind && !blank && remember) room.saveCreatureStats(kind, made.stats);\n    close();");
      expect(card.match(/saveCreatureStats\(kind, null\)/g)).toHaveLength(1);
      expect(card).toContain("Forget what every new {creatureName(asset)} starts with");
    });
  });
});

describe("the guide", () => {
  it("says how, in What's new and in Monsters", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!.parts[2];
    expect(news.title).toBe("GM: monsters with HP, AC and attacks that roll two d10 (6 November 2026)");
    const part = GUIDE.find((s) => s.id === "monsters")!.parts.find((p) => p.title === "Give a monster stats and attacks")!;
    const text = [...part.steps, ...part.notes].join("\n");
    for (const words of ["**Give it stats**", "**Max HP**", "two d10", "**Crit**", "**Damage**", "**Heal**", "**Hidden**", "**Ctrl+D**", "Only you see", "never sent", "**Every new Goblin starts with these**", "in every room", "Untick it if this one's a one-off", "changes only that token", "**Make these what every new Goblin starts with**", "**Forget what every new Goblin starts with**"]) expect(text).toContain(words);
  });
});

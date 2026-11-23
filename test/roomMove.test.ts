// Tokens moved to another of the GM's rooms (22 November 2026): with their pictures, stats and HP, notes'
// links and the spells on them; copied into the other room first and taken out of this one only once
// it has them, so a token is never lost; the GM's alone. Two real Rooms on SQLite here, a bucket in
// memory for their pictures, and the Worker's route between them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { partyLanding } from "../src/shared/landing";
import { MOVED_AWAY, canChangeRoom, movedNames, movedText, samePicture, whyStaying, type MoveResult, type RoomMap } from "../src/shared/roomMove";
import { DEFAULT_GRID, GM_OWNER } from "../src/shared/sanitize";
import type { TokenStats } from "../src/shared/tokenStats";
import type { Asset, DrawingItem, InitEntry, Item, Scene, TokenItem } from "../src/shared/types";

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
vi.mock("../src/worker/auth", () => ({ isGm: async (r: Request) => r.headers.get("X-Test-Gm") === "1" }));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));
const { DatabaseSync } = (await import(/* @vite-ignore */ "node:" + "sqlite")) as {
  DatabaseSync: new (path: string) => { prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] } };
};

const HERE = "HereRoom0001";
const THERE = "ThereRoom001";

const GOBLIN: TokenStats = { hp: 3, maxHp: 12, ac: "13", init: 2, attacks: [{ name: "Scimitar", toHit: 4, dice: "1d6", damage: 2 }] };

const token = (id: string, sceneId: string, more: Partial<TokenItem> = {}): TokenItem => ({
  id,
  sceneId,
  kind: "token",
  z: 0,
  owner: GM_OWNER,
  x: 175,
  y: 175,
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

const asset = (id: string, more: Partial<Asset> = {}): Asset => ({ id, name: "Monster: Goblin", kind: "token", width: 256, height: 256, mime: "image/png", bytes: 1234, owner: GM_OWNER, createdAt: 1, ...more });

// ---------------------------------------------------------------- the rules

describe("what moves, and the words for it", () => {
  it("moves the GM's own tokens, never a character's, a player's or a compass", () => {
    expect(canChangeRoom(token("a", "s"))).toBe(true);
    expect(canChangeRoom(token("a", "s", { layer: "prop", hidden: true, withParty: true }))).toBe(true);
    expect(canChangeRoom(token("a", "s", { character: "sheet1234567890abcdefg" }))).toBe(false);
    expect(canChangeRoom(token("a", "s", { owner: "player000000001" }))).toBe(false);
    expect(canChangeRoom(token("a", "s", { art: "compass" }))).toBe(false);
    // Not an id anyone could have, so no page can claim a moved token's id.
    expect(MOVED_AWAY).not.toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("names who went and where", () => {
    expect(movedNames(["Goblin"])).toBe("Goblin");
    expect(movedNames(["Goblin", "Orc"])).toBe("Goblin and Orc");
    expect(movedNames(["Goblin", "Orc", "Orc 2"])).toBe("Goblin and 2 others");
    expect(movedNames(["", "Orc"])).toBe("Orc and 1 other");
    expect(movedNames(["", ""])).toBe("2 tokens");
    expect(movedText(["Innkeeper", "Goblin", "Goblin 2"], "Northreach", "Coast")).toBe("Innkeeper and 2 others moved to “Northreach” › “Coast”.");
  });

  it("says who stays and why", () => {
    const aric = token("a", "s", { label: "Aric", character: "sheet1234567890abcdefg" });
    const cat = token("c", "s", { label: "Cat", owner: "player000000001" });
    const rose = token("r", "s", { art: "compass", label: "N" });
    const lines = whyStaying([token("g", "s"), aric, cat, rose]);
    expect(lines).toEqual([
      "Aric stays here: a character's token doesn't move to another room, or their player would be left here without it.",
      "Cat stays here: tokens players put down stay theirs, in this room.",
      "Compasses stay with their maps.",
    ]);
    expect(whyStaying([token("g", "s")])).toEqual([]);
  });

  it("knows a picture the other room has already", () => {
    expect(samePicture(asset("a"), asset("b", { createdAt: 9, owner: "x" }))).toBe(true);
    expect(samePicture(asset("a"), asset("b", { bytes: 99 }))).toBe(false);
    expect(samePicture(asset("a"), asset("b", { name: "Monster: Orc" }))).toBe(false);
    expect(samePicture(asset("a"), asset("b", { kind: "map" }))).toBe(false);
  });
});

// ---------------------------------------------------------------- two rooms and the route

interface RoomInside {
  create(id: string, name: string): unknown;
  items: Map<string, Item>;
  scenes: Map<string, Scene>;
  assets: Map<string, Asset>;
  tombstones: Map<string, string>;
  tokenStats: Map<string, TokenStats>;
  tokenNotes: Record<string, string>;
  initiative: { entries: InitEntry[] };
  activeSceneId: string | null;
  sql: { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };
  saveScene(s: Scene): void;
  saveAsset(a: Asset): void;
  load(): void;
  webSocketMessage(ws: unknown, message: string): Promise<void>;
  mapList(): RoomMap[] | null;
  importTokens(...a: unknown[]): unknown;
  removeMoved(ids: string[]): number;
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

function bucket() {
  const files = new Map<string, { data: ArrayBuffer; type: string }>();
  return {
    files,
    async get(key: string) {
      const f = files.get(key);
      return f ? { arrayBuffer: async () => f.data } : null;
    },
    async put(key: string, value: ArrayBuffer, opts: { httpMetadata?: { contentType?: string } }) {
      files.set(key, { data: value, type: opts.httpMetadata?.contentType ?? "" });
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
}

type Conn = { connId: string; userId: string; name: string; color: string; role: string; sid: string; v: number; display?: boolean };

function socket(c: Conn) {
  const sent: Record<string, unknown>[] = [];
  return { sent, conn: c, send: (m: string) => void sent.push(JSON.parse(m)), deserializeAttachment: () => c, serializeAttachment: () => undefined, close: () => undefined };
}

const gmConn = (): Conn => ({ connId: "c-gm", userId: GM_OWNER, name: "GM", color: "#888888", role: "gm", sid: "s-gm", v: 12 });
const playerConn = (): Conn => ({ connId: "c-pl", userId: "player000000001", name: "Bram", color: "#888888", role: "player", sid: "s-pl", v: 12 });

async function aRoom(id: string, name: string, files: ReturnType<typeof bucket>) {
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  const { Room } = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: new (c: unknown, e: unknown) => RoomInside };
  const gm = socket(gmConn());
  const player = socket(playerConn());
  const sockets = [gm, player];
  const ctx = {
    storage: { sql: sqlStore(), transactionSync: (f: () => unknown) => f(), deleteAll: async () => undefined },
    blockConcurrencyWhile: (f: () => unknown) => f(),
    getWebSockets: () => sockets,
    setWebSocketAutoResponse: () => undefined,
  };
  const room = new Room(ctx, { FILES: files, DIRECTORY: { getByName: () => ({ touchRoom: async () => undefined, gmDice: () => null, characterDice: () => null }) } });
  room.create(id, name);
  const scene = [...room.scenes.values()][0];
  let seq = 0;
  const send = (ws: ReturnType<typeof socket>, msg: Record<string, unknown>) => room.webSocketMessage(ws, JSON.stringify({ ...msg, seq: ++seq }));
  return { room, gm, player, scene, send };
}

describe("moving tokens to another room", () => {
  let files: ReturnType<typeof bucket>;
  let here: Awaited<ReturnType<typeof aRoom>>;
  let there: Awaited<ReturnType<typeof aRoom>>;
  let coast: Scene;
  let go: (body: unknown, gm?: boolean, method?: string, path?: string) => Promise<{ status: number; data: Record<string, unknown> }>;
  const rooms = () => [
    { id: HERE, name: "Testing", createdAt: 1, lastUsed: 1 },
    { id: THERE, name: "Northreach", createdAt: 2, lastUsed: 2 },
  ];

  beforeEach(async () => {
    files = bucket();
    here = await aRoom(HERE, "Testing", files);
    there = await aRoom(THERE, "Northreach", files);
    // The other room's second map: 20 by 10 squares of 100 pixels, snapping.
    coast = { ...there.scene, id: "coastmap0001", name: "Coast", order: 1, width: 2000, height: 1000, grid: { ...DEFAULT_GRID, size: 100, offsetX: 0, offsetY: 0, snap: true } };
    there.room.saveScene(coast);
    there.room.scenes.set(coast.id, coast);
    // Here: squares of 70, a goblin chief (picture, stats and HP, a note, a spell, in initiative), a goblin, and Aric.
    const s = here.scene.id;
    here.room.saveAsset(asset("goblinpic0000001"));
    here.room.assets.set("goblinpic0000001", asset("goblinpic0000001"));
    await files.put(`rooms/${HERE}/goblinpic0000001`, new Uint8Array([1, 2, 3]).buffer, { httpMetadata: { contentType: "image/png" } });
    await here.send(here.gm, {
      t: "items",
      upsert: [
        token("chief0000001", s, { label: "Goblin chief", x: 175, y: 175, assetId: "goblinpic0000001", rings: ["#e4572e"], hidden: true, locked: true, withParty: true, flipped: true, rotation: 45, z: 4 }),
        token("goblin000001", s, { label: "Goblin", x: 245, y: 175, assetId: "goblinpic0000001", z: 5 }),
        token("aric00000001", s, { label: "Aric", x: 105, y: 105, character: "sheet1234567890abcdefg" }),
        { id: "spell0000001", sceneId: s, kind: "drawing", z: 1, shape: "ellipse", points: [140, 140, 210, 210], color: "#c77dff", width: 2, fill: false, fx: "outline", spell: "Faerie Fire", on: "chief0000001", rounds: 7 },
      ],
    });
    expect(here.room.items.size).toBe(4);
    await here.send(here.gm, { t: "token.stats", id: "chief0000001", stats: GOBLIN });
    await here.send(here.gm, { t: "token.note", id: "chief0000001", note: "Elmhaven|People/Goblin chief.md" });
    await here.send(here.gm, { t: "initiative.op", op: { op: "add", entry: { id: "initchief1", name: "Goblin chief", value: 12, color: "#ffffff", tokenId: "chief0000001" } } });
    expect(here.room.initiative.entries.map((e) => e.tokenId)).toEqual(["chief0000001"]);
    // The player in the other room is on the Coast.
    there.room.activeSceneId = coast.id;

    const { moveRoute } = (await import(/* @vite-ignore */ "../src/worker/" + "moveRoutes")) as {
      moveRoute(request: Request, env: unknown, pathname: string, method: string): Promise<Response | null>;
    };
    const env = {
      FILES: files,
      DIRECTORY: { getByName: () => ({ listRooms: async () => rooms() }) },
      ROOMS: { getByName: (id: string) => (id === HERE ? here.room : id === THERE ? there.room : null) },
    };
    go = async (body, gm = true, method = "POST", path = `/api/rooms/${HERE}/move`) => {
      const url = `https://t.test${path}`;
      const res = await moveRoute(new Request(url, { method, body: method === "GET" ? undefined : JSON.stringify(body), headers: gm ? { "X-Test-Gm": "1" } : {} }), env, new URL(url).pathname, method);
      if (!res) throw new Error("not a move route");
      return { status: res.status, data: (await res.json()) as Record<string, unknown> };
    };
  });

  const moveChiefs = () => go({ to: THERE, scene: "coastmap0001", tokens: ["chief0000001", "goblin000001", "aric00000001"] });

  it("is the GM's alone", async () => {
    const res = await go({ to: THERE, scene: "coastmap0001", tokens: ["goblin000001"] }, false);
    expect(res).toEqual({ status: 401, data: { error: "Sign in as the GM first." } });
        expect([...there.room.items.keys()]).toEqual([]);
    expect(here.room.items.size).toBe(4);
  });

  it("copies them there first, with their pictures, stats and HP, notes and spells, then takes them out here", async () => {
    const res = await moveChiefs();
    expect(res.status).toBe(200);
    expect(res.data as unknown as MoveResult).toEqual({ moved: ["Goblin chief", "Goblin"], room: { id: THERE, name: "Northreach" }, map: { id: "coastmap0001", name: "Coast" } });

    // There: on the Coast, their own copy of the picture, one for both.
    const arrived = [...there.room.items.values()];
    const chief = there.room.items.get("chief0000001") as TokenItem;
    const goblin = there.room.items.get("goblin000001") as TokenItem;
    expect(chief).toMatchObject({ sceneId: "coastmap0001", owner: GM_OWNER, label: "Goblin chief", rings: ["#e4572e"], hidden: true, locked: true, withParty: true, flipped: true, rotation: 45 });
    expect(goblin.sceneId).toBe("coastmap0001");
    expect(there.room.items.has("aric00000001")).toBe(false);
    const pictures = [...there.room.assets.values()];
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatchObject({ name: "Monster: Goblin", kind: "token", owner: GM_OWNER });
    expect(pictures[0].id).not.toBe("goblinpic0000001");
    expect(chief.assetId).toBe(pictures[0].id);
    expect(goblin.assetId).toBe(pictures[0].id);
    expect(files.files.has(`rooms/${THERE}/${pictures[0].id}`)).toBe(true);
    // In the square at the middle of the map (1000, 500), a square apart at its squares, on its grid.
    expect([chief.x, chief.y, goblin.x, goblin.y]).toEqual([1050, 550, 1150, 550]);
    // Its stats and HP as they were (3 of 12), its note, and the spell on it with its rounds, in place on it.
    expect(there.room.tokenStats.get("chief0000001")).toEqual(GOBLIN);
    expect(there.room.tokenNotes).toEqual({ chief0000001: "Elmhaven|People/Goblin chief.md" });
    const spell = there.room.items.get("spell0000001") as DrawingItem;
    expect(spell).toMatchObject({ sceneId: "coastmap0001", fx: "outline", spell: "Faerie Fire", on: "chief0000001", rounds: 7 });
    expect(spell.points).toEqual([1000, 500, 1100, 600]);
    expect(arrived).toHaveLength(3);
    // Kept: there after the room starts again.
    there.room.load();
    expect(there.room.items.size).toBe(3);
    expect(there.room.tokenStats.get("chief0000001")).toEqual(GOBLIN);

    // Here: gone, with their spell, stats, note and initiative entry; Aric stays.
    expect([...here.room.items.keys()]).toEqual(["aric00000001"]);
    expect(here.room.tokenStats.size).toBe(0);
    expect(here.room.sql.exec(`SELECT id FROM token_stats`).toArray()).toEqual([]);
    expect(here.room.tokenNotes).toEqual({});
    expect(here.room.initiative.entries).toEqual([]);
    expect(here.room.tombstones.get("chief0000001")).toBe(MOVED_AWAY);
    // Its picture stays here, as every picture does.
    expect(here.room.assets.has("goblinpic0000001")).toBe(true);
    here.room.load();
    expect([...here.room.items.keys()]).toEqual(["aric00000001"]);
    expect(here.room.tokenStats.size).toBe(0);
  });

  it("tells each page what it may see: stats to the GM, never to a player", async () => {
    await moveChiefs();
    const toPlayer = there.player.sent.filter((m) => m.t === "items").flatMap((m) => (m.upsert as Item[] | undefined) ?? []);
    // The chief is hidden: the player there sees the goblin arrive, never the chief.
    expect(toPlayer.map((i) => i.id)).toContain("goblin000001");
    expect(toPlayer.map((i) => i.id)).not.toContain("chief0000001");
    expect(there.player.sent.some((m) => m.t === "tokenStats" || m.t === "tokenNotes")).toBe(false);
    expect(there.gm.sent.find((m) => m.t === "tokenStats")).toMatchObject({ id: "chief0000001", stats: GOBLIN });
    expect(there.gm.sent.find((m) => m.t === "asset.upsert")).toBeTruthy();
    const toGm = there.gm.sent.filter((m) => m.t === "items").flatMap((m) => (m.upsert as Item[] | undefined) ?? []);
    expect(toGm.map((i) => i.id).sort()).toEqual(["chief0000001", "goblin000001", "spell0000001"]);
    // Here, the player saw the goblin go (the chief was hidden from them).
    const gone = here.player.sent.filter((m) => m.t === "items" && m.by === "").flatMap((m) => (m.delete as string[] | undefined) ?? []);
    expect(gone).toContain("goblin000001");
    expect(gone).not.toContain("chief0000001");
    expect(here.gm.sent.find((m) => m.t === "tokenStats" && m.stats === null)).toMatchObject({ id: "chief0000001" });
  });

  it("leaves this room untouched when the other room can't take them, and deletes the picture copied for them", async () => {
    const before = { items: [...here.room.items.keys()], stats: [...here.room.tokenStats.keys()], init: here.room.initiative.entries.length };
    // That map has gone.
    const gone = await go({ to: THERE, scene: "nosuchmap001", tokens: ["chief0000001", "goblin000001"] });
    expect(gone.status).toBe(409);
    expect(gone.data.error).toBe("Nothing moved: That map isn't in that room any more.");
    // That map is full.
    const full = Array.from({ length: 5000 }, (_, n) => token(`fill${String(n).padStart(8, "0")}`, "coastmap0001"));
    for (const t of full) there.room.items.set(t.id, t);
    const crowded = await moveChiefs();
    expect(crowded.status).toBe(409);
    expect(crowded.data.error).toMatch(/^Nothing moved: “Coast” has as many things on it as a map can hold\.$/);
    for (const t of full) there.room.items.delete(t.id);
    // Here, all as it was; there, nothing of them, and no picture left behind.
    expect([...here.room.items.keys()]).toEqual(before.items);
    expect([...here.room.tokenStats.keys()]).toEqual(before.stats);
    expect(here.room.initiative.entries.length).toBe(before.init);
    expect(here.room.tombstones.size).toBe(0);
    expect([...there.room.items.keys()]).toEqual([]);
    expect(there.room.assets.size).toBe(0);
    expect([...files.files.keys()].filter((k) => k.startsWith(`rooms/${THERE}/`))).toEqual([]);
    // And when the other room's storage fails outright.
    const real = there.room.importTokens;
    there.room.importTokens = () => {
      throw new Error("storage");
    };
    const broke = await moveChiefs();
    there.room.importTokens = real;
    expect(broke.data.error).toBe("Nothing moved: “Northreach” couldn't take them. Try again.");
    expect([...here.room.items.keys()]).toEqual(before.items);
    expect([...files.files.keys()].filter((k) => k.startsWith(`rooms/${THERE}/`))).toEqual([]);
  });

  it("never loses them: if they can't be taken out here, they're in both rooms and the GM is told", async () => {
    here.room.removeMoved = () => {
      throw new Error("storage");
    };
    const res = await moveChiefs();
    expect(res.status).toBe(200);
    expect(res.data.stuck).toBe(true);
    expect(here.room.items.has("chief0000001")).toBe(true);
    expect(there.room.items.has("chief0000001")).toBe(true);
  });

  it("refuses characters, players' tokens and compasses on their own, and bad asks", async () => {
    expect((await go({ to: THERE, scene: "coastmap0001", tokens: ["aric00000001"] })).data.error).toBe("Characters' tokens, players' own and compasses stay in their room.");
    expect((await go({ to: THERE, scene: "coastmap0001", tokens: ["nosuchtoken1"] })).data.error).toBe("Those tokens aren't on the map any more.");
    expect((await go({ to: HERE, scene: here.scene.id, tokens: ["goblin000001"] })).status).toBe(400);
    expect((await go({ to: "Elsewhere001", scene: "coastmap0001", tokens: ["goblin000001"] })).status).toBe(404);
    expect((await go({ to: THERE, scene: "coastmap0001", tokens: [] })).status).toBe(400);
    expect(here.room.items.size).toBe(4);
  });

  it("lists the other room's maps for the GM, the live one marked", async () => {
    const maps = await go(undefined, true, "GET", `/api/rooms/${THERE}/maps`);
    expect(maps.data).toEqual([
      { id: there.scene.id, name: "Scene 1", live: false },
      { id: "coastmap0001", name: "Coast", live: true },
    ]);
    expect((await go(undefined, false, "GET", `/api/rooms/${THERE}/maps`)).status).toBe(401);
    expect((await go(undefined, true, "GET", `/api/rooms/Elsewhere001/maps`)).status).toBe(404);
  });

  it("uses a picture the other room has already, and moving back brings no copy", async () => {
    there.room.saveAsset(asset("theirgoblin00001", { createdAt: 5 }));
    there.room.assets.set("theirgoblin00001", asset("theirgoblin00001", { createdAt: 5 }));
    await moveChiefs();
    expect(there.room.assets.size).toBe(1);
    expect((there.room.items.get("goblin000001") as TokenItem).assetId).toBe("theirgoblin00001");
    expect([...files.files.keys()].filter((k) => k.startsWith(`rooms/${THERE}/`))).toEqual([]);
    // And back again, to the first map here: here's own picture, and its id free of the mark.
    const back = await go({ to: HERE, scene: here.scene.id, tokens: ["goblin000001"] }, true, "POST", `/api/rooms/${THERE}/move`);
    expect(back.status).toBe(200);
    expect((here.room.items.get("goblin000001") as TokenItem).assetId).toBe("goblinpic0000001");
    expect(here.room.tombstones.has("goblin000001")).toBe(false);
    expect(there.room.tombstones.get("goblin000001")).toBe(MOVED_AWAY);
    expect(here.room.assets.size).toBe(1);
  });

  it("won't let Undo bring a moved token back here as well", async () => {
    const chief = here.room.items.get("chief0000001");
    await moveChiefs();
    here.gm.sent.length = 0;
    await here.send(here.gm, { t: "items", upsert: [chief] });
    expect(here.room.items.has("chief0000001")).toBe(false);
    expect(here.gm.sent.find((m) => m.t === "error")).toEqual({ t: "error", message: "That token has moved to another room, so it can't come back here." });
    expect(here.gm.sent.find((m) => m.t === "items")).toMatchObject({ refused: ["chief0000001"], delete: ["chief0000001"] });
  });

  it("asked twice, puts them there once", async () => {
    const bundle = (here.room as unknown as { exportTokens(ids: string[]): unknown }).exportTokens(["goblin000001"]) as Record<string, unknown>;
    const arrival = { ...bundle, to: "coastmap0001", pictures: {}, made: [] };
    expect(there.room.importTokens(arrival)).toEqual({ map: { id: "coastmap0001", name: "Coast" } });
    expect(there.room.importTokens(arrival)).toEqual({ map: { id: "coastmap0001", name: "Coast" } });
    expect([...there.room.items.keys()]).toEqual(["goblin000001"]);
    // Its picture: none there yet, so none (the route copies it first).
    expect((there.room.items.get("goblin000001") as TokenItem).assetId).toBeNull();
  });
});

describe("where they land", () => {
  it("is the same as the party's: the one nearest the middle on the point, the rest around it at the new squares", () => {
    const from = { ...DEFAULT_GRID, size: 70, offsetX: 0, offsetY: 0 };
    const to = { ...DEFAULT_GRID, size: 100, offsetX: 0, offsetY: 0 };
    const at = partyLanding([token("a", "s", { x: 175, y: 175 }), token("b", "s", { x: 245, y: 175 })], from, to, { x: 1000, y: 500 }, true);
    expect([...at.values()]).toEqual([
      { x: 1050, y: 550 },
      { x: 1150, y: 550 },
    ]);
  });
});

// ---------------------------------------------------------------- the page and the guide

describe("on the GM's page", () => {
  it("has Move to another room on the bar, for one token and for several, opening its window", async () => {
    const bar = await source("src/client/ui/SelectionBar.tsx");
    expect(bar.match(/<MoveRoomButton tokens=\{/g)).toHaveLength(2);
    expect(bar).toContain('aria-label="Move to another room"');
    expect(bar).toContain("room.store.set({ moveRoom: props.tokens.map((t) => t.id) })");
    const page = await source("src/client/ui/RoomPage.tsx");
    expect(page).toContain("<MoveRoomDialog />");
    const win = await source("src/client/ui/MoveRoom.tsx");
    for (const words of ["<span>Room</span>", "<span>Map</span>", '" (players see this)"', "Open {done.room.name}", "movedText(done.moved, done.room.name, done.map.name)"]) expect(win).toContain(words);
  });
});

describe("the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const tokens = GUIDE.find((s) => s.id === "tokens")!;

  it("leads What's new with it", () => {
    expect(news.parts[0].title).toBe("GM: move tokens to another room (22 November 2026)");
    expect(news.parts[0].steps.join(" ")).toContain("**Move to another room**");
    expect(news.parts[0].notes.join(" ")).toContain("Characters' tokens stay");
  });

  it("says how in Tokens, and what goes and what stays", () => {
    const part = tokens.parts.find((p) => p.title === "GM: move tokens to another room")!;
    const all = [...part.steps, ...part.notes].join(" ");
    for (const words of ["**Move to another room**", "**Room**", "**Map**", "**Move**", "(players see this)", "stats and HP", "spells on it", "Nothing leaves this room until the other room has all of it", "**Undo** can't bring them back here", "Characters' tokens stay"]) {
      expect(all).toContain(words);
    }
  });
});

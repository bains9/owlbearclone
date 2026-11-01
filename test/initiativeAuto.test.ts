// Initiative that fills itself in (1 November 2026): a character card's Initiative roll goes into
// the list as well as the chat; creatures the GM places roll a d10 and join by themselves, their
// rows kept from the players (the GM's eye shows one); a token taken off the map leaves the list.
// The Room runs here as in compassRoom.test.ts: a bare object, fake sockets, storage that does nothing.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { creaturesJoin, initEntryFor, isCreature, saveAutoInitiative } from "../src/client/initiative";
import { duplicateSelection } from "../src/client/room/actions";
import { RoomClient } from "../src/client/room/client";
import { cleanCharacter } from "../src/shared/characters";
import { applyInitOp } from "../src/shared/initiative";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeInitiative } from "../src/shared/sanitize";
import type { InitEntry, Initiative, Item, Player, Scene, TokenItem } from "../src/shared/types";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";

function scene(id: string): Scene {
  return { id, name: id, order: 0, mapAssetId: null, width: 1400, height: 1000, background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 0 };
}

const goblin = (id: string, more: Partial<TokenItem> = {}): TokenItem => ({
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
  color: "#d62f2f",
  label: "Goblin",
  hidden: false,
  locked: false,
  rings: [],
  ...more,
});

const entry = (id: string, more: Partial<InitEntry> = {}): InitEntry => ({ id, name: id, value: 5, color: "#ffffff", tokenId: null, ...more });

describe("the list keeps some rows to the GM", () => {
  it("as the GM's eye sets them, and as they're stored", () => {
    const init: Initiative = { entries: [entry("aaaaaaaaaa")], turn: 0, round: 1 };
    const hidden = applyInitOp(init, { op: "update", id: "aaaaaaaaaa", hidden: true });
    expect(hidden.entries[0].hidden).toBe(true);
    expect(applyInitOp(hidden, { op: "update", id: "aaaaaaaaaa", hidden: false }).entries[0]).not.toHaveProperty("hidden");
    // A name or number changed leaves it as it was.
    expect(applyInitOp(hidden, { op: "update", id: "aaaaaaaaaa", value: 9 }).entries[0]).toMatchObject({ value: 9, hidden: true });
    const stored = sanitizeInitiative({ entries: [{ ...entry("bbbbbbbbbb"), hidden: true }, { ...entry("cccccccccc"), hidden: "yes" }], turn: 0, round: 1 })!;
    expect(stored.entries.map((e) => e.hidden)).toEqual([true, undefined]);
  });
});

describe("a token added from the map", () => {
  const gmMe: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };
  const playerMe: Player = { connId: "c2", userId: "player1abcdef", name: "P", color: "#00ff00", role: "player" };

  function client(me: Player, items: TokenItem[] = [], view = "scene1"): RoomClient {
    const room = new RoomClient("AbCdEf123456", { uid: me.userId, name: me.name, color: me.color });
    const c = cleanCharacter({ id: SHEET, name: "Testa", init: "+2" })!;
    room.store.set({
      me,
      room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS, playersCanAddTokens: true } },
      scenes: { scene1: scene("scene1"), scene2: scene("scene2") },
      viewSceneId: view,
      activeSceneId: "scene1",
      items: Object.fromEntries(items.map((t) => [t.id, t])),
      party: { configured: true, readAt: 1, characters: [c] },
    });
    return room;
  }
  afterEach(() => saveAutoInitiative(true));

  it("rolls: a character a d10 with their INT bonus, anything else a d10; the GM's creatures kept from the players", () => {
    const gm = client(gmMe);
    for (let i = 0; i < 50; i++) {
      const pc = initEntryFor(gm, goblin("pc0000000001", { character: SHEET, label: "Testa" }));
      expect(pc.value >= 3 && pc.value <= 12).toBe(true);
      expect(pc).not.toHaveProperty("hidden");
      const gob = initEntryFor(gm, goblin("gob000000001"));
      expect(gob.value >= 1 && gob.value <= 10).toBe(true);
      expect(gob.hidden).toBe(true);
    }
    // A player's add is never kept from the others.
    expect(initEntryFor(client(playerMe), goblin("gob000000001"))).not.toHaveProperty("hidden");
    expect([goblin("a", { layer: "prop" }), goblin("b", { art: "compass" }), goblin("c", { character: SHEET })].map(isCreature)).toEqual([false, false, false]);
  });

  it("joins by itself when the GM places a creature on the scene everyone's on", () => {
    const gm = client(gmMe);
    const t = gm.addToken({ label: "Goblin" })!;
    const [e] = gm.state.initiative.entries;
    expect(e).toMatchObject({ name: "Goblin", tokenId: t.id, hidden: true });
    expect(e.value >= 1 && e.value <= 10).toBe(true);
    // A copy of it joins too, with a roll of its own.
    duplicateSelection(gm);
    expect(gm.state.initiative.entries).toHaveLength(2);
    expect(gm.state.initiative.entries.map((x) => x.name).sort()).toEqual(["Goblin", "Goblin 2"]);
  });

  it("but not a character's token, a creature on a scene being got ready, one already in, or with it turned off", () => {
    const gm = client(gmMe);
    gm.addToken({ label: "Testa", character: SHEET });
    expect(gm.state.initiative.entries).toEqual([]);
    const ready = client(gmMe, [], "scene2");
    ready.addToken({ label: "Ogre" });
    expect(ready.state.initiative.entries).toEqual([]);
    const tracked = client(gmMe, [goblin("gob000000001")]);
    tracked.store.set({ initiative: { entries: [entry("eeeeeeeeee", { tokenId: "gob000000001" })], turn: 0, round: 1 } });
    creaturesJoin(tracked, [goblin("gob000000001")]);
    expect(tracked.state.initiative.entries).toHaveLength(1);
    saveAutoInitiative(false);
    const off = client(gmMe);
    off.addToken({ label: "Goblin" });
    expect(off.state.initiative.entries).toEqual([]);
  });

  it("never for a player's token", () => {
    const p = client(playerMe);
    p.addToken({ label: "Wolf" });
    expect(p.state.initiative.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------- the Room

interface Conn extends Player {
  sid: string;
  v?: number;
}

interface Sent {
  t: string;
  initiative?: Initiative;
  message?: { roll?: { total: number } } | string;
}

interface Sock {
  conn: Conn;
  sent: Sent[];
  send(data: string): void;
  deserializeAttachment(): Conn;
  serializeAttachment(c: Conn): void;
}

interface RoomInside {
  items: Map<string, Item>;
  itemBytes: Map<string, number>;
  initiative: Initiative;
  countBytes(owner: string, bytes: number): void;
  handle(ws: Sock, conn: Conn, msg: unknown, seq: number | undefined): Promise<void>;
  handleItems(ws: Sock, conn: Conn, msg: { t: "items"; delete?: unknown[] }, seq: number | undefined): void;
  initiativeFor(c: Player): Initiative;
}

let RoomClass: { prototype: object };

beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  RoomClass = mod.Room;
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

function room(items: Item[], socks: Sock[], initiative: Initiative = { entries: [], turn: 0, round: 1 }): RoomInside {
  const r = Object.create(RoomClass.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => socks },
    env: {},
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    activeSceneId: "scene1",
    scenes: new Map([["scene1", scene("scene1")]]),
    items: new Map(),
    itemBytes: new Map(),
    totalItemBytes: 0,
    ownerBytes: new Map(),
    playerItemBytes: 0,
    tombstones: new Map(),
    lastPlayerInitiative: "",
    assets: new Map(),
    initiative,
    displayView: null,
    sessionSeqs: new Map(),
  });
  for (const i of items) {
    const n = JSON.stringify(i).length;
    r.items.set(i.id, i);
    r.itemBytes.set(i.id, n);
    r.countBytes(i.owner, n);
  }
  return r;
}

const gmConn = (): Conn => ({ connId: "gmc", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm", sid: "gmsid", v: 8 });
const playerConn = (): Conn => ({ connId: "alicec", userId: "alice", name: "alice", color: "#00ff00", role: "player", sid: "alicesid", v: 8 });
const rollTotal = (s: Sock) => {
  const m = s.sent.filter((x) => x.t === "chat").at(-1)?.message;
  return typeof m === "object" ? m.roll?.total : undefined;
};

describe("the Room", () => {
  it("keeps the GM's rows from the players; when it's one's turn, they're told it's someone they can't see", () => {
    const r = room([goblin("gob000000001")], [], {
      entries: [entry("monsterent1", { value: 9, hidden: true, tokenId: "gob000000001" }), entry("playerent01", { value: 4 })],
      turn: 0,
      round: 1,
    });
    expect(r.initiativeFor(playerConn())).toEqual({ entries: [entry("playerent01", { value: 4 })], turn: -1, round: 1 });
    expect(r.initiativeFor(gmConn()).entries).toHaveLength(2);
  });

  it("lets only the GM keep a row to themself, or show it", async () => {
    const alice = sock(playerConn());
    const r = room([], [alice], { entries: [entry("playerent01")], turn: 0, round: 1 });
    await r.handle(alice, alice.conn, { t: "initiative.op", op: { op: "add", entry: { ...entry("aliceent01"), hidden: true } } }, 1);
    expect(r.initiative.entries.find((e) => e.id === "aliceent01")).not.toHaveProperty("hidden");
    await r.handle(alice, alice.conn, { t: "initiative.op", op: { op: "update", id: "playerent01", hidden: true } }, 2);
    expect(r.initiative.entries.find((e) => e.id === "playerent01")).not.toHaveProperty("hidden");
    const gm = sock(gmConn());
    await r.handle(gm, gm.conn, { t: "initiative.op", op: { op: "update", id: "playerent01", hidden: true } }, 3);
    expect(r.initiative.entries.find((e) => e.id === "playerent01")?.hidden).toBe(true);
  });

  it("puts a card's Initiative roll into the list: a new row, then the same row's number", async () => {
    const alice = sock(playerConn());
    const pc = goblin("pctoken0001", { character: SHEET, label: "Testa", color: "#123456", owner: "alice" });
    const r = room([pc], [alice]);
    await r.handle(alice, alice.conn, { t: "roll", expr: "1d10+2", label: "Testa: initiative", initiative: { tokenId: pc.id } }, 1);
    expect(r.initiative.entries).toEqual([{ id: expect.any(String), name: "Testa", value: rollTotal(alice), color: "#123456", tokenId: pc.id }]);
    await r.handle(alice, alice.conn, { t: "roll", expr: "1d10+50", label: "Testa: initiative", initiative: { tokenId: pc.id } }, 2);
    expect(r.initiative.entries).toHaveLength(1);
    expect(r.initiative.entries[0].value).toBe(rollTotal(alice));
    expect(r.initiative.entries[0].value).toBeGreaterThan(50);
    // Everyone gets the list: the roll's in it.
    expect(alice.sent.filter((m) => m.t === "initiative").at(-1)?.initiative?.entries[0].value).toBe(rollTotal(alice));
  });

  it("never into a row the GM keeps from the roller, nor for a token they can't see", async () => {
    const alice = sock(playerConn());
    const hiddenGob = goblin("gob000000002", { hidden: true });
    const r = room([goblin("gob000000001"), hiddenGob], [alice], {
      entries: [entry("monsterent1", { value: 3, hidden: true, tokenId: "gob000000001" })],
      turn: 0,
      round: 1,
    });
    await r.handle(alice, alice.conn, { t: "roll", expr: "1d10", initiative: { tokenId: "gob000000001" } }, 1);
    await r.handle(alice, alice.conn, { t: "roll", expr: "1d10", initiative: { tokenId: hiddenGob.id } }, 2);
    expect(r.initiative.entries).toEqual([entry("monsterent1", { value: 3, hidden: true, tokenId: "gob000000001" })]);
  });

  it("takes a token's row out of the list when the token goes, the turn passing on", () => {
    const gm = sock(gmConn());
    const r = room([goblin("gob000000001"), goblin("gob000000002")], [gm], {
      entries: [entry("first00001", { value: 9, tokenId: "gob000000001" }), entry("second0001", { value: 4, tokenId: "gob000000002" })],
      turn: 0,
      round: 2,
    });
    r.handleItems(gm, gm.conn, { t: "items", delete: ["gob000000001"] }, 1);
    expect(r.initiative).toEqual({ entries: [entry("second0001", { value: 4, tokenId: "gob000000002" })], turn: 0, round: 2 });
    expect(gm.sent.filter((m) => m.t === "initiative").at(-1)?.initiative?.entries).toHaveLength(1);
  });
});

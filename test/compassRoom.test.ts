// The Room (the server) and compasses: the per-scene limit however a compass comes to a
// scene, and tabs too old to know compasses (they aren't sent them, can't change them, and
// are asked to reload). The Room runs here without the Workers runtime: a bare object with
// its fields set, fake sockets that keep what they're sent, and storage that does nothing.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, LIMITS } from "../src/shared/sanitize";
import type { Item, Player, Scene, TokenItem } from "../src/shared/types";
import { compassesOn } from "../src/shared/types";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

interface Conn extends Player {
  sid: string;
  v?: number;
  warned?: boolean;
}

/** A message the Room sent (only what these tests look at). */
interface Sent {
  t: string;
  message?: string;
  refused?: string[];
  upsert?: Item[];
  patch?: { id: string }[];
  delete?: string[];
  items?: Item[];
}

interface Sock {
  conn: Conn;
  sent: Sent[];
  send(data: string): void;
  deserializeAttachment(): Conn;
  serializeAttachment(c: Conn): void;
}

/** The Room's insides these tests use. */
interface RoomInside {
  items: Map<string, Item>;
  itemBytes: Map<string, number>;
  countBytes(owner: string, bytes: number): void;
  handleItems(ws: Sock, conn: Conn, msg: { t: "items"; upsert?: unknown[]; patch?: unknown[]; delete?: unknown[] }, seq: number | undefined): void;
  hello(conn: Conn): { items: Item[] };
  broadcastActive(): void;
  activeSceneId: string | null;
}

let RoomClass: { prototype: object };

beforeAll(async () => {
  // Imported by a path tsc doesn't follow: the tests' types leave out the Workers runtime.
  const mod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  RoomClass = mod.Room;
});

function scene(id: string): Scene {
  return {
    id,
    name: id,
    order: 0,
    mapAssetId: null,
    width: 1400,
    height: 1000,
    background: "#000000",
    grid: { ...DEFAULT_GRID },
    fogCover: false,
    createdAt: 0,
  };
}

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

function room(items: Item[], socks: Sock[]): RoomInside {
  const r = Object.create(RoomClass.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => socks },
    env: {},
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    activeSceneId: "scene1",
    scenes: new Map([
      ["scene1", scene("scene1")],
      ["scene2", scene("scene2")],
    ]),
    items: new Map(),
    itemBytes: new Map(),
    totalItemBytes: 0,
    ownerBytes: new Map(),
    playerItemBytes: 0,
    tombstones: new Map(),
    lastPlayerInitiative: "",
    assets: new Map(),
    initiative: { entries: [], turn: 0, round: 1 },
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

const compass: TokenItem = {
  id: "comp1",
  sceneId: "scene1",
  kind: "token",
  z: 0,
  owner: GM_OWNER,
  x: 140,
  y: 140,
  size: 2,
  rotation: 30,
  assetId: null,
  color: "#d62f2f",
  label: "N",
  hidden: false,
  locked: false,
  rings: [],
  layer: "prop",
  art: "compass",
};
const { layer: _layer, art: _art, ...plain } = compass;
const token = (id: string, sceneId = "scene1"): TokenItem => ({ ...plain, id, sceneId, label: "Goblin", size: 1 });
const compassAt = (id: string, sceneId = "scene1"): TokenItem => ({ ...compass, id, sceneId });

const gmConn = (v = 4): Conn => ({ connId: "gmc", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm", sid: "gmsid", v });
const playerConn = (v = 4, id = "alice"): Conn => ({ connId: `${id}c`, userId: id, name: id, color: "#00ff00", role: "player", sid: `${id}sid`, v });

function full(): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < LIMITS.compassesPerScene; i++) items.push(compassAt(`full${i}`));
  return items;
}

const last = (s: Sock, t: string) => s.sent.filter((m) => m.t === t).at(-1);

describe("the limit on compasses per scene", () => {
  it("refuses a compass added past it", () => {
    const gm = sock(gmConn());
    const r = room(full(), [gm]);
    r.handleItems(gm, gm.conn, { t: "items", upsert: [compassAt("extra")] }, 1);
    expect(last(gm, "items")?.refused).toEqual(["extra"]);
    expect(compassesOn(r.items.values(), "scene1")).toBe(LIMITS.compassesPerScene);
  });

  it("refuses a token made into a compass past it", () => {
    const gm = sock(gmConn());
    const r = room([...full(), token("gob")], [gm]);
    r.handleItems(gm, gm.conn, { t: "items", upsert: [{ ...token("gob"), layer: "prop", art: "compass" }] }, 1);
    expect(last(gm, "items")?.refused).toEqual(["gob"]);
    expect(r.items.get("gob")?.kind === "token" && r.items.get("gob")).not.toHaveProperty("art");
    expect(compassesOn(r.items.values(), "scene1")).toBe(LIMITS.compassesPerScene);
  });

  it("refuses a compass moved over from another scene past it", () => {
    const gm = sock(gmConn());
    const r = room([...full(), compassAt("away", "scene2")], [gm]);
    r.handleItems(gm, gm.conn, { t: "items", upsert: [compassAt("away", "scene1")] }, 1);
    expect(last(gm, "items")?.refused).toEqual(["away"]);
    expect(r.items.get("away")?.sceneId).toBe("scene2");
  });

  it("still lets a compass on a full scene be changed, replaced or deleted", () => {
    const gm = sock(gmConn());
    const r = room(full(), [gm]);
    r.handleItems(gm, gm.conn, { t: "items", upsert: [{ ...compassAt("full0"), rotation: 90 }], patch: [{ id: "full1", set: { rotation: 45 } }] }, 1);
    expect(last(gm, "items")?.refused).toBeUndefined();
    expect(r.items.get("full0")).toMatchObject({ rotation: 90 });
    expect(r.items.get("full1")).toMatchObject({ rotation: 45 });
    // Deleting one makes room for another.
    r.handleItems(gm, gm.conn, { t: "items", delete: ["full2"] }, 2);
    r.handleItems(gm, gm.conn, { t: "items", upsert: [compassAt("new")] }, 3);
    expect(last(gm, "items")?.refused).toBeUndefined();
    expect(r.items.has("new")).toBe(true);
  });

  it("counts what one message adds, and stops at it", () => {
    const gm = sock(gmConn());
    const r = room([], [gm]);
    const many = Array.from({ length: LIMITS.compassesPerScene + 3 }, (_, i) => compassAt(`c${i}`));
    r.handleItems(gm, gm.conn, { t: "items", upsert: many }, 1);
    expect(last(gm, "items")?.refused).toHaveLength(3);
    expect(compassesOn(r.items.values(), "scene1")).toBe(LIMITS.compassesPerScene);
  });
});

describe("tabs too old to know compasses", () => {
  it("aren't sent them when they connect, and the others are", () => {
    const r = room([compass, token("gob")], []);
    expect(r.hello(playerConn(3)).items.map((i) => i.id)).toEqual(["gob"]);
    expect(r.hello(gmConn(3)).items.map((i) => i.id)).toEqual(["gob"]);
    expect(r.hello(playerConn(4)).items.map((i) => i.id)).toEqual(["comp1", "gob"]);
  });

  it("aren't sent one that's added or changed, and are asked to reload once", () => {
    const gm = sock(gmConn());
    const old = sock(playerConn(3, "olda"));
    const now = sock(playerConn(4, "nowa"));
    const r = room([], [gm, old, now]);
    r.handleItems(gm, gm.conn, { t: "items", upsert: [compass] }, 1);
    expect(last(now, "items")?.upsert?.map((i) => i.id)).toEqual(["comp1"]);
    expect(old.sent.some((m) => m.t === "items")).toBe(false);
    expect(old.sent.filter((m) => m.t === "error")).toHaveLength(1);
    expect(last(old, "error")?.message).toMatch(/Reload this page/);
    r.handleItems(gm, gm.conn, { t: "items", patch: [{ id: "comp1", set: { rotation: 90 } }] }, 2);
    expect(old.sent.some((m) => m.t === "items")).toBe(false);
    expect(old.sent.filter((m) => m.t === "error")).toHaveLength(1);
  });

  it("can't add, change or delete one", () => {
    const old = sock(gmConn(3));
    const r = room([compass], [old]);
    r.handleItems(old, old.conn, { t: "items", upsert: [compassAt("made")], patch: [{ id: "comp1", set: { x: 0 } }] }, 1);
    r.handleItems(old, old.conn, { t: "items", delete: ["comp1"] }, 2);
    const answers = old.sent.filter((m) => m.t === "items");
    expect(answers[0].refused?.sort()).toEqual(["comp1", "made"]);
    expect(answers[1].refused).toEqual(["comp1"]);
    // Corrected without being shown the compass.
    expect(answers.flatMap((m) => m.upsert ?? [])).toEqual([]);
    expect(r.items.get("comp1")).toEqual(compass);
    expect(r.items.has("made")).toBe(false);
  });

  it("get a live scene without its compasses, and are asked to reload", () => {
    const old = sock(playerConn(3, "olda"));
    const older = sock(playerConn(1, "oldb"));
    const now = sock(playerConn(4, "nowa"));
    const r = room([compass, token("gob")], [old, older, now]);
    r.broadcastActive();
    expect(last(now, "scene.active")?.items?.map((i) => i.id)).toEqual(["comp1", "gob"]);
    for (const s of [old, older]) {
      expect(last(s, "scene.active")?.items?.map((i) => i.id)).toEqual(["gob"]);
      expect(last(s, "error")?.message).toMatch(/Reload this page/);
    }
    expect(now.sent.some((m) => m.t === "error")).toBe(false);
  });

  it("aren't asked to reload over a scene with no compass or built map", () => {
    const old = sock(playerConn(3, "olda"));
    const r = room([token("gob")], [old]);
    r.broadcastActive();
    expect(last(old, "scene.active")?.items?.map((i) => i.id)).toEqual(["gob"]);
    expect(old.sent.some((m) => m.t === "error")).toBe(false);
  });
});

// The party split (Par, 2026-11-14: "DM being able to choose who to move from map to map ... the
// tokens of players will be doing some solo work"): the GM sends people to a scene apart from the
// party. Each person sees only their own scene, and nothing of another: its tokens, its pings and
// its initiative rows never reach them. Only the GM is told who's where. Show to players puts
// everyone together again. The Room runs here without the Workers runtime: a bare object with its
// fields set, fake sockets that keep what they're sent, and storage that does nothing.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Character } from "../src/shared/characters";
import type { InitEntry, Item, Player, Scene, TokenItem } from "../src/shared/types";
import { listNames, playersOf, sendables, sentGone } from "../src/client/levels";
import { GUIDE } from "../src/client/guide";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

interface Conn extends Player {
  sid: string;
  v?: number;
}

interface Sent {
  t: string;
  id?: string | null;
  scene?: Scene | null;
  items?: Item[];
  upsert?: Item[];
  patch?: { id: string }[];
  delete?: string[];
  placed?: Record<string, string>;
  e?: { k: string; sceneId: string };
  initiative?: { entries: InitEntry[]; turn: number };
  message?: string;
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
  placed: Map<string, string>;
  activeSceneId: string | null;
  initiative: { entries: InitEntry[]; turn: number; round: number };
  countBytes(owner: string, bytes: number): void;
  handle(ws: Sock, conn: Conn, msg: object, seq: number | undefined): Promise<void>;
  handleItems(ws: Sock, conn: Conn, msg: { t: "items"; patch?: unknown[] }, seq: number | undefined): void;
  handleEph(ws: Sock, conn: Conn, raw: unknown): void;
  hello(conn: Conn): { activeSceneId: string | null; scenes: Scene[]; items: Item[]; placed?: Record<string, string>; initiative: { entries: InitEntry[] } };
}

let RoomClass: { prototype: object };

beforeAll(async () => {
  // Imported by a path tsc doesn't follow: the tests' types leave out the Workers runtime.
  const mod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  RoomClass = mod.Room;
});

const scene = (id: string, order = 0): Scene => ({
  id,
  name: id === "party" ? "Town" : id === "solo" ? "Cave" : id,
  order,
  mapAssetId: null,
  width: 1400,
  height: 1000,
  background: "#000000",
  grid: { ...DEFAULT_GRID },
  fogCover: false,
  createdAt: 0,
});

const token = (id: string, sceneId: string, over: Partial<TokenItem> = {}): TokenItem => ({
  id,
  sceneId,
  kind: "token",
  z: 0,
  owner: GM_OWNER,
  x: 100,
  y: 100,
  size: 1,
  rotation: 0,
  assetId: null,
  color: "#d62f2f",
  label: id,
  hidden: false,
  locked: false,
  rings: [],
  ...over,
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

const conn = (id: string, userId: string, over: Partial<Conn> = {}): Conn => ({ connId: id, userId, name: userId, color: "#00ff00", role: "player", sid: `${id}sid`, v: 20, ...over });

/** A room with Town (live), Cave and Keep; Grimmdark in Town, Tomas and a goblin (and a hidden ogre) in the Cave. */
function setup() {
  const gm = sock(conn("gmc", GM_OWNER, { role: "gm", name: "GM" }));
  const greg = sock(conn("gregc", "greg"));
  const gregPhone = sock(conn("greg2c", "greg"));
  const tanya = sock(conn("tanyac", "tanya"));
  const display = sock(conn("dispc", "disp", { display: true }));
  const socks = [gm, greg, gregPhone, tanya, display];
  const r = Object.create(RoomClass.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => socks },
    env: {},
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    activeSceneId: "party",
    placed: new Map(),
    scenes: new Map([
      ["party", scene("party", 0)],
      ["solo", scene("solo", 1)],
      ["keep", scene("keep", 2)],
    ]),
    items: new Map(),
    itemBytes: new Map(),
    totalItemBytes: 0,
    ownerBytes: new Map(),
    playerItemBytes: 0,
    tombstones: new Map(),
    lastPlayerInitiative: new Map(),
    assets: new Map(),
    initiative: {
      entries: [
        { id: "i1", name: "Grimmdark", value: 12, color: "#fff", tokenId: "grimm" },
        { id: "i2", name: "Goblin", value: 9, color: "#fff", tokenId: "goblin" },
        { id: "i3", name: "Typed in", value: 5, color: "#fff", tokenId: null },
      ],
      turn: 1,
      round: 1,
    },
    displayView: null,
    sessionSeqs: new Map(),
    tokenStats: new Map(),
    explored: new Map(),
  });
  for (const i of [token("grimm", "party", { character: "sheetG" }), token("tomas", "solo", { character: "sheetT" }), token("goblin", "solo"), token("ogre", "solo", { hidden: true })]) {
    r.items.set(i.id, i);
    r.itemBytes.set(i.id, 100);
    r.countBytes(i.owner, 100);
  }
  const clear = () => {
    for (const s of socks) s.sent.length = 0;
  };
  const say = (s: Sock, msg: object) => r.handle(s, s.conn, msg, 1);
  const actives = (s: Sock) => s.sent.filter((m) => m.t === "scene.active");
  return { r, gm, greg, gregPhone, tanya, display, socks, clear, say, actives };
}

describe("the party split at the Room", () => {
  it("sends chosen people to another scene: every tab of theirs gets it alone, and only the GM hears who's where", async () => {
    const t = setup();
    t.clear();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["greg"] });
    for (const s of [t.greg, t.gregPhone]) {
      const [msg] = t.actives(s);
      expect(msg.id).toBe("solo");
      expect(msg.scene?.id).toBe("solo");
      // The Cave's tokens, never the hidden ogre, and nothing from Town.
      expect(msg.items?.map((i) => i.id).sort()).toEqual(["goblin", "tomas"]);
    }
    // Tanya and the table display stay with the party, and aren't told anything.
    expect(t.actives(t.tanya)).toEqual([]);
    expect(t.actives(t.display)).toEqual([]);
    for (const s of [t.greg, t.tanya, t.display]) expect(s.sent.some((m) => m.t === "placed")).toBe(false);
    // The GM's own view stays put, and the GM hears who's where.
    expect(t.actives(t.gm)).toEqual([]);
    expect(t.gm.sent.find((m) => m.t === "placed")?.placed).toEqual({ greg: "solo" });
    // Greg's initiative list: his scene's rows (the goblin's, its turn) and the typed-in one.
    const init = t.greg.sent.find((m) => m.t === "initiative")?.initiative;
    expect(init?.entries.map((e) => e.id)).toEqual(["i2", "i3"]);
    expect(init?.turn).toBe(0);
  });

  it("then each sees only their own scene: its changes, its pings, its initiative rows, and on connecting", async () => {
    const t = setup();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["greg"] });
    t.clear();
    t.r.handleItems(t.gm, t.gm.conn, { t: "items", patch: [{ id: "goblin", set: { x: 300 } }, { id: "grimm", set: { x: 300 } }] }, 2);
    const changed = (s: Sock) => s.sent.filter((m) => m.t === "items").flatMap((m) => [...(m.patch ?? []).map((p) => p.id), ...(m.upsert ?? []).map((i) => i.id)]);
    expect(changed(t.greg)).toEqual(["goblin"]);
    expect(changed(t.tanya)).toEqual(["grimm"]);
    expect(changed(t.display)).toEqual(["grimm"]);
    t.clear();
    t.r.handleEph(t.gm, t.gm.conn, { k: "pointer", sceneId: "solo", x: 1, y: 1, ping: true });
    t.r.handleEph(t.gm, t.gm.conn, { k: "pointer", sceneId: "party", x: 1, y: 1, ping: true });
    const pings = (s: Sock) => s.sent.filter((m) => m.t === "eph").map((m) => m.e?.sceneId);
    expect(pings(t.greg)).toEqual(["solo"]);
    expect(pings(t.tanya)).toEqual(["party"]);
    expect(pings(t.display)).toEqual(["party"]);
    // Connecting (again): Greg gets the Cave as his scene, and only it.
    const hello = t.r.hello(t.greg.conn);
    expect(hello.activeSceneId).toBe("solo");
    expect(hello.scenes.map((s) => s.id)).toEqual(["solo"]);
    expect(hello.items.map((i) => i.id).sort()).toEqual(["goblin", "tomas"]);
    expect(hello.placed).toBeUndefined();
    expect(hello.initiative.entries.map((e) => e.id)).toEqual(["i2", "i3"]);
    expect(t.r.hello(t.tanya.conn).initiative.entries.map((e) => e.id)).toEqual(["i1", "i3"]);
    expect(t.r.hello(t.gm.conn).placed).toEqual({ greg: "solo" });
    // A player can't move a token on a scene they're not on.
    t.clear();
    t.r.handleItems(t.tanya, t.tanya.conn, { t: "items", patch: [{ id: "goblin", set: { x: 5 } }] }, 3);
    expect(t.r.items.get("goblin")?.kind === "token" && (t.r.items.get("goblin") as TokenItem).x).toBe(300);
  });

  it("the party moving on leaves someone on their own where they are, and Show to players brings everyone together", async () => {
    const t = setup();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["greg"] });
    t.clear();
    // The party to the Keep (Take the party here): Greg stays in the Cave, undisturbed.
    await t.say(t.gm, { t: "scene.activate", id: "keep" });
    expect(t.actives(t.tanya).map((m) => m.id)).toEqual(["keep"]);
    expect(t.actives(t.display).map((m) => m.id)).toEqual(["keep"]);
    expect(t.actives(t.greg)).toEqual([]);
    expect(t.actives(t.gm).map((m) => m.id)).toEqual(["keep"]);
    // The party taken to the Cave: Greg's with the party again, and isn't sent it twice.
    t.clear();
    await t.say(t.gm, { t: "scene.activate", id: "solo" });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.greg)).toEqual([]);
    expect(t.actives(t.tanya).map((m) => m.id)).toEqual(["solo"]);
    expect(t.gm.sent.find((m) => m.t === "placed")?.placed).toEqual({});
    // Sent away again, then Show to players (everyone) on the Keep.
    await t.say(t.gm, { t: "scene.send", id: "party", users: ["greg", "tanya"] });
    expect(Object.fromEntries(t.r.placed)).toEqual({ greg: "party", tanya: "party" });
    t.clear();
    await t.say(t.gm, { t: "scene.activate", id: "keep", all: true });
    expect(t.r.placed.size).toBe(0);
    for (const s of [t.greg, t.tanya, t.display]) expect(t.actives(s).map((m) => m.id)).toEqual(["keep"]);
  });

  it("sent to the live scene, someone's back with the party; their scene deleted, they're back too", async () => {
    const t = setup();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["greg"] });
    t.clear();
    await t.say(t.gm, { t: "scene.send", id: "party", users: ["greg"] });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.greg).map((m) => m.id)).toEqual(["party"]);
    await t.say(t.gm, { t: "scene.send", id: "keep", users: ["greg"] });
    t.clear();
    await t.say(t.gm, { t: "scene.delete", id: "keep" });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.greg).map((m) => m.id)).toEqual(["party"]);
    expect(t.actives(t.tanya)).toEqual([]);
  });

  it("only the GM sends people, only to a scene that exists, and only names that could be people", async () => {
    const t = setup();
    t.clear();
    await t.say(t.greg, { t: "scene.send", id: "solo", users: ["greg"] });
    expect(t.greg.sent.at(-1)).toEqual({ t: "error", message: "Only the GM can do that." });
    await t.say(t.gm, { t: "scene.send", id: "nowhere", users: ["greg"] });
    await t.say(t.gm, { t: "scene.send", id: "solo", users: "greg" });
    await t.say(t.gm, { t: "scene.send", id: "solo", users: [42, "", "a b", "__proto__"] });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.greg)).toEqual([]);
  });

  it("is kept with the room, and every scene change, ping and explored cell goes by each person's scene", () => {
    const room = read("src/worker/room.ts");
    expect(room).toContain('this.placed = new Map(Object.entries(meta.has("placed")');
    expect(room).toContain('this.setMeta("placed", Object.fromEntries(this.placed));');
    // Nothing sent to a player is decided by the live scene alone any more.
    const forPlayers = room.match(/visibleToPlayer\([^)]*this\.activeSceneId\)/g);
    expect(forPlayers).toBeNull();
    expect(room).not.toContain("sceneFor(scene, c, this.activeSceneId)");
    expect(room).toContain("(c) => this.onScene(c, sceneId)");
    expect(room).toContain("(c) => this.onScene(c, scene.id)");
    // Only the GM is told who's where.
    expect(room).toContain('this.broadcast({ t: "placed", placed: Object.fromEntries(this.placed) }, (c) => c.role === "gm");');
  });
});

describe("Send here, on the GM's page", () => {
  const characters = [
    { id: "sheetT", name: "Tomas Verek", players: [{ userId: "greg", name: "Greg" }] },
    { id: "sheetG", name: "Grimmdark", players: [{ userId: "greg", name: "Greg" }] },
    { id: "sheetN", name: "Nancael", players: [{ userId: "tanya", name: "Tanya" }] },
  ] as unknown as Character[];
  const state = (placed: Record<string, string>, items: TokenItem[]) => ({
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    scenes: { party: scene("party", 0), solo: scene("solo", 1), old: scene("old", 2) },
    placed,
    activeSceneId: "party",
    party: { configured: true, readAt: 1, characters },
  });

  it("lists the party's tokens on maps people are on, with who plays them, and not ones left on old maps", () => {
    const items = [
      token("tomas", "party", { character: "sheetT", label: "Tomas Verek" }),
      token("nan", "party", { character: "sheetN", label: "Nancael" }),
      token("grimm-old", "old", { character: "sheetG", label: "Grimmdark" }),
      token("goblin", "party", { label: "Goblin" }),
      token("pet", "party", { owner: "tanya", label: "Tanya's cat" }),
    ];
    const list = sendables(state({}, items), "solo");
    expect(list.map((o) => o.token.id).sort()).toEqual(["nan", "pet", "tomas"]);
    expect(list.find((o) => o.token.id === "tomas")?.people).toEqual([{ userId: "greg", name: "Greg" }]);
    expect(playersOf(items[4], characters)).toEqual([{ userId: "tanya", name: "" }]);
  });

  it("lists a token already here whose player is elsewhere, first; and not once they're here", () => {
    const items = [token("tomas", "solo", { character: "sheetT", label: "Tomas Verek" }), token("nan", "party", { character: "sheetN", label: "Nancael" })];
    const list = sendables(state({}, items), "solo");
    expect(list.map((o) => [o.token.id, o.here])).toEqual([["tomas", true], ["nan", false]]);
    expect(sendables(state({ greg: "solo" }, items), "solo").map((o) => o.token.id)).toEqual(["nan"]);
    // From the Cave, bringing them back: Tomas is on a map Greg's on, so he's listed for Town.
    expect(sendables(state({ greg: "solo" }, items), "party").map((o) => o.token.id)).toEqual(["tomas"]);
  });

  it("tells the GM who went where and who sees it", () => {
    expect(listNames(["Greg"])).toBe("Greg");
    expect(listNames(["Greg", "Jamie", "Tanya"])).toBe("Greg, Jamie and Tanya");
    expect(sentGone([token("tomas", "solo", { label: "Tomas Verek" })], "“Cave”", ["Greg"])).toBe("Tomas Verek to “Cave”: Greg sees it now.");
    expect(sentGone([], "“Town”", ["Greg", "Tanya"])).toBe("Greg and Tanya see “Town” now.");
  });

  it("has Send here on the party bar, a click to place them, and the Scenes panel and top bar saying who sees what", () => {
    const bar = read("src/client/ui/PartyBar.tsx");
    for (const words of ["Send here", "Send them here", "Click where they arrive.", "room.store.set({ partyTake: { sceneId: view.id, tokens: moving, users }, lightAdd: null });", "room.sendToScene(view.id, users);", "From one map at a time"]) {
      expect(bar).toContain(words);
    }
    const board = read("src/client/room/board.ts");
    expect(board).toContain("sendTokens(this.room, going.from, scene, going.party, users, place)");
    const scenes = read("src/client/ui/ScenesPanel.tsx");
    expect(scenes).toContain("onClick={() => room.activateScene(s.id, true)}");
    expect(scenes).toContain('{split ? "The party sees this" : "Players see this"}');
    expect(read("src/client/room/client.ts")).toContain('this.submit({ t: "scene.send", id, users });');
  });

  it("is in the guide: how to send someone off on their own, bring them back, and that nobody else is told", () => {
    const part = GUIDE.flatMap((s) => s.parts).find((p) => p.title === "Split the party: send some to another map");
    expect(part).toBeTruthy();
    const text = [...part!.steps, ...part!.notes].join("\n");
    for (const words of ["**Send here**", "**Send them here**", "**Show to players**", "nobody else is told", "Only you, the GM, see where everyone is", "Tomas"]) expect(text).toContain(words);
  });
});

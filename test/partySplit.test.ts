// The party split (asked for on 2026-11-14: "DM being able to choose who to move from map to map ... the
// tokens of players will be doing some solo work"): the GM sends people to a scene apart from the
// party. Each person sees only their own scene, and nothing of another: its tokens, its pings and
// its initiative rows never reach them. Only the GM is told who's where. Show to players puts
// everyone together again. The Room runs here without the Workers runtime: a bare object with its
// fields set, fake sockets that keep what they're sent, and storage that does nothing.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Character } from "../src/shared/characters";
import type { InitEntry, Item, Player, Scene, TokenItem } from "../src/shared/types";
import { listNames, playersOf, sendables, sentGone, unplaced } from "../src/client/levels";
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

/** A room with Town (live), Cave and Keep; Gorran in Town, Torin and a goblin (and a hidden ogre) in the Cave. */
function setup() {
  const gm = sock(conn("gmc", GM_OWNER, { role: "gm", name: "GM" }));
  const bram = sock(conn("bramc", "bram"));
  const bramPhone = sock(conn("bram2c", "bram"));
  const ula = sock(conn("ulac", "ula"));
  const display = sock(conn("dispc", "disp", { display: true }));
  const socks = [gm, bram, bramPhone, ula, display];
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
        { id: "i1", name: "Gorran", value: 12, color: "#fff", tokenId: "gorran" },
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
  for (const i of [token("gorran", "party", { character: "sheetG" }), token("torin", "solo", { character: "sheetT" }), token("goblin", "solo"), token("ogre", "solo", { hidden: true })]) {
    r.items.set(i.id, i);
    r.itemBytes.set(i.id, 100);
    r.countBytes(i.owner, 100);
  }
  const clear = () => {
    for (const s of socks) s.sent.length = 0;
  };
  const say = (s: Sock, msg: object) => r.handle(s, s.conn, msg, 1);
  const actives = (s: Sock) => s.sent.filter((m) => m.t === "scene.active");
  return { r, gm, bram, bramPhone, ula, display, socks, clear, say, actives };
}

describe("the party split at the Room", () => {
  it("sends chosen people to another scene: every tab of theirs gets it alone, and only the GM hears who's where", async () => {
    const t = setup();
    t.clear();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["bram"] });
    for (const s of [t.bram, t.bramPhone]) {
      const [msg] = t.actives(s);
      expect(msg.id).toBe("solo");
      expect(msg.scene?.id).toBe("solo");
      // The Cave's tokens, never the hidden ogre, and nothing from Town.
      expect(msg.items?.map((i) => i.id).sort()).toEqual(["goblin", "torin"]);
    }
    // Ula and the table display stay with the party, and aren't told anything.
    expect(t.actives(t.ula)).toEqual([]);
    expect(t.actives(t.display)).toEqual([]);
    for (const s of [t.bram, t.ula, t.display]) expect(s.sent.some((m) => m.t === "placed")).toBe(false);
    // The GM's own view stays put, and the GM hears who's where.
    expect(t.actives(t.gm)).toEqual([]);
    expect(t.gm.sent.find((m) => m.t === "placed")?.placed).toEqual({ bram: "solo" });
    // Bram's initiative list: his scene's rows (the goblin's, its turn) and the typed-in one.
    const init = t.bram.sent.find((m) => m.t === "initiative")?.initiative;
    expect(init?.entries.map((e) => e.id)).toEqual(["i2", "i3"]);
    expect(init?.turn).toBe(0);
  });

  it("then each sees only their own scene: its changes, its pings, its initiative rows, and on connecting", async () => {
    const t = setup();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["bram"] });
    t.clear();
    t.r.handleItems(t.gm, t.gm.conn, { t: "items", patch: [{ id: "goblin", set: { x: 300 } }, { id: "gorran", set: { x: 300 } }] }, 2);
    const changed = (s: Sock) => s.sent.filter((m) => m.t === "items").flatMap((m) => [...(m.patch ?? []).map((p) => p.id), ...(m.upsert ?? []).map((i) => i.id)]);
    expect(changed(t.bram)).toEqual(["goblin"]);
    expect(changed(t.ula)).toEqual(["gorran"]);
    expect(changed(t.display)).toEqual(["gorran"]);
    t.clear();
    t.r.handleEph(t.gm, t.gm.conn, { k: "pointer", sceneId: "solo", x: 1, y: 1, ping: true });
    t.r.handleEph(t.gm, t.gm.conn, { k: "pointer", sceneId: "party", x: 1, y: 1, ping: true });
    const pings = (s: Sock) => s.sent.filter((m) => m.t === "eph").map((m) => m.e?.sceneId);
    expect(pings(t.bram)).toEqual(["solo"]);
    expect(pings(t.ula)).toEqual(["party"]);
    expect(pings(t.display)).toEqual(["party"]);
    // Connecting (again): Bram gets the Cave as his scene, and only it.
    const hello = t.r.hello(t.bram.conn);
    expect(hello.activeSceneId).toBe("solo");
    expect(hello.scenes.map((s) => s.id)).toEqual(["solo"]);
    expect(hello.items.map((i) => i.id).sort()).toEqual(["goblin", "torin"]);
    expect(hello.placed).toBeUndefined();
    expect(hello.initiative.entries.map((e) => e.id)).toEqual(["i2", "i3"]);
    expect(t.r.hello(t.ula.conn).initiative.entries.map((e) => e.id)).toEqual(["i1", "i3"]);
    expect(t.r.hello(t.gm.conn).placed).toEqual({ bram: "solo" });
    // A player can't move a token on a scene they're not on.
    t.clear();
    t.r.handleItems(t.ula, t.ula.conn, { t: "items", patch: [{ id: "goblin", set: { x: 5 } }] }, 3);
    expect(t.r.items.get("goblin")?.kind === "token" && (t.r.items.get("goblin") as TokenItem).x).toBe(300);
  });

  it("the party moving on leaves someone on their own where they are, and Show to players brings everyone together", async () => {
    const t = setup();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["bram"] });
    t.clear();
    // The party to the Keep (Take the party here): Bram stays in the Cave, undisturbed.
    await t.say(t.gm, { t: "scene.activate", id: "keep" });
    expect(t.actives(t.ula).map((m) => m.id)).toEqual(["keep"]);
    expect(t.actives(t.display).map((m) => m.id)).toEqual(["keep"]);
    expect(t.actives(t.bram)).toEqual([]);
    expect(t.actives(t.gm).map((m) => m.id)).toEqual(["keep"]);
    // The party taken to the Cave: Bram's with the party again, and isn't sent it twice.
    t.clear();
    await t.say(t.gm, { t: "scene.activate", id: "solo" });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.bram)).toEqual([]);
    expect(t.actives(t.ula).map((m) => m.id)).toEqual(["solo"]);
    expect(t.gm.sent.find((m) => m.t === "placed")?.placed).toEqual({});
    // Sent away again, then Show to players (everyone) on the Keep.
    await t.say(t.gm, { t: "scene.send", id: "party", users: ["bram", "ula"] });
    expect(Object.fromEntries(t.r.placed)).toEqual({ bram: "party", ula: "party" });
    t.clear();
    await t.say(t.gm, { t: "scene.activate", id: "keep", all: true });
    expect(t.r.placed.size).toBe(0);
    for (const s of [t.bram, t.ula, t.display]) expect(t.actives(s).map((m) => m.id)).toEqual(["keep"]);
  });

  it("sent to the live scene, someone's back with the party; their scene deleted, they're back too", async () => {
    const t = setup();
    await t.say(t.gm, { t: "scene.send", id: "solo", users: ["bram"] });
    t.clear();
    await t.say(t.gm, { t: "scene.send", id: "party", users: ["bram"] });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.bram).map((m) => m.id)).toEqual(["party"]);
    await t.say(t.gm, { t: "scene.send", id: "keep", users: ["bram"] });
    t.clear();
    await t.say(t.gm, { t: "scene.delete", id: "keep" });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.bram).map((m) => m.id)).toEqual(["party"]);
    expect(t.actives(t.ula)).toEqual([]);
  });

  it("only the GM sends people, only to a scene that exists, and only names that could be people", async () => {
    const t = setup();
    t.clear();
    await t.say(t.bram, { t: "scene.send", id: "solo", users: ["bram"] });
    expect(t.bram.sent.at(-1)).toEqual({ t: "error", message: "Only the GM can do that." });
    await t.say(t.gm, { t: "scene.send", id: "nowhere", users: ["bram"] });
    await t.say(t.gm, { t: "scene.send", id: "solo", users: "bram" });
    await t.say(t.gm, { t: "scene.send", id: "solo", users: [42, "", "a b", "__proto__"] });
    expect(t.r.placed.size).toBe(0);
    expect(t.actives(t.bram)).toEqual([]);
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
    { id: "sheetT", name: "Torin Vale", players: [{ userId: "bram", name: "Bram" }] },
    { id: "sheetG", name: "Gorran", players: [{ userId: "bram", name: "Bram" }] },
    { id: "sheetN", name: "Nessa", players: [{ userId: "ula", name: "Ula" }] },
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
      token("torin", "party", { character: "sheetT", label: "Torin Vale" }),
      token("nessa", "party", { character: "sheetN", label: "Nessa" }),
      token("gorran-old", "old", { character: "sheetG", label: "Gorran" }),
      token("goblin", "party", { label: "Goblin" }),
      token("pet", "party", { owner: "ula", label: "Ula's cat" }),
    ];
    const list = sendables(state({}, items), "solo");
    expect(list.map((o) => o.token.id).sort()).toEqual(["nessa", "pet", "torin"]);
    expect(list.find((o) => o.token.id === "torin")?.people).toEqual([{ userId: "bram", name: "Bram" }]);
    expect(playersOf(items[4], characters)).toEqual([{ userId: "ula", name: "" }]);
  });

  it("lists the GM's NPCs marked Travel with the party, to go with them: nobody plays them, and nobody's sent for them", () => {
    const items = [
      token("torin", "party", { character: "sheetT", label: "Torin Vale" }),
      token("mira", "party", { label: "Mira the guide", withParty: true }),
      token("mule", "party", { label: "Mule", withParty: true, layer: "prop", hidden: true }),
      token("goblin", "party", { label: "Goblin" }),
      token("north", "party", { label: "", art: "compass", withParty: true }),
      token("hound", "solo", { label: "Hound", withParty: true }),
      token("ghost", "old", { label: "Ghost", withParty: true }),
    ];
    const list = sendables(state({}, items), "solo");
    // Not the unmarked goblin, a compass, one already on the Cave, or one left on an old map.
    expect(list.map((o) => o.token.id).sort()).toEqual(["mira", "mule", "torin"]);
    expect(list.find((o) => o.token.id === "mira")).toMatchObject({ here: false, people: [], companion: true });
    expect(list.find((o) => o.token.id === "torin")).toMatchObject({ companion: false });
    // Sent to the Cave with Bram, Mira's listed to bring back to Town with him.
    const after = [token("torin", "solo", { character: "sheetT", label: "Torin Vale" }), token("mira", "solo", { label: "Mira the guide", withParty: true })];
    expect(sendables(state({ bram: "solo" }, after), "party").map((o) => o.token.id).sort()).toEqual(["mira", "torin"]);
    // Sending only an NPC tells the GM nobody sees it.
    expect(sentGone([{ label: "Mira the guide" }], "“Cave”", [])).toBe("Mira the guide to “Cave”: nobody plays them, so nobody else sees it.");
  });

  it("lists a token already here whose player is elsewhere, first; and not once they're here", () => {
    const items = [token("torin", "solo", { character: "sheetT", label: "Torin Vale" }), token("nessa", "party", { character: "sheetN", label: "Nessa" })];
    const list = sendables(state({}, items), "solo");
    expect(list.map((o) => [o.token.id, o.here])).toEqual([["torin", true], ["nessa", false]]);
    expect(sendables(state({ bram: "solo" }, items), "solo").map((o) => o.token.id)).toEqual(["nessa"]);
    // From the Cave, bringing them back: Torin is on a map Bram's on, so he's listed for Town.
    expect(sendables(state({ bram: "solo" }, items), "party").map((o) => o.token.id)).toEqual(["torin"]);
  });

  it("lists a character with no token where anyone is, whose player is elsewhere, to be put down here", () => {
    const items = [token("nessa", "party", { character: "sheetN", label: "Nessa" }), token("gorran-old", "old", { character: "sheetG", label: "Gorran" })];
    // Torin has no token at all, and Gorran only one on an old map: both can be put down on the solo map.
    const list = unplaced(state({}, items), "solo");
    expect(list.map((o) => o.character.name)).toEqual(["Gorran", "Torin Vale"]);
    expect(list[1].people).toEqual([{ userId: "bram", name: "Bram" }]);
    // Not on the party's map, where Bram is (Tokens & images places them there), nor once Bram's on the solo map.
    expect(unplaced(state({}, items), "party")).toEqual([]);
    expect(unplaced(state({ bram: "solo" }, items), "solo")).toEqual([]);
    // From there, the party's map lists them, to bring Bram back.
    expect(unplaced(state({ bram: "solo" }, items), "party").map((o) => o.character.name)).toEqual(["Gorran", "Torin Vale"]);
    // A token on a map someone's on counts, hidden ones not; a character nobody plays isn't listed.
    const more = { ...state({}, [...items, token("torin", "party", { character: "sheetT", label: "Torin Vale", hidden: true })]) };
    more.party = { ...more.party, characters: [...characters, { id: "sheetH", name: "Hireling", players: [] } as unknown as Character] };
    expect(unplaced(more, "solo").map((o) => o.character.name)).toEqual(["Gorran", "Torin Vale"]);
    expect(unplaced(state({}, [...items, token("gorran", "party", { character: "sheetG", label: "Gorran" })]), "solo").map((o) => o.character.name)).toEqual(["Torin Vale"]);
    // A token on this map, or on one someone was sent to, counts too: Send here lists those as they are, once.
    const here = [...items, token("torin", "solo", { character: "sheetT", label: "Torin Vale" })];
    expect(unplaced(state({}, here), "solo").map((o) => o.character.name)).toEqual(["Gorran"]);
    expect(sendables(state({}, here), "solo").map((o) => o.token.id)).toContain("torin");
    expect(unplaced(state({ bram: "solo" }, here), "party").map((o) => o.character.name)).toEqual(["Gorran"]);
  });

  it("tells the GM who went where and who sees it", () => {
    expect(listNames(["Bram"])).toBe("Bram");
    expect(listNames(["Bram", "Cora", "Ula"])).toBe("Bram, Cora and Ula");
    expect(sentGone([token("torin", "solo", { label: "Torin Vale" })], "“Cave”", ["Bram"])).toBe("Torin Vale to “Cave”: Bram sees it now.");
    expect(sentGone([], "“Town”", ["Bram", "Ula"])).toBe("Bram and Ula see “Town” now.");
    // A character put down (no token where anyone was), by their token's name.
    expect(sentGone([{ label: "Torin" }], "“Cave”", ["Bram"])).toBe("Torin to “Cave”: Bram sees it now.");
  });

  it("has Send here on the party bar, a click to place them, and the Scenes panel and top bar saying who sees what", () => {
    const bar = read("src/client/ui/PartyBar.tsx");
    for (const words of [
      "Send here",
      "Send them here",
      "Click where they arrive.",
      '"companion" in o && o.companion ? "travels with the party" : "nobody plays them"',
      "room.store.set({ partyTake: { sceneId: view.id, tokens: moving, users, characters }, lightAdd: null });",
      "room.sendToScene(view.id, users);",
      "the rest from one map at a time",
      "No token where anyone is: theirs is put down here",
      "const open = useRoomState((s) => !!s.viewSceneId && s.sendPick === s.viewSceneId);",
    ]) {
      expect(bar).toContain(words);
    }
    const board = read("src/client/room/board.ts");
    expect(board).toContain("sendTokens(this.room, going.from, scene, going.party, users, place)");
    expect(board).toContain("const put = putDownCharacters(this.room, take.characters ?? [], place, scene.grid.size);");
    const scenes = read("src/client/ui/ScenesPanel.tsx");
    expect(scenes).toContain("onClick={() => room.activateScene(s.id, true)}");
    expect(scenes).toContain('{split ? "The party sees this" : "Players see this"}');
    // Send someone here, on each scene someone could be sent to: it opens that scene with the list open.
    for (const words of ['aria-label="Send someone here"', "sendables(s, id).length > 0 || unplaced(s, id).length > 0", "room.store.set({ sendPick: id });", "{sendable.has(s.id) && ("]) {
      expect(scenes).toContain(words);
    }
    expect(read("src/client/room/client.ts")).toContain('this.submit({ t: "scene.send", id, users });');
  });

  it("is in the guide: how to send someone off on their own, bring them back, and that nobody else is told", () => {
    const part = GUIDE.flatMap((s) => s.parts).find((p) => p.title === "Split the party: send some to another map");
    expect(part).toBeTruthy();
    const text = [...part!.steps, ...part!.notes].join("\n");
    for (const words of ["**Send someone here**", "**Send here**", "**Send them here**", "put down where you click", "**Show to players**", "nobody else is told", "Only you, the GM, see where everyone is", "A player with two characters", "They see one map at a time", "marked **Travel with the party**", "it goes only where you send it"]) expect(text).toContain(words);
  });
});

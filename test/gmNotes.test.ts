// Labels only the GM sees, from Dungeon ("Only the GM sees this"): Dungeon leaves them out of the
// picture and sends them in its map data, marked gmOnly; Table makes each one a note only the GM
// sees (a hidden text drawing), linked to its label by Dungeon's id for it on the scene's link to
// Dungeon. What matters most here is that a player's page never receives one: not the note, not
// its words, not the link. (Update from Dungeon keeping them in step: updateFromDungeon.test.ts.)
import { afterEach, describe, expect, it, vi } from "vitest";
import { gmNotesOf, parseUniversalVttLevels } from "../src/client/mapImport";
import { noteLook, syncDungeonNotes } from "../src/client/importScenes";
import { DEFAULT_GRID, GM_OWNER, LIMITS, sanitizeScene } from "../src/shared/sanitize";
import { visibleToPlayer } from "../src/shared/permissions";
import { playerScene } from "../src/worker/playerView";
import { GUIDE } from "../src/client/guide";
import type { DrawingItem, Item, Scene } from "../src/shared/types";

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

const SECRET = "An assassin waits in the cupboard";
const label = (id: string, text: string, more: Record<string, unknown> = {}) => ({ id, x: 10, y: 6, text, size: 0.5, color: "#FFD0D0", font: "serif", rot: 0, ...more });

/** A Dungeon export of one level with these labels, as Dungeon's Universal VTT file has it. */
function vttText(texts: unknown[], origin = { x: 0, y: 0 }) {
  return JSON.stringify({
    format: 0.3,
    resolution: { map_origin: origin, map_size: { x: 20, y: 12 }, pixels_per_grid: 50 },
    line_of_sight: [],
    portals: [],
    lights: [],
    environment: { baked_lighting: false, ambient_light: "ffffffff" },
    image: btoa("png"),
    dungeon: { format: "dungeon-map", version: 2, payloadVersion: 2, width: 20, height: 12, texts },
  });
}

describe("reading a map from Dungeon", () => {
  it("takes only the labels only the GM sees, with their place, size, words and colour", () => {
    const [map] = parseUniversalVttLevels(vttText([label("hall00000001", "Great Hall"), label("assassin0001", ` ${SECRET} `, { gmOnly: true })]), "Old Keep.dd2vtt");
    expect(map.gmNotes).toEqual([{ id: "assassin0001", x: 10, y: 6, size: 0.5, text: SECRET, color: "#ffd0d0" }]);
  });

  it("skips what isn't one: not marked true, no id, no words, no place; each label once, and no more than a scene keeps", () => {
    const notes = gmNotesOf({
      texts: [
        label("aaaa00000001", "Marked yes", { gmOnly: "yes" }),
        label("../x", "Bad id", { gmOnly: true }),
        label("bbbb00000001", "   ", { gmOnly: true }),
        label("cccc00000001", "No place", { gmOnly: true, x: "far" }),
        label("dddd00000001", "Twice", { gmOnly: true }),
        label("dddd00000001", "Twice again", { gmOnly: true }),
        label("eeee00000001", "Odd colour", { gmOnly: true, color: "red", size: -1 }),
        null,
        "a label",
      ],
    });
    expect(notes).toEqual([
      { id: "dddd00000001", x: 10, y: 6, size: 0.5, text: "Twice", color: "#ffd0d0" },
      { id: "eeee00000001", x: 10, y: 6, size: 0.6, text: "Odd colour", color: "#ffffff" },
    ]);
    const many = Array.from({ length: LIMITS.dungeonNotes + 5 }, (_, i) => label(`n${i}`, `Note ${i}`, { gmOnly: true }));
    expect(gmNotesOf({ texts: many })).toHaveLength(LIMITS.dungeonNotes);
    expect(gmNotesOf({ texts: [label("long00000001", "x".repeat(900), { gmOnly: true })] })[0].text).toHaveLength(LIMITS.noteText);
  });

  it("measures from the picture's corner, gives each level its own, and has none for a file not from Dungeon", () => {
    expect(gmNotesOf({ texts: [label("assassin0001", SECRET, { gmOnly: true })] }, 2, 1)[0]).toMatchObject({ x: 8, y: 5 });
    const one = JSON.parse(vttText([label("assassin0001", SECRET, { gmOnly: true })]));
    const two = JSON.parse(vttText([label("ghost0000001", "A ghost wakes at midnight", { gmOnly: true })]));
    two.dungeon.levelName = "Cellar";
    one.dungeon.levelName = "Ground floor";
    const levels = parseUniversalVttLevels(JSON.stringify({ ...one, dungeon_levels: [two] }), "Old Keep.dd2vtt");
    expect(levels.map((l) => l.gmNotes?.map((n) => n.text))).toEqual([[SECRET], ["A ghost wakes at midnight"]]);
    // Another program's Universal VTT file: no Dungeon data, so nothing.
    const plain = JSON.parse(vttText([]));
    delete plain.dungeon;
    expect(parseUniversalVttLevels(JSON.stringify(plain), "Other.dd2vtt")[0]).not.toHaveProperty("gmNotes");
    // A map from a Dungeon before labels only the GM sees: its labels are all in the picture.
    expect(parseUniversalVttLevels(vttText([label("hall00000001", "Great Hall")]), "Old.dd2vtt")[0].gmNotes).toEqual([]);
  });
});

describe("a note for a label", () => {
  const n = { id: "assassin0001", x: 10, y: 6, size: 0.5, text: SECRET, color: "#ffd0d0" };

  it("is centred where the label is, its letters as tall, in the scene's units", () => {
    // 64 scene units a square: letters 32 tall; 100 units wide as measured.
    expect(noteLook(n, 64, () => 100)).toEqual({ points: [640 - 50, 384 - 19.2], text: SECRET, color: "#ffd0d0", width: 32 });
    // Two lines (a note can have more than one): half of both above the centre.
    expect(noteLook({ ...n, text: "One\nTwo" }, 64, () => 40).points).toEqual([620, 384 - 38.4]);
    // Never smaller or bigger than a note can be.
    expect(noteLook({ ...n, size: 0.001 }, 64, () => 0).width).toBe(0.5);
    expect(noteLook({ ...n, size: 50 }, 64, () => 0).width).toBe(LIMITS.strokeMax);
  });

  it("is new and hidden, owned by the GM, z after the scene's drawings", () => {
    const { ops, links } = syncDungeonNotes("scene0000001", [n], [], {}, 64, { owner: GM_OWNER, z: 7, newId: () => "note00000001", measure: () => 100 });
    expect(ops).toEqual({ upsert: [{ id: "note00000001", sceneId: "scene0000001", kind: "drawing", z: 7, owner: GM_OWNER, shape: "text", fill: false, hidden: true, points: [590, 364.8], text: SECRET, color: "#ffd0d0", width: 32 }] });
    expect(links).toEqual([{ id: "assassin0001", item: "note00000001" }]);
  });

  it("is only ever its own label's: a link to a note on another scene, or to something that isn't a note, isn't touched", () => {
    const other: DrawingItem = { id: "note00000001", sceneId: "other0000001", kind: "drawing", z: 0, owner: GM_OWNER, shape: "text", points: [0, 0], color: "#ffffff", width: 9, fill: false, text: "Elsewhere" };
    const items: Record<string, Item> = { [other.id]: other };
    const { ops, links } = syncDungeonNotes("scene0000001", [n], [{ id: "assassin0001", item: other.id }, { id: "gone00000001", item: other.id }], items, 64, { owner: GM_OWNER, z: 0 });
    expect(ops).toEqual({});
    expect(links).toEqual([{ id: "assassin0001", item: other.id }]);
  });
});

describe("a scene's link to its notes", () => {
  const scene: Scene = {
    id: "scene0000001",
    name: "Old Keep: Ground floor",
    order: 0,
    mapAssetId: "keepasset001",
    width: 1000,
    height: 600,
    background: "#1b1e24",
    grid: { ...DEFAULT_GRID, size: 50 },
    fogCover: false,
    createdAt: 1,
    dungeon: { map: "keepkeepkeep", batch: "batchbatchbb", level: "Ground floor", index: 0, levels: ["Ground floor"], asset: "keepasset001", notes: [{ id: "assassin0001", item: "note00000001" }] },
  };

  it("is kept when it's well made, each label and note once, and dropped when it isn't", () => {
    expect(sanitizeScene(scene)?.dungeon?.notes).toEqual([{ id: "assassin0001", item: "note00000001" }]);
    const messy = [
      { id: "assassin0001", item: "note00000001" },
      { id: "assassin0001", item: "note00000002" },
      { id: "ghost0000001", item: "note00000001" },
      { id: "../x", item: "note00000003" },
      { id: "trap00000001", item: "!" },
      "assassin0001",
      { id: "trap00000001", item: "note00000004" },
    ];
    const kept = sanitizeScene({ ...scene, dungeon: { ...scene.dungeon!, notes: messy } })?.dungeon;
    expect(kept?.notes).toEqual([
      { id: "assassin0001", item: "note00000001" },
      { id: "trap00000001", item: "note00000004" },
    ]);
    // None (or not a list): the link has no notes, and is still a link.
    const none = sanitizeScene({ ...scene, dungeon: { ...scene.dungeon!, notes: "all" } })?.dungeon;
    expect(none).toBeDefined();
    expect(none).not.toHaveProperty("notes");
  });

  it("isn't sent to players", () => {
    expect(JSON.stringify(playerScene(scene))).not.toContain("assassin0001");
  });
});

// ---------------------------------------------------------------- the Room

interface RoomInside {
  create(id: string, name: string): unknown;
  items: Map<string, Item>;
  hello(conn: unknown): { items: Item[]; scenes: Scene[] };
  webSocketMessage(ws: unknown, message: string): Promise<void>;
}

function sqlStore(DatabaseSync: new (p: string) => { prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] } }) {
  const db = new DatabaseSync(":memory:");
  return {
    exec(q: string, ...b: unknown[]) {
      const rows = db.prepare(q).all(...b);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
}

const conn = (role: string, more: Record<string, unknown> = {}) => ({ connId: `c-${role}${more.display ? "d" : ""}`, userId: role === "gm" ? GM_OWNER : "player000000001", name: role, color: "#888888", role, sid: `s-${role}`, v: 9, ...more });

function socket(c: ReturnType<typeof conn>) {
  const sent: Record<string, unknown>[] = [];
  return { sent, send: (m: string) => void sent.push(JSON.parse(m)), deserializeAttachment: () => c, serializeAttachment: () => undefined, close: () => undefined };
}

async function aRoom() {
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  const { DatabaseSync } = (await import(/* @vite-ignore */ "node:" + "sqlite")) as { DatabaseSync: new (p: string) => { prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] } } };
  const { Room } = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: new (c: unknown, e: unknown) => RoomInside };
  const gm = socket(conn("gm"));
  const player = socket(conn("player"));
  const display = socket(conn("player", { display: true }));
  const sql = sqlStore(DatabaseSync);
  const ctx = {
    storage: { sql, transactionSync: (f: () => unknown) => f(), deleteAll: async () => undefined },
    blockConcurrencyWhile: (f: () => unknown) => f(),
    getWebSockets: () => [gm, player, display],
    setWebSocketAutoResponse: () => undefined,
  };
  const room = new Room(ctx, { FILES: {}, DIRECTORY: { getByName: () => ({ touchRoom: () => undefined, gmDice: () => null, characterDice: () => null }) } });
  room.create("AbCdEf123456", "Room");
  const send = (ws: ReturnType<typeof socket>, msg: unknown) => room.webSocketMessage(ws, JSON.stringify(msg));
  return { room, gm, player, display, send };
}

describe("the Room", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("never sends a player or a table display a note made from a label only the GM sees, nor the link to it, as it's made or changed", async () => {
    const { room, gm, player, display, send } = await aRoom();
    const scene: Scene = {
      id: "scene0000001",
      name: "Old Keep",
      order: 0,
      mapAssetId: "keepasset001",
      width: 1000,
      height: 600,
      background: "#1b1e24",
      grid: { ...DEFAULT_GRID, size: 50 },
      fogCover: false,
      createdAt: 1,
    };
    // What bringing the map in does (importScenes.ts): the scene with its link, then its notes.
    const { ops, links } = syncDungeonNotes(scene.id, [{ id: "assassin0001", x: 10, y: 6, size: 0.5, text: SECRET, color: "#ffd0d0" }], [], {}, 50, { owner: GM_OWNER, z: 0 });
    const dungeon = { map: "keepkeepkeep", batch: "batchbatchbb", level: "", index: 0, levels: [""], asset: "keepasset001", notes: links };
    await send(gm, { t: "scene.upsert", create: true, scene: { ...scene, dungeon } });
    await send(gm, { t: "scene.activate", id: scene.id, all: true });
    await send(gm, { t: "items", ...ops });
    const note = ops.upsert![0] as DrawingItem;
    expect(room.items.get(note.id)).toMatchObject({ hidden: true, text: SECRET });
    // An update from Dungeon changing it.
    const moved = syncDungeonNotes(scene.id, [{ id: "assassin0001", x: 12, y: 7, size: 0.5, text: "The assassin has moved to the larder", color: "#ffd0d0" }], links, { [note.id]: room.items.get(note.id)! }, 50, { owner: GM_OWNER, z: 1 });
    expect(moved.ops.patch).toHaveLength(1);
    await send(gm, { t: "items", ...moved.ops });
    expect(room.items.get(note.id)).toMatchObject({ hidden: true, text: "The assassin has moved to the larder" });

    // The GM's pages have it all; a player's and a display's nothing of it, though they're on the scene.
    expect(JSON.stringify(room.hello(conn("gm")))).toContain("assassin0001");
    expect(room.hello(conn("gm")).items.map((i) => i.id)).toContain(note.id);
    for (const [who, ws] of [[conn("player"), player], [conn("player", { display: true }), display]] as const) {
      const hello = room.hello(who);
      expect(hello.scenes.map((s) => s.id)).toEqual([scene.id]);
      expect(hello.items.map((i) => i.id)).not.toContain(note.id);
      for (const text of [JSON.stringify(hello), JSON.stringify(ws.sent)]) {
        expect(text).not.toContain("assassin");
        expect(text).not.toContain("larder");
        expect(text).not.toContain(note.id);
      }
      // They were told of the scene, just not of the note.
      expect(JSON.stringify(ws.sent)).toContain(scene.id);
    }
    expect(visibleToPlayer(room.items.get(note.id)!, scene.id)).toBe(false);
  });
});

describe("the guide", () => {
  const part = (section: string, title: string) => GUIDE.find((s) => s.id === section)!.parts.find((p) => p.title === title)!;
  const text = (p: { steps: string[]; notes: string[] }) => [...p.steps, ...p.notes].join("\n");

  it("says what's new, on top", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[1].title).toBe("Secret notes from Dungeon (15 November 2026)");
    const entry = text(news.parts[1]);
    expect(entry).toContain('tick "Only the GM sees this" on a label');
    expect(entry).toContain("players never receive it");
    expect(entry).toContain("with no copies");
    expect(news.intro).toContain("The latest updates came out on 15 November 2026.");
  });

  it("says where a label only the GM sees in Dungeon ends up, under Maps from Dungeon and secret notes", () => {
    const maps = text(part("adding-maps", "Maps from Dungeon"));
    expect(maps).toContain('Labels ticked "Only the GM sees this" in Dungeon aren\'t in the picture');
    expect(maps).toContain("a note you've deleted here stays deleted");
    expect(maps).toContain("Notes of your own are never touched");
    expect(text(part("gm-only-notes", "Add a secret note"))).toContain("A map from Dungeon brings its own");
  });
});

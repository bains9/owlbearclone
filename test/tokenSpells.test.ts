// Spells on tokens and conjured things (the Spells tool, 31 October 2026), and the doc's last
// looks: the spell lists, how the Room keeps a spell on a token, that tabs too old to draw a
// look aren't sent it, how each look is drawn, that deleting a token takes its spells, and the
// guide.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { RoomClient } from "../src/client/room/client";
import { AFTER_IMAGE_MS, blinkFade, drawTokenLook, flyLift, tokenLookLayer } from "../src/client/room/tokenfx";
import { drawZone, seedOf, zoneOf } from "../src/client/room/zonefx";
import { prop } from "../src/client/dungeonLib/props";
import { spellChipLabel } from "../src/client/ui/spellChips";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeItem } from "../src/shared/sanitize";
import { CONJURED_SPELLS, FX_COLOR, SPELL_FX, TOKEN_SPELLS, ZONE_SPELLS, fxVersion, tokenSpell, zoneSpell } from "../src/shared/spellfx";
import type { DrawingItem, Item, Player, Scene, TokenItem } from "../src/shared/types";
import { TOKEN_LOOKS, isTokenLook, isZoneLook, lookVersion, spellLookMoves, type TokenLook } from "../src/shared/zones";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const goblin: TokenItem = {
  id: "gob",
  sceneId: "scene1",
  kind: "token",
  z: 1,
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
};

const onGoblin = (over: Record<string, unknown> = {}) => ({
  id: "spell0000001",
  sceneId: "scene1",
  kind: "drawing",
  z: 1,
  shape: "ellipse",
  points: [105, 105, 175, 175],
  color: "#c77dff",
  width: 2,
  fill: false,
  fx: "outline",
  spell: "Faerie Fire",
  on: "gob",
  ...over,
});

describe("the spells", () => {
  it("name each spell once across every list, each with a look the board draws", () => {
    const names = [...SPELL_FX, ...ZONE_SPELLS, ...CONJURED_SPELLS, ...TOKEN_SPELLS].map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of TOKEN_SPELLS) {
      expect(isTokenLook(s.look), s.name).toBe(true);
      expect(FX_COLOR.test(s.color), s.name).toBe(true);
    }
    for (const s of CONJURED_SPELLS) expect(isZoneLook(s.look), s.name).toBe(true);
  });

  it("cover every look the approval doc gave the party", () => {
    const used = new Set(TOKEN_SPELLS.map((s) => s.look));
    for (const look of Object.keys(TOKEN_LOOKS)) expect(used.has(look as TokenLook), look).toBe(true);
    for (const name of ["Faerie Fire", "Camouflage", "Meld into Stone", "Mage Armor", "Sanctuary", "Barkskin", "Plant Armour", "Heat Metal", "Ice Blade", "Hold Person", "Hold animal", "Slow", "Fly", "Levitate", "Treeform", "Summon Insects", "Spectral animal"]) {
      expect(tokenSpell(name), name).toBeDefined();
    }
    for (const name of ["Spiritual Weapon", "Moonbridge", "Plant Door"]) expect(zoneSpell(name), name).toBeDefined();
  });

  it("colour a shell by what it's made of, and a blade by fire or ice", () => {
    expect(tokenSpell("Mage Armor")!.color).toBe(tokenSpell("Shield")!.color);
    expect(tokenSpell("Sanctuary")!.color).not.toBe(tokenSpell("Mage Armor")!.color);
    expect(tokenSpell("Ice Blade")!.color).not.toBe(tokenSpell("Flame Blade")!.color);
  });

  it("lay a bridge across the map, narrower than it's long", () => {
    expect(zoneSpell("Moonbridge")).toMatchObject({ look: "bridge", shape: "square", size: 9, width: 1.5 });
  });

  it("say which keep moving", () => {
    expect(spellLookMoves("outline")).toBe(true);
    expect(spellLookMoves("shell")).toBe(false);
    expect(spellLookMoves("spirit-weapon")).toBe(true);
    expect(spellLookMoves("bridge")).toBe(false);
  });
});

describe("a spell on a token, as the Room keeps it", () => {
  it("keeps its look, spell and token on a circle", () => {
    const item = sanitizeItem(onGoblin(), "user1") as DrawingItem;
    expect(item).toMatchObject({ fx: "outline", spell: "Faerie Fire", on: "gob" });
  });

  it("drops the look without a token, with a bad one, or on another shape, and keeps the drawing", () => {
    for (const over of [{ on: undefined }, { on: "not an id!" }, { shape: "rect" }]) {
      const item = sanitizeItem(onGoblin(over), "user1") as DrawingItem;
      expect(item.kind, JSON.stringify(over)).toBe("drawing");
      expect(item.fx, JSON.stringify(over)).toBeUndefined();
      expect(item.on, JSON.stringify(over)).toBeUndefined();
    }
  });

  it("never puts a zone on a token", () => {
    const item = sanitizeItem(onGoblin({ fx: "fog", spell: "Fog Cloud" }), "user1") as DrawingItem;
    expect(item.fx).toBe("fog");
    expect(item.on).toBeUndefined();
  });

  it("needs code from 31 October (7) for it, and for the conjured things", () => {
    expect(lookVersion("outline")).toBe(7);
    expect(lookVersion("spirit-weapon")).toBe(7);
    expect(lookVersion("bridge")).toBe(7);
    expect(lookVersion("fog")).toBe(1);
  });
});

// The Room without the Workers runtime: a bare object with its fields set, and fake sockets.
interface Conn extends Player {
  sid: string;
  v?: number;
}
interface Sock {
  conn: Conn;
  sent: { t: string; message?: string; upsert?: Item[]; refused?: string[] }[];
  send(data: string): void;
  deserializeAttachment(): Conn;
  serializeAttachment(c: Conn): void;
}
interface RoomInside {
  items: Map<string, Item>;
  itemBytes: Map<string, number>;
  countBytes(owner: string, bytes: number): void;
  handleItems(ws: Sock, conn: Conn, msg: { t: "items"; upsert?: unknown[] }, seq: number | undefined): void;
  handleEph(ws: Sock, conn: Conn, e: unknown): void;
  handle(ws: Sock, conn: Conn, msg: unknown, seq: number | undefined): Promise<void>;
  hello(conn: Conn): { items: Item[] };
  initiative: { entries: { id: string; name: string; value: number; color: string; tokenId: string | null }[]; turn: number; round: number };
}
let RoomClass: { prototype: object };
beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  RoomClass = mod.Room;
});

function scene(id: string): Scene {
  return { id, name: id, order: 0, mapAssetId: null, width: 1400, height: 1000, background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 0 };
}

function sock(conn: Conn): Sock {
  const s: Sock = {
    conn,
    sent: [],
    send(data) {
      s.sent.push(JSON.parse(data));
    },
    deserializeAttachment: () => s.conn,
    serializeAttachment(c) {
      s.conn = c;
    },
  };
  return s;
}

function serverRoom(items: Item[], socks: Sock[]): RoomInside {
  const r = Object.create(RoomClass.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => socks },
    env: {},
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS, playersCanDraw: true } },
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

const player = (v: number, id: string): Conn => ({ connId: `${id}c`, userId: id, name: id, color: "#00ff00", role: "player", sid: `${id}sid`, v });

describe("the last looks (protocol 8)", () => {
  it("need code from after spells on tokens", () => {
    for (const look of ["fire-ring", "acid", "web", "grease", "force-dome", "mirror", "blur", "blink", "haste"] as const) expect(lookVersion(look), look).toBe(8);
    expect(lookVersion("spectral")).toBe(7);
    for (const look of ["fire-burst", "flame-fan", "cold-burst", "falling-stones", "thunderclap", "holy-flash", "lightning", "fire-bolt", "ice-shard", "acid-arrow"] as const) {
      expect(fxVersion(look), look).toBe(8);
    }
    expect(fxVersion("orb")).toBe(1);
  });

  it("aren't played on a tab whose code doesn't know them; the first looks still are", () => {
    const caster = sock(player(8, "alice"));
    const old = sock(player(7, "olda"));
    const now = sock(player(8, "nowa"));
    const r = serverRoom([], [caster, old, now]);
    const fx = (look: string) => ({ k: "fx", sceneId: "scene1", look, a: [10, 10], b: [200, 100], r: 70, seed: 3 });
    r.handleEph(caster, caster.conn, fx("fire-burst"));
    r.handleEph(caster, caster.conn, fx("orb"));
    const looks = (s: Sock) => s.sent.filter((m) => m.t === "eph").map((m) => (m as unknown as { e: { look: string } }).e.look);
    expect(looks(now)).toEqual(["fire-burst", "orb"]);
    expect(looks(old)).toEqual(["orb"]);
  });

  it("blink a token out for a moment each time round, and back", () => {
    const seen = Array.from({ length: 180 }, (_, i) => blinkFade(i * 10, 7));
    expect(Math.min(...seen)).toBeLessThan(0.2);
    expect(seen.filter((v) => v === 1).length).toBeGreaterThan(seen.length * 0.7);
    expect(seen.every((v) => v >= 0.1 && v <= 1)).toBe(true);
  });

  it("put copies and after-images under the token, the rest over it", () => {
    for (const look of ["mirror", "blur", "haste"] as const) expect(tokenLookLayer(look), look).toBe("ground");
    expect(tokenLookLayer("blink")).toBe("air");
  });
});

describe("spells that last so many rounds", () => {
  const gmConn: Conn = { connId: "gmc", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm", sid: "gmsid", v: 8 };
  const spellOf = (id: string, rounds: number | undefined, over: Record<string, unknown> = {}): DrawingItem => ({
    ...(sanitizeItem(onGoblin({ id, fx: "fog", spell: "Fog Cloud", on: undefined, ...(rounds ? { rounds } : {}), ...over }), "alice") as DrawingItem),
    owner: "alice",
  });
  const fighting = (r: RoomInside, turn: number, round: number) => {
    r.initiative = {
      entries: [
        { id: "ini1", name: "Goblin", value: 15, color: "#d62f2f", tokenId: null },
        { id: "ini2", name: "Testa", value: 9, color: "#4f9dde", tokenId: null },
      ],
      turn,
      round,
    };
  };

  it("are kept with how many rounds are left, and only a whole number of them", () => {
    expect(spellOf("fog000000001", 9).rounds).toBe(9);
    expect(spellOf("fog000000001", undefined, { rounds: 1.5 }).rounds).toBeUndefined();
    expect(spellOf("fog000000001", undefined, { rounds: 0 }).rounds).toBeUndefined();
  });

  it("count down as initiative goes round, and end when none are left; the rest are left alone", async () => {
    const gm = sock(gmConn);
    const watcher = sock(player(8, "nowa"));
    const r = serverRoom([spellOf("long00000001", 2), spellOf("short0000001", 1), spellOf("forever00001", undefined)], [gm, watcher]);
    fighting(r, 1, 1);
    await r.handle(gm, gm.conn, { t: "initiative.op", op: { op: "step", dir: 1 } }, 1);
    expect(r.initiative.round).toBe(2);
    expect((r.items.get("long00000001") as DrawingItem).rounds).toBe(1);
    expect(r.items.has("short0000001")).toBe(false);
    expect((r.items.get("forever00001") as DrawingItem).rounds).toBeUndefined();
    const sent = watcher.sent.find((m) => m.t === "items") as { upsert?: Item[]; delete?: string[] } | undefined;
    expect(sent?.upsert?.map((i) => i.id)).toEqual(["long00000001"]);
    expect(sent?.delete).toEqual(["short0000001"]);
  });

  it("don't count a turn within a round, give a round back on a step back, and aren't ended by clearing", async () => {
    const gm = sock(gmConn);
    const r = serverRoom([spellOf("long00000001", 2)], [gm]);
    fighting(r, 0, 3);
    await r.handle(gm, gm.conn, { t: "initiative.op", op: { op: "step", dir: 1 } }, 1);
    expect((r.items.get("long00000001") as DrawingItem).rounds).toBe(2);
    await r.handle(gm, gm.conn, { t: "initiative.op", op: { op: "step", dir: 1 } }, 2);
    expect((r.items.get("long00000001") as DrawingItem).rounds).toBe(1);
    await r.handle(gm, gm.conn, { t: "initiative.op", op: { op: "step", dir: -1 } }, 3);
    expect((r.items.get("long00000001") as DrawingItem).rounds).toBe(2);
    await r.handle(gm, gm.conn, { t: "initiative.op", op: { op: "clear" } }, 4);
    expect((r.items.get("long00000001") as DrawingItem).rounds).toBe(2);
  });

  it("aren't shown to players when hidden, even as they end", async () => {
    const gm = sock(gmConn);
    const watcher = sock(player(8, "nowa"));
    const r = serverRoom([spellOf("secret000001", 1, { hidden: true })], [gm, watcher]);
    fighting(r, 1, 1);
    await r.handle(gm, gm.conn, { t: "initiative.op", op: { op: "step", dir: 1 } }, 1);
    expect(r.items.has("secret000001")).toBe(false);
    expect(watcher.sent.some((m) => m.t === "items")).toBe(false);
    expect((gm.sent.find((m) => m.t === "items") as { delete?: string[] } | undefined)?.delete).toEqual(["secret000001"]);
  });
});

describe("tabs too old to draw a spell on a token", () => {
  const faerie = { ...(sanitizeItem(onGoblin(), "alice") as DrawingItem), owner: "alice" };
  const fog = { ...(sanitizeItem(onGoblin({ id: "fog000000001", fx: "fog", spell: "Fog Cloud", on: undefined }), "alice") as DrawingItem), owner: "alice" };

  it("aren't sent one when they connect, but still get the first zones", () => {
    const r = serverRoom([goblin, faerie, fog], []);
    expect(r.hello(player(6, "olda")).items.map((i) => i.id)).toEqual(["gob", "fog000000001"]);
    expect(r.hello(player(7, "nowa")).items.map((i) => i.id)).toEqual(["gob", "spell0000001", "fog000000001"]);
  });

  it("aren't sent one that's cast, and are asked to reload", () => {
    const caster = sock(player(7, "alice"));
    const old = sock(player(6, "olda"));
    const now = sock(player(7, "nowa"));
    const r = serverRoom([goblin], [caster, old, now]);
    r.handleItems(caster, caster.conn, { t: "items", upsert: [onGoblin()] }, 1);
    expect(now.sent.find((m) => m.t === "items")?.upsert?.map((i) => i.id)).toEqual(["spell0000001"]);
    expect(old.sent.some((m) => m.t === "items")).toBe(false);
    expect(old.sent.find((m) => m.t === "error")?.message).toMatch(/Reload this page/);
  });
});

/** A canvas that draws nothing but notes what was asked of it. */
function fakeCanvas() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => {} };
  const c = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "createRadialGradient" || key === "createLinearGradient") return () => gradient;
        return () => {
          calls.push(key);
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { c, calls };
}

describe("drawing a spell on a token", () => {
  it("draws every look (a tree is the token itself), in its layer", () => {
    for (const look of Object.keys(TOKEN_LOOKS) as TokenLook[]) {
      const { c, calls } = fakeCanvas();
      const trail = [
        { x: 60, y: 140, t: 1000 },
        { x: 100, y: 140, t: 1300 },
      ];
      drawTokenLook(c, { look, x: 140, y: 140, r: 35, color: "#8fd8ff", seed: seedOf("abc"), trail, picture: null }, 1500, 1);
      const drawn = calls.filter((k) => k !== "save" && k !== "restore");
      if (look === "treeform") expect(drawn, look).toEqual([]);
      else expect(drawn.length, look).toBeGreaterThan(0);
    }
    expect(tokenLookLayer("flying")).toBe("ground");
    expect(tokenLookLayer("outline")).toBe("air");
  });

  it("leaves a spectral token's after-image behind only for a moment", () => {
    const { c, calls } = fakeCanvas();
    const picture = { img: {} as CanvasImageSource, w: 70, h: 70, flip: false };
    const trail = [{ x: 60, y: 140, t: 0 }];
    drawTokenLook(c, { look: "spectral", x: 140, y: 140, r: 35, color: "#9fe8ff", seed: 1, trail, picture }, AFTER_IMAGE_MS / 2, 1);
    expect(calls).toContain("drawImage");
    const later = fakeCanvas();
    drawTokenLook(later.c, { look: "spectral", x: 140, y: 140, r: 35, color: "#9fe8ff", seed: 1, trail, picture }, AFTER_IMAGE_MS + 1, 1);
    expect(later.calls).not.toContain("drawImage");
  });

  it("floats a flyer a little above its place, never below it", () => {
    for (let t = 0; t < 5000; t += 250) {
      const lift = flyLift(35, t, 7);
      expect(lift).toBeGreaterThan(35 * 0.2);
      expect(lift).toBeLessThan(35 * 0.4);
    }
  });

  it("draws a tree for Treeform from the map's own trees", () => {
    expect(prop("oak-tree-small-rounded")).toBeDefined();
  });

  it("draws the conjured things, a bridge either way", () => {
    for (const [look, points] of [
      ["spirit-weapon", [0, 0, 70, 70]],
      ["bridge", [0, 0, 630, 105]],
      ["bridge", [0, 0, 105, 630]],
      ["path", [0, 0, 630, 105]],
    ] as const) {
      const { c, calls } = fakeCanvas();
      drawZone(c, zoneOf(look, look === "spirit-weapon" ? "ellipse" : "rect", points, 5, "#ffffff"), 1000, 70, 1, false);
      expect(calls.filter((k) => k === "fill" || k === "stroke").length, look).toBeGreaterThan(2);
    }
  });
});

describe("the Spells bar's list", () => {
  it("says which token a spell is on, or that its token is gone", () => {
    const spell = sanitizeItem(onGoblin(), "user1") as DrawingItem;
    expect(spellChipLabel(spell, { gob: goblin })).toBe("Faerie Fire on Goblin");
    expect(spellChipLabel(spell, {})).toBe("Faerie Fire (its token is gone)");
    expect(spellChipLabel(spell, { gob: { ...goblin, label: "" } })).toBe("Faerie Fire");
    const zone = sanitizeItem(onGoblin({ fx: "fog", spell: "Fog Cloud", on: undefined }), "user1") as DrawingItem;
    expect(spellChipLabel(zone, {})).toBe("Fog Cloud");
  });
});

function page(me: Player) {
  const room = new RoomClient("AbCdEf123456", { uid: "uid", name: me.name, color: me.color });
  room.store.set({
    me,
    room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS, playersCanDraw: true } },
    scenes: { scene1: scene("scene1") },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
    items: {},
  });
  return room;
}

describe("deleting a token", () => {
  const gm: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };
  const alice: Player = { connId: "c2", userId: "alice", name: "Alice", color: "#00ff00", role: "player" };
  const spell = (id: string, owner: string, name: string): DrawingItem => ({ ...(sanitizeItem(onGoblin({ id, spell: name }), owner) as DrawingItem), owner });

  it("takes the spells on it, in one step that Undo brings back", () => {
    const room = page(gm);
    room.store.set({ items: { gob: goblin, s1: spell("s1", "alice", "Faerie Fire"), s2: spell("s2", GM_OWNER, "Hold Person") } });
    room.change({ delete: ["gob"] });
    expect(Object.keys(room.state.items)).toEqual([]);
    room.undo();
    expect(Object.keys(room.state.items).sort()).toEqual(["gob", "s1", "s2"]);
  });

  it("leaves the spells a player may not end", () => {
    const room = page(alice);
    const own: TokenItem = { ...goblin, owner: "alice" };
    room.store.set({ items: { gob: own, s1: spell("s1", "alice", "Fly"), s2: spell("s2", GM_OWNER, "Hold Person") } });
    room.change({ delete: ["gob"] });
    expect(Object.keys(room.state.items)).toEqual(["s2"]);
  });
});

describe("in the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const section = GUIDE.find((s) => s.id === "spells")!;

  it("is in What's new under every spell look, above the zones", () => {
    expect(news.parts[8].title).toBe("Every spell look: Fireball, Lightning Bolt, Web, Haste and more (31 October 2026)");
    expect(news.parts[9].title).toBe("Spells on tokens, and conjured things (31 October 2026)");
    expect(news.parts[10].title).toBe("Spells that stay: fog, darkness, light and more (31 October 2026)");
  });

  it("names every spell, and says how to put one on, conjure one and end one", () => {
    const text = JSON.stringify(section);
    for (const s of [...TOKEN_SPELLS, ...CONJURED_SPELLS]) expect(text, s.name).toContain(s.name);
    const titles = section.parts.map((p) => p.title);
    expect(titles).toContain("Put a spell on a token");
    expect(titles).toContain("Conjure a weapon, a bridge or a path");
    expect(JSON.stringify(section.parts.find((p) => p.title === "End a spell"))).toContain("click the token again");
  });

  it("names the controls as the pages show them", async () => {
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
    const toolbar = read("../src/client/ui/Toolbar.tsx");
    for (const group of ["On a token", "Things that appear"]) {
      expect(toolbar).toContain(`"${group}"`);
      expect(JSON.stringify(GUIDE)).toContain(`**${group}**`);
    }
    expect(read("../src/client/ui/SelectionBar.tsx")).toContain("<SpellsOn token={t} />");
  });
});

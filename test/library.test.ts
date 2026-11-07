// The GM's own monsters and NPCs, for every room (4 November 2026): token pictures filed under
// Monsters or NPCs, kept by the Directory with their pictures in R2, listed at the top of those
// tabs; filing a room's uploads copies them in (and they leave its Tokens), and placing one in a
// room copies its picture there once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { fileInLibrary, filterEntries, libraryDragData, placeFromLibrary, readLibraryDrag } from "../src/client/library";
import { RoomClient } from "../src/client/room/client";
import { MAX_FILE_AT_ONCE, MAX_LIBRARY_BYTES, isFiled, isShelf, libraryKey, type LibraryEntry } from "../src/shared/library";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Asset, Player, Scene, TokenItem } from "../src/shared/types";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("../src/worker/auth", () => ({ isGm: async (r: Request) => r.headers.get("X-Test-Gm") === "1" }));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));

const entry = (id: string, more: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id,
  shelf: "monster",
  name: "Goblin",
  mime: "image/png",
  width: 256,
  height: 256,
  bytes: 1000,
  createdAt: 1,
  ...more,
});
const asset = (id: string, more: Partial<Asset> = {}): Asset => ({ id, name: "Orc", kind: "token", width: 256, height: 256, mime: "image/png", bytes: 1000, owner: GM_OWNER, createdAt: 1, ...more });

describe("the library's rules", () => {
  it("files a room's picture while its entry is there, any copy before the list is read", () => {
    expect([isShelf("monster"), isShelf("npc"), isShelf("map"), isShelf(null)]).toEqual([true, true, false, false]);
    expect(libraryKey("AbCdEfGhIjKlMnOp")).toBe("library/AbCdEfGhIjKlMnOp");
    const copy = asset("asset0000000001", { library: "AbCdEfGhIjKlMnOp" });
    expect(isFiled(copy, [entry("AbCdEfGhIjKlMnOp")])).toBe(true);
    // Its entry taken out: back in Tokens.
    expect(isFiled(copy, [entry("ZzZzZzZzZzZzZzZz")])).toBe(false);
    expect(isFiled(copy, null)).toBe(true);
    expect(isFiled(asset("asset0000000002"), null)).toBe(false);
  });

  it("finds by the start of a word in the name, and drags carry Add hidden", () => {
    const list = [entry("a", { name: "Goblin archer" }), entry("b", { name: "Hobgoblin" }), entry("c", { name: "Orc chief" })];
    expect(filterEntries(list, "gob").map((e) => e.id)).toEqual(["a"]);
    expect(filterEntries(list, "arch gob").map((e) => e.id)).toEqual(["a"]);
    expect(filterEntries(list, "").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(readLibraryDrag(libraryDragData("AbCdEfGhIjKlMnOp", true))).toEqual({ id: "AbCdEfGhIjKlMnOp", hidden: true });
    expect(readLibraryDrag("not json")).toBeNull();
  });
});

// ---------------------------------------------------------------- the Directory

interface DirectoryInside {
  libraryList(): LibraryEntry[];
  libraryEntry(id: string): LibraryEntry | null;
  libraryRefusal(count: number, bytes: number): string | null;
  addLibraryEntries(entries: LibraryEntry[]): string | null;
  updateLibraryEntry(id: string, change: { name?: string; shelf?: "monster" | "npc" }): LibraryEntry | null;
  removeLibraryEntry(id: string): LibraryEntry | null;
  listRooms(): { id: string }[];
}

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

describe("the Directory's library", () => {
  it("keeps entries newest first, renames them, moves them between shelves and takes them out", async () => {
    const d = await directory();
    expect(d.libraryList()).toEqual([]);
    expect(d.addLibraryEntries([entry("AAAAAAAAAAAAAAAA", { createdAt: 1 }), entry("BBBBBBBBBBBBBBBB", { name: "Bandit", shelf: "npc", createdAt: 2 })])).toBeNull();
    expect(d.libraryList().map((e) => e.id)).toEqual(["BBBBBBBBBBBBBBBB", "AAAAAAAAAAAAAAAA"]);
    expect(d.libraryEntry("BBBBBBBBBBBBBBBB")).toEqual(entry("BBBBBBBBBBBBBBBB", { name: "Bandit", shelf: "npc", createdAt: 2 }));
    expect(d.updateLibraryEntry("AAAAAAAAAAAAAAAA", { name: "Goblin boss" })).toMatchObject({ name: "Goblin boss", shelf: "monster" });
    expect(d.updateLibraryEntry("AAAAAAAAAAAAAAAA", { shelf: "npc" })).toMatchObject({ name: "Goblin boss", shelf: "npc" });
    expect(d.updateLibraryEntry("CCCCCCCCCCCCCCCC", { name: "x" })).toBeNull();
    expect(d.removeLibraryEntry("AAAAAAAAAAAAAAAA")?.name).toBe("Goblin boss");
    expect(d.removeLibraryEntry("AAAAAAAAAAAAAAAA")).toBeNull();
    expect(d.libraryList().map((e) => e.id)).toEqual(["BBBBBBBBBBBBBBBB"]);
  });

  it("refuses what doesn't fit, all or nothing", async () => {
    const d = await directory();
    expect(d.libraryRefusal(1, MAX_LIBRARY_BYTES + 1)).toMatch(/as many as the library holds/);
    expect(d.addLibraryEntries([entry("AAAAAAAAAAAAAAAA"), entry("BBBBBBBBBBBBBBBB", { bytes: MAX_LIBRARY_BYTES })])).toMatch(/as many as the library holds/);
    expect(d.libraryList()).toEqual([]);
  });
});

// ---------------------------------------------------------------- the Room

interface RoomInside {
  assets: Map<string, Asset>;
  tokenAssets(ids: string[]): Asset[];
  libraryCopy(entryId: string): Asset | null;
  linkLibrary(links: { assetId: string; entryId: string }[]): void;
}

async function bareRoom(assets: Asset[], sent: unknown[] = []): Promise<RoomInside> {
  const { Room } = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  const r = Object.create(Room.prototype) as RoomInside;
  const gm = { connId: "g", userId: GM_OWNER, name: "GM", color: "#fff", role: "gm", sid: "s" };
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => [{ deserializeAttachment: () => gm, send: (d: string) => sent.push(JSON.parse(d)) }] },
    assets: new Map(assets.map((a) => [a.id, a])),
  });
  return r;
}

describe("a room's pictures and the library", () => {
  it("gives the GM its token pictures, finds its copy of an entry, and marks pictures filed", async () => {
    const sent: { t: string; asset?: Asset }[] = [];
    const r = await bareRoom(
      [
        asset("asset0000000001"),
        asset("map000000000001", { kind: "map" }),
        asset("copy00000000002", { library: "AAAAAAAAAAAAAAAA", createdAt: 5 }),
        asset("copy00000000001", { library: "AAAAAAAAAAAAAAAA", createdAt: 3 }),
      ],
      sent,
    );
    expect(r.tokenAssets(["asset0000000001", "map000000000001", "nope"]).map((a) => a.id)).toEqual(["asset0000000001"]);
    // Two pages made one at once: the older is the one.
    expect(r.libraryCopy("AAAAAAAAAAAAAAAA")?.id).toBe("copy00000000001");
    expect(r.libraryCopy("BBBBBBBBBBBBBBBB")).toBeNull();
    r.linkLibrary([{ assetId: "asset0000000001", entryId: "BBBBBBBBBBBBBBBB" }]);
    expect(r.assets.get("asset0000000001")?.library).toBe("BBBBBBBBBBBBBBBB");
    expect(sent.at(-1)).toMatchObject({ t: "asset.upsert", asset: { id: "asset0000000001", library: "BBBBBBBBBBBBBBBB" } });
  });
});

// ---------------------------------------------------------------- the Worker's routes

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0, 0, 0, 0]);

function bucket() {
  const files = new Map<string, { data: ArrayBuffer; type: string }>();
  return {
    files,
    async get(key: string) {
      const f = files.get(key);
      if (!f) return null;
      return {
        body: new Blob([f.data]).stream(),
        httpEtag: '"e"',
        arrayBuffer: async () => f.data,
        writeHttpMetadata: (h: Headers) => h.set("Content-Type", f.type),
      };
    },
    async put(key: string, value: ArrayBuffer, opts: { httpMetadata?: { contentType?: string } }) {
      files.set(key, { data: value, type: opts.httpMetadata?.contentType ?? "" });
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
}

function roomStub(assets: Asset[]) {
  const r = {
    assets: new Map(assets.map((a) => [a.id, a])),
    exists: async () => true,
    tokenAssets: async (ids: string[]) => ids.map((id) => r.assets.get(id)).filter((a): a is Asset => a?.kind === "token"),
    libraryCopy: async (id: string) => [...r.assets.values()].find((a) => a.library === id) ?? null,
    linkLibrary: async (links: { assetId: string; entryId: string }[]) => {
      for (const l of links) r.assets.set(l.assetId, { ...r.assets.get(l.assetId)!, library: l.entryId });
    },
    addAsset: vi.fn(async (a: Asset) => {
      r.assets.set(a.id, a);
    }),
  };
  return r;
}

describe("the library's routes", () => {
  async function setup() {
    const { libraryRoute } = (await import(/* @vite-ignore */ "../src/worker/" + "libraryRoutes")) as {
      libraryRoute(request: Request, env: unknown, pathname: string, method: string): Promise<Response | null>;
    };
    const files = bucket();
    const d = await directory();
    const room = roomStub([asset("asset0000000001", { name: "Owlbear" }), asset("asset0000000002", { name: "Bandit" })]);
    await files.put("rooms/AbCdEf123456/asset0000000001", PNG.buffer, { httpMetadata: { contentType: "image/png" } });
    await files.put("rooms/AbCdEf123456/asset0000000002", PNG.buffer, { httpMetadata: { contentType: "image/png" } });
    const env = { FILES: files, DIRECTORY: { getByName: () => d }, ROOMS: { getByName: () => room } };
    const go = async (method: string, path: string, body?: BodyInit, gm = true) => {
      const res = await libraryRoute(new Request(`https://t.test${path}`, { method, body, headers: gm ? { "X-Test-Gm": "1" } : {} }), env, new URL(`https://t.test${path}`).pathname, method);
      return res ? { status: res.status, data: (await res.json().catch(() => null)) as Record<string, unknown> } : null;
    };
    return { go, files, d, room };
  }

  it("is the GM's, and leaves other paths alone", async () => {
    const { go } = await setup();
    expect((await go("GET", "/api/library", undefined, false))?.status).toBe(401);
    expect(await go("GET", "/api/rooms")).toBeNull();
  });

  it("takes an upload straight into a shelf, and serves its picture to anyone", async () => {
    const { go, files } = await setup();
    const up = await go("POST", "/api/library?shelf=npc&name=Innkeeper&w=256&h=256", PNG);
    expect(up?.status).toBe(201);
    expect(up?.data).toMatchObject({ shelf: "npc", name: "Innkeeper", mime: "image/png", width: 256 });
    expect(files.files.has(`library/${String(up?.data.id)}`)).toBe(true);
    expect((await go("POST", "/api/library?shelf=dragon&w=1&h=1", PNG))?.status).toBe(400);
    expect((await go("POST", "/api/library?shelf=npc&w=1&h=1", new Uint8Array([1, 2, 3])))?.status).toBe(415);
    const pic = await go("GET", `/api/library/${String(up?.data.id)}/file`, undefined, false);
    expect(pic).not.toBeNull();
  });

  it("files a room's uploads (they leave its Tokens), then places one in a room once", async () => {
    const { go, d, room, files } = await setup();
    const filed = await go("POST", "/api/library/from-room", JSON.stringify({ room: "AbCdEf123456", assets: ["asset0000000001", "asset0000000002", "nope"], shelf: "monster" }));
    expect(filed?.data.filed).toBe(2);
    const list = d.libraryList();
    expect(list.map((e) => e.name).sort()).toEqual(["Bandit", "Owlbear"]);
    expect([...room.assets.values()].map((a) => a.library).sort()).toEqual(list.map((e) => e.id).sort());
    // Filed again: nothing new.
    expect((await go("POST", "/api/library/from-room", JSON.stringify({ room: "AbCdEf123456", assets: ["asset0000000001"], shelf: "npc" })))?.data.filed).toBe(0);
    // In this room the copy is its own picture already.
    const owlbear = list.find((e) => e.name === "Owlbear")!;
    expect((await go("POST", `/api/rooms/AbCdEf123456/library/${owlbear.id}`))?.data.id).toBe("asset0000000001");
    expect(room.addAsset).not.toHaveBeenCalled();
    // Taken out of the library, then a fresh room: it isn't there to place.
    expect((await go("DELETE", `/api/library/${owlbear.id}`))?.status).toBe(200);
    expect(files.files.has(`library/${owlbear.id}`)).toBe(false);
    expect((await go("POST", `/api/rooms/AbCdEf123456/library/${owlbear.id}`))?.data.id).toBe("asset0000000001");
    const bandit = list.find((e) => e.name === "Bandit")!;
    room.assets.clear();
    const placed = await go("POST", `/api/rooms/AbCdEf123456/library/${bandit.id}`);
    expect(placed?.status).toBe(201);
    expect(placed?.data).toMatchObject({ name: "Bandit", kind: "token", owner: GM_OWNER, library: bandit.id });
    expect(files.files.has(`rooms/AbCdEf123456/${String(placed?.data.id)}`)).toBe(true);
    expect((await go("POST", `/api/rooms/AbCdEf123456/library/${owlbear.id}`))?.status).toBe(404);
  });

  it("renames one, or moves it to the other shelf", async () => {
    const { go, d } = await setup();
    d.addLibraryEntries([entry("AAAAAAAAAAAAAAAA")]);
    expect((await go("PATCH", "/api/library/AAAAAAAAAAAAAAAA", JSON.stringify({ name: "Goblin chief" })))?.data).toMatchObject({ name: "Goblin chief", shelf: "monster" });
    expect((await go("PATCH", "/api/library/AAAAAAAAAAAAAAAA", JSON.stringify({ shelf: "npc" })))?.data).toMatchObject({ shelf: "npc" });
    expect((await go("PATCH", "/api/library/AAAAAAAAAAAAAAAA", JSON.stringify({ shelf: "dragon" })))?.status).toBe(400);
    expect((await go("PATCH", "/api/library/BBBBBBBBBBBBBBBB", JSON.stringify({ name: "x" })))?.status).toBe(404);
  });
});

// ---------------------------------------------------------------- the page

function scene(id: string): Scene {
  return { id, name: id, order: 0, mapAssetId: null, width: 1400, height: 1000, background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 0 };
}

describe("on the GM's page", () => {
  afterEach(() => vi.restoreAllMocks());
  const gmMe: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };

  function client(assets: Asset[] = [], items: TokenItem[] = []): RoomClient {
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid0000001", name: "GM", color: "#ff0000" });
    room.store.set({
      me: gmMe,
      room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
      scenes: { scene1: scene("scene1") },
      viewSceneId: "scene1",
      activeSceneId: "scene1",
      assets: Object.fromEntries(assets.map((a) => [a.id, a])),
      items: Object.fromEntries(items.map((t) => [t.id, t])),
      library: [entry("AAAAAAAAAAAAAAAA", { name: "Goblin" })],
    });
    return room;
  }

  it("places one: the room's copy (made the first time), named and numbered like a monster", async () => {
    const room = client();
    const copy = asset("copy00000000001", { name: "Goblin", library: "AAAAAAAAAAAAAAAA" });
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(copy, { status: 201 }));
    const added = vi.spyOn(room, "addToken");
    await placeFromLibrary(room, "AAAAAAAAAAAAAAAA", undefined, false);
    expect(sent.mock.calls[0][0]).toBe("/api/rooms/AbCdEf123456/library/AAAAAAAAAAAAAAAA");
    expect(room.state.assets.copy00000000001).toEqual(copy);
    expect(added.mock.calls[0][0]).toEqual({ assetId: "copy00000000001", label: "Goblin", hidden: false });
    // The second: no copying, and numbered.
    sent.mockClear();
    added.mockImplementation(() => null);
    room.store.set({ items: { t1: { id: "t1", sceneId: "scene1", kind: "token", label: "Goblin" } as TokenItem } });
    await placeFromLibrary(room, "AAAAAAAAAAAAAAAA", undefined, true);
    expect(sent).not.toHaveBeenCalled();
    expect(added.mock.calls.at(-1)?.[0]).toEqual({ assetId: "copy00000000001", label: "Goblin 2", hidden: true });
  });

  it("files a crapton of uploads a few at a time", async () => {
    const room = client();
    const ids = Array.from({ length: MAX_FILE_AT_ONCE * 2 + 3 }, (_, i) => `asset${String(i).padStart(10, "0")}`);
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { assets: string[] };
      return Response.json({ filed: body.assets.length, library: [] });
    });
    expect(await fileInLibrary(room, ids, "monster")).toBe(ids.length);
    expect(sent).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String((sent.mock.calls[0][1] as RequestInit).body))).toMatchObject({ room: "AbCdEf123456", shelf: "monster", assets: ids.slice(0, MAX_FILE_AT_ONCE) });
  });

  it("in Tokens & images: Select and Move, a move button on each, Upload into any tab, the shelves; and a drop on the map", async () => {
    const panel = await source("src/client/ui/LibraryPanel.tsx");
    expect(panel).toContain(".filter((a) => a.kind === tab && !(tab === \"token\" && isFiled(a, library)))");
    expect(panel).toContain('{picked ? "Done" : "Select"}');
    expect(panel).toContain('onClick={() => move([...picked], "monster")}');
    expect(panel).toContain('<option value="monster">Monsters (every room)</option>');
    expect(panel).toContain("if (shelf) void uploadToLibrary(room, files, shelf);");
    expect(panel).toContain('<LibraryShelf shelf="monster" />\n          <MonstersSection />');
    expect(panel).toContain('<LibraryShelf shelf="npc" />\n          <NpcsSection />');
    const board = await source("src/client/room/board.ts");
    expect(board).toContain("const own = readLibraryDrag(e.dataTransfer?.getData(LIBRARY_DRAG_TYPE));");
    expect(board).toContain("types.includes(LIBRARY_DRAG_TYPE) ||");
    const worker = await source("src/worker/index.ts");
    expect(worker).toContain("const library = await libraryRoute(request, env, pathname, method);");
  });
});

describe("the guide", () => {
  it("leads What's new with it, and the Monsters section explains it", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[5].title).toBe("GM: your own monsters and NPCs, in every room (4 November 2026)");
    const top = [...news.parts[5].steps, ...news.parts[5].notes].join("\n");
    for (const words of ["**Select**", "**Move to Monsters**", "**Move to NPCs**", "every room", "**Upload**", "**Add hidden**"]) expect(top).toContain(words);
    const monsters = GUIDE.find((s) => s.id === "monsters")!;
    const titles = monsters.parts.map((p) => p.title);
    expect(titles.at(-2)).toBe("Your own monsters and NPCs, in every room");
    expect(titles.at(-1)).toBe("Where the pictures come from");
  });
});

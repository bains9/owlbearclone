// The GM's campaign notes (4 November 2026): their Obsidian vaults (Vern keeps several) brought into
// Table from a folder (any system: Vern's is Ubuntu), each kept apart by its folder's name for every
// room by the Directory (pictures in R2 by checksum), read only by the GM, rendered as Obsidian's
// reading view; a note or part of one shown to the players as a handout; a token linked to a note,
// the GM's alone.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { noteTree, vaultsIn } from "../src/client/vault";
import { headingId, notePrepare, renderNote, vaultResolver } from "../src/client/vaultRender";
import { DEFAULT_SETTINGS, GM_OWNER } from "../src/shared/sanitize";
import type { Player } from "../src/shared/types";
import { VAULT_LIMITS, isVaultName, isVaultPath, noteRef, noteTitle, parseNoteRef, vaultKind, type Handout, type VaultIndex } from "../src/shared/vault";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("../src/worker/auth", () => ({ isGm: async (r: Request) => r.headers.get("X-Test-Gm") === "1" }));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));
const HASH = "b".repeat(64);

describe("a vault's files", () => {
  it("brings in notes and pictures, never Obsidian's own folders, nor a way out of the vault", () => {
    expect(["Factions/Red Tide.md", "Attachments/Hilda.PNG", ".obsidian/app.json", "Notes/.trash/old.md", "Maps/city.pdf"].map(vaultKind)).toEqual(["note", "picture", null, null, null]);
    expect([isVaultPath("Factions/Red Tide.md"), isVaultPath("../secrets.md"), isVaultPath("/etc/x.md"), isVaultPath("a\\b.md"), isVaultPath("a//b.md")]).toEqual([true, false, false, false, false]);
    expect([isVaultName("Eastport"), isVaultName("K'dir Khan"), isVaultName("a/b"), isVaultName("a|b"), isVaultName(".hidden"), isVaultName(" x")]).toEqual([true, true, false, false, false, false]);
    expect(noteTitle("Temples & Religions/Temple of Alessa.md")).toBe("Temple of Alessa");
    expect(parseNoteRef(noteRef("Eastport", "NPCs/Hilda.md"))).toEqual({ vault: "Eastport", path: "NPCs/Hilda.md" });
    expect([parseNoteRef("Eastport|../x.md"), parseNoteRef("NPCs/Hilda.md"), parseNoteRef(7)]).toEqual([null, null, null]);
  });

  it("finds the vaults in a picked folder: the folder itself when it's one, else each folder in it", () => {
    const one = vaultsIn([
      { name: "a", webkitRelativePath: "Eastport/.obsidian/app.json" },
      { name: "b", webkitRelativePath: "Eastport/Factions/Red Tide.md" },
    ]);
    expect([...one.keys()]).toEqual(["Eastport"]);
    expect(one.get("Eastport")!.map((e) => e.path)).toEqual([".obsidian/app.json", "Factions/Red Tide.md"]);
    // The folder holding Vern's vaults: each one separately; a stray file at the top is left out.
    const many = vaultsIn([
      { name: "a", webkitRelativePath: "Obsidian/Eastport/.obsidian/app.json" },
      { name: "b", webkitRelativePath: "Obsidian/Eastport/Red Tide.md" },
      { name: "c", webkitRelativePath: "Obsidian/K'dir Khan/Places/Topside.md" },
      { name: "d", webkitRelativePath: "Obsidian/readme.txt" },
    ]);
    expect([...many.keys()]).toEqual(["Eastport", "K'dir Khan"]);
    expect(many.get("K'dir Khan")!.map((e) => e.path)).toEqual(["Places/Topside.md"]);
    // Notes at its top make a folder a vault, even without Obsidian's folder.
    expect([...vaultsIn([{ name: "x", webkitRelativePath: "Notes/Hilda.md" }, { name: "y", webkitRelativePath: "Notes/NPCs/Bob.md" }]).keys()]).toEqual(["Notes"]);
  });

  it("lists as Obsidian does: folders first, then notes, each in order", () => {
    const tree = noteTree([
      { vault: "E", path: "Zed.md", title: "Zed", size: 1 },
      { vault: "E", path: "Factions/Red Tide.md", title: "Red Tide", size: 1 },
      { vault: "E", path: "Factions/Maus Cell.md", title: "Maus Cell", size: 1 },
      { vault: "E", path: "Alpha.md", title: "Alpha", size: 1 },
    ]);
    expect(tree.folders.map((f) => f.name)).toEqual(["Factions"]);
    expect(tree.folders[0].notes.map((n) => n.title)).toEqual(["Maus Cell", "Red Tide"]);
    expect(tree.notes.map((n) => n.title)).toEqual(["Alpha", "Zed"]);
  });
});

const index: Pick<VaultIndex, "notes" | "files"> = {
  notes: [
    { vault: "E", path: "Temples/Temple of Alessa.md", title: "Temple of Alessa", size: 1 },
    { vault: "E", path: "NPCs/Hilda Bauer.md", title: "Hilda Bauer", size: 1 },
    { vault: "E", path: "Old/Hilda Bauer.md", title: "Hilda Bauer", size: 1 },
  ],
  files: [{ vault: "E", path: "Attachments/hilda.png", hash: HASH, mime: "image/png", bytes: 10 }],
};

describe("a note, as Obsidian's reading view shows it", () => {
  it("finds links by path or name, the nearest when there are several", () => {
    const find = vaultResolver(index);
    expect(find.note("NPCs/Hilda Bauer", "x.md")).toBe("NPCs/Hilda Bauer.md");
    expect(find.note("hilda bauer", "Old/y.md")).toBe("Old/Hilda Bauer.md");
    expect(find.note("Nobody", "x.md")).toBeNull();
    expect(find.file("hilda.png", "Temples/x.md")?.hash).toBe(HASH);
  });

  it("takes properties out to a table, and comments out altogether", () => {
    const { text, props } = notePrepare("---\nrace: Human\ntags:\n  - npc\n  - cleric\n---\nVisible %% the GM's secret %% words\n%%\nblock\n%%");
    expect(props).toEqual([
      ["race", "Human"],
      ["tags", "npc, cleric"],
    ]);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("block");
  });

  it("renders links between notes, pictures, highlights, headings and callouts, a secret one marked", () => {
    const html = renderNote(
      "# Hilda\nSee [[Temple of Alessa|the temple]] and [[Nobody]].\n![[hilda.png|200]]\n==Miss Berries==\n> [!secret] The truth\n> She's the traitor.\n\n> [!note]\n> Plain.",
      "NPCs/Hilda Bauer.md",
      index,
    );
    expect(html).toContain(`<h1 id="h-hilda">Hilda</h1>`);
    expect(html).toContain(`<a class="wikilink" data-note="Temples/Temple of Alessa.md">the temple</a>`);
    expect(html).toContain(`<span class="wikilink unresolved">Nobody</span>`);
    expect(html).toContain(`<img src="/api/vault/file/${HASH}" alt="hilda" width="200">`);
    expect(html).toContain("<mark>Miss Berries</mark>");
    expect(html).toContain(`<blockquote class="callout callout-secret" data-callout="secret" data-secret=""><p class="callout-title">The truth</p>`);
    expect(html).toContain(`<blockquote class="callout callout-note" data-callout="note"><p class="callout-title">Note</p>`);
    expect(headingId("The Red Tide's Ships!")).toBe("h-the-red-tide-s-ships");
  });

  it("follows Markdown links to notes too, and leaves the web's links as they are", () => {
    const html = renderNote("[temple](../Temples/Temple%20of%20Alessa.md) and [site](https://example.com)", "NPCs/Hilda Bauer.md", index);
    expect(html).toContain(`<a class="wikilink" data-note="Temples/Temple of Alessa.md">temple</a>`);
    expect(html).toContain(`<a href="https://example.com">site</a>`);
  });
});

// ---------------------------------------------------------------- the Directory

interface Dir {
  vaultStart(v: string): string | null;
  vaultPutNotes(v: string, id: string, notes: { path: string; body: string }[]): string | null;
  vaultKnownHashes(hashes: string[]): string[];
  vaultPutFiles(v: string, id: string, files: { path: string; hash: string; mime: string; bytes: number }[]): string | null;
  vaultFinish(v: string, id: string): { notes: number; files: number; unused: string[] } | null;
  vaultIndex(): VaultIndex;
  vaultNote(v: string, path: string): string | null;
  vaultSearch(q: string, v: string | null): { vault: string; path: string; title: string; snippet: string }[];
  vaultClear(v: string | null): string[];
}

interface Db {
  prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] };
  exec(q: string): void;
}

/** A Directory over a real SQLite database in memory; `before` gets the database first (an older layout, say). */
async function directory(before?: (db: Db) => void): Promise<Dir> {
  const { DatabaseSync } = (await import(/* @vite-ignore */ "node:" + "sqlite")) as { DatabaseSync: new (path: string) => Db };
  const db = new DatabaseSync(":memory:");
  if (before) {
    db.exec("CREATE TABLE IF NOT EXISTS blobs (name TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL)");
    before(db);
  }
  const sql = {
    exec(q: string, ...b: unknown[]) {
      const rows = db.prepare(q).all(...b);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
  const { Directory } = (await import(/* @vite-ignore */ "../src/worker/" + "directory")) as { Directory: new (ctx: unknown, env: unknown) => Dir };
  return new Directory({ storage: { sql }, blockConcurrencyWhile: (f: () => unknown) => f() }, {});
}

const pic = (path: string, hash: string) => ({ path, hash, mime: "image/png", bytes: 10 });

describe("the Directory's vaults", () => {
  it("brings a vault in, then again: what left it goes, pictures no vault uses any more are named for removal", async () => {
    const d = await directory();
    const first = d.vaultStart("E")!;
    expect(d.vaultPutNotes("E", first, [{ path: "A.md", body: "Hilda the cleric" }, { path: "Old.md", body: "gone soon" }])).toBeNull();
    expect(d.vaultPutFiles("E", first, [pic("a.png", "1".repeat(64)), pic("b.png", "2".repeat(64))])).toBeNull();
    expect(d.vaultFinish("E", first)).toEqual({ notes: 2, files: 2, unused: [] });
    expect(d.vaultIndex().vaults).toEqual([{ name: "E", importedAt: expect.any(Number), notes: 2 }]);
    const second = d.vaultStart("E")!;
    expect(d.vaultKnownHashes(["1".repeat(64), "3".repeat(64)])).toEqual(["1".repeat(64)]);
    d.vaultPutNotes("E", second, [{ path: "A.md", body: "Hilda, now a traitor" }]);
    d.vaultPutFiles("E", second, [pic("a.png", "1".repeat(64))]);
    expect(d.vaultFinish("E", second)).toEqual({ notes: 1, files: 1, unused: ["2".repeat(64)] });
    expect(d.vaultNote("E", "A.md")).toBe("Hilda, now a traitor");
    expect(d.vaultNote("E", "Old.md")).toBeNull();
  });

  it("keeps several vaults apart: bringing one in leaves the others, the same path in each its own", async () => {
    const d = await directory();
    for (const [v, body] of [
      ["Eastport", "the docks"],
      ["K'dir Khan", "the desert"],
    ] as const) {
      const id = d.vaultStart(v)!;
      d.vaultPutNotes(v, id, [{ path: "Home.md", body }]);
      d.vaultPutFiles(v, id, [pic("shared.png", "4".repeat(64))]);
      d.vaultFinish(v, id);
    }
    expect(d.vaultIndex().vaults.map((v) => v.name)).toEqual(["Eastport", "K'dir Khan"]);
    expect([d.vaultNote("Eastport", "Home.md"), d.vaultNote("K'dir Khan", "Home.md")]).toEqual(["the docks", "the desert"]);
    // Eastport again with only a new note: K'dir Khan stays as it was.
    const again = d.vaultStart("Eastport")!;
    d.vaultPutNotes("Eastport", again, [{ path: "New.md", body: "x" }]);
    d.vaultFinish("Eastport", again);
    expect(d.vaultNote("K'dir Khan", "Home.md")).toBe("the desert");
    expect(d.vaultSearch("desert", null).map((h) => h.vault)).toEqual(["K'dir Khan"]);
    expect(d.vaultSearch("desert", "Eastport")).toEqual([]);
    // The picture's copy goes with the last vault using it.
    expect(d.vaultClear("K'dir Khan")).toEqual(["4".repeat(64)]);
    expect(d.vaultIndex().vaults.map((v) => v.name)).toEqual(["Eastport"]);
  });

  it("refuses a batch from an import another has overtaken, and SQL's wildcards are only words", async () => {
    const d = await directory();
    const old = d.vaultStart("E")!;
    const now = d.vaultStart("E")!;
    expect(d.vaultPutNotes("E", old, [{ path: "A.md", body: "x" }])).toMatch(/overtaken/);
    d.vaultPutNotes("E", now, [{ path: "Temples/Alessa.md", body: "The harvest priestess, Miss Berries, tends the shrine." }]);
    d.vaultFinish("E", now);
    expect(d.vaultSearch("miss berries", null)).toEqual([{ vault: "E", path: "Temples/Alessa.md", title: "Alessa", snippet: "The harvest priestess, Miss Berries, tends the shrine." }]);
    expect(d.vaultSearch("100%", null)).toEqual([]);
    d.vaultClear(null);
    expect(d.vaultIndex()).toEqual({ vaults: [], notes: [], files: [] });
  });

  it("moves the one vault brought in before there were several to First vault, which gives way to the real one", async () => {
    const d = await directory((db) => {
      db.exec("CREATE TABLE vault_notes (path TEXT PRIMARY KEY, body TEXT NOT NULL, import TEXT NOT NULL)");
      db.exec("CREATE TABLE vault_files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, import TEXT NOT NULL)");
      db.exec("CREATE TABLE vault_drive (path TEXT PRIMARY KEY, modified INTEGER NOT NULL, hash TEXT NOT NULL)");
      db.prepare("INSERT INTO vault_notes VALUES (?, ?, ?)").all("NPCs/Hilda.md", "# Hilda", "old");
      db.prepare("INSERT INTO vault_notes VALUES (?, ?, ?)").all("Temple.md", "# Temple", "old");
      db.prepare("INSERT INTO vault_files VALUES (?, ?, ?, ?, ?)").all("h.png", "5".repeat(64), "image/png", 10, "old");
      db.prepare("INSERT INTO blobs VALUES (?, ?, ?)").all("vault_at", "1793838851508", 1);
    });
    expect(d.vaultIndex().vaults).toEqual([{ name: "First vault", importedAt: 1793838851508, notes: 2 }]);
    expect(d.vaultNote("First vault", "NPCs/Hilda.md")).toBe("# Hilda");
    // A vault that isn't it (no notes in common) leaves it.
    const other = d.vaultStart("K'dir Khan")!;
    d.vaultPutNotes("K'dir Khan", other, [{ path: "Topside.md", body: "x" }]);
    d.vaultFinish("K'dir Khan", other);
    expect(d.vaultIndex().vaults.map((v) => v.name)).toEqual(["First vault", "K'dir Khan"]);
    // His vault brought in again by its folder's name: First vault gives way; its picture's copy is still used.
    const real = d.vaultStart("Eastport")!;
    d.vaultPutNotes("Eastport", real, [{ path: "NPCs/Hilda.md", body: "# Hilda" }, { path: "Temple.md", body: "# Temple" }]);
    d.vaultPutFiles("Eastport", real, [pic("h.png", "5".repeat(64))]);
    expect(d.vaultFinish("Eastport", real)?.unused).toEqual([]);
    expect(d.vaultIndex().vaults.map((v) => v.name)).toEqual(["Eastport", "K'dir Khan"]);
  });
});

// ---------------------------------------------------------------- the Worker's routes

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4]);

async function hex(data: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data.slice().buffer as ArrayBuffer));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bucket() {
  const files = new Map<string, ArrayBuffer>();
  return {
    files,
    async get(key: string) {
      const f = files.get(key);
      return f ? { body: new Blob([f]).stream(), httpEtag: '"e"', writeHttpMetadata: (h: Headers) => h.set("Content-Type", "image/png") } : null;
    },
    async put(key: string, value: ArrayBuffer) {
      files.set(key, value);
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
}

describe("the vaults' routes", () => {
  async function setup() {
    const { vaultRoute } = (await import(/* @vite-ignore */ "../src/worker/" + "vaultRoutes")) as {
      vaultRoute(request: Request, env: unknown, url: URL, method: string): Promise<Response | null>;
    };
    const files = bucket();
    const d = await directory();
    const env = { FILES: files, DIRECTORY: { getByName: () => d } };
    const go = async (method: string, path: string, body?: BodyInit, gm = true, headers: Record<string, string> = {}) => {
      const url = new URL(`https://t.test${path}`);
      const res = await vaultRoute(new Request(url, { method, body, headers: { ...(gm ? { "X-Test-Gm": "1" } : {}), ...headers } }), env, url, method);
      return res ? { status: res.status, data: (await res.json().catch(() => null)) as Record<string, unknown> } : null;
    };
    return { go, files, d };
  }

  it("is the GM's, but for a picture; other paths are left alone", async () => {
    const { go } = await setup();
    expect((await go("GET", "/api/vault", undefined, false))?.status).toBe(401);
    expect((await go("GET", "/api/vault/note?vault=E&path=A.md", undefined, false))?.status).toBe(401);
    expect(await go("GET", "/api/rooms")).toBeNull();
    expect((await go("GET", `/api/vault/file/${HASH}`, undefined, false))?.status).toBe(404);
  });

  it("brings a vault in: notes, a picture checked against its checksum and kind, then finished", async () => {
    const { go, files } = await setup();
    expect((await go("POST", "/api/vault/import", JSON.stringify({ vault: "a/b" })))?.status).toBe(400);
    const id = String((await go("POST", "/api/vault/import", JSON.stringify({ vault: "Eastport" })))?.data.import);
    const v = { vault: "Eastport", import: id };
    expect((await go("POST", "/api/vault/import/notes", JSON.stringify({ ...v, notes: [{ path: "NPCs/Hilda.md", body: "# Hilda" }] })))?.status).toBe(200);
    expect((await go("POST", "/api/vault/import/notes", JSON.stringify({ ...v, notes: [{ path: "../x.md", body: "" }] })))?.status).toBe(400);
    const hash = await hex(PNG);
    expect((await go("POST", "/api/vault/import/files", JSON.stringify({ ...v, files: [{ path: "Att/hilda.png", hash, bytes: PNG.length }] })))?.data.missing).toEqual([hash]);
    const qs = `vault=Eastport&import=${id}&path=${encodeURIComponent("Att/hilda.png")}`;
    const wrong = new Uint8Array(PNG);
    wrong[30] = 0;
    expect((await go("PUT", `/api/vault/import/file/${hash}?${qs}`, wrong, true, { "Content-Length": String(wrong.length) }))?.status).toBe(400);
    const text = new TextEncoder().encode("<script>x</script>");
    expect((await go("PUT", `/api/vault/import/file/${await hex(text)}?${qs}`, text, true, { "Content-Length": String(text.length) }))?.status).toBe(415);
    expect((await go("PUT", `/api/vault/import/file/${hash}?${qs}`, PNG, true, { "Content-Length": String(PNG.length) }))?.status).toBe(200);
    expect(files.files.has(`vault/${hash}`)).toBe(true);
    expect((await go("POST", "/api/vault/import/finish", JSON.stringify(v)))?.data).toEqual({ notes: 1, files: 1 });
    const idx = (await go("GET", "/api/vault"))?.data as unknown as VaultIndex;
    expect(idx.vaults.map((x) => x.name)).toEqual(["Eastport"]);
    expect(idx.files).toEqual([{ vault: "Eastport", path: "Att/hilda.png", hash, mime: "image/png", bytes: PNG.length }]);
    expect((await go("GET", `/api/vault/note?vault=Eastport&path=${encodeURIComponent("NPCs/Hilda.md")}`))?.data).toEqual({ vault: "Eastport", path: "NPCs/Hilda.md", body: "# Hilda" });
    // One vault out of Table: its notes, and the pictures' copies no vault uses.
    expect((await go("DELETE", "/api/vault?vault=Eastport"))?.status).toBe(200);
    expect(files.files.has(`vault/${hash}`)).toBe(false);
  });
});

// ---------------------------------------------------------------- the Room

interface Conn extends Player {
  sid: string;
  v?: number;
}

interface Sock {
  conn: Conn;
  sent: { t: string; handouts?: Handout[]; shown?: string; notes?: Record<string, string> }[];
  send(data: string): void;
  deserializeAttachment(): Conn;
  serializeAttachment(c: Conn): void;
}

interface RoomInside {
  handouts: Handout[];
  tokenNotes: Record<string, string>;
  handle(ws: Sock, conn: Conn, msg: unknown, seq: number | undefined): Promise<void>;
}

let RoomMod: { Room: { prototype: object }; keepHandouts(list: Handout[]): Handout[] };

beforeAll(async () => {
  RoomMod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as typeof RoomMod;
});

function sock(conn: Conn): Sock {
  const s: Sock = {
    conn,
    sent: [],
    send(data) {
      s.sent.push(JSON.parse(data) as Sock["sent"][number]);
    },
    deserializeAttachment: () => s.conn,
    serializeAttachment(c) {
      s.conn = c;
    },
  };
  return s;
}

function room(socks: Sock[]): RoomInside {
  const r = Object.create(RoomMod.Room.prototype) as RoomInside;
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => socks },
    env: {},
    info: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    handouts: [],
    tokenNotes: {},
  });
  return r;
}

const gmConn = (): Conn => ({ connId: "gmc", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm", sid: "gmsid", v: 8 });
const playerConn = (): Conn => ({ connId: "alicec", userId: "alice1abcdef", name: "alice", color: "#00ff00", role: "player", sid: "alicesid", v: 8 });

describe("handouts and token links in a room", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a handout to everyone, newest first; only the GM shows or takes one back", async () => {
    const gm = sock(gmConn());
    const alice = sock(playerConn());
    const r = room([gm, alice]);
    await r.handle(alice, alice.conn, { t: "handout.show", title: "Letter", html: "<p>x</p>" }, 1);
    expect(r.handouts).toEqual([]);
    await r.handle(gm, gm.conn, { t: "handout.show", title: "Temple of Alessa", html: "<p>The shrine</p>" }, 1);
    await r.handle(gm, gm.conn, { t: "handout.show", title: "Map", html: "<p>Here</p>" }, 2);
    expect(r.handouts.map((h) => h.title)).toEqual(["Map", "Temple of Alessa"]);
    expect(alice.sent.filter((m) => m.t === "handouts").at(-1)!.shown).toBe(r.handouts[0].id);
    await r.handle(alice, alice.conn, { t: "handout.remove", id: r.handouts[0].id }, 2);
    expect(r.handouts).toHaveLength(2);
    await r.handle(gm, gm.conn, { t: "handout.remove", id: r.handouts[0].id }, 3);
    expect(r.handouts.map((h) => h.title)).toEqual(["Temple of Alessa"]);
  });

  it("keeps as many handouts as fit, the oldest going first", () => {
    const big = (id: string): Handout => ({ id, title: id, html: "x".repeat(VAULT_LIMITS.handoutBytes), at: 0 });
    const kept = RoomMod.keepHandouts(Array.from({ length: 20 }, (_, i) => big(`h${i}`)));
    expect(kept.length).toBe(Math.floor(VAULT_LIMITS.handoutsBytes / (VAULT_LIMITS.handoutBytes + 66)));
    expect(kept[0].id).toBe("h0");
  });

  it("links a token to a note in a vault, for the GM alone: players never hear of it", async () => {
    const gm = sock(gmConn());
    const alice = sock(playerConn());
    const r = room([gm, alice]);
    const ref = noteRef("Eastport", "NPCs/Hilda.md");
    await r.handle(alice, alice.conn, { t: "token.note", id: "tok000000001", note: ref }, 1);
    expect(r.tokenNotes).toEqual({});
    await r.handle(gm, gm.conn, { t: "token.note", id: "tok000000001", note: ref }, 1);
    expect(r.tokenNotes).toEqual({ tok000000001: ref });
    expect(gm.sent.filter((m) => m.t === "tokenNotes").at(-1)?.notes).toEqual({ tok000000001: ref });
    expect(alice.sent.some((m) => m.t === "tokenNotes")).toBe(false);
    // Not a note in a vault: refused. Unlinked with null.
    await r.handle(gm, gm.conn, { t: "token.note", id: "tok000000001", note: "NPCs/Hilda.md" }, 2);
    expect(r.tokenNotes.tok000000001).toBe(ref);
    await r.handle(gm, gm.conn, { t: "token.note", id: "tok000000001", note: null }, 3);
    expect(r.tokenNotes).toEqual({});
  });

  it("sends the token links only in the GM's hello", async () => {
    const roomTs = await source("src/worker/room.ts");
    expect(roomTs).toContain('...(conn.role === "gm" && !conn.display ? { tokenNotes: this.tokenNotes } : {}),');
    expect(roomTs).toContain('this.broadcast({ t: "tokenNotes", notes: next }, (c) => c.role === "gm" && !c.display);');
  });
});

describe("on the page, and in the guide", () => {
  it("Campaign notes for the GM, a vault menu, Handouts for players once there's one, a note button on a token", async () => {
    const page = await source("src/client/ui/RoomPage.tsx");
    expect(page).toContain('{ id: "notes", label: "Campaign notes", icon: BookOpen, gm: true },');
    expect(page).toContain("(!p.handouts || gm || hasHandouts)");
    const panel = await source("src/client/ui/NotesPanel.tsx");
    expect(panel).toContain('whole.querySelectorAll("[data-secret], .note-props").forEach((n) => n.remove());');
    expect(panel).toContain("const out = safeHtml(picked ?? whole.innerHTML, { players: true });");
    expect(panel).toContain('folder.current?.setAttribute("webkitdirectory", "");');
    expect(panel).toContain('<select value={showing} onChange={(e) => setShown(e.currentTarget.value)} aria-label="Which vault to show">');
    // A note's links stay in its own vault.
    expect(panel).toContain("props.open(noteRef(vault, note), heading ?? undefined);");
    expect(await source("src/client/ui/HandoutsPanel.tsx")).toContain("const html = useMemo(() => safeHtml(h.html, { players: true }), [h.html]);");
    expect(await source("src/client/ui/SelectionBar.tsx")).toContain("<TokenNoteButton id={t.id} />");
  });

  it("leads What's new, with a section of its own, several vaults and all", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[0].title).toBe("GM: your Obsidian notes in Table, and handouts for the players (4 November 2026)");
    const top = [...news.parts[0].steps, ...news.parts[0].notes].join("\n");
    for (const words of ["**Choose your vault's folder**", "the folder holding all your vaults", "Ubuntu", "**Show to players**", "**%% comments %%**", "**Link to**", "**Update**", "**Vault** menu"]) {
      expect(top).toContain(words);
    }
    const section = GUIDE.find((s) => s.id === "campaign-notes")!;
    expect(section.audience).toBe("gm");
    expect(section.parts.map((p) => p.title)).toEqual(["Bring in your vaults", "Find and read a note", "Show the players a handout", "Link a token to a note", "Keep it in step with Google Drive"]);
  });
});

// Backups in the GM's Google Drive (6 November 2026), and nowhere on Cloudflare: the real job, Room,
// Directory and routes, talking to the real scripts/table-backup.gs on a stand-in for Drive. What
// matters is that what goes in comes back: deleted rooms, lost notes, a Table that's lost everything.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { PART_BYTES, backupId, fromBase64, nightFromName, partFiles, partNames, toBase64, type BackupManifest, type BackupStatus, type TablePart } from "../src/shared/backups";

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
vi.mock("../src/worker/auth", () => ({ isGm: async (r: Request) => r.headers.get("X-Test-Gm") !== "no" }));

const nodeCrypto = (await import("node:" + "crypto")) as { createHash(a: string): { update(b: Uint8Array): { digest(e: string): string } } };
const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const { DatabaseSync } = (await import(/* @vite-ignore */ "node:" + "sqlite")) as {
  DatabaseSync: new (path: string) => { prepare(q: string): { all(...b: unknown[]): Record<string, unknown>[] }; close(): void };
};
const { Buffer } = (await import("node:" + "buffer")) as unknown as { Buffer: { from(a: Uint8Array | string, e?: string): Uint8Array & { toString(e: string): string } } };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));
const md5 = (b: Uint8Array) => nodeCrypto.createHash("md5").update(b).digest("hex");
const SCRIPT = "https://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec";

// ---------------------------------------------------------------- stand-ins

/** Cloudflare's SQL, on Node's SQLite. */
function sqlStore() {
  let db = new DatabaseSync(":memory:");
  const sql = {
    exec(q: string, ...b: unknown[]) {
      const rows = db.prepare(q).all(...b);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
  return { sql, wipe: () => (db = new DatabaseSync(":memory:")) };
}

function object(ctor: new (ctx: unknown, env: unknown) => unknown, env: unknown) {
  const store = sqlStore();
  const state = { alarmAt: null as number | null };
  const ctx = {
    storage: {
      sql: store.sql,
      transactionSync: (f: () => unknown) => f(),
      deleteAll: async () => void store.wipe(),
      setAlarm: async (t: number) => void (state.alarmAt = t),
      getAlarm: async () => state.alarmAt,
    },
    blockConcurrencyWhile: (f: () => unknown) => f(),
    getWebSockets: () => [],
    setWebSocketAutoResponse: () => undefined,
  };
  return { instance: new ctor(ctx, env), state };
}

/** R2, with the same etags (an MD5), metadata, ranges and paging. */
function bucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string; type?: string; meta?: Record<string, string> }>();
  const view = (key: string, o: { bytes: Uint8Array; etag: string; type?: string; meta?: Record<string, string> }) => ({
    key,
    etag: o.etag,
    size: o.bytes.length,
    httpMetadata: o.type ? { contentType: o.type } : {},
    customMetadata: o.meta ?? {},
  });
  return {
    objects,
    async put(key: string, value: Uint8Array | ArrayBuffer | string, opts: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; md5?: string } = {}) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer).slice();
      const etag = md5(bytes);
      if (opts.md5 && opts.md5 !== etag) throw new Error("The MD5 doesn't match.");
      objects.set(key, { bytes, etag, type: opts.httpMetadata?.contentType, meta: opts.customMetadata });
    },
    async get(key: string, opts: { range?: { offset: number; length: number } } = {}) {
      const o = objects.get(key);
      if (!o) return null;
      const bytes = opts.range ? o.bytes.subarray(opts.range.offset, opts.range.offset + opts.range.length) : o.bytes;
      return { ...view(key, o), arrayBuffer: async () => bytes.slice().buffer };
    },
    async head(key: string) {
      const o = objects.get(key);
      return o ? view(key, o) : null;
    },
    async list(opts: { limit?: number; startAfter?: string; prefix?: string; cursor?: string } = {}) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(opts.prefix ?? "") && (!opts.startAfter || k > opts.startAfter)).sort();
      const page = keys.slice(0, opts.limit ?? 1000);
      return { objects: page.map((k) => view(k, objects.get(k)!)), truncated: page.length < keys.length };
    },
    async delete(keys: string | string[]) {
      for (const k of [keys].flat()) objects.delete(k);
    },
  };
}

/** Google Drive and Apps Script, as scripts/table-backup.gs sees them. */
async function googleDrive() {
  const code = await source("scripts/table-backup.gs");
  const props = new Map<string, string>([["FOLDER_ID", "backups"]]);
  const folders = new Map<string, Map<string, { bytes: Uint8Array; mime: string }>>();
  const state = { refuse: null as null | ((name: string) => boolean), garble: null as string | null, calls: 0 };
  const iterator = <T,>(list: T[]) => {
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  };
  const fileOf = (name: string, f: { bytes: Uint8Array; mime: string }) => ({ getName: () => name, getSize: () => f.bytes.length, getBlob: () => ({ getBytes: () => f.bytes }) });
  const folder = (name: string) => ({
    getFiles: () => iterator([...(folders.get(name) ?? new Map<string, { bytes: Uint8Array; mime: string }>())].map(([n, f]) => fileOf(n, f))),
    getFilesByName: (n: string) => {
      const f = folders.get(name)?.get(n);
      return iterator(f ? [fileOf(n, f)] : []);
    },
    createFile(blob: { bytes: Uint8Array; mime: string; name: string }) {
      if (state.refuse?.(blob.name)) throw new Error("Service invoked too many times for one day: driveapp.");
      folders.get(name)!.set(blob.name, { bytes: blob.bytes, mime: blob.mime });
    },
  });
  const root = {
    getFoldersByName: (n: string) => iterator(folders.has(n) ? [folder(n)] : []),
    createFolder(n: string) {
      folders.set(n, new Map());
      return folder(n);
    },
  };
  const globals = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
    DriveApp: { getFolderById: () => root },
    ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => t }), MimeType: { JSON: "json" } },
    Utilities: {
      DigestAlgorithm: { MD5: "md5" },
      base64Decode: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
      base64Encode: (b: Uint8Array) => Buffer.from(b).toString("base64"),
      newBlob: (bytes: Uint8Array, mime: string, name: string) => ({ bytes, mime, name }),
      computeDigest: (_a: string, b: Uint8Array) => [...nodeCrypto.createHash("md5").update(b).digest("hex").matchAll(/../g)].map((m) => {
        const v = parseInt(m[0], 16);
        return v > 127 ? v - 256 : v;
      }),
    },
  };
  const run = new Function(...Object.keys(globals), `${code}; return { doPost };`)(...Object.values(globals)) as { doPost(e: unknown): string };
  const fetchStub = async (_url: string, init: RequestInit) => {
    state.calls++;
    const contents = String(init.body);
    if (state.garble && contents.includes(`"name":"${state.garble}"`)) {
      const p = JSON.parse(contents) as { data: string };
      p.data = toBase64(new Uint8Array([0]));
      return new Response(run.doPost({ postData: { contents: JSON.stringify(p) } }));
    }
    return new Response(run.doPost({ postData: { contents } }));
  };
  return { folders, props, state, fetchStub, ask: (p: Record<string, unknown>) => JSON.parse(run.doPost({ postData: { contents: JSON.stringify(p) } })) as Record<string, unknown> };
}

interface Inside {
  [k: string]: (...a: never[]) => unknown;
}

/** A whole Table: its objects, its buckets and its routes, all real but for the stand-ins above. */
async function table(drive: Awaited<ReturnType<typeof googleDrive>>) {
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  const load = (name: string) => import(/* @vite-ignore */ `../src/worker/${name}`) as Promise<Record<string, unknown>>;
  const { Room } = (await load("room")) as { Room: new (c: unknown, e: unknown) => Inside };
  const { Directory, NOT_BACKED_UP, PART_TABLES } = (await load("directory")) as {
    Directory: new (c: unknown, e: unknown) => Inside;
    NOT_BACKED_UP: ReadonlySet<string>;
    PART_TABLES: Record<TablePart, { tables: string[] }>;
  };
  const { BackupJob } = (await load("backupJob")) as { BackupJob: new (c: unknown, e: unknown) => Inside };
  const { backupRoute } = (await load("backupRoutes")) as { backupRoute(r: Request, e: unknown, u: URL, m: string): Promise<Response | null> };
  const { unpack } = (await load("snapshot")) as { unpack(g: Uint8Array): Promise<{ tables: Record<string, Record<string, unknown>[]> }> };

  const FILES = bucket();
  const DUNGEON_MAPS = bucket();
  const rooms = new Map<string, Inside>();
  const env: Record<string, unknown> = { FILES, DUNGEON_MAPS };
  env.ROOMS = {
    getByName(id: string) {
      if (!rooms.has(id)) rooms.set(id, object(Room as never, env).instance as Inside);
      return rooms.get(id);
    },
  };
  const directory = object(Directory as never, env).instance as Inside;
  env.DIRECTORY = { getByName: () => directory };
  const job = object(BackupJob as never, env);
  env.BACKUP_JOB = { getByName: () => job.instance };
  vi.stubGlobal("fetch", drive.fetchStub);

  const room = (id: string) => (env.ROOMS as { getByName(id: string): Inside }).getByName(id);
  /** Runs the job's alarms to the end, as Cloudflare would: how long it waited each time. */
  const drain = async () => {
    const waits: number[] = [];
    for (let i = 0; i < 2000 && job.state.alarmAt !== null; i++) {
      waits.push(job.state.alarmAt - Date.now());
      job.state.alarmAt = null;
      await (job.instance as unknown as { alarm(): Promise<void> }).alarm();
    }
    return waits;
  };
  const backUp = async (reason = "nightly", at = Date.now()) => {
    const begun = await (job.instance as unknown as { begin(r: string, n: number): Promise<{ started: boolean; why?: string }> }).begin(reason, at);
    const waits = await drain();
    return { begun, waits };
  };
  const status = () => (job.instance as unknown as { status(): Promise<BackupStatus> }).status();
  const call = async (method: string, path: string, body?: unknown, gm = true) => {
    const url = new URL(`https://table.test${path}`);
    const res = await backupRoute(
      new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: gm ? {} : { "X-Test-Gm": "no" } }),
      env,
      url,
      method,
    );
    return { status: res!.status, data: (await res!.json()) as Record<string, never> };
  };
  /** Every file back, the way the page asks for them. */
  const filesBack = async (id: string, what: Record<string, unknown>) => {
    let from = 0;
    let missing = 0;
    for (let i = 0; i < 500; i++) {
      const { data } = await call("POST", `/api/backups/night/${id}/files`, { ...what, from });
      missing += data.missing as number;
      if (data.done) return { total: data.total as number, missing };
      from = data.next as number;
    }
    throw new Error("Never finished.");
  };
  const night = (id: string) => JSON.parse(new TextDecoder().decode(drive.folders.get("nights")!.get(`${id}.json`)!.bytes)) as BackupManifest;
  const nights = () => [...(drive.folders.get("nights")?.keys() ?? [])].sort();
  return { env, FILES, DUNGEON_MAPS, directory, job, room, rooms, drain, backUp, status, call, filesBack, night, nights, unpack, NOT_BACKED_UP, PART_TABLES };
}

type Table = Awaited<ReturnType<typeof table>>;

/** A table with a room, its pictures, notes, a calendar, a monster and a Dungeon map. */
async function played(t: Table) {
  const dir = t.directory as unknown as {
    setBackupDriveSource(s: string): void;
    addRoom(id: string, name: string, at: number): void;
    setCalendar(j: string): number;
    vaultStart(v: string): string;
    vaultPutNotes(v: string, i: string, n: { path: string; body: string }[]): unknown;
    vaultFinish(v: string, i: string): unknown;
    addLibraryEntries(e: unknown[]): string | null;
  };
  dir.setBackupDriveSource(SCRIPT);
  const roomId = "RoomAAAAAAAA";
  const info = t.room(roomId).create(roomId as never, "Curse of Strahd" as never) as { createdAt: number };
  dir.addRoom(roomId, "Curse of Strahd", info.createdAt);
  (t.room(roomId) as unknown as { addAsset(a: unknown, role: string): void }).addAsset(
    { id: "assetmap00001", name: "Barovia", kind: "map", width: 100, height: 100, mime: "image/png", bytes: 5, owner: "gm", createdAt: 1 },
    "gm",
  );
  await t.FILES.put(`rooms/${roomId}/assetmap00001`, new Uint8Array([1, 2, 3, 4, 5]), { httpMetadata: { contentType: "image/png" } });
  dir.setCalendar(JSON.stringify({ name: "Barovian" }));
  const v = dir.vaultStart("Eastport");
  dir.vaultPutNotes("Eastport", v, [{ path: "NPCs/Hilda.md", body: "# Hilda\nShe informs for the Red Tide." }]);
  dir.vaultFinish("Eastport", v);
  dir.addLibraryEntries([{ id: "MonsterAAAAAAAAA", shelf: "monster", name: "Goblin", mime: "image/png", width: 1, height: 1, bytes: 3, createdAt: 1 }]);
  await t.FILES.put("library/MonsterAAAAAAAAA", new Uint8Array([9, 9, 9]), { httpMetadata: { contentType: "image/png" } });
  await t.DUNGEON_MAPS.put("maps/keep.json", '{"walls":1}', { httpMetadata: { contentType: "application/json" }, customMetadata: { owner: "gm" } });
  return { roomId };
}

// ---------------------------------------------------------------- the tests

let drive: Awaited<ReturnType<typeof googleDrive>>;
let t: Table;
beforeEach(async () => {
  drive = await googleDrive();
  t = await table(drive);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a backup", () => {
  it("does nothing until Google Drive is set up", async () => {
    const { begun, waits } = await t.backUp();
    expect(begun).toEqual({ started: false, why: "Google Drive isn't set up for backups yet." });
    expect(waits).toEqual([]);
    expect(drive.state.calls).toBe(0);
  });

  it("puts the table, every room and every file in Drive, and nothing on Cloudflare", async () => {
    const { roomId } = await played(t);
    const at = Date.UTC(2026, 10, 6, 7, 30);
    await t.backUp("nightly", at);
    expect(t.nights()).toEqual(["2026-11-06T07-30Z.json"]);
    const m = t.night("2026-11-06T07-30Z");
    expect(m).toMatchObject({ format: "table-backup", at, reason: "nightly", complete: true, missing: 0 });
    expect(m.rooms.map((r) => [r.id, r.name, r.scenes])).toEqual([[roomId, "Curse of Strahd", 1]]);
    expect(m.files.map((f) => [f.bucket, f.key]).sort()).toEqual([
      ["dungeon-maps", "maps/keep.json"],
      ["tabletop-files", "library/MonsterAAAAAAAAA"],
      ["tabletop-files", `rooms/${roomId}/assetmap00001`],
    ]);
    // Each file's in Drive, by its checksum, with its type.
    const pic = drive.folders.get("files")!.get(md5(new Uint8Array([1, 2, 3, 4, 5])))!;
    expect([...pic.bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(pic.mime).toBe("image/png");
    // The only buckets are the two it read: nothing written to either.
    expect([...t.FILES.objects.keys()].sort()).toEqual([`rooms/${roomId}/assetmap00001`, "library/MonsterAAAAAAAAA"].sort());
    expect([...t.DUNGEON_MAPS.objects.keys()]).toEqual(["maps/keep.json"]);
    const wrangler = await source("wrangler.jsonc");
    expect(wrangler.match(/"bucket_name": "[^"]+"/g)).toEqual(['"bucket_name": "tabletop-files"', '"bucket_name": "dungeon-maps"']);
    expect(wrangler).toContain('"crons": ["30 7 * * *"]');
    const s = await t.status();
    expect(s.running).toBeNull();
    expect(s.error).toBeNull();
    expect(s.last).toMatchObject({ id: "2026-11-06T07-30Z", complete: true, rooms: 1, files: 3 });
    expect(s.lastGoodAt).toBeTypeOf("number");
  });

  it("leaves out sign-in keys and script addresses, and who was connected, but has the rest", async () => {
    const { roomId } = await played(t);
    (t.directory as unknown as { setVaultDriveSource(s: string): void }).setVaultDriveSource("https://script.google.com/macros/s/VAULTSECRET/exec");
    const key = (t.directory as unknown as { backupDriveKey(): string }).backupDriveKey();
    (t.room(roomId) as unknown as { sql: { exec(q: string, ...b: unknown[]): unknown } }).sql.exec(`INSERT INTO sessions (id, last_seq, at) VALUES ('tabTAB', 1, 1)`);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    const m = t.night("2026-11-06T07-30Z");
    const tableFile = drive.folders.get("snapshots")!.get(`${m.table!.snapshot}.json.gz`)!;
    const { tables } = await t.unpack(tableFile.bytes);
    const text = JSON.stringify(tables);
    expect(text).not.toContain("VAULTSECRET");
    expect(text).not.toContain(key);
    expect(tables.secrets).toBeUndefined();
    expect(text).not.toContain("Red Tide");
    expect(text).toContain("Barovian");
    const roomFile = drive.folders.get("snapshots")!.get(`${m.rooms[0].snapshot}.json.gz`)!;
    const inRoom = await t.unpack(roomFile.bytes);
    expect(inRoom.tables.sessions).toBeUndefined();
    expect(inRoom.tables.assets).toHaveLength(1);
  });

  it("sends only what's new the next night", async () => {
    const { roomId } = await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    const files = drive.folders.get("files")!.size;
    const snapshots = drive.folders.get("snapshots")!.size;
    // Nothing changed: a new list and nothing else.
    await t.backUp("nightly", Date.UTC(2026, 10, 7, 7, 30));
    expect(t.nights()).toEqual(["2026-11-06T07-30Z.json", "2026-11-07T07-30Z.json"]);
    expect(drive.folders.get("files")!.size).toBe(files);
    expect(drive.folders.get("snapshots")!.size).toBe(snapshots);
    expect((await t.status()).last?.sent).toBe(0);
    // A new picture: only that.
    await t.FILES.put(`rooms/${roomId}/assetnew00001`, new Uint8Array([7, 7]));
    await t.backUp("nightly", Date.UTC(2026, 10, 8, 7, 30));
    expect(drive.folders.get("files")!.size).toBe(files + 1);
    expect((await t.status()).last?.sent).toBe(2);
    expect(t.night("2026-11-08T07-30Z").files).toHaveLength(4);
  });

  it("keeps a file that's changed in both versions, for each night that had it", async () => {
    await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    await t.DUNGEON_MAPS.put("maps/keep.json", '{"walls":2}', { httpMetadata: { contentType: "application/json" } });
    await t.backUp("nightly", Date.UTC(2026, 10, 7, 7, 30));
    const etag = (id: string) => t.night(id).files.find((f) => f.key === "maps/keep.json")!.etag;
    expect(etag("2026-11-06T07-30Z")).not.toBe(etag("2026-11-07T07-30Z"));
    expect(drive.folders.get("files")!.has(etag("2026-11-06T07-30Z"))).toBe(true);
    expect(drive.folders.get("files")!.has(etag("2026-11-07T07-30Z"))).toBe(true);
  });

  it("sends a big map in parts, and it comes back whole", async () => {
    const { roomId } = await played(t);
    const big = new Uint8Array(PART_BYTES * 2 + 12345).map((_, i) => i % 251);
    await t.FILES.put(`rooms/${roomId}/assetbig00001`, big, { httpMetadata: { contentType: "image/webp" } });
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    const inDrive = [...drive.folders.get("files")!.keys()].filter((n) => n.startsWith(md5(big)));
    expect(inDrive).toEqual([`${md5(big)}.p000`, `${md5(big)}.p001`, `${md5(big)}.p002`]);
    await t.FILES.delete(`rooms/${roomId}/assetbig00001`);
    expect(await t.filesBack("2026-11-06T07-30Z", { room: roomId, into: roomId })).toEqual({ total: 2, missing: 0 });
    expect(md5(t.FILES.objects.get(`rooms/${roomId}/assetbig00001`)!.bytes)).toBe(md5(big));
  }, 60_000);

  it("two in the same minute each keep their own list", async () => {
    const { roomId } = await played(t);
    const at = Date.UTC(2026, 10, 6, 7, 30);
    await t.backUp("by hand", at);
    (t.room(roomId) as unknown as { addAsset(a: unknown, r: string): void }).addAsset(
      { id: "assetlater001", name: "Later", kind: "token", width: 1, height: 1, mime: "image/png", bytes: 1, owner: "gm", createdAt: 2 },
      "gm",
    );
    await t.backUp("before a restore", at + 5000);
    expect(t.nights()).toEqual(["2026-11-06T07-30Z.json", "2026-11-06T07-31Z.json"]);
    expect(t.night("2026-11-06T07-30Z").reason).toBe("by hand");
    const undo = t.night("2026-11-06T07-31Z");
    expect(undo.reason).toBe("before a restore");
    // What it says it holds is what was there at that moment.
    const held = await t.unpack(drive.folders.get("snapshots")!.get(`${undo.rooms[0].snapshot}.json.gz`)!.bytes);
    expect(held.tables.assets).toHaveLength(2);
    expect((await t.status()).last?.id).toBe("2026-11-06T07-31Z");
  });

  it("only one at a time, and carries on from where it was", async () => {
    await played(t);
    const begin = (t.job.instance as unknown as { begin(r: string): Promise<{ started: boolean; why?: string }> }).begin.bind(t.job.instance);
    expect((await begin("by hand")).started).toBe(true);
    expect(await begin("nightly")).toEqual({ started: false, why: "A backup is going already." });
    // Its alarm lost: asking again sets it going.
    t.job.state.alarmAt = null;
    await begin("nightly");
    expect(t.job.state.alarmAt).not.toBeNull();
    await t.drain();
    expect((await t.status()).last?.complete).toBe(true);
    expect((await t.status()).last?.reason).toBe("by hand");
  });
});

describe("when Google says no", () => {
  it("leaves out a file that won't go, says so, and sends it the next night", async () => {
    const { roomId } = await played(t);
    const bad = md5(new Uint8Array([1, 2, 3, 4, 5]));
    drive.state.refuse = (name) => name === bad;
    const { waits } = await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    // Waits between tries: a minute, then five.
    expect(waits.filter((w) => w > 30_000).map((w) => Math.round(w / 60_000))).toEqual([1, 5, 30]);
    const m = t.night("2026-11-06T07-30Z");
    expect(m.complete).toBe(false);
    expect(m.missing).toBe(1);
    expect(m.files.some((f) => f.key === `rooms/${roomId}/assetmap00001`)).toBe(false);
    expect(m.files.some((f) => f.key === "maps/keep.json")).toBe(true);
    let s = await t.status();
    expect(s.error).toMatch(/1 file wouldn't go to Google Drive: Service invoked too many times/);
    expect(s.lastGoodAt).toBeNull();
    // The next night it goes, and all's well.
    drive.state.refuse = null;
    await t.backUp("nightly", Date.UTC(2026, 10, 7, 7, 30));
    s = await t.status();
    expect(s.error).toBeNull();
    expect(s.last?.complete).toBe(true);
    expect(drive.folders.get("files")!.has(bad)).toBe(true);
  });

  it("gives up for the night when nothing will go, saying why, and the next night's fine", async () => {
    await played(t);
    drive.state.refuse = () => true;
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    let s = await t.status();
    expect(s.running).toBeNull();
    expect(s.error).toMatch(/too many times/);
    expect(s.last).toBeNull();
    expect(t.nights()).toEqual([]);
    drive.state.refuse = null;
    await t.backUp("nightly", Date.UTC(2026, 10, 7, 7, 30));
    s = await t.status();
    expect(s.last?.complete).toBe(true);
    expect(s.error).toBeNull();
  });

  it("a file damaged on its way is refused before it's kept, and goes whole the next night", async () => {
    await played(t);
    const name = md5(new Uint8Array([9, 9, 9]));
    drive.state.garble = name;
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    expect(drive.folders.get("files")!.has(name)).toBe(false);
    expect((await t.status()).error).toMatch(/1 file wouldn't go to Google Drive: That arrived damaged/);
    drive.state.garble = null;
    await t.backUp("nightly", Date.UTC(2026, 10, 7, 7, 30));
    expect([...drive.folders.get("files")!.get(name)!.bytes]).toEqual([9, 9, 9]);
    expect((await t.status()).last?.complete).toBe(true);
  });

  it("the same name is never overwritten: Table's told what's there, and doesn't trust it if it differs", async () => {
    const key = "k1";
    drive.ask({ key, kind: "files", name: "abc", bytes: 3, data: toBase64(new Uint8Array([1, 2, 3])) });
    const again = drive.ask({ key, kind: "files", name: "abc", bytes: 1, data: toBase64(new Uint8Array([9])) });
    expect(again).toMatchObject({ kept: true, bytes: 3 });
    expect([...drive.folders.get("files")!.get("abc")!.bytes]).toEqual([1, 2, 3]);
  });
});

describe("putting a room back", () => {
  it("a deleted room comes back with its own link, its pictures and its name", async () => {
    const { roomId } = await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    await (t.room(roomId) as unknown as { destroy(id: string): Promise<void> }).destroy(roomId);
    (t.directory as unknown as { removeRoom(id: string): void }).removeRoom(roomId);
    expect(t.FILES.objects.has(`rooms/${roomId}/assetmap00001`)).toBe(false);
    const before = await t.call("GET", "/api/backups/night/2026-11-06T07-30Z");
    expect(before.data.rooms).toEqual([{ id: roomId, name: "Curse of Strahd", scenes: 1, items: 0, files: 1, here: false }]);
    const back = await t.call("POST", "/api/backups/night/2026-11-06T07-30Z/room", { room: roomId });
    expect(back.data).toEqual({ room: roomId, name: "Curse of Strahd", sameLink: true, linksLost: false, files: 1 });
    expect(await t.filesBack("2026-11-06T07-30Z", { room: roomId, into: roomId })).toEqual({ total: 1, missing: 0 });
    expect([...t.FILES.objects.get(`rooms/${roomId}/assetmap00001`)!.bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(t.FILES.objects.get(`rooms/${roomId}/assetmap00001`)!.type).toBe("image/png");
    const r = t.room(roomId) as unknown as { exists(): boolean; info: { name: string; id: string }; assets: Map<string, { name: string }>; scenes: Map<string, unknown> };
    expect(r.exists()).toBe(true);
    expect(r.info).toMatchObject({ id: roomId, name: "Curse of Strahd" });
    expect(r.assets.get("assetmap00001")?.name).toBe("Barovia");
    expect(r.scenes.size).toBe(1);
    expect((t.directory as unknown as { listRooms(): { id: string }[] }).listRooms().map((x) => x.id)).toEqual([roomId]);
  });

  it("a room that's still here is never touched: it goes back as a copy beside it", async () => {
    const { roomId } = await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    const live = t.room(roomId) as unknown as { assets: Map<string, unknown>; addAsset(a: unknown, r: string): void; info: { name: string } };
    live.addAsset({ id: "assetlater001", name: "Later", kind: "token", width: 1, height: 1, mime: "image/png", bytes: 1, owner: "gm", createdAt: 2 }, "gm");
    const back = await t.call("POST", "/api/backups/night/2026-11-06T07-30Z/room", { room: roomId });
    expect(back.data.sameLink).toBe(false);
    expect(back.data.name).toBe("Curse of Strahd (from 2026-11-06)");
    const copyId = back.data.room as string;
    expect(copyId).not.toBe(roomId);
    await t.filesBack("2026-11-06T07-30Z", { room: roomId, into: copyId });
    expect([...t.FILES.objects.get(`rooms/${copyId}/assetmap00001`)!.bytes]).toEqual([1, 2, 3, 4, 5]);
    const copy = t.room(copyId) as unknown as { info: { id: string; name: string }; assets: Map<string, unknown> };
    expect(copy.info.id).toBe(copyId);
    expect(copy.assets.has("assetlater001")).toBe(false);
    // What's here is as it was.
    expect(live.assets.has("assetlater001")).toBe(true);
    expect(live.info.name).toBe("Curse of Strahd");
    expect(
      (t.directory as unknown as { listRooms(): { id: string }[] })
        .listRooms()
        .map((x) => x.id)
        .sort(),
    ).toEqual([roomId, copyId].sort());
  });

  it("a restored room refuses to go over one in use", async () => {
    const { roomId } = await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    const m = t.night("2026-11-06T07-30Z");
    const gz = drive.folders.get("snapshots")!.get(`${m.rooms[0].snapshot}.json.gz`)!.bytes;
    await expect((t.room(roomId) as unknown as { restoreSnapshot(i: string, n: string, g: Uint8Array): Promise<unknown> }).restoreSnapshot(roomId, "x", gz)).rejects.toThrow(/already exists/);
  });
});

describe("putting the table's things back", () => {
  async function freshBackup() {
    await t.backUp("before a restore");
  }

  it("needs a backup from moments ago, so it can be undone", async () => {
    await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    // That backup's lastGoodAt is now, so put it out of date.
    (t.job.instance as unknown as { set(k: string, v: unknown): void }).set("last_good", Date.now() - 3600_000);
    const res = await t.call("POST", "/api/backups/night/2026-11-06T07-30Z/table", { parts: ["calendar"] });
    expect(res.status).toBe(409);
    expect(res.data.error).toMatch(/Take a backup first/);
  });

  it("puts back only the parts asked for, notes and their pictures among them", async () => {
    await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    const dir = t.directory as unknown as {
      setCalendar(j: string): number;
      calendar(): { json: string };
      vaultClear(v: string | null): string[];
      vaultNote(v: string, p: string): string | null;
      libraryList(): { id: string }[];
    };
    // Things go wrong.
    dir.setCalendar(JSON.stringify({ name: "Ruined" }));
    dir.vaultClear(null);
    expect(dir.vaultNote("Eastport", "NPCs/Hilda.md")).toBeNull();
    await freshBackup();
    const res = await t.call("POST", "/api/backups/night/2026-11-06T07-30Z/table", { parts: ["notes"] });
    expect(res.status).toBe(200);
    expect(dir.vaultNote("Eastport", "NPCs/Hilda.md")).toContain("Red Tide");
    // The calendar wasn't asked for: as it is now.
    expect(dir.calendar().json).toContain("Ruined");
    const cal = await t.call("POST", "/api/backups/night/2026-11-06T07-30Z/table", { parts: ["calendar"] });
    expect(cal.status).toBe(200);
    expect(dir.calendar().json).toContain("Barovian");
    expect(dir.libraryList().map((e) => e.id)).toEqual(["MonsterAAAAAAAAA"]);
  });

  it("brings back the files of what it puts back, Dungeon's maps too", async () => {
    await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    await t.FILES.delete("library/MonsterAAAAAAAAA");
    await t.DUNGEON_MAPS.put("maps/keep.json", "ruined");
    await freshBackup();
    expect(await t.filesBack("2026-11-06T07-30Z", { parts: ["library", "dungeon"] })).toEqual({ total: 2, missing: 0 });
    expect([...t.FILES.objects.get("library/MonsterAAAAAAAAA")!.bytes]).toEqual([9, 9, 9]);
    const map = t.DUNGEON_MAPS.objects.get("maps/keep.json")!;
    expect(new TextDecoder().decode(map.bytes)).toBe('{"walls":1}');
    expect(map.type).toBe("application/json");
    expect(map.meta).toEqual({ owner: "gm" });
    // A room's pictures aren't part of it.
    expect(partFiles("library")).toEqual({ bucket: "tabletop-files", prefix: "library/" });
    expect(partFiles("calendar")).toBeNull();
  });
});

describe("a Table that's lost everything", () => {
  it("comes back from Drive alone, once its script is told to answer the new Table", async () => {
    const { roomId } = await played(t);
    await t.backUp("nightly", Date.UTC(2026, 10, 6, 7, 30));
    // A new Table: nothing kept, the same Drive.
    const lost = await table(drive);
    const refused = await lost.call("PUT", "/api/backups/drive", { source: SCRIPT });
    expect(refused.status).toBe(502);
    expect(refused.data.error).toMatch(/answers another Table.*delete TABLE_KEY/);
    drive.props.delete("TABLE_KEY");
    expect((await lost.call("PUT", "/api/backups/drive", { source: SCRIPT })).status).toBe(200);
    const list = await lost.call("GET", "/api/backups/nights");
    expect(list.data).toEqual([{ id: "2026-11-06T07-30Z" }]);
    const back = await lost.call("POST", "/api/backups/night/2026-11-06T07-30Z/room", { room: roomId });
    expect(back.data.sameLink).toBe(true);
    expect((await lost.filesBack("2026-11-06T07-30Z", { room: roomId, into: roomId })).missing).toBe(0);
    await lost.backUp("before a restore");
    // The campaign notes are encrypted with a key that was in the old Table: asked for, nothing's put back, and it says why.
    const withNotes = await lost.call("POST", "/api/backups/night/2026-11-06T07-30Z/table", { parts: ["calendar", "notes"] });
    expect(withNotes.status).toBe(502);
    expect(withNotes.data.error).toMatch(/encrypted with a key this Table doesn't have.*bring your notes in again from Obsidian/);
    const dir = lost.directory as unknown as { calendar(): { json: string } | null; vaultNote(v: string, p: string): string | null; libraryList(): unknown[] };
    expect(dir.calendar()).toBeNull();
    const parts = ["calendar", "library", "characters", "dungeon"];
    expect((await lost.call("POST", "/api/backups/night/2026-11-06T07-30Z/table", { parts })).status).toBe(200);
    expect((await lost.filesBack("2026-11-06T07-30Z", { parts })).missing).toBe(0);
    expect(dir.calendar()!.json).toContain("Barovian");
    expect(dir.vaultNote("Eastport", "NPCs/Hilda.md")).toBeNull();
    expect(dir.libraryList()).toHaveLength(1);
    expect(lost.DUNGEON_MAPS.objects.has("maps/keep.json")).toBe(true);
    expect((lost.room(roomId) as unknown as { assets: Map<string, unknown> }).assets.size).toBe(1);
  });
});

describe("the GM's campaign notes, encrypted", () => {
  const PICTURE = new TextEncoder().encode("PICTURE-OF-THE-SECRET-VILLAIN");
  const HASH = "a".repeat(64);
  const AT = Date.UTC(2026, 10, 6, 7, 30);
  const ID = "2026-11-06T07-30Z";
  const key = (x: Table) => (x.directory as unknown as { backupNotesKey(): string }).backupNotesKey();
  const dirOf = (x: Table) =>
    x.directory as unknown as {
      vaultStart(v: string): string;
      vaultPutNotes(v: string, i: string, n: { path: string; body: string }[]): unknown;
      vaultPutFiles(v: string, i: string, f: unknown[]): unknown;
      vaultFinish(v: string, i: string): unknown;
      vaultClear(v: string | null): string[];
      vaultNote(v: string, p: string): string | null;
      vaultIndex(): { vaults: { name: string }[]; files: { path: string }[] };
      restoreParts(g: Uint8Array, p: string[]): Promise<void>;
      removeRoom(id: string): void;
    };

  /** A vault with a note, a picture and a token linked to the note. */
  async function secrets(x: Table, roomId: string) {
    const dir = dirOf(x);
    const v = dir.vaultStart("Eastport");
    dir.vaultPutNotes("Eastport", v, [{ path: "NPCs/Hilda.md", body: "# Hilda\nShe informs for the Red Tide." }]);
    await x.FILES.put(`vault/${HASH}`, PICTURE, { httpMetadata: { contentType: "image/png" } });
    dir.vaultPutFiles("Eastport", v, [{ path: "Attachments/hilda.png", hash: HASH, mime: "image/png", bytes: PICTURE.length }]);
    dir.vaultFinish("Eastport", v);
    const room = x.room(roomId) as unknown as { setMeta(k: string, v: unknown): void; tokenNotes: Record<string, string> };
    room.setMeta("token_notes", { token1: "Eastport|NPCs/Hilda.md" });
    room.tokenNotes = { token1: "Eastport|NPCs/Hilda.md" };
  }

  /** Everything in the Drive folder, as anyone who can open it could read it. */
  async function everythingInDrive(x: Table) {
    const out: string[] = [];
    for (const [, folder] of drive.folders) {
      for (const [name, file] of folder) {
        out.push(name);
        out.push(name.endsWith(".json.gz") ? JSON.stringify(await x.unpack(file.bytes)) : new TextDecoder("latin1").decode(file.bytes));
      }
    }
    return out.join("\n");
  }

  it("nothing of them can be read in Drive: not their words, names, pictures, or tokens' links", async () => {
    const { roomId } = await played(t);
    await secrets(t, roomId);
    await t.backUp("nightly", AT);
    expect(t.night(ID).complete).toBe(true);
    const all = await everythingInDrive(t);
    // It does read what isn't encrypted.
    for (const plain of ["Barovian", "Curse of Strahd", "Goblin"]) expect(all).toContain(plain);
    for (const secret of ["Red Tide", "Hilda", "hilda", "Eastport", "NPCs/", "Attachments", "token1", "PICTURE-OF-THE-SECRET-VILLAIN"]) expect(all).not.toContain(secret);
    expect(all).not.toContain(key(t));
    // The picture is listed as encrypted, and isn't a picture in Drive.
    const entry = t.night(ID).files.find((f) => f.key === `vault/${HASH}`)!;
    expect(entry.sealed).toBe(true);
    const inDrive = drive.folders.get("files")!;
    expect(inDrive.has(entry.etag)).toBe(false);
    expect(inDrive.get(`${entry.etag}.sealed`)!.mime).toBe("application/octet-stream");
    // Only the note's picture: others go as they are.
    expect(t.night(ID).files.filter((f) => f.sealed)).toHaveLength(1);
  });

  it("unchanged, they aren't sent again the next night, and changed, each night keeps its own", async () => {
    const { roomId } = await played(t);
    await secrets(t, roomId);
    await t.backUp("nightly", AT);
    const snapshots = drive.folders.get("snapshots")!.size;
    const files = drive.folders.get("files")!.size;
    await t.backUp("nightly", AT + 86_400_000);
    expect(drive.folders.get("snapshots")!.size).toBe(snapshots);
    expect(drive.folders.get("files")!.size).toBe(files);
    expect((await t.status()).last?.sent).toBe(0);
    // A note changes: a new table snapshot only.
    const dir = dirOf(t);
    const v = dir.vaultStart("Eastport");
    dir.vaultPutNotes("Eastport", v, [{ path: "NPCs/Hilda.md", body: "# Hilda\nExposed, and fled." }]);
    dir.vaultPutFiles("Eastport", v, [{ path: "Attachments/hilda.png", hash: HASH, mime: "image/png", bytes: PICTURE.length }]);
    dir.vaultFinish("Eastport", v);
    await t.backUp("nightly", AT + 2 * 86_400_000);
    expect(drive.folders.get("snapshots")!.size).toBe(snapshots + 1);
    // The first night's still has the note as it was then.
    await t.backUp("before a restore");
    await t.call("POST", `/api/backups/night/${ID}/table`, { parts: ["notes"] });
    expect(dir.vaultNote("Eastport", "NPCs/Hilda.md")).toContain("Red Tide");
  });

  it("come back whole on this Table: words, names, pictures and tokens' links", async () => {
    const { roomId } = await played(t);
    await secrets(t, roomId);
    await t.backUp("nightly", AT);
    const dir = dirOf(t);
    dir.vaultClear(null);
    await t.FILES.delete(`vault/${HASH}`);
    await (t.room(roomId) as unknown as { destroy(id: string): Promise<void> }).destroy(roomId);
    dir.removeRoom(roomId);
    await t.backUp("before a restore");
    expect((await t.call("POST", `/api/backups/night/${ID}/table`, { parts: ["notes"] })).status).toBe(200);
    expect(await t.filesBack(ID, { parts: ["notes"] })).toEqual({ total: 1, missing: 0 });
    expect(dir.vaultNote("Eastport", "NPCs/Hilda.md")).toContain("Red Tide");
    expect(dir.vaultIndex().vaults.map((v) => v.name)).toEqual(["Eastport"]);
    expect(dir.vaultIndex().files.map((f) => f.path)).toEqual(["Attachments/hilda.png"]);
    const picture = t.FILES.objects.get(`vault/${HASH}`)!;
    expect(new TextDecoder().decode(picture.bytes)).toBe("PICTURE-OF-THE-SECRET-VILLAIN");
    expect(picture.type).toBe("image/png");
    const back = await t.call("POST", `/api/backups/night/${ID}/room`, { room: roomId });
    expect(back.data.linksLost).toBe(false);
    expect((t.room(roomId) as unknown as { tokenNotes: Record<string, string> }).tokenNotes).toEqual({ token1: "Eastport|NPCs/Hilda.md" });
  });

  it("can be checked without changing anything", async () => {
    const { roomId } = await played(t);
    await secrets(t, roomId);
    await t.backUp("nightly", AT);
    const check = await t.call("GET", `/api/backups/night/${ID}/check`);
    const etag = t.FILES.objects.get(`vault/${HASH}`)!.etag;
    expect(check.data).toEqual({
      encrypted: true,
      opens: true,
      notes: 1,
      pictures: 1,
      sealedPictures: 1,
      picturesTried: 1,
      picturesOpened: 1,
      picturesSame: 1,
      plainCopies: [etag],
      usedByRoomsToo: 0,
      tableSnapshot: `${t.night(ID).table!.snapshot}.json.gz`,
    });
    // A room using the same picture needs its plain copy: it isn't one to remove.
    await t.FILES.put(`rooms/${roomId}/assetsame0001`, PICTURE);
    await t.backUp("nightly", AT + 60_000);
    const again = await t.call("GET", "/api/backups/night/2026-11-06T07-31Z/check");
    expect(again.data).toMatchObject({ plainCopies: [], usedByRoomsToo: 1 });
  });

  it("a Table without the key gets the room back but its links, and can say what it can't open", async () => {
    const { roomId } = await played(t);
    await secrets(t, roomId);
    await t.backUp("nightly", AT);
    const other = await table(drive);
    drive.props.delete("TABLE_KEY");
    expect((await other.call("PUT", "/api/backups/drive", { source: SCRIPT })).status).toBe(200);
    expect(key(other)).not.toBe(key(t));
    expect((await other.call("GET", `/api/backups/night/${ID}/check`)).data).toMatchObject({ encrypted: true, opens: false, notes: 0, picturesOpened: 0 });
    const back = await other.call("POST", `/api/backups/night/${ID}/room`, { room: roomId });
    expect(back.status).toBe(200);
    expect(back.data.linksLost).toBe(true);
    const room = other.room(roomId) as unknown as { tokenNotes: Record<string, string>; assets: Map<string, unknown> };
    expect(room.tokenNotes).toEqual({});
    expect(room.assets.size).toBe(1);
    // A note's picture can't be opened: counted as missing, never stored as it is in Drive.
    await other.backUp("before a restore");
    expect(await other.filesBack(ID, { parts: ["notes"] })).toEqual({ total: 1, missing: 1 });
    expect(other.FILES.objects.has(`vault/${HASH}`)).toBe(false);
  });

  it("backups from before they were encrypted still come back, and a plain copy in Drive doesn't stop the encrypted one", async () => {
    const { roomId } = await played(t);
    const dir = dirOf(t);
    const { pack } = (await import(/* @vite-ignore */ "../src/worker/" + "snapshot")) as { pack(s: unknown): Promise<{ gz: Uint8Array }> };
    const old = await pack({
      format: "table-snapshot",
      version: 1,
      tables: { vnotes: [{ vault: "Old", path: "Plain.md", body: "# From before", import: "x" }], vfiles: [], vdrive: [], blobs: [{ name: "vault_at:Old", value: "1", version: 1 }] },
    });
    await dir.restoreParts(old.gz, ["notes"]);
    expect(dir.vaultNote("Old", "Plain.md")).toBe("# From before");
    // The picture went in plain on an older backup: under its checksum, which isn't the encrypted one's name.
    await secrets(t, roomId);
    const etag = t.FILES.objects.get(`vault/${HASH}`)!.etag;
    const scriptKey = (t.directory as unknown as { backupDriveKey(): string }).backupDriveKey();
    expect(drive.ask({ key: scriptKey, kind: "files", name: etag, mime: "image/png", data: toBase64(PICTURE) })).toMatchObject({ bytes: PICTURE.length });
    await t.backUp("nightly", AT);
    expect(t.night(ID).complete).toBe(true);
    const entry = t.night(ID).files.find((x) => x.key === `vault/${HASH}`)!;
    expect(entry.sealed).toBe(true);
    // The encrypted one went, under its own name. The plain one's still there until someone deletes it: the script can't.
    const sent = drive.folders.get("files")!;
    expect(new TextDecoder("latin1").decode(sent.get(`${etag}.sealed`)!.bytes)).not.toContain("PICTURE-OF-THE-SECRET-VILLAIN");
    expect(new TextDecoder().decode(sent.get(etag)!.bytes)).toBe("PICTURE-OF-THE-SECRET-VILLAIN");
  });

  it("seals so only the key opens it, and any change to it is noticed", async () => {
    const { sealBytes, openBytes, sealJson, openJson } = (await import(/* @vite-ignore */ "../src/worker/" + "seal")) as {
      sealBytes(k: string, b: Uint8Array): Promise<Uint8Array>;
      openBytes(k: string, b: Uint8Array): Promise<Uint8Array>;
      sealJson(k: string, v: unknown): Promise<string>;
      openJson(k: string, s: string): Promise<unknown>;
    };
    const words = new TextEncoder().encode("the vicar did it");
    const sealed = await sealBytes("key-one", words);
    expect(new TextDecoder("latin1").decode(sealed)).not.toContain("vicar");
    expect(new TextDecoder().decode(await openBytes("key-one", sealed))).toBe("the vicar did it");
    await expect(openBytes("key-two", sealed)).rejects.toThrow();
    const changed = sealed.slice();
    changed[changed.length - 1] ^= 1;
    await expect(openBytes("key-one", changed)).rejects.toThrow();
    // The same words the same way each night; other words, or another key, not.
    expect([...(await sealBytes("key-one", words))]).toEqual([...sealed]);
    expect([...(await sealBytes("key-two", words))]).not.toEqual([...sealed]);
    expect([...(await sealBytes("key-one", new TextEncoder().encode("the vicar did not")))].slice(0, 12)).not.toEqual([...sealed].slice(0, 12));
    expect(await openJson("key-one", await sealJson("key-one", { a: [1, "two"] }))).toEqual({ a: [1, "two"] });
  });
});

describe("nothing's forgotten", () => {
  it("every table in the Directory is in a part, or named as left out", async () => {
    const dir = t.directory as unknown as { sql: { exec(q: string): { toArray(): { name: string }[] } } };
    const handled = new Set([...t.NOT_BACKED_UP, ...Object.values(t.PART_TABLES).flatMap((p) => p.tables), "rooms", "blobs"]);
    const tables = dir.sql
      .exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .toArray()
      .map((r) => r.name)
      .filter((n) => !n.startsWith("sqlite_"));
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.filter((n) => !handled.has(n))).toEqual([]);
  });

  it("every kind of file in R2 has a part or a room", async () => {
    const worker = (await source("src/worker/characters.ts")) + (await source("src/shared/library.ts")) + (await source("src/shared/vault.ts")) + (await source("src/worker/room.ts"));
    for (const prefix of ["characters/", "library/", "vault/", "rooms/"]) expect(worker).toContain("`" + prefix);
    expect(partFiles("characters")?.prefix).toBe("characters/");
    expect(partFiles("notes")?.prefix).toBe("vault/");
  });
});

describe("the backup script", () => {
  it("answers only the first Table to ask, and only inside its own folders", async () => {
    expect(drive.ask({ list: true }).error).toMatch(/key/);
    expect(drive.ask({ key: "k1", list: true })).toEqual({ version: 1, nights: [], snapshots: [], files: [] });
    expect(drive.ask({ key: "someone-else", list: true }).error).toMatch(/another Table/);
    for (const name of ["../x", ".hidden", "a/b", ""]) expect(drive.ask({ key: "k1", kind: "files", name, data: "AA==" }).error).toMatch(/isn't a backup's name/);
    expect(drive.ask({ key: "k1", kind: "elsewhere", name: "a", data: "AA==" }).error).toMatch(/isn't a backup's name/);
    expect(drive.ask({ key: "k1", kind: "files", name: "nope", read: true }).error).toMatch(/isn't in the backups/);
  });

  it("only adds: what's there is never changed or deleted", async () => {
    const put = (data: Uint8Array) => drive.ask({ key: "k1", kind: "files", name: "abc", mime: "image/png", data: toBase64(data) });
    expect(put(new Uint8Array([1, 2, 3]))).toEqual({ name: "abc", bytes: 3, md5: md5(new Uint8Array([1, 2, 3])) });
    expect(put(new Uint8Array([9]))).toEqual({ name: "abc", bytes: 3, md5: md5(new Uint8Array([1, 2, 3])), kept: true });
    expect(drive.ask({ key: "k1", kind: "files", name: "abc", read: true })).toEqual({ name: "abc", data: toBase64(new Uint8Array([1, 2, 3])) });
    const code = (await source("scripts/table-backup.gs")).replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/setTrashed|removeFile|\.remove\(|\.setContent\(/);
  });

  it("the card is under the rooms, in the start page's column", async () => {
    const home = await source("src/client/ui/Home.tsx");
    expect(home).toMatch(/<BackupsCard [^\n]*\/>\n      <\/div>\n/);
  });

  it("the page offers it to copy, and it's in the repo with nothing private in it", async () => {
    const code = await source("scripts/table-backup.gs");
    expect(code).not.toMatch(/AKfycb|FOLDER_ID\s*=\s*"/);
    expect(await source("src/client/ui/BackupsCard.tsx")).toContain("table-backup.gs?raw");
  });
});

describe("the routes", () => {
  it("are the GM's alone", async () => {
    await played(t);
    for (const [method, path] of [
      ["GET", "/api/backups"],
      ["PUT", "/api/backups/drive"],
      ["POST", "/api/backups/run"],
      ["GET", "/api/backups/nights"],
      ["GET", "/api/backups/night/2026-11-06T07-30Z"],
      ["POST", "/api/backups/night/2026-11-06T07-30Z/room"],
    ]) {
      expect((await t.call(method, path, method === "GET" ? undefined : {}, false)).status).toBe(401);
    }
  });

  it("only keeps an Apps Script's address, and only once it answers", async () => {
    expect((await t.call("PUT", "/api/backups/drive", { source: "https://evil.example/exec" })).status).toBe(400);
    expect((await t.call("PUT", "/api/backups/drive", { source: SCRIPT })).data).toEqual({ source: SCRIPT });
    expect(drive.props.get("TABLE_KEY")).toBeTruthy();
    expect((await t.status()).source).toBe(SCRIPT);
    expect((await t.call("PUT", "/api/backups/drive", { source: "" })).data).toEqual({ source: null });
  });

  it("start a backup by hand, and list what's in Drive even if this Table doesn't remember it", async () => {
    await played(t);
    expect((await t.call("POST", "/api/backups/run", {})).data).toEqual({ started: true });
    await t.drain();
    const nights = (await t.call("GET", "/api/backups/nights")).data as unknown as { id: string; reason?: string }[];
    expect(nights).toHaveLength(1);
    expect(nights[0].reason).toBe("by hand");
    drive.folders.get("nights")!.set("2020-01-01T00-00Z.json", { bytes: new Uint8Array(), mime: "x" });
    drive.folders.get("nights")!.set("notes about it.txt", { bytes: new Uint8Array(), mime: "x" });
    const more = (await t.call("GET", "/api/backups/nights")).data as unknown as { id: string }[];
    expect(more.map((n) => n.id)).toEqual([nights[0].id, "2020-01-01T00-00Z"]);
  });
});

describe("the small print", () => {
  it("names and pieces", () => {
    expect(backupId(Date.UTC(2026, 10, 6, 7, 30, 55))).toBe("2026-11-06T07-30Z");
    expect(nightFromName("2026-11-06T07-30Z.json")).toBe("2026-11-06T07-30Z");
    expect(nightFromName("2026-11-06T07-30Z")).toBeNull();
    expect(nightFromName("holiday.json")).toBeNull();
    expect(partNames("abc", 10)).toEqual(["abc"]);
    expect(partNames("abc", PART_BYTES)).toEqual(["abc"]);
    expect(partNames("abc", PART_BYTES + 1)).toEqual(["abc.p000", "abc.p001"]);
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});

describe("the guide", () => {
  it("says what's backed up, how to set it up and how to put things back", () => {
    const section = GUIDE.find((s) => s.id === "backups")!;
    expect(section.audience).toBe("gm");
    const text = [section.intro, ...section.parts.flatMap((p) => [...p.steps, ...p.notes])].join("\n");
    for (const words of ["**Copy the script**", "FOLDER_ID", "Anyone", "**Back up now**", "**Put it back**", "TABLE_KEY", "nothing is kept on Cloudflare", "never deletes", "encrypted before they leave Table", "never goes to Drive", "Bring them in again from Obsidian", "isn't encrypted"]) expect(text).toContain(words);
    const news = GUIDE.find((s) => s.id === "whats-new")!.parts[1];
    expect(news.title).toBe("GM: everything backed up to Google Drive, every night (6 November 2026)");
  });
});

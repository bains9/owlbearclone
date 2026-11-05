// Campaign notes from Google Drive (4 November 2026): the GM's vault script (scripts/vault-drive.gs)
// in their Google account, its address kept by Table; a sync brings the vault in through it, its
// pictures fetched only when they've changed in Drive. The script only reads, answers only the
// Table whose key it kept, and hands over only notes and pictures inside the vault folder.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { syncFromDrive } from "../src/client/vault";
import { RoomClient } from "../src/client/room/client";
import type { VaultIndex } from "../src/shared/vault";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("../src/worker/auth", () => ({ isGm: async () => true }));

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((t) => t.replace(/\r\n/g, "\n"));
const SCRIPT = "https://script.google.com/macros/s/AKfycbTESTtestTESTtestTESTtest/exec";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4]);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

async function directory() {
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
  const { Directory } = (await import(/* @vite-ignore */ "../src/worker/" + "directory")) as { Directory: new (ctx: unknown, env: unknown) => Record<string, (...a: unknown[]) => unknown> };
  return new Directory({ storage: { sql }, blockConcurrencyWhile: (f: () => unknown) => f() }, {});
}

describe("syncing from Google Drive", () => {
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const { vaultRoute } = (await import(/* @vite-ignore */ "../src/worker/" + "vaultRoutes")) as {
      vaultRoute(request: Request, env: unknown, url: URL, method: string): Promise<Response | null>;
    };
    const files = new Map<string, ArrayBuffer>();
    const bucket = { get: async () => null, put: async (k: string, v: ArrayBuffer) => void files.set(k, v), delete: async (k: string) => void files.delete(k) };
    const d = await directory();
    const env = { FILES: bucket, DIRECTORY: { getByName: () => d } };
    // The GM's vault script in Drive, as the Worker asks it.
    const asked: Record<string, unknown>[] = [];
    let modified = 1000;
    const script = vi.fn(async (_url: string, init: RequestInit) => {
      const p = JSON.parse(String(init.body)) as Record<string, unknown>;
      asked.push(p);
      if (p.list) return Response.json({ version: 1, notes: [{ path: "NPCs/Hilda.md", modified: 1, bytes: 9 }, { path: "../evil.md", modified: 1, bytes: 1 }], files: [{ path: "Attachments/h.png", modified, bytes: PNG.length }] });
      if (p.notes) return Response.json({ notes: (p.notes as string[]).map((path) => ({ path, body: `# ${path}` })) });
      if (p.file) return Response.json({ path: p.file, data: b64(PNG) });
      return Response.json({ error: "?" });
    });
    vi.stubGlobal("fetch", script);
    const go = async (method: string, path: string, body?: unknown) => {
      const url = new URL(`https://t.test${path}`);
      const res = await vaultRoute(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), env, url, method);
      return { status: res!.status, data: (await res!.json()) as Record<string, unknown> };
    };
    return { go, d, files, asked, script, setModified: (m: number) => (modified = m) };
  }

  it("keeps the script's address only once it answers, and only an Apps Script's", async () => {
    const { go, asked } = await setup();
    expect((await go("PUT", "/api/vault/drive", { source: "https://evil.example/exec" })).status).toBe(400);
    expect((await go("PUT", "/api/vault/drive", { source: SCRIPT })).data).toEqual({ source: SCRIPT });
    expect(asked[0]).toMatchObject({ list: true });
    expect(typeof asked[0].key).toBe("string");
    expect((await go("GET", "/api/vault/drive")).data).toEqual({ source: SCRIPT });
  });

  it("brings the vault in through it; a picture unchanged in Drive isn't fetched again", async () => {
    const { go, d, files, asked, setModified } = await setup();
    await go("PUT", "/api/vault/drive", { source: SCRIPT });
    const sync = async () => {
      const start = await go("POST", "/api/vault/drive/start");
      const id = start.data.import as string;
      // A path out of the vault in the listing is left out.
      expect(start.data.notes).toEqual(["NPCs/Hilda.md"]);
      await go("POST", "/api/vault/drive/notes", { import: id, paths: start.data.notes });
      const pics = await go("POST", "/api/vault/drive/files", { import: id, files: start.data.files });
      await go("POST", "/api/vault/import/finish", { import: id });
      return pics.data;
    };
    expect(await sync()).toEqual({ fetched: 1, skipped: 0 });
    expect((d.vaultNote as (p: string) => string)("NPCs/Hilda.md")).toBe("# NPCs/Hilda.md");
    expect([...files.keys()]).toHaveLength(1);
    const fetches = () => asked.filter((a) => a.file).length;
    expect(fetches()).toBe(1);
    // Again, nothing changed in Drive: no picture fetched.
    expect(await sync()).toEqual({ fetched: 0, skipped: 0 });
    expect(fetches()).toBe(1);
    expect((d.vaultIndex as () => VaultIndex)().files.map((f) => f.path)).toEqual(["Attachments/h.png"]);
    // Changed in Drive: fetched again.
    setModified(2000);
    expect(await sync()).toEqual({ fetched: 1, skipped: 0 });
    expect(fetches()).toBe(2);
  });

  it("is driven by the GM's page: notes in batches, pictures a few at a time", async () => {
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid0000001", name: "GM", color: "#ff0000" });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === "/api/vault/drive/start") return Response.json({ import: "imp", notes: Array.from({ length: 150 }, (_, i) => `n${i}.md`), files: Array.from({ length: 10 }, (_, i) => ({ path: `p${i}.png`, modified: 1, bytes: 1 })) });
        if (url === "/api/vault/drive/files") return Response.json({ fetched: 1, skipped: 0 });
        if (url === "/api/vault/import/finish") return Response.json({ notes: 150, files: 10 });
        if (url === "/api/vault") return Response.json({ notes: [], files: [], importedAt: 1 });
        return Response.json({ notes: 100 });
      }),
    );
    const said: string[] = [];
    expect(await syncFromDrive(room, (t) => said.push(t))).toEqual({ notes: 150, files: 10, skipped: 0 });
    expect(calls.filter((c) => c === "/api/vault/drive/notes")).toHaveLength(2);
    expect(calls.filter((c) => c === "/api/vault/drive/files")).toHaveLength(2);
    expect(said.at(-1)).toBe("Your pictures: 10 of 10…");
    vi.unstubAllGlobals();
  });
});

describe("the vault script in Google Drive", () => {
  /** Runs scripts/vault-drive.gs against Drive and properties as Apps Script gives them. */
  async function script(tree: Record<string, string>) {
    const code = await source("scripts/vault-drive.gs");
    const props = new Map<string, string>([["FOLDER_ID", "root"]]);
    const folder = (path: string): unknown => ({
      getFiles() {
        const names = Object.keys(tree).filter((p) => p.startsWith(path) && !p.slice(path.length).includes("/"));
        let i = 0;
        return { hasNext: () => i < names.length, next: () => file(names[i++]) };
      },
      getFolders() {
        const subs = [...new Set(Object.keys(tree).filter((p) => p.startsWith(path) && p.slice(path.length).includes("/")).map((p) => p.slice(path.length).split("/")[0]))];
        let i = 0;
        return {
          hasNext: () => i < subs.length,
          next: () => {
            const name = subs[i++];
            return { ...(folder(`${path}${name}/`) as object), getName: () => name };
          },
        };
      },
      getFoldersByName(n: string) {
        const has = Object.keys(tree).some((p) => p.startsWith(`${path}${n}/`));
        let done = !has;
        return { hasNext: () => !done, next: () => ((done = true), folder(`${path}${n}/`)) };
      },
      getFilesByName(n: string) {
        let done = !(`${path}${n}` in tree);
        return { hasNext: () => !done, next: () => ((done = true), file(`${path}${n}`)) };
      },
    });
    const file = (p: string) => ({
      getName: () => p.split("/").pop(),
      getLastUpdated: () => new Date(5),
      getSize: () => tree[p].length,
      getBlob: () => ({ getDataAsString: () => tree[p], getBytes: () => [...tree[p]].map((c) => c.charCodeAt(0)) }),
    });
    const globals = {
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
      DriveApp: { getFolderById: () => folder("") },
      ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => t }), MimeType: { JSON: "json" } },
      Utilities: { base64Encode: (b: number[]) => btoa(String.fromCharCode(...b)) },
    };
    const run = new Function(...Object.keys(globals), `${code}; return { doPost };`)(...Object.values(globals)) as { doPost(e: unknown): string };
    return (p: Record<string, unknown>) => JSON.parse(run.doPost({ postData: { contents: JSON.stringify(p) } })) as Record<string, unknown>;
  }

  it("lists the vault's notes and pictures, not Obsidian's own folders", async () => {
    const ask = await script({ "Temple.md": "# T", "NPCs/Hilda.md": "# H", "Att/h.png": "png", ".obsidian/app.json": "{}", "Att/map.pdf": "pdf" });
    const listed = ask({ key: "k1", list: true }) as { notes: { path: string }[]; files: { path: string }[] };
    expect(listed.notes.map((n) => n.path).sort()).toEqual(["NPCs/Hilda.md", "Temple.md"]);
    expect(listed.files.map((f) => f.path)).toEqual(["Att/h.png"]);
  });

  it("answers only the Table whose key it kept first, and only for what's in the vault", async () => {
    const ask = await script({ "NPCs/Hilda.md": "# H", "Att/h.png": "png" });
    expect(ask({ key: "k1", notes: ["NPCs/Hilda.md"] })).toEqual({ notes: [{ path: "NPCs/Hilda.md", body: "# H" }] });
    expect(ask({ key: "someone-else", list: true }).error).toMatch(/another Table/);
    expect(ask({ list: true }).error).toMatch(/key/);
    // A way out of the vault, or a note asked for as a picture: nothing.
    expect(ask({ key: "k1", notes: ["../secret.md", ".obsidian/x.md"] })).toEqual({ notes: [] });
    expect(ask({ key: "k1", file: "NPCs/Hilda.md" }).error).toMatch(/isn't in the vault/);
    expect(ask({ key: "k1", file: "Att/h.png" })).toEqual({ path: "Att/h.png", data: btoa("png") });
  });
});

describe("the guide", () => {
  it("says how to keep it in step with Google Drive", () => {
    const section = GUIDE.find((s) => s.id === "campaign-notes")!;
    const drive = section.parts.find((p) => p.title === "Keep it in step with Google Drive")!;
    const text = [...drive.steps, ...drive.notes].join("\n");
    for (const words of ["**Copy the script**", "FOLDER_ID", "Anyone", "**Sync from Google Drive**", "15 minutes", "Ubuntu"]) expect(text).toContain(words);
  });
});

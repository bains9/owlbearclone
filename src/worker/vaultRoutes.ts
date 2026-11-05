// The GM's campaign notes (shared/vault.ts): their list, a note, a search, bringing the vault in
// (start, notes in batches, pictures by checksum, finish), taking it out, and a picture. All the
// GM's but the picture, which, like a room's pictures, is for anyone with its address (a handout
// shows it to the players).
import { VAULT_HASH, VAULT_LIMITS, VAULT_PICTURES, isVaultPath, vaultFileKey, vaultKind, type VaultFileInfo } from "../shared/vault";
import { isGm } from "./auth";
import { sniffImage } from "./uploads";

const HSTS = "max-age=31536000; includeSubDomains";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Strict-Transport-Security": HSTS },
  });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function readJson(request: Request, max: number): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("Content-Length") ?? "0") > max) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A picture's row as the page sends it, checked; null when it isn't one. */
function fileInfo(v: unknown): VaultFileInfo | null {
  const x = v as Partial<VaultFileInfo> | null;
  if (!x || !isVaultPath(x.path) || vaultKind(x.path) !== "picture") return null;
  if (typeof x.hash !== "string" || !VAULT_HASH.test(x.hash)) return null;
  if (typeof x.bytes !== "number" || !Number.isSafeInteger(x.bytes) || x.bytes < 1 || x.bytes > VAULT_LIMITS.fileBytes) return null;
  const ext = x.path.split(".").pop()!.toLowerCase();
  return { path: x.path, hash: x.hash, mime: VAULT_PICTURES[ext], bytes: x.bytes };
}

const FILE = /^\/api\/vault\/file\/([0-9a-f]{64})$/;
/** A Google Apps Script web app's address, as the character sheets' is. */
const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
const SCRIPT_MS = 45_000;

/** Asks the GM's vault script in Google Drive (scripts/vault-drive.gs); its answer, or the words for what went wrong. */
async function askDrive(source: string, key: string, ask: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<Record<string, unknown> | { error: string }> {
  let res: Response;
  try {
    res = await fetcher(source, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ key, ...ask }),
      redirect: "follow",
      signal: AbortSignal.timeout(SCRIPT_MS),
    });
  } catch {
    return { error: "Your vault script in Google Drive didn't answer in time. Try again." };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) return { error: "Your vault script in Google Drive didn't answer as it should: check its address, and that it's deployed for Anyone." };
  if (typeof body.error === "string") return { error: body.error.slice(0, 200) };
  return body;
}

/** A Drive listing's entry, checked: a note or picture with when it changed and its size. */
function driveEntry(v: unknown, kind: "note" | "picture"): { path: string; modified: number; bytes: number } | null {
  const x = v as { path?: unknown; modified?: unknown; bytes?: unknown } | null;
  if (!x || !isVaultPath(x.path) || vaultKind(x.path) !== kind) return null;
  const modified = typeof x.modified === "number" && Number.isFinite(x.modified) ? Math.round(x.modified) : 0;
  const bytes = typeof x.bytes === "number" && Number.isFinite(x.bytes) ? Math.round(x.bytes) : 0;
  return { path: x.path, modified, bytes };
}

/** The response for a campaign-notes route, or null when the path isn't one. */
export async function vaultRoute(request: Request, env: Env, url: URL, method: string): Promise<Response | null> {
  const { pathname } = url;
  const file = pathname.match(FILE);
  if (file && (method === "GET" || method === "HEAD")) {
    const obj = await env.FILES.get(vaultFileKey(file[1]), { onlyIf: request.headers });
    if (!obj) return fail(404, "Not found.");
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("ETag", obj.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Strict-Transport-Security", HSTS);
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(method === "HEAD" ? null : obj.body, { headers });
  }
  if (pathname !== "/api/vault" && !pathname.startsWith("/api/vault/")) return null;
  if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
  const directory = env.DIRECTORY.getByName("main");

  if (pathname === "/api/vault") {
    if (method === "GET") return json(await directory.vaultIndex());
    if (method === "DELETE") {
      // Out of Table altogether: the notes, and the pictures' copies.
      const hashes = await directory.vaultClear();
      await Promise.all(hashes.map((h) => env.FILES.delete(vaultFileKey(h)).catch(() => undefined)));
      return json({ ok: true });
    }
    return fail(405, "Method not allowed.");
  }
  if (pathname === "/api/vault/note" && method === "GET") {
    const path = url.searchParams.get("path");
    if (!isVaultPath(path)) return fail(400, "That isn't a note's place in the vault.");
    const body = await directory.vaultNote(path);
    return body === null ? fail(404, "That note isn't in the vault any more.") : json({ path, body });
  }
  if (pathname === "/api/vault/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    return json(q.length < 2 ? [] : await directory.vaultSearch(q));
  }
  if (method === "POST" && pathname === "/api/vault/import") return json({ import: await directory.vaultStart() });
  if (method === "POST" && pathname === "/api/vault/import/notes") {
    const body = await readJson(request, VAULT_LIMITS.batchBytes + 64 * 1024);
    const id = typeof body?.import === "string" ? body.import : "";
    const raw = Array.isArray(body?.notes) ? body.notes : null;
    if (!id || !raw || raw.length > VAULT_LIMITS.batchNotes) return fail(400, "That isn't a batch of notes.");
    const notes: { path: string; body: string }[] = [];
    for (const n of raw as { path?: unknown; body?: unknown }[]) {
      if (!isVaultPath(n?.path) || vaultKind(n.path) !== "note" || typeof n.body !== "string") return fail(400, "That isn't a note.");
      notes.push({ path: n.path, body: n.body.slice(0, VAULT_LIMITS.noteBytes) });
    }
    const refusal = await directory.vaultPutNotes(id, notes);
    return refusal ? fail(409, refusal) : json({ ok: true });
  }
  if (method === "POST" && pathname === "/api/vault/import/files") {
    // The pictures whose copies are kept already are put in at once; the rest the page sends.
    const body = await readJson(request, 2_000_000);
    const id = typeof body?.import === "string" ? body.import : "";
    const raw = Array.isArray(body?.files) ? body.files : null;
    if (!id || !raw || raw.length > 500) return fail(400, "That isn't a list of pictures.");
    const files = raw.map(fileInfo);
    if (files.some((x) => !x)) return fail(400, "That isn't a picture.");
    const list = files as VaultFileInfo[];
    const known = new Set(await directory.vaultKnownHashes([...new Set(list.map((x) => x.hash))]));
    const refusal = await directory.vaultPutFiles(id, list.filter((x) => known.has(x.hash)));
    if (refusal) return fail(409, refusal);
    return json({ missing: [...new Set(list.filter((x) => !known.has(x.hash)).map((x) => x.hash))] });
  }
  if (method === "PUT" && pathname.startsWith("/api/vault/import/file/")) {
    // One picture's bytes, checked against its checksum and its kind, then put in.
    const hash = pathname.slice("/api/vault/import/file/".length);
    const id = url.searchParams.get("import") ?? "";
    const info = fileInfo({ path: url.searchParams.get("path"), hash, bytes: Number(request.headers.get("Content-Length") ?? "0") });
    if (!id || !info) return fail(400, "That isn't a picture from the vault.");
    const data = await request.arrayBuffer();
    if (data.byteLength !== info.bytes || data.byteLength > VAULT_LIMITS.fileBytes) return fail(400, "The picture didn't arrive whole.");
    if ((await sha256(data)) !== hash) return fail(400, "The picture didn't arrive whole.");
    const sniffed = sniffImage(new Uint8Array(data, 0, Math.min(32, data.byteLength)));
    if (!sniffed || !Object.values(VAULT_PICTURES).includes(sniffed)) return fail(415, "That isn't a picture Table shows.");
    await env.FILES.put(vaultFileKey(hash), data, { httpMetadata: { contentType: sniffed, cacheControl: "public, max-age=31536000, immutable" } });
    const refusal = await directory.vaultPutFiles(id, [{ ...info, mime: sniffed }]);
    return refusal ? fail(409, refusal) : json({ ok: true });
  }
  // Google Drive: the vault script's address (GET, PUT), and a sync driven by the GM's page (start,
  // notes in batches, pictures a few at a time, then the import's own finish).
  if (pathname === "/api/vault/drive") {
    if (method === "GET") return json({ source: await directory.vaultDriveSource() });
    if (method !== "PUT") return fail(405, "Method not allowed.");
    const body = await readJson(request, 4096);
    const source = typeof body?.source === "string" ? body.source.trim() : "";
    if (source && !SCRIPT_URL.test(source)) return fail(400, "That isn't an Apps Script web app's address: it starts https://script.google.com/macros/s/ and ends /exec.");
    if (source) {
      // Asked once now, so the GM knows at once whether it works.
      const listed = await askDrive(source, await directory.vaultDriveKey(), { list: true });
      if ("error" in listed && typeof listed.error === "string") return fail(502, listed.error);
    }
    await directory.setVaultDriveSource(source || null);
    return json({ source: source || null });
  }
  if (method === "POST" && pathname.startsWith("/api/vault/drive/")) {
    const source = await directory.vaultDriveSource();
    if (!source) return fail(409, "Add your vault script's address first (Google Drive, in Campaign notes).");
    const key = await directory.vaultDriveKey();
    if (pathname === "/api/vault/drive/start") {
      const listed = await askDrive(source, key, { list: true });
      if ("error" in listed && typeof listed.error === "string") return fail(502, listed.error);
      const l = listed as { notes?: unknown[]; files?: unknown[] };
      const notes = (Array.isArray(l.notes) ? l.notes : []).map((x) => driveEntry(x, "note")).filter((x): x is NonNullable<typeof x> => !!x).slice(0, VAULT_LIMITS.notes);
      const files = (Array.isArray(l.files) ? l.files : [])
        .map((x) => driveEntry(x, "picture"))
        .filter((x): x is NonNullable<typeof x> => !!x && x.bytes <= VAULT_LIMITS.fileBytes)
        .slice(0, VAULT_LIMITS.files);
      if (!notes.length) return fail(409, "Your vault folder in Drive has no notes in it: check the script's FOLDER_ID.");
      return json({ import: await directory.vaultStart(), notes: notes.map((n) => n.path), files });
    }
    const body = await readJson(request, 200_000);
    const id = typeof body?.import === "string" ? body.import : "";
    if (!id) return fail(400, "That isn't a sync.");
    if (pathname === "/api/vault/drive/notes") {
      const paths = Array.isArray(body?.paths) ? body.paths.filter((p): p is string => isVaultPath(p) && vaultKind(p) === "note").slice(0, 100) : [];
      const got = await askDrive(source, key, { notes: paths });
      if ("error" in got && typeof got.error === "string") return fail(502, got.error);
      const notes = (Array.isArray((got as { notes?: unknown[] }).notes) ? (got as { notes: unknown[] }).notes : [])
        .map((n) => n as { path?: unknown; body?: unknown })
        .filter((n): n is { path: string; body: string } => isVaultPath(n.path) && vaultKind(n.path) === "note" && typeof n.body === "string")
        .map((n) => ({ path: n.path, body: n.body.slice(0, VAULT_LIMITS.noteBytes) }));
      const refusal = await directory.vaultPutNotes(id, notes);
      return refusal ? fail(409, refusal) : json({ notes: notes.length });
    }
    if (pathname === "/api/vault/drive/files") {
      const list = (Array.isArray(body?.files) ? body.files : []).map((x) => driveEntry(x, "picture")).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 8);
      let fetched = 0;
      let skipped = 0;
      for (const x of list) {
        const ext = x.path.split(".").pop()!.toLowerCase();
        // Unchanged in Drive since it was last fetched: put in as it is.
        const known = await directory.vaultDriveHash(x.path, x.modified);
        if (known) {
          const refusal = await directory.vaultPutFiles(id, [{ path: x.path, hash: known, mime: VAULT_PICTURES[ext], bytes: x.bytes }]);
          if (refusal) return fail(409, refusal);
          continue;
        }
        const got = await askDrive(source, key, { file: x.path });
        const data = "error" in got ? null : typeof (got as { data?: unknown }).data === "string" ? (got as { data: string }).data : null;
        if (!data) {
          skipped++;
          continue;
        }
        const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const sniffed = sniffImage(bin.subarray(0, 32));
        if (bin.byteLength > VAULT_LIMITS.fileBytes || !sniffed || !Object.values(VAULT_PICTURES).includes(sniffed)) {
          skipped++;
          continue;
        }
        const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
        const hash = await sha256(buf);
        await env.FILES.put(vaultFileKey(hash), buf, { httpMetadata: { contentType: sniffed, cacheControl: "public, max-age=31536000, immutable" } });
        const refusal = await directory.vaultPutFiles(id, [{ path: x.path, hash, mime: sniffed, bytes: bin.byteLength }]);
        if (refusal) return fail(409, refusal);
        await directory.vaultDriveRemember(x.path, x.modified, hash);
        fetched++;
      }
      return json({ fetched, skipped });
    }
    return fail(404, "Not found.");
  }
  if (method === "POST" && pathname === "/api/vault/import/finish") {
    const body = await readJson(request, 4096);
    const id = typeof body?.import === "string" ? body.import : "";
    const done = id ? await directory.vaultFinish(id) : null;
    if (!done) return fail(409, "That bringing-in has been overtaken by another. Start again.");
    await Promise.all(done.unused.map((h) => env.FILES.delete(vaultFileKey(h)).catch(() => undefined)));
    return json({ notes: done.notes, files: done.files });
  }
  return fail(404, "Not found.");
}

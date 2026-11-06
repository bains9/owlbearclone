// Backups in the GM's Google Drive, for the GM's start page: where the backup script is, how the
// backups are going, what each one holds, and putting things back. A room goes back beside what's
// there, never over it; the table's parts need a backup from moments ago, so they can be undone.
// Everything's read from Drive: on a Table that's lost everything, its script is all this needs.
import {
  BACKUP_FRESH_MS,
  BACKUP_ID,
  fromBase64,
  isTablePart,
  nightFromName,
  nightName,
  partFiles,
  snapshotName,
  type BackupBucket,
  type BackupFile,
  type BackupManifest,
  type BackupReason,
  type TablePart,
} from "../shared/backups";
import { randomId } from "../shared/ids";
import { LIMITS } from "../shared/sanitize";
import { isGm } from "./auth";
import { askScript, readFromDrive } from "./backupJob";
import { SCRIPT_URL } from "./characters";

const HSTS = "max-age=31536000; includeSubDomains";
const MAX_JSON_BYTES = 16 * 1024;
const ROOM_ID = /^[A-Za-z0-9]{12}$/;
/** Files put back in one request: the page asks for the next few until they're all back. */
const FILES_AT_ONCE = 4;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Strict-Transport-Security": HSTS },
  });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** An Apps Script web app's address; running locally, a stand-in for one on this computer too. */
function scriptAddressOk(source: string, url: URL): boolean {
  return SCRIPT_URL.test(source) || (url.hostname === "localhost" && /^http:\/\/localhost:\d+\/exec$/.test(source));
}

function bucketOf(env: Env, name: BackupBucket): R2Bucket {
  return name === "dungeon-maps" ? env.DUNGEON_MAPS : env.FILES;
}

/** The response for a backup route, or null when the path isn't one. */
export async function backupRoute(request: Request, env: Env, url: URL, method: string): Promise<Response | null> {
  const { pathname } = url;
  if (pathname !== "/api/backups" && !pathname.startsWith("/api/backups/")) return null;
  if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
  const directory = env.DIRECTORY.getByName("main");
  const job = env.BACKUP_JOB.getByName("main");

  if (pathname === "/api/backups") {
    if (method !== "GET") return fail(405, "Method not allowed.");
    return json(await job.status());
  }

  if (pathname === "/api/backups/drive") {
    if (method !== "PUT") return fail(405, "Method not allowed.");
    const body = await readJson(request);
    const source = typeof body?.source === "string" ? body.source.trim() : "";
    if (!source) {
      await directory.setBackupDriveSource(null);
      return json({ source: null });
    }
    if (!scriptAddressOk(source, url)) return fail(400, "That isn't an Apps Script web app's address: it starts https://script.google.com/macros/s/ and ends /exec.");
    // Asking it something is what makes it keep this Table's key, and shows it's set up right.
    try {
      await askScript(source, await directory.backupDriveKey(), { list: true });
    } catch (err) {
      return fail(502, (err as Error).message);
    }
    await directory.setBackupDriveSource(source);
    return json({ source });
  }

  if (pathname === "/api/backups/run") {
    if (method !== "POST") return fail(405, "Method not allowed.");
    const body = await readJson(request);
    const reason: BackupReason = body?.reason === "before a restore" ? "before a restore" : "by hand";
    const begun = await job.begin(reason);
    return json(begun, begun.started || begun.why === "A backup is going already." ? 200 : 409);
  }

  const source = await directory.backupDriveSource();
  if (!source) return fail(409, "Google Drive isn't set up for backups yet.");
  const key = await directory.backupDriveKey();

  if (pathname === "/api/backups/nights") {
    if (method !== "GET") return fail(405, "Method not allowed.");
    // What's in Drive is what there is. What this Table remembers of them only adds detail.
    try {
      const listed = await askScript(source, key, { list: true });
      const known = new Map((await job.summaries()).map((s) => [s.id, s]));
      const ids = (Array.isArray(listed.nights) ? listed.nights : []).map((n) => (typeof n === "string" ? nightFromName(n) : null)).filter((id): id is string => !!id);
      return json(ids.sort().reverse().map((id) => known.get(id) ?? { id }));
    } catch (err) {
      return fail(502, (err as Error).message);
    }
  }

  const night = pathname.match(/^\/api\/backups\/night\/([^/]+)(\/[a-z]+)?$/);
  if (!night || !BACKUP_ID.test(night[1])) return fail(404, "Not found.");
  const id = night[1];
  let manifest: BackupManifest;
  try {
    const got = await askScript(source, key, { kind: "nights", name: nightName(id), read: true });
    manifest = JSON.parse(new TextDecoder().decode(fromBase64(String(got.data)))) as BackupManifest;
  } catch (err) {
    return fail(502, (err as Error).message);
  }
  const sub = night[2] ?? "";

  if (sub === "" && method === "GET") {
    const rooms = await Promise.all(
      manifest.rooms.map(async (r) => ({
        id: r.id,
        name: r.name,
        scenes: r.scenes,
        items: r.items,
        files: manifest.files.filter((f) => f.key.startsWith(`rooms/${r.id}/`)).length,
        here: await env.ROOMS.getByName(r.id).exists(),
      })),
    );
    return json({ id, at: manifest.at, reason: manifest.reason, complete: manifest.complete, missing: manifest.missing, files: manifest.files.length, rooms });
  }
  if (method !== "POST") return fail(405, "Method not allowed.");
  const body = await readJson(request);

  // A room back: under its own id if that's free, so its link works again; beside it if not.
  if (sub === "/room") {
    const room = manifest.rooms.find((r) => r.id === body?.room);
    if (!room) return fail(404, "That room isn't in this backup.");
    const here = await env.ROOMS.getByName(room.id).exists();
    const into = here ? randomId(12) : room.id;
    const name = here ? `${room.name.slice(0, LIMITS.name - 18)} (from ${id.slice(0, 10)})` : room.name;
    try {
      const gz = await readFromDrive(source, key, "snapshots", snapshotName(room.snapshot), room.bytes);
      const info = await env.ROOMS.getByName(into).restoreSnapshot(into, name, gz);
      await directory.removeRoom(into);
      await directory.addRoom(into, name, info.createdAt);
    } catch (err) {
      return fail(502, (err as Error).message);
    }
    return json({ room: into, name, sameLink: !here, files: manifest.files.filter((f) => f.key.startsWith(`rooms/${room.id}/`)).length });
  }

  // Parts of the table back: what's there of them now goes, so a backup from just now must exist.
  if (sub === "/table") {
    const parts = Array.isArray(body?.parts) ? (body.parts as unknown[]).filter(isTablePart) : [];
    if (!parts.length) return fail(400, "Pick something to put back.");
    if (!manifest.table) return fail(409, "That backup didn't get as far as the table's own things.");
    const status = await job.status();
    const fresh = status.lastGoodAt !== null && status.last?.complete && Date.now() - status.lastGoodAt < BACKUP_FRESH_MS;
    if (!fresh) return fail(409, "Take a backup first, so this can be undone.");
    try {
      const gz = await readFromDrive(source, key, "snapshots", snapshotName(manifest.table.snapshot), manifest.table.bytes);
      await directory.restoreParts(gz, parts);
    } catch (err) {
      return fail(502, (err as Error).message);
    }
    return json({ parts, files: filesOfParts(manifest, parts).length });
  }

  // The next few files, for the page to ask until they're all back.
  if (sub === "/files") {
    let list: { file: BackupFile; to: string }[];
    if (typeof body?.room === "string") {
      if (!ROOM_ID.test(body.room) || typeof body.into !== "string" || !ROOM_ID.test(body.into)) return fail(400, "That isn't a room.");
      const from = `rooms/${body.room}/`;
      const into = `rooms/${body.into}/`;
      list = manifest.files.filter((f) => f.key.startsWith(from)).map((file) => ({ file, to: into + file.key.slice(from.length) }));
    } else {
      const parts = Array.isArray(body?.parts) ? (body.parts as unknown[]).filter(isTablePart) : [];
      list = filesOfParts(manifest, parts).map((file) => ({ file, to: file.key }));
    }
    const start = typeof body?.from === "number" && Number.isInteger(body.from) && body.from >= 0 ? body.from : 0;
    let missing = 0;
    for (const { file, to } of list.slice(start, start + FILES_AT_ONCE)) {
      const bucket = bucketOf(env, file.bucket);
      if ((await bucket.head(to))?.etag === file.etag) continue;
      try {
        const bytes = await readFromDrive(source, key, "files", file.etag, file.size);
        await bucket.put(to, bytes, {
          ...(file.type ? { httpMetadata: { contentType: file.type } } : {}),
          ...(file.meta ? { customMetadata: file.meta } : {}),
          // What came back from Drive is what went: R2 refuses it otherwise.
          ...(file.etag.includes("-") ? {} : { md5: file.etag }),
        });
      } catch {
        missing++;
      }
    }
    const next = Math.min(start + FILES_AT_ONCE, list.length);
    return json({ next, total: list.length, missing, done: next >= list.length });
  }

  return fail(404, "Not found.");
}

function filesOfParts(manifest: BackupManifest, parts: TablePart[]): BackupFile[] {
  const where = parts.map(partFiles).filter((w) => w !== null);
  return manifest.files.filter((f) => where.some((w) => w.bucket === f.bucket && f.key.startsWith(w.prefix)));
}

// The nightly backup, into the GM's Google Drive through their backup script (scripts/table-backup.gs).
// Nothing is kept on Cloudflare but the note of how it's going: this only runs here because the data
// is here. One object does it a little at a time on alarms, so it can stop anywhere (a deploy, Google
// saying no for now) and carry on: what's already in Drive is never sent again. Only reads what it
// backs up: the worst it can do to the table is nothing.
import { DurableObject } from "cloudflare:workers";
import { BUILD_ID } from "../shared/build";
import {
  backupId,
  fromBase64,
  nightName,
  partNames,
  PART_BYTES,
  snapshotName,
  toBase64,
  type BackupBucket,
  type BackupFile,
  type BackupManifest,
  type BackupReason,
  type BackupRoom,
  type BackupStage,
  type BackupStatus,
  type BackupSummary,
} from "../shared/backups";

const SCRIPT_MS = 180_000;
/** A little at a time: Apps Script's slow, and an alarm has only so many requests. */
const SENDS_PER_STEP = 12;
const ROOMS_PER_STEP = 3;
const LIST_PAGE = 200;
const NEXT_STEP_MS = 200;
/** After a failure: then an hour apart, up to MAX_TRIES without getting anywhere. */
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000];
const MAX_TRIES = 12;
/** One file that won't go is left out after this many tries, so it can't hold up the rest. */
const SKIP_AFTER = 3;
const ABANDON_MS = 26 * 3600_000;

/** The script's answer, or an error saying what's wrong in words for the GM. */
export async function askScript(source: string, key: string, ask: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(source, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ key, ...ask }),
      redirect: "follow",
      signal: AbortSignal.timeout(SCRIPT_MS),
    });
  } catch {
    throw new Error("Your backup script in Google Drive didn't answer in time.");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new Error("Your backup script in Google Drive didn't answer as it should: check its address, and that it's deployed for Anyone.");
  if (typeof body.error === "string") throw new Error(body.error.slice(0, 200));
  return body;
}

/** Reads a file back from Drive, in its parts if it went in parts. */
export async function readFromDrive(source: string, key: string, kind: "snapshots" | "files", name: string, size: number): Promise<Uint8Array<ArrayBuffer>> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (const part of partNames(name, size)) {
    const got = await askScript(source, key, { kind, name: part, read: true });
    if (typeof got.data !== "string") throw new Error("Your backup script didn't send that file.");
    parts.push(fromBase64(got.data));
  }
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

interface Run {
  id: string;
  at: number;
  reason: BackupReason;
  stage: BackupStage;
  /** Rooms to do, and how far through them. */
  rooms: { id: string; name: string; createdAt: number; lastUsed: number }[];
  roomAt: number;
  table: { snapshot: string; bytes: number } | null;
  /** Which bucket's being read, and the last key done in it. */
  bucket: number;
  after: string | null;
  /** Bytes sent to Drive, files looked at, files that wouldn't go. */
  sent: number;
  seen: number;
  missing: number;
  /** Failures in a row without getting anywhere, and on which file. */
  tries: number;
  failing: string | null;
  lastError: string | null;
  /** Why a file was left out. */
  missingWhy: string | null;
}

export class BackupJob extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
      // What's in Drive (as of this run's start, and sent since), and what this run has seen.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS have (name TEXT PRIMARY KEY)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS run_rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS run_files (bucket TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (bucket, key))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    });
  }

  private get<T>(k: string): T | null {
    const row = this.sql.exec<{ v: string }>(`SELECT v FROM kv WHERE k = ?`, k).toArray()[0];
    return row ? (JSON.parse(row.v) as T) : null;
  }

  private set(k: string, v: unknown): void {
    if (v === null) this.sql.exec(`DELETE FROM kv WHERE k = ?`, k);
    else this.sql.exec(`INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)`, k, JSON.stringify(v));
  }

  private buckets(): { name: BackupBucket; r2: R2Bucket }[] {
    return [
      { name: "tabletop-files", r2: this.env.FILES },
      { name: "dungeon-maps", r2: this.env.DUNGEON_MAPS },
    ];
  }

  private directory() {
    return this.env.DIRECTORY.getByName("main");
  }

  /** Starts a backup, unless one's going or there's nowhere to put it. */
  async begin(reason: BackupReason, now = Date.now()): Promise<{ started: boolean; why?: string }> {
    const source = await this.directory().backupDriveSource();
    if (!source) return { started: false, why: "Google Drive isn't set up for backups yet." };
    const going = this.get<Run>("run");
    if (going && now - going.at < ABANDON_MS) {
      // One whose alarm has somehow gone carries on.
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now);
      return { started: false, why: "A backup is going already." };
    }
    const rooms = await this.directory().listRooms();
    const run: Run = {
      id: backupId(now),
      at: now,
      reason,
      stage: "list",
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, lastUsed: r.lastUsed })),
      roomAt: 0,
      table: null,
      bucket: 0,
      after: null,
      sent: 0,
      seen: 0,
      missing: 0,
      tries: 0,
      failing: null,
      lastError: null,
      missingWhy: null,
    };
    this.sql.exec(`DELETE FROM have`);
    this.sql.exec(`DELETE FROM run_rooms`);
    this.sql.exec(`DELETE FROM run_files`);
    this.set("run", run);
    await this.ctx.storage.setAlarm(now);
    return { started: true };
  }

  /** How it's going, for the GM's start page. */
  async status(): Promise<BackupStatus> {
    const run = this.get<Run>("run");
    return {
      source: await this.directory().backupDriveSource(),
      running: run ? { id: run.id, at: run.at, reason: run.reason, stage: run.stage, sent: run.sent, seen: run.seen, retrying: run.tries ? run.lastError : null } : null,
      last: this.get<BackupSummary>("last"),
      lastGoodAt: this.get<number>("last_good"),
      error: this.get<string>("error"),
    };
  }

  /** The backups this object remembers making, newest first. */
  summaries(): BackupSummary[] {
    return this.sql
      .exec<{ data: string }>(`SELECT data FROM history ORDER BY id DESC`)
      .toArray()
      .map((r) => JSON.parse(r.data) as BackupSummary);
  }

  async alarm(): Promise<void> {
    const run = this.get<Run>("run");
    if (!run) return;
    const directory = this.directory();
    const source = await directory.backupDriveSource();
    if (!source) {
      this.fail(run, "Google Drive was unlinked during the backup.");
      return;
    }
    const key = await directory.backupDriveKey();
    // Getting somewhere: a file done, not one left out.
    const before = `${run.stage}|${run.roomAt}|${run.bucket}|${run.seen}`;
    try {
      await this.step(run, source, key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const moved = before !== `${run.stage}|${run.roomAt}|${run.bucket}|${run.seen}`;
      run.tries = moved ? 1 : run.tries + 1;
      run.lastError = message;
      if (run.tries >= MAX_TRIES) {
        await this.finish(run, source, key, message);
        return;
      }
      this.set("run", run);
      await this.ctx.storage.setAlarm(Date.now() + RETRY_MS[Math.min(run.tries - 1, RETRY_MS.length - 1)]);
      return;
    }
    run.tries = 0;
    run.failing = null;
    run.lastError = null;
    if (!this.get<Run>("run")) return;
    this.set("run", run);
    await this.ctx.storage.setAlarm(Date.now() + NEXT_STEP_MS);
  }

  private async step(run: Run, source: string, key: string): Promise<void> {
    if (run.stage === "list") {
      const listed = await askScript(source, key, { list: true });
      for (const kind of ["snapshots", "files"]) {
        const names = listed[kind];
        if (!Array.isArray(names)) throw new Error("Your backup script didn't list what's in Drive.");
        for (const name of names) if (typeof name === "string") this.sql.exec(`INSERT OR IGNORE INTO have (name) VALUES (?)`, name);
      }
      // Named to the minute, and Drive keeps the first of a name: one soon after another takes the next minute.
      const nights = new Set(Array.isArray(listed.nights) ? listed.nights : []);
      for (let at = run.at; nights.has(nightName(run.id)); ) {
        at += 60_000;
        run.id = backupId(at);
      }
      run.stage = "table";
    } else if (run.stage === "table") {
      const packed = await this.directory().backupSnapshot();
      await this.sendSnapshot(run, source, key, packed);
      run.table = { snapshot: packed.sha, bytes: packed.bytes };
      run.stage = "rooms";
    } else if (run.stage === "rooms") {
      for (const room of run.rooms.slice(run.roomAt, run.roomAt + ROOMS_PER_STEP)) {
        const packed = await this.env.ROOMS.getByName(room.id).backupSnapshot();
        if (packed) {
          await this.sendSnapshot(run, source, key, packed);
          const entry: BackupRoom = { ...room, snapshot: packed.sha, bytes: packed.bytes, scenes: packed.scenes, items: packed.items };
          this.sql.exec(`INSERT OR REPLACE INTO run_rooms (id, data) VALUES (?, ?)`, room.id, JSON.stringify(entry));
        }
        run.roomAt++;
        this.set("run", run);
      }
      if (run.roomAt >= run.rooms.length) run.stage = "files";
    } else if (run.stage === "files") {
      await this.stepFiles(run, source, key);
    } else {
      await this.finish(run, source, key, null);
    }
  }

  /** The next files in the bucket: those not in Drive are sent, a few at a time. */
  private async stepFiles(run: Run, source: string, key: string): Promise<void> {
    const buckets = this.buckets();
    const bucket = buckets[run.bucket];
    const page = await bucket.r2.list({ limit: LIST_PAGE, include: ["httpMetadata", "customMetadata"], ...(run.after ? { startAfter: run.after } : {}) });
    let sends = 0;
    for (const object of page.objects) {
      if (sends >= SENDS_PER_STEP) return;
      if (run.failing === object.key && run.tries >= SKIP_AFTER) {
        // It won't go: the rest shouldn't wait for it. This night's list says so.
        run.missing++;
        run.missingWhy = run.lastError;
        run.after = object.key;
        run.failing = null;
        this.set("run", run);
        continue;
      }
      run.failing = object.key;
      sends += await this.sendObject(run, source, key, bucket, object);
      run.seen++;
      run.after = object.key;
      this.set("run", run);
    }
    if (page.truncated && page.objects.length) return;
    run.bucket++;
    run.after = null;
    if (run.bucket >= buckets.length) run.stage = "manifest";
  }

  /** A bucket's file: noted for the night's list, and sent unless Drive has it. How many sends that took. */
  private async sendObject(run: Run, source: string, key: string, bucket: { name: BackupBucket; r2: R2Bucket }, object: R2Object): Promise<number> {
    const file: BackupFile = { bucket: bucket.name, key: object.key, etag: object.etag, size: object.size };
    if (object.httpMetadata?.contentType) file.type = object.httpMetadata.contentType;
    if (object.customMetadata && Object.keys(object.customMetadata).length) file.meta = object.customMetadata;
    const names = partNames(object.etag, object.size);
    let sends = 0;
    for (let i = 0; i < names.length; i++) {
      if (this.sql.exec(`SELECT 1 FROM have WHERE name = ?`, names[i]).toArray().length) continue;
      const offset = i * PART_BYTES;
      const got = await bucket.r2.get(object.key, names.length > 1 ? { range: { offset, length: Math.min(PART_BYTES, object.size - offset) } } : {});
      // Gone since it was listed: not part of tonight.
      if (!got) return sends;
      const bytes = new Uint8Array(await got.arrayBuffer());
      await this.sendOne(run, source, key, "files", names[i], file.type ?? "application/octet-stream", bytes, names.length === 1 && !object.etag.includes("-") ? object.etag : null);
      sends++;
    }
    this.sql.exec(`INSERT OR REPLACE INTO run_files (bucket, key, data) VALUES (?, ?, ?)`, bucket.name, object.key, JSON.stringify(file));
    return sends;
  }

  /** A room's or the table's contents, in parts if it's that big, unless Drive has it from a night it was the same. */
  private async sendSnapshot(run: Run, source: string, key: string, packed: { sha: string; gz: Uint8Array }): Promise<void> {
    const names = partNames(snapshotName(packed.sha), packed.gz.length);
    for (let i = 0; i < names.length; i++) {
      if (this.sql.exec(`SELECT 1 FROM have WHERE name = ?`, names[i]).toArray().length) continue;
      await this.sendOne(run, source, key, "snapshots", names[i], "application/gzip", packed.gz.subarray(i * PART_BYTES, (i + 1) * PART_BYTES), null);
    }
  }

  /** One file to Drive, checking what arrived is what was sent. */
  private async sendOne(run: Run, source: string, key: string, kind: string, name: string, mime: string, bytes: Uint8Array, md5: string | null): Promise<void> {
    const put = await askScript(source, key, { kind, name, mime, bytes: bytes.length, ...(md5 ? { md5 } : {}), data: toBase64(bytes) });
    if (put.bytes !== bytes.length || (md5 && put.md5 !== md5)) throw new Error(`What reached Google Drive of ${name} wasn't what was sent.`);
    run.sent += bytes.length;
    this.sql.exec(`INSERT OR IGNORE INTO have (name) VALUES (?)`, name);
  }

  /** The night's list, and the end of the run: with `problem`, one that didn't get everything in. */
  private async finish(run: Run, source: string, key: string, problem: string | null): Promise<void> {
    const rooms = this.sql
      .exec<{ data: string }>(`SELECT data FROM run_rooms`)
      .toArray()
      .map((r) => JSON.parse(r.data) as BackupRoom);
    const files = this.sql
      .exec<{ data: string }>(`SELECT data FROM run_files`)
      .toArray()
      .map((r) => JSON.parse(r.data) as BackupFile);
    const complete = !problem && run.missing === 0;
    let error = problem;
    if (run.missing && !problem) error = `${run.missing} file${run.missing === 1 ? "" : "s"} wouldn't go to Google Drive: ${run.missingWhy ?? "no reason given"}`;
    // Nothing's worth listing until the table's own snapshot is in.
    let written = false;
    if (run.table) {
      const manifest: BackupManifest = {
        format: "table-backup",
        version: 1,
        id: run.id,
        at: run.at,
        finishedAt: Date.now(),
        reason: run.reason,
        build: BUILD_ID,
        complete,
        missing: run.missing,
        table: run.table,
        rooms,
        files,
      };
      try {
        await askScript(source, key, { kind: "nights", name: nightName(run.id), mime: "application/json", data: toBase64(new TextEncoder().encode(JSON.stringify(manifest, null, 1))) });
        written = true;
      } catch (err) {
        // An ordinary run tries again; one already failing just says so.
        if (!problem) throw err;
      }
    }
    if (written) {
      const summary: BackupSummary = {
        id: run.id,
        at: run.at,
        reason: run.reason,
        complete,
        missing: run.missing,
        rooms: rooms.length,
        files: files.length,
        bytes: files.reduce((n, f) => n + f.size, 0) + rooms.reduce((n, r) => n + r.bytes, 0) + (run.table?.bytes ?? 0),
        sent: run.sent,
      };
      this.sql.exec(`INSERT OR REPLACE INTO history (id, data) VALUES (?, ?)`, run.id, JSON.stringify(summary));
      this.set("last", summary);
    }
    if (complete && written) this.set("last_good", Date.now());
    this.set("error", error);
    this.end();
  }

  private fail(run: Run, problem: string): void {
    this.set("error", `${run.id}: ${problem}`);
    this.end();
  }

  private end(): void {
    this.set("run", null);
    this.sql.exec(`DELETE FROM have`);
    this.sql.exec(`DELETE FROM run_rooms`);
    this.sql.exec(`DELETE FROM run_files`);
  }
}

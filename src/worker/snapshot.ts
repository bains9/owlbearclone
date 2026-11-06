// A Durable Object's tables as one gzipped file, for the backups in Google Drive (backupJob.ts), and
// back. Every table is taken unless it's named as left out, so a table added later is in the backups
// without anyone having to remember. Its name in Drive is the checksum of its contents: unchanged
// since last night, it's already there.
import { fromBase64, toBase64 } from "../shared/backups";

export interface Snapshot {
  format: "table-snapshot";
  version: 1;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface Packed {
  sha: string;
  gz: Uint8Array<ArrayBuffer>;
  /** Its size in Drive. */
  bytes: number;
}

const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

/** Every table's rows, but those left out, at this moment: nothing can come between the reads. */
export function readTables(sql: SqlStorage, leaveOut: ReadonlySet<string>): Snapshot {
  const tables: Snapshot["tables"] = {};
  const names = sql.exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).toArray();
  for (const { name } of names) {
    // SQLite's and Cloudflare's own (sqlite_sequence, _cf_KV) aren't ours to keep.
    if (!TABLE_NAME.test(name) || name.startsWith("sqlite_") || leaveOut.has(name)) continue;
    tables[name] = sql.exec(`SELECT * FROM "${name}"`).toArray() as Record<string, unknown>[];
  }
  return { format: "table-snapshot", version: 1, tables };
}

/** Puts rows in a table as it is now: what's left out of the table since isn't asked for. A table gone since is skipped. */
export function writeRows(sql: SqlStorage, table: string, rows: Record<string, unknown>[]): void {
  if (!TABLE_NAME.test(table) || !rows.length) return;
  const columns = new Set(
    sql
      .exec<{ name: string }>(`PRAGMA table_info("${table}")`)
      .toArray()
      .map((c) => c.name),
  );
  if (!columns.size) return;
  for (const row of rows) {
    const keys = Object.keys(row).filter((k) => columns.has(k));
    if (!keys.length) continue;
    sql.exec(`INSERT OR REPLACE INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => row[k] as SqlStorageValue));
  }
}

async function collect(stream: ReadableStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function pack(snapshot: Snapshot): Promise<Packed> {
  const text = JSON.stringify(snapshot, (_k, v: unknown) => (v instanceof ArrayBuffer ? { $b64: toBase64(new Uint8Array(v)) } : v));
  const raw = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const gz = await collect(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")));
  return { sha: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""), gz, bytes: gz.length };
}

export async function unpack(gz: Uint8Array<ArrayBuffer>): Promise<Snapshot> {
  const raw = await collect(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip")));
  const snapshot = JSON.parse(new TextDecoder().decode(raw), (_k, v: unknown) => {
    if (v && typeof v === "object" && typeof (v as { $b64?: unknown }).$b64 === "string") return fromBase64((v as { $b64: string }).$b64).buffer;
    return v;
  }) as Snapshot;
  if (snapshot?.format !== "table-snapshot" || !snapshot.tables) throw new Error("That isn't one of Table's backups.");
  return snapshot;
}

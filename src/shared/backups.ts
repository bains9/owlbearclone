// Backups in the GM's Google Drive (scripts/table-backup.gs), kept there and nowhere on Cloudflare.
// Each night, one list (the night's manifest) of what the table held, with the contents of each room
// and of the table as gzipped snapshots, and each picture and map kept once, by its checksum. What
// hasn't changed since the last night is already in Drive, and isn't sent again.

/** A file bigger than this goes in parts: Apps Script takes 50 MB in a request, and base64 adds a third. */
export const PART_BYTES = 20 * 1024 * 1024;
export const BACKUP_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}Z$/;
/** The GM's start page warns when the last good backup is older than this: a night has been missed. */
export const BACKUP_STALE_MS = 36 * 3600_000;
/** Putting table-wide things back needs a backup this recent, so it can itself be undone. */
export const BACKUP_FRESH_MS = 30 * 60_000;

export type BackupReason = "nightly" | "by hand" | "before a restore";
export type BackupBucket = "tabletop-files" | "dungeon-maps";

/** What can be put back for the whole table (rooms are put back one at a time). */
export type TablePart = "calendar" | "library" | "notes" | "characters" | "dungeon";
export const TABLE_PARTS: { id: TablePart; label: string }[] = [
  { id: "calendar", label: "The calendar" },
  { id: "library", label: "Your monsters and NPCs" },
  { id: "notes", label: "Campaign notes" },
  { id: "characters", label: "Characters' figures, dice and who plays them" },
  { id: "dungeon", label: "Dungeon's maps" },
];

export function isTablePart(v: unknown): v is TablePart {
  return TABLE_PARTS.some((p) => p.id === v);
}

/** Where each part's files are, for putting them back. */
export function partFiles(part: TablePart): { bucket: BackupBucket; prefix: string } | null {
  if (part === "library") return { bucket: "tabletop-files", prefix: "library/" };
  if (part === "notes") return { bucket: "tabletop-files", prefix: "vault/" };
  if (part === "characters") return { bucket: "tabletop-files", prefix: "characters/" };
  if (part === "dungeon") return { bucket: "dungeon-maps", prefix: "" };
  return null;
}

export interface BackupFile {
  bucket: BackupBucket;
  key: string;
  etag: string;
  size: number;
  type?: string;
  meta?: Record<string, string>;
  /** Encrypted in Drive, under sealedName: a campaign note's picture. */
  sealed?: boolean;
}

export interface BackupRoom {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number;
  snapshot: string;
  bytes: number;
  scenes: number;
  items: number;
}

/** One night's list, as kept in Drive. */
export interface BackupManifest {
  format: "table-backup";
  version: 1;
  id: string;
  at: number;
  finishedAt: number;
  reason: BackupReason;
  build: string;
  /** Every file went in: false when some couldn't, `missing` of them. */
  complete: boolean;
  missing: number;
  table: { snapshot: string; bytes: number } | null;
  rooms: BackupRoom[];
  files: BackupFile[];
}

/** A backup at a glance: what the start page shows of the last one and the list. */
export interface BackupSummary {
  id: string;
  at: number;
  reason: BackupReason;
  complete: boolean;
  missing: number;
  rooms: number;
  files: number;
  /** Bytes it held, and what had to be sent to Drive for it. */
  bytes: number;
  sent: number;
}

export interface BackupStatus {
  /** The backup script's address, or null before it's set up. */
  source: string | null;
  running: { id: string; at: number; reason: BackupReason; stage: BackupStage; sent: number; seen: number; retrying: string | null } | null;
  last: BackupSummary | null;
  /** When the last one that had everything in finished. */
  lastGoodAt: number | null;
  error: string | null;
}

export type BackupStage = "list" | "table" | "rooms" | "files" | "manifest";

/** What the room's or table's backup-to-be is called in Drive. */
export function snapshotName(sha: string): string {
  return `${sha}.json.gz`;
}

export function nightName(id: string): string {
  return `${id}.json`;
}

/** What an encrypted file's called in Drive: never the name a plain copy from an older backup may have. */
export function sealedName(etag: string): string {
  return `${etag}.sealed`;
}

/** A campaign note's picture, which is encrypted in the backups like the note itself. */
export function isNotePicture(bucket: BackupBucket, key: string): boolean {
  return bucket === "tabletop-files" && key.startsWith("vault/");
}

export function backupId(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16).replace(":", "-")}Z`;
}

/** A backup's id from its file's name in Drive, or null for anything else. */
export function nightFromName(name: string): string | null {
  const id = name.replace(/\.json$/, "");
  return BACKUP_ID.test(id) && name !== id ? id : null;
}

/** What a file of this size is called in Drive: the one name, or a name for each part. */
export function partNames(name: string, size: number): string[] {
  const parts = Math.ceil(size / PART_BYTES);
  if (parts <= 1) return [name];
  return Array.from({ length: parts }, (_, i) => `${name}.p${String(i).padStart(3, "0")}`);
}

/** Any of it as base64, in pieces of a size that join up into one. */
export function toBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 32766) {
    out.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 32766))));
  }
  return out.join("");
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

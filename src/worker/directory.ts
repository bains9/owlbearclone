// The single Directory object: the GM's room list, login throttling, and the
// random secret that GM session cookies are signed with.

import { SAVED_LIMITS, freshCopy, type TokenStats } from "../shared/tokenStats";
import type { TablePart } from "../shared/backups";
import { openJson, sealJson } from "./seal";
import { pack, readTables, unpack, writeRows, type Packed, type Snapshot } from "./snapshot";
import { DurableObject } from "cloudflare:workers";
import type { RoomSummary } from "../shared/types";
import { MAX_PRAYED_SPELLS } from "../shared/characters";
import { MAX_LIBRARY, MAX_LIBRARY_BYTES, isShelf, type LibraryEntry, type Shelf } from "../shared/library";
import { VAULT_LIMITS, noteTitle, type VaultFileInfo, type VaultIndex, type VaultSearchHit } from "../shared/vault";

/** Where the one vault brought in before there were several went (Directory.moveOneVault). */
export const LEGACY_VAULT = "First vault";

const FAILURE_WINDOW_MS = 15 * 60_000;
/** Wrong passwords allowed per address (an IPv6 /64 counts as one address) per window. */
const MAX_FAILURES = 10;
/**
 * Wrong passwords allowed from everywhere together per window, so spreading guesses
 * over many addresses doesn't help. Reaching it only stops new sign-ins for the rest
 * of the window; anyone already signed in stays signed in.
 */
const MAX_GLOBAL_FAILURES = 60;
const GLOBAL_KEY = "*";
/** An address that signed in successfully this recently isn't held to the global cap. */
const TRUSTED_MS = 90 * 86400_000;
/** Who plays whom is kept for this many browsers, the latest to pick (anyone with a room link can pick). */
const MAX_CHARACTER_PLAYERS = 60;

type LibraryRow = {
  id: string;
  shelf: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  created_at: number;
};

function libraryEntryOf(r: LibraryRow): LibraryEntry {
  return {
    id: r.id,
    shelf: isShelf(r.shelf) ? r.shelf : "monster",
    name: r.name,
    mime: r.mime,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    createdAt: r.created_at,
  };
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Never in a backup: the sign-in key and the keys and addresses of the GM's scripts, which are safer
 * made again than kept in a file; and who's tried signing in lately. All of it comes back by itself
 * or by pasting a script's address in again.
 */
export const NOT_BACKED_UP: ReadonlySet<string> = new Set(["secrets", "login_failures", "trusted_logins", "spent_hops"]);

/** What each part of the table is, for putting one back from a backup. (Rooms go back one at a time; the rooms table only lists them.) */
export const PART_TABLES: Record<TablePart, { tables: string[]; blob?: (name: string) => boolean }> = {
  calendar: { tables: [], blob: (name) => name === "calendar" },
  library: { tables: ["library", "creature_stats"] },
  notes: { tables: ["vnotes", "vfiles", "vdrive"], blob: (name) => name.startsWith("vault_") },
  characters: {
    tables: ["character_figures", "character_str_matched", "character_players", "character_prayed", "character_dice"],
    blob: (name) => name === "gm_dice",
  },
  // Only files.
  dungeon: { tables: [] },
};

export class Directory extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS login_failures (
        ip TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        failures INTEGER NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS trusted_logins (ip TEXT PRIMARY KEY, last_ok INTEGER NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS spent_hops (nonce TEXT PRIMARY KEY, exp INTEGER NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS character_figures (sheet_id TEXT PRIMARY KEY, figure TEXT NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS character_str_matched (sheet_id TEXT NOT NULL, weapon TEXT NOT NULL, PRIMARY KEY (sheet_id, weapon))`);
      // Who plays whom: a browser (its player id) and the character it plays, with the name it joined under.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS character_players (user_id TEXT PRIMARY KEY, sheet_id TEXT NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL)`);
      // The spells a character has prayed for (or memorised) today, and how many casts each has left.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS character_prayed (sheet_id TEXT NOT NULL, spell TEXT NOT NULL, left INTEGER NOT NULL, PRIMARY KEY (sheet_id, spell))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS blobs (name TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL)`);
      // Each character's dice (shared/diceSets.ts): one character to a set; none kept is Classic.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS character_dice (sheet_id TEXT PRIMARY KEY, dice TEXT NOT NULL UNIQUE)`);
      // The GM's own monsters and NPCs, for every room (shared/library.ts); their pictures are in R2.
      // What each kind of creature starts with, in every room (shared/tokenStats.ts).
      this.sql.exec(`CREATE TABLE IF NOT EXISTS creature_stats (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS library (
        id TEXT PRIMARY KEY,
        shelf TEXT NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      // The GM's campaign notes (shared/vault.ts), by vault: each note's text, and each picture's
      // checksum (its copy is in R2), with the import that brought it; and the pictures fetched from
      // Google Drive, with when each had last changed there.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS vnotes (vault TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, import TEXT NOT NULL, PRIMARY KEY (vault, path))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS vfiles (vault TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, import TEXT NOT NULL, PRIMARY KEY (vault, path))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS vdrive (vault TEXT NOT NULL, path TEXT NOT NULL, modified INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (vault, path))`);
      this.moveOneVault();
    });
  }

  sessionSecret(): string {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'session'`).toArray()[0];
    if (row) return row.value;
    const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('session', ?)`, value);
    return value;
  }

  /**
   * The key Tabletop sends with a change to a character sheet (spell points spent): the GM's
   * script keeps the first it's sent and takes changes with that key only. Made once.
   */
  charactersKey(): string {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'characters_key'`).toArray()[0];
    if (row) return row.value;
    const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('characters_key', ?)`, value);
    return value;
  }

  /**
   * Spends one of Dungeon's one-time sign-in codes (dungeon.ts): false if it was spent
   * already. A code lasts a minute, so its row only has to outlive that.
   */
  spendHop(nonce: string, exp: number): boolean {
    this.sql.exec(`DELETE FROM spent_hops WHERE exp < ?`, Date.now());
    if (this.sql.exec(`SELECT 1 FROM spent_hops WHERE nonce = ?`, nonce).toArray().length) return false;
    this.sql.exec(`INSERT INTO spent_hops (nonce, exp) VALUES (?, ?)`, nonce, exp);
    return true;
  }

  /** Where the party's character sheets are read from: the GM's Apps Script web app (worker/characters.ts), or null. */
  charactersSource(): string | null {
    return this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'characters_source'`).toArray()[0]?.value ?? null;
  }

  setCharactersSource(source: string | null): void {
    this.sql.exec(`DELETE FROM secrets WHERE name = 'characters_source'`);
    if (source) this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('characters_source', ?)`, source);
  }

  /** The figures the GM chose for characters instead of their class's, by sheet id (worker/characters.ts). */
  characterFigures(): Record<string, string> {
    const rows = this.sql.exec<{ sheet_id: string; figure: string }>(`SELECT sheet_id, figure FROM character_figures`).toArray();
    return Object.fromEntries(rows.map((r) => [r.sheet_id, r.figure]));
  }

  /** The ranged weapons the GM marked as matched to a character's strength, by sheet id (worker/characters.ts). */
  characterStrMatched(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const r of this.sql.exec<{ sheet_id: string; weapon: string }>(`SELECT sheet_id, weapon FROM character_str_matched ORDER BY weapon`)) {
      (out[r.sheet_id] ??= []).push(r.weapon);
    }
    return out;
  }

  /** Marks one of a character's ranged weapons as matched to their strength, or not, for every room (up to 12 a character). */
  setCharacterStrMatched(sheetId: string, weapon: string, matched: boolean): void {
    this.sql.exec(`DELETE FROM character_str_matched WHERE sheet_id = ? AND weapon = ?`, sheetId, weapon);
    if (!matched) return;
    const n = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM character_str_matched WHERE sheet_id = ?`, sheetId).one().n;
    if (n < 12) this.sql.exec(`INSERT INTO character_str_matched (sheet_id, weapon) VALUES (?, ?)`, sheetId, weapon);
  }

  /** A character's figure for every room; null goes back to their class's. */
  setCharacterFigure(sheetId: string, figure: string | null): void {
    this.sql.exec(`DELETE FROM character_figures WHERE sheet_id = ?`, sheetId);
    if (figure) this.sql.exec(`INSERT INTO character_figures (sheet_id, figure) VALUES (?, ?)`, sheetId, figure);
  }

  /** The GM's own monsters and NPCs (shared/library.ts), newest first. */
  /** The stats each kind of creature starts with, by its key (creatureKey). */
  creatureStatsAll(): Record<string, TokenStats> {
    const out: Record<string, TokenStats> = {};
    for (const r of this.sql.exec<{ id: string; data: string }>(`SELECT id, data FROM creature_stats`)) out[r.id] = JSON.parse(r.data) as TokenStats;
    return out;
  }

  /** Saves what a kind of creature starts with (null forgets it): unhurt. False when there's no room for another kind. */
  setCreatureStats(key: string, stats: TokenStats | null): boolean {
    if (!stats) {
      this.sql.exec(`DELETE FROM creature_stats WHERE id = ?`, key);
      return true;
    }
    const known = this.sql.exec(`SELECT 1 FROM creature_stats WHERE id = ?`, key).toArray().length > 0;
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM creature_stats`).one().n;
    if (!known && count >= SAVED_LIMITS.kinds) return false;
    this.sql.exec(`INSERT OR REPLACE INTO creature_stats (id, data) VALUES (?, ?)`, key, JSON.stringify(freshCopy(stats)));
    return true;
  }

  libraryList(): LibraryEntry[] {
    return this.sql.exec<LibraryRow>(`SELECT * FROM library ORDER BY created_at DESC, id`).toArray().map(libraryEntryOf);
  }

  libraryEntry(id: string): LibraryEntry | null {
    const row = this.sql.exec<LibraryRow>(`SELECT * FROM library WHERE id = ?`, id).toArray()[0];
    return row ? libraryEntryOf(row) : null;
  }

  /** Why the library can't take `count` more pictures of `bytes` in all, or null if it can. */
  libraryRefusal(count: number, bytes: number): string | null {
    const have = this.sql.exec<{ n: number; b: number | null }>(`SELECT COUNT(*) AS n, SUM(bytes) AS b FROM library`).one();
    if (have.n + count > MAX_LIBRARY || (have.b ?? 0) + bytes > MAX_LIBRARY_BYTES) {
      return "Your monsters and NPCs are as many as the library holds. Remove some first.";
    }
    return null;
  }

  /** Files pictures (already in R2) in the library: all, or none and the refusal when they don't fit. */
  addLibraryEntries(entries: LibraryEntry[]): string | null {
    const refusal = this.libraryRefusal(entries.length, entries.reduce((n, e) => n + e.bytes, 0));
    if (refusal) return refusal;
    for (const e of entries) {
      this.sql.exec(
        `INSERT INTO library (id, shelf, name, mime, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id,
        e.shelf,
        e.name,
        e.mime,
        e.width,
        e.height,
        e.bytes,
        e.createdAt,
      );
    }
    return null;
  }

  /** Renames an entry, or moves it to the other shelf: the entry now, or null if it isn't there. */
  updateLibraryEntry(id: string, change: { name?: string; shelf?: Shelf }): LibraryEntry | null {
    const was = this.libraryEntry(id);
    if (!was) return null;
    const next = { ...was, ...(change.name ? { name: change.name } : {}), ...(change.shelf ? { shelf: change.shelf } : {}) };
    this.sql.exec(`UPDATE library SET name = ?, shelf = ? WHERE id = ?`, next.name, next.shelf, id);
    return next;
  }

  /** Takes an entry out of the library: what it was, or null if it wasn't there. */
  removeLibraryEntry(id: string): LibraryEntry | null {
    const was = this.libraryEntry(id);
    if (was) this.sql.exec(`DELETE FROM library WHERE id = ?`, id);
    return was;
  }

  /** The villains' dice the GM picked for their own rolls (shared/diceSets.ts), or null before they pick. */
  gmDice(): string | null {
    return this.sql.exec<{ value: string }>(`SELECT value FROM blobs WHERE name = 'gm_dice'`).toArray()[0]?.value ?? null;
  }

  setGmDice(dice: string): void {
    this.sql.exec(
      `INSERT INTO blobs (name, value, version) VALUES ('gm_dice', ?, 1) ON CONFLICT(name) DO UPDATE SET value = excluded.value, version = version + 1`,
      dice,
    );
  }

  /**
   * Before there were several vaults (4 November 2026, an hour), the one vault brought in was kept
   * without a name: it moves to LEGACY_VAULT, and the first vault brought in after that shares most
   * of its notes takes its place (vaultFinish).
   */
  private moveOneVault(): void {
    const old = this.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vault_notes'`).toArray().length;
    if (!old) return;
    const notes = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM vault_notes`).one().n;
    if (notes) {
      this.sql.exec(`INSERT OR IGNORE INTO vnotes (vault, path, body, import) SELECT ?, path, body, import FROM vault_notes`, LEGACY_VAULT);
      this.sql.exec(`INSERT OR IGNORE INTO vfiles (vault, path, hash, mime, bytes, import) SELECT ?, path, hash, mime, bytes, import FROM vault_files`, LEGACY_VAULT);
      const at = this.sql.exec<{ value: string }>(`SELECT value FROM blobs WHERE name = 'vault_at'`).toArray()[0]?.value;
      if (at) this.setBlob(`vault_at:${LEGACY_VAULT}`, at);
      this.setBlob("vault_legacy", LEGACY_VAULT);
    }
    this.sql.exec(`DROP TABLE IF EXISTS vault_notes`);
    this.sql.exec(`DROP TABLE IF EXISTS vault_files`);
    this.sql.exec(`DROP TABLE IF EXISTS vault_drive`);
    this.sql.exec(`DELETE FROM blobs WHERE name IN ('vault_at', 'vault_import')`);
  }

  private setBlob(name: string, value: string): void {
    this.sql.exec(`INSERT INTO blobs (name, value, version) VALUES (?, ?, 1) ON CONFLICT(name) DO UPDATE SET value = excluded.value, version = version + 1`, name, value);
  }

  private blob(name: string): string | null {
    return this.sql.exec<{ value: string }>(`SELECT value FROM blobs WHERE name = ?`, name).toArray()[0]?.value ?? null;
  }

  /** Every vault (its name, when it was brought in, its notes), the notes (no texts) and the pictures. */
  vaultIndex(): VaultIndex {
    const notes = this.sql
      .exec<{ vault: string; path: string; size: number }>(`SELECT vault, path, length(body) AS size FROM vnotes ORDER BY vault COLLATE NOCASE, path COLLATE NOCASE`)
      .toArray()
      .map((r) => ({ vault: r.vault, path: r.path, title: noteTitle(r.path), size: r.size }));
    const files = this.sql
      .exec<{ vault: string; path: string; hash: string; mime: string; bytes: number }>(`SELECT vault, path, hash, mime, bytes FROM vfiles ORDER BY vault, path`)
      .toArray()
      .map((r) => ({ ...r }));
    const names = [...new Set(notes.map((n) => n.vault))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const vaults = names.map((name) => {
      const at = this.blob(`vault_at:${name}`);
      return { name, importedAt: at ? Number(at) : null, notes: notes.filter((n) => n.vault === name).length };
    });
    return { vaults, notes, files };
  }

  vaultNote(vault: string, path: string): string | null {
    return this.sql.exec<{ body: string }>(`SELECT body FROM vnotes WHERE vault = ? AND path = ?`, vault, path).toArray()[0]?.body ?? null;
  }

  /** Notes whose title or text holds `q` (any case), in one vault or all, with a snippet around it; at most 60. */
  vaultSearch(q: string, vault: string | null): VaultSearchHit[] {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.sql
      .exec<{ vault: string; path: string; body: string }>(
        `SELECT vault, path, body FROM vnotes WHERE (? IS NULL OR vault = ?) AND (path LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ORDER BY vault COLLATE NOCASE, path COLLATE NOCASE LIMIT 60`,
        vault,
        vault,
        like,
        like,
      )
      .toArray();
    const low = q.toLowerCase();
    return rows.map((r) => {
      const at = r.body.toLowerCase().indexOf(low);
      const snippet = at < 0 ? r.body.slice(0, 140) : r.body.slice(Math.max(0, at - 60), at + q.length + 80);
      return { vault: r.vault, path: r.path, title: noteTitle(r.path), snippet: snippet.replace(/\s+/g, " ").trim() };
    });
  }

  /** Starts bringing a vault in: its id, which every batch carries; null when there are as many vaults as Table keeps. */
  vaultStart(vault: string): string | null {
    const known = this.sql.exec(`SELECT 1 FROM vnotes WHERE vault = ? LIMIT 1`, vault).toArray().length;
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(DISTINCT vault) AS n FROM vnotes`).one().n;
    if (!known && count >= VAULT_LIMITS.vaults) return null;
    const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
    this.setBlob(`vault_import:${vault}`, id);
    return id;
  }

  private vaultImporting(vault: string, id: string): boolean {
    return this.blob(`vault_import:${vault}`) === id;
  }

  /** A batch of notes for vault `vault`'s import `id`; the refusal, and nothing kept, when it's not the one going or the vault is full. */
  vaultPutNotes(vault: string, id: string, notes: { path: string; body: string }[]): string | null {
    if (!this.vaultImporting(vault, id)) return "That bringing-in has been overtaken by another. Start again.";
    const have = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM vnotes WHERE vault = ? AND import = ?`, vault, id).one().n;
    if (have + notes.length > VAULT_LIMITS.notes) return `A vault can bring in up to ${VAULT_LIMITS.notes} notes.`;
    for (const n of notes) {
      this.sql.exec(
        `INSERT INTO vnotes (vault, path, body, import) VALUES (?, ?, ?, ?) ON CONFLICT(vault, path) DO UPDATE SET body = excluded.body, import = excluded.import`,
        vault,
        n.path,
        n.body,
        id,
      );
    }
    return null;
  }

  /** Of these pictures' checksums, the ones whose copy is already kept (from any vault). */
  vaultKnownHashes(hashes: string[]): string[] {
    const known: string[] = [];
    for (const h of hashes) if (this.sql.exec(`SELECT 1 FROM vfiles WHERE hash = ? LIMIT 1`, h).toArray().length) known.push(h);
    return known;
  }

  /** Pictures for vault `vault`'s import `id` whose copy is kept; the refusal when it's not the one going or there are too many. */
  vaultPutFiles(vault: string, id: string, files: VaultFileInfo[]): string | null {
    if (!this.vaultImporting(vault, id)) return "That bringing-in has been overtaken by another. Start again.";
    const mine = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM vfiles WHERE vault = ? AND import = ?`, vault, id).one().n;
    const all = this.sql.exec<{ b: number | null }>(`SELECT SUM(bytes) AS b FROM vfiles`).one().b ?? 0;
    if (mine + files.length > VAULT_LIMITS.files || all + files.reduce((n, x) => n + x.bytes, 0) > VAULT_LIMITS.fileTotal) {
      return "That's more pictures than Table keeps for your vaults.";
    }
    for (const x of files) {
      this.sql.exec(
        `INSERT INTO vfiles (vault, path, hash, mime, bytes, import) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(vault, path) DO UPDATE SET hash = excluded.hash, mime = excluded.mime, bytes = excluded.bytes, import = excluded.import`,
        vault,
        x.path,
        x.hash,
        x.mime,
        x.bytes,
        id,
      );
    }
    return null;
  }

  private hashesInUse(): Set<string> {
    return new Set(this.sql.exec<{ hash: string }>(`SELECT DISTINCT hash FROM vfiles`).toArray().map((r) => r.hash));
  }

  /**
   * Finishes vault `vault`'s import `id`: its notes and pictures the import didn't bring are gone
   * (they've left the vault). The vault brought in before there were several gives way to this one
   * when this one has most of its notes. The checksums no picture uses any more, for their copies to
   * go too; null when it's not the one going.
   */
  vaultFinish(vault: string, id: string): { notes: number; files: number; unused: string[] } | null {
    if (!this.vaultImporting(vault, id)) return null;
    const before = this.hashesInUse();
    this.sql.exec(`DELETE FROM vnotes WHERE vault = ? AND import != ?`, vault, id);
    this.sql.exec(`DELETE FROM vfiles WHERE vault = ? AND import != ?`, vault, id);
    const legacy = this.blob("vault_legacy");
    if (legacy && legacy !== vault) {
      const old = this.sql.exec<{ path: string }>(`SELECT path FROM vnotes WHERE vault = ?`, legacy).toArray();
      // A note it had is in this vault at the same place, or in one of its folders: it may have been
      // brought in from a folder inside the vault (Vern's was his Smugglers folder alone).
      const here = new Set<string>();
      for (const { path } of this.sql.exec<{ path: string }>(`SELECT path FROM vnotes WHERE vault = ?`, vault)) {
        const parts = path.split("/");
        for (let i = 0; i < parts.length; i++) here.add(parts.slice(i).join("/"));
      }
      const shared = old.filter((o) => here.has(o.path)).length;
      if (!old.length || shared * 2 >= old.length) {
        this.dropVault(legacy);
        this.sql.exec(`DELETE FROM blobs WHERE name = 'vault_legacy'`);
      }
    }
    this.sql.exec(`DELETE FROM blobs WHERE name = ?`, `vault_import:${vault}`);
    this.setBlob(`vault_at:${vault}`, String(Date.now()));
    const after = this.hashesInUse();
    return {
      notes: this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM vnotes WHERE vault = ?`, vault).one().n,
      files: this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM vfiles WHERE vault = ?`, vault).one().n,
      unused: [...before].filter((h) => !after.has(h)),
    };
  }

  private dropVault(vault: string): void {
    this.sql.exec(`DELETE FROM vnotes WHERE vault = ?`, vault);
    this.sql.exec(`DELETE FROM vfiles WHERE vault = ?`, vault);
    this.sql.exec(`DELETE FROM vdrive WHERE vault = ?`, vault);
    this.sql.exec(`DELETE FROM blobs WHERE name IN (?, ?)`, `vault_at:${vault}`, `vault_import:${vault}`);
  }

  /** Takes a vault (or with null, every vault) out of Table: the checksums no picture uses any more, for their copies to go. */
  vaultClear(vault: string | null): string[] {
    const before = this.hashesInUse();
    if (vault) this.dropVault(vault);
    else {
      this.sql.exec(`DELETE FROM vnotes`);
      this.sql.exec(`DELETE FROM vfiles`);
      this.sql.exec(`DELETE FROM vdrive`);
      this.sql.exec(`DELETE FROM blobs WHERE name LIKE 'vault\\_%' ESCAPE '\\'`);
    }
    const after = this.hashesInUse();
    return [...before].filter((h) => !after.has(h));
  }

  /** The table as it is now, for the backups in Google Drive (backupJob.ts): the campaign notes encrypted. */
  async backupSnapshot(): Promise<Packed> {
    const snapshot = readTables(this.sql, NOT_BACKED_UP);
    const { tables: names, blob } = PART_TABLES.notes;
    const notes: Snapshot["tables"] = {};
    for (const name of names) {
      notes[name] = snapshot.tables[name] ?? [];
      delete snapshot.tables[name];
    }
    const blobs = snapshot.tables.blobs ?? [];
    notes.blobs = blobs.filter((row) => blob!(String(row.name)));
    snapshot.tables.blobs = blobs.filter((row) => !blob!(String(row.name)));
    snapshot.sealed = await sealJson(this.backupNotesKey(), notes);
    return pack(snapshot);
  }

  /** The key the campaign notes are encrypted with in the backups (seal.ts). Made once; never leaves this Table. */
  backupNotesKey(): string {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'backup_notes_key'`).toArray()[0];
    if (row) return row.value;
    const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('backup_notes_key', ?)`, value);
    return value;
  }

  /** What a backup holds of the campaign notes, if this Table can open them. Changes nothing. */
  async notesInBackup(gz: Uint8Array<ArrayBuffer>): Promise<{ encrypted: boolean; opens: boolean; notes: number; pictures: number }> {
    const snapshot = await unpack(gz);
    if (!snapshot.sealed) return { encrypted: false, opens: true, notes: snapshot.tables.vnotes?.length ?? 0, pictures: snapshot.tables.vfiles?.length ?? 0 };
    try {
      const notes = await openJson<Snapshot["tables"]>(this.backupNotesKey(), snapshot.sealed);
      return { encrypted: true, opens: true, notes: notes.vnotes?.length ?? 0, pictures: notes.vfiles?.length ?? 0 };
    } catch {
      return { encrypted: true, opens: false, notes: 0, pictures: 0 };
    }
  }

  /** Puts these parts of the table back as a backup held them. What's there now of them goes. */
  async restoreParts(gz: Uint8Array<ArrayBuffer>, parts: TablePart[]): Promise<void> {
    const snapshot = await unpack(gz);
    let { tables } = snapshot;
    // Encrypted notes open here, or nothing's put back. Backups from before they were encrypted have them in the tables.
    if (parts.includes("notes") && snapshot.sealed) {
      let notes: Snapshot["tables"];
      try {
        notes = await openJson<Snapshot["tables"]>(this.backupNotesKey(), snapshot.sealed);
      } catch {
        throw new Error("The campaign notes in this backup are encrypted with a key this Table doesn't have, so nothing's been put back. Untick them, and bring your notes in again from Obsidian.");
      }
      tables = { ...tables, ...notes, blobs: [...(tables.blobs ?? []), ...(notes.blobs ?? [])] };
    }
    this.ctx.storage.transactionSync(() => {
      for (const part of parts) {
        const { tables: names, blob } = PART_TABLES[part];
        for (const name of names) {
          this.sql.exec(`DELETE FROM "${name}"`);
          writeRows(this.sql, name, tables[name] ?? []);
        }
        if (blob) {
          for (const row of this.sql.exec<{ name: string }>(`SELECT name FROM blobs`).toArray()) {
            if (blob(row.name)) this.sql.exec(`DELETE FROM blobs WHERE name = ?`, row.name);
          }
          writeRows(this.sql, "blobs", (tables.blobs ?? []).filter((row) => blob(String(row.name))));
        }
      }
    });
  }

  /** The backup script in the GM's Google Drive (scripts/table-backup.gs): its address, or null. */
  backupDriveSource(): string | null {
    return this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'backup_drive_source'`).toArray()[0]?.value ?? null;
  }

  setBackupDriveSource(source: string | null): void {
    this.sql.exec(`DELETE FROM secrets WHERE name = 'backup_drive_source'`);
    if (source) this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('backup_drive_source', ?)`, source);
  }

  /** The key Table sends the backup script (it keeps the first it's sent). Made once. */
  backupDriveKey(): string {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'backup_drive_key'`).toArray()[0];
    if (row) return row.value;
    const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('backup_drive_key', ?)`, value);
    return value;
  }

  /** The GM's vault script in Google Drive (scripts/vault-drive.gs): its address, or null. */
  vaultDriveSource(): string | null {
    return this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'vault_drive_source'`).toArray()[0]?.value ?? null;
  }

  setVaultDriveSource(source: string | null): void {
    this.sql.exec(`DELETE FROM secrets WHERE name = 'vault_drive_source'`);
    if (source) this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('vault_drive_source', ?)`, source);
  }

  /** The key Table sends the vault script (it keeps the first it's sent). Made once. */
  vaultDriveKey(): string {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'vault_drive_key'`).toArray()[0];
    if (row) return row.value;
    const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('vault_drive_key', ?)`, value);
    return value;
  }

  /** A picture's checksum if it was fetched from Drive unchanged since (`modified`) and its copy is still kept; else null. */
  vaultDriveHash(vault: string, path: string, modified: number): string | null {
    const row = this.sql.exec<{ hash: string }>(`SELECT hash FROM vdrive WHERE vault = ? AND path = ? AND modified = ?`, vault, path, modified).toArray()[0];
    if (!row) return null;
    return this.sql.exec(`SELECT 1 FROM vfiles WHERE hash = ? LIMIT 1`, row.hash).toArray().length ? row.hash : null;
  }

  vaultDriveRemember(vault: string, path: string, modified: number, hash: string): void {
    this.sql.exec(
      `INSERT INTO vdrive (vault, path, modified, hash) VALUES (?, ?, ?, ?) ON CONFLICT(vault, path) DO UPDATE SET modified = excluded.modified, hash = excluded.hash`,
      vault,
      path,
      modified,
      hash,
    );
  }

  /** Each character's dice set, by sheet id (worker/characters.ts); a character with none is missing. */
  characterDice(): Record<string, string> {
    const rows = this.sql.exec<{ sheet_id: string; dice: string }>(`SELECT sheet_id, dice FROM character_dice`).toArray();
    return Object.fromEntries(rows.map((r) => [r.sheet_id, r.dice]));
  }

  /**
   * A character's dice for every room; null goes back to Classic. False, and nothing changed, when
   * another character has that set.
   */
  setCharacterDice(sheetId: string, dice: string | null): boolean {
    if (dice && this.sql.exec(`SELECT 1 FROM character_dice WHERE dice = ? AND sheet_id != ?`, dice, sheetId).toArray().length) return false;
    this.sql.exec(`DELETE FROM character_dice WHERE sheet_id = ?`, sheetId);
    if (dice) this.sql.exec(`INSERT INTO character_dice (sheet_id, dice) VALUES (?, ?)`, sheetId, dice);
    return true;
  }

  /**
   * The dice a roll is made in: the character's it's for (`sheetId`), or else the one this browser
   * (`userId`) plays; null when that's nobody, or they have none.
   */
  diceFor(sheetId: string | null, userId: string | null): string | null {
    const sheet =
      sheetId ?? (userId ? (this.sql.exec<{ sheet_id: string }>(`SELECT sheet_id FROM character_players WHERE user_id = ?`, userId).toArray()[0]?.sheet_id ?? null) : null);
    if (!sheet) return null;
    return this.sql.exec<{ dice: string }>(`SELECT dice FROM character_dice WHERE sheet_id = ?`, sheet).toArray()[0]?.dice ?? null;
  }

  /** The browsers playing each character, by sheet id, longest-standing first (worker/characters.ts). */
  characterPlayers(): Record<string, { userId: string; name: string }[]> {
    const out: Record<string, { userId: string; name: string }[]> = {};
    const rows = this.sql.exec<{ user_id: string; sheet_id: string; name: string }>(`SELECT user_id, sheet_id, name FROM character_players ORDER BY at`);
    for (const r of rows) (out[r.sheet_id] ??= []).push({ userId: r.user_id, name: r.name });
    return out;
  }

  /**
   * A browser plays a character (one at a time), for every room; null: it plays nobody. Kept for
   * the latest MAX_CHARACTER_PLAYERS browsers.
   */
  setCharacterPlayer(userId: string, sheetId: string | null, name: string): void {
    this.sql.exec(`DELETE FROM character_players WHERE user_id = ?`, userId);
    if (!sheetId) return;
    this.sql.exec(`INSERT INTO character_players (user_id, sheet_id, name, at) VALUES (?, ?, ?, ?)`, userId, sheetId, name, Date.now());
    this.sql.exec(
      `DELETE FROM character_players WHERE user_id NOT IN (SELECT user_id FROM character_players ORDER BY at DESC LIMIT ?)`,
      MAX_CHARACTER_PLAYERS,
    );
  }

  /** The spells each character has prayed for today, by sheet id: casts left, by the sheet's name for the spell. */
  characterPrayed(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const r of this.sql.exec<{ sheet_id: string; spell: string; left: number }>(`SELECT sheet_id, spell, left FROM character_prayed`)) {
      (out[r.sheet_id] ??= {})[r.spell] = r.left;
    }
    return out;
  }

  /**
   * How many casts of a spell a character has left today, for every room: none takes it off the
   * list. At most MAX_PRAYED_SPELLS spells a character.
   */
  setCharacterPrayed(sheetId: string, spell: string, left: number): void {
    this.sql.exec(`DELETE FROM character_prayed WHERE sheet_id = ? AND spell = ?`, sheetId, spell);
    if (left <= 0) return;
    const n = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM character_prayed WHERE sheet_id = ?`, sheetId).one().n;
    if (n < MAX_PRAYED_SPELLS) this.sql.exec(`INSERT INTO character_prayed (sheet_id, spell, left) VALUES (?, ?, ?)`, sheetId, spell, left);
  }

  /** A new day: nothing prayed for. */
  clearCharacterPrayed(sheetId: string): void {
    this.sql.exec(`DELETE FROM character_prayed WHERE sheet_id = ?`, sheetId);
  }

  /** The campaign's calendar (shared/calendar.ts) as JSON, with how many times it's been changed; null before one is made. */
  calendar(): { json: string; version: number } | null {
    const row = this.sql.exec<{ value: string; version: number }>(`SELECT value, version FROM blobs WHERE name = 'calendar'`).toArray()[0];
    return row ? { json: row.value, version: row.version } : null;
  }

  /** Keeps the calendar: its new version number. */
  setCalendar(json: string): number {
    const version = (this.calendar()?.version ?? 0) + 1;
    this.sql.exec(`INSERT INTO blobs (name, value, version) VALUES ('calendar', ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, version = excluded.version`, json, version);
    return version;
  }

  /** Nobody plays a character any more. */
  clearCharacterPlayers(sheetId: string): void {
    this.sql.exec(`DELETE FROM character_players WHERE sheet_id = ?`, sheetId);
  }

  listRooms(): RoomSummary[] {
    return this.sql
      .exec<{ id: string; name: string; created_at: number; last_used: number }>(
        `SELECT id, name, created_at, last_used FROM rooms ORDER BY last_used DESC`,
      )
      .toArray()
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsed: r.last_used }));
  }

  addRoom(id: string, name: string, createdAt: number): void {
    this.sql.exec(
      `INSERT INTO rooms (id, name, created_at, last_used) VALUES (?, ?, ?, ?)`,
      id,
      name,
      createdAt,
      createdAt,
    );
  }

  renameRoom(id: string, name: string): void {
    this.sql.exec(`UPDATE rooms SET name = ? WHERE id = ?`, name, id);
  }

  touchRoom(id: string): void {
    this.sql.exec(`UPDATE rooms SET last_used = ? WHERE id = ?`, Date.now(), id);
  }

  removeRoom(id: string): void {
    this.sql.exec(`DELETE FROM rooms WHERE id = ?`, id);
  }

  private failures(key: string, now: number): number {
    const row = this.sql
      .exec<{ window_start: number; failures: number }>(
        `SELECT window_start, failures FROM login_failures WHERE ip = ?`,
        key,
      )
      .toArray()[0];
    if (!row || now - row.window_start > FAILURE_WINDOW_MS) return 0;
    return row.failures;
  }

  private bump(key: string, now: number, by: number): void {
    this.sql.exec(
      `INSERT INTO login_failures (ip, window_start, failures) VALUES (?, ?, MAX(?, 0))
       ON CONFLICT(ip) DO UPDATE SET failures = MAX(failures + ?, 0)`,
      key,
      now,
      by,
      by,
    );
  }

  /**
   * Reserves one sign-in attempt for this address, counting it as a failure up front.
   * Returns false when the address (or everyone together) is out of attempts. Checking
   * and counting in one call means requests sent at the same time can't all slip
   * through before any failure is recorded. A successful sign-in gives the attempt
   * back with loginSucceeded().
   */
  beginLoginAttempt(key: string): boolean {
    const now = Date.now();
    this.sql.exec(`DELETE FROM login_failures WHERE window_start < ?`, now - FAILURE_WINDOW_MS);
    if (this.failures(key, now) >= MAX_FAILURES) return false;
    if (this.failures(GLOBAL_KEY, now) >= MAX_GLOBAL_FAILURES) {
      // Someone is guessing from many addresses. Addresses the GM has signed in from
      // before still get their own 10 tries, so the GM isn't locked out at home.
      const trusted = this.sql
        .exec<{ last_ok: number }>(`SELECT last_ok FROM trusted_logins WHERE ip = ?`, key)
        .toArray()[0];
      if (!trusted || now - trusted.last_ok > TRUSTED_MS) {
        console.error(JSON.stringify({ message: "global login cap reached; refusing sign-in from a new address" }));
        return false;
      }
    }
    this.bump(key, now, 1);
    this.bump(GLOBAL_KEY, now, 1);
    return true;
  }

  loginSucceeded(key: string): void {
    const now = Date.now();
    this.sql.exec(`DELETE FROM login_failures WHERE ip = ?`, key);
    this.bump(GLOBAL_KEY, now, -1);
    this.sql.exec(
      `INSERT INTO trusted_logins (ip, last_ok) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET last_ok = excluded.last_ok`,
      key,
      now,
    );
  }
}

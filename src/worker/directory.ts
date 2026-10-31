// The single Directory object: the GM's room list, login throttling, and the
// random secret that GM session cookies are signed with.

import { DurableObject } from "cloudflare:workers";
import type { RoomSummary } from "../shared/types";
import { MAX_PRAYED_SPELLS } from "../shared/characters";

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

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

// The single Directory object: the GM's room list, login throttling, and the
// random secret that GM session cookies are signed with.

import { DurableObject } from "cloudflare:workers";
import type { RoomSummary } from "../shared/types";

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
    });
  }

  sessionSecret(): string {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM secrets WHERE name = 'session'`).toArray()[0];
    if (row) return row.value;
    const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec(`INSERT INTO secrets (name, value) VALUES ('session', ?)`, value);
    return value;
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

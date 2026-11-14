// What's a table's own, and so is never written into the code: where its Dungeon (the map
// maker) is, if it has one, and the lines it shows under "Loading map…". Each is set where the
// table is deployed (the Worker's DUNGEON_URL and LOADING_LINES: see the README), read by the
// server (worker/table.ts) and passed to the page when it asks who it is (/api/me) and when it
// joins a room (the hello message). A table with neither set has no Dungeon button and no line.

export interface TableSettings {
  /** Dungeon's address, as "https://dungeon.example.com/", or null for a table without one. */
  dungeon: string | null;
  /** The lines shown under "Loading map…", one at a time. Empty for none. */
  lines: string[];
}

export const NO_TABLE_SETTINGS: TableSettings = { dungeon: null, lines: [] };

export const TABLE_LIMITS = { lines: 100, line: 200 } as const;

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1";
}

/**
 * Dungeon's address from whatever was set: its origin with a closing slash, or null when it's
 * not set or not an address a page should be sent to (https, or http on this computer alone).
 * Dungeon is always at the top of its host, so anything after the host is dropped.
 */
export function cleanDungeonUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) return null;
  return `${url.origin}/`;
}

/**
 * The loading lines from whatever was set: a list, or text that is either a JSON list or one
 * line to a row. Each is trimmed and kept to one row of plain text; empty ones are dropped.
 */
export function cleanLines(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    list = text.split(/\r?\n/);
    if (text.startsWith("[")) {
      try {
        list = JSON.parse(text);
      } catch {
        // Not a list after all: its rows, as they are.
      }
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    // eslint-disable-next-line no-control-regex
    const line = entry.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, TABLE_LIMITS.line).trim();
    if (line) out.push(line);
    if (out.length >= TABLE_LIMITS.lines) break;
  }
  return out;
}

/** Settings as a page keeps them, from whatever the server sent. */
export function cleanTableSettings(raw: unknown): TableSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as { dungeon?: unknown; lines?: unknown };
  return { dungeon: cleanDungeonUrl(o.dungeon), lines: cleanLines(o.lines) };
}

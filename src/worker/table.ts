// This table's own settings, as set where it's deployed (shared/table.ts says what they are
// and how a page gets them): DUNGEON_URL and LOADING_LINES, as plain settings or as secrets.
// Neither is in wrangler.jsonc, because the code doesn't know whose table it is.

import { NO_TABLE_SETTINGS, cleanDungeonUrl, cleanLines, type TableSettings } from "../shared/table";

/** From the Worker's settings; none at all (a room made bare, in a test) is a table with neither. */
export function tableSettings(env: { DUNGEON_URL?: unknown; LOADING_LINES?: unknown } | null | undefined): TableSettings {
  if (!env) return NO_TABLE_SETTINGS;
  return { dungeon: cleanDungeonUrl(env.DUNGEON_URL), lines: cleanLines(env.LOADING_LINES) };
}

// What a table may or may not have, set where it's deployed (local.jsonc, or as secrets): none
// of it is in wrangler.jsonc, so `wrangler types` (worker-configuration.d.ts) doesn't know it.
interface Env {
  /** Where this table's Dungeon (the map maker) is. Not set: a table without one. */
  DUNGEON_URL?: string;
  /** The lines shown under "Loading map…": a list, or text with one line to a row. */
  LOADING_LINES?: string | string[];
  /** Dungeon's bucket of maps, for backing them up and putting them back. */
  DUNGEON_MAPS?: R2Bucket;
}

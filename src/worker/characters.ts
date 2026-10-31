// The party's character sheets, for every page of a room (src/shared/characters.ts). The GM's
// Apps Script (scripts/character-sheets.gs, deployed as a web app run as the GM) reads the sheets
// in one Drive folder and answers with each character's card. Its address is a GM setting kept
// in the Directory (this repository is public, so it can't live in the code); this Worker asks
// it, never the browsers, and uses the answer for half a minute so a table full of pages doesn't
// ask the sheets again and again. The last good answer is kept for a day after that: when the
// sheets can't be read, pages get it with the reason, rather than an empty party. A character's
// own token picture (one the GM chose, instead of the drawn figure) is kept in R2 under
// characters/<sheet id>, for every room.

import { MAX_PRAYED, cleanCharacter, isSpellName, type Character, type CharacterPlayer, type CharactersReply } from "../shared/characters";
import { isId } from "../shared/sanitize";

/** How long a reading of the sheets is used before they're read again. */
const FRESH_MS = 30_000;
/** How long the last good reading is kept, for when the sheets can't be read (seconds). */
const KEEP_S = 24 * 60 * 60;
/** Reading five sheets takes the script several seconds; past this it's given up on. */
const SCRIPT_MS = 30_000;
/** The script's address: an Apps Script web app's. */
export const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
/** A sheet's id, as R2 keys and addresses use it. */
export const SHEET_ID = /^[A-Za-z0-9_-]{20,80}$/;
/** A figure the GM chooses for a character: an icon's id, as author_icon (pages draw only the ones they know). */
export const FIGURE_ICON = /^[a-z0-9-]{1,30}_[a-z0-9-]{1,40}$/;
export const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

export const pictureKey = (sheetId: string) => `characters/${sheetId}`;

/** The cache key for a reading of the sheets (the address hashed, so it isn't stored in the clear). */
async function cacheKey(source: string): Promise<Request> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request(`https://characters.tabletop.internal/${hex}`);
}

/**
 * The script's answer, read and checked: the characters, or why there are none, and the ids of
 * any sheets it found but couldn't open just now (`unread`).
 */
export async function askScript(source: string, fetcher: typeof fetch = fetch): Promise<{ characters: Character[]; unread?: string[]; error?: string }> {
  let res: Response;
  try {
    res = await fetcher(source, { redirect: "follow", signal: AbortSignal.timeout(SCRIPT_MS) });
  } catch {
    return { characters: [], error: "The character sheets didn't answer in time. Try again in a moment." };
  }
  const body = (await res.json().catch(() => null)) as { characters?: unknown; unread?: unknown; error?: unknown } | null;
  if (!res.ok || !body) {
    return { characters: [], error: "The character sheets' script didn't answer properly. Check its address in Room settings › Character sheets." };
  }
  if (typeof body.error === "string") return { characters: [], error: `The character sheets' script says: ${body.error.slice(0, 200)}` };
  const list = Array.isArray(body.characters) ? body.characters.slice(0, 40) : [];
  const characters = list.map(cleanCharacter).filter((c): c is Character => c !== null);
  const unread = (Array.isArray(body.unread) ? body.unread.slice(0, 40) : []).filter((id): id is string => typeof id === "string" && SHEET_ID.test(id));
  return unread.length ? { characters, unread } : { characters };
}

export interface PartyEnv {
  directory: {
    charactersSource(): Promise<string | null>;
    characterFigures(): Promise<Record<string, string>>;
    characterStrMatched(): Promise<Record<string, string[]>>;
    characterPlayers(): Promise<Record<string, CharacterPlayer[]>>;
    characterPrayed(): Promise<Record<string, Record<string, number>>>;
  };
  files: Pick<R2Bucket, "head">;
}

/**
 * The party for a room's pages: the sheets' cards, each with its own picture's version if it has
 * one, and the figure the GM chose for them, who plays them, if anyone, and what they've prayed
 * for today (asked each time, so a choice shows at once without reading the sheets again).
 */
export async function readParty(env: PartyEnv, cache: Cache | null, fetcher: typeof fetch = fetch, now = Date.now()): Promise<CharactersReply> {
  const source = await env.directory.charactersSource();
  if (!source) return { configured: false, characters: [], readAt: now };
  const reading = await readSheets(env, source, cache, fetcher, now);
  const [figures, matched, players, prayed] = await Promise.all([
    env.directory.characterFigures(),
    env.directory.characterStrMatched(),
    env.directory.characterPlayers(),
    env.directory.characterPrayed(),
  ]);
  return {
    ...reading,
    characters: reading.characters.map(({ figure: _f, strMatched: _m, players: _p, prayed: _r, ...c }) => ({
      ...c,
      ...(figures[c.id] ? { figure: figures[c.id] } : {}),
      ...(matched[c.id]?.length ? { strMatched: matched[c.id] } : {}),
      ...(players[c.id]?.length ? { players: players[c.id] } : {}),
      ...(prayed[c.id] ? { prayed: prayed[c.id] } : {}),
    })),
  };
}

/** A weapon's name as a character's sheet has it, to mark it matched to their strength. */
export function isWeaponName(v: unknown): v is string {
  return typeof v === "string" && v.trim() === v && v.length >= 1 && v.length <= 60 && !/[\u0000-\u001f\u007f]/.test(v);
}

/** Whether a browser (its player id) plays a character, and so chooses what they've prayed for. */
export async function playsCharacter(directory: Pick<PartyEnv["directory"], "characterPlayers">, sheetId: string, userId: string | null): Promise<boolean> {
  if (!isId(userId)) return false;
  return !!(await directory.characterPlayers())[sheetId]?.some((p) => p.userId === userId);
}

/** A change to what a character has prayed for today: a spell's casts left (0 to MAX_PRAYED), or a new day. Null when it isn't one. */
export function prayedChange(body: unknown): { spell: string; left: number } | { newDay: true } | null {
  const b = body as { spell?: unknown; left?: unknown; newDay?: unknown } | null;
  if (b?.newDay === true) return { newDay: true };
  const left = b?.left;
  if (!isSpellName(b?.spell) || typeof left !== "number" || !Number.isInteger(left) || left < 0 || left > MAX_PRAYED) return null;
  return { spell: b.spell, left };
}

async function readSheets(env: PartyEnv, source: string, cache: Cache | null, fetcher: typeof fetch, now: number): Promise<CharactersReply> {
  const key = await cacheKey(source);
  const kept = await keptReading(cache, key);
  if (kept && now - kept.readAt < FRESH_MS) return kept;
  const { characters, unread, error } = await askScript(source, fetcher);
  // The sheets couldn't be read: the last good reading, with why, so tokens keep their cards.
  // A failure isn't kept: the next page to ask tries again.
  if (error) return kept ? { ...kept, error } : { configured: true, characters: [], readAt: now, error };
  // A sheet the script couldn't open just now keeps its last reading.
  for (const id of unread ?? []) {
    const last = kept?.characters.find((c) => c.id === id);
    if (last && !characters.some((c) => c.id === id)) characters.push(last);
  }
  characters.sort((a, b) => a.name.localeCompare(b.name));
  // Each character's own picture, if the GM chose one: its version tells pages when it changed.
  await Promise.all(
    characters.map(async (c) => {
      const head = await env.files.head(pictureKey(c.id)).catch(() => null);
      if (head) c.picture = head.httpEtag.replace(/"/g, "").slice(0, 40);
      else delete c.picture;
    }),
  );
  const reply: CharactersReply = { configured: true, characters, readAt: now };
  await keep(cache, key, reply);
  return reply;
}

async function keptReading(cache: Cache | null, key: Request): Promise<CharactersReply | null> {
  const hit = await cache?.match(key);
  const kept = hit ? ((await hit.json().catch(() => null)) as CharactersReply | null) : null;
  return kept && Array.isArray(kept.characters) && typeof kept.readAt === "number" ? kept : null;
}

async function keep(cache: Cache | null, key: Request, reply: CharactersReply): Promise<void> {
  await cache?.put(key, new Response(JSON.stringify(reply), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${KEEP_S}` } }));
}

/**
 * Makes the kept reading stale, so the next ask reads the sheets (a new picture, the address saved
 * again); it's still there to fall back on if they can't be read.
 */
export async function forgetParty(env: Pick<PartyEnv, "directory">, cache: Cache | null): Promise<void> {
  const source = await env.directory.charactersSource();
  if (!source || !cache) return;
  const key = await cacheKey(source);
  const kept = await keptReading(cache, key);
  if (kept) await keep(cache, key, { ...kept, readAt: kept.readAt - FRESH_MS });
}

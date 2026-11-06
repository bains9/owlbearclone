// The GM's own monsters and NPCs, for every room (shared/library.ts): the list, uploading straight
// into it, filing a room's uploads in it, renaming one or moving it to the other shelf, taking one
// out, its picture, and putting one in a room (the room gets its own copy of the picture, once).
// All the GM's, but the picture: like a room's pictures, it's for anyone with its address.
import { SAVED_LIMITS, isCreatureKey, sanitizeTokenStats } from "../shared/tokenStats";
import { randomId } from "../shared/ids";
import { LIBRARY_ID, MAX_FILE_AT_ONCE, isShelf, libraryKey, type LibraryEntry } from "../shared/library";
import { GM_OWNER, LIMITS, cleanText } from "../shared/sanitize";
import type { Asset } from "../shared/types";
import { isGm } from "./auth";
import { fileKey } from "./room";
import { MAX_UPLOAD_BYTES, uploadType } from "./uploads";

const HSTS = "max-age=31536000; includeSubDomains";
const MAX_JSON_BYTES = 16 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Strict-Transport-Security": HSTS },
  });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ID = LIBRARY_ID.source.slice(1, -1);
const PLACE = new RegExp(`^/api/rooms/([A-Za-z0-9]{12})/library/(${ID})$`);
const ONE = new RegExp(`^/api/library/(${ID})$`);
const FILE = new RegExp(`^/api/library/(${ID})/file$`);

/** The response for a library route, or null when the path isn't one. */
export async function libraryRoute(request: Request, env: Env, pathname: string, method: string): Promise<Response | null> {
  // What each kind of creature starts with, in every room: the GM's alone.
  if (pathname === "/api/creature-stats") {
    if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
    const directory = env.DIRECTORY.getByName("main");
    if (method === "GET") return json(await directory.creatureStatsAll());
    if (method !== "PUT") return fail(405, "Method not allowed.");
    const body = await readJson(request);
    if (!isCreatureKey(body?.key)) return fail(400, "That isn't a kind of creature.");
    const stats = body.stats === null ? null : sanitizeTokenStats(body.stats);
    if (body.stats !== null && !stats) return fail(400, "Those aren't stats.");
    if (!(await directory.setCreatureStats(body.key, stats))) return fail(409, `Table keeps stats for at most ${SAVED_LIMITS.kinds} kinds of creature.`);
    return json({ key: body.key });
  }
  const file = pathname.match(FILE);
  if (file) {
    if (method !== "GET" && method !== "HEAD") return fail(405, "Method not allowed.");
    const obj = await env.FILES.get(libraryKey(file[1]), { onlyIf: request.headers });
    if (!obj) return fail(404, "Not found.");
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("ETag", obj.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Strict-Transport-Security", HSTS);
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(method === "HEAD" ? null : obj.body, { headers });
  }

  const place = pathname.match(PLACE);
  const one = pathname.match(ONE);
  if (!place && !one && pathname !== "/api/library" && pathname !== "/api/library/from-room") return null;
  if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
  const directory = env.DIRECTORY.getByName("main");

  // A library picture into a room: the room's copy (made the first time), for a token to show.
  if (place) {
    if (method !== "POST") return fail(405, "Method not allowed.");
    const [, roomId, entryId] = place;
    const stub = env.ROOMS.getByName(roomId);
    if (!(await stub.exists())) return fail(404, "Room not found.");
    const have = await stub.libraryCopy(entryId);
    if (have) return json(have);
    const entry = await directory.libraryEntry(entryId);
    if (!entry) return fail(404, "That isn't in your monsters and NPCs any more.");
    const obj = await env.FILES.get(libraryKey(entryId));
    if (!obj) return fail(404, "Its picture has gone.");
    const asset: Asset = {
      id: randomId(16),
      name: entry.name,
      kind: "token",
      width: entry.width,
      height: entry.height,
      mime: entry.mime,
      bytes: entry.bytes,
      owner: GM_OWNER,
      createdAt: Date.now(),
      library: entryId,
    };
    const key = fileKey(roomId, asset.id);
    await env.FILES.put(key, await obj.arrayBuffer(), { httpMetadata: { contentType: entry.mime, cacheControl: "public, max-age=31536000, immutable" } });
    try {
      await stub.addAsset(asset, "gm");
    } catch (err) {
      await env.FILES.delete(key).catch(() => undefined);
      return fail(409, err instanceof Error ? err.message : "It couldn't be put in this room.");
    }
    return json(asset, 201);
  }

  if (pathname === "/api/library") {
    if (method === "GET") return json(await directory.libraryList());
    if (method !== "POST") return fail(405, "Method not allowed.");
    // A picture uploaded straight into Monsters or NPCs.
    const url = new URL(request.url);
    const shelf = url.searchParams.get("shelf");
    if (!isShelf(shelf)) return fail(400, "Say whether it's a monster or an NPC.");
    const limit = MAX_UPLOAD_BYTES.token;
    if (Number(request.headers.get("Content-Length") ?? "0") > limit) return fail(413, `Images must be under ${limit / 1024 / 1024} MB.`);
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return fail(400, "The upload was empty.");
    if (body.byteLength > limit) return fail(413, `Images must be under ${limit / 1024 / 1024} MB.`);
    const type = uploadType("token", new Uint8Array(body, 0, Math.min(32, body.byteLength)));
    if ("refusal" in type) return fail(415, type.refusal);
    const width = Number(url.searchParams.get("w"));
    const height = Number(url.searchParams.get("h"));
    if (!(width >= 1 && width <= 30000 && height >= 1 && height <= 30000)) return fail(400, "Missing or impossible image dimensions.");
    const full = await directory.libraryRefusal(1, body.byteLength);
    if (full) return fail(403, full);
    const entry: LibraryEntry = {
      id: randomId(16),
      shelf,
      name: cleanText(url.searchParams.get("name"), LIMITS.name) || "Image",
      mime: type.mime,
      width: Math.round(width),
      height: Math.round(height),
      bytes: body.byteLength,
      createdAt: Date.now(),
    };
    await env.FILES.put(libraryKey(entry.id), body, { httpMetadata: { contentType: entry.mime, cacheControl: "public, max-age=31536000, immutable" } });
    const refusal = await directory.addLibraryEntries([entry]);
    if (refusal) {
      await env.FILES.delete(libraryKey(entry.id)).catch(() => undefined);
      return fail(403, refusal);
    }
    return json(entry, 201);
  }

  // A room's uploads filed under Monsters or NPCs: copied into the library, and that room's
  // pictures marked as its copies (they leave its Tokens). A few at a time: the page sends more.
  if (pathname === "/api/library/from-room") {
    if (method !== "POST") return fail(405, "Method not allowed.");
    const body = await readJson(request);
    const roomId = typeof body?.room === "string" ? body.room : "";
    const shelf = body?.shelf;
    const ids = Array.isArray(body?.assets) ? body.assets.filter((x): x is string => typeof x === "string").slice(0, MAX_FILE_AT_ONCE) : [];
    if (!/^[A-Za-z0-9]{12}$/.test(roomId) || !isShelf(shelf) || !ids.length) return fail(400, "Say which room, which pictures, and Monsters or NPCs.");
    const stub = env.ROOMS.getByName(roomId);
    if (!(await stub.exists())) return fail(404, "Room not found.");
    const live = new Set((await directory.libraryList()).map((e) => e.id));
    const assets = (await stub.tokenAssets(ids)).filter((a) => !a.library || !live.has(a.library));
    const full = await directory.libraryRefusal(assets.length, assets.reduce((n, a) => n + a.bytes, 0));
    if (full) return fail(403, full);
    const entries: LibraryEntry[] = [];
    const links: { assetId: string; entryId: string }[] = [];
    for (const a of assets) {
      const obj = await env.FILES.get(fileKey(roomId, a.id));
      if (!obj) continue;
      const entry: LibraryEntry = { id: randomId(16), shelf, name: a.name, mime: a.mime, width: a.width, height: a.height, bytes: a.bytes, createdAt: Date.now() };
      await env.FILES.put(libraryKey(entry.id), await obj.arrayBuffer(), { httpMetadata: { contentType: a.mime, cacheControl: "public, max-age=31536000, immutable" } });
      entries.push(entry);
      links.push({ assetId: a.id, entryId: entry.id });
    }
    const refusal = entries.length ? await directory.addLibraryEntries(entries) : null;
    if (refusal) {
      await Promise.all(entries.map((e) => env.FILES.delete(libraryKey(e.id)).catch(() => undefined)));
      return fail(403, refusal);
    }
    if (links.length) await stub.linkLibrary(links);
    return json({ filed: links.length, library: await directory.libraryList() });
  }

  if (one) {
    const id = one[1];
    if (method === "PATCH") {
      // Renamed, or moved to the other shelf.
      const body = await readJson(request);
      const name = body?.name === undefined ? undefined : cleanText(body.name, LIMITS.name);
      const shelf = body?.shelf === undefined ? undefined : body.shelf;
      if (name === "" || (shelf !== undefined && !isShelf(shelf)) || (name === undefined && shelf === undefined)) return fail(400, "Give it a name, or Monsters or NPCs.");
      const entry = await directory.updateLibraryEntry(id, { ...(name ? { name } : {}), ...(isShelf(shelf) ? { shelf } : {}) });
      return entry ? json(entry) : fail(404, "That isn't in your monsters and NPCs any more.");
    }
    if (method === "DELETE") {
      // Out of the library, for every room. Rooms keep their copies, so tokens on maps stay.
      const was = await directory.removeLibraryEntry(id);
      if (was) await env.FILES.delete(libraryKey(id)).catch(() => undefined);
      return json({ ok: true });
    }
    return fail(405, "Method not allowed.");
  }
  return fail(405, "Method not allowed.");
}

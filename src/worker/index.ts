// The Worker: every request comes here first. It sends plain-HTTP visitors to
// HTTPS, serves the JSON API under /api/ (GM sign-in, rooms, the WebSocket entry
// point, image upload and download backed by R2), and hands everything else to the
// static client.

import { randomId } from "../shared/ids";
import { GM_OWNER, LIMITS, cleanText, isId } from "../shared/sanitize";
import type { Asset, Role } from "../shared/types";
import { clearCookie, isGm, passwordMatches, sessionCookie, signWith, verifyWith } from "./auth";
import { finishGoogleSignIn, googleConfigured, startGoogleSignIn } from "./google";
import { fileKey } from "./room";

export { Directory } from "./directory";
export { Room } from "./room";

const MAX_UPLOAD_BYTES: Record<"map" | "token", number> = {
  map: 30 * 1024 * 1024,
  token: 5 * 1024 * 1024,
};
const MAX_JSON_BYTES = 16 * 1024;
/** Room ids are always 12 random characters (see POST /api/rooms). */
const ROOM_ID = "[A-Za-z0-9]{12}";
const HSTS = "max-age=31536000; includeSubDomains";

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Strict-Transport-Security": HSTS,
      ...headers,
    },
  });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

/**
 * The key in a room's table display link. Only the GM can get it, so someone with
 * just the room link can't turn their screen into a display (and see where the GM
 * is looking).
 */
function displayKey(env: Env, roomId: string): Promise<string> {
  return signWith(env, `display-link|${roomId}`, roomId);
}

async function displayKeyValid(env: Env, roomId: string, key: string): Promise<boolean> {
  return key.length > 0 && key.length < 100 && verifyWith(env, `display-link|${roomId}`, roomId, key);
}

/** Local development (vite dev, player.localhost tabs) runs over plain HTTP. */
function isLocal(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1";
}

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (len > MAX_JSON_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The key login attempts are counted under. IPv6 addresses count per /64, since
 * anyone with IPv6 has a whole /64 to rotate through.
 */
function loginKey(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const groups = tail !== undefined ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => (g || "0").toLowerCase())
    .join(":")}::/64`;
}

/** Identifies the image type from its first bytes, so a file is served as what it really is. */
function sniffImage(b: Uint8Array): string | null {
  const at = (offset: number, text: string) =>
    b.length >= offset + text.length && [...text].every((ch, i) => b[offset + i] === ch.charCodeAt(0));
  if (b[0] === 0x89 && at(1, "PNG")) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return "image/avif";
  return null;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol === "http:" && !isLocal(url)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error(JSON.stringify({ message: "request failed", path: url.pathname, error: String(err) }));
      return fail(500, "Something went wrong on the server.");
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;
  // The cookie is Secure everywhere except local development over plain HTTP.
  const secure = !isLocal(url) || url.protocol === "https:";

  // SameSite=Lax already keeps the GM cookie off cross-site requests; refusing
  // foreign origins on anything that changes state is the second lock.
  const changesState = method !== "GET" && method !== "HEAD";
  if ((changesState || request.headers.get("Upgrade")) && !sameOrigin(request, url)) {
    return fail(403, "Cross-origin request refused.");
  }

  if (pathname === "/api/me" && method === "GET") {
    return json({ gm: await isGm(request, env), configured: Boolean(env.GM_PASSWORD), google: googleConfigured(env) });
  }

  if (pathname === "/api/auth/google" && method === "GET") {
    return startGoogleSignIn(env, url, secure);
  }

  if (pathname === "/api/auth/google/callback" && method === "GET") {
    // GOOGLE_TOKEN_URL stands in for Google in local tests; it is never used on the real site.
    const tokenUrl = isLocal(url) && env.GOOGLE_TOKEN_URL ? env.GOOGLE_TOKEN_URL : undefined;
    return finishGoogleSignIn(request, env, url, secure, tokenUrl);
  }

  if (pathname === "/api/login" && method === "POST") {
    if (!env.GM_PASSWORD) return fail(503, "The GM password hasn't been set on the server yet.");
    const key = loginKey(request);
    const directory = env.DIRECTORY.getByName("main");
    const body = await readJson(request);
    const password = typeof body?.password === "string" ? body.password : "";
    // The attempt is counted before the password is checked, in one step.
    if (!(await directory.beginLoginAttempt(key))) {
      return fail(429, "Too many wrong passwords. Try again in 15 minutes.");
    }
    if (!(await passwordMatches(password, env))) return fail(401, "Wrong password.");
    await directory.loginSucceeded(key);
    return json({ gm: true }, 200, { "Set-Cookie": await sessionCookie(env, secure) });
  }

  if (pathname === "/api/logout" && method === "POST") {
    return json({ gm: false }, 200, { "Set-Cookie": clearCookie(secure) });
  }

  if (pathname === "/api/rooms") {
    if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
    const directory = env.DIRECTORY.getByName("main");
    if (method === "GET") return json(await directory.listRooms());
    if (method === "POST") {
      const body = await readJson(request);
      const name = cleanText(body?.name, LIMITS.name) || "New room";
      const id = randomId(12);
      const info = await env.ROOMS.getByName(id).create(id, name);
      await directory.addRoom(id, name, info.createdAt);
      return json(info, 201);
    }
    return fail(405, "Method not allowed.");
  }

  // Anything that isn't shaped like one of our room ids is turned away here,
  // before a Durable Object is ever involved.
  const roomMatch = pathname.match(new RegExp(`^/api/rooms/(${ROOM_ID})(/[a-z]+)?$`));
  if (pathname.startsWith("/api/rooms/") && !roomMatch) return fail(404, "Room not found.");
  if (roomMatch) {
    const roomId = roomMatch[1];
    const sub = roomMatch[2] ?? "";
    const stub = env.ROOMS.getByName(roomId);

    if (sub === "" && method === "DELETE") {
      if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
      await stub.destroy(roomId);
      await env.DIRECTORY.getByName("main").removeRoom(roomId);
      return json({ deleted: roomId });
    }

    if (sub === "/ws" && method === "GET") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return fail(426, "Expected a WebSocket upgrade.");
      }
      // A table display joins as a display even in the GM's own browser: it only ever
      // gets what players see.
      const key = url.searchParams.get("display");
      if (key !== null && !(await displayKeyValid(env, roomId, key))) {
        return fail(403, "That display link isn't valid.");
      }
      const role: Role = key === null && (await isGm(request, env)) ? "gm" : "player";
      const headers = new Headers(request.headers);
      // Always overwritten here, so a browser can't claim to be the GM, or a display, by sending them.
      headers.set("X-Tabletop-Role", role);
      headers.delete("X-Tabletop-Display");
      if (key !== null) headers.set("X-Tabletop-Display", "1");
      return stub.fetch(new Request(request, { headers }));
    }

    if (sub === "/display" && method === "GET") {
      // With a key: is this display link good? (Asked by the display page, before it connects.)
      const key = url.searchParams.get("key");
      if (key !== null) return json({ valid: await displayKeyValid(env, roomId, key) });
      if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
      return json({ key: await displayKey(env, roomId) });
    }

    if (sub === "/assets" && method === "POST") {
      const kind = url.searchParams.get("kind");
      if (kind !== "map" && kind !== "token") return fail(400, "Unknown image kind.");
      const role: Role = (await isGm(request, env)) ? "gm" : "player";
      const uid = request.headers.get("X-Tabletop-User");
      // The GM's images belong to the GM role, never to a browser id a player could copy.
      const owner = role === "gm" ? GM_OWNER : isId(uid) ? uid : "unknown";
      // A first check before reading the body (the size is checked once it's known).
      const early = await stub.uploadRefusal(role, kind, owner, 0);
      if (early) return fail(403, early);
      const declared = Number(request.headers.get("Content-Length") ?? "0");
      const limit = MAX_UPLOAD_BYTES[kind];
      if (declared > limit) return fail(413, `Images must be under ${limit / 1024 / 1024} MB.`);
      const body = await request.arrayBuffer();
      if (body.byteLength === 0) return fail(400, "The upload was empty.");
      if (body.byteLength > limit) return fail(413, `Images must be under ${limit / 1024 / 1024} MB.`);
      const mime = sniffImage(new Uint8Array(body, 0, Math.min(32, body.byteLength)));
      if (!mime) return fail(415, "Only PNG, JPEG, WebP, GIF or AVIF images can be uploaded.");
      const width = Number(url.searchParams.get("w"));
      const height = Number(url.searchParams.get("h"));
      if (!(width >= 1 && width <= 30000 && height >= 1 && height <= 30000)) {
        return fail(400, "Missing or impossible image dimensions.");
      }
      const refusal = await stub.uploadRefusal(role, kind, owner, body.byteLength);
      if (refusal) return fail(403, refusal);
      const assetId = randomId(16);
      const key = fileKey(roomId, assetId);
      await env.FILES.put(key, body, {
        httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" },
      });
      const asset: Asset = {
        id: assetId,
        name: cleanText(url.searchParams.get("name"), LIMITS.name) || "Image",
        kind,
        width: Math.round(width),
        height: Math.round(height),
        mime,
        bytes: body.byteLength,
        owner,
        createdAt: Date.now(),
      };
      try {
        await stub.addAsset(asset, role);
      } catch (err) {
        // The room went away or filled up mid-upload: don't leave the file behind.
        await env.FILES.delete(key).catch(() => undefined);
        return fail(409, err instanceof Error ? err.message : "The upload couldn't be saved.");
      }
      return json(asset, 201);
    }

    return fail(404, "Not found.");
  }

  const fileMatch = pathname.match(new RegExp(`^/api/files/(${ROOM_ID})/([A-Za-z0-9]{1,64})$`));
  if (fileMatch && (method === "GET" || method === "HEAD")) {
    const obj = await env.FILES.get(fileKey(fileMatch[1], fileMatch[2]), { onlyIf: request.headers });
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

  return fail(404, "Not found.");
}

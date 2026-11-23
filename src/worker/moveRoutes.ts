// GM: tokens moved to another of their rooms (shared/roomMove.ts), and that room's maps to choose from.
// The tokens, their pictures, stats and HP, campaign notes' links and the spells on them go into the
// other room first, in one go (Room.importTokens); only once it has them all are they taken out of this
// one (Room.removeMoved). If anything fails before that, nothing leaves and the GM is told why; a
// picture copied for them is deleted again. Should taking them out fail after they've arrived, they're
// in both rooms (never in neither), and the GM is told to delete them here.
import { randomId } from "../shared/ids";
import { MAX_MOVE, type MoveResult } from "../shared/roomMove";
import { isId } from "../shared/sanitize";
import type { Asset } from "../shared/types";
import { isGm } from "./auth";
import { fileKey } from "./room";

const HSTS = "max-age=31536000; includeSubDomains";
const MAX_JSON_BYTES = 16 * 1024;
const ROOM = /^[A-Za-z0-9]{12}$/;
const MAPS = /^\/api\/rooms\/([A-Za-z0-9]{12})\/maps$/;
const MOVE = /^\/api\/rooms\/([A-Za-z0-9]{12})\/move$/;

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

/** The response for a route about moving tokens between rooms, or null when the path isn't one. */
export async function moveRoute(request: Request, env: Env, pathname: string, method: string): Promise<Response | null> {
  const maps = pathname.match(MAPS);
  const move = pathname.match(MOVE);
  if (!maps && !move) return null;
  if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
  const rooms = await env.DIRECTORY.getByName("main").listRooms();

  // A room's maps, for choosing where tokens go.
  if (maps) {
    if (method !== "GET") return fail(405, "Method not allowed.");
    if (!rooms.some((r) => r.id === maps[1])) return fail(404, "Room not found.");
    const list = await env.ROOMS.getByName(maps[1]).mapList();
    return list ? json(list) : fail(404, "Room not found.");
  }

  if (method !== "POST") return fail(405, "Method not allowed.");
  const from = move![1];
  const body = await readJson(request);
  const to = typeof body?.to === "string" ? body.to : "";
  const sceneId = body?.scene;
  const ids = Array.isArray(body?.tokens) ? [...new Set(body.tokens.filter(isId))].slice(0, MAX_MOVE) : [];
  if (!ROOM.test(to) || !isId(sceneId) || !ids.length) return fail(400, "Say which tokens, which room and which map.");
  if (to === from) return fail(400, "They're in this room already.");
  const target = rooms.find((r) => r.id === to);
  if (!rooms.some((r) => r.id === from) || !target) return fail(404, "Room not found.");
  const here = env.ROOMS.getByName(from);
  const there = env.ROOMS.getByName(to);

  const bundle = await here.exportTokens(ids);
  if ("error" in bundle) return fail(409, bundle.error);

  // Their pictures: the other room's own where it has them already, else copied there.
  const pictures: Record<string, string> = { ...(await there.picturesFor(bundle.assets)) };
  const made: Asset[] = [];
  const unmake = () => Promise.all(made.map((a) => env.FILES.delete(fileKey(to, a.id)).catch(() => undefined)));
  try {
    for (const a of bundle.assets) {
      if (pictures[a.id]) continue;
      const obj = await env.FILES.get(fileKey(from, a.id));
      // Its file has gone here: the token arrives without a picture, as it shows here.
      if (!obj) continue;
      const copy: Asset = { ...a, id: randomId(16), createdAt: Date.now() };
      await env.FILES.put(fileKey(to, copy.id), await obj.arrayBuffer(), { httpMetadata: { contentType: a.mime, cacheControl: "public, max-age=31536000, immutable" } });
      made.push(copy);
      pictures[a.id] = copy.id;
    }
  } catch {
    await unmake();
    return fail(502, "Nothing moved: their pictures couldn't be copied. Try again.");
  }

  let arrived: Awaited<ReturnType<typeof there.importTokens>>;
  try {
    arrived = await there.importTokens({ ...bundle, to: sceneId, pictures, made });
  } catch {
    arrived = { error: `“${target.name}” couldn't take them. Try again.` };
  }
  if ("error" in arrived) {
    await unmake();
    return fail(409, `Nothing moved: ${arrived.error}`);
  }

  // They're there: now, and only now, they leave here.
  let stuck = false;
  try {
    await here.removeMoved(bundle.tokens.map((t) => t.id));
  } catch {
    stuck = true;
  }
  const result: MoveResult = {
    moved: bundle.tokens.map((t) => t.label),
    room: { id: target.id, name: target.name },
    map: arrived.map,
    ...(stuck ? { stuck } : {}),
  };
  return json(result);
}

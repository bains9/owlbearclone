// The campaign's calendar's routes (shared/calendar.ts): everyone at one of the GM's tables reads
// it (the GM's eyes-only events left out for players); the GM changes it a piece at a time
// (PATCH), replaces it whole (PUT), brings it in from Fantasy Calendar by its public link or from
// its export file (import), keeps a copy (export), or takes it away (DELETE). It lives in the
// Directory, once for every room, like the party.

import { CALENDAR_LIMITS, forPlayers, fromFantasyCalendar, newCalendar, sanitizeCalendar, type CalEvent, type Calendar } from "../shared/calendar";
import { cleanText } from "../shared/sanitize";
import { isGm } from "./auth";

/** Fantasy Calendar's public reading of a calendar, by the hash in its link. */
const FC_API = "https://app.fantasy-calendar.com/api/v1/calendar/";
const FC_HASH = /^[a-f0-9]{32}$/;
/** The calendar as JSON may be this big (the Directory keeps it as one row). */
const MAX_BYTES = 2 * 1024 * 1024;
/** Fantasy Calendar's answer may be this big. */
const MAX_FC_BYTES = 8 * 1024 * 1024;
const FC_MS = 20_000;

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status: number, message: string): Response => json({ error: message }, status);

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await request.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Directory = ReturnType<Env["DIRECTORY"]["getByName"]>;

async function stored(directory: Directory): Promise<{ calendar: Calendar | null; version: number }> {
  const row = await directory.calendar();
  if (!row) return { calendar: null, version: 0 };
  try {
    return { calendar: sanitizeCalendar(JSON.parse(row.json)), version: row.version };
  } catch {
    return { calendar: null, version: row.version };
  }
}

async function keep(directory: Directory, calendar: Calendar): Promise<{ version: number } | { error: string }> {
  const text = JSON.stringify(calendar);
  if (text.length > MAX_BYTES) return { error: "The calendar is too big to keep (over 2 MB). Take some events out." };
  return { version: await directory.setCalendar(text) };
}

/** GET /api/rooms/:id/calendar: the calendar for someone at the table, or null before the GM makes one. */
export async function roomCalendar(request: Request, env: Env, roomId: string): Promise<Response> {
  const directory = env.DIRECTORY.getByName("main");
  if (!(await directory.listRooms()).some((r) => r.id === roomId)) return fail(404, "Room not found.");
  const { calendar, version } = await stored(directory);
  const gm = await isGm(request, env);
  return json({ calendar: calendar ? (gm ? calendar : forPlayers(calendar)) : null, version });
}

/** The GM's calendar routes, or null when the request isn't one. */
export async function calendarRoute(request: Request, env: Env, pathname: string, method: string): Promise<Response | null> {
  if (!pathname.startsWith("/api/calendar")) return null;
  if (!(await isGm(request, env))) return fail(401, "Sign in as the GM first.");
  const directory = env.DIRECTORY.getByName("main");

  if (pathname === "/api/calendar/export" && method === "GET") {
    const { calendar } = await stored(directory);
    if (!calendar) return fail(404, "There's no calendar yet.");
    return new Response(JSON.stringify(calendar, null, 1), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${calendar.name.replace(/[^A-Za-z0-9 _-]/g, "")}.tabletop-calendar.json"` },
    });
  }

  if (pathname === "/api/calendar/import" && method === "POST") {
    const b = await body(request);
    const { calendar: existing } = await stored(directory);
    let data: unknown;
    let hash: string | undefined;
    if (b && "data" in b) {
      data = b.data;
      // An export from here goes straight back in.
      const own = sanitizeCalendar(data);
      if (own && !(data as { static_data?: unknown }).static_data) {
        const kept = await keep(directory, own);
        return "error" in kept ? fail(413, kept.error) : json({ ok: true, version: kept.version, calendar: own, notes: [] });
      }
    } else {
      const link = cleanText(b?.link, 300) ?? "";
      hash = (link.match(/[a-f0-9]{32}/) ?? [])[0];
      if (!hash || !FC_HASH.test(hash)) return fail(400, "That isn't a Fantasy Calendar link: it should have the calendar's 32-character code in it.");
      let res: Response;
      try {
        res = await fetch(FC_API + hash, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FC_MS) });
      } catch {
        return fail(502, "Fantasy Calendar didn't answer in time. Try again in a moment.");
      }
      if (!res.ok) return fail(502, `Fantasy Calendar answered ${res.status}. Is the calendar public (Allow viewing)?`);
      const text = await res.text();
      if (text.length > MAX_FC_BYTES) return fail(413, "That calendar is too big to bring in.");
      try {
        data = JSON.parse(text);
      } catch {
        return fail(502, "Fantasy Calendar's answer couldn't be read.");
      }
      if (!(data as { static_data?: unknown })?.static_data) return fail(502, "That isn't a calendar Fantasy Calendar will show: check the link, and that the calendar is public.");
    }
    if (!(data as { static_data?: unknown })?.static_data) return fail(400, "That isn't a Fantasy Calendar file (it has no static_data), nor one from here.");
    const { calendar, notes } = fromFantasyCalendar(data, existing, hash);
    const clean = sanitizeCalendar(calendar);
    if (!clean) return fail(400, "That calendar couldn't be made sense of.");
    const kept = await keep(directory, clean);
    if ("error" in kept) return fail(413, kept.error);
    return json({ ok: true, version: kept.version, calendar: clean, notes });
  }

  if (pathname !== "/api/calendar") return null;

  if (method === "GET") {
    const { calendar, version } = await stored(directory);
    return json({ calendar, version });
  }

  if (method === "DELETE") {
    const version = await directory.setCalendar("null");
    return json({ ok: true, version });
  }

  if (method === "PUT") {
    const clean = sanitizeCalendar(await body(request));
    if (!clean) return fail(400, "That isn't a calendar.");
    const kept = await keep(directory, clean);
    return "error" in kept ? fail(413, kept.error) : json({ ok: true, version: kept.version, calendar: clean });
  }

  if (method === "PATCH") {
    const b = await body(request);
    if (!b) return fail(400, "Nothing to change.");
    const { calendar: had } = await stored(directory);
    const c: Calendar = had ?? newCalendar();
    const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
    const today = int(b.today);
    if (today !== null) c.today = Math.max(-1e8, Math.min(1e8, today));
    if (typeof b.name === "string") c.name = cleanText(b.name, CALENDAR_LIMITS.name) || c.name;
    if (typeof b.climate === "string" && c.climates.some((x) => x.name === b.climate)) c.climate = b.climate;
    if (b.newWeather === true) c.weatherSeed = Math.floor(Math.random() * 1e9) + 1;
    const reroll = int(b.reroll);
    if (reroll !== null) c.rerolls[String(reroll)] = Math.min(999, (c.rerolls[String(reroll)] ?? 0) + 1);
    if (b.note && typeof b.note === "object") {
      const note = b.note as { epoch?: unknown; text?: unknown };
      const epoch = int(note.epoch);
      if (epoch !== null) {
        const text = cleanText(note.text, CALENDAR_LIMITS.note);
        if (text) c.weatherNotes[String(epoch)] = text;
        else delete c.weatherNotes[String(epoch)];
      }
    }
    if (Array.isArray(b.delete)) {
      const gone = new Set(b.delete.filter((id): id is string => typeof id === "string"));
      c.events = c.events.filter((e) => !gone.has(e.id));
    }
    if (Array.isArray(b.upsert)) {
      const fresh = sanitizeCalendar({ ...c, events: b.upsert })?.events ?? [];
      for (const e of fresh) {
        const at = c.events.findIndex((x) => x.id === e.id);
        const old: CalEvent | undefined = c.events[at];
        // An event from Fantasy Calendar keeps its link to it, so a sync still knows it.
        if (old?.fc !== undefined) e.fc = old.fc;
        if (at >= 0) c.events[at] = e;
        else c.events.push(e);
      }
      if (c.events.length > CALENDAR_LIMITS.events) return fail(413, `A calendar holds at most ${CALENDAR_LIMITS.events} events.`);
    }
    const clean = sanitizeCalendar(c);
    if (!clean) return fail(400, "That change doesn't make a calendar.");
    const kept = await keep(directory, clean);
    return "error" in kept ? fail(413, kept.error) : json({ ok: true, version: kept.version, calendar: clean });
  }

  return fail(405, "Method not allowed.");
}

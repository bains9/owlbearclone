// Dungeon (dungeon.parhome.ca, the map maker) signs in with Table's GM sign-in. Table's
// cookie stays on table.parhome.ca, so Dungeon keeps a session of its own, and only Table
// can make or check one:
// 1. Dungeon, with no session, sends the browser to /api/dungeon/hop here.
// 2. The signed-in GM is sent straight back to Dungeon's /auth/table with a one-time code:
//    signed, good for a minute, and spent the first time it's used. Anyone else is sent to
//    the home page to sign in, which then carries on to the hop (Home.tsx).
// 3. Dungeon's Worker trades the code for a session, and checks that session on every
//    request, through the DungeonGate entrypoint (dungeonGate.ts): a service binding, Worker
//    to Worker, never through the browser.
// A Dungeon session ends the way Table's do: when GM_PASSWORD changes, or when its Google
// account is taken off GM_EMAILS. It lasts 12 hours; then Dungeon asks again, which a GM
// still signed in here doesn't see.

import { randomId } from "../shared/ids";
import { b64urlText, fromB64urlText, gmEmails, gmWho, sessionValue, sessionWho, signWith, verifyWith } from "./auth";
import type { GmWho } from "./auth";

const SITE = "dungeon|";
const HOP_MS = 60_000;
export const DUNGEON_SESSION_SECONDS = 12 * 3600;

/** A code that changing the GM password, or taking the account off GM_EMAILS, also spoils. */
function hopLabel(env: Env, who: GmWho): string {
  return who.kind === "password" ? `dungeon-hop|${env.GM_PASSWORD}` : "dungeon-hop-google";
}

/**
 * A path on Dungeon to come back to, or "/". Only a path, so the hop can never send
 * anyone to another site.
 */
export function dungeonPath(raw: string | null): string {
  if (!raw || raw.length > 512 || !/^\/(?![/\\])[^\s\\]*$/.test(raw)) return "/";
  return raw;
}

/** The one-time code: h1.<expiry>.<nonce>.<"p", or the email in base64url>.<signature>. */
export async function hopCode(env: Env, who: GmWho): Promise<string> {
  const exp = Date.now() + HOP_MS;
  const payload = `h1.${exp}.${randomId(16)}.${who.kind === "password" ? "p" : b64urlText(who.email)}`;
  return `${payload}.${await signWith(env, hopLabel(env, who), payload)}`;
}

/** A Dungeon session for a one-time code, or null when the code is bad, old or spent. */
export async function redeemHop(env: Env, code: string): Promise<string | null> {
  const parts = code.length < 400 ? code.split(".") : [];
  if (parts.length !== 5 || parts[0] !== "h1") return null;
  const [, expRaw, nonce, whoPart, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now() || !/^[A-Za-z0-9]{16}$/.test(nonce)) return null;
  let who: GmWho;
  if (whoPart === "p") {
    if (!env.GM_PASSWORD) return null;
    who = { kind: "password" };
  } else {
    const email = fromB64urlText(whoPart);
    if (!email || !gmEmails(env).has(email)) return null;
    who = { kind: "google", email };
  }
  if (!(await verifyWith(env, hopLabel(env, who), parts.slice(0, 4).join("."), sig))) return null;
  // Once only, so a code that got out (a shared address, a screenshot) is already spent.
  if (!(await env.DIRECTORY.getByName("main").spendHop(nonce, exp))) return null;
  return sessionValue(env, who, DUNGEON_SESSION_SECONDS, SITE);
}

/** Is this Dungeon session still good? */
export async function dungeonSessionOk(env: Env, session: string): Promise<boolean> {
  return session.length < 400 && (await sessionWho(session, env, SITE)) !== null;
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

/** GET /api/dungeon/hop?to=<path on Dungeon>: step 2 above. */
export async function dungeonHop(request: Request, env: Env, url: URL): Promise<Response> {
  const to = dungeonPath(url.searchParams.get("to"));
  const who = await gmWho(request, env);
  if (!who) return redirect(`/?then=dungeon${to === "/" ? "" : `&to=${encodeURIComponent(to)}`}`);
  const back = new URL("/auth/table", env.DUNGEON_URL);
  back.searchParams.set("code", await hopCode(env, who));
  if (to !== "/") back.searchParams.set("to", to);
  return redirect(back.toString());
}

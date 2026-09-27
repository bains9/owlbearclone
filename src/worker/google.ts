// GM sign-in with Google: OpenID Connect's authorization code flow, with PKCE.
//
// /api/auth/google sends the browser to Google with a random state, nonce and PKCE
// challenge, which are also kept (signed) in a short-lived cookie. Google sends it
// back to /api/auth/google/callback with a code. The Worker trades the code for an
// ID token directly with Google (over TLS, authenticated with the client secret, so
// the token needs no signature check of its own), checks who it names, and signs
// them in as the GM if their address is in GM_EMAILS. Players never sign in.
//
// Needs three secrets: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Google Cloud
// "OAuth client ID" for a web application, with <site>/api/auth/google/callback as
// an authorized redirect URI) and GM_EMAILS.

import { randomId } from "../shared/ids";
import { b64url, fromB64urlText, gmEmails, googleSessionCookie, readCookie, setCookie, signWith, verifyWith } from "./auth";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const STATE_COOKIE = "tt_oauth";
const STATE_PATH = "/api/auth/google";
const STATE_SECONDS = 600;
const STATE_KEY = "google-oauth-state";

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && gmEmails(env).size);
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

/** Back to the start page, saying why sign-in didn't happen. */
function fail(reason: string, secure: boolean): Response {
  return redirect(`/?signin=${reason}`, [setCookie(STATE_COOKIE, "", 0, secure, STATE_PATH)]);
}

async function sha256(text: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function startGoogleSignIn(env: Env, url: URL, secure: boolean): Promise<Response> {
  if (!googleConfigured(env)) return fail("off", secure);
  const state = randomId(32);
  const nonce = randomId(32);
  // PKCE verifier: 64 characters from [A-Za-z0-9], well inside what the spec allows.
  const verifier = randomId(64);
  const exp = Date.now() + STATE_SECONDS * 1000;
  const payload = `${state}.${nonce}.${verifier}.${exp}`;
  const sig = await signWith(env, STATE_KEY, payload);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${url.origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return redirect(`${AUTH_URL}?${params}`, [setCookie(STATE_COOKIE, `${payload}.${sig}`, STATE_SECONDS, secure, STATE_PATH)]);
}

/** The claims in a JWT's payload, unverified (see the note at the top). */
function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  // Google pads nothing, but be lenient about the encoding of what it sent us directly.
  const text = fromB64urlText(part) ?? (() => {
    try {
      return atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return null;
    }
  })();
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * `tokenUrl` replaces Google's token endpoint in local testing only (the caller
 * passes it just for localhost), so the whole flow can be exercised without Google.
 */
export async function finishGoogleSignIn(
  request: Request,
  env: Env,
  url: URL,
  secure: boolean,
  tokenUrl = TOKEN_URL,
): Promise<Response> {
  if (!googleConfigured(env)) return fail("off", secure);
  if (url.searchParams.get("error")) return fail("cancelled", secure);

  // The state must match the one this browser was sent off with, and still be fresh.
  const saved = readCookie(request, STATE_COOKIE)?.split(".");
  if (!saved || saved.length !== 5) return fail("expired", secure);
  const [state, nonce, verifier, expRaw, sig] = saved;
  if (!(await verifyWith(env, STATE_KEY, `${state}.${nonce}.${verifier}.${expRaw}`, sig))) return fail("expired", secure);
  if (!(Number(expRaw) > Date.now()) || url.searchParams.get("state") !== state) return fail("expired", secure);
  const code = url.searchParams.get("code");
  if (!code) return fail("expired", secure);

  let claims: Record<string, unknown> | null = null;
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${url.origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
    if (!res.ok || typeof body?.id_token !== "string") {
      console.error(JSON.stringify({ message: "Google token exchange failed", status: res.status }));
      return fail("failed", secure);
    }
    claims = jwtClaims(body.id_token);
  } catch (err) {
    console.error(JSON.stringify({ message: "Google token exchange failed", error: String(err) }));
    return fail("failed", secure);
  }

  if (
    !claims ||
    !ISSUERS.has(String(claims.iss)) ||
    claims.aud !== env.GOOGLE_CLIENT_ID ||
    !(Number(claims.exp) * 1000 > Date.now()) ||
    claims.nonce !== nonce
  ) {
    return fail("failed", secure);
  }
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || claims.email_verified !== true) return fail("unverified", secure);
  if (!gmEmails(env).has(email)) return fail("denied", secure);

  return redirect("/", [
    setCookie(STATE_COOKIE, "", 0, secure, STATE_PATH),
    await googleSessionCookie(env, email, secure),
  ]);
}

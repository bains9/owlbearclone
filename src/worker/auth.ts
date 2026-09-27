// GM sign-in. There is one GM password (the GM_PASSWORD secret). Signing in sets
// an HttpOnly cookie holding an expiry and an HMAC over it.
//
// The HMAC key is derived from two things: a random 32-byte secret the Directory
// Durable Object generates on first use and never hands out, and the password
// itself. So a stolen cookie can't be used to guess the password offline, and
// changing GM_PASSWORD signs every existing session out.

const COOKIE = "tt_gm";
const SESSION_DAYS = 30;
const encoder = new TextEncoder();

let cachedKey: { password: string; key: CryptoKey } | null = null;

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function sessionKey(env: Env): Promise<CryptoKey | null> {
  const password = env.GM_PASSWORD;
  if (!password) return null;
  if (cachedKey && cachedKey.password === password) return cachedKey.key;
  const secret = await env.DIRECTORY.getByName("main").sessionSecret();
  const base = await crypto.subtle.importKey("raw", fromB64url(secret)!, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(`gm-session|${password}`));
  const key = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  cachedKey = { password, key };
  return key;
}

export async function passwordMatches(given: string, env: Env): Promise<boolean> {
  const expected = env.GM_PASSWORD;
  if (!expected) return false;
  // Hash both so the comparison is over equal-length values, then compare in constant time.
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function sessionCookie(env: Env, secure: boolean): Promise<string> {
  const key = await sessionKey(env);
  if (!key) throw new Error("GM_PASSWORD is not set");
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `v1.${exp}`;
  const sig = b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return cookie(`${payload}.${sig}`, SESSION_DAYS * 86400, secure);
}

export function clearCookie(secure: boolean): string {
  return cookie("", 0, secure);
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function isGm(request: Request, env: Env): Promise<boolean> {
  const raw = request.headers.get("Cookie");
  if (!raw) return false;
  let value: string | null = null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) value = rest.join("=");
  }
  if (!value) return false;
  const [version, expRaw, sig] = value.split(".");
  if (version !== "v1" || !expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const key = await sessionKey(env);
  if (!key) return false;
  const sigBytes = fromB64url(sig);
  // Only the exact encoding we issue: base64 has spare bits in its last character, and
  // accepting variants would make "the same cookie" mean more than one string.
  if (!sigBytes || b64url(sigBytes.buffer) !== sig) return false;
  return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`${version}.${expRaw}`));
}

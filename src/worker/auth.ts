// GM sign-in. Two ways in, both ending in the same HttpOnly session cookie:
// - the GM password (the GM_PASSWORD secret), and
// - Google, for the accounts listed in the GM_EMAILS secret (see google.ts).
//
// Cookies are signed with HMAC keys derived from a random 32-byte secret the
// Directory Durable Object generates on first use and never hands out. A password
// session's key also mixes in the password, so a stolen cookie can't be used to
// guess the password offline and changing GM_PASSWORD signs those sessions out. A
// Google session names the account, and stops working as soon as that account is
// taken off GM_EMAILS.

const COOKIE = "tt_gm";
const SESSION_DAYS = 30;
const encoder = new TextEncoder();

let cachedBase: { secret: string; key: CryptoKey } | null = null;
const derivedKeys = new Map<string, CryptoKey>();

export function b64url(bytes: ArrayBuffer): string {
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

export function b64urlText(s: string): string {
  return b64url(encoder.encode(s).buffer as ArrayBuffer);
}

/** Decodes base64url text, accepting only the exact encoding b64urlText produces. */
export function fromB64urlText(s: string): string | null {
  const bytes = fromB64url(s);
  if (!bytes || b64url(bytes.buffer) !== s) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** A signing key for one purpose, derived from the Directory's secret. */
async function derivedKey(env: Env, label: string): Promise<CryptoKey> {
  const secret = await env.DIRECTORY.getByName("main").sessionSecret();
  if (!cachedBase || cachedBase.secret !== secret) {
    const key = await crypto.subtle.importKey("raw", fromB64url(secret)!, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    cachedBase = { secret, key };
    derivedKeys.clear();
  }
  const cached = derivedKeys.get(label);
  if (cached) return cached;
  const raw = await crypto.subtle.sign("HMAC", cachedBase.key, encoder.encode(label));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  if (derivedKeys.size > 8) derivedKeys.clear();
  derivedKeys.set(label, key);
  return key;
}

const passwordLabel = (password: string) => `gm-session|${password}`;
const GOOGLE_SESSION = "gm-session-google";

/** Signs `payload` with the key for `label`: the signature, base64url. */
export async function signWith(env: Env, label: string, payload: string): Promise<string> {
  return b64url(await crypto.subtle.sign("HMAC", await derivedKey(env, label), encoder.encode(payload)));
}

export async function verifyWith(env: Env, label: string, payload: string, sig: string): Promise<boolean> {
  const sigBytes = fromB64url(sig);
  // Only the exact encoding we issue: base64 has spare bits in its last character, and
  // accepting variants would make "the same cookie" mean more than one string.
  if (!sigBytes || b64url(sigBytes.buffer) !== sig) return false;
  return crypto.subtle.verify("HMAC", await derivedKey(env, label), sigBytes, encoder.encode(payload));
}

/** The Google accounts that may be the GM, from the GM_EMAILS secret (comma or space separated). */
export function gmEmails(env: Env): Set<string> {
  return new Set(
    (env.GM_EMAILS ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
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

/** A session from the GM password: v1.<expiry>.<signature>. */
export async function sessionCookie(env: Env, secure: boolean): Promise<string> {
  if (!env.GM_PASSWORD) throw new Error("GM_PASSWORD is not set");
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `v1.${exp}`;
  const sig = await signWith(env, passwordLabel(env.GM_PASSWORD), payload);
  return setCookie(COOKIE, `${payload}.${sig}`, SESSION_DAYS * 86400, secure, "/");
}

/** A session from Google: g1.<expiry>.<email, base64url>.<signature>. */
export async function googleSessionCookie(env: Env, email: string, secure: boolean): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `g1.${exp}.${b64urlText(email)}`;
  const sig = await signWith(env, GOOGLE_SESSION, payload);
  return setCookie(COOKIE, `${payload}.${sig}`, SESSION_DAYS * 86400, secure, "/");
}

export function clearCookie(secure: boolean): string {
  return setCookie(COOKIE, "", 0, secure, "/");
}

export function setCookie(name: string, value: string, maxAge: number, secure: boolean, path: string): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("Cookie");
  if (!raw) return null;
  let value: string | null = null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) value = rest.join("=");
  }
  return value;
}

export async function isGm(request: Request, env: Env): Promise<boolean> {
  const value = readCookie(request, COOKIE);
  if (!value) return false;
  const parts = value.split(".");
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (parts[0] === "v1" && parts.length === 3) {
    if (!env.GM_PASSWORD) return false;
    return verifyWith(env, passwordLabel(env.GM_PASSWORD), `v1.${parts[1]}`, parts[2]);
  }
  if (parts[0] === "g1" && parts.length === 4) {
    const email = fromB64urlText(parts[2]);
    if (!email || !gmEmails(env).has(email)) return false;
    return verifyWith(env, GOOGLE_SESSION, `g1.${parts[1]}.${parts[2]}`, parts[3]);
  }
  return false;
}

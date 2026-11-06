// Encrypting the GM's campaign notes in the backups (backupJob.ts). AES-256-GCM, with a key that stays
// in this Table and never goes to Drive. The IV comes from the contents (a keyed hash), so the same
// note makes the same result each night: what hasn't changed isn't sent again, which is all that
// anyone with the file can learn. Opening with the wrong key, or a file that's been changed, throws.
import { fromBase64, toBase64 } from "../shared/backups";

const IV_BYTES = 12;

async function subkey(key: string, label: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${label}|${key}`));
}

function aes(key: string): Promise<CryptoKey> {
  return subkey(key, "table-notes-aes").then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
}

async function ivFor(key: string, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await subkey(key, "table-notes-iv");
  const hmac = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmac, bytes)).slice(0, IV_BYTES);
}

export async function sealBytes(key: string, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = await ivFor(key, bytes);
  const secret = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(key), bytes));
  const out = new Uint8Array(IV_BYTES + secret.length);
  out.set(iv);
  out.set(secret, IV_BYTES);
  return out;
}

export async function openBytes(key: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = sealed.slice(0, IV_BYTES);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aes(key), sealed.slice(IV_BYTES)));
}

export async function sealJson(key: string, value: unknown): Promise<string> {
  return toBase64(await sealBytes(key, new Uint8Array(new TextEncoder().encode(JSON.stringify(value)))));
}

export async function openJson<T>(key: string, sealed: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await openBytes(key, fromBase64(sealed)))) as T;
}

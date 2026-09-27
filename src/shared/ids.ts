const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Room ids are 12 base62 characters; a room link with anything else is mistyped or cut short. */
export function isRoomId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9]{12}$/.test(v);
}

/** Random base62 id from the platform CSPRNG. 12 characters is about 71 bits. */
export function randomId(length = 12): string {
  const out: string[] = [];
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      // 248 = 62 * 4: reject the top values so every character is equally likely.
      if (b < 248 && out.length < length) out.push(ALPHABET[b % 62]);
    }
  }
  return out.join("");
}

// Readers for the Godot 3 text values that Dungeondraft writes inside its JSON:
//   "Vector2( 12.5, -3 )"
//   "PoolByteArray( 0, 255, ... )", "PoolIntArray( -1, 3 )"
//   "PoolVector2Array( x0, y0, x1, y1, ... )"
//   colours "aarrggbb" (Godot 3 Color.to_html(true) is ARGB)
//   node ids: strings are hexadecimal ("5b" = 91); some older saves write plain decimal numbers.
//
// Every reader is total: it returns null (never throws) on anything it does not recognise,
// and never allocates more than the caller's limit. Pure; no DOM, no Node APIs.
// The input comes from files of any origin, so every regex is linear (no ambiguous repeats)
// and every number token is length-capped before it is matched.

export interface Vec2 { x: number; y: number }

/** Colour with 0..255 channels. */
export interface RGBA { r: number; g: number; b: number; a: number }

// `\d+(?:\.\d*)?` rather than `\d+\.?\d*`: the latter backtracks quadratically on a long digit run.
const NUM_RE = /^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?\s*$/;
/** Longest number token accepted (Godot prints floats in well under 32 characters). */
const MAX_NUMBER_CHARS = 128;

function finiteNumber(s: string): number | null {
  if (s.length > MAX_NUMBER_CHARS && s.trim().length > MAX_NUMBER_CHARS) return null;
  if (!NUM_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Accepts a JS number too (some fields are plain JSON numbers). */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return finiteNumber(v);
  return null;
}

export function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return null;
}

export function str(v: unknown, maxLen = 4096): string | null {
  return typeof v === "string" && v.length <= maxLen ? v : null;
}

/** Strips "Name(" and ")" and returns the inner text, or null when the wrapper does not match. */
function inner(v: string, name: string): string | null {
  let i = 0;
  const n = v.length;
  while (i < n && v.charCodeAt(i) <= 32) i++;
  if (!v.startsWith(name, i)) return null;
  i += name.length;
  while (i < n && v.charCodeAt(i) <= 32) i++;
  if (v.charCodeAt(i) !== 40 /* ( */) return null;
  let j = n - 1;
  while (j > i && v.charCodeAt(j) <= 32) j--;
  if (v.charCodeAt(j) !== 41 /* ) */) return null;
  return v.slice(i + 1, j);
}

/** "Vector2( x, y )" -> {x, y}. Also accepts [x, y] and {x, y}. */
export function parseVector2(v: unknown): Vec2 | null {
  if (Array.isArray(v) && v.length === 2) {
    const x = num(v[0]), y = num(v[1]);
    return x === null || y === null ? null : { x, y };
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const x = num(o.x), y = num(o.y);
    return x === null || y === null ? null : { x, y };
  }
  if (typeof v !== "string" || v.length > 200) return null;
  const body = inner(v, "Vector2");
  if (body === null) return null;
  const parts = body.split(",");
  if (parts.length !== 2) return null;
  const x = finiteNumber(parts[0]), y = finiteNumber(parts[1]);
  return x === null || y === null ? null : { x, y };
}

/**
 * Scans a comma-separated list of numbers from `body` into `out` (created by `make`).
 * Hand-written scanner: a 50x35 map's splat is ~350 kB of text and a 200x200 one ~12 MB,
 * so split()/map(Number) would allocate millions of strings.
 * Returns null on any malformed token or when the count exceeds `maxLen`.
 */
function scanNumbers<T extends { [i: number]: number; length: number }>(
  body: string,
  maxLen: number,
  make: (n: number) => T,
  opts: { integer: boolean; min: number; max: number },
): T | null {
  // Count commas first so we allocate exactly once.
  const len = body.length;
  let commas = 0, nonSpace = false;
  for (let i = 0; i < len; i++) {
    const c = body.charCodeAt(i);
    if (c === 44) commas++;
    else if (c > 32) nonSpace = true;
  }
  if (!nonSpace) return commas === 0 ? make(0) : null;
  const count = commas + 1;
  if (count > maxLen) return null;
  const out = make(count);
  let k = 0, i = 0;
  while (i <= len) {
    // token [i, j)
    let j = body.indexOf(",", i);
    if (j < 0) j = len;
    // fast path for plain integers
    let s = i, e = j;
    while (s < e && body.charCodeAt(s) <= 32) s++;
    while (e > s && body.charCodeAt(e - 1) <= 32) e--;
    if (s === e) return null;
    let val: number;
    let neg = false, p = s, acc = 0, simple = true;
    if (body.charCodeAt(p) === 45) { neg = true; p++; }
    if (p === e) return null;
    for (; p < e; p++) {
      const d = body.charCodeAt(p) - 48;
      if (d < 0 || d > 9) { simple = false; break; }
      acc = acc * 10 + d;
    }
    if (simple && e - s <= 15) val = neg ? -acc : acc;
    else {
      const f = finiteNumber(body.slice(s, e));
      if (f === null) return null;
      val = f;
    }
    if (opts.integer && !Number.isInteger(val)) return null;
    if (val < opts.min || val > opts.max) return null;
    out[k++] = val;
    i = j + 1;
    if (j === len) break;
  }
  return k === count ? out : null;
}

export function parsePoolByteArray(v: unknown, maxLen: number): Uint8Array | null {
  if (Array.isArray(v)) {
    if (v.length > maxLen) return null;
    const out = new Uint8Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const n = v[i];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 255) return null;
      out[i] = n;
    }
    return out;
  }
  if (typeof v !== "string") return null;
  const body = inner(v, "PoolByteArray");
  if (body === null) return null;
  return scanNumbers(body, maxLen, (n) => new Uint8Array(n), { integer: true, min: 0, max: 255 });
}

export function parsePoolIntArray(v: unknown, maxLen: number): Int32Array | null {
  if (Array.isArray(v)) {
    if (v.length > maxLen) return null;
    const out = new Int32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const n = v[i];
      if (typeof n !== "number" || !Number.isInteger(n) || n < -2147483648 || n > 2147483647) return null;
      out[i] = n;
    }
    return out;
  }
  if (typeof v !== "string") return null;
  const body = inner(v, "PoolIntArray");
  if (body === null) return null;
  return scanNumbers(body, maxLen, (n) => new Int32Array(n), { integer: true, min: -2147483648, max: 2147483647 });
}

/** Returns interleaved [x0, y0, x1, y1, ...]; `maxPoints` bounds the number of points. */
export function parsePoolVector2Array(v: unknown, maxPoints: number): Float64Array | null {
  if (typeof v !== "string") return null;
  const body = inner(v, "PoolVector2Array");
  if (body === null) return null;
  const arr = scanNumbers(body, maxPoints * 2, (n) => new Float64Array(n), { integer: false, min: -1e9, max: 1e9 });
  if (arr === null || arr.length % 2 !== 0) return null;
  return arr;
}

/**
 * Godot 3 Color.to_html(true): "aarrggbb" (8 hex digits, alpha FIRST). 6 digits = "rrggbb", opaque.
 * A leading "#" is tolerated.
 */
export function parseColor(v: unknown): RGBA | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  const h = (i: number) => parseInt(s.slice(i, i + 2), 16);
  if (s.length === 6) return { r: h(0), g: h(2), b: h(4), a: 255 };
  return { a: h(0), r: h(2), g: h(4), b: h(6) };
}

/**
 * Node ids. Dungeondraft writes node_id / wall_id / next_node_id as HEX strings ("1b" = 27)
 * but older saves hold some references (shapes.walls, wall_id) as plain JSON integers (27).
 * Returns a non-negative integer, -1 for "none", or null when unreadable.
 */
export function parseNodeId(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= -1 && v <= 0x7fffffff ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "-1") return -1;
  if (!/^[0-9a-fA-F]{1,8}$/.test(s)) return null;
  const n = parseInt(s, 16);
  return n <= 0x7fffffff ? n : null;
}

/** Keys of Dungeondraft's integer-keyed objects ("-400", "100", "0"). */
export function intKey(k: string): number | null {
  return /^-?\d{1,9}$/.test(k) ? Number(k) : null;
}

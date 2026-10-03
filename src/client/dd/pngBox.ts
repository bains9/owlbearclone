// The PNG box a sidecar travels in (design 3.3): the server stores only sniffed images, so the
// sidecar's bytes are the pixels of a lossless PNG and nothing is colour-managed.
//
// - Colour type 2 (RGB, 8-bit), PNG_BOX_WIDTH px wide, ceil(bytes / PNG_BOX_ROW_BYTES) rows tall,
//   filter 0 on every row; the pixel bytes, row by row, are the sidecar's bytes, zero-padded at the end.
// - Chunks IHDR, IDAT and IEND only (no gAMA, sRGB, iCCP or cHRM).
// - IDAT is zlib from CompressionStream("deflate"); without it, stored deflate blocks plus Adler-32.
// - Unpacking has one exact path: the signature, IHDR exactly (512 wide, 8-bit, colour type 2, no
//   interlace), the IDAT concatenation, DecompressionStream("deflate"), every filter byte 0. There
//   is no createImageBitmap fallback: a device without DecompressionStream guesses from the picture.
//   Any other chunk, a damaged chunk CRC or bytes after IEND are refused too.

import { crc32 } from "../crc32";
import { SIDECAR_CAPS, SIDECAR_HEADER_BYTES, SidecarError } from "./sidecar";

export const PNG_BOX_WIDTH = 512;
/** Sidecar bytes a row (3 a pixel). */
export const PNG_BOX_ROW_BYTES = PNG_BOX_WIDTH * 3;
/** Rows of the biggest box: a sidecar at the payload cap. */
export const PNG_BOX_MAX_ROWS = Math.ceil((SIDECAR_HEADER_BYTES + SIDECAR_CAPS.bytes) / PNG_BOX_ROW_BYTES);

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Bytes a row once filtered: the filter byte, then the row. */
const ROW_RAW = PNG_BOX_ROW_BYTES + 1;
/** The biggest PNG accepted: the biggest box's rows in stored blocks (deflate's worst case), plus the chunks. */
const MAX_PNG_BYTES = PNG_BOX_MAX_ROWS * ROW_RAW + 5 * Math.ceil((PNG_BOX_MAX_ROWS * ROW_RAW) / 65535) + 4096;

/** Packs sidecar bytes (header included) into a PNG. */
export async function packPng(payload: Uint8Array): Promise<{ blob: Blob; width: number; height: number }> {
  const height = Math.max(1, Math.ceil(payload.length / PNG_BOX_ROW_BYTES));
  if (height > PNG_BOX_MAX_ROWS) throw new SidecarError("The sidecar is too big for its PNG box.");
  const raw = new Uint8Array(height * ROW_RAW); // filter bytes 0, padding 0
  for (let r = 0; r < height; r++) {
    raw.set(payload.subarray(r * PNG_BOX_ROW_BYTES, (r + 1) * PNG_BOX_ROW_BYTES), r * ROW_RAW + 1);
  }
  const z = typeof CompressionStream === "function" ? await through(raw, new CompressionStream("deflate")) : storedZlib(raw);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, PNG_BOX_WIDTH);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB; compression, filter and interlace methods 0
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  return { blob: new Blob(parts as BlobPart[], { type: "image/png" }), width: PNG_BOX_WIDTH, height };
}

/**
 * The pixel bytes of a PNG box: the sidecar followed by its zero padding. Anything but the exact
 * layout above throws SidecarError.
 */
export async function unpackPng(png: Blob | Uint8Array): Promise<Uint8Array> {
  if (!canUnpack()) throw new SidecarError("This device can't unpack a sidecar (no DecompressionStream).");
  const size = png instanceof Uint8Array ? png.length : png.size;
  if (size > MAX_PNG_BYTES) throw new SidecarError("The PNG box is too big.");
  const b = png instanceof Uint8Array ? png : new Uint8Array(await png.arrayBuffer());
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 8 || SIGNATURE.some((s, i) => b[i] !== s)) throw new SidecarError("Not a PNG.");

  let p = 8, height = 0, ended = false;
  const idat: Uint8Array[] = [];
  let seen = ""; // the chunks so far, a letter each: H for IHDR, D for IDAT
  while (p < b.length) {
    if (ended) throw new SidecarError("The PNG box has bytes after IEND.");
    if (b.length - p < 12) throw new SidecarError("A PNG chunk is cut off.");
    const len = dv.getUint32(p);
    if (len > b.length - p - 12) throw new SidecarError("A PNG chunk is cut off.");
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = b.subarray(p + 8, p + 8 + len);
    if (crc32(b.subarray(p + 4, p + 8 + len)) !== dv.getUint32(p + 8 + len)) {
      throw new SidecarError("A PNG chunk is damaged.");
    }
    if (type === "IHDR") {
      if (seen !== "" || len !== 13) throw new SidecarError("The PNG's IHDR is out of place or the wrong size.");
      height = dv.getUint32(p + 12);
      const ok = dv.getUint32(p + 8) === PNG_BOX_WIDTH && height >= 1 && height <= PNG_BOX_MAX_ROWS &&
        data[8] === 8 && data[9] === 2 && data[10] === 0 && data[11] === 0 && data[12] === 0;
      if (!ok) throw new SidecarError("The PNG is not a sidecar box (its size, depth, colour type or interlace).");
      seen += "H";
    } else if (type === "IDAT") {
      if (!/^HD*$/.test(seen)) throw new SidecarError("The PNG's IDAT chunks are out of place.");
      idat.push(data);
      seen += "D";
    } else if (type === "IEND") {
      if (!/^HD+$/.test(seen) || len !== 0) throw new SidecarError("The PNG's IEND is out of place.");
      ended = true;
    } else {
      throw new SidecarError("The PNG box has an extra chunk.");
    }
    p += 12 + len;
  }
  if (!ended) throw new SidecarError("The PNG has no IEND.");

  const expected = height * ROW_RAW;
  let raw: Uint8Array;
  try {
    raw = await through(concat(idat), new DecompressionStream("deflate"), expected);
  } catch (e) {
    throw e instanceof SidecarError ? e : new SidecarError("The PNG box's pixels can't be unpacked.");
  }
  if (raw.length !== expected) throw new SidecarError("The PNG box's pixels are the wrong size.");
  const out = new Uint8Array(height * PNG_BOX_ROW_BYTES);
  for (let r = 0; r < height; r++) {
    if (raw[r * ROW_RAW] !== 0) throw new SidecarError("The PNG box uses a row filter.");
    out.set(raw.subarray(r * ROW_RAW + 1, (r + 1) * ROW_RAW), r * PNG_BOX_ROW_BYTES);
  }
  return out;
}

/** Whether this device can unpack a sidecar (DecompressionStream is there; Safari before 16.4 lacks it). */
export function canUnpack(): boolean {
  return typeof DecompressionStream === "function";
}

// ---------------------------------------------------------------- helpers

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let n = 0;
  for (const q of parts) n += q.length;
  const out = new Uint8Array(n);
  n = 0;
  for (const q of parts) {
    out.set(q, n);
    n += q.length;
  }
  return out;
}

/** Runs bytes through a (de)compression stream; with `limit`, refuses more output than that. */
async function through(data: Uint8Array, ts: CompressionStream | DecompressionStream, limit?: number): Promise<Uint8Array> {
  const writer = ts.writable.getWriter();
  const written = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  written.catch(() => {}); // a failure shows on the reading side as well
  const reader = ts.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (limit !== undefined && n > limit) {
      reader.cancel().catch(() => {});
      throw new SidecarError("The PNG box's pixels are the wrong size.");
    }
    parts.push(value);
  }
  await written;
  return concat(parts);
}

/** zlib of stored (uncompressed) deflate blocks and the Adler-32: valid everywhere, just bigger. */
function storedZlib(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + 5 * blocks + 4);
  out[0] = 0x78; // deflate, 32 KiB window
  out[1] = 0x01; // no dictionary; 0x7801 is a multiple of 31
  let p = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535, len = Math.min(65535, raw.length - start);
    out[p] = i === blocks - 1 ? 1 : 0; // BFINAL, BTYPE 00
    out[p + 1] = len & 255;
    out[p + 2] = len >> 8;
    out[p + 3] = ~len & 255;
    out[p + 4] = (~len >> 8) & 255;
    out.set(raw.subarray(start, start + len), p + 5);
    p += 5 + len;
  }
  let a = 1, s = 0;
  for (let i = 0; i < raw.length;) {
    const stop = Math.min(raw.length, i + 5552); // the most bytes before s could pass 2^32
    for (; i < stop; i++) {
      a += raw[i];
      s += a;
    }
    a %= 65521;
    s %= 65521;
  }
  new DataView(out.buffer).setUint32(p, ((s << 16) | a) >>> 0);
  return out;
}

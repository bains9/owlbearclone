// A small PNG reader for test fixtures, on node:zlib (no dependency): 8-bit greyscale, grey +
// alpha, RGB, RGBA and palette images, not interlaced (a tRNS colour key on grey or RGB is
// ignored). Anything else throws.

export interface PngImage {
  w: number;
  h: number;
  /** RGBA, 4 bytes a pixel, rows top to bottom. */
  px: Uint8ClampedArray;
}

type Zlib = { inflateSync(b: Uint8Array): Uint8Array };
type Fs = { readFileSync(path: URL): Uint8Array };

/** Reads and decodes a PNG file (a URL, e.g. new URL("./fixtures/x.png", import.meta.url)). */
export async function readPng(path: URL): Promise<PngImage> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
  return decodePng(fs.readFileSync(path), await zlib());
}

async function zlib(): Promise<Zlib> {
  return (await import(/* @vite-ignore */ "node:" + "zlib")) as Zlib;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Channels per colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(b: Uint8Array, z: Zlib): PngImage {
  for (let i = 0; i < 8; i++) if (b[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let w = 0;
  let h = 0;
  let type = -1;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 8 <= b.length; ) {
    const len = dv.getUint32(p);
    const name = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = b.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (name === "IHDR") {
      w = dv.getUint32(data.byteOffset - b.byteOffset);
      h = dv.getUint32(data.byteOffset - b.byteOffset + 4);
      type = data[9];
      if (data[8] !== 8 || !(type in CHANNELS)) throw new Error(`PNG: bit depth ${data[8]}, colour type ${type} not supported`);
      if (data[12] !== 0) throw new Error("PNG: interlaced images not supported");
    } else if (name === "PLTE") palette = data;
    else if (name === "tRNS") trns = data;
    else if (name === "IDAT") idat.push(data);
    else if (name === "IEND") break;
  }
  if (!w || !h) throw new Error("PNG: no IHDR");
  let total = 0;
  for (const d of idat) total += d.length;
  const packed = new Uint8Array(total);
  for (let i = 0, o = 0; i < idat.length; o += idat[i].length, i++) packed.set(idat[i], o);
  const raw = z.inflateSync(packed);
  const bpp = CHANNELS[type];
  const stride = w * bpp;
  if (raw.length < h * (stride + 1)) throw new Error("PNG: image data too short");
  // Undo the filters, row by row.
  const img = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[o + x - bpp] : 0;
      const up = y > 0 ? img[o - stride + x] : 0;
      const c = x >= bpp && y > 0 ? img[o - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      } else if (f !== 0) throw new Error(`PNG: unknown filter ${f}`);
      img[o + x] = v & 255;
    }
  }
  const px = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const s = k * bpp;
    const o = k * 4;
    if (type === 3) {
      const i = img[s];
      if (!palette || 3 * i + 2 >= palette.length) throw new Error("PNG: palette index out of range");
      px[o] = palette[3 * i];
      px[o + 1] = palette[3 * i + 1];
      px[o + 2] = palette[3 * i + 2];
      px[o + 3] = trns && i < trns.length ? trns[i] : 255;
    } else if (type === 0 || type === 4) {
      px[o] = px[o + 1] = px[o + 2] = img[s];
      px[o + 3] = type === 4 ? img[s + 1] : 255;
    } else {
      px[o] = img[s];
      px[o + 1] = img[s + 1];
      px[o + 2] = img[s + 2];
      px[o + 3] = type === 6 ? img[s + 3] : 255;
    }
  }
  return { w, h, px };
}

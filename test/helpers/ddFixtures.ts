// Real Dungeondraft files for tests that can use them: the public sample maps and their exports
// (DD_FIXTURES, not committed) and Vern's exports (DD_VERN, not committed). Tests skip cleanly
// when the files they read are absent: it.skipIf with haveSample / havePair / haveVernExport on
// each file a test reads (haveSamples and haveVern only say whether a folder is there). Also a PNG
// writer for renders of fixtures, and box-filter downsampling to the 24-32 px a square the
// attach worker samples at.

import { decodePng } from "./png";
import { crc32 } from "../../src/client/crc32";
import { VTT_META_POINTS, type PictureSample, type VttMeta } from "../../src/client/dd/extract";

type Fs = {
  readFileSync(path: string | URL, encoding?: "utf8"): string & Uint8Array;
  existsSync(path: string): boolean;
  writeFileSync(path: string, data: Uint8Array | string): void;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
};
type Zlib = { inflateSync(b: Uint8Array): Uint8Array; deflateSync(b: Uint8Array, o?: { level: number }): Uint8Array };

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
const zlib = (await import(/* @vite-ignore */ "node:" + "zlib")) as Zlib;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const dir = (v: string | undefined, dflt: string) => (v ?? dflt).replace(/\\/g, "/").replace(/\/+$/, "");

/** The public sample maps and exports: DD_FIXTURES, or the design's working folder on Par's machine. */
export const DD_FIXTURES = dir(env.DD_FIXTURES, "C:/Users/G/tabletop-work/dd-raw/docs/samples");
/** Vern's .dd2vtt exports (each picture also extracted beside it as .png): DD_VERN, or the working folder. */
export const DD_VERN = dir(env.DD_VERN, "C:/Users/G/tabletop-work/vern");
/** Where fixture renders go for a human look (written only when the folder's parent exists). */
export const DD_RENDERS = dir(env.DD_RENDERS, "C:/Users/G/tabletop-work/dd-raw/renders/fixtures");

/** Whether DD_FIXTURES holds any sample (a test also checks the files it reads: haveSample, havePair). */
export const haveSamples = fs.existsSync(`${DD_FIXTURES}/fs_pelcs.dungeondraft_map`);
/** Whether DD_VERN holds any export (a test also checks the files it reads: haveVernExport). */
export const haveVern = fs.existsSync(`${DD_VERN}/waterfall.vtt.dd2vtt`);

/** Whether every one of these files (names in DD_FIXTURES, e.g. "hd_brawl.dd2vtt") is there. */
export function haveSample(...files: string[]): boolean {
  return files.every((f) => fs.existsSync(`${DD_FIXTURES}/${f}`));
}

/** A sample map's base name (DD_FIXTURES/<name>.dungeondraft_map). */
export type SampleName = "ak_hobble" | "fs_cavern" | "fs_pelcs" | "fs_tulgi" | "hd_brawl" | "hd_forest" | "hd_mill" | "hd_river";

export interface SamplePair {
  map: SampleName;
  /** The export's file in DD_FIXTURES (.png or .dd2vtt). */
  picture: string;
  /** The level the export shows, when the map has several (by level.key). */
  level?: string;
  snowy: boolean;
}

/** The 7 correct pairs of the fit's table (design 2.4): never "no". */
export const SAMPLE_PAIRS: readonly SamplePair[] = [
  { map: "hd_river", picture: "hd_river.dd2vtt", snowy: false },
  { map: "fs_tulgi", picture: "fs_tulgi_ground.png", level: "1", snowy: true },
  { map: "fs_cavern", picture: "fs_cavern.png", snowy: true },
  { map: "hd_forest", picture: "hd_forest.png", snowy: false },
  { map: "ak_hobble", picture: "ak_hobble.dd2vtt", snowy: false },
  { map: "hd_mill", picture: "hd_mill.png", snowy: false },
  { map: "fs_pelcs", picture: "fs_pelcs.dd2vtt", level: "1", snowy: true },
];

/** The 2 swapped pairs (same size, wrong map): never "yes". */
export const SWAPPED_PAIRS: readonly SamplePair[] = [
  { map: "hd_forest", picture: "ak_hobble.png", snowy: false },
  { map: "ak_hobble", picture: "hd_forest.png", snowy: false },
];

/** Vern's exports in DD_VERN; waterfall's pairs with test/fixtures/dd/waterfall.dungeondraft_map. */
export const VERN_EXPORTS = ["waterfall.vtt", "kdir-vtt", "swampbridge-summer.vtt", "swampbridge-winter.vtt"] as const;
export type VernExport = (typeof VERN_EXPORTS)[number];

/** Whether a pair's map and picture are both in DD_FIXTURES. */
export function havePair(p: SamplePair): boolean {
  return haveSample(`${p.map}.dungeondraft_map`, p.picture);
}

/** Whether these exports' .dd2vtt files are in DD_VERN. */
export function haveVernExport(...names: VernExport[]): boolean {
  return names.every((n) => fs.existsSync(`${DD_VERN}/${n}.dd2vtt`));
}

/** A sample map's text. */
export function sampleText(name: SampleName): string {
  return fs.readFileSync(`${DD_FIXTURES}/${name}.dungeondraft_map`, "utf8");
}

/** The committed waterfall map (Vern's, Dungeondraft 1.2). */
export function waterfallText(): string {
  return fs.readFileSync(new URL("../fixtures/dd/waterfall.dungeondraft_map", import.meta.url), "utf8");
}

export interface Picture extends PictureSample {
  /** For a .dd2vtt: what parseUniversalVtt keeps. */
  vtt?: VttMeta;
}

/** Decodes PNG bytes to RGBA. */
export function pngPicture(bytes: Uint8Array): PictureSample {
  const p = decodePng(bytes, zlib);
  return { rgba: p.px, w: p.w, h: p.h };
}

/** A .dd2vtt's text: its picture and what parseUniversalVtt keeps of it. */
export function dd2vttPicture(text: string): Picture {
  const j = JSON.parse(text) as { image?: string };
  const pic = pngPicture(fromBase64(j.image ?? ""));
  return { ...pic, vtt: vttMetaOf(j) };
}

/** A picture file: .png, or .dd2vtt (its embedded picture plus its VttMeta). Absolute, or relative to DD_FIXTURES. */
export function readPicture(file: string): Picture {
  const path = /^[A-Za-z]:|^\//.test(file) ? file : `${DD_FIXTURES}/${file}`;
  if (/\.dd2vtt$/i.test(path)) return dd2vttPicture(fs.readFileSync(path, "utf8"));
  return pngPicture(fs.readFileSync(path));
}

/**
 * One of Vern's exports: the picture from the .png extracted beside it (quicker than the
 * .dd2vtt's base64), with the .dd2vtt's VttMeta.
 */
export function vernPicture(name: VernExport): Picture {
  const j = JSON.parse(fs.readFileSync(`${DD_VERN}/${name}.dd2vtt`, "utf8")) as { image?: string };
  delete j.image;
  const png = `${DD_VERN}/${name}.png`;
  const pic = fs.existsSync(png) ? pngPicture(fs.readFileSync(png)) : dd2vttPicture(fs.readFileSync(`${DD_VERN}/${name}.dd2vtt`, "utf8"));
  return { rgba: pic.rgba, w: pic.w, h: pic.h, vtt: vttMetaOf(j) };
}

type P = { x?: unknown; y?: unknown };
const isP = (p: unknown): p is { x: number; y: number } =>
  typeof p === "object" && p !== null && Number.isFinite((p as P).x) && Number.isFinite((p as P).y);

/** What parseUniversalVtt keeps of a .dd2vtt (extract.ts VttMeta): the resolution and at most VTT_META_POINTS positions. */
export function vttMetaOf(j: unknown): VttMeta {
  const o = (typeof j === "object" && j !== null ? j : {}) as Record<string, unknown>;
  const r = (o.resolution ?? {}) as { map_origin?: P; map_size?: P; pixels_per_grid?: unknown };
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  let left = VTT_META_POINTS;
  const positions = (v: unknown) => {
    const out: Array<{ position: { x: number; y: number } }> = [];
    if (Array.isArray(v)) for (const e of v) {
      if (left <= 0) break;
      const p = (e as { position?: unknown })?.position;
      if (isP(p)) { out.push({ position: { x: p.x, y: p.y } }); left--; }
    }
    return out;
  };
  const portals = positions(o.portals), lights = positions(o.lights);
  const los: Array<Array<{ x: number; y: number }>> = [];
  if (Array.isArray(o.line_of_sight)) for (const line of o.line_of_sight) {
    if (!Array.isArray(line) || left <= 0) continue;
    const pts: Array<{ x: number; y: number }> = [];
    for (const p of line) { if (left <= 0) break; if (isP(p)) { pts.push({ x: p.x, y: p.y }); left--; } }
    los.push(pts);
  }
  return {
    resolution: {
      map_origin: { x: num(r.map_origin?.x, 0), y: num(r.map_origin?.y, 0) },
      map_size: { x: num(r.map_size?.x, 0), y: num(r.map_size?.y, 0) },
      pixels_per_grid: num(r.pixels_per_grid, 0),
    },
    portals, lights, line_of_sight: los,
  };
}

function fromBase64(s: string): Uint8Array {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lut[A.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let n = 0, acc = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? lut[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, n);
}

/**
 * The picture box-filtered to `w` x `h` (alpha-weighted), as the attach dialog scales a picture to
 * 24-32 px a square. Upscaling is not supported (nearest samples would be wrong for tests).
 */
export function downsample(pic: PictureSample, w: number, h: number): PictureSample {
  if (w > pic.w || h > pic.h) throw new Error(`downsample: ${pic.w}x${pic.h} to ${w}x${h} is not smaller`);
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = pic.w / w, fy = pic.h / h;
  for (let y = 0; y < h; y++) {
    const ya = y * fy, yb = (y + 1) * fy;
    for (let x = 0; x < w; x++) {
      const xa = x * fx, xb = (x + 1) * fx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(ya); sy < Math.ceil(yb); sy++) {
        const wy = Math.min(yb, sy + 1) - Math.max(ya, sy);
        for (let sx = Math.floor(xa); sx < Math.ceil(xb); sx++) {
          const k = wy * (Math.min(xb, sx + 1) - Math.max(xa, sx));
          const o = (sy * pic.w + sx) * 4;
          const al = pic.rgba[o + 3] * k;
          r += pic.rgba[o] * al; g += pic.rgba[o + 1] * al; b += pic.rgba[o + 2] * al; a += al; area += k;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / area;
    }
  }
  return { rgba: out, w, h };
}

/** The picture at `pxPerSq` pixels a square for a map `squares` wide (downsampled, the aspect kept). */
export function atPxPerSquare(pic: PictureSample, squaresW: number, squaresH: number, pxPerSq: number): PictureSample {
  return downsample(pic, Math.round(squaresW * pxPerSq), Math.round(squaresH * pxPerSq));
}

// ------------------------------------------------------------------ writing PNGs

/** RGBA to PNG bytes (colour type 6, filter 0, zlib by node:zlib). */
export function encodePng(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Writes a render to DD_RENDERS/<name>.png when that folder's parent exists; returns the path, or null. */
export function writeRender(name: string, pic: { rgba: Uint8Array | Uint8ClampedArray; w: number; h: number }): string | null {
  const parent = DD_RENDERS.replace(/\/[^/]*$/, "");
  if (!fs.existsSync(parent)) return null;
  fs.mkdirSync(DD_RENDERS, { recursive: true });
  const path = `${DD_RENDERS}/${name}.png`;
  fs.writeFileSync(path, encodePng(pic.rgba, pic.w, pic.h));
  return path;
}

// Shared helpers of the Dungeondraft scripts (Node only, not shipped): the sample pairs, reading a
// map with its picture at a chosen resolution, and small PNG and drawing helpers for overlays.
// Run the scripts with the resolve hook (see register.mjs):
//
//   node --import ./scripts/dd/register.mjs scripts/dd/<script>.ts
//
// sharp comes from the Tabletop checkout's node_modules (scripts only; tests don't use it).

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { parseDungeondraftMap } from "../../src/client/dd/parse";
import { alignDd2vtt, alignPlainImage } from "../../src/client/dd/align";
import type { DDMap, Level } from "../../src/client/dd/model";
import { GRID } from "../../src/client/dd/model";
import type { PictureRect, PictureSample } from "../../src/client/dd/extract";

/** The public sample maps (not committed): DD_FIXTURES, or the design's working folder on Par's machine. */
export const SAMPLES = (process.env.DD_FIXTURES ?? "C:/Users/G/tabletop-work/dd-raw/docs/samples").replace(/[\\/]+$/, "");
/** Vern's exports (not committed; read when present): his Dungeondraft 1.2 export of waterfall, and Kdir's. */
export const VERN = (process.env.DD_VERN ?? "C:/Users/G/tabletop-work/vern").replace(/[\\/]+$/, "");
/** The repo's own fixtures (waterfall's map is committed there), as a plain path. */
export const FIXTURES = fileURLToPath(new URL("../../test/fixtures/dd/", import.meta.url)).replace(/\\/g, "/");
/** Where the scripts write their pictures (outside the repo). */
export const RENDERS = (process.env.DD_RENDERS ?? "C:/Users/G/tabletop-work/dd-raw/renders").replace(/[\\/]+$/, "");

/** A map and the picture exported from one of its levels. */
export interface Pair {
  name: string;
  map: string;
  picture: string;
  /** The exported level's label, when the map has several. */
  level?: string;
}

/** The sample pairs (design 2.4's seven correct pairs, plus Brawl's and waterfall's). Paths relative to SAMPLES unless absolute. */
export const PAIRS: Pair[] = [
  { name: "pelcs", map: "fs_pelcs.dungeondraft_map", picture: "fs_pelcs.dd2vtt", level: "Ground" },
  { name: "tulgi", map: "fs_tulgi.dungeondraft_map", picture: "fs_tulgi_ground.png", level: "Ground" },
  { name: "cavern", map: "fs_cavern.dungeondraft_map", picture: "fs_cavern.png" },
  { name: "forest", map: "hd_forest.dungeondraft_map", picture: "hd_forest.png" },
  { name: "mill", map: "hd_mill.dungeondraft_map", picture: "hd_mill.png" },
  { name: "river", map: "hd_river.dungeondraft_map", picture: "hd_river.dd2vtt" },
  { name: "hobble", map: "ak_hobble.dungeondraft_map", picture: "ak_hobble.png" },
  { name: "brawl", map: "hd_brawl.dungeondraft_map", picture: "hd_brawl.dd2vtt" },
  { name: "waterfall", map: `${FIXTURES}waterfall.dungeondraft_map`, picture: `${VERN}/waterfall.vtt.dd2vtt` },
];

/** A pair's file: absolute as given, else relative to SAMPLES. */
export function samplePath(p: string): string {
  return /^(?:[A-Za-z]:)?[\\/]/.test(p) ? p : `${SAMPLES}/${p}`;
}

export function sharp(): any {
  return createRequire("C:/Users/G/tabletop/package.json")("sharp");
}

export interface Loaded {
  map: DDMap;
  level: Level;
  pic: PictureSample;
  rect: PictureRect;
  /** Picture pixels a square, as sampled. */
  pps: number;
  /** As exported. */
  exportPps: number;
}

/**
 * A picture for sharp: a file path, or a .dd2vtt's embedded image with its `resolution` (the
 * .dd2vtt's own field names: map_origin and map_size in squares, pixels_per_grid).
 */
export function readPicture(picPath: string): { src: string | Buffer; res: any } {
  if (!picPath.endsWith(".dd2vtt")) return { src: picPath, res: null };
  const v = JSON.parse(readFileSync(picPath, "utf8"));
  return { src: Buffer.from(v.image, "base64"), res: v.resolution };
}

/** Picks the exported level: by label, else the one open when saved, else the first. */
export function pickLevel(map: DDMap, label?: string): Level {
  const levels = map.world.levels;
  return (label && levels.find((l) => l.label.toLowerCase() === label.toLowerCase()))
    || levels.find((l) => l.id === map.header.currentLevel) || levels[0];
}

/**
 * Reads a map and its picture (a .dd2vtt or a plain export), lined up (align.ts), with the picture
 * resampled to `pps` px a square (never up).
 */
export async function loadPair(mapPath: string, picPath: string, pps = 32, label?: string): Promise<Loaded> {
  const map = parseDungeondraftMap(readFileSync(mapPath, "utf8"));
  const { src, res } = readPicture(picPath);
  const s = sharp();
  const meta = await s(src).metadata();
  const al = res ? alignDd2vtt(res, meta.width, meta.height, map) : alignPlainImage(map, meta.width, meta.height);
  if (!al) throw new Error(`${picPath} doesn't line up with ${mapPath}`);
  const exportPps = GRID / al.spec.unitsPerPx;
  const k = Math.min(1, pps / exportPps);
  const w = Math.round(meta.width * k), h = Math.round(meta.height * k);
  const { data } = await s(src).resize(w, h, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const x0 = al.spec.originX, y0 = al.spec.originY;
  const rect: PictureRect = { rect: [x0, y0, x0 + al.size.x * GRID, y0 + al.size.y * GRID] };
  return { map, level: pickLevel(map, label), pic: { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w, h }, rect, pps: w / al.size.x, exportPps };
}

export async function loadSample(p: Pair, pps = 32): Promise<Loaded | null> {
  const m = samplePath(p.map), q = samplePath(p.picture);
  if (!existsSync(m) || !existsSync(q)) return null;
  return loadPair(m, q, pps, p.level);
}

// ------------------------------------------------------------------ pictures out

export async function savePng(path: string, rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Promise<void> {
  await sharp()(Buffer.from(rgba.buffer, rgba.byteOffset, w * h * 4), { raw: { width: w, height: h, channels: 4 } }).png().toFile(path);
}

/** A PNG without sharp (small overlays in bulk). */
export function encodePng(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 0xff] ^ (c >>> 8);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/** A crop of an RGBA picture, `scale` times bigger (nearest), for drawing over. */
export class Canvas {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
  readonly scale: number;
  constructor(src: PictureSample, x0: number, y0: number, w: number, h: number, scale = 1) {
    this.scale = scale;
    this.w = w * scale;
    this.h = h * scale;
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const sx = x0 + Math.floor(x / scale), sy = y0 + Math.floor(y / scale), o = (y * this.w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) { this.data[o] = 40; this.data[o + 1] = 0; this.data[o + 2] = 40; this.data[o + 3] = 255; continue; }
      const i = (sy * src.w + sx) * 4;
      this.data[o] = src.rgba[i]; this.data[o + 1] = src.rgba[i + 1]; this.data[o + 2] = src.rgba[i + 2]; this.data[o + 3] = 255;
    }
  }
  blend(x: number, y: number, c: readonly number[], a: number): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    for (let k = 0; k < 3; k++) this.data[o + k] += (c[k] - this.data[o + k]) * a;
  }
  /** A closed polygon through points given in crop pixels (before scaling). */
  poly(pts: number[], c: readonly number[], a = 1): void {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.line(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], c, a);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: readonly number[], a = 1): void {
    const s = this.scale, m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * s * 2));
    for (let i = 0; i <= m; i++) this.blend((x0 + ((x1 - x0) * i) / m) * s, (y0 + ((y1 - y0) * i) / m) * s, c, a);
  }
  dot(x: number, y: number, c: readonly number[], r = 2): void {
    const s = this.scale;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) this.blend(x * s + dx, y * s + dy, c, 1);
  }
  png(): Buffer {
    return encodePng(this.w, this.h, this.data);
  }
}

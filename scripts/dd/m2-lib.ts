// Shared parts of the M2 integration scripts (design 7.0 step 4, 6.3 "Real maps"): a map with
// its full-size export, the attach path through the dd worker's own handler (handleDdMessage), the
// sidecar's round trip through the PNG box and the runtime's SidecarCache (fetch stubbed), the
// analyses and bakes the browser would make, and contact sheets composed with sharp. Node only.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-<script>.ts

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseDungeondraftMap } from "../../src/client/dd/parse";
import { GRID, type DDMap } from "../../src/client/dd/model";
import type { AttachReport, PictureSample, VttMeta } from "../../src/client/dd/extract";
import { handleDdMessage, resample } from "../../src/client/dd/ddWorker";
import type { DdWorkerIn, DdWorkerOut } from "../../src/client/dd/messages";
import { packPng, unpackPng } from "../../src/client/dd/pngBox";
import { decodeSidecar, SIDECAR_HEADER_BYTES, type SeasonSidecar } from "../../src/client/dd/sidecar";
import { SidecarCache } from "../../src/client/room/mapData";
import { analysisGeometry, seasonSquare } from "../../src/client/room/seasons";
import { analyse, bake, type SeasonAnalysis } from "../../src/client/room/seasonPixels";
import { analyseExact } from "../../src/client/room/seasonExact";
import { parseUniversalVtt } from "../../src/client/mapImport";
import type { SeasonLook } from "../../src/shared/types";
import { PAIRS, RENDERS, VERN, samplePath, sharp, type Pair } from "./lib";

export const OUT = `${RENDERS}/m2`;
mkdirSync(OUT, { recursive: true });

/** The snowy pairs M2 bakes (waterfall first), and the green ones it checks fall back. */
export const SNOWY = ["waterfall", "pelcs", "tulgi", "cavern"];
export const GREEN = ["forest", "mill", "hobble", "brawl", "river"];

export function pair(name: string): Pair {
  const p = PAIRS.find((q) => q.name === name);
  if (!p) throw new Error(`no pair ${name}`);
  return p;
}

export function havePair(p: Pair): boolean {
  return existsSync(samplePath(p.map)) && existsSync(samplePath(p.picture));
}

/** A map with its export at full size, as the browser has them before attaching. */
export interface Full {
  pair: Pair;
  map: DDMap;
  mapText: string;
  /** The project file, as the dialog hands it to the worker. */
  file: File;
  /** The export's pixels, full size. */
  full: PictureSample;
  vtt?: VttMeta;
  /** The export's pixels a square. */
  exportPps: number;
  /** The map's squares across and down (the export shows all of them for every pair here). */
  sqW: number;
  sqH: number;
}

export async function loadFull(p: Pair): Promise<Full> {
  const mapPath = samplePath(p.map), picPath = samplePath(p.picture);
  const mapText = readFileSync(mapPath, "utf8");
  const map = parseDungeondraftMap(mapText);
  const file = new File([mapText], basename(mapPath), { lastModified: 1_700_000_000_000 });
  let src: string | Buffer = picPath;
  let vtt: VttMeta | undefined;
  if (picPath.endsWith(".dd2vtt")) {
    const text = readFileSync(picPath, "utf8");
    const mf = parseUniversalVtt(text, basename(picPath));
    vtt = mf.vtt;
    src = Buffer.from(await mf.image.arrayBuffer());
  }
  const { data, info } = await sharp()(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const full: PictureSample = { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
  const sqW = vtt?.resolution.map_size.x ?? map.world.width, sqH = vtt?.resolution.map_size.y ?? map.world.height;
  return { pair: p, map, mapText, file, full, vtt, exportPps: full.w / sqW, sqW, sqH };
}

/** Vern's export of a map that has no project file (Kdir, the swamp bridges). */
export async function loadVern(name: string): Promise<{ full: PictureSample; vtt: VttMeta | undefined; pps: number }> {
  const text = readFileSync(`${VERN}/${name}.dd2vtt`, "utf8");
  const mf = parseUniversalVtt(text, `${name}.dd2vtt`);
  const { data, info } = await sharp()(Buffer.from(await mf.image.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const full: PictureSample = { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
  return { full, vtt: mf.vtt, pps: mf.vtt ? full.w / mf.vtt.resolution.map_size.x : NaN };
}

// ---------------------------------------------------------------- the attach path

export interface Prepared {
  report: AttachReport;
  /** The encoded sidecar, as the worker posts it. */
  sidecar: Uint8Array;
  preview: PictureSample;
  compare?: { exact: PictureSample; guessed: PictureSample };
  progress: string[];
  /** Milliseconds from the message to the answer. */
  ms: number;
}

/**
 * The dialog's prepare, through the worker's own handler: the picture at most 32 px a square (as
 * attach.ts decodes it), the .dd2vtt's VttMeta when there is one, Compare on.
 */
export async function prepare(f: Full, opts: { compare?: boolean; levelKey?: string; shift?: [number, number] } = {}): Promise<Prepared> {
  const pic = atMost(f.full, f.sqW, 32);
  const msg: DdWorkerIn = {
    t: "prepare", id: 1, file: f.file, pic, picW: f.full.w, picH: f.full.h, vtt: f.vtt, compare: opts.compare ?? true,
    levelKey: opts.levelKey, shift: opts.shift,
  };
  const progress: string[] = [];
  let out: DdWorkerOut | null = null;
  const t0 = performance.now();
  await handleDdMessage(msg, (m: DdWorkerOut) => {
    if (m.t === "progress") progress.push(m.text);
    else out = m;
  });
  const ms = performance.now() - t0;
  const o = out as DdWorkerOut | null;
  if (!o) throw new Error("the worker posted nothing");
  if (o.t === "error") throw new Error(`worker error: ${o.message}`);
  if (o.t !== "prepared") throw new Error(`unexpected ${o.t}`);
  const res: Prepared = { report: o.report, sidecar: o.sidecar, preview: { rgba: o.preview, w: o.pw, h: o.ph }, progress, ms };
  if (o.compare) res.compare = { exact: { rgba: o.compare.exact, w: o.compare.w, h: o.compare.h }, guessed: { rgba: o.compare.guessed, w: o.compare.w, h: o.compare.h } };
  return res;
}

/** The picture at most pps a square (ddWorker's box resample), as attach.ts gives the worker. */
export function atMost(pic: PictureSample, squaresW: number, pps: number): PictureSample {
  if (pic.w / squaresW <= pps) return pic;
  const k = (pps * squaresW) / pic.w;
  const w = Math.round(pic.w * k), h = Math.round(pic.h * k);
  return { rgba: resample(pic, w, h), w, h };
}

/**
 * The sidecar's way to every device: packPng (upload), then a fetch through the runtime's
 * SidecarCache (unpackPng, format check, decodeSidecar), with fetch stubbed to serve the PNG.
 * Returns the bytes the cache keeps, the decoded sidecar, and the PNG's size.
 */
export async function roundTrip(sidecar: Uint8Array): Promise<{ bytes: Uint8Array; sc: SeasonSidecar; pngBytes: number; direct: Uint8Array }> {
  const { blob } = await packPng(sidecar);
  const pngBytes = blob.size;
  // The direct unpack, as checkAttached does it.
  let direct = await unpackPng(blob);
  const len = new DataView(direct.buffer, direct.byteOffset, direct.byteLength).getUint32(8, true);
  direct = direct.slice(0, SIDECAR_HEADER_BYTES + len);
  // The runtime's cache, fetching the PNG.
  const g = globalThis as { fetch: typeof fetch };
  const realFetch = g.fetch;
  g.fetch = (async () => new Response(blob, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
  try {
    const cache = new SidecarCache(() => {});
    const r = await cache.get("room", "asset");
    if (!r.ok) throw new Error(`SidecarCache: ${r.state}`);
    return { bytes: r.bytes, sc: decodeSidecar(r.bytes), pngBytes, direct };
  } finally {
    g.fetch = realFetch;
  }
}

// ---------------------------------------------------------------- analyses and bakes

export interface Scene {
  sceneW: number;
  sceneH: number;
  square: number;
  aw: number;
  ah: number;
  cellA: number;
  /** The picture at analysis size. */
  small: Uint8ClampedArray;
}

/** The board's geometry for a scene showing this picture with the export's grid (seasons.ts). */
export function sceneOf(full: PictureSample, gridPx: number): Scene {
  const sceneW = full.w, sceneH = full.h;
  const square = seasonSquare(sceneW, sceneH, gridPx);
  const { aw, ah, cellA } = analysisGeometry(sceneW, sceneH, square);
  return { sceneW, sceneH, square, aw, ah, cellA, small: resample(full, aw, ah) };
}

export type DdOpts = { bare?: "leaf" | "dead"; drawn?: "winter" | "green"; packs?: "guess" };

/** analyseExact as the seasons worker calls it, or the reason it refused. */
export function exactOrReason(s: Scene, sc: SeasonSidecar, opts: DdOpts = {}): { a: SeasonAnalysis | null; reason?: string } {
  try {
    return { a: analyseExact(s.small, s.aw, s.ah, s.cellA, sc, opts) };
  } catch (e) {
    return { a: null, reason: String(e) };
  }
}

export function pixelAnalysis(s: Scene): SeasonAnalysis {
  return analyse(s.small, s.aw, s.ah, s.cellA);
}

export const LOOKS: SeasonLook[] = ["spring", "summer", "autumn", "winter"];
export const LEVELS: Array<1 | 2 | 3> = [1, 2, 3];
/** Level names, as the UI shows them. */
export const LEVEL_NAME: Record<SeasonLook, string[]> = {
  spring: ["Budding", "Blossom", "Full bloom"], summer: ["Lush", "Dry", "Drought"], autumn: ["Turning", "Autumn", "Late"], winter: ["L1", "L2", "L3"],
};

/** A window of the scene in squares [x, y, w, h] (whole picture when absent). */
export type Window = [number, number, number, number];

/** The picture's pixels for a window at pps (whole picture: the window is the map). */
export async function baseTile(full: PictureSample, exportPps: number, win: Window, pps: number): Promise<PictureSample> {
  const [x, y, w, h] = win;
  const tw = Math.round(w * pps), th = Math.round(h * pps);
  const left = Math.round(x * exportPps), top = Math.round(y * exportPps);
  const width = Math.min(full.w - left, Math.round(w * exportPps)), height = Math.min(full.h - top, Math.round(h * exportPps));
  const { data } = await sharp()(Buffer.from(full.rgba.buffer, full.rgba.byteOffset, full.rgba.length), { raw: { width: full.w, height: full.h, channels: 4 } })
    .extract({ left, top, width, height }).resize(tw, th, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: tw, h: th };
}

/** The bake of one look over a base tile (a copy), as a strip at the window's scene position. */
export function bakeTile(base: PictureSample, s: Scene, exportPps: number, win: Window, a: SeasonAnalysis, look: SeasonLook, level: 1 | 2 | 3, seed = 1): PictureSample {
  const out = base.rgba.slice();
  const scale = (win[2] * exportPps) / base.w;
  bake(out, base.w, base.h, { x0: win[0] * exportPps, y0: win[1] * exportPps, scale, cell: s.square, seed, look, level, a, sceneW: s.sceneW, sceneH: s.sceneH });
  return { rgba: out, w: base.w, h: base.h };
}

// ---------------------------------------------------------------- sheets

export interface Tile {
  pic: PictureSample | null;
  label: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A grid of tiles (rows of equal-sized tiles; null leaves a gap) with labels, saved as a PNG. */
export async function sheet(path: string, title: string, rows: Tile[][], opts: { gap?: number; label?: number } = {}): Promise<void> {
  const gap = opts.gap ?? 6, lab = opts.label ?? 22, titleH = 30;
  const tw = Math.max(...rows.flat().map((t) => t.pic?.w ?? 0)), th = Math.max(...rows.flat().map((t) => t.pic?.h ?? 0));
  const cols = Math.max(...rows.map((r) => r.length));
  const W = cols * (tw + gap) + gap, H = titleH + rows.length * (th + lab + gap) + gap;
  const comps: Array<Record<string, unknown>> = [];
  const texts: string[] = [`<text x="${gap}" y="${titleH - 9}" font-size="17" font-weight="bold" fill="#fff">${esc(title)}</text>`];
  rows.forEach((row, j) => {
    row.forEach((t, i) => {
      const left = gap + i * (tw + gap), top = titleH + gap + j * (th + lab + gap);
      texts.push(`<text x="${left + 3}" y="${top + 15}" font-size="13" fill="#fff">${esc(t.label)}</text>`);
      if (!t.pic) return;
      comps.push({ input: Buffer.from(t.pic.rgba.buffer, t.pic.rgba.byteOffset, t.pic.w * t.pic.h * 4), raw: { width: t.pic.w, height: t.pic.h, channels: 4 }, left, top: top + lab });
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif">${texts.join("")}</svg>`;
  comps.push({ input: Buffer.from(svg), left: 0, top: 0 });
  await sharp()({ create: { width: W, height: H, channels: 4, background: { r: 28, g: 30, b: 34, alpha: 1 } } })
    .composite(comps).png({ compressionLevel: 6 }).toFile(path);
}

export async function savePng(path: string, pic: PictureSample): Promise<void> {
  await sharp()(Buffer.from(pic.rgba.buffer, pic.rgba.byteOffset, pic.w * pic.h * 4), { raw: { width: pic.w, height: pic.h, channels: 4 } }).png().toFile(path);
}

/** A picture scaled to `w` wide (box). */
export function scaled(pic: PictureSample, w: number): PictureSample {
  const h = Math.max(1, Math.round((pic.h * w) / pic.w));
  return { rgba: resample(pic, w, h), w, h };
}

export function writeText(path: string, text: string): void {
  writeFileSync(path, text);
}

// ---------------------------------------------------------------- pixel helpers

export function luma(p: PictureSample, i: number): number {
  return 0.299 * p.rgba[i * 4] + 0.587 * p.rgba[i * 4 + 1] + 0.114 * p.rgba[i * 4 + 2];
}

/** Hue in degrees (0 red, 60 yellow, 120 green, 240 blue) and saturation 0..1 of pixel i. */
export function hueSat(p: PictureSample, i: number): [number, number] {
  const r = p.rgba[i * 4], g = p.rgba[i * 4 + 1], b = p.rgba[i * 4 + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return [0, 0];
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, mx ? d / mx : 0];
}

/** Whether pixel i of a and b differ by more than tol in any channel. */
export function differs(a: PictureSample, b: PictureSample, i: number, tol = 2): boolean {
  const o = i * 4;
  return Math.abs(a.rgba[o] - b.rgba[o]) > tol || Math.abs(a.rgba[o + 1] - b.rgba[o + 1]) > tol || Math.abs(a.rgba[o + 2] - b.rgba[o + 2]) > tol;
}

/** Erodes a mask (>= thr) by r pixels (box). */
export function eroded(m: Uint8Array, w: number, h: number, r: number, thr = 128): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = m[y * w + x] >= thr;
    for (let dy = -r; ok && dy <= r; dy++) for (let dx = -r; ok && dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || m[yy * w + xx] < thr) ok = false;
    }
    if (ok) out[y * w + x] = 255;
  }
  return out;
}

export function dilated(m: Uint8Array, w: number, h: number, r: number, thr = 128): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (m[y * w + x] < thr) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 255;
    }
  }
  return out;
}

export const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-");
export const pct = (x: number, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : "-");
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

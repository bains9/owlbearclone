// The GM's Dungeondraft worker (design 2.1 to 2.7, 7.1): started by attach.ts the first time a
// project file is attached, never on a player's device. It reads the File itself (posting a File
// shares it, so a 60 MB project file is never copied between threads), parses it, ranks the levels,
// checks the fit, measures and compiles the sidecar, and draws the dialog's preview and, when asked,
// the Compare pair: two small bakes of Summer, level 2, one from the data and one guessed from the
// picture, with the same analyse, analyseExact and bake every device runs. It also checks an
// attached sidecar against a picture. Only the last prepare's answer is kept between messages (so
// turning Compare on doesn't read and measure the map again), and everything is lost when it stops.
//
// The handler is exported (handleDdMessage) so tests can drive it without a worker.

import { DDParseError, parseDungeondraftMap } from "./parse";
import { DEFAULT_LIMITS, GRID, type DDMap } from "./model";
import {
  ExtractError, chooseLevel, extractSidecar, pictureRect, previewOverlay, previewSize, rankLevels,
  type AttachReport, type PictureSample,
} from "./extract";
import { sidecarFit } from "./fit";
import { SidecarError, decodeSidecar, encodeSidecar, type SeasonSidecar } from "./sidecar";
import { SPRITE_SIZES } from "./spriteSizes";
import type { DdWorkerIn, DdWorkerOut } from "./messages";
import { analyse, bake, type SeasonAnalysis } from "../room/seasonPixels";
import { analyseExact } from "../room/seasonExact";
import { analysisGeometry, seasonSquare } from "../room/seasons";

/** Project files over this many bytes are refused before they are read (the parser's maxChars: 60 MiB, for phones). */
export const DD_MAX_FILE_BYTES = DEFAULT_LIMITS.maxChars;

/** The preview's and the Compare bakes' long side, in pixels (2.7). */
export const DD_PREVIEW_SIZE = 512;

/** The picture is measured at no more than this many pixels a square (2.1: 24-32). */
export const DD_MAX_PX_PER_SQUARE = 32;

/**
 * The Compare pair's look: the one most likely to go wrong on a snowy map (2.7), and its noise
 * seed (any fixed one: both bakes share it, so they differ only by the analysis).
 */
export const COMPARE_LOOK = { look: "summer", level: 2, seed: 1 } as const;

/** What the GM is told for each refusal (6.1). */
export const DD_TEXT = {
  tooBig: "That file is too big to read here (over 60 MB).",
  damaged: (name: string) => `${name} isn't a Dungeondraft map, or it's damaged.`,
  noLevels: "This map has no levels to attach.",
  unreadable: "The Dungeondraft data couldn't be read.",
  shape: (w: number, h: number, sw: number, sh: number) =>
    `This picture is ${w}×${h}, which isn't the shape of the map this data was made for (${sw}×${sh} squares), so it can't be used with it.`,
  failed: "Something went wrong reading the map. Try again, or attach it from a desktop browser.",
  noExact: "Exact seasons couldn't be worked out for this map, so they'll be guessed from the picture.",
} as const;

type Post = (m: DdWorkerOut, transfer?: Transferable[]) => void;

/** Handles one message, posting progress lines and then exactly one answer for its id. Never throws. */
export async function handleDdMessage(m: DdWorkerIn, post: Post): Promise<void> {
  try {
    if (m.t === "prepare") await prepare(m, post);
    else if (m.t === "check") check(m, post);
  } catch (e) {
    post({ t: "error", id: m.id, message: plainError(e) });
  }
}

/** A message the GM can read: the extractor's and the picture checks' own, else a general one. */
function plainError(e: unknown): string {
  if (e instanceof ExtractError || e instanceof PlainError) return e.message;
  // A worker short of memory, or a bug: the details go to the console, not to the GM.
  console.warn("Dungeondraft worker:", e);
  return DD_TEXT.failed;
}

class PlainError extends Error {}

/**
 * The last prepare's answer, kept until the next prepare or the worker stops: the dialog asks again,
 * with compare, when the GM turns Compare on, and that shouldn't read and measure the map again
 * (0.5-0.7 s on waterfall, before Compare's 0.9-1.2 s). Only copies of it are sent (a transfer
 * would empty it).
 */
interface Prepared {
  key: string;
  report: AttachReport;
  sidecar: Uint8Array;
  preview: Uint8ClampedArray;
  pw: number;
  ph: number;
  /** The squares across the picture shows. */
  squaresW: number;
  compare?: { exact: Uint8ClampedArray; guessed: Uint8ClampedArray; w: number; h: number; refused: boolean };
}
let last: Prepared | null = null;

async function prepare(m: Extract<DdWorkerIn, { t: "prepare" }>, post: Post): Promise<void> {
  const progress = (text: string) => post({ t: "progress", id: m.id, text });
  if (!(m.file.size <= DD_MAX_FILE_BYTES)) throw new PlainError(DD_TEXT.tooBig);

  const key = await prepareKey(m);
  let done = last?.key === key ? last : null;
  if (!done) {
    // The old answer's memory back before another map is read.
    last = null;
    done = await prepareAnew(m, key, progress);
    last = done;
  }
  if (m.compare && !done.compare) {
    progress("Making the comparison…");
    // From the encoded bytes, as every device will read them.
    const pic = atMostPerSquare(m.pic, done.squaresW, DD_MAX_PX_PER_SQUARE);
    const c = compareBakes(decodeSidecar(done.sidecar), pic, m.picW, m.picH);
    done.compare = { exact: c.exact, guessed: c.guessed, w: c.w, h: c.h, refused: c.reason !== undefined };
  }

  const report: AttachReport = { ...done.report, warnings: [...done.report.warnings] };
  const sidecar = done.sidecar.slice(), preview = done.preview.slice();
  const transfer: Transferable[] = [sidecar.buffer, preview.buffer];
  let compare: Extract<DdWorkerOut, { t: "prepared" }>["compare"];
  if (m.compare && done.compare) {
    const c = done.compare;
    if (c.refused && report.drawn === "winter") report.warnings.push(DD_TEXT.noExact);
    const guessed = c.guessed.slice(), exact = c.exact === c.guessed ? guessed : c.exact.slice();
    compare = { exact, guessed, w: c.w, h: c.h };
    transfer.push(guessed.buffer);
    if (exact !== guessed) transfer.push(exact.buffer);
  }
  post({ t: "prepared", id: m.id, report, sidecar, preview, pw: done.pw, ph: done.ph, compare }, transfer);
}

/** Parses the map, ranks the levels, fits, measures and compiles the sidecar, and draws the preview. */
async function prepareAnew(m: Extract<DdWorkerIn, { t: "prepare" }>, key: string, progress: (text: string) => void): Promise<Prepared> {
  progress("Reading the project file…");
  let map: DDMap;
  {
    const text = await m.file.text();
    progress("Reading the map…");
    try {
      map = parseDungeondraftMap(text);
    } catch (e) {
      if (e instanceof DDParseError) throw new PlainError(DD_TEXT.damaged(m.file.name || "That file"));
      throw e;
    }
  }
  if (map.world.levels.length === 0) throw new PlainError(DD_TEXT.noLevels);

  const r = pictureRect(map, m.picW, m.picH, m.vtt, m.mapRect);
  if ("error" in r) throw new PlainError(r.error);
  const squaresW = (r.rect[2] - r.rect[0]) / GRID;
  const pic = atMostPerSquare(m.pic, squaresW, DD_MAX_PX_PER_SQUARE);

  progress("Finding which level the picture shows…");
  const levels = rankLevels(map, pic, r, m.vtt);
  const picked = m.levelKey !== undefined ? { key: m.levelKey, clear: true } : chooseLevel(levels);
  if (!picked) throw new PlainError(DD_TEXT.noLevels);
  const { sidecar: sc, report } = extractSidecar(map, picked.key, r, pic, SPRITE_SIZES, {
    levels,
    holdLevel: !picked.clear,
    shift: m.shift,
    picSize: [m.picW, m.picH],
    onProgress: progress,
  });
  const sidecar = own(encodeSidecar(sc));

  progress("Drawing the preview…");
  const preview = previewOverlay(sc, pic, DD_PREVIEW_SIZE);
  const [pw, ph] = previewSize(pic.w, pic.h, DD_PREVIEW_SIZE);
  return { key, report, sidecar, preview, pw, ph, squaresW };
}

/** Bytes of the project file sampled at each end for prepareKey. */
const KEY_SAMPLE_BYTES = 64 * 1024;

/**
 * Everything a prepare's answer depends on, Compare aside: the project file (by name, size, date
 * and its first and last 64 KiB, so it isn't read whole), the picture's pixels and size, and the
 * GM's choices.
 */
async function prepareKey(m: Extract<DdWorkerIn, { t: "prepare" }>): Promise<string> {
  const f = m.file;
  const head = new Uint8Array(await f.slice(0, KEY_SAMPLE_BYTES).arrayBuffer());
  const tail = f.size > KEY_SAMPLE_BYTES ? new Uint8Array(await f.slice(Math.max(KEY_SAMPLE_BYTES, f.size - KEY_SAMPLE_BYTES)).arrayBuffer()) : new Uint8Array(0);
  return JSON.stringify([
    f.name, f.size, f.lastModified, hash(tail, hash(head)),
    m.picW, m.picH, m.pic.w, m.pic.h, hash(m.pic.rgba),
    m.vtt ?? null, m.mapRect ?? null, m.levelKey ?? null, m.shift ?? null,
  ]);
}

/** FNV-1a over the bytes (32 bits), carrying on from `h`. */
function hash(b: ArrayLike<number>, h = 0x811c9dc5): number {
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}

function check(m: Extract<DdWorkerIn, { t: "check" }>, post: Post): void {
  let sc: SeasonSidecar;
  try {
    sc = decodeSidecar(m.sidecar);
  } catch (e) {
    if (e instanceof SidecarError) return post({ t: "checked", id: m.id, fit: { error: DD_TEXT.unreadable } });
    throw e;
  }
  // The hard check first (2.8: "re-runs the hard aspect check"): the picture's shape against the
  // data's rectangle, within 1% or 2 pixels, as pictureRect allows a .dd2vtt or a plain export.
  const [x0, y0, x1, y1] = sc.meta.rect;
  const sw = (x1 - x0) / GRID, sh = (y1 - y0) / GRID;
  if (!(sw > 0 && sh > 0 && m.picW > 0 && m.picH > 0) || !sameShape(m.picW, m.picH, sw, sh)) {
    return post({ t: "checked", id: m.id, fit: { error: DD_TEXT.shape(m.picW, m.picH, round2(sw), round2(sh)), hard: true } });
  }
  const pic = atMostPerSquare(m.pic, sw, DD_MAX_PX_PER_SQUARE);
  post({ t: "checked", id: m.id, fit: sidecarFit(sc, pic) });
}

/** Whether a picture of w x h pixels has the shape of sw x sh squares: within 1%, or within 2 pixels on its short side. */
function sameShape(w: number, h: number, sw: number, sh: number): boolean {
  const want = sw / sh, got = w / h;
  if (Math.abs(got - want) <= 0.01 * want) return true;
  return w >= h ? Math.abs(h - w / want) <= 2 : Math.abs(w - h * want) <= 2;
}

// ---------------------------------------------------------------- Compare (2.7)

/**
 * The Compare pair (2.7): the picture at DD_PREVIEW_SIZE baked as Summer, level 2, from the data
 * (left) and guessed from the picture (right), for a scene the picture's full size. The square and
 * the analysis are the board's own (seasons.ts seasonSquare and analysisGeometry: the scene's grid
 * kept within bounds, about 20 px a square, 512-1024 px across), so the GM sees what will bake.
 * `grid` is the scene's grid in scene pixels; without it, the data's square (what a new scene's
 * grid is set to, 2.1). When analyseExact refuses (a green map in v1, or data the rasteriser can't
 * draw in full), every device falls back to the guess, so `exact` is the guess itself (the same
 * array) and `reason` says why.
 */
export function compareBakes(sc: SeasonSidecar, pic: PictureSample, picW: number, picH: number,
  opts: { bare?: "leaf" | "dead"; drawn?: "winter" | "green"; packs?: "guess"; grid?: number } = {}):
  { exact: Uint8ClampedArray; guessed: Uint8ClampedArray; w: number; h: number; reason?: string } {
  const { grid, ...dd } = opts;
  const sceneW = picW > 0 ? picW : pic.w, sceneH = picH > 0 ? picH : pic.h;
  const dataSquare = sceneW / ((sc.meta.rect[2] - sc.meta.rect[0]) / GRID);
  const square = seasonSquare(sceneW, sceneH, grid !== undefined && grid > 0 ? grid : dataSquare);
  const { aw, ah, cellA } = analysisGeometry(sceneW, sceneH, square);
  const small = resample(pic, aw, ah);

  const [w, h] = previewSize(pic.w, pic.h, DD_PREVIEW_SIZE);
  const base = resample(pic, w, h);
  const bakeWith = (a: SeasonAnalysis): Uint8ClampedArray => {
    const out = base.slice();
    bake(out, w, h, {
      x0: 0, y0: 0, scale: sceneW / w, cell: square, seed: COMPARE_LOOK.seed, look: COMPARE_LOOK.look, level: COMPARE_LOOK.level,
      a, sceneW, sceneH,
    });
    return out;
  };
  const guessed = bakeWith(analyse(small, aw, ah, cellA));
  let exact: Uint8ClampedArray;
  let reason: string | undefined;
  try {
    exact = bakeWith(analyseExact(small, aw, ah, cellA, sc, dd));
  } catch (e) {
    exact = guessed;
    reason = String(e);
  }
  return reason === undefined ? { exact, guessed, w, h } : { exact, guessed, w, h, reason };
}

// ---------------------------------------------------------------- pictures

/** The picture with at most `pps` pixels a square across `squaresW` squares (box-averaged), or itself. */
export function atMostPerSquare(pic: PictureSample, squaresW: number, pps: number): PictureSample {
  if (!(squaresW > 0) || pic.w / squaresW <= pps) return pic;
  const k = (pps * squaresW) / pic.w;
  const w = Math.max(1, Math.round(pic.w * k)), h = Math.max(1, Math.round(pic.h * k));
  return { rgba: resample(pic, w, h), w, h };
}

/**
 * The picture at w x h, area-weighted (each output pixel the average of the source area it covers,
 * colours weighted by alpha as a canvas draws them), alpha kept: the transparency rule (2.2) and
 * the analyses read it.
 */
export function resample(pic: PictureSample, w: number, h: number): Uint8ClampedArray {
  const src = pic.rgba, sw = pic.w, sh = pic.h;
  const out = new Uint8ClampedArray(w * h * 4);
  if (sw <= 0 || sh <= 0) return out;
  if (w === sw && h === sh) {
    out.set(src.subarray(0, w * h * 4));
    return out;
  }
  const cols = boxWeights(sw, w), rows = boxWeights(sh, h);
  // Across first, premultiplied: 4 floats a pixel, a row of the output's width per source row.
  const tmp = new Float32Array(sh * w * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = cols.start[x]; k < cols.start[x + 1]; k++) {
        const q = (row + cols.src[k]) * 4, wk = cols.w[k], al = src[q + 3] * wk;
        r += src[q] * al; g += src[q + 1] * al; b += src[q + 2] * al; a += al;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  const acc = new Float64Array(w * 4);
  for (let y = 0; y < h; y++) {
    acc.fill(0);
    for (let k = rows.start[y]; k < rows.start[y + 1]; k++) {
      const from = rows.src[k] * w * 4, wk = rows.w[k];
      for (let i = 0; i < w * 4; i++) acc[i] += tmp[from + i] * wk;
    }
    const to = y * w * 4;
    for (let x = 0; x < w; x++) {
      const a = acc[x * 4 + 3];
      if (a > 0) {
        out[to + x * 4] = acc[x * 4] / a;
        out[to + x * 4 + 1] = acc[x * 4 + 1] / a;
        out[to + x * 4 + 2] = acc[x * 4 + 2] / a;
        out[to + x * 4 + 3] = a;
      }
    }
  }
  return out;
}

/** Area weights of a 1-D resample from n to m cells: output j takes sources src[start[j]..start[j+1]) with weights w (summing to 1). */
function boxWeights(n: number, m: number): { start: Int32Array; src: Int32Array; w: Float64Array } {
  const f = n / m;
  const start = new Int32Array(m + 1);
  const src: number[] = [], w: number[] = [];
  for (let j = 0; j < m; j++) {
    start[j] = src.length;
    const a = j * f, b = Math.min(n, (j + 1) * f);
    if (b <= a) { src.push(Math.min(n - 1, Math.floor(a))); w.push(1); continue; }
    for (let s = Math.floor(a); s < Math.ceil(b) && s < n; s++) {
      const k = Math.min(b, s + 1) - Math.max(a, s);
      if (k > 0) { src.push(s); w.push(k / (b - a)); }
    }
  }
  start[m] = src.length;
  return { start, src: Int32Array.from(src), w: Float64Array.from(w) };
}

/** Bytes that own their whole buffer (so transferring it sends nothing else). */
function own(b: Uint8Array): Uint8Array {
  return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b : b.slice();
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- the worker

// Only inside a worker: importing this file anywhere else (a test) installs nothing.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  const scope = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<DdWorkerIn>) => void) | null };
  // One message at a time, in order: a second attach waits for the first (each holds a whole map).
  let queue: Promise<void> = Promise.resolve();
  scope.onmessage = (e) => {
    const m = e.data;
    queue = queue.then(() => handleDdMessage(m, (out, transfer) => scope.postMessage(out, transfer ?? [])));
  };
}

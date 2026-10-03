// Seasons for uploaded maps: the map picture redrawn as it would look in the scene's season
// (snow, autumn trees, blossom, drought). The work runs in a worker (seasonWorker.ts), once
// per season change, never per frame: first a quick small version, then a sharper one sized
// for this device. The board shows whichever is ready.
// A scene with Dungeondraft data is analysed from that data instead of guessed from the picture
// (seasonExact.ts); whenever the data can't be used, it's guessed as before, never left plain.

import { analyse, bake, outdoorFraction } from "./seasonPixels";
import type { BakeOptions, SeasonAnalysis } from "./seasonPixels";
import { EXACT_VERSION, analyseExact, isSnowy } from "./seasonExact";
import { decodeSidecar } from "../dd/sidecar";
import type { SeasonDdData } from "../dd/messages";
import type { SceneDataState, SidecarCache, SidecarResult } from "./mapData";
import type { SeasonLook } from "../../shared/types";

/** A scene's Dungeondraft data, as far as a bake depends on it (SceneMapData without the picture's id). */
export interface SeasonJobData {
  /** The sidecar asset. */
  assetId: string;
  bare?: "leaf" | "dead";
  drawn?: "winter" | "green";
  packs?: "guess";
}

/** What a job's key and its analysis key gain with data: a new sidecar or option means a new bake. */
export function ddKey(d: SeasonJobData): string {
  return `|dd:${d.assetId}:${d.bare ?? "auto"}:${d.drawn ?? "auto"}:${d.packs ?? "drawn"}:${EXACT_VERSION}`;
}

/**
 * The key of a map's outdoor share (the "indoor map" hint): per picture, and per data, so two scenes
 * sharing a picture, one with data and one without, don't overwrite each other's (5.1).
 */
export function outdoorKey(assetId: string, data?: Pick<SeasonJobData, "assetId">): string {
  return data ? `${assetId}|dd:${data.assetId}` : assetId;
}

/** One grid square in scene pixels for seasons: the grid, kept within sane bounds when it's badly set. */
export function seasonSquare(sceneW: number, sceneH: number, grid: number): number {
  const long = Math.max(sceneW, sceneH);
  return Math.min(long / 8, Math.max(long / 160, grid));
}

/** The analysis size for a scene (about 20 px a square, 512-1024 px across), and a square there. */
export function analysisGeometry(sceneW: number, sceneH: number, square: number): { aw: number; ah: number; kA: number; cellA: number } {
  const long = Math.max(sceneW, sceneH);
  const kA = Math.min(1, Math.min(1024 / long, Math.max(512 / long, 20 / square)));
  return { aw: Math.max(1, Math.round(sceneW * kA)), ah: Math.max(1, Math.round(sceneH * kA)), kA, cellA: square * kA };
}

/** Where a baker gets scenes' Dungeondraft data, and whom it tells when that data can't be used. */
export interface SeasonDataSource {
  sidecars: Pick<SidecarCache, "get">;
  roomId: string;
  /**
   * A job's data couldn't be used (its sidecar's load state, "green", or "unreadable" when the
   * analysis refused it, or both tries at baking from it failed with nothing made). Nothing from the
   * data is shown: the board plans the bake again without it.
   */
  onDataState(data: SeasonJobData, state: SceneDataState): void;
}

export interface SeasonJob {
  /** Everything the result depends on: a new key means a new bake. */
  key: string;
  assetId: string;
  img: HTMLImageElement;
  sceneW: number;
  sceneH: number;
  /** One grid square in scene pixels (kept within sane bounds for a badly set grid). */
  square: number;
  look: SeasonLook;
  level: 1 | 2 | 3;
  seed: number;
  /** The scene's Dungeondraft data, when the board means to use it (the key then ends in ddKey). */
  data?: SeasonJobData;
}

interface Result {
  canvas: HTMLCanvasElement;
  assetId: string;
  /** False for the quick first version, while the sharp one is still being made. */
  final: boolean;
}

interface Out {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** A job's validated sidecar (the cache's own bytes: only copies are sent), with the job's options. */
interface Dd {
  bytes: Uint8Array;
  data: SeasonJobData;
}

/** No canvas may be bigger than this: iPhones and iPads refuse anything over 16.7 million pixels. */
const MAX_CANVAS_PX = 16_000_000;
/** How long the sharp version may take on this device before a softer one is chosen instead. */
const BAKE_BUDGET_MS = 2500;
/** Rows per strip at most, for the quick version and the sharp one. */
const PREVIEW_ROWS = 64;
const STRIP_ROWS = 256;
/**
 * Pixels per strip. Every strip is read from the map and written back here on the page, so
 * strips are kept to about this size whatever the width, and no one step holds up panning
 * for long, even on a phone. Without a worker the recolouring runs here too, so less.
 */
const STRIP_PX = 160_000;
const LOCAL_STRIP_PX = 100_000;
/** Without a worker every strip holds up the page, so the sharp version stays smaller. */
const LOCAL_CAPS = { long: 2048, px: 4_200_000 };
/** How long a new worker has to say it's ready (only counted while the page is in view). */
const WORKER_START_MS = 10_000;
/** After this many workers have failed, everything runs here for the rest of the visit. */
const WORKER_TRIES = 3;
/** A bake that failed is tried once more after this long. */
const RETRY_MS = 5000;

/** The largest picture worth making on this device (long side, and pixels in all). */
export function deviceCaps(display: boolean): { long: number; px: number } {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory;
  const cores = nav.hardwareConcurrency ?? 4;
  // Low memory comes first: a table display is often a TV stick with 1 or 2 GB.
  if (mem !== undefined && mem <= 2) return { long: 2048, px: 4_200_000 };
  // A table display (often a TV stick) shows the whole map at once: 2560 is plenty.
  if (display) return mem !== undefined && mem >= 4 && cores >= 6 ? { long: 4096, px: MAX_CANVAS_PX } : { long: 2560, px: 6_600_000 };
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const short = Math.min(screen.width, screen.height);
  if (coarse && short < 700) return { long: 2896, px: 5_600_000 };
  if (coarse) return { long: 4096, px: 11_200_000 };
  return { long: 6144, px: MAX_CANVAS_PX };
}

/** Gives a canvas's memory back at once (iOS is slow to otherwise). Only for one nothing will draw again. */
function free(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** A canvas to bake into, or null when the browser refuses one that size (out of canvas memory). */
function newCanvas(w: number, h: number): Out | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width !== w || canvas.height !== h) {
    free(canvas);
    return null;
  }
  return { canvas, ctx };
}

/** A canvas the map is drawn into to read its pixels, a strip of up to `rows` rows at a time. */
function newReader(w: number, rows: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = rows + 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    free(canvas);
    throw new Error("no canvas");
  }
  // The smoothest downscale the browser offers (the analysis doesn't depend on it).
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/** The map picture, drawn at w x h, rows y0 to y1 (one extra row each side, trimmed off). */
function readRows(reader: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, y0: number, y1: number): Uint8ClampedArray {
  const top = Math.max(0, y0 - 1);
  const bottom = Math.min(h, y1 + 1);
  const sy = (top * img.naturalHeight) / h;
  const sh = ((bottom - top) * img.naturalHeight) / h;
  // Cleared first, so the last strip never shows through a map's see-through parts.
  reader.clearRect(0, 0, w, bottom - top);
  reader.drawImage(img, 0, sy, img.naturalWidth, sh, 0, 0, w, bottom - top);
  return reader.getImageData(0, y0 - top, w, y1 - y0).data;
}

export class SeasonBaker {
  private workerReady: Promise<Worker | null> | null = null;
  /** Workers that failed so far (no "ready" in time, or an error). */
  private workerFailures = 0;
  /** Stops the current worker, when there is one. */
  private stopWorker: (() => void) | null = null;
  private calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private nextId = 1;
  /** Analyses the worker holds (it keeps two), and the ones kept here when there's no worker. */
  private analysed: string[] = [];
  private local = new Map<string, SeasonAnalysis>();
  private fractions = new Map<string, number>();
  /** Each map's outdoor share from the analysis last used for it (a corrected grid makes a new one). */
  private current = new Map<string, number>();
  private results = new Map<string, Result>();
  /** Pictures dropped from the results, freed once the board is no longer showing them. */
  private retired: HTMLCanvasElement[] = [];
  /** Jobs whose bake failed: not asked for again for now, and never shown as another season. */
  private failed = new Set<string>();
  /** Failed jobs that have had (or are waiting for) their one later try. */
  private retried = new Set<string>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private baking: string | null = null;
  private gen = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly onResult: () => void,
    private readonly display: boolean,
    private readonly data: SeasonDataSource | null = null,
  ) {}

  /**
   * What to show for a job: its own picture if there is one, or while it's being made, the
   * last one made for the same map (so switching looks doesn't flash the plain map). After a
   * bake has failed with nothing made, null: the plain map, never another season's picture
   * (while it's tried again, too).
   */
  image(key: string, assetId: string): HTMLCanvasElement | null {
    const own = this.results.get(key);
    if (own) return own.canvas;
    if (this.failed.has(key) || this.retried.has(key)) return null;
    let stale: HTMLCanvasElement | null = null;
    for (const r of this.results.values()) if (r.assetId === assetId) stale = r.canvas;
    return stale;
  }

  /**
   * How much of the map is open ground with plants (for the "indoor map" hint), from the analysis in
   * use, if known. data: the job's data, when its bake uses it (its share is kept apart).
   */
  outdoor(assetId: string, data?: Pick<SeasonJobData, "assetId">): number | undefined {
    return this.current.get(outdoorKey(assetId, data));
  }

  /** Makes the picture for a job, unless it's already made, on its way, or has failed. */
  request(job: SeasonJob): void {
    if (this.disposed || this.baking === job.key || this.results.get(job.key)?.final || this.failed.has(job.key)) return;
    this.baking = job.key;
    const gen = ++this.gen;
    if (this.timer) clearTimeout(this.timer);
    // A short wait, so clicking through the levels only makes the last one.
    this.timer = setTimeout(() => {
      this.timer = null;
      // One retry: the worker may have dropped the analysis, or stopped (then a new one, or here).
      this.run(job, gen)
        .catch(() => (gen === this.gen ? this.run(job, gen) : undefined))
        .catch((err: unknown) => {
          console.warn("season bake failed", err);
          if (gen !== this.gen) return;
          if (job.data && this.data && !this.results.has(job.key)) {
            // A bake from the data that made nothing: the board is told, and asks again without the
            // data, so it's guessed from the picture, never left plain (5.1). (Once its quick version
            // is made the data bakes fine, so that version shows and it's tried again later, as below.)
            this.baking = null;
            this.data.onDataState(job.data, "unreadable");
          } else {
            this.gaveUp(job);
          }
        });
    }, 150);
  }

  /** The season was turned off, or the map or scene changed: stop any bake in progress. */
  cancel(): void {
    this.gen++;
    this.baking = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Seasons are off on this device: stop, and let every picture go (freed by release once
   * the board has put the plain map back). Turning them on again starts afresh.
   */
  clear(): void {
    this.cancel();
    for (const r of this.results.values()) this.retired.push(r.canvas);
    this.results.clear();
    this.local.clear();
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
    this.failed.clear();
    this.retried.clear();
  }

  /**
   * Frees the pictures dropped from the results, except the one the board is showing: Konva
   * may still draw that one, and drawing a freed canvas fails. The board calls this each time
   * it sets the map picture, so the rest go as soon as nothing shows them.
   */
  release(showing: unknown): void {
    const keep: HTMLCanvasElement[] = [];
    for (const c of this.retired) {
      if (c === showing) keep.push(c);
      else free(c);
    }
    this.retired = keep;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
    this.stopWorker?.();
    this.results.clear();
    this.retired = [];
    this.local.clear();
  }

  private async run(job: SeasonJob, gen: number): Promise<void> {
    const { sceneW, sceneH, square } = job;
    const long = Math.max(sceneW, sceneH);
    // The analysis (what's grass, water, trees) at about 20 pixels a square, 512-1024 px across.
    const { aw, ah, cellA } = analysisGeometry(sceneW, sceneH, square);
    // The scene's Dungeondraft data first. When it can't be used, nothing is baked: the board is
    // told, and asks again without it (so nothing guessed is ever kept under the data's key).
    let dd: Dd | null = null;
    if (job.data) {
      const got: SidecarResult = this.data ? await this.data.sidecars.get(this.data.roomId, job.data.assetId) : { ok: false, state: "missing" };
      if (gen !== this.gen) return;
      // v1: exact seasons for snowy maps only.
      if (!got.ok || !isSnowy(got.meta, job.data.drawn)) {
        this.baking = null;
        this.data?.onDataState(job.data, got.ok ? "green" : got.state);
        return;
      }
      dd = { bytes: got.bytes, data: job.data };
    }
    const pixelKey = `${job.assetId}|${square}|${sceneW}x${sceneH}`;
    const aKey = pixelKey + (job.data ? ddKey(job.data) : "");
    const worker = await this.ensureWorker();
    if (gen !== this.gen) return;
    // Analysed where this bake runs? A worker that stopped took its analyses with it.
    if (!(worker ? this.analysed.includes(aKey) : this.local.has(aKey))) {
      const reader = newReader(aw, ah);
      let src: Uint8ClampedArray;
      try {
        src = readRows(reader, job.img, aw, ah, 0, ah);
      } finally {
        free(reader.canvas);
      }
      const exact = await this.analyse(worker, aKey, src, aw, ah, cellA, dd, pixelKey);
      if (dd && !exact) {
        // The data was refused (the guess made instead is kept under the picture's own key).
        if (gen === this.gen) this.baking = null;
        this.data?.onDataState(dd.data, "unreadable");
        return;
      }
      if (gen !== this.gen) return;
    }
    // The "indoor map" hint goes by the analysis in use, so a corrected grid updates it.
    const frac = this.fractions.get(aKey);
    if (frac !== undefined) this.current.set(outdoorKey(job.assetId, job.data), frac);

    // A quick first version at the analysis size (made already, when this is a second try).
    if (!this.results.has(job.key)) {
      const out = newCanvas(aw, ah);
      if (!out) throw new Error("no canvas");
      if (!(await this.bakeRows(worker, job, aKey, out, 0, ah, gen, this.stripRows(worker, aw, PREVIEW_ROWS)))) return;
      this.store(job, out.canvas, false);
      this.onResult();
      // Showing it may have asked for another bake (the view moved on meanwhile).
      if (gen !== this.gen) return;
    }

    // Then the sharp one: as big as this device can take and bake in time.
    let caps = deviceCaps(this.display);
    if (!worker) caps = { long: Math.min(caps.long, LOCAL_CAPS.long), px: Math.min(caps.px, LOCAL_CAPS.px) };
    const natural = Math.max(job.img.naturalWidth, job.img.naturalHeight);
    let k = Math.min(caps.long, natural) / long;
    k = Math.min(k, Math.sqrt(caps.px / (sceneW * sceneH)), Math.sqrt(MAX_CANVAS_PX / (sceneW * sceneH)));
    const dims = (s: number): [number, number] => [Math.max(1, Math.round(sceneW * s)), Math.max(1, Math.round(sceneH * s))];
    // Only worth making if clearly sharper than the quick one.
    const worth = (w: number, h: number) => w * h > aw * ah * 1.2;
    let [bw, bh] = dims(k);
    if (!worth(bw, bh)) return this.keep(job);
    let out = newCanvas(bw, bh);
    while (!out) {
      // Refused for lack of canvas memory (Safari has no deviceMemory to warn of it): a size down.
      k *= Math.SQRT1_2;
      [bw, bh] = dims(k);
      if (!worth(bw, bh)) return this.keep(job);
      out = newCanvas(bw, bh);
    }

    // The first two strips are made before going on, and the second one is timed. The first
    // may carry one-off costs (building this look's fields, warming the code up) that the
    // rest won't; timing the quick version counted those as if every pixel paid them, and
    // made the sharp one needlessly small.
    let rows = this.stripRows(worker, bw, STRIP_ROWS);
    let y = Math.min(2 * rows, bh);
    const marks: number[] = [];
    if (!(await this.bakeRows(worker, job, aKey, out, 0, y, gen, rows, marks))) return;
    const predicted = y < bh ? ((marks[1] - marks[0]) * bh) / rows : 0;
    if (predicted > BAKE_BUDGET_MS) {
      // Too slow for the budget on this device: start again smaller.
      free(out.canvas);
      k *= Math.sqrt(BAKE_BUDGET_MS / predicted);
      [bw, bh] = dims(k);
      out = worth(bw, bh) ? newCanvas(bw, bh) : null;
      if (!out) return this.keep(job);
      rows = this.stripRows(worker, bw, STRIP_ROWS);
      y = 0;
    }
    if (!(await this.bakeRows(worker, job, aKey, out, y, bh, gen, rows))) return;
    this.store(job, out.canvas, true);
    this.baking = null;
    this.onResult();
  }

  /** The quick version is the best this device will get: it's the final one. */
  private keep(job: SeasonJob): void {
    const r = this.results.get(job.key);
    if (r) r.final = true;
    this.baking = null;
  }

  /**
   * Both tries failed. The job isn't asked for again for now: its quick version shows if it
   * was made (the right season, only softer), otherwise the plain map. It's tried once more
   * a little later, when canvas memory may have been freed or a new worker may start.
   */
  private gaveUp(job: SeasonJob): void {
    this.baking = null;
    this.failed.add(job.key);
    this.onResult();
    if (this.retried.has(job.key)) return;
    this.retried.add(job.key);
    this.retryTimers.set(
      job.key,
      setTimeout(() => {
        this.retryTimers.delete(job.key);
        this.failed.delete(job.key);
        this.onResult();
      }, RETRY_MS),
    );
  }

  private store(job: SeasonJob, canvas: HTMLCanvasElement, final: boolean): void {
    const old = this.results.get(job.key);
    if (old && old.canvas !== canvas) this.retired.push(old.canvas);
    this.results.delete(job.key);
    this.results.set(job.key, { canvas, assetId: job.assetId, final });
    // Keep the newest two (the one showing and the one before it). The board may still be
    // drawing one that's dropped, so they're freed later, by release.
    while (this.results.size > 2) {
      const [k, r] = this.results.entries().next().value!;
      this.results.delete(k);
      this.retired.push(r.canvas);
    }
  }

  /** Rows per strip, so each strip holds about the same number of pixels whatever the width. */
  private stripRows(worker: Worker | null, w: number, most: number): number {
    return Math.max(8, Math.min(worker ? most : 48, Math.floor((worker ? STRIP_PX : LOCAL_STRIP_PX) / w)));
  }

  /**
   * Bakes rows y0 to y1 of the picture into out, a strip at a time (noting the time as each
   * one is done, in marks). False when a newer bake has taken over: out is freed then, as
   * nothing has shown it.
   */
  private async bakeRows(
    worker: Worker | null,
    job: SeasonJob,
    aKey: string,
    out: Out,
    y0: number,
    y1: number,
    gen: number,
    rowsEach: number,
    marks?: number[],
  ): Promise<boolean> {
    if (y0 >= y1) return true;
    const { canvas, ctx } = out;
    const w = canvas.width;
    const h = canvas.height;
    const scale = job.sceneW / w;
    let reader: CanvasRenderingContext2D;
    try {
      reader = newReader(w, rowsEach);
    } catch (err) {
      // Refused (short of canvas memory): the picture it was for goes too.
      free(canvas);
      throw err;
    }
    const read = (y: number) => readRows(reader, job.img, w, h, y, Math.min(y + rowsEach, y1));
    // Checked after every wait (the caller has just checked before the first strip).
    const overtaken = () => {
      if (gen === this.gen) return false;
      free(canvas);
      return true;
    };
    try {
      let next: Uint8ClampedArray | null = null;
      for (let y = y0; y < y1; y += rowsEach) {
        const rows = Math.min(rowsEach, y1 - y);
        const opts: Omit<BakeOptions, "a"> = {
          x0: 0,
          y0: y * scale,
          scale,
          cell: job.square,
          seed: job.seed,
          look: job.look,
          level: job.level,
          sceneW: job.sceneW,
          sceneH: job.sceneH,
        };
        const baking = this.bakeStrip(worker, aKey, next ?? read(y), w, rows, opts);
        // With a worker, the next strip is read while it bakes this one.
        next = worker && y + rows < y1 ? read(y + rows) : null;
        const done = await baking;
        if (overtaken()) return false;
        ctx.putImageData(new ImageData(done as Uint8ClampedArray<ArrayBuffer>, w, rows), 0, y);
        if (!worker) {
          // Without one, the page gets a frame in between.
          await new Promise((r) => setTimeout(r, 0));
          if (overtaken()) return false;
        }
        marks?.push(performance.now());
      }
      return true;
    } catch (err) {
      free(canvas);
      throw err;
    } finally {
      free(reader.canvas);
    }
  }

  /**
   * Analyses the picture, from the scene's data when there is some. False when that data was
   * refused: the analysis guessed from the picture instead is kept under pixelKey, never aKey.
   */
  private async analyse(
    worker: Worker | null,
    aKey: string,
    rgba: Uint8ClampedArray,
    aw: number,
    ah: number,
    cellA: number,
    dd: Dd | null,
    pixelKey: string,
  ): Promise<boolean> {
    if (worker) {
      const msg: Record<string, unknown> = { t: "analyse", key: aKey, rgba, aw, ah, cellA };
      const transfer: Transferable[] = [rgba.buffer];
      if (dd) {
        // A copy goes, as what's posted is handed over: the cache keeps its bytes for the next time.
        const sidecar = dd.bytes.slice();
        const m: SeasonDdData = { sidecar, bare: dd.data.bare, drawn: dd.data.drawn, packs: dd.data.packs };
        msg.dd = m;
        msg.fallbackKey = pixelKey;
        transfer.push(sidecar.buffer);
      }
      const r = (await this.call(worker, msg, transfer)) as { frac: number; exact?: boolean; reason?: string };
      const exact = !dd || r.exact === true;
      if (!exact) console.warn("exact seasons: guessed from the picture instead", r.reason);
      const key = exact ? aKey : pixelKey;
      this.analysed = [...this.analysed.filter((k) => k !== key), key].slice(-2);
      this.fractions.set(key, r.frac);
      return exact;
    }
    let a: SeasonAnalysis;
    let exact = true;
    if (dd) {
      try {
        a = analyseExact(rgba, aw, ah, cellA, decodeSidecar(dd.bytes), dd.data);
      } catch (err) {
        // Never the plain map: guessed from the picture, as without data.
        console.warn("exact seasons: guessed from the picture instead", err);
        a = analyse(rgba, aw, ah, cellA);
        exact = false;
      }
    } else {
      a = analyse(rgba, aw, ah, cellA);
    }
    const key = exact ? aKey : pixelKey;
    this.local.set(key, a);
    while (this.local.size > 2) this.local.delete(this.local.keys().next().value!);
    this.fractions.set(key, outdoorFraction(a));
    return exact;
  }

  private async bakeStrip(
    worker: Worker | null,
    aKey: string,
    rgba: Uint8ClampedArray,
    width: number,
    rows: number,
    opts: Omit<BakeOptions, "a">,
  ): Promise<Uint8ClampedArray> {
    if (worker) {
      const r = (await this.call(worker, { t: "bake", key: aKey, rgba, width, rows, opts }, [rgba.buffer])) as { rgba: Uint8ClampedArray };
      return r.rgba;
    }
    const a = this.local.get(aKey);
    if (!a) throw new Error("no analysis");
    bake(rgba, width, rows, { ...opts, a });
    return rgba;
  }

  private call(worker: Worker, msg: Record<string, unknown>, transfer: Transferable[]): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /**
   * The worker, started on first use. If it can't start in time, that bake runs here instead,
   * more slowly, and the next one tries a new worker. If it stops after starting, the bake's
   * second try starts a new one straight away. After a few failures (an old page after an
   * update, say, where its file is gone) everything runs here.
   */
  private ensureWorker(): Promise<Worker | null> {
    if (this.disposed) return Promise.resolve(null);
    this.workerReady ??= new Promise<Worker | null>((resolve) => {
      let w: Worker;
      try {
        w = new Worker(new URL("./seasonWorker.ts", import.meta.url), { type: "module" });
      } catch {
        // This browser can't start one at all.
        resolve(null);
        return;
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let over = false;
      const stop = (failed: boolean) => {
        if (over) return;
        over = true;
        clearTimeout(timeout);
        w.terminate();
        if (this.stopWorker === stopNow) this.stopWorker = null;
        // Its analyses went with it: they're made again where the next bake runs.
        this.analysed = [];
        if (failed) this.workerReady = ++this.workerFailures < WORKER_TRIES ? null : Promise.resolve(null);
        for (const c of this.calls.values()) c.reject(new Error("season worker stopped"));
        this.calls.clear();
        resolve(null);
      };
      const stopNow = () => stop(false);
      this.stopWorker = stopNow;
      // A page in the background, or put to sleep, isn't held against it: the wait starts over.
      const wait = () => {
        timeout = setTimeout(() => (document.visibilityState === "hidden" ? wait() : stop(true)), WORKER_START_MS);
      };
      wait();
      w.onerror = () => stop(true);
      w.onmessage = (e: MessageEvent<{ t: string; id?: number; message?: string }>) => {
        const m = e.data;
        if (m.t === "ready") {
          clearTimeout(timeout);
          resolve(w);
          return;
        }
        const c = m.id !== undefined ? this.calls.get(m.id) : undefined;
        if (!c) return;
        this.calls.delete(m.id!);
        if (m.t === "error") {
          // The worker lost that analysis (it drops them all on an error): made again next time.
          this.analysed = [];
          c.reject(new Error(m.message));
        } else {
          c.resolve(m);
        }
      };
    });
    return this.workerReady;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeasonLook } from "../src/shared/types";

// SeasonBaker's comings and goings, with light stand-ins for the browser: canvases that only
// remember their size, a worker that runs in this thread, and a recolouring that does nothing
// but move a clock on (so how long a bake takes can be set).
const px = vi.hoisted(() => ({
  clock: 0,
  /** What baking one pixel costs, in nanoseconds on the clock. */
  nsPerPx: 50,
  /** What a bake costs on top when the look changes (building its fields, one set at a time). */
  oneOff: 0,
  fields: "",
  /** How many bakes to fail from now on. */
  failBakes: 0,
  strips: [] as { width: number; rows: number; exact: boolean }[],
  analyses: 0,
  /** Called as each strip is baked. */
  onBake: null as null | ((width: number, rows: number) => void),
  /** Analyses from Dungeondraft data tried, and whether they throw (refusing the data). */
  exactTries: 0,
  exactThrows: false,
  /** The analysis keys the worker was sent, in order. */
  analyseKeys: [] as string[],
  /** Strips (by width, and whether from the data) whose bake fails. */
  failIf: null as null | ((width: number, exact: boolean) => boolean),
  /** How long the worker takes over an analysis from the data, in ms. */
  exactMs: 1,
}));

vi.mock("../src/client/room/seasonPixels", () => ({
  ALGO_VERSION: 4,
  seedFrom: () => 7,
  analyse: (_rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number) => {
    px.analyses++;
    return { aw, ah, cellA };
  },
  // Depends on the grid, as the real one does (and on the data, here).
  outdoorFraction: (a: { cellA: number; exact?: boolean }) => Math.round(a.cellA * 10) / 1000 + (a.exact ? 0.5 : 0),
  bake: (_rgba: Uint8ClampedArray, width: number, rows: number, opts: { look: string; a: { exact?: boolean } }) => {
    if (px.failBakes > 0) {
      px.failBakes--;
      throw new Error("bake failed");
    }
    if (px.failIf?.(width, Boolean(opts.a.exact))) throw new Error("bake failed");
    if (px.fields !== opts.look) {
      px.fields = opts.look;
      px.clock += px.oneOff;
    }
    px.clock += (width * rows * px.nsPerPx) / 1e6;
    px.strips.push({ width, rows, exact: Boolean(opts.a.exact) });
    px.onBake?.(width, rows);
  },
}));

vi.mock("../src/client/room/seasonExact", () => ({
  EXACT_VERSION: 1,
  isSnowy: (meta: { snowShare: number }, drawn?: string) => (drawn ? drawn === "winter" : meta.snowShare >= 0.5),
  analyseExact: (_rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number) => {
    px.exactTries++;
    if (px.exactThrows) throw new Error("exact seasons: refused");
    return { aw, ah, cellA, exact: true };
  },
}));

import { SeasonBaker, ddKey, deviceCaps } from "../src/client/room/seasons";
import type { SeasonDataSource, SeasonJob } from "../src/client/room/seasons";
import { ALGO_VERSION, analyse, bake, outdoorFraction } from "../src/client/room/seasonPixels";
import { analyseExact } from "../src/client/room/seasonExact";
import { SeasonPlanner, SidecarCache, seasonData } from "../src/client/room/mapData";
import type { DataState, SceneDataState, SidecarResult } from "../src/client/room/mapData";
import { packPng } from "../src/client/dd/pngBox";
import { NO_NAME, decodeSidecar, encodeSidecar } from "../src/client/dd/sidecar";
import type { SeasonSidecar } from "../src/client/dd/sidecar";
import type { GridSettings, SceneMapData } from "../src/shared/types";

/** setImmediate and setTimeout before the clock is faked: let real work (unpacking a PNG) finish. */
const realImmediate = (globalThis as unknown as { setImmediate(f: () => void): void }).setImmediate;
const realTimeout = globalThis.setTimeout;

interface FakeCanvas {
  width: number;
  height: number;
  /** A canvas the map is read through (as opposed to one baked into). */
  reader: boolean;
  /** Its size when first drawn on (a freed canvas is 0 x 0). */
  size: [number, number] | null;
  puts: number;
  getContext(type: string, opts?: { willReadFrequently?: boolean }): unknown;
}

let canvases: FakeCanvas[] = [];
/** Canvases to bake into bigger than this get no 2D context, as when canvas memory runs out. */
let refuseAbove = Infinity;

function fakeCanvas(): FakeCanvas {
  const c: FakeCanvas = {
    width: 300,
    height: 150,
    reader: false,
    size: null,
    puts: 0,
    getContext(_type, opts) {
      c.reader = Boolean(opts?.willReadFrequently);
      c.size ??= [c.width, c.height];
      if (!c.reader && c.width * c.height > refuseAbove) return null;
      return {
        canvas: c,
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
        clearRect() {},
        drawImage() {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => void c.puts++,
      };
    },
  };
  canvases.push(c);
  return c;
}

/** A worker that runs here, a millisecond per message. */
class FakeWorker {
  static all: FakeWorker[] = [];
  /** How new workers start: saying they're ready, never answering, or failing to load. */
  static start: "ready" | "silent" | "error" = "ready";
  /** The next worker made stops (as if it crashed) instead of answering its first bake. */
  static crashNext = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  private crash: boolean;
  private analyses = new Map<string, unknown>();

  constructor() {
    FakeWorker.all.push(this);
    this.crash = FakeWorker.crashNext;
    FakeWorker.crashNext = false;
    const start = FakeWorker.start;
    setTimeout(() => {
      if (this.terminated) return;
      if (start === "ready") this.onmessage?.({ data: { t: "ready" } });
      else if (start === "error") this.onerror?.();
    }, 5);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postMessage(sent: any, transfer: Transferable[] = []): void {
    // Handed over as a real worker's message is: what's transferred is gone from the page.
    const m = structuredClone(sent, { transfer });
    if (m.t === "analyse") px.analyseKeys.push(m.key);
    setTimeout(() => {
      if (this.terminated) return;
      const reply = (data: unknown) => this.onmessage?.({ data });
      if (m.t === "analyse") {
        // As seasonWorker.ts: from the data when there is some, else (or when refused) guessed,
        // kept under the fallback key.
        let a: unknown;
        let key = m.key;
        let exact = false;
        if (m.dd) {
          try {
            a = analyseExact(m.rgba, m.aw, m.ah, m.cellA, decodeSidecar(m.dd.sidecar), m.dd);
            exact = true;
          } catch {
            a = analyse(m.rgba, m.aw, m.ah, m.cellA);
            key = m.fallbackKey;
          }
        } else {
          a = analyse(m.rgba, m.aw, m.ah, m.cellA);
        }
        this.analyses.set(key, a);
        reply({ t: "analysed", id: m.id, frac: outdoorFraction(a as Parameters<typeof outdoorFraction>[0]), exact });
        return;
      }
      if (this.crash) {
        this.onerror?.();
        return;
      }
      const a = this.analyses.get(m.key);
      if (!a) return reply({ t: "error", id: m.id, message: "no analysis" });
      try {
        bake(m.rgba, m.width, m.rows, { ...m.opts, a });
      } catch (err) {
        this.analyses.clear();
        return reply({ t: "error", id: m.id, message: String(err) });
      }
      reply({ t: "baked", id: m.id, rgba: m.rgba });
    }, m.t === "analyse" && m.dd ? px.exactMs : 1);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const IMG = { naturalWidth: 2400, naturalHeight: 1800 } as HTMLImageElement;

/** A 1200 x 900 scene whose map is 2400 x 1800 (so its analysis is 512 x 384 at 60 px a square). */
function job(look: SeasonLook = "winter", square = 60): SeasonJob {
  return { key: `M|${look}|2|${square}`, assetId: "M", img: IMG, sceneW: 1200, sceneH: 900, square, look, level: 2, seed: 7 };
}

/** The board, as far as seasons go: shows what the baker has for the current job, and asks for it. */
function board(display = false, data: SeasonDataSource | null = null) {
  const b = {
    job: null as SeasonJob | null,
    shown: null as unknown,
    results: 0,
    baker: null as unknown as SeasonBaker,
    show(j: SeasonJob | null): void {
      b.job = j;
      b.update();
    },
    update(): void {
      if (b.job) {
        b.shown = b.baker.image(b.job.key, b.job.assetId) ?? b.job.img;
        b.baker.request(b.job);
      }
      b.baker.release(b.shown);
    },
  };
  b.baker = new SeasonBaker(
    () => {
      b.results++;
      b.update();
    },
    display,
    data,
  );
  return b;
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const shownSize = (b: { shown: unknown }) => [(b.shown as FakeCanvas).width, (b.shown as FakeCanvas).height];
/** Baked pictures still holding their memory. */
const live = () => canvases.filter((c) => !c.reader && c.puts > 0 && c.width > 0);

beforeEach(() => {
  vi.useFakeTimers();
  canvases = [];
  refuseAbove = Infinity;
  Object.assign(px, { clock: 0, nsPerPx: 50, oneOff: 0, fields: "", failBakes: 0, analyses: 0, onBake: null, exactTries: 0, exactThrows: false, failIf: null, exactMs: 1 });
  px.strips.length = 0;
  px.analyseKeys.length = 0;
  FakeWorker.all = [];
  FakeWorker.start = "ready";
  FakeWorker.crashNext = false;
  vi.stubGlobal("document", { createElement: fakeCanvas, visibilityState: "visible" });
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  vi.stubGlobal("screen", { width: 1920, height: 1080 });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("Worker", FakeWorker);
  vi.spyOn(performance, "now").mockImplementation(() => px.clock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("season baker", () => {
  it("shows a quick version, then a sharp one as big as the device allows, freeing what's replaced", async () => {
    const b = board();
    b.show(job());
    await wait(2000);
    expect(b.results).toBe(2);
    expect(shownSize(b)).toEqual([2400, 1800]);
    // The quick version went once the sharp one replaced it, and so did every reading canvas.
    expect(live()).toEqual([b.shown]);
    expect(canvases.filter((c) => c.reader).every((c) => c.width === 0)).toBe(true);
    // Strips hold about the same number of pixels whatever the width, so no step holds up the page.
    const sharp = px.strips.filter((s) => s.width === 2400);
    expect(sharp.every((s) => s.width * s.rows <= 160_000)).toBe(true);
    expect(sharp.reduce((n, s) => n + s.rows, 0)).toBe(1800);
  });

  it("without a worker, bakes on the page in small strips and at a smaller size", async () => {
    vi.stubGlobal("Worker", undefined);
    const b = board();
    b.show(job());
    await wait(5000);
    expect(shownSize(b)).toEqual([2048, 1536]);
    expect(px.strips.every((s) => s.rows <= 48)).toBe(true);
  });

  it("isn't made smaller by a look's one-off costs (building its fields, warming up)", async () => {
    // The first bake of the look costs 1.5 s extra, then 400 ns a pixel: the sharp version
    // takes 1.7 s, inside the budget. Timing the quick version would have predicted 35 s.
    px.oneOff = 1500;
    px.nsPerPx = 400;
    const b = board();
    b.show(job());
    await wait(2000);
    expect(shownSize(b)).toEqual([2400, 1800]);
  });

  it("isn't made smaller by one-off costs when the quick version was made earlier", async () => {
    px.oneOff = 1500;
    px.nsPerPx = 400;
    const b = board();
    // Autumn's quick version is made, then the GM moves on before the sharp one is done...
    b.show(job("autumn"));
    while (b.results < 1) await wait(1);
    b.show(job("winter"));
    await wait(3000);
    // ...and back: the sharp one's first strip builds autumn's fields again.
    b.show(job("autumn"));
    await wait(3000);
    expect(shownSize(b)).toEqual([2400, 1800]);
  });

  it("makes a smaller sharp version on a device too slow for the budget, and frees the timed one", async () => {
    px.nsPerPx = 2000;
    const b = board();
    b.show(job());
    await wait(2000);
    const [w, h] = shownSize(b);
    expect(w).toBeLessThan(2400);
    expect((w * h * px.nsPerPx) / 1e6).toBeGreaterThan(2400);
    expect((w * h * px.nsPerPx) / 1e6).toBeLessThanOrEqual(2500);
    // The canvas the first strips were timed in (then given up) was freed.
    const timed = canvases.filter((c) => !c.reader && c.size?.[0] === 2400);
    expect(timed.length).toBe(1);
    expect(timed[0].puts).toBe(2);
    expect(timed[0].width).toBe(0);
  });

  it("shows the plain map, not the last season, when the quick version can't be made, and tries once more later", async () => {
    const b = board();
    b.show(job("winter"));
    await wait(2000);
    const winter = b.shown;
    refuseAbove = 0;
    b.show(job("autumn"));
    // While it's being made, the last season stands in (no flash of the plain map).
    expect(b.shown).toBe(winter);
    await wait(2000);
    expect(b.shown).toBe(IMG);
    expect(console.warn).toHaveBeenCalled();
    // Not asked for again straight away, on every change to the scene.
    const made = canvases.length;
    b.update();
    await wait(1000);
    expect(canvases.length).toBe(made);
    // Memory freed up: the later try makes it.
    refuseAbove = Infinity;
    await wait(5000);
    expect(shownSize(b)).toEqual([2400, 1800]);
  });

  it("gives up for good after the later try fails too, still showing the plain map", async () => {
    const b = board();
    b.show(job("winter"));
    await wait(2000);
    refuseAbove = 0;
    b.show(job("autumn"));
    await wait(10_000);
    const made = canvases.length;
    await wait(20_000);
    b.update();
    await wait(2000);
    expect(canvases.length).toBe(made);
    expect(b.shown).toBe(IMG);
    // Another look is still made (the baker isn't stuck).
    refuseAbove = Infinity;
    b.show(job("spring"));
    await wait(2000);
    expect(shownSize(b)).toEqual([2400, 1800]);
  });

  it("makes the sharp version a size smaller when the browser refuses its canvas", async () => {
    refuseAbove = 3_000_000;
    const b = board();
    b.show(job());
    await wait(2000);
    expect(shownSize(b)).toEqual([1697, 1273]);
  });

  it("keeps the quick version as the final one when no sharper canvas is allowed", async () => {
    refuseAbove = 250_000;
    const b = board();
    b.show(job("winter"));
    await wait(2000);
    expect(shownSize(b)).toEqual([512, 384]);
    const strips = px.strips.length;
    b.update();
    await wait(2000);
    expect(px.strips.length).toBe(strips);
    b.show(job("spring"));
    await wait(2000);
    expect(b.results).toBeGreaterThan(1);
    expect(shownSize(b)).toEqual([512, 384]);
    expect(px.strips.length).toBeGreaterThan(strips);
  });

  it("recovers when a bake fails once (the retry makes it)", async () => {
    const b = board();
    px.failBakes = 1;
    b.show(job());
    await wait(2000);
    expect(shownSize(b)).toEqual([2400, 1800]);
  });

  it("analyses again after the worker stops, in a new worker", async () => {
    const b = board();
    b.show(job("winter"));
    await wait(2000);
    FakeWorker.all[0].onerror?.();
    b.show(job("autumn"));
    await wait(2000);
    expect(shownSize(b)).toEqual([2400, 1800]);
    expect(FakeWorker.all.length).toBe(2);
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(px.analyses).toBe(2);
  });

  it("finishes a bake whose worker stops half way", async () => {
    FakeWorker.crashNext = true;
    const b = board();
    b.show(job());
    await wait(2000);
    expect(shownSize(b)).toEqual([2400, 1800]);
    expect(FakeWorker.all.length).toBe(2);
  });

  it("runs a bake here when the worker doesn't start, tries a new one next time, and stops trying after three", async () => {
    FakeWorker.start = "silent";
    const b = board();
    b.show(job("winter"));
    await wait(12_000);
    // Made here, at the size for baking on the page itself.
    expect(shownSize(b)).toEqual([2048, 1536]);
    for (const look of ["autumn", "spring", "summer"] as const) {
      b.show(job(look));
      await wait(12_000);
      expect(shownSize(b)).toEqual([2048, 1536]);
    }
    expect(FakeWorker.all.length).toBe(3);
    expect(FakeWorker.all.every((w) => w.terminated)).toBe(true);
  });

  it("doesn't hold a slow start against the worker while the page is in the background", async () => {
    FakeWorker.start = "silent";
    const doc = { createElement: fakeCanvas, visibilityState: "hidden" };
    vi.stubGlobal("document", doc);
    const b = board();
    b.show(job());
    await wait(30_000);
    expect(FakeWorker.all[0].terminated).toBe(false);
    doc.visibilityState = "visible";
    await wait(12_000);
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(shownSize(b)).toEqual([2048, 1536]);
  });

  it("reports the outdoor share of the analysis in use, so a corrected grid updates it", async () => {
    vi.stubGlobal("Worker", undefined);
    const b = board();
    b.show(job("winter", 60));
    await wait(5000);
    expect(b.baker.outdoor("M")).toBeCloseTo(0.256);
    b.show(job("winter", 30));
    await wait(5000);
    expect(b.baker.outdoor("M")).toBeCloseTo(0.2);
    // Back to the first grid, whose analysis is still kept.
    b.show(job("autumn", 60));
    await wait(5000);
    expect(b.baker.outdoor("M")).toBeCloseTo(0.256);
    expect(px.analyses).toBe(2);
  });

  it("stops a cancelled bake and frees its unfinished canvas", async () => {
    const b = board();
    b.show(job());
    while (b.results < 1) await wait(1);
    await wait(5);
    const sharp = canvases.find((c) => !c.reader && c.width === 2400);
    expect(sharp).toBeDefined();
    b.baker.cancel();
    await wait(2000);
    expect(sharp!.width).toBe(0);
    expect(b.results).toBe(1);
  });

  it("stops at once when showing the quick version moves the view on", async () => {
    const b = board();
    let strips = 0;
    const update = b.update;
    b.update = () => {
      update();
      if (b.results === 1 && !strips) {
        // The view moved to a scene with no season just as the quick version came in.
        b.baker.cancel();
        b.job = null;
        strips = px.strips.length;
      }
    };
    b.show(job());
    await wait(2000);
    expect(px.strips.length).toBe(strips);
    expect(b.results).toBe(1);
  });

  it("drops a bake on the page cancelled during its last pause", async () => {
    vi.stubGlobal("Worker", undefined);
    const b = board();
    let sharp = 0;
    px.onBake = (width) => {
      // The last strip of the 2048 x 1536 version (32 of 48 rows): cancelled while the page gets its frame.
      if (width === 2048 && ++sharp === 32) setTimeout(() => b.baker.cancel(), 0);
    };
    b.show(job());
    await wait(5000);
    expect(sharp).toBe(32);
    expect(b.results).toBe(1);
    expect(canvases.find((c) => c.size?.[0] === 2048)!.width).toBe(0);
  });

  it("frees a picture pushed out by newer ones once it's off screen", async () => {
    const b = board();
    b.show(job("winter"));
    await wait(2000);
    const winter = b.shown as FakeCanvas;
    b.show(job("autumn"));
    await wait(2000);
    b.show(job("spring"));
    await wait(2000);
    expect(winter.width).toBe(0);
    expect(live().length).toBe(2);
  });

  it("lets every picture go when seasons are turned off, but never the one on screen", async () => {
    const b = board();
    b.show(job("winter"));
    await wait(2000);
    b.show(job("autumn"));
    await wait(2000);
    const pictures = live();
    expect(pictures.length).toBe(2);
    b.baker.clear();
    // The board is still drawing autumn: it stays until the plain map is up.
    b.baker.release(b.shown);
    expect(live()).toEqual([b.shown]);
    b.job = null;
    b.shown = IMG;
    b.update();
    expect(live()).toEqual([]);
  });

  it("stops the worker when disposed, even one still starting", async () => {
    const b = board();
    b.show(job());
    await wait(152);
    expect(FakeWorker.all.length).toBe(1);
    b.baker.dispose();
    expect(FakeWorker.all[0].terminated).toBe(true);
    await wait(15_000);
    expect(b.results).toBe(0);
  });

  it("keeps a table display on a low-memory device to the low-memory size", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 4, deviceMemory: 2 });
    expect(deviceCaps(true)).toEqual({ long: 2048, px: 4_200_000 });
    expect(deviceCaps(false)).toEqual({ long: 2048, px: 4_200_000 });
    vi.stubGlobal("navigator", { hardwareConcurrency: 4, deviceMemory: 4 });
    expect(deviceCaps(true)).toEqual({ long: 2560, px: 6_600_000 });
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
    expect(deviceCaps(true)).toEqual({ long: 4096, px: 16_000_000 });
  });
});

// ---------------------------------------------------------------- Dungeondraft data (design 5.1, 6.3 Pipeline)

const MD: SceneMapData = { assetId: "S1", forAssetId: "M" };
/** The analysis key of job() without data. */
const PIXEL_AKEY = "M|60|1200x900";

/** A small sidecar (nothing on it), snowy unless said otherwise. */
function sidecarBytes(snowShare = 1): Uint8Array {
  const sc: SeasonSidecar = {
    meta: { rect: [0, 0, 256, 256], squares: [1, 1], extractor: 1, snowShare, packShare: 0, packItems: 0, dropped: 0, names: [] },
    terrain: null,
    bitmaps: [],
    shapes: [],
    objects: {
      n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0),
      flags: new Uint8Array(0), name: new Uint16Array(0).fill(NO_NAME), reach: new Uint16Array(0),
    },
  };
  return encodeSidecar(sc);
}

/** A cache that answers at once: the same bytes object every time, as the real one keeps them. */
function fakeCache(results: Record<string, SidecarResult>) {
  const asked = new Set<string>();
  return {
    gets: 0,
    get(_roomId: string, id: string): Promise<SidecarResult> {
      this.gets++;
      asked.add(id);
      return Promise.resolve(results[id] ?? { ok: false, state: "missing" });
    },
    state(id: string): DataState | undefined {
      const r = results[id];
      return !asked.has(id) ? undefined : !r ? "missing" : r.ok ? "ok" : r.state;
    },
    meta(id: string) {
      const r = results[id];
      return asked.has(id) && r?.ok ? r.meta : undefined;
    },
  };
}

const okResult = (bytes: Uint8Array): SidecarResult => ({ ok: true, bytes, meta: decodeSidecar(bytes).meta });

/**
 * The board, as board.ts runs it for seasons: SeasonPlanner decides from the scene's data state
 * whether the bake uses the data, and the baker's or the cache's news plans it again (a microtask
 * later, as the board's replanSeason).
 */
function ddBoard(sidecars: Pick<SidecarCache, "get" | "state" | "meta">) {
  const d = {
    md: MD as SceneMapData | undefined,
    look: "winter" as SeasonLook,
    square: 60,
    /** What the baker said about the data, in order. */
    told: [] as SceneDataState[],
    scene: () => ({
      id: "scene1",
      season: { look: d.look, level: 2 as const },
      mapAssetId: "M",
      mapData: d.md,
      width: 1200,
      height: 900,
      grid: { size: d.square } as GridSettings,
    }),
    state: (): SceneDataState => planner.state(d.scene()),
    plan: (): SeasonJob => planner.job(d.scene(), IMG, d.state(), false)!,
    show: () => b.show(d.plan()),
    replan: () => queueMicrotask(() => d.show()),
  };
  const planner = new SeasonPlanner(sidecars, "room1", () => d.replan());
  const b = board(false, {
    ...planner.source,
    onDataState(data, st) {
      d.told.push(st);
      planner.source.onDataState(data, st);
    },
  });
  return Object.assign(d, { b, planner });
}

/** The key of ddBoard's job without data (as board.ts makes it). */
const pixKey = (look: SeasonLook = "winter", square = 60) => ["M", look, 2, 7, square, 1200, 900, ALGO_VERSION].join("|");
const ddAKey = (md: SceneMapData = MD) => PIXEL_AKEY + ddKey(seasonData(md));
/** Whether the strips of the sharp version (2400 wide) were all baked from the data, or all guessed. */
const sharpFrom = () => {
  const sharp = px.strips.filter((s) => s.width === 2400);
  return sharp.every((s) => s.exact) ? "data" : sharp.every((s) => !s.exact) ? "picture" : "mixed";
};

describe("season baker with Dungeondraft data", () => {
  it("keys bakes and analyses by the data, and gives paused, held and missing data the picture's own keys", async () => {
    const cache = fakeCache({ S1: okResult(sidecarBytes()) });
    const d = ddBoard(cache);
    const keys: string[] = [];
    const variants: Array<SceneMapData | undefined> = [MD, { ...MD, bare: "dead" }, { ...MD, packs: "guess" }, { ...MD, forAssetId: "X" }, { ...MD, hold: true }, undefined];
    for (const md of variants) {
      d.md = md;
      d.show();
      await wait(2000);
      keys.push(d.b.job!.key);
      expect(shownSize(d.b)).toEqual([2400, 1800]);
    }
    expect(new Set(keys.slice(0, 3)).size).toBe(3);
    expect(keys.slice(3)).toEqual([pixKey(), pixKey(), pixKey()]);
    expect(px.analyseKeys).toEqual([ddAKey(), ddAKey({ ...MD, bare: "dead" }), ddAKey({ ...MD, packs: "guess" }), PIXEL_AKEY]);
    expect(d.told).toEqual([]);
  });

  it("guesses a green map from the picture in v1, unless the GM says it's drawn in winter", async () => {
    const cache = fakeCache({ G: okResult(sidecarBytes(0.2)) });
    const d = ddBoard(cache);
    d.md = { assetId: "G", forAssetId: "M" };
    d.show();
    await wait(2000);
    expect(d.told).toEqual(["green"]);
    expect(d.state()).toBe("green");
    expect(d.b.job!.key).toBe(pixKey());
    expect(px.analyseKeys).toEqual([PIXEL_AKEY]);
    expect(px.exactTries).toBe(0);
    expect(sharpFrom()).toBe("picture");
    d.md = { assetId: "G", forAssetId: "M", drawn: "winter" };
    px.strips.length = 0;
    d.show();
    await wait(2000);
    expect(d.b.job!.key).toBe(pixKey() + ddKey({ assetId: "G", drawn: "winter" }));
    expect(sharpFrom()).toBe("data");
  });

  it("sends a copy of the cached sidecar, so the next analysis has it too, even after the worker restarts", async () => {
    const bytes = sidecarBytes();
    const cache = fakeCache({ S1: okResult(bytes) });
    const d = ddBoard(cache);
    d.show();
    await wait(2000);
    // A corrected grid: analysed again, from the same cached bytes.
    d.square = 30;
    d.show();
    await wait(2000);
    expect(px.exactTries).toBe(2);
    FakeWorker.all[0].onerror?.();
    d.look = "autumn";
    d.show();
    await wait(2000);
    expect(FakeWorker.all.length).toBe(2);
    expect(px.exactTries).toBe(3);
    expect(px.analyses).toBe(0);
    expect(d.told).toEqual([]);
    expect(bytes.byteLength).toBeGreaterThan(16);
    expect(decodeSidecar(bytes).meta.snowShare).toBe(1);
    expect(sharpFrom()).toBe("data");
    expect(shownSize(d.b)).toEqual([2400, 1800]);
  });

  it("goes back to the picture when the worker refuses the data, keeping nothing guessed under the data's key", async () => {
    px.exactThrows = true;
    const cache = fakeCache({ S1: okResult(sidecarBytes()) });
    const d = ddBoard(cache);
    d.show();
    await wait(2000);
    expect(d.told).toEqual(["unreadable"]);
    expect(d.state()).toBe("unreadable");
    expect(d.b.job!.key).toBe(pixKey());
    // The guess made in the worker is the one baked: the picture isn't analysed twice.
    expect(px.analyseKeys).toEqual([ddAKey()]);
    expect(px.analyses).toBe(1);
    expect(sharpFrom()).toBe("picture");
    expect(shownSize(d.b)).toEqual([2400, 1800]);
    const results = (d.b.baker as unknown as { results: Map<string, unknown> }).results;
    expect([...results.keys()]).toEqual([pixKey()]);
    // Refused for the rest of the visit, even once it would work.
    px.exactThrows = false;
    d.look = "spring";
    d.show();
    await wait(2000);
    expect(d.b.job!.key).toBe(pixKey("spring"));
    expect(px.exactTries).toBe(1);
  });

  it("does the same without a worker", async () => {
    vi.stubGlobal("Worker", undefined);
    const cache = fakeCache({ S1: okResult(sidecarBytes()) });
    const d = ddBoard(cache);
    d.show();
    await wait(5000);
    expect(px.exactTries).toBe(1);
    expect(px.strips.every((s) => s.exact)).toBe(true);
    expect(shownSize(d.b)).toEqual([2048, 1536]);
    px.exactThrows = true;
    px.strips.length = 0;
    d.md = { ...MD, bare: "dead" };
    d.show();
    await wait(5000);
    expect(d.told).toEqual(["unreadable"]);
    expect(d.b.job!.key).toBe(pixKey());
    expect(px.analyses).toBe(1);
    expect(px.strips.length).toBeGreaterThan(0);
    expect(px.strips.every((s) => !s.exact)).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });

  it("goes back to the picture when a bake from the data fails both tries, so the plain map never stays", async () => {
    // The analysis is fine, but every strip baked from the data fails (a kernel fault on this data, say).
    px.failIf = (_width, exact) => exact;
    const cache = fakeCache({ S1: okResult(sidecarBytes()) });
    const d = ddBoard(cache);
    d.show();
    await wait(4000);
    expect(d.told).toEqual(["unreadable"]);
    expect(d.state()).toBe("unreadable");
    expect(d.b.job!.key).toBe(pixKey());
    expect(shownSize(d.b)).toEqual([2400, 1800]);
    expect(sharpFrom()).toBe("picture");
    // Tried twice from the data (the worker may have stopped), then guessed from the picture, once.
    expect(px.exactTries).toBe(2);
    expect(px.analyseKeys).toEqual([ddAKey(), ddAKey(), PIXEL_AKEY]);
    expect(px.analyses).toBe(1);
    const results = (d.b.baker as unknown as { results: Map<string, unknown> }).results;
    expect([...results.keys()]).toEqual([pixKey()]);
    expect(console.warn).toHaveBeenCalled();
    // Not asked for again, and the picture's own bake isn't held up by the failed one.
    d.look = "spring";
    d.show();
    await wait(2000);
    expect(d.b.job!.key).toBe(pixKey("spring"));
    expect(px.exactTries).toBe(2);
    expect(shownSize(d.b)).toEqual([2400, 1800]);
  });

  it("keeps a quick version made from the data when only the sharp one fails, and tries that again later", async () => {
    px.failIf = (width, exact) => exact && width === 2400;
    const cache = fakeCache({ S1: okResult(sidecarBytes()) });
    const d = ddBoard(cache);
    d.show();
    await wait(2000);
    // The right season from the data, only softer: not the plain map, and not a guess.
    expect(shownSize(d.b)).toEqual([512, 384]);
    expect(d.told).toEqual([]);
    expect(d.state()).toBe("ok");
    expect(d.b.job!.key).toBe(pixKey() + ddKey(MD));
    expect(px.analyses).toBe(0);
    px.failIf = null;
    await wait(7000);
    expect(shownSize(d.b)).toEqual([2400, 1800]);
    expect(sharpFrom()).toBe("data");
    expect(d.told).toEqual([]);
  });

  it("ignores a sidecar that comes for a job the board has moved on from", async () => {
    const cache = fakeCache({ S2: okResult(sidecarBytes()) });
    let arrive!: (r: SidecarResult) => void;
    const slow = new Promise<SidecarResult>((r) => (arrive = r));
    const get = cache.get.bind(cache);
    cache.get = (roomId, id) => (id === "S1" ? slow : get(roomId, id));
    const d = ddBoard(cache);
    // S1's sidecar is slow to come...
    d.show();
    await wait(200);
    expect(px.analyseKeys).toEqual([]);
    // ...and the GM attaches other data meanwhile, which comes at once.
    const S2: SceneMapData = { assetId: "S2", forAssetId: "M" };
    d.md = S2;
    d.show();
    await wait(2000);
    expect(d.b.job!.key).toBe(pixKey() + ddKey(seasonData(S2)));
    expect(sharpFrom()).toBe("data");
    // S1's can't be found after all: nobody's waiting for it, so nothing is said, and nothing planned again.
    arrive({ ok: false, state: "missing" });
    await wait(2000);
    expect(d.told).toEqual([]);
    expect(px.analyseKeys).toEqual([ddAKey(S2)]);
    expect(px.exactTries).toBe(1);
    expect(d.b.job!.key).toBe(pixKey() + ddKey(seasonData(S2)));
  });

  it("keeps the newer job's bake going when an older one's data is refused meanwhile", async () => {
    px.exactThrows = true;
    px.exactMs = 2000;
    const cache = fakeCache({ S1: okResult(sidecarBytes()) });
    const d = ddBoard(cache);
    d.show();
    // S1's analysis is with the worker, which takes 2 s over it...
    await wait(2000);
    expect(px.analyseKeys).toEqual([ddAKey()]);
    expect(d.told).toEqual([]);
    // ...when the GM removes the data: the plain job is baking when the refusal comes back.
    d.md = undefined;
    d.show();
    await wait(2000);
    expect(d.told).toEqual(["unreadable"]);
    expect(px.analyseKeys).toEqual([ddAKey(), PIXEL_AKEY]);
    expect(px.analyses).toBe(2);
    expect(d.b.results).toBe(2);
    // The refusal was an older job's: the one under way wasn't started over, so nothing baked was thrown away.
    expect(px.strips.filter((s) => s.width === 512).reduce((n, s) => n + s.rows, 0)).toBe(384);
    expect(px.strips.filter((s) => s.width === 2400).reduce((n, s) => n + s.rows, 0)).toBe(1800);
    expect(sharpFrom()).toBe("picture");
    expect(shownSize(d.b)).toEqual([2400, 1800]);
  });

  it("keeps the outdoor hint apart for a bake that uses data", async () => {
    const cache = fakeCache({ S1: okResult(sidecarBytes()) });
    const d = ddBoard(cache);
    d.show();
    await wait(2000);
    d.md = undefined;
    d.show();
    await wait(2000);
    expect(d.b.baker.outdoor("M")).toBeCloseTo(0.256);
    expect(d.b.baker.outdoor("M", { assetId: "S1" })).toBeCloseTo(0.756);
  });

  it("bakes from the picture while the sidecar can't be fetched, tries at 5 s and 30 s, and after wake() bakes from the data", async () => {
    const png = new Uint8Array(await (await packPng(sidecarBytes())).blob.arrayBuffer());
    const replies: Array<"net" | Uint8Array> = ["net", "net", "net", png];
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        const r = replies.shift()!;
        if (r === "net") throw new TypeError("Failed to fetch");
        return new Response(r.slice(), { status: 200 });
      }),
    );
    // Real work (fetching, unpacking) finishes in real time, between the fake clock's steps.
    const io = async (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        await wait(100);
        await new Promise<void>((r) => realImmediate(r));
      }
    };
    /**
     * Real turns, no fake time, until `what` holds: how long fetching and unpacking take for real
     * depends on how busy the machine is (the full suite runs other files alongside), so it's
     * waited for, not counted in turns.
     */
    const settled = async (what: () => boolean) => {
      for (let i = 0; i < 2000 && !what(); i++) await new Promise<void>((r) => realTimeout(r, 5));
      expect(what()).toBe(true);
    };
    let d: ReturnType<typeof ddBoard>;
    const cache = new SidecarCache(() => d.replan());
    d = ddBoard(cache);
    d.show();
    await io(2000);
    await settled(() => fetched.length === 1 && d.state() === "retrying");
    expect(d.b.job!.key).toBe(pixKey());
    expect(shownSize(d.b)).toEqual([2400, 1800]);
    expect(sharpFrom()).toBe("picture");
    await io(5000);
    await settled(() => fetched.length === 2);
    expect(d.state()).toBe("retrying");
    await io(30_000);
    await settled(() => fetched.length === 3 && d.state() === "missing");
    await io(60_000);
    expect(fetched.length).toBe(3);
    // A scene change or the page in view again: tried once more, and it comes.
    px.strips.length = 0;
    cache.wake();
    // The job's short wait is over: its sidecar is asked for, and comes once unpacked (in real time).
    await io(200);
    expect(fetched.length).toBe(4);
    await settled(() => cache.state("S1") === "ok");
    await io(2000);
    expect(d.state()).toBe("ok");
    expect(d.b.job!.key).toBe(pixKey() + ddKey(MD));
    expect(sharpFrom()).toBe("data");
    expect(shownSize(d.b)).toEqual([2400, 1800]);
  });
});

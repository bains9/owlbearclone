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
  strips: [] as { width: number; rows: number }[],
  analyses: 0,
  /** Called as each strip is baked. */
  onBake: null as null | ((width: number, rows: number) => void),
}));

vi.mock("../src/client/room/seasonPixels", () => ({
  analyse: (_rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number) => {
    px.analyses++;
    return { aw, ah, cellA };
  },
  // Depends on the grid, as the real one does.
  outdoorFraction: (a: { cellA: number }) => Math.round(a.cellA * 10) / 1000,
  bake: (_rgba: Uint8ClampedArray, width: number, rows: number, opts: { look: string }) => {
    if (px.failBakes > 0) {
      px.failBakes--;
      throw new Error("bake failed");
    }
    if (px.fields !== opts.look) {
      px.fields = opts.look;
      px.clock += px.oneOff;
    }
    px.clock += (width * rows * px.nsPerPx) / 1e6;
    px.strips.push({ width, rows });
    px.onBake?.(width, rows);
  },
}));

import { SeasonBaker, deviceCaps } from "../src/client/room/seasons";
import type { SeasonJob } from "../src/client/room/seasons";
import { analyse, bake, outdoorFraction } from "../src/client/room/seasonPixels";

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
  postMessage(m: any): void {
    setTimeout(() => {
      if (this.terminated) return;
      const reply = (data: unknown) => this.onmessage?.({ data });
      if (m.t === "analyse") {
        const a = analyse(m.rgba, m.aw, m.ah, m.cellA);
        this.analyses.set(m.key, a);
        reply({ t: "analysed", id: m.id, frac: outdoorFraction(a) });
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
    }, 1);
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
function board(display = false) {
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
  b.baker = new SeasonBaker(() => {
    b.results++;
    b.update();
  }, display);
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
  Object.assign(px, { clock: 0, nsPerPx: 50, oneOff: 0, fields: "", failBakes: 0, analyses: 0, onBake: null });
  px.strips.length = 0;
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

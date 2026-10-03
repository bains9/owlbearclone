// The GM's attach path (design 2.1, 2.7, 2.8, 6.4, 7.2 WP3): the dd worker's message handling
// (ddWorker.ts, driven directly), and the main-thread API (attach.ts) with a fake worker that runs
// that handler here, a fake image and canvas, and a stubbed fetch. Also the sidecar clean-up.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPARE_LOOK, DD_MAX_FILE_BYTES, DD_MAX_PX_PER_SQUARE, DD_PREVIEW_SIZE, DD_TEXT, atMostPerSquare, compareBakes,
  handleDdMessage, resample,
} from "../src/client/dd/ddWorker";
import type * as AttachModule from "../src/client/dd/attach";
import type { DdWorkerIn, DdWorkerOut } from "../src/client/dd/messages";
import type { PictureSample, VttMeta } from "../src/client/dd/extract";
import { sidecarFit } from "../src/client/dd/fit";
import { parseDungeondraftMap } from "../src/client/dd/parse";
import { packPng, unpackPng } from "../src/client/dd/pngBox";
import { SIDECAR_HEADER_BYTES, decodeSidecar, encodeSidecar } from "../src/client/dd/sidecar";
import { RoomClient } from "../src/client/room/client";
import { analyse, bake } from "../src/client/room/seasonPixels";
import { analysisGeometry, seasonSquare } from "../src/client/room/seasons";
import { DEFAULT_GRID } from "../src/shared/sanitize";
import type { Asset, Scene } from "../src/shared/types";
import { pelcsLike, snowyMap, twinLevels } from "./fixtures/ddSynthetic";
import { fakeExportFromMap } from "./fixtures/fakeExport";
import { atPxPerSquare, downsample, haveVernExport, vernPicture, waterfallText } from "./helpers/ddFixtures";

const perf = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PERF;

type Posted = { m: DdWorkerOut; transfer?: Transferable[] };

/** Runs one message through the worker's handler: everything it posts. */
async function run(m: DdWorkerIn): Promise<Posted[]> {
  const out: Posted[] = [];
  await handleDdMessage(m, (o, transfer) => out.push({ m: o, transfer }));
  return out;
}

/** As run, with each post sent as postMessage sends it: cloned, and its transfers emptied here. */
async function runPosted(m: DdWorkerIn): Promise<Posted[]> {
  const out: Posted[] = [];
  await handleDdMessage(m, (o, transfer) => out.push({ m: structuredClone(o, { transfer: transfer ?? [] }), transfer }));
  return out;
}

/** The part of a picture at `pps` px a square showing squares [x, y, w, h]. */
function cropSquares(pic: PictureSample, pps: number, [x, y, w, h]: [number, number, number, number]): PictureSample {
  const W = w * pps, H = h * pps;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let r = 0; r < H; r++) {
    const from = ((y * pps + r) * pic.w + x * pps) * 4;
    rgba.set(pic.rgba.subarray(from, from + W * 4), r * W * 4);
  }
  return { rgba, w: W, h: H };
}

/** The one answer among the posts (progress lines aside). */
function answer(posts: Posted[]): Posted {
  const a = posts.filter((p) => p.m.t !== "progress");
  expect(a.length).toBe(1);
  expect(a[0].m.id).toBe(posts[0].m.id);
  return a[0];
}

/** Whether two byte arrays hold the same bytes (toEqual on big arrays makes a diff that takes minutes when they differ). */
function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const ddFile = (text: string, name = "map.dungeondraft_map") => new File([text], name);

// The snowy 20 x 12 synthetic map, exported plain at 40 px a square (shrunk to 32 by the worker).
const snowy = snowyMap();
const snowyParsed = parseDungeondraftMap(snowy.text);
const snowyPic = fakeExportFromMap(snowyParsed, snowy.levelKey, 40);

describe("the dd worker: prepare", () => {
  it("refuses a file over 60 MiB without reading it", async () => {
    const text = vi.fn();
    const big = { size: DD_MAX_FILE_BYTES + 1, name: "huge.dungeondraft_map", text } as unknown as File;
    const posts = await run({ t: "prepare", id: 7, file: big, pic: snowyPic, picW: snowyPic.w, picH: snowyPic.h });
    expect(posts).toEqual([{ m: { t: "error", id: 7, message: DD_TEXT.tooBig }, transfer: undefined }]);
    expect(text).not.toHaveBeenCalled();
    expect(DD_MAX_FILE_BYTES).toBe(60 * 1024 * 1024);
  });

  it("says a file that isn't a Dungeondraft map is damaged, by its name", async () => {
    const posts = await run({ t: "prepare", id: 1, file: ddFile("{ not json", "notes.dungeondraft_map"), pic: snowyPic, picW: 800, picH: 480 });
    expect(answer(posts).m).toEqual({ t: "error", id: 1, message: "notes.dungeondraft_map isn't a Dungeondraft map, or it's damaged." });
  });

  it("passes the picture checks' refusals on as they are", async () => {
    const square = { rgba: new Uint8ClampedArray(100 * 100 * 4).fill(255), w: 100, h: 100 };
    const a = answer(await run({ t: "prepare", id: 2, file: ddFile(snowy.text), pic: square, picW: 100, picH: 100 })).m;
    expect(a).toEqual({
      t: "error", id: 2,
      message: "This picture is 100×100 but the map is 20×12 squares, so it isn't an export of the whole map. If you exported part of it, choose its .dd2vtt export too.",
    });
    const b = answer(await run({ t: "prepare", id: 3, file: ddFile(snowy.text), pic: snowyPic, picW: 800, picH: 480, levelKey: "nope" })).m;
    expect(b).toEqual({ t: "error", id: 3, message: "That level isn't in this map." });
  });

  it("compiles, previews and compares, posting progress first and transferring what it sends", async () => {
    const posts = await run({ t: "prepare", id: 4, file: ddFile(snowy.text), pic: snowyPic, picW: 800, picH: 480, compare: true });
    const lines = posts.filter((p) => p.m.t === "progress").map((p) => (p.m as { text: string }).text);
    expect(lines[0]).toBe("Reading the project file…");
    expect(lines).toContain("Finding which level the picture shows…");
    expect(lines).toContain("Checking that the map lines up with the picture…");
    expect(lines.at(-1)).toBe("Making the comparison…");
    const { m, transfer } = answer(posts);
    if (m.t !== "prepared") throw new Error(JSON.stringify(m));
    expect(posts.at(-1)!.m).toBe(m);

    expect(m.report.level).toBe(snowy.levelKey);
    expect(m.report.levels.map((l) => l.why)).toEqual(["only"]);
    expect(m.report.hold).toBeNull();
    expect(m.report.drawn).toBe("winter");
    // The grid from the picture's full size, though it was measured at 32 px a square.
    expect(m.report.gridPxPerSquare).toBe(40);
    const sc = decodeSidecar(m.sidecar);
    expect(sc.meta.rect).toEqual([0, 0, 20 * 256, 12 * 256]);
    expect(m.report.shifted).toBeUndefined();
    expect(sc.objects.n).toBe(m.report.objects);

    expect([m.pw, m.ph]).toEqual([DD_PREVIEW_SIZE, 307]);
    expect(m.preview.length).toBe(m.pw * m.ph * 4);
    const c = m.compare!;
    expect([c.w, c.h]).toEqual([m.pw, m.ph]);
    expect(c.exact).not.toBe(c.guessed);
    let differ = 0;
    for (let i = 0; i < c.exact.length; i += 4) if (Math.abs(c.exact[i] - c.guessed[i]) > 8) differ++;
    expect(differ).toBeGreaterThan(100);
    expect(m.report.warnings).not.toContain(DD_TEXT.noExact);

    // Everything big goes as a transfer, each buffer once and whole.
    const bufs = [m.sidecar.buffer, m.preview.buffer, c.exact.buffer, c.guessed.buffer];
    for (const b of bufs) expect(transfer).toContain(b);
    expect(transfer!.length).toBe(4);
    expect(m.sidecar.byteLength).toBe(m.sidecar.buffer.byteLength);
  });

  it("measures at no more than 32 px a square, whatever size the picture comes", async () => {
    const seen: PictureSample[] = [];
    vi.doMock("../src/client/dd/extract", async (orig) => {
      const m = await orig<typeof import("../src/client/dd/extract")>();
      return {
        ...m,
        extractSidecar: (...a: Parameters<typeof m.extractSidecar>) => {
          seen.push(a[3]);
          return m.extractSidecar(...a);
        },
      };
    });
    vi.resetModules();
    try {
      const W2 = await import("../src/client/dd/ddWorker");
      await W2.handleDdMessage({ t: "prepare", id: 1, file: ddFile(snowy.text), pic: snowyPic, picW: 800, picH: 480 }, () => {});
    } finally {
      vi.doUnmock("../src/client/dd/extract");
      vi.resetModules();
    }
    expect(seen.map((p) => [p.w, p.h])).toEqual([[640, 384]]);
  });

  it("a green map's Compare is the guess on both sides (what every device bakes in v1)", async () => {
    const g = snowyMap({ green: true });
    const pic = fakeExportFromMap(parseDungeondraftMap(g.text), g.levelKey, 24);
    const { m, transfer } = answer(await run({ t: "prepare", id: 5, file: ddFile(g.text), pic, picW: pic.w, picH: pic.h, compare: true }));
    if (m.t !== "prepared") throw new Error(JSON.stringify(m));
    expect(m.report.drawn).toBe("green");
    expect(m.compare!.exact).toBe(m.compare!.guessed);
    expect(transfer!.length).toBe(3);
    // Its own note (6.1) comes from report.drawn; the "couldn't be worked out" one is for snowy maps.
    expect(m.report.warnings).not.toContain(DD_TEXT.noExact);
  });

  it("reads a part of the map from the scene's mapRect as from its .dd2vtt, and refuses it without either (2.1 step 5)", async () => {
    // Squares 2-17 across and 1-10 down of the snowy map, at 40 px a square.
    const crop = cropSquares(snowyPic, 40, [2, 1, 16, 10]);
    const vtt: VttMeta = {
      resolution: { map_origin: { x: 2, y: 1 }, map_size: { x: 16, y: 10 }, pixels_per_grid: 40 },
      portals: [], lights: [], line_of_sight: [],
    };
    const base = { t: "prepare" as const, id: 10, file: ddFile(snowy.text), pic: crop, picW: 640, picH: 400 };
    const a = answer(await run({ ...base, mapRect: [2, 1, 16, 10] })).m;
    const b = answer(await run({ ...base, vtt })).m;
    if (a.t !== "prepared" || b.t !== "prepared") throw new Error(JSON.stringify([a, b]));
    const rect = [2 * 256, 1 * 256, 18 * 256, 11 * 256];
    expect(decodeSidecar(a.sidecar).meta.rect).toEqual(rect);
    expect(decodeSidecar(b.sidecar).meta.rect).toEqual(rect);
    expect(a.report.fit.verdict).not.toBe("no");
    expect([a.report.fit.verdict, a.report.objects, a.report.gridPxPerSquare]).toEqual([b.report.fit.verdict, b.report.objects, 40]);
    expect(answer(await run(base)).m).toEqual({
      t: "error", id: 10,
      message: "This picture is 640×400 but the map is 20×12 squares, so it isn't an export of the whole map. If you exported part of it, choose its .dd2vtt export too.",
    });
  });

  it("applies the GM's whole-square shift (Line it up that way): the data's rectangle moves by it", async () => {
    const m = answer(await run({ t: "prepare", id: 11, file: ddFile(snowy.text), pic: snowyPic, picW: 800, picH: 480, shift: [1, 0] })).m;
    if (m.t !== "prepared") throw new Error(JSON.stringify(m));
    expect(m.report.shifted).toEqual([1, 0]);
    expect(decodeSidecar(m.sidecar).meta.rect).toEqual([-256, 0, 19 * 256, 12 * 256]);
  });

  it("says so when exact seasons can't be worked out for a snowy map, and compares the guess with itself", async () => {
    vi.doMock("../src/client/room/seasonExact", async (orig) => ({
      ...(await orig<typeof import("../src/client/room/seasonExact")>()),
      analyseExact: () => {
        throw new Error("exact seasons: the rasteriser can't draw this");
      },
    }));
    vi.resetModules();
    const answers: Posted[] = [];
    try {
      const W2 = await import("../src/client/dd/ddWorker");
      const m = { t: "prepare" as const, id: 12, file: ddFile(snowy.text), pic: snowyPic, picW: 800, picH: 480, compare: true };
      for (let i = 0; i < 2; i++) {
        const posts: Posted[] = [];
        await W2.handleDdMessage(m, (o, transfer) => posts.push({ m: o, transfer }));
        answers.push(answer(posts));
      }
    } finally {
      vi.doUnmock("../src/client/room/seasonExact");
      vi.resetModules();
    }
    // Asked again (kept from the first time), the note is there once, not twice.
    for (const { m, transfer } of answers) {
      if (m.t !== "prepared") throw new Error(JSON.stringify(m));
      expect(m.report.drawn).toBe("winter");
      expect(m.report.warnings.filter((w) => w === DD_TEXT.noExact)).toEqual([DD_TEXT.noExact]);
      expect(m.compare!.exact).toBe(m.compare!.guessed);
      expect(transfer!.length).toBe(3);
    }
  });

  it("keeps the last answer: turning Compare on doesn't read the map again; any other change does", async () => {
    const file = new File([snowy.text], "map.dungeondraft_map", { lastModified: 1 });
    const base = { t: "prepare" as const, id: 13, file, pic: snowyPic, picW: 800, picH: 480 };
    const lines = (posts: Posted[]) => posts.filter((p) => p.m.t === "progress").map((p) => (p.m as { text: string }).text);
    const prepared = (posts: Posted[]) => {
      const m = answer(posts).m;
      if (m.t !== "prepared") throw new Error(JSON.stringify(m));
      return m;
    };
    const one = await runPosted(base);
    expect(lines(one)[0]).toBe("Reading the project file…");
    // Compare on: only the comparison is made.
    const two = await runPosted({ ...base, compare: true });
    expect(lines(two)).toEqual(["Making the comparison…"]);
    const a = prepared(one), b = prepared(two);
    expect(sameBytes(a.sidecar, b.sidecar) && sameBytes(a.preview, b.preview)).toBe(true);
    expect(b.report).toEqual(a.report);
    // Again: nothing is made, and what was sent before (transferred, so emptied here) is sent whole.
    const three = await runPosted({ ...base, compare: true });
    expect(lines(three)).toEqual([]);
    const c = prepared(three);
    expect(c.sidecar.length).toBe(a.sidecar.length);
    expect(sameBytes(c.compare!.exact, b.compare!.exact) && sameBytes(c.compare!.guessed, b.compare!.guessed)).toBe(true);
    const fresh = compareBakes(decodeSidecar(c.sidecar), atMostPerSquare(snowyPic, 20, DD_MAX_PX_PER_SQUARE), 800, 480);
    expect(sameBytes(c.compare!.guessed, fresh.guessed) && sameBytes(c.compare!.exact, fresh.exact)).toBe(true);
    // Compare off again: no pair.
    expect(prepared(await runPosted(base)).compare).toBeUndefined();

    const touched = snowyPic.rgba.slice();
    touched[4 * 1000] ^= 1;
    // The same name, date and size, but not the same map.
    const other = snowy.text.slice(0, -2) + " " + snowy.text.slice(-1);
    expect(other.length).toBe(snowy.text.length);
    for (const changed of [
      { ...base, shift: [0, 1] as [number, number] },
      { ...base, levelKey: snowy.levelKey },
      { ...base, mapRect: [0, 0, 20, 12] as [number, number, number, number] },
      { ...base, picW: 801 },
      { ...base, pic: { ...snowyPic, rgba: touched } },
      { ...base, file: new File([other], "map.dungeondraft_map", { lastModified: 1 }) },
      { ...base, file: new File([snowy.text], "map.dungeondraft_map", { lastModified: 2 }) },
      { ...base, file: new File([snowy.text], "other.dungeondraft_map", { lastModified: 1 }) },
    ]) {
      expect(lines(await runPosted(changed))[0]).toBe("Reading the project file…");
    }
    // A refusal keeps nothing.
    expect(prepared(await runPosted(base)).report.level).toBe(snowy.levelKey);
    expect(answer(await runPosted({ ...base, file: ddFile("{ not json") })).m.t).toBe("error");
    expect(lines(await runPosted(base))[0]).toBe("Reading the project file…");
  });

  it("an unclear level goes on hold unless the GM picked it; a .dd2vtt picks it clearly", async () => {
    const tw = twinLevels();
    const pic = fakeExportFromMap(parseDungeondraftMap(tw.text), tw.keys[0], 24);
    const base = { t: "prepare" as const, id: 6, file: ddFile(tw.text), pic, picW: pic.w, picH: pic.h };
    const a = answer(await run(base)).m;
    if (a.t !== "prepared") throw new Error(JSON.stringify(a));
    expect(a.report.hold).toBe("level");
    expect(a.compare).toBeUndefined();
    const b = answer(await run({ ...base, levelKey: tw.keys[1] })).m;
    if (b.t !== "prepared") throw new Error(JSON.stringify(b));
    expect(b.report.level).toBe(tw.keys[1]);
    expect(b.report.hold).not.toBe("level");

    const pl = pelcsLike();
    const ground = fakeExportFromMap(parseDungeondraftMap(pl.text), pl.groundKey, 24);
    const c = answer(await run({ t: "prepare", id: 8, file: ddFile(pl.text), pic: ground, picW: 1024, picH: 768, vtt: pl.vtt })).m;
    if (c.t !== "prepared") throw new Error(JSON.stringify(c));
    expect([c.report.level, c.report.levels[0].why, c.report.hold]).toEqual([pl.groundKey, "vtt", null]);
    expect(c.report.gridPxPerSquare).toBe(64);
  });

  it.skipIf(!haveVernExport("waterfall.vtt"))("waterfall on Vern's 1.2 export, with Compare (6.4: timed)", async () => {
    const full = vernPicture("waterfall.vtt");
    const pic = atPxPerSquare(full, 50, 35, 32);
    const text = waterfallText();
    const go = async (lastModified: number, compare: boolean) => {
      const t0 = performance.now();
      const file = new File([text], "waterfall.dungeondraft_map", { lastModified });
      const m = answer(await run({ t: "prepare", id: 9, file, pic: { ...pic, rgba: pic.rgba.slice() }, picW: full.w, picH: full.h, vtt: full.vtt, compare })).m;
      if (m.t !== "prepared") throw new Error(JSON.stringify(m));
      return { m, ms: performance.now() - t0 };
    };
    const cold = await go(1, true);
    // Warm: the dialog's preview, then Compare turned on (the comparison only), then on again (nothing new).
    const prep = await go(2, false), cmp = await go(2, true), again = await go(2, true);
    const m = cmp.m;
    expect(m.report.level).toBe("0");
    expect(m.report.hold).toBeNull();
    expect(m.report.fit.verdict).not.toBe("no");
    expect(m.report.objects).toBe(71);
    expect(m.report.dropped).toBe(0);
    expect(m.compare!.exact).not.toBe(m.compare!.guessed);
    expect(prep.m.compare).toBeUndefined();
    console.log(`waterfall at 32 px a square: prepare + compare cold ${cold.ms.toFixed(0)} ms; warm prepare ${prep.ms.toFixed(0)} ms, then Compare ${cmp.ms.toFixed(0)} ms, then again ${again.ms.toFixed(0)} ms`);
    // On Par's desktop in Node: prepare 0.5-0.7 s warm; Compare at the board's analysis size
    // (1000 x 700) 0.9-1.2 s warm, 1.5 s cold, against 6.4's "about 150 ms" (reported); asked
    // again, 14-16 ms (copies, and the key: hashing the picture).
    expect(prep.ms).toBeLessThan(perf ? 1500 : 20_000);
    expect(cmp.ms).toBeLessThan(perf ? 2500 : 20_000);
    expect(again.ms).toBeLessThan(perf ? 100 : 5_000);
  }, 60_000);
});

describe("the dd worker: check", () => {
  const pic32 = fakeExportFromMap(snowyParsed, snowy.levelKey, 32);
  const bytes = encodeSidecar(snowy.sidecar);

  it("fits the sidecar's objects against the picture, as sidecarFit does", async () => {
    const { m } = answer(await run({ t: "check", id: 1, sidecar: bytes, pic: pic32, picW: 640, picH: 384 }));
    expect(m).toEqual({ t: "checked", id: 1, fit: sidecarFit(decodeSidecar(bytes), pic32) });
    if (m.t !== "checked" || "error" in m.fit) throw new Error("no fit");
    expect(m.fit.verdict).toBe("yes");
    // Bigger pictures are fitted at 32 px a square: the same answer.
    const { m: m2 } = answer(await run({ t: "check", id: 2, sidecar: bytes, pic: snowyPic, picW: 800, picH: 480 }));
    expect(m2.t === "checked" && !("error" in m2.fit) && m2.fit.verdict).toBe("yes");
  });

  it("refuses damaged data, and a picture of another shape (within 1% or 2 px is the same)", async () => {
    const bad = bytes.slice();
    bad[40] ^= 0xff;
    expect(answer(await run({ t: "check", id: 3, sidecar: bad, pic: pic32, picW: 640, picH: 384 })).m)
      .toEqual({ t: "checked", id: 3, fit: { error: DD_TEXT.unreadable } });
    expect(answer(await run({ t: "check", id: 4, sidecar: bytes, pic: pic32, picW: 640, picH: 640 })).m).toEqual({
      t: "checked", id: 4,
      fit: { error: "This picture is 640×640, which isn't the shape of the map this data was made for (20×12 squares), so it can't be used with it." },
    });
    for (const [w, h, ok] of [[640, 386, true], [6000, 3630, true], [100, 61, true], [100, 64, false], [62, 100, false]] as const) {
      const { m } = answer(await run({ t: "check", id: 5, sidecar: bytes, pic: pic32, picW: w, picH: h }));
      expect(m.t === "checked" && "error" in m.fit, `${w}x${h}`).toBe(!ok);
    }
  });
});

describe("the dd worker: pictures and Compare", () => {
  it("resamples by area, colours weighted by alpha, alpha kept (as the canvas draws it)", () => {
    const w = 37, h = 23;
    const rgba = new Uint8ClampedArray(w * h * 4);
    let s = 7;
    for (let i = 0; i < rgba.length; i++) rgba[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) % 256;
    for (let i = 3; i < rgba.length; i += 16) rgba[i] = 0;
    const pic = { rgba, w, h };
    const a = resample(pic, 11, 7), b = downsample(pic, 11, 7).rgba;
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBeLessThanOrEqual(1);
    expect(resample(pic, w, h)).toEqual(rgba);
    expect(resample(pic, w, h)).not.toBe(rgba);
    // Up is allowed too (the preview of a small picture), and stays in range.
    expect(resample(pic, 80, 50).length).toBe(80 * 50 * 4);
  });

  it("shrinks only pictures over 32 px a square", () => {
    const pic = { rgba: new Uint8ClampedArray(800 * 480 * 4), w: 800, h: 480 };
    expect(DD_MAX_PX_PER_SQUARE).toBe(32);
    const s = atMostPerSquare(pic, 20, 32);
    expect([s.w, s.h]).toEqual([640, 384]);
    expect(atMostPerSquare(pic, 25, 32)).toBe(pic);
    expect(atMostPerSquare(pic, 0, 32)).toBe(pic);
  });

  it("Compare bakes Summer, level 2 at the preview size; an exact analysis that refuses gives the guess and why", () => {
    expect(COMPARE_LOOK).toEqual({ look: "summer", level: 2, seed: 1 });
    const c = compareBakes(snowy.sidecar, snowyPic, 800, 480);
    expect([c.w, c.h, c.reason]).toEqual([512, 307, undefined]);
    expect(c.exact.length).toBe(512 * 307 * 4);
    // As the board makes it (seasons.ts): an 800 x 480 scene at 40 px a square is analysed at
    // 512 x 307 (20 px a square, at least 512 across), then baked at the preview's size.
    const guess = resample(snowyPic, 512, 307);
    bake(guess, 512, 307, {
      x0: 0, y0: 0, scale: 800 / 512, cell: 40, seed: 1, look: "summer", level: 2, sceneW: 800, sceneH: 480,
      a: analyse(resample(snowyPic, 512, 307), 512, 307, 25.6),
    });
    expect(sameBytes(c.guessed, guess)).toBe(true);
    // The board's square: the scene's grid, kept within long/160 to long/8 (seasonSquare), and its
    // analysis size (analysisGeometry). Without the grid, the data's square (a new scene's grid).
    expect(sameBytes(compareBakes(snowy.sidecar, snowyPic, 800, 480, { grid: 40 }).guessed, c.guessed)).toBe(true);
    const withSquare = (square: number) => {
      const g = analysisGeometry(800, 480, square);
      const out = resample(snowyPic, 512, 307);
      bake(out, 512, 307, {
        x0: 0, y0: 0, scale: 800 / 512, cell: square, seed: 1, look: "summer", level: 2, sceneW: 800, sceneH: 480,
        a: analyse(resample(snowyPic, g.aw, g.ah), g.aw, g.ah, g.cellA),
      });
      return out;
    };
    const at = (grid: number) => withSquare(seasonSquare(800, 480, grid));
    const g50 = compareBakes(snowy.sidecar, snowyPic, 800, 480, { grid: 50 }).guessed;
    expect(sameBytes(g50, at(50))).toBe(true);
    expect(sameBytes(g50, c.guessed)).toBe(false);
    // Too big a grid is kept to 100 (800 / 8), as on the board, whether the scene's or the data's
    // (a map 4 squares across in an 800 px picture).
    const g100 = at(100);
    expect(sameBytes(g100, withSquare(200))).toBe(false);
    expect(sameBytes(compareBakes(snowy.sidecar, snowyPic, 800, 480, { grid: 200 }).guessed, g100)).toBe(true);
    const narrow = { ...snowy.sidecar, meta: { ...snowy.sidecar.meta, rect: [0, 0, 4 * 256, 12 * 256] as [number, number, number, number] } };
    expect(sameBytes(compareBakes(narrow, snowyPic, 800, 480).guessed, g100)).toBe(true);
    // A grid that isn't one is the data's.
    expect(sameBytes(compareBakes(snowy.sidecar, snowyPic, 800, 480, { grid: 0 }).guessed, c.guessed)).toBe(true);

    const green = compareBakes(snowy.sidecar, snowyPic, 800, 480, { drawn: "green" });
    expect(green.exact).toBe(green.guessed);
    expect(green.reason).toMatch(/exact seasons/);
    expect(sameBytes(green.guessed, c.guessed)).toBe(true);
  });
});

// ---------------------------------------------------------------- the main thread (attach.ts)

/** Pictures by object URL, for the fake image. */
const blobs = new Map<string, Blob>();
const pixels = new WeakMap<Blob, PictureSample>();
let urlCount = 0;

class FakeImage {
  src = "";
  naturalWidth = 0;
  naturalHeight = 0;
  async decode(): Promise<void> {
    const b = blobs.get(this.src);
    const p = b && pixels.get(b);
    if (!p) throw new Error("EncodingError");
    this.naturalWidth = p.w;
    this.naturalHeight = p.h;
  }
}

interface FakeCanvas { width: number; height: number; drawn: [number, number] | null; getContext(t: string, o?: object): unknown }
let canvases: FakeCanvas[] = [];

function fakeCanvas(): FakeCanvas {
  let img: FakeImage | null = null;
  const c: FakeCanvas = {
    width: 300, height: 150, drawn: null,
    getContext: () => ({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      clearRect() {},
      drawImage(i: FakeImage, _sx: number, _sy: number, _sw: number, _sh: number, _dx: number, _dy: number, dw: number, dh: number) {
        img = i;
        c.drawn = [dw, dh];
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: resample(pixels.get(blobs.get(img!.src)!)!, w, h) }),
    }),
  };
  canvases.push(c);
  return c;
}

/** A picture file the fake image can decode. */
function pictureBlob(p: PictureSample): Blob {
  const b = new Blob(["picture"], { type: "image/png" });
  pixels.set(b, p);
  return b;
}

/** A flat picture of w x h. */
const flat = (w: number, h: number): PictureSample => ({ rgba: new Uint8ClampedArray(w * h * 4).fill(200), w, h });

/** A worker that runs ddWorker's handler here. */
class FakeWorker {
  static all: FakeWorker[] = [];
  /** ok: answers; loadError: fails before saying anything; crash: fails after its progress lines; hang: never answers; reply: answers an error at once. */
  static mode: "ok" | "loadError" | "crash" | "hang" | "reply" = "ok";
  onmessage: ((e: { data: DdWorkerOut }) => void) | null = null;
  onerror: ((e: { preventDefault(): void }) => void) | null = null;
  terminated = false;
  posted: Array<{ m: DdWorkerIn; transfer: Transferable[] }> = [];
  readonly mode = FakeWorker.mode;

  constructor(readonly url: URL, readonly opts: WorkerOptions) {
    FakeWorker.all.push(this);
  }

  postMessage(m: DdWorkerIn, transfer: Transferable[]): void {
    this.posted.push({ m, transfer });
    const fail = () => this.onerror?.({ preventDefault() {} });
    if (this.mode === "hang") return;
    if (this.mode === "reply") {
      queueMicrotask(() => this.onmessage?.({ data: { t: "error", id: m.id, message: "no" } }));
      return;
    }
    setTimeout(() => {
      if (this.terminated) return;
      if (this.mode === "loadError") return fail();
      void handleDdMessage(m, (o) => {
        if (this.terminated) return;
        if (this.mode === "crash" && o.t !== "progress") return fail();
        this.onmessage?.({ data: o });
      });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

let A: typeof AttachModule;

beforeEach(async () => {
  FakeWorker.all = [];
  FakeWorker.mode = "ok";
  canvases = [];
  blobs.clear();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("document", { createElement: fakeCanvas });
  vi.stubGlobal("navigator", { deviceMemory: 8 });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {
        if (data.length !== width * height * 4) throw new Error("bad ImageData");
      }
    },
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    const u = `blob:test/${++urlCount}`;
    blobs.set(u, b as Blob);
    return u;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => void blobs.delete(u));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // A fresh module each time: the worker it keeps is module state.
  vi.resetModules();
  A = await import("../src/client/dd/attach");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prepareAttach", () => {
  it("decodes the picture, hands the file and the pixels to the worker, and returns pictures", async () => {
    const pl = pelcsLike();
    const big = fakeExportFromMap(parseDungeondraftMap(pl.text), pl.groundKey, 64); // 1024 x 768
    const lines: string[] = [];
    const file = ddFile(pl.text, "pelcs.dungeondraft_map");
    const r = await A.prepareAttach(file, pictureBlob(big), { width: 1024, height: 768 },
      { vtt: pl.vtt, compare: true, onProgress: (s) => lines.push(s) });
    // Decoded at 32 px a square straight away (the .dd2vtt says 16 squares across).
    expect(canvases[0].drawn).toEqual([512, 384]);
    expect(canvases[0].width).toBe(0); // given back
    expect(blobs.size).toBe(0); // URL revoked
    const w = FakeWorker.all[0];
    expect(FakeWorker.all.length).toBe(1);
    expect(w.url.href).toMatch(/ddWorker\.ts$/);
    expect(w.opts).toEqual({ type: "module" });
    const sent = w.posted[0];
    expect(sent.m.t).toBe("prepare");
    if (sent.m.t !== "prepare") return;
    expect(sent.m.file).toBe(file);
    expect([sent.m.picW, sent.m.picH, sent.m.pic.w, sent.m.pic.h]).toEqual([1024, 768, 512, 384]);
    expect(sent.transfer).toEqual([sent.m.pic.rgba.buffer]);

    expect(lines[0]).toBe("Reading the picture…");
    expect(lines[1]).toBe("Reading the project file…");
    expect(r.report.level).toBe(pl.groundKey);
    expect(decodeSidecar(r.sidecar).meta.squares).toEqual([16, 12]);
    expect([r.preview.width, r.preview.height]).toEqual([512, 384]);
    expect([r.compare!.exact.width, r.compare!.guessed.height]).toEqual([512, 384]);

    // The worker stays for the next attach.
    await A.prepareAttach(file, pictureBlob(big), { width: 1024, height: 768 }, { vtt: pl.vtt });
    expect(FakeWorker.all.length).toBe(1);
  });

  it("caps the picture at 4096 px on a desktop with memory, 2048 otherwise, and at 32 px a square from mapRect", async () => {
    FakeWorker.mode = "reply";
    const pic = pictureBlob(flat(5000, 2500));
    const sizes: unknown[] = [];
    const go = async (o: Parameters<typeof A.prepareAttach>[3] = {}) => {
      await expect(A.prepareAttach(ddFile("{}"), pic, { width: 5000, height: 2500 }, o)).rejects.toThrow("no");
      const p = FakeWorker.all.at(-1)!.posted.at(-1)!.m;
      sizes.push(p.t === "prepare" && [p.pic.w, p.pic.h]);
    };
    await go();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await go();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("navigator", {});
    await go();
    await go({ mapRect: [0, 0, 50, 25] });
    expect(sizes).toEqual([[4096, 2048], [2048, 1024], [2048, 1024], [1600, 800]]);
  });

  it("refuses a file over 60 MiB before decoding anything or starting the worker", async () => {
    const big = { size: A.ATTACH_MAX_FILE_BYTES + 1, name: "big.dungeondraft_map" } as File;
    await expect(A.prepareAttach(big, pictureBlob(flat(10, 10)), { width: 10, height: 10 }, {}))
      .rejects.toEqual(new A.AttachError(A.ATTACH_TEXT.tooBig));
    expect(FakeWorker.all.length).toBe(0);
    expect(canvases.length).toBe(0);
  });

  it("passes the worker's refusals on as AttachErrors, and says when the picture can't be read", async () => {
    const err = await A.prepareAttach(ddFile("[1,2", "x.dungeondraft_map"), pictureBlob(snowyPic), { width: 800, height: 480 }, {}).catch((e) => e);
    expect(err).toBeInstanceOf(A.AttachError);
    expect(err.message).toBe("x.dungeondraft_map isn't a Dungeondraft map, or it's damaged.");
    await expect(A.prepareAttach(ddFile(snowy.text), new Blob(["?"]), { width: 800, height: 480 }, {}))
      .rejects.toThrow(A.ATTACH_TEXT.picture);
  });

  it("says the browser can't do it when the worker can't start, and that it stopped when it fails later; then starts afresh", async () => {
    const go = () => A.prepareAttach(ddFile(snowy.text), pictureBlob(snowyPic), { width: 800, height: 480 }, {});
    FakeWorker.mode = "loadError";
    await expect(go()).rejects.toThrow(A.ATTACH_TEXT.noWorker);
    expect(FakeWorker.all[0].terminated).toBe(true);
    FakeWorker.mode = "crash";
    await expect(go()).rejects.toThrow(A.ATTACH_TEXT.stopped);
    FakeWorker.mode = "ok";
    await expect(go()).resolves.toMatchObject({ report: { level: snowy.levelKey } });
    expect(FakeWorker.all.length).toBe(3);
    vi.stubGlobal("Worker", undefined);
    vi.resetModules();
    const B = await import("../src/client/dd/attach");
    await expect(B.prepareAttach(ddFile(snowy.text), pictureBlob(snowyPic), { width: 800, height: 480 }, {}))
      .rejects.toThrow(B.ATTACH_TEXT.noWorker);
  });

  it("can be cancelled: the worker is stopped when nothing else waits on it", async () => {
    FakeWorker.mode = "hang";
    const pic = pictureBlob(snowyPic);
    const one = new AbortController(), two = new AbortController();
    const p1 = A.prepareAttach(ddFile(snowy.text), pic, { width: 800, height: 480 }, { signal: one.signal });
    const p2 = A.prepareAttach(ddFile(snowy.text), pic, { width: 800, height: 480 }, { signal: two.signal });
    await vi.waitFor(() => expect(FakeWorker.all[0]?.posted.length).toBe(2));
    one.abort();
    await expect(p1).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.all[0].terminated).toBe(false);
    two.abort();
    await expect(p2).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.all[0].terminated).toBe(true);
    // Already cancelled: nothing starts.
    await expect(A.prepareAttach(ddFile(snowy.text), pic, { width: 800, height: 480 }, { signal: one.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.all.length).toBe(1);
  });

  it("stops the worker after a minute with nothing to do", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    FakeWorker.mode = "reply";
    const go = () => A.prepareAttach(ddFile("{}"), pictureBlob(flat(20, 12)), { width: 20, height: 12 }, {});
    await expect(go()).rejects.toThrow("no");
    const w = FakeWorker.all[0];
    vi.advanceTimersByTime(A.DD_WORKER_IDLE_MS - 1);
    expect(w.terminated).toBe(false);
    // Busy again: the minute starts over when it's done.
    await expect(go()).rejects.toThrow("no");
    vi.advanceTimersByTime(A.DD_WORKER_IDLE_MS - 1);
    expect(w.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(w.terminated).toBe(true);
    await expect(go()).rejects.toThrow("no");
    expect(FakeWorker.all.length).toBe(2);
  });

  it("keeps its texts and limits the same as the worker's", () => {
    expect(A.ATTACH_MAX_FILE_BYTES).toBe(DD_MAX_FILE_BYTES);
    for (const k of ["tooBig", "unreadable", "failed"] as const) expect(A.ATTACH_TEXT[k]).toBe(DD_TEXT[k]);
  });
});

describe("checkAttached", () => {
  const pic32 = fakeExportFromMap(snowyParsed, snowy.levelKey, 32);
  const bytes = encodeSidecar(snowy.sidecar);
  const serve = (body: Blob | null, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

  it("fetches and unpacks the sidecar, and fits it against the picture in the worker", async () => {
    const { blob } = await packPng(bytes);
    serve(blob);
    const fit = await A.checkAttached("/api/files/room/side1", pictureBlob(pic32), { width: 640, height: 384 });
    expect(fit).toEqual(sidecarFit(decodeSidecar(bytes), pic32));
    expect(fetch).toHaveBeenCalledWith("/api/files/room/side1", { credentials: "same-origin" });
    const sent = FakeWorker.all[0].posted[0];
    if (sent.m.t !== "check") throw new Error("not a check");
    // The box's padding left behind, and both buffers transferred.
    expect(sent.m.sidecar).toEqual(bytes);
    expect(sent.transfer).toEqual([sent.m.sidecar.buffer, sent.m.pic.rgba.buffer]);
  });

  it("decodes the picture at no more than 32 px a square, from the squares across in the data's META", async () => {
    serve((await packPng(bytes)).blob);
    // 800 x 480 for 20 squares across: drawn at 640 x 384 on the main thread, not at 2048 or 4096.
    const fit = await A.checkAttached("u", pictureBlob(snowyPic), { width: 800, height: 480 });
    expect(canvases[0].drawn).toEqual([640, 384]);
    const sent = FakeWorker.all[0].posted[0].m;
    if (sent.t !== "check") throw new Error("not a check");
    expect([sent.pic.w, sent.pic.h, sent.picW, sent.picH]).toEqual([640, 384, 800, 480]);
    expect(fit).toEqual(sidecarFit(decodeSidecar(bytes), { rgba: resample(snowyPic, 640, 384), w: 640, h: 384 }));
    // A sidecar whose META can't be read cheaply is decoded at the cap, and refused by the worker.
    const bad = bytes.slice();
    bad[SIDECAR_HEADER_BYTES + 5] ^= 0xff;
    serve((await packPng(bad)).blob);
    expect(await A.checkAttached("u", pictureBlob(snowyPic), { width: 800, height: 480 })).toEqual({ error: A.ATTACH_TEXT.unreadable });
    expect(canvases[1].drawn).toEqual([800, 480]);
  });

  it("reads the squares across from META as decodeSidecar does, or nothing", () => {
    const r = decodeSidecar(bytes).meta.rect;
    expect(A.metaSquaresW(bytes)).toBe((r[2] - r[0]) / 256);
    const crop = { ...snowy.sidecar, meta: { ...snowy.sidecar.meta, rect: [512, 0, 512 + 7.5 * 256, 12 * 256] as [number, number, number, number] } };
    expect(A.metaSquaresW(encodeSidecar(crop))).toBe(7.5);
    const padded = new Uint8Array(bytes.length + 3000);
    padded.set(bytes);
    expect(A.metaSquaresW(padded)).toBe(20);
    expect(A.metaSquaresW(bytes.subarray(0, 30))).toBeUndefined();
    expect(A.metaSquaresW(new Uint8Array(64))).toBeUndefined();
    const notJson = bytes.slice();
    notJson[SIDECAR_HEADER_BYTES + 5] = 0x7b;
    notJson[SIDECAR_HEADER_BYTES + 6] = 0x7b;
    expect(A.metaSquaresW(notJson)).toBeUndefined();
  });

  it("explains each way it can fail, never throwing", async () => {
    const pic = pictureBlob(pic32), size = { width: 640, height: 384 };
    serve(null, 404);
    expect(await A.checkAttached("u", pic, size)).toEqual({ error: A.ATTACH_TEXT.noLoad });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await A.checkAttached("u", pic, size)).toEqual({ error: A.ATTACH_TEXT.noLoad });
    serve(new Blob(["not a png"]));
    expect(await A.checkAttached("u", pic, size)).toEqual({ error: A.ATTACH_TEXT.unreadable });
    const newer = bytes.slice();
    newer[4] = 2;
    serve((await packPng(newer)).blob);
    expect(await A.checkAttached("u", pic, size)).toEqual({ error: A.ATTACH_TEXT.newer });
    serve((await packPng(bytes)).blob);
    expect(await A.checkAttached("u", pic, { width: 640, height: 640 })).toEqual({
      error: "This picture is 640×640, which isn't the shape of the map this data was made for (20×12 squares), so it can't be used with it.",
    });
    expect(await A.checkAttached("u", new Blob(["?"]), size)).toEqual({ error: A.ATTACH_TEXT.picture });
    FakeWorker.mode = "loadError";
    vi.resetModules();
    const B = await import("../src/client/dd/attach");
    expect(await B.checkAttached("u", pic, size)).toEqual({ error: B.ATTACH_TEXT.noWorker });
    vi.stubGlobal("DecompressionStream", undefined);
    expect(await A.checkAttached("u", pic, size)).toEqual({ error: A.ATTACH_TEXT.noUnpack });
  });
});

// ---------------------------------------------------------------- uploads and the clean-up

function gmRoom(scenes: Scene[], assets: Asset[]): RoomClient {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  room.store.set({
    status: "open",
    me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
    room: { id: "AbCdEf123456", name: "Room", createdAt: 1 } as RoomClient["state"]["room"],
    scenes: Object.fromEntries(scenes.map((s) => [s.id, s])),
    assets: Object.fromEntries(assets.map((a) => [a.id, a])),
  });
  return room;
}

function scene(id: string, extra: Partial<Scene> = {}): Scene {
  return {
    id, name: id, order: 0, mapAssetId: "map1", width: 3600, height: 2520, background: "#000000",
    grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 5, ...extra,
  };
}

const HOUR = 60 * 60 * 1000;
function asset(id: string, kind: Asset["kind"] = "mapdata", age = 2 * HOUR): Asset {
  return { id, name: id, kind, width: 512, height: 3, mime: "image/png", bytes: 100, owner: "@gm", createdAt: Date.now() - age };
}

const sentActions = (room: RoomClient) =>
  (room as unknown as { unacked: { action: { t: string; id?: string } }[] }).unacked.map((u) => u.action);

describe("uploadSidecar", () => {
  it("packs the sidecar in its PNG box and uploads it as mapdata, then knows the asset at once", async () => {
    const bytes = encodeSidecar(snowy.sidecar);
    const room = gmRoom([], []);
    const made = asset("side9", "mapdata", 0);
    let req: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      req = { url, init };
      return new Response(JSON.stringify(made), { status: 201 });
    }));
    const a = await A.uploadSidecar(room, bytes, "waterfall · Ground");
    expect(a).toEqual(made);
    expect(room.state.assets.side9).toEqual(made);
    const { url, init } = req!;
    const q = new URL(url, "https://table.test").searchParams;
    expect(url).toMatch(/^\/api\/rooms\/AbCdEf123456\/assets\?/);
    expect([q.get("kind"), q.get("name"), q.get("w"), q.get("h")]).toEqual(["mapdata", "waterfall · Ground", "512", String(Math.ceil(bytes.length / 1536))]);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "image/png", "X-Tabletop-User": "gmuid" });
    const back = await unpackPng(init.body as Blob);
    expect(back.subarray(0, bytes.length)).toEqual(bytes);
  });

  it("passes the server's refusal on", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Dungeondraft data can only be uploaded as a PNG made by Tabletop." }), { status: 415 })));
    await expect(A.uploadSidecar(gmRoom([], []), encodeSidecar(snowy.sidecar), "x")).rejects.toThrow("only be uploaded as a PNG");
  });
});

describe("cleanUpSidecars", () => {
  const md = (assetId: string) => ({ assetId, forAssetId: "map1" });

  it("deletes only sidecars no scene uses, not touched this session and not just uploaded", async () => {
    const room = gmRoom(
      [scene("s1", { mapData: md("used") }), scene("s2", { mapData: { ...md("held"), hold: true } }), scene("s3")],
      [asset("used"), asset("held"), asset("old1"), asset("old2"), asset("touched"), asset("fresh", "mapdata", HOUR / 2), asset("map1", "map"), asset("tok", "token")],
    );
    expect(await A.cleanUpSidecars(room, new Set(["touched"]))).toBe(2);
    expect(Object.keys(room.state.assets).sort()).toEqual(["fresh", "held", "map1", "tok", "touched", "used"]);
    expect(sentActions(room)).toEqual([{ t: "asset.delete", id: "old1" }, { t: "asset.delete", id: "old2" }]);
    // Once it is no longer touched, it goes too.
    expect(await A.cleanUpSidecars(room, new Set())).toBe(1);
    expect(sentActions(room).at(-1)).toEqual({ t: "asset.delete", id: "touched" });
  });

  it("does nothing for a player, a table display, or while not connected", async () => {
    const assets = [asset("old1")];
    const player = gmRoom([], assets);
    player.store.set((s) => ({ me: { ...s.me!, role: "player" } }));
    expect(await A.cleanUpSidecars(player, new Set())).toBe(0);
    const away = gmRoom([], assets);
    away.store.set({ status: "reconnecting" });
    expect(await A.cleanUpSidecars(away, new Set())).toBe(0);
    const early = gmRoom([], assets);
    early.store.set({ room: null });
    expect(await A.cleanUpSidecars(early, new Set())).toBe(0);
    const display = new RoomClient("AbCdEf123456", { uid: "d", name: "D", color: "#ff0000" }, "key");
    display.store.set({ ...gmRoom([], assets).state });
    expect(await A.cleanUpSidecars(display, new Set())).toBe(0);
    expect(Object.keys(player.state.assets)).toEqual(["old1"]);
  });
});

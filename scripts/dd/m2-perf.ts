// M2, design 6.4: the performance numbers measured on the real maps (waterfall first, then the
// samples), several runs each, through the same functions the browser runs: parse; the object fit
// (rankLevels: every level's full search); extractSidecar (measure footprints, presence, compile)
// on the picture at most 32 px a square; encodeSidecar; packPng (deflate); the fetch through
// SidecarCache (unpackPng, format check, decodeSidecar); rasterSidecar + analyseExact at the
// board's analysis size and at 1024 px across; the pixel path's analyse() at the same size; the
// Compare bakes (2 x 512 px); and the bake of a whole scene at the export's size, exact against
// pixel, in ns a pixel. A fixed CPU loop is timed first and last, so a busy machine shows.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-perf.ts [pair ...] [--runs N]

import { parseDungeondraftMap } from "../../src/client/dd/parse";
import { chooseLevel, extractSidecar, pictureRect, rankLevels } from "../../src/client/dd/extract";
import { SPRITE_SIZES } from "../../src/client/dd/spriteSizes";
import { decodeSidecar, encodeSidecar } from "../../src/client/dd/sidecar";
import { packPng } from "../../src/client/dd/pngBox";
import { rasterSidecar } from "../../src/client/dd/raster";
import { analyseExact } from "../../src/client/room/seasonExact";
import { analyse, bake } from "../../src/client/room/seasonPixels";
import { SidecarCache } from "../../src/client/room/mapData";
import { compareBakes, resample } from "../../src/client/dd/ddWorker";
import { GREEN, OUT, SNOWY, atMost, fmt, havePair, loadFull, pair, sceneOf, writeText } from "./m2-lib";

const argv = process.argv.slice(2);
const runsAt = argv.indexOf("--runs");
const RUNS = runsAt >= 0 ? Number(argv[runsAt + 1]) : 3;
const want = argv.filter((a, i) => !a.startsWith("--") && (runsAt < 0 || i !== runsAt + 1));
const names = want.length ? want : [...SNOWY, ...GREEN];
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

/** A fixed amount of arithmetic (about 220 ms on the machine M2 ran on): the machine's speed right now. */
function baseline(): number {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 20_000_000; i++) x = (x * 1.000001 + i) % 1000003;
  return performance.now() - t0 + (x > 1e12 ? 1 : 0);
}
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `${fmt(s[0], 1)} / ${fmt(s[s.length >> 1], 1)} / ${fmt(s[s.length - 1], 1)}`; };
const timeN = async (n: number, f: () => unknown | Promise<unknown>): Promise<number[]> => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); await f(); out.push(performance.now() - t0); }
  return out;
};

say(`runs ${RUNS}; numbers are min / median / max in ms; baseline loop ${fmt(baseline(), 1)} ms (compare with the one at the end: a busy machine shows as a change)`);
say(`(Node ${process.version}; targets from design 6.4 in brackets)`);
for (const name of names) {
  const p = pair(name);
  if (!havePair(p)) { say(`\n== ${name}: files missing`); continue; }
  const f = await loadFull(p);
  const pic = atMost(f.full, f.sqW, 32);
  say(`\n== ${name}: ${f.sqW}x${f.sqH} squares, export ${f.full.w}x${f.full.h}, attach picture ${pic.w}x${pic.h}`);
  const parse = await timeN(RUNS, () => parseDungeondraftMap(f.mapText));
  say(`  parse the raw file: ${stats(parse)} [waterfall 25 ms, samples 1-8 ms]`);
  const map = parseDungeondraftMap(f.mapText);
  const rect = pictureRect(map, f.full.w, f.full.h, f.vtt);
  if ("error" in rect) { say(`  rect: ${rect.error}`); continue; }
  const fit = await timeN(RUNS, () => rankLevels(map, pic, rect, f.vtt));
  const ranks = rankLevels(map, pic, rect, f.vtt);
  say(`  object fit, full search, ${ranks.length} level(s): ${stats(fit)} [10-29 ms a map]`);
  const key = chooseLevel(ranks)?.key ?? ranks[0].key;
  const ext = await timeN(RUNS, () => extractSidecar(map, key, rect, pic, SPRITE_SIZES, { levels: ranks }));
  const ex = extractSidecar(map, key, rect, pic, SPRITE_SIZES, { levels: ranks });
  say(`  extractSidecar (fit again, measure ${ex.report.objects + ex.report.dropped} objects, presence, compile): ${stats(ext)} [measure under 300 ms at 32 px/sq for waterfall-sized maps]`);
  const enc = await timeN(RUNS, () => encodeSidecar(ex.sidecar));
  const bytes = encodeSidecar(ex.sidecar);
  const pack = await timeN(RUNS, () => packPng(bytes));
  const { blob } = await packPng(bytes);
  say(`  encodeSidecar ${bytes.length} B: ${stats(enc)}; packPng (deflate) to ${blob.size} B: ${stats(pack)} [encode + deflate under 50 ms]`);
  const g = globalThis as { fetch: typeof fetch };
  const realFetch = g.fetch;
  g.fetch = (async () => new Response(blob, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
  let fetchUnpack: number[];
  try {
    fetchUnpack = await timeN(RUNS, async () => { const c = new SidecarCache(() => {}); const r = await c.get("room", "asset"); if (!r.ok) throw new Error(r.state); decodeSidecar(r.bytes); });
  } finally { g.fetch = realFetch; }
  say(`  fetch (stubbed) + unpackPng + validate + decodeSidecar: ${stats(fetchUnpack)} [under 20 ms]`);
  const sc = decodeSidecar(bytes);
  const s = sceneOf(f.full, f.exportPps);
  const snowy = sc.meta.snowShare >= 0.5;
  const rasterA = await timeN(RUNS, () => rasterSidecar(sc, { w: s.aw, h: s.ah }));
  say(`  rasterSidecar at the analysis size ${s.aw}x${s.ah}: ${stats(rasterA)}`);
  if (snowy) {
    const exactA = await timeN(RUNS, () => analyseExact(s.small, s.aw, s.ah, s.cellA, sc, {}));
    say(`  rasterSidecar + analyseExact at ${s.aw}x${s.ah} (cellA ${fmt(s.cellA, 1)}): ${stats(exactA)} [under 80 ms warm at 1024 px]`);
    const w1 = 1024, h1 = Math.round((1024 * s.sceneH) / s.sceneW);
    const small1 = resample(f.full, w1, h1);
    const cell1 = (s.cellA * w1) / s.aw;
    const exact1 = await timeN(RUNS, () => analyseExact(small1, w1, h1, cell1, sc, {}));
    say(`  rasterSidecar + analyseExact at ${w1}x${h1} (cellA ${fmt(cell1, 1)}): ${stats(exact1)} [under 80 ms warm]`);
  } else say(`  analyseExact: refused (green map), the pixel path runs instead`);
  const pixelA = await timeN(RUNS, () => analyse(s.small, s.aw, s.ah, s.cellA));
  say(`  pixel analyse() at ${s.aw}x${s.ah}: ${stats(pixelA)} [snowAnalysis it replaces: 185-200 ms warm on Kdir]`);
  const cmp = await timeN(RUNS, () => compareBakes(sc, pic, f.full.w, f.full.h, {}));
  say(`  Compare bakes (analyse + analyseExact + 2 bakes at 512 px): ${stats(cmp)} [about 150 ms]`);
  // The whole scene's bake at the export's size, summer L2 and winter L2: exact against pixel, ns a pixel.
  const aPix = analyse(s.small, s.aw, s.ah, s.cellA);
  const aEx = snowy ? analyseExact(s.small, s.aw, s.ah, s.cellA, sc, {}) : null;
  const N = f.full.w * f.full.h;
  for (const [look, level] of [["summer", 2], ["winter", 2]] as const) {
    const run = (a: typeof aPix) => timeN(RUNS, () => { const out = f.full.rgba.slice(); bake(out, f.full.w, f.full.h, { x0: 0, y0: 0, scale: 1, cell: s.square, seed: 1, look, level, a, sceneW: s.sceneW, sceneH: s.sceneH }); });
    const tp = await run(aPix);
    const te = aEx ? await run(aEx) : null;
    const ns = (xs: number[]) => fmt(([...xs].sort((a, b) => a - b)[xs.length >> 1] * 1e6) / N, 0);
    say(`  bake ${look} L${level} at ${f.full.w}x${f.full.h}: pixel ${stats(tp)} (${ns(tp)} ns/px)${te ? `; exact ${stats(te)} (${ns(te)} ns/px, ${fmt((100 * (([...te].sort((a, b) => a - b)[te.length >> 1]) / ([...tp].sort((a, b) => a - b)[tp.length >> 1]) - 1)), 0)}% over pixel)` : ""} [exact branches at most 5% over; melt 77-89 ns/px]`);
  }
}
say(`\nbaseline loop at the end: ${fmt(baseline(), 1)} ms`);
writeText(`${OUT}/perf.txt`, lines.join("\n"));

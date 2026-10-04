// Does the data line up with the picture? The object-centre fit (design 2.4): a picture shows its
// objects where they are, so the luminance spread at the objects' centres peaks at the right
// placement. Used by extract, by rankLevels and by the dd worker's "check" message.
//
// The picture is scored at FIT.pxPerSquare, box-averaged down when it is finer (a coarser picture
// is scored as it is), its luminance composited over black where it is see-through. score(o) is
// the mean, over the objects whose box lies inside the picture, of the luminance standard
// deviation in a box of side 2 * max(2, round(FIT.box * px a square)) + 1 at the object's centre
// moved by o squares (summed-area tables, so a box costs O(1)); fewer than FIT.minObjects boxes
// give no score. Every object is scored at every shift, those outside the picture included, so a
// shift can bring them in. `best` is the correction: the shift that, added to the object centres,
// lines them up with what the picture shows. A picture whose content lies 2 squares left of where
// the map puts it has best (-2, 0): the map seems to have grown 2 squares on the left since the
// export, and the picture's rectangle is then 2 squares further right (extract.ts moves it by -best).
//
// Sharpness comes from the small objects (M2, on waterfall's 1.2 export). A crown wider than the
// half-square step keeps its box inside the crown when the picture is moved half a square, so its
// centre is no peak at that scale (waterfall's 27 pines and eucalyptus gave the correct placement
// a sharpness of 0.98, "unsure", and a placement half a square off 0.85, "yes"). So sharp(o) and
// the peak test are taken over the objects whose prior radius (priorReach, or the stored reach)
// is at most FIT.small squares, when there are FIT.minObjects of them; else over every object.
// score(o), best and lead use every object as before. A "yes" also needs the placement to be a
// peak: no half-square neighbour scores higher (FIT.peak), which the mean alone doesn't say when
// the peak is narrow (one neighbour high, three low).

import type { FitResult, PictureRect, PictureSample } from "./extract";
import { GRID, type Level } from "./model";
import { OR, defaultName, objectRole } from "./roles";
import { SIDECAR_UNITS, type SeasonSidecar } from "./sidecar";
import { priorReach } from "./measure";
import { SPRITE_SIZES } from "./spriteSizes";

/** The fit's numbers (design 2.4). */
export const FIT = {
  /** The picture is scored at this many px a square. */
  pxPerSquare: 24,
  /** The box at each centre has side 2 * round(box * pxPerSquare) + 1 px. */
  box: 0.3,
  /** Fewer default objects inside the picture: "unsure". */
  minObjects: 8,
  /** Shifts tried: a grid of step squares within range squares, at least minShift from 0. */
  step: 0.5,
  range: 3,
  minShift: 1,
  /** yes: s0 >= best, sharp(0) <= yesSharp and peak(0) <= peak. */
  yesSharp: 0.95,
  /** The highest half-square neighbour's score over the placement's own, at most, for "yes" (a peak). */
  peak: 1,
  /** Objects with a prior radius up to this many squares carry the sharpness and the peak test, when minObjects of them. */
  small: 0.6,
  /** no: s0 < noLead * best, or best >= noBest * s0 with sharp(best) <= noSharp. */
  noLead: 0.85,
  noBest: 1.1,
  noSharp: 0.92,
} as const;

/** The smallest half-side of the box, in pixels (the prototype's, objfit2.ts). */
const MIN_HALF = 2;
/** A picture finer than this share over FIT.pxPerSquare is box-averaged down to it. */
const RESAMPLE_ABOVE = 1.05;

/**
 * `centres`: the default objects' world x, y, interleaved (packs left out); `radii`: each one's
 * prior radius in world units (levelRadii; without them every object carries the sharpness).
 */
export function objectFit(centres: Float64Array, rect: PictureRect, pic: PictureSample, radii?: Float64Array): FitResult {
  const [x0, y0, x1, y1] = rect.rect;
  const none: FitResult = { verdict: "unsure", lead: 0, sharp: 0, peak: 0, small: 0, best: [0, 0], objects: 0 };
  if (!(x1 > x0 && y1 > y0) || !Number.isFinite(x0 + y0 + x1 + y1) || !(pic.w > 0 && pic.h > 0)) return none;
  const sqW = (x1 - x0) / GRID, sqH = (y1 - y0) / GRID;
  // The scoring grid: FIT.pxPerSquare, or the picture's own when it is coarser.
  const own = Math.min(pic.w / sqW, pic.h / sqH);
  const down = own > FIT.pxPerSquare * RESAMPLE_ABOVE;
  const W = down ? Math.max(1, Math.round(sqW * FIT.pxPerSquare)) : pic.w;
  const H = down ? Math.max(1, Math.round(sqH * FIT.pxPerSquare)) : pic.h;
  const L = cachedLuminance(pic, W, H);
  const ppx = W / sqW, ppy = H / sqH;

  // Summed-area tables of L and L^2.
  const W1 = W + 1;
  const S = new Float64Array(W1 * (H + 1)), Q = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < W; x++) {
      const v = L[y * W + x];
      rs += v;
      rq += v * v;
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs;
      Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + rq;
    }
  }
  const r = Math.max(MIN_HALF, Math.round(FIT.box * Math.min(ppx, ppy)));
  const side = 2 * r + 1, area = side * side;

  // Object centres in scoring pixels (not rounded: shifts are added first).
  const n = centres.length >> 1;
  const px = new Float64Array(n), py = new Float64Array(n);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const X = centres[i * 2], Y = centres[i * 2 + 1];
    px[i] = ((X - x0) / (x1 - x0)) * W;
    py[i] = ((Y - y0) / (y1 - y0)) * H;
    if (X >= x0 && X < x1 && Y >= y0 && Y < y1) inside++;
  }

  // The objects that carry the sharpness: the small ones, when there are enough of them.
  let small: Uint8Array | null = null;
  let nSmall = 0;
  if (radii && radii.length >= n) {
    small = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (radii[i] <= FIT.small * GRID) { small[i] = 1; nSmall++; }
    if (nSmall < FIT.minObjects) { small = null; nSmall = 0; }
  }

  const score = (ox: number, oy: number, sub: Uint8Array | null = null): number => {
    const dx = ox * ppx, dy = oy * ppy;
    let s = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (sub && !sub[i]) continue;
      const bx = Math.floor(px[i] + dx) - r, by = Math.floor(py[i] + dy) - r;
      if (!(bx >= 0 && by >= 0 && bx + side <= W && by + side <= H)) continue;
      const a = by * W1 + bx, b = (by + side) * W1 + bx;
      const sum = S[b + side] - S[a + side] - S[b] + S[a];
      const sq = Q[b + side] - Q[a + side] - Q[b] + Q[a];
      const m = sum / area;
      const v = sq / area - m * m;
      s += v > 0 ? Math.sqrt(v) : 0;
      k++;
    }
    return k >= FIT.minObjects ? s / k : NaN;
  };
  /** The four half-square neighbours' mean score over the score at (ox, oy), and their highest over it. */
  const around = (ox: number, oy: number, sub: Uint8Array | null): { sharp: number; peak: number } => {
    const at = score(ox, oy, sub);
    let s = 0, k = 0, m = 0;
    for (const [ax, ay] of [[FIT.step, 0], [-FIT.step, 0], [0, FIT.step], [0, -FIT.step]]) {
      const v = score(ox + ax, oy + ay, sub);
      if (!Number.isNaN(v)) { s += v; k++; if (v > m) m = v; }
    }
    return k > 0 && at > 0 ? { sharp: s / k / at, peak: m / at } : { sharp: NaN, peak: NaN };
  };

  const s0 = score(0, 0);
  let best = NaN, bx = 0, by = 0;
  const steps = Math.round(FIT.range / FIT.step);
  for (let j = -steps; j <= steps; j++) {
    for (let i = -steps; i <= steps; i++) {
      const dx = i * FIT.step, dy = j * FIT.step;
      if (Math.sqrt(dx * dx + dy * dy) < FIT.minShift) continue;
      const v = score(dx, dy);
      if (!Number.isNaN(v) && (Number.isNaN(best) || v > best)) { best = v; bx = dx; by = dy; }
    }
  }
  // The small objects' own score at the placement may be missing (too few of their boxes inside): then every object.
  if (small && Number.isNaN(score(0, 0, small))) { small = null; nSmall = 0; }
  const { sharp, peak } = Number.isNaN(s0) ? { sharp: NaN, peak: NaN } : around(0, 0, small);
  const sharpBest = Number.isNaN(best) ? NaN : around(bx, by, small).sharp;
  const lead = s0 / best;

  let verdict: FitResult["verdict"] = "unsure";
  if (inside >= FIT.minObjects && !Number.isNaN(s0) && !Number.isNaN(best)) {
    if (s0 >= best && sharp <= FIT.yesSharp && peak <= FIT.peak) verdict = "yes";
    else if (s0 < FIT.noLead * best || (best >= FIT.noBest * s0 && sharpBest <= FIT.noSharp)) verdict = "no";
  }
  const out: FitResult = {
    verdict,
    lead: Number.isFinite(lead) ? lead : 0,
    sharp: Number.isFinite(sharp) ? sharp : 0,
    peak: Number.isFinite(peak) ? peak : 0,
    small: nSmall,
    best: [bx, by],
    objects: inside,
  };
  if (verdict === "no" && Number.isInteger(bx) && Number.isInteger(by)) out.shiftSq = [bx, by];
  return out;
}

/**
 * The centres of a level's Dungeondraft default objects (packs, embedded and unknown sources left
 * out), world x, y interleaved. Effects (smoke, fire, fog: EFFECT) are left out too: they are drawn
 * see-through and drift from their centres, so they don't peak there. Tulgi's roof level, 27 smoke
 * effects and 2 chimneys, scored "no" on its own roof export with them.
 */
export function levelCentres(level: Level): Float64Array {
  const out: number[] = [];
  for (const o of level.objects) {
    if (o.texture?.source !== "default" || objectRole(defaultName(o.texture)) === OR.EFFECT) continue;
    const { x, y } = o.position;
    if (Number.isFinite(x) && Number.isFinite(y)) out.push(x, y);
  }
  return Float64Array.from(out);
}

/**
 * The same objects' prior radii (the mean of priorReach over its 16 directions, world units), in
 * levelCentres' order: which of them are small enough to carry the sharpness.
 */
export function levelRadii(level: Level): Float64Array {
  const out: number[] = [];
  for (const o of level.objects) {
    if (o.texture?.source !== "default") continue;
    const role = objectRole(defaultName(o.texture));
    if (role === OR.EFFECT) continue;
    const { x, y } = o.position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pr = priorReach(o, role, SPRITE_SIZES);
    let m = 0;
    for (let k = 0; k < pr.length; k++) m += pr[k];
    out.push(m / pr.length);
  }
  return Float64Array.from(out);
}

/**
 * The fit of an attached sidecar against a picture, from the sidecar alone (2.4: "Use it with this
 * picture", and Check… on a scene on hold): object centres from OBJS (pack items, stored as
 * OPAQUE, and effects left out, as in levelCentres), the rectangle from META.
 */
export function sidecarFit(sc: SeasonSidecar, pic: PictureSample): FitResult {
  const o = sc.objects;
  const out: number[] = [], radii: number[] = [];
  for (let i = 0; i < o.n; i++) {
    if (o.role[i] === OR.OPAQUE || o.role[i] === OR.EFFECT) continue;
    out.push(o.x[i] / SIDECAR_UNITS.coord, o.y[i] / SIDECAR_UNITS.coord);
    let m = 0;
    for (let k = 0; k < 16; k++) m += o.reach[i * 16 + k];
    radii.push(m / 16 / SIDECAR_UNITS.reach);
  }
  return objectFit(Float64Array.from(out), { rect: sc.meta.rect }, pic, Float64Array.from(radii));
}

/**
 * The last luminance made of each picture (rankLevels and the extractor fit one picture several
 * times). Keyed by the pixel array, so a picture must not be changed between fits.
 */
const lumCache = new WeakMap<Uint8ClampedArray, { w: number; h: number; W: number; H: number; L: Float32Array }>();

function cachedLuminance(pic: PictureSample, W: number, H: number): Float32Array {
  const c = lumCache.get(pic.rgba);
  if (c && c.w === pic.w && c.h === pic.h && c.W === W && c.H === H) return c.L;
  const L = luminance(pic, W, H);
  lumCache.set(pic.rgba, { w: pic.w, h: pic.h, W, H, L });
  return L;
}

/**
 * The picture's luminance (0.299 R + 0.587 G + 0.114 B, over black by alpha) at W x H: the
 * picture itself when that is its size, else box-averaged (area weights, separable).
 */
function luminance(pic: PictureSample, W: number, H: number): Float32Array {
  const sw = pic.w, sh = pic.h, px = pic.rgba;
  const src = new Float32Array(sw * sh);
  for (let i = 0, o = 0; i < sw * sh; i++, o += 4) {
    src[i] = ((0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) * px[o + 3]) / 255;
  }
  if (W === sw && H === sh) return src;
  const cols = boxWeights(sw, W), rows = boxWeights(sh, H);
  const tmp = new Float32Array(sh * W);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = cols.start[x]; k < cols.start[x + 1]; k++) s += src[row + cols.src[k]] * cols.w[k];
      tmp[y * W + x] = s;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let k = rows.start[y]; k < rows.start[y + 1]; k++) {
      const from = rows.src[k] * W, wk = rows.w[k], to = y * W;
      for (let x = 0; x < W; x++) out[to + x] += tmp[from + x] * wk;
    }
  }
  return out;
}

/** Area weights of a 1-D box resample from n to m cells: output j takes sources src[start[j]..start[j+1]) with weights w (summing to 1). */
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

// Seasonal looks for uploaded map images: snow, autumn colour, blossom, drought.
//
// Two stages, both pure (no DOM), so they run in a Web Worker and in tests:
// - analyse() looks at the map once, at about 1024 px, and finds vegetation, water,
//   "outdoor ground", open sky and tree crowns. It keeps a few bytes per pixel.
// - bake() recolours the map at display resolution, strip by strip. It samples the
//   analysis at scene positions, so strips, rectangles and a whole pass all agree.
//
// Only vegetation, natural water and the outdoor ground between them change, and only
// where there is plenty of vegetation nearby ("open sky"): dungeons keep their water,
// moss, green tables and blue floors. Ink, deep shadow, saturated warm colours (lava,
// fire, red roofs) and near-white labels never change at all.
//
// Everything is plain arithmetic on doubles and integers (no Math.sin, pow, exp or atan2,
// whose last bits may differ between browsers), so a seed gives the same picture on
// every device. Browsers also shrink the map for the analysis in their own ways (a
// bilinear canvas, mipmaps, a bicubic or lanczos filter), so the analysis mustn't hinge
// on single-pixel detail: grain, how an outline antialiased, or a statistic sitting right
// on a threshold. The tests shrink one map three ways and expect the same crowns.

import type { SeasonLook } from "../../shared/types";

/** Part of the bake cache key: bump it whenever the same inputs would bake differently. */
export const ALGO_VERSION = 3;

type Tri = readonly [number, number, number];

/**
 * Every number that changes with the strength, per level (index 0-2 for levels 1-3).
 * Numbers that are the same at every level are named constants further down.
 */
export const SEASON_PARAMS = {
  winter: {
    /** Colour grade toward each pixel's own grey, with a blue lift. */
    grade: [0.12, 0.2, 0.28] as Tri,
    /** Outdoor ground moved toward frost white. */
    frost: [0.3, 0.12, 0.05] as Tri,
    /** Plants moved toward grey (half that on crowns). */
    dormant: [0.35, 0.5, 0.6] as Tri,
    /** Share of the outdoor ground under snow. */
    cover: [0, 0.62, 0.97] as Tri,
    /** Snow on the lit side of crowns. */
    crownSnow: [0.12, 0.55, 0.85] as Tri,
    /** 0 no ice, 1 a shore rim, 2 frozen up to 3 squares from the shore. */
    ice: [0, 1, 2] as Tri,
  },
  autumn: {
    grade: [0.04, 0.07, 0.1] as Tri,
    // Each crown is a mottled mix. These shares add up to 1 (the rest is withered brown);
    // red stays at most about a third so no tree reads as one red blob.
    green: [0.45, 0.25, 0.12] as Tri,
    yellow: [0.28, 0.27, 0.24] as Tri,
    orange: [0.17, 0.25, 0.28] as Tri,
    red: [0.1, 0.23, 0.3] as Tri,
    /** Share of each crown that has fallen, showing branches and the ground below. */
    thin: [0.1, 0.22, 0.35] as Tri,
    /** Grass toward straw. */
    straw: [0.25, 0.45, 0.65] as Tri,
    /** Fallen leaves per square on open ground (three times that next to crowns). */
    leaves: [0.5, 1.6, 4] as Tri,
  },
  spring: {
    grade: [0.03, 0.05, 0.07] as Tri,
    /** Greens made fresher. */
    fresh: [0.3, 0.5, 0.65] as Tri,
    /** Share of crowns in blossom, and how thickly. */
    bloomCrowns: [0.12, 0.4, 0.75] as Tri,
    bloomDensity: [0.4, 0.55, 0.72] as Tri,
    /** Wildflowers per square on open grass. */
    flowers: [0.5, 2, 5] as Tri,
  },
  summer: {
    grade: [0.05, 0.08, 0.12] as Tri,
    /** Greens made deeper. */
    lush: [0.12, 0, 0] as Tri,
    /** Grass dried toward straw, in patches. */
    dry: [0, 0.5, 0.82] as Tri,
    /** Crowns dried toward olive. */
    crownDry: [0, 0.15, 0.25] as Tri,
    /** Share of the grass worn to bare earth (cracked at level 3). */
    bare: [0, 0.1, 0.35] as Tri,
    /** Water turned murky. */
    murk: [0, 0.2, 0.45] as Tri,
  },
} as const;

// The same at every level.
/** Open sky ramps up with the share of vegetation in a 7x7-square box. */
const SKY_LO = 0.06;
const SKY_HI = 0.18;
/** Plant tints under a roof (no open sky) still apply at this strength. */
const INDOOR = 0.3;
/** Deep snow freezes water this far from the shore, in squares; big lakes keep open water. */
const FREEZE_LO = 2.5;
const FREEZE_HI = 3.5;
/** The soft outdoor mask is sharpened through this ramp, so snow has an edge. */
const OUT_LO = 0.25;
const OUT_HI = 0.75;
/** Pixels this much darker than their surroundings (wall outlines, grid lines) stay dark. */
const INK_LO = -0.1;
const INK_HI = -0.04;

// ---------------------------------------------------------------- small maths

const INV255 = 1 / 255;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smoothstep from a to b. */
function ramp(v: number, a: number, b: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Integer hash of a lattice point to [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A well-mixed seed per effect, so drifts, crowns and leaves don't line up. */
function mix(seed: number, salt: number): number {
  let h = Math.imul(seed ^ 0x3c6ef372, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return h ^ (h >>> 16);
}

// Octave lattice rotations as literal (cos, sin) constants, identical on every device.
const ROT = [0.955336, 0.29552, 0.453596, 0.891207, -0.666276, 0.745705, 0.132352, 0.991203];

/** Value noise on a rotated lattice, remembering the last cell (neighbouring pixels share it). */
class Octave {
  c: number;
  s: number;
  sd: number;
  ix = 0x7fffffff;
  iy = 0x7fffffff;
  h00 = 0;
  h10 = 0;
  h01 = 0;
  h11 = 0;
  constructor(freq: number, rot: number, seed: number) {
    this.c = ROT[rot * 2] * freq;
    this.s = ROT[rot * 2 + 1] * freq;
    this.sd = seed;
  }
  at(u: number, w: number): number {
    const x = u * this.c - w * this.s + 1000.5;
    const y = u * this.s + w * this.c + 1000.5;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix !== this.ix || iy !== this.iy) {
      this.ix = ix;
      this.iy = iy;
      this.h00 = hash2(ix, iy, this.sd);
      this.h10 = hash2(ix + 1, iy, this.sd);
      this.h01 = hash2(ix, iy + 1, this.sd);
      this.h11 = hash2(ix + 1, iy + 1, this.sd);
    }
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const t = this.h00 + (this.h10 - this.h00) * fx;
    const b = this.h01 + (this.h11 - this.h01) * fx;
    return t + (b - t) * fy;
  }
}

/**
 * Three independent value noises on one lattice (a crown's fine mottles). The lattice
 * weights are shared, so the second and third cost only their hashes. Results in v0-v2.
 */
class Octave3 {
  c: number;
  s: number;
  sd0: number;
  sd1: number;
  sd2: number;
  ix = 0x7fffffff;
  iy = 0x7fffffff;
  h = new Float64Array(12);
  v0 = 0;
  v1 = 0;
  v2 = 0;
  constructor(freq: number, rot: number, seed: number) {
    this.c = ROT[rot * 2] * freq;
    this.s = ROT[rot * 2 + 1] * freq;
    this.sd0 = seed;
    this.sd1 = seed ^ 0x2545f491;
    this.sd2 = seed ^ 0x6c8e9cf5;
  }
  at(u: number, w: number): void {
    const x = u * this.c - w * this.s + 1000.5;
    const y = u * this.s + w * this.c + 1000.5;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const h = this.h;
    if (ix !== this.ix || iy !== this.iy) {
      this.ix = ix;
      this.iy = iy;
      for (let n = 0; n < 3; n++) {
        const sd = n === 0 ? this.sd0 : n === 1 ? this.sd1 : this.sd2;
        h[n * 4] = hash2(ix, iy, sd);
        h[n * 4 + 1] = hash2(ix + 1, iy, sd);
        h[n * 4 + 2] = hash2(ix, iy + 1, sd);
        h[n * 4 + 3] = hash2(ix + 1, iy + 1, sd);
      }
    }
    let fx = x - ix;
    let fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    let t = h[0] + (h[1] - h[0]) * fx;
    this.v0 = t + (h[2] + (h[3] - h[2]) * fx - t) * fy;
    t = h[4] + (h[5] - h[4]) * fx;
    this.v1 = t + (h[6] + (h[7] - h[6]) * fx - t) * fy;
    t = h[8] + (h[9] - h[8]) * fx;
    this.v2 = t + (h[10] + (h[11] - h[10]) * fx - t) * fy;
  }
}

/** Three octaves, for soft drifts and patches. */
class Fbm {
  o1: Octave;
  o2: Octave;
  o3: Octave;
  constructor(freq: number, seed: number) {
    this.o1 = new Octave(freq, 0, seed);
    this.o2 = new Octave(freq * 2.7, 1, seed ^ 0x5bd1e995);
    this.o3 = new Octave(freq * 7.3, 2, seed ^ 0x1b873593);
  }
  at(u: number, w: number): number {
    return 0.58 * this.o1.at(u, w) + 0.29 * this.o2.at(u, w) + 0.13 * this.o3.at(u, w);
  }
}

// Noise values bunch up around 0.5. These are their measured quantiles (k/32, lower half;
// the upper half mirrors it), so "62% snow cover" or "a third red" really are those shares.
const Q_OCTAVE = [
  0, 0.1172, 0.1655, 0.203, 0.2349, 0.2635, 0.2896, 0.314, 0.3371, 0.3593, 0.3806, 0.4014, 0.4216, 0.4415,
  0.4612, 0.4807, 0.5,
];
const Q_FBM = [
  0.02, 0.2416, 0.2807, 0.3082, 0.3303, 0.3495, 0.3667, 0.3826, 0.3975, 0.4116, 0.4251, 0.4382, 0.451,
  0.4634, 0.4758, 0.488, 0.5,
];

/** A 257-step table mapping a noise value to its rank in [0, 1]. */
function rankTable(half: readonly number[]): Float64Array {
  const q = new Float64Array(33);
  for (let k = 0; k <= 16; k++) {
    q[k] = half[k];
    q[32 - k] = 1 - half[k];
  }
  const t = new Float64Array(258);
  let k = 0;
  for (let j = 0; j < 258; j++) {
    const v = j / 256;
    while (k < 31 && q[k + 1] < v) k++;
    t[j] = v <= q[0] ? 0 : v >= q[32] ? 1 : clamp01((k + (v - q[k]) / (q[k + 1] - q[k])) / 32);
  }
  return t;
}
const RANK_OCTAVE = rankTable(Q_OCTAVE);
const RANK_FBM = rankTable(Q_FBM);

function rank(t: Float64Array, v: number): number {
  const f = v * 256;
  if (f <= 0) return t[0];
  if (f >= 256) return t[256];
  const i = f | 0;
  return t[i] + (t[i + 1] - t[i]) * (f - i);
}

/** Rank of a*U + b*V for independent uniform U, V (a >= b, a + b = 1): uniform again. */
function rank2(s: number, a: number, b: number): number {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  if (s < b) return (s * s) / (2 * a * b);
  if (s <= a) return (s - b / 2) / a;
  const t = 1 - s;
  return 1 - (t * t) / (2 * a * b);
}

// Leaf angles over half a turn (leaves are symmetric), as literal (cos, sin) pairs.
const ANG = [
  1, 0, 0.995185, 0.098017, 0.980785, 0.19509, 0.95694, 0.290285, 0.92388, 0.382683, 0.881921, 0.471397,
  0.83147, 0.55557, 0.77301, 0.634393, 0.707107, 0.707107, 0.634393, 0.77301, 0.55557, 0.83147, 0.471397,
  0.881921, 0.382683, 0.92388, 0.290285, 0.95694, 0.19509, 0.980785, 0.098017, 0.995185, 0, 1, -0.098017,
  0.995185, -0.19509, 0.980785, -0.290285, 0.95694, -0.382683, 0.92388, -0.471397, 0.881921, -0.55557,
  0.83147, -0.634393, 0.77301, -0.707107, 0.707107, -0.77301, 0.634393, -0.83147, 0.55557, -0.881921,
  0.471397, -0.92388, 0.382683, -0.95694, 0.290285, -0.980785, 0.19509, -0.995185, 0.098017,
];

/**
 * Fallen leaves: at most one lens-shaped leaf per 0.2-square slot, kept inside its slot so
 * strips agree. Remembers the last slot, since neighbouring pixels usually share it.
 */
class Leaves {
  sd: number;
  ix = 0x7fffffff;
  iy = 0x7fffffff;
  roll = 0;
  cx = 0;
  cy = 0;
  ca = 0;
  sa = 0;
  il2 = 0;
  iw2 = 0;
  /** Which colour, from the last hit. */
  pick = 0;
  /** How far toward the leaf's edge (0 centre, 1 rim), from the last hit. */
  edge = 0;
  constructor(seed: number) {
    this.sd = seed;
  }
  at(u: number, w: number, dens: number): number {
    const gx = u * 5;
    const gy = w * 5;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const sd = this.sd;
    if (ix !== this.ix || iy !== this.iy) {
      this.ix = ix;
      this.iy = iy;
      this.roll = hash2(ix, iy, sd);
      this.cx = ix + 0.35 + 0.3 * hash2(ix, iy, sd ^ 0x51ed);
      this.cy = iy + 0.35 + 0.3 * hash2(ix, iy, sd ^ 0x9e37);
      const ai = (hash2(ix, iy, sd ^ 0x1234) * 32) | 0;
      this.ca = ANG[ai * 2];
      this.sa = ANG[ai * 2 + 1];
      const len = 0.055 + 0.02 * hash2(ix, iy, sd ^ 0x77);
      const wid = len * 0.42;
      this.il2 = 1 / (len * len);
      this.iw2 = 1 / (wid * wid);
      this.pick = hash2(ix, iy, sd ^ 0x7777);
    }
    if (this.roll > dens * 0.04) return 0;
    const dx = (gx - this.cx) * 0.2;
    const dy = (gy - this.cy) * 0.2;
    const p = dx * this.ca + dy * this.sa;
    const q = dy * this.ca - dx * this.sa;
    const e = p * p * this.il2 + q * q * this.iw2;
    this.edge = e;
    return e >= 1 ? 0 : clamp01((1 - e) * 3);
  }
}

/** Round dots on a jittered grid (blossom clusters, wildflowers), one per cell at most. */
class Dots {
  size: number;
  radius: number;
  sd: number;
  ix = 0x7fffffff;
  iy = 0x7fffffff;
  roll = 0;
  cx = 0;
  cy = 0;
  r = 0;
  pick = 0;
  constructor(size: number, radius: number, seed: number) {
    this.size = size;
    this.radius = radius;
    this.sd = seed;
  }
  at(u: number, w: number, dens: number): number {
    const gx = u / this.size;
    const gy = w / this.size;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const sd = this.sd;
    if (ix !== this.ix || iy !== this.iy) {
      this.ix = ix;
      this.iy = iy;
      this.roll = hash2(ix, iy, sd);
      const r = this.radius * (0.7 + 0.6 * hash2(ix, iy, sd ^ 0x1234));
      // A pixel only looks at its own cell, so a dot that crossed the cell's edge would be
      // cut off straight there: a big one is moved in until it fits (r is under half a cell).
      const cx = ix + 0.3 + 0.4 * hash2(ix, iy, sd ^ 0x51ed);
      const cy = iy + 0.3 + 0.4 * hash2(ix, iy, sd ^ 0x9e37);
      this.cx = cx < ix + r ? ix + r : cx > ix + 1 - r ? ix + 1 - r : cx;
      this.cy = cy < iy + r ? iy + r : cy > iy + 1 - r ? iy + 1 - r : cy;
      this.r = r;
      this.pick = hash2(ix, iy, sd ^ 0x7777);
    }
    if (this.roll > dens) return 0;
    const dx = gx - this.cx;
    const dy = gy - this.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= this.r * this.r) return 0;
    return clamp01((this.r - Math.sqrt(d2)) * 8);
  }
}

// ---------------------------------------------------------------- colour

// Hue wheel at full saturation and value, per whole degree.
const PURE = new Float64Array(360 * 3);
for (let d = 0; d < 360; d++) {
  const hp = d / 60;
  const x = 1 - Math.abs((hp % 2) - 1);
  const i = d * 3;
  const [r, g, b] = hp < 1 ? [1, x, 0] : hp < 2 ? [x, 1, 0] : hp < 3 ? [0, 1, x] : hp < 4 ? [0, x, 1] : hp < 5 ? [x, 0, 1] : [1, 0, x];
  PURE[i] = r;
  PURE[i + 1] = g;
  PURE[i + 2] = b;
}

/** HSV (hue in degrees, s and v in 0-1) to 0-255 RGB, written into HSV_OUT. */
const HSV_OUT = new Float64Array(3);
function hsv(h: number, s: number, v: number): void {
  let d = Math.round(h) % 360;
  if (d < 0) d += 360;
  const k = v * 255;
  const base = 1 - s;
  const i = d * 3;
  HSV_OUT[0] = k * (base + s * PURE[i]);
  HSV_OUT[1] = k * (base + s * PURE[i + 1]);
  HSV_OUT[2] = k * (base + s * PURE[i + 2]);
}

/** Hue in degrees of an RGB colour (0 for greys). */
function hueOf(r: number, g: number, b: number): number {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = max - min;
  if (d <= 0) return 0;
  if (max === r) return 60 * (((g - b) / d + 6) % 6);
  if (max === g) return 60 * ((b - r) / d + 2);
  return 60 * ((r - g) / d + 4);
}

let colourLut: Uint8Array | null = null;

/**
 * Per colour (6 bits a channel): how much it looks like vegetation, like natural water,
 * and the guard (0 = never changes: ink and deep shadow, saturated warm colours such as
 * lava, fire and red roofs, and near-white paper and labels). Built once, about 1 MB.
 */
function colourTable(): Uint8Array {
  if (colourLut) return colourLut;
  const t = new Uint8Array(64 * 64 * 64 * 4);
  for (let ri = 0; ri < 64; ri++) {
    for (let gi = 0; gi < 64; gi++) {
      for (let bi = 0; bi < 64; bi++) {
        const r = ri * 4 + 2;
        const g = gi * 4 + 2;
        const b = bi * 4 + 2;
        const max = Math.max(r, g, b);
        const d = max - Math.min(r, g, b);
        const v = max / 255;
        const s = d / max;
        const h = hueOf(r, g, b);
        const lit = ramp(v, 0.1, 0.2);
        // Teal, bright and fairly saturated: stylised rivers, not green grass.
        const teal = ramp(h, 140, 152) * (1 - ramp(h, 186, 196));
        const tealWater = teal * ramp(s, 0.28, 0.4) * ramp(v, 0.4, 0.52);
        const veg = ramp(s, 0.1, 0.2) * lit * ramp(h, 52, 70) * (1 - ramp(h, 180, 192)) * (1 - tealWater);
        const water = Math.max(tealWater, ramp(s, 0.18, 0.3) * lit * ramp(h, 186, 196) * (1 - ramp(h, 245, 260)));
        const warm = h < 50 || h > 330 ? 1 : 0;
        const guard =
          ramp(v, 0.13, 0.24) * (1 - warm * ramp(s, 0.5, 0.62)) * (1 - ramp(v, 0.93, 0.98) * (1 - ramp(s, 0.06, 0.12)));
        const o = ((ri << 12) | (gi << 6) | bi) << 2;
        t[o] = Math.round(255 * veg);
        t[o + 1] = Math.round(255 * water);
        t[o + 2] = Math.round(255 * guard);
      }
    }
  }
  colourLut = t;
  return t;
}

function lutIndex(r: number, g: number, b: number): number {
  return (((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)) << 2;
}

// ---------------------------------------------------------------- analysis helpers

/** Box blur of a byte image (edges repeated), rounded back to bytes. dst may be src. */
function blur8(src: Uint8Array, w: number, h: number, r: number, dst: Uint8Array, tmp: Int32Array): Uint8Array {
  if (r > 1400) r = 1400;
  if (r < 1) {
    if (dst !== src) dst.set(src);
    return dst;
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + (x < 0 ? 0 : x >= w ? w - 1 : x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s;
      const xa = x + r + 1;
      const xs = x - r;
      s += src[row + (xa >= w ? w - 1 : xa)] - src[row + (xs < 0 ? 0 : xs)];
    }
  }
  const nn = (2 * r + 1) * (2 * r + 1);
  const half = nn >> 1;
  const cs = new Int32Array(w);
  for (let y = -r; y <= r; y++) {
    const row = (y < 0 ? 0 : y >= h ? h - 1 : y) * w;
    for (let x = 0; x < w; x++) cs[x] += tmp[row + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) dst[o + x] = ((cs[x] + half) / nn) | 0;
    const ya = y + r + 1;
    const ys = y - r;
    const ra = (ya >= h ? h - 1 : ya) * w;
    const rs = (ys < 0 ? 0 : ys) * w;
    for (let x = 0; x < w; x++) cs[x] += tmp[ra + x] - tmp[rs + x];
  }
  return dst;
}

/** Box blur of a float grid (edges repeated), in place. */
function blurF(src: Float64Array, w: number, h: number, r: number): void {
  if (r < 1) return;
  const n = 2 * r + 1;
  const line = new Float64Array(Math.max(w, h));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + (x < 0 ? 0 : x >= w ? w - 1 : x)];
    for (let x = 0; x < w; x++) {
      line[x] = s / n;
      const xa = x + r + 1;
      const xs = x - r;
      s += src[row + (xa >= w ? w - 1 : xa)] - src[row + (xs < 0 ? 0 : xs)];
    }
    for (let x = 0; x < w; x++) src[row + x] = line[x];
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += src[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + x];
    for (let y = 0; y < h; y++) {
      line[y] = s / n;
      const ya = y + r + 1;
      const ys = y - r;
      s += src[(ya >= h ? h - 1 : ya) * w + x] - src[(ys < 0 ? 0 : ys) * w + x];
    }
    for (let y = 0; y < h; y++) src[y * w + x] = line[y];
  }
}

// Chamfer distances in fifths of a pixel (5 across, 7 diagonally): integers, so exact.
const D1 = 5;
const D2 = 7;
const FAR = 1 << 28;

/** Distance to the nearest pixel whose mask is set (want 1) or clear (want 0). */
function distTo(mask: Uint8Array, want: number, w: number, h: number, d: Int32Array): Int32Array {
  const n = w * h;
  for (let k = 0; k < n; k++) d[k] = (mask[k] !== 0 ? 1 : 0) === want ? 0 : FAR;
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      let v = d[k];
      if (v === 0) continue;
      if (x > 0 && d[k - 1] + D1 < v) v = d[k - 1] + D1;
      if (y > 0) {
        if (d[k - w] + D1 < v) v = d[k - w] + D1;
        if (x > 0 && d[k - w - 1] + D2 < v) v = d[k - w - 1] + D2;
        if (x < w - 1 && d[k - w + 1] + D2 < v) v = d[k - w + 1] + D2;
      }
      d[k] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1, k = y * w + w - 1; x >= 0; x--, k--) {
      let v = d[k];
      if (v === 0) continue;
      if (x < w - 1 && d[k + 1] + D1 < v) v = d[k + 1] + D1;
      if (y < h - 1) {
        if (d[k + w] + D1 < v) v = d[k + w] + D1;
        if (x < w - 1 && d[k + w + 1] + D2 < v) v = d[k + w + 1] + D2;
        if (x > 0 && d[k + w - 1] + D2 < v) v = d[k + w - 1] + D2;
      }
      d[k] = v;
    }
  }
  return d;
}

/** Distance to the nearest labelled pixel, and which label that is (Voronoi by label). */
function distLabel(lab: Int32Array, w: number, h: number, d: Int32Array, near: Int32Array): void {
  const n = w * h;
  for (let k = 0; k < n; k++) {
    near[k] = lab[k];
    d[k] = lab[k] ? 0 : FAR;
  }
  const step = (k: number, q: number, c: number): void => {
    if (d[q] + c < d[k]) {
      d[k] = d[q] + c;
      near[k] = near[q];
    }
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      if (d[k] === 0) continue;
      if (x > 0) step(k, k - 1, D1);
      if (y > 0) {
        step(k, k - w, D1);
        if (x > 0) step(k, k - w - 1, D2);
        if (x < w - 1) step(k, k - w + 1, D2);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1, k = y * w + w - 1; x >= 0; x--, k--) {
      if (d[k] === 0) continue;
      if (x < w - 1) step(k, k + 1, D1);
      if (y < h - 1) {
        step(k, k + w, D1);
        if (x < w - 1) step(k, k + w + 1, D2);
        if (x > 0) step(k, k + w - 1, D2);
      }
    }
  }
}

/** Keeps pixels farther than r from the background (r in pixels). */
function erode(m: Uint8Array, r: number, w: number, h: number, d: Int32Array): void {
  distTo(m, 0, w, h, d);
  const lim = r * D1;
  for (let k = 0; k < w * h; k++) m[k] = d[k] > lim ? 1 : 0;
}

/** Adds pixels within r of the mask (r in pixels). */
function dilate(m: Uint8Array, r: number, w: number, h: number, d: Int32Array): void {
  distTo(m, 1, w, h, d);
  const lim = r * D1;
  for (let k = 0; k < w * h; k++) m[k] = d[k] <= lim ? 1 : 0;
}

/** Labels the 4-connected regions of mask 1..n; returns n. */
function label4(mask: Uint8Array, w: number, h: number, lab: Int32Array, stack: Int32Array): number {
  const total = w * h;
  lab.fill(0, 0, total);
  let n = 0;
  for (let k0 = 0; k0 < total; k0++) {
    if (!mask[k0] || lab[k0]) continue;
    n++;
    let sp = 0;
    stack[sp++] = k0;
    lab[k0] = n;
    while (sp) {
      const k = stack[--sp];
      const x = k % w;
      if (x > 0 && mask[k - 1] && !lab[k - 1]) {
        lab[k - 1] = n;
        stack[sp++] = k - 1;
      }
      if (x < w - 1 && mask[k + 1] && !lab[k + 1]) {
        lab[k + 1] = n;
        stack[sp++] = k + 1;
      }
      if (k >= w && mask[k - w] && !lab[k - w]) {
        lab[k - w] = n;
        stack[sp++] = k - w;
      }
      if (k + w < total && mask[k + w] && !lab[k + w]) {
        lab[k + w] = n;
        stack[sp++] = k + w;
      }
    }
  }
  return n;
}

/**
 * Sets the gaps in mask (4-connected regions where it's clear) of at most maxArea pixels
 * that have no ink in them. inv is scratch space.
 */
function fillPinholes(
  mask: Uint8Array,
  ink: Uint8Array,
  w: number,
  h: number,
  maxArea: number,
  inv: Uint8Array,
  lab: Int32Array,
  stack: Int32Array,
): void {
  const total = w * h;
  for (let k = 0; k < total; k++) inv[k] = mask[k] ? 0 : 1;
  const n = label4(inv, w, h, lab, stack);
  const cnt = new Int32Array(n + 1);
  const inked = new Uint8Array(n + 1);
  for (let k = 0; k < total; k++) {
    const l = lab[k];
    cnt[l]++;
    if (ink[k]) inked[l] = 1;
  }
  for (let k = 0; k < total; k++) {
    const l = lab[k];
    if (l && cnt[l] <= maxArea && !inked[l]) mask[k] = 1;
  }
}

/** Clears the regions of mask smaller than minArea pixels (labels, gems, small props). */
function dropSmall(mask: Uint8Array, w: number, h: number, minArea: number, lab: Int32Array, stack: Int32Array): void {
  const n = label4(mask, w, h, lab, stack);
  const cnt = new Int32Array(n + 1);
  for (let k = 0; k < w * h; k++) cnt[lab[k]]++;
  for (let k = 0; k < w * h; k++) if (lab[k] && cnt[lab[k]] < minArea) mask[k] = 0;
}

/** An outline or a crown's rim shadow: brightest channel below this. */
const DARK = 90;

/**
 * Per region of lab (1..n): pixel count, boundary pixels (those next to a dark pixel, and
 * those on the map's edge), and sums for centroid and colour. A transparent pixel is off
 * the map: it reads back as black, but it's no outline.
 */
interface Regions {
  n: number;
  area: Float64Array;
  edge: Float64Array;
  dark: Float64Array;
  border: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  sr: Float64Array;
  sg: Float64Array;
  sb: Float64Array;
}

function regions(lab: Int32Array, n: number, w: number, h: number, rgba: Uint8ClampedArray, mx: Uint8Array): Regions {
  const g: Regions = {
    n,
    area: new Float64Array(n + 1),
    edge: new Float64Array(n + 1),
    dark: new Float64Array(n + 1),
    border: new Float64Array(n + 1),
    sx: new Float64Array(n + 1),
    sy: new Float64Array(n + 1),
    sr: new Float64Array(n + 1),
    sg: new Float64Array(n + 1),
    sb: new Float64Array(n + 1),
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      const l = lab[k];
      if (!l) continue;
      g.area[l]++;
      g.sx[l] += x + 0.5;
      g.sy[l] += y + 0.5;
      g.sr[l] += rgba[k * 4];
      g.sg[l] += rgba[k * 4 + 1];
      g.sb[l] += rgba[k * 4 + 2];
      let onBorder = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      let edge = onBorder;
      let dark = false;
      if (x > 0 && lab[k - 1] !== l) {
        edge = true;
        if (rgba[k * 4 - 1] < 128) onBorder = true;
        else if (mx[k - 1] < DARK) dark = true;
      }
      if (x < w - 1 && lab[k + 1] !== l) {
        edge = true;
        if (rgba[k * 4 + 7] < 128) onBorder = true;
        else if (mx[k + 1] < DARK) dark = true;
      }
      if (y > 0 && lab[k - w] !== l) {
        edge = true;
        if (rgba[(k - w) * 4 + 3] < 128) onBorder = true;
        else if (mx[k - w] < DARK) dark = true;
      }
      if (y < h - 1 && lab[k + w] !== l) {
        edge = true;
        if (rgba[(k + w) * 4 + 3] < 128) onBorder = true;
        else if (mx[k + w] < DARK) dark = true;
      }
      if (edge) g.edge[l]++;
      if (dark) g.dark[l]++;
      if (onBorder) g.border[l]++;
    }
  }
  return g;
}

/**
 * Adds to each crown found by shape (regions of lab marked with area < 0, already 2 in canM)
 * what its outline encloses: lobes cut off by the ink drawn inside the crown, and that ink,
 * so the whole crown turns and not just its biggest piece. (How much of a crown that ink
 * cuts off depends on how the map was downscaled.) Inside is whatever in the crown's box
 * can't reach the box's edge without crossing the crown or ink. Ink up to `peel` pixels in
 * from the outside (the outline itself) stays out, so the softened crown doesn't spill onto
 * the ground beyond it, and only ink and leaves join (vegetation, or a colour between
 * vegetation and teal water, as blue-green foliage is): a rock drawn inside stays as it is.
 * rv holds the regions' colour sums; mark is scratch space.
 */
function fillOutlined(
  canM: Uint8Array,
  lab: Int32Array,
  rv: Regions,
  n: number,
  ink: Uint8Array,
  vm: Uint8Array,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  peel: number,
  mark: Int32Array,
): void {
  // (Marked regions' areas are -1: their sizes are counted again below.)
  const area = rv.area;
  const bx0 = new Int32Array(n + 1).fill(w);
  const by0 = new Int32Array(n + 1).fill(h);
  const bx1 = new Int32Array(n + 1).fill(-1);
  const by1 = new Int32Array(n + 1).fill(-1);
  const size = new Float64Array(n + 1);
  let any = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      const l = lab[k];
      if (!l || area[l] >= 0) continue;
      any = true;
      size[l]++;
      if (x < bx0[l]) bx0[l] = x;
      if (x > bx1[l]) bx1[l] = x;
      if (y < by0[l]) by0[l] = y;
      if (y > by1[l]) by1[l] = y;
    }
  }
  if (!any) return;
  // All the vegetation's colour, so what's inside can be told from the lawn round it.
  let tr = 0;
  let tg = 0;
  let tb = 0;
  let ta = 0;
  for (let l = 1; l <= n; l++) {
    tr += rv.sr[l];
    tg += rv.sg[l];
    tb += rv.sb[l];
    ta += area[l] >= 0 ? area[l] : size[l];
  }
  mark.fill(0, 0, w * h);
  const T = colourTable();
  const leafy = (k: number): boolean => {
    const li = lutIndex(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]);
    return T[li] + T[li + 1] >= 128;
  };
  let q = new Int32Array(0);
  let q2 = new Int32Array(0);
  for (let l = 1; l <= n; l++) {
    if (area[l] >= 0) continue;
    // The crown's box with a margin, so the flood can go round the outline.
    const x0 = Math.max(0, bx0[l] - 2);
    const y0 = Math.max(0, by0[l] - 2);
    const x1 = Math.min(w - 1, bx1[l] + 2);
    const y1 = Math.min(h - 1, by1[l] + 2);
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (q.length < box) {
      q = new Int32Array(box);
      q2 = new Int32Array(box);
    }
    // Flood the outside from the box's edge (mark l); the ink it meets is the outline's
    // outer edge (mark -l).
    let qn = 0;
    let pn = 0;
    const visit = (k: number): void => {
      if (mark[k] === l || mark[k] === -l || lab[k] === l) return;
      if (ink[k]) {
        mark[k] = -l;
        q2[pn++] = k;
      } else {
        mark[k] = l;
        q[qn++] = k;
      }
    };
    for (let x = x0; x <= x1; x++) {
      visit(y0 * w + x);
      visit(y1 * w + x);
    }
    for (let y = y0; y <= y1; y++) {
      visit(y * w + x0);
      visit(y * w + x1);
    }
    for (let i = 0; i < qn; i++) {
      const k = q[i];
      const x = k % w;
      const y = (k - x) / w;
      if (x > x0) visit(k - 1);
      if (x < x1) visit(k + 1);
      if (y > y0) visit(k - w);
      if (y < y1) visit(k + w);
    }
    // The outline, peeled a step at a time from its outer edge (also mark -l).
    let from = 0;
    for (let step = 2; step <= peel && from < pn; step++) {
      const to = pn;
      for (let i = from; i < to; i++) {
        const k = q2[i];
        const x = k % w;
        const y = (k - x) / w;
        for (let t = 0; t < 4; t++) {
          const j = t === 0 ? (x > x0 ? k - 1 : -1) : t === 1 ? (x < x1 ? k + 1 : -1) : t === 2 ? (y > y0 ? k - w : -1) : y < y1 ? k + w : -1;
          if (j < 0 || !ink[j] || lab[j] === l || mark[j] === l || mark[j] === -l) continue;
          mark[j] = -l;
          q2[pn++] = j;
        }
      }
      from = to;
    }
    // What's left in the box is inside (mark n + l). It joins only if it's smaller than the
    // crown and looks more like it than like the lawn (anything else and the outline isn't
    // a crown's: a hedge round a garden), and only the parts that touch the crown: specks
    // cut off by peeled ink stay out.
    let added = 0;
    let ar = 0;
    let ag = 0;
    let ab = 0;
    let rn = 0;
    const inside = n + l;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0, k = y * w + x0; x <= x1; x++, k++) {
        if (lab[k] === l) q[rn++] = k;
        else if (mark[k] !== l && mark[k] !== -l && !canM[k] && (vm[k] || ink[k] || leafy(k))) {
          mark[k] = inside;
          if (!ink[k]) {
            added++;
            ar += rgba[k * 4];
            ag += rgba[k * 4 + 1];
            ab += rgba[k * 4 + 2];
          }
        }
      }
    }
    const sz = size[l];
    if (added > sz) continue;
    if (added > 0 && ta - sz >= sz) {
      const rest = ta - sz;
      const toCrown = colourGap(ar / added, ag / added, ab / added, rv.sr[l] / sz, rv.sg[l] / sz, rv.sb[l] / sz);
      const toLawn = colourGap(ar / added, ag / added, ab / added, (tr - rv.sr[l]) / rest, (tg - rv.sg[l]) / rest, (tb - rv.sb[l]) / rest);
      if (toCrown > toLawn) continue;
    }
    for (let i = 0; i < rn; i++) {
      const k = q[i];
      const x = k % w;
      const y = (k - x) / w;
      for (let t = 0; t < 4; t++) {
        const j = t === 0 ? (x > x0 ? k - 1 : -1) : t === 1 ? (x < x1 ? k + 1 : -1) : t === 2 ? (y > y0 ? k - w : -1) : y < y1 ? k + w : -1;
        if (j < 0 || mark[j] !== inside) continue;
        mark[j] = l;
        canM[j] = 2;
        q[rn++] = j;
      }
    }
  }
}

/** Below this edgeCrispness, a candidate crown fades into what's round it. */
const SOFT = 0.5;

/**
 * How crisp each candidate's edge is (1..n, labelled in lab): the steepest rise in mean
 * luma between 0.1-square bands within 0.4 square of its boundary, as a share of the whole
 * rise from its inside (0.5-1 square in) to the vegetation round it (0.5-1 square out). A
 * drawn crown steps up within a band or two (0.5 and more); a lawn's own darker patch fades
 * over half a square or more (about 0.1-0.4). Means over whole boundaries, so grain and the
 * way the map was downscaled hardly move it. dOut and near are distLabel's results for lab;
 * dIn is scratch space.
 */
function edgeCrispness(
  mask: Uint8Array,
  lab: Int32Array,
  n: number,
  dOut: Int32Array,
  near: Int32Array,
  vm: Uint8Array,
  lum: Uint8Array,
  w: number,
  h: number,
  cA: number,
  dIn: Int32Array,
): Float64Array {
  const NB = 20;
  const sum = new Float64Array((n + 1) * NB);
  const cnt = new Float64Array((n + 1) * NB);
  distTo(mask, 0, w, h, dIn);
  // Bands per pixel. At 5 pixels a square or less a 0.1-square band is thinner than the steps
  // distances come in, so the bands either side of the boundary would stay empty and no
  // edge would measure crisp: they're kept at least about half a pixel wide.
  const band = Math.min(10 / cA, 1.99);
  const reach = cA * D1;
  for (let k = 0; k < w * h; k++) {
    let l: number;
    let bin: number;
    if (mask[k]) {
      l = lab[k];
      bin = 9 - Math.floor((dIn[k] / D1 - 0.5) * band);
      if (bin < 0) continue;
    } else {
      if (!vm[k] || dOut[k] > reach) continue;
      l = near[k];
      bin = 10 + Math.floor((dOut[k] / D1 - 0.5) * band);
      if (bin >= NB) continue;
    }
    if (!l) continue;
    sum[l * NB + bin] += lum[k];
    cnt[l * NB + bin]++;
  }
  const crisp = new Float64Array(n + 1);
  const pool = (o: number, a: number, b: number): number => {
    let s = 0;
    let c = 0;
    for (let i = a; i <= b; i++) {
      s += sum[o + i];
      c += cnt[o + i];
    }
    return c ? s / c : -1;
  };
  for (let l = 1; l <= n; l++) {
    const o = l * NB;
    // Bands thinner than this (a corner of the candidate, say) are too few pixels to trust.
    let most = 0;
    for (let i = 0; i < NB; i++) if (cnt[o + i] > most) most = cnt[o + i];
    const min = Math.max(4, 0.15 * most);
    let step = 0;
    for (let i = 6; i <= 12; i++) {
      if (cnt[o + i] < min || cnt[o + i + 1] < min) continue;
      const s = sum[o + i + 1] / cnt[o + i + 1] - sum[o + i] / cnt[o + i];
      if (s > step) step = s;
    }
    let inner = pool(o, 0, 4);
    if (inner < 0) inner = pool(o, 0, 7);
    let outer = pool(o, 15, 19);
    if (outer < 0) outer = pool(o, 12, 19);
    const rise = outer - inner;
    // Nothing to measure it on counts as an edge; no rise to speak of doesn't.
    crisp[l] = inner < 0 || outer < 0 ? 1 : rise < 6 ? 0 : step / rise;
  }
  return crisp;
}

function satOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  return max > 0 ? (max - Math.min(r, g, b)) / max : 0;
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** How far apart two mean colours are, in units of what differs() calls different. */
function colourGap(cr: number, cg: number, cb: number, qr: number, qg: number, qb: number): number {
  const dh = hueGap(hueOf(cr, cg, cb), hueOf(qr, qg, qb));
  const ds = Math.abs(satOf(cr, cg, cb) - satOf(qr, qg, qb));
  const dv = Math.abs(Math.max(cr, cg, cb) - Math.max(qr, qg, qb)) / 255;
  return dh / 10 + ds / 0.08 + dv / 0.1;
}

/** Whether two mean colours differ in hue, saturation or brightness. */
function differs(cr: number, cg: number, cb: number, qr: number, qg: number, qb: number): boolean {
  const dh = hueGap(hueOf(cr, cg, cb), hueOf(qr, qg, qb));
  const ds = Math.abs(satOf(cr, cg, cb) - satOf(qr, qg, qb));
  const dv = Math.abs(Math.max(cr, cg, cb) - Math.max(qr, qg, qb)) / 255;
  return dh >= 10 || ds >= 0.08 || dv >= 0.1;
}

/**
 * The share of its bounding box that region l of lab fills, counting what it encloses as
 * filled: about 1 for a rectangle (a walled courtyard, with or without a tree in it), 0.785
 * for a disc, less for a ragged crown. q is scratch space.
 */
function boxFill(lab: Int32Array, l: number, w: number, h: number, q: Int32Array): number {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      if (lab[k] !== l) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return 0;
  // Flood what's outside it from the box's edge; the rest of the box is the filled region.
  const bw = x1 - x0 + 1;
  const box = bw * (y1 - y0 + 1);
  const seen = new Uint8Array(box);
  let qn = 0;
  const visit = (x: number, y: number): void => {
    const b = (y - y0) * bw + x - x0;
    if (seen[b] || lab[y * w + x] === l) return;
    seen[b] = 1;
    q[qn++] = b;
  };
  for (let x = x0; x <= x1; x++) {
    visit(x, y0);
    visit(x, y1);
  }
  for (let y = y0; y <= y1; y++) {
    visit(x0, y);
    visit(x1, y);
  }
  for (let i = 0; i < qn; i++) {
    const bx = q[i] % bw;
    const x = x0 + bx;
    const y = y0 + (q[i] - bx) / bw;
    if (x > x0) visit(x - 1, y);
    if (x < x1) visit(x + 1, y);
    if (y > y0) visit(x, y - 1);
    if (y < y1) visit(x, y + 1);
  }
  return (box - qn) / box;
}

/**
 * Per crown (1..n, labelled in lab: the regions of mask, with their areas): the radius of
 * the biggest disc inside it, in chamfer units, and the area of the holes counted as part
 * of it. Holes up to a tenth of the crown (ink or other colours drawn on it, specks of lawn
 * between leaves) count as crown, since how many of the small ones survive depends on how
 * the map was downscaled. A hole belongs to the crown all round it: one on the map's edge,
 * or between two crowns, belongs to neither. inv, hl, stack and d are scratch space.
 */
function inscribed(
  mask: Uint8Array,
  lab: Int32Array,
  n: number,
  area: Float64Array,
  w: number,
  h: number,
  inv: Uint8Array,
  hl: Int32Array,
  stack: Int32Array,
  d: Int32Array,
): { r: Float64Array; holes: Float64Array } {
  const r = new Float64Array(n + 1);
  const holes = new Float64Array(n + 1);
  if (!n) return { r, holes };
  const total = w * h;
  for (let k = 0; k < total; k++) inv[k] = mask[k] ? 0 : 1;
  const nH = label4(inv, w, h, hl, stack);
  const size = new Int32Array(nH + 1);
  // The crown round each hole: 0 none seen yet, -1 the map's edge or more than one.
  const owner = new Int32Array(nH + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      const o = hl[k];
      if (!o) continue;
      size[o]++;
      if (owner[o] < 0) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        owner[o] = -1;
        continue;
      }
      for (let t = 0; t < 4; t++) {
        const l = lab[t === 0 ? k - 1 : t === 1 ? k + 1 : t === 2 ? k - w : k + w];
        if (l && owner[o] !== l) owner[o] = owner[o] ? -1 : l;
      }
    }
  }
  for (let o = 1; o <= nH; o++) {
    const l = owner[o];
    if (l > 0 && size[o] <= Math.max(4, 0.1 * area[l])) holes[l] += size[o];
    else owner[o] = -1;
  }
  for (let k = 0; k < total; k++) inv[k] = mask[k] || owner[hl[k]] > 0 ? 1 : 0;
  distTo(inv, 0, w, h, d);
  for (let k = 0; k < total; k++) {
    const l = lab[k];
    if (l && d[k] > r[l]) r[l] = d[k];
  }
  return { r, holes };
}

/** An Otsu split of a 256-bin histogram: threshold, class mean gap (0-1), dark share. */
interface Split {
  thr: number;
  sep: number;
  dark: number;
}
const NO_SPLIT: Split = { thr: -1, sep: 0, dark: 1 };

function otsu(hist: Float64Array, total: number): Split {
  let all = 0;
  for (let i = 0; i < 256; i++) all += i * hist[i];
  let w0 = 0;
  let s0 = 0;
  let best = -1;
  const out = { thr: -1, sep: 0, dark: 1 };
  for (let t = 0; t < 255; t++) {
    w0 += hist[t];
    s0 += t * hist[t];
    const w1 = total - w0;
    if (w0 === 0 || w1 === 0) continue;
    const m0 = s0 / w0;
    const m1 = (all - s0) / w1;
    const between = w0 * w1 * (m1 - m0) * (m1 - m0);
    if (between > best) {
      best = between;
      out.thr = t;
      out.sep = (m1 - m0) / 255;
      out.dark = w0 / total;
    }
  }
  return out;
}

// ---------------------------------------------------------------- analysis

/** Bytes per analysis pixel in SeasonAnalysis.f. */
const NF = 8;
// Channels of SeasonAnalysis.f.
/** Plant weight: blurred vegetation x (0.3 + 0.7 sky). */
const F_PLANT = 0;
/** Outdoor ground under open sky (sharpened outdoor x not water x sky). */
const F_GROUND = 1;
/** Tree crowns, softened. */
const F_CANOPY = 2;
/** Open sky: plenty of vegetation within 3 squares. */
const F_SKY = 3;
/** Local mean luma over a quarter square. */
const F_LUML = 4;
/** Natural water, softened. */
const F_WATER = 5;
/** Inside water, the distance to the shore in 1/16 square. */
const F_SHORE = 6;
/** Vegetation masses that might be canopy (only when the canopy split is ambiguous). */
const F_MASS = 7;

/**
 * What analyse() finds, at analysis resolution (aw x ah). Only typed arrays and numbers,
 * so it can be posted between threads. About 10 bytes a pixel: 7 MB at 1024 x 683.
 */
export interface SeasonAnalysis {
  aw: number;
  ah: number;
  /** One grid square, in analysis pixels. */
  cellA: number;
  /** 8 bytes a pixel: plant, ground, canopy, sky, local luma, water, shore, mass (see F_*). */
  f: Uint8Array;
  /** The crown each pixel belongs to or is next to (1-based index into crowns; 0 none). */
  lab: Uint16Array;
  /**
   * Per crown: centroid x, y and radius in analysis pixels, and how big (0 a tree, 1 a forest
   * mass, a clump of trees grown together or a hedge).
   */
  crowns: Float32Array;
  nCrowns: number;
  /** The ground under the trees (from what surrounds them), RGB on a coarse grid. */
  under: Uint8Array;
  uw: number;
  uh: number;
  /** Analysis pixels per cell of the under grid. */
  us: number;
  /** Mean of outdoor x open sky: how much of the map is outdoors. */
  frac: number;
  /**
   * 1 when crowns can't be told from grass for sure (a canopy-dominated forest, one big
   * tree, dark vegetation with no luma split): straw, bare earth, cracks, wildflowers and
   * fallen leaves stay off the vegetation.
   */
  amb: number;
}

/**
 * Analyses the map once (per asset and grid): rgba is the map downscaled to aw x ah
 * covering the whole scene, cellA one grid square in those pixels. About 0.15-0.35 s at
 * 1024 px on a desktop.
 */
export function analyse(rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number): SeasonAnalysis {
  const T = colourTable();
  const N = aw * ah;
  const cA = cellA > 1 ? cellA : 1;
  const sq = cA * cA;

  // Per pixel classes from the colour table; luma and brightest channel.
  const veg = new Uint8Array(N);
  const wat = new Uint8Array(N);
  const lum = new Uint8Array(N);
  const grd = new Uint8Array(N);
  const mx = new Uint8Array(N);
  for (let k = 0, o = 0; k < N; k++, o += 4) {
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const li = lutIndex(r, g, b);
    const gd = T[li + 2];
    veg[k] = Math.round((T[li] * gd) / 255);
    wat[k] = Math.round((T[li + 1] * gd) / 255);
    lum[k] = ((299 * r + 587 * g + 114 * b + 500) / 1000) | 0;
    grd[k] = gd;
    mx[k] = r > g ? (r > b ? r : b) : g > b ? g : b;
  }

  const tmp = new Int32Array(N);
  const d = new Int32Array(N);
  const labT = new Int32Array(N);
  const stack = new Int32Array(N);
  const r12 = Math.max(1, Math.round(cA / 12));

  // Keep only regions big enough to be ground: each letter of a label, a gem, a bottle or
  // a banner is its own small region and drops out; grass, crowns and rivers stay.
  const vm = new Uint8Array(N);
  const wm = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    vm[k] = veg[k] > 127 ? 1 : 0;
    wm[k] = wat[k] > 127 ? 1 : 0;
  }
  // The classes softened, in place (the raw ones aren't needed again).
  const vegB = blur8(veg, aw, ah, r12, veg, tmp);
  const watB = blur8(wat, aw, ah, Math.max(1, Math.round(cA / 8)), wat, tmp);
  dropSmall(vm, aw, ah, 0.5 * sq, labT, stack);
  dropSmall(wm, aw, ah, 1.0 * sq, labT, stack);
  distTo(vm, 1, aw, ah, d);
  for (let k = 0; k < N; k++) vegB[k] = Math.round(vegB[k] * (1 - ramp(d[k] / D1, r12, 2 * r12 + 1)));
  distTo(wm, 1, aw, ah, d);
  for (let k = 0; k < N; k++) watB[k] = Math.round(watB[k] * (1 - ramp(d[k] / D1, r12, 2 * r12 + 1)));

  // Outdoor ground: vegetation and water, closed by 0.75 square (gaps narrower than 1.5
  // squares between them are filled: paths, small roofs, props on grass).
  const R = 0.75 * cA;
  const soft = 0.12 * cA;
  const tmpM = new Uint8Array(N);
  for (let k = 0; k < N; k++) tmpM[k] = vm[k] | wm[k];
  distTo(tmpM, 1, aw, ah, d);
  for (let k = 0; k < N; k++) tmpM[k] = d[k] > R * D1 ? 1 : 0;
  distTo(tmpM, 1, aw, ah, d);
  const outdoor = new Uint8Array(N);
  for (let k = 0; k < N; k++) outdoor[k] = Math.round(255 * ramp(d[k] / D1, R - soft, R + soft));
  blur8(outdoor, aw, ah, r12, outdoor, tmp);

  // Open sky: the share of kept vegetation in a 7x7-square box. Water, blue floors and
  // small green things with no real vegetation around them get none.
  for (let k = 0; k < N; k++) tmpM[k] = vm[k] ? 255 : 0;
  const sky = blur8(tmpM, aw, ah, Math.max(1, Math.round(3 * cA)), new Uint8Array(N), tmp);
  for (let k = 0; k < N; k++) sky[k] = Math.round(255 * ramp(sky[k] / 255, SKY_LO, SKY_HI));

  // Inside water, how far to the shore (the map edge isn't a shore: seas stay open).
  distTo(wm, 0, aw, ah, d);
  const shore = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (wm[k]) shore[k] = Math.min(255, Math.round((d[k] / D1 / cA) * 16));

  let acc = 0;
  for (let k = 0; k < N; k++) acc += outdoor[k] * sky[k];
  const frac = N ? acc / (N * 255 * 255) : 0;

  // ---- canopy
  const lumB = blur8(lum, aw, ah, Math.max(1, Math.round(0.3 * cA)), new Uint8Array(N), tmp);
  // An Otsu split of vegetation luma, trusted only when the two classes really differ and
  // the dark one isn't nearly everything (a forest canopy, or one big tree filling the map).
  const hist = new Float64Array(256);
  let nv = 0;
  for (let k = 0; k < N; k++) {
    if (vm[k]) {
      hist[lumB[k]]++;
      nv++;
    }
  }
  const ot = nv >= 2 * sq ? otsu(hist, nv) : NO_SPLIT;
  const thr = ot.thr;
  const sep = ot.sep;
  const darkShare = ot.dark;
  let vv = 0;
  for (let k = 0; k < N; k++) if (vm[k]) vv += mx[k];
  const vegVal = nv ? vv / nv / 255 : 0;
  // How crowns are found:
  // - a reliable luma split: dark crowns in lighter vegetation, plus outlined shapes (and
  //   when the canopy dominates, the lighter vegetation is its lit tops: see below);
  // - no split because the vegetation is one even, bright kind (a lawn or field): outlined
  //   shapes only, and the rest is grass;
  // - otherwise ambiguous: outlined shapes; dark vegetation (a canopy-dominated forest) is
  //   all canopy, anything else left over turns gently in autumn; grass-only overlays off.
  const split = thr >= 0 && sep >= 0.08 && darkShare <= 0.75;
  let amb = nv >= 2 * sq && !split && !(sep < 0.08 && vegVal >= 0.36);

  // Vegetation split at ink: each outlined bush or tree is its own region. A thin outline
  // blurs to mid-grey at analysis size, so "much darker than around it" counts as ink too
  // (a crown's own shaded side is only about 0.85 of its surroundings).
  const lumL = blur8(lum, aw, ah, Math.max(1, Math.round(0.25 * cA)), new Uint8Array(N), tmp);
  const ink = new Uint8Array(N);
  const vs = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const rel = lum[k] * 100 >= lumL[k] * 78;
    ink[k] = mx[k] < DARK || !rel ? 1 : 0;
    vs[k] = vm[k] && mx[k] >= 51 && rel ? 1 : 0;
  }
  // Grain that a sharp downscale keeps (nearest or bilinear, where a box or lanczos filter
  // averages it away) leaves specks that aren't vegetation all over a crown, and each
  // speck's rim would count against the crown's dark outline: they're filled.
  fillPinholes(vs, ink, aw, ah, Math.max(4, 0.03 * sq), tmpM, labT, stack);
  const nVs = label4(vs, aw, ah, labT, stack);
  const rv = regions(labT, nVs, aw, ah, rgba, mx);
  let tr = 0;
  let tg = 0;
  let tb = 0;
  let ta = 0;
  for (let l = 1; l <= nVs; l++) {
    tr += rv.sr[l];
    tg += rv.sg[l];
    tb += rv.sb[l];
    ta += rv.area[l];
  }

  const canM = new Uint8Array(N);
  // Crowns by shape: outlined (ink or a dark rim most of the way round), mostly inside the
  // map, and unlike the rest of the vegetation (a bush on a lawn, one big tree): another hue,
  // saturation or brightness. A scrap of lawn cut off by a river's ink has the lawn's colour
  // and stays grass.
  for (let l = 1; l <= nVs; l++) {
    const area = rv.area[l];
    const a2 = area / sq;
    if (a2 < 0.75 || a2 > 100) continue;
    const per = rv.edge[l];
    if (rv.dark[l] < 0.5 * per || rv.border[l] > 0.2 * per) continue;
    const on = ta - area;
    if (on >= 2 * area) {
      if (!differs(rv.sr[l] / area, rv.sg[l] / area, rv.sb[l] / area, (tr - rv.sr[l]) / on, (tg - rv.sg[l]) / on, (tb - rv.sb[l]) / on)) continue;
    } else {
      // Too little other vegetation to compare with (this is a third of it or more): a lone
      // tree on a plaza, or a walled courtyard, a cloister's lawn, a garden in a hedge? It
      // counts only when it looks like a tree: not filling its box as a plot of lawn does,
      // and over 25 squares, as dark as canopy (no lawn is) or bluer than grass (canopy is
      // painted blue-green, grass yellow-green).
      const cr = rv.sr[l] / area;
      const cg = rv.sg[l] / area;
      const cb = rv.sb[l] / area;
      if (a2 > 25 && Math.max(cr, cg, cb) >= 0.4 * 255 && hueOf(cr, cg, cb) < 110) continue;
      if (boxFill(labT, l, aw, ah, stack) >= 0.85) continue;
    }
    rv.area[l] = -1; // marked: a crown
  }
  // 2 marks a crown found by shape: one object, a single tree however big it is, unless it's
  // lumpy (trees grown into a clump, or a hedge: see the crowns below).
  for (let k = 0; k < N; k++) if (labT[k] && rv.area[labT[k]] < 0) canM[k] = 2;
  // With everything its outline encloses: the ink drawn on it cuts it into pieces.
  fillOutlined(canM, labT, rv, nVs, ink, vm, rgba, aw, ah, r12 + 1, d);

  // Crowns by luma: vegetation darker than t (and within `within`, when given), opened
  // (drops thin bands such as shadows along walls) and closed (fills a crown's lit middle),
  // then judged one by one. Kept ones join canM; returns the pixels of the ones dropped for
  // fading into the lawn, or null.
  const lumaCrowns = (t: number, within: Uint8Array | null): Uint8Array | null => {
    const can0 = new Uint8Array(N);
    for (let k = 0; k < N; k++) can0[k] = vm[k] && lumB[k] <= t && (!within || within[k]) ? 1 : 0;
    const ro = 0.2 * cA;
    const rc = 0.4 * cA;
    erode(can0, ro, aw, ah, d);
    dilate(can0, ro, aw, ah, d);
    dilate(can0, rc, aw, ah, d);
    erode(can0, rc, aw, ah, d);
    for (let k = 0; k < N; k++) if (can0[k] && !vm[k] && vegB[k] <= 51) can0[k] = 0;
    dropSmall(can0, aw, ah, 0.35 * sq, labT, stack);
    const n = label4(can0, aw, ah, labT, stack);
    if (!n) return null;
    const rc0 = regions(labT, n, aw, ah, rgba, mx);
    // The vegetation in a 0.3-square ring around each candidate: a cast shadow is that
    // same grass, only darker (same hue and saturation), and is dropped.
    const near = tmp;
    distLabel(labT, aw, ah, d, near);
    const ringR = 0.3 * cA * D1;
    const rr = new Float64Array(n + 1);
    const rg = new Float64Array(n + 1);
    const rb = new Float64Array(n + 1);
    const rn = new Float64Array(n + 1);
    // And all the vegetation that isn't a candidate: the lawn.
    let lr = 0;
    let lg = 0;
    let lb = 0;
    let la = 0;
    for (let k = 0; k < N; k++) {
      if (can0[k] || !vm[k]) continue;
      lr += rgba[k * 4];
      lg += rgba[k * 4 + 1];
      lb += rgba[k * 4 + 2];
      la++;
      if (d[k] > ringR) continue;
      const l = near[k];
      rr[l] += rgba[k * 4];
      rg[l] += rgba[k * 4 + 1];
      rb[l] += rgba[k * 4 + 2];
      rn[l]++;
    }
    const crisp = edgeCrispness(can0, labT, n, d, near, vm, lum, aw, ah, cA, stack);
    // 1 kept, 2 dropped as a patch that fades into the lawn.
    const keep = new Uint8Array(n + 1);
    let faded = false;
    for (let l = 1; l <= n; l++) {
      const area = rc0.area[l];
      const per = rc0.edge[l];
      const compact = (4 * Math.PI * area) / Math.max(1, per * per);
      if (compact < 0.35 && area < 6 * sq) continue;
      const cr = rc0.sr[l] / area;
      const cg = rc0.sg[l] / area;
      const cb = rc0.sb[l] / area;
      // A big, dark mass is forest canopy, whatever its colour: no lawn is that dark, and a
      // cast shadow isn't that big.
      const canopyMass = area >= 12 * sq && Math.max(cr, cg, cb) < 0.4 * 255;
      if (!canopyMass && rn[l] >= 0.25 * per) {
        const qr = rr[l] / rn[l];
        const qg = rg[l] / rn[l];
        const qb = rb[l] / rn[l];
        if (hueGap(hueOf(cr, cg, cb), hueOf(qr, qg, qb)) <= 6 && Math.abs(satOf(cr, cg, cb) - satOf(qr, qg, qb)) <= 0.06) {
          continue;
        }
      }
      // A darker patch of the lawn itself (same colour, only a little darker) isn't a crown
      // unless something outlines it. The lawn is all the vegetation that isn't a candidate,
      // compared whenever there are a couple of squares of it: when the split cuts through a
      // lawn's own light and dark patches, the dark half can outweigh the light one.
      if (!canopyMass && rc0.dark[l] < 0.5 * per && la >= 2 * sq) {
        const qr = lr / la;
        const qg = lg / la;
        const qb = lb / la;
        if (!differs(cr, cg, cb, qr, qg, qb)) continue;
        // Nor is a patch that fades into the lawn, where it's only somewhat another green:
        // a tree's crown has an edge. (Lawns are painted with soft light and dark patches,
        // bluer in the shade, and those land right on the split; one may hold a tree.)
        const lawnish =
          hueGap(hueOf(cr, cg, cb), hueOf(qr, qg, qb)) < 25 &&
          Math.abs(satOf(cr, cg, cb) - satOf(qr, qg, qb)) < 0.12 &&
          Math.abs(Math.max(cr, cg, cb) - Math.max(qr, qg, qb)) < 0.2 * 255;
        if (lawnish && crisp[l] < SOFT) {
          keep[l] = 2;
          faded = true;
          continue;
        }
      }
      keep[l] = 1;
    }
    for (let k = 0; k < N; k++) if (keep[labT[k]] === 1 && !canM[k]) canM[k] = 1;
    if (!faded) return null;
    const out = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (keep[labT[k]] === 2) out[k] = 1;
    return out;
  };
  if (split) {
    const faded = lumaCrowns(thr, null);
    if (faded) {
      // A tree standing in the shade it casts: the dark patch holds a darker core. Split
      // the patches' own luma, and look for crowns among their darker part.
      const h2 = new Float64Array(256);
      let n2 = 0;
      for (let k = 0; k < N; k++) {
        if (faded[k] && vm[k]) {
          h2[lumB[k]]++;
          n2++;
        }
      }
      const s2 = n2 >= 2 * sq ? otsu(h2, n2) : NO_SPLIT;
      if (s2.thr >= 0 && s2.sep >= 0.08 && s2.dark <= 0.75) lumaCrowns(s2.thr, faded);
    }
  }

  // A canopy-dominated forest: the lighter vegetation is the lit tops of the same crowns
  // (nearly all of it within a square of the canopy), not a lawn, so it joins the canopy;
  // with no split, dark vegetation is canopy all over. Grass-only overlays go off for
  // whatever is left, as the design's ambiguous mode.
  let forest = false;
  if (nv >= 2 * sq) {
    if (split) {
      distTo(canM, 1, aw, ah, d);
      let nCan = 0;
      let nLight = 0;
      let nNear = 0;
      for (let k = 0; k < N; k++) {
        if (!vm[k]) continue;
        if (canM[k]) nCan++;
        else {
          nLight++;
          if (d[k] <= cA * D1) nNear++;
        }
      }
      forest = nCan >= 0.35 * nv && nNear >= 0.6 * nLight;
    } else {
      forest = amb && vegVal < 0.42;
    }
  }
  if (forest) {
    amb = true;
    for (let k = 0; k < N; k++) if (vm[k] && !canM[k] && (!split || d[k] <= cA * D1)) canM[k] = 1;
  }

  // Final crowns: one label each, with centroid and size (autumn colours whole trees).
  const nC0 = label4(canM, aw, ah, labT, stack);
  const rcf = regions(labT, nC0, aw, ah, rgba, mx);
  const nCrowns = Math.min(nC0, 65535);
  const byShape = new Float64Array(nC0 + 1);
  for (let k = 0; k < N; k++) if (canM[k] === 2) byShape[labT[k]]++;
  const inner = inscribed(canM, labT, nC0, rcf.area, aw, ah, tmpM, tmp, stack, d);
  const crowns = new Float32Array(nCrowns * 4);
  for (let l = 1; l <= nCrowns; l++) {
    const area = rcf.area[l];
    crowns[(l - 1) * 4] = rcf.sx[l] / area;
    crowns[(l - 1) * 4 + 1] = rcf.sy[l] / area;
    crowns[(l - 1) * 4 + 2] = Math.sqrt(area / Math.PI);
    // Dark canopy found by luma over 9-25 squares is merged trees (a forest mass); an
    // outlined shape is one tree up to far bigger. And an outlined crown much bigger than the
    // disc inside it is no one tree, whatever its size: trees grown together into a clump, or
    // a hedge. It varies as a mass does (each tree's lean, rim and branches would all be the
    // clump's, from its middle). Not for crowns found by luma: those are often only a tree's
    // shaded side, a crescent, which is lumpy without being a clump.
    const ri = Math.max(1, inner.r[l] / D1);
    const lumpy = ramp((area + inner.holes[l]) / (Math.PI * ri * ri), 1.45, 1.75);
    const size = byShape[l] >= 0.5 * area ? ramp(area / sq, 60, 120) : ramp(area / sq, 9, 25);
    crowns[(l - 1) * 4 + 3] = byShape[l] >= 0.5 * area ? Math.max(size, lumpy) : size;
  }
  for (let k = 0; k < N; k++) if (labT[k] > nCrowns) canM[k] = 0;
  // Each pixel near a crown knows it (softened crown edges reach a little outside).
  const lab = new Uint16Array(N);
  distLabel(labT, aw, ah, d, stack);
  const labR = (2 * r12 + 2) * D1;
  for (let k = 0; k < N; k++) {
    const l = stack[k];
    if (l && l <= nCrowns && d[k] <= labR) lab[k] = l;
  }

  // Masses: when ambiguous and not a forest, the rest of the vegetation may be canopy or
  // lawn. Autumn turns it whole but gently; grass-only overlays stay off there.
  const mass = new Uint8Array(N);
  if (amb && !forest) {
    for (let k = 0; k < N; k++) mass[k] = vs[k] && !canM[k] ? 1 : 0;
    dropSmall(mass, aw, ah, 0.5 * sq, labT, stack);
    for (let k = 0; k < N; k++) mass[k] = mass[k] ? 255 : 0;
    blur8(mass, aw, ah, r12, mass, tmp);
  }

  for (let k = 0; k < N; k++) tmpM[k] = canM[k] ? 255 : 0;
  const canopy = blur8(tmpM, aw, ah, r12, new Uint8Array(N), tmp);

  const f = new Uint8Array(N * NF);
  for (let k = 0, b = 0; k < N; k++, b += NF) {
    const s = sky[k] * INV255;
    f[b + F_PLANT] = Math.round(vegB[k] * (INDOOR + (1 - INDOOR) * s));
    f[b + F_GROUND] = Math.round(255 * ramp(outdoor[k] * INV255, OUT_LO, OUT_HI) * (1 - watB[k] * INV255) * s);
    f[b + F_CANOPY] = canopy[k];
    f[b + F_SKY] = sky[k];
    f[b + F_LUML] = lumL[k];
    f[b + F_WATER] = watB[k];
    f[b + F_SHORE] = shore[k];
    f[b + F_MASS] = mass[k];
  }

  // The ground under the trees, for the gaps autumn opens in crowns: the mean colour of
  // what isn't crown or water within 1.5 squares (5 as a fallback, then forest floor).
  const us = Math.max(2, Math.round(cA / 4));
  const uw = Math.ceil(aw / us);
  const uh = Math.ceil(ah / us);
  const U = uw * uh;
  const s1 = [new Float64Array(U), new Float64Array(U), new Float64Array(U), new Float64Array(U)];
  for (let y = 0; y < ah; y++) {
    const cy = ((y / us) | 0) * uw;
    for (let x = 0, k = y * aw; x < aw; x++, k++) {
      if (grd[k] < 128 || canM[k] || wm[k] || lum[k] < 38) continue;
      const c = cy + ((x / us) | 0);
      s1[0][c] += rgba[k * 4];
      s1[1][c] += rgba[k * 4 + 1];
      s1[2][c] += rgba[k * 4 + 2];
      s1[3][c]++;
    }
  }
  const s2 = s1.map((a) => new Float64Array(a));
  for (const a of s1) blurF(a, uw, uh, Math.max(1, Math.round((1.5 * cA) / us)));
  for (const a of s2) blurF(a, uw, uh, Math.max(1, Math.round((5 * cA) / us)));
  const under = new Uint8Array(U * 3);
  const per = us * us;
  const FLOOR = [92, 74, 52];
  for (let c = 0; c < U; c++) {
    const n1 = s1[3][c];
    const n2 = s2[3][c];
    const k1 = clamp01(n1 / (0.05 * per));
    const k2 = clamp01(n2 / (0.02 * per));
    for (let ch = 0; ch < 3; ch++) {
      const c1 = n1 > 0 ? s1[ch][c] / n1 : 0;
      const c2 = n2 > 0 ? s2[ch][c] / n2 : 0;
      const far = c2 * k2 + FLOOR[ch] * (1 - k2);
      under[c * 3 + ch] = Math.round(c1 * k1 + far * (1 - k1));
    }
  }

  return { aw, ah, cellA, f, lab, crowns, nCrowns, under, uw, uh, us, frac, amb: amb ? 1 : 0 };
}

/** How much of the map is open-sky outdoors (below about 0.04 it's an indoor map). */
export function outdoorFraction(a: SeasonAnalysis): number {
  return a.frac;
}

// ---------------------------------------------------------------- per-look fields

// The smooth, look-specific parts (drift noise, ice, per-tree colour, dryness) are worked
// out once per look, level and seed at analysis resolution, so the full-resolution kernel
// only interpolates them. Channel 0 is always "anything to do here".
interface LookFields {
  key: string;
  lc: number;
  data: Uint8Array;
}

const fieldCache = new WeakMap<SeasonAnalysis, LookFields>();

// Look channels.
const L_ACT = 0;
// winter
const L_SNOW = 1;
const L_ICE = 2;
const L_FINE = 3;
// autumn
const L_TURN = 1;
const L_HUE = 2;
const L_THIN = 3;
// spring
const L_BLOOM = 1;
// summer
const L_DRY = 1;

/**
 * The fields for these options, kept with the analysis until another look, level, seed or
 * grid asks for different ones (one set at a time: up to 2.8 MB at 1024 x 683). Rebuilding
 * costs 10-70 ms, once per change of look; every strip of a bake reuses them.
 */
function lookFields(o: BakeOptions): LookFields {
  const a = o.a;
  const key = `${o.look}|${o.level}|${o.seed | 0}|${o.cell}|${o.sceneW}|${o.sceneH}`;
  const hit = fieldCache.get(a);
  if (hit && hit.key === key) return hit;
  const lf = buildFields(o, key);
  fieldCache.set(a, lf);
  return lf;
}

function buildFields(o: BakeOptions, key: string): LookFields {
  const a = o.a;
  const L = o.level - 1;
  const seed = o.seed | 0;
  const aw = a.aw;
  const ah = a.ah;
  const F = a.f;
  const toU = o.sceneW / (aw * o.cell);
  const toW = o.sceneH / (ah * o.cell);
  const lc = o.look === "winter" || o.look === "autumn" ? 4 : 2;
  const data = new Uint8Array(aw * ah * lc);
  const crowns = a.crowns;
  const lab = a.lab;
  if (o.look === "winter") {
    const W = SEASON_PARAMS.winter;
    const cover = W.cover[L];
    const ice = W.ice[L];
    const snowN = new Fbm(0.75, mix(seed, 1));
    const fineN = new Octave(2.4, 1, mix(seed, 2));
    const iceN = new Fbm(0.7, mix(seed, 3));
    for (let y = 0; y < ah; y++) {
      const w = (y + 0.5) * toW;
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const u = (x + 0.5) * toU;
        const b = k * NF;
        const o4 = k * lc;
        const plant = F[b + F_PLANT];
        const ground = F[b + F_GROUND];
        const water = F[b + F_WATER];
        const act = Math.max(plant, ground, water);
        data[o4 + L_ACT] = act;
        if (!act) continue;
        if (ground && cover > 0) data[o4 + L_SNOW] = Math.round((cover - rank(RANK_FBM, snowN.at(u, w)) + 1) * 127.5);
        if (ground || (plant && F[b + F_CANOPY])) data[o4 + L_FINE] = Math.round(255 * fineN.at(u, w));
        const sky = F[b + F_SKY];
        if (ice && water && sky) {
          const wB = water * INV255;
          const rim =
            ice === 2
              ? 1 - ramp(F[b + F_SHORE] / 16, FREEZE_LO, FREEZE_HI)
              : (1 - ramp(wB, 0.55, 0.85)) * ramp(0.75 - iceN.at(u, w) * 0.6, 0.2, 0.3);
          data[o4 + L_ICE] = Math.round(255 * wB * sky * INV255 * rim);
        }
      }
    }
  } else if (o.look === "autumn") {
    // The coarse octaves of three independent mottles: which leaves have turned, what
    // colour they turned (so a red patch can sit straight on green, with no yellow ring
    // round it), and which have fallen. The fine octaves are added per pixel.
    const turnN = new Octave(1.7, 0, mix(seed, 21));
    const hueN = new Octave(1.8, 1, mix(seed, 22));
    const thinN = new Octave(2.2, 3, mix(seed, 24));
    for (let y = 0; y < ah; y++) {
      const w = (y + 0.5) * toW;
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const u = (x + 0.5) * toU;
        const b = k * NF;
        const o4 = k * lc;
        const act = Math.max(F[b + F_PLANT], F[b + F_GROUND], F[b + F_WATER], F[b + F_MASS]);
        data[o4 + L_ACT] = act;
        if (!act || !(F[b + F_CANOPY] || F[b + F_MASS])) continue;
        data[o4 + L_TURN] = Math.round(255 * rank(RANK_OCTAVE, turnN.at(u, w)));
        data[o4 + L_HUE] = Math.round(255 * rank(RANK_OCTAVE, hueN.at(u, w)));
        data[o4 + L_THIN] = Math.round(255 * rank(RANK_OCTAVE, thinN.at(u, w)));
      }
    }
  } else if (o.look === "spring") {
    const share = SEASON_PARAMS.spring.bloomCrowns[L];
    const tN = new Octave(0.55, 1, mix(seed, 31));
    for (let y = 0; y < ah; y++) {
      const w = (y + 0.5) * toW;
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const u = (x + 0.5) * toU;
        const b = k * NF;
        const act = F[b + F_PLANT];
        data[k * lc + L_ACT] = act;
        if (!act || !F[b + F_CANOPY]) continue;
        const l = lab[k];
        let pu = u;
        let pw = w;
        if (l) {
          const c = (l - 1) * 4;
          const cu = crowns[c] * toU;
          const cw = crowns[c + 1] * toW;
          const big = crowns[c + 3];
          pu = cu + (u - cu) * big;
          pw = cw + (w - cw) * big;
        }
        data[k * lc + L_BLOOM] = Math.round(255 * ramp(share - rank(RANK_OCTAVE, tN.at(pu, pw)), -0.05, 0.05));
      }
    }
  } else {
    const dryN = new Fbm(0.5, mix(seed, 41));
    for (let y = 0; y < ah; y++) {
      const w = (y + 0.5) * toW;
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const u = (x + 0.5) * toU;
        const b = k * NF;
        const act = Math.max(F[b + F_PLANT], F[b + F_WATER]);
        data[k * lc + L_ACT] = act;
        if (F[b + F_PLANT]) data[k * lc + L_DRY] = Math.round(255 * rank(RANK_FBM, dryN.at(u, w)));
      }
    }
  }
  return { key, lc, data };
}

// ---------------------------------------------------------------- bake

export interface BakeOptions {
  /**
   * Scene position of the strip's top-left corner. Pixel (i, j) of the strip is scene point
   * (x0 + (i + 0.5) * scale, y0 + (j + 0.5) * scale), so a strip that starts n rows (or
   * columns) into a bake must start at n * scale for its bytes to match a whole pass.
   */
  x0: number;
  y0: number;
  /** Scene pixels per strip pixel, the same across and down. */
  scale: number;
  /** Grid square in scene pixels. */
  cell: number;
  /** Noise seed: season.seed, or seedFrom(scene.id). */
  seed: number;
  look: SeasonLook;
  level: 1 | 2 | 3;
  a: SeasonAnalysis;
  sceneW: number;
  sceneH: number;
}

// Row buffer slots: the analysis channels the kernels read, then the look channels.
const ACH = [F_PLANT, F_GROUND, F_CANOPY, F_SKY, F_LUML, F_WATER, F_MASS];
const S_PLANT = 0;
const S_GROUND = 1;
const S_CANOPY = 2;
const S_SKY = 3;
const S_LUML = 4;
const S_WATER = 5;
const S_MASS = 6;
const S_LOOK = 7;

/** Scene positions are snapped to 1/256 pixel, so a strip and a whole pass compute the same. */
function snap(v: number): number {
  return Math.round(v * 256) / 256;
}

/**
 * The fields for one strip: per column where to read, and per row the two analysis rows
 * blended once into rb, so each pixel only blends two neighbours per channel.
 */
class Frame {
  a: SeasonAnalysis;
  lf: LookFields;
  C: number;
  rb: Float64Array;
  colI: Int32Array;
  colF: Float64Array;
  colU: Float64Array;
  colX: Float64Array;
  colQ: Int32Array;
  ix0: number;
  ix1: number;
  y0: number;
  scale: number;
  ky: number;
  inv: number;
  mapK: number;
  seed: number;
  /** The row just prepared: scene y, squares, nearest analysis row start. */
  sy = 0;
  w = 0;
  rowQ = 0;
  lastIy = -1;
  lastFy = -1;

  constructor(o: BakeOptions, width: number, lf: LookFields) {
    const a = o.a;
    this.a = a;
    this.lf = lf;
    this.C = S_LOOK + lf.lc;
    this.y0 = o.y0;
    this.scale = o.scale;
    this.ky = a.ah / o.sceneH;
    this.inv = 1 / o.cell;
    this.seed = o.seed | 0;
    this.mapK = 0.3 + 0.7 * ramp(a.frac, 0.04, 0.35);
    const kx = a.aw / o.sceneW;
    const aw = a.aw;
    this.colI = new Int32Array(width);
    this.colF = new Float64Array(width);
    this.colU = new Float64Array(width);
    this.colX = new Float64Array(width);
    this.colQ = new Int32Array(width);
    let ix0 = aw;
    let ix1 = 0;
    const ixs = new Int32Array(width);
    for (let i = 0; i < width; i++) {
      const sx = snap(o.x0 + (i + 0.5) * o.scale);
      this.colX[i] = sx;
      this.colU[i] = sx * this.inv;
      let x = sx * kx - 0.5;
      if (x < 0) x = 0;
      else if (x > aw - 1) x = aw - 1;
      let ix = Math.floor(x);
      if (ix > aw - 2) ix = aw > 1 ? aw - 2 : 0;
      ixs[i] = ix;
      this.colF[i] = aw > 1 ? x - ix : 0;
      const q = Math.floor(sx * kx);
      this.colQ[i] = q < 0 ? 0 : q > aw - 1 ? aw - 1 : q;
      if (ix < ix0) ix0 = ix;
      if (ix + 1 > ix1) ix1 = ix + 1;
    }
    if (width === 0) ix0 = ix1 = 0;
    this.ix0 = ix0;
    this.ix1 = ix1;
    for (let i = 0; i < width; i++) this.colI[i] = (ixs[i] - ix0) * this.C;
    this.rb = new Float64Array((ix1 - ix0 + 1) * this.C);
  }

  /** Prepares row j of the strip. */
  row(j: number): void {
    const a = this.a;
    const aw = a.aw;
    const ah = a.ah;
    const sy = snap(this.y0 + (j + 0.5) * this.scale);
    this.sy = sy;
    this.w = sy * this.inv;
    const q = Math.floor(sy * this.ky);
    this.rowQ = (q < 0 ? 0 : q > ah - 1 ? ah - 1 : q) * aw;
    let y = sy * this.ky - 0.5;
    if (y < 0) y = 0;
    else if (y > ah - 1) y = ah - 1;
    let iy = Math.floor(y);
    if (iy > ah - 2) iy = ah > 1 ? ah - 2 : 0;
    const fy = ah > 1 ? y - iy : 0;
    if (iy === this.lastIy && fy === this.lastFy) return;
    this.lastIy = iy;
    this.lastFy = fy;
    const iy1 = ah > 1 ? iy + 1 : iy;
    const F = a.f;
    const D = this.lf.data;
    const lc = this.lf.lc;
    const C = this.C;
    const rb = this.rb;
    for (let c = this.ix0, o = 0; c <= this.ix1; c++, o += C) {
      const cc = c < aw ? c : aw - 1;
      const k0 = iy * aw + cc;
      const k1 = iy1 * aw + cc;
      const b0 = k0 * NF;
      const b1 = k1 * NF;
      for (let s = 0; s < S_LOOK; s++) {
        const ch = ACH[s];
        const v0 = F[b0 + ch];
        rb[o + s] = (v0 + (F[b1 + ch] - v0) * fy) * INV255;
      }
      const d0 = k0 * lc;
      const d1 = k1 * lc;
      for (let s = 0; s < lc; s++) {
        const v0 = D[d0 + s];
        rb[o + S_LOOK + s] = (v0 + (D[d1 + s] - v0) * fy) * INV255;
      }
    }
  }

  /** The ground under the crowns at scene point (sx, sy), into UNDER. */
  under(sx: number, sy: number, sceneW: number, sceneH: number): void {
    const a = this.a;
    let x = (sx * a.aw) / (sceneW * a.us) - 0.5;
    let y = (sy * a.ah) / (sceneH * a.us) - 0.5;
    if (x < 0) x = 0;
    else if (x > a.uw - 1) x = a.uw - 1;
    if (y < 0) y = 0;
    else if (y > a.uh - 1) y = a.uh - 1;
    const ix = Math.min(Math.floor(x), Math.max(0, a.uw - 2));
    const iy = Math.min(Math.floor(y), Math.max(0, a.uh - 2));
    const fx = x - ix;
    const fy = y - iy;
    const ix1 = a.uw > 1 ? ix + 1 : ix;
    const iy1 = a.uh > 1 ? iy + 1 : iy;
    const U = a.under;
    for (let ch = 0; ch < 3; ch++) {
      const p00 = U[(iy * a.uw + ix) * 3 + ch];
      const p10 = U[(iy * a.uw + ix1) * 3 + ch];
      const p01 = U[(iy1 * a.uw + ix) * 3 + ch];
      const p11 = U[(iy1 * a.uw + ix1) * 3 + ch];
      const t = p00 + (p10 - p00) * fx;
      UNDER[ch] = t + (p01 + (p11 - p01) * fx - t) * fy;
    }
  }
}

const UNDER = new Float64Array(3);

/**
 * Recolours in place a strip of rgba (width x rows) whose top-left is scene point (x0, y0),
 * each pixel covering `scale` scene pixels. Never touches alpha. Pixels the guard protects
 * (ink, deep shadow, lava and fire, near-white labels) keep their exact bytes. The result
 * depends only on the pixel's colour, its scene position and the options, so strips,
 * rectangles and a whole pass agree byte for byte, on every device.
 */
export function bake(rgba: Uint8ClampedArray, width: number, rows: number, opts: BakeOptions): void {
  if (width <= 0 || rows <= 0 || opts.a.aw <= 0 || opts.a.ah <= 0) return;
  // Nonsense geometry leaves the map as drawn rather than writing NaN into it.
  if (!(opts.cell > 0 && opts.scale > 0 && opts.sceneW > 0 && opts.sceneH > 0)) return;
  const lf = lookFields(opts);
  const fr = new Frame(opts, width, lf);
  const L = opts.level - 1;
  if (opts.look === "winter") bakeWinter(rgba, width, rows, fr, L);
  else if (opts.look === "autumn") bakeAutumn(rgba, width, rows, fr, L, opts);
  else if (opts.look === "spring") bakeSpring(rgba, width, rows, fr, L);
  else bakeSummer(rgba, width, rows, fr, L);
}

/** FNV-1a of a scene id, folded to 0-65535 like a stored season seed. */
export function seedFrom(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return ((h >>> 16) ^ h) & 0xffff;
}

// ---------------------------------------------------------------- winter

function bakeWinter(px: Uint8ClampedArray, width: number, rows: number, fr: Frame, L: number): void {
  const W = SEASON_PARAMS.winter;
  const gradeK = W.grade[L] * fr.mapK;
  const dormant = W.dormant[L];
  const frost = W.frost[L];
  const cover = W.cover[L];
  const cs = W.crownSnow[L];
  const ice = W.ice[L];
  const litLo = 0.02 - 0.08 * cs;
  const litHi = 0.1 - 0.08 * cs;
  const crackN = new Octave(1.6, 2, mix(fr.seed, 4));
  const T = colourTable();
  const rb = fr.rb;
  const C = fr.C;
  const colI = fr.colI;
  const colF = fr.colF;
  const colU = fr.colU;
  const ACT = S_LOOK + L_ACT;
  const SNOW = S_LOOK + L_SNOW;
  const ICE = S_LOOK + L_ICE;
  const FINE = S_LOOK + L_FINE;
  for (let j = 0; j < rows; j++) {
    fr.row(j);
    const w = fr.w;
    for (let i = 0, o = j * width * 4; i < width; i++, o += 4) {
      const r = px[o];
      const g = px[o + 1];
      const b = px[o + 2];
      const li = lutIndex(r, g, b);
      const gq = T[li + 2];
      if (gq === 0) continue;
      const gd = gq * INV255;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) * INV255;
      const l255 = lum * 255;
      const c = colI[i];
      const fx = colF[i];
      const sky = rb[c + S_SKY] + (rb[c + C + S_SKY] - rb[c + S_SKY]) * fx;
      // A cold grade toward the pixel's own grey, with a blue lift. The grade is daylight:
      // weaker under a roof or underground.
      const gk = gradeK * gd * (0.6 + 0.4 * sky);
      let nr = r + (l255 - r) * gk;
      let ng = g + (l255 - g) * gk;
      let nb = b + (l255 - b) * gk;
      nb += (255 - nb) * gk * 0.18;
      nr *= 1 - gk * 0.08;
      const act = rb[c + ACT] + (rb[c + C + ACT] - rb[c + ACT]) * fx;
      if (act > 0) {
        const plant0 = rb[c + S_PLANT] + (rb[c + C + S_PLANT] - rb[c + S_PLANT]) * fx;
        const ground0 = rb[c + S_GROUND] + (rb[c + C + S_GROUND] - rb[c + S_GROUND]) * fx;
        const can = rb[c + S_CANOPY] + (rb[c + C + S_CANOPY] - rb[c + S_CANOPY]) * fx;
        const lumL = rb[c + S_LUML] + (rb[c + C + S_LUML] - rb[c + S_LUML]) * fx;
        const plant = plant0 * gd * (0.35 + 0.65 * T[li] * INV255);
        const ground = ground0 * gd;
        const dz = plant * dormant * (1 - 0.5 * can);
        if (dz > 0) {
          nr += (l255 - nr) * dz;
          ng += (l255 - ng) * dz;
          nb += (l255 - nb) * dz;
        }
        const fz = ground * frost * (1 - 0.6 * can);
        if (fz > 0) {
          nr += (228 - nr) * fz;
          ng += (234 - ng) * fz;
          nb += (244 - nb) * fz;
        }
        const crowned = can > 0 && plant > 0;
        if (ground > 0 || crowned) {
          const fine = rb[c + FINE] + (rb[c + C + FINE] - rb[c + FINE]) * fx;
          const rel = lum - lumL;
          let snow = 0;
          if (cover > 0 && ground > 0) {
            const arg = (rb[c + SNOW] + (rb[c + C + SNOW] - rb[c + SNOW]) * fx) * 2 - 1;
            // Drifts over the ground, stopping at wall outlines and grid lines.
            snow = ground * (1 - can) * ramp(arg - 0.08 * (fine - 0.5), -0.05, 0.05) * ramp(rel, INK_LO, INK_HI);
          }
          if (crowned) {
            const lit = ramp(rel + 0.06 * (fine - 0.5), litLo, litHi);
            const onCrown = can * plant * sky * cs * lit * 1.1;
            if (onCrown > snow) snow = onCrown;
          }
          if (snow > 0) {
            if (snow > 1) snow = 1;
            // Snow keeps the relief of what's under it.
            let t = 0.93 + 1.3 * rel;
            t = t < 0.62 ? 0.62 : t > 1 ? 1 : t;
            nr += (244 * t - nr) * snow;
            ng += (247 * t - ng) * snow;
            nb += (252 * t + (1 - t) * 40 - nb) * snow;
          }
        }
        const wat = rb[c + S_WATER] + (rb[c + C + S_WATER] - rb[c + S_WATER]) * fx;
        if (wat > 0) {
          const cool = wat * gd * 0.2 * (INDOOR + (1 - INDOOR) * sky);
          nr += (lum * 205 - nr) * cool;
          ng += (lum * 220 - ng) * cool;
          if (ice) {
            const fzI = (rb[c + ICE] + (rb[c + C + ICE] - rb[c + ICE]) * fx) * gd;
            if (fzI > 0) {
              const iv = 0.86 + 0.25 * (lum - lumL);
              let iR = 196 * iv + 30;
              let iG = 220 * iv + 22;
              let iB = 236 * iv + 18;
              if (ice === 2) {
                const cv = Math.abs(crackN.at(colU[i], w) - 0.5);
                if (cv < 0.012) {
                  const k = 1 - cv / 0.012;
                  iR -= 80 * k;
                  iG -= 60 * k;
                  iB -= 36 * k;
                }
              }
              nr += (iR - nr) * fzI;
              ng += (iG - ng) * fzI;
              nb += (iB - nb) * fzI;
            }
          }
        }
      }
      px[o] = nr;
      px[o + 1] = ng;
      px[o + 2] = nb;
    }
  }
}

// ---------------------------------------------------------------- autumn

/**
 * The colours turned leaves take, along a position p (0-1) that a mottle noise gives each
 * patch: yellows, then ambers and oranges, then reds, then (late) withered brown, in the
 * level's shares of the turned part. Unit RGB at full value; the pixel's own shading
 * scales it. "Mild" is for vegetation that might be a lawn: golds and ambers, never red.
 */
const paletteCache = new Map<string, Float64Array>();
function turnedPalette(L: number, mild: boolean): Float64Array {
  const key = `${L}${mild ? "m" : ""}`;
  const hit = paletteCache.get(key);
  if (hit) return hit;
  const A = SEASON_PARAMS.autumn;
  const turned = 1 - A.green[L];
  let y = A.yellow[L] / turned;
  let o = A.orange[L] / turned;
  let r = A.red[L] / turned;
  if (mild) {
    y = 0.65;
    o = 0.35;
    r = 0;
  }
  const raw = new Float64Array(256 * 3);
  for (let j = 0; j < 256; j++) {
    const p = (j + 0.5) / 256;
    let h = 24;
    let s = 0.5;
    let v = 0.68;
    if (p < y) {
      // Early in the season the yellows are still limey; later they're deep gold.
      const t = p / y;
      h = 60 - 5 * L - (12 - 2 * L) * t;
      s = 0.6 + 0.04 * L + 0.06 * t;
      v = 1;
    } else if (p < y + o) {
      h = 34 - (12 * (p - y)) / o;
      s = 0.76;
      v = 0.97;
    } else if (p < y + o + r) {
      h = 12 - (9 * (p - y - o)) / r;
      s = 0.74;
      v = 0.86;
    }
    hsv(h, s, v);
    raw[j * 3] = HSV_OUT[0] * INV255;
    raw[j * 3 + 1] = HSV_OUT[1] * INV255;
    raw[j * 3 + 2] = HSV_OUT[2] * INV255;
  }
  // Band edges softened a little, so neighbouring patches blend like leaves do.
  const out = new Float64Array(257 * 3);
  for (let j = 0; j < 256; j++) {
    for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let t = -2; t <= 2; t++) {
        const jj = j + t < 0 ? 0 : j + t > 255 ? 255 : j + t;
        s += raw[jj * 3 + ch];
      }
      out[j * 3 + ch] = s / 5;
    }
  }
  for (let ch = 0; ch < 3; ch++) out[256 * 3 + ch] = out[255 * 3 + ch];
  paletteCache.set(key, out);
  return out;
}

const LEAF_COLOURS = [
  [184, 62, 30],
  [212, 112, 34],
  [222, 164, 50],
  [196, 178, 66],
  [150, 42, 28],
  [128, 78, 40],
];

/** Bare branches in a crown's gaps: limbs from the centre, forking toward the rim. */
function branchAlpha(du: number, dw: number, rs: number, rot: number, tree: number, px: number): number {
  const r = Math.sqrt(du * du + dw * dw);
  const rn = r / rs;
  if (rn >= 0.97) return 0;
  const ad = Math.abs(du) + Math.abs(dw);
  if (ad <= 0) return 1;
  // A diamond angle (0-4 round the circle): no atan2, so the same on every device.
  const pa = dw >= 0 ? (du >= 0 ? dw / ad : 2 - dw / ad) : du < 0 ? 2 - dw / ad : 4 + dw / ad;
  let best = 0;
  // Six limbs, twelve branches beyond a third of the radius, 24 twigs beyond 0.55.
  for (let gen = 0; gen < 3; gen++) {
    if (gen === 1 && rn < 0.3) break;
    if (gen === 2 && rn < 0.55) break;
    const K = gen === 0 ? 6 : gen === 1 ? 12 : 24;
    const pos = pa * (K / 4) + rot * (gen + 1) + 0.35 * rn * (gen === 1 ? -1 : 1);
    const idx = Math.floor(pos);
    // Each branch is jittered a little; check the two nearest.
    for (let t = 0; t < 2; t++) {
      const bi = idx + t;
      const jit = (hash2(((bi % K) + K) % K, tree + gen * 7919, 0x5eed) - 0.5) * 0.5;
      const fr = pos - (bi - 0.5 + jit);
      const lat = Math.abs(fr) * (4 / K) * r * 1.3;
      const wid = gen === 0 ? 0.045 * (1 - 0.7 * rn) : gen === 1 ? 0.022 * (1 - 0.5 * rn) : 0.009;
      // Twigs are fainter: at the rim they would otherwise read as hatching.
      const al = ramp(wid - lat, -px, px) * (gen === 2 ? 0.6 : 1);
      if (al > best) best = al;
    }
  }
  return best;
}

function bakeAutumn(px: Uint8ClampedArray, width: number, rows: number, fr: Frame, L: number, o: BakeOptions): void {
  const A = SEASON_PARAMS.autumn;
  const a = fr.a;
  const gradeK = A.grade[L] * fr.mapK;
  const green = A.green[L];
  const greenMild = Math.min(0.85, green + 0.3);
  const straw = a.amb ? 0 : A.straw[L];
  const leaves = A.leaves[L];
  const thin = A.thin[L];
  const pal = turnedPalette(L, false);
  const palM = turnedPalette(L, true);
  const greenShift = 0.08 + 0.05 * L;
  // Fine mottles, per pixel: which leaves turned (v0), their colour (v1), which fell (v2).
  const fine = new Octave3(5.2, 2, mix(fr.seed, 25));
  const treeBias = new Octave(0.55, 1, mix(fr.seed, 122));
  const treeWarm = new Octave(0.55, 2, mix(fr.seed, 123));
  const leafN = new Leaves(mix(fr.seed, 27));
  const litter1 = new Leaves(mix(fr.seed, 28));
  const litter2 = new Leaves(mix(fr.seed, 30));
  const T = colourTable();
  const rb = fr.rb;
  const C = fr.C;
  const colI = fr.colI;
  const colF = fr.colF;
  const colU = fr.colU;
  const colX = fr.colX;
  const colQ = fr.colQ;
  const lab = a.lab;
  const crowns = a.crowns;
  const toU = o.sceneW / (a.aw * o.cell);
  const toW = o.sceneH / (a.ah * o.cell);
  // Half a strip pixel, in squares: branch edges are antialiased over it.
  const halfPx = (0.5 * o.scale) / o.cell;
  const strawHue = 46 - L * 6;
  const strawVal = 1.02 - L * 0.04;
  const ACT = S_LOOK + L_ACT;
  const TURN = S_LOOK + L_TURN;
  const HUE = S_LOOK + L_HUE;
  const THIN = S_LOOK + L_THIN;
  // The crown whose lean (bias, warm) was worked out last; -1 none.
  let leanOf = -1;
  let bias = 0.5;
  let warm = 0.5;
  for (let j = 0; j < rows; j++) {
    fr.row(j);
    const w = fr.w;
    const rowQ = fr.rowQ;
    for (let i = 0, p = j * width * 4; i < width; i++, p += 4) {
      const r = px[p];
      const g = px[p + 1];
      const b = px[p + 2];
      const li = lutIndex(r, g, b);
      const gq = T[li + 2];
      if (gq === 0) continue;
      const gd = gq * INV255;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) * INV255;
      const c = colI[i];
      const fx = colF[i];
      const sky = rb[c + S_SKY] + (rb[c + C + S_SKY] - rb[c + S_SKY]) * fx;
      // The grade is daylight: weaker under a roof or underground.
      const gk = gradeK * gd * (0.6 + 0.4 * sky);
      let nr = r + (255 - r) * gk * 0.5;
      let ng = g + (225 - g) * gk * 0.25;
      let nb = b * (1 - gk * 0.6);
      const act = rb[c + ACT] + (rb[c + C + ACT] - rb[c + ACT]) * fx;
      if (act > 0) {
        const u = colU[i];
        const plant0 = rb[c + S_PLANT] + (rb[c + C + S_PLANT] - rb[c + S_PLANT]) * fx;
        const can = rb[c + S_CANOPY] + (rb[c + C + S_CANOPY] - rb[c + S_CANOPY]) * fx;
        const mass = rb[c + S_MASS] + (rb[c + C + S_MASS] - rb[c + S_MASS]) * fx;
        const plant = plant0 * gd * (0.35 + 0.65 * T[li] * INV255);
        // 1. Every crown turns as a mottled mix of green, yellows, oranges and reds, and
        // thins; vegetation that might be lawn turns gently and doesn't thin.
        const tw = plant * sky * can;
        const mw = plant * sky * mass * (1 - can);
        if (tw + mw > 0.004) {
          const massy = mw > tw;
          // Each tree leans its own way (greener or further on, warmer or more golden),
          // from smooth noise at its centre, so a crown found a pixel off on another
          // device looks the same. Forest masses and lawns vary smoothly instead.
          let pu = u;
          let pw = w;
          let rn = 0.67;
          let l = 0;
          let cu = 0;
          let cw = 0;
          let rs = 0;
          let big = 1;
          if (!massy) {
            l = lab[rowQ + colQ[i]];
            if (l) {
              const ci = (l - 1) * 4;
              cu = crowns[ci] * toU;
              cw = crowns[ci + 1] * toW;
              rs = crowns[ci + 2] * toU;
              big = crowns[ci + 3];
              pu = cu + (u - cu) * big;
              pw = cw + (w - cw) * big;
              const du = u - cu;
              const dw = w - cw;
              const rr = rs > 0 ? Math.sqrt(du * du + dw * dw) / rs : 1;
              const r1 = rr > 1 ? 1 : rr;
              rn = r1 + (0.67 - r1) * big;
            }
          }
          // A single tree's lean is the same all over it: worked out once per crown.
          if (big > 0 || l !== leanOf) {
            bias = rank(RANK_OCTAVE, treeBias.at(pu, pw));
            warm = rank(RANK_OCTAVE, treeWarm.at(pu, pw));
            leanOf = big > 0 ? -1 : l;
          }
          fine.at(u, w);
          const tv = rb[c + TURN] + (rb[c + C + TURN] - rb[c + TURN]) * fx;
          const turn = rank2(0.6 * tv + 0.4 * rank(RANK_OCTAVE, fine.v0), 0.6, 0.4);
          // Each tree keeps between 0.6 and 1.4 times the level's green share, so even late
          // in the season every tree has some green left.
          const gt = (massy ? greenMild : green) * (0.6 + 0.8 * bias);
          const k = ramp(turn, gt - 0.025, gt + 0.025);
          // The leaves still green go a little olive.
          const l255 = lum * 255;
          const gs = greenShift * (1 - k);
          let fr0 = nr + (l255 * 1.08 - nr) * gs;
          let fg0 = ng + (l255 - ng) * gs;
          let fb0 = nb + (l255 * 0.55 - nb) * gs;
          if (k > 0) {
            const hv = rb[c + HUE] + (rb[c + C + HUE] - rb[c + HUE]) * fx;
            const hp = rank2(0.6 * hv + 0.4 * rank(RANK_OCTAVE, fine.v1), 0.6, 0.4) + 0.16 * (warm - 0.5);
            const P = massy ? palM : pal;
            // Entry 256 repeats 255, so the blend never reads past the table.
            const f = hp <= 0 ? 0 : hp >= 1 ? 255 : hp * 255;
            const ii = f | 0;
            const ft = f - ii;
            const e = ii * 3;
            const vmax = nr > ng ? (nr > nb ? nr : nb) : ng > nb ? ng : nb;
            let V = 0.18 + (1.1 * vmax) / 255;
            if (V > 1) V = 1;
            V *= 255;
            fr0 += ((P[e] + (P[e + 3] - P[e]) * ft) * V - fr0) * k;
            fg0 += ((P[e + 1] + (P[e + 4] - P[e + 1]) * ft) * V - fg0) * k;
            fb0 += ((P[e + 2] + (P[e + 5] - P[e + 2]) * ft) * V - fb0) * k;
          }
          // Thinning: gaps open where leaves have fallen (more toward the rim), showing
          // bare branches and the leaf-strewn ground below.
          if (thin > 0 && !massy) {
            const tT = thin * (0.4 + 0.9 * rn);
            const cT = rb[c + THIN] + (rb[c + C + THIN] - rb[c + THIN]) * fx;
            const tf = rank(RANK_OCTAVE, fine.v2);
            const gv = rank2(0.7 * cT + 0.3 * tf, 0.7, 0.3);
            const gap = ramp((tT > 0.95 ? 0.95 : tT) - gv, -0.02, 0.02) * ramp(can, 0.3, 0.7);
            if (gap > 0) {
              fr.under(colX[i], fr.sy, o.sceneW, o.sceneH);
              const shade = 0.8 + 0.12 * (tf - 0.5);
              let br = UNDER[0] * shade;
              let bg = UNDER[1] * shade;
              let bb = UNDER[2] * shade;
              for (let t = 0; t < 2; t++) {
                const ln = t === 0 ? litter1 : litter2;
                const lv = t === 0 ? litter1.at(u, w, 25) : litter2.at(u + 0.1, w + 0.1, 25);
                if (lv > 0) {
                  const lc = LEAF_COLOURS[(ln.pick * 6) | 0];
                  const lk = (0.7 + 0.3 * lum) * (ln.edge > 0.55 ? 0.8 : 1);
                  br += (lc[0] * lk - br) * lv;
                  bg += (lc[1] * lk - bg) * lv;
                  bb += (lc[2] * lk - bb) * lv;
                }
              }
              if (l && big < 0.5) {
                const tree = (Math.floor(cu * 2) * 73856093) ^ (Math.floor(cw * 2) * 19349663);
                const rot = hash2(tree, 17, 0xb4a) * 4;
                const ba = branchAlpha(u - cu, w - cw, rs, rot, tree, halfPx) * (1 - big * 2);
                if (ba > 0) {
                  const bk = 0.55 + 0.25 * tf;
                  br += (84 * bk - br) * ba;
                  bg += (62 * bk - bg) * ba;
                  bb += (46 * bk - bb) * ba;
                }
              }
              fr0 += (br - fr0) * gap;
              fg0 += (bg - fg0) * gap;
              fb0 += (bb - fb0) * gap;
            }
          }
          let wt = tw + mw * 0.85;
          if (wt > 1) wt = 1;
          nr += (fr0 - nr) * wt;
          ng += (fg0 - ng) * wt;
          nb += (fb0 - nb) * wt;
        }
        // 2. Grass toward straw (not where the canopy split is ambiguous).
        const grassy = plant * (1 - can);
        if (straw > 0 && grassy > 0) {
          const st = grassy * straw;
          const max = nr > ng ? (nr > nb ? nr : nb) : ng > nb ? ng : nb;
          const min = nr < ng ? (nr < nb ? nr : nb) : ng < nb ? ng : nb;
          const v = max * INV255;
          const s = max > 0 ? (max - min) / max : 0;
          hsv(strawHue, s * 0.75, v * strawVal > 1 ? 1 : v * strawVal);
          nr += (HSV_OUT[0] - nr) * st;
          ng += (HSV_OUT[1] - ng) * st;
          nb += (HSV_OUT[2] - nb) * st;
        }
        // 3. Fallen leaves on open ground, thicker next to crowns, floating from level 2.
        const ground0 = rb[c + S_GROUND] + (rb[c + C + S_GROUND] - rb[c + S_GROUND]) * fx;
        if (ground0 > 0) {
          let floor = ground0 * gd * (1 - can) * ramp(lum, 0.2, 0.3);
          if (a.amb) floor *= 1 - ramp(plant0, 0.1, 0.4);
          const wat = rb[c + S_WATER] + (rb[c + C + S_WATER] - rb[c + S_WATER]) * fx;
          if (L === 0 && wat >= 0.5) floor = 0;
          if (floor > 0.05) {
            const cov = leafN.at(u, w, leaves * (1 + 2 * ramp(can, 0.05, 0.3)));
            if (cov > 0) {
              const lc = LEAF_COLOURS[(leafN.pick * (L === 2 ? 6 : 5)) | 0];
              const k = (0.8 + 0.35 * lum) * (leafN.edge > 0.55 ? 0.78 : 1);
              const al = cov * floor;
              nr += (lc[0] * k - nr) * al;
              ng += (lc[1] * k - ng) * al;
              nb += (lc[2] * k - nb) * al;
            }
          }
        }
      }
      px[p] = nr;
      px[p + 1] = ng;
      px[p + 2] = nb;
    }
  }
}

// ---------------------------------------------------------------- spring

const BLOSSOM = [
  [250, 200, 214],
  [253, 242, 246],
  [242, 170, 198],
];
const FLOWERS = [
  [250, 226, 90],
  [250, 250, 244],
  [178, 140, 222],
  [238, 116, 116],
];

function bakeSpring(px: Uint8ClampedArray, width: number, rows: number, fr: Frame, L: number): void {
  const SP = SEASON_PARAMS.spring;
  const gradeK = SP.grade[L] * fr.mapK;
  const fresh = SP.fresh[L];
  const bloomD = SP.bloomDensity[L];
  const flowers = fr.a.amb ? 0 : SP.flowers[L] * 0.04;
  // Blossom: two sizes of cluster on grids turned against each other (so no rows show),
  // and small white petals, thick in clumps and sparse between them.
  const dot1 = new Dots(0.2, 0.34, mix(fr.seed, 32));
  const dot2 = new Dots(0.15, 0.32, mix(fr.seed, 33));
  const dot3 = new Dots(0.09, 0.26, mix(fr.seed, 36));
  const clump = new Octave(2.6, 2, mix(fr.seed, 35));
  const rc = ROT[2];
  const rs = ROT[3];
  const flowerN = new Dots(0.2, 0.2, mix(fr.seed, 34));
  const T = colourTable();
  const rb = fr.rb;
  const C = fr.C;
  const colI = fr.colI;
  const colF = fr.colF;
  const colU = fr.colU;
  const ACT = S_LOOK + L_ACT;
  const BLOOM = S_LOOK + L_BLOOM;
  for (let j = 0; j < rows; j++) {
    fr.row(j);
    const w = fr.w;
    for (let i = 0, o = j * width * 4; i < width; i++, o += 4) {
      const r = px[o];
      const g = px[o + 1];
      const b = px[o + 2];
      const li = lutIndex(r, g, b);
      const gq = T[li + 2];
      if (gq === 0) continue;
      const gd = gq * INV255;
      const c = colI[i];
      const fx = colF[i];
      const sky = rb[c + S_SKY] + (rb[c + C + S_SKY] - rb[c + S_SKY]) * fx;
      // The grade is daylight: weaker under a roof or underground.
      const gk = gradeK * gd * (0.6 + 0.4 * sky);
      let nr = r + (255 - r) * gk * 0.3;
      let ng = g + (255 - g) * gk * 0.4;
      let nb = b + (255 - b) * gk * 0.2;
      const act = rb[c + ACT] + (rb[c + C + ACT] - rb[c + ACT]) * fx;
      if (act > 0) {
        const plant0 = rb[c + S_PLANT] + (rb[c + C + S_PLANT] - rb[c + S_PLANT]) * fx;
        const plant = plant0 * gd * (0.35 + 0.65 * T[li] * INV255);
        const f = plant * fresh;
        if (f > 0) {
          // Fresher greens: toward yellow-green, a little more saturated and brighter. Only
          // colours that read as plants move in hue (their greens are all within a short way
          // of 95 degrees): pink blossom, purple flowers and tents on the grass keep theirs.
          const max = nr > ng ? (nr > nb ? nr : nb) : ng > nb ? ng : nb;
          const min = nr < ng ? (nr < nb ? nr : nb) : ng < nb ? ng : nb;
          const v = max * INV255;
          const s = max > 0 ? (max - min) / max : 0;
          const h = hueOf(nr, ng, nb);
          hsv(h + (95 - h) * 0.35 * T[li] * INV255, Math.min(1, s * 1.15 + 0.04), Math.min(1, v * 1.08 + 0.02));
          nr += (HSV_OUT[0] - nr) * f;
          ng += (HSV_OUT[1] - ng) * f;
          nb += (HSV_OUT[2] - nb) * f;
        }
        const can = rb[c + S_CANOPY] + (rb[c + C + S_CANOPY] - rb[c + S_CANOPY]) * fx;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) * INV255;
        if (can > 0 && plant > 0) {
          const bl = rb[c + BLOOM] + (rb[c + C + BLOOM] - rb[c + BLOOM]) * fx;
          const bloom = plant * sky * can * bl;
          if (bloom > 0.004) {
            const u = colU[i];
            const d = bloomD * (0.25 + 0.95 * ramp(clump.at(u, w), 0.3, 0.65));
            const c1 = dot1.at(u, w, d);
            const c2 = dot2.at(u * rc - w * rs + 0.09, u * rs + w * rc + 0.13, d);
            const c3 = dot3.at(u * rs - w * rc + 0.05, u * rc + w * rs + 0.02, d * 0.8);
            let cov = c1 > c2 ? c1 : c2;
            let col = BLOSSOM[((c1 > c2 ? dot1.pick : dot2.pick) * 3) | 0];
            if (c3 > cov) {
              cov = c3;
              col = BLOSSOM[1];
            }
            if (cov > 0) {
              const k = 0.75 + 0.4 * lum;
              const al = cov * bloom * ramp(lum, 0.2, 0.3);
              nr += (Math.min(255, col[0] * k) - nr) * al;
              ng += (Math.min(255, col[1] * k) - ng) * al;
              nb += (Math.min(255, col[2] * k) - nb) * al;
            }
          }
        }
        const grassy = plant * (1 - can);
        if (flowers > 0 && grassy > 0.05) {
          const cov = flowerN.at(colU[i], w, flowers);
          if (cov > 0) {
            const col = FLOWERS[(flowerN.pick * 4) | 0];
            const al = cov * grassy * sky * ramp(lum, 0.2, 0.3);
            nr += (col[0] - nr) * al;
            ng += (col[1] - ng) * al;
            nb += (col[2] - nb) * al;
          }
        }
      }
      px[o] = nr;
      px[o + 1] = ng;
      px[o + 2] = nb;
    }
  }
}

// ---------------------------------------------------------------- summer

function bakeSummer(px: Uint8ClampedArray, width: number, rows: number, fr: Frame, L: number): void {
  const SU = SEASON_PARAMS.summer;
  const gradeK = SU.grade[L] * fr.mapK;
  const lush = SU.lush[L];
  const dryK = SU.dry[L];
  const crownDry = SU.crownDry[L];
  const bare = fr.a.amb ? 0 : SU.bare[L];
  const murk = SU.murk[L];
  const dryHue = 50 - L * 5;
  const drySat = 0.85 - L * 0.12;
  const dryVal = 1.05 + L * 0.03;
  const crackN = new Octave(3.5, 2, mix(fr.seed, 42));
  const T = colourTable();
  const rb = fr.rb;
  const C = fr.C;
  const colI = fr.colI;
  const colF = fr.colF;
  const colU = fr.colU;
  const ACT = S_LOOK + L_ACT;
  const DRY = S_LOOK + L_DRY;
  for (let j = 0; j < rows; j++) {
    fr.row(j);
    const w = fr.w;
    for (let i = 0, o = j * width * 4; i < width; i++, o += 4) {
      const r = px[o];
      const g = px[o + 1];
      const b = px[o + 2];
      const li = lutIndex(r, g, b);
      const gq = T[li + 2];
      if (gq === 0) continue;
      const gd = gq * INV255;
      const c = colI[i];
      const fx = colF[i];
      const sky = rb[c + S_SKY] + (rb[c + C + S_SKY] - rb[c + S_SKY]) * fx;
      // The grade is daylight: weaker under a roof or underground.
      const gk = gradeK * gd * (0.6 + 0.4 * sky);
      let nr = r + (255 - r) * gk * 0.5;
      let ng = g + (225 - g) * gk * 0.25;
      let nb = b * (1 - gk * 0.6);
      const act = rb[c + ACT] + (rb[c + C + ACT] - rb[c + ACT]) * fx;
      if (act > 0) {
        const plant0 = rb[c + S_PLANT] + (rb[c + C + S_PLANT] - rb[c + S_PLANT]) * fx;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) * INV255;
        if (plant0 > 0) {
          const plant = plant0 * gd * (0.35 + 0.65 * T[li] * INV255);
          const can = rb[c + S_CANOPY] + (rb[c + C + S_CANOPY] - rb[c + S_CANOPY]) * fx;
          const max = nr > ng ? (nr > nb ? nr : nb) : ng > nb ? ng : nb;
          const min = nr < ng ? (nr < nb ? nr : nb) : ng < nb ? ng : nb;
          const v = max * INV255;
          const s = max > 0 ? (max - min) / max : 0;
          if (lush > 0 && plant > 0) {
            hsv(hueOf(nr, ng, nb), Math.min(1, s * 1.18), v * 0.97);
            const f = Math.min(1, plant * lush * 3);
            nr += (HSV_OUT[0] - nr) * f;
            ng += (HSV_OUT[1] - ng) * f;
            nb += (HSV_OUT[2] - nb) * f;
          }
          if (dryK > 0 && plant > 0) {
            const n = rb[c + DRY] + (rb[c + C + DRY] - rb[c + DRY]) * fx;
            const grassy = plant * (1 - can);
            const dry = sky * Math.min(1, grassy * dryK * (0.7 + 0.6 * n) + plant * can * crownDry);
            if (dry > 0) {
              hsv(dryHue, s * drySat, Math.min(1, v * dryVal));
              nr += (HSV_OUT[0] - nr) * dry;
              ng += (HSV_OUT[1] - ng) * dry;
              nb += (HSV_OUT[2] - nb) * dry;
            }
            if (bare > 0) {
              // Worn to bare earth in patches (cracked in a drought), never on crowns.
              const bk = grassy * sky * ramp(n, 1 - bare - 0.02, 1 - bare + 0.02);
              if (bk > 0) {
                const lumL = rb[c + S_LUML] + (rb[c + C + S_LUML] - rb[c + S_LUML]) * fx;
                const k = 0.72 + 0.5 * (lum - lumL + 0.45);
                let cr = 1;
                if (L === 2 && Math.abs(crackN.at(colU[i], w) - 0.5) < 0.02) cr = 0.72;
                nr += (170 * k * cr - nr) * bk;
                ng += (140 * k * cr - ng) * bk;
                nb += (100 * k * cr - nb) * bk;
              }
            }
          }
        }
        if (murk > 0) {
          const wat = rb[c + S_WATER] + (rb[c + C + S_WATER] - rb[c + S_WATER]) * fx;
          const m = wat * gd * sky * murk;
          if (m > 0) {
            nr += (96 * (0.6 + lum) - nr) * m;
            ng += (116 * (0.6 + lum) - ng) * m;
            nb += (78 * (0.6 + lum) - nb) * m;
          }
        }
      }
      px[o] = nr;
      px[o + 1] = ng;
      px[o + 2] = nb;
    }
  }
}

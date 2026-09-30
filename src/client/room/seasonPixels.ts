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
// A map painted under snow (a Dungeondraft winter map) is the exception: it has next to no
// vegetation to work on. The analysis recognises one (snowAnalysis, near the end), and the looks
// melt its snow instead (bakeSnowy): spring, summer and autumn paint grass and leaves over it,
// lit by the snow's own light and shade, so the grid and every outline carry over; winter, the
// map's own season, only adds to it. For now analyse() doesn't look for one in the picture
// (PIXEL_SNOWY): the melt runs on scenes with Dungeondraft data only.
//
// Everything is plain arithmetic on doubles and integers (no Math.sin, pow, exp or atan2,
// whose last bits may differ between browsers), so a seed gives the same picture on
// every device. Browsers also shrink the map for the analysis in their own ways (a
// bilinear canvas, mipmaps, a bicubic or lanczos filter), so the analysis mustn't hinge
// on single-pixel detail: grain, how an outline antialiased, or a statistic sitting right
// on a threshold. The tests shrink one map three ways and expect the same crowns.

import type { SeasonLook } from "../../shared/types";

/** Part of the bake cache key: bump it whenever the same inputs would bake differently. */
export const ALGO_VERSION = 4;

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
    // On a map painted under snow (it's winter already):
    /** The snow's shaded tones lifted toward its lit tone (fresh snow). */
    freshen: [0.04, 0.1, 0.16] as Tri,
    /** Share of the grass patches, and of bare earth, under drifts. */
    drift: [0.12, 0.55, 1] as Tri,
    earthDrift: [0, 0.15, 0.3] as Tri,
    /** Hoarfrost on the grass patches' lighter blades. */
    lawnFrost: [0.75, 0.5, 0.2] as Tri,
    /** Snow on the evergreens' lit needles, and on bare branches. */
    everSnow: [0.12, 0.3, 0.5] as Tri,
    branchSnow: [0, 0.4, 0.7] as Tri,
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
    // On a map painted under snow:
    /** Leaves left on the bare trees' new crowns, and on the snow-capped crowns. */
    treeLeaves: [0.85, 0.55, 0.2] as Tri,
    capLeaves: [0.92, 0.7, 0.42] as Tri,
    /** Share of their leaves still green (each tree 0.6-1.4 times this; the rest in the shares above). */
    treeGreen: [0.7, 0.34, 0.15] as Tri,
    /** Of the clumps left, the share of their leaves still on (the rest show the branches). */
    clumpLeaves: [1, 0.8, 0.55] as Tri,
    /** More fallen leaves per square under trees. */
    litter: [3, 8, 14] as Tri,
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
    // On a map painted under snow:
    /** Share of the ground's snow left, in drifts in its own shade (later on, only out in the open). */
    remnant: [0.45, 0.035, 0] as Tri,
    /** Share of the bared ground sprouting (budding; later it's all grass). */
    sprout: [0.5, 1, 1] as Tri,
    /** Buds on bare branches (budding), then their leaf clumps out and how big (young leaves are small). */
    buds: [0.6, 0, 0] as Tri,
    leaves: [0, 0.55, 0.95] as Tri,
    leafScale: [0.6, 0.75, 0.9] as Tri,
    /** Share of a snow-capped crown's snow melted into leaf, and of an evergreen's frost. */
    capMelt: [0.45, 1, 1] as Tri,
    frostMelt: [0.5, 1, 1] as Tri,
    /** Share of trees in blossom, and of their clumps. */
    bloomTrees: [0, 0.45, 0.7] as Tri,
    bloomClumps: [0, 0.35, 0.55] as Tri,
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
    // On a map painted under snow:
    /** Leaves on the bare trees' new crowns, and how far toward olive. */
    leaves: [1, 0.97, 0.9] as Tri,
    leafOlive: [0, 0.2, 0.38] as Tri,
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
 * the guard (0 = never changes: ink and deep shadow, saturated warm colours such as
 * lava, fire and red roofs, and near-white paper and labels), and how much like snow.
 * Built once, about 1 MB.
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
        // Snow: bright, hardly saturated, white to cool (cream paper and warm labels aren't).
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        t[o + 3] = Math.round(255 * ramp(y, 158, 184) * (1 - ramp(s, 0.16, 0.26)) * ramp(b - r, -8, 0));
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
 * so it can be posted between threads. About 10 bytes a pixel: 7 MB at 1024 x 683 (12 on a
 * map painted under snow).
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
  /**
   * A map painted under snow (its own season is winter): what stands in the snow, for the
   * looks to melt it (see snowAnalysis). Null on every other map. On a snowy map f, lab,
   * crowns and under are empty: nothing reads them.
   */
  snow: SnowInfo | null;
}

/**
 * Whether analyse() looks for a map painted under snow in the picture itself (snowAnalysis).
 * Off for now: it still takes some graph paper, marble and blueprints for snow, so every
 * picture analyses and bakes exactly as it did at ALGO_VERSION 3, and the snowy looks melt
 * only scenes with Dungeondraft data, whose snow is known exactly (seasonExact.ts). It comes
 * back once the picture's own snow detection is checked against those scenes.
 */
export const PIXEL_SNOWY = false;

/**
 * Analyses the map once (per asset and grid): rgba is the map downscaled to aw x ah
 * covering the whole scene, cellA one grid square in those pixels. About 0.15-0.35 s at
 * 1024 px on a desktop (a map painted under snow takes about three times as long).
 */
export function analyse(rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number): SeasonAnalysis {
  return analyseWith(rgba, aw, ah, cellA, PIXEL_SNOWY);
}

/**
 * For tests only: analyse() with the picture's own snow detection on, whatever PIXEL_SNOWY
 * says, so the snowy path keeps its tests (and its golden hashes) while it's off.
 */
export function analysePixelSnowy(rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number): SeasonAnalysis {
  return analyseWith(rgba, aw, ah, cellA, true);
}

function analyseWith(rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number, pixelSnowy: boolean): SeasonAnalysis {
  const T = colourTable();
  const N = aw * ah;
  const cA = cellA > 1 ? cellA : 1;
  const sq = cA * cA;
  // A map painted under snow gets its own analysis (any other map leaves it after one pass).
  const snow = pixelSnowy ? snowAnalysis(rgba, aw, ah, cA) : null;
  if (snow) {
    const none = new Uint8Array(0);
    return { aw, ah, cellA, f: none, lab: new Uint16Array(0), crowns: new Float32Array(0), nCrowns: 0, under: none, uw: 0, uh: 0, us: 1, frac: snow.frac, amb: 0, snow };
  }

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

  return { aw, ah, cellA, f, lab, crowns, nCrowns, under, uw, uh, us, frac, amb: amb ? 1 : 0, snow: null };
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
  if (opts.a.snow) {
    bakeSnowy(rgba, width, rows, opts);
    return;
  }
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

// ================================================================ maps painted under snow
//
// A map painted in winter (a Dungeondraft snow map: white and blue-grey painted ground, snow on
// the round crowns, bare trees drawn as brown branches, frosted evergreens) gives the looks
// above almost nothing to work on. snowAnalysis recognises one and finds what stands in the
// snow; bakeSnowy then melts it: the snow turns into painted ground lit by the snow's own light
// and shade (so the grid, every outline and the painterly shading carry over), snow-capped
// crowns and bare trees grow leaves, evergreens lose their frost, ice thaws. Winter only adds.
//
// Snow needs outdoor context to count, so a white or pale stone floor, a marble hall, paper
// margins and labels never do: it must be bright, lean blue and turn bluer in its shade, carry
// soft painted shading, lie in one big field reaching the map's edges, and have plants or bare
// trees standing in it, a good share of them wintry (capped with snow, frosted or bare).

/** Bytes per analysis pixel in SnowInfo.s. */
const NSN = 10;
/** Open snow on the ground (what melts into grass), reaching a little under objects' rims. */
const SN_GROUND = 0;
/** The open snow's own luma round about (thin lines and objects left out): its painted light and shade. */
const SN_TONE = 1;
/** Anything besides open ground within a pixel or two (objects, trees, earth, water): a quick test. */
const SN_OBJ = 2;
/** Snow-capped crowns (trees that will leaf), with their green rims. */
const SN_CROWN = 3;
/** Evergreens and bushes: green, maybe frosted. */
const SN_EVER = 4;
/** Snow on a rock or a prop (outlined all round, no leaves). */
const SN_PROP = 5;
/** Patches of grass the snow left bare, with their soft edges. */
const SN_LAWN = 6;
/** Frozen water. */
const SN_ICE = 7;
/** Open water. */
const SN_WATER = 8;
/** Bare earth (a dirt patch, a road, a deck). */
const SN_EARTH = 9;

/** Floats per tree in SnowInfo.trees. */
const TREE_N = 24;
/** Directions a bare tree's reach is kept in (round the circle, from +x toward +y). */
const TREE_DIRS = 16;
// Per tree: 0-1 centre (analysis px), 2 radius (analysis px), 3 kind (K_*), 4-6 its own green
// (RGB), 7 its snow's lit luma (0-1), 8-23 a bare tree's reach in each direction (analysis px).
const K_CAP = 1;
const K_EVER = 2;
const K_BARE = 3;
const K_PROP = 4;
/** (Analysis only: a patch of grass.) */
const K_LAWN = 5;

export interface SnowInfo {
  /** NSN bytes an analysis pixel (SN_*). */
  s: Uint8Array;
  /** The tree (1-based into trees) each analysis pixel belongs to or is next to; 0 none. */
  tl: Uint16Array;
  trees: Float32Array;
  nTrees: number;
  /** The snow's lit luma (0-1). */
  ref: number;
  /** The map's own grass (patches the snow left bare), RGB, when hasGrass. */
  grass: Float64Array;
  hasGrass: number;
  /** That grass's mean luma (0-1). */
  grassLum: number;
  /** The map's own bare earth, RGB (a default when there's none). */
  earth: Float64Array;
  /** The snow's own colour at its lit tone (RGB). */
  snow: Float64Array;
  /** Outdoor share (what outdoorFraction reports). */
  frac: number;
}

/**
 * Fills the holes of mask (4-connected regions where it's clear) that one region of it encloses
 * all round, up to maxArea pixels and smaller than that region. inv is scratch space.
 */
function fillEnclosed(mask: Uint8Array, w: number, h: number, maxArea: number, lab: Int32Array, stack: Int32Array, inv: Uint8Array): void {
  const total = w * h;
  const nM = label4(mask, w, h, lab, stack);
  const mArea = new Float64Array(nM + 1);
  for (let k = 0; k < total; k++) mArea[lab[k]]++;
  const ml = new Int32Array(lab);
  for (let k = 0; k < total; k++) inv[k] = mask[k] ? 0 : 1;
  const nH = label4(inv, w, h, lab, stack);
  const size = new Float64Array(nH + 1);
  const owner = new Int32Array(nH + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      const o = lab[k];
      if (!o) continue;
      size[o]++;
      if (owner[o] < 0) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        owner[o] = -1;
        continue;
      }
      for (let t = 0; t < 4; t++) {
        const l = ml[t === 0 ? k - 1 : t === 1 ? k + 1 : t === 2 ? k - w : k + w];
        if (l && owner[o] !== l) owner[o] = owner[o] ? -1 : l;
      }
    }
  }
  for (let k = 0; k < total; k++) {
    const o = lab[k];
    if (o && owner[o] > 0 && size[o] <= maxArea && size[o] < mArea[owner[o]]) mask[k] = 1;
  }
}

/**
 * The columns (or rows) a grid baked into the picture has its lines on: s and n are each
 * column's summed darkness against its surroundings and pixel count. Folded over periods from
 * 0.3 to 1.6 squares, a grid is a phase well darker than the typical column. None when there's
 * no clear one.
 */
function gridLines(s: Float64Array, n: Float64Array, cA: number): Uint8Array {
  const len = s.length;
  const out = new Uint8Array(len);
  const m = new Float64Array(len);
  for (let i = 0; i < len; i++) m[i] = n[i] > 0 ? s[i] / n[i] : 0;
  const med = Array.from(m).sort((a, b) => a - b)[len >> 1];
  let bestScore = 0;
  let bestP = 0;
  let bestPh = 0;
  for (let P = Math.max(4, 0.3 * cA); P <= 1.6 * cA && P <= len / 4; P += 0.05) {
    for (let ph = 0; ph < P; ph += 0.25) {
      let t = 0;
      let c = 0;
      for (let pos = ph; pos < len - 1; pos += P) {
        const i = Math.floor(pos);
        t += m[i] > m[i + 1] ? m[i] : m[i + 1];
        c++;
      }
      if (c < 4) continue;
      if (t / c > bestScore) {
        bestScore = t / c;
        bestP = P;
        bestPh = ph;
      }
    }
  }
  if (!(bestScore >= 2 * med + 3)) return out;
  const lim = med + 0.35 * (bestScore - med);
  for (let pos = bestPh; pos < len; pos += bestP) {
    const i = Math.floor(pos);
    for (let j = i - 1; j <= i + 2; j++) if (j >= 0 && j < len && m[j] >= lim) out[j] = 1;
  }
  return out;
}

/** A 3x3 max (or min) filter of a byte image, edges repeated. */
function maxMin3(src: Uint8Array, w: number, h: number, dst: Uint8Array, max: boolean): void {
  const row = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const a = src[o + (x > 0 ? x - 1 : 0)];
      const b = src[o + x];
      const c = src[o + (x < w - 1 ? x + 1 : x)];
      row[o + x] = max ? (a > b ? (a > c ? a : c) : b > c ? b : c) : a < b ? (a < c ? a : c) : b < c ? b : c;
    }
  }
  for (let y = 0; y < h; y++) {
    const o0 = (y > 0 ? y - 1 : 0) * w;
    const o1 = y * w;
    const o2 = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const a = row[o0 + x];
      const b = row[o1 + x];
      const c = row[o2 + x];
      dst[o1 + x] = max ? (a > b ? (a > c ? a : c) : b > c ? b : c) : a < b ? (a < c ? a : c) : b < c ? b : c;
    }
  }
}

/** The diamond angle of (dx, dy): 0-4 round the circle from +x toward +y, with no atan2. */
function diamond(dx: number, dy: number): number {
  const ad = Math.abs(dx) + Math.abs(dy);
  if (ad <= 0) return 0;
  return dy >= 0 ? (dx >= 0 ? dy / ad : 2 - dy / ad) : dx < 0 ? 2 - dy / ad : 4 + dy / ad;
}

function snowAnalysis(rgba: Uint8ClampedArray, aw: number, ah: number, cA: number): SnowInfo | null {
  const N = aw * ah;
  const sq = cA * cA;
  if (N < 4096 || cA < 4) return null;
  const T = colourTable();
  // 1. Snow by colour. Every map pays for this pass, so it's a table lookup and a count.
  let n0 = 0;
  for (let k = 0, o = 0; k < N; k++, o += 4) {
    if (rgba[o + 3] >= 128 && T[lutIndex(rgba[o], rgba[o + 1], rgba[o + 2]) + 3] >= 128) n0++;
  }
  if (n0 < 0.2 * N) return null;

  const lum = new Uint8Array(N);
  const mx = new Uint8Array(N);
  const chroma = new Uint8Array(N);
  const sc = new Uint8Array(N);
  for (let k = 0, o = 0; k < N; k++, o += 4) {
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    lum[k] = ((299 * r + 587 * g + 114 * b + 500) / 1000) | 0;
    mx[k] = max;
    chroma[k] = max - min;
    sc[k] = rgba[o + 3] >= 128 ? T[lutIndex(r, g, b) + 3] : 0;
  }
  const tmp = new Int32Array(N);
  const lumL = blur8(lum, aw, ah, Math.max(1, Math.round(0.25 * cA)), new Uint8Array(N), tmp);

  // 2. The whole map's snow: bright on the whole, leaning blue and clearly bluer where it's
  // darker (its painted shade), with some texture. Pale stone and paving are greyer and duller,
  // paper is flat, and a tinted floor is no bluer in its shade.
  let sw = 0;
  let sBR = 0;
  let sL = 0;
  let sLL = 0;
  let sLBR = 0;
  let sTex = 0;
  for (let k = 0, o = 0; k < N; k++, o += 4) {
    if (!sc[k]) continue;
    const c = sc[k] * INV255;
    const br = rgba[o + 2] - rgba[o];
    const L = lum[k];
    sw += c;
    sBR += c * br;
    sL += c * L;
    sLL += c * L * L;
    sLBR += c * L * br;
    sTex += c * Math.abs(L - lumL[k]);
  }
  const share = sw / N;
  const mL = sL / sw;
  const mBR = sBR / sw;
  const varL = sLL / sw - mL * mL;
  const slope = varL > 1 ? (sLBR / sw - mL * mBR) / varL : 0;
  if (share < 0.2 || mL < 205 || mBR < 2 || slope > -0.06 || sTex / sw < 1.5) {
    return null;
  }

  const d = new Int32Array(N);
  const lab = new Int32Array(N);
  const stack = new Int32Array(N);
  const inv = new Uint8Array(N);
  const r1 = Math.max(1, Math.round(0.08 * cA));

  // 3. What isn't snow. Plants: vegetation, and frosted leaves (grey to near-white, but still a
  // little green). Ink: dark, or clearly darker than round about (outlines; a baked grid's lines
  // are only a little darker). Ice: bluer and more colourful than the snow, in big pieces. Open
  // water. Bare earth: solid warm areas.
  const veg = new Uint8Array(N);
  const frost = new Uint8Array(N);
  const ink = new Uint8Array(N);
  const iceM = new Uint8Array(N);
  const wat = new Uint8Array(N);
  const earth = new Uint8Array(N);
  const iceBR = Math.max(12, mBR + 6);
  let iceC = 0;
  for (let k = 0, o = 0; k < N; k++, o += 4) {
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const li = lutIndex(r, g, b);
    const gd = T[li + 2];
    const m = mx[k];
    veg[k] = T[li] * gd >= 80 * 255 ? 1 : 0;
    ink[k] = m < DARK || lum[k] * 100 < lumL[k] * 84 ? 1 : 0;
    if (!veg[k] && m >= 90 && g >= r + 3 && g >= b + 2 && chroma[k] < 0.3 * m) frost[k] = 1;
    if (lum[k] >= 140 && b >= g && b - r >= iceBR && chroma[k] >= 0.08 * m && chroma[k] <= 0.35 * m) {
      iceM[k] = 1;
      iceC++;
    } else if (T[li + 1] * gd >= 128 * 255) wat[k] = 1;
    if (!veg[k] && sc[k] < 128 && r > b + 6 && chroma[k] >= 0.1 * m) {
      const h = hueOf(r, g, b);
      if (h < 55 || h > 330) earth[k] = 1;
    }
  }
  if (iceC >= 2 * sq) {
    erode(iceM, 1, aw, ah, d);
    dilate(iceM, 1, aw, ah, d);
    dropSmall(iceM, aw, ah, 2 * sq, lab, stack);
    // Its ink (cracks, the shore's outline) is part of it.
    fillPinholes(iceM, new Uint8Array(N), aw, ah, Math.max(4, 0.1 * sq), inv, lab, stack);
    // Frozen water has a shore drawn round it; the snow's own blue shade fades into its light.
    // (A shore is drawn in grey or black; brown is earth and branches.)
    const inkN = new Uint8Array(N);
    for (let k = 0, o = 0; k < N; k++, o += 4) inkN[k] = ink[k] && rgba[o] <= rgba[o + 2] + 6 ? 1 : 0;
    dilate(inkN, 2, aw, ah, d);
    const nI = label4(iceM, aw, ah, lab, stack);
    const per = new Float64Array(nI + 1);
    const shore = new Float64Array(nI + 1);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const l = lab[k];
        if (!l) continue;
        const edge = (x > 0 && !iceM[k - 1]) || (x < aw - 1 && !iceM[k + 1]) || (y > 0 && !iceM[k - aw]) || (y < ah - 1 && !iceM[k + aw]);
        if (!edge) continue;
        per[l]++;
        if (inkN[k]) shore[l]++;
      }
    }
    for (let k = 0; k < N; k++) if (iceM[k] && shore[lab[k]] < 0.5 * per[lab[k]]) iceM[k] = 0;
  } else if (iceC) iceM.fill(0);
  for (let k = 0; k < N; k++) if (iceM[k]) wat[k] = 0;
  dropSmall(wat, aw, ah, sq, lab, stack);
  erode(earth, r1, aw, ah, d);
  dilate(earth, r1, aw, ah, d);
  // Small light patches of it (a stump's cut top, a well): roots round one aren't a tree.
  const stumps: number[] = [];
  {
    const nE = label4(earth, aw, ah, lab, stack);
    const es = new Float64Array((nE + 1) * 4);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const e = lab[k];
        if (!e) continue;
        es[e * 4] += x + 0.5;
        es[e * 4 + 1] += y + 0.5;
        es[e * 4 + 2]++;
        es[e * 4 + 3] += lum[k];
      }
    }
    for (let e = 1; e <= nE; e++) {
      const n = es[e * 4 + 2];
      if (n > 4 * sq || n < 0.2 * sq || es[e * 4 + 3] / n < 0.5 * mL) continue;
      stumps.push(es[e * 4] / n, es[e * 4 + 1] / n, Math.sqrt(n / Math.PI) + 0.7 * cA);
    }
  }
  dropSmall(earth, aw, ah, sq, lab, stack);

  // 4. The snow cut at ink into pieces: the open snow is one big piece or a few; the smaller
  // pieces with a green rim, or outlined all round, are snow on crowns and props.
  const cutD = new Uint8Array(N);
  const sm = new Uint8Array(N);
  const plantN = new Uint8Array(N);
  for (let k = 0; k < N; k++) plantN[k] = veg[k] || frost[k] ? 1 : 0;
  dilate(plantN, 2, aw, ah, d);
  let nS = 0;
  let sArea = new Float64Array(1);
  let sPer = sArea;
  let sVeg = sArea;
  let sDark = sArea;
  let sBorder = new Uint8Array(1);
  let bigA = 0;
  let allA = 0;
  const split = (gridX: Uint8Array | null, gridY: Uint8Array | null): boolean => {
    cutD.set(ink);
    dilate(cutD, 1, aw, ah, d);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        let onGrid = false;
        if (gridX && gridY && (gridX[x] || gridY[y]) && sc[k] < 128 && mx[k] >= DARK) {
          // (Only between snow on both sides: it mustn't bridge a crown's rim.)
          if (gridX[x]) {
            let xl = x - 1;
            while (xl > 0 && gridX[xl] && x - xl < 4) xl--;
            let xr = x + 1;
            while (xr < aw - 1 && gridX[xr] && xr - x < 4) xr++;
            onGrid = xl >= 0 && xr < aw && sc[k - x + xl] >= 128 && sc[k - x + xr] >= 128;
          }
          if (!onGrid && gridY[y]) {
            let yu = y - 1;
            while (yu > 0 && gridY[yu] && y - yu < 4) yu--;
            let yd = y + 1;
            while (yd < ah - 1 && gridY[yd] && yd - y < 4) yd++;
            onGrid = yu >= 0 && yd < ah && sc[yu * aw + x] >= 128 && sc[yd * aw + x] >= 128;
          }
        }
        sm[k] = (sc[k] >= 128 || onGrid) && !cutD[k] && !frost[k] && !iceM[k] ? 1 : 0;
      }
    }
    fillPinholes(sm, cutD, aw, ah, Math.max(4, 0.05 * sq), inv, lab, stack);
    nS = label4(sm, aw, ah, lab, stack);
    sArea = new Float64Array(nS + 1);
    sPer = new Float64Array(nS + 1);
    sVeg = new Float64Array(nS + 1);
    sDark = new Float64Array(nS + 1);
    sBorder = new Uint8Array(nS + 1);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const l = lab[k];
        if (!l) continue;
        sArea[l]++;
        if (x === 0 || y === 0 || x === aw - 1 || y === ah - 1) {
          sBorder[l] = 1;
          sPer[l]++;
          continue;
        }
        let edge = false;
        let dark = false;
        for (let t = 0; t < 4; t++) {
          const j = t === 0 ? k - 1 : t === 1 ? k + 1 : t === 2 ? k - aw : k + aw;
          if (lab[j] !== l) {
            edge = true;
            if (cutD[j]) dark = true;
          }
        }
        if (!edge) continue;
        sPer[l]++;
        if (plantN[k]) sVeg[l]++;
        if (dark) sDark[l]++;
      }
    }
    // Snow lies in one big field (cut only by what stands in it); a floor of flagstones or
    // paving is cut by its joints into stones.
    bigA = 0;
    allA = 0;
    for (let l = 1; l <= nS; l++) {
      allA += sArea[l];
      if (sArea[l] > bigA) bigA = sArea[l];
    }
    return bigA >= 0.4 * allA && bigA >= 15 * sq;
  };
  if (!split(null, null)) {
    // A grid baked into the picture: thin lines every square or so that, shrunk sharply, stay
    // dark enough to cut the snow into squares. Found by folding "darker than round about" over
    // its period, across and down; then only what's next to an off-grid cut cuts on its lines.
    const colS = new Float64Array(aw);
    const colN = new Float64Array(aw);
    const rowS = new Float64Array(ah);
    const rowN = new Float64Array(ah);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        if (lumL[k] < 170) continue;
        const dk = lumL[k] - lum[k];
        const v = dk > 0 ? dk : 0;
        colS[x] += v;
        colN[x]++;
        rowS[y] += v;
        rowN[y]++;
      }
    }
    const gridX = gridLines(colS, colN, cA);
    const gridY = gridLines(rowS, rowN, cA);
    let anyGrid = false;
    for (let x = 0; x < aw && !anyGrid; x++) if (gridX[x]) anyGrid = true;
    for (let y = 0; y < ah && !anyGrid; y++) if (gridY[y]) anyGrid = true;
    if (!anyGrid) {
      return null;
    }
    const offCut = new Uint8Array(N);
    for (let y = 0; y < ah; y++) for (let x = 0, k = y * aw; x < aw; x++, k++) offCut[k] = ink[k] && !gridX[x] && !gridY[y] ? 1 : 0;
    dilate(offCut, 2, aw, ah, d);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) if (ink[k] && (gridX[x] || gridY[y]) && !offCut[k]) ink[k] = 0;
    }
    if (!split(gridX, gridY)) {
      return null;
    }
  }
  const snowL = new Int32Array(lab);
  // A piece of snow that's largely ice is a frozen pond or river with paler patches: all ice.
  {
    const nI = new Float64Array(nS + 1);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const l = snowL[k];
        if (!l) continue;
        // (Ice is cut out of the snow: count the ice next to each piece.)
        if ((x > 0 && iceM[k - 1]) || (x < aw - 1 && iceM[k + 1]) || (y > 0 && iceM[k - aw]) || (y < ah - 1 && iceM[k + aw])) nI[l]++;
      }
    }
    let any = false;
    for (let l = 1; l <= nS; l++) {
      if (sArea[l] >= 0.4 * allA || sArea[l] < 0.5 * sq || nI[l] < 0.15 * sPer[l]) nI[l] = 0;
      else any = true;
    }
    if (any) {
      for (let k = 0; k < N; k++) {
        const l = snowL[k];
        if (l && nI[l]) {
          iceM[k] = 1;
          sm[k] = 0;
          snowL[k] = 0;
        }
      }
    }
  }
  const cand = new Uint8Array(nS + 1);
  for (let l = 1; l <= nS; l++) {
    const a = sArea[l];
    if (a >= 40 * sq || a < 0.02 * sq || sBorder[l]) continue;
    if (sVeg[l] >= 0.06 * sPer[l] || (a >= 0.05 * sq && sDark[l] >= 0.8 * sPer[l])) cand[l] = 1;
  }
  const capM = new Uint8Array(N);
  for (let k = 0; k < N; k++) capM[k] = cand[snowL[k]];
  // A crown's outline that faded in the shrink leaves its cap joined to the ground's snow: cut
  // again with the leaves as well as the ink, over gaps of up to 0.4 square. What that cut
  // encloses (away from the edge and the big field), with its outline and the contour lines drawn
  // on it, is a cap when it's round, of a crown's size, mostly snow, with some leaves and no
  // branches (a bare tree's twigs, closed over, enclose snow too).
  const warm0 = new Uint8Array(N);
  for (let k = 0, o = 0; k < N; k++, o += 4) {
    const r = rgba[o];
    const b = rgba[o + 2];
    if (veg[k] || sc[k] >= 128 || r <= b + 6 || lum[k] * 100 >= lumL[k] * 94) continue;
    const h = hueOf(r, rgba[o + 1], b);
    if (h < 50 || h > 330) warm0[k] = 1;
  }
  {
    const cutC = new Uint8Array(N);
    for (let k = 0; k < N; k++) cutC[k] = ink[k] || veg[k] || frost[k] ? 1 : 0;
    const rr = Math.max(1, 0.2 * cA);
    dilate(cutC, rr, aw, ah, d);
    erode(cutC, rr, aw, ah, d);
    for (let k = 0; k < N; k++) inv[k] = cutC[k] || iceM[k] || wat[k] ? 0 : 1;
    const nP = label4(inv, aw, ah, lab, stack);
    const open = new Uint8Array(nP + 1);
    const pA = new Float64Array(nP + 1);
    for (let y = 0; y < ah; y++) {
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const l = lab[k];
        if (!l) continue;
        pA[l]++;
        if (x === 0 || y === 0 || x === aw - 1 || y === ah - 1) open[l] = 1;
      }
    }
    for (let l = 1; l <= nP; l++) if (pA[l] >= 40 * sq) open[l] = 1;
    for (let k = 0; k < N; k++) inv[k] = open[lab[k]] || iceM[k] || wat[k] ? 0 : 1;
    const nB = label4(inv, aw, ah, lab, stack);
    const bA = new Float64Array(nB + 1);
    const bS = new Float64Array(nB + 1);
    const bG = new Float64Array(nB + 1);
    const bW = new Float64Array(nB + 1);
    for (let k = 0; k < N; k++) {
      const l = lab[k];
      if (!l) continue;
      bA[l]++;
      if (sc[k] >= 128 && !frost[k] && !ink[k]) bS[l]++;
      if (veg[k] || frost[k]) bG[l]++;
      if (warm0[k]) bW[l]++;
    }
    // (How much of each one's rim is ink: an outline drawn round it, or strokes the closing joined.)
    const bE = new Float64Array(nB + 1);
    const bK = new Float64Array(nB + 1);
    for (let y = 1; y < ah - 1; y++) {
      for (let x = 1, k = y * aw + 1; x < aw - 1; x++, k++) {
        const l = lab[k];
        if (!l || (lab[k - 1] === l && lab[k + 1] === l && lab[k - aw] === l && lab[k + aw] === l)) continue;
        bE[l]++;
        if (ink[k] || ink[k - 1] || ink[k + 1] || ink[k - aw] || ink[k + aw]) bK[l]++;
      }
    }
    distTo(inv, 0, aw, ah, d);
    const bIn = new Float64Array(nB + 1);
    for (let k = 0; k < N; k++) if (lab[k] && d[k] > bIn[lab[k]]) bIn[lab[k]] = d[k];

    let any = false;
    for (let l = 1; l <= nB; l++) {
      const A = bA[l];
      const rIn = Math.max(1, bIn[l] / D1);
      // (Or a small bush under snow, its outline enclosing it all round: plenty of green.)
      const big = A >= 0.6 * sq && bS[l] >= 0.3 * A && bG[l] >= 0.08 * A && bW[l] < 0.05 * A;
      const small = A >= 0.08 * sq && A < 0.6 * sq && bS[l] >= 0.4 * A && bG[l] >= 0.1 * A && bW[l] < 0.03 * A && bK[l] >= 0.75 * bE[l];
      const ok = (big || small) && A <= 30 * sq && A <= 3.5 * Math.PI * rIn * rIn;
      if (ok) any = true;
      else bA[l] = 0;
    }
    if (any) {
      // (Not the snow among a bare tree's twigs next to it.)
      const tw = new Uint8Array(warm0);
      dilate(tw, Math.max(2, 0.15 * cA), aw, ah, d);
      for (let k = 0; k < N; k++) if (bA[lab[k]] && sc[k] >= 128 && !tw[k]) capM[k] = 1;
    }
  }

  // 5. Objects: plants and the snow on them, closed over the ink drawn on them, with what
  // their outline encloses (the contour rings of a snow cap).
  const obj = new Uint8Array(N);
  for (let k = 0; k < N; k++) obj[k] = veg[k] || frost[k] || capM[k] ? 1 : 0;
  const rc = Math.max(1, Math.round(0.1 * cA));
  dilate(obj, rc, aw, ah, d);
  fillEnclosed(obj, aw, ah, 25 * sq, lab, stack, inv);
  erode(obj, rc, aw, ah, d);
  for (let k = 0; k < N; k++) if (iceM[k] || wat[k]) obj[k] = 0;
  const nO = label4(obj, aw, ah, lab, stack);
  const objL = new Int32Array(lab);
  const oArea = new Float64Array(nO + 1);
  const oSnow = new Float64Array(nO + 1);
  const oFrost = new Float64Array(nO + 1);
  const oVeg = new Float64Array(nO + 1);
  const oPer = new Float64Array(nO + 1);
  const oDark = new Float64Array(nO + 1);
  const oGP = new Float64Array(nO + 1);
  for (let y = 0; y < ah; y++) {
    for (let x = 0, k = y * aw; x < aw; x++, k++) {
      const l = objL[k];
      if (!l) continue;
      oArea[l]++;
      if (sc[k] >= 128 && !frost[k]) oSnow[l]++;
      if (frost[k]) oFrost[l]++;
      if (veg[k]) oVeg[l]++;
      let dark = false;
      let edge = x === 0 || y === 0 || x === aw - 1 || y === ah - 1;
      for (let t = 0; t < 4 && !edge; t++) {
        const j = t === 0 ? k - 1 : t === 1 ? k + 1 : t === 2 ? k - aw : k + aw;
        if (objL[j] !== l) {
          edge = true;
          if (ink[j] || mx[j] < DARK) dark = true;
        }
      }
      if (!edge) continue;
      oPer[l]++;
      if (veg[k] || frost[k]) oGP[l]++;
      if (dark || ink[k]) oDark[l]++;
    }
  }
  // How thick each object is (the biggest disc inside it), and the warm strokes round it (a
  // bare tree's branches: snow caught among them is no crown's cap and no rock's).
  distTo(obj, 0, aw, ah, d);
  const oIn = new Float64Array(nO + 1);
  for (let k = 0; k < N; k++) if (objL[k] && d[k] > oIn[objL[k]]) oIn[objL[k]] = d[k];
  // What lies just inside the snow on an object: a capped crown's snow is ringed by its leaves, a
  // rock's by its grey face and outline (the green round it is grass outside the outline).
  const inG = new Float64Array(nO + 1);
  const inN = new Float64Array(nO + 1);
  {
    for (let k = 0; k < N; k++) inv[k] = objL[k] && sc[k] >= 128 && !frost[k] ? 1 : 0;
    distTo(inv, 1, aw, ah, d);
    const rr = Math.max(1.5, 0.15 * cA) * D1;
    for (let k = 0; k < N; k++) {
      const l = objL[k];
      if (!l || d[k] === 0 || d[k] > rr || ink[k]) continue;
      inN[l]++;
      if (veg[k] || frost[k]) inG[l]++;
    }
  }
  const ringW = new Float64Array(nO + 1);
  const ringN = new Float64Array(nO + 1);
  {
    // (stack is free here: it's scratch for labelling.)
    const near = stack;
    distLabel(objL, aw, ah, d, near);
    const rr = 0.3 * cA * D1;
    for (let k = 0; k < N; k++) {
      if (objL[k] || !near[k] || d[k] > rr) continue;
      ringN[near[k]]++;
      if (warm0[k]) ringW[near[k]]++;
    }
  }
  const oKind = new Uint8Array(nO + 1);
  for (let l = 1; l <= nO; l++) {
    const a = oArea[l];
    if (a < 0.15 * sq) continue;
    const green = oVeg[l] + oFrost[l];
    // Mostly snow: a snow-capped crown (with some green: plenty on a small one) or snow on a
    // prop (none). Else outlined: an evergreen or bush; soft-edged: a patch of grass.
    let kd: number;
    // (A small one is a snowed-on bush when it's nearly all snow: a rock under snow shows more of its
    // grey face.)
    if (oSnow[l] >= 0.35 * a) kd = green >= 0.08 * a && (a >= 1.5 * sq || (oSnow[l] >= 0.62 * a && (oSnow[l] >= 0.72 * a || inG[l] >= (a >= 0.5 * sq ? 0.15 : 0.3) * inN[l]))) ? K_CAP : K_PROP;
    else kd = oDark[l] >= 0.25 * oPer[l] || a < 0.5 * sq ? K_EVER : K_LAWN;
    // Crowns, bushes and props are round-ish: a long thin strip is a river's bank or a path's edge.
    const ri = Math.max(1, oIn[l] / D1);
    if (kd !== K_LAWN && a > 4 * Math.PI * ri * ri) continue;
    // Snow among a bare tree's branches.
    if (((kd === K_CAP && ringW[l] >= 0.2 * ringN[l]) || (kd === K_PROP && ringW[l] >= 0.12 * ringN[l])) && green < 0.15 * a) continue;
    // (A small one among roots or branches at all is snow caught there, whatever green is near.)
    if (kd === K_CAP && a < 1.5 * sq && ringW[l] >= 0.05 * ringN[l]) continue;
    oKind[l] = kd;
  }

  // 6. Bare trees: thin warm strokes on the snow (and the ink drawn along them), away from
  // objects and bare earth, dense round a trunk.
  const away = new Uint8Array(N);
  for (let k = 0; k < N; k++) away[k] = oKind[objL[k]] || earth[k] || iceM[k] || wat[k] ? 1 : 0;
  dilate(away, 2, aw, ah, d);
  const warmM = new Uint8Array(N);
  for (let k = 0, o = 0; k < N; k++, o += 4) {
    if (away[k] || veg[k] || sc[k] >= 160) continue;
    const r = rgba[o];
    const b = rgba[o + 2];
    if (r <= b + 6) continue;
    const h = hueOf(r, rgba[o + 1], b);
    if ((h < 50 || h > 330) && lum[k] * 100 < lumL[k] * 94) warmM[k] = 1;
  }
  const warmD = new Uint8Array(warmM);
  dilate(warmD, 1, aw, ah, d);
  const branch = new Uint8Array(N);
  const inkB = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const free = !away[k] && !veg[k] && sc[k] < 160;
    if (warmM[k] || (ink[k] && warmD[k] && free)) branch[k] = 255;
    else if (ink[k] && free) inkB[k] = 255;
  }
  const rB = Math.max(1, Math.round(0.3 * cA));
  // (Ink on its own: a thicket of dark twigs counts where it's dense.)
  blur8(inkB, aw, ah, rB, inkB, tmp);
  for (let k = 0; k < N; k++) if (inkB[k] >= 70 && !branch[k] && !away[k] && ink[k]) branch[k] = 128;
  const bd = blur8(branch, aw, ah, rB, new Uint8Array(N), tmp);
  const treeM = new Uint8Array(N);
  for (let k = 0; k < N; k++) treeM[k] = bd[k] >= 30 ? 1 : 0;
  dropSmall(treeM, aw, ah, 0.25 * sq, lab, stack);
  const nT0 = label4(treeM, aw, ah, lab, stack);
  // Per network: stroke pixels, warm ones, its densest point (the trunk).
  const tA = new Float64Array(nT0 + 1);
  const tStroke = new Float64Array(nT0 + 1);
  const tWarm = new Float64Array(nT0 + 1);
  const tThick = new Float64Array(nT0 + 1);
  // (Warm strokes that survive a thin erosion: solid things, a rock or a crate, not twigs.)
  const thick = new Uint8Array(warmM);
  erode(thick, Math.max(1, 0.07 * cA), aw, ah, d);
  const tPk = new Int32Array(nT0 + 1).fill(-1);
  const tCx = new Float64Array(nT0 + 1);
  const tCy = new Float64Array(nT0 + 1);
  const tx0 = new Int32Array(nT0 + 1).fill(aw);
  const tx1 = new Int32Array(nT0 + 1).fill(-1);
  const ty0 = new Int32Array(nT0 + 1).fill(ah);
  const ty1 = new Int32Array(nT0 + 1).fill(-1);
  for (let y = 0; y < ah; y++) {
    for (let x = 0, k = y * aw; x < aw; x++, k++) {
      const l = lab[k];
      if (!l) continue;
      tA[l]++;
      if (x < tx0[l]) tx0[l] = x;
      if (x > tx1[l]) tx1[l] = x;
      if (y < ty0[l]) ty0[l] = y;
      if (y > ty1[l]) ty1[l] = y;
      if (branch[k]) {
        tStroke[l]++;
        if (branch[k] === 255 && warmM[k]) {
          tWarm[l]++;
          if (thick[k]) tThick[l]++;
        }
      }
      if (tPk[l] < 0 || bd[k] > bd[tPk[l]]) tPk[l] = k;
      if (branch[k]) {
        tCx[l] += x + 0.5;
        tCy[l] += y + 0.5;
      }
    }
  }
  const bareList: number[] = [];
  const NB = 24;
  const binW = (4 * cA) / NB;
  const hist = new Float64Array(NB);
  const dirR = new Float64Array(TREE_DIRS * NB);
  const rCore = Math.max(1.5, 0.3 * cA);
  let topArea = 0;
  for (let l = 1; l <= nT0; l++) {
    if (tA[l] < 0.25 * sq || tStroke[l] > 0.75 * tA[l] || tWarm[l] < 0.08 * tStroke[l] || tThick[l] > 0.35 * tWarm[l]) continue;
    const pk = tPk[l];
    const px0 = (pk % aw) + 0.5;
    const py0 = Math.floor(pk / aw) + 0.5;
    let rooted = false;
    for (let e = 0; e < stumps.length && !rooted; e += 3) rooted = (px0 - stumps[e]) ** 2 + (py0 - stumps[e + 1]) ** 2 < stumps[e + 2] ** 2;
    if (rooted) continue;
    // Roots round a stump (or rocks round a well) are a ring: hollow where their middle is. A
    // bare tree is densest at its trunk, in its middle.
    {
      const mx0 = Math.floor(tCx[l] / tStroke[l]);
      const my0 = Math.floor(tCy[l] / tStroke[l]);
      let mid = 0;
      let mn = 0;
      for (let y = my0 - 1; y <= my0 + 1; y++) {
        for (let x = mx0 - 1; x <= mx0 + 1; x++) {
          if (x < 0 || y < 0 || x >= aw || y >= ah) continue;
          mid += bd[y * aw + x];
          mn++;
        }
      }
      if (mn && mid / mn < 0.4 * bd[pk]) continue;
      // Or an outlined disc of snow right in their middle (a snowed-over stump's cut top), with
      // the roots round it short beside it.
      const rs = Math.max(2, 0.15 * cA);
      let top = -1;
      for (let y = Math.max(0, Math.floor(my0 - rs)); y <= Math.min(ah - 1, Math.ceil(my0 + rs)) && top < 0; y++) {
        for (let x = Math.max(0, Math.floor(mx0 - rs)); x <= Math.min(aw - 1, Math.ceil(mx0 + rs)) && top < 0; x++) {
          if ((x + 0.5 - mx0) ** 2 + (y + 0.5 - my0) ** 2 <= rs * rs && capM[y * aw + x]) top = y * aw + x;
        }
      }
      topArea = 0;
      if (top >= 0) {
        // (Its size: a flood over the snow island, up to 2 squares.)
        let qn = 0;
        stack[qn++] = top;
        inv[top] = 2;
        for (let qi = 0; qi < qn && qn < 2 * sq; qi++) {
          const k = stack[qi];
          const x = k % aw;
          for (const j of [x > 0 ? k - 1 : -1, x < aw - 1 ? k + 1 : -1, k - aw, k + aw]) {
            if (j < 0 || j >= N || !capM[j] || inv[j] === 2) continue;
            inv[j] = 2;
            stack[qn++] = j;
          }
        }
        for (let qi = 0; qi < qn; qi++) inv[stack[qi]] = 0;
        topArea = qn;
      }
    }
    hist.fill(0);
    dirR.fill(0);
    let tot = 0;
    let solidN = 0;
    let coreN = 0;
    for (let y = ty0[l]; y <= ty1[l]; y++) {
      for (let x = tx0[l], k = y * aw + tx0[l]; x <= tx1[l]; x++, k++) {
        const dx = x + 0.5 - px0;
        const dy = y + 0.5 - py0;
        const dc = Math.sqrt(dx * dx + dy * dy);
        if (dc <= rCore) {
          coreN++;
          // (Solid and lighter than a trunk: a stump's cut top, a well, a cart.)
          if (earth[k] || (sc[k] < 128 && !ink[k] && lum[k] >= 0.55 * mL && chroma[k] >= 0.12 * mx[k])) solidN++;
        }
        if (lab[k] !== l || !branch[k]) continue;
        const bi = Math.min(NB - 1, Math.floor(dc / binW));
        hist[bi]++;
        tot++;
        const di = Math.floor(diamond(dx, dy) * (TREE_DIRS / 4)) & (TREE_DIRS - 1);
        dirR[di * NB + bi]++;
      }
    }
    if (coreN && solidN >= 0.3 * coreN) continue;
    let acc = 0;
    let i85 = 0;
    for (; i85 < NB - 1; i85++) {
      acc += hist[i85];
      if (acc >= 0.85 * tot) break;
    }
    const ext = (i85 + 1) * binW;
    // Its strokes thin out away from the trunk; a deck or a fence is as dense all over.
    let inner = 0;
    let outer = 0;
    for (let j = 0; j <= i85; j++) {
      if ((j + 0.5) * binW < 0.5 * ext) inner += hist[j];
      else outer += hist[j];
    }
    const radial = ext >= cA ? inner / 0.25 / Math.max(1, outer / 0.75) : 9;
    if (radial < 1.2) continue;
    if (topArea >= 0.08 * sq && ext < 3 * Math.sqrt(topArea / Math.PI) + 0.1 * cA) continue;
    const R = Math.max(0.4 * cA, Math.min(3.5 * cA, ext));
    bareList.push(px0, py0, R);
    // Reach per direction: where 85% of that direction's strokes lie.
    for (let di = 0; di < TREE_DIRS; di++) {
      let t = 0;
      for (let j = 0; j < NB; j++) t += dirR[di * NB + j];
      let a2 = 0;
      let j = 0;
      for (; j < NB - 1 && t > 0; j++) {
        a2 += dirR[di * NB + j];
        if (a2 >= 0.85 * t) break;
      }
      const reach = t >= 3 ? Math.min(R * 1.25, (j + 1) * binW) : 0.35 * R;
      bareList.push(Math.max(0.35 * R, reach));
    }
  }
  const BL = 3 + TREE_DIRS;
  const nBare = bareList.length / BL;

  // 7. Is it snow? Outdoor context: a good share of the map's edge is snow, the snow has soft
  // painted shading, plants and bare trees stand in it (a good share of them wintry: capped,
  // frosted or bare), nothing big and foreign sits in it (a coloured map in a white margin), and
  // there are no thick walls.
  let bS = 0;
  let bN = 0;
  const edgePx = (k: number): void => {
    bN++;
    if (sc[k] >= 128 || lumL[k] >= 0.9 * mL) bS++;
  };
  for (let x = 0; x < aw; x++) for (const y of [0, 1, ah - 2, ah - 1]) edgePx(y * aw + x);
  for (let y = 2; y < ah - 2; y++) for (const x of [0, 1, aw - 2, aw - 1]) edgePx(y * aw + x);
  const border = bS / bN;
  let plantA = 0;
  let wintryA = 0;
  let bigObj = 0;
  let nPlants = 0;
  for (let l = 1; l <= nO; l++) {
    const kd = oKind[l];
    if (!kd || kd === K_PROP) continue;
    const a = oArea[l];
    if (a > bigObj) bigObj = a;
    plantA += a;
    nPlants++;
    if (kd === K_CAP) wintryA += a;
    else if (kd === K_EVER && oFrost[l] + oSnow[l] >= 0.1 * a) wintryA += a;
  }
  for (let t = 0; t < nBare; t++) {
    const R = bareList[t * BL + 2];
    const a = 0.5 * R * R;
    plantA += a;
    wintryA += a;
    nPlants++;
  }
  // Broad shading: the spread of the open snow's tone at half a square.
  const sSum = new Float64Array(N);
  const sCnt = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    if (sm[k] && !capM[k]) {
      sSum[k] = lum[k];
      sCnt[k] = 1;
    }
  }
  const rBroad = Math.max(1, Math.round(0.25 * cA));
  blurF(sSum, aw, ah, rBroad);
  blurF(sCnt, aw, ah, rBroad);
  let b1 = 0;
  let b2 = 0;
  let bn = 0;
  for (let k = 0; k < N; k += 3) {
    if (sCnt[k] < 0.5) continue;
    const v = sSum[k] / sCnt[k];
    b1 += v;
    b2 += v * v;
    bn++;
  }
  const broad = bn ? Math.sqrt(Math.max(0, b2 / bn - (b1 / bn) * (b1 / bn))) : 0;
  // Thick walls: dark areas over 0.2 square across.
  const wall = new Uint8Array(N);
  for (let k = 0; k < N; k++) wall[k] = mx[k] < 60 ? 1 : 0;
  erode(wall, Math.max(1, 0.1 * cA), aw, ah, d);
  let nWall = 0;
  for (let k = 0; k < N; k++) nWall += wall[k];
  // What's none of these: not snow, a line, a plant, a tree, earth, ice or water.
  let foreign = 0;
  for (let k = 0; k < N; k++) {
    if (sc[k] >= 64 || ink[k] || oKind[objL[k]] || earth[k] || iceM[k] || wat[k] || treeM[k] || frost[k] || lumL[k] >= 0.9 * mL) continue;
    foreign++;
  }
  const verdict =
    border < 0.3
      ? "border"
      : broad < 2
        ? "broad"
        : nWall > 0.04 * N
          ? "walls"
          : plantA < 0.003 * N || nPlants < 2
            ? "plants"
            : wintryA < 0.25 * plantA
              ? "wintry"
              : bigObj > 0.12 * N
                ? "bigObj"
                : foreign > 0.12 * N
                  ? "foreign"
                  : "";
  if (verdict) return null;

  // 8. The fields.
  const s = new Uint8Array(N * NSN);
  const m = new Uint8Array(N);
  const put = (ch: number, r: number): void => {
    for (let k = 0; k < N; k++) m[k] = m[k] ? 255 : 0;
    if (r > 0) blur8(m, aw, ah, r, m, tmp);
    for (let k = 0, o = ch; k < N; k++, o += NSN) s[o] = m[k];
  };
  const isKind = (k: number, kd: number): boolean => oKind[objL[k]] === kd;
  for (const [ch, kd] of [
    [SN_CROWN, K_CAP],
    [SN_EVER, K_EVER],
    [SN_PROP, K_PROP],
  ]) {
    for (let k = 0; k < N; k++) m[k] = isKind(k, kd) ? 1 : 0;
    put(ch, 1);
  }
  // A patch of grass with its soft painted edge (the pale greens and snow round it).
  for (let k = 0; k < N; k++) m[k] = isKind(k, K_LAWN) ? 1 : 0;
  dilate(m, Math.max(1, 0.12 * cA), aw, ah, d);
  put(SN_LAWN, 1);
  for (let k = 0; k < N; k++) m[k] = iceM[k];
  put(SN_ICE, 1);
  for (let k = 0; k < N; k++) m[k] = wat[k];
  put(SN_WATER, 1);
  for (let k = 0; k < N; k++) m[k] = earth[k];
  put(SN_EARTH, 1);
  // Open ground: everything but crowns, bushes, props, earth, ice and water, reaching a couple
  // of pixels under their rims (the pixel's own colour decides what melts there).
  for (let k = 0; k < N; k++) {
    const kd = oKind[objL[k]];
    m[k] = (kd && kd !== K_LAWN) || iceM[k] || wat[k] ? 0 : 1;
  }
  const core = new Uint8Array(earth);
  erode(core, 1, aw, ah, d);
  for (let k = 0; k < N; k++) if (core[k]) m[k] = 0;
  dilate(m, 2, aw, ah, d);
  put(SN_GROUND, 1);

  // The open snow's own tone: its luma with thin dark lines closed over (a baked grid, outlines),
  // averaged over the open snow only, so a tree's dark rim or a dirt patch doesn't pull the
  // snow's shading down next to it. Against it, a pixel's own detail (grain, grid lines, contour
  // strokes) carries over to what replaces the snow.
  const lc = new Uint8Array(N);
  maxMin3(lum, aw, ah, lc, true);
  maxMin3(lc, aw, ah, m, false);
  sSum.fill(0);
  sCnt.fill(0);
  const hL = new Float64Array(256);
  let nOpen = 0;
  for (let k = 0; k < N; k++) {
    if (!sm[k] || capM[k] || oKind[objL[k]]) continue;
    sSum[k] = m[k];
    sCnt[k] = 1;
    hL[lum[k]]++;
    nOpen++;
  }
  let ref = 255;
  for (let i = 0, acc = 0; i < 256; i++) {
    acc += hL[i];
    if (acc >= 0.85 * nOpen) {
      ref = i;
      break;
    }
  }
  // Where there's no open snow near, the snow's mean over a wider round. (The near mean and how
  // much of it counts wait in the tone channel and lc while the same sums are spread wider.)
  blurF(sSum, aw, ah, 2);
  blurF(sCnt, aw, ah, 2);
  for (let k = 0; k < N; k++) {
    const c = sCnt[k];
    lc[k] = Math.round(255 * ramp(c, 0.04, 0.2));
    s[k * NSN + SN_TONE] = c > 0 ? Math.round(sSum[k] / c) : 0;
    sSum[k] = 0;
    sCnt[k] = 0;
  }
  for (let k = 0; k < N; k++) {
    if (!sm[k] || capM[k] || oKind[objL[k]]) continue;
    sSum[k] = m[k];
    sCnt[k] = 1;
  }
  blurF(sSum, aw, ah, Math.max(2, Math.round(cA)));
  blurF(sCnt, aw, ah, Math.max(2, Math.round(cA)));
  for (let k = 0, o = SN_TONE; k < N; k++, o += NSN) {
    const wide = sCnt[k] > 0.02 ? sSum[k] / sCnt[k] : mL;
    const kk = lc[k] * INV255;
    s[o] = Math.round(s[o] * kk + wide * (1 - kk));
  }

  // 9. Trees: capped crowns, bushes and props as found; bare trees as their trunk and reach.
  const oIdx = new Int32Array(nO + 1);
  let nC = 0;
  for (let l = 1; l <= nO; l++) if (oKind[l] === K_CAP || oKind[l] === K_EVER || oKind[l] === K_PROP) oIdx[l] = ++nC;
  const nT = Math.min(nC + nBare, 65535);
  const acc = new Float64Array((nC + 1) * 8);
  for (let y = 0; y < ah; y++) {
    for (let x = 0, k = y * aw; x < aw; x++, k++) {
      const t = oIdx[objL[k]];
      if (!t) continue;
      const o = t * 8;
      acc[o]++;
      acc[o + 1] += x + 0.5;
      acc[o + 2] += y + 0.5;
      const q = k * 4;
      if (veg[k] && chroma[k] >= 0.22 * mx[k]) {
        acc[o + 3] += rgba[q];
        acc[o + 4] += rgba[q + 1];
        acc[o + 5] += rgba[q + 2];
        acc[o + 6]++;
      }
      if (sc[k] >= 128) acc[o + 7] += lum[k];
    }
  }
  // All the bushes' own green, for a crown with none of its own (a Dungeondraft green when none).
  let er = 0;
  let eg = 0;
  let eb = 0;
  let en = 0;
  for (let t = 1; t <= nC; t++) {
    er += acc[t * 8 + 3];
    eg += acc[t * 8 + 4];
    eb += acc[t * 8 + 5];
    en += acc[t * 8 + 6];
  }
  const EVER_G = en >= 8 ? [er / en, eg / en, eb / en] : [62, 98, 56];
  const trees = new Float32Array(Math.max(1, nT) * TREE_N);
  // (lab is free here.)
  const tlab = lab;
  tlab.fill(0);
  for (let l = 1; l <= nO; l++) {
    const t = oIdx[l];
    if (!t || t > nT) continue;
    const o = t * 8;
    const n = acc[o];
    const b = (t - 1) * TREE_N;
    trees[b] = acc[o + 1] / n;
    trees[b + 1] = acc[o + 2] / n;
    trees[b + 2] = Math.sqrt(n / Math.PI);
    trees[b + 3] = oKind[l];
    for (let c = 0; c < 3; c++) trees[b + 4 + c] = acc[o + 6] >= 4 ? acc[o + 3 + c] / acc[o + 6] : EVER_G[c];
    trees[b + 7] = ref * INV255;
  }
  // A crown's snow: its lit luma (the 85th percentile of its snow pixels, roughly).
  {
    const top = new Float64Array(nC + 1);
    const cnt = new Float64Array(nC + 1);
    for (let k = 0; k < N; k++) {
      const t = oIdx[objL[k]];
      if (!t || sc[k] < 128) continue;
      top[t] += lum[k];
      cnt[t]++;
    }
    for (let t = 1; t <= Math.min(nC, nT); t++) if (cnt[t] >= 4) trees[(t - 1) * TREE_N + 7] = Math.min(1, (1.08 * top[t]) / cnt[t] / 255);
  }
  for (let k = 0; k < N; k++) {
    const t = oIdx[objL[k]];
    if (t && t <= nT) tlab[k] = t;
  }
  for (let i = 0; i < nBare && nC + i < nT; i++) {
    const b = (nC + i) * TREE_N;
    const q = i * BL;
    trees[b] = bareList[q];
    trees[b + 1] = bareList[q + 1];
    trees[b + 2] = bareList[q + 2];
    trees[b + 3] = K_BARE;
    for (let c = 0; c < 3; c++) trees[b + 4 + c] = EVER_G[c];
    trees[b + 7] = ref * INV255;
    for (let di = 0; di < TREE_DIRS; di++) trees[b + 8 + di] = bareList[q + 3 + di];
  }
  // Each pixel near a crown, bush or prop knows it; a bare tree's domain is as far as its leaves
  // may reach (where no crown or bush is nearer).
  const tl = new Uint16Array(N);
  distLabel(tlab, aw, ah, d, stack);
  // (Only a pixel or two past a crown or a bush: their new leaves stay on them.)
  const reachC = Math.max(2, 0.1 * cA) * D1;
  for (let k = 0; k < N; k++) if (stack[k] && d[k] <= reachC) tl[k] = stack[k];
  const best = new Float32Array(N).fill(2);
  for (let t = nC; t < nT; t++) {
    const b = t * TREE_N;
    const cx = trees[b];
    const cy = trees[b + 1];
    let far = 0;
    for (let di = 0; di < TREE_DIRS; di++) if (trees[b + 8 + di] > far) far = trees[b + 8 + di];
    const R = far + 0.4 * cA + 1;
    const x0 = Math.max(0, Math.floor(cx - R));
    const x1 = Math.min(aw - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const y1 = Math.min(ah - 1, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0, k = y * aw + x0; x <= x1; x++, k++) {
        const dn = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / R;
        if (dn >= 1 || dn >= best[k]) continue;
        if (tl[k] && tl[k] <= nC && d[k] <= 0.1 * cA * D1) continue;
        best[k] = dn;
        tl[k] = t + 1;
      }
    }
  }
  // Anything besides open ground here or next door.
  for (let k = 0, o = 0; k < N; k++, o += NSN) {
    m[k] = tl[k] || s[o + SN_CROWN] || s[o + SN_EVER] || s[o + SN_PROP] || s[o + SN_LAWN] || s[o + SN_ICE] || s[o + SN_WATER] || s[o + SN_EARTH] ? 1 : 0;
  }
  dilate(m, 1, aw, ah, d);
  for (let k = 0; k < N; k++) s[k * NSN + SN_OBJ] = m[k] ? 255 : 0;

  // The map's own grass and earth.
  const grass = new Float64Array([98, 128, 60]);
  const earthC = new Float64Array([118, 100, 80]);
  let hasGrass = 0;
  let grassLum = 0.5;
  {
    const gs = [0, 0, 0, 0, 0];
    const es = [0, 0, 0, 0];
    for (let k = 0, o = 0; k < N; k++, o += 4) {
      const kd = oKind[objL[k]];
      const a = kd === K_LAWN && veg[k] ? gs : earth[k] ? es : null;
      if (!a) continue;
      a[0] += rgba[o];
      a[1] += rgba[o + 1];
      a[2] += rgba[o + 2];
      a[3]++;
      if (a === gs) gs[4] += lum[k];
    }
    if (gs[3] >= 0.5 * sq) {
      for (let c = 0; c < 3; c++) grass[c] = gs[c] / gs[3];
      hasGrass = 1;
      grassLum = gs[4] / gs[3] / 255;
    }
    if (es[3] >= sq) for (let c = 0; c < 3; c++) earthC[c] = es[c] / es[3];
  }
  let out = 0;
  for (let k = 0; k < N; k++) if (s[k * NSN + SN_GROUND] >= 128 || oKind[objL[k]] || tl[k]) out++;
  // The snow's colour at its lit tone.
  const snowC = new Float64Array([ref - 4, ref, ref + 4]);
  {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let k = 0, o = 0; k < N; k++, o += 4) {
      if (!sm[k] || capM[k] || oKind[objL[k]] || Math.abs(lum[k] - ref) > 6) continue;
      sr += rgba[o];
      sg += rgba[o + 1];
      sb += rgba[o + 2];
      n++;
    }
    if (n >= 16) {
      snowC[0] = sr / n;
      snowC[1] = sg / n;
      snowC[2] = sb / n;
    }
  }
  return { s, tl, trees, nTrees: nT, ref: ref * INV255, grass, hasGrass, grassLum, earth: earthC, snow: snowC, frac: out / N };
}

// ---------------------------------------------------------------- snowy maps: tiles

// The fine texture of the new ground and leaves comes from small periodic tiles built once per
// seed, so the kernel reads them instead of evaluating noise per pixel: grass (brightness
// detail, blade strokes, colour jitter), leaves (small lens-shaped leaves), and leaf clumps (an
// index of the clumps that may cover each texel; the clumps themselves are evaluated exactly,
// so their edges are sharp at any size).

/** Value noise on a lattice that repeats every n cells, so a tile wraps without a seam. */
class PNoise {
  n: number;
  /** The lattice's values, with the first column and row repeated after the last. */
  v: Float64Array;
  constructor(n: number, seed: number) {
    this.n = n;
    const m = n + 1;
    this.v = new Float64Array(m * m);
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) this.v[y * m + x] = hash2(x % n, y % n, seed);
  }
  at(x: number, y: number): number {
    const n = this.n;
    let ix = Math.floor(x);
    let iy = Math.floor(y);
    let fx = x - ix;
    let fy = y - iy;
    if (ix < 0 || ix >= n) ix = ((ix % n) + n) % n;
    if (iy < 0 || iy >= n) iy = ((iy % n) + n) % n;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const v = this.v;
    const o = iy * (n + 1) + ix;
    const a = v[o];
    const b = v[o + 1];
    const c = v[o + n + 1];
    const d = v[o + n + 2];
    const t = a + (b - a) * fx;
    return t + (c + (d - c) * fx - t) * fy;
  }
}

interface Tile {
  /** Texels a square. */
  res: number;
  /** Side in texels (a power of two), and side - 1. */
  size: number;
  mask: number;
  /** Channel planes, one after another (size * size bytes each). */
  data: Uint8Array;
}

/** Halves a tile, plane by plane (box-filtered). */
function halve(t: Tile, planes: number): Tile {
  const s = t.size >> 1;
  const n = s * s;
  const N0 = t.size * t.size;
  const out = new Uint8Array(n * planes);
  for (let p = 0; p < planes; p++) {
    const src = p * N0;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const a = src + 2 * y * t.size + 2 * x;
        out[p * n + y * s + x] = (t.data[a] + t.data[a + 1] + t.data[a + t.size] + t.data[a + t.size + 1] + 2) >> 2;
      }
    }
  }
  return { res: t.res / 2, size: s, mask: s - 1, data: out };
}

/** The finest mip no finer than about a bake pixel (texels a square <= 1.3 times its pixels a square). */
function pickMip(ts: Tile[], ppsq: number): Tile {
  for (const t of ts) if (t.res <= ppsq * 1.3) return t;
  return ts[ts.length - 1];
}

/** Keeps the last two seeds' tiles (a scene switches between two at most). */
function lru<T>(cache: Map<number, T>, seed: number, make: () => T): T {
  const hit = cache.get(seed);
  if (hit) {
    cache.delete(seed);
    cache.set(seed, hit);
    return hit;
  }
  const v = make();
  cache.set(seed, v);
  while (cache.size > 2) cache.delete(cache.keys().next().value as number);
  return v;
}

/**
 * Grass tile planes: brightness detail with blade strokes (128 = none), the mottles alone (128 =
 * none), blade roll, colour jitter (128 = none), and drought cracks (0 none, 255 a crack's middle).
 */
const GT_LUM = 0;
const GT_MOT = 1;
const GT_ID = 2;
const GT_JIT = 3;
const GT_CRK = 4;
const GT_PLANES = 5;
const GT_SQ = 4;
const GT_RES = 128;

const grassCache = new Map<number, Tile[]>();
function grassTiles(seed: number): Tile[] {
  return lru(grassCache, seed, () => {
    const S = GT_SQ * GT_RES;
    const lumD = new Float32Array(S * S);
    const mot = new Uint8Array(S * S);
    const blade = new Float32Array(S * S);
    const bid = new Uint8Array(S * S);
    const jit = new Uint8Array(S * S);
    const s1 = mix(seed, 201);
    const s2 = mix(seed, 202);
    const s3 = mix(seed, 203);
    const s4 = mix(seed, 204);
    const s5 = mix(seed, 205);
    // Mottles at 2, 5 and 12 a square, and grain at 32.
    const n1 = new PNoise(2 * GT_SQ, s1);
    const n2 = new PNoise(5 * GT_SQ, s2);
    const n3 = new PNoise(12 * GT_SQ, s3);
    const n4 = new PNoise(32 * GT_SQ, s4);
    const n5 = new PNoise(3 * GT_SQ, s5);
    for (let y = 0; y < S; y++) {
      const w = y / GT_RES;
      for (let x = 0; x < S; x++) {
        const u = x / GT_RES;
        const k = y * S + x;
        const m =
          0.07 * (n1.at(u * 2, w * 2) - 0.5) + 0.06 * (n2.at(u * 5, w * 5) - 0.5) + 0.05 * (n3.at(u * 12, w * 12) - 0.5);
        mot[k] = Math.round(128 + 255 * m);
        lumD[k] = m + 0.045 * (n4.at(u * 32, w * 32) - 0.5);
        jit[k] = Math.round(255 * n5.at(u * 3, w * 3));
      }
    }
    // Blades: short tapered strokes, most leaning one way, darker (some lighter) than the grass.
    const nB = GT_SQ * GT_SQ * 150;
    const sb = mix(seed, 206);
    for (let i = 0; i < nB; i++) {
      const cx = hash2(i, 1, sb) * S;
      const cy = hash2(i, 2, sb) * S;
      const ai = (8 + ((hash2(i, 3, sb) * 18) | 0)) % 32;
      const dx = ANG[ai * 2];
      const dy = -ANG[ai * 2 + 1];
      const len = (0.045 + 0.05 * hash2(i, 4, sb)) * GT_RES;
      const wid = (0.011 + 0.006 * hash2(i, 5, sb)) * GT_RES;
      const tone = hash2(i, 6, sb) < 0.62 ? -0.13 : 0.1;
      const id = (hash2(i, 7, sb) * 255) | 0;
      const x0 = Math.floor(cx - len - 2);
      const x1 = Math.ceil(cx + len + 2);
      const y0 = Math.floor(cy - len - 2);
      const y1 = Math.ceil(cy + len + 2);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - cx;
          const py = y + 0.5 - cy;
          let t = (px * dx + py * dy) / len;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const qx = px - dx * t * len;
          const qy = py - dy * t * len;
          const cov = 0.5 * wid * (1 - 0.75 * t) + 0.75 - Math.sqrt(qx * qx + qy * qy);
          if (cov <= 0) continue;
          const cv = cov > 1 ? 1 : cov;
          const k = (y & (S - 1)) * S + (x & (S - 1));
          lumD[k] += tone * cv;
          if (cv > blade[k]) {
            blade[k] = cv;
            if (cv > 0.5) bid[k] = id;
          }
        }
      }
    }
    const n = S * S;
    const data = new Uint8Array(n * GT_PLANES);
    for (let k = 0; k < n; k++) {
      const v = 128 + 255 * lumD[k];
      data[GT_LUM * n + k] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      data[GT_MOT * n + k] = mot[k];
      data[GT_ID * n + k] = bid[k];
      data[GT_JIT * n + k] = jit[k];
    }
    cracks(data.subarray(GT_CRK * n, GT_CRK * n + n), S, mix(seed, 207));
    const t0: Tile = { res: GT_RES, size: S, mask: S - 1, data };
    const t1 = halve(t0, GT_PLANES);
    const t2 = halve(t1, GT_PLANES);
    return [t0, t1, t2];
  });
}

/**
 * Drought cracks into out (S x S texels, GT_RES a square, repeating): the edges of polygons a
 * third of a square across (a Voronoi pattern), with finer cracks across some of them, both broken
 * off in places.
 */
function cracks(out: Uint8Array, S: number, seed: number): void {
  const levels: [number, number, number][] = [
    // Cells a square, line half-width (squares), how much of it is broken off.
    [3, 0.011, 0.25],
    [7, 0.006, 0.55],
  ];
  const acc = new Float32Array(S * S);
  for (const [cells, hw, broken] of levels) {
    // The cells' points, with a border of the far side's (the tile repeats).
    const n = cells * GT_SQ;
    const m = n + 2;
    const px = new Float64Array(m * m);
    const py = new Float64Array(m * m);
    const sd = mix(seed, cells);
    for (let j = -1; j <= n; j++) {
      for (let i = -1; i <= n; i++) {
        const iw = (i + n) % n;
        const jw = (j + n) % n;
        px[(j + 1) * m + i + 1] = (i + 0.15 + 0.7 * hash2(iw, jw, sd)) / cells;
        py[(j + 1) * m + i + 1] = (j + 0.15 + 0.7 * hash2(iw, jw, sd ^ 0x51ed)) / cells;
      }
    }
    const keepN = new PNoise(2.5 * GT_SQ, mix(seed, cells + 100));
    const far = hw + 0.625 / GT_RES;
    for (let y = 0; y < S; y++) {
      const v = (y + 0.5) / GT_RES;
      const cj = Math.floor(v * cells);
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / GT_RES;
        const ci = Math.floor(u * cells);
        // The nearest two points (F1, F2): a crack runs where they're about as near.
        let f1 = 1e9;
        let f2 = 1e9;
        for (let dj = 0; dj <= 2; dj++) {
          const row = (cj + dj) * m + ci;
          for (let di = 0; di <= 2; di++) {
            const dx = u - px[row + di];
            const dy = v - py[row + di];
            const d = dx * dx + dy * dy;
            if (d < f1) {
              f2 = f1;
              f1 = d;
            } else if (d < f2) f2 = d;
          }
        }
        // (Half the gap between them: about the distance to the edge between the two cells.)
        const e = 0.5 * (Math.sqrt(f2) - Math.sqrt(f1));
        if (e >= far) continue;
        const k = clamp01((hw - e) * GT_RES * 0.8 + 0.5);
        const keep = keepN.at(u * 2.5, v * 2.5);
        const a = k * ramp(keep, broken - 0.06, broken + 0.06);
        const o = y * S + x;
        if (a > acc[o]) acc[o] = a;
      }
    }
  }
  for (let o = 0; o < S * S; o++) out[o] = Math.round(255 * acc[o]);
}

const LT_SQ = 2;
const LT_RES = 128;
const leafCache = new Map<number, Tile[]>();
/** Leaf detail (128 = none): small lens-shaped leaves, lighter or darker, lit on their upper left. */
function leafTiles(seed: number): Tile[] {
  return lru(leafCache, seed, () => {
    const S = LT_SQ * LT_RES;
    const leaf = new Float32Array(S * S);
    const sl = mix(seed, 302);
    const nLeaf = LT_SQ * LT_SQ * 700;
    for (let i = 0; i < nLeaf; i++) {
      const cx = hash2(i, 1, sl) * S;
      const cy = hash2(i, 2, sl) * S;
      const ai = (hash2(i, 3, sl) * 32) | 0;
      const ca = ANG[ai * 2];
      const sa = ANG[ai * 2 + 1];
      const len = (0.026 + 0.016 * hash2(i, 4, sl)) * LT_RES;
      const wid = len * 0.45;
      const tone = hash2(i, 5, sl) < 0.5 ? -0.8 : 0.7;
      const x0 = Math.floor(cx - len - 1);
      const x1 = Math.ceil(cx + len + 1);
      const y0 = Math.floor(cy - len - 1);
      const y1 = Math.ceil(cy + len + 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const p = (dx * ca + dy * sa) / len;
          const q = (dy * ca - dx * sa) / wid;
          const e = p * p + q * q;
          if (e >= 1) continue;
          const k = (y & (S - 1)) * S + (x & (S - 1));
          const cv = clamp01((1 - e) * 2.5);
          const tilt = 0.25 * (-(dx * 0.55 + dy * 0.83) / len);
          leaf[k] += (tone + tilt - leaf[k]) * cv;
        }
      }
    }
    const data = new Uint8Array(S * S);
    for (let k = 0; k < S * S; k++) {
      const v = 128 + 127 * leaf[k];
      data[k] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
    const t0: Tile = { res: LT_RES, size: S, mask: S - 1, data };
    const t1 = halve(t0, 1);
    return [t0, t1, halve(t1, 1)];
  });
}

const CL_SQ = 4;
/** How far a clump's leafy edge reaches past its radius. */
const CL_LOBE = 0.22;

interface ClumpSet {
  /** Centre (tile squares), radius, height above the others, roll, colour patch (0-1), fall order. */
  cx: Float64Array;
  cy: Float64Array;
  rc: Float64Array;
  z0: Float64Array;
  id: Float64Array;
  patch: Float64Array;
  fall: Float64Array;
  /** 1 / radius². */
  irc2: Float64Array;
}

const clumpCache = new Map<number, ClumpSet>();
/** Leaf clumps (domes) on a jittered grid, overlapping about three deep, repeating every CL_SQ squares. */
function clumpSet(seed: number): ClumpSet {
  return lru(clumpCache, seed, () => {
    const cell = 0.25;
    const nc = Math.round(CL_SQ / cell);
    const n = nc * nc;
    const cx = new Float64Array(n);
    const cy = new Float64Array(n);
    const rc = new Float64Array(n);
    const z0 = new Float64Array(n);
    const id = new Float64Array(n);
    const patch = new Float64Array(n);
    const fall = new Float64Array(n);
    const sc = mix(seed, 301);
    const sf = mix(seed, 304);
    const pN = new PNoise(5, mix(seed, 303));
    const fN = new PNoise(6, sf);
    for (let j = 0; j < nc; j++) {
      for (let i = 0; i < nc; i++) {
        const c = j * nc + i;
        cx[c] = (i + 0.5 + 0.85 * (hash2(i, j, sc) - 0.5)) * cell;
        cy[c] = (j + 0.5 + 0.85 * (hash2(i, j, sc ^ 0x51ed) - 0.5)) * cell;
        rc[c] = 0.17 + 0.08 * hash2(i, j, sc ^ 0x1234);
        z0[c] = 0.55 * hash2(i, j, sc ^ 0x7777);
        id[c] = hash2(i, j, sc ^ 0x2545);
        patch[c] = rank(RANK_OCTAVE, pN.at(cx[c] * 1.25, cy[c] * 1.25));
        fall[c] = rank2(0.55 * rank(RANK_OCTAVE, fN.at(cx[c] * 1.5, cy[c] * 1.5)) + 0.45 * hash2(i, j, sf), 0.55, 0.45);
      }
    }
    const irc2 = new Float64Array(n);
    for (let c = 0; c < n; c++) irc2[c] = 1 / (rc[c] * rc[c]);
    return { cx, cy, rc, z0, id, patch, fall, irc2 };
  });
}

let meltLut: Uint8Array | null = null;
/** Per colour (6 bits a channel), how much it melts: snow, greys and the lines drawn on them (not earth, wood, leaves or ink). */
function meltTable(): Uint8Array {
  if (meltLut) return meltLut;
  const t = new Uint8Array(64 * 64 * 64);
  for (let ri = 0; ri < 64; ri++) {
    for (let gi = 0; gi < 64; gi++) {
      for (let bi = 0; bi < 64; bi++) {
        const r = ri * 4 + 2;
        const g = gi * 4 + 2;
        const b = bi * 4 + 2;
        const max = Math.max(r, g, b);
        const c = max - Math.min(r, g, b);
        const v = max / 255;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // (Blue-grey shade may be quite colourful and still snow.)
        const neutral = b >= g && b >= r ? 1 - ramp(c / max, 0.3, 0.4) : 1 - ramp(c, 12 + 18 * v, 20 + 22 * v);
        const cool = ramp(b - r, -12, -5);
        const green = g > r + 4 && g > b + 2 ? ramp(c / max, 0.1, 0.18) : 0;
        // (Ink never melts: nothing as dark as the guard keeps.)
        t[(ri << 12) | (gi << 6) | bi] = v < 0.14 ? 0 : Math.round(255 * neutral * cool * (1 - green) * ramp(lum, 0.12, 0.22));
      }
    }
  }
  meltLut = t;
  return t;
}

// ---------------------------------------------------------------- snowy maps: per-look fields

/** Look field channels (at analysis resolution). */
const MC = 6;
/** Broad colour variation (yellower or bluer greens), a rank. */
const M_VAR = 0;
/** The look's patches: sprouts (spring), dry grass (summer), straw (autumn); a rank. */
const M_P1 = 1;
/** Bare earth (summer); a rank. */
const M_P2 = 2;
/** Remnant snow (spring) or drifts on grass and earth (winter): 128 at the level's threshold. */
const M_REM = 3;
/** The soft shadow new foliage casts. */
const M_SHD = 4;
/** Next to a tree (fallen leaves gather there). */
const M_NEAR = 5;

/** Floats per tree in SnowFields.tp. */
const TP = 44;
// 0 cos, 1 sin, 2 1/scale, 3-4 clump tile offset (tile squares), 5 roll, 6-9 autumn cumulative
// shares (green, +yellow, +orange, +red), 10-12 leaf RGB, 13 in blossom, 14 leaf share, 15
// scale, 16-31 a bare tree's reach per direction (squares), 32 radius (squares), 33-34 centre
// (squares), 35 kind, 36 its snow's lit luma, 37-39 its own green (RGB), 40 that green's
// saturation, 41 how far its clumps can reach from its centre, 42 how far past its reach
// (squares).
const TP_REACH = 16;

interface SnowFields {
  key: string;
  f: Uint8Array;
  tp: Float64Array;
  /** Ground colours: base, broad variation, fine jitter, patch colour, earth patch colour (RGB each). */
  gBase: Float64Array;
  gVar: Float64Array;
  gJit: Float64Array;
  gP1: Float64Array;
  gP2: Float64Array;
  p1Share: number;
  p1Amt: number;
  p2Share: number;
  /** The analysis channels this map has anything in (SN_*). */
  has: Uint8Array;
  /** Per tree, the leaf clumps still on it (see treeIndex), made when a bake first needs them. */
  ix: (TreeIndex | null)[];
  /** Whether new foliage casts any shadow. */
  anyShd: boolean;
  /** The snow's own colour at its lit tone (RGB). */
  snow: Float64Array;
}

const snowFieldCache = new WeakMap<SnowInfo, SnowFields>();

function snowFields(o: BakeOptions): SnowFields {
  const sn = o.a.snow as SnowInfo;
  const key = `${o.look}|${o.level}|${o.seed | 0}|${o.cell}|${o.sceneW}|${o.sceneH}`;
  const hit = snowFieldCache.get(sn);
  if (hit && hit.key === key) return hit;
  const sf = buildSnowFields(o, key);
  snowFieldCache.set(sn, sf);
  return sf;
}

function lerp3(out: Float64Array, a: Tri | Float64Array, b: Tri | Float64Array, t: number): void {
  for (let ch = 0; ch < 3; ch++) out[ch] = a[ch] + (b[ch] - a[ch]) * t;
}

const LEAF_SUMMER: Tri = [72, 112, 42];
const LEAF_SPRING: Tri = [112, 158, 56];
/** Autumn leaves: still green, yellow, orange, red, withered brown. */
const AUT_LEAF: readonly Tri[] = [
  [104, 126, 48],
  [226, 184, 56],
  [218, 124, 38],
  [182, 56, 32],
  [132, 88, 44],
];
const G_LUSH: Tri = [84, 122, 44];
const G_FRESH: Tri = [108, 146, 56];
const G_OLIVE: Tri = [130, 126, 62];
const G_STRAW: Tri = [194, 168, 100];
const G_AUT3: Tri = [138, 114, 62];
const G_WET: Tri = [94, 80, 60];
const G_MATTED: Tri = [124, 116, 76];
const G_SHOOT: Tri = [136, 166, 78];

/** How much of its leaf a tree of this kind carries in this look (0 none). */
function leafShare(look: SeasonLook, L: number, kind: number): number {
  const P = SEASON_PARAMS;
  if (look === "summer") return P.summer.leaves[L];
  if (look === "autumn") return kind === K_BARE ? P.autumn.treeLeaves[L] : P.autumn.capLeaves[L];
  if (look === "spring") return kind === K_BARE ? P.spring.leaves[L] : P.spring.capMelt[L];
  return 0;
}

function buildSnowFields(o: BakeOptions, key: string): SnowFields {
  const a = o.a;
  const sn = a.snow as SnowInfo;
  const L = o.level - 1;
  const look = o.look;
  const seed = o.seed | 0;
  const aw = a.aw;
  const ah = a.ah;
  const N = aw * ah;
  const toU = o.sceneW / (aw * o.cell);
  const toW = o.sceneH / (ah * o.cell);
  const S = sn.s;
  const P = SEASON_PARAMS;
  const f = new Uint8Array(N * MC);
  const has = new Uint8Array(NSN);
  for (let k = 0; k < N; k++) for (let c = 0; c < NSN; c++) if (S[k * NSN + c]) has[c] = 1;

  // Broad variation and the look's patches: ranks of soft noise.
  const varN = new Fbm(0.3, mix(seed, 71));
  const p1N = new Fbm(look === "spring" ? 0.8 : 0.5, mix(seed, 72));
  const p2N = new Fbm(0.42, mix(seed, 73));
  for (let y = 0; y < ah; y++) {
    const w = (y + 0.5) * toW;
    for (let x = 0, k = y * aw; x < aw; x++, k++) {
      const u = (x + 0.5) * toU;
      const b = k * MC;
      f[b + M_VAR] = Math.round(255 * rank(RANK_FBM, varN.at(u, w)));
      if (look !== "winter") f[b + M_P1] = Math.round(255 * rank(RANK_FBM, p1N.at(u, w)));
      if (look === "summer") f[b + M_P2] = Math.round(255 * rank(RANK_FBM, p2N.at(u, w)));
    }
  }
  // Remnant snow (spring) and drifts (winter): where the snow is most shaded and on the shadow
  // side of what stands in it, broken up by soft noise; the level's share, by rank.
  const share = look === "spring" ? P.spring.remnant[L] : look === "winter" ? P.winter.drift[L] : 0;
  if (share > 0) {
    const rn = new Fbm(0.45, mix(seed, 51));
    const ref = sn.ref * 255;
    const sc = new Float64Array(N);
    const hist = new Float64Array(512);
    let tot = 0;
    // (The shadow side of objects: down and to the right, as maps are lit. But not right round
    // them: no crescents of snow hugging a tree.)
    const sh = Math.max(1, Math.round(0.3 * a.cellA));
    const near = new Uint8Array(N);
    for (let k = 0; k < N; k++) near[k] = Math.max(S[k * NSN + SN_CROWN], S[k * NSN + SN_EVER], S[k * NSN + SN_PROP]) >= 128 ? 1 : 0;
    // (And a bare tree's dense middle, where its new leaves will be.)
    for (let t = 0; t < sn.nTrees; t++) {
      const tb = t * TREE_N;
      if (sn.trees[tb + 3] !== K_BARE) continue;
      const cx = sn.trees[tb];
      const cy = sn.trees[tb + 1];
      const rr = 0.25 * sn.trees[tb + 2];
      for (let y = Math.max(0, Math.floor(cy - rr)); y <= Math.min(ah - 1, Math.ceil(cy + rr)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rr)); x <= Math.min(aw - 1, Math.ceil(cx + rr)); x++) {
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr) near[y * aw + x] = 1;
        }
      }
    }
    const dd = new Int32Array(N);
    const lateSpring = look === "spring" && L > 0;
    const farD = 0.4 * a.cellA * D1;
    // (The snow's shade softened over half a square, so how a browser shrank the map, sharper
    // or softer, hardly moves where the drifts lie.)
    const tone = new Float64Array(N);
    for (let k = 0; k < N; k++) tone[k] = S[k * NSN + SN_TONE];
    blurF(tone, aw, ah, Math.max(1, Math.round(0.5 * a.cellA)));
    distTo(near, 1, aw, ah, dd);
    for (let y = 0; y < ah; y++) {
      const w = (y + 0.5) * toW;
      for (let x = 0, k = y * aw; x < aw; x++, k++) {
        const s = k * NSN;
        // (In spring, frozen water too: its floes last as long as the drifts.)
        const g = look === "winter" ? Math.max(S[s + SN_LAWN], S[s + SN_EARTH]) : Math.max(S[s + SN_GROUND], S[s + SN_ICE]);
        if (g < 16) continue;
        const shade = ramp((ref - tone[k]) / ref, 0, 0.25);
        const kb = y >= sh && x >= sh ? (y - sh) * aw + x - sh : -1;
        const lee = kb >= 0 && S[kb * NSN + SN_OBJ] && !S[s + SN_OBJ] ? 1 : 0;
        const v = 0.62 * shade + 0.3 * rank(RANK_FBM, rn.at((x + 0.5) * toU, w)) + 0.08 * lee - (look === "spring" && L === 0 ? 0.1 * (1 - ramp(dd[k] / D1 / a.cellA, 0.1, 0.5)) : 0);
        sc[k] = v;
        // (Later in spring the last drifts lie out in the open: what's by a tree doesn't count.)
        if (lateSpring && dd[k] < farD) continue;
        hist[v <= 0 ? 0 : Math.min(511, Math.floor(v * 512))] += g;
        tot += g;
      }
    }
    if (look === "winter") {
      // Winter: each pixel's rank (the kernel covers the grass first, then the earth).
      const cdf = new Float64Array(513);
      for (let i = 0; i < 512; i++) cdf[i + 1] = cdf[i] + hist[i];
      for (let k = 0; k < N; k++) {
        if (!sc[k]) continue;
        const v = sc[k] <= 0 ? 0 : sc[k] >= 1 ? 511.99 : sc[k] * 512;
        const i = Math.floor(v);
        f[k * MC + M_REM] = Math.round((255 * (cdf[i] + hist[i] * (v - i))) / Math.max(1, tot));
      }
    } else {
      let thr = 1;
      let acc = 0;
      for (let i = 511; i >= 0; i--) {
        acc += hist[i];
        if (acc >= share * tot) {
          thr = i / 512;
          break;
        }
      }
      for (let k = 0; k < N; k++) if (sc[k]) f[k * MC + M_REM] = Math.max(0, Math.min(255, Math.round(128 + (sc[k] - thr) * 260)));
      if (lateSpring) {
        // A drift (with its wet rim) that reaches a tree melts whole: no crescent of snow is left
        // hugging a trunk.
        const dm = new Uint8Array(N);
        for (let k = 0; k < N; k++) dm[k] = sc[k] && sc[k] >= thr - 0.06 ? 1 : 0;
        const lab = new Int32Array(N);
        const nD = label4(dm, aw, ah, lab, new Int32Array(N));
        const byTree = new Uint8Array(nD + 1);
        for (let k = 0; k < N; k++) if (lab[k] && dd[k] < farD) byTree[lab[k]] = 1;
        for (let k = 0; k < N; k++) if (byTree[lab[k]]) f[k * MC + M_REM] = Math.min(f[k * MC + M_REM], 60);
      }
    }
  }

  // Trees: each leans its own way, from values tied to where it stands (to the nearest square,
  // so a tree found a little off elsewhere looks the same).
  const nT = sn.nTrees;
  const tp = new Float64Array(Math.max(1, nT) * TP);
  const A = P.autumn;
  const shd = new Float64Array(N);
  const near = new Float64Array(N);
  const leafScale = look === "spring" ? P.spring.leafScale[L] : 1;
  const ts = mix(seed, 141);
  for (let t = 0; t < nT; t++) {
    const tb = t * TREE_N;
    const cx = sn.trees[tb];
    const cy = sn.trees[tb + 1];
    const cu = cx * toU;
    const cw = cy * toW;
    const R = sn.trees[tb + 2] * toU;
    const kind = sn.trees[tb + 3];
    const qx = Math.floor(cu);
    const qy = Math.floor(cw);
    const bias = hash2(qx, qy, ts ^ 0x11);
    const warm = hash2(qx, qy, ts ^ 0x22);
    const q = t * TP;
    const ai = (hash2(qx, qy, ts ^ 0x33) * 32) | 0;
    tp[q] = ANG[ai * 2];
    tp[q + 1] = ANG[ai * 2 + 1];
    // Clumps scale with the tree: a sapling's are small, a big oak's bigger.
    const sc = Math.max(0.5, Math.min(1.5, 0.35 + 0.35 * R)) * leafScale;
    tp[q + 2] = 1 / sc;
    tp[q + 15] = sc;
    tp[q + 3] = hash2(qx, qy, ts ^ 0x44) * CL_SQ;
    tp[q + 4] = hash2(qx, qy, ts ^ 0x55) * CL_SQ;
    tp[q + 5] = hash2(qx, qy, ts ^ 0x66);
    // Autumn: the level's shares, each tree greener or further on (0.6-1.4 times the green) and
    // warmer or more golden. Red stays at most about a third, so no tree is all red, and every
    // tree keeps some green.
    const g0 = Math.max(0.06, Math.min(0.85, A.treeGreen[L] * (0.6 + 0.8 * bias)));
    let yy = A.yellow[L] * (1.3 - 0.6 * warm);
    const oo = A.orange[L];
    let rr = A.red[L] * (0.7 + 0.6 * warm);
    const tsum = yy + oo + rr;
    const rest = 1 - g0;
    yy = (yy / tsum) * rest;
    let o2 = (oo / tsum) * rest;
    rr = (rr / tsum) * rest;
    if (rr > 0.33) {
      o2 += rr - 0.33;
      rr = 0.33;
    }
    tp[q + 6] = g0;
    tp[q + 7] = g0 + yy;
    tp[q + 8] = g0 + yy + o2;
    tp[q + 9] = g0 + yy + o2 + rr;
    // Leaf colour: the look's green, each tree a little yellower or bluer, lighter or darker.
    const base = look === "spring" ? LEAF_SPRING : LEAF_SUMMER;
    const ol = look === "summer" ? P.summer.leafOlive[L] : 0;
    const hv = (bias - 0.5) * 2;
    const vv = 1 + (warm - 0.5) * 0.24;
    tp[q + 10] = (base[0] + 12 * hv + (148 - base[0]) * ol) * vv;
    tp[q + 11] = (base[1] + 5 * hv + (140 - base[1]) * ol) * vv;
    tp[q + 12] = (base[2] - 8 * hv + (64 - base[2]) * ol) * vv;
    tp[q + 13] = look === "spring" && hash2(qx, qy, ts ^ 0x77) < P.spring.bloomTrees[L] ? 1 : 0;
    const ls = leafShare(look, L, kind);
    tp[q + 14] = ls;
    for (let di = 0; di < TREE_DIRS; di++) tp[q + TP_REACH + di] = (kind === K_BARE ? sn.trees[tb + 8 + di] : sn.trees[tb + 2]) * toU;
    tp[q + 32] = R;
    tp[q + 33] = cu;
    tp[q + 34] = cw;
    tp[q + 35] = kind;
    tp[q + 36] = sn.trees[tb + 7];
    {
      const g0r = sn.trees[tb + 4];
      const g1 = sn.trees[tb + 5];
      const g2 = sn.trees[tb + 6];
      const gv = Math.max(g0r, g1, g2) * INV255;
      hsv(hueOf(g0r, g1, g2), Math.max(0.45, satOf(g0r, g1, g2)), gv < 0.3 ? 0.3 : gv > 0.58 ? 0.58 : gv);
      tp[q + 37] = HSV_OUT[0];
      tp[q + 38] = HSV_OUT[1];
      tp[q + 39] = HSV_OUT[2];
      tp[q + 40] = satOf(HSV_OUT[0], HSV_OUT[1], HSV_OUT[2]);
    }
    {
      let far = 0;
      for (let di = 0; di < TREE_DIRS; di++) far = Math.max(far, tp[q + TP_REACH + di]);
      // (A clump's centre within the reach, and the clump round it with its lobes.)
      tp[q + 42] = 0.25 * (1 + CL_LOBE) * sc + 0.02;
      tp[q + 43] = R > 0 ? 1 / R : 1;
      tp[q + 41] = far * 1.15 * leafScale + tp[q + 42];
    }
    // Fallen leaves gather under trees; new foliage casts a soft shadow down and to the right.
    if (kind === K_EVER || kind === K_PROP) continue;
    const Ra = sn.trees[tb + 2];
    let far = Ra;
    if (kind === K_BARE) for (let di = 0; di < TREE_DIRS; di++) far = Math.max(far, sn.trees[tb + 8 + di]);
    const reach = far * 1.3 + 1;
    const cover = look === "winter" ? 0 : kind === K_BARE ? ls * (1 - 0.35 * (1 - ls)) : 0;
    const rs = kind === K_BARE ? 0.75 * far : Ra;
    const sx = cx + 0.1 * rs + 0.12 / toU;
    const sy = cy + 0.15 * rs + 0.16 / toW;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(aw - 1, Math.ceil(cx + reach + 0.3 * rs));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(ah - 1, Math.ceil(cy + reach + 0.3 * rs));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0, k = y * aw + x0; x <= x1; x++, k++) {
        const dn = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / reach;
        if (dn < 1 && 1 - dn * dn > near[k]) near[k] = 1 - dn * dn;
        if (cover > 0) {
          const ds = Math.sqrt((x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2) / rs;
          const v = cover * (1 - ramp(ds, 0.55, 1.05));
          if (v > shd[k]) shd[k] = v;
        }
      }
    }
  }
  blurF(shd, aw, ah, Math.max(1, Math.round(0.15 / toU)));
  let anyShd = false;
  for (let k = 0; k < N && !anyShd; k++) if (shd[k] > 0.002) anyShd = true;
  for (let k = 0; k < N; k++) {
    f[k * MC + M_SHD] = Math.round(255 * clamp01(shd[k]));
    f[k * MC + M_NEAR] = Math.round(255 * near[k]);
  }

  // The ground's colours for this look and level.
  const gBase = new Float64Array(3);
  const gP1 = new Float64Array(3);
  const gP2 = new Float64Array(3);
  let p1Share = 0;
  let p1Amt = 0;
  let p2Share = 0;
  if (look === "spring") {
    if (L === 0) {
      // Last year's grass, with wet earth in patches (fresh green tufts are added per pixel).
      gBase.set(G_MATTED);
      gP1.set(G_WET);
      p1Share = 0.4;
      p1Amt = 0.8;
    } else {
      lerp3(gBase, G_FRESH, G_LUSH, L === 1 ? 0.2 : 0.45);
      lerp3(gP1, G_FRESH, [150, 176, 70], 0.6);
      p1Share = 0.3;
      p1Amt = 0.45;
    }
  } else if (look === "summer") {
    if (L === 0) gBase.set(G_LUSH);
    else lerp3(gBase, G_LUSH, G_OLIVE, L === 1 ? 0.35 : 0.7);
    lerp3(gP1, G_OLIVE, G_STRAW, L === 1 ? 0.45 : 0.85);
    p1Share = P.summer.dry[L];
    p1Amt = 0.75;
    lerp3(gP2, sn.earth, [176, 146, 104], 0.55);
    p2Share = P.summer.bare[L];
  } else if (look === "autumn") {
    if (L === 2) lerp3(gBase, G_OLIVE, G_AUT3, 0.55);
    else lerp3(gBase, G_LUSH, G_OLIVE, L === 0 ? 0.45 : 0.8);
    lerp3(gP1, G_OLIVE, G_STRAW, 0.35 + 0.25 * L);
    p1Share = P.autumn.straw[L];
    p1Amt = 0.62;
  }
  // A little of the map's own grass, so the new ground belongs to the map.
  if (sn.hasGrass && look !== "winter" && !(look === "spring" && L === 0)) {
    const g = sn.grass;
    const oc = Math.max(g[0], g[1], g[2]);
    const bc = Math.max(gBase[0], gBase[1], gBase[2]);
    for (let ch = 0; ch < 3; ch++) gBase[ch] += ((g[ch] / oc) * bc - gBase[ch]) * 0.15;
  }
  return {
    key,
    f,
    tp,
    gBase,
    gVar: new Float64Array([22, 16, -8]),
    gJit: new Float64Array([16, 10, -8]),
    gP1,
    gP2,
    p1Share,
    p1Amt,
    p2Share,
    has,
    ix: new Array<TreeIndex | null>(nT).fill(null),
    anyShd,
    snow: sn.snow,
  };
}

// ---------------------------------------------------------------- snowy maps: the strip's fields

// Row buffer slots: the snow analysis's channels (SN_*, same numbers), then the look's (M_*).
const Q_LOOK = NSN;
/** 1 / the snow's tone (so a pixel's detail against it needs no division). */
const Q_ITONE = NSN + MC;
const QC = NSN + MC + 1;

/**
 * The fields for a strip, blended per row as Frame does: only the channels in use, and the
 * objects' channels only where SN_OBJ says there are any (elsewhere they read 0).
 */
class SnowFrame {
  S: Uint8Array;
  M: Uint8Array;
  sAct: Int32Array;
  mAct: Int32Array;
  oAct: Int32Array;
  aw: number;
  ah: number;
  rb: Float64Array;
  colI: Int32Array;
  colF: Float64Array;
  colU: Float64Array;
  colQ: Int32Array;
  ix0: number;
  ix1: number;
  y0: number;
  scale: number;
  ky: number;
  inv: number;
  w = 0;
  rowQ = 0;
  lastIy = -1;
  lastFy = -1;
  constructor(o: BakeOptions, width: number, M: Uint8Array, sAct: number[], mAct: number[], oAct: number[]) {
    const a = o.a;
    this.S = (a.snow as SnowInfo).s;
    this.M = M;
    this.sAct = Int32Array.from(sAct.filter((ch) => !oAct.includes(ch)));
    this.oAct = Int32Array.from(oAct.filter((ch) => sAct.includes(ch)));
    this.mAct = Int32Array.from(mAct);
    this.aw = a.aw;
    this.ah = a.ah;
    this.y0 = o.y0;
    this.scale = o.scale;
    this.ky = a.ah / o.sceneH;
    this.inv = 1 / o.cell;
    const kx = a.aw / o.sceneW;
    const aw = a.aw;
    this.colI = new Int32Array(width);
    this.colF = new Float64Array(width);
    this.colU = new Float64Array(width);
    this.colQ = new Int32Array(width);
    let ix0 = aw;
    let ix1 = 0;
    const ixs = new Int32Array(width);
    for (let i = 0; i < width; i++) {
      const sx = snap(o.x0 + (i + 0.5) * o.scale);
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
    for (let i = 0; i < width; i++) this.colI[i] = (ixs[i] - ix0) * QC;
    this.rb = new Float64Array((ix1 - ix0 + 2) * QC);
  }
  row(j: number): void {
    const aw = this.aw;
    const ah = this.ah;
    const sy = snap(this.y0 + (j + 0.5) * this.scale);
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
    const S = this.S;
    const M = this.M;
    const rb = this.rb;
    const sAct = this.sAct;
    const mAct = this.mAct;
    const oAct = this.oAct;
    const ns = sAct.length;
    const nm = mAct.length;
    const no = oAct.length;
    for (let c = this.ix0, o = 0; c <= this.ix1; c++, o += QC) {
      const cc = c < aw ? c : aw - 1;
      const k0 = iy * aw + cc;
      const k1 = iy1 * aw + cc;
      const s0 = k0 * NSN;
      const s1 = k1 * NSN;
      for (let t = 0; t < ns; t++) {
        const ch = sAct[t];
        const v0 = S[s0 + ch];
        rb[o + ch] = (v0 + (S[s1 + ch] - v0) * fy) * INV255;
      }
      const tn = rb[o + SN_TONE];
      rb[o + Q_ITONE] = tn > 0.02 ? 1 / tn : 1;
      if (S[s0 + SN_OBJ] || S[s1 + SN_OBJ]) {
        for (let t = 0; t < no; t++) {
          const ch = oAct[t];
          const v0 = S[s0 + ch];
          rb[o + ch] = (v0 + (S[s1 + ch] - v0) * fy) * INV255;
        }
      } else for (let t = 0; t < no; t++) rb[o + oAct[t]] = 0;
      const m0 = k0 * MC;
      const m1 = k1 * MC;
      for (let t = 0; t < nm; t++) {
        const ch = mAct[t];
        const v0 = M[m0 + ch];
        rb[o + Q_LOOK + ch] = (v0 + (M[m1 + ch] - v0) * fy) * INV255;
      }
    }
  }
  /** Where channel ch of the look's fields starts for the nearest analysis row (add colQ * MC). */
  nearRow(ch: number): number {
    return this.rowQ * MC + ch;
  }
}

// ---------------------------------------------------------------- snowy maps: the bake

// Spring, summer and autumn paint the map over the way a Dungeondraft map is built: a painted
// ground (grass, or wet earth early in spring, with brush strokes and mottles) lit by the snow's
// own light and shade, so the grid, every outline and the painterly shading carry over; snow left
// in its own shade in spring; leaf clumps with a dark outline on the bare trees and the
// snow-capped crowns; evergreens freed of their frost. Winter keeps the snow as painted and adds
// to it. Ink never changes.

/** Light for the leaf clumps: from the top left, a little above. */
const LX = -0.5 / 0.9955;
const LY = -0.62 / 0.9955;
const LZ = 0.6 / 0.9955;
const LEAF_INK: Tri = [16, 22, 12];
const STONE: Tri = [132, 130, 126];
const WATER_C: Tri = [52, 132, 146];
const BLOSSOM_L: readonly Tri[] = [
  [248, 196, 212],
  [252, 236, 242],
  [236, 158, 188],
];

/** Wildflowers on melted ground (no white ones: here they'd read as snow). */
const FLOWERS_S: readonly Tri[] = [
  [250, 222, 86],
  [244, 176, 204],
  [178, 140, 222],
  [236, 112, 108],
];

/** Linear ramp: 0 below 0, 1 above 1/k. */
function lin(v: number, k: number): number {
  const t = v * k;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** How much darker a leaf clump is where another dips under it (d: distance to its rim). */
function creaseOf(d: number): number {
  let t = d * 20;
  t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  return 0.62 + 0.38 * t;
}

/** Fractional part (for rolls). */
function frac1(v: number): number {
  return v - Math.floor(v);
}

/** The clump clumpAt found: index, height, r² over its radius², offset (tile squares), another under it, tile x, y. */
const CQ = new Float64Array(8);

/** Grid cells a tile square in a tree's clump index. */
const TI_G = 16;

/**
 * The leaf clumps still on one tree, and a grid over them (in the clump tile's coordinates, where
 * the tree's crown lies), listing in each cell the clumps that may cover it: a pixel looks at a
 * few clumps, and anywhere past the crown at none.
 */
interface TreeIndex {
  /** Per clump on the tree: its index in the clump set, and its centre (tile squares). */
  cl: Int32Array;
  cX: Float64Array;
  cY: Float64Array;
  /** The grid's first cell, its size, and each cell's run in list (off[cell] to off[cell + 1]). */
  gx0: number;
  gy0: number;
  gw: number;
  gh: number;
  off: Int32Array;
  list: Uint16Array;
}

const NO_CLUMPS: TreeIndex = {
  cl: new Int32Array(0),
  cX: new Float64Array(0),
  cY: new Float64Array(0),
  gx0: 0,
  gy0: 0,
  gw: 0,
  gh: 0,
  off: new Int32Array(1),
  list: new Uint16Array(0),
};

/**
 * Which of the leaf clumps round tree q are still on it (the clump tile repeats every CL_SQ tile
 * squares, so each copy of it across the crown is looked at), and their index. Whether a clump is
 * on is decided at its centre: its roll against limA + limB * (distance from the tree's centre, as
 * a share of its radius, up to 1), and for a bare tree, whether it lies within the tree's reach
 * that way (times reachK).
 */
function treeIndex(cs: ClumpSet, tp: Float64Array, q: number, bare: boolean, reachK: number, limA: number, limB: number): TreeIndex {
  const ca = tp[q];
  const sa = tp[q + 1];
  const sc = tp[q + 15];
  const iS = tp[q + 2];
  const ox = tp[q + 3];
  const oy = tp[q + 4];
  const roll = tp[q + 5];
  const R = tp[q + 32];
  const iR = R > 0 ? 1 / R : 1;
  const far = tp[q + 41];
  // The crown's reach in tile squares, with room for a clump's lobes.
  const rt = far * iS + 0.5;
  const cx0 = Math.floor((ox - rt) / CL_SQ);
  const cy0 = Math.floor((oy - rt) / CL_SQ);
  const ncx = Math.floor((ox + rt) / CL_SQ) - cx0 + 1;
  const ncy = Math.floor((oy + rt) / CL_SQ) - cy0 + 1;
  const n = cs.cx.length;
  const cl: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = 0; j < ncy; j++) {
    for (let i = 0; i < ncx; i++) {
      for (let c = 0; c < n; c++) {
        // The clump's centre, and back in the tree's frame (squares).
        const Xc = (cx0 + i) * CL_SQ + cs.cx[c];
        const Yc = (cy0 + j) * CL_SQ + cs.cy[c];
        const X = Xc - ox;
        const Y = Yc - oy;
        const tu = (X * ca + Y * sa) * sc;
        const tw = (Y * ca - X * sa) * sc;
        const d2 = tu * tu + tw * tw;
        if (d2 > far * far) continue;
        const dn = Math.sqrt(d2) * iR;
        if (frac1(cs.fall[c] + roll) >= limA + limB * (dn > 1 ? 1 : dn)) continue;
        if (bare) {
          const pos = diamond(tu, tw) * (TREE_DIRS / 4);
          const i0 = Math.floor(pos);
          const t = pos - i0;
          const r0 = tp[q + TP_REACH + (i0 & (TREE_DIRS - 1))];
          const r1 = tp[q + TP_REACH + ((i0 + 1) & (TREE_DIRS - 1))];
          const rr = (r0 + (r1 - r0) * t) * reachK;
          if (d2 > rr * rr) continue;
        }
        cl.push(c);
        xs.push(Xc);
        ys.push(Yc);
      }
    }
  }
  const m = cl.length;
  if (!m || m > 65535) return NO_CLUMPS;
  // The grid: each clump listed in the cells its leafy edge may reach.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const reach = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const r = cs.rc[cl[k]] * (1 + CL_LOBE) + 0.01;
    reach[k] = r;
    if (xs[k] - r < x0) x0 = xs[k] - r;
    if (xs[k] + r > x1) x1 = xs[k] + r;
    if (ys[k] - r < y0) y0 = ys[k] - r;
    if (ys[k] + r > y1) y1 = ys[k] + r;
  }
  const gx0 = Math.floor(x0 * TI_G);
  const gy0 = Math.floor(y0 * TI_G);
  const gw = Math.floor(x1 * TI_G) - gx0 + 1;
  const gh = Math.floor(y1 * TI_G) - gy0 + 1;
  const off = new Int32Array(gw * gh + 1);
  let list = new Uint16Array(0);
  let fill = off;
  for (let pass = 0; pass < 2; pass++) {
    if (pass) {
      for (let i = 0; i < gw * gh; i++) off[i + 1] += off[i];
      list = new Uint16Array(off[gw * gh]);
      fill = off.slice();
    }
    for (let k = 0; k < m; k++) {
      const r = reach[k];
      const a0 = Math.max(0, Math.floor((xs[k] - r) * TI_G) - gx0);
      const a1 = Math.min(gw - 1, Math.floor((xs[k] + r) * TI_G) - gx0);
      const b0 = Math.max(0, Math.floor((ys[k] - r) * TI_G) - gy0);
      const b1 = Math.min(gh - 1, Math.floor((ys[k] + r) * TI_G) - gy0);
      for (let b = b0; b <= b1; b++) {
        // (Whether the clump reaches the cell: the cell's nearest point to its centre.)
        const cy = (gy0 + b) / TI_G;
        const ny = ys[k] < cy ? cy : ys[k] > cy + 1 / TI_G ? cy + 1 / TI_G : ys[k];
        for (let a = a0; a <= a1; a++) {
          const cx = (gx0 + a) / TI_G;
          const nx = xs[k] < cx ? cx : xs[k] > cx + 1 / TI_G ? cx + 1 / TI_G : xs[k];
          if ((nx - xs[k]) * (nx - xs[k]) + (ny - ys[k]) * (ny - ys[k]) > r * r) continue;
          const cell = b * gw + a;
          if (pass) list[fill[cell]++] = k;
          else off[cell + 1]++;
        }
      }
    }
  }
  return { cl: Int32Array.from(cl), cX: Float64Array.from(xs), cY: Float64Array.from(ys), gx0, gy0, gw, gh, off, list };
}

/**
 * The highest leaf clump at offset (du, dw) squares from tree q's centre, of those still on it (ix:
 * see treeIndex), so a crown is whole clumps and its outline is lumpy. A clump's edge is its
 * leaves: it reaches a little further where the leaf tile has a leaf. False when none covers the
 * point.
 */
function clumpAt(cs: ClumpSet, tp: Float64Array, q: number, du: number, dw: number, ix: TreeIndex, lt: Tile): boolean {
  const ca = tp[q];
  const sa = tp[q + 1];
  const iS = tp[q + 2];
  const X = (du * ca - dw * sa) * iS + tp[q + 3];
  const Y = (du * sa + dw * ca) * iS + tp[q + 4];
  const gx = Math.floor(X * TI_G) - ix.gx0;
  const gy = Math.floor(Y * TI_G) - ix.gy0;
  if (gx < 0 || gy < 0 || gx >= ix.gw || gy >= ix.gh) return false;
  const cell = gy * ix.gw + gx;
  const e0 = ix.off[cell];
  const e1 = ix.off[cell + 1];
  if (e0 === e1) return false;
  const list = ix.list;
  const cl = ix.cl;
  const cX = ix.cX;
  const cY = ix.cY;
  let best = -1;
  let bz = -1e9;
  let br2 = 0;
  let bdx = 0;
  let bdy = 0;
  let other = 0;
  let lp = -1;
  const outer = (1 + CL_LOBE) * (1 + CL_LOBE);
  for (let e = e0; e < e1; e++) {
    const k = list[e];
    const c = cl[k];
    const dx = X - cX[k];
    const dy = Y - cY[k];
    const r2 = (dx * dx + dy * dy) * cs.irc2[c];
    if (r2 >= outer) continue;
    if (r2 >= 1) {
      // The leafy edge: a leaf here carries the clump a little further out. (The leaf tile repeats
      // within the clump tile, so it's read at the clump tile's coordinates as they are.)
      if (lp < 0) {
        const lv = lt.data[(Math.floor(Y * lt.res) & lt.mask) * lt.size + (Math.floor(X * lt.res) & lt.mask)] - 128;
        lp = (lv < 0 ? -lv : lv) * (1 / 110);
        if (lp > 1) lp = 1;
      }
      const el = 1 + CL_LOBE * lp;
      if (r2 >= el * el) continue;
    }
    const z = cs.z0[c] + 0.7 * (1 - r2);
    if (z > bz) {
      if (best >= 0) other = 1;
      best = c;
      bz = z;
      br2 = r2;
      bdx = dx;
      bdy = dy;
    } else other = 1;
  }
  if (best < 0) return false;
  CQ[0] = best;
  CQ[1] = bz;
  CQ[2] = br2;
  CQ[3] = bdx;
  CQ[4] = bdy;
  CQ[5] = other;
  CQ[6] = X;
  CQ[7] = Y;
  return true;
}

/** The clump clumpAt found, as seen: colour (before shading), light, leaf detail, distance to its rim (squares), another under it, height. */
const CC = new Float64Array(8);

function clumpColour(cs: ClumpSet, tp: Float64Array, q: number, lt: Tile, look: number, bloomK: number): void {
  const ci = CQ[0];
  const ca = tp[q];
  const sa = tp[q + 1];
  const rc = cs.rc[ci];
  const irc = 1.5 / rc;
  // The dome's slope, turned back into the scene (the light is the scene's).
  const ex = (CQ[3] * ca + CQ[4] * sa) * irc;
  const ey = (CQ[4] * ca - CQ[3] * sa) * irc;
  let lam = (ex * LX + ey * LY + LZ) / Math.sqrt(ex * ex + ey * ey + 1);
  if (lam < 0) lam = 0;
  const leaf = (lt.data[(Math.floor(CQ[7] * lt.res) & lt.mask) * lt.size + (Math.floor(CQ[6] * lt.res) & lt.mask)] - 128) * (1 / 127);
  const id = cs.id[ci];
  if (look === 2) {
    // Autumn: a mottled mix. Each clump takes a colour (neighbours alike in patches), and single
    // leaves of the neighbouring colours run all through it: an amalgam, never one red blob.
    // (Each leaf strays from its clump's colour, so even a crown down to its last clumps is a
    // mix; the darkest leaves stay a withered green.)
    const pk = rank2(0.72 * id + 0.28 * cs.patch[ci], 0.72, 0.28) + 0.24 * leaf;
    autumnColour(pk, tp, q);
    if (leaf < -0.6) {
      CC[0] = 92 + 16 * id;
      CC[1] = 114;
      CC[2] = 44;
    }
    const tv = 0.92 + 0.16 * frac1(id * 2.3);
    CC[0] *= tv;
    CC[1] *= tv;
    CC[2] *= tv;
  } else if (look === 0 && tp[q + 13] && frac1(id * 5.3 + tp[q + 5]) < bloomK) {
    const col = BLOSSOM_L[leaf > 0.2 ? 1 : frac1(id * 7.1) < 0.5 ? 0 : 2];
    CC[0] = col[0];
    CC[1] = col[1];
    CC[2] = col[2];
  } else {
    const tv = 0.9 + 0.2 * frac1(id * 2.3);
    CC[0] = tp[q + 10] * tv;
    CC[1] = tp[q + 11] * tv;
    CC[2] = tp[q + 12] * tv;
  }
  CC[3] = lam;
  CC[4] = leaf;
  CC[5] = (1 - Math.sqrt(CQ[2])) * rc * tp[q + 15];
  CC[6] = CQ[5];
  CC[7] = CQ[1];
}

// Autumn leaves along a tree's shares: green, then lime to gold, amber to orange, orange-red to
// red, then withered brown.
const AUT_SEG: readonly (readonly number[])[] = [
  [104, 126, 48, 104, 126, 48],
  [200, 188, 70, 228, 172, 50],
  [226, 150, 46, 206, 104, 36],
  [192, 76, 36, 160, 48, 32],
  [134, 90, 46, 120, 80, 42],
];

/** The colour at position pk (0-1) along tree q's autumn shares, into CC[0-2]. */
function autumnColour(pk: number, tp: Float64Array, q: number): void {
  let lo = 0;
  let seg = 0;
  let hi = tp[q + 6];
  if (pk >= hi) {
    for (seg = 1; seg < 4; seg++) {
      lo = hi;
      hi = tp[q + 6 + seg];
      if (pk < hi) break;
    }
    if (seg === 4) {
      lo = hi;
      hi = 1;
    }
  }
  let t = hi > lo ? (pk - lo) / (hi - lo) : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const c = AUT_SEG[seg];
  CC[0] = c[0] + (c[3] - c[0]) * t;
  CC[1] = c[1] + (c[4] - c[1]) * t;
  CC[2] = c[2] + (c[5] - c[2]) * t;
}

/** Recolours a strip of a map painted under snow (see bake). */
function bakeSnowy(px: Uint8ClampedArray, width: number, rows: number, o: BakeOptions): void {
  if (o.look === "winter") winterSnowy(px, width, rows, o);
  else meltSnowy(px, width, rows, o);
}

/**
 * Spring, summer and autumn on a map painted under snow: the snow melts into painted ground
 * (lit by the snow's light and shade, keeping the grid and every outline), drifts stay in its
 * shade in spring, snow-capped crowns and bare trees come into leaf, evergreens lose their frost,
 * ice thaws.
 */
function meltSnowy(px: Uint8ClampedArray, width: number, rows: number, o: BakeOptions): void {
  const m = new Melt(o, width);
  for (let j = 0; j < rows; j++) m.row(px, j, width);
}

/**
 * The melt, a row at a time. The open ground (most of a map) is worked out inline; objects
 * (crowns, bushes, props, ice, grass patches, earth, trees) in their own method, from the pixel
 * values the row leaves in fields.
 */
class Melt {
  sn: SnowInfo;
  sf: SnowFields;
  L: number;
  look: number;
  spring: boolean;
  summer: boolean;
  autumn: boolean;
  fr: SnowFrame;
  T: Uint8Array;
  MT: Uint8Array;
  invRef: number;
  pxSq: number;
  gtD: Uint8Array;
  gtM: number;
  gtS: number;
  gtR: number;
  gtJ: number;
  gtId: number;
  gtMot: number;
  gtCrk: number;
  lt: Tile;
  cs: ClumpSet;
  usesP1: boolean;
  anyShd: boolean;
  gB: Float64Array;
  gV: Float64Array;
  gJ: Float64Array;
  gP1: Float64Array;
  gP2: Float64Array;
  p1Share: number;
  p1Amt: number;
  p2Share: number;
  hasRem: boolean;
  budding: boolean;
  cracks: boolean;
  flowers: number;
  flowerN: Dots;
  litterD: number;
  underD: number;
  leafN: Leaves;
  budN: Dots;
  buds: number;
  bloomK: number;
  frostMelt: number;
  everS: number;
  everV: number;
  tp: Float64Array;
  tl: Uint16Array;
  inkW: number;
  olive: number;
  reachK: number;
  thinK: number;
  thinT: number;
  murk: number;
  colTu: Float64Array;
  colTv: Float64Array;
  colFx: Int32Array;
  colLx: Int32Array;
  bil: boolean;
  sproutK: number;
  gradeK: number;
  gR: number;
  gG: number;
  gGT: number;
  hasEarth: boolean;
  earthK: number;
  gsR0: number;
  gsG0: number;
  gsB0: number;
  gsDR: number;
  gsDG: number;
  gsDB: number;
  gsInv: number;
  gsL0: number;
  gsDL: number;
  /** The map's earth, and the way from it to the snow's lit colour (and 1 / its length²). */
  eR: number;
  eG: number;
  eB: number;
  esR: number;
  esG: number;
  esB: number;
  esInv: number;
  snR: number;
  snG: number;
  snB: number;
  // The pixel objects() works on, and what it gives back.
  r = 0;
  g = 0;
  b = 0;
  li = 0;
  lum = 0.5;
  det = 0.5;
  ta = 0;
  gr = 0.5;
  gg = 0.5;
  gb = 0.5;
  qr = 0.5;
  qg = 0.5;
  qb = 0.5;
  keep = 0.5;
  shd = 0.5;
  mB = 0.5;
  crw = 0.5;
  evr = 0.5;
  prp = 0.5;
  ice = 0.5;
  earth = 0.5;
  nr = 0.5;
  ng = 0.5;
  nb = 0.5;
  own = 0.5;

  constructor(o: BakeOptions, width: number) {
    const a = o.a;
    const sn = a.snow as SnowInfo;
    this.sn = sn;
    const P = SEASON_PARAMS;
    const L = o.level - 1;
    this.L = L;
    const look = o.look === "spring" ? 0 : o.look === "summer" ? 1 : 2;
    this.look = look;
    const spring = look === 0;
    const summer = look === 1;
    const autumn = look === 2;
    this.spring = spring;
    this.summer = summer;
    this.autumn = autumn;
    const sf = snowFields(o);
    this.sf = sf;
    const has = sf.has;
    const sAct: number[] = [SN_GROUND, SN_TONE, SN_OBJ];
    for (const ch of [SN_CROWN, SN_EVER, SN_PROP, SN_LAWN, SN_ICE, SN_WATER, SN_EARTH]) if (has[ch]) sAct.push(ch);
    const mAct: number[] = [];
    this.usesP1 = sf.p1Share > 0;
    if (this.usesP1) mAct.push(M_P1);
    this.anyShd = sf.anyShd;
    if (sf.anyShd) mAct.push(M_SHD);
    if (sf.p2Share > 0) mAct.push(M_P2);
    if (spring && P.spring.remnant[L] > 0) mAct.push(M_REM);
    this.fr = new SnowFrame(o, width, sf.f, sAct, mAct, [SN_CROWN, SN_EVER, SN_PROP, SN_LAWN, SN_ICE, SN_WATER, SN_EARTH]);
    const fr = this.fr;
    this.T = colourTable();
    this.MT = meltTable();
    const seed = o.seed | 0;
    this.invRef = 1 / sn.ref;
    this.pxSq = o.scale / o.cell;
    const ppsq = o.cell / o.scale;
    const gt = pickMip(grassTiles(seed), ppsq);
    this.gtD = gt.data;
    this.gtM = gt.mask;
    this.gtS = gt.size;
    this.gtR = gt.res;
    const gtP = gt.size * gt.size;
    this.gtJ = gtP * GT_JIT;
    this.gtId = gtP * GT_ID;
    this.gtMot = gtP * GT_MOT;
    this.gtCrk = gtP * GT_CRK;
    this.lt = pickMip(leafTiles(seed), ppsq);
    this.cs = clumpSet(seed);
    this.gB = sf.gBase;
    this.gV = sf.gVar;
    this.gJ = sf.gJit;
    this.gP1 = sf.gP1;
    this.gP2 = sf.gP2;
    this.p1Share = sf.p1Share;
    this.p1Amt = sf.p1Amt;
    this.p2Share = sf.p2Share;
    this.hasRem = spring && P.spring.remnant[L] > 0;
    this.budding = spring && L === 0;
    this.cracks = summer && L === 2;
    this.flowers = spring && L > 0 ? P.spring.flowers[L] * 0.04 : 0;
    this.flowerN = new Dots(0.2, 0.2, mix(seed, 34));
    this.litterD = autumn ? P.autumn.leaves[L] : 0;
    this.underD = autumn ? P.autumn.litter[L] : 0;
    this.leafN = new Leaves(mix(seed, 27));
    this.budN = new Dots(0.05, 0.36, mix(seed, 91));
    this.buds = P.spring.buds[L];
    this.bloomK = spring ? P.spring.bloomClumps[L] : 0;
    this.frostMelt = spring ? P.spring.frostMelt[L] : 1;
    this.everS = spring ? 1.4 : summer ? 1.5 - 0.1 * L : 1.35;
    this.everV = spring ? 0.96 : summer ? 0.9 : 0.86;
    this.tp = sf.tp;
    this.tl = sn.tl;
    this.inkW = 0.012 + 0.3 * this.pxSq;
    this.olive = summer ? P.summer.leafOlive[L] : 0;
    this.reachK = 1.15 * (spring ? P.spring.leafScale[L] : 1);
    // Autumn thins the crowns two ways: whole clumps fall, and the clumps left lose leaves.
    const thinL = autumn ? P.autumn.clumpLeaves[L] : 1;
    this.thinK = 1 / thinL;
    this.thinT = thinL < 1 ? (1 - thinL) * 0.9 : 0;
    this.murk = summer ? P.summer.murk[L] : 0;
    // The grass tile is laid at an angle, so its repeats don't line up with the grid.
    this.colTu = new Float64Array(width);
    this.colTv = new Float64Array(width);
    // Stamp cells per column (as Dots and Leaves find them).
    this.colFx = new Int32Array(width);
    this.colLx = new Int32Array(width);
    for (let i = 0; i < width; i++) {
      this.colTu[i] = fr.colU[i] * ROT[0] * gt.res;
      this.colTv[i] = fr.colU[i] * ROT[1] * gt.res;
      this.colFx[i] = Math.floor(fr.colU[i] / this.flowerN.size);
      this.colLx[i] = Math.floor(fr.colU[i] * 5);
    }
    // The tile is read texel by texel unless it's magnified (then blended).
    this.bil = ppsq > gt.res * 1.3;
    this.sproutK = this.budding ? P.spring.sprout[0] : 0;
    // The look's colour grade (as its kernel grades any map), on what the melt leaves as drawn.
    this.gradeK = (spring ? P.spring.grade[L] : summer ? P.summer.grade[L] : P.autumn.grade[L]) * (0.3 + 0.7 * ramp(sn.frac, 0.04, 0.35));
    this.gR = spring ? 0.3 : 0.5;
    this.gG = spring ? 0.4 : 0.25;
    this.gGT = spring ? 255 : 225;
    this.hasEarth = has[SN_EARTH] > 0;
    this.earthK = spring ? 0.82 : summer ? 1 + 0.06 * L : 0.95;
    // The grass patches' colour and the snow's (RGB, and luma 0-1), for their soft rims.
    this.gsR0 = sn.grass[0];
    this.gsG0 = sn.grass[1];
    this.gsB0 = sn.grass[2];
    this.gsDR = sn.snow[0] - this.gsR0;
    this.gsDG = sn.snow[1] - this.gsG0;
    this.gsDB = sn.snow[2] - this.gsB0;
    this.gsInv = 1 / Math.max(1, this.gsDR * this.gsDR + this.gsDG * this.gsDG + this.gsDB * this.gsDB);
    this.gsL0 = (0.299 * this.gsR0 + 0.587 * this.gsG0 + 0.114 * this.gsB0) * INV255;
    this.gsDL = (0.299 * sn.snow[0] + 0.587 * sn.snow[1] + 0.114 * sn.snow[2]) * INV255 - this.gsL0;
    this.eR = sn.earth[0];
    this.eG = sn.earth[1];
    this.eB = sn.earth[2];
    this.snR = sn.snow[0];
    this.snG = sn.snow[1];
    this.snB = sn.snow[2];
    this.esR = this.snR - this.eR;
    this.esG = this.snG - this.eG;
    this.esB = this.snB - this.eB;
    this.esInv = 1 / Math.max(1, this.esR * this.esR + this.esG * this.esG + this.esB * this.esB);
  }

  /** Recolours row j of the strip. */
  row(px: Uint8ClampedArray, j: number, width: number): void {
    const fr = this.fr;
    fr.row(j);
    const w = fr.w;
    const rowQ = fr.rowQ;
    const rb = fr.rb;
    const colI = fr.colI;
    const colF = fr.colF;
    const colU = fr.colU;
    const T = this.T;
    const MT = this.MT;
    const gtD = this.gtD;
    const gtM = this.gtM;
    const gtS = this.gtS;
    const gtJ = this.gtJ;
    const gtMot = this.gtMot;
    const gtCrk = this.gtCrk;
    const colTu = this.colTu;
    const colTv = this.colTv;
    const rowTu = w * ROT[1] * this.gtR;
    const rowTv = w * ROT[0] * this.gtR;
    const bil = this.bil;
    const invRef = this.invRef;
    const gB0 = this.gB[0];
    const gB1 = this.gB[1];
    const gB2 = this.gB[2];
    const gV0 = this.gV[0];
    const gV1 = this.gV[1];
    const gV2 = this.gV[2];
    const gJ0 = this.gJ[0];
    const gJ1 = this.gJ[1];
    const gJ2 = this.gJ[2];
    const gP1 = this.gP1;
    const gP2 = this.gP2;
    const p1Share = this.p1Share;
    const usesP1 = this.usesP1;
    const anyShd = this.anyShd;
    const p1Amt = this.p1Amt;
    const p2Share = this.p2Share;
    const cracks = this.cracks;
    const budding = this.budding;
    const sproutK = this.sproutK;
    const hasRem = this.hasRem;
    const flowers = this.flowers;
    const flowerN = this.flowerN;
    const colFx = this.colFx;
    const litterD = this.litterD;
    const leafN = this.leafN;
    const colLx = this.colLx;
    const gradeK = this.gradeK;
    const vRow = fr.nearRow(M_VAR);
    const colQ = fr.colQ;
    const nRow = litterD > 0 ? fr.nearRow(M_NEAR) : 0;
    const M = fr.M;
    const fcy = Math.floor(w / flowerN.size);
    const lcy = Math.floor(w * 5);
    const C = QC;
    const Q_P1 = Q_LOOK + M_P1;
    const Q_P2 = Q_LOOK + M_P2;
    const Q_REM = Q_LOOK + M_REM;
    const Q_SHD = Q_LOOK + M_SHD;
    // The stamp cells (wildflowers, fallen leaves) looked at last, and their rolls.
    let lastFx = 0x7fffffff;
    let fRoll = 1;
    let lastLx = 0x7fffffff;
    let lRoll = 1;
    for (let i = 0, p = j * width * 4; i < width; i++, p += 4) {
      const r = px[p];
      const g = px[p + 1];
      const b = px[p + 2];
      const li = lutIndex(r, g, b);
      const mi = li >> 2;
      const mt = MT[mi];
      // Ink and deep shadow never change (near-white does here: it's snow). (The colour table is
      // big: it's read only when the melt table can't decide.)
      if (mt === 0 && T[li + 2] === 0) continue;
      const c = colI[i];
      const fx = colF[i];
      const g0 = rb[c + SN_GROUND];
      const gnd = g0 + (rb[c + C + SN_GROUND] - g0) * fx;
      const o0 = rb[c + SN_OBJ];
      const obj = o0 + (rb[c + C + SN_OBJ] - o0) * fx;
      let nr = r;
      let ng = g;
      let nb = b;
      let own = 0;
      if (gnd > 0 || obj > 0) {
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) * INV255;
        // Grass tile at this spot: brightness detail and colour jitter.
        const tu = colTu[i] - rowTu;
        const tv = colTv[i] + rowTv;
        const tx0 = (tu + 1048576) | 0;
        const ty0 = (tv + 1048576) | 0;
        const ta = (ty0 & gtM) * gtS + (tx0 & gtM);
        let det: number;
        if (bil) {
          const tfx = tu + 1048576 - tx0;
          const tfy = tv + 1048576 - ty0;
          const tb2 = (ty0 & gtM) * gtS + ((tx0 + 1) & gtM);
          const tc = ((ty0 + 1) & gtM) * gtS + (tx0 & gtM);
          const td = ((ty0 + 1) & gtM) * gtS + ((tx0 + 1) & gtM);
          const d0 = gtD[ta] + (gtD[tb2] - gtD[ta]) * tfx;
          det = (d0 + (gtD[tc] + (gtD[td] - gtD[tc]) * tfx - d0) * tfy - 128) * INV255;
        } else det = (gtD[ta] - 128) * INV255;
        const jit = (gtD[ta + gtJ] - 128) * (2 * INV255);
        // What the objects here claim (crowns, bushes, props, ice, water): at their soft edges
        // the ground takes the rest, so no snow is left between an object and the ground.
        let gw = gnd;
        if (obj > 0) {
          const crw = rb[c + SN_CROWN] + (rb[c + C + SN_CROWN] - rb[c + SN_CROWN]) * fx;
          const evr = rb[c + SN_EVER] + (rb[c + C + SN_EVER] - rb[c + SN_EVER]) * fx;
          const prp = rb[c + SN_PROP] + (rb[c + C + SN_PROP] - rb[c + SN_PROP]) * fx;
          const ice = rb[c + SN_ICE] + (rb[c + C + SN_ICE] - rb[c + SN_ICE]) * fx;
          const wat = rb[c + SN_WATER] + (rb[c + C + SN_WATER] - rb[c + SN_WATER]) * fx;
          this.crw = crw;
          this.evr = evr;
          this.prp = prp;
          this.ice = ice;
          let claim = crw > evr ? crw : evr;
          if (prp > claim) claim = prp;
          if (ice > claim) claim = ice;
          if (wat > claim) claim = wat;
          if (1 - claim > gw) gw = 1 - claim;
        }
        const mel = gw > 0 ? mt * INV255 * gw : 0;
        // 1. Snow left in drifts where it lay deepest (spring), frayed at the edge by the grass's
        // mottles (not its blades: no grass pokes through it). Where it stays, nothing under it
        // needs working out.
        let keep = 0;
        let rs = 0;
        if (hasRem && mel > 0) {
          rs = rb[c + Q_REM] + (rb[c + C + Q_REM] - rb[c + Q_REM]) * fx + 0.5 * (gtD[ta + gtMot] - 128) * INV255 + 0.03 * jit;
          const tk = (rs - 0.48) * 11;
          keep = tk < 0 ? 0 : tk > 1 ? 1 : tk;
        }
        if (keep >= 1 && obj <= 0) own = mel;
        else {
          // 2. The ground: painted grass (last year's grass early in spring). Broad colour changes
          // read the nearest field pixel: they're far smoother than a pixel.
          const vr = M[vRow + colQ[i] * MC] * INV255 - 0.5;
          let gr = gB0 + gV0 * vr + gJ0 * jit;
          let gg = gB1 + gV1 * vr + gJ1 * jit;
          let gb = gB2 + gV2 * vr + gJ2 * jit;
          let k2 = 0;
          if (usesP1) {
            const p1 = rb[c + Q_P1] + (rb[c + C + Q_P1] - rb[c + Q_P1]) * fx;
            const t2 = (p1Share - p1 + 0.35 * det + 0.05) * 10;
            k2 = p1Amt * (t2 < 0 ? 0 : t2 > 1 ? 1 : t2);
            gr += (gP1[0] - gr) * k2;
            gg += (gP1[1] - gg) * k2;
            gb += (gP1[2] - gb) * k2;
          }
          if (budding) {
            // Fresh green coming through in fine tufts.
            const sp = sproutK * lin(0.45 * jit + 1.8 * det + 0.02, 7) * (1 - 0.6 * k2);
            gr += (G_SHOOT[0] - gr) * sp;
            gg += (G_SHOOT[1] - gg) * sp;
            gb += (G_SHOOT[2] - gb) * sp;
          } else if (p2Share > 0) {
            // Worn to bare earth in patches (cracked in a drought).
            const p2 = rb[c + Q_P2] + (rb[c + C + Q_P2] - rb[c + Q_P2]) * fx;
            const t3 = (p2Share - p2 + 0.4 * det + 0.03) * 16.7;
            const k3 = t3 < 0 ? 0 : t3 > 1 ? 1 : t3;
            if (k3 > 0) {
              let cr = 1 + 1.4 * det;
              if (cracks) cr *= 1 - 0.42 * gtD[ta + gtCrk] * INV255;
              gr += (gP2[0] * cr - gr) * k3;
              gg += (gP2[1] * cr - gg) * k3;
              gb += (gP2[2] * cr - gb) * k3;
            }
          }
          // The snow's broad light and shade (a little stronger) and its fine detail (grain, the
          // grid, outlines) at full strength.
          const t0 = rb[c + SN_TONE];
          const tone = t0 + (rb[c + C + SN_TONE] - t0) * fx;
          let mB = 1 + 1.15 * (tone * invRef - 1);
          mB = mB < 0.5 ? 0.5 : mB > 1.06 ? 1.06 : mB;
          const i0 = rb[c + Q_ITONE];
          const fine = lum * (i0 + (rb[c + C + Q_ITONE] - i0) * fx);
          const mF = fine >= 0.95 ? 1 + 1.5 * (fine - 1) : fine - 0.025;
          let shd = 0;
          if (anyShd) {
            const s0 = rb[c + Q_SHD];
            shd = s0 + (rb[c + C + Q_SHD] - s0) * fx;
          }
          const k = mB * mF * (1 + 1.3 * det) * (1 - 0.3 * shd);
          // (Cool in the shade, as the snow was.)
          let qr = gr * k;
          let qg = gg * k;
          let qb = gb * k + 10 * (1 - mB) + 8 * shd;
          if (mel > 0) {
            if (hasRem) {
              // Greyer slush along the drifts' edges, and a dark, wet rim round them.
              const slush = keep * (1 - keep) * 4;
              const tw = (rs - 0.36) * 7;
              const wet = (tw < 0 ? 0 : tw > 1 ? 1 : tw) * (1 - keep);
              qr *= 1 - 0.3 * wet;
              qg *= 1 - 0.26 * wet;
              qb *= 1 - 0.18 * wet;
              if (slush > 0) {
                qr += (r * 0.9 - qr) * slush * 0.25;
                qg += (g * 0.91 - qg) * slush * 0.25;
                qb += (b * 0.93 - qb) * slush * 0.25;
              }
            }
            // Wildflowers on the grass (most cells hold none: their roll is checked first).
            if (flowers > 0 && keep < 1) {
              const fcx = colFx[i];
              if (fcx !== lastFx) {
                lastFx = fcx;
                fRoll = hash2(fcx, fcy, flowerN.sd);
              }
              if (fRoll <= flowers) {
                const cov = flowerN.at(colU[i], w, flowers);
                if (cov > 0) {
                  const col = FLOWERS_S[(flowerN.pick * 4) | 0];
                  const al = cov * lin(mF - 0.6, 5);
                  qr += (col[0] * (0.8 + 0.25 * mB) - qr) * al;
                  qg += (col[1] * (0.8 + 0.25 * mB) - qg) * al;
                  qb += (col[2] * (0.8 + 0.25 * mB) - qb) * al;
                }
              }
            }
            const t = mel * (1 - keep);
            nr += (qr - nr) * t;
            ng += (qg - ng) * t;
            nb += (qb - nb) * t;
            own = mel;
          }
          let earth = 0;
          if (obj > 0) {
            this.r = r;
            this.g = g;
            this.b = b;
            this.li = li;
            this.lum = lum;
            this.det = det;
            this.ta = ta;
            this.gr = gr;
            this.gg = gg;
            this.gb = gb;
            this.qr = qr;
            this.qg = qg;
            this.qb = qb;
            this.keep = keep;
            this.shd = shd;
            this.mB = mB;
            this.nr = nr;
            this.ng = ng;
            this.nb = nb;
            this.own = own;
            this.objects(i, c, fx, w, rowQ);
            nr = this.nr;
            ng = this.ng;
            nb = this.nb;
            own = this.own;
            earth = this.earth;
          }
          // Fallen leaves (autumn), on the new ground and the earth, thick under the trees: not on
          // what an object here took over (a crown, a bush, a rock).
          const took = own > mel + 0.02 ? own : 0;
          if (litterD > 0 && took < 1) {
            const nearT = M[nRow + colQ[i] * MC] * INV255;
            const dens = litterD + this.underD * nearT * nearT;
            const lcx = colLx[i];
            if (lcx !== lastLx) {
              lastLx = lcx;
              lRoll = hash2(lcx, lcy, leafN.sd);
            }
            if (lRoll <= dens * 0.04 && (mel > 0 || earth > 0.5)) {
              const lv = leafN.at(colU[i], w, dens) * (1 - took) * (1 - keep);
              if (lv > 0) {
                this.litter(i, rowQ, nearT, mB, mF, mel);
                nr += (this.lr - nr) * lv;
                ng += (this.lg - ng) * lv;
                nb += (this.lb - nb) * lv;
              }
            }
          }
        }
      }
      // The look's grade on what the melt left as drawn (earth, trunks, rocks, outlines).
      if (gradeK > 0 && own < 1) {
        const gk = gradeK * T[li + 2] * INV255 * (1 - own);
        const tr = nr + (255 - nr) * gk * this.gR;
        const tg = ng + (this.gGT - ng) * gk * this.gG;
        nb = this.spring ? nb + (255 - nb) * gk * 0.2 : nb * (1 - gk * 0.6);
        nr = tr;
        ng = tg;
      }
      px[p] = nr;
      px[p + 1] = ng;
      px[p + 2] = nb;
    }
  }

  // The colour litter() found.
  lr = 0.5;
  lg = 0.5;
  lb = 0.5;

  /** The colour of the fallen leaf leafN just found at this pixel, into lr, lg, lb. */
  litter(i: number, rowQ: number, nearT: number, mB: number, mF: number, mel: number): void {
    const leafN = this.leafN;
    const tp = this.tp;
    const t = nearT > 0.05 ? this.tl[rowQ + this.fr.colQ[i]] - 1 : -1;
    const pk = leafN.pick;
    let cr: number;
    let cg: number;
    let cb: number;
    if (t >= 0 && tp[t * TP + 35] !== K_EVER) {
      const q = t * TP;
      autumnColour(tp[q + 6] + pk * (1 - tp[q + 6]), tp, q);
      cr = CC[0];
      cg = CC[1];
      cb = CC[2];
    } else {
      const col = LEAF_COLOURS[(pk * (this.L === 2 ? 6 : 5)) | 0];
      cr = col[0];
      cg = col[1];
      cb = col[2];
    }
    const lk = (0.72 + 0.32 * mB) * (leafN.edge > 0.55 ? 0.8 : 1) * (mel > 0 ? lin(mF - 0.5, 3.33) : 0.9);
    this.lr = cr * lk;
    this.lg = cg * lk;
    this.lb = cb * lk;
  }

  /** Objects at the pixel left in the fields (ice, props, grass patches, earth, water, trees). */
  objects(i: number, c: number, fx: number, w: number, rowQ: number): void {
    const fr = this.fr;
    const rb = fr.rb;
    const C = QC;
    const T = this.T;
    const MT = this.MT;
    const r = this.r;
    const g = this.g;
    const b = this.b;
    const li = this.li;
    const mi = li >> 2;
    const lum = this.lum;
    const det = this.det;
    const keep = this.keep;
    const invRef = this.invRef;
    const spring = this.spring;
    const autumn = this.autumn;
    let nr = this.nr;
    let ng = this.ng;
    let nb = this.nb;
    let own = this.own;
    const crw = this.crw;
    const evr = this.evr;
    const prp = this.prp;
    const ice = this.ice;
    const lawn = rb[c + SN_LAWN] + (rb[c + C + SN_LAWN] - rb[c + SN_LAWN]) * fx;
    const earth = rb[c + SN_EARTH] + (rb[c + C + SN_EARTH] - rb[c + SN_EARTH]) * fx;
    this.earth = earth;
    const u = fr.colU[i];
    // 2. Ice thaws to water (the lines on it stay). Early in spring it only breaks up: floes stay
    // where the snow on the ground stays, frayed as the drifts are.
    if (ice > 0) {
      let kI = ice * MT[mi] * INV255;
      if (this.budding) {
        const Q = Q_LOOK + M_REM;
        const rs = rb[c + Q] + (rb[c + C + Q] - rb[c + Q]) * fx + 0.5 * (this.gtD[this.ta + this.gtMot] - 128) * INV255 + 0.03 * (this.gtD[this.ta + this.gtJ] - 128) * (2 * INV255);
        kI *= 1 - lin(rs - 0.48, 11);
      }
      if (kI > 0) {
        const l = lum * invRef;
        nr += (WATER_C[0] * l - nr) * kI;
        ng += (WATER_C[1] * l - ng) * kI;
        nb += (WATER_C[2] * l - nb) * kI;
        if (kI > own) own = kI;
      }
    }
    // 3. Snow on rocks and props melts off to grey stone, keeping its shading.
    if (prp > 0) {
      const kP = prp * T[li + 3] * INV255;
      if (kP > 0) {
        const l = lum * invRef;
        nr += (STONE[0] * l - nr) * kP;
        ng += (STONE[1] * l - ng) * kP;
        nb += (STONE[2] * l - nb) * kP;
        if (kP > own) own = kP;
      }
    }
    // 4. A patch of grass the snow left bare joins the new ground. How much of this pixel is
    // the patch's green and how much snow (its soft painted rim), and the detail on it (grid
    // lines, grain) against that mix: the new ground takes it all, so no ghost of the patch is
    // left. Early in spring the patch stays green; only its snowy rim melts.
    if (lawn > 0) {
      let kL = (lum - 0.1) * 10;
      kL = kL <= 0 ? 0 : kL >= 1 ? lawn * (1 - keep) : kL * kL * (3 - 2 * kL) * lawn * (1 - keep);
      if (kL > 0) {
        let al = ((r - this.gsR0) * this.gsDR + (g - this.gsG0) * this.gsDG + (b - this.gsB0) * this.gsDB) * this.gsInv;
        al = al < 0 ? 0 : al > 1 ? 1 : al;
        const eL = this.gsL0 + al * this.gsDL;
        const dt = eL > 0.05 ? lum / eL : 1;
        const mD = dt >= 0.95 ? 1 + 0.8 * (dt - 1) : dt - 0.01;
        const kk = mD * (1 + 1.3 * det) * (1 - 0.3 * this.shd);
        let lr = this.gr * kk;
        let lg = this.gg * kk;
        let lb = this.gb * kk;
        if (this.budding) {
          lr += (r * 1.03 + 3 - lr) * (1 - al);
          lg += (g * 1.06 + 5 - lg) * (1 - al);
          lb += (b - lb) * (1 - al);
        }
        nr += (lr - nr) * kL;
        ng += (lg - ng) * kL;
        nb += (lb - nb) * kL;
        if (kL > own) own = kL;
      }
    }
    // 5. Bare earth: wetter in spring, dustier in a drought. Its soft edge and the flecks of snow
    // on it are part earth, part snow (by how far each lies from the earth's colour toward the
    // snow's): the snow part turns to the new ground round the patch and to earth on it, so no
    // pale fringe or white fleck is left.
    if (earth > 0 && this.hasEarth) {
      let al = ((r - this.eR) * this.esR + (g - this.eG) * this.esG + (b - this.eB) * this.esB) * this.esInv;
      al = al < 0 ? 0 : al > 1 ? 1 : al;
      let er = r;
      let eg = g;
      let eb = b;
      if (al > 0) {
        // (The snow here, and what replaces it: the new ground lit as the snow was, or earth.)
        const mB = this.mB;
        const sl = 1 + (mB - 1) * (1 / 1.15);
        const kq = mB * (1 + 1.3 * det) * (1 - 0.3 * this.shd);
        // (Round the patch the new ground, on it earth: by how deep in the patch this is.)
        const gd = earth <= 0.6 ? 1 : earth >= 0.85 ? 0 : (0.85 - earth) * 4;
        const ka = (1 - gd) * (1.04 + 0.5 * det);
        er += (this.gr * kq * gd + this.eR * ka - this.snR * sl) * al;
        eg += (this.gg * kq * gd + this.eG * ka - this.snG * sl) * al;
        eb += (this.gb * kq * gd + this.eB * ka - this.snB * sl) * al;
      }
      const eK = this.earthK;
      const add = this.summer ? this.L : 0;
      er += (er * eK + 6 * add - er) * (1 - al);
      eg += (eg * eK + 5 * add - eg) * (1 - al);
      eb += (eb * eK - eb) * (1 - al);
      const kE = earth >= 0.5 ? 1 : earth * 2;
      nr += (er - nr) * kE;
      ng += (eg - ng) * kE;
      nb += (eb - nb) * kE;
      if (kE * al > own) own = kE * al;
    }
    // Summer: open water murkier.
    if (this.murk > 0) {
      const wat = rb[c + SN_WATER] + (rb[c + C + SN_WATER] - rb[c + SN_WATER]) * fx;
      const m = wat * this.murk * (1 - MT[mi] * INV255);
      if (m > 0) {
        nr += (96 * (0.6 + lum) - nr) * m;
        ng += (116 * (0.6 + lum) - ng) * m;
        nb += (78 * (0.6 + lum) - nb) * m;
      }
    }
    const t = this.tl[rowQ + fr.colQ[i]] - 1;
    if (t >= 0) {
      const tp = this.tp;
      const q = t * TP;
      const kind = tp[q + 35];
      const max = r > g ? (r > b ? r : b) : g > b ? g : b;
      const min = r < g ? (r < b ? r : b) : g < b ? g : b;
      const chroma = max - min;
      const du = u - tp[q + 33];
      const dw = w - tp[q + 34];
      if (kind === K_EVER) {
        // 6. Evergreens and bushes lose their frost: greys and pale greens go back to the
        // bush's own green; out of the cold, a richer, deeper green.
        if (evr > 0 && max >= 40) {
          const sat = max > 0 ? chroma / max : 0;
          const greenish = sat < 0.12 || (g >= r && g >= b) ? 1 : 0;
          const us = tp[q + 40];
          let fz = (1 - sat / (0.9 * us)) * 2;
          fz = fz <= 0 ? 0 : fz >= 1 ? evr * greenish : evr * greenish * fz * fz * (3 - 2 * fz);
          let melt = this.frostMelt;
          if (melt < 1) melt = ramp(melt - (0.7 * (this.gtD[this.ta + this.gtJ] * INV255) + 0.3 * (det + 0.5)), -0.05, 0.05);
          const kF = fz * melt * (1 - keep);
          if (kF > 0) {
            // (Its own green, lighter where the frost was lighter, with the grass tile's mottles
            // for leaves; snow-white at its soft edge melts as the ground does.)
            const lb = lum * invRef;
            const v = (0.5 + 0.36 * (lb > 1.1 ? 1.1 : lb)) * (1 + 1.2 * det);
            let w1 = (lb - 0.82) * (1 / 0.12);
            w1 = w1 <= 0 ? 0 : w1 >= 1 ? 1 : w1 * w1 * (3 - 2 * w1);
            let w2 = (evr - 0.45) * 2.5;
            w2 = w2 <= 0 ? 0 : w2 >= 1 ? 1 : w2 * w2 * (3 - 2 * w2);
            const wW = w1 * (1 - w2);
            nr += (tp[q + 37] * v + (this.qr - tp[q + 37] * v) * wW - nr) * kF;
            ng += (tp[q + 38] * v + (this.qg - tp[q + 38] * v) * wW - ng) * kF;
            nb += (tp[q + 39] * v + (this.qb - tp[q + 39] * v) * wW - nb) * kF;
          }
          let lk = (max - 40) * (1 / 40);
          lk = lk <= 0 ? 0 : lk >= 1 ? evr * melt : lk * lk * (3 - 2 * lk) * evr * melt;
          if (lk > 0) {
            const l = 0.299 * nr + 0.587 * ng + 0.114 * nb;
            const S = this.everS;
            const V = this.everV;
            nr += ((l + (nr - l) * S) * V - nr) * lk;
            ng += ((l + (ng - l) * S) * V - ng) * lk;
            nb += ((l + (nb - l) * S) * V - nb) * lk;
          }
          if (evr > own) own = evr;
        }
      } else if (kind === K_CAP) {
        // 7. A snow-capped crown comes into leaf: its white cap turns to leaf clumps, lit as the
        // snow was (its contour lines stay as darker leaf), and its green rim takes the same
        // colours. Melting in spring, the cap goes from its rim in.
        if (crw > 0) {
          const litL = tp[q + 36];
          let wl = (lum / litL - 0.3) * (1 / 0.15);
          wl = wl <= 0 ? 0 : wl >= 1 ? 1 : wl * wl * (3 - 2 * wl);
          const white = crw * MT[mi] * INV255 * wl;
          const rimLeaf = chroma >= 0.12 * max && max >= 45 && g >= b;
          if (white > 0 || rimLeaf) {
            const iR = tp[q + 43];
            const ls = tp[q + 14];
            const melting = spring && ls < 1;
            const lk = ls * this.thinK;
            const ix = this.sf.ix[t] ?? (this.sf.ix[t] = treeIndex(this.cs, tp, q, false, 1, melting ? 0.2 * lk : 1.12 * lk, melting ? 1.6 * lk : -0.24 * lk));
            let found = clumpAt(this.cs, tp, q, du, dw, ix, this.lt);
            if (found) {
              clumpColour(this.cs, tp, q, this.lt, this.look, this.bloomK);
              // (Late in autumn a clump thins to its last leaves.)
              if (this.thinT > 0 && (CC[4] < 0 ? -CC[4] : CC[4]) < this.thinT) found = false;
            }
            const crownLit = 1 - 0.14 * (du * 0.55 + dw * 0.83) * iR;
            if (white > 0) {
              let l = lum / litL;
              l = l < 0.25 ? 0.25 : l > 1.1 ? 1.1 : l;
              let lr: number;
              let lg: number;
              let lb: number;
              if (found) {
                const crease = CC[6] ? creaseOf(CC[5] + 0.015 * CC[4]) : 1;
                const sh = l * (0.6 + 0.48 * CC[3]) * (0.9 + 0.2 * (CC[7] - 0.35)) * crownLit * (1 + 0.28 * CC[4]) * crease;
                lr = CC[0] * sh;
                lg = CC[1] * sh;
                lb = CC[2] * sh;
              } else if (melting) {
                // Not melted yet.
                lr = r;
                lg = g;
                lb = b;
              } else if (!autumn) {
                // A gap in the leaves: the ground in the crown's shade.
                const gk = 0.78 * l * (1 + det);
                lr = this.gr * gk;
                lg = this.gg * gk;
                lb = this.gb * gk;
              } else {
                // Fallen: bare branches over the leaf-strewn ground below.
                const tree = (Math.floor(tp[q + 33] * 2) * 73856093) ^ (Math.floor(tp[q + 34] * 2) * 19349663);
                const ba = branchAlpha(du, dw, tp[q + 32] * 1.02, hash2(tree, 17, 0xb4a) * 4, tree, 0.5 * this.pxSq);
                const gk = 0.78 * l * (1 + det);
                lr = this.gr * gk;
                lg = this.gg * gk;
                lb = this.gb * gk;
                if (autumn && det > 0.03) {
                  const lc = AUT_LEAF[1 + ((this.gtD[this.ta + this.gtId] * 3) >> 8)];
                  lr += (lc[0] * 0.8 * l - lr) * 0.7;
                  lg += (lc[1] * 0.8 * l - lg) * 0.7;
                  lb += (lc[2] * 0.8 * l - lb) * 0.7;
                }
                lr += (58 - lr) * ba * 0.65;
                lg += (42 - lg) * ba * 0.65;
                lb += (32 - lb) * ba * 0.65;
              }
              nr += (lr - nr) * white;
              ng += (lg - ng) * white;
              nb += (lb - nb) * white;
              if (white > own) own = white;
            }
            if (rimLeaf) {
              // (Greens and yellow-greens, not blues: g the brightest, r not far behind or below.)
              const leafy = g >= b ? crw * (g >= r ? 1 : clamp01((g - 0.8 * r) / (0.2 * r))) : 0;
              if (leafy > 0) {
                // The rim's leaves in the look's colour, at their own brightness.
                let cr = CC[0];
                let cg = CC[1];
                let cb = CC[2];
                if (!found) {
                  cr = autumn ? AUT_LEAF[2][0] : tp[q + 10];
                  cg = autumn ? AUT_LEAF[2][1] : tp[q + 11];
                  cb = autumn ? AUT_LEAF[2][2] : tp[q + 12];
                }
                const cm = cr > cg ? (cr > cb ? cr : cb) : cg > cb ? cg : cb;
                const kk = (max / cm) * (autumn ? 1.05 : 0.95);
                let rr2 = cr * kk;
                let rg2 = cg * kk;
                let rb2 = cb * kk;
                if (!autumn && this.olive <= 0) {
                  // (Leaves drawn in a good green keep half of it; frost-pale ones take the new.)
                  const ko = 0.5 * ramp(chroma / max, 0.18, 0.32);
                  rr2 += (r - rr2) * ko;
                  rg2 += (g - rg2) * ko;
                  rb2 += (b - rb2) * ko;
                }
                nr += (rr2 - nr) * leafy;
                ng += (rg2 - ng) * leafy;
                nb += (rb2 - nb) * leafy;
                if (leafy > own) own = leafy;
              }
            }
          }
        }
      } else if (kind === K_BARE) {
        const d2 = du * du + dw * dw;
        const ls = tp[q + 14];
        if (this.budding) {
          // 8a. Buds: tiny pale green dots along the branches.
          const R = tp[q + 32];
          if (d2 < R * R && MT[mi] < 128) {
            const cov = this.budN.at(u, w, this.buds);
            if (cov > 0) {
              const bk = 0.85 + 0.3 * this.budN.pick;
              nr += (152 * bk - nr) * cov;
              ng += (192 * bk - ng) * cov;
              nb += (94 * bk - nb) * cov;
            }
          }
        } else if (ls > 0) {
          // 8b. A bare tree in leaf: whole clumps round its branches, so the crown follows them
          // and its outline is lumpy, with a dark, leafy rim and the branch tips showing past it.
          const dn = Math.sqrt(d2) * tp[q + 43];
          const thinT = this.thinT;
          const lk = ls * this.thinK;
          const ix = this.sf.ix[t] ?? (this.sf.ix[t] = treeIndex(this.cs, tp, q, true, this.reachK, 1.12 * lk, -0.24 * lk));
          if (clumpAt(this.cs, tp, q, du, dw, ix, this.lt)) {
            clumpColour(this.cs, tp, q, this.lt, this.look, this.bloomK);
            const leaf = CC[4];
            if (thinT <= 0 || (leaf < 0 ? -leaf : leaf) >= thinT) {
              const other = CC[6];
              const pxSq = this.pxSq;
              const rj = CC[5] + 0.024 * leaf;
              const cov = other ? 1 : clamp01(rj / pxSq + 0.5);
              if (cov > 0) {
                const crownLit = 1 - 0.1 * (du * 0.55 + dw * 0.83) * tp[q + 43] - 0.08 * (dn > 1 ? 1 : dn * dn);
                const crease = other ? creaseOf(CC[5] + 0.015 * leaf) : 1;
                const inkA = other ? 0 : 1 - clamp01((rj - this.inkW) / pxSq + 0.5);
                const sh = (0.58 + 0.5 * CC[3]) * (0.86 + 0.28 * (CC[7] - 0.35)) * crownLit * (1 + 0.3 * leaf) * crease;
                let lr = CC[0] * sh;
                let lg = CC[1] * sh;
                let lb = CC[2] * sh;
                lr += (LEAF_INK[0] - lr) * inkA;
                lg += (LEAF_INK[1] - lg) * inkA;
                lb += (LEAF_INK[2] - lb) * inkA;
                nr += (lr - nr) * cov;
                ng += (lg - ng) * cov;
                nb += (lb - nb) * cov;
                if (cov > own) own = cov;
              }
            }
          }
        }
      }
    }
    this.nr = nr;
    this.ng = ng;
    this.nb = nb;
    this.own = own;
  }
}

/**
 * Winter on a map painted under snow (it's winter already): light touches. The snow freshened
 * (its shaded tones lifted a little), frost and then drifts on the patches of grass (right over
 * their soft edges) and the earth, snow settling on evergreens' lit needles and on bare
 * branches, open water freezing.
 */
function winterSnowy(px: Uint8ClampedArray, width: number, rows: number, o: BakeOptions): void {
  const a = o.a;
  const sn = a.snow as SnowInfo;
  const W = SEASON_PARAMS.winter;
  const L = o.level - 1;
  const sf = snowFields(o);
  const has = sf.has;
  const sAct: number[] = [SN_GROUND, SN_TONE, SN_OBJ];
  for (const ch of [SN_CROWN, SN_EVER, SN_LAWN, SN_WATER, SN_EARTH]) if (has[ch]) sAct.push(ch);
  const mAct = [M_REM];
  const fr = new SnowFrame(o, width, sf.f, sAct, mAct, []);
  const T = colourTable();
  const MT = meltTable();
  const seed = o.seed | 0;
  const ppsq = o.cell / o.scale;
  const gt = pickMip(grassTiles(seed), ppsq);
  const gtD = gt.data;
  const gtM = gt.mask;
  const gtS = gt.size;
  const gtR = gt.res;
  const gtJ = gt.size * gt.size * GT_JIT;
  const gc = ROT[0];
  const gs = ROT[1];
  const fresh = W.freshen[L];
  const bs = W.branchSnow[L];
  const es = W.everSnow[L];
  const frost = W.lawnFrost[L];
  const driftL = W.drift[L];
  const driftE = W.earthDrift[L];
  const ice = W.ice[L];
  const ref255 = sn.ref * 255;
  const invRef = 1 / sn.ref;
  const snow = sf.snow;
  const fleck = new Octave(9, 1, mix(seed, 61));
  const clumpN = new Octave(4.2, 3, mix(seed, 62));
  const crackN = new Octave(1.6, 2, mix(seed, 4));
  const tp = sf.tp;
  const tl = sn.tl;
  const rb = fr.rb;
  const C = QC;
  const Q_REM = Q_LOOK + M_REM;
  for (let j = 0; j < rows; j++) {
    fr.row(j);
    const w = fr.w;
    const rowQ = fr.rowQ;
    for (let i = 0, p = j * width * 4; i < width; i++, p += 4) {
      const r = px[p];
      const g = px[p + 1];
      const b = px[p + 2];
      const li = lutIndex(r, g, b);
      if (T[li + 2] === 0 && MT[li >> 2] === 0) continue;
      const c = fr.colI[i];
      const fx = fr.colF[i];
      const g0 = rb[c + SN_GROUND];
      const gnd = g0 + (rb[c + C + SN_GROUND] - g0) * fx;
      const o0 = rb[c + SN_OBJ];
      const obj = o0 + (rb[c + C + SN_OBJ] - o0) * fx;
      if (gnd <= 0 && obj <= 0) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const snowy = T[li + 3] * INV255;
      let nr = r;
      let ng = g;
      let nb = b;
      // Fresh snow: the shaded tones lifted toward the lit one.
      if (fresh > 0 && snowy > 0 && gnd > 0 && lum > 0 && lum < ref255) {
        const k = 1 + fresh * snowy * gnd * (ref255 / lum - 1);
        nr *= k;
        ng *= k;
        nb *= k;
      }
      if (obj > 0) {
        const t0 = rb[c + SN_TONE];
        const tone = t0 + (rb[c + C + SN_TONE] - t0) * fx;
        // The snow as painted round about: its colour at this tone, with this pixel's own detail.
        const tk = tone * invRef;
        // Grass patches and earth: frost, then drifts over them (right over their soft edges).
        const lawn = has[SN_LAWN] ? rb[c + SN_LAWN] + (rb[c + C + SN_LAWN] - rb[c + SN_LAWN]) * fx : 0;
        const earth = has[SN_EARTH] ? rb[c + SN_EARTH] + (rb[c + C + SN_EARTH] - rb[c + SN_EARTH]) * fx : 0;
        const patch = lawn > earth ? lawn : earth;
        if (patch > 0) {
          const tu = fr.colU[i] * gc * gtR - w * gs * gtR;
          const tv = fr.colU[i] * gs * gtR + w * gc * gtR;
          const ta = (Math.floor(tv) & gtM) * gtS + (Math.floor(tu) & gtM);
          const det = (gtD[ta] - 128) * INV255;
          const jit = (gtD[ta + gtJ] - 128) * INV255;
          const rs = rb[c + Q_REM] + (rb[c + C + Q_REM] - rb[c + Q_REM]) * fx + 0.12 * det + 0.04 * jit;
          // (Earth takes less: drifts gather on grass first.)
          const dL = lin(rs - 1 + driftL + 0.05, 12) * lawn;
          const dE = lin(rs - 1 + driftE + 0.05, 12) * earth;
          const drift = dL > dE ? dL : dE;
          // Hoarfrost: pale speckle on the grass's lighter blades.
          const fz = frost * lawn * lin(det + 0.02, 12) * (1 - drift);
          const sl = tk * (1 + 1.2 * det);
          const sr = snow[0] * sl;
          const sg = snow[1] * sl;
          const sb = snow[2] * sl;
          if (fz > 0) {
            nr += (sr * 0.95 - nr) * fz * 0.8;
            ng += (sg * 0.95 - ng) * fz * 0.8;
            nb += (sb * 0.97 - nb) * fz * 0.8;
          }
          if (drift > 0 && MT[li >> 2] < 200) {
            nr += (sr - nr) * drift;
            ng += (sg - ng) * drift;
            nb += (sb - nb) * drift;
          }
        }
        const t = tl[rowQ + fr.colQ[i]] - 1;
        if (t >= 0) {
          const q = t * TP;
          const kind = tp[q + 35];
          const max = r > g ? (r > b ? r : b) : g > b ? g : b;
          if (kind === K_EVER && es > 0) {
            // Snow in clumps on the evergreens' lit needles.
            const evr = rb[c + SN_EVER] + (rb[c + C + SN_EVER] - rb[c + SN_EVER]) * fx;
            if (evr > 0 && max >= 50 && snowy < 0.5) {
              const lit = (lum - tone * 255 * 0.55) / (tone * 255 * 0.45);
              const k = evr * lin(es * 1.2 + 0.35 * lit + 0.5 * (clumpN.at(fr.colU[i], w) - 0.5) - 0.55, 6);
              if (k > 0) {
                const l = 0.75 + 0.3 * (lit < 0 ? 0 : lit > 1 ? 1 : lit);
                nr += (snow[0] * l * tk - nr) * k;
                ng += (snow[1] * l * tk - ng) * k;
                nb += (snow[2] * l * tk - nb) * k;
              }
            }
          } else if (kind === K_BARE && bs > 0 && snowy < 0.5 && max < 200) {
            // Branches: flecks of snow along them, thicker toward the trunk.
            const du = fr.colU[i] - tp[q + 33];
            const dw = w - tp[q + 34];
            const dn = Math.sqrt(du * du + dw * dw) / tp[q + 32];
            if (dn < 1.2) {
              const f = ramp(fleck.at(fr.colU[i], w), 0.52, 0.6) * bs * (1 - ramp(dn, 0.7, 1.2));
              nr += (snow[0] * 0.96 - nr) * f;
              ng += (snow[1] * 0.96 - ng) * f;
              nb += (snow[2] * 0.97 - nb) * f;
            }
          }
        }
        // Open water freezes: a rim of ice, then (deep snow) all of it.
        if (ice > 0 && has[SN_WATER]) {
          const wat = rb[c + SN_WATER] + (rb[c + C + SN_WATER] - rb[c + SN_WATER]) * fx;
          if (wat > 0 && snowy < 0.5) {
            const fz = wat * (ice === 2 ? 1 : ramp(0.9 - wat + 0.3 * (fleck.at(fr.colU[i] * 0.2, w * 0.2) - 0.5), 0, 0.15));
            if (fz > 0) {
              const iv = 0.86 + 0.25 * (lum / 255 - tone);
              let iR = 196 * iv + 30;
              let iG = 220 * iv + 22;
              let iB = 236 * iv + 18;
              if (ice === 2) {
                const cv = Math.abs(crackN.at(fr.colU[i], w) - 0.5);
                if (cv < 0.012) {
                  const kc = 1 - cv / 0.012;
                  iR -= 80 * kc;
                  iG -= 60 * kc;
                  iB -= 36 * kc;
                }
              }
              nr += (iR - nr) * fz;
              ng += (iG - ng) * fz;
              nb += (iB - nb) * fz;
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

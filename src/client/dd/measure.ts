// Measuring object footprints, presence and snow caps from the picture, at attach time on the GM's
// device (design 2.5). Dungeondraft stores an object's centre, rotation, scale and mirror flag but
// not its sprite's size, so each footprint starts from a prior (SPRITE_SIZES, else ROLE_RADIUS)
// and is measured from the picture's pixels; the result is stored in the sidecar, so every device
// uses the same geometry.
//
// Per picture: the baked grid's lines are found and masked (2.5 item 2), and the areas a ground
// model mustn't sample (water, floors, walls, other objects' priors) are rasterised once, with one
// work budget. Per object:
// - the local ground: the annulus 1.3-1.8 x the prior, as up to four colour modes, each with its
//   median and spread (MAD); the design's one median and MAD, split where the ground is two or
//   three things (grass and a path), which a single model blurs into a colour nothing has;
// - "object" pixels: far from every mode (RGB L1 over max(24, 3 MAD), or hue over its own
//   spread), or ink; grid pixels take the verdict of the pixels either side of their line; pixels
//   nearer a neighbour's prior (as a share of each prior) are the neighbour's;
// - the reach: the object mask opened (erode 1 px, dilate 1 px), the part connected to the centre
//   across gaps of 0.1 square, with the holes it encloses (a snow cap ringed by its leaves, a
//   crown's light middle inside its outline), and per REACH_DIRS sector the furthest pixel of it,
//   clamped to 0.4-1.3 x the prior;
// - bare trees instead: their warm branch strokes (bareReach, seasonPixels.ts), centred on
//   Dungeondraft's centre;
// - presence (crowns and solids: a quarter of the core is object; tufts and roots: 8%; bare trees:
//   strokes on 6 of 16 rays within the prior), the snow cap, and the object's own colour.
// An object that seems absent, unless it's a tree of known size, is tried once more at twice its
// prior (a rug as big as a room otherwise has its annulus on itself). Big objects are measured at half the
// resolution. An object too small in the picture to tell (its prior under minPriorPx) is kept on
// its prior and not tested, unless that second try finds it. Pack items are measured the same way
// from the picture alone (their files, names and ids are never looked at) and never dropped; when
// measuring fails they get a generous disc. One that shows only something small round its centre
// (a snowy crown's trunk, its cap the colour of the ground) is tried again with all of its core
// taken for its own (the pieces of the crown's rim), and a direction where nothing of it was found
// past the clamp's lower end reaches as far as the directions either side.
// The data-only cap rule (a later SNOW object over a crown's core) needs no pixels, so it is
// applied to every crown, measured or not, whatever the picture's resolution.

import type { Level, MapObject } from "./model";
import { GRID } from "./model";
import { OR, TR, defaultName, terrainRole, type ObjectRole, type TerrainRole } from "./roles";
import { REACH_DIRS } from "./raster";
import type { PictureRect, PictureSample } from "./extract";
import { fillEllipse, fillPolygons, rasterTiles, rasterWater, strokeRibbon, workBudget, type RasterSpec, type WorkBudget } from "./ddRaster";
import { wallRibbon } from "./geometry";
import { bareReach, blur8, colourTable, diamond, hueOf, lutIndex } from "../room/seasonPixels";

/**
 * Sprite reach profiles by default short name: r (world units at scale 1) and 16 reaches in the
 * sprite's own frame (REACH_DIRS order, world units at scale 1, before mirror and rotation).
 */
export type SpriteSizes = Readonly<Record<string, { r: number; reach: number[] }>>;

/**
 * A role's prior radius in world units at scale 1, for names missing from SPRITE_SIZES. The
 * prototype's nominal radii (by the role's old object kind), except OPAQUE: a pack item's
 * generous 1.5-square disc (2.5 item 7), so its measured reach (clamped to 0.4-1.3 x the prior)
 * can cover a 2-square crown.
 */
export const ROLE_RADIUS: Readonly<Record<ObjectRole, number>> = Object.freeze({
  [OR.EVERGREEN]: 300,
  [OR.DECIDUOUS]: 400,
  [OR.SHRUB]: 140,
  [OR.FLOWER_SHRUB]: 140,
  [OR.BARE]: 300,
  [OR.GRASS]: 90,
  [OR.FLOWERS]: 80,
  [OR.REEDS]: 110,
  [OR.CROP]: 80,
  [OR.MUSHROOM]: 60,
  [OR.ROOTS]: 200,
  [OR.LITTER]: 80,
  [OR.DEADWOOD]: 200,
  [OR.STUMP]: 150,
  [OR.ROCK]: 130,
  [OR.SNOW]: 150,
  [OR.ICE]: 100,
  [OR.WATER_FX]: 250,
  [OR.EFFECT]: 200,
  [OR.FIRE]: 110,
  [OR.STRUCTURE]: 110,
  [OR.OPAQUE]: 1.5 * GRID,
});

/** The measurement's numbers (design 2.5), as shares of the prior unless said otherwise. */
export const MEASURE = {
  /** The local ground model's annulus. */
  annulusIn: 1.3,
  annulusOut: 1.8,
  /** The ground is up to this many colour modes, at least modeApart (RGB L1) apart, each holding modeShare of the annulus. */
  groundModes: 4,
  modeApart: 48,
  modeShare: 0.1,
  /** "Object" when the RGB L1 distance to every mode's median exceeds max(minDist, madK * its MAD)... */
  minDist: 24,
  madK: 3,
  /** ... capped at maxDist (a textured mode, cobbles with their outlines, would otherwise swallow anything dark). */
  maxDist: 40,
  /** ... or the chroma distance (chromaDist) to every mode exceeds max(minChroma, madK * its MAD), capped likewise. */
  minChroma: 20,
  /** Also "object": ink, darker than this share of the darkest mode's luma. */
  inkLum: 0.7,
  /** Measured reach is clamped to this range of the prior. */
  clampMin: 0.4,
  clampMax: 1.3,
  /** Gaps the reach may cross, in squares. */
  gapSquares: 0.1,
  /** The core, for presence (of the prior) and caps (of the measured reach). */
  core: 0.7,
  /** Present when at least this share of the core is "object". */
  presentCore: 0.25,
  /** The same for sparse, thin-stroked things (tufts, flowers, reeds, litter, roots) where they're tested. */
  presentSparse: 0.08,
  /** Bare trees: present when at least this many of the 16 rays meet stroke pixels within the prior. */
  bareRays: 6,
  /** Bare trees: the quantile of warm stroke pixels a direction that sets its reach (bareReach's own). */
  bareQuantile: 0.85,
  /** Capped when at least this share of the object pixels in the core is snow-coloured. */
  cappedShare: 0.35,
  /** Capped too when a later SNOW object's prior covers at least this share of the core. */
  snowOverCore: 0.2,
  /** Not tested when one later object's prior covers at least this share of the core. */
  coveredShare: 0.6,
  /** Above this share of tested trees dropped, the fit is lowered to "unsure". */
  dropTrees: 0.1,
  /** An object (not a sized tree) that the picture doesn't seem to show is measured again with its prior this much bigger. */
  retryPrior: 2,
  /** A pack item whose measurement fails gets this disc, in squares x max(scale). */
  packDiscSquares: 1.5,
  /** Below this many picture pixels a square, bare trees keep their priors. */
  minPxPerSquare: 16,
  /** Objects whose prior reaches over this many picture pixels are measured at half the resolution. */
  halfAbove: 40,
  /** Below this many picture pixels a square, nothing is measured or tested. */
  minMeasurePxPerSquare: 8,
  /**
   * An object whose prior reaches under this many picture pixels is too small to tell (the opening
   * erases it, its core is a handful of pixels): kept on its prior, not tested.
   */
  minPriorPx: 3,
  /** Baked grid: a line pixel is "dark" when it is this much darker (luma) than both sides. */
  gridDark: 6,
  /** Baked grid: at least this share of a line's pixels dark, and over twice the share between lines. */
  gridShare: 0.2,
} as const;

export interface Measured {
  /** 16 reaches in world units, REACH_DIRS order (world frame). */
  reach: Float32Array;
  /** Whether the picture shows it; null when not tested (low-contrast roles, covered objects, packs). */
  present: boolean | null;
  /** A crown-like object carrying a snow cap (2.5 item 6). */
  capped: boolean;
  /** Its own colour (median of its non-snow pixels), RGB 0..255; the prior's is 0, 0, 0. */
  own: [number, number, number];
  /** False: the reach is the prior. */
  measured: boolean;
}

/** Crown-like roles: capped is measured on them (2.5 item 6). */
const CROWN: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.EVERGREEN, OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB]);
/** Trees, for the share of dropped trees that lowers the fit. */
const TREE: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.EVERGREEN, OR.DECIDUOUS, OR.BARE]);
/** Low-contrast on grass terrain: kept on the prior, never tested. They're also part of the ground model. */
const GRASSY: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.GRASS, OR.FLOWERS, OR.LITTER, OR.REEDS]);
/** Thin strokes with ground between them: a lower share of the core makes them present. */
const SPARSE: ReadonlySet<ObjectRole> = new Set<ObjectRole>([...GRASSY, OR.ROOTS]);
/** See-through or never dropped: measured but never tested. */
const UNTESTED: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.EFFECT, OR.WATER_FX, OR.OPAQUE]);
/** Bucket cells and neighbour entries visited per picture, at most (finding covers and claims). */
const NEAR_WORK = 20_000_000;
/** The same for finding the SNOW objects over crowns (their own allowance, so caps don't depend on what was measured first). */
const SNOW_WORK = 5_000_000;
/**
 * How far round its centre an object's measurement looks for neighbours, at most, in its largest
 * prior reach: the clamp of a prior doubled by the retry.
 */
const LOOK = MEASURE.clampMax * MEASURE.retryPrior;
/** The neighbour index's margin round the picture, at most (world units; parsed scales are clamped, so only hand-made levels reach it). */
const MAX_MARGIN = 256 * GRID;
/** Neighbours that may claim pixels round an object, at most (the nearest). */
const MAX_CLAIMS = 32;
/** Layer of water (3.3): an object below it lies under the water's surface. */
const WATER_LAYER = -50;

// ---------------------------------------------------------------- profiles

/**
 * A 16-sample reach profile (REACH_DIRS order) read along the direction (dx, dy): linear between
 * the two nearest samples, sample k standing at diamond position k + 0.5 (2.9).
 */
export function profileAt(reach: ArrayLike<number>, dx: number, dy: number): number {
  let f = diamond(dx, dy) * 4 - 0.5;
  if (f < 0) f += 16;
  const k0 = Math.floor(f);
  const t = f - k0;
  const a = reach[k0 & 15];
  return a + (reach[(k0 + 1) & 15] - a) * t;
}

function spriteSize(sizes: SpriteSizes, name: string | null): { r: number; reach: number[] } | null {
  if (name === null || !Object.prototype.hasOwnProperty.call(sizes, name)) return null;
  const s = sizes[name];
  if (!s || !Array.isArray(s.reach) || s.reach.length !== 16 || !s.reach.every((v) => Number.isFinite(v) && v > 0)) return null;
  return s;
}

/**
 * The object's prior in the world frame (2.5 item 1): SPRITE_SIZES[name] (else the role's
 * ROLE_RADIUS as a circle), scaled by scale.x and scale.y, mirrored, then turned by the rotation.
 * World units, REACH_DIRS order. A pack item's name is never looked up.
 */
export function priorReach(o: MapObject, role: ObjectRole, sizes: SpriteSizes): Float32Array {
  const size = role === OR.OPAQUE ? null : spriteSize(sizes, defaultName(o.texture));
  const base = ROLE_RADIUS[role] ?? ROLE_RADIUS[OR.OPAQUE];
  const sx = o.scale.x || 1, sy = o.scale.y || 1, m = o.mirror ? -1 : 1;
  const c = Math.cos(o.rotation), s = Math.sin(o.rotation);
  const out = new Float32Array(16);
  for (let k = 0; k < 16; k++) {
    const ux = REACH_DIRS[k * 2], uy = REACH_DIRS[k * 2 + 1];
    // Back into the sprite's frame: unturn, unmirror, unscale. The sprite's boundary along that
    // (unnormalised) direction maps to the world boundary along u, 1/|v| as far.
    const vx = ((c * ux + s * uy) * m) / sx, vy = (-s * ux + c * uy) / sy;
    const len = Math.sqrt(vx * vx + vy * vy);
    out[k] = (size ? profileAt(size.reach, vx, vy) : base) / len;
  }
  return out;
}

/**
 * The inverse of priorReach's transform: a world-frame profile of the object (e.g. a measured
 * reach) in the sprite's own frame at scale 1. For scripts/dd/measure-sprites.ts.
 */
export function spriteFrameReach(o: MapObject, world: ArrayLike<number>): Float64Array {
  const sx = o.scale.x || 1, sy = o.scale.y || 1, m = o.mirror ? -1 : 1;
  const c = Math.cos(o.rotation), s = Math.sin(o.rotation);
  const out = new Float64Array(16);
  for (let k = 0; k < 16; k++) {
    const px = REACH_DIRS[k * 2] * sx * m, py = REACH_DIRS[k * 2 + 1] * sy;
    const wx = c * px - s * py, wy = s * px + c * py;
    out[k] = profileAt(world, wx, wy) / Math.sqrt(wx * wx + wy * wy);
  }
  return out;
}

// ---------------------------------------------------------------- the baked grid

/**
 * Whether a family of lines at offset + m * period (picture pixel coordinates, along x for axis 0)
 * is baked into the picture: a line's pixels are darker than both sides (2 px out) noticeably more
 * often than pixels half a period away are.
 */
function gridAxisBaked(lum: Uint8Array, W: number, H: number, axis: 0 | 1, period: number, offset: number): boolean {
  const len = axis === 0 ? W : H, across = axis === 0 ? H : W;
  if (!(period >= 6) || len < 2 * period) return false;
  const step = Math.max(1, Math.floor(across / 512));
  const at = (p: number, q: number): number => (axis === 0 ? lum[q * W + p] : lum[p * W + q]);
  const darkShare = (shift: number): number => {
    let dark = 0, n = 0;
    let X = offset + shift - Math.floor((offset + shift) / period) * period;
    for (; X < len; X += period) {
      const pa = Math.ceil(X - 1.5), pb = Math.floor(X + 0.5);
      if (pa - 2 < 0 || pb + 2 >= len) continue;
      for (let q = 0; q < across; q += step) {
        let lo = 255;
        for (let p = pa; p <= pb; p++) lo = Math.min(lo, at(p, q));
        n++;
        if (lo + MEASURE.gridDark <= Math.min(at(pa - 2, q), at(pb + 2, q))) dark++;
      }
    }
    return n ? dark / n : 0;
  };
  const on = darkShare(0), off = darkShare(period / 2);
  return on >= MEASURE.gridShare && on >= 2 * off + 0.05;
}

/** Marks the pixels within 1 px of each line (1: a line along y, at an x; 2: along x). */
function markGrid(mask: Uint8Array, W: number, H: number, axis: 0 | 1, period: number, offset: number): void {
  const len = axis === 0 ? W : H;
  for (let X = offset - Math.floor(offset / period) * period; X < len + 1; X += period) {
    const pa = Math.max(0, Math.ceil(X - 1.5)), pb = Math.min(len - 1, Math.floor(X + 0.5));
    for (let p = pa; p <= pb; p++) {
      if (axis === 0) for (let y = 0; y < H; y++) mask[y * W + p] |= 1;
      else for (let x = 0; x < W; x++) mask[p * W + x] |= 2;
    }
  }
}

// ---------------------------------------------------------------- per picture

interface Pic {
  rgba: Uint8ClampedArray;
  W: number;
  H: number;
  /** Picture pixels a square. */
  pps: number;
  lum: Uint8Array;
  /** 1/2/3 on a baked grid's vertical/horizontal lines; null when none is baked. */
  grid: Uint8Array | null;
  /** Water, floors and walls: no ground model there. */
  excl: Uint8Array;
  /**
   * The last drawn prior (object index + 1) of the objects that aren't low-contrast; 0 none. 16-bit
   * when the level has fewer than 65,535 objects (a 200-square picture at 32 px is 41M pixels).
   */
  owner: Int32Array | Uint16Array;
  /** The same with each prior grown to its clamp (1.3 x): where a neighbour's crown may still reach. */
  wide: Int32Array | Uint16Array;
  ownerRole: ObjectRole[];
}

/** Per-object scratch, grown as needed. */
class Scratch {
  t = new Float32Array(0);
  a = new Uint8Array(0);
  b = new Uint8Array(0);
  c = new Uint8Array(0);
  d = new Uint8Array(0);
  q = new Int32Array(0);
  /** A bare tree's luma crop, its blur, and the blur's sums. */
  l = new Uint8Array(0);
  lb = new Uint8Array(0);
  li = new Int32Array(0);
  ensure(n: number): void {
    if (this.t.length >= n) return;
    const m = Math.max(n, this.t.length * 2);
    this.t = new Float32Array(m);
    this.a = new Uint8Array(m);
    this.b = new Uint8Array(m);
    this.c = new Uint8Array(m);
    this.d = new Uint8Array(m);
    this.q = new Int32Array(m);
  }
  ensureL(n: number): void {
    if (this.l.length >= n) return;
    const m = Math.max(n, this.l.length * 2);
    this.l = new Uint8Array(m);
    this.lb = new Uint8Array(m);
    this.li = new Int32Array(m);
  }
}

const HR = new Int32Array(256), HG = new Int32Array(256), HB = new Int32Array(256);
const MODES = 4;
const H4 = new Int32Array(4096), N4 = new Int32Array(4096), MODE_H = new Int32Array(MODES * 768);
const MODE_D = new Int32Array(MODES * 766), MODE_C = new Int32Array(MODES * 1021);
/** The cells of H4 and N4 in use (cleared after each object). */
const HC = new Int32Array(4096), NC = new Int32Array(4096);
/** Each annulus pixel's mode. */
let MODE_OF = new Uint8Array(0);
/**
 * Up to MEASURE.groundModes modes of the ground: medians (RGB, 3 a mode), and thresholds on the RGB
 * L1 distance (thr) and on the chroma distance (thrC; see chromaDist).
 */
const GROUND = { n: 0, med: new Float64Array(MODES * 3), thr: new Float64Array(MODES), thrC: new Float64Array(MODES) };

/** How far apart two colours' hues lie: |d(r - g)| + |d(b - g)|, blind to brightness. */
function chromaDist(r: number, g: number, b: number, mr: number, mg: number, mb: number): number {
  return Math.abs(r - g - mr + mg) + Math.abs(b - g - mb + mg);
}

/**
 * The ground's colour modes over the pixels ann[0..cnt) (indices into rgba / 4): the densest cells
 * of a 16-level colour grid (each counted with its 26 neighbours), each at least modeApart (L1)
 * from the ones before and, after the first, holding at least modeShare of the pixels. Every pixel
 * then joins its nearest mode, and each mode gets the median of its own pixels and the MADs of
 * their RGB L1 and chroma distances to it.
 */
function groundModes(rgba: Uint8ClampedArray, ann: Int32Array, cnt: number): typeof GROUND {
  if (MODE_OF.length < cnt) MODE_OF = new Uint8Array(Math.max(cnt, 2 * MODE_OF.length));
  // (Only the cells the annulus touches are visited and cleared: an annulus holds a few dozen.)
  let nh = 0, nn = 0;
  for (let p = 0; p < cnt; p++) {
    const o = ann[p] * 4;
    const cell = ((rgba[o] >> 4) << 8) | ((rgba[o + 1] >> 4) << 4) | (rgba[o + 2] >> 4);
    if (H4[cell]++ === 0) HC[nh++] = cell;
  }
  for (let q = 0; q < nh; q++) {
    const cell = HC[q], v = H4[cell];
    const r = cell >> 8, g = (cell >> 4) & 15, bl = cell & 15;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const rr = r + dr, gg = g + dg, bb = bl + db;
      if (rr < 0 || gg < 0 || bb < 0 || rr > 15 || gg > 15 || bb > 15) continue;
      const c = (rr << 8) | (gg << 4) | bb;
      if (N4[c] === 0) NC[nn++] = c;
      N4[c] += v;
    }
  }
  // In cell order, so ties go to the lowest cell.
  const touched = NC.subarray(0, nn).sort();
  const centre = new Float64Array(MODES * 3);
  let n = 0;
  while (n < MEASURE.groundModes) {
    let best = -1, bestV = 0;
    for (let q = 0; q < nn; q++) {
      const cell = touched[q];
      if (N4[cell] <= bestV) continue;
      const r = (cell >> 8) * 16 + 8, g = ((cell >> 4) & 15) * 16 + 8, bl = (cell & 15) * 16 + 8;
      let ok = true;
      for (let m = 0; m < n && ok; m++) ok = Math.abs(r - centre[m * 3]) + Math.abs(g - centre[m * 3 + 1]) + Math.abs(bl - centre[m * 3 + 2]) > MEASURE.modeApart;
      if (ok) { best = cell; bestV = N4[cell]; }
    }
    if (best < 0 || (n > 0 && bestV < MEASURE.modeShare * cnt)) break;
    centre[n * 3] = (best >> 8) * 16 + 8;
    centre[n * 3 + 1] = ((best >> 4) & 15) * 16 + 8;
    centre[n * 3 + 2] = (best & 15) * 16 + 8;
    n++;
  }
  for (let q = 0; q < nh; q++) H4[HC[q]] = 0;
  for (let q = 0; q < nn; q++) N4[touched[q]] = 0;
  if (!n) { centre.fill(128, 0, 3); n = 1; }
  const nearest = (o: number): number => {
    let bm = 0, bd = Infinity;
    for (let m = 0; m < n; m++) {
      const d = Math.abs(rgba[o] - centre[m * 3]) + Math.abs(rgba[o + 1] - centre[m * 3 + 1]) + Math.abs(rgba[o + 2] - centre[m * 3 + 2]);
      if (d < bd) { bd = d; bm = m; }
    }
    return bm;
  };
  const count = new Array<number>(MODES).fill(0);
  const assign = (): void => {
    MODE_H.fill(0);
    count.fill(0);
    for (let p = 0; p < cnt; p++) {
      const o = ann[p] * 4, m = nearest(o);
      MODE_OF[p] = m;
      MODE_H[m * 768 + rgba[o]]++;
      MODE_H[m * 768 + 256 + rgba[o + 1]]++;
      MODE_H[m * 768 + 512 + rgba[o + 2]]++;
      count[m]++;
    }
  };
  assign();
  // (A mode can end up with next to no pixels of its own, when its cell's neighbours made it dense:
  // it is dropped, and its pixels join the others.)
  let kept = 0;
  for (let m = 0; m < n; m++) {
    if (count[m] < Math.max(4, 0.03 * cnt) && (kept > 0 || m < n - 1)) continue;
    centre.copyWithin(kept * 3, m * 3, m * 3 + 3);
    kept++;
  }
  if (kept < n) {
    n = kept;
    assign();
  }
  for (let m = 0; m < n; m++) {
    for (let ch = 0; ch < 3; ch++) GROUND.med[m * 3 + ch] = histMedian(MODE_H.subarray(m * 768 + ch * 256, m * 768 + ch * 256 + 256), count[m]);
  }
  MODE_D.fill(0);
  MODE_C.fill(0);
  const med = GROUND.med;
  for (let p = 0; p < cnt; p++) {
    const o = ann[p] * 4, m = MODE_OF[p], q = m * 3;
    MODE_D[m * 766 + Math.abs(rgba[o] - med[q]) + Math.abs(rgba[o + 1] - med[q + 1]) + Math.abs(rgba[o + 2] - med[q + 2])]++;
    MODE_C[m * 1021 + chromaDist(rgba[o], rgba[o + 1], rgba[o + 2], med[q], med[q + 1], med[q + 2])]++;
  }
  for (let m = 0; m < n; m++) {
    const mad = histMedian(MODE_D.subarray(m * 766, m * 766 + 766), count[m]);
    GROUND.thr[m] = Math.max(MEASURE.minDist, Math.min(MEASURE.maxDist, MEASURE.madK * mad));
    const madC = histMedian(MODE_C.subarray(m * 1021, m * 1021 + 1021), count[m]);
    GROUND.thrC[m] = Math.max(MEASURE.minChroma, Math.min(MEASURE.maxDist, MEASURE.madK * madC));
  }
  GROUND.n = n;
  return GROUND;
}

function histMedian(h: Int32Array, n: number): number {
  let acc = 0;
  for (let v = 0; v < h.length; v++) {
    acc += h[v];
    if (2 * acc >= n) return v;
  }
  return h.length - 1;
}

/** The terrain role with the most weight at a world point (null without terrain). */
function terrainAt(level: Level, x: number, y: number): TerrainRole | null {
  const t = level.terrain;
  if (!t || !t.enabled || t.width <= 0 || t.height <= 0) return null;
  const tx = Math.floor(x / (GRID / 4)), ty = Math.floor(y / (GRID / 4));
  if (tx < 0 || ty < 0 || tx >= t.width || ty >= t.height) return null;
  const sum = new Map<TerrainRole, number>();
  for (let s = 0; s < t.slotCount; s++) {
    const w = t.weights[s * t.width * t.height + ty * t.width + tx];
    if (!w) continue;
    const r = terrainRole(defaultName(t.slots[s] ?? null));
    sum.set(r, (sum.get(r) ?? 0) + w);
  }
  let best: TerrainRole | null = null, bw = 0;
  for (const [r, w] of sum) if (w > bw) { best = r; bw = w; }
  return best;
}

/**
 * The picture at half the resolution (2 x 2 averages; the grid, the areas and the priors' owners
 * carried over), for measuring big objects.
 */
function halfPic(P: Pic): Pic {
  const W2 = P.W >> 1, H2 = P.H >> 1, N2 = W2 * H2, W = P.W;
  const rgba = new Uint8ClampedArray(N2 * 4), lum = new Uint8Array(N2);
  const grid = P.grid ? new Uint8Array(N2) : null;
  const excl = new Uint8Array(N2);
  const owner = P.owner instanceof Uint16Array ? new Uint16Array(N2) : new Int32Array(N2);
  const wide = P.wide instanceof Uint16Array ? new Uint16Array(N2) : new Int32Array(N2);
  for (let y = 0, j = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++, j++) {
      const k = 2 * y * W + 2 * x, ks = [k, k + 1, k + W, k + W + 1];
      for (let ch = 0; ch < 4; ch++) {
        let v = 0;
        for (const q of ks) v += P.rgba[q * 4 + ch];
        rgba[j * 4 + ch] = (v + 2) >> 2;
      }
      lum[j] = ((299 * rgba[j * 4] + 587 * rgba[j * 4 + 1] + 114 * rgba[j * 4 + 2] + 500) / 1000) | 0;
      if (grid && P.grid) grid[j] = P.grid[ks[0]] | P.grid[ks[1]] | P.grid[ks[2]] | P.grid[ks[3]];
      excl[j] = P.excl[ks[0]] | P.excl[ks[1]] | P.excl[ks[2]] | P.excl[ks[3]];
      owner[j] = P.owner[k];
      wide[j] = P.wide[k];
    }
  }
  return { rgba, W: W2, H: H2, pps: P.pps / 2, lum, grid, excl, owner, wide, ownerRole: P.ownerRole };
}

// ---------------------------------------------------------------- per object

interface Local {
  /** Reach per sector in picture pixels, before the clamp; NaN where nothing was found. */
  reach: Float64Array;
  /** Share of the core (0.7 x prior) that is object. */
  share: number;
  /** Something connected to the centre was found. */
  found: boolean;
  capped: boolean;
  own: [number, number, number];
}

/**
 * One crown-like or solid object (2.5 items 3, 4, 5, 6). pr: the prior in picture pixels; nb: the
 * neighbours that can claim pixels, as x, y and mean prior radius (picture pixels) each. The snow
 * cap is only measured on a crown. wholeCore: everything in the core is the object's own, not
 * only what lies round its centre (a pack item's second try).
 */
function measureSolid(P: Pic, S: Scratch, i: number, pr: Float64Array, cx: number, cy: number, nb: readonly number[], crown: boolean, wholeCore: boolean): Local | null {
  const { rgba, W, H, lum, grid, excl, owner, wide } = P;
  let R = 0;
  for (let k = 0; k < 16; k++) R = Math.max(R, pr[k]);
  if (!(R >= 1.5)) return null;
  // t: each pixel's distance from the centre over the prior's reach that way, in a box (first the
  // annulus's, then the clamp's).
  let bx0 = 0, by0 = 0, bw = 0, bh = 0, n = 0;
  let rMin = Infinity;
  for (let k = 0; k < 16; k++) rMin = Math.min(rMin, pr[k]);
  /** exact: t everywhere; else only where it can lie in the annulus (0 well inside it, 9 well outside). */
  const setBox = (box: number, exact: boolean): boolean => {
    bx0 = Math.max(0, Math.floor(cx - box));
    by0 = Math.max(0, Math.floor(cy - box));
    bw = Math.min(W - 1, Math.floor(cx + box)) - bx0 + 1;
    bh = Math.min(H - 1, Math.floor(cy + box)) - by0 + 1;
    if (bw <= 0 || bh <= 0) return false;
    n = bw * bh;
    S.ensure(n);
    for (let y = 0, j = 0; y < bh; y++) {
      const dy = by0 + y + 0.5 - cy;
      for (let x = 0; x < bw; x++, j++) {
        const dx = bx0 + x + 0.5 - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (!exact && d < MEASURE.annulusIn * rMin) S.t[j] = 0;
        else if (!exact && d > MEASURE.annulusOut * R) S.t[j] = 9;
        else S.t[j] = d > 0 ? d / profileAt(pr, dx, dy) : 0;
      }
    }
    return true;
  };
  if (!setBox(Math.ceil(MEASURE.annulusOut * R) + 2, false)) return null;
  const t = S.t;

  // 3. The local ground: the annulus, leaving out water, floors, walls and other objects' priors
  // (grown to their clamp) while enough is left; else first allowing the areas, then the priors'
  // own size, then everything but the grid. The ground round an object is often two or three
  // things (grass and a path, snow and a cliff's shadow), so it is up to four colour modes, each
  // with its median and spread (MAD): one median and MAD over a mix would be a colour nothing has,
  // with a spread that hides the object.
  const aIn = MEASURE.annulusIn, aOut = MEASURE.annulusOut;
  const other = (m: Int32Array | Uint16Array, k: number): boolean => m[k] !== 0 && m[k] !== i + 1;
  let total = 0, cA = 0, cB = 0, cC = 0;
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) {
      if (t[j] < aIn || t[j] > aOut) continue;
      const k = (by0 + y) * W + bx0 + x;
      if (grid && grid[k]) continue;
      total++;
      if (other(owner, k)) continue;
      cC++;
      if (other(wide, k)) continue;
      cB++;
      if (!excl[k]) cA++;
    }
  }
  const need = Math.max(24, 0.08 * total);
  const pass = cA >= need ? 0 : cB >= need ? 1 : cC >= need ? 2 : total >= 8 ? 3 : -1;
  if (pass < 0) return null;
  const ann = S.q;
  let cnt = 0;
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) {
      if (t[j] < aIn || t[j] > aOut) continue;
      const k = (by0 + y) * W + bx0 + x;
      if (grid && grid[k]) continue;
      if (pass < 3 && other(owner, k)) continue;
      if (pass < 2 && other(wide, k)) continue;
      if (pass < 1 && excl[k]) continue;
      ann[cnt++] = k;
    }
  }
  const { n: nm, med, thr, thrC } = groundModes(rgba, ann, cnt);
  // From here on only the clamp matters (the box shrinks, so the scratch stays put).
  setBox(Math.ceil(MEASURE.clampMax * R) + 2, true);
  let darkest = 255;
  for (let m = 0; m < nm; m++) darkest = Math.min(darkest, (299 * med[m * 3] + 587 * med[m * 3 + 1] + 114 * med[m * 3 + 2]) / 1000);
  const inkBelow = MEASURE.inkLum * darkest;

  // "Object" pixels within the clamp (a: 0 ground, 1 object, 2 grid, 3 outside the clamp): far from
  // every mode of the ground in RGB or in hue (a dark green crown is near a grey cobbled path in
  // RGB alone), or ink.
  // Where a neighbour's prior is nearer (as a share of each prior) than this object's, the pixel is
  // the neighbour's (claimed = 1): touching crowns in a wood would otherwise flood into each other.
  const cMax = MEASURE.clampMax;
  const a = S.a, claimed = S.d;
  claimed.fill(0, 0, n);
  for (let q = 0; q < nb.length; q += 3) {
    // (Only within cMax of the neighbour's radius can it be nearer than t <= cMax.)
    const nx = nb[q] - bx0, ny = nb[q + 1] - by0, nr = nb[q + 2], reach = cMax * nr;
    const x0 = Math.max(0, Math.floor(nx - reach)), x1 = Math.min(bw - 1, Math.ceil(nx + reach));
    const y0 = Math.max(0, Math.floor(ny - reach)), y1 = Math.min(bh - 1, Math.ceil(ny + reach));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - ny;
      for (let x = x0, j = y * bw + x0; x <= x1; x++, j++) {
        const dx = x + 0.5 - nx, tj = t[j];
        if (tj > 0.35 && dx * dx + dy * dy < tj * tj * nr * nr) claimed[j] = 1;
      }
    }
  }
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) {
      if (t[j] > cMax) { a[j] = 3; continue; }
      const k = (by0 + y) * W + bx0 + x;
      if (grid && grid[k]) { a[j] = 2; continue; }
      const o = k * 4;
      let far = 1;
      for (let m = 0, q = 0; m < nm && far; m++, q += 3) {
        const r = rgba[o], g = rgba[o + 1], bl = rgba[o + 2];
        if (Math.abs(r - med[q]) + Math.abs(g - med[q + 1]) + Math.abs(bl - med[q + 2]) <= thr[m] && chromaDist(r, g, bl, med[q], med[q + 1], med[q + 2]) <= thrC[m]) far = 0;
      }
      a[j] = far || lum[k] < inkBelow ? 1 : 0;
    }
  }
  // 2. Grid pixels take the verdict of the pixels either side of their line: object only when
  // both are (lines first, then their crossings).
  if (grid) {
    for (let pass2 = 0; pass2 < 2; pass2++) {
      for (let y = 0, j = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++, j++) {
          if (a[j] !== 2) continue;
          const g = grid[(by0 + y) * W + bx0 + x];
          if (pass2 === 0 && g === 3) continue;
          const side = (sx: number, sy: number): number => {
            let xx = x, yy = y;
            for (let s = 0; s < 4; s++) {
              xx += sx; yy += sy;
              if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) return 0;
              const v = a[yy * bw + xx];
              if (v !== 2) return v === 1 ? 1 : 0;
            }
            return 0;
          };
          const across = (g & 1 ? side(-1, 0) & side(1, 0) : 0) | (g & 2 ? side(0, -1) & side(0, 1) : 0);
          S.b[j] = across ? 1 : 0;
        }
      }
      for (let j = 0; j < n; j++) if (a[j] === 2 && (pass2 === 1 || grid[(by0 + Math.floor(j / bw)) * W + bx0 + (j % bw)] !== 3)) a[j] = S.b[j] ? 1 : 0;
    }
    for (let j = 0; j < n; j++) if (a[j] === 2) a[j] = 0;
  }

  // 4. Opened (erode 1 px, dilate 1 px, 3 x 3, each as a row pass then a column pass) into b.
  const b = S.b, c = S.c;
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) {
      b[j] = x > 0 && x < bw - 1 && a[j - 1] === 1 && a[j] === 1 && a[j + 1] === 1 ? 1 : 0;
    }
  }
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) c[j] = y > 0 && y < bh - 1 && b[j - bw] && b[j] && b[j + bw] ? 1 : 0;
  }
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) b[j] = c[j] || (x > 0 && c[j - 1]) || (x < bw - 1 && c[j + 1]) ? 1 : 0;
  }
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) c[j] = b[j] || (y > 0 && b[j - bw]) || (y < bh - 1 && b[j + bw]) ? 1 : 0;
  }
  for (let j = 0; j < n; j++) b[j] = a[j] !== 3 && c[j] ? 1 : 0;
  // The opened mask grown by half the gap (so gaps up to the gap close), within the clamp, into c.
  const gR = Math.max(1, Math.round((MEASURE.gapSquares * P.pps) / 2));
  {
    const tmp = S.q;
    for (let y = 0, j = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++, j++) {
        let any = 0;
        for (let xx = Math.max(0, x - gR); xx <= Math.min(bw - 1, x + gR); xx++) if (b[y * bw + xx]) { any = 1; break; }
        tmp[j] = any;
      }
    }
    for (let y = 0, j = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++, j++) {
        let any = 0;
        if (a[j] !== 3) for (let yy = Math.max(0, y - gR); yy <= Math.min(bh - 1, y + gR); yy++) if (tmp[yy * bw + x]) { any = 1; break; }
        c[j] = any;
      }
    }
  }
  // Holes: the outside floods in over the ground (c = 3), and ground it can't reach is enclosed by
  // object (c = 4): a snow cap ringed by its leaves, a crown's light middle inside its dark rim or
  // its ink outline. Thin object pixels the opening took (c = 6: outlines, twigs) stop the flood
  // here, but carry nothing on their own.
  const Q = S.q;
  let qn = 0;
  for (let j = 0; j < n; j++) if (c[j] === 0 && a[j] === 1) c[j] = 6;
  for (let j = 0; j < n; j++) {
    if (c[j] !== 0) continue;
    const x = j % bw, y = (j - x) / bw;
    if (a[j] === 3 || x === 0 || y === 0 || x === bw - 1 || y === bh - 1) { c[j] = 3; Q[qn++] = j; }
  }
  for (let qi = 0; qi < qn; qi++) {
    const j = Q[qi], x = j % bw;
    if (x > 0 && c[j - 1] === 0) { c[j - 1] = 3; Q[qn++] = j - 1; }
    if (x < bw - 1 && c[j + 1] === 0) { c[j + 1] = 3; Q[qn++] = j + 1; }
    if (j >= bw && c[j - bw] === 0) { c[j - bw] = 3; Q[qn++] = j - bw; }
    if (j + bw < n && c[j + bw] === 0) { c[j + bw] = 3; Q[qn++] = j + bw; }
  }
  for (let j = 0; j < n; j++) if (c[j] === 0) c[j] = 4;
  // The part connected to the centre (seeds: object or holes in the inner 0.35, else in the core,
  // or in the whole core at once): its object pixels get c = 2, its holes c = 5.
  qn = 0;
  for (const lim of wholeCore ? [MEASURE.core] : [0.35, MEASURE.core]) {
    for (let j = 0; j < n; j++) {
      if (t[j] > lim || claimed[j] || !((c[j] === 1 && b[j]) || c[j] === 4)) continue;
      c[j] = c[j] === 1 ? 2 : 5;
      Q[qn++] = j;
    }
    if (qn) break;
  }
  const found = qn > 0;
  for (let qi = 0; qi < qn; qi++) {
    const j = Q[qi], x = j % bw, y = (j - x) / bw;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(bh - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(bw - 1, x + 1); xx++) {
        const q = yy * bw + xx;
        if (claimed[q]) continue;
        if (c[q] === 1) { c[q] = 2; Q[qn++] = q; }
        else if (c[q] === 4) { c[q] = 5; Q[qn++] = q; }
      }
    }
  }
  // Thin pixels touching it are its outline (c = 7).
  for (let j = 0; j < n; j++) {
    if (c[j] !== 6 || claimed[j]) continue;
    const x = j % bw, y = (j - x) / bw;
    let touch = false;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(bh - 1, y + 1) && !touch; yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(bw - 1, x + 1); xx++) {
        const v = c[yy * bw + xx];
        if (v === 2 || v === 5) { touch = true; break; }
      }
    }
    if (touch) c[j] = 7;
  }
  /** The object: connected and opened, a hole of it, or its outline. */
  const isObj = (j: number): boolean => (c[j] === 2 && b[j] === 1) || c[j] === 5 || c[j] === 7;

  // Reach per sector: the furthest pixel of the object.
  const reach = new Float64Array(16).fill(NaN);
  const T = colourTable();
  for (let y = 0, j = 0; y < bh; y++) {
    const dy = by0 + y + 0.5 - cy;
    for (let x = 0; x < bw; x++, j++) {
      if (!isObj(j)) continue;
      const dx = bx0 + x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.5;
      const k = Math.floor(diamond(dx, dy) * 4) & 15;
      if (!(reach[k] >= d)) reach[k] = d;
    }
  }

  // 5. Presence: the share of the core that is object (or enclosed by it).
  let coreN = 0, coreObj = 0;
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) {
      if (t[j] > MEASURE.core || claimed[j]) continue;
      if (grid && grid[(by0 + y) * W + bx0 + x]) continue;
      coreN++;
      if (a[j] === 1 || c[j] >= 4) coreObj++;
    }
  }
  const share = coreN ? coreObj / coreN : 0;

  // 6. Capped: snow-coloured object pixels in the core of the measured reach. And the object's
  // own colour: the median of its non-snow pixels.
  let capN = 0, capSnow = 0, ownN = 0;
  HR.fill(0); HG.fill(0); HB.fill(0);
  if (found) {
    const mreach = new Float64Array(16);
    for (let k = 0; k < 16; k++) mreach[k] = clampReach(reach[k], pr[k]);
    for (let y = 0, j = 0; y < bh; y++) {
      const dy = by0 + y + 0.5 - cy;
      for (let x = 0; x < bw; x++, j++) {
        if (!isObj(j)) continue;
        const k = (by0 + y) * W + bx0 + x;
        if (grid && grid[k]) continue;
        const o = k * 4;
        const snow = T[lutIndex(rgba[o], rgba[o + 1], rgba[o + 2]) + 3] >= 128;
        if (!snow) {
          HR[rgba[o]]++; HG[rgba[o + 1]]++; HB[rgba[o + 2]]++;
          ownN++;
        }
        if (!crown) continue;
        const dx = bx0 + x + 0.5 - cx;
        if (Math.sqrt(dx * dx + dy * dy) > MEASURE.core * profileAt(mreach, dx, dy)) continue;
        capN++;
        if (snow) capSnow++;
      }
    }
  }
  const own: [number, number, number] = ownN >= 4 ? [histMedian(HR, ownN), histMedian(HG, ownN), histMedian(HB, ownN)] : [0, 0, 0];
  return { reach, share, found, capped: capN > 0 && capSnow >= MEASURE.cappedShare * capN, own };
}

/**
 * Fills the directions where nothing was found beyond `floor` (picture pixels each; NaN: nothing
 * at all) with the larger of the nearest such directions on either side, round the circle; left as
 * they are when there is none.
 */
function fillGaps(reach: Float64Array, floor: Float64Array): void {
  const found = reach.map((r, k) => (r > floor[k] ? r : NaN));
  for (let k = 0; k < 16; k++) {
    if (found[k] >= 0) continue;
    let a = NaN, b = NaN;
    for (let s = 1; s < 16 && !(a >= 0); s++) a = found[(k + 16 - s) & 15];
    for (let s = 1; s < 16 && !(b >= 0); s++) b = found[(k + s) & 15];
    if (a >= 0) reach[k] = Math.max(a, b);
  }
}

/** A measured reach (NaN: nothing found) clamped to 0.4-1.3 x the prior. */
function clampReach(r: number, prior: number): number {
  if (!(r >= 0)) return MEASURE.clampMin * prior;
  return Math.min(MEASURE.clampMax * prior, Math.max(MEASURE.clampMin * prior, r));
}

/**
 * A bare tree (2.5 items 4, 5): the warm strokes of snowAnalysis step 6 (and ink along them) round
 * Dungeondraft's centre, leaving out other objects' priors. Returns the rays that meet strokes
 * within the prior, and the reach per sector from the strokes within the clamp (picture pixels).
 */
function measureBare(P: Pic, S: Scratch, i: number, pr: Float64Array, cx: number, cy: number): { hit: number; reach: Float64Array } | null {
  const { rgba, W, H, lum, grid, owner, ownerRole } = P;
  let R = 0;
  for (let k = 0; k < 16; k++) R = Math.max(R, pr[k]);
  if (!(R >= 1.5)) return null;
  const B = Math.ceil(MEASURE.clampMax * R) + 2;
  const bx0 = Math.max(0, Math.floor(cx - B)), bx1 = Math.min(W - 1, Math.floor(cx + B));
  const by0 = Math.max(0, Math.floor(cy - B)), by1 = Math.min(H - 1, Math.floor(cy + B));
  if (bx1 < bx0 || by1 < by0) return null;
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, n = bw * bh;
  S.ensure(n);
  // Luma blurred over a quarter square round the box only: the crop takes the blur's radius more on
  // each side (clipped to the picture, whose edges blur8 repeats as a whole-picture blur would).
  const rb = Math.max(1, Math.round(0.25 * P.pps));
  const lx0 = Math.max(0, bx0 - rb), ly0 = Math.max(0, by0 - rb);
  const lw = Math.min(W - 1, bx1 + rb) - lx0 + 1, lh = Math.min(H - 1, by1 + rb) - ly0 + 1;
  S.ensureL(lw * lh);
  for (let y = 0; y < lh; y++) S.l.set(lum.subarray((ly0 + y) * W + lx0, (ly0 + y) * W + lx0 + lw), y * lw);
  const lumL = blur8(S.l, lw, lh, rb, S.lb, S.li);
  const T = colourTable();
  // The strokes and their labels in the box's own pixels (bareReach only sees offsets from the centre).
  const t = S.t, warm = S.a, ink = S.b, stroke = S.c, lab = S.q;
  for (let y = 0, j = 0; y < bh; y++) {
    const dy = by0 + y + 0.5 - cy;
    for (let x = 0; x < bw; x++, j++) {
      const dx = bx0 + x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      t[j] = d > 0 ? d / profileAt(pr, dx, dy) : 0;
      warm[j] = 0;
      ink[j] = 0;
      const k = (by0 + y) * W + bx0 + x, kl = (by0 + y - ly0) * lw + bx0 + x - lx0;
      if (t[j] > MEASURE.clampMax || (grid && grid[k])) continue;
      const ow = owner[k];
      if (ow !== 0 && ow !== i + 1 && ownerRole[ow - 1] !== OR.BARE) continue;
      const o = k * 4, r = rgba[o], g = rgba[o + 1], bl = rgba[o + 2];
      const li = lutIndex(r, g, bl);
      if (T[li] * T[li + 2] >= 80 * 255 || T[li + 3] >= 160) continue;
      const h = r > bl + 6 ? hueOf(r, g, bl) : 180;
      if ((h < 50 || h > 330) && lum[k] * 100 < lumL[kl] * 94) warm[j] = 1;
      else if ((r > g ? (r > bl ? r : bl) : g > bl ? g : bl) < 90 || lum[k] * 100 < lumL[kl] * 84) ink[j] = 1;
    }
  }
  // Strokes: warm, or ink touching warm (the outline drawn along a branch).
  for (let y = 0, j = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, j++) {
      let s = warm[j];
      if (!s && ink[j]) {
        for (let yy = Math.max(0, y - 1); yy <= Math.min(bh - 1, y + 1) && !s; yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(bw - 1, x + 1); xx++) if (warm[yy * bw + xx]) { s = 1; break; }
        }
      }
      stroke[j] = s;
    }
  }
  const reach = new Float64Array(16);
  const setLab = (lim: number): void => {
    for (let j = 0; j < n; j++) lab[j] = t[j] <= lim ? 1 : 0;
  };
  // (The scratch may be longer than the box: bareReach's height is its length over the width, so
  // the box's own rows are passed as y1.)
  setLab(1);
  const { hit } = bareReach(stroke, lab, 1, bw, 0, 0, bw - 1, bh - 1, cx - bx0, cy - by0, P.pps, reach);
  setLab(MEASURE.clampMax);
  bareReach(stroke, lab, 1, bw, 0, 0, bw - 1, bh - 1, cx - bx0, cy - by0, P.pps, reach);
  return { hit, reach };
}

// ---------------------------------------------------------------- objects that cover others

/** Points of an object's core (0.7 x reach): the centre and three rings of 16, world units. */
function corePoints(x: number, y: number, reach: ArrayLike<number>, out: Float64Array): void {
  out[0] = x;
  out[1] = y;
  let p = 2;
  for (const f of [0.2, 0.45, 0.7]) {
    for (let k = 0; k < 16; k++) {
      out[p++] = x + REACH_DIRS[k * 2] * reach[k] * f;
      out[p++] = y + REACH_DIRS[k * 2 + 1] * reach[k] * f;
    }
  }
}
const CORE_PTS = 49;

function coverShare(pts: Float64Array, x: number, y: number, reach: ArrayLike<number>): number {
  let inside = 0;
  for (let p = 0; p < CORE_PTS * 2; p += 2) {
    const dx = pts[p] - x, dy = pts[p + 1] - y;
    if (dx * dx + dy * dy <= 1e-9 || Math.sqrt(dx * dx + dy * dy) <= profileAt(reach, dx, dy)) inside++;
  }
  return inside / CORE_PTS;
}

// ---------------------------------------------------------------- measureObjects

/**
 * Measures level.objects (roles[i] is level.objects[i]'s role), one result each, in order.
 * `grid` describes the scene's grid in `pic`'s pixels (lines at offsetX + m * pxPerSquare and
 * offsetY + m * pxPerSquare), null when the scene has none; Dungeondraft's own grid (every square of
 * `rect`) is always checked. Either is masked only when the picture has it baked in. `notes`, when
 * given, collects plain-language notes for the attach report's details. `onProgress`, when given,
 * is told how many objects are done (of how many) every 64 objects and once at the end, for the
 * attach dialog's progress line (6.4).
 */
export function measureObjects(level: Level, roles: readonly ObjectRole[], pic: PictureSample, rect: PictureRect,
  grid: { pxPerSquare: number; offsetX: number; offsetY: number } | null, sizes: SpriteSizes, notes?: string[],
  onProgress?: (done: number, total: number) => void): Measured[] {
  const objs = level.objects;
  const nObj = objs.length;
  const role = (i: number): ObjectRole => roles[i] ?? OR.OPAQUE;
  const prior = objs.map((o, i) => priorReach(o, role(i), sizes));
  const out: Measured[] = prior.map((reach) => ({ reach, present: null, capped: false, own: [0, 0, 0], measured: false }));
  const [x0, y0, x1, y1] = rect.rect;
  if (!(x1 > x0 && y1 > y0 && Number.isFinite(x0 + y0 + x1 + y1))) {
    onProgress?.(nObj, nObj);
    return out;
  }
  const order = objs.map((_, i) => i).sort((a, b) => objs[a].layer - objs[b].layer || a - b);
  const rank = new Int32Array(nObj);
  order.forEach((i, r) => (rank[i] = r));

  // Neighbours, through square buckets over the picture's rectangle grown by twice the furthest any
  // measurement looks (LOOK x the largest prior), so every object that can show in the picture finds
  // every other that can reach it. Positions are only checked finite when parsed (a file can put an
  // object at 1e19), so cell ranges are clamped to that area and objects outside it aren't indexed.
  const CELL = 2 * GRID;
  const maxR = prior.map((r) => Math.max(...r));
  let look = 0;
  for (const r of maxR) if (Number.isFinite(r)) look = Math.max(look, LOOK * r);
  const margin = Math.min(MAX_MARGIN, 2 * look) + CELL;
  const gx0 = Math.floor((x0 - margin) / CELL), gx1 = Math.floor((x1 + margin) / CELL);
  const gy0 = Math.floor((y0 - margin) / CELL), gy1 = Math.floor((y1 + margin) / CELL);
  const gh = gy1 - gy0 + 1;
  const indexed = Number.isSafeInteger(gx0) && Number.isSafeInteger(gy0) && Number.isSafeInteger((gx1 - gx0 + 1) * gh);
  /** The cells within r (world units) of (x, y), clamped to the indexed area; null when it misses it. */
  const cellsOf = (x: number, y: number, r: number): [number, number, number, number] | null => {
    const ax = Math.max(gx0, Math.floor((x - r) / CELL)), bx = Math.min(gx1, Math.floor((x + r) / CELL));
    const ay = Math.max(gy0, Math.floor((y - r) / CELL)), by = Math.min(gy1, Math.floor((y + r) / CELL));
    return indexed && ax <= bx && ay <= by ? [ax, bx, ay, by] : null;
  };
  /**
   * Buckets of the objects that are `member`s, with the work (cells and entries visited) left.
   * (Bounded work: a file can hold 20,000 objects at scale 16. Past it, objects stop being bucketed
   * and looked up, and are measured without their neighbours.)
   */
  const index = (member: (j: number) => boolean, work: number): { buckets: Map<number, number[]>; work: number } => {
    const buckets = new Map<number, number[]>();
    for (let j = 0; j < nObj; j++) {
      if (!member(j) || !Number.isFinite(maxR[j])) continue;
      const o = objs[j], c = cellsOf(o.position.x, o.position.y, maxR[j]);
      if (!c) continue;
      const cells = (c[1] - c[0] + 1) * (c[3] - c[2] + 1);
      if (!(cells <= work)) continue;
      work -= cells;
      for (let gx = c[0]; gx <= c[1]; gx++) for (let gy = c[2]; gy <= c[3]; gy++) {
        const kk = (gx - gx0) * gh + (gy - gy0);
        const list = buckets.get(kk);
        if (list) list.push(j); else buckets.set(kk, [j]);
      }
    }
    return { buckets, work };
  };
  type Index = ReturnType<typeof index>;
  /** The other objects of `ix` whose priors may reach within r (world units) of object i's centre. */
  const around = (ix: Index, i: number, r: number): number[] => {
    const o = objs[i], c = cellsOf(o.position.x, o.position.y, r);
    if (!c) return [];
    const seen = new Set<number>();
    for (let gx = c[0]; gx <= c[1] && ix.work > 0; gx++) for (let gy = c[2]; gy <= c[3] && ix.work > 0; gy++) {
      const list = ix.buckets.get((gx - gx0) * gh + (gy - gy0));
      ix.work -= 1 + (list?.length ?? 0);
      if (list) for (const j of list) if (j !== i) seen.add(j);
    }
    return [...seen];
  };
  const pts = new Float64Array(CORE_PTS * 2);
  /** Whether one later object of `ix` that `want`s covers minShare of object i's core (0.7 x reach), by its prior. */
  const laterOver = (ix: Index, i: number, reach: ArrayLike<number>, want: (j: number) => boolean, minShare: number): boolean => {
    const o = objs[i];
    corePoints(o.position.x, o.position.y, reach, pts);
    let r = 0;
    for (let k = 0; k < 16; k++) r = Math.max(r, MEASURE.core * reach[k]);
    for (const j of around(ix, i, r)) {
      if (rank[j] < rank[i] || !want(j) || ix.work <= 0) continue;
      ix.work -= CORE_PTS;
      const q = objs[j];
      if (coverShare(pts, q.position.x, q.position.y, prior[j]) >= minShare) return true;
    }
    return false;
  };
  const covers = (j: number): boolean => !GRASSY.has(role(j)) && !UNTESTED.has(role(j)) && role(j) !== OR.SNOW && role(j) !== OR.ROOTS;
  const isSnow = (j: number): boolean => role(j) === OR.SNOW;

  let short = false, bareLow = false, tooSmall = false;
  /** The picture's part (2.5 items 2-7); returns early when the picture can't be measured. */
  const fromPicture = (): void => {
    const W = pic.w, H = pic.h;
    const ux = (x1 - x0) / W, uy = (y1 - y0) / H;
    if (!(W > 0 && H > 0 && ux > 0 && uy > 0 && Number.isFinite(ux + uy)) || pic.rgba.length < W * H * 4) return;
    const pps = GRID / ux;
    if (pps < MEASURE.minMeasurePxPerSquare) {
      notes?.push(`The picture has under ${MEASURE.minMeasurePxPerSquare} pixels a square, so objects keep their usual sizes and none were checked.`);
      return;
    }
    const N = W * H;
    const rgba = pic.rgba;
    const lum = new Uint8Array(N);
    for (let k = 0, o = 0; k < N; k++, o += 4) lum[k] = ((299 * rgba[o] + 587 * rgba[o + 1] + 114 * rgba[o + 2] + 500) / 1000) | 0;

    // 2. The baked grid: Dungeondraft's, and the scene's when it is another.
    let gridMask: Uint8Array | null = null;
    const cands: Array<[number, number, number, number]> = [[GRID / ux, -x0 / ux, GRID / uy, -y0 / uy]];
    if (grid && grid.pxPerSquare >= 6 && Number.isFinite(grid.offsetX + grid.offsetY)) {
      const [px, ox, , oy] = cands[0];
      const p = grid.pxPerSquare;
      const same = Math.abs(p - px) < 0.005 * px && onPeriod(grid.offsetX - ox, p) && onPeriod(grid.offsetY - oy, p);
      if (!same) cands.push([p, grid.offsetX, p, grid.offsetY]);
    }
    for (const [px, ox, py, oy] of cands) {
      if (!gridAxisBaked(lum, W, H, 0, px, ox) || !gridAxisBaked(lum, W, H, 1, py, oy)) continue;
      gridMask ??= new Uint8Array(N);
      markGrid(gridMask, W, H, 0, px, ox);
      markGrid(gridMask, W, H, 1, py, oy);
    }

    // Areas without a ground model, and the objects' priors, with one work budget.
    const spec: RasterSpec = { width: W, height: H, originX: x0, originY: y0, unitsPerPx: ux };
    const budget: WorkBudget = workBudget(spec);
    const water = rasterWater(level.water, spec);
    const excl = new Uint8Array(water);
    if (level.floorPolygons.length) fillPolygons(excl, spec, level.floorPolygons, 255, "nonzero");
    if (level.tiles) {
      const tiles = rasterTiles(level.tiles, spec);
      for (let k = 0; k < N; k++) excl[k] |= tiles[k];
    }
    for (const w of level.walls) if (!strokeRibbon(excl, spec, wallRibbon(w), 255, budget)) short = true;
    const owner = nObj < 65535 ? new Uint16Array(N) : new Int32Array(N);
    const wide = nObj < 65535 ? new Uint16Array(N) : new Int32Array(N);
    const ownerRole = objs.map((_, i) => role(i));
    for (const i of order) {
      const ro = role(i);
      if (GRASSY.has(ro) || ro === OR.SNOW) continue;
      let mean = 0;
      for (let k = 0; k < 16; k++) mean += prior[i][k] / 16;
      const o = objs[i];
      const cx = o.position.x, cy = o.position.y, rw = MEASURE.clampMax * mean;
      if (!fillEllipse(owner, spec, { cx, cy, rx: mean, ry: mean, rotation: 0 }, i + 1, budget)) short = true;
      if (!fillEllipse(wide, spec, { cx, cy, rx: rw, ry: rw, rotation: 0 }, i + 1, budget)) short = true;
    }
    if (gridMask) notes?.push("The picture has a grid drawn in; it was left out when measuring objects.");

    // Which later object covers which (49 core points against its prior), and the neighbours that
    // claim the pixels nearer them (crowns, solids, packs: not tufts, snow, effects or roots).
    const near = index(() => true, NEAR_WORK);
    const meanR = prior.map((r) => r.reduce((x, v) => x + v, 0) / 16);
    const claims = (j: number): boolean => covers(j) || role(j) === OR.OPAQUE;
    const nb: number[] = [];

    const S = new Scratch();
    const P: Pic = { rgba, W, H, pps, lum, grid: gridMask, excl, owner, wide, ownerRole };
    let P2: Pic | null = null;
    const prPx = new Float64Array(16), prHalf = new Float64Array(16), floor = new Float64Array(16);
    const toWorld = (ux + uy) / 2;
    /**
     * Charges the work budget for measuring round an object whose prior reaches R picture pixels, out
     * to k times that, at 1/scale of the resolution; false (nothing measured) once it runs out.
     */
    const charge = (R: number, k: number, scale = 1): boolean => {
      const cost = (2 * k * R + 5) ** 2 / (scale * scale);
      if (cost > budget.left) {
        short = true;
        return false;
      }
      budget.left -= cost;
      return true;
    };
    for (let i = 0; i < nObj; i++) {
      if (onProgress && (i & 63) === 0) onProgress(i, nObj);
      const o = objs[i], ro = role(i), m = out[i];
      const cx = (o.position.x - x0) / ux, cy = (o.position.y - y0) / uy;
      if (!(cx >= 0 && cy >= 0 && cx < W && cy < H)) continue;
      for (let k = 0; k < 16; k++) prPx[k] = prior[i][k] / ux;
      if (laterOver(near, i, prior[i], covers, MEASURE.coveredShare)) continue;
      // Seen outside the picture: a sector whose prior runs off it keeps the prior.
      const unseen = (k: number): boolean => {
        const ex = cx + REACH_DIRS[k * 2] * prPx[k], ey = cy + REACH_DIRS[k * 2 + 1] * prPx[k];
        return ex < 0 || ey < 0 || ex > W || ey > H;
      };
      if (ro === OR.BARE) {
        if (pps < MEASURE.minPxPerSquare) { bareLow = true; continue; }
        if (!charge(Math.max(...prPx), MEASURE.clampMax)) continue;
        const b = measureBare(P, S, i, prPx, cx, cy);
        if (!b) continue;
        m.present = b.hit >= MEASURE.bareRays;
        if (!m.present) continue;
        for (let k = 0; k < 16; k++) m.reach[k] = unseen(k) ? prior[i][k] : clampReach(b.reach[k], prPx[k]) * toWorld;
        m.measured = true;
        continue;
      }
      let tested = !UNTESTED.has(ro);
      if (tested && (GRASSY.has(ro) || ro === OR.SNOW)) {
        const ter = terrainAt(level, o.position.x, o.position.y);
        if (GRASSY.has(ro) ? ter === TR.GRASS : ter === TR.SNOW) tested = false;
      }
      if (tested && o.layer < WATER_LAYER && water[Math.floor(cy) * W + Math.floor(cx)]) tested = false;
      // The neighbours that may claim pixels (the nearest MAX_CLAIMS).
      const close: Array<[number, number]> = [];
      for (const j of around(near, i, MEASURE.clampMax * maxR[i])) {
        if (!claims(j)) continue;
        const q = objs[j], d = Math.hypot(q.position.x - o.position.x, q.position.y - o.position.y);
        if (d < MEASURE.clampMax * maxR[i] + meanR[j] && d > 0.35 * meanR[i]) close.push([d, j]);
      }
      close.sort((a, b) => a[0] - b[0]);
      nb.length = 0;
      for (const [, j] of close.slice(0, MAX_CLAIMS)) nb.push((objs[j].position.x - x0) / ux, (objs[j].position.y - y0) / uy, meanR[j] / ux);
      // (A pack item is measured whenever something is found round its centre: never dropped, and
      // over-protecting is the safe direction.)
      const judge = (l: Local | null): l is Local =>
        !!l && l.found && (ro === OR.OPAQUE || l.share >= (SPARSE.has(ro) ? MEASURE.presentSparse : MEASURE.presentCore));
      // A big object is measured at half the resolution: its edges don't need every pixel. Past the
      // work budget, nothing more is measured or tested (skipped).
      let skipped = false, wholeCore = false;
      const solid = (): Local | null => {
        let R = 0;
        for (let k = 0; k < 16; k++) R = Math.max(R, prPx[k]);
        const half = R > MEASURE.halfAbove && W >= 64 && H >= 64;
        if (!charge(R, MEASURE.annulusOut, half ? 2 : 1)) {
          skipped = true;
          return null;
        }
        if (!half) return measureSolid(P, S, i, prPx, cx, cy, nb, CROWN.has(ro), wholeCore);
        P2 ??= halfPic(P);
        for (let k = 0; k < 16; k++) prHalf[k] = prPx[k] / 2;
        const l = measureSolid(P2, S, i, prHalf, cx / 2, cy / 2, nb.map((v) => v / 2), CROWN.has(ro), wholeCore);
        if (l) for (let k = 0; k < 16; k++) l.reach[k] *= 2;
        return l;
      };
      // Too small in the picture to tell (the opening erases it, its core is a few pixels): no first
      // try, so it is never taken for absent, though the second try below may still find it.
      const small = Math.max(...prPx) < MEASURE.minPriorPx;
      let L = small ? null : solid();
      // Absent only when a first try could look and found nothing (not when it was too small, or
      // had no ground round it to compare with).
      const looked = L !== null;
      let ok = judge(L);
      // A pack item that shows only something within the clamp's lower end round its centre (a snowy
      // crown's trunk, its cap the colour of the ground) is measured again with all of its core
      // taken for its own: the pieces of the crown's rim. (Not every pack item: a small one in a
      // busy place would take in its neighbours' bits.)
      if (ok && L && ro === OR.OPAQUE && L.reach.every((r, k) => !(r > MEASURE.clampMin * prPx[k]))) {
        wholeCore = true;
        const whole = solid();
        if (judge(whole)) L = whole;
      }
      // A name without a sprite size has only its role's guess, which can be far too small (a rug the
      // size of a room): the annulus then lies on the object itself. So can a prop's, whose sizes vary
      // from one instance to the next. Once more at twice the size (not trees: their sizes are known
      // well, and an erased tree's doubled core would find its neighbours).
      if (!ok && !skipped && ro !== OR.OPAQUE && (!(TREE.has(ro) || CROWN.has(ro)) || !spriteSize(sizes, defaultName(o.texture)))) {
        for (let k = 0; k < 16; k++) prPx[k] *= MEASURE.retryPrior;
        L = solid();
        ok = judge(L);
        if (!ok) for (let k = 0; k < 16; k++) prPx[k] /= MEASURE.retryPrior;
      }
      if (skipped) {
        for (let k = 0; k < 16; k++) prPx[k] = prior[i][k] / ux;
        if (!ok) continue;
      }
      if (tested) {
        m.present = ok ? true : looked ? false : null;
        if (!ok && small) tooSmall = true;
      }
      if (ok && L) {
        // A pack item reaches, in a direction where nothing of it was found past the clamp's lower
        // end (a snowy crown's rim broken there, only its trunk), as far as the furthest of the
        // nearest directions either side where something was: over-protecting is the safe
        // direction (2.5 item 7). Other objects are held at the clamp's lower end there.
        if (ro === OR.OPAQUE) {
          for (let k = 0; k < 16; k++) floor[k] = MEASURE.clampMin * prPx[k];
          fillGaps(L.reach, floor);
        }
        for (let k = 0; k < 16; k++) m.reach[k] = unseen(k) ? prior[i][k] : clampReach(L.reach[k], prPx[k]) * toWorld;
        m.measured = true;
        m.own = L.own;
        if (CROWN.has(ro)) m.capped = L.capped;
      } else if (ro === OR.OPAQUE) {
        m.reach.fill(packDisc(o));
      }
    }
  };
  fromPicture();

  // 6. Capped from the data alone, which needs no pixels: a later SNOW object over the core (of the
  // measured reach, else the prior), for every crown that isn't dropped, measured or not.
  const snowIx = index(isSnow, SNOW_WORK);
  if (snowIx.buckets.size) {
    for (let i = 0; i < nObj; i++) {
      const m = out[i];
      if (!CROWN.has(role(i)) || m.capped || m.present === false) continue;
      m.capped = laterOver(snowIx, i, m.reach, isSnow, MEASURE.snowOverCore);
    }
  }
  if (short) notes?.push("This map has too much in it to measure every object: some kept their usual sizes.");
  if (bareLow) notes?.push(`The picture has under ${MEASURE.minPxPerSquare} pixels a square, so bare trees keep their usual sizes.`);
  if (tooSmall) notes?.push("Some objects are too small in the picture to check, so they were kept.");
  onProgress?.(nObj, nObj);
  return out;
}

/** A pack item's generous disc (2.5 item 7): 1.5 squares x its larger scale, world units. */
function packDisc(o: MapObject): number {
  return MEASURE.packDiscSquares * GRID * Math.max(Math.abs(o.scale.x || 1), Math.abs(o.scale.y || 1));
}

/** Whether d is a whole number of periods, within a pixel. */
function onPeriod(d: number, period: number): boolean {
  const r = ((d % period) + period) % period;
  return r < 1 || period - r < 1;
}

/** What the measurement found, for the attach report (2.5 item 5). */
export interface MeasureSummary {
  /** Objects tested for presence, and how many of them the picture doesn't show. */
  tested: number;
  dropped: number;
  /** The same for trees (evergreen, deciduous, bare). */
  trees: number;
  treesDropped: number;
  /** Over 10% of the tested trees dropped: the fit should be lowered to "unsure". */
  lowerFit: boolean;
}

export function measureSummary(ms: readonly Measured[], roles: readonly ObjectRole[]): MeasureSummary {
  let tested = 0, dropped = 0, trees = 0, treesDropped = 0;
  ms.forEach((m, i) => {
    if (m.present === null) return;
    tested++;
    if (!m.present) dropped++;
    if (!TREE.has(roles[i])) return;
    trees++;
    if (!m.present) treesDropped++;
  });
  return { tested, dropped, trees, treesDropped, lowerFit: trees > 0 && treesDropped > MEASURE.dropTrees * trees };
}

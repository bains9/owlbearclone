// Seasons from exact Dungeondraft data (design 5.4): the sidecar is rasterised at analysis size
// (rasterSidecar) and turned into the same structures analyse() finds in a picture, so the
// existing kernels bake it. Pure; never writes into the picture's pixels, so the fallback
// analyse() sees them unchanged.
//
// The sidecar is drawn in parts, all through the one shared rasteriser:
// - the ground (G): everything but the see-through objects (bare trees, roots, tufts, flowers,
//   reeds, crops, fallen leaves, smoke, ripples), whose 16-gons would hide the snow between their
//   branches and blades, and the snow objects at the roofs' layer or above, which would hide the
//   roof under them. So G's terrain and areas are the ground as it shows round and under those,
//   and its objects (crowns, props, structures, pack items) hide what they cover;
// - those objects (S), over nothing but under the objects drawn over them: their coverage as it shows;
// - the floor plan (M): floors and caves as laid, with the water bodies beneath them, whatever lies
//   on them (a pool in a cave is indoors; a bridge or a rock over water makes no shore).
// The whole sidecar is planned first (rasterPlan): one the rasteriser couldn't draw in full (a
// crafted, broken or enormous one) is refused, and the caller guesses from the picture.
//
// From those: the masks (outdoor, indoor, keep, shore), then SnowInfo as the kernels read it
// (5.4's table): its channels from the exact masks, the ground's snow cut by the pixel's own colour
// where the snow is partial, and taken where the picture shows it through a footprint or a kept
// path's ribbon (a 16-gon round a pine holds the snow between its branches); its trees from the
// objects (centres and reaches from the data, colours from the pixels); its colours from the
// pixels over the exact masks (snowColours, with the snow's tone from whole-number sums over boxes
// rather than float blurs); and
// SnowInfo.exact: keep, roof snow and earth path, the melt partner at the snow's edges (where the
// picture shows it: Dungeondraft draws a texel of mostly snow over rock as snow), each tree's own
// colour, each terrain role's colour where pure, the shore, and the roofs' colours.
//
// (Every pass over the pixels is a small function of its own: V8 optimises those once and keeps
// them, where one long function's loops are each compiled on the stack and thrown away again.)

import { rasterPlan, rasterSidecar, type SidecarLayers } from "../dd/raster";
import { AR, OR, TR, objectRole, type AreaRole, type ObjectRole, type TerrainRole } from "../dd/roles";
import {
  DD_LAYER, NO_NAME, OBJ_FLAG, REACH_N, SIDECAR_UNITS, type ObjectTable, type SeasonSidecar, type SidecarMeta,
} from "../dd/sidecar";
import {
  D1, K_BARE, K_BROAD, K_CAP, K_DEAD, K_EVER, K_PROP, NSN, SN_CROWN, SN_EARTH, SN_EVER, SN_GROUND, SN_ICE, SN_LAWN, SN_OBJ,
  SN_PROP, SN_TONE, SN_WATER, TREE_DIRS, TREE_N, colourTable, dilate, distTo, label4, lutIndex,
  pixelSnowInfo, ramp, snowColours, type ExactSnow, type SeasonAnalysis, type SnowInfo,
} from "./seasonPixels";

/** Goes up with every role table or kernel change for exact scenes; part of their bake keys. */
export const EXACT_VERSION = 1;

/** Snowy when snow is at least this share of the visible open soft ground (4.2). */
export const SNOWY_SHARE = 0.5;

/** Whether an attached map is snowy: the GM's "drawn in", else META.snowShare (4.2). */
export function isSnowy(meta: SidecarMeta, drawn?: "winter" | "green"): boolean {
  return drawn ? drawn === "winter" : meta.snowShare >= SNOWY_SHARE;
}

/** The derived masks at analysis size (aw x ah), 0..255 a pixel. */
export interface ExactLayers {
  aw: number;
  ah: number;
  /**
   * The raster as the analysis reads it: terrain and areas as they show round and under the
   * see-through objects (bare trees, roots, tufts, flowers, reeds, crops, fallen leaves, smoke,
   * ripples) and under snow at the roofs' layer or above; objects per role (those over nothing,
   * as they show under the objects drawn over them); top indexes the sidecar's objects (a
   * see-through one where nothing else is on top).
   */
  layers: SidecarLayers;
  /** Visible terrain + PATH_* + PAVED + WATER + ICE (and what stands on them), not on FLOOR or CAVE or under ROOF or WALL. */
  outdoor: Uint8Array;
  /** FLOOR + CAVE, as laid (whatever lies on them). */
  indoor: Uint8Array;
  /**
   * Left as drawn: KEEP (terrain and areas), PATH_KEEP, CAVE_RIM, WALL, pack roofs, floors, caves
   * and roofs (not the snow on them), and objects of the roles OPAQUE, STRUCTURE, EFFECT,
   * WATER_FX, LITTER, MUSHROOM, ICE and FIRE (as they show). With packs "guess", OPAQUE
   * footprints are left out (the pixel analysis treats what it finds there). The data's own:
   * analyseExact's (ExactSnow.x) also leaves out the snow-coloured pixels of the see-through ones
   * (EFFECT, WATER_FX, LITTER), where the snow shows between their leaves or wisps, and of kept
   * paths' ribbons and caves' rims where they show the ground's snow (beside a cliff's rocks; see
   * groundGaps).
   */
  keep: Uint8Array;
  /** Inside outdoor water, the distance to its edge in 1/16 of a Dungeondraft square (map edges aren't shores). */
  shore: Uint8Array;
  /**
   * The snow's share of the open soft ground (4.2), measured at this size by META.snowShare's rule
   * (the extractor's): SNOW terrain and ground snow objects over those and ICE, GRASS, EARTH and
   * SAND terrain, visible outdoors, the ground under trees and props included.
   */
  snowShare: number;
}

/** Objects whose 16-gon isn't solid: the ground shows between their branches, blades or wisps. */
const SEE_THROUGH: ReadonlySet<ObjectRole> = new Set<ObjectRole>([
  OR.BARE, OR.ROOTS, OR.GRASS, OR.FLOWERS, OR.REEDS, OR.CROP, OR.LITTER, OR.EFFECT, OR.WATER_FX,
]);
/** Objects left as drawn (4.4): those drawn with the ground (G), and see-through ones (S). */
const KEEP_G: readonly ObjectRole[] = [OR.STRUCTURE, OR.MUSHROOM, OR.ICE, OR.FIRE];
const KEEP_S: readonly ObjectRole[] = [OR.LITTER, OR.EFFECT, OR.WATER_FX];
/** Objects that join the grass patches (SN_LAWN). */
const LAWN_OBJECTS: readonly ObjectRole[] = [OR.GRASS, OR.FLOWERS, OR.CROP, OR.REEDS];
/** Areas that are outdoor ground. */
const OUT_AREAS: readonly AreaRole[] = [AR.PATH_EARTH, AR.PATH_PAVED, AR.PATH_KEEP, AR.PAVED, AR.WATER, AR.ICE];
/** Areas left as drawn (and roofs, but the snow on them). */
const KEEP_AREAS: readonly AreaRole[] = [AR.KEEP, AR.PATH_KEEP, AR.CAVE_RIM, AR.WALL, AR.FLOOR, AR.CAVE];
/** S's role for the objects drawn there only to hide what lies under them (no ObjectRole is 0). */
const HIDES = 0 as ObjectRole;
/** Below every layer a sidecar can hold (i16): the water bodies in the floor plan. */
const UNDER_ALL = -32_000;

/** seasonPixels' (the same bytes where its sums are scaled alike). */
const INV255 = 1 / 255;
/** Below this in its brightest channel a pixel is ink or deep shadow (seasonPixels' DARK). */
const INK_MAX = 90;
/** Weights (0..255) at or over PURE are whole (0.9); under it, partial (snow where the pixel is snow-coloured). */
const PURE = 230;
/** Covered by an object (0..255): at or over COVERED for footprints, at or over TOUCHED for "nothing on it". */
const COVERED = 128;
const TOUCHED = 26;
/** A prop's colour when its footprint shows none of its own: stone (the melt's STONE), or wood; a bare tree's bark. */
const STONE: readonly number[] = [132, 130, 126];
const WOOD: readonly number[] = [118, 86, 58];
const BARK: readonly number[] = [104, 74, 52];
/** Dungeondraft's green, for crowns when the picture has none to give (snowAnalysis's). */
const DD_GREEN: readonly number[] = [62, 98, 56];
/** A roof's colour when no roof shows any. */
const SLATE: readonly number[] = [126, 124, 130];
/** Terrain roles' colours when the picture has no pure stretch of one (snow, grass and earth: snowColours'). */
const ROLE_DEFAULT: Readonly<Record<number, readonly number[]>> = {
  [TR.SAND]: [196, 176, 132],
  [TR.ROCK]: STONE,
  [TR.PAVED]: [136, 132, 126],
  [TR.ICE]: [204, 226, 238],
};
/** How near (squares) a melt partner must show in the picture for partial snow to melt to it. */
const PARTNER_NEAR = 0.4;
/** Terrain role numbers 0..8 (roles.ts TR), for ExactSnow.roleColour. */
const TR_N = 9;

// ---------------------------------------------------------------- passes over the pixels

/** dst += src, at most 255. */
function addClamped(dst: Uint8Array, src: Uint8Array): void {
  for (let k = 0; k < dst.length; k++) {
    const v = dst[k] + src[k];
    dst[k] = v > 255 ? 255 : v;
  }
}

/** dst += src (16 bits). */
function add16(dst: Uint16Array, src: Uint8Array): void {
  for (let k = 0; k < dst.length; k++) dst[k] += src[k];
}

/** The planes' sum, 16 bits (an undefined plane is a role that isn't drawn). */
function sum16(planes: ReadonlyArray<Uint8Array | undefined>, N: number): Uint16Array {
  const out = new Uint16Array(N);
  for (const p of planes) if (p) add16(out, p);
  return out;
}

/** m = 1 where w >= t (and not indoors, when given), else 0. */
function atLeast(m: Uint8Array, w: Uint16Array | Uint8Array, t: number, indoor: Uint8Array | null): void {
  for (let k = 0; k < m.length; k++) m[k] = w[k] >= t && (!indoor || indoor[k] < COVERED) ? 1 : 0;
}

/** m = 1 where the footprint's kind is a or b. */
function kindMask(m: Uint8Array, fk: Uint8Array, a: number, b: number): void {
  for (let k = 0; k < m.length; k++) m[k] = fk[k] === a || fk[k] === b ? 1 : 0;
}

/**
 * Writes mask m (any non-zero set) into channel ch of s, blurred a pixel (snowAnalysis's put with
 * r = 1: blur8 of 0 and 255 over 3 x 3, edges repeated, the same bytes). hs is scratch; a channel
 * of an empty mask is left as it is (zero).
 */
function putChannel(s: Uint8Array, ch: number, m: Uint8Array, w: number, h: number, hs: Uint8Array): void {
  // (Rows with nothing set within a row of them stay zero.)
  const rowAny = new Uint8Array(h);
  let any = false;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let ra = 0;
    for (let x = 0; x < w; x++) if (m[o + x]) {
      ra = 1;
      break;
    }
    if (!ra) {
      hs.fill(0, o, o + w);
      continue;
    }
    rowAny[y] = 1;
    any = true;
    for (let x = 0; x < w; x++) {
      hs[o + x] = (m[o + (x > 0 ? x - 1 : 0)] ? 1 : 0) + (m[o + x] ? 1 : 0) + (m[o + (x < w - 1 ? x + 1 : x)] ? 1 : 0);
    }
  }
  if (!any) return;
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y2 = y < h - 1 ? y + 1 : y;
    if (!rowAny[y0] && !rowAny[y] && !rowAny[y2]) continue;
    const o0 = y0 * w;
    const o1 = y * w;
    const o2 = y2 * w;
    for (let x = 0, q = o1 * NSN + ch; x < w; x++, q += NSN) {
      const c = hs[o0 + x] + hs[o1 + x] + hs[o2 + x];
      if (c) s[q] = ((c * 255 + 4) / 9) | 0;
    }
  }
}

/**
 * dilate(m, r) for r = 1 or 2 (seasonPixels' chamfer distances, 5 straight and 7 diagonally: within
 * 5, the four neighbours; within 10, those, the diagonals and two straight steps). tmp is scratch.
 */
function grow(m: Uint8Array, r: 1 | 2, w: number, h: number): void {
  // h1: set within one across; h2: within two across.
  const N = m.length;
  const h1 = new Uint8Array(N);
  const h2 = new Uint8Array(N);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const k = o + x;
      const a = m[k] || (x > 0 && m[k - 1]) || (x < w - 1 && m[k + 1]) ? 1 : 0;
      h1[k] = a;
      h2[k] = a || (x > 1 && m[k - 2]) || (x < w - 2 && m[k + 2]) ? 1 : 0;
    }
  }
  // r 1: the row within one, and straight up and down. r 2: the row within two, the rows above
  // and below within one, and two straight up and down.
  const row = r === 2 ? h2 : h1;
  const side = r === 2 ? h1 : m;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const k = o + x;
      let v = row[k] || (y > 0 && side[k - w]) || (y < h - 1 && side[k + w]);
      if (!v && r === 2) v = (y > 1 && m[k - 2 * w]) || (y < h - 2 && m[k + 2 * w]);
      h2[k] = v ? 1 : 0;
    }
  }
  m.set(h2);
}

/** erode(m, 1): keeps the pixels whose four neighbours (those in the picture) are all set. */
function shrink(m: Uint8Array, w: number, h: number): void {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      const k = o + x;
      out[k] = m[k] && (x === 0 || m[k - 1]) && (x === w - 1 || m[k + 1]) && (y === 0 || m[k - w]) && (y === h - 1 || m[k + w]) ? 1 : 0;
    }
  }
  m.set(out);
}

/** Snow objects at the roofs' layer or above, split into roof snow and snow over the ground (with the ground's own). */
function snowParts(hi: Uint8Array, roofA: Uint8Array, tSnow: Uint8Array, lowSnow: Uint8Array, roofSnow: Uint8Array, snow: Uint8Array): void {
  for (let k = 0; k < snow.length; k++) {
    const rs = Math.round((hi[k] * roofA[k]) / 255);
    roofSnow[k] = rs;
    let gs = tSnow[k] + lowSnow[k];
    if (gs > 255) gs = 255;
    snow[k] = Math.round(gs + ((hi[k] - rs) * (255 - gs)) / 255);
  }
}

/** Outdoors: the ground and what stands on it, off the floor plan. */
function outdoorOf(ground: Uint16Array, solid: Uint8Array, lowSnow: Uint8Array, indoor: Uint8Array): Uint8Array {
  const out = new Uint8Array(ground.length);
  for (let k = 0; k < out.length; k++) {
    let v = ground[k] + solid[k] + lowSnow[k];
    if (v > 255) v = 255;
    out[k] = Math.round((v * (255 - indoor[k])) / 255);
  }
  return out;
}

/** As drawn: what's listed, and roofs where no snow lies on them. */
function keepOf(listed: Uint16Array, roofA: Uint8Array, roofSnow: Uint8Array): Uint8Array {
  const out = new Uint8Array(listed.length);
  for (let k = 0; k < out.length; k++) {
    const v = listed[k] + Math.round((roofA[k] * (255 - roofSnow[k])) / 255);
    out[k] = v > 255 ? 255 : v;
  }
  return out;
}

/** a where b (the floor plan) is under half, else 0. */
function offPlan(a: Uint8Array, plan: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let k = 0; k < out.length; k++) out[k] = plan[k] >= COVERED ? 0 : a[k];
  return out;
}

/** dst = the max (or min) of each pixel and its neighbours along the row (edges repeated). */
function rowMaxMin(src: Uint8Array, dst: Uint8Array, w: number, h: number, max: boolean): void {
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const e = o + w - 1;
    if (w === 1) {
      dst[o] = src[o];
      continue;
    }
    let p = src[o];
    let q = src[o + 1];
    if (max) {
      dst[o] = p > q ? p : q;
      for (let k = o + 1; k < e; k++) {
        const r = src[k + 1];
        const m = p > q ? p : q;
        dst[k] = m > r ? m : r;
        p = q;
        q = r;
      }
      dst[e] = p > q ? p : q;
    } else {
      dst[o] = p < q ? p : q;
      for (let k = o + 1; k < e; k++) {
        const r = src[k + 1];
        const m = p < q ? p : q;
        dst[k] = m < r ? m : r;
        p = q;
        q = r;
      }
      dst[e] = p < q ? p : q;
    }
  }
}

/** dst = the max (or min) of each pixel and its neighbours down the column (edges repeated). */
function colMaxMin(src: Uint8Array, dst: Uint8Array, w: number, h: number, max: boolean): void {
  for (let y = 0; y < h; y++) {
    const o0 = (y > 0 ? y - 1 : 0) * w;
    const o1 = y * w;
    const o2 = (y < h - 1 ? y + 1 : y) * w;
    if (max) {
      for (let x = 0; x < w; x++) {
        const p = src[o0 + x];
        const q = src[o1 + x];
        const r = src[o2 + x];
        const m = p > q ? p : q;
        dst[o1 + x] = m > r ? m : r;
      }
    } else {
      for (let x = 0; x < w; x++) {
        const p = src[o0 + x];
        const q = src[o1 + x];
        const r = src[o2 + x];
        const m = p < q ? p : q;
        dst[o1 + x] = m < r ? m : r;
      }
    }
  }
}

/** The 3 x 3 closing of a byte image (max, then min; edges repeated): thin dark lines filled in. */
function close3(src: Uint8Array, w: number, h: number): Uint8Array {
  const a = new Uint8Array(src.length);
  const b = new Uint8Array(src.length);
  rowMaxMin(src, a, w, h, true);
  colMaxMin(a, b, w, h, true);
  rowMaxMin(b, a, w, h, false);
  colMaxMin(a, b, w, h, false);
  return b;
}

/**
 * Summed areas of v (zero where the pixel isn't open) and of open (0 or 1) over the picture grown
 * by p on every side with its edge pixels repeated, as blurF repeats them: I[(Y + 1) PW + X + 1]
 * is the sum over [0, X] x [0, Y] of the grown picture (PW = w + 2p + 1 wide). So a box of radius
 * r <= p round a pixel sums what blurF's box would, whole numbers and exact (32-bit while they
 * fit, as at any analysis size the app uses).
 */
function grownSums(v: Uint8Array, open: Uint8Array, w: number, h: number, p: number): { IS: Int32Array | Float64Array; IC: Int32Array | Float64Array; PW: number } {
  const pw = w + 2 * p;
  const ph = h + 2 * p;
  const PW = pw + 1;
  const n = PW * (ph + 1);
  const small = 255 * pw * ph < 2 ** 31;
  const IS = small ? new Int32Array(n) : new Float64Array(n);
  const IC = small ? new Int32Array(n) : new Float64Array(n);
  for (let Y = 0; Y < ph; Y++) {
    const y = Y < p ? 0 : Y - p >= h ? h - 1 : Y - p;
    const o = y * w;
    const r0 = Y * PW + 1;
    const r1 = r0 + PW;
    let s = 0;
    let c = 0;
    let X = 0;
    // The left edge repeated, the row, the right edge repeated.
    for (; X < p; X++) {
      s += v[o];
      c += open[o];
      IS[r1 + X] = IS[r0 + X] + s;
      IC[r1 + X] = IC[r0 + X] + c;
    }
    for (let k = o; X < p + w; X++, k++) {
      s += v[k];
      c += open[k];
      IS[r1 + X] = IS[r0 + X] + s;
      IC[r1 + X] = IC[r0 + X] + c;
    }
    const e = o + w - 1;
    for (; X < pw; X++) {
      s += v[e];
      c += open[e];
      IS[r1 + X] = IS[r0 + X] + s;
      IC[r1 + X] = IC[r0 + X] + c;
    }
  }
  return { IS, IC, PW };
}

/**
 * SN_TONE: the open snow's own tone, as snowColours works it out (its luma with thin dark lines
 * closed over, averaged over the open snow within 2 pixels; where little of that is open snow,
 * blended toward the mean over a square round, else mL; boxes' edges repeated as blurF repeats
 * them), with whole-number sums over boxes in place of float blurs: the same means in a fraction
 * of the time. The bytes are snowColours' own but where a mean lies on a half, which the float
 * blurs' rounding tips either way (by one level, on a few pixels in a hundred).
 */
export function openTone(lum: Uint8Array, open: Uint8Array, w: number, h: number, cA: number, mL: number): Uint8Array {
  const N = w * h;
  const m = close3(lum, w, h);
  for (let k = 0; k < N; k++) if (!open[k]) m[k] = 0;
  const rw = Math.max(2, Math.round(cA));
  const { IS, IC, PW } = grownSums(m, open, w, h, rw);
  const few = 0.02 * (2 * rw + 1) * (2 * rw + 1);
  const tone = new Uint8Array(N);
  // Pixel (x, y) is (x + rw, y + rw) of the grown picture; the near box's corners from there.
  const a2 = -2 * PW - 2;
  const b2 = -2 * PW + 3;
  const c2 = 3 * PW - 2;
  const d2 = 3 * PW + 3;
  const aw = -rw * PW - rw;
  const bw = -rw * PW + rw + 1;
  const cw = (rw + 1) * PW - rw;
  const dw = (rw + 1) * PW + rw + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w, g = (y + rw) * PW + rw; x < w; x++, k++, g++) {
      const c = IC[g + d2] - IC[g + b2] - IC[g + c2] + IC[g + a2];
      const near = c > 0 ? Math.round((IS[g + d2] - IS[g + b2] - IS[g + c2] + IS[g + a2]) / c) : 0;
      const f = c / 25;
      // (Mostly open snow near: its own mean only.)
      if (f >= 0.2) {
        tone[k] = near;
        continue;
      }
      const kk = Math.round(255 * ramp(f, 0.04, 0.2)) * INV255;
      const cn = IC[g + dw] - IC[g + bw] - IC[g + cw] + IC[g + aw];
      const wide = cn > few ? (IS[g + dw] - IS[g + bw] - IS[g + cw] + IS[g + aw]) / cn : mL;
      tone[k] = Math.round(near * kk + wide * (1 - kk));
    }
  }
  return tone;
}

/**
 * The smallest window [x, y, w, h] holding every set pixel of m (or label, for an Int32Array),
 * grown by pad and cut at the picture's edges; null when none is set. Distances and dilations
 * worked out inside it are the whole picture's: the chamfer distance between two pixels is reached
 * within the rectangle they span, and beyond the window lies only what's clear (which a pad of 1
 * reaches first) or what's farther than the pad.
 */
function windowOf(m: Uint8Array | Int32Array, w: number, h: number, pad: number): [number, number, number, number] | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let a = -1;
    for (let x = 0; x < w; x++) if (m[o + x]) {
      a = x;
      break;
    }
    if (a < 0) continue;
    let b = w - 1;
    while (!m[o + b]) b--;
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
    if (y0 === h) y0 = y;
    y1 = y;
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** The window's part of a plane (w wide), or the plane written back from it. */
function cut<T extends Uint8Array | Int32Array>(p: T, w: number, [x0, y0, ww, wh]: [number, number, number, number], out: T): T {
  for (let y = 0; y < wh; y++) out.set(p.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + ww), y * ww);
  return out;
}
function paste<T extends Uint8Array | Int32Array>(p: T, w: number, [x0, y0, ww, wh]: [number, number, number, number], src: T): void {
  for (let y = 0; y < wh; y++) p.set(src.subarray(y * ww, (y + 1) * ww), (y0 + y) * w + x0);
}

/** dilate(m, r), worked out in the window round m's set pixels. d: scratch. */
function dilateNear(m: Uint8Array, r: number, w: number, h: number, d: Int32Array): void {
  const win = windowOf(m, w, h, Math.ceil(r) + 1);
  if (!win) return;
  const sub = cut(m, w, win, new Uint8Array(win[2] * win[3]));
  dilate(sub, r, win[2], win[3], d);
  paste(m, w, win, sub);
}

/** The sum of a byte plane. */
function total(p: Uint8Array): number {
  let s = 0;
  for (let k = 0; k < p.length; k++) s += p[k];
  return s;
}

/** The picture's classes per pixel (see analyseExact). */
interface PicClasses {
  /** The colour table's snow channel (0 where transparent). */
  snowC: Uint8Array;
  /** Luma, rounded as snowColours rounds it. */
  lum: Uint8Array;
  /** Brightest channel. */
  mx: Uint8Array;
  /** Vegetation, as snowAnalysis takes it. */
  veg: Uint8Array;
  /** Opaque enough to be the map. */
  seen: Uint8Array;
  /** The mean luma of what's snow-coloured, weighted by how snowy (snowColours' default; 255 for none). */
  meanLum: number;
}

function picClasses(rgba: Uint8ClampedArray, N: number): PicClasses {
  const T = colourTable();
  const snowC = new Uint8Array(N);
  const lum = new Uint8Array(N);
  const mx = new Uint8Array(N);
  const veg = new Uint8Array(N);
  const seen = new Uint8Array(N);
  let sw = 0;
  let sL = 0;
  for (let k = 0, q = 0; k < N; k++, q += 4) {
    const r = rgba[q];
    const g = rgba[q + 1];
    const b = rgba[q + 2];
    lum[k] = ((299 * r + 587 * g + 114 * b + 500) / 1000) | 0;
    mx[k] = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (rgba[q + 3] < 128) continue;
    const li = lutIndex(r, g, b);
    snowC[k] = T[li + 3];
    veg[k] = T[li] * T[li + 2] >= 80 * 255 ? 1 : 0;
    seen[k] = 1;
    if (!snowC[k]) continue;
    const c = snowC[k] / 255;
    sw += c;
    sL += c * lum[k];
  }
  return { snowC, lum, mx, veg, seen, meanLum: sw > 0 ? sL / sw : 255 };
}

/**
 * Each pixel's footprint owner (sidecar index + 1; 0 none): the top crown or prop in G, else a
 * see-through one (a bare tree, roots) where nothing solid covers it. kind: per sidecar object.
 */
function owners(gTop: Uint16Array, sTop: Uint16Array | null, gIdx: Int32Array, sIdx: Int32Array, sRole: Uint8Array, kind: Uint8Array,
  solid: Uint8Array): Int32Array {
  const out = new Int32Array(gTop.length);
  for (let k = 0; k < out.length; k++) {
    const g = gTop[k];
    if (g) {
      const i = gIdx[g - 1];
      if (kind[i]) out[k] = i + 1;
    } else if (sTop && sTop[k] && solid[k] < COVERED) {
      const i = sIdx[sTop[k] - 1];
      if (kind[i] && sRole[i]) out[k] = i + 1;
    }
  }
  return out;
}

/** Pixels per object index. */
function counts(owner: Int32Array, n: number): Int32Array {
  const out = new Int32Array(n);
  for (let k = 0; k < owner.length; k++) if (owner[k]) out[owner[k] - 1]++;
  return out;
}

/** From footprint owners (objects) to trees (1-based, 0 none) and each pixel's tree kind. */
function treePixels(own1: Int32Array, treeOf: Int32Array, kind: Uint8Array, tOwn: Int32Array, fk: Uint8Array): void {
  for (let k = 0; k < own1.length; k++) {
    const o = own1[k];
    if (!o) continue;
    const t = treeOf[o - 1];
    tOwn[k] = t;
    if (t) fk[k] = kind[o - 1];
  }
}

/**
 * Per tree (6 floats from t*6): its vegetation's colour sums and count (some colour, as snowAnalysis
 * takes a crown's own green), its snow's luma sum and count; and ownOwner, its pixels that are
 * neither snow nor ink (for its own colour).
 */
function treeSums(rgba: Uint8ClampedArray, tOwn: Int32Array, pc: PicClasses, acc: Float64Array, ownOwner: Int32Array): void {
  const { snowC, lum, mx, veg, seen } = pc;
  for (let k = 0, q = 0; k < tOwn.length; k++, q += 4) {
    const t = tOwn[k];
    if (!t || !seen[k]) continue;
    const r = rgba[q];
    const g = rgba[q + 1];
    const b = rgba[q + 2];
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    const a = t * 6;
    if (veg[k] && mx[k] - mn >= 0.22 * mx[k]) {
      acc[a] += r;
      acc[a + 1] += g;
      acc[a + 2] += b;
      acc[a + 3]++;
    }
    if (snowC[k] >= 128) {
      acc[a + 4] += lum[k];
      acc[a + 5]++;
    } else if (mx[k] >= INK_MAX) ownOwner[k] = t;
  }
}

/**
 * The open snow (m), and where it's snow-coloured (open): whole where the ground's snow is (nearly)
 * whole, none where there's none, and between, where the pixel itself is snow-coloured (a drawn edge
 * melts as drawn, the flecks Dungeondraft draws where there's only a trace of snow too); and where packSnow is set (the picture's open snow in a guessed pack
 * item's footprint) or gap (the ground's snow showing in a footprint or a kept path's ribbon, which
 * hides the terrain from the data). Not on crowns or props (fk, but bare trees and gaps), ice, water
 * or core, nor on what's left as drawn (keep: snow objects high up on a pack roof or over a floor
 * are no ground).
 */
function openSnow(m: Uint8Array, open: Uint8Array, snow: Uint8Array, packSnow: Uint8Array, snowC: Uint8Array, fk: Uint8Array,
  gap: Uint8Array, iceM: Uint8Array, watM: Uint8Array, core: Uint8Array, keep: Uint8Array): void {
  for (let k = 0; k < m.length; k++) {
    const v = snow[k];
    const kd = fk[k];
    const on = (v >= PURE || (v > 0 && snowC[k] >= 128) || packSnow[k] !== 0 || gap[k] !== 0) && (!kd || kd === K_BARE || kd === K_DEAD || gap[k] !== 0) &&
      !iceM[k] && !watM[k] && !core[k] && keep[k] < COVERED;
    m[k] = on ? 1 : 0;
    open[k] = on && snowC[k] >= 128 ? 1 : 0;
  }
}

/**
 * Pixels of evergreens', green crowns' and props' footprints (fk), and of kept paths' ribbons and
 * caves' rims (pathKeep, where nothing else kept lies), that show the ground's snow: the snow-coloured ones
 * joined (4-connected, by snow-coloured pixels) to snow-coloured pixels outside every crown and prop
 * and not left as drawn. A footprint is a 16-gon round the object and a path's ribbon its full
 * width, so they hold the snow between a pine's branches, round a log or beside a cliff's rocks; a
 * pale highlight ringed by the object's own colours or outline stays the object's. (Caps are their
 * crowns' own snow.)
 */
function groundGaps(fk: Uint8Array, pc: PicClasses, keep: Uint8Array, pathKeep: Uint8Array | Uint16Array, w: number, h: number): Uint8Array {
  const N = w * h;
  const sm = new Uint8Array(N);
  const onPath = (k: number): boolean => pathKeep[k] >= COVERED && keep[k] - pathKeep[k] < COVERED;
  let any = false;
  for (let k = 0; k < N; k++) {
    if (pc.snowC[k] < 128) continue;
    sm[k] = 1;
    const kd = fk[k];
    if (kd === K_EVER || kd === K_BROAD || kd === K_PROP || (!kd && pathKeep[k] && onPath(k))) any = true;
  }
  const gap = new Uint8Array(N);
  if (!any) return gap;
  const lab = new Int32Array(N);
  const n = label4(sm, w, h, lab, new Int32Array(N));
  const out = new Uint8Array(n + 1);
  for (let k = 0; k < N; k++) {
    const kd = fk[k];
    if (lab[k] && (!kd || kd === K_BARE || kd === K_DEAD) && keep[k] < COVERED) out[lab[k]] = 1;
  }
  for (let k = 0; k < N; k++) {
    const kd = fk[k];
    if (out[lab[k]] && lab[k] && (kd === K_EVER || kd === K_BROAD || kd === K_PROP || (!kd && onPath(k)))) gap[k] = 1;
  }
  return gap;
}

/**
 * A kept path's ribbon or a cave's rim where it shows the ground's snow (gap) is no longer kept, and with it the
 * seams left between that snow and the ground outside (kept pixels a line thin, next to it).
 */
function freeRibbon(keep: Uint8Array, gap: Uint8Array, fk: Uint8Array, pathKeep: Uint8Array | Uint16Array, w: number, h: number): void {
  const N = w * h;
  const freed = new Uint8Array(N);
  let any = false;
  for (let k = 0; k < N; k++) {
    if (!gap[k] || fk[k]) continue;
    keep[k] = 0;
    freed[k] = 1;
    any = true;
  }
  if (!any) return;
  const kept = new Uint8Array(N);
  for (let k = 0; k < N; k++) kept[k] = pathKeep[k] && keep[k] >= COVERED ? 1 : 0;
  const thick = new Uint8Array(kept);
  shrink(thick, w, h);
  grow(thick, 1, w, h);
  grow(freed, 1, w, h);
  for (let k = 0; k < N; k++) if (kept[k] && !thick[k] && freed[k]) keep[k] = 0;
}

/** m = 0 where g is set. */
function clearWhere(m: Uint8Array, g: Uint8Array): void {
  for (let k = 0; k < m.length; k++) if (g[k]) m[k] = 0;
}

/**
 * With packs "guess", the open snow the picture's analysis (px) finds in the pack items' footprints
 * (opaque), outside its crowns and props: there the data knows only the pack item, which G draws
 * solid, so the snow round a guessed tree and its footprint's edge would be no one's.
 */
function packGround(px: SnowInfo, opaque: Uint8Array, snowC: Uint8Array, out: Uint8Array): void {
  const s = px.s;
  for (let k = 0, q = 0; k < out.length; k++, q += NSN) {
    out[k] = opaque[k] && snowC[k] >= 128 && s[q + SN_GROUND] >= 128 && s[q + SN_CROWN] < 128 && s[q + SN_EVER] < 128 &&
      s[q + SN_PROP] < 128 ? 1 : 0;
  }
}

/** The data's keep (all), but where the pixel is snow-coloured, solid's (the see-through objects left out). */
function keepByColour(all: Uint8Array, solid: Uint8Array, snowC: Uint8Array): Uint8Array {
  if (all === solid) return all;
  const out = new Uint8Array(all.length);
  for (let k = 0; k < out.length; k++) out[k] = snowC[k] >= 128 ? solid[k] : all[k];
  return out;
}

/** snowColours' grass (grass terrain that is vegetation) and earth (earth that isn't snow) masks. */
function groundPixels(grassT: Uint8Array, earthM: Uint8Array, pc: PicClasses, grass: Uint8Array, earth: Uint8Array): void {
  for (let k = 0; k < grass.length; k++) {
    grass[k] = grassT[k] >= COVERED && pc.veg[k] ? 1 : 0;
    earth[k] = earthM[k] && pc.seen[k] && pc.snowC[k] < 128 ? 1 : 0;
  }
}

/** Channel ch of s: 255 where m is set, else 0. */
function setMask(s: Uint8Array, ch: number, m: Uint8Array): void {
  for (let k = 0, q = ch; k < m.length; k++, q += NSN) s[q] = m[k] ? 255 : 0;
}

/** Channel ch of s from a plane. */
function setChannel(s: Uint8Array, ch: number, p: Uint8Array): void {
  for (let k = 0, q = ch; k < p.length; k++, q += NSN) s[q] = p[k];
}

/** Crowns' and props' labels (tOwn where the kind isn't leafless). */
function crownLabels(tOwn: Int32Array, fk: Uint8Array): Int32Array {
  const out = new Int32Array(tOwn.length);
  for (let k = 0; k < out.length; k++) if (tOwn[k] && fk[k] !== K_BARE && fk[k] !== K_DEAD) out[k] = tOwn[k];
  return out;
}


/**
 * seasonPixels' distLabel (chamfer distances, 5 straight and 7 diagonally, and the nearest label),
 * the same steps in the same order, written out (the inner steps inlined, and labelled pixels set
 * once): the same distances and labels in less time.
 */
function labelDistances(lab: Int32Array, w: number, h: number, d: Int32Array, near: Int32Array): void {
  const FAR = 1 << 28;
  for (let k = 0; k < lab.length; k++) {
    near[k] = lab[k];
    d[k] = lab[k] ? 0 : FAR;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0, k = y * w; x < w; x++, k++) {
      let v = d[k];
      if (v === 0) continue;
      let l = near[k];
      if (x > 0 && d[k - 1] + 5 < v) {
        v = d[k - 1] + 5;
        l = near[k - 1];
      }
      if (y > 0) {
        if (d[k - w] + 5 < v) {
          v = d[k - w] + 5;
          l = near[k - w];
        }
        if (x > 0 && d[k - w - 1] + 7 < v) {
          v = d[k - w - 1] + 7;
          l = near[k - w - 1];
        }
        if (x < w - 1 && d[k - w + 1] + 7 < v) {
          v = d[k - w + 1] + 7;
          l = near[k - w + 1];
        }
      }
      d[k] = v;
      near[k] = l;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1, k = y * w + w - 1; x >= 0; x--, k--) {
      let v = d[k];
      if (v === 0) continue;
      let l = near[k];
      if (x < w - 1 && d[k + 1] + 5 < v) {
        v = d[k + 1] + 5;
        l = near[k + 1];
      }
      if (y < h - 1) {
        if (d[k + w] + 5 < v) {
          v = d[k + w] + 5;
          l = near[k + w];
        }
        if (x < w - 1 && d[k + w + 1] + 7 < v) {
          v = d[k + w + 1] + 7;
          l = near[k + w + 1];
        }
        if (x > 0 && d[k + w - 1] + 7 < v) {
          v = d[k + w - 1] + 7;
          l = near[k + w - 1];
        }
      }
      d[k] = v;
      near[k] = l;
    }
  }
}

/** tl = near where it's within lim. */
function within(tl: Uint16Array, near: Int32Array, d: Int32Array, lim: number): void {
  for (let k = 0; k < tl.length; k++) if (near[k] && d[k] <= lim) tl[k] = near[k];
}

/**
 * A bare tree's domain (snowAnalysis's): as far as its leaves may reach, nearest it wins, but not
 * within crownD of a crown or prop (near, d: their labels' distances).
 */
function bareDomains(trees: Float32Array, from: number, to: number, aw: number, ah: number, cA: number, tl: Uint16Array,
  near: Int32Array, d: Int32Array): void {
  const best = new Float32Array(aw * ah).fill(2);
  const crownD = 0.1 * cA * D1;
  for (let t = from; t < to; t++) {
    const b = t * TREE_N;
    if (trees[b + 3] !== K_BARE && trees[b + 3] !== K_DEAD) continue;
    const cx = trees[b];
    const cy = trees[b + 1];
    let far = 0;
    for (let k = 0; k < TREE_DIRS; k++) if (trees[b + 8 + k] > far) far = trees[b + 8 + k];
    const R = far + 0.4 * cA + 1;
    const xa = Math.max(0, Math.floor(cx - R));
    const xb = Math.min(aw - 1, Math.ceil(cx + R));
    const ya = Math.max(0, Math.floor(cy - R));
    const yb = Math.min(ah - 1, Math.ceil(cy + R));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa, k = y * aw + xa; x <= xb; x++, k++) {
        const dn = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / R;
        if (dn >= 1 || dn >= best[k]) continue;
        if (near[k] && d[k] <= crownD) continue;
        best[k] = dn;
        tl[k] = t + 1;
      }
    }
  }
}

/** ExactSnow.x: keep, roof snow, earth path, 3 bytes a pixel. */
function interleave(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length * 3);
  for (let k = 0, q = 0; k < a.length; k++, q += 3) {
    out[q] = a[k];
    out[q + 1] = b[k];
    out[q + 2] = c[k];
  }
  return out;
}

/** The ground's planes by role for the partner and the pure colours (zeros where a role isn't drawn). */
interface GroundPlanes {
  snow: Uint8Array;
  ice: Uint8Array;
  iceA: Uint8Array;
  grass: Uint8Array;
  earth: Uint8Array;
  pathE: Uint8Array;
  sand: Uint8Array;
  rock: Uint8Array;
  paved: Uint8Array;
  pavedA: Uint8Array;
  pathP: Uint8Array;
  keep: Uint8Array;
  /** Terrain snow, and all the terrain (16 bits). */
  tSnow: Uint8Array;
  terr: Uint16Array;
}

function groundPlanes(G: SidecarLayers, snow: Uint8Array, zero: Uint8Array): GroundPlanes {
  const t = (r: TerrainRole): Uint8Array => G.terrain.get(r) ?? zero;
  const a = (r: AreaRole): Uint8Array => G.area.get(r) ?? zero;
  return {
    snow, ice: t(TR.ICE), iceA: a(AR.ICE), grass: t(TR.GRASS), earth: t(TR.EARTH), pathE: a(AR.PATH_EARTH), sand: t(TR.SAND),
    rock: t(TR.ROCK), paved: t(TR.PAVED), pavedA: a(AR.PAVED), pathP: a(AR.PATH_PAVED), keep: t(TR.KEEP), tSnow: t(TR.SNOW),
    terr: sum16([...G.terrain.values()], snow.length),
  };
}

/**
 * The melt partner where the snow is partial or the snow's rim reaches (ground): ROCK, EARTH (with
 * earth paths), SAND or PAVED (with paved areas and paths) when it holds at least half of the rest
 * of the ground (all but terrain snow), and the picture shows it within near pixels (a drawn edge).
 * Where the snow is partial but the picture shows none of what's under it (Dungeondraft draws a
 * texel of mostly snow as snow), the snow melts as the open snow does.
 */
function partners(gp: GroundPlanes, s: Uint8Array, pc: PicClasses, cover: Uint8Array, tOwn: Int32Array, near: number, w: number,
  h: number, d: Int32Array): Uint8Array {
  const out = partnerRoles(gp);
  // Where a partner shows: a partial pixel that isn't snow-coloured, ink, under an object or in a
  // tree's or prop's footprint (a log's rim, a bare tree's branches), in a patch more than a line
  // wide (not a grid line or an outline drawn on the snow).
  const shows = new Uint8Array(out.length);
  let any = false;
  for (let k = 0; k < out.length; k++) {
    if (!out[k] || pc.snowC[k] >= 128 || pc.mx[k] < INK_MAX || !pc.seen[k] || cover[k] >= TOUCHED || tOwn[k]) continue;
    shows[k] = 1;
    any = true;
  }
  if (any) {
    shrink(shows, w, h);
    dilateNear(shows, near + 1, w, h, d);
  }
  // (Wherever the snow is partial, and where the snow's rim reaches the partner's own ground, a
  // pixel past it too: the kernels blend the rim between pixels.)
  const snow = gp.snow;
  const rim = new Uint8Array(out.length);
  for (let k = 0, q = SN_GROUND; k < out.length; k++, q += NSN) rim[k] = s[q] || snow[k] ? 1 : 0;
  grow(rim, 1, w, h);
  for (let k = 0; k < out.length; k++) if (!shows[k] || !rim[k]) out[k] = 0;
  return out;
}

/** The partner role per pixel where the snow is partial (see partners), wherever the snow's rim reaches or not. */
function partnerRoles(gp: GroundPlanes): Uint8Array {
  const { snow, rock, earth, pathE, sand, paved, pavedA, pathP, tSnow, terr } = gp;
  const out = new Uint8Array(snow.length);
  for (let k = 0; k < out.length; k++) {
    if (snow[k] >= PURE) continue;
    const rest = terr[k] - tSnow[k] + pathE[k] + pavedA[k] + pathP[k];
    if (rest <= 0) continue;
    let best = rock[k];
    let p: number = TR.ROCK;
    const e = earth[k] + pathE[k];
    if (e > best) {
      best = e;
      p = TR.EARTH;
    }
    if (sand[k] > best) {
      best = sand[k];
      p = TR.SAND;
    }
    const pv = paved[k] + pavedA[k] + pathP[k];
    if (pv > best) {
      best = pv;
      p = TR.PAVED;
    }
    if (best > 0 && 2 * best >= rest) out[k] = p;
  }
  return out;
}

/**
 * Pixels where one terrain role is pure (owner: its TR): 0.9 or more of the ground (areas that melt
 * alike merged), nothing on it (cover under TOUCHED), not ink, outdoors, and not snow-coloured
 * (snow: snow-coloured). Every other pixel each way (a quarter of them is plenty for a median).
 */
function pureOwners(gp: GroundPlanes, cover: Uint8Array, indoor: Uint8Array, pc: PicClasses, w: number, h: number): Int32Array {
  const { snow, ice, iceA, grass, earth, pathE, sand, rock, paved, pavedA, pathP, keep } = gp;
  const out = new Int32Array(cover.length);
  for (let y = 0; y < h; y += 2) for (let k = y * w, e = k + w; k < e; k += 2) {
    if (!pc.seen[k] || cover[k] >= TOUCHED || pc.mx[k] < INK_MAX || indoor[k] >= COVERED) continue;
    if (pc.snowC[k] >= 128) {
      if (snow[k] >= PURE) out[k] = TR.SNOW;
    } else if (ice[k] + iceA[k] >= PURE) out[k] = TR.ICE;
    else if (grass[k] >= PURE) out[k] = TR.GRASS;
    else if (earth[k] + pathE[k] >= PURE) out[k] = TR.EARTH;
    else if (sand[k] >= PURE) out[k] = TR.SAND;
    else if (rock[k] >= PURE) out[k] = TR.ROCK;
    else if (paved[k] + pavedA[k] + pathP[k] >= PURE) out[k] = TR.PAVED;
    else if (keep[k] >= PURE) out[k] = TR.KEEP;
  }
  return out;
}

/** Roof pixels that show the roof itself (labelled 1..n by roof; not snow, ink or under roof snow). */
function roofOwners(lab: Int32Array, roofSnow: Uint8Array, pc: PicClasses, all: Int32Array): Int32Array {
  const out = new Int32Array(lab.length);
  for (let k = 0; k < out.length; k++) {
    if (!lab[k] || roofSnow[k] >= TOUCHED || !pc.seen[k] || pc.snowC[k] >= 128 || pc.mx[k] < INK_MAX) continue;
    out[k] = lab[k];
    all[k] = 1;
  }
  return out;
}

/**
 * Each roof-snow pixel's roof colour: its roof's median (the roof under it, else the nearest within
 * 3 pixels, first found by rows on a tie), else dflt.
 */
function roofPaint(roof: Uint8Array, roofSnow: Uint8Array, lab: Int32Array, w: number, h: number, rgb: Float64Array, count: Int32Array,
  dflt: readonly number[]): void {
  for (let k = 0, q = 0; k < roofSnow.length; k++, q += 3) {
    if (!roofSnow[k]) continue;
    let l = lab[k];
    if (!l) {
      const x = k % w;
      const y = (k - x) / w;
      let bd = 10;
      for (let j = Math.max(0, y - 3); j <= Math.min(h - 1, y + 3); j++) {
        for (let i = Math.max(0, x - 3); i <= Math.min(w - 1, x + 3); i++) {
          const dd = (i - x) * (i - x) + (j - y) * (j - y);
          if (dd < bd && lab[j * w + i]) {
            bd = dd;
            l = lab[j * w + i];
          }
        }
      }
    }
    const ok = l > 0 && count[l] >= 4;
    roof[q] = ok ? rgb[l * 3] : dflt[0];
    roof[q + 1] = ok ? rgb[l * 3 + 1] : dflt[1];
    roof[q + 2] = ok ? rgb[l * 3 + 2] : dflt[2];
  }
}

/** SN_OBJ's mask: anything besides open ground here (dilated by the caller). */
function objMask(m: Uint8Array, s: Uint8Array, tl: Uint16Array, roofSnow: Uint8Array, pathE: Uint8Array): void {
  for (let k = 0, q = 0; k < m.length; k++, q += NSN) {
    m[k] = tl[k] || s[q + SN_CROWN] || s[q + SN_EVER] || s[q + SN_PROP] || s[q + SN_LAWN] || s[q + SN_ICE] || s[q + SN_WATER] ||
      s[q + SN_EARTH] || roofSnow[k] || pathE[k] ? 1 : 0;
  }
}

/**
 * Per owner 1..n (owner[k]; 0 for none): the median of each channel of its pixels, and how many
 * there are. Medians of byte values, so the same on every device.
 */
function medians(rgba: Uint8ClampedArray, owner: Int32Array, n: number): { rgb: Float64Array; count: Int32Array } {
  const N = owner.length;
  const count = new Int32Array(n + 2);
  const rgb = new Float64Array((n + 1) * 3);
  // Few owners (terrain roles, roofs): a histogram each, in one pass. Many (trees): their pixels
  // sorted by owner first, then one histogram at a time.
  const few = n <= 64;
  const hist = new Int32Array(few ? (n + 1) * 768 : 768);
  if (few) {
    for (let k = 0, q = 0; k < N; k++, q += 4) {
      const i = owner[k];
      if (i <= 0) continue;
      count[i]++;
      const b = i * 768;
      hist[b + rgba[q]]++;
      hist[b + 256 + rgba[q + 1]]++;
      hist[b + 512 + rgba[q + 2]]++;
    }
  } else for (let k = 0; k < N; k++) if (owner[k] > 0) count[owner[k]]++;
  const start = new Int32Array(n + 2);
  let order: Int32Array | null = null;
  if (!few) {
    for (let i = 1; i <= n; i++) start[i + 1] = start[i] + count[i];
    const fill = start.slice();
    order = new Int32Array(start[n + 1]);
    for (let k = 0; k < N; k++) if (owner[k] > 0) order[fill[owner[k]]++] = k;
  }
  for (let i = 1; i <= n; i++) {
    const c = count[i];
    if (!c) continue;
    let b = i * 768;
    if (order) {
      b = 0;
      hist.fill(0);
      for (let j = start[i]; j < start[i + 1]; j++) {
        const q = order[j] * 4;
        hist[rgba[q]]++;
        hist[256 + rgba[q + 1]]++;
        hist[512 + rgba[q + 2]]++;
      }
    }
    const half = (c + 1) >> 1;
    for (let ch = 0; ch < 3; ch++) {
      let acc = 0;
      let v = 0;
      for (; v < 255; v++) {
        acc += hist[b + ch * 256 + v];
        if (acc >= half) break;
      }
      rgb[i * 3 + ch] = v;
    }
  }
  return { rgb, count };
}

// ---------------------------------------------------------------- drawing the sidecar

/** The parts of a sidecar drawn at analysis size, and the masks every caller wants (see the header). */
interface Drawn {
  aw: number;
  ah: number;
  /** Runtime role per object (as rasterSidecar derives it). */
  role: Uint8Array;
  G: SidecarLayers;
  /**
   * Null when the sidecar has no see-through objects nor high snow. Its top may be any of its
   * objects: only those with an S role (sRole, else 0) are S's.
   */
  S: SidecarLayers | null;
  sRole: Uint8Array;
  /** S's object indices into the sidecar's. */
  sIdx: Int32Array;
  /** G's object indices into the sidecar's. */
  gIdx: Int32Array;
  /** The floor plan (M): floors and caves as laid; outdoor water bodies, whatever is on them. */
  indoor: Uint8Array;
  water: Uint8Array;
  /** Snow objects at the roofs' layer or above that lie on a roof. */
  roofSnow: Uint8Array;
  /** The ground's snow: SNOW terrain and the snow objects not on roofs. */
  snow: Uint8Array;
  /** What G's objects but snow cover: crowns, props, structures, pack items. */
  solid: Uint8Array;
  outdoor: Uint8Array;
  /** ExactLayers.keep; keepSolid: the same without the see-through objects (keep where nothing see-through is kept). */
  keep: Uint8Array;
  keepSolid: Uint8Array;
  /** A plane of zeros (for roles that aren't drawn). */
  zero: Uint8Array;
}

/** Each object's runtime role, as rasterSidecar derives it: by its stored name when it has one. */
function runtimeRoles(sc: SeasonSidecar): Uint8Array {
  const o = sc.objects;
  const names = sc.meta.names;
  const byName = new Int16Array(names.length).fill(-1);
  const out = new Uint8Array(o.n);
  for (let i = 0; i < o.n; i++) {
    const nm = o.name[i];
    if (nm !== NO_NAME && nm < names.length) {
      if (byName[nm] < 0) byName[nm] = objectRole(names[nm]);
      out[i] = byName[nm];
    } else out[i] = o.role[i];
  }
  return out;
}

/** The objects `keep` (sidecar indices, in order) of a table. */
function pickObjects(t: ObjectTable, keep: Int32Array): ObjectTable {
  const n = keep.length;
  const out: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  for (let k = 0; k < n; k++) {
    const i = keep[k];
    out.role[k] = t.role[i];
    out.layer[k] = t.layer[i];
    out.x[k] = t.x[i];
    out.y[k] = t.y[i];
    out.rot[k] = t.rot[i];
    out.flags[k] = t.flags[i];
    out.name[k] = t.name[i];
    out.reach.set(t.reach.subarray(i * REACH_N, (i + 1) * REACH_N), k * REACH_N);
  }
  return out;
}

/**
 * The objects S draws, in the sidecar's order: those with an S role (sRole), and the others that may
 * hide part of one: drawn over it (a higher layer, or the same and later in the table) and within
 * reach of it (their 16-gons' circles pad apart, in world units). The others couldn't change what
 * S keeps; but a crafted sidecar that would take long to sort out gets them all.
 */
function sObjects(o: ObjectTable, sRole: Uint8Array, pad: number): Int32Array {
  const n = o.n;
  const R = new Float64Array(n);
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = 0; k < REACH_N; k++) if (o.reach[i * REACH_N + k] > m) m = o.reach[i * REACH_N + k];
    R[i] = m / SIDECAR_UNITS.reach;
    X[i] = o.x[i] / SIDECAR_UNITS.coord;
    Y[i] = o.y[i] / SIDECAR_UNITS.coord;
  }
  // S's objects by x, and their widest.
  const sl: number[] = [];
  let rS = 0;
  for (let i = 0; i < n; i++) {
    if (!sRole[i]) continue;
    sl.push(i);
    if (R[i] > rS) rS = R[i];
  }
  sl.sort((a, b) => X[a] - X[b] || a - b);
  const xs = Float64Array.from(sl, (i) => X[i]);
  const out: number[] = [];
  let work = 0;
  for (let i = 0; i < n; i++) {
    if (sRole[i]) {
      out.push(i);
      continue;
    }
    const far = R[i] + rS + pad;
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < X[i] - far) lo = mid + 1;
      else hi = mid;
    }
    for (let j = lo; j < xs.length && xs[j] <= X[i] + far; j++) {
      if (++work > 4_000_000) return Int32Array.from({ length: n }, (_, k) => k);
      const s = sl[j];
      if (o.layer[i] < o.layer[s] || (o.layer[i] === o.layer[s] && i < s)) continue;
      const dx = X[i] - X[s];
      const dy = Y[i] - Y[s];
      const rr = R[i] + R[s] + pad;
      if (dx * dx + dy * dy <= rr * rr) {
        out.push(i);
        break;
      }
    }
  }
  return Int32Array.from(out);
}

function draw(sc: SeasonSidecar, aw: number, ah: number, packs?: "guess"): Drawn {
  if (!Number.isInteger(aw) || !Number.isInteger(ah) || aw < 1 || ah < 1) throw new Error(`exact seasons: a ${aw} x ${ah} analysis is not allowed`);
  if (rasterPlan(sc).skipped > 0) throw new Error("exact seasons: this map's data is too big to draw in full");
  const N = aw * ah;
  const o = sc.objects;
  const role = runtimeRoles(sc);
  const g: number[] = [];
  // S's roles: the see-through objects' and the high snow's own, the others' none.
  const sRole = new Uint8Array(o.n);
  let nS = 0;
  for (let i = 0; i < o.n; i++) {
    const r = role[i] as ObjectRole;
    if (SEE_THROUGH.has(r) || (r === OR.SNOW && o.layer[i] >= DD_LAYER.ROOF)) {
      sRole[i] = r;
      nS++;
    } else g.push(i);
  }
  const gIdx = Int32Array.from(g);
  const spec = { w: aw, h: ah };
  const G = rasterSidecar({ ...sc, objects: pickObjects(o, gIdx) }, spec);
  let S: SidecarLayers | null = null;
  let sIdx: Int32Array = new Int32Array(0);
  if (nS) {
    // S's objects by S's roles (no names, so those are the roles drawn), with the others that may
    // hide one of them: those hide what they're drawn over, and are then let go.
    sIdx = sObjects(o, sRole, (2 * (sc.meta.rect[2] - sc.meta.rect[0])) / aw);
    const objects = pickObjects({ ...o, role: sRole, name: new Uint16Array(o.n).fill(NO_NAME) }, sIdx);
    S = rasterSidecar({ meta: sc.meta, terrain: null, bitmaps: [], shapes: [], objects }, spec);
    S.objects.delete(HIDES);
  }
  const zero = new Uint8Array(N);
  // The floor plan.
  const planBits = sc.bitmaps.filter((b) => b.role === AR.FLOOR || b.role === AR.CAVE);
  const planShapes = sc.shapes
    .filter((p) => p.role === AR.FLOOR || p.role === AR.CAVE || p.role === AR.WATER)
    .map((p) => (p.role === AR.WATER ? { ...p, layer: UNDER_ALL } : p));
  let indoor: Uint8Array = zero;
  let water: Uint8Array = zero;
  if (planBits.length || planShapes.length) {
    const M = rasterSidecar({ meta: sc.meta, terrain: null, bitmaps: planBits, shapes: planShapes, objects: pickObjects(o, new Int32Array(0)) }, spec);
    const fl = M.area.get(AR.FLOOR);
    const cv = M.area.get(AR.CAVE);
    if (fl || cv) {
      indoor = new Uint8Array(N);
      if (fl) addClamped(indoor, fl);
      if (cv) addClamped(indoor, cv);
    }
    const wa = M.area.get(AR.WATER);
    if (wa) water = offPlan(wa, indoor);
  }

  const area = (r: AreaRole): Uint8Array => G.area.get(r) ?? zero;
  const objG = (r: ObjectRole): Uint8Array => G.objects.get(r) ?? zero;
  const objS = (r: ObjectRole): Uint8Array => S?.objects.get(r) ?? zero;

  // Snow: the ground's (terrain and ground snow objects), and snow objects high up: on a roof
  // that's roof snow, elsewhere it lies over the ground.
  const roofA = area(AR.ROOF);
  const lowSnow = objG(OR.SNOW);
  const roofSnow = new Uint8Array(N);
  const snow = new Uint8Array(N);
  snowParts(objS(OR.SNOW), roofA, G.terrain.get(TR.SNOW) ?? zero, lowSnow, roofSnow, snow);

  // What G's objects cover, and outdoors.
  const solid = new Uint8Array(N);
  for (const [r, p] of G.objects) if (r !== OR.SNOW) addClamped(solid, p);
  const ground = sum16([...G.terrain.values(), ...OUT_AREAS.map((r) => G.area.get(r))], N);
  const outdoor = outdoorOf(ground, solid, lowSnow, indoor);

  // As drawn: what's solid, and with it the see-through objects kept as drawn, as they show.
  const listed = sum16([
    G.terrain.get(TR.KEEP), ...KEEP_AREAS.map((r) => G.area.get(r)), ...KEEP_G.map((r) => G.objects.get(r)),
    packs === "guess" ? undefined : G.objects.get(OR.OPAQUE),
  ], N);
  const keepSolid = keepOf(listed, roofA, roofSnow);
  const sKept = KEEP_S.map((r) => S?.objects.get(r)).filter((p): p is Uint8Array => !!p);
  let keep = keepSolid;
  if (sKept.length) {
    keep = new Uint8Array(keepSolid);
    for (const p of sKept) addClamped(keep, p);
  }
  return { aw, ah, role, G, S, sRole, sIdx, gIdx, indoor, water, roofSnow, snow, solid, outdoor, keep, keepSolid, zero };
}

/** Inside water (water >= 128), the distance to its edge in 1/16 of a Dungeondraft square; 0 elsewhere. */
function shoreOf(sc: SeasonSidecar, water: Uint8Array, aw: number, ah: number): Uint8Array {
  const N = aw * ah;
  const [x0, , x1] = sc.meta.rect;
  const k16 = 16 / D1 / ((aw * 256) / (x1 - x0));
  const m = new Uint8Array(N);
  atLeast(m, water, COVERED, null);
  const out = new Uint8Array(N);
  const win = windowOf(m, aw, ah, 1);
  if (!win) return out;
  const [wx, wy, ww, wh] = win;
  const sub = cut(m, aw, win, new Uint8Array(ww * wh));
  const d = distTo(sub, 0, ww, wh, new Int32Array(ww * wh));
  for (let y = 0; y < wh; y++) {
    for (let x = 0, q = y * ww, k = (wy + y) * aw + wx; x < ww; x++, q++, k++) if (sub[q]) out[k] = Math.min(255, Math.round(d[q] * k16));
  }
  return out;
}

/** The parts as one SidecarLayers: G's terrain and areas, both parts' objects, top in sidecar indices. */
function merged(dr: Drawn): SidecarLayers {
  const { G, S, gIdx, sIdx, sRole } = dr;
  const N = dr.aw * dr.ah;
  const objects = new Map(G.objects);
  if (S) {
    for (const [r, p] of S.objects) {
      const q = objects.get(r);
      if (!q) objects.set(r, p);
      else {
        const sum = new Uint8Array(q);
        addClamped(sum, p);
        objects.set(r, sum);
      }
    }
  }
  const top = new Uint16Array(N);
  const sTop = S ? S.top : null;
  for (let k = 0; k < N; k++) {
    const g = G.top[k];
    if (g) top[k] = gIdx[g - 1] + 1;
    else if (sTop && sTop[k] && sRole[sIdx[sTop[k] - 1]]) top[k] = sIdx[sTop[k] - 1] + 1;
  }
  return { w: dr.aw, h: dr.ah, terrain: G.terrain, area: G.area, objects, top, skipped: (G.skipped ?? 0) + (S?.skipped ?? 0) };
}

/**
 * The snow's share of the open soft ground (4.2), by the extractor's rule for META.snowShare: the
 * ground drawn with pack items and ground-level snow objects only (the ground under a tree counts,
 * ground snow objects count as snow; floors, caves, roofs, walls, water and pack items hide it),
 * SNOW over SNOW, ICE, GRASS, EARTH and SAND.
 */
function snowShareOf(sc: SeasonSidecar, role: Uint8Array, aw: number, ah: number): number {
  const o = sc.objects;
  const keep: number[] = [];
  for (let i = 0; i < o.n; i++) if (role[i] === OR.OPAQUE || (role[i] === OR.SNOW && o.layer[i] < DD_LAYER.ROOF)) keep.push(i);
  const L = rasterSidecar({ ...sc, objects: pickObjects(o, Int32Array.from(keep)) }, { w: aw, h: ah });
  const sum = (p: Uint8Array | undefined): number => (p ? total(p) : 0);
  const snow = sum(L.terrain.get(TR.SNOW)) + sum(L.objects.get(OR.SNOW));
  const soft = snow + sum(L.terrain.get(TR.ICE)) + sum(L.terrain.get(TR.GRASS)) + sum(L.terrain.get(TR.EARTH)) + sum(L.terrain.get(TR.SAND));
  return soft > 0 ? snow / soft : 0;
}

export function exactLayers(sc: SeasonSidecar, aw: number, ah: number, opts?: { packs?: "guess" }): ExactLayers {
  const dr = draw(sc, aw, ah, opts?.packs);
  return {
    aw, ah, layers: merged(dr), outdoor: dr.outdoor, indoor: dr.indoor, keep: dr.keep, shore: shoreOf(sc, dr.water, aw, ah),
    snowShare: snowShareOf(sc, dr.role, aw, ah),
  };
}

// ---------------------------------------------------------------- the analysis

/**
 * analyse() for a scene with Dungeondraft data. v1: snowy maps only; it throws on a green one,
 * and the caller falls back to analyse(). Never writes into rgba.
 * packs "guess": the pixel snowAnalysis runs too, and its trees and caps are kept only where their
 * centres lie in OPAQUE footprints (design 1.2 (b)), with the open snow it sees in those footprints
 * round them (a footprint measured generously holds snow round the crown); pack files are never
 * opened.
 */
export function analyseExact(rgba: Uint8ClampedArray, aw: number, ah: number, cellA: number, sc: SeasonSidecar,
  opts: { bare?: "leaf" | "dead"; drawn?: "winter" | "green"; packs?: "guess" }): SeasonAnalysis {
  if (!isSnowy(sc.meta, opts.drawn)) throw new Error("exact seasons: this map is drawn green (exact green seasons come later)");
  const N = aw * ah;
  if (!(rgba.length >= N * 4)) throw new Error("exact seasons: the picture is smaller than the analysis");
  const dr = draw(sc, aw, ah, opts.packs);
  const { G, S, zero } = dr;
  const cA = cellA > 1 ? cellA : 1;
  const terr = (r: TerrainRole): Uint8Array => G.terrain.get(r) ?? zero;
  const area = (r: AreaRole): Uint8Array => G.area.get(r) ?? zero;
  const pc = picClasses(rgba, N);

  // ---- trees: one per crown, bare tree and prop that shows, not indoors
  const o = sc.objects;
  const [x0, y0, x1, y1] = sc.meta.rect;
  const sx = aw / (x1 - x0);
  const sy = ah / (y1 - y0);
  const bareKind = opts.bare === "dead" ? K_DEAD : K_BARE;
  const kindOf = new Uint8Array(o.n);
  for (let i = 0; i < o.n; i++) {
    const r = dr.role[i];
    if (r === OR.EVERGREEN) kindOf[i] = K_EVER;
    else if (r === OR.DECIDUOUS || r === OR.SHRUB || r === OR.FLOWER_SHRUB) kindOf[i] = o.flags[i] & OBJ_FLAG.CAPPED ? K_CAP : K_BROAD;
    else if (r === OR.BARE) kindOf[i] = bareKind;
    else if (r === OR.ROCK || r === OR.DEADWOOD || r === OR.STUMP || r === OR.ROOTS) kindOf[i] = K_PROP;
  }
  const own1 = owners(G.top, S ? S.top : null, dr.gIdx, dr.sIdx, dr.sRole, kindOf, dr.solid);
  const area1 = counts(own1, o.n);
  const treeOf = new Int32Array(o.n);
  const objOf: number[] = [];
  for (let i = 0; i < o.n && objOf.length < 65535; i++) {
    if (!kindOf[i] || !area1[i]) continue;
    const cx = Math.floor((o.x[i] / SIDECAR_UNITS.coord - x0) * sx);
    const cy = Math.floor((o.y[i] / SIDECAR_UNITS.coord - y0) * sy);
    if (cx >= 0 && cy >= 0 && cx < aw && cy < ah && dr.indoor[cy * aw + cx] >= COVERED) continue;
    objOf.push(i);
    treeOf[i] = objOf.length;
  }
  const nE = objOf.length;
  const tOwn = new Int32Array(N);
  const fk = new Uint8Array(N);
  treePixels(own1, treeOf, kindOf, tOwn, fk);
  const acc = new Float64Array((nE + 1) * 6);
  const ownOwner = new Int32Array(N);
  treeSums(rgba, tOwn, pc, acc, ownOwner);

  // Pack items guessed from the picture (packs "guess"): the pixel analysis's trees whose centres
  // lie in a pack item's footprint, and the open snow it sees there round them.
  const guess: number[] = [];
  let px: SnowInfo | null = null;
  const opaqueM = new Uint8Array(N);
  let packSnow = zero;
  if (opts.packs === "guess") {
    const op = G.objects.get(OR.OPAQUE);
    if (op) {
      atLeast(opaqueM, op, COVERED, null);
      px = pixelSnowInfo(rgba, aw, ah, cA);
    }
    if (px) {
      for (let t = 0; t < px.nTrees && nE + guess.length < 65535; t++) {
        const kx = Math.floor(px.trees[t * TREE_N]);
        const ky = Math.floor(px.trees[t * TREE_N + 1]);
        if (kx >= 0 && ky >= 0 && kx < aw && ky < ah && opaqueM[ky * aw + kx]) guess.push(t);
      }
      packSnow = new Uint8Array(N);
      packGround(px, opaqueM, pc.snowC, packSnow);
    }
  }
  // Left as drawn, by the pixels too: the snow between a see-through kept object's leaves or wisps isn't.
  const keep = keepByColour(dr.keep, dr.keepSolid, pc.snowC);
  // The ground's snow showing through crowns' and props' footprints (between a pine's branches,
  // round a log), kept paths' ribbons (beside a cliff's rocks) and caves' rims (a band laid round
  // the cave, over whatever's there): what's snow-coloured there and joins the open snow outside.
  // Those on ribbons and rims aren't kept.
  const bands = area(AR.PATH_KEEP);
  const rimA = G.area.get(AR.CAVE_RIM);
  const band = rimA ? sum16([bands, rimA], N) : bands;
  const gap = groundGaps(fk, pc, keep, band, aw, ah);
  freeRibbon(keep, gap, fk, band, aw, ah);

  // ---- the channels
  const sB = new Uint8Array(N * NSN);
  const m = new Uint8Array(N);
  const hs = new Uint8Array(N);
  const d = new Int32Array(N);
  // Capped crowns; evergreens and green leafy crowns; props.
  kindMask(m, fk, K_CAP, K_CAP);
  putChannel(sB, SN_CROWN, m, aw, ah, hs);
  kindMask(m, fk, K_EVER, K_BROAD);
  clearWhere(m, gap);
  putChannel(sB, SN_EVER, m, aw, ah, hs);
  kindMask(m, fk, K_PROP, K_PROP);
  clearWhere(m, gap);
  putChannel(sB, SN_PROP, m, aw, ah, hs);
  // Grass patches: grass terrain and the tufts, flowers, crops and reeds, with their soft edge.
  atLeast(m, sum16([G.terrain.get(TR.GRASS), ...LAWN_OBJECTS.map((r) => S?.objects.get(r))], N), COVERED, dr.indoor);
  dilateNear(m, Math.max(1, 0.12 * cA), aw, ah, d);
  putChannel(sB, SN_LAWN, m, aw, ah, hs);
  // Ice and water, outdoors.
  const iceM = new Uint8Array(N);
  atLeast(iceM, sum16([G.terrain.get(TR.ICE), G.area.get(AR.ICE)], N), COVERED, dr.indoor);
  const watM = new Uint8Array(N);
  atLeast(watM, area(AR.WATER), COVERED, dr.indoor);
  m.set(iceM);
  putChannel(sB, SN_ICE, m, aw, ah, hs);
  m.set(watM);
  putChannel(sB, SN_WATER, m, aw, ah, hs);
  // Earth: earth and sand terrain, and earth paths (their drawn width).
  const pathE = area(AR.PATH_EARTH);
  const earthM = new Uint8Array(N);
  atLeast(earthM, sum16([G.terrain.get(TR.EARTH), G.terrain.get(TR.SAND), G.area.get(AR.PATH_EARTH)], N), COVERED, null);
  m.set(earthM);
  putChannel(sB, SN_EARTH, m, aw, ah, hs);
  // The open snow, reaching a couple of pixels under rims (the pixel's own colour decides what
  // melts there).
  const core = new Uint8Array(earthM);
  shrink(core, aw, ah);
  const open = new Uint8Array(N);
  openSnow(m, open, dr.snow, packSnow, pc.snowC, fk, gap, iceM, watM, core, keep);
  grow(m, 2, aw, ah);
  putChannel(sB, SN_GROUND, m, aw, ah, hs);

  // The snow's tone and colours, and the map's own grass and earth, over the exact masks.
  const grassPx = new Uint8Array(N);
  const earthPx = new Uint8Array(N);
  groundPixels(terr(TR.GRASS), earthM, pc, grassPx, earthPx);
  const tone = openTone(pc.lum, open, aw, ah, cA, pc.meanLum);
  const col = snowColours(rgba, aw, ah, cA, { open, grass: grassPx, earth: earthPx }, { lum: pc.lum, meanLum: pc.meanLum, tone });
  setChannel(sB, SN_TONE, col.tone);
  const ref = col.ref;

  // ---- the trees' fields
  const leafless = (kd: number): boolean => kd === K_BARE || kd === K_DEAD;
  // All the crowns' and props' own green, for a crown with none of its own.
  let er = 0;
  let eg = 0;
  let eb = 0;
  let en = 0;
  for (let t = 1; t <= nE; t++) {
    if (leafless(kindOf[objOf[t - 1]])) continue;
    er += acc[t * 6];
    eg += acc[t * 6 + 1];
    eb += acc[t * 6 + 2];
    en += acc[t * 6 + 3];
  }
  const everG = en >= 8 ? [er / en, eg / en, eb / en] : DD_GREEN;
  const ownMed = medians(rgba, ownOwner, nE);

  const nT = nE + guess.length;
  const trees = new Float32Array(Math.max(1, nT) * TREE_N);
  const own = new Float32Array(Math.max(1, nT) * 3);
  const sr = (sx + sy) / 2;
  for (let t = 1; t <= nE; t++) {
    const i = objOf[t - 1];
    const kd = kindOf[i];
    const b = (t - 1) * TREE_N;
    const a = t * 6;
    trees[b] = (o.x[i] / SIDECAR_UNITS.coord - x0) * sx;
    trees[b + 1] = (o.y[i] / SIDECAR_UNITS.coord - y0) * sy;
    let sum = 0;
    for (let k = 0; k < TREE_DIRS; k++) {
      const r = (o.reach[i * REACH_N + k] / SIDECAR_UNITS.reach) * sr;
      trees[b + 8 + k] = r;
      sum += r;
    }
    trees[b + 2] = sum / TREE_DIRS;
    trees[b + 3] = kd;
    const bare = leafless(kd);
    for (let c = 0; c < 3; c++) trees[b + 4 + c] = !bare && acc[a + 3] >= 4 ? acc[a + c] / acc[a + 3] : everG[c];
    trees[b + 7] = acc[a + 5] >= 4 ? Math.min(1, (1.08 * acc[a + 4]) / acc[a + 5] / 255) : ref;
    const fallback = kd === K_PROP ? (dr.role[i] === OR.ROCK ? STONE : WOOD) : bare ? BARK : [trees[b + 4], trees[b + 5], trees[b + 6]];
    for (let c = 0; c < 3; c++) own[(t - 1) * 3 + c] = ownMed.count[t] >= 4 ? ownMed.rgb[t * 3 + c] : fallback[c];
  }

  // Which tree each pixel belongs to or is next to: crowns and props a pixel or two past their
  // footprint; a bare tree as far as its leaves may reach, where no crown or prop is nearer.
  const near = new Int32Array(N);
  const tl = new Uint16Array(N);
  const crowns = crownLabels(tOwn, fk);
  const lim = Math.max(2, 0.1 * cA) * D1;
  const cw = windowOf(crowns, aw, ah, Math.ceil(lim / D1) + 1);
  if (cw) {
    // (Only distances within lim are read, here and by bareDomains: the window round the crowns.)
    const n = cw[2] * cw[3];
    const dn = new Int32Array(n);
    const nn = new Int32Array(n);
    labelDistances(cut(crowns, aw, cw, new Int32Array(n)), cw[2], cw[3], dn, nn);
    paste(d, aw, cw, dn);
    paste(near, aw, cw, nn);
    within(tl, near, d, lim);
  }
  bareDomains(trees, 0, nE, aw, ah, cA, tl, near, d);

  // The guessed pack trees, as the pixel analysis found them, within the pack items' footprints
  // (and a couple of pixels round them: its masks' soft rims).
  if (px && guess.length) {
    const ps = px;
    const newOf = new Int32Array(ps.nTrees + 1);
    guess.forEach((t, j) => (newOf[t + 1] = nE + j + 1));
    const rim = new Uint8Array(opaqueM);
    grow(rim, 2, aw, ah);
    const gOwner = new Int32Array(N);
    for (let k = 0; k < N; k++) {
      const t = newOf[ps.tl[k]];
      if (!t || !rim[k]) continue;
      if (!tl[k]) tl[k] = t;
      for (const ch of [SN_CROWN, SN_EVER, SN_PROP]) {
        const q = k * NSN + ch;
        if (ps.s[q] > sB[q]) sB[q] = ps.s[q];
      }
      if (opaqueM[k] && pc.seen[k] && pc.snowC[k] < 128 && pc.mx[k] >= INK_MAX) gOwner[k] = t - nE;
    }
    const gMed = medians(rgba, gOwner, guess.length);
    guess.forEach((t, j) => {
      const src = t * TREE_N;
      const b = (nE + j) * TREE_N;
      trees.set(ps.trees.subarray(src, src + TREE_N), b);
      const kd = ps.trees[src + 3];
      const bare = kd === K_BARE;
      trees[b + 3] = bare ? bareKind : kd;
      // (The pixel analysis keeps a reach for bare trees only, by sector; sector k is centred
      // where REACH_DIRS's sample k points, so it reads as the exact path's. Others: the radius.)
      if (!bare) for (let k = 0; k < TREE_DIRS; k++) trees[b + 8 + k] = trees[b + 2];
      const fallback = kd === K_PROP ? STONE : bare ? BARK : [trees[b + 4], trees[b + 5], trees[b + 6]];
      for (let c = 0; c < 3; c++) own[(nE + j) * 3 + c] = gMed.count[j + 1] >= 4 ? gMed.rgb[(j + 1) * 3 + c] : fallback[c];
    });
  }

  // ---- the exact extras
  const roofSnow = dr.roofSnow;
  const x = interleave(keep, roofSnow, pathE);
  const gp = groundPlanes(G, dr.snow, zero);
  const cover = new Uint8Array(dr.solid);
  if (S) for (const p of S.objects.values()) addClamped(cover, p);
  const partner = partners(gp, sB, pc, cover, tOwn, Math.max(1, PARTNER_NEAR * cA), aw, ah, d);
  // Each terrain role's colour where it's pure.
  const roleColour = new Float32Array(TR_N * 3);
  {
    const med = medians(rgba, pureOwners(gp, cover, dr.indoor, pc, aw, ah), TR_N - 1);
    for (let r = 1; r < TR_N; r++) {
      const fallback = r === TR.SNOW ? col.snow : r === TR.GRASS ? col.grass : r === TR.EARTH ? col.earth : ROLE_DEFAULT[r] ?? [0, 0, 0];
      for (let c = 0; c < 3; c++) roleColour[r * 3 + c] = med.count[r] >= 16 ? med.rgb[r * 3 + c] : fallback[c];
    }
  }
  // Each roof's own colour where snow lies on it: the median of its pixels that aren't snow or ink.
  const roof = new Uint8Array(N * 3);
  if (total(roofSnow) > 0) {
    const rm = new Uint8Array(N);
    atLeast(rm, area(AR.ROOF), COVERED, null);
    const lab = new Int32Array(N);
    const nR = label4(rm, aw, ah, lab, new Int32Array(N));
    const all = new Int32Array(N);
    const med = medians(rgba, roofOwners(lab, roofSnow, pc, all), nR);
    const whole = medians(rgba, all, 1);
    roofPaint(roof, roofSnow, lab, aw, ah, med.rgb, med.count, whole.count[1] >= 4 ? [whole.rgb[3], whole.rgb[4], whole.rgb[5]] : SLATE);
  }
  const shore = shoreOf(sc, dr.water, aw, ah);

  // Anything besides open ground here or next door.
  objMask(m, sB, tl, roofSnow, pathE);
  grow(m, 1, aw, ah);
  setMask(sB, SN_OBJ, m);

  const frac = N ? total(dr.outdoor) / (255 * N) : 0;
  const exact: ExactSnow = { x, partner, own, roleColour, shore, roof };
  const sn: SnowInfo = {
    s: sB, tl, trees, nTrees: nT, ref, grass: col.grass, hasGrass: col.hasGrass, grassLum: col.grassLum, earth: col.earth,
    snow: col.snow, frac, exact,
  };
  const none = new Uint8Array(0);
  return { aw, ah, cellA, f: none, lab: new Uint16Array(0), crowns: new Float32Array(0), nCrowns: 0, under: none, uw: 0, uh: 0, us: 1, frac, amb: 0, snow: sn };
}

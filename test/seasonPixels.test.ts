import { describe, expect, it } from "vitest";
import { SEASON_LOOKS } from "../src/shared/types";
import type { SeasonLook } from "../src/shared/types";
import {
  ALGO_VERSION,
  PIXEL_SNOWY,
  TREE_DIRS,
  analyse,
  analysePixelSnowy,
  bake,
  bareReach,
  outdoorFraction,
  seedFrom,
  snowColours,
} from "../src/client/room/seasonPixels";
import type { BareReach, SeasonAnalysis } from "../src/client/room/seasonPixels";
import { readPng } from "./helpers/png";
import type { PngImage } from "./helpers/png";

// Small synthetic maps built in code. Each is CELL px a square; the analysis runs at half
// size (as the app analyses a downscaled copy) and bakes run on the full image.
const CELL = 16;
const LEVELS = [1, 2, 3] as const;

type RGB = readonly [number, number, number];

class Pic {
  w: number;
  h: number;
  /** Pixels a square. */
  cell: number;
  px: Uint8ClampedArray;
  seed = 12345;
  constructor(cols: number, rows: number, cell = CELL) {
    this.cell = cell;
    this.w = cols * cell;
    this.h = rows * cell;
    this.px = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 3; i < this.px.length; i += 4) this.px[i] = 255;
  }
  rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
  put(x: number, y: number, c: RGB, jitter: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    for (let k = 0; k < 3; k++) this.px[o + k] = c[k] + (this.rnd() - 0.5) * jitter;
  }
  /** A rectangle, in squares. */
  rect(c0: number, r0: number, cw: number, rh: number, c: RGB, jitter = 12): void {
    const C = this.cell;
    for (let y = Math.round(r0 * C); y < Math.round((r0 + rh) * C); y++) {
      for (let x = Math.round(c0 * C); x < Math.round((c0 + cw) * C); x++) this.put(x, y, c, jitter);
    }
  }
  /** A disc, in squares. */
  disc(cx: number, cy: number, r: number, c: RGB, jitter = 12): void {
    const C = this.cell;
    for (let y = Math.floor((cy - r) * C); y < (cy + r) * C; y++) {
      for (let x = Math.floor((cx - r) * C); x < (cx + r) * C; x++) {
        const dx = (x + 0.5) / C - cx;
        const dy = (y + 0.5) / C - cy;
        if (dx * dx + dy * dy < r * r) this.put(x, y, c, jitter);
      }
    }
  }
  /** A ring (an ink outline), in squares. */
  ring(cx: number, cy: number, r: number, width: number, c: RGB): void {
    const C = this.cell;
    for (let y = Math.floor((cy - r - width) * C); y < (cy + r + width) * C; y++) {
      for (let x = Math.floor((cx - r - width) * C); x < (cx + r + width) * C; x++) {
        const d = Math.hypot((x + 0.5) / C - cx, (y + 0.5) / C - cy);
        if (d >= r && d < r + width) this.put(x, y, c, 0);
      }
    }
  }
  /** Lawn, wherever inside(u, v) (in squares) holds. */
  lawn(c: RGB = [88, 128, 58], inside: (u: number, v: number) => boolean = () => true): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!inside((x + 0.5) / this.cell, (y + 0.5) / this.cell)) continue;
        const n = Math.sin(x * 0.05) * Math.sin(y * 0.07) * 10;
        this.put(x, y, [c[0] + n, c[1] + n, c[2]], 24);
      }
    }
  }
  /** Colour at (x, y) in a baked copy. */
  at(img: Uint8ClampedArray, x: number, y: number): RGB {
    const o = (y * this.w + x) * 4;
    return [img[o], img[o + 1], img[o + 2]];
  }
}

/** Half-size box downscale, as the analysis source. */
function half(p: Pic): { rgba: Uint8ClampedArray; aw: number; ah: number } {
  const aw = p.w >> 1;
  const ah = p.h >> 1;
  const rgba = new Uint8ClampedArray(aw * ah * 4);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      for (let k = 0; k < 4; k++) {
        let s = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += p.px[((2 * y + dy) * p.w + 2 * x + dx) * 4 + k];
        rgba[(y * aw + x) * 4 + k] = Math.round(s / 4);
      }
    }
  }
  return { rgba, aw, ah };
}

/** analyse(), or the test-only analysePixelSnowy (the picture's own snow detection on). */
type Analyse = typeof analyse;

function analysed(p: Pic, entry: Analyse = analyse): SeasonAnalysis {
  const { rgba, aw, ah } = half(p);
  return entry(rgba, aw, ah, p.cell / 2);
}

function baked(p: Pic, a: SeasonAnalysis, look: SeasonLook, level: 1 | 2 | 3, seed = 777): Uint8ClampedArray {
  const img = new Uint8ClampedArray(p.px);
  bake(img, p.w, p.h, { x0: 0, y0: 0, scale: 1, cell: p.cell, seed, look, level, a, sceneW: p.w, sceneH: p.h });
  return img;
}

/** Index of the first difference, or -1 (a plain loop: much faster than toEqual on big arrays). */
function firstDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Mean change per pixel (|dR| + |dG| + |dB|, out of 765). */
function meanChange(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return d / (a.length / 4);
}

function hue([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d <= 0) return 0;
  if (max === r) return 60 * (((g - b) / d + 6) % 6);
  if (max === g) return 60 * ((b - r) / d + 2);
  return 60 * ((r - g) / d + 4);
}

const INK: RGB = [16, 14, 12];
const LAVA: RGB = [228, 78, 20];
const WHITE: RGB = [250, 250, 246];

/** A lawn with ink lines, a lava pool, a campfire and a white label on it. */
function lawnMap(): Pic {
  const p = new Pic(32, 24);
  p.lawn();
  p.rect(3, 10, 26, 0.12, INK, 0);
  p.rect(12, 2, 0.12, 20, INK, 0);
  p.disc(22, 5, 1.2, LAVA, 0);
  p.disc(6, 18, 0.35, [255, 140, 30], 0);
  p.rect(18, 17, 4, 0.8, WHITE, 0);
  return p;
}

const TREES: [number, number][] = [
  [6, 6],
  [14, 5],
  [24, 7],
  [8, 16],
  [18, 15],
  [27, 17],
];
const TREE_R = 1.6;
const TREE_LAWN: RGB = [120, 150, 60];
/** That lawn in the shade of a thinned crown, as seen through its gaps. */
const LAWN_UNDER: RGB = [96, 120, 48];

/** A lawn with outlined tree crowns, bluer than the lawn and lit on their upper left. */
function treeMap(): Pic {
  const p = new Pic(32, 24);
  p.lawn(TREE_LAWN);
  for (const [cx, cy] of TREES) {
    p.disc(cx, cy, TREE_R, [46, 96, 62], 16);
    p.disc(cx - 0.35, cy - 0.35, TREE_R * 0.6, [66, 122, 84], 16);
    p.ring(cx, cy, TREE_R, 0.12, INK);
  }
  return p;
}

/** Grey floor, a water channel, moss, a green felt table and a blue slate floor. */
function dungeonMap(): Pic {
  const p = new Pic(32, 24);
  p.rect(0, 0, 32, 24, [70, 64, 58], 10);
  p.rect(1, 1, 30, 22, [88, 82, 76], 16);
  p.rect(0.85, 0.85, 30.3, 0.15, INK, 0);
  p.rect(0.85, 23, 30.3, 0.15, INK, 0);
  p.rect(3, 4, 20, 1, [38, 98, 112], 10);
  p.disc(8, 10, 0.6, [74, 112, 56], 20);
  p.rect(14, 9, 1.2, 2.2, [110, 75, 45], 8);
  p.rect(14.1, 9.1, 1, 2, [40, 110, 60], 8);
  p.rect(20, 14, 4, 3.5, [95, 110, 140], 14);
  return p;
}

/** A canopy-dominated forest: overlapping dark crowns with lit tops, a little floor between. */
function forestMap(): Pic {
  const p = new Pic(30, 20);
  p.rect(0, 0, 30, 20, [70, 60, 44], 12);
  for (let k = 0; k < 260; k++) {
    const cx = p.rnd() * 30;
    const cy = p.rnd() * 20;
    const r = 1 + p.rnd() * 1.2;
    p.disc(cx, cy, r, [34, 70, 34], 14);
    p.disc(cx - 0.25 * r, cy - 0.25 * r, r * 0.55, [50, 92, 44], 14);
  }
  return p;
}

const STONE: RGB = [128, 124, 118];
const WALL: RGB = [40, 36, 32];

/** An outlined crown, lit on its upper left (or flat, with no lit colour). */
function outlinedTree(p: Pic, cx: number, cy: number, r: number, c: RGB = [46, 96, 62], lit: RGB | null = [66, 122, 84]): void {
  p.disc(cx, cy, r, c, 16);
  if (lit) p.disc(cx - 0.22 * r, cy - 0.22 * r, r * 0.6, lit, 16);
  p.ring(cx, cy, r, 0.12, INK);
}

/** Grey paving with nothing green on it. */
function plaza(): Pic {
  const p = new Pic(24, 18);
  p.rect(0, 0, 24, 18, STONE, 16);
  return p;
}

/** Crowns at least 0.3 square across: centre x, y and radius in squares, and how big (0 a tree, 1 a mass). */
function crownList(a: SeasonAnalysis): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < a.nCrowns; i++) {
    const r = a.crowns[i * 4 + 2] / a.cellA;
    if (r >= 0.3) out.push([a.crowns[i * 4] / a.cellA, a.crowns[i * 4 + 1] / a.cellA, r, a.crowns[i * 4 + 3]]);
  }
  return out;
}

/** Of the pixels where inside(u, v) (in squares) holds: the share red or orange in late autumn, and white in deep snow. */
function lateLooks(p: Pic, a: SeasonAnalysis, inside: (u: number, v: number) => boolean): { turned: number; white: number } {
  const autumn = baked(p, a, "autumn", 3);
  const winter = baked(p, a, "winter", 3);
  let n = 0;
  let turned = 0;
  let white = 0;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!inside((x + 0.5) / p.cell, (y + 0.5) / p.cell)) continue;
      n++;
      const q = p.at(autumn, x, y);
      const hq = hue(q);
      if ((hq < 40 || hq >= 330) && Math.max(...q) - Math.min(...q) > 0.4 * Math.max(...q)) turned++;
      const s = p.at(winter, x, y);
      if (s[0] > 170 && s[1] > 170 && s[2] > 170) white++;
    }
  }
  return { turned: turned / n, white: white / n };
}

/** A green of hue h (60-120 degrees), saturation s and value v. */
function green(h: number, s: number, v: number): RGB {
  const k = v * s;
  return [(v - k + k * (2 - h / 60)) * 255, v * 255, (v - k) * 255];
}

/**
 * A lawn with rows of trees that have no outline, a little bluer and darker than it, drawn at
 * 4x and box-averaged to c pixels a square: the analysis of a small map on a fine grid.
 */
function smallCellMap(c: number, lit: boolean): { rgba: Uint8ClampedArray; aw: number; ah: number; trees: number[][] } {
  let seed = 999;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const SS = 4;
  const aw = Math.round(42 * c);
  const ah = Math.round(22 * c);
  const W = aw * SS;
  const H = ah * SS;
  const px = new Float32Array(W * H * 3);
  const lawn = green(86, 0.5, 0.55);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = Math.sin((x / (SS * c)) * 0.7) * Math.sin((y / (SS * c)) * 0.9) * 8;
      const o = (y * W + x) * 3;
      px[o] = lawn[0] + n + (rnd() - 0.5) * 20;
      px[o + 1] = lawn[1] + n + (rnd() - 0.5) * 20;
      px[o + 2] = lawn[2] + (rnd() - 0.5) * 20;
    }
  }
  const trees: number[][] = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      const cx = 3.5 + i * 7 + (rnd() - 0.5) * 2;
      const cy = 3.7 + j * 7.3 + (rnd() - 0.5) * 2;
      const r = 1.1 + rnd() * 0.6;
      const h = 96 + rnd() * 10;
      const v = 0.47 - rnd() * 0.06;
      const col = green(h, 0.5 + (rnd() - 0.5) * 0.06, v);
      const top = green(h - 3, 0.48, v + 0.06);
      trees.push([cx, cy]);
      for (let y = Math.max(0, Math.floor((cy - r) * c * SS)); y < Math.min(H, (cy + r) * c * SS); y++) {
        for (let x = Math.max(0, Math.floor((cx - r) * c * SS)); x < Math.min(W, (cx + r) * c * SS); x++) {
          const u = (x + 0.5) / (c * SS);
          const w = (y + 0.5) / (c * SS);
          if (Math.hypot(u - cx, w - cy) >= r) continue;
          const t = lit ? Math.max(0, 1 - Math.hypot(u - (cx - 0.3 * r), w - (cy - 0.3 * r)) / (0.6 * r)) : 0;
          const o = (y * W + x) * 3;
          for (let k = 0; k < 3; k++) px[o + k] = col[k] + (top[k] - col[k]) * t + (rnd() - 0.5) * 16;
        }
      }
    }
  }
  const rgba = new Uint8ClampedArray(aw * ah * 4);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const o = (y * aw + x) * 4;
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += px[((y * SS + dy) * W + x * SS + dx) * 3 + k];
        rgba[o + k] = s / (SS * SS);
      }
      rgba[o + 3] = 255;
    }
  }
  return { rgba, aw, ah, trees };
}

// ---- A high-resolution map, downscaled for the analysis the ways browsers might.

/** Full-size pixels a square; the analysis runs at 20 (2.2 times smaller), as the app sizes it. */
const HI = 44;
const HI_COLS = 26;
const HI_ROWS = 16;
/** Centre x, y and radius, in squares. */
const BUSH = [8, 5, 1.6] as const;
const TREE = [19, 10, 2.8] as const;
const STUMP = [13, 4, 0.7] as const;
const ROCKS = [
  [4, 12, 0.45],
  [11, 13, 0.35],
  [23, 3, 0.4],
] as const;

interface HiMap {
  w: number;
  h: number;
  px: Uint8ClampedArray;
}

/**
 * A lawn painted in soft light and dark patches (the dark ones bluer, as shade is), with
 * grain and grass strokes; an outlined bush with ink squiggles inside that cut some of its
 * lobes off from the rest; a big tree with no outline, darker and bluer than the lawn;
 * a stump with roots; outlined rocks. The patches are about as strong as a real lawn's:
 * strong enough to put the luma split right between them.
 */
function hiResMap(withTree: boolean): HiMap {
  const w = HI_COLS * HI;
  const h = HI_ROWS * HI;
  const px = new Uint8ClampedArray(w * h * 4);
  let seed = 4242;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const set = (x: number, y: number, c: RGB, jitter: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) px[o + k] = c[k] + (rnd() - 0.5) * jitter;
    px[o + 3] = 255;
  };
  // Lawn patches: smooth value noise on a 1.6-square lattice, sharpened into patches.
  const step = 1.6 * HI;
  const gw = Math.ceil(w / step) + 2;
  const lattice = Array.from({ length: gw * (Math.ceil(h / step) + 2) }, rnd);
  const dark: RGB = [96, 128, 74];
  const light: RGB = [124, 150, 80];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / step;
      const fy = y / step;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
      const ty = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
      const a = lattice[iy * gw + ix] + (lattice[iy * gw + ix + 1] - lattice[iy * gw + ix]) * tx;
      const b = lattice[(iy + 1) * gw + ix] + (lattice[(iy + 1) * gw + ix + 1] - lattice[(iy + 1) * gw + ix]) * tx;
      let t = Math.min(1, Math.max(0, (a + (b - a) * ty - 0.3) / 0.4));
      t = 0.5 + (t * t * (3 - 2 * t) - 0.5) * 1.3;
      set(x, y, [dark[0] + (light[0] - dark[0]) * t, dark[1] + (light[1] - dark[1]) * t, dark[2] + (light[2] - dark[2]) * t], 16);
    }
  }
  // Grass strokes.
  for (let i = 0; i < HI_COLS * HI_ROWS * 3; i++) {
    const x0 = rnd() * w;
    const y0 = rnd() * h;
    const ang = rnd() * Math.PI;
    const len = HI * (0.08 + 0.1 * rnd());
    for (let s = 0; s < len; s++) set(Math.round(x0 + Math.cos(ang) * s), Math.round(y0 + Math.sin(ang) * s), [58, 80, 44], 6);
  }
  const at = (x: number, y: number, cx: number, cy: number): number => Math.hypot((x + 0.5) / HI - cx, (y + 0.5) / HI - cy);
  const box = (cx: number, cy: number, r: number, f: (x: number, y: number) => void): void => {
    for (let y = Math.max(0, Math.floor((cy - r) * HI)); y < Math.min(h, Math.ceil((cy + r) * HI)); y++) {
      for (let x = Math.max(0, Math.floor((cx - r) * HI)); x < Math.min(w, Math.ceil((cx + r) * HI)); x++) f(x, y);
    }
  };
  if (withTree) {
    const [cx, cy, r] = TREE;
    box(cx, cy, r * 1.2, (x, y) => {
      const dx = (x + 0.5) / HI - cx;
      const dy = (y + 0.5) / HI - cy;
      const a = Math.atan2(dy, dx);
      const rr = r * (1 + 0.07 * Math.sin(a * 9) + 0.04 * Math.sin(a * 5 + 1));
      const d = Math.hypot(dx, dy);
      if (d >= rr) return;
      const lit = Math.max(0, 1 - Math.hypot(dx + 0.35 * r, dy + 0.35 * r) / (0.75 * r));
      const rim = d > rr - 0.12 ? 0.8 : 1;
      set(x, y, [(40 + 34 * lit) * rim, (86 + 40 * lit) * rim, (58 + 22 * lit) * rim], 14);
    });
  }
  {
    // The bush: a cloud of lobes with a thick outline, and arcs of ink inside.
    const [cx, cy, r] = BUSH;
    const lobes: [number, number, number][] = [[cx, cy, r * 0.72]];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      lobes.push([cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.36]);
    }
    const inside = (x: number, y: number): number => Math.max(...lobes.map(([lx, ly, lr]) => lr - at(x, y, lx, ly)));
    const leaf = new Uint8Array(w * h);
    box(cx, cy, r + 0.2, (x, y) => {
      const s = inside(x, y);
      if (s > 0) {
        const lit = Math.max(0, 1 - at(x, y, cx - 0.3 * r, cy - 0.3 * r) / r);
        set(x, y, [66 + 28 * lit, 108 + 26 * lit, 92 + 22 * lit], 12);
        leaf[y * w + x] = 1;
      } else if (s > -0.09) set(x, y, INK, 4);
    });
    for (let i = 1; i < lobes.length; i += 2) {
      const [lx, ly, lr] = lobes[i];
      const a0 = Math.atan2(cy - ly, cx - lx);
      for (let t = -1.3; t <= 1.3; t += 0.01) {
        const x = Math.round((lx + Math.cos(a0 + t) * lr * 0.95) * HI);
        const y = Math.round((ly + Math.sin(a0 + t) * lr * 0.95) * HI);
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) if (ox * ox + oy * oy <= 5 && leaf[(y + oy) * w + x + ox]) set(x + ox, y + oy, INK, 4);
        }
      }
    }
  }
  {
    const [cx, cy, r] = STUMP;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      for (let s = r * 0.9; s < r * 1.6; s += 0.01) {
        box(cx + Math.cos(a) * s, cy + Math.sin(a) * s, 0.06, (x, y) => set(x, y, [80, 56, 40], 6));
      }
    }
    box(cx, cy, r + 0.1, (x, y) => {
      const d = at(x, y, cx, cy);
      if (d < r) set(x, y, Math.abs((((d / r) * 4) % 1) - 0.5) < 0.06 ? [150, 110, 70] : [196, 162, 110], 8);
      else if (d < r + 0.08) set(x, y, [30, 20, 14], 4);
    });
  }
  for (const [cx, cy, r] of ROCKS) {
    box(cx, cy, r + 0.08, (x, y) => {
      const d = at(x, y, cx, cy);
      if (d < r) set(x, y, [128, 126, 132], 10);
      else if (d < r + 0.07) set(x, y, [26, 24, 28], 4);
    });
  }
  return { w, h, px };
}

type Shrink = "nearest" | "box" | "bilinear";

/**
 * Downscales the map to aw x ah: one sample per pixel (nearest), the exact area average
 * (box), or one bilinear tap at each pixel's centre, as a canvas does without mipmaps.
 * The first and last keep the full-size grain and alias thin lines; box smooths both.
 */
function shrink(m: HiMap, aw: number, ah: number, how: Shrink): Uint8ClampedArray {
  const { w, h, px } = m;
  const out = new Uint8ClampedArray(aw * ah * 4);
  const sx = w / aw;
  const sy = h / ah;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const o = (y * aw + x) * 4;
      if (how === "nearest") {
        const p = (Math.min(h - 1, Math.floor((y + 0.5) * sy)) * w + Math.min(w - 1, Math.floor((x + 0.5) * sx))) * 4;
        for (let c = 0; c < 4; c++) out[o + c] = px[p + c];
      } else if (how === "bilinear") {
        const fx = Math.max(0, Math.min(w - 1, (x + 0.5) * sx - 0.5));
        const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * sy - 0.5));
        const ix = Math.min(w - 2, Math.floor(fx));
        const iy = Math.min(h - 2, Math.floor(fy));
        for (let c = 0; c < 4; c++) {
          const p = (iy * w + ix) * 4 + c;
          const a = px[p] + (px[p + 4] - px[p]) * (fx - ix);
          const b = px[p + w * 4] + (px[p + w * 4 + 4] - px[p + w * 4]) * (fx - ix);
          out[o + c] = Math.round(a + (b - a) * (fy - iy));
        }
      } else {
        const acc = [0, 0, 0, 0];
        let wt = 0;
        for (let Y = Math.floor(y * sy); Y < Math.ceil((y + 1) * sy); Y++) {
          const wy = Math.min(Y + 1, (y + 1) * sy) - Math.max(Y, y * sy);
          for (let X = Math.floor(x * sx); X < Math.ceil((x + 1) * sx); X++) {
            const wxy = (Math.min(X + 1, (x + 1) * sx) - Math.max(X, x * sx)) * wy;
            for (let c = 0; c < 4; c++) acc[c] += px[(Y * w + X) * 4 + c] * wxy;
            wt += wxy;
          }
        }
        for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / wt);
      }
    }
  }
  return out;
}

interface HiResult {
  a: SeasonAnalysis;
  cA: number;
  /** Crowns at least 0.4 square across: centre x, y and radius in squares, and how big (0 a tree, 1 a mass). */
  crowns: number[][];
  /** Share of the open lawn (0.8 square clear of everything) that the analysis calls canopy. */
  lawnCanopy: number;
  /** Share of the bush (within 0.9 of its radius) that it calls canopy. */
  bushCanopy: number;
}

function analyseHi(m: HiMap, how: Shrink, entry: Analyse = analyse): HiResult {
  // The app's analysis size: about 20 px a square, 512-1024 px across.
  const long = Math.max(m.w, m.h);
  const kA = Math.min(1, Math.min(1024 / long, Math.max(512 / long, 20 / HI)));
  const aw = Math.round(m.w * kA);
  const ah = Math.round(m.h * kA);
  const cA = HI * kA;
  const a = entry(shrink(m, aw, ah, how), aw, ah, cA);
  const crowns: number[][] = [];
  for (let i = 0; i < a.nCrowns; i++) {
    const r = a.crowns[i * 4 + 2] / cA;
    if (r >= 0.2) crowns.push([a.crowns[i * 4] / cA, a.crowns[i * 4 + 1] / cA, r, a.crowns[i * 4 + 3]]);
  }
  let lawn = 0;
  let lawnCan = 0;
  let bush = 0;
  let bushCan = 0;
  const clear = (u: number, v: number, [cx, cy, r]: readonly number[], k: number): boolean => Math.hypot(u - cx, v - cy) > r * k + 0.8;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const u = (x + 0.5) / cA;
      const v = (y + 0.5) / cA;
      // Byte 2 of each pixel's 8 is the canopy (see SeasonAnalysis.f).
      const can = a.f[(y * aw + x) * 8 + 2] > 127;
      if (clear(u, v, BUSH, 1) && clear(u, v, TREE, 1.12) && clear(u, v, STUMP, 1.6) && ROCKS.every((r) => clear(u, v, r, 1))) {
        lawn++;
        if (can) lawnCan++;
      }
      if (Math.hypot(u - BUSH[0], v - BUSH[1]) < BUSH[2] * 0.9) {
        bush++;
        if (can) bushCan++;
      }
    }
  }
  return { a, cA, crowns, lawnCanopy: lawnCan / lawn, bushCanopy: bushCan / bush };
}

describe("seasonPixels", () => {
  it("exports a version and folds scene ids to 16-bit seeds", () => {
    expect(Number.isInteger(ALGO_VERSION)).toBe(true);
    const s = seedFrom("Scene1234567");
    expect(s).toBe(seedFrom("Scene1234567"));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(65535);
    expect(seedFrom("Scene1234568")).not.toBe(s);
  });

  it("is deterministic, and the seed matters", () => {
    const p = treeMap();
    for (const look of SEASON_LOOKS) {
      const a1 = analysed(p);
      const a2 = analysed(p);
      expect(firstDiff(a2.f, a1.f)).toBe(-1);
      expect(firstDiff(a2.lab, a1.lab)).toBe(-1);
      const x = baked(p, a1, look, 3, 99);
      const y = baked(p, a2, look, 3, 99);
      expect(firstDiff(y, x)).toBe(-1);
      expect(firstDiff(baked(p, a1, look, 3, 100), x)).not.toBe(-1);
    }
  });

  it("bakes strips and sub-rectangles exactly like a whole pass", () => {
    const p = treeMap();
    const a = analysed(p);
    // An awkward output size, so scene positions aren't whole pixels.
    const bw = 377;
    const bh = Math.round((bw * p.h) / p.w);
    const scale = p.w / bw;
    const src = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const o = (Math.floor(y * scale) * p.w + Math.floor(x * scale)) * 4;
        src.set(p.px.subarray(o, o + 4), (y * bw + x) * 4);
      }
    }
    for (const look of SEASON_LOOKS) {
      for (const level of LEVELS) {
        const opts = { cell: CELL, seed: 4242, look, level, a, sceneW: p.w, sceneH: p.h, scale };
        const whole = new Uint8ClampedArray(src);
        bake(whole, bw, bh, { ...opts, x0: 0, y0: 0 });
        const strips = new Uint8ClampedArray(src);
        for (let y = 0; y < bh; y += 23) {
          const rows = Math.min(23, bh - y);
          bake(strips.subarray(y * bw * 4, (y + rows) * bw * 4), bw, rows, { ...opts, x0: 0, y0: y * scale });
        }
        expect(firstDiff(strips, whole)).toBe(-1);
        // A rectangle in the middle, baked on its own.
        const rx = 101;
        const ry = 57;
        const rw = 90;
        const rh = 70;
        const rect = new Uint8ClampedArray(rw * rh * 4);
        for (let y = 0; y < rh; y++) rect.set(src.subarray(((ry + y) * bw + rx) * 4, ((ry + y) * bw + rx + rw) * 4), y * rw * 4);
        bake(rect, rw, rh, { ...opts, x0: rx * scale, y0: ry * scale });
        for (let y = 0; y < rh; y++) {
          expect(firstDiff(rect.subarray(y * rw * 4, (y + 1) * rw * 4), whole.subarray(((ry + y) * bw + rx) * 4, ((ry + y) * bw + rx + rw) * 4))).toBe(-1);
        }
      }
    }
  });

  it("never changes ink, lava, fire, near-white labels or alpha", () => {
    const p = lawnMap();
    // Some transparency, which must survive too.
    for (let i = 3; i < p.px.length; i += 4 * 97) p.px[i] = 128;
    const a = analysed(p);
    const fixed: number[] = [];
    for (let k = 0; k < p.w * p.h; k++) {
      const c: RGB = [p.px[k * 4], p.px[k * 4 + 1], p.px[k * 4 + 2]];
      const same = (q: RGB): boolean => q[0] === c[0] && q[1] === c[1] && q[2] === c[2];
      if (same(INK) || same(LAVA) || same(WHITE) || same([255, 140, 30])) fixed.push(k);
    }
    expect(fixed.length).toBeGreaterThan(2000);
    for (const look of SEASON_LOOKS) {
      for (const level of LEVELS) {
        const img = baked(p, a, look, level);
        for (const k of fixed) {
          for (let ch = 0; ch < 3; ch++) expect(img[k * 4 + ch]).toBe(p.px[k * 4 + ch]);
        }
        for (let i = 3; i < img.length; i += 4) if (img[i] !== p.px[i]) throw new Error(`alpha changed at ${i}`);
      }
    }
  });

  it("changes a dungeon (water, moss, a felt table, blue slate) only a little", () => {
    const p = dungeonMap();
    const a = analysed(p);
    expect(outdoorFraction(a)).toBeLessThan(0.04);
    for (const look of SEASON_LOOKS) {
      for (const level of LEVELS) {
        expect(meanChange(baked(p, a, look, level), p.px)).toBeLessThan(30);
      }
    }
  });

  it("buries a lawn in bright snow at deep snow", () => {
    const p = lawnMap();
    const a = analysed(p);
    expect(outdoorFraction(a)).toBeGreaterThan(0.5);
    const img = baked(p, a, "winter", 3);
    let bright = 0;
    let n = 0;
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const c = p.at(p.px, x, y);
        if (Math.abs(c[1] - 128) > 40) continue; // lawn pixels only
        const q = p.at(img, x, y);
        n++;
        if (q[0] > 170 && q[1] > 170 && q[2] > 170) bright++;
      }
    }
    expect(bright / n).toBeGreaterThan(0.85);
  });

  it("keeps open water in the middle of a 10-square lake at deep snow", () => {
    const p = new Pic(32, 24);
    p.lawn();
    const water: RGB = [52, 132, 142];
    p.disc(16, 12, 5, water, 10);
    const a = analysed(p);
    const img = baked(p, a, "winter", 3);
    const blueish = (x: number, y: number): boolean => {
      const q = p.at(img, x, y);
      return q[2] > q[0] + 40 && q[1] > q[0] + 40 && q[0] < 120;
    };
    let open = 0;
    let n = 0;
    for (let y = 11 * CELL; y < 13 * CELL; y++) {
      for (let x = 15 * CELL; x < 17 * CELL; x++) {
        n++;
        if (blueish(x, y)) open++;
      }
    }
    expect(open / n).toBeGreaterThan(0.95);
    // ...while its shore freezes.
    let frozen = 0;
    n = 0;
    for (let x = Math.round(11.3 * CELL); x < Math.round(12 * CELL); x++) {
      n++;
      if (!blueish(x, 12 * CELL)) frozen++;
    }
    expect(frozen / n).toBeGreaterThan(0.8);
  });

  it("treats a canopy-dominated forest as canopy: no bare earth or wildflowers, and it turns", () => {
    const p = forestMap();
    const a = analysed(p);
    const n = p.w * p.h;
    // Drought: crowns dry toward olive, but no patches worn to bare earth or cracked.
    const dry = baked(p, a, "summer", 3);
    let bare = 0;
    for (let k = 0; k < n; k++) {
      const d = Math.abs(dry[k * 4] - p.px[k * 4]) + Math.abs(dry[k * 4 + 1] - p.px[k * 4 + 1]) + Math.abs(dry[k * 4 + 2] - p.px[k * 4 + 2]);
      if (d > 150) bare++;
    }
    expect(bare / n).toBeLessThan(0.01);
    // Full bloom: blossom on the crowns, but no yellow or violet wildflowers.
    const bloom = baked(p, a, "spring", 3);
    let flowers = 0;
    for (let k = 0; k < n; k++) {
      const q: RGB = [bloom[k * 4], bloom[k * 4 + 1], bloom[k * 4 + 2]];
      for (const f of [[250, 226, 90], [178, 140, 222]]) {
        if (Math.abs(q[0] - f[0]) + Math.abs(q[1] - f[1]) + Math.abs(q[2] - f[2]) < 60) flowers++;
      }
    }
    expect(flowers / n).toBeLessThan(0.002);
    // Autumn turns the canopy.
    const turned = baked(p, a, "autumn", 2);
    let warm = 0;
    for (let k = 0; k < n; k++) {
      const q: RGB = [turned[k * 4], turned[k * 4 + 1], turned[k * 4 + 2]];
      const h = hue(q);
      if ((h < 60 || h >= 330) && Math.max(...q) - Math.min(...q) > 0.35 * Math.max(...q)) warm++;
    }
    expect(warm / n).toBeGreaterThan(0.3);
  });

  it("copes with tiny and blank maps", () => {
    for (const [w, h] of [[1, 1], [2, 1], [1, 3], [5, 4]]) {
      const src = new Uint8ClampedArray(w * h * 4).fill(200);
      const a = analyse(src, w, h, 0.5);
      expect(outdoorFraction(a)).toBe(0);
      for (const look of SEASON_LOOKS) {
        const img = new Uint8ClampedArray(src);
        bake(img, w, h, { x0: 0, y0: 0, scale: 1, cell: 1, seed: 1, look, level: 3, a, sceneW: w, sceneH: h });
        for (const v of img) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("turns every crown a mottled mix in autumn, never all red, and thins it", () => {
    const p = treeMap();
    const a = analysed(p);
    expect(a.nCrowns).toBe(TREES.length);
    const stats = LEVELS.map((level) => {
      const img = baked(p, a, "autumn", level);
      const all = { green: 0, warm: 0, red: 0, gap: 0, n: 0 };
      const perTree: number[][] = [];
      for (const [cx, cy] of TREES) {
        const t = { green: 0, warm: 0, red: 0, gap: 0, n: 0 };
        for (let y = Math.floor((cy - TREE_R) * CELL); y < (cy + TREE_R) * CELL; y++) {
          for (let x = Math.floor((cx - TREE_R) * CELL); x < (cx + TREE_R) * CELL; x++) {
            if (Math.hypot((x + 0.5) / CELL - cx, (y + 0.5) / CELL - cy) > TREE_R * 0.85) continue;
            const q = p.at(img, x, y);
            const o = p.at(p.px, x, y);
            const h = hue(q);
            t.n++;
            const dOwn = Math.abs(q[0] - o[0]) + Math.abs(q[1] - o[1]) + Math.abs(q[2] - o[2]);
            const dLawn = Math.abs(q[0] - LAWN_UNDER[0]) + Math.abs(q[1] - LAWN_UNDER[1]) + Math.abs(q[2] - LAWN_UNDER[2]);
            if (dLawn < 60 && dLawn < dOwn) t.gap++; // the lawn showing through
            else if (dOwn < 60) t.green++; // leaves still on and green
            else if (h >= 17 && h < 60) t.warm++; // yellows, golds, ambers, oranges
            else if (h < 17 || h >= 330) t.red++;
          }
        }
        perTree.push([t.green / t.n, t.warm / t.n, t.red / t.n, t.gap / t.n]);
        for (const k of ["green", "warm", "red", "gap", "n"] as const) all[k] += t[k];
      }
      return { level, green: all.green / all.n, warm: all.warm / all.n, red: all.red / all.n, gap: all.gap / all.n, perTree };
    });
    for (const s of stats) {
      // A real share of each: green left, yellow to orange, and red, but red never dominant.
      expect(s.green).toBeGreaterThan(s.level === 3 ? 0.04 : 0.12);
      expect(s.warm).toBeGreaterThan(0.2);
      expect(s.red).toBeGreaterThan(s.level === 1 ? 0.03 : 0.1);
      expect(s.red).toBeLessThan(0.4);
      for (const [g, w, r] of s.perTree) {
        // No tree is one colour.
        expect(Math.max(g, w, r)).toBeLessThan(0.85);
        expect(r).toBeLessThan(0.55);
      }
    }
    // Less foliage as the level rises: the lawn shows through more.
    expect(stats[0].gap).toBeGreaterThan(0.02);
    expect(stats[2].gap).toBeGreaterThan(stats[0].gap + 0.08);
    expect(stats[1].green).toBeLessThan(stats[0].green);
    expect(stats[2].green).toBeLessThan(stats[1].green);
    // Each is one tree, with its own lean, rim and branches.
    for (const c of crownList(a)) expect(c[3]).toBeLessThan(0.01);
  });

  // With nothing else green to compare them with, a walled lawn and a lone tree on paving are
  // told apart by shape and colour. A first version called any dark-edged lawn a tree there,
  // and a castle courtyard turned into one giant autumn crown, half bare in deep snow.
  it("keeps a walled lawn a lawn when it's all the green there is, and still finds a lone tree", () => {
    const walls = (p: Pic, c0: number, r0: number, cw: number, rh: number): void => {
      const t = 0.3;
      p.rect(c0 - t, r0 - t, cw + 2 * t, t, WALL, 6);
      p.rect(c0 - t, r0 + rh, cw + 2 * t, t, WALL, 6);
      p.rect(c0 - t, r0, t, rh, WALL, 6);
      p.rect(c0 + cw, r0, t, rh, WALL, 6);
    };
    // A courtyard: an 8x8 lawn in dark walls. It fills its box, as no crown does.
    const court = plaza();
    court.lawn(undefined, (u, v) => u >= 8 && u < 16 && v >= 5 && v < 13);
    walls(court, 8, 5, 8, 8);
    const a = analysed(court);
    expect(a.nCrowns).toBe(0);
    expect(a.amb).toBe(0);
    const looks = lateLooks(court, a, (u, v) => u > 8.5 && u < 15.5 && v > 5.5 && v < 12.5);
    expect(looks.turned).toBeLessThan(0.03);
    expect(looks.white).toBeGreaterThan(0.9);
    // A tree in it is a crown, and only the tree.
    outlinedTree(court, 12, 9, 2.5);
    const inCourt = crownList(analysed(court));
    expect(inCourt.length).toBe(1);
    expect(Math.hypot(inCourt[0][0] - 12, inCourt[0][1] - 9)).toBeLessThan(0.2);
    expect(Math.abs(inCourt[0][2] - 2.5)).toBeLessThan(0.25);
    // A round walled garden: as round as a crown, but too big and too yellow-green for one.
    const garden = plaza();
    garden.lawn(undefined, (u, v) => Math.hypot(u - 12, v - 9) < 4);
    garden.ring(12, 9, 4, 0.3, WALL);
    expect(analysed(garden).nCrowns).toBe(0);
    // An island of lawn on a transparent map: what's transparent is off the map, no outline.
    const island = new Pic(24, 18);
    const onIsland = (u: number, v: number): boolean => Math.hypot(u - 12, v - 9) < 4.5 * (1 + 0.15 * Math.sin(3 * Math.atan2(v - 9, u - 12)));
    island.lawn(undefined, onIsland);
    for (let k = 0; k < island.w * island.h; k++) {
      island.px[k * 4 + 3] = onIsland(((k % island.w) + 0.5) / CELL, (Math.floor(k / island.w) + 0.5) / CELL) ? 255 : 0;
    }
    expect(analysed(island).nCrowns).toBe(0);
    // Lone trees on paving: a small one, a big dark one, and a big bright blue-green one (as
    // in the owner's reference picture).
    const lone: [number, RGB, RGB | null][] = [
      [1.6, [46, 96, 62], [66, 122, 84]],
      [4, [46, 96, 62], null],
      [4, [70, 104, 82], [98, 138, 110]],
    ];
    for (const [r, c, lit] of lone) {
      const p = plaza();
      outlinedTree(p, 12, 9, r, c, lit);
      const cs = crownList(analysed(p));
      expect(cs.length).toBe(1);
      expect(Math.abs(cs[0][2] - r)).toBeLessThan(0.1 * r);
      expect(cs[0][3]).toBeLessThan(0.01);
    }
  });

  // One round crown gets one lean, rim thinning from its middle and a fan of branches: right
  // for a tree, wrong for trees grown together or a hedge, which vary as a mass does.
  it("treats a clump of touching trees and a hedge as masses, and a lone tree as one tree", () => {
    const p = new Pic(32, 16);
    p.lawn(TREE_LAWN);
    outlinedTree(p, 6, 5, 1.5);
    outlinedTree(p, 9.12, 5, 1.5);
    outlinedTree(p, 20, 5, 1.6);
    p.rect(4, 11, 24, 1, [46, 96, 62], 16);
    p.rect(4, 11, 24, 0.12, INK, 0);
    p.rect(4, 11.88, 24, 0.12, INK, 0);
    p.rect(4, 11, 0.12, 1, INK, 0);
    p.rect(27.88, 11, 0.12, 1, INK, 0);
    const cs = crownList(analysed(p));
    const at = (x: number, y: number): number[] | undefined => cs.find((c) => Math.hypot(c[0] - x, c[1] - y) < 0.6);
    const clump = at(7.56, 5);
    const tree = at(20, 5);
    const hedge = at(16, 11.5);
    expect(clump).toBeDefined();
    expect(tree).toBeDefined();
    expect(hedge).toBeDefined();
    expect(clump![3]).toBeGreaterThan(0.95);
    expect(hedge![3]).toBeGreaterThan(0.95);
    expect(tree![3]).toBeLessThan(0.01);
  });

  // Edge crispness compares 0.1-square bands, and at 5 pixels a square or less those were
  // thinner than distances step, so no unoutlined tree ever measured crisp.
  it("finds unoutlined trees when a square is only 4 to 4.5 analysis pixels", () => {
    for (const lit of [false, true]) {
      for (const c of [4, 4.5]) {
        const { rgba, aw, ah, trees } = smallCellMap(c, lit);
        const a = analyse(rgba, aw, ah, c);
        const found = trees.filter(([x, y]) => a.f[(Math.floor(y * c) * aw + Math.floor(x * c)) * 8 + 2] > 127).length;
        expect(found).toBeGreaterThanOrEqual(0.75 * trees.length);
        // And the lawn between them stays lawn.
        let lawn = 0;
        let can = 0;
        for (let y = 0; y < ah; y++) {
          for (let x = 0; x < aw; x++) {
            if (trees.some(([tx, ty]) => Math.hypot((x + 0.5) / c - tx, (y + 0.5) / c - ty) < 2.8)) continue;
            lawn++;
            if (a.f[(y * aw + x) * 8 + 2] > 127) can++;
          }
        }
        expect(can / lawn).toBeLessThan(0.01);
      }
    }
  });

  it("keeps the hue of pink and purple flowers on grass in spring", () => {
    const p = new Pic(24, 16);
    p.lawn();
    const colours: RGB[] = [
      [226, 140, 176],
      [200, 60, 200],
      [140, 90, 200],
    ];
    const dots: [number, number, RGB][] = [];
    for (let y = 2; y < 15; y += 2.5) {
      for (let x = 2; x < 23; x += 2.5) {
        const c = colours[dots.length % colours.length];
        p.disc(x, y, 0.12, c, 0);
        dots.push([x, y, c]);
      }
    }
    const img = baked(p, analysed(p), "spring", 3);
    for (const [x, y, c] of dots) {
      const d = Math.abs(hue(p.at(img, Math.floor(x * CELL), Math.floor(y * CELL))) - hue(c)) % 360;
      expect(Math.min(d, 360 - d)).toBeLessThan(3);
    }
  });

  // Each pixel only looks at its own cell of the blossom grid, so a cluster that crossed the
  // cell's edge was cut off there in a straight line.
  it("draws blossom clusters whole, not cut straight at the edge of their cell", () => {
    // Big squares, so a cut shows: 100 pixels a square, clusters on a 20-pixel grid.
    const p = new Pic(8, 6, 100);
    p.lawn(TREE_LAWN);
    p.disc(4, 3, 2.2, [70, 124, 84], 10);
    p.ring(4, 3, 2.2, 0.08, INK);
    const a = analysed(p);
    // Sharp steps between side-by-side pixels on the crown, by where the pair sits on the grid:
    // straddling a cell's edge, or one pixel either side of that.
    let onEdge = 0;
    let beside = 0;
    for (const seed of [3, 4, 5, 8]) {
      const img = baked(p, a, "spring", 3, seed);
      for (let y = 0; y < p.h; y++) {
        for (let x = 0; x < p.w - 1; x++) {
          if (Math.hypot((x + 1) / p.cell - 4, (y + 0.5) / p.cell - 3) > 1.8) continue;
          const o = (y * p.w + x) * 4;
          const step = Math.abs(img[o] - img[o + 4]) + Math.abs(img[o + 1] - img[o + 5]) + Math.abs(img[o + 2] - img[o + 6]);
          if (step <= 150) continue;
          const at = (x + 1) % 20;
          if (at === 0) onEdge++;
          else if (at === 1 || at === 19) beside++;
        }
      }
    }
    // There is blossom, and no more sharp steps on the cells' edges than beside them.
    expect(beside).toBeGreaterThan(400);
    expect(onEdge).toBeLessThan(0.55 * beside);
  });
});

// Browsers shrink the map for the analysis in their own ways (Chrome's canvas is bilinear,
// others mipmap or filter), and a first version only looked right for a lanczos shrink:
// with a bilinear one, the luma split landed inside a lawn's own light and dark patches and
// a three-square patch of lawn turned into an autumn crown, and grain punched holes in an
// outlined bush so only part of it was found.
describe("seasonPixels analysis, however the map was downscaled", () => {
  const SHRINKS: Shrink[] = ["nearest", "box", "bilinear"];
  const withTree = hiResMap(true);
  const lawnOnly = hiResMap(false);

  it("finds the same crowns, the outlined bush whole, and no lawn", () => {
    const runs = SHRINKS.map((how) => analyseHi(withTree, how));
    for (const r of runs) {
      // The bush and the tree, and nothing else.
      expect(r.crowns.length).toBe(2);
      const bush = r.crowns.find((c) => Math.hypot(c[0] - BUSH[0], c[1] - BUSH[1]) < 0.3);
      const tree = r.crowns.find((c) => Math.hypot(c[0] - TREE[0], c[1] - TREE[1]) < 0.3);
      expect(bush).toBeDefined();
      expect(tree).toBeDefined();
      // Whole: the lobes the ink cuts off belong to it too. And one bush, however much of the
      // ink on it survived the downscale.
      expect(bush![2]).toBeGreaterThan(BUSH[2] * 0.85);
      expect(bush![3]).toBeLessThan(0.01);
      expect(r.bushCanopy).toBeGreaterThan(0.95);
      expect(tree![2]).toBeGreaterThan(TREE[2] * 0.9);
      expect(tree![2]).toBeLessThan(TREE[2] * 1.1);
      expect(r.lawnCanopy).toBeLessThan(0.005);
      expect(r.a.amb).toBe(runs[0].a.amb);
      expect(Math.abs(r.a.frac - runs[0].a.frac)).toBeLessThan(0.01);
    }
    // And the same extents every way.
    for (const i of [0, 1]) {
      const rs = runs.map((r) => r.crowns[i][2]);
      expect(Math.max(...rs) - Math.min(...rs)).toBeLessThan(0.12);
    }
  });

  it("keeps a patchy lawn a lawn, with or without a tree on it", () => {
    for (const how of SHRINKS) {
      const r = analyseHi(lawnOnly, how);
      expect(r.crowns.length).toBe(1);
      expect(r.lawnCanopy).toBe(0);
      expect(r.bushCanopy).toBeGreaterThan(0.95);
    }
  });

  it("doesn't turn the lawn into a red crown in late autumn", () => {
    for (const how of SHRINKS) {
      const { a } = analyseHi(lawnOnly, how);
      const img = new Uint8ClampedArray(lawnOnly.px);
      const { w, h } = lawnOnly;
      bake(img, w, h, { x0: 0, y0: 0, scale: 1, cell: HI, seed: 777, look: "autumn", level: 3, a, sceneW: w, sceneH: h });
      // The open lawn: a few fallen leaves at most, never a mottled crown.
      let n = 0;
      let turned = 0;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const u = (x + 0.5) / HI;
          const v = (y + 0.5) / HI;
          const clear = [BUSH, STUMP, ...ROCKS].every(([cx, cy, r]) => Math.hypot(u - cx, v - cy) > r * 1.6 + 0.8);
          if (!clear) continue;
          const o = (y * w + x) * 4;
          const q: RGB = [img[o], img[o + 1], img[o + 2]];
          const hq = hue(q);
          n++;
          if ((hq < 40 || hq >= 330) && Math.max(...q) - Math.min(...q) > 0.4 * Math.max(...q)) turned++;
        }
      }
      expect(turned / n).toBeLessThan(0.03);
    }
  });
});

// ---- Maps painted under snow (a Dungeondraft winter map), and look-alikes that aren't.

/** Pixels a square of the maps below; the analysis runs at half that, 20 a square. */
const SC = 40;

/** Smooth value noise on a lattice `step` pixels apart, 0-1. */
function lattice(w: number, h: number, step: number, rnd: () => number): (x: number, y: number) => number {
  const gw = Math.ceil(w / step) + 2;
  const vals = Array.from({ length: gw * (Math.ceil(h / step) + 2) }, rnd);
  return (x, y) => {
    const fx = x / step;
    const fy = y / step;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
    const ty = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
    const a = vals[iy * gw + ix] + (vals[iy * gw + ix + 1] - vals[iy * gw + ix]) * tx;
    const b = vals[(iy + 1) * gw + ix] + (vals[(iy + 1) * gw + ix + 1] - vals[(iy + 1) * gw + ix]) * tx;
    return a + (b - a) * ty;
  };
}

/** A canvas SC pixels a square, drawn in squares. */
class Canvas implements HiMap {
  w: number;
  h: number;
  px: Uint8ClampedArray;
  rnd: () => number;
  constructor(cols: number, rows: number, seed: number) {
    this.w = cols * SC;
    this.h = rows * SC;
    this.px = new Uint8ClampedArray(this.w * this.h * 4).fill(255);
    let s = seed;
    this.rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };
  }
  set(x: number, y: number, c: RGB, jitter = 0): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    for (let k = 0; k < 3; k++) this.px[o + k] = c[k] + (this.rnd() - 0.5) * jitter;
  }
  get(x: number, y: number): RGB {
    const o = (y * this.w + x) * 4;
    return [this.px[o], this.px[o + 1], this.px[o + 2]];
  }
  /** Calls f for each pixel within r squares of (cx, cy), with its distance and angle. */
  around(cx: number, cy: number, r: number, f: (x: number, y: number, d: number, a: number) => void): void {
    for (let y = Math.max(0, Math.floor((cy - r) * SC)); y < Math.min(this.h, Math.ceil((cy + r) * SC)); y++) {
      for (let x = Math.max(0, Math.floor((cx - r) * SC)); x < Math.min(this.w, Math.ceil((cx + r) * SC)); x++) {
        const dx = (x + 0.5) / SC - cx;
        const dy = (y + 0.5) / SC - cy;
        const d = Math.hypot(dx, dy);
        if (d < r) f(x, y, d, Math.atan2(dy, dx));
      }
    }
  }
  /** A stroke from (x0, y0) to (x1, y1) in squares, w0 to w1 squares wide. */
  stroke(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: RGB, jitter = 6): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.ceil(len * SC * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const hw = (w0 + (w1 - w0) * t) / 2;
      this.around(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.max(hw, 0.6 / SC), (x, y) => this.set(x, y, c, jitter));
    }
  }
}

const INK_D: RGB = [24, 30, 24];

interface SnowyMap extends HiMap {
  /** Centre x, y and radius in squares of the snow-capped crowns, evergreens and bare trees. */
  caps: number[][];
  evergreens: number[][];
  bare: number[][];
  /** Where nothing stands: centre and radius (squares) of each thing drawn on the snow. */
  things: number[][];
}

/**
 * A map painted under snow, as Dungeondraft paints one: bright bluish-white snow, bluer and
 * darker in soft painted shade, with grain; a grid baked into the picture as thin dotted lines;
 * snow-capped crowns (a white cap with contour rings and a leafy green rim, outlined), frosted
 * evergreens, bare trees drawn as brown branches, a patch of bare earth and one of grass. With
 * bareOnly, no crowns or evergreens: only the bare trees stand in it.
 */
function snowyMap(bareOnly = false): SnowyMap {
  const p = new Canvas(24, 16, 2718);
  const n1 = lattice(p.w, p.h, 1.4 * SC, p.rnd);
  const n2 = lattice(p.w, p.h, 0.5 * SC, p.rnd);
  const lit: RGB = [236, 240, 246];
  const shade: RGB = [190, 203, 222];
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      let t = (0.7 * n1(x, y) + 0.3 * n2(x, y) - 0.35) / 0.4;
      t = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
      p.set(x, y, [shade[0] + (lit[0] - shade[0]) * t, shade[1] + (lit[1] - shade[1]) * t, shade[2] + (lit[2] - shade[2]) * t], 10);
    }
  }
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (x % SC !== 0 && y % SC !== 0) continue;
      if ((x % SC === 0 ? y : x) % 6 >= 3) continue;
      const [r, g, b] = p.get(x, y);
      p.set(x, y, [r * 0.8, g * 0.82, b * 0.85]);
    }
  }
  const caps = bareOnly ? [] : [
    [4, 4, 1.5],
    [19, 11.5, 1.9],
    [21, 3, 1.2],
  ];
  const evergreens = bareOnly ? [] : [
    [10, 3, 1.1],
    [3, 12, 1.0],
    [14, 13, 1.2],
  ];
  const bare = [
    [15, 4.5, 1.9],
    [7.5, 8.5, 1.7],
    [13.5, 9.2, 1.4],
  ];
  const earth = lattice(p.w, p.h, 0.3 * SC, p.rnd);
  p.around(10.5, 6.5, 2.2, (x, y) => {
    const e = Math.max(Math.abs((x + 0.5) / SC - 10.5) / 1.6, Math.abs((y + 0.5) / SC - 6.5) / 1.0);
    if (e < 1) p.set(x, y, [106 + 18 * earth(x, y), 92 + 14 * earth(x, y), 78 + 10 * earth(x, y)], 8);
  });
  p.around(8, 13.5, 1.3, (x, y, d) => {
    const k = Math.min(1, (1.3 - d) / 0.3);
    const [r, g, b] = p.get(x, y);
    p.set(x, y, [r + (96 - r) * k, g + (140 - g) * k, b + (70 - b) * k], 6);
  });
  for (const [cx, cy, r] of caps) {
    p.around(cx, cy, r + 0.08, (x, y, d, a) => {
      const edge = r * (0.95 + 0.04 * Math.sin(a * 11));
      if (d >= edge) {
        if (d < edge + 0.07) p.set(x, y, INK_D, 4);
        return;
      }
      const rim = r * (0.78 + 0.06 * Math.sin(a * 13 + 1) + 0.05 * Math.sin(a * 5));
      if (d > rim) {
        p.set(x, y, [58, 98, 54], 20);
        return;
      }
      const lit = 1 - 0.1 * (((x + 0.5) / SC - cx + (y + 0.5) / SC - cy) / r);
      const ring = [0.3, 0.52, 0.72].some((q) => Math.abs(d / rim - q) < 0.025) ? 0.78 : 1;
      p.set(x, y, [226 * lit * ring, 231 * lit * ring, 238 * lit * ring], 6);
    });
  }
  for (const [cx, cy, r] of evergreens) {
    const fr = lattice(p.w, p.h, 0.12 * SC, p.rnd);
    p.around(cx, cy, r + 0.08, (x, y, d, a) => {
      const edge = r * (0.92 + 0.07 * Math.abs(Math.sin(a * 8)));
      if (d >= edge) {
        if (d < edge + 0.07) p.set(x, y, INK_D, 4);
        return;
      }
      const f = fr(x, y);
      if (f > 0.68) p.set(x, y, [214, 226, 218], 10);
      else p.set(x, y, [50 + 30 * f, 92 + 40 * f, 58 + 20 * f], 14);
    });
  }
  // Bare trees: limbs from the trunk, forking twice, thinner as they go.
  for (const [cx, cy, R] of bare) {
    const branch = (x: number, y: number, ang: number, len: number, wid: number, gen: number): void => {
      const x1 = x + Math.cos(ang) * len;
      const y1 = y + Math.sin(ang) * len;
      p.stroke(x, y, x1, y1, wid + 0.03, wid * 0.7 + 0.03, INK_D, 0);
      p.stroke(x, y, x1, y1, wid, wid * 0.7, [112, 72, 50], 10);
      if (gen < 2) for (const da of [-0.45, 0.4]) branch(x1, y1, ang + da + (p.rnd() - 0.5) * 0.3, len * 0.62, wid * 0.6, gen + 1);
    };
    for (let i = 0; i < 7; i++) branch(cx, cy, (i / 7) * Math.PI * 2 + p.rnd() * 0.5, R * 0.48, 0.1, 0);
    p.around(cx, cy, 0.22, (x, y) => p.set(x, y, [70, 46, 34], 8));
  }
  const things = [...caps, ...evergreens, ...bare, [10.5, 6.5, 2], [8, 13.5, 1.3]];
  return { w: p.w, h: p.h, px: p.px, caps, evergreens, bare, things };
}

/** A dungeon floored in pale flagstones (near-white, or a little cool), with dark walls and crates. */
function paleFloorDungeon(cool: boolean): HiMap {
  const p = new Canvas(24, 16, 99);
  const n = lattice(p.w, p.h, 0.6 * SC, p.rnd);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const u = x / SC;
      const v = y / SC;
      if (u < 1 || u > 23 || v < 1 || v > 15 || (Math.abs(v - 8) < 0.35 && (u < 10 || u > 13))) {
        p.set(x, y, [44, 40, 38], 8);
        continue;
      }
      const su = (u * 1.5) % 1;
      const sv = (v * 1.5 + (Math.floor(u * 1.5) % 2) * 0.5) % 1;
      const t = n(x, y);
      const c: RGB = cool ? [214 + 20 * t, 220 + 18 * t, 230 + 14 * t] : [222 + 20 * t, 220 + 20 * t, 214 + 20 * t];
      p.set(x, y, su < 0.05 || sv < 0.05 ? [c[0] * 0.62, c[1] * 0.64, c[2] * 0.68] : c, 10);
    }
  }
  for (const [cx, cy] of [
    [4, 4],
    [18, 12],
    [20, 4],
  ]) {
    p.around(cx, cy, 0.7, (x, y) => {
      const u = Math.abs((x + 0.5) / SC - cx);
      const v = Math.abs((y + 0.5) / SC - cy);
      if (u < 0.5 && v < 0.5) p.set(x, y, u > 0.44 || v > 0.44 ? INK_D : [150, 104, 60], 10);
    });
  }
  return p;
}

/** A hall floored in white-blue marble slabs with grey veins, dark walls, and potted plants. */
function marbleHall(): HiMap {
  const p = new Canvas(24, 16, 314);
  const n1 = lattice(p.w, p.h, 1.2 * SC, p.rnd);
  const n2 = lattice(p.w, p.h, 0.2 * SC, p.rnd);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const u = x / SC;
      const v = y / SC;
      if (u < 1.2 || u > 22.8 || v < 1.2 || v > 14.8) {
        p.set(x, y, [52, 48, 50], 6);
        continue;
      }
      const t = n1(x, y);
      const vein = Math.abs(n2(x, y) - 0.5) < 0.025 ? 0.72 : 1;
      p.set(x, y, [(224 + 22 * t) * vein, (230 + 18 * t) * vein, (238 + 14 * t) * vein], 6);
      if (u % 2 < 0.04 || v % 2 < 0.04) p.set(x, y, [150, 150, 158], 4);
    }
  }
  for (const [cx, cy] of [
    [4, 4],
    [20, 4],
    [4, 12],
    [20, 12],
  ]) {
    p.around(cx, cy, 0.62, (x, y, d) => p.set(x, y, d > 0.55 ? INK_D : d > 0.45 ? [140, 90, 60] : [60, 120, 56], 18));
  }
  return p;
}

/** A lawn with outlined trees in a wide cool-white paper margin, with a title and a scale in dark type. */
function paperMargin(): HiMap {
  const p = new Canvas(24, 16, 777);
  const n = lattice(p.w, p.h, 1.5 * SC, p.rnd);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const u = x / SC;
      const v = y / SC;
      const t = n(x, y);
      if (u > 4 && u < 20 && v > 3 && v < 13) p.set(x, y, [88 + 20 * t, 128 + 20 * t, 58], 20);
      else p.set(x, y, [236 + 12 * t, 240 + 10 * t, 246 + 8 * t], 6);
    }
  }
  for (const [cx, cy, r] of [
    [7, 6, 1.4],
    [12, 9, 1.8],
    [17, 6, 1.2],
  ]) {
    p.around(cx, cy, r + 0.1, (x, y, d) => p.set(x, y, d > r ? INK_D : [46, 96, 62], d > r ? 0 : 16));
  }
  for (const [x0, y0, len] of [
    [4, 1.2, 9],
    [16, 14.2, 4],
  ]) {
    for (let i = 0; i < len * 3; i++) {
      if (p.rnd() < 0.25) continue;
      p.around(x0 + i * 0.33 + 0.15, y0 + 0.25, 0.14, (x, y) => p.set(x, y, [30, 30, 36], 4));
    }
  }
  return p;
}

/**
 * Analysed at half size, box-filtered (as a browser's high-quality shrink does, roughly), by
 * analyse() or by the test-only entry that looks for snow in the picture itself.
 */
function analysedHalf(m: HiMap, entry: Analyse = analyse): SeasonAnalysis {
  const aw = m.w >> 1;
  const ah = m.h >> 1;
  return entry(shrink(m, aw, ah, "box"), aw, ah, SC / 2);
}

function bakedFull(m: HiMap, a: SeasonAnalysis, look: SeasonLook, level: 1 | 2 | 3, seed = 777): Uint8ClampedArray {
  const img = new Uint8ClampedArray(m.px);
  bake(img, m.w, m.h, { x0: 0, y0: 0, scale: 1, cell: SC, seed, look, level, a, sceneW: m.w, sceneH: m.h });
  return img;
}

/** FNV-1a of some arrays' bytes, as 8 hex digits. */
function fnv(...arrays: ArrayBufferView[]): string {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Floats per tree in SnowInfo.trees, and the kinds. */
const TREE_N = 24;
const K_CAP = 1;
const K_EVER = 2;
const K_BARE = 3;
const K_PROP = 4;

/** The trees a snowy map's analysis found: centre x, y in squares and kind. */
function snowTrees(a: SeasonAnalysis): number[][] {
  const sn = a.snow!;
  const out: number[][] = [];
  for (let t = 0; t < sn.nTrees; t++) {
    const b = t * TREE_N;
    out.push([sn.trees[b] / a.cellA, sn.trees[b + 1] / a.cellA, sn.trees[b + 3]]);
  }
  return out;
}

// What the engine made of maps with no snow before snowy maps were recognised (ALGO_VERSION 3),
// FNV-1a hashes: of the analysis, and of all twelve looks baked full size with seed 777.
const GOLDEN: Record<string, string> = {
  trees: "7204ba3e adf9bcc0",
  lawn: "3b59576c 4902eed7",
  dungeon: "244900ae b21fcdcd",
  forest: "a1351155 67919eeb",
  hires: "1bb908cb 2a105771",
  paleFloor: "467b4c74 4d10c9e7",
  coolFloor: "ec8a581a 306425ce",
  marble: "cb1db0ff 434a910d",
  paper: "4f82bf1d 5222a45f",
};

/** A plain analysis's hash, and of all twelve looks baked full size with seed 777. */
function plainHash(m: HiMap, a: SeasonAnalysis, cell: number): string {
  const bakes: Uint8ClampedArray[] = [];
  for (const look of SEASON_LOOKS) {
    for (const level of LEVELS) {
      const img = new Uint8ClampedArray(m.px);
      bake(img, m.w, m.h, { x0: 0, y0: 0, scale: 1, cell, seed: 777, look, level, a, sceneW: m.w, sceneH: m.h });
      bakes.push(img);
    }
  }
  return `${fnv(a.f, a.lab, a.crowns, a.under, new Float64Array([a.frac, a.amb, a.nCrowns]))} ${fnv(...bakes)}`;
}

describe("seasonPixels on maps with no snow", () => {
  // Maps without snow come out exactly as they did before snowy maps were recognised: the same
  // analysis and the same bytes in all twelve looks, whether the picture's own snow detection is
  // off (analyse, for now) or on (the snow test leaves them after one pass).
  const cases: [string, (entry: Analyse) => [HiMap, SeasonAnalysis, number]][] = [
    ...(
      [
        ["trees", treeMap],
        ["lawn", lawnMap],
        ["dungeon", dungeonMap],
        ["forest", forestMap],
      ] as const
    ).map(([name, make]): [string, (entry: Analyse) => [HiMap, SeasonAnalysis, number]] => [
      name,
      (entry) => {
        const p = make();
        return [{ w: p.w, h: p.h, px: p.px }, analysed(p, entry), p.cell];
      },
    ]),
    [
      "hires",
      (entry) => {
        const hi = hiResMap(true);
        return [hi, analyseHi(hi, "bilinear", entry).a, HI];
      },
    ],
    ...(
      [
        ["paleFloor", () => paleFloorDungeon(false)],
        ["coolFloor", () => paleFloorDungeon(true)],
        ["marble", marbleHall],
        ["paper", paperMargin],
      ] as const
    ).map(([name, make]): [string, (entry: Analyse) => [HiMap, SeasonAnalysis, number]] => [
      name,
      (entry) => {
        const m = make();
        return [m, analysedHalf(m, entry), SC];
      },
    ]),
  ];
  for (const [name, make] of cases) {
    it(`analyses and bakes the ${name} map exactly as before`, () => {
      for (const entry of [analyse, analysePixelSnowy]) {
        const [m, a, cell] = make(entry);
        expect(a.snow ?? null).toBeNull();
        expect(plainHash(m, a, cell)).toBe(GOLDEN[name]);
      }
    }, 30_000);
  }
});

// Kdir Topside (Vern's map, 32 x 18 squares at 108 px), reduced for the tests: the whole map at
// 20 px a square for the analysis, and for the bakes a crop of 10 x 4.5 squares from square
// (10.5, 0.5) at 54 px a square (a capped crown, bushes, an evergreen and bare trees). Both are
// sharp lanczos3 resizes of kdir-topside.webp (alpha removed; the crop from a 1728 x 972 resize at
// 567, 27), saved as lossless RGB PNGs: `png({ palette: false })`, since sharp's `effort` option
// turns palette mode on and would dither them to 256 colours.
const KDIR = { sceneW: 3456, sceneH: 1944, cell: 108, cellA: 20, x0: 1134, y0: 54, scale: 2 };
let kdirPics: Promise<[PngImage, PngImage]> | null = null;

function kdirPictures(): Promise<[PngImage, PngImage]> {
  kdirPics ??= Promise.all([
    readPng(new URL("./fixtures/snow/kdir-analysis.png", import.meta.url)),
    readPng(new URL("./fixtures/snow/kdir-crop.png", import.meta.url)),
  ]);
  return kdirPics;
}

/** How many colours a picture uses. */
function colourCount(p: PngImage): number {
  const seen = new Set<number>();
  for (let o = 0; o < p.px.length; o += 4) seen.add((p.px[o] << 16) | (p.px[o + 1] << 8) | p.px[o + 2]);
  return seen.size;
}

/** Kdir's crop baked in all twelve looks with seed 777. */
function kdirBakes(crop: PngImage, a: SeasonAnalysis): Uint8ClampedArray[] {
  const bakes: Uint8ClampedArray[] = [];
  for (const look of SEASON_LOOKS) {
    for (const level of LEVELS) {
      const img = new Uint8ClampedArray(crop.px);
      bake(img, crop.w, crop.h, { ...KDIR, seed: 777, look, level, a });
      bakes.push(img);
    }
  }
  return bakes;
}

// The snowy maps below, analysed by analyse() while the picture's own snow detection is off
// (PIXEL_SNOWY): taken for plain pictures, exactly as before snowy maps were recognised
// (ALGO_VERSION 3). Hashes as above (Kdir: its crop's bakes).
const GOLDEN_PLAIN: Record<string, string> = {
  snowy: "dc76e417 1c184385",
  kdir: "10ee0add b2debe02",
};

describe("seasonPixels while the picture's own snow detection is off", () => {
  it("is off, and analyse() takes a map painted under snow for a plain picture, exactly as before", async () => {
    expect(PIXEL_SNOWY).toBe(false);
    const map = snowyMap();
    const a = analysedHalf(map);
    expect(a.snow).toBeNull();
    expect(plainHash(map, a, SC)).toBe(GOLDEN_PLAIN.snowy);
    const [pic, crop] = await kdirPictures();
    const k = analyse(pic.px, pic.w, pic.h, KDIR.cellA);
    expect(k.snow).toBeNull();
    expect(`${fnv(k.f, k.lab, k.crowns, k.under, new Float64Array([k.frac, k.amb, k.nCrowns]))} ${fnv(...kdirBakes(crop, k))}`).toBe(GOLDEN_PLAIN.kdir);
  }, 30_000);
});

/** A snowy analysis's hash (all of SnowInfo). */
function snowHash(a: SeasonAnalysis): string {
  const sn = a.snow!;
  return fnv(sn.s, sn.tl, sn.trees, sn.grass, sn.earth, sn.snow, new Float64Array([sn.nTrees, sn.ref, sn.hasGrass, sn.grassLum, sn.frac, a.frac]));
}

// What the picture's own snow detection and the melt (ALGO_VERSION 4) made of the snowy maps when
// the detection was turned off (PIXEL_SNOWY), through the test-only analysePixelSnowy: FNV-1a of
// the analysis, and of all twelve looks baked with seed 777 (snowy: full size; Kdir: its crop).
// The melt kernels are shared with the Dungeondraft path, so these hold while it's off.
const GOLDEN_SNOWY: Record<string, string> = {
  snowy: "13a63aba 56fb0269",
  kdir: "27284aee ff4893ed",
};

describe("seasonPixels on a map painted under snow", () => {
  const map = snowyMap();
  const a = analysedHalf(map, analysePixelSnowy);

  it("analyses and bakes the synthetic snowy map exactly as when it was frozen", () => {
    expect(a.snow).not.toBeNull();
    const bakes: Uint8ClampedArray[] = [];
    for (const look of SEASON_LOOKS) for (const level of LEVELS) bakes.push(bakedFull(map, a, look, level));
    expect(`${snowHash(a)} ${fnv(...bakes)}`).toBe(GOLDEN_SNOWY.snowy);
  }, 30_000);

  it("analyses and bakes Kdir Topside exactly as when it was frozen", async () => {
    const [pic, crop] = await kdirPictures();
    // Kdir's own pixels, not a palette's (its true resizes have 12,794 and 15,375 colours).
    expect(colourCount(pic)).toBe(12794);
    expect(colourCount(crop)).toBe(15375);
    const k = analysePixelSnowy(pic.px, pic.w, pic.h, KDIR.cellA);
    expect(k.snow).not.toBeNull();
    // It found capped crowns, evergreens, bare trees and props.
    const kinds = new Set(snowTrees(k).map((t) => t[2]));
    for (const kd of [K_CAP, K_EVER, K_BARE, K_PROP]) expect(kinds.has(kd)).toBe(true);
    expect(`${snowHash(k)} ${fnv(...kdirBakes(crop, k))}`).toBe(GOLDEN_SNOWY.kdir);
  }, 30_000);

  it("recognises it, and what stands in the snow", () => {
    expect(a.snow).not.toBeNull();
    expect(outdoorFraction(a)).toBeGreaterThan(0.5);
    const trees = snowTrees(a);
    const near = (list: number[][], kind: number): void => {
      for (const [x, y] of list) {
        const t = trees.filter((q) => Math.hypot(q[0] - x, q[1] - y) < 0.6);
        expect(t.length).toBe(1);
        expect(t[0][2]).toBe(kind);
      }
    };
    near(map.caps, K_CAP);
    near(map.evergreens, K_EVER);
    near(map.bare, K_BARE);
    // Nothing else is a tree: not the patch of earth, nor the patch of grass.
    expect(trees.length).toBe(map.caps.length + map.evergreens.length + map.bare.length);
    // The same trees from a bilinear shrink.
    const b = analysePixelSnowy(shrink(map, map.w >> 1, map.h >> 1, "bilinear"), map.w >> 1, map.h >> 1, SC / 2);
    expect(b.snow).not.toBeNull();
    const kinds = (q: SeasonAnalysis): number[] => snowTrees(q).map((t) => t[2]).sort();
    expect(kinds(b)).toEqual(kinds(a));
  }, 30_000);

  it("takes it for snow only while the snow is bright", () => {
    // The whole map's snow must average a luma of at least 205: at 95.5% it still does, at 94%
    // it no longer does (and nothing else about it has changed enough to matter).
    const aw = map.w >> 1;
    const ah = map.h >> 1;
    const small = shrink(map, aw, ah, "box");
    const dimmed = (f: number): Uint8ClampedArray => {
      const px = new Uint8ClampedArray(small);
      for (let o = 0; o < px.length; o += 4) for (let c = 0; c < 3; c++) px[o + c] = Math.round(px[o + c] * f);
      return px;
    };
    expect(analysePixelSnowy(dimmed(0.955), aw, ah, SC / 2).snow).not.toBeNull();
    expect(analysePixelSnowy(dimmed(0.94), aw, ah, SC / 2).snow).toBeNull();
  }, 30_000);

  it("gives a bare tree the crowns' own green for its leaves, or Dungeondraft's when there are none", () => {
    const green = (a: SeasonAnalysis, kind: number): number[][] => {
      const sn = a.snow!;
      const out: number[][] = [];
      for (let t = 0; t < sn.nTrees; t++) if (sn.trees[t * TREE_N + 3] === kind) out.push([...sn.trees.subarray(t * TREE_N + 4, t * TREE_N + 7)]);
      return out;
    };
    // Among the crowns' greens, not the default.
    const crowns = [...green(a, K_CAP), ...green(a, K_EVER)];
    const bare = green(a, K_BARE);
    expect(bare.length).toBe(map.bare.length);
    for (const g of bare) {
      expect(g).not.toEqual([62, 98, 56]);
      for (let c = 0; c < 3; c++) {
        expect(g[c]).toBeGreaterThanOrEqual(Math.min(...crowns.map((q) => q[c])));
        expect(g[c]).toBeLessThanOrEqual(Math.max(...crowns.map((q) => q[c])));
      }
    }
    // Only bare trees on the snow: Dungeondraft's green.
    const only = snowyMap(true);
    const b = analysedHalf(only, analysePixelSnowy);
    expect(b.snow).not.toBeNull();
    expect(snowTrees(b).map((t) => t[2])).toEqual(only.bare.map(() => K_BARE));
    for (const g of green(b, K_BARE)) expect(g).toEqual([62, 98, 56]);
  }, 30_000);

  it("doesn't take a pale stone floor, a marble hall or a paper margin for snow", () => {
    for (const m of [paleFloorDungeon(false), paleFloorDungeon(true), marbleHall(), paperMargin()]) {
      for (const how of ["box", "bilinear", "nearest"] as const) {
        const q = analysePixelSnowy(shrink(m, m.w >> 1, m.h >> 1, how), m.w >> 1, m.h >> 1, SC / 2);
        expect(q.snow).toBeNull();
      }
    }
  }, 30_000);

  it("is deterministic, and the seed matters", () => {
    const b = analysedHalf(map, analysePixelSnowy);
    expect(firstDiff(b.snow!.s, a.snow!.s)).toBe(-1);
    expect(firstDiff(b.snow!.tl, a.snow!.tl)).toBe(-1);
    expect(firstDiff(b.snow!.trees, a.snow!.trees)).toBe(-1);
    for (const look of SEASON_LOOKS) {
      const x = bakedFull(map, a, look, 3, 99);
      expect(firstDiff(bakedFull(map, b, look, 3, 99), x)).toBe(-1);
      expect(firstDiff(bakedFull(map, a, look, 3, 100), x)).not.toBe(-1);
    }
  }, 30_000);

  it("bakes strips and sub-rectangles exactly like a whole pass", () => {
    const bw = 377;
    const bh = Math.round((bw * map.h) / map.w);
    const scale = map.w / bw;
    const src = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const o = (Math.floor(y * scale) * map.w + Math.floor(x * scale)) * 4;
        src.set(map.px.subarray(o, o + 4), (y * bw + x) * 4);
      }
    }
    for (const look of SEASON_LOOKS) {
      for (const level of LEVELS) {
        const opts = { cell: SC, seed: 4242, look, level, a, sceneW: map.w, sceneH: map.h, scale };
        const whole = new Uint8ClampedArray(src);
        bake(whole, bw, bh, { ...opts, x0: 0, y0: 0 });
        const strips = new Uint8ClampedArray(src);
        for (let y = 0, s = 0; y < bh; s++) {
          const rows = Math.min([23, 1, 57, 7][s % 4], bh - y);
          bake(strips.subarray(y * bw * 4, (y + rows) * bw * 4), bw, rows, { ...opts, x0: 0, y0: y * scale });
          y += rows;
        }
        expect(firstDiff(strips, whole)).toBe(-1);
        const rx = 101;
        const ry = 57;
        const rw = 90;
        const rh = 70;
        const rect = new Uint8ClampedArray(rw * rh * 4);
        for (let y = 0; y < rh; y++) rect.set(src.subarray(((ry + y) * bw + rx) * 4, ((ry + y) * bw + rx + rw) * 4), y * rw * 4);
        bake(rect, rw, rh, { ...opts, x0: rx * scale, y0: ry * scale });
        for (let y = 0; y < rh; y++) {
          expect(firstDiff(rect.subarray(y * rw * 4, (y + 1) * rw * 4), whole.subarray(((ry + y) * bw + rx) * 4, ((ry + y) * bw + rx + rw) * 4))).toBe(-1);
        }
      }
    }
  }, 30_000);

  // Where nothing stands, the snow as drawn: open ground.
  const open = (u: number, v: number): boolean => map.things.every(([x, y, r]) => Math.hypot(u - x, v - y) > r + 0.6);
  const lum = (img: Uint8ClampedArray, x: number, y: number): number => {
    const o = (y * map.w + x) * 4;
    return 0.299 * img[o] + 0.587 * img[o + 1] + 0.114 * img[o + 2];
  };

  it("melts the snow into grass in summer, keeps half of it early in spring and all of it in winter, and strews leaves in autumn", () => {
    const share = (img: Uint8ClampedArray, test: (q: RGB) => boolean): number => {
      let n = 0;
      let k = 0;
      for (let y = 0; y < map.h; y += 3) {
        for (let x = 0; x < map.w; x += 3) {
          if (!open((x + 0.5) / SC, (y + 0.5) / SC)) continue;
          n++;
          const o = (y * map.w + x) * 4;
          if (test([img[o], img[o + 1], img[o + 2]])) k++;
        }
      }
      return k / n;
    };
    const snowy = (q: RGB): boolean => Math.min(...q) > 160 && Math.max(...q) - Math.min(...q) < 0.25 * Math.max(...q);
    const green = (q: RGB): boolean => hue(q) > 60 && hue(q) < 170 && Math.max(...q) - Math.min(...q) > 0.2 * Math.max(...q);
    expect(share(map.px, snowy)).toBeGreaterThan(0.95);
    for (const level of LEVELS) expect(share(bakedFull(map, a, "winter", level), snowy)).toBeGreaterThan(0.95);
    expect(share(bakedFull(map, a, "summer", 1), green)).toBeGreaterThan(0.95);
    expect(share(bakedFull(map, a, "summer", 1), snowy)).toBeLessThan(0.01);
    const budding = share(bakedFull(map, a, "spring", 1), snowy);
    expect(budding).toBeGreaterThan(0.25);
    expect(budding).toBeLessThan(0.65);
    expect(share(bakedFull(map, a, "spring", 2), snowy)).toBeLessThan(0.1);
    expect(share(bakedFull(map, a, "spring", 3), snowy)).toBeLessThan(0.01);
    // Autumn: fallen leaves (reds, oranges, golds) on the new ground, more as the season goes on.
    const leaf = (q: RGB): boolean => hue(q) < 50 && Math.max(...q) - Math.min(...q) > 0.45 * Math.max(...q);
    const fallen = LEVELS.map((level) => share(bakedFull(map, a, "autumn", level), leaf));
    expect(fallen[0]).toBeGreaterThan(0.001);
    expect(fallen[2]).toBeGreaterThan(2 * fallen[0]);
  }, 30_000);

  it("keeps the grid baked into the picture straight and visible through the melt", () => {
    for (const [look, level] of [
      ["summer", 1],
      ["autumn", 2],
      ["spring", 3],
    ] as const) {
      const img = bakedFull(map, a, look, level);
      let n = 0;
      let dark = 0;
      for (let k = 1; k < 24; k++) {
        const x = k * SC;
        for (let y = 2; y < map.h - 2; y++) {
          // The dotted line's pixels, over open snow.
          if (y % 6 >= 3 || y % SC === 0 || !open(x / SC, (y + 0.5) / SC)) continue;
          n++;
          const side = (lum(img, x - 2, y) + lum(img, x + 2, y)) / 2;
          if (lum(img, x, y) < 0.94 * side) dark++;
        }
      }
      expect(n).toBeGreaterThan(1000);
      expect(dark / n).toBeGreaterThan(0.9);
    }
  }, 30_000);

  it("never changes ink or alpha", () => {
    const m = { ...map, px: new Uint8ClampedArray(map.px) };
    for (let i = 3; i < m.px.length; i += 4 * 97) m.px[i] = 128;
    const inked: number[] = [];
    for (let k = 0; k < m.w * m.h; k++) if (Math.max(m.px[k * 4], m.px[k * 4 + 1], m.px[k * 4 + 2]) < 32) inked.push(k);
    expect(inked.length).toBeGreaterThan(5000);
    for (const look of SEASON_LOOKS) {
      for (const level of LEVELS) {
        const img = bakedFull(m, a, look, level);
        for (const k of inked) for (let ch = 0; ch < 3; ch++) if (img[k * 4 + ch] !== m.px[k * 4 + ch]) throw new Error(`ink changed at ${k} in ${look} ${level}`);
        for (let i = 3; i < img.length; i += 4) if (img[i] !== m.px[i]) throw new Error(`alpha changed at ${i}`);
      }
    }
  }, 30_000);

  // The owner's rule for autumn trees: "all trees should not turn red, they should be a amalgam of
  // red yellow green, and less foliage" as the season goes on.
  it("grows leaves on the bare trees, and in autumn turns each a mottled mix, never all red, thinning", () => {
    // The foliage: what a bake with the trees forgotten doesn't draw.
    const noTrees: SeasonAnalysis = { ...a, snow: { ...a.snow!, tl: new Uint16Array(a.aw * a.ah) } };
    const foliage = (look: SeasonLook, level: 1 | 2 | 3): { n: number; green: number; yellow: number; orange: number; red: number }[] => {
      const img = bakedFull(map, a, look, level);
      const ref = bakedFull(map, noTrees, look, level);
      return map.bare.map(([cx, cy, R]) => {
        const t = { n: 0, green: 0, yellow: 0, orange: 0, red: 0 };
        for (let y = Math.floor((cy - R) * SC); y < (cy + R) * SC; y++) {
          for (let x = Math.floor((cx - R) * SC); x < (cx + R) * SC; x++) {
            if (Math.hypot((x + 0.5) / SC - cx, (y + 0.5) / SC - cy) > R) continue;
            const o = (y * map.w + x) * 4;
            const q: RGB = [img[o], img[o + 1], img[o + 2]];
            if (Math.abs(q[0] - ref[o]) + Math.abs(q[1] - ref[o + 1]) + Math.abs(q[2] - ref[o + 2]) < 40) continue;
            if (Math.max(...q) - Math.min(...q) < 0.25 * Math.max(...q)) continue;
            t.n++;
            const h = hue(q);
            if (h >= 62 && h < 170) t.green++;
            else if (h >= 38 && h < 62) t.yellow++;
            else if (h >= 18 && h < 38) t.orange++;
            else if (h < 18 || h >= 330) t.red++;
          }
        }
        return t;
      });
    };
    // Summer: every bare tree in full green leaf.
    const summer = foliage("summer", 1);
    for (const t of summer) {
      expect(t.n).toBeGreaterThan(0.5 * Math.PI * SC * SC);
      expect(t.green / t.n).toBeGreaterThan(0.9);
    }
    const autumn = LEVELS.map((level) => foliage("autumn", level));
    for (const [i, trees] of autumn.entries()) {
      for (const t of trees) {
        const s = [t.green, t.yellow, t.orange, t.red].map((v) => v / t.n);
        // An amalgam: several colours on every tree, some green left, red never dominant.
        expect(s.filter((v) => v > 0.04).length).toBeGreaterThanOrEqual(3);
        expect(s[0]).toBeGreaterThan(i === 2 ? 0.02 : 0.08);
        expect(s[3]).toBeLessThan(0.4);
        expect(Math.max(...s)).toBeLessThan(i === 0 ? 0.9 : 0.75);
      }
    }
    // Turning is mostly green, with the first colours.
    const sum = (trees: { n: number; green: number }[], k: "n" | "green"): number => trees.reduce((v, t) => v + t[k], 0);
    expect(sum(autumn[0], "green") / sum(autumn[0], "n")).toBeGreaterThan(0.45);
    // Less foliage as the season goes on: mostly bare branches by late autumn.
    for (const [i, t] of autumn[2].entries()) {
      expect(t.n).toBeLessThan(0.6 * autumn[0][i].n);
      expect(autumn[1][i].n).toBeLessThan(autumn[0][i].n);
    }
  }, 30_000);
});

describe("seasonPixels helpers for the Dungeondraft path", () => {
  it("measures the snow's tone and colours over the masks it's given", () => {
    const w = 120;
    const h = 80;
    const px = new Uint8ClampedArray(w * h * 4);
    const open = new Uint8Array(w * h);
    const grass = new Uint8Array(w * h);
    const earth = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        const c: RGB = x < 20 ? [96, 140, 70] : x < 40 ? [120, 100, 80] : [230, 236, 246];
        px.set([c[0], c[1], c[2], 255], k * 4);
        if (x < 20) grass[k] = 1;
        else if (x < 40) earth[k] = 1;
        else open[k] = 1;
      }
    }
    const c = snowColours(px, w, h, 10, { open, grass, earth });
    const snowLum = Math.floor((299 * 230 + 587 * 236 + 114 * 246 + 500) / 1000);
    expect(c.ref).toBeCloseTo(snowLum / 255, 9);
    expect([...c.snow]).toEqual([230, 236, 246]);
    expect(c.hasGrass).toBe(1);
    expect([...c.grass]).toEqual([96, 140, 70]);
    expect([...c.earth]).toEqual([120, 100, 80]);
    // Out on the open snow, its tone is its own luma.
    for (let y = 5; y < h - 5; y++) for (let x = 60; x < w - 5; x++) expect(c.tone[y * w + x]).toBe(snowLum);
    // Too little grass or earth: the defaults.
    const none = snowColours(px, w, h, 30, { open, grass: new Uint8Array(w * h), earth: new Uint8Array(w * h) });
    expect(none.hasGrass).toBe(0);
    expect([...none.earth]).toEqual([118, 100, 80]);
    // Grass from half a square up (50 pixels at 10 a square), earth from a whole square (100).
    const band = (x0: number, n: number): Uint8Array => {
      const m = new Uint8Array(w * h);
      for (let i = 0; i < n; i++) m[(i % h) * w + x0 + Math.floor(i / h)] = 1;
      return m;
    };
    for (const [n, has] of [
      [49, 0],
      [50, 1],
    ] as const) {
      const g = snowColours(px, w, h, 10, { open, grass: band(0, n), earth: new Uint8Array(w * h) });
      expect(g.hasGrass).toBe(has);
      expect([...g.grass]).toEqual(has ? [96, 140, 70] : [98, 128, 60]);
    }
    for (const [n, has] of [
      [99, 0],
      [100, 1],
    ] as const) {
      const e = snowColours(px, w, h, 10, { open, grass: new Uint8Array(w * h), earth: band(20, n) });
      expect([...e.earth]).toEqual(has ? [120, 100, 80] : [118, 100, 80]);
    }
  });

  it("finds a bare tree's reach along its strokes, in the directions they go", () => {
    const w = 160;
    const h = 160;
    const cA = 20;
    const cx = 80;
    const cy = 80;
    const stroke = new Uint8Array(w * h);
    // Eight branches two squares long, along every other reach direction (design 2.9).
    const dirOf = (k: number): [number, number] => {
      const p = ((k & 3) + 0.5) / 4;
      const v: [number, number] = k < 4 ? [1 - p, p] : k < 8 ? [-p, 1 - p] : k < 12 ? [p - 1, -p] : [p, p - 1];
      const n = Math.hypot(v[0], v[1]);
      return [v[0] / n, v[1] / n];
    };
    for (let k = 0; k < TREE_DIRS; k += 2) {
      const [ux, uy] = dirOf(k);
      for (let t = 3; t <= 2 * cA; t += 0.25) stroke[Math.floor(cy + uy * t) * w + Math.floor(cx + ux * t)] = 255;
    }
    const reach = new Float64Array(TREE_DIRS);
    const r = bareReach(stroke, null, 0, w, 0, 0, w - 1, h - 1, cx, cy, cA, reach);
    expect(r.n).toBeGreaterThan(8 * 30);
    expect(r.R).toBeGreaterThan(1.5 * cA);
    expect(r.R).toBeLessThanOrEqual(2 * cA);
    expect(r.radial).toBeGreaterThan(1.2);
    expect(r.dirs).toBe(8);
    expect(r.hit).toBe(8);
    for (let k = 0; k < TREE_DIRS; k++) {
      if (k % 2 === 0) {
        expect(reach[k]).toBeGreaterThan(1.5 * cA);
        expect(reach[k]).toBeLessThanOrEqual(1.25 * r.R);
      } else expect(reach[k]).toBeCloseTo(0.35 * r.R, 9);
    }
    // Only the strokes labelled l count.
    const lab = new Int32Array(w * h).fill(2);
    expect(bareReach(stroke, lab, 1, w, 0, 0, w - 1, h - 1, cx, cy, cA, reach).n).toBe(0);
    expect(bareReach(stroke, lab, 2, w, 0, 0, w - 1, h - 1, cx, cy, cA, reach).n).toBe(r.n);
    // A single stroke pixel meets a direction (design 2.5's presence test), three make its shape.
    const dots = new Uint8Array(w * h);
    for (let k = 0; k < 6; k++) {
      const [ux, uy] = dirOf(2 * k);
      dots[Math.floor(cy + uy * cA) * w + Math.floor(cx + ux * cA)] = 1;
    }
    const d = bareReach(dots, null, 0, w, 0, 0, w - 1, h - 1, cx, cy, cA, reach);
    expect([d.n, d.hit, d.dirs]).toEqual([6, 6, 0]);
  });

  it("keeps a bare tree's box to the picture, however far past its edge it runs", () => {
    // Strokes down the left and right edges; a box round a tree at either edge runs past it, and
    // must not wrap round into the row above or below (the strokes at the other edge).
    const w = 50;
    const h = 50;
    const stroke = new Uint8Array(w * h);
    for (let y = 20; y <= 30; y++) for (const x of [0, 1, 2, 47, 48, 49]) stroke[y * w + x] = 1;
    const reach = new Float64Array(TREE_DIRS);
    const at = (x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): BareReach =>
      bareReach(stroke, null, 0, w, x0, y0, x1, y1, cx, cy, 10, reach);
    const inside = (cx: number): BareReach => at(Math.max(0, Math.floor(cx) - 10), 15, Math.min(w - 1, Math.floor(cx) + 10), 35, cx, 25);
    for (const cx of [0.5, 49.5]) {
      const r = at(Math.floor(cx) - 10, -5, Math.floor(cx) + 10, h + 5, cx, 25);
      expect(r.n).toBe(33);
      expect(r).toEqual(inside(cx));
    }
    // A box wholly off the picture holds nothing.
    expect(at(60, 60, 70, 70, 65, 65).n).toBe(0);
    expect(at(-20, 20, -5, 30, -10, 25).n).toBe(0);
  });
});

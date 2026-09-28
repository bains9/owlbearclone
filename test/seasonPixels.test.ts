import { describe, expect, it } from "vitest";
import { SEASON_LOOKS } from "../src/shared/types";
import type { SeasonLook } from "../src/shared/types";
import { ALGO_VERSION, analyse, bake, outdoorFraction, seedFrom } from "../src/client/room/seasonPixels";
import type { SeasonAnalysis } from "../src/client/room/seasonPixels";

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

function analysed(p: Pic): SeasonAnalysis {
  const { rgba, aw, ah } = half(p);
  return analyse(rgba, aw, ah, p.cell / 2);
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

function analyseHi(m: HiMap, how: Shrink): HiResult {
  // The app's analysis size: about 20 px a square, 512-1024 px across.
  const long = Math.max(m.w, m.h);
  const kA = Math.min(1, Math.min(1024 / long, Math.max(512 / long, 20 / HI)));
  const aw = Math.round(m.w * kA);
  const ah = Math.round(m.h * kA);
  const cA = HI * kA;
  const a = analyse(shrink(m, aw, ah, how), aw, ah, cA);
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

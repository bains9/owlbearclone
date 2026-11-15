// Rock from darkness in the 3D view (view3d.ts): a cave or dungeon map drawn on black or dark stone
// (its rooms, tunnels and caverns, and solid black or Dungeondraft's dark stone round them, as most
// map makers draw underground) stands that up as solid rock, a wall's height, so its tunnels and
// rooms are walled in 3D without walls loaded from a file. Found from the map as painted (the
// picture and the built map, without the grid, drawings, the dark or the fog): the colour of its
// outer edge when that's dark and greyish, else near-black, covering a fair share of the map, less
// specks (a shadow, a crack) and with its own specks filled (a label written on it). As with walls, a player sees a rock face only where they've seen the ground in
// front of it, and its top only near there; the GM sees all of it. Kept apart from three.js, so
// it's tested.

import { WALL_SEEN, brightnessAt, shadeOf, wallTint, type CoverMap, type PaintMap, type WallMesh } from "./view3dModel";

/** A pixel this dark (its brightest channel, 0-255) is black: rock. */
export const ROCK_DARK = 40;
/** A map is drawn on black when at least this share of it is. */
export const ROCK_SHARE = 0.08;
/** Black smaller than this (squares) is a shadow or a crack, not rock; and a light speck smaller than this in black is a label on it. */
const ROCK_SMALLEST = 2;
const HOLE_SMALLEST = 1.5;
/** A rock's top shows to a player this far (squares) from ground they've seen. */
const TOP_REACH = 1.5;
/** Rock where the picture paints nothing round it. */
const STONE: readonly [number, number, number] = [0.42, 0.4, 0.38];

/** Which of a map's paint pixels are rock (1) and which aren't (0), and where they are. */
export interface RockMask {
  /** The paint map's place: scene units of its top-left, and its pixels a scene unit. */
  x0: number;
  y0: number;
  k: number;
  w: number;
  h: number;
  rock: Uint8Array;
  /** Where the picture is (outside it, the map's extended room: neither rock nor ground). */
  inside: Uint8Array;
}

/**
 * The map's rock, or null when it isn't drawn on rock (too little of it, or nearly all of it).
 * Rock is what the map's outer edge is drawn in, when that's dark and greyish (Dungeondraft's
 * dark stone round a dungeon, or plain black), and wherever else the picture is near that colour
 * (softened a little first, so a stone texture reads as one); else near-black alone. `picture`:
 * the picture's rectangle in scene units (0, 0, its width, its height); `cell`: a square in scene units.
 */
export function rockMask(paint: PaintMap | null, picture: { w: number; h: number }, cell: number): RockMask | null {
  if (!paint || !(paint.k > 0) || !(cell > 0)) return null;
  const { w, h, rgba, k } = paint;
  const n = w * h;
  const rock = new Uint8Array(n), inside = new Uint8Array(n);
  let pic = 0;
  for (let j = 0; j < h; j++) {
    const sy = paint.y0 + (j + 0.5) / k;
    for (let i = 0; i < w; i++) {
      const sx = paint.x0 + (i + 0.5) / k;
      if (sx < 0 || sy < 0 || sx > picture.w || sy > picture.h) continue;
      if (rgba[(j * w + i) * 4 + 3] < 128) continue;
      inside[j * w + i] = 1;
      pic++;
    }
  }
  if (!pic) return null;
  const soft = softened(rgba, inside, w, h);
  const { colour, reach } = rockColour(soft, inside, w, h);
  for (let p = 0; p < n; p++) {
    if (!inside[p]) continue;
    const q = p * 3;
    if (Math.max(Math.abs(soft[q] - colour[0]), Math.abs(soft[q + 1] - colour[1]), Math.abs(soft[q + 2] - colour[2])) < reach) rock[p] = 1;
  }
  const perSquare = (k * cell) ** 2;
  // Specks of rock are shadows; specks of floor in rock are labels.
  dropSmall(rock, inside, w, h, 1, Math.max(4, ROCK_SMALLEST * perSquare));
  dropSmall(rock, inside, w, h, 0, Math.max(2, HOLE_SMALLEST * perSquare));
  let dark = 0;
  for (let p = 0; p < n; p++) dark += rock[p];
  const share = dark / pic;
  return share >= ROCK_SHARE && share <= 1 - ROCK_SHARE ? { x0: paint.x0, y0: paint.y0, k, w, h, rock, inside } : null;
}

/** The picture's colours (rgb, 0-255) averaged over each pixel and its 8 neighbours inside it. */
function softened(rgba: Uint8ClampedArray, inside: Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = j * w + i;
      if (!inside[p]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const y = j + dj;
        if (y < 0 || y >= h) continue;
        for (let di = -1; di <= 1; di++) {
          const x = i + di;
          if (x < 0 || x >= w || !inside[y * w + x]) continue;
          const q = (y * w + x) * 4;
          r += rgba[q];
          g += rgba[q + 1];
          b += rgba[q + 2];
          c++;
        }
      }
      out.set([r / c, g / c, b / c], p * 3);
    }
  }
  return out;
}

/** Brighter than this (0-255) or more coloured than this, a map's edge isn't rock: it's ground. */
const EDGE_DARKEST = 110;
const EDGE_GREYEST = 45;

/**
 * The rock's colour and how far from it a pixel may be: the middle colour of the picture's outer
 * edge when that's dark and greyish, with room for its texture; else black.
 */
function rockColour(soft: Float32Array, inside: Uint8Array, w: number, h: number): { colour: number[]; reach: number } {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.015));
  const ch: number[][] = [[], [], []];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = j * w + i;
      if (!inside[p]) continue;
      // The band nearest the picture's edge (where inside meets outside or the paint's own edge).
      const near = i < band || j < band || i >= w - band || j >= h - band ||
        !inside[Math.max(0, j - band) * w + i] || !inside[Math.min(h - 1, j + band) * w + i] ||
        !inside[j * w + Math.max(0, i - band)] || !inside[j * w + Math.min(w - 1, i + band)];
      if (!near) continue;
      for (let c = 0; c < 3; c++) ch[c].push(soft[p * 3 + c]);
    }
  }
  const black = { colour: [0, 0, 0], reach: ROCK_DARK };
  if (ch[0].length < 8) return black;
  const mid = ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
  const lum = 0.3 * mid[0] + 0.59 * mid[1] + 0.11 * mid[2];
  if (lum >= EDGE_DARKEST || Math.max(...mid) - Math.min(...mid) >= EDGE_GREYEST) return black;
  // The edge's own spread: how far its middle half lies from its middle colour.
  const spread = Math.max(...ch.map((v, c) => Math.max(Math.abs(v[v.length >> 2] - mid[c]), Math.abs(v[(3 * v.length) >> 2] - mid[c]))));
  return { colour: mid, reach: Math.max(ROCK_DARK, Math.min(70, spread * 2.5 + 18)) };
}

/** Turns connected patches of `value` (4-neighbours, inside the picture) smaller than `least` pixels into the other value. */
function dropSmall(m: Uint8Array, inside: Uint8Array, w: number, h: number, value: 0 | 1, least: number): void {
  const seen = new Uint8Array(m.length);
  const stack: number[] = [];
  const patch: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (seen[s] || !inside[s] || m[s] !== value) continue;
    patch.length = 0;
    stack.push(s);
    seen[s] = 1;
    let edge = false;
    while (stack.length) {
      const p = stack.pop()!;
      patch.push(p);
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || seen[q] || !inside[q] || m[q] !== value) {
          if (q >= 0 && !inside[q]) edge = true;
          continue;
        }
        seen[q] = 1;
        stack.push(q);
      }
    }
    // Black running off the picture's edge is rock however little of it shows.
    if (patch.length < least && !(value === 1 && edge)) for (const p of patch) m[p] = 1 - value;
  }
}

/**
 * The rock's faces, in squares: an upright face along every edge between rock and ground (marching
 * squares over the mask, so edges run smooth rather than in steps), `height` squares tall, in the
 * colour the picture paints the ground at its foot (a cave's drawn rim). A player sees a face only
 * where the ground in front of it has been seen; the GM (`all`) sees every one.
 */
export function rockSides(m: RockMask, cell: number, height: number, cover: CoverMap | null, all: boolean, paint: PaintMap | null): WallMesh {
  const position: number[] = [], normal: number[] = [], color: number[] = [];
  const { w, h, k } = m;
  // Outside the picture counts as ground: rock running to the picture's edge shows its side there, like a model's.
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : m.inside[j * w + i] && m.rock[j * w + i] ? 1 : 0);
  // Pixel-centre coordinates to scene units.
  const sx = (i: number) => m.x0 + (i + 0.5) / k, sy = (j: number) => m.y0 + (j + 0.5) / k;
  const px = 1 / k;
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    // Which side is ground: a step to one side of the edge's middle.
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    let nx = -(by - ay), ny = bx - ax;
    const len = Math.hypot(nx, ny);
    if (!(len > 0)) return;
    nx /= len;
    ny /= len;
    const gi = Math.floor((mx + nx * px * 0.7 - m.x0) * k), gj = Math.floor((my + ny * px * 0.7 - m.y0) * k);
    if (at(gi, gj)) {
      nx = -nx;
      ny = -ny;
      [ax, ay, bx, by] = [bx, by, ax, ay];
    }
    const fx = mx + nx * px * 1.2, fy = my + ny * px * 1.2;
    const light = brightnessAt(cover, fx, fy);
    if (!all && light < WALL_SEEN) return;
    const s = shadeOf(light);
    const c = paintAtGround(paint, fx, fy, nx * px, ny * px);
    // Half the ground's colour at its foot, half stone, so neighbouring faces don't flicker with the rim's every speck.
    const base = c ? wallTint(c).map((v, q) => (v + STONE[q]) / 2) : STONE;
    const col = [base[0] * 0.85 * s, base[1] * 0.85 * s, base[2] * 0.85 * s];
    // Upright, facing the ground: a then b along it, ground on the left seen from above.
    const A = [ax / cell, 0, ay / cell], B = [bx / cell, 0, by / cell];
    const At = [ax / cell, height, ay / cell], Bt = [bx / cell, height, by / cell];
    const tri = (p: number[], q: number[], r: number[]) => {
      for (const v of [p, q, r]) {
        position.push(v[0], v[1], v[2]);
        normal.push(nx, 0, ny);
        color.push(col[0], col[1], col[2]);
      }
    };
    // Wound so the face's front is towards (nx, ny).
    const u = [B[0] - A[0], 0, B[2] - A[2]], v = [0, height, 0];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (cr[0] * nx + cr[2] * ny >= 0) {
      tri(A, B, Bt);
      tri(A, Bt, At);
    } else {
      tri(A, Bt, B);
      tri(A, At, Bt);
    }
  };
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const index = a | (b << 1) | (c << 2) | (d << 3);
      if (index === 0 || index === 15) continue;
      // Edge middles: top (a-b), right (b-c), bottom (d-c), left (a-d).
      const x0 = sx(i), x1 = sx(i + 1), y0 = sy(j), y1 = sy(j + 1);
      const T = [(x0 + x1) / 2, y0], R = [x1, (y0 + y1) / 2], Bm = [(x0 + x1) / 2, y1], L = [x0, (y0 + y1) / 2];
      const seg = (p: number[], q: number[]) => edge(p[0], p[1], q[0], q[1]);
      switch (index) {
        case 1: case 14: seg(L, T); break;
        case 2: case 13: seg(T, R); break;
        case 3: case 12: seg(L, R); break;
        case 4: case 11: seg(R, Bm); break;
        case 5: seg(L, T); seg(R, Bm); break;
        case 6: case 9: seg(T, Bm); break;
        case 7: case 8: seg(L, Bm); break;
        case 10: seg(T, R); seg(L, Bm); break;
      }
    }
  }
  return { position: Float32Array.from(position), normal: Float32Array.from(normal), color: Float32Array.from(color) };
}

/** The colour of the ground at the foot of a rock face: the average of what isn't black a few steps out from it and to either side. */
function paintAtGround(paint: PaintMap | null, x: number, y: number, dx: number, dy: number): [number, number, number] | null {
  if (!paint) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (let s = 0; s < 4; s++) {
    for (const side of [-2, 0, 2]) {
      const c = fetch(paint, x + dx * s - dy * side, y + dy * s + dx * side);
      if (!c || Math.max(c[0], c[1], c[2]) * 255 < ROCK_DARK) continue;
      r += c[0];
      g += c[1];
      b += c[2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

function fetch(paint: PaintMap, x: number, y: number): [number, number, number] | null {
  const c = Math.floor((x - paint.x0) * paint.k), r = Math.floor((y - paint.y0) * paint.k);
  if (c < 0 || r < 0 || c >= paint.w || r >= paint.h) return null;
  const i = (r * paint.w + c) * 4;
  return [paint.rgba[i] / 255, paint.rgba[i + 1] / 255, paint.rgba[i + 2] / 255];
}

/**
 * The rock's top as a picture over the mask (rgba, the mask's size): dark stone where rock shows,
 * see-through elsewhere. A player's shows only within TOP_REACH squares of ground they've seen.
 */
export function rockTop(m: RockMask, cell: number, cover: CoverMap | null, all: boolean): Uint8ClampedArray<ArrayBuffer> {
  const { w, h, k } = m;
  const out = new Uint8ClampedArray(w * h * 4);
  let near: Uint8Array | null = null;
  if (!all) {
    // Ground this page has seen, grown by TOP_REACH (a box, both ways).
    const seen = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const p = j * w + i;
        if (m.rock[p] || !m.inside[p]) continue;
        if (brightnessAt(cover, m.x0 + (i + 0.5) / k, m.y0 + (j + 0.5) / k) >= WALL_SEEN) seen[p] = 1;
      }
    }
    near = grow(seen, w, h, Math.max(1, Math.round(TOP_REACH * cell * k)));
  }
  for (let p = 0; p < w * h; p++) {
    if (!m.rock[p] || !m.inside[p] || (near && !near[p])) continue;
    const x = p % w, y = (p - x) / w;
    const v = 26 + ((x * 7 + y * 13) % 11) + ((x * 3 + y * 5) % 7);
    out.set([v, v - 1, v - 3, 255], p * 4);
  }
  return out;
}

/** A mask grown by `r` pixels each way (a box). */
function grow(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const rows = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    let last = -Infinity;
    for (let i = 0; i < w; i++) {
      if (m[j * w + i]) last = i;
      if (i - last <= r) rows[j * w + i] = 1;
    }
    last = Infinity;
    for (let i = w - 1; i >= 0; i--) {
      if (m[j * w + i]) last = i;
      if (last - i <= r) rows[j * w + i] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w; i++) {
    let last = -Infinity;
    for (let j = 0; j < h; j++) {
      if (rows[j * w + i]) last = j;
      if (j - last <= r) out[j * w + i] = 1;
    }
    last = Infinity;
    for (let j = h - 1; j >= 0; j--) {
      if (rows[j * w + i]) last = j;
      if (last - j <= r) out[j * w + i] = 1;
    }
  }
  return out;
}

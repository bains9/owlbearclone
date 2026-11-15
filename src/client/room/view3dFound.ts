// Things found in a picture, for the 3D view (view3d.ts): on a map that's just a picture (no map
// data from Dungeon or a Dungeondraft project file), the trees, bushes, bare trees and rocks it
// paints on open ground are found by their colour against the ground round them, and stand up
// where they're painted, as big as they're painted, in their colours; and the painted ones come off
// the floor under them (view3dClearing.ts), as with map data. Found from the map as painted (the
// picture and the built map, without the grid, drawings, the dark or the fog), at its paint size
// (about 10 pixels a square). What's found:
// - a green patch, round and outlined, a square or more across: a tree (an evergreen when dark or
//   spiky, a leafy tree when not); smaller, a bush;
// - a brown or dark tangle (thin, spread out): a bare tree;
// - a grey lump, round: a rock;
// - a long grey band with a dark outline, half a square to a square and a half wide and three or
//   more long: a cliff (a ledge's rock face), standing up along its middle as Dungeondraft's do
//   (view3dCliffs.ts).
// Not found: anything bigger than three squares across (a building, a yard, a wood grown into one
// patch), long and thin (a path, a cliff, a wall, a river), red or yellow (blood, hay, fire), and
// what's the ground's own colour (snow on a snowy rock). Kept apart from three.js, so it's tested.

import type { PaintMap } from "./view3dModel";
import type { Object3d, Shape } from "./view3dObjects";
import type { Hole } from "./view3dClearing";
import type { Cliff3d } from "./view3dCliffs";

/** A thing found in the picture: what it stands up as, and its painted footprint (for taking it off the floor). */
export interface Found {
  shape: Shape;
  /** Its middle, in scene units. */
  x: number;
  y: number;
  /** Across and down, in squares. */
  w: number;
  d: number;
  /** How far it reaches from its middle in each of the 16 reach directions (dd/raster.ts REACH_DIRS), in scene units. */
  r: Float64Array;
}

/** A pixel this far (0-255, its most different channel) from the ground round it is something on the ground; or this much darker (a thin branch). */
const APART = 55;
const DARKER = 35;
/** Smaller than this (square squares) is a speck; bigger than this, not a tree or a rock. */
const SMALLEST = 0.15;
const BIGGEST = 9;
/** But a round green crown up to this big is a great tree. */
const BIG_TREE = 30;
/** A leafy tree is this big (square squares) or more, a pine (dark or spiky) this big; smaller green things are bushes. */
const TREE = 0.5;
const PINE = 0.3;
/** Longer than this many times its width, it's a path, a wall, a cliff or a log. */
const LONGEST = 3;
/** The ground's colour is found over blocks this many squares across. */
const BLOCK = 2;

/** The 16 reach directions' angles (radians, 0..2pi, y down), as dd/raster.ts REACH_DIRS. */
const REACH_ANGLES: Float64Array = (() => {
  const out = new Float64Array(16);
  for (let k = 0; k < 16; k++) {
    const p = ((k & 3) + 0.5) / 4;
    const q = k >> 2;
    const x = q === 0 ? 1 - p : q === 1 ? -p : q === 2 ? p - 1 : p;
    const y = q === 0 ? p : q === 1 ? 1 - p : q === 2 ? -p : p - 1;
    const a = Math.atan2(y, x);
    out[k] = a < 0 ? a + 2 * Math.PI : a;
  }
  return out;
})();

/** The reach direction nearest an angle. */
function nearestReach(a: number): number {
  let best = 0, bestD = Infinity;
  for (let k = 0; k < 16; k++) {
    let d = Math.abs(a - REACH_ANGLES[k]);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * The trees, bushes, bare trees and rocks a picture paints, in scene units. `picture`: its
 * rectangle in scene units (0, 0, its width, its height); `cell`: a square in scene units.
 */
export function findThings(paint: PaintMap | null, picture: { w: number; h: number }, cell: number, cliffs?: Cliff3d[]): Found[] {
  if (!paint || !(paint.k > 0) || !(cell > 0)) return [];
  const { w, h, k, rgba } = paint;
  const s = k * cell; // paint pixels a square
  if (s < 3) return []; // too coarse to tell a tree from a bush
  const inside = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const sy = paint.y0 + (j + 0.5) / k;
    for (let i = 0; i < w; i++) {
      const sx = paint.x0 + (i + 0.5) / k;
      if (sx >= 0 && sy >= 0 && sx <= picture.w && sy <= picture.h && rgba[(j * w + i) * 4 + 3] >= 128) inside[j * w + i] = 1;
    }
  }
  const ground = groundColours(rgba, inside, w, h, Math.max(4, Math.round(BLOCK * s)));
  // What stands out from the ground.
  const on = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!inside[p]) continue;
    const q = p * 4, g = p * 3;
    const d = Math.max(Math.abs(rgba[q] - ground[g]), Math.abs(rgba[q + 1] - ground[g + 1]), Math.abs(rgba[q + 2] - ground[g + 2]));
    const darker = 0.3 * (ground[g] - rgba[q]) + 0.59 * (ground[g + 1] - rgba[q + 1]) + 0.11 * (ground[g + 2] - rgba[q + 2]);
    if (d > APART || darker > DARKER) on[p] = 1;
  }
  // Pieces a pixel apart are one thing (a bare tree's branches, a crown broken by snow on it).
  const joined = grown(on, w, h);
  const out: Found[] = [];
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || seen[start]) continue;
    members.length = 0;
    stack.push(start);
    seen[start] = 1;
    let edge = 0, rimLum = 0, coreLum = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      // Its own pixels count; the joins between them only join.
      if (on[p]) {
        members.push(p);
        let border = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !on[ny * w + nx]) border = true;
        }
        const l = 0.3 * rgba[p * 4] + 0.59 * rgba[p * 4 + 1] + 0.11 * rgba[p * 4 + 2];
        if (border) {
          edge++;
          rimLum += l;
        } else coreLum += l;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!joined[q] || seen[q]) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (!members.length) continue;
    // How much darker its rim is than its middle (a drawn thing's outline; a patch of dirt has none).
    const outline = edge < members.length ? coreLum / (members.length - edge) - rimLum / Math.max(1, edge) : 0;
    const f = classify(members, edge, outline, rgba, w, s);
    if (!f) continue;
    // Its middle and its reach in each direction, in scene units.
    let cx = 0, cy = 0;
    for (const p of members) {
      cx += p % w;
      cy += Math.floor(p / w);
    }
    cx = cx / members.length + 0.5;
    cy = cy / members.length + 0.5;
    const r = new Float64Array(16);
    for (const p of members) {
      const dx = (p % w) + 0.5 - cx, dy = Math.floor(p / w) + 0.5 - cy;
      const d = Math.hypot(dx, dy) + 0.7;
      const a = Math.atan2(dy, dx);
      const kk = nearestReach(a < 0 ? a + 2 * Math.PI : a);
      if (d > r[kk]) r[kk] = d;
    }
    // A direction with nothing in it (a thin bare tree's gaps) takes its neighbours'.
    const mean = r.reduce((a, b) => a + b, 0) / 16;
    for (let kk = 0; kk < 16; kk++) if (!r[kk]) r[kk] = Math.max(r[(kk + 15) & 15], r[(kk + 1) & 15], mean * 0.6);
    for (let kk = 0; kk < 16; kk++) r[kk] /= k;
    out.push({ shape: f.shape, x: paint.x0 + cx / k, y: paint.y0 + cy / k, w: f.size, d: f.size, r });
  }
  if (cliffs) findCliffs(rgba, inside, ground, w, h, s, (c) => {
    const pts = new Float64Array(c.pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      pts[i] = paint.x0 + c.pts[i] / k;
      pts[i + 1] = paint.y0 + c.pts[i + 1] / k;
    }
    cliffs.push({ pts, halfWidth: c.halfWidth / k });
  });
  return out;
}

/**
 * Cliffs: a ledge's rock face is drawn blue-grey (cool, hardly coloured, neither dark nor white; water is more coloured),
 * apart from the ground; dirt and scree beside it are warmer, so they don't join it. Its pieces two
 * pixels apart are one band; a band long and narrow enough is a cliff (cliffOf).
 */
function findCliffs(rgba: Uint8ClampedArray, inside: Uint8Array, ground: Float32Array, w: number, h: number, s: number, found: (c: { pts: number[]; halfWidth: number }) => void): void {
  const rock = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!inside[p]) continue;
    const r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2];
    const d = Math.max(Math.abs(r - ground[p * 3]), Math.abs(g - ground[p * 3 + 1]), Math.abs(b - ground[p * 3 + 2]));
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (d > 30 && b - r >= 4 && Math.max(r, g, b) - Math.min(r, g, b) < 35 && lum >= 70 && lum <= 215) rock[p] = 1;
  }
  const joined = grown(grown(rock, w, h), w, h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!rock[start] || seen[start]) continue;
    const members: number[] = [];
    const path: number[] = [];
    let edge = 0, pathEdge = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      path.push(p);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !joined[p - 1] || !joined[p + 1] || !joined[p - w] || !joined[p + w]) pathEdge++;
      if (rock[p]) {
        members.push(p);
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !rock[p - 1] || !rock[p + 1] || !rock[p - w] || !rock[p + w]) edge++;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!joined[q] || seen[q]) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    // Its width from the joined band (its rock is broken by highlights and outlines), less the two pixels it was grown by each side.
    const c = cliffOf(members, path, (2 * path.length) / Math.max(1, pathEdge) - 4, w, h, s);
    if (c) found(c);
  }
}

/** A cliff's band is this wide (squares), and at least this long. */
const CLIFF_WIDEST = 1.6;
const CLIFF_NARROWEST = 0.3;
const CLIFF_SHORTEST = 6;
/** A cliff's ends are at least this much of its length apart (a ring's are about 0.64). */
const CLIFF_OPEN = 0.75;

/**
 * A long band (a ledge's rock face) as a cliff: its middle line, from one end to the other (each
 * pixel by how far it is from the far end, walking through the band and the gaps joining its
 * pieces, and the middles of each half square of that), and half its `width` (paint pixels, a
 * band L long having about 2L of rim). Null when too wide or narrow (a wall) or too short.
 */
function cliffOf(members: readonly number[], path: readonly number[], width: number, w: number, h: number, s: number): { pts: number[]; halfWidth: number } | null {
  const n = members.length;
  if (n < 8) return null;
  if (width < CLIFF_NARROWEST * s || width > CLIFF_WIDEST * s) return null;
  // How far each of its pixels is from one end, walking through it (and the gaps joining its pieces).
  const index = new Map<number, number>();
  path.forEach((p, i) => index.set(p, i));
  const walkable = (np: number) => index.has(np);
  const walk = (from: number): Int32Array => {
    const d = new Int32Array(path.length).fill(-1);
    const queue = [from];
    d[index.get(from)!] = 0;
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q], x = p % w, y = (p - x) / w, dp = d[index.get(p)!];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (!walkable(np)) continue;
          const i = index.get(np)!;
          if (d[i] >= 0) continue;
          d[i] = dp + 1;
          queue.push(np);
        }
      }
    }
    return d;
  };
  const farthest = (d: Int32Array) => {
    let best = 0;
    for (let i = 1; i < d.length; i++) if (d[i] > d[best]) best = i;
    return best;
  };
  const end = path[farthest(walk(members[0]))];
  const d = walk(end);
  const far = path[farthest(d)];
  const length = d[farthest(d)];
  if (length < CLIFF_SHORTEST * s) return null;
  // A band's ends lie about its length apart; a ring's (a rock's outline) much less: it's closed.
  if (Math.hypot((end % w) - (far % w), Math.floor(end / w) - Math.floor(far / w)) < CLIFF_OPEN * length) return null;
  // The middle of each half square along it.
  const step = Math.max(2, s * 0.5);
  const bins = Math.floor(length / step) + 1;
  const sx = new Float64Array(bins), sy = new Float64Array(bins), cnt = new Float64Array(bins);
  members.forEach((p) => {
    const dp = d[index.get(p)!];
    if (dp < 0) return;
    const k = Math.min(bins - 1, Math.floor(dp / step));
    sx[k] += (p % w) + 0.5;
    sy[k] += Math.floor(p / w) + 0.5;
    cnt[k]++;
  });
  const pts: number[] = [];
  for (let k = 0; k < bins; k++) if (cnt[k]) pts.push(sx[k] / cnt[k], sy[k] / cnt[k]);
  return pts.length >= 4 ? { pts, halfWidth: width / 2 } : null;
}

/**
 * How full a patch is round its middle (within a fifth of its radius `r`): a bare tree's limbs meet
 * in a dense knot there; a river's branches, or a word, leave it mostly empty.
 */
function hub(members: readonly number[], w: number, r: number): number {
  let cx = 0, cy = 0;
  for (const p of members) {
    cx += p % w;
    cy += Math.floor(p / w);
  }
  cx /= members.length;
  cy /= members.length;
  const near = Math.max(1.5, r * 0.2);
  let n = 0;
  for (const p of members) if (Math.hypot((p % w) - cx, Math.floor(p / w) - cy) <= near) n++;
  return n / (Math.PI * near * near);
}

/** A mask grown by a pixel each way (8 neighbours). */
function grown(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * What a patch is, from its pixels (`edge` of them on its rim, `outline` how much darker that
 * rim is than its middle) and how big it is (`s` pixels a square): its shape and how wide (squares), or null for none of the things found.
 */
function classify(members: readonly number[], edge: number, outline: number, rgba: Uint8ClampedArray, w: number, s: number): { shape: Shape; size: number } | null {
  const n = members.length;
  const area = n / (s * s);
  // A big patch is a building, a yard or a wood, but for one round green crown (a great tree).
  if (area < SMALLEST || area > BIG_TREE) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, r = 0, g = 0, b = 0;
  for (const p of members) {
    const x = p % w, y = (p - x) / w;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    r += rgba[p * 4];
    g += rgba[p * 4 + 1];
    b += rgba[p * 4 + 2];
  }
  r /= n;
  g /= n;
  b /= n;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (Math.max(bw, bh) / Math.min(bw, bh) > LONGEST) return null;
  const across = (bw + bh) / 2 / s;
  // How much of its round box it fills (a crown most of it; a bare tree's branches little).
  const fill = n / ((Math.PI / 4) * bw * bh);
  // How ragged its rim is: rim pixels against a circle's of the same area.
  const ragged = edge / (2 * Math.sqrt(Math.PI * n));
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const green = g > r + 6 && g > b - 4;
  const grey = Math.abs(r - g) < 14 && Math.abs(g - b) < 18;
  const brown = r >= g - 4 && g >= b - 6 && r - b > 8;
  const shape = (kind: Shape["kind"]): Shape => ({ kind, h: 0 });
  if (area > BIGGEST && !(green && fill > 0.6)) return null;
  // A pine seen from above is a spiky star: it fills less of its box than a leafy crown.
  if (green && (fill > 0.35 || (fill > 0.18 && ragged > 1.6 && area >= PINE))) {
    const piney = lum < 85 || ragged > 1.6;
    if (piney && area >= PINE) return { shape: shape("pine"), size: across };
    return { shape: shape(area < TREE ? "bush" : "tree"), size: across };
  }
  // A bare tree: warm (brown or snowy grey-brown branches), its limbs spread about as far every way
  // (a word written on the map is wide and flat) from a dense knot in the middle (a river's
  // branches, or scattered scree, have none), and thin: a fifth to a third of its round box filled
  // (a river network much less).
  if (!green && r - b >= 5 && lum < 170 && fill >= 0.18 && fill < 0.35 && across >= 1 && across <= 5 &&
      Math.max(bw, bh) / Math.min(bw, bh) <= 1.7 && hub(members, w, (bw + bh) / 4) >= 0.6) {
    return { shape: shape("bare"), size: across };
  }
  // A rock is drawn with an outline darker than its middle.
  if (grey && fill > 0.5 && lum >= 60 && area <= 4 && outline > 12) return { shape: shape("rock"), size: across };
  return null;
}

/**
 * The ground's colour round each pixel (rgb, 0-255, three a pixel): the middle colour of each
 * block of `b` by `b` pixels, blended between blocks. Where things cover less than half a block,
 * it's the ground's.
 */
function groundColours(rgba: Uint8ClampedArray, inside: Uint8Array, w: number, h: number, b: number): Float32Array {
  const bw = Math.ceil(w / b), bh = Math.ceil(h / b);
  const mid = new Float32Array(bw * bh * 3);
  const ch: number[][] = [[], [], []];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      ch[0].length = ch[1].length = ch[2].length = 0;
      // Every other pixel each way is enough for a middle colour.
      for (let y = by * b; y < Math.min(h, (by + 1) * b); y += 2) {
        for (let x = bx * b; x < Math.min(w, (bx + 1) * b); x += 2) {
          const p = y * w + x;
          if (!inside[p]) continue;
          for (let c = 0; c < 3; c++) ch[c].push(rgba[p * 4 + c]);
        }
      }
      if (!ch[0].length) continue;
      for (let c = 0; c < 3; c++) {
        const v = ch[c].sort((a2, b2) => a2 - b2);
        mid[(by * bw + bx) * 3 + c] = v[v.length >> 1];
      }
    }
  }
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / b - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / b - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = mid[(y0 * bw + x0) * 3 + c] * (1 - tx) + mid[(y0 * bw + x1) * 3 + c] * tx;
        const d = mid[(y1 * bw + x0) * 3 + c] * (1 - tx) + mid[(y1 * bw + x1) * 3 + c] * tx;
        out[(y * w + x) * 3 + c] = a * (1 - ty) + d * ty;
      }
    }
  }
  return out;
}

/** Found things as the 3D view stands them up (coloured from the picture where they stand). */
export function foundObjects(found: readonly Found[]): Object3d[] {
  return found.map((f) => ({ id: null, shape: f.shape, x: f.x, y: f.y, size: Math.max(f.w, f.d), w: f.w, d: f.d, deg: 0, color: null, paint: true }));
}

/** Found things' painted footprints, to take off the floor, in pixels of a picture drawn `k` pixels a scene unit. */
export function foundHoles(found: readonly Found[], k: number): Hole[] {
  return found.map((f) => ({ x: f.x * k, y: f.y * k, r: f.r.map((v) => v * k) }));
}

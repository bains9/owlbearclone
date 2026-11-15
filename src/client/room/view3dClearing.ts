// The painted trees taken off the 3D floor (view3d.ts): where a map's own data stands a tree, a
// bush or a rock up in 3D (view3dMapData.ts mapObjects), the picture still paints it flat on the
// ground under it, a second tree lying round the first's feet. So, on a copy of the picture, each
// one's painted footprint (its reach in 16 directions, a little grown) is filled with ground: the
// picture's own ground from a stretch nearby that's clear of everything, its colour matched to
// the edge it fills (how much the ground there differs from the stretch copied, carried in from
// the edge), and blended in over its last tenth. Trees in a wood are done from its edge in, each
// copying from ground cleared before it. Where the picture paints a building, water, a floor, a
// cave or a cliff under a tree, it's left as painted (the 3D view stands those up or they're not
// ground); other things painted on the ground (crates, carts, pack items) are never copied.
// The result is a patch: the picture's pixels where it filled, see-through everywhere else.
// Kept apart from three.js and the page, so it's tested; the board runs it a slice at a time.

import type { SidecarLayers } from "../dd/raster";
import { AR, OR, type AreaRole } from "../dd/roles";

/** A thing whose paint comes off the floor: its middle and its reach in each of REACH_DIRS' 16 directions, in work pixels. */
export interface Hole {
  x: number;
  y: number;
  r: Float64Array;
}

/** Where the picture stays as painted, and what's not to be copied, at their own size. */
export interface ClearingMasks {
  w: number;
  h: number;
  /** Not painted over, not copied from: buildings, water, floors, caves, cliffs (0 or 1). */
  keep: Uint8Array;
  /** Not copied from: other things painted on the ground (0 or 1). */
  avoid: Uint8Array;
}

/** A footprint is grown by this much of its reach, and these pixels, so its painted edge comes off too. */
export const CLEAR_GROW = 1.12;
export const CLEAR_PAD = 3;
/** The last share of a footprint, out to its edge, where the fill blends into the picture. */
const FEATHER = 0.1;
/** The band round a footprint whose colours the fill is matched to (as a share of its reach). */
const RING = 0.3;
/** How far off a footprint ground is looked for to copy, in footprints' reaches, and in which directions. */
const REACHES = [2.2, 3, 4] as const;
const DIRS = 16;
/** A footprint's spots tested for clear ground under a copy: 12 directions at three distances, and its middle. */
const PROBE = probes();
/** Footprints are filled in rounds: first those with all ground to copy from, then less and less. */
const ROUNDS = [0.95, 0.8, 0.6, 0.4, 0] as const;
/** Colour sectors round a footprint. */
const SECTORS = 16;

const CLEAN = 0, KEEP = 1, AVOID = 2, HOLE = 3, FILLED = 4;

function probes(): Float64Array {
  const out: number[] = [0, 0];
  for (const f of [0.3, 0.6, 0.9]) {
    for (let a = 0; a < 12; a++) out.push(f * Math.cos(((a + f) * Math.PI) / 6), f * Math.sin(((a + f) * Math.PI) / 6));
  }
  return Float64Array.from(out);
}

/** The angles (radians, 0..2pi, y down) of the 16 reach directions, in order. */
const REACH_ANGLES = reachAngles();

function reachAngles(): Float64Array {
  // As REACH_DIRS (dd/raster.ts): clockwise on screen from just below +x.
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
}

/** A hole's reach at angle `a` (radians, 0..2pi): between its two nearest directions. */
export function reachAt(r: Float64Array, a: number): number {
  let k = 0;
  while (k < 16 && REACH_ANGLES[k] <= a) k++;
  const i0 = (k + 15) & 15, i1 = k & 15;
  let a0 = REACH_ANGLES[i0], a1 = REACH_ANGLES[i1];
  if (a1 <= a0) a1 += 2 * Math.PI;
  let t = a < a0 ? a + 2 * Math.PI : a;
  t = (t - a0) / (a1 - a0);
  return r[i0] + (r[i1] - r[i0]) * t;
}

/** A hole grown to take the painted edge too. */
function grown(h: Hole): Hole {
  const r = new Float64Array(16);
  for (let k = 0; k < 16; k++) r[k] = h.r[k] * CLEAR_GROW + CLEAR_PAD;
  return { x: h.x, y: h.y, r };
}

/**
 * The work of taking painted things off a picture (w x h, rgba, changed in place), a hole at a
 * time: `step` goes on until `enough()` says stop, and says whether it's all done. Then the
 * picture's alpha is 255 where it was filled and 0 everywhere else: a patch to lay over it.
 */
export class Clearing {
  private readonly state: Uint8Array;
  /** How many footprints cover each pixel (up to 255): one blends into the picture at its edge; two or more, into each other. */
  private readonly cover: Uint8Array;
  private readonly holes: Hole[];
  private done = false;
  /** The mean colour of the clear ground, for a footprint with nothing round it to match. */
  private ground: [number, number, number] = [128, 128, 128];
  private readonly work: Generator<void, void, void>;

  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly rgba: Uint8ClampedArray,
    holes: readonly Hole[],
    private readonly masks: ClearingMasks | null,
  ) {
    this.state = new Uint8Array(w * h);
    this.cover = new Uint8Array(w * h);
    this.holes = holes.map(grown);
    this.work = this.run();
  }

  /** Does some of the work; true once it's all done. */
  step(enough: () => boolean): boolean {
    while (!this.done) {
      if (this.work.next().done) this.done = true;
      else if (enough()) break;
    }
    return this.done;
  }

  /** All of it, pausing after every piece: the masks, each footprint marked, then each filled. */
  private *run(): Generator<void, void, void> {
    const { w, h, state, rgba, masks } = this;
    if (masks && masks.w > 0 && masks.h > 0) {
      const sx = masks.w / w, sy = masks.h / h;
      for (let y = 0; y < h; y++) {
        const row = Math.min(masks.h - 1, Math.floor((y + 0.5) * sy)) * masks.w;
        for (let x = 0, p = y * w; x < w; x++, p++) {
          const m = row + Math.min(masks.w - 1, Math.floor((x + 0.5) * sx));
          state[p] = masks.keep[m] ? KEEP : masks.avoid[m] ? AVOID : CLEAN;
        }
        if ((y & 63) === 63) yield;
      }
    }
    for (const hole of this.holes) {
      this.mark(hole);
      yield;
    }
    // The clear ground's mean colour, from every 7th pixel or so.
    let r = 0, g = 0, b = 0, n = 0;
    for (let p = 0; p < w * h; p += 7) {
      if (state[p] !== CLEAN) continue;
      r += rgba[p * 4];
      g += rgba[p * 4 + 1];
      b += rgba[p * 4 + 2];
      n++;
    }
    if (n) this.ground = [r / n, g / n, b / n];
    yield;
    // The footprints in rounds, the best placed first, each round taking those whose ground to copy
    // is clear enough; a round with none lowers the bar.
    let remaining = this.holes.map((_, i) => i);
    let round = 0;
    while (remaining.length) {
      const bar = ROUNDS[Math.min(round, ROUNDS.length - 1)];
      const queue = remaining.map((i) => ({ i, ...this.bestCopy(this.holes[i]) })).filter((c) => c.score >= bar);
      if (!queue.length) {
        round++;
        continue;
      }
      queue.sort((a, b) => b.score - a.score);
      const taken = new Set(queue.map((c) => c.i));
      remaining = remaining.filter((i) => !taken.has(i));
      for (const c of queue) {
        this.fill(this.holes[c.i], c.dx, c.dy, c.score);
        yield;
      }
    }
    for (let p = 0; p < state.length; p++) rgba[p * 4 + 3] = state[p] === FILLED ? 255 : 0;
  }

  /** Marks a hole's pixels to fill (all but those kept as painted), and counts it on each. */
  private mark(hole: Hole): void {
    const { w, h, state, cover } = this;
    const R = Math.max(...hole.r), r0 = Math.min(...hole.r);
    const x0 = Math.max(0, Math.floor(hole.x - R)), x1 = Math.min(w - 1, Math.ceil(hole.x + R));
    const y0 = Math.max(0, Math.floor(hole.y - R)), y1 = Math.min(h - 1, Math.ceil(hole.y + R));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - hole.y;
      for (let x = x0, p = y * w + x0; x <= x1; x++, p++) {
        const dx = x + 0.5 - hole.x;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= R || (d >= r0 && d >= reachAt(hole.r, angle(dx, dy)))) continue;
        if (cover[p] < 255) cover[p]++;
        if (state[p] !== KEEP) state[p] = HOLE;
      }
    }
  }

  private clear(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const s = this.state[(y | 0) * this.w + (x | 0)];
    return s === CLEAN || s === FILLED;
  }

  /** The nearby stretch of ground most clear of everything, as an offset, and how clear (0..1). */
  private bestCopy(hole: Hole): { dx: number; dy: number; score: number } {
    const R = Math.max(...hole.r);
    let best = { dx: 0, dy: 0, score: -1 };
    for (const f of REACHES) {
      for (let a = 0; a < DIRS; a++) {
        const ang = ((a + 0.25) * 2 * Math.PI) / DIRS;
        const dx = Math.round(Math.cos(ang) * R * f), dy = Math.round(Math.sin(ang) * R * f);
        let ok = 0;
        for (let k = 0; k < PROBE.length; k += 2) {
          if (this.clear(hole.x + PROBE[k] * R + dx, hole.y + PROBE[k + 1] * R + dy)) ok++;
        }
        const score = ok / (PROBE.length / 2);
        if (score > best.score) best = { dx, dy, score };
      }
    }
    return best;
  }

  /**
   * Fills a hole from the ground `dx`, `dy` away, its colour matched to the ground round the hole:
   * the difference between the two along the hole's edge, in sectors, carried in from the edge
   * towards the middle (where it's their average). Where there's no clear ground to copy, the
   * colours round the edge, carried in the same way. Blended into the picture over its last tenth.
   */
  private fill(hole: Hole, dx: number, dy: number, score: number): void {
    const { w, h, state, rgba } = this;
    const R = Math.max(...hole.r);
    const reach = R * (1 + RING);
    const x0 = Math.max(0, Math.floor(hole.x - reach)), x1 = Math.min(w - 1, Math.ceil(hole.x + reach));
    const y0 = Math.max(0, Math.floor(hole.y - reach)), y1 = Math.min(h - 1, Math.ceil(hole.y + reach));
    const copy = score > 0.3;
    const off = dy * w + dx;

    // The edge's colours and their differences from the stretch copied, by sector.
    const diff = new Float64Array(SECTORS * 3), dn = new Float64Array(SECTORS);
    const edge = new Float64Array(SECTORS * 3), en = new Float64Array(SECTORS);
    const stride = R > 24 ? 2 : 1;
    for (let y = y0; y <= y1; y += stride) {
      const ry = y + 0.5 - hole.y;
      for (let x = x0; x <= x1; x += stride) {
        const p = y * w + x;
        const s = state[p];
        if (s !== CLEAN && s !== FILLED) continue;
        const rx = x + 0.5 - hole.x;
        const a = angle(rx, ry);
        const rho = Math.sqrt(rx * rx + ry * ry) / reachAt(hole.r, a);
        if (rho < 1 || rho >= 1 + RING) continue;
        const sec = Math.floor((a / (2 * Math.PI)) * SECTORS) % SECTORS;
        edge[sec * 3] += rgba[p * 4];
        edge[sec * 3 + 1] += rgba[p * 4 + 1];
        edge[sec * 3 + 2] += rgba[p * 4 + 2];
        en[sec]++;
        if (copy && this.clear(x + dx, y + dy)) {
          const q = p + off;
          diff[sec * 3] += rgba[p * 4] - rgba[q * 4];
          diff[sec * 3 + 1] += rgba[p * 4 + 1] - rgba[q * 4 + 1];
          diff[sec * 3 + 2] += rgba[p * 4 + 2] - rgba[q * 4 + 2];
          dn[sec]++;
        }
      }
    }
    const D = sectorMeans(diff, dn, [0, 0, 0]);
    const E = sectorMeans(edge, en, this.ground);

    // The fill.
    for (let y = y0; y <= y1; y++) {
      const ry = y + 0.5 - hole.y;
      for (let x = x0, p = y * w + x0; x <= x1; x++, p++) {
        if (state[p] !== HOLE) continue;
        const rx = x + 0.5 - hole.x;
        const a = angle(rx, ry);
        const rho = Math.sqrt(rx * rx + ry * ry) / reachAt(hole.r, a);
        if (rho >= 1) continue;
        const t = (a / (2 * Math.PI)) * SECTORS - 0.5;
        const s0 = (Math.floor(t) + SECTORS) % SECTORS, s1 = (s0 + 1) % SECTORS;
        const f = t - Math.floor(t);
        // Blended into the picture at its edge, but not into another footprint's paint.
        const alpha = rho < 1 - FEATHER || this.cover[p] > 1 ? 1 : (1 - rho) / FEATHER;
        const fromCopy = copy && this.clear(x + dx, y + dy);
        const M = fromCopy ? D : E;
        for (let ch = 0; ch < 3; ch++) {
          const side = M.s[s0 * 3 + ch] * (1 - f) + M.s[s1 * 3 + ch] * f;
          const carried = M.mean[ch] + (side - M.mean[ch]) * rho;
          const v = fromCopy ? rgba[(p + off) * 4 + ch] + carried : carried;
          rgba[p * 4 + ch] = rgba[p * 4 + ch] * (1 - alpha) + v * alpha;
        }
        state[p] = FILLED;
      }
    }
  }
}

/** Area roles the picture paints that stay as painted under a tree: buildings, water, floors, caves, cliffs and the like. */
const KEPT_AREAS: readonly AreaRole[] = [AR.WATER, AR.FLOOR, AR.CAVE, AR.CAVE_RIM, AR.ROOF, AR.WALL, AR.ICE, AR.KEEP, AR.PATH_KEEP];
/** Things painted on the ground that are fine to copy as ground: grass, flowers, leaves, roots, snow. */
const GROUNDISH: ReadonlySet<number> = new Set([OR.GRASS, OR.FLOWERS, OR.LITTER, OR.ROOTS, OR.MUSHROOM, OR.SNOW, OR.CROP, OR.REEDS]);

/**
 * The masks from the map data drawn without the things that stand up (so what lies under them
 * shows): kept where a building, water, a floor, a cave or a cliff is (at least half), avoided
 * where something else is painted on top (a crate, a cart, a pack item).
 */
export function clearingMasks(layers: Pick<SidecarLayers, "w" | "h" | "area" | "top">, roles: ArrayLike<number>): ClearingMasks {
  const n = layers.w * layers.h;
  const keep = new Uint8Array(n), avoid = new Uint8Array(n);
  for (const role of KEPT_AREAS) {
    const a = layers.area.get(role);
    if (!a) continue;
    for (let p = 0; p < n; p++) if (a[p] >= 128) keep[p] = 1;
  }
  for (let p = 0; p < n; p++) {
    const t = layers.top[p];
    if (t && !GROUNDISH.has(roles[t - 1])) avoid[p] = 1;
  }
  return { w: layers.w, h: layers.h, keep, avoid };
}

/** Angle of (x, y), y down, in 0..2pi. */
function angle(x: number, y: number): number {
  const a = Math.atan2(y, x);
  return a < 0 ? a + 2 * Math.PI : a;
}

/** Per-sector means (sectors with nothing take their nearest neighbours'), and the mean of all. */
function sectorMeans(sum: Float64Array, n: Float64Array, none: readonly number[]): { s: Float64Array; mean: number[] } {
  const s = new Float64Array(SECTORS * 3);
  const mean = [0, 0, 0];
  let all = 0;
  for (let k = 0; k < SECTORS; k++) {
    if (!n[k]) continue;
    for (let ch = 0; ch < 3; ch++) mean[ch] += sum[k * 3 + ch];
    all += n[k];
  }
  if (!all) {
    for (let k = 0; k < SECTORS; k++) s.set(none, k * 3);
    return { s, mean: [...none] };
  }
  for (let ch = 0; ch < 3; ch++) mean[ch] /= all;
  for (let k = 0; k < SECTORS; k++) {
    // The nearest sector each way with something in it, weighted by nearness.
    let found = -1;
    for (let d = 0; d < SECTORS && found < 0; d++) {
      const a = (k + d) % SECTORS, b = (k - d + SECTORS) % SECTORS;
      if (n[a]) found = a;
      else if (n[b]) found = b;
    }
    for (let ch = 0; ch < 3; ch++) s[k * 3 + ch] = sum[found * 3 + ch] / n[found];
  }
  return { s, mean };
}

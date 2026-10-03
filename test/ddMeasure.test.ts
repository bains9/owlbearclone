// Measuring object footprints, presence and snow caps from the picture (design 2.5, 4.3; the tests
// of 6.3 "Measurement", "Capped", "Presence" and the pack extent; the timing of 6.4). Synthetic
// pictures drawn here, the public sample pairs from DD_FIXTURES and waterfall's 1.2 export from
// Vern's folder (DD_VERN) when present.
import { describe, expect, it } from "vitest";
import {
  MEASURE, ROLE_RADIUS, measureObjects, measureSummary, priorReach, profileAt, spriteFrameReach, type Measured, type SpriteSizes,
} from "../src/client/dd/measure";
import type { AssetRef, DDMap, Level, MapObject, Terrain } from "../src/client/dd/model";
import { GRID } from "../src/client/dd/model";
import { parseDungeondraftMap } from "../src/client/dd/parse";
import { REACH_DIRS } from "../src/client/dd/raster";
import { OR, defaultName, objectRole, type ObjectRole } from "../src/client/dd/roles";
import { HAND_NAMES, SPRITE_SIZES } from "../src/client/dd/spriteSizes";
import type { PictureRect, PictureSample } from "../src/client/dd/extract";
import { decodePng } from "./helpers/png";

type FsLike = { readFileSync(path: string | URL, encoding?: "utf8"): string & Uint8Array; existsSync(path: string | URL): boolean };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as FsLike;
const zlib = (await import(/* @vite-ignore */ "node:" + "zlib")) as { inflateSync(b: Uint8Array): Uint8Array };
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** The public sample maps (not committed): DD_FIXTURES, or the design's working folder on Par's machine. */
const SAMPLES = (env.DD_FIXTURES ?? "C:/Users/G/tabletop-work/dd-raw/docs/samples").replace(/[\\/]+$/, "");
/** Vern's exports (not committed): DD_VERN, or the working folder on Par's machine. */
const VERN = (env.DD_VERN ?? "C:/Users/G/tabletop-work/vern").replace(/[\\/]+$/, "");

const PPS = 32;

// ------------------------------------------------------------------ synthetic pictures

type RGB = [number, number, number];

/** A deterministic hash of a pixel to [0, 1). */
function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class Pic {
  readonly w: number;
  readonly h: number;
  readonly rgba: Uint8ClampedArray;
  constructor(readonly wSq: number, readonly hSq: number, ground: (x: number, y: number) => RGB) {
    this.w = wSq * PPS;
    this.h = hSq * PPS;
    this.rgba = new Uint8ClampedArray(this.w * this.h * 4);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, ground(x, y));
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.rgba[o] = c[0]; this.rgba[o + 1] = c[1]; this.rgba[o + 2] = c[2]; this.rgba[o + 3] = 255;
  }
  sample(): PictureSample {
    return { rgba: this.rgba, w: this.w, h: this.h };
  }
  rect(): PictureRect {
    return { rect: [0, 0, this.wSq * GRID, this.hSq * GRID] };
  }
  /**
   * A crown: every pixel whose centre lies within the shape, given as its radius (world units) along
   * a world direction; leaves in two greens with a dark outline 1.5 px wide inside the edge. cap:
   * the inner share of the radius painted as a snow cap instead.
   */
  crown(cxW: number, cyW: number, radius: (dx: number, dy: number) => number, cap = 0): void {
    const cx = (cxW / GRID) * PPS, cy = (cyW / GRID) * PPS, upp = GRID / PPS;
    const R = (4 * GRID) / upp;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      const r = d > 0 ? radius(dx, dy) / upp : 1;
      if (d > r) continue;
      if (d > r - 1.5) this.set(x, y, [25, 38, 28]);
      else if (cap && d < cap * r) this.set(x, y, hash(x, y, 7) < 0.15 ? [228, 236, 246] : [247, 249, 252]);
      else this.set(x, y, hash(x >> 2, y >> 2, 3) < 0.4 ? [52, 98, 66] : [74, 128, 84]);
    }
  }
  /** A bare tree: brown branch strokes (width px wide) from the centre, each [angle, length in world units]. */
  bare(cxW: number, cyW: number, branches: Array<[number, number]>, width = 2): void {
    const cx = (cxW / GRID) * PPS, cy = (cyW / GRID) * PPS, upp = GRID / PPS;
    for (const [a, len] of branches) {
      const L = len / upp, ux = Math.cos(a), uy = Math.sin(a);
      for (let s = 0; s <= L; s += 0.25) {
        // A fork two thirds out, so the strokes thin out away from the trunk like a real one's.
        const pts: Array<[number, number]> = [[cx + ux * s, cy + uy * s]];
        if (s > 0.6 * L) {
          const f = s - 0.6 * L, b = a + 0.5;
          pts.push([cx + ux * 0.6 * L + Math.cos(b) * f, cy + uy * 0.6 * L + Math.sin(b) * f]);
        }
        for (const [px, py] of pts) {
          const wHere = s < 0.3 * L ? width + 2 : width;
          for (let oy = -wHere / 2; oy < wHere / 2; oy += 0.5) for (let ox = -wHere / 2; ox < wHere / 2; ox += 0.5) {
            this.set(Math.floor(px + ox), Math.floor(py + oy), [104, 70, 46]);
          }
        }
      }
    }
  }
  /** A plain disc of one colour, radius in world units. */
  blob(cxW: number, cyW: number, rW: number, c: RGB): void {
    const cx = (cxW / GRID) * PPS, cy = (cyW / GRID) * PPS, r = (rW / GRID) * PPS;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.set(x, y, c);
    }
  }
  /** A baked dotted grid: dark dots 2 px wide on every square's lines, 3 px on and 3 px off. */
  dottedGrid(): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const onX = x % PPS === PPS - 1 || x % PPS === 0, onY = y % PPS === PPS - 1 || y % PPS === 0;
      if ((onX && y % 6 < 3) || (onY && x % 6 < 3)) this.set(x, y, [96, 98, 108]);
    }
  }
}

/** Snow with a little grain and soft blue shade. */
const snow = (x: number, y: number): RGB => {
  const n = Math.floor(hash(x, y) * 10) - 5, shade = hash(x >> 4, y >> 4, 1) < 0.25 ? -12 : 0;
  return [228 + n + shade, 233 + n + shade, 242 + n + shade / 2];
};
/** Meadow grass. */
const grass = (x: number, y: number): RGB => {
  const n = Math.floor(hash(x, y) * 12) - 6;
  return [112 + n, 140 + n, 82 + n];
};

const DEFAULT_REF = (name: string): AssetRef => ({ path: `res://textures/objects/${name}.png`, source: "default", segments: ["objects", ...name.split("/")] });

function obj(xSq: number, ySq: number, name: string | null, o: Partial<MapObject> = {}): MapObject {
  return {
    position: { x: xSq * GRID, y: ySq * GRID }, rotation: 0, scale: { x: 1, y: 1 }, texture: name ? DEFAULT_REF(name) : null,
    mirror: false, layer: 100, shadow: false, blockLight: false, customColor: null, nodeId: null, index: 0, ...o,
  };
}

/** A level holding just these objects (and, when given, terrain of one default slot everywhere). */
function level(objects: MapObject[], terrain?: { wSq: number; hSq: number; slot: string }): Level {
  let t: Terrain | null = null;
  if (terrain) {
    const width = terrain.wSq * 4, height = terrain.hSq * 4;
    const weights = new Uint8Array(4 * width * height);
    weights.fill(255, 0, width * height);
    t = {
      enabled: true, expandSlots: false, smoothBlending: false, width, height, weights, slotCount: 4,
      slots: [{ path: `res://textures/terrain/${terrain.slot}.png`, source: "default", segments: ["terrain", terrain.slot] }, null, null, null],
    };
  }
  objects.forEach((o, i) => (o.index = i));
  return {
    key: "0", id: 0, label: "Ground", layers: new Map(), ambientLight: null, bakedLighting: null, terrain: t,
    water: { disableBorder: false, root: null }, cave: null, tiles: null, floorPolygons: [], floorWallIds: [], materials: [],
    patterns: [], walls: [], portals: [], paths: [], objects, lights: [], roofs: [], roofShade: null, textCount: 0,
  };
}

/** A sprite profile from a radius function in the sprite's frame (REACH_DIRS sample directions). */
function sprite(radius: (dx: number, dy: number) => number): { r: number; reach: number[] } {
  const reach: number[] = [];
  for (let k = 0; k < 16; k++) reach.push(radius(REACH_DIRS[k * 2], REACH_DIRS[k * 2 + 1]));
  return { r: Math.max(...reach), reach };
}

/**
 * An object's true outline in the world: radius along a world direction, for a sprite outline
 * `radius` placed with rotation, mirror and scale (mirror first, then rotation).
 */
function placed(radius: (dx: number, dy: number) => number, rot: number, mirror: boolean, sx: number, sy: number) {
  return (wx: number, wy: number): number => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const vx = ((c * wx + s * wy) * (mirror ? -1 : 1)) / sx, vy = (-s * wx + c * wy) / sy;
    const len = Math.hypot(vx, vy), ul = Math.hypot(wx, wy);
    return (radius(vx / len, vy / len) / len) * ul;
  };
}

/** The furthest the outline reaches within REACH_DIRS sector k (diamond positions k to k + 1), world units. */
function sectorMax(radius: (dx: number, dy: number) => number, k: number): number {
  let best = 0;
  for (let f = 0.02; f < 1; f += 0.04) {
    const p = (k + f) / 4, q = Math.floor(p), r = p - q;
    const [dx, dy] = q === 0 ? [1 - r, r] : q === 1 ? [-r, 1 - r] : q === 2 ? [r - 1, -r] : [r, r - 1];
    const l = Math.hypot(dx, dy);
    best = Math.max(best, radius(dx / l, dy / l));
  }
  return best;
}

/** An egg in the sprite's frame: 1.1 squares to +x, 0.75 to -x, 0.85 across. */
const egg = (dx: number, dy: number): number => {
  const a = dx >= 0 ? 1.1 * GRID : 0.75 * GRID, b = 0.85 * GRID;
  return 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
};

const TREE = "vegetation/trees/test_tree";

// ------------------------------------------------------------------ priors

describe("priors (2.5 item 1)", () => {
  it("scales, mirrors, then turns a sprite profile, and spriteFrameReach undoes it", () => {
    const sizes: SpriteSizes = { [TREE]: sprite(egg) };
    const o = obj(5, 5, TREE, { rotation: Math.PI / 6, mirror: true, scale: { x: 1.2, y: 0.9 } });
    const p = priorReach(o, OR.DECIDUOUS, sizes);
    const truth = placed(egg, Math.PI / 6, true, 1.2, 0.9);
    for (let k = 0; k < 16; k++) expect(p[k] / truth(REACH_DIRS[k * 2], REACH_DIRS[k * 2 + 1])).toBeCloseTo(1, 1);
    // Mirrored, the bulge (sprite +x) points to world -x before the 30 degree turn: down-left.
    const toward = (deg: number) => profileAt(p, Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180));
    expect(toward(180 + 30)).toBeGreaterThan(toward(30) * 1.3);
    const back = spriteFrameReach(o, p);
    for (let k = 0; k < 16; k++) expect(back[k] / sizes[TREE].reach[k]).toBeCloseTo(1, 1);
  });

  it("uses the role's circle for an unknown name and never looks a pack item up", () => {
    const sizes: SpriteSizes = { [TREE]: sprite(() => 999) };
    expect(Array.from(priorReach(obj(1, 1, "vegetation/trees/other"), OR.EVERGREEN, sizes))).toEqual(new Array(16).fill(ROLE_RADIUS[OR.EVERGREEN]));
    expect(Array.from(priorReach(obj(1, 1, TREE), OR.OPAQUE, sizes))).toEqual(new Array(16).fill(ROLE_RADIUS[OR.OPAQUE]));
  });

  it("seeds SPRITE_SIZES from a hand check of about 20 instances, all usable", () => {
    expect(HAND_NAMES.size).toBeGreaterThanOrEqual(20);
    for (const name of Object.keys(SPRITE_SIZES)) {
      const s = SPRITE_SIZES[name];
      expect(s.reach).toHaveLength(16);
      for (const v of s.reach) expect(v > 0 && Number.isFinite(v)).toBe(true);
      expect(s.r).toBe(Math.max(...s.reach));
      expect(defaultName(DEFAULT_REF(name))).toBe(name);
    }
    expect(SPRITE_SIZES["vegetation/trees/pine_tree_01"].r).toBe(256);
  });

  it("has no measured entry made mostly of the clamp (a reach held at 0.4, 0.8, 1.3 or 2.6 x the role's circle)", () => {
    // measure-sprites.ts measures with the hand sizes only, so a measured name's prior was its
    // role's circle; a direction at a clamp multiple of it says nothing about the sprite. (The table
    // is rounded to whole units.)
    const mults = [MEASURE.clampMin, MEASURE.clampMax].flatMap((c) => [c, c * MEASURE.retryPrior]);
    for (const name of Object.keys(SPRITE_SIZES)) {
      if (HAND_NAMES.has(name)) continue;
      const base = ROLE_RADIUS[objectRole(name)];
      const held = SPRITE_SIZES[name].reach.filter((v) => mults.some((c) => Math.abs(v - c * base) <= 0.51)).length;
      expect(held, name).toBeLessThanOrEqual(3);
    }
  });
});

// ------------------------------------------------------------------ measurement

describe("measurement (6.3)", () => {
  // The egg rotated 30 degrees, mirrored and scaled 1.2, at 32 px a square; its prior 15% too big.
  const rot = Math.PI / 6;
  const truth = placed(egg, rot, true, 1.2, 1.2);
  const sizes: SpriteSizes = { [TREE]: sprite((dx, dy) => 1.15 * egg(dx, dy)) };
  const tree = () => obj(6, 5, TREE, { rotation: rot, mirror: true, scale: { x: 1.2, y: 1.2 } });

  function within(m: Measured, tol: number): void {
    const p = priorReach(tree(), OR.DECIDUOUS, sizes);
    expect(m.measured).toBe(true);
    expect(m.present).toBe(true);
    for (let k = 0; k < 16; k++) {
      const want = sectorMax(truth, k);
      expect(Math.abs(m.reach[k] / want - 1), `direction ${k}: ${m.reach[k].toFixed(0)} against ${want.toFixed(0)}`).toBeLessThanOrEqual(tol);
      // Not held by the clamp.
      expect(m.reach[k]).toBeGreaterThan(MEASURE.clampMin * p[k] + 1);
      expect(m.reach[k]).toBeLessThan(MEASURE.clampMax * p[k] - 1);
    }
  }

  it("measures a rotated, mirrored crown on snow within 8%", () => {
    const pic = new Pic(12, 10, snow);
    pic.crown(6 * GRID, 5 * GRID, truth);
    const notes: string[] = [];
    const [m] = measureObjects(level([tree()]), [OR.DECIDUOUS], pic.sample(), pic.rect(), null, sizes, notes);
    within(m, 0.08);
    expect(m.capped).toBe(false);
    expect(notes.join(" ")).not.toMatch(/grid/);
    // Its own colour: a leaf green.
    expect(m.own[1]).toBeGreaterThan(m.own[0] + 20);
  });

  it("measures it within 10% through a baked dotted grid, which it finds and masks", () => {
    const pic = new Pic(12, 10, snow);
    pic.crown(6 * GRID, 5 * GRID, truth);
    pic.dottedGrid();
    const notes: string[] = [];
    const [m] = measureObjects(level([tree()]), [OR.DECIDUOUS], pic.sample(), pic.rect(), null, sizes, notes);
    within(m, 0.1);
    expect(notes.join(" ")).toMatch(/grid/);
  });

  it("takes a bare tree's reach from its strokes, centred on Dungeondraft's centre", () => {
    const pic = new Pic(12, 10, snow);
    // Long branches to the right, short ones to the left; the prior is a 1-square circle.
    const branches: Array<[number, number]> = [
      [0, 1.2 * GRID], [0.5, 1.15 * GRID], [-0.6, 1.2 * GRID], [1.6, 0.8 * GRID], [-1.6, 0.8 * GRID], [2.6, 0.6 * GRID], [3.4, 0.6 * GRID],
    ];
    pic.bare(6 * GRID, 5 * GRID, branches);
    const name = "vegetation/trees/test_dead";
    const [m] = measureObjects(level([obj(6, 5, name)]), [OR.BARE], pic.sample(), pic.rect(), null, { [name]: sprite(() => GRID) });
    expect(m.present).toBe(true);
    expect(m.measured).toBe(true);
    const at = (a: number) => profileAt(m.reach, Math.cos(a), Math.sin(a));
    expect(at(0)).toBeGreaterThan(1.0 * GRID);
    expect(at(0)).toBeLessThanOrEqual(1.3 * GRID + 1);
    expect(at(Math.PI - 0.5)).toBeLessThan(0.8 * GRID);
    // Thin strokes, one pixel wide, are still a tree.
    const thin = new Pic(12, 10, snow);
    thin.bare(6 * GRID, 5 * GRID, branches, 1);
    const [t] = measureObjects(level([obj(6, 5, name)]), [OR.BARE], thin.sample(), thin.rect(), null, { [name]: sprite(() => GRID) });
    expect(t.present).toBe(true);
  });

  it("keeps the priors below the measurable resolution", () => {
    const [m] = measureObjects(level([obj(1, 1, TREE)]), [OR.DECIDUOUS], { rgba: new Uint8ClampedArray(16), w: 2, h: 2 },
      { rect: [0, 0, 2 * GRID, 2 * GRID] }, null, SPRITE_SIZES);
    expect(m).toMatchObject({ present: null, measured: false, capped: false });
  });

  it("keeps two touching crowns apart (each claims the pixels nearer its own centre)", () => {
    const pic = new Pic(12, 8, snow);
    pic.crown(4 * GRID, 4 * GRID, () => GRID);
    pic.crown(6 * GRID, 4 * GRID, () => GRID);
    const ms = measureObjects(level([obj(4, 4, TREE), obj(6, 4, TREE)]), [OR.DECIDUOUS, OR.DECIDUOUS], pic.sample(), pic.rect(), null,
      { [TREE]: sprite(() => 1.15 * GRID) });
    expect(ms.map((m) => m.present)).toEqual([true, true]);
    // Toward each other each stops at the touching edge, not at its clamp (1.5 squares) in the other.
    expect(profileAt(ms[0].reach, 1, 0) / GRID).toBeLessThan(1.1);
    expect(profileAt(ms[1].reach, -1, 0) / GRID).toBeLessThan(1.1);
  });

  it("keeps the prior in the directions that run off the picture", () => {
    const pic = new Pic(10, 10, snow);
    pic.crown(0.5 * GRID, 5 * GRID, () => 0.9 * GRID);
    const sizes: SpriteSizes = { [TREE]: sprite(() => GRID) };
    const o = obj(0.5, 5, TREE);
    const [m] = measureObjects(level([o]), [OR.DECIDUOUS], pic.sample(), pic.rect(), null, sizes);
    const p = priorReach(o, OR.DECIDUOUS, sizes);
    expect(m.measured).toBe(true);
    let off = 0;
    for (let k = 0; k < 16; k++) {
      if (0.5 * GRID + REACH_DIRS[k * 2] * p[k] < 0) {
        off++;
        expect(m.reach[k]).toBe(p[k]);
      } else if (REACH_DIRS[k * 2] > 0.5) {
        expect(Math.abs(m.reach[k] / GRID - 0.9)).toBeLessThan(0.1);
      }
    }
    expect(off).toBeGreaterThanOrEqual(4);
  });

  it("measures an object at a huge position in the file quickly, and the rest as usual", () => {
    // Positions are only checked finite when parsed; this one once spun the neighbour index.
    const pic = new Pic(8, 8, snow);
    pic.crown(4 * GRID, 4 * GRID, () => 0.8 * GRID);
    const sizes: SpriteSizes = { [TREE]: sprite(() => 0.9 * GRID) };
    for (const x of [1e19, -1e19, 1e300]) {
      const far = obj(4, 4, TREE);
      far.position = { x, y: 4 * GRID };
      const t0 = performance.now();
      const ms = measureObjects(level([obj(4, 4, TREE), far]), [OR.EVERGREEN, OR.EVERGREEN], pic.sample(), pic.rect(), null, sizes);
      expect(performance.now() - t0).toBeLessThan(1000);
      expect(ms[0]).toMatchObject({ present: true, measured: true });
      expect(ms[1]).toMatchObject({ present: null, measured: false });
    }
  });

  it("reports its progress, ending with every object done", () => {
    const pic = new Pic(8, 8, snow);
    const objs = Array.from({ length: 130 }, (_, i) => obj(0.5 + (i % 13) * 0.55, 0.5 + Math.floor(i / 13) * 0.7, "vegetation/grass/grass_14"));
    const calls: Array<[number, number]> = [];
    measureObjects(level(objs), objs.map(() => OR.GRASS), pic.sample(), pic.rect(), null, SPRITE_SIZES, undefined, (d, t) => calls.push([d, t]));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every(([, t]) => t === 130)).toBe(true);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThan(calls[i - 1][0]);
    expect(calls[calls.length - 1]).toEqual([130, 130]);
  });
});

describe("capped (2.5 item 6)", () => {
  const sizes: SpriteSizes = { [TREE]: sprite(() => 1.3 * GRID) };
  const round = () => GRID;

  it("doesn't cap a green crown on snow when its prior overshoots by 1.3x", () => {
    const pic = new Pic(10, 10, snow);
    pic.crown(5 * GRID, 5 * GRID, round);
    const [m] = measureObjects(level([obj(5, 5, TREE)]), [OR.DECIDUOUS], pic.sample(), pic.rect(), null, sizes);
    expect(m.present).toBe(true);
    expect(m.capped).toBe(false);
    for (let k = 0; k < 16; k++) expect(m.reach[k] / GRID).toBeCloseTo(1, 0.9);
  });

  it("caps a snow-capped crown", () => {
    const pic = new Pic(10, 10, snow);
    pic.crown(5 * GRID, 5 * GRID, round, 0.75);
    const [m] = measureObjects(level([obj(5, 5, TREE)]), [OR.DECIDUOUS], pic.sample(), pic.rect(), null, sizes);
    expect(m.present).toBe(true);
    expect(m.capped).toBe(true);
    // The cap's middle counts as the crown's: the reach is the green rim's.
    for (let k = 0; k < 16; k++) expect(Math.abs(m.reach[k] / GRID - 1)).toBeLessThan(0.12);
  });

  it("caps a crown that a later snow object covers, and not an earlier one", () => {
    const pic = new Pic(10, 10, snow);
    pic.crown(5 * GRID, 5 * GRID, round);
    const drift = "environment/snow_03";
    const later = measureObjects(level([obj(5, 5, TREE), obj(5, 5.2, drift, { layer: 900 })]), [OR.DECIDUOUS, OR.SNOW],
      pic.sample(), pic.rect(), null, sizes);
    expect(later[0].capped).toBe(true);
    const under = measureObjects(level([obj(5, 5.2, drift, { layer: 50 }), obj(5, 5, TREE)]), [OR.SNOW, OR.DECIDUOUS],
      pic.sample(), pic.rect(), null, sizes);
    expect(under[1].capped).toBe(false);
  });

  it("caps a crown whose cap is the ground's own colour (the hole its leaves ring)", () => {
    const pic = new Pic(10, 10, snow);
    pic.crown(5 * GRID, 5 * GRID, round);
    // The cap painted with the snow ground itself, inside a green ring a quarter of the radius wide.
    const cx = 5 * PPS, cy = 5 * PPS;
    for (let y = cy - PPS; y <= cy + PPS; y++) for (let x = cx - PPS; x <= cx + PPS; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 0.75 * PPS) pic.set(x, y, snow(x, y));
    }
    const [m] = measureObjects(level([obj(5, 5, TREE)]), [OR.DECIDUOUS], pic.sample(), pic.rect(), null, sizes);
    expect(m.present).toBe(true);
    expect(m.capped).toBe(true);
    for (let k = 0; k < 16; k++) expect(Math.abs(m.reach[k] / GRID - 1)).toBeLessThan(0.12);
  });

  it("caps from the data alone at any resolution, and under a crown that covers it", () => {
    // 6 px a square: too coarse to measure anything, but a later snow object needs no pixels.
    const w = 60, h = 60, rgba = new Uint8ClampedArray(w * h * 4).fill(235);
    const drift = "environment/snow_03";
    const notes: string[] = [];
    const ms = measureObjects(level([obj(5, 5, TREE), obj(5, 5.2, drift, { layer: 900 })]), [OR.DECIDUOUS, OR.SNOW],
      { rgba, w, h }, { rect: [0, 0, 10 * GRID, 10 * GRID] }, null, sizes, notes);
    expect(notes.join(" ")).toMatch(/none were checked/);
    expect(ms[0]).toMatchObject({ capped: true, measured: false, present: null });
    // A bush under a later crown isn't tested, but a snow object over both caps both.
    const bush = "vegetation/shrubs/test_bush";
    const pic = new Pic(10, 10, snow);
    pic.crown(5 * GRID, 5 * GRID, round);
    const both = measureObjects(level([obj(5, 5.1, bush), obj(5, 5, TREE), obj(5, 5.1, drift, { layer: 900 })]), [OR.SHRUB, OR.DECIDUOUS, OR.SNOW],
      pic.sample(), pic.rect(), null, { ...sizes, [bush]: sprite(() => 0.4 * GRID) });
    expect(both[0]).toMatchObject({ present: null, capped: true });
    expect(both[1]).toMatchObject({ present: true, capped: true });
  });
});

describe("presence (2.5 item 5)", () => {
  const sizes: SpriteSizes = { [TREE]: sprite(() => 0.9 * GRID) };
  const at: Array<[number, number]> = [[2, 2], [6, 2], [10, 2], [2, 6], [6, 6], [10, 6]];

  it("drops exactly the tree the picture doesn't show", () => {
    const pic = new Pic(12, 8, snow);
    at.forEach(([x, y], i) => { if (i !== 4) pic.crown(x * GRID, y * GRID, () => 0.8 * GRID); });
    const ms = measureObjects(level(at.map(([x, y]) => obj(x, y, TREE))), at.map(() => OR.EVERGREEN), pic.sample(), pic.rect(), null, sizes);
    expect(ms.map((m) => m.present)).toEqual([true, true, true, true, false, true]);
    expect(ms[4].measured).toBe(false);
    const sum = measureSummary(ms, at.map(() => OR.EVERGREEN));
    expect(sum).toMatchObject({ tested: 6, dropped: 1, trees: 6, treesDropped: 1, lowerFit: true });
  });

  it("doesn't test tufts on grass terrain, and does test them on snow", () => {
    const tuft = "vegetation/grass/grass_14";
    const onGrass = new Pic(6, 6, grass);
    const lv = level([obj(3, 3, tuft)], { wSq: 6, hSq: 6, slot: "terrain_grass" });
    expect(measureObjects(lv, [OR.GRASS], onGrass.sample(), onGrass.rect(), null, SPRITE_SIZES)[0].present).toBeNull();
    const onSnow = new Pic(6, 6, snow);
    const sn = level([obj(3, 3, tuft)], { wSq: 6, hSq: 6, slot: "terrain_snow" });
    expect(measureObjects(sn, [OR.GRASS], onSnow.sample(), onSnow.rect(), null, SPRITE_SIZES)[0].present).toBe(false);
  });

  it("drops a tree whose middle shows only a little of it (under a quarter of its core)", () => {
    const pic = new Pic(12, 8, snow);
    at.forEach(([x, y], i) => { if (i !== 4) pic.crown(x * GRID, y * GRID, () => 0.8 * GRID); });
    // Something dark and small where the fifth tree should be: found round its centre, but too little.
    pic.blob(6 * GRID, 6 * GRID, 0.2 * GRID, [40, 70, 50]);
    const ms = measureObjects(level(at.map(([x, y]) => obj(x, y, TREE))), at.map(() => OR.EVERGREEN), pic.sample(), pic.rect(), null, sizes);
    expect(ms.map((m) => m.present)).toEqual([true, true, true, true, false, true]);
  });

  it("drops a bare tree the picture doesn't show, by its strokes", () => {
    const pic = new Pic(12, 8, snow);
    const name = "vegetation/trees/test_dead";
    pic.bare(3 * GRID, 4 * GRID, [[0, GRID], [1.2, GRID], [2.4, 0.9 * GRID], [3.6, GRID], [4.8, 0.8 * GRID], [5.8, GRID]]);
    // The second one erased, with a short stick left beside its centre (strokes on a few rays only).
    pic.bare(9.4 * GRID, 4 * GRID, [[0.3, 0.4 * GRID]]);
    const ms = measureObjects(level([obj(3, 4, name), obj(9, 4, name)]), [OR.BARE, OR.BARE], pic.sample(), pic.rect(), null,
      { [name]: sprite(() => GRID) });
    expect(ms.map((m) => m.present)).toEqual([true, false]);
    expect(ms[1].measured).toBe(false);
  });

  it("doesn't test an object below the water's surface", () => {
    const pic = new Pic(10, 10, snow);
    const lv = level([obj(5, 5, TREE, { layer: -100 }), obj(8, 8, TREE, { layer: -100 })]);
    const ring = Float64Array.from([3, 3, 7, 3, 7, 7, 3, 7].map((v) => v * GRID));
    lv.water = {
      disableBorder: false,
      root: { ref: null, polygon: new Float64Array(0), depth: 0, isOpen: false, deepColor: null, shallowColor: null, blendDistance: null,
        children: [{ ref: 1, polygon: ring, depth: 1, isOpen: false, deepColor: null, shallowColor: null, blendDistance: null, children: [] }] },
    };
    const ms = measureObjects(lv, [OR.EVERGREEN, OR.EVERGREEN], pic.sample(), pic.rect(), null, sizes);
    // The one in the water isn't tested; the one on dry land, erased too, is dropped.
    expect(ms.map((m) => m.present)).toEqual([null, false]);
  });

  it("keeps objects too small in the picture to tell, and says so", () => {
    const pic = new Pic(8, 8, snow);
    const bush = "vegetation/shrubs/test_bush";
    // A bush whose prior reaches 2.5 px: a dark dot is drawn, but at that size there is no telling.
    pic.blob(3 * GRID, 3 * GRID, 0.1 * GRID, [40, 70, 50]);
    const notes: string[] = [];
    const ms = measureObjects(level([obj(3, 3, bush), obj(5, 5, bush)]), [OR.SHRUB, OR.SHRUB], pic.sample(), pic.rect(), null,
      { [bush]: sprite(() => 0.08 * GRID) }, notes);
    expect(ms.map((m) => m.present)).toEqual([null, null]);
    expect(ms.every((m) => !m.measured)).toBe(true);
    expect(notes.join(" ")).toMatch(/too small in the picture/);
    // Just above that size, an erased one is dropped and a drawn one kept.
    const big = measureObjects(level([obj(3, 3, bush), obj(5, 5, bush)]), [OR.SHRUB, OR.SHRUB], pic.sample(), pic.rect(), null,
      { [bush]: sprite(() => 0.11 * GRID) });
    expect(big.map((m) => m.present)).toEqual([true, false]);
  });

  it("doesn't test an object a later one covers", () => {
    const pic = new Pic(8, 8, snow);
    pic.crown(4 * GRID, 4 * GRID, () => 1.2 * GRID);
    const bush = "vegetation/shrubs/test_bush";
    const ms = measureObjects(level([obj(4, 4.1, bush), obj(4, 4, TREE)]), [OR.SHRUB, OR.DECIDUOUS], pic.sample(), pic.rect(), null,
      { [TREE]: sprite(() => 1.2 * GRID), [bush]: sprite(() => 0.4 * GRID) });
    expect(ms[0]).toMatchObject({ present: null, measured: false });
    expect(ms[1].present).toBe(true);
  });
});

describe("pack items (2.5 item 7)", () => {
  it("covers a pack item's whole 2-square crown, and never drops it", () => {
    const pic = new Pic(10, 10, snow);
    pic.crown(5 * GRID, 5 * GRID, () => GRID);
    const [m] = measureObjects(level([obj(5, 5, null)]), [OR.OPAQUE], pic.sample(), pic.rect(), null, SPRITE_SIZES);
    expect(m.present).toBeNull();
    expect(m.measured).toBe(true);
    for (let k = 0; k < 16; k++) expect(m.reach[k]).toBeGreaterThanOrEqual(0.97 * GRID);
  });

  it("measures a small pack item smaller than the disc", () => {
    const pic = new Pic(10, 10, snow);
    pic.blob(5 * GRID, 5 * GRID, 0.7 * GRID, [110, 108, 104]);
    const [m] = measureObjects(level([obj(5, 5, null)]), [OR.OPAQUE], pic.sample(), pic.rect(), null, SPRITE_SIZES);
    expect(m).toMatchObject({ present: null, measured: true });
    for (let k = 0; k < 16; k++) expect(Math.abs(m.reach[k] / GRID - 0.7)).toBeLessThan(0.1);
  });

  it("keeps a snowy pack crown whole when its cap is the ground's colour and its rim is broken", () => {
    // A 2-square crown: a white cap like the snow round it, a green rim 0.15 square wide with a 20
    // degree gap every 45 degrees (so the cap isn't a hole), and a dark trunk a third of a square
    // across at its middle (all that is joined to its centre).
    const pic = new Pic(10, 10, snow);
    const cx = 5 * PPS, cy = 5 * PPS;
    for (let y = cy - PPS - 1; y <= cy + PPS + 1; y++) for (let x = cx - PPS - 1; x <= cx + PPS + 1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      const deg = (((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 45;
      if (d <= PPS && d > 0.85 * PPS && deg >= 20) pic.set(x, y, [52, 98, 66]);
      if (d < 6) pic.set(x, y, [80, 55, 40]);
    }
    const [m] = measureObjects(level([obj(5, 5, null)]), [OR.OPAQUE], pic.sample(), pic.rect(), null, SPRITE_SIZES);
    expect(m).toMatchObject({ present: null, measured: true });
    for (let k = 0; k < 16; k++) expect(m.reach[k] / GRID, `direction ${k}`).toBeGreaterThanOrEqual(0.95);
  });

  it("gives a pack item the 1.5-square disc times its scale when measuring fails", () => {
    const pic = new Pic(10, 10, snow);
    const [m] = measureObjects(level([obj(5, 5, null, { scale: { x: 1.4, y: 0.8 } })]), [OR.OPAQUE], pic.sample(), pic.rect(), null, SPRITE_SIZES);
    expect(m.present).toBeNull();
    expect(m.measured).toBe(false);
    for (const r of m.reach) expect(r).toBeCloseTo(1.5 * GRID * 1.4, 3);
  });
});

// ------------------------------------------------------------------ timing (6.4)

describe("timing (6.4)", () => {
  it("measures a waterfall-sized map at 32 px a square well within the target", () => {
    // 50 x 35 squares, 70 objects: 30 crowns, 10 bare trees, 30 tufts.
    const pic = new Pic(50, 35, snow);
    const objs: MapObject[] = [], roles: ObjectRole[] = [];
    const sizes: SpriteSizes = { [TREE]: sprite(() => 1.1 * GRID), "vegetation/trees/test_dead": sprite(() => GRID) };
    for (let i = 0; i < 70; i++) {
      const x = 2 + (i % 10) * 4.8, y = 2 + Math.floor(i / 10) * 4.8;
      if (i % 7 < 3) {
        pic.crown(x * GRID, y * GRID, () => 1.0 * GRID);
        objs.push(obj(x, y, TREE)); roles.push(OR.EVERGREEN);
      } else if (i % 7 === 3) {
        pic.bare(x * GRID, y * GRID, [[0, GRID], [1.2, GRID], [2.4, 0.9 * GRID], [3.6, GRID], [4.8, 0.8 * GRID], [5.8, GRID]]);
        objs.push(obj(x, y, "vegetation/trees/test_dead")); roles.push(OR.BARE);
      } else {
        pic.crown(x * GRID, y * GRID, () => 0.2 * GRID);
        objs.push(obj(x, y, "vegetation/grass/grass_14")); roles.push(OR.GRASS);
      }
    }
    const lv = level(objs);
    measureObjects(lv, roles, pic.sample(), pic.rect(), null, sizes); // warm up
    const t0 = performance.now();
    const ms = measureObjects(lv, roles, pic.sample(), pic.rect(), null, sizes);
    const dt = performance.now() - t0;
    console.log(`measureObjects, 50 x 35 squares at 32 px, 70 objects: ${dt.toFixed(0)} ms (target 300)`);
    expect(ms.filter((m) => m.present === false)).toHaveLength(0);
    // Generous: a busy test machine shouldn't fail it; the figure is what's reported.
    expect(dt).toBeLessThan(1500);
  });
});

describe("bounded work", () => {
  it("measures a crafted map of 20,000 huge objects in bounded time, and drops nothing for want of time", () => {
    const pic = new Pic(20, 20, snow);
    pic.crown(10 * GRID, 10 * GRID, () => 1.5 * GRID);
    const objs: MapObject[] = [];
    for (let i = 0; i < 20_000; i++) objs.push(obj(10 + (i % 7) * 0.01, 10, "vegetation/trees/pine_tree_04", { scale: { x: 16, y: 16 } }));
    const notes: string[] = [];
    const t0 = performance.now();
    const ms = measureObjects(level(objs), objs.map(() => OR.EVERGREEN), pic.sample(), pic.rect(), null, SPRITE_SIZES, notes);
    const dt = performance.now() - t0;
    console.log(`20,000 objects at scale 16: ${dt.toFixed(0)} ms`);
    expect(dt).toBeLessThan(15_000);
    expect(notes.join(" ")).toMatch(/too much/);
    // Whatever wasn't measured keeps its prior and isn't counted as missing.
    expect(ms.filter((m) => !m.measured && m.present === false)).toHaveLength(0);
  }, 60_000);
});

// ------------------------------------------------------------------ real maps

/** A picture resampled (area average) to PPS px a square, with its rectangle. */
function loadPicture(png: Uint8Array, squaresW: number, squaresH: number, originX = 0, originY = 0): { pic: PictureSample; rect: PictureRect } {
  const src = decodePng(png, zlib);
  const w = Math.round(squaresW * PPS), h = Math.round(squaresH * PPS);
  const rgba = new Uint8ClampedArray(w * h * 4);
  const fx = src.w / w, fy = src.h / h;
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * fy), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * fx), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * fx));
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        const o = (yy * src.w + xx) * 4;
        for (let c = 0; c < 4; c++) acc[c] += src.px[o + c];
        n++;
      }
      for (let c = 0; c < 4; c++) rgba[(y * w + x) * 4 + c] = Math.round(acc[c] / n);
    }
  }
  return { pic: { rgba, w, h }, rect: { rect: [originX * GRID, originY * GRID, (originX + squaresW) * GRID, (originY + squaresH) * GRID] } };
}

interface RealPair { name: string; map: string; picture: string; level?: string }
/** Correct sample pairs (design 2.4), snowy and green, with pictures small enough to decode quickly. */
const PAIRS: RealPair[] = [
  { name: "pelcs", map: `${SAMPLES}/fs_pelcs.dungeondraft_map`, picture: `${SAMPLES}/fs_pelcs.dd2vtt`, level: "Ground" },
  { name: "tulgi", map: `${SAMPLES}/fs_tulgi.dungeondraft_map`, picture: `${SAMPLES}/fs_tulgi_ground.png`, level: "Ground" },
  { name: "cavern", map: `${SAMPLES}/fs_cavern.dungeondraft_map`, picture: `${SAMPLES}/fs_cavern.png` },
  { name: "river", map: `${SAMPLES}/hd_river.dungeondraft_map`, picture: `${SAMPLES}/hd_river.dd2vtt` },
  { name: "hobble", map: `${SAMPLES}/ak_hobble.dungeondraft_map`, picture: `${SAMPLES}/ak_hobble.png` },
  { name: "waterfall", map: new URL("./fixtures/dd/waterfall.dungeondraft_map", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), picture: `${VERN}/waterfall.vtt.dd2vtt` },
];

function measurePair(p: RealPair): { map: DDMap; lv: Level; roles: ObjectRole[]; ms: Measured[]; notes: string[]; ms32: number } {
  const map = parseDungeondraftMap(fs.readFileSync(p.map, "utf8"));
  const lv = (p.level && map.world.levels.find((l) => l.label === p.level)) || map.world.levels.find((l) => l.id === map.header.currentLevel) || map.world.levels[0];
  let loaded: { pic: PictureSample; rect: PictureRect };
  if (p.picture.endsWith(".dd2vtt")) {
    const v = JSON.parse(fs.readFileSync(p.picture, "utf8")) as { image: string; resolution: { map_origin: { x: number; y: number }; map_size: { x: number; y: number } } };
    const bin = atob(v.image), png = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i);
    const r = v.resolution;
    loaded = loadPicture(png, r.map_size.x, r.map_size.y, r.map_origin.x, r.map_origin.y);
  } else {
    loaded = loadPicture(fs.readFileSync(p.picture), map.world.width, map.world.height);
  }
  const roles = lv.objects.map((o) => objectRole(defaultName(o.texture)));
  const notes: string[] = [];
  const t0 = performance.now();
  const ms = measureObjects(lv, roles, loaded.pic, loaded.rect, null, SPRITE_SIZES, notes);
  return { map, lv, roles, ms, notes, ms32: performance.now() - t0 };
}

for (const p of PAIRS) {
  describe.skipIf(!fs.existsSync(p.map) || !fs.existsSync(p.picture))(`real pair: ${p.name} (DD_FIXTURES, DD_VERN)`, () => {
    it("keeps nearly every tree, and doesn't lower the fit", () => {
      const { ms, roles, ms32 } = measurePair(p);
      const sum = measureSummary(ms, roles);
      console.log(`${p.name}: ${ms.length} objects, ${ms.filter((m) => m.measured).length} measured, ${sum.dropped}/${sum.tested} dropped, ` +
        `trees ${sum.treesDropped}/${sum.trees}, ${ms32.toFixed(0)} ms`);
      expect(sum.lowerFit).toBe(false);
      expect(sum.dropped).toBeLessThanOrEqual(Math.max(2, 0.1 * sum.tested));
      // Measured reaches stay within the clamp of their priors.
      for (const m of ms) for (const r of m.reach) expect(Number.isFinite(r) && r > 0).toBe(true);
    }, 60_000);
  });
}

describe.skipIf(!fs.existsSync(`${VERN}/waterfall.vtt.dd2vtt`))("waterfall's 1.2 export (DD_VERN)", () => {
  it("finds Vern's dotted grid and keeps all 37 trees", () => {
    const p = PAIRS[PAIRS.length - 1];
    const { lv, ms, roles, notes } = measurePair(p);
    expect(notes.join(" ")).toMatch(/grid/);
    const trees = roles.map((r, i) => [r, ms[i]] as const).filter(([r]) => r === OR.EVERGREEN || r === OR.DECIDUOUS || r === OR.BARE);
    // 17 pines, 6 eucalyptus and 4 mangroves, 2 oaks, 8 dead trees (4.1); one is under another's crown, so not tested.
    expect(trees).toHaveLength(37);
    for (const [, m] of trees) expect(m.present).not.toBe(false);
    expect(trees.filter(([, m]) => m.present === true).length).toBeGreaterThanOrEqual(35);
    // Its pine_tree_04s at scale 0.6 reach about 2 squares (read off by hand: 1.96-2.14).
    const pines = lv.objects.map((o, i) => [o, ms[i]] as const)
      .filter(([o]) => defaultName(o.texture) === "vegetation/trees/pine_tree_04" && o.scale.x === 0.6);
    expect(pines.length).toBeGreaterThan(0);
    for (const [, m] of pines) {
      const mean = m.reach.reduce((a, r) => a + r, 0) / 16 / GRID;
      expect(mean).toBeGreaterThan(1.7);
      expect(mean).toBeLessThan(2.4);
    }
  }, 60_000);
});

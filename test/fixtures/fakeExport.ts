// Fake Dungeondraft exports for the exact-seasons tests (design 6.3, WP9): pictures drawn from a
// season sidecar through the shared rasteriser (rasterSidecar), so the masks a test checks and
// the picture it bakes agree by construction. The look is Dungeondraft-like enough for the colour
// gates of seasonPixels.ts: snow textured bluish-white (lit and shaded), grass, earth and rock;
// water blue, ice pale; outlined crowns; bare trees as warm branch strokes; grey roofs and walls,
// plank floors; an optional baked grid (Kdir's dotted one, or solid lines). Crowns, bare trees,
// stumps, logs, rocks and structures carry a dark-and-light mark at their centre (a trunk's top,
// a knot, a crate's lid), so the luminance spread peaks there as on real sprites and the
// object-centre fit (2.4) gives the design's verdicts (ddFixtures.test.ts checks them).
//
// fakeExport(sc, pxPerSq, opts) draws a sidecar: terrain by role (one role a pixel, picked by
// smooth noise in proportion to the roles' weights, so a blended edge comes out jagged the way
// Dungeondraft paints one with smooth blending off), then the areas by role, then each object's
// art where rasterSidecar says it is the top one (a soft rim of ink where it covers part of a
// pixel), over the ground it hides (a second raster without the objects), so bare trees, tufts
// and smoke show the ground between their strokes. A sidecar without terrain (a roof level)
// gives a picture transparent where nothing is. Every texture is anchored in world units, so a
// crop or a whole-square shift of the picture shows the same pixels.
//
// fakeExportFromMap(map, levelKey, pxPerSq, opts) draws a parsed map the same way, for tests that
// need a picture before any sidecar exists (fit, measurement, presence). It first compiles the
// level with pictureSidecar: WHAT IS DRAWN, not what it means. Terrain slots as saved, every water
// body (WATER unless opts.water says ICE or KEEP), cave floors, materials, tiles and floor
// polygons, patterns, walls (half a wall, 32 units, each side), roofs, paths (the drawn width,
// pathDrawn, of default trails and roads, the whole ribbon otherwise) and every object with its
// sprite's true outline (opts.sprites, then FIXTURE_SPRITES, SPRITE_SIZES, ROLE_RADIUS; pack
// items PACK_SPRITE) turned by worldReach. Unlike the extractor it applies none of the design's
// interpretation (no wall-loop interiors, no crop, no measuring): it is the picture's source.

import { GRID, MS_EDGE_BUFFER, type BitGrid, type DDMap } from "../../src/client/dd/model";
import { REACH_DIRS, rasterSidecar } from "../../src/client/dd/raster";
import {
  AR, NAMED_ROLES, OR, TR, defaultName, materialRole, objectRole, pathDrawn, pathRole, patternRole, roofRole,
  terrainRole, type AreaRole, type ObjectRole, type TerrainRole,
} from "../../src/client/dd/roles";
import {
  DD_LAYER, NO_NAME, OBJ_FLAG, REACH_N, SIDECAR_CAPS, SIDECAR_UNITS,
  type BitmapLayer, type ObjectTable, type SeasonSidecar, type ShapeLayer, type TerrainGrid,
} from "../../src/client/dd/sidecar";
import { patternPolygon, pathRibbon, roofPolygon, wallRibbon, type Ribbon } from "../../src/client/dd/geometry";
import { EXTRACTOR_VERSION } from "../../src/client/dd/extract";
import { ROLE_RADIUS, type SpriteSizes } from "../../src/client/dd/measure";
import { SPRITE_SIZES } from "../../src/client/dd/spriteSizes";
import { FIXTURE_SPRITES, PACK_SPRITE, rotByte, worldReach, type Pt } from "./ddSynthetic";

export interface FakePicture {
  /** RGBA, 4 bytes a pixel, rows top to bottom. */
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
}

export interface FakeExportOptions {
  /** A grid baked into the picture: Kdir's dotted lines, or solid ones. None by default. */
  grid?: "dotted" | "solid";
  /** The picture's rectangle in world units [x0, y0, x1, y1] (default: the sidecar's META.rect). */
  rect?: [number, number, number, number];
  /** The picture's size in pixels (default: the rectangle at pxPerSq). */
  size?: [number, number];
  /** Bare trees' and tufts' stroke widths, times the default (thin strokes: 0.5). */
  stroke?: number;
  /** Changes the noise (not the layout). */
  seed?: number;
}

export interface FakeMapOptions extends Omit<FakeExportOptions, "rect"> {
  /** Export only this part of the map: [x, y, w, h] in squares (default: the whole map). */
  crop?: [number, number, number, number];
  /** Draw the content moved by this many squares (an object at x appears at x + shift). */
  shift?: Pt;
  /** Indices into the level's objects to leave out of the picture. */
  erase?: number[];
  /** Indices into the level's objects drawn with a snow cap (crowns only). */
  capped?: number[];
  /** Sprite outlines by default short name, ahead of FIXTURE_SPRITES and SPRITE_SIZES. */
  sprites?: SpriteSizes;
  /** A pack object's sprite profile at scale 1 (default PACK_SPRITE, a 2-square crown). */
  packSprite?: number[];
  /** Per water body (depth 1, in tree order): what the picture shows. Default WATER. */
  water?: Array<"WATER" | "ICE" | "KEEP">;
}

type RGB = [number, number, number];

// ------------------------------------------------------------------ noise

function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, -2048144777)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0-1, on a lattice `step` world units apart (anchored in the world). */
function vnoise(wx: number, wy: number, step: number, s: number): number {
  const fx = wx / step, fy = wy / step;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let tx = fx - ix, ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * tx + (c - a + (d - c - b + a) * tx) * ty;
}

/** Value noise's distribution is close to normal round 0.5 (sd 0.225): mapped to near uniform by its CDF (logistic). */
const uniform = (n: number) => 1 / (1 + Math.exp((-1.702 * (n - 0.5)) / 0.225));

const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export const INK: RGB = [24, 30, 24];
const SQ = GRID;

/** Colours the tests may check against (the shared ones; the rest are local to their role). */
export const FAKE_COLOURS = {
  snowLit: [236, 240, 246] as RGB,
  snowShade: [190, 203, 222] as RGB,
  grassA: [78, 124, 58] as RGB,
  grassB: [100, 146, 72] as RGB,
  rockA: [112, 108, 104] as RGB,
  rockB: [140, 136, 130] as RGB,
  water: [52, 108, 146] as RGB,
  ice: [206, 228, 240] as RGB,
  roof: [126, 124, 130] as RGB,
  wall: [76, 74, 76] as RGB,
  floor: [150, 106, 66] as RGB,
  /** Branch strokes of bare trees. */
  bark: [112, 72, 50] as RGB,
  /** Pack items: as drawn, a frosted teal crown. */
  pack: [40, 92, 84] as RGB,
  /** KEEP areas, e.g. waterfall's yellow-orange "water". */
  keep: [228, 176, 82] as RGB,
};

// ------------------------------------------------------------------ terrain and areas

function terrainColour(role: TerrainRole, wx: number, wy: number, g: number, s: number): RGB {
  const grain = (g - 0.5) * 10;
  switch (role) {
    case TR.SNOW: {
      let t = (0.7 * vnoise(wx, wy, 1.4 * SQ, s + 1) + 0.3 * vnoise(wx, wy, 0.5 * SQ, s + 2) - 0.35) / 0.4;
      t = smooth(t);
      const c = lerp(FAKE_COLOURS.snowShade, FAKE_COLOURS.snowLit, t);
      return [c[0] + grain * 0.6, c[1] + grain * 0.6, c[2] + grain * 0.4];
    }
    case TR.ICE: return [204 + grain, 226 + grain, 238 + grain * 0.5];
    case TR.GRASS: {
      const c = lerp(FAKE_COLOURS.grassA, FAKE_COLOURS.grassB, vnoise(wx, wy, 0.3 * SQ, s + 3));
      return [c[0] + grain, c[1] + grain, c[2] + grain * 0.6];
    }
    case TR.EARTH: { const n = vnoise(wx, wy, 0.4 * SQ, s + 4) * 16; return [112 + n + grain, 94 + n + grain, 76 + n * 0.6 + grain]; }
    case TR.SAND: { const n = vnoise(wx, wy, 0.5 * SQ, s + 5) * 14; return [198 + n + grain, 178 + n + grain, 134 + n + grain]; }
    case TR.ROCK: {
      const c = lerp(FAKE_COLOURS.rockA, FAKE_COLOURS.rockB, vnoise(wx, wy, 0.35 * SQ, s + 6));
      if (Math.abs(vnoise(wx, wy, 0.6 * SQ, s + 7) - 0.5) < 0.02) return [84, 82, 80];
      return [c[0] + grain, c[1] + grain, c[2] + grain];
    }
    case TR.PAVED: return cobbles(wx, wy, g, s);
    default: { const n = vnoise(wx, wy, 0.3 * SQ, s + 8) * 24; return [114 + n, 98 + n * 0.6, 128 + n]; }
  }
}

function cobbles(wx: number, wy: number, g: number, s: number): RGB {
  const cell = 0.25 * SQ;
  const row = Math.floor(wy / cell);
  const u = (wx / cell + (row & 1) * 0.5) % 1, v = (wy / cell) % 1;
  if (u < 0.1 || v < 0.1) return [98, 96, 92];
  const k = hash(Math.floor(wx / cell + (row & 1) * 0.5), row, s + 9) * 18 + (g - 0.5) * 8;
  return [138 + k, 134 + k, 128 + k];
}

function areaColour(role: AreaRole, wx: number, wy: number, g: number, s: number): RGB {
  const grain = (g - 0.5) * 8;
  switch (role) {
    case AR.WATER: {
      const n = (vnoise(wx, wy, 0.4 * SQ, s + 11) - 0.5) * 20;
      const c = FAKE_COLOURS.water;
      return [c[0] + n * 0.5, c[1] + n, c[2] + n];
    }
    case AR.ICE:
      if (Math.abs(vnoise(wx, wy, 0.5 * SQ, s + 12) - 0.5) < 0.02) return [160, 190, 210];
      return [FAKE_COLOURS.ice[0] + grain, FAKE_COLOURS.ice[1] + grain, FAKE_COLOURS.ice[2] + grain * 0.5];
    case AR.FLOOR: {
      const plank = SQ / 3;
      const row = Math.floor(wy / plank);
      const v = (wy / plank) % 1;
      const u = (wx / (1.5 * SQ) + hash(row, 0, s + 13)) % 1;
      if (v < 0.06 || u < 0.02) return [96, 64, 40];
      const k = hash(row, Math.floor(wx / (1.5 * SQ) + hash(row, 0, s + 13)), s + 14) * 14;
      return [FAKE_COLOURS.floor[0] - k + grain, FAKE_COLOURS.floor[1] - k + grain, FAKE_COLOURS.floor[2] - k * 0.6 + grain];
    }
    case AR.CAVE: { const n = vnoise(wx, wy, 0.3 * SQ, s + 15) * 16; return [96 + n + grain, 88 + n + grain, 80 + n + grain]; }
    case AR.CAVE_RIM: return [64 + grain, 60 + grain, 58 + grain];
    case AR.ROOF: {
      const rowH = 0.25 * SQ, row = Math.floor(wy / rowH);
      const v = (wy / rowH) % 1, u = (wx / (0.33 * SQ) + (row & 1) * 0.5) % 1;
      if (v < 0.12 || u < 0.06) return [92, 90, 98];
      const c = FAKE_COLOURS.roof;
      return [c[0] + grain, c[1] + grain, c[2] + grain];
    }
    case AR.WALL: { const n = (vnoise(wx, wy, 0.12 * SQ, s + 16) - 0.5) * 16; const c = FAKE_COLOURS.wall; return [c[0] + n, c[1] + n, c[2] + n]; }
    case AR.PATH_EARTH: { const n = vnoise(wx, wy, 0.25 * SQ, s + 17) * 18; return [118 + n + grain, 96 + n + grain, 72 + n * 0.6 + grain]; }
    case AR.PATH_PAVED:
    case AR.PAVED: return cobbles(wx, wy, g, s);
    case AR.PATH_KEEP: {
      const n = vnoise(wx, wy, 0.15 * SQ, s + 18);
      return n < 0.35 ? [60, 54, 50] : [96 + grain, 86 + grain, 78 + grain];
    }
    default: {
      const n = (vnoise(wx, wy, 0.3 * SQ, s + 19) - 0.5) * 24;
      const c = FAKE_COLOURS.keep;
      return [c[0] + n, c[1] + n, c[2] + n * 0.5];
    }
  }
}

// ------------------------------------------------------------------ objects

/** REACH_DIRS's angles, increasing (clockwise on screen) from sample 0's. */
const DIR_ANGLE: Float64Array = (() => {
  const a = new Float64Array(REACH_N);
  for (let k = 0; k < REACH_N; k++) {
    let v = Math.atan2(REACH_DIRS[k * 2 + 1], REACH_DIRS[k * 2]);
    if (k > 0) while (v < a[k - 1]) v += 2 * Math.PI;
    a[k] = v;
  }
  return a;
})();

interface Thing {
  role: ObjectRole;
  cx: number;
  cy: number;
  /** World units, REACH_DIRS order. */
  reach: Float64Array;
  capped: boolean;
  /** Radians. */
  rot: number;
  /** The shortest reach, world units. */
  inner: number;
  seed: number;
  /** Segments for strokes: x0, y0, x1, y1 (relative to the centre), half-width; world units. */
  strokes: Float64Array | null;
}

/** The 16-gon's radius along (dx, dy) (relative to the centre). */
function outlineRadius(t: Thing, dx: number, dy: number): number {
  let a = Math.atan2(dy, dx);
  while (a < DIR_ANGLE[0]) a += 2 * Math.PI;
  while (a >= DIR_ANGLE[0] + 2 * Math.PI) a -= 2 * Math.PI;
  let k = REACH_N - 1;
  for (let i = 1; i < REACH_N; i++) if (a < DIR_ANGLE[i]) { k = i - 1; break; }
  const j = (k + 1) % REACH_N;
  const ax = t.reach[k] * REACH_DIRS[k * 2], ay = t.reach[k] * REACH_DIRS[k * 2 + 1];
  const bx = t.reach[j] * REACH_DIRS[j * 2], by = t.reach[j] * REACH_DIRS[j * 2 + 1];
  const ex = bx - ax, ey = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const den = ux * ey - uy * ex;
  if (Math.abs(den) < 1e-12) return Math.max(t.reach[k], t.reach[j]);
  return (ax * ey - ay * ex) / den;
}

/** A bare tree's limbs: 8 to the outline's even vertices, each forking toward the odd ones beside it. */
function bareStrokes(t: Thing, width: number): Float64Array {
  const seg: number[] = [];
  const base = 0.05 * SQ * width, mid = 0.032 * SQ * width, twig = 0.022 * SQ * width;
  for (let k = 0; k < REACH_N; k += 2) {
    const ex = t.reach[k] * REACH_DIRS[k * 2] * 0.98, ey = t.reach[k] * REACH_DIRS[k * 2 + 1] * 0.98;
    const mx = ex * 0.55, my = ey * 0.55;
    seg.push(0, 0, mx, my, base, mx, my, ex, ey, mid);
    for (const j of [(k + 1) % REACH_N, (k + REACH_N - 1) % REACH_N]) {
      seg.push(mx, my, t.reach[j] * REACH_DIRS[j * 2] * 0.96, t.reach[j] * REACH_DIRS[j * 2 + 1] * 0.96, twig);
    }
  }
  return Float64Array.from(seg);
}

/** Blades of a tuft or reeds: 7 from the centre, 0.6-1.0 of the outline. */
function bladeStrokes(t: Thing, width: number): Float64Array {
  const seg: number[] = [];
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * 2 * Math.PI + hash(b, 1, t.seed) * 0.6;
    const dx = Math.cos(a), dy = Math.sin(a);
    const r = outlineRadius(t, dx, dy) * (0.6 + 0.4 * hash(b, 2, t.seed));
    seg.push(0, 0, dx * r, dy * r, 0.02 * SQ * width);
  }
  return Float64Array.from(seg);
}

/** Distance from (px, py) to the nearest stroke's centre line, less its half-width (negative inside). */
function strokeDist(st: Float64Array, px: number, py: number): number {
  let best = Infinity;
  for (let i = 0; i < st.length; i += 5) {
    const ax = st[i], ay = st[i + 1], bx = st[i + 2], by = st[i + 3];
    const ex = bx - ax, ey = by - ay;
    const l2 = ex * ex + ey * ey;
    let u = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const d = Math.hypot(px - ax - u * ex, py - ay - u * ey) - st[i + 4];
    if (d < best) best = d;
  }
  return best;
}

const OUTLINED: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.EVERGREEN, OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB, OR.ROCK,
  OR.DEADWOOD, OR.STUMP, OR.STRUCTURE, OR.OPAQUE, OR.MUSHROOM, OR.FIRE]);

/** The centre mark's radius at most (it also stays within 0.75 of the object's shortest reach). */
const MARK = 0.3 * SQ;

/** The centre mark's dark and light colours by role (none of them snow, water or, for the wood, vegetation colours). */
const MARKS: ReadonlyMap<ObjectRole, readonly [RGB, RGB]> = new Map<ObjectRole, readonly [RGB, RGB]>([
  [OR.EVERGREEN, [[22, 48, 28], [150, 196, 110]]],
  [OR.DECIDUOUS, [[28, 52, 26], [176, 210, 120]]],
  [OR.SHRUB, [[28, 52, 26], [176, 210, 120]]],
  [OR.FLOWER_SHRUB, [[28, 52, 26], [176, 210, 120]]],
  [OR.BARE, [[30, 20, 16], [228, 204, 166]]],
  [OR.STUMP, [[40, 26, 18], [222, 190, 140]]],
  [OR.DEADWOOD, [[40, 26, 18], [222, 190, 140]]],
  [OR.ROCK, [[36, 34, 32], [212, 208, 198]]],
  [OR.STRUCTURE, [[34, 22, 14], [236, 200, 140]]],
]);
const CAP_MARK: readonly [RGB, RGB] = [[96, 104, 120], [240, 244, 250]];

/**
 * The centre mark: dark and light bands round the centre (a trunk's top, a knot, a boulder's
 * crown, a crate's lid: squares in the crate's own frame), or null outside it. Real sprites are
 * busiest at their centres, so the luminance spread in a small box there is higher than half a
 * square away: the peak the object-centre fit (2.4) looks for. Without it the flat insides and the
 * ink outline of small objects put the peak half a square out, and the fit can't say "yes".
 */
function centreMark(t: Thing, lx: number, ly: number, d: number): RGB | null {
  const pal = t.capped && (t.role === OR.DECIDUOUS || t.role === OR.SHRUB || t.role === OR.FLOWER_SHRUB) ? CAP_MARK : MARKS.get(t.role);
  if (!pal) return null;
  const rc = Math.min(MARK, 0.75 * t.inner);
  let q = d / rc;
  if (t.role === OR.STRUCTURE) {
    const c = Math.cos(t.rot), s = Math.sin(t.rot);
    q = Math.max(Math.abs(c * lx + s * ly), Math.abs(-s * lx + c * ly)) / rc;
  }
  if (q >= 1) return null;
  return q < 0.35 || (q >= 0.6 && q < 0.85) ? pal[0] : pal[1];
}

/**
 * The colour of object `t` at world (wx, wy), over `base` (what lies under it), or null where
 * the object is see-through (between a bare tree's limbs or a tuft's blades).
 */
function objectArt(t: Thing, wx: number, wy: number, upp: number, g: number, base: RGB, stroke: number): RGB | null {
  const lx = wx - t.cx, ly = wy - t.cy;
  const d = Math.hypot(lx, ly);
  const r = outlineRadius(t, lx, ly);
  const edge = (r - d) / upp;
  const lit = 1 + 0.12 * (-(lx + ly) / (1.41 * Math.max(r, 1)));
  if (OUTLINED.has(t.role) && edge < 1.5) return INK;
  const mark = centreMark(t, lx, ly, d);
  if (mark) return mark;
  switch (t.role) {
    case OR.EVERGREEN: {
      const n = vnoise(wx, wy, 0.07 * SQ, t.seed);
      let c: RGB = n > 0.5 ? [62, 108, 64] : [44, 86, 52];
      if (Math.abs(Math.sin(Math.atan2(ly, lx) * 4 + t.seed)) < 0.12 && d > 0.15 * r) c = mul(c, 0.75);
      if (g < 0.05) c = [214, 226, 218];
      return mul(c, lit);
    }
    case OR.DECIDUOUS:
    case OR.SHRUB:
    case OR.FLOWER_SHRUB: {
      if (t.capped && d < 0.78 * r) {
        const q = d / (0.78 * r);
        const ring = [0.3, 0.52, 0.72].some((v) => Math.abs(q - v) < 0.025) ? 0.78 : 1;
        const l = 1 - 0.1 * ((lx + ly) / Math.max(r, 1));
        return [226 * l * ring, 231 * l * ring, 238 * l * ring];
      }
      const c = vnoise(wx, wy, (t.role === OR.DECIDUOUS ? 0.22 : 0.12) * SQ, t.seed);
      let col: RGB = c < 0.32 ? [40, 72, 40] : c > 0.6 ? [96, 146, 78] : [74, 124, 64];
      if (t.role === OR.FLOWER_SHRUB && g < 0.12) col = [226, 128, 170];
      return mul(col, lit);
    }
    case OR.BARE:
    case OR.ROOTS: {
      if (!t.strokes) t.strokes = bareStrokes(t, stroke * (t.role === OR.ROOTS ? 1.5 : 1));
      const sd = strokeDist(t.strokes, lx, ly) / upp;
      if (sd < 0) return t.role === OR.ROOTS ? [96, 66, 42] : FAKE_COLOURS.bark;
      if (sd < 0.7) return INK;
      return null;
    }
    case OR.GRASS:
    case OR.REEDS: {
      if (!t.strokes) t.strokes = bladeStrokes(t, stroke);
      const sd = strokeDist(t.strokes, lx, ly) / upp;
      if (sd < 0) return t.role === OR.GRASS ? [92, 110, 54] : d > 0.7 * r ? [150, 128, 80] : [120, 128, 70];
      if (sd < 0.5) return t.role === OR.GRASS ? [60, 74, 38] : [84, 90, 50];
      return null;
    }
    case OR.FLOWERS: {
      const cell = 0.08 * SQ, h = hash(Math.floor(wx / cell), Math.floor(wy / cell), t.seed);
      if (h < 0.25) return ([[230, 200, 60], [220, 90, 120], [240, 240, 240]] as RGB[])[Math.floor(h * 12) % 3];
      if (h < 0.4) return [70, 112, 50];
      return null;
    }
    case OR.CROP: {
      const c = Math.cos(t.rot), s = Math.sin(t.rot);
      const u = ((-lx * s + ly * c) / (0.2 * SQ) + 100) % 1;
      return u < 0.55 ? [80, 130, 60] : null;
    }
    case OR.LITTER: return g < 0.35 ? (g < 0.15 ? [168, 98, 44] : [140, 70, 36]) : null;
    case OR.MUSHROOM: return g < 0.08 ? [240, 236, 228] : [182, 52, 40];
    case OR.DEADWOOD: {
      const c = Math.cos(t.rot), s = Math.sin(t.rot);
      const u = ((-lx * s + ly * c) / (0.06 * SQ) + 100) % 1;
      return mul(u < 0.2 ? [96, 66, 40] : [122, 86, 54], lit);
    }
    case OR.STUMP: return ((d / (0.25 * Math.max(r, 1))) % 1) < 0.15 ? [92, 64, 40] : mul([124, 88, 56], lit);
    case OR.ROCK: {
      const c = Math.cos(t.rot + 0.7), s = Math.sin(t.rot + 0.7);
      if (d < 0.6 * r && Math.abs(lx * s - ly * c) / upp < 0.6) return [96, 94, 92];
      return mul([150, 146, 140], 1 + 0.25 * (-(lx + ly) / (1.41 * Math.max(r, 1))));
    }
    case OR.SNOW: return vnoise(wx, wy, 0.2 * SQ, t.seed) < 0.4 ? [212, 222, 238] : [238, 242, 248];
    case OR.ICE: return edge < 1.2 ? [150, 190, 210] : [196, 224, 240];
    case OR.WATER_FX: return vnoise(wx, wy, 0.1 * SQ, t.seed) > 0.5 ? [226, 238, 244] : lerp(base, [200, 226, 236], 0.5);
    case OR.EFFECT: return lerp(base, [150, 150, 150], 0.45);
    case OR.FIRE: return d < 0.45 * r ? [255, 214, 90] : [230, 112, 40];
    case OR.STRUCTURE: {
      const c = Math.cos(t.rot), s = Math.sin(t.rot);
      const u = ((-lx * s + ly * c) / (0.18 * SQ) + 100) % 1;
      if (u < 0.08) return [92, 62, 38];
      return Math.floor((-lx * s + ly * c) / (0.18 * SQ) + 100) % 2 ? [158, 112, 66] : [140, 98, 58];
    }
    case OR.OPAQUE: {
      if (g < 0.25) return [222, 234, 238];
      return mul(vnoise(wx, wy, 0.18 * SQ, t.seed) > 0.5 ? [58, 116, 102] : FAKE_COLOURS.pack, lit);
    }
    default: return null;
  }
}

/** The colour of a pixel at an object's soft rim (no top object there): ink for outlined things, else see-through. */
function rimArt(role: ObjectRole): RGB | null {
  if (OUTLINED.has(role)) return INK;
  if (role === OR.SNOW) return [232, 238, 246];
  return null;
}

// ------------------------------------------------------------------ the painter

const NO_OBJECTS: ObjectTable = {
  n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0),
  flags: new Uint8Array(0), name: new Uint16Array(0), reach: new Uint16Array(0),
};

/** A picture of the sidecar: see the header. */
export function fakeExport(sc: SeasonSidecar, pxPerSq: number, opts: FakeExportOptions = {}): FakePicture {
  const [x0, y0, x1, y1] = opts.rect ?? sc.meta.rect;
  const w = opts.size?.[0] ?? Math.max(1, Math.round(((x1 - x0) / GRID) * pxPerSq));
  const h = opts.size?.[1] ?? Math.max(1, Math.round(((y1 - y0) / GRID) * pxPerSq));
  const view: SeasonSidecar = { ...sc, meta: { ...sc.meta, rect: [x0, y0, x1, y1] } };
  const full = rasterSidecar(view, { w, h });
  const ground = rasterSidecar({ ...view, objects: NO_OBJECTS }, { w, h });
  const seed = opts.seed ?? 0;
  const stroke = opts.stroke ?? 1;
  const ux = (x1 - x0) / w, uy = (y1 - y0) / h, upp = (ux + uy) / 2;
  const things = thingsOf(sc);
  const tRoles = [...ground.terrain.keys()], tPlanes = tRoles.map((r) => ground.terrain.get(r)!);
  const aRoles = [...ground.area.keys()], aPlanes = aRoles.map((r) => ground.area.get(r)!);
  const oRoles = [...full.objects.keys()], oPlanes = oRoles.map((r) => full.objects.get(r)!);
  const opaque = sc.terrain !== null;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    const wy = y0 + (py + 0.5) * uy;
    const gy = Math.floor(wy / uy);
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const wx = x0 + (px + 0.5) * ux;
      const g = hash(Math.floor(wx / ux), gy, seed + 77);
      // The ground: one terrain role (weight plus noise), then the areas by coverage.
      let tSum = 0;
      for (const p of tPlanes) tSum += p[i];
      let cr = 0, cg = 0, cb = 0, cov = 0;
      if (tSum > 0) {
        // The role whose share of the weights holds this pixel's (near uniform) noise value.
        const u = uniform(vnoise(wx, wy, 0.18 * SQ, seed * 31 + 5)) * tSum;
        let role = tRoles[0], cum = 0;
        for (let k = 0; k < tRoles.length; k++) {
          const wgt = tPlanes[k][i];
          if (wgt === 0) continue;
          role = tRoles[k];
          cum += wgt;
          if (u < cum) break;
        }
        const c = terrainColour(role, wx, wy, g, seed);
        cr += c[0] * tSum; cg += c[1] * tSum; cb += c[2] * tSum; cov += tSum;
      }
      for (let k = 0; k < aRoles.length; k++) {
        const a = aPlanes[k][i];
        if (a === 0) continue;
        const c = areaColour(aRoles[k], wx, wy, g, seed);
        cr += c[0] * a; cg += c[1] * a; cb += c[2] * a; cov += a;
      }
      const base: RGB = cov > 0 ? [cr / cov, cg / cov, cb / cov] : [0, 0, 0];
      let baseA = opaque ? 1 : Math.min(1, cov / 255);
      if (opaque && cov === 0) baseA = 0;
      // The objects over it.
      let oSum = 0, oBest = 0, oRole: ObjectRole | null = null;
      for (let k = 0; k < oPlanes.length; k++) {
        const v = oPlanes[k][i];
        oSum += v;
        if (v > oBest) { oBest = v; oRole = oRoles[k]; }
      }
      let out = base, outA = baseA;
      if (oSum > 0) {
        const a = Math.min(1, oSum / 255);
        const top = full.top[i];
        const art = top > 0 ? objectArt(things[top - 1], wx, wy, upp, g, base, stroke) : oRole !== null ? rimArt(oRole) : null;
        if (art) {
          outA = a + baseA * (1 - a);
          const kb = outA > 0 ? (baseA * (1 - a)) / outA : 0, ka = outA > 0 ? a / outA : 0;
          out = [art[0] * ka + base[0] * kb, art[1] * ka + base[1] * kb, art[2] * ka + base[2] * kb];
        }
      }
      if (opts.grid && onGrid(wx, wy, ux, uy, opts.grid)) out = [out[0] * 0.8, out[1] * 0.82, out[2] * 0.85];
      const o = i * 4;
      rgba[o] = out[0];
      rgba[o + 1] = out[1];
      rgba[o + 2] = out[2];
      rgba[o + 3] = Math.round(outA * 255);
    }
  }
  return { rgba, w, h };
}

/** A pixel on a grid line (every square, in the world): the pixel whose span [left, right) holds x = k * 256 (or y). Dotted: 3 pixels on, 3 off. */
function onGrid(wx: number, wy: number, ux: number, uy: number, kind: "dotted" | "solid"): boolean {
  const holds = (lo: number, hi: number) => Math.ceil(lo / SQ - 1e-9) * SQ < hi - 1e-9;
  const vx = holds(wx - ux / 2, wx + ux / 2);
  const hy = holds(wy - uy / 2, wy + uy / 2);
  if (!vx && !hy) return false;
  if (kind === "solid") return true;
  return vx ? Math.floor(wy / uy) % 6 < 3 : Math.floor(wx / ux) % 6 < 3;
}

/** The sidecar's objects with their runtime roles (as rasterSidecar derives them). */
function thingsOf(sc: SeasonSidecar): Thing[] {
  const o = sc.objects;
  const out: Thing[] = [];
  for (let i = 0; i < o.n; i++) {
    let role = o.role[i] as ObjectRole;
    if (o.name[i] !== NO_NAME && o.name[i] < sc.meta.names.length) {
      const r = objectRole(sc.meta.names[o.name[i]]);
      if (NAMED_ROLES.has(r)) role = r;
    }
    const reach = new Float64Array(REACH_N);
    for (let k = 0; k < REACH_N; k++) reach[k] = o.reach[i * REACH_N + k] / SIDECAR_UNITS.reach;
    out.push({
      role, cx: o.x[i] / SIDECAR_UNITS.coord, cy: o.y[i] / SIDECAR_UNITS.coord, reach,
      capped: (o.flags[i] & OBJ_FLAG.CAPPED) !== 0, rot: (o.rot[i] / 256) * 2 * Math.PI, inner: Math.min(...reach),
      seed: (o.x[i] * 7 + o.y[i] * 13) | 0, strokes: null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ a parsed map, as drawn

/** The parsed map's level drawn as fakeExport draws a sidecar (see the header): the picture's source, not the extractor. */
export function fakeExportFromMap(map: DDMap, levelKey: string, pxPerSq: number, opts: FakeMapOptions = {}): FakePicture {
  return fakeExport(pictureSidecar(map, levelKey, opts), pxPerSq, { grid: opts.grid, size: opts.size, stroke: opts.stroke, seed: opts.seed });
}

const C16 = SIDECAR_UNITS.coord;

function shapeOf(role: AreaRole, layer: number, rings: Float64Array[], rule: 0 | 1): ShapeLayer | null {
  const pts: number[] = [], ends: number[] = [];
  for (const r of rings) {
    if (r.length < 6) continue;
    for (let i = 0; i < r.length; i++) pts.push(Math.round(r[i] * C16));
    ends.push(pts.length / 2);
  }
  return ends.length ? { role, layer, rule, pts: Int32Array.from(pts), ringEnds: Uint32Array.from(ends) } : null;
}

/** A ring with a positive signed area (y down: clockwise on screen), so non-zero fills take the union. */
function positive(r: Float64Array): Float64Array {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; }
  if (a >= 0) return r;
  const out = new Float64Array(r.length);
  for (let i = 0; i < n; i++) { out[i * 2] = r[(n - 1 - i) * 2]; out[i * 2 + 1] = r[(n - 1 - i) * 2 + 1]; }
  return out;
}

/**
 * A ribbon as rings for a non-zero fill: a quad a segment (lengthened by its half-width at both
 * ends when `square`, which gives a wall's square corners) and, otherwise, an octagon at each
 * inner vertex. `share` narrows the ribbon (a path's drawn width).
 */
function ribbonRings(rb: Ribbon, square: boolean, share = 1): Float64Array[] {
  const out: Float64Array[] = [];
  const n = rb.line.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    let ax = rb.line[i * 2], ay = rb.line[i * 2 + 1], bx = rb.line[i * 2 + 2], by = rb.line[i * 2 + 3];
    const ha = rb.halfWidth[i] * share, hb = rb.halfWidth[i + 1] * share;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    const tx = (bx - ax) / len, ty = (by - ay) / len;
    if (square) { ax -= tx * ha; ay -= ty * ha; bx += tx * hb; by += ty * hb; }
    const nx = -ty, ny = tx;
    out.push(positive(Float64Array.from([ax + nx * ha, ay + ny * ha, bx + nx * hb, by + ny * hb, bx - nx * hb, by - ny * hb, ax - nx * ha, ay - ny * ha])));
    if (!square && i > 0) out.push(octagon(ax, ay, ha));
  }
  return out;
}

function octagon(cx: number, cy: number, r: number): Float64Array {
  const R = r / Math.cos(Math.PI / 8);
  const out = new Float64Array(16);
  for (let k = 0; k < 8; k++) { out[k * 2] = cx + R * Math.cos((k + 0.5) * Math.PI / 4); out[k * 2 + 1] = cy + R * Math.sin((k + 0.5) * Math.PI / 4); }
  return out;
}

/** A parsed bit grid as a sidecar bitmap (sample (i, j) at world ((i - buffer) * step, (j - buffer) * step)). */
function bitmapOf(role: AreaRole, layer: number, g: BitGrid): BitmapLayer | null {
  const n = g.width * g.height;
  if (n > SIDECAR_CAPS.bitmapBits) return null;
  const bits = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (g.bits[i]) bits[i >> 3] |= 1 << (i & 7);
  return { role, layer, step: g.step, ox: -g.step * MS_EDGE_BUFFER, oy: -g.step * MS_EDGE_BUFFER, w: g.width, h: g.height, bits };
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The sprite profile (scale 1, sprite frame) a default object is drawn with. */
function spriteFor(name: string | null, role: ObjectRole, opts: FakeMapOptions): ArrayLike<number> {
  if (name !== null) {
    for (const t of [opts.sprites, FIXTURE_SPRITES, SPRITE_SIZES]) {
      if (t && own(t, name) && t[name] && t[name].reach.length === REACH_N) return t[name].reach;
    }
  }
  return new Array<number>(REACH_N).fill(ROLE_RADIUS[role] ?? ROLE_RADIUS[OR.STRUCTURE]);
}

/**
 * The level as drawn, as a sidecar fakeExport can paint (see the header). Its META.rect is the
 * picture's rectangle (crop, shifted); everything else is the whole level.
 */
export function pictureSidecar(map: DDMap, levelKey: string, opts: FakeMapOptions = {}): SeasonSidecar {
  const L = map.world.levels.find((l) => l.key === levelKey);
  if (!L) throw new Error(`fakeExport: no level ${levelKey}`);
  const W = map.world.width, H = map.world.height;
  const names: string[] = [];
  const nameIx = (n: string) => { let i = names.indexOf(n); if (i < 0) { names.push(n); i = names.length - 1; } return i; };

  let terrain: TerrainGrid | null = null;
  const t = L.terrain;
  if (t && t.enabled) {
    const n = t.width * t.height;
    const used: number[] = [];
    for (let s = 0; s < t.slotCount; s++) {
      for (let i = 0; i < n; i++) if (t.weights[s * n + i] > 0) { used.push(s); break; }
    }
    if (used.length) {
      const w = new Uint8Array(used.length * n);
      used.forEach((s, k) => w.set(t.weights.subarray(s * n, (s + 1) * n), k * n));
      terrain = {
        tps: 4, tx0: 0, ty0: 0, tw: t.width, th: t.height, w,
        slots: used.map((s) => {
          const nm = defaultName(t.slots[s]);
          return { name: nm === null ? NO_NAME : nameIx(nm), role: terrainRole(nm) };
        }),
      };
    }
  }

  const shapes: ShapeLayer[] = [];
  const bitmaps: BitmapLayer[] = [];
  const push = (s: ShapeLayer | null) => { if (s) shapes.push(s); };
  const pushB = (b: BitmapLayer | null) => { if (b && bitmaps.length < SIDECAR_CAPS.bitmaps) bitmaps.push(b); };

  // Water: one shape a body, even-odd over the body and everything inside it.
  (L.water.root?.children ?? []).forEach((body, i) => {
    const rings: Float64Array[] = [];
    const stack = [body];
    while (stack.length) {
      const nd = stack.pop()!;
      if (!nd.isOpen && nd.polygon.length >= 6) rings.push(nd.polygon);
      stack.push(...nd.children);
    }
    const kind = opts.water?.[i] ?? "WATER";
    push(shapeOf(kind === "ICE" ? AR.ICE : kind === "KEEP" ? AR.KEEP : AR.WATER, DD_LAYER.WATER, rings, 0));
  });
  if (L.cave?.floor) pushB(bitmapOf(AR.CAVE, DD_LAYER.CAVE, L.cave.floor));
  for (const m of L.materials) if (m.mask) pushB(bitmapOf(materialRole(defaultName(m.texture)), m.layer, m.mask));
  if (L.tiles) {
    const g: BitGrid = { width: L.tiles.width, height: L.tiles.height, step: GRID, bits: new Uint8Array(L.tiles.cells.length) };
    let any = false;
    L.tiles.cells.forEach((c, i) => { if (c >= 0) { g.bits[i] = 1; any = true; } });
    if (any) {
      const b = bitmapOf(AR.FLOOR, DD_LAYER.FLOOR, g);
      if (b) { b.ox = GRID / 2; b.oy = GRID / 2; pushB(b); }
    }
  }
  push(shapeOf(AR.FLOOR, DD_LAYER.FLOOR, L.floorPolygons.map(positive), 1));
  for (const p of L.patterns) push(shapeOf(patternRole(defaultName(p.texture)), p.layer, [patternPolygon(p)], 0));
  push(shapeOf(AR.WALL, DD_LAYER.WALL, L.walls.flatMap((wl) => ribbonRings(wallRibbon(wl), true)), 1));
  for (const r of L.roofs) push(shapeOf(roofRole(defaultName(r.texture)), DD_LAYER.ROOF, [roofPolygon(r)], 0));
  for (const p of L.paths) {
    const nm = defaultName(p.texture);
    const role = pathRole(nm);
    const share = role === AR.PATH_KEEP ? 1 : pathDrawn(nm);
    push(shapeOf(role, p.layer, ribbonRings(pathRibbon(p), false, share), 1));
  }

  const erase = new Set(opts.erase ?? []), capped = new Set(opts.capped ?? []);
  const list = L.objects.map((o, i) => ({ o, i })).filter(({ i }) => !erase.has(i));
  const n = list.length;
  const objects: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  list.forEach(({ o, i }, k) => {
    const nm = defaultName(o.texture);
    const role = objectRole(nm);
    const pack = o.texture?.source === "pack";
    const sprite = pack ? (opts.packSprite ?? PACK_SPRITE.reach) : spriteFor(nm, role, opts);
    const reach = worldReach(sprite, o.rotation, [o.scale.x || 1, o.scale.y || 1], o.mirror);
    objects.role[k] = role;
    objects.layer[k] = Math.max(-32768, Math.min(32767, Math.round(o.layer)));
    objects.x[k] = Math.round(o.position.x * C16);
    objects.y[k] = Math.round(o.position.y * C16);
    objects.rot[k] = rotByte(o.rotation);
    objects.flags[k] = (o.mirror ? OBJ_FLAG.MIRROR : 0) | (capped.has(i) ? OBJ_FLAG.CAPPED : 0) | OBJ_FLAG.MEASURED;
    objects.name[k] = nm !== null && NAMED_ROLES.has(role) ? nameIx(nm) : NO_NAME;
    for (let d = 0; d < REACH_N; d++) objects.reach[k * REACH_N + d] = Math.min(65535, Math.round(reach[d] * SIDECAR_UNITS.reach));
  });

  const crop = opts.crop ?? [0, 0, W, H];
  const sh = opts.shift ?? [0, 0];
  const rect: [number, number, number, number] = [
    (crop[0] - sh[0]) * GRID, (crop[1] - sh[1]) * GRID, (crop[0] + crop[2] - sh[0]) * GRID, (crop[1] + crop[3] - sh[1]) * GRID,
  ];
  return {
    meta: { rect, squares: [W, H], extractor: EXTRACTOR_VERSION, snowShare: 0, packShare: 0, packItems: 0, dropped: 0, names },
    terrain, bitmaps, shapes, objects,
  };
}

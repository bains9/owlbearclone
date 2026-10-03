// Synthetic Dungeondraft maps for the exact-seasons tests (design 6.3, WP9). Each builder writes
// .dungeondraft_map text in the real file's shape (Godot value strings, the water PolyTree, splat
// planes, node ids), which src/client/dd/parse.ts reads like any saved map, and says where its
// parts are, so tests can check results against known answers.
//
// The fixtures:
// - snowyMap: the snowy 20 x 12 map of 6.3 "Exact seasons" (snow left, grass right, a rock patch
//   bottom-left, a pine, an oak, a dead tree, a boulder, a crate, a pack object, a pond with an
//   island, a hut with walls, a roof over its back half, a snow object on the roof, grass tufts),
//   with its hand-built sidecar. Options: a cave with a pool in the rock patch; green (grass
//   where the snow was); a pack roof (KEEP) over a woodshed.
// - jaggedEdge: snow against rock along a zigzag, the band's weights 0.7, 0.5 and 0.3, with its
//   hand-built sidecar.
// - frozenLake: a lake wide enough that water more than 3 squares from every shore is left, with
//   an island and its hand-built sidecar.
// - croppedDd2vtt: the snowy map's .dd2vtt cropped at origin 2,1 (16 x 10 squares).
// - pelcsLike: a Roof level (terrain off) and a Ground level (doors, lights, walls), with the
//   Ground export's .dd2vtt; twinLevels: two Ground levels with the same objects (on hold).
// - transformsMap: a rotated and mirrored path, pattern and tree, and the measurement cases
//   (a green tree whose prior overshoots, a snow-capped crown, a pack crown, a thin bare tree).
// - interiorsMap: the Mill-like interior (closed wood wall over a wood pattern), a 4 x 4 hut of
//   two walls whose ends meet, a 10 x 10 walled yard, and a cave-wall loop.
// - scatterMap, editedPicture, fitPairs: maps for the object-centre fit and the presence check
//   (swapped, shifted by squares and half squares, a half-scale crop, an edited picture).
//
// mapText (with the spec types) writes any other map a test needs, materials included.
//
// The hand-built sidecars (snowyMap().sidecar, jaggedEdge().sidecar, frozenLake().sidecar) are
// what the extractor should make of the same text, decided by hand from the design (3.3, 4.1,
// 4.2) while WP3's extractor doesn't exist; at M2 they are compared with its output. Their object reaches are the fixture's
// own sprite shapes (FIXTURE_SPRITES) turned into the world frame, the same shapes fakeExport.ts
// draws, so a perfect measurement of the fake export gives exactly these reaches.
//
// Units: the builders take squares; the text and the sidecars hold world units (256 a square).

import { GRID } from "../../src/client/dd/model";
import { REACH_DIRS, rasterSidecar } from "../../src/client/dd/raster";
import { AR, NAMED_ROLES, OR, TR, objectRole, terrainRole, type AreaRole, type ObjectRole, type TerrainRole } from "../../src/client/dd/roles";
import {
  DD_LAYER, NO_NAME, OBJ_FLAG, REACH_N, SIDECAR_UNITS,
  type BitmapLayer, type ObjectTable, type SeasonSidecar, type ShapeLayer, type TerrainGrid,
} from "../../src/client/dd/sidecar";
import { EXTRACTOR_VERSION, type VttMeta } from "../../src/client/dd/extract";
import type { SpriteSizes } from "../../src/client/dd/measure";

/** A point or size in squares. */
export type Pt = [number, number];

/** The asset pack every fixture's pack items come from. Its id and name must never reach a sidecar. */
export const PACK_ID = "Fx9pQ2rT";
export const PACK_NAME = "Icewind Frost Pack";
/** An object name starting with this is a pack item (res://packs/<PACK_ID>/textures/objects/<rest>.png). */
export const PACK_PREFIX = "pack:";

// ------------------------------------------------------------------ sprite shapes

/**
 * The fixtures' own sprite shapes by default short name: reach profiles in the sprite's frame at
 * scale 1, world units, REACH_DIRS order (the SpriteSizes layout). They are the truth the fake
 * exports draw, chosen near but not equal to SPRITE_SIZES (the measurement's priors), so a test
 * can tell a measured reach from a prior. Names missing here are drawn from SPRITE_SIZES, else
 * the role's ROLE_RADIUS (fakeExport.ts).
 */
export const FIXTURE_SPRITES: SpriteSizes = Object.freeze(Object.assign(Object.create(null) as Record<string, { r: number; reach: number[] }>, {
  "vegetation/trees/pine_tree_02": round(340),
  "more_trees/oak_04": ellipse(470, 410, 20),
  "vegetation/trees/dead_tree_01": round(170),
  "vegetation/trees/dead_tree_02": round(270),
  "clutter/boulders/boulder_08": ellipse(180, 115),
  "supplies/crates/crate_01": square(100),
  "environment/snow_03": ellipse(200, 130, 10),
  "environment/snow_05": ellipse(240, 150),
  "environment/snow_08": round(180),
  "vegetation/grass/grass_13": ellipse(64, 38),
  /** Egg-shaped, so mirroring and turning it show: 520 toward the sprite's +x, 380 toward -x, 430 across. */
  "vegetation/trees/tree_big_green_02": egg(520, 380, 430),
  /** The prior (SPRITE_SIZES, 262) overshoots this by 1.31. */
  "vegetation/trees/tree_green_simple_01": round(200),
  "vegetation/trees/tree_big_green_01": round(470),
  "vegetation/shrubs/bush_green_simple_01": round(190),
  "vegetation/trees/stump_03": round(100),
  "vegetation/fallen/log_02": ellipse(300, 55, -50),
}));

/** A pack object's sprite at scale 1: a crown 2 squares across (2.5 item 7). */
export const PACK_SPRITE: { r: number; reach: number[] } = round(GRID);

function round(r: number): { r: number; reach: number[] } {
  return { r, reach: new Array<number>(REACH_N).fill(r) };
}

/** Along REACH_DIRS, the distance to the boundary of a star-shaped outline given as radius(dx, dy). */
function profile(radius: (dx: number, dy: number) => number): { r: number; reach: number[] } {
  const reach: number[] = [];
  for (let k = 0; k < REACH_N; k++) reach.push(Math.round(radius(REACH_DIRS[k * 2], REACH_DIRS[k * 2 + 1])));
  return { r: Math.max(...reach), reach };
}

/** An ellipse with half-axes a (along `deg` degrees from +x, clockwise) and b. */
function ellipse(a: number, b: number, deg = 0): { r: number; reach: number[] } {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return profile((dx, dy) => {
    const u = c * dx + s * dy, v = -s * dx + c * dy;
    return 1 / Math.sqrt((u / a) * (u / a) + (v / b) * (v / b));
  });
}

/** Half ellipses: `front` toward +x, `back` toward -x, `across` along y. */
function egg(front: number, back: number, across: number): { r: number; reach: number[] } {
  return profile((dx, dy) => {
    const a = dx >= 0 ? front : back;
    return 1 / Math.sqrt((dx / a) * (dx / a) + (dy / across) * (dy / across));
  });
}

/** An axis-aligned square of half-side h (a crate). */
function square(h: number): { r: number; reach: number[] } {
  return profile((dx, dy) => h / Math.max(Math.abs(dx), Math.abs(dy)));
}

/** Points on a sprite's outline, its 16 reaches interpolated linearly in angle between samples. */
const OUTLINE_N = 256;

/**
 * A sprite's reach profile carried into the world frame, as Dungeondraft places a sprite
 * (Godot: world = position + R(rotation) * (scale * local), with `mirror` flipping local x
 * first): the sprite's outline (OUTLINE_N points, the reaches interpolated linearly in angle
 * between samples) is transformed point by point, then cast along each REACH_DIRS ray from the
 * centre. Written independently of measure.ts's priorReach (which inverts the transform
 * analytically and interpolates in diamond angle), so a convention slip there shows against
 * these fixtures; the two interpolations differ by about 1% between samples.
 */
export function worldReach(sprite: ArrayLike<number>, rotation: number, scale: Pt, mirror: boolean): number[] {
  const c = Math.cos(rotation), s = Math.sin(rotation), m = mirror ? -1 : 1;
  const ang = new Float64Array(REACH_N + 1);
  for (let k = 0; k < REACH_N; k++) {
    ang[k] = Math.atan2(REACH_DIRS[k * 2 + 1], REACH_DIRS[k * 2]);
    if (k > 0) while (ang[k] < ang[k - 1]) ang[k] += 2 * Math.PI;
  }
  ang[REACH_N] = ang[0] + 2 * Math.PI;
  const vx = new Float64Array(OUTLINE_N), vy = new Float64Array(OUTLINE_N);
  for (let i = 0, k = 0; i < OUTLINE_N; i++) {
    const a = ang[0] + (i / OUTLINE_N) * 2 * Math.PI;
    while (a >= ang[k + 1]) k++;
    const t = (a - ang[k]) / (ang[k + 1] - ang[k]);
    const r = sprite[k] + (sprite[(k + 1) % REACH_N] - sprite[k]) * t;
    const lx = r * Math.cos(a) * m * scale[0], ly = r * Math.sin(a) * scale[1];
    vx[i] = c * lx - s * ly;
    vy[i] = s * lx + c * ly;
  }
  const out: number[] = [];
  for (let j = 0; j < REACH_N; j++) {
    const dx = REACH_DIRS[j * 2], dy = REACH_DIRS[j * 2 + 1];
    let best = 0;
    for (let k = 0; k < OUTLINE_N; k++) {
      const ax = vx[k], ay = vy[k], bx = vx[(k + 1) % OUTLINE_N], by = vy[(k + 1) % OUTLINE_N];
      // t * d = a + u * (b - a): solve by cross products.
      const ex = bx - ax, ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (ax * ey - ay * ex) / den;
      const u = (ax * dy - ay * dx) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
    }
    out.push(best);
  }
  return out;
}

// ------------------------------------------------------------------ the map text

export interface ObjSpec {
  /** Default short name under textures/objects/ ("vegetation/trees/pine_tree_02"), or PACK_PREFIX + a file name. */
  name: string;
  at: Pt;
  /** Radians, clockwise. */
  rot?: number;
  scale?: number | Pt;
  mirror?: boolean;
  layer?: number;
}

export interface DoorSpec { at: Pt; dir: Pt }

export interface WallSpec {
  pts: Pt[];
  loop?: boolean;
  /** 0 auto (Building tool), 1 manual (Wall tool), 2 cave. */
  type?: 0 | 1 | 2;
  texture?: string;
  doors?: DoorSpec[];
}

export interface PathSpec {
  at: Pt;
  rot?: number;
  scale?: Pt;
  /** Edit points, local, squares. */
  pts: Pt[];
  /** Default name under textures/paths/ ("wagon_trail"), or PACK_PREFIX + a file name. */
  texture: string;
  /** Squares. */
  width: number;
  smooth?: number;
  layer?: number;
}

export interface PatternSpec {
  at?: Pt;
  rot?: number;
  scale?: Pt;
  /** Local points, squares. */
  pts: Pt[];
  /** Under textures/tilesets/ ("simple/tileset_wood_interlaced"). */
  texture: string;
  layer?: number;
}

/** A material painted with the Material tool (Dungeondraft saves it as a bitmap of 2 samples a square). */
export interface MaterialSpec {
  /** Under textures/materials/ ("ice_tile", "lava_tile", "cobblestone_tile"), or PACK_PREFIX + a name. */
  texture: string;
  /** Default -400 ("Below Ground", where Ancient Hobblestone's cobbles lie). */
  layer?: number;
  /** Rectangles [x0, y0, x1, y1] in squares: the samples (every half square) inside any of them are set. */
  rects: Array<[number, number, number, number]>;
}

export interface RoofSpec {
  ridge: Pt[];
  /** Squares either side of the ridge. */
  width: number;
  /** Under textures/roofs/ ("round_slate_gray"), or PACK_PREFIX + a name. */
  texture: string;
  type?: 0 | 1 | 2;
}

export interface WaterSpec {
  ring: Pt[];
  islands?: Array<{ ring: Pt[]; ponds?: Pt[][] }>;
}

export interface TerrainSpec {
  enabled?: boolean;
  /** Slot textures by default name ("terrain_snow"); up to 8 (expand_slots past 4). */
  slots: string[];
  /** Per texel (4 a square), the slots' weights, summing to 255. */
  weights: (tx: number, ty: number) => number[];
}

export interface LevelSpec {
  key: string;
  label: string;
  terrain: TerrainSpec | null;
  water?: WaterSpec[];
  walls?: WallSpec[];
  paths?: PathSpec[];
  patterns?: PatternSpec[];
  objects?: ObjSpec[];
  roofs?: RoofSpec[];
  materials?: MaterialSpec[];
  lights?: Array<{ at: Pt; range: number }>;
  /** Building-tool floors: polygons, plus the cells (x, y, w, h rectangles) tiled with `tileset`. */
  floor?: { polygons: Pt[][]; cells: Array<[number, number, number, number]>; tileset: string };
  /** Cave floor, as rectangles [x0, y0, x1, y1] (squares). */
  cave?: Array<[number, number, number, number]>;
}

export interface MapSpec {
  w: number;
  h: number;
  levels: LevelSpec[];
  currentLevel?: number;
}

const pool = (name: string, xs: ArrayLike<number>) => `${name}( ${Array.from(xs).join(", ")} )`;
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const vec = (x: number, y: number) => `Vector2( ${fmt(x)}, ${fmt(y)} )`;
/** Squares to a PoolVector2Array of world units. */
const ptsW = (pts: Pt[], k = GRID) => `PoolVector2Array( ${pts.map(([x, y]) => `${fmt(x * k)}, ${fmt(y * k)}`).join(", ")} )`;

function texturePath(kind: string, name: string): string {
  if (name.startsWith(PACK_PREFIX)) return `res://packs/${PACK_ID}/textures/${kind}/${name.slice(PACK_PREFIX.length)}.png`;
  return `res://textures/${kind}/${name}.png`;
}

/** w x h bits, sample (i, j) at bit j*w + i, least-significant first (Godot BitMap). */
function bitsPool(w: number, h: number, on: (i: number, j: number) => boolean): string {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (on(i, j)) { const o = j * w + i; bytes[o >> 3] |= 1 << (o & 7); }
  return pool("PoolByteArray", bytes);
}

/**
 * A map's text: JSON in Dungeondraft's own layout (format 3, as 1.2 saves), for tests that need a
 * map of their own. Positions in squares; a name starting with PACK_PREFIX is a pack asset.
 */
export function mapText(spec: MapSpec): string {
  let node = 16;
  const id = () => (node++).toString(16);
  const levels: Record<string, unknown> = {};
  for (const L of spec.levels) levels[L.key] = levelDoc(spec, L, id);
  const doc = {
    header: {
      creation_build: "1.2.0.1 opulent kirin",
      creation_date: { year: 2026, month: 9, day: 30, weekday: 3, dst: false, hour: 12, minute: 0, second: 0 },
      uses_default_assets: true,
      asset_manifest: [{ name: PACK_NAME, id: PACK_ID, version: "1", author: "Fixture", custom_color_overrides: { enabled: false } }],
      editor_state: { current_level: spec.currentLevel ?? 0, camera_position: vec(spec.w * 128, spec.h * 128), camera_zoom: 1, trace_image: null },
    },
    world: {
      format: 3,
      width: spec.w,
      height: spec.h,
      next_node_id: id(),
      next_prefab_id: 0,
      msi: { offset_map_size: 512, max_offset_distance: 0.2, cell_size: 64, seed: "5eed5eed" },
      grid: { color: "7f000000" },
      embedded: {},
      levels,
    },
  };
  return JSON.stringify(doc, null, "\t");
}

function levelDoc(spec: MapSpec, L: LevelSpec, id: () => string): Record<string, unknown> {
  const W = spec.w, H = spec.h;
  const out: Record<string, unknown> = {
    label: L.label,
    environment: { baked_lighting: true, ambient_light: "ffffffff" },
    layers: { "100": "User Layer 1", "200": "User Layer 2", "300": "User Layer 3", "400": "User Layer 4", "700": "Above Walls",
      "900": "Above Roofs", "-400": "Below Ground", "-100": "Below Water" },
  };
  // Terrain: splat (slots 1-4) and splat2 (5-8), RGBA a texel.
  const tw = W * 4, th = H * 4;
  if (L.terrain) {
    const t = L.terrain;
    const expand = t.slots.length > 4;
    const splat = new Uint8Array(tw * th * 4), splat2 = new Uint8Array(tw * th * 4);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const w = t.weights(tx, ty);
      const i = (ty * tw + tx) * 4;
      for (let s = 0; s < w.length; s++) (s < 4 ? splat : splat2)[i + (s & 3)] = w[s];
    }
    const terrain: Record<string, unknown> = { enabled: t.enabled !== false, expand_slots: expand, smooth_blending: false };
    t.slots.forEach((n, s) => { terrain[`texture_${s + 1}`] = texturePath("terrain", n); });
    terrain.splat = pool("PoolByteArray", splat);
    if (expand) terrain.splat2 = pool("PoolByteArray", splat2);
    out.terrain = terrain;
  } else {
    out.terrain = { enabled: false, expand_slots: false, smooth_blending: false, texture_1: texturePath("terrain", "terrain_dirt") };
  }
  // Water: the PolyTree, root at depth 0.
  let ref = 1000;
  const node = (ring: Pt[] | null, children: unknown[]) => ({
    ref: ref++, polygon: ring ? ptsW(ring) : "PoolVector2Array(  )", join: 0, end: 0, is_open: false,
    deep_color: ring ? "ff3a7fa1" : "00000000", shallow_color: ring ? "ff8bc0ce" : "00000000", blend_distance: ring ? 1.5 : 0, children,
  });
  out.water = {
    disable_border: false,
    tree: node(null, (L.water ?? []).map((b) => node(b.ring, (b.islands ?? []).map((is) => node(is.ring, (is.ponds ?? []).map((p) => node(p, []))))))),
  };
  // Building-tool floors.
  const floorWallIds: string[] = [];
  const walls = (L.walls ?? []).map((w) => {
    const wid = id();
    if (w.type === 0) floorWallIds.push(wid);
    return {
      points: ptsW(w.pts),
      texture: texturePath("walls", w.texture ?? "stone"),
      color: "ff705e4b",
      loop: w.loop === true,
      type: w.type ?? 1,
      joint: 1,
      normalize_uv: true,
      shadow: true,
      node_id: wid,
      portals: (w.doors ?? []).map((d) => ({
        position: vec(d.at[0] * GRID, d.at[1] * GRID),
        rotation: fmt(Math.atan2(d.dir[1], d.dir[0])),
        scale: vec(1, 1),
        direction: vec(d.dir[0], d.dir[1]),
        texture: "res://textures/portals/door_00.png",
        radius: 128,
        wall_id: wid,
        wall_distance: 0.5,
        closed: true,
        node_id: id(),
      })),
    };
  });
  out.shapes = { polygons: (L.floor?.polygons ?? []).map((p) => ptsW(p)), walls: floorWallIds };
  if (L.floor) {
    const cells = new Int32Array(W * H).fill(-1);
    for (const [x, y, w, h] of L.floor.cells) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells[j * W + i] = 0;
    out.tiles = { cells: pool("PoolIntArray", cells), colors: new Array<string>(W * H).fill("ffffffff"), lookup: { "0": texturePath("tilesets", L.floor.tileset) } };
  } else {
    out.tiles = { cells: pool("PoolIntArray", new Int32Array(W * H).fill(-1)), colors: new Array<string>(W * H).fill("ffffffff"), lookup: {} };
  }
  out.patterns = (L.patterns ?? []).map((p) => ({
    position: vec((p.at?.[0] ?? 0) * GRID, (p.at?.[1] ?? 0) * GRID),
    shape_rotation: p.rot ?? 0,
    scale: vec(p.scale?.[0] ?? 1, p.scale?.[1] ?? 1),
    points: ptsW(p.pts),
    layer: p.layer ?? 100,
    color: "ffb28f6f",
    outline: false,
    texture: texturePath("tilesets", p.texture),
    rotation: 0,
    node_id: id(),
  }));
  out.walls = walls;
  out.portals = [];
  if (L.cave) {
    const cw = W * 4 + 3, ch = H * 4 + 3;
    out.cave = {
      // Sample i lies at world (i - 1) * 64.
      bitmap: bitsPool(cw, ch, (i, j) => L.cave!.some(([x0, y0, x1, y1]) => {
        const x = (i - 1) / 4, y = (j - 1) / 4;
        return x >= x0 && x <= x1 && y >= y0 && y <= y1;
      })),
      entrance_bitmap: "PoolByteArray(  )",
      ground_color: "ff7f7e71",
      wall_color: "ff3b3a36",
      texture: "res://textures/caves/stone.png",
    };
  }
  // Materials: lists by layer, each a bitmap of (W * 2 + 3) x (H * 2 + 3) samples, sample i at world (i - 1) * 128.
  const materials: Record<string, Array<{ bitmap: string; texture: string }>> = {};
  for (const m of L.materials ?? []) {
    const k = String(m.layer ?? DD_LAYER.BELOW_GROUND);
    (materials[k] ??= []).push({
      bitmap: bitsPool(W * 2 + 3, H * 2 + 3, (i, j) => m.rects.some(([x0, y0, x1, y1]) => {
        const x = (i - 1) / 2, y = (j - 1) / 2;
        return x >= x0 && x <= x1 && y >= y0 && y <= y1;
      })),
      texture: texturePath("materials", m.texture),
    });
  }
  out.materials = materials;
  out.paths = (L.paths ?? []).map((p) => ({
    position: vec(p.at[0] * GRID, p.at[1] * GRID),
    rotation: p.rot ?? 0,
    scale: vec(p.scale?.[0] ?? 1, p.scale?.[1] ?? 1),
    edit_points: ptsW(p.pts),
    smoothness: p.smooth ?? 1,
    texture: texturePath("paths", p.texture),
    width: p.width * GRID,
    layer: p.layer ?? 100,
    fade_in: false, fade_out: false, grow: false, shrink: false, block_light: false, loop: false,
    node_id: id(),
  }));
  out.objects = (L.objects ?? []).map((o) => {
    const s: Pt = typeof o.scale === "number" ? [o.scale, o.scale] : (o.scale ?? [1, 1]);
    return {
      position: vec(o.at[0] * GRID, o.at[1] * GRID),
      rotation: o.rot ?? 0,
      scale: vec(s[0], s[1]),
      mirror: o.mirror === true,
      texture: texturePath("objects", o.name),
      layer: o.layer ?? 100,
      shadow: true,
      node_id: id(),
    };
  });
  out.lights = (L.lights ?? []).map((l) => ({
    position: vec(l.at[0] * GRID, l.at[1] * GRID), rotation: 0, range: l.range, intensity: 1, color: "ffffad58",
    texture: "res://textures/lights/point.png", shadows: true, node_id: id(),
  }));
  out.roofs = {
    shade: true, shade_contrast: 0.5, sun_direction: 45,
    roofs: (L.roofs ?? []).map((r) => ({
      position: vec(0, 0), rotation: 0, scale: vec(1, 1), points: ptsW(r.ridge),
      texture: r.texture.startsWith(PACK_PREFIX) ? `res://packs/${PACK_ID}/textures/roofs/${r.texture.slice(PACK_PREFIX.length)}/tiles.png`
        : `res://textures/roofs/${r.texture}/tiles.png`,
      width: r.width * GRID, type: r.type ?? 0, node_id: id(),
    })),
  };
  out.texts = [];
  return out;
}

// ------------------------------------------------------------------ the hand-built sidecars

const C = SIDECAR_UNITS.coord;

/** A shape layer from rings in squares. */
function shapeSq(role: AreaRole, layer: number, rings: Pt[][], rule: 0 | 1 = 0): ShapeLayer {
  const pts: number[] = [];
  const ends: number[] = [];
  for (const r of rings) {
    for (const [x, y] of r) pts.push(Math.round(x * GRID * C), Math.round(y * GRID * C));
    ends.push(pts.length / 2);
  }
  return { role, layer, rule, pts: Int32Array.from(pts), ringEnds: Uint32Array.from(ends) };
}

const rectRing = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** A bitmap layer of `step` world units from rectangles (squares), samples where the rectangles hold them. */
function bitmapSq(role: AreaRole, layer: number, step: number, area: [number, number, number, number], on: (x: number, y: number) => boolean): BitmapLayer {
  const ox = Math.floor((area[0] * GRID) / step) * step - step, oy = Math.floor((area[1] * GRID) / step) * step - step;
  const w = Math.ceil((area[2] * GRID - ox) / step) + 2, h = Math.ceil((area[3] * GRID - oy) / step) + 2;
  const bits = new Uint8Array(Math.ceil((w * h) / 8));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (on((ox + i * step) / GRID, (oy + j * step) / GRID)) { const o = j * w + i; bits[o >> 3] |= 1 << (o & 7); }
  }
  return { role, layer, step, ox, oy, w, h, bits };
}

/** One placed object as the extractor stores it. */
interface SideObj { role: ObjectRole; layer: number; x: number; y: number; rot: number; flags: number; name: string | null; reach: number[] }

function objectTable(list: SideObj[], names: string[]): ObjectTable {
  const n = list.length;
  const t: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  list.forEach((o, i) => {
    t.role[i] = o.role;
    t.layer[i] = o.layer;
    t.x[i] = Math.round(o.x * C);
    t.y[i] = Math.round(o.y * C);
    t.rot[i] = rotByte(o.rot);
    t.flags[i] = o.flags;
    t.name[i] = o.name === null ? NO_NAME : nameIndex(names, o.name);
    for (let k = 0; k < REACH_N; k++) t.reach[i * REACH_N + k] = Math.round(o.reach[k] * SIDECAR_UNITS.reach);
  });
  return t;
}

/** A full turn / 256, clockwise. */
export function rotByte(rad: number): number {
  return ((Math.round((rad / (2 * Math.PI)) * 256) % 256) + 256) % 256;
}

function nameIndex(names: string[], name: string): number {
  let i = names.indexOf(name);
  if (i < 0) { names.push(name); i = names.length - 1; }
  return i;
}

/** The sprite profile a fixture object is drawn with (FIXTURE_SPRITES, or the pack crown). */
function spriteOf(o: ObjSpec): number[] {
  if (o.name.startsWith(PACK_PREFIX)) return PACK_SPRITE.reach;
  const s = FIXTURE_SPRITES[o.name];
  if (!s) throw new Error(`ddSynthetic: no fixture sprite for ${o.name}`);
  return s.reach;
}

const scaleOf = (o: ObjSpec): Pt => (typeof o.scale === "number" ? [o.scale, o.scale] : (o.scale ?? [1, 1]));

/** The objects of a level spec as the extractor should store them: roles by name, reaches from the fixture sprites, measured. */
function sideObjects(objs: ObjSpec[], capped: ReadonlySet<number> = new Set()): SideObj[] {
  return objs.map((o, i) => {
    const pack = o.name.startsWith(PACK_PREFIX);
    const role = pack ? OR.OPAQUE : objectRole(o.name);
    return {
      role,
      layer: o.layer ?? 100,
      x: o.at[0] * GRID,
      y: o.at[1] * GRID,
      rot: o.rot ?? 0,
      flags: (o.mirror ? OBJ_FLAG.MIRROR : 0) | (capped.has(i) ? OBJ_FLAG.CAPPED : 0) | OBJ_FLAG.MEASURED,
      name: !pack && NAMED_ROLES.has(role) ? o.name : null,
      reach: worldReach(spriteOf(o), o.rot ?? 0, scaleOf(o), o.mirror === true),
    };
  });
}

/** The terrain grid of a spec: 4 texels a square, the whole map, only slots with weight. */
function terrainGrid(w: number, h: number, t: TerrainSpec, names: string[]): TerrainGrid {
  const tw = w * 4, th = h * 4;
  const planes: Uint8Array[] = t.slots.map(() => new Uint8Array(tw * th));
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const ws = t.weights(tx, ty);
    for (let s = 0; s < t.slots.length; s++) planes[s][ty * tw + tx] = ws[s] ?? 0;
  }
  const used = t.slots.map((_, s) => s).filter((s) => planes[s].some((v) => v > 0));
  const out = new Uint8Array(used.length * tw * th);
  used.forEach((s, i) => out.set(planes[s], i * tw * th));
  return {
    tps: 4, tx0: 0, ty0: 0, tw, th,
    slots: used.map((s) => ({ name: nameIndex(names, t.slots[s]), role: terrainRole(t.slots[s]) as TerrainRole })),
    w: out,
  };
}

/**
 * 4.2's snowShare from the sidecar's own raster: visible outdoor SNOW over visible outdoor SNOW,
 * ICE, GRASS, EARTH and SAND. Terrain is hidden by the areas (floors, caves, roofs, walls, water;
 * paths and patterns too, which the hand-built sidecars don't have) and, of the objects, only by
 * OPAQUE ones: the raster keeps only those and the ground-level SNOW objects (below the roofs'
 * layer), whose visible cover counts as SNOW. Every other object (trees, tufts, crates, rocks)
 * leaves the terrain under it counted.
 */
export function sidecarSnowShare(sc: SeasonSidecar): number {
  const [x0, y0, x1, y1] = sc.meta.rect;
  const pps = 16;
  const o = sc.objects;
  const keep: number[] = [];
  for (let i = 0; i < o.n; i++) {
    let role = o.role[i] as ObjectRole;
    if (o.name[i] !== NO_NAME && o.name[i] < sc.meta.names.length) {
      const r = objectRole(sc.meta.names[o.name[i]]);
      if (NAMED_ROLES.has(r)) role = r;
    }
    if (role === OR.OPAQUE || (role === OR.SNOW && o.layer[i] < DD_LAYER.ROOF)) keep.push(i);
  }
  const L = rasterSidecar({ ...sc, objects: pickObjects(o, keep) }, {
    w: Math.max(1, Math.round(((x1 - x0) / GRID) * pps)), h: Math.max(1, Math.round(((y1 - y0) / GRID) * pps)),
  });
  const total = (p: Uint8Array | undefined) => { let s = 0; if (p) for (const v of p) s += v; return s; };
  const sum = (r: TerrainRole) => total(L.terrain.get(r));
  const snow = sum(TR.SNOW) + total(L.objects.get(OR.SNOW));
  const soft = snow + sum(TR.ICE) + sum(TR.GRASS) + sum(TR.EARTH) + sum(TR.SAND);
  return soft > 0 ? Math.round((1000 * snow) / soft) / 1000 : 0;
}

/** The objects `keep` (indices, in order) of a table. */
function pickObjects(t: ObjectTable, keep: number[]): ObjectTable {
  const n = keep.length;
  const out: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  keep.forEach((i, k) => {
    out.role[k] = t.role[i]; out.layer[k] = t.layer[i]; out.x[k] = t.x[i]; out.y[k] = t.y[i];
    out.rot[k] = t.rot[i]; out.flags[k] = t.flags[i]; out.name[k] = t.name[i];
    out.reach.set(t.reach.subarray(i * REACH_N, (i + 1) * REACH_N), k * REACH_N);
  });
  return out;
}

/** Area of a reach 16-gon, world units squared. */
function reachArea(reach: ArrayLike<number>): number {
  let a = 0;
  for (let k = 0; k < REACH_N; k++) {
    const j = (k + 1) % REACH_N;
    a += reach[k] * reach[j] * (REACH_DIRS[k * 2] * REACH_DIRS[j * 2 + 1] - REACH_DIRS[k * 2 + 1] * REACH_DIRS[j * 2]);
  }
  return Math.abs(a) / 2;
}

function sidecarOf(o: {
  w: number; h: number; terrain: TerrainSpec | null; shapes: ShapeLayer[]; bitmaps?: BitmapLayer[]; objects: SideObj[];
  names: string[]; packItems: number; pathArea?: number; packPathArea?: number;
}): SeasonSidecar {
  const terrain = o.terrain ? terrainGrid(o.w, o.h, o.terrain, o.names) : null;
  const objects = objectTable(o.objects, o.names);
  let all = o.pathArea ?? 0, pack = o.packPathArea ?? 0;
  for (const ob of o.objects) {
    const a = reachArea(ob.reach);
    all += a;
    if (ob.role === OR.OPAQUE) pack += a;
  }
  const sc: SeasonSidecar = {
    meta: {
      rect: [0, 0, o.w * GRID, o.h * GRID], squares: [o.w, o.h], extractor: EXTRACTOR_VERSION, snowShare: 0,
      packShare: all > 0 ? Math.round((1000 * pack) / all) / 1000 : 0, packItems: o.packItems, dropped: 0, names: o.names,
    },
    terrain,
    bitmaps: o.bitmaps ?? [],
    shapes: o.shapes,
    objects,
  };
  sc.meta.snowShare = sidecarSnowShare(sc);
  return sc;
}

/** Weights summing to 255 from shares (the last slot takes the rounding). */
function bytes(shares: number[]): number[] {
  const out = shares.map((s) => Math.round(255 * Math.max(0, Math.min(1, s))));
  let sum = 0;
  for (let i = 0; i < out.length - 1; i++) sum += out[i];
  out[out.length - 1] = Math.max(0, 255 - sum);
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** A texel's centre in squares. */
const tc = (t: number) => (t + 0.5) / 4;

// ------------------------------------------------------------------ the snowy 20 x 12 map

export interface SnowyOptions {
  /** A cave dug into the rock patch, with a pool in it (a pool inside a cave never freezes). */
  cave?: boolean;
  /** Grass where the snow is (a green map: snowShare 0). */
  green?: boolean;
  /** A second roof, from the asset pack (a woodshed's, no walls under it, on the snow top right of the pine): KEEP (4.1). */
  packRoof?: boolean;
}

export interface SnowyMap {
  text: string;
  w: number;
  h: number;
  levelKey: string;
  /** Indices into the level's objects (and the sidecar's OBJS: the same order). */
  objects: { pine: number; oak: number; dead: number; boulder: number; crate: number; pack: number; roofSnow: number; tufts: number[];
    /** Tufts more than one square outside croppedDd2vtt's rectangle. */
    outsideCrop: number[] };
  /** Where things are, in squares. */
  layout: {
    /** Snow for x < snowEdge[0], grass for x > snowEdge[1], blended between. */
    snowEdge: Pt;
    /** The rock patch: x < rock[0], y > rock[1], with a soft edge 0.75 square wide. */
    rock: Pt;
    pond: Pt[];
    island: Pt[];
    hut: [number, number, number, number];
    roof: [number, number, number, number];
    /** The hut's floor that the roof leaves open. */
    openFloor: [number, number, number, number];
    door: Pt;
    cave?: [number, number, number, number];
    cavePool?: Pt[];
    /** With packRoof: the pack roof's rectangle. */
    packRoof?: [number, number, number, number];
  };
  /** What the extractor should make of the text (see the header). */
  sidecar: SeasonSidecar;
}

/** An irregular ring round (cx, cy) with radii rx, ry (squares), n points. */
function blob(cx: number, cy: number, rx: number, ry: number, n: number, wobble: number, phase: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const f = 1 + wobble * Math.sin(3 * a + phase) + 0.5 * wobble * Math.sin(5 * a + 2 * phase);
    out.push([Math.round((cx + rx * f * Math.cos(a)) * 64) / 64, Math.round((cy + ry * f * Math.sin(a)) * 64) / 64]);
  }
  return out;
}

export function snowyMap(opts: SnowyOptions = {}): SnowyMap {
  const W = 20, H = 12;
  const snowEdge: Pt = [12, 13];
  const rock: Pt = [4.2, 9];
  const ground = opts.green ? "terrain_grass" : "terrain_snow";
  const terrain: TerrainSpec = {
    slots: [ground, "terrain_grass", "terrain_rocky", "terrain_dirt"],
    weights: (tx, ty) => {
      const x = tc(tx), y = tc(ty);
      const g = clamp01((x - snowEdge[0]) / (snowEdge[1] - snowEdge[0]));
      const r = clamp01(Math.min((rock[0] - x) / 0.75, (y - rock[1]) / 0.75));
      return [...bytes([(1 - r) * (1 - g), (1 - r) * g, r]), 0];
    },
  };
  const pond = blob(5, 3.6, 2.6, 2.0, 24, 0.06, 0.4);
  const island = blob(5.3, 3.7, 0.75, 0.6, 12, 0.08, 1.1);
  const hut: [number, number, number, number] = [14, 1, 18, 5];
  const roof: [number, number, number, number] = [13.8, 0.95, 18.2, 3.05];
  const door: Pt = [16, 5];
  const caveRect: [number, number, number, number] = [0.5, 9.75, 3.5, 11.5];
  const cavePool = blob(2, 10.6, 0.55, 0.4, 10, 0.05, 0.2);
  const packRoof: [number, number, number, number] = [10.6, 0.3, 12.6, 1.5];
  const objects: ObjSpec[] = [
    { name: "vegetation/trees/pine_tree_02", at: [9.3, 2.2], rot: -0.52, scale: 0.9 },
    { name: "more_trees/oak_04", at: [9.2, 8.2], rot: 0.3, scale: 0.9 },
    { name: "vegetation/trees/dead_tree_02", at: [5.8, 9.0], rot: -2.88, scale: 1.2 },
    { name: "clutter/boulders/boulder_08", at: [1.6, 7.0], rot: 0.4 },
    { name: "supplies/crates/crate_01", at: [11.0, 5.2], rot: 0.2 },
    { name: `${PACK_PREFIX}snowy_fir_01`, at: [16.2, 8.8] },
    { name: "environment/snow_05", at: [16, 2.0], layer: DD_LAYER.ABOVE_ROOFS },
    { name: "vegetation/grass/grass_13", at: [0.4, 5.6], rot: -2.88, scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [7.6, 6.6], rot: -2.88, scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [11.4, 10.9], rot: 1.0, scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [13.6, 6.6], rot: 0.5, scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [19.2, 6.8], rot: -1.2, scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [13.8, 10.8], rot: 2.0, scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [19.6, 11.6], rot: 0.1, scale: 1.6 },
  ];
  const level: LevelSpec = {
    key: "0",
    label: "Ground",
    terrain,
    water: [{ ring: pond, islands: [{ ring: island }] }, ...(opts.cave ? [{ ring: cavePool }] : [])],
    walls: [{ pts: rectRing(hut[0], hut[1], hut[2], hut[3]), loop: true, type: 0, texture: "stone", doors: [{ at: door, dir: [1, 0] }] }],
    floor: { polygons: [rectRing(hut[0], hut[1], hut[2], hut[3])], cells: [[hut[0], hut[1], hut[2] - hut[0], hut[3] - hut[1]]], tileset: "simple/tileset_wood_damaged" },
    roofs: [
      { ridge: [[roof[0], 2.0], [roof[2], 2.0]], width: 1.05, texture: "round_slate_gray", type: 0 },
      ...(opts.packRoof ? [{ ridge: [[packRoof[0], (packRoof[1] + packRoof[3]) / 2], [packRoof[2], (packRoof[1] + packRoof[3]) / 2]] as Pt[],
        width: (packRoof[3] - packRoof[1]) / 2, texture: `${PACK_PREFIX}frosted_shingles`, type: 1 as const }] : []),
    ],
    objects,
    lights: [{ at: [16, 5.6], range: 2.1 }],
    cave: opts.cave ? [caveRect] : undefined,
  };
  const text = mapText({ w: W, h: H, levels: [level] });

  // The sidecar, by hand (3.3): water even-odd per body; the hut's floor polygon (its cells
  // agree); the wall loop as a frame half a wall (32) wide each side; the roof swept +-width with
  // flat ends; every object (all lie in the rectangle).
  const names: string[] = [];
  const hw = 32 / GRID;
  const shapes: ShapeLayer[] = [
    shapeSq(AR.WATER, DD_LAYER.WATER, [pond, island]),
    shapeSq(AR.FLOOR, DD_LAYER.FLOOR, [rectRing(hut[0], hut[1], hut[2], hut[3])]),
    shapeSq(AR.WALL, DD_LAYER.WALL, [rectRing(hut[0] - hw, hut[1] - hw, hut[2] + hw, hut[3] + hw), rectRing(hut[0] + hw, hut[1] + hw, hut[2] - hw, hut[3] - hw)]),
    shapeSq(AR.ROOF, DD_LAYER.ROOF, [rectRing(roof[0], roof[1], roof[2], roof[3])]),
  ];
  // A pack roof is KEEP; its texture's name and pack never reach the sidecar.
  if (opts.packRoof) shapes.push(shapeSq(AR.KEEP, DD_LAYER.ROOF, [rectRing(packRoof[0], packRoof[1], packRoof[2], packRoof[3])]));
  const bitmaps: BitmapLayer[] = [];
  if (opts.cave) {
    shapes.push(shapeSq(AR.WATER, DD_LAYER.WATER, [cavePool]));
    // The cave floor (step 64), and its 0.35-square rim outside it.
    bitmaps.push(bitmapSq(AR.CAVE, DD_LAYER.CAVE, 64, caveRect, (x, y) => x >= caveRect[0] && x <= caveRect[2] && y >= caveRect[1] && y <= caveRect[3]));
    const m = 0.35 + 1 / 8;
    shapes.push(shapeSq(AR.CAVE_RIM, DD_LAYER.CAVE, [rectRing(caveRect[0] - m, caveRect[1] - m, caveRect[2] + m, caveRect[3] + m),
      rectRing(caveRect[0] - 1 / 8, caveRect[1] - 1 / 8, caveRect[2] + 1 / 8, caveRect[3] + 1 / 8)]));
  }
  const side = sideObjects(objects);
  const sidecar = sidecarOf({ w: W, h: H, terrain, shapes, bitmaps, objects: side, names, packItems: 1 });
  return {
    text, w: W, h: H, levelKey: "0",
    objects: { pine: 0, oak: 1, dead: 2, boulder: 3, crate: 4, pack: 5, roofSnow: 6, tufts: [7, 8, 9, 10, 11, 12, 13], outsideCrop: [7, 13] },
    layout: {
      snowEdge, rock, pond, island, hut, roof, openFloor: [hut[0], roof[3], hut[2], hut[3]], door,
      cave: opts.cave ? caveRect : undefined, cavePool: opts.cave ? cavePool : undefined,
      packRoof: opts.packRoof ? packRoof : undefined,
    },
    sidecar,
  };
}

// ------------------------------------------------------------------ the jagged snow edge

export interface JaggedEdge {
  text: string;
  w: number;
  h: number;
  levelKey: string;
  /** Snow's share of texel (tx, ty) (4 a square): 1 left of the band, 0.7, 0.5 and 0.3 across it, 0 right of it. */
  snow: (tx: number, ty: number) => number;
  /** The band's texel columns for row ty: [first, last]. */
  band: (ty: number) => [number, number];
  sidecar: SeasonSidecar;
}

/** Snow against rock along a zigzag (8 x 6 squares): the band texels' snow weights are 0.7, 0.5 and 0.3 (design 6.3 "Snow edges"). */
export function jaggedEdge(): JaggedEdge {
  const W = 8, H = 6;
  const tri = [0, 1, 2, 3, 2, 1, 0, -1, -2, -3, -2, -1];
  const edge = (ty: number) => 16 + tri[ty % tri.length];
  const snow = (tx: number, ty: number) => {
    const d = tx - edge(ty);
    return d < -1 ? 1 : d > 1 ? 0 : [0.7, 0.5, 0.3][d + 1];
  };
  const terrain: TerrainSpec = {
    slots: ["terrain_snow", "terrain_rocky"],
    weights: (tx, ty) => bytes([snow(tx, ty), 1 - snow(tx, ty)]),
  };
  const text = mapText({ w: W, h: H, levels: [{ key: "0", label: "Ground", terrain }] });
  const names: string[] = [];
  const sidecar = sidecarOf({ w: W, h: H, terrain, shapes: [], objects: [], names, packItems: 0 });
  return { text, w: W, h: H, levelKey: "0", snow, band: (ty) => [edge(ty) - 1, edge(ty) + 1], sidecar };
}

// ------------------------------------------------------------------ a lake wide enough to stay open

export interface FrozenLake {
  text: string;
  w: number;
  h: number;
  levelKey: string;
  lake: Pt[];
  /** An island off the lake's middle (the island's own shore counts as shore). */
  island: Pt[];
  /** Squares from (x, y) to the nearest shore, the lake's or the island's. */
  shoreDistance: (x: number, y: number) => number;
  /** The water point furthest from every shore, and its distance (over 3 squares: open at Winter L3). */
  deep: Pt;
  deepDistance: number;
  sidecar: SeasonSidecar;
}

/** Distance from (x, y) to the closed ring's edges, squares. */
function ringDistance(ring: Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - u * ex, y - ay - u * ey));
  }
  return best;
}

/** Whether (x, y) lies inside the ring (even-odd). */
function inRing(ring: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A snowy 18 x 14 map with a lake 12 x 10 squares across and a small island off its middle, so
 * water more than 3 squares from every shore is left (design 6.3: "Water freezes within 3 squares
 * of the shore at Winter L3"; the snowy map's pond is too small for that, every drop of it lies
 * within about 2 squares of a shore). A few pines on the shore, with its hand-built sidecar.
 */
export function frozenLake(): FrozenLake {
  const W = 18, H = 14;
  const lake = blob(8.6, 7, 6.1, 5.0, 36, 0.04, 0.7);
  const island = blob(12.8, 7.4, 0.8, 0.6, 12, 0.08, 1.1);
  const terrain: TerrainSpec = { slots: ["terrain_snow", "terrain_dirt"], weights: () => [255, 0] };
  const objects: ObjSpec[] = [
    { name: "vegetation/trees/pine_tree_02", at: [1.2, 1.3], scale: 0.7 },
    { name: "vegetation/trees/pine_tree_02", at: [16.6, 1.4], scale: 0.8, rot: 0.4 },
    { name: "vegetation/trees/pine_tree_02", at: [1.4, 12.6], scale: 0.75, rot: -1.1 },
    { name: "vegetation/trees/pine_tree_02", at: [16.7, 12.7], scale: 0.7 },
  ];
  const text = mapText({ w: W, h: H, levels: [{ key: "0", label: "Ground", terrain, water: [{ ring: lake, islands: [{ ring: island }] }], objects }] });
  const shoreDistance = (x: number, y: number) => Math.min(ringDistance(lake, x, y), ringDistance(island, x, y));
  let deep: Pt = [0, 0], deepDistance = 0;
  for (let y = 0; y <= H; y += 0.125) for (let x = 0; x <= W; x += 0.125) {
    if (!inRing(lake, x, y) || inRing(island, x, y)) continue;
    const d = shoreDistance(x, y);
    if (d > deepDistance) { deepDistance = d; deep = [x, y]; }
  }
  const names: string[] = [];
  const sidecar = sidecarOf({ w: W, h: H, terrain, shapes: [shapeSq(AR.WATER, DD_LAYER.WATER, [lake, island])], objects: sideObjects(objects), names, packItems: 0 });
  return { text, w: W, h: H, levelKey: "0", lake, island, shoreDistance, deep, deepDistance, sidecar };
}

// ------------------------------------------------------------------ .dd2vtt

export interface Dd2vttFixture {
  /** The map's text. */
  text: string;
  /** Which level the export shows. */
  levelKey: string;
  /** The export's rectangle in squares [x, y, w, h] (map_origin, map_size). */
  crop: [number, number, number, number];
  pixelsPerGrid: number;
  /** What parseUniversalVtt keeps (positions in world squares, not shifted by the crop). */
  vtt: VttMeta;
}

/** A Universal VTT file's text for `vtt`, with `imagePng` (a PNG's bytes) as its picture when given. */
export function dd2vttText(vtt: VttMeta, imagePng?: Uint8Array): string {
  const b64 = imagePng ? base64(imagePng) : "";
  return JSON.stringify({
    format: 0.3,
    resolution: vtt.resolution,
    line_of_sight: vtt.line_of_sight,
    portals: vtt.portals.map((p) => ({
      position: p.position, bounds: [{ x: p.position.x - 0.5, y: p.position.y }, { x: p.position.x + 0.5, y: p.position.y }],
      rotation: 0, closed: true, freestanding: false,
    })),
    environment: { baked_lighting: true, ambient_light: "ffffffff" },
    lights: vtt.lights.map((l) => ({ position: l.position, range: 2.1, intensity: 1, color: "ffffad58", shadows: true })),
    image: b64,
  }, null, "\t");
}

function base64(b: Uint8Array): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : "=") + (i + 2 < b.length ? A[n & 63] : "=");
  }
  return s;
}

const sq = (p: Pt) => ({ x: p[0], y: p[1] });
const loopLine = (r: Pt[]) => [...r, r[0]].map(sq);

/** The snowy map exported as a .dd2vtt cropped to 16 x 10 squares at origin 2,1 (two tufts lie more than a square outside it). */
export function croppedDd2vtt(pixelsPerGrid = 32): Dd2vttFixture & { snowy: SnowyMap } {
  const snowy = snowyMap();
  const crop: [number, number, number, number] = [2, 1, 16, 10];
  const [x0, y0, x1, y1] = snowy.layout.hut;
  return {
    snowy, text: snowy.text, levelKey: "0", crop, pixelsPerGrid,
    vtt: {
      resolution: { map_origin: { x: crop[0], y: crop[1] }, map_size: { x: crop[2], y: crop[3] }, pixels_per_grid: pixelsPerGrid },
      portals: [{ position: sq(snowy.layout.door) }],
      lights: [{ position: { x: 16, y: 5.6 } }],
      line_of_sight: [loopLine(rectRing(x0, y0, x1, y1))],
    },
  };
}

// ------------------------------------------------------------------ several levels

export interface PelcsLike {
  text: string;
  /** The Ground level (terrain, walls, doors, lights) and the Roof level (terrain off; roofs and roof snow). */
  groundKey: string;
  roofKey: string;
  /** The Ground export's .dd2vtt (whole map, 64 px a square). */
  vtt: VttMeta;
  /** editor_state.current_level: the Roof, so only the export can pick Ground. */
  currentLevel: number;
}

const BUILDINGS: Array<[number, number, number, number]> = [[3, 3, 8, 7], [10, 2, 14, 5]];

/** A Pelcs-like map (16 x 12): level "0" Roof (terrain off), level "1" Ground. */
export function pelcsLike(): PelcsLike {
  const W = 16, H = 12;
  const snow: TerrainSpec = { slots: ["terrain_snow", "terrain_dirt"], weights: () => [255, 0] };
  const doors: Pt[][] = [[[5.5, 7], [8, 5]], [[12, 5]]];
  const walls: WallSpec[] = BUILDINGS.map((b, i) => ({
    pts: rectRing(b[0], b[1], b[2], b[3]), loop: true, type: 0 as const, texture: "stone",
    doors: doors[i].map((d) => ({ at: d, dir: (d[1] === b[1] || d[1] === b[3] ? [1, 0] : [0, 1]) as Pt })),
  }));
  const groundObjects: ObjSpec[] = [
    { name: "vegetation/trees/pine_tree_02", at: [1.5, 1.5], scale: 0.8 },
    { name: "vegetation/trees/pine_tree_02", at: [14.5, 8.5], scale: 0.9, rot: -0.52 },
    { name: "vegetation/trees/pine_tree_02", at: [1.6, 10.2], scale: 0.7 },
    { name: "vegetation/trees/pine_tree_02", at: [9.5, 10.0], scale: 0.8 },
    { name: "vegetation/trees/dead_tree_02", at: [12.0, 7.8], rot: -2.88 },
    { name: "vegetation/trees/dead_tree_02", at: [6.0, 9.6], rot: 1.1 },
    { name: "clutter/boulders/boulder_08", at: [9.0, 6.5] },
    { name: "clutter/boulders/boulder_08", at: [2.0, 5.0], rot: 1.2 },
    { name: "supplies/crates/crate_01", at: [4.5, 4.5] },
    { name: "supplies/crates/crate_01", at: [11.0, 3.0], rot: 0.3 },
    { name: "vegetation/grass/grass_13", at: [7.5, 1.2], scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [15.0, 1.0], scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [3.6, 8.4], scale: 1.6 },
    { name: "vegetation/grass/grass_13", at: [13.6, 10.8], scale: 1.6 },
  ];
  const ground: LevelSpec = {
    key: "1", label: "Ground", terrain: snow, walls,
    floor: { polygons: BUILDINGS.map((b) => rectRing(b[0], b[1], b[2], b[3])), cells: BUILDINGS.map((b) => [b[0], b[1], b[2] - b[0], b[3] - b[1]] as [number, number, number, number]), tileset: "smart/tileset_wood_vertical" },
    paths: [{ at: [0, 8.2], pts: [[0, 0], [4, -0.2], [8, 0.3], [16, 0]], texture: "wagon_trail", width: 1 }],
    objects: groundObjects,
    lights: [{ at: [5.5, 5], range: 2.2 }, { at: [12, 3.5], range: 2.2 }],
  };
  const roofLevel: LevelSpec = {
    key: "0", label: "Roof", terrain: { ...snow, enabled: false },
    roofs: BUILDINGS.map((b) => ({ ridge: [[b[0], (b[1] + b[3]) / 2], [b[2], (b[1] + b[3]) / 2]] as Pt[], width: (b[3] - b[1]) / 2, texture: "round_slate_gray", type: 1 as const })),
    objects: [
      { name: "environment/snow_03", at: [4.5, 4.2], layer: DD_LAYER.ABOVE_ROOFS },
      { name: "environment/snow_08", at: [6.8, 5.8], layer: DD_LAYER.ABOVE_ROOFS },
      { name: "environment/snow_05", at: [12, 3.0], layer: DD_LAYER.ABOVE_ROOFS },
      { name: "environment/snow_08", at: [10.8, 4.2], layer: DD_LAYER.ABOVE_ROOFS },
    ],
  };
  const currentLevel = 0;
  const text = mapText({ w: W, h: H, levels: [roofLevel, ground], currentLevel });
  return {
    text, groundKey: "1", roofKey: "0", currentLevel,
    vtt: {
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: W, y: H }, pixels_per_grid: 64 },
      portals: doors.flat().map((d) => ({ position: sq(d) })),
      lights: ground.lights!.map((l) => ({ position: sq(l.at) })),
      line_of_sight: BUILDINGS.map((b) => loopLine(rectRing(b[0], b[1], b[2], b[3]))),
    },
  };
}

/** Two terrain levels (both labelled "Ground") holding the same objects: no export, no object winner, so the level is unclear. */
export function twinLevels(): { text: string; keys: [string, string] } {
  const W = 16, H = 12;
  const objects = scatterObjects(W, H, 7, 16);
  const terrain: TerrainSpec = { slots: ["terrain_snow"], weights: () => [255] };
  const text = mapText({ w: W, h: H, levels: [
    { key: "0", label: "Ground", terrain, objects },
    { key: "1", label: "Ground", terrain, objects },
  ] });
  return { text, keys: ["0", "1"] };
}

// ------------------------------------------------------------------ transforms and measurement

export interface TransformsMap {
  text: string;
  w: number;
  h: number;
  levelKey: string;
  objects: {
    /** tree_big_green_02 (egg-shaped) at rotation 30 degrees, mirrored, scale (1.1, 0.9), on grass. */
    turned: number;
    /** A green tree on snow whose prior (SPRITE_SIZES) overshoots its sprite by 1.31: not capped. */
    small: number;
    /** A snow-capped crown on snow (draw it with fakeExportFromMap's `capped`). */
    capped: number;
    /** A pack crown, 2 squares across. */
    pack: number;
    /** A bare tree to draw with thin strokes (fakeExportFromMap's stroke: 0.5). */
    bare: number;
  };
  /** The objects the picture shows snow-capped. */
  capped: number[];
  /** Paths: a wagon trail turned and mirrored (scale.y -1); a pack cliff. Pattern 0: cobbles turned 30 degrees and mirrored (scale.x < 0). */
  paths: { trail: number; packCliff: number };
  pattern: number;
}

export function transformsMap(): TransformsMap {
  const W = 16, H = 10;
  const terrain: TerrainSpec = {
    slots: ["terrain_snow", "terrain_grass"],
    weights: (tx) => { const g = clamp01(tc(tx) - 7.5); return bytes([1 - g, g]); },
  };
  const objects: ObjSpec[] = [
    { name: "vegetation/trees/tree_big_green_02", at: [11.5, 3.2], rot: Math.PI / 6, mirror: true, scale: [1.1, 0.9] },
    { name: "vegetation/trees/tree_green_simple_01", at: [3.0, 2.4] },
    { name: "vegetation/trees/tree_big_green_01", at: [3.2, 6.9], rot: 0.7 },
    { name: `${PACK_PREFIX}frosted_oak_02`, at: [6.6, 2.4] },
    { name: "vegetation/trees/dead_tree_01", at: [6.6, 8.6], rot: -2.88, scale: 1.5 },
  ];
  const text = mapText({ w: W, h: H, levels: [{
    key: "0", label: "Ground", terrain, objects,
    paths: [
      { at: [8.8, 8.6], rot: -0.2, scale: [1, -1], pts: [[0, 0], [2, 0.5], [4, 0]], texture: "wagon_trail", width: 1 },
      { at: [0.5, 0.6], rot: 0.08, pts: [[0, 0], [2, 0.2], [4, 0.1]], texture: `${PACK_PREFIX}icy_cliff`, width: 0.5 },
    ],
    patterns: [{ at: [14.4, 7.3], rot: Math.PI / 6, scale: [-1.2, 0.8], pts: [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]], texture: "simple/tileset_cobble" }],
  }] });
  return {
    text, w: W, h: H, levelKey: "0",
    objects: { turned: 0, small: 1, capped: 2, pack: 3, bare: 4 }, capped: [2],
    paths: { trail: 0, packCliff: 1 }, pattern: 0,
  };
}

// ------------------------------------------------------------------ interiors

export interface InteriorsMap {
  text: string;
  w: number;
  h: number;
  levelKey: string;
  /** Rectangles [x0, y0, x1, y1] in squares. */
  mill: [number, number, number, number];
  hut: [number, number, number, number];
  yard: [number, number, number, number];
  caveLoop: [number, number, number, number];
}

/**
 * The Mill-like interior: a closed wood wall (Wall tool, loop) round 8 x 6 squares over a wood
 * pattern, no floor polygons or roof. The hut: 4 x 4 squares of terrain closed by two open walls
 * whose ends meet within a tenth of a square. The yard: a 10 x 10 loop of stone wall round
 * terrain and a few tufts. A cave-wall loop (type 2), which encloses nothing indoor.
 */
export function interiorsMap(): InteriorsMap {
  const W = 30, H = 14;
  const mill: [number, number, number, number] = [1, 1, 9, 7];
  const hut: [number, number, number, number] = [11, 2, 15, 6];
  const yard: [number, number, number, number] = [18, 2, 28, 12];
  const caveLoop: [number, number, number, number] = [2, 9, 5, 12];
  const terrain: TerrainSpec = { slots: ["terrain_grass", "terrain_dirt"], weights: (tx, ty) => {
    const x = tc(tx), y = tc(ty);
    const d = x > yard[0] + 1 && x < yard[2] - 1 && y > yard[1] + 1 && y < yard[3] - 1 && Math.hypot(x - 23, y - 7) < 3 ? 1 : 0;
    return bytes([1 - d, d]);
  } };
  const text = mapText({ w: W, h: H, levels: [{
    key: "0", label: "Ground", terrain,
    walls: [
      { pts: rectRing(mill[0], mill[1], mill[2], mill[3]), loop: true, type: 1, texture: "wood" },
      { pts: [[hut[0], hut[1]], [hut[2], hut[1]], [hut[2], hut[3]]], type: 1, texture: "wood" },
      { pts: [[hut[2], hut[3] + 0.1], [hut[0], hut[3]], [hut[0], hut[1] + 0.1]], type: 1, texture: "wood" },
      { pts: rectRing(yard[0], yard[1], yard[2], yard[3]), loop: true, type: 1, texture: "stone" },
      { pts: rectRing(caveLoop[0], caveLoop[1], caveLoop[2], caveLoop[3]), loop: true, type: 2, texture: "cave" },
    ],
    patterns: [{ pts: rectRing(mill[0], mill[1], mill[2], mill[3]), texture: "simple/tileset_wood_interlaced" }],
    objects: [
      { name: "vegetation/grass/grass_13", at: [20, 4], scale: 1.6 },
      { name: "vegetation/grass/grass_13", at: [26, 10], scale: 1.6 },
      { name: "supplies/crates/crate_01", at: [3, 3] },
      { name: "clutter/boulders/boulder_08", at: [13, 4] },
    ],
  }] });
  return { text, w: W, h: H, levelKey: "0", mill, hut, yard, caveLoop };
}

// ------------------------------------------------------------------ the fit: scattered objects

/** A seeded generator (LCG), 0 <= x < 1. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

const SCATTER_NAMES = [
  "vegetation/trees/pine_tree_02", "more_trees/oak_04", "vegetation/trees/dead_tree_02", "clutter/boulders/boulder_08",
  "supplies/crates/crate_01", "vegetation/grass/grass_13", "vegetation/shrubs/bush_green_simple_01", "vegetation/trees/stump_03",
  "vegetation/fallen/log_02",
];

/** `n` objects scattered over w x h squares, a square inside the edge, their outlines 0.3 square or more apart. */
function scatterObjects(w: number, h: number, seed: number, n: number): ObjSpec[] {
  const r = rng(seed);
  const out: ObjSpec[] = [];
  const radius: number[] = [];
  for (let tries = 0; out.length < n && tries < 5000; tries++) {
    const name = SCATTER_NAMES[Math.floor(r() * SCATTER_NAMES.length)];
    const at: Pt = [Math.round((1 + r() * (w - 2)) * 16) / 16, Math.round((1 + r() * (h - 2)) * 16) / 16];
    const scale = Math.round((/grass/.test(name) ? 1.6 : /oak|pine/.test(name) ? 0.7 + 0.2 * r() : 0.9 + 0.3 * r()) * 100) / 100;
    const rad = (FIXTURE_SPRITES[name].r * scale) / GRID;
    if (out.some((o, i) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1]) < rad + radius[i] + 0.3)) continue;
    out.push({ name, at, rot: Math.round((r() * 2 - 1) * Math.PI * 100) / 100, scale, mirror: r() < 0.3 });
    radius.push(rad);
  }
  return out;
}

export interface ScatterMap {
  text: string;
  w: number;
  h: number;
  levelKey: string;
  objects: number;
}

/** A 20 x 12 snowy map with 20 objects scattered by `seed` (a grass patch top-right), for the fit. */
export function scatterMap(seed: number, n = 20): ScatterMap {
  const W = 20, H = 12;
  const terrain: TerrainSpec = { slots: ["terrain_snow", "terrain_grass"], weights: (tx, ty) => {
    const g = clamp01(Math.min((tc(tx) - 14) / 1, (5 - tc(ty)) / 1));
    return bytes([1 - g, g]);
  } };
  const objects = scatterObjects(W, H, seed, n);
  const text = mapText({ w: W, h: H, levels: [{ key: "0", label: "Ground", terrain, objects }] });
  return { text, w: W, h: H, levelKey: "0", objects: objects.length };
}

export interface EditedPicture {
  /** The map as saved, after the picture was exported. */
  text: string;
  /** The map as it was when the picture was exported: draw the picture from this one. */
  pictureText: string;
  levelKey: string;
  /**
   * Indices (into the saved map's objects) of trees the picture doesn't show at their saved
   * places: a pine added since the export (`erased`: the picture lacks it), and an oak moved
   * `movedBy` since (the picture shows it at its old place, clear of its saved core).
   */
  erased: number;
  moved: number;
  /** How far the oak moved since the export, squares: more than its crown's radius plus its prior core's (2.5: 0.7 x prior). */
  movedBy: Pt;
  /** The moved oak's index in pictureText's objects (where the picture shows it). */
  movedFrom: number;
  /** Objects painted into the picture that the saved map doesn't have (the last ones of pictureText's objects). */
  added: number;
}

/**
 * The edited-picture case (6.5): the saved map has every object; the export was made before a
 * pine was added and before an oak was moved, and shows a boulder since deleted. So the picture
 * lacks objects `erased` and `moved` (at its saved place) and shows one the map doesn't hold.
 */
export function editedPicture(): EditedPicture {
  const W = 20, H = 12;
  const terrain: TerrainSpec = { slots: ["terrain_snow"], weights: () => [255] };
  const base = scatterObjects(W, H, 11, 14);
  const taken = base.map((o): [number, number, number] => [o.at[0], o.at[1], (FIXTURE_SPRITES[o.name].r * scaleOf(o)[0]) / GRID]);
  const pine = clearSpot(W, H, taken, [[0, 0]], (340 * 0.8) / GRID);
  // The oak (crown 1.29 squares at 0.7) moves 3 squares: its old crown can't reach the core of
  // its saved place (0.7 x SPRITE_SIZES's 435 x 0.7 = 0.83 square), so presence must drop it.
  const movedBy: Pt = [3, 0];
  const oak = clearSpot(W, H, taken, [[0, 0], movedBy], (470 * 0.7) / GRID);
  const boulder = clearSpot(W, H, taken, [[0, 0]], 180 / GRID);
  const saved: ObjSpec[] = [...base,
    { name: "vegetation/trees/pine_tree_02", at: pine, scale: 0.8 },
    { name: "more_trees/oak_04", at: [oak[0] + movedBy[0], oak[1] + movedBy[1]], scale: 0.7 },
  ];
  const erased = base.length, moved = base.length + 1;
  const asExported: ObjSpec[] = [...base,
    { name: "more_trees/oak_04", at: oak, scale: 0.7 },
    { name: "clutter/boulders/boulder_08", at: boulder },
  ];
  return {
    text: mapText({ w: W, h: H, levels: [{ key: "0", label: "Ground", terrain, objects: saved }] }),
    pictureText: mapText({ w: W, h: H, levels: [{ key: "0", label: "Ground", terrain, objects: asExported }] }),
    levelKey: "0", erased, moved, movedBy, movedFrom: base.length, added: 1,
  };
}

/**
 * The first point of a 0.5-square lattice (a square inside the edge) where an object of radius
 * `r` at each of the offsets keeps 0.3 square clear of every object taken ([x, y, radius]); the
 * new ones are added to the taken list.
 */
function clearSpot(w: number, h: number, taken: Array<[number, number, number]>, offsets: Pt[], r: number): Pt {
  for (let y = 1.5; y <= h - 1.5; y += 0.5) {
    for (let x = 1.5; x <= w - 1.5; x += 0.5) {
      const pts = offsets.map(([dx, dy]): Pt => [x + dx, y + dy]);
      if (pts.some(([px, py]) => px > w - 1 || py > h - 1)) continue;
      if (pts.every(([px, py]) => taken.every(([tx, ty, tr]) => Math.hypot(px - tx, py - ty) >= r + tr + 0.3))) {
        for (const [px, py] of pts) taken.push([px, py, r]);
        return [x, y];
      }
    }
  }
  throw new Error("ddSynthetic: no clear spot");
}

export interface FitPair {
  name: string;
  /** The map attached. */
  mapText: string;
  /** Draw the picture from this map (fakeExportFromMap) with these options. */
  pictureText: string;
  levelKey: string;
  /** fakeExportFromMap's options: shift moves the drawn content by that many squares; crop exports that part. */
  picture: { shift?: Pt; crop?: [number, number, number, number] };
  /** The fit must give: "yes", "no" (with `best` as its best shift, in squares), or anything but "yes". */
  expect: "yes" | "no" | "not-yes";
  /** The correction: the shift (squares) that, added to the object centres, lines them up with the picture. */
  best?: Pt;
}

/**
 * The fit's pairs (2.4, 6.3 "Fit, negatives included"): a correct pair; map A on a same-size
 * picture of map B; the picture's content drawn 2 squares left of where the map puts it (the
 * correction, added to the object centres, is -2 squares); shifted half a square; a same-aspect half-scale crop exported plain (a 10 x 6
 * part, to be read as the whole 20 x 12 map).
 */
export function fitPairs(): FitPair[] {
  const a = scatterMap(1), b = scatterMap(2);
  return [
    { name: "correct", mapText: a.text, pictureText: a.text, levelKey: "0", picture: {}, expect: "yes" },
    { name: "swapped", mapText: a.text, pictureText: b.text, levelKey: "0", picture: {}, expect: "not-yes" },
    { name: "shifted 2 squares", mapText: a.text, pictureText: a.text, levelKey: "0", picture: { shift: [-2, 0] }, expect: "no", best: [-2, 0] },
    { name: "shifted half a square", mapText: a.text, pictureText: a.text, levelKey: "0", picture: { shift: [0.5, 0.5] }, expect: "not-yes" },
    { name: "half-scale crop", mapText: a.text, pictureText: a.text, levelKey: "0", picture: { crop: [5, 3, 10, 6] }, expect: "not-yes" },
  ];
}

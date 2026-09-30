// .dungeondraft_map text -> typed model. Pure: no DOM, no Node APIs.
//
// Robustness contract:
//  * Throws DDParseError only when the input is not a Dungeondraft map at all (not JSON, no
//    world, bad width/height, over the size limit). Everything below that degrades: a broken
//    field is skipped and a warning is recorded.
//  * Never allocates beyond the limits: the text's nesting and value count are checked before
//    JSON.parse (whose memory nothing else bounds), array sizes against the map's own
//    width/height before decoding, point counts against a whole-map budget, items against
//    per-kind and whole-map counts, and decoded grids against a whole-map byte budget.
//  * Keeps geometry local: scales, widths and portal radii are clamped (maxScale, maxWidth), so
//    one item's footprint or ribbon cannot cover the world. Positions are only checked finite.
//  * Safe on files from anywhere (it runs in the GM's browser): no eval, no recursion except
//    the depth-limited water tree, linear-time value readers, and no object is ever keyed by
//    a name from the file (Maps only), so "__proto__" and friends are inert.

import {
  num, bool, str, parseVector2, parsePoolByteArray, parsePoolIntArray, parsePoolVector2Array,
  parseColor, parseNodeId, intKey, type Vec2,
} from "./godot";
import { parseAssetRef } from "./assets";
import {
  DEFAULT_LIMITS, TERRAIN_PER_SQUARE, CAVE_PER_SQUARE, MATERIAL_PER_SQUARE, MS_EDGE_BUFFER, GRID,
  type ParseLimits, type DDMap, type Header, type World, type Level, type AssetPack, type Terrain,
  type Water, type WaterNode, type Cave, type BitGrid, type Material, type Tiles, type MapObject,
  type Path, type Portal, type Wall, type Pattern, type Roof, type Light, type AssetRef,
} from "./model";

export class DDParseError extends Error {
  constructor(message: string) { super(message); this.name = "DDParseError"; }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface Ctx {
  limits: ParseLimits;
  warnings: string[];
  packs: Map<string, AssetPack>;
  pointsLeft: number;
  itemsLeft: number;
  gridBytesLeft: number;
  width: number;
  height: number;
  /** Scales, widths and radii clamped to the limits (one warning at the end). */
  clamped: number;
}

function warn(ctx: Ctx, msg: string): void {
  if (ctx.warnings.length < 500) ctx.warnings.push(msg);
  else if (ctx.warnings.length === 500) ctx.warnings.push("(further warnings suppressed)");
}

/** Takes `bytes` from the grid budget; false (with a warning) when it is spent. */
function chargeGrid(ctx: Ctx, bytes: number, what: string): boolean {
  if (bytes > ctx.gridBytesLeft) {
    warn(ctx, `${what}: over the memory budget for decoded grids; dropped`);
    return false;
  }
  ctx.gridBytesLeft -= bytes;
  return true;
}

/** A value from the file, shortened for an error message. */
function shown(v: unknown): string {
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" || v === null || v === undefined ? String(v) : typeof v;
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

/** Only the known limits, and only non-negative numbers, override the defaults. */
function mergeLimits(inp: Partial<ParseLimits>): ParseLimits {
  const out: ParseLimits = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(DEFAULT_LIMITS) as (keyof ParseLimits)[]) {
    const v = inp[k];
    if (typeof v === "number" && v >= 0) out[k] = v;
  }
  return out;
}

/**
 * Refuses text that nests deeper than maxJsonDepth or holds more containers or values than the
 * limits, before JSON.parse builds it. Linear: string bodies are skipped with indexOf.
 */
function checkJsonShape(text: string, limits: ParseLimits): void {
  let depth = 0, containers = 0, values = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      // To the closing quote: one not preceded by an odd run of backslashes.
      let j = i;
      for (;;) {
        j = text.indexOf('"', j + 1);
        if (j < 0) return; // unterminated: JSON.parse refuses it
        let b = j - 1;
        while (text.charCodeAt(b) === 92) b--;
        if ((j - 1 - b) % 2 === 0) break;
      }
      i = j;
    } else if (c === 123 || c === 91) {
      if (++depth > limits.maxJsonDepth) throw new DDParseError(`nested deeper than ${limits.maxJsonDepth}`);
      if (++containers > limits.maxJsonContainers) throw new DDParseError(`more than ${limits.maxJsonContainers} objects and arrays`);
      if (++values > limits.maxJsonValues) throw new DDParseError(`more than ${limits.maxJsonValues} values`);
    } else if (c === 125 || c === 93) {
      depth--;
    } else if (c === 44) {
      if (++values > limits.maxJsonValues) throw new DDParseError(`more than ${limits.maxJsonValues} values`);
    }
  }
}

/** Godot's JSON.print can emit bare nan / inf for broken floats; JSON.parse rejects them. */
function sanitizeNonFinite(text: string): string {
  // Only outside strings: walk the text and replace tokens.
  let out = "";
  let last = 0, inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++; // backslash escape
      else if (c === 34) inStr = false;
      continue;
    }
    if (c === 34) { inStr = true; continue; }
    if (c === 110 /* n */ && text.startsWith("nan", i)) { out += text.slice(last, i) + "0"; i += 2; last = i + 1; }
    else if (c === 105 /* i */ && text.startsWith("inf", i)) { out += text.slice(last, i) + "0"; i += 2; last = i + 1; }
  }
  return out + text.slice(last);
}

export function parseDungeondraftMap(text: string, limitsIn: Partial<ParseLimits> = {}): DDMap {
  const limits = mergeLimits(limitsIn ?? {});
  if (typeof text !== "string") throw new DDParseError("input is not text");
  if (text.length > limits.maxChars) throw new DDParseError(`file too large (${text.length} chars, limit ${limits.maxChars})`);
  let root: unknown;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  checkJsonShape(text, limits);
  try {
    root = JSON.parse(text);
  } catch {
    try { root = JSON.parse(sanitizeNonFinite(text)); } catch { throw new DDParseError("not JSON"); }
  }
  if (!isObj(root)) throw new DDParseError("top level is not an object");
  const worldIn = root.world;
  if (!isObj(worldIn)) throw new DDParseError("no world object: not a .dungeondraft_map");
  const width = num(worldIn.width), height = num(worldIn.height);
  if (width === null || height === null || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > limits.maxSide || height > limits.maxSide) {
    throw new DDParseError(`bad map size ${shown(worldIn.width)}x${shown(worldIn.height)}`);
  }

  const warnings: string[] = [];
  const ctx: Ctx = {
    limits, warnings, packs: new Map(), pointsLeft: limits.maxTotalPoints, itemsLeft: limits.maxTotalItems,
    gridBytesLeft: limits.maxGridBytes, width, height, clamped: 0,
  };
  const header = parseHeader(isObj(root.header) ? root.header : {}, ctx);
  const world = parseWorld(worldIn, ctx);
  if (ctx.clamped) warn(ctx, `${ctx.clamped} scales, widths or radii beyond ${limits.maxScale}x / ${limits.maxWidth} units clamped`);
  return { header, world, warnings };
}

// ------------------------------------------------------------------ header

function parseHeader(h: Obj, ctx: Ctx): Header {
  for (const p of arr(h.asset_manifest).slice(0, 1000)) {
    if (!isObj(p)) continue;
    const id = str(p.id, 64);
    if (!id) continue;
    const pack: AssetPack = {
      id,
      name: str(p.name, 512) ?? "",
      version: str(p.version, 64) ?? "",
      author: str(p.author, 512) ?? "",
      allowThirdParty: bool(p.allow_3rd_party_mapping_software_to_read) === true,
    };
    ctx.packs.set(id, pack);
  }
  const d = isObj(h.creation_date) ? h.creation_date : null;
  const es = isObj(h.editor_state) ? h.editor_state : {};
  const cl = num(es.current_level);
  const ti = es.trace_image;
  return {
    creationBuild: str(h.creation_build, 256),
    creationDate: d && num(d.year) !== null ? { year: num(d.year)!, month: num(d.month) ?? 0, day: num(d.day) ?? 0 } : null,
    usesDefaultAssets: bool(h.uses_default_assets),
    packs: [...ctx.packs.values()],
    currentLevel: cl !== null && Number.isInteger(cl) ? cl : null,
    cameraPosition: parseVector2(es.camera_position),
    cameraZoom: num(es.camera_zoom),
    hasTraceImage: isObj(ti) && Object.keys(ti).length > 0,
  };
}

// ------------------------------------------------------------------ world

function parseWorld(w: Obj, ctx: Ctx): World {
  const levelsIn = isObj(w.levels) ? w.levels : {};
  const keys = Object.keys(levelsIn)
    .filter((k) => intKey(k) !== null)
    .sort((a, b) => Number(a) - Number(b));
  if (keys.length > ctx.limits.maxLevels) warn(ctx, `only the first ${ctx.limits.maxLevels} of ${keys.length} levels read`);
  const levels: Level[] = [];
  for (const k of keys.slice(0, ctx.limits.maxLevels)) {
    const L = levelsIn[k];
    if (!isObj(L)) { warn(ctx, `level ${k} is not an object`); continue; }
    levels.push(parseLevel(k, L, ctx));
  }
  const msi = isObj(w.msi) ? w.msi : null;
  const grid = isObj(w.grid) ? w.grid : {};
  return {
    format: num(w.format),
    width: ctx.width,
    height: ctx.height,
    nextNodeId: parseNodeId(w.next_node_id),
    gridColor: parseColor(grid.color),
    wallShadow: bool(w.wall_shadow),
    objectShadow: bool(w.object_shadow),
    embeddedCount: isObj(w.embedded) ? Object.keys(w.embedded).length : 0,
    msi: msi ? {
      cellSize: num(msi.cell_size) ?? 64,
      maxOffsetDistance: num(msi.max_offset_distance) ?? 0,
      offsetMapSize: num(msi.offset_map_size) ?? 0,
      seed: str(msi.seed, 32) ?? "",
    } : null,
    levels,
  };
}

function items(v: unknown, what: string, ctx: Ctx): Obj[] {
  const a = arr(v);
  const max = Math.min(ctx.limits.maxItemsPerKind, ctx.itemsLeft);
  if (a.length > max) warn(ctx, `${what}: only the first ${max} of ${a.length} read`);
  const out = a.slice(0, max).filter(isObj);
  ctx.itemsLeft -= out.length;
  return out;
}

function points(v: unknown, what: string, ctx: Ctx): Float64Array | null {
  if (v === undefined || v === null) return null;
  const maxPts = Math.min(ctx.limits.maxPointsPerShape, ctx.pointsLeft);
  const p = parsePoolVector2Array(v, maxPts);
  if (p === null) { warn(ctx, `${what}: unreadable or too many points`); return null; }
  ctx.pointsLeft -= p.length / 2;
  return p;
}

function asset(v: unknown, ctx: Ctx): AssetRef | null {
  return parseAssetRef(v, ctx.packs);
}

function parseLevel(key: string, L: Obj, ctx: Ctx): Level {
  const where = `level ${key}`;
  const layers = new Map<number, string>();
  if (isObj(L.layers)) {
    for (const [k, v] of Object.entries(L.layers).slice(0, 1000)) {
      const n = intKey(k);
      const s = str(v, 256);
      if (n !== null && s !== null) layers.set(n, s);
    }
  }
  const env = isObj(L.environment) ? L.environment : {};
  const shapes = isObj(L.shapes) ? L.shapes : {};
  const floorPolygons: Float64Array[] = [];
  const polys = arr(shapes.polygons).slice(0, Math.min(ctx.limits.maxItemsPerKind, ctx.itemsLeft));
  ctx.itemsLeft -= polys.length;
  for (const p of polys) {
    const pts = points(p, `${where} floor polygon`, ctx);
    if (pts && pts.length >= 6) floorPolygons.push(pts);
  }
  const floorWallIds: number[] = [];
  for (const id of arr(shapes.walls).slice(0, ctx.limits.maxItemsPerKind)) {
    const n = parseNodeId(id);
    if (n !== null) floorWallIds.push(n);
  }
  const roofsIn = L.roofs;
  const roofsObj = isObj(roofsIn) ? roofsIn : null;
  const roofList = roofsObj ? roofsObj.roofs : Array.isArray(roofsIn) ? roofsIn : [];

  return {
    key,
    id: Number(key),
    label: str(L.label, 512) ?? `Level ${key}`,
    layers,
    ambientLight: parseColor(env.ambient_light),
    bakedLighting: bool(env.baked_lighting),
    terrain: isObj(L.terrain) ? parseTerrain(L.terrain, `${where} terrain`, ctx) : null,
    water: parseWater(L.water, `${where} water`, ctx),
    cave: isObj(L.cave) ? parseCave(L.cave, `${where} cave`, ctx) : null,
    tiles: L.tiles !== undefined ? parseTiles(L.tiles, `${where} tiles`, ctx) : null,
    floorPolygons,
    floorWallIds,
    materials: parseMaterials(L.materials, `${where} materials`, ctx),
    patterns: items(L.patterns, `${where} patterns`, ctx).map((p) => parsePattern(p, ctx)).filter((p): p is Pattern => p !== null),
    walls: items(L.walls, `${where} walls`, ctx).map((w) => parseWall(w, ctx)).filter((w): w is Wall => w !== null),
    portals: items(L.portals, `${where} portals`, ctx).map((p) => parsePortal(p, ctx)).filter((p): p is Portal => p !== null),
    paths: items(L.paths, `${where} paths`, ctx).map((p) => parsePath(p, ctx)).filter((p): p is Path => p !== null),
    objects: items(L.objects, `${where} objects`, ctx).map((o, i) => parseObject(o, i, ctx)).filter((o): o is MapObject => o !== null),
    lights: items(L.lights, `${where} lights`, ctx).map((l) => parseLight(l, ctx)).filter((l): l is Light => l !== null),
    roofs: items(roofList, `${where} roofs`, ctx).map((r) => parseRoof(r, ctx)).filter((r): r is Roof => r !== null),
    roofShade: roofsObj ? {
      enabled: bool(roofsObj.shade) ?? true,
      contrast: num(roofsObj.shade_contrast) ?? 0.5,
      sunDirection: num(roofsObj.sun_direction) ?? 45,
    } : null,
    textCount: arr(L.texts).length,
  };
}

// ------------------------------------------------------------------ terrain

function parseTerrain(t: Obj, where: string, ctx: Ctx): Terrain | null {
  const tw = ctx.width * TERRAIN_PER_SQUARE, th = ctx.height * TERRAIN_PER_SQUARE;
  const n = tw * th;
  if (!chargeGrid(ctx, 8 * n, where)) return null;
  const expand = bool(t.expand_slots) === true;
  const slots: (AssetRef | null)[] = [];
  for (let i = 1; i <= 8; i++) slots.push(asset(t[`texture_${i}`], ctx));
  const splat = t.splat === undefined ? null : parsePoolByteArray(t.splat, n * 4);
  if (splat === null || splat.length !== n * 4) {
    if (t.splat !== undefined) warn(ctx, `${where}: splat is not ${tw}x${th} RGBA (${splat ? splat.length : "unreadable"} bytes); terrain weights dropped`);
    // Terrain with no splat: slot 1 everywhere (a fresh map).
  }
  let splat2: Uint8Array | null = null;
  if (expand && t.splat2 !== undefined) {
    splat2 = parsePoolByteArray(t.splat2, n * 4);
    if (splat2 === null || splat2.length !== n * 4) {
      warn(ctx, `${where}: splat2 is not ${tw}x${th} RGBA; slots 5-8 dropped`);
      splat2 = null;
    }
  }
  const slotCount = expand ? 8 : 4;
  const weights = new Uint8Array(8 * n);
  if (splat && splat.length === n * 4) {
    for (let i = 0; i < n; i++) {
      weights[i] = splat[i * 4];
      weights[n + i] = splat[i * 4 + 1];
      weights[2 * n + i] = splat[i * 4 + 2];
      weights[3 * n + i] = splat[i * 4 + 3];
    }
    if (splat2) {
      for (let i = 0; i < n; i++) {
        weights[4 * n + i] = splat2[i * 4];
        weights[5 * n + i] = splat2[i * 4 + 1];
        weights[6 * n + i] = splat2[i * 4 + 2];
        weights[7 * n + i] = splat2[i * 4 + 3];
      }
    }
  } else {
    weights.fill(255, 0, n);
  }
  // Weights of the active slots sum to ~255 (253-255 seen). Much less means slots we cannot see:
  // painted slots 5-8 with expand_slots turned off, or a mod's extra slots (the Unofficial Patch has 24).
  let low = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < slotCount; k++) s += weights[k * n + i];
    if (s < 200) low++;
  }
  if (low > n * 0.01) warn(ctx, `${where}: ${(100 * low / n).toFixed(1)}% of texels have slot weights summing below 200/255 (hidden or modded slots?)`);
  return {
    enabled: bool(t.enabled) !== false,
    expandSlots: expand,
    smoothBlending: bool(t.smooth_blending) === true,
    slots,
    width: tw,
    height: th,
    weights,
    slotCount,
  };
}

// ------------------------------------------------------------------ water

function parseWater(v: unknown, where: string, ctx: Ctx): Water {
  if (!isObj(v)) return { disableBorder: false, root: null };
  let nodes = 0;
  const walk = (o: unknown, depth: number): WaterNode | null => {
    if (!isObj(o)) return null;
    if (depth > ctx.limits.maxWaterDepth) { warn(ctx, `${where}: tree deeper than ${ctx.limits.maxWaterDepth}; cut`); return null; }
    if (++nodes > ctx.limits.maxWaterNodes) { if (nodes === ctx.limits.maxWaterNodes + 1) warn(ctx, `${where}: too many water nodes; cut`); return null; }
    const poly = o.polygon === undefined ? new Float64Array(0) : (points(o.polygon, `${where} polygon`, ctx) ?? new Float64Array(0));
    const children: WaterNode[] = [];
    for (const c of arr(o.children)) {
      const cn = walk(c, depth + 1);
      if (cn) children.push(cn);
    }
    const ref = num(o.ref);
    const deep = parseColor(o.deep_color), shallow = parseColor(o.shallow_color);
    return {
      ref: ref !== null && Number.isInteger(ref) ? ref : null,
      polygon: poly,
      depth,
      isOpen: bool(o.is_open) === true,
      deepColor: deep,
      shallowColor: shallow,
      blendDistance: num(o.blend_distance),
      children,
    };
  };
  return { disableBorder: bool(v.disable_border) === true, root: walk(v.tree, 0) };
}

// ------------------------------------------------------------------ marching-squares bitmaps

/** Godot BitMap data: bit (y*w + x), least-significant bit first within each byte. */
function unpackBits(v: unknown, perSquare: number, where: string, ctx: Ctx): BitGrid | null {
  if (v === undefined || v === null) return null;
  const w = ctx.width * perSquare + 2 * MS_EDGE_BUFFER + 1;
  const h = ctx.height * perSquare + 2 * MS_EDGE_BUFFER + 1;
  const nbits = w * h;
  const nbytes = Math.ceil(nbits / 8);
  const bytes = parsePoolByteArray(v, nbytes);
  if (bytes === null) { warn(ctx, `${where}: unreadable or larger than ${w}x${h} bits`); return null; }
  if (bytes.length === 0) return null; // never painted
  if (bytes.length !== nbytes) { warn(ctx, `${where}: ${bytes.length} bytes, expected ${nbytes} for ${w}x${h}; dropped`); return null; }
  if (!chargeGrid(ctx, nbits, where)) return null;
  const bits = new Uint8Array(nbits);
  let any = false;
  for (let i = 0; i < nbits; i++) {
    const b = (bytes[i >> 3] >> (i & 7)) & 1;
    bits[i] = b;
    if (b) any = true;
  }
  if (!any) return null;
  return { width: w, height: h, step: GRID / perSquare, bits };
}

function parseCave(c: Obj, where: string, ctx: Ctx): Cave | null {
  const floor = unpackBits(c.bitmap, CAVE_PER_SQUARE, `${where} bitmap`, ctx);
  const entrance = unpackBits(c.entrance_bitmap, CAVE_PER_SQUARE, `${where} entrance_bitmap`, ctx);
  if (!floor && !entrance) return null;
  return {
    floor,
    entrance,
    groundColor: parseColor(c.ground_color),
    wallColor: parseColor(c.wall_color),
    texture: asset(c.texture, ctx),
  };
}

function parseMaterials(v: unknown, where: string, ctx: Ctx): Material[] {
  const out: Material[] = [];
  if (!isObj(v)) return out;
  for (const [k, list] of Object.entries(v)) {
    const layer = intKey(k);
    if (layer === null) continue;
    for (const m of items(list, `${where} layer ${k}`, ctx)) {
      out.push({
        layer,
        texture: asset(m.texture, ctx),
        smooth: bool(m.smooth) === true,
        mask: unpackBits(m.bitmap, MATERIAL_PER_SQUARE, `${where} layer ${k} bitmap`, ctx),
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ tiles (Building tool floors)

function parseTiles(v: unknown, where: string, ctx: Ctx): Tiles | null {
  const n = ctx.width * ctx.height;
  const t = isObj(v) ? v : null;
  const cellsIn = t ? t.cells : v; // very old saves stored the PoolIntArray directly
  const cells = parsePoolIntArray(cellsIn, n);
  if (cells === null || cells.length !== n) {
    if (cellsIn !== undefined) warn(ctx, `${where}: cells is not ${ctx.width}x${ctx.height}; dropped`);
    return null;
  }
  if (!chargeGrid(ctx, 4 * n, where)) return null;
  let colors: Tiles["colors"] = null;
  if (t && Array.isArray(t.colors)) {
    if (t.colors.length === n) colors = t.colors.map((c) => parseColor(c));
    else warn(ctx, `${where}: ${t.colors.length} colours for ${n} cells; ignored`);
  }
  const lookup = new Map<number, AssetRef>();
  if (t && isObj(t.lookup)) {
    for (const [k, p] of Object.entries(t.lookup).slice(0, 10000)) {
      const i = intKey(k);
      const a = asset(p, ctx);
      if (i !== null && a) lookup.set(i, a);
    }
  }
  return { cells, width: ctx.width, height: ctx.height, colors, lookup };
}

// ------------------------------------------------------------------ placed things

/** `v` within +-max, counting a clamp. */
function clampAbs(v: number, max: number, ctx: Ctx): number {
  if (v > max) { ctx.clamped++; return max; }
  if (v < -max) { ctx.clamped++; return -max; }
  return v;
}

function scaleOf(v: unknown, ctx: Ctx): Vec2 {
  const s = parseVector2(v);
  if (!s) return { x: 1, y: 1 };
  const m = ctx.limits.maxScale;
  return { x: clampAbs(s.x, m, ctx), y: clampAbs(s.y, m, ctx) };
}

/** A width from the file: 0..maxWidth, `dflt` when absent. */
function widthOf(v: unknown, dflt: number, ctx: Ctx): number {
  return Math.max(0, clampAbs(num(v) ?? dflt, ctx.limits.maxWidth, ctx));
}

function transform(o: Obj, ctx: Ctx): { position: Vec2; rotation: number; scale: Vec2 } | null {
  const position = parseVector2(o.position);
  if (!position) return null;
  return {
    position,
    rotation: num(o.rotation) ?? 0,
    scale: scaleOf(o.scale, ctx),
  };
}

function parseObject(o: Obj, index: number, ctx: Ctx): MapObject | null {
  const t = transform(o, ctx);
  if (!t) return null;
  return {
    ...t,
    texture: asset(o.texture, ctx),
    mirror: bool(o.mirror) === true,
    layer: num(o.layer) ?? 100,
    shadow: bool(o.shadow) === true,
    blockLight: bool(o.block_light) === true,
    customColor: parseColor(o.custom_color),
    nodeId: parseNodeId(o.node_id),
    index,
  };
}

function parsePath(o: Obj, ctx: Ctx): Path | null {
  const t = transform(o, ctx) ?? { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };
  const pts = points(o.edit_points, "path edit_points", ctx);
  if (!pts || pts.length < 4) return null;
  return {
    ...t,
    editPoints: pts,
    smoothness: num(o.smoothness) ?? 0,
    texture: asset(o.texture, ctx),
    width: widthOf(o.width, 128, ctx),
    layer: num(o.layer) ?? 100,
    fadeIn: bool(o.fade_in) === true,
    fadeOut: bool(o.fade_out) === true,
    grow: bool(o.grow) === true,
    shrink: bool(o.shrink) === true,
    blockLight: bool(o.block_light) === true,
    loop: bool(o.loop) === true,
    nodeId: parseNodeId(o.node_id),
  };
}

function parsePortal(o: Obj, ctx: Ctx): Portal | null {
  const t = transform(o, ctx);
  if (!t) return null;
  const wd = num(o.wall_distance);
  return {
    ...t,
    direction: parseVector2(o.direction),
    texture: asset(o.texture, ctx),
    radius: clampAbs(num(o.radius) ?? 128, ctx.limits.maxWidth, ctx),
    closed: bool(o.closed) !== false,
    wallId: o.wall_id === undefined ? null : parseNodeId(o.wall_id),
    wallDistance: wd,
    nodeId: parseNodeId(o.node_id),
  };
}

function parseWall(o: Obj, ctx: Ctx): Wall | null {
  const pts = points(o.points, "wall points", ctx);
  if (!pts || pts.length < 4) return null;
  return {
    points: pts,
    texture: asset(o.texture, ctx),
    color: parseColor(o.color),
    loop: bool(o.loop) === true,
    type: num(o.type) ?? 1,
    joint: num(o.joint) ?? 1,
    shadow: bool(o.shadow) === true,
    nodeId: parseNodeId(o.node_id),
    portals: items(o.portals, "wall portals", ctx).map((p) => parsePortal(p, ctx)).filter((p): p is Portal => p !== null),
  };
}

function parsePattern(o: Obj, ctx: Ctx): Pattern | null {
  const pts = points(o.points, "pattern points", ctx);
  if (!pts || pts.length < 6) return null;
  return {
    position: parseVector2(o.position) ?? { x: 0, y: 0 },
    shapeRotation: num(o.shape_rotation) ?? 0,
    scale: scaleOf(o.scale, ctx),
    points: pts,
    layer: num(o.layer) ?? 100,
    color: parseColor(o.color),
    outline: bool(o.outline) === true,
    texture: asset(o.texture, ctx),
    textureRotation: num(o.rotation) ?? 0,
    nodeId: parseNodeId(o.node_id),
  };
}

function parseRoof(o: Obj, ctx: Ctx): Roof | null {
  const pts = points(o.points, "roof points", ctx);
  if (!pts || pts.length < 4) return null;
  return {
    position: parseVector2(o.position) ?? { x: 0, y: 0 },
    rotation: num(o.rotation) ?? 0,
    scale: scaleOf(o.scale, ctx),
    points: pts,
    texture: asset(o.texture, ctx),
    width: widthOf(o.width, 256, ctx),
    type: num(o.type) ?? 0,
    nodeId: parseNodeId(o.node_id),
  };
}

function parseLight(o: Obj, ctx: Ctx): Light | null {
  const position = parseVector2(o.position);
  if (!position) return null;
  return {
    position,
    range: num(o.range) ?? 0,
    intensity: num(o.intensity) ?? 1,
    color: parseColor(o.color),
    texture: asset(o.texture, ctx),
    shadows: bool(o.shadows) === true,
    nodeId: parseNodeId(o.node_id),
  };
}

// The season sidecar: one Dungeondraft level's season data, compiled once at attach time on the
// GM's device (extract.ts) and read by every device that bakes the scene's seasons. It holds
// roles and outlines of what the picture already shows, never the source: no other levels,
// portals, lights, texts, editor state, texture paths, pack ids or names, file name or hash, and
// nothing more than one square outside the picture's rectangle (design 3.3, 3.5).
//
// Byte layout (all integers little-endian). The bytes are carried losslessly as the pixels of a
// PNG (pngBox.ts); decodeSidecar ignores whatever follows the payload (the box's zero padding).
//
//   header, 16 bytes
//     0-3    "TTSD"                                      SIDECAR_MAGIC
//     u16    format (1)                                  SIDECAR_FORMAT; newer: the device guesses from the picture
//     u16    extractor version                           geometry only; roles are re-derived from names at run time
//     u32    payload length
//     u32    CRC-32 of the payload                       src/client/crc32.ts
//   payload: sections, each u8 tag, u32 length, body. Unknown tags are skipped (by their length).
//            META, TERR and OBJS at most once; BITS and SHAP may repeat.
//
//   1 META  UTF-8 JSON (<= 16 KiB): SidecarMeta
//   2 TERR  u8 tps (texels per square: 4, 2 or 1)
//           i32 tx0, ty0; u16 tw, th                    the crop plus one texel, in texels of 256/tps world units
//           u8 nSlots; per slot u16 name (into META.names; 0xFFFF pack or unknown), u8 role (attach-time TR)
//           nSlots planes of tw*th u8 weights, row-major, as saved (box-averaged from 4/square below tps 4)
//           texel (tx, ty) (absolute) is centred at world ((tx + 0.5) * 256/tps, (ty + 0.5) * 256/tps)
//   3 BITS  u8 role (AR), i16 layer, u16 step (world units), i32 ox, oy (world position of sample 0,0),
//           u16 w, h, then w*h bits, sample (x, y) at bit (y*w + x), least-significant bit first
//           (<= 4 Mbit). Cave floor (step 64), materials (128), floor cells (256)
//   4 SHAP  u8 role (AR), i16 layer, u8 rule (0 even-odd, 1 non-zero), u32 nRings,
//           per ring u32 nPts then nPts * (i32 x, i32 y) in 1/16 world unit
//   5 OBJS  u32 n, then arrays of n: role u8, layer i16, x i32, y i32 (1/16 world unit), rot u8
//           (a full turn / 256, clockwise), flags u8 (OBJ_FLAG), name u16 (0xFFFF none),
//           then reach u16[16n] (1/4 world unit, 16 per object in REACH_DIRS order). 47 bytes an object
//
// World units: 256 a square, x right, y down (Dungeondraft's own). Every count and length is
// checked against SIDECAR_CAPS and the bytes left before anything is allocated, so a crafted
// sidecar can't make a player's device allocate or loop without bound.

import { crc32 } from "../crc32";
import { AR, OR, TR, type AreaRole, type ObjectRole, type TerrainRole } from "./roles";

export const SIDECAR_FORMAT = 1;
export const SIDECAR_MAGIC = "TTSD";
export const SIDECAR_HEADER_BYTES = 16;

/** Section tags. */
export const SECTION = { META: 1, TERR: 2, BITS: 3, SHAP: 4, OBJS: 5 } as const;

/** A name index or object name meaning "none" (pack, embedded or unknown source, or a role that keeps no name). */
export const NO_NAME = 0xffff;
/** Reach samples an object (REACH_DIRS, raster.ts). */
export const REACH_N = 16;
/** Stored units: shape points and object centres in 1/16 world unit, reaches in 1/4 world unit. */
export const SIDECAR_UNITS = { coord: 16, reach: 4 } as const;
/** Bytes an object in OBJS. */
export const OBJ_BYTES = 47;

/** Anything malformed, oversized, inconsistent or unsupported in a sidecar or its PNG box. */
export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarError";
  }
}

export interface SidecarMeta {
  /** The picture's rectangle [x0, y0, x1, y1] in world units. */
  rect: [number, number, number, number];
  /** The whole map's size in squares [w, h]. */
  squares: [number, number];
  /** The extractor version that made it (the header's too). */
  extractor: number;
  /** Snow's share of the visible open soft ground at attach (4.2): 0.5 or more is a snowy map. */
  snowShare: number;
  /** Pack items' share of the area of objects and paths. */
  packShare: number;
  /** How many pack items (objects, paths, patterns, materials, roofs, terrain slots). */
  packItems: number;
  /** Objects dropped because the picture doesn't show them (2.5). */
  dropped: number;
  /**
   * The default short names used by natural objects (NAMED_ROLES) and terrain slots, e.g.
   * "vegetation/trees/pine_tree_02", "terrain_snow". Never a structure's or a pack item's name.
   */
  names: string[];
}

export interface TerrainGrid {
  /** Texels per square. */
  tps: 1 | 2 | 4;
  /** The crop's first texel (absolute, in texels) and size. */
  tx0: number;
  ty0: number;
  tw: number;
  th: number;
  /** name: into meta.names, NO_NAME for pack or unknown; role: the attach-time TR (used when name gives none). */
  slots: Array<{ name: number; role: TerrainRole }>;
  /** slots.length planes of tw*th weights (0..255), row-major. */
  w: Uint8Array;
}

export interface BitmapLayer {
  role: AreaRole;
  layer: number;
  /** World units between samples. */
  step: number;
  /** World position of sample (0, 0); sample (x, y) is at (ox + x*step, oy + y*step). */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** w*h bits, sample (x, y) at bit y*w + x, least-significant bit first. */
  bits: Uint8Array;
}

export interface ShapeLayer {
  role: AreaRole;
  layer: number;
  /** 0 even-odd, 1 non-zero, over all the rings together. */
  rule: 0 | 1;
  /** x, y pairs in 1/16 world unit, every ring one after another. */
  pts: Int32Array;
  /** Per ring, the number of points up to and including it: ring i is points ringEnds[i-1] (0 for i = 0) to ringEnds[i] - 1. */
  ringEnds: Uint32Array;
}

export interface ObjectTable {
  n: number;
  role: Uint8Array;
  layer: Int16Array;
  /** Centre in 1/16 world unit. */
  x: Int32Array;
  y: Int32Array;
  /** A full turn / 256, clockwise (y down). Not used by v1's runtime. */
  rot: Uint8Array;
  /** OBJ_FLAG bits. */
  flags: Uint8Array;
  /** Into meta.names, NO_NAME for none. */
  name: Uint16Array;
  /** n*16 reaches in 1/4 world unit, 16 per object in REACH_DIRS order (raster.ts, design 2.9). */
  reach: Uint16Array;
}

/** OBJS flags. Without MEASURED the reach is the prior. */
export const OBJ_FLAG = { MIRROR: 1, CAPPED: 2, TINTED: 4, MEASURED: 8 } as const;

export interface SeasonSidecar {
  meta: SidecarMeta;
  terrain: TerrainGrid | null;
  bitmaps: BitmapLayer[];
  shapes: ShapeLayer[];
  objects: ObjectTable;
}

/** Limits checked by decodeSidecar before it allocates, and by the extractor (design 3.3). */
export const SIDECAR_CAPS = {
  /** Payload. */
  bytes: 8_388_608,
  /** Terrain planes in all (tps drops to fit). */
  terrainBytes: 6_291_456,
  /** Shape points in all. */
  points: 400_000,
  /** Shape rings in all. */
  rings: 20_000,
  objects: 20_000,
  bitmaps: 16,
  /** Bits a bitmap. */
  bitmapBits: 4_194_304,
  names: 2000,
  nameChars: 120,
  /** META's JSON. */
  metaBytes: 16_384,
} as const;

/**
 * Draw layers the extractor gives what isn't an object, path or pattern (which keep their own
 * layer). The ones marked [L] are provisional until WP3 checks them on real exports; a
 * correction changes only these values and the extractor version, never the format or the runtime.
 */
export const DD_LAYER = {
  TERRAIN: -10_000,
  /** "Below Ground" user layer; materials are drawn at their own layer (-400 seen). */
  BELOW_GROUND: -400,
  /** [L] */
  CAVE: -350,
  /** Building floors and wall-loop interiors [L]. */
  FLOOR: -300,
  BELOW_WATER: -100,
  WATER: -50,
  /** [L] */
  WALL: 600,
  ABOVE_WALLS: 700,
  /** [L] */
  ROOF: 800,
  /** Roof snow objects sit here. */
  ABOVE_ROOFS: 900,
} as const;

// ---------------------------------------------------------------- checks shared by both directions

const TR_VALUES: ReadonlySet<number> = new Set<number>(Object.values(TR));
const AR_VALUES: ReadonlySet<number> = new Set<number>(Object.values(AR));
const OR_VALUES: ReadonlySet<number> = new Set<number>(Object.values(OR));
/** Largest |coordinate| in META.rect: anything inside it fits an i32 in 1/16 world unit. */
const COORD_MAX = 2 ** 31 / SIDECAR_UNITS.coord;
const I32_MIN = -(2 ** 31);
const I32_MAX = 2 ** 31 - 1;
/** Every OBJ_FLAG bit. */
const OBJ_FLAGS_ALL = OBJ_FLAG.MIRROR | OBJ_FLAG.CAPPED | OBJ_FLAG.TINTED | OBJ_FLAG.MEASURED;
/** Bytes before a section's body (tag, length), and each body's fixed part before its arrays. */
const SECTION_HEAD = 5;
const TERR_HEAD = 14;
const BITS_HEAD = 17;
const SHAP_HEAD = 8;
const OBJS_HEAD = 4;

function fail(message: string): never {
  throw new SidecarError(message);
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const nameOk = (i: number, names: number): boolean => i === NO_NAME || i < names;

/** META from JSON (or from the extractor), checked and copied with only its known fields. */
function checkMeta(m: unknown, extractor: number | null): SidecarMeta {
  if (typeof m !== "object" || m === null || Array.isArray(m)) fail("META is not an object");
  const o = m as Record<string, unknown>;
  const rect = o.rect, squares = o.squares, names = o.names;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((v) => isNum(v, -COORD_MAX, COORD_MAX))) {
    fail("META.rect is not four coordinates");
  }
  const r = rect as number[];
  if (!(r[2] - r[0] >= 1 && r[3] - r[1] >= 1)) fail("META.rect is empty or under a world unit across");
  if (!Array.isArray(squares) || squares.length !== 2 || !squares.every((v) => isInt(v, 1, 65535))) {
    fail("META.squares is not a map size");
  }
  const sq = squares as number[];
  if (!isInt(o.extractor, 0, 65535)) fail("META.extractor is not a version");
  if (extractor !== null && o.extractor !== extractor) fail("META.extractor disagrees with the header");
  if (!isNum(o.snowShare, 0, 1) || !isNum(o.packShare, 0, 1)) fail("META's shares are not between 0 and 1");
  if (!isInt(o.packItems, 0, I32_MAX) || !isInt(o.dropped, 0, I32_MAX)) fail("META's counts are not counts");
  if (!Array.isArray(names) || names.length > SIDECAR_CAPS.names) fail("META.names is not a list of up to 2,000 names");
  for (const n of names) {
    if (typeof n !== "string" || n.length === 0 || n.length > SIDECAR_CAPS.nameChars) fail("META.names holds a bad name");
  }
  return {
    rect: [r[0], r[1], r[2], r[3]], squares: [sq[0], sq[1]], extractor: o.extractor, snowShare: o.snowShare,
    packShare: o.packShare, packItems: o.packItems, dropped: o.dropped, names: (names as string[]).slice(),
  };
}

function checkTerrain(t: TerrainGrid, names: number): void {
  if (t.tps !== 1 && t.tps !== 2 && t.tps !== 4) fail("TERR's texels a square are not 1, 2 or 4");
  if (!isInt(t.tx0, I32_MIN, I32_MAX) || !isInt(t.ty0, I32_MIN, I32_MAX)) fail("TERR's origin is not an i32");
  if (!isInt(t.tw, 1, 65535) || !isInt(t.th, 1, 65535)) fail("TERR's size is not 1 to 65535");
  if (!Array.isArray(t.slots) || t.slots.length < 1 || t.slots.length > 255) fail("TERR has not 1 to 255 slots");
  for (const s of t.slots) {
    if (!isInt(s.name, 0, NO_NAME) || !nameOk(s.name, names)) fail("TERR names a slot outside META.names");
    if (!TR_VALUES.has(s.role)) fail("TERR has an unknown terrain role");
  }
  const planes = t.tw * t.th * t.slots.length;
  if (planes > SIDECAR_CAPS.terrainBytes) fail("TERR's planes are over 6 MiB");
  if (!(t.w instanceof Uint8Array) || t.w.length !== planes) fail("TERR's planes disagree with its size");
}

function checkBitmap(b: BitmapLayer): void {
  if (!AR_VALUES.has(b.role)) fail("BITS has an unknown area role");
  if (!isInt(b.layer, -32768, 32767)) fail("BITS's layer is not an i16");
  if (!isInt(b.step, 1, 65535)) fail("BITS's step is not 1 to 65535");
  if (!isInt(b.ox, I32_MIN, I32_MAX) || !isInt(b.oy, I32_MIN, I32_MAX)) fail("BITS's origin is not an i32");
  if (!isInt(b.w, 1, 65535) || !isInt(b.h, 1, 65535)) fail("BITS's size is not 1 to 65535");
  const n = b.w * b.h;
  if (n > SIDECAR_CAPS.bitmapBits) fail("BITS is over 4 Mbit");
  if (!(b.bits instanceof Uint8Array) || b.bits.length !== Math.ceil(n / 8)) fail("BITS's bits disagree with its size");
  if ((n & 7) !== 0 && b.bits[b.bits.length - 1] >> (n & 7) !== 0) fail("BITS has bits past its size");
}

function checkShape(s: ShapeLayer): void {
  if (!AR_VALUES.has(s.role)) fail("SHAP has an unknown area role");
  if (!isInt(s.layer, -32768, 32767)) fail("SHAP's layer is not an i16");
  if (s.rule !== 0 && s.rule !== 1) fail("SHAP's fill rule is not 0 or 1");
  if (!(s.ringEnds instanceof Uint32Array) || s.ringEnds.length < 1) fail("SHAP has no rings");
  if (!(s.pts instanceof Int32Array)) fail("SHAP's points are not i32");
  let prev = 0;
  for (const e of s.ringEnds) {
    if (e <= prev) fail("SHAP has an empty ring");
    prev = e;
  }
  if (prev * 2 !== s.pts.length) fail("SHAP's rings disagree with its points");
}

function checkObjects(o: ObjectTable, names: number): void {
  if (typeof o !== "object" || o === null || !isInt(o.n, 0, SIDECAR_CAPS.objects)) fail("OBJS has not 0 to 20,000 objects");
  const n = o.n;
  const ok = o.role instanceof Uint8Array && o.role.length === n && o.layer instanceof Int16Array && o.layer.length === n &&
    o.x instanceof Int32Array && o.x.length === n && o.y instanceof Int32Array && o.y.length === n &&
    o.rot instanceof Uint8Array && o.rot.length === n && o.flags instanceof Uint8Array && o.flags.length === n &&
    o.name instanceof Uint16Array && o.name.length === n && o.reach instanceof Uint16Array && o.reach.length === n * REACH_N;
  if (!ok) fail("OBJS's arrays disagree with its count");
  for (let i = 0; i < n; i++) {
    if (!OR_VALUES.has(o.role[i])) fail("OBJS has an unknown object role");
    if ((o.flags[i] & ~OBJ_FLAGS_ALL) !== 0) fail("OBJS has unknown flags");
    if (!nameOk(o.name[i], names)) fail("OBJS names an object outside META.names");
  }
}

// ---------------------------------------------------------------- encode

/** Header plus sections (layout above). Throws SidecarError when a cap is exceeded. */
export function encodeSidecar(s: SeasonSidecar): Uint8Array {
  if (typeof s !== "object" || s === null) fail("not a sidecar");
  const meta = checkMeta(s.meta, null);
  const names = meta.names.length;
  const json = new TextEncoder().encode(JSON.stringify(meta));
  if (json.length > SIDECAR_CAPS.metaBytes) fail("META is over 16 KiB");
  let len = SECTION_HEAD + json.length;
  const t = s.terrain;
  if (t !== null) {
    if (typeof t !== "object") fail("TERR is not a grid");
    checkTerrain(t, names);
    len += SECTION_HEAD + TERR_HEAD + 3 * t.slots.length + t.w.length;
  }
  if (!Array.isArray(s.bitmaps) || s.bitmaps.length > SIDECAR_CAPS.bitmaps) fail("more than 16 bitmaps");
  for (const b of s.bitmaps) {
    checkBitmap(b);
    len += SECTION_HEAD + BITS_HEAD + b.bits.length;
  }
  if (!Array.isArray(s.shapes)) fail("no shape list");
  let rings = 0, points = 0;
  for (const sh of s.shapes) {
    checkShape(sh);
    rings += sh.ringEnds.length;
    points += sh.pts.length / 2;
    if (rings > SIDECAR_CAPS.rings) fail("more than 20,000 rings");
    if (points > SIDECAR_CAPS.points) fail("more than 400,000 shape points");
    len += SECTION_HEAD + SHAP_HEAD + 4 * sh.ringEnds.length + 4 * sh.pts.length;
  }
  const o = s.objects;
  checkObjects(o, names);
  len += SECTION_HEAD + OBJS_HEAD + OBJ_BYTES * o.n;
  if (len > SIDECAR_CAPS.bytes) fail("the sidecar is over 8 MiB");

  const out = new Uint8Array(SIDECAR_HEADER_BYTES + len);
  const dv = new DataView(out.buffer);
  let p = 0;
  const u8 = (v: number) => { dv.setUint8(p, v); p += 1; };
  const u16 = (v: number) => { dv.setUint16(p, v, true); p += 2; };
  const i16 = (v: number) => { dv.setInt16(p, v, true); p += 2; };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  const i32 = (v: number) => { dv.setInt32(p, v, true); p += 4; };
  const section = (tag: number, bodyLen: number) => { u8(tag); u32(bodyLen); };

  for (let i = 0; i < 4; i++) u8(SIDECAR_MAGIC.charCodeAt(i));
  u16(SIDECAR_FORMAT);
  u16(meta.extractor);
  u32(len);
  p += 4; // the CRC, below

  section(SECTION.META, json.length);
  out.set(json, p);
  p += json.length;
  if (t !== null) {
    section(SECTION.TERR, TERR_HEAD + 3 * t.slots.length + t.w.length);
    u8(t.tps); i32(t.tx0); i32(t.ty0); u16(t.tw); u16(t.th); u8(t.slots.length);
    for (const sl of t.slots) { u16(sl.name); u8(sl.role); }
    out.set(t.w, p);
    p += t.w.length;
  }
  for (const b of s.bitmaps) {
    section(SECTION.BITS, BITS_HEAD + b.bits.length);
    u8(b.role); i16(b.layer); u16(b.step); i32(b.ox); i32(b.oy); u16(b.w); u16(b.h);
    out.set(b.bits, p);
    p += b.bits.length;
  }
  for (const sh of s.shapes) {
    section(SECTION.SHAP, SHAP_HEAD + 4 * sh.ringEnds.length + 4 * sh.pts.length);
    u8(sh.role); i16(sh.layer); u8(sh.rule); u32(sh.ringEnds.length);
    let start = 0;
    for (const e of sh.ringEnds) {
      u32(e - start);
      for (let k = start * 2; k < e * 2; k++) i32(sh.pts[k]);
      start = e;
    }
  }
  section(SECTION.OBJS, OBJS_HEAD + OBJ_BYTES * o.n);
  u32(o.n);
  for (let i = 0; i < o.n; i++) u8(o.role[i]);
  for (let i = 0; i < o.n; i++) i16(o.layer[i]);
  for (let i = 0; i < o.n; i++) i32(o.x[i]);
  for (let i = 0; i < o.n; i++) i32(o.y[i]);
  for (let i = 0; i < o.n; i++) u8(o.rot[i]);
  for (let i = 0; i < o.n; i++) u8(o.flags[i]);
  for (let i = 0; i < o.n; i++) u16(o.name[i]);
  for (let i = 0; i < o.n * REACH_N; i++) u16(o.reach[i]);

  dv.setUint32(12, crc32(out.subarray(SIDECAR_HEADER_BYTES)), true);
  return out;
}

// ---------------------------------------------------------------- decode

/**
 * Checks the magic, format, CRC and every section, each count against SIDECAR_CAPS and the bytes
 * left before allocating. Bad lengths, disagreeing counts, NaN or out-of-range values throw
 * SidecarError; a newer format throws SidecarError too (mapData.ts tells it apart by readFormat).
 * What it returns shares no memory with `bytes` (a Node Buffer included), which can be reused.
 */
export function decodeSidecar(bytes: Uint8Array): SeasonSidecar {
  if (!(bytes instanceof Uint8Array)) fail("not bytes");
  const format = readFormat(bytes);
  if (format === null) fail("not a sidecar");
  if (format !== SIDECAR_FORMAT) fail(`sidecar format ${format} is not one this version reads`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const extractor = dv.getUint16(6, true);
  const len = dv.getUint32(8, true);
  if (len > SIDECAR_CAPS.bytes) fail("the sidecar is over 8 MiB");
  const end = SIDECAR_HEADER_BYTES + len;
  if (end > bytes.length) fail("the sidecar is cut off");
  if (crc32(bytes.subarray(SIDECAR_HEADER_BYTES, end)) !== dv.getUint32(12, true)) fail("the sidecar's CRC doesn't match");

  // Pass 1: every section's place, counts and values, read in place. Nothing big is allocated
  // until the whole payload has passed.
  let metaAt = -1, metaLen = 0, terrAt = -1, terrLen = 0, objsAt = -1, objsLen = 0;
  const bitsAt: number[] = [], shapAt: number[] = [], shapLen: number[] = [];
  for (let p = SIDECAR_HEADER_BYTES; p < end;) {
    if (end - p < SECTION_HEAD) fail("a section header is cut off");
    const tag = bytes[p];
    const sl = dv.getUint32(p + 1, true);
    const body = p + SECTION_HEAD;
    if (sl > end - body) fail("a section runs past the payload");
    if (tag === SECTION.META) {
      if (metaAt >= 0) fail("two META sections");
      metaAt = body; metaLen = sl;
    } else if (tag === SECTION.TERR) {
      if (terrAt >= 0) fail("two TERR sections");
      terrAt = body; terrLen = sl;
    } else if (tag === SECTION.OBJS) {
      if (objsAt >= 0) fail("two OBJS sections");
      objsAt = body; objsLen = sl;
    } else if (tag === SECTION.BITS) {
      if (bitsAt.length >= SIDECAR_CAPS.bitmaps) fail("more than 16 bitmaps");
      if (sl < BITS_HEAD) fail("BITS is cut off");
      bitsAt.push(body);
      const n = dv.getUint16(body + 13, true) * dv.getUint16(body + 15, true);
      if (n > SIDECAR_CAPS.bitmapBits) fail("BITS is over 4 Mbit");
      if (sl !== BITS_HEAD + Math.ceil(n / 8)) fail("BITS's length disagrees with its size");
    } else if (tag === SECTION.SHAP) {
      if (shapAt.length >= SIDECAR_CAPS.rings) fail("more than 20,000 rings");
      shapAt.push(body); shapLen.push(sl);
    }
    p = body + sl;
  }
  if (metaAt < 0) fail("no META section");
  if (metaLen > SIDECAR_CAPS.metaBytes) fail("META is over 16 KiB");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(metaAt, metaAt + metaLen)));
  } catch {
    fail("META is not JSON");
  }
  const meta = checkMeta(json, extractor);
  const names = meta.names.length;

  if (terrAt >= 0) {
    if (terrLen < TERR_HEAD) fail("TERR is cut off");
    const tps = bytes[terrAt], tw = dv.getUint16(terrAt + 9, true), th = dv.getUint16(terrAt + 11, true);
    const ns = bytes[terrAt + 13];
    if (tps !== 1 && tps !== 2 && tps !== 4) fail("TERR's texels a square are not 1, 2 or 4");
    if (tw < 1 || th < 1 || ns < 1) fail("TERR is empty");
    if (tw * th * ns > SIDECAR_CAPS.terrainBytes) fail("TERR's planes are over 6 MiB");
    if (terrLen !== TERR_HEAD + 3 * ns + tw * th * ns) fail("TERR's length disagrees with its size");
    for (let i = 0; i < ns; i++) {
      if (!nameOk(dv.getUint16(terrAt + TERR_HEAD + 3 * i, true), names)) fail("TERR names a slot outside META.names");
      if (!TR_VALUES.has(bytes[terrAt + TERR_HEAD + 3 * i + 2])) fail("TERR has an unknown terrain role");
    }
  }
  for (const at of bitsAt) {
    if (!AR_VALUES.has(bytes[at])) fail("BITS has an unknown area role");
    if (dv.getUint16(at + 3, true) < 1) fail("BITS's step is 0");
    const n = dv.getUint16(at + 13, true) * dv.getUint16(at + 15, true);
    if (n < 1) fail("BITS is empty");
    if ((n & 7) !== 0 && bytes[at + BITS_HEAD + Math.ceil(n / 8) - 1] >> (n & 7) !== 0) fail("BITS has bits past its size");
  }
  const shapRings: number[] = [], shapPts: number[] = [];
  let rings = 0, points = 0;
  for (let s = 0; s < shapAt.length; s++) {
    const at = shapAt[s], stop = at + shapLen[s];
    if (shapLen[s] < SHAP_HEAD) fail("SHAP is cut off");
    if (!AR_VALUES.has(bytes[at])) fail("SHAP has an unknown area role");
    if (bytes[at + 3] > 1) fail("SHAP's fill rule is not 0 or 1");
    const nr = dv.getUint32(at + 4, true);
    if (nr < 1) fail("SHAP has no rings");
    if (nr > SIDECAR_CAPS.rings - rings) fail("more than 20,000 rings");
    rings += nr;
    let q = at + SHAP_HEAD, pts = 0;
    for (let r = 0; r < nr; r++) {
      if (stop - q < 4) fail("SHAP's rings are cut off");
      const np = dv.getUint32(q, true);
      q += 4;
      if (np < 1) fail("SHAP has an empty ring");
      if (np > SIDECAR_CAPS.points - points - pts) fail("more than 400,000 shape points");
      if (np * 8 > stop - q) fail("SHAP's points are cut off");
      q += np * 8;
      pts += np;
    }
    if (q !== stop) fail("SHAP's length disagrees with its rings");
    points += pts;
    shapRings.push(nr);
    shapPts.push(pts);
  }
  let nObj = 0;
  if (objsAt >= 0) {
    if (objsLen < OBJS_HEAD) fail("OBJS is cut off");
    nObj = dv.getUint32(objsAt, true);
    if (nObj > SIDECAR_CAPS.objects) fail("more than 20,000 objects");
    if (objsLen !== OBJS_HEAD + OBJ_BYTES * nObj) fail("OBJS's length disagrees with its count");
    const a = objsAt + OBJS_HEAD;
    for (let i = 0; i < nObj; i++) {
      if (!OR_VALUES.has(bytes[a + i])) fail("OBJS has an unknown object role");
      if ((bytes[a + 12 * nObj + i] & ~OBJ_FLAGS_ALL) !== 0) fail("OBJS has unknown flags");
      if (!nameOk(dv.getUint16(a + 13 * nObj + 2 * i, true), names)) fail("OBJS names an object outside META.names");
    }
  }

  // Pass 2: copy out.
  let terrain: TerrainGrid | null = null;
  if (terrAt >= 0) {
    const tps = bytes[terrAt] as 1 | 2 | 4, tw = dv.getUint16(terrAt + 9, true), th = dv.getUint16(terrAt + 11, true);
    const ns = bytes[terrAt + 13];
    const slots: TerrainGrid["slots"] = [];
    for (let i = 0; i < ns; i++) {
      const at = terrAt + TERR_HEAD + 3 * i;
      slots.push({ name: dv.getUint16(at, true), role: bytes[at + 2] as TerrainRole });
    }
    const w0 = terrAt + TERR_HEAD + 3 * ns;
    terrain = {
      tps, tx0: dv.getInt32(terrAt + 1, true), ty0: dv.getInt32(terrAt + 5, true), tw, th, slots,
      w: new Uint8Array(bytes.subarray(w0, w0 + tw * th * ns)), // a copy (a Node Buffer's slice() is a view)
    };
  }
  const bitmaps: BitmapLayer[] = bitsAt.map((at) => {
    const w = dv.getUint16(at + 13, true), h = dv.getUint16(at + 15, true);
    return {
      role: bytes[at] as AreaRole, layer: dv.getInt16(at + 1, true), step: dv.getUint16(at + 3, true),
      ox: dv.getInt32(at + 5, true), oy: dv.getInt32(at + 9, true), w, h,
      bits: new Uint8Array(bytes.subarray(at + BITS_HEAD, at + BITS_HEAD + Math.ceil((w * h) / 8))),
    };
  });
  const shapes: ShapeLayer[] = shapAt.map((at, s) => {
    const ringEnds = new Uint32Array(shapRings[s]);
    const pts = new Int32Array(shapPts[s] * 2);
    let q = at + SHAP_HEAD, k = 0;
    for (let r = 0; r < ringEnds.length; r++) {
      const np = dv.getUint32(q, true);
      q += 4;
      for (let i = 0; i < np * 2; i++, q += 4) pts[k + i] = dv.getInt32(q, true);
      k += np * 2;
      ringEnds[r] = k / 2;
    }
    return { role: bytes[at] as AreaRole, layer: dv.getInt16(at + 1, true), rule: bytes[at + 3] as 0 | 1, pts, ringEnds };
  });
  const n = nObj, a = objsAt + OBJS_HEAD;
  const objects: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  if (n > 0) {
    objects.role.set(bytes.subarray(a, a + n));
    for (let i = 0; i < n; i++) {
      objects.layer[i] = dv.getInt16(a + n + 2 * i, true);
      objects.x[i] = dv.getInt32(a + 3 * n + 4 * i, true);
      objects.y[i] = dv.getInt32(a + 7 * n + 4 * i, true);
      objects.name[i] = dv.getUint16(a + 13 * n + 2 * i, true);
    }
    objects.rot.set(bytes.subarray(a + 11 * n, a + 12 * n));
    objects.flags.set(bytes.subarray(a + 12 * n, a + 13 * n));
    for (let i = 0; i < n * REACH_N; i++) objects.reach[i] = dv.getUint16(a + 15 * n + 2 * i, true);
  }
  return { meta, terrain, bitmaps, shapes, objects };
}

/** The header's format number, or null when the bytes don't start with a sidecar header. Never throws. */
export function readFormat(bytes: Uint8Array): number | null {
  if (bytes.length < SIDECAR_HEADER_BYTES) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== SIDECAR_MAGIC.charCodeAt(i)) return null;
  return bytes[4] | (bytes[5] << 8);
}

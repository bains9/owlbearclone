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

import type { AreaRole, ObjectRole, TerrainRole } from "./roles";

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

/** Header plus sections (layout above). Throws SidecarError when a cap is exceeded. */
export function encodeSidecar(s: SeasonSidecar): Uint8Array {
  throw new SidecarError("not implemented: encodeSidecar");
}

/**
 * Checks the magic, format, CRC and every section, each count against SIDECAR_CAPS and the bytes
 * left before allocating. Bad lengths, disagreeing counts, NaN or out-of-range values throw
 * SidecarError; a newer format throws SidecarError too (mapData.ts tells it apart by readFormat).
 */
export function decodeSidecar(bytes: Uint8Array): SeasonSidecar {
  throw new SidecarError("not implemented: decodeSidecar");
}

/** The header's format number, or null when the bytes don't start with a sidecar header. Never throws. */
export function readFormat(bytes: Uint8Array): number | null {
  if (bytes.length < SIDECAR_HEADER_BYTES) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== SIDECAR_MAGIC.charCodeAt(i)) return null;
  return bytes[4] | (bytes[5] << 8);
}

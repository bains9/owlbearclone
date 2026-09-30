// Typed model of a .dungeondraft_map (Dungeondraft 0.9.x - 1.2.0.1, world.format 2 and 3).
//
// Units: every position is in Dungeondraft WORLD units ("woxels"), 256 per grid square,
// origin at the map's top-left corner, y down. Rotations are radians, clockwise-positive
// (Godot 2D, y down). Colours are 0..255 RGBA (the file stores ARGB hex).

import type { Vec2, RGBA } from "./godot";
export type { Vec2, RGBA };

/** Dungeondraft's fixed grid size in world units. Not stored in the file. */
export const GRID = 256;
/** Terrain splat texels per grid square (64 world units per texel). */
export const TERRAIN_PER_SQUARE = 4;
/** Cave bitmap samples per grid square (64 world units per sample), plus a 1-sample edge buffer. */
export const CAVE_PER_SQUARE = 4;
/** Material bitmap samples per grid square (128 world units per sample), plus a 1-sample edge buffer. */
export const MATERIAL_PER_SQUARE = 2;
/** Marching-squares bitmaps (cave, materials) carry one extra sample row/column of buffer on every side. */
export const MS_EDGE_BUFFER = 1;

export type AssetSource = "default" | "pack" | "embedded" | "unknown";

/** A texture reference. For pack assets we keep only what the map itself says; we never open the pack. */
export interface AssetRef {
  path: string;
  source: AssetSource;
  /** Pack id for res://packs/<id>/... paths. */
  packId?: string;
  /** Pack's manifest entry says third-party software may read it. False when absent. */
  packReadable?: boolean;
  /** Path segments after "textures/" without the file extension, e.g. ["objects","vegetation","trees","pine_tree_01"]. Empty for packs (opaque). */
  segments: string[];
}

export interface AssetPack {
  id: string;
  name: string;
  version: string;
  author: string;
  /** header.asset_manifest[].allow_3rd_party_mapping_software_to_read; missing (older saves) = false. */
  allowThirdParty: boolean;
}

export interface Header {
  creationBuild: string | null;
  creationDate: { year: number; month: number; day: number } | null;
  usesDefaultAssets: boolean | null;
  packs: AssetPack[];
  /** Level id the editor had open when saved (exports default their Source Level to it). */
  currentLevel: number | null;
  cameraPosition: Vec2 | null;
  cameraZoom: number | null;
  hasTraceImage: boolean;
}

export interface Terrain {
  enabled: boolean;
  /** 8 slots when true, else 4. */
  expandSlots: boolean;
  smoothBlending: boolean;
  /** texture_1..texture_8 (index 0..7); null where absent. */
  slots: (AssetRef | null)[];
  /** Texel grid: width = map width * 4, height = map height * 4. */
  width: number;
  height: number;
  /**
   * Per-texel weights, slot-planar: weights[slot * width * height + ty * width + tx], 0..255.
   * Built from splat (RGBA = slots 1-4) and splat2 (RGBA = slots 5-8). Sums are ~255 (253-255 seen).
   * Slots beyond the active count are zero.
   */
  weights: Uint8Array;
  /** Number of active slots (4 or 8). */
  slotCount: number;
}

export interface WaterNode {
  ref: number | null;
  /** Interleaved world coords [x0,y0,...]; empty for the root. */
  polygon: Float64Array;
  /** Depth in the Clipper PolyTree: 0 root, 1 water body outline, 2 island (hole), 3 pond on an island, ... */
  depth: number;
  isOpen: boolean;
  deepColor: RGBA | null;
  shallowColor: RGBA | null;
  blendDistance: number | null;
  children: WaterNode[];
}

export interface Water {
  disableBorder: boolean;
  root: WaterNode | null;
}

export interface BitGrid {
  /** Sample grid size including the edge buffer. */
  width: number;
  height: number;
  /** World units between samples (64 cave, 128 material). */
  step: number;
  /** One byte per sample (0/1), row-major. */
  bits: Uint8Array;
}

export interface Cave {
  floor: BitGrid | null;
  /** "Blast open" areas (entrances). */
  entrance: BitGrid | null;
  groundColor: RGBA | null;
  wallColor: RGBA | null;
  texture: AssetRef | null;
}

export interface Material {
  layer: number;
  texture: AssetRef | null;
  smooth: boolean;
  mask: BitGrid | null;
}

export interface Tiles {
  /** Map width x height cells, row-major; -1 = no floor. */
  cells: Int32Array;
  width: number;
  height: number;
  /** Per-cell tint (null where unreadable). */
  colors: (RGBA | null)[] | null;
  /** cell value -> texture (format 3 "lookup"); empty on older saves. */
  lookup: Map<number, AssetRef>;
}

export interface Transform2 {
  position: Vec2;
  rotation: number;
  /** Each component within +-maxScale (ParseLimits). */
  scale: Vec2;
}

export interface MapObject extends Transform2 {
  texture: AssetRef | null;
  mirror: boolean;
  layer: number;
  shadow: boolean;
  blockLight: boolean;
  customColor: RGBA | null;
  nodeId: number | null;
  /** Index within level.objects (save order = draw order within a layer, as far as we know). */
  index: number;
}

export interface Path extends Transform2 {
  /** Local edit points, interleaved. World = position + R(rotation) * (scale * p). */
  editPoints: Float64Array;
  smoothness: number;
  texture: AssetRef | null;
  /** Ribbon width in world units, 0..maxWidth. */
  width: number;
  layer: number;
  fadeIn: boolean;
  fadeOut: boolean;
  grow: boolean;
  shrink: boolean;
  blockLight: boolean;
  loop: boolean;
  nodeId: number | null;
}

export interface Portal extends Transform2 {
  direction: Vec2 | null;
  texture: AssetRef | null;
  /** Half-width in world units (128 = a one-square door), within +-maxWidth. */
  radius: number;
  closed: boolean;
  /** Owning wall's node id, -1/null for freestanding. */
  wallId: number | null;
  /** segmentIndex + fraction along that segment. */
  wallDistance: number | null;
  nodeId: number | null;
}

export interface Wall {
  /** World coords, interleaved. */
  points: Float64Array;
  texture: AssetRef | null;
  color: RGBA | null;
  loop: boolean;
  /** 0 auto (Building tool), 1 manual (Wall tool), 2 cave. */
  type: number;
  /** 0 sharp, 1 bevel, 2 round. */
  joint: number;
  shadow: boolean;
  nodeId: number | null;
  portals: Portal[];
}

export interface Pattern {
  position: Vec2;
  /** Rotation of the shape (radians). */
  shapeRotation: number;
  scale: Vec2;
  /** Local points, interleaved. */
  points: Float64Array;
  layer: number;
  color: RGBA | null;
  outline: boolean;
  texture: AssetRef | null;
  /** Rotation of the texture inside the shape (radians). */
  textureRotation: number;
  nodeId: number | null;
}

export interface Roof {
  position: Vec2;
  rotation: number;
  scale: Vec2;
  /** Ridge line, local, interleaved. */
  points: Float64Array;
  texture: AssetRef | null;
  /** Slope width either side of the ridge, world units, 0..maxWidth. */
  width: number;
  /** 0 gable, 1 hip, 2 dormer. */
  type: number;
  nodeId: number | null;
}

export interface Light {
  position: Vec2;
  /** Grid squares. */
  range: number;
  intensity: number;
  color: RGBA | null;
  texture: AssetRef | null;
  shadows: boolean;
  nodeId: number | null;
}

export interface Level {
  /** The key in world.levels ("0", "1", ...). Not an elevation order; use `label`. */
  key: string;
  id: number;
  label: string;
  /** User layer names by layer number (the locked tool layers are not listed in the file). */
  layers: Map<number, string>;
  ambientLight: RGBA | null;
  bakedLighting: boolean | null;
  terrain: Terrain | null;
  water: Water;
  cave: Cave | null;
  tiles: Tiles | null;
  /** Building-tool floor polygons (world, interleaved) and the node ids of the walls they generated. */
  floorPolygons: Float64Array[];
  floorWallIds: number[];
  materials: Material[];
  patterns: Pattern[];
  walls: Wall[];
  /** Freestanding portals only; wall portals live in walls[].portals. */
  portals: Portal[];
  paths: Path[];
  objects: MapObject[];
  lights: Light[];
  roofs: Roof[];
  roofShade: { enabled: boolean; contrast: number; sunDirection: number } | null;
  textCount: number;
}

export interface World {
  format: number | null;
  /** Map size in grid squares. */
  width: number;
  height: number;
  nextNodeId: number | null;
  gridColor: RGBA | null;
  wallShadow: boolean | null;
  objectShadow: boolean | null;
  embeddedCount: number;
  /** Marching-squares jitter settings (cosmetic). */
  msi: { cellSize: number; maxOffsetDistance: number; offsetMapSize: number; seed: string } | null;
  levels: Level[];
}

export interface DDMap {
  header: Header;
  world: World;
  /** Non-fatal problems: fields skipped, arrays with the wrong size, limits hit. */
  warnings: string[];
}

export interface ParseLimits {
  /**
   * Largest input accepted, in UTF-16 code units. Default 60 Mi, the design's cap for raw files
   * (a 200x200 map with 8 slots and caves is ~40 M; bigger files are refused for phones' sake).
   */
  maxChars: number;
  /** Largest map side in squares. Dungeondraft allows 128; the Unofficial Patch 500. Default 500. */
  maxSide: number;
  maxLevels: number;
  /** Per level, per kind (objects, paths, walls, ...). */
  maxItemsPerKind: number;
  /** Across the whole map, every kind and level together (objects, paths, walls, portals, ...). */
  maxTotalItems: number;
  /** Per polygon / polyline. */
  maxPointsPerShape: number;
  /** Across the whole map. */
  maxTotalPoints: number;
  maxWaterDepth: number;
  maxWaterNodes: number;
  /**
   * Bytes of decoded grids kept in the model across the whole map (terrain weights, cave and
   * material bitmaps, tile cells). A terrain with no splat still costs 8 bytes a texel, so without
   * this budget a small hostile file listing many levels could ask for gigabytes.
   */
  maxGridBytes: number;
  /**
   * JSON nesting, checked by a linear pre-scan before JSON.parse (whose own memory is not bounded
   * by anything else here: 30 M brackets cost it 3 GB). Real maps nest 6-11 deep; a water tree cut
   * at maxWaterDepth nests about twice that.
   */
  maxJsonDepth: number;
  /** Objects and arrays in the text (real maps: one per 600+ chars, so ~100k in a 60 Mi file). */
  maxJsonContainers: number;
  /** Values in the text, counted as containers plus commas (real maps: one per 25+ chars). */
  maxJsonValues: number;
  /**
   * Largest |scale| component on objects, paths, portals, patterns and roofs (real maps: up to 4).
   * Larger ones are clamped with a warning, so no single item can cover more than a local area.
   */
  maxScale: number;
  /** Largest path or roof width and portal radius, world units (real maps: up to 3.5 squares). Clamped likewise. */
  maxWidth: number;
}

export const DEFAULT_LIMITS: Readonly<ParseLimits> = {
  maxChars: 60 * 1024 * 1024,
  maxSide: 500,
  maxLevels: 64,
  maxItemsPerKind: 200_000,
  maxTotalItems: 1_000_000,
  maxPointsPerShape: 1_000_000,
  maxTotalPoints: 8_000_000,
  maxWaterDepth: 64,
  maxWaterNodes: 100_000,
  maxGridBytes: 256 * 1024 * 1024,
  maxJsonDepth: 512,
  maxJsonContainers: 2_000_000,
  maxJsonValues: 8_000_000,
  maxScale: 16,
  maxWidth: 16 * GRID,
};

// The data model shared by the Worker, the Room Durable Object and the browser.
// All coordinates are in "world" units: pixels of the scene's map image.

import type { Stamp } from "./terrain";

export type Role = "gm" | "player";

export type DiagonalRule = "chebyshev" | "alternating" | "euclidean";

export type GridType = "square" | "hex-pointy" | "hex-flat";

export interface GridSettings {
  /** Missing on scenes saved before hex grids existed, which are square. */
  type?: GridType;
  /** Map pixels per grid cell. */
  size: number;
  offsetX: number;
  offsetY: number;
  show: boolean;
  snap: boolean;
  color: string;
  opacity: number;
  /** Distance one cell represents, e.g. 5 (ft) or 1.5 (m). */
  unit: number;
  unitName: string;
  diagonal: DiagonalRule;
}

/** A scene's seasonal look: the whole map as it would look in that season. */
export const SEASON_LOOKS = ["spring", "summer", "autumn", "winter"] as const;
export type SeasonLook = (typeof SEASON_LOOKS)[number];

export interface SceneSeason {
  look: SeasonLook;
  /** How drastic: 1 light, 2 in season, 3 the most. */
  level: 1 | 2 | 3;
  /**
   * Noise seed (0-65535), set when a season is first applied and kept through changes,
   * so a restored backup (whose scenes get new ids) looks the same. Missing: from the scene id.
   */
  seed?: number;
}

export interface Scene {
  id: string;
  name: string;
  order: number;
  mapAssetId: string | null;
  width: number;
  height: number;
  background: string;
  grid: GridSettings;
  /** When true the whole scene starts covered by fog; reveal shapes cut holes in it. */
  fogCover: boolean;
  createdAt: number;
  /** A seasonal look (snow, autumn leaves...). Missing: the map as drawn. */
  season?: SceneSeason;
  /** Exact data for seasons from the map's Dungeondraft project file. Missing: seasons guess from the picture. */
  mapData?: SceneMapData;
  /**
   * The picture's rectangle in its Dungeondraft map, in squares [x, y, w, h] (from a .dd2vtt).
   * Cleared when the picture changes.
   */
  mapRect?: [number, number, number, number];
}

/** A Dungeondraft map's exact data for Seasons, compiled from its .dungeondraft_map (no picture in it). */
export interface SceneMapData {
  /** The sidecar asset (kind "mapdata"). */
  assetId: string;
  /** The map picture it was lined up with: used only while scene.mapAssetId is the same. */
  forAssetId: string;
  /** Bare trees ("dead_tree"): come into leaf, or stay dead. Missing: by the map (snowy: leaf; green: dead). */
  bare?: "leaf" | "dead";
  /** What the picture shows. Missing: by the map (snow on at least half the open soft ground: winter). */
  drawn?: "winter" | "green";
  /** Attached but not used until the GM checks it: it didn't seem to line up, or the level was unclear. */
  hold?: true;
  /**
   * Asset-pack items. Missing: left as drawn. "guess": seasons may treat the trees and snow caps the
   * picture shows inside their measured areas as the picture-guessing path would. Pack files are
   * never opened either way.
   */
  packs?: "guess";
}

/** "mapdata": a compiled Dungeondraft sidecar, packed losslessly in a PNG (GM only, never shown as a picture). */
export type AssetKind = "map" | "token" | "mapdata";

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  /** userId of the uploader. */
  owner: string;
  createdAt: number;
}

interface ItemBase {
  id: string;
  sceneId: string;
  z: number;
  /** userId of the creator. */
  owner: string;
}

export interface TokenItem extends ItemBase {
  kind: "token";
  /** Centre of the token. */
  x: number;
  y: number;
  /** Diameter in grid cells. */
  size: number;
  rotation: number;
  assetId: string | null;
  color: string;
  label: string;
  hidden: boolean;
  locked: boolean;
  rings: string[];
  /**
   * "prop" tokens (furniture, doors, objects) always sit under characters.
   * Missing on tokens saved before layers existed, which are characters.
   */
  layer?: TokenLayer;
  /**
   * Built-in art the browser draws instead of an image or a coloured disc. "compass": a
   * compass rose the GM puts on the map, North pointing `rotation` degrees clockwise from
   * up, its needle in `color`. Missing on ordinary tokens. Code from before it (protocol
   * under 4) isn't sent compasses: it would take one for a plain token.
   */
  art?: TokenArt;
}

export type TokenLayer = "character" | "prop";

export const TOKEN_ARTS = ["compass"] as const;
export type TokenArt = (typeof TOKEN_ARTS)[number];

/** A compass rose on the map (a token drawn as one). */
export function isCompass(item: Item | null | undefined): item is TokenItem & { art: "compass" } {
  return item?.kind === "token" && item.art === "compass";
}

/** How many compasses these items put on a scene. */
export function compassesOn(items: Iterable<Item>, sceneId: string): number {
  let n = 0;
  for (const item of items) if (item.sceneId === sceneId && isCompass(item)) n++;
  return n;
}

/**
 * Whether `item`, put in place of `existing` (none: a new item), brings a compass to its scene
 * that wasn't there: a new one, a token made into one, or one moved over from another scene.
 * Those count against the scene's limit; a compass changed where it is doesn't.
 */
export function bringsCompass(existing: Item | null | undefined, item: Item): boolean {
  return isCompass(item) && !(isCompass(existing) && existing.sceneId === item.sceneId);
}

export type DrawShape = "pen" | "line" | "rect" | "ellipse" | "poly" | "text";

export interface DrawingItem extends ItemBase {
  kind: "drawing";
  shape: DrawShape;
  /**
   * pen: x0,y0,x1,y1,...  line/rect/ellipse: x0,y0,x1,y1 (two corners / end points).
   * poly: a closed outline (at least three points).  text: x,y of the top-left corner.
   */
  points: number[];
  color: string;
  /** Stroke width, or the font size for text. */
  width: number;
  fill: boolean;
  /** text only. */
  text?: string;
  /** GM only: players never receive it (a secret note, say). */
  hidden?: boolean;
}

/** rect: two corners. poly: a closed outline. stroke: a brush stroke along the points. */
export type FogShape = "rect" | "poly" | "stroke";

export interface FogItem extends ItemBase {
  kind: "fog";
  mode: "hide" | "reveal";
  shape: FogShape;
  points: number[];
  /** Brush width in map pixels (strokes only). */
  width?: number;
}

/**
 * Part of a built map: a 16 x 16 block of grid cells (see terrain.ts). A hidden one
 * holds only secret doors, and players never receive it.
 */
export interface TerrainItem extends ItemBase {
  kind: "terrain";
  /** Which block: cells cx*16 to cx*16+15 across, cy*16 to cy*16+15 down. */
  cx: number;
  cy: number;
  /** 256 characters, one per cell. */
  cells: string;
  /** 512 characters, two per cell (its top and left edges). */
  edges: string;
  /** Objects whose top-left cell is in this block. */
  stamps: Stamp[];
  hidden?: boolean;
}

export type Item = TokenItem | DrawingItem | FogItem | TerrainItem;
export type ItemKind = Item["kind"];

/** Every field a patch may set, across all item kinds. */
export interface MutableFields {
  z: number;
  x: number;
  y: number;
  size: number;
  rotation: number;
  assetId: string | null;
  color: string;
  label: string;
  hidden: boolean;
  locked: boolean;
  rings: string[];
  layer: TokenLayer;
  shape: DrawShape | FogShape;
  points: number[];
  width: number;
  fill: boolean;
  text: string;
  mode: "hide" | "reveal";
  cells: string;
  edges: string;
  stamps: Stamp[];
}

export interface ItemPatch {
  id: string;
  set: Partial<MutableFields>;
}

export interface RoomSettings {
  playersCanDraw: boolean;
  playersCanAddTokens: boolean;
  /** When false, players may only move tokens they placed themselves. */
  playersMoveAll: boolean;
  /**
   * Measure in metres: new scenes start with one square being 1.5 m rather than 5 ft.
   * Missing on rooms made before it existed, which measure in feet.
   */
  metric?: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  createdAt: number;
  settings: RoomSettings;
}

export interface Player {
  /** One per open tab. */
  connId: string;
  /** Stable per browser (stored locally). */
  userId: string;
  name: string;
  color: string;
  role: Role;
  /** A table display: a screen showing the map to the table. Sees what players see, changes nothing. */
  display?: boolean;
}

export interface DieRoll {
  v: number;
  dropped: boolean;
}

export type RollTerm =
  | {
      kind: "dice";
      sign: 1 | -1;
      notation: string;
      count: number;
      sides: number | "F";
      rolls: DieRoll[];
      subtotal: number;
    }
  | { kind: "num"; sign: 1 | -1; value: number };

export interface RollResult {
  expr: string;
  total: number;
  terms: RollTerm[];
}

export interface ChatMessage {
  id: string;
  ts: number;
  userId: string;
  name: string;
  color: string;
  role: Role;
  kind: "chat" | "roll";
  text: string;
  roll?: RollResult;
  /** Visible only to the sender and the GM. */
  private?: boolean;
}

export interface InitEntry {
  id: string;
  name: string;
  value: number;
  color: string;
  tokenId: string | null;
}

export interface Initiative {
  entries: InitEntry[];
  /** Index into entries (sorted by value, highest first). */
  turn: number;
  round: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number;
}

// The data model shared by the Worker, the Room Durable Object and the browser.
// All coordinates are in "world" units: pixels of the scene's map image.

import type { Stamp } from "./terrain";
import type { SpellLook } from "./zones";

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
  /** Dungeon's texture for the walls of the scene's built map (a wall texture's id). Missing: Tabletop's plain dark walls. */
  wallTexture?: string;
  /**
   * The scene's area in world units, [left, top, right, bottom], when the GM has extended it
   * past its picture. It always holds the picture, [0, 0, width, height]; left and top may be
   * below 0, so extending never moves anything already on the scene. Missing: the picture's
   * own rectangle.
   */
  bounds?: [number, number, number, number];
  /** The Dungeon map and level it came from (New scene › From Dungeon), so it can be updated from Dungeon. */
  dungeon?: SceneDungeon;
  /** Lighting and line of sight: its walls, doors and lights, and whether players see only what the party sees. */
  vision?: SceneVision;
}

/**
 * Lighting and line of sight on a scene (client/room/vision.ts). With it on, players see only
 * what the party's tokens can see: walls and closed doors block sight (the map file's, and the
 * Build tool's), and in the dark only what a light, or the party's own light, falls on.
 */
export interface SceneVision {
  /** On: players see only what the party can see. Off: everything, as before. */
  on: boolean;
  /** Lit all over, as by day. Off, it's dark: only the lights and the party's own light show. */
  daylight: boolean;
  /**
   * Not by day, night by moon or starlight rather than dark (underground): characters with
   * nightvision see as well, in black and white (shared/characters.ts nightvisionOf).
   */
  night?: boolean;
  /** How far the party's own light reaches in the dark, in squares (0: none), when `light` isn't set (scenes from before distances). */
  partyLight: number;
  /** How far the party can see at all, in squares, light or dark (0: as far as the walls allow), when `sight` isn't set. */
  sightRange: number;
  /**
   * How far the party's own light reaches in the dark as a distance (18 m, 60 ft; 0: none): it's
   * the same distance whatever a square is (shared/units.ts visionSquares). Wins over partyLight.
   */
  light?: VisionDistance;
  /** How far the party can see as a distance (0: as far as the walls allow). Wins over sightRange. */
  sight?: VisionDistance;
  /** The map file's walls that block sight: lines, each [x0, y0, x1, y1, ...] in scene units. */
  walls: number[][];
  /** The map file's doors: from one end to the other in scene units, and whether each is open. */
  doors: { line: [number, number, number, number]; open: boolean }[];
  /** The map file's lights: where, and how far they reach, in scene units. */
  lights: SceneLight[];
  /** The Build tool's doors that are open (build.ts edge keys); the rest are shut. */
  openEdges?: number[];
  /**
   * Each player sees only through their own character's token (and tokens they placed), and keeps
   * their character's own explored map. Missing or false: the whole party sees together.
   */
  perPlayer?: boolean;
  /** Players' tokens go through walls and shut doors. Missing or false: walls stop them, as they stop sight. */
  passWalls?: boolean;
}

/** A light on a scene (from its map file): where, how far it reaches, and how it looks. */
export interface SceneLight {
  x: number;
  y: number;
  r: number;
  /** The colour it casts (#rrggbb): from the map file, or the GM's. Missing: plain light, no tint. */
  color?: string;
  /** It flickers, as a torch or a fire does. */
  flicker?: boolean;
}

/** A distance in a unit, as a scene's grid names it ("m", "ft"). */
export interface VisionDistance {
  d: number;
  unit: string;
}

/** Where a scene came from in Dungeon, the map maker (New scene › From Dungeon). */
export interface SceneDungeon {
  /** The map's id in Dungeon's maps online. */
  map: string;
  /** The bringing-in it was part of: the scenes brought in together are updated together. */
  batch: string;
  /**
   * Its level's name ("" for a map with one level). Levels are matched by name, so adding, moving
   * or deleting levels in Dungeon doesn't put a scene on another floor.
   */
  level: string;
  /** Its level's place in the map when it was last brought in (tells levels of the same name apart). */
  index: number;
  /** Every level's name then: an update tells a level that's new from one whose scene was deleted. */
  levels: string[];
  /** The picture Dungeon drew for it. Showing another (changed by hand), the scene isn't Dungeon's any more. */
  asset: string;
  /** Whether Dungeon's lighting was painted into the picture (an update does the same). */
  lighting?: boolean;
}

/** A rectangle in world units, from (x0, y0) to (x1, y1). */
export interface SceneArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A scene's area: its bounds when it's been extended, else its picture's rectangle. */
export function sceneBounds(scene: Pick<Scene, "width" | "height" | "bounds">): SceneArea {
  const b = scene.bounds;
  return b ? { x0: b[0], y0: b[1], x1: b[2], y1: b[3] } : { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
}

/** The middle of a scene's area. */
export function sceneMiddle(scene: Pick<Scene, "width" | "height" | "bounds">): { x: number; y: number } {
  const a = sceneBounds(scene);
  return { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 };
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
  /** "dungeon": the data came inside a Dungeon export (dungeon.parhome.ca). Missing: from a Dungeondraft project file. */
  from?: "dungeon";
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
  /**
   * The character sheet it stands for (its Google Sheets id; shared/characters.ts): its card, HP
   * bar and rolls come from there. Missing or null on any other token.
   */
  character?: string | null;
  /** Its picture mirrored left to right, so it faces the other way. Missing on tokens that aren't. */
  flipped?: boolean;
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
  /**
   * A spell effect that stays on the map (the Spells tool): an ellipse or a rect drawn with this
   * look instead of an outline, or with a token's look (an ellipse, with `on`). Pages from before
   * a look aren't sent it (lookVersion).
   */
  fx?: SpellLook;
  /** The spell it's from, as its name ("Fog Cloud"), shown on marked zones. fx only. */
  spell?: string;
  /**
   * A token's look only: the token the spell is on. The look is drawn on that token wherever it
   * goes (the drawing's own points stay where it was cast), and goes with it when it's deleted.
   */
  on?: string;
  /**
   * A spell that lasts so many rounds: how many are left. Initiative counts it down as rounds pass
   * (the Room does, room.ts passRounds), and it ends when none are left. Missing: until it's ended.
   */
  rounds?: number;
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
  /**
   * Dungeon's textures on its cells, if any (terrain.ts, encodeTextures): 256 characters,
   * "." for none or an index into pal, the texture ids. Both or neither; "" and [] when a
   * patch takes them all away.
   */
  tex?: string;
  pal?: string[];
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
  character: string | null;
  flipped: boolean;
  shape: DrawShape | FogShape;
  points: number[];
  width: number;
  fill: boolean;
  text: string;
  mode: "hide" | "reveal";
  cells: string;
  edges: string;
  stamps: Stamp[];
  tex: string;
  pal: string[];
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
  /**
   * Never snap to the grid: in every scene, tokens and the Build tool's objects go exactly where
   * they're put, whatever a scene's own Snap tokens box or a browser's Snap to squares says
   * (rulers and spell areas aren't snapped either). Missing: off.
   */
  freePlacement?: boolean;
}

/** Whether a scene snaps tokens (and rulers and spell areas) to its grid, in a room with these settings. */
export function sceneSnaps(scene: Pick<Scene, "grid">, settings: Pick<RoomSettings, "freePlacement"> | null | undefined): boolean {
  return scene.grid.snap && !settings?.freePlacement;
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

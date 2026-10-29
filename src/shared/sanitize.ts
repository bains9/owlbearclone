// Input validation for everything a client can send. The Room Durable Object runs
// every incoming item, patch and scene through these before it stores anything,
// so a buggy or hostile client can't corrupt the room for everyone else.

import type {
  DiagonalRule,
  DrawingItem,
  GridSettings,
  GridType,
  InitEntry,
  Initiative,
  Item,
  MutableFields,
  RoomSettings,
  Scene,
  SceneDungeon,
  SceneVision,
  SceneMapData,
  SceneSeason,
} from "./types";
import { SEASON_LOOKS, TOKEN_ARTS, isCompass } from "./types";
import { cleanCells, cleanEdges, cleanPal, cleanStamps, cleanTex, isWallTexture, sanitizeTerrain, terrainFieldsOk } from "./terrain";

export const LIMITS = {
  coord: 1_000_000,
  pointNumbers: 10_000,
  label: 60,
  name: 60,
  playerName: 32,
  chat: 1000,
  noteText: 500,
  rings: 8,
  tokenSizeMin: 0.25,
  tokenSizeMax: 30,
  strokeMax: 1000,
  /** Fog brush width in map pixels: 20 squares at the largest grid size (2000 px). */
  brushMax: 40_000,
  sceneSizeMax: 40_000,
  initiativeEntries: 100,
  itemsPerScene: 5000,
  /** A Dungeondraft picture's rectangle in its map, in squares, either way from the origin. */
  mapRectMax: 10_000,
  /** Compass roses on one scene (one is usual). */
  compassesPerScene: 20,
  /** What one grid square can be, in whatever unit the scene measures in. */
  gridUnitMin: 0.01,
  gridUnitMax: 100_000,
} as const;

// Ids can't start with "__" (so "__proto__" never becomes a key in a plain object).
const ID_RE = /^(?!__)[A-Za-z0-9_-]{1,64}$/;

/**
 * The owner recorded on everything the GM creates. It can't pass ID_RE, so no
 * player can claim it by choosing it as their browser id.
 */
export const GM_OWNER = "@gm";

/** A valid owner: a player's id or the GM. */
export function isOwner(v: unknown): v is string {
  return v === GM_OWNER || isId(v);
}
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

export function cleanColor(v: unknown): string | undefined {
  return typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : undefined;
}

/** Like cleanText, but keeps line breaks (for notes on the map). */
export function cleanMultiline(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return Array.from(s).slice(0, max).join("");
}

/** Trims, removes control characters, and cuts to max characters. */
export function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return Array.from(s).slice(0, max).join("");
}

function num(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function pointList(v: unknown, minNumbers: number, maxNumbers: number): number[] | undefined {
  if (!Array.isArray(v) || v.length < minNumbers || v.length > maxNumbers || v.length % 2 !== 0) return undefined;
  const out: number[] = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const n = num(v[i], -LIMITS.coord, LIMITS.coord);
    if (n === undefined) return undefined;
    out[i] = Math.round(n * 100) / 100;
  }
  return out;
}

function rotation(v: unknown): number | undefined {
  const n = num(v, -1e6, 1e6);
  if (n === undefined) return undefined;
  return ((n % 360) + 360) % 360;
}

function rings(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > LIMITS.rings) return undefined;
  const out: string[] = [];
  for (const c of v) {
    const col = cleanColor(c);
    if (!col) return undefined;
    if (!out.includes(col)) out.push(col);
  }
  return out;
}

type Validator = (v: unknown) => unknown;

const coord: Validator = (v) => num(v, -LIMITS.coord, LIMITS.coord);

const TOKEN_FIELDS: Record<string, Validator> = {
  z: (v) => num(v, -1e9, 1e9),
  x: coord,
  y: coord,
  size: (v) => num(v, LIMITS.tokenSizeMin, LIMITS.tokenSizeMax),
  rotation,
  assetId: (v) => (v === null ? null : isId(v) ? v : undefined),
  color: cleanColor,
  label: (v) => cleanText(v, LIMITS.label),
  hidden: bool,
  locked: bool,
  rings,
  layer: (v) => (v === "prop" || v === "character" ? v : undefined),
  character: (v) => (v === null ? null : isSheetId(v) ? v : undefined),
  flipped: bool,
};

/** A character sheet's id, as a token keeps it (shared/characters.ts). */
export function isSheetId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(v);
}

const DRAWING_FIELDS: Record<string, Validator> = {
  z: (v) => num(v, -1e9, 1e9),
  points: (v) => pointList(v, 2, LIMITS.pointNumbers),
  color: cleanColor,
  width: (v) => num(v, 0.5, LIMITS.strokeMax),
  fill: bool,
  text: (v) => cleanMultiline(v, LIMITS.noteText) || undefined,
  hidden: bool,
};

const FOG_FIELDS: Record<string, Validator> = {
  z: (v) => num(v, -1e9, 1e9),
  points: (v) => pointList(v, 4, LIMITS.pointNumbers),
  mode: (v) => (v === "hide" || v === "reveal" ? v : undefined),
};

/** A chunk's position and whether it's hidden never change: only its contents. */
const TERRAIN_FIELDS: Record<string, Validator> = {
  cells: cleanCells,
  edges: cleanEdges,
  stamps: cleanStamps,
  tex: cleanTex,
  pal: cleanPal,
};

const FIELDS_BY_KIND = { token: TOKEN_FIELDS, drawing: DRAWING_FIELDS, fog: FOG_FIELDS, terrain: TERRAIN_FIELDS } as const;

const DRAW_SHAPES = ["pen", "line", "rect", "ellipse", "poly", "text"] as const;

function shapePointsOk(kind: "drawing" | "fog", shape: string, points: number[]): boolean {
  if (kind === "drawing") {
    if (shape === "pen") return points.length >= 2;
    if (shape === "poly") return points.length >= 6;
    if (shape === "text") return points.length === 2;
    return points.length === 4;
  }
  if (shape === "rect") return points.length === 4;
  if (shape === "stroke") return points.length >= 4;
  return points.length >= 6;
}

/** Validates a complete item. Returns null if anything is missing or malformed. */
export function sanitizeItem(raw: unknown, owner: string): Item | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isId(r.id) || !isId(r.sceneId)) return null;
  const z = num(r.z, -1e9, 1e9) ?? 0;
  if (r.kind === "token") {
    const x = coord(r.x) as number | undefined;
    const y = coord(r.y) as number | undefined;
    if (x === undefined || y === undefined) return null;
    const assetId = r.assetId === undefined || r.assetId === null ? null : isId(r.assetId) ? r.assetId : undefined;
    if (assetId === undefined) return null;
    // Built-in art this code doesn't know is refused rather than kept as a plain token.
    const art = r.art === undefined || r.art === null ? null : TOKEN_ARTS.find((a) => a === r.art);
    if (art === undefined) return null;
    if (art === "compass") {
      // Drawn by the browser, under characters: never an image, never a character.
      return {
        id: r.id,
        sceneId: r.sceneId,
        kind: "token",
        z,
        owner,
        x,
        y,
        size: num(r.size, LIMITS.tokenSizeMin, LIMITS.tokenSizeMax) ?? 2,
        rotation: rotation(r.rotation) ?? 0,
        assetId: null,
        color: cleanColor(r.color) ?? "#d62f2f",
        label: cleanText(r.label, LIMITS.label) ?? "N",
        hidden: bool(r.hidden) ?? false,
        locked: bool(r.locked) ?? false,
        rings: rings(r.rings) ?? [],
        layer: "prop",
        art,
      };
    }
    return {
      id: r.id,
      sceneId: r.sceneId,
      kind: "token",
      z,
      owner,
      x,
      y,
      size: num(r.size, LIMITS.tokenSizeMin, LIMITS.tokenSizeMax) ?? 1,
      rotation: rotation(r.rotation) ?? 0,
      assetId,
      color: cleanColor(r.color) ?? "#e4572e",
      label: cleanText(r.label, LIMITS.label) ?? "",
      hidden: bool(r.hidden) ?? false,
      locked: bool(r.locked) ?? false,
      rings: rings(r.rings) ?? [],
      ...(r.layer === "prop" ? { layer: "prop" as const } : {}),
      ...(isSheetId(r.character) ? { character: r.character } : {}),
      ...(r.flipped === true ? { flipped: true } : {}),
    };
  }
  if (r.kind === "drawing") {
    const shape = DRAW_SHAPES.find((s) => s === r.shape);
    if (!shape) return null;
    const points = pointList(r.points, 2, LIMITS.pointNumbers);
    if (!points || !shapePointsOk("drawing", shape, points)) return null;
    const item: DrawingItem = {
      id: r.id,
      sceneId: r.sceneId,
      kind: "drawing",
      z,
      owner,
      shape,
      points,
      color: cleanColor(r.color) ?? "#ffffff",
      width: num(r.width, 0.5, LIMITS.strokeMax) ?? 4,
      fill: bool(r.fill) ?? false,
    };
    if (shape === "text") {
      const text = cleanMultiline(r.text, LIMITS.noteText);
      if (!text) return null;
      item.text = text;
    }
    if (r.hidden === true) item.hidden = true;
    return item;
  }
  if (r.kind === "fog") {
    const shape = r.shape;
    if (shape !== "rect" && shape !== "poly" && shape !== "stroke") return null;
    const points = pointList(r.points, 4, LIMITS.pointNumbers);
    if (!points || !shapePointsOk("fog", shape, points)) return null;
    const mode = r.mode === "reveal" ? "reveal" : r.mode === "hide" ? "hide" : null;
    if (!mode) return null;
    if (shape === "stroke") {
      const width = num(r.width, 1, LIMITS.brushMax);
      if (width === undefined) return null;
      return { id: r.id, sceneId: r.sceneId, kind: "fog", z, owner, mode, shape, points, width };
    }
    return { id: r.id, sceneId: r.sceneId, kind: "fog", z, owner, mode, shape, points };
  }
  if (r.kind === "terrain") return sanitizeTerrain(r, r.id, r.sceneId, GM_OWNER);
  return null;
}

/**
 * Validates the fields of a patch against the item it applies to. Unknown fields,
 * fields that don't belong to the item's kind, or any bad value reject the whole
 * patch (returns null).
 */
export function sanitizeSet(item: Item, raw: unknown): Partial<MutableFields> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fields = FIELDS_BY_KIND[item.kind];
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Own keys only: "constructor", "toString" and friends are not fields.
    if (!Object.hasOwn(fields, key)) return null;
    const validate = fields[key];
    const v = validate(value);
    if (v === undefined) return null;
    out[key] = v;
    n++;
  }
  if (n === 0) return null;
  if (out.points && (item.kind === "drawing" || item.kind === "fog")) {
    if (!shapePointsOk(item.kind, item.shape, out.points as number[])) return null;
  }
  if (item.kind === "terrain" && !terrainFieldsOk(!!item.hidden, out as Partial<MutableFields>)) return null;
  // A compass stays a compass: a prop, drawn without an image, never mirrored.
  if (isCompass(item) && ((out.layer !== undefined && out.layer !== "prop") || (out.assetId !== undefined && out.assetId !== null) || out.flipped === true)) {
    return null;
  }
  if ("text" in out && !(item.kind === "drawing" && item.shape === "text")) return null;
  return out as Partial<MutableFields>;
}

const DIAGONALS: DiagonalRule[] = ["chebyshev", "alternating", "euclidean"];
const GRID_TYPES: GridType[] = ["square", "hex-pointy", "hex-flat"];

export function sanitizeGrid(raw: unknown, fallback: GridSettings): GridSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const type = GRID_TYPES.find((t) => t === r.type) ?? fallback.type ?? "square";
  return {
    type,
    size: num(r.size, 4, 2000) ?? fallback.size,
    offsetX: num(r.offsetX, -10000, 10000) ?? fallback.offsetX,
    offsetY: num(r.offsetY, -10000, 10000) ?? fallback.offsetY,
    show: bool(r.show) ?? fallback.show,
    snap: bool(r.snap) ?? fallback.snap,
    color: cleanColor(r.color) ?? fallback.color,
    opacity: num(r.opacity, 0, 1) ?? fallback.opacity,
    unit: num(r.unit, LIMITS.gridUnitMin, LIMITS.gridUnitMax) ?? fallback.unit,
    unitName: cleanText(r.unitName, 12) ?? fallback.unitName,
    diagonal: DIAGONALS.includes(r.diagonal as DiagonalRule) ? (r.diagonal as DiagonalRule) : fallback.diagonal,
  };
}

export const DEFAULT_GRID: GridSettings = {
  type: "square",
  size: 70,
  offsetX: 0,
  offsetY: 0,
  show: true,
  snap: true,
  color: "#000000",
  opacity: 0.35,
  unit: 5,
  unitName: "ft",
  diagonal: "chebyshev",
};

/**
 * A scene's season. null turns it off; anything malformed is undefined (the caller keeps
 * what the scene had). Unknown keys are dropped.
 */
export function sanitizeSeason(v: unknown): SceneSeason | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const look = SEASON_LOOKS.find((l) => l === r.look);
  const level = r.level === 1 || r.level === 2 || r.level === 3 ? r.level : undefined;
  if (!look || !level) return undefined;
  const seed = typeof r.seed === "number" && Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 65535 ? r.seed : undefined;
  return { look, level, ...(seed !== undefined ? { seed } : {}) };
}

/**
 * A scene's Dungeondraft data for seasons. null removes it; anything malformed is undefined
 * (the caller keeps what the scene had). Unknown keys are dropped.
 */
export function sanitizeMapData(v: unknown): SceneMapData | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (!isId(r.assetId) || !isId(r.forAssetId)) return undefined;
  const bare = r.bare === "leaf" || r.bare === "dead" ? r.bare : undefined;
  const drawn = r.drawn === "winter" || r.drawn === "green" ? r.drawn : undefined;
  const packs = r.packs === "guess" ? r.packs : undefined;
  const from = r.from === "dungeon" ? r.from : undefined;
  if ((r.bare !== undefined && !bare) || (r.drawn !== undefined && !drawn)) return undefined;
  if ((r.hold !== undefined && r.hold !== true) || (r.packs !== undefined && !packs)) return undefined;
  if (r.from !== undefined && !from) return undefined;
  return {
    assetId: r.assetId,
    forAssetId: r.forAssetId,
    ...(bare ? { bare } : {}),
    ...(drawn ? { drawn } : {}),
    ...(r.hold === true ? { hold: true as const } : {}),
    ...(packs ? { packs } : {}),
    ...(from ? { from } : {}),
  };
}

/**
 * The picture's rectangle in its Dungeondraft map, in squares [x, y, w, h]. null removes it;
 * anything malformed (not four finite numbers within 10,000 squares, or no width or height)
 * is undefined, which keeps what the scene had.
 */
export function sanitizeMapRect(v: unknown): [number, number, number, number] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= LIMITS.mapRectMax)) return undefined;
  const [x, y, w, h] = v as number[];
  return w > 0 && h > 0 ? [x, y, w, h] : undefined;
}

/** Where a scene came from in Dungeon, as sent: null to unlink it; undefined when unusable (the scene keeps what it had). */
export function sanitizeDungeonLink(v: unknown): SceneDungeon | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const levelName = (x: unknown) => (typeof x === "string" && x.length <= 60 ? x : null);
  if (typeof r.map !== "string" || !/^[A-Za-z0-9]{12}$/.test(r.map)) return undefined;
  if (typeof r.batch !== "string" || !/^[A-Za-z0-9]{12}$/.test(r.batch)) return undefined;
  if (levelName(r.level) === null || !isId(r.asset)) return undefined;
  if (typeof r.index !== "number" || !Number.isInteger(r.index) || r.index < 0 || r.index > 99) return undefined;
  if (!Array.isArray(r.levels) || r.levels.length > 99 || !r.levels.every((n) => levelName(n) !== null)) return undefined;
  return {
    map: r.map,
    batch: r.batch,
    level: r.level as string,
    index: r.index,
    levels: r.levels as string[],
    asset: r.asset,
    ...(r.lighting === true ? { lighting: true } : {}),
  };
}

/** How much of a scene's lighting and line of sight is kept: plenty for a big map from Dungeon. */
export const VISION_LIMITS = { wallLines: 6000, wallNumbers: 80_000, doors: 2000, lights: 1000, openEdges: 4000, partyLight: 60, sightRange: 200 };
/** How far the party sees to begin with, in squares: so sight doesn't run ahead of the fog of war down a long hall. */
export const SIGHT_RANGE = 12;

/**
 * A scene's lighting and line of sight as sent (SceneVision): null to take it away; undefined when
 * unusable (the scene keeps what it had). Points are kept to a tenth of a unit, inside the
 * biggest scene there can be.
 */
export function sanitizeVision(v: unknown): SceneVision | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const far = LIMITS.sceneSizeMax * 3;
  const coord = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= far ? Math.round(n * 10) / 10 : undefined);
  if (!Array.isArray(r.walls) || r.walls.length > VISION_LIMITS.wallLines) return undefined;
  const walls: number[][] = [];
  let numbers = 0;
  for (const line of r.walls) {
    if (!Array.isArray(line) || line.length < 4 || line.length % 2 !== 0) return undefined;
    numbers += line.length;
    if (numbers > VISION_LIMITS.wallNumbers) return undefined;
    const pts = line.map(coord);
    if (pts.some((n) => n === undefined)) return undefined;
    walls.push(pts as number[]);
  }
  if (!Array.isArray(r.doors) || r.doors.length > VISION_LIMITS.doors) return undefined;
  const doors: SceneVision["doors"] = [];
  for (const d of r.doors) {
    const x = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    if (!Array.isArray(x.line) || x.line.length !== 4) return undefined;
    const line = x.line.map(coord);
    if (line.some((n) => n === undefined)) return undefined;
    doors.push({ line: line as [number, number, number, number], open: x.open === true });
  }
  if (!Array.isArray(r.lights) || r.lights.length > VISION_LIMITS.lights) return undefined;
  const lights: SceneVision["lights"] = [];
  for (const l of r.lights) {
    const x = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const px = coord(x.x), py = coord(x.y), pr = coord(x.r);
    if (px === undefined || py === undefined || pr === undefined || pr <= 0) return undefined;
    lights.push({ x: px, y: py, r: pr });
  }
  const openEdges = Array.isArray(r.openEdges)
    ? [...new Set(r.openEdges.filter((k): k is number => typeof k === "number" && Number.isInteger(k) && k >= 0 && k < 2 ** 40))].slice(0, VISION_LIMITS.openEdges)
    : [];
  return {
    on: r.on === true,
    daylight: r.daylight !== false,
    partyLight: num(r.partyLight, 0, VISION_LIMITS.partyLight) ?? 0,
    sightRange: num(r.sightRange, 0, VISION_LIMITS.sightRange) ?? SIGHT_RANGE,
    walls,
    doors,
    lights,
    ...(openEdges.length ? { openEdges } : {}),
  };
}

/** A scene's bounds as sent: null to go back to the picture's rectangle; undefined when unusable. */
export function sanitizeBounds(v: unknown): [number, number, number, number] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const [l, t, r, b] = v as number[];
  return r > l && b > t ? [l, t, r, b] : undefined;
}

/**
 * Bounds made to hold the picture ([0, 0, width, height]) and to reach at most
 * LIMITS.sceneSizeMax past it on each side; undefined when that leaves just the picture.
 */
export function fitBounds(b: readonly number[], width: number, height: number): [number, number, number, number] | undefined {
  const m = LIMITS.sceneSizeMax;
  const l = Math.max(-m, Math.min(0, b[0]));
  const t = Math.max(-m, Math.min(0, b[1]));
  const r = Math.min(width + m, Math.max(width, b[2]));
  const btm = Math.min(height + m, Math.max(height, b[3]));
  return l === 0 && t === 0 && r === width && btm === height ? undefined : [l, t, r, btm];
}

/**
 * A whole scene, or with `existing`, a change to one. `grid` fills in whatever grid settings
 * a new scene leaves out (the room's own defaults: feet or metres).
 */
export function sanitizeScene(raw: unknown, existing?: Scene, grid: GridSettings = DEFAULT_GRID): Scene | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isId(r.id)) return null;
  if (existing && existing.id !== r.id) return null;
  const width = num(r.width, 16, LIMITS.sceneSizeMax) ?? existing?.width;
  const height = num(r.height, 16, LIMITS.sceneSizeMax) ?? existing?.height;
  if (width === undefined || height === undefined) return null;
  const mapAssetId =
    r.mapAssetId === null ? null : isId(r.mapAssetId) ? r.mapAssetId : (existing?.mapAssetId ?? null);
  // A season left out keeps the scene's; null turns it off.
  const sv = sanitizeSeason(r.season);
  const season = sv === null ? undefined : (sv ?? existing?.season);
  // The same for the Dungeondraft data and the picture's rectangle in its map.
  const mv = sanitizeMapData(r.mapData);
  const mapData = mv === null ? undefined : (mv ?? existing?.mapData);
  // The rectangle belongs to the picture (2.8): a new picture, or none, drops it unless the
  // change brings its own. New tabs clear it themselves; this covers old ones (3.7) and Remove.
  const rv = sanitizeMapRect(r.mapRect);
  const newPicture = !!existing && mapAssetId !== existing.mapAssetId;
  const mapRect = rv === null ? undefined : (rv ?? (newPicture ? undefined : existing?.mapRect));
  // The walls' texture: null goes back to plain walls, one Dungeon doesn't have keeps the scene's.
  const wallTexture = r.wallTexture === null ? undefined : isWallTexture(r.wallTexture) ? r.wallTexture : existing?.wallTexture;
  // The scene's area: a change may set it (null: back to the picture's own). It always keeps
  // the picture inside, so a new picture of another size still fits.
  const bv = sanitizeBounds(r.bounds);
  const asked = bv === null ? undefined : (bv ?? existing?.bounds);
  const bounds = asked && fitBounds(asked, width, height);
  // The link to Dungeon belongs to the picture Dungeon drew: a new picture ends it unless the change
  // brings its own (Update from Dungeon), and it never names a picture the scene isn't showing.
  const lv = sanitizeDungeonLink(r.dungeon);
  const linked = lv === null ? undefined : (lv ?? (newPicture ? undefined : existing?.dungeon));
  const dungeon = linked && linked.asset === mapAssetId ? linked : undefined;
  // Lighting and line of sight: null takes it away, a change without it keeps the scene's.
  const vv = sanitizeVision(r.vision);
  const vision = vv === null ? undefined : (vv ?? existing?.vision);
  return {
    id: r.id,
    name: cleanText(r.name, LIMITS.name) || existing?.name || "Scene",
    order: num(r.order, -1e9, 1e9) ?? existing?.order ?? 0,
    mapAssetId,
    width,
    height,
    background: cleanColor(r.background) ?? existing?.background ?? "#2b2f36",
    grid: sanitizeGrid(r.grid, existing?.grid ?? grid),
    fogCover: bool(r.fogCover) ?? existing?.fogCover ?? false,
    createdAt: existing?.createdAt ?? num(r.createdAt, 0, 1e15) ?? Date.now(),
    ...(season ? { season } : {}),
    ...(mapData ? { mapData } : {}),
    ...(mapRect ? { mapRect } : {}),
    ...(wallTexture ? { wallTexture } : {}),
    ...(bounds ? { bounds } : {}),
    ...(dungeon ? { dungeon } : {}),
    ...(vision ? { vision } : {}),
  };
}

export function sanitizeInitiative(raw: unknown): Initiative | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.entries) || r.entries.length > LIMITS.initiativeEntries) return null;
  const entries: InitEntry[] = [];
  for (const e of r.entries) {
    if (!e || typeof e !== "object") return null;
    const x = e as Record<string, unknown>;
    if (!isId(x.id)) return null;
    const value = num(x.value, -10000, 10000);
    if (value === undefined) return null;
    entries.push({
      id: x.id,
      name: cleanText(x.name, 40) || "?",
      value,
      color: cleanColor(x.color) ?? "#8a8f98",
      tokenId: isId(x.tokenId) ? x.tokenId : null,
    });
  }
  const turn = Math.round(num(r.turn, 0, Math.max(0, entries.length - 1)) ?? 0);
  const round = Math.round(num(r.round, 1, 99999) ?? 1);
  return { entries, turn, round };
}

export function sanitizeSettings(raw: unknown, current: RoomSettings): RoomSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const metric = bool(r.metric) ?? current.metric;
  return {
    playersCanDraw: bool(r.playersCanDraw) ?? current.playersCanDraw,
    playersCanAddTokens: bool(r.playersCanAddTokens) ?? current.playersCanAddTokens,
    playersMoveAll: bool(r.playersMoveAll) ?? current.playersMoveAll,
    // Left out (a page from before metres, say) keeps what the room has; a room that never had it stays without.
    ...(metric !== undefined ? { metric } : {}),
  };
}

export const DEFAULT_SETTINGS: RoomSettings = {
  playersCanDraw: true,
  playersCanAddTokens: true,
  playersMoveAll: true,
  // This table is metric. Rooms made before the setting existed have none: they stay in feet.
  metric: true,
};

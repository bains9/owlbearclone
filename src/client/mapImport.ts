// Reading map files for new scenes: plain images, battle maps exported with their
// grid (the Universal VTT format written by Dungeondraft, DungeonFog, Dungeon Alchemist
// and others: .dd2vtt, .df2vtt, .uvtt), and Dungeondraft's own project files
// (.dungeondraft_map), which hold the map's data but no picture. A project file is paired
// with a picture from the same batch (pairDungeondraft), and the pair makes a scene with
// exact seasons (importScenes.ts); one on its own is reported.
//
// Everything here runs in the browser. The map image goes on to the normal upload,
// which may shrink it, so grid sizes are worked out afterwards from the final size.
// Nothing of the Dungeondraft parser is loaded here: a project file is only sniffed
// (its first bytes) for what pairing needs, and read in full by the attach worker.

import type { GridType } from "../shared/types";
import type { VttMeta } from "./dd/extract";

/** A map ready to become a scene. */
export interface MapFile {
  /** Scene name. */
  name: string;
  /** The map image, ready to upload. */
  image: File;
  /** Grid cells across and down, when the file (or its name) says. */
  cols?: number;
  rows?: number;
  /** Pixels per grid cell in the original image, when known. */
  pxPerCell?: number;
  /** The original image's size, when known (the upload may shrink it). */
  width?: number;
  height?: number;
  /** Grid offset in the original image's pixels (for hexes, where a hex's centre falls). */
  offsetX?: number;
  offsetY?: number;
  /** Square unless the file says otherwise. */
  gridType?: GridType;
  /** The Dungeondraft project file this picture was exported from, when it came in the same batch. */
  dd?: File;
  /** For a Universal VTT file: where its picture lies in the map and which level it shows (for `dd`). */
  vtt?: VttMeta;
}

/** What the file picker offers. */
export const MAP_FILE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/avif,.dd2vtt,.df2vtt,.uvtt,.json,.ob2,.owlbear,.dungeondraft_map";

/** Most portal, light and line-of-sight points a VttMeta keeps, in all (extract.ts VTT_META_POINTS; a test keeps them equal). */
export const VTT_META_POINTS = 20_000;

const VTT_EXT = /\.(dd2vtt|df2vtt|uvtt|json)$/i;
const DD_EXT = /\.dungeondraft_map$/i;
const OWLBEAR_EXT = /\.(ob2|owlbear)$/i;

export function isVttFile(f: File): boolean {
  return VTT_EXT.test(f.name);
}

/** How much of a file is read to tell what it is, and to find a project file's size. */
const SNIFF_BYTES = 4096;
const SIZE_SNIFF_BYTES = 1 << 20;
/** The longest map side in squares the parser accepts (dd/model.ts DEFAULT_LIMITS.maxSide; a test keeps them equal). */
export const MAX_MAP_SIDE = 500;

/**
 * Dungeondraft's own project file: the map's data, but no picture. By its name, or, for a
 * file renamed without the extension (.json, or none), by its first bytes: JSON whose first
 * key is "header", from Dungeondraft.
 */
export async function isDungeondraftFile(f: File): Promise<boolean> {
  if (DD_EXT.test(f.name)) return true;
  if (f.type.startsWith("image/") || OWLBEAR_EXT.test(f.name) || /\.(dd2vtt|df2vtt|uvtt)$/i.test(f.name)) return false;
  if (/\.[a-z0-9]{1,5}$/i.test(f.name) && !/\.json$/i.test(f.name)) return false;
  let head: string;
  try {
    head = await f.slice(0, SNIFF_BYTES).text();
  } catch {
    return false;
  }
  const text = head.replace(/^﻿/, "").trimStart();
  return /^\{\s*"header"\s*:/.test(text) && /"creation_build"|"world"\s*:/.test(text);
}

/**
 * A project file's map size in squares, from the start of the file ("world": width and height
 * follow the header), or null when it can't be found that way (the attach worker parses it all)
 * or isn't a size the parser would accept (1 to MAX_MAP_SIDE squares a side).
 */
export async function dungeondraftSquares(f: File): Promise<{ w: number; h: number } | null> {
  let text: string;
  try {
    text = await f.slice(0, SIZE_SNIFF_BYTES).text();
  } catch {
    return null;
  }
  const world = /"world"\s*:\s*\{([^{}]*)/.exec(text);
  if (!world) return null;
  const w = /"width"\s*:\s*(\d+)/.exec(world[1]);
  const h = /"height"\s*:\s*(\d+)/.exec(world[1]);
  if (!w || !h) return null;
  const size = { w: Number(w[1]), h: Number(h[1]) };
  const sane = (n: number) => Number.isInteger(n) && n > 0 && n <= MAX_MAP_SIDE;
  return sane(size.w) && sane(size.h) ? size : null;
}

/**
 * Whether a picture could be an export of a map of `squares` squares (design 2.1, pairing rule 3):
 * with its export's rectangle (a .dd2vtt's map_size, or the scene's mapRect), when that fits inside
 * the map; else when the picture's shape is the whole map's, within 2 px (alignPlainImage's rule).
 */
export function pictureFitsMap(
  picture: { width: number; height: number },
  squares: { w: number; h: number },
  rect?: readonly [number, number, number, number] | null,
): boolean {
  if (rect) return rect[2] > 0 && rect[3] > 0 && rect[2] <= squares.w && rect[3] <= squares.h;
  const { width, height } = picture;
  if (!(width > 0 && height > 0)) return false;
  return Math.abs((width / squares.w) * squares.h - height) <= 2 && Math.abs((height / squares.h) * squares.w - width) <= 2;
}

/**
 * Whether a dropped or pasted image is more likely a map than a token: tokens are
 * rarely more than about 1000 px across, battle maps rarely less than 1600.
 */
export async function looksLikeMap(f: File): Promise<boolean> {
  if (isVttFile(f) || OWLBEAR_EXT.test(f.name) || (await isDungeondraftFile(f))) return true;
  const size = await imageSize(f);
  return size !== null && Math.max(size.width, size.height) >= 1600;
}

/**
 * Image sizes already read, by file: decoding is the whole picture's work, and a dropped
 * picture is measured by sortDroppedFiles, then by pairing for each project file left over.
 */
const imageSizes = new WeakMap<File, Promise<{ width: number; height: number } | null>>();

/** An image file's size, or null when the browser can't read it (or it isn't an image). */
function imageSize(f: File): Promise<{ width: number; height: number } | null> {
  if (!f.type.startsWith("image/")) return Promise.resolve(null);
  let size = imageSizes.get(f);
  if (!size) {
    size = Promise.resolve()
      .then(() => createImageBitmap(f))
      .then(
      (bmp) => {
        const out = { width: bmp.width, height: bmp.height };
        bmp.close();
        return out;
      },
      () => null,
    );
    imageSizes.set(f, size);
  }
  return size;
}

/** Files' text read once per batch (a .dd2vtt is read for its map_size by pairing, then whole by readMapFiles). */
type TextCache = Map<File, Promise<string>>;

function readText(f: File, texts: TextCache): Promise<string> {
  let text = texts.get(f);
  if (!text) {
    text = f.text();
    texts.set(f, text);
  }
  return text;
}

// ---------------------------------------------------------------- dropped files

/** Where the files dropped or pasted on the board go (sortDroppedFiles). */
export interface SortedDrop {
  /** Map files, for the New scene window (store.mapImport). */
  maps: File[];
  /** Images that become tokens where they landed. */
  tokens: File[];
  /** A player dropped map files: "Only the GM can add maps." */
  refused: boolean;
  /** A Dungeondraft project file dropped with no picture or other map file: the attach dialog, or the New scene window as pending. */
  lone: File | null;
}

/**
 * Sorts the files dropped or pasted on the board (design 2.1 A). For the GM, map files and big
 * images start new scenes and other images become tokens; but when a Dungeondraft project file is
 * among them, every image and Universal VTT file goes with it (a 1400 px export would otherwise
 * become a giant token), and one dropped with no other map or picture (a stray text file doesn't
 * count) is a `lone` file. Players can only add tokens.
 */
export async function sortDroppedFiles(files: File[], isGm: boolean): Promise<SortedDrop> {
  const out: SortedDrop = { maps: [], tokens: [], refused: false, lone: null };
  const dd: File[] = [];
  for (const f of files) if (await isDungeondraftFile(f)) dd.push(f);
  const isMapFile = (f: File) => dd.includes(f) || isVttFile(f) || OWLBEAR_EXT.test(f.name);
  if (!isGm) {
    for (const f of files) {
      if (isMapFile(f)) out.refused = true;
      else if (f.type.startsWith("image/")) out.tokens.push(f);
    }
    return out;
  }
  if (dd.length) {
    const mapLike = files.filter((f) => isMapFile(f) || f.type.startsWith("image/"));
    if (mapLike.length === 1) out.lone = dd[0];
    else out.maps = mapLike;
    return out;
  }
  for (const f of files) {
    if (await looksLikeMap(f)) out.maps.push(f);
    else if (f.type.startsWith("image/")) out.tokens.push(f);
  }
  return out;
}

// ---------------------------------------------------------------- pairing project files

/** A Dungeondraft project file and the picture exported from it (an image or a .dd2vtt). */
export interface DungeondraftPair {
  picture: File;
  dd: File;
}

export interface DungeondraftPairs {
  pairs: DungeondraftPair[];
  /** Project files with no picture in the batch: for the New scene window to hold as pending, or to report. */
  lone: File[];
  /** Pictures and Universal VTT files left without a project file. */
  pictures: File[];
}

/**
 * Pairs each Dungeondraft project file in a batch with a picture from the same batch
 * (design 2.1), trying in order: the same base name (case-insensitive, export suffixes
 * such as "_export", " - Ground", "(1)" and "_50x35" stripped), where a map exported level
 * by level pairs with every level's picture (one scene per level, 6.5); the only picture,
 * when there's one project file; the one whose size fits (a .dd2vtt whose map_size fits
 * inside the map, or an image whose shape is the map's within 2 px). When several fit, or
 * none, the project file stays `lone`.
 */
export function pairDungeondraft(files: File[]): Promise<DungeondraftPairs> {
  return pairFiles(files, new Map());
}

async function pairFiles(files: File[], texts: TextCache): Promise<DungeondraftPairs> {
  const dds: File[] = [];
  const pictures: File[] = [];
  for (const f of files) {
    if (await isDungeondraftFile(f)) dds.push(f);
    else if (isVttFile(f) || f.type.startsWith("image/")) pictures.push(f);
  }
  const pairs: DungeondraftPair[] = [];
  const lone: File[] = [];
  if (!dds.length) return { pairs, lone, pictures };
  const free = new Set(pictures);
  const take = (dd: File, picture: File) => {
    pairs.push({ picture, dd });
    free.delete(picture);
  };

  // 1. The same name. Pictures named for different levels ("Tavern - Ground", "Tavern - Roof") are
  // each taken, one scene per level. Pictures named alike ("Tavern.png" and "Tavern.dd2vtt") show
  // the same picture: when one of them is a .dd2vtt, it alone is taken, since it says which level
  // it shows; the PNGs stay plain pictures.
  const waiting: File[] = [];
  for (const dd of dds) {
    const key = exportKey(dd.name);
    const same = new Map<string, File[]>();
    for (const p of free) {
      if (!pictureKeys(p.name).includes(key)) continue;
      const own = exportKey(p.name);
      same.set(own, [...(same.get(own) ?? []), p]);
    }
    if (!same.size) {
      waiting.push(dd);
      continue;
    }
    for (const group of same.values()) {
      const vtts = group.filter(isVttFile);
      for (const p of vtts.length ? vtts : group) take(dd, p);
    }
  }
  // 2. The only picture, for the only project file left.
  if (waiting.length === 1 && free.size === 1) take(waiting[0], [...free][0]);
  else {
    // 3. By size, when exactly one picture fits. Each picture is measured once, however many files are waiting.
    const measured = new Map<File, Promise<Measured>>();
    const measure = (p: File) => measured.get(p) ?? measured.set(p, measurePicture(p, texts)).get(p)!;
    for (const dd of waiting) {
      const squares = free.size ? await dungeondraftSquares(dd) : null;
      if (!squares) {
        lone.push(dd);
        continue;
      }
      const fits: File[] = [];
      for (const p of free) if (measuredFits(await measure(p), squares)) fits.push(p);
      if (fits.length === 1) take(dd, fits[0]);
      else lone.push(dd);
    }
  }
  return { pairs, lone, pictures: [...free] };
}

/** What pairing rule 3 measures a picture file by: an image's size, or a .dd2vtt's map_size; null when it can't be read. */
type Measured = { size: { width: number; height: number } } | { rect: [number, number, number, number] } | null;

async function measurePicture(p: File, texts: TextCache): Promise<Measured> {
  if (isVttFile(p)) {
    try {
      const data = JSON.parse((await readText(p, texts)).replace(/^﻿/, "")) as { resolution?: { map_size?: { x?: unknown; y?: unknown } } };
      const s = data?.resolution?.map_size;
      return s && finite(s.x) && finite(s.y) ? { rect: [0, 0, s.x, s.y] } : null;
    } catch {
      return null;
    }
  }
  const size = await imageSize(p);
  return size && { size };
}

/** Whether a measured picture could be an export of a map of these squares. */
function measuredFits(m: Measured, squares: { w: number; h: number }): boolean {
  if (!m) return false;
  return "rect" in m ? pictureFitsMap({ width: 0, height: 0 }, squares, m.rect) : pictureFitsMap(m.size, squares);
}

/** A file's name without its extension, lower-case, with export suffixes stripped. */
function exportKey(fileName: string): string {
  let key = fileName.replace(/\.[a-z0-9_]+$/i, "").toLowerCase().trim();
  for (let again = true; again; ) {
    const before = key;
    key = key
      .replace(/\s*\(\d+\)$/, "")
      .replace(/[ _-]*export$/, "")
      .replace(/[ _-]+\d{1,3}\s*[x×]\s*\d{1,3}$/, "")
      .replace(/\.vtt$/, "")
      .trim();
    again = key !== before;
  }
  return key;
}

/** The keys a picture's name may match a project file by: as it is, and without a trailing level name (" - Ground", "_Ground"). */
function pictureKeys(fileName: string): string[] {
  const key = exportKey(fileName);
  const keys = [key];
  const level = /^(.*\S)(?:\s+-\s+|_)[a-z0-9]+$/.exec(key);
  if (level) keys.push(level[1].trim());
  return keys;
}

// ---------------------------------------------------------------- file names

export interface NameHint {
  cols?: number;
  rows?: number;
  pxPerCell?: number;
}

/**
 * Grid size from a file name, the way map makers label them: "Tavern_30x20.jpg",
 * "Crypt [22x30].png", "forest (35 x 25) 140ppi.webp", "cave-70px.png". Numbers
 * above 200 are image sizes ("4096x2048"), not cells, and are ignored. With the
 * image's size, "20x30" on a wide image is read as 30 across, 20 down.
 */
export function gridFromName(fileName: string, width?: number, height?: number): NameHint {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const hint: NameHint = {};
  const ppi = /(?:^|[^a-z0-9])(\d{2,3})\s*[-_ ]?\s*(?:ppi|dpi|px|ppg|pxpg)(?![a-z])/i.exec(base);
  if (ppi) {
    const n = Number(ppi[1]);
    if (n >= 10 && n <= 600) hint.pxPerCell = n;
  }
  const re = /(?:^|[^0-9.])(\d{1,3})\s*[x×]\s*(\d{1,3})(?![0-9])/gi;
  for (let m = re.exec(base); m; m = re.exec(base)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a < 2 || b < 2 || a > 200 || b > 200) continue;
    let [cols, rows] = [a, b];
    if (width && height) {
      // Square cells: whichever order makes them squarest.
      const off = (c: number, r: number) => Math.abs(Math.log(width / c / (height / r)));
      if (off(b, a) < off(a, b)) [cols, rows] = [b, a];
    }
    hint.cols = cols;
    hint.rows = rows;
    break;
  }
  return hint;
}

/** A readable scene name from a file name: "Goblin_Cave_30x20_gridless.jpg" -> "Goblin Cave". */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const clean = base
    .replace(/_+/g, " ")
    .replace(/[[(]?\b\d{1,5}\s*[x×]\s*\d{1,5}\b[\])]?/gi, " ")
    .replace(/\b\d{2,3}\s*(?:ppi|dpi|px|ppg|pxpg)\b/gi, " ")
    .replace(/\b(?:gridless|gridded|no[\s-]?grid|with[\s-]?grid|grid)\b/gi, " ")
    .replace(/\s+-\s+|\s*-\s*$|^\s*-\s*/g, " ")
    .replace(/[[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || base).slice(0, 60);
}

// ---------------------------------------------------------------- Universal VTT

function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

type Pos = { x?: unknown; y?: unknown };
const isPos = (p: unknown): p is { x: number; y: number } =>
  typeof p === "object" && p !== null && finite((p as Pos).x) && finite((p as Pos).y);

/**
 * What the attach worker needs of a Universal VTT file (extract.ts VttMeta): the whole
 * origin and size, and the portal, light and line-of-sight positions that tell which level
 * the picture shows, at most VTT_META_POINTS in all (the rest are dropped). Positions stay in
 * squares, as the file has them.
 */
function vttMetaOf(data: Record<string, unknown>, origin: { x: number; y: number }, size: { x: number; y: number }, ppg: number): VttMeta {
  let left = VTT_META_POINTS;
  const positions = (v: unknown) => {
    const out: Array<{ position: { x: number; y: number } }> = [];
    if (Array.isArray(v)) {
      for (const e of v) {
        if (left <= 0) break;
        const p = (e as { position?: unknown } | null)?.position;
        if (isPos(p)) {
          out.push({ position: { x: p.x, y: p.y } });
          left--;
        }
      }
    }
    return out;
  };
  const portals = positions(data.portals);
  const lights = positions(data.lights);
  const line_of_sight: Array<Array<{ x: number; y: number }>> = [];
  if (Array.isArray(data.line_of_sight)) {
    for (const line of data.line_of_sight) {
      if (!Array.isArray(line) || left <= 0) continue;
      const pts: Array<{ x: number; y: number }> = [];
      for (const p of line) {
        if (left <= 0) break;
        if (isPos(p)) {
          pts.push({ x: p.x, y: p.y });
          left--;
        }
      }
      if (pts.length) line_of_sight.push(pts);
    }
  }
  return { resolution: { map_origin: origin, map_size: size, pixels_per_grid: ppg }, portals, lights, line_of_sight };
}

/** Reads a Universal VTT file (.dd2vtt, .df2vtt, .uvtt). */
export function parseUniversalVtt(text: string, fileName: string): MapFile {
  let data: Record<string, unknown>;
  try {
    // Real files vary: CRLF line ends, a byte-order mark, format 0.2, 0.3 or 1.0 (or a
    // "version" string instead). None of that matters here, so none of it is checked.
    data = JSON.parse(text.replace(/^﻿/, "")) as Record<string, unknown>;
  } catch {
    throw new Error("isn't a map file this app can read.");
  }
  const res = data?.resolution as { map_origin?: { x?: unknown; y?: unknown }; map_size?: { x?: unknown; y?: unknown }; pixels_per_grid?: unknown } | undefined;
  if (typeof data?.image !== "string" || !res) throw new Error("isn't a Universal VTT map (no image or grid in it).");
  let bytes: Uint8Array;
  try {
    bytes = base64Bytes(data.image);
  } catch {
    throw new Error("has a map image that couldn't be read.");
  }
  // PNG unless the bytes say otherwise (the browser refuses it later if it isn't an image at all).
  const type = sniffImageType(bytes) ?? "image/png";
  const ppg = finite(res.pixels_per_grid) && res.pixels_per_grid > 0 ? res.pixels_per_grid : undefined;
  const cols = finite(res.map_size?.x) && res.map_size.x > 0 ? res.map_size.x : undefined;
  const rows = finite(res.map_size?.y) && res.map_size.y > 0 ? res.map_size.y : undefined;
  const originX = finite(res.map_origin?.x) ? res.map_origin.x : 0;
  const originY = finite(res.map_origin?.y) ? res.map_origin.y : 0;
  // Dungeondraft 1.2 names an export "waterfall.vtt.dd2vtt": the ".vtt" is part of the extension, not the name.
  const name = nameFromFile(fileName.replace(/\.vtt(\.[a-z0-9]+)$/i, "$1"));
  const ext = type.split("/")[1];
  const image = new File([bytes as BlobPart], `${name}.${ext === "jpeg" ? "jpg" : ext}`, { type });
  return {
    name,
    image,
    cols,
    rows,
    pxPerCell: ppg,
    width: ppg && cols ? ppg * cols : undefined,
    height: ppg && rows ? ppg * rows : undefined,
    // The origin is in cells; only its fraction of a cell moves the grid lines.
    offsetX: ppg ? (((-originX % 1) + 1) % 1) * ppg : undefined,
    offsetY: ppg ? (((-originY % 1) + 1) % 1) * ppg : undefined,
    // The whole of the grid, and the level clues, for a Dungeondraft project file.
    ...(ppg && cols && rows ? { vtt: vttMetaOf(data, { x: originX, y: originY }, { x: cols, y: rows }, ppg) } : {}),
  };
}

// ---------------------------------------------------------------- everything together

/** What a Dungeondraft project file with no picture in the batch is told (design 6.1). */
export function loneProjectFileNote(fileName: string): string {
  return `${fileName} has no picture in it (it's Dungeondraft's project file). Export the map from Dungeondraft and bring in both files, or attach it to a scene with Edit scene › Map.`;
}

/**
 * Reads the chosen files into maps, with a readable reason for any that can't be used.
 * A Dungeondraft project file goes with the picture it pairs with (MapFile.dd); one with no
 * picture in the batch is reported.
 */
export async function readMapFiles(files: File[]): Promise<{ maps: MapFile[]; errors: string[] }> {
  const maps: MapFile[] = [];
  const errors: string[] = [];
  // Pairing may read a .dd2vtt for its map_size; the same text is parsed below.
  const texts: TextCache = new Map();
  const { pairs, lone } = await pairFiles(files, texts);
  const ddOf = new Map(pairs.map((p) => [p.picture, p.dd]));
  const projectFiles = new Set([...pairs.map((p) => p.dd), ...lone]);
  for (const f of files) {
    try {
      if (projectFiles.has(f)) {
        if (lone.includes(f)) errors.push(loneProjectFileNote(f.name));
      } else if (isVttFile(f)) {
        const map = parseUniversalVtt(await readText(f, texts), f.name);
        const dd = ddOf.get(f);
        maps.push(dd ? { ...map, dd } : map);
      } else if (/\.owlbear$/i.test(f.name)) {
        // Owlbear Rodeo 1's own format. Owlbear's converter turns it into a 2.0 backup, which comes in here.
        errors.push(
          `${f.name} is from the old Owlbear Rodeo 1. Convert it at 1to2.owlbear.app, then bring in the .ob2 file it makes.`,
        );
      } else if (f.type.startsWith("image/")) {
        const dd = ddOf.get(f);
        maps.push({ name: nameFromFile(f.name), image: f, ...gridFromName(f.name), ...(dd ? { dd } : {}) });
      } else {
        errors.push(`${f.name} isn't an image or a map file.`);
      }
    } catch (err) {
      errors.push(`${f.name} ${(err as Error).message}`);
    }
  }
  return { maps, errors };
}

/**
 * The grid size in pixels on the uploaded image (which may have been shrunk from the
 * original), or null when nothing says what it should be.
 */
export function gridSizeFor(map: MapFile, width: number, height: number, original?: { width: number; height: number }): number | null {
  const ow = map.width ?? original?.width;
  const oh = map.height ?? original?.height;
  let { cols, rows, pxPerCell } = map;
  // Hints from a file name (not from a map file) are only believed when they fit the
  // image: cells square to within 3%, either way round, and a sensible number of them.
  const fromName = !map.width;
  if (fromName && cols && rows && ow && oh) {
    const off = (c: number, r: number) => Math.abs(ow / c - oh / r) / Math.max(ow / c, oh / r);
    if (off(cols, rows) > 0.03) {
      if (off(rows, cols) <= 0.03) [cols, rows] = [rows, cols];
      else cols = rows = undefined;
    }
  }
  if (fromName && pxPerCell && ow && (ow / pxPerCell < 3 || ow / pxPerCell > 200)) pxPerCell = undefined;
  // Cells across (measured on the image as it is now) is the surest; pixels per cell next.
  let size: number | null = null;
  if (cols) size = width / cols;
  else if (rows) size = height / rows;
  else if (pxPerCell) size = ow ? pxPerCell * (width / ow) : pxPerCell;
  if (!size || !Number.isFinite(size) || size < 4) return null;
  return Math.round(size * 1000) / 1000;
}

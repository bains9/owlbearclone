// Reading map files for new scenes: plain images, and battle maps exported with
// their grid (the Universal VTT format written by Dungeondraft, DungeonFog, Dungeon
// Alchemist and others: .dd2vtt, .df2vtt, .uvtt).
//
// Everything here runs in the browser. The map image goes on to the normal upload,
// which may shrink it, so grid sizes are worked out afterwards from the final size.

import type { GridType } from "../shared/types";

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
}

/** What the file picker offers. */
export const MAP_FILE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/avif,.dd2vtt,.df2vtt,.uvtt,.json,.ob2,.owlbear";

const VTT_EXT = /\.(dd2vtt|df2vtt|uvtt|json)$/i;

export function isVttFile(f: File): boolean {
  return VTT_EXT.test(f.name);
}

/**
 * Whether a dropped or pasted image is more likely a map than a token: tokens are
 * rarely more than about 1000 px across, battle maps rarely less than 1600.
 */
export async function looksLikeMap(f: File): Promise<boolean> {
  if (isVttFile(f) || /\.(ob2|owlbear)$/i.test(f.name)) return true;
  if (!f.type.startsWith("image/")) return false;
  try {
    const bmp = await createImageBitmap(f);
    const long = Math.max(bmp.width, bmp.height);
    bmp.close();
    return long >= 1600;
  } catch {
    return false;
  }
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
  const name = nameFromFile(fileName);
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
  };
}

// ---------------------------------------------------------------- everything together

/** Reads the chosen files into maps, with a readable reason for any that can't be used. */
export async function readMapFiles(files: File[]): Promise<{ maps: MapFile[]; errors: string[] }> {
  const maps: MapFile[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      if (isVttFile(f)) {
        maps.push(parseUniversalVtt(await f.text(), f.name));
      } else if (/\.owlbear$/i.test(f.name)) {
        // Owlbear Rodeo 1's own format. Owlbear's converter turns it into a 2.0 backup, which comes in here.
        errors.push(
          `${f.name} is from the old Owlbear Rodeo 1. Convert it at 1to2.owlbear.app, then bring in the .ob2 file it makes.`,
        );
      } else if (f.type.startsWith("image/")) {
        maps.push({ name: nameFromFile(f.name), image: f, ...gridFromName(f.name) });
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

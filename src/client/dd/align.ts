// How an exported picture lines up with the map's world coordinates.
//
//   Universal VTT (.dd2vtt):
//     image is map_size * pixels_per_grid pixels; its top-left is at map_origin (squares).
//     pixel (u, v) centre  <->  world ((map_origin.x + (u + 0.5) / ppg) * 256, (map_origin.y + (v + 0.5) / ppg) * 256)
//     line_of_sight / portals / lights are in WORLD squares (NOT shifted by a crop origin).
//   PNG / JPEG / WEBP export:
//     no metadata; uncropped it is exactly width*ppi x height*ppi, origin (0, 0).
//     A cropped export cannot be placed from its size alone.
//   Neither records which LEVEL was exported (Source Level), nor whether an Overlay Level was mixed in.

import { GRID } from "./model";
import type { DDMap, Level } from "./model";
import type { RasterSpec } from "./ddRaster";
import { portalSegment } from "./geometry";

export interface Dd2vttResolution {
  map_origin?: { x?: unknown; y?: unknown };
  map_size?: { x?: unknown; y?: unknown };
  pixels_per_grid?: unknown;
}

export interface Alignment {
  spec: RasterSpec;
  /** Pixels per square in the picture as given. */
  ppg: number;
  /** Crop origin in squares. */
  origin: { x: number; y: number };
  /** Picture size in squares. */
  size: { x: number; y: number };
  /** True when the picture covers the whole map. */
  fullMap: boolean;
  notes: string[];
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * @param imageW,imageH the picture's size as stored (Tabletop may have shrunk the upload;
 *   pass the size you will sample, and the spec scales to it).
 */
export function alignDd2vtt(res: Dd2vttResolution, imageW: number, imageH: number, map?: DDMap): Alignment | null {
  const ppg = res.pixels_per_grid;
  const ox = res.map_origin?.x ?? 0, oy = res.map_origin?.y ?? 0;
  const sx = res.map_size?.x, sy = res.map_size?.y;
  if (!fin(ppg) || ppg <= 0 || !fin(ox) || !fin(oy) || !fin(sx) || !fin(sy) || sx <= 0 || sy <= 0) return null;
  if (!(imageW > 0 && imageH > 0)) return null;
  const notes: string[] = [];
  // The picture may have been rescaled after export; derive the scale from its actual size.
  const kx = imageW / (sx * ppg), ky = imageH / (sy * ppg);
  if (Math.abs(kx - ky) > 0.01 * Math.max(kx, ky)) notes.push(`picture aspect ${imageW}x${imageH} differs from map_size ${sx}x${sy}`);
  if (Math.abs(kx - 1) > 1e-6) notes.push(`picture is ${kx.toFixed(4)}x the exported size`);
  const pxPerSquare = ppg * kx;
  let fullMap = ox === 0 && oy === 0;
  if (map) {
    fullMap = fullMap && Math.abs(sx - map.world.width) < 1e-6 && Math.abs(sy - map.world.height) < 1e-6;
    if (ox < 0 || oy < 0 || ox + sx > map.world.width + 1e-6 || oy + sy > map.world.height + 1e-6) notes.push("crop reaches outside the map");
    if (!fullMap) notes.push(`cropped export: origin (${ox}, ${oy}) squares, ${sx}x${sy} of ${map.world.width}x${map.world.height}`);
  }
  return {
    spec: { width: imageW, height: imageH, originX: ox * GRID, originY: oy * GRID, unitsPerPx: GRID / pxPerSquare },
    ppg,
    origin: { x: ox, y: oy },
    size: { x: sx, y: sy },
    fullMap,
    notes,
  };
}

/**
 * A plain picture export. Accepts it only when its aspect ratio matches the whole map
 * (Dungeondraft exports exactly width*ppi x height*ppi when not cropped). `tolerancePx`
 * allows for a resize by Tabletop's upload path.
 */
export function alignPlainImage(map: DDMap, imageW: number, imageH: number, tolerancePx = 2): Alignment | null {
  const W = map.world.width, H = map.world.height;
  if (!(imageW > 0 && imageH > 0)) return null;
  const px = imageW / W, py = imageH / H;
  if (Math.abs(px * H - imageH) > tolerancePx || Math.abs(py * W - imageW) > tolerancePx) return null;
  const ppg = (px + py) / 2;
  const notes: string[] = [];
  if (Math.abs(ppg - Math.round(ppg)) > 1e-6) notes.push(`non-integer ${ppg.toFixed(3)} px per square: picture was probably resized after export`);
  return {
    spec: { width: imageW, height: imageH, originX: 0, originY: 0, unitsPerPx: GRID / ppg },
    ppg,
    origin: { x: 0, y: 0 },
    size: { x: W, y: H },
    fullMap: true,
    notes,
  };
}

export interface Dd2vttData {
  line_of_sight?: unknown;
  portals?: unknown;
  lights?: unknown;
}

export interface LevelMatch {
  level: Level;
  /** 0..1: share of the export's portals/lights/wall points that this level explains. */
  score: number;
  checked: number;
}

type Pt = { x: number; y: number };

/** Most export points read per kind (portals, lights, line-of-sight vertices): .dd2vtt files come from anywhere. */
export const MAX_VTT_POINTS = 200_000;
/** Export points further than this from the origin (squares, per axis) are ignored: no map is that big. */
export const MAX_VTT_COORD = 1e6;
/**
 * Most map points matchDd2vttLevel reads in all its searches (about a tenth of a second). A real
 * map reads a few per export point; a file with very many points in one place could make every
 * search read all of them, so past this the export is no help and every level scores 0.
 */
export const MATCH_WORK = 50_000_000;

/**
 * Points bucketed in square cells of side `tol`: every point within `tol` (per axis) of a query
 * lies in the query's cell or one of its 8 neighbours, so `near` gives exactly the brute-force
 * answer and costs only the few points of 9 cells. Cell indices are floats and can pass 2^53 for
 * far-out coordinates, where `index + 1 === index`: the neighbours are visited by whole-number
 * offsets so the loops always end (such cells may then be visited twice, which is harmless).
 * That is O(n + m) only while the points are spread out: `work` counts the points the searches
 * read, so a caller can stop when many of them crowd one cell (pass one counter to several hashes).
 * Exported for tests.
 */
export class PointHash {
  private readonly cells = new Map<number, Map<number, number[]>>();
  private readonly tol: number;
  private readonly cell: number;
  readonly work: { read: number };
  constructor(tol: number, work: { read: number } = { read: 0 }) {
    this.tol = tol;
    this.cell = tol > 1e-9 ? tol : 1e-9;
    this.work = work;
  }
  add(x: number, y: number): void {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let col = this.cells.get(cx);
    if (!col) this.cells.set(cx, (col = new Map()));
    const list = col.get(cy);
    if (list) list.push(x, y);
    else col.set(cy, [x, y]);
  }
  near(q: Pt): boolean {
    const cx = Math.floor(q.x / this.cell), cy = Math.floor(q.y / this.cell);
    for (let di = -1; di <= 1; di++) {
      const col = this.cells.get(cx + di);
      if (!col) continue;
      for (let dj = -1; dj <= 1; dj++) {
        const list = col.get(cy + dj);
        if (!list) continue;
        this.work.read += list.length >> 1;
        for (let k = 0; k < list.length; k += 2) {
          if (Math.abs(list[k] - q.x) <= this.tol && Math.abs(list[k + 1] - q.y) <= this.tol) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Which level a .dd2vtt was exported from. Compares the export's portals, lights and
 * line-of-sight vertices (world squares) with each level's. Levels with no walls/portals/lights
 * cannot be told apart this way (score 0, checked 0): fall back to header.currentLevel or ask the GM.
 * O(n + m): each level's points go into a spatial hash with cell = `tol`. Searches that read more
 * than `work` map points in all (MATCH_WORK: points crowded into a few cells) give every level
 * score 0 and checked 0, as an export with no clues would.
 */
export function matchDd2vttLevel(map: DDMap, d: Dd2vttData, tol = 0.05, work = MATCH_WORK): LevelMatch[] {
  const pts = (v: unknown[], out: Pt[], budget: number): void => {
    for (let i = 0; i < v.length && out.length < budget; i++) {
      const p = v[i];
      if (p && typeof p === "object" && fin((p as { x?: unknown }).x) && fin((p as { y?: unknown }).y)) {
        const { x, y } = p as Pt;
        if (Math.abs(x) <= MAX_VTT_COORD && Math.abs(y) <= MAX_VTT_COORD) out.push({ x, y });
      }
    }
  };
  const positions = (v: unknown): unknown[] =>
    Array.isArray(v) ? v.slice(0, 20000).map((p: unknown) => (p && typeof p === "object" ? (p as { position?: unknown }).position : undefined)) : [];
  const exPortals: Pt[] = [], exLights: Pt[] = [], exLos: Pt[] = [];
  pts(positions(d.portals), exPortals, MAX_VTT_POINTS);
  pts(positions(d.lights), exLights, MAX_VTT_POINTS);
  if (Array.isArray(d.line_of_sight)) {
    for (const line of d.line_of_sight.slice(0, 5000)) if (Array.isArray(line)) pts(line.slice(0, 20000), exLos, MAX_VTT_POINTS);
  }

  const results: LevelMatch[] = [];
  const spent = { read: 0 };
  const noClues = () => map.world.levels.map((level): LevelMatch => ({ level, score: 0, checked: 0 }));
  for (const L of map.world.levels) {
    const portals = new PointHash(tol, spent), lights = new PointHash(tol, spent), wallPts = new PointHash(tol, spent);
    for (const w of L.walls) for (const p of w.portals) portals.add(p.position.x / GRID, p.position.y / GRID);
    for (const p of L.portals) portals.add(p.position.x / GRID, p.position.y / GRID);
    for (const l of L.lights) lights.add(l.position.x / GRID, l.position.y / GRID);
    for (const w of L.walls) {
      for (let i = 0; i < w.points.length; i += 2) wallPts.add(w.points[i] / GRID, w.points[i + 1] / GRID);
      for (const p of w.portals) {
        const [a, b] = portalSegment(p);
        wallPts.add(a.x / GRID, a.y / GRID);
        wallPts.add(b.x / GRID, b.y / GRID);
      }
    }
    let hit = 0, checked = 0;
    for (const q of exPortals) { checked++; if (portals.near(q)) hit++; if (spent.read > work) return noClues(); }
    for (const q of exLights) { checked++; if (lights.near(q)) hit++; if (spent.read > work) return noClues(); }
    // LOS also carries cave outlines and block-light paths, so only count it as supporting evidence.
    let losHit = 0;
    for (const q of exLos) { if (wallPts.near(q)) losHit++; if (spent.read > work) return noClues(); }
    const losScore = exLos.length ? losHit / exLos.length : 0;
    const score = checked ? (hit / checked) * 0.7 + losScore * 0.3 : losScore;
    results.push({ level: L, score, checked: checked + exLos.length });
  }
  return results.sort((a, b) => b.score - a.score);
}

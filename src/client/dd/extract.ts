// Compiling one level of a parsed Dungeondraft map into a season sidecar, lined up with the
// picture the scene uses (design 2.2 to 2.7). Pure (no DOM): it runs in the GM's dd worker.
//
// It covers the picture's rectangle (2.3), ranking the levels (2.2), cropping to the rectangle
// plus one square, the transforms to world shapes, patterns and wall loops, drawn path widths,
// water bodies by what the picture shows (2.6), the pack share, and the measured footprints
// (measure.ts). Nothing it stores names a pack, a structure, a level or the source file.
//
// What goes where (3.3, 4.1):
// - TERR: the terrain slots with weight in the crop (the rectangle plus a square, plus a texel),
//   4 texels a square (2 when the map's long side is over 256 squares; halved again while the
//   planes would pass 6 MiB), box-averaged from the saved 4. A default slot keeps its short name.
//   Texels whose weights sum to under 250 (older maps save 150-250) are scaled to sum to 255,
//   taken as shares of their sum [L: how Dungeondraft draws them isn't documented]; those with
//   next to no weight (a mod's slot that couldn't be read) are left as they are, and the GM told.
// - BITS: the cave floor (step 64) and a 0.35-square CAVE_RIM band outside it (step 32, not where
//   the cave is blasted open), and each material (step 128) by materialRole.
// - SHAP: each water body (even-odd over the body and everything inside it, one shape a body so
//   each carries its own WATER, ICE or KEEP); building floors (the floor polygons where tiles are,
//   and tiled cells without a polygon); patterns at their own layer; wall-loop interiors; every
//   wall as a ribbon half a wall (32) wide each side; each roof; each path's ribbon (the drawn width,
//   pathDrawn, of default trails and roads; the whole ribbon of PATH_KEEP). Every ring is clipped
//   to the crop. Ribbons are unions (non-zero) of a quad a segment and a joint where it turns.
// - OBJS: every object whose footprint reaches into the crop and that the picture doesn't show to
//   be gone, with its measured reach; natural objects (NAMED_ROLES) keep their default name.
//
// Wall loops (4.1): a wall with `loop`, or a chain of walls whose ends meet within a quarter
// square (cave walls left out), encloses an interior. One of up to 36 square squares is a room:
// entirely FLOOR, and the paving patterns lying mostly inside it are its floor (FLOOR). A bigger
// one is FLOOR only where its floor-like things are (FLOOR patterns, tiles, materials and floor
// polygons, which are FLOOR themselves): a walled yard or town keeps its terrain, and its streets
// stay PAVED.
//
// Shifts: FitResult.best is the correction added to object centres (fit.ts), so lining the data up
// that way moves the picture's rectangle by -best squares. AttachReport.shifted is that correction:
// x < 0 means the map seems to have grown -x squares on the left since the export (y < 0: at the top).

import { GRID, MS_EDGE_BUFFER, type BitGrid, type DDMap, type Level, type MapObject, type WaterNode } from "./model";
import { MEASURE, measureObjects, measureSummary, priorReach, type Measured, type SpriteSizes } from "./measure";
import {
  DD_LAYER, NO_NAME, OBJ_FLAG, REACH_N, SIDECAR_CAPS, SIDECAR_UNITS, SidecarError, encodeSidecar,
  type BitmapLayer, type ObjectTable, type SeasonSidecar, type ShapeLayer, type TerrainGrid,
} from "./sidecar";
import {
  AR, NAMED_ROLES, OR, TR, defaultName, materialRole, objectRole, pathDrawn, pathRole, patternRole, roofRole, terrainRole,
  type AreaRole, type ObjectRole, type TerrainRole,
} from "./roles";
import { REACH_DIRS, rasterSidecar } from "./raster";
import { alignPlainImage, matchDd2vttLevel } from "./align";
import { patternPolygon, pathRibbon, roofPolygon, wallRibbon, type Ribbon } from "./geometry";
import { fillEllipse, fillPolygons, waterDepth, workBudget, type RasterSpec } from "./ddRaster";
import { levelCentres, levelRadii, objectFit } from "./fit";
import { colourTable, lutIndex } from "../room/seasonPixels";

/** Bumped with every geometry change; stored in each sidecar (roles are re-derived at run time instead). */
export const EXTRACTOR_VERSION = 2;

/** Most portal, light and line-of-sight points a VttMeta keeps, in all. */
export const VTT_META_POINTS = 20_000;

/**
 * What a .dd2vtt says about where its picture lies and which level it shows, kept by
 * parseUniversalVtt (mapImport.ts). The fields keep the file's own names and shapes, so
 * `resolution` goes to alignDd2vtt and the whole object to matchDd2vttLevel as they are.
 * Positions are in squares; at most VTT_META_POINTS points in all.
 */
export interface VttMeta {
  resolution: {
    map_origin: { x: number; y: number };
    map_size: { x: number; y: number };
    pixels_per_grid: number;
  };
  portals: Array<{ position: { x: number; y: number } }>;
  lights: Array<{ position: { x: number; y: number } }>;
  line_of_sight: Array<Array<{ x: number; y: number }>>;
}

/** The picture's rectangle in world units, [x0, y0, x1, y1] (pixel centres as in raster.ts). */
export interface PictureRect {
  rect: [number, number, number, number];
}

/** The picture's pixels, at 24-32 px a square and at most 2048 px (4096 on big desktops) on the long side. */
export interface PictureSample {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
}

/** The object-centre fit (fit.ts, design 2.4). */
export interface FitResult {
  verdict: "yes" | "unsure" | "no";
  /** score(0, 0) over the best shifted score. */
  lead: number;
  /** sharp(0, 0): the mean of the four half-square neighbours' scores over score(0, 0), over the small objects when there are enough (fit.ts). */
  sharp: number;
  /** The highest of those four over score(0, 0): at most 1 at a peak. */
  peak?: number;
  /** How many small objects carried sharp and peak (0: every object did). */
  small?: number;
  /** The best shift, in squares. */
  best: [number, number];
  /** On "no" with a whole-square best: the shift that lines it up, in squares. */
  shiftSq?: [number, number];
  /** Default objects (effects left out, levelCentres) whose centres lie inside the picture. */
  objects: number;
}

/** One level, ranked for the picture (2.2). */
export interface LevelRank {
  /** level.key (labels can repeat). */
  key: string;
  label: string;
  terrainOn: boolean;
  /** matchDd2vttLevel's score, when a .dd2vtt was given. */
  vttScore?: number;
  fit?: FitResult;
  /** Why it is where it is: the export's doors and lights, the only level with ground, the objects' fit, open when saved, the only level. */
  why: "vtt" | "ground" | "objects" | "current" | "only";
}

/** What the attach dialog and the import report show. Only the GM sees it; none of it is uploaded. */
export interface AttachReport {
  levels: LevelRank[];
  /** The chosen level's key. */
  level: string;
  fit: FitResult;
  /** The whole-square shift applied to line it up, in squares. */
  shifted?: [number, number];
  /** Attach on hold: it didn't line up, or the level was unclear. */
  hold: null | "fit" | "level";
  /** Picture pixels a square, from the data (the scene's grid can be set from it). */
  gridPxPerSquare: number;
  snowShare: number;
  drawn: "winter" | "green";
  /** Pack things other than paths: objects, and pack roofs, patterns, materials and ground textures (6.1's "N things"). */
  packItems: number;
  /** Pack paths (6.1's "M paths"). */
  packPaths: number;
  packShare: number;
  /** Pack names, shown to the GM, never stored. */
  packNames: string[];
  dropped: number;
  objects: number;
  /** Each water body, by what the picture shows (2.6). */
  water: Array<"WATER" | "ICE" | "KEEP">;
  /** The picture is below 16 px a square: bare trees keep their priors. */
  lowRes: boolean;
  warnings: string[];
}

/** A refusal to show the GM as it is (plain language, design 6.1). */
export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

/** The extractor's numbers. */
export const EXTRACT = {
  /** The crop: the picture's rectangle grown by this, world units (3.3: one square). */
  margin: GRID,
  /** A .dd2vtt picture's aspect must match its map_size within this share (2.3). */
  aspect: 0.01,
  /** ... and its rectangle must lie at least this share on the map. */
  overlap: 0.5,
  /** A plain picture's aspect must match the map's within this many pixels (alignPlainImage). */
  plainPx: 2,
  /** Texels a square: 4 up to this long side in squares, else 2 (then halved while over the terrain cap). */
  tps4Side: 256,
  /** The automatic whole-square shift (2.4) needs at least this many objects in the picture. */
  shiftObjects: 16,
  /**
   * ... and at the shifted placement no more than this share of the objects tested for presence
   * missing (2.5) [M: correct pairs moved by whole squares miss 0-6.3% there (Hobblestone 44%, held
   * by its trees anyway); wrong synthetic maps whose shifted fit says "yes" miss 19-69%].
   */
  shiftDropped: 0.15,
  /** Wall ends this close (world units) join into a chain (4.1: a quarter square). */
  wallJoin: GRID / 4,
  /** A wall loop enclosing at most this many square squares is a room, entirely FLOOR (4.1). */
  smallLoop: 36,
  /** Work (point-in-polygon edge tests, patterns looked at) the wall-loop rule may spend in all. */
  loopWork: 50_000_000,
  /** A paving pattern lying at least this share inside a room becomes FLOOR. */
  patternInside: 0.5,
  /** Work (polygon edges times rows filled, polygons looked at, points clipped) filling floors for measuring, or building them, may spend; past it the map is refused. */
  floorWork: 50_000_000,
  /** ... of which each floor polygon clipped to a run of tiled cells costs this, besides its points. */
  clipWork: 512,
  /** The cave rim's width, world units (4.1: 0.35 square), and the step of its bitmap. */
  rim: 0.35 * GRID,
  rimStep: 32,
  /** Walls are drawn this far each side of their line, world units [L]. */
  wallHalf: 32,
  /** Path centre lines are simplified to within this many world units before ribbons are made. */
  pathTol: 2,
  /** Water classification (2.6): pixels at least this far from the shore, in squares. */
  shore: 0.25,
  /** A body needs this many pixels to be judged by the picture; fewer keeps WATER. */
  waterPixels: 8,
  /** The snowShare raster: px a square, and at most this many px on the long side. */
  sharePps: 16,
  shareMax: 1024,
  /** Over this share of the crop's texels summing to under termSum, the terrain "couldn't be read". */
  termBad: 0.02,
  termSum: 64,
  /** Texels summing to termSum or more but under this are scaled to sum to 255 (older maps). */
  termFull: 250,
  /** Pack items over this share of the area of objects and paths: say so (2.7). */
  packWarn: 0.15,
} as const;

// ---------------------------------------------------------------- the picture's rectangle (2.3)

/**
 * The picture's rectangle (2.3): from the .dd2vtt (or the scene's mapRect, in squares), else
 * the whole map for a plain export. An error when the hard checks fail (aspect, overlap).
 */
export function pictureRect(map: DDMap, picW: number, picH: number, vtt?: VttMeta,
  mapRect?: [number, number, number, number]): PictureRect | { error: string } {
  const W = map.world.width, H = map.world.height;
  if (!(W > 0 && H > 0)) return { error: "This map has no size." };
  if (!(picW > 0 && picH > 0)) return { error: "This picture has no size." };
  let sq: [number, number, number, number] | null = null;
  const r = vtt?.resolution;
  if (r && fin(r.map_origin.x) && fin(r.map_origin.y) && fin(r.map_size.x) && fin(r.map_size.y) && r.map_size.x > 0 && r.map_size.y > 0) {
    sq = [r.map_origin.x, r.map_origin.y, r.map_size.x, r.map_size.y];
  } else if (mapRect && mapRect.every(fin) && mapRect[2] > 0 && mapRect[3] > 0) {
    sq = [mapRect[0], mapRect[1], mapRect[2], mapRect[3]];
  }
  if (sq) {
    const [ox, oy, sw, sh] = sq;
    const want = sw / sh, got = picW / picH;
    if (Math.abs(got - want) > EXTRACT.aspect * want) {
      return { error: `This picture is ${picW}×${picH}, which isn't the shape of its export (${num(sw)}×${num(sh)} squares), so it isn't that export's picture.` };
    }
    const ix = Math.max(0, Math.min(W, ox + sw) - Math.max(0, ox)), iy = Math.max(0, Math.min(H, oy + sh) - Math.max(0, oy));
    if (ix * iy < EXTRACT.overlap * sw * sh) {
      return { error: `That export shows a part of a map that lies mostly outside this one (${W}×${H} squares), so it isn't an export of this map.` };
    }
    const rect: [number, number, number, number] = [ox * GRID, oy * GRID, (ox + sw) * GRID, (oy + sh) * GRID];
    if (!(rect[2] - rect[0] >= 1 && rect[3] - rect[1] >= 1)) return { error: "That export is too small to use." };
    return { rect };
  }
  if (!alignPlainImage(map, picW, picH, EXTRACT.plainPx)) {
    return { error: `This picture is ${picW}×${picH} but the map is ${W}×${H} squares, so it isn't an export of the whole map. If you exported part of it, choose its .dd2vtt export too.` };
  }
  return { rect: [0, 0, W * GRID, H * GRID] };
}

// ---------------------------------------------------------------- levels (2.2)

/** A .dd2vtt level match wins at this score, and at least this far ahead of the next. */
const VTT_WIN = 0.8, VTT_LEAD = 0.3;
/** Opaque pictures (this share of pixels opaque) put terrain-off levels last; see-through ones (this share transparent) first. */
const OPAQUE = 0.95, SEE_THROUGH = 0.5;
/** A "yes" level is clear of the others when each of their leads is at most this share of its own. */
const LEVEL_LEAD = 0.9;

const VERDICT_RANK = { yes: 0, unsure: 1, no: 2 } as const;

/**
 * The levels, best first (2.2): a .dd2vtt winner; then, by the picture's transparency, levels with
 * terrain (opaque picture) or without (see-through picture); then by the object fit (verdict, then
 * lead); then the level open when the map was saved. Each level's `why` names the rule that put the
 * top level above it (the top level's, the rule that put it above the second).
 */
export function rankLevels(map: DDMap, pic: PictureSample, rect: PictureRect, vtt?: VttMeta): LevelRank[] {
  const levels = map.world.levels;
  if (levels.length === 0) return [];
  const vttScores = new Map<string, number>();
  if (vtt && vtt.portals.length + vtt.lights.length + vtt.line_of_sight.length > 0) {
    for (const m of matchDd2vttLevel(map, vtt)) vttScores.set(m.level.key, m.score);
  }
  const scores = [...vttScores.values()].sort((a, b) => b - a);
  const vttWin = scores.length > 0 && scores[0] >= VTT_WIN && scores[0] - (scores[1] ?? 0) >= VTT_LEAD ? scores[0] : null;
  const opaque = opaqueShare(pic);
  const group = (terrainOn: boolean): number =>
    opaque >= OPAQUE ? (terrainOn ? 0 : 1) : 1 - opaque >= SEE_THROUGH ? (terrainOn ? 1 : 0) : 0;
  const current = map.header.currentLevel;
  const rows = levels.map((L, i) => {
    const terrainOn = !!(L.terrain && L.terrain.enabled);
    const vs = vttScores.get(L.key);
    return {
      i, L, terrainOn, vs,
      vttWinner: vttWin !== null && vs === vttWin,
      group: group(terrainOn),
      fit: objectFit(levelCentres(L), rect, pic, levelRadii(L)),
      current: current !== null && L.id === current,
    };
  });
  type Row = (typeof rows)[number];
  const lead = (r: Row) => (r.fit.lead > 0 ? r.fit.lead : -1);
  /** Which rule orders a before b (or "" when none does). */
  const stage = (a: Row, b: Row): { d: number; why: LevelRank["why"] | "" } => {
    if (a.vttWinner !== b.vttWinner) return { d: a.vttWinner ? -1 : 1, why: "vtt" };
    if (a.group !== b.group) return { d: a.group - b.group, why: "ground" };
    const v = VERDICT_RANK[a.fit.verdict] - VERDICT_RANK[b.fit.verdict];
    if (v !== 0) return { d: v, why: "objects" };
    if (lead(a) !== lead(b)) return { d: lead(b) - lead(a), why: "objects" };
    if (a.current !== b.current) return { d: a.current ? -1 : 1, why: "current" };
    return { d: a.i - b.i, why: "" };
  };
  rows.sort((a, b) => stage(a, b).d);
  return rows.map((r, k): LevelRank => {
    let why: LevelRank["why"] = "only";
    if (rows.length > 1) {
      const s = k === 0 ? stage(r, rows[1]) : stage(rows[0], r);
      why = s.why === "" ? "current" : s.why;
    }
    const out: LevelRank = { key: r.L.key, label: r.L.label, terrainOn: r.terrainOn, fit: r.fit, why };
    if (r.vs !== undefined) out.vttScore = r.vs;
    return out;
  });
}

/**
 * The level to attach, from rankLevels' order, and whether it is clear enough to attach without
 * asking (2.2): a .dd2vtt winner, the only level (or the only one left by the transparency rule),
 * or a top level whose fit is "yes" with every other level's lead at most 0.9 of its own.
 * Otherwise a new-scene drop attaches it on hold ("Check which level this picture shows").
 */
export function chooseLevel(levels: readonly LevelRank[]): { key: string; clear: boolean } | null {
  const top = levels[0];
  if (!top) return null;
  if (levels.length === 1 || top.why === "vtt" || top.why === "only" || top.why === "ground") return { key: top.key, clear: true };
  const f = top.fit;
  const clear = !!f && f.verdict === "yes" && levels.slice(1).every((l) => (l.fit?.lead ?? 0) <= LEVEL_LEAD * f.lead);
  return { key: top.key, clear };
}

function opaqueShare(pic: PictureSample): number {
  const n = pic.w * pic.h;
  if (n <= 0) return 1;
  // Every pixel of a modest picture; a sample of a big one.
  const stride = Math.max(1, Math.floor(n / 1_000_000));
  let o = 0, k = 0;
  for (let i = 0; i < n; i += stride, k++) if (pic.rgba[i * 4 + 3] >= 128) o++;
  return o / k;
}

// ---------------------------------------------------------------- extraction

export interface ExtractOptions {
  /** rankLevels' result for the report (default: ranked here, without a .dd2vtt). */
  levels?: LevelRank[];
  /** The level was unclear (chooseLevel's clear false): attach on hold. */
  holdLevel?: boolean;
  /** Line it up moved by this correction (squares, as FitResult.best): the dialog's "Line it up that way". */
  shift?: [number, number];
  /** On "no" with a whole-square best (16 objects or more), try that shift and keep it when it scores "yes", presence included. Default true. */
  autoShift?: boolean;
  /** The scene's grid in `pic`'s pixels, for masking a baked grid (measure.ts); null or absent: none. */
  grid?: { pxPerSquare: number; offsetX: number; offsetY: number } | null;
  /** The picture's full size, when `pic` is scaled down (for gridPxPerSquare). */
  picSize?: [number, number];
  /** Progress lines for the dialog (6.4). */
  onProgress?: (text: string) => void;
}

/** Compiles one level (by level.key). Throws ExtractError when the map is over a SIDECAR_CAPS limit or the level is missing. */
export function extractSidecar(map: DDMap, levelKey: string, rect: PictureRect, pic: PictureSample,
  sizes: SpriteSizes, opts: ExtractOptions = {}): { sidecar: SeasonSidecar; report: AttachReport } {
  const L = map.world.levels.find((l) => l.key === levelKey);
  if (!L) throw new ExtractError("That level isn't in this map.");
  const W = map.world.width, H = map.world.height;
  if (!(Number.isInteger(W) && Number.isInteger(H) && W >= 1 && H >= 1 && W <= 65535 && H <= 65535)) {
    throw new ExtractError("This map is too big for exact seasons.");
  }
  const progress = opts.onProgress ?? (() => {});
  const warnings: string[] = [];

  // Line up: the fit, and the automatic whole-square shift (2.4).
  progress("Checking that the map lines up with the picture…");
  const centres = levelCentres(L), radii = levelRadii(L);
  let used = moved(rect.rect, opts.shift ?? [0, 0]);
  let fit = objectFit(centres, { rect: used }, pic, radii);
  let shifted: [number, number] | undefined = opts.shift && (opts.shift[0] !== 0 || opts.shift[1] !== 0) ? [opts.shift[0], opts.shift[1]] : undefined;

  // Objects: roles, a generous first cut to the crop, measurement (with presence, 2.5).
  const roleOf = (o: MapObject): ObjectRole => objectRole(defaultName(o.texture));
  const measureAt = (r: Box) => {
    const crop: Box = [r[0] - EXTRACT.margin, r[1] - EXTRACT.margin, r[2] + EXTRACT.margin, r[3] + EXTRACT.margin];
    const near: MapObject[] = [];
    for (const o of L.objects) {
      if (!fin(o.position.x) || !fin(o.position.y)) continue;
      const pr = priorReach(o, roleOf(o), sizes);
      let m = 0;
      for (const v of pr) if (v > m) m = v;
      if (reaches(o.position.x, o.position.y, m * MEASURE.clampMax * MEASURE.retryPrior, crop)) near.push(o);
    }
    // Over the cap before measuring (a few of them might be dropped, but measuring 20,000 objects to find out isn't worth it).
    if (near.length > SIDECAR_CAPS.objects) throw new ExtractError("This map is too big for exact seasons.");
    // The floors too (measuring leaves them out of its ground models), so a file of very many
    // floor polygons is refused before measuring fills them all in.
    const floors = nearFloors(L, crop, r[1], (r[3] - r[1]) / pic.h, pic.h);
    const roles = near.map(roleOf);
    const notes: string[] = [];
    progress(`Measuring the things in the picture (0 of ${near.length})…`);
    const ms = measureObjects({ ...L, objects: near, floorPolygons: floors.polys }, roles, pic, { rect: r }, opts.grid ?? null, sizes, notes,
      (done, total) => progress(`Measuring the things in the picture (${done} of ${total})…`));
    return { crop, near, roles, ms, notes, floors, summary: measureSummary(ms, roles) };
  };
  // The automatic shift needs enough objects (with a dozen, some shift a few squares away can land
  // them all on busy pixels by chance), and the shifted placement must score "yes" itself, by the
  // fit and then by presence (2.5: not more than a tenth of its trees missing, and no more than
  // EXTRACT.shiftDropped of all the objects tested). The second check matters: the shift was the
  // best of many, so on a wrong map its fit alone often says "yes". (A wrong map of nothing but
  // things never tested, such as tufts on grass, can still pass: a known limit.)
  let meas: ReturnType<typeof measureAt> | null = null;
  if (!opts.shift && opts.autoShift !== false && fit.verdict === "no" && fit.shiftSq && fit.objects >= EXTRACT.shiftObjects) {
    const r2 = moved(rect.rect, fit.shiftSq);
    const f2 = objectFit(centres, { rect: r2 }, pic, radii);
    if (f2.verdict === "yes") {
      const m2 = measureAt(r2);
      if (!m2.summary.lowerFit && m2.summary.dropped <= EXTRACT.shiftDropped * m2.summary.tested) {
        shifted = [fit.shiftSq[0], fit.shiftSq[1]];
        used = r2;
        fit = f2;
        meas = m2;
      }
    }
  }
  meas ??= measureAt(used);
  const { crop, near, roles, ms, floors, summary } = meas;
  if (summary.lowerFit && fit.verdict === "yes") fit = { ...fit, verdict: "unsure" };
  for (const n of meas.notes) warnings.push(n);
  const [x0, y0, x1, y1] = used;
  const names = new Names();

  progress("Compiling the map's season data…");
  const kept: number[] = [];
  let dropped = 0;
  for (let i = 0; i < near.length; i++) {
    if (!reachesPoly(near[i].position.x, near[i].position.y, ms[i].reach, crop)) continue;
    if (ms[i].present === false) { dropped++; continue; }
    kept.push(i);
  }
  if (kept.length > SIDECAR_CAPS.objects) throw new ExtractError("This map is too big for exact seasons.");
  const objects = objectTable(near, roles, ms, kept, names);

  // Terrain.
  const tr = terrainGrid(L, W, H, crop, names, warnings);

  // Areas.
  const shapes: ShapeLayer[] = [];
  const bitmaps: BitmapLayer[] = [];
  const pack = { items: 0, paths: 0, ids: new Set<string>(), area: 0, all: 0 };
  /** Whether it comes from a pack, counting it as a path or as one of the other things (6.1). */
  const isPack = (ref: { source: string; packId?: string } | null, path = false): boolean => {
    if (ref?.source !== "pack") return false;
    if (path) pack.paths++;
    else pack.items++;
    if (ref.packId) pack.ids.add(ref.packId);
    return true;
  };
  for (const s of tr.packSlots) isPack(s);

  // Water: one shape a body.
  const bodies = (L.water.root?.children ?? []).filter((b) => !b.isOpen || b.children.length > 0);
  const waterShapes: ShapeLayer[] = [];
  for (const body of bodies) {
    const sb = new ShapeBuilder(AR.WATER, DD_LAYER.WATER, 0, crop);
    const stack: WaterNode[] = [body];
    while (stack.length) {
      const nd = stack.pop()!;
      if (!nd.isOpen && nd.polygon.length >= 6) sb.ring(nd.polygon);
      for (const c of nd.children) stack.push(c);
    }
    const s = sb.build();
    if (s) { shapes.push(s); waterShapes.push(s); }
  }

  // Cave floor and rim; materials.
  const skippedBits: string[] = [];
  const pushBits = (b: BitmapLayer | null, what: string) => {
    if (!b) return;
    if (bitmaps.length >= SIDECAR_CAPS.bitmaps) { skippedBits.push(what); return; }
    bitmaps.push(b);
  };
  if (L.cave?.floor) {
    pushBits(caveRim(L.cave.floor, L.cave.entrance, crop), "cave rim");
    pushBits(cropBits(L.cave.floor, crop, AR.CAVE, DD_LAYER.CAVE), "cave");
  }

  // Wall loops (4.1): a room (at most EXTRACT.smallLoop square squares) is entirely FLOOR, and the
  // paving patterns lying mostly inside it are its floor. A bigger loop adds nothing: its FLOOR
  // patterns, tiles, materials and floor polygons are FLOOR already, and the rest (a yard, a
  // town's streets and gardens) stays outdoors.
  const loops = wallLoops(L);
  const patternRoles = L.patterns.map((p) => patternRole(defaultName(p.texture)));
  const patternPolys = L.patterns.map((p) => patternPolygon(p));
  const materialRoles = L.materials.map((m) => materialRole(defaultName(m.texture)));
  const patternBoxes = patternPolys.map(ringBox);
  const paving: number[] = [];
  patternRoles.forEach((r, i) => { if (r === AR.PAVED && overlaps(patternBoxes[i], crop)) paving.push(i); });
  const interior = new ShapeBuilder(AR.FLOOR, DD_LAYER.FLOOR, 1, crop);
  // Bounded work (point-in-polygon edge tests, and each pattern looked at for each room): a file
  // can hold very many loops and patterns. Rooms left unchecked keep their paving PAVED.
  const work = { left: EXTRACT.loopWork };
  let unchecked = false;
  for (const loop of loops) {
    const lb = ringBox(loop);
    if (!overlaps(lb, crop) || Math.abs(ringArea(loop)) > EXTRACT.smallLoop * GRID * GRID) continue;
    interior.ring(positive(loop));
    const inside = (x: number, y: number) => pointInW(loop, x, y, work);
    for (const i of paving) {
      if (work.left <= 0) { unchecked = true; break; }
      work.left--;
      if (patternRoles[i] !== AR.PAVED || !overlaps(patternBoxes[i], lb)) continue;
      const share = shareInside(patternPolys[i], patternBoxes[i], inside, work);
      if (Number.isNaN(share)) unchecked = true;
      else if (share >= EXTRACT.patternInside) patternRoles[i] = AR.FLOOR;
    }
  }
  if (unchecked) warnings.push("This map has more walled rooms than could all be checked; paving in some of them counts as outdoors.");
  for (let i = 0; i < L.materials.length; i++) {
    const m = L.materials[i];
    const b = m.mask ? cropBits(m.mask, crop, materialRoles[i], clampI16(m.layer)) : null;
    if (b && isPack(m.texture)) b.role = AR.KEEP;
    pushBits(b, "material");
  }
  if (skippedBits.length) warnings.push("This map paints more kinds of material than exact seasons can keep; the rest stay as drawn.");

  // Building floors: the floor polygons where tiles are, and tiled cells without a polygon.
  const floor = floorShape(L, crop, floors);
  if (floor) shapes.push(floor);
  const ins = interior.build();
  if (ins) shapes.push(ins);

  // Patterns.
  for (let i = 0; i < L.patterns.length; i++) {
    const p = L.patterns[i];
    const sb = new ShapeBuilder(patternRoles[i], clampI16(p.layer), 0, crop);
    sb.ring(patternPolys[i]);
    const s = sb.build();
    if (s && isPack(p.texture)) s.role = AR.KEEP;
    if (s) shapes.push(s);
  }

  // Walls.
  const walls = new ShapeBuilder(AR.WALL, DD_LAYER.WALL, 1, crop);
  for (const w of L.walls) for (const r of ribbonRings(wallRibbon(w, EXTRACT.wallHalf), true, 1)) walls.ring(r);
  const ws = walls.build();
  if (ws) shapes.push(ws);

  // Roofs, one shape each (a roof's own colour is found per roof at run time).
  for (const r of L.roofs) {
    const sb = new ShapeBuilder(roofRole(defaultName(r.texture)), DD_LAYER.ROOF, 1, crop);
    sb.ring(positive(roofPolygon(r)));
    const s = sb.build();
    if (s && isPack(r.texture)) s.role = AR.KEEP;
    if (s) shapes.push(s);
  }

  // Paths: the drawn width of default trails and roads, the whole ribbon of the rest.
  for (const p of L.paths) {
    const rb = pathRibbon(p);
    if (!ribbonReaches(rb, crop)) continue;
    const packPath = p.texture?.source === "pack";
    isPack(p.texture, true);
    const nm = packPath ? null : defaultName(p.texture);
    const role = pathRole(nm);
    const a = ribbonArea(rb, crop);
    pack.all += a;
    if (packPath) pack.area += a;
    const sb = new ShapeBuilder(role, clampI16(p.layer), 1, crop);
    for (const r of ribbonRings(rb, false, role === AR.PATH_KEEP ? 1 : pathDrawn(nm), EXTRACT.pathTol)) sb.ring(r);
    const s = sb.build();
    if (s) shapes.push(s);
  }

  // Pack objects, and the objects' share of the area.
  for (const i of kept) {
    const a = reachArea(ms[i].reach);
    pack.all += a;
    if (near[i].texture?.source === "pack") { pack.area += a; isPack(near[i].texture); }
  }

  // Caps (decodeSidecar's, checked here so the GM is told plainly).
  let rings = 0, points = 0;
  for (const s of shapes) { rings += s.ringEnds.length; points += s.pts.length / 2; }
  if (rings > SIDECAR_CAPS.rings || points > SIDECAR_CAPS.points || names.list.length > SIDECAR_CAPS.names) {
    throw new ExtractError("This map is too big for exact seasons.");
  }

  const packShare = pack.all > 0 ? round3(pack.area / pack.all) : 0;
  const sc: SeasonSidecar = {
    meta: {
      rect: [x0, y0, x1, y1], squares: [W, H], extractor: EXTRACTOR_VERSION, snowShare: 0,
      packShare, packItems: pack.items, dropped, names: names.list,
    },
    terrain: tr.grid, bitmaps, shapes, objects,
  };
  fitMeta(sc);

  // Snowy or green (4.2), then water by what the picture shows (2.6).
  const share = groundShares(sc);
  sc.meta.snowShare = share.snowShare;
  if (share.packGround) warnings.push("Most of this map's ground comes from an asset pack, so seasons leave it as drawn.");
  const snowy = share.snowShare >= 0.5;
  const water = classifyWater(waterShapes, sc, pic, snowy, warnings);

  try {
    encodeSidecar(sc);
  } catch (e) {
    if (e instanceof SidecarError) throw new ExtractError("This map is too big for exact seasons.");
    throw e;
  }

  const sqW = (x1 - x0) / GRID;
  const pps = pic.w / sqW;
  const fullW = opts.picSize?.[0] ?? pic.w;
  const report: AttachReport = {
    levels: opts.levels ?? rankLevels(map, pic, rect),
    level: L.key,
    fit,
    hold: opts.holdLevel ? "level" : fit.verdict === "no" ? "fit" : null,
    gridPxPerSquare: round3(fullW / sqW),
    snowShare: sc.meta.snowShare,
    drawn: snowy ? "winter" : "green",
    packItems: pack.items,
    packPaths: pack.paths,
    packShare,
    packNames: packNames(map, pack.ids),
    dropped,
    objects: objects.n,
    water,
    lowRes: pps < MEASURE.minPxPerSquare,
    warnings,
  };
  if (shifted) report.shifted = shifted;
  return { sidecar: sc, report };
}

// ---------------------------------------------------------------- the preview (2.7)

/** Preview colours (2.7's legend). */
const PREVIEW = {
  snow: [244, 250, 255], grass: [60, 170, 60], earth: [204, 150, 54], water: [18, 46, 140], ice: [170, 236, 246],
  indoor: [128, 128, 128], keep: [236, 60, 200],
  evergreen: [0, 96, 40], deciduous: [130, 210, 60], shrub: [170, 220, 110], bare: [150, 90, 40],
} as const;

/** The preview's size in pixels for a picture of w x h: `size` on the long side, the other by the aspect (rounded, at least 1). */
export function previewSize(w: number, h: number, size: number): [number, number] {
  const s = Math.max(1, Math.round(size));
  return w >= h ? [s, Math.max(1, Math.round((s * h) / w))] : [Math.max(1, Math.round((s * w) / h)), s];
}

/**
 * The dialog's preview (2.7): the picture at previewSize(pic.w, pic.h, size) with the sidecar's
 * layers over it, via rasterSidecar: snow hatched, grass green, earth ochre, water dark blue, ice
 * pale cyan, buildings and roofs grey, what stays as drawn outlined dashed, and tree footprints
 * outlined by kind. Opaque RGBA.
 */
export function previewOverlay(sc: SeasonSidecar, pic: PictureSample, size: number): Uint8ClampedArray {
  const [pw, ph] = previewSize(pic.w, pic.h, size);
  const out = resampleRGBA(pic, pw, ph);
  const Ly = rasterSidecar(sc, { w: pw, h: ph });
  const n = pw * ph;
  const zero = new Uint8Array(n);
  const t = (r: TerrainRole) => Ly.terrain.get(r) ?? zero;
  const a = (r: AreaRole) => Ly.area.get(r) ?? zero;
  const ob = (r: ObjectRole) => Ly.objects.get(r) ?? zero;
  const snow = t(TR.SNOW), grass = t(TR.GRASS), earth = t(TR.EARTH), sand = t(TR.SAND), iceT = t(TR.ICE), keepT = t(TR.KEEP);
  const water = a(AR.WATER), ice = a(AR.ICE), keepA = a(AR.KEEP), pathKeep = a(AR.PATH_KEEP), rim = a(AR.CAVE_RIM), pathEarth = a(AR.PATH_EARTH);
  const indoor = [a(AR.FLOOR), a(AR.CAVE), a(AR.ROOF), a(AR.WALL)];
  const opaque = ob(OR.OPAQUE), structure = ob(OR.STRUCTURE);
  const keep = new Uint8Array(n);
  const blend = (i: number, c: readonly number[], k: number) => {
    if (k <= 0) return;
    const o = i * 4;
    out[o] += (c[0] - out[o]) * k;
    out[o + 1] += (c[1] - out[o + 1]) * k;
    out[o + 2] += (c[2] - out[o + 2]) * k;
  };
  for (let y = 0, i = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++, i++) {
      if ((x + y) % 6 < 2) blend(i, PREVIEW.snow, (0.75 * snow[i]) / 255);
      blend(i, PREVIEW.grass, (0.4 * grass[i]) / 255);
      blend(i, PREVIEW.earth, (0.4 * Math.min(255, earth[i] + sand[i] + pathEarth[i])) / 255);
      blend(i, PREVIEW.water, (0.55 * water[i]) / 255);
      blend(i, PREVIEW.ice, (0.55 * Math.min(255, ice[i] + iceT[i])) / 255);
      blend(i, PREVIEW.indoor, (0.5 * Math.min(255, indoor[0][i] + indoor[1][i] + indoor[2][i] + indoor[3][i])) / 255);
      keep[i] = keepA[i] + pathKeep[i] + rim[i] + keepT[i] + opaque[i] + structure[i] >= 128 ? 1 : 0;
    }
  }
  // Outlines: what stays as drawn (dashed), and tree footprints by kind.
  const o = sc.objects;
  const treeColour = (idx: number): readonly number[] | null => {
    let role = o.role[idx] as ObjectRole;
    const nm = o.name[idx];
    if (nm !== NO_NAME && nm < sc.meta.names.length) role = objectRole(sc.meta.names[nm]);
    return role === OR.EVERGREEN ? PREVIEW.evergreen : role === OR.DECIDUOUS ? PREVIEW.deciduous
      : role === OR.SHRUB || role === OR.FLOWER_SHRUB ? PREVIEW.shrub : role === OR.BARE ? PREVIEW.bare : null;
  };
  const top = Ly.top;
  for (let y = 0, i = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++, i++) {
      const edge = (j: number, ok: boolean) => ok && keep[j] === 0;
      if (keep[i] && ((x + y) >> 2) % 2 === 0 &&
        (edge(i - 1, x > 0) || edge(i + 1, x < pw - 1) || edge(i - pw, y > 0) || edge(i + pw, y < ph - 1))) {
        blend(i, PREVIEW.keep, 1);
      }
      const k = top[i];
      if (k > 0) {
        const diff = (j: number, ok: boolean) => ok && top[j] !== k;
        if (diff(i - 1, x > 0) || diff(i + 1, x < pw - 1) || diff(i - pw, y > 0) || diff(i + pw, y < ph - 1)) {
          const c = treeColour(k - 1);
          if (c) blend(i, c, 1);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- helpers: geometry

type Box = [number, number, number, number];

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const num = (v: number) => String(Math.round(v * 100) / 100);
const clampI16 = (v: number) => (Number.isFinite(v) ? Math.max(-32768, Math.min(32767, Math.round(v))) : 0);

function moved(r: Box, shift: readonly [number, number]): Box {
  const dx = -shift[0] * GRID, dy = -shift[1] * GRID;
  return [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy];
}

/** A disc of radius r at (x, y) reaches into the box. */
function reaches(x: number, y: number, r: number, b: Box): boolean {
  return x + r > b[0] && x - r < b[2] && y + r > b[1] && y - r < b[3];
}

/** The 16-gon through reach[k] * REACH_DIRS[k] round (x, y) reaches into the box (its bounding box does). */
function reachesPoly(x: number, y: number, reach: ArrayLike<number>, b: Box): boolean {
  let ax = 0, bx = 0, ay = 0, by = 0;
  for (let k = 0; k < REACH_N; k++) {
    const dx = reach[k] * REACH_DIRS[k * 2], dy = reach[k] * REACH_DIRS[k * 2 + 1];
    if (dx < ax) ax = dx; if (dx > bx) bx = dx; if (dy < ay) ay = dy; if (dy > by) by = dy;
  }
  return x + bx > b[0] && x + ax < b[2] && y + by > b[1] && y + ay < b[3];
}

function reachArea(reach: ArrayLike<number>): number {
  let a = 0;
  for (let k = 0; k < REACH_N; k++) {
    const j = (k + 1) % REACH_N;
    a += reach[k] * reach[j] * (REACH_DIRS[k * 2] * REACH_DIRS[j * 2 + 1] - REACH_DIRS[k * 2 + 1] * REACH_DIRS[j * 2]);
  }
  return Math.abs(a) / 2;
}

/** Signed area (positive: clockwise on screen, y down). */
function ringArea(r: ArrayLike<number>): number {
  let a = 0;
  const n = r.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}

/** The ring with a positive signed area, so non-zero fills of several take their union. */
function positive(r: Float64Array): Float64Array {
  if (ringArea(r) >= 0) return r;
  const n = r.length >> 1;
  const out = new Float64Array(r.length);
  for (let i = 0; i < n; i++) { out[i * 2] = r[(n - 1 - i) * 2]; out[i * 2 + 1] = r[(n - 1 - i) * 2 + 1]; }
  return out;
}

/** Even-odd point in ring. */
function pointIn(r: ArrayLike<number>, x: number, y: number): boolean {
  let c = false;
  const n = r.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function ringBox(r: ArrayLike<number>): Box {
  let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < ax) ax = r[i]; if (r[i] > bx) bx = r[i];
    if (r[i + 1] < ay) ay = r[i + 1]; if (r[i + 1] > by) by = r[i + 1];
  }
  return [ax, ay, bx, by];
}

/** Sample points on a grid over a box, at most `max` of them, with whole-square-fraction steps. */
function gridSamples(b: Box, max: number, each: (x: number, y: number) => void): void {
  const w = b[2] - b[0], h = b[3] - b[1];
  if (!(w > 0 && h > 0)) return;
  let step = GRID / 4;
  while ((w / step) * (h / step) > max) step *= 2;
  for (let y = b[1] + step / 2; y < b[3]; y += step) for (let x = b[0] + step / 2; x < b[2]; x += step) each(x, y);
}

/** The share of a polygon's area (by samples) inside `inside`; NaN when `work` ran out on the way. */
function shareInside(poly: Float64Array, box: Box, inside: (x: number, y: number) => boolean, work: { left: number }): number {
  let a = 0, b = 0;
  gridSamples(box, 1024, (x, y) => {
    if (work.left <= 0 || !pointInW(poly, x, y, work)) return;
    a++;
    if (inside(x, y)) b++;
  });
  if (work.left <= 0) return NaN;
  return a > 0 ? b / a : 0;
}

const inBox = (b: Box, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** pointIn, charging `work` its edges. */
function pointInW(r: ArrayLike<number>, x: number, y: number, work: { left: number }): boolean {
  work.left -= r.length >> 1;
  return pointIn(r, x, y);
}

/** A marching-squares grid's value at a world point (bilinear between its 0/1 samples, 0 outside). */
function bitAt(g: BitGrid, x: number, y: number): number {
  const fx = x / g.step + MS_EDGE_BUFFER, fy = y / g.step + MS_EDGE_BUFFER;
  if (!(fx >= 0 && fy >= 0 && fx <= g.width - 1 && fy <= g.height - 1)) return 0;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(g.width - 1, x0 + 1), y1 = Math.min(g.height - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const a = g.bits[y0 * g.width + x0] ? 1 : 0, b = g.bits[y0 * g.width + x1] ? 1 : 0;
  const c = g.bits[y1 * g.width + x0] ? 1 : 0, d = g.bits[y1 * g.width + x1] ? 1 : 0;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Sutherland-Hodgman: a ring clipped to a box (each ring alone keeps every fill rule's answer inside the box). */
function clipRing(r: ArrayLike<number>, b: Box): number[] {
  let pts: number[] = Array.from(r);
  const edges: Array<(x: number, y: number) => number> = [
    (x) => x - b[0], (x) => b[2] - x, (_x, y) => y - b[1], (_x, y) => b[3] - y,
  ];
  for (const f of edges) {
    const n = pts.length >> 1;
    if (n === 0) break;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1];
      const j = (i + 1) % n;
      const bx = pts[j * 2], by = pts[j * 2 + 1];
      const fa = f(ax, ay), fb = f(bx, by);
      if (fa >= 0) out.push(ax, ay);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    pts = out;
  }
  return pts;
}

/** Collects a shape's rings, clipped to the crop and rounded to 1/16 world unit. */
class ShapeBuilder {
  private readonly pts: number[] = [];
  private readonly ends: number[] = [];
  private readonly role: AreaRole;
  private readonly layer: number;
  private readonly rule: 0 | 1;
  private readonly box: Box;
  constructor(role: AreaRole, layer: number, rule: 0 | 1, box: Box) {
    this.role = role;
    this.layer = layer;
    this.rule = rule;
    this.box = box;
  }
  ring(r: ArrayLike<number>): void {
    if (r.length < 6) return;
    const bb = ringBox(r);
    if (bb[2] <= this.box[0] || bb[0] >= this.box[2] || bb[3] <= this.box[1] || bb[1] >= this.box[3]) return;
    const inside = bb[0] >= this.box[0] && bb[2] <= this.box[2] && bb[1] >= this.box[1] && bb[3] <= this.box[3];
    const c = inside ? Array.from(r) : clipRing(r, this.box);
    const q: number[] = [];
    const C = SIDECAR_UNITS.coord;
    for (let i = 0; i < c.length; i += 2) {
      const x = Math.round(c[i] * C), y = Math.round(c[i + 1] * C);
      const n = q.length;
      if (n >= 2 && q[n - 2] === x && q[n - 1] === y) continue;
      q.push(x, y);
    }
    while (q.length >= 4 && q[0] === q[q.length - 2] && q[1] === q[q.length - 1]) q.length -= 2;
    if (q.length < 6 || ringArea(q) === 0) return;
    for (const v of q) this.pts.push(v);
    this.ends.push(this.pts.length / 2);
  }
  build(): ShapeLayer | null {
    if (this.ends.length === 0) return null;
    return { role: this.role, layer: this.layer, rule: this.rule, pts: Int32Array.from(this.pts), ringEnds: Uint32Array.from(this.ends) };
  }
}

/**
 * A ribbon as rings for a non-zero fill: a quad a segment (lengthened by its half-width at both
 * ends when `square`, which gives a wall's square corners) and, otherwise, an octagon at each inner
 * vertex where the turn opens a gap of more than a couple of world units. `share` narrows it (a
 * path's drawn width); `tol` simplifies the centre line first (Douglas-Peucker).
 */
function ribbonRings(rb: Ribbon, square: boolean, share: number, tol = 0): Float64Array[] {
  const out: Float64Array[] = [];
  const idx = tol > 0 ? simplify(rb.line, tol) : Array.from({ length: rb.line.length >> 1 }, (_, i) => i);
  for (let q = 0; q + 1 < idx.length; q++) {
    const i = idx[q], j = idx[q + 1];
    let ax = rb.line[i * 2], ay = rb.line[i * 2 + 1], bx = rb.line[j * 2], by = rb.line[j * 2 + 1];
    const ha = rb.halfWidth[i] * share, hb = rb.halfWidth[j] * share;
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 1e-9) || !(ha > 0 || hb > 0)) continue;
    const tx = (bx - ax) / len, ty = (by - ay) / len;
    if (square) { ax -= tx * ha; ay -= ty * ha; bx += tx * hb; by += ty * hb; }
    const nx = -ty, ny = tx;
    out.push(positive(Float64Array.from([ax + nx * ha, ay + ny * ha, bx + nx * hb, by + ny * hb, bx - nx * hb, by - ny * hb, ax - nx * ha, ay - ny * ha])));
    if (!square && q > 0) {
      const p = idx[q - 1];
      const ux = rb.line[i * 2] - rb.line[p * 2], uy = rb.line[i * 2 + 1] - rb.line[p * 2 + 1];
      const ul = Math.hypot(ux, uy);
      const turn = ul > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * tx + uy * ty) / ul))) : 0;
      if (ha * turn > 2) out.push(octagon(rb.line[i * 2], rb.line[i * 2 + 1], ha));
    }
  }
  return out;
}

function octagon(cx: number, cy: number, r: number): Float64Array {
  const R = r / Math.cos(Math.PI / 8);
  const out = new Float64Array(16);
  for (let k = 0; k < 8; k++) {
    out[k * 2] = cx + R * Math.cos(((k + 0.5) * Math.PI) / 4);
    out[k * 2 + 1] = cy + R * Math.sin(((k + 0.5) * Math.PI) / 4);
  }
  return out;
}

/** Douglas-Peucker: the indices of the centre-line points kept (the ends always). */
function simplify(line: Float64Array, tol: number): number[] {
  const n = line.length >> 1;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = line[a * 2], ay = line[a * 2 + 1], bx = line[b * 2], by = line[b * 2 + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const px = line[i * 2] - ax, py = line[i * 2 + 1] - ay;
      const t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

function ribbonReaches(rb: Ribbon, b: Box): boolean {
  let hm = 0;
  for (const h of rb.halfWidth) if (h > hm) hm = h;
  const bb = ringBox(rb.line);
  return bb[2] + hm > b[0] && bb[0] - hm < b[2] && bb[3] + hm > b[1] && bb[1] - hm < b[3];
}

/** The ribbon's area (length times width) over its segments whose middle lies in the box. */
function ribbonArea(rb: Ribbon, b: Box): number {
  let a = 0;
  const n = rb.line.length >> 1;
  for (let i = 0; i + 1 < n; i++) {
    const ax = rb.line[i * 2], ay = rb.line[i * 2 + 1], bx = rb.line[i * 2 + 2], by = rb.line[i * 2 + 3];
    if (!inBox(b, (ax + bx) / 2, (ay + by) / 2)) continue;
    a += Math.hypot(bx - ax, by - ay) * (rb.halfWidth[i] + rb.halfWidth[i + 1]);
  }
  return a;
}

// ---------------------------------------------------------------- helpers: the level's parts

/** Default short names in META.names, by first use. */
class Names {
  readonly list: string[] = [];
  private readonly ix = new Map<string, number>();
  of(name: string): number {
    let i = this.ix.get(name);
    if (i === undefined) { i = this.list.length; this.list.push(name); this.ix.set(name, i); }
    return i;
  }
}

function objectTable(objs: MapObject[], roles: ObjectRole[], ms: Measured[], kept: number[], names: Names): ObjectTable {
  const n = kept.length;
  const t: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  const C = SIDECAR_UNITS.coord, R = SIDECAR_UNITS.reach;
  kept.forEach((i, k) => {
    const o = objs[i], m = ms[i], role = roles[i];
    t.role[k] = role;
    t.layer[k] = clampI16(o.layer);
    t.x[k] = Math.round(o.position.x * C);
    t.y[k] = Math.round(o.position.y * C);
    t.rot[k] = ((Math.round((o.rotation / (2 * Math.PI)) * 256) % 256) + 256) % 256 || 0;
    t.flags[k] = (o.mirror ? OBJ_FLAG.MIRROR : 0) | (m.capped ? OBJ_FLAG.CAPPED : 0) |
      (o.customColor ? OBJ_FLAG.TINTED : 0) | (m.measured ? OBJ_FLAG.MEASURED : 0);
    const nm = defaultName(o.texture);
    t.name[k] = nm !== null && NAMED_ROLES.has(role) ? names.of(nm) : NO_NAME;
    for (let d = 0; d < REACH_N; d++) {
      const v = m.reach[d];
      t.reach[k * REACH_N + d] = Number.isFinite(v) ? Math.max(0, Math.min(65535, Math.round(v * R))) : 0;
    }
  });
  return t;
}

/** META's JSON must stay under its cap: names of the least-used objects go first (their stored roles stay). */
function fitMeta(sc: SeasonSidecar): void {
  const size = () => new TextEncoder().encode(JSON.stringify(sc.meta)).length;
  if (size() <= SIDECAR_CAPS.metaBytes) return;
  const o = sc.objects, names = sc.meta.names;
  const uses = new Int32Array(names.length);
  for (let i = 0; i < o.n; i++) if (o.name[i] !== NO_NAME) uses[o.name[i]]++;
  const terrainNames = new Set(sc.terrain ? sc.terrain.slots.map((s) => s.name) : []);
  const order = names.map((_, i) => i).filter((i) => !terrainNames.has(i)).sort((a, b) => uses[a] - uses[b] || names[b].length - names[a].length);
  const drop = new Set<number>();
  for (const i of order) {
    drop.add(i);
    const remap = new Int32Array(names.length).fill(-1);
    const list: string[] = [];
    names.forEach((nm, j) => { if (!drop.has(j)) { remap[j] = list.length; list.push(nm); } });
    const trial = { ...sc.meta, names: list };
    if (new TextEncoder().encode(JSON.stringify(trial)).length <= SIDECAR_CAPS.metaBytes) {
      for (let k = 0; k < o.n; k++) if (o.name[k] !== NO_NAME) o.name[k] = remap[o.name[k]] < 0 ? NO_NAME : remap[o.name[k]];
      if (sc.terrain) for (const s of sc.terrain.slots) if (s.name !== NO_NAME) s.name = remap[s.name] < 0 ? NO_NAME : remap[s.name];
      sc.meta.names = list;
      return;
    }
  }
  throw new ExtractError("This map is too big for exact seasons.");
}

const KEEP_WORDS = /lava|magma|water|acid/i;

/** TERR (3.3), the crop's slots with weight; plus the pack slots with weight (for the pack count). */
function terrainGrid(L: Level, W: number, H: number, crop: Box, names: Names, warnings: string[]):
  { grid: TerrainGrid | null; packSlots: Array<{ source: string; packId?: string }> } {
  const t = L.terrain;
  const none = { grid: null, packSlots: [] };
  if (!t || !t.enabled || t.width < 1 || t.height < 1) return none;
  const nw = t.width, nh = t.height, plane = nw * nh;
  let tps: 1 | 2 | 4 = Math.max(W, H) <= EXTRACT.tps4Side ? 4 : 2;
  // The crop in native texels (4 a square), plus one texel.
  const n0x = Math.max(0, Math.floor(crop[0] / (GRID / 4)) - 1), n1x = Math.min(nw, Math.ceil(crop[2] / (GRID / 4)) + 1);
  const n0y = Math.max(0, Math.floor(crop[1] / (GRID / 4)) - 1), n1y = Math.min(nh, Math.ceil(crop[3] / (GRID / 4)) + 1);
  if (n1x <= n0x || n1y <= n0y) return none;
  const used: number[] = [];
  let bad = 0;
  for (let s = 0; s < t.slotCount; s++) {
    let any = false;
    for (let y = n0y; y < n1y && !any; y++) for (let x = n0x; x < n1x; x++) if (t.weights[s * plane + y * nw + x] > 0) { any = true; break; }
    if (any) used.push(s);
  }
  // Older maps (0.9 to 1.0) save texels whose weights sum well under 255 (150-250 is common), which
  // Dungeondraft draws as shares of their sum: such texels are scaled up to 255. Texels with next to
  // no weight at all (a modded slot that couldn't be read) are left alone, and the GM is told.
  // (Over the crop grown by 3 texels, which box-averaging below 4 texels a square may reach.)
  const e0x = Math.max(0, n0x - 3), e1x = Math.min(nw, n1x + 3), e0y = Math.max(0, n0y - 3), e1y = Math.min(nh, n1y + 3);
  const cw = e1x - e0x;
  const fac = new Float32Array(cw * (e1y - e0y)).fill(1);
  for (let y = e0y; y < e1y; y++) for (let x = e0x; x < e1x; x++) {
    let sum = 0;
    for (let s = 0; s < t.slotCount; s++) sum += t.weights[s * plane + y * nw + x];
    if (sum < EXTRACT.termSum) { if (y >= n0y && y < n1y && x >= n0x && x < n1x) bad++; }
    else if (sum < EXTRACT.termFull) fac[(y - e0y) * cw + x - e0x] = 255 / sum;
  }
  if (bad > EXTRACT.termBad * (n1x - n0x) * (n1y - n0y)) warnings.push("Some terrain couldn't be read (a mod?): it stays as drawn.");
  if (used.length === 0) return none;
  const size = (k: number) => {
    const f = 4 / k;
    return [Math.floor(n0x / f), Math.ceil(n1x / f), Math.floor(n0y / f), Math.ceil(n1y / f)];
  };
  for (;;) {
    const [a, b, c, d] = size(tps);
    if ((b - a) * (d - c) * used.length <= SIDECAR_CAPS.terrainBytes && b - a <= 65535 && d - c <= 65535) break;
    if (tps === 1) throw new ExtractError("This map is too big for exact seasons.");
    tps = tps === 4 ? 2 : 1;
  }
  const [tx0, tx1, ty0, ty1] = size(tps);
  const tw = tx1 - tx0, th = ty1 - ty0, f = 4 / tps;
  const w = new Uint8Array(used.length * tw * th);
  used.forEach((s, k) => {
    const base = s * plane, out = k * tw * th;
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        let sum = 0, cnt = 0;
        for (let dy = 0; dy < f; dy++) {
          const ny = (ty0 + ty) * f + dy;
          if (ny >= nh) continue;
          for (let dx = 0; dx < f; dx++) {
            const nx = (tx0 + tx) * f + dx;
            if (nx >= nw) continue;
            const fi = (ny - e0y) * cw + nx - e0x;
            sum += t.weights[base + ny * nw + nx] * (ny >= e0y && ny < e1y && nx >= e0x && nx < e1x ? fac[fi] : 1);
            cnt++;
          }
        }
        w[out + ty * tw + tx] = cnt > 0 ? Math.min(255, Math.round(sum / cnt)) : 0;
      }
    }
  });
  const unknown: string[] = [];
  const packSlots: Array<{ source: string; packId?: string }> = [];
  const slots = used.map((s) => {
    const ref = t.slots[s];
    const nm = defaultName(ref);
    const role = terrainRole(nm);
    if (nm !== null && role === TR.KEEP && !KEEP_WORDS.test(nm) && !unknown.includes(nm)) unknown.push(nm);
    if (ref?.source === "pack") packSlots.push(ref);
    return { name: nm === null ? NO_NAME : names.of(nm), role };
  });
  if (unknown.length) warnings.push(`Some of this map's ground textures aren't ones Tabletop knows (${unknown.join(", ")}), so they stay as drawn.`);
  return { grid: { tps, tx0, ty0, tw, th, slots, w }, packSlots };
}

/** A marching-squares grid's samples covering the crop (plus one sample), as a BITS layer; null when none is set. */
function cropBits(g: BitGrid, crop: Box, role: AreaRole, layer: number): BitmapLayer | null {
  const B = MS_EDGE_BUFFER, s = g.step;
  if (!(s > 0) || s > 65535 || !Number.isInteger(s)) return null;
  const i0 = Math.max(0, Math.floor(crop[0] / s) + B - 1), i1 = Math.min(g.width - 1, Math.ceil(crop[2] / s) + B + 1);
  const j0 = Math.max(0, Math.floor(crop[1] / s) + B - 1), j1 = Math.min(g.height - 1, Math.ceil(crop[3] / s) + B + 1);
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  if (w < 1 || h < 1 || w > 65535 || h > 65535 || w * h > SIDECAR_CAPS.bitmapBits) return null;
  const bits = new Uint8Array(Math.ceil((w * h) / 8));
  let any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (g.bits[(j0 + y) * g.width + i0 + x]) { const k = y * w + x; bits[k >> 3] |= 1 << (k & 7); any = true; }
  }
  if (!any) return null;
  return { role, layer, step: s, ox: (i0 - B) * s, oy: (j0 - B) * s, w, h, bits };
}

/** CAVE_RIM: a band EXTRACT.rim wide outside the cave floor, not where the cave is blasted open (4.1) [L]. */
function caveRim(floor: BitGrid, entrance: BitGrid | null, crop: Box): BitmapLayer | null {
  let s: number = EXTRACT.rimStep;
  const ox = Math.floor(crop[0] / s) * s, oy = Math.floor(crop[1] / s) * s;
  let w = Math.ceil((crop[2] - ox) / s) + 1, h = Math.ceil((crop[3] - oy) / s) + 1;
  while (w * h > SIDECAR_CAPS.bitmapBits || w > 65535 || h > 65535) {
    s *= 2;
    w = Math.ceil((crop[2] - ox) / s) + 1;
    h = Math.ceil((crop[3] - oy) / s) + 1;
  }
  const n = w * h;
  const inside = new Uint8Array(n);
  let any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (bitAt(floor, ox + x * s, oy + y * s) >= 0.5) { inside[y * w + x] = 1; any = true; }
  }
  if (!any) return null;
  // Chamfer distance (in samples, 1 and sqrt 2) from the floor.
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = inside[i] ? 0 : 1e9;
  const R2 = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + 1);
    if (y > 0) {
      m = Math.min(m, d[i - w] + 1);
      if (x > 0) m = Math.min(m, d[i - w - 1] + R2);
      if (x < w - 1) m = Math.min(m, d[i - w + 1] + R2);
    }
    d[i] = m;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    let m = d[i];
    if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
    if (y < h - 1) {
      m = Math.min(m, d[i + w] + 1);
      if (x < w - 1) m = Math.min(m, d[i + w + 1] + R2);
      if (x > 0) m = Math.min(m, d[i + w - 1] + R2);
    }
    d[i] = m;
  }
  const r = EXTRACT.rim / s;
  const bits = new Uint8Array(Math.ceil(n / 8));
  let rim = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (inside[i] || d[i] > r) continue;
    if (entrance && bitAt(entrance, ox + x * s, oy + y * s) >= 0.5) continue;
    bits[i >> 3] |= 1 << (i & 7);
    rim = true;
  }
  return rim ? { role: AR.CAVE_RIM, layer: DD_LAYER.CAVE, step: s, ox, oy, w, h, bits } : null;
}

/** The floor polygons that count (nearFloors), positive, with their boxes. */
interface Floors {
  polys: Float64Array[];
  boxes: Box[];
  points: number;
}

/**
 * The floor polygons reaching the crop grown by a square (no other can touch the picture). More
 * of them than a sidecar can hold, or more than EXTRACT.floorWork to fill them over the picture's
 * rows (`rows` of `perRow` world units from `top`: each polygon's points over the rows it spans,
 * times the sort of a row's crossings, as fillPolygons works), and the map is refused.
 */
function nearFloors(L: Level, crop: Box, top: number, perRow: number, rows: number): Floors {
  const near: Box = [crop[0] - GRID, crop[1] - GRID, crop[2] + GRID, crop[3] + GRID];
  const polys: Float64Array[] = [], boxes: Box[] = [];
  let points = 0;
  for (const p of L.floorPolygons) {
    if (p.length < 6) continue;
    const b = ringBox(p);
    if (!overlaps(b, near)) continue;
    polys.push(positive(p));
    boxes.push(b);
    points += p.length >> 1;
    if (polys.length > SIDECAR_CAPS.rings || points > SIDECAR_CAPS.points) throw new ExtractError("This map is too big for exact seasons.");
  }
  if (perRow > 0 && Number.isFinite(perRow)) {
    const sort = Math.ceil(Math.log2(points + 2));
    let work = 0;
    for (let k = 0; k < polys.length; k++) {
      const a = Math.max(0, Math.floor((boxes[k][1] - top) / perRow)), b = Math.min(rows, Math.ceil((boxes[k][3] - top) / perRow));
      if (b > a) work += (polys[k].length >> 1) * (b - a) * sort;
    }
    if (work > EXTRACT.floorWork) throw new ExtractError("This map is too big for exact seasons.");
  }
  return { polys, boxes, points };
}

/**
 * Building floors (4.1: floor polygons ∩ tile cells; tiles without polygons): per row, runs of
 * tiled cells whose centre lies in a floor polygon take those polygons clipped to the run; a
 * tiled cell whose centre lies outside but that a polygon's box reaches takes the polygons
 * clipped to the cell, and is a whole cell only when none of them touches it (M2: Tulgi's round
 * hut tiles the cells its circle crosses, and the corners outside the circle are snow in the
 * export); runs of tiled cells no polygon reaches are whole cells. Without tiles, the polygons as
 * they are. `floors`: the polygons that count (nearFloors); more work than EXTRACT.floorWork, and
 * the map is refused.
 */
function floorShape(L: Level, crop: Box, floors: Floors): ShapeLayer | null {
  const sb = new ShapeBuilder(AR.FLOOR, DD_LAYER.FLOOR, 1, crop);
  const { polys, boxes, points } = floors;
  const tooBig = () => new ExtractError("This map is too big for exact seasons.");
  const t = L.tiles;
  let anyTile = false;
  if (t) for (const c of t.cells) if (c >= 0) { anyTile = true; break; }
  if (!t || !anyTile) {
    for (const p of polys) sb.ring(p);
    return sb.build();
  }
  const cx0 = Math.max(0, Math.floor(crop[0] / GRID)), cx1 = Math.min(t.width, Math.ceil(crop[2] / GRID));
  const cy0 = Math.max(0, Math.floor(crop[1] / GRID)), cy1 = Math.min(t.height, Math.ceil(crop[3] / GRID));
  if (cx1 <= cx0 || cy1 <= cy0) return sb.build();
  const ww = cx1 - cx0;
  const work = { left: EXTRACT.floorWork };
  // Cells whose centre lies in a polygon, over the crop's cells. The fill costs at most each edge
  // over the rows it spans, times the sort of a row's crossings.
  const inPoly = new Uint8Array(ww * (cy1 - cy0));
  if (polys.length) {
    const sort = Math.ceil(Math.log2(points + 2));
    polys.forEach((p, k) => {
      const rows = Math.min(cy1, Math.ceil(boxes[k][3] / GRID)) - Math.max(cy0, Math.floor(boxes[k][1] / GRID));
      if (rows > 0) work.left -= (p.length >> 1) * rows * sort;
    });
    if (work.left < 0) throw tooBig();
    const spec: RasterSpec = { width: ww, height: cy1 - cy0, originX: cx0 * GRID, originY: cy0 * GRID, unitsPerPx: GRID };
    fillPolygons(inPoly, spec, polys, 1, "nonzero");
  }
  // The polygons whose boxes reach each row, in their order: by top, with those ended dropped.
  const byTop = polys.map((_, k) => k).sort((a, b) => boxes[a][1] - boxes[b][1] || a - b);
  let next = 0;
  let active: number[] = [];
  for (let cy = cy0; cy < cy1; cy++) {
    const top = cy * GRID, bottom = (cy + 1) * GRID;
    let added = false;
    while (next < byTop.length && boxes[byTop[next]][1] < bottom) { active.push(byTop[next++]); added = true; }
    work.left -= active.length;
    active = active.filter((k) => boxes[k][3] > top);
    if (added) active.sort((a, b) => a - b);
    const row = (cy - cy0) * ww;
    // 0: no polygon's box reaches the cell; 1: its centre lies in a polygon; 2: a box reaches it, its centre outside.
    const kind = (cx: number): number => {
      if (inPoly[row + cx - cx0]) return 1;
      const l = cx * GRID, r = l + GRID;
      for (const k of active) { const b = boxes[k]; if (b[2] > l && b[0] < r) return 2; }
      return 0;
    };
    let cx = cx0;
    while (cx < cx1) {
      const i = cy * t.width + cx;
      if (t.cells[i] < 0) { cx++; continue; }
      const flag = kind(cx);
      work.left -= active.length;
      let e = cx + 1;
      if (flag !== 2) while (e < cx1 && t.cells[cy * t.width + e] >= 0 && kind(e) === flag) { e++; work.left -= active.length; }
      const run: Box = [cx * GRID, top, e * GRID, bottom];
      if (!flag) {
        sb.ring(Float64Array.from([run[0], run[1], run[2], run[1], run[2], run[3], run[0], run[3]]));
      } else {
        let touched = false;
        for (const k of active) {
          const b = boxes[k];
          if (b[2] <= run[0] || b[0] >= run[2]) continue;
          // A clip allocates a ring and keeps it: about a microsecond, some 500 edge tests' time.
          work.left -= EXTRACT.clipWork + 4 * (polys[k].length >> 1);
          const c = clipRing(polys[k], run);
          if (c.length >= 6) { sb.ring(c); touched = true; }
        }
        // A tile no polygon touches is a floor of its own (the Floor tool's).
        if (flag === 2 && !touched) sb.ring(Float64Array.from([run[0], run[1], run[2], run[1], run[2], run[3], run[0], run[3]]));
      }
      if (work.left < 0) throw tooBig();
      cx = e;
    }
  }
  return sb.build();
}

/** Closed wall outlines (4.1): walls with `loop`, and chains of walls whose ends meet within a quarter square; cave walls left out. */
function wallLoops(L: Level): Float64Array[] {
  const out: Float64Array[] = [];
  const tol = EXTRACT.wallJoin;
  const open: Float64Array[] = [];
  for (const w of L.walls) {
    if (w.type === 2 || w.points.length < 4) continue;
    if (w.loop) { if (w.points.length >= 6) out.push(w.points); continue; }
    open.push(w.points);
  }
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) <= tol;
  // Wall ends bucketed in cells of side tol: a join is looked up in the 3 x 3 cells round an end.
  const cells = new Map<string, number[]>();
  const cellOf = (x: number, y: number) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
  open.forEach((p, k) => {
    for (const e of [0, 1]) {
      const i = e ? p.length - 2 : 0;
      const key = cellOf(p[i], p[i + 1]);
      const list = cells.get(key);
      if (list) list.push(k * 2 + e);
      else cells.set(key, [k * 2 + e]);
    }
  });
  const usedW = new Uint8Array(open.length);
  /** An unused wall with an end within tol of (x, y): its index * 2 + (1 when that end is its last point). */
  const joinAt = (x: number, y: number): number => {
    const cx = Math.floor(x / tol), cy = Math.floor(y / tol);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const ke of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const k = ke >> 1, p = open[k], i = ke & 1 ? p.length - 2 : 0;
        if (!usedW[k] && near(x, y, p[i], p[i + 1])) return ke;
      }
    }
    return -1;
  };
  for (let s = 0; s < open.length; s++) {
    if (usedW[s]) continue;
    usedW[s] = 1;
    const chain: number[] = Array.from(open[s]);
    for (;;) {
      const ex = chain[chain.length - 2], ey = chain[chain.length - 1];
      if (chain.length >= 6 && near(ex, ey, chain[0], chain[1])) break;
      const ke = joinAt(ex, ey);
      if (ke < 0) break;
      const found = ke >> 1, rev = (ke & 1) === 1;
      usedW[found] = 1;
      const p = open[found], m = p.length >> 1;
      for (let q = 1; q < m; q++) {
        const i = rev ? m - 1 - q : q;
        chain.push(p[i * 2], p[i * 2 + 1]);
      }
    }
    const m = chain.length;
    if (m >= 6 && near(chain[m - 2], chain[m - 1], chain[0], chain[1])) out.push(Float64Array.from(chain.slice(0, m - 2)));
  }
  return out.filter((r) => r.length >= 6 && Math.abs(ringArea(r)) > 0);
}

// ---------------------------------------------------------------- snow share (4.2) and water (2.6)

/** The sidecar's snowShare (4.2), from its own raster: visible SNOW (terrain and ground-level SNOW objects) over the open soft ground. */
function groundShares(sc: SeasonSidecar): { snowShare: number; packGround: boolean } {
  const [x0, y0, x1, y1] = sc.meta.rect;
  const sw = (x1 - x0) / GRID, sh = (y1 - y0) / GRID;
  const pps = Math.min(EXTRACT.sharePps, EXTRACT.shareMax / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * pps)), h = Math.max(1, Math.round(sh * pps));
  // "Visible outdoor" ground: not under floors, caves, roofs, walls, water or pack items, so of
  // the objects only pack items stay in this raster (the ground under a tree counts), and
  // ground-level SNOW objects, which count as snow. Roof snow (on the roof layers) isn't ground.
  const o = sc.objects;
  const keep: number[] = [];
  for (let i = 0; i < o.n; i++) {
    let role = o.role[i];
    if (o.name[i] !== NO_NAME) role = objectRole(sc.meta.names[o.name[i]]);
    if (role === OR.OPAQUE || (role === OR.SNOW && o.layer[i] < DD_LAYER.ROOF)) keep.push(i);
  }
  const view: SeasonSidecar = { ...sc, objects: keep.length === o.n ? o : subTable(o, keep) };
  const Ly = rasterSidecar(view, { w, h });
  const sum = (p: Uint8Array | undefined) => { let s = 0; if (p) for (const v of p) s += v; return s; };
  const snow = sum(Ly.terrain.get(TR.SNOW)) + sum(Ly.objects.get(OR.SNOW));
  const soft = snow + sum(Ly.terrain.get(TR.ICE)) + sum(Ly.terrain.get(TR.GRASS)) + sum(Ly.terrain.get(TR.EARTH)) + sum(Ly.terrain.get(TR.SAND));
  const hard = sum(Ly.terrain.get(TR.ROCK)) + sum(Ly.terrain.get(TR.PAVED));
  const keepT = sum(Ly.terrain.get(TR.KEEP));
  const packSlot = !!sc.terrain && sc.terrain.slots.some((s) => s.name === NO_NAME);
  return { snowShare: soft > 0 ? round3(snow / soft) : 0, packGround: packSlot && keepT > soft + hard };
}

function subTable(o: ObjectTable, keep: number[]): ObjectTable {
  const n = keep.length;
  const t: ObjectTable = {
    n, role: new Uint8Array(n), layer: new Int16Array(n), x: new Int32Array(n), y: new Int32Array(n), rot: new Uint8Array(n),
    flags: new Uint8Array(n), name: new Uint16Array(n), reach: new Uint16Array(n * REACH_N),
  };
  keep.forEach((i, k) => {
    t.role[k] = o.role[i]; t.layer[k] = o.layer[i]; t.x[k] = o.x[i]; t.y[k] = o.y[i]; t.rot[k] = o.rot[i];
    t.flags[k] = o.flags[i]; t.name[k] = o.name[i];
    t.reach.set(o.reach.subarray(i * REACH_N, (i + 1) * REACH_N), k * REACH_N);
  });
  return t;
}

/**
 * Each water body by what the picture shows inside it (2.6), at least EXTRACT.shore from its shore
 * and outside objects: on a snowy map ICE when at least half are snow- or ice-coloured (iceColour);
 * WATER when at least half pass the pixel path's water-colour test (on a snowy map, of those that
 * aren't icy, as the pixel path takes ice first); KEEP otherwise. Sets each shape's role.
 */
function classifyWater(bodies: ShapeLayer[], sc: SeasonSidecar, pic: PictureSample, snowy: boolean, warnings: string[]): Array<"WATER" | "ICE" | "KEEP"> {
  if (bodies.length === 0) return [];
  const [x0, y0, x1, y1] = sc.meta.rect;
  const W = pic.w, H = pic.h;
  const sx = W / (x1 - x0), sy = H / (y1 - y0);
  const C = SIDECAR_UNITS.coord;
  const spec: RasterSpec = { width: W, height: H, originX: 0, originY: 0, unitsPerPx: 1 };
  // One work budget for the picture, spent on the objects' discs and the bodies' boxes (a file can
  // hold very many of both); what doesn't fit keeps WATER.
  const budget = workBudget(spec);
  let short = false;
  // Each body's rings and box, in picture pixels.
  const geo = bodies.map((s) => {
    const rings: Float64Array[] = [];
    let start = 0;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const e of s.ringEnds) {
      const r = new Float64Array((e - start) * 2);
      for (let k = 0; k < r.length; k += 2) {
        r[k] = (s.pts[start * 2 + k] / C - x0) * sx;
        r[k + 1] = (s.pts[start * 2 + k + 1] / C - y0) * sy;
        bx0 = Math.min(bx0, r[k]); bx1 = Math.max(bx1, r[k]); by0 = Math.min(by0, r[k + 1]); by1 = Math.max(by1, r[k + 1]);
      }
      rings.push(r);
      start = e;
    }
    return { rings, box: [bx0, by0, bx1, by1] as Box };
  });
  const all: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geo) {
    all[0] = Math.min(all[0], g.box[0]); all[1] = Math.min(all[1], g.box[1]);
    all[2] = Math.max(all[2], g.box[2]); all[3] = Math.max(all[3], g.box[3]);
  }
  // Objects: discs of their furthest reach (a little generous, the safe side), where they meet the water.
  const objMask = new Uint8Array(W * H);
  const o = sc.objects;
  for (let i = 0; i < o.n; i++) {
    let r = 0;
    for (let k = 0; k < REACH_N; k++) r = Math.max(r, o.reach[i * REACH_N + k] / SIDECAR_UNITS.reach);
    const cx = (o.x[i] / C - x0) * sx, cy = (o.y[i] / C - y0) * sy, rx = r * sx, ry = r * sy;
    if (!(rx > 0) || !overlaps([cx - rx, cy - ry, cx + rx, cy + ry], all)) continue;
    if (!fillEllipse(objMask, spec, { cx, cy, rx, ry, rotation: 0 }, 1, budget)) short = true;
  }
  const T = colourTable();
  const shorePx = EXTRACT.shore * GRID * Math.min(sx, sy);
  const out = bodies.map((s, bi) => {
    const { rings, box } = geo[bi];
    const [bx0, by0, bx1, by1] = box;
    const u0 = Math.max(0, Math.floor(bx0) - 1), u1 = Math.min(W, Math.ceil(bx1) + 1);
    const v0 = Math.max(0, Math.floor(by0) - 1), v1 = Math.min(H, Math.ceil(by1) + 1);
    let kind: "WATER" | "ICE" | "KEEP" = "WATER";
    if (u1 > u0 && v1 > v0 && (u1 - u0) * (v1 - v0) * 3 > budget.left) short = true;
    else if (u1 > u0 && v1 > v0) {
      const bw = u1 - u0, bh = v1 - v0;
      budget.left -= bw * bh * 3;
      const box2: RasterSpec = { width: bw, height: bh, originX: u0, originY: v0, unitsPerPx: 1 };
      const mask = new Uint8Array(bw * bh);
      fillPolygons(mask, box2, rings, 1, "evenodd");
      const depth = waterDepth(mask, box2);
      const count = (margin: number) => {
        let n = 0, wet = 0, white = 0;
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          const i = y * bw + x;
          if (!mask[i] || depth[i] < margin) continue;
          const pi = (v0 + y) * W + u0 + x;
          if (objMask[pi]) continue;
          const q = pi * 4;
          if (pic.rgba[q + 3] < 128) continue;
          const r = pic.rgba[q], g = pic.rgba[q + 1], b = pic.rgba[q + 2];
          const li = lutIndex(r, g, b);
          n++;
          if (snowy && (T[li + 3] >= 128 || iceColour(r, g, b))) white++;
          else if (T[li + 1] * T[li + 2] >= 128 * 255) wet++;
        }
        return { n, wet, white };
      };
      let c = count(shorePx);
      if (c.n < EXTRACT.waterPixels) c = count(0);
      if (c.n >= EXTRACT.waterPixels) {
        kind = snowy && 2 * c.white >= c.n ? "ICE" : 2 * c.wet >= c.n ? "WATER" : "KEEP";
      }
    }
    s.role = kind === "WATER" ? AR.WATER : kind === "ICE" ? AR.ICE : AR.KEEP;
    return kind;
  });
  if (short) warnings.push("This map has too much water and too many things in it to check all of it against the picture; the rest counts as water.");
  return out;
}

/**
 * The pixel path's ice test (seasonPixels' snow analysis, step 3): pale, bluer than red and not
 * less blue than green, a little colourful but not much. The pixel path asks for more blue than
 * red where its snow is bluish (6 more than the snow's); with no snow sample here, its floor of 12.
 */
function iceColour(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
  const lum = ((299 * r + 587 * g + 114 * b + 500) / 1000) | 0;
  return lum >= 140 && b >= g && b - r >= 12 && chroma >= 0.08 * max && chroma <= 0.35 * max;
}

function packNames(map: DDMap, ids: Set<string>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const p = map.header.packs.find((q) => q.id === id);
    const nm = p?.name?.trim();
    if (nm && !out.includes(nm)) out.push(nm);
  }
  if (out.length < ids.size && !out.includes("an asset pack")) {
    if ([...ids].some((id) => !map.header.packs.some((q) => q.id === id && q.name.trim()))) out.push("an asset pack");
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------- picture resampling

/** RGBA at w x h: box-averaged when smaller, bilinear when bigger; opaque. */
function resampleRGBA(pic: PictureSample, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = pic.w / w, fy = pic.h / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, k = 0;
      if (fx >= 1 && fy >= 1) {
        const xa = Math.floor(x * fx), xb = Math.max(xa + 1, Math.floor((x + 1) * fx));
        const ya = Math.floor(y * fy), yb = Math.max(ya + 1, Math.floor((y + 1) * fy));
        for (let sy = ya; sy < yb && sy < pic.h; sy++) for (let sx = xa; sx < xb && sx < pic.w; sx++) {
          const q = (sy * pic.w + sx) * 4, a = pic.rgba[q + 3] / 255;
          r += pic.rgba[q] * a; g += pic.rgba[q + 1] * a; b += pic.rgba[q + 2] * a; k++;
        }
      } else {
        const sx = Math.min(pic.w - 1, Math.max(0, (x + 0.5) * fx - 0.5)), sy = Math.min(pic.h - 1, Math.max(0, (y + 0.5) * fy - 0.5));
        const xa = Math.floor(sx), ya = Math.floor(sy), xb = Math.min(pic.w - 1, xa + 1), yb = Math.min(pic.h - 1, ya + 1);
        const tx = sx - xa, ty = sy - ya;
        for (const [px, py, wgt] of [[xa, ya, (1 - tx) * (1 - ty)], [xb, ya, tx * (1 - ty)], [xa, yb, (1 - tx) * ty], [xb, yb, tx * ty]]) {
          const q = (py * pic.w + px) * 4, a = (pic.rgba[q + 3] / 255) * wgt;
          r += pic.rgba[q] * a; g += pic.rgba[q + 1] * a; b += pic.rgba[q + 2] * a;
        }
        k = 1;
      }
      out[o] = k ? r / k : 0;
      out[o + 1] = k ? g / k : 0;
      out[o + 2] = k ? b / k : 0;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Maps made in Dungeon (dungeon.parhome.ca) as a parsed Dungeondraft map, so they get exact
// seasons the way Dungeondraft maps do. Pure (no DOM): it runs in the GM's dd worker.
//
// Dungeon's Universal VTT export carries the whole map under the key "dungeon" (its spec is
// Dungeon's src/io/payload.ts). mapImport.ts hands that payload to the worker as the picture's
// project file; here it becomes a DDMap with one level, and everything after (picking the level,
// the fit, measuring, compiling the sidecar) is the Dungeondraft path unchanged.
//
// What goes where (world units: Dungeon's cells x GRID):
// - Terrain: slot 1 is Dungeon's ground, slots 2-4 its three paint slots. Dungeon draws each
//   paint slot over everything before it, so weights are w4 = m3, w3 = m2(1 - m3),
//   w2 = m1(1 - m2)(1 - m3) and the ground the rest. Both keep 4 texels a square.
// - Caves: the bitmap Dungeondraft keeps, at its lattice points (4 a square, MS_EDGE_BUFFER all
//   round, step 64), sampled from Dungeon's square-centred raster; the cave edge as drawn is a
//   wall of type 2, as a Dungeondraft cave's is.
// - Floors: Dungeon's floor polygons, each with its holes joined in by a zero-width cut, since
//   the extractor fills every floor polygon "nonzero" after turning it positive.
// - Walls: the room outlines (type 0, closed) and hand-drawn walls (type 1) as Dungeon draws
//   them, with their doors; doors on no wall are freestanding portals.
// - Water: the edges as drawn, nested by containment into Dungeondraft's tree.
// - Paths, objects and lights as placed. Objects' layers: on the floor 100, standing 200,
//   overhead 700 (above walls, where Dungeondraft keeps treetops).
// - Names: Dungeon's built-in textures and objects are what Dungeondraft's default assets are
//   to the extractor (known names, known sizes): source "default", named "dungeon/<id>", so
//   roles.ts's keyword rules give their roles ("dungeon/pine" EVERGREEN, "dungeon/snow" SNOW).
//   Pictures a user imported are "embedded" (as drawn), as a Dungeondraft map's would be.

import {
  CAVE_PER_SQUARE, DEFAULT_LIMITS, GRID, MS_EDGE_BUFFER, TERRAIN_PER_SQUARE,
  type AssetRef, type BitGrid, type DDMap, type Level, type Light, type MapObject, type Path, type Portal, type Terrain,
  type Wall, type WaterNode,
} from "./model";
import { DDParseError, checkJsonShape } from "./parse";
import type { SpriteSizes } from "./measure";
import { REACH_DIRS } from "./raster";

export const DUNGEON_FORMAT = "dungeon-map";
/** Payload versions this reads. 2 added the shapes as Dungeon draws them, which it needs. */
const MIN_VERSION = 2;
const MAX_VERSION = 2;
/** Dungeon's maps are at most 120 cells a side; anything past the parser's limit is refused. */
const MAX_SIDE = DEFAULT_LIMITS.maxSide;
/** Paint samples a cell in Dungeon's rasters (caves, water, terrain). */
const RES = 4;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Whether a file's text starts like a Dungeon map (a payload, or a saved .dmap). */
export function looksLikeDungeon(head: string): boolean {
  return /^\s*\{\s*"format"\s*:\s*"dungeon-map"/.test(head.replace(/^﻿/, ""));
}

/** A Dungeon map as Dungeondraft's model, and the sizes of the objects it uses (for measuring). */
export interface DungeonMap {
  map: DDMap;
  sizes: SpriteSizes;
}

/** Reads a Dungeon payload. Throws DDParseError (the worker calls the file damaged) when it can't. */
export function parseDungeonPayload(text: string): DungeonMap {
  if (typeof text !== "string") throw new DDParseError("input is not text");
  if (text.length > DEFAULT_LIMITS.maxChars) throw new DDParseError("file too large");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  checkJsonShape(text, DEFAULT_LIMITS);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new DDParseError("not JSON");
  }
  if (!isObj(root) || root.format !== DUNGEON_FORMAT) throw new DDParseError("not a Dungeon map");
  const version = root.payloadVersion;
  if (!fin(version) || version < MIN_VERSION || version > MAX_VERSION) throw new DungeonVersionError(fin(version) ? version : 0);
  const W = root.width;
  const H = root.height;
  if (!fin(W) || !fin(H) || !Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1 || W > MAX_SIDE || H > MAX_SIDE) {
    throw new DDParseError("bad map size");
  }
  const budget = { points: DEFAULT_LIMITS.maxTotalPoints, items: DEFAULT_LIMITS.maxTotalItems };
  const b = new Builder(W, H, root, budget);
  return { map: b.map(), sizes: b.sizes() };
}

/** A payload from a Dungeon too old (version 1, without shapes) or newer than this Tabletop knows. */
export class DungeonVersionError extends DDParseError {
  constructor(readonly version: number) {
    super(`Dungeon payload version ${version}`);
  }
}

// ---------------------------------------------------------------- reading

interface Raster {
  w: number;
  h: number;
  data: Uint8Array;
}

class Builder {
  private nextId = 1;
  private readonly catalog: { props: Obj; materials: Obj };
  private readonly shapes: Obj;

  constructor(
    private readonly W: number,
    private readonly H: number,
    private readonly root: Obj,
    private readonly budget: { points: number; items: number },
  ) {
    const cat = isObj(root.catalog) ? root.catalog : {};
    this.catalog = { props: isObj(cat.props) ? cat.props : {}, materials: isObj(cat.materials) ? cat.materials : {} };
    this.shapes = isObj(root.shapes) ? root.shapes : {};
  }

  map(): DDMap {
    const level: Level = {
      key: "0",
      id: 0,
      label: typeof this.root.name === "string" && this.root.name.trim() ? this.root.name.trim().slice(0, 120) : "Map",
      layers: new Map(),
      ambientLight: null,
      bakedLighting: false,
      terrain: this.terrain(),
      water: { disableBorder: false, root: this.water() },
      cave: null,
      tiles: null,
      floorPolygons: this.floors(),
      floorWallIds: [],
      materials: [],
      patterns: [],
      walls: [],
      portals: [],
      paths: this.paths(),
      objects: this.objects(),
      lights: this.lights(),
      roofs: [],
      roofShade: null,
      textCount: arr(this.root.texts).length,
    };
    const cave = this.caveBits();
    if (cave) level.cave = { floor: cave, entrance: null, groundColor: null, wallColor: null, texture: this.ref("terrain", "cave") };
    const { walls, portals } = this.walls();
    level.walls = walls;
    level.portals = portals;
    return {
      header: {
        creationBuild: "dungeon",
        creationDate: null,
        usesDefaultAssets: true,
        packs: [],
        currentLevel: 0,
        cameraPosition: null,
        cameraZoom: null,
        hasTraceImage: false,
      },
      world: {
        format: null,
        width: this.W,
        height: this.H,
        nextNodeId: this.nextId,
        gridColor: null,
        wallShadow: true,
        objectShadow: true,
        embeddedCount: 0,
        msi: null,
        levels: [level],
      },
      warnings: [],
    };
  }

  /** Sizes for measureObjects: each built-in object's box as an ellipse, at scale 1. */
  sizes(): SpriteSizes {
    const out: Record<string, { r: number; reach: number[] }> = {};
    for (const [id, p] of Object.entries(this.catalog.props)) {
      if (!ID_RE.test(id) || !isObj(p) || !fin(p.w) || !fin(p.h) || p.w <= 0 || p.h <= 0 || p.w > 64 || p.h > 64) continue;
      out[`dungeon/${id}`] = ellipse((p.w / 2) * GRID, (p.h / 2) * GRID);
    }
    return out;
  }

  /** A built-in texture or object by Dungeon id, named "dungeon/<id>"; null for an id that isn't plain. */
  ref(kind: string, id: unknown): AssetRef | null {
    if (typeof id !== "string" || !ID_RE.test(id)) return null;
    return { path: `dungeon://${kind}/${id}`, source: "default", segments: [kind, "dungeon", id] };
  }

  private id(): number {
    return this.nextId++;
  }

  private item(): boolean {
    return --this.budget.items >= 0;
  }

  /** A flat [x0, y0, x1, y1, ...] list in cells as world coordinates, or null when it isn't one. */
  private line(v: unknown, minPoints: number): Float64Array | null {
    if (!Array.isArray(v) || v.length % 2 !== 0 || v.length < minPoints * 2) return null;
    if (v.length / 2 > DEFAULT_LIMITS.maxPointsPerShape || (this.budget.points -= v.length / 2) < 0) {
      throw new DDParseError("too many points");
    }
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const n = v[i];
      if (!fin(n) || Math.abs(n) > MAX_SIDE * 4) return null;
      out[i] = n * GRID;
    }
    return out;
  }

  private raster(v: unknown): Raster | null {
    if (!isObj(v) || v.res !== RES || v.w !== this.W * RES || v.h !== this.H * RES || typeof v.b64 !== "string") return null;
    let data: Uint8Array;
    try {
      const s = atob(v.b64);
      data = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) data[i] = s.charCodeAt(i);
    } catch {
      return null;
    }
    return data.length === v.w * v.h ? { w: v.w, h: v.h, data } : null;
  }

  private terrain(): Terrain | null {
    const t = isObj(this.root.terrain) ? this.root.terrain : null;
    if (!t) return null;
    const tw = this.W * TERRAIN_PER_SQUARE;
    const th = this.H * TERRAIN_PER_SQUARE;
    const n = tw * th;
    const masks = arr(t.masks).slice(0, 3).map((m) => this.raster(m));
    const slots: (AssetRef | null)[] = [this.ref("terrain", t.base), ...[0, 1, 2].map((i) => this.ref("terrain", arr(t.slots)[i])), null, null, null, null];
    const weights = new Uint8Array(8 * n);
    for (let i = 0; i < n; i++) {
      const a1 = (masks[0]?.data[i] ?? 0) / 255;
      const a2 = (masks[1]?.data[i] ?? 0) / 255;
      const a3 = (masks[2]?.data[i] ?? 0) / 255;
      const w4 = Math.round(a3 * 255);
      const w3 = Math.round(a2 * (1 - a3) * 255);
      const w2 = Math.round(a1 * (1 - a2) * (1 - a3) * 255);
      weights[3 * n + i] = w4;
      weights[2 * n + i] = w3;
      weights[n + i] = w2;
      weights[i] = Math.max(0, 255 - w2 - w3 - w4);
    }
    return { enabled: true, expandSlots: false, smoothBlending: true, slots, width: tw, height: th, weights, slotCount: 4 };
  }

  /** Dungeondraft's cave bitmap: its lattice points, sampled bilinearly from Dungeon's square-centred raster. */
  private caveBits(): BitGrid | null {
    const r = this.raster(this.root.caves);
    if (!r) return null;
    const B = MS_EDGE_BUFFER;
    const w = this.W * CAVE_PER_SQUARE + 2 * B + 1;
    const h = this.H * CAVE_PER_SQUARE + 2 * B + 1;
    const bits = new Uint8Array(w * h);
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= r.w || y >= r.h ? 0 : r.data[y * r.w + x]);
    let any = false;
    for (let y = 0; y < h; y++) {
      // Lattice point y sits (y - B) / 4 cells down; Dungeon's sample j sits (j + 0.5) / 4 cells down.
      const sy = y - B - 0.5;
      const y0 = Math.floor(sy);
      const fy = sy - y0;
      for (let x = 0; x < w; x++) {
        const sx = x - B - 0.5;
        const x0 = Math.floor(sx);
        const fx = sx - x0;
        const v =
          at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
        if (v >= 128) {
          bits[y * w + x] = 1;
          any = true;
        }
      }
    }
    return any ? { width: w, height: h, step: GRID / CAVE_PER_SQUARE, bits } : null;
  }

  /** Each floor polygon as one ring (its holes joined in), in world units. */
  private floors(): Float64Array[] {
    const out: Float64Array[] = [];
    for (const f of arr(this.root.floors)) {
      if (!isObj(f)) continue;
      for (const poly of arr(f.shape)) {
        if (!this.item()) throw new DDParseError("too many items");
        const rings: Float64Array[] = [];
        for (const ring of arr(poly)) {
          const flat = Array.isArray(ring) ? ring.flatMap((p) => (Array.isArray(p) && p.length === 2 ? p : [NaN, NaN])) : null;
          const r = this.line(flat, 3);
          if (r) rings.push(r);
        }
        if (rings.length) out.push(withHoles(rings[0], rings.slice(1)));
      }
    }
    return out;
  }

  private walls(): { walls: Wall[]; portals: Portal[] } {
    const s = this.shapes;
    const wallTexture = this.ref("walls", typeof this.root.wallStyle === "string" ? `wall-${this.root.wallStyle}` : null);
    const walls: Wall[] = [];
    // Index in shapes.walls -> index in `walls`, for doors.
    const byShape = new Map<number, number>();
    arr(s.walls).forEach((w, i) => {
      if (!isObj(w) || !this.item()) return;
      const points = this.line(w.points, 2);
      if (!points) return;
      byShape.set(i, walls.length);
      walls.push({
        points,
        texture: wallTexture,
        color: null,
        loop: w.closed === true,
        type: w.kind === "room" ? 0 : 1,
        joint: 0,
        shadow: true,
        nodeId: this.id(),
        portals: [],
      });
    });
    for (const ring of arr(s.caves)) {
      if (!this.item()) break;
      const points = this.line(ring, 3);
      if (points) walls.push({ points, texture: this.ref("terrain", "cave"), color: null, loop: true, type: 2, joint: 2, shadow: true, nodeId: this.id(), portals: [] });
    }
    const portals: Portal[] = [];
    for (const d of arr(s.doors)) {
      if (!isObj(d) || !fin(d.x) || !fin(d.y) || !fin(d.angle) || !fin(d.width) || !this.item()) continue;
      const wi = fin(d.wall) ? byShape.get(d.wall) : undefined;
      const wall = wi === undefined ? null : walls[wi];
      const p: Portal = {
        position: { x: d.x * GRID, y: d.y * GRID },
        rotation: d.angle,
        scale: { x: 1, y: 1 },
        direction: { x: Math.cos(d.angle), y: Math.sin(d.angle) },
        texture: this.ref("portals", d.kind),
        radius: Math.min(DEFAULT_LIMITS.maxWidth, Math.max(0, (d.width / 2) * GRID)),
        closed: d.kind !== "arch",
        wallId: wall ? wall.nodeId : null,
        wallDistance: wall && fin(d.at) ? d.at : null,
        nodeId: this.id(),
      };
      if (wall) wall.portals.push(p);
      else portals.push(p);
    }
    return { walls, portals };
  }

  /** The water's edges nested into Dungeondraft's tree: bodies at depth 1, islands at 2, and so on. */
  private water(): WaterNode | null {
    const rings: Float64Array[] = [];
    for (const r of arr(this.shapes.water)) {
      if (!this.item()) break;
      const ring = this.line(r, 3);
      if (ring) rings.push(ring);
    }
    if (!rings.length) return null;
    if (rings.length > DEFAULT_LIMITS.maxWaterNodes) throw new DDParseError("too much water");
    const area = rings.map((r) => Math.abs(signedArea(r)));
    // Each ring's parent: the smallest ring holding its first point.
    const parent = rings.map((r, i) => {
      let best = -1;
      rings.forEach((o, j) => {
        if (j !== i && area[j] > area[i] && inRing(r[0], r[1], o) && (best < 0 || area[j] < area[best])) best = j;
      });
      return best;
    });
    const node = (polygon: Float64Array, depth: number): WaterNode => ({
      ref: null, polygon, depth, isOpen: false, deepColor: null, shallowColor: null, blendDistance: null, children: [],
    });
    const root = node(new Float64Array(0), 0);
    const nodes = rings.map((r) => node(r, 0));
    const place = (i: number, depth: number): void => {
      if (depth > DEFAULT_LIMITS.maxWaterDepth) return;
      nodes[i].depth = depth;
      rings.forEach((_, j) => {
        if (parent[j] === i) {
          nodes[i].children.push(nodes[j]);
          place(j, depth + 1);
        }
      });
    };
    rings.forEach((_, i) => {
      if (parent[i] < 0) {
        root.children.push(nodes[i]);
        place(i, 1);
      }
    });
    return root;
  }

  private paths(): Path[] {
    const out: Path[] = [];
    for (const p of arr(this.shapes.paths)) {
      if (!isObj(p) || !fin(p.width) || !this.item()) continue;
      const editPoints = this.line(p.points, 2);
      if (!editPoints) continue;
      out.push({
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        editPoints,
        // Already smoothed by Dungeon: the points are the line it draws.
        smoothness: 0,
        texture: this.ref("paths", p.material),
        width: Math.min(DEFAULT_LIMITS.maxWidth, Math.max(0, p.width * GRID)),
        // Under floors and caves, as Dungeon draws them.
        layer: -360,
        fadeIn: false,
        fadeOut: false,
        grow: false,
        shrink: false,
        blockLight: false,
        loop: false,
        nodeId: this.id(),
      });
    }
    return out;
  }

  private objects(): MapObject[] {
    const out: MapObject[] = [];
    const LAYER: Record<string, number> = { floor: 100, object: 200, canopy: 700 };
    for (const o of arr(this.root.objects)) {
      if (!isObj(o) || !fin(o.x) || !fin(o.y) || !this.item()) continue;
      const asset = typeof o.asset === "string" ? o.asset : "";
      const scale = fin(o.scale) ? Math.max(-DEFAULT_LIMITS.maxScale, Math.min(DEFAULT_LIMITS.maxScale, o.scale)) : 1;
      out.push({
        position: { x: o.x * GRID, y: o.y * GRID },
        rotation: fin(o.rot) ? o.rot : 0,
        scale: { x: scale, y: scale },
        texture: asset.startsWith("b:")
          ? this.ref("objects", asset.slice(2))
          : { path: `dungeon://image/${asset.slice(0, 64)}`, source: "embedded", segments: [] },
        mirror: false,
        layer: LAYER[typeof o.layer === "string" ? o.layer : ""] ?? 200,
        shadow: o.shadow === true,
        blockLight: false,
        customColor: null,
        nodeId: this.id(),
        index: out.length,
      });
    }
    return out;
  }

  private lights(): Light[] {
    const out: Light[] = [];
    for (const l of arr(this.root.lights)) {
      if (!isObj(l) || !fin(l.x) || !fin(l.y) || !this.item()) continue;
      out.push({
        position: { x: l.x * GRID, y: l.y * GRID },
        range: fin(l.radius) ? Math.max(0, l.radius) : 0,
        intensity: fin(l.intensity) ? l.intensity : 1,
        color: null,
        texture: null,
        shadows: true,
        nodeId: this.id(),
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------- geometry

/** Shoelace area of an interleaved ring (positive counter-clockwise with y up). */
export function signedArea(r: Float64Array): number {
  let s = 0;
  const n = r.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) s += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
  return s / 2;
}

function inRing(x: number, y: number, r: Float64Array): boolean {
  let inside = false;
  const n = r.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function reversed(r: Float64Array): Float64Array {
  const n = r.length >> 1;
  const out = new Float64Array(r.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = r[2 * (n - 1 - i)];
    out[2 * i + 1] = r[2 * (n - 1 - i) + 1];
  }
  return out;
}

/** Whether segments ab and cd cross at a point inside both (touching at ends doesn't count). */
function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const eps = 1e-9;
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/**
 * One ring for a polygon with holes: each hole, wound against the outline, joined to it by a
 * zero-width cut there and back between the closest pair of points the cut can join without
 * crossing any edge. Filled "nonzero", the cut adds nothing and the holes stay open.
 */
export function withHoles(outer: Float64Array, holes: Float64Array[]): Float64Array {
  if (!holes.length) return outer;
  const outSign = Math.sign(signedArea(outer)) || 1;
  let ring = Array.from(outer);
  const pending = holes.map((h) => Array.from(Math.sign(signedArea(h)) === outSign ? reversed(h) : h));
  // Every edge of the outline and the holes still to join, for the crossing test.
  const edgesOf = (pts: number[]): number[][] => {
    const n = pts.length >> 1;
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push([pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1]]);
    }
    return out;
  };
  while (pending.length) {
    const hole = pending.shift()!;
    const edges = [...edgesOf(ring), ...edgesOf(hole), ...pending.flatMap(edgesOf)];
    let best: { d: number; vi: number; hi: number } | null = null;
    let fallback: { d: number; vi: number; hi: number } | null = null;
    const rn = ring.length >> 1;
    const hn = hole.length >> 1;
    for (let hi = 0; hi < hn; hi++) {
      const hx = hole[2 * hi], hy = hole[2 * hi + 1];
      for (let vi = 0; vi < rn; vi++) {
        const vx = ring[2 * vi], vy = ring[2 * vi + 1];
        const d = (hx - vx) ** 2 + (hy - vy) ** 2;
        if (!fallback || d < fallback.d) fallback = { d, vi, hi };
        if (best && d >= best.d) continue;
        if (edges.some((e) => crosses(hx, hy, vx, vy, e[0], e[1], e[2], e[3]))) continue;
        best = { d, vi, hi };
      }
    }
    const { vi, hi } = best ?? fallback!;
    const loop: number[] = [];
    for (let k = 0; k <= hn; k++) {
      const i = (hi + k) % hn;
      loop.push(hole[2 * i], hole[2 * i + 1]);
    }
    ring = [...ring.slice(0, 2 * vi + 2), ...loop, ring[2 * vi], ring[2 * vi + 1], ...ring.slice(2 * vi + 2)];
  }
  return Float64Array.from(ring);
}

/** An ellipse's reach profile (spriteSizes.ts's shape): half-axes a along the sprite's x, b across. */
function ellipse(a: number, b: number): { r: number; reach: number[] } {
  const reach: number[] = [];
  for (let k = 0; k < REACH_DIRS.length / 2; k++) {
    const dx = REACH_DIRS[k * 2], dy = REACH_DIRS[k * 2 + 1];
    reach.push(Math.round(1 / Math.sqrt((dx / a) * (dx / a) + (dy / b) * (dy / b))));
  }
  return { r: Math.max(...reach), reach };
}

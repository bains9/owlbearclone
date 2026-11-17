// A Dungeondraft or Dungeon map's own data in the 3D view (view3d.ts): a picture map that came in
// with its map file (Scene.mapData, the season sidecar: dd/sidecar.ts) says where its trees,
// shrubs and rocks are and how far each reaches, and which squares are room floors. So its trees
// stand up where the picture paints them, in the picture's colours, and on an outdoor map its
// buildings get roofs, as a built map's do. Kept apart from three.js, so it's tested.
//
// World units are Dungeondraft's: 256 a square, x right, y down. The sidecar's rect is the
// picture's rectangle in them; the picture spans the scene's width and height.

import { OR, type ObjectRole } from "../dd/roles";
import { NO_NAME, REACH_N, SIDECAR_UNITS, type BitmapLayer, type ObjectTable, type RaisedPoly, type ShapeLayer, type SidecarMeta, type TerrainGrid, type WallHeightLine } from "../dd/sidecar";
import type { RaisedFloor } from "./view3dGround";
import { AR, TR } from "../dd/roles";
import { REACH_DIRS } from "../dd/raster";
import { shapeOf, type Object3d, type Shape } from "./view3dObjects";
import type { BaseStampId, DungeonStampId, StampId } from "../../shared/terrain";
import type { Hole } from "./view3dClearing";

/** Dungeondraft's world units a square. */
export const WORLD_SQUARE = 256;

/** Where the picture lies: its rectangle in world units, and its size in the scene. */
export interface MapPlacement {
  rect: readonly [number, number, number, number];
  width: number;
  height: number;
}

/** Scene units for each world unit, across and down. */
export function sceneScale(p: MapPlacement): { sx: number; sy: number } {
  return { sx: p.width / Math.max(1e-9, p.rect[2] - p.rect[0]), sy: p.height / Math.max(1e-9, p.rect[3] - p.rect[1]) };
}

/** A world point as a scene point. */
export function toScene(p: MapPlacement, wx: number, wy: number): { x: number; y: number } {
  const { sx, sy } = sceneScale(p);
  return { x: (wx - p.rect[0]) * sx, y: (wy - p.rect[1]) * sy };
}

/**
 * The map data's walls standing other than 3 m (a Dungeon map's, WALH), as scene-unit segments,
 * each with its height in squares (a square is 1.5 m): Walls3d.tall.
 */
export function mapTallWalls(lines: readonly WallHeightLine[], place: MapPlacement): { line: [number, number, number, number]; h: number; lo?: number }[] {
  const out: { line: [number, number, number, number]; h: number; lo?: number }[] = [];
  for (const t of lines) {
    const h = t.cm / 100 / 1.5;
    const lo = t.lo ? t.lo / 100 / 1.5 : 0;
    for (let i = 0; i + 3 < t.pts.length; i += 2) {
      const a = toScene(place, t.pts[i] / SIDECAR_UNITS.coord, t.pts[i + 1] / SIDECAR_UNITS.coord);
      const b = toScene(place, t.pts[i + 2] / SIDECAR_UNITS.coord, t.pts[i + 3] / SIDECAR_UNITS.coord);
      out.push(lo ? { line: [a.x, a.y, b.x, b.y], h, lo } : { line: [a.x, a.y, b.x, b.y], h });
    }
  }
  return out;
}

/** The map data's raised floors (FLRS) in scene units, each with its height in squares (a square is 1.5 m). */
export function mapRaised(polys: readonly RaisedPoly[], place: MapPlacement): RaisedFloor[] {
  return polys.map((p) => ({
    rings: p.rings.map((ring) => {
      const out: number[] = [];
      for (let i = 0; i + 1 < ring.length; i += 2) {
        const at = toScene(place, ring[i] / SIDECAR_UNITS.coord, ring[i + 1] / SIDECAR_UNITS.coord);
        out.push(at.x, at.y);
      }
      return out;
    }),
    h: p.cm / 100 / 1.5,
  }));
}

/** A scene point as a world point. */
export function toWorld(p: MapPlacement, x: number, y: number): { x: number; y: number } {
  const { sx, sy } = sceneScale(p);
  return { x: x / sx + p.rect[0], y: y / sy + p.rect[1] };
}

/** The shape an object of this role stands up as, or null for one that stays painted (grass, flowers, litter, fire...). */
export function roleShape(role: ObjectRole, name: string | null): Shape | null {
  switch (role) {
    case OR.DECIDUOUS:
      return { kind: "tree", h: 0 };
    case OR.EVERGREEN:
      return { kind: name && /palm/i.test(name) ? "palm" : name && /cypress/i.test(name) ? "cypress" : "pine", h: 0 };
    case OR.BARE:
      return { kind: "bare", h: 0 };
    case OR.SHRUB:
    case OR.FLOWER_SHRUB:
      return { kind: "bush", h: 0 };
    case OR.ROCK:
      return { kind: "rock", h: 0 };
    case OR.STUMP:
      return { kind: "barrel", h: 0.3 };
    case OR.DEADWOOD:
      return { kind: "box", h: 0.3 };
    default:
      return null;
  }
}

/** Shapes sized by their average reach (round as painted); the rest by their reach along their sides. */
const ROUND: ReadonlySet<string> = new Set(["tree", "spreading", "pine", "cypress", "palm", "bare", "bush"]);

/** Below this, in squares, a thing isn't stood up: a pebble or a sprig stays painted. */
const SMALLEST = 0.3;

/**
 * The map's trees, shrubs, rocks, stumps and deadwood as the 3D view stands them up: at their
 * places on the picture, as wide as they reach (round ones by their average reach, the rest by
 * their reach along the map's axes), coloured from the picture where they stand. `cell`: the
 * scene's square in scene units.
 */
export function mapObjects(objects: ObjectTable, meta: Pick<SidecarMeta, "names">, place: MapPlacement, cell: number): Object3d[] {
  const out: Object3d[] = [];
  for (let i = 0; i < objects.n; i++) {
    const s = standing(objects, meta, place, cell, i);
    if (!s) continue;
    const at = toScene(place, objects.x[i] / SIDECAR_UNITS.coord, objects.y[i] / SIDECAR_UNITS.coord);
    // One of Dungeon's (or the Build tool's own) stands in its library form, by its id; others by their kind of shape.
    out.push({ id: s.id ?? null, ...(s.shape ? { shape: s.shape } : {}), x: at.x, y: at.y, size: Math.max(s.w, s.d), w: s.w, d: s.d, deg: s.deg, color: null, paint: true });
  }
  return out;
}

/** Whether object `i` stands up in 3D, and as what and how big (squares across and down). */
function standing(objects: ObjectTable, meta: Pick<SidecarMeta, "names">, place: MapPlacement, cell: number, i: number): { id?: StampId; shape?: Shape; w: number; d: number; deg: number } | null {
  const idx = objects.name[i];
  const name = idx !== NO_NAME ? (meta.names[idx] ?? null) : null;
  // A thing placed in Dungeon stands up in its own shape, as the Build tool's do (a table on legs, a
  // barrel, a statue); one it doesn't have (a rug, things on the floor) by its role, or stays painted.
  const id = name?.startsWith("dungeon/") ? name.slice(8) : null;
  // Its catalog's object, or one of the built-in few the Build tool shares (a chair, a barrel, a well),
  // in the form the library gives it (view3dObjects.ts shapeOf).
  const stamp: StampId | null = !id ? null : shapeOf(`d:${id}` as DungeonStampId) ? (`d:${id}` as DungeonStampId) : shapeOf(id as BaseStampId) ? (id as BaseStampId) : null;
  const dungeon = stamp !== null;
  const shape = dungeon ? null : roleShape(objects.role[i] as ObjectRole, name);
  if (!dungeon && !shape) return null;
  // World units to the scene's squares (across and down agree for a picture laid on the grid).
  const { sx, sy } = sceneScale(place);
  const perSquareX = sx / cell, perSquareY = sy / cell;
  // How it's turned (a full turn is 256, clockwise), and its reach along its own sides.
  const turn = (objects.rot[i] / 256) * Math.PI * 2;
  const c = Math.cos(turn), s = Math.sin(turn);
  let sum = 0, ex = 0, ey = 0;
  for (let k = 0; k < REACH_N; k++) {
    const r = objects.reach[i * REACH_N + k] / SIDECAR_UNITS.reach;
    sum += r;
    const dx = REACH_DIRS[k * 2], dy = REACH_DIRS[k * 2 + 1];
    // A Dungeon thing's sides are its own (it's turned in 3D); others are measured along the map's.
    const lx = dungeon ? dx * c + dy * s : dx, ly = dungeon ? -dx * s + dy * c : dy;
    ex = Math.max(ex, Math.abs(r * lx));
    ey = Math.max(ey, Math.abs(r * ly));
  }
  const round = !!shape && ROUND.has(shape.kind);
  const w = round ? (2 * sum) / REACH_N * perSquareX : 2 * ex * perSquareX;
  const d = round ? (2 * sum) / REACH_N * perSquareY : 2 * ey * perSquareY;
  if (Math.max(w, d) < SMALLEST) return null;
  return stamp ? { id: stamp, w, d, deg: (turn * 180) / Math.PI } : { shape: shape!, w, d, deg: 0 };
}

/**
 * The painted footprints of the things mapObjects stands up, to take off the 3D floor
 * (view3dClearing.ts): each one's middle and reach in REACH_DIRS' directions, in pixels of the
 * picture drawn `k` pixels a scene unit.
 */
export function mapHoles(objects: ObjectTable, meta: Pick<SidecarMeta, "names">, place: MapPlacement, cell: number, k: number): Hole[] {
  const out: Hole[] = [];
  const { sx, sy } = sceneScale(place);
  for (let i = 0; i < objects.n; i++) {
    if (!standing(objects, meta, place, cell, i)) continue;
    const at = toScene(place, objects.x[i] / SIDECAR_UNITS.coord, objects.y[i] / SIDECAR_UNITS.coord);
    const r = new Float64Array(REACH_N);
    for (let d = 0; d < REACH_N; d++) {
      const world = objects.reach[i * REACH_N + d] / SIDECAR_UNITS.reach;
      r[d] = world * Math.hypot(REACH_DIRS[d * 2] * sx, REACH_DIRS[d * 2 + 1] * sy) * k;
    }
    out.push({ x: at.x * k, y: at.y * k, r });
  }
  return out;
}

/** The map's objects but those mapObjects stands up: drawn, they show what lies under the standing ones. */
export function withoutStanding(objects: ObjectTable, meta: Pick<SidecarMeta, "names">, place: MapPlacement, cell: number): ObjectTable {
  const keep: number[] = [];
  for (let i = 0; i < objects.n; i++) if (!standing(objects, meta, place, cell, i)) keep.push(i);
  const pick = <T extends { length: number; [i: number]: number }>(a: T, make: new (n: number) => T, per = 1): T => {
    const out = new make(keep.length * per);
    keep.forEach((i, j) => {
      for (let q = 0; q < per; q++) out[j * per + q] = a[i * per + q];
    });
    return out;
  };
  return {
    n: keep.length,
    role: pick(objects.role, Uint8Array),
    layer: pick(objects.layer, Int16Array),
    x: pick(objects.x, Int32Array),
    y: pick(objects.y, Int32Array),
    rot: pick(objects.rot, Uint8Array),
    flags: pick(objects.flags, Uint8Array),
    name: pick(objects.name, Uint16Array),
    reach: pick(objects.reach, Uint16Array, REACH_N),
  };
}

/** Trees a map needs before it counts as outdoors by them alone. */
const OUTDOOR_TREES = 2;
/** Or the share of its ground that's grass or snow. */
const OUTDOOR_GROUND = 0.1;

/**
 * Whether a map is outdoors by its own data, for roofs on its rooms: it has trees, or grass or snow
 * over a tenth of its ground. (A cave or a dungeon has neither.)
 */
export function mapLooksOutdoors(data: { objects: Pick<ObjectTable, "n" | "role">; terrain: TerrainGrid | null }): boolean {
  let trees = 0;
  for (let i = 0; i < data.objects.n && trees < OUTDOOR_TREES; i++) {
    const r = data.objects.role[i];
    if (r === OR.DECIDUOUS || r === OR.EVERGREEN || r === OR.BARE) trees++;
  }
  if (trees >= OUTDOOR_TREES) return true;
  const t = data.terrain;
  if (!t || !t.slots.length) return false;
  const texels = t.tw * t.th;
  if (!texels) return false;
  let open = 0, all = 0;
  t.slots.forEach((slot, s) => {
    let sum = 0;
    for (let i = 0; i < texels; i++) sum += t.w[s * texels + i];
    all += sum;
    if (slot.role === TR.GRASS || slot.role === TR.SNOW) open += sum;
  });
  return all > 0 && open / all >= OUTDOOR_GROUND;
}

/**
 * The squares the map's floors cover (its rooms), as [col, row] in world squares: from its floor
 * outlines (a square whose middle lies inside one) and its floor bitmaps of one sample a square.
 * Each square once, however many layers mark it.
 */
export function floorCells(bitmaps: readonly BitmapLayer[], shapes: readonly ShapeLayer[] = []): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  const add = (col: number, row: number) => {
    const k = `${col},${row}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([col, row]);
  };
  for (const s of shapes) {
    if (s.role !== AR.FLOOR || !s.pts.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < s.pts.length; i += 2) {
      x0 = Math.min(x0, s.pts[i]);
      x1 = Math.max(x1, s.pts[i]);
      y0 = Math.min(y0, s.pts[i + 1]);
      y1 = Math.max(y1, s.pts[i + 1]);
    }
    const u = SIDECAR_UNITS.coord * WORLD_SQUARE;
    for (let row = Math.floor(y0 / u); row <= Math.floor(y1 / u); row++) {
      for (let col = Math.floor(x0 / u); col <= Math.floor(x1 / u); col++) {
        if (inside(s, (col + 0.5) * u, (row + 0.5) * u)) add(col, row);
      }
    }
  }
  for (const b of bitmaps) {
    if (b.role !== AR.FLOOR || b.step !== WORLD_SQUARE) continue;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const bit = y * b.w + x;
        if (!((b.bits[bit >> 3] >> (bit & 7)) & 1)) continue;
        add(Math.floor((b.ox + x * b.step) / WORLD_SQUARE), Math.floor((b.oy + y * b.step) / WORLD_SQUARE));
      }
    }
  }
  return out;
}

/** Whether a point (in the shape's 1/16 world units) is inside it, by its fill rule over all its rings. */
export function inside(s: Pick<ShapeLayer, "pts" | "ringEnds" | "rule">, px: number, py: number): boolean {
  let winding = 0, crossings = 0;
  let start = 0;
  for (let r = 0; r < s.ringEnds.length; r++) {
    const end = s.ringEnds[r];
    for (let i = start; i < end; i++) {
      const j = i + 1 < end ? i + 1 : start;
      const ax = s.pts[i * 2], ay = s.pts[i * 2 + 1], bx = s.pts[j * 2], by = s.pts[j * 2 + 1];
      if ((ay <= py) !== (by <= py)) {
        const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
        if (x > px) {
          crossings++;
          winding += by > ay ? 1 : -1;
        }
      }
    }
    start = end;
  }
  return s.rule === 1 ? winding !== 0 : crossings % 2 === 1;
}

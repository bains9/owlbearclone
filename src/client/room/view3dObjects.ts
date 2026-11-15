// Objects on a built map standing up in the 3D view (view3d.ts): trees, rocks, pillars, barrels,
// tables... Each kind of object in Dungeon's catalog (shared/dungeonCatalog.ts: by its group, then
// its id) gets a plain low-poly shape, in the colour of its own drawing (build.ts stampColour), so a
// snowy tree is white. What lies on the floor (rugs, stains, rubble) and small things (cups,
// candles, books) stay painted on it. Kept apart from three.js, so it's tested without WebGL.
//
// Units as in view3dModel.ts: scene units in, squares out (x to the right, z down the map, y up).

import { dungeonStampInfo, isDungeonStamp, type BaseStampId, type StampId } from "../../shared/terrain";
import { WALL_HEIGHT, WALL_SEEN, brightnessAt, paintAt, shadeOf, type CoverMap, type PaintMap, type WallMesh } from "./view3dModel";

/** The shapes objects get. Trees and plants grow with the object's size; the rest stand `h` squares tall. */
export type ShapeKind =
  | "tree"
  | "spreading"
  | "pine"
  | "cypress"
  | "palm"
  | "bare"
  | "bush"
  | "rock"
  | "spire"
  | "column"
  | "statue"
  | "barrel"
  | "urn"
  | "stool"
  | "table"
  | "roundTable"
  | "box"
  | "well"
  | "fountain";

export interface Shape {
  kind: ShapeKind;
  /** How tall, in squares (the kinds that don't grow with the object's size). */
  h: number;
}

const shape = (kind: ShapeKind, h = 0): Shape => ({ kind, h });
const has = (id: string, ...words: string[]) => words.some((w) => id.includes(w));

/** A column, a pillar: a little taller than the walls. */
const COLUMN_H = WALL_HEIGHT * 1.15;

/** Tabletop's own sixteen objects. Stairs, the campfire and rubble stay painted. */
const BASE: Partial<Record<BaseStampId, Shape>> = {
  table: shape("table", 0.5),
  chair: shape("box", 0.45),
  bed: shape("box", 0.4),
  chest: shape("box", 0.5),
  barrel: shape("barrel", 0.75),
  crate: shape("box", 0.6),
  shelf: shape("box", 1.5),
  pillar: shape("column", COLUMN_H),
  statue: shape("statue", 1.3),
  well: shape("well", 0.5),
  tree: shape("tree"),
  bush: shape("bush"),
  rock: shape("rock"),
};

/** Dungeon's objects, by their group in its catalog and then their id. A group not here stays painted. */
const GROUPS: Record<string, (id: string) => Shape | null> = {
  "Leafy trees": (id) => shape(has(id, "spreading", "willow") ? "spreading" : "tree"),
  Evergreens: (id) => shape(has(id, "palm") ? "palm" : has(id, "cypress") ? "cypress" : "pine"),
  "Bare and fallen wood": (id) =>
    has(id, "dead-tree") ? shape("bare") : has(id, "stump") ? shape("barrel", 0.3) : shape("box", 0.3),
  "Bushes and hedges": (id) => (has(id, "hedge") ? shape("box", 0.8) : shape("bush")),
  Rocks: (id) => (has(id, "spire") ? shape("spire", 1.4) : has(id, "rubble") ? null : shape("rock")),
  "Pillars and statues": (id) =>
    has(id, "fallen") ? shape("box", 0.55) :
    has(id, "broken") ? shape("column", 0.6) :
    has(id, "statue", "idol") ? shape("statue", 1.3) :
    has(id, "obelisk") ? shape("spire", 2) :
    shape("column", has(id, "cracked") ? COLUMN_H * 0.8 : COLUMN_H),
  "Statues and shrines": (id) => (has(id, "statue") ? shape("statue", 1.4) : has(id, "shrine") ? shape("box", 0.9) : null),
  Barrels: (id) => (has(id, "lying", "tipped") ? shape("box", 0.55) : has(id, "stack", "barrels") ? shape("box", 0.85) : shape("barrel", 0.75)),
  Crates: (id) => shape("box", has(id, "pile", "crates") ? 0.9 : has(id, "long", "small") ? 0.45 : 0.6),
  Cargo: () => shape("box", 0.9),
  Tables: (id) => shape(has(id, "round") ? "roundTable" : "table", 0.5),
  Seating: (id) =>
    has(id, "throne") ? shape("box", 1.2) :
    has(id, "stool") ? shape("stool", has(id, "bar") ? 0.55 : 0.35) :
    has(id, "bench") ? shape("box", 0.3) :
    shape("box", 0.45),
  Beds: (id) => shape("box", has(id, "bunk") ? 1.2 : 0.4),
  Storage: (id) => shape("box", has(id, "dresser") ? 0.8 : 1.5),
  "Chests and strongboxes": (id) => shape("box", has(id, "coffer") ? 0.3 : 0.5),
  "Desks and lecterns": (id) => shape("box", has(id, "lectern") ? 0.9 : 0.55),
  "The bar": (id) =>
    has(id, "counter", "bar-section") ? shape("box", 0.85) :
    has(id, "keg") ? shape("box", 0.6) :
    has(id, "barstool") ? shape("stool", 0.55) :
    has(id, "rack") ? shape("box", 1.3) :
    has(id, "gaming-table") ? shape("table", 0.5) :
    null,
  "Wells and fountains": (id) => (has(id, "fountain") ? shape("fountain", 0.35) : shape("well", 0.5)),
  "The village": (id) =>
    has(id, "well") ? shape("well", 0.5) :
    has(id, "outhouse") ? shape("box", 1.8) :
    has(id, "notice-board") ? shape("box", 1.3) :
    has(id, "market-cross") ? shape("column", 1.6) :
    has(id, "scarecrow") ? shape("statue", 1.4) :
    null,
  Graveyard: (id) =>
    has(id, "gravestone") ? shape("box", 0.6) : has(id, "tomb-chest") ? shape("box", 0.6) : has(id, "mausoleum") ? shape("box", 1.8) : null,
  "Fences and gates": (id) => shape("box", has(id, "tumbled") ? 0.45 : has(id, "garden-wall") ? 0.7 : 0.6),
  Altars: (id) => (has(id, "temple-altar") ? shape("box", 0.6) : null),
  "Tombs and bones": (id) => (has(id, "sarcophagus") ? shape("box", 0.6) : has(id, "coffin") ? shape("box", 0.35) : null),
  "Pots, jars and urns": (id) => (has(id, "lying", "glass-jar") || id === "pots" ? null : shape("urn", has(id, "small") ? 0.35 : 0.55)),
  "Wagons and carts": (id) => shape("box", has(id, "covered", "carriage") ? 1.4 : 0.9),
};

/** The catalog groups that get shapes (a test checks each is one of the catalog's). */
export const SHAPED_GROUPS: readonly string[] = Object.keys(GROUPS);

const shapes = new Map<StampId, Shape | null>();

/** The shape an object stands up as in 3D, or null for one that stays painted on the floor. */
export function shapeOf(id: StampId): Shape | null {
  let s = shapes.get(id);
  if (s !== undefined) return s;
  if (!isDungeonStamp(id)) s = BASE[id as BaseStampId] ?? null;
  else {
    const info = dungeonStampInfo(id);
    s = info && info.layer !== "floor" ? (GROUPS[info.group]?.(info.id) ?? null) : null;
  }
  shapes.set(id, s);
  return s;
}

/**
 * What an object covers, in squares, before it's turned: `size` (its longer side) across its
 * longer way, its drawing's own proportions the other (a 2 by 1 table at size 2 is 2 by 1).
 */
export function footprintOf(id: StampId, size: number): { w: number; d: number } {
  const info = isDungeonStamp(id) ? dungeonStampInfo(id) : undefined;
  if (!info || !(info.w > 0 && info.h > 0)) return { w: size, d: size };
  const k = size / Math.max(info.w, info.h);
  return { w: info.w * k, d: info.h * k };
}

/** An object on the map, as the board gives it (board.ts source3d): one of a built map's, or a picture map's from its map data. */
export interface Object3d {
  /** A built map's object (its shape from the catalog); null for one from a map's own data, which brings its shape. */
  id: StampId | null;
  /** Its shape, when it isn't the catalog's (an object from a map's own data). */
  shape?: Shape;
  /** What it covers, in squares (when it isn't the catalog's proportions of `size`). */
  w?: number;
  d?: number;
  /** Coloured as the picture paints it where it stands (an object from a map's own data). */
  paint?: boolean;
  /** Its middle, in scene units. */
  x: number;
  y: number;
  /** Its size in squares (its longer side). */
  size: number;
  /** Turned this many degrees clockwise. */
  deg: number;
  /** Its drawing's colour (0 to 1 each), or null before it can be drawn (a stand-in colour then). */
  color: readonly [number, number, number] | null;
}

type Rgb = readonly [number, number, number];

/** Colours for a shape before its drawing's is known. */
const STAND_IN: Record<ShapeKind, Rgb> = {
  tree: [0.27, 0.46, 0.22],
  spreading: [0.27, 0.46, 0.22],
  pine: [0.16, 0.36, 0.22],
  cypress: [0.16, 0.36, 0.22],
  palm: [0.3, 0.5, 0.24],
  bare: [0.42, 0.35, 0.27],
  bush: [0.3, 0.5, 0.25],
  rock: [0.52, 0.51, 0.49],
  spire: [0.52, 0.51, 0.49],
  column: [0.64, 0.62, 0.58],
  statue: [0.64, 0.62, 0.58],
  barrel: [0.52, 0.37, 0.22],
  urn: [0.62, 0.4, 0.27],
  stool: [0.52, 0.37, 0.22],
  table: [0.52, 0.37, 0.22],
  roundTable: [0.52, 0.37, 0.22],
  box: [0.52, 0.37, 0.22],
  well: [0.56, 0.55, 0.52],
  fountain: [0.56, 0.55, 0.52],
};
/** A tree's trunk. */
const BARK: Rgb = [0.36, 0.26, 0.17];

/** A number from 0 to 1 that's always the same for the same inputs (an object's lumps don't move). */
function noise(a: number, b: number, c: number): number {
  let h = Math.imul(Math.round(a * 97) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(b * 89) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 7, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

type V3 = [number, number, number];

/** Collects an object's triangles, each lit flat, then turns and places them. */
class Builder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  /** Where the object being made stands and how it's turned (set before its parts). */
  private ox = 0;
  private oz = 0;
  private cos = 1;
  private sin = 0;

  place(x: number, z: number, deg: number): void {
    this.ox = x;
    this.oz = z;
    // Clockwise on the map is a negative turn about y (three.js's sense).
    const t = (-deg * Math.PI) / 180;
    this.cos = Math.cos(t);
    this.sin = Math.sin(t);
  }

  /**
   * A triangle of a part whose middle is `mid`: wound so it faces away from the middle, which is
   * outwards for the plain, convex parts used here (and the side WebGL draws).
   */
  tri(a: V3, b: V3, c: V3, col: Rgb, mid: V3): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-12)) return;
    const fx = (a[0] + b[0] + c[0]) / 3 - mid[0], fy = (a[1] + b[1] + c[1]) / 3 - mid[1], fz = (a[2] + b[2] + c[2]) / 3 - mid[2];
    if (nx * fx + ny * fy + nz * fz < 0) {
      [b, c] = [c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    nx /= len;
    ny /= len;
    nz /= len;
    // Turned about y, then put in place.
    const tnx = nx * this.cos + nz * this.sin, tnz = -nx * this.sin + nz * this.cos;
    for (const p of [a, b, c]) {
      this.position.push(this.ox + p[0] * this.cos + p[2] * this.sin, p[1], this.oz - p[0] * this.sin + p[2] * this.cos);
      this.normal.push(tnx, ny, tnz);
      this.color.push(col[0], col[1], col[2]);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, col: Rgb, mid: V3): void {
    this.tri(a, b, c, col, mid);
    this.tri(a, c, d, col, mid);
  }

  /** A box from (x0, y0, z0) to (x1, y1, z1), without a bottom. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: Rgb): void {
    const mid: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const p = (x: number, y: number, z: number): V3 => [x, y, z];
    this.quad(p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1), col, mid);
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0), col, mid);
    this.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), col, mid);
    this.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), col, mid);
    this.quad(p(x1, y0, z0), p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0), col, mid);
  }

  /** An upright cylinder (or a cone, `rTop` 0) with a top, `segs` sides. */
  cylinder(cx: number, cz: number, rBottom: number, rTop: number, y0: number, y1: number, col: Rgb, segs = 8): void {
    const mid: V3 = [cx, (y0 + y1) / 2, cz];
    const at = (i: number, r: number, y: number): V3 => {
      const a = (i / segs) * Math.PI * 2;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    };
    for (let i = 0; i < segs; i++) {
      if (rTop > 0) this.quad(at(i, rBottom, y0), at(i + 1, rBottom, y0), at(i + 1, rTop, y1), at(i, rTop, y1), col, mid);
      else this.tri(at(i, rBottom, y0), at(i + 1, rBottom, y0), [cx, y1, cz], col, mid);
    }
    if (rTop > 0) for (let i = 0; i < segs; i++) this.tri([cx, y1, cz], at(i, rTop, y1), at(i + 1, rTop, y1), col, [cx, y1 - 1, cz]);
  }

  /** A lumpy ball: `rings` bands of `segs`, each corner pushed out or in by up to `jitter` of its radius. */
  ball(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: Rgb, segs: number, rings: number, jitter: number, seed: number): void {
    const mid: V3 = [cx, cy, cz];
    const corner = (i: number, j: number): V3 => {
      const lat = (j / rings) * Math.PI;
      const lon = ((i % segs) / segs) * Math.PI * 2;
      // The poles aren't lumpy, so they stay one point.
      const k = j === 0 || j === rings ? 1 : 1 + (noise(seed, i % segs, j) * 2 - 1) * jitter;
      return [cx + Math.sin(lat) * Math.cos(lon) * rx * k, cy + Math.cos(lat) * ry * k, cz + Math.sin(lat) * Math.sin(lon) * rz * k];
    };
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = corner(i, j), b = corner(i + 1, j), c = corner(i + 1, j + 1), d = corner(i, j + 1);
        if (j === 0) this.tri(a, c, d, col, mid);
        else if (j === rings - 1) this.tri(a, b, d, col, mid);
        else this.quad(a, b, c, d, col, mid);
      }
    }
  }
}

/** What the picture paints where an object stands: the average of its middle and four points round it (null where it paints nothing). */
export function paintedColour(paint: PaintMap | null, x: number, y: number, reach: number): Rgb | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = paintAt(paint, x + dx * reach, y + dy * reach);
    if (!c) continue;
    r += c[0];
    g += c[1];
    b += c[2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** How lit an object is for this page: the brightest of its middle and four points round it. */
export function objectLight(o: Pick<Object3d, "x" | "y">, reach: number, cover: CoverMap | null): number {
  let best = brightnessAt(cover, o.x, o.y);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) best = Math.max(best, brightnessAt(cover, o.x + dx * reach, o.y + dy * reach));
  return best;
}

/**
 * The objects as one mesh, each in its shape and colour, as lit as where it stands. As with walls,
 * one a player hasn't seen (under the fog, in the dark not explored) isn't made at all; the GM
 * (`all`) sees every one.
 */
export function objectMesh(objects: readonly Object3d[], cell: number, cover: CoverMap | null, all: boolean, paint: PaintMap | null = null): WallMesh {
  const b = new Builder();
  for (const o of objects) {
    const sh = o.shape ?? (o.id ? shapeOf(o.id) : null);
    if (!sh) continue;
    const { w, d } = o.w !== undefined && o.d !== undefined ? { w: o.w, d: o.d } : o.id ? footprintOf(o.id, o.size) : { w: o.size, d: o.size };
    const light = objectLight(o, (Math.min(w, d) * cell) / 3, cover);
    if (!all && light < WALL_SEEN) continue;
    const shade = shadeOf(light);
    const base = o.color ?? (o.paint ? paintedColour(paint, o.x, o.y, (Math.min(w, d) * cell) / 4) : null) ?? STAND_IN[sh.kind];
    const col: Rgb = [base[0] * shade, base[1] * shade, base[2] * shade];
    const bark: Rgb = [BARK[0] * shade, BARK[1] * shade, BARK[2] * shade];
    const seed = Math.round(o.x * 7 + o.y * 13);
    b.place(o.x / cell, o.y / cell, o.deg);
    addShape(b, sh, o.size, w, d, col, bark, seed);
  }
  return { position: Float32Array.from(b.position), normal: Float32Array.from(b.normal), color: Float32Array.from(b.color) };
}

/** One object's parts, about its middle, in squares. */
function addShape(b: Builder, sh: Shape, s: number, w: number, d: number, col: Rgb, bark: Rgb, seed: number): void {
  const m = Math.min(w, d);
  switch (sh.kind) {
    case "tree":
    case "spreading": {
      const wide = sh.kind === "spreading";
      const trunk = 0.35 * s + 0.3;
      b.cylinder(0, 0, 0.05 * s + 0.05, 0.04 * s + 0.04, 0, trunk + 0.1, bark, 6);
      const rx = (wide ? 0.48 : 0.42) * s, ry = (wide ? 0.26 : 0.34) * s;
      b.ball(0, trunk + ry * 0.6, 0, rx, ry, rx, col, 9, 5, 0.14, seed);
      return;
    }
    case "pine": {
      b.cylinder(0, 0, 0.04 * s + 0.04, 0.03 * s + 0.03, 0, 0.25 * s + 0.1, bark, 6);
      b.cylinder(0, 0, 0.45 * s, 0, 0.15 * s, 0.9 * s + 0.15, col, 9);
      b.cylinder(0, 0, 0.32 * s, 0, 0.5 * s, 1.2 * s + 0.3, col, 9);
      return;
    }
    case "cypress": {
      b.cylinder(0, 0, 0.04 * s + 0.03, 0.03 * s + 0.03, 0, 0.15 * s + 0.1, bark, 6);
      b.cylinder(0, 0, 0.24 * s, 0, 0.1 * s, 1.3 * s + 0.3, col, 8);
      return;
    }
    case "palm": {
      const trunk = 0.75 * s + 0.4;
      b.cylinder(0, 0, 0.04 * s + 0.04, 0.03 * s + 0.03, 0, trunk, bark, 6);
      b.ball(0, trunk, 0, 0.45 * s, 0.1 * s, 0.45 * s, col, 9, 4, 0.2, seed);
      return;
    }
    case "bare": {
      const trunk = 0.6 * s + 0.3;
      b.cylinder(0, 0, 0.05 * s + 0.04, 0.03 * s + 0.02, 0, trunk + 0.15 * s, bark, 6);
      b.ball(0, trunk + 0.1 * s, 0, 0.3 * s, 0.22 * s, 0.3 * s, col, 7, 4, 0.35, seed);
      return;
    }
    case "bush": {
      // About as tall as it's round.
      const rx = w * 0.45, rz = d * 0.45, ry = Math.min(rx, rz) * 0.75;
      b.ball(0, ry * 0.7, 0, rx, ry, rz, col, 8, 4, 0.14, seed);
      return;
    }
    case "rock": {
      const rx = w * 0.42, rz = d * 0.42, ry = Math.min(rx, rz) * 0.6 + 0.05;
      b.ball(0, ry * 0.35, 0, rx, ry, rz, col, 7, 4, 0.22, seed);
      return;
    }
    case "spire":
      b.cylinder(0, 0, m * 0.38, 0, 0, sh.h, col, 6);
      return;
    case "column":
      b.box(-w * 0.4, w * 0.4, 0, 0.1, -d * 0.4, d * 0.4, col);
      b.cylinder(0, 0, m * 0.32, m * 0.3, 0.1, sh.h, col, 10);
      return;
    case "statue":
      b.box(-w * 0.35, w * 0.35, 0, 0.25, -d * 0.35, d * 0.35, col);
      b.cylinder(0, 0, m * 0.22, m * 0.16, 0.25, sh.h - 0.25, col, 8);
      b.ball(0, sh.h - 0.13, 0, m * 0.13, m * 0.15, m * 0.13, col, 7, 4, 0, seed);
      return;
    case "barrel":
      b.cylinder(0, 0, m * 0.42, m * 0.42, 0, sh.h, col, 10);
      return;
    case "urn":
      b.cylinder(0, 0, m * 0.3, m * 0.38, 0, sh.h, col, 8);
      return;
    case "stool":
      b.cylinder(0, 0, m * 0.4, m * 0.4, 0, sh.h, col, 8);
      return;
    case "table": {
      const top = 0.07, leg = 0.06;
      b.box(-w * 0.47, w * 0.47, sh.h - top, sh.h, -d * 0.47, d * 0.47, col);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = sx * (w * 0.47 - leg), z = sz * (d * 0.47 - leg);
          b.box(x - leg / 2, x + leg / 2, 0, sh.h - top, z - leg / 2, z + leg / 2, col);
        }
      }
      return;
    }
    case "roundTable":
      b.cylinder(0, 0, m * 0.47, m * 0.47, sh.h - 0.07, sh.h, col, 12);
      b.cylinder(0, 0, 0.06, 0.06, 0, sh.h - 0.07, col, 6);
      return;
    case "box":
      b.box(-w * 0.46, w * 0.46, 0, sh.h, -d * 0.46, d * 0.46, col);
      return;
    case "well":
      b.cylinder(0, 0, m * 0.45, m * 0.45, 0, sh.h, col, 12);
      return;
    case "fountain":
      b.cylinder(0, 0, m * 0.46, m * 0.46, 0, sh.h, col, 14);
      b.cylinder(0, 0, 0.12, 0.1, sh.h, 1, col, 8);
      b.ball(0, 1.05, 0, 0.16, 0.1, 0.16, col, 8, 3, 0, seed);
      return;
  }
}

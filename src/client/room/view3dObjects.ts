// Objects on a built map standing up in the 3D view (view3d.ts): trees, rocks, pillars, barrels,
// tables... Each of Dungeon's objects stands up as the form its own library gives it, next to its
// drawing (dungeonLib/solid.ts, copied from Dungeon: low-poly parts with real heights and colours,
// or a considered "lies flat"), so Table keeps no list of its own. Tabletop's own sixteen objects
// get forms here, made of the same parts. Objects from a picture's map data, or found in it, come
// with a kind of shape (a tree, a rock), which the library also has a form for. Kept apart from
// three.js, so it's tested without WebGL.
//
// Units as in view3dModel.ts: scene units in, squares out (x to the right, z down the map, y up).

import { dungeonStampInfo, isDungeonStamp, type BaseStampId, type StampId } from "../../shared/terrain";
import { WALL_SEEN, brightnessAt, paintAt, shadeOf, type CoverMap, type PaintMap, type WallMesh } from "./view3dModel";
import { dungeonObjects } from "./dungeonStamps";
import * as S from "../dungeonLib/solid";

/** The kinds of shape an object from a picture's map data (or found in the picture) comes with. */
export type ShapeKind = S.SolidKind;

export interface Shape {
  kind: ShapeKind;
  /** How tall, in squares, for the kinds that don't grow with the object's size (a box, a barrel). */
  h: number;
}

/** A form standing on a 1 by 1 box, for Tabletop's own objects (they're drawn into a square). */
const unit = (spec: S.FormSpec): S.Form => (typeof spec === "function" ? spec(1, 1) : spec);
const OWN = S.paint("#8a6a4a");

/** Tabletop's own sixteen objects: each in the colour of its own drawing (the season's look). */
const BASE: Record<BaseStampId, S.Form> = {
  table: unit(S.table(0.76, OWN)),
  chair: unit(S.seat(0.46, 0.95, OWN)),
  bed: unit(S.bed(0.55, 1.0, OWN, OWN)),
  chest: unit(S.chest(0.75, OWN, OWN)),
  barrel: unit(S.barrel(1.1, OWN, OWN)),
  crate: unit(S.block(0.95, OWN, { surface: true })),
  shelf: unit(S.bookcase(2.0, OWN)),
  stairs: S.flat("a way to another level: the 3D view shows one level, so its steps stay painted"),
  pillar: S.solid([S.cbox(0.92, 0.92, 0, 0.3, OWN), S.cyl(0.36, 0.3, 2.75, OWN, { n: 10 }), S.cbox(0.84, 0.84, 2.75, 3.0, OWN)]),
  statue: S.solid([S.cbox(0.9, 0.9, 0, 0.6, OWN), S.cyl(0.28, 0.6, 1.9, OWN, { rz: 0.18, top: 0.75 }), S.ball(0.13, 1.85, 2.25, OWN)]),
  well: S.solid([S.tub(0.47, 0, 0.8, OWN, 0.7, { n: 14, floor: 0.35 }), S.cyl(0.32, 0.34, 0.36, "#173246", { n: 14 })]),
  tree: unit(S.leafyTree(OWN)),
  bush: unit(S.shrub(OWN)),
  rock: unit(S.stone(OWN)),
  campfire: S.solid([
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => S.ball(0.1, 0, 0.18, "#7e7c76", { x: Math.cos((i / 8) * Math.PI * 2) * 0.38, z: Math.sin((i / 8) * Math.PI * 2) * 0.38, lump: 0.2, n: 6 })),
    S.fire(0, 0, 0.05, 0.7, 0.2),
  ]),
  rubble: S.solid([S.ball(0.45, -0.1, 0.3, OWN, { lump: 0.35, n: 8 })]),
};

/** The base objects' forms, for the tests. */
export const BASE_FORMS: Readonly<Record<BaseStampId, S.Form>> = BASE;

const dungeonForms = new Map<StampId, S.Form>();

/**
 * The form an object stands up as in 3D, or null for one that lies flat (and stays painted on the
 * floor). One of Dungeon's is null until its library has loaded (dungeonStamps.ts), as it isn't
 * drawn before then either.
 */
export function shapeOf(id: StampId): S.Solid | null {
  let f: S.Form | undefined;
  if (!isDungeonStamp(id)) f = BASE[id as BaseStampId];
  else {
    f = dungeonForms.get(id);
    if (!f) {
      const p = dungeonObjects()?.prop(id.slice(2));
      if (p) dungeonForms.set(id, (f = S.formOf(p)));
    }
  }
  return f && !S.isFlat(f) ? f : null;
}

/** The squares per unit of an object's drawing, placed `size` squares on its longer side. */
function scaleOf(id: StampId, size: number): number {
  const info = isDungeonStamp(id) ? dungeonStampInfo(id) : undefined;
  return info && info.w > 0 && info.h > 0 ? size / Math.max(info.w, info.h) : size;
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

/** How tall a tree of this kind stands for its crown `s` squares across, at real-world scale (a square is 1.5 m), at most 20 squares. */
export function treeHeight(kind: ShapeKind, s: number): number {
  const k = kind === "pine" || kind === "cypress" || kind === "palm" || kind === "bare" || kind === "spreading" ? kind : "leafy";
  return S.treeHeightM(k, s) / S.SQUARE_M;
}

/** An object on the map, as the board gives it (board.ts source3d): one of a built map's, or a picture map's from its map data. */
export interface Object3d {
  /** A built map's object (its form from the library); null for one from a map's own data, which brings its shape. */
  id: StampId | null;
  /** Its form, when it brings its own (Dungeon's builder's view sends each object's, so it shows as Dungeon has it). */
  form?: S.Form;
  /** Its kind of shape, when it isn't from the library (an object from a map's own data, or found in its picture). */
  shape?: Shape;
  /** What it covers, in squares (when it isn't the drawing's proportions of `size`). */
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
  /** Its drawing's colour (0 to 1 each), or null before it can be drawn: what its seasonal parts (leaves) are painted in. */
  color: readonly [number, number, number] | null;
}

type Rgb = readonly [number, number, number];

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

/** An object's form and the squares per unit of it: its own, the library's, or one for its kind of shape. */
function placedForm(o: Object3d): { form: S.Form; k: number; w: number; d: number } | null {
  if (o.form) {
    const k = o.id ? scaleOf(o.id, o.size) : 1;
    const fp = o.id ? footprintOf(o.id, o.size) : { w: o.size, d: o.size };
    return { form: o.form, k, w: o.w ?? fp.w, d: o.d ?? fp.d };
  }
  if (o.shape) {
    const w = o.w ?? o.size, d = o.d ?? o.size;
    return { form: S.kindForm(o.shape.kind, w, d, o.shape.h * S.SQUARE_M), k: 1, w, d };
  }
  if (!o.id) return null;
  const form = shapeOf(o.id);
  if (!form) return null;
  const { w, d } = footprintOf(o.id, o.size);
  return { form, k: scaleOf(o.id, o.size), w, d };
}

/**
 * The objects as meshes, each in its form and colours, as lit as where it stands: what's lit by
 * the scene's lights, and (`glow`) what glows by itself, flames and magic, to be drawn unlit. As
 * with walls, one a player hasn't seen (under the fog, in the dark not explored) isn't made at
 * all; the GM (`all`) sees every one. A tankard put on a table sits on its top.
 */
/**
 * The kinds of thing a map's own data or its picture gives that a figure doesn't stand on: trees
 * (it stands under them) and bushes (in them). Everything else, a rock, a crate, a barrel, it can.
 */
const NOT_STOOD_ON = new Set<ShapeKind>(["tree", "spreading", "pine", "cypress", "palm", "bare", "bush"]);
/** The sixteen objects' own that are the same: a tree, a bush, and a campfire (it stands beside one). */
const NOT_STOOD_ON_IDS = new Set<string>(["tree", "bush", "campfire"]);

/**
 * Whether a figure can stand on an object: one of Dungeon's library, unless it's in the canopy (a
 * tree's crown, a tent, a market stall's awning: a token under it stays under it), as Dungeon's
 * library has it; one of the sixteen or of a map's own data, unless it's a tree or a bush.
 */
export function standsOn(o: Object3d): boolean {
  if (o.id && isDungeonStamp(o.id)) return dungeonStampInfo(o.id)?.layer !== "canopy";
  if (o.id) return !NOT_STOOD_ON_IDS.has(o.id);
  if (o.shape) return !NOT_STOOD_ON.has(o.shape.kind);
  return true;
}

/**
 * What a figure can stand on among the objects (view3dStand.ts), as triangles in squares: the parts
 * of the forms of those it can (standsOn) but for flames (parts that glow) and, in Dungeon's library,
 * leaves, bushes and grass (the parts that take the drawing's own seasonal colour). As objectMesh, a
 * player's has none they haven't seen.
 */
export function standMesh(objects: readonly Object3d[], cell: number, cover: CoverMap | null, all: boolean): { position: Float32Array } {
  const placed: S.Placed[] = [];
  for (const o of objects) {
    if (!standsOn(o)) continue;
    const p = placedForm(o);
    if (!p || S.isFlat(p.form)) continue;
    if (!all && objectLight(o, (Math.min(p.w, p.d) * cell) / 3, cover) < WALL_SEEN) continue;
    // In Dungeon's library a part in the drawing's own colour is one that changes with the seasons
    // (leaves, bushes, grass); the sixteen and a map's own things take their drawing's colour all
    // over, and their trees and bushes are left out above.
    const library = !!o.id && isDungeonStamp(o.id);
    const parts = p.form.parts.filter((part) => !part.glow && !(library && typeof part.c === "object" && "paint" in part.c));
    if (!parts.length) continue;
    placed.push({ form: { ...p.form, parts }, x: o.x / cell, z: o.y / cell, k: p.k, deg: o.deg });
  }
  return { position: placed.length ? S.solidMeshes(placed).lit.position : new Float32Array(0) };
}

export function objectMesh(objects: readonly Object3d[], cell: number, cover: CoverMap | null, all: boolean, paint: PaintMap | null = null): WallMesh & { glow: WallMesh } {
  const placed: S.Placed[] = [];
  for (const o of objects) {
    const p = placedForm(o);
    if (!p || S.isFlat(p.form)) continue;
    const light = objectLight(o, (Math.min(p.w, p.d) * cell) / 3, cover);
    if (!all && light < WALL_SEEN) continue;
    const painted = o.color ?? (o.paint ? paintedColour(paint, o.x, o.y, (Math.min(p.w, p.d) * cell) / 4) : null);
    placed.push({ form: p.form, x: o.x / cell, z: o.y / cell, k: p.k, deg: o.deg, paint: painted, shade: shadeOf(light) });
  }
  const m = S.solidMeshes(placed);
  return { ...m.lit, glow: m.glow };
}

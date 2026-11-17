// Copied from Dungeon (src/render/look3d.ts) by scripts/sync-dungeon-library.mjs, Dungeon b102367. Change it there and run the script again.
// The builder's 3D view (14 November 2026): Dungeon shows the map being built in Table's own 3D
// view, so there's one 3D view, not two. Dungeon frames Table's /look3d page and sends it the open
// level as it changes; Table draws it as it draws a scene, with no fog and no tokens (a map maker
// has neither). This file is what the two say to each other, and how Table checks what it's sent,
// kept in Dungeon's library so both have the one copy (Table's comes through the library's sync).
//
// Dungeon to Table:
//   { look3d: "map", v: 1, map: LookMap }    the open level, again after every change
//   { look3d: "roofs", on: boolean }         buildings' roofs on, or lifted off to see inside
//   { look3d: "fit" }                        the camera back to the whole map
// Table to Dungeon:
//   { look3d: "ready", v: 1 }                 the page is listening
//   { look3d: "lost" }                        the device took WebGL back: Dungeon shows a note
//
// Places are in cells (squares), (0, 0) the map's top-left corner, as Dungeon keeps them.

import { isFlat, type Form, type Part } from "./solid";

export const LOOK3D_VERSION = 1;

/** An object standing up: its library id, where it is, how big, how it's turned, its form and its drawing's colour. */
export interface LookObject {
  id: string;
  /** Its middle, in cells. */
  x: number;
  y: number;
  /** Its longer side, in cells, as placed. */
  size: number;
  /** Turned this many degrees clockwise. */
  deg: number;
  form: Form;
  /** Its drawing's average colour, 0 to 1 each (what its seasonal parts, the leaves, are painted). */
  color: [number, number, number] | null;
}

export interface LookMap {
  /** Which map and level this is: the camera fits a new one, and stays put while one changes. */
  key: string;
  /** In cells. */
  width: number;
  height: number;
  /** The level drawn from above without what stands up, as Dungeon draws it. */
  floor: ImageBitmap;
  /** Walls, in the map's wall texture ("wall-stone"), as [x0, y0, x1, y1] in cells, cut where doors and arches are. */
  walls: number[][];
  wallTexture: string;
  /**
   * Each wall's own texture, one for each of `walls` (15 November 2026: a wall keeps the style it
   * was built in). Missing (a Dungeon from before), or not one for each: every wall in wallTexture.
   */
  wallTextures?: string[];
  /**
   * How tall each of `walls` stands, in metres (17 November 2026: walls' heights can be set,
   * model/wallHeights.ts). Missing (a Dungeon from before), or not one for each: every wall 3 m.
   */
  wallHeights?: number[];
  /**
   * Where each of `walls` starts, in metres off the ground: 0 for a wall, more for the wall over a
   * doorway in a wall taller than 3 m (Dungeon's model/headers.ts). Missing, or not one for each: all 0.
   */
  wallBottoms?: number[];
  /** Cave edges, standing as rock in the floor's own colour. */
  rock: number[][];
  /** Doors, shut, as their lines. */
  doors: number[][];
  objects: LookObject[];
  /** Squares under a roof: room floors on open ground (an underground level has none). */
  roofed: [number, number][];
  /**
   * Floor standing above the ground (17 November 2026, Dungeon's model/floorHeights.ts): each
   * polygon's rings (flat x, y lists in cells: its outline, then any holes) and its height in
   * metres. What's on it stands on it. Missing: every floor on the ground.
   */
  raised?: { rings: number[][]; m: number }[];
}

const MAX_LINES = 40_000;
const MAX_OBJECTS = 20_000;
const MAX_CELLS = 200_000;
const MAX_PARTS = 60;
const MAX_SIDE = 2000;

const num = (v: unknown, lo = -1e6, hi = 1e6): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function lines(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length > MAX_LINES) return null;
  const out: number[][] = [];
  for (const l of v) {
    if (!Array.isArray(l) || l.length !== 4 || !l.every((n) => num(n))) return null;
    out.push([l[0], l[1], l[2], l[3]]);
  }
  return out;
}

const PART_KINDS = new Set(["box", "cyl", "ball", "gable", "slab", "limb"]);

/** A form as sent: plain parts of the kinds solid.ts knows, every number a number. */
function cleanForm(v: unknown): Form | null {
  if (!v || typeof v !== "object") return null;
  if ("flat" in v) return typeof (v as { flat: unknown }).flat === "string" ? { flat: String((v as { flat: string }).flat).slice(0, 200) } : null;
  const parts = (v as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || !parts.length || parts.length > MAX_PARTS) return null;
  for (const p of parts) {
    if (!p || typeof p !== "object" || !PART_KINDS.has((p as { k: string }).k)) return null;
    // Every number in a part is a sane number; colours are short strings or { paint }.
    for (const [key, val] of Object.entries(p as Record<string, unknown>)) {
      if (key === "k" || key === "along") continue;
      if (key === "c") {
        const ok = typeof val === "string" ? val.length < 12 : !!val && typeof val === "object" && Object.values(val).every((s) => typeof s === "string" && s.length < 12);
        if (!ok) return null;
        continue;
      }
      if (key === "glow") continue;
      if (key === "pts" || key === "a" || key === "b") {
        if (!Array.isArray(val) || val.length > 64 || !val.every((n) => num(n, -100, 100))) return null;
        continue;
      }
      if (!num(val, -100, 100)) return null;
    }
  }
  const f = v as { surface?: unknown; rests?: unknown };
  return {
    parts: parts as Part[],
    ...(num(f.surface, 0, 100) ? { surface: f.surface } : {}),
    ...(f.rests === true ? { rests: true } : {}),
  };
}

/** What Table takes from a "map" message: everything checked, or null for anything that isn't a map. */
export function cleanLookMap(v: unknown, isBitmap: (b: unknown) => b is ImageBitmap): LookMap | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (typeof m.key !== "string" || m.key.length > 200) return null;
  if (!num(m.width, 1, MAX_SIDE) || !num(m.height, 1, MAX_SIDE)) return null;
  if (!isBitmap(m.floor)) return null;
  const walls = lines(m.walls), rock = lines(m.rock), doors = lines(m.doors);
  if (!walls || !rock || !doors) return null;
  const isTexture = (t: unknown): t is string => typeof t === "string" && /^[a-z0-9-]{1,40}$/.test(t);
  if (!isTexture(m.wallTexture)) return null;
  // Each wall's own: kept only when there's one for each wall, every one a texture's id.
  const own = m.wallTextures;
  const wallTextures = Array.isArray(own) && own.length === walls.length && own.every(isTexture) ? own.slice() : undefined;
  // Each wall's height (metres), the same way: one for each wall, every one a sane height.
  const tall = m.wallHeights;
  const wallHeights = Array.isArray(tall) && tall.length === walls.length && tall.every((h) => num(h, 0.5, 30)) ? (tall.slice() as number[]) : undefined;
  const low = m.wallBottoms;
  const wallBottoms = wallHeights && Array.isArray(low) && low.length === walls.length && low.every((b, i) => num(b, 0, 30) && b < wallHeights[i]) ? (low.slice() as number[]) : undefined;
  if (!Array.isArray(m.objects) || m.objects.length > MAX_OBJECTS) return null;
  const objects: LookObject[] = [];
  for (const o of m.objects as Record<string, unknown>[]) {
    if (!o || typeof o.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(o.id)) return null;
    if (!num(o.x) || !num(o.y) || !num(o.size, 0.01, 1000) || !num(o.deg)) return null;
    const form = cleanForm(o.form);
    if (!form || isFlat(form)) continue;
    const c = o.color;
    const color = Array.isArray(c) && c.length === 3 && c.every((n) => num(n, 0, 1)) ? ([c[0], c[1], c[2]] as [number, number, number]) : null;
    objects.push({ id: o.id, x: o.x, y: o.y, size: o.size, deg: o.deg, form, color });
  }
  if (!Array.isArray(m.roofed) || m.roofed.length > MAX_CELLS) return null;
  const roofed: [number, number][] = [];
  for (const cell of m.roofed) {
    if (!Array.isArray(cell) || cell.length !== 2 || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) return null;
    roofed.push([cell[0], cell[1]]);
  }
  const raised = cleanRaised(m.raised);
  return { key: m.key, width: m.width, height: m.height, floor: m.floor, walls, wallTexture: m.wallTexture, ...(wallTextures ? { wallTextures } : {}), ...(wallHeights ? { wallHeights } : {}), ...(wallBottoms ? { wallBottoms } : {}), rock, doors, objects, roofed, ...(raised ? { raised } : {}) };
}

const MAX_RAISED = 2000;
const MAX_RAISED_POINTS = 100_000;

/** Raised floors as sent: polygons of rings of sane numbers, each with a height of 0 to 30 m; undefined when none is (or any is wrong). */
function cleanRaised(v: unknown): { rings: number[][]; m: number }[] | undefined {
  if (!Array.isArray(v) || !v.length || v.length > MAX_RAISED) return undefined;
  const out: { rings: number[][]; m: number }[] = [];
  let points = 0;
  for (const p of v as { rings?: unknown; m?: unknown }[]) {
    if (!p || !num(p.m, 0, 30) || !Array.isArray(p.rings) || !p.rings.length) return undefined;
    const rings: number[][] = [];
    for (const r of p.rings) {
      if (!Array.isArray(r) || r.length < 6 || r.length % 2 || !r.every((n) => num(n))) return undefined;
      points += r.length / 2;
      if (points > MAX_RAISED_POINTS) return undefined;
      rings.push(r.slice() as number[]);
    }
    out.push({ rings, m: p.m });
  }
  return out;
}

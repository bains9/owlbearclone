// Magic in the 3D view (view3d.ts): the spells on the map, as the flat map draws them, each on a
// sheet of its own in the scene, standing as tall as the spell list makes it (Volume, below). A
// sphere is a dome of its drawing laid in layers, a cube a block of them, Moonbeam a column of
// light, a wall a skin of its colour 3 m high; plants, webs and a ring of fire rise a metre or two;
// grease, spikes, a pit and water lie on the floor. Spells being cast: a burst swells as a sphere,
// a bolt flies at chest height. The looks on tokens hang at a figure's middle, or on the floor at
// its feet. Fog and the dark hide them as they hide them in 2D, but for spells being cast, which
// the flat map draws over everything too. The board says where each is and draws it (board.ts
// effects3d); here, the arithmetic, kept apart from three.js so it's tested.

import { FX_LOOKS, type FxLook } from "../../shared/spellfx";
import type { ZoneLook } from "../../shared/zones";

/** Where an effect's sheet hangs: on the floor, at a figure's middle, or in the air above it. */
export type EffectLevel = "ground" | "mid" | "air";

/** The heights (squares) of a level's sheets, and how see-through each is. */
export const EFFECT_SHEETS: Record<EffectLevel, { heights: readonly number[]; opacity: number }> = {
  ground: { heights: [0.02], opacity: 1 },
  mid: { heights: [0.5], opacity: 1 },
  air: { heights: [0.35, 0.95], opacity: 0.6 },
};

/** A rectangle in scene units. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One spell on the map, as the board gives it to the 3D view. */
export interface Effect3d {
  /** The same while it lasts: its drawing's, its token's and look's, or the cast's. */
  key: string;
  level: EffectLevel;
  /** Where it's drawn, with room round it, in scene units. */
  bounds: Bounds;
  /** Hidden by the fog and the dark as on the flat map (all but spells being cast). */
  mask: boolean;
  /** How it stands up: a dome, a cube, a column, a wall (zoneVolume, castVolume); without one, sheets at its level's heights. */
  volume?: Volume;
  /** It moves (drawn again and again while it shows). */
  moving: boolean;
  /** Draws it onto `c`, set to scene units, `px` scene units a pixel, as it is at `now`. */
  draw(c: CanvasRenderingContext2D, now: number, px: number): void;
}

/** A spell area's sheet: the area's rectangle and some room round it (its edge glows past it). */
export function zoneBounds(points: readonly number[], cell: number): Bounds {
  const [ax, ay, bx, by] = points;
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const m = Math.max(cell * 0.5, Math.max(x1 - x0, y1 - y0) * 0.12);
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

/** A look on a token: round it, out to twice its size (sparkles, after-images close behind). */
export function tokenLookBounds(x: number, y: number, r: number, cell: number): Bounds {
  const m = r * 2 + cell * 0.5;
  return { x0: x - m, y0: y - m, x1: x + m, y1: y + m };
}

/** A spell being cast: from where it starts to where it lands, and its reach round both. */
export function castBounds(a: { x: number; y: number }, b: { x: number; y: number }, r: number, cell: number): Bounds {
  const m = Math.max(r, cell) + cell;
  return { x0: Math.min(a.x, b.x) - m, y0: Math.min(a.y, b.y) - m, x1: Math.max(a.x, b.x) + m, y1: Math.max(a.y, b.y) + m };
}

/**
 * An effect's sheet's pixels per scene unit: about 32 a square (24 on a phone or tablet), but the
 * sheet never more than 512 pixels across, so a big cloud doesn't cost a phone dear.
 */
export function effectScale(b: Bounds, cell: number, touch: boolean): number {
  const long = Math.max(b.x1 - b.x0, b.y1 - b.y0, 1);
  return Math.min((touch ? 24 : 32) / Math.max(cell, 1), 512 / long);
}

/** Whether two rectangles are the same size (a moved token's look keeps its sheet, just moved). */
export function sameSize(a: Bounds, b: Bounds): boolean {
  return Math.abs(a.x1 - a.x0 - (b.x1 - b.x0)) < 0.5 && Math.abs(a.y1 - a.y0 - (b.y1 - b.y0)) < 0.5;
}

/** Moving effects are drawn again at most this often (ms): smooth enough, light on a phone. */
export const EFFECT_STEP_MS = 50;

// ---------------------------------------------------------------- how tall each spell stands

/** A square, in metres (the 3D view's real scale, view3dModel.ts). */
const METRES = 1.5;
/** The tallest a spell stands, in metres: Cloudburst's "20 m high cylinder", the spell list's tallest. */
const TALLEST_M = 20;
/** How far apart a cloud's layers are, at most, in squares. */
const LAYER_GAP = 0.6;
/** The most layers a spell is drawn in (a phone draws each one). */
const MOST_LAYERS = 8;
/** How much a cloud hides, looking straight down through all its layers (two sheets at 0.6, as before). */
const CLOUD_HIDES = 0.84;

/**
 * A spell's shape in 3D, as the spell list gives it (the vault's table-spell-effects note): a
 * sphere or globe stands on the ground as a dome as tall as it's wide (Fog Cloud, Darkness, Tiny
 * Hut, a Fireball); a cube rises as tall as its side (Wall of Fog, Stinking Cloud, Acid Rain);
 * Moonbeam is a 15 m column, Cloudburst a 20 m one; a wall stands 3 m; plants, webs and a ring of
 * fire rise a metre or two; what lies on the ground (grease, a pit, spikes, water) stays flat.
 */
export interface Volume {
  /** A sphere on the ground (narrowing to its top), or straight up from its whole area (a cube, a column, a wall). */
  form: "dome" | "block";
  /** Round (an ellipse in its area) or square. */
  round: boolean;
  /** The spell's own area, scene units (its sheet's bounds have room round it). */
  area: Bounds;
  /** Its bottom and top above the ground, in squares. */
  bottom: number;
  top: number;
  /** How many times its drawing is laid through it, bottom to top (1: at the bottom only). */
  layers: number;
  /** How see-through the bottom layer is, and each one above it. */
  base: number;
  rest: number;
  /** Its outside, a skin in the spell's colour fading upwards: how much it shows (0: none). */
  skin: number;
  /** It gives light (moonlight, fire, a force's shimmer): its skin adds to what's behind it. */
  glow: boolean;
}

const m = (metres: number) => metres / METRES;
const capped = (squares: number) => Math.min(squares, m(TALLEST_M));
const layersFor = (height: number) => Math.max(3, Math.min(MOST_LAYERS, Math.round(height / LAYER_GAP) + 1));

/** Lying on the ground, as on the flat map. */
function flat(round: boolean, area: Bounds, base = 1): Volume {
  return { form: "block", round, area, bottom: 0.02, top: 0.02, layers: 1, base, rest: base, skin: 0, glow: false };
}

/** A cloud filling a sphere (a dome on the ground) or a cube, in layers that together hide as two sheets did. */
function cloud(round: boolean, area: Bounds, height: number, skin: number, glow = false): Volume {
  const layers = layersFor(height);
  const each = 1 - (1 - CLOUD_HIDES) ** (1 / layers);
  return { form: round ? "dome" : "block", round, area, bottom: 0.05, top: height, layers, base: each, rest: each, skin, glow };
}

/** Its drawing on the ground, and fainter copies of it rising to `height` (plants, a web, flames). */
function rising(round: boolean, area: Bounds, height: number, layers: number, skin = 0, glow = false): Volume {
  return { form: "block", round, area, bottom: 0.02, top: height, layers, base: 1, rest: 0.45, skin, glow };
}

/** Its drawing on the ground and a skin round it up to `height` (a column of light, a dome of force, a wall). */
function shell(form: "dome" | "block", round: boolean, area: Bounds, height: number, skin: number, glow: boolean, base = 1): Volume {
  return { form, round, area, bottom: 0.02, top: height, layers: 1, base, rest: base, skin, glow };
}

/**
 * How a spell area stands up (its look, its shape, its corners in scene units, and the spell's
 * name where the list gives that spell its own height).
 */
export function zoneVolume(look: ZoneLook, shape: "ellipse" | "rect", points: readonly number[], cell: number, spell?: string): Volume {
  const [ax, ay, bx, by] = points;
  const area = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
  const round = shape === "ellipse";
  const w = (area.x1 - area.x0) / cell, h = (area.y1 - area.y0) / cell;
  // A sphere's radius, or a cube's side: as tall as that.
  const sized = capped(round ? Math.min(w, h) / 2 : Math.min(w, h));
  switch (spell) {
    case "Wall of Water":
      return rising(round, area, m(3), 4, 0.35);
    case "Wall of Moonlight":
      return shell("block", round, area, m(3), 0.5, true);
    case "Forceward":
    case "Line of defence":
      return shell("block", round, area, m(3), 0.4, true, 0.6);
    case "Spell Vortex":
      // "2 × 4 m vortex".
      return rising(round, area, m(4), 5, 0.3, true);
    case "Briartangle":
      // A thicket that stops arrows: head high.
      return rising(round, area, m(2), 4);
    case "Earthen Grasp":
      return rising(round, area, m(1.5), 3);
    case "Minor Illusion":
      return cloud(round, area, m(3), 0.15, true);
    case "Acid Rain":
      return cloud(round, area, sized, 0.15);
    case "Corrosive Solvent":
      return flat(round, area);
  }
  switch (look) {
    case "fog":
    case "poison-cloud":
    case "darkness":
      return cloud(round, area, sized, 0.18);
    case "hypnotic":
      return cloud(round, area, sized, 0.15, true);
    case "light":
      // A globe of light: its drawing on the ground, and a faint glow over it.
      return shell(round ? "dome" : "block", round, area, sized, 0.12, true);
    case "moonbeam":
      // Moonbeam: "2 m radius, 15 m tall cylinder".
      return shell("block", round, area, m(15), 0.5, true);
    case "force-dome":
      return shell(round ? "dome" : "block", round, area, round ? sized : m(3), 0.35, true, 0.6);
    case "fire-ring":
      return rising(round, area, m(1.5), 3, 0.45, true);
    case "vines":
      return rising(round, area, m(1), 3);
    case "web":
      return rising(round, area, m(2), 3);
    case "spirit-weapon":
      // A weapon in the air at head height.
      return { ...flat(round, area, 0.9), bottom: m(1.8), top: m(1.8) };
    default:
      // Spikes, a pit, water, grease, a bridge, a path, a marked zone: on the ground.
      return flat(round, area);
  }
}

/** How a spell being cast stands up: a burst swells as a sphere (or a column of rain, falling stones); the rest at chest height. */
export function castVolume(look: FxLook, a: { x: number; y: number }, b: { x: number; y: number }, r: number, cell: number): Volume {
  const area = { x0: b.x - r, y0: b.y - r, x1: b.x + r, y1: b.y + r };
  const chest = { ...flat(true, castBounds(a, b, r, cell)), bottom: m(1.2), top: m(1.2) };
  if (FX_LOOKS[look].cast !== "burst") return chest;
  if (look === "earth-maw") return flat(true, area);
  // Cloudburst: "10 m wide, 20 m high cylinder"; stones fall from well overhead.
  if (look === "downpour") return { ...cloud(true, area, m(TALLEST_M), 0), form: "block" };
  if (look === "falling-stones") return { ...cloud(true, area, m(6), 0), form: "block" };
  return cloud(true, area, capped(r / cell), 0);
}

/** Where each of an effect's sheets hangs (squares above the ground), how much it's shrunk (a dome narrows to its top), and how see-through it is. */
export function sheetLayers(e: { level: EffectLevel; volume?: Volume }): { y: number; scale: number; opacity: number }[] {
  const v = e.volume;
  if (!v) return EFFECT_SHEETS[e.level].heights.map((y) => ({ y, scale: 1, opacity: EFFECT_SHEETS[e.level].opacity }));
  return Array.from({ length: v.layers }, (_, i) => {
    const opacity = i === 0 ? v.base : v.rest;
    if (v.form === "dome") {
      // Through the lower part of the sphere: its top layer not a dot.
      const y = Math.max(v.bottom, (v.top * i) / v.layers);
      return { y, scale: Math.sqrt(Math.max(0, 1 - (y / v.top) ** 2)), opacity };
    }
    return { y: v.layers === 1 ? v.bottom : v.bottom + ((v.top - v.bottom) * i) / (v.layers - 1), scale: 1, opacity };
  });
}

/** Whether two effects stand up the same (a moved one keeps its sheets, just moved). */
export function sameVolume(a: Volume | undefined, b: Volume | undefined): boolean {
  if (!a || !b) return a === b;
  return a.form === b.form && a.round === b.round && a.layers === b.layers && Math.abs(a.top - b.top) < 0.01 && Math.abs(a.bottom - b.bottom) < 0.01 && a.skin === b.skin;
}

/**
 * A volume's skin: triangles round its area from its bottom to its top (a dome's narrowing to its
 * top), in squares from the area's middle on the ground, and how far up each corner is (0 to 1).
 */
export function skinMesh(v: Volume, cell: number, around = 48, rows = 6): { position: Float32Array; rise: Float32Array } {
  const rx = (v.area.x1 - v.area.x0) / 2 / cell, rz = (v.area.y1 - v.area.y0) / 2 / cell;
  const pos: number[] = [], rise: number[] = [];
  // A point on the skin: `u` round it (0 to 1), `t` up it (0 to 1).
  const at = (u: number, t: number): [number, number, number] => {
    if (v.form === "dome") {
      const th = (t * Math.PI) / 2, a = u * Math.PI * 2;
      return [rx * Math.cos(th) * Math.cos(a), Math.max(v.bottom, v.top * Math.sin(th)), rz * Math.cos(th) * Math.sin(a)];
    }
    const y = v.bottom + (v.top - v.bottom) * t;
    if (v.round) {
      const a = u * Math.PI * 2;
      return [rx * Math.cos(a), y, rz * Math.sin(a)];
    }
    // Round a rectangle's four sides.
    const s = Math.min(3, Math.floor(u * 4)), f = u * 4 - s;
    const [x, z] = s === 0 ? [-rx + 2 * rx * f, -rz] : s === 1 ? [rx, -rz + 2 * rz * f] : s === 2 ? [rx - 2 * rx * f, rz] : [-rx, rz - 2 * rz * f];
    return [x, y, z];
  };
  const n = v.round || v.form === "dome" ? around : 4 * Math.ceil(around / 4);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < n; i++) {
      const corners: [number, number][] = [
        [i / n, j / rows],
        [(i + 1) / n, j / rows],
        [(i + 1) / n, (j + 1) / rows],
        [i / n, (j + 1) / rows],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [u, t] = corners[k];
        pos.push(...at(u, t));
        rise.push(t);
      }
    }
  }
  return { position: Float32Array.from(pos), rise: Float32Array.from(rise) };
}

/** A drawing's colour, as its pixels show it (weighted by how solid each is); null when there's next to nothing drawn. */
export function meanColour(rgba: Uint8ClampedArray, step = 4): [number, number, number] | null {
  let r = 0, g = 0, b = 0, w = 0;
  for (let p = 0; p < rgba.length; p += 4 * step) {
    const a = rgba[p + 3];
    if (!a) continue;
    r += rgba[p] * a;
    g += rgba[p + 1] * a;
    b += rgba[p + 2] * a;
    w += a;
  }
  return w < 255 * 4 ? null : [r / w / 255, g / w / 255, b / w / 255];
}

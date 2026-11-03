// What Dungeon's objects do in the seasons: a role for each from its name, by the same keyword
// tables as Dungeondraft's own objects (dd/roles.ts), and from the role how its drawing changes.
// Pure (no DOM), so tests can check it; dungeonStamps.ts does the drawing.
//
// Everything outdoors that isn't smoke, a ripple or a snowdrift gets snow on it in winter, kept
// to its own shape (never over its ink outlines or a flame). Plants change in every season, as
// Tabletop's own tree and bush do: fresher green and blossom in spring, dry in a hot summer,
// autumn colours (pines stay green), and in deep snow most broadleaf trees bare. Colours are
// changed as Dungeon draws them, so the drawing stays crisp and its light and shade carry over.

import { DUNGEON_PROPS } from "../../shared/dungeonCatalog";
import { isDungeonStamp, type DungeonStampId, type StampId } from "../../shared/terrain";
import type { SeasonLook } from "../../shared/types";
import { OR, objectRole, type ObjectRole } from "../dd/roles";
import type { SeasonLevel, StampLook } from "./buildArt";

const ROLE = new Map<string, ObjectRole>(DUNGEON_PROPS.map((p) => [`d:${p.id}`, objectRole(`dungeon/${p.id}`)]));
const NATURAL = new Map<string, number>(DUNGEON_PROPS.map((p) => [`d:${p.id}`, Math.max(p.w, p.h)]));

/** A Dungeon object's season role, from its name (dd/roles.ts): "d:oak-tree" is DECIDUOUS, "d:table" STRUCTURE. */
export function dungeonRole(id: DungeonStampId): ObjectRole {
  return ROLE.get(id) ?? OR.STRUCTURE;
}

/** Things that grow: they make the squares they stand on outdoors, as Tabletop's tree and bush do. */
const GROWING: ReadonlySet<ObjectRole> = new Set<ObjectRole>([
  OR.EVERGREEN, OR.DECIDUOUS, OR.BARE, OR.SHRUB, OR.FLOWER_SHRUB, OR.FLOWERS, OR.GRASS, OR.REEDS, OR.CROP,
]);
/** What changes colour in a season other than winter (a dead tree stays as it is). */
const GREEN: ReadonlySet<ObjectRole> = new Set<ObjectRole>([
  OR.EVERGREEN, OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB, OR.FLOWERS, OR.GRASS, OR.REEDS, OR.CROP,
]);
/** Pines and firs keep their needles in autumn. */
const TURNS: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB, OR.FLOWERS, OR.GRASS, OR.REEDS, OR.CROP]);
/** Snow doesn't lie on smoke, ripples or a snowdrift (which is snow already). */
const NO_SNOW: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.EFFECT, OR.WATER_FX, OR.SNOW]);
/** Trees and bushes come in a few varieties a look: which turn which colour, which blossom, which are bare. */
const VARIED: ReadonlySet<ObjectRole> = new Set<ObjectRole>([OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB]);
export const VARIETIES = 5;

/** Whether an object makes the squares it stands on outdoors (Tabletop's tree and bush, and Dungeon's plants). */
export function makesOutdoors(id: StampId): boolean {
  if (id === "tree" || id === "bush") return true;
  return isDungeonStamp(id) && GROWING.has(dungeonRole(id));
}

/** Whether an object changes in a season even with no snow on the ground round it (plants do). */
export function changesWithoutSnow(id: StampId): boolean {
  if (id === "tree" || id === "bush") return true;
  return isDungeonStamp(id) && GREEN.has(dungeonRole(id));
}

/** Whether a Dungeon object looks different in a season (hasSeasonalArt). */
export function dungeonSeasonal(id: DungeonStampId, look: SeasonLook): boolean {
  const role = dungeonRole(id);
  if (look === "winter") return !NO_SNOW.has(role);
  return look === "autumn" ? TURNS.has(role) : GREEN.has(role);
}

// ---------------------------------------------------------------- colours

export type Rgba = [number, number, number, number];

/** A CSS colour as Dungeon writes them ("#2c5220", "#abc", "rgba(20,35,15,0.6)"), or null. */
export function parseColour(css: string): Rgba | null {
  const s = css.trim().toLowerCase();
  if (s[0] === "#") {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((d) => parseInt(d + d, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
}

export function colourCss([r, g, b, a]: Rgba): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return a >= 1 ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${Math.round(a * 1000) / 1000})`;
}

/** Hue (degrees), saturation and value (0 to 1). */
export function toHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

function fromHsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v * 255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

/** Leaves, needles and grass as Dungeon draws them: green to blue-green, not grey. */
export function isLeafy(c: Rgba): boolean {
  const [h, s, v] = toHsv(c[0], c[1], c[2]);
  return h >= 65 && h <= 170 && s >= 0.2 && v >= 0.08;
}

/** Petals and berries: strongly coloured, and not green or brown. */
function isPetal(c: Rgba): boolean {
  const [h, s, v] = toHsv(c[0], c[1], c[2]);
  return s >= 0.45 && v >= 0.45 && !(h >= 65 && h <= 170) && !(h >= 15 && h <= 40 && v < 0.75);
}

/** A flame, an ember or lit glass: warm, bright and strong (only looked for on objects that give light). */
function isGlowing(c: Rgba): boolean {
  const [h, s, v] = toHsv(c[0], c[1], c[2]);
  return (h <= 60 || h >= 340) && s >= 0.4 && v >= 0.8;
}

/**
 * A colour moved towards `to` by `m` (0 none, 1 all the way): its hue and saturation become
 * the target's, and its value is scaled by the target's against a mid-tone leaf (Dungeon's
 * lighter leaves are about 0.5), so the drawing's light and shade carry over.
 */
function toward(c: Rgba, to: string, m: number): Rgba {
  if (m <= 0) return c;
  const t = parseColour(to)!;
  const [h, s, v] = toHsv(c[0], c[1], c[2]);
  const [th, ts, tv] = toHsv(t[0], t[1], t[2]);
  const dh = ((th - h + 540) % 360) - 180;
  const nv = Math.min(1, v * (1 + m * (tv / 0.5 - 1)));
  const [r, g, b] = fromHsv((h + dh * m + 360) % 360, s + (ts - s) * m, nv);
  return [r, g, b, c[3]];
}

function faded(c: Rgba, sat: number, val: number): Rgba {
  const [h, s, v] = toHsv(c[0], c[1], c[2]);
  const [r, g, b] = fromHsv(h, s * sat, v * val);
  return [r, g, b, c[3]];
}

// Tabletop's own seasonal leaf colours (buildArt's TREE_PALETTES and AUTUMN_HUES), so a
// Dungeon oak and a Tabletop tree side by side turn alike.
const SPRING = "#6cae4c";
const SPRING_PINE = "#4c8f37";
const CHERRY = "#e7a0bc";
const SUMMER2 = "#7a8741";
const SUMMER3 = "#9d9148";
const WINTER1 = "#7a9685";
const WINTER2 = "#6b8674";
const STRAW = "#b8a24a";
const GOLD = "#d4a22e";
const RUSHES = "#a08850";
/** Yellow, orange and red, each a lighter and a darker one. */
const AUTUMN = [
  ["#e2b33b", "#d4a22e"],
  ["#dc842c", "#c9722a"],
  ["#bb452c", "#a73a2b"],
];
/** By level: the share of a crown's clumps still green, the share fallen, and of those turned the share red. */
const AUTUMN_GREEN = [0.45, 0.25, 0.12];
const AUTUMN_FALLEN = [0.1, 0.22, 0.35];
const AUTUMN_RED = [0.12, 0.26, 0.3];

/** A seeded random number from 0 to 1 (mulberry32, as Dungeon's own). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Leaves it out (a fallen clump), or rubs it out on a mask (an outline, a flame). */
export const ERASE = "erase";
export type InkResult = string | null | typeof ERASE;
/**
 * How one picture of a drawing colours what it's given: `salt` is the same for every use of
 * one fillStyle or strokeStyle setting, so each clump of a crown is coloured once.
 */
export type Ink = (css: string, kind: "fill" | "stroke", salt: number, gradient: boolean) => InkResult;

/** The colours of an object in a look (the main picture). */
function seasonInk(role: ObjectRole, look: SeasonLook, level: SeasonLevel, variety: number, cherry: boolean, seed: number): Ink {
  const L = level - 1;
  const rand = seeded(seed ^ (level * 0x9e3779b1) ^ (variety * 0x85ebca6b));
  /** Autumn: each clump's colour, picked the first time its salt comes (-1 fallen, 0 green, 1 to 3 yellow to red). */
  const clumps = new Map<number, number>();
  const clumpOf = (salt: number, gradient: boolean): number => {
    let k = clumps.get(salt);
    if (k === undefined) {
      const x = rand();
      // The crown's dark base is one fill under all its clumps: it never falls.
      if (gradient && x < AUTUMN_FALLEN[L]) k = -1;
      else if (rand() < AUTUMN_GREEN[L]) k = 0;
      else {
        const y = rand();
        k = y < AUTUMN_RED[L] ? 3 : y < AUTUMN_RED[L] + (1 - AUTUMN_RED[L]) / 2 ? 2 : 1;
      }
      clumps.set(salt, k);
    }
    return k;
  };
  const leaf = (c: Rgba, salt: number, gradient: boolean): Rgba | null => {
    switch (look) {
      case "spring":
        if (cherry) return toward(c, CHERRY, 0.85);
        return toward(c, role === OR.EVERGREEN ? SPRING_PINE : SPRING, (role === OR.EVERGREEN ? [0.15, 0.2, 0.25] : [0.35, 0.55, 0.7])[L]);
      case "summer":
        if (level === 1) return c;
        return toward(c, level === 2 ? SUMMER2 : SUMMER3, (level === 2 ? 0.45 : 0.7) * (role === OR.EVERGREEN ? 0.4 : 1));
      case "winter":
        return toward(c, level === 1 ? WINTER1 : WINTER2, (role === OR.EVERGREEN ? [0.2, 0.25, 0.3] : [0.5, 0.65, 0.75])[L]);
      default: {
        if (role === OR.GRASS || role === OR.FLOWERS) return toward(c, STRAW, [0.35, 0.6, 0.8][L]);
        if (role === OR.CROP) return toward(c, GOLD, [0.5, 0.75, 0.9][L]);
        if (role === OR.REEDS) return toward(c, RUSHES, [0.3, 0.55, 0.75][L]);
        const k = clumpOf(salt, gradient);
        if (k < 0) return null;
        return k === 0 ? c : toward(c, AUTUMN[k - 1][salt & 1], 0.9);
      }
    }
  };
  const petal = (c: Rgba): Rgba => {
    if (look === "autumn") return faded(c, [0.8, 0.6, 0.45][L], [0.95, 0.85, 0.75][L]);
    if (look === "winter") return faded(c, 0.5, 0.85);
    if (look === "summer" && level === 3) return faded(c, 0.75, 0.95);
    return c;
  };
  return (css, _kind, salt, gradient) => {
    const c = parseColour(css);
    if (!c) return css;
    if (isLeafy(c)) {
      const out = leaf(c, salt, gradient);
      return out ? colourCss(out) : null;
    }
    return isPetal(c) ? colourCss(petal(c)) : css;
  };
}

/**
 * Where snow can lie, drawn as a mask: white for what's solid, nothing for see-through paint
 * (shadows, glows, wood grain), and rubbed out for ink outlines (so they stay sharp) and, on
 * something that gives light, its flames. A bare tree's branches are strokes: snow lies on them.
 */
export function snowInk(lit: boolean, bare: boolean): Ink {
  return (css, kind) => {
    const c = parseColour(css);
    if (!c || c[3] < 0.5) return null;
    if (lit && isGlowing(c)) return ERASE;
    if (kind === "fill") return "#fff";
    if (bare) return "#fff";
    return toHsv(c[0], c[1], c[2])[2] < 0.35 ? ERASE : null;
  };
}

/** Where blossom can come out, drawn as a mask: white for leaves, rubbed out for whatever lies over them. */
export function leafInk(): Ink {
  return (css, kind) => {
    const c = parseColour(css);
    if (!c) return null;
    if (kind === "fill") {
      if (c[3] < 0.5) return null;
      return isLeafy(c) ? "#fff" : ERASE;
    }
    return c[3] >= 0.5 && toHsv(c[0], c[1], c[2])[2] < 0.35 && !isLeafy(c) ? ERASE : null;
  };
}

// ---------------------------------------------------------------- one object in one look

export interface DungeonLook {
  /** Part of the sprite's key: everything that changes the picture. */
  key: string;
  /** The Dungeon drawing to use: its own, or a bare tree's in deep snow. */
  draw: string;
  ink: Ink;
  /** Snow over it, as StampLook.cover (0 none). */
  snow: 0 | 1 | 2 | 3;
  /** Snow lies along its strokes too (a bare tree's branches). */
  snowOnStrokes: boolean;
  /** Blossom over its leaves: the colours, and how many dots a square. */
  blossom: { colours: string[]; perSquare: number } | null;
  /** The object's longer side in squares, so snowflakes and blossom are the same size on every object. */
  natural: number;
  seed: number;
}

/**
 * How a Dungeon object looks in a season (s from BuildRenderer.stampLook), or null if just as
 * drawn. Varieties come from the object's place (s.hash), as for Tabletop's trees: in deep
 * snow 3 in 5 broadleaf trees are bare; in spring from level 2 some blossom, a third of those
 * cherry pink.
 */
export function dungeonLook(id: DungeonStampId, s: StampLook, lit: boolean): DungeonLook | null {
  const role = dungeonRole(id);
  // A summer that isn't hot leaves everything as drawn.
  if (!dungeonSeasonal(id, s.look) || (s.look === "summer" && s.level === 1)) return null;
  const snow = s.look === "winter" && !NO_SNOW.has(role) ? s.cover : 0;
  if (s.look === "winter" && !snow && !GREEN.has(role)) return null;
  const variety = VARIED.has(role) ? Math.min(VARIETIES - 1, Math.floor(s.hash * VARIETIES)) : 0;
  const hash = (variety + 0.5) / VARIETIES;
  const bare = (role === OR.DECIDUOUS && s.look === "winter" && s.level === 3 && hash < 0.6) || role === OR.BARE;
  const bloom = s.look === "spring" && s.level > 1 && (role === OR.DECIDUOUS ? hash < (s.level === 2 ? 0.4 : 0.75) : (role === OR.SHRUB || role === OR.FLOWER_SHRUB) && (s.level === 3 || hash < 0.6));
  const cherry = bloom && role === OR.DECIDUOUS && variety % 3 === 0;
  const seed = idSeed(id);
  const flowers = ["#fbfbf3", "#f2a7c3", "#f5d84c", "#c9b3f0"];
  return {
    key: `${s.look}${s.level}c${snow}v${variety}`,
    draw: bare ? "dead-tree" : id.slice(2),
    ink: seasonInk(role, s.look, s.level, variety, cherry, seed),
    snow,
    snowOnStrokes: bare,
    blossom: bloom
      ? role === OR.DECIDUOUS
        ? { colours: cherry ? ["#fbe3ec", "#d8799c"] : ["#fdf3f7", "#f6c3d4"], perSquare: s.level === 3 ? 22 : 13 }
        : { colours: [flowers[variety % flowers.length]], perSquare: s.level === 3 ? 30 : 20 }
      : null,
    natural: NATURAL.get(id) ?? 1,
    seed: seed ^ variety,
  };
}

/** A snowflake or blossom dot in the unit square: where, how big and how strong. */
export interface Dot {
  x: number;
  y: number;
  r: number;
  a: number;
}

/**
 * Snow lying on an object, by cover (1 frost, 2 patchy, 3 deep), as dots over the unit square
 * the object is drawn in: sized in squares, so a chair's snow is as coarse as a wagon's.
 * Deep snow also lays a white sheet under the dots (sheet), frost a light one.
 */
export function snowDots(natural: number, cover: 1 | 2 | 3, seed: number): { sheet: number; dots: Dot[] } {
  const rand = seeded(seed ^ (cover * 0x27d4eb2d));
  const area = natural * natural;
  const [n, r0, r1, a0] = cover === 1 ? [60, 0.012, 0.025, 0.55] : cover === 2 ? [26, 0.05, 0.11, 0.92] : [30, 0.07, 0.14, 0.96];
  const dots: Dot[] = [];
  for (let i = 0, count = Math.max(4, Math.round(n * area)); i < count; i++) {
    const x = rand() - 0.5;
    const y = rand() - 0.5;
    const r = (r0 + rand() * (r1 - r0)) / natural;
    const a = a0 * (0.8 + rand() * 0.2);
    // Frost is fine grains; snow lies in clumps of a few rounds, not in round spots.
    if (cover === 1) dots.push({ x, y, r, a });
    else for (let k = 0; k < 3; k++) dots.push({ x: x + (rand() - 0.5) * r * 1.1, y: y + (rand() - 0.5) * r * 1.1, r: r * (0.5 + rand() * 0.3), a });
  }
  return { sheet: cover === 1 ? 0.22 : cover === 2 ? 0 : 0.72, dots };
}

/** Blossom on an object's leaves, as dots over its unit square. */
export function blossomDots(natural: number, perSquare: number, seed: number): Dot[] {
  const rand = seeded(seed ^ 0xb10550);
  const dots: Dot[] = [];
  for (let i = 0, n = Math.max(3, Math.round(perSquare * natural * natural)); i < n; i++) {
    dots.push({ x: rand() - 0.5, y: rand() - 0.5, r: (0.022 + rand() * 0.016) / natural, a: 1 });
  }
  return dots;
}

// What built maps look like: a texture for each kind of floor, and a small top-down
// drawing for each object. Everything is drawn with the canvas API, so it stays sharp
// at any zoom and needs no image files.
//
// Seasons change only what's outdoors (build.ts works out where that is). Grass, and
// water and bare earth outdoors, get a texture of their own for the look and level;
// frost, snow, fallen leaves, dust and sprouts are see-through textures laid over
// outdoor ground; trees, bushes and, in winter, rocks, rubble, wells and campfires have
// seasonal drawings. Only the textures of the look in use are made, when first needed,
// and a seasonal tree or bush is one of a few dozen varieties, each made into paths once
// (see drawVariety).

import type { FloorId, StampId } from "../../shared/terrain";
import type { SeasonLook } from "../../shared/types";

/** Texture pixels per grid cell. */
export const TEXTURE_CELL_PX = 96;
/** A texture tile covers 2 x 2 cells, so the repeat is less obvious. */
const TILE = TEXTURE_CELL_PX * 2;

const INK = "#2b2520";
/** Snow, and the blue-grey of its shaded side. */
const SNOW = "#f4f7fc";
const SNOW_SHADE = "#c7d3e1";

export type SeasonLevel = 1 | 2 | 3;
/** A floor's texture: "" as it's always been, or a season's look and level ("winter2"). */
export type FloorVariant = "" | `${SeasonLook}${SeasonLevel}`;
/** See-through textures laid over outdoor ground in a season. */
export type OverlayId =
  | "frost"
  | "snow1"
  | "snow2"
  | `leaves${SeasonLevel}`
  | `leavesNear${SeasonLevel}`
  | "dust"
  | "sprouts2"
  | "sprouts3";

/** A small seeded random number generator, so the textures come out the same every time. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number for a string, to seed a seasonal texture's own random numbers. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Draws something at (x, y) and at its copies across the tile's edges, so the tile repeats
 * seamlessly. `reach` is how far the drawing can spread from (x, y).
 */
function wrapped(c: CanvasRenderingContext2D, x: number, y: number, draw: (x: number, y: number) => void, reach = 40): void {
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      const px = x + dx;
      const py = y + dy;
      if (px > -reach && px < TILE + reach && py > -reach && py < TILE + reach) draw(px, py);
    }
  }
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

/** A circle added to the current path (several make one path, filled at once). */
function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, Math.PI * 2);
}

function speckles(c: CanvasRenderingContext2D, rand: () => number, n: number, colors: string[], rMin: number, rMax: number, alpha = 1): void {
  c.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = rMin + rand() * (rMax - rMin);
    c.fillStyle = colors[Math.floor(rand() * colors.length)];
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
    });
  }
  c.globalAlpha = 1;
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------------------------------------------------------------- floors

function stoneTile(c: CanvasRenderingContext2D): void {
  const rand = rng(11);
  const base = "#cbc4b5";
  const slab = TEXTURE_CELL_PX / 2;
  for (let y = 0; y < TILE; y += slab) {
    for (let x = 0; x < TILE; x += slab) {
      c.fillStyle = shade(base, (rand() - 0.5) * 0.07);
      c.fillRect(x, y, slab, slab);
    }
  }
  speckles(c, rand, 160, ["#b3ab9b", "#d9d3c6"], 0.8, 2.2, 0.7);
  c.strokeStyle = "#a39a89";
  c.lineWidth = 2;
  c.beginPath();
  for (let v = 0; v <= TILE; v += slab) {
    c.moveTo(v, 0);
    c.lineTo(v, TILE);
    c.moveTo(0, v);
    c.lineTo(TILE, v);
  }
  c.stroke();
}

function woodTile(c: CanvasRenderingContext2D): void {
  const rand = rng(23);
  const base = "#a8723d";
  const plank = TEXTURE_CELL_PX / 4;
  c.fillStyle = base;
  c.fillRect(0, 0, TILE, TILE);
  for (let y = 0; y < TILE; y += plank) {
    // Each row of planks: joints at random places, repeating across the tile.
    let x = rand() * TILE;
    const joints: number[] = [];
    for (let covered = 0; covered < TILE; ) {
      const len = TEXTURE_CELL_PX * (0.9 + rand() * 1.1);
      joints.push(x);
      x += len;
      covered += len;
    }
    for (let i = 0; i < joints.length; i++) {
      const x0 = joints[i];
      const x1 = i + 1 < joints.length ? joints[i + 1] : joints[0] + TILE;
      c.fillStyle = shade(base, (rand() - 0.5) * 0.1);
      for (const dx of [-TILE, 0, TILE]) c.fillRect(x0 + dx, y, x1 - x0, plank);
      // Grain.
      c.strokeStyle = shade(base, -0.08);
      c.globalAlpha = 0.5;
      c.lineWidth = 1;
      for (let g = 0; g < 2; g++) {
        const gy = y + 4 + rand() * (plank - 8);
        for (const dx of [-TILE, 0, TILE]) {
          c.beginPath();
          c.moveTo(x0 + dx + 4, gy);
          c.lineTo(x1 + dx - 4, gy + (rand() - 0.5) * 3);
          c.stroke();
        }
      }
      c.globalAlpha = 1;
    }
    c.strokeStyle = "#6a4420";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(TILE, y);
    for (const j of joints) {
      for (const dx of [-TILE, 0, TILE]) {
        c.moveTo(j + dx, y);
        c.lineTo(j + dx, y + plank);
      }
    }
    c.stroke();
  }
  // The line along the tile's top edge is half cut off: its other half goes along the
  // bottom, drawn last so no plank is painted over it.
  c.strokeStyle = "#6a4420";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, TILE);
  c.lineTo(TILE, TILE);
  c.stroke();
}

interface DirtStyle {
  base: string;
  clods: string[];
  grains: string[];
}

const DIRT: DirtStyle = { base: "#977650", clods: ["#8a6a45", "#a4845c"], grains: ["#7d5f3c", "#b0906a", "#6f5436"] };
/** Wet in spring (darker, with puddles from level 2), dry and then cracked in a drought. */
const WET_DIRT: DirtStyle = { base: "#81633f", clods: ["#755a38", "#8d6e48"], grains: ["#654b2f", "#977855", "#5a432a"] };
const DIRT_SEASONS: Partial<Record<FloorVariant, DirtStyle>> = {
  spring1: WET_DIRT,
  spring2: WET_DIRT,
  spring3: WET_DIRT,
  summer2: { base: "#a88a60", clods: ["#9c7e55", "#b49670"], grains: ["#8f714b", "#c4a67e", "#7d6242"] },
  summer3: { base: "#b39a72", clods: ["#a88e67", "#bfa67e"], grains: ["#98805c", "#cdb58e", "#86694a"] },
};

function dirtTile(c: CanvasRenderingContext2D, v: FloorVariant): void {
  const s = DIRT_SEASONS[v] ?? DIRT;
  const rand = rng(37);
  c.fillStyle = s.base;
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 40, s.clods, 8, 18, 0.5);
  speckles(c, rand, 260, s.grains, 0.8, 2.6, 0.8);
  if (!v) return;
  const more = rng(hashString(v));
  if (v === "spring2" || v === "spring3") puddles(c, more, v === "spring2" ? 1 : 2);
  if (v === "summer3") cracks(c, more, 10, "#6a5034", "rgba(222, 204, 170, 0.7)");
}

interface GrassStyle {
  base: string;
  patches: string[];
  blades: [string, string];
  /** The share of blades in the first colour. */
  first: number;
}

const GRASS: GrassStyle = { base: "#6e9a45", patches: ["#659041", "#79a64f"], blades: ["#557d33", "#8cba5c"], first: 0.5 };
/** Dormant winter grass, under the snow. */
const DORMANT: GrassStyle = { base: "#7f8a62", patches: ["#76805a", "#8a946b"], blades: ["#646e48", "#9aa378"], first: 0.5 };
const FRESH: GrassStyle = { base: "#77ad48", patches: ["#6da242", "#86bd56"], blades: ["#5e9238", "#a0d468"], first: 0.5 };
const GRASS_SEASONS: Record<FloorVariant, GrassStyle> = {
  "": GRASS,
  // Frosted: paler and colder, the blade tips white.
  winter1: { base: "#7d9278", patches: ["#74896f", "#879c82"], blades: ["#63795e", "#c3d0c6"], first: 0.6 },
  winter2: DORMANT,
  winter3: DORMANT,
  // Olive with gold blades, golden olive, brown olive.
  autumn1: { base: "#7f9446", patches: ["#76893f", "#8a9f50"], blades: ["#66793a", "#c9a94a"], first: 0.7 },
  autumn2: { base: "#96914a", patches: ["#8a8543", "#a39e56"], blades: ["#77743a", "#d0ad4f"], first: 0.55 },
  autumn3: { base: "#8a7a46", patches: ["#7e6f3e", "#998a53"], blades: ["#6b5d33", "#b8904a"], first: 0.5 },
  spring1: FRESH,
  spring2: FRESH,
  spring3: FRESH,
  // Deep green, olive with dry blades, straw.
  summer1: { base: "#4f8a3a", patches: ["#467f33", "#5a9642"], blades: ["#3b6b28", "#6fa54a"], first: 0.5 },
  summer2: { base: "#7e8c46", patches: ["#74823f", "#8b9950"], blades: ["#636f37", "#c4b26a"], first: 0.55 },
  summer3: { base: "#b3a15f", patches: ["#a8955a", "#c1af6e"], blades: ["#978547", "#d9c688"], first: 0.5 },
};

function grassTile(c: CanvasRenderingContext2D, v: FloorVariant): void {
  const s = GRASS_SEASONS[v];
  const rand = rng(41);
  c.fillStyle = s.base;
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 30, s.patches, 10, 22, 0.5);
  c.lineCap = "round";
  c.lineWidth = 1.6;
  for (let i = 0; i < 260; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const len = 3 + rand() * 5;
    const lean = (rand() - 0.5) * 4;
    c.strokeStyle = rand() < s.first ? s.blades[0] : s.blades[1];
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + lean, py - len);
      c.stroke();
    });
  }
  if (!v) return;
  const more = rng(hashString(v));
  switch (v) {
    case "winter1":
      frost(c, more);
      break;
    case "winter2": {
      // About two thirds under snow, tufts poking through. (The snow is cut out on a
      // canvas of its own, then laid over the grass.)
      const layer = document.createElement("canvas");
      layer.width = TILE;
      layer.height = TILE;
      snowSheet(layer.getContext("2d")!, more, 20, 6, 12);
      c.drawImage(layer, 0, 0);
      tufts(c, more, 22, ["#6b7550", "#8b9468"]);
      break;
    }
    case "winter3":
      deepSnow(c, more);
      break;
    case "spring2":
      flowers(c, more, 14);
      break;
    case "spring3":
      flowers(c, more, 40);
      break;
    case "summer3":
      // Bare, dry earth in patches.
      for (let i = 0; i < 7; i++) {
        const x = more() * TILE;
        const y = more() * TILE;
        c.fillStyle = more() < 0.5 ? "#a4845a" : "#9a7a52";
        c.globalAlpha = 0.75;
        const bits = Array.from({ length: 5 }, () => [(more() - 0.5) * 20, (more() - 0.5) * 14, 3 + more() * 6]);
        wrapped(c, x, y, (px, py) => {
          c.beginPath();
          for (const [dx, dy, r] of bits) disc(c, px + dx, py + dy, r);
          c.fill();
        });
        c.globalAlpha = 1;
      }
      speckles(c, more, 90, ["#8a6c47", "#c2a57a"], 0.6, 1.6, 0.7);
      break;
  }
}

interface WaterStyle {
  base: string;
  patches: string[];
  ripple: string;
  rippleAlpha: number;
}

const WATER: WaterStyle = { base: "#3f7fb0", patches: ["#3a76a5", "#4889bb"], ripple: "#8fc0e3", rippleAlpha: 0.7 };
const COLD_WATER: WaterStyle = { base: "#4a7d9c", patches: ["#447596", "#5486a4"], ripple: "#c4dae8", rippleAlpha: 0.6 };
const WATER_SEASONS: Partial<Record<FloorVariant, WaterStyle>> = {
  winter1: COLD_WATER,
  winter2: COLD_WATER,
  // Murky: a fifth of the way to green-brown, then nearly half.
  summer2: { base: "#487b99", patches: ["#437392", "#52849f"], ripple: "#9dbccb", rippleAlpha: 0.55 },
  summer3: { base: "#53767d", patches: ["#4c6d73", "#5c8086"], ripple: "#a3b5a8", rippleAlpha: 0.4 },
};

function waterTile(c: CanvasRenderingContext2D, v: FloorVariant): void {
  if (v === "winter3") {
    iceTile(c);
    return;
  }
  const s = WATER_SEASONS[v] ?? WATER;
  const rand = rng(53);
  c.fillStyle = s.base;
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 24, s.patches, 14, 28, 0.6);
  c.strokeStyle = s.ripple;
  c.lineCap = "round";
  c.lineWidth = 2;
  c.globalAlpha = s.rippleAlpha;
  for (let i = 0; i < 26; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = 6 + rand() * 10;
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      c.arc(px, py, r, Math.PI * 1.15, Math.PI * 1.85);
      c.stroke();
    });
  }
  c.globalAlpha = 1;
  if (!v) return;
  const more = rng(hashString(v));
  if (v === "winter1") speckles(c, more, 40, ["#e3edf4", "#f1f6fa"], 0.8, 2, 0.55);
  if (v === "winter2") floes(c, more, 13);
  if (v === "summer3") speckles(c, more, 18, ["#6d7a45", "#7a8550"], 3, 9, 0.45);
}

/** Frozen solid: pale ice with its grain, thin cracks and a dusting of snow. */
function iceTile(c: CanvasRenderingContext2D): void {
  const rand = rng(59);
  c.fillStyle = "#c9dbe8";
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 22, ["#c1d4e3", "#d1e0eb"], 14, 30, 0.6);
  c.strokeStyle = "rgba(245, 249, 252, 0.55)";
  c.lineWidth = 1.2;
  c.lineCap = "round";
  for (let i = 0; i < 18; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const len = 14 + rand() * 22;
    const a = -0.5 + (rand() - 0.5) * 0.4;
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      c.stroke();
    });
  }
  cracks(c, rand, 7, "#7f9db3", "rgba(248, 251, 253, 0.8)");
  speckles(c, rand, 10, ["#eef3f8"], 8, 18, 0.65);
}

function lavaTile(c: CanvasRenderingContext2D): void {
  const rand = rng(67);
  c.fillStyle = "#e0621f";
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 30, ["#f08a2c", "#ffb347"], 6, 16, 0.8);
  // Dark crust floating on it.
  c.fillStyle = "#5e210d";
  for (let i = 0; i < 14; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = 6 + rand() * 14;
    const pts = Array.from({ length: 7 }, (_, k) => {
      const a = (k / 7) * Math.PI * 2;
      const rr = r * (0.6 + rand() * 0.5);
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    });
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      pts.forEach(([dx, dy], k) => (k ? c.lineTo(px + dx, py + dy) : c.moveTo(px + dx, py + dy)));
      c.closePath();
      c.fill();
    });
  }
  speckles(c, rand, 60, ["#ffd36b"], 0.8, 2, 0.9);
}

// ---------------------------------------------------------------- seasonal touches

/** Hoar frost: a haze of tiny white crystals. */
function frost(c: CanvasRenderingContext2D, rand: () => number): void {
  speckles(c, rand, 18, ["#e8eef4"], 6, 14, 0.12);
  speckles(c, rand, 420, ["#f4f8fb", "#e1eaf2"], 0.5, 1.3, 0.6);
}

/** Drifts of snow: a few overlapping discs round each of `n` centres, shaded below and right. */
function snowPatches(c: CanvasRenderingContext2D, rand: () => number, n: number, rMin: number, rMax: number): void {
  const discs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const k = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < k; j++) {
      discs.push([x + (rand() - 0.5) * rMax * 1.6, y + (rand() - 0.5) * rMax * 1.2, rMin + rand() * (rMax - rMin)]);
    }
  }
  const layers: [string, number, number][] = [
    [SNOW_SHADE, 1.6, 1.2],
    [SNOW, 0, 0],
  ];
  for (const [color, grow, off] of layers) {
    c.fillStyle = color;
    c.beginPath();
    for (const [x, y, r] of discs) wrapped(c, x + off, y + off, (px, py) => disc(c, px, py, r + grow), 80);
    c.fill();
  }
}

/** Deep snow on grass: all white but for the shading of the drifts and a few tufts. */
function deepSnow(c: CanvasRenderingContext2D, rand: () => number): void {
  c.fillStyle = "#eef2f7";
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 16, ["#e1e8f0", "#e6ecf3"], 14, 30, 0.6);
  speckles(c, rand, 12, ["#f9fbfd"], 10, 22, 0.6);
  speckles(c, rand, 8, ["#7c8760", "#8d976c"], 1.5, 4, 0.9);
  tufts(c, rand, 10, ["#6f7a52", "#8d976c"]);
  speckles(c, rand, 70, ["#ffffff"], 0.5, 1.1, 0.9);
}

/**
 * A sheet of snow with the ground showing through in hollows, drawn onto a see-through
 * canvas of its own (the hollows are cut out of it): `hollows` clusters of a few discs
 * run together, so they're not round.
 */
function snowSheet(c: CanvasRenderingContext2D, rand: () => number, hollows: number, rMin: number, rMax: number): void {
  c.fillStyle = "#eef2f7";
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 14, ["#e3e9f0", "#e8edf3"], 14, 28, 0.6);
  speckles(c, rand, 50, ["#ffffff"], 0.5, 1.1, 0.9);
  const holes: [number, number, number][] = [];
  for (let i = 0; i < hollows; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) holes.push([x + (rand() - 0.5) * rMax * 1.8, y + (rand() - 0.5) * rMax * 1.2, rMin + rand() * (rMax - rMin)]);
  }
  // The hollow's far side is in shade (the light comes from the top left).
  c.fillStyle = SNOW_SHADE;
  c.beginPath();
  for (const [x, y, r] of holes) wrapped(c, x, y, (px, py) => disc(c, px, py, r + 1.8), 80);
  c.fill();
  c.globalCompositeOperation = "destination-out";
  c.beginPath();
  for (const [x, y, r] of holes) wrapped(c, x + 0.8, y + 1, (px, py) => disc(c, px, py, r), 80);
  c.fill();
  c.globalCompositeOperation = "source-over";
}

/** Snow over outdoor paving, about 85% of it. */
function snowBlanket(c: CanvasRenderingContext2D): void {
  snowSheet(c, rng(303), 15, 4, 9);
}

/** Little clumps of grass blades. */
function tufts(c: CanvasRenderingContext2D, rand: () => number, n: number, colors: string[]): void {
  c.lineCap = "round";
  c.lineWidth = 1.4;
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    c.strokeStyle = colors[Math.floor(rand() * colors.length)];
    const blades = [0, 1, 2, 3].map(() => [(rand() - 0.5) * 6, 4 + rand() * 5]);
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      for (const [lean, len] of blades) {
        c.moveTo(px, py);
        c.lineTo(px + lean, py - len);
      }
      c.stroke();
    });
  }
}

function flowers(c: CanvasRenderingContext2D, rand: () => number, n: number): void {
  const colors = ["#fbfbf3", "#f5d84c", "#f2a7c3", "#aabff3", "#fbfbf3"];
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = 1.5 + rand() * 1.1;
    const color = colors[Math.floor(rand() * colors.length)];
    const turn = rand() * Math.PI;
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = turn + (k / 5) * Math.PI * 2;
        disc(c, px + Math.cos(a) * r, py + Math.sin(a) * r, r * 0.75);
      }
      c.fillStyle = color;
      c.fill();
      c.beginPath();
      disc(c, px, py, r * 0.5);
      c.fillStyle = "#e9b52a";
      c.fill();
    });
  }
}

/** Branching cracks: in ice, and in earth baked dry. */
function cracks(c: CanvasRenderingContext2D, rand: () => number, n: number, dark: string, light: string): void {
  c.lineCap = "round";
  c.lineJoin = "round";
  for (let i = 0; i < n; i++) {
    const lines: number[][] = [];
    const walk = (x: number, y: number, a: number, steps: number) => {
      const pts = [x, y];
      for (let s = 0; s < steps; s++) {
        a += (rand() - 0.5) * 1.1;
        const len = 6 + rand() * 10;
        x += Math.cos(a) * len;
        y += Math.sin(a) * len;
        pts.push(x, y);
        if (steps > 2 && rand() < 0.3) walk(x, y, a + (rand() < 0.5 ? -1 : 1) * (0.7 + rand() * 0.5), 2);
      }
      lines.push(pts);
    };
    const x0 = rand() * TILE;
    const y0 = rand() * TILE;
    walk(x0, y0, rand() * Math.PI * 2, 3 + Math.floor(rand() * 4));
    wrapped(
      c,
      x0,
      y0,
      (px, py) => {
        const dx = px - x0;
        const dy = py - y0;
        // A light edge beside each crack, then the crack.
        for (const [color, width, off] of [
          [light, 0.9, 0.9],
          [dark, 1.3, 0],
        ] as const) {
          c.strokeStyle = color;
          c.lineWidth = width;
          c.beginPath();
          for (const pts of lines) {
            c.moveTo(pts[0] + dx + off, pts[1] + dy + off);
            for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k] + dx + off, pts[k + 1] + dy + off);
          }
          c.stroke();
        }
      },
      TILE,
    );
  }
}

function puddles(c: CanvasRenderingContext2D, rand: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    // Two or three flat ovals run together, so no two puddles are the same shape.
    const parts = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => {
      const rx = 10 + rand() * 9;
      return [(rand() - 0.5) * 22, (rand() - 0.5) * 10, rx, rx * (0.45 + rand() * 0.2)];
    });
    const shape = (px: number, py: number, grow: number) => {
      c.beginPath();
      for (const [dx, dy, rx, ry] of parts) {
        c.moveTo(px + dx + rx + grow, py + dy);
        c.ellipse(px + dx, py + dy, rx + grow, ry + grow, 0, 0, Math.PI * 2);
      }
    };
    wrapped(c, x, y, (px, py) => {
      // Wet earth round the edge, the water, and the sky caught in it.
      shape(px, py, 3);
      c.fillStyle = "rgba(66, 48, 30, 0.35)";
      c.fill();
      shape(px, py, 0);
      c.fillStyle = "#7f929c";
      c.fill();
      c.beginPath();
      for (const [dx, dy, rx, ry] of parts) {
        c.moveTo(px + dx - rx * 0.5, py + dy - ry * 0.25);
        c.lineTo(px + dx + rx * 0.2, py + dy - ry * 0.25);
      }
      c.strokeStyle = "rgba(214, 228, 236, 0.8)";
      c.lineWidth = 1.2;
      c.stroke();
    });
  }
}

/** Ice floes on cold water. */
function floes(c: CanvasRenderingContext2D, rand: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = 9 + rand() * 13;
    const pts = Array.from({ length: 7 }, (_, k) => {
      const a = (k / 7) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const rr = r * (0.65 + rand() * 0.45);
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    });
    const shape = (px: number, py: number, k: number) => {
      c.beginPath();
      pts.forEach(([dx, dy], j) => (j ? c.lineTo(px + dx * k, py + dy * k) : c.moveTo(px + dx * k, py + dy * k)));
      c.closePath();
    };
    wrapped(c, x, y, (px, py) => {
      shape(px, py, 1);
      c.fillStyle = "#dce8f1";
      c.fill();
      c.strokeStyle = "#9fb9cd";
      c.lineWidth = 1.4;
      c.stroke();
      shape(px - 1.5, py - 1.5, 0.7);
      c.fillStyle = "rgba(250, 252, 254, 0.8)";
      c.fill();
    });
  }
}

/** Fallen leaves' colours, and how many of each: red is never more than about a sixth, some still green. */
const LEAF_COLORS = ["#e2b33b", "#edc756", "#dc842c", "#c86f24", "#b9432b", "#9a5a2a", "#6e9643"];
const LEAF_SHARES = [0.17, 0.13, 0.16, 0.12, 0.16, 0.15, 0.11];

function leaves(c: CanvasRenderingContext2D, rand: () => number, n: number): void {
  c.lineWidth = 0.7;
  c.strokeStyle = "rgba(70, 38, 14, 0.45)";
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const a = rand() * Math.PI * 2;
    const len = 7 + rand() * 4;
    let pick = rand();
    let color = LEAF_COLORS[0];
    for (let k = 0; k < LEAF_COLORS.length; k++) {
      pick -= LEAF_SHARES[k];
      color = LEAF_COLORS[k];
      if (pick < 0) break;
    }
    const hx = (Math.cos(a) * len) / 2;
    const hy = (Math.sin(a) * len) / 2;
    wrapped(c, x, y, (px, py) => {
      // A leaf: two curves from tip to tip, bulging either side.
      c.beginPath();
      c.moveTo(px - hx, py - hy);
      c.quadraticCurveTo(px - hy * 0.9, py + hx * 0.9, px + hx, py + hy);
      c.quadraticCurveTo(px + hy * 0.9, py - hx * 0.9, px - hx, py - hy);
      c.fillStyle = color;
      c.fill();
      c.stroke();
    });
  }
}

const OVERLAYS: Record<OverlayId, (c: CanvasRenderingContext2D) => void> = {
  frost: (c) => frost(c, rng(301)),
  // About a third of the ground under snow.
  snow1: (c) => snowPatches(c, rng(302), 12, 8, 16),
  snow2: snowBlanket,
  // Leaves per tile (2 x 2 squares), and three times as many within a square of a tree or bush.
  leaves1: (c) => leaves(c, rng(311), 6),
  leaves2: (c) => leaves(c, rng(312), 14),
  leaves3: (c) => leaves(c, rng(313), 30),
  leavesNear1: (c) => leaves(c, rng(314), 18),
  leavesNear2: (c) => leaves(c, rng(315), 42),
  leavesNear3: (c) => leaves(c, rng(316), 90),
  dust: (c) => {
    const rand = rng(321);
    speckles(c, rand, 16, ["#dccba2", "#d2bf92"], 10, 24, 0.3);
    speckles(c, rand, 180, ["#cdb88c", "#e3d6b4"], 0.6, 1.5, 0.55);
  },
  sprouts2: (c) => tufts(c, rng(331), 10, ["#5e9a3a", "#7fb853", "#6aa843"]),
  sprouts3: (c) => {
    const rand = rng(332);
    tufts(c, rand, 26, ["#5e9a3a", "#7fb853", "#6aa843"]);
    flowers(c, rand, 8);
  },
};

function overlayLook(id: OverlayId): SeasonLook {
  if (id === "frost" || id.startsWith("snow")) return "winter";
  if (id.startsWith("leaves")) return "autumn";
  return id === "dust" ? "summer" : "spring";
}

const TILES: Record<FloorId, (c: CanvasRenderingContext2D, v: FloorVariant) => void> = {
  s: stoneTile,
  w: woodTile,
  d: dirtTile,
  g: grassTile,
  a: waterTile,
  l: lavaTile,
};

/**
 * The texture a floor gets outdoors in a season, or "" where that season leaves it as it
 * is: grass in every look; water frozen or cold in winter and murky in a dry summer;
 * earth wet in spring and dry in a dry summer. Stone, wood and lava never change (snow
 * and leaves go over them as overlays).
 */
export function floorVariant(floor: FloorId, look: SeasonLook, level: SeasonLevel): FloorVariant {
  const v: FloorVariant = `${look}${level}`;
  if (floor === "g") return v;
  if (floor === "a") return look === "winter" || (look === "summer" && level > 1) ? v : "";
  if (floor === "d") return look === "spring" || (look === "summer" && level > 1) ? v : "";
  return "";
}

/**
 * Texture tiles, made when first needed: `${floor}:` for the plain ones, `${floor}:${variant}`
 * and `~${overlay}` for a season's. Only one look's are kept (each is 147 KB).
 */
const tileCanvases = new Map<string, HTMLCanvasElement>();
let tileLook = "";
/** Goes up when a look's tiles are dropped, so patterns made from them are dropped too. */
let tileGen = 0;
const patterns = new WeakMap<CanvasRenderingContext2D, { gen: number; byKey: Map<string, CanvasPattern | null> }>();

function isPlainKey(key: string): boolean {
  return key.endsWith(":");
}

function tileCanvas(key: string, look: string, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let canvas = tileCanvases.get(key);
  if (!canvas) {
    if (look && look !== tileLook) {
      for (const k of [...tileCanvases.keys()]) if (!isPlainKey(k)) tileCanvases.delete(k);
      tileLook = look;
      tileGen++;
    }
    canvas = document.createElement("canvas");
    canvas.width = TILE;
    canvas.height = TILE;
    draw(canvas.getContext("2d")!);
    tileCanvases.set(key, canvas);
  }
  return canvas;
}

function tilePattern(c: CanvasRenderingContext2D, key: string, look: string, draw: (c: CanvasRenderingContext2D) => void): CanvasPattern | null {
  let entry = patterns.get(c);
  if (!entry) {
    entry = { gen: tileGen, byKey: new Map() };
    patterns.set(c, entry);
  }
  let p = entry.byKey.get(key);
  if (p === undefined) {
    const tile = tileCanvas(key, look, draw);
    if (entry.gen !== tileGen) {
      for (const k of [...entry.byKey.keys()]) if (!isPlainKey(k)) entry.byKey.delete(k);
      entry.gen = tileGen;
    }
    p = c.createPattern(tile, "repeat");
    entry.byKey.set(key, p);
  }
  return p;
}

/**
 * The repeating texture for a floor, for this canvas, laid out so one texture cell
 * matches one grid cell: `cell` map pixels wide, starting at the grid's offset.
 * `variant` is its seasonal texture (see floorVariant).
 */
export function floorPattern(
  c: CanvasRenderingContext2D,
  floor: FloorId,
  cell: number,
  offX: number,
  offY: number,
  variant: FloorVariant = "",
): CanvasPattern | string {
  const look = variant ? variant.slice(0, -1) : "";
  const p = tilePattern(c, `${floor}:${variant}`, look, (t) => TILES[floor](t, variant));
  if (!p) return FLOOR_COLORS[floor];
  const k = cell / TEXTURE_CELL_PX;
  p.setTransform(new DOMMatrix([k, 0, 0, k, offX, offY]));
  return p;
}

/** A seasonal overlay, laid out like floorPattern's textures. Null if the canvas can't make one. */
export function overlayPattern(c: CanvasRenderingContext2D, id: OverlayId, cell: number, offX: number, offY: number): CanvasPattern | null {
  const p = tilePattern(c, `~${id}`, overlayLook(id), OVERLAYS[id]);
  if (!p) return null;
  const k = cell / TEXTURE_CELL_PX;
  p.setTransform(new DOMMatrix([k, 0, 0, k, offX, offY]));
  return p;
}

const FLOOR_COLORS: Record<FloorId, string> = {
  s: "#cbc4b5",
  w: "#a8723d",
  d: "#977650",
  g: "#6e9a45",
  a: "#3f7fb0",
  l: "#e0621f",
};

// ---------------------------------------------------------------- objects

function outline(c: CanvasRenderingContext2D, width = 0.03): void {
  c.lineWidth = width;
  c.strokeStyle = INK;
  c.stroke();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

function blob(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, points = 9, rough = 0.18): void {
  c.beginPath();
  blobPath(c, x, y, r, seed, points, rough);
}

/** A blob added to the current path (several make one path, filled at once). */
function blobPath(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, points = 9, rough = 0.18): void {
  const rand = rng(seed);
  for (let k = 0; k < points; k++) {
    const a = (k / points) * Math.PI * 2;
    const rr = r * (1 - rough / 2 + rand() * rough);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (k) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
}

/** A soft shadow under an object (fainter under something you can see through). */
function shadow(c: CanvasRenderingContext2D, draw: () => void, alpha = 0.28): void {
  c.save();
  c.translate(0.035, 0.045);
  c.beginPath();
  draw();
  c.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  c.fill();
  c.restore();
}

const WOOD = "#8f5b2c";
const WOOD_LIGHT = "#b07a45";
const STONE = "#b9b2a4";
const METAL = "#c9a227";
const LEAF = "#3f7a36";

/** A tree's leafy clumps: x, y, radius. */
const TREE_CLUMPS: [number, number, number][] = [
  [-0.16, -0.14, 0.17],
  [0.15, -0.12, 0.16],
  [0.12, 0.16, 0.17],
  [-0.15, 0.14, 0.15],
  [0, 0, 0.14],
];
/** A bush's: x, y, radius, and the seed of its shape. */
const BUSH_CLUMPS: [number, number, number, number][] = [
  [-0.1, -0.06, 0.12, 31],
  [0.1, 0.02, 0.11, 32],
  [-0.02, 0.12, 0.1, 33],
];
const RUBBLE_BITS: [number, number, number][] = [
  [-0.24, -0.2, 0.12],
  [0.18, -0.24, 0.09],
  [0.02, -0.02, 0.14],
  [-0.2, 0.2, 0.1],
  [0.24, 0.16, 0.12],
  [0.3, -0.02, 0.06],
  [-0.34, 0.02, 0.06],
  [0.04, 0.3, 0.07],
];

interface TreePalette {
  canopy: string;
  /** The clumps' two colours, alternating. */
  clumps: [string, string];
  /** The line round each clump. */
  edge: string;
}

const GREEN_EDGE = "rgba(20, 50, 18, 0.6)";
const FROSTY_EDGE = "rgba(28, 48, 44, 0.6)";
const TREE_PALETTES = {
  plain: { canopy: LEAF, clumps: ["#579a47", "#4d8c3f"], edge: GREEN_EDGE },
  spring: { canopy: "#4c8f37", clumps: ["#6cae4c", "#5fa043"], edge: GREEN_EDGE },
  cherry: { canopy: "#d890ae", clumps: ["#f0b3ca", "#e7a0bc"], edge: "rgba(110, 40, 70, 0.5)" },
  summer1: { canopy: "#2f6a2b", clumps: ["#428438", "#397a32"], edge: GREEN_EDGE },
  summer2: { canopy: "#5c6a2d", clumps: ["#7a8741", "#6e7b38"], edge: "rgba(40, 48, 16, 0.6)" },
  summer3: { canopy: "#77702f", clumps: ["#9d9148", "#8c823d"], edge: "rgba(60, 50, 18, 0.6)" },
  winter1: { canopy: "#56705f", clumps: ["#7a9685", "#6d8a78"], edge: FROSTY_EDGE },
  winter2: { canopy: "#4c6555", clumps: ["#6b8674", "#5f7a69"], edge: FROSTY_EDGE },
} satisfies Record<string, TreePalette>;

function leafyTree(c: CanvasRenderingContext2D, p: TreePalette): void {
  shadow(c, () => blob(c, 0, 0, 0.46, 5, 12, 0.14));
  blob(c, 0, 0, 0.46, 5, 12, 0.14);
  c.fillStyle = p.canopy;
  c.fill();
  outline(c);
  TREE_CLUMPS.forEach(([x, y, r], i) => {
    blob(c, x, y, r, 20 + i, 8, 0.2);
    c.fillStyle = p.clumps[i % 2];
    c.fill();
    c.strokeStyle = p.edge;
    c.lineWidth = 0.015;
    c.stroke();
  });
}

function leafyBush(c: CanvasRenderingContext2D, base: string, clumps: string[]): void {
  shadow(c, () => blob(c, 0, 0, 0.32, 9, 10, 0.2));
  blob(c, 0, 0, 0.32, 9, 10, 0.2);
  c.fillStyle = base;
  c.fill();
  outline(c);
  BUSH_CLUMPS.forEach(([x, y, r, s], i) => {
    blob(c, x, y, r, s, 7, 0.25);
    c.fillStyle = clumps[i % clumps.length];
    c.fill();
  });
}

const STAMPS: Record<StampId, (c: CanvasRenderingContext2D) => void> = {
  table(c) {
    shadow(c, () => roundRect(c, -0.42, -0.3, 0.84, 0.6, 0.06));
    roundRect(c, -0.42, -0.3, 0.84, 0.6, 0.06);
    c.fillStyle = WOOD_LIGHT;
    c.fill();
    outline(c);
    c.strokeStyle = "rgba(60, 35, 15, 0.45)";
    c.lineWidth = 0.015;
    c.beginPath();
    for (const y of [-0.1, 0.1]) {
      c.moveTo(-0.4, y);
      c.lineTo(0.4, y);
    }
    c.stroke();
  },
  chair(c) {
    shadow(c, () => roundRect(c, -0.24, -0.2, 0.48, 0.46, 0.05));
    roundRect(c, -0.24, -0.2, 0.48, 0.46, 0.05);
    c.fillStyle = WOOD_LIGHT;
    c.fill();
    outline(c);
    roundRect(c, -0.28, -0.34, 0.56, 0.14, 0.04);
    c.fillStyle = WOOD;
    c.fill();
    outline(c);
  },
  bed(c) {
    shadow(c, () => roundRect(c, -0.32, -0.44, 0.64, 0.88, 0.05));
    roundRect(c, -0.32, -0.44, 0.64, 0.88, 0.05);
    c.fillStyle = WOOD;
    c.fill();
    outline(c);
    roundRect(c, -0.27, -0.16, 0.54, 0.54, 0.04);
    c.fillStyle = "#6f86b8";
    c.fill();
    outline(c, 0.02);
    c.beginPath();
    c.moveTo(-0.27, -0.06);
    c.lineTo(0.27, -0.06);
    c.strokeStyle = "#dfe5f2";
    c.lineWidth = 0.035;
    c.stroke();
    roundRect(c, -0.2, -0.38, 0.4, 0.17, 0.06);
    c.fillStyle = "#efe9dc";
    c.fill();
    outline(c, 0.02);
  },
  chest(c) {
    shadow(c, () => roundRect(c, -0.38, -0.26, 0.76, 0.52, 0.05));
    roundRect(c, -0.38, -0.26, 0.76, 0.52, 0.05);
    c.fillStyle = WOOD;
    c.fill();
    outline(c);
    c.fillStyle = METAL;
    for (const x of [-0.26, 0.2]) {
      c.fillRect(x, -0.26, 0.06, 0.52);
    }
    c.beginPath();
    c.moveTo(-0.38, -0.02);
    c.lineTo(0.38, -0.02);
    c.strokeStyle = INK;
    c.lineWidth = 0.02;
    c.stroke();
    roundRect(c, -0.06, 0.02, 0.12, 0.12, 0.02);
    c.fillStyle = METAL;
    c.fill();
    outline(c, 0.015);
  },
  barrel(c) {
    shadow(c, () => circle(c, 0, 0, 0.38));
    circle(c, 0, 0, 0.38);
    c.fillStyle = WOOD_LIGHT;
    c.fill();
    outline(c);
    c.strokeStyle = "#4a4a4a";
    c.lineWidth = 0.035;
    circle(c, 0, 0, 0.31);
    c.stroke();
    c.strokeStyle = "rgba(60, 35, 15, 0.5)";
    c.lineWidth = 0.015;
    c.beginPath();
    for (const x of [-0.15, 0, 0.15]) {
      const h = Math.sqrt(0.29 * 0.29 - x * x);
      c.moveTo(x, -h);
      c.lineTo(x, h);
    }
    c.stroke();
  },
  crate(c) {
    shadow(c, () => c.rect(-0.38, -0.38, 0.76, 0.76));
    c.beginPath();
    c.rect(-0.38, -0.38, 0.76, 0.76);
    c.fillStyle = "#b8894f";
    c.fill();
    outline(c);
    c.beginPath();
    c.rect(-0.3, -0.3, 0.6, 0.6);
    c.strokeStyle = "#7a5530";
    c.lineWidth = 0.03;
    c.stroke();
    c.beginPath();
    c.moveTo(-0.3, -0.3);
    c.lineTo(0.3, 0.3);
    c.moveTo(0.3, -0.3);
    c.lineTo(-0.3, 0.3);
    c.stroke();
  },
  shelf(c) {
    shadow(c, () => c.rect(-0.46, -0.44, 0.92, 0.3));
    c.beginPath();
    c.rect(-0.46, -0.44, 0.92, 0.3);
    c.fillStyle = "#6b4423";
    c.fill();
    outline(c);
    const colors = ["#8c2f2f", "#2f5d8c", "#3e7a3a", "#a07a2a", "#6a3d8a"];
    let x = -0.42;
    let i = 0;
    while (x < 0.4) {
      const w = 0.045 + ((i * 37) % 5) * 0.012;
      c.fillStyle = colors[i % colors.length];
      c.fillRect(x, -0.4, Math.min(w, 0.42 - x), 0.22);
      x += w + 0.01;
      i++;
    }
  },
  stairs(c) {
    c.beginPath();
    c.rect(-0.44, -0.46, 0.88, 0.92);
    c.fillStyle = STONE;
    c.fill();
    const steps = 7;
    for (let i = 0; i < steps; i++) {
      // Darker as the steps go down (towards the top).
      c.fillStyle = `rgba(0, 0, 0, ${0.04 + (0.42 * (steps - 1 - i)) / steps})`;
      c.fillRect(-0.44, -0.46 + (i * 0.92) / steps, 0.88, 0.92 / steps);
    }
    c.strokeStyle = INK;
    c.lineWidth = 0.02;
    c.beginPath();
    for (let i = 1; i < steps; i++) {
      const y = -0.46 + (i * 0.92) / steps;
      c.moveTo(-0.44, y);
      c.lineTo(0.44, y);
    }
    c.stroke();
    c.beginPath();
    c.rect(-0.44, -0.46, 0.88, 0.92);
    outline(c);
  },
  pillar(c) {
    shadow(c, () => circle(c, 0, 0, 0.36));
    circle(c, 0, 0, 0.36);
    c.fillStyle = STONE;
    c.fill();
    outline(c);
    circle(c, 0, 0, 0.26);
    c.strokeStyle = "#8f887b";
    c.lineWidth = 0.025;
    c.stroke();
    circle(c, -0.08, -0.08, 0.1);
    c.fillStyle = "rgba(255, 255, 255, 0.35)";
    c.fill();
  },
  statue(c) {
    shadow(c, () => c.rect(-0.4, -0.4, 0.8, 0.8));
    c.beginPath();
    c.rect(-0.4, -0.4, 0.8, 0.8);
    c.fillStyle = "#9d978b";
    c.fill();
    outline(c);
    c.beginPath();
    c.ellipse(0, 0.04, 0.28, 0.16, 0, 0, Math.PI * 2);
    c.fillStyle = "#d3cec4";
    c.fill();
    outline(c, 0.02);
    circle(c, 0, -0.02, 0.12);
    c.fillStyle = "#e3dfd7";
    c.fill();
    outline(c, 0.02);
  },
  well(c) {
    shadow(c, () => circle(c, 0, 0, 0.44));
    circle(c, 0, 0, 0.44);
    c.fillStyle = "#8f8779";
    c.fill();
    outline(c);
    circle(c, 0, 0, 0.29);
    c.fillStyle = "#1f3b52";
    c.fill();
    outline(c, 0.02);
    c.strokeStyle = INK;
    c.lineWidth = 0.015;
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      c.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3);
      c.lineTo(Math.cos(a) * 0.43, Math.sin(a) * 0.43);
    }
    c.stroke();
    wellBeam(c);
  },
  tree(c) {
    leafyTree(c, TREE_PALETTES.plain);
  },
  bush(c) {
    leafyBush(c, "#4f8a3c", ["#5fa048"]);
  },
  rock(c) {
    shadow(c, () => blob(c, 0, 0, 0.36, 44, 7, 0.35));
    blob(c, 0, 0, 0.36, 44, 7, 0.35);
    c.fillStyle = "#8d8a84";
    c.fill();
    outline(c);
    blob(c, -0.07, -0.08, 0.17, 45, 5, 0.3);
    c.fillStyle = "#a9a69f";
    c.fill();
  },
  campfire(c) {
    const stones = 8;
    for (let k = 0; k < stones; k++) {
      const a = (k / stones) * Math.PI * 2;
      blob(c, Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0.085, 60 + k, 6, 0.3);
      c.fillStyle = "#8d8a84";
      c.fill();
      outline(c, 0.02);
    }
    c.lineCap = "round";
    c.strokeStyle = "#5b3a1c";
    c.lineWidth = 0.08;
    c.beginPath();
    c.moveTo(-0.2, -0.14);
    c.lineTo(0.2, 0.14);
    c.moveTo(0.2, -0.14);
    c.lineTo(-0.2, 0.14);
    c.stroke();
    blob(c, 0, 0, 0.16, 70, 8, 0.4);
    c.fillStyle = "#f08a2c";
    c.fill();
    blob(c, 0, 0, 0.08, 71, 7, 0.4);
    c.fillStyle = "#ffd36b";
    c.fill();
    c.lineCap = "butt";
  },
  rubble(c) {
    RUBBLE_BITS.forEach(([x, y, r], i) => {
      blob(c, x, y, r, 80 + i, 5, 0.4);
      c.fillStyle = i % 2 ? "#8d8a84" : "#a19d95";
      c.fill();
      outline(c, 0.02);
    });
  },
};

function wellBeam(c: CanvasRenderingContext2D): void {
  roundRect(c, -0.46, -0.04, 0.92, 0.08, 0.02);
  c.fillStyle = WOOD;
  c.fill();
  outline(c, 0.02);
}

// ---------------------------------------------------------------- seasonal objects

/** How one outdoor object looks in a season (build.ts works it out for each object). */
export interface StampLook {
  look: SeasonLook;
  level: SeasonLevel;
  /** 0 to 1, from where the object is and the scene's seed: which variety of the look this one is. */
  hash: number;
  /** The ground round it in winter: 0 bare, 1 frost, 2 patchy snow, 3 deep snow. */
  cover: 0 | 1 | 2 | 3;
}

/** Whether an object looks different in a season (only these need a StampLook). */
export function hasSeasonalArt(id: StampId, look: SeasonLook): boolean {
  if (id === "tree" || id === "bush") return true;
  return look === "winter" && (id === "rock" || id === "rubble" || id === "well" || id === "campfire");
}

/** A number from 0 to 1 for an object's place and the scene's seed, the same on every screen. */
export function stampHash(col: number, row: number, seed: number): number {
  let h = Math.imul(col | 0, 0x27d4eb2d) ^ Math.imul(row | 0, 0x165667b1) ^ Math.imul((seed | 0) + 0x3c6ef372, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A direction on the map, as seen from inside an object turned `turns` quarter turns
 * clockwise (objects are drawn inside c.rotate(turns * PI / 2)). Snow lies on the side the
 * light comes from, the map's top left, whichever way the object is turned; drawn without
 * this, every turned tree would have its snow on a different side.
 */
export function mapToStamp(dx: number, dy: number, turns: number): [number, number] {
  switch (((turns % 4) + 4) % 4) {
    case 1:
      return [dy, -dx];
    case 2:
      return [-dx, -dy];
    case 3:
      return [-dy, dx];
    default:
      return [dx, dy];
  }
}

/** The way to the light (the map's top left), one unit long, inside an object. */
function litSide(turns: number): [number, number] {
  return mapToStamp(-Math.SQRT1_2, -Math.SQRT1_2, turns);
}

function seedOf(s: StampLook): number {
  return Math.floor(s.hash * 4294967296);
}

/** Snow on top of each clump: a cap towards the light over a shaded rim. */
function snowCaps(
  c: CanvasRenderingContext2D,
  clumps: readonly (readonly number[])[],
  seed: (i: number) => number,
  [lx, ly]: [number, number],
): void {
  // Each the shape of its clump, smaller, so the snow looks lumpy rather than like snowballs.
  c.beginPath();
  clumps.forEach(([x, y, r], i) => blobPath(c, x + lx * r * 0.22, y + ly * r * 0.22, r * 0.74, seed(i), 8, 0.3));
  c.fillStyle = SNOW_SHADE;
  c.fill();
  c.beginPath();
  clumps.forEach(([x, y, r], i) => blobPath(c, x + lx * r * 0.36, y + ly * r * 0.36, r * 0.58, seed(i) + 7, 8, 0.3));
  c.fillStyle = SNOW;
  c.fill();
}

/** A white bloom of frost on each clump's lit side. */
function frostOn(c: CanvasRenderingContext2D, clumps: readonly (readonly number[])[], [lx, ly]: [number, number]): void {
  c.beginPath();
  for (const [x, y, r] of clumps) disc(c, x + lx * r * 0.45, y + ly * r * 0.45, r * 0.45);
  c.fillStyle = "rgba(232, 239, 246, 0.55)";
  c.fill();
}

/** A tree's bare branches seen from above, as x0, y0, x1, y1 lists: limbs from the trunk, and twigs. */
const BRANCHES = (() => {
  const rand = rng(97);
  const limbs: number[] = [];
  const twigs: number[] = [];
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const len = 0.33 + rand() * 0.1;
    const bend = (rand() - 0.5) * 0.35;
    const mx = Math.cos(a) * len * 0.55;
    const my = Math.sin(a) * len * 0.55;
    const ex = mx + Math.cos(a + bend) * len * 0.45;
    const ey = my + Math.sin(a + bend) * len * 0.45;
    limbs.push(Math.cos(a) * 0.05, Math.sin(a) * 0.05, mx, my, mx, my, ex, ey);
    for (const side of [-1, 1]) {
      const ta = a + side * (0.55 + rand() * 0.3);
      const tl = 0.09 + rand() * 0.06;
      twigs.push(mx, my, mx + Math.cos(ta) * tl, my + Math.sin(ta) * tl);
      const ea = a + bend + side * (0.4 + rand() * 0.3);
      const el = 0.06 + rand() * 0.05;
      twigs.push(ex, ey, ex + Math.cos(ea) * el, ey + Math.sin(ea) * el);
    }
  }
  return { limbs, twigs };
})();

function strokeBranches(c: CanvasRenderingContext2D, color: string, width: number, twigs = true): void {
  c.lineCap = "round";
  c.strokeStyle = color;
  for (const [list, w] of [
    [BRANCHES.limbs, 0.042],
    [twigs ? BRANCHES.twigs : [], 0.02],
  ] as const) {
    if (!list.length) continue;
    c.lineWidth = w * width;
    c.beginPath();
    for (let i = 0; i < list.length; i += 4) {
      c.moveTo(list[i], list[i + 1]);
      c.lineTo(list[i + 2], list[i + 3]);
    }
    c.stroke();
  }
}

function branches(c: CanvasRenderingContext2D, color: string, twigs = true): void {
  strokeBranches(c, color, 1, twigs);
  circle(c, 0, 0, 0.07);
  c.fillStyle = color;
  c.fill();
}

/** Winter's bare tree, snow lying along the top of each branch. */
function bareTree(c: CanvasRenderingContext2D, [lx, ly]: [number, number]): void {
  shadow(c, () => circle(c, 0, 0, 0.36), 0.12);
  // Dark edges, so the limbs stand out against the snow, and snow along their tops
  // (the twigs are too thin for either to show).
  strokeBranches(c, "#2e2119", 1.45, false);
  branches(c, "#5a4030");
  c.save();
  c.translate(lx * 0.013, ly * 0.013);
  strokeBranches(c, SNOW, 0.5, false);
  c.restore();
}

function starPoints(n: number, outer: number, inner: number, seed: number): number[] {
  const rand = rng(seed);
  const pts: number[] = [];
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2;
    const r = (k % 2 ? inner : outer) * (0.92 + rand() * 0.16);
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
}

/** An evergreen from above: three tiers of spiky boughs, darkest at the bottom. */
const PINE_TIERS = [starPoints(14, 0.47, 0.37, 98), starPoints(11, 0.34, 0.26, 99), starPoints(8, 0.2, 0.15, 100)];
const PINE_GREENS = ["#274d32", "#2f5e3e", "#3a6f48"];

function poly(c: CanvasRenderingContext2D, pts: number[], dx = 0, dy = 0, k = 1): void {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i) c.lineTo(dx + pts[i] * k, dy + pts[i + 1] * k);
    else c.moveTo(dx + pts[i] * k, dy + pts[i + 1] * k);
  }
  c.closePath();
}

/** Winter's snow-laden evergreen: green only at the tips on the side away from the light. */
function snowyPine(c: CanvasRenderingContext2D, [lx, ly]: [number, number]): void {
  shadow(c, () => poly(c, PINE_TIERS[0]));
  PINE_TIERS.forEach((pts, i) => {
    poly(c, pts);
    c.fillStyle = PINE_GREENS[i];
    c.fill();
    if (i) {
      c.strokeStyle = "rgba(16, 36, 22, 0.6)";
      c.lineWidth = 0.015;
      c.stroke();
    } else outline(c);
    // Snow lying on each tier, the tips on the shaded side still green.
    poly(c, pts, lx * 0.03, ly * 0.03, 0.8);
    c.fillStyle = SNOW_SHADE;
    c.fill();
    poly(c, pts, lx * 0.055, ly * 0.055, 0.68);
    c.fillStyle = SNOW;
    c.fill();
  });
}

/** Blossom scattered over a tree's crown. */
function blossom(c: CanvasRenderingContext2D, rand: () => number, colors: string[], n: number): void {
  for (const color of colors) {
    c.beginPath();
    for (let i = 0; i < n / colors.length; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 0.38;
      disc(c, Math.cos(a) * d, Math.sin(a) * d, 0.024 + rand() * 0.016);
    }
    c.fillStyle = color;
    c.fill();
  }
}

// Autumn trees and bushes: every one a mottled mix of red, orange, yellow and some green,
// never one colour and never mostly red, and thinner as autumn goes on, the branches
// showing through.

interface Clump {
  x: number;
  y: number;
  r: number;
  /** Its outline's points, for a radius of 1. */
  pts: number[];
}

/** Small clumps of leaves in rings round the middle: for each ring, how many, how far out, their radius and its turn. */
function clumpRings(seed: number, rings: [number, number, number, number][]): Clump[] {
  const rand = rng(seed);
  const out: Clump[] = [];
  for (const [n, d, r, turn] of rings) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + turn;
      const pts: number[] = [];
      for (let j = 0; j < 6; j++) {
        const b = (j / 6) * Math.PI * 2;
        const rr = 0.87 + rand() * 0.26;
        pts.push(Math.cos(b) * rr, Math.sin(b) * rr);
      }
      out.push({ x: Math.cos(a) * d + (rand() - 0.5) * 0.03, y: Math.sin(a) * d + (rand() - 0.5) * 0.03, r, pts });
    }
  }
  return out;
}

/** A tree's crown: one clump in the middle, a ring of 6 and a ring of 10. */
const AUTUMN_CLUMPS = clumpRings(113, [
  [1, 0, 0.128, 0],
  [6, 0.18, 0.128, 0.3],
  [10, 0.33, 0.122, 0],
]);
/** A bush's, smaller: one in the middle, a ring of 4 and a ring of 7. */
const AUTUMN_BUSH_CLUMPS = clumpRings(131, [
  [1, 0, 0.1, 0],
  [4, 0.13, 0.095, 0.4],
  [7, 0.235, 0.088, 0.1],
]);

interface Fleck {
  x: number;
  y: number;
  r: number;
  /** The clump it's on. */
  clump: number;
}

/** Flecks of another colour on the clumps, each over the clump nearest it: the fine grain of the mottle. */
function flecksOver(clumps: Clump[], seed: number, n: number, spread: number, rMin: number, rMore: number): Fleck[] {
  const rand = rng(seed);
  return Array.from({ length: n }, () => {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * spread;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    let clump = 0;
    let best = Infinity;
    clumps.forEach((cl, i) => {
      const dd = (cl.x - x) ** 2 + (cl.y - y) ** 2;
      if (dd < best) {
        best = dd;
        clump = i;
      }
    });
    return { x, y, r: rMin + rand() * rMore, clump };
  });
}

const AUTUMN_FLECKS = flecksOver(AUTUMN_CLUMPS, 127, 10, 0.38, 0.018, 0.012);
const AUTUMN_BUSH_FLECKS = flecksOver(AUTUMN_BUSH_CLUMPS, 137, 6, 0.26, 0.014, 0.01);

/** A bush's stems seen from above, as x0, y0, x1, y1 lists: from the middle, and a twig off each. */
const BUSH_STEMS = (() => {
  const rand = rng(139);
  const stems: number[] = [];
  const twigs: number[] = [];
  const n = 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const len = 0.2 + rand() * 0.07;
    stems.push(Math.cos(a) * 0.03, Math.sin(a) * 0.03, Math.cos(a) * len, Math.sin(a) * len);
    const at = len * (0.5 + rand() * 0.2);
    const ta = a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.3);
    const tl = 0.06 + rand() * 0.04;
    twigs.push(Math.cos(a) * at, Math.sin(a) * at, Math.cos(a) * at + Math.cos(ta) * tl, Math.sin(a) * at + Math.sin(ta) * tl);
  }
  return { stems, twigs };
})();

/** Green (deep enough to stand out from autumn grass), yellow, orange and red, two shades each. */
const AUTUMN_HUES = [
  ["#46742e", "#548437"],
  ["#e2b33b", "#d4a22e"],
  ["#dc842c", "#c9722a"],
  ["#bb452c", "#a73a2b"],
];
/** By level: the share of clumps still green, the share gone, their size, and the shadow they cast. */
const AUTUMN_GREEN = [0.45, 0.25, 0.12];
const AUTUMN_THIN = [0.1, 0.22, 0.35];
const AUTUMN_SIZE = [1.08, 1, 0.9];
const AUTUMN_SHADOW = [0.24, 0.19, 0.14];
/** Of the turned clumps, the share red before each tree's own lean (red overall stays under a third). */
const AUTUMN_RED = [0.12, 0.26, 0.3];

/** A clump's outline: a smooth curve round its points (through the middle of each side), so it looks soft. */
function clumpPath(c: CanvasRenderingContext2D, cl: Clump, k: number): void {
  const r = cl.r * k;
  const p = cl.pts;
  const n = p.length / 2;
  const x = (i: number) => cl.x + p[(i % n) * 2] * r;
  const y = (i: number) => cl.y + p[(i % n) * 2 + 1] * r;
  c.moveTo((x(n - 1) + x(0)) / 2, (y(n - 1) + y(0)) / 2);
  for (let i = 0; i < n; i++) c.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
  c.closePath();
}

/**
 * How the n clumps of an autumn tree (or bush) are coloured: -1 for one that has fallen,
 * else 0 green, 1 yellow, 2 orange, 3 red. Every one has some of each colour, and never
 * more than a third red.
 */
export function autumnHues(level: SeasonLevel, hash: number, n = AUTUMN_CLUMPS.length): number[] {
  const L = level - 1;
  const rand = rng(Math.floor(hash * 4294967296) ^ 0x5eed);
  const kept = Math.round(n * (1 - AUTUMN_THIN[L]));
  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rand,
  );
  // Some still green, the rest turned: red, and orange and yellow in the tree's own
  // proportions, with at least one clump of each.
  const green = Math.min(kept - 3, Math.max(1, Math.round(kept * (AUTUMN_GREEN[L] + (rand() - 0.5) * 0.1))));
  const turned = kept - green;
  const red = Math.min(Math.floor(kept / 3), turned - 2, Math.max(1, Math.round(turned * (AUTUMN_RED[L] + (rand() - 0.5) * 0.12))));
  const rest = turned - red;
  const orange = Math.min(rest - 1, Math.max(1, Math.round(rest * (0.35 + rand() * 0.3))));
  const mix = shuffle(
    [
      ...Array<number>(green).fill(0),
      ...Array<number>(rest - orange).fill(1),
      ...Array<number>(orange).fill(2),
      ...Array<number>(red).fill(3),
    ],
    rand,
  );
  const out = Array<number>(n).fill(-1);
  for (let i = 0; i < kept; i++) out[order[i]] = mix[i];
  return out;
}

/** The leaves of an autumn tree or bush: the clumps still on it, in their colours, and flecks of its other colours. */
function autumnLeaves(c: CanvasRenderingContext2D, clumps: Clump[], flecks: Fleck[], hues: number[], k: number, rand: () => number): void {
  // A dark rim under the leaves (the clumps a little bigger), so only the crown's edge
  // shows, and the edges of its gaps. (Cheaper than stroking every clump.)
  c.beginPath();
  hues.forEach((h, i) => h >= 0 && clumpPath(c, clumps[i], k * 1.13));
  c.fillStyle = "rgba(58, 32, 12, 0.75)";
  c.fill();
  // One fill per colour.
  const groups = new Map<string, number[]>();
  hues.forEach((h, i) => {
    if (h < 0) return;
    const shades = AUTUMN_HUES[h];
    const color = shades[Math.floor(rand() * shades.length)];
    const list = groups.get(color);
    if (list) list.push(i);
    else groups.set(color, [i]);
  });
  for (const [color, list] of groups) {
    c.beginPath();
    for (const i of list) clumpPath(c, clumps[i], k);
    c.fillStyle = color;
    c.fill();
  }
  // Flecks in its other colours.
  const present = hues.filter((h) => h >= 0);
  const byHue = new Map<number, number[]>();
  flecks.forEach((f, i) => {
    const under = hues[f.clump];
    if (under < 0) return;
    let h = present[Math.floor(rand() * present.length)];
    if (h === under) h = present[Math.floor(rand() * present.length)];
    if (h === under) return;
    const list = byHue.get(h);
    if (list) list.push(i);
    else byHue.set(h, [i]);
  });
  for (const [h, list] of byHue) {
    c.beginPath();
    for (const i of list) {
      const f = flecks[i];
      disc(c, f.x, f.y, f.r);
    }
    c.fillStyle = AUTUMN_HUES[h][0];
    c.fill();
  }
}

function autumnTree(c: CanvasRenderingContext2D, s: StampLook): void {
  const L = s.level - 1;
  const k = AUTUMN_SIZE[L];
  shadow(c, () => blob(c, 0, 0, 0.44 * k, 5, 12, 0.14), AUTUMN_SHADOW[L]);
  // The twigs only show through the gaps of a thinner crown.
  branches(c, "#5b3d25", s.level > 1);
  autumnLeaves(c, AUTUMN_CLUMPS, AUTUMN_FLECKS, autumnHues(s.level, s.hash), k, rng(seedOf(s)));
}

/** An autumn bush: small clumps like a tree's, fewer as autumn goes on, its stems showing through; berries on some. */
function autumnBush(c: CanvasRenderingContext2D, s: StampLook): void {
  const L = s.level - 1;
  const k = AUTUMN_SIZE[L];
  const rand = rng(seedOf(s) ^ 0xb05);
  shadow(c, () => blob(c, 0, 0, 0.32 * k, 9, 10, 0.2), AUTUMN_SHADOW[L]);
  // The stems, and from level 2 the twigs off them: seen through the gaps.
  c.lineCap = "round";
  c.strokeStyle = "#5b3d25";
  for (const [list, w] of [
    [BUSH_STEMS.stems, 0.03],
    [s.level > 1 ? BUSH_STEMS.twigs : [], 0.016],
  ] as const) {
    if (!list.length) continue;
    c.lineWidth = w;
    c.beginPath();
    for (let i = 0; i < list.length; i += 4) {
      c.moveTo(list[i], list[i + 1]);
      c.lineTo(list[i + 2], list[i + 3]);
    }
    c.stroke();
  }
  autumnLeaves(c, AUTUMN_BUSH_CLUMPS, AUTUMN_BUSH_FLECKS, autumnHues(s.level, s.hash, AUTUMN_BUSH_CLUMPS.length), k, rand);
  // Dark berries on about half of them once the leaves start to go.
  if (s.level > 1 && rand() < 0.5) dots(c, rand, s.level === 2 ? 5 : 4, 0.24, 0.02, ["#8e1c30"]);
}

// A tree's or bush's seasonal drawing depends only on its look, level and hash, and in
// winter on its turns (drawVariety keeps each variety's drawing by those).

function seasonalTree(c: CanvasRenderingContext2D, s: StampLook, turns: number): void {
  const lit = litSide(turns);
  if (s.look === "autumn") {
    autumnTree(c, s);
  } else if (s.look === "winter") {
    if (s.level === 3) {
      // Deep snow: most trees bare, some evergreens.
      if (s.hash < 0.6) bareTree(c, lit);
      else snowyPine(c, lit);
    } else {
      leafyTree(c, s.level === 1 ? TREE_PALETTES.winter1 : TREE_PALETTES.winter2);
      if (s.level === 1) frostOn(c, TREE_CLUMPS, lit);
      else snowCaps(c, TREE_CLUMPS, (i) => 20 + i, lit);
    }
  } else if (s.look === "spring") {
    // Blossom on 40% of trees, then 75%; a third of those cherry pink.
    const rand = rng(seedOf(s));
    const bloom = s.level > 1 && s.hash < (s.level === 2 ? 0.4 : 0.75);
    const cherry = bloom && rand() < 1 / 3;
    leafyTree(c, cherry ? TREE_PALETTES.cherry : TREE_PALETTES.spring);
    if (bloom) blossom(c, rand, cherry ? ["#fbe3ec", "#d8799c"] : ["#fdf3f7", "#f6c3d4"], s.level === 3 ? 24 : 14);
  } else {
    leafyTree(c, TREE_PALETTES[`summer${s.level}`]);
  }
}

function seasonalBush(c: CanvasRenderingContext2D, s: StampLook, turns: number): void {
  const lit = litSide(turns);
  const rand = rng(seedOf(s));
  if (s.look === "winter") {
    if (s.level === 3) {
      snowMound(c, lit);
      return;
    }
    leafyBush(c, s.level === 1 ? "#587562" : "#4c6555", [s.level === 1 ? "#6f8b79" : "#627d6c"]);
    if (s.level === 1) frostOn(c, BUSH_CLUMPS, lit);
    else snowCaps(c, BUSH_CLUMPS, (i) => BUSH_CLUMPS[i][3], lit);
  } else if (s.look === "autumn") {
    autumnBush(c, s);
  } else if (s.look === "spring") {
    leafyBush(c, "#579a3d", ["#72b653"]);
    if (s.level === 3 || (s.level === 2 && s.hash < 0.6)) {
      const color = ["#fbfbf3", "#f2a7c3", "#f5d84c", "#c9b3f0"][Math.floor(rand() * 4)];
      dots(c, rand, s.level === 3 ? 12 : 8, 0.26, 0.028, [color]);
    }
  } else {
    leafyBush(c, ["#2f6b2b", "#5b6a2c", "#77712f"][s.level - 1], [["#3f8036", "#72803a", "#978d44"][s.level - 1]]);
  }
}

/** Small dots scattered within `spread` of the middle: berries, flowers. */
function dots(c: CanvasRenderingContext2D, rand: () => number, n: number, spread: number, r: number, colors: string[]): void {
  for (const color of colors) {
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * spread;
      disc(c, Math.cos(a) * d, Math.sin(a) * d, r * (0.8 + rand() * 0.4));
    }
    c.fillStyle = color;
    c.fill();
  }
}

/** A bush buried in deep snow: a white mound, a little green where the snow has slid off. */
function snowMound(c: CanvasRenderingContext2D, [lx, ly]: [number, number]): void {
  shadow(c, () => blob(c, 0, 0, 0.34, 9, 10, 0.2));
  blob(c, 0, 0, 0.34, 9, 10, 0.2);
  c.fillStyle = "#e6ecf3";
  c.fill();
  c.lineWidth = 0.025;
  c.strokeStyle = "#8193a8";
  c.stroke();
  // Twigs poking out on the shaded side, and the lit crest.
  c.beginPath();
  for (const a of [-0.7, 0, 0.6]) {
    const dx = -lx * Math.cos(a) + ly * Math.sin(a);
    const dy = -ly * Math.cos(a) - lx * Math.sin(a);
    c.moveTo(dx * 0.24, dy * 0.24);
    c.lineTo(dx * 0.4, dy * 0.4);
  }
  c.lineCap = "round";
  c.strokeStyle = "#4b3627";
  c.lineWidth = 0.022;
  c.stroke();
  blob(c, lx * 0.1, ly * 0.1, 0.17, 12, 9, 0.25);
  c.fillStyle = "#fbfcfe";
  c.fill();
}

function winterRock(c: CanvasRenderingContext2D, s: StampLook, turns: number): void {
  if (s.cover < 2) {
    STAMPS.rock(c);
    if (s.cover === 1) {
      // Frost on the lit face.
      blob(c, -0.07, -0.08, 0.17, 45, 5, 0.3);
      c.fillStyle = "rgba(226, 233, 240, 0.55)";
      c.fill();
    }
    return;
  }
  // Its highlight becomes a cap of snow, always on the map's top-left side.
  const [lx, ly] = litSide(turns);
  const big = s.cover === 3;
  shadow(c, () => blob(c, 0, 0, 0.36, 44, 7, 0.35));
  blob(c, 0, 0, 0.36, 44, 7, 0.35);
  c.fillStyle = "#8d8a84";
  c.fill();
  outline(c);
  blob(c, lx * 0.08, ly * 0.08, big ? 0.27 : 0.21, 45, 10, 0.25);
  c.fillStyle = SNOW_SHADE;
  c.fill();
  blob(c, lx * 0.12, ly * 0.12, big ? 0.23 : 0.17, 45, 10, 0.25);
  c.fillStyle = SNOW;
  c.fill();
}

function winterRubble(c: CanvasRenderingContext2D, s: StampLook, turns: number): void {
  STAMPS.rubble(c);
  if (!s.cover) return;
  const [lx, ly] = litSide(turns);
  c.beginPath();
  RUBBLE_BITS.forEach(([x, y, r], i) => {
    if (s.cover !== 2 || i % 2 === 0) disc(c, x + lx * r * 0.35, y + ly * r * 0.35, r * (s.cover === 3 ? 0.72 : 0.58));
  });
  c.fillStyle = s.cover === 1 ? "rgba(236, 242, 248, 0.5)" : SNOW;
  c.fill();
}

function winterWell(c: CanvasRenderingContext2D, s: StampLook, turns: number): void {
  STAMPS.well(c);
  if (!s.cover) return;
  const [lx, ly] = litSide(turns);
  if (s.cover === 3) {
    // Frozen over, the rim white all round.
    circle(c, 0, 0, 0.29);
    c.fillStyle = "#bcd1e0";
    c.fill();
    outline(c, 0.02);
    c.beginPath();
    c.moveTo(-0.17, -0.12);
    c.lineTo(-0.05, -0.03);
    c.lineTo(0.02, 0.1);
    c.lineTo(0.15, 0.13);
    c.strokeStyle = "#7f9db3";
    c.lineWidth = 0.012;
    c.stroke();
    circle(c, 0, 0, 0.365);
    c.strokeStyle = SNOW;
    c.lineWidth = 0.12;
    c.stroke();
  } else {
    // Snow (or frost) on the lit side of the rim.
    const a = Math.atan2(ly, lx);
    c.beginPath();
    c.arc(0, 0, 0.365, a - 1.2, a + 1.2);
    c.lineCap = "round";
    c.strokeStyle = s.cover === 2 ? SNOW : "rgba(236, 242, 248, 0.5)";
    c.lineWidth = s.cover === 2 ? 0.1 : 0.06;
    c.stroke();
  }
  wellBeam(c);
  if (s.cover >= 2) {
    c.beginPath();
    c.moveTo(-0.42, ly * 0.014);
    c.lineTo(0.42, ly * 0.014);
    c.lineCap = "round";
    c.strokeStyle = SNOW;
    c.lineWidth = 0.035;
    c.stroke();
  }
}

function winterCampfire(c: CanvasRenderingContext2D, s: StampLook): void {
  if (s.cover >= 2) {
    // The snow has melted round the fire: wet bare earth.
    circle(c, 0, 0, 0.5);
    c.fillStyle = "rgba(104, 84, 62, 0.35)";
    c.fill();
    circle(c, 0, 0, 0.45);
    c.fillStyle = "rgba(84, 64, 46, 0.55)";
    c.fill();
  }
  STAMPS.campfire(c);
}

type SeasonalDrawing = (c: CanvasRenderingContext2D, s: StampLook, turns: number) => void;

const SEASONAL_STAMPS: Partial<Record<StampId, SeasonalDrawing>> = {
  tree: seasonalTree,
  bush: seasonalBush,
  rock: (c, s, turns) => (s.look === "winter" ? winterRock(c, s, turns) : STAMPS.rock(c)),
  rubble: (c, s, turns) => (s.look === "winter" ? winterRubble(c, s, turns) : STAMPS.rubble(c)),
  well: (c, s, turns) => (s.look === "winter" ? winterWell(c, s, turns) : STAMPS.well(c)),
  campfire: (c, s) => (s.look === "winter" ? winterCampfire(c, s) : STAMPS.campfire(c)),
};

// ---------------------------------------------------------------- remembered drawings

type CanvasOp = (c: CanvasRenderingContext2D) => void;

/**
 * Stands in for a canvas while a drawing is made: its paths become ready-made ones, kept
 * with what's done with them (and the colours and line widths set in between), to do
 * again on a real canvas as often as it's wanted.
 */
class Recorder {
  readonly ops: CanvasOp[] = [];
  /** False once the drawing has done something that can't be done again the same way. */
  ok = true;
  private path: Path2D | null = null;
  /** The current path has been filled or stroked: adding to it makes a copy, so that fill stays as it was. */
  private used = false;
  /**
   * The canvas has been moved (or put back) since the current path was begun: a real canvas
   * leaves what was drawn where it was, but a ready-made path would move with it.
   */
  private moved = false;

  private current(): Path2D {
    if (this.moved) this.ok = false;
    return (this.path ??= new Path2D());
  }

  private adding(): Path2D {
    const p = this.current();
    if (!this.used) return p;
    this.used = false;
    return (this.path = new Path2D(p));
  }

  private transform(op: CanvasOp): void {
    if (this.path) this.moved = true;
    this.ops.push(op);
  }

  beginPath(): void {
    this.path = null;
    this.used = false;
    this.moved = false;
  }
  moveTo(...a: Parameters<Path2D["moveTo"]>): void {
    this.adding().moveTo(...a);
  }
  lineTo(...a: Parameters<Path2D["lineTo"]>): void {
    this.adding().lineTo(...a);
  }
  quadraticCurveTo(...a: Parameters<Path2D["quadraticCurveTo"]>): void {
    this.adding().quadraticCurveTo(...a);
  }
  bezierCurveTo(...a: Parameters<Path2D["bezierCurveTo"]>): void {
    this.adding().bezierCurveTo(...a);
  }
  arc(...a: Parameters<Path2D["arc"]>): void {
    this.adding().arc(...a);
  }
  ellipse(...a: Parameters<Path2D["ellipse"]>): void {
    this.adding().ellipse(...a);
  }
  rect(...a: Parameters<Path2D["rect"]>): void {
    this.adding().rect(...a);
  }
  roundRect(...a: Parameters<Path2D["roundRect"]>): void {
    this.adding().roundRect(...a);
  }
  closePath(): void {
    this.adding().closePath();
  }
  fill(): void {
    const p = this.current();
    this.used = true;
    this.ops.push((c) => c.fill(p));
  }
  stroke(): void {
    const p = this.current();
    this.used = true;
    this.ops.push((c) => c.stroke(p));
  }
  save(): void {
    this.ops.push((c) => c.save());
  }
  restore(): void {
    this.transform((c) => c.restore());
  }
  translate(x: number, y: number): void {
    this.transform((c) => c.translate(x, y));
  }
  rotate(a: number): void {
    this.transform((c) => c.rotate(a));
  }
  scale(x: number, y: number): void {
    this.transform((c) => c.scale(x, y));
  }
  set fillStyle(v: string) {
    this.ops.push((c) => (c.fillStyle = v));
  }
  set strokeStyle(v: string) {
    this.ops.push((c) => (c.strokeStyle = v));
  }
  set lineWidth(v: number) {
    this.ops.push((c) => (c.lineWidth = v));
  }
  set lineCap(v: CanvasLineCap) {
    this.ops.push((c) => (c.lineCap = v));
  }
  set lineJoin(v: CanvasLineJoin) {
    this.ops.push((c) => (c.lineJoin = v));
  }
  set globalAlpha(v: number) {
    this.ops.push((c) => (c.globalAlpha = v));
  }
}

/** A drawing made once, to do again: null if it can't be (it used something a Recorder doesn't have). */
function record(draw: (c: CanvasRenderingContext2D) => void): CanvasOp[] | null {
  const r = new Recorder();
  try {
    draw(r as unknown as CanvasRenderingContext2D);
  } catch {
    return null;
  }
  return r.ok ? r.ops : null;
}

const LOOK_NUMBER: Record<SeasonLook, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };
/** How many varieties of seasonal tree and bush there are for each look and level. */
const VARIETIES = 64;
/** The most drawings kept (a scene in one season needs at most 512); the one drawn longest ago goes first. */
const REMEMBERED_MAX = 1024;
const remembered = new Map<number, CanvasOp[] | null>();

/**
 * Draws a tree or bush in its season. These are made of far more paths than plain ones,
 * and zoomed in, every object on screen is drawn again each frame the board moves: so
 * each variety is made into ready-made paths once, and after that only filled and stroked.
 * A variety is its look and level, its hash rounded to one of VARIETIES, and in winter the
 * way it's turned (the snow lies towards the light); nothing else changes these drawings.
 */
function drawVariety(c: CanvasRenderingContext2D, id: "tree" | "bush", s: StampLook, turns: number, draw: SeasonalDrawing): void {
  const v = Math.min(VARIETIES - 1, Math.floor(s.hash * VARIETIES));
  const t = s.look === "winter" ? ((turns % 4) + 4) % 4 : 0;
  const look: StampLook = { look: s.look, level: s.level, hash: (v + 0.5) / VARIETIES, cover: 0 };
  if (typeof Path2D === "undefined") {
    draw(c, look, t);
    return;
  }
  const key = ((((id === "tree" ? 0 : 1) * 4 + LOOK_NUMBER[s.look]) * 4 + s.level) * 4 + t) * VARIETIES + v;
  let ops = remembered.get(key);
  if (ops === undefined) {
    ops = record((r) => draw(r, look, t));
    if (remembered.size >= REMEMBERED_MAX) remembered.delete(remembered.keys().next().value!);
  } else {
    remembered.delete(key);
  }
  // Last in the map: the one drawn most recently.
  remembered.set(key, ops);
  if (ops) for (const op of ops) op(c);
  else draw(c, look, t);
}

/**
 * Draws an object into the unit square centred on the origin ([-0.5, 0.5] both ways):
 * the caller moves, turns and scales the canvas to where the object goes. `look` is its
 * seasonal look, if it's outdoors in a season; `turns` the quarter turns the caller has
 * turned it by, so snow can lie on the same side of every object.
 */
export function drawStamp(c: CanvasRenderingContext2D, id: StampId, look?: StampLook | null, turns = 0): void {
  c.save();
  c.lineJoin = "round";
  const seasonal = look ? SEASONAL_STAMPS[id] : undefined;
  if (seasonal && look) {
    if (id === "tree" || id === "bush") drawVariety(c, id, look, turns, seasonal);
    else seasonal(c, look, turns);
  } else STAMPS[id](c);
  c.restore();
}

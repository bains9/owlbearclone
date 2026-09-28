// What built maps look like: a texture for each kind of floor, and a small top-down
// drawing for each object. Everything is drawn with the canvas API, so it stays sharp
// at any zoom and needs no image files.

import type { FloorId, StampId } from "../../shared/terrain";

/** Texture pixels per grid cell. */
export const TEXTURE_CELL_PX = 96;
/** A texture tile covers 2 x 2 cells, so the repeat is less obvious. */
const TILE = TEXTURE_CELL_PX * 2;

const INK = "#2b2520";

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

/** Draws something at (x, y) and at its copies across the tile's edges, so the tile repeats seamlessly. */
function wrapped(c: CanvasRenderingContext2D, x: number, y: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      const px = x + dx;
      const py = y + dy;
      if (px > -40 && px < TILE + 40 && py > -40 && py < TILE + 40) draw(px, py);
    }
  }
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
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

function dirtTile(c: CanvasRenderingContext2D): void {
  const rand = rng(37);
  c.fillStyle = "#977650";
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 40, ["#8a6a45", "#a4845c"], 8, 18, 0.5);
  speckles(c, rand, 260, ["#7d5f3c", "#b0906a", "#6f5436"], 0.8, 2.6, 0.8);
}

function grassTile(c: CanvasRenderingContext2D): void {
  const rand = rng(41);
  c.fillStyle = "#6e9a45";
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 30, ["#659041", "#79a64f"], 10, 22, 0.5);
  c.lineCap = "round";
  c.lineWidth = 1.6;
  for (let i = 0; i < 260; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const len = 3 + rand() * 5;
    const lean = (rand() - 0.5) * 4;
    c.strokeStyle = rand() < 0.5 ? "#557d33" : "#8cba5c";
    wrapped(c, x, y, (px, py) => {
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + lean, py - len);
      c.stroke();
    });
  }
}

function waterTile(c: CanvasRenderingContext2D): void {
  const rand = rng(53);
  c.fillStyle = "#3f7fb0";
  c.fillRect(0, 0, TILE, TILE);
  speckles(c, rand, 24, ["#3a76a5", "#4889bb"], 14, 28, 0.6);
  c.strokeStyle = "#8fc0e3";
  c.lineCap = "round";
  c.lineWidth = 2;
  c.globalAlpha = 0.7;
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

const TILES: Record<FloorId, (c: CanvasRenderingContext2D) => void> = {
  s: stoneTile,
  w: woodTile,
  d: dirtTile,
  g: grassTile,
  a: waterTile,
  l: lavaTile,
};

const tileCanvases = new Map<FloorId, HTMLCanvasElement>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<FloorId, CanvasPattern | null>>();

function tileCanvas(floor: FloorId): HTMLCanvasElement {
  let canvas = tileCanvases.get(floor);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = TILE;
    canvas.height = TILE;
    TILES[floor](canvas.getContext("2d")!);
    tileCanvases.set(floor, canvas);
  }
  return canvas;
}

/**
 * The repeating texture for a floor, for this canvas, laid out so one texture cell
 * matches one grid cell: `cell` map pixels wide, starting at the grid's offset.
 */
export function floorPattern(c: CanvasRenderingContext2D, floor: FloorId, cell: number, offX: number, offY: number): CanvasPattern | string {
  let byFloor = patterns.get(c);
  if (!byFloor) {
    byFloor = new Map();
    patterns.set(c, byFloor);
  }
  let p = byFloor.get(floor);
  if (p === undefined) {
    p = c.createPattern(tileCanvas(floor), "repeat");
    byFloor.set(floor, p);
  }
  if (!p) return FLOOR_COLORS[floor];
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
  const rand = rng(seed);
  c.beginPath();
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

/** A soft shadow under an object. */
function shadow(c: CanvasRenderingContext2D, draw: () => void): void {
  c.save();
  c.translate(0.035, 0.045);
  c.beginPath();
  draw();
  c.fillStyle = "rgba(0, 0, 0, 0.28)";
  c.fill();
  c.restore();
}

const WOOD = "#8f5b2c";
const WOOD_LIGHT = "#b07a45";
const STONE = "#b9b2a4";
const METAL = "#c9a227";
const LEAF = "#3f7a36";

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
    roundRect(c, -0.46, -0.04, 0.92, 0.08, 0.02);
    c.fillStyle = WOOD;
    c.fill();
    outline(c, 0.02);
  },
  tree(c) {
    shadow(c, () => blob(c, 0, 0, 0.46, 5, 12, 0.14));
    blob(c, 0, 0, 0.46, 5, 12, 0.14);
    c.fillStyle = LEAF;
    c.fill();
    outline(c);
    const clumps: [number, number, number][] = [
      [-0.16, -0.14, 0.17],
      [0.15, -0.12, 0.16],
      [0.12, 0.16, 0.17],
      [-0.15, 0.14, 0.15],
      [0, 0, 0.14],
    ];
    clumps.forEach(([x, y, r], i) => {
      blob(c, x, y, r, 20 + i, 8, 0.2);
      c.fillStyle = i % 2 ? "#4d8c3f" : "#579a47";
      c.fill();
      c.strokeStyle = "rgba(20, 50, 18, 0.6)";
      c.lineWidth = 0.015;
      c.stroke();
    });
  },
  bush(c) {
    shadow(c, () => blob(c, 0, 0, 0.32, 9, 10, 0.2));
    blob(c, 0, 0, 0.32, 9, 10, 0.2);
    c.fillStyle = "#4f8a3c";
    c.fill();
    outline(c);
    for (const [x, y, r, s] of [
      [-0.1, -0.06, 0.12, 31],
      [0.1, 0.02, 0.11, 32],
      [-0.02, 0.12, 0.1, 33],
    ]) {
      blob(c, x, y, r, s, 7, 0.25);
      c.fillStyle = "#5fa048";
      c.fill();
    }
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
    const bits: [number, number, number][] = [
      [-0.24, -0.2, 0.12],
      [0.18, -0.24, 0.09],
      [0.02, -0.02, 0.14],
      [-0.2, 0.2, 0.1],
      [0.24, 0.16, 0.12],
      [0.3, -0.02, 0.06],
      [-0.34, 0.02, 0.06],
      [0.04, 0.3, 0.07],
    ];
    bits.forEach(([x, y, r], i) => {
      blob(c, x, y, r, 80 + i, 5, 0.4);
      c.fillStyle = i % 2 ? "#8d8a84" : "#a19d95";
      c.fill();
      outline(c, 0.02);
    });
  },
};

/**
 * Draws an object into the unit square centred on the origin ([-0.5, 0.5] both ways):
 * the caller moves, turns and scales the canvas to where the object goes.
 */
export function drawStamp(c: CanvasRenderingContext2D, id: StampId): void {
  c.save();
  c.lineJoin = "round";
  STAMPS[id](c);
  c.restore();
}

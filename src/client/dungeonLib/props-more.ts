// Copied from Dungeon (src/render/props-more.ts) by scripts/sync-dungeon-library.mjs, Dungeon 4445927. Change it there and run the script again.
import { rng } from "./noise";
import { OUT, LW, outline, rr, circle, radial, linear, board, flame, canopy, rockShape, type PropDef } from "./propkit";

// The larger prop library (26 October 2026). Ids are plain words because table.parhome.ca's
// Seasons read a role from them (tree, pine, fir, dead tree, stump, log, bush, hedge, fern,
// flower, reeds, lily, mushroom, rock, boulder, rubble, snowdrift, campfire…). So a man-made
// thing never carries a nature word in its id ("bench-carved", not "stone-bench"), and a
// natural thing always does.

type C = CanvasRenderingContext2D;

const WOOD_L = "#a8774a";
const WOOD_D = "#6e4628";
const STONE_L = "#b8b4ac";
const STONE_D = "#77736c";
const IRON_L = "#9a9aa2";
const IRON_D = "#3a3a40";
const GOLD = "#d4b04a";

function ell(c: C, x: number, y: number, rx: number, ry: number, rot = 0): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function poly(c: C, pts: number[]): void {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i ? c.lineTo(pts[i], pts[i + 1]) : c.moveTo(pts[i], pts[i + 1]));
  c.closePath();
}

/** Fills the current path, then outlines it. */
function fo(c: C, fill: string | CanvasGradient, w = LW): void {
  c.fillStyle = fill;
  c.fill();
  outline(c, w);
}

function block(c: C, x: number, y: number, w: number, h: number, light = STONE_L, dark = STONE_D, r = 0.03): void {
  rr(c, x, y, w, h, r);
  fo(c, linear(c, x, y, x + w * 0.3, y + h, light, dark));
}

function metalBox(c: C, x: number, y: number, w: number, h: number): void {
  rr(c, x, y, w, h, 0.02);
  fo(c, linear(c, x, y, x, y + h, IRON_L, IRON_D));
}

function glow(c: C, x: number, y: number, r: number, rgb: string, a = 0.55): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  circle(c, x, y, r);
  c.fill();
}

function cloth(c: C, x: number, y: number, w: number, h: number, a: string, b: string): void {
  rr(c, x, y, w, h, Math.min(w, h) * 0.12);
  fo(c, linear(c, x, y, x + w, y + h, a, b), 0.02);
}

function flowerDots(c: C, cx: number, cy: number, r: number, n: number, seed: number, color: string): void {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    c.fillStyle = color;
    for (let k = 0; k < 5; k++) {
      const pa = (k / 5) * Math.PI * 2;
      circle(c, x + Math.cos(pa) * 0.03, y + Math.sin(pa) * 0.03, 0.025);
      c.fill();
    }
    c.fillStyle = "#f6e27a";
    circle(c, x, y, 0.018);
    c.fill();
  }
}

function leaves(c: C, cx: number, cy: number, r: number, n: number, seed: number, colors: string[]): void {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r;
    c.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ell(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.06, 0.025, rnd() * Math.PI);
    c.fill();
  }
}

function book(c: C, x: number, y: number, w: number, h: number, color: string): void {
  rr(c, x, y, w, h, 0.01);
  fo(c, color, 0.015);
  c.fillStyle = "#efe6cc";
  c.fillRect(x + w * 0.85, y + 0.01, w * 0.12, h - 0.02);
}

function plate(c: C, x: number, y: number, r: number, food: string): void {
  circle(c, x, y, r);
  fo(c, "#e8e2d4", 0.015);
  circle(c, x, y, r * 0.6);
  c.fillStyle = food;
  c.fill();
}

const flameProp = (x: number, y: number, r: number) => (c: C) => flame(c, x, y, r);

export const MORE_PROPS: PropDef[] = [
  // ---------------------------------------------------------------- Furniture
  { id: "small-table", name: "Small table", category: "Furniture", w: 1, h: 1, layer: "object", draw: (c) => board(c, -0.45, -0.45, 0.9, 0.9, WOOD_L, WOOD_D, 101) },
  {
    id: "desk", name: "Desk", category: "Furniture", w: 1.6, h: 0.9, layer: "object",
    draw: (c) => {
      board(c, -0.78, -0.42, 1.56, 0.84, "#9a6a3e", "#6a4426", 102);
      c.fillStyle = "#efe6cc";
      c.save(); c.translate(-0.3, -0.05); c.rotate(-0.15); c.fillRect(-0.18, -0.13, 0.36, 0.26); c.restore();
      book(c, 0.2, -0.25, 0.3, 0.2, "#7a2a2a");
      c.fillStyle = "#1a1a1a"; circle(c, 0.5, 0.18, 0.05); c.fill();
      c.strokeStyle = "#f4f0e0"; c.lineWidth = 0.015; c.beginPath(); c.moveTo(0.5, 0.18); c.lineTo(0.65, 0.05); c.stroke();
    },
  },
  {
    id: "dining-table", name: "Dining table", category: "Furniture", w: 2.6, h: 1.2, layer: "object",
    draw: (c) => {
      board(c, -1.25, -0.55, 2.5, 1.1, "#9a6a3e", "#6a4426", 103);
      cloth(c, -1.05, -0.45, 2.1, 0.9, "#f2ece0", "#d8cfbe");
      for (const x of [-0.75, -0.25, 0.25, 0.75]) { plate(c, x, -0.22, 0.13, "#b8742a"); plate(c, x, 0.22, 0.13, "#6a8a3a"); }
      c.fillStyle = "#8a1a24"; circle(c, 0, 0, 0.08); c.fill();
    },
  },
  {
    id: "long-table", name: "Long table", category: "Furniture", w: 3.2, h: 1, layer: "object",
    draw: (c) => { for (let i = 0; i < 3; i++) board(c, -1.55, -0.48 + i * 0.32, 3.1, 0.32, "#9a6a3e", "#744a2c", 104 + i); },
  },
  {
    id: "stool", name: "Stool", category: "Furniture", w: 0.5, h: 0.5, layer: "object",
    draw: (c) => { circle(c, 0, 0, 0.22); fo(c, radial(c, 0, 0, 0.22, WOOD_L, WOOD_D)); },
  },
  {
    id: "armchair", name: "Armchair", category: "Furniture", w: 1, h: 1, layer: "object",
    draw: (c) => {
      rr(c, -0.45, -0.45, 0.9, 0.9, 0.14); fo(c, linear(c, 0, -0.45, 0, 0.45, "#8a2a2e", "#5a1418"));
      rr(c, -0.3, -0.2, 0.6, 0.55, 0.1); fo(c, radial(c, 0, 0.05, 0.4, "#b23a40", "#7a2228"), 0.02);
    },
  },
  {
    id: "throne", name: "Throne", category: "Furniture", w: 1.2, h: 1.1, layer: "object",
    draw: (c) => {
      rr(c, -0.55, -0.5, 1.1, 1, 0.08); fo(c, linear(c, 0, -0.5, 0, 0.5, "#e6c45a", "#9a7a22"));
      rr(c, -0.35, -0.25, 0.7, 0.65, 0.06); fo(c, radial(c, 0, 0.05, 0.45, "#a02a3a", "#5a1020"), 0.02);
      c.fillStyle = "#c22a3a"; circle(c, 0, -0.38, 0.06); c.fill();
    },
  },
  {
    id: "double-bed", name: "Double bed", category: "Furniture", w: 2, h: 2.1, layer: "object",
    draw: (c) => {
      board(c, -0.98, -1.02, 1.96, 2.04, "#7a5030", "#5a3820", 105);
      rr(c, -0.88, -0.94, 1.76, 1.86, 0.06); fo(c, "#e8e0cc", 0.02);
      for (const x of [-0.45, 0.45]) { rr(c, x - 0.36, -0.86, 0.72, 0.3, 0.1); fo(c, linear(c, 0, -0.86, 0, -0.56, "#fffaf0", "#d8d0bc"), 0.02); }
      rr(c, -0.88, -0.4, 1.76, 1.32, 0.06); fo(c, linear(c, 0, -0.4, 0, 0.92, "#5a3a7a", "#3a2456"), 0.02);
    },
  },
  {
    id: "straw-bed", name: "Straw bed", category: "Furniture", w: 1, h: 2, layer: "floor",
    draw: (c) => {
      rr(c, -0.45, -0.92, 0.9, 1.84, 0.2); fo(c, radial(c, 0, 0, 1, "#e0c070", "#a8863a"), 0.02);
      c.strokeStyle = "rgba(120,90,30,0.6)"; c.lineWidth = 0.012; const r = rng(106);
      for (let i = 0; i < 60; i++) { const x = -0.38 + r() * 0.76; const y = -0.85 + r() * 1.7; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 0.2, y + (r() - 0.5) * 0.2); c.stroke(); }
      rr(c, -0.35, 0.1, 0.7, 0.7, 0.08); fo(c, "#6a5a40", 0.015);
    },
  },
  {
    id: "wardrobe", name: "Wardrobe", category: "Furniture", w: 1.6, h: 0.7, layer: "object",
    draw: (c) => {
      board(c, -0.78, -0.33, 1.56, 0.66, "#7a5030", "#4a2e1a", 107);
      c.strokeStyle = OUT; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0, -0.33); c.lineTo(0, 0.33); c.stroke();
      c.fillStyle = GOLD; circle(c, -0.07, 0, 0.03); c.fill(); circle(c, 0.07, 0, 0.03); c.fill();
    },
  },
  {
    id: "dresser", name: "Dresser", category: "Furniture", w: 1.2, h: 0.6, layer: "object",
    draw: (c) => {
      board(c, -0.58, -0.28, 1.16, 0.56, "#9a6a3e", "#6a4426", 108);
      for (const x of [-0.3, 0, 0.3]) { c.fillStyle = GOLD; circle(c, x, 0.12, 0.025); c.fill(); }
      c.fillStyle = "#cfd8e0"; ell(c, 0.25, -0.08, 0.12, 0.08); fo(c, "#cfd8e0", 0.015);
    },
  },
  {
    id: "scroll-rack", name: "Scroll rack", category: "Furniture", w: 1.6, h: 0.5, layer: "object",
    draw: (c) => {
      board(c, -0.78, -0.23, 1.56, 0.46, "#6e4628", "#4a2e1a", 109);
      for (let i = 0; i < 9; i++) { const x = -0.66 + i * 0.165; circle(c, x, 0, 0.065); fo(c, radial(c, x, 0, 0.065, "#f4ecd2", "#c8b890"), 0.012); }
    },
  },
  {
    id: "rug-blue", name: "Blue rug", category: "Furniture", w: 2, h: 3, layer: "floor",
    draw: (c) => {
      rr(c, -1, -1.5, 2, 3, 0.05); c.fillStyle = "#24406a"; c.fill();
      c.strokeStyle = "#d8c27a"; c.lineWidth = 0.07; rr(c, -0.82, -1.32, 1.64, 2.64, 0.04); c.stroke();
      c.strokeStyle = "#16263f"; c.lineWidth = 0.04; rr(c, -0.66, -1.16, 1.32, 2.32, 0.03); c.stroke();
      c.fillStyle = "#d8c27a"; circle(c, 0, 0, 0.32); c.fill(); c.fillStyle = "#24406a"; circle(c, 0, 0, 0.22); c.fill();
    },
  },
  {
    id: "rug-round", name: "Round rug", category: "Furniture", w: 2, h: 2, layer: "floor",
    draw: (c) => {
      circle(c, 0, 0, 0.98); c.fillStyle = "#6a3a1a"; c.fill();
      for (const [r, col] of [[0.8, "#c88a3a"], [0.62, "#8a2a1a"], [0.42, "#e0b060"], [0.22, "#8a2a1a"]] as const) { circle(c, 0, 0, r); c.fillStyle = col; c.fill(); }
    },
  },
  {
    id: "fur-rug", name: "Fur rug", category: "Furniture", w: 2, h: 2.4, layer: "floor",
    draw: (c) => {
      poly(c, [0, -1.15, 0.35, -0.85, 0.85, -0.95, 0.65, -0.45, 0.8, 0.4, 0.95, 0.95, 0.4, 0.75, 0, 1.15, -0.4, 0.75, -0.95, 0.95, -0.8, 0.4, -0.65, -0.45, -0.85, -0.95, -0.35, -0.85]);
      fo(c, radial(c, 0, 0, 1.1, "#c8a882", "#7a5a3a"), 0.025);
    },
  },
  {
    id: "bathtub", name: "Bathtub", category: "Furniture", w: 1, h: 2, layer: "object",
    draw: (c) => {
      rr(c, -0.45, -0.92, 0.9, 1.84, 0.4); fo(c, linear(c, -0.45, 0, 0.45, 0, "#e8e4dc", "#b8b2a6"));
      rr(c, -0.34, -0.8, 0.68, 1.6, 0.32); fo(c, radial(c, 0, 0, 0.8, "#9ad0e0", "#4a8aa8"), 0.02);
    },
  },
  {
    id: "washbasin", name: "Washbasin", category: "Furniture", w: 0.7, h: 0.7, layer: "object",
    draw: (c) => { circle(c, 0, 0, 0.3); fo(c, radial(c, 0, 0, 0.3, "#d8d4cc", "#9a968e")); circle(c, 0, 0, 0.2); fo(c, radial(c, 0, 0, 0.2, "#a8d8e8", "#5a9ab8"), 0.015); },
  },
  {
    id: "folding-screen", name: "Folding screen", category: "Furniture", w: 2, h: 0.4, layer: "object",
    draw: (c) => {
      c.beginPath(); c.moveTo(-0.95, 0.1); c.lineTo(-0.5, -0.12); c.lineTo(0, 0.1); c.lineTo(0.5, -0.12); c.lineTo(0.95, 0.1);
      c.lineWidth = 0.1; c.strokeStyle = OUT; c.lineJoin = "round"; c.stroke(); c.lineWidth = 0.065; c.strokeStyle = "#c8a85a"; c.stroke();
    },
  },
  {
    id: "cushions", name: "Floor cushions", category: "Furniture", w: 1.4, h: 1.4, layer: "floor",
    draw: (c) => {
      const cols = ["#8a2a3a", "#2a5a7a", "#c88a2a", "#4a7a3a"];
      [[-0.32, -0.3], [0.32, -0.28], [-0.3, 0.32], [0.3, 0.3]].forEach(([x, y], i) => { rr(c, x - 0.26, y - 0.26, 0.52, 0.52, 0.16); fo(c, radial(c, x, y, 0.35, "#ffffff22", cols[i]), 0.02); c.fillStyle = cols[i]; rr(c, x - 0.22, y - 0.22, 0.44, 0.44, 0.13); c.fill(); });
    },
  },
  {
    id: "chess-table", name: "Chess table", category: "Furniture", w: 1, h: 1, layer: "object",
    draw: (c) => {
      board(c, -0.46, -0.46, 0.92, 0.92, WOOD_L, WOOD_D, 110);
      const s = 0.08;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c.fillStyle = (i + j) % 2 ? "#2a2420" : "#e8dcc0"; c.fillRect(-0.32 + i * s, -0.32 + j * s, s, s); }
    },
  },
  {
    id: "lectern", name: "Lectern", category: "Furniture", w: 0.8, h: 0.7, layer: "object",
    draw: (c) => { board(c, -0.36, -0.3, 0.72, 0.6, "#7a5030", "#4a2e1a", 111); book(c, -0.27, -0.2, 0.26, 0.38, "#f4ecd2"); book(c, 0.01, -0.2, 0.26, 0.38, "#f4ecd2"); },
  },

  // ---------------------------------------------------------------- Containers
  {
    id: "barrel-lying", name: "Barrel on its side", category: "Containers", w: 1, h: 0.8, layer: "object",
    draw: (c) => {
      rr(c, -0.46, -0.34, 0.92, 0.68, 0.22); fo(c, linear(c, 0, -0.34, 0, 0.34, "#a87444", "#5e3a1e"));
      c.strokeStyle = IRON_D; c.lineWidth = 0.04; for (const x of [-0.28, 0.28]) { c.beginPath(); c.moveTo(x, -0.33); c.lineTo(x, 0.33); c.stroke(); }
    },
  },
  {
    id: "barrels", name: "Barrels", category: "Containers", w: 1.6, h: 1.4, layer: "object",
    draw: (c) => {
      for (const [x, y] of [[-0.38, -0.3], [0.38, -0.3], [0, 0.35]]) {
        circle(c, x, y, 0.36); fo(c, radial(c, x, y, 0.36, "#a87444", "#5e3a1e"));
        c.strokeStyle = IRON_D; c.lineWidth = 0.03; circle(c, x, y, 0.28); c.stroke();
      }
    },
  },
  {
    id: "crate-small", name: "Small crate", category: "Containers", w: 0.6, h: 0.6, layer: "object",
    draw: (c) => { board(c, -0.27, -0.27, 0.54, 0.54, "#b08452", "#80582e", 112); c.strokeStyle = "#6a4422"; c.lineWidth = 0.05; c.beginPath(); c.moveTo(-0.22, -0.22); c.lineTo(0.22, 0.22); c.stroke(); },
  },
  {
    id: "crates", name: "Crates", category: "Containers", w: 1.6, h: 1.4, layer: "object",
    draw: (c) => {
      for (const [x, y, s, seed] of [[-0.35, 0.2, 0.8, 113], [0.42, 0.25, 0.65, 114], [0.05, -0.38, 0.6, 115]]) {
        c.save(); c.translate(x, y); c.rotate((seed % 3) * 0.12 - 0.12);
        board(c, -s / 2, -s / 2, s, s, "#b08452", "#80582e", seed);
        c.strokeStyle = "#6a4422"; c.lineWidth = 0.05; c.beginPath(); c.moveTo(-s / 2 + 0.05, -s / 2 + 0.05); c.lineTo(s / 2 - 0.05, s / 2 - 0.05); c.stroke();
        c.restore();
      }
    },
  },
  {
    id: "chest-open", name: "Open chest", category: "Containers", w: 1, h: 1, layer: "object",
    draw: (c) => {
      board(c, -0.48, -0.45, 0.96, 0.32, "#6a4426", "#4a2e1a", 116);
      board(c, -0.48, -0.1, 0.96, 0.56, "#8a5a30", "#5a3820", 117);
      rr(c, -0.4, -0.04, 0.8, 0.42, 0.03); c.fillStyle = "#2a1a10"; c.fill();
      const r = rng(118); for (let i = 0; i < 26; i++) { c.fillStyle = r() > 0.15 ? "#e8c24a" : "#c23a4a"; circle(c, -0.35 + r() * 0.7, 0.02 + r() * 0.32, 0.04); c.fill(); }
    },
  },
  {
    id: "sacks", name: "Sacks", category: "Containers", w: 1.4, h: 1.2, layer: "object",
    draw: (c) => {
      for (const [x, y, s] of [[-0.3, 0.15, 1], [0.32, 0.18, 0.9], [0, -0.28, 0.85]]) { ell(c, x, y, 0.27 * s, 0.24 * s); fo(c, radial(c, x, y, 0.3 * s, "#d8c294", "#9a8256")); ell(c, x, y - 0.2 * s, 0.07, 0.05); fo(c, "#8a7246", 0.015); }
    },
  },
  {
    id: "basket", name: "Basket of apples", category: "Containers", w: 0.7, h: 0.7, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 0.3); fo(c, radial(c, 0, 0, 0.3, "#c8a060", "#7a5a2a"));
      c.strokeStyle = "rgba(60,40,15,0.5)"; c.lineWidth = 0.012; for (let r = 0.1; r < 0.3; r += 0.05) { circle(c, 0, 0, r); c.stroke(); }
      for (const [x, y] of [[-0.08, -0.06], [0.08, -0.04], [0, 0.08], [-0.1, 0.1], [0.1, 0.1]]) { circle(c, x, y, 0.07); fo(c, radial(c, x, y, 0.07, "#ff6a5a", "#a01a1a"), 0.012); }
    },
  },
  {
    id: "urn", name: "Urn", category: "Containers", w: 0.7, h: 0.7, layer: "object",
    draw: (c) => { circle(c, 0, 0, 0.3); fo(c, radial(c, 0, 0, 0.3, "#d08a5a", "#8a4a26")); circle(c, 0, 0, 0.13); fo(c, "#3a2214", 0.02); },
  },
  {
    id: "pots", name: "Clay pots", category: "Containers", w: 1.2, h: 1, layer: "object",
    draw: (c) => {
      for (const [x, y, r] of [[-0.3, 0.1, 0.24], [0.28, 0.12, 0.2], [0, -0.25, 0.18]]) { circle(c, x, y, r); fo(c, radial(c, x, y, r, "#d08a5a", "#8a4a26")); circle(c, x, y, r * 0.42); fo(c, "#3a2214", 0.015); }
    },
  },
  {
    id: "bucket", name: "Bucket", category: "Containers", w: 0.5, h: 0.5, layer: "object",
    draw: (c) => { circle(c, 0, 0, 0.21); fo(c, radial(c, 0, 0, 0.21, "#a87444", "#5e3a1e")); circle(c, 0, 0, 0.15); fo(c, radial(c, 0, 0, 0.15, "#6aa8c8", "#2a5a7a"), 0.015); },
  },
  {
    id: "treasure", name: "Treasure pile", category: "Containers", w: 1.4, h: 1.2, layer: "object",
    draw: (c) => {
      ell(c, 0, 0, 0.62, 0.5); fo(c, radial(c, -0.1, -0.1, 0.65, "#ffe080", "#b08020"));
      const r = rng(119);
      for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * 0.5; c.fillStyle = r() > 0.12 ? (r() > 0.5 ? "#f0d060" : "#c89a2a") : ["#c22a3a", "#2a7ac2", "#2ac27a"][Math.floor(r() * 3)]; circle(c, Math.cos(a) * d * 1.2, Math.sin(a) * d, 0.045); c.fill(); }
    },
  },
  {
    id: "strongbox", name: "Strongbox", category: "Containers", w: 0.8, h: 0.6, layer: "object",
    draw: (c) => { metalBox(c, -0.36, -0.26, 0.72, 0.52); c.fillStyle = GOLD; rr(c, -0.06, -0.06, 0.12, 0.14, 0.02); c.fill(); for (const x of [-0.3, 0.3]) for (const y of [-0.2, 0.2]) { c.fillStyle = IRON_D; circle(c, x, y, 0.025); c.fill(); } },
  },

  // ---------------------------------------------------------------- Kitchen & tavern
  {
    id: "bar-counter", name: "Bar counter", category: "Kitchen & tavern", w: 3.2, h: 0.8, layer: "object",
    draw: (c) => {
      board(c, -1.55, -0.36, 3.1, 0.72, "#7a4a28", "#4a2a14", 120);
      for (const x of [-1.1, -0.5, 0.4, 1.1]) { circle(c, x, -0.05, 0.08); fo(c, radial(c, x, -0.05, 0.08, "#d8d0c0", "#8a8478"), 0.015); circle(c, x, -0.05, 0.055); c.fillStyle = "#d8a040"; c.fill(); }
    },
  },
  {
    id: "keg", name: "Keg on a stand", category: "Kitchen & tavern", w: 1.1, h: 0.8, layer: "object",
    draw: (c) => {
      board(c, -0.52, -0.36, 1.04, 0.12, WOOD_D, "#4a2e1a", 121); board(c, -0.52, 0.24, 1.04, 0.12, WOOD_D, "#4a2e1a", 122);
      rr(c, -0.44, -0.28, 0.88, 0.56, 0.2); fo(c, linear(c, 0, -0.28, 0, 0.28, "#b07a48", "#6a4224"));
      c.fillStyle = IRON_L; c.fillRect(0.42, -0.04, 0.08, 0.08);
    },
  },
  {
    id: "food-platter", name: "Food platter", category: "Kitchen & tavern", w: 1, h: 0.8, layer: "object",
    draw: (c) => {
      ell(c, 0, 0, 0.45, 0.34); fo(c, linear(c, 0, -0.34, 0, 0.34, "#d8d0c0", "#9a948a"));
      ell(c, -0.1, 0, 0.22, 0.14, 0.3); fo(c, radial(c, -0.1, 0, 0.22, "#d8904a", "#8a4a1a"), 0.015);
      for (const [x, y, col] of [[0.22, -0.1, "#c22a2a"], [0.25, 0.1, "#6aa82a"], [0.12, 0.17, "#e8c24a"]] as const) { circle(c, x, y, 0.06); fo(c, col, 0.012); }
    },
  },
  {
    id: "oven", name: "Bread oven", category: "Kitchen & tavern", w: 1.4, h: 1.4, layer: "object",
    light: { radius: 3, color: "#ff9a4a", intensity: 0.7 },
    draw: (c) => {
      circle(c, 0, 0, 0.66); fo(c, radial(c, -0.1, -0.1, 0.7, "#c89a7a", "#7a5040"));
      c.strokeStyle = "rgba(60,30,20,0.45)"; c.lineWidth = 0.015; for (let r = 0.2; r < 0.66; r += 0.12) { circle(c, 0, 0, r); c.stroke(); }
      rr(c, -0.2, 0.36, 0.4, 0.3, 0.1); fo(c, radial(c, 0, 0.55, 0.3, "#ffcc66", "#a0300a"), 0.02);
    },
  },
  {
    id: "kitchen-counter", name: "Kitchen counter", category: "Kitchen & tavern", w: 2, h: 0.8, layer: "object",
    draw: (c) => {
      board(c, -0.98, -0.37, 1.96, 0.74, "#9a6a3e", "#6a4426", 123);
      rr(c, -0.7, -0.22, 0.5, 0.36, 0.03); fo(c, "#d8b88a", 0.015);
      c.fillStyle = IRON_L; c.save(); c.translate(-0.45, -0.04); c.rotate(0.3); c.fillRect(-0.02, -0.18, 0.04, 0.24); c.restore();
      for (const [x, y, col] of [[0.2, -0.05, "#e07a2a"], [0.35, 0.1, "#6aa82a"], [0.55, -0.12, "#c22a2a"], [0.7, 0.08, "#e8d8a0"]] as const) { circle(c, x, y, 0.07); fo(c, col, 0.012); }
    },
  },
  {
    id: "cookware", name: "Pots and pans", category: "Kitchen & tavern", w: 1.2, h: 0.8, layer: "object",
    draw: (c) => {
      circle(c, -0.3, 0, 0.27); fo(c, radial(c, -0.3, 0, 0.27, "#5a5a62", "#1a1a1e")); circle(c, -0.3, 0, 0.19); fo(c, "#8a5a2a", 0.015);
      circle(c, 0.28, 0.05, 0.2); fo(c, radial(c, 0.28, 0.05, 0.2, "#c87a4a", "#7a3a1a"));
      c.fillStyle = "#3a2a1a"; c.save(); c.translate(0.28, 0.05); c.rotate(-0.6); c.fillRect(0.18, -0.03, 0.22, 0.06); c.restore();
    },
  },
  {
    id: "wine-rack", name: "Wine rack", category: "Kitchen & tavern", w: 1.6, h: 0.5, layer: "object",
    draw: (c) => {
      board(c, -0.78, -0.23, 1.56, 0.46, "#6e4628", "#4a2e1a", 124);
      for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) { const x = -0.6 + i * 0.2; const y = -0.08 + j * 0.16; circle(c, x, y, 0.06); fo(c, j ? "#2a4a1a" : "#4a1a2a", 0.012); }
    },
  },
  {
    id: "tankards", name: "Tankards", category: "Kitchen & tavern", w: 0.6, h: 0.6, layer: "object",
    draw: (c) => { for (const [x, y] of [[-0.12, -0.08], [0.12, -0.06], [0, 0.13]]) { circle(c, x, y, 0.09); fo(c, radial(c, x, y, 0.09, "#d8d0c0", "#7a7468"), 0.015); circle(c, x, y, 0.06); c.fillStyle = "#e8b040"; c.fill(); c.fillStyle = "#fff8e0"; circle(c, x - 0.015, y - 0.015, 0.03); c.fill(); } },
  },
  {
    id: "cheese-wheel", name: "Cheese wheels", category: "Kitchen & tavern", w: 0.9, h: 0.7, layer: "object",
    draw: (c) => {
      for (const [x, y] of [[-0.18, 0], [0.2, 0.05]]) { circle(c, x, y, 0.2); fo(c, radial(c, x, y, 0.2, "#ffe48a", "#c89a2a")); }
      c.fillStyle = "#c89a2a"; c.beginPath(); c.moveTo(0.2, 0.05); c.arc(0.2, 0.05, 0.2, -0.4, 0.5); c.closePath(); c.fill();
    },
  },
  {
    id: "spit-roast", name: "Spit roast", category: "Kitchen & tavern", w: 1.6, h: 1, layer: "object",
    light: { radius: 6, color: "#ff9a4a", intensity: 0.9 },
    draw: (c) => {
      c.strokeStyle = "#3a2a1a"; c.lineWidth = 0.05; c.beginPath(); c.moveTo(-0.72, 0); c.lineTo(0.72, 0); c.stroke();
      for (const x of [-0.68, 0.68]) { c.fillStyle = WOOD_D; c.fillRect(x - 0.04, -0.12, 0.08, 0.24); }
      flame(c, 0, 0.12, 0.2);
      ell(c, 0, -0.02, 0.32, 0.17); fo(c, radial(c, 0, -0.05, 0.32, "#d8904a", "#7a3a14"));
    },
  },

  // ---------------------------------------------------------------- Nature
  { id: "oak-tree", name: "Oak tree", category: "Nature", w: 3.2, h: 3.2, layer: "canopy", draw: (c) => canopy(c, 1.45, 131, "#1c3614", "#2c5220", "#5a8a36") },
  { id: "birch-tree", name: "Birch tree", category: "Nature", w: 2, h: 2, layer: "canopy", draw: (c) => canopy(c, 0.88, 132, "#3a5a20", "#5a8a32", "#a8cc66") },
  {
    id: "willow-tree", name: "Willow tree", category: "Nature", w: 3, h: 3, layer: "canopy",
    draw: (c) => {
      canopy(c, 1.3, 133, "#2a4a1c", "#4a7a30", "#8ab05a");
      c.strokeStyle = "rgba(150,190,90,0.6)"; c.lineWidth = 0.025; const r = rng(134);
      for (let i = 0; i < 70; i++) { const a = r() * Math.PI * 2; const d = 0.3 + r() * 0.95; c.beginPath(); c.moveTo(Math.cos(a) * d, Math.sin(a) * d); c.lineTo(Math.cos(a) * (d + 0.18), Math.sin(a) * (d + 0.18)); c.stroke(); }
    },
  },
  {
    id: "fir-tree", name: "Fir tree", category: "Nature", w: 1.6, h: 1.6, layer: "canopy",
    draw: (c) => {
      for (let i = 0; i < 4; i++) {
        const r = 0.76 - i * 0.18; c.beginPath();
        for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; const rad = k % 2 ? r * 0.65 : r; k ? c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : c.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); }
        c.closePath(); fo(c, radial(c, 0, 0, r, i === 3 ? "#3a6a3a" : "#1e4024", "#10261a"), 0.025);
      }
    },
  },
  {
    id: "dead-tree", name: "Dead tree", category: "Nature", w: 2.2, h: 2.2, layer: "canopy",
    draw: (c) => {
      c.strokeStyle = "#3a2c22"; c.lineCap = "round"; const r = rng(135);
      const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
        const x2 = x + Math.cos(a) * len; const y2 = y + Math.sin(a) * len;
        c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
        if (depth > 0) for (const da of [-0.5, 0.45]) branch(x2, y2, a + da + (r() - 0.5) * 0.4, len * 0.62, w * 0.62, depth - 1);
      };
      for (let i = 0; i < 5; i++) branch(0, 0, (i / 5) * Math.PI * 2 + r(), 0.42, 0.1, 3);
      circle(c, 0, 0, 0.12); fo(c, "#4a3a2c", 0.02);
    },
  },
  {
    id: "stump", name: "Tree stump", category: "Nature", w: 0.8, h: 0.8, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 0.34); fo(c, "#5a3e26");
      circle(c, 0, 0, 0.28); fo(c, radial(c, 0, 0, 0.28, "#e0c08a", "#b08a5a"), 0.015);
      c.strokeStyle = "rgba(120,80,40,0.6)"; c.lineWidth = 0.012; for (let r = 0.06; r < 0.28; r += 0.05) { circle(c, 0, 0, r); c.stroke(); }
    },
  },
  {
    id: "fallen-branch", name: "Fallen branch", category: "Nature", w: 1.6, h: 0.8, layer: "object",
    draw: (c) => {
      c.lineCap = "round"; c.strokeStyle = OUT; c.lineWidth = 0.13; c.beginPath(); c.moveTo(-0.7, 0.15); c.quadraticCurveTo(0, -0.1, 0.7, 0.05); c.moveTo(0, -0.02); c.lineTo(0.25, -0.3); c.moveTo(-0.3, 0.04); c.lineTo(-0.45, -0.25); c.stroke();
      c.strokeStyle = "#6a4a2e"; c.lineWidth = 0.08; c.stroke();
      leaves(c, 0.25, -0.3, 0.12, 8, 136, ["#4a7a30", "#6a9a3a"]);
    },
  },
  {
    id: "flower-bush", name: "Flowering bush", category: "Nature", w: 1, h: 1, layer: "object",
    draw: (c) => { canopy(c, 0.42, 137, "#203c1a", "#355e28", "#6a9a44"); flowerDots(c, 0, 0, 0.36, 9, 138, "#e86aa8"); },
  },
  {
    id: "hedge", name: "Hedge", category: "Nature", w: 2.2, h: 0.8, layer: "object",
    draw: (c) => {
      for (let i = 0; i < 5; i++) { c.save(); c.translate(-0.8 + i * 0.4, 0); canopy(c, 0.3, 140 + i, "#1e3a18", "#2e5624", "#4a7a32"); c.restore(); }
    },
  },
  {
    id: "fern", name: "Fern", category: "Nature", w: 0.9, h: 0.9, layer: "object",
    draw: (c) => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2; c.save(); c.rotate(a);
        c.strokeStyle = "#2e5a22"; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0, 0); c.lineTo(0.4, 0); c.stroke();
        c.fillStyle = "#4a8a34"; for (let k = 1; k < 7; k++) { const x = k * 0.06; ell(c, x, -0.035, 0.035, 0.015, -0.6); c.fill(); ell(c, x, 0.035, 0.035, 0.015, 0.6); c.fill(); }
        c.restore();
      }
    },
  },
  {
    id: "grass-tuft", name: "Grass tuft", category: "Nature", w: 0.7, h: 0.7, layer: "object",
    draw: (c) => {
      const r = rng(145); c.lineCap = "round";
      for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2; const l = 0.12 + r() * 0.18; c.strokeStyle = ["#3a6a24", "#5a8a32", "#7aa846"][Math.floor(r() * 3)]; c.lineWidth = 0.018; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * l, Math.sin(a) * l); c.stroke(); }
    },
  },
  {
    id: "flowers-red", name: "Red flowers", category: "Nature", w: 0.8, h: 0.8, layer: "floor",
    draw: (c) => { leaves(c, 0, 0, 0.32, 30, 146, ["#3a6a24", "#5a8a32"]); flowerDots(c, 0, 0, 0.3, 8, 147, "#d8323a"); },
  },
  {
    id: "flowers-yellow", name: "Yellow flowers", category: "Nature", w: 0.8, h: 0.8, layer: "floor",
    draw: (c) => { leaves(c, 0, 0, 0.32, 30, 148, ["#3a6a24", "#5a8a32"]); flowerDots(c, 0, 0, 0.3, 8, 149, "#f2c838"); },
  },
  {
    id: "flowers-purple", name: "Purple flowers", category: "Nature", w: 0.8, h: 0.8, layer: "floor",
    draw: (c) => { leaves(c, 0, 0, 0.32, 30, 150, ["#3a6a24", "#5a8a32"]); flowerDots(c, 0, 0, 0.3, 8, 151, "#9a5ad8"); },
  },
  {
    id: "reeds", name: "Reeds", category: "Nature", w: 0.9, h: 0.9, layer: "object",
    draw: (c) => {
      const r = rng(152); c.lineCap = "round";
      for (let i = 0; i < 26; i++) { const x = (r() - 0.5) * 0.6; const y = (r() - 0.5) * 0.6; c.strokeStyle = "#5a7a3a"; c.lineWidth = 0.025; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 0.25, y - 0.15 - r() * 0.15); c.stroke(); if (r() > 0.6) { c.fillStyle = "#6a4a2a"; ell(c, x, y - 0.1, 0.02, 0.05); c.fill(); } }
    },
  },
  {
    id: "lily-pads", name: "Lily pads", category: "Nature", w: 1, h: 1, layer: "floor",
    draw: (c) => {
      for (const [x, y, r] of [[-0.2, -0.15, 0.17], [0.2, 0.05, 0.14], [-0.1, 0.25, 0.12], [0.25, -0.28, 0.1]]) {
        c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, 0.3, Math.PI * 2 - 0.05); c.closePath(); fo(c, radial(c, x, y, r, "#7aaa4a", "#3a6a24"), 0.015);
      }
      flowerDots(c, -0.2, -0.15, 0.01, 1, 153, "#f4c8dc");
    },
  },
  {
    id: "mushrooms", name: "Mushrooms", category: "Nature", w: 0.6, h: 0.6, layer: "object",
    draw: (c) => { for (const [x, y, r] of [[-0.1, -0.05, 0.11], [0.1, 0.06, 0.08], [-0.04, 0.15, 0.06]]) { circle(c, x, y, r); fo(c, radial(c, x - r * 0.3, y - r * 0.3, r, "#e85a4a", "#9a1a14"), 0.015); c.fillStyle = "#fff4e0"; circle(c, x - r * 0.3, y, r * 0.18); c.fill(); circle(c, x + r * 0.3, y - r * 0.3, r * 0.14); c.fill(); } },
  },
  {
    id: "rocks", name: "Rocks", category: "Nature", w: 1.2, h: 1, layer: "object",
    draw: (c) => { for (const [x, y, s, seed] of [[-0.3, 0.1, 0.24, 154], [0.25, 0.15, 0.2, 155], [0, -0.25, 0.18, 156], [0.42, -0.2, 0.1, 157]]) { c.save(); c.translate(x, y); rockShape(c, s, s * 0.85, seed); c.restore(); } },
  },
  {
    id: "rubble", name: "Rubble", category: "Nature", w: 1.4, h: 1.2, layer: "object",
    draw: (c) => {
      const r = rng(158);
      for (let i = 0; i < 14; i++) { const x = (r() - 0.5) * 1.1; const y = (r() - 0.5) * 0.9; const s = 0.06 + r() * 0.1; c.save(); c.translate(x, y); c.rotate(r() * 6); poly(c, [-s, -s * 0.7, s * 0.8, -s, s, s * 0.6, -s * 0.6, s]); fo(c, linear(c, -s, -s, s, s, "#a8a49c", "#625e58"), 0.015); c.restore(); }
    },
  },
  {
    id: "snowdrift", name: "Snowdrift", category: "Nature", w: 1.6, h: 1.2, layer: "floor",
    draw: (c) => { ell(c, 0, 0, 0.72, 0.5, 0.2); fo(c, radial(c, -0.15, -0.15, 0.8, "#ffffff", "#c8d4e4"), 0.015); ell(c, 0.3, 0.1, 0.32, 0.22); c.fillStyle = "#e4ecf6"; c.fill(); },
  },

  // ---------------------------------------------------------------- Camp & outdoors
  {
    id: "tent", name: "Tent", category: "Camp & outdoors", w: 2.6, h: 2.6, layer: "canopy",
    draw: (c) => {
      poly(c, [0, -1.2, 1.2, 0, 0, 1.2, -1.2, 0]); fo(c, linear(c, -1.2, -1.2, 1.2, 1.2, "#d8c49a", "#8a7450"));
      c.strokeStyle = "rgba(60,45,25,0.6)"; c.lineWidth = 0.025; c.beginPath(); c.moveTo(0, -1.2); c.lineTo(0, 1.2); c.moveTo(-1.2, 0); c.lineTo(1.2, 0); c.stroke();
    },
  },
  {
    id: "bedroll", name: "Bedroll", category: "Camp & outdoors", w: 0.8, h: 2, layer: "floor",
    draw: (c) => { rr(c, -0.35, -0.9, 0.7, 1.8, 0.2); fo(c, linear(c, -0.35, 0, 0.35, 0, "#6a7a4a", "#3a4a2a")); ell(c, 0, -0.65, 0.22, 0.13); fo(c, "#c8b890", 0.015); },
  },
  {
    id: "wagon", name: "Wagon", category: "Camp & outdoors", w: 2, h: 3.6, layer: "object",
    draw: (c) => {
      for (const y of [-1.1, 1.1]) for (const x of [-0.92, 0.92]) { rr(c, x - 0.08, y - 0.38, 0.16, 0.76, 0.04); fo(c, "#3a2a1a"); }
      board(c, -0.8, -1.5, 1.6, 3, "#9a6a3e", "#6a4426", 160);
      c.strokeStyle = WOOD_D; c.lineWidth = 0.08; c.beginPath(); c.moveTo(0, 1.5); c.lineTo(0, 1.78); c.stroke();
      rr(c, -0.7, -1.4, 1.4, 1.5, 0.3); fo(c, linear(c, -0.7, 0, 0.7, 0, "#ece2c8", "#b8aa88"), 0.02);
    },
  },
  {
    id: "cart", name: "Hand cart", category: "Camp & outdoors", w: 1.6, h: 2, layer: "object",
    draw: (c) => {
      for (const x of [-0.72, 0.72]) { rr(c, x - 0.07, -0.3, 0.14, 0.6, 0.04); fo(c, "#3a2a1a"); }
      board(c, -0.6, -0.7, 1.2, 1.2, "#a8774a", WOOD_D, 161);
      c.strokeStyle = WOOD_D; c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.3, 0.5); c.lineTo(-0.3, 0.95); c.moveTo(0.3, 0.5); c.lineTo(0.3, 0.95); c.stroke();
    },
  },
  {
    id: "fence", name: "Fence", category: "Camp & outdoors", w: 2, h: 0.4, layer: "object",
    draw: (c) => {
      board(c, -0.98, -0.06, 1.96, 0.12, "#8a5e36", "#5a3a20", 162);
      for (const x of [-0.9, -0.3, 0.3, 0.9]) { rr(c, x - 0.07, -0.12, 0.14, 0.24, 0.02); fo(c, "#6a4426", 0.02); }
    },
  },
  {
    id: "signpost", name: "Signpost", category: "Camp & outdoors", w: 1.2, h: 0.8, layer: "object",
    draw: (c) => {
      for (const [a, y] of [[0.15, -0.18], [-0.2, 0.12]]) { c.save(); c.rotate(a); c.translate(0, y); poly(c, [-0.5, -0.1, 0.42, -0.1, 0.55, 0, 0.42, 0.1, -0.5, 0.1]); fo(c, linear(c, 0, -0.1, 0, 0.1, "#b88a5a", "#7a5430"), 0.02); c.restore(); }
      circle(c, 0, 0, 0.08); fo(c, "#5a3a20");
    },
  },
  {
    id: "haystack", name: "Haystack", category: "Camp & outdoors", w: 1.6, h: 1.6, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 0.72); fo(c, radial(c, -0.15, -0.15, 0.8, "#f0d88a", "#b08a3a"));
      c.strokeStyle = "rgba(140,100,30,0.55)"; c.lineWidth = 0.012; const r = rng(163);
      for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2; const d = r() * 0.65; c.beginPath(); c.moveTo(Math.cos(a) * d, Math.sin(a) * d); c.lineTo(Math.cos(a) * (d + 0.12), Math.sin(a) * (d + 0.12)); c.stroke(); }
    },
  },
  {
    id: "log-pile", name: "Log pile", category: "Camp & outdoors", w: 1.4, h: 1, layer: "object",
    draw: (c) => {
      for (let i = 0; i < 4; i++) { const y = -0.33 + i * 0.22; rr(c, -0.62, y - 0.09, 1.24, 0.18, 0.09); fo(c, linear(c, 0, y - 0.09, 0, y + 0.09, "#8a6040", "#4a3020"), 0.02); circle(c, 0.6, y, 0.085); fo(c, radial(c, 0.6, y, 0.085, "#e0c08a", "#a07a4a"), 0.012); }
    },
  },
  {
    id: "scarecrow", name: "Scarecrow", category: "Camp & outdoors", w: 1.2, h: 0.8, layer: "object",
    draw: (c) => {
      c.strokeStyle = "#5a3a20"; c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.5, 0); c.lineTo(0.5, 0); c.stroke();
      rr(c, -0.28, -0.2, 0.56, 0.4, 0.06); fo(c, "#6a5a8a", 0.02);
      circle(c, 0, -0.02, 0.16); fo(c, radial(c, 0, -0.02, 0.16, "#e8c87a", "#a8863a"), 0.02);
      ell(c, 0, -0.04, 0.24, 0.1); fo(c, "#5a4a2a", 0.015);
    },
  },
  {
    id: "archery-target", name: "Archery target", category: "Camp & outdoors", w: 1, h: 1, layer: "object",
    draw: (c) => { for (const [r, col] of [[0.44, "#e8e0d0"], [0.34, "#2a2a2a"], [0.25, "#2a6ac2"], [0.16, "#c22a2a"], [0.07, "#f2c838"]] as const) { circle(c, 0, 0, r); fo(c, col, 0.015); } },
  },
  {
    id: "market-stall", name: "Market stall", category: "Camp & outdoors", w: 2.4, h: 1.8, layer: "canopy",
    draw: (c) => {
      rr(c, -1.15, -0.85, 2.3, 1.7, 0.05); c.fillStyle = "#f2ece0"; c.fill(); outline(c);
      c.save(); c.clip(); for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#c23a3a" : "#f2ece0"; c.fillRect(-1.15 + i * 0.29, -0.85, 0.29, 1.7); } c.restore();
      rr(c, -1.15, -0.85, 2.3, 1.7, 0.05); outline(c);
    },
  },
  {
    id: "rowboat", name: "Rowboat", category: "Camp & outdoors", w: 1.2, h: 3, layer: "object",
    draw: (c) => {
      c.beginPath(); c.moveTo(0, -1.42); c.quadraticCurveTo(0.6, -0.6, 0.5, 0.9); c.lineTo(0.35, 1.38); c.lineTo(-0.35, 1.38); c.lineTo(-0.5, 0.9); c.quadraticCurveTo(-0.6, -0.6, 0, -1.42); c.closePath();
      fo(c, linear(c, -0.6, 0, 0.6, 0, "#8a5e36", "#5a3a20"));
      for (const y of [-0.5, 0.2, 0.9]) { c.fillStyle = "#a8774a"; c.fillRect(-0.42, y - 0.06, 0.84, 0.12); }
    },
  },

  // ---------------------------------------------------------------- Dungeon
  { id: "pillar-square", name: "Square pillar", category: "Dungeon", w: 1, h: 1, layer: "object", draw: (c) => { block(c, -0.46, -0.46, 0.92, 0.92, "#8a867e", "#5a5650"); block(c, -0.34, -0.34, 0.68, 0.68); } },
  {
    id: "pillar-broken", name: "Broken pillar", category: "Dungeon", w: 1.6, h: 1.2, layer: "object",
    draw: (c) => {
      circle(c, -0.35, 0, 0.36); fo(c, radial(c, -0.35, 0, 0.36, STONE_L, STONE_D));
      c.save(); c.translate(0.35, 0.15); c.rotate(0.4); rr(c, -0.35, -0.18, 0.7, 0.36, 0.08); fo(c, linear(c, 0, -0.18, 0, 0.18, STONE_L, STONE_D)); c.restore();
    },
  },
  {
    id: "sarcophagus", name: "Sarcophagus", category: "Dungeon", w: 1.2, h: 2.4, layer: "object",
    draw: (c) => {
      block(c, -0.56, -1.15, 1.12, 2.3, "#a8a49c", "#6a665e", 0.06);
      rr(c, -0.4, -0.95, 0.8, 1.9, 0.3); fo(c, linear(c, -0.4, 0, 0.4, 0, "#c8c4ba", "#8a867e"), 0.02);
      circle(c, 0, -0.65, 0.16); fo(c, "#b0aca2", 0.015);
    },
  },
  {
    id: "stairs-spiral", name: "Spiral stairs", category: "Dungeon", w: 2, h: 2, layer: "floor",
    draw: (c) => {
      for (let i = 0; i < 12; i++) { const a0 = (i / 12) * Math.PI * 2; const a1 = ((i + 1) / 12) * Math.PI * 2; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 0.95, a0, a1); c.closePath(); const t = 150 - i * 8; fo(c, `rgb(${t},${t - 4},${t - 10})`, 0.02); }
      circle(c, 0, 0, 0.16); fo(c, STONE_D);
    },
  },
  {
    id: "trapdoor", name: "Trapdoor", category: "Dungeon", w: 1, h: 1, layer: "floor",
    draw: (c) => { board(c, -0.45, -0.45, 0.9, 0.9, "#7a5030", "#4a2e1a", 170); c.fillStyle = IRON_D; for (const y of [-0.25, 0.25]) c.fillRect(-0.4, y - 0.04, 0.8, 0.08); circle(c, 0.3, 0, 0.06); c.strokeStyle = IRON_D; c.lineWidth = 0.025; c.stroke(); },
  },
  {
    id: "cage", name: "Cage", category: "Dungeon", w: 1.2, h: 1.2, layer: "object",
    draw: (c) => {
      rr(c, -0.55, -0.55, 1.1, 1.1, 0.04); c.strokeStyle = IRON_D; c.lineWidth = 0.06; c.stroke();
      c.lineWidth = 0.03; for (let i = 1; i < 6; i++) { const x = -0.55 + i * 0.183; c.beginPath(); c.moveTo(x, -0.55); c.lineTo(x, 0.55); c.stroke(); }
    },
  },
  {
    id: "chains", name: "Chains", category: "Dungeon", w: 1.2, h: 0.6, layer: "floor",
    draw: (c) => { c.strokeStyle = IRON_D; c.lineWidth = 0.025; for (let i = 0; i < 10; i++) { const x = -0.5 + i * 0.11; ell(c, x, Math.sin(i * 0.9) * 0.1, 0.06, 0.035, i % 2 ? 0 : Math.PI / 2); c.stroke(); } c.fillStyle = IRON_L; circle(c, 0.55, 0.05, 0.06); c.fill(); },
  },
  {
    id: "weapon-rack", name: "Weapon rack", category: "Dungeon", w: 1.6, h: 0.6, layer: "object",
    draw: (c) => {
      board(c, -0.78, -0.12, 1.56, 0.24, "#6e4628", "#4a2e1a", 171);
      for (let i = 0; i < 5; i++) { const x = -0.6 + i * 0.3; c.strokeStyle = "#5a3a20"; c.lineWidth = 0.035; c.beginPath(); c.moveTo(x, 0.25); c.lineTo(x, -0.1); c.stroke(); c.fillStyle = i % 2 ? IRON_L : "#c8ccd4"; poly(c, i % 2 ? [x, -0.28, x + 0.05, -0.1, x - 0.05, -0.1] : [x - 0.08, -0.18, x + 0.08, -0.18, x + 0.05, -0.08, x - 0.05, -0.08]); fo(c, i % 2 ? IRON_L : "#c8ccd4", 0.012); }
    },
  },
  {
    id: "armor-stand", name: "Armour stand", category: "Dungeon", w: 0.9, h: 0.7, layer: "object",
    draw: (c) => {
      ell(c, 0, 0.05, 0.38, 0.22); fo(c, linear(c, 0, -0.2, 0, 0.3, "#c8ccd4", "#6a6e78"));
      circle(c, 0, -0.04, 0.14); fo(c, radial(c, 0, -0.04, 0.14, "#e0e4ec", "#7a7e88"), 0.02);
      c.fillStyle = "#a02a2a"; c.fillRect(-0.02, -0.18, 0.04, 0.08);
    },
  },
  {
    id: "forge", name: "Forge", category: "Dungeon", w: 1.6, h: 1.2, layer: "object",
    light: { radius: 5, color: "#ff7a2a", intensity: 0.9 },
    draw: (c) => {
      block(c, -0.75, -0.55, 1.5, 1.1, "#7a766e", "#4a4640", 0.08);
      rr(c, -0.5, -0.35, 1, 0.7, 0.1); fo(c, radial(c, 0, 0, 0.6, "#ffdd66", "#8a1a04"), 0.02);
      glow(c, 0, 0, 0.5, "255,160,60", 0.5);
    },
  },
  {
    id: "skulls", name: "Skull pile", category: "Dungeon", w: 0.9, h: 0.8, layer: "object",
    draw: (c) => {
      for (const [x, y] of [[-0.18, 0.1], [0.18, 0.12], [0, -0.14], [0.3, -0.12], [-0.3, -0.1]]) {
        circle(c, x, y, 0.12); fo(c, radial(c, x - 0.03, y - 0.03, 0.12, "#f4ecd8", "#b8ae98"), 0.015);
        c.fillStyle = "#2a2420"; circle(c, x - 0.04, y, 0.025); c.fill(); circle(c, x + 0.04, y, 0.025); c.fill();
      }
    },
  },
  {
    id: "spider-web", name: "Spider web", category: "Dungeon", w: 1.6, h: 1.6, layer: "canopy",
    draw: (c) => {
      c.strokeStyle = "rgba(235,235,240,0.7)"; c.lineWidth = 0.012;
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 0.75, Math.sin(a) * 0.75); c.stroke(); }
      for (let r = 0.12; r < 0.75; r += 0.11) { c.beginPath(); for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2; i ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r); } c.stroke(); }
    },
  },
  {
    id: "debris", name: "Debris", category: "Dungeon", w: 1.2, h: 1, layer: "floor",
    draw: (c) => {
      const r = rng(172);
      for (let i = 0; i < 12; i++) { const x = (r() - 0.5) * 1; const y = (r() - 0.5) * 0.8; c.save(); c.translate(x, y); c.rotate(r() * 6); const w = 0.08 + r() * 0.18; c.fillStyle = r() > 0.5 ? "#7a5030" : "#8a867e"; c.fillRect(-w / 2, -0.03, w, 0.06); c.strokeStyle = OUT; c.lineWidth = 0.01; c.strokeRect(-w / 2, -0.03, w, 0.06); c.restore(); }
    },
  },
  {
    id: "lever", name: "Lever", category: "Dungeon", w: 0.6, h: 0.6, layer: "object",
    draw: (c) => { rr(c, -0.18, -0.12, 0.36, 0.24, 0.03); fo(c, linear(c, 0, -0.12, 0, 0.12, IRON_L, IRON_D)); c.strokeStyle = "#5a3a20"; c.lineWidth = 0.05; c.lineCap = "round"; c.beginPath(); c.moveTo(0, 0); c.lineTo(0.18, -0.2); c.stroke(); c.fillStyle = "#a02a2a"; circle(c, 0.19, -0.21, 0.05); c.fill(); },
  },
  {
    id: "magic-circle", name: "Magic circle", category: "Dungeon", w: 3, h: 3, layer: "floor",
    light: { radius: 4, color: "#8a7aff", intensity: 0.6 },
    draw: (c) => {
      glow(c, 0, 0, 1.45, "150,130,255", 0.25);
      c.strokeStyle = "rgba(190,175,255,0.9)"; c.lineWidth = 0.035; for (const r of [1.35, 1.15, 0.6]) { circle(c, 0, 0, r); c.stroke(); }
      c.beginPath(); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + ((i * 2) / 5) * Math.PI * 2; i ? c.lineTo(Math.cos(a) * 1.15, Math.sin(a) * 1.15) : c.moveTo(Math.cos(a) * 1.15, Math.sin(a) * 1.15); } c.stroke();
      c.fillStyle = "rgba(220,210,255,0.9)"; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; c.fillRect(Math.cos(a) * 1.25 - 0.03, Math.sin(a) * 1.25 - 0.03, 0.06, 0.06); }
    },
  },
  {
    id: "arcane-portal", name: "Arcane portal", category: "Dungeon", w: 2, h: 2, layer: "object",
    light: { radius: 6, color: "#6ac8ff", intensity: 0.9 },
    draw: (c) => {
      circle(c, 0, 0, 0.9); fo(c, radial(c, 0, 0, 0.9, "#7a766e", "#4a4640"));
      circle(c, 0, 0, 0.7); const g = c.createRadialGradient(0, 0, 0.05, 0, 0, 0.7); g.addColorStop(0, "#e8fbff"); g.addColorStop(0.5, "#4ab8f0"); g.addColorStop(1, "#1a2a8a"); fo(c, g, 0.02);
      c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 0.03; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0, 0, 0.2 + i * 0.15, i, i + 2.5); c.stroke(); }
    },
  },
  {
    id: "pit", name: "Pit", category: "Dungeon", w: 2, h: 2, layer: "floor",
    draw: (c) => { circle(c, 0, 0, 0.92); fo(c, radial(c, 0, 0, 0.92, "#000000", "#3a342e")); c.strokeStyle = "#6a6258"; c.lineWidth = 0.06; circle(c, 0, 0, 0.92); c.stroke(); },
  },
  {
    id: "drain", name: "Floor drain", category: "Dungeon", w: 0.8, h: 0.8, layer: "floor",
    draw: (c) => { rr(c, -0.32, -0.32, 0.64, 0.64, 0.03); fo(c, "#1a1a1c"); c.fillStyle = IRON_L; for (let i = 0; i < 5; i++) c.fillRect(-0.28, -0.26 + i * 0.12, 0.56, 0.04); },
  },
  {
    id: "obelisk", name: "Obelisk", category: "Dungeon", w: 1, h: 1, layer: "object",
    draw: (c) => { block(c, -0.46, -0.46, 0.92, 0.92, "#6a6a72", "#3a3a42"); poly(c, [0, -0.32, 0.32, 0, 0, 0.32, -0.32, 0]); fo(c, linear(c, -0.32, -0.32, 0.32, 0.32, "#9a9aa8", "#4a4a56"), 0.02); },
  },
  {
    id: "fountain", name: "Fountain", category: "Dungeon", w: 2.2, h: 2.2, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 1.02); fo(c, radial(c, 0, 0, 1.02, STONE_L, STONE_D));
      circle(c, 0, 0, 0.85); fo(c, radial(c, 0, 0, 0.85, "#8ad0e8", "#2a6a8a"), 0.02);
      circle(c, 0, 0, 0.22); fo(c, radial(c, 0, 0, 0.22, STONE_L, STONE_D), 0.02);
      c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 0.02; for (const r of [0.35, 0.5, 0.65]) { circle(c, 0, 0, r); c.stroke(); }
    },
  },
  {
    id: "idol", name: "Golden idol", category: "Dungeon", w: 1, h: 1, layer: "object",
    draw: (c) => { block(c, -0.42, -0.42, 0.84, 0.84, "#7a766e", "#4a4640"); circle(c, 0, 0, 0.22); fo(c, radial(c, -0.06, -0.06, 0.24, "#fff0a0", "#b08a20"), 0.02); c.fillStyle = "#c22a3a"; circle(c, -0.06, -0.03, 0.03); c.fill(); circle(c, 0.06, -0.03, 0.03); c.fill(); },
  },

  // ---------------------------------------------------------------- Light
  {
    id: "standing-torch", name: "Standing torch", category: "Light", w: 0.6, h: 0.6, layer: "object",
    light: { radius: 6, color: "#ffb46a", intensity: 1 },
    draw: (c) => { circle(c, 0, 0, 0.13); fo(c, "#3a2a1a"); flame(c, 0, -0.02, 0.1); },
  },
  {
    id: "candelabra", name: "Candelabra", category: "Light", w: 0.7, h: 0.7, layer: "object",
    light: { radius: 4, color: "#ffd090", intensity: 0.9 },
    draw: (c) => {
      c.strokeStyle = GOLD; c.lineWidth = 0.03; c.beginPath(); c.moveTo(-0.22, 0); c.lineTo(0.22, 0); c.moveTo(0, -0.22); c.lineTo(0, 0.22); c.stroke();
      for (const [x, y] of [[0, 0], [-0.22, 0], [0.22, 0], [0, -0.22], [0, 0.22]]) { circle(c, x, y, 0.045); fo(c, "#efe6cc", 0.012); flame(c, x, y - 0.01, 0.03); }
    },
  },
  {
    id: "chandelier", name: "Chandelier", category: "Light", w: 1.6, h: 1.6, layer: "canopy",
    light: { radius: 8, color: "#ffd090", intensity: 1 },
    draw: (c) => {
      c.strokeStyle = GOLD; c.lineWidth = 0.035; circle(c, 0, 0, 0.6); c.stroke(); circle(c, 0, 0, 0.25); c.stroke();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const x = Math.cos(a) * 0.6; const y = Math.sin(a) * 0.6; c.beginPath(); c.moveTo(Math.cos(a) * 0.25, Math.sin(a) * 0.25); c.lineTo(x, y); c.stroke(); circle(c, x, y, 0.05); fo(c, "#efe6cc", 0.012); flame(c, x, y, 0.035); }
    },
  },
  {
    id: "lantern", name: "Lantern", category: "Light", w: 0.5, h: 0.5, layer: "object",
    light: { radius: 5, color: "#ffc27a", intensity: 0.9 },
    draw: (c) => { glow(c, 0, 0, 0.24, "255,200,110", 0.5); rr(c, -0.12, -0.12, 0.24, 0.24, 0.04); fo(c, "rgba(255,220,140,0.85)", 0.025); c.strokeStyle = IRON_D; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0, -0.12); c.lineTo(0, 0.12); c.moveTo(-0.12, 0); c.lineTo(0.12, 0); c.stroke(); },
  },
  {
    id: "fireplace", name: "Fireplace", category: "Light", w: 2, h: 1, layer: "object",
    light: { radius: 7, color: "#ff9a4a", intensity: 1 },
    draw: (c) => {
      block(c, -0.95, -0.45, 1.9, 0.9, "#8a867e", "#5a5650");
      rr(c, -0.55, -0.3, 1.1, 0.6, 0.06); fo(c, "#1a1410", 0.02);
      c.strokeStyle = "#4a3020"; c.lineWidth = 0.08; c.lineCap = "round"; c.beginPath(); c.moveTo(-0.35, 0.12); c.lineTo(0.35, 0.02); c.moveTo(-0.3, -0.05); c.lineTo(0.3, 0.12); c.stroke();
      flame(c, 0, 0, 0.18);
    },
  },
  {
    id: "magic-orb", name: "Magic orb", category: "Light", w: 0.8, h: 0.8, layer: "object",
    light: { radius: 6, color: "#7ab0ff", intensity: 0.9 },
    draw: (c) => { glow(c, 0, 0, 0.38, "120,170,255", 0.6); block(c, -0.2, -0.2, 0.4, 0.4, "#7a766e", "#4a4640"); circle(c, 0, 0, 0.14); fo(c, radial(c, -0.04, -0.04, 0.16, "#ffffff", "#3a6ad8"), 0.015); },
  },
  {
    id: "glowing-crystals", name: "Glowing crystals", category: "Light", w: 1, h: 1, layer: "object",
    light: { radius: 5, color: "#c87aff", intensity: 0.8 },
    draw: (c) => {
      glow(c, 0, 0, 0.48, "200,120,255", 0.4);
      for (const [x, y, a, l] of [[-0.12, 0.08, -0.5, 0.3], [0.1, 0.05, 0.4, 0.34], [0, -0.05, 0, 0.4], [0.2, 0.18, 0.9, 0.2]]) { c.save(); c.translate(x, y); c.rotate(a); poly(c, [0, -l, 0.07, -l * 0.7, 0.07, 0, -0.07, 0, -0.07, -l * 0.7]); fo(c, linear(c, -0.07, -l, 0.07, 0, "#f4dcff", "#8a3ad8"), 0.015); c.restore(); }
    },
  },
  {
    id: "street-lamp", name: "Street lamp", category: "Light", w: 0.8, h: 0.8, layer: "canopy",
    light: { radius: 7, color: "#ffd8a0", intensity: 0.9 },
    draw: (c) => { glow(c, 0, 0, 0.38, "255,220,150", 0.45); poly(c, [-0.2, 0, 0, -0.2, 0.2, 0, 0, 0.2]); fo(c, "#2a2a30", 0.02); circle(c, 0, 0, 0.09); fo(c, "#fff0c0", 0.012); },
  },
  {
    id: "bonfire", name: "Bonfire", category: "Light", w: 2, h: 2, layer: "object",
    light: { radius: 12, color: "#ff8a3a", intensity: 1 },
    draw: (c) => {
      c.strokeStyle = "#3a2618"; c.lineCap = "round"; c.lineWidth = 0.12;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.beginPath(); c.moveTo(Math.cos(a) * 0.75, Math.sin(a) * 0.75); c.lineTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1); c.stroke(); }
      flame(c, 0, 0, 0.42);
      flameProp(0.18, 0.12, 0.2)(c);
      flameProp(-0.2, 0.05, 0.18)(c);
    },
  },
];

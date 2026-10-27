// Copied from Dungeon (src/render/props.ts) by scripts/sync-dungeon-library.mjs, Dungeon c3dcca5. Change it there and run the script again.
// Built-in props, drawn in code. Each draws itself centred on (0, 0) in cell units inside a
// w-by-h box; sprites are cached at SPRITE_PX pixels per cell.

import { rng } from "./noise";
import { OUT, LW, outline, rr, circle, radial, linear, board, flame, canopy, rockShape, type PropDef } from "./propkit";
import { MORE_PROPS } from "./props-more";
import { LIBRARY_PROPS } from "./library";

export type { PropDef } from "./propkit";

const BASE_PROPS: PropDef[] = [
  {
    id: "table", name: "Table", category: "Furniture", w: 2, h: 1, layer: "object",
    draw: (c) => {
      board(c, -1, -0.5, 2, 0.34, "#9a6a3e", "#7a5030", 1);
      board(c, -1, -0.16, 2, 0.33, "#946438", "#744a2c", 2);
      board(c, -1, 0.17, 2, 0.33, "#9a6a3e", "#7a5030", 3);
    },
  },
  {
    id: "round-table", name: "Round table", category: "Furniture", w: 1.4, h: 1.4, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 0.68);
      c.fillStyle = radial(c, 0, 0, 0.68, "#a8774a", "#6e4628");
      c.fill();
      outline(c);
      c.strokeStyle = "rgba(40,24,12,0.35)";
      c.lineWidth = 0.015;
      circle(c, 0, 0, 0.5);
      c.stroke();
    },
  },
  {
    id: "chair", name: "Chair", category: "Furniture", w: 0.6, h: 0.6, layer: "object",
    draw: (c) => {
      board(c, -0.26, -0.22, 0.52, 0.48, "#9a6a3e", "#6e4628", 4);
      board(c, -0.3, -0.3, 0.6, 0.12, "#7a5030", "#5a3820", 5);
    },
  },
  {
    id: "bench", name: "Bench", category: "Furniture", w: 2, h: 0.5, layer: "object",
    draw: (c) => board(c, -1, -0.22, 2, 0.44, "#9a6a3e", "#6e4628", 6),
  },
  {
    id: "bed", name: "Bed", category: "Furniture", w: 1.1, h: 2, layer: "object",
    draw: (c) => {
      board(c, -0.55, -1, 1.1, 2, "#7a5030", "#5a3820", 7);
      rr(c, -0.47, -0.92, 0.94, 1.84, 0.06);
      c.fillStyle = "#e8e0cc";
      c.fill();
      outline(c, 0.02);
      rr(c, -0.38, -0.85, 0.76, 0.32, 0.1);
      c.fillStyle = linear(c, 0, -0.85, 0, -0.53, "#fffaf0", "#d8d0bc");
      c.fill();
      outline(c, 0.02);
      rr(c, -0.47, -0.3, 0.94, 1.22, 0.06);
      c.fillStyle = linear(c, 0, -0.3, 0, 0.92, "#3d5a8a", "#2a3f66");
      c.fill();
      outline(c, 0.02);
      c.strokeStyle = "rgba(255,255,255,0.18)";
      c.lineWidth = 0.02;
      c.beginPath();
      c.moveTo(-0.47, -0.2);
      c.lineTo(0.47, -0.2);
      c.stroke();
    },
  },
  {
    id: "bookshelf", name: "Bookshelf", category: "Furniture", w: 2, h: 0.5, layer: "object",
    draw: (c) => {
      board(c, -1, -0.25, 2, 0.5, "#6e4628", "#4a2e1a", 8);
      const r = rng(9);
      const colors = ["#7a2a2a", "#2a4a7a", "#2f6a3a", "#7a6a2a", "#5a2a6a", "#8a5a2a"];
      let x = -0.92;
      while (x < 0.9) {
        const w = 0.06 + r() * 0.07;
        if (x + w > 0.92) break;
        c.fillStyle = colors[Math.floor(r() * colors.length)];
        c.fillRect(x, -0.17 + r() * 0.04, w - 0.012, 0.32 - r() * 0.06);
        x += w;
      }
    },
  },
  {
    id: "rug", name: "Rug", category: "Furniture", w: 2, h: 3, layer: "floor",
    draw: (c) => {
      rr(c, -1, -1.5, 2, 3, 0.05);
      c.fillStyle = "#7a2228";
      c.fill();
      c.strokeStyle = "#c9a24a";
      c.lineWidth = 0.08;
      rr(c, -0.82, -1.32, 1.64, 2.64, 0.04);
      c.stroke();
      c.strokeStyle = "#3a1416";
      c.lineWidth = 0.04;
      rr(c, -0.66, -1.16, 1.32, 2.32, 0.03);
      c.stroke();
      c.fillStyle = "#c9a24a";
      c.beginPath();
      c.moveTo(0, -0.6);
      c.lineTo(0.4, 0);
      c.lineTo(0, 0.6);
      c.lineTo(-0.4, 0);
      c.closePath();
      c.fill();
      c.strokeStyle = "#e8dcc0";
      c.lineWidth = 0.02;
      for (let x = -0.95; x <= 0.95; x += 0.1) {
        c.beginPath();
        c.moveTo(x, -1.5);
        c.lineTo(x, -1.58);
        c.moveTo(x, 1.5);
        c.lineTo(x, 1.58);
        c.stroke();
      }
    },
  },
  {
    id: "barrel", name: "Barrel", category: "Containers", w: 0.8, h: 0.8, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 0.38);
      c.fillStyle = radial(c, 0, 0, 0.38, "#a87444", "#5e3a1e");
      c.fill();
      outline(c);
      c.strokeStyle = "rgba(40,24,12,0.5)";
      c.lineWidth = 0.015;
      for (let i = -2; i <= 2; i++) {
        c.beginPath();
        c.moveTo(i * 0.11, -0.3);
        c.lineTo(i * 0.11, 0.3);
        c.stroke();
      }
      c.strokeStyle = "#3a3a3e";
      c.lineWidth = 0.035;
      circle(c, 0, 0, 0.3);
      c.stroke();
      circle(c, 0, 0, 0.365);
      c.stroke();
    },
  },
  {
    id: "crate", name: "Crate", category: "Containers", w: 0.9, h: 0.9, layer: "object",
    draw: (c) => {
      board(c, -0.43, -0.43, 0.86, 0.86, "#b08452", "#80582e", 10);
      c.strokeStyle = "#6a4422";
      c.lineWidth = 0.08;
      c.beginPath();
      c.moveTo(-0.36, -0.36);
      c.lineTo(0.36, 0.36);
      c.stroke();
      rr(c, -0.38, -0.38, 0.76, 0.76, 0.02);
      c.lineWidth = 0.06;
      c.stroke();
      rr(c, -0.43, -0.43, 0.86, 0.86, 0.04);
      outline(c);
    },
  },
  {
    id: "chest", name: "Chest", category: "Containers", w: 1, h: 0.7, layer: "object",
    draw: (c) => {
      board(c, -0.48, -0.32, 0.96, 0.64, "#8a5a30", "#5a3820", 11);
      c.fillStyle = "#8c8c94";
      for (const x of [-0.36, 0.3]) {
        c.fillRect(x, -0.32, 0.07, 0.64);
        c.strokeStyle = OUT;
        c.lineWidth = 0.015;
        c.strokeRect(x, -0.32, 0.07, 0.64);
      }
      rr(c, -0.07, 0.12, 0.14, 0.14, 0.02);
      c.fillStyle = "#d4b04a";
      c.fill();
      outline(c, 0.015);
    },
  },
  {
    id: "sack", name: "Sack", category: "Containers", w: 0.6, h: 0.6, layer: "object",
    draw: (c) => {
      c.beginPath();
      c.ellipse(0, 0.04, 0.27, 0.24, 0, 0, Math.PI * 2);
      c.fillStyle = radial(c, 0, 0, 0.3, "#d8c294", "#9a8256");
      c.fill();
      outline(c);
      c.beginPath();
      c.ellipse(0, -0.2, 0.08, 0.06, 0, 0, Math.PI * 2);
      c.fillStyle = "#8a7246";
      c.fill();
      outline(c, 0.02);
    },
  },
  {
    id: "tree", name: "Tree", category: "Nature", w: 2.6, h: 2.6, layer: "canopy",
    draw: (c) => canopy(c, 1.15, 21, "#1f3a18", "#2f5a24", "#5f8e3c"),
  },
  {
    id: "pine", name: "Pine tree", category: "Nature", w: 2, h: 2, layer: "canopy",
    draw: (c) => {
      for (let i = 0; i < 3; i++) {
        const r = 0.95 - i * 0.28;
        c.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rad = k % 2 ? r * 0.72 : r;
          k ? c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad) : c.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        c.closePath();
        c.fillStyle = radial(c, 0, 0, r, i === 2 ? "#4f7a3a" : "#2e5428", "#1a3418");
        c.fill();
        outline(c, 0.025);
      }
    },
  },
  {
    id: "bush", name: "Bush", category: "Nature", w: 1, h: 1, layer: "object",
    draw: (c) => canopy(c, 0.42, 22, "#203c1a", "#355e28", "#6a9a44"),
  },
  { id: "rock", name: "Rock", category: "Nature", w: 0.9, h: 0.9, layer: "object", draw: (c) => rockShape(c, 0.42, 0.36, 23) },
  { id: "boulder", name: "Boulder", category: "Nature", w: 1.8, h: 1.8, layer: "object", draw: (c) => rockShape(c, 0.86, 0.74, 24) },
  {
    id: "log", name: "Log", category: "Nature", w: 1.8, h: 0.5, layer: "object",
    draw: (c) => {
      rr(c, -0.85, -0.2, 1.7, 0.4, 0.2);
      c.fillStyle = linear(c, 0, -0.2, 0, 0.2, "#8a6040", "#4a3020");
      c.fill();
      outline(c);
      c.beginPath();
      c.ellipse(0.75, 0, 0.09, 0.19, 0, 0, Math.PI * 2);
      c.fillStyle = "#c8a070";
      c.fill();
      outline(c, 0.02);
    },
  },
  {
    id: "pillar", name: "Pillar", category: "Dungeon", w: 1, h: 1, layer: "object",
    draw: (c) => {
      rr(c, -0.46, -0.46, 0.92, 0.92, 0.06);
      c.fillStyle = "#6e6a64";
      c.fill();
      outline(c);
      circle(c, 0, 0, 0.36);
      c.fillStyle = radial(c, 0, 0, 0.36, "#b8b4ac", "#7a766e");
      c.fill();
      outline(c);
    },
  },
  {
    id: "statue", name: "Statue", category: "Dungeon", w: 1, h: 1, layer: "object",
    draw: (c) => {
      rr(c, -0.46, -0.46, 0.92, 0.92, 0.04);
      c.fillStyle = "#77736c";
      c.fill();
      outline(c);
      c.fillStyle = radial(c, 0, 0, 0.3, "#d8d4ca", "#8e8a82");
      c.beginPath();
      c.ellipse(0, 0.05, 0.3, 0.18, 0, 0, Math.PI * 2);
      c.fill();
      outline(c, 0.025);
      circle(c, 0, -0.08, 0.13);
      c.fill();
      outline(c, 0.025);
    },
  },
  {
    id: "altar", name: "Altar", category: "Dungeon", w: 2, h: 1, layer: "object",
    draw: (c) => {
      rr(c, -0.95, -0.45, 1.9, 0.9, 0.05);
      c.fillStyle = linear(c, 0, -0.45, 0, 0.45, "#a8a49c", "#6e6a64");
      c.fill();
      outline(c);
      c.fillStyle = "#6a1a24";
      c.fillRect(-0.3, -0.45, 0.6, 0.9);
      c.fillStyle = "#c9a24a";
      c.fillRect(-0.3, -0.45, 0.6, 0.05);
      c.fillRect(-0.3, 0.4, 0.6, 0.05);
    },
  },
  {
    id: "coffin", name: "Coffin", category: "Dungeon", w: 0.8, h: 2, layer: "object",
    draw: (c) => {
      c.beginPath();
      c.moveTo(0, -0.95);
      c.lineTo(0.3, -0.65);
      c.lineTo(0.36, -0.4);
      c.lineTo(0.22, 0.95);
      c.lineTo(-0.22, 0.95);
      c.lineTo(-0.36, -0.4);
      c.lineTo(-0.3, -0.65);
      c.closePath();
      c.fillStyle = linear(c, -0.36, 0, 0.36, 0, "#5a3820", "#7a5030");
      c.fill();
      outline(c);
      c.strokeStyle = "#c9a24a";
      c.lineWidth = 0.04;
      c.beginPath();
      c.moveTo(0, -0.5);
      c.lineTo(0, 0.2);
      c.moveTo(-0.15, -0.3);
      c.lineTo(0.15, -0.3);
      c.stroke();
    },
  },
  {
    id: "well", name: "Well", category: "Dungeon", w: 1.4, h: 1.4, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 0.66);
      c.fillStyle = "#7a766e";
      c.fill();
      outline(c);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        c.beginPath();
        c.moveTo(Math.cos(a) * 0.44, Math.sin(a) * 0.44);
        c.lineTo(Math.cos(a) * 0.66, Math.sin(a) * 0.66);
        c.strokeStyle = "#3a3632";
        c.lineWidth = 0.02;
        c.stroke();
      }
      circle(c, 0, 0, 0.44);
      c.fillStyle = radial(c, 0, 0, 0.44, "#2a5a7a", "#0a1a26");
      c.fill();
      outline(c);
    },
  },
  {
    id: "stairs", name: "Stairs", category: "Dungeon", w: 1, h: 2, layer: "floor",
    draw: (c) => {
      for (let i = 0; i < 8; i++) {
        const y = -1 + i * 0.25;
        c.fillStyle = `rgb(${150 - i * 12},${146 - i * 12},${138 - i * 12})`;
        c.fillRect(-0.5, y, 1, 0.25);
        c.strokeStyle = "rgba(0,0,0,0.5)";
        c.lineWidth = 0.02;
        c.strokeRect(-0.5, y, 1, 0.25);
      }
      rr(c, -0.5, -1, 1, 2, 0.01);
      outline(c);
    },
  },
  {
    id: "cauldron", name: "Cauldron", category: "Dungeon", w: 0.9, h: 0.9, layer: "object",
    draw: (c) => {
      circle(c, 0, 0, 0.42);
      c.fillStyle = radial(c, 0, 0, 0.42, "#4a4a50", "#151518");
      c.fill();
      outline(c);
      circle(c, 0, 0, 0.32);
      c.fillStyle = radial(c, 0, 0, 0.32, "#9aff6a", "#2a7a20");
      c.fill();
      c.fillStyle = "rgba(220,255,200,0.7)";
      for (const [x, y, r] of [[0.08, -0.05, 0.05], [-0.1, 0.08, 0.035], [0.02, 0.14, 0.03]]) {
        circle(c, x, y, r);
        c.fill();
      }
    },
  },
  {
    id: "anvil", name: "Anvil", category: "Dungeon", w: 0.9, h: 0.5, layer: "object",
    draw: (c) => {
      c.beginPath();
      c.moveTo(-0.44, -0.08);
      c.quadraticCurveTo(-0.3, -0.2, -0.18, -0.2);
      c.lineTo(0.42, -0.2);
      c.lineTo(0.42, 0.2);
      c.lineTo(-0.18, 0.2);
      c.quadraticCurveTo(-0.3, 0.2, -0.44, 0.08);
      c.closePath();
      c.fillStyle = linear(c, 0, -0.2, 0, 0.2, "#8a8a92", "#3a3a40");
      c.fill();
      outline(c);
    },
  },
  {
    id: "bones", name: "Bones", category: "Dungeon", w: 0.8, h: 0.8, layer: "floor",
    draw: (c) => {
      const bone = (x: number, y: number, a: number, len: number) => {
        c.save();
        c.translate(x, y);
        c.rotate(a);
        c.fillStyle = "#e6dcc4";
        c.fillRect(-len / 2, -0.025, len, 0.05);
        for (const s of [-1, 1]) {
          circle(c, (s * len) / 2, -0.03, 0.035);
          c.fill();
          circle(c, (s * len) / 2, 0.03, 0.035);
          c.fill();
        }
        c.restore();
      };
      bone(-0.1, 0.1, 0.6, 0.45);
      bone(0.12, -0.05, -0.9, 0.38);
      circle(c, 0.15, 0.2, 0.11);
      c.fillStyle = "#ece2ca";
      c.fill();
      outline(c, 0.02);
      c.fillStyle = "#2a2420";
      circle(c, 0.11, 0.18, 0.025);
      c.fill();
      circle(c, 0.19, 0.18, 0.025);
      c.fill();
    },
  },
  {
    id: "torch", name: "Wall torch", category: "Light", w: 0.5, h: 0.5, layer: "object",
    light: { radius: 6, color: "#ffb46a", intensity: 1 },
    draw: (c) => {
      rr(c, -0.06, 0.02, 0.12, 0.2, 0.02);
      c.fillStyle = "#5a3820";
      c.fill();
      outline(c, 0.02);
      flame(c, 0, -0.04, 0.09);
    },
  },
  {
    id: "brazier", name: "Brazier", category: "Light", w: 0.9, h: 0.9, layer: "object",
    light: { radius: 8, color: "#ffa050", intensity: 1 },
    draw: (c) => {
      circle(c, 0, 0, 0.4);
      c.fillStyle = radial(c, 0, 0, 0.4, "#6a6a70", "#26262a");
      c.fill();
      outline(c);
      circle(c, 0, 0, 0.3);
      c.fillStyle = radial(c, 0, 0, 0.3, "#ffdd66", "#a02a08");
      c.fill();
      flame(c, 0, 0, 0.16);
    },
  },
  {
    id: "campfire", name: "Campfire", category: "Light", w: 1.2, h: 1.2, layer: "object",
    light: { radius: 9, color: "#ff9a4a", intensity: 1 },
    draw: (c) => {
      const r = rng(31);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        c.save();
        c.translate(Math.cos(a) * 0.46, Math.sin(a) * 0.46);
        rockShape(c, 0.11 + r() * 0.03, 0.09 + r() * 0.03, 40 + i);
        c.restore();
      }
      c.strokeStyle = "#4a3020";
      c.lineCap = "round";
      c.lineWidth = 0.1;
      for (const a of [0.4, 1.9, 3.3]) {
        c.beginPath();
        c.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3);
        c.lineTo(-Math.cos(a) * 0.15, -Math.sin(a) * 0.15);
        c.stroke();
      }
      flame(c, 0, 0, 0.2);
    },
  },
  {
    id: "candles", name: "Candles", category: "Light", w: 0.5, h: 0.5, layer: "object",
    light: { radius: 3, color: "#ffd090", intensity: 0.8 },
    draw: (c) => {
      for (const [x, y] of [[-0.1, 0.06], [0.1, 0.08], [0, -0.1]]) {
        circle(c, x, y, 0.055);
        c.fillStyle = "#efe6cc";
        c.fill();
        outline(c, 0.015);
        flame(c, x, y - 0.01, 0.035);
      }
    },
  },
];

/** The group each of the first 135 objects folds under in the pickers. */
const FIRST_GROUPS: Record<string, string> = {
  ...Object.fromEntries(["table","round-table","small-table","dining-table","long-table","chess-table"].map((id) => [id, "Tables"])),
  ...Object.fromEntries(["chair","bench","stool","armchair","throne","cushions"].map((id) => [id, "Seating"])),
  ...Object.fromEntries(["bed","double-bed","straw-bed"].map((id) => [id, "Beds"])),
  ...Object.fromEntries(["bookshelf","wardrobe","dresser","scroll-rack"].map((id) => [id, "Storage"])),
  ...Object.fromEntries(["rug","rug-blue","rug-round","fur-rug"].map((id) => [id, "Rugs"])),
  ...Object.fromEntries(["bathtub","washbasin"].map((id) => [id, "Bath and wash"])),
  ...Object.fromEntries(["desk","lectern"].map((id) => [id, "Desks and lecterns"])),
  ...Object.fromEntries(["folding-screen"].map((id) => [id, "Screens and decor"])),
  ...Object.fromEntries(["barrel","barrel-lying","barrels"].map((id) => [id, "Barrels"])),
  ...Object.fromEntries(["crate","crate-small","crates"].map((id) => [id, "Crates"])),
  ...Object.fromEntries(["chest","chest-open","strongbox"].map((id) => [id, "Chests and strongboxes"])),
  ...Object.fromEntries(["sack","sacks","basket","bucket"].map((id) => [id, "Sacks, baskets and buckets"])),
  ...Object.fromEntries(["urn","pots"].map((id) => [id, "Pots, jars and urns"])),
  ...Object.fromEntries(["treasure"].map((id) => [id, "Treasure"])),
  ...Object.fromEntries(["tree","oak-tree","birch-tree","willow-tree"].map((id) => [id, "Leafy trees"])),
  ...Object.fromEntries(["pine","fir-tree"].map((id) => [id, "Evergreens"])),
  ...Object.fromEntries(["dead-tree","stump","log","fallen-branch"].map((id) => [id, "Bare and fallen wood"])),
  ...Object.fromEntries(["bush","flower-bush","hedge","fern"].map((id) => [id, "Bushes and hedges"])),
  ...Object.fromEntries(["grass-tuft","flowers-red","flowers-yellow","flowers-purple"].map((id) => [id, "Flowers and grass"])),
  ...Object.fromEntries(["rock","boulder","rocks","rubble"].map((id) => [id, "Rocks"])),
  ...Object.fromEntries(["reeds","lily-pads"].map((id) => [id, "Water plants"])),
  ...Object.fromEntries(["mushrooms"].map((id) => [id, "Mushrooms"])),
  ...Object.fromEntries(["snowdrift"].map((id) => [id, "Snow and ice"])),
  ...Object.fromEntries(["pillar","statue","pillar-square","pillar-broken","obelisk","idol"].map((id) => [id, "Pillars and statues"])),
  ...Object.fromEntries(["coffin","sarcophagus","bones","skulls"].map((id) => [id, "Tombs and bones"])),
  ...Object.fromEntries(["stairs","stairs-spiral","trapdoor","pit","drain"].map((id) => [id, "Stairs and ways down"])),
  ...Object.fromEntries(["cage","chains"].map((id) => [id, "Prison and torture"])),
  ...Object.fromEntries(["lever"].map((id) => [id, "Levers and mechanisms"])),
  ...Object.fromEntries(["spider-web"].map((id) => [id, "Lairs"])),
  ...Object.fromEntries(["debris"].map((id) => [id, "Stains and floor"])),
  ...Object.fromEntries(["altar","cauldron","magic-circle","arcane-portal"].map((id) => [id, "Magic"])),
  ...Object.fromEntries(["well","fountain"].map((id) => [id, "Wells and fountains"])),
  ...Object.fromEntries(["anvil","forge","weapon-rack","armor-stand"].map((id) => [id, "Arms and the forge"])),
  ...Object.fromEntries(["torch","standing-torch"].map((id) => [id, "Torches"])),
  ...Object.fromEntries(["brazier","campfire","bonfire","fireplace"].map((id) => [id, "Fires"])),
  ...Object.fromEntries(["candles","candelabra","chandelier"].map((id) => [id, "Candles"])),
  ...Object.fromEntries(["lantern","street-lamp"].map((id) => [id, "Sconces and lamps"])),
  ...Object.fromEntries(["magic-orb","glowing-crystals"].map((id) => [id, "Magic light"])),
  ...Object.fromEntries(["bar-counter","keg","tankards","wine-rack"].map((id) => [id, "The bar"])),
  ...Object.fromEntries(["oven","kitchen-counter","cookware","spit-roast"].map((id) => [id, "The kitchen"])),
  ...Object.fromEntries(["food-platter","cheese-wheel"].map((id) => [id, "Food"])),
  ...Object.fromEntries(["tent","bedroll","log-pile","haystack","scarecrow"].map((id) => [id, "Camp"])),
  ...Object.fromEntries(["wagon","cart"].map((id) => [id, "Wagons and carts"])),
  ...Object.fromEntries(["fence"].map((id) => [id, "Fences and gates"])),
  ...Object.fromEntries(["signpost"].map((id) => [id, "Signs and banners"])),
  ...Object.fromEntries(["market-stall"].map((id) => [id, "Market"])),
  ...Object.fromEntries(["archery-target"].map((id) => [id, "Games and training"])),
  ...Object.fromEntries(["rowboat"].map((id) => [id, "Boats and bridges"])),
};

/**
 * Every built-in prop: the first set, the larger library of 26 October 2026, then the big
 * library of 27 October (designs in variants, one file per category).
 */
export const PROPS: PropDef[] = [
  ...[...BASE_PROPS, ...MORE_PROPS].map((p) => ({ ...p, group: p.group ?? FIRST_GROUPS[p.id] ?? "More" })),
  ...LIBRARY_PROPS,
];

const byId = new Map(PROPS.map((p) => [p.id, p]));

export function prop(id: string): PropDef | undefined {
  return byId.get(id);
}

/** Sprite resolution, in pixels per cell. */
export const SPRITE_PX = 128;

/** Where a prop's picture sits in the sprite sheet. */
export interface SpriteRef {
  img: HTMLCanvasElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const PAGE = 2048;
const PAD = 2;

interface Page {
  img: HTMLCanvasElement;
  c: CanvasRenderingContext2D;
  /** Where the next picture goes: along the current row, then a new row below. */
  x: number;
  y: number;
  rowH: number;
}

const pages: Page[] = [];
const sprites = new Map<string, SpriteRef>();

/**
 * Props are drawn into a few large sheets. Browsers keep a big canvas on the GPU, but upload a
 * small one again every time it's drawn: 50 props from separate small canvases took about
 * 350 ms a frame, from one sheet about 8 ms. With about 2,000 props a single sheet would be far
 * too tall, so each prop is drawn into a 2048-pixel page the first time it's needed, and a
 * new page starts when one fills.
 */
function place(w: number, h: number): { page: Page; x: number; y: number } {
  let page = pages[pages.length - 1];
  if (page && page.x + w > PAGE) {
    page.x = 0;
    page.y += page.rowH + PAD;
    page.rowH = 0;
  }
  if (!page || page.y + h > PAGE) {
    const img = document.createElement("canvas");
    img.width = PAGE;
    img.height = PAGE;
    page = { img, c: img.getContext("2d")!, x: 0, y: 0, rowH: 0 };
    pages.push(page);
  }
  const at = { page, x: page.x, y: page.y };
  page.x += w + PAD;
  page.rowH = Math.max(page.rowH, h);
  return at;
}

function drawSprite(d: PropDef): SpriteRef {
  // A prop longer than a page is drawn at fewer pixels per cell; it's stretched back when drawn.
  const px = Math.min(SPRITE_PX, PAGE / Math.max(d.w, d.h));
  const w = Math.ceil(d.w * px);
  const h = Math.ceil(d.h * px);
  const { page, x, y } = place(w, h);
  const c = page.c;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.translate(x + w / 2, y + h / 2);
  c.scale(px, px);
  d.draw(c);
  c.restore();
  return { img: page.img, sx: x, sy: y, sw: w, sh: h };
}

/** A prop's picture inside a shared sprite sheet: drawn the first time it's asked for. */
export function propSprite(def: PropDef): SpriteRef {
  let s = sprites.get(def.id);
  if (!s) sprites.set(def.id, (s = drawSprite(def)));
  return s;
}

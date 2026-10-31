// Copied from Dungeon (src/render/props-nature.ts) by scripts/sync-dungeon-library.mjs, Dungeon 9bae40f. Change it there and run the script again.
import { rng } from "./noise";
import { radial, linear, canopy } from "./propkit";
import { cross, vary, family, shade, ell, poly, fo, disc, stroke, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";

// Nature for the big library. Every id names what grows or lies there (oak-tree, pine-tree,
// stump, fallen-branch, flower-bush, reeds, rock, snowdrift...), because table.parhome.ca's
// Seasons give an object its seasonal look by those words (see its dd/roles.ts).

const N = "Nature" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });

type Size = Variant & { r: number };
const TREE_SIZES: Size[] = [
  { key: "small", name: "small", r: 0.8 },
  { key: "medium", name: "medium", r: 1.2 },
  { key: "large", name: "large", r: 1.7 },
];
const TREE_SHAPES = [vary("rounded"), vary("spreading")];

interface Species {
  id: string;
  name: string;
  /** Dark, mid and light greens. */
  greens: [string, string, string];
  /** Fruit or seed dots. */
  dots?: string;
  /** Narrower and taller than wide. */
  tall?: boolean;
}

const LEAFY: Species[] = [
  { id: "oak-tree", name: "Oak tree", greens: ["#2f5a24", "#3e7a2e", "#6aa24a"] },
  { id: "maple-tree", name: "Maple tree", greens: ["#3a6a22", "#4e8e30", "#86c25a"] },
  { id: "birch-tree", name: "Birch tree", greens: ["#4a7a2a", "#6aa040", "#a8d070"] },
  { id: "elm-tree", name: "Elm tree", greens: ["#2a5a2a", "#3a7a3a", "#62a85a"] },
  { id: "beech-tree", name: "Beech tree", greens: ["#4a6a1e", "#6a9030", "#a8c860"] },
  { id: "apple-tree", name: "Apple tree", greens: ["#2f5a24", "#427e30", "#72aa50"], dots: "#d83a2a" },
  { id: "cherry-tree", name: "Cherry tree", greens: ["#34602a", "#4a8436", "#7ab45a"], dots: "#8a1a2a" },
  { id: "chestnut-tree", name: "Chestnut tree", greens: ["#2e5420", "#447a2c", "#78aa52"] },
  { id: "linden-tree", name: "Linden tree", greens: ["#3e6e28", "#56963a", "#90c868"] },
  { id: "poplar-tree", name: "Poplar tree", greens: ["#3a6a2a", "#4e8a36", "#88bc5e"], tall: true },
  { id: "aspen-tree", name: "Aspen tree", greens: ["#5a8a2a", "#7aaa3a", "#b8d870"], tall: true },
  { id: "willow-tree", name: "Weeping willow tree", greens: ["#5a7a2a", "#7a9a3a", "#a8c060"] },
];

function leafy(c: C, s: Species, r: number, spreading: boolean, seed: number): void {
  c.save();
  if (s.tall) c.scale(0.72, 1.12);
  else if (spreading) c.scale(1.12, 0.9);
  canopy(c, r, seed, s.greens[0], s.greens[1], s.greens[2]);
  if (s.id === "willow-tree") {
    const rand = rng(seed);
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * (0.3 + rand() * 0.6);
      stroke(c, [Math.cos(a) * d, Math.sin(a) * d, Math.cos(a) * (d + r * 0.25), Math.sin(a) * (d + r * 0.25)], 0.03, "rgba(170,200,100,0.6)");
    }
  }
  c.restore();
  if (s.dots) for (const [x, y] of scatter(Math.round(r * 14), r * 0.75, seed + 5)) disc(c, x, y, 0.05, tone(shade(s.dots, 0.35), s.dots), 0.008);
}

const leafyTrees: PropDef[] = LEAFY.flatMap((s, i) =>
  family({ id: s.id, name: s.name, category: N, group: "Leafy trees", w: 2, h: 2, layer: "canopy" }, cross(TREE_SIZES, TREE_SHAPES), (c, v) => leafy(c, s, v.a.r, v.b.key === "spreading", 300 + i * 17 + v.a.r * 10), {
    size: (v) => [v.a.r * 2.3, v.a.r * 2.3],
  }),
);

/** A star outline: `n` points between radius `r` and `r * dip`. */
function star(c: C, n: number, r: number, dip: number, rot: number): void {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const d = i % 2 ? r * dip : r;
    i ? c.lineTo(Math.cos(a) * d, Math.sin(a) * d) : c.moveTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  c.closePath();
}

function conifer(c: C, r: number, greens: [string, string, string], points: number, layers: number, sx = 1): void {
  c.save();
  c.scale(sx, 1);
  for (let i = 0; i < layers; i++) {
    const k = 1 - (i / layers) * 0.78;
    star(c, points, r * k, 0.68, i * 0.37);
    fo(c, radial(c, 0, 0, r * k, i % 2 ? greens[2] : greens[1], greens[0]), 0.02);
  }
  c.restore();
}

const EVERGREEN: Species[] = [
  { id: "pine-tree", name: "Pine tree", greens: ["#1e4a2a", "#2e6a3a", "#4e8a52"] },
  { id: "fir-tree", name: "Fir tree", greens: ["#183e2c", "#265a3e", "#3e7a56"] },
  { id: "spruce-tree", name: "Spruce tree", greens: ["#1a3a34", "#2a5650", "#44786c"] },
  { id: "cedar-tree", name: "Cedar tree", greens: ["#2a4a22", "#3e6a30", "#62904a"] },
  { id: "cypress-tree", name: "Cypress tree", greens: ["#1e3e22", "#2e5a30", "#4a7e48"], tall: true },
  { id: "yew-tree", name: "Yew tree", greens: ["#18301c", "#26462a", "#3e6640"] },
  { id: "juniper-tree", name: "Juniper tree", greens: ["#2e4a3a", "#426a52", "#6a9478"] },
];

const evergreens: PropDef[] = [
  ...EVERGREEN.flatMap((s, i) =>
    family({ id: s.id, name: s.name, category: N, group: "Evergreens", w: 2, h: 2, layer: "canopy" }, TREE_SIZES, (c, v) => {
      if (s.id === "yew-tree" || s.id === "juniper-tree") canopy(c, v.r * 0.9, 400 + i * 13, s.greens[0], s.greens[1], s.greens[2]);
      else conifer(c, v.r, s.greens, s.id === "spruce-tree" ? 12 : 9, 4, s.tall ? 0.55 : 1);
    }, { size: (v) => [v.r * 2.2, v.r * 2.2] }),
  ),
  ...family({ id: "palm-tree", name: "Palm tree", category: N, group: "Evergreens", w: 2.4, h: 2.4, layer: "canopy" }, TREE_SIZES, (c, v) => {
    const fronds = 8;
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + 0.2;
      c.save();
      c.rotate(a);
      ell(c, v.r * 0.48, 0, v.r * 0.5, v.r * 0.13);
      fo(c, linear(c, 0, 0, v.r, 0, "#6aaa3a", "#2a6a22"), 0.02);
      stroke(c, [0.05, 0, v.r * 0.92, 0], 0.02, "rgba(30,60,20,0.6)");
      c.restore();
    }
    disc(c, 0, 0, v.r * 0.1, tone("#b08a4a", "#6a4a22"));
  }, { size: (v) => [v.r * 2.1, v.r * 2.1] }),
];

/** Bare branches spreading from a middle, for dead trees. */
function branches(c: C, r: number, seed: number, color: string): void {
  const rand = rng(seed);
  const limb = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    const x2 = x + Math.cos(a) * len;
    const y2 = y + Math.sin(a) * len;
    stroke(c, [x, y, x2, y2], w, color);
    if (depth > 0) for (const turn of [-0.45, 0.4]) limb(x2, y2, a + turn + (rand() - 0.5) * 0.4, len * 0.62, w * 0.62, depth - 1);
  };
  for (let i = 0; i < 6; i++) limb(0, 0, (i / 6) * Math.PI * 2 + rand(), r * 0.45, 0.07, 3);
  disc(c, 0, 0, r * 0.12, tone(shade(color, 0.25), color));
}

const WOOD_BARK = "#5a4632";

const deadwood: PropDef[] = [
  ...family({ id: "dead-tree", name: "Dead tree", category: N, group: "Bare and fallen wood", w: 2, h: 2, layer: "canopy" }, [...TREE_SIZES, { key: "twisted", name: "twisted", r: 1.1 }, { key: "pale", name: "pale and dry", r: 1.2 }], (c, v) =>
    branches(c, v.r, v.key === "twisted" ? 77 : 41 + v.r * 10, v.key === "pale" ? "#9a8e7a" : WOOD_BARK), { size: (v) => [v.r * 2.2, v.r * 2.2] }),
  ...family({ id: "stump", name: "Stump", category: N, group: "Bare and fallen wood", w: 0.8, h: 0.8, layer: "object" }, [vary("cut"), vary("broken"), vary("rotten"), vary("mossy"), vary("wide"), vary("small")], (c, v) => {
    const r = v.key === "wide" ? 0.36 : v.key === "small" ? 0.2 : 0.3;
    disc(c, 0, 0, r, tone("#8a6a46", "#4a3220"));
    if (v.key === "broken") {
      poly(c, [-r * 0.7, -r * 0.2, -r * 0.2, -r * 0.8, r * 0.3, -r * 0.4, r * 0.7, -r * 0.7, r * 0.6, r * 0.3, -r * 0.5, r * 0.5]);
      fo(c, tone("#a8865a", "#5a3e22").light, 0.015);
    } else {
      disc(c, 0, 0, r * 0.82, tone(v.key === "rotten" ? "#6a5440" : "#d4b080", v.key === "rotten" ? "#3a2a1c" : "#9a7448"), 0.012);
      c.strokeStyle = "rgba(90,60,30,0.45)";
      c.lineWidth = 0.01;
      for (let k = 0.2; k < 0.8; k += 0.18) {
        c.beginPath();
        c.arc(0, 0, r * k, 0, Math.PI * 2);
        c.stroke();
      }
    }
    if (v.key === "mossy") for (const [x, y] of scatter(9, r, 9)) disc(c, x, y, 0.06, tone("#7aa04a", "#3a6020"), 0);
  }),
  ...family({ id: "log", name: "Log", category: N, group: "Bare and fallen wood", w: 2, h: 0.6, layer: "object" }, [vary("short"), vary("long"), vary("mossy"), vary("hollow"), vary("split"), vary("burnt")], (c, v) => {
    const L = v.key === "short" ? 1.1 : v.key === "long" ? 2.4 : 1.7;
    c.beginPath();
    c.roundRect(-L / 2, -0.22, L, 0.44, 0.2);
    fo(c, linear(c, 0, -0.22, 0, 0.22, v.key === "burnt" ? "#4a3a30" : "#9a7650", v.key === "burnt" ? "#151110" : "#4a3220"));
    ell(c, L / 2 - 0.05, 0, 0.07, 0.2);
    fo(c, v.key === "hollow" ? "#1a120c" : v.key === "burnt" ? "#2a1e18" : "#d4b080", 0.015);
    if (v.key === "split") stroke(c, [-L / 2 + 0.1, 0, L / 2 - 0.1, 0], 0.025, "#2a1a10");
    if (v.key === "mossy") for (const [x, y] of scatter(12, 0.5, 13)) disc(c, x * 1.6, y * 0.3, 0.06, tone("#7aa04a", "#3a6020"), 0);
  }, { size: (v) => [v.key === "short" ? 1.2 : v.key === "long" ? 2.5 : 1.8, 0.6] }),
  ...family({ id: "fallen-branch", name: "Fallen branch", category: N, group: "Bare and fallen wood", w: 1.6, h: 1, layer: "object" }, [vary("small"), vary("large"), vary("forked"), vary("pile", "pile of brushwood")], (c, v) => {
    const n = v.key === "pile" ? 7 : 1;
    const rand = rng(v.key.length * 7);
    for (let i = 0; i < n; i++) {
      c.save();
      c.rotate(n > 1 ? rand() * Math.PI : 0.2);
      const L = v.key === "small" ? 0.5 : 0.7;
      stroke(c, [-L, 0, L, 0], v.key === "large" ? 0.09 : 0.06, WOOD_BARK);
      stroke(c, [0.1, 0, 0.4, -0.25], 0.04, WOOD_BARK);
      if (v.key === "forked") stroke(c, [-0.2, 0, -0.5, 0.3], 0.05, WOOD_BARK);
      c.restore();
    }
  }),
  ...family({ id: "driftwood", name: "Driftwood", category: N, group: "Bare and fallen wood", w: 1.6, h: 0.8, layer: "object" }, [vary("short"), vary("long"), vary("tangle")], (c, v) => {
    const pale = "#c8bcaa";
    const n = v.key === "tangle" ? 4 : 1;
    for (let i = 0; i < n; i++) {
      c.save();
      c.rotate(i * 0.8);
      stroke(c, [-0.7 * (v.key === "short" ? 0.6 : 1), 0, 0.7 * (v.key === "short" ? 0.6 : 1), 0.05], 0.08, pale);
      stroke(c, [0.2, 0.02, 0.45, -0.18], 0.04, pale);
      c.restore();
    }
  }),
];

/** A rounded leafy mass for bushes. */
function bushShape(c: C, r: number, seed: number, greens: [string, string, string], sx = 1, sy = 1): void {
  c.save();
  c.scale(sx, sy);
  canopy(c, r, seed, greens[0], greens[1], greens[2]);
  c.restore();
}

const BUSH_GREENS: [string, string, string] = ["#2e5a26", "#407a32", "#6aa24e"];
const BERRIES: (Variant & { color: string })[] = [
  { key: "red", name: "red", color: "#c8282a" },
  { key: "blue", name: "blue", color: "#3a4aa8" },
  { key: "black", name: "black", color: "#2a1a2a" },
];
const BLOSSOMS: (Variant & { color: string })[] = [
  { key: "pink", name: "pink", color: "#f0a0c0" },
  { key: "white", name: "white", color: "#fbf7ee" },
  { key: "red", name: "red", color: "#e04848" },
  { key: "yellow", name: "yellow", color: "#f4d040" },
  { key: "violet", name: "violet", color: "#a070d0" },
];

const bushes: PropDef[] = [
  ...family({ id: "bush", name: "Bush", category: N, group: "Bushes and hedges", w: 1.2, h: 1.2, layer: "object" }, cross([vary("round"), vary("wide"), vary("ragged")], [vary("small"), vary("large")]), (c, v) => {
    const r = v.b.key === "small" ? 0.36 : 0.55;
    bushShape(c, r, 500 + v.a.key.length * 7, BUSH_GREENS, v.a.key === "wide" ? 1.3 : 1, v.a.key === "ragged" ? 1.15 : 1);
  }, { size: (v) => (v.b.key === "small" ? [0.9, 0.9] : [1.4, 1.4]) }),
  ...family({ id: "berry-bush", name: "Berry bush", category: N, group: "Bushes and hedges", w: 1.1, h: 1.1, layer: "object" }, BERRIES, (c, v) => {
    bushShape(c, 0.48, 521, BUSH_GREENS);
    for (const [x, y] of scatter(16, 0.36, 523)) disc(c, x, y, 0.035, tone(shade(v.color, 0.35), v.color), 0.006);
  }),
  ...family({ id: "flower-bush", name: "Flowering bush", category: N, group: "Bushes and hedges", w: 1.1, h: 1.1, layer: "object" }, BLOSSOMS, (c, v) => {
    bushShape(c, 0.48, 531, BUSH_GREENS);
    for (const [x, y] of scatter(20, 0.38, 533)) disc(c, x, y, 0.045, tone("#fffbe8", v.color), 0.006);
  }),
  ...family({ id: "hedge", name: "Hedge", category: N, group: "Bushes and hedges", w: 2, h: 0.7, layer: "object" }, [vary("short"), vary("long"), vary("corner"), vary("round", "round, clipped")], (c, v) => {
    const g = ["#2a4e22", "#3a6a2e", "#5a8e46"] as [string, string, string];
    if (v.key === "round") return bushShape(c, 0.42, 541, g);
    if (v.key === "corner") {
      for (const [x, y] of [[-0.4, 0.4], [-0.4, 0], [-0.4, -0.4], [0, -0.4], [0.4, -0.4]] as const) {
        c.save();
        c.translate(x, y);
        bushShape(c, 0.28, 551 + x * 10 + y, g);
        c.restore();
      }
      return;
    }
    const n = v.key === "short" ? 3 : 6;
    for (let i = 0; i < n; i++) {
      c.save();
      c.translate(-((n - 1) * 0.3) / 2 + i * 0.3, 0);
      bushShape(c, 0.28, 561 + i, g);
      c.restore();
    }
  }, { size: (v) => (v.key === "short" ? [1.2, 0.7] : v.key === "long" ? [2, 0.7] : v.key === "corner" ? [1.2, 1.2] : [1, 1]) }),
  ...family({ id: "fern", name: "Fern", category: N, group: "Bushes and hedges", w: 1, h: 1, layer: "object" }, [vary("small"), vary("large"), vary("cluster")], (c, v) => {
    const fronds = (cx: number, cy: number, r: number) => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        c.save();
        c.translate(cx, cy);
        c.rotate(a);
        ell(c, r * 0.5, 0, r * 0.5, r * 0.14);
        fo(c, linear(c, 0, 0, r, 0, "#5a9a3a", "#2a6a26"), 0.015);
        c.restore();
      }
    };
    if (v.key === "cluster") for (const [x, y] of [[-0.2, -0.1], [0.2, 0], [0, 0.22]] as const) fronds(x, y, 0.26);
    else fronds(0, 0, v.key === "small" ? 0.3 : 0.46);
  }),
  ...family({ id: "bramble", name: "Bramble", category: N, group: "Bushes and hedges", w: 1.4, h: 1, layer: "object" }, [vary("small"), vary("large")], (c, v) => {
    const k = v.key === "small" ? 0.7 : 1;
    const rand = rng(571);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const r = (0.25 + rand() * 0.35) * k;
      c.beginPath();
      c.arc(Math.cos(a) * 0.15, Math.sin(a) * 0.1, r, a, a + 2.2);
      c.strokeStyle = i % 2 ? "#5a3a2a" : "#3e5a26";
      c.lineWidth = 0.035;
      c.stroke();
    }
  }),
  ...family({ id: "thorn-bush", name: "Thorn bush", category: N, group: "Bushes and hedges", w: 1, h: 1, layer: "object" }, [vary("green"), vary("dry")], (c, v) => {
    bushShape(c, 0.4, 581, v.key === "dry" ? ["#5a4a2a", "#7a6a3a", "#a8925a"] : ["#2a4a22", "#3a5e2a", "#5a7e42"]);
    const rand = rng(583);
    for (let i = 0; i < 20; i++) {
      const a = rand() * Math.PI * 2;
      const r = 0.3 + rand() * 0.15;
      stroke(c, [Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * (r + 0.08), Math.sin(a) * (r + 0.08)], 0.015, "#2a1a10");
    }
  }),
];

const FLOWER_COLORS: (Variant & { colors: string[] })[] = [
  { key: "red", name: "red", colors: ["#e03030"] },
  { key: "yellow", name: "yellow", colors: ["#f4d030"] },
  { key: "purple", name: "purple", colors: ["#9a5ad0"] },
  { key: "white", name: "white", colors: ["#fbf8ee"] },
  { key: "blue", name: "blue", colors: ["#4a7ae0"] },
  { key: "pink", name: "pink", colors: ["#f08ab8"] },
  { key: "orange", name: "orange", colors: ["#f08a2a"] },
  { key: "mixed", name: "mixed", colors: ["#e03030", "#f4d030", "#9a5ad0", "#fbf8ee", "#4a7ae0"] },
];

function blooms(c: C, colors: string[], n: number, r: number, seed: number, size = 0.05): void {
  for (const [x, y] of scatter(Math.round(n * 0.7), r, seed + 1)) disc(c, x, y, size * 0.9, tone("#7ab04a", "#3a7026"), 0);
  for (const [x, y, k] of scatter(n, r, seed)) {
    const col = colors[Math.floor(k * colors.length)];
    disc(c, x, y, size, tone(shade(col, 0.4), col), 0.006);
    disc(c, x, y, size * 0.3, tone("#fff4a0", "#e8b020"), 0);
  }
}

const TULIPS = FLOWER_COLORS.filter((f) => ["red", "yellow", "pink", "white", "purple"].includes(f.key));

const flowers: PropDef[] = [
  ...family({ id: "flowers", name: "Flowers", category: N, group: "Flowers and grass", w: 1, h: 1, layer: "floor" }, cross(FLOWER_COLORS, [vary("patch"), vary("scattered")]), (c, v) =>
    blooms(c, v.a.colors, v.b.key === "patch" ? 18 : 8, v.b.key === "patch" ? 0.32 : 0.45, 600 + v.a.key.length),
  ),
  ...family({ id: "tulip-bed", name: "Tulip bed", category: N, group: "Flowers and grass", w: 1.2, h: 0.8, layer: "floor" }, TULIPS, (c, v) => {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
      const x = -0.45 + i * 0.18;
      const y = -0.22 + row * 0.22;
      disc(c, x, y + 0.04, 0.035, tone("#7ab04a", "#3a7026"), 0);
      ell(c, x, y, 0.045, 0.06);
      fo(c, radial(c, x, y, 0.06, shade(v.colors[0], 0.3), v.colors[0]), 0.006);
    }
  }),
  ...family({ id: "poppies", name: "Poppies", category: N, group: "Flowers and grass", w: 1, h: 1, layer: "floor" }, [vary("red"), vary("mixed")], (c, v) =>
    blooms(c, v.key === "red" ? ["#d82a1a"] : ["#d82a1a", "#f08a2a", "#fbf8ee"], 14, 0.38, 611, 0.06)),
  ...family({ id: "daisies", name: "Daisies", category: N, group: "Flowers and grass", w: 1, h: 1, layer: "floor" }, [vary("white"), vary("yellow")], (c, v) =>
    blooms(c, [v.key === "white" ? "#fbf8ee" : "#f4d030"], 20, 0.4, 621, 0.04)),
  ...family({ id: "lavender", name: "Lavender", category: N, group: "Flowers and grass", w: 1.2, h: 0.8, layer: "floor" }, [vary("patch"), vary("row")], (c, v) => {
    const pts = v.key === "row" ? Array.from({ length: 7 }, (_, i) => [-0.5 + i * 0.17, 0] as const) : scatter(9, 0.3, 631).map(([x, y]) => [x, y] as const);
    for (const [x, y] of pts) {
      bushShape(c, 0.1, 633 + x * 10, ["#4a6a4a", "#6a8a62", "#98b08a"]);
      c.save();
      c.translate(x, y);
      for (const [dx, dy] of scatter(5, 0.08, 635)) disc(c, dx, dy, 0.02, tone("#c8a0e8", "#7a4ab0"), 0);
      c.restore();
    }
  }),
  ...family({ id: "grass-tuft", name: "Grass tuft", category: N, group: "Flowers and grass", w: 0.7, h: 0.7, layer: "floor" }, [vary("short"), vary("tall"), vary("dry"), vary("lush")], (c, v) => {
    const col = v.key === "dry" ? "#b8a05a" : v.key === "lush" ? "#4aa03a" : "#6a9a3a";
    const len = v.key === "tall" ? 0.3 : 0.18;
    const rand = rng(641 + v.key.length);
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      stroke(c, [0, 0, Math.cos(a) * len * (0.6 + rand() * 0.6), Math.sin(a) * len * (0.6 + rand() * 0.6)], 0.022, i % 2 ? col : shade(col, -0.25));
    }
  }),
  ...family({ id: "tall-grass", name: "Tall grass", category: N, group: "Flowers and grass", w: 1.4, h: 1, layer: "object" }, [vary("patch"), vary("wide", "wide patch")], (c, v) => {
    const pts = scatter(v.key === "wide" ? 26 : 14, v.key === "wide" ? 0.6 : 0.38, 651);
    for (const [x, y, k] of pts) stroke(c, [x, y, x + (k - 0.5) * 0.2, y - 0.25], 0.025, k > 0.5 ? "#7aa040" : "#5a8030");
  }, { size: (v) => (v.key === "wide" ? [1.6, 1.2] : [1, 0.9]) }),
  ...family({ id: "weed-patch", name: "Weeds", category: N, group: "Flowers and grass", w: 0.9, h: 0.9, layer: "floor" }, [vary("small"), vary("large")], (c, v) => {
    for (const [x, y, k] of scatter(v.key === "small" ? 7 : 14, v.key === "small" ? 0.2 : 0.36, 661)) {
      disc(c, x, y, 0.05 + k * 0.03, tone("#8ab04a", "#4a6a22"), 0.008);
    }
  }),
];

const ROCK_TONES: (Variant & { tone: Tone })[] = [
  { key: "grey", name: "grey", tone: tone("#aaa8a2", "#5e5c58") },
  { key: "brown", name: "brown", tone: tone("#a8906e", "#5a4632") },
  { key: "red", name: "red", tone: tone("#c08060", "#6a3a26") },
  { key: "dark", name: "dark", tone: tone("#6e6c6a", "#2a2928") },
  { key: "pale", name: "pale", tone: tone("#e2ddd2", "#9a958a") },
  { key: "mossy", name: "mossy", tone: tone("#98a088", "#4e5a44") },
];

function rockOf(c: C, rx: number, ry: number, seed: number, t: Tone, mossy = false): void {
  const rand = rng(seed);
  const n = 9;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.75 + rand() * 0.25;
    pts.push(Math.cos(a) * rx * k, Math.sin(a) * ry * k);
  }
  poly(c, pts);
  fo(c, radial(c, -rx * 0.2, -ry * 0.2, Math.max(rx, ry), t.light, t.dark));
  stroke(c, [pts[10] * 0.6, pts[11] * 0.6, pts[12] * 0.3, pts[13] * 0.2, pts[14] * 0.6, pts[15] * 0.6], 0.02, "rgba(255,255,255,0.25)");
  if (mossy) for (const [x, y] of scatter(6, Math.min(rx, ry) * 0.7, seed + 3)) disc(c, x, y, Math.min(rx, ry) * 0.18, tone("#7aa04a", "#3a6020"), 0);
}

const rocks: PropDef[] = [
  ...family({ id: "rock", name: "Rock", category: N, group: "Rocks", w: 0.8, h: 0.7, layer: "object" }, cross(ROCK_TONES, [vary("small"), vary("large")]), (c, v) => {
    const k = v.b.key === "small" ? 0.6 : 1;
    rockOf(c, 0.36 * k, 0.3 * k, 700 + v.a.key.length, v.a.tone, v.a.key === "mossy");
  }, { size: (v) => (v.b.key === "small" ? [0.5, 0.45] : [0.8, 0.7]) }),
  ...family({ id: "boulder", name: "Boulder", category: N, group: "Rocks", w: 1.6, h: 1.4, layer: "object" }, ROCK_TONES, (c, v) => rockOf(c, 0.76, 0.64, 710 + v.key.length, v.tone, v.key === "mossy")),
  ...family({ id: "rocks", name: "Rocks", category: N, group: "Rocks", w: 1.2, h: 1, layer: "object" }, ROCK_TONES, (c, v) => {
    for (const [x, y, k] of scatter(5, 0.32, 721)) {
      c.save();
      c.translate(x, y);
      rockOf(c, 0.12 + k * 0.1, 0.1 + k * 0.08, 722 + k * 100, v.tone, v.key === "mossy");
      c.restore();
    }
  }),
  ...family({ id: "rubble", name: "Rubble", category: N, group: "Rocks", w: 1.2, h: 1, layer: "floor" }, cross(ROCK_TONES.slice(0, 4), [vary("small"), vary("wide")]), (c, v) => {
    const wide = v.b.key === "wide";
    for (const [x, y, k] of scatter(wide ? 22 : 12, wide ? 0.6 : 0.36, 731)) {
      c.save();
      c.translate(x, y * 0.8);
      rockOf(c, 0.05 + k * 0.06, 0.04 + k * 0.05, 732 + k * 50, v.a.tone);
      c.restore();
    }
  }, { size: (v) => (v.b.key === "wide" ? [1.5, 1.2] : [0.9, 0.8]) }),
  ...family({ id: "rock-spire", name: "Rock spire", category: N, group: "Rocks", w: 0.9, h: 0.9, layer: "object" }, ROCK_TONES.filter((r) => ["grey", "brown", "pale"].includes(r.key)), (c, v) => {
    for (let i = 0; i < 4; i++) {
      const r = 0.4 - i * 0.09;
      star(c, 7, r, 0.82, i * 0.4);
      fo(c, radial(c, 0, 0, r, v.tone.light, v.tone.dark), 0.02);
    }
  }),
  ...family({ id: "cairn", name: "Cairn", category: N, group: "Rocks", w: 0.8, h: 0.8, layer: "object" }, [vary("small"), vary("tall")], (c, v) => {
    const n = v.key === "small" ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const r = 0.34 - i * (0.26 / n);
      rockOf(c, r, r * 0.85, 741 + i, ROCK_TONES[0].tone);
    }
  }),
];

const waterPlants: PropDef[] = [
  ...family({ id: "reeds", name: "Reeds", category: N, group: "Water plants", w: 1, h: 1, layer: "object" }, [vary("small"), vary("large"), vary("dense")], (c, v) => {
    const n = v.key === "small" ? 10 : v.key === "dense" ? 28 : 18;
    for (const [x, y, k] of scatter(n, v.key === "small" ? 0.25 : 0.42, 801)) stroke(c, [x, y, x + (k - 0.5) * 0.12, y - 0.3], 0.02, k > 0.5 ? "#8aa84a" : "#5a7a32");
  }),
  ...family({ id: "cattail-clump", name: "Cattails", category: N, group: "Water plants", w: 0.8, h: 0.8, layer: "object" }, [vary("small"), vary("large"), vary("dense")], (c, v) => {
    const n = v.key === "small" ? 6 : v.key === "dense" ? 16 : 10;
    for (const [x, y, k] of scatter(n, 0.3, 811)) {
      stroke(c, [x, y + 0.15, x + (k - 0.5) * 0.08, y - 0.15], 0.018, "#6a8a3a");
      ell(c, x + (k - 0.5) * 0.08, y - 0.15, 0.025, 0.06);
      fo(c, "#6a3a1a", 0.006);
    }
  }),
  ...family({ id: "lily-pads", name: "Lily pads", category: N, group: "Water plants", w: 1, h: 1, layer: "floor" }, [vary("plain"), vary("white", "white flowers"), vary("pink", "pink flowers"), vary("large", "large pads")], (c, v) => {
    for (const [x, y, k] of scatter(v.key === "large" ? 4 : 6, 0.32, 821)) {
      const r = (v.key === "large" ? 0.16 : 0.1) + k * 0.04;
      c.beginPath();
      c.moveTo(x, y);
      c.arc(x, y, r, 0.3, Math.PI * 2 - 0.1);
      c.closePath();
      fo(c, radial(c, x, y, r, "#6ab04a", "#2e6a26"), 0.012);
      if ((v.key === "white" || v.key === "pink") && k > 0.4) disc(c, x, y, 0.045, tone("#ffffff", v.key === "white" ? "#e8e4d8" : "#f08ab8"), 0.008);
    }
  }),
  ...family({ id: "seaweed", name: "Seaweed", category: N, group: "Water plants", w: 1, h: 1, layer: "floor" }, [vary("green"), vary("brown")], (c, v) => {
    const col = v.key === "green" ? "#3a7a4a" : "#6a5a2a";
    for (const [x, y, k] of scatter(8, 0.35, 831)) stroke(c, [x, y, x + 0.1, y - 0.12, x - 0.05, y - 0.25 - k * 0.1], 0.03, col);
  }),
  ...family({ id: "kelp", name: "Kelp", category: N, group: "Water plants", w: 1.2, h: 1.2, layer: "floor" }, [vary("thin"), vary("thick")], (c, v) => {
    for (const [x, y, k] of scatter(6, 0.4, 841)) {
      ell(c, x, y, v.key === "thin" ? 0.05 : 0.09, 0.22, k * Math.PI);
      fo(c, linear(c, x, y - 0.2, x, y + 0.2, "#7a8a3a", "#3a4a1a"), 0.01);
    }
  }),
];

const SHROOM_COLORS: (Variant & { cap: string })[] = [
  { key: "red", name: "red", cap: "#c82a1a" },
  { key: "brown", name: "brown", cap: "#8a5a32" },
  { key: "white", name: "white", cap: "#f4eee0" },
  { key: "purple", name: "purple", cap: "#7a3a9a" },
  { key: "yellow", name: "yellow", cap: "#e8b830" },
  { key: "blue", name: "blue", cap: "#3a6ac8" },
];

function cap(c: C, x: number, y: number, r: number, color: string, spots: boolean): void {
  disc(c, x, y, r, tone(shade(color, 0.3), shade(color, -0.25)), 0.012);
  if (spots) for (const [dx, dy] of scatter(4, r * 0.6, Math.round(x * 100 + y * 50))) disc(c, x + dx, y + dy, r * 0.14, tone("#ffffff", "#e8e4d8"), 0);
}

const mushrooms: PropDef[] = [
  ...family({ id: "mushrooms", name: "Mushrooms", category: N, group: "Mushrooms", w: 0.6, h: 0.6, layer: "object" }, SHROOM_COLORS, (c, v) => {
    for (const [x, y, k] of scatter(5, 0.18, 901)) cap(c, x, y, 0.05 + k * 0.05, v.cap, v.key === "red");
  }),
  ...family({ id: "giant-mushroom", name: "Giant mushroom", category: N, group: "Mushrooms", w: 1.4, h: 1.4, layer: "canopy" }, SHROOM_COLORS.filter((s) => ["red", "brown", "purple"].includes(s.key)), (c, v) => {
    cap(c, 0, 0, 0.62, v.cap, v.key === "red");
    c.strokeStyle = "rgba(0,0,0,0.15)";
    c.lineWidth = 0.02;
    for (let r = 0.2; r < 0.6; r += 0.15) {
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.stroke();
    }
  }),
  ...family({ id: "mushroom-ring", name: "Mushroom ring", category: N, group: "Mushrooms", w: 1.6, h: 1.6, layer: "floor" }, [vary("brown"), vary("white")], (c, v) => {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      cap(c, Math.cos(a) * 0.65, Math.sin(a) * 0.65, 0.07, v.key === "brown" ? "#8a5a32" : "#f4eee0", false);
    }
  }),
  ...family({ id: "toadstool", name: "Toadstool", category: N, group: "Mushrooms", w: 0.5, h: 0.5, layer: "object" }, [vary("single"), vary("pair")], (c, v) => {
    if (v.key === "single") cap(c, 0, 0, 0.2, "#c82a1a", true);
    else for (const [x, y, r] of [[-0.08, -0.04, 0.14], [0.12, 0.08, 0.1]] as const) cap(c, x, y, r, "#c82a1a", true);
  }),
];

const snow: PropDef[] = [
  ...family({ id: "snowdrift", name: "Snowdrift", category: N, group: "Snow and ice", w: 1.6, h: 1, layer: "floor" }, [vary("small"), vary("large"), vary("long")], (c, v) => {
    const [rx, ry] = v.key === "small" ? [0.45, 0.3] : v.key === "long" ? [1, 0.3] : [0.75, 0.48];
    for (const [x, y, k] of scatter(5, Math.min(rx, ry) * 0.5, 951)) {
      ell(c, x * (rx / ry), y, rx * (0.55 + k * 0.3), ry * (0.6 + k * 0.3));
      fo(c, radial(c, x, y, rx, "#ffffff", "#c8d8e8"), 0.015);
    }
  }, { size: (v) => (v.key === "small" ? [1, 0.7] : v.key === "long" ? [2.1, 0.7] : [1.6, 1]) }),
  ...family({ id: "icicle-rocks", name: "Rocks with icicles", category: N, group: "Snow and ice", w: 1, h: 0.9, layer: "object" }, [vary("small"), vary("large")], (c, v) => {
    const k = v.key === "small" ? 0.7 : 1;
    rockOf(c, 0.4 * k, 0.32 * k, 971, ROCK_TONES[0].tone);
    for (let i = 0; i < 6; i++) {
      const x = (-0.3 + i * 0.12) * k;
      poly(c, [x - 0.03, 0.15 * k, x + 0.03, 0.15 * k, x, 0.32 * k]);
      fo(c, "rgba(220,240,255,0.95)", 0.008);
    }
  }),
];

const LEAF_COLORS: (Variant & { colors: string[] })[] = [
  { key: "brown", name: "brown", colors: ["#8a5a2a", "#6a4020"] },
  { key: "red", name: "red", colors: ["#c8402a", "#8a2a1a"] },
  { key: "yellow", name: "yellow", colors: ["#e8b830", "#c88a1a"] },
  { key: "mixed", name: "mixed", colors: ["#c8402a", "#e8b830", "#8a5a2a", "#d8702a"] },
];

const groundCover: PropDef[] = [
  ...family({ id: "fallen-leaves", name: "Fallen leaves", category: N, group: "Leaves and roots", w: 1.2, h: 1, layer: "floor" }, LEAF_COLORS, (c, v) => {
    for (const [x, y, k] of scatter(26, 0.48, 1001)) {
      ell(c, x, y * 0.8, 0.05, 0.03, k * Math.PI);
      c.fillStyle = v.colors[Math.floor(k * v.colors.length)];
      c.fill();
    }
  }),
  ...family({ id: "roots", name: "Roots", category: N, group: "Leaves and roots", w: 1.2, h: 1, layer: "floor" }, [vary("small"), vary("large"), vary("tangle")], (c, v) => {
    const rand = rng(1011 + v.key.length);
    const n = v.key === "small" ? 4 : v.key === "tangle" ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const L = 0.3 + rand() * (v.key === "small" ? 0.15 : 0.3);
      stroke(c, [0, 0, Math.cos(a) * L * 0.5, Math.sin(a) * L * 0.5 + 0.05, Math.cos(a) * L, Math.sin(a) * L], 0.04, "#6a4a2e");
    }

  }),
];

export const NATURE_PROPS: PropDef[] = [...leafyTrees, ...evergreens, ...deadwood, ...bushes, ...flowers, ...rocks, ...waterPlants, ...mushrooms, ...snow, ...groundCover];

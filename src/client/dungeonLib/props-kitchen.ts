// Copied from Dungeon (src/render/props-kitchen.ts) by scripts/sync-dungeon-library.mjs, Dungeon c3dcca5. Change it there and run the script again.
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, MASONRY, GLASSES, GLOWS, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, plate, glow, coloredFlame, stroke, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";

// The tavern and its kitchen for the big library: the bar, gaming tables, ovens and stoves,
// shelves and pots, and food.

const K = "Kitchen & tavern" as const;
const IRON = METALS[0];
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const FIRE = GLOWS[0];

const TANKARD_METALS: (Variant & { tone: Tone })[] = [
  { key: "pewter", name: "pewter", tone: METALS[0] },
  { key: "brass", name: "brass", tone: METALS[2] },
  { key: "silver", name: "silver", tone: METALS[3] },
  { key: "wooden", name: "wooden", tone: WOODS[1] },
];

function tankard(c: C, x: number, y: number, t: Tone): void {
  disc(c, x, y, 0.08, t, 0.015);
  circle(c, x, y, 0.055);
  c.fillStyle = radial(c, x, y, 0.055, "#fff4d0", "#c88a3a");
  c.fill();
  stroke(c, [x + 0.08, y - 0.03, x + 0.12, y, x + 0.08, y + 0.03], 0.02, t.dark);
}

const BOTTLES = GLASSES.filter((g) => ["red", "green", "amber", "clear", "blue"].includes(g.key));

function bottle(c: C, x: number, y: number, t: Tone): void {
  disc(c, x, y, 0.06, t, 0.012);
  disc(c, x, y, 0.022, WOODS[0], 0.006);
}

const bar: PropDef[] = [
  ...family({ id: "bar-section", name: "Bar counter section", category: K, group: "The bar", w: 2, h: 0.7, layer: "object" }, WOODS, (c, v) => {
    plank(c, -0.98, -0.32, 1.96, 0.64, v, 61);
    stroke(c, [-0.98, 0.22, 0.98, 0.22], 0.04, shade(v.dark, -0.2), "butt");
    tankard(c, -0.5, -0.05, METALS[0]);
    tankard(c, 0.4, 0.02, METALS[2]);
  }),
  ...family({ id: "barstool", name: "Bar stool", category: K, group: "The bar", w: 0.45, h: 0.45, layer: "object" }, WOODS, (c, v) => {
    disc(c, 0, 0, 0.19, v);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      disc(c, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.025, tone(shade(v.dark, 0.1), shade(v.dark, -0.3)), 0.008);
    }
  }),
  ...family({ id: "tapped-keg", name: "Tapped keg", category: K, group: "The bar", w: 0.9, h: 0.6, layer: "object" }, WOODS, (c, v) => {
    rr(c, -0.42, -0.26, 0.84, 0.52, 0.18);
    fo(c, linear(c, 0, -0.26, 0, 0.26, v.light, v.dark));
    for (const x of [-0.25, 0.25]) stroke(c, [x, -0.25, x, 0.25], 0.03, IRON.dark, "butt");
    rr(c, 0.4, -0.04, 0.1, 0.08, 0.02);
    fo(c, METALS[2].light, 0.01);
  }),
  ...family({ id: "tankards", name: "Tankards", category: K, group: "The bar", w: 0.5, h: 0.5, layer: "object" }, TANKARD_METALS, (c, v) => {
    for (const [x, y] of [[-0.1, -0.08], [0.1, -0.04], [-0.02, 0.12]] as const) tankard(c, x, y, v.tone);
  }),
  ...family({ id: "wine-bottles", name: "Bottles", category: K, group: "The bar", w: 0.5, h: 0.5, layer: "object" }, BOTTLES, (c, v) => {
    for (const [x, y] of [[-0.12, -0.1], [0.08, -0.12], [-0.06, 0.1], [0.13, 0.08]] as const) bottle(c, x, y, v);
  }),
  ...family({ id: "bottle-rack", name: "Bottle rack", category: K, group: "The bar", w: 1.4, h: 0.5, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.68, -0.23, 1.36, 0.46, v, 0.03);
    for (let i = 0; i < 6; i++) bottle(c, -0.55 + i * 0.22, 0, BOTTLES[i % BOTTLES.length]);
  }),
  ...family({ id: "gaming-table", name: "Gaming table", category: K, group: "The bar", w: 1.2, h: 1.2, layer: "object" }, cross(WOODS, [vary("cards", "with cards"), vary("dice", "with dice")]), (c, v) => {
    ell(c, 0, 0, 0.56, 0.56);
    fo(c, radial(c, 0, 0, 0.56, v.a.light, v.a.dark));
    ell(c, 0, 0, 0.44, 0.44);
    fo(c, radial(c, 0, 0, 0.44, "#3a7a4a", "#1a4a2a"), 0.015);
    if (v.b.key === "cards") {
      for (const [x, y, a] of [[-0.15, -0.05, 0.3], [0.12, 0.08, -0.4], [0, -0.2, 0.1]] as const) {
        c.save();
        c.translate(x, y);
        c.rotate(a);
        rr(c, -0.06, -0.09, 0.12, 0.18, 0.015);
        fo(c, "#fbf7ee", 0.01);
        c.restore();
      }
    } else for (const [x, y] of [[-0.08, 0], [0.08, 0.06]] as const) cbox(c, x, y, 0.09, 0.09, tone("#fbf7ee", "#c8c0b0"), 0.015);
  }),
];

const STOVE_STATES = [vary("cold"), vary("lit")];

const kitchen: PropDef[] = [
  ...family({ id: "cook-stove", name: "Cooking stove", category: K, group: "The kitchen", w: 1.2, h: 0.8, layer: "object" }, cross([vary("iron"), vary("brass")], STOVE_STATES), (c, v) => {
    const m = v.a.key === "iron" ? IRON : METALS[2];
    box(c, -0.58, -0.38, 1.16, 0.76, m, 0.05);
    for (const x of [-0.28, 0.28]) {
      disc(c, x, -0.08, 0.17, tone(shade(m.dark, 0.2), shade(m.dark, -0.4)));
      if (v.b.key === "lit") glow(c, x, -0.08, 0.2, FIRE.rgb, 0.35);
    }
  }, { light: (v) => (v.b.key === "lit" ? { radius: 3, color: FIRE.color, intensity: 0.6 } : undefined) }),
  ...family({ id: "bread-oven", name: "Bread oven", category: K, group: "The kitchen", w: 1.4, h: 1.2, layer: "object" }, cross(MASONRY, STOVE_STATES), (c, v) => {
    ell(c, 0, -0.05, 0.66, 0.54);
    fo(c, radial(c, 0, -0.05, 0.66, v.a.light, v.a.dark));
    rr(c, -0.24, 0.3, 0.48, 0.24, 0.1);
    fo(c, "#1a1410", 0.02);
    if (v.b.key === "lit") coloredFlame(c, 0, 0.42, 0.1, FIRE);
  }, { light: (v) => (v.b.key === "lit" ? { radius: 4, color: FIRE.color, intensity: 0.7 } : undefined) }),
  ...family({ id: "work-counter", name: "Kitchen work counter", category: K, group: "The kitchen", w: 2, h: 0.7, layer: "object" }, WOODS, (c, v) => {
    plank(c, -0.98, -0.32, 1.96, 0.64, v, 71);
    for (const [x, y, k] of scatter(7, 0.18, 71)) disc(c, x + 0.4, y, 0.05, k > 0.5 ? tone("#f0a050", "#a8581a") : tone("#9ad06a", "#4a7a2a"), 0.01);
    rr(c, -0.7, -0.12, 0.4, 0.24, 0.03);
    fo(c, tone(shade(v.light, 0.2), v.light).light, 0.012);
  }),
  ...family({ id: "butcher-block", name: "Butcher's block", category: K, group: "The kitchen", w: 0.9, h: 0.9, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.42, -0.42, 0.84, 0.84, v, 0.03);
    c.strokeStyle = "rgba(40,24,12,0.3)";
    c.lineWidth = 0.01;
    for (let k = -0.3; k <= 0.3; k += 0.15) {
      c.beginPath();
      c.moveTo(-0.42, k);
      c.lineTo(0.42, k);
      c.moveTo(k, -0.42);
      c.lineTo(k, 0.42);
      c.stroke();
    }
    ell(c, 0.05, 0.05, 0.2, 0.12, 0.3);
    fo(c, radial(c, 0.05, 0.05, 0.2, "#e88a8a", "#9a2a2a"), 0.015);
    stroke(c, [-0.3, -0.25, -0.05, -0.15], 0.04, IRON.light);
  }),
  ...family({ id: "pantry-shelf", name: "Pantry shelf", category: K, group: "The kitchen", w: 1.6, h: 0.45, layer: "object" }, cross(WOODS, [vary("stocked"), vary("sparse", "nearly bare")]), (c, v) => {
    plank(c, -0.78, -0.2, 1.56, 0.4, v.a, 81);
    const n = v.b.key === "stocked" ? 9 : 3;
    for (let i = 0; i < n; i++) {
      const x = -0.68 + (i / Math.max(1, n - 1)) * 1.36;
      if (i % 3 === 0) disc(c, x, 0, 0.08, tone("#d0784a", "#8a4424"), 0.012);
      else if (i % 3 === 1) cbox(c, x, 0, 0.14, 0.12, tone("#e8d0a0", "#9a7a4a"), 0.02);
      else bottle(c, x, 0, BOTTLES[i % BOTTLES.length]);
    }
  }),
  ...family({ id: "cured-meats", name: "Cured meats", category: K, group: "The kitchen", w: 1.2, h: 0.5, layer: "object" }, [vary("hams"), vary("sausages", "strings of sausages"), vary("mixed")], (c, v) => {
    stroke(c, [-0.56, -0.18, 0.56, -0.18], 0.04, WOODS[2].dark);
    for (let i = 0; i < 5; i++) {
      const x = -0.44 + i * 0.22;
      if (v.key === "hams" || (v.key === "mixed" && i % 2 === 0)) {
        ell(c, x, 0.04, 0.08, 0.15);
        fo(c, radial(c, x, 0.04, 0.15, "#d07a5a", "#7a2a1a"), 0.015);
      } else for (let k = 0; k < 3; k++) disc(c, x, -0.08 + k * 0.1, 0.045, tone("#b0584a", "#5a1a12"), 0.01);
    }
  }),
  ...family({ id: "dish-rack", name: "Dish rack", category: K, group: "The kitchen", w: 1, h: 0.4, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.48, -0.18, 0.96, 0.36, v, 0.03);
    for (let i = 0; i < 6; i++) {
      ell(c, -0.38 + i * 0.15, 0, 0.04, 0.14);
      fo(c, linear(c, 0, -0.14, 0, 0.14, "#fbf7ee", "#c8c0b0"), 0.01);
    }
  }),
  ...family({ id: "wash-tub", name: "Wash tub", category: K, group: "The kitchen", w: 0.9, h: 0.9, layer: "object" }, cross([vary("wooden"), vary("copper")], [vary("empty"), vary("dishes", "full of dishes")]), (c, v) => {
    disc(c, 0, 0, 0.42, v.a.key === "wooden" ? WOODS[1] : tone("#e8a070", "#8a4a22"));
    circle(c, 0, 0, 0.34);
    c.fillStyle = radial(c, 0, 0, 0.34, "#c4dce8", "#5a8aa4");
    c.fill();
    if (v.b.key === "dishes") for (const [x, y] of scatter(4, 0.16, 91)) plate(c, x, y, 0.1);
  }),
  ...family({ id: "spice-rack", name: "Spice rack", category: K, group: "The kitchen", w: 0.9, h: 0.3, layer: "object" }, WOODS.filter((w) => ["pale", "walnut", "ebony"].includes(w.key)), (c, v) => {
    box(c, -0.43, -0.12, 0.86, 0.24, v, 0.02);
    const colors = ["#c83a1a", "#e8b030", "#6a8a3a", "#7a4a2a", "#e8e0c8", "#3a2a1a"];
    colors.forEach((col, i) => disc(c, -0.33 + i * 0.13, 0, 0.045, tone(shade(col, 0.2), col), 0.008));
  }),
  ...family({ id: "cooking-pot", name: "Cooking pot", category: K, group: "The kitchen", w: 0.7, h: 0.7, layer: "object" }, cross(METALS, [vary("empty"), vary("stew", "of stew")]), (c, v) => {
    disc(c, 0, 0, 0.3, v.a);
    circle(c, 0, 0, 0.24);
    c.fillStyle = v.b.key === "stew" ? radial(c, 0, 0, 0.24, "#c8803a", "#6a3a14") : radial(c, 0, 0, 0.24, shade(v.a.dark, 0.1), shade(v.a.dark, -0.5));
    c.fill();
    for (const x of [-0.33, 0.33]) stroke(c, [x, -0.06, x, 0.06], 0.04, v.a.dark);
  }),
];

const DISHES: (Variant & { colors: string[] })[] = [
  { key: "roast", name: "roast", colors: ["#a8582a", "#6a3010"] },
  { key: "fish", name: "fish", colors: ["#b8c4cc", "#6a7a84"] },
  { key: "bread", name: "bread", colors: ["#e0a860", "#9a6020"] },
  { key: "cheese", name: "cheese", colors: ["#f4d060", "#b8901a"] },
  { key: "fruit", name: "fruit", colors: ["#d83a2a", "#e8a020"] },
  { key: "pie", name: "pie", colors: ["#d8a058", "#8a5020"] },
  { key: "sausages", name: "sausages", colors: ["#b0584a", "#5a1a12"] },
  { key: "soup", name: "soup", colors: ["#d8903a", "#8a4a10"] },
];

const CHEESES = [vary("yellow"), vary("white"), vary("blue", "blue-veined")];

const FRUITS: (Variant & { colors: string[] })[] = [
  { key: "red", name: "red", colors: ["#d83a2a"] },
  { key: "green", name: "green", colors: ["#8ab43a"] },
  { key: "orange", name: "orange", colors: ["#f08a1a"] },
  { key: "purple", name: "purple", colors: ["#6a2a8a"] },
  { key: "yellow", name: "yellow", colors: ["#f0d03a"] },
  { key: "mixed", name: "mixed", colors: ["#d83a2a", "#8ab43a", "#f08a1a", "#f0d03a"] },
];

const VEG: (Variant & { colors: string[] })[] = [
  { key: "mixed", name: "mixed", colors: ["#f08a1a", "#7ab43a", "#e8e0b0", "#8a2a4a"] },
  { key: "greens", name: "greens", colors: ["#6ab43a", "#3a7a2a"] },
  { key: "squashes", name: "squashes", colors: ["#e8a020", "#c8701a"] },
  { key: "onions", name: "onions", colors: ["#e8d8b0", "#a87a5a"] },
];

function produce(c: C, colors: string[], n: number, r: number, seed: number, size = 0.07): void {
  for (const [x, y, k] of scatter(n, r, seed)) {
    const col = colors[Math.floor(k * colors.length)];
    disc(c, x, y, size, tone(shade(col, 0.3), shade(col, -0.25)), 0.01);
  }
}

const food: PropDef[] = [
  ...family({ id: "platter", name: "Platter", category: K, group: "Food", w: 0.8, h: 0.6, layer: "object" }, DISHES, (c, v) => {
    ell(c, 0, 0, 0.36, 0.26);
    fo(c, radial(c, 0, 0, 0.36, "#f4eee0", "#b8ae98"), 0.015);
    if (v.key === "soup") {
      ell(c, 0, 0, 0.22, 0.16);
      fo(c, radial(c, 0, 0, 0.22, v.colors[0], v.colors[1]), 0.012);
    } else produce(c, v.colors, 6, 0.14, 101, 0.06);
  }),
  ...family({ id: "cheese", name: "Cheese", category: K, group: "Food", w: 0.6, h: 0.6, layer: "object" }, cross(CHEESES, [vary("whole"), vary("cut")]), (c, v) => {
    const t = v.a.key === "white" ? tone("#fbf7ea", "#d8ccb0") : tone("#f6d670", "#c09a2a");
    disc(c, 0, 0, 0.26, t);
    if (v.a.key === "blue") for (const [x, y] of scatter(8, 0.18, 7)) disc(c, x, y, 0.02, tone("#6a7aa4", "#3a4a6a"), 0);
    if (v.b.key === "cut") {
      poly(c, [0, 0, 0.26, -0.04, 0.24, 0.12]);
      fo(c, "#3a2a1a", 0.012);
    }
  }),
  ...family({ id: "fruit-crate", name: "Fruit crate", category: K, group: "Food", w: 0.7, h: 0.6, layer: "object" }, FRUITS, (c, v) => {
    box(c, -0.33, -0.28, 0.66, 0.56, WOODS[0], 0.03);
    produce(c, v.colors, 11, 0.2, 111);
  }),
  ...family({ id: "vegetable-crate", name: "Vegetable crate", category: K, group: "Food", w: 0.7, h: 0.6, layer: "object" }, VEG, (c, v) => {
    box(c, -0.33, -0.28, 0.66, 0.56, WOODS[5], 0.03);
    produce(c, v.colors, 11, 0.2, 121, 0.075);
  }),
  ...family({ id: "bread", name: "Bread", category: K, group: "Food", w: 0.6, h: 0.5, layer: "object" }, [vary("loaves"), vary("rolls"), vary("plaited", "plaited loaf")], (c, v) => {
    const t = tone("#e8b468", "#9a6020");
    if (v.key === "loaves") for (const [x, y] of [[-0.1, 0], [0.12, 0.04]] as const) {
      ell(c, x, y, 0.12, 0.18, 0.3);
      fo(c, radial(c, x, y, 0.18, t.light, t.dark), 0.015);
    } else if (v.key === "rolls") produce(c, ["#d8a058"], 6, 0.15, 131, 0.07);
    else for (let i = 0; i < 4; i++) {
      ell(c, -0.15 + i * 0.1, 0, 0.08, 0.12, 0.6);
      fo(c, radial(c, -0.15 + i * 0.1, 0, 0.12, t.light, t.dark), 0.012);
    }
  }),
  ...family({ id: "pie", name: "Pie", category: K, group: "Food", w: 0.5, h: 0.5, layer: "object" }, [vary("meat"), vary("berry"), vary("custard"), vary("cream")], (c, v) => {
    disc(c, 0, 0, 0.22, tone("#e8b468", "#9a6020"));
    const fill = v.key === "berry" ? "#7a1a4a" : v.key === "custard" ? "#f4d880" : v.key === "cream" ? "#fbf7ee" : "#8a4a22";
    if (v.key !== "meat") disc(c, 0, 0, 0.15, tone(shade(fill, 0.2), fill), 0.012);
    else for (let i = 0; i < 4; i++) stroke(c, [-0.15, -0.12 + i * 0.08, 0.15, -0.12 + i * 0.08], 0.02, "#b8783a");
  }),
  ...family({ id: "feast", name: "Feast spread", category: K, group: "Food", w: 2, h: 1, layer: "object" }, [vary("roast"), vary("fish"), vary("harvest")], (c, v) => {
    rr(c, -0.95, -0.45, 1.9, 0.9, 0.06);
    fo(c, "rgba(246,240,226,0.95)", 0.015);
    const main = v.key === "roast" ? DISHES[0] : v.key === "fish" ? DISHES[1] : DISHES[4];
    ell(c, 0, 0, 0.3, 0.2);
    fo(c, radial(c, 0, 0, 0.3, "#f4eee0", "#b8ae98"), 0.015);
    produce(c, main.colors, 5, 0.12, 141, 0.06);
    for (const x of [-0.65, 0.65]) produce(c, ["#d8a058", "#d83a2a", "#8ab43a"], 5, 0.14, 151 + x, 0.05);
    for (const x of [-0.35, 0.35]) tankard(c, x, 0.28, METALS[0]);
  }),
];

export const KITCHEN_PROPS: PropDef[] = [...bar, ...kitchen, ...food];

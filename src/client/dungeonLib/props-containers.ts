// Copied from Dungeon (src/render/props-containers.ts) by scripts/sync-dungeon-library.mjs, Dungeon 9bae40f. Change it there and run the script again.
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, CLAYS, GLASSES, GOLD, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, stroke, studs, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";

// Containers for the big library: barrels, crates, chests, sacks, baskets, pottery and treasure.

const K = "Containers" as const;
const IRON = METALS[0];
const BRASS = METALS[2];
const WATER: Tone = { key: "", name: "", light: "#a8d0e4", dark: "#3a6a88" };
const ALE: Tone = { key: "", name: "", light: "#c88a3a", dark: "#5a3010" };
const STRAW: Tone = { key: "", name: "", light: "#ecd68a", dark: "#a8883a" };

/** A barrel from above: staves, hoops, and a lid or what's inside. */
function barrelTop(c: C, r: number, wood: Tone, inside?: Tone): void {
  disc(c, 0, 0, r, wood);
  c.strokeStyle = "rgba(40,24,12,0.35)";
  c.lineWidth = 0.012;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    c.stroke();
  }
  circle(c, 0, 0, r * 0.92);
  c.strokeStyle = IRON.dark;
  c.lineWidth = 0.03;
  c.stroke();
  if (inside) {
    circle(c, 0, 0, r * 0.74);
    c.fillStyle = radial(c, 0, 0, r * 0.74, inside.light, inside.dark);
    c.fill();
  } else {
    circle(c, 0, 0, r * 0.74);
    c.fillStyle = radial(c, 0, 0, r * 0.74, shade(wood.light, 0.08), wood.dark);
    c.fill();
    stroke(c, [-r * 0.6, 0, r * 0.6, 0], 0.012, "rgba(40,24,12,0.35)");
  }
}

type Contents = Variant & { inside?: Tone };
const BARREL_STATES: Contents[] = [
  { key: "sealed", name: "sealed" },
  { key: "water", name: "of water", inside: WATER },
  { key: "ale", name: "of ale", inside: ALE },
];

const barrels: PropDef[] = [
  ...family({ id: "barrel-banded", name: "Banded barrel", category: K, group: "Barrels", w: 0.8, h: 0.8, layer: "object" }, cross(WOODS, BARREL_STATES), (c, v) => barrelTop(c, 0.38, v.a, v.b.inside)),
  ...family({ id: "barrel-tipped", name: "Barrel on its side", category: K, group: "Barrels", w: 1.1, h: 0.75, layer: "object" }, WOODS, (c, v) => {
    rr(c, -0.52, -0.34, 1.04, 0.68, 0.22);
    fo(c, linear(c, 0, -0.34, 0, 0.34, v.light, v.dark));
    for (const x of [-0.36, -0.12, 0.12, 0.36]) stroke(c, [x, -0.33, x, 0.33], 0.03, IRON.dark, "butt");
    ell(c, -0.5, 0, 0.06, 0.3);
    fo(c, v.dark, 0.015);
  }),
  ...family({ id: "barrel-stack", name: "Stack of barrels", category: K, group: "Barrels", w: 1.6, h: 1.4, layer: "object" }, WOODS, (c, v) => {
    for (const [x, y] of [[-0.4, 0.3], [0.4, 0.3], [0, -0.35]] as const) {
      c.save();
      c.translate(x, y);
      barrelTop(c, 0.36, v);
      c.restore();
    }
  }),
];

type CrateState = Variant & { open: boolean; fill?: "straw" | "goods" };
const CRATE_STATES: CrateState[] = [
  { key: "closed", name: "closed", open: false },
  { key: "open", name: "open, empty", open: true },
  { key: "straw", name: "packed with straw", open: true, fill: "straw" },
  { key: "goods", name: "full of goods", open: true, fill: "goods" },
];

function crate(c: C, s: number, wood: Tone, state: CrateState): void {
  box(c, -s / 2, -s / 2, s, s, wood, 0.03);
  if (!state.open) {
    for (const k of [-0.25, 0, 0.25]) stroke(c, [-s / 2 + 0.04, k * s, s / 2 - 0.04, k * s], 0.012, "rgba(40,24,12,0.4)");
    stroke(c, [-s / 2 + 0.05, -s / 2 + 0.05, s / 2 - 0.05, s / 2 - 0.05], 0.05, shade(wood.dark, -0.1));
    return;
  }
  rr(c, -s / 2 + 0.06, -s / 2 + 0.06, s - 0.12, s - 0.12, 0.02);
  fo(c, shade(wood.dark, -0.35), 0.012);
  if (state.fill === "straw") {
    for (const [x, y, k] of scatter(14, s * 0.32, 7)) stroke(c, [x - 0.08, y, x + 0.08, y + (k - 0.5) * 0.1], 0.02, k > 0.5 ? STRAW.light : STRAW.dark);
  } else if (state.fill === "goods") {
    for (const [x, y, k] of scatter(5, s * 0.25, 9)) disc(c, x, y, 0.08, k > 0.5 ? { key: "", name: "", light: "#e8d0a0", dark: "#8a6a3a" } : { key: "", name: "", light: "#c86a4a", dark: "#6a2a1a" }, 0.012);
  }
}

const crates: PropDef[] = [
  ...family({ id: "packing-crate", name: "Packing crate", category: K, group: "Crates", w: 0.9, h: 0.9, layer: "object" }, cross(WOODS, CRATE_STATES), (c, v) => crate(c, 0.84, v.a, v.b)),
  ...family({ id: "crate-pile", name: "Pile of crates", category: K, group: "Crates", w: 1.6, h: 1.4, layer: "object" }, WOODS, (c, v) => {
    for (const [x, y, s] of [[-0.4, 0.25, 0.7], [0.4, 0.3, 0.62], [0.05, -0.32, 0.6]] as const) {
      c.save();
      c.translate(x, y);
      c.rotate(x * 0.2);
      crate(c, s, v, CRATE_STATES[0]);
      c.restore();
    }
  }),
  ...family({ id: "long-crate", name: "Long crate", category: K, group: "Crates", w: 1.8, h: 0.6, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.86, -0.27, 1.72, 0.54, v, 0.03);
    for (const x of [-0.6, 0, 0.6]) stroke(c, [x, -0.25, x, 0.25], 0.04, shade(v.dark, -0.15), "butt");
  }),
];

const BANDS = cross([vary("iron-bound"), vary("brass-bound")], [vary("shut"), vary("open")]);

function chest(c: C, w: number, h: number, wood: Tone, band: Tone, open: boolean): void {
  box(c, -w / 2, -h / 2, w, h, wood, 0.05);
  if (open) {
    rr(c, -w / 2 + 0.06, -h / 2 + 0.06, w - 0.12, h - 0.12, 0.03);
    fo(c, shade(wood.dark, -0.4), 0.012);
    for (const [x, y] of scatter(9, Math.min(w, h) * 0.3, 3)) disc(c, x, y, 0.045, GOLD, 0.008);
  } else {
    for (const x of [-w / 3, w / 3]) stroke(c, [x, -h / 2 + 0.02, x, h / 2 - 0.02], 0.05, band.dark, "butt");
    rr(c, -0.07, h / 2 - 0.16, 0.14, 0.12, 0.02);
    fo(c, linear(c, 0, 0, 0, 0.1, band.light, band.dark), 0.01);
  }
}

const chests: PropDef[] = [
  ...family({ id: "chest-bound", name: "Bound chest", category: K, group: "Chests and strongboxes", w: 1, h: 0.7, layer: "object" }, cross(WOODS, BANDS), (c, v) =>
    chest(c, 0.94, 0.64, v.a, v.b.a.key === "iron-bound" ? IRON : BRASS, v.b.b.key === "open"),
  ),
  ...family({ id: "coffer", name: "Coffer", category: K, group: "Chests and strongboxes", w: 0.55, h: 0.4, layer: "object" }, cross(METALS, [vary("shut"), vary("open")]), (c, v) => {
    box(c, -0.26, -0.18, 0.52, 0.36, v.a, 0.04);
    if (v.b.key === "open") {
      rr(c, -0.21, -0.13, 0.42, 0.26, 0.03);
      fo(c, "#5a1a2a", 0.01);
      for (const [x, y, k] of scatter(5, 0.1, 5)) disc(c, x, y, 0.03, GLASSES[Math.floor(k * 5)], 0.006);
    } else {
      studs(c, -0.22, 0, 0.22, 0, 5, 0.018, GOLD);
    }
  }),
  ...family({ id: "footlocker", name: "Footlocker", category: K, group: "Chests and strongboxes", w: 1.1, h: 0.55, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.53, -0.25, 1.06, 0.5, v, 0.03);
    stroke(c, [-0.53, -0.1, 0.53, -0.1], 0.03, IRON.dark, "butt");
    for (const x of [-0.4, 0.4]) cbox(c, x, 0.12, 0.08, 0.1, IRON, 0.01);
  }),
  ...family({ id: "safe-box", name: "Iron safe", category: K, group: "Chests and strongboxes", w: 0.8, h: 0.7, layer: "object" }, METALS, (c, v) => {
    box(c, -0.38, -0.33, 0.76, 0.66, v, 0.05);
    disc(c, 0.05, 0, 0.12, { key: "", name: "", light: shade(v.light, 0.2), dark: v.dark });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      stroke(c, [0.05, 0, 0.05 + Math.cos(a) * 0.1, Math.sin(a) * 0.1], 0.012, v.dark);
    }
  }),
];

const SACKS: (Variant & { tone: Tone })[] = [
  { key: "hessian", name: "hessian", tone: { key: "", name: "", light: "#c8a878", dark: "#7a5a32" } },
  { key: "white", name: "white", tone: { key: "", name: "", light: "#f2eadb", dark: "#b4a68a" } },
  { key: "brown", name: "brown", tone: { key: "", name: "", light: "#9a7048", dark: "#4e331c" } },
  { key: "green", name: "green", tone: { key: "", name: "", light: "#8a9a62", dark: "#45522c" } },
];

function sack(c: C, t: Tone, open: boolean): void {
  poly(c, [-0.24, -0.2, -0.1, -0.3, 0.12, -0.3, 0.26, -0.18, 0.28, 0.2, 0.12, 0.3, -0.14, 0.3, -0.28, 0.18]);
  fo(c, radial(c, 0, 0, 0.36, t.light, t.dark), 0.025);
  if (open) {
    ell(c, 0.02, -0.18, 0.14, 0.09);
    fo(c, radial(c, 0.02, -0.18, 0.14, "#f4e4b0", "#b8984a"), 0.015);
  } else stroke(c, [-0.08, -0.26, 0.1, -0.26], 0.025, shade(t.dark, -0.2));
}

const BASKETS: (Variant & { fill?: string[] })[] = [
  { key: "empty", name: "empty" },
  { key: "bread", name: "of bread", fill: ["#d8a058", "#b87a38"] },
  { key: "fruit", name: "of fruit", fill: ["#d83a2a", "#e8a020", "#8ab43a"] },
  { key: "yarn", name: "of yarn", fill: ["#a83a5a", "#3a6ab4", "#e8d06a"] },
  { key: "laundry", name: "of laundry", fill: ["#f4f0e6", "#c8d8e8", "#e8d0c0"] },
  { key: "fish", name: "of fish", fill: ["#a8b4bc", "#7a8a94"] },
];

const sacks: PropDef[] = [
  ...family({ id: "sack-cloth", name: "Sack", category: K, group: "Sacks, baskets and buckets", w: 0.6, h: 0.6, layer: "object" }, cross(SACKS, [vary("tied"), vary("open", "open, of grain")]), (c, v) =>
    sack(c, v.a.tone, v.b.key === "open"),
  ),
  ...family({ id: "sack-heap", name: "Heap of sacks", category: K, group: "Sacks, baskets and buckets", w: 1.3, h: 1.1, layer: "object" }, SACKS, (c, v) => {
    for (const [x, y, a] of [[-0.3, 0.2, 0.3], [0.3, 0.22, -0.2], [0, -0.22, 0.1]] as const) {
      c.save();
      c.translate(x, y);
      c.rotate(a);
      sack(c, v.tone, false);
      c.restore();
    }
  }),
  ...family({ id: "basket-wicker", name: "Wicker basket", category: K, group: "Sacks, baskets and buckets", w: 0.6, h: 0.6, layer: "object" }, BASKETS, (c, v) => {
    disc(c, 0, 0, 0.27, STRAW);
    c.strokeStyle = "rgba(90,60,20,0.45)";
    c.lineWidth = 0.012;
    for (let r = 0.08; r < 0.27; r += 0.05) {
      circle(c, 0, 0, r);
      c.stroke();
    }
    if (v.fill) for (const [x, y, k] of scatter(7, 0.13, 21)) disc(c, x, y, 0.06, { key: "", name: "", light: shade(v.fill[Math.floor(k * v.fill.length)], 0.25), dark: v.fill[Math.floor(k * v.fill.length)] }, 0.01);
  }),
  ...family({ id: "pail", name: "Pail", category: K, group: "Sacks, baskets and buckets", w: 0.45, h: 0.45, layer: "object" }, cross([vary("wooden"), vary("iron")], [vary("empty"), vary("water", "of water"), vary("milk", "of milk")]), (c, v) => {
    disc(c, 0, 0, 0.2, v.a.key === "iron" ? IRON : WOODS[1]);
    const inside = v.b.key === "water" ? WATER : v.b.key === "milk" ? { key: "", name: "", light: "#ffffff", dark: "#dcd6c8" } : { key: "", name: "", light: "#5a4030", dark: "#2a1a10" };
    circle(c, 0, 0, 0.15);
    c.fillStyle = radial(c, 0, 0, 0.15, inside.light, inside.dark);
    c.fill();
    stroke(c, [-0.2, 0, 0.2, 0], 0.015, IRON.dark);
  }),
];

/** A pot, jar or urn from above: a body, a rim, an opening. */
function vessel(c: C, r: number, t: Tone, painted = false): void {
  disc(c, 0, 0, r, t);
  if (painted) {
    c.strokeStyle = shade(t.dark, -0.3);
    c.lineWidth = 0.025;
    circle(c, 0, 0, r * 0.78);
    c.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      disc(c, Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, r * 0.06, { key: "", name: "", light: "#f4ead0", dark: "#c8b88a" }, 0.006);
    }
  }
  circle(c, 0, 0, r * 0.42);
  fo(c, radial(c, 0, 0, r * 0.42, shade(t.dark, 0.1), shade(t.dark, -0.5)), 0.015);
}

const pottery: PropDef[] = [
  ...family({ id: "urn-tall", name: "Tall urn", category: K, group: "Pots, jars and urns", w: 0.6, h: 0.6, layer: "object" }, cross(CLAYS, [vary("plain"), vary("painted")]), (c, v) => vessel(c, 0.27, v.a, v.b.key === "painted")),
  ...family({ id: "amphora", name: "Amphora", category: K, group: "Pots, jars and urns", w: 0.6, h: 1, layer: "object" }, cross(CLAYS, [vary("upright"), vary("lying", "on its side")]), (c, v) => {
    if (v.b.key === "upright") return vessel(c, 0.26, v.a);
    ell(c, 0, 0.05, 0.24, 0.38);
    fo(c, radial(c, 0, 0, 0.4, v.a.light, v.a.dark));
    rr(c, -0.07, -0.48, 0.14, 0.16, 0.04);
    fo(c, v.a.dark, 0.015);
  }),
  ...family({ id: "glass-jar", name: "Glass jar", category: K, group: "Pots, jars and urns", w: 0.35, h: 0.35, layer: "object" }, GLASSES, (c, v) => {
    disc(c, 0, 0, 0.15, { key: "", name: "", light: "#f4fbff", dark: "#9ab4c4" }, 0.015);
    circle(c, 0, 0, 0.11);
    c.fillStyle = radial(c, 0, 0, 0.11, v.light, v.dark);
    c.fill();
    disc(c, 0, 0, 0.06, WOODS[0], 0.01);
  }),
  ...family({ id: "clay-pot", name: "Clay pot", category: K, group: "Pots, jars and urns", w: 0.6, h: 0.6, layer: "object" }, cross(CLAYS, [vary("small"), vary("large")]), (c, v) => vessel(c, v.b.key === "small" ? 0.17 : 0.27, v.a), {
    size: (v) => (v.b.key === "small" ? [0.4, 0.4] : [0.6, 0.6]),
  }),
];

const COINS: (Variant & { tone: Tone })[] = [
  { key: "gold", name: "gold", tone: GOLD },
  { key: "silver", name: "silver", tone: METALS[3] },
  { key: "copper", name: "copper", tone: { key: "", name: "", light: "#f0a878", dark: "#8a4a24" } },
];

function heap(c: C, n: number, r: number, coin: Tone, seed: number, gems = 0): void {
  ell(c, 0, 0, r, r * 0.8);
  fo(c, radial(c, 0, 0, r, coin.light, coin.dark), 0.02);
  for (const [x, y] of scatter(n, r * 0.85, seed)) disc(c, x, y * 0.8, 0.05, coin, 0.008);
  for (const [x, y, k] of scatter(gems, r * 0.7, seed + 1)) disc(c, x, y * 0.8, 0.055, GLASSES[Math.floor(k * 5)], 0.008);
}

const treasure: PropDef[] = [
  ...family({ id: "coin-heap", name: "Heap of coins", category: K, group: "Treasure", w: 1, h: 0.8, layer: "object" }, cross(COINS, [vary("small"), vary("large")]), (c, v) =>
    heap(c, v.b.key === "small" ? 10 : 26, v.b.key === "small" ? 0.3 : 0.46, v.a.tone, 31), {
    size: (v) => (v.b.key === "small" ? [0.7, 0.6] : [1, 0.8]),
  }),
  ...family({ id: "gem-heap", name: "Heap of gems", category: K, group: "Treasure", w: 0.6, h: 0.5, layer: "object" }, GLASSES.slice(0, 5), (c, v) => {
    for (const [x, y] of scatter(9, 0.22, 41)) {
      poly(c, [x, y - 0.06, x + 0.05, y, x, y + 0.06, x - 0.05, y]);
      fo(c, linear(c, x - 0.05, y - 0.06, x + 0.05, y + 0.06, v.light, v.dark), 0.01);
    }
  }),
  ...family({ id: "hoard", name: "Dragon's hoard", category: K, group: "Treasure", w: 2.4, h: 2, layer: "object" }, cross(COINS.slice(0, 2), [vary("small"), vary("large")]), (c, v) => {
    const k = v.b.key === "small" ? 0.7 : 1;
    heap(c, Math.round(60 * k), 1.1 * k, v.a.tone, 51, Math.round(10 * k));
    cbox(c, 0.3 * k, -0.2 * k, 0.4, 0.28, WOODS[4], 0.03);
    disc(c, -0.4 * k, 0.1 * k, 0.12, GOLD);
  }, { size: (v) => (v.b.key === "small" ? [1.7, 1.4] : [2.4, 2]) }),
  ...family({ id: "loot-bag", name: "Bag of loot", category: K, group: "Treasure", w: 0.7, h: 0.6, layer: "object" }, SACKS, (c, v) => {
    sack(c, v.tone, true);
    for (const [x, y] of scatter(5, 0.12, 61)) disc(c, x + 0.22, y + 0.18, 0.04, GOLD, 0.008);
  }),
];

export const CONTAINER_PROPS: PropDef[] = [...barrels, ...crates, ...chests, ...sacks, ...pottery, ...treasure];


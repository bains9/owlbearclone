// Copied from Dungeon (src/render/props-furniture.ts) by scripts/sync-dungeon-library.mjs, Dungeon 9bae40f. Change it there and run the script again.
import { rng } from "./noise";
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, CLOTHS, GOLD, cross, family, shade, ell, poly, fo, box, disc, plank, drape, plate, bookRow, glow, stroke, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";

// Furniture for the big library: tables, seating, beds, storage, rugs and decor (baths and
// washstands are in the Washroom, props-washroom.ts).

const F = "Furniture" as const;

type Setting = Variant & { kind: "bare" | "set" | "cluttered" };
const SETTINGS: Setting[] = [
  { key: "bare", name: "bare", kind: "bare" },
  { key: "set", name: "set for a meal", kind: "set" },
  { key: "cluttered", name: "cluttered", kind: "cluttered" },
];

/** What's on a table top: plates at the places, or a candle, a book, a mug and papers. */
function dress(c: C, kind: Setting["kind"], places: [number, number][], spread: [number, number], seed: number): void {
  if (kind === "set") {
    for (const [x, y] of places) {
      plate(c, x, y, 0.13, "#b8743a");
      disc(c, x + 0.17, y - 0.1, 0.05, { key: "", name: "", light: "#e8d9a8", dark: "#8a7440" }, 0.012);
    }
    return;
  }
  if (kind !== "cluttered") return;
  const r = rng(seed);
  const at = () => [(r() - 0.5) * spread[0], (r() - 0.5) * spread[1]] as const;
  const [px, py] = at();
  c.save();
  c.translate(px, py);
  c.rotate(r() * 0.6 - 0.3);
  c.fillStyle = "#efe6cc";
  c.fillRect(-0.14, -0.1, 0.28, 0.2);
  c.strokeStyle = "rgba(60,40,20,0.5)";
  c.lineWidth = 0.008;
  for (let i = 0; i < 4; i++) stroke(c, [-0.1, -0.06 + i * 0.04, 0.08, -0.06 + i * 0.04], 0.008, "rgba(60,40,20,0.45)");
  c.restore();
  const [bx, by] = at();
  box(c, bx - 0.12, by - 0.09, 0.24, 0.18, { key: "", name: "", light: "#8a3a2a", dark: "#4a1a12" }, 0.02);
  const [mx, my] = at();
  disc(c, mx, my, 0.06, { key: "", name: "", light: "#c9a46a", dark: "#6a4a22" }, 0.012);
  const [cx, cy] = at();
  disc(c, cx, cy, 0.05, { key: "", name: "", light: "#f4ecd4", dark: "#c8b88a" }, 0.012);
  glow(c, cx, cy, 0.18, "255,190,90", 0.35);
}

/** A table top seen from above. */
function tableTop(c: C, w: number, h: number, wood: Tone, round = false, seed = 3): void {
  if (round) {
    ell(c, 0, 0, w / 2, h / 2);
    fo(c, radial(c, 0, 0, Math.max(w, h) / 2, wood.light, wood.dark));
    c.strokeStyle = "rgba(40,24,12,0.25)";
    c.lineWidth = 0.012;
    ell(c, 0, 0, w * 0.38, h * 0.38);
    c.stroke();
    return;
  }
  plank(c, -w / 2, -h / 2, w, h, wood, seed);
}

const tables: PropDef[] = [
  ...family({ id: "table-square", name: "Square table", category: F, group: "Tables", w: 1.2, h: 1.2, layer: "object" }, cross(WOODS, SETTINGS), (c, v) => {
    tableTop(c, 1.1, 1.1, v.a, false, 5);
    dress(c, v.b.kind, [[0, -0.32], [0, 0.32], [-0.32, 0], [0.32, 0]], [0.6, 0.6], 11);
  }),
  ...family({ id: "table-round", name: "Round table", category: F, group: "Tables", w: 1.4, h: 1.4, layer: "object" }, cross(WOODS, SETTINGS), (c, v) => {
    tableTop(c, 1.32, 1.32, v.a, true);
    dress(c, v.b.kind, [[0, -0.42], [0.42, 0], [0, 0.42], [-0.42, 0]], [0.6, 0.6], 12);
  }),
  ...family({ id: "table-long", name: "Long table", category: F, group: "Tables", w: 3, h: 1.1, layer: "object" }, cross(WOODS, SETTINGS), (c, v) => {
    tableTop(c, 2.9, 1, v.a, false, 7);
    const places: [number, number][] = [];
    for (const x of [-1, 0, 1]) places.push([x, -0.3], [x, 0.3]);
    dress(c, v.b.kind, places, [2.2, 0.6], 13);
  }),
  ...family({ id: "table-clothed", name: "Dining table with a cloth", category: F, group: "Tables", w: 2.2, h: 1.2, layer: "object" }, CLOTHS, (c, v) => {
    tableTop(c, 2.1, 1.1, WOODS[2]);
    drape(c, -1, -0.5, 2, 1, v, 4);
    for (const x of [-0.6, 0, 0.6]) plate(c, x, 0, 0.12, "#a8562a");
  }),
  ...family({ id: "side-table", name: "Side table", category: F, group: "Tables", w: 0.7, h: 0.7, layer: "object" }, WOODS, (c, v) => {
    tableTop(c, 0.64, 0.64, v, true);
    disc(c, 0.08, -0.06, 0.07, { key: "", name: "", light: "#dfe8f0", dark: "#7a8a98" }, 0.012);
  }),
  ...family({ id: "nightstand", name: "Nightstand", category: F, group: "Tables", w: 0.6, h: 0.5, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.28, -0.23, 0.56, 0.46, v, 0.04);
    stroke(c, [-0.2, 0.02, 0.2, 0.02], 0.012, "rgba(30,18,10,0.5)");
    disc(c, 0, 0.1, 0.025, GOLD, 0.008);
    disc(c, -0.1, -0.1, 0.06, { key: "", name: "", light: "#f4ecd4", dark: "#c8b88a" }, 0.012);
  }),
  ...family({ id: "low-table", name: "Low table", category: F, group: "Tables", w: 1.2, h: 0.7, layer: "object" }, WOODS, (c, v) => {
    tableTop(c, 1.14, 0.64, v, false, 9);
    rr(c, -0.3, -0.12, 0.6, 0.24, 0.05);
    fo(c, "rgba(240,230,200,0.85)", 0.012);
  }),
  ...family({ id: "trestle-table", name: "Trestle table", category: F, group: "Tables", w: 2.4, h: 0.9, layer: "object" }, WOODS, (c, v) => {
    for (const y of [-0.3, 0, 0.3]) plank(c, -1.15, y - 0.14, 2.3, 0.28, v, 20 + y * 10);
    for (const x of [-0.9, 0.9]) stroke(c, [x, -0.42, x, 0.42], 0.05, shade(v.dark, -0.3), "butt");
  }),
];

/** A seat seen from above: a square seat with a back along the top edge. */
function seat(c: C, w: number, h: number, frame: Tone, cushion?: Tone): void {
  box(c, -w / 2, -h / 2, w, h * 0.22, frame, 0.04);
  box(c, -w / 2, -h / 2 + h * 0.18, w, h * 0.82, frame, 0.05);
  if (cushion) {
    rr(c, -w / 2 + 0.06, -h / 2 + h * 0.26, w - 0.12, h * 0.66, 0.08);
    fo(c, radial(c, 0, h * 0.1, w * 0.5, cushion.light, cushion.dark), 0.02);
  }
}

const THRONE_METALS: Tone[] = [...METALS, GOLD];
const ROYAL = CLOTHS.filter((t) => ["crimson", "navy", "violet"].includes(t.key));

const seating: PropDef[] = [
  ...family({ id: "chair-plain", name: "Plain chair", category: F, group: "Seating", w: 0.6, h: 0.6, layer: "object" }, WOODS, (c, v) => seat(c, 0.52, 0.52, v)),
  ...family({ id: "chair-cushioned", name: "Cushioned chair", category: F, group: "Seating", w: 0.65, h: 0.65, layer: "object" }, CLOTHS, (c, v) => seat(c, 0.58, 0.58, WOODS[2], v)),
  ...family({ id: "armchair-soft", name: "Soft armchair", category: F, group: "Seating", w: 1, h: 1, layer: "object" }, CLOTHS, (c, v) => {
    rr(c, -0.46, -0.44, 0.92, 0.88, 0.16);
    fo(c, linear(c, 0, -0.44, 0, 0.44, v.light, v.dark));
    for (const x of [-0.36, 0.36]) {
      rr(c, x - 0.1, -0.3, 0.2, 0.72, 0.08);
      fo(c, linear(c, x, -0.3, x, 0.4, shade(v.light, 0.1), v.dark), 0.02);
    }
    rr(c, -0.25, -0.18, 0.5, 0.56, 0.1);
    fo(c, radial(c, 0, 0.1, 0.4, shade(v.light, 0.15), v.dark), 0.02);
  }),
  ...family({ id: "couch", name: "Couch", category: F, group: "Seating", w: 2, h: 0.9, layer: "object" }, CLOTHS, (c, v) => {
    rr(c, -0.96, -0.42, 1.92, 0.84, 0.14);
    fo(c, linear(c, 0, -0.42, 0, 0.42, v.light, v.dark));
    for (const x of [-0.45, 0.45]) {
      rr(c, x - 0.42, -0.2, 0.84, 0.56, 0.1);
      fo(c, radial(c, x, 0.05, 0.5, shade(v.light, 0.12), v.dark), 0.02);
    }
  }),
  ...family({ id: "stool-round", name: "Round stool", category: F, group: "Seating", w: 0.45, h: 0.45, layer: "object" }, WOODS, (c, v) => {
    disc(c, 0, 0, 0.2, v);
    c.strokeStyle = "rgba(40,24,12,0.3)";
    c.lineWidth = 0.01;
    circle(c, 0, 0, 0.13);
    c.stroke();
  }),
  ...family({ id: "bench-plain", name: "Plain bench", category: F, group: "Seating", w: 2, h: 0.5, layer: "object" }, WOODS, (c, v) => plank(c, -0.96, -0.2, 1.92, 0.4, v, 31)),
  ...family({ id: "rocking-chair", name: "Rocking chair", category: F, group: "Seating", w: 0.7, h: 0.9, layer: "object" }, WOODS, (c, v) => {
    for (const x of [-0.3, 0.3]) stroke(c, [x, -0.4, x + 0.02, 0, x, 0.42], 0.05, shade(v.dark, -0.2));
    seat(c, 0.5, 0.6, v);
  }),
  ...family({ id: "throne-grand", name: "Grand throne", category: F, group: "Seating", w: 1.4, h: 1.3, layer: "object" }, cross(THRONE_METALS, ROYAL), (c, v) => {
    poly(c, [-0.66, -0.6, 0.66, -0.6, 0.6, 0.6, -0.6, 0.6]);
    fo(c, linear(c, -0.6, -0.6, 0.6, 0.6, v.a.light, v.a.dark));
    poly(c, [-0.5, -0.62, -0.3, -0.78, 0, -0.66, 0.3, -0.78, 0.5, -0.62]);
    fo(c, linear(c, 0, -0.8, 0, -0.6, v.a.light, v.a.dark));
    rr(c, -0.4, -0.3, 0.8, 0.8, 0.1);
    fo(c, radial(c, 0, 0.1, 0.6, v.b.light, v.b.dark), 0.02);
    disc(c, 0, -0.66, 0.06, { key: "", name: "", light: "#ff8a8a", dark: "#8a1a1a" }, 0.012);
  }),
  ...family({ id: "footstool", name: "Footstool", category: F, group: "Seating", w: 0.5, h: 0.4, layer: "object" }, CLOTHS, (c, v) => {
    rr(c, -0.23, -0.17, 0.46, 0.34, 0.08);
    fo(c, radial(c, 0, 0, 0.3, v.light, v.dark), 0.025);
  }),
];

/** A bed from above: frame, pillow, blanket turned down. */
function bed(c: C, w: number, h: number, frame: Tone, blanket: Tone, pillows: number): void {
  box(c, -w / 2, -h / 2, w, h, frame, 0.05);
  rr(c, -w / 2 + 0.06, -h / 2 + 0.06, w - 0.12, h - 0.12, 0.05);
  fo(c, "#efe8d8", 0.015);
  const pw = (w - 0.2) / pillows;
  for (let i = 0; i < pillows; i++) {
    rr(c, -w / 2 + 0.1 + i * pw, -h / 2 + 0.1, pw - 0.04, 0.3, 0.07);
    fo(c, "#fbf8f0", 0.015);
  }
  rr(c, -w / 2 + 0.06, -h / 2 + 0.52, w - 0.12, h - 0.58, 0.05);
  fo(c, linear(c, 0, -h / 2 + 0.5, 0, h / 2, blanket.light, blanket.dark), 0.02);
  stroke(c, [-w / 2 + 0.06, -h / 2 + 0.62, w / 2 - 0.06, -h / 2 + 0.62], 0.04, shade(blanket.light, 0.3), "butt");
}

const beds: PropDef[] = [
  ...family({ id: "bed-single", name: "Single bed", category: F, group: "Beds", w: 1.1, h: 2, layer: "object" }, CLOTHS, (c, v) => bed(c, 1, 1.9, WOODS[1], v, 1)),
  ...family({ id: "bed-wide", name: "Wide bed", category: F, group: "Beds", w: 2, h: 2.2, layer: "object" }, CLOTHS, (c, v) => bed(c, 1.9, 2.1, WOODS[2], v, 2)),
  ...family({ id: "bed-four-poster", name: "Four-poster bed", category: F, group: "Beds", w: 2.2, h: 2.4, layer: "object" }, CLOTHS, (c, v) => {
    bed(c, 1.9, 2.1, WOODS[4], v, 2);
    for (const [x, y] of [[-1, -1.1], [1, -1.1], [-1, 1.1], [1, 1.1]]) disc(c, x, y, 0.09, WOODS[3]);
    c.strokeStyle = shade(v.dark, -0.2);
    c.lineWidth = 0.04;
    c.strokeRect(-1, -1.1, 2, 2.2);
  }),
  ...family({ id: "bunk-bed", name: "Bunk bed", category: F, group: "Beds", w: 1.1, h: 2, layer: "object" }, WOODS, (c, v) => {
    bed(c, 1, 1.9, v, CLOTHS[1], 1);
    for (let i = 0; i < 4; i++) stroke(c, [0.5, -0.5 + i * 0.25, 0.56, -0.5 + i * 0.25], 0.04, v.dark, "butt");
  }),
  ...family({ id: "cradle", name: "Cradle", category: F, group: "Beds", w: 0.6, h: 0.9, layer: "object" }, WOODS, (c, v) => {
    ell(c, 0, 0, 0.27, 0.42);
    fo(c, radial(c, 0, 0, 0.42, v.light, v.dark));
    ell(c, 0, 0.05, 0.19, 0.32);
    fo(c, "#f4ecda", 0.015);
    ell(c, 0, -0.18, 0.12, 0.08);
    fo(c, "#fbf8f0", 0.012);
  }),
];

type Fill = Variant & { amount: number };
const FILLS: Fill[] = [
  { key: "full", name: "full", amount: 1 },
  { key: "half-full", name: "half full", amount: 0.5 },
  { key: "empty", name: "empty", amount: 0 },
];

const storage: PropDef[] = [
  ...family({ id: "wardrobe-plain", name: "Plain wardrobe", category: F, group: "Storage", w: 1.4, h: 0.7, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.68, -0.33, 1.36, 0.66, v, 0.04);
    stroke(c, [0, -0.3, 0, 0.3], 0.015, "rgba(30,18,10,0.6)");
    for (const x of [-0.06, 0.06]) disc(c, x, 0.05, 0.03, GOLD, 0.008);
  }),
  ...family({ id: "dresser-plain", name: "Chest of drawers", category: F, group: "Storage", w: 1.2, h: 0.6, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.58, -0.28, 1.16, 0.56, v, 0.04);
    for (const y of [-0.1, 0.08]) stroke(c, [-0.52, y, 0.52, y], 0.012, "rgba(30,18,10,0.5)");
    for (const [x, y] of [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0], [0.25, 0], [-0.25, 0.18], [0.25, 0.18]]) disc(c, x, y, 0.025, GOLD, 0.008);
  }),
  ...family({ id: "cabinet", name: "Cabinet", category: F, group: "Storage", w: 1, h: 0.5, layer: "object" }, WOODS, (c, v) => {
    box(c, -0.48, -0.23, 0.96, 0.46, v, 0.04);
    rr(c, -0.42, -0.17, 0.38, 0.34, 0.03);
    fo(c, shade(v.light, 0.08), 0.012);
    rr(c, 0.04, -0.17, 0.38, 0.34, 0.03);
    fo(c, shade(v.light, 0.08), 0.012);
  }),
  ...family({ id: "bookshelf-wide", name: "Wide bookshelf", category: F, group: "Storage", w: 2, h: 0.5, layer: "object" }, cross(WOODS, FILLS), (c, v) => {
    box(c, -0.98, -0.23, 1.96, 0.46, v.a, 0.03);
    rr(c, -0.92, -0.17, 1.84, 0.34, 0.02);
    fo(c, shade(v.a.dark, -0.35), 0.012);
    if (v.b.amount > 0) bookRow(c, -0.9, -0.15, 1.8 * v.b.amount, 0.3, 41);
  }),
  ...family({ id: "wall-shelf", name: "Wall shelf", category: F, group: "Storage", w: 1.6, h: 0.35, layer: "object" }, WOODS, (c, v) => {
    plank(c, -0.78, -0.15, 1.56, 0.3, v, 51);
    bookRow(c, -0.7, -0.12, 0.5, 0.22, 52);
    for (const x of [0, 0.25, 0.5]) disc(c, x, 0, 0.08, { key: "", name: "", light: "#d0784a", dark: "#8a4424" }, 0.012);
  }),
];

type Pattern = Variant & { kind: "plain" | "border" | "diamond" | "striped" };
const PATTERNS: Pattern[] = [
  { key: "plain", name: "plain", kind: "plain" },
  { key: "bordered", name: "bordered", kind: "border" },
  { key: "diamond", name: "diamond", kind: "diamond" },
  { key: "striped", name: "striped", kind: "striped" },
];

function rug(c: C, w: number, h: number, t: Tone, kind: Pattern["kind"]): void {
  rr(c, -w / 2, -h / 2, w, h, 0.05);
  fo(c, radial(c, 0, 0, Math.max(w, h) * 0.6, t.light, t.dark), 0.02);
  const trim = shade(t.light, t.key === "white" ? -0.35 : 0.45);
  c.save();
  rr(c, -w / 2, -h / 2, w, h, 0.05);
  c.clip();
  if (kind === "border") {
    c.strokeStyle = trim;
    c.lineWidth = 0.06;
    c.strokeRect(-w / 2 + 0.12, -h / 2 + 0.12, w - 0.24, h - 0.24);
  } else if (kind === "diamond") {
    poly(c, [0, -h * 0.36, w * 0.36, 0, 0, h * 0.36, -w * 0.36, 0]);
    c.lineWidth = 0.05;
    c.strokeStyle = trim;
    c.stroke();
    disc(c, 0, 0, Math.min(w, h) * 0.08, { key: "", name: "", light: trim, dark: shade(trim, -0.3) }, 0.01);
  } else if (kind === "striped") {
    c.fillStyle = trim;
    for (let x = -w / 2 + 0.15; x < w / 2; x += 0.3) c.fillRect(x, -h / 2, 0.1, h);
  }
  c.restore();
  // Tassels along the short ends.
  for (const y of [-h / 2, h / 2]) for (let x = -w / 2 + 0.06; x < w / 2; x += 0.08) stroke(c, [x, y, x, y + (y < 0 ? -0.06 : 0.06)], 0.012, trim);
}

type Pelt = Variant & { tone: Tone };
const PELTS: Pelt[] = [
  { key: "brown", name: "brown", tone: { key: "", name: "", light: "#9a6a3e", dark: "#4a2e18" } },
  { key: "white", name: "white", tone: { key: "", name: "", light: "#fbf7ee", dark: "#c4baa4" } },
  { key: "black", name: "black", tone: { key: "", name: "", light: "#55504a", dark: "#1a1816" } },
  { key: "grey", name: "grey", tone: { key: "", name: "", light: "#b4b0aa", dark: "#5e5a54" } },
];

const rugs: PropDef[] = [
  ...family({ id: "rug", name: "Rug", category: F, group: "Rugs", w: 2, h: 1.4, layer: "floor" }, cross(CLOTHS, PATTERNS), (c, v) => rug(c, 1.9, 1.3, v.a, v.b.kind)),
  ...family({ id: "rug-oval", name: "Oval rug", category: F, group: "Rugs", w: 1.8, h: 1.2, layer: "floor" }, CLOTHS, (c, v) => {
    ell(c, 0, 0, 0.88, 0.58);
    fo(c, radial(c, 0, 0, 0.9, v.light, v.dark), 0.02);
    c.strokeStyle = shade(v.light, 0.4);
    c.lineWidth = 0.05;
    ell(c, 0, 0, 0.7, 0.44);
    c.stroke();
  }),
  ...family({ id: "runner", name: "Runner", category: F, group: "Rugs", w: 3, h: 0.8, layer: "floor" }, CLOTHS, (c, v) => rug(c, 2.9, 0.7, v, "border")),
  ...family({ id: "pelt-rug", name: "Pelt rug", category: F, group: "Rugs", w: 1.6, h: 1.2, layer: "floor" }, PELTS, (c, v) => {
    poly(c, [-0.75, -0.1, -0.5, -0.5, -0.2, -0.38, 0.2, -0.38, 0.5, -0.5, 0.75, -0.1, 0.55, 0.2, 0.7, 0.55, 0.25, 0.4, 0, 0.56, -0.25, 0.4, -0.7, 0.55, -0.55, 0.2]);
    fo(c, radial(c, 0, 0, 0.8, v.tone.light, v.tone.dark), 0.02);
  }),
];

const MIRROR_FRAMES = [...METALS.map((m) => ({ key: m.key, name: m.name, tone: m })), ...WOODS.slice(1, 3).map((w) => ({ key: w.key, name: w.name, tone: w }))];

const decor: PropDef[] = [
  ...family({ id: "mirror-standing", name: "Standing mirror", category: F, group: "Screens and decor", w: 0.7, h: 0.3, layer: "object" }, MIRROR_FRAMES, (c, v) => {
    rr(c, -0.33, -0.12, 0.66, 0.24, 0.06);
    fo(c, linear(c, -0.3, 0, 0.3, 0, v.tone.light, v.tone.dark));
    rr(c, -0.27, -0.07, 0.54, 0.14, 0.04);
    fo(c, linear(c, -0.27, -0.07, 0.27, 0.07, "#eef6fb", "#9ab8c8"), 0.012);
  }),
  ...family({ id: "screen-painted", name: "Painted screen", category: F, group: "Screens and decor", w: 1.8, h: 0.4, layer: "object" }, CLOTHS, (c, v) => {
    const panels = [-0.6, -0.2, 0.2, 0.6];
    panels.forEach((x, i) => {
      c.save();
      c.translate(x, i % 2 ? 0.04 : -0.04);
      c.rotate(i % 2 ? -0.15 : 0.15);
      rr(c, -0.2, -0.06, 0.4, 0.12, 0.02);
      fo(c, linear(c, -0.2, 0, 0.2, 0, v.light, v.dark), 0.02);
      c.restore();
    });
  }),
  ...family({ id: "coat-rack", name: "Coat rack", category: F, group: "Screens and decor", w: 0.6, h: 0.6, layer: "object" }, WOODS, (c, v) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      stroke(c, [0, 0, Math.cos(a) * 0.24, Math.sin(a) * 0.24], 0.04, v.dark);
    }
    disc(c, 0, 0, 0.07, v);
    ell(c, 0.12, 0.05, 0.12, 0.07, 0.5);
    fo(c, "#6a3a2a", 0.015);
  }),
  ...family({ id: "harpsichord", name: "Harpsichord", category: F, group: "Screens and decor", w: 1.2, h: 2, layer: "object" }, WOODS, (c, v) => {
    poly(c, [-0.55, -0.95, 0.55, -0.95, 0.55, -0.3, 0.2, 0.95, -0.55, 0.95]);
    fo(c, linear(c, -0.5, -0.9, 0.5, 0.9, v.light, v.dark));
    rr(c, -0.5, -0.92, 1, 0.2, 0.02);
    fo(c, "#f6f2e6", 0.012);
    for (let x = -0.45; x < 0.48; x += 0.07) stroke(c, [x, -0.92, x, -0.82], 0.012, "#1a1a1a", "butt");
  }),
];

export const FURNITURE_PROPS: PropDef[] = [...tables, ...seating, ...beds, ...storage, ...rugs, ...decor];

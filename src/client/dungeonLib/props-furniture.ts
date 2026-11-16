// Copied from Dungeon (src/render/props-furniture.ts) by scripts/sync-dungeon-library.mjs, Dungeon 0b1f460. Change it there and run the script again.
import { rng } from "./noise";
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, CLOTHS, GOLD, cross, family, shade, ell, poly, fo, box, disc, plank, drape, plate, bookRow, glow, stroke, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

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

/**
 * What's on a table top in 3D (solid.ts), `y` metres up, where its drawing (dress) puts it: plates
 * and cups at the places, or papers, a book, a mug and a lit candle (the same draws of the dice).
 */
function laid(kind: Setting["kind"], places: [number, number][], y: number, spread: [number, number], seed: number): S.Part[] {
  if (kind === "set") return places.flatMap(([x, z]) => [S.cyl(0.13, y, y + 0.02, "#ece6d8", { x, z }), S.cyl(0.05, y, y + 0.11, "#c8b47a", { x: x + 0.17, z: z - 0.1, n: 6 })]);
  if (kind !== "cluttered") return [];
  const r = rng(seed);
  const at = () => [(r() - 0.5) * spread[0], (r() - 0.5) * spread[1]] as const;
  const [px, pz] = at();
  r();
  const [bx, bz] = at();
  const [mx, mz] = at();
  const [cx, cz] = at();
  return [
    S.cbox(0.28, 0.2, y, y + 0.006, "#efe6cc", px, pz),
    S.cbox(0.24, 0.18, y, y + 0.06, "#6a2a1e", bx, bz),
    S.cyl(0.06, y, y + 0.12, "#9a7446", { x: mx, z: mz, n: 6 }),
    S.cyl(0.05, y, y + 0.16, "#f4ecd4", { x: cx, z: cz, n: 6 }),
    ...S.fire(cx, cz, y + 0.16, 0.07, 0.03),
  ];
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
  ...family({ id: "table-square", name: "Square table", category: F, group: "Tables", w: 1.2, h: 1.2, layer: "object", form: (v) => S.plus(S.table(0.76, v.a), laid(v.b.kind, [[0, -0.32], [0, 0.32], [-0.32, 0], [0.32, 0]], 0.76, [0.6, 0.6], 11)) }, cross(WOODS, SETTINGS), (c, v) => {
    tableTop(c, 1.1, 1.1, v.a, false, 5);
    dress(c, v.b.kind, [[0, -0.32], [0, 0.32], [-0.32, 0], [0.32, 0]], [0.6, 0.6], 11);
  }),
  ...family({ id: "table-round", name: "Round table", category: F, group: "Tables", w: 1.4, h: 1.4, layer: "object", form: (v) => S.plus(S.roundTable(0.76, v.a), laid(v.b.kind, [[0, -0.42], [0.42, 0], [0, 0.42], [-0.42, 0]], 0.76, [0.6, 0.6], 12)) }, cross(WOODS, SETTINGS), (c, v) => {
    tableTop(c, 1.32, 1.32, v.a, true);
    dress(c, v.b.kind, [[0, -0.42], [0.42, 0], [0, 0.42], [-0.42, 0]], [0.6, 0.6], 12);
  }),
  ...family({ id: "table-long", name: "Long table", category: F, group: "Tables", w: 3, h: 1.1, layer: "object", form: (v) => S.plus(S.table(0.76, v.a), laid(v.b.kind, [[-1, -0.3], [-1, 0.3], [0, -0.3], [0, 0.3], [1, -0.3], [1, 0.3]], 0.76, [2.2, 0.6], 13)) }, cross(WOODS, SETTINGS), (c, v) => {
    tableTop(c, 2.9, 1, v.a, false, 7);
    const places: [number, number][] = [];
    for (const x of [-1, 0, 1]) places.push([x, -0.3], [x, 0.3]);
    dress(c, v.b.kind, places, [2.2, 0.6], 13);
  }),
  ...family({ id: "table-clothed", name: "Dining table with a cloth", category: F, group: "Tables", w: 2.2, h: 1.2, layer: "object", form: (v) => S.plus(S.table(0.76, WOODS[2]), S.box(-1, 1, -0.5, 0.5, 0.76, 0.775, v), [-0.6, 0, 0.6].map((x) => S.cyl(0.12, 0.775, 0.795, "#ece6d8", { x }))) }, CLOTHS, (c, v) => {
    tableTop(c, 2.1, 1.1, WOODS[2]);
    drape(c, -1, -0.5, 2, 1, v, 4);
    for (const x of [-0.6, 0, 0.6]) plate(c, x, 0, 0.12, "#a8562a");
  }),
  ...family({ id: "side-table", name: "Side table", category: F, group: "Tables", w: 0.7, h: 0.7, layer: "object", form: (v) => S.plus(S.roundTable(0.68, v), S.cyl(0.07, 0.68, 0.9, "#a8b8c8", { x: 0.08, z: -0.06, top: 0.7, n: 8 })) }, WOODS, (c, v) => {
    tableTop(c, 0.64, 0.64, v, true);
    disc(c, 0.08, -0.06, 0.07, { key: "", name: "", light: "#dfe8f0", dark: "#7a8a98" }, 0.012);
  }),
  ...family({ id: "nightstand", name: "Nightstand", category: F, group: "Tables", w: 0.6, h: 0.5, layer: "object", form: (v) => S.plus(S.tall(0.62, v, { front: v.light }), S.cyl(0.05, 0.62, 0.78, "#efe6cc", { x: -0.1, z: -0.1, n: 6 }), S.fire(-0.1, -0.1, 0.78, 0.07, 0.03)) }, WOODS, (c, v) => {
    box(c, -0.28, -0.23, 0.56, 0.46, v, 0.04);
    stroke(c, [-0.2, 0.02, 0.2, 0.02], 0.012, "rgba(30,18,10,0.5)");
    disc(c, 0, 0.1, 0.025, GOLD, 0.008);
    disc(c, -0.1, -0.1, 0.06, { key: "", name: "", light: "#f4ecd4", dark: "#c8b88a" }, 0.012);
  }),
  ...family({ id: "low-table", name: "Low table", category: F, group: "Tables", w: 1.2, h: 0.7, layer: "object", form: (v) => S.plus(S.table(0.42, v), S.box(-0.3, 0.3, -0.12, 0.12, 0.42, 0.425, "#efe6cc")) }, WOODS, (c, v) => {
    tableTop(c, 1.14, 0.64, v, false, 9);
    rr(c, -0.3, -0.12, 0.6, 0.24, 0.05);
    fo(c, "rgba(240,230,200,0.85)", 0.012);
  }),
  ...family({ id: "trestle-table", name: "Trestle table", category: F, group: "Tables", w: 2.4, h: 0.9, layer: "object", form: (v) => S.solid([S.box(-1.15, 1.15, -0.44, 0.44, 0.71, 0.76, v), S.box(-0.93, -0.87, -0.4, 0.4, 0, 0.71, v.dark), S.box(0.87, 0.93, -0.4, 0.4, 0, 0.71, v.dark), S.box(-0.9, 0.9, -0.03, 0.03, 0.22, 0.3, v.dark)], { surface: 0.76 }) }, WOODS, (c, v) => {
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
  ...family({ id: "chair-plain", name: "Plain chair", category: F, group: "Seating", w: 0.6, h: 0.6, layer: "object", form: (v) => S.seat(0.46, 0.95, v) }, WOODS, (c, v) => seat(c, 0.52, 0.52, v)),
  ...family({ id: "chair-cushioned", name: "Cushioned chair", category: F, group: "Seating", w: 0.65, h: 0.65, layer: "object", form: (v) => S.seat(0.46, 0.98, WOODS[2], { cushion: v }) }, CLOTHS, (c, v) => seat(c, 0.58, 0.58, WOODS[2], v)),
  ...family({ id: "armchair-soft", name: "Soft armchair", category: F, group: "Seating", w: 1, h: 1, layer: "object", form: (v) => S.seat(0.42, 0.95, v, { armY: 0.65, legs: false, backDepth: 0.2 }) }, CLOTHS, (c, v) => {
    rr(c, -0.46, -0.44, 0.92, 0.88, 0.16);
    fo(c, linear(c, 0, -0.44, 0, 0.44, v.light, v.dark));
    for (const x of [-0.36, 0.36]) {
      rr(c, x - 0.1, -0.3, 0.2, 0.72, 0.08);
      fo(c, linear(c, x, -0.3, x, 0.4, shade(v.light, 0.1), v.dark), 0.02);
    }
    rr(c, -0.25, -0.18, 0.5, 0.56, 0.1);
    fo(c, radial(c, 0, 0.1, 0.4, shade(v.light, 0.15), v.dark), 0.02);
  }),
  ...family({ id: "couch", name: "Couch", category: F, group: "Seating", w: 2, h: 0.9, layer: "object", form: (v) => S.seat(0.42, 0.9, v, { armY: 0.62, legs: false, backDepth: 0.2 }) }, CLOTHS, (c, v) => {
    rr(c, -0.96, -0.42, 1.92, 0.84, 0.14);
    fo(c, linear(c, 0, -0.42, 0, 0.42, v.light, v.dark));
    for (const x of [-0.45, 0.45]) {
      rr(c, x - 0.42, -0.2, 0.84, 0.56, 0.1);
      fo(c, radial(c, x, 0.05, 0.5, shade(v.light, 0.12), v.dark), 0.02);
    }
  }),
  ...family({ id: "stool-round", name: "Round stool", category: F, group: "Seating", w: 0.45, h: 0.45, layer: "object", form: (v) => S.stool(0.46, v) }, WOODS, (c, v) => {
    disc(c, 0, 0, 0.2, v);
    c.strokeStyle = "rgba(40,24,12,0.3)";
    c.lineWidth = 0.01;
    circle(c, 0, 0, 0.13);
    c.stroke();
  }),
  ...family({ id: "bench-plain", name: "Plain bench", category: F, group: "Seating", w: 2, h: 0.5, layer: "object", form: (v) => S.table(0.45, v) }, WOODS, (c, v) => plank(c, -0.96, -0.2, 1.92, 0.4, v, 31)),
  ...family({ id: "rocking-chair", name: "Rocking chair", category: F, group: "Seating", w: 0.7, h: 0.9, layer: "object", form: (v) => S.solid([S.box(-0.325, -0.275, -0.4, 0.42, 0, 0.08, v.dark), S.box(0.275, 0.325, -0.4, 0.42, 0, 0.08, v.dark), S.legs(-0.25, 0.25, -0.3, 0.3, 0.38, v, 0.05), S.box(-0.25, 0.25, -0.3, 0.3, 0.38, 0.45, v), S.box(-0.25, 0.25, -0.3, -0.17, 0.45, 1.05, v)], { surface: 0.45 }) }, WOODS, (c, v) => {
    for (const x of [-0.3, 0.3]) stroke(c, [x, -0.4, x + 0.02, 0, x, 0.42], 0.05, shade(v.dark, -0.2));
    seat(c, 0.5, 0.6, v);
  }),
  ...family({ id: "throne-grand", name: "Grand throne", category: F, group: "Seating", w: 1.4, h: 1.3, layer: "object", form: (v) => S.seat(0.5, 1.9, v.a, { cushion: v.b, armY: 0.85, legs: false, backDepth: 0.26 }) }, cross(THRONE_METALS, ROYAL), (c, v) => {
    poly(c, [-0.66, -0.6, 0.66, -0.6, 0.6, 0.6, -0.6, 0.6]);
    fo(c, linear(c, -0.6, -0.6, 0.6, 0.6, v.a.light, v.a.dark));
    poly(c, [-0.5, -0.62, -0.3, -0.78, 0, -0.66, 0.3, -0.78, 0.5, -0.62]);
    fo(c, linear(c, 0, -0.8, 0, -0.6, v.a.light, v.a.dark));
    rr(c, -0.4, -0.3, 0.8, 0.8, 0.1);
    fo(c, radial(c, 0, 0.1, 0.6, v.b.light, v.b.dark), 0.02);
    disc(c, 0, -0.66, 0.06, { key: "", name: "", light: "#ff8a8a", dark: "#8a1a1a" }, 0.012);
  }),
  ...family({ id: "footstool", name: "Footstool", category: F, group: "Seating", w: 0.5, h: 0.4, layer: "object", form: (v) => S.block(0.35, v, { top: 0.92, surface: true }) }, CLOTHS, (c, v) => {
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
  ...family({ id: "bed-single", name: "Single bed", category: F, group: "Beds", w: 1.1, h: 2, layer: "object", form: (v) => S.bed(0.55, 1.0, WOODS[1], v) }, CLOTHS, (c, v) => bed(c, 1, 1.9, WOODS[1], v, 1)),
  ...family({ id: "bed-wide", name: "Wide bed", category: F, group: "Beds", w: 2, h: 2.2, layer: "object", form: (v) => S.bed(0.55, 1.05, WOODS[2], v, { pillows: 2 }) }, CLOTHS, (c, v) => bed(c, 1.9, 2.1, WOODS[2], v, 2)),
  ...family({ id: "bed-four-poster", name: "Four-poster bed", category: F, group: "Beds", w: 2.2, h: 2.4, layer: "object", form: (v) => S.solid([(S.bed(0.6, 1.1, WOODS[4], v, { pillows: 2 })(1.9, 2.1) as S.Solid).parts, [[-1, -1.1], [1, -1.1], [-1, 1.1], [1, 1.1]].map(([x, z]) => S.post(x, z, 0.09, 0, 2.2, WOODS[3], 8)), S.box(-1, 1, -1.12, -1.08, 2.1, 2.2, WOODS[3]), S.box(-1, 1, 1.08, 1.12, 2.1, 2.2, WOODS[3]), S.box(-1.02, -0.98, -1.1, 1.1, 2.1, 2.2, WOODS[3]), S.box(0.98, 1.02, -1.1, 1.1, 2.1, 2.2, WOODS[3])], { surface: 0.6, note: "you see under its frame to the bed" }) }, CLOTHS, (c, v) => {
    bed(c, 1.9, 2.1, WOODS[4], v, 2);
    for (const [x, y] of [[-1, -1.1], [1, -1.1], [-1, 1.1], [1, 1.1]]) disc(c, x, y, 0.09, WOODS[3]);
    c.strokeStyle = shade(v.dark, -0.2);
    c.lineWidth = 0.04;
    c.strokeRect(-1, -1.1, 2, 2.2);
  }),
  ...family({ id: "bunk-bed", name: "Bunk bed", category: F, group: "Beds", w: 1.1, h: 2, layer: "object", form: (v) => S.solid([[[-0.5, -0.92], [0.5, -0.92], [-0.5, 0.92], [0.5, 0.92]].map(([x, z]) => S.cbox(0.08, 0.08, 0, 1.9, v, x, z)), S.box(-0.5, 0.5, -0.95, 0.95, 0.25, 0.4, v), S.box(-0.47, 0.47, -0.92, 0.92, 0.4, 0.5, "#efe8d8"), S.box(-0.5, 0.5, -0.95, 0.95, 1.3, 1.45, v), S.box(-0.47, 0.47, -0.92, 0.92, 1.45, 1.55, "#efe8d8"), S.box(-0.47, 0.47, -0.4, 0.92, 1.55, 1.6, CLOTHS[1]), S.box(-0.4, 0.4, -0.88, -0.6, 1.55, 1.65, "#fbf8f0"), [0.4, 0.75, 1.1, 1.45].map((y) => S.limb([0.53, y, -0.2], [0.53, y, 0.2], 0.018, 0.018, v.dark, { n: 4 })), S.limb([0.53, 0, -0.2], [0.53, 1.65, -0.2], 0.022, 0.022, v.dark, { n: 4 }), S.limb([0.53, 0, 0.2], [0.53, 1.65, 0.2], 0.022, 0.022, v.dark, { n: 4 })], { surface: 1.6 }) }, WOODS, (c, v) => {
    bed(c, 1, 1.9, v, CLOTHS[1], 1);
    for (let i = 0; i < 4; i++) stroke(c, [0.5, -0.5 + i * 0.25, 0.56, -0.5 + i * 0.25], 0.04, v.dark, "butt");
  }),
  ...family({ id: "cradle", name: "Cradle", category: F, group: "Beds", w: 0.6, h: 0.9, layer: "object", form: (v) => S.solid([S.box(-0.3, 0.3, -0.28, -0.22, 0, 0.16, v.dark), S.box(-0.3, 0.3, 0.22, 0.28, 0, 0.16, v.dark), S.cyl(0.27, 0.14, 0.62, v, { rz: 0.42, n: 12, hollow: 0.72, floor: 0.38 }), S.cyl(0.19, 0.38, 0.42, "#f4ecda", { rz: 0.32, z: 0.05, n: 10 }), S.ball(0.12, 0.38, 0.47, "#fbf8f0", { z: -0.18, rz: 0.08, n: 6 })]) }, WOODS, (c, v) => {
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
  ...family({ id: "wardrobe-plain", name: "Plain wardrobe", category: F, group: "Storage", w: 1.4, h: 0.7, layer: "object", form: (v) => S.tall(2.0, v, { front: v.light }) }, WOODS, (c, v) => {
    box(c, -0.68, -0.33, 1.36, 0.66, v, 0.04);
    stroke(c, [0, -0.3, 0, 0.3], 0.015, "rgba(30,18,10,0.6)");
    for (const x of [-0.06, 0.06]) disc(c, x, 0.05, 0.03, GOLD, 0.008);
  }),
  ...family({ id: "dresser-plain", name: "Chest of drawers", category: F, group: "Storage", w: 1.2, h: 0.6, layer: "object", form: (v) => S.tall(0.95, v, { front: v.light }) }, WOODS, (c, v) => {
    box(c, -0.58, -0.28, 1.16, 0.56, v, 0.04);
    for (const y of [-0.1, 0.08]) stroke(c, [-0.52, y, 0.52, y], 0.012, "rgba(30,18,10,0.5)");
    for (const [x, y] of [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0], [0.25, 0], [-0.25, 0.18], [0.25, 0.18]]) disc(c, x, y, 0.025, GOLD, 0.008);
  }),
  ...family({ id: "cabinet", name: "Cabinet", category: F, group: "Storage", w: 1, h: 0.5, layer: "object", form: (v) => S.tall(1.0, v, { front: v.light }) }, WOODS, (c, v) => {
    box(c, -0.48, -0.23, 0.96, 0.46, v, 0.04);
    rr(c, -0.42, -0.17, 0.38, 0.34, 0.03);
    fo(c, shade(v.light, 0.08), 0.012);
    rr(c, 0.04, -0.17, 0.38, 0.34, 0.03);
    fo(c, shade(v.light, 0.08), 0.012);
  }),
  ...family({ id: "bookshelf-wide", name: "Wide bookshelf", category: F, group: "Storage", w: 2, h: 0.5, layer: "object", form: (v) => S.bookcase(2.1, v.a, { fill: v.b.amount === 0 ? ["#2a1e16"] : v.b.amount < 1 ? [S.BOOKS[0], "#2a1e16", S.BOOKS[2], "#2a1e16", S.BOOKS[1]] : S.BOOKS }) }, cross(WOODS, FILLS), (c, v) => {
    box(c, -0.98, -0.23, 1.96, 0.46, v.a, 0.03);
    rr(c, -0.92, -0.17, 1.84, 0.34, 0.02);
    fo(c, shade(v.a.dark, -0.35), 0.012);
    if (v.b.amount > 0) bookRow(c, -0.9, -0.15, 1.8 * v.b.amount, 0.3, 41);
  }),
  ...family({ id: "wall-shelf", name: "Wall shelf", category: F, group: "Storage", w: 1.6, h: 0.35, layer: "object", form: (v) => S.solid([S.box(-0.78, 0.78, -0.15, 0.15, 1.45, 1.5, v), S.box(-0.7, -0.2, -0.12, 0.1, 1.5, 1.72, "#6a3a2e"), [0, 0.25, 0.5].map((x) => S.cyl(0.08, 1.5, 1.66, "#b06a40", { x, n: 8 }))], { note: "a shelf on the wall, up at shoulder height" }) }, WOODS, (c, v) => {
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
  ...family({ id: "rug", name: "Rug", category: F, group: "Rugs", w: 2, h: 1.4, layer: "floor", form: () => S.flat("a rug on the floor") }, cross(CLOTHS, PATTERNS), (c, v) => rug(c, 1.9, 1.3, v.a, v.b.kind)),
  ...family({ id: "rug-oval", name: "Oval rug", category: F, group: "Rugs", w: 1.8, h: 1.2, layer: "floor", form: () => S.flat("a rug on the floor") }, CLOTHS, (c, v) => {
    ell(c, 0, 0, 0.88, 0.58);
    fo(c, radial(c, 0, 0, 0.9, v.light, v.dark), 0.02);
    c.strokeStyle = shade(v.light, 0.4);
    c.lineWidth = 0.05;
    ell(c, 0, 0, 0.7, 0.44);
    c.stroke();
  }),
  ...family({ id: "runner", name: "Runner", category: F, group: "Rugs", w: 3, h: 0.8, layer: "floor", form: () => S.flat("a runner on the floor") }, CLOTHS, (c, v) => rug(c, 2.9, 0.7, v, "border")),
  ...family({ id: "pelt-rug", name: "Pelt rug", category: F, group: "Rugs", w: 1.6, h: 1.2, layer: "floor", form: () => S.flat("a pelt on the floor") }, PELTS, (c, v) => {
    poly(c, [-0.75, -0.1, -0.5, -0.5, -0.2, -0.38, 0.2, -0.38, 0.5, -0.5, 0.75, -0.1, 0.55, 0.2, 0.7, 0.55, 0.25, 0.4, 0, 0.56, -0.25, 0.4, -0.7, 0.55, -0.55, 0.2]);
    fo(c, radial(c, 0, 0, 0.8, v.tone.light, v.tone.dark), 0.02);
  }),
];

const MIRROR_FRAMES = [...METALS.map((m) => ({ key: m.key, name: m.name, tone: m })), ...WOODS.slice(1, 3).map((w) => ({ key: w.key, name: w.name, tone: w }))];

const decor: PropDef[] = [
  ...family({ id: "mirror-standing", name: "Standing mirror", category: F, group: "Screens and decor", w: 0.7, h: 0.3, layer: "object", form: (v) => S.solid([S.box(-0.33, 0.33, -0.12, 0.12, 0, 0.06, v.tone), S.box(-0.33, 0.33, -0.04, 0.04, 0.06, 1.75, v.tone), S.box(-0.27, 0.27, 0.04, 0.055, 0.14, 1.67, "#c8dce8")]) }, MIRROR_FRAMES, (c, v) => {
    rr(c, -0.33, -0.12, 0.66, 0.24, 0.06);
    fo(c, linear(c, -0.3, 0, 0.3, 0, v.tone.light, v.tone.dark));
    rr(c, -0.27, -0.07, 0.54, 0.14, 0.04);
    fo(c, linear(c, -0.27, -0.07, 0.27, 0.07, "#eef6fb", "#9ab8c8"), 0.012);
  }),
  ...family({ id: "screen-painted", name: "Painted screen", category: F, group: "Screens and decor", w: 1.8, h: 0.4, layer: "object", form: (v) => S.solid([-0.6, -0.2, 0.2, 0.6].map((x, i) => { const a = i % 2 ? -0.15 : 0.15, z = i % 2 ? 0.04 : -0.04; return S.panel(x - 0.2 * Math.cos(a), z - 0.2 * Math.sin(a), x + 0.2 * Math.cos(a), z + 0.2 * Math.sin(a), 0.06, 0, 1.7, v); })) }, CLOTHS, (c, v) => {
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
  ...family({ id: "coat-rack", name: "Coat rack", category: F, group: "Screens and decor", w: 0.6, h: 0.6, layer: "object", form: (v) => S.solid([[0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.4; return S.limb([0, 0.12, 0], [Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24], 0.025, 0.02, v.dark, { n: 4 }); }), S.cyl(0.035, 0, 1.8, v, { n: 6 }), S.ball(0.06, 1.78, 1.88, v), S.ball(0.12, 1.0, 1.65, "#6a3a2a", { x: 0.12, z: 0.05, rz: 0.08, n: 6 })]) }, WOODS, (c, v) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      stroke(c, [0, 0, Math.cos(a) * 0.24, Math.sin(a) * 0.24], 0.04, v.dark);
    }
    disc(c, 0, 0, 0.07, v);
    ell(c, 0.12, 0.05, 0.12, 0.07, 0.5);
    fo(c, "#6a3a2a", 0.015);
  }),
  ...family({ id: "harpsichord", name: "Harpsichord", category: F, group: "Screens and decor", w: 1.2, h: 2, layer: "object", form: (v) => S.solid([[[-0.5, -0.85], [0.5, -0.85], [-0.5, 0.85], [0.15, 0.8]].map(([x, z]) => S.post(x, z, 0.04, 0, 0.62, v.dark)), S.slab([-0.55, -0.95, 0.55, -0.95, 0.55, -0.3, 0.2, 0.95, -0.55, 0.95], 0.62, 0.95, v), S.box(-0.5, 0.5, -0.92, -0.72, 0.75, 0.8, "#f6f2e6")], { surface: 0.95 }) }, WOODS, (c, v) => {
    poly(c, [-0.55, -0.95, 0.55, -0.95, 0.55, -0.3, 0.2, 0.95, -0.55, 0.95]);
    fo(c, linear(c, -0.5, -0.9, 0.5, 0.9, v.light, v.dark));
    rr(c, -0.5, -0.92, 1, 0.2, 0.02);
    fo(c, "#f6f2e6", 0.012);
    for (let x = -0.45; x < 0.48; x += 0.07) stroke(c, [x, -0.92, x, -0.82], 0.012, "#1a1a1a", "butt");
  }),
];

export const FURNITURE_PROPS: PropDef[] = [...tables, ...seating, ...beds, ...storage, ...rugs, ...decor];

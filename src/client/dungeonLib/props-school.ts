// Copied from Dungeon (src/render/props-school.ts) by scripts/sync-dungeon-library.mjs, Dungeon b102367. Change it there and run the script again.
import { rng } from "./noise";
import { rr, linear } from "./propkit";
import { WOODS, CLOTHS, cross, vary, family, shade, ell, fo, box, disc, plank, drape, stroke, type C, type Tone } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// The schoolroom (17 November 2026): a blackboard on the wall and one on an easel, writing
// slates, coat pegs on the wall, and pupils' desks with their benches joined on, for a village
// school. In Furniture, group Schoolroom.

const F = "Furniture" as const;
const G = "Schoolroom";
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const pickWoods = (...keys: string[]) => WOODS.filter((w) => keys.includes(w.key));
/** The board's black-green painted face, and the chalk on it. */
const FACE = tone("#3a4a42", "#1c2622");
const CHALK = "#e8ece4";
const SLATE = tone("#5e646c", "#2e3238");
const LESSON = [vary("lesson", "with a lesson on it"), vary("clean", "wiped clean")];

/** Chalk writing on a board seen from the front, squashed into a strip (lines of letters and a sum). */
function chalkLines(c: C, x0: number, y0: number, w: number, h: number, seed: number): void {
  const r = rng(seed);
  const rows = 3;
  for (let i = 0; i < rows; i++) {
    const y = y0 + (h * (i + 0.6)) / (rows + 0.4);
    let x = x0 + w * 0.05;
    const end = x0 + w * (i === rows - 1 ? 0.55 : 0.9);
    while (x < end) {
      const lw = w * (0.02 + r() * 0.04);
      stroke(c, [x, y, x + lw * 0.4, y - h * 0.08, x + lw, y + h * 0.02], Math.min(0.022, h * 0.09), CHALK);
      x += lw + w * 0.02;
    }
  }
  // A sum in the corner: two strokes and a line under them.
  stroke(c, [x0 + w * 0.72, y0 + h * 0.62, x0 + w * 0.82, y0 + h * 0.62], 0.016, CHALK);
  stroke(c, [x0 + w * 0.7, y0 + h * 0.86, x0 + w * 0.9, y0 + h * 0.86], 0.016, CHALK);
}

/** A writing slate in its wooden frame, seen from above, at (x, y), w by h, turned a little. */
function slate(c: C, x: number, y: number, w: number, h: number, rot: number, written: boolean, seed: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  rr(c, -w / 2, -h / 2, w, h, 0.012);
  fo(c, linear(c, -w / 2, -h / 2, w / 2, h / 2, "#c49a62", "#7a5430"), 0.008);
  rr(c, -w / 2 + 0.018, -h / 2 + 0.018, w - 0.036, h - 0.036, 0.006);
  fo(c, linear(c, 0, -h / 2, 0, h / 2, SLATE.light, SLATE.dark), 0.004);
  if (written) {
    const r = rng(seed);
    for (let i = 0; i < 3; i++) {
      const yy = -h / 2 + 0.035 + i * ((h - 0.06) / 3);
      stroke(c, [-w / 2 + 0.03, yy, -w / 2 + 0.03 + (w - 0.07) * (0.4 + r() * 0.5), yy], 0.008, "#d8dcd6");
    }
  }
  c.restore();
}

const boards: PropDef[] = [
  // On the wall: a painted board in a frame, its ledge for chalk and the duster. Drawn tipped
  // towards the viewer so the face and its lesson show, as a battle map draws things on walls.
  ...family({ id: "blackboard", name: "Blackboard", category: F, group: G, w: 2.4, h: 0.3, layer: "object",
    form: (v) => S.solid([
      S.box(-1.1, 1.1, -0.15, -0.12, 0.92, 2.0, FACE),
      S.box(-1.17, 1.17, -0.15, -0.1, 2.0, 2.07, v.a),
      S.box(-1.17, -1.1, -0.15, -0.1, 0.86, 2.0, v.a),
      S.box(1.1, 1.17, -0.15, -0.1, 0.86, 2.0, v.a),
      S.box(-1.17, 1.17, -0.15, 0.02, 0.86, 0.92, v.a),
      S.box(-0.62, -0.52, -0.06, -0.03, 0.92, 0.94, CHALK),
      S.box(-0.45, -0.38, -0.05, -0.02, 0.92, 0.94, CHALK),
      S.box(0.48, 0.68, -0.09, -0.02, 0.92, 0.97, "#8a6a48"),
      ...(v.b.key === "lesson" ? [0, 1, 2].map((i) => S.box(-0.95, i === 2 ? 0.1 : 0.85, -0.121, -0.118, 1.72 - i * 0.24, 1.75 - i * 0.24, "#c8ccc4")) : []),
    ], { note: "a board on the wall, drawn tipped towards the viewer so its face shows" }),
  }, cross(pickWoods("pale", "walnut", "ebony"), LESSON), (c, v) => {
    box(c, -1.2, -0.15, 2.4, 0.22, v.a, 0.02);
    rr(c, -1.12, -0.12, 2.24, 0.16, 0.01);
    fo(c, linear(c, 0, -0.12, 0, 0.04, FACE.light, FACE.dark), 0.01);
    if (v.b.key === "lesson") chalkLines(c, -1.1, -0.12, 2.2, 0.16, 7101);
    else stroke(c, [-0.8, -0.05, -0.2, -0.07, 0.4, -0.04], 0.05, "rgba(220,226,216,0.12)");
    plank(c, -1.2, 0.05, 2.4, 0.1, v.a, 7102);
    stroke(c, [-0.62, 0.1, -0.52, 0.1], 0.025, CHALK);
    stroke(c, [-0.45, 0.09, -0.38, 0.11], 0.025, CHALK);
    rr(c, 0.48, 0.065, 0.2, 0.07, 0.015);
    fo(c, "#8a6a48", 0.01);
  }),
  // On an easel: three legs, the board leaning back on them, pegs holding it up.
  ...family({ id: "blackboard-easel", name: "Blackboard on an easel", category: F, group: G, w: 1.3, h: 0.9, layer: "object",
    form: (v) => S.solid([
      S.box(-0.6, 0.6, 0.02, 0.06, 0.78, 1.62, FACE, { sz: -0.22 }),
      S.box(-0.64, 0.64, 0.0, 0.08, 1.62, 1.66, v.a, { sx: 0, sz: -0.22 }),
      S.limb([-0.52, 0, 0.3], [-0.48, 1.72, -0.18], 0.025, 0.02, v.a, { n: 4 }),
      S.limb([0.52, 0, 0.3], [0.48, 1.72, -0.18], 0.025, 0.02, v.a, { n: 4 }),
      S.limb([0, 0, -0.42], [0, 1.66, -0.18], 0.022, 0.018, v.a, { n: 4 }),
      S.box(-0.64, 0.64, 0.0, 0.14, 0.72, 0.78, v.a),
      S.box(-0.3, -0.2, 0.04, 0.08, 0.78, 0.8, CHALK),
      ...(v.b.key === "lesson" ? [0, 1, 2].map((i) => S.box(-0.5, i === 2 ? 0.0 : 0.45, 0.012, 0.018, 1.45 - i * 0.22, 1.48 - i * 0.22, "#c8ccc4", { sz: -0.22 * ((1.45 - i * 0.22 - 0.78) / 0.84) })) : []),
    ], { note: "the board drawn tipped towards the viewer so its face shows" }),
  }, cross(pickWoods("pale", "walnut", "weathered"), LESSON), (c, v) => {
    stroke(c, [0, -0.42, 0, -0.1], 0.05, v.a.dark);
    rr(c, -0.64, -0.3, 1.28, 0.5, 0.02);
    fo(c, linear(c, -0.6, -0.3, 0.6, 0.2, v.a.light, v.a.dark), 0.012);
    rr(c, -0.58, -0.25, 1.16, 0.4, 0.01);
    fo(c, linear(c, 0, -0.25, 0, 0.15, FACE.light, FACE.dark), 0.01);
    if (v.b.key === "lesson") chalkLines(c, -0.56, -0.24, 1.12, 0.38, 7111);
    for (const x of [-0.52, 0.52]) disc(c, x, 0.3, 0.035, v.a, 0.01);
    plank(c, -0.64, 0.16, 1.28, 0.08, v.a, 7112);
    stroke(c, [-0.3, 0.2, -0.2, 0.2], 0.025, CHALK);
  }),
];

const slates: PropDef[] = [
  // A pupil's slate: a dark face in a wooden frame, about as big as a book. Rests on a desk.
  ...family({ id: "slate", name: "Writing slate", category: F, group: G, w: 0.3, h: 0.22, layer: "object",
    form: (v) => S.resting(S.solid(v.key === "stacked"
      ? [0, 1, 2, 3].map((i) => S.box(-0.13 + (i % 2) * 0.012, 0.13 + (i % 2) * 0.012, -0.095 + i * 0.006, 0.095 + i * 0.006, i * 0.014, i * 0.014 + 0.014, tone("#b48a52", "#7a5430"), { top: 0.98 }))
      : [S.box(-0.13, 0.13, -0.095, 0.095, 0, 0.012, tone("#b48a52", "#7a5430")), S.box(-0.11, 0.11, -0.077, 0.077, 0.012, 0.014, SLATE)])),
  }, [vary("written", "written on"), vary("blank"), vary("stacked", "a stack")], (c, v) => {
    if (v.key === "stacked") for (let i = 0; i < 4; i++) slate(c, (i % 2) * 0.012, i * 0.006, 0.26, 0.19, (i - 1.5) * 0.04, false, 7120 + i);
    else slate(c, 0, 0, 0.26, 0.19, 0, v.key === "written", 7125);
  }),
];

const COATS = [CLOTHS[0], CLOTHS[1], CLOTHS[2], CLOTHS[3], tone("#8a6a48", "#4a3420")];

const pegs: PropDef[] = [
  // A peg rail on the wall, with the pupils' coats, caps and a satchel hung on it (or bare).
  ...family({ id: "coat-pegs", name: "Coat pegs", category: F, group: G, w: 1.8, h: 0.3, layer: "object",
    form: (v) => {
      const xs = [-0.7, -0.35, 0, 0.35, 0.7];
      const hung = v.b.key === "coats";
      return S.solid([
        S.box(-0.88, 0.88, -0.15, -0.12, 1.42, 1.58, v.a),
        xs.map((x) => S.limb([x, 1.5, -0.12], [x, 1.54, -0.04], 0.018, 0.015, v.a.dark, { n: 4 })),
        ...(hung ? [
          S.box(-0.84, -0.56, -0.15, -0.02, 0.72, 1.5, COATS[0], { top: 0.7 }),
          S.box(-0.48, -0.22, -0.15, -0.03, 0.8, 1.5, COATS[1], { top: 0.7 }),
          S.ball(0.08, 1.46, 1.6, COATS[3], { x: 0, z: -0.07, n: 6 }),
          S.box(0.25, 0.45, -0.14, -0.05, 0.98, 1.3, COATS[4]),
          S.box(0.57, 0.84, -0.15, -0.02, 0.76, 1.5, COATS[2], { top: 0.7 }),
        ] : []),
      ], { note: "pegs on the wall, coats hung from them" });
    },
  }, cross(pickWoods("pale", "honey", "walnut", "weathered"), [vary("coats", "with coats"), vary("bare")]), (c, v) => {
    plank(c, -0.9, -0.15, 1.8, 0.07, v.a, 7131);
    const xs = [-0.7, -0.35, 0, 0.35, 0.7];
    for (const x of xs) disc(c, x, -0.06, 0.03, v.a, 0.008);
    if (v.b.key !== "coats") return;
    drape(c, -0.84, -0.12, 0.28, 0.2, COATS[0], 7132);
    drape(c, -0.48, -0.12, 0.26, 0.17, COATS[1], 7133);
    ell(c, 0, -0.06, 0.08, 0.07);
    fo(c, linear(c, -0.08, -0.13, 0.08, 0.01, COATS[3].light, COATS[3].dark), 0.012);
    rr(c, 0.25, -0.12, 0.2, 0.1, 0.02);
    fo(c, linear(c, 0.25, -0.12, 0.45, -0.02, COATS[4].light, COATS[4].dark), 0.012);
    stroke(c, [0.27, -0.12, 0.35, -0.06, 0.43, -0.12], 0.012, shade(COATS[4].dark, -0.3));
    drape(c, 0.57, -0.12, 0.27, 0.2, COATS[2], 7134);
  }),
];

const desks: PropDef[] = [
  // A pupils' desk for three, its top sloping down towards them, the bench joined on behind:
  // they sit facing the top of the map (towards the board, put at the top).
  ...family({ id: "school-desk", name: "School desk with its bench", category: F, group: G, w: 2, h: 1, layer: "object",
    form: (v) => S.solid([
      S.box(-0.95, 0.95, -0.48, -0.06, 0.66, 0.74, v.a, { drop: 0.06 }),
      S.box(-0.95, 0.95, -0.48, -0.44, 0.3, 0.66, v.a),
      S.box(-0.95, -0.9, -0.48, -0.06, 0, 0.66, shade(v.a.dark, 0.1)),
      S.box(0.9, 0.95, -0.48, -0.06, 0, 0.66, shade(v.a.dark, 0.1)),
      S.box(-0.95, 0.95, 0.14, 0.44, 0.38, 0.43, v.a),
      S.box(-0.95, -0.9, 0.14, 0.44, 0, 0.38, shade(v.a.dark, 0.1)),
      S.box(0.9, 0.95, 0.14, 0.44, 0, 0.38, shade(v.a.dark, 0.1)),
      S.box(-0.95, -0.9, -0.3, 0.3, 0.05, 0.1, v.a.dark),
      S.box(0.9, 0.95, -0.3, 0.3, 0.05, 0.1, v.a.dark),
      [-0.6, 0, 0.6].map((x) => S.cyl(0.025, 0.74, 0.77, "#1a1a20", { x, z: -0.42, n: 6 })),
      ...(v.b.key === "slates" ? [-0.6, 0, 0.6].map((x) => S.box(x - 0.13, x + 0.13, -0.32, -0.13, 0.715, 0.73, SLATE)) : []),
    ], { surface: 0.74 }),
  }, cross(pickWoods("pale", "honey", "walnut", "weathered"), [vary("slates", "with slates"), vary("bare")]), (c, v) => {
    // The desk's ends and the runners joining them to the bench.
    for (const x of [-0.95, 0.9]) {
      rr(c, x, -0.48, 0.05, 0.92, 0.01);
      fo(c, v.a.dark, 0.008);
    }
    plank(c, -0.95, 0.14, 1.9, 0.3, v.a, 7141);
    rr(c, -0.95, -0.48, 1.9, 0.42, 0.02);
    fo(c, linear(c, 0, -0.48, 0, -0.06, shade(v.a.light, -0.08), shade(v.a.light, 0.12)), 0.012);
    plank(c, -0.95, -0.48, 1.9, 0.08, v.a, 7142);
    for (const x of [-0.6, 0, 0.6]) disc(c, x, -0.43, 0.03, tone("#3a3a44", "#0e0e12"), 0.006);
    if (v.b.key === "slates") [-0.6, 0, 0.6].forEach((x, i) => slate(c, x, -0.24, 0.26, 0.19, (i - 1) * 0.08, i !== 1, 7143 + i));
  }),
];

export const SCHOOL_PROPS: PropDef[] = [...boards, ...slates, ...pegs, ...desks];

// Copied from Dungeon (src/render/props-farm.ts) by scripts/sync-dungeon-library.mjs, Dungeon 0f2dfd5. Change it there and run the script again.
import { rng } from "./noise";
import { rr, circle, radial, linear, canopy } from "./propkit";
import { WOODS, METALS, MASONRY, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, stroke, scatter, type C, type Tone } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// Farms and villages for the big library: livestock, fields, farm tools and the village.
// Fields name their crop (wheat, corn, cabbage, pumpkin, carrot, crop), which Table's
// Seasons read as crops.

const F = "Farm & village" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const THREE_WOODS = WOODS.filter((w) => ["honey", "walnut", "weathered"].includes(w.key));
const FOUR_WOODS = WOODS.filter((w) => ["pale", "honey", "walnut", "weathered"].includes(w.key));
const STRAW = tone("#ecd68a", "#a8883a");
const SOIL = tone("#7a5a3a", "#3e2a18");

const livestock: PropDef[] = [
  ...family({ id: "water-trough", name: "Water trough", category: F, group: "Livestock", w: 1.6, h: 0.6, layer: "object", form: (v) => S.solid([S.box(-0.76, 0.76, -0.27, 0.27, 0, 0.55, v.a, { wall: 0.07, floor: 0.12 }), ...(v.b.key === "full" ? [S.box(-0.68, 0.68, -0.19, 0.19, 0.12, 0.47, "#4a7a98")] : [])]) }, cross(THREE_WOODS, [vary("empty"), vary("full")]), (c, v) => {
    box(c, -0.76, -0.27, 1.52, 0.54, v.a, 0.04);
    rr(c, -0.68, -0.19, 1.36, 0.38, 0.03);
    fo(c, v.b.key === "full" ? radial(c, 0, 0, 0.7, "#a8d0e4", "#3a6a88") : shade(v.a.dark, -0.35), 0.012);
  }),
  ...family({ id: "feed-trough", name: "Feed trough", category: F, group: "Livestock", w: 1.4, h: 0.5, layer: "object", form: (v) => S.solid([S.box(-0.66, 0.66, -0.22, 0.22, 0, 0.45, v, { wall: 0.07, floor: 0.1 }), S.box(-0.58, 0.58, -0.14, 0.14, 0.1, 0.4, STRAW)]) }, THREE_WOODS, (c, v) => {
    box(c, -0.66, -0.22, 1.32, 0.44, v, 0.04);
    rr(c, -0.58, -0.14, 1.16, 0.28, 0.03);
    fo(c, radial(c, 0, 0, 0.6, STRAW.light, STRAW.dark), 0.012);
  }),
  ...family({ id: "chicken-coop", name: "Chicken coop", category: F, group: "Livestock", w: 1.6, h: 1.2, layer: "object", form: (v) => S.solid([S.box(-0.75, 0.75, -0.55, 0.55, 0, 0.8, v.dark), S.gable(-0.8, 0.8, -0.6, 0.6, 0.8, 1.35, "x", v), scatter(4, 0.25, 3601).map(([x, z]) => S.ball(0.07, 0, 0.3, "#f4f0e6", { x: x + 0.95, z: z * 1.2, rz: 0.06, n: 6 }))]) }, FOUR_WOODS, (c, v) => {
    poly(c, [-0.75, -0.55, 0.75, -0.55, 0.75, 0, -0.75, 0]);
    fo(c, linear(c, 0, -0.55, 0, 0, v.light, shade(v.light, -0.1)));
    poly(c, [-0.75, 0, 0.75, 0, 0.75, 0.55, -0.75, 0.55]);
    fo(c, linear(c, 0, 0, 0, 0.55, v.dark, shade(v.dark, -0.2)));
    stroke(c, [-0.75, 0, 0.75, 0], 0.04, shade(v.dark, -0.3));
    for (const [x, y] of scatter(4, 0.25, 3601)) disc(c, x + 0.95, y * 1.2, 0.06, tone("#fbf8f0", "#c8c0b0"), 0.01);
  }, { size: () => [2, 1.3] }),
  ...family({ id: "animal-pen", name: "Animal pen", category: F, group: "Livestock", w: 3, h: 3, layer: "floor", form: (v) => (w) => { const s = v.key === "small" ? 1.9 : 2.9, h = s / 2; const posts = Array.from({ length: 7 }, (_, i) => -h + (i * s) / 6); return S.solid([posts.flatMap((k) => [S.post(k, -h, 0.06, 0, 1.0, WOODS[5], 6), S.post(k, h, 0.06, 0, 1.0, WOODS[5], 6), S.post(-h, k, 0.06, 0, 1.0, WOODS[5], 6), S.post(h, k, 0.06, 0, 1.0, WOODS[5], 6)]), [0.45, 0.85].flatMap((y) => [S.box(-h, h, -h - 0.025, -h + 0.025, y, y + 0.08, WOODS[5].dark), S.box(-h, h, h - 0.025, h + 0.025, y, y + 0.08, WOODS[5].dark), S.box(-h - 0.025, -h + 0.025, -h, h, y, y + 0.08, WOODS[5].dark), S.box(h - 0.025, h + 0.025, -h, h, y, y + 0.08, WOODS[5].dark)])], { painted: true }); } }, [vary("small"), vary("large")], (c, v) => {
    const s = v.key === "small" ? 1.9 : 2.9;
    rr(c, -s / 2, -s / 2, s, s, 0.04);
    fo(c, radial(c, 0, 0, s * 0.7, "#8a6a4a", "#5a4028"), 0.01);
    c.strokeStyle = WOODS[5].dark;
    c.lineWidth = 0.06;
    c.strokeRect(-s / 2, -s / 2, s, s);
    for (let k = -s / 2; k <= s / 2 + 0.01; k += s / 6) for (const [x, y] of [[k, -s / 2], [k, s / 2], [-s / 2, k], [s / 2, k]]) disc(c, x, y, 0.06, WOODS[5], 0.01);
  }, { size: (v) => (v.key === "small" ? [2, 2] : [3, 3]) }),
  ...family({ id: "beehive", name: "Beehive", category: F, group: "Livestock", w: 0.6, h: 0.6, layer: "object", form: (v) => S.solid((v.b.key === "row" ? [-0.6, 0, 0.6] : [0]).map((x) => v.a.key === "skep" ? [S.cbox(0.3, 0.3, 0, 0.4, WOODS[2], x), S.ball(0.24, 0.3, 0.85, STRAW, { x, n: 9 })] : [S.cbox(0.44, 0.44, 0, 0.75, WOODS[0], x), S.cbox(0.5, 0.5, 0.75, 0.82, WOODS[0], x)])) }, cross([vary("skep", "straw skep"), vary("box", "wooden box")], [vary("single"), vary("row", "row of three")]), (c, v) => {
    const xs = v.b.key === "row" ? [-0.6, 0, 0.6] : [0];
    for (const x of xs) {
      if (v.a.key === "skep") {
        disc(c, x, 0, 0.24, STRAW);
        for (let r = 0.06; r < 0.24; r += 0.05) {
          circle(c, x, 0, r);
          c.strokeStyle = "rgba(90,60,20,0.4)";
          c.lineWidth = 0.012;
          c.stroke();
        }
      } else {
        cbox(c, x, 0, 0.44, 0.44, WOODS[0], 0.03);
        stroke(c, [x - 0.22, 0, x + 0.22, 0], 0.015, "rgba(40,24,12,0.45)");
      }
    }
  }, { size: (v) => (v.b.key === "row" ? [1.8, 0.6] : [0.6, 0.6]) }),
  ...family({ id: "kennel", name: "Kennel", category: F, group: "Livestock", w: 1, h: 0.9, layer: "object", form: (v) => S.solid([S.box(-0.46, 0.46, -0.4, 0.4, 0, 0.6, v.dark), S.gable(-0.5, 0.5, -0.44, 0.44, 0.6, 1.0, "x", v), S.cyl(0.08, 0, 0.05, METALS[0], { x: 0.3, z: 0.3, n: 8 })]) }, THREE_WOODS, (c, v) => {
    poly(c, [-0.46, -0.4, 0.46, -0.4, 0.46, 0, -0.46, 0]);
    fo(c, linear(c, 0, -0.4, 0, 0, v.light, shade(v.light, -0.1)));
    poly(c, [-0.46, 0, 0.46, 0, 0.46, 0.4, -0.46, 0.4]);
    fo(c, linear(c, 0, 0, 0, 0.4, v.dark, shade(v.dark, -0.2)));
    disc(c, 0.3, 0.2, 0.08, METALS[0], 0.012);
  }),
  ...family({ id: "stable-stall", name: "Stable stall", category: F, group: "Livestock", w: 2, h: 3, layer: "floor", form: (v) => S.solid([S.box(-1.01, -0.89, -1.45, 1.45, 0, 1.4, v), S.box(0.89, 1.01, -1.45, 1.45, 0, 1.4, v), S.box(-0.95, 0.95, -1.5, -1.38, 0, 1.6, v), S.box(-0.6, 0.6, -1.3, -1.0, 0, 0.9, v, { wall: 0.05, floor: 0.6 }), S.box(-0.55, 0.55, -1.25, -1.05, 0.6, 0.85, STRAW)], { painted: true }) }, THREE_WOODS, (c, v) => {
    rr(c, -0.95, -1.45, 1.9, 2.9, 0.03);
    fo(c, radial(c, 0, 0, 1.6, STRAW.light, STRAW.dark), 0.01);
    for (const x of [-0.95, 0.95]) plank(c, x - 0.06, -1.45, 0.12, 2.9, v, 3611 + x);
    plank(c, -0.95, -1.5, 1.9, 0.12, v, 3613);
    box(c, -0.6, -1.3, 0.6, 0.3, v, 0.03);
  }),
];

/** Rows of plants across a patch of soil. */
function rows(c: C, w: number, h: number, n: number, plant: (x: number, y: number) => void): void {
  rr(c, -w / 2, -h / 2, w, h, 0.05);
  fo(c, linear(c, 0, -h / 2, 0, h / 2, SOIL.light, SOIL.dark), 0.012);
  for (let r = 0; r < n; r++) {
    const y = -h / 2 + ((r + 0.5) / n) * h;
    for (let x = -w / 2 + 0.15; x < w / 2 - 0.05; x += 0.22) plant(x, y);
  }
}

const fields: PropDef[] = [
  ...family({ id: "wheat-field", name: "Wheat field", category: F, group: "Fields", w: 2, h: 2, layer: "floor", form: (v) => S.solid([S.box(-0.96, 0.96, -0.96, 0.96, 0, 1.0, v.key === "green" ? "#7aa040" : "#d8b850", { top: 0.98 })], { note: "standing wheat, waist-high" }) }, [vary("green"), vary("golden")], (c, v) => {
    rr(c, -0.96, -0.96, 1.92, 1.92, 0.05);
    fo(c, linear(c, 0, -0.96, 0, 0.96, v.key === "green" ? "#8ab84a" : "#e8c860", v.key === "green" ? "#4a7a2a" : "#a8862a"), 0.012);
    const rand = rng(3701);
    for (let i = 0; i < 70; i++) {
      const x = (rand() - 0.5) * 1.8;
      const y = (rand() - 0.5) * 1.8;
      stroke(c, [x, y, x + 0.02, y - 0.08], 0.015, v.key === "green" ? "#a8d060" : "#f4dc80");
    }
  }),
  ...family({ id: "corn-rows", name: "Corn rows", category: F, group: "Fields", w: 2, h: 2, layer: "object", form: (v) => S.solid(Array.from({ length: 5 }, (_, r) => S.box(-0.9, 0.9, -0.96 + ((r + 0.5) / 5) * 1.92 - 0.1, -0.96 + ((r + 0.5) / 5) * 1.92 + 0.1, 0, v.key === "young" ? 0.6 : 2.0, "#5a9a3a", { top: 0.7 })), { painted: true }) }, [vary("young"), vary("tall")], (c, v) => {
    rows(c, 1.92, 1.92, 5, (x, y) => {
      const r = v.key === "young" ? 0.06 : 0.1;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + x;
        stroke(c, [x, y, x + Math.cos(a) * r, y + Math.sin(a) * r], 0.02, "#5a9a3a");
      }
    });
  }),
  ...family({ id: "cabbage-rows", name: "Cabbage rows", category: F, group: "Fields", w: 2, h: 1.6, layer: "object", form: (v) => S.solid(Array.from({ length: 4 }, (_, r) => S.ball(0.88, 0, 0.3, v.key === "green" ? "#7ab45a" : "#8a5aa0", { z: -0.76 + ((r + 0.5) / 4) * 1.52, rz: 0.12, lump: 0.25, n: 9 })), { painted: true }) }, [vary("green"), vary("purple")], (c, v) => {
    rows(c, 1.92, 1.52, 4, (x, y) => disc(c, x, y, 0.08, v.key === "green" ? tone("#b8e090", "#4a8a3a") : tone("#b090d0", "#4a2a6a"), 0.01));
  }),
  ...family({ id: "pumpkin-patch", name: "Pumpkin patch", category: F, group: "Fields", w: 2, h: 1.6, layer: "object", form: (v) => S.solid(Array.from({ length: 3 }, (_, r) => S.ball(0.88, 0, v.key === "small" ? 0.3 : 0.45, "#d07a2a", { z: -0.76 + ((r + 0.5) / 3) * 1.52, rz: 0.16, lump: 0.35, n: 9 })), { painted: true }) }, [vary("small"), vary("large")], (c, v) => {
    rows(c, 1.92, 1.52, 3, (x, y) => {
      if ((x * 10 + y * 7) % 2 > 1) disc(c, x, y, v.key === "small" ? 0.08 : 0.12, tone("#f4a040", "#b8601a"), 0.012);
      else disc(c, x, y, 0.05, tone("#7ab04a", "#3a7026"), 0);
    });
  }),
  ...family({ id: "carrot-rows", name: "Carrot rows", category: F, group: "Fields", w: 2, h: 1.6, layer: "object", form: (v) => S.solid(Array.from({ length: 5 }, (_, r) => S.box(-0.85, 0.85, -0.76 + ((r + 0.5) / 5) * 1.52 - 0.06, -0.76 + ((r + 0.5) / 5) * 1.52 + 0.06, 0, v.key === "young" ? 0.12 : 0.3, "#5aa03a", { top: 0.6 })), { painted: true }) }, [vary("young"), vary("ready")], (c, v) => {
    rows(c, 1.92, 1.52, 5, (x, y) => {
      for (const dx of [-0.03, 0, 0.03]) stroke(c, [x, y, x + dx, y - (v.key === "young" ? 0.05 : 0.09)], 0.012, "#5aa03a");
      if (v.key === "ready") disc(c, x, y, 0.02, tone("#f4a040", "#c8601a"), 0);
    });
  }),
  ...family({ id: "crop-rows", name: "Crop rows", category: F, group: "Fields", w: 2, h: 1.6, layer: "object", form: (v) => S.solid(Array.from({ length: 4 }, (_, r) => v.key === "beans" ? S.box(-0.85, 0.85, -0.76 + ((r + 0.5) / 4) * 1.52 - 0.07, -0.76 + ((r + 0.5) / 4) * 1.52 + 0.07, 0, 1.6, "#407a32", { top: 0.6 }) : S.ball(0.88, 0, 0.35, "#8ab05a", { z: -0.76 + ((r + 0.5) / 4) * 1.52, rz: 0.12, lump: 0.3, n: 9 })), { painted: true }) }, [vary("mixed"), vary("beans")], (c, v) => {
    rows(c, 1.92, 1.52, 4, (x, y) => {
      if (v.key === "beans") {
        disc(c, x, y, 0.035, WOODS[2], 0.006);
        canopy(c, 0.06, Math.round(x * 100 + y * 10), "#2e5a26", "#407a32", "#6aa24e");
      } else disc(c, x, y, 0.06, [tone("#9ad06a", "#4a7a2a"), tone("#f0a050", "#a8581a"), tone("#e8e0b0", "#a89a6a")][Math.abs(Math.round(x * 10)) % 3], 0.008);
    });
  }),
];

const farmThings: PropDef[] = [
  ...family({ id: "hay-bales", name: "Hay bales", category: F, group: "Farm things", w: 1.6, h: 1.2, layer: "object", form: (v) => S.solid([[-0.38, 0.22], [0.38, 0.22], [0, -0.3]].map(([x, z]) => v.key === "round" ? S.cyl(0.3, 0, 0.9, STRAW, { x, z, n: 12 }) : S.cbox(0.62, 0.42, 0, 0.45, STRAW, x, z)), { surface: v.key === "round" ? 0.9 : 0.45 }) }, [vary("square"), vary("round")], (c, v) => {
    for (const [x, y] of [[-0.38, 0.22], [0.38, 0.22], [0, -0.3]] as const) {
      if (v.key === "round") {
        disc(c, x, y, 0.3, STRAW);
        circle(c, x, y, 0.18);
        c.strokeStyle = "rgba(90,60,20,0.4)";
        c.lineWidth = 0.015;
        c.stroke();
      } else {
        cbox(c, x, y, 0.62, 0.42, STRAW, 0.03);
        for (const dx of [-0.15, 0.15]) stroke(c, [x + dx, y - 0.21, x + dx, y + 0.21], 0.015, "#8a6a3a");
      }
    }
  }),
  ...family({ id: "straw-heap", name: "Heap of straw", category: F, group: "Farm things", w: 1.2, h: 1, layer: "floor", form: () => (w, h) => S.solid([S.ball(w / 2 - 0.1, -0.2, 0.7, STRAW, { rz: h / 2 - 0.1, lump: 0.15, n: 9 })]) }, [vary("small"), vary("large")], (c, v) => {
    const r = v.key === "small" ? 0.32 : 0.5;
    ell(c, 0, 0, r, r * 0.8);
    fo(c, radial(c, 0, 0, r, STRAW.light, STRAW.dark), 0.015);
    for (const [x, y, k] of scatter(Math.round(r * 40), r, 3801)) stroke(c, [x, y * 0.8, x + (k - 0.5) * 0.12, y * 0.8 + 0.04], 0.012, k > 0.5 ? "#f4e4a0" : "#a8883a");
  }),
  ...family({ id: "wheelbarrow", name: "Wheelbarrow", category: F, group: "Farm things", w: 1.4, h: 0.7, layer: "object", form: (v) => S.solid([S.slab([-0.3, -0.28, 0.35, -0.22, 0.45, 0, 0.35, 0.22, -0.3, 0.28], 0.28, 0.6, v.a, { hollow: 0.82, floor: 0.34 }), ...(v.b.key === "loaded" ? [S.ball(0.26, 0.4, 0.7, "#5a4028", { x: 0.05, rz: 0.18, lump: 0.2, n: 7 })] : []), S.limb([0.5, 0.18, -0.04], [0.5, 0.18, 0.04], 0.12, 0.12, "#3a2a1a", { n: 8 }), [-1, 1].map((s) => S.limb([-0.2, 0.42, s * 0.2], [-0.65, 0.62, s * 0.26], 0.025, 0.025, v.a.dark, { n: 4 })), [-1, 1].map((s) => S.limb([-0.25, 0.3, s * 0.2], [-0.3, 0, s * 0.22], 0.02, 0.02, v.a.dark, { n: 4 }))]) }, cross(THREE_WOODS, [vary("empty"), vary("loaded", "loaded with soil")]), (c, v) => {
    for (const s of [-1, 1]) stroke(c, [-0.2, s * 0.2, -0.65, s * 0.26], 0.04, v.a.dark);
    poly(c, [-0.3, -0.28, 0.35, -0.22, 0.45, 0, 0.35, 0.22, -0.3, 0.28]);
    fo(c, linear(c, 0, -0.28, 0, 0.28, v.a.light, v.a.dark));
    if (v.b.key === "loaded") {
      ell(c, 0.05, 0, 0.26, 0.18);
      fo(c, radial(c, 0.05, 0, 0.26, SOIL.light, SOIL.dark), 0.012);
    }
    cbox(c, 0.5, 0, 0.1, 0.22, tone("#4a3a2a", "#1a120c"), 0.03);
  }),
  ...family({ id: "plough", name: "Plough", category: F, group: "Farm things", w: 1.8, h: 0.6, layer: "object", form: (v) => S.solid([S.limb([-0.85, 0.75, 0], [0.5, 0.3, 0], 0.045, 0.04, WOODS[2].dark, { n: 5 }), [-1, 1].map((s) => S.limb([-0.6, 0.6, 0], [-0.95, 1.0, s * 0.22], 0.025, 0.025, WOODS[2].dark, { n: 4 })), S.slab([0.45, -0.18, 0.85, 0, 0.45, 0.18], 0, 0.28, v.key === "wooden" ? WOODS[1] : METALS[0], { top: 0.5 })]) }, [vary("wooden"), vary("iron-shod", "iron-shod")], (c, v) => {
    stroke(c, [-0.85, 0, 0.5, 0], 0.06, WOODS[2].dark);
    for (const s of [-1, 1]) stroke(c, [-0.85, 0, -0.95, s * 0.22], 0.04, WOODS[2].dark);
    poly(c, [0.45, -0.18, 0.85, 0, 0.45, 0.18]);
    fo(c, v.key === "wooden" ? WOODS[1].light : METALS[0].light, 0.015);
  }),
  ...family({ id: "milk-churns", name: "Milk churns", category: F, group: "Farm things", w: 0.9, h: 0.5, layer: "object", form: (v) => S.solid([-0.22, 0.22].map((x) => [S.cyl(0.18, 0, 0.5, v, { x, n: 10 }), S.cyl(0.18, 0.5, 0.62, v, { x, top: 0.55, n: 10 }), S.cyl(0.1, 0.62, 0.72, v, { x, n: 8 })])) }, [METALS[3], METALS[2]], (c, v) => {
    for (const x of [-0.22, 0.22]) {
      disc(c, x, 0, 0.18, v);
      disc(c, x, 0, 0.08, tone(shade(v.light, 0.1), v.dark), 0.012);
    }
  }),
  ...family({ id: "water-pump", name: "Water pump", category: F, group: "Farm things", w: 0.7, h: 0.6, layer: "object", form: (v) => { const t = v.key === "iron" ? METALS[0] : WOODS[2]; return S.solid([S.cyl(0.16, 0, 1.1, t, { n: 8 }), S.limb([0, 1.0, 0], [0.3, 1.2, -0.12], 0.025, 0.02, t.dark, { n: 4 }), S.limb([0, 0.75, 0.1], [0, 0.68, 0.26], 0.035, 0.03, t.dark, { n: 4 })]); } }, [vary("iron"), vary("wooden")], (c, v) => {
    const t = v.key === "iron" ? METALS[0] : WOODS[2];
    disc(c, 0, 0, 0.16, t);
    stroke(c, [0, 0, 0.3, -0.12], 0.04, t.dark);
    stroke(c, [0, 0.1, 0, 0.26], 0.05, t.dark);
    disc(c, 0, 0.26, 0.04, tone("#a8d0e4", "#3a6a88"), 0);
  }),
  ...family({ id: "woodpile", name: "Woodpile", category: F, group: "Farm things", w: 1.6, h: 0.8, layer: "object", form: (v) => S.solid([0, 1, 2].map((row) => Array.from({ length: 6 - row }, (_, i) => S.limb([-0.6 + i * 0.24 + row * 0.12, 0.15 + row * 0.26, -0.33], [-0.6 + i * 0.24 + row * 0.12, 0.15 + row * 0.26, 0.33], 0.1, 0.1, v.key === "split" ? "#a87c4c" : "#8a6440", { n: v.key === "split" ? 3 : 6 })))) }, [vary("split"), vary("rounds")], (c, v) => {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
      const x = -0.6 + i * 0.24 + row * 0.12;
      const y = 0.22 - row * 0.2;
      if (v.key === "split") {
        poly(c, [x - 0.11, y + 0.09, x + 0.11, y + 0.09, x, y - 0.1]);
        fo(c, radial(c, x, y, 0.12, "#d4b080", "#8a6440"), 0.01);
      } else disc(c, x, y, 0.1, tone("#d4b080", "#8a6440"), 0.01);
    }
  }),
  ...family({ id: "chopping-block", name: "Chopping block", category: F, group: "Farm things", w: 0.8, h: 0.8, layer: "object", form: (v) => S.solid([S.cyl(0.3, 0, 0.5, v, { n: 10 }), S.cyl(0.24, 0.5, 0.51, "#c8a070", { n: 10 }), S.limb([-0.05, 0.52, -0.05], [0.38, 0.78, 0.3], 0.02, 0.02, WOODS[1].dark, { n: 4 }), S.slab([-0.12, -0.14, 0.02, -0.12, 0, 0.02, -0.14, 0], 0.5, 0.62, METALS[0].light)], { surface: 0.5 }) }, THREE_WOODS, (c, v) => {
    disc(c, 0, 0, 0.3, v);
    disc(c, 0, 0, 0.24, tone("#d4b080", "#9a7448"), 0.012);
    stroke(c, [-0.05, -0.05, 0.38, 0.3], 0.035, WOODS[1].dark);
    poly(c, [-0.12, -0.14, 0.02, -0.12, 0, 0.02, -0.14, 0]);
    fo(c, METALS[0].light, 0.012);
  }),
];

const village: PropDef[] = [
  ...family({ id: "notice-board", name: "Notice board", category: F, group: "The village", w: 1.4, h: 0.4, layer: "object", form: (v) => S.solid([S.post(-0.62, 0, 0.05, 0, 2.1, v, 6), S.post(0.62, 0, 0.05, 0, 2.1, v, 6), S.box(-0.68, 0.68, -0.04, 0.04, 1.0, 1.9, v), S.gable(-0.72, 0.72, -0.16, 0.16, 1.9, 2.15, "x", v.dark), scatter(5, 0.12, 3903).map(([x, z], i) => S.box(x * 3.5 - 0.1, x * 3.5 + 0.1, 0.04, 0.05, 1.3 + (i % 3) * 0.15, 1.46 + (i % 3) * 0.15, "#f4e8c8"))]) }, THREE_WOODS, (c, v) => {
    plank(c, -0.68, -0.16, 1.36, 0.32, v, 3901);
    for (const [x, y, k] of scatter(5, 0.12, 3903)) {
      c.save();
      c.translate(x * 3.5, y * 0.6);
      c.rotate(k - 0.5);
      rr(c, -0.1, -0.08, 0.2, 0.16, 0.01);
      fo(c, "#f4e8c8", 0.008);
      c.restore();
    }
  }),
  ...family({ id: "outhouse", name: "Outhouse", category: F, group: "The village", w: 1, h: 1, layer: "object", form: (v) => S.solid([S.box(-0.46, 0.46, -0.46, 0.46, 0, 2.0, v.dark), S.gable(-0.5, 0.5, -0.5, 0.5, 2.0, 2.45, "x", v), S.cbox(0.08, 0.02, 1.6, 1.75, "#1a120c", 0, 0.47)]) }, THREE_WOODS, (c, v) => {
    poly(c, [-0.46, -0.46, 0.46, -0.46, 0.46, 0, -0.46, 0]);
    fo(c, linear(c, 0, -0.46, 0, 0, v.light, shade(v.light, -0.1)));
    poly(c, [-0.46, 0, 0.46, 0, 0.46, 0.46, -0.46, 0.46]);
    fo(c, linear(c, 0, 0, 0, 0.46, v.dark, shade(v.dark, -0.2)));
    ell(c, 0, -0.25, 0.05, 0.08);
    fo(c, "#1a120c", 0.01);
  }),
  ...family({ id: "village-well", name: "Village well", category: F, group: "The village", w: 1.8, h: 1.8, layer: "canopy", form: (v) => S.solid([S.tub(0.62, 0, 0.8, v, 0.68, { n: 14, floor: 0.35 }), S.cyl(0.42, 0.34, 0.36, "#14262e", { n: 14 }), S.post(-0.62, 0, 0.06, 0.8, 2.25, WOODS[2], 6), S.post(0.62, 0, 0.06, 0.8, 2.25, WOODS[2], 6), S.limb([-0.62, 1.4, 0], [0.62, 1.4, 0], 0.07, 0.07, WOODS[2], { n: 6 }), S.gable(-0.85, 0.85, -0.65, 0.65, 2.2, 2.85, "x", "#8a4e30")], { note: "a well under a little roof: you see under it" }) }, MASONRY, (c, v) => {
    disc(c, 0, 0, 0.62, v);
    disc(c, 0, 0, 0.42, tone("#1a2a34", "#05080a"), 0.015);
    poly(c, [-0.85, -0.65, 0.85, -0.65, 0.85, 0, -0.85, 0]);
    fo(c, linear(c, 0, -0.65, 0, 0, "#9a5a3a", "#6a3a22"), 0.02);
    poly(c, [-0.85, 0, 0.85, 0, 0.85, 0.65, -0.85, 0.65]);
    fo(c, linear(c, 0, 0, 0, 0.65, "#7a4428", "#4a2414"), 0.02);
  }),
  ...family({ id: "market-cross", name: "Market cross", category: F, group: "The village", w: 1.4, h: 1.4, layer: "object", form: (v) => S.solid([S.cbox(1.3, 1.3, 0, 0.2, v.dark), S.cbox(1.0, 1.0, 0.2, 0.4, v), S.cbox(0.7, 0.7, 0.4, 0.6, v.light), S.cbox(0.16, 0.16, 0.6, 3.0, v), S.cbox(0.6, 0.12, 2.5, 2.65, v)]) }, MASONRY.slice(0, 3), (c, v) => {
    for (const r of [0.65, 0.5, 0.35]) cbox(c, 0, 0, r * 2, r * 2, tone(shade(v.light, (0.65 - r) * 0.3), v.dark), 0.03);
    stroke(c, [0, -0.25, 0, 0.25], 0.08, v.dark);
    stroke(c, [-0.15, -0.08, 0.15, -0.08], 0.08, v.dark);
  }),
  ...family({ id: "scarecrow-figure", name: "Scarecrow", category: F, group: "The village", w: 1.2, h: 0.6, layer: "object", form: (v) => S.solid([S.cyl(0.04, 0, 1.95, WOODS[2].dark, { n: 5 }), S.limb([-0.55, 1.45, 0], [0.55, 1.45, 0], 0.03, 0.03, WOODS[2].dark, { n: 4 }), S.cbox(0.44, 0.3, 0.95, 1.5, "#7a5a3c", 0, 0.05, { top: 0.9 }), S.ball(v.key === "hat" ? 0.14 : 0.13, 1.5, 1.82, v.key === "hat" ? "#d8b878" : "#c8a878", { z: -0.04, n: 7 }), ...(v.key === "hat" ? [S.cyl(0.18, 1.78, 1.82, STRAW, { z: -0.04, n: 10 }), S.cone(0.1, 1.82, 1.98, STRAW, { z: -0.04, n: 8 })] : [])]) }, [vary("hat", "with a hat"), vary("sack", "with a sack head")], (c, v) => {
    stroke(c, [-0.55, 0, 0.55, 0], 0.05, WOODS[2].dark);
    ell(c, 0, 0.05, 0.22, 0.16);
    fo(c, radial(c, 0, 0.05, 0.22, "#8a6a4a", "#4a3220"), 0.015);
    if (v.key === "hat") {
      disc(c, 0, -0.04, 0.18, STRAW);
      disc(c, 0, -0.04, 0.1, tone("#c8a858", "#8a6a2a"), 0.01);
    } else disc(c, 0, -0.04, 0.13, tone("#c8a878", "#7a5a32"));
  }),
];

export const FARM_PROPS: PropDef[] = [...livestock, ...fields, ...farmThings, ...village];

// Copied from Dungeon (src/render/props-dungeon.ts) by scripts/sync-dungeon-library.mjs, Dungeon 823dfd2. Change it there and run the script again.
import { rng } from "./noise";
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, MASONRY, GLOWS, GOLD, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, glow, coloredFlame, stroke, scatter, type C, type Glow, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// Dungeon dressing for the big library: columns and statues, tombs and bones, prisons and
// traps, magic, stains, lairs, ways down and mechanisms.

const D = "Dungeon" as const;
const IRON = METALS[0];
const BONE = { key: "", name: "", light: "#f4ecd8", dark: "#b8a888" } satisfies Tone;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const SHUT_OPEN = [vary("shut"), vary("open")];

function column(c: C, r: number, t: Tone, state: string): void {
  if (state === "fallen") {
    rr(c, -r * 3, -r * 0.8, r * 6, r * 1.6, r * 0.6);
    fo(c, linear(c, 0, -r, 0, r, t.light, t.dark));
    for (let x = -r * 2.4; x < r * 3; x += r * 0.8) stroke(c, [x, -r * 0.75, x, r * 0.75], 0.012, "rgba(0,0,0,0.25)");
    disc(c, -r * 3.4, r * 0.5, r * 0.45, t);
    return;
  }
  disc(c, 0, 0, r * 1.15, tone(shade(t.light, -0.05), shade(t.dark, -0.1)));
  disc(c, 0, 0, r, t);
  c.strokeStyle = "rgba(0,0,0,0.18)";
  c.lineWidth = 0.012;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.beginPath();
    c.moveTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
    c.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    c.stroke();
  }
  if (state === "cracked") stroke(c, [-r * 0.7, -r * 0.4, -r * 0.1, 0, r * 0.2, -r * 0.3, r * 0.6, r * 0.4], 0.02, "rgba(0,0,0,0.55)");
}

const POSES = [vary("warrior"), vary("robed", "robed figure"), vary("beast")];

function statue(c: C, t: Tone, pose: string): void {
  cbox(c, 0, 0, 0.9, 0.9, tone(shade(t.light, -0.08), shade(t.dark, -0.15)), 0.04);
  if (pose === "beast") {
    ell(c, 0, 0.05, 0.3, 0.2);
    fo(c, radial(c, 0, 0, 0.3, t.light, t.dark));
    disc(c, 0, -0.22, 0.13, t);
    for (const x of [-0.08, 0.08]) disc(c, x, -0.3, 0.04, t, 0.01);
    return;
  }
  ell(c, 0, 0.05, 0.26, pose === "robed" ? 0.3 : 0.18);
  fo(c, radial(c, 0, 0, 0.3, t.light, t.dark));
  disc(c, 0, -0.02, 0.11, t);
  if (pose === "warrior") {
    stroke(c, [0.25, -0.35, 0.25, 0.3], 0.04, shade(t.dark, -0.1));
    ell(c, -0.26, 0.05, 0.09, 0.16);
    fo(c, radial(c, -0.26, 0.05, 0.16, t.light, t.dark), 0.015);
  }
}

const IDOLS: (Variant & { tone: Tone })[] = [
  { key: "gold", name: "gold", tone: GOLD },
  { key: "jade", name: "jade", tone: tone("#7ad0a0", "#2a7a4a") },
  { key: "bronze", name: "bronze", tone: METALS[1] },
  { key: "basalt", name: "basalt", tone: MASONRY[4] },
];

const pillars: PropDef[] = [
  ...family({ id: "column", name: "Column", category: D, group: "Pillars and statues", w: 1, h: 1, layer: "object", form: (v) => v.b.key === "fallen" ? S.solid([S.limb([-1.14, 0.45, 0], [1.14, 0.45, 0], 0.3, 0.3, v.a, { n: 10 }), S.ball(0.17, -0.05, 0.35, v.a, { x: -1.29, z: 0.19, lump: 0.25, n: 7 })], { surface: 0.9 }) : v.b.key === "cracked" ? S.solid([S.cyl(0.437, 0, 0.3, v.a.dark, { n: 10 }), S.cyl(0.38, 0.3, 1.95, v.a, { n: 10 }), S.cone(0.37, 1.95, 2.35, v.a, { n: 5 })]) : S.solid([S.cyl(0.437, 0, 0.3, v.a.dark, { n: 10 }), S.cyl(0.38, 0.3, 2.75, v.a, { n: 10 }), S.cyl(0.44, 2.75, 3.0, v.a.dark, { n: 10 })]) }, cross(MASONRY, [vary("whole"), vary("cracked"), vary("fallen")]), (c, v) => column(c, 0.38, v.a, v.b.key), {
    size: (v) => (v.b.key === "fallen" ? [3, 1] : [1, 1]),
  }),
  ...family({ id: "pier-square", name: "Square pier", category: D, group: "Pillars and statues", w: 1, h: 1, layer: "object", form: (v) => S.solid([S.cbox(0.92, 0.92, 0, 0.35, v.dark), S.cbox(0.72, 0.72, 0.35, 2.7, v), S.cbox(0.86, 0.86, 2.7, 3.0, v.dark)]) }, MASONRY, (c, v) => {
    cbox(c, 0, 0, 0.92, 0.92, tone(shade(v.light, -0.05), shade(v.dark, -0.1)), 0.03);
    cbox(c, 0, 0, 0.72, 0.72, v, 0.03);
  }),
  ...family({ id: "statue-figure", name: "Statue", category: D, group: "Pillars and statues", w: 1, h: 1, layer: "object", form: (v) => S.solid([S.cbox(0.9, 0.9, 0, 0.6, v.a.dark), ...(v.b.key === "beast" ? [S.ball(0.3, 0.6, 1.25, v.a, { z: 0.05, rz: 0.2, n: 8 }), S.ball(0.13, 1.0, 1.4, v.a, { z: -0.22, n: 7 })] : v.b.key === "robed" ? [S.cyl(0.26, 0.6, 1.9, v.a, { z: 0.05, rz: 0.3, top: 0.6 }), S.ball(0.11, 1.85, 2.15, v.a, { z: -0.02, n: 7 })] : [S.cyl(0.26, 0.6, 1.85, v.a, { z: 0.05, rz: 0.18, top: 0.75 }), S.ball(0.11, 1.8, 2.12, v.a, { z: -0.02, n: 7 }), S.limb([0.25, 0.6, 0.3], [0.25, 2.4, -0.35], 0.022, 0.018, v.a.dark, { n: 4 }), S.cbox(0.06, 0.32, 0.9, 1.55, v.a, -0.27, 0.05)])]) }, cross(MASONRY, POSES), (c, v) => statue(c, v.a, v.b.key)),
  ...family({ id: "obelisk-carved", name: "Carved obelisk", category: D, group: "Pillars and statues", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid([S.cbox(0.76, 0.76, 0, 0.3, v.dark), S.cbox(0.6, 0.6, 0.3, 3.2, v, 0, 0, { top: 0.5 }), S.cbox(0.3, 0.3, 3.2, 3.55, v, 0, 0, { top: 0.02 })]) }, MASONRY, (c, v) => {
    poly(c, [-0.38, -0.38, 0.38, -0.38, 0.38, 0.38, -0.38, 0.38]);
    fo(c, linear(c, -0.38, -0.38, 0.38, 0.38, v.light, v.dark));
    poly(c, [-0.38, -0.38, 0, 0, -0.38, 0.38]);
    fo(c, shade(v.dark, -0.08), 0.015);
    poly(c, [0.38, -0.38, 0, 0, 0.38, 0.38]);
    fo(c, shade(v.light, 0.06), 0.015);
  }),
  ...family({ id: "idol-small", name: "Small idol", category: D, group: "Pillars and statues", w: 0.6, h: 0.6, layer: "object", form: (v) => S.resting(S.solid([S.ball(0.2, 0, 0.35, v.tone, { z: 0.04, rz: 0.22, n: 8 }), S.ball(0.11, 0.3, 0.5, v.tone, { z: -0.12, n: 7 }), S.ball(0.018, 0.42, 0.45, "#ff4a3a", { x: -0.04, z: -0.22, n: 4 }), S.ball(0.018, 0.42, 0.45, "#ff4a3a", { x: 0.04, z: -0.22, n: 4 })])) }, IDOLS, (c, v) => {
    ell(c, 0, 0.04, 0.2, 0.22);
    fo(c, radial(c, 0, 0, 0.24, v.tone.light, v.tone.dark));
    disc(c, 0, -0.12, 0.11, v.tone);
    for (const x of [-0.04, 0.04]) disc(c, x, -0.13, 0.018, tone("#ff4a3a", "#8a0a0a"), 0.004);
  }),
];

function skeleton(c: C, x: number, y: number, a: number, s = 1): void {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.scale(s, s);
  disc(c, 0, -0.42, 0.09, BONE, 0.012);
  stroke(c, [0, -0.32, 0, 0.12], 0.035, BONE.light);
  for (let i = 0; i < 4; i++) stroke(c, [-0.12, -0.24 + i * 0.07, 0.12, -0.24 + i * 0.07], 0.02, BONE.dark);
  stroke(c, [0, -0.28, -0.24, -0.02, -0.28, 0.16], 0.025, BONE.light);
  stroke(c, [0, -0.28, 0.24, -0.04, 0.3, 0.12], 0.025, BONE.light);
  stroke(c, [0, 0.12, -0.12, 0.45], 0.03, BONE.light);
  stroke(c, [0, 0.12, 0.13, 0.46], 0.03, BONE.light);
  c.restore();
}

const tombs: PropDef[] = [
  ...family({ id: "coffin-plain", name: "Coffin", category: D, group: "Tombs and bones", w: 0.9, h: 2, layer: "object", form: (v) => v.b.key === "open" ? S.solid([S.slab([-0.25, -0.95, 0.25, -0.95, 0.4, -0.55, 0.3, 0.95, -0.3, 0.95, -0.4, -0.55], 0, 0.55, v.a, { hollow: 0.84, floor: 0.15 }), S.ball(0.11, 0.15, 0.32, "#e8e0cc", { z: -0.55, n: 7 }), S.cbox(0.1, 1.0, 0.15, 0.24, "#d8cfb8", 0, 0.15)]) : S.solid([S.slab([-0.25, -0.95, 0.25, -0.95, 0.4, -0.55, 0.3, 0.95, -0.3, 0.95, -0.4, -0.55], 0, 0.55, v.a, { top: 0.94 })], { surface: 0.55 }) }, cross(WOODS, SHUT_OPEN), (c, v) => {
    const outline = [-0.25, -0.95, 0.25, -0.95, 0.4, -0.55, 0.3, 0.95, -0.3, 0.95, -0.4, -0.55];
    poly(c, outline);
    fo(c, linear(c, -0.4, 0, 0.4, 0, v.a.light, v.a.dark));
    if (v.b.key === "open") {
      poly(c, outline.map((n) => n * 0.84));
      fo(c, "#2a1e16", 0.012);
      skeleton(c, 0, 0.05, 0, 1.4);
    } else stroke(c, [0, -0.7, 0, -0.3], 0.03, shade(v.a.dark, -0.2));
  }),
  ...family({ id: "sarcophagus-carved", name: "Carved sarcophagus", category: D, group: "Tombs and bones", w: 1.2, h: 2.2, layer: "object", form: (v) => v.b.key === "open" ? S.solid([S.box(-0.55, 0.55, -1.05, 1.05, 0, 0.85, v.a, { wall: 0.13, floor: 0.3 }), S.ball(0.13, 0.3, 0.5, "#e8e0cc", { z: -0.6, n: 7 }), S.rbox(0.55, 0.3, 1.0, 1.9, 0.3, 0.85, 1.0, v.a.light)]) : S.solid([S.cbox(1.1, 2.1, 0, 0.85, v.a), S.cbox(1.0, 2.0, 0.85, 1.0, v.a.light, 0, 0, { top: 0.92 }), S.ball(0.22, 0.95, 1.2, v.a.light, { z: -0.55, n: 8 }), S.cbox(0.44, 1.1, 1.0, 1.12, v.a.light, 0, 0.25, { top: 0.8 })], { surface: 1.0 }) }, cross(MASONRY, SHUT_OPEN), (c, v) => {
    cbox(c, 0, 0, 1.1, 2.1, v.a, 0.06);
    if (v.b.key === "open") {
      cbox(c, 0, 0, 0.84, 1.84, tone("#3a3028", "#1a140e"), 0.04);
      skeleton(c, 0, 0.05, 0, 1.6);
      c.save();
      c.translate(0.55, 0.3);
      c.rotate(0.3);
      cbox(c, 0, 0, 1, 1.9, tone(shade(v.a.light, 0.05), v.a.dark), 0.06);
      c.restore();
    } else {
      ell(c, 0, -0.55, 0.22, 0.24);
      fo(c, radial(c, 0, -0.55, 0.24, shade(v.a.light, 0.08), v.a.dark), 0.015);
      cbox(c, 0, 0.25, 0.44, 1.1, tone(shade(v.a.light, 0.08), v.a.dark), 0.1);
    }
  }),
  ...family({ id: "skeleton", name: "Skeleton", category: D, group: "Tombs and bones", w: 1, h: 1.2, layer: "floor", form: () => S.flat("bones lie on the floor") }, [vary("lying"), vary("slumped"), vary("scattered")], (c, v) => {
    if (v.key === "lying") skeleton(c, 0, 0, 0.1, 1.1);
    else if (v.key === "slumped") skeleton(c, 0, 0.05, 2.6, 0.9);
    else for (const [x, y, k] of scatter(9, 0.4, 1601)) stroke(c, [x - 0.08, y, x + 0.08, y + (k - 0.5) * 0.1], 0.03, BONE.light);
  }),
  ...family({ id: "bone-pile", name: "Pile of bones", category: D, group: "Tombs and bones", w: 1, h: 0.8, layer: "object", form: () => (w, h) => S.solid([S.ball(w / 2 - 0.12, -0.06, 0.3, "#e0d6bc", { rz: h / 2 - 0.1, lump: 0.4, n: 8 })]) }, [vary("small"), vary("large")], (c, v) => {
    const k = v.key === "small" ? 0.6 : 1;
    for (const [x, y, r] of scatter(Math.round(18 * k), 0.38 * k, 1611)) stroke(c, [x - 0.1, y, x + 0.1, y + (r - 0.5) * 0.15], 0.035, r > 0.5 ? BONE.light : BONE.dark);
    for (const [x, y] of scatter(Math.round(3 * k), 0.2 * k, 1613)) disc(c, x, y, 0.07, BONE, 0.012);
  }),
  ...family({ id: "skull-heap", name: "Heap of skulls", category: D, group: "Tombs and bones", w: 0.9, h: 0.8, layer: "object", form: (v) => S.solid(scatter(v.key === "small" ? 4 : 9, v.key === "small" ? 0.18 : 0.32, 1621).map(([x, z], i) => { const y = v.key === "large" && i >= 7 ? 0.14 : 0; return S.ball(0.09, y, y + 0.17, "#e8e0cc", { x, z, n: 7 }); })) }, [vary("small"), vary("large")], (c, v) => {
    for (const [x, y] of scatter(v.key === "small" ? 4 : 9, v.key === "small" ? 0.18 : 0.32, 1621)) {
      disc(c, x, y, 0.09, BONE, 0.012);
      for (const dx of [-0.03, 0.03]) disc(c, x + dx, y + 0.01, 0.02, tone("#2a2018", "#0a0806"), 0);
    }
  }),
];

const prison: PropDef[] = [
  ...family({ id: "iron-cage", name: "Cage", category: D, group: "Prison and torture", w: 1.2, h: 1.2, layer: "object", form: (v) => { const m = v.a.key === "iron" ? IRON : METALS[1]; return S.solid([S.box(-0.52, 0.52, -0.52, 0.52, 0, 0.06, m.dark), S.box(-0.52, 0.52, -0.52, 0.52, 1.9, 1.96, m.dark), [-0.5, -0.25, 0, 0.25, 0.5].flatMap((k) => [S.post(k, -0.5, 0.018, 0.06, 1.9, m.dark, 4), S.post(k, 0.5, 0.018, 0.06, 1.9, m.dark, 4), S.post(-0.5, k, 0.018, 0.06, 1.9, m.dark, 4), S.post(0.5, k, 0.018, 0.06, 1.9, m.dark, 4)]), ...(v.b.key === "prisoner" ? [S.cyl(0.16, 0.06, 0.75, "#a88a6a", { x: 0.05, z: 0.05, top: 0.7, n: 8 }), S.ball(0.09, 0.72, 0.95, "#d8b898", { x: 0.05, z: -0.05, n: 7 })] : [])], { note: "you see through its bars" }); } }, cross([vary("iron"), vary("bronze")], [vary("empty"), vary("prisoner", "with a prisoner")]), (c, v) => {
    const m = v.a.key === "iron" ? IRON : METALS[1];
    if (v.b.key === "prisoner") {
      disc(c, 0.05, 0.05, 0.16, tone("#c8a888", "#7a5a42"));
      disc(c, 0.05, -0.1, 0.09, tone("#e8c8a8", "#9a7a5a"), 0.012);
    }
    for (let k = -0.5; k <= 0.5; k += 0.125) {
      stroke(c, [k, -0.52, k, 0.52], 0.025, m.dark, "butt");
    }
    c.strokeStyle = m.light;
    c.lineWidth = 0.05;
    c.strokeRect(-0.52, -0.52, 1.04, 1.04);
  }),
  ...family({ id: "gibbet-cage", name: "Hanging cage", category: D, group: "Prison and torture", w: 0.8, h: 0.8, layer: "canopy", form: (v) => S.solid([S.limb([0, 2.4, 0], [0, 3.0, 0], 0.012, 0.012, IRON.dark, { n: 3 }), S.tub(0.34, 1.35, 1.38, IRON.light, 0.85, { n: 12 }), S.tub(0.34, 2.3, 2.33, IRON.light, 0.85, { n: 12 }), Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return S.post(Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0.012, 1.35, 2.33, IRON.dark, 3); }), S.cone(0.34, 2.33, 2.45, IRON.dark, { n: 12 }), ...(v.key === "bones" ? [S.ball(0.08, 1.4, 1.55, "#e8e0cc", { n: 6 })] : [])], { note: "it hangs from above: you see under it" }) }, [vary("empty"), vary("bones", "with bones")], (c, v) => {
    if (v.key === "bones") skeleton(c, 0, 0, 0.6, 0.6);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      stroke(c, [Math.cos(a) * 0.08, Math.sin(a) * 0.08, Math.cos(a) * 0.34, Math.sin(a) * 0.34], 0.02, IRON.dark);
    }
    circle(c, 0, 0, 0.34);
    c.strokeStyle = IRON.light;
    c.lineWidth = 0.04;
    c.stroke();
  }),
  ...family({ id: "shackles", name: "Shackles", category: D, group: "Prison and torture", w: 0.8, h: 0.4, layer: "floor", form: () => S.flat("shackles lie on the floor") }, [vary("iron"), vary("rusty")], (c, v) => {
    const col = v.key === "iron" ? IRON.dark : "#7a4a2a";
    for (const x of [-0.25, 0.25]) {
      circle(c, x, 0.05, 0.08);
      c.strokeStyle = col;
      c.lineWidth = 0.035;
      c.stroke();
    }
    for (let x = -0.17; x <= 0.17; x += 0.06) {
      ell(c, x, -0.04, 0.035, 0.022);
      c.stroke();
    }
  }),
  ...family({ id: "stocks", name: "Stocks", category: D, group: "Prison and torture", w: 1.4, h: 0.5, layer: "object", form: (v) => S.solid([S.box(-0.66, -0.54, -0.1, 0.1, 0, 1.05, v), S.box(0.54, 0.66, -0.1, 0.1, 0, 1.05, v), S.box(-0.68, 0.68, -0.18, 0.18, 0.72, 1.02, v)]) }, WOODS.filter((w) => ["pale", "walnut", "weathered"].includes(w.key)), (c, v) => {
    plank(c, -0.68, -0.18, 1.36, 0.36, v, 1701);
    for (const x of [-0.4, 0, 0.4]) disc(c, x, 0, x === 0 ? 0.09 : 0.06, tone("#2a1e16", "#0a0806"), 0.012);
  }),
  ...family({ id: "torture-rack", name: "Rack", category: D, group: "Prison and torture", w: 1, h: 2.2, layer: "object", form: (v) => S.solid([[-0.4, 0.4].map((x) => S.box(x - 0.07, x + 0.07, -1.05, 1.05, 0.55, 0.72, v)), [-0.4, 0.4].flatMap((x) => [-0.95, 0.95].map((z) => S.cbox(0.1, 0.1, 0, 0.55, v.dark, x, z))), [-0.8, 0.8].map((z) => S.limb([-0.45, 0.8, z], [0.45, 0.8, z], 0.06, 0.06, v.dark, { n: 6 })), [-0.8, 0.8].map((z) => S.limb([0.47, 0.8, z], [0.55, 0.8, z], 0.1, 0.1, IRON, { n: 6 })), S.limb([0, 0.8, -0.8], [0, 0.8, 0.8], 0.01, 0.01, "#c8b088", { n: 3 })], { surface: 0.72 }) }, WOODS.filter((w) => ["walnut", "ebony", "weathered"].includes(w.key)), (c, v) => {
    for (const x of [-0.4, 0.4]) plank(c, x - 0.07, -1.05, 0.14, 2.1, v, 1711 + x);
    for (const y of [-0.8, 0.8]) {
      stroke(c, [-0.45, y, 0.45, y], 0.08, shade(v.dark, -0.2));
      disc(c, 0.52, y, 0.08, IRON, 0.012);
    }
    stroke(c, [0, -0.8, 0, 0.8], 0.015, "#c8b088");
  }),
  ...family({ id: "iron-maiden", name: "Iron maiden", category: D, group: "Prison and torture", w: 1, h: 0.9, layer: "object", form: (v) => v.key === "open" ? S.solid([S.cyl(0.4, 0, 1.95, IRON, { rz: 0.3, top: 0.85, n: 12 }), S.cyl(0.3, 0.2, 1.75, "#1a1410", { z: 0.12, rz: 0.2, n: 10 }), S.rbox(0.32, 0.3, 0.72, 0.16, 0.9, 0, 1.85, IRON.dark)]) : S.solid([S.cyl(0.4, 0, 1.95, IRON, { rz: 0.3, top: 0.85, n: 12 }), S.ball(0.11, 1.55, 1.85, "#c8c0b0", { z: -0.12, n: 7 })]) }, SHUT_OPEN, (c, v) => {
    ell(c, 0, 0, 0.4, 0.3);
    fo(c, radial(c, 0, 0, 0.4, IRON.light, IRON.dark));
    if (v.key === "open") {
      ell(c, 0, 0, 0.3, 0.2);
      fo(c, "#1a1410", 0.012);
      for (const [x, y] of scatter(10, 0.18, 1721)) disc(c, x, y * 0.7, 0.015, METALS[3], 0);
      c.save();
      c.translate(0.32, 0.3);
      c.rotate(0.9);
      ell(c, 0, 0, 0.36, 0.12);
      fo(c, linear(c, 0, -0.1, 0, 0.1, IRON.light, IRON.dark));
      c.restore();
    } else disc(c, 0, -0.1, 0.08, tone("#d8d0c0", "#8a8070"), 0.012);
  }),
];

const traps: PropDef[] = [
  ...family({ id: "spike-trap", name: "Spike trap", category: D, group: "Traps", w: 1, h: 1, layer: "floor", form: (v) => v.key === "hidden" ? S.flat("a trap hidden in the floor") : S.solid([S.cbox(0.94, 0.94, 0, 0.02, "#6a6862"), [-0.35, -0.175, 0, 0.175, 0.35].flatMap((x) => [-0.35, -0.175, 0, 0.175, 0.35].map((z) => S.cone(0.05, 0.02, 0.32, METALS[3].light, { x, z, n: 4 })))], { painted: true }) }, [vary("hidden"), vary("sprung")], (c, v) => {
    cbox(c, 0, 0, 0.94, 0.94, tone("#8a8680", "#4a4844"), 0.02);
    for (let x = -0.35; x <= 0.36; x += 0.175) for (let y = -0.35; y <= 0.36; y += 0.175) {
      if (v.key === "sprung") {
        poly(c, [x - 0.05, y + 0.04, x + 0.05, y + 0.04, x, y - 0.07]);
        fo(c, linear(c, x, y - 0.07, x, y + 0.04, METALS[3].light, IRON.dark), 0.008);
      } else disc(c, x, y, 0.02, tone("#2a2826", "#0a0a0a"), 0);
    }
  }),
  ...family({ id: "pressure-plate", name: "Pressure plate", category: D, group: "Traps", w: 1, h: 1, layer: "floor", form: () => S.flat("a plate set into the floor") }, MASONRY.slice(0, 3), (c, v) => {
    cbox(c, 0, 0, 0.9, 0.9, tone(shade(v.light, -0.12), shade(v.dark, -0.12)), 0.02);
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.lineWidth = 0.02;
    c.strokeRect(-0.42, -0.42, 0.84, 0.84);
  }),
  ...family({ id: "bear-trap", name: "Bear trap", category: D, group: "Traps", w: 0.8, h: 0.8, layer: "floor", form: (v) => v.key === "open" ? S.solid([S.tub(0.3, 0, 0.06, IRON.dark, 0.78, { n: 12, floor: 0.0 }), S.cyl(0.08, 0, 0.04, IRON, { n: 8 })], { painted: true }) : S.solid([S.limb([-0.3, 0.08, 0], [0.3, 0.08, 0], 0.08, 0.08, IRON, { n: 6 })]) }, SHUT_OPEN, (c, v) => {
    if (v.key === "open") {
      for (const s of [-1, 1]) {
        c.beginPath();
        c.arc(0, 0, 0.3, s > 0 ? -1.3 : 1.84, s > 0 ? 1.3 : 4.44);
        c.strokeStyle = IRON.dark;
        c.lineWidth = 0.04;
        c.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        stroke(c, [Math.cos(a) * 0.3, Math.sin(a) * 0.3, Math.cos(a) * 0.22, Math.sin(a) * 0.22], 0.02, IRON.light);
      }
      disc(c, 0, 0, 0.08, IRON);
    } else {
      ell(c, 0, 0, 0.3, 0.08);
      fo(c, linear(c, 0, -0.08, 0, 0.08, IRON.light, IRON.dark));
    }
  }),
  ...family({ id: "pit-trap", name: "Pit trap", category: D, group: "Traps", w: 1, h: 1, layer: "floor", form: (v) => S.flat(v.key === "covered" ? "a pit hidden under the floor" : "a pit in the floor") }, [vary("covered"), vary("open"), vary("spiked")], (c, v) => {
    if (v.key === "covered") {
      cbox(c, 0, 0, 0.9, 0.9, tone("#8a8680", "#5a5854"), 0.02);
      stroke(c, [-0.45, -0.45, 0.45, 0.45], 0.012, "rgba(0,0,0,0.3)");
      return;
    }
    cbox(c, 0, 0, 0.94, 0.94, tone("#2a2622", "#050404"), 0.02);
    if (v.key === "spiked") for (const [x, y] of scatter(12, 0.34, 1801)) {
      poly(c, [x - 0.03, y + 0.03, x + 0.03, y + 0.03, x, y - 0.05]);
      fo(c, METALS[3].dark, 0.006);
    }
  }),
  ...family({ id: "blade-trap", name: "Blade trap", category: D, group: "Traps", w: 2, h: 0.6, layer: "object", form: () => S.solid([S.box(-1.0, 1.0, -0.05, 0.05, 2.95, 3.0, "#2a2a2e"), S.limb([0, 2.95, 0], [0, 1.3, 0], 0.02, 0.02, IRON.dark, { n: 4 }), S.panel(-0.55, 0, 0.55, 0, 0.03, 0.75, 1.3, METALS[3].light)], { note: "a blade swinging from the ceiling along its slot" }) }, [vary("swinging")], (c) => {
    stroke(c, [-0.95, 0, 0.95, 0], 0.03, "rgba(0,0,0,0.45)");
    c.beginPath();
    c.arc(0, -0.6, 0.85, 1.1, 2.04);
    c.lineTo(0, -0.6);
    c.closePath();
    fo(c, linear(c, 0, 0, 0, 0.3, METALS[3].light, IRON.dark));
  }),
  ...family({ id: "rune-trap", name: "Rune trap", category: D, group: "Traps", w: 1, h: 1, layer: "floor", form: () => S.flat("a rune drawn on the floor") }, GLOWS, (c, v) => rune(c, 0.4, v, 1811)),
];

/** A glowing rune circle on the floor. */
function rune(c: C, r: number, g: Glow, seed: number, candles = false): void {
  glow(c, 0, 0, r * 1.3, g.rgb, 0.3);
  c.strokeStyle = g.light;
  c.lineWidth = 0.025;
  circle(c, 0, 0, r);
  c.stroke();
  circle(c, 0, 0, r * 0.8);
  c.stroke();
  const rand = rng(seed);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * r * 0.9;
    const y = Math.sin(a) * r * 0.9;
    stroke(c, [x - 0.03, y - 0.03, x + 0.03 * rand(), y + 0.03], 0.015, g.light);
  }
  poly(c, [0, -r * 0.8, r * 0.7, r * 0.4, -r * 0.7, r * 0.4]);
  c.stroke();
  if (candles) for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    disc(c, Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12, 0.05, tone("#f4ecd4", "#c8b88a"), 0.01);
    coloredFlame(c, Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12, 0.035, g);
  }
}

const magic: PropDef[] = [
  ...family({ id: "summoning-circle", name: "Summoning circle", category: D, group: "Magic", w: 2.4, h: 2.4, layer: "floor", form: () => S.flat("a circle drawn on the floor") }, GLOWS, (c, v) => rune(c, 1, v, 1901), { light: (v) => ({ radius: 4, color: v.color, intensity: 0.6 }) }),
  ...family({ id: "ritual-circle", name: "Ritual circle with candles", category: D, group: "Magic", w: 2.6, h: 2.6, layer: "floor", form: (v) => S.solid(Array.from({ length: 5 }, (_, i) => { const a = (i / 5) * Math.PI * 2 - Math.PI / 2, x = Math.cos(a) * 1.12, z = Math.sin(a) * 1.12; return [S.cyl(0.05, 0, 0.25, "#f4ecd4", { x, z, n: 6 }), S.fire(x, z, 0.25, 0.08, 0.03, v.light)]; }), { painted: true, note: "candles round a circle drawn on the floor" }) }, GLOWS, (c, v) => rune(c, 1, v, 1911, true), { light: (v) => ({ radius: 5, color: v.color, intensity: 0.7 }) }),
  ...family({ id: "portal-ring", name: "Portal", category: D, group: "Magic", w: 2, h: 2, layer: "object", form: (v) => S.solid([S.tub(0.9, 0, 0.5, MASONRY[3], 0.8, { n: 16, floor: 0.45 }), S.cyl(0.72, 0.45, 0.48, v.b.key === "open" ? v.a.light : "#1a1820", { n: 16, glow: v.b.key === "open" })], { note: "a ring of stone round a pool of light" }) }, cross(GLOWS, [vary("open"), vary("dormant")]), (c, v) => {
    disc(c, 0, 0, 0.9, MASONRY[3]);
    circle(c, 0, 0, 0.72);
    if (v.b.key === "open") {
      c.fillStyle = radial(c, 0, 0, 0.72, v.a.light, v.a.dark);
      c.fill();
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.arc(0, 0, 0.2 + i * 0.16, i, i + 4);
        c.strokeStyle = "rgba(255,255,255,0.45)";
        c.lineWidth = 0.03;
        c.stroke();
      }
    } else fo(c, "#1a1820", 0.02);
  }, { light: (v) => (v.b.key === "open" ? { radius: 5, color: v.a.color, intensity: 0.8 } : undefined) }),
  ...family({ id: "scrying-pool", name: "Scrying pool", category: D, group: "Magic", w: 1.4, h: 1.4, layer: "object", form: (v) => S.solid([S.tub(0.64, 0, 0.75, MASONRY[0], 0.78, { n: 14, floor: 0.55 }), S.cyl(0.5, 0.55, 0.6, v.key === "clear" ? "#7ac0e8" : "#4a2a6a", { n: 14, glow: true })]) }, [vary("clear"), vary("dark")], (c, v) => {
    disc(c, 0, 0, 0.64, MASONRY[0]);
    circle(c, 0, 0, 0.5);
    c.fillStyle = v.key === "clear" ? radial(c, 0, 0, 0.5, "#c8f0ff", "#2a6a9a") : radial(c, 0, 0, 0.5, "#6a4a8a", "#0a0614");
    c.fill();
    glow(c, 0, 0, 0.6, v.key === "clear" ? "160,220,255" : "160,90,220", 0.3);
  }),
  ...family({ id: "witch-cauldron", name: "Bubbling cauldron", category: D, group: "Magic", w: 1, h: 1, layer: "object", form: (v) => S.solid([S.cyl(0.33, 0, 0.12, "#2a2a30", { top: 1.2, n: 10 }), S.tub(0.42, 0.12, 0.62, "#2e2e34", 0.8, { top: 0.88, floor: 0.42 }), S.cyl(0.34, 0.42, 0.52, v.dark, { n: 10, glow: true })], { note: "the brew's glow is drawn round it" }) }, GLOWS, (c, v) => {
    disc(c, 0, 0, 0.42, tone("#4a4a50", "#141418"));
    circle(c, 0, 0, 0.34);
    c.fillStyle = radial(c, 0, 0, 0.34, v.light, v.dark);
    c.fill();
    for (const [x, y, k] of scatter(6, 0.22, 1931)) {
      circle(c, x, y, 0.03 + k * 0.03);
      c.strokeStyle = "rgba(255,255,255,0.5)";
      c.lineWidth = 0.01;
      c.stroke();
    }
    glow(c, 0, 0, 0.5, v.rgb, 0.3);
  }, { light: (v) => ({ radius: 3, color: v.color, intensity: 0.6 }) }),
];

const stains: PropDef[] = [
  ...family({ id: "blood-pool", name: "Blood", category: D, group: "Stains and floor", w: 1, h: 1, layer: "floor", form: () => S.flat("blood lies on the floor") }, [vary("small", "small pool"), vary("large", "large pool"), vary("trail")], (c, v) => {
    const col = tone("#a01a1a", "#4a0606");
    if (v.key === "trail") {
      for (const [x, y, k] of scatter(9, 0.12, 2001)) disc(c, x * 0.5 + (k - 0.5) * 0.9, y, 0.03 + k * 0.04, col, 0);
      return;
    }
    const r = v.key === "small" ? 0.22 : 0.4;
    for (const [x, y, k] of scatter(6, r * 0.5, 2003)) disc(c, x, y, r * (0.4 + k * 0.4), col, 0);
  }),
  ...family({ id: "slime-puddle", name: "Slime", category: D, group: "Stains and floor", w: 1, h: 1, layer: "floor", form: () => S.flat("slime lies on the floor") }, [vary("green"), vary("purple"), vary("black")], (c, v) => {
    const col = v.key === "green" ? tone("#9ae05a", "#2a7a1a") : v.key === "purple" ? tone("#c890f0", "#5a1a8a") : tone("#4a4a52", "#08080a");
    for (const [x, y, k] of scatter(6, 0.2, 2011)) disc(c, x, y, 0.12 + k * 0.1, col, 0);
    for (const [x, y] of scatter(4, 0.25, 2013)) disc(c, x, y, 0.03, tone("#ffffff", col.light), 0);
  }),
  ...family({ id: "scorch-mark", name: "Scorch mark", category: D, group: "Stains and floor", w: 1.2, h: 1.2, layer: "floor", form: () => S.flat("a scorch mark on the floor") }, [vary("small"), vary("large")], (c, v) => {
    const r = v.key === "small" ? 0.32 : 0.55;
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, "rgba(10,8,6,0.85)");
    g.addColorStop(0.7, "rgba(30,20,10,0.5)");
    g.addColorStop(1, "rgba(30,20,10,0)");
    c.fillStyle = g;
    circle(c, 0, 0, r);
    c.fill();
  }),
  ...family({ id: "floor-grate", name: "Floor grate", category: D, group: "Stains and floor", w: 1, h: 1, layer: "floor", form: () => S.flat("a grate in the floor") }, cross([vary("iron"), vary("bronze")], [vary("square"), vary("round")]), (c, v) => {
    const m = v.a.key === "iron" ? IRON : METALS[1];
    if (v.b.key === "round") circle(c, 0, 0, 0.4);
    else rr(c, -0.4, -0.4, 0.8, 0.8, 0.03);
    fo(c, "#0a0806");
    c.save();
    c.clip();
    for (let k = -0.35; k <= 0.36; k += 0.1) stroke(c, [k, -0.45, k, 0.45], 0.035, m.light, "butt");
    c.restore();
    if (v.b.key === "round") circle(c, 0, 0, 0.4);
    else rr(c, -0.4, -0.4, 0.8, 0.8, 0.03);
    c.strokeStyle = m.dark;
    c.lineWidth = 0.05;
    c.stroke();
  }),
  ...family({ id: "floor-crack", name: "Crack in the floor", category: D, group: "Stains and floor", w: 1.4, h: 1, layer: "floor", form: () => S.flat("a crack in the floor") }, [vary("small"), vary("large")], (c, v) => {
    const k = v.key === "small" ? 0.6 : 1;
    stroke(c, [-0.65 * k, -0.2 * k, -0.25 * k, 0, 0.05 * k, -0.25 * k, 0.4 * k, 0.1 * k, 0.65 * k, 0.05 * k], 0.04 * k, "#120e0a");
    stroke(c, [0.05 * k, -0.25 * k, 0.15 * k, -0.45 * k], 0.025 * k, "#120e0a");
  }),
];

const EGGS: (Variant & { tone: Tone })[] = [
  { key: "green", name: "green", tone: tone("#b0e090", "#4a8a3a") },
  { key: "red", name: "red", tone: tone("#f0907a", "#8a2a1a") },
  { key: "white", name: "white", tone: tone("#fbf8f0", "#c8c0b0") },
  { key: "black", name: "black", tone: tone("#5a5660", "#141218") },
];

const lairs: PropDef[] = [
  ...family({ id: "monster-nest", name: "Monster nest", category: D, group: "Lairs", w: 2, h: 2, layer: "floor", form: () => (w, h) => S.solid([S.tub(w / 2 - 0.05, 0, 0.5, "#6a4a2a", 0.65, { rz: h / 2 - 0.05, n: 12, floor: 0.12 })]) }, [vary("small"), vary("large")], (c, v) => {
    const r = v.key === "small" ? 0.55 : 0.9;
    const rand = rng(2101);
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * (0.7 + rand() * 0.3);
      stroke(c, [Math.cos(a) * d, Math.sin(a) * d, Math.cos(a + 0.4) * d, Math.sin(a + 0.4) * d], 0.03, i % 2 ? "#6a4a2a" : "#8a6a3a");
    }
    disc(c, 0, 0, r * 0.65, tone("#5a4228", "#2a1e10"), 0.012);
  }, { size: (v) => (v.key === "small" ? [1.3, 1.3] : [2, 2]) }),
  ...family({ id: "egg-clutch", name: "Clutch of eggs", category: D, group: "Lairs", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid(scatter(4, 0.18, 2111).map(([x, z]) => S.ball(0.1, 0, 0.32, v.tone, { x, z, n: 7 }))) }, EGGS, (c, v) => {
    for (const [x, y, k] of scatter(4, 0.18, 2111)) {
      ell(c, x, y, 0.1, 0.13, k);
      fo(c, radial(c, x, y, 0.13, v.tone.light, v.tone.dark), 0.012);
    }
  }),
  ...family({ id: "cobweb", name: "Cobweb", category: D, group: "Lairs", w: 1.2, h: 1.2, layer: "canopy", form: () => S.flat("a web is too fine to stand up: it stays painted where it is drawn") }, [vary("corner"), vary("large"), vary("torn")], (c, v) => {
    const spokes = v.key === "corner" ? 5 : 9;
    const span = v.key === "corner" ? Math.PI / 2 : Math.PI * 2;
    const ox = v.key === "corner" ? -0.5 : 0;
    const oy = v.key === "corner" ? -0.5 : 0;
    c.strokeStyle = "rgba(240,240,240,0.7)";
    c.lineWidth = 0.012;
    for (let i = 0; i < spokes; i++) {
      const a = (i / (spokes - (v.key === "corner" ? 1 : 0))) * span;
      c.beginPath();
      c.moveTo(ox, oy);
      c.lineTo(ox + Math.cos(a) * 0.8, oy + Math.sin(a) * 0.8);
      c.stroke();
    }
    for (let r = 0.15; r < 0.8; r += 0.13) {
      if (v.key === "torn" && r > 0.4) break;
      c.beginPath();
      c.arc(ox, oy, r, 0, span);
      c.stroke();
    }
  }),
];

const waysDown: PropDef[] = [
  ...family({ id: "stairway", name: "Stairway", category: D, group: "Stairs and ways down", w: 1, h: 2, layer: "floor", form: () => S.flat("a way to another level: the 3D view shows one level, so its steps stay painted") }, cross(MASONRY, [vary("straight"), vary("spiral")]), (c, v) => {
    if (v.b.key === "spiral") {
      disc(c, 0, 0, 0.92, tone(shade(v.a.dark, -0.2), shade(v.a.dark, -0.5)));
      for (let i = 0; i < 10; i++) {
        const a0 = (i / 10) * Math.PI * 2;
        const a1 = a0 + Math.PI / 5;
        const k = 1 - i * 0.06;
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, 0.9, a0, a1);
        c.closePath();
        fo(c, linear(c, 0, 0, Math.cos(a0) * 0.9, Math.sin(a0) * 0.9, shade(v.a.light, -(1 - k)), shade(v.a.dark, -(1 - k))), 0.012);
      }
      disc(c, 0, 0, 0.14, v.a);
      return;
    }
    for (let i = 0; i < 8; i++) {
      const k = i / 8;
      box(c, -0.48, -0.98 + i * 0.245, 0.96, 0.25, tone(shade(v.a.light, -k * 0.6), shade(v.a.dark, -k * 0.6)), 0.01);
    }
  }, { size: (v) => (v.b.key === "spiral" ? [2, 2] : [1, 2]) }),
  ...family({ id: "ladder", name: "Ladder", category: D, group: "Stairs and ways down", w: 0.6, h: 2, layer: "object", form: () => S.flat("a way to another level: the 3D view shows one level, so it stays painted") }, WOODS.filter((w) => ["pale", "walnut", "weathered"].includes(w.key)), (c, v) => {
    for (const x of [-0.22, 0.22]) stroke(c, [x, -0.95, x, 0.95], 0.06, v.dark, "butt");
    for (let y = -0.8; y <= 0.81; y += 0.26) stroke(c, [-0.22, y, 0.22, y], 0.045, v.light, "butt");
  }),
  ...family({ id: "hatch", name: "Hatch", category: D, group: "Stairs and ways down", w: 1, h: 1, layer: "floor", form: (v) => S.flat(v.b.key === "open" ? "a way down through the floor" : "a hatch in the floor") }, cross(WOODS.filter((w) => ["pale", "walnut", "weathered"].includes(w.key)), SHUT_OPEN), (c, v) => {
    if (v.b.key === "open") {
      cbox(c, 0, 0, 0.9, 0.9, tone("#2a2622", "#050404"), 0.02);
      for (let i = 0; i < 3; i++) stroke(c, [-0.3, -0.25 + i * 0.25, 0.3, -0.25 + i * 0.25], 0.04, shade(v.a.dark, -0.4), "butt");
      return;
    }
    for (let i = 0; i < 4; i++) plank(c, -0.45 + i * 0.225, -0.45, 0.22, 0.9, v.a, 2201 + i);
    for (const y of [-0.3, 0.3]) stroke(c, [-0.45, y, 0.45, y], 0.05, IRON.dark, "butt");
    circle(c, 0.25, 0, 0.06);
    c.strokeStyle = IRON.light;
    c.lineWidth = 0.02;
    c.stroke();
  }),
];

const mechanisms: PropDef[] = [
  ...family({ id: "wall-lever", name: "Wall lever", category: D, group: "Levers and mechanisms", w: 0.5, h: 0.5, layer: "object", form: (v) => S.solid([S.cbox(0.3, 0.18, 0.9, 1.35, v.a), S.limb([0, 1.12, 0], v.b.key === "up" ? [-0.14, 1.42, -0.19] : [0.14, 0.82, -0.19], 0.02, 0.02, v.a.dark, { n: 4 }), S.ball(0.05, v.b.key === "up" ? 1.39 : 0.79, v.b.key === "up" ? 1.49 : 0.89, "#c8403c", { x: v.b.key === "up" ? -0.14 : 0.14, z: -0.19, n: 6 })], { note: "on the wall, at chest height" }) }, cross(METALS, [vary("up"), vary("down")]), (c, v) => {
    cbox(c, 0, 0, 0.3, 0.18, v.a, 0.03);
    c.save();
    c.rotate(v.b.key === "up" ? -0.6 : 0.6);
    stroke(c, [0, 0, 0, -0.24], 0.04, v.a.dark);
    disc(c, 0, -0.24, 0.05, tone("#c8403c", "#781c1c"), 0.01);
    c.restore();
  }),
  ...family({ id: "gong", name: "Gong", category: D, group: "Levers and mechanisms", w: 1.2, h: 0.5, layer: "object", form: (v) => S.solid([S.post(-0.55, 0, 0.05, 0, 1.95, WOODS[3]), S.post(0.55, 0, 0.05, 0, 1.95, WOODS[3]), S.limb([-0.6, 1.9, 0], [0.6, 1.9, 0], 0.045, 0.045, WOODS[3], { n: 5 }), S.limb([0, 1.9, 0], [0, 1.62, 0], 0.01, 0.01, "#3a3a3e", { n: 3 }), S.limb([0, 1.2, -0.03], [0, 1.2, 0.03], 0.4, 0.4, v, { n: 14 })], { note: "it hangs on edge in its frame: the drawing shows its face" }) }, METALS.slice(0, 3), (c, v) => {
    for (const x of [-0.55, 0.55]) disc(c, x, 0, 0.05, WOODS[3]);
    stroke(c, [-0.55, 0, 0.55, 0], 0.05, WOODS[3].light);
    ell(c, 0, 0.02, 0.4, 0.12);
    fo(c, linear(c, -0.4, 0, 0.4, 0, v.light, v.dark));
  }),
  ...family({ id: "winch", name: "Winch", category: D, group: "Levers and mechanisms", w: 1.2, h: 0.7, layer: "object", form: (v) => S.solid([S.box(-0.55, -0.35, -0.3, 0.3, 0, 0.85, WOODS[2]), S.box(0.35, 0.55, -0.3, 0.3, 0, 0.85, WOODS[2]), S.limb([-0.35, 0.65, 0], [0.35, 0.65, 0], 0.16, 0.16, v.key === "chain" ? IRON : "#c8a870", { n: 10 }), S.limb([0.55, 0.65, 0], [0.62, 0.65, 0.3], 0.025, 0.025, IRON.dark, { n: 4 })]) }, [vary("chain"), vary("rope")], (c, v) => {
    box(c, -0.55, -0.3, 0.2, 0.6, WOODS[2]);
    box(c, 0.35, -0.3, 0.2, 0.6, WOODS[2]);
    rr(c, -0.35, -0.16, 0.7, 0.32, 0.12);
    fo(c, linear(c, 0, -0.16, 0, 0.16, v.key === "chain" ? IRON.light : "#d8c090", v.key === "chain" ? IRON.dark : "#8a6a3a"));
    stroke(c, [0.55, 0, 0.62, 0.3], 0.04, IRON.dark);
  }),
];

export const DUNGEON_PROPS: PropDef[] = [...pillars, ...tombs, ...prison, ...traps, ...magic, ...stains, ...lairs, ...waysDown, ...mechanisms];

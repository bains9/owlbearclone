// Copied from Dungeon (src/render/props-workshop.ts) by scripts/sync-dungeon-library.mjs, Dungeon 24c27e0. Change it there and run the script again.
import { flame, rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, MASONRY, CLOTHS, CLAYS, GOLD, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, glow, stroke, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// Workshops for the big library: the smithy, carpentry, textiles, pottery and leather.

const W = "Workshop & smithy" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const IRON = METALS[0];
const THREE_WOODS = WOODS.filter((w) => ["pale", "walnut", "weathered"].includes(w.key));
const LIT = [vary("lit"), vary("cold")];

function anvil(c: C, m: Tone): void {
  poly(c, [-0.36, -0.1, 0.18, -0.12, 0.38, -0.02, 0.18, 0.1, -0.36, 0.1]);
  fo(c, linear(c, 0, -0.12, 0, 0.1, m.light, m.dark));
}

const smithy: PropDef[] = [
  ...family({ id: "forge-hearth", name: "Forge", category: W, group: "Smithy", w: 1.4, h: 1.2, layer: "object", form: (v) => S.solid([S.cbox(1.3, 1.1, 0, 0.85, v.a), S.cyl(0.36, 0.85, 0.88, v.b.key === "lit" ? "#ff7a2a" : "#2a1e16", { n: 12, glow: v.b.key === "lit" }), ...(v.b.key === "lit" ? S.fire(0, 0, 0.88, 0.3, 0.22, "#ff8a2a") : [])], { surface: 0.85 }) }, cross(MASONRY.slice(0, 3), LIT), (c, v) => {
    cbox(c, 0, 0, 1.3, 1.1, v.a, 0.05);
    disc(c, 0, 0, 0.36, tone("#3a2a20", "#120c08"), 0.015);
    if (v.b.key === "lit") {
      for (const [x, y] of scatter(12, 0.24, 3001)) disc(c, x, y, 0.05, tone("#ffd060", "#e0400a"), 0);
      glow(c, 0, 0, 0.5, "255,140,40", 0.5);
    }
  }, { light: (v) => (v.b.key === "lit" ? { radius: 6, color: "#ff9a4a", intensity: 1 } : undefined) }),
  ...family({ id: "anvil-block", name: "Anvil on its block", category: W, group: "Smithy", w: 0.9, h: 0.6, layer: "object", form: (v) => { const m = v.a.key === "iron" ? IRON : METALS[1]; return S.solid([S.cyl(0.26, 0, 0.45, WOODS[2], { n: 9 }), S.slab([-0.36, -0.1, 0.18, -0.12, 0.38, -0.02, 0.18, 0.1, -0.36, 0.1], 0.45, 0.8, m, { top: 0.95 }), ...(v.b.key === "tools" ? [S.limb([-0.3, 0.82, 0.08], [0.05, 0.82, 0.1], 0.02, 0.02, WOODS[1].dark, { n: 4 }), S.cbox(0.08, 0.06, 0.8, 0.86, IRON, 0.08, 0.08), S.limb([0.2, 0.82, -0.08], [0.4, 0.81, -0.06], 0.012, 0.012, IRON.dark, { n: 3 })] : [])], { surface: 0.8 }); } }, cross([vary("iron"), vary("bronze")], [vary("bare"), vary("tools", "with tools")]), (c, v) => {
    disc(c, 0, 0, 0.26, WOODS[2]);
    anvil(c, v.a.key === "iron" ? IRON : METALS[1]);
    if (v.b.key === "tools") {
      stroke(c, [-0.3, 0.2, 0.05, 0.24], 0.03, WOODS[1].dark);
      cbox(c, 0.08, 0.24, 0.08, 0.06, IRON, 0.01);
      stroke(c, [0.2, -0.22, 0.4, -0.18], 0.02, IRON.dark);
    }
  }),
  ...family({ id: "quench-trough", name: "Quench trough", category: W, group: "Smithy", w: 1.2, h: 0.6, layer: "object", form: (v) => S.solid([S.box(-0.56, 0.56, -0.26, 0.26, 0, 0.6, v, { wall: 0.08, floor: 0.15 }), S.box(-0.48, 0.48, -0.18, 0.18, 0.15, 0.48, "#3a5866")]) }, THREE_WOODS, (c, v) => {
    box(c, -0.56, -0.26, 1.12, 0.52, v, 0.04);
    rr(c, -0.48, -0.18, 0.96, 0.36, 0.03);
    fo(c, radial(c, 0, 0, 0.5, "#6a8a9a", "#2a3a44"), 0.012);
  }),
  ...family({ id: "grinding-wheel", name: "Grinding wheel", category: W, group: "Smithy", w: 0.9, h: 0.5, layer: "object", form: (v) => S.solid([S.box(-0.4, 0.4, -0.2, 0.2, 0, 0.42, WOODS[2]), S.limb([-0.08, 0.75, 0], [0.08, 0.75, 0], 0.24, 0.24, v, { n: 12 }), S.limb([0.08, 0.75, 0], [0.36, 0.75, 0.1], 0.02, 0.02, IRON.dark, { n: 4 })]) }, MASONRY.filter((m) => ["granite", "sandstone", "slate"].includes(m.key)), (c, v) => {
    box(c, -0.4, -0.2, 0.8, 0.4, WOODS[2], 0.03);
    rr(c, -0.08, -0.24, 0.16, 0.48, 0.04);
    fo(c, linear(c, 0, -0.24, 0, 0.24, v.light, v.dark), 0.015);
    stroke(c, [0.08, 0, 0.36, 0.1], 0.03, IRON.dark);
  }),
  ...family({ id: "bellows", name: "Bellows", category: W, group: "Smithy", w: 0.9, h: 0.5, layer: "object", form: (v) => { const leather = v.key === "brown" ? "#7a5232" : "#38342f"; return S.solid([S.slab([-0.38, -0.2, 0.2, -0.12, 0.38, 0, 0.2, 0.12, -0.38, 0.2], 0, 0.3, leather, { top: 0.75 }), S.limb([0.36, 0.12, 0], [0.44, 0.1, 0], 0.03, 0.025, METALS[1].dark, { n: 5 })]); } }, [vary("brown", "brown leather"), vary("black", "black leather")], (c, v) => {
    const leather = v.key === "brown" ? tone("#9a6a3e", "#4a2e18") : tone("#55504a", "#1a1816");
    poly(c, [-0.38, -0.2, 0.2, -0.12, 0.38, 0, 0.2, 0.12, -0.38, 0.2]);
    fo(c, linear(c, 0, -0.2, 0, 0.2, leather.light, leather.dark));
    stroke(c, [0.36, 0, 0.44, 0], 0.04, METALS[1].dark);
  }),
  ...family({ id: "ingot-stack", name: "Stack of ingots", category: W, group: "Smithy", w: 0.7, h: 0.5, layer: "object", form: (v) => S.resting(S.solid([[0, 1, 2].map((i) => S.box(-0.29 + i * 0.2, -0.11 + i * 0.2, 0.02, 0.14, 0, 0.06, v, { top: 0.8 })), [0, 1].map((i) => S.box(-0.19 + i * 0.2, -0.01 + i * 0.2, -0.12, 0.0, 0.06, 0.12, v, { top: 0.8 }))])) }, [...METALS, GOLD], (c, v) => {
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3 - row; i++) {
      const x = -0.2 + i * 0.2 + row * 0.1;
      const y = 0.08 - row * 0.14;
      poly(c, [x - 0.09, y - 0.06, x + 0.09, y - 0.06, x + 0.07, y + 0.06, x - 0.07, y + 0.06]);
      fo(c, linear(c, x, y - 0.06, x, y + 0.06, v.light, v.dark), 0.012);
    }
  }),
  ...family({ id: "ore-pile", name: "Pile of ore", category: W, group: "Smithy", w: 0.9, h: 0.7, layer: "object", form: (v) => S.lump(0.38, v.tone, { sink: 0.3, lump: 0.4 }) }, [
    { key: "iron", name: "iron", tone: tone("#9a6a5a", "#4a2a22") },
    { key: "copper", name: "copper", tone: tone("#6ab49a", "#2a6a52") },
    { key: "silver", name: "silver", tone: tone("#c8ccd4", "#6a707a") },
    { key: "gold", name: "gold", tone: tone("#e8c860", "#8a6a1a") },
  ] as (Variant & { tone: Tone })[], (c, v) => {
    for (const [x, y, k] of scatter(11, 0.26, 3011)) disc(c, x, y * 0.8, 0.06 + k * 0.05, k > 0.6 ? v.tone : tone("#8a8680", "#4a4844"), 0.01);
  }),
  ...family({ id: "smelter", name: "Smelter", category: W, group: "Smithy", w: 1.2, h: 1.2, layer: "object", form: (v) => S.solid([S.cyl(0.55, 0, 1.4, MASONRY[0], { top: 0.7, n: 12, hollow: 0.8, floor: 1.2 }), S.cyl(0.3, 1.2, 1.25, v.key === "lit" ? "#ffb040" : "#2a1e16", { n: 10, glow: v.key === "lit" }), S.limb([0.3, 0.35, 0.3], [0.55, 0.25, 0.5], 0.05, 0.04, IRON.dark, { n: 5 })]) }, LIT, (c, v) => {
    disc(c, 0, 0, 0.55, MASONRY[0]);
    disc(c, 0, 0, 0.3, tone("#3a2a20", "#120c08"), 0.015);
    if (v.key === "lit") {
      disc(c, 0, 0, 0.22, tone("#ffe080", "#e05a0a"), 0);
      glow(c, 0, 0, 0.5, "255,140,40", 0.5);
    }
    stroke(c, [0.3, 0.3, 0.55, 0.5], 0.08, IRON.dark);
  }, { light: (v) => (v.key === "lit" ? { radius: 6, color: "#ff8a3a", intensity: 1 } : undefined) }),
];

const carpentry: PropDef[] = [
  ...family({ id: "workbench", name: "Workbench", category: W, group: "Carpentry", w: 2, h: 0.8, layer: "object", form: (v) => S.plus(S.table(0.85, v.a, v.a, { thick: 0.08, leg: 0.1 }), S.cbox(0.12, 0.3, 0.85, 1.0, IRON, -0.8, 0), ...(v.b.key === "cluttered" ? [S.limb([-0.3, 0.88, -0.1], [0.1, 0.88, -0.05], 0.025, 0.025, WOODS[1].dark, { n: 4 }), S.cbox(0.08, 0.06, 0.85, 0.9, IRON, 0.15, -0.05), S.box(0.3, 0.6, 0.12, 0.2, 0.85, 0.86, IRON.light)] : [])) }, cross(WOODS, [vary("tidy"), vary("cluttered")]), (c, v) => {
    plank(c, -0.98, -0.37, 1.96, 0.74, v.a, 3101);
    cbox(c, -0.8, 0, 0.12, 0.3, IRON, 0.02);
    if (v.b.key === "cluttered") {
      stroke(c, [-0.3, -0.1, 0.1, -0.05], 0.035, WOODS[1].dark);
      cbox(c, 0.15, -0.05, 0.08, 0.06, IRON, 0.01);
      for (const [x, y] of scatter(9, 0.2, 3103)) stroke(c, [x + 0.5, y, x + 0.56, y + 0.03], 0.012, "#e8d0a0");
      poly(c, [0.3, 0.12, 0.6, 0.12, 0.6, 0.2, 0.3, 0.2]);
      fo(c, IRON.light, 0.01);
    }
  }),
  ...family({ id: "lumber-stack", name: "Stack of lumber", category: W, group: "Carpentry", w: 2.4, h: 0.8, layer: "object", form: (v) => S.solid(Array.from({ length: 5 }, (_, i) => S.box(-1.15 + (i % 2) * 0.06, 1.09 + (i % 2) * 0.06, -0.36 + i * 0.15, -0.23 + i * 0.15, 0, 0.5, v)), { surface: 0.5 }) }, WOODS, (c, v) => {
    for (let i = 0; i < 5; i++) plank(c, -1.15 + (i % 2) * 0.06, -0.36 + i * 0.15, 2.24, 0.13, v, 3111 + i);
  }),
  ...family({ id: "sawhorse", name: "Sawhorse", category: W, group: "Carpentry", w: 1.2, h: 0.5, layer: "object", form: (v) => S.solid([S.box(-0.56, 0.56, -0.06, 0.06, 0.62, 0.7, v), [-0.45, 0.45].flatMap((x) => [S.limb([x, 0.64, -0.03], [x - 0.08, 0, -0.2], 0.025, 0.025, v.dark, { n: 4 }), S.limb([x, 0.64, 0.03], [x + 0.08, 0, 0.2], 0.025, 0.025, v.dark, { n: 4 })])], { surface: 0.7 }) }, THREE_WOODS, (c, v) => {
    for (const x of [-0.45, 0.45]) stroke(c, [x - 0.08, -0.2, x + 0.08, 0.2], 0.04, v.dark);
    plank(c, -0.56, -0.06, 1.12, 0.12, v, 3121);
  }),
  ...family({ id: "tool-rack", name: "Tool rack", category: W, group: "Carpentry", w: 1.4, h: 0.3, layer: "object", form: (v) => S.solid([S.box(-0.68, 0.68, -0.08, -0.04, 1.0, 1.7, v), S.box(-0.68, 0.68, -0.08, 0.08, 1.55, 1.6, v), Array.from({ length: 6 }, (_, i) => { const x = -0.55 + i * 0.22; return [S.limb([x, 1.58, 0.04], [x, 1.05, 0.04], 0.015, 0.015, WOODS[1].dark, { n: 4 }), S.cbox(0.1, 0.05, 1.0, 1.1, IRON, x, 0.04)]; })], { note: "tools hung on a rack on the wall" }) }, THREE_WOODS, (c, v) => {
    plank(c, -0.68, -0.08, 1.36, 0.16, v, 3131);
    for (let i = 0; i < 6; i++) {
      const x = -0.55 + i * 0.22;
      stroke(c, [x, -0.12, x, 0.12], 0.03, WOODS[1].dark);
      cbox(c, x, -0.12, 0.1, 0.05, IRON, 0.01);
    }
  }),
];

const DYES: (Variant & { tone: Tone })[] = CLOTHS.filter((t) => ["crimson", "navy", "ochre", "violet", "green"].includes(t.key)).map((t) => ({ key: t.key, name: t.name, tone: t }));

const textiles: PropDef[] = [
  ...family({ id: "loom", name: "Loom", category: W, group: "Textiles", w: 1.6, h: 1.2, layer: "object", form: (v) => S.solid([[-0.72, 0.72].flatMap((x) => [S.box(x - 0.06, x + 0.06, -0.55, 0.55, 0.7, 0.8, v), S.cbox(0.08, 0.08, 0, 0.8, v, x, -0.5), S.cbox(0.08, 0.08, 0, 0.8, v, x, 0.5), S.cbox(0.08, 0.08, 0.8, 1.7, v, x, -0.5)]), S.limb([-0.7, 0.85, -0.45], [0.7, 0.85, -0.45], 0.04, 0.04, v.dark, { n: 5 }), S.limb([-0.7, 0.85, 0.45], [0.7, 0.85, 0.45], 0.04, 0.04, v.dark, { n: 5 }), S.limb([-0.72, 1.65, -0.5], [0.72, 1.65, -0.5], 0.04, 0.04, v.dark, { n: 5 }), S.box(-0.6, 0.6, -0.42, 0.05, 0.84, 0.85, "#f0e6d0"), S.box(-0.6, 0.6, 0.05, 0.41, 0.84, 0.87, CLOTHS[0])], { surface: 0.87 }) }, THREE_WOODS, (c, v) => {
    for (const x of [-0.72, 0.72]) plank(c, x - 0.06, -0.55, 0.12, 1.1, v, 3201 + x);
    for (const y of [-0.45, 0.45]) stroke(c, [-0.7, y, 0.7, y], 0.06, v.dark);
    for (let x = -0.6; x <= 0.6; x += 0.06) stroke(c, [x, -0.42, x, 0.42], 0.008, "#f0e6d0");
    rr(c, -0.6, 0.05, 1.2, 0.36, 0.01);
    fo(c, linear(c, 0, 0, 0, 0.4, CLOTHS[0].light, CLOTHS[0].dark), 0.01);
  }),
  ...family({ id: "spinning-wheel", name: "Spinning wheel", category: W, group: "Textiles", w: 1, h: 0.6, layer: "object", form: (v) => S.solid([S.box(-0.45, 0.45, -0.08, 0.08, 0.2, 0.3, v), [-0.38, 0.38].map((x) => S.limb([x, 0.25, 0], [x + (x < 0 ? -0.04 : 0.04), 0, 0.06], 0.02, 0.02, v.dark, { n: 4 })), S.cbox(0.05, 0.05, 0.3, 0.75, v.dark, 0.15, 0), S.limb([0.12, 0.72, 0], [0.18, 0.72, 0], 0.28, 0.28, v, { n: 14 }), S.cyl(0.02, 0.3, 0.75, v.dark, { x: -0.35, n: 4 }), S.ball(0.07, 0.68, 0.9, "#e8dcc4", { x: -0.35, n: 6 })]) }, THREE_WOODS, (c, v) => {
    plank(c, -0.45, -0.08, 0.9, 0.16, v, 3211);
    ell(c, 0.15, 0, 0.06, 0.28);
    c.strokeStyle = v.dark;
    c.lineWidth = 0.04;
    c.stroke();
    disc(c, -0.35, 0, 0.07, tone("#f0e6d0", "#b4a682"), 0.01);
  }),
  ...family({ id: "dye-vat", name: "Dye vat", category: W, group: "Textiles", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid([S.tub(0.42, 0, 0.7, WOODS[5], 0.81, { floor: 0.2 }), S.cyl(0.34, 0.2, 0.6, v.tone, { n: 12 }), S.limb([-0.1, 0.62, -0.1], [0.4, 1.0, 0.3], 0.02, 0.02, WOODS[1].dark, { n: 4 })]) }, DYES, (c, v) => {
    disc(c, 0, 0, 0.42, WOODS[5]);
    circle(c, 0, 0, 0.34);
    c.fillStyle = radial(c, 0, 0, 0.34, v.tone.light, v.tone.dark);
    c.fill();
    stroke(c, [-0.1, -0.1, 0.4, 0.3], 0.03, WOODS[1].dark);
  }),
  ...family({ id: "sewing-table", name: "Sewing table", category: W, group: "Textiles", w: 1.2, h: 0.7, layer: "object", form: (v) => S.plus(S.table(0.76, v), S.box(-0.4, 0.1, -0.2, 0.16, 0.76, 0.78, CLOTHS[7]), scatter(3, 0.12, 3223).map(([x, z, k]) => S.cyl(0.045, 0.76, 0.84, DYES[Math.floor(k * DYES.length)].tone, { x: x + 0.35, z, n: 6 }))) }, THREE_WOODS, (c, v) => {
    plank(c, -0.58, -0.32, 1.16, 0.64, v, 3221);
    rr(c, -0.4, -0.2, 0.5, 0.36, 0.02);
    fo(c, linear(c, 0, -0.2, 0, 0.16, CLOTHS[7].light, CLOTHS[7].dark), 0.01);
    for (const [x, y, k] of scatter(3, 0.12, 3223)) disc(c, x + 0.35, y, 0.045, DYES[Math.floor(k * DYES.length)].tone, 0.008);
  }),
  ...family({ id: "cloth-bolts", name: "Bolts of cloth", category: W, group: "Textiles", w: 1, h: 0.7, layer: "object", form: (v) => S.resting(S.solid([0, 1, 2].map((i) => S.limb([-0.45, 0.09 * 1.5, -0.21 + i * 0.2], [0.45, 0.09 * 1.5, -0.21 + i * 0.2], 0.09, 0.09, i === 1 ? v.light : v, { n: 8 })))) }, CLOTHS, (c, v) => {
    for (let i = 0; i < 3; i++) {
      rr(c, -0.45, -0.3 + i * 0.2, 0.9, 0.18, 0.08);
      fo(c, linear(c, 0, -0.3 + i * 0.2, 0, -0.12 + i * 0.2, i === 1 ? shade(v.light, 0.15) : v.light, v.dark), 0.015);
    }
  }),
];

const pottery: PropDef[] = [
  ...family({ id: "potters-wheel", name: "Potter's wheel", category: W, group: "Pottery and leather", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid([S.cyl(0.4, 0, 0.12, v, { n: 14 }), S.cyl(0.03, 0.12, 0.72, IRON.dark, { n: 5 }), S.cyl(0.25, 0.72, 0.78, "#7a7670", { n: 12 }), S.ball(0.12, 0.78, 0.98, CLAYS[0], { n: 8 })]) }, THREE_WOODS, (c, v) => {
    disc(c, 0, 0, 0.4, v);
    disc(c, 0, 0, 0.25, tone("#8a8680", "#4a4844"), 0.015);
    disc(c, 0, 0, 0.12, CLAYS[0], 0.012);
  }),
  ...family({ id: "kiln", name: "Kiln", category: W, group: "Pottery and leather", w: 1.4, h: 1.4, layer: "object", form: (v) => S.solid([S.ball(0.64, -0.3, 1.8, v.a, { lump: 0.03, n: 12 }), S.box(-0.14, 0.14, 0.5, 0.7, 0.05, 0.4, v.b.key === "lit" ? "#ff9a3a" : "#1a120c", { glow: v.b.key === "lit" })]) }, cross(MASONRY.slice(0, 3), LIT), (c, v) => {
    disc(c, 0, 0, 0.64, v.a);
    disc(c, 0, 0, 0.42, tone(shade(v.a.dark, -0.2), shade(v.a.dark, -0.5)), 0.015);
    rr(c, -0.14, 0.5, 0.28, 0.2, 0.06);
    fo(c, "#1a120c", 0.012);
    if (v.b.key === "lit") flame(c, 0, 0.58, 0.08);
  }, { light: (v) => (v.b.key === "lit" ? { radius: 4, color: "#ff9a4a", intensity: 0.7 } : undefined) }),
  ...family({ id: "pottery-rack", name: "Pottery drying rack", category: W, group: "Pottery and leather", w: 1.6, h: 0.45, layer: "object", form: (v) => S.plus(S.tall(1.0, WOODS[0]), Array.from({ length: 6 }, (_, i) => S.cyl(0.09, 1.0, 1.22, v.key === "unfired" ? "#b8a488" : CLAYS[1 + (i % 3)], { x: -0.62 + i * 0.25, top: 0.75, n: 8 }))) }, [vary("unfired"), vary("glazed")], (c, v) => {
    plank(c, -0.78, -0.2, 1.56, 0.4, WOODS[0], 3301);
    for (let i = 0; i < 6; i++) disc(c, -0.62 + i * 0.25, 0, 0.09, v.key === "unfired" ? tone("#c8b498", "#8a7a62") : CLAYS[1 + (i % 3)], 0.01);
  }),
  ...family({ id: "hide-frame", name: "Hide stretching frame", category: W, group: "Pottery and leather", w: 1.4, h: 1.4, layer: "object", form: (v) => S.solid([S.post(-0.62, 0, 0.04, 0, 1.9, WOODS[2].dark), S.post(0.62, 0, 0.04, 0, 1.9, WOODS[2].dark), S.limb([-0.62, 1.8, 0], [0.62, 1.8, 0], 0.035, 0.035, WOODS[2].dark, { n: 4 }), S.limb([-0.62, 0.3, 0], [0.62, 0.3, 0], 0.035, 0.035, WOODS[2].dark, { n: 4 }), S.box(-0.5, 0.5, -0.02, 0.02, 0.42, 1.68, v.key === "brown" ? "#9a6e42" : "#d8c8a4")], { note: "it stands upright: the drawing shows the hide's face" }) }, [vary("brown"), vary("pale")], (c, v) => {
    c.strokeStyle = WOODS[2].dark;
    c.lineWidth = 0.06;
    c.strokeRect(-0.62, -0.62, 1.24, 1.24);
    poly(c, [-0.4, -0.5, 0.4, -0.5, 0.52, -0.1, 0.42, 0.5, -0.42, 0.5, -0.52, -0.1]);
    fo(c, radial(c, 0, 0, 0.6, v.key === "brown" ? "#b88a5a" : "#e8d8b8", v.key === "brown" ? "#6a4422" : "#b4a07a"), 0.02);
    for (const [x, y] of [[-0.4, -0.5], [0.4, -0.5], [0.42, 0.5], [-0.42, 0.5]] as const) stroke(c, [x, y, x * 1.5, y * 1.24], 0.012, "#c8b088");
  }),
  ...family({ id: "tanning-vat", name: "Tanning vat", category: W, group: "Pottery and leather", w: 1, h: 1, layer: "object", form: (v) => S.solid([S.tub(0.46, 0, 0.75, v.key === "wooden" ? WOODS[5] : CLAYS[0], 0.8, { floor: 0.2, n: 12 }), S.cyl(0.37, 0.2, 0.62, "#5a4220", { n: 12 })]) }, [vary("wooden"), vary("clay")], (c, v) => {
    disc(c, 0, 0, 0.46, v.key === "wooden" ? WOODS[5] : CLAYS[0]);
    circle(c, 0, 0, 0.37);
    c.fillStyle = radial(c, 0, 0, 0.37, "#8a6a3a", "#3a2a12");
    c.fill();
  }),
];

export const WORKSHOP_PROPS: PropDef[] = [...smithy, ...carpentry, ...textiles, ...pottery];

// Copied from Dungeon (src/render/props-workshop.ts) by scripts/sync-dungeon-library.mjs, Dungeon c3dcca5. Change it there and run the script again.
import { flame, rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, MASONRY, CLOTHS, CLAYS, GOLD, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, glow, stroke, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";

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
  ...family({ id: "forge-hearth", name: "Forge", category: W, group: "Smithy", w: 1.4, h: 1.2, layer: "object" }, cross(MASONRY.slice(0, 3), LIT), (c, v) => {
    cbox(c, 0, 0, 1.3, 1.1, v.a, 0.05);
    disc(c, 0, 0, 0.36, tone("#3a2a20", "#120c08"), 0.015);
    if (v.b.key === "lit") {
      for (const [x, y] of scatter(12, 0.24, 3001)) disc(c, x, y, 0.05, tone("#ffd060", "#e0400a"), 0);
      glow(c, 0, 0, 0.5, "255,140,40", 0.5);
    }
  }, { light: (v) => (v.b.key === "lit" ? { radius: 6, color: "#ff9a4a", intensity: 1 } : undefined) }),
  ...family({ id: "anvil-block", name: "Anvil on its block", category: W, group: "Smithy", w: 0.9, h: 0.6, layer: "object" }, cross([vary("iron"), vary("bronze")], [vary("bare"), vary("tools", "with tools")]), (c, v) => {
    disc(c, 0, 0, 0.26, WOODS[2]);
    anvil(c, v.a.key === "iron" ? IRON : METALS[1]);
    if (v.b.key === "tools") {
      stroke(c, [-0.3, 0.2, 0.05, 0.24], 0.03, WOODS[1].dark);
      cbox(c, 0.08, 0.24, 0.08, 0.06, IRON, 0.01);
      stroke(c, [0.2, -0.22, 0.4, -0.18], 0.02, IRON.dark);
    }
  }),
  ...family({ id: "quench-trough", name: "Quench trough", category: W, group: "Smithy", w: 1.2, h: 0.6, layer: "object" }, THREE_WOODS, (c, v) => {
    box(c, -0.56, -0.26, 1.12, 0.52, v, 0.04);
    rr(c, -0.48, -0.18, 0.96, 0.36, 0.03);
    fo(c, radial(c, 0, 0, 0.5, "#6a8a9a", "#2a3a44"), 0.012);
  }),
  ...family({ id: "grinding-wheel", name: "Grinding wheel", category: W, group: "Smithy", w: 0.9, h: 0.5, layer: "object" }, MASONRY.filter((m) => ["granite", "sandstone", "slate"].includes(m.key)), (c, v) => {
    box(c, -0.4, -0.2, 0.8, 0.4, WOODS[2], 0.03);
    rr(c, -0.08, -0.24, 0.16, 0.48, 0.04);
    fo(c, linear(c, 0, -0.24, 0, 0.24, v.light, v.dark), 0.015);
    stroke(c, [0.08, 0, 0.36, 0.1], 0.03, IRON.dark);
  }),
  ...family({ id: "bellows", name: "Bellows", category: W, group: "Smithy", w: 0.9, h: 0.5, layer: "object" }, [vary("brown", "brown leather"), vary("black", "black leather")], (c, v) => {
    const leather = v.key === "brown" ? tone("#9a6a3e", "#4a2e18") : tone("#55504a", "#1a1816");
    poly(c, [-0.38, -0.2, 0.2, -0.12, 0.38, 0, 0.2, 0.12, -0.38, 0.2]);
    fo(c, linear(c, 0, -0.2, 0, 0.2, leather.light, leather.dark));
    stroke(c, [0.36, 0, 0.44, 0], 0.04, METALS[1].dark);
  }),
  ...family({ id: "ingot-stack", name: "Stack of ingots", category: W, group: "Smithy", w: 0.7, h: 0.5, layer: "object" }, [...METALS, GOLD], (c, v) => {
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3 - row; i++) {
      const x = -0.2 + i * 0.2 + row * 0.1;
      const y = 0.08 - row * 0.14;
      poly(c, [x - 0.09, y - 0.06, x + 0.09, y - 0.06, x + 0.07, y + 0.06, x - 0.07, y + 0.06]);
      fo(c, linear(c, x, y - 0.06, x, y + 0.06, v.light, v.dark), 0.012);
    }
  }),
  ...family({ id: "ore-pile", name: "Pile of ore", category: W, group: "Smithy", w: 0.9, h: 0.7, layer: "object" }, [
    { key: "iron", name: "iron", tone: tone("#9a6a5a", "#4a2a22") },
    { key: "copper", name: "copper", tone: tone("#6ab49a", "#2a6a52") },
    { key: "silver", name: "silver", tone: tone("#c8ccd4", "#6a707a") },
    { key: "gold", name: "gold", tone: tone("#e8c860", "#8a6a1a") },
  ] as (Variant & { tone: Tone })[], (c, v) => {
    for (const [x, y, k] of scatter(11, 0.26, 3011)) disc(c, x, y * 0.8, 0.06 + k * 0.05, k > 0.6 ? v.tone : tone("#8a8680", "#4a4844"), 0.01);
  }),
  ...family({ id: "smelter", name: "Smelter", category: W, group: "Smithy", w: 1.2, h: 1.2, layer: "object" }, LIT, (c, v) => {
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
  ...family({ id: "workbench", name: "Workbench", category: W, group: "Carpentry", w: 2, h: 0.8, layer: "object" }, cross(WOODS, [vary("tidy"), vary("cluttered")]), (c, v) => {
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
  ...family({ id: "lumber-stack", name: "Stack of lumber", category: W, group: "Carpentry", w: 2.4, h: 0.8, layer: "object" }, WOODS, (c, v) => {
    for (let i = 0; i < 5; i++) plank(c, -1.15 + (i % 2) * 0.06, -0.36 + i * 0.15, 2.24, 0.13, v, 3111 + i);
  }),
  ...family({ id: "sawhorse", name: "Sawhorse", category: W, group: "Carpentry", w: 1.2, h: 0.5, layer: "object" }, THREE_WOODS, (c, v) => {
    for (const x of [-0.45, 0.45]) stroke(c, [x - 0.08, -0.2, x + 0.08, 0.2], 0.04, v.dark);
    plank(c, -0.56, -0.06, 1.12, 0.12, v, 3121);
  }),
  ...family({ id: "tool-rack", name: "Tool rack", category: W, group: "Carpentry", w: 1.4, h: 0.3, layer: "object" }, THREE_WOODS, (c, v) => {
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
  ...family({ id: "loom", name: "Loom", category: W, group: "Textiles", w: 1.6, h: 1.2, layer: "object" }, THREE_WOODS, (c, v) => {
    for (const x of [-0.72, 0.72]) plank(c, x - 0.06, -0.55, 0.12, 1.1, v, 3201 + x);
    for (const y of [-0.45, 0.45]) stroke(c, [-0.7, y, 0.7, y], 0.06, v.dark);
    for (let x = -0.6; x <= 0.6; x += 0.06) stroke(c, [x, -0.42, x, 0.42], 0.008, "#f0e6d0");
    rr(c, -0.6, 0.05, 1.2, 0.36, 0.01);
    fo(c, linear(c, 0, 0, 0, 0.4, CLOTHS[0].light, CLOTHS[0].dark), 0.01);
  }),
  ...family({ id: "spinning-wheel", name: "Spinning wheel", category: W, group: "Textiles", w: 1, h: 0.6, layer: "object" }, THREE_WOODS, (c, v) => {
    plank(c, -0.45, -0.08, 0.9, 0.16, v, 3211);
    ell(c, 0.15, 0, 0.06, 0.28);
    c.strokeStyle = v.dark;
    c.lineWidth = 0.04;
    c.stroke();
    disc(c, -0.35, 0, 0.07, tone("#f0e6d0", "#b4a682"), 0.01);
  }),
  ...family({ id: "dye-vat", name: "Dye vat", category: W, group: "Textiles", w: 0.9, h: 0.9, layer: "object" }, DYES, (c, v) => {
    disc(c, 0, 0, 0.42, WOODS[5]);
    circle(c, 0, 0, 0.34);
    c.fillStyle = radial(c, 0, 0, 0.34, v.tone.light, v.tone.dark);
    c.fill();
    stroke(c, [-0.1, -0.1, 0.4, 0.3], 0.03, WOODS[1].dark);
  }),
  ...family({ id: "sewing-table", name: "Sewing table", category: W, group: "Textiles", w: 1.2, h: 0.7, layer: "object" }, THREE_WOODS, (c, v) => {
    plank(c, -0.58, -0.32, 1.16, 0.64, v, 3221);
    rr(c, -0.4, -0.2, 0.5, 0.36, 0.02);
    fo(c, linear(c, 0, -0.2, 0, 0.16, CLOTHS[7].light, CLOTHS[7].dark), 0.01);
    for (const [x, y, k] of scatter(3, 0.12, 3223)) disc(c, x + 0.35, y, 0.045, DYES[Math.floor(k * DYES.length)].tone, 0.008);
  }),
  ...family({ id: "cloth-bolts", name: "Bolts of cloth", category: W, group: "Textiles", w: 1, h: 0.7, layer: "object" }, CLOTHS, (c, v) => {
    for (let i = 0; i < 3; i++) {
      rr(c, -0.45, -0.3 + i * 0.2, 0.9, 0.18, 0.08);
      fo(c, linear(c, 0, -0.3 + i * 0.2, 0, -0.12 + i * 0.2, i === 1 ? shade(v.light, 0.15) : v.light, v.dark), 0.015);
    }
  }),
];

const pottery: PropDef[] = [
  ...family({ id: "potters-wheel", name: "Potter's wheel", category: W, group: "Pottery and leather", w: 0.9, h: 0.9, layer: "object" }, THREE_WOODS, (c, v) => {
    disc(c, 0, 0, 0.4, v);
    disc(c, 0, 0, 0.25, tone("#8a8680", "#4a4844"), 0.015);
    disc(c, 0, 0, 0.12, CLAYS[0], 0.012);
  }),
  ...family({ id: "kiln", name: "Kiln", category: W, group: "Pottery and leather", w: 1.4, h: 1.4, layer: "object" }, cross(MASONRY.slice(0, 3), LIT), (c, v) => {
    disc(c, 0, 0, 0.64, v.a);
    disc(c, 0, 0, 0.42, tone(shade(v.a.dark, -0.2), shade(v.a.dark, -0.5)), 0.015);
    rr(c, -0.14, 0.5, 0.28, 0.2, 0.06);
    fo(c, "#1a120c", 0.012);
    if (v.b.key === "lit") flame(c, 0, 0.58, 0.08);
  }, { light: (v) => (v.b.key === "lit" ? { radius: 4, color: "#ff9a4a", intensity: 0.7 } : undefined) }),
  ...family({ id: "pottery-rack", name: "Pottery drying rack", category: W, group: "Pottery and leather", w: 1.6, h: 0.45, layer: "object" }, [vary("unfired"), vary("glazed")], (c, v) => {
    plank(c, -0.78, -0.2, 1.56, 0.4, WOODS[0], 3301);
    for (let i = 0; i < 6; i++) disc(c, -0.62 + i * 0.25, 0, 0.09, v.key === "unfired" ? tone("#c8b498", "#8a7a62") : CLAYS[1 + (i % 3)], 0.01);
  }),
  ...family({ id: "hide-frame", name: "Hide stretching frame", category: W, group: "Pottery and leather", w: 1.4, h: 1.4, layer: "object" }, [vary("brown"), vary("pale")], (c, v) => {
    c.strokeStyle = WOODS[2].dark;
    c.lineWidth = 0.06;
    c.strokeRect(-0.62, -0.62, 1.24, 1.24);
    poly(c, [-0.4, -0.5, 0.4, -0.5, 0.52, -0.1, 0.42, 0.5, -0.42, 0.5, -0.52, -0.1]);
    fo(c, radial(c, 0, 0, 0.6, v.key === "brown" ? "#b88a5a" : "#e8d8b8", v.key === "brown" ? "#6a4422" : "#b4a07a"), 0.02);
    for (const [x, y] of [[-0.4, -0.5], [0.4, -0.5], [0.42, 0.5], [-0.42, 0.5]] as const) stroke(c, [x, y, x * 1.5, y * 1.24], 0.012, "#c8b088");
  }),
  ...family({ id: "tanning-vat", name: "Tanning vat", category: W, group: "Pottery and leather", w: 1, h: 1, layer: "object" }, [vary("wooden"), vary("clay")], (c, v) => {
    disc(c, 0, 0, 0.46, v.key === "wooden" ? WOODS[5] : CLAYS[0]);
    circle(c, 0, 0, 0.37);
    c.fillStyle = radial(c, 0, 0, 0.37, "#8a6a3a", "#3a2a12");
    c.fill();
  }),
];

export const WORKSHOP_PROPS: PropDef[] = [...smithy, ...carpentry, ...textiles, ...pottery];

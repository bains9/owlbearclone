// Copied from Dungeon (src/render/props-light.ts) by scripts/sync-dungeon-library.mjs, Dungeon c24bf6a. Change it there and run the script again.
import { flame, radial, linear, circle } from "./propkit";
import { WOODS, METALS, MASONRY, CLAYS, GLOWS, cross, vary, family, glowLight, ell, poly, fo, cbox, disc, glow, coloredFlame, stroke, scatter, type C, type Glow, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// Light sources for the big library. Each brings its own light (the light it adds when placed),
// in four flame colours where that makes sense: firelight, blue, green and violet.

const L = "Light" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const FIRE = GLOWS[0];
const THREE_METALS = METALS.slice(0, 3);
const WAX: (Variant & { tone: Tone })[] = [
  { key: "white", name: "white", tone: tone("#fbf8f0", "#d8d0c0") },
  { key: "tallow", name: "tallow", tone: tone("#f0e2b8", "#c4ac78") },
  { key: "black", name: "black", tone: tone("#4a4650", "#18161a") },
  { key: "red", name: "red", tone: tone("#e05a4a", "#8a1a14") },
];

function candle(c: C, x: number, y: number, r: number, wax: Tone, g: Glow = FIRE): void {
  disc(c, x, y, r, wax, 0.01);
  coloredFlame(c, x, y - r * 0.2, r * 0.7, g);
}

const torches: PropDef[] = [
  ...family({ id: "wall-torch", name: "Wall torch", category: L, group: "Torches", w: 0.5, h: 0.5, layer: "object", form: (v) => S.solid([S.cbox(0.16, 0.1, 1.45, 1.6, METALS[0], 0, 0.12), S.limb([0, 1.5, 0.12], [0, 1.85, -0.06], 0.035, 0.05, WOODS[2].dark, { n: 5 }), S.fire(0, -0.08, 1.85, 0.32, 0.1, v.key === "fire" ? undefined : v.dark)], { note: "a torch in a bracket on the wall: its glow is drawn round it" }) }, GLOWS, (c, v) => {
    cbox(c, 0, 0.12, 0.16, 0.1, METALS[0], 0.02);
    stroke(c, [0, 0.12, 0, -0.06], 0.06, WOODS[2].dark);
    coloredFlame(c, 0, -0.08, 0.1, v);
  }, { light: (v) => glowLight(v, 6, 0.9) }),
  ...family({ id: "torch-stand", name: "Torch stand", category: L, group: "Torches", w: 0.6, h: 0.6, layer: "object", form: (v) => S.solid([[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2 + 0.5; return S.limb([Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24], [0, 0.45, 0], 0.025, 0.025, v.a.dark, { n: 4 }); }), S.cyl(0.03, 0.45, 1.5, v.a.dark, { n: 5 }), S.tub(0.1, 1.5, 1.62, v.a, 0.7, { floor: 1.55 }), S.fire(0, -0.02, 1.58, 0.4, 0.11, v.b.key === "fire" ? undefined : v.b.dark)], { note: "its flame's glow is drawn round it" }) }, cross(THREE_METALS, GLOWS), (c, v) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      stroke(c, [0, 0, Math.cos(a) * 0.24, Math.sin(a) * 0.24], 0.035, v.a.dark);
    }
    disc(c, 0, 0, 0.1, v.a);
    coloredFlame(c, 0, -0.02, 0.12, v.b);
  }, { light: (v) => glowLight(v.b, 6, 1) }),
];

const lamps: PropDef[] = [
  ...family({ id: "wall-sconce", name: "Wall sconce", category: L, group: "Sconces and lamps", w: 0.6, h: 0.4, layer: "object", form: (v) => S.solid([S.slab([-0.24, 0.1, -0.17, 0.04, 0, 0.02, 0.17, 0.04, 0.24, 0.1, 0.17, 0.16, 0, 0.18, -0.17, 0.16], 1.45, 1.5, v.a), S.box(-0.06, 0.06, 0.14, 0.2, 1.3, 1.55, v.a.dark), (v.b.key === "one" ? [0] : [-0.16, 0, 0.16]).map((x) => [S.cyl(0.045, 1.5, 1.68, "#f6f0e2", { x, n: 6 }), S.fire(x, 0, 1.68, 0.07, 0.03)])], { note: "candles on a bracket on the wall: their glow is drawn round them" }) }, cross(METALS, [vary("one", "one candle"), vary("three", "three candles")]), (c, v) => {
    ell(c, 0, 0.1, 0.24, 0.08);
    fo(c, linear(c, -0.24, 0, 0.24, 0, v.a.light, v.a.dark));
    const xs = v.b.key === "one" ? [0] : [-0.16, 0, 0.16];
    for (const x of xs) candle(c, x, 0, 0.045, WAX[0].tone);
  }, { light: (v) => ({ radius: v.b.key === "one" ? 3 : 4, color: FIRE.color, intensity: 0.8 }) }),
  ...family({ id: "oil-lamp", name: "Oil lamp", category: L, group: "Sconces and lamps", w: 0.4, h: 0.3, layer: "object", form: (v) => S.resting(S.solid([S.ball(0.13, 0, 0.1, v, { x: -0.02, rz: 0.08, n: 8 }), S.limb([0.06, 0.06, 0], [0.18, 0.08, 0], 0.03, 0.015, v.dark, { n: 4 }), S.fire(0.17, 0, 0.08, 0.07, 0.03)], { note: "its flame's glow is drawn round it" })) }, CLAYS, (c, v) => {
    ell(c, -0.02, 0, 0.13, 0.08);
    fo(c, radial(c, 0, 0, 0.13, v.light, v.dark), 0.012);
    poly(c, [0.08, -0.03, 0.18, 0, 0.08, 0.03]);
    fo(c, v.dark, 0.01);
    flame(c, 0.17, -0.01, 0.04);
  }, { light: { radius: 3, color: FIRE.color, intensity: 0.7 } }),
  ...family({ id: "hanging-lantern", name: "Hanging lantern", category: L, group: "Sconces and lamps", w: 0.5, h: 0.5, layer: "canopy", form: (v) => S.solid([S.limb([0, 2.38, 0], [0, 3.0, 0], 0.008, 0.008, v.a.dark, { n: 3 }), S.cbox(0.28, 0.28, 2.0, 2.3, v.b.light, 0, 0, { glow: true }), S.cbox(0.32, 0.32, 2.3, 2.38, v.a, 0, 0, { top: 0.5 }), S.cbox(0.3, 0.3, 1.96, 2.0, v.a)], { note: "it hangs from above: you see under it, its glow drawn round it" }) }, cross(THREE_METALS, GLOWS), (c, v) => {
    glow(c, 0, 0, 0.4, v.b.rgb, 0.4);
    poly(c, [-0.14, -0.14, 0.14, -0.14, 0.14, 0.14, -0.14, 0.14]);
    fo(c, radial(c, 0, 0, 0.18, v.b.light, v.b.dark), 0.02);
    stroke(c, [-0.14, 0, 0.14, 0], 0.02, v.a.dark, "butt");
    stroke(c, [0, -0.14, 0, 0.14], 0.02, v.a.dark, "butt");
    disc(c, 0, 0, 0.05, v.a, 0.01);
  }, { light: (v) => glowLight(v.b, 5, 0.9) }),
  ...family({ id: "lamp-post", name: "Lamp post", category: L, group: "Sconces and lamps", w: 0.6, h: 0.6, layer: "canopy", form: (v) => { const m = v.a.key === "iron" ? METALS[0] : METALS[2]; return S.solid([S.cyl(0.12, 0, 0.12, m, { n: 6 }), S.cyl(0.04, 0.12, 2.55, m, { n: 5 }), S.cone(0.22, 2.55, 2.7, m, { n: 4 }), S.cyl(0.2, 2.7, 2.98, v.b.light, { n: 4, top: 1.2, glow: true }), S.cone(0.26, 2.98, 3.15, m, { n: 4 })], { note: "a lamp on a post: you see under it, its glow drawn round it" }); } }, cross([vary("iron"), vary("brass")], [GLOWS[0], GLOWS[1]]), (c, v) => {
    const m = v.a.key === "iron" ? METALS[0] : METALS[2];
    glow(c, 0, 0, 0.5, v.b.rgb, 0.45);
    poly(c, [0, -0.22, 0.2, 0, 0, 0.22, -0.2, 0]);
    fo(c, radial(c, 0, 0, 0.22, v.b.light, v.b.dark), 0.02);
    disc(c, 0, 0, 0.07, m, 0.012);
  }, { light: (v) => glowLight(v.b, 8, 1) }),
];

const candles: PropDef[] = [
  ...family({ id: "candle-cluster", name: "Candle cluster", category: L, group: "Candles", w: 0.6, h: 0.6, layer: "object", form: (v) => S.resting(S.solid(scatter(v.b.key === "few" ? 3 : 7, v.b.key === "few" ? 0.1 : 0.2, 2301).map(([x, z, k]) => { const r = 0.035 + k * 0.025, y = 0.1 + k * 0.18; return [S.cyl(r, 0, y, v.a.tone, { x, z, n: 6 }), S.fire(x, z - r * 0.2, y, 0.07, r * 0.7)]; }), { note: "the candles' glow is drawn round them" })) }, cross(WAX, [vary("few"), vary("many")]), (c, v) => {
    for (const [x, y, k] of scatter(v.b.key === "few" ? 3 : 7, v.b.key === "few" ? 0.1 : 0.2, 2301)) candle(c, x, y, 0.035 + k * 0.025, v.a.tone);
  }, { light: (v) => ({ radius: v.b.key === "few" ? 3 : 4, color: "#ffd090", intensity: 0.8 }) }),
  ...family({ id: "candelabra-tall", name: "Tall candelabra", category: L, group: "Candles", w: 0.8, h: 0.4, layer: "object", form: (v) => S.solid([S.cyl(0.15, 0, 0.05, v, { n: 8 }), S.cyl(0.025, 0.05, 1.4, v, { n: 5 }), S.limb([-0.3, 1.4, 0], [0.3, 1.4, 0], 0.018, 0.018, v.dark, { n: 4 }), [-0.3, -0.15, 0, 0.15, 0.3].map((x) => [S.cyl(0.04, 1.4, 1.43, v, { x, n: 6 }), S.cyl(0.028, 1.43, 1.6, "#f6f0e2", { x, n: 5 }), S.fire(x, -0.01, 1.6, 0.07, 0.025)])], { note: "a tall stand of candles: their glow is drawn round them" }) }, METALS, (c, v) => {
    stroke(c, [-0.3, 0, 0.3, 0], 0.035, v.dark);
    for (const x of [-0.3, -0.15, 0, 0.15, 0.3]) {
      disc(c, x, 0, 0.04, v, 0.01);
      candle(c, x, -0.01, 0.028, WAX[0].tone);
    }
  }, { light: { radius: 4, color: "#ffd090", intensity: 0.9 } }),
  ...family({ id: "chandelier-ring", name: "Ring chandelier", category: L, group: "Candles", w: 1.6, h: 1.6, layer: "canopy", form: (v) => (w) => { const r = v.b.key === "small" ? 0.42 : 0.68, n = v.b.key === "small" ? 6 : 10; return S.solid([S.limb([0, 2.45, 0], [0, 3.0, 0], 0.01, 0.01, v.a.dark, { n: 3 }), S.tub(r + 0.03, 2.3, 2.36, v.a, 0.9, { n: 16, floor: 2.31 }), [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.3; return S.limb([0, 2.45, 0], [Math.cos(a) * r, 2.36, Math.sin(a) * r], 0.008, 0.008, v.a.light, { n: 3 }); }), Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [S.cyl(0.035, 2.36, 2.5, "#f6f0e2", { x: Math.cos(a) * r, z: Math.sin(a) * r, n: 4 }), S.cone(0.025, 2.5, 2.58, "#ffd27a", { x: Math.cos(a) * r, z: Math.sin(a) * r, n: 4, glow: true })]; })], { note: "it hangs from the ceiling: you see under it" }); } }, cross(THREE_METALS, [vary("small"), vary("large")]), (c, v) => {
    const r = v.b.key === "small" ? 0.42 : 0.68;
    circle(c, 0, 0, r);
    c.strokeStyle = v.a.dark;
    c.lineWidth = 0.05;
    c.stroke();
    const n = v.b.key === "small" ? 6 : 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      candle(c, Math.cos(a) * r, Math.sin(a) * r, 0.035, WAX[0].tone);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.3;
      stroke(c, [0, 0, Math.cos(a) * r, Math.sin(a) * r], 0.02, v.a.light);
    }
    disc(c, 0, 0, 0.07, v.a);
  }, { light: (v) => ({ radius: v.b.key === "small" ? 6 : 9, color: "#ffd090", intensity: 1 }), size: (v) => (v.b.key === "small" ? [1.1, 1.1] : [1.6, 1.6]) }),
];

function firewood(c: C, r: number): void {
  for (const a of [0.3, 1.4, 2.5, 3.5, 4.6, 5.6]) stroke(c, [Math.cos(a) * r, Math.sin(a) * r, -Math.cos(a) * r * 0.2, -Math.sin(a) * r * 0.2], 0.06, WOODS[2].dark);
}

const fires: PropDef[] = [
  ...family({ id: "fire-pit", name: "Fire pit", category: L, group: "Fires", w: 1.1, h: 1.1, layer: "object", form: (v) => S.solid([Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return S.ball(0.1, -0.02, 0.2, v.a, { x: Math.cos(a) * 0.42, z: Math.sin(a) * 0.42, lump: 0.2, n: 6 }); }), S.cyl(0.32, 0, 0.03, "#2a1e16", { n: 12 }), [0.3, 1.4, 2.5, 3.5, 4.6, 5.6].map((a) => S.limb([Math.cos(a) * 0.24, 0.05, Math.sin(a) * 0.24], [-Math.cos(a) * 0.05, 0.16, -Math.sin(a) * 0.05], 0.03, 0.025, WOODS[2].dark, { n: 4 })), v.b.key === "lit" ? S.fire(0, 0, 0.05, 0.7, 0.2) : [S.cyl(0.18, 0.03, 0.06, "#ff6a2a", { n: 8, glow: true })]]) }, cross(MASONRY.slice(0, 3), [vary("lit"), vary("embers")]), (c, v) => {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      disc(c, Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.1, v.a, 0.012);
    }
    disc(c, 0, 0, 0.32, tone("#3a2a20", "#120c08"), 0.012);
    firewood(c, 0.24);
    if (v.b.key === "lit") flame(c, 0, 0, 0.18);
    else for (const [x, y] of scatter(9, 0.18, 2401)) disc(c, x, y, 0.025, tone("#ffb060", "#c83a0a"), 0);
  }, { light: (v) => (v.b.key === "lit" ? { radius: 8, color: "#ff9a4a", intensity: 1 } : { radius: 3, color: "#ff7a3a", intensity: 0.5 }) }),
  ...family({ id: "cooking-fire", name: "Cooking fire", category: L, group: "Fires", w: 1.2, h: 1, layer: "object", form: (v) => S.solid([[0.3, 1.4, 2.5, 3.5, 4.6, 5.6].map((a) => S.limb([Math.cos(a) * 0.28, 0.05, Math.sin(a) * 0.28], [-Math.cos(a) * 0.06, 0.18, -Math.sin(a) * 0.06], 0.03, 0.025, WOODS[2].dark, { n: 4 })), S.fire(0, 0, 0.05, 0.55, 0.17), ...(v.key === "spit" ? [S.limb([-0.55, 0, 0], [-0.55, 0.9, 0], 0.03, 0.03, WOODS[2].dark, { n: 4 }), S.limb([0.55, 0, 0], [0.55, 0.9, 0], 0.03, 0.03, WOODS[2].dark, { n: 4 }), S.limb([-0.58, 0.85, 0], [0.58, 0.85, 0], 0.018, 0.018, METALS[0].dark, { n: 4 }), S.ball(0.22, 0.7, 1.0, "#b0602a", { rz: 0.1, n: 8 })] : [[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2; return S.limb([Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32], [0, 1.0, 0], 0.02, 0.02, METALS[0].dark, { n: 4 }); }), S.tub(0.18, 0.45, 0.72, "#2e2e34", 0.75, { floor: 0.6 }), S.cyl(0.13, 0.6, 0.66, "#a8602a", { n: 8 })])]) }, [vary("spit", "with a spit"), vary("pot", "with a pot")], (c, v) => {
    firewood(c, 0.28);
    flame(c, 0, 0, 0.16);
    if (v.key === "spit") {
      stroke(c, [-0.55, 0, 0.55, 0], 0.03, METALS[0].dark);
      ell(c, 0, 0, 0.22, 0.1);
      fo(c, radial(c, 0, 0, 0.22, "#d07a3a", "#7a3010"), 0.015);
    } else {
      disc(c, 0, 0, 0.18, tone("#4a4a50", "#141418"));
      disc(c, 0, 0, 0.13, tone("#c8803a", "#6a3a14"), 0.01);
    }
  }, { light: { radius: 7, color: "#ff9a4a", intensity: 0.9 } }),
  ...family({ id: "bonfire-great", name: "Great bonfire", category: L, group: "Fires", w: 2, h: 2, layer: "object", form: (v) => S.solid([[0.3, 1.4, 2.5, 3.5, 4.6, 5.6].map((a) => S.limb([Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82], [-Math.cos(a) * 0.1, 1.3, -Math.sin(a) * 0.1], 0.07, 0.05, WOODS[2].dark, { n: 5 })), [[0, 0], [-0.25, 0.15], [0.25, 0.1], [0, -0.25]].map(([x, z]) => S.fire(x, z, 0.1, 1.5, 0.35, v.key === "fire" ? undefined : v.dark))]) }, [GLOWS[0], GLOWS[2]], (c, v) => {
    firewood(c, 0.8);
    for (const [x, y] of [[0, 0], [-0.25, 0.15], [0.25, 0.1], [0, -0.25]] as const) coloredFlame(c, x, y, 0.35, v);
  }, { light: (v) => glowLight(v, 14, 1.2) }),
  ...family({ id: "brazier-bowl", name: "Brazier", category: L, group: "Fires", w: 0.8, h: 0.8, layer: "object", form: (v) => S.solid([[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2 + 0.5; return S.limb([Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [Math.cos(a) * 0.12, 0.7, Math.sin(a) * 0.12], 0.025, 0.025, v.a.dark, { n: 4 }); }), S.tub(0.34, 0.7, 0.92, v.a, 0.76, { top: 1.05, floor: 0.82 }), S.cyl(0.25, 0.82, 0.86, "#ff6a2a", { n: 10, glow: true }), S.fire(0, 0, 0.86, 0.5, 0.18, v.b.key === "fire" ? undefined : v.b.dark)]) }, cross(THREE_METALS, GLOWS), (c, v) => {
    disc(c, 0, 0, 0.34, v.a);
    disc(c, 0, 0, 0.26, tone("#3a2a20", "#120c08"), 0.012);
    coloredFlame(c, 0, 0, 0.18, v.b);
  }, { light: (v) => glowLight(v.b, 7, 1) }),
  ...family({ id: "hearth", name: "Hearth", category: L, group: "Fires", w: 2, h: 1, layer: "object", form: (v) => S.solid([S.box(-0.95, 0.95, -0.45, 0.0, 0, 1.25, v), S.box(-0.95, -0.55, 0.0, 0.45, 0, 1.25, v), S.box(0.55, 0.95, 0.0, 0.45, 0, 1.25, v), S.box(-0.55, 0.55, 0.0, 0.45, 0.85, 1.25, v), S.box(-1.0, 1.0, -0.5, 0.5, 1.25, 1.36, v.dark), S.box(-0.55, 0.55, 0.0, 0.45, 0, 0.06, "#1a120c"), S.fire(0, 0.2, 0.06, 0.55, 0.17)], { surface: 1.36, note: "a hearth against the wall, its fire in its mouth" }) }, MASONRY, (c, v) => {
    cbox(c, 0, 0, 1.9, 0.9, v, 0.04);
    poly(c, [-0.6, 0.45, -0.45, -0.3, 0.45, -0.3, 0.6, 0.45]);
    fo(c, "#1a120c", 0.02);
    firewood(c, 0.22);
    flame(c, 0, 0.05, 0.16);
  }, { light: { radius: 7, color: "#ff9a4a", intensity: 1 } }),
];

const CRYSTALS: (Variant & { glow: Glow })[] = [
  { key: "blue", name: "blue", glow: GLOWS[1] },
  { key: "green", name: "green", glow: GLOWS[2] },
  { key: "purple", name: "purple", glow: GLOWS[3] },
  { key: "red", name: "red", glow: { key: "red", name: "red", light: "#ffd8d0", dark: "#d02a1a", rgb: "255,90,70", color: "#ff8a7a" } },
  { key: "amber", name: "amber", glow: { key: "amber", name: "amber", light: "#fff0c0", dark: "#e09a1a", rgb: "255,190,80", color: "#ffc870" } },
];

const magicLight: PropDef[] = [
  ...family({ id: "floating-orb", name: "Floating orb", category: L, group: "Magic light", w: 0.6, h: 0.6, layer: "canopy", form: (v) => S.solid([S.ball(0.13, 1.35, 1.75, v.light, { n: 9, glow: true })], { note: "it floats in the air, its glow drawn round it" }) }, GLOWS, (c, v) => {
    glow(c, 0, 0, 0.3, v.rgb, 0.6);
    disc(c, 0, 0, 0.12, v, 0.012);
  }, { light: (v) => glowLight(v, 6, 0.9) }),
  ...family({ id: "crystal-cluster", name: "Crystal cluster", category: L, group: "Magic light", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid([S.ball(0.28, -0.1, 0.15, "#4a4450", { lump: 0.3, n: 6 }), scatter(6, 0.2, 2501).map(([x, z, k]) => S.cyl(0.06, 0.05, 0.35 + k * 0.4, v.glow.light, { x, z, n: 4, top: 0.01, glow: true }))], { note: "their glow is drawn round them" }) }, CRYSTALS, (c, v) => {
    glow(c, 0, 0, 0.45, v.glow.rgb, 0.4);
    for (const [x, y, k] of scatter(6, 0.2, 2501)) {
      c.save();
      c.translate(x, y);
      c.rotate(k * Math.PI);
      poly(c, [0, -0.16, 0.06, 0, 0, 0.12, -0.06, 0]);
      fo(c, linear(c, 0, -0.16, 0, 0.12, v.glow.light, v.glow.dark), 0.012);
      c.restore();
    }
  }, { light: (v) => glowLight(v.glow, 5, 0.8) }),
  ...family({ id: "glowing-mushrooms", name: "Glowing mushrooms", category: L, group: "Magic light", w: 0.7, h: 0.7, layer: "object", form: (v) => S.solid(scatter(6, 0.2, 2511).map(([x, z, k]) => { const r = 0.04 + k * 0.04; return [S.cyl(r * 0.3, 0, r * 1.4, "#e8e0d0", { x, z, n: 4 }), S.ball(r, r * 1.2, r * 2.1, v.light, { x, z, n: 6, glow: true })]; }), { note: "their glow is drawn round them" }) }, [GLOWS[1], GLOWS[2], GLOWS[3]], (c, v) => {
    for (const [x, y, k] of scatter(6, 0.2, 2511)) {
      glow(c, x, y, 0.12, v.rgb, 0.4);
      disc(c, x, y, 0.04 + k * 0.04, v, 0.01);
    }
  }, { light: (v) => glowLight(v, 3, 0.6) }),
  ...family({ id: "wisp", name: "Will-o'-the-wisp", category: L, group: "Magic light", w: 0.5, h: 0.5, layer: "canopy", form: (v) => S.solid([S.ball(0.06, 1.25, 1.42, "#ffffff", { n: 7, glow: true }), S.ball(0.04, 1.35, 1.47, v.light, { x: 0.08, z: 0.06, n: 6, glow: true })], { note: "a light floating in the air" }) }, [GLOWS[1], GLOWS[2]], (c, v) => {
    glow(c, 0, 0, 0.24, v.rgb, 0.7);
    glow(c, 0.08, 0.06, 0.1, v.rgb, 0.5);
    disc(c, 0, 0, 0.05, tone("#ffffff", v.light), 0);
  }, { light: (v) => glowLight(v, 4, 0.7) }),
  ...family({ id: "light-pillar", name: "Light pillar", category: L, group: "Magic light", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid([S.cyl(0.4, 0, 0.3, MASONRY[3], { n: 10 }), S.cyl(0.24, 0.3, 1.5, v.glow.light, { n: 4, top: 0.6, glow: true }), S.cone(0.144, 1.5, 1.8, v.glow.light, { n: 4, glow: true })], { note: "a crystal on a stone, its glow drawn round it" }) }, CRYSTALS.slice(0, 3), (c, v) => {
    disc(c, 0, 0, 0.4, MASONRY[3]);
    glow(c, 0, 0, 0.45, v.glow.rgb, 0.5);
    poly(c, [0, -0.28, 0.24, 0, 0, 0.28, -0.24, 0]);
    fo(c, radial(c, 0, 0, 0.28, v.glow.light, v.glow.dark), 0.015);
  }, { light: (v) => glowLight(v.glow, 7, 1) }),
];

export const LIGHT_PROPS: PropDef[] = [...torches, ...lamps, ...candles, ...fires, ...magicLight];


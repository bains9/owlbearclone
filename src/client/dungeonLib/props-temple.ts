// Copied from Dungeon (src/render/props-temple.ts) by scripts/sync-dungeon-library.mjs, Dungeon fc0246c. Change it there and run the script again.
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, MASONRY, CLOTHS, GOLD, cross, vary, family, shade, ell, poly, fo, cbox, disc, plank, drape, glow, coloredFlame, stroke, scatter, GLOWS, type C, type Tone } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// Temples and graveyards for the big library: altars, worship, statues and shrines, graves.

const T = "Temple & graveyard" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const FIRE = GLOWS[0];
const THREE_MASONRY = MASONRY.filter((m) => ["granite", "marble", "sandstone"].includes(m.key));
const THREE_WOODS = WOODS.filter((w) => ["honey", "walnut", "ebony"].includes(w.key));
const ALTAR_CLOTHS = [vary("bare"), vary("crimson", "crimson cloth"), vary("white", "white cloth")];

const altars: PropDef[] = [
  ...family({ id: "temple-altar", name: "Temple altar", category: T, group: "Altars", w: 2, h: 1, layer: "object", form: (v) => S.solid([S.cbox(1.9, 0.9, 0, 1.0, v.a), ...(v.b.key === "bare" ? [] : [S.box(-0.6, 0.6, -0.46, 0.46, 0.35, 1.01, CLOTHS.find((t) => t.key === v.b.key)!)]), [-0.7, 0.7].map((x) => [S.cyl(0.06, 1.0, 1.22, "#f4ecd4", { x, n: 6 }), S.fire(x, -0.01, 1.22, 0.08, 0.035)]), S.cyl(0.1, 1.01, 1.05, GOLD, { n: 10 })], { surface: 1.0 }) }, cross(MASONRY, ALTAR_CLOTHS), (c, v) => {
    cbox(c, 0, 0, 1.9, 0.9, v.a, 0.04);
    if (v.b.key !== "bare") drape(c, -0.6, -0.45, 1.2, 0.9, CLOTHS.find((t) => t.key === v.b.key)!, 3);
    for (const x of [-0.7, 0.7]) {
      disc(c, x, 0, 0.06, tone("#f4ecd4", "#c8b88a"), 0.012);
      coloredFlame(c, x, -0.01, 0.045, FIRE);
    }
    disc(c, 0, 0, 0.1, GOLD);
  }, { light: { radius: 3, color: "#ffd090", intensity: 0.7 } }),
  ...family({ id: "offering-bowl", name: "Offering bowl", category: T, group: "Altars", w: 0.6, h: 0.6, layer: "object", form: (v) => S.resting(S.solid([S.tub(0.24, 0, 0.12, v, 0.7, { floor: 0.04 }), S.ball(0.14, 0.04, 0.14, "#d8a040", { lump: 0.4, n: 7 })])) }, [...METALS, GOLD], (c, v) => {
    disc(c, 0, 0, 0.24, v);
    disc(c, 0, 0, 0.17, tone(shade(v.dark, 0.1), shade(v.dark, -0.4)), 0.012);
    for (const [x, y, k] of scatter(5, 0.09, 4001)) disc(c, x, y, 0.035, k > 0.5 ? GOLD : tone("#d83a2a", "#8a1a14"), 0.006);
  }),
  ...family({ id: "incense-burner", name: "Incense burner", category: T, group: "Altars", w: 0.5, h: 0.5, layer: "object", form: (v) => S.resting(S.solid([[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2; return S.limb([Math.cos(a) * 0.1, 0.1, Math.sin(a) * 0.1], [Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15], 0.015, 0.015, v.dark, { n: 3 }); }), S.cyl(0.18, 0.08, 0.22, v, { top: 0.85, n: 10 }), S.ball(0.15, 0.18, 0.34, v, { n: 9 })])) }, METALS.slice(1, 4), (c, v) => {
    disc(c, 0, 0, 0.18, v);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      disc(c, Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.02, tone("#2a2018", "#0a0806"), 0);
    }
    glow(c, 0.05, -0.08, 0.2, "220,220,230", 0.3);
  }),
  ...family({ id: "holy-symbol", name: "Holy symbol on a stand", category: T, group: "Altars", w: 0.7, h: 0.4, layer: "object", form: (v) => { const m = v.key === "gold" ? GOLD : METALS[3]; return S.solid([S.cbox(0.5, 0.16, 0, 0.1, WOODS[3], 0, 0.1), S.cbox(0.06, 0.06, 0.1, 0.95, WOODS[3], 0, 0.1), S.limb([0, 1.1, 0.06], [0, 1.1, 0.02], 0.13, 0.13, m, { n: 12 }), ...(v.key === "gold" ? Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return S.limb([Math.cos(a) * 0.14, 1.1 + Math.sin(a) * 0.14 * 1.5, 0.04], [Math.cos(a) * 0.2, 1.1 + Math.sin(a) * 0.2 * 1.5, 0.04], 0.012, 0.012, m.dark, { n: 3 }); }) : [])], { note: "it stands on its post: the drawing shows its face" }); } }, [vary("gold", "gold sun"), vary("silver", "silver moon")], (c, v) => {
    cbox(c, 0, 0.1, 0.5, 0.16, WOODS[3], 0.03);
    const m = v.key === "gold" ? GOLD : METALS[3];
    disc(c, 0, -0.04, 0.13, m);
    if (v.key === "gold") for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      stroke(c, [Math.cos(a) * 0.14, -0.04 + Math.sin(a) * 0.14, Math.cos(a) * 0.2, -0.04 + Math.sin(a) * 0.2], 0.02, m.dark);
    }
    else disc(c, 0.05, -0.06, 0.1, tone(shade(m.dark, -0.4), shade(m.dark, -0.6)), 0);
  }),
];

const worship: PropDef[] = [
  ...family({ id: "pew", name: "Pew", category: T, group: "Worship", w: 3, h: 0.7, layer: "object", form: (v) => S.seat(0.45, 1.0, v, { backDepth: 0.12 }) }, WOODS, (c, v) => {
    plank(c, -1.45, -0.3, 2.9, 0.14, v, 4101);
    plank(c, -1.45, -0.14, 2.9, 0.44, v, 4103);
    for (const x of [-1.45, 1.35]) cbox(c, x + 0.05, 0, 0.1, 0.62, tone(shade(v.light, -0.05), shade(v.dark, -0.15)), 0.02);
  }),
  ...family({ id: "prayer-mat", name: "Prayer mat", category: T, group: "Worship", w: 0.8, h: 1.4, layer: "floor", form: () => S.flat("a prayer mat on the floor") }, CLOTHS, (c, v) => {
    rr(c, -0.36, -0.66, 0.72, 1.32, 0.04);
    fo(c, radial(c, 0, 0, 0.8, v.light, v.dark), 0.02);
    c.strokeStyle = shade(v.light, v.key === "white" ? -0.35 : 0.4);
    c.lineWidth = 0.03;
    c.strokeRect(-0.28, -0.58, 0.56, 1.16);
    poly(c, [0, -0.5, 0.2, -0.3, -0.2, -0.3]);
    c.stroke();
  }),
  ...family({ id: "font-basin", name: "Font", category: T, group: "Worship", w: 1, h: 1, layer: "object", form: (v) => S.solid([S.cyl(0.3, 0, 0.6, v, { n: 8, top: 0.8 }), S.tub(0.48, 0.6, 0.95, v, 0.6, { n: 8, floor: 0.75 }), S.cyl(0.28, 0.75, 0.88, "#7ab0c8", { n: 8 })]) }, MASONRY, (c, v) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      disc(c, Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.1, v, 0.012);
    }
    disc(c, 0, 0, 0.38, v);
    disc(c, 0, 0, 0.28, tone("#cfe6f2", "#6a9ab4"), 0.015);
  }),
  ...family({ id: "votive-rack", name: "Votive candle rack", category: T, group: "Worship", w: 1.2, h: 0.5, layer: "object", form: (v) => S.solid([S.cbox(1.12, 0.42, 0, 0.8, v, 0, 0, { top: 0.96 }), S.cbox(1.12, 0.2, 0.8, 0.9, v, 0, -0.1), [0, 1].flatMap((row) => Array.from({ length: 6 }, (_, i) => { const x = -0.45 + i * 0.18, z = -0.09 + row * 0.18, y = row === 0 ? 0.9 : 0.8; return [S.cyl(0.035, y, y + 0.08, "#c83a2a", { x, z, n: 4 }), ...((i + row) % 3 !== 2 ? [S.cone(0.022, y + 0.08, y + 0.15, "#ffd27a", { x, z, n: 4, glow: true })] : [])]; }))], { note: "rows of candles: their glow is drawn round them" }) }, METALS.slice(0, 3), (c, v) => {
    cbox(c, 0, 0, 1.12, 0.42, v, 0.03);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
      const x = -0.45 + i * 0.18;
      const y = -0.09 + row * 0.18;
      disc(c, x, y, 0.035, tone("#e8564a", "#8a1a14"), 0.008);
      if ((i + row) % 3 !== 2) coloredFlame(c, x, y - 0.01, 0.025, FIRE);
    }
  }, { light: { radius: 3, color: "#ffd090", intensity: 0.7 } }),
  ...family({ id: "temple-bell", name: "Temple bell", category: T, group: "Worship", w: 1.4, h: 1.4, layer: "canopy", form: (v) => S.solid([S.limb([-0.7, 3.0, 0], [0.7, 3.0, 0], 0.08, 0.08, WOODS[3], { n: 6 }), S.cyl(0.06, 2.6, 2.95, v.dark, { n: 6 }), S.cyl(0.62, 1.4, 2.6, v, { top: 0.5, n: 14, hollow: 0.85, floor: 2.4 })], { note: "it hangs from a beam: you see under it" }) }, METALS.slice(1, 4), (c, v) => {
    disc(c, 0, 0, 0.62, v);
    for (const r of [0.48, 0.32]) {
      circle(c, 0, 0, r);
      c.strokeStyle = shade(v.dark, -0.2);
      c.lineWidth = 0.02;
      c.stroke();
    }
    disc(c, 0, 0, 0.12, tone(shade(v.dark, 0.1), shade(v.dark, -0.4)));
  }),
];

const shrines: PropDef[] = [
  ...family({ id: "angel-statue", name: "Angel statue", category: T, group: "Statues and shrines", w: 1.4, h: 1, layer: "object", form: (v) => S.solid([S.cbox(0.5, 0.5, 0, 0.6, v.dark), S.cyl(0.16, 0.6, 1.85, v, { z: 0.05, rz: 0.24, top: 0.7 }), S.ball(0.09, 1.8, 2.08, v, { z: -0.12, n: 7 }), [-1, 1].map((s) => S.slab([s * 0.1, -0.1, s * 0.62, -0.38, s * 0.66, -0.05, s * 0.42, 0.25, s * 0.1, 0.1], 1.45, 1.6, v))]) }, THREE_MASONRY, (c, v) => {
    for (const s of [-1, 1]) {
      poly(c, [s * 0.1, -0.1, s * 0.62, -0.38, s * 0.66, -0.05, s * 0.42, 0.25, s * 0.1, 0.1]);
      fo(c, linear(c, 0, -0.38, 0, 0.25, v.light, v.dark));
    }
    ell(c, 0, 0.05, 0.16, 0.24);
    fo(c, radial(c, 0, 0, 0.24, v.light, v.dark));
    disc(c, 0, -0.12, 0.09, v);
  }),
  ...family({ id: "wooden-shrine", name: "Wooden shrine", category: T, group: "Statues and shrines", w: 1, h: 0.8, layer: "object", form: (v) => S.solid([S.box(-0.46, 0.46, -0.36, 0.36, 0, 1.1, v.dark), S.gable(-0.5, 0.5, -0.4, 0.4, 1.1, 1.5, "x", v), S.cyl(0.06, 0, 0.18, "#f4ecd4", { z: 0.42, n: 6 }), S.fire(0, 0.41, 0.18, 0.08, 0.035)]) }, THREE_WOODS, (c, v) => {
    poly(c, [-0.46, -0.36, 0.46, -0.36, 0.46, 0, -0.46, 0]);
    fo(c, linear(c, 0, -0.36, 0, 0, v.light, shade(v.light, -0.1)));
    poly(c, [-0.46, 0, 0.46, 0, 0.46, 0.36, -0.46, 0.36]);
    fo(c, linear(c, 0, 0, 0, 0.36, v.dark, shade(v.dark, -0.2)));
    disc(c, 0, 0.42, 0.07, tone("#f4ecd4", "#c8b88a"), 0.012);
    coloredFlame(c, 0, 0.41, 0.05, FIRE);
  }, { light: { radius: 2.5, color: "#ffd090", intensity: 0.6 } }),
  ...family({ id: "wayside-shrine", name: "Wayside shrine", category: T, group: "Statues and shrines", w: 0.8, h: 0.8, layer: "object", form: (v) => S.solid([S.cbox(0.7, 0.7, 0, 1.4, v), S.cbox(0.8, 0.8, 1.4, 1.5, v.dark, 0, 0, { top: 0.6 }), S.box(-0.2, 0.2, 0.34, 0.36, 0.8, 1.2, "#3a3028"), S.cyl(0.06, 0.95, 1.1, GOLD, { z: 0.36, n: 6 })]) }, THREE_MASONRY, (c, v) => {
    cbox(c, 0, 0, 0.7, 0.7, v, 0.04);
    rr(c, -0.2, -0.24, 0.4, 0.3, 0.12);
    fo(c, tone("#3a3028", "#1a140e").light, 0.012);
    disc(c, 0, -0.1, 0.06, GOLD, 0.01);
  }),
  ...family({ id: "reliquary", name: "Reliquary", category: T, group: "Statues and shrines", w: 0.7, h: 0.5, layer: "object", form: (v) => S.resting(S.solid([S.slab([-0.3, -0.12, -0.2, -0.22, 0.2, -0.22, 0.3, -0.12, 0.3, 0.2, -0.3, 0.2], 0, 0.22, v), S.gable(-0.3, 0.3, -0.22, 0.2, 0.22, 0.38, "x", v), [[-0.15, "#d83a2a"], [0, "#3a6ad8"], [0.15, "#3ab45a"]].map(([x, c]) => S.ball(0.04, 0.1, 0.18, c as string, { x: x as number, z: 0.2, n: 5 }))])) }, [GOLD, METALS[3]], (c, v) => {
    poly(c, [-0.3, -0.12, -0.2, -0.22, 0.2, -0.22, 0.3, -0.12, 0.3, 0.2, -0.3, 0.2]);
    fo(c, linear(c, -0.3, -0.2, 0.3, 0.2, v.light, v.dark));
    for (const [x, col] of [[-0.15, "#d83a2a"], [0, "#3a6ad8"], [0.15, "#3ab45a"]] as const) disc(c, x, 0, 0.04, tone(shade(col, 0.3), col), 0.008);
  }),
];

const GRAVE_SHAPES = [vary("rounded"), vary("cross"), vary("slab")];

const graves: PropDef[] = [
  ...family({ id: "gravestone", name: "Gravestone", category: T, group: "Graveyard", w: 0.8, h: 0.5, layer: "object", form: (v) => v.b.key === "slab" ? S.solid([S.cbox(0.7, 0.3, 0, 0.14, v.a, 0, 0, { top: 0.95 })], { surface: 0.14 }) : v.b.key === "cross" ? S.solid([S.cbox(0.4, 0.2, 0, 0.15, v.a.dark), S.cbox(0.12, 0.1, 0.15, 1.2, v.a), S.cbox(0.5, 0.1, 0.78, 0.9, v.a)], { note: "it stands upright: the drawing shows its face" }) : S.solid([S.cbox(0.6, 0.2, 0, 0.1, v.a.dark), S.cbox(0.56, 0.12, 0.1, 0.75, v.a), S.cbox(0.56, 0.12, 0.75, 0.92, v.a, 0, 0, { top: 0.55 })], { note: "it stands upright: the drawing shows its face" }) }, cross(MASONRY, GRAVE_SHAPES), (c, v) => {
    if (v.b.key === "cross") {
      stroke(c, [-0.32, 0, 0.32, 0], 0.12, v.a.dark, "butt");
      stroke(c, [-0.14, -0.18, -0.14, 0.18], 0.12, v.a.dark, "butt");
      stroke(c, [-0.32, 0, 0.32, 0], 0.07, v.a.light, "butt");
      stroke(c, [-0.14, -0.18, -0.14, 0.18], 0.07, v.a.light, "butt");
      return;
    }
    if (v.b.key === "rounded") {
      c.beginPath();
      c.moveTo(-0.34, 0.12);
      c.lineTo(-0.34, -0.06);
      c.arc(-0.22, -0.06, 0.12, Math.PI, Math.PI * 1.5);
      c.lineTo(0.22, -0.18);
      c.arc(0.22, -0.06, 0.12, Math.PI * 1.5, 0);
      c.lineTo(0.34, 0.12);
      c.closePath();
      fo(c, linear(c, -0.34, -0.18, 0.34, 0.12, v.a.light, v.a.dark));
    } else cbox(c, 0, 0, 0.7, 0.3, v.a, 0.03);
    stroke(c, [-0.15, -0.02, 0.15, -0.02], 0.015, "rgba(0,0,0,0.4)");
  }),
  ...family({ id: "grave-plot", name: "Grave", category: T, group: "Graveyard", w: 1, h: 2, layer: "floor", form: (v) => v.key === "fresh" ? S.solid([S.ball(0.42, -0.05, 0.32, "#6a4e34", { rz: 0.92, lump: 0.08, n: 9 })]) : v.key === "sunken" ? S.flat("a sunken grave, below the ground") : S.solid([S.ball(0.22, -0.05, 0.5, "#6a4e34", { x: 0.47, rz: 0.8, lump: 0.25, n: 8 })], { painted: true, note: "an open grave dug into the ground, its earth heaped beside it" }) }, [vary("fresh", "freshly dug"), vary("sunken"), vary("open", "open, dug")], (c, v) => {
    if (v.key === "open") {
      cbox(c, 0, 0, 0.84, 1.84, tone("#3a2a1a", "#120c06"), 0.03);
      for (const [x, y] of scatter(12, 0.3, 4301)) disc(c, 0.55 + x * 0.3, y * 2, 0.08, tone("#7a5a3a", "#3e2a18"), 0);
      return;
    }
    rr(c, -0.42, -0.92, 0.84, 1.84, 0.3);
    fo(c, linear(c, 0, -0.92, 0, 0.92, v.key === "fresh" ? "#8a6a4a" : "#6a5a44", v.key === "fresh" ? "#4a3220" : "#3a3024"), 0.015);
  }),
  ...family({ id: "tomb-chest", name: "Chest tomb", category: T, group: "Graveyard", w: 1.2, h: 2.2, layer: "object", form: (v) => S.solid([S.cbox(1.1, 2.1, 0, 0.9, v), S.cbox(0.9, 1.9, 0.9, 1.0, v.light, 0, 0, { top: 0.95 }), S.cbox(0.5, 0.06, 1.0, 1.03, v.dark), S.cbox(0.06, 0.8, 1.0, 1.03, v.dark)], { surface: 1.0 }) }, THREE_MASONRY, (c, v) => {
    cbox(c, 0, 0, 1.1, 2.1, v, 0.04);
    cbox(c, 0, 0, 0.9, 1.9, tone(shade(v.light, 0.06), v.dark), 0.03);
    stroke(c, [-0.25, 0, 0.25, 0], 0.06, shade(v.dark, -0.2), "butt");
    stroke(c, [0, -0.4, 0, 0.4], 0.06, shade(v.dark, -0.2), "butt");
  }),
  ...family({ id: "mausoleum", name: "Mausoleum", category: T, group: "Graveyard", w: 3, h: 3, layer: "object", form: (v) => S.solid([S.cbox(2.8, 2.8, 0, 2.6, v.dark), S.box(-1.45, 1.45, -1.45, 1.45, 2.6, 3.9, v, { top: 0.02 }), S.box(-0.35, 0.35, 1.4, 1.42, 0, 1.9, "#2a241e"), [-0.5, 0.5].map((x) => S.post(x, 1.45, 0.14, 0, 2.6, v.light, 8))]) }, THREE_MASONRY, (c, v) => {
    cbox(c, 0, 0, 2.9, 2.9, tone(shade(v.light, -0.08), shade(v.dark, -0.15)), 0.04);
    poly(c, [-1.35, -1.35, 1.35, -1.35, 0, 0]);
    fo(c, shade(v.light, 0.05), 0.02);
    poly(c, [1.35, -1.35, 1.35, 1.35, 0, 0]);
    fo(c, v.dark, 0.02);
    poly(c, [1.35, 1.35, -1.35, 1.35, 0, 0]);
    fo(c, shade(v.dark, -0.1), 0.02);
    poly(c, [-1.35, 1.35, -1.35, -1.35, 0, 0]);
    fo(c, v.light, 0.02);
    for (const x of [-0.5, 0.5]) disc(c, x, 1.45, 0.14, v);
  }),
  ...family({ id: "grave-railing", name: "Grave railing", category: T, group: "Graveyard", w: 1.2, h: 2.2, layer: "object", form: (v) => S.solid([[-0.55, 0.55].flatMap((x) => Array.from({ length: 11 }, (_, i) => S.post(x, -1.05 + i * 0.21, 0.02, 0, 0.95, v.dark, 4))), [-1.05, 1.05].flatMap((z) => [-0.33, -0.11, 0.11, 0.33].map((x) => S.post(x, z, 0.02, 0, 0.95, v.dark, 4))), [0.3, 0.85].flatMap((y) => [S.box(-0.57, -0.53, -1.07, 1.07, y, y + 0.04, v), S.box(0.53, 0.57, -1.07, 1.07, y, y + 0.04, v), S.box(-0.57, 0.57, -1.07, -1.03, y, y + 0.04, v), S.box(-0.57, 0.57, 1.03, 1.07, y, y + 0.04, v)])], { painted: true, note: "iron railings round a grave" }) }, [METALS[0], METALS[1]], (c, v) => {
    c.strokeStyle = v.dark;
    c.lineWidth = 0.035;
    c.strokeRect(-0.55, -1.05, 1.1, 2.1);
    for (let y = -1.05; y <= 1.06; y += 0.21) for (const x of [-0.55, 0.55]) disc(c, x, y, 0.03, v, 0.006);
  }),
];

// ---- Thenn, god of doorways, choice and fate (16 November 2026). His shrine is a doorway: two
// posts, one carved with a spiral and one with chevrons, a lintel bearing a woven ring with his
// tree-rune in it and a stone hung on a cord beneath, stones piled at the posts' feet and
// stepping stones through. Here in a few versions, with the round stone carved with his sign, a
// wayside shrine, and the frames Dungeon's Thenn doors and archways stand in (renderer.ts
// drawPortal draws a portal's with thennFrame below; view3d/payload.ts and io/payload.ts stand it
// up in 3D as the thenn-door-frame objects).

interface ThennLook {
  post: Tone;
  lintel: Tone;
  ring: Tone;
  /** Squared, carved posts and lintel (round, barked logs otherwise). */
  square: boolean;
  /** Ivy (or moss, on stone) over posts and lintel. */
  ivy: string | null;
  /** Gold bands round carved posts. */
  bands?: Tone;
}
const THENN_LOOKS = {
  wild: { post: tone("#94704c", "#4a3220"), lintel: tone("#86643f", "#3e2a18"), ring: tone("#8a6a44", "#4e3820"), square: false, ivy: "#5e8e2a" },
  carved: { post: tone("#5a3a24", "#24150a"), lintel: tone("#5a3a24", "#24150a"), ring: GOLD, square: true, ivy: null, bands: GOLD },
  monolith: { post: tone("#aaa89e", "#5e5c56"), lintel: tone("#a09e94", "#56544e"), ring: tone("#5a5a60", "#262628"), square: true, ivy: "#5a7a3a" },
} satisfies Record<string, ThennLook>;
const PEBBLE = tone("#a6a49c", "#5a5852");
/** The look of the frame Thenn's doors and archways stand in. */
export const THENN_LOOK_WILD: ThennLook = THENN_LOOKS.wild;

export interface ThennFrame {
  /** The opening's width, in squares. */
  open: number;
  /** How thick a post is (half its width), in squares. */
  post: number;
  /** How tall the posts stand, in metres. */
  height: number;
  look: ThennLook;
  /** A wooden door in it (a Thenn door), shown in front of the lintel. */
  door?: boolean;
  /** Stones piled at the posts' feet, stepping stones through. */
  stones?: boolean;
  steps?: boolean;
  /** The ring's radius, in squares, when not the opening's own. */
  ring?: number;
  /**
   * The ring hung on the lintel, one on each face and centred on it, rather than standing on top
   * of it: the small frames, which keep under a 3 m wall's top.
   */
  hung?: boolean;
  /** What the shrine stands on, out to this radius (squares): a ring of edging stones, a gilded dais, or small standing stones. */
  ground?: { kind: "stones" | "dais" | "monoliths"; r: number };
}

/** The ring's radius, in squares, for an opening. */
const ringR = (f: ThennFrame) => f.ring ?? Math.min(0.42, Math.max(0.24, f.open * 0.24));
/** Where the lintel ends, either side. */
const lintelEnd = (f: ThennFrame) => f.open / 2 + f.post * 2 + 0.12;

/**
 * Thenn's frame from above, its opening along x, centred on (0, 0). Battle-map fashion, the ring
 * and its rune are shown tipped towards the viewer, standing over the lintel, so his sign reads
 * from above; the posts' tops carry their carvings, a spiral and chevrons.
 */
export function thennFrame(c: C, f: ThennFrame, seed = 5101): void {
  const half = f.open / 2, px = half + f.post;
  const g = f.ground;
  if (g?.kind === "dais") {
    circle(c, 0, 0, g.r);
    fo(c, radial(c, 0, 0, g.r, "#e2dccd", "#a49c88"), 0.025);
    circle(c, 0, 0, g.r * 0.86);
    c.strokeStyle = GOLD.dark;
    c.lineWidth = 0.035;
    c.stroke();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      stroke(c, [Math.cos(a) * g.r * 0.86, Math.sin(a) * g.r * 0.86, Math.cos(a) * g.r * 0.97, Math.sin(a) * g.r * 0.97], 0.03, GOLD.light);
    }
  } else if (g) {
    circle(c, 0, 0, g.r);
    c.fillStyle = g.kind === "stones" ? "rgba(96,72,44,0.35)" : "rgba(70,84,52,0.3)";
    c.fill();
    const n = g.kind === "stones" ? 22 : 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.1, r1 = g.r * 0.93;
      if (g.kind === "stones") disc(c, Math.cos(a) * r1, Math.sin(a) * r1, 0.09 + ((k * 37) % 5) * 0.012, PEBBLE, 0.01);
      else cbox(c, Math.cos(a) * r1, Math.sin(a) * r1, 0.2, 0.2, f.look.post, 0.015);
    }
  }
  if (f.steps) for (const [y, k] of [[-0.66, 0.9], [0.02, 1.1], [0.7, 0.95]]) {
    ell(c, 0, y, 0.32 * k, 0.2 * k);
    fo(c, radial(c, 0, y, 0.3, shade(PEBBLE.light, 0.12), shade(PEBBLE.dark, 0.2)), 0.01);
  }
  if (f.stones) for (const s2 of [-1, 1]) for (const [x, y, r] of scatter(6, f.post + 0.22, seed + (s2 > 0 ? 7 : 0))) disc(c, s2 * px + x, y, 0.07 + r * 0.06, PEBBLE, 0.01);
  if (f.door) {
    c.fillStyle = "#7a5030";
    c.fillRect(-half, 0.02, f.open, 0.1);
    c.lineWidth = 0.02;
    c.strokeStyle = "#16120e";
    c.strokeRect(-half, 0.02, f.open, 0.1);
  }
  // The lintel, behind the door when there is one.
  const ly = f.door ? -0.07 : 0, le = lintelEnd(f), lt = f.look.square ? 0.13 : 0.12;
  if (f.look.square) {
    rr(c, -le, ly - lt, le * 2, lt * 2, 0.02);
    fo(c, linear(c, 0, ly - lt, 0, ly + lt, f.look.lintel.light, f.look.lintel.dark), 0.02);
    if (f.look.bands) for (const x of [-le + 0.08, le - 0.08]) stroke(c, [x, ly - lt, x, ly + lt], 0.04, f.look.bands.light);
  } else {
    rr(c, -le, ly - lt, le * 2, lt * 2, lt);
    fo(c, linear(c, 0, ly - lt, 0, ly + lt, f.look.lintel.light, f.look.lintel.dark), 0.02);
    for (const x of [-le, le]) disc(c, x, ly, lt * 0.95, tone("#c8a070", "#7a5434"), 0.012);
  }
  // The posts over the lintel's ends, their tops carved: a spiral on the left, chevrons on the right.
  const mark = f.look.bands ? f.look.bands.light : "rgba(30,18,8,0.7)";
  for (const s2 of [-1, 1]) {
    if (f.look.square) {
      cbox(c, s2 * px, ly, f.post * 2, f.post * 2, f.look.post, 0.025);
      if (f.look.bands) {
        c.strokeStyle = f.look.bands.light;
        c.lineWidth = 0.025;
        c.strokeRect(s2 * px - f.post * 0.8, ly - f.post * 0.8, f.post * 1.6, f.post * 1.6);
      }
    } else disc(c, s2 * px, ly, f.post, f.look.post, 0.025);
    c.beginPath();
    if (s2 < 0) {
      for (let t = 0; t < Math.PI * 4; t += 0.2) {
        const r = f.post * 0.12 + (t / (Math.PI * 4)) * f.post * 0.6;
        const x = s2 * px + Math.cos(t) * r, y = ly + Math.sin(t) * r;
        if (t) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
    } else {
      for (const dy of [-0.3, 0, 0.3]) {
        c.moveTo(px - f.post * 0.5, ly + f.post * (dy + 0.25));
        c.lineTo(px, ly + f.post * (dy - 0.15));
        c.lineTo(px + f.post * 0.5, ly + f.post * (dy + 0.25));
      }
    }
    c.strokeStyle = mark;
    c.lineWidth = 0.018;
    c.stroke();
  }
  // The woven ring, tipped towards the viewer over the lintel, the rune's stave and branches in it.
  const r0 = ringR(f), cy = ly - r0 * 0.5;
  ell(c, 0, cy, r0, r0 * 0.62);
  c.strokeStyle = shade(f.look.ring.dark, -0.25);
  c.lineWidth = 0.09;
  c.stroke();
  ell(c, 0, cy, r0, r0 * 0.62);
  c.strokeStyle = f.look.ring.light;
  c.lineWidth = 0.05;
  c.stroke();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    stroke(c, [Math.cos(a) * r0 * 0.95, cy + Math.sin(a) * r0 * 0.59, Math.cos(a + 0.18) * r0 * 1.04, cy + Math.sin(a + 0.18) * r0 * 0.64], 0.012, shade(f.look.ring.dark, -0.3));
  }
  const rh = r0 * 0.62 * 0.85;
  stroke(c, [0, cy + rh, 0, cy - rh], 0.035, f.look.ring.dark);
  for (const [y0, y1] of [[0.1, -0.35], [0.5, 0.05]]) for (const s2 of [-1, 1]) stroke(c, [0, cy + rh * y0, s2 * r0 * 0.38, cy + rh * y1], 0.025, f.look.ring.dark);
  // The stone on its cord, below the ring.
  disc(c, 0, ly + lt * 0.4, 0.05, f.look.bands ?? PEBBLE, 0.01);
  if (f.look.ivy) for (const [x, y, r] of scatter(14, 1, seed + 3)) {
    const along = x * le, across = y * 0.16;
    ell(c, along, ly + across, 0.05 + r * 0.03, 0.035 + r * 0.02, r * 4);
    fo(c, shade(f.look.ivy, (r - 0.5) * 0.3), 0.008);
  }
}

/** Thenn's frame in 3D: posts, lintel, the ring with its rune, the hung stone (and stones and steps). */
export function thennFrameForm(f: ThennFrame): S.Solid {
  const half = f.open / 2, px = half + f.post, H = f.height, le = lintelEnd(f);
  const parts: S.PartList[] = [];
  for (const s of [-1, 1]) {
    if (f.look.square) {
      parts.push(S.cbox(f.post * 2, f.post * 2, 0, H, f.look.post, s * px));
      if (f.look.bands) for (const y of [0.25, H * 0.55, H - 0.25]) parts.push(S.cbox(f.post * 2.08, f.post * 2.08, y - 0.05, y + 0.05, f.look.bands, s * px));
    } else parts.push(S.limb([s * px, 0, 0], [s * px * 1.01, H, 0], f.post, f.post * 0.82, f.look.post, { n: 7 }));
  }
  const lt = f.look.square ? 0.13 : 0.11;
  if (f.look.square) parts.push(S.box(-le, le, -lt, lt, H, H + 0.3, f.look.lintel));
  else parts.push(S.limb([-le, H + 0.1, 0], [le, H + 0.06, 0], lt, lt * 0.9, f.look.lintel, { n: 6 }));
  const top = H + (f.look.square ? 0.3 : 0.2), r = ringR(f), rm = r * S.SQUARE_M;
  // Standing on the lintel, in the frame's own plane; or hung on it, one on each face, centred on the lintel.
  const cy = f.hung ? H + (f.look.square ? 0.15 : 0.08) : top + rm;
  for (const z of f.hung ? [-(lt + 0.035), lt + 0.035] : [0]) {
    const ring = Array.from({ length: 9 }, (_, i) => {
      const t = (i / 8) * Math.PI * 2;
      return [Math.cos(t) * r, cy + Math.sin(t) * rm] as const;
    });
    for (let i = 0; i < 8; i++) parts.push(S.limb([ring[i][0], ring[i][1], z], [ring[i + 1][0], ring[i + 1][1], z], 0.03, 0.03, f.look.ring, { n: 3 }));
    parts.push(S.limb([0, cy - rm * 0.85, z], [0, cy + rm * 0.85, z], 0.022, 0.018, f.look.ring, { n: 4 }));
    for (const [y0, y1] of [[0.1, 0.45], [-0.25, 0.1]]) for (const s of [-1, 1]) parts.push(S.limb([0, cy + rm * y0, z], [s * r * 0.4, cy + rm * y1, z], 0.015, 0.012, f.look.ring, { n: 3 }));
    // The stone on its cord: under the lintel, or under a hung ring.
    const under = f.hung ? cy - rm : H - (f.look.square ? 0 : 0.05);
    const cord = f.hung ? 0.12 : 0.45;
    parts.push(S.limb([0, under, z], [0, under - cord, z], 0.008, 0.008, "#5a4630", { n: 3 }));
    parts.push(S.ball(0.06, under - cord - 0.17, under - cord + 0.03, f.look.bands ?? PEBBLE, { n: 6, z, rz: 0.04 }));
  }
  if (f.stones) for (const s of [-1, 1]) for (const [x, z, k] of scatter(3, f.post + 0.2, 5111 + (s > 0 ? 7 : 0))) parts.push(S.ball(0.08 + k * 0.05, -0.04, 0.22 + k * 0.15, PEBBLE, { x: s * px + x, z, lump: 0.25, n: 5 }));
  const g = f.ground;
  // A dais is pale stone with a gold ring set in its top near the edge, as it's drawn; the stepping stones lie on it.
  const floor = g?.kind === "dais" ? 0.16 : 0;
  if (f.steps) for (const z of [-0.66, 0.02, 0.7]) parts.push(S.cyl(0.3, floor, floor + 0.05, PEBBLE, { z, rz: 0.19, n: 7 }));
  if (g?.kind === "dais") parts.push(S.cyl(g.r, 0, 0.14, "#c4bca8", { n: 16 }), S.cyl(g.r * 0.88, 0.14, 0.15, GOLD, { n: 16 }), S.cyl(g.r * 0.84, 0.14, 0.16, "#dcd5c6", { n: 16 }));
  else if (g) {
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.1, x = Math.cos(a) * g.r * 0.93, z = Math.sin(a) * g.r * 0.93;
      parts.push(g.kind === "stones" ? S.ball(0.1, -0.03, 0.16, PEBBLE, { x, z, lump: 0.25, n: 4 }) : S.cbox(0.2, 0.2, 0, 0.75, f.look.post, x, z));
    }
  }
  if (f.look.ivy) for (const [x, y] of scatter(6, 1, 5131)) {
    const onPost = Math.abs(x) > 0.5;
    parts.push(onPost ? S.ball(0.06, Math.abs(y) * H * 0.8, Math.abs(y) * H * 0.8 + 0.18, f.look.ivy, { x: Math.sign(x) * px + f.post * 0.8 * Math.sign(y), z: f.post * 0.6, n: 4 }) : S.ball(0.07, H + 0.08, H + 0.3, f.look.ivy, { x: x * le, z: lt * 0.8 * Math.sign(y || 1), n: 4 }));
  }
  // The ring is drawn tipped towards the viewer, so it reads from above: the drawing reaches further up the map than the frame.
  return S.solid(parts, { note: "its ring is drawn tipped towards the viewer, to read from above" });
}

/** The frames a Thenn door or archway stands in, by the opening they fit: a door's frame is the one nearest its width, scaled to it. */
export const THENN_FRAMES: { id: string; open: number }[] = [
  { id: "thenn-door-frame-one", open: 1 },
  { id: "thenn-door-frame-two", open: 2 },
];
const doorFrame = (open: number): ThennFrame => ({ open, post: open > 1.5 ? 0.16 : 0.13, height: open > 1.5 ? 2.5 : 2.3, look: THENN_LOOKS.wild });

/**
 * Thenn's small frame, for ordinary buildings (17 November 2026): the same height at every width,
 * so it stays under a 3 m wall's top with room to spare (2.7 m to the top of its ring). Its posts
 * stand 2.25 m, so the lintel clears a shut door (2.1 m in the 3D view), and its ring, 0.6 m
 * across, hangs on the lintel's faces instead of standing on it.
 */
export const smallThennFrame = (open: number): ThennFrame => ({ open, post: open > 1.5 ? 0.14 : 0.12, height: 2.25, look: THENN_LOOKS.wild, ring: 0.2, hung: true });
/** The small frames' widths: every one the Doors tool makes, a quarter square apart, so a small Thenn door's frame fits it exactly. */
const SMALL_WIDTHS = Array.from({ length: 23 }, (_, i) => 0.5 + i * 0.25);
const widthKey = (w: number) => String(w).replace(".", "-");
const widthName = (w: number) => `${w} square${w === 1 ? "" : "s"}`;
const widthOf = (key: string) => Number(key.replace("-", "."));
/** The small frames, by the opening they fit (model/thenn.ts picks the one nearest an opening's width). */
export const THENN_SMALL_FRAMES: { id: string; open: number }[] = SMALL_WIDTHS.map((open) => ({ id: `thenn-small-frame-${widthKey(open)}`, open }));
const frameSize = (f: ThennFrame, depth: number): [number, number] => [+(lintelEnd(f) * 2 + 0.06).toFixed(2), depth];

const DOORWAYS = {
  wild: { open: 1.6, post: 0.2, height: 2.7, look: THENN_LOOKS.wild, stones: true, steps: true, ground: { kind: "stones", r: 1.45 } },
  carved: { open: 1.8, post: 0.18, height: 2.9, look: THENN_LOOKS.carved, stones: false, steps: true, ground: { kind: "dais", r: 1.5 } },
  monolith: { open: 1.6, post: 0.22, height: 2.5, look: THENN_LOOKS.monolith, stones: true, steps: true, ground: { kind: "monoliths", r: 1.5 } },
  // A temple's: wide and tall, carved and gilded, its ring under a hall's roof (5 m to its top).
  great: { open: 3.2, post: 0.26, height: 3.38, look: THENN_LOOKS.carved, stones: false, steps: true, ring: 0.42, ground: { kind: "dais", r: 2.4 } },
} satisfies Record<string, ThennFrame>;

/** Thenn's sign: an arch under rays, a stave with two marks in it. */
function thennSign(c: C, k: number, col: string): void {
  c.save();
  c.scale(k, k);
  c.strokeStyle = col;
  c.lineWidth = 0.06;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(-0.32, 0.3);
  c.lineTo(-0.32, -0.02);
  c.arc(0, -0.02, 0.32, Math.PI, 0);
  c.lineTo(0.32, 0.3);
  c.moveTo(0, -0.18);
  c.lineTo(0, 0.3);
  for (const a of [-2.4, -1.9, -1.57, -1.24, -0.74]) {
    c.moveTo(Math.cos(a) * 0.42, -0.02 + Math.sin(a) * 0.42);
    c.lineTo(Math.cos(a) * 0.55, -0.02 + Math.sin(a) * 0.55);
  }
  c.stroke();
  for (const y of [-0.06, 0.08]) {
    circle(c, 0.08, y, 0.025);
    c.fillStyle = col;
    c.fill();
  }
  c.restore();
}

const thenn: PropDef[] = [
  ...family({ id: "thenn-doorway", name: "Thenn's doorway", category: T, group: "Thenn", w: 1, h: 1, layer: "object", form: (v) => thennFrameForm(DOORWAYS[v.key as keyof typeof DOORWAYS]) }, [vary("wild", "wild wood and ivy"), vary("carved", "carved and gilded"), vary("monolith", "standing monoliths"), vary("great", "great, carved and gilded")], (c, v) => thennFrame(c, DOORWAYS[v.key as keyof typeof DOORWAYS]), { size: (v) => { const f = DOORWAYS[v.key as keyof typeof DOORWAYS]; const d = +(f.ground.r * 2).toFixed(2); return [Math.max(d, frameSize(f, d)[0]), d]; } }),
  ...family({ id: "thenn-door-frame", name: "Thenn's door frame", category: T, group: "Thenn", w: 1, h: 0.4, layer: "object", form: (v) => thennFrameForm(doorFrame(v.key === "two" ? 2 : 1)) }, [vary("one", "one square"), vary("two", "two squares")], (c, v) => thennFrame(c, doorFrame(v.key === "two" ? 2 : 1)), { size: (v) => frameSize(doorFrame(v.key === "two" ? 2 : 1), 0.45) }),
  // The small frames, in their own group so the shrines stay easy to find: one for every width a small Thenn door can be.
  ...family({ id: "thenn-small-frame", name: "Thenn's small door frame", category: T, group: "Thenn's small door frames", w: 1, h: 0.45, layer: "object", form: (v) => thennFrameForm(smallThennFrame(widthOf(v.key))) }, SMALL_WIDTHS.map((w) => vary(widthKey(w), widthName(w))), (c, v) => thennFrame(c, smallThennFrame(widthOf(v.key))), { size: (v) => frameSize(smallThennFrame(widthOf(v.key)), 0.45) }),
  ...family({ id: "thenn-wayshrine", name: "Thenn's wayside shrine", category: T, group: "Thenn", w: 1.1, h: 1.1, layer: "object", form: () => {
    const r = 0.26, rm = r * S.SQUARE_M, cy = 1.55 + rm;
    const ring = Array.from({ length: 9 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * r, cy + Math.sin((i / 8) * Math.PI * 2) * rm] as const);
    return S.solid([
      S.limb([0, 0, 0], [0, 1.6, 0], 0.11, 0.09, THENN_LOOKS.wild.post, { n: 6 }),
      ring.slice(0, 8).map((p, i) => S.limb([p[0], p[1], 0], [ring[i + 1][0], ring[i + 1][1], 0], 0.025, 0.025, THENN_LOOKS.wild.ring, { n: 4 })),
      S.limb([0, cy - rm * 0.85, 0], [0, cy + rm * 0.85, 0], 0.018, 0.015, THENN_LOOKS.wild.ring, { n: 3 }),
      S.limb([0, 1.5, 0.06], [0, 1.15, 0.12], 0.007, 0.007, "#5a4630", { n: 3 }),
      S.ball(0.05, 0.98, 1.16, PEBBLE, { z: 0.12, n: 6 }),
      scatter(5, 0.32, 5141).map(([x, z, k]) => S.ball(0.06 + k * 0.05, -0.03, 0.18 + k * 0.1, PEBBLE, { x, z, lump: 0.25, n: 5 })),
      [-0.2, 0.25].map((x) => S.ball(0.04, 0, 0.07, "#f2efe6", { x, z: 0.38, n: 5 })),
      S.ball(0.05, 0, 0.12, "#7a5432", { x: 0.05, z: 0.4, rz: 0.035, lump: 0.3, n: 5 }),
      S.limb([-0.4, 0.04, 0.2], [-0.05, 0.05, 0.42], 0.025, 0.02, THENN_LOOKS.wild.lintel, { n: 4 }),
    ]);
  } }, [vary("wild")], (c) => {
    for (const [x, y, r] of scatter(5, 0.32, 5141)) disc(c, x, y, 0.07 + r * 0.05, PEBBLE, 0.01);
    stroke(c, [-0.4, 0.2, -0.05, 0.42], 0.05, THENN_LOOKS.wild.lintel.dark);
    for (const x of [-0.2, 0.25]) disc(c, x, 0.38, 0.045, tone("#fbfaf4", "#c8c4b8"), 0.008);
    disc(c, 0.05, 0.4, 0.05, tone("#9a6a3e", "#5a3a1e"), 0.01);
    disc(c, 0, 0, 0.11, THENN_LOOKS.wild.post, 0.02);
    ell(c, 0, 0, 0.26, 0.05);
    fo(c, linear(c, -0.26, 0, 0.26, 0, THENN_LOOKS.wild.ring.light, THENN_LOOKS.wild.ring.dark), 0.012);
    disc(c, 0, 0.12, 0.05, PEBBLE, 0.008);
  }),
  ...family({ id: "thenn-sign", name: "Thenn's sign, carved in a round slab", category: T, group: "Thenn", w: 1.8, h: 1.8, layer: "floor", form: () => S.flat("a round stone set in the ground, his sign carved in it") }, [vary("grey")], (c) => {
    ell(c, 0, 0, 0.86, 0.8);
    fo(c, radial(c, 0, 0, 0.86, "#a8a69c", "#6a6862"), 0.025);
    for (const [x, y, r] of scatter(8, 0.6, 5151)) {
      circle(c, x, y, 0.03 + r * 0.05);
      c.fillStyle = "rgba(60,80,40,0.25)";
      c.fill();
    }
    thennSign(c, 1.1, "rgba(40,36,30,0.75)");
  }),
];

export const TEMPLE_PROPS: PropDef[] = [...altars, ...worship, ...shrines, ...graves, ...thenn];

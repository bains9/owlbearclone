// Copied from Dungeon (src/render/props-temple.ts) by scripts/sync-dungeon-library.mjs, Dungeon cf53d42. Change it there and run the script again.
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

export const TEMPLE_PROPS: PropDef[] = [...altars, ...worship, ...shrines, ...graves];

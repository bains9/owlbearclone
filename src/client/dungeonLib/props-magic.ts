// Copied from Dungeon (src/render/props-magic.ts) by scripts/sync-dungeon-library.mjs, Dungeon e6fcd66. Change it there and run the script again.
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, MASONRY, GLASSES, GLOWS, GOLD, cross, vary, family, glowLight, shade, ell, poly, fo, box, cbox, disc, plank, glow, stroke, bookRow, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// The library and the wizard's tower for the big library: books and scrolls, desks and
// shelves, globes and telescopes, alchemy, and arcane things.

const M = "Library & magic" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const PARCHMENT = tone("#f4e8c8", "#c8b488");
const FOUR_WOODS = WOODS.slice(0, 4);
const THREE_METALS = METALS.slice(1, 4);

const BOOK_COLORS: (Variant & { colors: string[] })[] = [
  { key: "red", name: "red", colors: ["#8a2a22", "#6a1a14"] },
  { key: "blue", name: "blue", colors: ["#2a4a8a", "#1a2a5a"] },
  { key: "green", name: "green", colors: ["#2a6a3a", "#1a4a26"] },
  { key: "brown", name: "brown", colors: ["#6a4a2a", "#4a3018"] },
  { key: "mixed", name: "mixed", colors: ["#8a2a22", "#2a4a8a", "#2a6a3a", "#6a4a2a", "#5a2a6a"] },
];

function book(c: C, x: number, y: number, w: number, h: number, a: number, color: string): void {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  rr(c, -w / 2, -h / 2, w, h, 0.015);
  fo(c, linear(c, -w / 2, 0, w / 2, 0, shade(color, 0.2), color), 0.012);
  stroke(c, [-w / 2 + 0.02, -h / 2 + 0.02, -w / 2 + 0.02, h / 2 - 0.02], 0.012, "rgba(255,230,160,0.6)");
  c.restore();
}

function openBook(c: C, w: number, h: number, cover: string, glowRgb?: string): void {
  if (glowRgb) glow(c, 0, 0, w * 0.8, glowRgb, 0.4);
  rr(c, -w / 2 - 0.03, -h / 2 - 0.03, w + 0.06, h + 0.06, 0.02);
  fo(c, cover, 0.012);
  for (const s of [-1, 1]) {
    rr(c, s < 0 ? -w / 2 : 0, -h / 2, w / 2, h, 0.01);
    fo(c, PARCHMENT.light, 0.01);
    for (let i = 0; i < 6; i++) stroke(c, [s * w * 0.08, -h * 0.35 + i * h * 0.13, s * w * 0.42, -h * 0.35 + i * h * 0.13], 0.008, "rgba(60,40,20,0.45)");
  }
}

const books: PropDef[] = [
  ...family({ id: "book-stack", name: "Stack of books", category: M, group: "Books and scrolls", w: 0.5, h: 0.5, layer: "object", form: (v) => S.resting(S.solid([0, 1, 2, 3].map((i) => S.rbox((i % 2) * 0.03, -i * 0.02, 0.32, 0.24, (i - 1.5) * 0.15, i * 0.05, i * 0.05 + 0.05, v.colors[i % v.colors.length])))) }, BOOK_COLORS, (c, v) => {
    for (let i = 0; i < 4; i++) book(c, (i % 2) * 0.03, -i * 0.02, 0.32, 0.24, (i - 1.5) * 0.15, v.colors[i % v.colors.length]);
  }),
  ...family({ id: "open-tome", name: "Open book", category: M, group: "Books and scrolls", w: 0.6, h: 0.4, layer: "object", form: (v) => S.resting(S.solid([S.box(-0.28, 0.28, -0.19, 0.19, 0, 0.025, v.key === "plain" ? "#6a4a2a" : v.key === "illuminated" ? "#8a2a22" : "#3a1a5a"), S.box(-0.25, -0.01, -0.16, 0.16, 0.025, 0.05, v.key === "spellbook" ? "#e8d0ff" : PARCHMENT.light, { glow: v.key === "spellbook" }), S.box(0.01, 0.25, -0.16, 0.16, 0.025, 0.05, v.key === "spellbook" ? "#e8d0ff" : PARCHMENT.light, { glow: v.key === "spellbook" })])) }, [vary("plain"), vary("illuminated"), vary("spellbook", "glowing spellbook")], (c, v) => {
    openBook(c, 0.5, 0.32, v.key === "plain" ? "#6a4a2a" : v.key === "illuminated" ? "#8a2a22" : "#3a1a5a", v.key === "spellbook" ? "200,130,255" : undefined);
    if (v.key === "illuminated") for (const x of [-0.18, 0.06]) disc(c, x, -0.08, 0.035, GOLD, 0.006);
  }, { light: (v) => (v.key === "spellbook" ? { radius: 2, color: "#c89aff", intensity: 0.5 } : undefined) }),
  ...family({ id: "scroll-heap", name: "Heap of scrolls", category: M, group: "Books and scrolls", w: 0.7, h: 0.6, layer: "object", form: (v) => S.resting(S.solid(scatter(v.key === "small" ? 4 : 9, v.key === "small" ? 0.15 : 0.25, 2601).map(([x, z, k], i) => { const [ax, az] = S.turned([-0.14, 0], k * Math.PI), [bx, bz] = S.turned([0.14, 0], k * Math.PI), y = 0.05 + (i >= 6 ? 0.1 : 0); return S.limb([x + ax, y, z + az], [x + bx, y, z + bz], 0.035, 0.035, PARCHMENT.light, { n: 5 }); }))) }, [vary("small"), vary("large")], (c, v) => {
    for (const [x, y, k] of scatter(v.key === "small" ? 4 : 9, v.key === "small" ? 0.15 : 0.25, 2601)) {
      c.save();
      c.translate(x, y);
      c.rotate(k * Math.PI);
      rr(c, -0.14, -0.035, 0.28, 0.07, 0.035);
      fo(c, linear(c, 0, -0.035, 0, 0.035, PARCHMENT.light, PARCHMENT.dark), 0.01);
      stroke(c, [0, -0.035, 0, 0.035], 0.015, "#8a2a22");
      c.restore();
    }
  }),
  ...family({ id: "reading-desk", name: "Reading desk", category: M, group: "Books and scrolls", w: 1.2, h: 0.7, layer: "object", form: (v) => S.plus(S.table(0.76, v), S.box(-0.35, 0.15, -0.15, 0.15, 0.76, 0.79, PARCHMENT.light), S.cyl(0.05, 0.76, 0.92, "#f4ecd4", { x: 0.38, z: -0.12, n: 6 }), S.fire(0.38, -0.12, 0.92, 0.07, 0.03)) }, WOODS, (c, v) => {
    plank(c, -0.58, -0.32, 1.16, 0.64, v, 2611);
    c.save();
    c.translate(-0.1, 0);
    openBook(c, 0.44, 0.3, "#6a4a2a");
    c.restore();
    disc(c, 0.38, -0.12, 0.05, tone("#f4ecd4", "#c8b88a"), 0.01);
    glow(c, 0.38, -0.12, 0.2, "255,190,90", 0.35);
  }),
  ...family({ id: "writing-desk", name: "Writing desk", category: M, group: "Books and scrolls", w: 1.2, h: 0.7, layer: "object", form: (v) => S.plus(S.table(0.76, v), S.box(-0.3, 0.1, -0.18, 0.12, 0.76, 0.765, PARCHMENT.light), S.cyl(0.05, 0.76, 0.84, "#1a1a24", { x: 0.3, z: -0.12, n: 6 }), S.limb([0.3, 0.84, -0.12], [0.4, 0.98, -0.24], 0.006, 0.004, "#f4f0e6", { n: 3 }), S.rbox(0.32, 0.14, 0.2, 0.14, 0.2, 0.76, 0.8, "#2a4a8a")) }, WOODS, (c, v) => {
    plank(c, -0.58, -0.32, 1.16, 0.64, v, 2621);
    rr(c, -0.3, -0.18, 0.4, 0.3, 0.01);
    fo(c, PARCHMENT.light, 0.01);
    disc(c, 0.3, -0.12, 0.05, tone("#2a2a3a", "#0a0a14"), 0.01);
    stroke(c, [0.3, -0.12, 0.42, -0.26], 0.012, "#f4f0e6");
    book(c, 0.32, 0.14, 0.2, 0.14, 0.2, "#2a4a8a");
  }),
  ...family({ id: "library-stack", name: "Library stack", category: M, group: "Books and scrolls", w: 2.4, h: 0.8, layer: "object", form: (v) => S.solid([S.box(-1.18, 1.18, -0.3, 0.3, 0, 2.2, v.a), S.box(-1.18, 1.18, -0.38, 0.38, 2.15, 2.2, v.a), [-1, 1].flatMap((side) => Array.from({ length: 5 }, (_, i) => S.box(-1.12, v.b.key === "full" ? 1.12 : -0.05 + (i % 2) * 0.3, side < 0 ? -0.37 : 0.3, side < 0 ? -0.3 : 0.37, 0.12 + i * 0.41, 0.12 + i * 0.41 + 0.32, S.BOOKS[(i + (side > 0 ? 2 : 0)) % S.BOOKS.length])))], { surface: 2.2 }) }, cross(WOODS, [vary("full"), vary("sparse")]), (c, v) => {
    box(c, -1.18, -0.38, 2.36, 0.76, v.a, 0.03);
    for (const y of [-0.33, 0.03]) {
      rr(c, -1.12, y, 2.24, 0.3, 0.01);
      fo(c, shade(v.a.dark, -0.35), 0.01);
      bookRow(c, -1.1, y + 0.02, v.b.key === "full" ? 2.2 : 1.1, 0.26, 2631 + y * 10);
    }
  }),
];

const study: PropDef[] = [
  ...family({ id: "globe-stand", name: "Globe", category: M, group: "Study and stars", w: 0.7, h: 0.7, layer: "object", form: (v) => S.solid([S.cyl(0.18, 0, 0.05, v, { n: 8 }), S.cyl(0.03, 0.05, 0.8, v, { n: 5 }), S.ball(0.27, 0.8, 1.6, "#4a86b8", { n: 10 }), S.tub(0.3, 1.18, 1.22, v, 0.9, { n: 14 })]) }, THREE_METALS, (c, v) => {
    disc(c, 0, 0, 0.27, tone("#7ab0d8", "#2a5a8a"));
    for (const [x, y, k] of scatter(5, 0.17, 2701)) {
      ell(c, x, y, 0.06 + k * 0.05, 0.04 + k * 0.03, k * 3);
      fo(c, "#c8b47a", 0.008);
    }
    circle(c, 0, 0, 0.3);
    c.strokeStyle = v.dark;
    c.lineWidth = 0.03;
    c.stroke();
  }),
  ...family({ id: "telescope", name: "Telescope", category: M, group: "Study and stars", w: 1.4, h: 0.6, layer: "object", form: (v) => S.solid([[2.2, 4.1, 0.2].map((a) => S.limb([Math.cos(a) * 0.26, 0, Math.sin(a) * 0.26], [0, 1.15, 0], 0.02, 0.02, WOODS[2].dark, { n: 4 })), (() => { const [ax, az] = S.turned([-0.2, 0], -0.25), [bx, bz] = S.turned([0.6, 0], -0.25), [cx, cz] = S.turned([0.67, 0], -0.25); return [S.limb([ax, 1.15, az], [bx, 1.45, bz], 0.07, 0.07, v, { n: 8 }), S.limb([bx, 1.45, bz], [cx, 1.48, cz], 0.09, 0.09, v.dark, { n: 8 })]; })()]) }, METALS, (c, v) => {
    for (const a of [2.2, 4.1, 0.2]) stroke(c, [0, 0, Math.cos(a) * 0.26, Math.sin(a) * 0.26], 0.03, WOODS[2].dark);
    c.save();
    c.rotate(-0.25);
    rr(c, -0.2, -0.07, 0.8, 0.14, 0.04);
    fo(c, linear(c, 0, -0.07, 0, 0.07, v.light, v.dark), 0.015);
    rr(c, 0.55, -0.09, 0.12, 0.18, 0.03);
    fo(c, v.dark, 0.012);
    c.restore();
  }),
  ...family({ id: "orrery", name: "Orrery", category: M, group: "Study and stars", w: 1, h: 1, layer: "object", form: (v) => S.resting(S.solid([S.cyl(0.2, 0, 0.05, v, { n: 10 }), S.cyl(0.02, 0.05, 0.4, v, { n: 4 }), [0.18, 0.3, 0.42].map((r) => S.tub(r, 0.39, 0.4, v.dark, 1 - 0.025 / r, { n: 12, floor: 0.39 })), S.ball(0.09, 0.32, 0.5, GOLD, { n: 8 }), [[0.18, 0.5, "#c8b4a0"], [0.3, 2.4, "#6a9ad0"], [0.42, 4.2, "#d07a4a"]].map(([r, a, c]) => [S.limb([0, 0.4, 0], [Math.cos(a as number) * (r as number), 0.4, Math.sin(a as number) * (r as number)], 0.008, 0.008, v.light, { n: 3 }), S.ball(0.045, 0.36, 0.45, c as string, { x: Math.cos(a as number) * (r as number), z: Math.sin(a as number) * (r as number), n: 6 })])])) }, THREE_METALS, (c, v) => {
    for (const r of [0.18, 0.3, 0.42]) {
      circle(c, 0, 0, r);
      c.strokeStyle = v.dark;
      c.lineWidth = 0.012;
      c.stroke();
    }
    disc(c, 0, 0, 0.09, GOLD);
    for (const [r, a, col] of [[0.18, 0.5, "#c8b4a0"], [0.3, 2.4, "#6a9ad0"], [0.42, 4.2, "#d07a4a"]] as const) {
      stroke(c, [0, 0, Math.cos(a) * r, Math.sin(a) * r], 0.012, v.light);
      disc(c, Math.cos(a) * r, Math.sin(a) * r, 0.045, tone(shade(col, 0.3), col), 0.008);
    }
  }),
  ...family({ id: "map-table", name: "Map table", category: M, group: "Study and stars", w: 1.6, h: 1.1, layer: "object", form: (v) => S.plus(S.table(0.8, v), S.box(-0.6, 0.6, -0.38, 0.38, 0.8, 0.805, PARCHMENT.light), S.cyl(0.05, 0.8, 0.86, METALS[0], { x: -0.62, z: -0.4, n: 6 }), S.cyl(0.05, 0.8, 0.86, METALS[0], { x: 0.62, z: 0.4, n: 6 })) }, FOUR_WOODS, (c, v) => {
    plank(c, -0.78, -0.52, 1.56, 1.04, v, 2711);
    rr(c, -0.6, -0.38, 1.2, 0.76, 0.01);
    fo(c, PARCHMENT.light, 0.012);
    stroke(c, [-0.5, 0.2, -0.2, -0.1, 0.1, 0.05, 0.45, -0.25], 0.012, "#3a6a9a");
    stroke(c, [-0.3, -0.3, -0.1, 0.25, 0.3, 0.3], 0.01, "#8a5a2a");
    for (const [x, y] of [[-0.62, -0.4], [0.62, 0.4]] as const) disc(c, x, y, 0.05, METALS[0], 0.01);
  }),
  ...family({ id: "hourglass", name: "Hourglass", category: M, group: "Study and stars", w: 0.4, h: 0.4, layer: "object", form: (v) => S.resting(S.solid([S.cyl(0.16, 0, 0.03, v, { n: 8 }), S.cyl(0.11, 0.03, 0.17, "#d8e8f0", { top: 0.15, n: 8 }), S.cyl(0.016, 0.17, 0.31, "#d8e8f0", { top: 7, n: 8 }), S.cyl(0.16, 0.31, 0.34, v, { n: 8 }), [0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2; return S.post(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.012, 0.03, 0.31, v.dark, 4); })])) }, THREE_METALS, (c, v) => {
    disc(c, 0, 0, 0.16, v);
    disc(c, 0, 0, 0.11, tone("#eef6fb", "#9ab8c8"), 0.01);
    disc(c, 0, 0, 0.06, tone("#f0d090", "#b88a3a"), 0);
  }),
];

const alchemy: PropDef[] = [
  ...family({ id: "alchemy-table", name: "Alchemy table", category: M, group: "Alchemy", w: 1.6, h: 0.8, layer: "object", form: (v) => S.plus(S.table(0.8, v), scatter(7, 0.28, 2803).map(([x, z, k]) => [S.cyl(0.06, 0.8, 0.95, GLASSES[Math.floor(k * GLASSES.length)], { x: x * 2, z, n: 6 }), S.cyl(0.02, 0.95, 1.02, GLASSES[Math.floor(k * GLASSES.length)], { x: x * 2, z, n: 4 })]), S.tub(0.12, 0.8, 0.95, METALS[1], 0.75, { x: 0.5, z: 0.1, floor: 0.85 }), S.cyl(0.09, 0.85, 0.9, "#7ae08a", { x: 0.5, z: 0.1, n: 8, glow: true })) }, WOODS, (c, v) => {
    plank(c, -0.78, -0.38, 1.56, 0.76, v, 2801);
    for (const [x, y, k] of scatter(7, 0.28, 2803)) {
      const g = GLASSES[Math.floor(k * GLASSES.length)];
      disc(c, x * 2, y, 0.06, g, 0.01);
    }
    disc(c, 0.5, 0.1, 0.12, METALS[1]);
    glow(c, 0.5, 0.1, 0.2, "120,230,140", 0.35);
  }),
  ...family({ id: "potion-shelf", name: "Potion shelf", category: M, group: "Alchemy", w: 1.6, h: 0.45, layer: "object", form: (v) => S.solid([S.box(-0.78, 0.78, -0.2, 0.2, 1.3, 1.35, v.a), S.box(-0.78, 0.78, -0.2, -0.16, 1.0, 1.35, v.a), Array.from({ length: v.b.key === "full" ? 11 : 4 }, (_, i) => { const n = v.b.key === "full" ? 11 : 4, x = -0.68 + (i / Math.max(1, n - 1)) * 1.36; return [S.cyl(0.055, 1.35, 1.5, GLASSES[i % GLASSES.length], { x, n: 6 }), S.cyl(0.02, 1.5, 1.57, GLASSES[i % GLASSES.length], { x, n: 4 })]; })], { note: "a shelf on the wall, at shoulder height" }) }, cross(WOODS.slice(1, 4), [vary("full"), vary("sparse")]), (c, v) => {
    plank(c, -0.78, -0.2, 1.56, 0.4, v.a, 2811);
    const n = v.b.key === "full" ? 11 : 4;
    for (let i = 0; i < n; i++) disc(c, -0.68 + (i / Math.max(1, n - 1)) * 1.36, 0, 0.055, GLASSES[i % GLASSES.length], 0.01);
  }),
  ...family({ id: "potion-bottles", name: "Potion bottles", category: M, group: "Alchemy", w: 0.4, h: 0.4, layer: "object", form: (v) => S.resting(S.solid(scatter(3, 0.09, 2821).map(([x, z, k]) => { const r = 0.06 + k * 0.02; return [S.ball(r, 0, r * 2.4, v, { x, z, n: 7 }), S.cyl(0.02, r * 2.2, r * 2.2 + 0.08, v, { x, z, n: 4 }), S.cyl(0.024, r * 2.2 + 0.08, r * 2.2 + 0.1, WOODS[0], { x, z, n: 4 })]; }))) }, GLASSES, (c, v) => {
    for (const [x, y, k] of scatter(3, 0.09, 2821)) {
      disc(c, x, y, 0.06 + k * 0.02, v, 0.01);
      disc(c, x, y, 0.02, WOODS[0], 0.005);
    }
  }),
  ...family({ id: "specimen-jars", name: "Specimen jars", category: M, group: "Alchemy", w: 0.8, h: 0.4, layer: "object", form: (v) => S.resting(S.solid([-0.25, 0, 0.25].map((x) => [S.cyl(0.11, 0, 0.28, v.key === "eyes" ? "#d8e8d0" : v.key === "creatures" ? "#b8b0a0" : "#a8c890", { x, n: 8 }), S.cyl(0.09, 0.28, 0.31, "#8a6a4a", { x, n: 8 })]))) }, [vary("eyes"), vary("creatures"), vary("herbs")], (c, v) => {
    for (const x of [-0.25, 0, 0.25]) {
      disc(c, x, 0, 0.11, tone("#eaf6e0", "#9ab88a"), 0.012);
      if (v.key === "eyes") for (const [dx, dy] of scatter(3, 0.05, x * 10 + 3)) {
        disc(c, x + dx, dy, 0.025, tone("#ffffff", "#c8c8c0"), 0.005);
        disc(c, x + dx, dy, 0.01, tone("#3a6a2a", "#0a1a0a"), 0);
      }
      else if (v.key === "creatures") {
        ell(c, x, 0, 0.06, 0.03, x * 3);
        fo(c, "#8a6a5a", 0.008);
      } else for (const [dx, dy] of scatter(4, 0.06, x * 10 + 5)) stroke(c, [x + dx, dy - 0.03, x + dx, dy + 0.03], 0.012, "#4a7a2a");
    }
  }),
  ...family({ id: "alembic", name: "Alembic", category: M, group: "Alchemy", w: 0.8, h: 0.5, layer: "object", form: (v) => S.resting(S.solid([S.ball(0.16, 0, 0.32, v, { x: -0.18, n: 8 }), S.limb([-0.12, 0.3, -0.06], [0.2, 0.22, -0.04], 0.022, 0.016, v.dark, { n: 4 }), S.limb([0.2, 0.22, -0.04], [0.26, 0.16, 0.06], 0.016, 0.016, v.dark, { n: 4 }), S.ball(0.09, 0, 0.18, GLASSES[2], { x: 0.26, z: 0.1, n: 7 })])) }, THREE_METALS, (c, v) => {
    disc(c, -0.18, 0, 0.16, v);
    stroke(c, [-0.06, -0.08, 0.2, -0.04, 0.26, 0.06], 0.03, v.dark);
    disc(c, 0.26, 0.1, 0.09, GLASSES[2], 0.01);
    glow(c, -0.18, 0, 0.22, "255,170,80", 0.3);
  }),
];

const arcane: PropDef[] = [
  ...family({ id: "crystal-ball", name: "Crystal ball", category: M, group: "Arcane", w: 0.5, h: 0.5, layer: "object", form: (v) => S.resting(S.solid([S.cyl(0.2, 0, 0.04, WOODS[3], { n: 8 }), S.cyl(0.12, 0.04, 0.12, WOODS[3], { top: 0.8, n: 8 }), S.ball(0.15, 0.1, 0.42, v.light, { n: 10, glow: true })], { note: "its glow is drawn round it" })) }, GLOWS, (c, v) => {
    disc(c, 0, 0, 0.2, WOODS[3]);
    glow(c, 0, 0, 0.3, v.rgb, 0.45);
    disc(c, 0, 0, 0.15, tone("#ffffff", v.dark), 0.012);
  }, { light: (v) => glowLight(v, 2, 0.5) }),
  ...family({ id: "magic-mirror", name: "Magic mirror", category: M, group: "Arcane", w: 0.8, h: 0.35, layer: "object", form: (v) => S.solid([S.box(-0.38, 0.38, -0.14, 0.14, 0, 0.06, v.a), S.box(-0.38, 0.38, -0.04, 0.04, 0.06, 1.8, v.a), S.box(-0.31, 0.31, 0.04, 0.05, 0.16, 1.7, v.b.light, { glow: true })], { note: "a mirror standing on its feet, its glow drawn round it" }) }, cross(THREE_METALS, [GLOWS[1], GLOWS[3]]), (c, v) => {
    rr(c, -0.38, -0.14, 0.76, 0.28, 0.08);
    fo(c, linear(c, -0.38, 0, 0.38, 0, v.a.light, v.a.dark));
    rr(c, -0.31, -0.08, 0.62, 0.16, 0.05);
    fo(c, radial(c, 0, 0, 0.3, v.b.light, v.b.dark), 0.012);
    glow(c, 0, 0, 0.4, v.b.rgb, 0.3);
  }, { light: (v) => glowLight(v.b, 2, 0.4) }),
  ...family({ id: "spellbook-lectern", name: "Spellbook lectern", category: M, group: "Arcane", w: 0.8, h: 0.6, layer: "object", form: (v) => S.solid([S.cbox(0.5, 0.4, 0, 0.06, WOODS[3], 0, 0.1), S.cbox(0.12, 0.12, 0, 1.0, WOODS[3], 0, 0.1), S.box(-0.3, 0.3, -0.08, 0.28, 1.0, 1.16, WOODS[3], { drop: 0.14 }), S.box(-0.25, 0.25, -0.14, 0.14, 1.16, 1.19, v.light, { drop: 0.12, glow: true })], { note: "its book's glow is drawn round it" }) }, GLOWS, (c, v) => {
    cbox(c, 0, 0.1, 0.6, 0.36, WOODS[3], 0.04);
    openBook(c, 0.5, 0.28, "#3a1a5a", v.rgb);
  }, { light: (v) => glowLight(v, 3, 0.6) }),
  ...family({ id: "staff-rack", name: "Staff rack", category: M, group: "Arcane", w: 1.2, h: 0.4, layer: "object", form: (v) => S.solid([S.box(-0.56, 0.56, -0.08, 0.08, 0, 0.08, v), S.box(-0.56, 0.56, -0.08, -0.04, 0, 1.2, v), S.box(-0.56, 0.56, -0.08, 0.06, 1.0, 1.06, v), GLOWS.map((g, i) => { const x = -0.4 + i * 0.27; return [S.limb([x, 0.08, 0.14], [x, 1.75, -0.12], 0.022, 0.018, WOODS[2].dark, { n: 4 }), S.ball(0.045, 1.72, 1.84, g.light, { x, z: -0.14, n: 6, glow: true })]; })]) }, WOODS.filter((w) => ["honey", "walnut", "ebony"].includes(w.key)), (c, v) => {
    box(c, -0.56, -0.08, 1.12, 0.16, v, 0.03);
    GLOWS.forEach((g, i) => {
      const x = -0.4 + i * 0.27;
      stroke(c, [x, -0.16, x, 0.16], 0.035, WOODS[2].dark);
      disc(c, x, -0.16, 0.045, tone(g.light, g.dark), 0.008);
    });
  }),
  ...family({ id: "rune-tablets", name: "Rune tablets", category: M, group: "Arcane", w: 0.8, h: 0.6, layer: "object", form: (v) => S.resting(S.solid(scatter(3, 0.14, 2901).map(([x, z, k], i) => S.rbox(x, z, 0.24, 0.32, k - 0.5, i * 0.04, i * 0.04 + 0.05, v)))) }, MASONRY.slice(0, 3), (c, v) => {
    for (const [x, y, k] of scatter(3, 0.14, 2901)) {
      c.save();
      c.translate(x, y);
      c.rotate(k - 0.5);
      rr(c, -0.12, -0.16, 0.24, 0.32, 0.05);
      fo(c, radial(c, 0, 0, 0.2, v.light, v.dark), 0.015);
      stroke(c, [-0.05, -0.08, 0.05, -0.02, -0.04, 0.06], 0.012, "rgba(80,160,255,0.85)");
      c.restore();
    }
  }),
];

export const MAGIC_PROPS: PropDef[] = [...books, ...study, ...alchemy, ...arcane];

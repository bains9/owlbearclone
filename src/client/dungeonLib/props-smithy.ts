// Copied from Dungeon (src/render/props-smithy.ts) by scripts/sync-dungeon-library.mjs, Dungeon b102367. Change it there and run the script again.
import { linear, radial, rr } from "./propkit";
import { WOODS, METALS, MASONRY, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, glow, stroke, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// The blacksmith's shop (17 November 2026): a smith's forge with its hood and chimney, a great
// anvil, a rack of the smith's tongs and hammers, racks of finished ironwork, a bench with a leg
// vice, a slack tub, a heap of forge coal, a swage block, and a hitching rail for the horses
// waiting to be shod. In Workshop & smithy's Smithy group (the rail in Farm & village's The village).

const W = "Workshop & smithy" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const IRON = METALS[0];
const pickWoods = (...keys: string[]) => WOODS.filter((w) => keys.includes(w.key));
const BRICK: Tone = { key: "brick", name: "brick", light: "#b8664a", dark: "#6a2e1e" };
const LIT = [vary("lit"), vary("cold")];
const COAL = tone("#4a4846", "#121212");
const EMBER = tone("#ffd060", "#e0400a");
const WATER = tone("#6a8a9a", "#2a3a44");

/** A pair of smith's tongs, seen from above, along (x0, y0)–(x1, y1). */
function tongs(c: C, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * 0.035, ny = (dx / l) * 0.035;
  const jx = x0 + dx * 0.72, jy = y0 + dy * 0.72;
  stroke(c, [x0 - nx, y0 - ny, jx, jy, x1 - nx * 0.4, y1 - ny * 0.4], 0.022, IRON.dark);
  stroke(c, [x0 + nx, y0 + ny, jx, jy, x1 + nx * 0.4, y1 + ny * 0.4], 0.022, IRON.dark);
  disc(c, jx, jy, 0.018, IRON, 0.006);
}

/** A hammer seen from above: its handle from (x, y) along angle a, its head across the end. */
function hammer(c: C, x: number, y: number, a: number, len = 0.32): void {
  const hx = x + Math.cos(a) * len, hy = y + Math.sin(a) * len;
  stroke(c, [x, y, hx, hy], 0.026, "#6a4a2a");
  c.save();
  c.translate(hx, hy);
  c.rotate(a);
  rr(c, -0.03, -0.07, 0.06, 0.14, 0.012);
  fo(c, linear(c, 0, -0.07, 0, 0.07, IRON.light, IRON.dark), 0.008);
  c.restore();
}

/** A horseshoe seen from the front (on a rack) or above, centred on (x, y), opening down. */
function horseshoe(c: C, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, Math.PI * 0.95, Math.PI * 2.05);
  c.lineTo(x + r * 0.95, y + r * 0.9);
  c.moveTo(x - r * 0.95, y + r * 0.9);
  c.lineTo(x - r, y);
  c.lineWidth = r * 0.36;
  c.strokeStyle = IRON.dark;
  c.lineCap = "butt";
  c.stroke();
}

/** The parts of a horseshoe hung at (x, top) on a rack, in 3D: three short bars, opening down. */
function shoeParts(x: number, top: number, z: number, r = 0.07): S.LimbPart[] {
  return [
    S.limb([x - r, top - r, z], [x, top, z], 0.012, 0.012, IRON.dark, { n: 3 }),
    S.limb([x, top, z], [x + r, top - r, z], 0.012, 0.012, IRON.dark, { n: 3 }),
    S.limb([x - r, top - r, z], [x - r * 0.9, top - r * 2.2, z], 0.012, 0.012, IRON.dark, { n: 3 }),
    S.limb([x + r, top - r, z], [x + r * 0.9, top - r * 2.2, z], 0.012, 0.012, IRON.dark, { n: 3 }),
  ];
}

const smithy: PropDef[] = [
  // The smith's forge: a raised hearth of brick or stone with its fire, a hood over the fire and a
  // chimney rising out of it, the bellows' pipe coming in at the side, coal heaped on the corner.
  // Its back (the chimney) goes against a wall.
  ...family({ id: "smithy-forge", name: "Smith's forge with its chimney", category: W, group: "Smithy", w: 2, h: 1.6, layer: "object",
    form: (v) => S.solid([
      S.box(-0.95, 0.95, -0.75, 0.6, 0, 0.8, v.a),
      S.cyl(0.32, 0.8, 0.83, v.b.key === "lit" ? "#ff7a2a" : "#2a1e16", { z: 0.05, n: 10, glow: v.b.key === "lit" }),
      ...(v.b.key === "lit" ? S.fire(0, 0.05, 0.83, 0.32, 0.2, "#ff8a2a") : []),
      S.ball(0.22, 0.8, 0.98, COAL, { x: 0.62, z: 0.25, lump: 0.3, n: 6 }),
      S.box(-0.75, 0.75, -0.75, -0.05, 1.7, 2.3, v.a, { top: 0.45 }),
      S.box(-0.3, 0.3, -0.75, -0.2, 2.3, 4.4, v.a),
      S.box(-0.35, 0.35, -0.78, -0.17, 4.4, 4.5, shade(v.a.dark, -0.2)),
      S.limb([-1.0, 0.7, 0.05], [-0.35, 0.82, 0.05], 0.05, 0.04, IRON.dark, { n: 5 }),
      S.limb([0.2, 0.84, 0.5], [0.7, 0.84, 0.45], 0.015, 0.015, IRON.dark, { n: 3 }),
    ], { note: "the hood and chimney stand up over the back of the hearth, drawn from above as the chimney's top" }),
  }, cross([BRICK, MASONRY[0], MASONRY[2]], LIT), (c, v) => {
    rr(c, -0.95, -0.75, 1.9, 1.35, 0.06);
    fo(c, linear(c, -0.95, -0.75, 0.95, 0.6, v.a.light, v.a.dark));
    // Courses of the hearth's stone or brick.
    for (let y = -0.55; y < 0.6; y += 0.2) stroke(c, [-0.9, y, 0.9, y], 0.008, "rgba(0,0,0,0.18)");
    // The hood, flaring from the chimney out over the fire.
    poly(c, [-0.3, -0.75, 0.3, -0.75, 0.62, -0.08, -0.62, -0.08]);
    fo(c, linear(c, 0, -0.75, 0, -0.08, shade(v.a.light, 0.08), shade(v.a.dark, -0.1)), 0.012);
    // The chimney's top, and its flue.
    rr(c, -0.33, -0.76, 0.66, 0.58, 0.03);
    fo(c, linear(c, -0.3, -0.75, 0.3, -0.2, shade(v.a.light, 0.12), v.a.dark), 0.014);
    rr(c, -0.17, -0.62, 0.34, 0.3, 0.02);
    fo(c, "#141210", 0.008);
    // The fire pit.
    disc(c, 0, 0.12, 0.32, tone("#3a2a20", "#120c08"), 0.014);
    if (v.b.key === "lit") {
      for (const [x, y] of scatter(14, 0.24, 7201)) disc(c, x, 0.12 + y, 0.045, EMBER, 0);
      glow(c, 0, 0.12, 0.6, "255,140,40", 0.5);
    }
    // Coal on the corner, the bellows' pipe from the left, tongs on the front edge.
    for (const [x, y, k] of scatter(10, 0.16, 7202)) disc(c, 0.62 + x, 0.28 + y, 0.035 + k * 0.03, COAL, 0.006);
    stroke(c, [-1.0, 0.12, -0.36, 0.12], 0.07, IRON.dark);
    tongs(c, 0.2, 0.5, 0.72, 0.44);
  }, { light: (v) => (v.b.key === "lit" ? { radius: 6, color: "#ff9a4a", intensity: 1 } : undefined) }),

  // A great anvil, horn and heel, on its iron-bound block of wood; with the hammer and tongs or bare.
  ...family({ id: "smiths-anvil", name: "Smith's great anvil", category: W, group: "Smithy", w: 1.1, h: 0.7, layer: "object",
    form: (v) => S.solid([
      S.cyl(0.3, 0, 0.5, WOODS[2], { x: -0.08, n: 10 }),
      S.cyl(0.31, 0.08, 0.12, IRON.dark, { x: -0.08, n: 10 }),
      S.cyl(0.31, 0.38, 0.42, IRON.dark, { x: -0.08, n: 10 }),
      S.box(-0.4, 0.12, -0.15, 0.15, 0.5, 0.6, IRON),
      S.box(-0.32, 0.04, -0.08, 0.08, 0.6, 0.72, IRON),
      S.box(-0.45, 0.17, -0.11, 0.11, 0.72, 0.86, IRON),
      S.limb([0.17, 0.8, 0], [0.52, 0.84, 0], 0.07, 0.008, IRON, { n: 6 }),
      ...(v.key === "tools" ? [
        S.limb([-0.3, 0.88, 0.04], [0.02, 0.88, 0.1], 0.016, 0.016, "#6a4a2a", { n: 4 }),
        S.cbox(0.08, 0.14, 0.86, 0.94, IRON, -0.32, 0.03),
        S.limb([0.1, 0.02, 0.3], [0.05, 0.72, 0.2], 0.012, 0.012, IRON.dark, { n: 3 }),
        S.limb([0.16, 0.02, 0.3], [0.08, 0.72, 0.2], 0.012, 0.012, IRON.dark, { n: 3 }),
      ] : []),
    ], { surface: 0.86 }),
  }, [vary("tools", "with hammer and tongs"), vary("bare")], (c, v) => {
    disc(c, -0.08, 0, 0.3, WOODS[2], 0.012);
    c.beginPath();
    c.arc(-0.08, 0, 0.29, 0, Math.PI * 2);
    c.lineWidth = 0.025;
    c.strokeStyle = IRON.dark;
    c.stroke();
    // The anvil: the heel square at the left, the face, the horn tapering to a point at the right.
    poly(c, [-0.45, -0.11, 0.17, -0.11, 0.52, -0.01, 0.52, 0.01, 0.17, 0.11, -0.45, 0.11]);
    fo(c, linear(c, 0, -0.11, 0, 0.11, IRON.light, IRON.dark), 0.012);
    rr(c, -0.38, -0.025, 0.07, 0.05, 0.005);
    fo(c, "#1a1a1e", 0.004);
    if (v.key === "tools") {
      hammer(c, 0.02, 0.09, Math.PI + 0.25, 0.34);
      tongs(c, 0.18, 0.32, 0.06, 0.12);
    }
  }),

  // The smith's own tools hung on the wall: tongs of every jaw, hammers, a set of punches and chisels.
  ...family({ id: "smiths-tool-rack", name: "Smith's tool rack", category: W, group: "Smithy", w: 1.6, h: 0.3, layer: "object",
    form: (v) => S.solid([
      S.box(-0.78, 0.78, -0.15, -0.11, 0.95, 1.75, v),
      S.box(-0.78, 0.78, -0.15, 0.0, 1.6, 1.66, v),
      [-0.6, -0.42, -0.24].map((x) => [S.limb([x - 0.03, 1.62, -0.05], [x - 0.02, 1.0, -0.05], 0.012, 0.01, IRON.dark, { n: 3 }), S.limb([x + 0.03, 1.62, -0.05], [x + 0.02, 1.0, -0.05], 0.012, 0.01, IRON.dark, { n: 3 })]),
      [0.0, 0.2, 0.4].map((x) => [S.limb([x, 1.62, -0.05], [x, 1.28, -0.05], 0.014, 0.014, "#6a4a2a", { n: 4 }), S.cbox(0.14, 0.06, 1.2, 1.28, IRON, x, -0.05)]),
      [0.56, 0.62, 0.68].map((x) => S.limb([x, 1.6, -0.06], [x, 1.42, -0.06], 0.012, 0.008, IRON.dark, { n: 3 })),
    ], { note: "the smith's tools hung on a rack on the wall" }),
  }, pickWoods("walnut", "ebony", "weathered"), (c, v) => {
    plank(c, -0.8, -0.15, 1.6, 0.1, v, 7211);
    for (const x of [-0.6, -0.42, -0.24]) tongs(c, x, -0.08, x + 0.02, 0.13);
    for (const x of [0.0, 0.2, 0.4]) hammer(c, x, -0.09, Math.PI / 2, 0.16);
    for (const x of [0.56, 0.62, 0.68]) stroke(c, [x, -0.08, x, 0.06], 0.02, IRON.dark);
  }),

  // Finished work for sale, hung on the wall: horseshoes by the dozen, or tools (sickles, an axe head, hinges, a pot hook).
  ...family({ id: "ironwork-rack", name: "Rack of finished ironwork", category: W, group: "Smithy", w: 1.6, h: 0.3, layer: "object",
    form: (v) => S.solid([
      S.box(-0.78, 0.78, -0.15, -0.11, 0.9, 1.75, v.a),
      S.box(-0.78, 0.78, -0.15, -0.02, 1.62, 1.66, v.a),
      S.box(-0.78, 0.78, -0.15, -0.02, 1.22, 1.26, v.a),
      ...(v.b.key === "horseshoes"
        ? [1.6, 1.2].flatMap((top) => [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6].flatMap((x) => shoeParts(x, top, -0.06)))
        : [
            S.limb([-0.62, 1.6, -0.06], [-0.5, 1.35, -0.06], 0.012, 0.012, "#6a4a2a", { n: 3 }), S.limb([-0.5, 1.35, -0.06], [-0.3, 1.42, -0.06], 0.01, 0.006, IRON, { n: 3 }),
            S.cbox(0.14, 0.04, 1.32, 1.52, IRON, 0.0, -0.06),
            S.limb([0.3, 1.6, -0.06], [0.3, 1.4, -0.06], 0.01, 0.01, IRON.dark, { n: 3 }),
            S.box(0.45, 0.65, -0.1, -0.06, 1.0, 1.18, IRON.dark),
            S.box(-0.4, -0.2, -0.1, -0.06, 0.98, 1.18, IRON.dark),
          ]),
    ], { note: "finished work hung on a rack on the wall" }),
  }, cross(pickWoods("walnut", "weathered"), [vary("horseshoes"), vary("tools", "tools and hinges")]), (c, v) => {
    plank(c, -0.8, -0.15, 1.6, 0.1, v.a, 7221);
    if (v.b.key === "horseshoes") {
      for (const x of [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6]) horseshoe(c, x, -0.02, 0.07);
      for (const x of [-0.48, -0.24, 0, 0.24, 0.48]) horseshoe(c, x, 0.08, 0.06);
    } else {
      c.beginPath();
      c.arc(-0.48, 0.0, 0.12, Math.PI * 1.1, Math.PI * 1.9);
      c.lineWidth = 0.03;
      c.strokeStyle = IRON.light;
      c.stroke();
      stroke(c, [-0.62, -0.08, -0.52, 0.08], 0.03, "#6a4a2a");
      cbox(c, 0.0, -0.02, 0.14, 0.12, IRON, 0.02);
      stroke(c, [0.3, -0.1, 0.3, 0.04, 0.36, 0.08], 0.02, IRON.dark);
      for (const x of [0.55, -0.3]) { rr(c, x - 0.1, -0.06, 0.2, 0.1, 0.01); fo(c, linear(c, x - 0.1, 0, x + 0.1, 0, IRON.light, IRON.dark), 0.008); }
    }
  }),

  // A heavy bench with a leg vice at its end (its leg down to the floor), files and nails on it.
  ...family({ id: "smiths-bench", name: "Smith's bench with a leg vice", category: W, group: "Smithy", w: 1.8, h: 0.8, layer: "object",
    form: (v) => S.solid([
      S.box(-0.88, 0.88, -0.36, 0.3, 0.8, 0.88, v),
      S.legs(-0.86, 0.86, -0.34, 0.28, 0.8, v.dark, 0.08),
      S.box(0.52, 0.76, 0.26, 0.38, 0.74, 1.0, IRON),
      S.limb([0.64, 0.76, 0.36], [0.64, 0.0, 0.36], 0.025, 0.03, IRON.dark, { n: 5 }),
      S.limb([0.5, 0.85, 0.4], [0.78, 0.85, 0.4], 0.012, 0.012, IRON.light, { n: 3 }),
      S.limb([-0.6, 0.89, -0.05], [-0.2, 0.89, 0.0], 0.012, 0.01, IRON.dark, { n: 3 }),
      S.cbox(0.16, 0.12, 0.88, 0.94, "#6a4a2a", 0.1, -0.15),
    ], { surface: 0.88 }),
  }, pickWoods("walnut", "ebony", "weathered"), (c, v) => {
    plank(c, -0.88, -0.36, 1.76, 0.66, v, 7231);
    // The vice's jaws over the front edge, its screw handle across.
    rr(c, 0.52, 0.22, 0.24, 0.18, 0.02);
    fo(c, linear(c, 0.52, 0.22, 0.76, 0.4, IRON.light, IRON.dark), 0.012);
    stroke(c, [0.48, 0.38, 0.8, 0.38], 0.02, IRON.light);
    // Files, a box of nails, a scrap of bar.
    stroke(c, [-0.6, -0.05, -0.2, 0.0], 0.03, IRON.dark);
    stroke(c, [-0.55, 0.1, -0.25, 0.14], 0.025, IRON.dark);
    box(c, 0.02, -0.21, 0.16, 0.12, tone("#8a6a48", "#4a3420"), 0.01);
    for (const [x, y] of scatter(6, 0.04, 7232)) disc(c, 0.1 + x, -0.15 + y, 0.012, IRON, 0);
    stroke(c, [0.25, -0.2, 0.55, -0.12], 0.035, "#5a4e48");
  }),

  // A slack tub: half a barrel of water for quenching, beside the anvil.
  ...family({ id: "slack-tub", name: "Slack tub", category: W, group: "Smithy", w: 0.8, h: 0.8, layer: "object",
    form: (v) => S.solid([
      S.tub(0.37, 0, 0.62, v, 0.86),
      S.cyl(0.32, 0.5, 0.52, WATER, { n: 12 }),
      S.cyl(0.38, 0.08, 0.12, IRON.dark, { n: 12 }),
      S.cyl(0.38, 0.48, 0.52, IRON.dark, { n: 12 }),
    ]),
  }, pickWoods("pale", "walnut", "weathered"), (c, v) => {
    disc(c, 0, 0, 0.37, v, 0.014);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      stroke(c, [Math.cos(a) * 0.32, Math.sin(a) * 0.32, Math.cos(a) * 0.37, Math.sin(a) * 0.37], 0.008, v.dark);
    }
    disc(c, 0, 0, 0.31, WATER, 0.008);
    ell(c, -0.08, -0.08, 0.1, 0.05, -0.5);
    fo(c, "rgba(255,255,255,0.18)", 0);
  }),

  // Forge coal (or charcoal) heaped on the floor by the hearth.
  ...family({ id: "forge-coal-heap", name: "Heap of forge coal", category: W, group: "Smithy", w: 1, h: 0.8, layer: "object",
    form: (v) => S.lump(0.35, v.tone, { sink: 0.35, lump: 0.35 }),
  }, [
    { key: "coal", name: "coal", tone: COAL },
    { key: "charcoal", name: "charcoal", tone: tone("#5e5852", "#22201e") },
  ] as (Variant & { tone: Tone })[], (c, v) => {
    ell(c, 0, 0.02, 0.46, 0.36);
    fo(c, radial(c, 0, 0, 0.46, shade(v.tone.light, -0.1), v.tone.dark), 0.012);
    for (const [x, y, k] of scatter(22, 0.36, 7241)) disc(c, x, y * 0.78, 0.035 + k * 0.035, v.tone, 0.006);
  }),

  // A swage block on its wooden stand: a heavy iron block full of holes and shaped edges.
  ...family({ id: "swage-block", name: "Swage block on its stand", category: W, group: "Smithy", w: 0.7, h: 0.7, layer: "object",
    form: () => S.solid([
      S.box(-0.3, 0.3, -0.3, 0.3, 0, 0.55, WOODS[2], { top: 0.9 }),
      S.box(-0.27, 0.27, -0.27, 0.27, 0.55, 0.72, IRON),
    ], { surface: 0.72 }),
  }, [vary("iron")], (c) => {
    box(c, -0.3, -0.3, 0.6, 0.6, WOODS[2], 0.03);
    rr(c, -0.27, -0.27, 0.54, 0.54, 0.02);
    fo(c, linear(c, -0.27, -0.27, 0.27, 0.27, IRON.light, IRON.dark), 0.012);
    for (const [x, y, r] of [[-0.14, -0.14, 0.045], [0.0, -0.14, 0.03], [0.14, -0.14, 0.05], [-0.14, 0.0, 0.03], [0.14, 0.0, 0.035], [-0.14, 0.14, 0.05], [0.0, 0.14, 0.04], [0.14, 0.14, 0.03]]) disc(c, x, y, r, tone("#2a2a2e", "#0e0e10"), 0.005);
    rr(c, -0.05, -0.05, 0.1, 0.1, 0.005);
    fo(c, "#141416", 0.004);
  }),

  // A hitching rail outside, two posts and a rail, an iron ring to tie a horse to.
  ...family({ id: "hitching-rail", name: "Hitching rail", category: "Farm & village", group: "The village", w: 2, h: 0.3, layer: "object",
    form: (v) => S.solid([
      S.post(-0.88, 0, 0.07, 0, 1.15, v, 6),
      S.post(0.88, 0, 0.07, 0, 1.15, v, 6),
      S.box(-0.97, 0.97, -0.05, 0.05, 0.98, 1.08, v),
      S.limb([0.3, 1.0, 0.06], [0.3, 0.88, 0.08], 0.018, 0.018, IRON.dark, { n: 4 }),
    ]),
  }, pickWoods("honey", "walnut", "weathered"), (c, v) => {
    plank(c, -0.97, -0.06, 1.94, 0.12, v, 7251);
    for (const x of [-0.88, 0.88]) disc(c, x, 0, 0.075, v, 0.012);
    c.beginPath();
    c.arc(0.3, 0.06, 0.035, 0, Math.PI * 2);
    c.lineWidth = 0.018;
    c.strokeStyle = IRON.dark;
    c.stroke();
  }),
];

export const SMITHY_PROPS: PropDef[] = smithy;

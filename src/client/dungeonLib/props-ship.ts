// Copied from Dungeon (src/render/props-ship.ts) by scripts/sync-dungeon-library.mjs, Dungeon fed9df1. Change it there and run the script again.
import { rng } from "./noise";
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, CLOTHS, GOLD, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, stroke, scatter, type C, type Tone } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// Ships and harbours for the big library: on deck, the docks, boats, and cargo.

const SHIP = "Ship & dock" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const IRON = METALS[0];
const FOUR_WOODS = WOODS.filter((w) => ["honey", "walnut", "ebony", "weathered"].includes(w.key));
const THREE_WOODS = WOODS.filter((w) => ["pale", "walnut", "weathered"].includes(w.key));
const ROPE = tone("#d8c090", "#8a6a3a");

function coil(c: C, r: number, t: Tone): void {
  for (let k = r; k > r * 0.25; k -= 0.035) {
    circle(c, 0, 0, k);
    c.strokeStyle = k % 0.07 < 0.035 ? t.light : t.dark;
    c.lineWidth = 0.03;
    c.stroke();
  }
}

const deck: PropDef[] = [
  ...family({ id: "mast", name: "Mast", category: SHIP, group: "On deck", w: 1, h: 1, layer: "object", form: (v) => S.solid([S.cyl(0.2, 0, 0.3, v, { n: 10 }), S.cyl(0.1, 0.3, 6.0, v, { top: 0.6, n: 8 }), Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return S.limb([Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45], [0, 5.4, 0], 0.008, 0.008, ROPE.dark, { n: 3 }); })], { note: "a mast and its rigging, standing up from the deck" }) }, FOUR_WOODS, (c, v) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      stroke(c, [0, 0, Math.cos(a) * 0.45, Math.sin(a) * 0.45], 0.012, ROPE.dark);
    }
    disc(c, 0, 0, 0.2, v);
    disc(c, 0, 0, 0.1, tone(shade(v.light, 0.1), v.dark), 0.012);
  }),
  ...family({ id: "ships-wheel", name: "Ship's wheel", category: SHIP, group: "On deck", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid([S.cbox(0.2, 0.2, 0, 0.9, v, 0, 0.1), S.limb([0, 1.05, 0.02], [0, 1.05, -0.04], 0.42, 0.42, v, { n: 12 }), S.limb([0, 1.05, -0.04], [0, 1.05, -0.1], 0.08, 0.08, METALS[2], { n: 6 })], { note: "it stands on edge on its post: the drawing shows its face" }) }, FOUR_WOODS, (c, v) => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      stroke(c, [0, 0, Math.cos(a) * 0.42, Math.sin(a) * 0.42], 0.035, v.dark);
      disc(c, Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.035, v, 0.008);
    }
    circle(c, 0, 0, 0.3);
    c.strokeStyle = v.light;
    c.lineWidth = 0.06;
    c.stroke();
    disc(c, 0, 0, 0.08, METALS[2]);
  }),
  ...family({ id: "capstan", name: "Capstan", category: SHIP, group: "On deck", w: 1.2, h: 1.2, layer: "object", form: (v) => S.solid([S.cyl(0.26, 0, 0.95, v, { top: 0.85, n: 10 }), S.tub(0.22, 0.3, 0.6, ROPE.light, 0.75, { n: 10, floor: 0.3 }), Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return S.limb([0, 0.85, 0], [Math.cos(a) * 0.55, 0.85, Math.sin(a) * 0.55], 0.03, 0.03, v.dark, { n: 4 }); })]) }, THREE_WOODS, (c, v) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      stroke(c, [0, 0, Math.cos(a) * 0.55, Math.sin(a) * 0.55], 0.06, v.dark);
    }
    disc(c, 0, 0, 0.26, v);
    coil(c, 0.2, ROPE);
  }),
  ...family({ id: "deck-cannon", name: "Cannon", category: SHIP, group: "On deck", w: 1.8, h: 0.8, layer: "object", form: (v) => S.solid([S.box(-0.7, 0.0, -0.3, 0.3, 0.15, 0.5, WOODS[2]), [-0.55, -0.15].flatMap((x) => [-0.34, 0.34].map((z) => S.limb([x, 0.12, z - 0.04], [x, 0.12, z + 0.04], 0.08, 0.08, "#3a2a1a", { n: 8 }))), S.limb([-0.6, 0.62, 0], [0.84, 0.66, 0], 0.14, 0.1, v, { n: 10 }), S.limb([0.84, 0.66, 0], [0.9, 0.66, 0], 0.11, 0.11, v.dark, { n: 10 })]) }, METALS.slice(0, 3), (c, v) => {
    box(c, -0.7, -0.3, 0.7, 0.6, WOODS[2], 0.04);
    for (const x of [-0.55, -0.15]) for (const y of [-0.34, 0.34]) cbox(c, x, y, 0.16, 0.08, tone("#4a3a2a", "#1a120c"), 0.02);
    rr(c, -0.6, -0.14, 1.45, 0.28, 0.12);
    fo(c, linear(c, 0, -0.14, 0, 0.14, v.light, v.dark));
    disc(c, 0.84, 0, 0.1, tone("#1a1a1a", "#000000"), 0.012);
  }),
  ...family({ id: "cannonballs", name: "Cannonballs", category: SHIP, group: "On deck", w: 0.6, h: 0.6, layer: "object", form: (v) => v.key === "rack" ? S.solid([S.box(-0.26, 0.26, -0.26, 0.26, 0, 0.1, WOODS[2], { wall: 0.03, floor: 0.04 }), [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].map(([x, z]) => S.ball(0.1, 0.04, 0.34, "#3a3a40", { x, z, n: 7 }))]) : S.solid([[[-0.12, 0.08], [0.12, 0.08], [0, -0.12]].map(([x, z]) => S.ball(0.1, 0, 0.3, "#3a3a40", { x, z, n: 7 })), S.ball(0.1, 0.22, 0.52, "#3a3a40", { x: 0, z: 0.02, n: 7 })]) }, [vary("pyramid"), vary("rack")], (c, v) => {
    if (v.key === "rack") box(c, -0.26, -0.26, 0.52, 0.52, WOODS[2], 0.03);
    for (const [x, y] of v.key === "rack" ? [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] : [[-0.12, 0.08], [0.12, 0.08], [0, -0.12], [0, 0.02]]) disc(c, x, y, 0.1, tone("#6a6a72", "#1a1a20"), 0.012);
  }),
  ...family({ id: "cargo-hatch", name: "Cargo hatch", category: SHIP, group: "On deck", w: 1.4, h: 1.4, layer: "floor", form: (v) => S.flat(v.b.key === "open" ? "a way down through the deck" : "a hatch in the deck") }, cross(FOUR_WOODS, [vary("shut"), vary("open")]), (c, v) => {
    box(c, -0.66, -0.66, 1.32, 1.32, tone(shade(v.a.light, -0.1), v.a.dark), 0.03);
    if (v.b.key === "open") cbox(c, 0, 0, 1.08, 1.08, tone("#2a2622", "#050404"), 0.02);
    else for (let i = 0; i < 6; i++) stroke(c, [-0.54, -0.45 + i * 0.18, 0.54, -0.45 + i * 0.18], 0.06, i % 2 ? v.a.light : v.a.dark, "butt");
  }),
  ...family({ id: "rigging-coil", name: "Coil", category: SHIP, group: "On deck", w: 0.7, h: 0.7, layer: "floor", form: (v) => S.solid([S.tub(0.3, 0, 0.1, v.key === "rope" ? ROPE.light : IRON.dark, 0.3, { n: 12, floor: 0.02 })]) }, [vary("rope"), vary("chain")], (c, v) => {
    if (v.key === "rope") coil(c, 0.3, ROPE);
    else for (let k = 0.3; k > 0.08; k -= 0.06) for (let i = 0; i < Math.round(k * 40); i++) {
      const a = (i / Math.round(k * 40)) * Math.PI * 2;
      ell(c, Math.cos(a) * k, Math.sin(a) * k, 0.025, 0.014, a);
      c.strokeStyle = IRON.dark;
      c.lineWidth = 0.01;
      c.stroke();
    }
  }),
  ...family({ id: "anchor", name: "Anchor", category: SHIP, group: "On deck", w: 1, h: 1.2, layer: "floor", form: () => S.flat("an anchor lying on the deck") }, METALS.slice(0, 3), (c, v) => {
    stroke(c, [0, -0.5, 0, 0.42], 0.07, v.dark);
    stroke(c, [-0.25, -0.38, 0.25, -0.38], 0.06, v.dark);
    circle(c, 0, -0.54, 0.07);
    c.strokeStyle = v.light;
    c.lineWidth = 0.03;
    c.stroke();
    c.beginPath();
    c.arc(0, 0.12, 0.34, 0.3, Math.PI - 0.3);
    c.strokeStyle = v.dark;
    c.lineWidth = 0.07;
    c.stroke();
    for (const s of [-1, 1]) {
      poly(c, [s * 0.32, 0.22, s * 0.44, 0.12, s * 0.38, 0.32]);
      fo(c, v.light, 0.012);
    }
  }),
  ...family({ id: "ship-bell", name: "Ship's bell", category: SHIP, group: "On deck", w: 0.6, h: 0.6, layer: "object", form: (v) => S.solid([S.post(-0.27, 0, 0.03, 0, 1.6, WOODS[2]), S.post(0.27, 0, 0.03, 0, 1.6, WOODS[2]), S.limb([-0.29, 1.58, 0], [0.29, 1.58, 0], 0.03, 0.03, WOODS[2], { n: 4 }), S.cyl(0.24, 1.1, 1.48, v, { top: 0.45, n: 10 }), S.ball(0.06, 1.48, 1.58, v, { n: 6 }), S.limb([0, 1.1, -0.24], [0, 1.0, -0.3], 0.012, 0.012, ROPE.dark, { n: 3 })]) }, [METALS[1], METALS[2], METALS[3]], (c, v) => {
    disc(c, 0, 0, 0.24, v);
    disc(c, 0, 0, 0.1, tone(shade(v.dark, 0.2), shade(v.dark, -0.4)), 0.012);
    stroke(c, [0, -0.24, 0, -0.3], 0.03, ROPE.dark);
  }),
  ...family({ id: "figurehead", name: "Figurehead", category: SHIP, group: "On deck", w: 1.4, h: 0.6, layer: "object", form: (v) => { const c = v.key === "dragon" ? "#3a7a4a" : v.key === "lion" ? "#d8b040" : "#d8b898"; return S.solid([S.limb([-0.6, 0.25, 0], [0.38, 0.85, 0], 0.17, 0.13, c, { n: 8 }), S.ball(0.14, 0.82, 1.15, c, { x: 0.52, n: 8 }), ...(v.key === "mermaid" ? [S.limb([-0.6, 0.25, 0], [-0.75, 0.15, 0], 0.12, 0.02, "#3a8a9a", { n: 5 })] : [])], { note: "a carved figure raised on its mount" }); } }, [vary("mermaid"), vary("dragon"), vary("lion")], (c, v) => {
    const t = v.key === "dragon" ? tone("#5a9a6a", "#1a4a2a") : v.key === "lion" ? GOLD : tone("#e8c8a8", "#9a7a5a");
    ell(c, 0, 0, 0.6, 0.18);
    fo(c, radial(c, 0, 0, 0.6, t.light, t.dark));
    disc(c, 0.52, 0, 0.14, t);
    if (v.key === "mermaid") {
      poly(c, [-0.6, 0, -0.75, -0.14, -0.72, 0, -0.75, 0.14]);
      fo(c, tone("#5aa0b0", "#1a5a6a").light, 0.012);
    }
  }),
];

const docks: PropDef[] = [
  ...family({ id: "dock-boards", name: "Dock boards", category: SHIP, group: "Docks", w: 3, h: 1.6, layer: "floor", form: (v) => (w, h) => S.solid([S.box(-w / 2 + 0.03, w / 2 - 0.03, -0.75, 0.75, 0, 0.12, v.a), [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => S.post(sx * (w / 2 - 0.1), sz * 0.75, 0.1, 0, 0.9, v.a.dark, 8))], { surface: 0.12 }) }, cross(THREE_WOODS, [vary("short"), vary("long")]), (c, v) => {
    const L = v.b.key === "short" ? 1.9 : 2.9;
    for (let x = -L / 2; x < L / 2 - 0.05; x += 0.24) plank(c, x, -0.75, 0.22, 1.5, v.a, 3401 + x * 10);
    for (const [x, y] of [[-L / 2 + 0.1, -0.75], [L / 2 - 0.1, -0.75], [-L / 2 + 0.1, 0.75], [L / 2 - 0.1, 0.75]] as const) disc(c, x, y, 0.1, tone(shade(v.a.dark, 0.1), shade(v.a.dark, -0.3)));
  }, { size: (v) => (v.b.key === "short" ? [2, 1.6] : [3, 1.6]) }),
  ...family({ id: "mooring-post", name: "Mooring post", category: SHIP, group: "Docks", w: 0.5, h: 0.5, layer: "object", form: (v) => S.solid([S.cyl(0.18, 0, 0.8, v.key === "wooden" ? WOODS[5] : IRON, { n: 10 }), S.cyl(0.21, 0.8, 0.88, v.key === "wooden" ? WOODS[5] : IRON, { n: 10 }), S.tub(0.22, 0.45, 0.52, ROPE.light, 0.8, { n: 10, floor: 0.45 })]) }, [vary("wooden"), vary("iron")], (c, v) => {
    disc(c, 0, 0, 0.18, v.key === "wooden" ? WOODS[5] : IRON);
    circle(c, 0, 0, 0.22);
    c.strokeStyle = ROPE.light;
    c.lineWidth = 0.035;
    c.stroke();
  }),
  ...family({ id: "dock-crane", name: "Dock crane", category: SHIP, group: "Docks", w: 2.4, h: 1.2, layer: "canopy", form: (v) => S.solid([S.cyl(0.36, 0, 0.3, WOODS[2], { x: -0.8, n: 10 }), S.cyl(0.12, 0.3, 3.6, WOODS[1], { x: -0.8, n: 8 }), S.limb([-0.8, 3.5, 0], [1.05, 3.5, 0], 0.08, 0.06, WOODS[1].dark, { n: 6 }), S.limb([-0.8, 2.5, 0], [0.1, 3.45, 0], 0.05, 0.05, WOODS[1].dark, { n: 4 }), ...(v.key === "iron-braced" ? [-0.3, 0.3, 0.8].map((x) => S.limb([x, 3.5, -0.07], [x, 3.5, 0.07], 0.09, 0.09, IRON.dark, { n: 6 })) : []), S.limb([1.05, 3.45, 0], [1.05, 1.55, 0.35], 0.012, 0.012, ROPE.dark, { n: 3 }), S.cbox(0.24, 0.2, 1.2, 1.55, WOODS[0], 1.05, 0.42)], { note: "a crane's arm reaching out over the dock" }) }, [vary("wooden"), vary("iron-braced", "iron-braced")], (c, v) => {
    disc(c, -0.8, 0, 0.36, WOODS[2]);
    stroke(c, [-0.8, 0, 1.05, 0], 0.12, WOODS[1].dark);
    if (v.key === "iron-braced") for (const x of [-0.3, 0.3, 0.8]) stroke(c, [x, -0.07, x, 0.07], 0.04, IRON.dark, "butt");
    stroke(c, [1.05, 0, 1.05, 0.35], 0.015, ROPE.dark);
    cbox(c, 1.05, 0.42, 0.24, 0.2, WOODS[0], 0.02);
  }),
  ...family({ id: "gangplank", name: "Gangplank", category: SHIP, group: "Docks", w: 0.8, h: 2.6, layer: "floor", form: () => S.flat("a gangplank lies on the dock") }, THREE_WOODS, (c, v) => {
    plank(c, -0.35, -1.25, 0.7, 2.5, v, 3411);
    for (let y = -1.05; y < 1.2; y += 0.3) stroke(c, [-0.3, y, 0.3, y], 0.035, shade(v.dark, -0.2), "butt");
  }),
  ...family({ id: "crab-pots", name: "Crab pots", category: SHIP, group: "Docks", w: 1, h: 0.7, layer: "object", form: (v) => S.solid((v.key === "stacked" ? [[-0.2, 0, 0], [0.2, 0, 0], [0, -0.1, 0.26]] : [[-0.32, 0.1, 0], [0.05, -0.15, 0], [0.32, 0.12, 0]]).map(([x, z, y]) => S.box(x - 0.17, x + 0.17, z - 0.12, z + 0.12, y, y + 0.26, WOODS[5].light, { top: 0.9 }))) }, [vary("stacked"), vary("scattered")], (c, v) => {
    const pts = v.key === "stacked" ? [[-0.2, 0], [0.2, 0], [0, -0.1]] : [[-0.32, 0.1], [0.05, -0.15], [0.32, 0.12]];
    for (const [x, y] of pts) {
      c.save();
      c.translate(x, y);
      rr(c, -0.17, -0.12, 0.34, 0.24, 0.06);
      fo(c, WOODS[5].light, 0.015);
      for (let k = -0.12; k <= 0.12; k += 0.06) stroke(c, [k, -0.12, k, 0.12], 0.008, "#4a3a2a");
      c.restore();
    }
  }),
  ...family({ id: "fishing-net", name: "Fishing net", category: SHIP, group: "Docks", w: 1.6, h: 1.2, layer: "floor", form: () => S.flat("a net spread on the ground") }, [vary("dry"), vary("wet")], (c, v) => {
    const col = v.key === "dry" ? "#c8b088" : "#6a7a6a";
    c.save();
    ell(c, 0, 0, 0.72, 0.52);
    c.clip();
    c.strokeStyle = col;
    c.lineWidth = 0.012;
    for (let k = -0.8; k <= 0.8; k += 0.08) {
      c.beginPath();
      c.moveTo(k - 0.5, -0.6);
      c.lineTo(k + 0.5, 0.6);
      c.moveTo(k + 0.5, -0.6);
      c.lineTo(k - 0.5, 0.6);
      c.stroke();
    }
    c.restore();
    for (const [x, y] of scatter(5, 0.45, 3421)) disc(c, x, y * 0.7, 0.04, tone("#e8e0c0", "#a89a6a"), 0.008);
  }),
  ...family({ id: "fish-crate", name: "Fish crate", category: SHIP, group: "Docks", w: 0.8, h: 0.6, layer: "object", form: (v) => S.resting(S.solid([S.box(-0.38, 0.38, -0.28, 0.28, 0, 0.3, WOODS[5], { wall: 0.03, floor: 0.05 }), S.ball(0.32, 0.15, 0.36, v.key === "fresh" ? "#a8b4bc" : "#c8b088", { rz: 0.22, lump: 0.3, n: 7 })])) }, [vary("fresh", "of fresh fish"), vary("salted", "of salted fish")], (c, v) => {
    box(c, -0.38, -0.28, 0.76, 0.56, WOODS[5], 0.03);
    for (const [x, y, k] of scatter(6, 0.18, 3431)) {
      ell(c, x * 1.4, y, 0.12, 0.04, k);
      fo(c, v.key === "fresh" ? linear(c, x - 0.1, y, x + 0.1, y, "#c8d4dc", "#6a7a84") : "#c8b088", 0.008);
    }
  }),
];

const SAILS = CLOTHS.filter((t) => ["white", "crimson", "navy", "ochre", "black", "green"].includes(t.key));

function hull(c: C, L: number, B: number, t: Tone): void {
  c.beginPath();
  c.moveTo(-L / 2, 0);
  c.quadraticCurveTo(-L * 0.35, -B / 2, L * 0.2, -B / 2);
  c.quadraticCurveTo(L * 0.45, -B * 0.4, L / 2, 0);
  c.quadraticCurveTo(L * 0.45, B * 0.4, L * 0.2, B / 2);
  c.quadraticCurveTo(-L * 0.35, B / 2, -L / 2, 0);
  c.closePath();
  fo(c, linear(c, 0, -B / 2, 0, B / 2, t.light, t.dark));
}

const boats: PropDef[] = [
  ...family({ id: "sailboat", name: "Sailboat", category: SHIP, group: "Boats", w: 4, h: 1.6, layer: "object", form: (v) => S.solid([S.slab([-1.9, 0, -1.33, -0.5, 0.76, -0.65, 1.71, -0.52, 1.9, 0, 1.71, 0.52, 0.76, 0.65, -1.33, 0.5], 0, 0.85, WOODS[1], { hollow: 0.86, floor: 0.3 }), S.cyl(0.07, 0.3, 5.2, WOODS[3], { x: 0.1, n: 6 }), S.limb([0.1, 1.2, 0], [-0.75, 1.2, 0.48], 0.035, 0.03, WOODS[3], { n: 4 }), S.panel(0.1, 0.02, -0.72, 0.5, 0.03, 1.25, 4.9, v)], { note: "a boat with its sail swung out" }) }, SAILS, (c, v) => {
    hull(c, 3.8, 1.3, WOODS[1]);
    stroke(c, [-1.6, 0, 1.6, 0], 0.03, shade(WOODS[1].dark, -0.3));
    poly(c, [-0.9, 0, 0.6, -0.08, 0.4, 0.55, -0.7, 0.5]);
    fo(c, linear(c, -0.9, 0, 0.6, 0.5, v.light, v.dark), 0.02);
    disc(c, 0.1, 0, 0.07, WOODS[3]);
  }),
  ...family({ id: "longboat", name: "Longboat", category: SHIP, group: "Boats", w: 5, h: 1.4, layer: "object", form: (v) => S.solid([S.slab([-2.4, 0, -1.68, -0.46, 0.96, -0.6, 2.16, -0.48, 2.4, 0, 2.16, 0.48, 0.96, 0.6, -1.68, 0.46], 0, 0.75, v, { hollow: 0.86, floor: 0.25 }), [-1.6, -1.07, -0.54, -0.01, 0.52, 1.05, 1.58].map((x) => S.box(x - 0.05, x + 0.05, -0.48, 0.48, 0.45, 0.5, v.dark)), [-1.4, -0.87, -0.34, 0.19, 0.72, 1.25].flatMap((x) => [-1, 1].map((s) => S.limb([x, 0.7, s * 0.5], [x - 0.2, 0.35, s * 0.9], 0.02, 0.02, WOODS[0].dark, { n: 4 })))]) }, THREE_WOODS, (c, v) => {
    hull(c, 4.8, 1.2, v);
    for (let x = -1.6; x <= 1.6; x += 0.53) stroke(c, [x, -0.5, x, 0.5], 0.05, shade(v.dark, -0.2), "butt");
    for (let x = -1.4; x <= 1.4; x += 0.53) for (const s of [-1, 1]) stroke(c, [x, s * 0.5, x - 0.2, s * 0.9], 0.03, WOODS[0].dark);
  }),
  ...family({ id: "raft", name: "Raft", category: SHIP, group: "Boats", w: 2, h: 1.6, layer: "floor", form: (v) => S.solid([Array.from({ length: 6 }, (_, i) => S.limb([-0.9, 0.17, -0.605 + i * 0.245], [0.9, 0.17, -0.605 + i * 0.245], 0.115, 0.115, v, { n: 7 })), [-0.6, 0.6].map((x) => S.limb([x, 0.3, -0.75], [x, 0.3, 0.75], 0.02, 0.02, ROPE.dark, { n: 4 }))], { surface: 0.34 }) }, THREE_WOODS, (c, v) => {
    for (let i = 0; i < 6; i++) {
      rr(c, -0.9, -0.72 + i * 0.245, 1.8, 0.23, 0.11);
      fo(c, linear(c, 0, -0.72 + i * 0.245, 0, -0.49 + i * 0.245, v.light, v.dark), 0.015);
    }
    for (const x of [-0.6, 0.6]) stroke(c, [x, -0.75, x, 0.75], 0.03, ROPE.dark);
  }),
  ...family({ id: "buoy", name: "Buoy", category: SHIP, group: "Boats", w: 0.6, h: 0.6, layer: "object", form: (v) => { const col = { red: "#d83a2a", white: "#f4f0e6", yellow: "#f0c830", green: "#3a8a4a" }[v.key]!; return S.solid([S.ball(0.24, -0.1, 0.55, col, { n: 9 }), S.cyl(0.245, 0.18, 0.28, "#f4f0e6", { n: 9 }), S.cyl(0.05, 0.5, 0.62, IRON, { n: 5 })]); } }, [vary("red"), vary("white"), vary("yellow"), vary("green")], (c, v) => {
    const col = { red: "#d83a2a", white: "#f4f0e6", yellow: "#f0c830", green: "#3a8a4a" }[v.key]!;
    disc(c, 0, 0, 0.24, tone(shade(col, 0.25), shade(col, -0.25)));
    stroke(c, [-0.22, 0, 0.22, 0], 0.06, "#f4f0e6", "butt");
    disc(c, 0, 0, 0.05, IRON, 0.01);
  }),
];

/** A cargo pile in 3D (solid.ts): its crates, barrels and sacks where the drawing puts them, chosen by the same dice. */
function cargoPile(key: string): S.Solid {
  const rand = rng(3501 + key.length);
  const parts: S.PartList[] = [];
  scatter(7, 0.6, 3503).forEach(([x, z], i) => {
    const kind = key === "mixed" ? ["crates", "barrels", "sacks"][Math.floor(rand() * 3)] : key;
    // A second layer on the ones put down last, so it's a pile.
    const y = i >= 5 ? 0.45 : 0;
    if (kind === "crates") parts.push(S.cbox(0.42, 0.42, y, y + 0.45, WOODS[Math.floor(rand() * 3)], x, z));
    else if (kind === "barrels") parts.push(S.cyl(0.21, y, y + 0.6, WOODS[1], { x, z, n: 8 }), S.cyl(0.215, y + 0.45, y + 0.5, "#3a3a3e", { x, z, n: 8 }));
    else {
      rand();
      parts.push(S.ball(0.2, y, y + 0.35, "#b0905e", { x, z, rz: 0.16, lump: 0.15, n: 7 }));
    }
  });
  return S.solid(parts, { surface: 0.45 });
}

const cargo: PropDef[] = [
  ...family({ id: "cargo-net", name: "Cargo net", category: SHIP, group: "Cargo", w: 1.6, h: 1.4, layer: "object", form: (v) => S.solid([[[-0.3, -0.25], [0.3, -0.2], [-0.25, 0.3], [0.3, 0.3]].map(([x, z]) => (v.key === "crates" ? [S.cbox(0.5, 0.5, 0, 0.5, WOODS[0], x, z)] : S.barrelAt(x, z, 0.26, 0.75, WOODS[1]))), [-0.3, 0.3].map((z) => S.limb([-0.6, v.key === "crates" ? 0.52 : 0.77, z], [0.6, v.key === "crates" ? 0.52 : 0.77, z], 0.012, 0.012, ROPE.dark, { n: 3 })), [-0.3, 0.3].map((x) => S.limb([x, v.key === "crates" ? 0.52 : 0.77, -0.55], [x, v.key === "crates" ? 0.52 : 0.77, 0.58], 0.012, 0.012, ROPE.dark, { n: 3 }))], { note: "cargo bundled in a net" }) }, [vary("crates", "of crates"), vary("barrels", "of barrels")], (c, v) => {
    for (const [x, y] of [[-0.3, -0.25], [0.3, -0.2], [-0.25, 0.3], [0.3, 0.3]] as const) {
      if (v.key === "crates") cbox(c, x, y, 0.5, 0.5, WOODS[0], 0.03);
      else disc(c, x, y, 0.26, WOODS[1]);
    }
    c.strokeStyle = ROPE.dark;
    c.lineWidth = 0.015;
    for (let k = -0.7; k <= 0.7; k += 0.14) {
      c.beginPath();
      c.moveTo(k, -0.62);
      c.lineTo(k, 0.62);
      c.moveTo(-0.7, k * 0.88);
      c.lineTo(0.7, k * 0.88);
      c.stroke();
    }
  }),
  ...family({ id: "cargo-pile", name: "Cargo pile", category: SHIP, group: "Cargo", w: 2, h: 1.6, layer: "object", form: (v) => cargoPile(v.key) }, [vary("crates"), vary("barrels"), vary("sacks"), vary("mixed")], (c, v) => {
    const rand = rng(3501 + v.key.length);
    for (const [x, y] of scatter(7, 0.6, 3503)) {
      const kind = v.key === "mixed" ? ["crates", "barrels", "sacks"][Math.floor(rand() * 3)] : v.key;
      if (kind === "crates") cbox(c, x, y, 0.42, 0.42, WOODS[Math.floor(rand() * 3)], 0.03);
      else if (kind === "barrels") disc(c, x, y, 0.21, WOODS[1]);
      else {
        ell(c, x, y, 0.2, 0.16, rand());
        fo(c, radial(c, x, y, 0.2, "#c8a878", "#7a5a32"), 0.015);
      }
    }
  }),
];

export const SHIP_PROPS: PropDef[] = [...deck, ...docks, ...boats, ...cargo];


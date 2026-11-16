// Copied from Dungeon (src/render/props-arms.ts) by scripts/sync-dungeon-library.mjs, Dungeon 0b1f460. Change it there and run the script again.
import { circle, radial, linear } from "./propkit";
import { WOODS, METALS, CLOTHS, GOLD, cross, vary, family, ell, poly, fo, box, cbox, disc, plank, stroke, scatter, type C, type Tone } from "./propvariants";
import type { PropDef } from "./propkit";
import * as S from "./solid";

// The armoury and the battlefield for the big library: racks, armour, banners and standards,
// siege engines and defences.

const A = "Arms & armour" as const;
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const STEEL = METALS[3];
const IRON = METALS[0];
const THREE_WOODS = WOODS.filter((w) => ["honey", "walnut", "ebony"].includes(w.key));
const SHIELD_COLORS = CLOTHS.filter((t) => ["crimson", "navy", "green", "ochre", "black", "white"].includes(t.key));
const FULL_SPARSE = [vary("full"), vary("sparse")];

function sword(c: C, x: number, y: number, len: number): void {
  stroke(c, [x, y - len / 2, x, y + len * 0.3], 0.04, STEEL.light, "butt");
  stroke(c, [x - 0.07, y + len * 0.3, x + 0.07, y + len * 0.3], 0.03, GOLD.dark, "butt");
  stroke(c, [x, y + len * 0.3, x, y + len / 2], 0.03, WOODS[2].dark, "butt");
}

function shield(c: C, x: number, y: number, r: number, t: Tone, emblem = true): void {
  disc(c, x, y, r, t);
  circle(c, x, y, r * 0.85);
  c.strokeStyle = IRON.dark;
  c.lineWidth = 0.02;
  c.stroke();
  if (emblem) disc(c, x, y, r * 0.25, METALS[2], 0.01);
}

const racks: PropDef[] = [
  ...family({ id: "sword-rack", name: "Sword rack", category: A, group: "Racks", w: 1.4, h: 0.5, layer: "object", form: (v) => S.solid([S.box(-0.66, 0.66, -0.2, 0.2, 0, 0.1, v.a), S.box(-0.66, 0.66, -0.06, 0.06, 0.75, 0.82, v.a), S.post(-0.62, 0, 0.03, 0.1, 0.82, v.a, 4), S.post(0.62, 0, 0.03, 0.1, 0.82, v.a, 4), Array.from({ length: v.b.key === "full" ? 6 : 2 }, (_, i) => { const x = -0.5 + i * 0.2; return [S.limb([x, 0.1, 0.18], [x, 1.05, -0.12], 0.018, 0.012, STEEL.light, { n: 4 }), S.limb([x - 0.07, 0.92, -0.08], [x + 0.07, 0.92, -0.08], 0.015, 0.015, GOLD.dark, { n: 3 }), S.limb([x, 0.93, -0.08], [x, 1.12, -0.15], 0.02, 0.02, WOODS[2].dark, { n: 4 })]; })]) }, cross(THREE_WOODS, FULL_SPARSE), (c, v) => {
    box(c, -0.66, -0.06, 1.32, 0.12, v.a, 0.02);
    const n = v.b.key === "full" ? 6 : 2;
    for (let i = 0; i < n; i++) sword(c, -0.5 + i * 0.2, 0, 0.42);
  }),
  ...family({ id: "spear-rack", name: "Spear rack", category: A, group: "Racks", w: 0.8, h: 0.8, layer: "object", form: (v) => S.solid([S.cyl(0.3, 0, 0.15, v, { n: 10 }), S.tub(0.28, 1.0, 1.06, v, 0.85, { n: 10, floor: 1.0 }), Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2; return [S.cyl(0.03, 0.15, 2.1, WOODS[1], { x, z, n: 4 }), S.cone(0.035, 2.1, 2.35, STEEL.light, { x, z, n: 4 })]; })]) }, THREE_WOODS, (c, v) => {
    disc(c, 0, 0, 0.3, v);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.2;
      const y = Math.sin(a) * 0.2;
      disc(c, x, y, 0.035, WOODS[1], 0.008);
      poly(c, [x - 0.03, y, x + 0.03, y, x, y - 0.1]);
      fo(c, STEEL.light, 0.008);
    }
  }),
  ...family({ id: "bow-rack", name: "Bow rack", category: A, group: "Racks", w: 1.4, h: 0.4, layer: "object", form: (v) => S.solid([S.box(-0.66, 0.66, -0.12, -0.08, 0.9, 1.6, v), S.box(-0.66, 0.66, -0.12, 0.05, 1.5, 1.55, v), [-0.4, 0, 0.4].map((x) => [S.limb([x - 0.17, 1.15, -0.02], [x, 1.5, 0.04], 0.018, 0.018, WOODS[1].dark, { n: 4 }), S.limb([x, 1.5, 0.04], [x + 0.17, 1.15, -0.02], 0.018, 0.018, WOODS[1].dark, { n: 4 }), S.limb([x - 0.17, 1.15, -0.02], [x + 0.17, 1.15, -0.02], 0.004, 0.004, "#f0e6d0", { n: 3 })])], { note: "bows hung on a rack on the wall" }) }, THREE_WOODS, (c, v) => {
    box(c, -0.66, -0.05, 1.32, 0.1, v, 0.02);
    for (const x of [-0.4, 0, 0.4]) {
      c.beginPath();
      c.arc(x, 0.1, 0.18, Math.PI * 1.15, Math.PI * 1.85);
      c.strokeStyle = WOODS[1].dark;
      c.lineWidth = 0.035;
      c.stroke();
      stroke(c, [x - 0.15, 0.0, x + 0.15, 0.0], 0.008, "#f0e6d0");
    }
  }),
  ...family({ id: "shield-rack", name: "Shield rack", category: A, group: "Racks", w: 1.6, h: 0.5, layer: "object", form: (v) => S.solid([S.box(-0.76, 0.76, -0.04, 0.04, 0, 0.75, WOODS[2]), [-0.5, 0, 0.5].map((x) => [S.limb([x, 0.4, 0.04], [x, 0.44, 0.1], 0.2, 0.2, v, { n: 12 }), S.ball(0.05, 0.37, 0.47, METALS[2], { x, z: 0.12, n: 6 })])], { note: "shields leaning on the rack: the drawing shows their faces" }) }, SHIELD_COLORS, (c, v) => {
    box(c, -0.76, -0.04, 1.52, 0.08, WOODS[2], 0.02);
    for (const x of [-0.5, 0, 0.5]) shield(c, x, 0, 0.2, v);
  }),
];

function armourStand(c: C, m: Tone, mail: boolean): void {
  disc(c, 0, 0, 0.3, WOODS[2]);
  ell(c, 0, 0.02, 0.26, 0.17);
  fo(c, radial(c, 0, 0, 0.26, m.light, m.dark));
  if (mail) {
    c.save();
    ell(c, 0, 0.02, 0.26, 0.17);
    c.clip();
    for (const [x, y] of scatter(40, 0.24, 4501)) {
      circle(c, x, y, 0.015);
      c.strokeStyle = "rgba(0,0,0,0.35)";
      c.lineWidth = 0.006;
      c.stroke();
    }
    c.restore();
  } else for (const x of [-0.22, 0.22]) disc(c, x, 0, 0.09, m, 0.012);
  disc(c, 0, -0.04, 0.1, m);
}

const armour: PropDef[] = [
  ...family({ id: "armour-stand", name: "Armour stand", category: A, group: "Armour", w: 0.8, h: 0.8, layer: "object", form: (v) => S.solid([S.cyl(0.3, 0, 0.06, WOODS[2], { n: 10 }), S.cyl(0.03, 0.06, 1.0, WOODS[2], { n: 5 }), S.cyl(0.26, 1.0, 1.5, v.a, { z: 0.02, rz: 0.17, top: 0.85, n: 10 }), ...(v.b.key === "plate" ? [S.ball(0.09, 1.38, 1.56, v.a, { x: -0.22, n: 6 }), S.ball(0.09, 1.38, 1.56, v.a, { x: 0.22, n: 6 })] : [S.cyl(0.24, 0.75, 1.0, v.a.dark, { z: 0.02, rz: 0.16, n: 10 })]), S.ball(0.1, 1.55, 1.82, v.a, { z: -0.04, n: 8 })]) }, cross(METALS, [vary("plate"), vary("mail")]), (c, v) => armourStand(c, v.a, v.b.key === "mail")),
  ...family({ id: "helmet-shelf", name: "Helmet shelf", category: A, group: "Armour", w: 1.4, h: 0.4, layer: "object", form: (v) => S.solid([S.box(-0.66, 0.66, -0.16, 0.16, 1.3, 1.35, WOODS[2]), S.box(-0.66, 0.66, -0.16, -0.12, 1.0, 1.35, WOODS[2]), [-0.4, 0, 0.4].map((x) => S.ball(0.13, 1.35, 1.6, v, { x, n: 8 }))], { note: "a shelf on the wall, at shoulder height" }) }, METALS.slice(0, 3), (c, v) => {
    plank(c, -0.66, -0.16, 1.32, 0.32, WOODS[2], 4511);
    for (const x of [-0.4, 0, 0.4]) {
      disc(c, x, 0, 0.13, v);
      stroke(c, [x - 0.08, 0.02, x + 0.08, 0.02], 0.025, "#1a1410");
    }
  }),
  ...family({ id: "round-shield", name: "Round shield", category: A, group: "Armour", w: 0.7, h: 0.7, layer: "object", form: (v) => S.solid([S.cyl(0.32, 0, 0.06, v, { n: 14 }), S.tub(0.32, 0.06, 0.07, IRON.dark, 0.85, { n: 14, floor: 0.06 }), S.ball(0.08, 0.04, 0.13, METALS[2], { n: 7 })]) }, SHIELD_COLORS, (c, v) => shield(c, 0, 0, 0.32, v)),
];

const banners: PropDef[] = [
  ...family({ id: "war-banner", name: "War banner", category: A, group: "Banners and standards", w: 1, h: 0.6, layer: "canopy", form: (v) => S.solid([S.cyl(0.04, 0, 3.0, WOODS[3], { x: -0.4, n: 5 }), S.ball(0.06, 2.95, 3.1, GOLD, { x: -0.4, n: 6 }), S.limb([-0.4, 2.8, 0], [0.42, 2.8, 0], 0.015, 0.015, WOODS[3], { n: 3 }), S.panel(-0.36, 0, 0.42, 0, 0.03, 1.85, 2.8, v.a), ...(v.b.key === "emblem" ? [S.panel(-0.06, 0.02, 0.12, 0.02, 0.01, 2.2, 2.45, v.a.key === "white" || v.a.key === "ochre" ? "#1a1410" : "#f6dc78")] : [])], { note: "a banner flying from its pole: the drawing shows its face" }) }, cross(CLOTHS, [vary("plain"), vary("emblem", "with an emblem")]), (c, v) => {
    disc(c, -0.4, 0, 0.06, WOODS[3]);
    poly(c, [-0.36, -0.22, 0.42, -0.22, 0.42, 0.12, 0.03, 0.26, -0.36, 0.12]);
    fo(c, linear(c, -0.36, 0, 0.42, 0, v.a.light, v.a.dark), 0.02);
    if (v.b.key === "emblem") {
      const ink = v.a.key === "white" || v.a.key === "ochre" ? "#1a1410" : "#f6dc78";
      poly(c, [0.03, -0.12, 0.13, -0.02, 0.03, 0.12, -0.07, -0.02]);
      fo(c, ink, 0.008);
    }
  }),
];

const siege: PropDef[] = [
  ...family({ id: "ballista", name: "Ballista", category: A, group: "Siege and defence", w: 2, h: 1.6, layer: "object", form: (v) => S.solid([[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2 + 0.3; return S.limb([Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5], [0, 0.95, 0], 0.04, 0.04, v.dark, { n: 4 }); }), S.box(-0.9, 0.9, -0.1, 0.1, 0.95, 1.1, v), S.limb([0.4 - 0.7 * 0.37, 1.05, 0], [0.14, 1.08, 0.65], 0.04, 0.03, v.dark, { n: 4 }), S.limb([0.4 - 0.7 * 0.37, 1.05, 0], [0.14, 1.08, -0.65], 0.04, 0.03, v.dark, { n: 4 }), S.limb([0.14, 1.08, 0.65], [-0.6, 1.12, 0], 0.006, 0.006, "#f0e6d0", { n: 3 }), S.limb([-0.6, 1.12, 0], [0.14, 1.08, -0.65], 0.006, 0.006, "#f0e6d0", { n: 3 }), S.limb([-0.6, 1.14, 0], [0.95, 1.14, 0], 0.025, 0.025, STEEL.dark, { n: 4 }), S.cone(0.04, 0, 0.1, STEEL.light, { x: 1.0, n: 4 })]) }, THREE_WOODS, (c, v) => {
    plank(c, -0.9, -0.1, 1.8, 0.2, v, 4601);
    c.beginPath();
    c.arc(0.4, 0, 0.7, Math.PI * 0.62, Math.PI * 1.38);
    c.strokeStyle = v.dark;
    c.lineWidth = 0.08;
    c.stroke();
    stroke(c, [-0.17, -0.65, -0.6, 0, -0.17, 0.65], 0.015, "#f0e6d0");
    stroke(c, [-0.6, 0, 0.95, 0], 0.03, STEEL.dark);
    poly(c, [0.95, -0.05, 1.05, 0, 0.95, 0.05]);
    fo(c, STEEL.light, 0.008);
  }),
  ...family({ id: "catapult", name: "Catapult", category: A, group: "Siege and defence", w: 2.4, h: 1.6, layer: "object", form: (v) => S.solid([[-0.6, 0.6].map((z) => S.box(-1.1, 1.1, z - 0.08, z + 0.08, 0.32, 0.48, v)), [-0.9, 0.9].flatMap((x) => [-0.72, 0.72].map((z) => S.limb([x, 0.32, z - 0.05], [x, 0.32, z + 0.05], 0.21, 0.21, "#3a2a1a", { n: 8 }))), [-0.55, 0.55].map((z) => S.cbox(0.14, 0.14, 0.48, 1.45, v, 0, z)), S.limb([0, 1.4, -0.6], [0, 1.4, 0.6], 0.06, 0.06, v, { n: 5 }), S.limb([-0.1, 0.55, 0], [0.95, 0.75, 0], 0.07, 0.06, v.dark, { n: 5 }), S.tub(0.18, 0.7, 0.95, "#5a4632", 0.75, { x: 1.0, floor: 0.75 }), S.ball(0.14, 0.75, 0.98, "#8a7a62", { x: 1.0, n: 7 })]) }, THREE_WOODS.slice(0, 2), (c, v) => {
    for (const y of [-0.6, 0.6]) plank(c, -1.1, y - 0.08, 2.2, 0.16, v, 4611 + y);
    for (const x of [-0.9, 0.9]) for (const y of [-0.72, 0.72]) disc(c, x, y, 0.16, tone("#4a3a2a", "#1a120c"));
    plank(c, -0.08, -0.6, 0.16, 1.2, v, 4613);
    stroke(c, [0, 0, 0.95, 0], 0.08, v.dark);
    disc(c, 1, 0, 0.18, tone("#8a7a62", "#4a3e2e"));
  }),
  ...family({ id: "barricade", name: "Barricade", category: A, group: "Siege and defence", w: 2, h: 0.8, layer: "object", form: (v) => v.key === "spiked" ? S.solid([S.limb([-0.95, 0.4, 0], [0.95, 0.4, 0], 0.06, 0.06, WOODS[2].dark, { n: 6 }), Array.from({ length: 6 }, (_, i) => { const x = -0.85 + i * 0.34; return [S.limb([x - 0.18, 0, -0.34], [x + 0.18, 0.95, 0.34], 0.035, 0.015, WOODS[1].light, { n: 4 }), S.limb([x + 0.18, 0, -0.34], [x - 0.18, 0.95, 0.34], 0.035, 0.015, WOODS[1].light, { n: 4 })]; })]) : v.key === "planked" ? S.solid([S.box(-0.95, 0.95, -0.3, 0.3, 0, 1.2, WOODS[5], { top: 0.4 })]) : S.solid([S.cbox(0.8, 0.6, 0, 0.9, WOODS[1], -0.5, 0), S.cbox(0.5, 0.5, 0, 0.7, WOODS[0], 0.45, 0.05), S.cbox(0.45, 0.45, 0.9, 1.3, WOODS[0], -0.55, 0)]) }, [vary("spiked"), vary("planked"), vary("carts", "of carts and crates")], (c, v) => {
    if (v.key === "spiked") {
      stroke(c, [-0.95, 0, 0.95, 0], 0.08, WOODS[2].dark);
      for (let x = -0.85; x <= 0.86; x += 0.34) for (const s of [-1, 1]) stroke(c, [x, 0, x + s * 0.18, s * 0.34], 0.05, WOODS[1].light);
    } else if (v.key === "planked") {
      for (let i = 0; i < 4; i++) plank(c, -0.95, -0.3 + i * 0.15, 1.9, 0.14, WOODS[5], 4621 + i);
    } else {
      cbox(c, -0.5, 0, 0.8, 0.6, WOODS[1], 0.04);
      cbox(c, 0.45, 0.05, 0.5, 0.5, WOODS[0], 0.03);
    }
  }),
  ...family({ id: "caltrops", name: "Caltrops", category: A, group: "Siege and defence", w: 1.2, h: 1, layer: "floor", form: () => S.flat("caltrops scattered on the floor") }, [vary("scattered"), vary("patch", "dense patch")], (c, v) => {
    for (const [x, y, k] of scatter(v.key === "scattered" ? 10 : 24, v.key === "scattered" ? 0.48 : 0.32, 4631)) {
      for (let i = 0; i < 3; i++) {
        const a = k * 6 + (i / 3) * Math.PI * 2;
        stroke(c, [x, y, x + Math.cos(a) * 0.05, y + Math.sin(a) * 0.05], 0.015, IRON.dark);
      }
    }
  }),
  ...family({ id: "arrow-bundle", name: "Bundle of arrows", category: A, group: "Siege and defence", w: 0.9, h: 0.4, layer: "object", form: (v) => S.resting(S.solid([Array.from({ length: v.key === "few" ? 4 : 10 }, (_, i, ) => { const n = v.key === "few" ? 4 : 10, z = -0.12 + (i / Math.max(1, n - 1)) * 0.24, y = 0.02 + (i % 3) * 0.02; return [S.limb([-0.4, y, z], [0.4, y, z], 0.012, 0.012, WOODS[0].dark, { n: 3 }), S.limb([0.4, y, z], [0.46, y, z], 0.025, 0, STEEL.light, { n: 3 }), S.limb([-0.4, y, z], [-0.32, y, z], 0.03, 0.03, "#f0e6d0", { n: 3 })]; }), S.limb([0, 0.05, -0.15], [0, 0.05, 0.15], 0.02, 0.02, "#8a6a3a", { n: 4 })])) }, [vary("few"), vary("many")], (c, v) => {
    const n = v.key === "few" ? 4 : 10;
    for (let i = 0; i < n; i++) {
      const y = -0.12 + (i / Math.max(1, n - 1)) * 0.24;
      stroke(c, [-0.4, y, 0.4, y + (i % 2) * 0.02], 0.015, WOODS[0].dark);
      poly(c, [0.4, y - 0.025, 0.46, y, 0.4, y + 0.025]);
      fo(c, STEEL.light, 0.005);
      stroke(c, [-0.4, y, -0.32, y], 0.03, "#f0e6d0");
    }
    stroke(c, [0, -0.15, 0, 0.15], 0.03, "#8a6a3a");
  }),
  ...family({ id: "quiver", name: "Quiver", category: A, group: "Siege and defence", w: 0.5, h: 0.4, layer: "object", form: (v) => S.solid([S.cyl(0.15, 0, 0.6, v.key === "brown" ? "#7a5232" : "#38342f", { rz: 0.1, top: 1.1, n: 8 }), S.ball(0.12, 0.55, 0.78, "#f0e6d0", { rz: 0.08, lump: 0.3, n: 6 })]) }, [vary("brown", "brown leather"), vary("black", "black leather")], (c, v) => {
    ell(c, 0, 0, 0.18, 0.12);
    fo(c, radial(c, 0, 0, 0.18, v.key === "brown" ? "#9a6a3e" : "#55504a", v.key === "brown" ? "#4a2e18" : "#1a1816"));
    for (const [x, y] of scatter(7, 0.08, 4641)) disc(c, x, y, 0.02, tone("#f0e6d0", "#b4a682"), 0.005);
  }),
  ...family({ id: "war-drum", name: "War drum", category: A, group: "Siege and defence", w: 0.9, h: 0.9, layer: "object", form: (v) => S.solid([S.cyl(0.4, 0, 0.75, WOODS[4], { n: 14 }), S.cyl(0.36, 0.75, 0.77, v.key === "dark" ? "#6a4e34" : "#e4d4b0", { n: 14 }), ...(v.key === "painted" ? [S.slab([0, -0.2, 0.17, 0.1, -0.17, 0.1], 0.77, 0.78, CLOTHS[0].light)] : []), S.cyl(0.41, 0.6, 0.66, METALS[2], { n: 14 })]) }, [vary("pale", "pale hide"), vary("dark", "dark hide"), vary("painted", "painted hide")], (c, v) => {
    disc(c, 0, 0, 0.4, WOODS[4]);
    disc(c, 0, 0, 0.33, v.key === "dark" ? tone("#8a6a4a", "#4a3220") : tone("#f0e2c4", "#b8a07a"), 0.015);
    if (v.key === "painted") {
      poly(c, [0, -0.2, 0.17, 0.1, -0.17, 0.1]);
      fo(c, CLOTHS[0].light, 0.01);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      disc(c, Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0.02, METALS[2], 0);
    }
  }),
];

export const ARMS_PROPS: PropDef[] = [...racks, ...armour, ...banners, ...siege];



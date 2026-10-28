// Copied from Dungeon (src/render/props-arms.ts) by scripts/sync-dungeon-library.mjs, Dungeon 509abc4. Change it there and run the script again.
import { circle, radial, linear } from "./propkit";
import { WOODS, METALS, CLOTHS, GOLD, cross, vary, family, ell, poly, fo, box, cbox, disc, plank, stroke, scatter, type C, type Tone } from "./propvariants";
import type { PropDef } from "./propkit";

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
  ...family({ id: "sword-rack", name: "Sword rack", category: A, group: "Racks", w: 1.4, h: 0.5, layer: "object" }, cross(THREE_WOODS, FULL_SPARSE), (c, v) => {
    box(c, -0.66, -0.06, 1.32, 0.12, v.a, 0.02);
    const n = v.b.key === "full" ? 6 : 2;
    for (let i = 0; i < n; i++) sword(c, -0.5 + i * 0.2, 0, 0.42);
  }),
  ...family({ id: "spear-rack", name: "Spear rack", category: A, group: "Racks", w: 0.8, h: 0.8, layer: "object" }, THREE_WOODS, (c, v) => {
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
  ...family({ id: "bow-rack", name: "Bow rack", category: A, group: "Racks", w: 1.4, h: 0.4, layer: "object" }, THREE_WOODS, (c, v) => {
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
  ...family({ id: "shield-rack", name: "Shield rack", category: A, group: "Racks", w: 1.6, h: 0.5, layer: "object" }, SHIELD_COLORS, (c, v) => {
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
  ...family({ id: "armour-stand", name: "Armour stand", category: A, group: "Armour", w: 0.8, h: 0.8, layer: "object" }, cross(METALS, [vary("plate"), vary("mail")]), (c, v) => armourStand(c, v.a, v.b.key === "mail")),
  ...family({ id: "helmet-shelf", name: "Helmet shelf", category: A, group: "Armour", w: 1.4, h: 0.4, layer: "object" }, METALS.slice(0, 3), (c, v) => {
    plank(c, -0.66, -0.16, 1.32, 0.32, WOODS[2], 4511);
    for (const x of [-0.4, 0, 0.4]) {
      disc(c, x, 0, 0.13, v);
      stroke(c, [x - 0.08, 0.02, x + 0.08, 0.02], 0.025, "#1a1410");
    }
  }),
  ...family({ id: "round-shield", name: "Round shield", category: A, group: "Armour", w: 0.7, h: 0.7, layer: "object" }, SHIELD_COLORS, (c, v) => shield(c, 0, 0, 0.32, v)),
];

const banners: PropDef[] = [
  ...family({ id: "war-banner", name: "War banner", category: A, group: "Banners and standards", w: 1, h: 0.6, layer: "canopy" }, cross(CLOTHS, [vary("plain"), vary("emblem", "with an emblem")]), (c, v) => {
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
  ...family({ id: "ballista", name: "Ballista", category: A, group: "Siege and defence", w: 2, h: 1.6, layer: "object" }, THREE_WOODS, (c, v) => {
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
  ...family({ id: "catapult", name: "Catapult", category: A, group: "Siege and defence", w: 2.4, h: 1.6, layer: "object" }, THREE_WOODS.slice(0, 2), (c, v) => {
    for (const y of [-0.6, 0.6]) plank(c, -1.1, y - 0.08, 2.2, 0.16, v, 4611 + y);
    for (const x of [-0.9, 0.9]) for (const y of [-0.72, 0.72]) disc(c, x, y, 0.16, tone("#4a3a2a", "#1a120c"));
    plank(c, -0.08, -0.6, 0.16, 1.2, v, 4613);
    stroke(c, [0, 0, 0.95, 0], 0.08, v.dark);
    disc(c, 1, 0, 0.18, tone("#8a7a62", "#4a3e2e"));
  }),
  ...family({ id: "barricade", name: "Barricade", category: A, group: "Siege and defence", w: 2, h: 0.8, layer: "object" }, [vary("spiked"), vary("planked"), vary("carts", "of carts and crates")], (c, v) => {
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
  ...family({ id: "caltrops", name: "Caltrops", category: A, group: "Siege and defence", w: 1.2, h: 1, layer: "floor" }, [vary("scattered"), vary("patch", "dense patch")], (c, v) => {
    for (const [x, y, k] of scatter(v.key === "scattered" ? 10 : 24, v.key === "scattered" ? 0.48 : 0.32, 4631)) {
      for (let i = 0; i < 3; i++) {
        const a = k * 6 + (i / 3) * Math.PI * 2;
        stroke(c, [x, y, x + Math.cos(a) * 0.05, y + Math.sin(a) * 0.05], 0.015, IRON.dark);
      }
    }
  }),
  ...family({ id: "arrow-bundle", name: "Bundle of arrows", category: A, group: "Siege and defence", w: 0.9, h: 0.4, layer: "object" }, [vary("few"), vary("many")], (c, v) => {
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
  ...family({ id: "quiver", name: "Quiver", category: A, group: "Siege and defence", w: 0.5, h: 0.4, layer: "object" }, [vary("brown", "brown leather"), vary("black", "black leather")], (c, v) => {
    ell(c, 0, 0, 0.18, 0.12);
    fo(c, radial(c, 0, 0, 0.18, v.key === "brown" ? "#9a6a3e" : "#55504a", v.key === "brown" ? "#4a2e18" : "#1a1816"));
    for (const [x, y] of scatter(7, 0.08, 4641)) disc(c, x, y, 0.02, tone("#f0e6d0", "#b4a682"), 0.005);
  }),
  ...family({ id: "war-drum", name: "War drum", category: A, group: "Siege and defence", w: 0.9, h: 0.9, layer: "object" }, [vary("pale", "pale hide"), vary("dark", "dark hide"), vary("painted", "painted hide")], (c, v) => {
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



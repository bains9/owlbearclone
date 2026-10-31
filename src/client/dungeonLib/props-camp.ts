// Copied from Dungeon (src/render/props-camp.ts) by scripts/sync-dungeon-library.mjs, Dungeon 9bae40f. Change it there and run the script again.
import { rr, circle, radial, linear } from "./propkit";
import { WOODS, METALS, MASONRY, CLOTHS, cross, vary, family, shade, ell, poly, fo, box, cbox, disc, plank, drape, stroke, scatter, type C, type Tone, type Variant } from "./propvariants";
import type { PropDef } from "./propkit";

// Camps and the open road for the big library: tents, wagons and carts, fences and gates,
// signs and banners, market stalls, small boats and bridges, and training ground things.

const K = "Camp & outdoors" as const;
const IRON = METALS[0];
const tone = (light: string, dark: string): Tone => ({ key: "", name: "", light, dark });
const CANVAS = tone("#efe6cc", "#b4a682");
const SIZES = [vary("small"), vary("large")];

/** A ridge tent from above: two sloping sides meeting at a ridge. */
function ridgeTent(c: C, w: number, h: number, t: Tone): void {
  poly(c, [-w / 2, -h / 2, w / 2, -h / 2, w / 2, 0, -w / 2, 0]);
  fo(c, linear(c, 0, -h / 2, 0, 0, t.light, shade(t.light, -0.1)));
  poly(c, [-w / 2, 0, w / 2, 0, w / 2, h / 2, -w / 2, h / 2]);
  fo(c, linear(c, 0, 0, 0, h / 2, t.dark, shade(t.dark, -0.2)));
  stroke(c, [-w / 2 - 0.08, 0, w / 2 + 0.08, 0], 0.04, WOODS[2].dark);
  poly(c, [-w / 2, -0.12, -w / 2 - 0.12, 0, -w / 2, 0.12]);
  fo(c, "#2a1e14", 0.012);
}

const camp: PropDef[] = [
  ...family({ id: "tent-canvas", name: "Tent", category: K, group: "Camp", w: 2, h: 1.6, layer: "canopy" }, cross(CLOTHS, SIZES), (c, v) => {
    const k = v.b.key === "small" ? 0.7 : 1;
    ridgeTent(c, 1.9 * k, 1.5 * k, v.a);
  }, { size: (v) => (v.b.key === "small" ? [1.5, 1.2] : [2.1, 1.7]) }),
  ...family({ id: "pavilion", name: "Pavilion", category: K, group: "Camp", w: 3, h: 3, layer: "canopy" }, CLOTHS, (c, v) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      poly(c, [0, 0, Math.cos(a0) * 1.4, Math.sin(a0) * 1.4, Math.cos(a1) * 1.4, Math.sin(a1) * 1.4]);
      fo(c, i % 2 ? v.light : v.key === "white" ? "#d8d0bc" : "#f4efe2", 0.02);
    }
    disc(c, 0, 0, 0.1, tone("#f6dc78", "#a8801e"));
  }),
  ...family({ id: "lean-to", name: "Lean-to", category: K, group: "Camp", w: 1.8, h: 1.2, layer: "canopy" }, WOODS.filter((w) => ["pale", "walnut", "weathered"].includes(w.key)), (c, v) => {
    for (let i = 0; i < 7; i++) plank(c, -0.85 + i * 0.245, -0.55, 0.22, 1.1, v, 1100 + i);
    stroke(c, [-0.9, -0.45, 0.9, -0.45], 0.05, shade(v.dark, -0.2));
  }),
  ...family({ id: "bedroll", name: "Bedroll", category: K, group: "Camp", w: 0.8, h: 1.9, layer: "floor" }, CLOTHS, (c, v) => {
    rr(c, -0.34, -0.88, 0.68, 1.76, 0.18);
    fo(c, linear(c, -0.3, 0, 0.3, 0, v.light, v.dark), 0.02);
    rr(c, -0.3, -0.84, 0.6, 0.3, 0.1);
    fo(c, CANVAS.light, 0.015);
  }),
  ...family({ id: "hammock", name: "Hammock", category: K, group: "Camp", w: 2.4, h: 0.8, layer: "object" }, CLOTHS.filter((t) => ["crimson", "navy", "green", "ochre"].includes(t.key)), (c, v) => {
    stroke(c, [-1.15, 0, -0.8, 0], 0.025, "#6a5030");
    stroke(c, [0.8, 0, 1.15, 0], 0.025, "#6a5030");
    ell(c, 0, 0, 0.82, 0.3);
    fo(c, linear(c, 0, -0.3, 0, 0.3, v.light, v.dark), 0.02);
    c.strokeStyle = "rgba(255,255,255,0.35)";
    c.lineWidth = 0.02;
    for (let x = -0.6; x <= 0.6; x += 0.2) {
      c.beginPath();
      c.moveTo(x, -0.26);
      c.lineTo(x, 0.26);
      c.stroke();
    }
  }),
  ...family({ id: "camp-gear", name: "Camp gear", category: K, group: "Camp", w: 1.2, h: 1, layer: "object" }, [vary("cooking", "cooking tripod"), vary("supplies"), vary("packs", "packs and rolls")], (c, v) => {
    if (v.key === "cooking") {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        stroke(c, [0, 0, Math.cos(a) * 0.42, Math.sin(a) * 0.42], 0.04, WOODS[2].dark);
      }
      disc(c, 0, 0, 0.18, IRON);
      circle(c, 0, 0, 0.13);
      c.fillStyle = radial(c, 0, 0, 0.13, "#c8803a", "#6a3a14");
      c.fill();
    } else if (v.key === "supplies") {
      cbox(c, -0.25, 0, 0.4, 0.4, WOODS[1], 0.03);
      for (const [x, y] of [[0.22, -0.15], [0.25, 0.2]] as const) {
        ell(c, x, y, 0.16, 0.13);
        fo(c, radial(c, x, y, 0.16, "#c8a878", "#7a5a32"), 0.015);
      }
    } else {
      for (const [x, y, t] of [[-0.25, 0, CLOTHS[2]], [0.2, -0.12, CLOTHS[3]]] as const) {
        rr(c, x - 0.18, y - 0.22, 0.36, 0.44, 0.1);
        fo(c, radial(c, x, y, 0.3, t.light, t.dark), 0.015);
      }
      rr(c, 0.05, 0.18, 0.5, 0.18, 0.08);
      fo(c, CLOTHS[1].light, 0.015);
    }
  }),
];

/** A wagon or cart from above. */
function wagon(c: C, w: number, h: number, wood: Tone, cover?: Tone, cargo = false, wheels = 4): void {
  const ws: [number, number][] = wheels === 4 ? [[-w * 0.32, -h / 2], [w * 0.32, -h / 2], [-w * 0.32, h / 2], [w * 0.32, h / 2]] : [[0, -h / 2], [0, h / 2]];
  for (const [x, y] of ws) cbox(c, x, y, 0.36, 0.1, tone("#4a3a2a", "#1a120c"), 0.03);
  box(c, -w / 2, -h / 2 + 0.06, w, h - 0.12, wood, 0.04);
  stroke(c, [w / 2, 0, w / 2 + 0.45, 0], 0.05, wood.dark);
  if (cover) {
    rr(c, -w / 2 + 0.04, -h / 2 + 0.02, w - 0.08, h - 0.04, 0.2);
    fo(c, linear(c, 0, -h / 2, 0, h / 2, cover.light, cover.dark), 0.02);
    c.strokeStyle = "rgba(0,0,0,0.15)";
    c.lineWidth = 0.02;
    for (let x = -w / 2 + 0.25; x < w / 2; x += 0.35) {
      c.beginPath();
      c.moveTo(x, -h / 2 + 0.05);
      c.lineTo(x, h / 2 - 0.05);
      c.stroke();
    }
  } else if (cargo) {
    rr(c, -w / 2 + 0.08, -h / 2 + 0.14, w - 0.16, h - 0.28, 0.03);
    fo(c, shade(wood.dark, -0.35), 0.012);
    for (const [x, y, k] of scatter(6, Math.min(w, h) * 0.3, 1201)) {
      if (k > 0.5) cbox(c, x * 1.4, y, 0.24, 0.22, WOODS[0], 0.02);
      else {
        ell(c, x * 1.4, y, 0.13, 0.11);
        fo(c, radial(c, x * 1.4, y, 0.13, "#c8a878", "#7a5a32"), 0.012);
      }
    }
  }
}

const OPEN_OR_COVERED = [vary("covered"), vary("open", "open, loaded")];

const wagons: PropDef[] = [
  ...family({ id: "wagon", name: "Wagon", category: K, group: "Wagons and carts", w: 3, h: 1.6, layer: "object" }, cross(WOODS, OPEN_OR_COVERED), (c, v) =>
    wagon(c, 2.3, 1.3, v.a, v.b.key === "covered" ? CANVAS : undefined, v.b.key === "open"),
  ),
  ...family({ id: "handcart", name: "Handcart", category: K, group: "Wagons and carts", w: 1.8, h: 1.1, layer: "object" }, cross(WOODS, [vary("empty"), vary("loaded")]), (c, v) =>
    wagon(c, 1.1, 0.9, v.a, undefined, v.b.key === "loaded", 2),
  ),
  ...family({ id: "carriage", name: "Carriage", category: K, group: "Wagons and carts", w: 3, h: 1.6, layer: "object" }, CLOTHS.filter((t) => ["black", "navy", "crimson", "green"].includes(t.key)), (c, v) => {
    wagon(c, 2.2, 1.3, WOODS[3]);
    rr(c, -0.8, -0.5, 1.6, 1, 0.12);
    fo(c, linear(c, 0, -0.5, 0, 0.5, v.light, v.dark), 0.025);
    stroke(c, [-0.8, 0, 0.8, 0], 0.025, "#d4b04a");
  }),
];

const fences: PropDef[] = [
  ...family({ id: "rail-fence", name: "Rail fence", category: K, group: "Fences and gates", w: 2, h: 0.4, layer: "object" }, cross(WOODS, [vary("straight"), vary("broken")]), (c, v) => {
    for (const x of [-0.9, 0, 0.9]) disc(c, x, 0, 0.07, v.a, 0.012);
    if (v.b.key === "broken") {
      stroke(c, [-0.9, -0.04, 0, -0.04], 0.06, v.a.light, "butt");
      stroke(c, [0, 0.06, 0.55, 0.22], 0.06, v.a.dark, "butt");
    } else for (const y of [-0.05, 0.05]) stroke(c, [-0.95, y, 0.95, y], 0.06, y < 0 ? v.a.light : v.a.dark, "butt");
  }),
  ...family({ id: "picket-fence", name: "Picket fence", category: K, group: "Fences and gates", w: 2, h: 0.3, layer: "object" }, [vary("white"), vary("pale", "pale wood"), vary("weathered", "weathered wood")], (c, v) => {
    const t = v.key === "white" ? tone("#fbf8f0", "#c8c2b4") : WOODS.find((w) => w.key === v.key)!;
    stroke(c, [-0.98, 0, 0.98, 0], 0.04, t.dark, "butt");
    for (let x = -0.92; x <= 0.92; x += 0.16) cbox(c, x, 0, 0.07, 0.16, t, 0.01);
  }),
  ...family({ id: "field-gate", name: "Field gate", category: K, group: "Fences and gates", w: 1.6, h: 0.4, layer: "object" }, WOODS, (c, v) => {
    for (const x of [-0.75, 0.75]) disc(c, x, 0, 0.09, v, 0.012);
    for (const y of [-0.08, 0, 0.08]) stroke(c, [-0.66, y, 0.66, y], 0.04, y ? v.light : v.dark, "butt");
    stroke(c, [-0.66, 0.08, 0.66, -0.08], 0.04, v.dark, "butt");
  }),
  ...family({ id: "garden-wall", name: "Garden wall", category: K, group: "Fences and gates", w: 2, h: 0.5, layer: "object" }, cross(MASONRY, [vary("whole"), vary("tumbled", "tumbled down")]), (c, v) => {
    const n = v.b.key === "whole" ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const x = -0.85 + i * 0.34;
      cbox(c, x, (i % 2) * 0.04 - 0.02, 0.32, 0.36, v.a, 0.04);
    }
    if (v.b.key === "tumbled") for (const [x, y] of scatter(5, 0.2, 1301)) cbox(c, 0.6 + x, y, 0.16, 0.12, v.a, 0.03);
  }),
];

const signs: PropDef[] = [
  ...family({ id: "fingerpost", name: "Fingerpost", category: K, group: "Signs and banners", w: 1.2, h: 1.2, layer: "object" }, [vary("one", "one arm"), vary("two", "two arms"), vary("three", "three arms")], (c, v) => {
    const n = v.key === "one" ? 1 : v.key === "two" ? 2 : 3;
    for (let i = 0; i < n; i++) {
      c.save();
      c.rotate(i * 2.1 - 0.4);
      poly(c, [0, -0.07, 0.42, -0.07, 0.52, 0, 0.42, 0.07, 0, 0.07]);
      fo(c, linear(c, 0, -0.07, 0, 0.07, WOODS[0].light, WOODS[0].dark), 0.015);
      c.restore();
    }
    disc(c, 0, 0, 0.08, WOODS[2]);
  }),
  ...family({ id: "banner-pole", name: "Banner on a pole", category: K, group: "Signs and banners", w: 1, h: 0.6, layer: "canopy" }, CLOTHS, (c, v) => {
    disc(c, -0.38, 0, 0.06, WOODS[2]);
    poly(c, [-0.34, -0.2, 0.42, -0.2, 0.3, 0, 0.42, 0.2, -0.34, 0.2]);
    fo(c, linear(c, -0.3, 0, 0.4, 0, v.light, v.dark), 0.02);
  }),
  ...family({ id: "milestone", name: "Milestone", category: K, group: "Signs and banners", w: 0.5, h: 0.4, layer: "object" }, MASONRY.slice(0, 3), (c, v) => {
    rr(c, -0.22, -0.17, 0.44, 0.34, 0.12);
    fo(c, radial(c, 0, 0, 0.25, v.light, v.dark));
    stroke(c, [-0.1, 0, 0.1, 0], 0.02, "rgba(0,0,0,0.45)");
  }),
];

const GOODS: (Variant & { colors: string[] })[] = [
  { key: "pots", name: "pots", colors: ["#d0784a", "#6a9ad0", "#efe2c4"] },
  { key: "cloth", name: "cloth", colors: ["#c8403c", "#3e5e9e", "#dca646", "#52a056"] },
  { key: "fish", name: "fish", colors: ["#a8b4bc", "#7a8a94"] },
  { key: "produce", name: "produce", colors: ["#d83a2a", "#8ab43a", "#f08a1a"] },
  { key: "trinkets", name: "trinkets", colors: ["#f6dc78", "#f0f2f6", "#ff6a5a", "#6aa8ff"] },
  { key: "blades", name: "blades", colors: ["#d8dce4", "#9a9ea8"] },
];

const market: PropDef[] = [
  ...family({ id: "stall-awning", name: "Market stall", category: K, group: "Market", w: 2.2, h: 1.6, layer: "canopy" }, CLOTHS, (c, v) => {
    box(c, -1, -0.7, 2, 1.4, WOODS[1], 0.04);
    for (let i = 0; i < 6; i++) {
      c.fillStyle = i % 2 ? v.light : v.key === "white" ? "#d8d0bc" : "#f4efe2";
      c.fillRect(-1 + (i * 2) / 6, -0.75, 2 / 6, 1.5);
    }
    c.strokeStyle = "#1e1712";
    c.lineWidth = 0.035;
    c.strokeRect(-1, -0.75, 2, 1.5);
  }),
  ...family({ id: "stall-table", name: "Stall table", category: K, group: "Market", w: 1.8, h: 0.8, layer: "object" }, GOODS, (c, v) => {
    plank(c, -0.86, -0.36, 1.72, 0.72, WOODS[0], 1401);
    drape(c, -0.86, 0.2, 1.72, 0.18, CLOTHS[0], 2);
    for (const [x, y, k] of scatter(9, 0.25, 1403)) {
      const col = v.colors[Math.floor(k * v.colors.length)];
      if (v.key === "blades") stroke(c, [x * 2.5 - 0.15, y, x * 2.5 + 0.15, y], 0.03, col);
      else if (v.key === "cloth") cbox(c, x * 2.5, y, 0.22, 0.14, tone(shade(col, 0.2), shade(col, -0.2)), 0.02);
      else disc(c, x * 2.5, y, 0.07, tone(shade(col, 0.3), shade(col, -0.2)), 0.01);
    }
  }),
];

const water: PropDef[] = [
  ...family({ id: "skiff", name: "Skiff", category: K, group: "Boats and bridges", w: 2.6, h: 1, layer: "object" }, WOODS, (c, v) => {
    c.beginPath();
    c.moveTo(-1.25, 0);
    c.quadraticCurveTo(-0.8, -0.46, 0.6, -0.42);
    c.lineTo(1.2, 0);
    c.lineTo(0.6, 0.42);
    c.quadraticCurveTo(-0.8, 0.46, -1.25, 0);
    c.closePath();
    fo(c, linear(c, 0, -0.45, 0, 0.45, v.light, v.dark));
    for (const x of [-0.4, 0.3]) stroke(c, [x, -0.36, x, 0.36], 0.06, shade(v.dark, -0.2), "butt");
  }),
  ...family({ id: "canoe", name: "Canoe", category: K, group: "Boats and bridges", w: 2.8, h: 0.6, layer: "object" }, WOODS.slice(0, 4), (c, v) => {
    ell(c, 0, 0, 1.35, 0.26);
    fo(c, linear(c, 0, -0.26, 0, 0.26, v.light, v.dark));
    ell(c, 0, 0, 1.15, 0.17);
    fo(c, shade(v.dark, -0.3), 0.012);
  }),
  ...family({ id: "footbridge", name: "Footbridge", category: K, group: "Boats and bridges", w: 3, h: 1.2, layer: "floor" }, cross(WOODS.filter((w) => ["pale", "walnut", "weathered"].includes(w.key)), [vary("short"), vary("long")]), (c, v) => {
    const L = v.b.key === "short" ? 1.9 : 2.9;
    for (let x = -L / 2; x < L / 2 - 0.05; x += 0.22) plank(c, x, -0.5, 0.2, 1, v.a, 1500 + x * 10);
    for (const y of [-0.52, 0.52]) stroke(c, [-L / 2, y, L / 2, y], 0.06, shade(v.a.dark, -0.2));
  }, { size: (v) => (v.b.key === "short" ? [2, 1.2] : [3, 1.2]) }),
];

const training: PropDef[] = [
  ...family({ id: "training-dummy", name: "Training dummy", category: K, group: "Games and training", w: 0.8, h: 0.6, layer: "object" }, [vary("straw"), vary("sacking"), vary("armoured")], (c, v) => {
    stroke(c, [-0.35, 0, 0.35, 0], 0.06, WOODS[2].dark);
    const body = v.key === "straw" ? tone("#ecd68a", "#a8883a") : v.key === "sacking" ? tone("#c8a878", "#7a5a32") : IRON;
    ell(c, 0, 0, 0.2, 0.16);
    fo(c, radial(c, 0, 0, 0.2, body.light, body.dark));
    disc(c, 0, -0.05, 0.08, tone("#ecd68a", "#a8883a"), 0.012);
  }),
  ...family({ id: "archery-butt", name: "Archery butt", category: K, group: "Games and training", w: 1, h: 0.5, layer: "object" }, [vary("round"), vary("square")], (c, v) => {
    if (v.key === "round") ell(c, 0, 0, 0.45, 0.2);
    else rr(c, -0.45, -0.2, 0.9, 0.4, 0.06);
    fo(c, linear(c, 0, -0.2, 0, 0.2, "#ecd68a", "#a8883a"));
    for (const [r, col] of [[0.15, "#f4f0e6"], [0.1, "#c8403c"], [0.05, "#f6dc78"]] as const) {
      ell(c, 0, 0, r, r * 0.45);
      fo(c, col, 0.01);
    }
  }),
];

export const CAMP_PROPS: PropDef[] = [...camp, ...wagons, ...fences, ...signs, ...market, ...water, ...training];

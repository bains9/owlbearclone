// Copied from Dungeon (src/render/propvariants.ts) by scripts/sync-dungeon-library.mjs, Dungeon 9bae40f. Change it there and run the script again.
import { rng } from "./noise";
import { hexToRgb, mix, rgbToHex } from "./color";
import { LW, outline, rr, circle, radial, linear, board, flame, type PropCategory, type PropDef } from "./propkit";

// The kit behind the big library (27 October 2026): most designs come in several variants
// (woods, stones, metals, cloths, glows, states), made by `family` from one drawing function.
// Ids are "<design>-<variant>" and names "<Design>, <variant>", so search finds either part.
//
// Ids must suit table.parhome.ca's Seasons, which read a role from the words of an id: a
// made thing never carries a growing or natural word (no "oak", "cherry", "rose", "stone",
// "trunk", "canopy"...), so woods here are "honey" or "walnut", and stone is "granite".

export type C = CanvasRenderingContext2D;

/** A colour pair: the lit and the shaded side of a material. */
export interface Tone {
  key: string;
  name: string;
  light: string;
  dark: string;
}

export const WOODS: Tone[] = [
  { key: "pale", name: "pale wood", light: "#d6b47e", dark: "#98754a" },
  { key: "honey", name: "honey wood", light: "#c48c4c", dark: "#7f552c" },
  { key: "walnut", name: "walnut", light: "#8c6040", dark: "#523421" },
  { key: "ebony", name: "ebony", light: "#5c4a3e", dark: "#2a1f19" },
  { key: "mahogany", name: "mahogany", light: "#a04e34", dark: "#5c2618" },
  { key: "weathered", name: "weathered wood", light: "#aaa08e", dark: "#6b6254" },
];

export const MASONRY: Tone[] = [
  { key: "granite", name: "granite", light: "#b8b6b0", dark: "#6c6a66" },
  { key: "marble", name: "marble", light: "#f2efe8", dark: "#bab5ab" },
  { key: "sandstone", name: "sandstone", light: "#dec596", dark: "#a5875a" },
  { key: "slate", name: "slate", light: "#808894", dark: "#434952" },
  { key: "basalt", name: "basalt", light: "#5e5c5a", dark: "#262524" },
];

export const METALS: Tone[] = [
  { key: "iron", name: "iron", light: "#a6a7ae", dark: "#3c3d43" },
  { key: "bronze", name: "bronze", light: "#d49c5a", dark: "#784c20" },
  { key: "brass", name: "brass", light: "#ead070", dark: "#987826" },
  { key: "silver", name: "silver", light: "#f0f2f6", dark: "#8a909a" },
];

export const GOLD: Tone = { key: "gold", name: "gold", light: "#f6dc78", dark: "#a8801e" };

export const CLOTHS: Tone[] = [
  { key: "crimson", name: "crimson", light: "#c8403c", dark: "#781c1c" },
  { key: "navy", name: "navy", light: "#3e5e9e", dark: "#1c2c55" },
  { key: "green", name: "green", light: "#52a056", dark: "#245a2a" },
  { key: "ochre", name: "ochre", light: "#dca646", dark: "#94661c" },
  { key: "violet", name: "violet", light: "#8e5eb8", dark: "#4c2a6e" },
  { key: "black", name: "black", light: "#4c4c52", dark: "#18181c" },
  { key: "white", name: "white", light: "#f6f2e8", dark: "#c6beac" },
  { key: "teal", name: "teal", light: "#3ea4a2", dark: "#1a5c5e" },
];

/** Clay and pottery. */
export const CLAYS: Tone[] = [
  { key: "terracotta", name: "terracotta", light: "#d0784a", dark: "#8a4424" },
  { key: "glazed-blue", name: "blue glaze", light: "#6a9ad0", dark: "#2c4c80" },
  { key: "glazed-green", name: "green glaze", light: "#7ab88a", dark: "#2e6a40" },
  { key: "cream", name: "cream", light: "#efe2c4", dark: "#bba886" },
];

/** Glass and liquids: potions, bottles, jars. */
export const GLASSES: Tone[] = [
  { key: "red", name: "red", light: "#ff6a5a", dark: "#8a1a14" },
  { key: "blue", name: "blue", light: "#6aa8ff", dark: "#1a3a8a" },
  { key: "green", name: "green", light: "#6ae08a", dark: "#1a6a32" },
  { key: "purple", name: "purple", light: "#c08aff", dark: "#4a1a8a" },
  { key: "amber", name: "amber", light: "#ffc25a", dark: "#8a5a10" },
  { key: "clear", name: "clear", light: "#e8f4ff", dark: "#8aa4b8" },
];

/** Light colours for flames and magic: a variant, plus the light it brings. */
export interface Glow extends Tone {
  rgb: string;
  color: string;
}

export const GLOWS: Glow[] = [
  { key: "fire", name: "firelight", light: "#fff2b0", dark: "#ff7a1a", rgb: "255,170,80", color: "#ffb46a" },
  { key: "blue", name: "blue flame", light: "#e6f2ff", dark: "#3a7aff", rgb: "120,170,255", color: "#8ab0ff" },
  { key: "green", name: "green flame", light: "#eaffea", dark: "#2ac05a", rgb: "120,230,140", color: "#8af0a0" },
  { key: "violet", name: "violet flame", light: "#f6e8ff", dark: "#9a4aff", rgb: "200,130,255", color: "#c89aff" },
];

export interface Variant {
  key: string;
  name: string;
}

/** A plain variant: a key and a name (the key, if no name is given). */
export const vary = (key: string, name = key.replace(/-/g, " ")): Variant => ({ key, name });

/** Every pairing of two lists of variants: keys "walnut-set", names "walnut, set". */
export function cross<A extends Variant, B extends Variant>(a: A[], b: B[]): (Variant & { a: A; b: B })[] {
  return a.flatMap((x) => b.map((y) => ({ key: `${x.key}-${y.key}`, name: `${x.name}, ${y.name}`, a: x, b: y })));
}

export interface FamilySpec {
  id: string;
  name: string;
  category: PropCategory;
  group: string;
  w: number;
  h: number;
  layer: PropDef["layer"];
  light?: PropDef["light"];
}

/** One design in every variant: ids "<id>-<variant>", names "<Name>, <variant>". */
export function family<V extends Variant>(
  spec: FamilySpec,
  variants: V[],
  draw: (c: C, v: V) => void,
  more: { size?: (v: V) => [number, number]; light?: PropDef["light"] | ((v: V) => PropDef["light"]) } = {},
): PropDef[] {
  return variants.map((v) => {
    const [w, h] = more.size?.(v) ?? [spec.w, spec.h];
    const light = typeof more.light === "function" ? more.light(v) : (more.light ?? spec.light);
    return {
      id: `${spec.id}-${v.key}`,
      name: `${spec.name}, ${v.name}`,
      category: spec.category,
      group: spec.group,
      w,
      h,
      layer: spec.layer,
      ...(light ? { light } : {}),
      draw: (c: C) => draw(c, v),
    };
  });
}

/** The light a glow variant brings, at a radius and brightness. */
export const glowLight = (g: Glow, radius: number, intensity = 1): PropDef["light"] => ({ radius, color: g.color, intensity });

// ---- Drawing shortcuts ----

/** A colour between two, or lighter (k > 0) or darker (k < 0) than one. */
export function shade(hex: string, k: number): string {
  return rgbToHex(mix(hexToRgb(hex), k > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(k)));
}

export function ell(c: C, x: number, y: number, rx: number, ry: number, rot = 0): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

export function poly(c: C, pts: number[]): void {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i ? c.lineTo(pts[i], pts[i + 1]) : c.moveTo(pts[i], pts[i + 1]));
  c.closePath();
}

/** Fills the current path, then outlines it. */
export function fo(c: C, fill: string | CanvasGradient, w = LW): void {
  c.fillStyle = fill;
  c.fill();
  outline(c, w);
}

/** A rounded box, lit from the top left. */
export function box(c: C, x: number, y: number, w: number, h: number, t: Tone, r = 0.04): void {
  rr(c, x, y, w, h, r);
  fo(c, linear(c, x, y, x + w * 0.3, y + h, t.light, t.dark));
}

/** A box centred on (x, y). */
export function cbox(c: C, x: number, y: number, w: number, h: number, t: Tone, r = 0.04): void {
  box(c, x - w / 2, y - h / 2, w, h, t, r);
}

/** A round thing, lit from the top left. */
export function disc(c: C, x: number, y: number, r: number, t: Tone, w = LW): void {
  circle(c, x, y, r);
  fo(c, radial(c, x, y, r, t.light, t.dark), w);
}

/** A wooden board of a wood tone, grain along its length. */
export function plank(c: C, x: number, y: number, w: number, h: number, t: Tone, seed = 1): void {
  board(c, x, y, w, h, t.light, t.dark, seed);
}

/** A soft round glow. */
export function glow(c: C, x: number, y: number, r: number, rgb: string, a = 0.55): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  circle(c, x, y, r);
  c.fill();
}

/** A flame in a glow's colours. */
export function coloredFlame(c: C, x: number, y: number, r: number, g: Glow): void {
  if (g.key === "fire") return flame(c, x, y, r);
  glow(c, x, y, r * 2.2, g.rgb, 0.55);
  c.fillStyle = radial(c, x, y, r, g.light, g.dark);
  c.beginPath();
  c.moveTo(x, y - r * 1.3);
  c.bezierCurveTo(x + r, y - r * 0.2, x + r * 0.8, y + r, x, y + r);
  c.bezierCurveTo(x - r * 0.8, y + r, x - r, y - r * 0.2, x, y - r * 1.3);
  c.fill();
}

/** An open line through points. */
export function stroke(c: C, pts: number[], width: number, color: string, cap: CanvasLineCap = "round"): void {
  c.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i ? c.lineTo(pts[i], pts[i + 1]) : c.moveTo(pts[i], pts[i + 1]));
  c.lineWidth = width;
  c.strokeStyle = color;
  c.lineCap = cap;
  c.lineJoin = "round";
  c.stroke();
}

/** Cloth draped over a rectangle: a soft fill with a fold or two. */
export function drape(c: C, x: number, y: number, w: number, h: number, t: Tone, seed = 1): void {
  rr(c, x, y, w, h, Math.min(w, h) * 0.12);
  fo(c, linear(c, x, y, x + w, y + h, t.light, t.dark), 0.02);
  const r = rng(seed);
  c.strokeStyle = "rgba(0,0,0,0.18)";
  c.lineWidth = 0.02;
  for (let i = 0; i < 2; i++) {
    const fx = x + w * (0.25 + r() * 0.5);
    c.beginPath();
    c.moveTo(fx, y + h * 0.1);
    c.quadraticCurveTo(fx + w * 0.08, y + h * 0.5, fx - w * 0.04, y + h * 0.9);
    c.stroke();
  }
}

/** A plate (with something on it, if `food` is a colour). */
export function plate(c: C, x: number, y: number, r: number, food?: string): void {
  circle(c, x, y, r);
  fo(c, radial(c, x, y, r, "#fbf7ee", "#cfc6b4"), 0.015);
  if (food) {
    circle(c, x, y, r * 0.55);
    fo(c, radial(c, x, y, r * 0.55, shade(food, 0.3), food), 0.012);
  }
}

/** A row of book spines seen from above, filling a shelf. */
export function bookRow(c: C, x: number, y: number, w: number, h: number, seed: number): void {
  const r = rng(seed);
  const colors = ["#7a2a22", "#2a4a7a", "#2a6a3a", "#7a6a2a", "#4a2a6a", "#5a3a22", "#8a8070"];
  let at = x;
  while (at < x + w - 0.02) {
    const bw = Math.min(x + w - at, 0.05 + r() * 0.07);
    c.fillStyle = colors[Math.floor(r() * colors.length)];
    c.fillRect(at, y + h * r() * 0.15, bw - 0.008, h * (0.85 + r() * 0.15));
    at += bw;
  }
}

/** Metal studs or rivets along a line. */
export function studs(c: C, x0: number, y0: number, x1: number, y1: number, n: number, r: number, t: Tone): void {
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    disc(c, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, r, t, 0.01);
  }
}

/** Scatters small things inside a circle, seeded, so a pile looks the same every time. */
export function scatter(n: number, radius: number, seed: number): [number, number, number][] {
  const r = rng(seed);
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * radius;
    out.push([Math.cos(a) * d, Math.sin(a) * d, r()]);
  }
  return out;
}

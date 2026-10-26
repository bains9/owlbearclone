// Copied from Dungeon (src/render/propkit.ts) by scripts/sync-dungeon-library.mjs, Dungeon 4445927. Change it there and run the script again.
import { rng } from "./noise";

// The drawing kit shared by every built-in prop: shapes, outlines, wood, foliage, flames, rocks.
// Props draw centred on (0, 0) in cell units.
export const PROP_CATEGORIES = ["Furniture", "Containers", "Kitchen & tavern", "Nature", "Camp & outdoors", "Dungeon", "Light"] as const;
export type PropCategory = (typeof PROP_CATEGORIES)[number];

export interface PropDef {
  id: string;
  name: string;
  category: PropCategory;
  w: number;
  h: number;
  layer: "floor" | "object" | "canopy";
  /** A light to add with it, for torches and fires. */
  light?: { radius: number; color: string; intensity: number };
  draw: (c: CanvasRenderingContext2D) => void;
}

export const OUT = "#1e1712";
export const LW = 0.035;

export function outline(c: CanvasRenderingContext2D, w = LW): void {
  c.lineWidth = w;
  c.strokeStyle = OUT;
  c.lineJoin = "round";
  c.stroke();
}

export function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

export function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

export function radial(c: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string): CanvasGradient {
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  return g;
}

export function linear(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, a: string, b: string): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

/** A wooden board with grain lines along its length. */
export function board(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, light: string, dark: string, seed: number): void {
  rr(c, x, y, w, h, Math.min(w, h) * 0.08);
  c.fillStyle = linear(c, x, y, x, y + h, light, dark);
  c.fill();
  const r = rng(seed);
  c.save();
  c.clip();
  c.strokeStyle = "rgba(40,24,12,0.35)";
  c.lineWidth = 0.012;
  const along = w >= h;
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    if (along) {
      const yy = y + h * (0.15 + r() * 0.7);
      c.moveTo(x, yy);
      c.bezierCurveTo(x + w * 0.3, yy + (r() - 0.5) * h * 0.2, x + w * 0.7, yy + (r() - 0.5) * h * 0.2, x + w, yy);
    } else {
      const xx = x + w * (0.15 + r() * 0.7);
      c.moveTo(xx, y);
      c.bezierCurveTo(xx + (r() - 0.5) * w * 0.2, y + h * 0.3, xx + (r() - 0.5) * w * 0.2, y + h * 0.7, xx, y + h);
    }
    c.stroke();
  }
  c.restore();
  rr(c, x, y, w, h, Math.min(w, h) * 0.08);
  outline(c);
}

export function flame(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const glow = c.createRadialGradient(x, y, 0, x, y, r * 2.2);
  glow.addColorStop(0, "rgba(255,200,80,0.55)");
  glow.addColorStop(1, "rgba(255,120,20,0)");
  c.fillStyle = glow;
  circle(c, x, y, r * 2.2);
  c.fill();
  c.fillStyle = radial(c, x, y, r, "#fff6c0", "#ff7a1a");
  c.beginPath();
  c.moveTo(x, y - r * 1.3);
  c.bezierCurveTo(x + r, y - r * 0.2, x + r * 0.8, y + r, x, y + r);
  c.bezierCurveTo(x - r * 0.8, y + r, x - r, y - r * 0.2, x, y - r * 1.3);
  c.fill();
}

export function canopy(c: CanvasRenderingContext2D, radius: number, seed: number, dark: string, mid: string, light: string): void {
  const r = rng(seed);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.5;
    const d = radius * (0.45 + r() * 0.2);
    blobs.push([Math.cos(a) * d, Math.sin(a) * d, radius * (0.42 + r() * 0.15)]);
  }
  blobs.push([0, 0, radius * 0.6]);
  c.fillStyle = dark;
  for (const [x, y, br] of blobs) {
    circle(c, x, y, br);
    c.fill();
  }
  for (const [x, y, br] of blobs) {
    c.fillStyle = radial(c, x - br * 0.15, y - br * 0.15, br * 0.85, light, mid);
    circle(c, x - br * 0.08, y - br * 0.08, br * 0.82);
    c.fill();
  }
  c.strokeStyle = "rgba(20,35,15,0.6)";
  c.lineWidth = 0.03;
  for (const [x, y, br] of blobs) {
    circle(c, x, y, br);
    c.stroke();
  }
}

export function rockShape(c: CanvasRenderingContext2D, rx: number, ry: number, seed: number): void {
  const r = rng(seed);
  const n = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.75 + r() * 0.25;
    pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
  }
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = radial(c, -rx * 0.2, -ry * 0.2, Math.max(rx, ry), "#a8a6a0", "#5e5c58");
  c.fill();
  outline(c);
  c.strokeStyle = "rgba(255,255,255,0.25)";
  c.lineWidth = 0.02;
  c.beginPath();
  c.moveTo(pts[5][0] * 0.6, pts[5][1] * 0.6);
  c.lineTo(pts[6][0] * 0.3, pts[6][1] * 0.2);
  c.lineTo(pts[7][0] * 0.6, pts[7][1] * 0.6);
  c.stroke();
}


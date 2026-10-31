// Spell effects that stay on the map (DrawingItem.fx), as the board draws them each frame: fog
// and clouds drifting, darkness, light, moonbeam, plants, spikes, a pit, water, a swirling
// pattern, and a marked zone with its spell's name. In map pixels, sized by the grid square
// (`cell`); their details drawn from a seed (the drawing's id), so every screen shows the same.

import { ZONE_LOOKS, type ZoneLook } from "../../shared/zones";
import { seeded } from "./spellfx";

export interface Zone {
  look: ZoneLook;
  shape: "circle" | "rect";
  /** Its middle and half its width and height. */
  x: number;
  y: number;
  rx: number;
  ry: number;
  seed: number;
  /** The spell's name, for a marked zone. */
  label?: string;
  /** Its caster's colour, for a marked zone's outline. */
  color: string;
}

/** A zone from a drawing's two corners. */
export function zoneOf(look: ZoneLook, shape: "ellipse" | "rect", points: readonly number[], seed: number, color: string, label?: string): Zone {
  const [x0, y0, x1, y1] = points;
  return {
    look,
    shape: shape === "ellipse" ? "circle" : "rect",
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    rx: Math.abs(x1 - x0) / 2,
    ry: Math.abs(y1 - y0) / 2,
    seed,
    color,
    ...(label ? { label } : {}),
  };
}

/** A string's seed, for a drawing's id. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The zone's outline as a path (not filled or stroked). */
export function zonePath(c: CanvasRenderingContext2D, z: Zone, grow = 0): void {
  c.beginPath();
  if (z.shape === "circle") c.ellipse(z.x, z.y, Math.max(0, z.rx + grow), Math.max(0, z.ry + grow), 0, 0, Math.PI * 2);
  else c.rect(z.x - z.rx - grow, z.y - z.ry - grow, 2 * (z.rx + grow), 2 * (z.ry + grow));
}

/** Whether a point is inside the zone. */
export function inZone(z: Zone, x: number, y: number): boolean {
  if (z.shape === "rect") return Math.abs(x - z.x) <= z.rx && Math.abs(y - z.y) <= z.ry;
  if (z.rx <= 0 || z.ry <= 0) return false;
  return ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2 <= 1;
}

/** The zone's edge as wall segments for sight: [x0, y0, x1, y1] each, a circle as 24 sides. */
export function zoneEdges(z: Zone): [number, number, number, number][] {
  const pts: [number, number][] = [];
  if (z.shape === "rect") {
    pts.push([z.x - z.rx, z.y - z.ry], [z.x + z.rx, z.y - z.ry], [z.x + z.rx, z.y + z.ry], [z.x - z.rx, z.y + z.ry]);
  } else {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push([z.x + z.rx * Math.cos(a), z.y + z.ry * Math.sin(a)]);
    }
  }
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return [p[0], p[1], q[0], q[1]];
  });
}

/** Points spread over the zone (in it), each with a few numbers of its own: for its details. */
function spots(z: Zone, n: number, per = 3): { x: number; y: number; r: number[] }[] {
  const rand = seeded(z.seed);
  const out: { x: number; y: number; r: number[] }[] = [];
  let tries = 0;
  while (out.length < n && tries++ < n * 4) {
    const u = rand() * 2 - 1;
    const v = rand() * 2 - 1;
    const r = Array.from({ length: per }, rand);
    if (z.shape === "circle" && u * u + v * v > 1) continue;
    out.push({ x: z.x + u * z.rx, y: z.y + v * z.ry, r });
  }
  return out;
}

/** How many details to draw for a zone: so many a square, within limits. */
function count(z: Zone, cell: number, perSquare: number, max: number): number {
  const squares = (4 * z.rx * z.ry) / (cell * cell);
  return Math.max(4, Math.min(max, Math.round(squares * perSquare)));
}

let puffCanvas: HTMLCanvasElement | null = null;

/** A soft, lumpy white puff (made once), drawn many times over for fog and clouds. */
function puff(): HTMLCanvasElement | null {
  if (puffCanvas || typeof document === "undefined") return puffCanvas;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d");
  if (!c) return null;
  const rand = seeded(97);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const d = size * 0.22 * Math.sqrt(rand());
    const x = size / 2 + d * Math.cos(a);
    const y = size / 2 + d * Math.sin(a);
    const r = size * (0.12 + 0.14 * rand());
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.32)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  puffCanvas = cv;
  return cv;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** A glow of `color` filling the zone, solid out to `solid` of the way and fading to its edge. */
function softFill(c: CanvasRenderingContext2D, z: Zone, color: string, a: number, solid = 0.6): void {
  const r = Math.max(z.rx, z.ry);
  if (r <= 0) return;
  const g = c.createRadialGradient(z.x, z.y, 0, z.x, z.y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(solid, rgba(color, a));
  g.addColorStop(1, rgba(color, z.shape === "rect" ? a * 0.7 : 0));
  c.fillStyle = g;
  zonePath(c, z);
  c.fill();
}

/** Whether a zone's look keeps moving (the board keeps drawing while one is on the map). */
export function zoneMoves(look: ZoneLook): boolean {
  return ZONE_LOOKS[look].moving;
}

/**
 * Draws a zone as it is `now`. `px` is one screen pixel in map pixels. `gm`: the GM's view, where
 * fog and darkness are thinner, so what's under them still shows.
 */
export function drawZone(c: CanvasRenderingContext2D, z: Zone, now: number, cell: number, px: number, gm: boolean): void {
  if (z.rx <= 0 || z.ry <= 0) return;
  c.save();
  switch (z.look) {
    case "fog":
    case "poison-cloud": {
      const tint = z.look === "fog" ? "#e6eaee" : "#c2d850";
      const thick = gm ? 0.55 : 0.92;
      softFill(c, z, tint, 0.55 * thick, 0.55);
      const p = puff();
      if (p) {
        // Puffs drift and turn slowly, kept inside the zone.
        c.save();
        zonePath(c, z, cell * 0.3);
        c.clip();
        for (const s of spots(z, count(z, cell, 0.5, 70), 4)) {
          const size = cell * (1.6 + 1.6 * s.r[0]);
          const t = now / (5000 + 4000 * s.r[1]);
          const x = s.x + Math.sin(t * Math.PI * 2 + s.r[2] * 9) * cell * 0.35;
          const y = s.y + Math.cos(t * Math.PI * 2 + s.r[3] * 9) * cell * 0.25;
          c.save();
          c.globalAlpha = thick * (z.look === "fog" ? 0.9 : 0.8);
          c.translate(x, y);
          c.rotate(t + s.r[0] * 6);
          c.drawImage(p, -size / 2, -size / 2, size, size);
          c.restore();
        }
        c.restore();
        if (z.look === "poison-cloud") {
          // Tinted: a wash of yellow-green over the white puffs.
          c.globalCompositeOperation = "source-atop";
          softFill(c, z, "#b8d040", 0.35 * thick, 0.7);
        }
      }
      break;
    }
    case "darkness": {
      softFill(c, z, "#020205", gm ? 0.6 : 0.97, 0.82);
      c.strokeStyle = rgba("#000000", gm ? 0.5 : 0.8);
      c.lineWidth = cell * 0.15;
      zonePath(c, z);
      c.stroke();
      break;
    }
    case "light": {
      c.globalCompositeOperation = "lighter";
      softFill(c, z, "#ffd88a", 0.18, 0.2);
      const g = c.createRadialGradient(z.x, z.y, 0, z.x, z.y, cell * 0.35);
      g.addColorStop(0, "rgba(255, 252, 230, 0.95)");
      g.addColorStop(1, "rgba(255, 220, 140, 0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(z.x, z.y, cell * 0.35, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case "moonbeam": {
      c.globalCompositeOperation = "lighter";
      softFill(c, z, "#cfe0ff", 0.22 + 0.05 * Math.sin(now / 400), 0.5);
      c.fillStyle = "rgba(240, 246, 255, 0.85)";
      for (const s of spots(z, count(z, cell, 3, 40), 3)) {
        const tw = Math.max(0, Math.sin(now / 250 + s.r[0] * 20));
        const k = cell * 0.05 * tw;
        if (k <= 0) continue;
        c.beginPath();
        c.arc(s.x, s.y - ((now / 1500 + s.r[1]) % 1) * cell * 0.5, k, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case "vines": {
      softFill(c, z, "#1e3a14", 0.35, 0.8);
      c.lineCap = "round";
      for (const s of spots(z, count(z, cell, 2.2, 140), 5)) {
        const sway = Math.sin(now / 900 + s.r[0] * 9) * cell * 0.06;
        const len = cell * (0.4 + 0.5 * s.r[1]);
        const a = s.r[2] * Math.PI * 2;
        c.strokeStyle = s.r[3] < 0.5 ? "#2f6a22" : "#4c8a2e";
        c.lineWidth = Math.max(cell * (0.04 + 0.04 * s.r[4]), px);
        c.beginPath();
        c.moveTo(s.x, s.y);
        c.quadraticCurveTo(s.x + Math.cos(a + 1) * len * 0.6 + sway, s.y + Math.sin(a + 1) * len * 0.6, s.x + Math.cos(a) * len + sway, s.y + Math.sin(a) * len);
        c.stroke();
        c.fillStyle = "#6aaa3a";
        c.beginPath();
        c.ellipse(s.x + Math.cos(a) * len + sway, s.y + Math.sin(a) * len, cell * 0.09, cell * 0.045, a, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case "spikes": {
      softFill(c, z, "#3a2a1a", 0.3, 0.85);
      c.fillStyle = "#6b5233";
      c.strokeStyle = "#2a1f12";
      c.lineWidth = Math.max(cell * 0.015, px * 0.7);
      c.beginPath();
      for (const s of spots(z, count(z, cell, 6, 500), 2)) {
        const k = cell * (0.06 + 0.06 * s.r[0]);
        c.moveTo(s.x - k, s.y + k * 0.6);
        c.lineTo(s.x, s.y - k * 1.4);
        c.lineTo(s.x + k, s.y + k * 0.6);
        c.closePath();
      }
      c.fill();
      c.stroke();
      break;
    }
    case "pit": {
      const r = Math.max(z.rx, z.ry);
      const g = c.createRadialGradient(z.x, z.y, 0, z.x, z.y, r * 1.2);
      g.addColorStop(0, "#000000");
      g.addColorStop(0.65, "#0e0b08");
      g.addColorStop(1, "#3a3128");
      c.fillStyle = g;
      zonePath(c, z);
      c.fill();
      c.strokeStyle = "#8a8072";
      c.lineWidth = Math.max(cell * 0.06, px);
      c.setLineDash([cell * 0.25, cell * 0.15]);
      c.stroke();
      break;
    }
    case "water": {
      softFill(c, z, "#2a6aa0", 0.55, 0.85);
      c.save();
      zonePath(c, z);
      c.clip();
      c.strokeStyle = "rgba(220, 240, 255, 0.55)";
      c.lineWidth = Math.max(cell * 0.03, px);
      const step = cell * 0.45;
      const shift = ((now / 1600) % 1) * step;
      for (let y = z.y - z.ry - step + shift; y < z.y + z.ry + step; y += step) {
        c.beginPath();
        for (let x = z.x - z.rx; x <= z.x + z.rx; x += cell * 0.25) {
          const yy = y + Math.sin(x / (cell * 0.35) + now / 500) * cell * 0.06;
          if (x === z.x - z.rx) c.moveTo(x, yy);
          else c.lineTo(x, yy);
        }
        c.stroke();
      }
      c.restore();
      break;
    }
    case "hypnotic": {
      c.save();
      zonePath(c, z);
      c.clip();
      const cols = ["#ff5ad0", "#5ad4ff", "#ffe35a", "#8a5aff"];
      const r = Math.max(z.rx, z.ry);
      const turn = now / 2500;
      c.lineWidth = cell * 0.22;
      c.lineCap = "round";
      cols.forEach((col, k) => {
        c.strokeStyle = rgba(col, 0.45);
        c.beginPath();
        for (let i = 0; i <= 120; i++) {
          const a = i * 0.16 + (k * Math.PI) / 2 + turn;
          const d = (i / 120) * r * 1.1;
          if (i) c.lineTo(z.x + d * Math.cos(a), z.y + d * Math.sin(a));
          else c.moveTo(z.x + d * Math.cos(a), z.y + d * Math.sin(a));
        }
        c.stroke();
      });
      c.restore();
      break;
    }
    case "marked": {
      c.fillStyle = rgba(z.color, 0.08);
      zonePath(c, z);
      c.fill();
      c.strokeStyle = z.color;
      c.lineWidth = Math.max(cell * 0.04, 2 * px);
      c.setLineDash([cell * 0.25, cell * 0.17]);
      c.stroke();
      c.setLineDash([]);
      if (z.label) {
        const size = Math.max(cell * 0.32, 12 * px);
        c.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        const w = c.measureText(z.label).width + size;
        const y = z.y - z.ry;
        c.fillStyle = "rgba(0, 0, 0, 0.6)";
        c.beginPath();
        c.roundRect(z.x - w / 2, y - size * 0.75, w, size * 1.5, size * 0.75);
        c.fill();
        c.fillStyle = "#ffffff";
        c.fillText(z.label, z.x, y);
      }
      break;
    }
  }
  c.restore();
}

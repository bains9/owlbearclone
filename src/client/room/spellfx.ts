// The Spells tool's effects as they play on the board: each drawn frame by frame from when it
// started, in map pixels, its sparks drawn from its seed so every screen shows the same ones.
// Sizes go by the grid's square (`cell`), so an effect looks alike at any map scale.

import { FX_LOOKS, type FxLook } from "../../shared/spellfx";

export interface Pt {
  x: number;
  y: number;
}

/** One effect playing: as sent (Ephemeral "fx"), and when it began on this screen. */
export interface FxPlay {
  look: FxLook;
  a: Pt;
  b: Pt;
  /** A burst's radius or a cone's length, in map pixels. */
  r: number;
  spread: number;
  color: string;
  seed: number;
  t0: number;
  /** Map pixels per square. */
  cell: number;
  /** Sparks, made from the seed the first time it's drawn. */
  parts?: number[][];
}

export function fxDuration(look: FxLook): number {
  return FX_LOOKS[look].ms;
}

/** A seeded random number generator (mulberry32). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** 1 between `inEnd` and `outStart`, rising before and falling after (t from 0 to 1). */
const envelope = (t: number, inEnd: number, outStart: number) =>
  t < inEnd ? clamp01(t / inEnd) : t > outStart ? clamp01((1 - t) / (1 - outStart)) : 1;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number): void {
  if (r <= 0 || a <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.4, rgba(color, a * 0.6));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function star(c: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  c.beginPath();
  c.moveTo(x, y - 2 * k);
  c.lineTo(x + 0.4 * k, y - 0.4 * k);
  c.lineTo(x + 2 * k, y);
  c.lineTo(x + 0.4 * k, y + 0.4 * k);
  c.lineTo(x, y + 2 * k);
  c.lineTo(x - 0.4 * k, y + 0.4 * k);
  c.lineTo(x - 2 * k, y);
  c.lineTo(x - 0.4 * k, y - 0.4 * k);
  c.closePath();
  c.fill();
}

function wedge(c: CanvasRenderingContext2D, a: Pt, dir: number, spread: number, len: number): void {
  const h = ((spread / 2) * Math.PI) / 180;
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.arc(a.x, a.y, len, dir - h, dir + h);
  c.closePath();
}

/** A jagged line from p to q, its kinks drawn from `rand`. */
function jagged(c: CanvasRenderingContext2D, p: Pt, q: Pt, steps: number, jag: number, rand: () => number): void {
  c.beginPath();
  c.moveTo(p.x, p.y);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    c.lineTo(p.x + (q.x - p.x) * t + (rand() * 2 - 1) * jag, p.y + (q.y - p.y) * t + (rand() * 2 - 1) * jag);
  }
  c.lineTo(q.x, q.y);
}

/** The point at t along a quadratic curve from p to q bending through ctrl. */
function quad(p: Pt, ctrl: Pt, q: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p.x + 2 * u * t * ctrl.x + t * t * q.x, y: u * u * p.y + 2 * u * t * ctrl.y + t * t * q.y };
}

/** A glowing head with a fading tail along a path (pos(t) for t up to `t`). */
function streak(c: CanvasRenderingContext2D, pos: (t: number) => Pt, t: number, tail: number, width: number, color: string, alpha: number): void {
  const steps = 10;
  c.lineCap = "round";
  for (let i = 0; i < steps; i++) {
    const t0 = Math.max(0, t - tail * (1 - i / steps));
    const t1 = Math.max(0, t - tail * (1 - (i + 1) / steps));
    const p = pos(t0);
    const q = pos(t1);
    c.strokeStyle = rgba(color, alpha * ((i + 1) / steps));
    c.lineWidth = width * (0.4 + (0.6 * (i + 1)) / steps);
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(q.x, q.y);
    c.stroke();
  }
  const h = pos(t);
  glow(c, h.x, h.y, width * 3, color, alpha * 0.9);
  c.fillStyle = rgba("#ffffff", alpha);
  c.beginPath();
  c.arc(h.x, h.y, width * 0.55, 0, Math.PI * 2);
  c.fill();
}

/** Expanding ring of an impact. */
function ring(c: CanvasRenderingContext2D, p: Pt, r: number, width: number, color: string, a: number): void {
  if (a <= 0) return;
  c.strokeStyle = rgba(color, a);
  c.lineWidth = width;
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.stroke();
}

function particles(fx: FxPlay, n: number, per: number): number[][] {
  if (!fx.parts) {
    const rand = seeded(fx.seed);
    fx.parts = Array.from({ length: n }, () => Array.from({ length: per }, rand));
  }
  return fx.parts;
}

/**
 * Draws an effect as it is `now` (performance.now()); false once it has finished. `px` is one
 * screen pixel in map pixels, so the thinnest lines stay visible zoomed out.
 */
export function drawFx(c: CanvasRenderingContext2D, fx: FxPlay, now: number, px: number): boolean {
  const ms = fxDuration(fx.look);
  const t = (now - fx.t0) / ms;
  if (t >= 1) return false;
  if (t < 0) return true;
  const cell = fx.cell;
  const line = Math.max(cell * 0.05, 2 * px);
  const { a, b } = fx;
  const dir = Math.atan2(b.y - a.y, b.x - a.x);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  c.save();
  switch (fx.look) {
    case "frost-fan":
    case "colour-spray": {
      const reach = fx.r * easeOut(t / 0.35);
      const alpha = envelope(t, 0.05, 0.55);
      if (fx.look === "frost-fan") {
        const g = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, reach));
        g.addColorStop(0, rgba("#ffffff", 0.95 * alpha));
        g.addColorStop(0.45, rgba("#cdeeff", 0.75 * alpha));
        g.addColorStop(1, rgba("#5aa8e0", 0));
        c.fillStyle = g;
        wedge(c, a, dir, fx.spread, reach);
        c.fill();
      } else {
        const cols = ["#ff4d4d", "#ffb23a", "#fff35a", "#5ee26a", "#4fb4ff", "#9b6bff"];
        cols.forEach((col, i) => {
          const sub = fx.spread / cols.length;
          const off = ((-fx.spread / 2 + sub * (i + 0.5)) * Math.PI) / 180;
          c.fillStyle = rgba(col, alpha * (0.45 + 0.25 * Math.sin(now / 45 + i * 1.7)));
          wedge(c, a, dir + off, sub + 1, reach);
          c.fill();
        });
      }
      // Sparks flying out across the fan.
      const ps = particles(fx, 70, 4);
      c.fillStyle = rgba("#ffffff", alpha);
      for (const [r0, r1, r2, r3] of ps) {
        const ang = dir + (((r0 - 0.5) * fx.spread) / 180) * Math.PI;
        const d = fx.r * (0.2 + 0.9 * r1) * easeOut(t / (0.3 + 0.4 * r2));
        if (d > reach) continue;
        const tw = 0.6 + 0.4 * Math.sin(now / 60 + r3 * 20);
        star(c, a.x + d * Math.cos(ang), a.y + d * Math.sin(ang), cell * 0.06 * tw);
      }
      break;
    }
    case "downpour": {
      const alpha = envelope(t, 0.12, 0.7);
      c.fillStyle = rgba("#5aa0d8", 0.25 * alpha);
      c.beginPath();
      c.arc(a.x, a.y, fx.r, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.beginPath();
      c.arc(a.x, a.y, fx.r, 0, Math.PI * 2);
      c.clip();
      const fall = cell * 0.9;
      c.strokeStyle = rgba("#e2f1ff", 0.75 * alpha);
      c.lineWidth = Math.max(cell * 0.025, 1.2 * px);
      c.beginPath();
      for (const [r0, r1, r2] of particles(fx, 220, 3)) {
        const ang = r0 * Math.PI * 2;
        const d = fx.r * Math.sqrt(r1);
        const x = a.x + d * Math.cos(ang);
        const y = a.y + d * Math.sin(ang) + (((now / 260 + r2) % 1) - 0.5) * fall;
        c.moveTo(x, y);
        c.lineTo(x - cell * 0.06, y + cell * 0.25);
      }
      c.stroke();
      // Splashes.
      for (const [r0, r1, r2] of particles(fx, 220, 3).slice(0, 26)) {
        const ang = r0 * Math.PI * 2;
        const d = fx.r * 0.9 * Math.sqrt(r1);
        const ph = (now / 500 + r2) % 1;
        c.strokeStyle = rgba("#eef7ff", (1 - ph) * 0.7 * alpha);
        c.lineWidth = line * 0.6;
        c.beginPath();
        c.ellipse(a.x + d * Math.cos(ang), a.y + d * Math.sin(ang), cell * 0.25 * ph, cell * 0.1 * ph, 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
      break;
    }
    case "earth-maw": {
      const open = t < 0.25 ? easeOut(t / 0.25) : t < 0.65 ? 1 : 1 - easeOut((t - 0.65) / 0.35);
      const alpha = envelope(t, 0.05, 0.8);
      c.fillStyle = rgba("#3b2a1a", 0.55 * alpha);
      c.beginPath();
      c.arc(a.x, a.y, fx.r, 0, Math.PI * 2);
      c.fill();
      const ps = particles(fx, 40, 3);
      // Cracks out to the edge.
      c.strokeStyle = rgba("#1b120a", 0.8 * alpha);
      c.lineWidth = line;
      for (const [r0, r1] of ps.slice(0, 10)) {
        const ang = r0 * Math.PI * 2;
        c.beginPath();
        c.moveTo(a.x + fx.r * 0.5 * Math.cos(ang), a.y + fx.r * 0.5 * Math.sin(ang));
        c.lineTo(a.x + fx.r * (0.8 + 0.2 * r1) * Math.cos(ang + 0.1), a.y + fx.r * (0.8 + 0.2 * r1) * Math.sin(ang + 0.1));
        c.stroke();
      }
      // The mouth: a ring of fangs that opens and bites shut.
      if (open > 0.02) {
        c.beginPath();
        for (let i = 0; i < 18; i++) {
          const ang = (i / 18) * Math.PI * 2;
          const rr = fx.r * open * (i % 2 ? 0.35 : 0.62);
          c[i ? "lineTo" : "moveTo"](a.x + rr * Math.cos(ang), a.y + rr * Math.sin(ang));
        }
        c.closePath();
        c.fillStyle = rgba("#120b05", alpha);
        c.fill();
        c.strokeStyle = rgba("#7a5a3a", alpha);
        c.lineWidth = line * 1.2;
        c.stroke();
      }
      // Clods thrown up as it opens.
      c.fillStyle = rgba("#7b6a55", alpha);
      for (const [r0, r1, r2] of ps) {
        const ang = r0 * Math.PI * 2;
        const d = fx.r * (0.4 + 0.7 * r1 * easeOut(t / 0.5));
        c.beginPath();
        c.arc(a.x + d * Math.cos(ang), a.y + d * Math.sin(ang), cell * (0.04 + 0.06 * r2), 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    case "needle-burst": {
      const alpha = envelope(t, 0.03, 0.6);
      glow(c, a.x, a.y, fx.r * 0.35, fx.color, 0.6 * (1 - t));
      c.strokeStyle = rgba(fx.color, alpha);
      c.lineWidth = Math.max(cell * 0.03, 1.4 * px);
      c.lineCap = "round";
      c.beginPath();
      for (const [r0, r1, r2] of particles(fx, 110, 3)) {
        const ang = r0 * Math.PI * 2;
        const d = fx.r * (0.1 + (0.75 + 0.3 * r1) * easeOut(t / (0.35 + 0.2 * r2)));
        const len = cell * (0.15 + 0.15 * r2);
        c.moveTo(a.x + (d - len) * Math.cos(ang), a.y + (d - len) * Math.sin(ang));
        c.lineTo(a.x + d * Math.cos(ang), a.y + d * Math.sin(ang));
      }
      c.stroke();
      break;
    }
    case "force-darts": {
      const flight = 0.45;
      const ps = particles(fx, 3, 2);
      ps.forEach(([r0, r1], i) => {
        const start = i * 0.13;
        const p = (t - start) / flight;
        if (p <= 0) return;
        const side = (i - 1) * 0.6 + (r0 - 0.5) * 0.5;
        const ctrl = { x: (a.x + b.x) / 2 - Math.sin(dir) * dist * 0.3 * side, y: (a.y + b.y) / 2 + Math.cos(dir) * dist * 0.3 * side };
        const end = { x: b.x + (r1 - 0.5) * cell * 0.4, y: b.y + (r0 - 0.5) * cell * 0.4 };
        if (p < 1) streak(c, (u) => quad(a, ctrl, end, u), p, 0.3, cell * 0.12, fx.color, 1);
        else {
          const k = clamp01((p - 1) / 0.5);
          ring(c, end, cell * (0.15 + 0.5 * k), line, fx.color, 1 - k);
          glow(c, end.x, end.y, cell * 0.5, fx.color, 0.7 * (1 - k));
        }
      });
      break;
    }
    case "orb":
    case "holy-bolt": {
      const flight = fx.look === "orb" ? 0.45 : 0.4;
      const p = t / flight;
      const pos = (u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      if (p < 1) {
        streak(c, pos, p, fx.look === "orb" ? 0.35 : 0.6, cell * (fx.look === "orb" ? 0.22 : 0.14), fx.color, 1);
        if (fx.look === "holy-bolt") {
          c.fillStyle = rgba("#fff3b0", 0.9);
          for (const [r0, r1, r2] of particles(fx, 24, 3)) {
            const u = p - 0.5 * r0;
            if (u < 0) continue;
            const q = pos(u);
            star(c, q.x + (r1 - 0.5) * cell * 0.5, q.y + (r2 - 0.5) * cell * 0.5, cell * 0.05 * (1 - r0));
          }
        }
      } else {
        const k = clamp01((t - flight) / (1 - flight));
        glow(c, b.x, b.y, cell * (0.6 + 0.8 * k), fx.color, 0.9 * (1 - k));
        ring(c, b, cell * (0.2 + 1.1 * k), line * 1.4, fx.color, 1 - k);
        if (fx.look === "holy-bolt") {
          c.strokeStyle = rgba("#fff8d0", 0.6 * (1 - k));
          c.lineWidth = line;
          for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2;
            c.beginPath();
            c.moveTo(b.x + cell * 0.25 * Math.cos(ang), b.y + cell * 0.25 * Math.sin(ang));
            c.lineTo(b.x + cell * (0.5 + 1.2 * k) * Math.cos(ang), b.y + cell * (0.5 + 1.2 * k) * Math.sin(ang));
            c.stroke();
          }
        } else {
          c.fillStyle = rgba(fx.color, 1 - k);
          for (const [r0, r1] of particles(fx, 18, 2)) {
            const ang = r0 * Math.PI * 2;
            const d = cell * (0.2 + 1.2 * r1 * easeOut(k));
            c.beginPath();
            c.arc(b.x + d * Math.cos(ang), b.y + d * Math.sin(ang), cell * 0.05, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
      break;
    }
    case "ray": {
      const grow = easeOut(t / 0.1);
      const alpha = envelope(t, 0.05, 0.7);
      const end = { x: a.x + (b.x - a.x) * grow, y: a.y + (b.y - a.y) * grow };
      const w = cell * (0.16 + 0.04 * Math.sin(now / 40));
      c.lineCap = "round";
      c.strokeStyle = rgba(fx.color, 0.45 * alpha);
      c.lineWidth = w * 2.2;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(end.x, end.y);
      c.stroke();
      c.strokeStyle = rgba("#ffffff", 0.95 * alpha);
      c.lineWidth = Math.max(w * 0.35, 1.5 * px);
      c.stroke();
      if (grow >= 1) glow(c, b.x, b.y, cell * 0.8, fx.color, 0.8 * alpha);
      break;
    }
    case "sky-lightning": {
      const flashes = [
        [0, 0.12],
        [0.2, 0.3],
        [0.42, 0.52],
      ];
      const lit = flashes.findIndex(([s, e]) => t >= s && t < e);
      const after = 1 - clamp01(t);
      glow(c, a.x, a.y, fx.r * 1.4, "#cfe6ff", 0.35 * after);
      ring(c, a, fx.r * (0.6 + 0.4 * easeOut(t / 0.3)), line * 1.2, "#bfe0ff", 0.8 * after);
      if (lit >= 0) {
        const rand = seeded(fx.seed + lit * 7919);
        const top = { x: a.x + (rand() - 0.5) * cell * 3, y: a.y - cell * 14 };
        c.lineJoin = "round";
        c.lineCap = "round";
        for (const [w, col] of [
          [cell * 0.35, "rgba(160, 205, 255, 0.35)"],
          [cell * 0.12, "rgba(190, 225, 255, 0.95)"],
          [cell * 0.04, "#ffffff"],
        ] as const) {
          const r2 = seeded(fx.seed + lit * 7919);
          r2();
          jagged(c, top, a, 14, cell * 0.6, r2);
          c.strokeStyle = col;
          c.lineWidth = Math.max(w, px);
          c.stroke();
        }
        glow(c, a.x, a.y, fx.r, "#ffffff", 0.8);
      }
      break;
    }
    case "sparkle": {
      const alpha = envelope(t, 0.15, 0.6);
      glow(c, a.x, a.y, fx.r * 1.1, fx.color, 0.25 * alpha);
      c.fillStyle = rgba(fx.color, alpha);
      const n = Math.min(80, Math.round(16 + (fx.r / cell) * 12));
      for (const [r0, r1, r2, r3] of particles(fx, 80, 4).slice(0, n)) {
        const ang = r0 * Math.PI * 2;
        const d = fx.r * Math.sqrt(r1);
        const tw = Math.max(0, Math.sin(now / 90 + r2 * 30));
        star(c, a.x + d * Math.cos(ang), a.y + d * Math.sin(ang) - t * cell * 0.4 * r3, cell * (0.05 + 0.06 * r3) * (0.4 + 0.6 * tw));
      }
      break;
    }
    case "teleport": {
      const puff = (p: Pt, k: number, out: boolean) => {
        if (k <= 0 || k >= 1) return;
        const spread = out ? easeOut(k) : 1 - easeOut(k) * 0.6;
        glow(c, p.x, p.y, cell * 0.9, fx.color, 0.7 * (1 - k));
        c.fillStyle = rgba(fx.color, 0.8 * (1 - k));
        for (const [r0, r1, r2] of particles(fx, 30, 3)) {
          const ang = r0 * Math.PI * 2;
          const d = cell * (0.2 + 0.7 * r1) * spread;
          c.beginPath();
          c.arc(p.x + d * Math.cos(ang), p.y + d * Math.sin(ang), cell * (0.06 + 0.08 * r2), 0, Math.PI * 2);
          c.fill();
        }
      };
      puff(a, t / 0.55, true);
      puff(b, (t - 0.3) / 0.6, false);
      const arc = envelope(t, 0.1, 0.5);
      if (arc > 0) {
        c.setLineDash([cell * 0.15, cell * 0.15]);
        c.strokeStyle = rgba(fx.color, 0.6 * arc);
        c.lineWidth = line * 0.7;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - dist * 0.35, b.x, b.y);
        c.stroke();
        c.setLineDash([]);
      }
      break;
    }
  }
  c.restore();
  return true;
}

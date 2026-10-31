// Spells on tokens (a drawing with a token's look and `on`), as the board draws them each frame on
// the token they're on, wherever it is: a glowing outline, a shell, a burning or icy weapon, a
// red-hot glow, binding rings, a buzzing swarm, a ghostly glow and after-image, the shimmer of
// an unseen token, a flyer's shadow. In map pixels, sized by the token; their details drawn
// from a seed (the drawing's id), so every screen shows the same. What a look does to the token
// itself (unseen, see-through, lifted, a tree) the board does when it builds the token.

import type { TokenLook } from "../../shared/zones";
import { seeded } from "./spellfx";
import { rgba } from "./zonefx";

export interface OnToken {
  look: TokenLook;
  /** The token's middle and radius as it is now (dragged too). */
  x: number;
  y: number;
  r: number;
  color: string;
  seed: number;
  /** Spectral: where the token was lately, oldest first, with when (performance.now()). */
  trail?: readonly { x: number; y: number; t: number }[];
  /** Spectral: the token's picture, to leave behind as it moves. */
  picture?: { img: CanvasImageSource; w: number; h: number; flip: boolean } | null;
}

/** How long a spectral token's after-image lasts, ms. */
export const AFTER_IMAGE_MS = 650;

/** Which layer a look is drawn in: a flyer's shadow under the tokens, everything else over them. */
export function tokenLookLayer(look: TokenLook): "ground" | "air" {
  return look === "flying" ? "ground" : "air";
}

/** How far above its place a flying token's picture floats now, bobbing gently (map pixels). */
export function flyLift(r: number, now: number, seed: number): number {
  return r * (0.3 + 0.07 * Math.sin(now / 650 + (seed % 628) / 100));
}

/** Whether a colour is more blue than red: a weapon of ice rather than fire. */
function icy(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return (n & 255) > ((n >> 16) & 255);
}

function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

/** Draws a spell on a token as it is `now`. `px` is one screen pixel in map pixels. */
export function drawTokenLook(c: CanvasRenderingContext2D, t: OnToken, now: number, px: number): void {
  const { x, y, r, color } = t;
  if (r <= 0) return;
  const phase = (t.seed % 628) / 100;
  c.save();
  switch (t.look) {
    case "outline": {
      // A glow hugging the token that pulses slowly, with a few motes drifting round it.
      const pulse = 0.55 + 0.45 * Math.sin(now / 650 + phase);
      circle(c, x, y, r * 1.02);
      c.strokeStyle = rgba(color, 0.12 + 0.18 * pulse);
      c.lineWidth = r * 0.34;
      c.stroke();
      c.strokeStyle = rgba(color, 0.35 + 0.35 * pulse);
      c.lineWidth = r * 0.13;
      c.stroke();
      c.strokeStyle = rgba("#ffffff", 0.55 + 0.35 * pulse);
      c.lineWidth = Math.max(px, r * 0.035);
      c.stroke();
      c.fillStyle = rgba(color, 0.9);
      for (let i = 0; i < 6; i++) {
        const a = phase + (i / 6) * Math.PI * 2 + now / 2200;
        const d = r * (1.05 + 0.12 * Math.sin(now / 400 + i * 2));
        circle(c, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(px, r * 0.045));
        c.fill();
      }
      break;
    }
    case "unseen": {
      // Seen only by the GM and the token's owner: a faint ripple round it.
      c.lineWidth = Math.max(px, r * 0.03);
      c.setLineDash([r * 0.24, r * 0.16]);
      for (let k = 0; k < 3; k++) {
        c.lineDashOffset = ((k % 2 ? -1 : 1) * now * r) / 2500;
        c.strokeStyle = rgba("#ffffff", 0.32 - k * 0.08);
        circle(c, x, y, r * (0.98 + 0.07 * k) + Math.sin(now / 350 + k * 2 + phase) * r * 0.04);
        c.stroke();
      }
      break;
    }
    case "shell": {
      const R = r * 1.14;
      const g = c.createRadialGradient(x, y, R * 0.55, x, y, R);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(0.75, rgba(color, 0.12));
      g.addColorStop(1, rgba(color, 0.38));
      c.fillStyle = g;
      circle(c, x, y, R);
      c.fill();
      c.strokeStyle = rgba(color, 0.9);
      c.lineWidth = Math.max(1.5 * px, r * 0.05);
      c.stroke();
      // A shine on its top left, as on a bubble.
      c.beginPath();
      c.arc(x, y, R * 0.84, -2.55, -1.65);
      c.strokeStyle = "rgba(255, 255, 255, 0.55)";
      c.lineWidth = r * 0.06;
      c.lineCap = "round";
      c.stroke();
      break;
    }
    case "weapon": {
      // A blade held at the token's right, flames (or frost) flickering along it.
      const ice = icy(color);
      const hx = x + r * 0.82, hy = y + r * 0.5;
      const a = -1.15;
      const len = r * 1.1;
      const ux = Math.cos(a), uy = Math.sin(a);
      const nx = -uy, ny = ux;
      const w = r * 0.07;
      c.beginPath();
      c.moveTo(hx + nx * w, hy + ny * w);
      c.lineTo(hx + ux * len * 0.92 + nx * w * 0.6, hy + uy * len * 0.92 + ny * w * 0.6);
      c.lineTo(hx + ux * len, hy + uy * len);
      c.lineTo(hx + ux * len * 0.92 - nx * w * 0.6, hy + uy * len * 0.92 - ny * w * 0.6);
      c.lineTo(hx - nx * w, hy - ny * w);
      c.closePath();
      c.fillStyle = ice ? "#dff6ff" : "#d8dee6";
      c.fill();
      c.strokeStyle = "rgba(40, 44, 52, 0.8)";
      c.lineWidth = Math.max(px * 0.8, r * 0.015);
      c.stroke();
      c.lineCap = "round";
      c.strokeStyle = "#6b5233";
      c.lineWidth = r * 0.07;
      c.beginPath();
      c.moveTo(hx + nx * r * 0.18, hy + ny * r * 0.18);
      c.lineTo(hx - nx * r * 0.18, hy - ny * r * 0.18);
      c.moveTo(hx, hy);
      c.lineTo(hx - ux * r * 0.22, hy - uy * r * 0.22);
      c.stroke();
      const rand = seeded(t.seed);
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < 18; i++) {
        const u = 0.08 + 0.92 * rand();
        const speed = 380 + 300 * rand();
        const life = (now / speed + rand()) % 1;
        const bx = hx + ux * len * u + nx * w * (rand() * 2 - 1);
        const by = hy + uy * len * u + ny * w * (rand() * 2 - 1);
        const size = r * (ice ? 0.07 : 0.12) * (1 - life * 0.7);
        const rise = life * r * (ice ? 0.12 : 0.4);
        const col = ice ? (life < 0.5 ? "#f2fdff" : color) : life < 0.3 ? "#ffe066" : life < 0.65 ? color : "#c0301a";
        c.fillStyle = rgba(col, (1 - life) * (ice ? 0.9 : 0.75));
        circle(c, bx + Math.sin(now / 120 + i) * r * 0.02, by - rise, size);
        c.fill();
      }
      break;
    }
    case "red-hot": {
      const pulse = 0.6 + 0.4 * Math.sin(now / 500 + phase);
      const g = c.createRadialGradient(x, y, 0, x, y, r * 1.12);
      g.addColorStop(0, rgba("#ff7a3a", 0.28 * pulse));
      g.addColorStop(0.75, rgba(color, 0.4 * pulse));
      g.addColorStop(1, rgba(color, 0));
      c.fillStyle = g;
      circle(c, x, y, r * 1.12);
      c.fill();
      circle(c, x, y, r * 0.96);
      c.strokeStyle = rgba("#ffb060", 0.55 + 0.35 * pulse);
      c.lineWidth = Math.max(px, r * 0.07);
      c.stroke();
      break;
    }
    case "held":
    case "slowed": {
      // Grey-blue, and bound by rings (Slow: lighter, one ring).
      const held = t.look === "held";
      c.fillStyle = rgba(color, held ? 0.45 : 0.22);
      circle(c, x, y, r * 0.97);
      c.fill();
      for (const tilt of held ? [-0.5, 0.5] : [0.35]) {
        c.beginPath();
        c.ellipse(x, y, r * 1.08, r * 0.28, tilt, 0, Math.PI * 2);
        c.strokeStyle = "rgba(40, 56, 80, 0.7)";
        c.lineWidth = r * (held ? 0.12 : 0.08);
        c.stroke();
        c.strokeStyle = held ? "rgba(220, 232, 248, 0.95)" : "rgba(220, 232, 248, 0.7)";
        c.lineWidth = Math.max(px, r * (held ? 0.06 : 0.04));
        if (!held) c.setLineDash([r * 0.2, r * 0.12]);
        c.stroke();
        c.setLineDash([]);
      }
      break;
    }
    case "flying": {
      // The shadow on the ground, smaller and fainter the higher it floats.
      const lift = flyLift(r, now, t.seed) / r;
      const k = 1.15 - lift * 0.9;
      const g = c.createRadialGradient(x, y + r * 0.2, 0, x, y + r * 0.2, r * 0.85 * k);
      g.addColorStop(0, `rgba(0, 0, 0, ${(0.5 * k).toFixed(3)})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y + r * 0.2, r * 0.85 * k, r * 0.42 * k, 0, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case "swarm": {
      const haze = c.createRadialGradient(x, y, r * 0.3, x, y, r * 1.4);
      haze.addColorStop(0, "rgba(30, 28, 15, 0.22)");
      haze.addColorStop(1, "rgba(30, 28, 15, 0)");
      c.fillStyle = haze;
      circle(c, x, y, r * 1.4);
      c.fill();
      const rand = seeded(t.seed);
      for (let i = 0; i < 40; i++) {
        const d = r * (0.3 + 0.95 * rand());
        const speed = (0.6 + 1.4 * rand()) * (rand() < 0.5 ? -1 : 1);
        const a = rand() * Math.PI * 2 + (now / 1000) * speed * 2;
        const bx = x + Math.cos(a) * d + Math.sin(now / 90 + i) * r * 0.05;
        const by = y + Math.sin(a) * d * 0.85 + Math.cos(now / 110 + i * 3) * r * 0.05;
        const flap = Math.abs(Math.sin(now / 25 + i));
        const k = Math.max(px * 1.1, r * 0.032);
        c.fillStyle = "rgba(235, 235, 215, 0.45)";
        c.beginPath();
        c.ellipse(bx - k, by - k * 0.4, k * 1.1, k * 0.5 * flap + k * 0.1, -0.5, 0, Math.PI * 2);
        c.ellipse(bx + k, by - k * 0.4, k * 1.1, k * 0.5 * flap + k * 0.1, 0.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = color;
        circle(c, bx, by, k);
        c.fill();
      }
      break;
    }
    case "spectral": {
      // Where it was a moment ago, fading; and a ghostly glow round it.
      for (const p of t.trail ?? []) {
        const age = (now - p.t) / AFTER_IMAGE_MS;
        if (age <= 0.05 || age >= 1) continue;
        c.globalAlpha = 0.32 * (1 - age);
        const pic = t.picture;
        if (pic) {
          c.save();
          c.translate(p.x, p.y);
          if (pic.flip) c.scale(-1, 1);
          c.drawImage(pic.img, -pic.w / 2, -pic.h / 2, pic.w, pic.h);
          c.restore();
        } else {
          c.fillStyle = color;
          circle(c, p.x, p.y, r * 0.9);
          c.fill();
        }
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = "lighter";
      const pulse = 0.75 + 0.25 * Math.sin(now / 700 + phase);
      const g = c.createRadialGradient(x, y, r * 0.6, x, y, r * 1.45);
      g.addColorStop(0, rgba(color, 0.3 * pulse));
      g.addColorStop(1, rgba(color, 0));
      c.fillStyle = g;
      circle(c, x, y, r * 1.45);
      c.fill();
      break;
    }
    case "treeform":
      // The token is drawn as a tree (the board does it): nothing over it.
      break;
  }
  c.restore();
}

// A creature's token picture, drawn by the browser: the icon in a light colour on a dark disc,
// with a ring in its type's colour and a dark rim, so it reads on dark and light maps alike.
// Drawn once per creature per room, ART_PX across, then uploaded as an ordinary token picture.

import type { MonsterIcon } from "./monsters";
import { ART_PX, TYPE_COLORS, monsterAssetName } from "./monsters";

/** The parts of the token, as shares of its radius (from the outside in). */
export const ART = {
  /** The dark rim that keeps the ring apart from a light map. */
  rim: 0.985,
  /** The type's ring, between these. */
  ringOuter: 0.95,
  ringInner: 0.82,
  /** How far the icon's farthest point reaches, as a share of the disc inside the ring. */
  reach: 0.94,
  rimColor: "rgba(9, 11, 15, 0.92)",
  discInner: "#262b35",
  discOuter: "#0f1216",
  iconColor: "#f3ecdb",
};

/**
 * Where the icon goes on a token `px` across: its scale, and where its box's top left lands, so
 * the middle of its drawing is the middle of the token and its farthest point reaches ART.reach
 * of the disc.
 */
export function iconPlacement(fit: MonsterIcon["fit"], px: number): { scale: number; x: number; y: number } {
  const r = px / 2;
  const scale = (ART.reach * ART.ringInner * r) / fit[2];
  return { scale, x: r - fit[0] * scale, y: r - fit[1] * scale };
}

/** Draws the token onto `ctx`, `px` across (a canvas of that size). */
export function drawMonsterArt(ctx: CanvasRenderingContext2D, m: MonsterIcon, px = ART_PX): void {
  const r = px / 2;
  const ring = TYPE_COLORS[m.type];
  ctx.clearRect(0, 0, px, px);
  const circle = (radius: number) => {
    ctx.beginPath();
    ctx.arc(r, r, radius, 0, Math.PI * 2);
    ctx.closePath();
  };
  circle(ART.rim * r);
  ctx.fillStyle = ART.rimColor;
  ctx.fill();
  circle(ART.ringOuter * r);
  ctx.fillStyle = ring;
  ctx.fill();
  // The disc, lit a little from above.
  const disc = ctx.createRadialGradient(r, r * 0.7, 0, r, r, ART.ringInner * r);
  disc.addColorStop(0, ART.discInner);
  disc.addColorStop(1, ART.discOuter);
  circle(ART.ringInner * r);
  ctx.fillStyle = disc;
  ctx.fill();
  // The icon, kept inside the disc.
  ctx.save();
  ctx.clip();
  const at = iconPlacement(m.fit, px);
  ctx.translate(at.x, at.y);
  ctx.scale(at.scale, at.scale);
  ctx.fillStyle = ART.iconColor;
  ctx.fill(new Path2D(m.path));
  ctx.restore();
}

/** The token picture as an image file (WebP, or PNG where the browser can't make WebP). */
export async function monsterArtFile(m: MonsterIcon): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = ART_PX;
  canvas.height = ART_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't draw the token.");
  drawMonsterArt(ctx, m);
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  let blob = await encode("image/webp");
  // Older Safari can't encode WebP and silently returns PNG instead.
  if (!blob || blob.type !== "image/webp") blob = await encode("image/png");
  if (!blob) throw new Error("This browser couldn't draw the token.");
  // Uploads are named after their file, less its extension.
  return new File([blob], `${monsterAssetName(m)}.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type });
}

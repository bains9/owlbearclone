// An NPC's token picture, drawn by the browser: the race's head in its tint on a dark disc, a
// ring in the class's colour with a dark rim, and at the bottom right a round badge in the
// class's colour holding its emblem, drawn dark. Drawn once per race + class per room, ART_PX
// across, then uploaded as an ordinary token picture; the NPCs list draws the same, small, as a
// preview.

import type { NpcClass, NpcIcon, NpcIcons, NpcRace } from "./npcs";
import { ART_PX, npcAssetName } from "./npcs";

/** The parts of the token, as shares of its radius. */
export const ART = {
  /** The dark rim that keeps the ring apart from a light map. */
  rim: 0.965,
  /** The class's ring, between these. */
  ringOuter: 0.93,
  ringInner: 0.83,
  /** The head's 512 box, as a share of the radius, and where its middle sits (a little above the middle). */
  headBox: 1.075,
  headY: 0.938,
  /** The badge's middle and its radius, with the rim round it, and the emblem's 512 box inside. */
  badgeX: 1.56,
  badgeY: 1.52,
  badgeRim: 0.315,
  badge: 0.285,
  emblemBox: 0.379,
  rimColor: "#0b0d11",
  discColor: "#1b1e24",
  emblemColor: "#1b1e24",
};

/**
 * Where an icon goes: its scale, and where its box's top left lands, so the middle of its
 * drawing is at (cx, cy) and its 512 box is `box` wide. It's the drawing that's centred, not the
 * box (as for the monsters): a few icons sit a little off the middle of their box, and the
 * approved preview, which centred the box, has those a few pixels off.
 */
export function iconPlacement(fit: NpcIcon["fit"], box: number, cx: number, cy: number): { scale: number; x: number; y: number } {
  const scale = box / 512;
  return { scale, x: cx - fit[0] * scale, y: cy - fit[1] * scale };
}

/**
 * The pixels across the list's preview, `cssPx` wide on a screen with `dpr` device pixels per
 * CSS pixel, so it's drawn sharp there and not stretched (1 if the browser doesn't say).
 */
export function previewPx(cssPx: number, dpr: number): number {
  return Math.ceil(cssPx * (dpr > 0 ? dpr : 1));
}

/** The head's and the emblem's icons, which must be in `icons` (generated from the same table as the races and classes). */
function iconsOf(race: NpcRace, cls: NpcClass, icons: NpcIcons): { head: NpcIcon; emblem: NpcIcon } {
  const head = icons[race.icon];
  const emblem = icons[cls.icon];
  if (!head || !emblem) throw new Error(`${npcAssetName(race, cls)}: no icon`);
  return { head, emblem };
}

/** Draws the token onto `ctx`, `px` across (a canvas of that size). */
export function drawNpcArt(ctx: CanvasRenderingContext2D, race: NpcRace, cls: NpcClass, icons: NpcIcons, px = ART_PX): void {
  const r = px / 2;
  const { head, emblem } = iconsOf(race, cls, icons);
  ctx.clearRect(0, 0, px, px);
  const circle = (x: number, y: number, radius: number) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
  };
  const icon = (i: NpcIcon, box: number, cx: number, cy: number, color: string) => {
    const at = iconPlacement(i.fit, box, cx, cy);
    ctx.save();
    ctx.clip();
    ctx.translate(at.x, at.y);
    ctx.scale(at.scale, at.scale);
    ctx.fillStyle = color;
    ctx.fill(new Path2D(i.path));
    ctx.restore();
  };
  circle(r, r, ART.rim * r);
  ctx.fillStyle = ART.rimColor;
  ctx.fill();
  circle(r, r, ART.ringOuter * r);
  ctx.fillStyle = cls.color;
  ctx.fill();
  circle(r, r, ART.ringInner * r);
  ctx.fillStyle = ART.discColor;
  ctx.fill();
  // The head, kept inside the disc.
  icon(head, ART.headBox * r, r, ART.headY * r, race.tint);
  // The badge, over the ring at the bottom right, and the emblem kept inside it.
  circle(ART.badgeX * r, ART.badgeY * r, ART.badgeRim * r);
  ctx.fillStyle = ART.rimColor;
  ctx.fill();
  circle(ART.badgeX * r, ART.badgeY * r, ART.badge * r);
  ctx.fillStyle = cls.color;
  ctx.fill();
  icon(emblem, ART.emblemBox * r, ART.badgeX * r, ART.badgeY * r, ART.emblemColor);
}

/** The token picture as an image file (WebP, or PNG where the browser can't make WebP). */
export async function npcArtFile(race: NpcRace, cls: NpcClass, icons: NpcIcons): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = ART_PX;
  canvas.height = ART_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't draw the token.");
  drawNpcArt(ctx, race, cls, icons);
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  let blob = await encode("image/webp");
  // Older Safari can't encode WebP and silently returns PNG instead.
  if (!blob || blob.type !== "image/webp") blob = await encode("image/png");
  if (!blob) throw new Error("This browser couldn't draw the token.");
  // Uploads are named after their file, less its extension.
  return new File([blob], `${npcAssetName(race, cls)}.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type });
}

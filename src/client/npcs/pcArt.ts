// A player character's token picture, drawn by the browser from their character sheet's race and
// classes: the class's full-body figure in action (PC_FIGURES; a subclass may have its own), cut
// out in the race's tint with a dark outline and a rim in the class's colour, standing on a soft
// shadow, with the classes' emblems on small shields at its feet. No disc, so the party stands
// apart from the NPCs on the map. Drawn once per character per room, ART_PX across, then
// uploaded as an ordinary token picture, so everyone sees the same.

import { iconPlacement } from "./art";
import type { NpcClass, NpcIcon, NpcIcons, NpcRace } from "./npcs";
import { ART_PX } from "./npcs";
import { PC_FIGURES } from "./table";

const DARK = "#0b0d11";

/** The parts of the picture, as shares of its width. */
export const PC_ART = {
  /** The figure's 512 box, and where the middle of its drawing sits. */
  figureBox: 0.84,
  figureX: 0.5,
  figureY: 0.46,
  /** Its dark outline, and the class-coloured rim round that. */
  outline: 0.032,
  rim: 0.085,
  /** The shadow it stands on. */
  shadowY: 0.885,
  shadowW: 0.56,
  shadowH: 0.075,
  /** The emblems' shields: their width, and where their middles sit (one, or two side by side). */
  badgeW: 0.2,
  badgeY: 0.86,
  badgeOne: 0.78,
  badgeTwo: [0.2, 0.8],
};

/** The figure for a class, or for its subclass when that has its own (a Swashbuckler fences). */
export function figureFor(cls: Pick<NpcClass, "id">, subclass = ""): string {
  const sub = subclass.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (sub && PC_FIGURES[`${cls.id}/${sub}`]) || PC_FIGURES[cls.id] || PC_FIGURES.fighter;
}

/** A heater shield's outline, `w` wide and `h` tall, its top left at (x, y). */
function shieldPath(x: number, y: number, w: number, h: number): Path2D {
  const p = new Path2D();
  p.moveTo(x, y + h * 0.04);
  p.quadraticCurveTo(x + w / 2, y - h * 0.04, x + w, y + h * 0.04);
  p.lineTo(x + w, y + h * 0.45);
  p.bezierCurveTo(x + w, y + h * 0.75, x + w * 0.72, y + h * 0.9, x + w / 2, y + h);
  p.bezierCurveTo(x + w * 0.28, y + h * 0.9, x, y + h * 0.75, x, y + h * 0.45);
  p.closePath();
  return p;
}

function drawIcon(ctx: CanvasRenderingContext2D, i: NpcIcon, box: number, cx: number, cy: number, fill: string, outline?: { color: string; width: number }): void {
  const at = iconPlacement(i.fit, box, cx, cy);
  const path = new Path2D(i.path);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(at.scale, at.scale);
  if (outline) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = outline.color;
    ctx.lineWidth = outline.width / at.scale;
    ctx.stroke(path);
  }
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.restore();
}

/** A class's emblem on a small shield centred at (cx, cy), `w` wide. */
function badge(ctx: CanvasRenderingContext2D, cls: NpcClass, icons: NpcIcons, cx: number, cy: number, w: number): void {
  const h = w * 1.15;
  const rim = w * 0.09;
  ctx.fillStyle = DARK;
  ctx.fill(shieldPath(cx - w / 2 - rim, cy - h / 2 - rim, w + 2 * rim, h + 2 * rim));
  ctx.fillStyle = cls.color;
  ctx.fill(shieldPath(cx - w / 2, cy - h / 2, w, h));
  const emblem = icons[cls.icon];
  if (emblem) drawIcon(ctx, emblem, w * 0.76, cx, cy - h * 0.04, DARK);
}

/**
 * Draws the token onto `ctx`, `px` across. `classes`: the first class, then a second if there is
 * one; `figure`: the figure's icon (figureFor the first class and its subclass).
 */
export function drawPcArt(ctx: CanvasRenderingContext2D, race: NpcRace, classes: readonly NpcClass[], figure: string, icons: NpcIcons, px = ART_PX): void {
  const body = icons[figure];
  const [first, second] = classes;
  if (!body || !first) throw new Error("No figure for this character");
  ctx.clearRect(0, 0, px, px);
  const A = PC_ART;
  // The shadow it stands on.
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.ellipse(px / 2, A.shadowY * px, (A.shadowW * px) / 2, (A.shadowH * px) / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // The figure: rimmed in the class's colour (with a little shadow, so it lifts off the map), then
  // outlined dark and filled in the race's tint.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = px * 0.03;
  ctx.shadowOffsetY = px * 0.012;
  drawIcon(ctx, body, A.figureBox * px, A.figureX * px, A.figureY * px, first.color, { color: first.color, width: A.rim * px });
  ctx.restore();
  drawIcon(ctx, body, A.figureBox * px, A.figureX * px, A.figureY * px, race.tint, { color: DARK, width: A.outline * px });
  // The emblems at its feet.
  const w = A.badgeW * px;
  if (second) {
    badge(ctx, first, icons, A.badgeTwo[0] * px, A.badgeY * px, w);
    badge(ctx, second, icons, A.badgeTwo[1] * px, A.badgeY * px, w);
  } else {
    badge(ctx, first, icons, A.badgeOne * px, A.badgeY * px, w);
  }
}

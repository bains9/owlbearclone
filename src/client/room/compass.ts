// The compass rose the GM can put on a map. It's a token drawn by the browser (art
// "compass"), so it moves, turns, sizes, locks, undoes and syncs like any token; its
// rotation is where North points, clockwise from up. Kept apart from the board (no Konva)
// so the numbers can be tested.

/** A new compass: two squares across, North up, the needle red. */
export const COMPASS_SIZE = 2;
export const COMPASS_COLOR = "#d62f2f";
/** Its label, never shown on it (code from before compasses isn't sent them). */
export const COMPASS_LABEL = "N";
/** Alt+wheel sizes it a quarter square a step, as the Build tool's objects. */
export const COMPASS_SIZE_STEP = 0.25;
export const COMPASS_SIZE_MIN = 0.5;
export const COMPASS_SIZE_MAX = 6;
/** The bar's dial turns in steps of this many degrees (the wheel: 15, or 5 with Z). */
export const COMPASS_DIAL_STEP = 5;
/**
 * The middle of a compass, as a share of its radius: a click there picks it. Elsewhere on it a
 * click goes on to whatever is under it (a prop, a drawing, a note), if anything is.
 */
export const COMPASS_CORE = 0.35;

/** An angle turned by `deg`, kept within 0 to 360. */
export function turnBy(rotation: number, deg: number): number {
  const r = Math.round((((rotation + deg) % 360) + 360) % 360 * 100) / 100;
  return r === 360 ? 0 : r;
}

/** A size changed by `d` squares, on quarter squares, kept between the smallest and biggest. */
export function sizeBy(size: number, d: number): number {
  const q = Math.round((size + d) / COMPASS_SIZE_STEP) * COMPASS_SIZE_STEP;
  return Math.min(COMPASS_SIZE_MAX, Math.max(COMPASS_SIZE_MIN, q));
}

/** Where North points, as the bar's dial shows it: 0 to 355 in its steps. */
export function dialValue(rotation: number): number {
  return turnBy(Math.round(rotation / COMPASS_DIAL_STEP) * COMPASS_DIAL_STEP, 0);
}

/** Whether world point `p` is in the middle of a compass (see COMPASS_CORE). */
export function inCompassCore(t: { x: number; y: number; size: number }, cell: number, p: { x: number; y: number }): boolean {
  return Math.hypot(p.x - t.x, p.y - t.y) <= ((t.size * cell) / 2) * COMPASS_CORE;
}

/**
 * Whether a token covers world point `p`, near enough for a click: a disc, or for a picture
 * the square it's fitted into, turned with the token.
 */
export function tokenCovers(
  t: { x: number; y: number; size: number; rotation: number; assetId: string | null },
  cell: number,
  p: { x: number; y: number },
): boolean {
  const r = (t.size * cell) / 2;
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  if (!t.assetId) return Math.hypot(dx, dy) <= r;
  const a = (-t.rotation * Math.PI) / 180;
  const u = dx * Math.cos(a) - dy * Math.sin(a);
  const v = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(u) <= r && Math.abs(v) <= r;
}

/** One compass as it's drawn over the fog: where, which way, how big (radius), what colour, and whether it shows. */
export interface CompassLook {
  id: string;
  x: number;
  y: number;
  rotation: number;
  r: number;
  color: string;
  shown: boolean;
}

/**
 * What the compasses drawn over the fog look like, as one string. The fog is redrawn only
 * when this changes, not for every token that moves.
 */
export function compassesKey(list: Iterable<CompassLook>): string {
  const parts: string[] = [];
  for (const c of list) parts.push(`${c.id}:${c.x},${c.y},${c.rotation},${c.r},${c.color},${c.shown ? 1 : 0}`);
  return parts.join("|");
}

const TAU = Math.PI * 2;
/** The dark outline and the light halo round everything, so it reads on dark and light maps alike. */
const INK = "#16191f";
const PAPER = "#f7f2e6";
const SHADE = "#4a505b";

/** A colour mixed towards black (k: 0 none, 1 black). */
function darker(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - k)).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** One point of the rose, `deg` clockwise from up: a kite, its left half `left` and right half `right`. */
function point(c: CanvasRenderingContext2D, deg: number, len: number, half: number, left: string, right: string, line: number): void {
  c.save();
  c.rotate((deg * Math.PI) / 180);
  for (const [side, fill] of [
    [-1, left],
    [1, right],
  ] as const) {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(side * half, -half);
    c.lineTo(0, -len);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(half, -half);
  c.lineTo(0, -len);
  c.lineTo(-half, -half);
  c.closePath();
  c.lineWidth = line;
  c.strokeStyle = INK;
  c.stroke();
  c.restore();
}

/**
 * A letter with a dark edge and a light halo inside it, at x, y on the rose but turned back by
 * the rose's `rotation`, so it stays upright on screen whichever way North points (a turned N
 * reads as a Z, a turned W as an M).
 */
function letter(c: CanvasRenderingContext2D, text: string, x: number, y: number, rotation: number, size: number, fill: string, font: string): void {
  c.save();
  c.translate(x, y);
  c.rotate((-rotation * Math.PI) / 180);
  c.font = `bold ${size}px ${font}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  if (fill === INK) {
    // A dark letter in a light halo: reads on dark and light maps, and a small E or W keeps
    // its gaps (two outlines round it filled them in, and it read as a box).
    c.lineWidth = size * 0.24;
    c.strokeStyle = PAPER;
    c.strokeText(text, 0, 0);
  } else {
    c.lineWidth = size * 0.3;
    c.strokeStyle = INK;
    c.strokeText(text, 0, 0);
    c.lineWidth = size * 0.14;
    c.strokeStyle = PAPER;
    c.strokeText(text, 0, 0);
  }
  c.fillStyle = fill;
  c.fillText(text, 0, 0);
  c.restore();
}

/**
 * Draws a compass rose of radius r round 0,0, North up (the caller turns the canvas by
 * `rotation`, which the letters undo to stay upright): a ring, eight points, the North needle
 * in `color` and longer than the rest, and the letters outside the ring, a bold N in `color`
 * and a smaller E, S and W. Paths and text, so it's sharp at any zoom.
 */
export function drawCompass(c: CanvasRenderingContext2D, r: number, rotation: number, color: string, font: string): void {
  const line = r * 0.025;
  const ring = r * 0.66;
  c.save();
  c.lineJoin = "round";
  // A faint light disc behind the rose, and the ring: dark outside, light inside.
  c.beginPath();
  c.arc(0, 0, ring, 0, TAU);
  c.fillStyle = "rgba(247, 242, 230, 0.3)";
  c.fill();
  c.lineWidth = r * 0.07;
  c.strokeStyle = INK;
  c.stroke();
  c.lineWidth = r * 0.03;
  c.strokeStyle = PAPER;
  c.stroke();
  // Ticks round the ring every 30 degrees.
  c.lineWidth = r * 0.02;
  c.strokeStyle = INK;
  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) continue;
    const a = (i * TAU) / 12;
    c.beginPath();
    c.moveTo(Math.sin(a) * ring * 0.86, -Math.cos(a) * ring * 0.86);
    c.lineTo(Math.sin(a) * ring, -Math.cos(a) * ring);
    c.stroke();
  }
  // The in-between points, then East, South and West, then North on top of them all.
  for (const deg of [45, 135, 225, 315]) point(c, deg, r * 0.46, r * 0.085, SHADE, PAPER, line);
  for (const deg of [90, 180, 270]) point(c, deg, r * 0.62, r * 0.13, INK, PAPER, line);
  point(c, 0, r * 0.72, r * 0.15, darker(color, 0.35), color, line);
  // The hub.
  c.beginPath();
  c.arc(0, 0, r * 0.06, 0, TAU);
  c.fillStyle = PAPER;
  c.fill();
  c.lineWidth = line;
  c.strokeStyle = INK;
  c.stroke();
  // The letters, outside the ring.
  const d = r * 0.84;
  letter(c, "N", 0, -r * 0.86, rotation, r * 0.3, color, font);
  letter(c, "E", d, 0, rotation, r * 0.19, INK, font);
  letter(c, "S", 0, d, rotation, r * 0.19, INK, font);
  letter(c, "W", -d, 0, rotation, r * 0.19, INK, font);
  c.restore();
}

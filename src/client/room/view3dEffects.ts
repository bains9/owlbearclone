// Magic in the 3D view (view3d.ts): the spells on the map, as the flat map draws them, each on a
// sheet of its own in the scene. Spell areas that lie on the ground (a web, spike growth, a
// grease slick) and the looks on a token's feet (haste, a flyer's shadow) on the floor; spell areas
// in the air (a fog cloud, darkness, a stinking cloud) as two sheets stacked above the floor, so
// they hang among the figures like a cloud; the other looks on tokens and the spells being cast
// (a fireball, a lightning bolt) at a figure's middle. Fog and the dark hide them as they hide
// them in 2D, but for spells being cast, which the flat map draws over everything too. The board
// says where each is and draws it (board.ts effects3d); here, the arithmetic, kept apart from
// three.js so it's tested.

/** Where an effect's sheet hangs: on the floor, at a figure's middle, or in the air above it. */
export type EffectLevel = "ground" | "mid" | "air";

/** The heights (squares) of a level's sheets, and how see-through each is. */
export const EFFECT_SHEETS: Record<EffectLevel, { heights: readonly number[]; opacity: number }> = {
  ground: { heights: [0.02], opacity: 1 },
  mid: { heights: [0.5], opacity: 1 },
  air: { heights: [0.35, 0.95], opacity: 0.6 },
};

/** A rectangle in scene units. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One spell on the map, as the board gives it to the 3D view. */
export interface Effect3d {
  /** The same while it lasts: its drawing's, its token's and look's, or the cast's. */
  key: string;
  level: EffectLevel;
  /** Where it's drawn, with room round it, in scene units. */
  bounds: Bounds;
  /** Hidden by the fog and the dark as on the flat map (all but spells being cast). */
  mask: boolean;
  /** It moves (drawn again and again while it shows). */
  moving: boolean;
  /** Draws it onto `c`, set to scene units, `px` scene units a pixel, as it is at `now`. */
  draw(c: CanvasRenderingContext2D, now: number, px: number): void;
}

/** A spell area's sheet: the area's rectangle and some room round it (its edge glows past it). */
export function zoneBounds(points: readonly number[], cell: number): Bounds {
  const [ax, ay, bx, by] = points;
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const m = Math.max(cell * 0.5, Math.max(x1 - x0, y1 - y0) * 0.12);
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

/** A look on a token: round it, out to twice its size (sparkles, after-images close behind). */
export function tokenLookBounds(x: number, y: number, r: number, cell: number): Bounds {
  const m = r * 2 + cell * 0.5;
  return { x0: x - m, y0: y - m, x1: x + m, y1: y + m };
}

/** A spell being cast: from where it starts to where it lands, and its reach round both. */
export function castBounds(a: { x: number; y: number }, b: { x: number; y: number }, r: number, cell: number): Bounds {
  const m = Math.max(r, cell) + cell;
  return { x0: Math.min(a.x, b.x) - m, y0: Math.min(a.y, b.y) - m, x1: Math.max(a.x, b.x) + m, y1: Math.max(a.y, b.y) + m };
}

/**
 * An effect's sheet's pixels per scene unit: about 32 a square (24 on a phone or tablet), but the
 * sheet never more than 512 pixels across, so a big cloud doesn't cost a phone dear.
 */
export function effectScale(b: Bounds, cell: number, touch: boolean): number {
  const long = Math.max(b.x1 - b.x0, b.y1 - b.y0, 1);
  return Math.min((touch ? 24 : 32) / Math.max(cell, 1), 512 / long);
}

/** Whether two rectangles are the same size (a moved token's look keeps its sheet, just moved). */
export function sameSize(a: Bounds, b: Bounds): boolean {
  return Math.abs(a.x1 - a.x0 - (b.x1 - b.x0)) < 0.5 && Math.abs(a.y1 - a.y0 - (b.y1 - b.y0)) < 0.5;
}

/** Moving effects are drawn again at most this often (ms): smooth enough, light on a phone. */
export const EFFECT_STEP_MS = 50;

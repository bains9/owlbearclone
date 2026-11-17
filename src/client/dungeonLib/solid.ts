// Copied from Dungeon (src/render/solid.ts) by scripts/sync-dungeon-library.mjs, Dungeon 23e95e5. Change it there and run the script again.
// Objects in 3D (14 November 2026): every object in the library has a form, next to its drawing,
// that says how it stands up: a few low-poly parts (boxes, cylinders, lumps, gables, slabs and
// limbs) with their heights and colours, or a considered "lies flat" (a rug, a stain, a trapdoor).
// Table's 3D view stands objects up from these, Dungeon's builders see them through it, so there's
// one source (Table copies this file with the rest of the library: scripts/sync-dungeon-library.mjs).
//
// Units. Across the map a part is in the drawing's own units, the same numbers its draw code uses
// (cells at the object's natural size, centred on (0, 0), x to the right, z down the drawing, as
// the drawing's y), so a form can be checked against what's drawn. Up, heights are in metres, as
// you'd measure the real thing: a table's top at 0.75, a door 2.1, a wall 3. A square is 1.5 m.
// When an object is placed bigger or smaller, the whole form grows or shrinks with it.
//
// "The top of the drawing" (negative z) is an object's back: a chair's back, the wall a bookcase
// or a torch stands against, a bed's head. That's how the drawings are made.
//
// Nothing here knows three.js: solidMeshes gives flat arrays of triangles that any view can draw.

/** How many metres a square is (5 feet). */
export const SQUARE_M = 1.5;
/** How tall walls stand (Table's 3D view raises them this high): what pillars and wall-high things reach. */
export const WALL_M = 3;

/** A colour from 0 to 1 each. */
export type Rgb = readonly [number, number, number];

/** A material's lit and shaded side, as the drawings use them (propvariants.ts Tone). */
export interface TonePair {
  light: string;
  dark: string;
}

/**
 * A part's colour: "#rrggbb", a tone (its middle is used: the view shades it by its own light), or
 * the drawing's own colour as it's drawn now, `{ paint }`, for things that change with the seasons
 * (leaves, bushes, grass), with a colour to use before the drawing's is known.
 */
export type Col = string | TonePair | { paint: string };

interface PartBase {
  c: Col;
  /** Lit by itself (flames, glowing magic): drawn unlit, at full colour. */
  glow?: boolean;
}

/**
 * An upright box from (x0, z0) to (x1, z1), y0 to y1 metres up; its top `top` times its base
 * about its middle (1: straight sides), moved `sx`, `sz` from over its base (a lid tipped back, a
 * leaning board), and lower by `drop` metres along its z1 edge (a sloping desk, a ramp). Hollow
 * with `wall` (a trough, a cart's bed, an open crate): walls that thick, its inside floor at `floor`.
 */
export interface BoxPart extends PartBase {
  k: "box";
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  top: number;
  sx?: number;
  sz?: number;
  drop?: number;
  /** The whole box tipped, not only its top: its bottom drops along the z1 edge too (a lean-to's roof, a ramp of boards). */
  tilt?: boolean;
  wall?: number;
  floor?: number;
}

/** An upright cylinder (or cone, `top` 0) round (x, z), radii rx and rz, `n` sides; hollow (a tub, a well) with its inside `hollow` of its radius. */
export interface CylPart extends PartBase {
  k: "cyl";
  x: number;
  z: number;
  rx: number;
  rz: number;
  y0: number;
  y1: number;
  top: number;
  n: number;
  hollow?: number;
  floor?: number;
}

/** A lumpy ball (or smooth, `lump` 0) round (x, z), radii rx and rz, from y0 up to y1. */
export interface BallPart extends PartBase {
  k: "ball";
  x: number;
  z: number;
  rx: number;
  rz: number;
  y0: number;
  y1: number;
  lump: number;
  n: number;
}

/** A gable (a tent, a little roof, a wedge): its base from (x0, z0) to (x1, z1) at y0, its ridge at y1 along x or z, `ridge` of the base wide (0: sharp). */
export interface GablePart extends PartBase {
  k: "gable";
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  along: "x" | "z";
  ridge: number;
}

/** An upright slab of a convex outline (x, z pairs), y0 to y1; its top `top` times its base about its middle; hollow (a boat) with its inside `hollow` of its size. */
export interface SlabPart extends PartBase {
  k: "slab";
  pts: readonly number[];
  y0: number;
  y1: number;
  top: number;
  hollow?: number;
  floor?: number;
}

/** A tapered rod between two points (x, metres up, z): a branch, a leaning pole, a barrel on its side, a wheel. Radii in drawing units. */
export interface LimbPart extends PartBase {
  k: "limb";
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  r0: number;
  r1: number;
  n: number;
}

export type Part = BoxPart | CylPart | BallPart | GablePart | SlabPart | LimbPart;

/** An object that stands up: its parts, and how it sits with others. */
export interface Solid {
  parts: readonly Part[];
  /**
   * A top other things can stand on (a table, a counter, a crate), this many metres up: an object
   * that `rests` (a tankard, a candle, a book) placed over it later sits on it.
   */
  surface?: number;
  /** It sits on whatever's under it with a `surface` (on the floor if nothing is). */
  rests?: boolean;
  /**
   * Why its form covers less of the map than its drawing does, when it's meant to: the drawing
   * shows its face (an archery target standing up), or a soft glow round it.
   */
  note?: string;
  /**
   * Its drawing stays painted on the floor under what stands up (a ritual circle under its candles,
   * the plate under a sprung trap's spikes). Otherwise a view leaves the drawing off the floor where
   * the object stands, so it isn't shown twice.
   */
  painted?: boolean;
}

/** Whether a view leaves an object's drawing off the floor (it stands up in its place), or paints it as usual. */
export const standsInsteadOfPaint = (f: Form): boolean => !isFlat(f) && !f.painted;

/** An object that lies flat on the floor in 3D, and why (a rug, a stain, a trapdoor, a way down). */
export interface Flat {
  flat: string;
}

export type Form = Solid | Flat;

/** What a definition gives: a form, or one made for the object's own size (its drawing's w by h). */
export type FormSpec = Form | ((w: number, h: number) => Form);

export const isFlat = (f: Form): f is Flat => "flat" in f;

// ---------------------------------------------------------------- making forms

/** Parts, or lists of them, as deep as a form's made (a row of barrels, each of four parts). */
export type PartList = Part | readonly PartList[];

const flatten = (list: readonly PartList[]): Part[] => (list as unknown[]).flat(Infinity) as Part[];

/** An object that stands up, made of these parts. */
export function solid(parts: readonly PartList[], more: Omit<Solid, "parts"> = {}): Solid {
  return { parts: flatten(parts), ...more };
}

/** An object that lies flat, and why. */
export const flat = (why: string): Flat => ({ flat: why });

type BoxMore = { top?: number; glow?: boolean; sx?: number; sz?: number; drop?: number; tilt?: boolean; wall?: number; floor?: number };

/** A box from (x0, z0) to (x1, z1), y0 to y1 metres up. */
export const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, c: Col, more: BoxMore = {}): BoxPart => ({
  k: "box", x0, x1, z0, z1, y0, y1, c, top: more.top ?? 1,
  ...(more.glow ? { glow: true } : {}),
  ...(more.sx ? { sx: more.sx } : {}),
  ...(more.sz ? { sz: more.sz } : {}),
  ...(more.drop ? { drop: more.drop } : {}),
  ...(more.tilt ? { tilt: true } : {}),
  ...(more.wall ? { wall: more.wall, floor: more.floor ?? y0 + 0.05 } : {}),
});

/** A box `w` by `d` centred on (x, z). */
export const cbox = (w: number, d: number, y0: number, y1: number, c: Col, x = 0, z = 0, more: BoxMore = {}): BoxPart =>
  box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y0, y1, c, more);

type CylMore = { x?: number; z?: number; rz?: number; top?: number; n?: number; glow?: boolean; hollow?: number; floor?: number };

/** A cylinder of radius r (rz for an oval) round (x, z). */
export const cyl = (r: number, y0: number, y1: number, c: Col, more: CylMore = {}): CylPart => ({
  k: "cyl", x: more.x ?? 0, z: more.z ?? 0, rx: r, rz: more.rz ?? r, y0, y1, c, top: more.top ?? 1, n: more.n ?? 8,
  ...(more.glow ? { glow: true } : {}),
  ...(more.hollow ? { hollow: more.hollow, floor: more.floor ?? y0 + 0.05 } : {}),
});

/** A hollow cylinder: a tub, a well's wall, a bucket, a basin. `inside` is the inside's share of the radius. */
export const tub = (r: number, y0: number, y1: number, c: Col, inside: number, more: Omit<CylMore, "hollow"> = {}): CylPart =>
  cyl(r, y0, y1, c, { n: 12, ...more, hollow: inside, floor: more.floor ?? y0 + Math.min(0.08, (y1 - y0) * 0.3) });

/** A cone of radius r. */
export const cone = (r: number, y0: number, y1: number, c: Col, more: { x?: number; z?: number; rz?: number; n?: number; glow?: boolean } = {}): CylPart => cyl(r, y0, y1, c, { ...more, top: 0 });

/** A ball of radius r (rz for an oval), from y0 up to y1. */
export const ball = (r: number, y0: number, y1: number, c: Col, more: { x?: number; z?: number; rz?: number; lump?: number; n?: number; glow?: boolean } = {}): BallPart => ({
  k: "ball", x: more.x ?? 0, z: more.z ?? 0, rx: r, rz: more.rz ?? r, y0, y1, c, lump: more.lump ?? 0, n: more.n ?? 8, ...(more.glow ? { glow: true } : {}),
});

/** A gable over (x0, z0) to (x1, z1), its ridge along `along`. */
export const gable = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, along: "x" | "z", c: Col, more: { ridge?: number; glow?: boolean } = {}): GablePart => ({
  k: "gable", x0, x1, z0, z1, y0, y1, along, c, ridge: more.ridge ?? 0, ...(more.glow ? { glow: true } : {}),
});

/** A slab of a convex outline. */
export const slab = (pts: readonly number[], y0: number, y1: number, c: Col, more: { top?: number; glow?: boolean; hollow?: number; floor?: number } = {}): SlabPart => ({
  k: "slab", pts, y0, y1, c, top: more.top ?? 1,
  ...(more.glow ? { glow: true } : {}),
  ...(more.hollow ? { hollow: more.hollow, floor: more.floor ?? y0 + 0.05 } : {}),
});

/** A rod from a to b (x, metres up, z), radius r0 at a and r1 at b. */
export const limb = (a: readonly [number, number, number], b: readonly [number, number, number], r0: number, r1 = r0, c: Col = "#6a4a30", more: { n?: number; glow?: boolean } = {}): LimbPart => ({
  k: "limb", a, b, r0, r1, c, n: more.n ?? 6, ...(more.glow ? { glow: true } : {}),
});

/** A straight upright post of radius r at (x, z). */
export const post = (x: number, z: number, r: number, y0: number, y1: number, c: Col, n = 6): CylPart => cyl(r, y0, y1, c, { x, z, n });

/** Four square legs under a top from (x0, z0) to (x1, z1), `t` thick, from the floor to y. */
export function legs(x0: number, x1: number, z0: number, z1: number, y: number, c: Col, t = 0.06): BoxPart[] {
  const out: BoxPart[] = [];
  for (const x of [x0 + t / 2, x1 - t / 2]) for (const z of [z0 + t / 2, z1 - t / 2]) out.push(cbox(t, t, 0, y, c, x, z));
  return out;
}

/** Outline points (x, z pairs) moved by (tx, tz), then turned by `a` radians: as a drawing's rotate then translate does. */
export function turned(pts: readonly number[], a: number, tx = 0, tz = 0): number[] {
  const c = Math.cos(a), s = Math.sin(a);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] + tx, z = pts[i + 1] + tz;
    out.push(x * c - z * s, x * s + z * c);
  }
  return out;
}

/** A box `w` by `d` centred on (x, z), turned `a` radians (a crate set down askew). */
export const rbox = (x: number, z: number, w: number, d: number, a: number, y0: number, y1: number, c: Col, more: { top?: number } = {}): SlabPart => {
  const pts = turned([-w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2], a);
  return slab(pts.map((v, i) => v + (i % 2 ? z : x)), y0, y1, c, more);
};

/** A board standing on edge from (x0, z0) to (x1, z1), `t` thick (a screen's panel, a rail at an angle). */
export const panel = (x0: number, z0: number, x1: number, z1: number, t: number, y0: number, y1: number, c: Col): SlabPart => {
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * (t / 2), nz = (dx / l) * (t / 2);
  return slab([x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz], y0, y1, c);
};

/** The flame of a fire, a torch or a candle: glowing, from y0, `h` metres tall and `r` across at its foot, at (x, z). */
export function fire(x: number, z: number, y0: number, h: number, r: number, c = "#ffa63a"): CylPart[] {
  return [
    cyl(r * 0.8, y0, y0 + h * 0.3, c, { x, z, top: 1.15, n: 6, glow: true }),
    cone(r * 0.92, y0 + h * 0.3, y0 + h, c === "#ffa63a" ? "#ffd27a" : c, { x, z, n: 6, glow: true }),
  ];
}

/** A wheel on its axle along x at (x, z), radius r (drawing units), `t` wide. */
export const wheel = (x: number, z: number, r: number, t: number, c: Col = "#3a2a1a"): LimbPart =>
  limb([x - t / 2, r * SQUARE_M, z], [x + t / 2, r * SQUARE_M, z], r, r, c, { n: 10 });

/** The middle of a tone (the view shades it), as "#rrggbb". */
export function mid(t: TonePair): string {
  const a = hex(t.light), b = hex(t.dark);
  return toHex([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

/** A colour lighter (k > 0) or darker (k < 0). */
export function tint(c: string, k: number): string {
  const v = hex(c);
  const to = k > 0 ? 255 : 0;
  return toHex(v.map((x) => x + (to - x) * Math.abs(k)));
}

/** The drawing's own colour (it changes with the seasons), or `fallback` before it's known. */
export const paint = (fallback: string): Col => ({ paint: fallback });

// ---- Shapes many objects share, each made for the object's own w by h box ----

/** A recipe with more parts added (things on a table's top, a cloth over it). */
export const plus = (base: FormSpec, ...more: PartList[]) =>
  (w: number, h: number): Form => {
    const f = typeof base === "function" ? base(w, h) : base;
    return isFlat(f) ? f : { ...f, parts: [...f.parts, ...flatten(more)] };
  };

/** A recipe that rests on tables and counters. */
export const resting = (base: FormSpec) =>
  (w: number, h: number): Form => {
    const f = typeof base === "function" ? base(w, h) : base;
    return isFlat(f) ? f : { ...f, rests: true };
  };

/** A plain block filling the box (inset a little, as drawings are), `y1` metres tall. */
export const block = (y1: number, c: Col, more: { inset?: number; y0?: number; top?: number; surface?: boolean; rests?: boolean } = {}) =>
  (w: number, h: number): Solid => {
    const i = more.inset ?? 0.04;
    return solid([box(-w / 2 + i, w / 2 - i, -h / 2 + i, h / 2 - i, more.y0 ?? 0, y1, c, { top: more.top })], {
      ...(more.surface ? { surface: y1 } : {}),
      ...(more.rests ? { rests: true } : {}),
    });
  };

/** A round thing filling the box, `y1` metres tall (an oval in a long box). */
export const drum = (y1: number, c: Col, more: { inset?: number; y0?: number; top?: number; n?: number; surface?: boolean; rests?: boolean } = {}) =>
  (w: number, h: number): Solid => {
    const i = more.inset ?? 0.03;
    return solid([cyl(w / 2 - i, more.y0 ?? 0, y1, c, { rz: h / 2 - i, top: more.top, n: more.n ?? 10 })], {
      ...(more.surface ? { surface: y1 } : {}),
      ...(more.rests ? { rests: true } : {}),
    });
  };

/** A lump filling the box (a sack, a heap), `y1` metres tall; `sink` of it under the floor (a heap is a ball's top). */
export const lump = (y1: number, c: Col, more: { inset?: number; lump?: number; n?: number; sink?: number; rests?: boolean } = {}) =>
  (w: number, h: number): Solid => {
    const i = more.inset ?? 0.04;
    const s = more.sink ?? 0;
    const tall = y1 / (1 - s);
    return solid([ball(w / 2 - i, -tall * s, y1, c, { rz: h / 2 - i, lump: more.lump ?? 0.12, n: more.n ?? 8 })], more.rests ? { rests: true } : {});
  };

/** A table: a top `thick` deep at `y` metres on four legs, filling the box. */
export const table = (y: number, top: Col, legCol: Col = top, more: { thick?: number; leg?: number; inset?: number } = {}) =>
  (w: number, h: number): Solid => {
    const i = more.inset ?? 0.02, t = more.thick ?? 0.05, l = more.leg ?? Math.min(0.09, Math.min(w, h) * 0.12);
    const x0 = -w / 2 + i, x1 = w / 2 - i, z0 = -h / 2 + i, z1 = h / 2 - i;
    return solid([box(x0, x1, z0, z1, y - t, y, top), legs(x0 + 0.04, x1 - 0.04, z0 + 0.04, z1 - 0.04, y - t, legCol, l)], { surface: y });
  };

/** A round table: a disc at `y` metres on a pedestal. */
export const roundTable = (y: number, top: Col, foot: Col = top) =>
  (w: number, h: number): Solid =>
    solid([cyl(w / 2 - 0.02, y - 0.05, y, top, { rz: h / 2 - 0.02, n: 14 }), cyl(Math.min(w, h) * 0.07, 0, y - 0.05, foot, { n: 6 }), cyl(Math.min(w, h) * 0.22, 0, 0.06, foot, { n: 8 })], { surface: y });

/**
 * A seat: a seat `seatY` metres up filling the box, with a back to `backY` along the side `back`
 * ("n": the top of the drawing, the usual), on four legs (or solid to the floor); arms to `armY`.
 */
export const seat = (seatY: number, backY: number, c: Col, more: { back?: "n" | "s" | "e" | "w" | "none"; cushion?: Col; armY?: number; backDepth?: number; legs?: boolean } = {}) =>
  (w: number, h: number): Solid => {
    const x0 = -w / 2 + 0.03, x1 = w / 2 - 0.03, z0 = -h / 2 + 0.03, z1 = h / 2 - 0.03;
    const parts: Part[] = [];
    const legsOn = more.legs ?? true;
    const pad = Math.min(0.07, seatY * 0.2);
    if (legsOn) parts.push(...legs(x0 + 0.02, x1 - 0.02, z0 + 0.02, z1 - 0.02, seatY - pad, c, Math.min(0.07, Math.min(w, h) * 0.12)));
    parts.push(box(x0, x1, z0, z1, legsOn ? seatY - pad : 0, seatY, more.cushion ?? c));
    const bd = more.backDepth ?? Math.min(0.14, Math.min(w, h) * 0.22);
    const side = more.back ?? "n";
    if (side === "n") parts.push(box(x0, x1, z0, z0 + bd, 0, backY, c));
    if (side === "s") parts.push(box(x0, x1, z1 - bd, z1, 0, backY, c));
    if (side === "w") parts.push(box(x0, x0 + bd, z0, z1, 0, backY, c));
    if (side === "e") parts.push(box(x1 - bd, x1, z0, z1, 0, backY, c));
    if (more.armY) {
      const a = Math.min(0.14, w * 0.15);
      if (side === "n" || side === "s" || side === "none") parts.push(box(x0, x0 + a, z0, z1, 0, more.armY, c), box(x1 - a, x1, z0, z1, 0, more.armY, c));
      else parts.push(box(x0, x1, z0, z0 + a, 0, more.armY, c), box(x0, x1, z1 - a, z1, 0, more.armY, c));
    }
    return solid(parts, { surface: seatY });
  };

/**
 * A tall piece against a wall (a wardrobe, a cabinet): `y1` metres tall, its back along the top of
 * the drawing, its doors on the front, so you see past it, not over it.
 */
export const tall = (y1: number, c: Col, more: { front?: Col; plinth?: number } = {}) =>
  (w: number, h: number): Solid => {
    const x0 = -w / 2 + 0.03, x1 = w / 2 - 0.03, z0 = -h / 2 + 0.03, z1 = h / 2 - 0.03;
    const parts: Part[] = [box(x0, x1, z0, z1, 0, y1, c)];
    if (more.front) parts.push(box(x0 + 0.05, x1 - 0.05, z1 - 0.005, z1 + 0.005, more.plinth ?? 0.1, y1 - 0.08, more.front));
    return solid(parts, { surface: y1 });
  };

/** A bed: a frame and mattress to `y` metres filling the box, a headboard to `head` at the top of the drawing, a pillow and a cover. */
export const bed = (y: number, head: number, frame: Col, cover: Col, more: { sheet?: Col; foot?: number; pillows?: number } = {}) =>
  (w: number, h: number): Solid => {
    const x0 = -w / 2 + 0.03, x1 = w / 2 - 0.03, z0 = -h / 2 + 0.03, z1 = h / 2 - 0.03;
    const hb = Math.min(0.1, h * 0.06);
    const sheet = more.sheet ?? "#ece4d0";
    const parts: Part[] = [
      box(x0, x1, z0, z1, 0, y - 0.2, frame),
      box(x0 + 0.04, x1 - 0.04, z0 + hb, z1 - 0.04, y - 0.2, y - 0.04, sheet),
      // The cover over the lower two thirds, the pillows at the head.
      box(x0 + 0.03, x1 - 0.03, z0 + h * 0.3, z1 - 0.03, y - 0.06, y, cover),
      box(x0, x1, z0, z0 + hb, 0, head, frame),
    ];
    const n = more.pillows ?? (w > 1.5 ? 2 : 1);
    const pw = (x1 - x0 - 0.2) / n;
    for (let i = 0; i < n; i++) parts.push(box(x0 + 0.1 + i * pw + 0.03, x0 + 0.1 + (i + 1) * pw - 0.03, z0 + hb + 0.04, z0 + hb + Math.min(0.35, h * 0.17), y - 0.04, y + 0.08, sheet, { top: 0.85 }));
    if (more.foot) parts.push(box(x0, x1, z1 - hb, z1, 0, more.foot, frame));
    return solid(parts, { surface: y });
  };

/** A barrel standing at (x, z), radius r, `y1` metres tall: bellied, with two dark hoops. */
export function barrelAt(x: number, z: number, r: number, y1: number, staves: Col, hoops: Col = "#3a3a3e"): CylPart[] {
  return [
    cyl(r * 0.88, 0, y1 * 0.5, staves, { x, z, top: 1 / 0.88, n: 10 }),
    cyl(r, y1 * 0.5, y1, staves, { x, z, top: 0.88, n: 10 }),
    cyl(r * 0.93, y1 * 0.16, y1 * 0.22, hoops, { x, z, top: 1.04, n: 10 }),
    cyl(r * 0.97, y1 * 0.78, y1 * 0.84, hoops, { x, z, top: 0.96, n: 10 }),
  ];
}

/** A barrel standing up filling the box, `y1` metres tall. */
export const barrel = (y1: number, staves: Col, hoops: Col = "#3a3a3e", more: { rests?: boolean } = {}) =>
  (w: number, h: number): Solid => solid([barrelAt(0, 0, Math.min(w, h) / 2 - 0.02, y1, staves, hoops)], { surface: y1, ...(more.rests ? { rests: true } : {}) });

/** A barrel on its side along x, filling the box, with hoops. */
export const barrelLying = (staves: Col, hoops: Col = "#3a3a3e") =>
  (w: number, h: number): Solid => {
    const r = h / 2 - 0.03, l = w / 2 - 0.03, y = r * SQUARE_M;
    return solid([
      limb([-l, y, 0], [-l * 0.45, y, 0], r * 0.86, r, staves, { n: 10 }),
      limb([-l * 0.45, y, 0], [l * 0.45, y, 0], r, r, staves, { n: 10 }),
      limb([l * 0.45, y, 0], [l, y, 0], r, r * 0.86, staves, { n: 10 }),
      limb([-l * 0.62, y, 0], [-l * 0.52, y, 0], r * 1.02, r * 1.02, hoops, { n: 10 }),
      limb([l * 0.52, y, 0], [l * 0.62, y, 0], r * 1.02, r * 1.02, hoops, { n: 10 }),
    ], { surface: r * 2 * SQUARE_M });
  };

/** A chest: a box with its lid a little proud, bands across, `y` metres tall; open, its lid stands up behind. */
export const chest = (y: number, body: Col, band: Col = "#3e3e44", more: { open?: boolean; lid?: Col; fill?: Col; rests?: boolean } = {}) =>
  (w: number, h: number): Solid => {
    const x0 = -w / 2 + 0.03, x1 = w / 2 - 0.03, z0 = -h / 2 + 0.03, z1 = h / 2 - 0.03;
    const parts: Part[] = [];
    const bw = Math.min(0.06, w * 0.06);
    if (more.open) {
      const body0 = z0 + (z1 - z0) * 0.28;
      parts.push(box(x0, x1, body0, z1, 0, y * 0.72, body, { wall: 0.05, floor: y * 0.4 }));
      if (more.fill) parts.push(box(x0 + 0.05, x1 - 0.05, body0 + 0.05, z1 - 0.05, y * 0.4, y * 0.66, more.fill));
      // The lid, opened back: drawn where it lies over the back of the drawing.
      parts.push(box(x0, x1, body0 - 0.04, body0, y * 0.72, y * 0.72 + (z1 - body0) * SQUARE_M * 0.8, more.lid ?? body, { sz: -(body0 - z0) * 0.9 }));
    } else {
      parts.push(box(x0, x1, z0, z1, 0, y * 0.72, body));
      parts.push(box(x0 - 0.01, x1 + 0.01, z0 - 0.01, z1 + 0.01, y * 0.72, y, more.lid ?? body, { top: 0.92 }));
      for (const x of [x0 + (x1 - x0) * 0.2, x1 - (x1 - x0) * 0.2]) parts.push(box(x - bw / 2, x + bw / 2, z0 - 0.015, z1 + 0.015, 0, y + 0.005, band, { top: 0.95 }));
    }
    return solid(parts, { surface: more.open ? y * 0.72 : y, ...(more.rests ? { rests: true } : {}) });
  };

/** A pot or urn at (x, z), radius r, `y1` metres tall: a foot, a belly, a neck and its dark mouth. */
export function vaseAt(x: number, z: number, r: number, y1: number, c: Col, more: { mouth?: number; neck?: number } = {}): CylPart[] {
  const mouth = more.mouth ?? 0.45;
  const neck = more.neck ?? 0.18;
  return [
    cyl(r * 0.6, 0, y1 * 0.12, c, { x, z, top: 1.35, n: 10 }),
    cyl(r * 0.81, y1 * 0.12, y1 * 0.5, c, { x, z, top: 1 / 0.81, n: 10 }),
    cyl(r, y1 * 0.5, y1 * (1 - neck), c, { x, z, top: mouth * 1.1, n: 10 }),
    cyl(r * mouth, y1 * (1 - neck), y1, c, { x, z, n: 10, hollow: 0.72, floor: y1 * (1 - neck) }),
  ];
}

/** A pot or urn filling the box. */
export const vase = (y1: number, c: Col, more: { mouth?: number; neck?: number; rests?: boolean } = {}) =>
  (w: number, h: number): Solid => solid([vaseAt(0, 0, Math.min(w, h) / 2 - 0.02, y1, c, more)], more.rests ? { rests: true } : {});

/** A counter (a bar, a kitchen's worktop): a body to `y` metres with an overhanging top. */
export const counter = (y: number, body: Col, top: Col = body) =>
  (w: number, h: number): Solid => {
    const x0 = -w / 2 + 0.03, x1 = w / 2 - 0.03, z0 = -h / 2 + 0.03, z1 = h / 2 - 0.03;
    return solid([box(x0 + 0.05, x1 - 0.05, z0 + 0.05, z1 - 0.05, 0, y - 0.05, body), box(x0, x1, z0, z1, y - 0.05, y, top)], { surface: y });
  };

/** A stool: a round seat `y` metres up on three splayed legs. */
export const stool = (y: number, c: Col, seatCol: Col = c) =>
  (w: number, h: number): Solid => {
    const r = Math.min(w, h) / 2 - 0.03;
    const parts: Part[] = [cyl(r, y - 0.05, y, seatCol, { n: 10 })];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      parts.push(limb([Math.cos(a) * r * 0.55, y - 0.05, Math.sin(a) * r * 0.55], [Math.cos(a) * r * 0.95, 0, Math.sin(a) * r * 0.95], 0.03, 0.025, c, { n: 5 }));
    }
    return solid(parts, { surface: y });
  };

/** Book spines, for shelves' fronts. */
export const BOOKS = ["#7a2a2a", "#2a4a7a", "#2f6a3a", "#7a6a2a", "#5a2a6a"];

/**
 * A bookcase against a wall, `y1` metres tall (a wall-high one you see past, not over): its back
 * along the top of the drawing, its shelves of books along the front.
 */
export const bookcase = (y1: number, wood: Col, more: { rows?: number; fill?: readonly string[] } = {}) =>
  (w: number, h: number): Solid => {
    const x0 = -w / 2 + 0.03, x1 = w / 2 - 0.03, z0 = -h / 2 + 0.03, z1 = h / 2 - 0.03;
    const rows = more.rows ?? Math.max(2, Math.round(y1 / 0.4));
    const fill = more.fill ?? BOOKS;
    const f = Math.min(0.08, (z1 - z0) * 0.3);
    const parts: Part[] = [box(x0, x1, z0, z1 - f, 0, y1, wood), box(x0, x1, z1 - f, z1, y1 - 0.05, y1, wood), box(x0, x0 + 0.05, z1 - f, z1, 0, y1, wood), box(x1 - 0.05, x1, z1 - f, z1, 0, y1, wood)];
    const step = (y1 - 0.15) / rows;
    for (let i = 0; i < rows; i++) {
      const y = 0.1 + i * step;
      parts.push(box(x0 + 0.05, x1 - 0.05, z1 - f, z1, y, y + 0.03, wood));
      parts.push(box(x0 + 0.06, x1 - 0.06, z1 - f, z1 - 0.01, y + 0.03, y + step * 0.78, fill[i % fill.length]));
    }
    return solid(parts, { surface: y1 });
  };

/** A small thing that sits on a table or the floor: a little drum (or lump) `y1` metres tall filling the box. */
export const small = (y1: number, c: Col, more: { top?: number; n?: number; lump?: boolean; glow?: boolean; inset?: number } = {}) =>
  (w: number, h: number): Solid => {
    const i = more.inset ?? 0.02;
    return more.lump
      ? solid([ball(w / 2 - i, 0, y1, c, { rz: h / 2 - i, lump: 0.15, n: 7, glow: more.glow })], { rests: true })
      : solid([cyl(w / 2 - i, 0, y1, c, { rz: h / 2 - i, top: more.top ?? 1, n: more.n ?? 8, glow: more.glow })], { rests: true });
  };

// ---- Growing things ----

/** Bark, for trunks and branches. */
export const BARK = "#5c4330";

/** How tall a tree of a kind stands, in metres, for its size `s` across (drawing units), as Table's 3D view has them. */
export function treeHeightM(kind: "leafy" | "spreading" | "pine" | "cypress" | "palm" | "bare", s: number): number {
  const sq = kind === "pine" ? 2.9 * s + 0.5 : kind === "cypress" ? 3.5 * s + 0.5 : kind === "palm" ? 3 * s + 0.5 : 1.4 * s + 0.3;
  return Math.min(20, sq) * SQUARE_M;
}

/**
 * A leafy tree: a trunk and a lumpy crown held up off the ground, so you see under it. Its crown is
 * nearly its whole width and about as deep as it is wide, starting a third of the way up.
 */
export const leafyTree = (crown: Col, more: { tall?: number; deep?: number; spread?: number; sx?: number; sz?: number; trunk?: Col; lump?: number } = {}) =>
  (w: number, h: number): Solid => {
    const s = Math.min(w, h);
    const H = treeHeightM("leafy", s) * (more.tall ?? 1);
    const deep = Math.min(H * 0.75, s * SQUARE_M * (more.deep ?? 0.96));
    const low = H - deep;
    const rx = (w / 2) * (more.sx ?? more.spread ?? 0.94), rz = (h / 2) * (more.sz ?? more.spread ?? 0.94);
    return solid([
      cyl(s * 0.055, 0, low + deep * 0.35, more.trunk ?? BARK, { top: 0.7, n: 6 }),
      ball(rx, low, H, crown, { rz, lump: more.lump ?? 0.16, n: 9 }),
    ]);
  };

/** An evergreen: a trunk and tiered cones, about three times as tall as it is wide. */
export const conifer = (needles: Col, more: { tall?: number; tiers?: number; trunk?: Col; narrow?: number; kind?: "pine" | "cypress" } = {}) =>
  (w: number, h: number): Solid => {
    const s = Math.min(w, h);
    const H = treeHeightM(more.kind ?? "pine", s) * (more.tall ?? 1);
    const r = (s / 2) * (more.narrow ?? 0.96);
    const tiers = more.tiers ?? 3;
    const parts: Part[] = [cyl(s * 0.045, 0, H * 0.25, more.trunk ?? BARK, { top: 0.7, n: 6 })];
    // Tiers from the bottom up, each narrower and higher, the last reaching the top.
    for (let i = 0; i < tiers; i++) {
      const k = tiers > 1 ? i / (tiers - 1) : 0;
      const y0 = tiers > 1 ? H * (0.14 + 0.4 * k) : H * 0.1;
      const y1 = tiers > 1 ? H * (0.62 + 0.38 * k) : H;
      parts.push(cone(r * (1 - k * 0.5), y0, y1, needles, { n: 9 }));
    }
    return solid(parts);
  };

/** A palm: a tall, leaning trunk and a flat spray of fronds. */
export const palmTree = (fronds: Col, more: { tall?: number; trunk?: Col } = {}) =>
  (w: number, h: number): Solid => {
    const s = Math.min(w, h);
    const H = treeHeightM("palm", s) * (more.tall ?? 1);
    // The trunk leans a little; the crown stays over what's drawn.
    return solid([
      limb([0, 0, 0], [s * 0.03, H, s * 0.02], s * 0.06, s * 0.04, more.trunk ?? "#8a6e4a"),
      ball((w / 2) * 0.9, H - 0.6, H + 0.5, fronds, { rz: (h / 2) * 0.9, lump: 0.3, n: 9, x: s * 0.03, z: s * 0.02 }),
    ]);
  };

/** A bare (dead) tree: a trunk and branching limbs, no leaves, as tall as a leafy one. */
export const bareTree = (wood: Col = "#6e5c48", more: { tall?: number; seed?: number; limbs?: number } = {}) =>
  (w: number, h: number): Solid => {
    const s = Math.min(w, h);
    const H = treeHeightM("bare", s) * (more.tall ?? 1);
    const r = s * 0.05;
    const fork = H * 0.4;
    const parts: Part[] = [limb([0, 0, 0], [0, fork, 0], r, r * 0.75, wood)];
    const seed = more.seed ?? 3;
    const n = more.limbs ?? 5;
    for (let i = 0; i < n; i++) {
      const a = ((i + noise(seed, i, 1) * 0.6) / n) * Math.PI * 2;
      const reach = (s / 2) * (0.72 + noise(seed, i, 2) * 0.22);
      const tip: [number, number, number] = [Math.cos(a) * reach * (w / s), H * (0.78 + noise(seed, i, 3) * 0.22), Math.sin(a) * reach * (h / s)];
      const elbow: [number, number, number] = [tip[0] * 0.45, fork + (tip[1] - fork) * 0.5, tip[2] * 0.45];
      parts.push(limb([0, fork * 0.98, 0], elbow, r * 0.62, r * 0.42, wood), limb(elbow, tip, r * 0.42, r * 0.1, wood));
      for (const turn of [0.8, -0.7]) {
        const b = a + turn;
        parts.push(limb(elbow, [elbow[0] + Math.cos(b) * reach * 0.42, elbow[1] + H * 0.14, elbow[2] + Math.sin(b) * reach * 0.42], r * 0.28, r * 0.06, wood, { n: 5 }));
      }
    }
    parts.push(limb([0, fork, 0], [s * 0.05, H, -s * 0.04], r * 0.6, r * 0.1, wood));
    return solid(parts);
  };

/** A bush: a lump about as tall as it is round, sitting on the ground. */
export const shrub = (leaves: Col, more: { tall?: number; lump?: number } = {}) =>
  (w: number, h: number): Solid => {
    const s = Math.min(w, h);
    const H = Math.min(2.4, s * SQUARE_M * (more.tall ?? 0.75));
    return solid([ball(w / 2 - 0.03, -H * 0.1, H, leaves, { rz: h / 2 - 0.03, lump: more.lump ?? 0.18, n: 8 })]);
  };

/** A rock: a low, lumpy mound (a boulder is taller). */
export const stone = (c: Col = "#86847e", more: { tall?: number; lump?: number } = {}) =>
  (w: number, h: number): Solid => {
    const s = Math.min(w, h);
    const H = s * SQUARE_M * (more.tall ?? 0.45);
    return solid([ball(w / 2 - 0.04, -H * 0.25, H, c, { rz: h / 2 - 0.04, lump: more.lump ?? 0.24, n: 7 })], { surface: H * 0.85 });
  };

// ---------------------------------------------------------------- reading a definition's form

const resolved = new WeakMap<object, Form>();

/** An object's form for its own size (a definition's `form` may be made for its w by h). */
export function formOf(def: { w: number; h: number; form: FormSpec }): Form {
  let f = resolved.get(def);
  if (!f) resolved.set(def, (f = typeof def.form === "function" ? def.form(def.w, def.h) : def.form));
  return f;
}

/** Where a form's parts reach, seen from above, in its drawing's units (null for one that lies flat). */
export function formBounds(f: Form): { x0: number; z0: number; x1: number; z1: number } | null {
  if (isFlat(f) || !f.parts.length) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const add = (x: number, z: number) => {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  };
  for (const p of f.parts) {
    switch (p.k) {
      case "box":
        add(p.x0, p.z0);
        add(p.x1, p.z1);
        if (p.sx || p.sz) {
          add(p.x0 + (p.sx ?? 0), p.z0 + (p.sz ?? 0));
          add(p.x1 + (p.sx ?? 0), p.z1 + (p.sz ?? 0));
        }
        break;
      case "gable":
        add(p.x0, p.z0);
        add(p.x1, p.z1);
        break;
      case "cyl":
      case "ball":
        add(p.x - p.rx, p.z - p.rz);
        add(p.x + p.rx, p.z + p.rz);
        break;
      case "slab":
        for (let i = 0; i < p.pts.length; i += 2) add(p.pts[i], p.pts[i + 1]);
        break;
      case "limb": {
        // Each end is a disc square to the rod: it reaches out across the rod, not along it.
        const dx = p.b[0] - p.a[0], dy = (p.b[1] - p.a[1]) / SQUARE_M, dz = p.b[2] - p.a[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const ex = Math.sqrt(Math.max(0, 1 - (dx / len) ** 2)), ez = Math.sqrt(Math.max(0, 1 - (dz / len) ** 2));
        for (const [e, r] of [[p.a, p.r0], [p.b, p.r1]] as const) {
          add(e[0] - r * ex, e[2] - r * ez);
          add(e[0] + r * ex, e[2] + r * ez);
        }
        break;
      }
    }
  }
  return { x0, z0, x1, z1 };
}

/** How tall a form stands, in metres (0 for one that lies flat). */
export function formHeight(f: Form): number {
  if (isFlat(f)) return 0;
  let top = 0;
  for (const p of f.parts) top = Math.max(top, p.k === "limb" ? Math.max(p.a[1], p.b[1]) + Math.max(p.r0, p.r1) * SQUARE_M : p.y1);
  return top;
}

/** How many triangles a form makes (to keep them low-poly: phones and iPads draw every one). */
export function formTriangles(f: Form): number {
  if (isFlat(f)) return 0;
  const m = solidMeshes([{ form: f, x: 0, z: 0, k: 1, deg: 0 }]);
  return (m.lit.position.length + m.glow.position.length) / 9;
}

// ---------------------------------------------------------------- forms for things known only by kind

/**
 * Objects a view knows only by kind, not from the library (Table's own stamps, trees and rocks
 * found in a picture's map data), as a form `w` by `d` squares; `tallM` for blocks and barrels.
 */
export type SolidKind = "tree" | "spreading" | "pine" | "cypress" | "palm" | "bare" | "bush" | "rock" | "box" | "barrel";

export function kindForm(kind: SolidKind, w: number, d: number, tallM = 1): Form {
  switch (kind) {
    case "tree":
      return leafyTree(paint("#46753a"))(w, d);
    case "spreading":
      return leafyTree(paint("#46753a"), { deep: 0.68 })(w, d);
    case "pine":
      return conifer(paint("#295c38"))(w, d);
    case "cypress":
      return conifer(paint("#295c38"), { kind: "cypress", tiers: 1, narrow: 0.62 })(w, d);
    case "palm":
      return palmTree(paint("#4c7f3d"))(w, d);
    case "bare":
      return bareTree(paint("#6e5c48"))(w, d);
    case "bush":
      return shrub(paint("#4c7f40"))(w, d);
    case "rock":
      return stone(paint("#86847e"))(w, d);
    case "box":
      return block(tallM, paint("#86603a"))(w, d);
    case "barrel":
      return barrel(tallM, paint("#86603a"))(w, d);
  }
}

// ---------------------------------------------------------------- triangles

/** Flat arrays of triangles (x, y, z each), in squares: x to the right, z down the map, y up. */
export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
}

/** An object to stand up: its form, where it is, how big and how it's turned. */
export interface Placed {
  form: Form;
  /** Its middle, in squares. */
  x: number;
  z: number;
  /** Squares per unit of its drawing (1 at its natural size; 2 placed twice as big). */
  k: number;
  /** Turned this many degrees clockwise, as seen on the map. */
  deg: number;
  /** Its drawing's own colour as drawn now (0 to 1 each), for parts in `{ paint }`. */
  paint?: Rgb | null;
  /** How lit it is: every colour times this (1: as it is). */
  shade?: number;
}

type V3 = [number, number, number];

/** How much darker the inside of a hollow thing is than its outside (it's in its own shade). */
const INSIDE = 0.62;

class Mesher {
  readonly lit = { position: [] as number[], normal: [] as number[], color: [] as number[] };
  readonly glow = { position: [] as number[], normal: [] as number[], color: [] as number[] };
  private ox = 0;
  private oz = 0;
  private oy = 0;
  private k = 1;
  private cos = 1;
  private sin = 0;

  /** Where the next object's parts go: its middle (squares), lifted `lift` squares, `k` squares a drawing unit, turned `deg`. */
  place(x: number, z: number, lift: number, k: number, deg: number): void {
    this.ox = x;
    this.oz = z;
    this.oy = lift;
    this.k = k;
    const t = (-deg * Math.PI) / 180;
    this.cos = Math.cos(t);
    this.sin = Math.sin(t);
  }

  /** A point of a part (drawing units, up in drawing units too: metres / SQUARE_M) into the world. */
  private world(p: V3): V3 {
    const { k, cos, sin } = this;
    return [this.ox + k * (p[0] * cos + p[2] * sin), this.oy + k * p[1], this.oz + k * (-p[0] * sin + p[2] * cos)];
  }

  /** A triangle, wound to face away from `away` (the part's middle, for the outside of a convex part). */
  tri(a: V3, b: V3, c: V3, col: Rgb, away: V3, glow: boolean): void {
    let A = this.world(a), B = this.world(b), C = this.world(c);
    const M = this.world(away);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-12)) return;
    const fx = (A[0] + B[0] + C[0]) / 3 - M[0], fy = (A[1] + B[1] + C[1]) / 3 - M[1], fz = (A[2] + B[2] + C[2]) / 3 - M[2];
    if (nx * fx + ny * fy + nz * fz < 0) {
      [B, C] = [C, B];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const out = glow ? this.glow : this.lit;
    for (const P of [A, B, C]) {
      out.position.push(P[0], P[1], P[2]);
      out.normal.push(nx / len, ny / len, nz / len);
      out.color.push(col[0], col[1], col[2]);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, col: Rgb, away: V3, glow: boolean): void {
    this.tri(a, b, c, col, away, glow);
    this.tri(a, c, d, col, away, glow);
  }

  /** A convex ring closed over, facing up (`up`) or down: a fan from its first point, the fewest triangles. */
  private cap(ring: V3[], col: Rgb, up: boolean, glow: boolean): void {
    const n = ring.length;
    const c: V3 = [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n, ring.reduce((s, p) => s + p[2], 0) / n];
    const away: V3 = [c[0], c[1] + (up ? -1 : 1), c[2]];
    for (let i = 1; i < n - 1; i++) this.tri(ring[0], ring[i], ring[i + 1], col, away, glow);
  }

  /**
   * The sides between two rings (bottom and top), facing away from the axis, and their caps; hollow
   * (`inner`: the top's inside ring, `floor`: the inside's floor ring), a rim, the inside walls
   * facing in, and the inside's floor, all a little darker.
   */
  private prism(bottom: V3[], top: V3[], col: Rgb, glow: boolean, caps: { bottom: boolean; top: boolean }, hollow?: { inner: V3[]; floor: V3[] }): void {
    const n = bottom.length;
    const axis = (i: number): V3 => {
      // The point on the axis level with side i: away from it is outwards.
      const cx = (bottom.reduce((s, p) => s + p[0], 0) + top.reduce((s, p) => s + p[0], 0)) / (2 * n);
      const cz = (bottom.reduce((s, p) => s + p[2], 0) + top.reduce((s, p) => s + p[2], 0)) / (2 * n);
      return [cx, (bottom[i][1] + top[i][1]) / 2, cz];
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const sharp = top[i][0] === top[j][0] && top[i][2] === top[j][2] && top[i][1] === top[j][1];
      if (sharp) this.tri(bottom[i], bottom[j], top[i], col, axis(i), glow);
      else this.quad(bottom[i], bottom[j], top[j], top[i], col, axis(i), glow);
    }
    if (caps.bottom) this.cap(bottom, col, false, glow);
    if (!hollow) {
      if (caps.top && !top.every((p) => p[0] === top[0][0] && p[2] === top[0][2])) this.cap(top, col, true, glow);
      return;
    }
    const dark: Rgb = glow ? col : [col[0] * INSIDE, col[1] * INSIDE, col[2] * INSIDE];
    const { inner, floor } = hollow;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // The rim, facing up.
      const below: V3 = [(top[i][0] + inner[i][0]) / 2, top[i][1] - 1, (top[i][2] + inner[i][2]) / 2];
      this.quad(top[i], top[j], inner[j], inner[i], col, below, glow);
      // The inside wall, facing in: away from a point beyond the outside.
      const out: V3 = [top[i][0] * 3 - inner[i][0] * 2, (inner[i][1] + floor[i][1]) / 2, top[i][2] * 3 - inner[i][2] * 2];
      this.quad(inner[i], inner[j], floor[j], floor[i], dark, out, glow);
    }
    this.cap(floor, dark, true, glow);
  }

  part(p: Part, col: Rgb, seed: number): void {
    const g = !!p.glow;
    const u = (y: number) => y / SQUARE_M;
    switch (p.k) {
      case "box": {
        const y0 = u(p.y0), y1 = u(p.y1);
        const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
        const sx = p.sx ?? 0, sz = p.sz ?? 0, drop = u(p.drop ?? 0);
        const ring = (y: number, s: number, dx: number, dz: number, inset = 0, d = 0): V3[] => {
          const hx = ((p.x1 - p.x0) / 2) * s - inset, hz = ((p.z1 - p.z0) / 2) * s - inset;
          return [
            [cx - hx + dx, y, cz - hz + dz],
            [cx + hx + dx, y, cz - hz + dz],
            [cx + hx + dx, y - d, cz + hz + dz],
            [cx - hx + dx, y - d, cz + hz + dz],
          ];
        };
        const bottom = ring(y0, 1, 0, 0, 0, p.tilt ? drop : 0), top = ring(y1, p.top, sx, sz, 0, drop);
        if (p.wall) {
          const fl = u(p.floor ?? p.y0);
          this.prism(bottom, top, col, g, { bottom: p.y0 > 0.01, top: true }, { inner: ring(y1, p.top, sx, sz, p.wall, drop), floor: ring(fl, p.top, sx, sz, p.wall, 0) });
        } else this.prism(bottom, top, col, g, { bottom: p.y0 > 0.01, top: true });
        return;
      }
      case "cyl": {
        const y0 = u(p.y0), y1 = u(p.y1);
        const ring = (y: number, s: number): V3[] =>
          Array.from({ length: p.n }, (_, i) => {
            const a = (i / p.n) * Math.PI * 2;
            return [p.x + Math.cos(a) * p.rx * s, y, p.z + Math.sin(a) * p.rz * s] as V3;
          });
        if (p.hollow && p.top > 0) {
          this.prism(ring(y0, 1), ring(y1, p.top), col, g, { bottom: p.y0 > 0.01, top: true }, { inner: ring(y1, p.top * p.hollow), floor: ring(u(p.floor ?? p.y0), p.top * p.hollow) });
        } else this.prism(ring(y0, 1), ring(y1, p.top), col, g, { bottom: p.y0 > 0.01, top: p.top > 0 });
        return;
      }
      case "ball": {
        const y0 = u(p.y0), y1 = u(p.y1);
        const cy = (y0 + y1) / 2, ry = (y1 - y0) / 2;
        const rings = Math.max(3, Math.round(p.n / 2));
        const m: V3 = [p.x, cy, p.z];
        const corner = (i: number, j: number): V3 => {
          const lat = (j / rings) * Math.PI;
          const lon = ((i % p.n) / p.n) * Math.PI * 2;
          const k = j === 0 || j === rings ? 1 : 1 + (noise(seed, i % p.n, j) * 2 - 1) * p.lump;
          return [p.x + Math.sin(lat) * Math.cos(lon) * p.rx * k, cy + Math.cos(lat) * ry * k, p.z + Math.sin(lat) * Math.sin(lon) * p.rz * k];
        };
        for (let j = 0; j < rings; j++) {
          for (let i = 0; i < p.n; i++) {
            const a = corner(i, j), b = corner(i + 1, j), c = corner(i + 1, j + 1), d = corner(i, j + 1);
            if (j === 0) this.tri(a, c, d, col, m, g);
            else if (j === rings - 1) this.tri(a, b, d, col, m, g);
            else this.quad(a, b, c, d, col, m, g);
          }
        }
        return;
      }
      case "gable": {
        const y0 = u(p.y0), y1 = u(p.y1);
        const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
        const m: V3 = [cx, (y0 * 2 + y1) / 3, cz];
        const base: V3[] = [[p.x0, y0, p.z0], [p.x1, y0, p.z0], [p.x1, y0, p.z1], [p.x0, y0, p.z1]];
        let top: V3[];
        if (p.along === "x") {
          const hz = ((p.z1 - p.z0) / 2) * p.ridge;
          top = [[p.x0, y1, cz - hz], [p.x1, y1, cz - hz], [p.x1, y1, cz + hz], [p.x0, y1, cz + hz]];
        } else {
          const hx = ((p.x1 - p.x0) / 2) * p.ridge;
          top = [[cx - hx, y1, p.z0], [cx + hx, y1, p.z0], [cx + hx, y1, p.z1], [cx - hx, y1, p.z1]];
        }
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          const same = top[i][0] === top[j][0] && top[i][2] === top[j][2];
          if (same) this.tri(base[i], base[j], top[i], col, m, g);
          else this.quad(base[i], base[j], top[j], top[i], col, m, g);
        }
        if (p.ridge > 0) this.quad(top[0], top[1], top[2], top[3], col, [cx, y1 - 1, cz], g);
        if (p.y0 > 0.01) this.quad(base[0], base[1], base[2], base[3], col, [cx, y0 + 1, cz], g);
        return;
      }
      case "slab": {
        const y0 = u(p.y0), y1 = u(p.y1);
        const n = p.pts.length / 2;
        let cx = 0, cz = 0;
        for (let i = 0; i < n; i++) {
          cx += p.pts[i * 2] / n;
          cz += p.pts[i * 2 + 1] / n;
        }
        const ring = (y: number, s: number): V3[] => Array.from({ length: n }, (_, i) => [cx + (p.pts[i * 2] - cx) * s, y, cz + (p.pts[i * 2 + 1] - cz) * s] as V3);
        if (p.hollow && p.top > 0) {
          this.prism(ring(y0, 1), ring(y1, p.top), col, g, { bottom: p.y0 > 0.01, top: true }, { inner: ring(y1, p.top * p.hollow), floor: ring(u(p.floor ?? p.y0), p.top * p.hollow) });
        } else this.prism(ring(y0, 1), ring(y1, p.top), col, g, { bottom: p.y0 > 0.01, top: p.top > 0 });
        return;
      }
      case "limb": {
        const a: V3 = [p.a[0], u(p.a[1]), p.a[2]], b: V3 = [p.b[0], u(p.b[1]), p.b[2]];
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const len = Math.hypot(dx, dy, dz);
        if (!(len > 1e-9)) return;
        const ax: V3 = [dx / len, dy / len, dz / len];
        // Two directions square to the rod.
        const ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let ex: V3 = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
        const el = Math.hypot(...ex);
        ex = [ex[0] / el, ex[1] / el, ex[2] / el];
        const ey: V3 = [ax[1] * ex[2] - ax[2] * ex[1], ax[2] * ex[0] - ax[0] * ex[2], ax[0] * ex[1] - ax[1] * ex[0]];
        const ring = (o: V3, r: number): V3[] =>
          Array.from({ length: p.n }, (_, i) => {
            const t = (i / p.n) * Math.PI * 2;
            const cs = Math.cos(t) * r, sn = Math.sin(t) * r;
            return [o[0] + ex[0] * cs + ey[0] * sn, o[1] + ex[1] * cs + ey[1] * sn, o[2] + ex[2] * cs + ey[2] * sn] as V3;
          });
        const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const ra = ring(a, p.r0);
        const rb = p.r1 > 0 ? ring(b, p.r1) : ra.map(() => b);
        for (let i = 0; i < p.n; i++) {
          const j = (i + 1) % p.n;
          if (p.r1 > 0) this.quad(ra[i], ra[j], rb[j], rb[i], col, m, g);
          else this.tri(ra[i], ra[j], b, col, m, g);
        }
        // The ends, facing out along the rod.
        const endA: V3 = [a[0] + ax[0], a[1] + ax[1], a[2] + ax[2]];
        for (let i = 0; i < p.n; i++) this.tri(a, ra[i], ra[(i + 1) % p.n], col, endA, g);
        if (p.r1 > 0) {
          const endB: V3 = [b[0] - ax[0], b[1] - ax[1], b[2] - ax[2]];
          for (let i = 0; i < p.n; i++) this.tri(b, rb[i], rb[(i + 1) % p.n], col, endB, g);
        }
        return;
      }
    }
  }
}

/** A number from 0 to 1 that's always the same for the same inputs (an object's lumps don't move). */
export function noise(a: number, b: number, c: number): number {
  let h = Math.imul(Math.round(a * 97) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(b * 89) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 7, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

function hex(s: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: readonly number[]): string {
  return "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

const colours = new Map<string, Rgb>();

/** A part's colour, 0 to 1 each: its own, or the drawing's for `{ paint }`. */
export function colourOf(c: Col, painted: Rgb | null | undefined): Rgb {
  if (typeof c === "object" && "paint" in c) {
    if (painted) return painted;
    c = c.paint;
  }
  const key = typeof c === "string" ? c : `${c.light}/${c.dark}`;
  let rgb = colours.get(key);
  if (!rgb) {
    const v = typeof c === "string" ? hex(c) : hex(mid(c));
    colours.set(key, (rgb = [v[0] / 255, v[1] / 255, v[2] / 255]));
  }
  return rgb;
}

/** A surface an object offers others to rest on: where it is, its outline, and its height, in squares. */
interface Surface {
  x: number;
  z: number;
  cos: number;
  sin: number;
  b: { x0: number; z0: number; x1: number; z1: number };
  k: number;
  y: number;
}

function onSurface(s: Surface, x: number, z: number): boolean {
  // Into the object's own frame (the reverse of Mesher.world's turn), then its drawing's units.
  const dx = (x - s.x) / s.k, dz = (z - s.z) / s.k;
  const lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;
  return lx >= s.b.x0 && lx <= s.b.x1 && lz >= s.b.z0 && lz <= s.b.z1;
}

/**
 * Objects as triangles, in squares: what's lit by the scene's lights, and what glows by itself
 * (flames, magic). Objects that `rest` sit on the highest surface under their middle among the
 * objects before them (a tankard put on a table sits on its top). Flat ones give nothing.
 */
export function solidMeshes(objects: readonly Placed[]): { lit: MeshData; glow: MeshData } {
  const m = new Mesher();
  const surfaces: Surface[] = [];
  for (const o of objects) {
    const f = o.form;
    if (isFlat(f)) continue;
    const t = (-o.deg * Math.PI) / 180;
    let lift = 0;
    if (f.rests) for (const s of surfaces) if (s.y > lift && onSurface(s, o.x, o.z)) lift = s.y;
    m.place(o.x, o.z, lift, o.k, o.deg);
    const shade = o.shade ?? 1;
    const seed = Math.round(o.x * 7 + o.z * 13);
    for (const p of f.parts) {
      const c = colourOf(p.c, o.paint);
      m.part(p, p.glow ? c : [c[0] * shade, c[1] * shade, c[2] * shade], seed);
    }
    if (f.surface !== undefined) {
      const b = formBounds(f);
      if (b) surfaces.push({ x: o.x, z: o.z, cos: Math.cos(t), sin: Math.sin(t), b, k: o.k, y: lift + (o.k * f.surface) / SQUARE_M });
    }
  }
  const pack = (a: { position: number[]; normal: number[]; color: number[] }): MeshData => ({
    position: Float32Array.from(a.position),
    normal: Float32Array.from(a.normal),
    color: Float32Array.from(a.color),
  });
  return { lit: pack(m.lit), glow: pack(m.glow) };
}

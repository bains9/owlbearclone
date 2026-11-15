// The map in 3D (room/view3d.ts draws it with three.js): the arithmetic, kept apart so it's tested
// without WebGL. The board (board.ts source3d) hands over the scene as this page sees it: the floor
// (the map, built map, drawings, the dark and the fog, all as drawn in 2D), the tokens it shows, and
// the walls and doors. Here walls become pieces of wall, raised only where this page has seen, and
// tokens become cardboard figures standing on the floor.
//
// Units: the scene's own (map pixels) come in; the 3D world is in squares, x to the right, z down
// the map (towards the viewer at first), y up.

import type { GridSettings, Scene, SceneArea, SceneVision } from "../../shared/types";
import { segmentsOf, type Seg } from "./vision";
import type { Object3d } from "./view3dObjects";
import type { Building3d } from "./view3dRoofs";
import type { Effect3d } from "./view3dEffects";
import type { Cliff3d } from "./view3dCliffs";
import type { Weather } from "../../shared/calendar";

/** How tall walls stand, in squares: 3 m, at real-world scale (a square is 1.5 m, 5 ft). */
export const WALL_HEIGHT = 2;
/** How thick walls are, in squares. */
export const WALL_THICK = 0.14;
/** Shut doors: this much of a wall's height (2.1 m), and of its thickness. */
export const DOOR_HEIGHT = 0.7;
export const DOOR_THICK = 0.6;
/**
 * Windows: wall below the sill (0.9 m) and above the lintel (2.25 m), as fractions of a wall's
 * height, with a pane of glass between; and the posts at each end, as a fraction of its length
 * (as the flat map draws them).
 */
export const WINDOW_SILL = 0.3;
export const WINDOW_TOP = 0.75;
export const WINDOW_POST = 0.15;
/** Walls are cut into pieces at most this long (squares); each is raised or not by what's been seen where it stands. */
export const WALL_PIECE = 0.5;
/** How far either side of a wall (squares) is looked at to tell whether it's been seen. */
const WALL_SIDE = 0.35;
/** A piece of wall darker than this for a player (unseen dark, or under fog) isn't raised: it would give the map away. */
export const WALL_SEEN = 0.06;
/** The least a seen wall or figure is lit, so one in an explored place still shows its shape. */
export const MIN_SHADE = 0.18;
/** A figure's card: this much of the token's width (the stand shows round it). */
export const CARD_WIDTH = 0.92;
/** A tall picture (a full-body figure) stands at most this many times as tall as it's wide. */
export const CARD_TALLEST = 2.5;
/** How far a flying token's figure is lifted above its stand, in squares. */
export const FLYING_LIFT = 0.6;
/** The camera starts this far from straight down (radians): the map tilted away, as on a table. */
export const START_TILT = 0.85;
/** And never further than this from straight down: it stays above the floor. */
export const MAX_TILT = 1.38;
/** The camera's field of view, top to bottom, in degrees. */
export const FOV = 40;

/** What covers the floor for this page (the fog and the dark), small, as how covered each spot is. */
export interface CoverMap {
  /** The scene point at the map's top-left corner. */
  x0: number;
  y0: number;
  /** The map's cells per scene unit. */
  k: number;
  w: number;
  h: number;
  /** How covered each cell is, row by row: 0 clear to 255 covered. */
  alpha: Uint8ClampedArray;
}

/** How lit a scene point is for this page (1: clear, 0: covered); off the scene it's unseen. No cover: all clear. */
export function brightnessAt(cover: CoverMap | null, x: number, y: number): number {
  if (!cover) return 1;
  const c = Math.floor((x - cover.x0) * cover.k);
  const r = Math.floor((y - cover.y0) * cover.k);
  if (c < 0 || r < 0 || c >= cover.w || r >= cover.h) return 0;
  return 1 - cover.alpha[r * cover.w + c] / 255;
}

/** The scene's walls and doors to raise, in scene units. */
export interface Walls3d {
  /** The map file's walls (from Dungeon, or a Universal VTT file). */
  walls: Seg[];
  /** The Build tool's walls. */
  built: Seg[];
  /**
   * Each of `built`'s look: one of Dungeon's wall textures (its id), or "" for none (in its colour
   * as painted). Each wall keeps its own (build.ts BuildModel.wallType). Missing: all "".
   */
  builtTex?: string[];
  doors: { line: Seg; open: boolean }[];
  /** The Build tool's windows between their posts (the posts are in `built`): wall with a pane of glass in it. */
  windows?: Seg[];
  /** Each window's wall's look, as builtTex. */
  windowTex?: string[];
}

/** The walls, doors and windows the Build tool made, in squares (BuildModel.sightLines). */
export interface BuiltLines {
  walls: readonly (readonly number[])[];
  /** Each wall's look: a wall texture's id, or "" for none (see Walls3d.builtTex). */
  wallTypes?: readonly string[];
  doors: readonly { key: number; line: readonly number[] }[];
  windows?: readonly (readonly number[])[];
  /** Each window's posts' look, the same way. */
  windowTypes?: readonly string[];
}

/**
 * A scene's walls and doors: the map file's (from Dungeon, or any Universal VTT file) and the Build
 * tool's, as lighting and line of sight use them (boardSight.ts geometry), in scene units. A built
 * door is open when the scene's vision says so.
 */
export function wallsOf(vision: SceneVision | undefined, built: BuiltLines, grid: Pick<GridSettings, "size" | "offsetX" | "offsetY">): Walls3d {
  const { size, offsetX, offsetY } = grid;
  const toScene = (l: readonly number[]): Seg => [offsetX + l[0] * size, offsetY + l[1] * size, offsetX + l[2] * size, offsetY + l[3] * size];
  const open = new Set(vision?.openEdges ?? []);
  // A window: a post of wall at each end, the glass between.
  const posts: Seg[] = [];
  const postTex: string[] = [];
  const windows: Seg[] = [];
  const windowTex: string[] = [];
  (built.windows ?? []).forEach((l, i) => {
    const [ax, ay, bx, by] = toScene(l);
    const at = (t: number): [number, number] => [ax + (bx - ax) * t, ay + (by - ay) * t];
    const [px, py] = at(WINDOW_POST);
    const [qx, qy] = at(1 - WINDOW_POST);
    posts.push([ax, ay, px, py], [qx, qy, bx, by]);
    windows.push([px, py, qx, qy]);
    const tex = built.windowTypes?.[i] ?? "";
    postTex.push(tex, tex);
    windowTex.push(tex);
  });
  return {
    walls: segmentsOf(vision?.walls ?? []),
    built: [...built.walls.map(toScene), ...posts],
    builtTex: [...built.walls.map((_, i) => built.wallTypes?.[i] ?? ""), ...postTex],
    windowTex,
    doors: [
      ...(vision?.doors ?? []).map((d) => ({ line: d.line, open: d.open })),
      ...built.doors.map((d) => ({ line: toScene(d.line), open: open.has(d.key) })),
    ],
    windows,
  };
}

/** A piece of wall or shut door to raise, in scene units, and how lit it is (0 to 1). */
export interface WallPiece {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  door: boolean;
  light: number;
  /** One of the Build tool's walls. */
  built?: boolean;
  /** One of Dungeon's wall textures (its id) it's drawn in, rather than its colour: a built wall's own look. */
  tex?: string;
  /** A window: wall below its sill and above its lintel, glass between (see windowGlass). */
  window?: boolean;
  /** Its colour as the map paints it (0 to 1 each), when that's known. */
  color?: readonly [number, number, number];
}

/** The map as painted (picture, built map, before the dark and the fog), small, to read walls' colours from. */
export interface PaintMap {
  x0: number;
  y0: number;
  /** The map's pixels per scene unit. */
  k: number;
  w: number;
  h: number;
  /** RGBA, row by row. */
  rgba: Uint8ClampedArray;
}

/** The map's colour at a scene point (0 to 1 each), or null off it or where nothing's painted. */
export function paintAt(paint: PaintMap | null, x: number, y: number): [number, number, number] | null {
  if (!paint) return null;
  const c = Math.floor((x - paint.x0) * paint.k);
  const r = Math.floor((y - paint.y0) * paint.k);
  if (c < 0 || r < 0 || c >= paint.w || r >= paint.h) return null;
  const i = (r * paint.w + c) * 4;
  if (paint.rgba[i + 3] < 128) return null;
  return [paint.rgba[i] / 255, paint.rgba[i + 1] / 255, paint.rgba[i + 2] / 255];
}

/**
 * A wall's colour from the map's paint where it runs: what's painted there, kept from going
 * black (a map's walls are often drawn very dark, which in 3D would be a black slab), so its
 * stone, brick or wood still reads.
 */
export function wallTint(rgb: readonly [number, number, number]): [number, number, number] {
  const lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
  const t = lum < WALL_DARKEST ? (WALL_DARKEST - lum) / WALL_DARKEST : 0;
  return [rgb[0] + (STONE[0] * 0.7 - rgb[0]) * t, rgb[1] + (STONE[1] * 0.7 - rgb[1]) * t, rgb[2] + (STONE[2] * 0.7 - rgb[2]) * t];
}

/** Below this brightness a wall's painted colour is lifted towards grey stone. */
const WALL_DARKEST = 0.24;

/**
 * The walls and shut doors cut into pieces (at most WALL_PIECE squares long), each with how lit it is:
 * the brighter of the floor just either side of it, as this page sees it. `all` (the GM): every piece;
 * otherwise only those seen, so a player never sees the shape of rooms under the fog or in the dark
 * they haven't explored. Open doors aren't raised: the way is clear.
 */
export function wallPieces(walls3d: Walls3d, cell: number, cover: CoverMap | null, all: boolean, paint: PaintMap | null = null): WallPiece[] {
  const out: WallPiece[] = [];
  const add = (s: Seg, door: boolean, built = false, window = false, tex = "") => {
    const [ax, ay, bx, by] = s;
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 1e-6) || !(cell > 0)) return;
    const n = Math.max(1, Math.ceil(len / (WALL_PIECE * cell)));
    // Either side of the wall: its normal, a little way out.
    const nx = (-(by - ay) / len) * WALL_SIDE * cell;
    const ny = ((bx - ax) / len) * WALL_SIDE * cell;
    // A window's wall is coloured as the post just before it is painted (the glass is painted
    // where the window is).
    const post = window ? paintAt(paint, ax - ((bx - ax) / len) * WINDOW_POST * cell * 0.5, ay - ((by - ay) / len) * WINDOW_POST * cell * 0.5) : null;
    for (let i = 0; i < n; i++) {
      const x0 = ax + ((bx - ax) * i) / n, y0 = ay + ((by - ay) * i) / n;
      const x1 = ax + ((bx - ax) * (i + 1)) / n, y1 = ay + ((by - ay) * (i + 1)) / n;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const light = Math.max(brightnessAt(cover, mx + nx, my + ny), brightnessAt(cover, mx - nx, my - ny), brightnessAt(cover, mx, my));
      if (!all && light < WALL_SEEN) continue;
      const piece: WallPiece = { x0, y0, x1, y1, door, light };
      if (built) piece.built = true;
      if (window) piece.window = true;
      if (tex && !door) piece.tex = tex;
      const painted = door ? null : window ? post : paintAt(paint, mx, my);
      if (painted) piece.color = wallTint(painted);
      out.push(piece);
    }
  };
  for (const w of walls3d.walls) add(w, false);
  walls3d.built.forEach((w, i) => add(w, false, true, false, walls3d.builtTex?.[i]));
  (walls3d.windows ?? []).forEach((w, i) => add(w, false, true, true, walls3d.windowTex?.[i]));
  for (const d of walls3d.doors) if (!d.open) add(d.line, true);
  return out;
}

/**
 * Whether a token standing where it's lit `light` shows for this page. In 2D the fog is painted over
 * tokens, so a player never sees one under it; in 3D a figure would stand up out of the fog, so one
 * where a player hasn't seen isn't stood up at all. The GM (`all`) sees every one, dimmed.
 */
export function standeeShown(light: number, all: boolean): boolean {
  return all || light >= WALL_SEEN;
}

/** How bright something lit `light` (0 to 1) is drawn: never quite black, so its shape shows. */
export function shadeOf(light: number): number {
  return MIN_SHADE + (1 - MIN_SHADE) * Math.max(0, Math.min(1, light));
}

const STONE: readonly [number, number, number] = [0.62, 0.59, 0.55];
const STONE_TOP: readonly [number, number, number] = [0.34, 0.32, 0.3];
const WOOD: readonly [number, number, number] = [0.5, 0.33, 0.18];
const WOOD_TOP: readonly [number, number, number] = [0.32, 0.2, 0.1];
const WHITE: readonly [number, number, number] = [1, 1, 1];
const WHITE_TOP: readonly [number, number, number] = [0.62, 0.62, 0.62];

/** The pieces as one mesh's triangles (no shared corners, so each face is lit flat): positions, normals and colours, in squares. */
export interface WallMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Where a texture falls on each corner, in squares (along a wall and up it; across the top). Walls only. */
  uv?: Float32Array;
}

/** Vertices a piece of wall takes: five faces (no bottom), two triangles each. */
export const WALL_PIECE_VERTICES = 30;
/** A window's piece: the wall below its sill (five faces), and above it (six: its underside shows). */
export const WINDOW_PIECE_VERTICES = 30 + 36;

/**
 * The pieces as boxes standing on the floor, each as lit as it is: their sides in the colour the
 * map paints them (grey stone where that isn't known; doors in wood), their tops darker. With
 * `textured`, in white instead: a texture laid over them gives their colour (the scene's wall
 * texture, on the Build tool's walls).
 */
export function wallMesh(pieces: readonly WallPiece[], cell: number, textured = false): WallMesh {
  const count = pieces.reduce((n, p) => n + (p.window ? WINDOW_PIECE_VERTICES : WALL_PIECE_VERTICES), 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let v = 0;
  /** The texture's direction along the piece being made (its wall's), for its sides' u. */
  let ux = 1, uz = 0;
  const put = (x: number, y: number, z: number, n: readonly number[], c: readonly number[]) => {
    // Sides: along the wall and up; ends: across it and up; the top: across the map.
    if (n[1] > 0.5) {
      uv[v * 2] = x;
      uv[v * 2 + 1] = z;
    } else {
      const along = Math.abs(n[0] * ux + n[2] * uz) < 0.5;
      uv[v * 2] = along ? x * ux + z * uz : x * -uz + z * ux;
      uv[v * 2 + 1] = y;
    }
    position[v * 3] = x;
    position[v * 3 + 1] = y;
    position[v * 3 + 2] = z;
    normal[v * 3] = n[0];
    normal[v * 3 + 1] = n[1];
    normal[v * 3 + 2] = n[2];
    color[v * 3] = c[0];
    color[v * 3 + 1] = c[1];
    color[v * 3 + 2] = c[2];
    v++;
  };
  /**
   * A face from four corners, a to d round its edge clockwise as seen from outside, facing `n`: its
   * triangles go the other way round (a, c, b), anticlockwise from outside, which is the side WebGL draws.
   */
  const quad = (a: number[], b: number[], c: number[], d: number[], n: readonly number[], col: readonly number[]) => {
    for (const p of [a, c, b, a, d, c]) put(p[0], p[1], p[2], n, col);
  };
  for (const p of pieces) {
    const ax = p.x0 / cell, az = p.y0 / cell, bx = p.x1 / cell, bz = p.y1 / cell;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const t = ((p.door ? DOOR_THICK : 1) * WALL_THICK) / 2;
    const h = (p.door ? DOOR_HEIGHT : 1) * WALL_HEIGHT;
    // Its two sides: the normal (-dz, dx) and its opposite.
    const ox = -dz * t, oz = dx * t;
    ux = dx;
    uz = dz;
    const shade = shadeOf(p.light);
    const base = textured ? WHITE : p.door ? WOOD : (p.color ?? STONE);
    const side = base.map((x) => x * shade);
    const top = (textured ? WHITE_TOP : p.door ? WOOD_TOP : p.color ? p.color.map((x) => x * 0.6) : STONE_TOP).map((x) => x * shade);
    const nPlus = [-dz, 0, dx], nMinus = [dz, 0, -dx];
    /** A box from lo to hi up: its four sides and top, and its underside when it's off the ground. */
    const box = (lo: number, hi: number) => {
      // Bottom corners: a and b, on the + side (1) and the - side (2); the tops are the same, hi up.
      const a1 = [ax + ox, lo, az + oz], b1 = [bx + ox, lo, bz + oz], a2 = [ax - ox, lo, az - oz], b2 = [bx - ox, lo, bz - oz];
      const up = (q: number[]) => [q[0], hi, q[2]];
      // Each face listed clockwise as seen from outside (quad turns it round for WebGL).
      quad(a1, up(a1), up(b1), b1, nPlus, side);
      quad(b2, up(b2), up(a2), a2, nMinus, side);
      quad(a2, up(a2), up(a1), a1, [-dx, 0, -dz], side);
      quad(b1, up(b1), up(b2), b2, [dx, 0, dz], side);
      quad(up(a1), up(a2), up(b2), up(b1), [0, 1, 0], top);
      if (lo > 0) quad(a1, b1, b2, a2, [0, -1, 0], side);
    };
    if (p.window) {
      box(0, WINDOW_SILL * h);
      box(WINDOW_TOP * h, h);
    } else box(0, h);
  }
  return { position, normal, color, uv };
}

/** Glass in a window: pale blue, partly see-through (the 3D view draws it so). */
export const GLASS_COLOR: readonly [number, number, number] = [0.67, 0.84, 0.92];
export const GLASS_OPACITY = 0.35;

/**
 * The glass in the windows among the pieces: a thin pane along the middle of each, from its sill
 * to its lintel, facing both ways, as lit as its piece.
 */
export function windowGlass(pieces: readonly WallPiece[], cell: number): WallMesh {
  const panes = pieces.filter((p) => p.window);
  const position = new Float32Array(panes.length * 12 * 3);
  const normal = new Float32Array(panes.length * 12 * 3);
  const color = new Float32Array(panes.length * 12 * 3);
  let v = 0;
  const put = (q: readonly number[], n: readonly number[], c: readonly number[]) => {
    position.set(q, v * 3);
    normal.set(n, v * 3);
    color.set(c, v * 3);
    v++;
  };
  for (const p of panes) {
    const ax = p.x0 / cell, az = p.y0 / cell, bx = p.x1 / cell, bz = p.y1 / cell;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const lo = WINDOW_SILL * WALL_HEIGHT, hi = WINDOW_TOP * WALL_HEIGHT;
    const a = [ax, lo, az], b = [bx, lo, bz], c = [bx, hi, bz], d = [ax, hi, az];
    const shade = shadeOf(p.light);
    const col = GLASS_COLOR.map((x) => x * shade);
    // Both faces, each wound anticlockwise as seen from its own side.
    for (const q of [a, b, c, a, c, d]) put(q, [nx, 0, nz], col);
    for (const q of [a, c, b, a, d, c]) put(q, [-nx, 0, -nz], col);
  }
  return { position, normal, color };
}

/** A token as the 3D view shows it, from what the board shows (board.ts source3d). */
export interface Standee {
  id: string;
  /** Its middle, in scene units. */
  x: number;
  y: number;
  /** Across, in squares. */
  size: number;
  /** Its picture as drawn in 2D (a loaded image), or null for a disc in its colour. */
  picture: HTMLImageElement | null;
  /** Mirrored left to right. */
  flip: boolean;
  color: string;
  label: string;
  /** As faded as in 2D (a hidden token, for the GM; one barely seen). */
  opacity: number;
  /** Lies on the floor rather than standing: furniture, doors and other props. */
  flat: boolean;
  /** Turned this many degrees clockwise (flat ones). */
  rotation: number;
  /** Flying: lifted above its stand. */
  lifted: boolean;
  /** Treeform: it stands as a tree. */
  tree?: boolean;
  /**
   * Copies of it standing round it: Mirror Image's three drifting round it, Blur's shaking one,
   * or (`trail`) Haste's and a spectral beast's after-images where it was a moment ago. `seed`
   * places them as the flat map does.
   */
  copies?: { kind: "mirror" | "blur" | "trail"; seed: number } | null;
}

/** What a standee looks like, apart from where it is: when this changes, it's made again. */
export function standeeLook(s: Standee): string {
  return [s.picture?.src ?? "", s.flip, s.color, s.label, s.size, s.flat, s.flat ? s.rotation : 0, s.lifted, s.opacity.toFixed(2), !!s.tree, s.copies?.kind ?? "", s.copies?.seed ?? ""].join("|");
}

/**
 * A figure's card, in squares: CARD_WIDTH of the token across, and as tall as its picture is for
 * that width (a full-body figure stands taller than wide, up to CARD_TALLEST times).
 */
export function cardSize(size: number, pw: number, ph: number): { w: number; h: number } {
  const w = size * CARD_WIDTH;
  const ratio = pw > 0 && ph > 0 ? Math.min(CARD_TALLEST, ph / pw) : 1;
  return { w, h: w * ratio };
}

/**
 * A token's name plate on its stand, in squares, for a name drawn `aspect` times as wide as it's
 * tall: about a third of a square tall on a medium token (as big as the flat map's name under a
 * token), bigger on a big one; a long name narrower so it's no wider than the stand's front.
 */
export function nameTagSize(size: number, aspect: number): { w: number; h: number } {
  const h = Math.min(0.6, Math.max(0.24, size * 0.3));
  const most = Math.max(1.2, size * 2.6);
  const w = h * Math.max(1, aspect);
  return w > most ? { w: most, h: (h * most) / w } : { w, h };
}

/**
 * How much a name plate `h` squares tall shows from `distance` away, on a screen `screenH` pixels
 * tall with a `fov` degree view: whole while its letters are big enough to read, fading to nothing
 * as they shrink past that, so a crowded map seen from far off isn't a wall of text.
 */
export function nameTagFade(h: number, distance: number, screenH: number, fov: number): number {
  if (!(distance > 0)) return 1;
  // The letters are about 0.6 of the plate.
  const px = (0.6 * h * screenH) / (2 * distance * Math.tan((fov * Math.PI) / 360));
  return Math.max(0, Math.min(1, (px - 5) / 4));
}

/** A flat token's picture on the floor, in squares: fitted into its size, as the board fits it. */
export function flatSize(size: number, pw: number, ph: number): { w: number; h: number } {
  if (!(pw > 0 && ph > 0)) return { w: size, h: size };
  const k = size / Math.max(pw, ph);
  return { w: pw * k, h: ph * k };
}

/** A token's initials, for a disc without a picture (as the board draws them). */
export function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

/**
 * The floor picture's scale, in its pixels per scene unit: the scene's long side at most `maxPx`,
 * and never more than twice the map's own pixels (sharper than that shows nothing more).
 */
export function floorScale(w: number, h: number, maxPx: number): number {
  const long = Math.max(w, h);
  if (!(long > 0)) return 1;
  return Math.min(2, maxPx / long);
}

/** The cover map's scale (cells per scene unit): about four cells a square, at most `maxCells` on its long side. */
export function coverScale(w: number, h: number, cell: number, maxCells = 512): number {
  const long = Math.max(w, h);
  if (!(long > 0) || !(cell > 0)) return 1 / Math.max(cell, 1);
  return Math.min(4 / cell, maxCells / long);
}

/**
 * How far the camera stands from what it looks at for `w` by `h` squares of floor to fill the view
 * (`aspect`: its width over its height), leaning START_TILT: a tilted floor looks shallower, so the
 * depth needs less room than its size.
 */
export function frameDistance(w: number, h: number, aspect: number, fovDeg = FOV): number {
  const v = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const across = w / 2 / (v * Math.max(aspect, 0.1));
  const deep = (h / 2 / v) * Math.cos(START_TILT);
  return Math.max(across, deep, 2);
}

/** The camera's place for looking at (tx, tz) from `d` away, `tilt` from straight down, turned `turn` (0: from the south, map north away). */
export function cameraAt(tx: number, tz: number, d: number, tilt = START_TILT, turn = 0): [number, number, number] {
  return [tx + d * Math.sin(tilt) * Math.sin(turn), d * Math.cos(tilt), tz + d * Math.sin(tilt) * Math.cos(turn)];
}

/** A point kept inside a rectangle. */
export function clampTo(x: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, x));
}

/** The floor as this page sees the scene: its picture, what covers it, and where it lies. */
export interface Floor3d {
  scene: Scene;
  /** The scene's area as drawn, everything on it but the tokens: map, built map, grid, drawings, the dark and the fog. */
  canvas: HTMLCanvasElement;
  /** What covers it (null: nothing, it's all clear). */
  cover: CoverMap | null;
  /**
   * The map as painted, small, for the colours of walls, cliffs and roofs: with the painted trees
   * that stand up taken off, once that's worked out (null: nothing painted).
   */
  paint: PaintMap | null;
  /** The same with its painted trees still on, for the colours of the trees and things standing up. */
  objectPaint: PaintMap | null;
  /** The scene's area, in scene units. */
  area: SceneArea;
}

/** What the board tells the 3D view has changed: the floor (and walls with it), the tokens, or where its 2D view is. */
export type Change3d = "floor" | "tokens" | "view" | "effects";

/** The board, as the 3D view sees it (board.ts source3d): the scene exactly as this page shows it in 2D. */
export interface Board3dSource {
  /** Draws the floor, at most `maxPx` on its long side; null when no scene is shown. */
  floor(maxPx: number): Floor3d | null;
  /** The tokens this page shows now, where they are now (being dragged too). */
  standees(): Standee[];
  /** The scene's walls and doors. */
  walls(): Walls3d;
  /** The built map's objects that stand up in 3D (trees, rocks, pillars, tables...). */
  objects(): Object3d[];
  /** One of Dungeon's wall textures (a built wall's look), once it's made: its picture and how many squares it spans. */
  wallTexture(id: string): { canvas: HTMLCanvasElement; squares: number } | null;
  /** The built map's buildings, for roofs: none on a map with no open ground (a dungeon underground). */
  buildings(): Building3d[];
  /** The spells on the map: areas, looks on tokens, spells being cast (view3dEffects.ts). */
  effects(): Effect3d[];
  /** A Dungeondraft map's cliffs, from its map data (view3dCliffs.ts). */
  cliffs(): Cliff3d[];
  /** The GM, not looking as players: sees everything, the fog and the dark dimmed. */
  gmView(): boolean;
  /** The middle and size of the 2D view, in scene units (null: no scene). */
  view(): { x: number; y: number; w: number; h: number } | null;
  /** Calls `fn` when something changes; returns how to stop. */
  subscribe(fn: (what: Change3d) => void): () => void;
}

/** What the page's buttons and keys ask of the 3D view while it's showing. */
export interface View3dControls {
  zoomBy(factor: number): void;
  /** The day's weather on this map (null: none, or it doesn't fall here), and its weather region (null: the calendar's), for the scenery round it. */
  setWeather(w: Weather | null, region?: string | null): void;
  /** Back to the whole scene, from the south, tilted. */
  fit(): void;
}

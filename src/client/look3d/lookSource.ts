// Dungeon's builder's 3D view (the /look3d page, look3d/main.ts): the level Dungeon sends, as
// Table's 3D view (room/view3d.ts) reads a scene. Nothing is hidden (a map maker has no fog), no
// tokens stand, and no spells are cast; walls wear the map's wall texture, a cave's edges stand
// as rock in the floor's own colours, and rooms on open ground get roofs, lifted off when the
// builder asks to see inside. What Dungeon says, and how it's checked, is dungeonLib/look3d.ts.

import type { Scene } from "../../shared/types";
import { WALL_HEIGHT, type Board3dSource, type Change3d, type Floor3d, type PaintMap, type Walls3d } from "../room/view3dModel";
import type { Object3d } from "../room/view3dObjects";
import { buildingsOf, eavesOf, samplesOf, type Building3d } from "../room/view3dRoofs";
import type { RaisedFloor } from "../room/view3dGround";
import { SQUARE_M } from "../dungeonLib/solid";
import { textureTile, whenTextureMade } from "../room/dungeonTextures";
import type { Seg } from "../room/vision";
import type { LookMap } from "../dungeonLib/look3d";

/** Scene units a square on this page (the 3D view works in squares; any size would do). */
export const LOOK_CELL = 64;
/** The paint map's pixels a square: enough for a wall's or a rock's colour. */
const PAINT_PX = 8;

const scaled = (l: readonly number[], cell: number): Seg => [l[0] * cell, l[1] * cell, l[2] * cell, l[3] * cell];

/** Each wall's height in squares (Dungeon sends metres), or undefined when Dungeon sent none (a Dungeon from before: every wall WALL_HEIGHT). */
const heightsOf = (m: Pick<LookMap, "walls" | "wallHeights">): number[] | undefined => m.wallHeights?.map((h) => h / SQUARE_M);

/**
 * The level's walls (each in its own wall texture and height: Dungeon's walls keep the style and
 * height they're built at, the wall over a doorway in a tall wall from the top of the doorway
 * up), its cave edges (as rock) and its doors, shut.
 */
export function lookWalls(m: Pick<LookMap, "walls" | "wallTexture" | "wallTextures" | "wallHeights" | "wallBottoms" | "rock" | "doors">, cell = LOOK_CELL): Walls3d {
  const builtH = heightsOf(m);
  const builtLo = m.wallBottoms?.map((b) => b / SQUARE_M);
  return {
    walls: m.rock.map((l) => scaled(l, cell)),
    built: m.walls.map((l) => scaled(l, cell)),
    // A Dungeon from before sends one texture for every wall.
    builtTex: m.wallTextures ?? m.walls.map(() => m.wallTexture),
    ...(builtH ? { builtH } : {}),
    ...(builtLo ? { builtLo } : {}),
    doors: m.doors.map((l) => ({ line: scaled(l, cell), open: false })),
  };
}

/** The objects that stand up, each with the form Dungeon gave it (so it shows as Dungeon has it, whatever Table's copy of the library says). */
export function lookObjects(m: Pick<LookMap, "objects">, cell = LOOK_CELL): Object3d[] {
  return m.objects.map((o) => ({
    id: `d:${o.id}`,
    form: o.form,
    x: o.x * cell,
    y: o.y * cell,
    size: o.size,
    deg: o.deg,
    color: o.color,
  }));
}

/** The level's buildings, for roofs, each on top of its walls: lifted off (`inside`) while the builder wants to see in. */
export function lookBuildings(m: Pick<LookMap, "roofed"> & Partial<Pick<LookMap, "walls" | "wallHeights">>, roofs: boolean, cell = LOOK_CELL): Building3d[] {
  const X = (c: number) => c * cell, Y = (r: number) => r * cell;
  const hs = m.walls ? heightsOf({ walls: m.walls, wallHeights: m.wallHeights }) : undefined;
  // Only when some wall isn't WALL_HEIGHT is there anything to work out.
  const walls = m.walls && hs?.some((h) => h !== WALL_HEIGHT) ? m.walls.map((l, i) => ({ line: scaled(l, cell), h: hs[i] })) : null;
  return buildingsOf(m.roofed).map((b) => {
    const eaves = walls ? eavesOf(b, walls, (x) => x / cell, (y) => y / cell, cell) : WALL_HEIGHT;
    return {
      id: `${b.cells[0][0]},${b.cells[0][1]}`,
      rects: b.rects.map((r) => ({ x0: X(r.c0), y0: Y(r.r0), x1: X(r.c1 + 1), y1: Y(r.r1 + 1) })),
      samples: samplesOf(b, X, Y, cell),
      inside: !roofs,
      ...(eaves !== WALL_HEIGHT ? { eaves } : {}),
    };
  });
}

/** The level's raised floors, in scene units (rings) and squares (heights). */
export function lookRaised(m: Pick<LookMap, "raised">, cell = LOOK_CELL): RaisedFloor[] {
  return (m.raised ?? []).map((r) => ({ rings: r.rings.map((ring) => ring.map((v) => v * cell)), h: r.m / SQUARE_M }));
}

/** A small copy of the floor, to read the walls' and rocks' colours from. */
function paintOf(floor: ImageBitmap, m: Pick<LookMap, "width" | "height">, cell: number): PaintMap | null {
  const w = Math.max(1, Math.round(m.width * PAINT_PX)), h = Math.max(1, Math.round(m.height * PAINT_PX));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  x.drawImage(floor, 0, 0, w, h);
  return { x0: 0, y0: 0, k: PAINT_PX / cell, w, h, rgba: x.getImageData(0, 0, w, h).data };
}

/** What the page shows: the last level Dungeon sent, as the 3D view reads a scene. */
export class LookSource implements Board3dSource {
  private map: LookMap | null = null;
  private floorCanvas: HTMLCanvasElement | null = null;
  private paint: PaintMap | null = null;
  private roofs = true;
  private listeners = new Set<(what: Change3d) => void>();
  private stopWaiting: (() => void) | null = null;

  /** A level from Dungeon (already checked), drawn at once. */
  setMap(m: LookMap): void {
    this.map = m;
    const c = (this.floorCanvas ??= document.createElement("canvas"));
    c.width = m.floor.width;
    c.height = m.floor.height;
    c.getContext("2d")?.drawImage(m.floor, 0, 0);
    this.paint = paintOf(m.floor, m, LOOK_CELL);
    m.floor.close();
    // A wall texture is made a moment after it's first asked for: the walls are made again then.
    this.stopWaiting?.();
    const stops = [...new Set([m.wallTexture, ...(m.wallTextures ?? [])])].map((id) => whenTextureMade(id, () => this.tell("floor")));
    this.stopWaiting = () => stops.forEach((stop) => stop());
    this.tell("floor");
  }

  setRoofs(on: boolean): void {
    if (on === this.roofs) return;
    this.roofs = on;
    // Lifting roofs is a change to the buildings, which the view hears as a token moving.
    this.tell("tokens");
  }

  private tell(what: Change3d): void {
    for (const fn of this.listeners) fn(what);
  }

  floor(maxPx: number): Floor3d | null {
    const m = this.map, src = this.floorCanvas;
    if (!m || !src) return null;
    // At most maxPx on its long side (WebGL keeps a texture's size small on phones).
    let canvas = src;
    const k = Math.min(1, maxPx / Math.max(src.width, src.height));
    if (k < 1) {
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(src.width * k));
      canvas.height = Math.max(1, Math.round(src.height * k));
      canvas.getContext("2d")?.drawImage(src, 0, 0, canvas.width, canvas.height);
    }
    const scene = {
      id: m.key,
      name: "",
      width: m.width * LOOK_CELL,
      height: m.height * LOOK_CELL,
      grid: { type: "square", size: LOOK_CELL, offsetX: 0, offsetY: 0, visible: false, color: "#000000", opacity: 0 },
      mapAssetId: null,
    } as unknown as Scene;
    return { scene, canvas, cover: null, paint: this.paint, objectPaint: this.paint, area: { x0: 0, y0: 0, x1: m.width * LOOK_CELL, y1: m.height * LOOK_CELL } };
  }

  standees() {
    return [];
  }

  walls(): Walls3d {
    return this.map ? lookWalls(this.map) : { walls: [], built: [], doors: [] };
  }

  objects(): Object3d[] {
    return this.map ? lookObjects(this.map) : [];
  }

  wallTexture(id: string): { canvas: HTMLCanvasElement; squares: number } | null {
    return this.map ? textureTile(id) : null;
  }

  buildings(): Building3d[] {
    return this.map ? lookBuildings(this.map, this.roofs) : [];
  }

  effects() {
    return [];
  }

  cliffs() {
    return [];
  }

  /** The level's raised floors, as Dungeon sends them (cells, metres), in this page's units (scene units, squares). */
  raised(): RaisedFloor[] {
    return this.map ? lookRaised(this.map) : [];
  }

  /** Not the GM's dimmed look: nothing's hidden here, and roofs stand solid. */
  gmView(): boolean {
    return false;
  }

  view() {
    return null;
  }

  subscribe(fn: (what: Change3d) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

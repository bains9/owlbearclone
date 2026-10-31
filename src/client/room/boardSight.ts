// Lighting and line of sight's pictures, for the board (board.ts): the scene's walls, doors and
// lights made into what sight needs, the lights' glow, and the dark itself with the night's black
// and white, each made again only when what it's made from changes. The board says whose eyes a
// page sees with and where they stand, and draws what's made here on its layers.

import { exploreGrid, exploreSlot, hasCell, onlyByNightvision } from "../../shared/explore";
import type { ExploreGrid, Explored } from "../../shared/explore";
import type { Scene, SceneLight, SceneVision } from "../../shared/types";
import { sceneBounds } from "../../shared/types";
import { visionSquares } from "../../shared/units";
import { ZONE_LOOKS } from "../../shared/zones";
import type { RoomClient } from "./client";
import { WallIndex, blockers, crackJoins, doorSpots, flickerAt, segmentsOf, sightPolygon } from "./vision";
import type { DoorSpot, Seg } from "./vision";
import { inZone, rgba, zoneEdges, type Zone } from "./zonefx";

/** The fog and the dark are each drawn once into an image at most this many pixels on its long side. */
export const FOG_CACHE_MAX = 2560;
/** The dark where the party can't see (lighting and line of sight). */
const SIGHT_DARK = "#06070a";
/** How much of an explored place shows through the dark once the party has moved on (0 to 1). */
const EXPLORED_SHOWN = 0.45;
/**
 * How much of what only nightvision sees shows through the dark (in black and white, at night):
 * more than an explored place, and enough that a token there can be picked.
 */
const NIGHT_SHOWN = 0.6;
/** The black and white reaches this much further than nightvision, so no colour shows at its soft edge. */
const MONO_OUT = 1.15;
/** How strongly a light's colour tints what it falls on, at its heart. */
const LIGHT_TINT = 0.3;
/** The glow of a light that flickers but has no colour of its own: a torch's. */
const TORCH_LIGHT = "#ffb060";

/** The scene's area, which the dark covers. */
export type SceneArea = ReturnType<typeof sceneBounds>;

/** The scene's walls and doors, made into an index, and the lights' reach: remade when walls, doors or built walls change. */
export interface SightGeometry {
  scene: Scene;
  vision: SceneVision;
  terrain: unknown;
  zones: string;
  index: WallIndex;
  /** What stops a player's token: walls and shut doors (not fog or darkness, which only stop sight). */
  moveIndex: WallIndex;
  doors: DoorSpot[];
  lights: number[][];
  /** Where each light is and how far it reaches (and how it looks): the map's, and the spell zones' (Light, Moonbeam). */
  spots: SceneLight[];
}

/** The walls and doors built in Build mode, in squares (BuildModel.sightLines). */
export interface BuiltSight {
  walls: readonly (readonly number[])[];
  doors: readonly { key: number; line: readonly number[] }[];
}

/**
 * Where the tokens a page sees with stand (`xy`: [x0, y0, ...]); at night, how far each one's
 * nightvision reaches (`night`, in squares: 0 for none).
 */
export interface SightViewers {
  xy: readonly number[];
  night: readonly number[];
}

/**
 * In the dark or at night, the lights' own colour (and a flickering one's waver), under the
 * tokens: a glow out to its reach, only where it falls (clipped to its light's shape, so never
 * through a wall). Plain light that doesn't flicker has none.
 */
export function drawGlows(c: CanvasRenderingContext2D, geom: SightGeometry, now: number): void {
  geom.spots.forEach((l, j) => {
    if (!l.color && !l.flicker) return;
    const poly = geom.lights[j];
    const f = l.flicker ? flickerAt(now, j) : 1;
    const r = l.r * (l.flicker ? 0.94 + 0.06 * f : 1);
    const color = l.color ?? TORCH_LIGHT;
    const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
    g.addColorStop(0, rgba(color, LIGHT_TINT * f));
    g.addColorStop(0.6, rgba(color, LIGHT_TINT * 0.55 * f));
    g.addColorStop(1, rgba(color, 0));
    c.save();
    c.beginPath();
    for (let i = 0; i < poly.length; i += 2) {
      if (i) c.lineTo(poly[i], poly[i + 1]);
      else c.moveTo(poly[i], poly[i + 1]);
    }
    c.closePath();
    c.clip();
    c.fillStyle = g;
    c.beginPath();
    c.arc(l.x, l.y, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  });
}

export class BoardSight {
  constructor(private readonly room: RoomClient) {}

  private geom: SightGeometry | null = null;
  /** Counts the times the geometry's been made (the dark is made again with it). */
  private geomVersion = 0;
  /** The dark, composited like the fog, in scene coordinates; and what it was made from (so it's remade only when that changes). */
  private canvas: HTMLCanvasElement | null = null;
  private madeFrom = "";
  /** What the party saw when the dark was last made, on the explore grid (for which tokens players see); null with lighting off. */
  seen: { grid: ExploreGrid; alpha: Uint8ClampedArray } | null = null;
  /** The night's black and white, made with the dark (a canvas like it), and whether there's any. */
  private monoCanvas: HTMLCanvasElement | null = null;
  private monoShown = false;
  private exploredShown: Explored | undefined;
  private exploredVersion = 0;
  /** The explored cells as a picture, a pixel a cell (remade when they change). */
  private exploredCanvas: { of: Explored; canvas: HTMLCanvasElement } | null = null;

  /**
   * The scene's walls and doors as an index for sight, and where its lights reach: remade when
   * the scene's lighting (walls, doors, lights), its grid, its built walls (`terrain`, the model
   * they're in) or the spell zones that change the lighting (`zones`, a key to them) change.
   */
  geometry(scene: Scene, v: SceneVision, terrain: unknown, zones: string, sightLines: () => BuiltSight, sightZones: () => Zone[]): SightGeometry {
    const g = this.geom;
    if (g && g.vision === v && g.terrain === terrain && g.zones === zones && g.scene.grid === scene.grid && g.scene.bounds === scene.bounds && g.scene.width === scene.width) return g;
    const { size, offsetX, offsetY } = scene.grid;
    const toScene = (l: readonly number[]): Seg => [offsetX + l[0] * size, offsetY + l[1] * size, offsetX + l[2] * size, offsetY + l[3] * size];
    const built = sightLines();
    const zoneList = sightZones();
    // The map file's walls, with the cracks where one stops just short of another joined (a fifth of a square).
    // Fog and darkness (spell zones) stop sight at their edges, as walls do.
    const zoneWalls = zoneList.filter((z) => ZONE_LOOKS[z.look].sight === "block" || ZONE_LOOKS[z.look].sight === "dark").flatMap(zoneEdges);
    const fixed = [...segmentsOf(v.walls), ...crackJoins(v.walls, size * 0.2), ...built.walls.map(toScene)];
    const doors = doorSpots(v, built.doors.map((d) => ({ key: d.key, line: toScene(d.line) })));
    const area = sceneBounds(scene);
    const index = new WallIndex(blockers([...fixed, ...zoneWalls], doors), area, size * 2);
    const moveIndex = new WallIndex(blockers(fixed, doors), area, size * 2);
    // The map's lights and the spell zones' lights, less any a darkness puts out.
    const dark = zoneList.filter((z) => ZONE_LOOKS[z.look].sight === "dark");
    const spots = v.daylight
      ? []
      : [...v.lights, ...zoneList.filter((z) => ZONE_LOOKS[z.look].sight === "light").map((z) => ({ x: z.x, y: z.y, r: Math.max(z.rx, z.ry) }))].filter(
          (l) => !dark.some((z) => inZone(z, l.x, l.y)),
        );
    const lights = spots.map((l) => sightPolygon(index, l.x, l.y, l.r));
    this.geom = { scene, vision: v, terrain, zones, index, moveIndex, doors, lights, spots };
    this.geomVersion++;
    return this.geom;
  }

  /**
   * Makes the dark (and the night's black and white) again when what it's made from has changed:
   * the geometry (made last by `geometry`), whose explored map it shows (`who`: "" for the
   * party's), and where `viewers` stand. The scene's area.
   */
  ensure(scene: Scene, v: SceneVision, geom: SightGeometry, who: string, viewers: SightViewers): SceneArea {
    const area = sceneBounds(scene);
    const explored = this.room.state.explored[exploreSlot(scene.id, who)];
    if (explored !== this.exploredShown) {
      this.exploredShown = explored;
      this.exploredVersion++;
    }
    const reach = visionSquares(v, scene.grid);
    const key = [
      this.geomVersion,
      who,
      this.exploredVersion,
      v.daylight ? "day" : v.night ? "night" : "dark",
      reach.light * scene.grid.size,
      reach.sight * scene.grid.size,
      `${area.x0},${area.y0},${area.x1},${area.y1}`,
      viewers.xy.join(","),
      viewers.night.join(","),
    ].join("|");
    if (key !== this.madeFrom || !this.canvas) {
      this.madeFrom = key;
      this.render(scene, v, geom, viewers, explored, who);
    }
    return area;
  }

  /** The dark, over the scene's area. */
  draw(c: CanvasRenderingContext2D, area: SceneArea): void {
    if (!this.canvas) return;
    c.save();
    c.imageSmoothingEnabled = true;
    c.drawImage(this.canvas, area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
    c.restore();
  }

  /** The night's black and white, where only nightvision sees, if there's any. */
  drawMono(c: CanvasRenderingContext2D, area: SceneArea): void {
    if (!this.monoShown || !this.monoCanvas) return;
    c.save();
    c.imageSmoothingEnabled = true;
    c.drawImage(this.monoCanvas, area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
    c.restore();
  }

  private render(
    scene: Scene,
    v: SceneVision,
    geom: SightGeometry,
    viewers: SightViewers,
    explored: Explored | undefined,
    who: string,
  ): void {
    const area = sceneBounds(scene);
    const w0 = area.x1 - area.x0, h0 = area.y1 - area.y0;
    // How far the party sees: the scene's sight distance (fading out at its edge), or to the walls;
    // and how far its own light reaches. Distances, as squares of this scene's grid.
    const squares = visionSquares(v, scene.grid);
    const range = squares.sight > 0 ? squares.sight * scene.grid.size : 0;
    const far = range || Math.hypot(w0, h0);
    const reach = squares.light * scene.grid.size;
    const at = viewers.xy;
    const polys: number[][] = [];
    for (let i = 0; i < at.length; i += 2) polys.push(sightPolygon(geom.index, at[i], at[i + 1], far));
    // At night, how far each one's nightvision reaches (as far as the party sees, at most).
    const nights = viewers.night.map((n) => (n > 0 ? (range ? Math.min(range, n * scene.grid.size) : n * scene.grid.size) : 0));
    const anyNight = nights.some((n) => n > 0);

    // What the party sees, painted onto a canvas with whatever compositing it's set to (a soft edge
    // where a light fades): cut out of the dark, and drawn on the explore grid. `lit`: what the
    // lights and the party's own light show; `night`: how much of what only nightvision sees, if any.
    // `nightOut`: how much further than its reach nightvision is painted (the black and white's
    // edge then lies in the dark, past the edge of what's dimly seen).
    const paint = (c: CanvasRenderingContext2D, lit = true, night = 1, nightOut = 1) => {
      const trace = (poly: readonly number[]) => {
        c.beginPath();
        for (let i = 0; i < poly.length; i += 2) {
          if (i) c.lineTo(poly[i], poly[i + 1]);
          else c.moveTo(poly[i], poly[i + 1]);
        }
        c.closePath();
      };
      // Seen in full out to `solid` of the way, then fading to nothing at r.
      const glow = (x: number, y: number, r: number, solid = 0.7) => {
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "#000");
        g.addColorStop(solid, "#000");
        g.addColorStop(1, "rgba(0,0,0,0)");
        return g;
      };
      polys.forEach((seen, n) => {
        const x = at[n * 2], y = at[n * 2 + 1];
        if (v.daylight) {
          if (!lit) return;
          c.fillStyle = range ? glow(x, y, range, 0.85) : "#000";
          trace(seen);
          c.fill();
          return;
        }
        // In the dark (or at night): what the lights fall on, and the party's own light, as far as
        // this token can see; at night, what its nightvision makes out too.
        c.save();
        trace(seen);
        c.clip();
        if (lit) {
          geom.lights.forEach((poly, j) => {
            const l = geom.spots[j];
            c.fillStyle = glow(l.x, l.y, l.r);
            trace(poly);
            c.fill();
          });
          if (reach > 0) {
            c.fillStyle = glow(x, y, reach);
            c.beginPath();
            c.arc(x, y, reach, 0, Math.PI * 2);
            c.fill();
          }
        }
        const nv = nights[n] * nightOut;
        if (night > 0 && nv > 0) {
          c.globalAlpha = night;
          c.fillStyle = glow(x, y, nv, 0.85 / nightOut);
          c.beginPath();
          c.arc(x, y, nv, 0, Math.PI * 2);
          c.fill();
        }
        c.restore();
      });
    };

    // The dark: black where the party has never been, dimmed where it has explored, clear where it sees.
    const k = Math.min(1, FOG_CACHE_MAX / Math.max(w0, h0));
    const canvas = (this.canvas ??= document.createElement("canvas"));
    const w = Math.max(1, Math.ceil(w0 * k)), h = Math.max(1, Math.ceil(h0 * k));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext("2d")!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, w, h);
    c.fillStyle = SIGHT_DARK;
    c.fillRect(0, 0, w, h);
    const grid = exploreGrid(scene);
    if (explored && explored.key === grid.key) {
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.globalAlpha = EXPLORED_SHOWN;
      c.imageSmoothingEnabled = true;
      c.drawImage(this.exploredPicture(explored, grid), 0, 0, (grid.cols * grid.cell) * k, (grid.rows * grid.cell) * k);
      c.restore();
    }
    c.setTransform(k, 0, 0, k, -area.x0 * k, -area.y0 * k);
    c.globalCompositeOperation = "destination-out";
    // What only nightvision sees stays dim (and in black and white, below).
    paint(c, true, NIGHT_SHOWN);

    // The night's black and white: grey where only nightvision sees, none where a light shows.
    // ...and where the party has explored but only ever seen by nightvision; none where the day or
    // a light shows now.
    const known = explored && explored.key === grid.key ? explored : null;
    const grey = known ? this.greyPicture(known, grid) : null;
    this.monoShown = anyNight || !!grey;
    if (this.monoShown) {
      const mono = (this.monoCanvas ??= document.createElement("canvas"));
      if (mono.width !== w || mono.height !== h) {
        mono.width = w;
        mono.height = h;
      }
      const mc = mono.getContext("2d")!;
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.globalCompositeOperation = "source-over";
      mc.clearRect(0, 0, w, h);
      if (grey) {
        mc.imageSmoothingEnabled = true;
        mc.drawImage(grey, 0, 0, grid.cols * grid.cell * k, grid.rows * grid.cell * k);
      }
      mc.setTransform(k, 0, 0, k, -area.x0 * k, -area.y0 * k);
      if (anyNight) paint(mc, false, 1, MONO_OUT);
      mc.globalCompositeOperation = "destination-out";
      paint(mc, true, 0);
    }

    // The same on the explore grid, a pixel a cell: which cells the party sees now. Those it hadn't
    // explored yet are kept for everyone (RoomClient.explore), and players see only the tokens on
    // cells it sees (applySightToTokens).
    const seenCanvas = (this.seenCanvas ??= document.createElement("canvas"));
    if (seenCanvas.width !== grid.cols || seenCanvas.height !== grid.rows) {
      seenCanvas.width = grid.cols;
      seenCanvas.height = grid.rows;
    }
    const sc = seenCanvas.getContext("2d", { willReadFrequently: true })!;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, grid.cols, grid.rows);
    sc.setTransform(1 / grid.cell, 0, 0, 1 / grid.cell, -grid.x0 / grid.cell, -grid.y0 / grid.cell);
    sc.globalCompositeOperation = "source-over";
    paint(sc);
    const alpha = sc.getImageData(0, 0, grid.cols, grid.rows).data;
    this.seen = { grid, alpha };
    const cells = grid.cols * grid.rows;
    const fresh: number[] = [];
    for (let i = 0; i < cells; i++) if (alpha[i * 4 + 3] > 127 && !(known && hasCell(known.bits, i))) fresh.push(i);
    // Which of them are seen in colour (by day, or in a light), once it matters: at night with
    // nightvision, or once the map keeps what was seen only by nightvision.
    let freshLit: number[] | undefined;
    if (anyNight || known?.lit) {
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, grid.cols, grid.rows);
      sc.setTransform(1 / grid.cell, 0, 0, 1 / grid.cell, -grid.x0 / grid.cell, -grid.y0 / grid.cell);
      paint(sc, true, 0);
      const lit = sc.getImageData(0, 0, grid.cols, grid.rows).data;
      // What was explored before the map kept colour was all seen in colour.
      const inColour = known ? (known.lit ?? known.bits) : null;
      freshLit = [];
      for (let i = 0; i < cells; i++) if (lit[i * 4 + 3] > 127 && !(inColour && hasCell(inColour, i))) freshLit.push(i);
    }
    if (!fresh.length && !freshLit?.length) return;
    this.room.explore(scene.id, grid.key, fresh, who, freshLit);
    // What was just explored is what's seen now, already clear in the dark just made: no need to make it again.
    this.exploredShown = this.room.state.explored[exploreSlot(scene.id, who)];
  }

  private seenCanvas: HTMLCanvasElement | null = null;

  /** The explored cells seen only by nightvision, as a picture a pixel a cell; null when there are none (remade when they change). */
  private greyPicture(explored: Explored, grid: ExploreGrid): HTMLCanvasElement | null {
    if (this.greyCanvas?.of === explored) return this.greyCanvas.canvas;
    const canvas = (this.greyCanvas?.canvas ?? null) || document.createElement("canvas");
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(grid.cols, grid.rows);
    let any = false;
    const { cols, rows } = grid;
    for (let i = 0, n = cols * rows; i < n; i++) {
      if (!onlyByNightvision(explored, i)) continue;
      any = true;
      // A cell round it too where nothing's explored (it's dark there anyway): the grey's soft edge
      // then lies in the dark, and no colour shows round what was seen only by nightvision.
      const col = i % cols, row = (i - col) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = col + dx, r = row + dy;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          const j = r * cols + c;
          if (j === i || !hasCell(explored.bits, j)) img.data[j * 4 + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.greyCanvas = { of: explored, canvas: any ? canvas : null };
    return this.greyCanvas.canvas;
  }
  private greyCanvas: { of: Explored; canvas: HTMLCanvasElement | null } | null = null;

  /** The explored cells as a picture, a pixel a cell, opaque where explored (remade when they change). */
  private exploredPicture(explored: Explored, grid: ExploreGrid): HTMLCanvasElement {
    if (this.exploredCanvas?.of === explored) return this.exploredCanvas.canvas;
    const canvas = this.exploredCanvas?.canvas ?? document.createElement("canvas");
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(grid.cols, grid.rows);
    for (let i = 0, n = grid.cols * grid.rows; i < n; i++) if (hasCell(explored.bits, i)) img.data[i * 4 + 3] = 255;
    ctx.putImageData(img, 0, 0);
    this.exploredCanvas = { of: explored, canvas };
    return canvas;
  }
}

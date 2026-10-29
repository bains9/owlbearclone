// Lighting and line of sight (Scene.vision): what can be seen from a point, and the scene's
// darkness for players. Walls and closed doors block sight: the map file's (from Dungeon, or any
// Universal VTT file) and the Build tool's. A point sees everything its sight polygon covers; by
// day that's all it can see, and in the dark only where a light, or the party's own light, falls.
//
// The sight polygon is the classic one: rays from the point to every wall end near it (and a hair
// either side), and round the edge of its reach, each stopped at the nearest wall; the hits,
// sorted by angle, are the polygon. Walls go in a grid of buckets, so a ray only tests the walls
// in the buckets it crosses.

import type { SceneVision, TokenItem } from "../../shared/types";
import { GM_OWNER } from "../../shared/sanitize";

/** A wall's stretch: [x0, y0, x1, y1] in scene units. */
export type Seg = [number, number, number, number];

/** The area the polygons stay inside (the scene's). */
export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A door that can be opened: the map file's (index into vision.doors) or the Build tool's (edge key). */
export interface DoorSpot {
  kind: "file" | "built";
  /** vision.doors index, or the Build tool's edge key. */
  key: number;
  line: Seg;
  open: boolean;
}

/** Lines ([x0, y0, x1, y1, ...]) as their stretches. */
export function segmentsOf(lines: readonly (readonly number[])[]): Seg[] {
  const out: Seg[] = [];
  for (const l of lines) for (let i = 0; i + 3 < l.length; i += 2) out.push([l[i], l[i + 1], l[i + 2], l[i + 3]]);
  return out;
}

/**
 * Joins for the hairline cracks where one wall stops just short of another: from each line's end
 * to the nearest point of another line within `near` (scene units). A map's walls don't always
 * meet (a room's wall stops at a door's corner, and the passage's traced edge, rounded, starts a
 * tenth of a square off), and a ray skimming the corner would slip through and run on over the
 * rock. Doors are a square wide, far wider than `near`, so they stay open.
 */
export function crackJoins(lines: readonly (readonly number[])[], near: number): Seg[] {
  // Every stretch, with the line it belongs to, in buckets `near` wide.
  const cell = Math.max(near, 1e-6);
  const buckets = new Map<string, { line: number; s: Seg }[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  lines.forEach((l, li) => {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const s: Seg = [l[i], l[i + 1], l[i + 2], l[i + 3]];
      const c0 = Math.floor(Math.min(s[0], s[2]) / cell), c1 = Math.floor(Math.max(s[0], s[2]) / cell);
      const r0 = Math.floor(Math.min(s[1], s[3]) / cell), r1 = Math.floor(Math.max(s[1], s[3]) / cell);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const list = buckets.get(key(c, r));
          if (list) list.push({ line: li, s });
          else buckets.set(key(c, r), [{ line: li, s }]);
        }
      }
    }
  });
  const out: Seg[] = [];
  lines.forEach((l, li) => {
    if (l.length < 4) return;
    for (const [px, py] of [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]) {
      let best = near, bx = 0, by = 0;
      const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
      for (let r = cy - 1; r <= cy + 1; r++) {
        for (let c = cx - 1; c <= cx + 1; c++) {
          for (const { line, s } of buckets.get(key(c, r)) ?? []) {
            if (line === li) continue;
            const [qx, qy] = nearestOn(s, px, py);
            const d = Math.hypot(qx - px, qy - py);
            if (d < best) {
              best = d;
              bx = qx;
              by = qy;
            }
          }
        }
      }
      // Already touching: nothing to join.
      if (best < near && best > 1e-6) out.push([px, py, bx, by]);
    }
  });
  return out;
}

/** The point of a stretch nearest (x, y). */
function nearestOn(s: Seg, x: number, y: number): [number, number] {
  const ex = s[2] - s[0], ey = s[3] - s[1];
  const len = ex * ex + ey * ey;
  const t = len ? Math.max(0, Math.min(1, ((x - s[0]) * ex + (y - s[1]) * ey) / len)) : 0;
  return [s[0] + ex * t, s[1] + ey * t];
}

/** What blocks sight: walls, and doors that are shut. */
export function blockers(walls: readonly Seg[], doors: readonly DoorSpot[]): Seg[] {
  return [...walls, ...doors.filter((d) => !d.open).map((d) => d.line)];
}

/** The scene's doors: its map file's, and the Build tool's (`built`, with their edge keys). */
export function doorSpots(v: SceneVision, built: readonly { key: number; line: Seg }[]): DoorSpot[] {
  const open = new Set(v.openEdges ?? []);
  return [
    ...v.doors.map((d, i): DoorSpot => ({ kind: "file", key: i, line: d.line, open: d.open })),
    ...built.map((d): DoorSpot => ({ kind: "built", key: d.key, line: d.line, open: open.has(d.key) })),
  ];
}

/** The scene's vision with one door opened or shut. */
export function toggledDoor(v: SceneVision, door: Pick<DoorSpot, "kind" | "key" | "open">): SceneVision {
  if (door.kind === "file") return { ...v, doors: v.doors.map((d, i) => (i === door.key ? { ...d, open: !door.open } : d)) };
  const open = new Set(v.openEdges ?? []);
  if (door.open) open.delete(door.key);
  else open.add(door.key);
  return { ...v, openEdges: [...open] };
}

/**
 * The tokens the party sees with: characters (not props or compasses), not hidden, that stand for
 * a character sheet or that a player put down. Players share what all of them see.
 */
export function isSightToken(t: TokenItem): boolean {
  return !t.art && t.layer !== "prop" && !t.hidden && (!!t.character || t.owner !== GM_OWNER);
}

/**
 * With per-player sight: whether a token sees for one player, who plays `character` (a sheet id,
 * or null) from the browser `userId` (null for the GM looking as them): their character's tokens,
 * and the ones they put down that aren't a character's.
 */
export function isOwnSightToken(t: TokenItem, character: string | null, userId: string | null): boolean {
  if (!isSightToken(t)) return false;
  return t.character ? t.character === character : userId !== null && t.owner === userId;
}

/** Walls in a grid of buckets, for quick ray tests. */
export class WallIndex {
  readonly segs: Seg[];
  private readonly cell: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: Int32Array[];
  private readonly stamp: Int32Array;
  private tick = 0;

  /** `segs` and the area's edges; `cell`: a bucket's side, in scene units. */
  constructor(segs: readonly Seg[], area: Area, cell: number) {
    const { x0, y0, x1, y1 } = area;
    this.segs = [...segs, [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
    this.cell = Math.max(1, cell);
    this.x0 = x0;
    this.y0 = y0;
    this.cols = Math.max(1, Math.ceil((x1 - x0) / this.cell));
    this.rows = Math.max(1, Math.ceil((y1 - y0) / this.cell));
    const lists: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    this.segs.forEach(([ax, ay, bx, by], i) => {
      // Every bucket the stretch's box touches (walls are short: a few buckets each).
      const c0 = this.col(Math.min(ax, bx)), c1 = this.col(Math.max(ax, bx));
      const r0 = this.row(Math.min(ay, by)), r1 = this.row(Math.max(ay, by));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * this.cols + c].push(i);
    });
    this.buckets = lists.map((l) => Int32Array.from(l));
    this.stamp = new Int32Array(this.segs.length);
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
  }

  /** The wall ends within `r` of a point (each once). */
  endsNear(x: number, y: number, r: number): number[] {
    const out: number[] = [];
    const seen = new Set<string>();
    const tick = ++this.tick;
    for (let row = this.row(y - r); row <= this.row(y + r); row++) {
      for (let col = this.col(x - r); col <= this.col(x + r); col++) {
        for (const i of this.buckets[row * this.cols + col]) {
          if (this.stamp[i] === tick) continue;
          this.stamp[i] = tick;
          const s = this.segs[i];
          for (let k = 0; k < 4; k += 2) {
            const px = s[k], py = s[k + 1];
            if ((px - x) ** 2 + (py - y) ** 2 > r * r) continue;
            const key = `${px},${py}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(px, py);
          }
        }
      }
    }
    return out;
  }

  /**
   * How far a ray from (x, y) going (dx, dy) (a unit vector) gets before a wall, at most `max`.
   * Steps through the buckets it crosses (a grid walk), testing each wall in them once.
   */
  cast(x: number, y: number, dx: number, dy: number, max: number): number {
    const tick = ++this.tick;
    let best = max;
    let col = this.col(x), row = this.row(y);
    const stepC = dx > 0 ? 1 : -1, stepR = dy > 0 ? 1 : -1;
    const nextX = this.x0 + (dx > 0 ? col + 1 : col) * this.cell;
    const nextY = this.y0 + (dy > 0 ? row + 1 : row) * this.cell;
    let tMaxX = dx !== 0 ? (nextX - x) / dx : Infinity;
    let tMaxY = dy !== 0 ? (nextY - y) / dy : Infinity;
    const tDX = dx !== 0 ? this.cell / Math.abs(dx) : Infinity;
    const tDY = dy !== 0 ? this.cell / Math.abs(dy) : Infinity;
    for (;;) {
      for (const i of this.buckets[row * this.cols + col]) {
        if (this.stamp[i] === tick) continue;
        this.stamp[i] = tick;
        const t = hit(x, y, dx, dy, this.segs[i]);
        if (t !== null && t < best) best = t;
      }
      // The nearest hit so far is nearer than the next bucket: nothing further can beat it.
      const leave = Math.min(tMaxX, tMaxY);
      if (leave >= best) return best;
      if (tMaxX < tMaxY) {
        col += stepC;
        if (col < 0 || col >= this.cols) return best;
        tMaxX += tDX;
      } else {
        row += stepR;
        if (row < 0 || row >= this.rows) return best;
        tMaxY += tDY;
      }
    }
  }
}

/** How far along a ray (unit direction) it meets a stretch, or null if it doesn't. */
function hit(x: number, y: number, dx: number, dy: number, s: Seg): number | null {
  const ex = s[2] - s[0], ey = s[3] - s[1];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const qx = s[0] - x, qy = s[1] - y;
  const t = (qx * ey - qy * ex) / den;
  const u = (qx * dy - qy * dx) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/** Rays round the edge of a reach: enough that a circle looks round. */
const EDGE_RAYS = 96;
/** Either side of a wall's end, so a ray slips past the corner and finds what's behind it. */
const NUDGE = 1e-4;

/**
 * What can be seen from (x, y) out to `r` (scene units), as a polygon [x0, y0, x1, y1, ...]
 * going round by angle. Inside the index's area.
 */
export function sightPolygon(index: WallIndex, x: number, y: number, r: number): number[] {
  const angles: number[] = [];
  const ends = index.endsNear(x, y, r);
  for (let i = 0; i < ends.length; i += 2) {
    const a = Math.atan2(ends[i + 1] - y, ends[i] - x);
    angles.push(a - NUDGE, a, a + NUDGE);
  }
  for (let i = 0; i < EDGE_RAYS; i++) angles.push(-Math.PI + (i / EDGE_RAYS) * 2 * Math.PI);
  angles.sort((a, b) => a - b);
  const out: number[] = [];
  let last = NaN;
  for (const a of angles) {
    if (a - last < 1e-9) continue;
    last = a;
    const dx = Math.cos(a), dy = Math.sin(a);
    const t = index.cast(x, y, dx, dy, r);
    out.push(x + dx * t, y + dy * t);
  }
  return out;
}

/** Whether a point is inside a polygon ([x0, y0, ...]), by the crossing rule. */
export function insidePolygon(poly: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The nearest door to a point within `near` (scene units), if any: for the GM's click. */
export function doorNear(doors: readonly DoorSpot[], x: number, y: number, near: number): DoorSpot | null {
  let best: DoorSpot | null = null;
  let bestD = near;
  for (const d of doors) {
    const [ax, ay, bx, by] = d.line;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dist = Math.hypot(mx - x, my - y);
    if (dist <= bestD) {
      best = d;
      bestD = dist;
    }
  }
  return best;
}

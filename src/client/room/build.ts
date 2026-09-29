// The browser side of built maps: an index of a scene's terrain chunks, the edits the
// Build tool makes to them, and the drawing of floors, objects, walls and doors.
//
// Floors and objects change rarely, so when zoomed out they're drawn once into an
// image (like the fog) and only the chunks that change are redrawn. Zoomed in past
// that image's detail they're drawn straight onto the board. Walls and doors are
// always drawn as lines, so they stay sharp.
//
// In a season, what's outdoors gets seasonal art (buildArt.ts): what counts as outdoors
// is worked out from the build itself (see computeExposure).

import { randomId } from "../../shared/ids";
import { applyOps } from "../../shared/ops";
import type { ItemMap } from "../../shared/ops";
import type { ItemOps } from "../../shared/protocol";
import { GM_OWNER } from "../../shared/sanitize";
import {
  CHUNK,
  CHUNK_CELLS,
  EMPTY,
  MAX_STAMPS_PER_CHUNK,
  chunkOf,
  emptyCells,
  emptyEdges,
  inChunk,
  isBuildingFloor,
  isWalledFloor,
  sceneCells,
  stampBlock,
  terrainId,
} from "../../shared/terrain";
import type { FloorId, Stamp, StampId } from "../../shared/terrain";
import type { GridSettings, Item, ItemPatch, Scene, SceneSeason, SeasonLook, TerrainItem } from "../../shared/types";
import { drawStamp, floorPattern, floorVariant, hasSeasonalArt, overlayPattern, stampHash } from "./buildArt";
import type { FloorVariant, OverlayId, SeasonLevel, StampLook } from "./buildArt";
import { STAMP_DRAW_AFTER, STAMP_DRAW_BEFORE, centreOf, drawnBounds, hitsPoint, placedOf, stampFor } from "./stampGeom";
import type { Placed } from "./stampGeom";

export type Side = "t" | "l";

// ---------------------------------------------------------------- keys

const OFF = 1 << 15;
/** A number standing for a grid cell (faster than a string in the drawing loops). */
export function cellKey(col: number, row: number): number {
  return (col + OFF) * 65536 + (row + OFF);
}
export function keyCol(k: number): number {
  return Math.floor(k / 65536) - OFF;
}
export function keyRow(k: number): number {
  return (k % 65536) - OFF;
}
/** A number standing for a cell's top ("t") or left ("l") edge. */
export function edgeKey(col: number, row: number, side: Side): number {
  return cellKey(col, row) * 2 + (side === "l" ? 1 : 0);
}
export function edgeOf(k: number): { col: number; row: number; side: Side } {
  const c = Math.floor(k / 2);
  return { col: keyCol(c), row: keyRow(c), side: k % 2 ? "l" : "t" };
}
function ckey(cx: number, cy: number): number {
  return (cx + 2048) * 4096 + (cy + 2048);
}
/** A number standing for the object at index i of the chunk at (cx, cy). */
function slot(cx: number, cy: number, i: number): number {
  return ckey(cx, cy) * 1024 + i;
}
/** Where a cell sits in its chunk's strings. */
function idx(col: number, row: number): number {
  return inChunk(row) * CHUNK + inChunk(col);
}
function edgeIdx(col: number, row: number, side: Side): number {
  return idx(col, row) * 2 + (side === "l" ? 1 : 0);
}
/** The cell on the other side of an edge. */
function across(col: number, row: number, side: Side): [number, number] {
  return side === "t" ? [col, row - 1] : [col - 1, row];
}

const EMPTY_CELLS = emptyCells();
const EMPTY_EDGES = emptyEdges();

// ---------------------------------------------------------------- the index

/** A scene's chunks: the public ones, and the hidden ones holding secret doors. */
export interface TerrainIndex {
  chunks: Map<number, TerrainItem>;
  secrets: Map<number, TerrainItem[]>;
}

export function indexTerrain(items: Iterable<TerrainItem>): TerrainIndex {
  const chunks = new Map<number, TerrainItem>();
  const secrets = new Map<number, TerrainItem[]>();
  for (const t of items) {
    const k = ckey(t.cx, t.cy);
    if (t.hidden) {
      const list = secrets.get(k);
      if (list) list.push(t);
      else secrets.set(k, [t]);
    } else {
      chunks.set(k, t);
    }
  }
  // Several hidden chunks for one place (made at once in two tabs): always read in the same order.
  for (const list of secrets.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { chunks, secrets };
}

export function sceneTerrain(items: ItemMap, sceneId: string): TerrainItem[] {
  const out: TerrainItem[] = [];
  for (const i of Object.values(items)) if (i.kind === "terrain" && i.sceneId === sceneId) out.push(i);
  return out;
}

// ---------------------------------------------------------------- objects and doors, picked out

/** An object as found: the chunk it's stored in, where in that chunk's list, and what it is. */
export interface StampHit {
  cx: number;
  cy: number;
  i: number;
  stamp: Stamp;
}

/**
 * An object picked out to act on later (a selection, one being dragged): where it was
 * found, and what it was then (key: stamp.join()), to find it again once things have changed.
 */
export interface StampRef {
  cx: number;
  cy: number;
  i: number;
  key: string;
}

/** A door or secret door: the cell whose top ("t") or left ("l") edge it's on. */
export interface DoorRef {
  col: number;
  row: number;
  side: Side;
}

export interface DoorHit extends DoorRef {
  style: "door" | "secret";
}

/** What an edit did to one object: where it was and what it was, and the same after. */
export interface StampPair {
  from: { cx: number; cy: number; i: number; stamp: Stamp };
  to: { cx: number; cy: number; i: number; stamp: Stamp };
}

/**
 * What an edit to objects did: the objects it leaves, to act on next; or why it did
 * nothing ("gone": none of them are there any more; "full": a chunk would hold more than
 * it can; "same": one exactly like it is there already).
 */
export type EditResult = { ok: true; refs: StampRef[] } | { ok: false; reason: "gone" | "full" | "same" };

export function refOf(h: StampHit): StampRef {
  return { cx: h.cx, cy: h.cy, i: h.i, key: h.stamp.join() };
}

/**
 * Finds objects picked out earlier as they are now. Each is where it was if it's still the
 * same there; otherwise the same object nearest there in its chunk (another tab has added
 * or taken away objects before it); otherwise it's left out (deleted, changed, or moved to
 * another chunk). No two refs find the same object, so two identical objects on one
 * square are found as two, and a ref listed twice once. Returns the refs as they are now,
 * what they found, and for each, which of the given refs it was.
 */
export function resolveRefs(
  chunk: (cx: number, cy: number) => { stamps: Stamp[] } | undefined,
  refs: StampRef[],
): { refs: StampRef[]; hits: StampHit[]; at: number[] } {
  const out = { refs: [] as StampRef[], hits: [] as StampHit[], at: [] as number[] };
  const claimed = new Set<number>();
  const listed = new Set<string>();
  refs.forEach((r, j) => {
    const stamps = chunk(r.cx, r.cy)?.stamps;
    const id = `${slot(r.cx, r.cy, r.i)}|${r.key}`;
    if (!stamps || listed.has(id)) return;
    listed.add(id);
    const free = (i: number) => !claimed.has(slot(r.cx, r.cy, i)) && stamps[i].join() === r.key;
    let i = r.i >= 0 && r.i < stamps.length && free(r.i) ? r.i : -1;
    if (i < 0) {
      for (let k = 0; k < stamps.length; k++) if (free(k) && (i < 0 || Math.abs(k - r.i) < Math.abs(i - r.i))) i = k;
      if (i < 0) return;
    }
    claimed.add(slot(r.cx, r.cy, i));
    out.refs.push({ cx: r.cx, cy: r.cy, i, key: r.key });
    out.hits.push({ cx: r.cx, cy: r.cy, i, stamp: stamps[i] });
    out.at.push(j);
  });
  return out;
}

/** What the Build tool is painting before it's committed: shown at once, sent when you let go. */
export interface BuildDraft {
  /** Cell -> the floor being painted, or "." to erase. */
  cells: Map<number, string>;
  /** Edge -> a wall being drawn, or one being taken away. */
  walls: Map<number, "add" | "remove">;
  /**
   * Erasing terrain: only the ground goes. (Erasing a room also takes the walls, doors
   * and objects on it; erasing grass beside a building mustn't take the building's door.)
   */
  groundOnly?: boolean;
}

const NONE = 0;
const WALL = 1;
const DOOR = 2;

/** Reads a scene's build, with the draft (if any) on top. */
export class BuildModel {
  index: TerrainIndex = { chunks: new Map(), secrets: new Map() };
  draft: BuildDraft | null = null;
  /** Objects being dragged somewhere else: not drawn where they are (see BuildRenderer.hideStamps). */
  hidden: StampRef[] = [];
  /** The same, as slot numbers, for the drawing loop. */
  hiddenSlots = new Set<number>();

  storedCell(col: number, row: number): string {
    const ch = this.index.chunks.get(ckey(chunkOf(col), chunkOf(row)));
    return ch ? ch.cells[idx(col, row)] : EMPTY;
  }

  cell(col: number, row: number): string {
    return this.draft?.cells.get(cellKey(col, row)) ?? this.storedCell(col, row);
  }

  edge(col: number, row: number, side: Side): string {
    const d = this.draft;
    if (d) {
      const w = d.walls.get(edgeKey(col, row, side));
      if (w) return w === "add" ? "w" : "o";
      // Erasing a room clears the walls and doors around it.
      const [ac, ar] = across(col, row, side);
      if (!d.groundOnly && (d.cells.get(cellKey(col, row)) === EMPTY || d.cells.get(cellKey(ac, ar)) === EMPTY)) return EMPTY;
    }
    const ch = this.index.chunks.get(ckey(chunkOf(col), chunkOf(row)));
    return ch ? ch.edges[edgeIdx(col, row, side)] : EMPTY;
  }

  secret(col: number, row: number, side: Side): boolean {
    const d = this.draft;
    if (d) {
      // Drawing or removing a wall there, or erasing beside it, does away with a secret door.
      if (d.walls.has(edgeKey(col, row, side))) return false;
      const [ac, ar] = across(col, row, side);
      if (!d.groundOnly && (d.cells.get(cellKey(col, row)) === EMPTY || d.cells.get(cellKey(ac, ar)) === EMPTY)) return false;
    }
    const list = this.index.secrets.get(ckey(chunkOf(col), chunkOf(row)));
    if (!list) return false;
    const i = edgeIdx(col, row, side);
    return list.some((t) => t.edges[i] === "s");
  }

  /** What an edge shows: nothing, a wall or a door. */
  state(col: number, row: number, side: Side): number {
    const e = this.edge(col, row, side);
    if (e === "w") return WALL;
    if (e === "d" || e === "D") return DOOR;
    if (e === "o") return NONE;
    const [ac, ar] = across(col, row, side);
    const a = this.cell(col, row);
    const b = this.cell(ac, ar);
    return (isWalledFloor(a) && !isBuildingFloor(b)) || (isWalledFloor(b) && !isBuildingFloor(a)) ? WALL : NONE;
  }

  /** The object whose block covers a cell, topmost, if any (as erasing goes by). */
  stampAt(col: number, row: number): StampHit | null {
    return stampsCovering(this.index.chunks, col, row).pop() ?? null;
  }

  /**
   * Objects whose drawing (grown by pad cells all round) is under a point, the one drawn
   * on top first. u and v are in cells, fractional: (x - offsetX) / size and the same down.
   */
  stampsAtPoint(u: number, v: number, pad: number): StampHit[] {
    const out: StampHit[] = [];
    // Only objects whose top-left cell is this near can reach the point (pad grows the
    // drawing most along its diagonals).
    const reach = pad * 1.5;
    const cx0 = chunkOf(Math.floor(u - STAMP_DRAW_AFTER - 1 - reach));
    const cx1 = chunkOf(Math.floor(u + STAMP_DRAW_BEFORE + reach));
    const cy0 = chunkOf(Math.floor(v - STAMP_DRAW_AFTER - 1 - reach));
    const cy1 = chunkOf(Math.floor(v + STAMP_DRAW_BEFORE + reach));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ch = this.index.chunks.get(ckey(cx, cy));
        if (!ch) continue;
        ch.stamps.forEach((stamp, i) => {
          if (hitsPoint(placedOf(cx, cy, stamp), u, v, pad)) out.push({ cx, cy, i, stamp });
        });
      }
    }
    return out.reverse();
  }

  /** The object drawn on top under a point (see stampsAtPoint), if any. */
  stampAtPoint(u: number, v: number, pad: number): StampHit | null {
    return this.stampsAtPoint(u, v, pad)[0] ?? null;
  }

  /** Objects whose middle is in a box (in cells, edges included, corners either way round), in drawing order. */
  stampsInBox(u0: number, v0: number, u1: number, v1: number): StampHit[] {
    const x0 = Math.min(u0, u1);
    const x1 = Math.max(u0, u1);
    const y0 = Math.min(v0, v1);
    const y1 = Math.max(v0, v1);
    const out: StampHit[] = [];
    // A middle is at most one and a half cells from the top-left cell.
    for (let cy = chunkOf(Math.floor(y0 - 1.5)); cy <= chunkOf(Math.floor(y1)); cy++) {
      for (let cx = chunkOf(Math.floor(x0 - 1.5)); cx <= chunkOf(Math.floor(x1)); cx++) {
        const ch = this.index.chunks.get(ckey(cx, cy));
        if (!ch) continue;
        ch.stamps.forEach((stamp, i) => {
          const { x, y } = centreOf(placedOf(cx, cy, stamp));
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push({ cx, cy, i, stamp });
        });
      }
    }
    return out;
  }

  /** Objects picked out earlier, as they are now (see resolveRefs). */
  resolve(refs: StampRef[]): { refs: StampRef[]; hits: StampHit[] } {
    const r = resolveRefs((cx, cy) => this.index.chunks.get(ckey(cx, cy)), refs);
    return { refs: r.refs, hits: r.hits };
  }

  /** What an edge is now: a door, a secret door, or neither. */
  doorStyle(d: DoorRef): "door" | "secret" | null {
    const e = this.edge(d.col, d.row, d.side);
    if (e === "d" || e === "D") return "door";
    return this.state(d.col, d.row, d.side) === WALL && this.secret(d.col, d.row, d.side) ? "secret" : null;
  }

  /**
   * The door or secret door on the grid line nearest a point (in cells, fractional), if
   * it's within reach cells of it; of the lines across and down, the nearer. Openings and
   * walls are never found. (Secret doors always are: only the GM builds, and never in
   * Player view.)
   */
  doorAt(u: number, v: number, reach: number): DoorHit | null {
    const lines: [number, DoorRef][] = [
      [Math.abs(v - Math.round(v)), { col: Math.floor(u), row: Math.round(v) || 0, side: "t" }],
      [Math.abs(u - Math.round(u)), { col: Math.round(u) || 0, row: Math.floor(v), side: "l" }],
    ];
    if (lines[1][0] < lines[0][0]) lines.reverse();
    for (const [dist, d] of lines) {
      if (dist > reach) continue;
      const style = this.doorStyle(d);
      if (style) return { ...d, style };
    }
    return null;
  }
}

/** Objects whose block covers a cell, in drawing order (the last is on top). */
function stampsCovering(chunks: Map<number, { cx: number; cy: number; stamps: Stamp[] }>, col: number, row: number): StampHit[] {
  const out: StampHit[] = [];
  for (let cy = chunkOf(row - 2); cy <= chunkOf(row); cy++) {
    for (let cx = chunkOf(col - 2); cx <= chunkOf(col); cx++) {
      const ch = chunks.get(ckey(cx, cy));
      if (!ch) continue;
      ch.stamps.forEach((stamp, i) => {
        const ax = cx * CHUNK + stamp[1];
        const ay = cy * CHUNK + stamp[2];
        const n = stampBlock(stamp[4]);
        if (col >= ax && col < ax + n && row >= ay && row < ay + n) out.push({ cx, cy, i, stamp });
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- edits

interface WorkChunk {
  cx: number;
  cy: number;
  cells: string[];
  edges: string[];
  stamps: Stamp[];
  stampsChanged: boolean;
  orig: TerrainItem | undefined;
}

interface WorkSecrets {
  cx: number;
  cy: number;
  edges: string[];
  orig: TerrainItem[];
}

/**
 * One change to a scene's build, made on a copy of the chunks it touches and turned
 * into item operations at the end: patches to chunks that exist (only the parts that
 * changed), new chunks, and chunks left empty deleted.
 */
export class BuildEdit {
  private work = new Map<number, WorkChunk>();
  private secretWork = new Map<number, WorkSecrets>();
  private index: TerrainIndex;
  private placedPairs: StampPair[] = [];

  constructor(
    items: ItemMap,
    private readonly sceneId: string,
  ) {
    this.index = indexTerrain(sceneTerrain(items, sceneId));
  }

  private chunk(col: number, row: number): WorkChunk {
    const cx = chunkOf(col);
    const cy = chunkOf(row);
    const k = ckey(cx, cy);
    let w = this.work.get(k);
    if (!w) {
      const orig = this.index.chunks.get(k);
      w = {
        cx,
        cy,
        cells: [...(orig?.cells ?? EMPTY_CELLS)],
        edges: [...(orig?.edges ?? EMPTY_EDGES)],
        stamps: orig ? orig.stamps.slice() : [],
        stampsChanged: false,
        orig,
      };
      this.work.set(k, w);
    }
    return w;
  }

  /** Reads without making a working copy. */
  private peek(col: number, row: number): { cells: ArrayLike<string>; edges: ArrayLike<string> } | undefined {
    const k = ckey(chunkOf(col), chunkOf(row));
    return this.work.get(k) ?? this.index.chunks.get(k);
  }

  /** The objects of the chunk at (cx, cy) as the edit has them so far, without making a working copy. */
  private view(cx: number, cy: number): { stamps: Stamp[] } | undefined {
    const k = ckey(cx, cy);
    return this.work.get(k) ?? this.index.chunks.get(k);
  }

  private stampCount(cx: number, cy: number): number {
    return this.view(cx, cy)?.stamps.length ?? 0;
  }

  cell(col: number, row: number): string {
    return this.peek(col, row)?.cells[idx(col, row)] ?? EMPTY;
  }

  setCell(col: number, row: number, ch: string): void {
    if (this.cell(col, row) === ch) return;
    this.chunk(col, row).cells[idx(col, row)] = ch;
  }

  edge(col: number, row: number, side: Side): string {
    return this.peek(col, row)?.edges[edgeIdx(col, row, side)] ?? EMPTY;
  }

  setEdge(col: number, row: number, side: Side, ch: string): void {
    if (this.edge(col, row, side) === ch) return;
    this.chunk(col, row).edges[edgeIdx(col, row, side)] = ch;
  }

  /** Whether a wall would be drawn here automatically (a walled room floor meeting empty space or terrain). */
  autoWall(col: number, row: number, side: Side): boolean {
    const [ac, ar] = across(col, row, side);
    const a = this.cell(col, row);
    const b = this.cell(ac, ar);
    return (isWalledFloor(a) && !isBuildingFloor(b)) || (isWalledFloor(b) && !isBuildingFloor(a));
  }

  isWall(col: number, row: number, side: Side): boolean {
    const e = this.edge(col, row, side);
    return e === "w" || (e === EMPTY && this.autoWall(col, row, side));
  }

  private secretsFor(col: number, row: number): WorkSecrets {
    const cx = chunkOf(col);
    const cy = chunkOf(row);
    const k = ckey(cx, cy);
    let w = this.secretWork.get(k);
    if (!w) {
      const orig = this.index.secrets.get(k) ?? [];
      const edges = [...EMPTY_EDGES];
      // Several for one place: merge them into the first.
      for (const t of orig) for (let i = 0; i < edges.length; i++) if (t.edges[i] === "s") edges[i] = "s";
      w = { cx, cy, edges, orig };
      this.secretWork.set(k, w);
    }
    return w;
  }

  secret(col: number, row: number, side: Side): boolean {
    const k = ckey(chunkOf(col), chunkOf(row));
    const w = this.secretWork.get(k);
    const i = edgeIdx(col, row, side);
    if (w) return w.edges[i] === "s";
    return (this.index.secrets.get(k) ?? []).some((t) => t.edges[i] === "s");
  }

  setSecret(col: number, row: number, side: Side, on: boolean): void {
    if (this.secret(col, row, side) === on) return;
    this.secretsFor(col, row).edges[edgeIdx(col, row, side)] = on ? "s" : EMPTY;
  }

  /** Clears a cell: its floor, the walls and doors around it, and any object over it. */
  erase(col: number, row: number): void {
    this.setCell(col, row, EMPTY);
    for (const [c, r, side] of [
      [col, row, "t"],
      [col, row, "l"],
      [col, row + 1, "t"],
      [col + 1, row, "l"],
    ] as [number, number, Side][]) {
      this.setEdge(c, r, side, EMPTY);
      this.setSecret(c, r, side, false);
    }
    for (const hit of this.covering(col, row).reverse()) {
      const w = this.chunk(hit.cx * CHUNK, hit.cy * CHUNK);
      w.stamps.splice(hit.i, 1);
      w.stampsChanged = true;
    }
  }

  private covering(col: number, row: number): StampHit[] {
    const view = new Map<number, { cx: number; cy: number; stamps: Stamp[] }>();
    for (let cy = chunkOf(row - 2); cy <= chunkOf(row); cy++) {
      for (let cx = chunkOf(col - 2); cx <= chunkOf(col); cx++) {
        const k = ckey(cx, cy);
        const ch = this.work.get(k) ?? this.index.chunks.get(k);
        if (ch) view.set(k, ch);
      }
    }
    return stampsCovering(view, col, row);
  }

  removeStampAt(col: number, row: number): boolean {
    const hit = this.covering(col, row).pop();
    if (!hit) return false;
    const w = this.chunk(hit.cx * CHUNK, hit.cy * CHUNK);
    w.stamps.splice(hit.i, 1);
    w.stampsChanged = true;
    return true;
  }

  /**
   * Undoes or redoes an earlier step in the chunk at (cx, cy): each cell, edge and object
   * the step changed from `from` to `to` becomes `to` again, unless something else has
   * changed it since (another tab), in which case it's left alone.
   */
  mergeChunk(cx: number, cy: number, from: ChunkData, to: ChunkData): void {
    const w = this.chunk(cx * CHUNK, cy * CHUNK);
    for (let i = 0; i < CHUNK_CELLS; i++) {
      if (from.cells[i] !== to.cells[i] && w.cells[i] === from.cells[i]) w.cells[i] = to.cells[i];
    }
    for (let i = 0; i < CHUNK_CELLS * 2; i++) {
      if (from.edges[i] !== to.edges[i] && w.edges[i] === from.edges[i]) w.edges[i] = to.edges[i];
    }
    // Objects are counted, not just compared: two identical ones can share a square.
    const key = (s: Stamp) => s.join();
    const count = (list: Stamp[]) => {
      const m = new Map<string, number>();
      for (const s of list) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
      return m;
    };
    const toCount = count(to.stamps);
    // What `from` has and `to` doesn't (to take away), and the other way round (to put
    // back, with where it sat, so the order objects are drawn in comes back too).
    const gone: Stamp[] = [];
    const left = new Map(toCount);
    for (const s of from.stamps) {
      const n = left.get(key(s)) ?? 0;
      if (n > 0) left.set(key(s), n - 1);
      else gone.push(s);
    }
    const back: { s: Stamp; at: number }[] = [];
    const leftFrom = count(from.stamps);
    to.stamps.forEach((s, at) => {
      const n = leftFrom.get(key(s)) ?? 0;
      if (n > 0) leftFrom.set(key(s), n - 1);
      else back.push({ s, at });
    });
    const sameObject = (a: Stamp, b: Stamp) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[4] === b[4];
    for (const b of [...back]) {
      // One object turned: turn it back where it is, if it's still as the step left it.
      const g = gone.findIndex((x) => sameObject(x, b.s));
      if (g < 0) continue;
      const [old] = gone.splice(g, 1);
      back.splice(back.indexOf(b), 1);
      const i = w.stamps.findIndex((x) => key(x) === key(old));
      if (i >= 0) {
        w.stamps[i] = b.s;
        w.stampsChanged = true;
      }
    }
    for (const s of gone) {
      const i = w.stamps.findIndex((x) => key(x) === key(s));
      if (i >= 0) {
        w.stamps.splice(i, 1);
        w.stampsChanged = true;
      }
    }
    for (const { s, at } of back) {
      // Already back (undone in another tab too, say): leave it.
      if (w.stamps.filter((x) => key(x) === key(s)).length >= (toCount.get(key(s)) ?? 0)) continue;
      if (w.stamps.length >= MAX_STAMPS_PER_CHUNK) continue;
      w.stamps.splice(Math.min(at, w.stamps.length), 0, s);
      w.stampsChanged = true;
    }
  }

  /** The same for the secret doors of the chunk at (cx, cy). */
  mergeSecrets(cx: number, cy: number, from: string, to: string): void {
    const w = this.secretsFor(cx * CHUNK, cy * CHUNK);
    for (let i = 0; i < CHUNK_CELLS * 2; i++) {
      if (from[i] !== to[i] && w.edges[i] === from[i]) w.edges[i] = to[i];
    }
  }

  /**
   * Undoes (back) or redoes the objects an earlier step moved, turned or sized (its
   * pairs, from place()), before mergeChunk does the rest: each object the step left
   * becomes what it was again, where it was in the drawing order, or the other way round.
   * One that isn't there as the step left it (another tab has changed it, moved it or
   * taken it away since) is left alone, and so is one whose chunk would hold too many.
   * `was` gives a chunk's objects as they were where the pairs go back to (as the step
   * found them when undoing, as it left them when redoing): see putBack.
   */
  mergePairs(pairs: StampPair[], back: boolean, was?: (cx: number, cy: number) => Stamp[] | undefined): void {
    if (!pairs.length) return;
    const ends = pairs.map((p) => (back ? { cur: p.to, prev: p.from } : { cur: p.from, prev: p.to }));
    const found = resolveRefs(
      (cx, cy) => this.view(cx, cy),
      ends.map((e) => ({ cx: e.cur.cx, cy: e.cur.cy, i: e.cur.i, key: e.cur.stamp.join() })),
    );
    // Which of those still go ahead: all but the ones coming into a chunk that would then
    // hold too many (the last ones there first, looking again after each round, as leaving
    // one out can leave another chunk with one more).
    const live = found.hits.map((hit, j) => ({ hit, ...ends[found.at[j]] }));
    for (;;) {
      const count = new Map<number, number>();
      const add = (cx: number, cy: number, n: number) => {
        const k = ckey(cx, cy);
        count.set(k, (count.get(k) ?? this.stampCount(cx, cy)) + n);
      };
      for (const m of live) {
        add(m.hit.cx, m.hit.cy, -1);
        add(m.prev.cx, m.prev.cy, 1);
      }
      let skipped = false;
      for (let j = live.length - 1; j >= 0; j--) {
        const m = live[j];
        const k = ckey(m.prev.cx, m.prev.cy);
        if (count.get(k)! <= MAX_STAMPS_PER_CHUNK || k === ckey(m.hit.cx, m.hit.cy)) continue;
        count.set(k, count.get(k)! - 1);
        live.splice(j, 1);
        skipped = true;
      }
      if (!skipped) break;
    }
    if (!live.length) return;
    // One the step changed where it stood in its chunk's list (turned, sized or moved within
    // the chunk) is changed back where it is now: that's still its place among the rest,
    // whatever other tabs have added or taken away before it since.
    const moving: typeof live = [];
    for (const m of live) {
      if (m.cur.cx !== m.prev.cx || m.cur.cy !== m.prev.cy || m.cur.i !== m.prev.i) {
        moving.push(m);
        continue;
      }
      const w = this.chunk(m.hit.cx * CHUNK, m.hit.cy * CHUNK);
      w.stamps[m.hit.i] = m.prev.stamp;
      w.stampsChanged = true;
    }
    // The rest out of each chunk from the end of its list first, so the others keep their
    // places; then back in, chunk by chunk.
    for (const m of [...moving].sort((a, b) => b.hit.i - a.hit.i)) {
      const w = this.chunk(m.hit.cx * CHUNK, m.hit.cy * CHUNK);
      w.stamps.splice(m.hit.i, 1);
      w.stampsChanged = true;
    }
    const into = new Map<number, StampPair["from"][]>();
    for (const { prev } of moving) {
      const k = ckey(prev.cx, prev.cy);
      const list = into.get(k);
      if (list) list.push(prev);
      else into.set(k, [prev]);
    }
    for (const list of into.values()) this.putBack(list, was?.(list[0].cx, list[0].cy));
  }

  /**
   * Puts objects back into one chunk, for mergePairs. With `was`, the chunk's list as it was
   * when they were last there, each goes just under the first object that was drawn over it
   * then and is still there (found as resolveRefs finds objects), or on top if none is: so
   * objects another tab has taken away or added since don't put it over or under others it
   * wasn't. Without it, each goes back at its old index, the first place first.
   */
  private putBack(prevs: StampPair["from"][], was: Stamp[] | undefined): void {
    const { cx, cy } = prevs[0];
    const w = this.chunk(cx * CHUNK, cy * CHUNK);
    w.stampsChanged = true;
    const sorted = [...prevs].sort((a, b) => a.i - b.i);
    if (!was || sorted.some((p) => was[p.i]?.join() !== p.stamp.join())) {
      for (const p of sorted) w.stamps.splice(Math.min(p.i, w.stamps.length), 0, p.stamp);
      return;
    }
    // The others in that list, found where they now are (each looked for where it would be
    // if nothing had changed since).
    const coming = new Set(sorted.map((p) => p.i));
    const others: StampRef[] = [];
    const wasAt: number[] = [];
    was.forEach((s, i) => {
      if (coming.has(i)) return;
      others.push({ cx, cy, i: others.length, key: s.join() });
      wasAt.push(i);
    });
    const found = resolveRefs(() => w, others);
    const now = new Map<number, number>();
    found.at.forEach((j, n) => now.set(wasAt[j], found.hits[n].i));
    const places = sorted.map((p) => {
      for (let i = p.i + 1; i < was.length; i++) {
        const at = now.get(i);
        if (at !== undefined) return { p, at };
      }
      return { p, at: w.stamps.length };
    });
    // The last place first, and of several going in at one place the last first, so each
    // lands where it was worked out to go, in the order they were in.
    places.sort((a, b) => b.at - a.at || b.p.i - a.p.i);
    for (const { p, at } of places) w.stamps.splice(at, 0, p.stamp);
  }

  /** Places an object with its top-left cell at (col, row). False if that block is full. */
  addStamp(id: StampId, col: number, row: number, turns: number, size: number): boolean {
    const w = this.chunk(col, row);
    if (w.stamps.length >= MAX_STAMPS_PER_CHUNK) return false;
    w.stamps.push([id, inChunk(col), inChunk(row), turns, size]);
    w.stampsChanged = true;
    return true;
  }

  /** Places one object ("same": one exactly like it stands there already; "full": its chunk is full). */
  addPlaced(p: Placed): EditResult {
    return this.addGroup([p]);
  }

  /**
   * Places several, in the order given (so drawn in that order), or none: "full" if a
   * chunk would hold too many, "same" if any would be exactly like an object already there.
   */
  addGroup(ps: Placed[]): EditResult {
    const adds = ps.map(stampFor);
    const arriving = new Map<number, number>();
    for (const a of adds) {
      const key = a.stamp.join();
      if (this.view(a.cx, a.cy)?.stamps.some((s) => s.join() === key)) return { ok: false, reason: "same" };
      const k = ckey(a.cx, a.cy);
      arriving.set(k, (arriving.get(k) ?? 0) + 1);
    }
    for (const a of adds) {
      if (this.stampCount(a.cx, a.cy) + arriving.get(ckey(a.cx, a.cy))! > MAX_STAMPS_PER_CHUNK) return { ok: false, reason: "full" };
    }
    const refs = adds.map((a) => {
      const w = this.chunk(a.cx * CHUNK, a.cy * CHUNK);
      w.stamps.push(a.stamp);
      w.stampsChanged = true;
      return { cx: a.cx, cy: a.cy, i: w.stamps.length - 1, key: a.stamp.join() };
    });
    return { ok: true, refs };
  }

  /**
   * Makes each object refs[k] exactly next[k]: how moves, turns and size changes are made.
   * Refs are found again first (see resolveRefs), and ones no longer there are skipped with
   * their next[k]: "gone" if none are left. One that stays in its chunk keeps its place in
   * the drawing order; one that moves to another chunk goes on top there, but under any of
   * the others given that were drawn over it (see below). Every change or none: "full" if a
   * chunk would hold too many. Returns the objects as they now are, in the order given
   * (those already as asked too), and keeps what it did to each for undo (pairs).
   */
  place(refs: StampRef[], next: Placed[]): EditResult {
    if (refs.length !== next.length) throw new Error("place: a new place for each object, no more, no less");
    const found = resolveRefs((cx, cy) => this.view(cx, cy), refs);
    if (!found.hits.length) return { ok: false, reason: "gone" };
    const moves = found.hits.map((hit, j) => {
      const to = stampFor(next[found.at[j]]);
      const kind = to.cx !== hit.cx || to.cy !== hit.cy ? "leave" : to.stamp.join() === found.refs[j].key ? "keep" : "stay";
      return { hit, to, kind, i: hit.i };
    });
    // How many objects each chunk gains, less those it loses.
    const gain = new Map<number, number>();
    for (const m of moves) {
      if (m.kind !== "leave") continue;
      const from = ckey(m.hit.cx, m.hit.cy);
      const to = ckey(m.to.cx, m.to.cy);
      gain.set(from, (gain.get(from) ?? 0) - 1);
      gain.set(to, (gain.get(to) ?? 0) + 1);
    }
    for (const m of moves) {
      if (m.kind === "leave" && this.stampCount(m.to.cx, m.to.cy) + gain.get(ckey(m.to.cx, m.to.cy))! > MAX_STAMPS_PER_CHUNK) return { ok: false, reason: "full" };
    }
    // Each chunk that objects change in or leave is made again in one go: those leaving
    // left out, those changing changed where they are, the rest as they were.
    const bySource = new Map<number, typeof moves>();
    for (const m of moves) {
      const k = ckey(m.hit.cx, m.hit.cy);
      const list = bySource.get(k);
      if (list) list.push(m);
      else bySource.set(k, [m]);
    }
    for (const list of bySource.values()) {
      if (list.every((m) => m.kind === "keep")) continue;
      const w = this.chunk(list[0].hit.cx * CHUNK, list[0].hit.cy * CHUNK);
      const at = new Map(list.map((m) => [m.hit.i, m]));
      const out: Stamp[] = [];
      w.stamps.forEach((s, i) => {
        const m = at.get(i);
        if (m?.kind === "leave") return;
        if (m) m.i = out.length;
        out.push(m?.kind === "stay" ? m.to.stamp : s);
      });
      w.stamps = out;
      w.stampsChanged = true;
    }
    // Those moving to another chunk go on top there, one by one in the order they were
    // drawn in (not the order given), except that each goes just under the first of the
    // others there that was drawn over it: so a group stays stacked as it was, however it
    // was picked out and wherever chunk borders fall (a chair on a table stays on it).
    const drawnAfter = (a: StampHit, b: StampHit) => a.cy - b.cy || a.cx - b.cx || a.i - b.i;
    const there = new Map([...bySource].map(([k, list]) => [k, list.filter((m) => m.kind !== "leave")]));
    for (const m of moves.filter((m) => m.kind === "leave").sort((a, b) => drawnAfter(a.hit, b.hit))) {
      const k = ckey(m.to.cx, m.to.cy);
      const w = this.chunk(m.to.cx * CHUNK, m.to.cy * CHUNK);
      const others = there.get(k) ?? [];
      let at = w.stamps.length;
      for (const o of others) if (o.i < at && drawnAfter(o.hit, m.hit) > 0) at = o.i;
      for (const o of others) if (o.i >= at) o.i++;
      m.i = at;
      w.stamps.splice(at, 0, m.to.stamp);
      w.stampsChanged = true;
      there.set(k, [...others, m]);
    }
    for (const m of moves) {
      if (m.kind === "keep") continue;
      const to = { cx: m.to.cx, cy: m.to.cy, i: m.i, stamp: m.to.stamp };
      // One placed again in the same edit keeps one pair, from where it was at first.
      const key = m.hit.stamp.join();
      const j = this.placedPairs.findIndex((p) => p.to.cx === m.hit.cx && p.to.cy === m.hit.cy && p.to.i === m.hit.i && p.to.stamp.join() === key);
      const from = j >= 0 ? this.placedPairs[j].from : { cx: m.hit.cx, cy: m.hit.cy, i: m.hit.i, stamp: m.hit.stamp };
      if (j >= 0) this.placedPairs.splice(j, 1);
      // (Back just as it was: nothing to undo.)
      if (from.cx === to.cx && from.cy === to.cy && from.i === to.i && from.stamp.join() === to.stamp.join()) continue;
      this.placedPairs.push({ from, to });
    }
    return { ok: true, refs: moves.map((m) => ({ cx: m.to.cx, cy: m.to.cy, i: m.i, key: m.to.stamp.join() })) };
  }

  /** Takes away the objects that are still there (see resolveRefs). Returns how many. */
  removeRefs(refs: StampRef[]): number {
    const { hits } = resolveRefs((cx, cy) => this.view(cx, cy), refs);
    // From the end of each chunk's list first, so the others keep their places.
    hits.sort((a, b) => b.i - a.i);
    for (const h of hits) {
      const w = this.chunk(h.cx * CHUNK, h.cy * CHUNK);
      w.stamps.splice(h.i, 1);
      w.stampsChanged = true;
    }
    return hits.length;
  }

  /**
   * Takes away each door or secret door, leaving what was there before it (a wall, or
   * nothing); anything else (an opening, a wall, nothing) is skipped. Returns how many.
   */
  removeDoors(doors: DoorRef[]): number {
    let n = 0;
    for (const { col, row, side } of doors) {
      const e = this.edge(col, row, side);
      if (e !== "d" && e !== "D" && !(this.isWall(col, row, side) && this.secret(col, row, side))) continue;
      setPortal(this, col, row, side, "wall");
      n++;
    }
    return n;
  }

  /** What place() has done to each object so far, for buildUndo. */
  pairs(): StampPair[] {
    return this.placedPairs.slice();
  }

  ops(): ItemOps {
    const upsert: TerrainItem[] = [];
    const patch: ItemPatch[] = [];
    const del: string[] = [];
    for (const w of this.work.values()) {
      const cells = w.cells.join("");
      const edges = w.edges.join("");
      const empty = cells === EMPTY_CELLS && edges === EMPTY_EDGES && !w.stamps.length;
      if (w.orig) {
        // An empty chunk is deleted, so it doesn't take up room in the scene forever.
        if (empty) {
          del.push(w.orig.id);
          continue;
        }
        const set: ItemPatch["set"] = {};
        if (cells !== w.orig.cells) set.cells = cells;
        if (edges !== w.orig.edges) set.edges = edges;
        if (w.stampsChanged && !sameStamps(w.stamps, w.orig.stamps)) set.stamps = w.stamps;
        if (Object.keys(set).length) patch.push({ id: w.orig.id, set });
      } else if (!empty) {
        upsert.push({
          id: terrainId(this.sceneId, w.cx, w.cy),
          sceneId: this.sceneId,
          kind: "terrain",
          z: 0,
          owner: GM_OWNER,
          cx: w.cx,
          cy: w.cy,
          cells,
          edges,
          stamps: w.stamps,
        });
      }
    }
    for (const w of this.secretWork.values()) {
      const edges = w.edges.join("");
      const any = edges.includes("s");
      const [first, ...rest] = w.orig;
      if (first) {
        if (!any) del.push(first.id);
        else if (edges !== first.edges) patch.push({ id: first.id, set: { edges } });
        for (const t of rest) del.push(t.id);
      } else if (any) {
        // Players never receive hidden chunks. A random id: they can't guess it to probe for one.
        upsert.push({
          id: randomId(12),
          sceneId: this.sceneId,
          kind: "terrain",
          z: 0,
          owner: GM_OWNER,
          cx: w.cx,
          cy: w.cy,
          cells: EMPTY_CELLS,
          edges,
          stamps: [],
          hidden: true,
        });
      }
    }
    const out: ItemOps = {};
    if (upsert.length) out.upsert = upsert;
    if (patch.length) out.patch = patch;
    if (del.length) out.delete = del;
    return out;
  }
}

/**
 * Draws or removes a wall. Where a wall is drawn automatically, adding one keeps it
 * automatic (so it goes if the floor there does); removing one leaves an opening.
 */
export function setWall(edit: BuildEdit, col: number, row: number, side: Side, mode: "add" | "remove"): void {
  const auto = edit.autoWall(col, row, side);
  if (mode === "add") edit.setEdge(col, row, side, auto ? EMPTY : "w");
  else edit.setEdge(col, row, side, auto ? "o" : EMPTY);
  edit.setSecret(col, row, side, false);
}

/** Doors: a wall or an opening becomes a door, a door a secret door, a secret door a wall again. */
export function cycleDoor(edit: BuildEdit, col: number, row: number, side: Side): void {
  if (edit.edge(col, row, side) === "d") {
    // Players see a secret door as the wall it's in.
    edit.setEdge(col, row, side, edit.autoWall(col, row, side) ? EMPTY : "w");
    edit.setSecret(col, row, side, true);
  } else if (edit.isWall(col, row, side) && edit.secret(col, row, side)) {
    edit.setSecret(col, row, side, false);
  } else {
    edit.setEdge(col, row, side, "d");
    edit.setSecret(col, row, side, false);
  }
}

/** What a chunk holds. */
export interface ChunkData {
  cells: string;
  edges: string;
  stamps: Stamp[];
}

const EMPTY_CHUNK: ChunkData = { cells: EMPTY_CELLS, edges: EMPTY_EDGES, stamps: [] };

/** A scene's secret doors in one chunk, from all the hidden chunks there. */
function secretsIn(items: ItemMap, sceneId: string, cx: number, cy: number): string {
  const out = [...EMPTY_EDGES];
  for (const t of Object.values(items)) {
    if (t.kind !== "terrain" || !t.hidden || t.sceneId !== sceneId || t.cx !== cx || t.cy !== cy) continue;
    for (let i = 0; i < out.length; i++) if (t.edges[i] === "s") out[i] = "s";
  }
  return out.join("");
}

export interface BuildUndo {
  undo: (now: ItemMap) => ItemOps;
  redo: (now: ItemMap) => ItemOps;
}

/**
 * Undo and redo for a build change (`ops`, made to `items`). Rather than putting whole
 * chunks back as they were, which would also wipe out what another tab has built in
 * them since, each puts back only what the change itself changed, and only where it's
 * still as the change left it. Worked out when used, from the state as it is then.
 * `pairs` (BuildEdit.pairs()) are the objects the change moved, turned or sized: each is
 * put back as itself (see mergePairs), rather than matched up by what it is, so an object
 * another tab has changed since is never taken for another or brought back twice. The
 * objects the change added or took away are counted, as before (see mergeChunk).
 */
export function buildUndo(items: ItemMap, sceneId: string, ops: ItemOps, pairs: StampPair[] = []): BuildUndo {
  const after = applyOps(items, ops);
  const ids = new Set(opIds(ops));
  const chunks = new Map<number, { cx: number; cy: number; before: ChunkData; after: ChunkData }>();
  const secrets = new Map<number, { cx: number; cy: number; before: string; after: string }>();
  const data = (map: ItemMap, id: string): ChunkData => {
    const t = map[id];
    return t?.kind === "terrain" ? { cells: t.cells, edges: t.edges, stamps: t.stamps } : EMPTY_CHUNK;
  };
  for (const id of ids) {
    const t = items[id] ?? after[id];
    if (t?.kind !== "terrain" || t.sceneId !== sceneId) continue;
    const k = ckey(t.cx, t.cy);
    if (t.hidden) {
      if (!secrets.has(k)) {
        secrets.set(k, { cx: t.cx, cy: t.cy, before: secretsIn(items, sceneId, t.cx, t.cy), after: secretsIn(after, sceneId, t.cx, t.cy) });
      }
    } else {
      chunks.set(k, { cx: t.cx, cy: t.cy, before: data(items, id), after: data(after, id) });
    }
  }
  // Each chunk's objects whole, before and after, for putting the pairs back among the rest.
  const lists = new Map([...chunks].map(([k, c]) => [k, { before: c.before.stamps, after: c.after.stamps }]));
  // What the pairs put back is left out of what mergeChunk compares: each chunk as it was
  // without the objects that moved, turned or changed size in it, and the same after.
  for (const c of chunks.values()) {
    const from = pairs.filter((p) => p.from.cx === c.cx && p.from.cy === c.cy).map((p) => p.from.stamp);
    const to = pairs.filter((p) => p.to.cx === c.cx && p.to.cy === c.cy).map((p) => p.to.stamp);
    if (from.length) c.before = { ...c.before, stamps: without(c.before.stamps, from) };
    if (to.length) c.after = { ...c.after, stamps: without(c.after.stamps, to) };
  }
  const run = (now: ItemMap, back: boolean): ItemOps => {
    const edit = new BuildEdit(now, sceneId);
    edit.mergePairs(pairs, back, (cx, cy) => {
      const l = lists.get(ckey(cx, cy));
      return l && (back ? l.before : l.after);
    });
    for (const c of chunks.values()) {
      if (back) edit.mergeChunk(c.cx, c.cy, c.after, c.before);
      else edit.mergeChunk(c.cx, c.cy, c.before, c.after);
    }
    for (const s of secrets.values()) {
      if (back) edit.mergeSecrets(s.cx, s.cy, s.after, s.before);
      else edit.mergeSecrets(s.cx, s.cy, s.before, s.after);
    }
    return edit.ops();
  };
  return { undo: (now) => run(now, true), redo: (now) => run(now, false) };
}

/** A list of objects with one of each of these taken out (identical objects are counted). */
function without(stamps: Stamp[], taken: Stamp[]): Stamp[] {
  const left = new Map<string, number>();
  for (const s of taken) left.set(s.join(), (left.get(s.join()) ?? 0) + 1);
  return stamps.filter((s) => {
    const n = left.get(s.join()) ?? 0;
    if (n > 0) left.set(s.join(), n - 1);
    return n === 0;
  });
}

/** The ids of the items some operations change. */
function opIds(ops: ItemOps): string[] {
  return [...(ops.upsert ?? []).map((i) => i.id), ...(ops.patch ?? []).map((p) => p.id), ...(ops.delete ?? [])];
}

/**
 * One undo step made of two in a row: undoing undoes b, then a on what that leaves;
 * redoing redoes a, then b. Each still leaves alone what other tabs have changed since.
 */
export function composeBuildUndo(a: BuildUndo, b: BuildUndo): BuildUndo {
  const run = (now: ItemMap, first: (now: ItemMap) => ItemOps, second: (now: ItemMap) => ItemOps): ItemOps => {
    const o1 = first(now);
    const mid = applyOps(now, o1);
    const o2 = second(mid);
    return opsBetween(now, applyOps(mid, o2), [...opIds(o1), ...opIds(o2)]);
  };
  return { undo: (now) => run(now, b.undo, a.undo), redo: (now) => run(now, a.redo, b.redo) };
}

/**
 * The item operations that turn `now` into `final`, for the given ids: items only in
 * `now` deleted, items only in `final` added, and for chunks in both, a patch of their
 * cells, edges and objects where they differ.
 */
export function opsBetween(now: ItemMap, final: ItemMap, ids: Iterable<string>): ItemOps {
  const upsert: Item[] = [];
  const patch: ItemPatch[] = [];
  const del: string[] = [];
  for (const id of new Set(ids)) {
    const a = now[id];
    const b = final[id];
    if (a === b) continue;
    if (!b) {
      del.push(id);
    } else if (a?.kind !== "terrain" || b.kind !== "terrain") {
      upsert.push(b);
    } else {
      const set: ItemPatch["set"] = {};
      if (a.cells !== b.cells) set.cells = b.cells;
      if (a.edges !== b.edges) set.edges = b.edges;
      if (!sameStamps(a.stamps, b.stamps)) set.stamps = b.stamps;
      if (Object.keys(set).length) patch.push({ id, set });
    }
  }
  const out: ItemOps = {};
  if (upsert.length) out.upsert = upsert;
  if (patch.length) out.patch = patch;
  if (del.length) out.delete = del;
  return out;
}

/** What a click with the Doors tool makes of a grid line (named after Dungeondraft's portal styles). */
export type PortalStyle = "open" | "door" | "secret" | "wall";

/**
 * Doors: puts a door, a secret door or an opening in a wall, or (style "wall") takes one
 * away again. Choosing the style a line already has also takes it away. What each leaves
 * behind is stored with it, so taking it away puts back exactly what was there: a door
 * cut into a hand-drawn wall is "D", an opening is "o", and a secret door is the wall it's
 * in plus a hidden flag.
 */
export function setPortal(edit: BuildEdit, col: number, row: number, side: Side, style: PortalStyle): void {
  const e = edit.edge(col, row, side);
  const auto = edit.autoWall(col, row, side);
  const isDoor = e === "d" || e === "D";
  const isSecret = edit.isWall(col, row, side) && edit.secret(col, row, side);
  const isOpening = e === "o";
  if (style === "wall" || (style === "door" && isDoor) || (style === "secret" && isSecret) || (style === "open" && isOpening)) {
    if (isSecret) {
      // Players have seen a wall there all along: it simply stops being secret.
      edit.setSecret(col, row, side, false);
    } else if (isDoor) {
      edit.setEdge(col, row, side, e === "D" ? "w" : EMPTY);
    } else if (isOpening) {
      edit.setEdge(col, row, side, auto ? EMPTY : "w");
    }
    // Where there was nothing to take away, nothing changes.
  } else if (style === "door") {
    // Remember a hand-drawn wall under the door, to put it back if the door goes.
    const drawn = e === "w" || e === "D" || (isOpening && !auto) || (isSecret && e === "w" && !auto);
    edit.setEdge(col, row, side, drawn ? "D" : "d");
    edit.setSecret(col, row, side, false);
  } else if (style === "secret") {
    // Players see a secret door as the wall it's in.
    edit.setEdge(col, row, side, auto ? EMPTY : "w");
    edit.setSecret(col, row, side, true);
  } else if (edit.isWall(col, row, side) || e === "D" || (e === "d" && auto)) {
    // An opening: a gap in a wall, an archway.
    edit.setEdge(col, row, side, "o");
    edit.setSecret(col, row, side, false);
  } else if (e === "d") {
    // A door on a bare line: taking the door out leaves the bare line.
    edit.setEdge(col, row, side, EMPTY);
  }
  // Otherwise (an opening where there's no wall): nothing to open.
}

function sameStamps(a: Stamp[], b: Stamp[]): boolean {
  return a.length === b.length && a.every((s, i) => s.length === b[i].length && s.every((v, j) => v === b[i][j]));
}

/**
 * Walls around new floor: on for a blank scene, off over an uploaded map (a patch shouldn't
 * be walled in), unless the GM chose otherwise for this scene.
 */
export function wallsFor(scene: Scene, choices: Record<string, boolean>): boolean {
  return choices[scene.id] ?? !scene.mapAssetId;
}

/** The character a floor is painted with. */
export function floorChar(floor: FloorId, walls: boolean): string {
  return isWalledFloor(floor) && !walls ? floor.toUpperCase() : floor;
}

// ---------------------------------------------------------------- seasons

/** How far (in squares) outdoor ground reaches from grass, trees and bushes. */
export const EXPOSURE_REACH = 6;
/** A cell no season reaches: indoors, or too far from grass, trees and bushes. */
export const SHELTERED = 0x7f;
/** A cell's distance is kept in the low six bits of its byte, all of them set when there's none. */
const DIST = 0x3f;
const OPEN_WATER = 0x40;
const NEAR_TREE = 0x80;

/**
 * Which built cells are outdoors, for seasons. For each cell, how many squares it is from
 * grass or from a tree or bush (0 on them), or SHELTERED; packed a byte a cell and a
 * chunk at a time, the top bit saying a tree or bush is within a square (where more
 * leaves fall) and the next one that the cell is water joined to water the grass reaches.
 */
export class Exposure {
  readonly chunks = new Map<number, Uint8Array>();
  // The drawing loops go along rows, so the chunk last looked in is usually the next one.
  private lastKey = NaN;
  private last: Uint8Array | undefined;

  private byte(col: number, row: number): number {
    const k = ckey(chunkOf(col), chunkOf(row));
    if (k !== this.lastKey) {
      this.lastKey = k;
      this.last = this.chunks.get(k);
    }
    return this.last ? this.last[idx(col, row)] : DIST;
  }

  /** Squares from grass, a tree or a bush, or SHELTERED. */
  dist(col: number, row: number): number {
    const d = this.byte(col, row) & DIST;
    return d === DIST ? SHELTERED : d;
  }

  /** Whether a tree or bush is within a square. */
  nearTree(col: number, row: number): boolean {
    return (this.byte(col, row) & NEAR_TREE) !== 0;
  }

  /**
   * Whether the cell is water joined (however far away) to water the grass reaches: part
   * of a lake or river under open sky, which takes the season's colour all over.
   */
  openWater(col: number, row: number): boolean {
    return (this.byte(col, row) & OPEN_WATER) !== 0;
  }

  /** For computeExposure only (the arrays are made as needed). */
  chunkFor(col: number, row: number): Uint8Array {
    const k = ckey(chunkOf(col), chunkOf(row));
    let a = this.chunks.get(k);
    if (!a) {
      a = new Uint8Array(CHUNK_CELLS).fill(DIST);
      this.chunks.set(k, a);
      this.lastKey = NaN;
    }
    return a;
  }
}

/**
 * Works out which cells are outdoors: a search out from every grass cell and every cell
 * under a tree or bush, up to EXPOSURE_REACH squares, crossing only open edges (walls,
 * doors and secret doors stop it; secret doors are walls to everyone, so the GM and the
 * players get the same answer) into cells with a floor that isn't lava. Walled room floors
 * (s, w, d) are always indoors, whatever is next to them. Water is outdoors only when
 * the search reaches it from grass: a river in a built cave with a tree beside it stays
 * as it is. The rest of a lake or river the grass reaches is marked as open water, however
 * far from the shore. What an uploaded map under the build shows doesn't count, so every
 * screen gets the same answer, at once.
 *
 * It's worked out from what's stored, not from a stroke still being drawn: new floor gets
 * its season when it's committed.
 */
export function computeExposure(m: BuildModel): Exposure {
  const out = new Exposure();
  const draft = m.draft;
  m.draft = null;
  try {
    const grass: number[] = [];
    const trees: number[] = [];
    const near: number[] = [];
    for (const ch of m.index.chunks.values()) {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        if (ch.cells[i] === "g") grass.push(cellKey(ch.cx * CHUNK + (i % CHUNK), ch.cy * CHUNK + Math.floor(i / CHUNK)));
      }
      for (const [id, sc, sr, , size] of ch.stamps) {
        if (id !== "tree" && id !== "bush") continue;
        const ax = ch.cx * CHUNK + sc;
        const ay = ch.cy * CHUNK + sr;
        // The squares it stands on, however big it's drawn.
        const n = stampBlock(size);
        let outdoors = false;
        for (let dy = 0; dy < n; dy++) {
          for (let dx = 0; dx < n; dx++) {
            // Empty cells count: a tree on an uploaded map, with no floor under it, is outdoors.
            // Water doesn't: only grass makes water outdoors.
            const cell = m.cell(ax + dx, ay + dy);
            if (isWalledFloor(cell) || cell === "l" || cell === "a") continue;
            trees.push(cellKey(ax + dx, ay + dy));
            outdoors = true;
          }
        }
        if (outdoors) near.push(ax - 1, ay - 1, n + 2);
      }
    }
    const spread = (seeds: number[], water: boolean) => {
      const queue: number[] = [];
      for (const k of seeds) {
        const col = keyCol(k);
        const row = keyRow(k);
        out.chunkFor(col, row)[idx(col, row)] = 0;
        queue.push(k);
      }
      // Into (col, row), across the edge (ecol, erow, side), d squares out.
      const step = (col: number, row: number, ecol: number, erow: number, side: Side, d: number) => {
        const cell = m.cell(col, row);
        if (cell === EMPTY || cell === "l" || isWalledFloor(cell) || (cell === "a" && !water)) return;
        if (out.dist(col, row) <= d || m.state(ecol, erow, side) !== NONE) return;
        out.chunkFor(col, row)[idx(col, row)] = d;
        queue.push(cellKey(col, row));
      };
      for (let h = 0; h < queue.length; h++) {
        const col = keyCol(queue[h]);
        const row = keyRow(queue[h]);
        const d = out.dist(col, row);
        if (d >= EXPOSURE_REACH) continue;
        step(col, row - 1, col, row, "t", d + 1);
        step(col - 1, row, col, row, "l", d + 1);
        step(col, row + 1, col, row + 1, "t", d + 1);
        step(col + 1, row, col + 1, row, "l", d + 1);
      }
    };
    spread(grass, true);
    // Then from trees and bushes, not into water. What the grass reached nearer stays as it
    // is, and the search can stop there: whatever lies beyond it the grass reached too.
    spread(trees, false);
    // Then on from the water the grass reached, through water only and however far, the
    // same edges stopping it: a lake or river is one colour all over in a season, not
    // only near the shore. (Only water the grass reached has a distance by now.)
    const water: number[] = [];
    for (const ch of m.index.chunks.values()) {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        if (ch.cells[i] !== "a") continue;
        const col = ch.cx * CHUNK + (i % CHUNK);
        const row = ch.cy * CHUNK + Math.floor(i / CHUNK);
        if (out.dist(col, row) > EXPOSURE_REACH) continue;
        out.chunkFor(col, row)[idx(col, row)] |= OPEN_WATER;
        water.push(cellKey(col, row));
      }
    }
    const flow = (col: number, row: number, ecol: number, erow: number, side: Side) => {
      if (m.cell(col, row) !== "a" || out.openWater(col, row) || m.state(ecol, erow, side) !== NONE) return;
      out.chunkFor(col, row)[idx(col, row)] |= OPEN_WATER;
      water.push(cellKey(col, row));
    };
    for (let h = 0; h < water.length; h++) {
      const col = keyCol(water[h]);
      const row = keyRow(water[h]);
      flow(col, row - 1, col, row, "t");
      flow(col - 1, row, col, row, "l");
      flow(col, row + 1, col, row + 1, "t");
      flow(col + 1, row, col + 1, row, "l");
    }
    for (let i = 0; i < near.length; i += 3) {
      const n = near[i + 2];
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) out.chunkFor(near[i] + dx, near[i + 1] + dy)[idx(near[i] + dx, near[i + 1] + dy)] |= NEAR_TREE;
      }
    }
  } finally {
    m.draft = draft;
  }
  return out;
}

/** The ground's winter cover at a distance from grass: 0 bare, 1 frost, 2 patchy snow, 3 deep snow. */
export function winterCover(dist: number, level: SeasonLevel): 0 | 1 | 2 | 3 {
  if (dist > EXPOSURE_REACH) return 0;
  if (level === 1) return dist <= 2 ? 1 : 0;
  if (level === 2) return dist <= 2 ? 2 : dist <= 4 ? 1 : 0;
  return dist <= 4 ? 3 : dist <= 5 ? 2 : 1;
}

/**
 * The texture a built floor gets in a season (see floorVariant), or "" to leave it as it
 * is. Grass always changes. Water the grass reaches changes, and so does the rest of the
 * same lake or river, so its colour doesn't stop in a line six squares out; only ice keeps
 * near the shore, a big lake staying open (and cold) in the middle. Bare earth changes
 * near grass, thinning out over the last two squares of the reach rather than stopping in
 * a line, and the edge of the ice is broken up the same way. `hash` (0 to 1, the cell's
 * own) picks which squares there change.
 */
export function groundVariant(ch: string, dist: number, openWater: boolean, look: SeasonLook, level: SeasonLevel, hash: number): FloorVariant {
  if (ch === "g") return floorVariant("g", look, level);
  // Two squares from the end of the reach, two thirds of the squares; at the end, a third.
  const near = dist <= EXPOSURE_REACH - 2 || (dist <= EXPOSURE_REACH && hash < (EXPOSURE_REACH + 1 - dist) / 3);
  if (ch === "D") return near ? floorVariant("d", look, level) : "";
  if (ch !== "a" || !openWater) return "";
  const v = floorVariant("a", look, level);
  return v === "winter3" && !near ? floorVariant("a", "winter", 2) : v;
}

/**
 * The see-through texture over a cell in a season, if any: frost and snow on outdoor
 * paving in winter (thinning out away from the grass); fallen leaves in autumn on grass,
 * on paving within 1, 2 or 3 squares of it and, from level 2, on outdoor water, thicker
 * near trees; dust on paving in a drought; sprouts between the stones in spring.
 */
function overlayFor(ch: string, dist: number, near: boolean, look: SeasonLook, level: SeasonLevel): OverlayId | "" {
  if (dist > EXPOSURE_REACH) return "";
  const paving = ch === "S" || ch === "W" || ch === "D";
  if (look === "winter") {
    if (!paving) return "";
    const cover = winterCover(dist, level);
    return cover === 3 ? "snow2" : cover === 2 ? "snow1" : cover === 1 ? "frost" : "";
  }
  if (look === "autumn") {
    if (ch === "g" || (paving && dist <= level) || (ch === "a" && level > 1)) return near ? `leavesNear${level}` : `leaves${level}`;
    return "";
  }
  if (look === "summer") return paving && ch !== "D" && level === 3 ? "dust" : "";
  return paving && (level === 3 || (level === 2 && dist <= 3)) ? `sprouts${level === 3 ? 3 : 2}` : "";
}

// ---------------------------------------------------------------- drawing

/** The cached floor image has at most this many pixels on its long side, and per grid cell. */
const CACHE_MAX = 2560;
const CACHE_CELL_PX = 40;
/**
 * Drawn straight onto the board only while this few cells are on screen; beyond that
 * (a big map on a high-resolution screen) the cached image, a little softer, is quicker.
 */
const DIRECT_MAX_CELLS = 4000;
const WALL_COLOR = "#1d1a17";
const DOOR_COLOR = "#9a6532";
const SECRET_COLOR = "#c77dff";

/**
 * Draws an object whose block's top-left cell is (col, row): the canvas moved to the
 * block's middle, turned, and scaled to its size, for drawStamp. (A quarter turn is
 * worked out just as it always was, so objects not turned finer draw exactly as before.)
 */
function paintStamp(
  c: CanvasRenderingContext2D,
  g: { size: number; offsetX: number; offsetY: number },
  id: StampId,
  col: number,
  row: number,
  turns: number,
  size: number,
  fine: number,
  look: StampLook | null,
): void {
  const n = stampBlock(size);
  c.save();
  c.translate(g.offsetX + (col + n / 2) * g.size, g.offsetY + (row + n / 2) * g.size);
  c.rotate(fine ? (turns * Math.PI) / 2 + (fine * Math.PI) / 180 : (turns * Math.PI) / 2);
  c.scale(size * g.size, size * g.size);
  drawStamp(c, id, look, turns, fine);
  c.restore();
}

/** Draws an object where it stands, as the build draws it (the caller sets the alpha): for previews and drags. */
export function drawStampAt(c: CanvasRenderingContext2D, g: GridSettings, p: Placed, look: StampLook | null): void {
  const { stamp } = stampFor(p);
  paintStamp(c, g, p.id, p.col, p.row, stamp[3], stamp[4], stamp[5] ?? 0, look);
}

/** Where a door is drawn on its grid line, in map pixels: the part between 0.18 and 0.82 of the way along. */
export function doorSegment(g: GridSettings, d: DoorRef): { x0: number; y0: number; x1: number; y1: number } {
  const X = (col: number) => g.offsetX + col * g.size;
  const Y = (row: number) => g.offsetY + row * g.size;
  return d.side === "t"
    ? { x0: X(d.col + 0.18), y0: Y(d.row), x1: X(d.col + 0.82), y1: Y(d.row) }
    : { x0: X(d.col), y0: Y(d.row + 0.18), x1: X(d.col), y1: Y(d.row + 0.82) };
}

interface ChunkGeom {
  /** Wall lines, in cells: x0, y0, x1, y1 for each. */
  walls: number[];
  /** Doors: col, row, 0 (top edge) or 1 (left edge). */
  doors: number[];
  /** Walls that are secret doors (GM only), the same way. */
  secrets: number[];
}

export class BuildRenderer {
  readonly model = new BuildModel();
  private geoms = new Map<number, ChunkGeom>();
  private geomDirty = new Set<number>();
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = "";
  private cacheK = 1;
  private paintDirty = new Set<number>();
  private paintAll = true;
  /** Chunks the current draft has touched, to redraw when it goes. */
  private draftChunks = new Set<number>();
  /** The scene's season, if any, and its part of the cached image's key ("" with none). */
  private season: { look: SeasonLook; level: SeasonLevel } | null = null;
  private seasonSeed = 0;
  private seasonKey = "";
  /** What's outdoors (kept while the season is off too), and the index it was worked out for. */
  private exposure: Exposure | null = null;
  private exposureOf: TerrainIndex | null = null;

  /** Forgets everything (a different scene; set its season again after). */
  reset(): void {
    this.model.index = { chunks: new Map(), secrets: new Map() };
    this.model.draft = null;
    this.model.hidden = [];
    this.model.hiddenSlots = new Set();
    this.geoms.clear();
    this.geomDirty.clear();
    this.paintDirty.clear();
    this.draftChunks.clear();
    this.paintAll = true;
    this.cacheKey = "";
    // The cached image can be big; a scene without a build needn't keep it.
    this.cache = null;
    this.season = null;
    this.seasonKey = "";
    this.exposure = null;
    this.exposureOf = null;
  }

  /**
   * The season the build is drawn in (null: as built), with the scene's noise seed.
   * Returns whether anything visible changes, so the caller redraws.
   */
  setSeason(season: SceneSeason | null, seed: number): boolean {
    const key = season ? `${season.look}${season.level}|${seed}` : "";
    if (key === this.seasonKey) return false;
    this.seasonKey = key;
    this.season = season ? { look: season.look, level: season.level } : null;
    this.seasonSeed = seed;
    // The cached image's key has the season in it, so a different one paints it all again.
    // What's outdoors is kept while there's no season (it depends only on the build): when
    // the same one comes back, it's compared with what's outdoors then, and wherever the
    // build changed it in between is painted again, even if the image wasn't meanwhile.
    return !this.empty;
  }

  /**
   * How an object n squares wide with its top-left cell at (col, row) looks in the
   * season: null when there's none, the object is indoors, or it looks the same anyway.
   * (Also for the Build tool's preview of an object about to be placed.)
   */
  stampLook(id: StampId, col: number, row: number, n: number): StampLook | null {
    const s = this.season;
    const e = this.exposure;
    if (!s || !hasSeasonalArt(id, s.look)) return null;
    const plant = id === "tree" || id === "bush";
    let dist = SHELTERED;
    for (let dy = 0; dy < n; dy++) {
      for (let dx = 0; dx < n; dx++) {
        // A tree or bush makes its own squares outdoors, as computeExposure has it: so the
        // preview of one not placed yet (or being moved) looks as it will once it's there.
        const cell = plant ? this.model.storedCell(col + dx, row + dy) : "";
        if (plant && !isWalledFloor(cell) && cell !== "l" && cell !== "a") dist = 0;
        else if (e) dist = Math.min(dist, e.dist(col + dx, row + dy));
      }
    }
    if (dist > EXPOSURE_REACH) return null;
    const cover = s.look === "winter" ? winterCover(dist, s.level) : 0;
    if (!cover && id !== "tree" && id !== "bush") return null;
    return { look: s.look, level: s.level, hash: stampHash(col, row, this.seasonSeed), cover };
  }

  /** How an object standing somewhere looks in the season (see stampLook). */
  lookFor(p: Placed): StampLook | null {
    return this.stampLook(p.id, p.col, p.row, stampBlock(p.size));
  }

  /** Works out what's outdoors again if the build has changed, and repaints where that changed. */
  private updateExposure(): void {
    const index = this.model.index;
    if (this.exposure && this.exposureOf === index) return;
    const prev = this.exposure;
    const next = computeExposure(this.model);
    this.exposure = next;
    this.exposureOf = index;
    // None before: the first season since the scene was opened, so everything is painted.
    if (!prev) {
      this.paintAll = true;
      return;
    }
    for (const k of new Set([...prev.chunks.keys(), ...next.chunks.keys()])) {
      const a = prev.chunks.get(k);
      const b = next.chunks.get(k);
      if (a && b && a.every((v, i) => v === b[i])) continue;
      // Only this chunk: repainting it also redraws the three cells round it, which covers
      // every object over any of its squares, and a tree's "leaves fall here" marks are
      // kept (and compared) in the chunk of the square they mark.
      this.paintDirty.add(k);
    }
  }

  /** Takes the scene's terrain items. Returns whether anything visible changed. */
  update(items: TerrainItem[]): boolean {
    const next = indexTerrain(items);
    const prev = this.model.index;
    let changed = false;
    const keys = new Set([...prev.chunks.keys(), ...next.chunks.keys()]);
    for (const k of keys) {
      const a = prev.chunks.get(k);
      const b = next.chunks.get(k);
      if (a === b) continue;
      changed = true;
      if ((a?.cells ?? EMPTY_CELLS) !== (b?.cells ?? EMPTY_CELLS)) {
        this.cellsChanged(k);
      }
      if ((a?.edges ?? EMPTY_EDGES) !== (b?.edges ?? EMPTY_EDGES)) this.geomDirty.add(k);
      if (!sameStamps(a?.stamps ?? [], b?.stamps ?? [])) this.paintDirty.add(k);
    }
    const skeys = new Set([...prev.secrets.keys(), ...next.secrets.keys()]);
    for (const k of skeys) {
      const a = prev.secrets.get(k) ?? [];
      const b = next.secrets.get(k) ?? [];
      if (a.length === b.length && a.every((t, i) => t === b[i])) continue;
      changed = true;
      this.geomDirty.add(k);
    }
    // Objects being dragged: if their chunks changed, find them again, or stop hiding those that have gone.
    const hidden = this.model.hidden;
    if (hidden.some((r) => prev.chunks.get(ckey(r.cx, r.cy)) !== next.chunks.get(ckey(r.cx, r.cy)))) {
      this.setHidden(resolveRefs((cx, cy) => next.chunks.get(ckey(cx, cy)), hidden).refs);
    }
    // Kept when nothing changed (the scene's other items did, or the selection): what's
    // outdoors is worked out again only for a new index.
    if (changed) this.model.index = next;
    return changed;
  }

  private cellsChanged(k: number): void {
    this.paintDirty.add(k);
    this.geomDirty.add(k);
    // The walls along its right and bottom sides belong to the chunks there.
    this.geomDirty.add(k + 4096);
    this.geomDirty.add(k + 1);
  }

  beginDraft(): void {
    this.endDraft();
    this.model.draft = { cells: new Map(), walls: new Map() };
  }

  /** Paints (or with ".", erases) a cell in the draft. */
  draftCell(col: number, row: number, ch: string): void {
    const d = this.model.draft;
    if (!d || d.cells.get(cellKey(col, row)) === ch) return;
    d.cells.set(cellKey(col, row), ch);
    const k = ckey(chunkOf(col), chunkOf(row));
    this.draftChunks.add(k);
    this.cellsChanged(k);
    // Erasing clears edges that belong to the neighbours' chunks too.
    if (ch === EMPTY) {
      const right = ckey(chunkOf(col + 1), chunkOf(row));
      const below = ckey(chunkOf(col), chunkOf(row + 1));
      this.geomDirty.add(right);
      this.geomDirty.add(below);
      this.draftChunks.add(right);
      this.draftChunks.add(below);
    }
  }

  /** Clears the draft's cells (a rectangle being dragged out again). */
  clearDraftCells(): void {
    const d = this.model.draft;
    if (!d) return;
    for (const k of d.cells.keys()) {
      const c = ckey(chunkOf(keyCol(k)), chunkOf(keyRow(k)));
      this.cellsChanged(c);
    }
    d.cells.clear();
  }

  /** Takes back every wall in the draft (a corner path being redrawn). */
  clearDraftWalls(): void {
    const d = this.model.draft;
    if (!d) return;
    for (const k of d.walls.keys()) {
      const { col, row } = edgeOf(k);
      this.geomDirty.add(ckey(chunkOf(col), chunkOf(row)));
    }
    d.walls.clear();
  }

  /**
   * Stops drawing these objects where they are (while they're dragged somewhere else),
   * and draws any hidden before again; [] shows them all. Kept up to date as the build
   * changes: one that's gone is simply no longer hidden.
   */
  hideStamps(refs: StampRef[]): void {
    this.setHidden(this.model.resolve(refs).refs);
  }

  private setHidden(refs: StampRef[]): void {
    for (const r of this.model.hidden) this.paintDirty.add(ckey(r.cx, r.cy));
    this.model.hidden = refs;
    this.model.hiddenSlots = new Set(refs.map((r) => slot(r.cx, r.cy, r.i)));
    for (const r of refs) this.paintDirty.add(ckey(r.cx, r.cy));
  }

  draftWall(col: number, row: number, side: Side, mode: "add" | "remove"): void {
    const d = this.model.draft;
    if (!d) return;
    d.walls.set(edgeKey(col, row, side), mode);
    const k = ckey(chunkOf(col), chunkOf(row));
    this.draftChunks.add(k);
    this.geomDirty.add(k);
  }

  endDraft(): BuildDraft | null {
    const d = this.model.draft;
    this.model.draft = null;
    for (const k of this.draftChunks) this.cellsChanged(k);
    this.draftChunks.clear();
    return d;
  }

  private geom(k: number, cx: number, cy: number): ChunkGeom | undefined {
    if (this.geomDirty.has(k)) {
      this.geomDirty.delete(k);
      const g = this.computeGeom(cx, cy);
      if (g) this.geoms.set(k, g);
      else this.geoms.delete(k);
    }
    return this.geoms.get(k);
  }

  private computeGeom(cx: number, cy: number): ChunkGeom | null {
    const m = this.model;
    const walls: number[] = [];
    const doors: number[] = [];
    const secrets: number[] = [];
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const door = (col: number, row: number, side: 0 | 1) => {
      doors.push(col, row, side);
      // A short piece of wall each side of the door, so it sits in the wall line.
      if (side === 0) walls.push(col, row, col + 0.15, row, col + 0.85, row, col + 1, row);
      else walls.push(col, row, col, row + 0.15, col, row + 0.85, col, row + 1);
    };
    for (let j = 0; j < CHUNK; j++) {
      const row = y0 + j;
      let run = -1;
      for (let i = 0; i <= CHUNK; i++) {
        const col = x0 + i;
        const st = i < CHUNK ? m.state(col, row, "t") : NONE;
        if (st === WALL) {
          if (run < 0) run = col;
          if (m.secret(col, row, "t")) secrets.push(col, row, 0);
        } else {
          if (run >= 0) walls.push(run, row, col, row);
          run = -1;
          if (st === DOOR) door(col, row, 0);
        }
      }
    }
    for (let i = 0; i < CHUNK; i++) {
      const col = x0 + i;
      let run = -1;
      for (let j = 0; j <= CHUNK; j++) {
        const row = y0 + j;
        const st = j < CHUNK ? m.state(col, row, "l") : NONE;
        if (st === WALL) {
          if (run < 0) run = row;
          if (m.secret(col, row, "l")) secrets.push(col, row, 1);
        } else {
          if (run >= 0) walls.push(col, run, col, row);
          run = -1;
          if (st === DOOR) door(col, row, 1);
        }
      }
    }
    return walls.length || doors.length ? { walls, doors, secrets } : null;
  }

  /** Whether there's anything to draw at all. */
  get empty(): boolean {
    return !this.model.index.chunks.size && !this.model.draft;
  }

  /**
   * Draws the build onto the board. `view` is the part of the scene on screen, in map
   * pixels; `px` is device pixels per map pixel.
   */
  draw(
    c: CanvasRenderingContext2D,
    scene: Scene,
    view: { x0: number; y0: number; x1: number; y1: number },
    scale: number,
    px: number,
    gmView: boolean,
  ): void {
    if (this.empty && !this.geoms.size) return;
    const g = scene.grid;
    const size = g.size;
    const all = sceneCells(scene.width, scene.height, g);
    const c0 = Math.max(all.c0, Math.floor((view.x0 - g.offsetX) / size) - 1);
    const r0 = Math.max(all.r0, Math.floor((view.y0 - g.offsetY) / size) - 1);
    const c1 = Math.min(all.c1 + 1, Math.floor((view.x1 - g.offsetX) / size) + 1);
    const r1 = Math.min(all.r1 + 1, Math.floor((view.y1 - g.offsetY) / size) + 1);
    if (c0 > c1 || r0 > r1) return;
    // Worked out here rather than in update(): a season arrives as a scene change, which update() never sees.
    if (this.season) this.updateExposure();
    c.save();
    c.beginPath();
    c.rect(0, 0, scene.width, scene.height);
    c.clip();

    const k = Math.min(1, CACHE_MAX / Math.max(scene.width, scene.height), CACHE_CELL_PX / size);
    if (px <= k * 1.25 || (c1 - c0 + 1) * (r1 - r0 + 1) > DIRECT_MAX_CELLS) {
      this.updateCache(scene, k);
      c.imageSmoothingEnabled = true;
      c.drawImage(this.cache!, 0, 0, this.cache!.width / k, this.cache!.height / k);
    } else {
      this.drawFloors(c, scene, c0, r0, c1, r1);
      this.drawStamps(c, scene, c0, r0, c1, r1);
    }
    c.restore();
    // Walls are centred on grid lines: on the scene's edge, let their outer half show too.
    const m = Math.max(size * 0.13, 1.5 / scale) * 1.2;
    c.save();
    c.beginPath();
    c.rect(-m, -m, scene.width + 2 * m, scene.height + 2 * m);
    c.clip();
    this.drawWalls(c, scene, c0, r0, c1, r1, scale, gmView);
    c.restore();
  }

  private updateCache(scene: Scene, k: number): void {
    const g = scene.grid;
    const key = `${scene.id}|${scene.width}|${scene.height}|${g.size}|${g.offsetX}|${g.offsetY}|${k}${this.seasonKey ? `|${this.seasonKey}` : ""}`;
    const canvas = (this.cache ??= document.createElement("canvas"));
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.cacheK = k;
      canvas.width = Math.max(1, Math.ceil(scene.width * k));
      canvas.height = Math.max(1, Math.ceil(scene.height * k));
      this.paintAll = true;
    }
    const all = sceneCells(scene.width, scene.height, g);
    if (this.paintAll || this.paintDirty.size > 24) {
      this.paintRegion(scene, all.c0, all.r0, all.c1, all.r1);
    } else {
      for (const ck of this.paintDirty) {
        const cx = Math.floor(ck / 4096) - 2048;
        const cy = (ck % 4096) - 2048;
        // An object is drawn from one cell before the chunk its block's corner is in to
        // three cells past it (3 squares, turned 45 degrees: STAMP_DRAW_BEFORE and _AFTER).
        // One standing on any of the chunk's squares, whose look can depend on them, has its
        // corner up to two cells before the chunk, so it's drawn from three cells before.
        // All of those are painted whole.
        this.paintRegion(scene, cx * CHUNK - 3, cy * CHUNK - 3, cx * CHUNK + CHUNK + 2, cy * CHUNK + CHUNK + 2);
      }
    }
    this.paintAll = false;
    this.paintDirty.clear();
  }

  /** Redraws the cached image over a block of cells (inclusive). */
  private paintRegion(scene: Scene, c0: number, r0: number, c1: number, r1: number): void {
    const canvas = this.cache!;
    const ctx = canvas.getContext("2d")!;
    const g = scene.grid;
    const k = this.cacheK;
    // Whole pixels, so repainting never blends into what's already there.
    const px0 = Math.max(0, Math.floor((g.offsetX + c0 * g.size) * k));
    const py0 = Math.max(0, Math.floor((g.offsetY + r0 * g.size) * k));
    const px1 = Math.min(canvas.width, Math.ceil((g.offsetX + (c1 + 1) * g.size) * k));
    const py1 = Math.min(canvas.height, Math.ceil((g.offsetY + (r1 + 1) * g.size) * k));
    if (px1 <= px0 || py1 <= py0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(px0, py0, px1 - px0, py1 - py0);
    ctx.clip();
    ctx.clearRect(px0, py0, px1 - px0, py1 - py0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // The cells those pixels cover, which can be a little more than asked for.
    const cc0 = Math.floor((px0 / k - g.offsetX) / g.size);
    const cr0 = Math.floor((py0 / k - g.offsetY) / g.size);
    const cc1 = Math.floor((px1 / k - g.offsetX) / g.size);
    const cr1 = Math.floor((py1 / k - g.offsetY) / g.size);
    this.drawFloors(ctx, scene, cc0, cr0, cc1, cr1);
    // Objects are drawn from a cell before too: a tree's shadow falls a little past the
    // square it's drawn on, so one just above or left of these cells can reach into them
    // (the clip keeps the rest of it out). Below and right, cc1 and cr1 are already a cell on.
    this.drawStamps(ctx, scene, cc0 - 1, cr0 - 1, cc1, cr1);
    ctx.restore();
  }

  private drawFloors(c: CanvasRenderingContext2D, scene: Scene, c0: number, r0: number, c1: number, r1: number): void {
    const g = scene.grid;
    const size = g.size;
    const m = this.model;
    const s = this.season;
    const e = this.exposure;
    // One path per kind of floor (in a season, per texture): neighbouring cells of the same
    // one then show no seam. The season's overlays, the same way, go on top.
    const paths = new Map<string, Path2D>();
    const overlays = new Map<OverlayId, Path2D>();
    const add = <K>(map: Map<K, Path2D>, key: K, from: number, to: number, row: number) => {
      let p = map.get(key);
      if (!p) map.set(key, (p = new Path2D()));
      p.rect(g.offsetX + from * size, g.offsetY + row * size, (to - from) * size, size);
    };
    for (let row = r0; row <= r1; row++) {
      let runStart = c0;
      let runFloor = "";
      let overStart = c0;
      let over: OverlayId | "" = "";
      for (let col = c0; col <= c1 + 1; col++) {
        const ch = col <= c1 ? m.cell(col, row) : EMPTY;
        let floor = ch === EMPTY ? "" : ch.toLowerCase();
        if (s && e) {
          let o: OverlayId | "" = "";
          if (floor) {
            const dist = e.dist(col, row);
            // Grass is always outdoors (new grass too, before it's committed); water and bare earth when found so.
            const hash = ch === "a" || ch === "D" ? stampHash(col, row, this.seasonSeed) : 0;
            const v = groundVariant(ch, dist, e.openWater(col, row), s.look, s.level, hash);
            if (v) floor = `${floor}:${v}`;
            o = overlayFor(ch, dist, e.nearTree(col, row), s.look, s.level);
          }
          if (o !== over) {
            if (over) add(overlays, over, overStart, col, row);
            overStart = col;
            over = o;
          }
        }
        if (floor === runFloor) continue;
        if (runFloor) add(paths, runFloor, runStart, col, row);
        runStart = col;
        runFloor = floor;
      }
    }
    for (const [key, p] of paths) {
      // "g" or "g:winter2".
      c.fillStyle = floorPattern(c, key[0] as FloorId, size, g.offsetX, g.offsetY, key.slice(2) as FloorVariant);
      c.fill(p);
    }
    for (const [id, p] of overlays) {
      const pattern = overlayPattern(c, id, size, g.offsetX, g.offsetY);
      if (!pattern) continue;
      c.fillStyle = pattern;
      c.fill(p);
    }
  }

  private drawStamps(c: CanvasRenderingContext2D, scene: Scene, c0: number, r0: number, c1: number, r1: number): void {
    const g = scene.grid;
    const chunks = this.model.index.chunks;
    const draft = this.model.draft?.groundOnly ? undefined : this.model.draft?.cells;
    // An object over any square of a room being erased goes with it, so it isn't shown.
    const erased = (ax: number, ay: number, n: number) => {
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) if (draft!.get(cellKey(ax + dx, ay + dy)) === EMPTY) return true;
      return false;
    };
    const hidden = this.model.hiddenSlots;
    // Objects standing up to STAMP_DRAW_AFTER cells before the area, or STAMP_DRAW_BEFORE
    // after it, can reach into it (3 squares, turned 45 degrees).
    for (let cy = chunkOf(r0 - STAMP_DRAW_AFTER); cy <= chunkOf(r1 + STAMP_DRAW_BEFORE); cy++) {
      for (let cx = chunkOf(c0 - STAMP_DRAW_AFTER); cx <= chunkOf(c1 + STAMP_DRAW_BEFORE); cx++) {
        const ch = chunks.get(ckey(cx, cy));
        if (!ch?.stamps.length) continue;
        for (let i = 0; i < ch.stamps.length; i++) {
          const stamp = ch.stamps[i];
          const [id, sc, sr, turns, size, fine = 0] = stamp;
          if (hidden.size && hidden.has(slot(cx, cy, i))) continue;
          const ax = cx * CHUNK + sc;
          const ay = cy * CHUNK + sr;
          const n = stampBlock(size);
          // What its drawing covers (see drawnBounds): for quarter turns, its size about its block's middle.
          if (fine) {
            const b = drawnBounds(placedOf(cx, cy, stamp));
            if (b.c0 > c1 || b.r0 > r1 || b.c1 < c0 || b.r1 < r0) continue;
          } else {
            const x = ax + n / 2;
            const y = ay + n / 2;
            const h = size / 2;
            if (Math.floor(x - h) > c1 || Math.floor(y - h) > r1 || Math.ceil(x + h) - 1 < c0 || Math.ceil(y + h) - 1 < r0) continue;
          }
          if (draft?.size && erased(ax, ay, n)) continue;
          paintStamp(c, g, id, ax, ay, turns, size, fine, this.season ? this.stampLook(id, ax, ay, n) : null);
        }
      }
    }
  }

  private drawWalls(
    c: CanvasRenderingContext2D,
    scene: Scene,
    c0: number,
    r0: number,
    c1: number,
    r1: number,
    scale: number,
    gmView: boolean,
  ): void {
    const g = scene.grid;
    const size = g.size;
    const X = (col: number) => g.offsetX + col * size;
    const Y = (row: number) => g.offsetY + row * size;
    const walls = new Path2D();
    const doors: number[] = [];
    const secrets: number[] = [];
    let any = false;
    // Chunks that exist, the draft's, and the ones to their right and below (whose
    // edges border them): those are the only places walls can be.
    const keys = new Set<number>([...this.model.index.chunks.keys(), ...this.draftChunks, ...this.geoms.keys()]);
    for (const k of [...keys]) {
      keys.add(k + 4096);
      keys.add(k + 1);
    }
    for (const k of this.geomDirty) keys.add(k);
    for (const k of keys) {
      const cx = Math.floor(k / 4096) - 2048;
      const cy = (k % 4096) - 2048;
      if (cx * CHUNK > c1 + 1 || cy * CHUNK > r1 + 1 || (cx + 1) * CHUNK < c0 || (cy + 1) * CHUNK < r0) continue;
      const geo = this.geom(k, cx, cy);
      if (!geo) continue;
      const w = geo.walls;
      for (let i = 0; i < w.length; i += 4) {
        walls.moveTo(X(w[i]), Y(w[i + 1]));
        walls.lineTo(X(w[i + 2]), Y(w[i + 3]));
        any = true;
      }
      doors.push(...geo.doors);
      if (gmView) secrets.push(...geo.secrets);
    }
    if (!any && !doors.length) return;
    const lw = Math.max(size * 0.13, 1.5 / scale);
    c.lineCap = "square";
    c.lineJoin = "miter";
    // A soft shadow along the walls, then the walls.
    c.strokeStyle = "rgba(0, 0, 0, 0.2)";
    c.lineWidth = lw * 2.4;
    c.stroke(walls);
    c.strokeStyle = WALL_COLOR;
    c.lineWidth = lw;
    c.stroke(walls);

    const t = size * 0.09;
    for (let i = 0; i < doors.length; i += 3) {
      const col = doors[i];
      const row = doors[i + 1];
      c.beginPath();
      if (doors[i + 2] === 0) c.rect(X(col + 0.18), Y(row) - t, size * 0.64, t * 2);
      else c.rect(X(col) - t, Y(row + 0.18), t * 2, size * 0.64);
      c.fillStyle = DOOR_COLOR;
      c.fill();
      c.strokeStyle = WALL_COLOR;
      c.lineWidth = Math.max(size * 0.03, 1 / scale);
      c.stroke();
    }

    if (secrets.length) {
      c.font = `bold ${size * 0.3}px Inter, system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      for (let i = 0; i < secrets.length; i += 3) {
        const col = secrets[i];
        const row = secrets[i + 1];
        const top = secrets[i + 2] === 0;
        const cx = top ? X(col + 0.5) : X(col);
        const cy = top ? Y(row) : Y(row + 0.5);
        c.beginPath();
        if (top) c.rect(X(col + 0.18), Y(row) - t * 1.3, size * 0.64, t * 2.6);
        else c.rect(X(col) - t * 1.3, Y(row + 0.18), t * 2.6, size * 0.64);
        c.fillStyle = "rgba(40, 20, 60, 0.85)";
        c.fill();
        c.setLineDash([size * 0.06, size * 0.04]);
        c.strokeStyle = SECRET_COLOR;
        c.lineWidth = Math.max(size * 0.025, 1 / scale);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = SECRET_COLOR;
        c.fillText("S", cx, cy);
      }
    }
  }
}

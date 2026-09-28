// The browser side of built maps: an index of a scene's terrain chunks, the edits the
// Build tool makes to them, and the drawing of floors, objects, walls and doors.
//
// Floors and objects change rarely, so when zoomed out they're drawn once into an
// image (like the fog) and only the chunks that change are redrawn. Zoomed in past
// that image's detail they're drawn straight onto the board. Walls and doors are
// always drawn as lines, so they stay sharp.

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
  terrainId,
} from "../../shared/terrain";
import type { FloorId, Stamp, StampId } from "../../shared/terrain";
import type { ItemPatch, Scene, TerrainItem } from "../../shared/types";
import { drawStamp, floorPattern } from "./buildArt";

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
  /** An object being dragged somewhere else: not drawn where it was. */
  hiddenStamp: { cx: number; cy: number; i: number; stamp: Stamp } | null = null;

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

  /** The object drawn topmost over a cell, if any. */
  stampAt(col: number, row: number): { cx: number; cy: number; i: number; stamp: Stamp } | null {
    return stampsCovering(this.index.chunks, col, row).pop() ?? null;
  }
}

/** Objects covering a cell, in drawing order (the last is on top). */
function stampsCovering(
  chunks: Map<number, { cx: number; cy: number; stamps: Stamp[] }>,
  col: number,
  row: number,
): { cx: number; cy: number; i: number; stamp: Stamp }[] {
  const out: { cx: number; cy: number; i: number; stamp: Stamp }[] = [];
  for (let cy = chunkOf(row - 2); cy <= chunkOf(row); cy++) {
    for (let cx = chunkOf(col - 2); cx <= chunkOf(col); cx++) {
      const ch = chunks.get(ckey(cx, cy));
      if (!ch) continue;
      ch.stamps.forEach((stamp, i) => {
        const ax = cx * CHUNK + stamp[1];
        const ay = cy * CHUNK + stamp[2];
        if (col >= ax && col < ax + stamp[4] && row >= ay && row < ay + stamp[4]) out.push({ cx, cy, i, stamp });
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

  private covering(col: number, row: number): { cx: number; cy: number; i: number; stamp: Stamp }[] {
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

  /** The object on top at a cell. */
  stampAt(col: number, row: number): Stamp | null {
    return this.covering(col, row).pop()?.stamp ?? null;
  }

  /** Turns the object on top at a cell a quarter turn clockwise. */
  rotateStampAt(col: number, row: number): boolean {
    const hit = this.covering(col, row).pop();
    if (!hit) return false;
    const w = this.chunk(hit.cx * CHUNK, hit.cy * CHUNK);
    const [id, c, r, turns, size] = hit.stamp;
    w.stamps[hit.i] = [id, c, r, (turns + 1) % 4, size];
    w.stampsChanged = true;
    return true;
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

  /** Moves the object on top at a cell so its top-left cell is (toCol, toRow). */
  moveStamp(fromCol: number, fromRow: number, toCol: number, toRow: number, expect?: Stamp): boolean {
    // The object picked up, if it's still there (an undo, or another tab, may have changed things since).
    const all = this.covering(fromCol, fromRow);
    const hit = expect ? all.filter((h) => h.stamp.join() === expect.join()).pop() : all.pop();
    if (!hit) return false;
    const [id, c, r, turns, size] = hit.stamp;
    if (hit.cx * CHUNK + c === toCol && hit.cy * CHUNK + r === toRow) return false;
    const w = this.chunk(hit.cx * CHUNK, hit.cy * CHUNK);
    w.stamps.splice(hit.i, 1);
    w.stampsChanged = true;
    return this.addStamp(id, toCol, toRow, turns, size);
  }

  /** Places an object with its top-left cell at (col, row). False if that block is full. */
  addStamp(id: StampId, col: number, row: number, turns: number, size: number): boolean {
    const w = this.chunk(col, row);
    if (w.stamps.length >= MAX_STAMPS_PER_CHUNK) return false;
    w.stamps.push([id, inChunk(col), inChunk(row), turns, size]);
    w.stampsChanged = true;
    return true;
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
 */
export function buildUndo(items: ItemMap, sceneId: string, ops: ItemOps): BuildUndo {
  const after = applyOps(items, ops);
  const ids = new Set([...(ops.upsert ?? []).map((i) => i.id), ...(ops.patch ?? []).map((p) => p.id), ...(ops.delete ?? [])]);
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
  const run = (now: ItemMap, back: boolean): ItemOps => {
    const edit = new BuildEdit(now, sceneId);
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
  return a.length === b.length && a.every((s, i) => s.every((v, j) => v === b[i][j]));
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

  /** Forgets everything (a different scene). */
  reset(): void {
    this.model.index = { chunks: new Map(), secrets: new Map() };
    this.model.draft = null;
    this.model.hiddenStamp = null;
    this.geoms.clear();
    this.geomDirty.clear();
    this.paintDirty.clear();
    this.draftChunks.clear();
    this.paintAll = true;
    this.cacheKey = "";
    // The cached image can be big; a scene without a build needn't keep it.
    this.cache = null;
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
    // An object being dragged: if its chunk changed, find it again by what it is, or stop hiding it.
    const h = this.model.hiddenStamp;
    if (h) {
      const k = ckey(h.cx, h.cy);
      if (prev.chunks.get(k) !== next.chunks.get(k)) {
        const i = next.chunks.get(k)?.stamps.findIndex((s) => s.join() === h.stamp.join()) ?? -1;
        this.model.hiddenStamp = i >= 0 ? { ...h, i } : null;
        this.paintDirty.add(k);
      }
    }
    this.model.index = next;
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

  /** Stops drawing the object on top at a cell (while it's dragged somewhere else). */
  hideStampAt(col: number, row: number): boolean {
    const hit = this.model.stampAt(col, row);
    if (!hit) return false;
    this.showHiddenStamp();
    this.model.hiddenStamp = { cx: hit.cx, cy: hit.cy, i: hit.i, stamp: hit.stamp };
    this.paintDirty.add(ckey(hit.cx, hit.cy));
    return true;
  }

  showHiddenStamp(): void {
    const h = this.model.hiddenStamp;
    if (!h) return;
    this.model.hiddenStamp = null;
    this.paintDirty.add(ckey(h.cx, h.cy));
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
    const key = `${scene.id}|${scene.width}|${scene.height}|${g.size}|${g.offsetX}|${g.offsetY}|${k}`;
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
        // Objects reach up to two cells past the chunk their corner is in.
        this.paintRegion(scene, cx * CHUNK - 2, cy * CHUNK - 2, cx * CHUNK + CHUNK + 1, cy * CHUNK + CHUNK + 1);
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
    this.drawStamps(ctx, scene, cc0, cr0, cc1, cr1);
    ctx.restore();
  }

  private drawFloors(c: CanvasRenderingContext2D, scene: Scene, c0: number, r0: number, c1: number, r1: number): void {
    const g = scene.grid;
    const size = g.size;
    const m = this.model;
    // One path per kind of floor: neighbouring cells of the same floor then show no seam.
    const paths = new Map<FloorId, Path2D>();
    for (let row = r0; row <= r1; row++) {
      let runStart = c0;
      let runFloor = "";
      for (let col = c0; col <= c1 + 1; col++) {
        const ch = col <= c1 ? m.cell(col, row) : EMPTY;
        const floor = ch === EMPTY ? "" : ch.toLowerCase();
        if (floor === runFloor) continue;
        if (runFloor) {
          let p = paths.get(runFloor as FloorId);
          if (!p) paths.set(runFloor as FloorId, (p = new Path2D()));
          p.rect(g.offsetX + runStart * size, g.offsetY + row * size, (col - runStart) * size, size);
        }
        runStart = col;
        runFloor = floor;
      }
    }
    for (const [floor, p] of paths) {
      c.fillStyle = floorPattern(c, floor, size, g.offsetX, g.offsetY);
      c.fill(p);
    }
  }

  private drawStamps(c: CanvasRenderingContext2D, scene: Scene, c0: number, r0: number, c1: number, r1: number): void {
    const g = scene.grid;
    const size = g.size;
    const chunks = this.model.index.chunks;
    const draft = this.model.draft?.groundOnly ? undefined : this.model.draft?.cells;
    // An object over any square of a room being erased goes with it, so it isn't shown.
    const erased = (ax: number, ay: number, n: number) => {
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) if (draft!.get(cellKey(ax + dx, ay + dy)) === EMPTY) return true;
      return false;
    };
    for (let cy = chunkOf(r0 - 2); cy <= chunkOf(r1); cy++) {
      for (let cx = chunkOf(c0 - 2); cx <= chunkOf(c1); cx++) {
        const ch = chunks.get(ckey(cx, cy));
        if (!ch?.stamps.length) continue;
        const hidden = this.model.hiddenStamp;
        for (let i = 0; i < ch.stamps.length; i++) {
          const [id, sc, sr, turns, n] = ch.stamps[i];
          if (hidden && hidden.cx === cx && hidden.cy === cy && hidden.i === i) continue;
          const ax = cx * CHUNK + sc;
          const ay = cy * CHUNK + sr;
          if (ax > c1 || ay > r1 || ax + n - 1 < c0 || ay + n - 1 < r0) continue;
          if (draft?.size && erased(ax, ay, n)) continue;
          c.save();
          c.translate(g.offsetX + (ax + n / 2) * size, g.offsetY + (ay + n / 2) * size);
          c.rotate((turns * Math.PI) / 2);
          c.scale(n * size, n * size);
          drawStamp(c, id);
          c.restore();
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

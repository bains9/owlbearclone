// The play area: a Konva stage with one layer each for the map and grid,
// drawings, tokens, fog, and transient overlays (previews, rulers, pointers).
//
// Input is handled with native pointer events on the container rather than
// Konva's event system, so one place decides between panning, pinching,
// dragging and the active tool.

import Konva from "konva";
import {
  cellDistance,
  formatDistance,
  hexCenter,
  hexCorners,
  isHex,
  isOnGrid,
  pointToHex,
  simplify,
  snapToCellCenter,
  snapToVertex,
  snapTokenCenter,
  templateGeometry,
} from "../../shared/geometry";
import type { Point, TemplateShape } from "../../shared/geometry";
import { randomId } from "../../shared/ids";
import type { ItemMap } from "../../shared/ops";
import { canDelete } from "../../shared/permissions";
import type { Ephemeral, MeasureShape } from "../../shared/protocol";
import {
  EMPTY,
  STAMP_SIZE_STEP,
  cellAt,
  isBuildingFloor,
  isTerrainFloor,
  sceneCells,
  snapDeg,
  snapSize,
  stampBlock,
} from "../../shared/terrain";
import type { CellBounds } from "../../shared/terrain";
import type { DrawShape, DrawingItem, FogItem, Item, ItemPatch, Scene, TerrainItem, TokenItem } from "../../shared/types";
import { fileUrl } from "../api";
import {
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  rotateSelection,
  toggleHidden,
  toggleLocked,
} from "./actions";
import type { BoardApi, BuildAction, RoomClient, RoomState } from "./client";
import {
  BuildEdit,
  BuildRenderer,
  buildUndo,
  doorSegment,
  drawStampAt,
  edgeOf,
  floorChar,
  keyCol,
  keyRow,
  refOf,
  sceneTerrain,
  setPortal,
  setWall,
  wallsFor,
} from "./build";
import type { DoorHit, DoorRef, EditResult, Side, StampHit, StampRef } from "./build";
import { BUILD_TOASTS, DUPLICATE_OFFSETS, HEX_TOAST, TOUCH_HINTS, WheelSteps, isMacPlatform, wheelIntent } from "./buildInput";
import {
  CLIPBOARD_MAX,
  canResize,
  centreOf,
  clampShift,
  decodeObjects,
  encodeObjects,
  groupFits,
  placeGroupAt,
  placedOf,
  samePlaced,
  shiftGroup,
  sizeGroup,
  turnGroup,
} from "./stampGeom";
import type { Placed } from "./stampGeom";
import { getImage, imageFailed } from "./images";
import { SeasonBaker } from "./seasons";
import type { SeasonJob } from "./seasons";
import { ALGO_VERSION, seedFrom } from "./seasonPixels";
import { isDungeondraftProject, isVttFile, looksLikeMap } from "../mapImport";

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FOG_COLOR = "#0b0d11";
const SELECT_COLOR = "#4fd1ff";
/** Build tool: what a click or drag would take away. */
const REMOVE_COLOR = "#ff7b7b";
/** Build › Select: what a click would select (selected things are SELECT_COLOR), as in Dungeondraft. */
const HOVER_COLOR = "#ffd24f";
/** Moving more objects than this, only their outlines follow the pointer (the overlay redraws often). */
const GHOST_ART_MAX = 60;
/** Build › Select: how near (in screen pixels) a click must be to a door to pick it, with a mouse and with a finger. */
const DOOR_REACH_MOUSE = 8;
const DOOR_REACH_TOUCH = 16;
const MIN_SCALE = 0.03;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 5;
const EPH_INTERVAL = 40;
const TRAIL_MS = 900;
/** While the pointer is held still, it's sent again this often, so it stays on everyone's screen. */
const POINTER_HOLD_MS = 200;
/** How long a ping (a click with the pointer) pulses. */
const PING_MS = 3500;
/** The fog is drawn once into an image at most this many pixels on its long side. */
const FOG_CACHE_MAX = 2560;
/** A brush stroke is stored in pieces of at most this many points. */
const STROKE_PIECE_POINTS = 1500;

/** Shown once per page load: the hint that doors can't be dragged, and each Build mode's touch hint. */
let doorDragWarned = false;
const touchHintsShown = new Set<string>();

interface Camera {
  x: number;
  y: number;
  scale: number;
}

interface TokenNode {
  group: Konva.Group;
  item: TokenItem | null;
  selected: boolean;
  cell: number;
  dirty: boolean;
}

interface DrawingNode {
  shape: Konva.Shape;
  item: DrawingItem;
  selected: boolean;
  /**
   * Where the shape sits when not being dragged. Lines and polygons sit at 0,0 with
   * absolute points; rectangles, ellipses and text carry their own position.
   */
  base: Point;
}

interface Ruler {
  a: Point;
  b: Point;
  label: string;
  color: string;
  expires: number;
  shape: MeasureShape;
}

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; pointerId: number; start: Point; cam: Camera; moved: boolean; onClick?: () => void }
  | { kind: "pinch"; startDist: number; startMid: Point; cam: Camera }
  | {
      kind: "drag-items";
      pointerId: number;
      /** The item under the pointer: the group follows it, and snaps by it when it's a token. */
      id: string;
      /** Every token moving (from the selection), with where each started. */
      origs: Map<string, Point>;
      /** Every drawing and note moving with them. */
      drawings: string[];
      start: Point;
      startWorld: Point;
      moved: boolean;
      lastEph: number;
    }
  | { kind: "marquee"; pointerId: number; start: Point; node: Konva.Rect; additive: boolean }
  | {
      kind: "draw";
      pointerId: number;
      shape: DrawShape;
      color: string;
      fill: boolean;
      width: number;
      start: Point;
      points: number[];
      node: Konva.Shape;
    }
  | { kind: "erase"; pointerId: number; ids: Set<string>; warned: boolean }
  | { kind: "fog-rect"; pointerId: number; start: Point; end: Point; node: Konva.Rect }
  | { kind: "fog-lasso"; pointerId: number; points: number[]; node: Konva.Line }
  | { kind: "fog-paint"; pointerId: number; points: number[]; pieces: number[][]; width: number; node: Konva.Line }
  | { kind: "measure"; pointerId: number; shape: MeasureShape; start: Point; end: Point; lastEph: number }
  /** The pointer. Moved: it has been dragged, so letting go isn't a ping. */
  | { kind: "pointer"; pointerId: number; lastEph: number; start: Point; at: Point; moved: boolean }
  /** A tap-style action (fog polygon corner, note, door, object) that happens on release, if it was a tap. */
  | {
      kind: "tap";
      pointerId: number;
      start: Point;
      world: Point;
      action: "poly" | "note" | "door" | "stamp" | "wallpoint";
      /** Build tool: Alt was held (take away rather than add). */
      alt?: boolean;
      /** Build tool, with a mouse: the object under the pointer, which a drag moves. */
      grab?: StampHit;
      /** Build tool: a finger or a pen (which reaches a little further round an object). */
      touch?: boolean;
    }
  /** Build tool: painting floor with the brush (from the last point), or dragging out a rectangle or oval of it. */
  | { kind: "build-paint"; pointerId: number; last: Point; erase: boolean }
  | { kind: "build-rect"; pointerId: number; start: Cell; end: Cell; erase: boolean; circle: boolean }
  /**
   * Build tool: drawing or removing walls along grid lines, from grid corner to grid
   * corner. With a mouse, a click without a drag starts walls placed corner by corner.
   */
  | {
      kind: "build-wall";
      pointerId: number;
      vertex: { c: number; r: number };
      start: { c: number; r: number };
      moved: boolean;
      mode: "add" | "remove";
      mouse: boolean;
    }
  /**
   * Build › Select: pressed, not yet dragged. What's under the press is looked for when it
   * becomes a drag or a click, not before: while it's held, the wheel or a key can turn or
   * nudge the selection, and another tab can change the build. Changed: what's selected was
   * changed while it was held, so letting go isn't a click. Grab: the press was on something
   * selected, so a drag moves the selection even if a turn or nudge took it from under the
   * pointer meanwhile.
   */
  | {
      kind: "build-select";
      pointerId: number;
      start: Point;
      startWorld: Point;
      shift: boolean;
      mouse: boolean;
      changed?: boolean;
      grab: boolean;
    }
  /** Build › Select: dragging a box to select the objects whose middles are in it. */
  | { kind: "build-box"; pointerId: number; start: Point; end: Point; additive: boolean; node: Konva.Rect }
  /**
   * Build tool: dragging objects somewhere else, a square at a time: the selection in
   * Select, or the one under the pointer in Objects (select: false, which leaves them unselected).
   */
  | {
      kind: "build-move-sel";
      pointerId: number;
      grab: Cell;
      refs: StampRef[];
      orig: Placed[];
      shift: { dCol: number; dRow: number };
      select: boolean;
    }
  | { kind: "grid-align"; pointerId: number; start: Point; end: Point; node: Konva.Rect };

interface Cell {
  col: number;
  row: number;
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function textColorFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? "#111" : "#fff";
}

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

/** The raw 2D context behind a Konva context (for composite operations Konva doesn't wrap). */
function native(ctx: Konva.Context): CanvasRenderingContext2D {
  return (ctx as unknown as { _context: CanvasRenderingContext2D })._context;
}

/** Whether an object's middle is on the scene. (One left off it when the scene was made smaller can't be picked.) */
function onScene(p: Placed, all: CellBounds): boolean {
  const m = centreOf(p);
  return m.x >= all.c0 && m.x <= all.c1 + 1 && m.y >= all.r0 && m.y <= all.r1 + 1;
}

/** Whether a picked-out object is the one found. */
function sameRef(r: StampRef, h: StampHit): boolean {
  return r.cx === h.cx && r.cy === h.cy && r.i === h.i && r.key === h.stamp.join();
}

function sameDoor(a: DoorRef, b: DoorRef): boolean {
  return a.col === b.col && a.row === b.row && a.side === b.side;
}

/** Objects picked out, as one string: equal only for the same objects, as they are now, in the same order. */
function keysOf(refs: StampRef[]): string {
  return refs.map((r) => `${r.cx},${r.cy},${r.key}`).join(";");
}

/** Found objects in the order they're drawn: chunk rows top to bottom, each left to right, then each chunk's list. */
function inDrawingOrder(hits: StampHit[]): StampHit[] {
  return hits.slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.i - b.i);
}

/** Whether text is selected on the page (the chat, the guide), which a copy then copies. */
function pageTextSelected(): boolean {
  return !!window.getSelection()?.toString();
}

/**
 * Lets go of text selected on the page. Pressing the board doesn't (nothing on it can be
 * selected), where pressing anything else would; so a copy after it would take text selected
 * before it, not what was just picked out on the board.
 */
function dropPageTextSelection(): void {
  const s = window.getSelection();
  if (s && !s.isCollapsed) s.removeAllRanges();
}

export class Board implements BoardApi {
  private stage: Konva.Stage;
  private bgLayer = new Konva.Layer({ listening: false });
  private drawLayer = new Konva.Layer();
  private tokenLayer = new Konva.Layer();
  private fogLayer = new Konva.Layer({ listening: false });
  private uiLayer = new Konva.Layer({ listening: false });
  private bgRect = new Konva.Rect({ x: 0, y: 0, width: 1, height: 1, fill: "#2b2f36" });
  private mapNode = new Konva.Image({ x: 0, y: 0, image: undefined, visible: false });
  private gridNode: Konva.Shape;
  private fogNode: Konva.Shape;
  private trailNode: Konva.Shape;
  private previewGroup = new Konva.Group();
  /** Shows the fog brush's size under the pointer. */
  private brushCursor = new Konva.Circle({
    radius: 10,
    stroke: "#ffffff",
    strokeWidth: 1.5,
    strokeScaleEnabled: false,
    dash: [5, 4],
    visible: false,
  });
  private rulerGroup = new Konva.Group();
  /** Built maps: floors, objects, walls and doors, drawn between the map image and the grid. */
  private build = new BuildRenderer();
  private buildNode: Konva.Shape;
  /** Build tool: what the next click would do, under the mouse. */
  private buildHover: Konva.Shape;
  private hover: Point | null = null;
  /** The map picture redrawn for the scene's season (snow, autumn, blossom, drought). */
  private seasons: SeasonBaker;
  private renderedSeasonsOff = false;
  /** Alt is held: the Build tool takes away instead of adding. */
  private altDown = false;
  /** Walls being placed corner by corner with a mouse: the corners so far, and the grid lines between them. */
  private wallPath: { corners: { c: number; r: number }[]; steps: [number, number, Side][][]; mode: "add" | "remove" } | null =
    null;
  /** The last corner clicked, and when: the second click of a double-click finishes rather than adding or starting. */
  private lastWallClick: { at: number; c: number; r: number } | null = null;
  /** Build › Select: the objects and doors selected. Only this tab's: never sent. */
  private buildSel: { objects: StampRef[]; doors: DoorRef[] } = { objects: [], doors: [] };
  /** The selected objects where they stand now, in the same order (for outlines and the bars). */
  private selPlaced: Placed[] = [];
  /**
   * The last turn of the selection: the objects as they were before it, how far they've
   * been turned from there in all, and the objects it left (as keys). While the selection
   * is exactly those, the next turn starts from the same objects, so six turns of 15
   * degrees make one exact quarter turn.
   */
  private turnBase: { base: Placed[]; deg: number; keys: string } | null = null;
  /** Where sizing began, for each set of objects sizing has left (see sizeSelection). */
  private sizeBases = new Map<string, Placed[]>();
  /** Build tool: numbers bursts of turning, sizing or nudging, each of which is one undo step. */
  private burst = 0;
  /** Build › Select: what a click at the mouse would select (drawn yellow), and it as a key, to redraw only when it changes. */
  private hoverTarget: { obj: Placed | null; door: DoorRef | null } = { obj: null, door: null };
  private hoverKey = "";
  /** Build › Select: an object is under the mouse, so a drag would move it. */
  private hoverObject = false;
  /** Z is held: the mouse wheel turns objects 5 degrees at a time. */
  private zDown = false;
  /** Alt+wheel has sized the next object while Alt is held: Alt+click then places it rather than removing one. */
  private altScaled = false;
  private wheelSteps = new WheelSteps(isMacPlatform(navigator.platform ?? "", navigator.userAgent ?? ""));
  /** Objects copied in Build › Select, where they stood, in the order they're drawn. */
  private clip: Placed[] | null = null;
  /** Ctrl+V was pressed: pastes this tab's copy, unless the browser's paste event comes first. */
  private pasteArm: ReturnType<typeof setTimeout> | null = null;
  /**
   * Where the mouse is on the board while it's over it (things are pasted under it). On the
   * screen, not the map: the map can move under a still mouse (a trackpad, the + and - keys).
   */
  private pointerPos: Point | null = null;
  /** The tool, Build mode and grid the last sync saw, to notice when they change. */
  private renderedTool = "";
  private renderedMode = "";
  private renderedGrid = "";

  private tokens = new Map<string, TokenNode>();
  private drawings = new Map<string, DrawingNode>();
  private fogItems: FogItem[] = [];
  /**
   * The fog, already composited, in scene coordinates. Rebuilt only when the fog
   * changes; panning and zooming just draw this image.
   */
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogDirty = true;

  private renderedSceneId: string | null = null;
  private renderedScene: Scene | null = null;
  private renderedItems: ItemMap | null = null;
  private renderedSelection: string[] | null = null;
  private renderedGm = false;
  private renderedPreview = false;
  private itemsDirty = false;
  private needsFit = true;
  private cameras = new Map<string, Camera>();

  private gesture: Gesture = { kind: "none" };
  private pointers = new Map<number, Point>();
  private spaceDown = false;
  private syncQueued = false;
  private dragging = new Set<string>();
  private remoteDrags = new Map<string, number>();
  private localRuler: Ruler | null = null;
  private remoteRulers = new Map<string, Ruler>();
  private trails = new Map<string, { color: string; points: { x: number; y: number; t: number }[] }>();
  /** Pings, one per person: a spot marked with a click of the pointer. */
  private pings = new Map<string, { color: string; x: number; y: number; t: number }>();
  private poly: { points: number[]; node: Konva.Line; start: Konva.Circle; mode: "hide" | "reveal" } | null = null;
  private anim: Konva.Animation;
  private cleanup: (() => void)[] = [];
  private zoomReport = 0;
  /** A table display: the part of the scene the GM last pointed it at (null: all of it). */
  private followRect: [number, number, number, number] | null = null;
  /** GM: whether this tab is steering table displays, on which scene, and how many there were. */
  private steering = false;
  private steeredScene: string | null = null;
  private displayCount = 0;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private el: HTMLDivElement,
    private room: RoomClient,
  ) {
    this.stage = new Konva.Stage({ container: el, width: el.clientWidth || 1, height: el.clientHeight || 1 });

    this.gridNode = new Konva.Shape({
      listening: false,
      sceneFunc: (ctx) => this.drawGrid(native(ctx)),
    });
    this.fogNode = new Konva.Shape({
      listening: false,
      sceneFunc: (ctx) => this.drawFog(native(ctx)),
    });
    this.trailNode = new Konva.Shape({
      listening: false,
      sceneFunc: (ctx) => this.drawTrails(native(ctx)),
    });
    this.buildNode = new Konva.Shape({
      listening: false,
      sceneFunc: (ctx) => this.drawBuild(native(ctx)),
    });
    this.seasons = new SeasonBaker(() => {
      // A seasonal picture is ready: show it.
      const scene = this.renderedScene;
      if (scene) {
        this.updateMap(scene);
        this.bgLayer.batchDraw();
      }
      // And how much of the map is outdoors, for the season picker's "indoor map" note.
      const assetId = scene?.mapAssetId;
      const frac = assetId ? this.seasons.outdoor(assetId) : undefined;
      if (assetId && frac !== undefined && room.state.mapOutdoor[assetId] !== frac) {
        room.store.set((s) => ({ mapOutdoor: { ...s.mapOutdoor, [assetId]: frac } }));
      }
    }, room.display);
    this.buildHover = new Konva.Shape({
      listening: false,
      visible: false,
      sceneFunc: (ctx) => this.drawBuildHover(native(ctx)),
    });

    this.bgLayer.add(this.bgRect, this.mapNode, this.buildNode, this.gridNode);
    this.fogLayer.add(this.fogNode);
    this.uiLayer.add(this.previewGroup, this.rulerGroup, this.trailNode, this.brushCursor, this.buildHover);
    this.stage.add(this.bgLayer, this.drawLayer, this.tokenLayer, this.fogLayer, this.uiLayer);

    this.anim = new Konva.Animation(() => this.tick(), this.uiLayer);

    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, "pointerdown", this.onPointerDown);
    on(el, "pointermove", this.onPointerMove);
    on(el, "pointerup", this.onPointerUp);
    on(el, "pointercancel", this.onPointerUp);
    on(el, "pointerleave", () => {
      this.pointerPos = null;
      this.updateBrushCursor(null);
      this.setHover(null);
    });
    on(el, "wheel", this.onWheel, { passive: false });
    on(el, "contextmenu", (e) => e.preventDefault());
    on(el, "dragover", this.onDragOver);
    on(el, "drop", this.onDrop);
    on(window, "paste", this.onPaste as EventListener);
    on(window, "copy", this.onCopy as EventListener);
    on(window, "keydown", this.onKeyDown);
    on(window, "keyup", this.onKeyUp);
    on(window, "blur", () => {
      this.setAlt(false);
      this.spaceDown = false;
      this.zDown = false;
      this.updateCursor();
    });
    const onHidden = () => {
      if (document.visibilityState !== "visible") this.zDown = false;
    };
    document.addEventListener("visibilitychange", onHidden);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onHidden));
    this.cleanup.push(() => {
      if (this.pasteArm) clearTimeout(this.pasteArm);
    });

    const ro = new ResizeObserver(() => {
      this.stage.size({ width: el.clientWidth, height: el.clientHeight });
      if (this.room.display) this.applyDisplayView();
      else if (this.needsFit) this.scheduleSync();
      this.stage.batchDraw();
    });
    ro.observe(el);
    this.cleanup.push(() => ro.disconnect());
    this.cleanup.push(room.store.subscribe(this.scheduleSync));
    // Steering table displays reacts at once, not on the next frame: a tab in the
    // background gets few frames, and switching "follow my view" off must still land.
    this.cleanup.push(
      room.store.subscribe(() => {
        if (this.room.isGm) this.updateSteering(this.room.state);
      }),
    );
    this.cleanup.push(room.onEph(this.onEph));

    room.board = this;
    this.sync();
  }

  destroy(): void {
    if (this.viewTimer) clearTimeout(this.viewTimer);
    this.seasons.dispose();
    for (const fn of this.cleanup) fn();
    this.anim.stop();
    this.stage.destroy();
    if (this.room.board === this) this.room.board = null;
  }

  // ---------------------------------------------------------------- camera

  private get cam(): Camera {
    return { x: this.stage.x(), y: this.stage.y(), scale: this.stage.scaleX() };
  }

  private setCam(x: number, y: number, scale: number): void {
    const s = clampScale(scale);
    this.stage.position({ x, y });
    this.stage.scale({ x: s, y: s });
    if (this.renderedSceneId) this.cameras.set(this.renderedSceneId, { x, y, scale: s });
    if (this.steering) this.sendViewSoon();
    this.renderRulers();
    if (this.poly) this.poly.start.radius(6 / s);
    this.stage.batchDraw();
    if (!this.zoomReport) {
      this.zoomReport = requestAnimationFrame(() => {
        this.zoomReport = 0;
        this.room.store.set({ zoom: this.stage.scaleX() });
      });
    }
  }

  private toWorld(p: Point): Point {
    const c = this.cam;
    return { x: (p.x - c.x) / c.scale, y: (p.y - c.y) / c.scale };
  }

  private zoomAt(p: Point, factor: number): void {
    const c = this.cam;
    const scale = clampScale(c.scale * factor);
    const wx = (p.x - c.x) / c.scale;
    const wy = (p.y - c.y) / c.scale;
    this.setCam(p.x - wx * scale, p.y - wy * scale, scale);
  }

  fit(): void {
    const scene = this.renderedScene;
    const w = this.stage.width();
    const h = this.stage.height();
    if (!scene || w < 10 || h < 10) {
      this.needsFit = true;
      return;
    }
    // A table display uses the whole screen; otherwise keep clear of the toolbar on the left.
    const pad = this.room.display ? 0 : Math.min(40, w * 0.05);
    const left = this.room.display ? 0 : 64;
    const availW = Math.max(40, w - left - pad);
    const availH = Math.max(40, h - pad * 2);
    const scale = clampScale(Math.min(availW / scene.width, availH / scene.height));
    this.setCam(left + (availW - scene.width * scale) / 2, (h - scene.height * scale) / 2, scale);
    this.needsFit = false;
  }

  /** Fits part of the scene, [x, y, width, height], to the screen, centred. */
  private showRect(r: [number, number, number, number]): void {
    const w = this.stage.width();
    const h = this.stage.height();
    if (w < 10 || h < 10) return;
    const scale = clampScale(Math.min(w / r[2], h / r[3]));
    this.setCam(w / 2 - (r[0] + r[2] / 2) * scale, h / 2 - (r[1] + r[3] / 2) * scale, scale);
    this.needsFit = false;
  }

  /** A table display: where the GM pointed it, or the whole scene. */
  private applyDisplayView(): void {
    if (this.followRect) this.showRect(this.followRect);
    else this.fit();
  }

  /**
   * GM: tells table displays what this tab is looking at (at most every 120 ms while
   * the view moves). Only for the live scene, and only while "follow my view" is on.
   */
  private sendViewSoon(): void {
    if (this.viewTimer) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      const s = this.room.state;
      if (!this.steering || !s.activeSceneId || this.renderedSceneId !== s.activeSceneId) return;
      if (!s.players.some((p) => p.display)) return;
      const a = this.toWorld({ x: 0, y: 0 });
      const b = this.toWorld({ x: this.stage.width(), y: this.stage.height() });
      this.room.sendEph({
        k: "view",
        sceneId: s.activeSceneId,
        rect: [round2(a.x), round2(a.y), round2(b.x - a.x), round2(b.y - a.y)],
      });
    }, 120);
  }

  /** GM: starts or stops steering table displays as the settings and the viewed scene change. */
  private updateSteering(s: RoomState): void {
    const displays = s.players.filter((p) => p.display).length;
    // Not while building: the GM zooms right in to place doors, and the table shouldn't follow.
    const steering = s.displayFollow && !!s.activeSceneId && s.viewSceneId === s.activeSceneId && s.tool !== "build";
    if (steering && (!this.steering || displays > this.displayCount || this.steeredScene !== s.activeSceneId)) {
      this.steering = true;
      this.sendViewSoon();
    }
    if (!steering && this.steering && !s.displayFollow && s.activeSceneId) {
      // "Follow my view" switched off: displays go back to the whole scene. (Looking at
      // another scene just leaves them where they are.)
      this.room.sendEph({ k: "view", sceneId: s.activeSceneId, rect: null });
    }
    this.steering = steering;
    this.steeredScene = steering ? s.activeSceneId : null;
    this.displayCount = displays;
  }

  zoomBy(factor: number): void {
    this.zoomAt({ x: this.stage.width() / 2, y: this.stage.height() / 2 }, factor);
  }

  viewCenter(): Point {
    return this.toWorld({ x: this.stage.width() / 2, y: this.stage.height() / 2 });
  }

  centerOn(p: Point): void {
    const s = this.cam.scale;
    this.setCam(this.stage.width() / 2 - p.x * s, this.stage.height() / 2 - p.y * s, s);
  }

  // ---------------------------------------------------------------- rendering

  private scheduleSync = (): void => {
    if (this.syncQueued) return;
    this.syncQueued = true;
    requestAnimationFrame(() => {
      this.syncQueued = false;
      this.sync();
    });
  };

  private sync(): void {
    const s = this.room.state;
    const gm = s.me?.role === "gm";
    const sceneId = s.viewSceneId;
    const scene = sceneId ? (s.scenes[sceneId] ?? null) : null;
    let force = false;

    if (sceneId !== this.renderedSceneId) {
      this.cancelGesture();
      this.cancelPoly();
      for (const n of this.tokens.values()) n.group.destroy();
      for (const n of this.drawings.values()) n.shape.destroy();
      this.tokens.clear();
      this.drawings.clear();
      this.dragging.clear();
      this.remoteDrags.clear();
      this.remoteRulers.clear();
      this.trails.clear();
      this.pings.clear();
      this.localRuler = null;
      this.renderRulers();
      this.wallPath = null;
      this.build.reset();
      this.buildSel = { objects: [], doors: [] };
      this.selPlaced = [];
      this.turnBase = null;
      this.sizeBases.clear();
      this.publishBuildSel();
      this.newBurst();
      // The last scene's seasonal bake is no longer wanted, even when this scene's map is
      // still loading or there's no scene at all (the next one starts once it's needed).
      this.seasons.cancel();
      this.renderedSceneId = sceneId;
      this.renderedScene = null;
      this.needsFit = true;
      this.followRect = null;
      force = true;
    }

    if (scene !== this.renderedScene || s.seasonsOff !== this.renderedSeasonsOff) {
      const prev = this.renderedScene;
      this.renderedScene = scene;
      this.renderedSeasonsOff = s.seasonsOff;
      if (scene) {
        this.bgRect.size({ width: scene.width, height: scene.height });
        this.bgRect.fill(scene.background);
        this.updateMap(scene);
        if (!prev || prev.grid.size !== scene.grid.size) force = true;
      } else {
        this.seasons.cancel();
      }
      this.syncBuildSeason(s, scene);
      this.bgLayer.visible(Boolean(scene));
      this.bgLayer.batchDraw();
      this.fogDirty = true;
      this.fogLayer.batchDraw();
    }

    if (this.needsFit && scene) {
      // A table display always starts on the whole scene.
      const saved = this.room.display ? undefined : this.cameras.get(scene.id);
      if (saved) {
        this.setCam(saved.x, saved.y, saved.scale);
        this.needsFit = false;
      } else {
        this.fit();
      }
    }

    const preview = gm && s.fogOpts.preview;
    if (gm !== this.renderedGm || preview !== this.renderedPreview) {
      // The GM sees fog dimmed. That's done to the finished fog image (the canvas's CSS
      // opacity), not with Konva's opacity, which would apply to each shape and make a
      // reveal only half-remove the fog under it.
      this.fogLayer.getNativeCanvasElement().style.opacity = gm && !preview ? "0.5" : "1";
      this.fogLayer.batchDraw();
      this.renderedGm = gm;
      this.renderedPreview = preview;
      force = true;
    }

    if (force || this.itemsDirty || s.items !== this.renderedItems || s.selection !== this.renderedSelection) {
      this.itemsDirty = false;
      this.syncItems(s, scene, force, gm && !preview);
      this.renderedItems = s.items;
      this.renderedSelection = s.selection;
    }

    if (this.brushCursor.visible() && (s.tool !== "fog" || s.fogOpts.shape !== "brush")) this.updateBrushCursor(null);
    else if (this.brushCursor.visible()) this.updateBrushCursor(this.brushCursor.position());
    if (this.wallPath && !gm) this.cancelWallPath();
    else if (this.wallPath && (s.tool !== "build" || s.buildOpts.mode !== "walls")) {
      // Moving on to another mode or tool keeps the walls placed so far (one undo step).
      queueMicrotask(() => this.finishWallPath());
    }
    // A change of tool or Build mode, or of the grid under a drag, ends what Select was doing.
    const mode = s.buildOpts.mode;
    const modeChanged = s.tool !== this.renderedTool || mode !== this.renderedMode;
    const grid = scene ? `${scene.grid.type}|${scene.grid.size}|${scene.grid.offsetX}|${scene.grid.offsetY}` : "";
    const gridChanged = grid !== this.renderedGrid;
    this.renderedTool = s.tool;
    this.renderedMode = mode;
    this.renderedGrid = grid;
    if (modeChanged) this.newBurst();
    const bg = this.gesture;
    const selecting = bg.kind === "build-select" || bg.kind === "build-box" || bg.kind === "build-move-sel";
    // (A click in progress in one mode mustn't land in another: X can be pressed with the button down.)
    const buildTap = bg.kind === "tap" && (bg.action === "door" || bg.action === "stamp" || bg.action === "wallpoint");
    if (
      (s.tool !== "build" && (bg.kind === "build-paint" || bg.kind === "build-rect" || bg.kind === "build-wall" || selecting || buildTap)) ||
      ((selecting || buildTap) && (modeChanged || gridChanged))
    ) {
      this.cancelGesture();
    }
    const hex = !scene || isHex(scene.grid);
    if ((s.tool !== "build" || mode !== "select" || hex || !gm) && (this.buildSel.objects.length || this.buildSel.doors.length)) {
      this.setBuildSel([], []);
    }
    if (modeChanged && s.tool === "build" && gm && !hex && (mode === "stamps" || mode === "select")) this.touchHint(mode);
    if (s.tool !== "build") this.hover = null;
    else if (mode === "select") this.updateSelectHover();
    this.refreshOverlay(true);
    if (this.poly && (s.tool !== "fog" || s.fogOpts.shape !== "poly" || s.fogOpts.mode !== this.poly.mode)) {
      this.cancelPoly();
    }
    this.updateCursor();
  }

  private updateMap(scene: Scene): void {
    // Seasons off on this device: no seasonal picture is wanted at all, so they all go.
    if (this.room.state.seasonsOff) this.seasons.clear();
    const img = scene.mapAssetId
      ? getImage(fileUrl(this.room.roomId, scene.mapAssetId), () => {
          this.renderedScene = null;
          this.scheduleSync();
        })
      : null;
    if (img) {
      // In season: the seasonal picture once it's made (the plain map, or the last season's, until then).
      const job = this.seasonJob(scene, img);
      let shown: HTMLImageElement | HTMLCanvasElement = img;
      if (job) {
        shown = this.seasons.image(job.key, job.assetId) ?? img;
        this.seasons.request(job);
      } else {
        this.seasons.cancel();
      }
      this.mapNode.image(shown);
      this.mapNode.size({ width: scene.width, height: scene.height });
      this.mapNode.visible(true);
    } else {
      // No map, or it's still loading: nothing to bake, and an older bake shouldn't carry on.
      this.mapNode.visible(false);
      this.seasons.cancel();
    }
    // Seasonal pictures the board has moved on from can be freed now (never the one mapNode holds).
    this.seasons.release(this.mapNode.image());
  }

  /** The seasonal bake for a scene's map, or null when it has no season (or this device has seasons off). */
  private seasonJob(scene: Scene, img: HTMLImageElement): SeasonJob | null {
    const season = scene.season;
    if (!season || !scene.mapAssetId || this.room.state.seasonsOff) return null;
    const seed = season.seed ?? (seedFrom(scene.id) & 0xffff);
    const long = Math.max(scene.width, scene.height);
    // Everything (snow drifts, what counts as outdoors) is sized by the grid: keep it sane
    // when the grid is badly off.
    const square = Math.min(long / 8, Math.max(long / 160, scene.grid.size));
    const key = [scene.mapAssetId, season.look, season.level, seed, square, scene.width, scene.height, ALGO_VERSION].join("|");
    return { key, assetId: scene.mapAssetId, img, sceneW: scene.width, sceneH: scene.height, square, look: season.look, level: season.level, seed };
  }

  /** The season a scene's build is drawn in (none when this device has seasons off). */
  private syncBuildSeason(s: RoomState, scene: Scene | null): void {
    const season = scene && !s.seasonsOff ? (scene.season ?? null) : null;
    const seed = scene && season ? (season.seed ?? (seedFrom(scene.id) & 0xffff)) : 0;
    if (this.build.setSeason(season, seed)) this.bgLayer.batchDraw();
  }

  private syncItems(s: RoomState, scene: Scene | null, force: boolean, gmView: boolean): void {
    const sel = new Set(s.selection);
    const cell = scene?.grid.size ?? 70;
    const tokens: TokenItem[] = [];
    const drawings: DrawingItem[] = [];
    const fogs: FogItem[] = [];
    const terrain: TerrainItem[] = [];
    for (const item of Object.values(s.items)) {
      if (item.sceneId !== this.renderedSceneId) continue;
      if (item.kind === "token") tokens.push(item);
      else if (item.kind === "drawing") drawings.push(item);
      else if (item.kind === "fog") fogs.push(item);
      else if (item.kind === "terrain") terrain.push(item);
      else {
        // A kind this code doesn't know (from a newer version): leave it out rather than guess.
        const unknown: never = item;
        void unknown;
      }
    }
    const built = this.build.update(terrain);
    // The build changed: the objects selected (or being dragged) are found again, and any gone are dropped.
    if (built) this.resolveBuildSel();
    if (built || force) this.bgLayer.batchDraw();
    const byZ = (a: Item, b: Item) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    const seenTokens = new Set<string>();
    for (const t of tokens) {
      seenTokens.add(t.id);
      let n = this.tokens.get(t.id);
      if (!n) {
        n = { group: new Konva.Group(), item: null, selected: false, cell: 0, dirty: true };
        n.group.setAttr("itemId", t.id);
        this.tokenLayer.add(n.group);
        this.tokens.set(t.id, n);
      }
      if (this.dragging.has(t.id)) continue;
      const selected = sel.has(t.id);
      if (force || n.dirty || n.item !== t || n.selected !== selected || n.cell !== cell) {
        this.buildToken(n, t, selected, cell, gmView);
        this.remoteDrags.delete(t.id);
      }
    }
    for (const [id, n] of this.tokens) {
      if (!seenTokens.has(id)) {
        n.group.destroy();
        this.tokens.delete(id);
        this.dragging.delete(id);
      }
    }
    // Props first (underneath), then characters; each in its own stacking order.
    const layerRank = (t: TokenItem) => (t.layer === "prop" ? 0 : 1);
    tokens.sort((a, b) => layerRank(a) - layerRank(b) || byZ(a, b)).forEach((t, i) => {
      const g = this.tokens.get(t.id)!.group;
      if (!this.dragging.has(t.id) && g.zIndex() !== i) g.zIndex(i);
    });

    const seenDrawings = new Set<string>();
    for (const d of drawings) {
      seenDrawings.add(d.id);
      if (this.dragging.has(d.id)) continue;
      const n = this.drawings.get(d.id);
      const selected = sel.has(d.id);
      if (!n || force || n.item !== d || n.selected !== selected) {
        n?.shape.destroy();
        const shape = this.createDrawing(d, selected);
        if (d.hidden) {
          // GM-only: dimmed for the GM, gone in Player view (players never receive it).
          shape.opacity(0.5);
          shape.visible(gmView);
        }
        this.drawLayer.add(shape);
        this.drawings.set(d.id, { shape, item: d, selected, base: shape.position() });
        this.remoteDrags.delete(d.id);
      }
    }
    for (const [id, n] of this.drawings) {
      if (!seenDrawings.has(id)) {
        n.shape.destroy();
        this.drawings.delete(id);
        this.dragging.delete(id);
      }
    }
    drawings.sort(byZ).forEach((d, i) => {
      const shape = this.drawings.get(d.id)?.shape;
      if (shape && shape.zIndex() !== i) shape.zIndex(i);
    });

    fogs.sort(byZ);
    const fogChanged = fogs.length !== this.fogItems.length || fogs.some((f, i) => f !== this.fogItems[i]);
    this.fogItems = fogs;
    this.tokenLayer.batchDraw();
    this.drawLayer.batchDraw();
    if (fogChanged || force) {
      this.fogDirty = true;
      this.fogLayer.batchDraw();
    }
  }

  private buildToken(n: TokenNode, t: TokenItem, selected: boolean, cell: number, gmView: boolean): void {
    const g = n.group;
    g.destroyChildren();
    g.position({ x: t.x, y: t.y });
    g.opacity(t.hidden ? 0.5 : 1);
    // In "Player view" the GM sees what players do: hidden tokens aren't there.
    g.visible(!t.hidden || gmView);
    const r = (t.size * cell) / 2;
    const body = new Konva.Group({ rotation: t.rotation });
    let drawn = false;
    if (t.assetId) {
      const url = fileUrl(this.room.roomId, t.assetId);
      const img = getImage(url, () => {
        n.dirty = true;
        this.itemsDirty = true;
        this.scheduleSync();
      });
      if (img) {
        const k = Math.min((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
        const w = img.naturalWidth * k;
        const h = img.naturalHeight * k;
        body.add(new Konva.Image({ image: img, x: -w / 2, y: -h / 2, width: w, height: h }));
        drawn = true;
      } else if (!imageFailed(url)) {
        body.add(new Konva.Circle({ radius: r * 0.92, fill: t.color, opacity: 0.35 }));
        drawn = true;
      }
    }
    if (!drawn) {
      body.add(
        new Konva.Circle({
          radius: r * 0.92,
          fill: t.color,
          stroke: "rgba(255,255,255,0.92)",
          strokeWidth: Math.max(1.5, r * 0.08),
          shadowColor: "#000",
          shadowBlur: r * 0.2,
          shadowOpacity: 0.45,
        }),
      );
      const text = initials(t.label);
      if (text) {
        body.add(
          new Konva.Text({
            text,
            x: -r,
            y: -r,
            width: 2 * r,
            height: 2 * r,
            align: "center",
            verticalAlign: "middle",
            fontFamily: FONT,
            fontStyle: "bold",
            fontSize: r * (text.length > 1 ? 0.62 : 0.8),
            fill: textColorFor(t.color),
          }),
        );
      }
    }
    g.add(body);

    const gap = Math.max(2, cell * 0.05);
    const ringWidth = Math.max(2, cell * 0.04);
    t.rings.forEach((color, i) => {
      g.add(new Konva.Circle({ radius: r + gap * (i + 1), stroke: color, strokeWidth: ringWidth }));
    });
    const outer = r + gap * (t.rings.length + 1);
    if (t.hidden && gmView) {
      g.add(new Konva.Circle({ radius: outer, stroke: "#ffffff", strokeWidth: 1.5, dash: [4, 4], strokeScaleEnabled: false }));
    }
    if (selected) {
      g.add(
        new Konva.Circle({
          radius: outer + 3,
          stroke: SELECT_COLOR,
          strokeWidth: 2.5,
          dash: [7, 5],
          strokeScaleEnabled: false,
        }),
      );
    }
    if (t.label) {
      const fontSize = Math.max(10, Math.min(cell * 0.22, 32));
      const label = new Konva.Label({ y: r + gap * t.rings.length + fontSize * 0.3 });
      label.add(new Konva.Tag({ fill: "rgba(15,17,21,0.8)", cornerRadius: fontSize * 0.35 }));
      label.add(new Konva.Text({ text: t.label, fontSize, fontFamily: FONT, fill: "#fff", padding: fontSize * 0.28 }));
      label.x(-label.width() / 2);
      g.add(label);
    }
    n.item = t;
    n.selected = selected;
    n.cell = cell;
    n.dirty = false;
  }

  private createDrawing(d: DrawingItem, selected: boolean): Konva.Shape {
    if (d.shape === "text") {
      const text = new Konva.Text({
        x: d.points[0],
        y: d.points[1],
        text: d.text ?? "",
        fontSize: d.width,
        fontFamily: FONT,
        fontStyle: "bold",
        lineHeight: 1.2,
        fill: d.color,
        shadowColor: selected ? SELECT_COLOR : "#000",
        shadowBlur: Math.max(4, d.width * 0.35),
        shadowOpacity: 1,
      });
      text.setAttr("itemId", d.id);
      return text;
    }
    const base = {
      stroke: d.color,
      strokeWidth: d.width,
      lineCap: "round" as const,
      lineJoin: "round" as const,
      hitStrokeWidth: Math.max(d.width, 14),
      ...(selected ? { shadowColor: SELECT_COLOR, shadowBlur: 14, shadowOpacity: 1, shadowForStrokeEnabled: true } : {}),
    };
    const fill = d.fill ? hexToRgba(d.color, 0.35) : undefined;
    const [x0, y0, x1, y1] = d.points;
    let shape: Konva.Shape;
    switch (d.shape) {
      case "pen":
      case "line":
        shape = new Konva.Line({ points: d.points, ...base });
        break;
      case "poly":
        shape = new Konva.Line({ points: d.points, closed: true, fill, ...base });
        break;
      case "rect":
        shape = new Konva.Rect({
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          width: Math.abs(x1 - x0),
          height: Math.abs(y1 - y0),
          fill,
          ...base,
        });
        break;
      case "ellipse":
        shape = new Konva.Ellipse({
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          radiusX: Math.abs(x1 - x0) / 2,
          radiusY: Math.abs(y1 - y0) / 2,
          fill,
          ...base,
        });
        break;
    }
    shape.setAttr("itemId", d.id);
    return shape;
  }

  private resetDrawing(id: string): void {
    const n = this.drawings.get(id);
    if (n) n.shape.position(n.base);
  }

  private offsetDrawing(id: string, offset: Point): void {
    const n = this.drawings.get(id);
    if (n) n.shape.position({ x: n.base.x + offset.x, y: n.base.y + offset.y });
  }

  /**
   * Whether the point on screen is covered by fog for this viewer. Players (and the
   * GM in player view) can't see what's under fog, so they can't grab it either.
   */
  private fogged(pos: Point): boolean {
    const s = this.room.state;
    if (s.me?.role === "gm" && !s.fogOpts.preview) return false;
    const canvas = this.fogLayer.getCanvas();
    const pr = canvas.getPixelRatio();
    const x = Math.floor(pos.x * pr);
    const y = Math.floor(pos.y * pr);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
    const ctx = native(canvas.getContext());
    return ctx.getImageData(x, y, 1, 1).data[3] > 128;
  }

  private toScreen(p: Point): Point {
    const c = this.cam;
    return { x: c.x + p.x * c.scale, y: c.y + p.y * c.scale };
  }

  private drawGrid(c: CanvasRenderingContext2D): void {
    const scene = this.renderedScene;
    if (!scene || !scene.grid.show) return;
    const g = scene.grid;
    const size = g.size;
    const scale = this.stage.scaleX();
    if (size * scale < 5) return; // too dense to be useful; skip rather than draw a grey smear
    // Only the part of the grid that's on screen.
    const tl = this.toWorld({ x: 0, y: 0 });
    const br = this.toWorld({ x: this.stage.width(), y: this.stage.height() });
    const minX = Math.max(0, tl.x);
    const maxX = Math.min(scene.width, br.x);
    const minY = Math.max(0, tl.y);
    const maxY = Math.min(scene.height, br.y);
    if (minX >= maxX || minY >= maxY) return;
    if (isHex(g)) {
      if (size * scale < 10) return;
      this.drawHexGrid(c, scene, minX, minY, maxX, maxY, scale);
      return;
    }
    c.save();
    c.beginPath();
    const firstX = g.offsetX + Math.ceil((minX - g.offsetX) / size) * size;
    for (let x = firstX; x <= maxX; x += size) {
      c.moveTo(x, minY);
      c.lineTo(x, maxY);
    }
    const firstY = g.offsetY + Math.ceil((minY - g.offsetY) / size) * size;
    for (let y = firstY; y <= maxY; y += size) {
      c.moveTo(minX, y);
      c.lineTo(maxX, y);
    }
    c.strokeStyle = g.color;
    c.globalAlpha = g.opacity;
    c.lineWidth = 1 / scale;
    c.stroke();
    c.restore();
  }

  private drawBuild(c: CanvasRenderingContext2D): void {
    const scene = this.renderedScene;
    // Built maps are made of squares: on a hex grid there's nothing to draw them on.
    if (!scene || isHex(scene.grid)) return;
    const s = this.room.state;
    const scale = this.stage.scaleX();
    const tl = this.toWorld({ x: 0, y: 0 });
    const br = this.toWorld({ x: this.stage.width(), y: this.stage.height() });
    const px = scale * this.bgLayer.getCanvas().getPixelRatio();
    const gmView = s.me?.role === "gm" && !s.fogOpts.preview;
    this.build.draw(c, scene, { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y }, scale, px, gmView);
  }

  /**
   * Build tool: outlines what the next click or drag would change (red when it takes
   * something away), objects being dragged, and in Select what's selected (blue) and what
   * a click would select (yellow), as Dungeondraft does.
   */
  private drawBuildHover(c: CanvasRenderingContext2D): void {
    const p = this.hover;
    const scene = this.renderedScene;
    const s = this.room.state;
    const gesture = this.gesture;
    const moving = gesture.kind === "build-move-sel" ? gesture : null;
    if (!scene || s.tool !== "build" || isHex(scene.grid)) return;
    const g = scene.grid;
    const size = g.size;
    const scale = this.stage.scaleX();
    const o = s.buildOpts;
    // Alt after Alt+wheel has sized the next object places it, so nothing turns red.
    const alt = this.altDown && !this.altScaled;
    const X = (col: number) => g.offsetX + col * size;
    const Y = (row: number) => g.offsetY + row * size;
    const dashed = () => c.setLineDash([6 / scale, 4 / scale]);
    /** An object's outline: its size square, turned as it's drawn, round the middle of the squares it stands on. */
    const box = (q: Placed) => {
      const m = centreOf(q);
      const w = q.size * size;
      c.save();
      c.translate(X(m.x), Y(m.y));
      c.rotate((q.deg * Math.PI) / 180);
      c.strokeRect(-w / 2, -w / 2, w, w);
      c.restore();
    };
    /** An object drawn faintly where it would go (in the scene's season, as it will look there), outlined. */
    const ghost = (q: Placed, alpha: number) => {
      c.save();
      c.globalAlpha = alpha;
      drawStampAt(c, g, q, this.build.lookFor(q));
      c.restore();
      dashed();
      box(q);
    };
    const line = (e: { x0: number; y0: number; x1: number; y1: number }, color: string, alpha: number) => {
      c.save();
      c.setLineDash([]);
      c.lineCap = "round";
      c.globalAlpha = alpha;
      c.strokeStyle = color;
      c.lineWidth = Math.max(size * 0.12, 5 / scale);
      c.beginPath();
      c.moveTo(e.x0, e.y0);
      c.lineTo(e.x1, e.y1);
      c.stroke();
      c.restore();
    };
    c.save();
    // Nothing is built off the scene, so nothing is outlined there either.
    const m = Math.max(size * 0.12, 5 / scale);
    c.beginPath();
    c.rect(-m, -m, scene.width + 2 * m, scene.height + 2 * m);
    c.clip();
    c.strokeStyle = SELECT_COLOR;
    c.lineWidth = 2 / scale;
    if (o.mode === "select") {
      // What's selected (not while it's being dragged: that's drawn where it's going).
      c.setLineDash([]);
      if (!moving?.select) {
        for (const q of this.selPlaced) {
          c.lineWidth = 4 / scale;
          c.strokeStyle = "rgba(0, 0, 0, 0.45)";
          box(q);
          c.lineWidth = 2 / scale;
          c.strokeStyle = SELECT_COLOR;
          box(q);
        }
      }
      for (const d of this.buildSel.doors) line(doorSegment(g, d), SELECT_COLOR, 0.85);
      // What a click would select, under the mouse.
      const h = this.hoverTarget;
      if (p && gesture.kind === "none") {
        if (h.door) line(doorSegment(g, h.door), HOVER_COLOR, 0.6);
        if (h.obj) {
          c.strokeStyle = HOVER_COLOR;
          c.lineWidth = 2 / scale;
          dashed();
          box(h.obj);
        }
      }
    }
    if (moving) {
      // Too many to draw the objects themselves every frame: just their outlines.
      const art = moving.orig.length <= GHOST_ART_MAX;
      c.strokeStyle = SELECT_COLOR;
      c.lineWidth = 2 / scale;
      for (const q of moving.orig) {
        const at = { ...q, col: q.col + moving.shift.dCol, row: q.row + moving.shift.dRow };
        if (art) ghost(at, 0.85);
        else {
          dashed();
          box(at);
        }
      }
    } else if (!p || gesture.kind !== "none" || o.mode === "select") {
      // Nothing under the mouse to show.
    } else if (o.mode === "building" || o.mode === "terrain") {
      const n = o.shape[o.mode] === "brush" ? this.brushCells() : 1;
      const at = this.brushAt(p, n);
      const all = sceneCells(scene.width, scene.height, g);
      if (at.col <= all.c1 && at.row <= all.r1 && at.col + n - 1 >= all.c0 && at.row + n - 1 >= all.r0) {
        dashed();
        c.strokeStyle = alt || o.floor[o.mode] === "erase" ? REMOVE_COLOR : SELECT_COLOR;
        c.strokeRect(X(at.col), Y(at.row), n * size, n * size);
      }
    } else if (o.mode === "walls") {
      const path = this.wallPath;
      if (path) {
        // The wall the next click adds, from the last corner, and the corners so far.
        const last = path.corners[path.corners.length - 1];
        const next = this.nextCorner(p);
        const color = path.mode === "remove" ? REMOVE_COLOR : SELECT_COLOR;
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineCap = "round";
        c.lineWidth = Math.max(size * 0.08, 3 / scale);
        c.setLineDash([size * 0.2, size * 0.15]);
        c.beginPath();
        c.moveTo(X(last.c), Y(last.r));
        c.lineTo(X(next.c), Y(next.r));
        c.stroke();
        c.setLineDash([]);
        for (const v of path.corners) {
          c.beginPath();
          c.arc(X(v.c), Y(v.r), Math.max(size * 0.1, 4 / scale), 0, Math.PI * 2);
          c.fill();
        }
      } else {
        // The corner a click (or a drag) starts from.
        const v = this.nearestVertex(p);
        const all = sceneCells(scene.width, scene.height, g);
        if (v.c >= all.c0 && v.c <= all.c1 + 1 && v.r >= all.r0 && v.r <= all.r1 + 1) {
          c.fillStyle = alt || o.wallMode === "remove" ? REMOVE_COLOR : SELECT_COLOR;
          c.beginPath();
          c.arc(X(v.c), Y(v.r), Math.max(size * 0.12, 5 / scale), 0, Math.PI * 2);
          c.fill();
        }
      }
    } else if (o.mode === "doors") {
      const e = this.nearestWallEdge(p);
      if (this.edgeOnScene(e.col, e.row, e.side)) {
        const color = alt ? "#e7e9ee" : o.doorStyle === "open" ? REMOVE_COLOR : o.doorStyle === "secret" ? "#c77dff" : "#d9a066";
        const x0 = X(e.col);
        const y0 = Y(e.row);
        line({ x0, y0, x1: e.side === "t" ? X(e.col + 1) : x0, y1: e.side === "t" ? y0 : Y(e.row + 1) }, color, 0.75);
      }
    } else {
      const { u, v } = this.cellsAt(p);
      const hit = this.build.model.stampAtPoint(u, v, 0);
      const under = hit ? placedOf(hit.cx, hit.cy, hit.stamp) : null;
      if (alt || o.stampMode === "remove") {
        // What a click takes away.
        if (under) {
          c.strokeStyle = REMOVE_COLOR;
          dashed();
          box(under);
        }
      } else {
        // A click always places the next object here; a drag from an object moves that one.
        ghost({ id: o.stamp, ...this.stampAnchor(p, stampBlock(o.stampSize)), deg: o.stampDeg, size: o.stampSize }, 0.6);
        if (under) {
          c.globalAlpha = 0.5;
          dashed();
          box(under);
          c.globalAlpha = 1;
        }
      }
    }
    c.restore();
  }

  /** Alt held: the Build tool takes away instead (shown red under the pointer). */
  private setAlt(down: boolean): void {
    if (!down) this.altScaled = false;
    if (down === this.altDown) return;
    this.altDown = down;
    if (this.buildHover.visible()) this.uiLayer.batchDraw();
  }

  /** The mouse is over the map at `world` (null: it's gone): the Build tool shows what a click there would do. */
  private setHover(world: Point | null): void {
    const s = this.room.state;
    const build = s.tool === "build" && this.isGm;
    this.hover = world && build ? world : null;
    // In Select the outlines only change when what's under the mouse does.
    const redraw = build && s.buildOpts.mode === "select" ? this.updateSelectHover() : true;
    this.refreshOverlay(redraw);
  }

  /**
   * Shows the Build tool's overlay while there's something for it to show (the mouse over
   * the map, a selection, objects being dragged), and redraws it if asked.
   */
  private refreshOverlay(redraw: boolean): void {
    const s = this.room.state;
    const scene = this.renderedScene;
    const show =
      s.tool === "build" &&
      this.isGm &&
      !!scene &&
      !isHex(scene.grid) &&
      (!!this.hover || this.buildSel.objects.length > 0 || this.buildSel.doors.length > 0 || this.gesture.kind === "build-move-sel");
    if (show === this.buildHover.visible()) {
      if (show && redraw) this.uiLayer.batchDraw();
      return;
    }
    this.buildHover.visible(show);
    this.uiLayer.batchDraw();
  }

  /** A point on the map in cells, fractional: what the Build tool's hit-tests take. */
  private cellsAt(p: Point): { u: number; v: number } {
    const g = this.renderedScene!.grid;
    return { u: (p.x - g.offsetX) / g.size, v: (p.y - g.offsetY) / g.size };
  }

  /**
   * Build › Select: what's under a point, as a click there goes by: a door (drawn on top of
   * objects, so it comes first), or the objects whose drawing is there, the top one first.
   * A finger reaches a little further than a mouse. Nothing off the scene is found.
   */
  private selectHit(world: Point, mouse: boolean): { obj: StampHit | null; door: DoorHit | null; under: StampHit[] } {
    const scene = this.renderedScene!;
    const none = { obj: null, door: null, under: [] };
    if (world.x < 0 || world.y < 0 || world.x > scene.width || world.y > scene.height) return none;
    const { u, v } = this.cellsAt(world);
    // Screen pixels to a square.
    const px = this.cam.scale * scene.grid.size;
    const reach = Math.min(0.3, Math.max(0.08, (mouse ? DOOR_REACH_MOUSE : DOOR_REACH_TOUCH) / px));
    const door = this.build.model.doorAt(u, v, reach);
    if (door) return { ...none, door };
    const pad = mouse ? 0 : Math.min(0.5, 12 / px);
    const all = this.sceneBounds(scene);
    const under = this.build.model.stampsAtPoint(u, v, pad).filter((h) => onScene(placedOf(h.cx, h.cy, h.stamp), all));
    return { obj: under[0] ?? null, door: null, under };
  }

  /**
   * Of the objects under a click, the one it selects: the top one, or, when the one
   * selected is already among them, the next one down (click again to reach one underneath).
   */
  private clickTarget(under: StampHit[]): StampHit {
    const { objects, doors } = this.buildSel;
    if (objects.length === 1 && !doors.length) {
      const k = under.findIndex((h) => sameRef(objects[0], h));
      if (k >= 0) return under[(k + 1) % under.length];
    }
    return under[0];
  }

  /**
   * Build › Select: works out what a click at the mouse would select, if it isn't selected
   * already (drawn yellow), and whether an object is under it (the cursor then shows a
   * drag would move it). Returns whether what's drawn changed.
   */
  private updateSelectHover(): boolean {
    const p = this.hover;
    let obj: Placed | null = null;
    let door: DoorRef | null = null;
    let key = "";
    let over = false;
    if (p && this.gesture.kind === "none" && this.renderedScene && !isHex(this.renderedScene.grid)) {
      const hit = this.selectHit(p, true);
      if (hit.door) {
        const d = { col: hit.door.col, row: hit.door.row, side: hit.door.side };
        if (!this.buildSel.doors.some((x) => sameDoor(x, d))) {
          door = d;
          key = `d${d.col},${d.row},${d.side}`;
        }
      } else if (hit.under.length) {
        over = true;
        const t = this.clickTarget(hit.under);
        if (!this.buildSel.objects.some((r) => sameRef(r, t))) {
          obj = placedOf(t.cx, t.cy, t.stamp);
          key = `o${t.cx},${t.cy},${t.i},${t.stamp.join()}`;
        }
      }
    }
    if (over !== this.hoverObject) {
      this.hoverObject = over;
      this.updateCursor();
    }
    if (key === this.hoverKey) return false;
    this.hoverKey = key;
    this.hoverTarget = { obj, door };
    return true;
  }

  private drawHexGrid(
    c: CanvasRenderingContext2D,
    scene: Scene,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
  ): void {
    const g = scene.grid;
    // The hexes whose centres could touch the visible rectangle: take the axial
    // range of its four corners, with a margin of one hex.
    const corners = [
      pointToHex({ x: minX, y: minY }, g),
      pointToHex({ x: maxX, y: minY }, g),
      pointToHex({ x: minX, y: maxY }, g),
      pointToHex({ x: maxX, y: maxY }, g),
    ];
    const qMin = Math.min(...corners.map((h) => h.q)) - 1;
    const qMax = Math.max(...corners.map((h) => h.q)) + 1;
    const rMin = Math.min(...corners.map((h) => h.r)) - 1;
    const rMax = Math.max(...corners.map((h) => h.r)) + 1;
    const reach = g.size;
    c.save();
    c.beginPath();
    c.rect(0, 0, scene.width, scene.height);
    c.clip();
    c.beginPath();
    for (let r = rMin; r <= rMax; r++) {
      for (let q = qMin; q <= qMax; q++) {
        const center = hexCenter({ q, r }, g);
        if (center.x < minX - reach || center.x > maxX + reach || center.y < minY - reach || center.y > maxY + reach) continue;
        const p = hexCorners(center, g);
        c.moveTo(p[0], p[1]);
        for (let i = 2; i < 12; i += 2) c.lineTo(p[i], p[i + 1]);
        c.closePath();
      }
    }
    c.strokeStyle = g.color;
    c.globalAlpha = g.opacity;
    c.lineWidth = 1 / scale;
    c.stroke();
    c.restore();
  }

  private drawFog(c: CanvasRenderingContext2D): void {
    const scene = this.renderedScene;
    if (!scene) return;
    if (this.fogDirty || !this.fogCanvas) this.renderFogImage(scene);
    c.save();
    c.globalAlpha = 1;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.fogCanvas!, 0, 0, scene.width, scene.height);
    c.restore();
  }

  /** Composites every fog shape into the cached fog image. */
  private renderFogImage(scene: Scene): void {
    const k = Math.min(1, FOG_CACHE_MAX / Math.max(scene.width, scene.height));
    const canvas = (this.fogCanvas ??= document.createElement("canvas"));
    const w = Math.max(1, Math.ceil(scene.width * k));
    const h = Math.max(1, Math.ceil(scene.height * k));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext("2d")!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, w, h);
    c.setTransform(k, 0, 0, k, 0, 0);
    this.fogDirty = false;
    c.save();
    c.fillStyle = FOG_COLOR;
    if (scene.fogCover) c.fillRect(0, 0, scene.width, scene.height);
    for (const f of this.fogItems) {
      c.globalCompositeOperation = f.mode === "reveal" ? "destination-out" : "source-over";
      c.beginPath();
      const p = f.points;
      if (f.shape === "stroke") {
        c.moveTo(p[0], p[1]);
        for (let i = 2; i + 1 < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
        c.lineWidth = f.width ?? 1;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.strokeStyle = FOG_COLOR;
        c.stroke();
        continue;
      }
      if (f.shape === "rect") {
        c.rect(Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1]));
      } else {
        c.moveTo(p[0], p[1]);
        for (let i = 2; i + 1 < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
        c.closePath();
      }
      c.fill();
    }
    c.restore();
  }

  private drawTrails(c: CanvasRenderingContext2D): void {
    const now = performance.now();
    // Twice the size on a table display, so it can be seen across the table.
    const k = (this.room.display ? 2 : 1) / this.stage.scaleX();
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    for (const trail of this.trails.values()) {
      const pts = trail.points;
      if (!pts.length) continue;
      c.strokeStyle = trail.color;
      c.fillStyle = trail.color;
      c.lineWidth = 6 * k;
      for (let i = 1; i < pts.length; i++) {
        const age = now - pts[i].t;
        c.globalAlpha = Math.max(0, 1 - age / TRAIL_MS);
        c.beginPath();
        c.moveTo(pts[i - 1].x, pts[i - 1].y);
        c.lineTo(pts[i].x, pts[i].y);
        c.stroke();
      }
      const head = pts[pts.length - 1];
      c.globalAlpha = Math.max(0, 1 - (now - head.t) / TRAIL_MS);
      c.beginPath();
      c.arc(head.x, head.y, 8 * k, 0, Math.PI * 2);
      c.fill();
      // A dark edge, so it shows on light maps and snow too.
      c.strokeStyle = "rgba(0, 0, 0, 0.55)";
      c.lineWidth = 2 * k;
      c.stroke();
    }
    // Pings: rings that keep spreading out from the spot, then fade.
    for (const p of this.pings.values()) {
      const age = now - p.t;
      const fade = Math.min(1, Math.max(0, (PING_MS - age) / 600));
      for (let i = 0; i < 3; i++) {
        const phase = (age / 1000 + i / 3) % 1;
        const r = (12 + 44 * phase) * k;
        c.globalAlpha = (1 - phase) * fade;
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.strokeStyle = "rgba(0, 0, 0, 0.6)";
        c.lineWidth = 7 * k;
        c.stroke();
        c.strokeStyle = p.color;
        c.lineWidth = 4 * k;
        c.stroke();
      }
      c.globalAlpha = fade;
      c.beginPath();
      c.arc(p.x, p.y, 7 * k, 0, Math.PI * 2);
      c.fillStyle = p.color;
      c.fill();
      c.strokeStyle = "rgba(0, 0, 0, 0.6)";
      c.lineWidth = 2 * k;
      c.stroke();
    }
    c.restore();
  }

  private addPing(key: string, color: string, p: Point): void {
    this.pings.set(key, { color, x: p.x, y: p.y, t: performance.now() });
    this.startAnim();
  }

  private tick(): void {
    const now = performance.now();
    let active = false;
    // Held still, the pointer is sent again now and then, so it doesn't fade away while held.
    const g = this.gesture;
    const scene = this.renderedScene;
    if (g.kind === "pointer" && scene) {
      active = true;
      if (now - g.lastEph >= POINTER_HOLD_MS) {
        g.lastEph = now;
        this.addTrail("me", this.room.state.me?.color ?? "#fff", g.at);
        this.room.sendEph({ k: "pointer", sceneId: scene.id, x: round2(g.at.x), y: round2(g.at.y) });
      }
    }
    for (const [id, trail] of this.trails) {
      trail.points = trail.points.filter((p) => now - p.t < TRAIL_MS);
      if (trail.points.length) active = true;
      else this.trails.delete(id);
    }
    for (const [id, p] of this.pings) {
      if (now - p.t < PING_MS) active = true;
      else this.pings.delete(id);
    }
    const wall = Date.now();
    let rulersChanged = false;
    for (const [id, r] of this.remoteRulers) {
      if (r.expires < wall) {
        this.remoteRulers.delete(id);
        rulersChanged = true;
      } else {
        active = true;
      }
    }
    if (rulersChanged) this.renderRulers();
    for (const [id, expires] of this.remoteDrags) {
      if (expires < wall) {
        // The other person's drag never finished (they disconnected?); put it back where it's stored.
        this.remoteDrags.delete(id);
        const n = this.tokens.get(id);
        if (n) n.dirty = true;
        this.resetDrawing(id);
        this.itemsDirty = true;
        this.scheduleSync();
      } else {
        active = true;
      }
    }
    if (!active) this.anim.stop();
  }

  private startAnim(): void {
    if (!this.anim.isRunning()) this.anim.start();
  }

  private renderRulers(): void {
    this.rulerGroup.destroyChildren();
    const scale = this.stage.scaleX();
    const all = [...this.remoteRulers.values()];
    if (this.localRuler) all.push(this.localRuler);
    for (const r of all) this.rulerGroup.add(this.rulerNode(r, scale));
    this.uiLayer.batchDraw();
  }

  private rulerNode(r: Ruler, scale: number): Konva.Group {
    const k = 1 / scale;
    const g = new Konva.Group();
    const grid = this.renderedScene?.grid;
    if (r.shape !== "ruler" && grid) {
      const t = templateGeometry(r.shape, r.a, r.b, grid);
      const area = {
        stroke: r.color,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        fill: hexToRgba(r.color, 0.22),
        shadowColor: "#000",
        shadowBlur: 4,
        shadowOpacity: 0.5,
      };
      if (t.circle) g.add(new Konva.Circle({ x: t.circle.x, y: t.circle.y, radius: t.circle.r, ...area }));
      else if (t.polygon) g.add(new Konva.Line({ points: t.polygon, closed: true, ...area }));
      g.add(new Konva.Circle({ x: r.a.x, y: r.a.y, radius: 4 * k, fill: r.color }));
      const tag = new Konva.Label({ x: r.b.x, y: r.b.y - 10 * k, scaleX: k, scaleY: k });
      tag.add(new Konva.Tag({ fill: "rgba(15,17,21,0.9)", cornerRadius: 6, pointerDirection: "down", pointerWidth: 12, pointerHeight: 7, stroke: r.color, strokeWidth: 1.5 }));
      tag.add(new Konva.Text({ text: r.label, fontSize: 15, fontStyle: "bold", fontFamily: FONT, fill: "#fff", padding: 7 }));
      g.add(tag);
      return g;
    }
    g.add(
      new Konva.Line({
        points: [r.a.x, r.a.y, r.b.x, r.b.y],
        stroke: r.color,
        strokeWidth: 3,
        strokeScaleEnabled: false,
        dash: [10 * k, 6 * k],
        lineCap: "round",
        shadowColor: "#000",
        shadowBlur: 4,
        shadowOpacity: 0.6,
      }),
    );
    g.add(new Konva.Circle({ x: r.a.x, y: r.a.y, radius: 5 * k, fill: r.color }));
    g.add(new Konva.Circle({ x: r.b.x, y: r.b.y, radius: 5 * k, fill: r.color }));
    const label = new Konva.Label({ x: r.b.x, y: r.b.y - 10 * k, scaleX: k, scaleY: k });
    label.add(
      new Konva.Tag({
        fill: "rgba(15,17,21,0.9)",
        cornerRadius: 6,
        pointerDirection: "down",
        pointerWidth: 12,
        pointerHeight: 7,
        stroke: r.color,
        strokeWidth: 1.5,
      }),
    );
    label.add(new Konva.Text({ text: r.label, fontSize: 15, fontStyle: "bold", fontFamily: FONT, fill: "#fff", padding: 7 }));
    g.add(label);
    return g;
  }

  private colorOf(connId: string): string {
    const s = this.room.state;
    if (s.me?.connId === connId) return s.me.color;
    return s.players.find((p) => p.connId === connId)?.color ?? "#ffffff";
  }

  private addTrail(key: string, color: string, p: Point): void {
    let trail = this.trails.get(key);
    if (!trail) {
      trail = { color, points: [] };
      this.trails.set(key, trail);
    }
    trail.color = color;
    trail.points.push({ x: p.x, y: p.y, t: performance.now() });
    if (trail.points.length > 120) trail.points.shift();
    this.startAnim();
  }

  private onEph = (from: string, e: Ephemeral): void => {
    if (e.sceneId !== this.renderedSceneId) return;
    if (e.k === "view") {
      if (!this.room.display) return;
      this.followRect = e.rect;
      this.applyDisplayView();
      return;
    }
    if (e.k === "pointer") {
      if (e.ping) this.addPing(from, this.colorOf(from), e);
      else this.addTrail(from, this.colorOf(from), e);
      return;
    }
    if (e.k === "ruler") {
      if (!e.points) this.remoteRulers.delete(from);
      else {
        this.remoteRulers.set(from, {
          a: { x: e.points[0], y: e.points[1] },
          b: { x: e.points[2], y: e.points[3] },
          label: e.label ?? "",
          shape: e.shape ?? "ruler",
          color: this.colorOf(from),
          expires: Date.now() + 8000,
        });
        this.startAnim();
      }
      this.renderRulers();
      return;
    }
    if (e.k === "drag") {
      const items = this.room.state.items;
      for (const m of e.moves) {
        if (this.dragging.has(m.id)) continue;
        const item = items[m.id];
        if (!item) continue;
        if (item.kind === "token") this.tokens.get(m.id)?.group.position({ x: m.x, y: m.y });
        else if (item.kind === "drawing") this.offsetDrawing(m.id, m);
        this.remoteDrags.set(m.id, Date.now() + 3000);
      }
      this.tokenLayer.batchDraw();
      this.drawLayer.batchDraw();
      this.startAnim();
    }
  };

  // ---------------------------------------------------------------- input

  private localPos(e: { clientX: number; clientY: number }): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private itemAt(pos: Point, layer?: Konva.Layer): Item | null {
    const shape = layer ? layer.getIntersection(pos) : this.stage.getIntersection(pos);
    let node: Konva.Node | null = shape;
    while (node && !node.getAttr("itemId")) node = node.getParent();
    const id = node?.getAttr("itemId") as string | undefined;
    return id ? (this.room.state.items[id] ?? null) : null;
  }

  private get isGm(): boolean {
    return this.room.isGm;
  }

  private onPointerDown = (e: PointerEvent): void => {
    dropPageTextSelection();
    if (!this.renderedScene || !this.room.state.me) return;
    const pos = this.localPos(e);
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // not capturable (synthetic event); moves still arrive while over the board
    }
    this.pointers.set(e.pointerId, pos);
    if (this.pointers.size === 2) {
      this.cancelGesture();
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    // A table display can be panned and zoomed, and nothing else.
    if (this.room.display) {
      this.startPan(e.pointerId, pos);
      return;
    }
    // Turning objects with the wheel, keys or bar buttons is one undo step until something else happens.
    this.newBurst();

    if (e.pointerType === "mouse" && (e.button === 1 || e.button === 2)) {
      const st = this.room.state;
      if (e.button === 2 && st.tool === "fog" && this.poly && this.isGm) {
        // As with walls: a right-click finishes the polygon.
        this.startPan(e.pointerId, pos, () => this.finishPoly());
        return;
      }
      const mode = st.buildOpts.mode;
      if (e.button === 2 && st.tool === "build" && this.isGm && (this.wallPath || mode === "stamps" || mode === "select")) {
        // As in Dungeondraft: a right-click turns the object (or finishes the walls). A right-drag still pans.
        const world = this.toWorld(pos);
        this.startPan(e.pointerId, pos, () => this.buildRightClick(world));
        return;
      }
      // (In the Build tool a right-click never selects a token: the selection bar would hide its controls.)
      const hit = e.button === 2 && st.tool !== "build" && !this.fogged(pos) ? this.itemAt(pos) : null;
      this.startPan(e.pointerId, pos, hit ? () => this.room.select([hit.id]) : undefined);
      return;
    }
    if (e.button !== 0) return;
    if (this.spaceDown) {
      this.startPan(e.pointerId, pos);
      return;
    }
    const world = this.toWorld(pos);
    const s = this.room.state;
    const scene = this.renderedScene;
    if (s.gridAlign && this.isGm) {
      const node = new Konva.Rect({
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        stroke: SELECT_COLOR,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        fill: "rgba(79, 209, 255, 0.12)",
      });
      this.previewGroup.add(node);
      this.gesture = { kind: "grid-align", pointerId: e.pointerId, start: world, end: world, node };
      return;
    }
    switch (s.tool) {
      case "select":
        this.selectDown(e.pointerId, pos, world, e.shiftKey);
        return;
      case "draw":
        this.drawDown(e.pointerId, world);
        return;
      case "erase":
        this.gesture = { kind: "erase", pointerId: e.pointerId, ids: new Set(), warned: false };
        this.eraseAt(this.gesture, pos);
        return;
      case "fog":
        if (!this.isGm) return;
        this.fogDown(e.pointerId, world);
        return;
      case "build":
        if (!this.isGm) return;
        this.buildDown(e.pointerId, pos, world, e);
        return;
      case "measure": {
        const shape = s.measureOpts.shape;
        // Rulers run centre to centre; spell templates start on a grid intersection.
        const start = !scene.grid.snap
          ? world
          : shape === "ruler"
            ? snapToCellCenter(world, scene.grid)
            : snapToVertex(world, scene.grid);
        this.gesture = { kind: "measure", pointerId: e.pointerId, shape, start, end: start, lastEph: 0 };
        this.setLocalRuler(start, start, shape);
        return;
      }
      case "pointer":
        this.gesture = { kind: "pointer", pointerId: e.pointerId, lastEph: performance.now(), start: pos, at: world, moved: false };
        this.addTrail("me", s.me!.color, world);
        this.room.sendEph({ k: "pointer", sceneId: scene.id, x: round2(world.x), y: round2(world.y) });
        return;
    }
  };

  private startPan(pointerId: number, pos: Point, onClick?: () => void): void {
    this.gesture = { kind: "pan", pointerId, start: pos, cam: this.cam, moved: false, onClick };
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.gesture = {
      kind: "pinch",
      startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam: this.cam,
    };
  }

  private toggleSelected(id: string): void {
    const sel = this.room.state.selection;
    this.room.select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  }

  private selectDown(pointerId: number, pos: Point, world: Point, shift: boolean): void {
    const hit = this.fogged(pos) ? null : this.itemAt(pos);
    const s = this.room.state;
    if (hit && shift && hit.kind !== "fog") {
      this.toggleSelected(hit.id);
      return;
    }
    // Drawings move only once selected, so a big shape doesn't hijack every attempt to pan.
    if (hit?.kind === "token" || (hit?.kind === "drawing" && s.selection.includes(hit.id))) {
      // Grabbing something that's part of the selection moves the whole selection:
      // tokens, drawings and notes together.
      const group = s.selection.includes(hit.id) ? s.selection : [hit.id];
      if (!s.selection.includes(hit.id)) this.room.select([hit.id]);
      const origs = new Map<string, Point>();
      const drawings: string[] = [];
      for (const id of group) {
        const item = s.items[id];
        if (!item || !this.room.canMoveItem(item)) continue;
        if (item.kind === "token") origs.set(id, { x: item.x, y: item.y });
        else if (item.kind === "drawing" && this.drawings.has(id)) drawings.push(id);
      }
      if (origs.has(hit.id) || drawings.includes(hit.id)) {
        this.gesture = {
          kind: "drag-items",
          pointerId,
          id: hit.id,
          origs,
          drawings,
          start: pos,
          startWorld: world,
          moved: false,
          lastEph: 0,
        };
      } else {
        this.startPan(pointerId, pos, hit.kind === "drawing" ? () => this.room.select([hit.id]) : undefined);
      }
      return;
    }
    if (!hit && shift) {
      const node = new Konva.Rect({
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        stroke: SELECT_COLOR,
        strokeWidth: 1.5,
        strokeScaleEnabled: false,
        dash: [6, 4],
        fill: "rgba(79, 209, 255, 0.08)",
      });
      this.previewGroup.add(node);
      this.gesture = { kind: "marquee", pointerId, start: world, node, additive: s.selection.length > 0 };
      return;
    }
    if (hit?.kind === "drawing") {
      this.startPan(pointerId, pos, () => this.room.select([hit.id]));
      return;
    }
    this.startPan(pointerId, pos, () => this.room.select([]));
  }

  private drawDown(pointerId: number, world: Point): void {
    const s = this.room.state;
    if (!this.isGm && !s.room?.settings.playersCanDraw) {
      this.room.toast("The GM has turned drawing off.", "error");
      return;
    }
    const o = s.drawOpts;
    if (o.shape === "text") {
      this.gesture = { kind: "tap", pointerId, start: this.toScreen(world), world, action: "note" };
      return;
    }
    const width = o.width / this.cam.scale;
    const filled = o.fill && (o.shape === "rect" || o.shape === "ellipse");
    const style = {
      stroke: o.color,
      strokeWidth: width,
      lineCap: "round" as const,
      lineJoin: "round" as const,
      fill: filled ? hexToRgba(o.color, 0.35) : undefined,
    };
    let node: Konva.Shape;
    if (o.shape === "rect") node = new Konva.Rect({ x: world.x, y: world.y, width: 0, height: 0, ...style });
    else if (o.shape === "ellipse") node = new Konva.Ellipse({ x: world.x, y: world.y, radiusX: 0, radiusY: 0, ...style });
    else node = new Konva.Line({ points: [world.x, world.y, world.x, world.y], ...style, fill: undefined });
    this.previewGroup.add(node);
    this.uiLayer.batchDraw();
    this.gesture = {
      kind: "draw",
      pointerId,
      shape: o.shape,
      color: o.color,
      fill: filled,
      width,
      start: world,
      points: [world.x, world.y],
      node,
    };
  }

  private drawMove(g: Extract<Gesture, { kind: "draw" }>, world: Point): void {
    const scale = this.cam.scale;
    if (g.shape === "pen") {
      const n = g.points.length;
      if (Math.hypot(world.x - g.points[n - 2], world.y - g.points[n - 1]) * scale >= 1.5) {
        g.points.push(world.x, world.y);
        (g.node as Konva.Line).points(g.points.length === 2 ? [...g.points, ...g.points] : g.points);
      }
    } else {
      g.points = [g.start.x, g.start.y, world.x, world.y];
      if (g.shape === "line") {
        (g.node as Konva.Line).points(g.points);
      } else if (g.shape === "rect") {
        g.node.setAttrs({
          x: Math.min(g.start.x, world.x),
          y: Math.min(g.start.y, world.y),
          width: Math.abs(world.x - g.start.x),
          height: Math.abs(world.y - g.start.y),
        });
      } else {
        g.node.setAttrs({
          x: (g.start.x + world.x) / 2,
          y: (g.start.y + world.y) / 2,
          radiusX: Math.abs(world.x - g.start.x) / 2,
          radiusY: Math.abs(world.y - g.start.y) / 2,
        });
      }
    }
    this.uiLayer.batchDraw();
  }

  private drawUp(g: Extract<Gesture, { kind: "draw" }>): void {
    g.node.destroy();
    this.uiLayer.batchDraw();
    const s = this.room.state;
    const scene = this.renderedScene;
    if (!scene || !s.me) return;
    const scale = this.cam.scale;
    let points = g.points;
    if (g.shape === "pen") {
      points = points.length === 2 ? [points[0], points[1], points[0] + 0.01, points[1]] : simplify(points, 0.7 / scale);
      if (points.length < 4) points = [points[0], points[1], points[0] + 0.01, points[1]];
    } else {
      if (points.length < 4) return;
      if (Math.hypot(points[2] - points[0], points[3] - points[1]) * scale < 3) return;
    }
    const item: DrawingItem = {
      id: randomId(12),
      sceneId: scene.id,
      kind: "drawing",
      z: this.room.nextZ(scene.id, "drawing"),
      owner: s.me.userId,
      shape: g.shape,
      points: points.map(round2),
      color: g.color,
      width: round2(Math.max(0.5, g.width)),
      fill: g.fill,
    };
    this.room.change({ upsert: [item] });
  }

  private eraseAt(g: Extract<Gesture, { kind: "erase" }>, pos: Point): void {
    const me = this.room.state.me;
    if (!me) return;
    // Sample a small cross so thin lines are easy to hit on a touch screen.
    const r = 6;
    for (const p of [pos, { x: pos.x + r, y: pos.y }, { x: pos.x - r, y: pos.y }, { x: pos.x, y: pos.y + r }, { x: pos.x, y: pos.y - r }]) {
      if (this.fogged(p)) continue;
      // Tokens sit above drawings, so a token under the eraser is what gets erased there.
      const token = this.itemAt(p, this.tokenLayer);
      if (token?.kind === "token") {
        if (g.ids.has(token.id)) continue;
        if (token.locked) {
          // Locked means "leave this alone": the eraser doesn't take locked tokens.
          if (!g.warned && canDelete(token, me)) {
            g.warned = true;
            this.room.toast("Locked tokens aren't erased. Unlock one first (select it, then the lock button or L).");
          }
          continue;
        }
        if (!canDelete(token, me)) continue;
        g.ids.add(token.id);
        this.tokens.get(token.id)?.group.hide();
        this.tokenLayer.batchDraw();
        continue;
      }
      const item = this.itemAt(p, this.drawLayer);
      if (!item || item.kind !== "drawing" || g.ids.has(item.id) || !canDelete(item, me)) continue;
      g.ids.add(item.id);
      this.drawings.get(item.id)?.shape.hide();
      this.drawLayer.batchDraw();
    }
  }

  private fogDown(pointerId: number, world: Point): void {
    const scene = this.renderedScene!;
    const o = this.room.state.fogOpts;
    const color = o.mode === "reveal" ? "#7cffb2" : "#ffb27c";
    if (o.shape === "poly") {
      this.gesture = { kind: "tap", pointerId, start: this.toScreen(world), world, action: "poly" };
      return;
    }
    if (o.shape === "rect") {
      const start = o.snap ? snapToVertex(world, scene.grid) : world;
      const node = new Konva.Rect({
        x: start.x,
        y: start.y,
        width: 0,
        height: 0,
        fill: hexToRgba(color, 0.18),
        stroke: color,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        dash: [6, 4],
      });
      this.previewGroup.add(node);
      this.gesture = { kind: "fog-rect", pointerId, start, end: start, node };
      return;
    }
    if (o.shape === "brush") {
      const width = round2(Math.max(1, o.brush * scene.grid.size));
      const node = new Konva.Line({
        points: [world.x, world.y, world.x + 0.01, world.y],
        stroke: hexToRgba(color, 0.4),
        strokeWidth: width,
        lineCap: "round",
        lineJoin: "round",
      });
      this.previewGroup.add(node);
      this.uiLayer.batchDraw();
      this.gesture = { kind: "fog-paint", pointerId, points: [world.x, world.y], pieces: [], width, node };
      return;
    }
    const node = new Konva.Line({
      points: [world.x, world.y],
      closed: true,
      fill: hexToRgba(color, 0.18),
      stroke: color,
      strokeWidth: 2,
      strokeScaleEnabled: false,
    });
    this.previewGroup.add(node);
    this.gesture = { kind: "fog-lasso", pointerId, points: [world.x, world.y], node };
  }

  // ---------------------------------------------------------------- building

  /** Which kind of floor the brush and shapes paint: a building's, or terrain. */
  private paintMode(): "building" | "terrain" {
    return this.room.state.buildOpts.mode === "terrain" ? "terrain" : "building";
  }

  private buildDown(pointerId: number, pos: Point, world: Point, e: PointerEvent): void {
    const scene = this.renderedScene!;
    if (isHex(scene.grid)) {
      this.room.toast(HEX_TOAST, "error");
      return;
    }
    const o = this.room.state.buildOpts;
    // Alt reverses what the tool does, as in Dungeondraft: cut out, erase, take away.
    const alt = e.altKey;
    switch (o.mode) {
      case "building":
      case "terrain": {
        const shape = o.shape[o.mode];
        this.build.beginDraft();
        // Erasing terrain takes only the ground, never the walls, doors or objects beside it.
        if (o.mode === "terrain") this.build.model.draft!.groundOnly = true;
        if (shape === "brush") {
          this.gesture = { kind: "build-paint", pointerId, last: world, erase: alt };
          this.paintBrush(world, world, alt);
        } else {
          const cell = cellAt(world.x, world.y, scene.grid);
          const circle = shape === "circle";
          this.gesture = { kind: "build-rect", pointerId, start: cell, end: cell, erase: alt, circle };
          this.paintArea(cell, cell, alt, circle);
        }
        this.setHover(null);
        this.bgLayer.batchDraw();
        return;
      }
      case "walls": {
        if (this.wallPath) {
          // Placing corners: a click adds one, and a drag moves the map.
          this.gesture = { kind: "tap", pointerId, start: pos, world, action: "wallpoint" };
          return;
        }
        const v0 = this.nearestVertex(world);
        const last = this.lastWallClick;
        if (e.pointerType === "mouse" && last && performance.now() - last.at < 500 && last.c === v0.c && last.r === v0.r) {
          // The second click of the double-click that just finished the walls: nothing more.
          return;
        }
        this.build.beginDraft();
        const v = this.nearestVertex(world);
        const mode = alt ? "remove" : o.wallMode;
        this.gesture = { kind: "build-wall", pointerId, vertex: v, start: v, moved: false, mode, mouse: e.pointerType === "mouse" };
        this.setHover(null);
        return;
      }
      case "doors":
        this.gesture = { kind: "tap", pointerId, start: pos, world, action: "door", alt };
        return;
      case "stamps": {
        // With a mouse, dragging an object moves it, as Dungeondraft's Object tool does
        // (otherwise a drag moves the map). A click always places a new one.
        const mouse = e.pointerType === "mouse";
        const { u, v } = this.cellsAt(world);
        const grab = mouse && !alt && o.stampMode === "place" ? (this.build.model.stampAtPoint(u, v, 0) ?? undefined) : undefined;
        this.gesture = { kind: "tap", pointerId, start: pos, world, action: "stamp", alt, grab, touch: !mouse };
        return;
      }
      case "select": {
        const mouse = e.pointerType === "mouse";
        const under = this.selectHit(world, mouse).under;
        this.gesture = {
          kind: "build-select",
          pointerId,
          start: pos,
          startWorld: world,
          shift: mouse && e.shiftKey,
          mouse,
          grab: under.some((h) => this.buildSel.objects.some((r) => sameRef(r, h))),
        };
        this.setHover(this.hover);
        return;
      }
    }
  }

  /** The Build tool's brush size, in squares. */
  private brushCells(): number {
    return Math.max(1, Math.min(5, Math.round(this.room.state.buildOpts.brush)));
  }

  /** The top-left cell of an n x n brush centred on a point (on a cell for odd n, a grid corner for even). */
  private brushAt(p: Point, n: number): Cell {
    const g = this.renderedScene!.grid;
    const u = (p.x - g.offsetX) / g.size;
    const v = (p.y - g.offsetY) / g.size;
    return n % 2
      ? { col: Math.floor(u) - (n - 1) / 2, row: Math.floor(v) - (n - 1) / 2 }
      : { col: Math.round(u) - n / 2, row: Math.round(v) - n / 2 };
  }

  /** Where an n x n object goes when placed at a point: centred on it, and inside the scene. */
  private stampAnchor(p: Point, n: number): Cell {
    const scene = this.renderedScene!;
    const g = scene.grid;
    const all = sceneCells(scene.width, scene.height, g);
    const col = Math.round((p.x - g.offsetX) / g.size - n / 2);
    const row = Math.round((p.y - g.offsetY) / g.size - n / 2);
    return {
      col: Math.max(all.c0, Math.min(all.c1 - n + 1, col)),
      row: Math.max(all.r0, Math.min(all.r1 - n + 1, row)),
    };
  }

  /** The cells a scene covers: objects are kept within them. */
  private sceneBounds(scene: Scene): CellBounds {
    return sceneCells(scene.width, scene.height, scene.grid);
  }

  /** What the brush and shapes paint in the current mode: a floor, or "." to erase. */
  private paintChar(erase: boolean): string {
    const o = this.room.state.buildOpts;
    const mode = this.paintMode();
    const floor = o.floor[mode];
    if (erase || floor === "erase") return EMPTY;
    return mode === "terrain" ? floor : floorChar(floor, wallsFor(this.renderedScene!, o.walls));
  }

  /**
   * Whether a stroke may change a cell. Terrain goes under buildings, as in Dungeondraft,
   * so it never paints over a room's floor; erasing takes only what the mode paints.
   */
  private mayPaint(col: number, row: number, ch: string): boolean {
    const cur = this.build.model.storedCell(col, row);
    if (this.paintMode() === "terrain") return ch === EMPTY ? isTerrainFloor(cur) : !isBuildingFloor(cur);
    return ch === EMPTY ? isBuildingFloor(cur) : true;
  }

  /** Paints the brush all along a line, so a fast drag leaves no gaps. */
  private paintBrush(from: Point, to: Point, erase: boolean): void {
    const scene = this.renderedScene!;
    const g = scene.grid;
    const all = sceneCells(scene.width, scene.height, g);
    const ch = this.paintChar(erase);
    const n = this.brushCells();
    const steps = Math.max(1, Math.ceil((Math.hypot(to.x - from.x, to.y - from.y) / g.size) * 2));
    for (let i = 0; i <= steps; i++) {
      const at = this.brushAt({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }, n);
      for (let dr = 0; dr < n; dr++) {
        for (let dc = 0; dc < n; dc++) {
          const col = at.col + dc;
          const row = at.row + dr;
          if (col < all.c0 || col > all.c1 || row < all.r0 || row > all.r1) continue;
          if (this.mayPaint(col, row, ch)) this.build.draftCell(col, row, ch);
        }
      }
    }
  }

  /** A rectangle from one cell to another, or the oval inside it. */
  private paintArea(a: Cell, b: Cell, erase: boolean, circle: boolean): void {
    const scene = this.renderedScene!;
    const all = sceneCells(scene.width, scene.height, scene.grid);
    const ch = this.paintChar(erase);
    this.build.clearDraftCells();
    const c0 = Math.min(a.col, b.col);
    const c1 = Math.max(a.col, b.col);
    const r0 = Math.min(a.row, b.row);
    const r1 = Math.max(a.row, b.row);
    // The oval's centre and radii, in cells: a square's worth of cells whose centres are inside it.
    const cx = (c0 + c1 + 1) / 2;
    const cy = (r0 + r1 + 1) / 2;
    const rx = (c1 - c0 + 1) / 2;
    const ry = (r1 - r0 + 1) / 2;
    for (let row = Math.max(all.r0, r0); row <= Math.min(all.r1, r1); row++) {
      for (let col = Math.max(all.c0, c0); col <= Math.min(all.c1, c1); col++) {
        if (circle) {
          const dx = (col + 0.5 - cx) / rx;
          const dy = (row + 0.5 - cy) / ry;
          if (dx * dx + dy * dy > 1) continue;
        }
        if (this.mayPaint(col, row, ch)) this.build.draftCell(col, row, ch);
      }
    }
  }

  private nearestVertex(p: Point): { c: number; r: number } {
    const g = this.renderedScene!.grid;
    return { c: Math.round((p.x - g.offsetX) / g.size), r: Math.round((p.y - g.offsetY) / g.size) };
  }

  /** The grid line segment (a cell's top or left edge) nearest a point. */
  private nearestEdge(p: Point): { col: number; row: number; side: Side } {
    const g = this.renderedScene!.grid;
    const u = (p.x - g.offsetX) / g.size;
    const v = (p.y - g.offsetY) / g.size;
    return Math.abs(v - Math.round(v)) <= Math.abs(u - Math.round(u))
      ? { col: Math.floor(u), row: Math.round(v), side: "t" }
      : { col: Math.round(u), row: Math.floor(v), side: "l" };
  }

  /**
   * The grid line a Doors click means: of the nearest across and the nearest down, the
   * one with a wall or door on it (within half a square), so a door lands in the wall
   * (Dungeondraft's portals snap to walls). Otherwise simply the nearest line.
   */
  private nearestWallEdge(p: Point): { col: number; row: number; side: Side } {
    const g = this.renderedScene!.grid;
    const u = (p.x - g.offsetX) / g.size;
    const v = (p.y - g.offsetY) / g.size;
    const across = { col: Math.floor(u), row: Math.round(v), side: "t" as Side, d: Math.abs(v - Math.round(v)) };
    const down = { col: Math.round(u), row: Math.floor(v), side: "l" as Side, d: Math.abs(u - Math.round(u)) };
    const m = this.build.model;
    const walled = (e: typeof across) => m.state(e.col, e.row, e.side) !== 0 || m.edge(e.col, e.row, e.side) === "o";
    const a = walled(across);
    const b = walled(down);
    // The line with a wall wins only when it's about as near as the bare one: across a
    // one-square corridor, the bare line between its walls is still easy to pick.
    const nearest = across.d <= down.d ? across : down;
    const wall = a !== b ? (a ? across : down) : null;
    const bare = wall === across ? down : across;
    const pick = wall && wall.d <= bare.d + 0.2 ? wall : nearest;
    return { col: pick.col, row: pick.row, side: pick.side };
  }

  /** Whether an edge is on the scene: inside it, or along its border. */
  private edgeOnScene(col: number, row: number, side: Side): boolean {
    const scene = this.renderedScene!;
    const all = sceneCells(scene.width, scene.height, scene.grid);
    return side === "t"
      ? col >= all.c0 && col <= all.c1 && row >= all.r0 && row <= all.r1 + 1
      : row >= all.r0 && row <= all.r1 && col >= all.c0 && col <= all.c1 + 1;
  }

  /** The grid lines from one corner to another in a straight line, as walls to draw. */
  private edgesBetween(from: { c: number; r: number }, to: { c: number; r: number }): [number, number, Side][] {
    const out: [number, number, Side][] = [];
    let { c, r } = from;
    for (let guard = 0; guard < 10_000 && (c !== to.c || r !== to.r); guard++) {
      const dx = to.c - c;
      const dy = to.r - r;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const s = Math.sign(dx);
        const col = s > 0 ? c : c - 1;
        if (this.edgeOnScene(col, r, "t")) out.push([col, r, "t"]);
        c += s;
      } else {
        const s = Math.sign(dy);
        const row = s > 0 ? r : r - 1;
        if (this.edgeOnScene(c, row, "l")) out.push([c, row, "l"]);
        r += s;
      }
    }
    return out;
  }

  /** Follows the pointer from grid corner to grid corner, marking each grid line passed. */
  private wallMove(g: Extract<Gesture, { kind: "build-wall" }>, world: Point): void {
    const target = this.nearestVertex(world);
    if (target.c === g.vertex.c && target.r === g.vertex.r) return;
    for (const [col, row, side] of this.edgesBetween(g.vertex, target)) this.build.draftWall(col, row, side, g.mode);
    g.vertex = target;
    g.moved = true;
    this.bgLayer.batchDraw();
  }

  /** Starts walls drawn corner by corner with a mouse, as with Dungeondraft's Wall tool. */
  private startWallPath(v: { c: number; r: number }, mode: "add" | "remove"): void {
    this.wallPath = { corners: [v], steps: [], mode };
    this.uiLayer.batchDraw();
  }

  /** The corner the next click adds: straight across or down from the last one. */
  private nextCorner(world: Point): { c: number; r: number } {
    const path = this.wallPath!;
    const last = path.corners[path.corners.length - 1];
    const v = this.nearestVertex(world);
    return Math.abs(v.c - last.c) >= Math.abs(v.r - last.r) ? { c: v.c, r: last.r } : { c: last.c, r: v.r };
  }

  private wallPointClick(world: Point): void {
    const path = this.wallPath;
    if (!path) return;
    const raw = this.nearestVertex(world);
    const prev = this.lastWallClick;
    this.lastWallClick = { at: performance.now(), c: raw.c, r: raw.r };
    if (prev && this.lastWallClick.at - prev.at < 500 && prev.c === raw.c && prev.r === raw.r && path.steps.length) {
      // A double-click: its first click placed the corner, the second finishes.
      this.finishWallPath();
      return;
    }
    const last = path.corners[path.corners.length - 1];
    const next = this.nextCorner(world);
    if (next.c === last.c && next.r === last.r) {
      // The last corner again (a double-click): done.
      this.finishWallPath();
      return;
    }
    const steps = this.edgesBetween(last, next);
    for (const [col, row, side] of steps) this.build.draftWall(col, row, side, path.mode);
    path.steps.push(steps);
    path.corners.push(next);
    const first = path.corners[0];
    if (path.corners.length > 2 && next.c === first.c && next.r === first.r) {
      // Back at the first corner: the loop is closed.
      this.finishWallPath();
      return;
    }
    this.bgLayer.batchDraw();
    this.uiLayer.batchDraw();
  }

  /** Double-click, right-click or Enter: the walls placed so far become one change (one undo). */
  private finishWallPath(): void {
    if (!this.wallPath) return;
    this.wallPath = null;
    this.commitBuild();
    this.uiLayer.batchDraw();
  }

  private cancelWallPath(): void {
    if (!this.wallPath) return;
    this.wallPath = null;
    this.build.endDraft();
    this.bgLayer.batchDraw();
    this.uiLayer.batchDraw();
  }

  /** Backspace while placing corners: takes the last one back. */
  private undoWallCorner(): void {
    const path = this.wallPath;
    if (!path) return;
    if (!path.steps.length) {
      this.cancelWallPath();
      return;
    }
    path.steps.pop();
    path.corners.pop();
    this.build.clearDraftWalls();
    for (const steps of path.steps) for (const [col, row, side] of steps) this.build.draftWall(col, row, side, path.mode);
    this.bgLayer.batchDraw();
    this.uiLayer.batchDraw();
  }

  /**
   * Sends a build change, and shows the result at once (with no frame of the old build in
   * between). With a burst's key (see newBurst), it folds into the undo step before it
   * when that's from the same burst; without one it's a step of its own, and ends the burst.
   */
  private applyBuild(edit: BuildEdit, coalesce?: string): void {
    const scene = this.renderedScene;
    if (!scene) return;
    const before = this.room.state.items;
    const ops = edit.ops();
    this.room.changeWith(ops, scene.id, buildUndo(before, scene.id, ops, edit.pairs()), coalesce);
    this.build.update(sceneTerrain(this.room.state.items, scene.id));
    this.build.endDraft();
    this.bgLayer.batchDraw();
    if (coalesce === undefined) this.newBurst();
  }

  /** Ends a burst of turning, sizing or nudging: the next such step is an undo step of its own. */
  private newBurst(): void {
    this.burst++;
  }

  private burstKey(): string {
    return `b${this.burst}`;
  }

  /** Turns the draft (painted floor, drawn walls) into a change, applied to the build as it is now. */
  private commitBuild(): void {
    const scene = this.renderedScene;
    const d = this.build.model.draft;
    if (!scene || !d) {
      this.build.endDraft();
      this.bgLayer.batchDraw();
      return;
    }
    const edit = new BuildEdit(this.room.state.items, scene.id);
    for (const [k, ch] of d.cells) {
      if (ch === EMPTY && !d.groundOnly) edit.erase(keyCol(k), keyRow(k));
      else edit.setCell(keyCol(k), keyRow(k), ch);
    }
    for (const [k, mode] of d.walls) {
      const { col, row, side } = edgeOf(k);
      setWall(edit, col, row, side, mode);
    }
    this.applyBuild(edit);
  }

  /** Doors: a click on a wall makes the chosen style there; with Alt, the plain wall again. */
  private doorTap(world: Point, alt: boolean): void {
    const scene = this.renderedScene;
    if (!scene) return;
    const { col, row, side } = this.nearestWallEdge(world);
    if (!this.edgeOnScene(col, row, side)) return;
    const edit = new BuildEdit(this.room.state.items, scene.id);
    setPortal(edit, col, row, side, alt ? "wall" : this.room.state.buildOpts.doorStyle);
    this.applyBuild(edit);
  }

  /**
   * Objects: a click places the next object, even on top of another (a chair at a table);
   * with Alt (or Remove), it takes away the object drawn on top there.
   */
  private stampTap(world: Point, alt: boolean, touch: boolean): void {
    const scene = this.renderedScene;
    if (!scene) return;
    const o = this.room.state.buildOpts;
    const edit = new BuildEdit(this.room.state.items, scene.id);
    if ((alt && !this.altScaled) || o.stampMode === "remove") {
      const { u, v } = this.cellsAt(world);
      const pad = touch ? Math.min(0.5, 12 / (this.cam.scale * scene.grid.size)) : 0;
      const hit = this.build.model.stampAtPoint(u, v, pad);
      if (!hit || !edit.removeRefs([refOf(hit)])) return;
      this.applyBuild(edit);
      return;
    }
    const r = edit.addPlaced({ id: o.stamp, ...this.stampAnchor(world, stampBlock(o.stampSize)), deg: o.stampDeg, size: o.stampSize });
    if (!r.ok) {
      this.room.toast(r.reason === "same" ? BUILD_TOASTS.samePlace : BUILD_TOASTS.full, "error");
      return;
    }
    this.applyBuild(edit);
  }

  /**
   * Right-click while building: turns the next object a quarter turn, or in Select the
   * selection (or the object under the pointer, which is then selected); or finishes walls.
   */
  private buildRightClick(world: Point): void {
    const scene = this.renderedScene;
    if (!scene) return;
    if (this.wallPath) {
      this.finishWallPath();
      return;
    }
    const o = this.room.state.buildOpts;
    if (o.mode === "stamps") {
      this.room.store.set({ buildOpts: { ...o, stampDeg: snapDeg(o.stampDeg + 90) } });
      return;
    }
    if (o.mode !== "select" || isHex(scene.grid)) return;
    const hit = this.selectHit(world, true);
    const selected = hit.under.some((h) => this.buildSel.objects.some((r) => sameRef(r, h)));
    if (hit.obj && !selected) this.setBuildSel([refOf(hit.obj)], []);
    else if (!this.buildSel.objects.length) return;
    // A step of its own (a right-click is a pointer down, which starts a new burst anyway).
    this.turnSelection(90);
  }

  // ---------------------------------------------------------------- Build › Select

  /** Selects these objects and doors (as they're found now), and shows it. */
  private setBuildSel(objects: StampRef[], doors: DoorRef[]): void {
    // Changed while a press in Select is held (the wheel turned it, say): letting go isn't a click.
    const g = this.gesture;
    if (g.kind === "build-select") g.changed = true;
    const r = this.build.model.resolve(objects);
    this.buildSel = { objects: r.refs, doors };
    this.selPlaced = r.hits.map((h) => placedOf(h.cx, h.cy, h.stamp));
    this.publishBuildSel();
    this.showSelection();
  }

  /** Redraws the selection, and what a click at the mouse would select now. */
  private showSelection(): void {
    const s = this.room.state;
    if (s.tool === "build" && s.buildOpts.mode === "select") this.updateSelectHover();
    this.refreshOverlay(true);
  }

  /** Tells the bars what's selected (only when that changes, so a sync doesn't lead to another). */
  private publishBuildSel(): void {
    const cur = this.room.state.buildSel;
    const next = {
      objects: this.buildSel.objects.length,
      doors: this.buildSel.doors.length,
      canGrow: canResize(this.selPlaced, 1),
      canShrink: canResize(this.selPlaced, -1),
    };
    if (next.objects !== cur.objects || next.doors !== cur.doors || next.canGrow !== cur.canGrow || next.canShrink !== cur.canShrink) {
      this.room.store.set({ buildSel: next });
    }
  }

  /**
   * The build has changed (another tab, an undo): finds the selected objects and doors
   * again, dropping any that have gone, and the same for objects being dragged (if none
   * are left, the drag just stops).
   */
  private resolveBuildSel(): void {
    const g = this.gesture;
    const m = this.build.model;
    if (g.kind === "build-move-sel") {
      const r = m.resolve(g.refs);
      if (!r.refs.length) this.cancelGesture();
      else {
        g.refs = r.refs;
        g.orig = r.hits.map((h) => placedOf(h.cx, h.cy, h.stamp));
      }
    }
    const { objects, doors } = this.buildSel;
    if (!objects.length && !doors.length) return;
    const r = m.resolve(objects);
    this.buildSel = { objects: r.refs, doors: doors.filter((d) => m.doorStyle(d) !== null) };
    this.selPlaced = r.hits.map((h) => placedOf(h.cx, h.cy, h.stamp));
    this.publishBuildSel();
    this.showSelection();
  }

  /** Selects nothing (Escape, undo and redo, the bar's deselect button). */
  clearBuildSelection(): void {
    const g = this.gesture;
    if (g.kind === "build-select" || g.kind === "build-box" || (g.kind === "build-move-sel" && g.select)) this.cancelGesture();
    this.newBurst();
    if (this.buildSel.objects.length || this.buildSel.doors.length) this.setBuildSel([], []);
  }

  /**
   * The selected objects as they are now, with what they need to be changed: the scene,
   * its cells, and each object found again. Null with none selected (or none left).
   */
  private selContext(): { scene: Scene; bounds: CellBounds; refs: StampRef[]; hits: StampHit[]; cur: Placed[] } | null {
    const scene = this.renderedScene;
    // (Not while they are being dragged: the drop places them.)
    if (!scene || isHex(scene.grid) || !this.buildSel.objects.length || this.gesture.kind === "build-move-sel") return null;
    // The build as it is this moment, not as the last frame drew it.
    if (this.build.update(sceneTerrain(this.room.state.items, scene.id))) {
      this.resolveBuildSel();
      this.bgLayer.batchDraw();
    }
    const r = this.build.model.resolve(this.buildSel.objects);
    if (!r.refs.length) return null;
    const cur = r.hits.map((h) => placedOf(h.cx, h.cy, h.stamp));
    return { scene, bounds: this.sceneBounds(scene), refs: r.refs, hits: r.hits, cur };
  }

  /** Moves, turns or sizes objects (refs[k] becomes next[k]) and selects them as they end up. */
  private placeSelection(scene: Scene, refs: StampRef[], next: Placed[], coalesce?: string): EditResult {
    const edit = new BuildEdit(this.room.state.items, scene.id);
    const r = edit.place(refs, next);
    if (!r.ok) {
      if (r.reason === "full") this.room.toast(BUILD_TOASTS.full, "error");
      return r;
    }
    this.applyBuild(edit, coalesce);
    this.setBuildSel(r.refs, this.buildSel.doors);
    return r;
  }

  /**
   * Turns the selection as a whole, delta degrees clockwise (see turnGroup). While the
   * selection is exactly what the last turn left, it turns on from the same starting point.
   */
  private turnSelection(delta: number, coalesce?: string): void {
    const ctx = this.selContext();
    if (!ctx) return;
    const keys = keysOf(ctx.refs);
    const from = this.turnBase?.keys === keys ? this.turnBase : { base: ctx.cur, deg: 0, keys };
    const deg = (((from.deg + delta) % 360) + 360) % 360;
    const r = this.placeSelection(ctx.scene, ctx.refs, turnGroup(from.base, deg, ctx.bounds), coalesce);
    if (r.ok) this.turnBase = { base: from.base, deg, keys: keysOf(r.refs) };
  }

  /**
   * Makes each selected object bigger or smaller by dSize squares, where it stands. When the
   * selection is exactly something sizing left (even after selecting others meanwhile, or an
   * undo), it's sized about where it stood when sizing began, so bigger then smaller at the
   * scene's edge puts it back where it was.
   */
  private sizeSelection(dSize: number, coalesce?: string): void {
    const ctx = this.selContext();
    if (!ctx || !canResize(ctx.cur, dSize > 0 ? 1 : -1)) return;
    const base = this.sizeBases.get(keysOf(ctx.refs)) ?? ctx.cur;
    const next = sizeGroup(ctx.cur, dSize, ctx.bounds, base);
    if (next.every((q, k) => samePlaced(q, ctx.cur[k]))) return;
    const r = this.placeSelection(ctx.scene, ctx.refs, next, coalesce);
    if (!r.ok) return;
    // A few hundred at most: the oldest go first.
    if (this.sizeBases.size >= 256) this.sizeBases.delete(this.sizeBases.keys().next().value!);
    this.sizeBases.set(keysOf(r.refs), base);
  }

  /** The arrow keys: moves the selected objects together, kept on the scene. */
  private nudgeBuild(dCol: number, dRow: number): void {
    const ctx = this.selContext();
    if (!ctx) return;
    const d = clampShift(ctx.cur, dCol, dRow, ctx.bounds);
    if (!d.dCol && !d.dRow) return;
    this.placeSelection(ctx.scene, ctx.refs, shiftGroup(ctx.cur, d.dCol, d.dRow, ctx.bounds), this.burstKey());
  }

  /** Delete: takes away the selected objects and doors, in one step. */
  private deleteBuildSel(): void {
    const scene = this.renderedScene;
    const { objects, doors } = this.buildSel;
    if (!scene || (!objects.length && !doors.length) || this.gesture.kind === "build-move-sel") return;
    const edit = new BuildEdit(this.room.state.items, scene.id);
    edit.removeRefs(objects);
    edit.removeDoors(doors);
    this.applyBuild(edit);
    this.setBuildSel([], []);
  }

  /** Duplicate: copies of the selected objects a square away (the first side with room), selected instead. */
  private duplicateBuild(): void {
    const ctx = this.selContext();
    if (!ctx) return;
    const cur = inDrawingOrder(ctx.hits).map((h) => placedOf(h.cx, h.cy, h.stamp));
    let full = false;
    for (const o of DUPLICATE_OFFSETS) {
      const copies = cur.map((q) => ({ ...q, col: q.col + o.dCol, row: q.row + o.dRow }));
      if (!groupFits(copies, ctx.bounds)) continue;
      const edit = new BuildEdit(this.room.state.items, ctx.scene.id);
      const r = edit.addGroup(copies);
      if (!r.ok) {
        full ||= r.reason === "full";
        continue;
      }
      this.applyBuild(edit);
      this.setBuildSel(r.refs, []);
      return;
    }
    this.room.toast(full ? BUILD_TOASTS.full : BUILD_TOASTS.noRoom, "error");
  }

  /** The selected objects to copy, in the order they're drawn (so stacks paste the same way up). */
  private copyList(): Placed[] | null {
    const ctx = this.selContext();
    if (!ctx) return null;
    return inDrawingOrder(ctx.hits).map((h) => placedOf(h.cx, h.cy, h.stamp));
  }

  /**
   * Copy: keeps the selected objects in this tab, and puts them on the system clipboard as
   * text, so they can be pasted in another scene, tab or room.
   */
  private copyObjects(): void {
    const ps = this.copyList();
    if (!ps) return;
    if (ps.length > CLIPBOARD_MAX) {
      this.room.toast(BUILD_TOASTS.tooMany, "error");
      return;
    }
    this.clip = ps;
    if (!this.room.state.buildClip) this.room.store.set({ buildClip: true });
    try {
      // Done here, in the key press, because Safari doesn't send a copy event with no text selected.
      navigator.clipboard?.writeText(encodeObjects(ps)).catch(() => {});
    } catch {
      // No clipboard: this tab's copy still pastes.
    }
    this.room.toast(BUILD_TOASTS.copied(ps.length));
  }

  /**
   * Paste: objects (copied here, or text copied from Tabletop anywhere) centred on the
   * square under the mouse, or the middle of the view; then they're what's selected.
   */
  private pasteObjects(ps: Placed[] | null): void {
    const scene = this.renderedScene;
    if (!scene) return;
    if (isHex(scene.grid)) {
      this.room.toast(HEX_TOAST, "error");
      return;
    }
    if (!ps?.length) {
      this.room.toast(BUILD_TOASTS.nothingToPaste, "error");
      return;
    }
    const at = this.pointerPos ? this.toWorld(this.pointerPos) : this.viewCenter();
    const cell = cellAt(at.x, at.y, scene.grid);
    const placed = placeGroupAt(ps, cell.col, cell.row, this.sceneBounds(scene));
    if (!placed) {
      this.room.toast(BUILD_TOASTS.tooBig, "error");
      return;
    }
    const edit = new BuildEdit(this.room.state.items, scene.id);
    const r = edit.addGroup(placed);
    if (!r.ok) {
      // (With no mouse, they went to the middle of the view: moving the map moves that.)
      const same = this.pointerPos ? BUILD_TOASTS.samePaste : BUILD_TOASTS.samePasteMiddle;
      this.room.toast(r.reason === "same" ? same : BUILD_TOASTS.full, "error");
      return;
    }
    this.applyBuild(edit);
    this.setBuildSel(r.refs, []);
  }

  /** What Build › Select's bar buttons do (the same as their keys). */
  buildAction(a: BuildAction): void {
    const s = this.room.state;
    if (s.tool !== "build" || s.buildOpts.mode !== "select" || !this.isGm) return;
    // Taps in quick succession make one undo step, as the wheel's turns do.
    const burst = this.burstKey();
    switch (a) {
      case "turnLeft":
        this.turnSelection(-15, burst);
        return;
      case "turnRight":
        this.turnSelection(15, burst);
        return;
      case "turn90":
        this.turnSelection(90);
        return;
      case "smaller":
        this.sizeSelection(-STAMP_SIZE_STEP, burst);
        return;
      case "bigger":
        this.sizeSelection(STAMP_SIZE_STEP, burst);
        return;
      case "duplicate":
        this.duplicateBuild();
        return;
      case "copy":
        this.copyObjects();
        return;
      case "paste":
        this.pasteObjects(this.clip);
        return;
      case "delete":
        this.deleteBuildSel();
        return;
      case "deselect":
        this.clearBuildSelection();
        return;
    }
  }

  /** Starts dragging objects (the selection, or in Objects the one under the pointer) from a point. */
  private startSelMove(pointerId: number, from: Point, world: Point, refs: StampRef[], select: boolean): boolean {
    const scene = this.renderedScene;
    if (!scene) return false;
    const r = this.build.model.resolve(refs);
    if (!r.refs.length) return false;
    const orig = r.hits.map((h) => placedOf(h.cx, h.cy, h.stamp));
    const g: Extract<Gesture, { kind: "build-move-sel" }> = {
      kind: "build-move-sel",
      pointerId,
      grab: cellAt(from.x, from.y, scene.grid),
      refs: r.refs,
      orig,
      shift: { dCol: 0, dRow: 0 },
      select,
    };
    this.gesture = g;
    // Not drawn where they are while they're dragged: the overlay draws them where they'd go.
    this.build.hideStamps(r.refs);
    this.moveSelTo(g, world);
    this.bgLayer.batchDraw();
    this.showSelection();
    this.updateCursor();
    return true;
  }

  /** Objects being dragged follow the pointer a square at a time, all together, kept on the scene. */
  private moveSelTo(g: Extract<Gesture, { kind: "build-move-sel" }>, world: Point): void {
    const scene = this.renderedScene!;
    const cell = cellAt(world.x, world.y, scene.grid);
    const d = clampShift(g.orig, cell.col - g.grab.col, cell.row - g.grab.row, this.sceneBounds(scene));
    if (d.dCol === g.shift.dCol && d.dRow === g.shift.dRow) return;
    g.shift = d;
    this.uiLayer.batchDraw();
  }

  /** Lets go of objects being dragged: they move there (one undo step), and stay selected in Select. */
  private dropSel(g: Extract<Gesture, { kind: "build-move-sel" }>): void {
    const scene = this.renderedScene;
    const { dCol, dRow } = g.shift;
    if (scene && (dCol || dRow)) {
      const edit = new BuildEdit(this.room.state.items, scene.id);
      const r = edit.place(g.refs, shiftGroup(g.orig, dCol, dRow, this.sceneBounds(scene)));
      if (r.ok) {
        this.applyBuild(edit);
        if (g.select) this.setBuildSel(r.refs, this.buildSel.doors);
      } else if (r.reason === "full") {
        this.room.toast(BUILD_TOASTS.full, "error");
      }
    }
    // Shown again only now, with the move applied: no frame shows them twice, or not at all.
    this.build.hideStamps([]);
    this.bgLayer.batchDraw();
    this.showSelection();
  }

  /** Starts a box selecting the objects whose middles are in it. */
  private startBox(pointerId: number, from: Point, world: Point, additive: boolean): void {
    const node = new Konva.Rect({
      x: from.x,
      y: from.y,
      width: 0,
      height: 0,
      stroke: SELECT_COLOR,
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      dash: [6, 4],
      fill: "rgba(79, 209, 255, 0.08)",
    });
    this.previewGroup.add(node);
    const g: Extract<Gesture, { kind: "build-box" }> = { kind: "build-box", pointerId, start: from, end: from, additive, node };
    this.gesture = g;
    this.boxTo(g, world);
    this.showSelection();
    this.updateCursor();
  }

  private boxTo(g: Extract<Gesture, { kind: "build-box" }>, world: Point): void {
    g.end = world;
    g.node.setAttrs({
      x: Math.min(g.start.x, world.x),
      y: Math.min(g.start.y, world.y),
      width: Math.abs(world.x - g.start.x),
      height: Math.abs(world.y - g.start.y),
    });
    this.uiLayer.batchDraw();
  }

  /** Lets go of a box: selects the objects whose middles are in it, and on the scene (adding with Shift). */
  private dropBox(g: Extract<Gesture, { kind: "build-box" }>, additive: boolean): void {
    g.node.destroy();
    this.uiLayer.batchDraw();
    const scene = this.renderedScene;
    if (!scene) return;
    this.newBurst();
    const scale = this.cam.scale;
    if (Math.abs(g.end.x - g.start.x) * scale < DRAG_THRESHOLD && Math.abs(g.end.y - g.start.y) * scale < DRAG_THRESHOLD) {
      // Hardly a box: a click on empty floor.
      if (!additive) this.setBuildSel([], []);
      return;
    }
    const a = this.cellsAt(g.start);
    const b = this.cellsAt(g.end);
    const all = this.sceneBounds(scene);
    const hits = this.build.model.stampsInBox(a.u, a.v, b.u, b.v).filter((h) => onScene(placedOf(h.cx, h.cy, h.stamp), all));
    const picked = hits.map(refOf);
    if (!additive) {
      this.setBuildSel(picked, []);
      return;
    }
    const { objects, doors } = this.buildSel;
    const extra = picked.filter((r) => !objects.some((o) => o.cx === r.cx && o.cy === r.cy && o.i === r.i && o.key === r.key));
    this.setBuildSel([...objects, ...extra], doors);
  }

  /**
   * A click (or tap) in Select: a door or object alone, or with Shift one added or taken
   * away; where objects overlap, clicking the one selected picks the one under it; empty
   * floor selects nothing.
   */
  private selectClick(g: Extract<Gesture, { kind: "build-select" }>): void {
    // What's under the press as things are now (see the gesture).
    const { door, under } = this.selectHit(g.startWorld, g.mouse);
    const { objects, doors } = this.buildSel;
    const toggle = g.shift && g.mouse;
    this.newBurst();
    if (door) {
      const d: DoorRef = { col: door.col, row: door.row, side: door.side };
      const at = doors.findIndex((x) => sameDoor(x, d));
      if (!toggle) this.setBuildSel([], [d]);
      else this.setBuildSel(objects, at >= 0 ? doors.filter((_, k) => k !== at) : [...doors, d]);
    } else if (under.length) {
      if (!toggle) {
        this.setBuildSel([refOf(this.clickTarget(under))], []);
        return;
      }
      const top = under[0];
      const at = objects.findIndex((r) => sameRef(r, top));
      this.setBuildSel(at >= 0 ? objects.filter((_, k) => k !== at) : [...objects, refOf(top)], doors);
    } else if (!toggle) {
      this.setBuildSel([], []);
    }
  }

  /** On a touch screen, the first time in a page load that Objects or Select is picked: how to use it. */
  private touchHint(mode: "stamps" | "select"): void {
    if (touchHintsShown.has(mode) || typeof matchMedia !== "function" || !matchMedia("(hover: none)").matches) return;
    touchHintsShown.add(mode);
    this.room.toast(TOUCH_HINTS[mode]);
  }

  /** What the mouse wheel can turn here: the next object (Objects), the selection (Select), or nothing. */
  private wheelTarget(): "ghost" | "selection" | null {
    const s = this.room.state;
    const scene = this.renderedScene;
    if (s.tool !== "build" || !this.isGm || !scene || isHex(scene.grid)) return null;
    const o = s.buildOpts;
    if (o.mode === "stamps" && o.stampMode === "place") return "ghost";
    if (o.mode === "select" && this.buildSel.objects.length) return "selection";
    return null;
  }

  /** Wheel steps over objects: turns (15 or 5 degrees a step) or sizes (a quarter square a step, up is bigger). */
  private wheelStep(target: "ghost" | "selection", intent: "turn" | "fine-turn" | "size", steps: number): void {
    const deg = steps * (intent === "turn" ? 15 : 5);
    const dSize = -steps * STAMP_SIZE_STEP;
    if (target === "selection") {
      if (intent === "size") this.sizeSelection(dSize, this.burstKey());
      else this.turnSelection(deg, this.burstKey());
      return;
    }
    const o = this.room.state.buildOpts;
    if (intent === "size") {
      // Alt+click places this one now, rather than removing one (until Alt is let go).
      this.altScaled = true;
      this.room.store.set({ buildOpts: { ...o, stampSize: snapSize(o.stampSize + dSize) } });
    } else {
      this.room.store.set({ buildOpts: { ...o, stampDeg: snapDeg(o.stampDeg + deg) } });
    }
  }

  private polyClick(world: Point): void {
    const scene = this.renderedScene!;
    const o = this.room.state.fogOpts;
    const p = o.snap ? snapToVertex(world, scene.grid) : world;
    const scale = this.cam.scale;
    if (!this.poly) {
      const color = o.mode === "reveal" ? "#7cffb2" : "#ffb27c";
      const node = new Konva.Line({
        points: [p.x, p.y],
        stroke: color,
        strokeWidth: 2,
        strokeScaleEnabled: false,
        dash: [6, 4],
        fill: hexToRgba(color, 0.15),
        closed: false,
      });
      const start = new Konva.Circle({ x: p.x, y: p.y, radius: 6 / scale, fill: color });
      this.previewGroup.add(node, start);
      this.poly = { points: [p.x, p.y], node, start, mode: o.mode };
    } else {
      const pts = this.poly.points;
      const nearFirst = Math.hypot(p.x - pts[0], p.y - pts[1]) * scale < 12;
      const sameAsLast = Math.hypot(p.x - pts[pts.length - 2], p.y - pts[pts.length - 1]) * scale < 4;
      if ((nearFirst || sameAsLast) && pts.length >= 6) {
        this.finishPoly();
        return;
      }
      if (sameAsLast) return;
      pts.push(p.x, p.y);
    }
    this.updatePolyPreview(world);
  }

  private updatePolyPreview(world: Point): void {
    if (!this.poly || !this.renderedScene) return;
    const o = this.room.state.fogOpts;
    const p = o.snap ? snapToVertex(world, this.renderedScene.grid) : world;
    this.poly.node.points([...this.poly.points, p.x, p.y]);
    this.uiLayer.batchDraw();
  }

  private finishPoly(): void {
    if (!this.poly) return;
    const pts = this.poly.points.slice();
    this.cancelPoly();
    if (pts.length >= 6) this.commitFog("poly", pts);
  }

  private cancelPoly(): void {
    if (!this.poly) return;
    this.poly.node.destroy();
    this.poly.start.destroy();
    this.poly = null;
    this.uiLayer.batchDraw();
  }

  /** All the pieces of one brush stroke, as one undoable change. */
  private commitStrokes(pieces: number[][], width: number): void {
    const s = this.room.state;
    const scene = this.renderedScene;
    if (!scene || !s.me || !pieces.length) return;
    let z = this.room.nextZ(scene.id, "fog");
    const items: FogItem[] = pieces.map((points) => ({
      id: randomId(12),
      sceneId: scene.id,
      kind: "fog",
      z: z++,
      owner: s.me!.userId,
      mode: s.fogOpts.mode,
      shape: "stroke",
      points: points.map(round2),
      width,
    }));
    this.room.change({ upsert: items });
  }

  private commitFog(shape: FogItem["shape"], points: number[], width?: number): void {
    const s = this.room.state;
    const scene = this.renderedScene;
    if (!scene || !s.me) return;
    const item: FogItem = {
      id: randomId(12),
      sceneId: scene.id,
      kind: "fog",
      z: this.room.nextZ(scene.id, "fog"),
      owner: s.me.userId,
      mode: s.fogOpts.mode,
      shape,
      points: points.map(round2),
      ...(shape === "stroke" && width ? { width } : {}),
    };
    this.room.change({ upsert: [item] });
  }

  /** Leaves a spell template on the map as a filled drawing in your colour. */
  private pinTemplate(shape: TemplateShape, a: Point, b: Point): void {
    const s = this.room.state;
    const scene = this.renderedScene;
    if (!scene || !s.me) return;
    if (Math.hypot(b.x - a.x, b.y - a.y) * this.cam.scale < 4) return;
    if (!this.isGm && !s.room?.settings.playersCanDraw) {
      this.room.toast("The GM has turned drawing off, so templates can't be pinned.", "error");
      return;
    }
    const t = templateGeometry(shape, a, b, scene.grid);
    const base = {
      id: randomId(12),
      sceneId: scene.id,
      kind: "drawing" as const,
      z: this.room.nextZ(scene.id, "drawing"),
      owner: s.me.userId,
      color: s.me.color,
      width: round2(Math.max(0.5, 2 / this.cam.scale)),
      fill: true,
    };
    const item: DrawingItem = t.circle
      ? {
          ...base,
          shape: "ellipse",
          points: [t.circle.x - t.circle.r, t.circle.y - t.circle.r, t.circle.x + t.circle.r, t.circle.y + t.circle.r].map(round2),
        }
      : { ...base, shape: "poly", points: t.polygon!.map(round2) };
    this.room.change({ upsert: [item] });
  }

  private setLocalRuler(a: Point, b: Point, shape: MeasureShape): void {
    const scene = this.renderedScene;
    if (!scene) return;
    const label =
      shape === "ruler"
        ? formatDistance(cellDistance(a, b, scene.grid), scene.grid)
        : templateGeometry(shape, a, b, scene.grid).label;
    this.localRuler = { a, b, label, shape, color: this.room.state.me?.color ?? "#fff", expires: Infinity };
    this.renderRulers();
  }

  /** Moves the brush-size circle to `world` (or hides it). */
  private updateBrushCursor(world: Point | null): void {
    const s = this.room.state;
    const scene = this.renderedScene;
    const show = !!world && !!scene && s.tool === "fog" && s.fogOpts.shape === "brush" && this.isGm;
    if (show) {
      this.brushCursor.setAttrs({
        x: world!.x,
        y: world!.y,
        radius: Math.max(1, (s.fogOpts.brush * scene!.grid.size) / 2),
        stroke: s.fogOpts.mode === "reveal" ? "#7cffb2" : "#ffb27c",
        visible: true,
      });
    } else if (this.brushCursor.visible()) {
      this.brushCursor.visible(false);
    } else {
      return;
    }
    this.uiLayer.batchDraw();
  }

  private onPointerMove = (e: PointerEvent): void => {
    const pos = this.localPos(e);
    const world = this.toWorld(pos);
    // (Alt let go without the page seeing it: an Alt+click removes again.)
    if (e.altKey !== this.altDown || (!e.altKey && this.altScaled)) this.setAlt(e.altKey);
    if (e.pointerType === "mouse") {
      this.pointerPos = pos;
      this.updateBrushCursor(world);
      if (this.room.state.tool === "build") this.setHover(world);
    }
    if (!this.pointers.has(e.pointerId)) {
      if (this.poly) this.updatePolyPreview(world);
      return;
    }
    this.pointers.set(e.pointerId, pos);
    const g = this.gesture;
    if (g.kind === "pinch") {
      this.updatePinch(g);
      return;
    }
    if (g.kind === "none" || g.pointerId !== e.pointerId) {
      if (this.poly) this.updatePolyPreview(world);
      return;
    }
    const scene = this.renderedScene!;
    const now = performance.now();
    switch (g.kind) {
      case "pan": {
        const dx = pos.x - g.start.x;
        const dy = pos.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!g.moved) {
          g.moved = true;
          this.el.style.cursor = "grabbing";
        }
        this.setCam(g.cam.x + dx, g.cam.y + dy, g.cam.scale);
        return;
      }
      case "drag-items": {
        if (!this.tokens.has(g.id) && !this.drawings.has(g.id)) {
          this.cancelGesture();
          return;
        }
        if (!g.moved) {
          if (Math.hypot(pos.x - g.start.x, pos.y - g.start.y) < DRAG_THRESHOLD) return;
          g.moved = true;
          for (const id of g.origs.keys()) {
            this.dragging.add(id);
            this.tokens.get(id)?.group.moveToTop();
          }
          // A drawing that vanished before the drag began (erased, or hidden by the GM) stays out of it.
          g.drawings = g.drawings.filter((id) => this.drawings.has(id));
          for (const id of g.drawings) this.dragging.add(id);
        }
        const dx = world.x - g.startWorld.x;
        const dy = world.y - g.startWorld.y;
        // Tokens carry their centre; drawings carry how far they've moved.
        const moves: { id: string; x: number; y: number }[] = [];
        for (const [id, o] of g.origs) {
          const n = this.tokens.get(id);
          if (!n) continue;
          const p = { x: o.x + dx, y: o.y + dy };
          n.group.position(p);
          moves.push({ id, x: round2(p.x), y: round2(p.y) });
        }
        for (const id of g.drawings) {
          const n = this.drawings.get(id);
          if (!n) continue;
          n.shape.position({ x: n.base.x + dx, y: n.base.y + dy });
          moves.push({ id, x: round2(dx), y: round2(dy) });
        }
        if (g.origs.size) this.tokenLayer.batchDraw();
        if (g.drawings.length) this.drawLayer.batchDraw();
        if (now - g.lastEph > EPH_INTERVAL) {
          g.lastEph = now;
          this.room.sendEph({ k: "drag", sceneId: scene.id, moves });
        }
        return;
      }
      case "grid-align": {
        // Kept square: grid cells are square.
        const side = Math.max(Math.abs(world.x - g.start.x), Math.abs(world.y - g.start.y));
        const end = {
          x: g.start.x + (world.x < g.start.x ? -side : side),
          y: g.start.y + (world.y < g.start.y ? -side : side),
        };
        g.end = end;
        g.node.setAttrs({
          x: Math.min(g.start.x, end.x),
          y: Math.min(g.start.y, end.y),
          width: side,
          height: side,
        });
        this.uiLayer.batchDraw();
        return;
      }
      case "tap":
        if (Math.hypot(pos.x - g.start.x, pos.y - g.start.y) >= DRAG_THRESHOLD) {
          // Dragging an object in Objects: it moves by whole squares, keeping hold of it where it was grabbed.
          if (g.grab && this.room.state.tool === "build" && this.startSelMove(g.pointerId, g.world, world, [refOf(g.grab)], false)) return;
          // It's a drag, not a tap: pan instead.
          this.gesture = { kind: "pan", pointerId: g.pointerId, start: g.start, cam: this.cam, moved: false };
        }
        return;
      case "build-select": {
        if (Math.hypot(pos.x - g.start.x, pos.y - g.start.y) < DRAG_THRESHOLD) return;
        // What's under the press as things are now (see the gesture).
        const hit = this.selectHit(g.startWorld, g.mouse);
        // A drag that starts on something selected moves the selection (even one under another
        // object, or one a turn or nudge moved away while the button was held).
        const grabbed = hit.under.some((h) => this.buildSel.objects.some((r) => sameRef(r, h))) || (!!g.changed && g.grab);
        if (g.mouse && !g.shift && (hit.obj || grabbed)) {
          // With a mouse, as in Dungeondraft: dragging an object not selected selects it and moves it.
          if (!grabbed && hit.obj) this.setBuildSel([refOf(hit.obj)], []);
          if (this.startSelMove(g.pointerId, g.startWorld, world, this.buildSel.objects, true)) return;
        } else if (!g.mouse && grabbed && this.startSelMove(g.pointerId, g.startWorld, world, this.buildSel.objects, true)) {
          return;
        }
        if (g.mouse && !g.shift && hit.door && !doorDragWarned) {
          doorDragWarned = true;
          this.room.toast(BUILD_TOASTS.doorDrag);
        }
        // Anything else draws a box (with Shift, adding to what's selected).
        this.startBox(g.pointerId, g.startWorld, world, g.shift);
        return;
      }
      case "build-box":
        this.boxTo(g, world);
        return;
      case "build-move-sel":
        this.moveSelTo(g, world);
        return;
      case "marquee": {
        g.node.setAttrs({
          x: Math.min(g.start.x, world.x),
          y: Math.min(g.start.y, world.y),
          width: Math.abs(world.x - g.start.x),
          height: Math.abs(world.y - g.start.y),
        });
        this.uiLayer.batchDraw();
        return;
      }
      case "draw":
        this.drawMove(g, world);
        return;
      case "erase":
        this.eraseAt(g, pos);
        return;
      case "build-paint":
        this.paintBrush(g.last, world, g.erase);
        g.last = world;
        this.bgLayer.batchDraw();
        return;
      case "build-rect": {
        const cell = cellAt(world.x, world.y, scene.grid);
        if (cell.col === g.end.col && cell.row === g.end.row) return;
        g.end = cell;
        this.paintArea(g.start, cell, g.erase, g.circle);
        this.bgLayer.batchDraw();
        return;
      }
      case "build-wall":
        this.wallMove(g, world);
        return;
      case "fog-rect": {
        const end = this.room.state.fogOpts.snap ? snapToVertex(world, scene.grid) : world;
        g.end = end;
        g.node.setAttrs({
          x: Math.min(g.start.x, end.x),
          y: Math.min(g.start.y, end.y),
          width: Math.abs(end.x - g.start.x),
          height: Math.abs(end.y - g.start.y),
        });
        this.uiLayer.batchDraw();
        return;
      }
      case "fog-lasso": {
        const n = g.points.length;
        if (Math.hypot(world.x - g.points[n - 2], world.y - g.points[n - 1]) * this.cam.scale >= 3) {
          g.points.push(world.x, world.y);
          g.node.points(g.points);
          this.uiLayer.batchDraw();
        }
        return;
      }
      case "fog-paint": {
        const n = g.points.length;
        // A new point every few pixels on screen (or a tenth of the brush), whichever is further.
        const step = Math.max(3 / this.cam.scale, g.width / 10);
        if (Math.hypot(world.x - g.points[n - 2], world.y - g.points[n - 1]) >= step) {
          g.points.push(world.x, world.y);
          if (g.points.length >= STROKE_PIECE_POINTS * 2) {
            // Long stroke: bank this piece and carry on from its last point.
            g.pieces.push(g.points);
            g.points = g.points.slice(-2);
          }
          const shown = [...g.pieces.flat(), ...g.points];
          g.node.points(shown.length === 2 ? [...shown, shown[0] + 0.01, shown[1]] : shown);
          this.uiLayer.batchDraw();
        }
        return;
      }
      case "measure": {
        const end = scene.grid.snap && g.shape === "ruler" ? snapToCellCenter(world, scene.grid) : world;
        if (end.x === g.end.x && end.y === g.end.y) return;
        g.end = end;
        this.setLocalRuler(g.start, end, g.shape);
        if (now - g.lastEph > EPH_INTERVAL) {
          g.lastEph = now;
          this.room.sendEph({
            k: "ruler",
            sceneId: scene.id,
            points: [g.start.x, g.start.y, end.x, end.y].map(round2),
            label: this.localRuler?.label ?? "",
            shape: g.shape,
          });
        }
        return;
      }
      case "pointer": {
        g.at = world;
        if (!g.moved && Math.hypot(pos.x - g.start.x, pos.y - g.start.y) >= DRAG_THRESHOLD) g.moved = true;
        this.addTrail("me", this.room.state.me?.color ?? "#fff", world);
        // Up to one a frame: the table display follows it as smoothly as the mouse moves.
        if (now - g.lastEph >= 15) {
          g.lastEph = now;
          this.room.sendEph({ k: "pointer", sceneId: scene.id, x: round2(world.x), y: round2(world.y) });
        }
        return;
      }
    }
  };

  private updatePinch(g: Extract<Gesture, { kind: "pinch" }>): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scale = clampScale(g.cam.scale * (dist / g.startDist));
    // Keep the world point that was under the fingers' midpoint under the midpoint.
    const wx = (g.startMid.x - g.cam.x) / g.cam.scale;
    const wy = (g.startMid.y - g.cam.y) / g.cam.scale;
    this.setCam(mid.x - wx * scale, mid.y - wy * scale, scale);
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    const g = this.gesture;
    if (g.kind === "pinch") {
      if (this.pointers.size < 2) this.gesture = { kind: "none" };
      return;
    }
    if (g.kind === "none" || g.pointerId !== e.pointerId) return;
    if (e.type === "pointercancel") {
      this.cancelGesture();
      return;
    }
    this.gesture = { kind: "none" };
    this.updateCursor();
    const world = this.toWorld(this.localPos(e));
    const scene = this.renderedScene;
    if (!scene) return;
    switch (g.kind) {
      case "pan":
        if (!g.moved) g.onClick?.();
        return;
      case "grid-align": {
        g.node.destroy();
        this.uiLayer.batchDraw();
        const align = this.room.state.gridAlign;
        const side = Math.abs(g.end.x - g.start.x);
        if (!align || side * this.cam.scale < 8) return;
        const size = Math.round((side / align.cells) * 1000) / 1000;
        if (size < 4) return;
        // The box's corner sits on a grid line, so the offset is where that corner falls within a cell.
        const x0 = Math.min(g.start.x, g.end.x);
        const y0 = Math.min(g.start.y, g.end.y);
        const mod = (v: number) => Math.round((((v % size) + size) % size) * 100) / 100;
        this.room.updateScene(scene.id, {
          grid: { ...scene.grid, type: "square", size, offsetX: mod(x0), offsetY: mod(y0), show: true },
        });
        this.room.store.set({ gridAlign: null });
        this.room.toast(`Grid set: ${size} px squares.`);
        return;
      }
      case "tap":
        switch (g.action) {
          case "poly":
            this.polyClick(g.world);
            break;
          case "door":
            this.doorTap(g.world, !!g.alt);
            break;
          case "stamp":
            this.stampTap(g.world, !!g.alt, !!g.touch);
            break;
          case "wallpoint":
            this.wallPointClick(g.world);
            break;
          case "note": {
            // Font size follows the line-width setting, sized for how zoomed in you are right now.
            const fontSize = round2((12 + this.room.state.drawOpts.width * 2) / this.cam.scale);
            this.room.store.set({ textPrompt: { x: round2(g.world.x), y: round2(g.world.y), fontSize } });
            break;
          }
        }
        return;
      case "build-paint":
      case "build-rect":
        this.commitBuild();
        return;
      case "build-wall":
        if (!g.moved && g.mouse) {
          // A click with a mouse starts walls placed corner by corner, as in Dungeondraft.
          this.lastWallClick = { at: performance.now(), c: g.start.c, r: g.start.r };
          this.startWallPath(g.start, g.mode);
          return;
        }
        if (!g.moved) {
          // A tap on a touch screen: the grid line nearest it.
          const edge = this.nearestEdge(world);
          if (this.edgeOnScene(edge.col, edge.row, edge.side)) this.build.draftWall(edge.col, edge.row, edge.side, g.mode);
        }
        this.commitBuild();
        return;
      case "build-select":
        if (!g.changed) this.selectClick(g);
        return;
      case "build-box":
        // Where the pointer let go, in case its last move wasn't sent on its own.
        g.end = world;
        this.dropBox(g, g.additive || e.shiftKey);
        return;
      case "build-move-sel":
        this.moveSelTo(g, world);
        this.dropSel(g);
        return;
      case "drag-items": {
        if (!g.moved) return;
        for (const id of g.origs.keys()) {
          this.dragging.delete(id);
          const n = this.tokens.get(id);
          if (n) n.dirty = true;
        }
        // Drawings that vanished during the drag (and perhaps came back) weren't moved on screen: leave them.
        const moved = new Set(g.drawings.filter((id) => this.dragging.has(id)));
        for (const id of g.drawings) {
          this.dragging.delete(id);
          this.resetDrawing(id);
        }
        this.itemsDirty = true;
        const items = this.room.state.items;
        const snap = scene.grid.snap && !e.altKey;
        let offset = { x: world.x - g.startWorld.x, y: world.y - g.startWorld.y };
        const lead = items[g.id];
        const leadOrig = g.origs.get(g.id);
        if (snap && lead?.kind === "token" && leadOrig) {
          // Snap the token being held; everything else keeps its place around it.
          const p = snapTokenCenter({ x: leadOrig.x + offset.x, y: leadOrig.y + offset.y }, lead.size, scene.grid);
          offset = { x: p.x - leadOrig.x, y: p.y - leadOrig.y };
        }
        const patches: ItemPatch[] = [];
        const finalMoves: { id: string; x: number; y: number }[] = [];
        for (const [id, o] of g.origs) {
          const item = items[id];
          if (!item || item.kind !== "token") continue;
          let p = { x: o.x + offset.x, y: o.y + offset.y };
          // A token that sat on the grid stays on it, whatever size the one being held is.
          if (snap && id !== g.id && isOnGrid(o, item.size, scene.grid)) p = snapTokenCenter(p, item.size, scene.grid);
          const x = round2(p.x);
          const y = round2(p.y);
          if (x !== item.x || y !== item.y) patches.push({ id, set: { x, y } });
          finalMoves.push({ id, x, y });
        }
        if (offset.x || offset.y) {
          for (const id of g.drawings) {
            const item = items[id];
            if (!item || item.kind !== "drawing" || !moved.has(id)) continue;
            const points = item.points.map((v, i) => round2(v + (i % 2 === 0 ? offset.x : offset.y)));
            patches.push({ id, set: { points } });
          }
        }
        if (patches.length) this.room.change({ patch: patches });
        else this.scheduleSync();
        // Others followed the tokens live; tell them where they ended up. (Drawings
        // settle when the change arrives.)
        if (finalMoves.length) this.room.sendEph({ k: "drag", sceneId: scene.id, moves: finalMoves });
        return;
      }
      case "marquee": {
        g.node.destroy();
        this.uiLayer.batchDraw();
        const x0 = Math.min(g.start.x, world.x);
        const x1 = Math.max(g.start.x, world.x);
        const y0 = Math.min(g.start.y, world.y);
        const y1 = Math.max(g.start.y, world.y);
        if ((x1 - x0) * this.cam.scale < 4 && (y1 - y0) * this.cam.scale < 4) return;
        const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const picked: string[] = [];
        for (const [id, n] of this.tokens) {
          if (n.item && inside(n.item.x, n.item.y) && !this.fogged(this.toScreen(n.item))) picked.push(id);
        }
        for (const [id, n] of this.drawings) {
          const r = n.shape.getClientRect({ relativeTo: this.drawLayer });
          const centre = this.toScreen({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
          if (inside(r.x, r.y) && inside(r.x + r.width, r.y + r.height) && !this.fogged(centre)) picked.push(id);
        }
        const base = g.additive ? this.room.state.selection.filter((id) => !picked.includes(id)) : [];
        this.room.select([...base, ...picked]);
        return;
      }
      case "draw":
        this.drawUp(g);
        return;
      case "erase":
        if (g.ids.size) this.room.change({ delete: [...g.ids] });
        return;
      case "fog-rect": {
        g.node.destroy();
        this.uiLayer.batchDraw();
        const { start, end } = g;
        if (Math.abs(end.x - start.x) * this.cam.scale < 3 || Math.abs(end.y - start.y) * this.cam.scale < 3) return;
        this.commitFog("rect", [start.x, start.y, end.x, end.y]);
        return;
      }
      case "fog-lasso": {
        g.node.destroy();
        this.uiLayer.batchDraw();
        if (g.points.length >= 6) {
          const pts = simplify(g.points, 1.5 / this.cam.scale);
          if (pts.length >= 6) this.commitFog("poly", pts);
        }
        return;
      }
      case "fog-paint": {
        g.node.destroy();
        this.uiLayer.batchDraw();
        const pieces = [...g.pieces, g.points]
          .filter((p, i, all) => p.length >= 4 || all.length === 1)
          .map((p) => {
            // A click without moving is a single dab.
            const pts = p.length === 2 ? [p[0], p[1], p[0] + 0.01, p[1]] : simplify(p, g.width / 20);
            return pts.length >= 4 ? pts : [pts[0], pts[1], pts[0] + 0.01, pts[1]];
          });
        this.commitStrokes(pieces, g.width);
        return;
      }
      case "measure":
        this.localRuler = null;
        this.renderRulers();
        this.room.sendEph({ k: "ruler", sceneId: scene.id, points: null });
        if (g.shape !== "ruler" && this.room.state.measureOpts.keep) this.pinTemplate(g.shape, g.start, g.end);
        return;
      case "pointer":
        // A click (or tap) that didn't move: a ping, pulsing there for a few seconds on
        // everyone's screen and the table display.
        if (!g.moved) {
          this.addPing("me", this.room.state.me?.color ?? "#fff", g.at);
          this.room.sendEph({ k: "pointer", sceneId: scene.id, x: round2(g.at.x), y: round2(g.at.y), ping: true });
        }
        return;
    }
  };

  /** Abandons whatever gesture is in progress and puts things back as they were. */
  private cancelGesture(): void {
    const g = this.gesture;
    this.gesture = { kind: "none" };
    switch (g.kind) {
      case "drag-items": {
        for (const id of g.origs.keys()) {
          this.dragging.delete(id);
          const n = this.tokens.get(id);
          if (n) n.dirty = true;
        }
        for (const id of g.drawings) {
          this.dragging.delete(id);
          this.resetDrawing(id);
        }
        this.itemsDirty = true;
        this.drawLayer.batchDraw();
        this.scheduleSync();
        // Others saw them moving: put them back for them too.
        if (g.moved && this.renderedSceneId) {
          const moves = [
            ...[...g.origs].map(([id, o]) => ({ id, x: o.x, y: o.y })),
            ...g.drawings.map((id) => ({ id, x: 0, y: 0 })),
          ];
          this.room.sendEph({ k: "drag", sceneId: this.renderedSceneId, moves });
        }
        break;
      }
      case "marquee":
        g.node.destroy();
        this.uiLayer.batchDraw();
        break;
      case "draw":
      case "fog-rect":
      case "fog-lasso":
      case "fog-paint":
      case "grid-align":
        g.node.destroy();
        this.uiLayer.batchDraw();
        break;
      case "erase":
        for (const id of g.ids) {
          this.drawings.get(id)?.shape.show();
          this.tokens.get(id)?.group.show();
        }
        this.drawLayer.batchDraw();
        this.tokenLayer.batchDraw();
        break;
      case "build-paint":
      case "build-rect":
      case "build-wall":
        this.build.endDraft();
        this.bgLayer.batchDraw();
        break;
      case "build-move-sel":
        this.build.hideStamps([]);
        this.bgLayer.batchDraw();
        this.uiLayer.batchDraw();
        break;
      case "build-box":
        g.node.destroy();
        this.uiLayer.batchDraw();
        break;
      case "measure":
        this.localRuler = null;
        this.renderRulers();
        if (this.renderedSceneId) this.room.sendEph({ k: "ruler", sceneId: this.renderedSceneId, points: null });
        break;
      default:
        break;
    }
    if (g.kind === "build-select" || g.kind === "build-box" || g.kind === "build-move-sel") this.showSelection();
    this.updateCursor();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const pos = this.localPos(e);
    // Firefox only reports whole lines to a page that asks for deltaMode before deltaY.
    const mode = e.deltaMode;
    let dy = e.deltaY;
    let dx = e.deltaX;
    if (mode === 1) {
      dy *= 33;
      dx *= 33;
    } else if (mode === 2) {
      dy *= 400;
      dx *= 400;
    }
    // Every event goes through, so each stream (a spin of the wheel, a trackpad flick) is judged as one.
    // It goes by when the input came, not when it's handled: notches kept waiting while the page
    // was busy arrive close together, and would otherwise pass for a wheel spinning freely.
    const step = this.wheelSteps.next(
      { deltaMode: mode, dx, dy, wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY },
      e.timeStamp || performance.now(),
    );
    const target = this.wheelTarget();
    const intent = wheelIntent(
      { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, z: this.zDown, dx, dy },
      target,
      step.kind,
      this.room.state.wheelTurns,
    );
    if (intent === "zoom") {
      // A trackpad pinch arrives as Ctrl+wheel in small steps. A mouse wheel's notches with
      // Ctrl held (how Dungeondraft zooms) are big ones: zoom those at the plain wheel's rate.
      const notch = mode !== 0 || Math.abs(dy) >= 40;
      this.zoomAt(pos, Math.exp(-dy * (notch ? 0.0015 : 0.01)));
      return;
    }
    if (intent !== "default") {
      // Over objects in the Build tool: the wheel turns or sizes them, as in Dungeondraft.
      if (target && step.steps) this.wheelStep(target, intent, step.steps);
      return;
    }
    const looksLikeTrackpadScroll = mode === 0 && (Math.abs(dx) > 0 || Math.abs(dy) < 40);
    if (looksLikeTrackpadScroll) {
      const c = this.cam;
      this.setCam(c.x - dx, c.y - dy, c.scale);
      return;
    }
    this.zoomAt(pos, Math.exp(-dy * 0.0015));
  };

  private onDragOver = (e: DragEvent): void => {
    if (this.room.display) return;
    const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
    if (types.includes("application/x-tabletop-asset") || types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  };

  private onDrop = (e: DragEvent): void => {
    e.preventDefault();
    if (this.room.display) return;
    if (!this.renderedScene) {
      // Nothing on the board yet: a map can still start a scene.
      if (this.isGm) void this.takeFiles([...(e.dataTransfer?.files ?? [])], null);
      return;
    }
    const world = this.toWorld(this.localPos(e));
    const assetId = e.dataTransfer?.getData("application/x-tabletop-asset");
    if (assetId) {
      this.room.addToken({ assetId }, world);
      return;
    }
    void this.takeFiles([...(e.dataTransfer?.files ?? [])], world);
  };

  /**
   * Pasting: objects copied in Build › Select (from this tab, another, or another room), or
   * an image: a map for a new scene, or a token in the middle of the view.
   */
  private onPaste = (e: ClipboardEvent): void => {
    if (this.room.display) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (document.querySelector(".modal-backdrop") || !this.renderedScene) return;
    const s = this.room.state;
    const building = s.tool === "build" && this.isGm;
    const selecting = building && s.buildOpts.mode === "select";
    // The paste event came: Ctrl+V's fallback isn't needed.
    if (this.pasteArm) clearTimeout(this.pasteArm);
    this.pasteArm = null;
    if (building) {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const objects = text ? decodeObjects(text) : null;
      if (objects) {
        e.preventDefault();
        if (selecting) this.pasteObjects(objects);
        else this.room.toast(BUILD_TOASTS.pasteMode);
        return;
      }
    }
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void this.takeFiles(files, this.viewCenter());
      return;
    }
    if (selecting) {
      e.preventDefault();
      this.pasteObjects(this.clip);
    }
  };

  /**
   * Copying with nothing else to copy (no text selected), in Build › Select with objects
   * selected: the objects go on the clipboard as text (see copyObjects, which the key does too).
   */
  private onCopy = (e: ClipboardEvent): void => {
    if (this.room.display) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (document.querySelector(".modal-backdrop") || pageTextSelected()) return;
    const s = this.room.state;
    if (s.tool !== "build" || s.buildOpts.mode !== "select" || !this.isGm || !e.clipboardData) return;
    const ps = this.copyList();
    if (!ps || ps.length > CLIPBOARD_MAX) return;
    this.clip = ps;
    if (!s.buildClip) this.room.store.set({ buildClip: true });
    e.clipboardData.setData("text/plain", encodeObjects(ps));
    e.preventDefault();
  };

  /**
   * Files dropped or pasted on the board. For the GM, map files and big images start
   * new scenes (in the new-scene dialog); other images become tokens where they landed.
   */
  private async takeFiles(files: File[], at: Point | null): Promise<void> {
    const maps: File[] = [];
    const tokens: File[] = [];
    for (const f of files) {
      if (this.isGm && (await looksLikeMap(f))) maps.push(f);
      else if (f.type.startsWith("image/")) tokens.push(f);
      else if (isVttFile(f) || isDungeondraftProject(f) || /\.(ob2|owlbear)$/i.test(f.name)) this.room.toast("Only the GM can add maps.", "error");
    }
    if (maps.length) this.room.store.set({ mapImport: maps });
    if (tokens.length && at) void this.room.uploadTokens(tokens, at);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.room.display) return;
    const key = e.key;
    // Z held turns objects 5 degrees at a time with the wheel (Z alone: Ctrl+Z is undo).
    const plainZ = (key === "z" || key === "Z") && !e.ctrlKey && !e.metaKey && !e.altKey;
    // A burst of turning, sizing or nudging objects is one undo step. Holding Alt, Z or
    // Shift, or the arrows and [ ] that do the nudging and turning, keeps the burst going;
    // any other key ends it.
    const burstKeys = key.startsWith("Arrow") || e.code === "BracketLeft" || e.code === "BracketRight";
    if (!burstKeys && !plainZ && key !== "Alt" && key !== "Shift" && key !== "Control" && key !== "Meta") this.newBurst();
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (document.querySelector(".modal-backdrop")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (key === "Alt") {
      // Alt reverses the Build tool, as in Dungeondraft; keep the browser's menu out of it.
      if (this.room.state.tool === "build") e.preventDefault();
      this.setAlt(true);
      return;
    }
    if (plainZ) {
      this.zDown = true;
      return;
    }
    if (key === " ") {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.updateCursor();
      }
      e.preventDefault();
      return;
    }
    const room = this.room;
    const st = room.state;
    // Build › Select: its keys act on the objects and doors selected there, never on tokens.
    const selecting = st.tool === "build" && st.buildOpts.mode === "select" && this.isGm;
    if (mod) {
      const k = key.toLowerCase();
      const g = this.gesture.kind;
      if ((k === "z" || k === "y") && (g === "build-move-sel" || g === "build-box" || g === "build-select")) this.cancelGesture();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) this.room.redo();
        else this.room.undo();
      } else if (k === "y") {
        e.preventDefault();
        this.room.redo();
      } else if (k === "d") {
        e.preventDefault();
        // Held down, the key repeats: the objects are copied once, not in a row across the map.
        if (selecting) {
          if (!e.repeat) this.duplicateBuild();
        } else duplicateSelection(room);
      } else if (k === "c" && selecting && this.buildSel.objects.length && !pageTextSelected()) {
        // Not prevented: the copy event that follows puts the objects on the clipboard too.
        // With text selected on the page (since the board was last pressed, which lets go of
        // it), the browser copies the text instead, as it would anywhere else.
        if (!e.repeat) this.copyObjects();
      } else if (k === "v" && selecting) {
        // Held down: pasted once (prevented, a repeat sends no paste event either).
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        // The paste event pastes (whatever was copied, wherever); this is for a browser that doesn't send one.
        if (this.pasteArm) clearTimeout(this.pasteArm);
        this.pasteArm = setTimeout(() => {
          this.pasteArm = null;
          const s = this.room.state;
          if (s.tool === "build" && s.buildOpts.mode === "select") this.pasteObjects(this.clip);
        }, 60);
      }
      return;
    }
    if (e.altKey) return;
    if ((e.code === "BracketLeft" || e.code === "BracketRight") && st.tool === "fog" && st.fogOpts.shape === "brush") {
      // [ and ] size the fog brush (Shift: in bigger steps).
      const o = st.fogOpts;
      const delta = (e.code === "BracketLeft" ? -1 : 1) * (e.shiftKey ? 2 : 0.5);
      room.store.set({ fogOpts: { ...o, brush: Math.min(20, Math.max(0.5, o.brush + delta)) } });
      if (this.brushCursor.visible()) this.updateBrushCursor(this.brushCursor.position());
      return;
    }
    if ((e.code === "BracketLeft" || e.code === "BracketRight") && st.tool === "build") {
      // Building: [ and ] size the floor brush, or turn the next object (or the selected ones) 15 degrees, Shift 5.
      const o = st.buildOpts;
      const dir = e.code === "BracketLeft" ? -1 : 1;
      const deg = dir * (e.shiftKey ? 5 : 15);
      if ((o.mode === "building" || o.mode === "terrain") && o.shape[o.mode] === "brush") {
        room.store.set({ buildOpts: { ...o, brush: Math.min(5, Math.max(1, o.brush + dir)) } });
      } else if (o.mode === "stamps") {
        room.store.set({ buildOpts: { ...o, stampDeg: snapDeg(o.stampDeg + deg) } });
      } else if (selecting) {
        this.turnSelection(deg, this.burstKey());
      }
      return;
    }
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      const step = e.shiftKey ? 15 : 45;
      rotateSelection(room, e.code === "BracketLeft" ? -step : step);
      return;
    }
    if (selecting) {
      const nudge = e.shiftKey ? 5 : 1;
      switch (key) {
        case "Delete":
        case "Backspace":
          e.preventDefault();
          if (!e.repeat) this.deleteBuildSel();
          return;
        case "ArrowUp":
          e.preventDefault();
          this.nudgeBuild(0, -nudge);
          return;
        case "ArrowDown":
          e.preventDefault();
          this.nudgeBuild(0, nudge);
          return;
        case "ArrowLeft":
          e.preventDefault();
          this.nudgeBuild(-nudge, 0);
          return;
        case "ArrowRight":
          e.preventDefault();
          this.nudgeBuild(nudge, 0);
          return;
      }
    }
    switch (key) {
      case "Escape":
        if (room.state.gridAlign && this.gesture.kind === "none") room.store.set({ gridAlign: null });
        else if (this.wallPath && this.gesture.kind === "none") this.cancelWallPath();
        else if (this.poly) this.cancelPoly();
        else if (this.gesture.kind !== "none") this.cancelGesture();
        else if (this.buildSel.objects.length || this.buildSel.doors.length) this.clearBuildSelection();
        else room.select([]);
        return;
      case "Enter":
        if (this.wallPath) {
          e.preventDefault();
          this.finishWallPath();
        } else if (this.poly) {
          e.preventDefault();
          this.finishPoly();
        }
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (this.wallPath) {
          this.undoWallCorner();
        } else if (this.poly) {
          if (this.poly.points.length > 2) {
            this.poly.points.splice(-2, 2);
            this.poly.node.points(this.poly.points);
            this.uiLayer.batchDraw();
          } else {
            this.cancelPoly();
          }
        } else if (!e.repeat) {
          // (Not a held key that has just run out of corners to take back.)
          deleteSelection(room);
        }
        return;
      case "x":
      case "X": {
        // As in Dungeondraft: Build › Select, and X again goes back (not in the middle of a drag).
        const g = this.gesture.kind;
        if (e.shiftKey || e.repeat || (g !== "none" && g !== "tap")) return;
        room.toggleBuildSelect();
        return;
      }
      case "v":
      case "V":
        room.setTool("select");
        return;
      case "d":
      case "D":
        room.setTool("draw");
        return;
      case "e":
      case "E":
        room.setTool("erase");
        return;
      case "f":
      case "F":
        room.setTool("fog");
        return;
      case "b":
      case "B":
        room.setTool("build");
        return;
      case "m":
      case "M":
        room.setTool("measure");
        return;
      case "p":
      case "P":
        room.setTool("pointer");
        return;
      case "h":
      case "H":
        toggleHidden(room);
        return;
      case "l":
      case "L":
        toggleLocked(room);
        return;
      case "ArrowUp":
        e.preventDefault();
        nudgeSelection(room, 0, -1);
        return;
      case "ArrowDown":
        e.preventDefault();
        nudgeSelection(room, 0, 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        nudgeSelection(room, -1, 0);
        return;
      case "ArrowRight":
        e.preventDefault();
        nudgeSelection(room, 1, 0);
        return;
      case "+":
      case "=":
        this.zoomBy(1.25);
        return;
      case "-":
      case "_":
        this.zoomBy(0.8);
        return;
      case "0":
        this.fit();
        return;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === "Alt") {
      if (this.room.state.tool === "build") e.preventDefault();
      this.setAlt(false);
    }
    if (e.key === "z" || e.key === "Z") this.zDown = false;
    if (e.key === " ") {
      this.spaceDown = false;
      this.updateCursor();
    }
  };

  private updateCursor(): void {
    const g = this.gesture;
    if (g.kind === "pan" && g.moved) return;
    const s = this.room.state;
    const tool = s.tool;
    let cursor = "default";
    if (this.spaceDown) cursor = "grab";
    else if (tool === "build" && s.buildOpts.mode === "select") {
      // Select: a drag on an object moves it, and anywhere else draws a box.
      cursor = g.kind === "build-move-sel" ? "grabbing" : g.kind === "build-box" ? "crosshair" : this.hoverObject ? "move" : "default";
    } else if (tool === "draw" || tool === "fog" || tool === "build" || tool === "measure" || tool === "pointer") cursor = "crosshair";
    else if (tool === "erase") cursor = "cell";
    this.el.style.cursor = cursor;
  }
}

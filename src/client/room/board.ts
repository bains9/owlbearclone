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
import type { DrawShape, DrawingItem, FogItem, Item, ItemPatch, Scene, TokenItem } from "../../shared/types";
import { fileUrl } from "../api";
import {
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  rotateSelection,
  toggleHidden,
  toggleLocked,
} from "./actions";
import type { BoardApi, RoomClient, RoomState } from "./client";
import { getImage, imageFailed } from "./images";
import { isVttFile, looksLikeMap } from "../mapImport";

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FOG_COLOR = "#0b0d11";
const SELECT_COLOR = "#4fd1ff";
const MIN_SCALE = 0.03;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 5;
const EPH_INTERVAL = 40;
const TRAIL_MS = 900;
/** The fog is drawn once into an image at most this many pixels on its long side. */
const FOG_CACHE_MAX = 2560;
/** A brush stroke is stored in pieces of at most this many points. */
const STROKE_PIECE_POINTS = 1500;

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
  | { kind: "erase"; pointerId: number; ids: Set<string> }
  | { kind: "fog-rect"; pointerId: number; start: Point; end: Point; node: Konva.Rect }
  | { kind: "fog-lasso"; pointerId: number; points: number[]; node: Konva.Line }
  | { kind: "fog-paint"; pointerId: number; points: number[]; pieces: number[][]; width: number; node: Konva.Line }
  | { kind: "measure"; pointerId: number; shape: MeasureShape; start: Point; end: Point; lastEph: number }
  | { kind: "pointer"; pointerId: number; lastEph: number }
  /** A tap-style action (fog polygon corner, note) that happens on release, if it was a tap. */
  | { kind: "tap"; pointerId: number; start: Point; world: Point; action: "poly" | "note" }
  | { kind: "grid-align"; pointerId: number; start: Point; end: Point; node: Konva.Rect };

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
  private poly: { points: number[]; node: Konva.Line; start: Konva.Circle; mode: "hide" | "reveal" } | null = null;
  private anim: Konva.Animation;
  private cleanup: (() => void)[] = [];
  private zoomReport = 0;

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

    this.bgLayer.add(this.bgRect, this.mapNode, this.gridNode);
    this.fogLayer.add(this.fogNode);
    this.uiLayer.add(this.previewGroup, this.rulerGroup, this.trailNode, this.brushCursor);
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
    on(el, "pointerleave", () => this.updateBrushCursor(null));
    on(el, "wheel", this.onWheel, { passive: false });
    on(el, "contextmenu", (e) => e.preventDefault());
    on(el, "dragover", this.onDragOver);
    on(el, "drop", this.onDrop);
    on(window, "paste", this.onPaste as EventListener);
    on(window, "keydown", this.onKeyDown);
    on(window, "keyup", this.onKeyUp);
    on(window, "blur", () => {
      this.spaceDown = false;
      this.updateCursor();
    });

    const ro = new ResizeObserver(() => {
      this.stage.size({ width: el.clientWidth, height: el.clientHeight });
      if (this.needsFit) this.scheduleSync();
      this.stage.batchDraw();
    });
    ro.observe(el);
    this.cleanup.push(() => ro.disconnect());
    this.cleanup.push(room.store.subscribe(this.scheduleSync));
    this.cleanup.push(room.onEph(this.onEph));

    room.board = this;
    this.sync();
  }

  destroy(): void {
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
    const pad = Math.min(40, w * 0.05);
    // Keep the scene clear of the toolbar on the left.
    const left = 64;
    const availW = Math.max(40, w - left - pad);
    const availH = Math.max(40, h - pad * 2);
    const scale = clampScale(Math.min(availW / scene.width, availH / scene.height));
    this.setCam(left + (availW - scene.width * scale) / 2, (h - scene.height * scale) / 2, scale);
    this.needsFit = false;
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
      this.localRuler = null;
      this.renderRulers();
      this.renderedSceneId = sceneId;
      this.renderedScene = null;
      this.needsFit = true;
      force = true;
    }

    if (scene !== this.renderedScene) {
      const prev = this.renderedScene;
      this.renderedScene = scene;
      if (scene) {
        this.bgRect.size({ width: scene.width, height: scene.height });
        this.bgRect.fill(scene.background);
        this.updateMap(scene);
        if (!prev || prev.grid.size !== scene.grid.size) force = true;
      }
      this.bgLayer.visible(Boolean(scene));
      this.bgLayer.batchDraw();
      this.fogDirty = true;
      this.fogLayer.batchDraw();
    }

    if (this.needsFit && scene) {
      const saved = this.cameras.get(scene.id);
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
    if (this.poly && (s.tool !== "fog" || s.fogOpts.shape !== "poly" || s.fogOpts.mode !== this.poly.mode)) {
      this.cancelPoly();
    }
    this.updateCursor();
  }

  private updateMap(scene: Scene): void {
    if (!scene.mapAssetId) {
      this.mapNode.visible(false);
      return;
    }
    const img = getImage(fileUrl(this.room.roomId, scene.mapAssetId), () => {
      this.renderedScene = null;
      this.scheduleSync();
    });
    if (img) {
      this.mapNode.image(img);
      this.mapNode.size({ width: scene.width, height: scene.height });
      this.mapNode.visible(true);
    } else {
      this.mapNode.visible(false);
    }
  }

  private syncItems(s: RoomState, scene: Scene | null, force: boolean, gmView: boolean): void {
    const sel = new Set(s.selection);
    const cell = scene?.grid.size ?? 70;
    const tokens: TokenItem[] = [];
    const drawings: DrawingItem[] = [];
    const fogs: FogItem[] = [];
    for (const item of Object.values(s.items)) {
      if (item.sceneId !== this.renderedSceneId) continue;
      if (item.kind === "token") tokens.push(item);
      else if (item.kind === "drawing") drawings.push(item);
      else fogs.push(item);
    }
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
    const scale = this.stage.scaleX();
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    for (const trail of this.trails.values()) {
      const pts = trail.points;
      if (!pts.length) continue;
      c.strokeStyle = trail.color;
      c.fillStyle = trail.color;
      c.lineWidth = 6 / scale;
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
      c.arc(head.x, head.y, 8 / scale, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  private tick(): void {
    const now = performance.now();
    let active = false;
    for (const [id, trail] of this.trails) {
      trail.points = trail.points.filter((p) => now - p.t < TRAIL_MS);
      if (trail.points.length) active = true;
      else this.trails.delete(id);
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
    if (e.k === "pointer") {
      this.addTrail(from, this.colorOf(from), e);
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

    if (e.pointerType === "mouse" && (e.button === 1 || e.button === 2)) {
      const hit = e.button === 2 && !this.fogged(pos) ? this.itemAt(pos) : null;
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
        this.gesture = { kind: "erase", pointerId: e.pointerId, ids: new Set() };
        this.eraseAt(this.gesture, pos);
        return;
      case "fog":
        if (!this.isGm) return;
        this.fogDown(e.pointerId, world);
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
        this.gesture = { kind: "pointer", pointerId: e.pointerId, lastEph: 0 };
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
    if (e.pointerType === "mouse") this.updateBrushCursor(world);
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
          // It's a drag, not a tap: pan instead.
          this.gesture = { kind: "pan", pointerId: g.pointerId, start: g.start, cam: this.cam, moved: false };
        }
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
        this.addTrail("me", this.room.state.me?.color ?? "#fff", world);
        if (now - g.lastEph > 30) {
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
        if (g.action === "poly") {
          this.polyClick(g.world);
        } else {
          // Font size follows the line-width setting, sized for how zoomed in you are right now.
          const fontSize = round2((12 + this.room.state.drawOpts.width * 2) / this.cam.scale);
          this.room.store.set({ textPrompt: { x: round2(g.world.x), y: round2(g.world.y), fontSize } });
        }
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
        for (const id of g.ids) this.drawings.get(id)?.shape.show();
        this.drawLayer.batchDraw();
        break;
      case "measure":
        this.localRuler = null;
        this.renderRulers();
        if (this.renderedSceneId) this.room.sendEph({ k: "ruler", sceneId: this.renderedSceneId, points: null });
        break;
      default:
        break;
    }
    this.updateCursor();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const pos = this.localPos(e);
    let dy = e.deltaY;
    let dx = e.deltaX;
    if (e.deltaMode === 1) {
      dy *= 33;
      dx *= 33;
    } else if (e.deltaMode === 2) {
      dy *= 400;
      dx *= 400;
    }
    if (e.ctrlKey) {
      // Trackpad pinch (browsers report it as ctrl+wheel).
      this.zoomAt(pos, Math.exp(-dy * 0.01));
      return;
    }
    const looksLikeTrackpadScroll = e.deltaMode === 0 && (Math.abs(dx) > 0 || Math.abs(dy) < 40);
    if (looksLikeTrackpadScroll) {
      const c = this.cam;
      this.setCam(c.x - dx, c.y - dy, c.scale);
      return;
    }
    this.zoomAt(pos, Math.exp(-dy * 0.0015));
  };

  private onDragOver = (e: DragEvent): void => {
    const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
    if (types.includes("application/x-tabletop-asset") || types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    }
  };

  private onDrop = (e: DragEvent): void => {
    e.preventDefault();
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

  /** An image pasted from the clipboard: a map for a new scene, or a token in the middle of the view. */
  private onPaste = (e: ClipboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (document.querySelector(".modal-backdrop") || !this.renderedScene) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    void this.takeFiles(files, this.viewCenter());
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
      else if (isVttFile(f) || /\.(ob2|owlbear)$/i.test(f.name)) this.room.toast("Only the GM can add maps.", "error");
    }
    if (maps.length) this.room.store.set({ mapImport: maps });
    if (tokens.length && at) void this.room.uploadTokens(tokens, at);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (document.querySelector(".modal-backdrop")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (key === " ") {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.updateCursor();
      }
      e.preventDefault();
      return;
    }
    if (mod) {
      const k = key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) this.room.redo();
        else this.room.undo();
      } else if (k === "y") {
        e.preventDefault();
        this.room.redo();
      } else if (k === "d") {
        e.preventDefault();
        duplicateSelection(this.room);
      }
      return;
    }
    if (e.altKey) return;
    const room = this.room;
    if ((e.code === "BracketLeft" || e.code === "BracketRight") && room.state.tool === "fog" && room.state.fogOpts.shape === "brush") {
      // [ and ] size the fog brush (Shift: in bigger steps).
      const o = room.state.fogOpts;
      const delta = (e.code === "BracketLeft" ? -1 : 1) * (e.shiftKey ? 2 : 0.5);
      room.store.set({ fogOpts: { ...o, brush: Math.min(20, Math.max(0.5, o.brush + delta)) } });
      if (this.brushCursor.visible()) this.updateBrushCursor(this.brushCursor.position());
      return;
    }
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      const step = e.shiftKey ? 15 : 45;
      rotateSelection(room, e.code === "BracketLeft" ? -step : step);
      return;
    }
    switch (key) {
      case "Escape":
        if (room.state.gridAlign && this.gesture.kind === "none") room.store.set({ gridAlign: null });
        else if (this.poly) this.cancelPoly();
        else if (this.gesture.kind !== "none") this.cancelGesture();
        else room.select([]);
        return;
      case "Enter":
        if (this.poly) {
          e.preventDefault();
          this.finishPoly();
        }
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (this.poly) {
          if (this.poly.points.length > 2) {
            this.poly.points.splice(-2, 2);
            this.poly.node.points(this.poly.points);
            this.uiLayer.batchDraw();
          } else {
            this.cancelPoly();
          }
        } else {
          deleteSelection(room);
        }
        return;
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
    if (e.key === " ") {
      this.spaceDown = false;
      this.updateCursor();
    }
  };

  private updateCursor(): void {
    if (this.gesture.kind === "pan" && this.gesture.moved) return;
    const tool = this.room.state.tool;
    let cursor = "default";
    if (this.spaceDown) cursor = "grab";
    else if (tool === "draw" || tool === "fog" || tool === "measure" || tool === "pointer") cursor = "crosshair";
    else if (tool === "erase") cursor = "cell";
    this.el.style.cursor = cursor;
  }
}

import { useEffect, useRef, useState } from "preact/hooks";
import {
  ArrowLeft,
  Armchair,
  BrickWall,
  Castle,
  ClipboardPaste,
  Copy,
  CopyPlus,
  DoorOpen,
  Expand,
  FileUp,
  Hammer,
  Lasso,
  RedoDot,
  RotateCcw,
  RotateCw,
  Shrink,
  SquareDashedMousePointer,
  Trash,
  Trees,
  X,
  Paintbrush,
  Circle,
  CloudFog,
  Eraser,
  Eye,
  EyeOff,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Pentagon,
  Plus,
  Pointer,
  RectangleHorizontal,
  Redo2,
  Ruler,
  Slash,
  Square,
  Triangle,
  Type,
  Undo2,
} from "lucide-preact";
import { isHex } from "../../shared/geometry";
import type { MeasureShape } from "../../shared/protocol";
import {
  FLOORS,
  STAMP_DEG_STEP,
  STAMP_IDS,
  STAMP_NAMES,
  STAMP_SIZE_MAX,
  STAMP_SIZE_MIN,
  STAMP_SIZE_STEP,
  snapDeg,
  snapSize,
} from "../../shared/terrain";
import type { FloorId, StampId } from "../../shared/terrain";
import { DD_UI } from "./ddText";
import type { DrawShape } from "../../shared/types";
import { buildUndo, wallsFor } from "../room/build";
import { drawStamp, floorPattern } from "../room/buildArt";
import {
  BUILD_MODE_LABELS,
  TOUCH_HINTS,
  backLabel,
  buildHints,
  formatDeg,
  formatSize,
  isMacPlatform,
  selectionStatus,
} from "../room/buildInput";
import type { BuildAction, BuildOptions as BuildOpts, ToolId } from "../room/client";
import { ConfirmDialog, Swatches, cx, useRoom, useRoomState } from "./common";

const TOOLS: { id: ToolId; label: string; key: string; icon: typeof Pencil; gm?: boolean }[] = [
  { id: "select", label: "Move & select", key: "V", icon: MousePointer2 },
  { id: "draw", label: "Draw", key: "D", icon: Pencil },
  { id: "erase", label: "Eraser: drawings, notes and tokens", key: "E", icon: Eraser },
  { id: "fog", label: "Fog of war", key: "F", icon: CloudFog, gm: true },
  { id: "build", label: "Build the map: floors, walls, doors, objects", key: "B", icon: Hammer, gm: true },
  { id: "measure", label: "Measure", key: "M", icon: Ruler },
  { id: "pointer", label: "Pointer", key: "P", icon: Pointer },
];

export const DRAW_COLORS = ["#ffffff", "#111111", "#e4572e", "#f3a712", "#e8d33f", "#5bba6f", "#4f9dde", "#b45fd6"];
const WIDTHS = [2, 4, 8, 16];

export function Toolbar() {
  const room = useRoom();
  const tool = useRoomState((s) => s.tool);
  const gm = useRoomState((s) => s.me?.role === "gm");
  const canUndo = useRoomState((s) => s.canUndo);
  const canRedo = useRoomState((s) => s.canRedo);
  return (
    <div class="toolbar" role="toolbar" aria-label="Tools">
      {TOOLS.filter((t) => !t.gm || gm).map((t) => (
        <button
          key={t.id}
          class={cx("tool", tool === t.id && "active")}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => room.setTool(t.id)}
        >
          <t.icon size={20} />
        </button>
      ))}
      <div class="toolbar-sep" />
      <button class="tool" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={() => room.undo()}>
        <Undo2 size={20} />
      </button>
      <button class="tool" title="Redo (Ctrl+Y or Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={() => room.redo()}>
        <Redo2 size={20} />
      </button>
    </div>
  );
}

export function ToolOptions() {
  const tool = useRoomState((s) => s.tool);
  if (tool === "draw") return <DrawOptions />;
  if (tool === "fog") return <FogOptions />;
  if (tool === "build") return <BuildOptions />;
  if (tool === "erase") return <EraseOptions />;
  if (tool === "measure") return <MeasureHint />;
  if (tool === "pointer") return <div class="tool-options hint">Hold and drag to point; click to ping a spot. Everyone sees it, table display too.</div>;
  return null;
}

const SHAPES: { id: DrawShape; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Freehand", icon: Pencil },
  { id: "line", label: "Line", icon: Slash },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "text", label: "Text note: click where it goes", icon: Type },
];

function DrawOptions() {
  const room = useRoom();
  const o = useRoomState((s) => s.drawOpts);
  const set = (patch: Partial<typeof o>) => room.store.set({ drawOpts: { ...o, ...patch } });
  return (
    <div class="tool-options">
      <div class="seg">
        {SHAPES.map((sh) => (
          <button
            key={sh.id}
            class={cx("seg-btn", o.shape === sh.id && "active")}
            title={sh.label}
            aria-label={sh.label}
            onClick={() => set({ shape: sh.id })}
          >
            <sh.icon size={16} />
          </button>
        ))}
      </div>
      <Swatches colors={DRAW_COLORS} value={o.color} onPick={(color) => set({ color })} size="sm" custom />
      <div class="seg">
        {WIDTHS.map((w) => (
          <button
            key={w}
            class={cx("seg-btn", o.width === w && "active")}
            title={`${w}px line`}
            aria-label={`${w} pixel line`}
            onClick={() => set({ width: w })}
          >
            <span class="width-dot" style={{ width: `${Math.min(16, w + 2)}px`, height: `${Math.min(16, w + 2)}px` }} />
          </button>
        ))}
      </div>
      {(o.shape === "rect" || o.shape === "ellipse") && (
        <label class="check">
          <input type="checkbox" checked={o.fill} onChange={(e) => set({ fill: e.currentTarget.checked })} /> Fill
        </label>
      )}
    </div>
  );
}

function FogOptions() {
  const room = useRoom();
  const o = useRoomState((s) => s.fogOpts);
  const scene = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : null));
  const [confirm, setConfirm] = useState<null | "cover" | "clear">(null);
  const set = (patch: Partial<typeof o>) => room.store.set({ fogOpts: { ...o, ...patch } });
  const reset = (cover: boolean) => {
    if (!scene) return;
    room.resetFog(scene.id, cover);
    if (cover) set({ mode: "reveal" });
  };
  return (
    <div class="tool-options">
      <div class="seg">
        <button class={cx("seg-btn wide", o.mode === "reveal" && "active")} onClick={() => set({ mode: "reveal" })}>
          Reveal
        </button>
        <button class={cx("seg-btn wide", o.mode === "hide" && "active")} onClick={() => set({ mode: "hide" })}>
          Hide
        </button>
      </div>
      <div class="seg">
        <button
          class={cx("seg-btn", o.shape === "brush" && "active")}
          title="Brush: drag to paint (resize with [ and ])"
          aria-label="Brush"
          onClick={() => set({ shape: "brush" })}
        >
          <Paintbrush size={16} />
        </button>
        <button
          class={cx("seg-btn", o.shape === "rect" && "active")}
          title="Rectangle"
          aria-label="Rectangle"
          onClick={() => set({ shape: "rect" })}
        >
          <Square size={16} />
        </button>
        <button
          class={cx("seg-btn", o.shape === "poly" && "active")}
          title="Polygon: click the corners, then click the first point or press Enter"
          aria-label="Polygon"
          onClick={() => set({ shape: "poly" })}
        >
          <Pentagon size={16} />
        </button>
        <button
          class={cx("seg-btn", o.shape === "lasso" && "active")}
          title="Lasso: trace around an area"
          aria-label="Lasso"
          onClick={() => set({ shape: "lasso" })}
        >
          <Lasso size={16} />
        </button>
      </div>
      {o.shape === "brush" && (
        <label class="brush-size" title="Brush size in squares ([ and ] change it)">
          <input
            type="range"
            min={0.5}
            max={20}
            step={0.5}
            value={o.brush}
            onInput={(e) => set({ brush: Number(e.currentTarget.value) })}
            aria-label="Brush size"
          />
          <span class="brush-size-value">{o.brush} sq</span>
        </label>
      )}
      {(o.shape === "rect" || o.shape === "poly") && (
        <label class="check" title="Snap corners to the grid">
          <input type="checkbox" checked={o.snap} onChange={(e) => set({ snap: e.currentTarget.checked })} /> Snap
        </label>
      )}
      <button
        class={cx("seg-btn wide", o.preview && "active")}
        title="See the fog exactly as players do"
        onClick={() => set({ preview: !o.preview })}
      >
        {o.preview ? <EyeOff size={16} /> : <Eye size={16} />} Player view
      </button>
      <button class="btn btn-sm" onClick={() => setConfirm("cover")}>
        Cover all
      </button>
      <button class="btn btn-sm" onClick={() => setConfirm("clear")}>
        Clear all
      </button>
      {confirm && (
        <ConfirmDialog
          title={confirm === "cover" ? "Cover the whole map?" : "Remove all fog?"}
          message={
            confirm === "cover"
              ? "The whole scene goes dark for players. Then use Reveal to open up areas as they explore. Undo puts the fog back the way it was."
              : "Players will see the whole scene. Undo puts the fog back the way it was."
          }
          confirmLabel={confirm === "cover" ? "Cover all" : "Clear all"}
          onConfirm={() => reset(confirm === "cover")}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/**
 * The Build tool's modes, named and ordered after the Dungeondraft tools the GM knows:
 * Building, Wall, Portal (doors), Terrain, Object, Select.
 */
const BUILD_MODES: { id: BuildOpts["mode"]; label: string; title: string; icon: typeof Pencil }[] = [
  { id: "building", label: BUILD_MODE_LABELS.building, title: "Building: rooms with walls round them (like Dungeondraft's Building tool)", icon: Castle },
  { id: "walls", label: BUILD_MODE_LABELS.walls, title: "Walls: along grid lines (like Dungeondraft's Wall tool)", icon: BrickWall },
  { id: "doors", label: BUILD_MODE_LABELS.doors, title: "Doors, secret doors and openings in walls (like Dungeondraft's Portal tool)", icon: DoorOpen },
  { id: "terrain", label: BUILD_MODE_LABELS.terrain, title: "Terrain: grass, water and lava, under buildings (like Dungeondraft's Terrain brush)", icon: Trees },
  { id: "stamps", label: BUILD_MODE_LABELS.stamps, title: "Objects: furniture and scenery (like Dungeondraft's Object tool)", icon: Armchair },
  {
    id: "select",
    label: BUILD_MODE_LABELS.select,
    title: "Select (X): click an object or door, or drag a box; then move, turn, size, copy or delete (like Dungeondraft's Select tool)",
    icon: SquareDashedMousePointer,
  },
];

const BUILDING_FLOORS = FLOORS.filter((f) => f.walls);
const TERRAIN_FLOORS = FLOORS.filter((f) => !f.walls);

/** Whether this is a Mac, where the zoom key is ⌘. */
const MAC = typeof navigator !== "undefined" && isMacPlatform(navigator.platform ?? "", navigator.userAgent ?? "");

/**
 * A slider that lets go of the keyboard when you let go of it, so X, Delete, [ ] and the
 * arrow keys still reach the map (they're ignored while a slider has the focus).
 */
function Slider(props: { min: number; max: number; step: number; value: number; label: string; onInput: (v: number) => void }) {
  const blur = (e: Event) => (e.currentTarget as HTMLInputElement).blur();
  return (
    <input
      type="range"
      class="build-slider"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      aria-label={props.label}
      onInput={(e) => props.onInput(Number(e.currentTarget.value))}
      onPointerUp={blur}
      onChange={blur}
    />
  );
}
/** A small picture of an object, for the palette. */
function StampIcon(props: { id: StampId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const px = 26 * (window.devicePixelRatio || 1);
    canvas.width = px;
    canvas.height = px;
    ctx.setTransform(px, 0, 0, px, px / 2, px / 2);
    drawStamp(ctx, props.id);
  }, [props.id]);
  return <canvas ref={ref} class="stamp-icon" aria-hidden="true" />;
}

/** A swatch of a floor's texture. */
function FloorIcon(props: { id: FloorId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const px = 22 * (window.devicePixelRatio || 1);
    canvas.width = px;
    canvas.height = px;
    ctx.fillStyle = floorPattern(ctx, props.id, px, 0, 0);
    ctx.fillRect(0, 0, px, px);
  }, [props.id]);
  return <canvas ref={ref} class="floor-icon" aria-hidden="true" />;
}

/**
 * Brings a Dungeondraft export, and for exact seasons its project file, in as a new scene (through
 * the new-scene window). No accept filter: iOS and iPadOS grey out .dungeondraft_map files otherwise.
 */
function ImportDungeondraft() {
  const room = useRoom();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button class="btn btn-sm" title={DD_UI.importTitle} aria-label="Import Dungeondraft map" onClick={() => fileRef.current?.click()}>
        <FileUp size={14} /> <span class="seg-label">Import Dungeondraft map</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (files.length) room.store.set({ mapImport: files });
        }}
      />
    </>
  );
}

function BuildOptions() {
  const room = useRoom();
  const o = useRoomState((s) => s.buildOpts);
  const sel = useRoomState((s) => s.buildSel);
  const clip = useRoomState((s) => s.buildClip);
  const scene = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : null));
  const live = useRoomState((s) => !!s.viewSceneId && s.viewSceneId === s.activeSceneId);
  const [confirm, setConfirm] = useState(false);
  if (!scene) {
    return (
      <div class="tool-options build-options">
        <ImportDungeondraft />
      </div>
    );
  }
  const set = (patch: Partial<BuildOpts>) => room.store.set({ buildOpts: { ...room.state.buildOpts, ...patch } });
  if (isHex(scene.grid)) {
    return (
      <div class="tool-options build-options">
        <span class="hint hex-note">Building works on a square grid. Switch this scene to squares in Edit scene (Scenes panel).</span>
        <ImportDungeondraft />
      </div>
    );
  }
  const walls = wallsFor(scene, o.walls);
  const clear = () => {
    const items = room.state.items;
    const ids = Object.values(items)
      .filter((i) => i.kind === "terrain" && i.sceneId === scene.id)
      .map((i) => i.id);
    if (ids.length) room.changeWith({ delete: ids }, scene.id, buildUndo(items, scene.id, { delete: ids }));
  };
  const paint = o.mode === "building" || o.mode === "terrain" ? o.mode : null;
  return (
    <div class="tool-options build-options">
      <div class="seg build-modes">
        {BUILD_MODES.map((m) => (
          <button
            key={m.id}
            class={cx("seg-btn wide", o.mode === m.id && "active")}
            title={m.title}
            aria-label={m.label}
            aria-pressed={o.mode === m.id}
            onClick={() => room.setBuildMode(m.id)}
          >
            <m.icon size={16} />
            <span class="seg-label">{m.label}</span>
          </button>
        ))}
      </div>
      {paint && (
        <>
          <div class="seg" role="group" aria-label="Shape">
            {(
              [
                ["rect", "Rectangle: drag from corner to corner", Square],
                ["circle", "Oval: drag from corner to corner", Circle],
                [
                  "brush",
                  paint === "building"
                    ? "Brush: paint square by square, like Dungeondraft's Cave brush ([ and ] change its size)"
                    : "Brush: paint square by square ([ and ] change its size)",
                  Paintbrush,
                ],
              ] as const
            ).map(([id, title, Icon]) => (
              <button
                key={id}
                class={cx("seg-btn", o.shape[paint] === id && "active")}
                title={title}
                aria-label={title.split(":")[0]}
                aria-pressed={o.shape[paint] === id}
                onClick={() => set({ shape: { ...o.shape, [paint]: id } })}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          <div class="floor-swatches" role="group" aria-label="Floor">
            {(paint === "building" ? BUILDING_FLOORS : TERRAIN_FLOORS).map((f) => (
              <button
                key={f.id}
                class={cx("floor-swatch", o.floor[paint] === f.id && "active")}
                title={f.name}
                aria-label={f.name}
                aria-pressed={o.floor[paint] === f.id}
                onClick={() => set({ floor: { ...o.floor, [paint]: f.id } })}
              >
                <FloorIcon id={f.id} />
              </button>
            ))}
            <button
              class={cx("floor-swatch erase", o.floor[paint] === "erase" && "active")}
              title={
                paint === "building"
                  ? "Erase rooms: their floor, and the walls, doors and objects on it (or hold Alt while you drag)"
                  : "Erase terrain: grass, water and lava only (or hold Alt while you drag)"
              }
              aria-label="Erase"
              aria-pressed={o.floor[paint] === "erase"}
              onClick={() => set({ floor: { ...o.floor, [paint]: "erase" } })}
            >
              <Eraser size={14} />
            </button>
          </div>
          {o.shape[paint] === "brush" && (
            <div class="seg" role="group" aria-label="Brush size" title="Brush size in squares ([ and ] change it)">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  class={cx("seg-btn", o.brush === n && "active")}
                  aria-label={`${n} square brush`}
                  aria-pressed={o.brush === n}
                  onClick={() => set({ brush: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {paint === "building" && (
            <div
              class="seg"
              role="group"
              aria-label="Wall"
              title="Walls round the rooms you paint from now on, where they meet empty space, grass, water or lava. No wall: patch an uploaded map without walling the patch in."
            >
              <button
                class={cx("seg-btn", !walls && "active")}
                aria-label="No wall"
                aria-pressed={!walls}
                title="No wall"
                onClick={() => set({ walls: { ...o.walls, [scene.id]: false } })}
              >
                <X size={16} />
              </button>
              <button
                class={cx("seg-btn", walls && "active")}
                aria-label="Wall"
                aria-pressed={walls}
                title="Wall"
                onClick={() => set({ walls: { ...o.walls, [scene.id]: true } })}
              >
                <BrickWall size={16} />
              </button>
            </div>
          )}
        </>
      )}
      {o.mode === "walls" && (
        <div class="seg">
          <button class={cx("seg-btn wide", o.wallMode === "add" && "active")} onClick={() => set({ wallMode: "add" })}>
            Add
          </button>
          <button class={cx("seg-btn wide", o.wallMode === "remove" && "active")} onClick={() => set({ wallMode: "remove" })}>
            Remove
          </button>
        </div>
      )}
      {o.mode === "doors" && (
        <div class="seg" role="group" aria-label="Style">
          <button
            class={cx("seg-btn", o.doorStyle === "open" && "active")}
            title="Opening: a gap in the wall, an archway"
            aria-label="Opening"
            aria-pressed={o.doorStyle === "open"}
            onClick={() => set({ doorStyle: "open" })}
          >
            <X size={16} />
          </button>
          <button
            class={cx("seg-btn wide", o.doorStyle === "door" && "active")}
            title="Door"
            aria-label="Door"
            aria-pressed={o.doorStyle === "door"}
            onClick={() => set({ doorStyle: "door" })}
          >
            <DoorOpen size={16} /> <span class="seg-label">Door</span>
          </button>
          <button
            class={cx("seg-btn wide", o.doorStyle === "secret" && "active")}
            title="Secret door: players see a wall"
            aria-label="Secret door"
            aria-pressed={o.doorStyle === "secret"}
            onClick={() => set({ doorStyle: "secret" })}
          >
            <span class="secret-mark">S</span> <span class="seg-label">Secret</span>
          </button>
        </div>
      )}
      {o.mode === "stamps" && (
        <>
          <div class="seg">
            <button class={cx("seg-btn wide", o.stampMode === "place" && "active")} onClick={() => set({ stampMode: "place" })}>
              Place
            </button>
            <button class={cx("seg-btn wide", o.stampMode === "remove" && "active")} onClick={() => set({ stampMode: "remove" })}>
              Remove
            </button>
          </div>
          <div class="stamp-palette" role="group" aria-label="Objects">
            {STAMP_IDS.map((id) => (
              <button
                key={id}
                class={cx("stamp-btn", o.stamp === id && o.stampMode === "place" && "active")}
                title={STAMP_NAMES[id]}
                aria-label={STAMP_NAMES[id]}
                aria-pressed={o.stamp === id && o.stampMode === "place"}
                onClick={() => set({ stamp: id, stampMode: "place" })}
              >
                <StampIcon id={id} />
              </button>
            ))}
          </div>
          <div class="seg build-size" role="group" aria-label="Size in squares" title="Size in squares (Alt+wheel)">
            <span class="seg-label build-group-label">Size</span>
            <button
              class="seg-btn"
              title="Smaller (Alt+wheel)"
              aria-label="Smaller"
              disabled={o.stampSize <= STAMP_SIZE_MIN}
              onClick={() => set({ stampSize: snapSize(o.stampSize - STAMP_SIZE_STEP) })}
            >
              <Minus size={14} />
            </button>
            <Slider
              min={STAMP_SIZE_MIN}
              max={STAMP_SIZE_MAX}
              step={STAMP_SIZE_STEP}
              value={o.stampSize}
              label="Size"
              onInput={(v) => set({ stampSize: snapSize(v) })}
            />
            <button
              class="seg-btn"
              title="Bigger (Alt+wheel)"
              aria-label="Bigger"
              disabled={o.stampSize >= STAMP_SIZE_MAX}
              onClick={() => set({ stampSize: snapSize(o.stampSize + STAMP_SIZE_STEP) })}
            >
              <Plus size={14} />
            </button>
            <span class="build-readout">{formatSize(o.stampSize)}</span>
          </div>
          <div class="seg build-turn" role="group" aria-label="Turn" title="Turn (mouse wheel; Z and the wheel: 5°)">
            <span class="seg-label build-group-label">Turn</span>
            <button
              class="seg-btn"
              title="Turn left 15° ([)"
              aria-label="Turn left 15°"
              onClick={() => set({ stampDeg: snapDeg(o.stampDeg - 15) })}
            >
              <RotateCcw size={14} />
            </button>
            <Slider
              min={0}
              max={360 - STAMP_DEG_STEP}
              step={STAMP_DEG_STEP}
              value={o.stampDeg}
              label="Turn"
              onInput={(v) => set({ stampDeg: snapDeg(v) })}
            />
            <button
              class="seg-btn"
              title="Turn right 15° (])"
              aria-label="Turn right 15°"
              onClick={() => set({ stampDeg: snapDeg(o.stampDeg + 15) })}
            >
              <RotateCw size={14} />
            </button>
            <span class="build-readout">{formatDeg(o.stampDeg)}</span>
          </div>
          <button
            class="seg-btn stamp-turn"
            title="Turn 90° (right-click)"
            aria-label="Turn 90°"
            onClick={() => set({ stampDeg: snapDeg(o.stampDeg + 90) })}
          >
            <RotateCw size={16} style={{ transform: `rotate(${o.stampDeg}deg)` }} />
          </button>
        </>
      )}
      {o.mode === "select" && (
        <SelectOptions sel={sel} clip={clip} back={backLabel(o.selectReturn)} act={(a) => room.board?.buildAction(a)} />
      )}
      <span class="hint build-touch-hint">
        {o.mode === "stamps" && o.stampMode === "remove" ? "Tap an object to remove it." : TOUCH_HINTS[o.mode]}
      </span>
      {live && <span class="hint build-live">Players see this scene as you build.</span>}
      <ImportDungeondraft />
      <button class="btn btn-sm" onClick={() => setConfirm(true)}>
        Clear build
      </button>
      {confirm && (
        <ConfirmDialog
          title="Clear everything built here?"
          message="Every floor, wall, door and object built on this scene is removed. Undo brings them back."
          confirmLabel="Clear build"
          onConfirm={clear}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );
}

/**
 * Build › Select's part of the bar: what's selected, and buttons for what the mouse and keys
 * do to it (greyed out when they don't apply, so the bar keeps its size as Dungeondraft's
 * does). On a phone or tablet only Copy, Paste and Back stay here: BuildSelectionBar has the
 * rest. Copy stays beside Paste, since without keys it's the only way to copy objects.
 */
function SelectOptions(props: {
  sel: { objects: number; doors: number; canGrow: boolean; canShrink: boolean };
  clip: boolean;
  back: string;
  act: (a: BuildAction) => void;
}) {
  const room = useRoom();
  const { sel, act } = props;
  const none = !sel.objects;
  return (
    <>
      <span class="build-sel-status build-sel-more" aria-live="polite">
        {selectionStatus(sel)}
      </span>
      <div class="seg build-sel-more" role="group" aria-label="Turn">
        <button class="seg-btn" title="Turn left 15° (wheel up, [)" aria-label="Turn left 15°" disabled={none} onClick={() => act("turnLeft")}>
          <RotateCcw size={14} /> <span class="build-deg">15°</span>
        </button>
        <button class="seg-btn" title="Turn right 15° (wheel down, ])" aria-label="Turn right 15°" disabled={none} onClick={() => act("turnRight")}>
          <RotateCw size={14} /> <span class="build-deg">15°</span>
        </button>
        <button class="seg-btn" title="Turn 90° (right-click)" aria-label="Turn 90°" disabled={none} onClick={() => act("turn90")}>
          <RedoDot size={14} /> <span class="build-deg">90°</span>
        </button>
      </div>
      <div class="seg build-sel-more" role="group" aria-label="Size">
        <button class="seg-btn" title="Smaller (Alt+wheel)" aria-label="Smaller" disabled={!sel.canShrink} onClick={() => act("smaller")}>
          <Shrink size={16} />
        </button>
        <button class="seg-btn" title="Bigger (Alt+wheel)" aria-label="Bigger" disabled={!sel.canGrow} onClick={() => act("bigger")}>
          <Expand size={16} />
        </button>
      </div>
      <div class="seg" role="group" aria-label="Edit">
        <button class="seg-btn build-sel-more" title="Duplicate (Ctrl+D)" aria-label="Duplicate" disabled={none} onClick={() => act("duplicate")}>
          <CopyPlus size={16} />
        </button>
        <button class="seg-btn" title="Copy (Ctrl+C)" aria-label="Copy" disabled={none} onClick={() => act("copy")}>
          <Copy size={16} />
        </button>
        <button
          class="seg-btn"
          title="Paste the objects you copied (Ctrl+V also pastes objects copied in another tab or room)"
          aria-label="Paste"
          disabled={!props.clip}
          onClick={() => act("paste")}
        >
          <ClipboardPaste size={16} />
        </button>
        <button
          class="seg-btn build-sel-more"
          title="Delete (Del)"
          aria-label="Delete"
          disabled={none && !sel.doors}
          onClick={() => act("delete")}
        >
          <Trash size={16} />
        </button>
      </div>
      <button class="seg-btn wide" title={`Back to ${props.back} (X)`} aria-label={`Back to ${props.back}`} onClick={() => room.toggleBuildSelect()}>
        <ArrowLeft size={16} /> <span class="seg-label">Back</span>
      </button>
    </>
  );
}

/**
 * Build › Select on a phone or tablet (or a narrow window): the selection's buttons in a bar
 * along the bottom, like the one for tokens, since there's no wheel, right-click or keys.
 */
export function BuildSelectionBar() {
  const room = useRoom();
  const shown = useRoomState((s) => s.tool === "build" && s.buildOpts.mode === "select" && s.me?.role === "gm");
  const sel = useRoomState((s) => s.buildSel);
  const count = sel.objects + sel.doors;
  if (!shown || !count) return null;
  const act = (a: BuildAction) => room.board?.buildAction(a);
  return (
    <div class="selbar build-selbar" onPointerDown={(e) => e.stopPropagation()}>
      {sel.objects > 0 && (
        <>
          <button class="icon-btn" title="Turn 90°" aria-label="Turn 90°" onClick={() => act("turn90")}>
            <RedoDot size={18} />
          </button>
          <button class="icon-btn" title="Turn 15°" aria-label="Turn 15°" onClick={() => act("turnRight")}>
            <RotateCw size={18} />
          </button>
          <button class="icon-btn" title="Smaller" aria-label="Smaller" disabled={!sel.canShrink} onClick={() => act("smaller")}>
            <Shrink size={18} />
          </button>
          <button class="icon-btn" title="Bigger" aria-label="Bigger" disabled={!sel.canGrow} onClick={() => act("bigger")}>
            <Expand size={18} />
          </button>
          <button class="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={() => act("duplicate")}>
            <CopyPlus size={18} />
          </button>
        </>
      )}
      <button class="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => act("delete")}>
        <Trash size={18} />
      </button>
      <button class="icon-btn" title="Select nothing" aria-label={`Select nothing (${count} selected)`} onClick={() => act("deselect")}>
        <X size={18} />
        <span class="badge build-selbar-count">{count}</span>
      </button>
    </div>
  );
}

/** Along the bottom on a computer: what the mouse and keys do in the current Build mode. */
export function BuildHints() {
  const tool = useRoomState((s) => s.tool);
  const gm = useRoomState((s) => s.me?.role === "gm");
  const o = useRoomState((s) => s.buildOpts);
  const sel = useRoomState((s) => s.buildSel);
  const wheel = useRoomState((s) => s.wheelTurns);
  const selected = useRoomState((s) => s.selection.length > 0);
  const hex = useRoomState((s) => {
    const scene = s.viewSceneId ? s.scenes[s.viewSceneId] : null;
    return !scene || isHex(scene.grid);
  });
  if (tool !== "build" || !gm || selected || hex) return null;
  return (
    <div class="build-hints" aria-hidden="true">
      {buildHints(o, sel, { mac: MAC, wheel, backLabel: backLabel(o.selectReturn) }).map(([keys, what], i) => (
        <span key={i}>
          <kbd>{keys}</kbd> {what}
        </span>
      ))}
    </div>
  );
}

function EraseOptions() {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const [confirm, setConfirm] = useState(false);
  const clear = () => {
    const s = room.state;
    const ids = Object.values(s.items)
      .filter((i) => i.kind === "drawing" && i.sceneId === s.viewSceneId && (gm || i.owner === s.me?.userId))
      .map((i) => i.id);
    if (ids.length) room.change({ delete: ids });
  };
  return (
    <div class="tool-options">
      <span class="hint">Drag over drawings, notes or tokens to erase them. Locked tokens stay put.</span>
      <button class="btn btn-sm" onClick={() => setConfirm(true)}>
        {gm ? "Clear all drawings" : "Clear my drawings"}
      </button>
      {confirm && (
        <ConfirmDialog
          title={gm ? "Clear all drawings?" : "Clear your drawings?"}
          message={gm ? "Every drawing on this scene is removed. Undo brings them back." : "Undo brings them back."}
          confirmLabel="Clear"
          onConfirm={clear}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );
}

const MEASURE_TOOLS: { id: MeasureShape; label: string; icon: typeof Pencil }[] = [
  { id: "ruler", label: "Ruler", icon: Ruler },
  { id: "circle", label: "Circle (radius from a point)", icon: Circle },
  { id: "cone", label: "Cone", icon: Triangle },
  { id: "square", label: "Cube", icon: Square },
  { id: "beam", label: "Line (one square wide)", icon: RectangleHorizontal },
];

function MeasureHint() {
  const room = useRoom();
  const o = useRoomState((s) => s.measureOpts);
  const grid = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId]?.grid : undefined));
  if (!grid) return null;
  const set = (patch: Partial<typeof o>) => room.store.set({ measureOpts: { ...o, ...patch } });
  const hex = grid.type === "hex-pointy" || grid.type === "hex-flat";
  const rule = hex
    ? "counted in hexes"
    : grid.diagonal === "chebyshev"
      ? "diagonals count as one square"
      : grid.diagonal === "alternating"
        ? "diagonals alternate one and two squares"
        : "straight-line distance";
  return (
    <div class="tool-options">
      <div class="seg">
        {MEASURE_TOOLS.map((m) => (
          <button
            key={m.id}
            class={cx("seg-btn", o.shape === m.id && "active")}
            title={m.label}
            aria-label={m.label}
            onClick={() => set({ shape: m.id })}
          >
            <m.icon size={16} />
          </button>
        ))}
      </div>
      {o.shape !== "ruler" && (
        <label class="check" title="Leave the area on the map when you let go (erase it like a drawing)">
          <input type="checkbox" checked={o.keep} onChange={(e) => set({ keep: e.currentTarget.checked })} /> Pin to map
        </label>
      )}
      <span class="hint">
        {o.shape === "ruler" ? "Drag to measure." : "Drag from the spell's origin."} One {hex ? "hex" : "square"} is {grid.unit}{" "}
        {grid.unitName}; {rule}.
      </span>
    </div>
  );
}

export function ZoomControls() {
  const room = useRoom();
  const zoom = useRoomState((s) => s.zoom);
  return (
    <div class="zoom">
      <button class="tool" title="Zoom out (−)" aria-label="Zoom out" onClick={() => room.board?.zoomBy(0.8)}>
        <Minus size={18} />
      </button>
      <button class="zoom-level" title="Fit the scene (0)" onClick={() => room.board?.fit()}>
        {Math.round(zoom * 100)}%
      </button>
      <button class="tool" title="Zoom in (+)" aria-label="Zoom in" onClick={() => room.board?.zoomBy(1.25)}>
        <Plus size={18} />
      </button>
      <button class="tool" title="Fit the scene (0)" aria-label="Fit the scene" onClick={() => room.board?.fit()}>
        <Maximize size={18} />
      </button>
    </div>
  );
}

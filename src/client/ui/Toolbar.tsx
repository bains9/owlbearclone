import { useState } from "preact/hooks";
import {
  Lasso,
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
import type { MeasureShape } from "../../shared/protocol";
import type { DrawShape } from "../../shared/types";
import type { ToolId } from "../room/client";
import { ConfirmDialog, Swatches, cx, useRoom, useRoomState } from "./common";

const TOOLS: { id: ToolId; label: string; key: string; icon: typeof Pencil; gm?: boolean }[] = [
  { id: "select", label: "Move & select", key: "V", icon: MousePointer2 },
  { id: "draw", label: "Draw", key: "D", icon: Pencil },
  { id: "erase", label: "Eraser: drawings, notes and tokens", key: "E", icon: Eraser },
  { id: "fog", label: "Fog of war", key: "F", icon: CloudFog, gm: true },
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
      <button class="tool" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={() => room.redo()}>
        <Redo2 size={20} />
      </button>
    </div>
  );
}

export function ToolOptions() {
  const tool = useRoomState((s) => s.tool);
  if (tool === "draw") return <DrawOptions />;
  if (tool === "fog") return <FogOptions />;
  if (tool === "erase") return <EraseOptions />;
  if (tool === "measure") return <MeasureHint />;
  if (tool === "pointer") return <div class="tool-options hint">Hold and drag to point. Everyone sees the trail.</div>;
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

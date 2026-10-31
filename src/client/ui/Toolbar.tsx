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
  SprayCan,
  Eye,
  EyeOff,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Pentagon,
  Plus,
  Pointer,
  WandSparkles,
  RectangleHorizontal,
  Redo2,
  Ruler,
  Slash,
  Square,
  Triangle,
  Type,
  Undo2,
} from "lucide-preact";
import { formatDistance, isHex } from "../../shared/geometry";
import type { MeasureShape } from "../../shared/protocol";
import {
  STAMP_DEG_STEP,
  STAMP_SIZE_MAX,
  STAMP_SIZE_MIN,
  STAMP_SIZE_STEP,
  isDungeonStamp,
  isStampId,
  naturalStampSize,
  snapDeg,
  snapSize,
} from "../../shared/terrain";
import type { StampId } from "../../shared/terrain";
import { DD_UI } from "./ddText";
import { StampPicker } from "./StampPicker";
import { CONJURED_SPELLS, FX_GROUPS, FX_LOOKS, SPELL_FX, TOKEN_SPELLS, ZONE_SPELLS, castList, spellFx, tokenSpell, zoneSpell, type FxCast } from "../../shared/spellfx";
import { spellChipLabel } from "./spellChips";
import { characterLabel } from "../../shared/characters";
import { foldOf } from "./objectGroups";
import { SCATTER_BRUSHES, SCATTER_DENSITY_LABELS, type ScatterDensity } from "../room/scatter";
import { FloorPicker, WallPicker } from "./FloorPicker";
import { isFloorFor, type FloorChoice } from "./floorGroups";
import { RECENT_OBJECTS, loadRecent, recentFloorsKey, saveRecent, withRecent } from "./recentPicks";
import type { DrawShape, DrawingItem } from "../../shared/types";
import { canDelete } from "../../shared/permissions";
import { buildUndo, wallsFor } from "../room/build";
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
import { VoiceMicButton } from "./VoicePanel";

const TOOLS: { id: ToolId; label: string; key: string; icon: typeof Pencil; gm?: boolean }[] = [
  { id: "select", label: "Move & select", key: "V", icon: MousePointer2 },
  { id: "draw", label: "Draw", key: "D", icon: Pencil },
  { id: "erase", label: "Eraser: drawings, notes and tokens", key: "E", icon: Eraser },
  { id: "fog", label: "Fog of war", key: "F", icon: CloudFog, gm: true },
  { id: "build", label: "Build the map: floors, walls, doors, objects", key: "B", icon: Hammer, gm: true },
  { id: "measure", label: "Measure", key: "M", icon: Ruler },
  { id: "pointer", label: "Pointer", key: "P", icon: Pointer },
  { id: "spell", label: "Spells: cast an effect everyone sees", key: "S", icon: WandSparkles },
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
  if (tool === "spell") return <SpellOptions />;
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
  const party = useRoomState((s) => s.party);
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
      {o.preview && scene?.vision?.on && scene.vision.perPlayer && (
        <label class="look-as" title="With per-player sight: whose view to see">
          <span>Look as</span>
          <select aria-label="Look as" value={o.lookAs ?? ""} onChange={(e) => set({ lookAs: e.currentTarget.value || null })}>
            <option value="">The whole party</option>
            {(party?.characters ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
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
  const [recentObjects, setRecentObjects] = useState<StampId[]>(() => loadRecent(RECENT_OBJECTS, isStampId));
  const [recentFloors, setRecentFloors] = useState(() => ({
    building: loadRecent(recentFloorsKey("building"), (id): id is FloorChoice => isFloorFor("building", id)),
    terrain: loadRecent(recentFloorsKey("terrain"), (id): id is FloorChoice => isFloorFor("terrain", id)),
  }));
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
            <FloorPicker
              tool={paint}
              // While erasing, the picker shows the floor painting goes back to.
              value={o.floor[paint] === "erase" ? (recentFloors[paint][0] ?? (paint === "building" ? "s" : "g")) : (o.floor[paint] as FloorChoice)}
              painting={o.floor[paint] !== "erase"}
              recent={recentFloors[paint]}
              onPick={(id) => {
                set({ floor: { ...o.floor, [paint]: id } });
                const next = withRecent(recentFloors[paint], id);
                setRecentFloors({ ...recentFloors, [paint]: next });
                saveRecent(recentFloorsKey(paint), next);
              }}
            />
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
        <>
          <div class="seg">
            <button class={cx("seg-btn wide", o.wallMode === "add" && "active")} onClick={() => set({ wallMode: "add" })}>
              Add
            </button>
            <button class={cx("seg-btn wide", o.wallMode === "remove" && "active")} onClick={() => set({ wallMode: "remove" })}>
              Remove
            </button>
          </div>
          <WallPicker
            value={scene.wallTexture ? `t:${scene.wallTexture}` : "plain"}
            onPick={(id) => room.changeScene(scene.id, { wallTexture: id === "plain" ? null : id.slice(2) }, {})}
          />
        </>
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
            <button
              class={cx("seg-btn wide", o.stampMode === "place" && "active")}
              title="Place objects: click the map"
              aria-pressed={o.stampMode === "place"}
              onClick={() => set({ stampMode: "place" })}
            >
              Place
            </button>
            <button
              class={cx("seg-btn wide", o.stampMode === "scatter" && "active")}
              title="Scatter: drag a brush to paint objects at random, for forests ([ and ] change its size)"
              aria-pressed={o.stampMode === "scatter"}
              onClick={() => set({ stampMode: "scatter" })}
            >
              <SprayCan size={14} /> Scatter
            </button>
            <button
              class={cx("seg-btn wide", o.stampMode === "remove" && "active")}
              title="Erase objects: click one, or drag over several (or hold Alt while you click or drag)"
              aria-pressed={o.stampMode === "remove"}
              onClick={() => set({ stampMode: "remove" })}
            >
              <Eraser size={14} /> Erase
            </button>
          </div>
          <StampPicker
            value={o.stamp}
            placing={o.stampMode !== "remove"}
            recent={recentObjects}
            onPick={(id) => {
              // A Dungeon object starts at its natural size; switching between the first sixteen
              // keeps the size the GM set, unless the last one was a Dungeon object.
              const stampSize = isDungeonStamp(id) ? naturalStampSize(id) : isDungeonStamp(o.stamp) ? 1 : o.stampSize;
              set({ stamp: id, stampMode: o.stampMode === "scatter" ? "scatter" : "place", stampSize });
              const next = withRecent(recentObjects, id);
              setRecentObjects(next);
              saveRecent(RECENT_OBJECTS, next);
            }}
          />
          {o.stampMode === "scatter" ? (
            <ScatterOptions o={o} set={set} />
          ) : (
            <>
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
              <ObjectSnap />
            </>
          )}
        </>
      )}
      {o.mode === "select" && (
        <SelectOptions sel={sel} clip={clip} back={backLabel(o.selectReturn)} act={(a) => room.board?.buildAction(a)} />
      )}
      <span class="hint build-touch-hint">
        {o.mode === "stamps" && o.stampMode === "remove"
          ? "Tap an object, or drag over several, to erase them."
          : o.mode === "stamps" && o.stampMode === "scatter"
            ? "Drag to scatter objects. Two fingers move the map."
            : TOUCH_HINTS[o.mode]}
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
 * Objects › Scatter: whether to mix the picked object's group, how big the brush is, and how
 * close together it puts things. Objects it scatters always go anywhere, turned at random,
 * each at its own size give or take a fifth.
 */
function ScatterOptions(props: { o: BuildOpts; set: (x: Partial<BuildOpts>) => void }) {
  const { o, set } = props;
  const sc = o.scatter;
  const fold = foldOf(o.stamp);
  const put = (x: Partial<BuildOpts["scatter"]>) => set({ scatter: { ...sc, ...x } });
  return (
    <>
      <label
        class="check"
        title={
          fold
            ? `Mix: scatter all ${fold.ids.length} of ${fold.name}, picked at random. Untick to scatter only the one you picked.`
            : "Only Dungeon's objects come in groups to mix. Pick one of those (Nature has trees, rocks and bushes) to mix its group."
        }
      >
        <input type="checkbox" checked={!!fold && sc.mix} disabled={!fold} onChange={(e) => put({ mix: e.currentTarget.checked })} /> Mix{" "}
        {fold ? fold.name.toLowerCase() : "its group"}
      </label>
      <div class="seg" role="group" aria-label="Brush size" title="Brush size in squares across ([ and ] change it)">
        {SCATTER_BRUSHES.map((n) => (
          <button
            key={n}
            class={cx("seg-btn", sc.brush === n && "active")}
            aria-label={`${n} square brush`}
            aria-pressed={sc.brush === n}
            onClick={() => put({ brush: n })}
          >
            {n}
          </button>
        ))}
      </div>
      <div class="seg" role="group" aria-label="Density" title="How close together: sparse leaves gaps, dense lets treetops crowd">
        {(Object.keys(SCATTER_DENSITY_LABELS) as ScatterDensity[]).map((d) => (
          <button
            key={d}
            class={cx("seg-btn wide", sc.density === d && "active")}
            aria-pressed={sc.density === d}
            onClick={() => put({ density: d })}
          >
            {SCATTER_DENSITY_LABELS[d]}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Objects and Select: whether objects go on whole squares, or anywhere (to a sixteenth of a
 * square), closer together than squares allow. Remembered in this browser.
 */
function ObjectSnap() {
  const room = useRoom();
  const snap = useRoomState((s) => s.objectSnap);
  // Room settings › Never snap to the grid: off for everyone, and not this browser's to change.
  const never = useRoomState((s) => !!s.room?.settings.freePlacement);
  return (
    <label
      class="check"
      title={
        never
          ? "Off in every scene: Room settings › Never snap to the grid"
          : "Untick to place and move objects anywhere, not only on whole squares (the arrow keys then move a quarter square)"
      }
    >
      <input type="checkbox" checked={snap && !never} disabled={never} onChange={(e) => room.setObjectSnap(e.currentTarget.checked)} /> Snap
      to squares
    </label>
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
      <ObjectSnap />
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

/** How each kind of spell is cast, as the Spells bar says it. */
/** Cast as a character: from their token, so a click is enough. */
const CAST_AS_HINTS: Record<"cone" | "bolt" | "jump", string> = {
  cone: "Click the way it goes from them.",
  bolt: "Click the target.",
  jump: "Click where they arrive.",
};

const CAST_HINTS: Record<FxCast, string> = {
  burst: "Click where it goes.",
  strike: "Click where it strikes.",
  cone: "Drag from the caster the way it goes.",
  bolt: "Drag from the caster to the target.",
  jump: "Drag from where they leave to where they arrive.",
};

/**
 * The spells left on the scene being looked at (zones, and spells on tokens), each with an End:
 * the GM can end any of them, a player the ones they cast. Ending is a change like any other:
 * Undo brings it back.
 */
function LastingSpells() {
  const room = useRoom();
  const items = useRoomState((s) => s.items);
  const sceneId = useRoomState((s) => s.viewSceneId);
  const me = useRoomState((s) => s.me);
  if (!me) return null;
  const zones = Object.values(items).filter(
    (i): i is DrawingItem => i.kind === "drawing" && i.sceneId === sceneId && !!i.fx && canDelete(i, me),
  );
  if (!zones.length) return null;
  return (
    <span class="spell-zones">
      <span class="hint">On the map:</span>
      {zones.map((z) => (
        <button
          key={z.id}
          class="chip spell-zone"
          title={`End ${z.spell ?? "this spell"} (Undo brings it back)`}
          aria-label={`End ${z.spell ?? "this spell"}`}
          onClick={() => room.change({ delete: [z.id] })}
        >
          {spellChipLabel(z, items)} <X size={12} />
        </button>
      ))}
    </span>
  );
}

/** The Spells tool's bar: which spell, and how to cast it. Everyone in the room sees it play. */
function SpellOptions() {
  const room = useRoom();
  const o = useRoomState((s) => s.spellOpts);
  // Cast as a character (picked from their card's Spells list): their spells first, cast from them.
  useRoomState((s) => s.party);
  const casterToken = useRoomState((s) => (s.spellOpts.caster ? s.items[s.spellOpts.caster] : undefined));
  const as = casterToken?.kind === "token" ? room.characterOf(casterToken) : null;
  const who = as ? characterLabel(as) : "";
  const theirs = as ? castList(as).filter((sp) => !sp.locked) : [];
  const spell = spellFx(o.spell);
  const zone = zoneSpell(o.spell);
  const cast = spell ? FX_LOOKS[spell.look].cast : "burst";
  const size = spell?.size ? (spell.spread ? `${spell.size} m, ${spell.spread}°` : `${spell.size} m radius`) : "";
  const onToken = tokenSpell(o.spell);
  const hint = onToken
    ? "Click a token to put it on; it goes where the token goes. Click the token again to end it."
    : zone?.look === "spirit-weapon"
      ? "Click to put it on the map; drag it round by its middle with Move & select. It stays until it's ended."
      : zone?.width
        ? `Click to lay it across the map (${zone.size} m by ${zone.width} m), or drag corner to corner. It stays until it's ended.`
        : zone
          ? zone.shape === "circle"
            ? `Click to leave it (${zone.size} m radius), or drag from its middle to size it. It stays until it's ended.`
            : `Click to leave it (${zone.size} m square), or drag corner to corner. It stays until it's ended.`
          : `${as && cast !== "burst" && cast !== "strike" ? CAST_AS_HINTS[cast] : CAST_HINTS[cast]}${size ? ` ${size}.` : ""} Everyone sees it.`;
  return (
    <div class="tool-options">
      {as && (
        <button
          class="chip spell-zone"
          title={`Spells go from ${who}'s token, and use up what they've prayed for. Click to stop casting as ${who}`}
          aria-label={`Stop casting as ${who}`}
          onClick={() => room.store.set({ spellOpts: { ...o, caster: null } })}
        >
          As {who} <X size={12} />
        </button>
      )}
      <label class="field inline">
        <span>Spell</span>
        <select value={o.spell} onChange={(e) => room.store.set({ spellOpts: { ...o, spell: e.currentTarget.value } })}>
          {theirs.length > 0 && (
            <optgroup label={`${who}'s spells`}>
              {theirs.map((sp) => (
                <option key={sp.name} value={sp.name}>
                  {sp.prayer ? `${sp.name} (${sp.left} left today)` : sp.name}
                </option>
              ))}
            </optgroup>
          )}
          {FX_GROUPS.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {SPELL_FX.filter((sp) => g.casts.includes(FX_LOOKS[sp.look].cast))
                .sort((x, y) => x.name.localeCompare(y.name))
                .map((sp) => (
                  <option key={sp.name} value={sp.name}>
                    {sp.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {(
            [
              ["Zones that stay", ZONE_SPELLS],
              ["On a token", TOKEN_SPELLS],
              ["Things that appear", CONJURED_SPELLS],
            ] as const
          ).map(([label, list]) => (
            <optgroup key={label} label={label}>
              {[...list]
                .sort((x, y) => x.name.localeCompare(y.name))
                .map((sp) => (
                  <option key={sp.name} value={sp.name}>
                    {sp.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <span class="hint">{hint}</span>
      <LastingSpells />
    </div>
  );
}

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
        {o.shape === "ruler" ? "Drag to measure." : "Drag from the spell's origin."} One {hex ? "hex" : "square"} is{" "}
        {formatDistance(1, grid)}; {rule}.
      </span>
    </div>
  );
}

export function ZoomControls() {
  const room = useRoom();
  const zoom = useRoomState((s) => s.zoom);
  return (
    <div class="zoom">
      <VoiceMicButton />
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

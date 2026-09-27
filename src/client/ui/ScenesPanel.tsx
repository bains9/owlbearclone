import { useRef, useState } from "preact/hooks";
import { Check, ImagePlus, Play, Plus, SquarePen, Trash } from "lucide-preact";
import { cellSpacing, guessGridSize, isHex } from "../../shared/geometry";
import { randomId } from "../../shared/ids";
import { DEFAULT_GRID } from "../../shared/sanitize";
import type { Asset, DiagonalRule, GridSettings, GridType, Scene } from "../../shared/types";

const GRID_TYPES: { id: GridType; label: string }[] = [
  { id: "square", label: "Squares" },
  { id: "hex-pointy", label: "Hex (rows)" },
  { id: "hex-flat", label: "Hex (columns)" },
];
import { fileUrl } from "../api";
import { CommitInput, ConfirmDialog, Modal, cx, useRoom, useRoomState } from "./common";

export function ScenesPanel() {
  const room = useRoom();
  const scenes = useRoomState((s) => s.scenes);
  const active = useRoomState((s) => s.activeSceneId);
  const view = useRoomState((s) => s.viewSceneId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Scene | null>(null);
  const list = Object.values(scenes).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  const editScene = editing ? scenes[editing] : null;

  if (editScene) {
    return <SceneEditor scene={editScene} onDone={() => setEditing(null)} />;
  }

  return (
    <div class="panel-body">
      <button class="btn btn-primary full" onClick={() => setCreating(true)}>
        <Plus size={16} /> New scene
      </button>
      <ul class="scene-list">
        {list.map((s) => (
          <li
            key={s.id}
            class={cx("scene-row", view === s.id && "viewing")}
            onClick={() => room.viewSceneLocally(s.id)}
            title="View this scene (players don't see it until you show it)"
          >
            <div
              class="scene-thumb"
              style={{
                background: s.background,
                backgroundImage: s.mapAssetId ? `url(${fileUrl(room.roomId, s.mapAssetId)})` : undefined,
              }}
            />
            <div class="scene-info">
              <span class="scene-title">{s.name}</span>
              <span class="small muted">
                {active === s.id ? <span class="live-tag">Players see this</span> : view === s.id ? "Previewing" : ""}
              </span>
            </div>
            <div class="scene-actions" onClick={(e) => e.stopPropagation()}>
              {active !== s.id && (
                <button class="icon-btn" title="Show to players" aria-label="Show to players" onClick={() => room.activateScene(s.id)}>
                  <Play size={16} />
                </button>
              )}
              <button
                class="icon-btn"
                title="Edit scene and grid"
                aria-label="Edit scene"
                onClick={() => {
                  room.viewSceneLocally(s.id);
                  setEditing(s.id);
                }}
              >
                <SquarePen size={16} />
              </button>
              <button class="icon-btn danger" title="Delete scene" aria-label="Delete scene" onClick={() => setDeleting(s)}>
                <Trash size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {creating && (
        <NewSceneDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setEditing(id);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete scene?"
          message={
            <>
              <strong>{deleting.name}</strong> and every token, drawing and fog shape on it will be deleted. This can't be
              undone.
            </>
          }
          confirmLabel="Delete scene"
          danger
          onConfirm={() => room.deleteScene(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function sceneFromMap(asset: Asset, name: string, order: number, fogCover: boolean): Scene {
  const size = guessGridSize(asset.width, asset.height);
  return {
    id: randomId(12),
    name,
    order,
    mapAssetId: asset.id,
    width: asset.width,
    height: asset.height,
    background: "#1b1e24",
    grid: { ...DEFAULT_GRID, size },
    fogCover,
    createdAt: Date.now(),
  };
}

function NewSceneDialog(props: { onClose: () => void; onCreated: (id: string) => void }) {
  const room = useRoom();
  const assets = useRoomState((s) => s.assets);
  const scenes = useRoomState((s) => s.scenes);
  const uploading = useRoomState((s) => s.uploading);
  const [name, setName] = useState("");
  const fallbackName = `Scene ${Object.keys(scenes).length + 1}`;
  const [mode, setMode] = useState<"upload" | "library" | "blank">("upload");
  const [cols, setCols] = useState(30);
  const [covered, setCovered] = useState(true);
  const [rows, setRows] = useState(20);
  const fileRef = useRef<HTMLInputElement>(null);
  const maps = Object.values(assets)
    .filter((a) => a.kind === "map")
    .sort((a, b) => b.createdAt - a.createdAt);
  const order = Math.max(0, ...Object.values(scenes).map((s) => s.order + 1));

  const create = (scene: Scene) => {
    room.upsertScene(scene);
    room.viewSceneLocally(scene.id);
    props.onCreated(scene.id);
  };

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    const assets = await room.upload(files, "map");
    if (!assets.length) return;
    // One scene per map. A typed name only makes sense for a single map; several use their file names.
    const scenes = assets.map((a, i) =>
      sceneFromMap(a, assets.length === 1 ? name.trim() || a.name : a.name, order + i, covered),
    );
    for (const sc of scenes.slice(1)) room.upsertScene(sc);
    create(scenes[0]);
    if (scenes.length > 1) room.toast(`Created ${scenes.length} scenes, one per map.`);
  };

  return (
    <Modal title="New scene" onClose={props.onClose} width={480}>
      <label class="field">
        <span>Name</span>
        <input
          value={name}
          maxLength={60}
          placeholder={mode === "blank" ? fallbackName : "Leave empty to use the map's name"}
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>
      <div class="seg full">
        <button class={cx("seg-btn wide", mode === "upload" && "active")} onClick={() => setMode("upload")}>
          Upload a map
        </button>
        <button class={cx("seg-btn wide", mode === "library" && "active")} onClick={() => setMode("library")}>
          Uploaded maps
        </button>
        <button class={cx("seg-btn wide", mode === "blank" && "active")} onClick={() => setMode("blank")}>
          Blank grid
        </button>
      </div>
      {mode !== "blank" && (
        <label class="check" title="Players see nothing until you reveal it with the fog tool">
          <input type="checkbox" checked={covered} onChange={(e) => setCovered(e.currentTarget.checked)} /> Start with the map
          covered in fog
        </label>
      )}
      {mode === "upload" && (
        <div class="upload-drop" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={28} />
          <span>{uploading ? `Uploading ${uploading}…` : "Choose one or more map images (PNG, JPEG, WebP)"}</span>
          <span class="small muted">Large images are resized to 6144 px on the long side.</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              void onFiles(files);
            }}
          />
        </div>
      )}
      {mode === "library" &&
        (maps.length ? (
          <div class="asset-grid">
            {maps.map((a) => (
              <button key={a.id} class="asset" title={a.name} onClick={() => create(sceneFromMap(a, name.trim() || a.name, order, covered))}>
                <img src={fileUrl(room.roomId, a.id)} alt={a.name} loading="lazy" />
                <span class="asset-name">{a.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p class="muted small">No maps uploaded yet.</p>
        ))}
      {mode === "blank" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const size = 70;
            create({
              id: randomId(12),
              name: name.trim() || fallbackName,
              order,
              mapAssetId: null,
              width: Math.max(1, Math.min(200, cols)) * size,
              height: Math.max(1, Math.min(200, rows)) * size,
              background: "#3a3f47",
              grid: { ...DEFAULT_GRID, size, color: "#ffffff", opacity: 0.2 },
              fogCover: false,
              createdAt: Date.now(),
            });
          }}
        >
          <div class="row">
            <label class="field">
              <span>Columns</span>
              <input type="number" min={1} max={200} value={cols} onInput={(e) => setCols(Number(e.currentTarget.value))} />
            </label>
            <label class="field">
              <span>Rows</span>
              <input type="number" min={1} max={200} value={rows} onInput={(e) => setRows(Number(e.currentTarget.value))} />
            </label>
          </div>
          <div class="dialog-actions">
            <button class="btn btn-primary">Create</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function num(v: string, fallback: number): number {
  if (!v.trim()) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function SceneEditor(props: { scene: Scene; onDone: () => void }) {
  const room = useRoom();
  const s = props.scene;
  const g = s.grid;
  const assets = useRoomState((st) => st.assets);
  const [pickMap, setPickMap] = useState(false);
  const [alignCells, setAlignCells] = useState(3);
  const [fogReset, setFogReset] = useState<null | "cover" | "clear">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Scene>) => room.upsertScene({ ...s, ...patch });
  const grid = (patch: Partial<GridSettings>) => update({ grid: { ...g, ...patch } });
  // How far apart cells are per unit of grid size (1 for squares; hexes are staggered).
  const unit = cellSpacing({ ...g, size: 1 });
  const hex = isHex(g);
  const cols = Math.round((s.width / (g.size * unit.x)) * 100) / 100;
  const rows = Math.round((s.height / (g.size * unit.y)) * 100) / 100;
  const cellWord = hex ? "Hexes" : "Squares";

  const setMap = (asset: Asset) => {
    const sameSize = !!s.mapAssetId && asset.width === s.width && asset.height === s.height;
    const next = {
      ...s,
      mapAssetId: asset.id,
      width: asset.width,
      height: asset.height,
      grid: sameSize ? g : { ...g, size: guessGridSize(asset.width, asset.height) },
    };
    if (sameSize) {
      // Another version of the same map (day and night, say): the fog still lines up.
      room.upsertScene(next);
      return;
    }
    // A new map starts covered, and fog drawn for the old one wouldn't line up with it.
    const fog = Object.values(room.state.items)
      .filter((i) => i.kind === "fog" && i.sceneId === s.id)
      .map((i) => i.id);
    room.changeScene({ ...next, fogCover: true }, fog.length ? { delete: fog } : {});
    room.toast("The map starts covered in fog. Reveal areas with the fog tool.");
  };

  return (
    <div class="panel-body scene-editor">
      <label class="field">
        <span>Name</span>
        <CommitInput value={s.name} maxLength={60} onCommit={(name) => name.trim() && update({ name: name.trim() })} />
      </label>

      <h3>Map</h3>
      <div class="row">
        <button class="btn btn-sm" onClick={() => setPickMap(true)}>
          Choose uploaded
        </button>
        <button class="btn btn-sm" onClick={() => fileRef.current?.click()}>
          Upload new
        </button>
        {s.mapAssetId && (
          <button class="btn btn-sm" onClick={() => update({ mapAssetId: null })}>
            Remove
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            const [asset] = await room.upload([file], "map");
            if (asset) setMap(asset);
          }}
        />
      </div>
      {!s.mapAssetId && (
        <div class="row">
          <label class="field">
            <span>Width (px)</span>
            <CommitInput type="number" value={String(s.width)} onCommit={(v) => update({ width: Math.max(16, num(v, s.width)) })} />
          </label>
          <label class="field">
            <span>Height (px)</span>
            <CommitInput type="number" value={String(s.height)} onCommit={(v) => update({ height: Math.max(16, num(v, s.height)) })} />
          </label>
        </div>
      )}
      <label class="field inline">
        <span>Background</span>
        <input type="color" value={s.background} onChange={(e) => update({ background: e.currentTarget.value })} />
      </label>

      <h3>Grid</h3>
      <div class="seg full">
        {GRID_TYPES.map((t) => (
          <button key={t.id} class={cx("seg-btn wide", (g.type ?? "square") === t.id && "active")} onClick={() => grid({ type: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {!hex && (
        <div class="align-grid">
          <p class="small muted">Quickest: draw a box on the map over some of its printed squares.</p>
          <div class="row">
            <select
              value={String(alignCells)}
              onChange={(e) => setAlignCells(Number(e.currentTarget.value))}
              aria-label="How many squares the box covers"
              title="How many squares across the box will cover (more is more accurate)"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n}×{n} squares
                </option>
              ))}
            </select>
            <button class="btn btn-sm btn-primary" onClick={() => room.store.set({ gridAlign: { cells: alignCells } })}>
              Draw it on the map
            </button>
          </div>
        </div>
      )}
      <p class="small muted">
        Or set how many {hex ? "hexes" : "squares"} the map has across and down, then nudge the offset.
      </p>
      <div class="row">
        <label class="field">
          <span>{cellWord} across</span>
          <CommitInput
            type="number"
            step="0.5"
            value={String(cols)}
            onCommit={(v) => {
              const c = num(v, cols);
              if (c >= 1) grid({ size: Math.round((s.width / (c * unit.x)) * 1000) / 1000 });
            }}
          />
        </label>
        <label class="field">
          <span>{cellWord} down</span>
          <CommitInput
            type="number"
            step="0.5"
            value={String(rows)}
            onCommit={(v) => {
              const r = num(v, rows);
              if (r >= 1) grid({ size: Math.round((s.height / (r * unit.y)) * 1000) / 1000 });
            }}
          />
        </label>
      </div>
      <div class="row">
        <label class="field">
          <span>{hex ? "Hex width (px)" : "Square size (px)"}</span>
          <CommitInput type="number" step="0.5" value={String(g.size)} onCommit={(v) => grid({ size: Math.max(4, num(v, g.size)) })} />
        </label>
        <div class="field">
          <span>Fine tune</span>
          <div class="seg">
            <button class="seg-btn" title="Smaller squares" onClick={() => grid({ size: Math.max(4, g.size - 0.5) })}>
              −
            </button>
            <button class="seg-btn" title="Bigger squares" onClick={() => grid({ size: g.size + 0.5 })}>
              +
            </button>
          </div>
        </div>
      </div>
      <div class="row">
        <label class="field">
          <span>Offset X</span>
          <CommitInput type="number" value={String(g.offsetX)} onCommit={(v) => grid({ offsetX: num(v, g.offsetX) })} />
        </label>
        <label class="field">
          <span>Offset Y</span>
          <CommitInput type="number" value={String(g.offsetY)} onCommit={(v) => grid({ offsetY: num(v, g.offsetY) })} />
        </label>
      </div>
      <div class="row wrap">
        <label class="check">
          <input type="checkbox" checked={g.show} onChange={(e) => grid({ show: e.currentTarget.checked })} /> Show grid
        </label>
        <label class="check">
          <input type="checkbox" checked={g.snap} onChange={(e) => grid({ snap: e.currentTarget.checked })} /> Snap tokens
        </label>
        <label class="field inline">
          <span>Colour</span>
          <input type="color" value={g.color} onChange={(e) => grid({ color: e.currentTarget.value })} />
        </label>
      </div>
      <label class="field">
        <span>Line opacity</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={g.opacity}
          onChange={(e) => grid({ opacity: Number(e.currentTarget.value) })}
        />
      </label>

      <h3>Distance</h3>
      <div class="row">
        <label class="field">
          <span>One {hex ? "hex" : "square"} is</span>
          <CommitInput type="number" value={String(g.unit)} onCommit={(v) => grid({ unit: Math.max(0.01, num(v, g.unit)) })} />
        </label>
        <label class="field">
          <span>Unit</span>
          <CommitInput value={g.unitName} maxLength={12} onCommit={(v) => grid({ unitName: v.trim() })} />
        </label>
      </div>
      {!hex && (
      <label class="field">
        <span>Diagonals</span>
        <select value={g.diagonal} onChange={(e) => grid({ diagonal: e.currentTarget.value as DiagonalRule })}>
          <option value="chebyshev">Count as one square (D&D 5e)</option>
          <option value="alternating">Alternate 1, 2, 1 (Pathfinder)</option>
          <option value="euclidean">Straight-line distance</option>
        </select>
      </label>
      )}

      <h3>Fog</h3>
      <p class="small muted">
        {s.fogCover
          ? "The scene starts covered; the fog tool reveals areas."
          : "The scene starts uncovered; the fog tool hides areas."}{" "}
        Both buttons remove the fog shapes drawn so far (Undo brings them back).
      </p>
      <div class="row">
        <button class="btn btn-sm" onClick={() => setFogReset("cover")}>
          Cover all
        </button>
        <button class="btn btn-sm" onClick={() => setFogReset("clear")}>
          Clear all
        </button>
      </div>
      {fogReset && (
        <ConfirmDialog
          title={fogReset === "cover" ? "Cover the whole scene?" : "Remove all fog?"}
          message={
            fogReset === "cover"
              ? "Players will see nothing of this scene until you reveal it. Undo puts the fog back the way it was."
              : "Players will see the whole scene. Undo puts the fog back the way it was."
          }
          confirmLabel={fogReset === "cover" ? "Cover all" : "Clear all"}
          onConfirm={() => room.resetFog(s.id, fogReset === "cover")}
          onClose={() => setFogReset(null)}
        />
      )}

      <button class="btn btn-primary full" onClick={props.onDone}>
        <Check size={16} /> Done
      </button>

      {pickMap && (
        <Modal title="Choose a map" onClose={() => setPickMap(false)} width={520}>
          <div class="asset-grid">
            {Object.values(assets)
              .filter((a) => a.kind === "map")
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((a) => (
                <button
                  key={a.id}
                  class="asset"
                  title={a.name}
                  onClick={() => {
                    setMap(a);
                    setPickMap(false);
                  }}
                >
                  <img src={fileUrl(room.roomId, a.id)} alt={a.name} loading="lazy" />
                  <span class="asset-name">{a.name}</span>
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

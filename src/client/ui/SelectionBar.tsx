import {
  Armchair,
  Pencil,
  BringToFront,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  RotateCcw,
  RotateCw,
  SendToBack,
  Swords,
  Trash,
} from "lucide-preact";
import { randomId } from "../../shared/ids";
import { canDelete } from "../../shared/permissions";
import type { DrawingItem, Item, TokenItem } from "../../shared/types";
import { PLAYER_COLORS } from "../identity";
import {
  deleteSelection,
  duplicateSelection,
  patchSelection,
  reorderSelection,
  rotateSelection,
  toggleHidden,
  toggleLocked,
} from "../room/actions";
import { CommitInput, Swatches, cx, useRoom, useRoomState } from "./common";
import { DRAW_COLORS } from "./Toolbar";

const SIZES = [0.5, 1, 2, 3, 4, 6];
const RING_COLORS = ["#e4572e", "#f3a712", "#5bba6f", "#4f9dde", "#b45fd6", "#ffffff"];

export function SelectionBar() {
  const room = useRoom();
  const selection = useRoomState((s) => s.selection);
  const items = useRoomState((s) => s.items);
  const me = useRoomState((s) => s.me);
  const gm = me?.role === "gm";
  const selected = selection.map((id) => items[id]).filter((i): i is Item => i !== undefined);
  if (!selected.length || !me) return null;

  const tokens = selected.filter((i): i is TokenItem => i.kind === "token");
  const drawings = selected.filter((i): i is DrawingItem => i.kind === "drawing");
  const movable = selected.some((i) => room.canMoveItem(i));
  const deletable = selected.some((i) => canDelete(i, me));

  const common = (
    <>
      {movable && (
        <>
          <button class="icon-btn" title="Bring to front" aria-label="Bring to front" onClick={() => reorderSelection(room, "front")}>
            <BringToFront size={18} />
          </button>
          <button class="icon-btn" title="Send to back" aria-label="Send to back" onClick={() => reorderSelection(room, "back")}>
            <SendToBack size={18} />
          </button>
        </>
      )}
      {deletable && (
        <button class="icon-btn danger" title="Delete (Del)" aria-label="Delete" onClick={() => deleteSelection(room)}>
          <Trash size={18} />
        </button>
      )}
    </>
  );

  if (tokens.length === 1 && selected.length === 1) {
    const t = tokens[0];
    const can = room.canMoveItem(t);
    const patch = (set: Partial<TokenItem>) => room.change({ patch: [{ id: t.id, set }] });
    return (
      <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
        <CommitInput
          key={t.id}
          class="selbar-label"
          value={t.label}
          placeholder="Name"
          maxLength={60}
          disabled={!can}
          onCommit={(label) => patch({ label: label.trim() })}
        />
        <select
          value={String(t.size)}
          disabled={!can}
          title="Size in squares"
          aria-label="Size in squares"
          onChange={(e) => patch({ size: Number(e.currentTarget.value) })}
        >
          {(SIZES.includes(t.size) ? SIZES : [...SIZES, t.size].sort((a, b) => a - b)).map((s) => (
            <option key={s} value={String(s)}>
              {s === 0.5 ? "½" : s}×{s === 0.5 ? "½" : s}
            </option>
          ))}
        </select>
        {!t.assetId && can && <Swatches colors={PLAYER_COLORS.slice(0, 8)} value={t.color} onPick={(color) => patch({ color })} size="sm" />}
        {can && (
          <div class="rings" title="Status rings">
            {RING_COLORS.map((c) => {
              const on = t.rings.includes(c);
              return (
                <button
                  key={c}
                  class={cx("ring", on && "on")}
                  style={{ borderColor: c }}
                  aria-label={`${on ? "Remove" : "Add"} ${c} ring`}
                  aria-pressed={on}
                  onClick={() => patch({ rings: on ? t.rings.filter((r) => r !== c) : [...t.rings, c] })}
                />
              );
            })}
          </div>
        )}
        {can && (
          <>
            <button class="icon-btn" title="Rotate left ([)" aria-label="Rotate left" onClick={() => rotateSelection(room, -45)}>
              <RotateCcw size={18} />
            </button>
            <button class="icon-btn" title="Rotate right (])" aria-label="Rotate right" onClick={() => rotateSelection(room, 45)}>
              <RotateCw size={18} />
            </button>
          </>
        )}
        {gm && (
          <>
            <button
              class={cx("icon-btn", t.hidden && "active")}
              title={t.hidden ? "Hidden from players (H)" : "Visible to players (H)"}
              aria-label={t.hidden ? "Show to players" : "Hide from players"}
              onClick={() => toggleHidden(room)}
            >
              {t.hidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <button
              class={cx("icon-btn", t.locked && "active")}
              title={t.locked ? "Locked: players can't move it (L)" : "Unlocked (L)"}
              aria-label={t.locked ? "Unlock" : "Lock"}
              onClick={() => toggleLocked(room)}
            >
              {t.locked ? <Lock size={18} /> : <LockOpen size={18} />}
            </button>
          </>
        )}
        {can && (
          <button
            class={cx("icon-btn", t.layer === "prop" && "active")}
            title={t.layer === "prop" ? "Prop: sits under characters (click to make it a character)" : "Make it a prop (sits under characters)"}
            aria-label={t.layer === "prop" ? "Make it a character" : "Make it a prop"}
            aria-pressed={t.layer === "prop"}
            onClick={() => patch({ layer: t.layer === "prop" ? "character" : "prop" })}
          >
            <Armchair size={18} />
          </button>
        )}
        <button
          class="icon-btn"
          title="Add to initiative"
          aria-label="Add to initiative"
          onClick={() => {
            const init = room.state.initiative;
            if (init.entries.some((e) => e.tokenId === t.id)) {
              room.setPanel("initiative");
              return;
            }
            room.initiativeOp({
              op: "add",
              entry: { id: randomId(10), name: t.label || "Token", value: 0, color: t.color, tokenId: t.id },
            });
            room.setPanel("initiative");
          }}
        >
          <Swords size={18} />
        </button>
        {(gm || room.state.room?.settings.playersCanAddTokens) && (
          <button class="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => duplicateSelection(room)}>
            <Copy size={18} />
          </button>
        )}
        {common}
      </div>
    );
  }

  if (drawings.length === selected.length) {
    const d = drawings[0];
    return (
      <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
        {drawings.length === 1 && d.shape === "text" && room.canMoveItem(d) ? (
          <button
            class="btn btn-sm"
            title="Edit the note's text"
            onClick={() =>
              room.store.set({
                textPrompt: { x: d.points[0], y: d.points[1], fontSize: d.width, editId: d.id, text: d.text ?? "" },
              })
            }
          >
            <Pencil size={14} /> Edit note
          </button>
        ) : (
          <span class="muted small">
            {drawings.length === 1 ? (d.shape === "text" ? "Note" : "Drawing") : `${drawings.length} drawings`}
          </span>
        )}
        {movable && (
          <Swatches colors={DRAW_COLORS} value={d.color} onPick={(color) => patchSelection(room, { color }, "any")} size="sm" />
        )}
        {gm && (
          <button
            class={cx("icon-btn", drawings.every((x) => x.hidden) && "active")}
            title={drawings.every((x) => x.hidden) ? "Only you can see this (H)" : "Players can see this (H)"}
            aria-label={drawings.every((x) => x.hidden) ? "Show to players" : "Hide from players"}
            onClick={() => toggleHidden(room)}
          >
            {drawings.every((x) => x.hidden) ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
        {common}
      </div>
    );
  }

  return (
    <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
      <span class="muted small">{selected.length} selected</span>
      {tokens.length > 0 && movable && (
        <>
          <button class="icon-btn" title="Rotate left ([)" aria-label="Rotate left" onClick={() => rotateSelection(room, -45)}>
            <RotateCcw size={18} />
          </button>
          <button class="icon-btn" title="Rotate right (])" aria-label="Rotate right" onClick={() => rotateSelection(room, 45)}>
            <RotateCw size={18} />
          </button>
        </>
      )}
      {tokens.length > 0 && (gm || room.state.room?.settings.playersCanAddTokens) && (
        <button class="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => duplicateSelection(room)}>
          <Copy size={18} />
        </button>
      )}
      {gm && tokens.length > 0 && (
        <>
          <button class="icon-btn" title="Hide or show (H)" aria-label="Hide or show" onClick={() => toggleHidden(room)}>
            <EyeOff size={18} />
          </button>
          <button class="icon-btn" title="Lock or unlock (L)" aria-label="Lock or unlock" onClick={() => toggleLocked(room)}>
            <Lock size={18} />
          </button>
        </>
      )}
      {common}
    </div>
  );
}

import { useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  Armchair,
  Compass,
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
import { isCompass } from "../../shared/types";
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
import { COMPASS_DIAL_STEP, dialValue, turnBy } from "../room/compass";
import { TOKEN_SIZES, sizeOptionLabel } from "../room/tokenSizes";
import { CommitInput, Swatches, cx, useRoom, useRoomState } from "./common";
import { DRAW_COLORS } from "./Toolbar";

const RING_COLORS = ["#e4572e", "#f3a712", "#5bba6f", "#4f9dde", "#b45fd6", "#ffffff"];

/**
 * A token's size in squares, with the D&D sizes they stand for (a size not in the list, such as
 * one set with the wheel, is added to it). A compass has no D&D size.
 */
function SizeSelect(props: { size: number; disabled: boolean; dnd?: boolean; onPick: (size: number) => void }) {
  const { size } = props;
  return (
    <select
      value={String(size)}
      disabled={props.disabled}
      title="Size in squares"
      aria-label="Size in squares"
      onChange={(e) => props.onPick(Number(e.currentTarget.value))}
    >
      {(TOKEN_SIZES.includes(size) ? TOKEN_SIZES : [...TOKEN_SIZES, size].sort((a, b) => a - b)).map((s) => (
        <option key={s} value={String(s)}>
          {sizeOptionLabel(s, props.dnd !== false)}
        </option>
      ))}
    </select>
  );
}

/** Counts drags of a compass dial, so each has its own undo step (even after the bar is shown again). */
let dialDrags = 0;

/**
 * A compass rose (GM): its size, which way North points (buttons of 15°, and a dial in 5°
 * steps that works by touch too), hide, lock and duplicate. Locked, it can't be moved, turned
 * or sized until it's unlocked. Each drag of the dial is one undo step, however long it pauses
 * while held; a quick run of arrow keys on it is one too.
 */
function CompassBar(props: { t: TokenItem; gm: boolean; common: ComponentChildren }) {
  const room = useRoom();
  const { t, gm } = props;
  const can = room.canMoveItem(t);
  const drag = useRef(0);
  const held = useRef(false);
  const patch = (set: Partial<TokenItem>, coalesce?: string) =>
    room.change({ patch: [{ id: t.id, set }] }, true, coalesce, coalesce !== undefined && held.current);
  const grab = () => {
    drag.current = ++dialDrags;
    held.current = true;
    // Let go anywhere (the pointer may leave the dial while it's held).
    const release = () => {
      held.current = false;
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
  };
  const dial = dialValue(t.rotation);
  return (
    <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
      <span class="selbar-what muted small">
        <Compass size={16} /> Compass
      </span>
      <SizeSelect size={t.size} disabled={!can} dnd={false} onPick={(size) => patch({ size })} />
      {can && (
        <div class="compass-turn" role="group" aria-label="Which way North points">
          <button class="icon-btn" title="Turn left 15° ([ turns 45°)" aria-label="Turn left 15°" onClick={() => patch({ rotation: turnBy(t.rotation, -15) })}>
            <RotateCcw size={18} />
          </button>
          <input
            type="range"
            min={0}
            max={360 - COMPASS_DIAL_STEP}
            step={COMPASS_DIAL_STEP}
            value={dial}
            title="Which way North points. The mouse wheel over the compass turns it too: 15°, or 5° with Z held."
            aria-label="Which way North points, in degrees clockwise from up"
            onPointerDown={grab}
            onInput={(e) => patch({ rotation: Number(e.currentTarget.value) }, `dial|${t.id}|${drag.current}`)}
          />
          <span class="compass-deg">{dial}°</span>
          <button class="icon-btn" title="Turn right 15° (] turns 45°)" aria-label="Turn right 15°" onClick={() => patch({ rotation: turnBy(t.rotation, 15) })}>
            <RotateCw size={18} />
          </button>
        </div>
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
            title={t.locked ? "Locked: it can't be moved, turned or sized until you unlock it (L)" : "Lock it in place (L)"}
            aria-label={t.locked ? "Unlock" : "Lock"}
            onClick={() => toggleLocked(room)}
          >
            {t.locked ? <Lock size={18} /> : <LockOpen size={18} />}
          </button>
          <button class="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => duplicateSelection(room)}>
            <Copy size={18} />
          </button>
        </>
      )}
      {props.common}
    </div>
  );
}

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

  if (tokens.length === 1 && selected.length === 1 && isCompass(tokens[0])) {
    return <CompassBar t={tokens[0]} gm={gm} common={common} />;
  }

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
        <SizeSelect size={t.size} disabled={!can} onPick={(size) => patch({ size })} />
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

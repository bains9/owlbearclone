import { useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, Dices, Plus, Trash, X } from "lucide-preact";
import { secureRng } from "../../shared/dice";
import { randomId } from "../../shared/ids";
import type { TokenItem } from "../../shared/types";
import { CommitInput, ConfirmDialog, cx, useRoom, useRoomState } from "./common";

export function InitiativePanel() {
  const room = useRoom();
  const init = useRoomState((s) => s.initiative);
  const items = useRoomState((s) => s.items);
  const selection = useRoomState((s) => s.selection);
  const gm = useRoomState((s) => s.me?.role === "gm");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [clearing, setClearing] = useState(false);
  const entries = init.entries;

  const step = (dir: 1 | -1) => {
    if (!entries.length) return;
    // Say whose turn is ending, so two people pressing Next together only advance once.
    room.initiativeOp({ op: "step", dir, from: entries[init.turn]?.id ?? null });
    // Bring the new current combatant's token into view.
    const now = room.state.initiative;
    const tokenId = now.entries[now.turn]?.tokenId;
    const token = tokenId ? items[tokenId] : undefined;
    if (token && token.kind === "token" && token.sceneId === room.state.viewSceneId) {
      room.select([token.id]);
      room.board?.centerOn(token);
    }
  };

  const add = (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    const v = Number(value);
    room.initiativeOp({
      op: "add",
      entry: {
        id: randomId(10),
        name: name.trim(),
        value: Number.isFinite(v) ? v : 0,
        color: room.state.me?.color ?? "#8a8f98",
        tokenId: null,
      },
    });
    setName("");
    setValue("");
  };

  const selectedTokens = selection
    .map((id) => items[id])
    .filter((i): i is TokenItem => i?.kind === "token" && !entries.some((e) => e.tokenId === i.id));

  return (
    <div class="panel-body">
      <div class="init-head">
        <button class="icon-btn" title="Previous turn" aria-label="Previous turn" onClick={() => step(-1)} disabled={!entries.length}>
          <ChevronLeft size={18} />
        </button>
        <div class="init-round">
          Round <strong>{init.round}</strong>
        </div>
        <button class="btn btn-primary btn-sm" onClick={() => step(1)} disabled={!entries.length}>
          Next turn <ChevronRight size={16} />
        </button>
      </div>

      {entries.length === 0 ? (
        <p class="muted small">No one in initiative yet. Add names below, or select tokens and add them.</p>
      ) : (
        <ol class="init-list">
          {entries.map((e, i) => (
            <li key={e.id} class={cx("init-row", i === init.turn && "current")}>
              <span class="dot" style={{ background: e.color }} />
              <CommitInput
                class="init-name"
                value={e.name}
                maxLength={40}
                ariaLabel="Name"
                onCommit={(v) => v.trim() && room.initiativeOp({ op: "update", id: e.id, name: v.trim() })}
              />
              <CommitInput
                class="init-value"
                type="number"
                value={String(e.value)}
                ariaLabel="Initiative"
                onCommit={(v) => {
                  const n = Number(v);
                  if (v.trim() && Number.isFinite(n)) room.initiativeOp({ op: "update", id: e.id, value: n });
                }}
              />
              <button
                class="icon-btn"
                title="Remove"
                aria-label={`Remove ${e.name}`}
                onClick={() => room.initiativeOp({ op: "remove", id: e.id })}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {!gm && init.turn < 0 && entries.length > 0 && (
        <p class="muted small">It's the turn of someone you can't see.</p>
      )}

      <form class="init-add" onSubmit={add}>
        <input value={name} maxLength={40} placeholder="Name" onInput={(e) => setName(e.currentTarget.value)} aria-label="Name" />
        <input
          class="init-value"
          value={value}
          placeholder="#"
          inputMode="numeric"
          onInput={(e) => setValue(e.currentTarget.value)}
          aria-label="Initiative"
        />
        <button
          type="button"
          class="icon-btn"
          title="Roll a d20"
          aria-label="Roll a d20"
          onClick={() => setValue(String(secureRng(20) + 1))}
        >
          <Dices size={16} />
        </button>
        <button class="icon-btn" title="Add" aria-label="Add" disabled={!name.trim()}>
          <Plus size={16} />
        </button>
      </form>

      {selectedTokens.length > 0 && (
        <button
          class="btn btn-sm full"
          onClick={() => {
            for (const t of selectedTokens) {
              room.initiativeOp({
                op: "add",
                entry: { id: randomId(10), name: t.label || "Token", value: 0, color: t.color, tokenId: t.id },
              });
            }
          }}
        >
          <Plus size={14} /> Add {selectedTokens.length === 1 ? "selected token" : `${selectedTokens.length} selected tokens`}
        </button>
      )}

      {gm && entries.length > 0 && (
        <button class="btn btn-sm full" onClick={() => setClearing(true)}>
          <Trash size={14} /> End combat
        </button>
      )}
      {clearing && (
        <ConfirmDialog
          title="End combat?"
          message="Clears the initiative list and resets the round counter."
          confirmLabel="End combat"
          onConfirm={() => room.initiativeOp({ op: "clear" })}
          onClose={() => setClearing(false)}
        />
      )}
    </div>
  );
}

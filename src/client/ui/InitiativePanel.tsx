import { useEffect, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, Dices, Eye, EyeOff, Plus, Trash, X } from "lucide-preact";
import { secureRng } from "../../shared/dice";
import { randomId } from "../../shared/ids";
import type { InitEntry, TokenItem } from "../../shared/types";
import { isCompass } from "../../shared/types";
import { AUTO_KEY, initEntryFor, loadAutoInitiative, placeOfEntry, saveAutoInitiative } from "../initiative";
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
  const [auto, setAuto] = useState(loadAutoInitiative);
  // Changed in another tab: show it here too, so the box says what placing a creature will do.
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key === AUTO_KEY || e.key === null) setAuto(loadAutoInitiative());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
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

  /** GM: lights up an entry's token on this screen alone, and selects it so its card shows. */
  const find = (e: InitEntry) => {
    const place = placeOfEntry(e, items, room.state.scenes, room.state.viewSceneId);
    if (place.at === "gone") return room.toast(`${e.name} isn't on the map any more.`);
    if (place.at === "scene") return room.toast(`${e.name} is on another scene: ${place.sceneName}.`);
    room.select([place.token.id]);
    // On a phone the panel lies over the map: out of the way, or the rings are behind it.
    if (window.matchMedia("(max-width: 760px)").matches) room.setPanel(null);
    if (room.board?.spotlight(place.token) === false) {
      room.toast(`${e.name} is out of view. Your map stays put, so the table display following it isn't led to a hidden creature.`);
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
    .filter((i): i is TokenItem => i?.kind === "token" && !isCompass(i) && !entries.some((e) => e.tokenId === i.id));

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
        <p class="muted small">
          No one in initiative yet. Roll <strong>Initiative</strong> on a character's card, add names below, or select tokens and add
          them.
        </p>
      ) : (
        <ol class="init-list">
          {entries.map((e, i) => (
            <li key={e.id} class={cx("init-row", i === init.turn && "current", e.hidden && "gm-only")}>
              {gm && e.tokenId ? (
                <button class="init-find" title="Find them on the map: only you see it" aria-label={`Find ${e.name} on the map`} onClick={() => find(e)}>
                  <span class="dot" style={{ background: e.color }} />
                </button>
              ) : (
                <span class="dot" style={{ background: e.color }} />
              )}
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
              {gm && (
                <button
                  class="icon-btn"
                  title={e.hidden ? "Only you see this one. Click to show it to the players." : "The players see this one. Click to keep it to yourself."}
                  aria-label={e.hidden ? `Show ${e.name} to the players` : `Keep ${e.name} from the players`}
                  aria-pressed={!e.hidden}
                  onClick={() => room.initiativeOp({ op: "update", id: e.id, hidden: !e.hidden })}
                >
                  {e.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
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
          title="Roll a d10"
          aria-label="Roll a d10"
          onClick={() => setValue(String(secureRng(10) + 1))}
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
            // A character rolls their d10 with their sheet's initiative bonus (INT); a creature its d10 alone.
            for (const t of selectedTokens) room.initiativeOp({ op: "add", entry: initEntryFor(room, t) });
          }}
        >
          <Plus size={14} /> Add {selectedTokens.length === 1 ? "selected token" : `${selectedTokens.length} selected tokens`}
        </button>
      )}

      {gm && (
        <label class="check small" title="Creatures you put on the scene everyone's on (not the party's characters or props) roll a d10 and join the list, kept from the players. On this device.">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              saveAutoInitiative(e.currentTarget.checked);
              setAuto(e.currentTarget.checked);
            }}
          />
          <span>Creatures I place roll and join, hidden from players</span>
        </label>
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

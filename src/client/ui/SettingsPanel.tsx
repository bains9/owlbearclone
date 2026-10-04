import { useRef, useState } from "preact/hooks";
import { Copy, Download, Trash, Upload } from "lucide-preact";
import { isMetric, switchUnits } from "../../shared/units";
import { api, roomUrl } from "../api";
import { exportRoom, importBackup } from "../backup";
import { CommitInput, ConfirmDialog, Modal, copyText, useRoom, useRoomState } from "./common";

export function SettingsPanel() {
  const room = useRoom();
  const info = useRoomState((s) => s.room);
  const scenes = useRoomState((s) => s.scenes);
  const [deleting, setDeleting] = useState(false);
  /** Turning metres on (true) or off (false), while asking about the scenes already here. */
  const [measuring, setMeasuring] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  if (!info) return null;
  const run = async (task: (progress: (text: string) => void) => Promise<string | void>) => {
    setBusy("Working…");
    try {
      const done = await task(setBusy);
      if (done) room.toast(done);
    } catch (err) {
      room.toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const st = info.settings;
  const metric = isMetric(st);
  /** The scenes a switch to metres (or back to feet) would change. */
  const switchable = (toMetric: boolean) => Object.values(scenes).filter((s) => switchUnits(s.grid, toMetric)).length;
  const setMetric = (on: boolean, switchScenes: boolean) => {
    room.updateRoom({ settings: { metric: on } });
    if (!switchScenes) return;
    const n = room.switchSceneUnits(on);
    if (n) {
      room.toast(`Switched ${n} scene${n === 1 ? "" : "s"} to ${on ? "metres" : "feet"}. Undo (Ctrl+Z) switches ${n === 1 ? "it" : "them"} back.`);
    }
  };
  return (
    <div class="panel-body">
      <label class="field">
        <span>Room name</span>
        <CommitInput value={info.name} maxLength={60} onCommit={(name) => name.trim() && room.updateRoom({ name: name.trim() })} />
      </label>

      <div class="field">
        <span>Invite link</span>
        <div class="row">
          <input readOnly value={roomUrl(info.id)} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
          <button
            class="btn btn-sm"
            onClick={async () => {
              if (await copyText(roomUrl(info.id))) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            <Copy size={14} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span class="small muted">Anyone with this link can join as a player. Keep it among your group.</span>
      </div>

      <h3>What players can do</h3>
      <label class="check">
        <input
          type="checkbox"
          checked={st.playersCanAddTokens}
          onChange={(e) => room.updateRoom({ settings: { playersCanAddTokens: e.currentTarget.checked } })}
        />
        Add tokens and upload token images
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={st.playersMoveAll}
          onChange={(e) => room.updateRoom({ settings: { playersMoveAll: e.currentTarget.checked } })}
        />
        Move any unlocked token (off: only the ones they placed)
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={st.playersCanDraw}
          onChange={(e) => room.updateRoom({ settings: { playersCanDraw: e.currentTarget.checked } })}
        />
        Draw on the map
      </label>

      <h3>Measuring</h3>
      <label class="check">
        <input
          type="checkbox"
          checked={metric}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            if (!switchable(on)) return setMetric(on, false);
            // Ask first; the box changes once that's answered.
            e.currentTarget.checked = metric;
            setMeasuring(on);
          }}
        />
        Measure in metres (1.5 m a square)
      </label>
      <p class="small muted">
        New scenes start with one square being {metric ? "1.5 m" : "5 ft"}. Each scene's own distance is under Distance in
        Edit scene.
      </p>

      <h3>Backup</h3>
      <p class="small muted">
        One file with every scene, token, drawing, note, the fog, and all uploaded images. Restoring adds the backup's
        scenes to this room as new scenes; nothing already here changes.
      </p>
      <div class="row">
        <button class="btn btn-sm" disabled={!!busy} onClick={() => void run((p) => exportRoom(room, p))}>
          <Download size={14} /> Download backup
        </button>
        <button class="btn btn-sm" disabled={!!busy} onClick={() => restoreRef.current?.click()}>
          <Upload size={14} /> Restore…
        </button>
        <input
          ref={restoreRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void run((p) => importBackup(room, file, p));
          }}
        />
      </div>
      {busy && <p class="small muted">{busy}</p>}

      <h3>Danger zone</h3>
      <button class="btn btn-danger full" onClick={() => setDeleting(true)}>
        <Trash size={14} /> Delete this room
      </button>
      {measuring !== null && (
        <Modal title={measuring ? "Measure in metres" : "Measure in feet"} onClose={() => setMeasuring(null)}>
          <div class="confirm-message">
            {(() => {
              const n = switchable(measuring);
              const scenesText = n === 1 ? "One scene in this room is" : `${n} scenes in this room are`;
              return measuring ? (
                <>
                  New scenes will start with one square being 1.5 m. {scenesText} measured in feet: switch{" "}
                  {n === 1 ? "it" : "them"} to metres too? 5 ft becomes 1.5 m, 10 ft becomes 3 m. Scenes in metres or other
                  units stay as they are.
                </>
              ) : (
                <>
                  New scenes will start with one square being 5 ft. {scenesText} measured in metres: switch{" "}
                  {n === 1 ? "it" : "them"} to feet too? 1.5 m becomes 5 ft, 3 m becomes 10 ft. Scenes in feet or other units
                  stay as they are.
                </>
              );
            })()}
          </div>
          <div class="dialog-actions">
            <button class="btn" onClick={() => setMeasuring(null)}>
              Cancel
            </button>
            <button
              class="btn"
              onClick={() => {
                setMetric(measuring, false);
                setMeasuring(null);
              }}
            >
              Only new scenes
            </button>
            <button
              class="btn btn-primary"
              onClick={() => {
                setMetric(measuring, true);
                setMeasuring(null);
              }}
            >
              Switch {switchable(measuring) === 1 ? "it" : "them"} too
            </button>
          </div>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this room?"
          message={
            <>
              <strong>{info.name}</strong> and everything in it (scenes, tokens, uploaded images, chat) will be deleted for
              good. Everyone in it is disconnected.
            </>
          }
          confirmLabel="Delete room"
          danger
          onConfirm={async () => {
            try {
              await api.deleteRoom(info.id);
              location.href = "/";
            } catch (err) {
              room.toast((err as Error).message, "error");
            }
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

import { useRef, useState } from "preact/hooks";
import { Copy, Download, Trash, Upload } from "lucide-preact";
import { api, roomUrl } from "../api";
import { exportRoom, importBackup } from "../backup";
import { CommitInput, ConfirmDialog, copyText, useRoom, useRoomState } from "./common";

export function SettingsPanel() {
  const room = useRoom();
  const info = useRoomState((s) => s.room);
  const [deleting, setDeleting] = useState(false);
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

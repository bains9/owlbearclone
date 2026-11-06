// The GM's start page: backups in their Google Drive (scripts/table-backup.gs). Setting them up, how
// they're going (above all, when they aren't), and putting things back from one.
import { useEffect, useRef, useState } from "preact/hooks";
import { AlertTriangle, Check, Cloud, Copy, History, RefreshCw } from "lucide-preact";
import backupScript from "../../../scripts/table-backup.gs?raw";
import { BACKUP_STALE_MS, TABLE_PARTS, type BackupStage, type BackupStatus, type BackupSummary, type TablePart } from "../../shared/backups";
import { backups, type BackupNight, type NightRoom } from "../backups";
import { ConfirmDialog, copyText, timeAgo } from "./common";

const STAGES: Record<BackupStage, string> = {
  list: "Looking at what's in Google Drive",
  table: "Saving the calendar, notes and your monsters",
  rooms: "Saving the rooms",
  files: "Sending pictures and maps",
  manifest: "Finishing",
};

const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
/** A backup this Table doesn't remember (a new Table, say) has only its id: 2026-11-06T07-30Z. */
const idLabel = (id: string) => `${id.slice(0, 10)} ${id.slice(11, 13)}:${id.slice(14, 16)} UTC`;
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.ceil(n / 1024)} KB`);

function Setup(props: { source: string | null; saved: (source: string | null) => void }) {
  const [address, setAddress] = useState(props.source ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (source: string) => {
    setBusy(true);
    setProblem(null);
    try {
      props.saved(await backups.setSource(source));
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="backup-setup">
      <ol class="small">
        <li>In Google Drive, make a folder for the backups. Its id is the last part of its address.</li>
        <li>
          At script.google.com, in that same account, make a new project and paste in the script:{" "}
          <button
            class="link-btn"
            onClick={() =>
              void copyText(backupScript).then((ok) => {
                setNote(ok ? "The script is copied." : "Couldn't copy it.");
              })
            }
          >
            <Copy size={12} /> Copy the script
          </button>
          {note && <span class="muted"> {note}</span>}
        </li>
        <li>In Project Settings, add a script property FOLDER_ID: your folder's id.</li>
        <li>Deploy it as a web app: Execute as Me, Who has access Anyone. Let it use your Drive when Google asks.</li>
        <li>Paste the web app's address (it ends /exec) here:</li>
      </ol>
      <div class="row">
        <input value={address} placeholder="https://script.google.com/macros/s/…/exec" aria-label="Your backup script's address" onInput={(e) => setAddress(e.currentTarget.value)} />
        <button class="btn btn-sm btn-primary" disabled={busy || !address.trim()} onClick={() => void save(address.trim())}>
          Save
        </button>
      </div>
      {problem && <p class="error-text small">{problem}</p>}
      {props.source && (
        <button class="link-btn small" disabled={busy} onClick={() => void save("")}>
          Stop backing up to Google Drive
        </button>
      )}
    </div>
  );
}

/** One backup: its rooms to put back, and the table's own things. */
function Night(props: { night: BackupSummary | { id: string }; onChanged: () => void; waitForBackup: (say: (t: string) => void) => Promise<void> }) {
  const [detail, setDetail] = useState<BackupNight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [parts, setParts] = useState<TablePart[]>([]);
  const [confirming, setConfirming] = useState(false);
  const { id } = props.night;

  useEffect(() => {
    void backups.night(id).then(setDetail, (e: Error) => setError(e.message));
  }, [id]);

  const putRoomBack = async (room: NightRoom) => {
    setError(null);
    setDone(null);
    setBusy(`Putting ${room.name} back…`);
    try {
      const back = await backups.restoreRoom(id, room.id);
      const { missing } = await backups.filesBack(id, { room: room.id, into: back.room }, (n, total) => setBusy(`Putting ${room.name}'s pictures back, ${n} of ${total}…`));
      setDone(
        `${back.sameLink ? `${back.name} is back, at its old link.` : `It's beside the room that's there now, as ${back.name}.`}${missing ? ` ${missing} of its pictures couldn't be read.` : ""}`,
      );
      props.onChanged();
      setDetail(await backups.night(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const putPartsBack = async () => {
    setError(null);
    setDone(null);
    try {
      // So this can be undone: what's there now is what the newest backup will hold.
      setBusy("First, a backup of how things are now…");
      await backups.run("before a restore");
      await props.waitForBackup(setBusy);
      setBusy("Putting it back…");
      await backups.restoreParts(id, parts);
      const { missing } = await backups.filesBack(id, { parts }, (n, total) => setBusy(`Putting its files back, ${n} of ${total}…`));
      setDone(`That's back as it was. Anyone with a room open should reload it.${missing ? ` ${missing} of its files couldn't be read.` : ""}`);
      setParts([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !detail) return <p class="error-text small">{error}</p>;
  if (!detail) return <p class="muted small">Asking Google Drive…</p>;
  return (
    <div class="backup-night">
      {!detail.complete && <p class="small backup-warn">{detail.missing ? `${detail.missing} files aren't in this one.` : "This one didn't finish: some files aren't in it."}</p>}
      <h4>Rooms</h4>
      {detail.rooms.length === 0 && <p class="muted small">No rooms in this one.</p>}
      <ul class="backup-rooms">
        {detail.rooms.map((r) => (
          <li key={r.id}>
            <span class="grow">
              {r.name}
              <span class="muted small">
                {" "}
                · {r.scenes} scene{r.scenes === 1 ? "" : "s"}, {r.files} picture{r.files === 1 ? "" : "s"}
                {r.here ? "" : " · no longer here"}
              </span>
            </span>
            <button class="btn btn-sm" disabled={!!busy} title={r.here ? "Puts it back as a copy beside the room that's there now" : "Puts it back at its old link"} onClick={() => void putRoomBack(r)}>
              Put it back
            </button>
          </li>
        ))}
      </ul>
      <h4>The rest of the table</h4>
      <div class="backup-parts">
        {TABLE_PARTS.map((p) => (
          <label key={p.id} class="small">
            <input type="checkbox" checked={parts.includes(p.id)} onChange={(e) => setParts(e.currentTarget.checked ? [...parts, p.id] : parts.filter((x) => x !== p.id))} /> {p.label}
          </label>
        ))}
      </div>
      <button class="btn btn-sm" disabled={!!busy || !parts.length} onClick={() => setConfirming(true)}>
        Put these back
      </button>
      {busy && <p class="small notes-busy">{busy}</p>}
      {done && <p class="small backup-good">{done}</p>}
      {error && <p class="error-text small">{error}</p>}
      {confirming && (
        <ConfirmDialog
          title={`Put these back as they were on ${when(detail.at)}?`}
          message="What's there of them now goes, for everyone. A backup of how things are now is taken first, so you can undo this by putting that one back."
          confirmLabel="Put them back"
          danger
          onConfirm={() => void putPartsBack()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export function BackupsCard(props: { onRoomsChanged: () => void }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nights, setNights] = useState<(BackupSummary | { id: string })[] | null>(null);
  const [showing, setShowing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);

  const refresh = () =>
    backups.status().then(
      (s) => {
        setStatus(s);
        return s;
      },
      (e: Error) => {
        setError(e.message);
        return null;
      },
    );

  useEffect(() => {
    void refresh();
  }, []);
  // While one's going, how it's going.
  const going = !!status?.running;
  useEffect(() => {
    if (!going) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [going]);

  const showNights = async () => {
    setShowing(true);
    setNights(null);
    try {
      setNights(await backups.nights());
    } catch (err) {
      setError((err as Error).message);
    }
  };
  // Showing the list, a new backup joins it.
  const wasGoing = useRef(false);
  useEffect(() => {
    if (wasGoing.current && !going && showing) void showNights();
    wasGoing.current = going;
  }, [going]);

  const backUp = async () => {
    setError(null);
    try {
      await backups.run("by hand");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /** Until the backup that's going has finished, and well. */
  const waitForBackup = async (say: (text: string) => void) => {
    for (let i = 0; i < 900; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await backups.status();
      setStatus(s);
      if (!s.running) {
        if (!s.last?.complete || !s.lastGoodAt || Date.now() - s.lastGoodAt > 120_000) throw new Error(s.error ?? "That backup didn't finish, so nothing's been changed.");
        return;
      }
      say(`First, a backup of how things are now: ${STAGES[s.running.stage].toLowerCase()}…`);
    }
    throw new Error("That backup is taking too long, so nothing's been changed. Try again later.");
  };

  if (!status) {
    return (
      <div class="card">
        <h2>Backups</h2>
        {error ? <p class="error-text small">{error}</p> : <p class="muted small">Loading…</p>}
      </div>
    );
  }
  if (!status.source) {
    return (
      <div class="card backups-card">
        <h2>Backups</h2>
        <p class="small backup-warn">
          <AlertTriangle size={14} /> Nothing is being backed up yet.
        </p>
        <p class="small muted">Keep a copy of everything (rooms, maps, pictures, notes, the calendar, Dungeon's maps) in a folder in Google Drive, sent every night. It takes a few minutes to set up, once, and only one GM needs to, in their own Google account.</p>
        <Setup source={null} saved={(source) => setStatus({ ...status, source })} />
      </div>
    );
  }
  const { last, running, lastGoodAt } = status;
  const stale = !running && (!lastGoodAt || Date.now() - lastGoodAt > BACKUP_STALE_MS);
  return (
    <div class="card backups-card">
      <div class="row backups-head">
        <h2 class="grow">Backups</h2>
        <button class="btn btn-sm" disabled={!!running} onClick={() => void backUp()}>
          <RefreshCw size={14} /> Back up now
        </button>
        <button class="btn btn-sm" onClick={() => (showing ? setShowing(false) : void showNights())}>
          <History size={14} /> {showing ? "Hide the list" : "Put something back"}
        </button>
      </div>
      {running ? (
        <p class="small notes-busy">
          {STAGES[running.stage]}
          {running.stage === "files" ? ` (${running.seen} looked at, ${size(running.sent)} sent)` : ""}…
          {running.retrying && <span class="backup-warn"> Google said no for now, so it's trying again later: {running.retrying}</span>}
        </p>
      ) : last ? (
        <p class="small">
          {stale ? <AlertTriangle size={14} class="backup-warn" /> : <Check size={14} class="backup-good" />} Last backup {timeAgo(last.at)} ({when(last.at)}): {last.rooms} room{last.rooms === 1 ? "" : "s"} and {last.files} file
          {last.files === 1 ? "" : "s"}, {size(last.bytes)} in all.
        </p>
      ) : (
        <p class="small backup-warn">
          <AlertTriangle size={14} /> No backup yet. The first runs tonight, or click Back up now.
        </p>
      )}
      {stale && last && <p class="small backup-warn">It's been more than a night since a backup got everything in.</p>}
      {status.error && !running && <p class="small backup-warn">{status.error}</p>}
      {error && <p class="error-text small">{error}</p>}
      <p class="small muted">
        <Cloud size={12} /> In Google Drive, every night.{" "}
        <button class="link-btn" onClick={() => setSetup(!setup)}>
          Change where
        </button>
      </p>
      {setup && (
        <Setup
          source={status.source}
          saved={(source) => {
            setStatus({ ...status, source });
            setSetup(false);
          }}
        />
      )}
      {showing && (
        <div class="backup-list">
          {nights === null && !error && <p class="muted small">Asking Google Drive…</p>}
          {nights?.length === 0 && <p class="muted small">Nothing in Google Drive yet.</p>}
          {nights?.slice(0, 60).map((n) => (
            <details key={n.id} open={open === n.id} onToggle={(e) => e.currentTarget.open && setOpen(n.id)}>
              <summary class="small">
                {"at" in n ? when(n.at) : idLabel(n.id)}
                {"reason" in n && n.reason !== "nightly" ? <span class="muted"> · {n.reason}</span> : null}
                {"complete" in n && !n.complete ? <span class="backup-warn"> · not everything</span> : null}
              </summary>
              {open === n.id && <Night night={n} onChanged={props.onRoomsChanged} waitForBackup={waitForBackup} />}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

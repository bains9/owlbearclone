// Campaign notes (GM only): the GM's Obsidian vault in Table. Bring it in by picking its folder (on
// any system), then find a note by its folders or a search, read it as Obsidian shows it, follow its
// links, show it (or the part picked) to the players as a handout, and link it to a token. Players
// never see this panel or the notes' names; they see only the handouts the GM shows them.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowLeft, BookOpen, Cloud, Copy, FolderOpen, Link2, Link2Off, RefreshCw, Search, Send } from "lucide-preact";
import driveScript from "../../../scripts/vault-drive.gs?raw";
import { noteTitle, type VaultSearchHit } from "../../shared/vault";
import type { TokenItem } from "../../shared/types";
import { safeHtml } from "../safeHtml";
import { clearVault, fetchNote, importVault, loadDriveSource, loadVault, noteTree, searchVault, setDriveSource, syncFromDrive, type Folder } from "../vault";
import { renderNote } from "../vaultRender";
import { ConfirmDialog, copyText, cx, useRoom, useRoomState } from "./common";

/** Opening Campaign notes syncs from Google Drive by itself when the last time was longer ago than this. */
export const DRIVE_STALE_MS = 15 * 60_000;

/**
 * Google Drive, the other way in: the GM's vault script (scripts/vault-drive.gs), set up once in
 * their Google account, its address kept by Table; then Sync brings the vault in from Drive.
 */
function DriveSetup(props: { source: string | null; saved: (source: string | null) => void }) {
  const room = useRoom();
  const [address, setAddress] = useState(props.source ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (source: string | null) => {
    setBusy(true);
    try {
      props.saved(await setDriveSource(source));
      room.toast(source ? "Google Drive is linked: click Sync from Google Drive to bring your vault in." : "Google Drive is unlinked.");
    } catch (err) {
      room.toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="drive-setup">
      <h4>Keep it in step with Google Drive</h4>
      <p class="small muted">If your vault is in Google Drive, Table can bring it in from there, and again whenever you sync, without picking the folder.</p>
      <ol class="small">
        <li>
          At script.google.com, in the Google account with your vault, make a new project and paste in the script:{" "}
          <button class="link-btn" onClick={() => void copyText(driveScript).then((ok) => room.toast(ok ? "The script is copied." : "Couldn't copy it.", ok ? undefined : "error"))}>
            <Copy size={12} /> Copy the script
          </button>
        </li>
        <li>In Project Settings, add a script property FOLDER_ID: your vault folder's id (the last part of its address in Drive).</li>
        <li>Deploy it as a web app: Execute as Me, Who has access Anyone. Let it read your Drive when Google asks.</li>
        <li>Paste the web app's address (it ends /exec) here:</li>
      </ol>
      <div class="row">
        <input value={address} placeholder="https://script.google.com/macros/s/…/exec" aria-label="Your vault script's address" onInput={(e) => setAddress(e.currentTarget.value)} />
        <button class="btn btn-sm btn-primary" disabled={busy || !address.trim()} onClick={() => void save(address.trim())}>
          Save
        </button>
      </div>
      {props.source && (
        <button class="link-btn small" disabled={busy} onClick={() => void save(null)}>
          Unlink Google Drive
        </button>
      )}
      <p class="small muted">The script only reads your vault folder, and answers only this Table.</p>
    </div>
  );
}

function FolderView(props: { folder: Folder; open: (path: string) => void }) {
  const { folder, open } = props;
  return (
    <ul class="note-tree">
      {folder.folders.map((f) => (
        <li key={f.path}>
          <details>
            <summary>{f.name}</summary>
            <FolderView folder={f} open={open} />
          </details>
        </li>
      ))}
      {folder.notes.map((n) => (
        <li key={n.path}>
          <button class="link-btn note-link" onClick={() => open(n.path)}>
            {n.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One note, as Obsidian's reading view shows it, with Show to players and the token link. */
function NoteView(props: { path: string; back: (() => void) | null; open: (path: string, heading?: string) => void; heading: string | null }) {
  const room = useRoom();
  const vault = useRoomState((s) => s.vault);
  const selection = useRoomState((s) => s.selection);
  const items = useRoomState((s) => s.items);
  const tokenNotes = useRoomState((s) => s.tokenNotes);
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const { path } = props;
  const title = noteTitle(path);
  useEffect(() => {
    setBody(null);
    setError(null);
    fetchNote(path).then(setBody, (err: Error) => setError(err.message));
  }, [path]);
  const html = useMemo(() => (body === null || !vault ? "" : safeHtml(renderNote(body, path, vault))), [body, vault, path]);
  // A link to a heading: there once the note is in.
  useEffect(() => {
    if (!html || !props.heading) return;
    content.current?.querySelector(`#${CSS.escape(props.heading)}`)?.scrollIntoView({ block: "start" });
  }, [html, props.heading]);
  const token = selection.length === 1 ? items[selection[0]] : undefined;
  const linkable = token?.kind === "token" ? (token as TokenItem) : null;
  const linked = linkable ? tokenNotes[linkable.id] === path : false;

  const show = () => {
    const el = content.current;
    if (!el) return;
    const sel = window.getSelection();
    let part: string | null = null;
    if (sel && !sel.isCollapsed && sel.anchorNode && sel.focusNode && el.contains(sel.anchorNode) && el.contains(sel.focusNode)) {
      const div = document.createElement("div");
      for (let i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
      part = div.innerHTML;
    }
    // The whole note leaves out its properties and the GM's own callouts.
    const whole = el.cloneNode(true) as HTMLElement;
    whole.querySelectorAll("[data-secret], .note-props").forEach((n) => n.remove());
    const out = safeHtml(part ?? whole.innerHTML, { players: true });
    if (!out.replace(/<[^>]*>/g, "").trim() && !/<img/.test(out)) {
      room.toast("There's nothing in that to show.", "error");
      return;
    }
    room.showHandout(title, out);
    room.toast(part ? `The part you picked of ${title} is shown to the players.` : `${title} is shown to the players.`);
  };

  return (
    <div class="note-view">
      <div class="note-head">
        <button class="icon-btn" title={props.back ? "Back" : "All your notes"} aria-label={props.back ? "Back" : "All your notes"} onClick={() => (props.back ? props.back() : room.openNote(null))}>
          <ArrowLeft size={16} />
        </button>
        <div class="note-name">
          <h3>{title}</h3>
          <span class="small muted">{path.split("/").slice(0, -1).join(" › ") || "Your vault"}</span>
        </div>
      </div>
      <div class="note-actions">
        <button class="btn btn-sm" title="Show the players this note, or only the part you've picked (highlight it first). Your own callouts and properties stay hidden." onClick={show} disabled={!html}>
          <Send size={14} /> Show to players
        </button>
        {linkable && (
          <button
            class={cx("btn btn-sm", linked && "active")}
            title={linked ? `${linkable.label || "The token"} is linked to this note: click to unlink it` : `Link ${linkable.label || "the selected token"} to this note`}
            onClick={() => room.setTokenNote(linkable.id, linked ? null : path)}
          >
            {linked ? <Link2Off size={14} /> : <Link2 size={14} />} {linked ? "Unlink" : "Link to"} {linkable.label || "token"}
          </button>
        )}
      </div>
      {error && <p class="small error-text">{error}</p>}
      {body === null && !error && <p class="small muted">Opening…</p>}
      <div
        class="note-body"
        ref={content}
        onClick={(e) => {
          const a = (e.target as Element).closest("a");
          if (!a) return;
          const note = a.getAttribute("data-note");
          const heading = a.getAttribute("data-heading");
          if (note) {
            e.preventDefault();
            props.open(note, heading ?? undefined);
          } else if (heading) {
            e.preventDefault();
            content.current?.querySelector(`#${CSS.escape(heading)}`)?.scrollIntoView({ block: "start" });
          }
        }}
        // Cleaned by safeHtml: only plain formatting, links and the vault's own pictures.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function NotesPanel() {
  const room = useRoom();
  const vault = useRoomState((s) => s.vault);
  const open = useRoomState((s) => s.noteOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VaultSearchHit[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const [heading, setHeading] = useState<string | null>(null);
  // Google Drive: the vault script's address (undefined until it's read), and whether its setup shows.
  const [drive, setDrive] = useState<string | null | undefined>(undefined);
  const [driveOpen, setDriveOpen] = useState(false);
  const synced = useRef(false);
  // The notes opened before this one, for Back.
  const history = useRef<string[]>([]);
  const folder = useRef<HTMLInputElement>(null);
  // A folder picker (the whole vault), on every browser that has one: set as attributes, which Preact's properties don't do.
  useEffect(() => {
    folder.current?.setAttribute("webkitdirectory", "");
    folder.current?.setAttribute("directory", "");
  });
  useEffect(() => {
    if (room.state.vault === null) void loadVault(room).catch((err: Error) => room.toast(err.message, "error"));
  }, [room]);
  useEffect(() => {
    void loadDriveSource().then(setDrive, () => setDrive(null));
  }, []);
  const sync = async () => {
    setBusy("Asking Google Drive…");
    try {
      const r = await syncFromDrive(room, setBusy);
      room.toast(`Synced from Google Drive: ${r.notes} notes and ${r.files} pictures${r.skipped ? `, ${r.skipped} left out` : ""}.`);
    } catch (err) {
      room.toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  // With Google Drive linked, opening the notes brings in what's changed since the last time a while ago.
  useEffect(() => {
    if (!drive || !vault || synced.current || busy) return;
    synced.current = true;
    if (!vault.importedAt || Date.now() - vault.importedAt > DRIVE_STALE_MS) void sync();
  }, [drive, vault]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => void searchVault(q).then(setHits, () => setHits([])), 250);
    return () => clearTimeout(t);
  }, [query]);
  const tree = useMemo(() => (vault ? noteTree(vault.notes) : null), [vault]);

  const openNote = (path: string, h?: string) => {
    if (open && open !== path) history.current.push(open);
    setHeading(h ?? null);
    room.openNote(path);
  };
  const back = history.current.length
    ? () => {
        setHeading(null);
        room.openNote(history.current.pop() ?? null);
      }
    : null;
  const bringIn = async (files: File[]) => {
    if (!files.length) return;
    setBusy("Reading your vault…");
    try {
      const r = await importVault(room, files, setBusy);
      room.toast(`Your vault is in: ${r.notes} notes and ${r.files} pictures${r.skipped ? `, ${r.skipped} left out (too big, or not a picture Table shows)` : ""}.`);
    } catch (err) {
      room.toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };
  const picker = (
    <input
      ref={folder}
      type="file"
      hidden
      multiple
      onChange={(e) => {
        const files = [...(e.currentTarget.files ?? [])];
        e.currentTarget.value = "";
        void bringIn(files);
      }}
    />
  );

  if (!vault) return <div class="panel-body">{picker}<p class="muted small">Reading your notes…</p></div>;
  if (!vault.importedAt && !vault.notes.length) {
    return (
      <div class="panel-body notes-panel">
        {picker}
        <div class="notes-intro">
          <BookOpen size={28} />
          <h3>Your Obsidian notes, in Table</h3>
          <p class="small">
            Bring in your vault to read your notes during a game, show the players a note (or part of one) as a handout, and link notes to tokens. Only you see
            them; players see only what you show them.
          </p>
          <button class="btn btn-primary" disabled={!!busy} onClick={() => folder.current?.click()}>
            <FolderOpen size={16} /> Choose your vault's folder
          </button>
          {drive ? (
            <button class="btn" disabled={!!busy} onClick={() => void sync()}>
              <Cloud size={16} /> Sync from Google Drive
            </button>
          ) : (
            <button class="btn" onClick={() => setDriveOpen(!driveOpen)}>
              <Cloud size={16} /> Or use Google Drive
            </button>
          )}
          <p class="small muted">
            Pick the folder Obsidian opens as your vault (on Windows, a Mac or Ubuntu). Your notes and their pictures come in; Obsidian's own settings don't. When
            your notes change, bring it in again.
          </p>
          {busy && <p class="small notes-busy">{busy}</p>}
          {(driveOpen || drive) && drive !== undefined && <DriveSetup source={drive} saved={setDrive} />}
        </div>
      </div>
    );
  }
  return (
    <div class="panel-body notes-panel">
      {picker}
      <div class="row notes-tools">
        <span class="notes-search">
          <Search size={14} />
          <input value={query} placeholder="Find in your notes" aria-label="Find in your notes" onInput={(e) => setQuery(e.currentTarget.value)} />
        </span>
        {drive && (
          <button class="btn btn-sm" disabled={!!busy} title="Bring your vault in again from Google Drive" onClick={() => void sync()}>
            <Cloud size={14} /> Sync
          </button>
        )}
        <button class="btn btn-sm" disabled={!!busy} title="Bring your vault in again, after your notes change: pick its folder" onClick={() => folder.current?.click()}>
          <RefreshCw size={14} /> Update
        </button>
      </div>
      <p class="small muted">
        {vault.notes.length} notes{vault.importedAt ? `, brought in ${new Date(vault.importedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}
      </p>
      {busy && <p class="small notes-busy">{busy}</p>}
      {open ? (
        <NoteView key={open} path={open} back={back} open={openNote} heading={heading} />
      ) : hits ? (
        <ul class="note-hits">
          {hits.length === 0 && <li class="small muted">Nothing found.</li>}
          {hits.map((h) => (
            <li key={h.path}>
              <button class="link-btn note-link" onClick={() => openNote(h.path)}>
                {h.title}
              </button>
              <span class="small muted">{h.snippet}</span>
            </li>
          ))}
        </ul>
      ) : (
        tree && <FolderView folder={tree} open={(p) => openNote(p)} />
      )}
      {!open && (
        <p class="small muted notes-out">
          <button class="link-btn" onClick={() => setDriveOpen(!driveOpen)}>
            {drive ? "Google Drive is linked" : "Use Google Drive"}
          </button>
          {" · "}
          <button class="link-btn" onClick={() => setClearing(true)}>
            Take your notes out of Table
          </button>
        </p>
      )}
      {!open && driveOpen && drive !== undefined && <DriveSetup source={drive} saved={setDrive} />}
      {clearing && (
        <ConfirmDialog
          title="Take your notes out of Table?"
          message="Your notes and their pictures leave Table (your vault itself isn't touched). Handouts already shown stay."
          confirmLabel="Take them out"
          danger
          onConfirm={() => void clearVault(room).catch((err: Error) => room.toast(err.message, "error"))}
          onClose={() => setClearing(false)}
        />
      )}
    </div>
  );
}

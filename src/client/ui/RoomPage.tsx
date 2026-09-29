import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CircleQuestionMark,
  House,
  Images,
  Layers,
  Link,
  MessageSquare,
  Monitor,
  RotateCw,
  Settings,
  Swords,
  WifiOff,
  X,
} from "lucide-preact";
import { roomUrl } from "../api";
import { PLAYER_COLORS, loadProfile, saveProfile } from "../identity";
import type { Profile } from "../identity";
import { Board } from "../room/board";
import { RoomClient } from "../room/client";
import type { PanelId, RoomState } from "../room/client";
import type { WheelPref } from "../room/buildInput";
import { ChatPanel, RollView } from "./ChatPanel";
import { InitiativePanel } from "./InitiativePanel";
import { LibraryPanel } from "./LibraryPanel";
import { Logo } from "./Logo";
import { NewSceneDialog, ScenesPanel } from "./ScenesPanel";
import { SeasonButton } from "./SeasonPicker";
import { SelectionBar } from "./SelectionBar";
import { SettingsPanel } from "./SettingsPanel";
import { TableDisplayDialog } from "./TableDisplay";
import { BuildHints, BuildSelectionBar, ToolOptions, Toolbar, ZoomControls } from "./Toolbar";
import { Modal, RoomContext, Swatches, copyText, cx, useRoom, useRoomState } from "./common";

export function RoomPage(props: { roomId: string }) {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  if (!profile.name) {
    return (
      <div class="center-page">
        <ProfileForm
          title="Join the game"
          initial={profile}
          submitLabel="Join"
          onSubmit={(name, color) => {
            const next = { ...profile, name, color };
            saveProfile(next);
            setProfile(next);
          }}
        />
      </div>
    );
  }
  return <RoomView roomId={props.roomId} profile={profile} />;
}

function ProfileForm(props: {
  title: string;
  initial: Profile;
  submitLabel: string;
  onSubmit: (name: string, color: string) => void;
  bare?: boolean;
}) {
  const [name, setName] = useState(props.initial.name);
  const [color, setColor] = useState(props.initial.color);
  const body = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) props.onSubmit(name.trim(), color);
      }}
    >
      <label class="field">
        <span>Your name</span>
        <input
          value={name}
          maxLength={32}
          autoFocus
          placeholder="What should everyone call you?"
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>
      <div class="field">
        <span>Your colour</span>
        <Swatches colors={PLAYER_COLORS} value={color} onPick={setColor} />
      </div>
      <div class="dialog-actions">
        <button class="btn btn-primary" disabled={!name.trim()}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
  if (props.bare) return body;
  return (
    <div class="card join-card">
      <div class="home-brand">
        <Logo size={36} />
        <h1>{props.title}</h1>
      </div>
      {body}
    </div>
  );
}

function RoomView(props: { roomId: string; profile: Profile }) {
  const room = useMemo(() => new RoomClient(props.roomId, props.profile), [props.roomId]);
  useEffect(() => {
    room.connect();
    // Development builds only: lets you inspect the room from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __room: RoomClient }).__room = room;
    return () => room.dispose();
  }, [room]);
  return (
    <RoomContext.Provider value={room}>
      <RoomShell />
    </RoomContext.Provider>
  );
}

function RoomShell() {
  const status = useRoomState((s) => s.status);
  const hasHello = useRoomState((s) => s.me !== null);
  const panel = useRoomState((s) => s.panel);

  if (status === "notfound" || status === "deleted") {
    return (
      <div class="center-page">
        <div class="card">
          <h1>{status === "deleted" ? "This room was deleted" : "Room not found"}</h1>
          <p class="muted">
            {status === "deleted"
              ? "The GM deleted this room, along with everything in it."
              : "Check the link with your GM. The room may have been deleted."}
          </p>
          <a class="btn btn-primary" href="/">
            Go to the start page
          </a>
        </div>
      </div>
    );
  }
  if (!hasHello) {
    return (
      <div class="center-page muted">
        <div class="joining">
          <Logo size={40} />
          <span>{status === "connecting" ? "Joining the room…" : "Reconnecting…"}</span>
        </div>
      </div>
    );
  }
  return (
    <div class="room">
      <TopBar />
      <div class="main">
        <div class="stage-area">
          <BoardView />
          <Toolbar />
          <ToolOptions />
          <BuildHints />
          <PreviewBanner />
          <GridAlignBanner />
          <SelectionBar />
          <BuildSelectionBar />
          <ZoomControls />
          <Toasts />
          <NoteDialog />
          <MapImportDialog />
          {status === "reconnecting" && (
            <div class="reconnecting">
              <WifiOff size={16} /> Connection lost. Reconnecting…
            </div>
          )}
        </div>
        {panel && <SidePanel panel={panel} />}
      </div>
    </div>
  );
}

export function BoardView() {
  const room = useRoom();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = new Board(ref.current!, room);
    return () => board.destroy();
  }, [room]);
  return <div class="board" ref={ref} />;
}

const PANELS: { id: PanelId; label: string; icon: typeof MessageSquare; gm?: boolean }[] = [
  { id: "chat", label: "Chat & dice", icon: MessageSquare },
  { id: "library", label: "Tokens & images", icon: Images },
  { id: "initiative", label: "Initiative", icon: Swords },
  { id: "scenes", label: "Scenes", icon: Layers, gm: true },
  { id: "settings", label: "Room settings", icon: Settings, gm: true },
];

function TopBar() {
  const room = useRoom();
  const name = useRoomState((s) => s.room?.name ?? "");
  const gm = useRoomState((s) => s.me?.role === "gm");
  const sceneName = useRoomState((s) => (s.viewSceneId ? (s.scenes[s.viewSceneId]?.name ?? "") : ""));
  const panel = useRoomState((s) => s.panel);
  const unread = useRoomState((s) => s.unread);
  // Table displays aren't people: they're counted on the display button instead.
  const allPlayers = useRoomState((s) => s.players);
  const players = allPlayers.filter((p) => !p.display);
  const displays = allPlayers.length - players.length;
  const outdated = useRoomState((s) => s.outdated);
  const [copied, setCopied] = useState(false);
  const [help, setHelp] = useState(false);
  const [display, setDisplay] = useState(false);

  return (
    <header class="topbar">
      {gm ? (
        <a class="icon-btn" href="/" title="All rooms" aria-label="All rooms">
          <House size={18} />
        </a>
      ) : (
        <span class="topbar-logo">
          <Logo size={24} />
        </span>
      )}
      <div class="topbar-title">
        <span class="room-name">{name}</span>
        {sceneName && <span class="scene-name">{sceneName}</span>}
      </div>
      <div class="spacer" />
      {outdated && (
        <button
          class="btn btn-primary btn-sm update-btn"
          title="Tabletop has been updated. Reload this page to get the new version."
          onClick={() => location.reload()}
        >
          <RotateCw size={14} /> <span class="hide-narrow">Update:</span> Reload
        </button>
      )}
      <div class="player-dots" title={players.map((p) => p.name + (p.role === "gm" ? " (GM)" : "")).join(", ")}>
        {players.slice(0, 6).map((p) => (
          <span key={p.connId} class={cx("player-dot", p.role === "gm" && "gm")} style={{ background: p.color }}>
            {Array.from(p.name)[0]?.toUpperCase()}
          </span>
        ))}
        {players.length > 6 && <span class="player-dot more">+{players.length - 6}</span>}
      </div>
      <button
        class="icon-btn"
        title="Copy invite link"
        aria-label="Copy invite link"
        onClick={async () => {
          if (await copyText(roomUrl(room.roomId))) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } else {
            room.toast(`Invite link: ${roomUrl(room.roomId)}`);
          }
        }}
      >
        {copied ? <span class="small">Copied</span> : <Link size={18} />}
      </button>
      {gm && <SeasonButton />}
      {gm && (
        <button
          class="icon-btn hide-narrow display-btn"
          title={displays ? `Table display (${displays} connected)` : "Table display: show the map on a second screen"}
          aria-label="Table display"
          onClick={() => setDisplay(true)}
        >
          <Monitor size={18} />
          {displays > 0 && <span class="live-dot" />}
        </button>
      )}
      <button class="icon-btn hide-narrow" title="Help & shortcuts" aria-label="Help and shortcuts" onClick={() => setHelp(true)}>
        <CircleQuestionMark size={18} />
      </button>
      <div class="topbar-sep" />
      {PANELS.filter((p) => !p.gm || gm).map((p) => (
        <button
          key={p.id}
          class={cx("icon-btn", panel === p.id && "active")}
          title={p.label}
          aria-label={p.label}
          aria-pressed={panel === p.id}
          onClick={() => room.setPanel(panel === p.id ? null : p.id)}
        >
          <p.icon size={18} />
          {p.id === "chat" && unread > 0 && <span class="badge">{unread > 99 ? "99+" : unread}</span>}
        </button>
      ))}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {display && <TableDisplayDialog onClose={() => setDisplay(false)} />}
    </header>
  );
}

function SidePanel(props: { panel: PanelId }) {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const title = PANELS.find((p) => p.id === props.panel)?.label ?? "";
  let body = null;
  if (props.panel === "chat") body = <ChatPanel />;
  else if (props.panel === "library") body = <LibraryPanel />;
  else if (props.panel === "initiative") body = <InitiativePanel />;
  else if (props.panel === "scenes" && gm) body = <ScenesPanel />;
  else if (props.panel === "settings" && gm) body = <SettingsPanel />;
  return (
    <aside class="panel" aria-label={title}>
      <div class="panel-head">
        <h2>{title}</h2>
        <button class="icon-btn" onClick={() => room.setPanel(null)} aria-label="Close panel" title="Close">
          <X size={18} />
        </button>
      </div>
      {body}
    </aside>
  );
}

function GridAlignBanner() {
  const room = useRoom();
  const align = useRoomState((s) => s.gridAlign);
  if (!align) return null;
  return (
    <div class="preview-banner align-banner">
      <span>
        Zoom in and drag a box exactly over {align.cells}×{align.cells} of the map's squares, corner to corner.
      </span>
      <button class="btn btn-sm" onClick={() => room.store.set({ gridAlign: null })}>
        Cancel
      </button>
    </div>
  );
}

function PreviewBanner() {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const view = useRoomState((s) => s.viewSceneId);
  const active = useRoomState((s) => s.activeSceneId);
  const activeName = useRoomState((s) => (s.activeSceneId ? (s.scenes[s.activeSceneId]?.name ?? "") : ""));
  const tool = useRoomState((s) => s.tool);
  const ref = useRef<HTMLDivElement>(null);
  const shown = gm && !!view && view !== active;
  // Below the tool's options bar, whatever its height (the Build tool's can wrap), not over it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bar = el.parentElement?.querySelector<HTMLElement>(".tool-options");
    const narrow = window.matchMedia("(max-width: 760px)");
    const place = () => {
      el.style.top = bar?.isConnected && !narrow.matches ? `${bar.offsetTop + bar.offsetHeight + 8}px` : "";
    };
    place();
    const ro = new ResizeObserver(place);
    if (bar) ro.observe(bar);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [tool, shown]);
  if (!shown) return null;
  return (
    <div class="preview-banner" ref={ref}>
      <span>
        Only you can see this scene.{activeName ? ` Players are on “${activeName}”.` : " Players have no scene."}
      </span>
      <button class="btn btn-primary btn-sm" onClick={() => room.activateScene(view)}>
        Show to players
      </button>
      {active && (
        <button class="btn btn-sm" onClick={() => room.viewSceneLocally(active)}>
          Back to live scene
        </button>
      )}
    </div>
  );
}

function Toasts() {
  const room = useRoom();
  const toasts = useRoomState((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={cx("toast", `toast-${t.kind}`)} onClick={() => room.dismissToast(t.id)}>
          {t.kind === "roll" && t.message ? (
            <RollView message={t.message} compact />
          ) : (
            <span>{t.text}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Maps dropped or pasted onto the board go through the new-scene dialog. */
function MapImportDialog() {
  const room = useRoom();
  const files = useRoomState((s) => s.mapImport);
  if (!files) return null;
  const close = () => room.store.set({ mapImport: null });
  return (
    <NewSceneDialog
      files={files}
      onClose={close}
      onCreated={() => {
        close();
        room.setPanel("scenes");
      }}
    />
  );
}

function NoteDialog() {
  const at = useRoomState((s) => s.textPrompt);
  if (!at) return null;
  // Keyed so each opening starts from its own text.
  return <NoteForm key={at.editId ?? `${at.x},${at.y}`} at={at} />;
}

function NoteForm(props: { at: NonNullable<RoomState["textPrompt"]> }) {
  const room = useRoom();
  const { at } = props;
  const [text, setText] = useState(at.text ?? "");
  const [secret, setSecret] = useState(false);
  const gm = useRoomState((s) => s.me?.role === "gm");
  const close = () => room.store.set({ textPrompt: null });
  return (
    <Modal title={at.editId ? "Edit note" : "Add a note to the map"} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (at.editId) {
            if (text.trim()) room.change({ patch: [{ id: at.editId, set: { text: text.trim() } }] });
          } else {
            room.addNote(text, at, secret);
          }
          close();
        }}
      >
        <label class="field">
          <span>Text</span>
          <textarea
            rows={3}
            maxLength={500}
            value={text}
            autoFocus
            placeholder="e.g. Trapdoor, Room 4, Secret door"
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
          />
        </label>
        {gm && !at.editId && (
          <label class="check" title="Players never receive it. You can change this later with the eye button or H.">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.currentTarget.checked)} /> Only I can see this
            note
          </label>
        )}
        <p class="small muted">Enter adds it; Shift+Enter starts a new line. It uses the colour and size from the draw tool.</p>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn btn-primary" disabled={!text.trim()}>
            {at.editId ? "Save" : "Add note"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProfileDialog(props: { onClose: () => void }) {
  const room = useRoom();
  const seasonsOff = useRoomState((s) => s.seasonsOff);
  const gm = useRoomState((s) => s.me?.role === "gm");
  const wheelTurns = useRoomState((s) => s.wheelTurns);
  return (
    <Modal title="Your name and colour" onClose={props.onClose}>
      <ProfileForm
        bare
        title=""
        initial={room.profileInfo}
        submitLabel="Save"
        onSubmit={(name, color) => {
          room.setProfile(name, color);
          props.onClose();
        }}
      />
      <div class="device-settings">
        <h3>This device</h3>
        <label class="check">
          <input type="checkbox" checked={!seasonsOff} onChange={(e) => room.setSeasonsOff(!e.currentTarget.checked)} />
          Show seasons (snow, autumn leaves) on maps
        </label>
        <p class="small muted">
          Untick it if maps are slow to appear on this device: you'll see them as drawn. Everyone else still sees the season.
        </p>
        {gm && (
          <>
            <label class="field">
              <span>Mouse wheel over objects (Build tool)</span>
              <select value={wheelTurns} onChange={(e) => room.setWheelTurns(e.currentTarget.value as WheelPref)}>
                <option value="auto">Turns them, like Dungeondraft</option>
                <option value="always">Always turns them (smooth-scrolling mice, Mac mice)</option>
                <option value="never">Zooms, as elsewhere</option>
              </select>
            </label>
            <p class="small muted">A trackpad still moves the map unless you pick Always.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["V / D / E / M / P", "Move, Draw, Erase, Measure, Pointer"],
  ["Pointer: click without dragging", "Ping: rings pulse there for a few seconds, for everyone and on the table display"],
  ["F", "Fog tool (GM)"],
  ["B", "Build tool (GM): Building, Walls, Doors, Terrain, Objects and Select, named as in Dungeondraft"],
  ["Drag empty space, right-drag, or Space + drag", "Pan (in Build › Select a drag on empty space draws a selection box)"],
  [
    "Mouse wheel, Ctrl+wheel, pinch",
    "Zoom (in Build › Objects, and in Select with objects selected, the wheel turns them: zoom with Ctrl+wheel or pinch)",
  ],
  ["+ / − / 0", "Zoom in, out, fit the scene"],
  ["Shift+click, Shift+drag", "Add to the selection, select with a box (Build › Select too)"],
  ["Drag something selected", "Move the whole selection: tokens, drawings and notes"],
  ["Alt while dropping a token", "Don't snap to the grid"],
  ["Arrow keys", "Move the selected tokens one square (or hex)"],
  ["[ and ]", "Rotate the selected token 45° (Shift: 15°)"],
  ["Fog brush: [ and ]", "Smaller or bigger brush (Shift: bigger steps)"],
  ["Build tool: [ and ]", "Brush size, or turn objects 15° (Shift: 5°): the next one, or the selected ones"],
  ["Build tool: Alt", "Take away instead: cut out a room, erase terrain, remove walls, doors or objects"],
  ["Build tool: right-click", "Turn the next object, or the selected ones, 90°; finish walls placed corner by corner"],
  ["Build tool, Walls: click corners", "Walls between them; double-click, right-click or Enter finishes, Backspace takes a corner back"],
  ["X", "Build tool (GM): Select, and X again to go back, as in Dungeondraft"],
  ["Build tool: wheel, Z+wheel, Alt+wheel", "Turn objects 15°, turn them 5°, change their size (Objects: the next one; Select: the selected ones)"],
  ["Build › Select: click, Shift+click, drag", "Select objects (doors by clicking); Shift adds; click again for the one underneath"],
  ["Build › Select: drag, arrow keys", "Move the selected objects (Shift+arrows: five squares)"],
  ["Build › Select: Delete, Ctrl+D, Ctrl+C, Ctrl+V, Esc", "Delete, duplicate, copy, paste (other scenes and rooms too), deselect"],
  ["H / L", "Hide or lock the selected token (GM)"],
  ["Delete", "Delete the selection"],
  ["Ctrl+D", "Duplicate (copies are numbered: Goblin 2, Goblin 3)"],
  ["Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z)", "Undo / redo your own changes on this scene"],
  ["Fog polygon: click points", "Enter or click the first point to close, Backspace removes a point"],
  ["Measure tool", "Ruler or spell areas: circle, cone, cube, line (tick Pin to map to keep one)"],
  ["Draw tool, then the T button", "Text note: click where it goes"],
  ["Chat: /r 2d6+3", "Roll dice (also 4d6dl1, 2d20kh1, d%, 4dF)"],
  ["Ctrl+V", "Paste an image: a big one starts a new scene (GM), a small one becomes a token; in Build › Select, objects you copied"],
];

function HelpDialog(props: { onClose: () => void }) {
  return (
    <Modal title="Help & shortcuts" onClose={props.onClose} width={560}>
      <table class="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">
        Drag token images from the Tokens panel onto the map, or drop image files from your computer straight onto it.
        As the GM, dropping a map (a big image, or a Dungeondraft or other Universal VTT file) starts a new scene with it.
        The monitor button (GM) opens a table display: the map alone, as players see it, for a second screen or a TV.
      </p>
      <p class="small">
        <a href="/guide" target="_blank" rel="noopener">
          Read the full guide
        </a>{" "}
        (opens in a new tab)
      </p>
    </Modal>
  );
}

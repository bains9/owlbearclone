// Table display: the map on a second screen or a TV at the table, showing exactly
// what players see. The GM's dialog for opening one, and the display page itself.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Copy, ExternalLink, WifiOff } from "lucide-preact";
import { randomId } from "../../shared/ids";
import { api, displayUrl } from "../api";
import { RoomClient } from "../room/client";
import { Modal, RoomContext, copyText, cx, useRoom, useRoomState } from "./common";
import { BoardView } from "./RoomPage";

/** GM: open or copy the display link, and choose what the display shows. */
export function TableDisplayDialog(props: { onClose: () => void }) {
  const room = useRoom();
  const follow = useRoomState((s) => s.displayFollow);
  const displays = useRoomState((s) => s.players.filter((p) => p.display).length);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .displayKey(room.roomId)
      .then(({ key }) => setLink(displayUrl(room.roomId, key)))
      .catch((e: Error) => setError(e.message));
  }, [room]);

  const copy = async () => {
    if (!link) return;
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      room.toast(`Display link: ${link}`);
    }
  };

  return (
    <Modal title="Table display" onClose={props.onClose} width={480}>
      <p class="small">
        Show the map on a second screen or a TV at the table. It shows exactly what players see (never hidden tokens,
        GM-only notes or what's under the fog), and nothing can be changed from it.
      </p>
      {error && <p class="error-text small">{error}</p>}
      <div class="display-actions">
        <button
          class="btn btn-primary"
          disabled={!link}
          onClick={() => window.open(link!, "tabletop-display", "popup,width=1280,height=800")}
        >
          <ExternalLink size={16} /> Open display window
        </button>
        <button class="btn" disabled={!link} onClick={() => void copy()}>
          <Copy size={16} /> {copied ? "Copied" : "Copy display link"}
        </button>
      </div>
      <p class="small muted">
        Drag the window onto the other screen, then double-click it for full screen. For a TV, open the link in the TV's
        browser, or cast the display window from Chrome.
      </p>
      <div class="field">
        <span>The display shows</span>
        <label class="check">
          <input
            type="radio"
            name="display-view"
            checked={!follow}
            onChange={() => room.store.set({ displayFollow: false })}
          />{" "}
          The whole live scene
        </label>
        <label class="check">
          <input
            type="radio"
            name="display-view"
            checked={follow}
            onChange={() => room.store.set({ displayFollow: true })}
          />{" "}
          What I'm looking at, while I'm on the live scene
        </label>
      </div>
      <p class="small">
        {displays === 0 ? "No display is connected." : displays === 1 ? "1 display is connected." : `${displays} displays are connected.`}
      </p>
      <p class="small muted">
        Keep the display link to yourself: anyone with it sees the map as players do, and where you're looking.
      </p>
    </Modal>
  );
}

/** The display page: /r/<room>?display=<key>. */
export function DisplayPage(props: { roomId: string; displayKey: string }) {
  const [valid, setValid] = useState<boolean | null>(null);
  useEffect(() => {
    document.title = "Table display · Tabletop";
    api
      .checkDisplayKey(props.roomId, props.displayKey)
      .then((r) => setValid(r.valid))
      // Couldn't ask: try connecting anyway (it's refused if the link is wrong).
      .catch(() => setValid(true));
  }, [props.roomId, props.displayKey]);

  if (valid === false) {
    return (
      <div class="center-page">
        <div class="card">
          <h1>This display link isn't working</h1>
          <p class="muted">Open the room as the GM and use the Table display button to get the link again.</p>
        </div>
      </div>
    );
  }
  if (valid === null) return <div class="display-room" />;
  return <DisplayRoom roomId={props.roomId} displayKey={props.displayKey} />;
}

function DisplayRoom(props: { roomId: string; displayKey: string }) {
  // Its own throwaway identity: never the GM's, and never the profile saved in this browser.
  const room = useMemo(
    () => new RoomClient(props.roomId, { uid: randomId(16), name: "Table display", color: "#8a8f98" }, props.displayKey),
    [props.roomId, props.displayKey],
  );
  useEffect(() => {
    room.connect();
    return () => room.dispose();
  }, [room]);
  return (
    <RoomContext.Provider value={room}>
      <DisplayShell />
    </RoomContext.Provider>
  );
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function DisplayShell() {
  const status = useRoomState((s) => s.status);
  const hasHello = useRoomState((s) => s.me !== null);
  const hasScene = useRoomState((s) => !!(s.viewSceneId && s.scenes[s.viewSceneId]));
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The mouse pointer disappears after a few still seconds, like a video player's.
  const wake = () => {
    setIdle(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), 3000);
  };
  useEffect(() => {
    wake();
    const t = setTimeout(() => setHint(false), 8000);
    return () => {
      clearTimeout(t);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (status === "notfound" || status === "deleted") {
    return (
      <div class="center-page">
        <div class="card">
          <h1>{status === "deleted" ? "This room was deleted" : "Room not found"}</h1>
        </div>
      </div>
    );
  }
  return (
    <div class={cx("display-room", idle && "idle")} onPointerMove={wake} onDblClick={toggleFullscreen}>
      {hasHello && <BoardView />}
      {hasHello && !hasScene && <div class="display-empty">Waiting for the GM to show a scene</div>}
      {!hasHello && <div class="display-empty">Connecting…</div>}
      <DisplayTurn />
      {status === "reconnecting" && (
        <div class="display-status">
          <WifiOff size={16} /> Reconnecting…
        </div>
      )}
      {hint && hasHello && <div class="display-hint">Double-click for full screen</div>}
    </div>
  );
}

/** Whose turn it is, in a corner, while initiative is running. */
function DisplayTurn() {
  const init = useRoomState((s) => s.initiative);
  if (!init.entries.length) return null;
  const current = init.turn >= 0 ? init.entries[init.turn] : null;
  return (
    <div class="display-turn">
      <span class="muted">Round {init.round}</span>
      {current && (
        <span class="display-turn-name">
          <span class="dot" style={{ background: current.color }} />
          {current.name}
        </span>
      )}
    </div>
  );
}

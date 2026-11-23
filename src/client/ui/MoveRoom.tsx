// GM: Move to another room… (shared/roomMove.ts). The window that picks one of the GM's other rooms
// and one of its maps, moves the tokens chosen on the map there (worker/moveRoutes.ts), and says where
// they went, with a way to open that room. It lives outside the selection bar, which goes once the
// tokens have left: the window stays to say so.
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { navigate, noteArrival } from "../nav";
import { canChangeRoom, movedNames, movedText, whyStaying, type MoveResult, type RoomMap } from "../../shared/roomMove";
import type { RoomSummary, TokenItem } from "../../shared/types";
import { Modal, useRoom, useRoomState } from "./common";

export function MoveRoomDialog() {
  const room = useRoom();
  const ids = useRoomState((s) => s.moveRoom);
  if (!ids || !room.isGm) return null;
  return <MoveRoomWindow ids={ids} onClose={() => room.store.set({ moveRoom: null })} />;
}

function MoveRoomWindow(props: { ids: string[]; onClose: () => void }) {
  const room = useRoom();
  const items = useRoomState((s) => s.items);
  // While they're moving, as they were: they leave the map before the answer comes.
  const [sent, setSent] = useState<TokenItem[] | null>(null);
  const tokens = sent ?? props.ids.map((id) => items[id]).filter((i): i is TokenItem => i?.kind === "token");
  const going = tokens.filter(canChangeRoom);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [to, setTo] = useState("");
  const [maps, setMaps] = useState<RoomMap[] | null>(null);
  const [map, setMap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<MoveResult | null>(null);

  useEffect(() => {
    api.listRooms().then(
      (list) => setRooms(list.filter((r) => r.id !== room.roomId)),
      (err: Error) => {
        setRooms([]);
        setError(err.message);
      },
    );
  }, [room.roomId]);

  // Its maps once a room is chosen, the one its players see first.
  useEffect(() => {
    setMaps(null);
    setMap("");
    if (!to) return;
    let current = true;
    api.roomMaps(to).then(
      (list) => {
        if (!current) return;
        setMaps(list);
        setMap((list.find((m) => m.live) ?? list[0])?.id ?? "");
      },
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [to]);

  // Not while it's moving them: the answer would have nowhere to go.
  const close = () => {
    if (!busy) props.onClose();
  };

  if (done) {
    const open = (e: MouseEvent) => {
      // A plain click opens it here; Ctrl+click or the middle button, in a tab of its own.
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      noteArrival(`${movedNames(done.moved)} ${done.moved.length === 1 ? "is" : "are"} here now, on “${done.map.name}”.`, done.map.id);
      props.onClose();
      navigate(`/r/${done.room.id}`);
    };
    return (
      <Modal title="Moved to another room" onClose={props.onClose}>
        <p class="confirm-message">{movedText(done.moved, done.room.name, done.map.name)}</p>
        {done.stuck && <p class="error-text small">They couldn't be taken off this map, so they're in both rooms now. Delete them here.</p>}
        <div class="dialog-actions">
          <button class="btn" onClick={props.onClose}>
            Close
          </button>
          <a class="btn btn-primary" href={`/r/${done.room.id}`} onClick={open}>
            Open {done.room.name}
          </a>
        </div>
      </Modal>
    );
  }

  const move = async () => {
    setBusy(true);
    setSent(tokens);
    setError(null);
    try {
      setDone(await api.moveTokens(room.roomId, to, map, going.map((t) => t.id)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setSent(null);
    }
  };
  const staying = whyStaying(tokens);
  return (
    <Modal title="Move to another room" onClose={close}>
      {going.length ? (
        <p class="confirm-message">
          <strong>{movedNames(going.map((t) => t.label))}</strong> {going.length === 1 ? "goes" : "go"} to the map you choose, with{" "}
          {going.length === 1 ? "its picture, stats and HP" : "their pictures, stats and HP"} and the spells on {going.length === 1 ? "it" : "them"}, and{" "}
          {going.length === 1 ? "leaves" : "leave"} this room.
        </p>
      ) : (
        <p class="confirm-message">{tokens.length ? "None of these can move to another room." : "They aren't on the map any more."}</p>
      )}
      {staying.map((line) => (
        <p key={line} class="muted small">
          {line}
        </p>
      ))}
      {going.length > 0 &&
        (!rooms ? (
          <p class="muted small">Loading your rooms…</p>
        ) : !rooms.length && !error ? (
          <p class="muted small">You have no other room. Make one on the start page first.</p>
        ) : (
          <>
            <label class="field">
              <span>Room</span>
              <select value={to} disabled={busy} onChange={(e) => setTo(e.currentTarget.value)}>
                <option value="">Choose a room…</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {to && (
              <label class="field">
                <span>Map</span>
                {!maps ? (
                  <span class="muted small">Loading its maps…</span>
                ) : !maps.length ? (
                  <span class="muted small">That room has no maps. Make one there first.</span>
                ) : (
                  <select value={map} disabled={busy} onChange={(e) => setMap(e.currentTarget.value)}>
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.live ? " (players see this)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}
            <p class="muted small">
              They land in the middle of that map, standing as they stand now. Nobody's view changes: nobody goes with them, and anyone on that map sees them arrive
              unless they're hidden.
            </p>
          </>
        ))}
      {error && <p class="error-text small">{error}</p>}
      <div class="dialog-actions">
        <button class="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button class="btn btn-primary" disabled={busy || !going.length || !to || !map} onClick={move}>
          {busy ? "Moving…" : "Move"}
        </button>
      </div>
    </Modal>
  );
}

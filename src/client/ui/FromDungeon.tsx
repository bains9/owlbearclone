// New scene › From Dungeon: the GM's maps in Dungeon (dungeon.parhome.ca), listed and drawn by
// Dungeon itself through its bridge (dungeonBridge.ts). Picking one hands its .dd2vtt file to
// the dialog's usual import, just as dropping the file would, with the map's id so each scene
// remembers where it came from (for Update from Dungeon).

import { useEffect, useRef, useState } from "preact/hooks";
import { MAP_MAX_SIDE } from "../api";
import { savedWhen, withBridge, type DungeonBridge, type DungeonMap } from "../dungeonBridge";

/** Pixels per square to draw at: Dungeon's Export choices. */
export const DETAIL = [100, 128, 150, 200, 256];
const DETAIL_KEY = "tabletop.dungeonDetail";
const LIGHTING_KEY = "tabletop.dungeonLighting";

function remembered<T>(key: string, read: (v: string | null) => T): T {
  try {
    return read(localStorage.getItem(key));
  } catch {
    return read(null);
  }
}
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing: remembered until the page closes.
  }
}

const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function FromDungeon(props: {
  busy: boolean;
  working: string | null;
  setWorking: (text: string | null) => void;
  onFile: (file: File, link: { map: string; lighting: boolean; name: string }) => void;
  /** Maps with scenes in this room already. */
  inRoom: ReadonlySet<string>;
}) {
  const bridge = useRef<DungeonBridge | null>(null);
  const [maps, setMaps] = useState<DungeonMap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState(() => remembered(DETAIL_KEY, (v) => (DETAIL.includes(Number(v)) ? Number(v) : 128)));
  const [lighting, setLighting] = useState(() => remembered(LIGHTING_KEY, (v) => v === "1"));
  const [drawing, setDrawing] = useState(false);
  // What "Try again" does: the map that failed to come in (with the settings as they are then), else the list.
  const [failedMap, setFailedMap] = useState<DungeonMap | null>(null);
  const busy = drawing || props.busy;

  const load = () => {
    setFailedMap(null);
    setError(null);
    setMaps(null);
    withBridge(bridge, (b) => b.list()).then(setMaps, (e) => setError(say(e)));
  };
  useEffect(() => {
    load();
    return () => {
      bridge.current?.close();
      bridge.current = null;
    };
  }, []);

  const bringIn = async (m: DungeonMap) => {
    if (busy) return;
    setFailedMap(m);
    setDrawing(true);
    setError(null);
    props.setWorking(`Dungeon is drawing ${m.name}…`);
    try {
      const { file, name } = await withBridge(bridge, (b) =>
        b.file(m.id, detail, MAP_MAX_SIDE, lighting, (level, of) => {
          if (of > 1) props.setWorking(`Dungeon is drawing level ${level} of ${of}…`);
        }),
      );
      props.setWorking(null);
      setFailedMap(null);
      props.onFile(file, { map: m.id, lighting, name });
    } catch (e) {
      props.setWorking(null);
      setError(say(e));
    } finally {
      setDrawing(false);
    }
  };

  return (
    <div class="from-dungeon">
      <label class="field">
        <span>Detail</span>
        <select
          value={detail}
          disabled={busy}
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            setDetail(n);
            remember(DETAIL_KEY, String(n));
          }}
        >
          {DETAIL.map((n) => (
            <option key={n} value={n}>
              {n} pixels per square
            </option>
          ))}
        </select>
      </label>
      <label class="check" title="Tabletop has no lighting of its own: tick this to keep the light and dark Dungeon shows">
        <input
          type="checkbox"
          checked={lighting}
          disabled={busy}
          onChange={(e) => {
            setLighting(e.currentTarget.checked);
            remember(LIGHTING_KEY, e.currentTarget.checked ? "1" : "0");
          }}
        />{" "}
        Paint Dungeon's lighting into the picture
      </label>
      {props.working && <p class="small">{props.working}</p>}
      {error && (
        <p class="small error-text">
          {error}{" "}
          <button class="link-btn" onClick={() => (failedMap ? void bringIn(failedMap) : load())}>
            Try again
          </button>
        </p>
      )}
      {maps === null ? (
        !error && <p class="muted small">Asking Dungeon for your maps…</p>
      ) : maps.length === 0 ? (
        <p class="muted small">No maps in Dungeon yet. Maps you make there show up here once they're saved online.</p>
      ) : (
        <ul class="dungeon-maps">
          {maps.map((m) => (
            <li key={m.id}>
              <button class="dungeon-map" disabled={busy} onClick={() => void bringIn(m)} title="Bring this map in: a scene for each level">
                <span class="dungeon-map-name">{m.name}</span>
                <span class="small muted">
                  {props.inRoom.has(m.id) ? "In this room · " : ""}
                  {savedWhen(m.updated)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="small muted">
        Your maps in Dungeon, newest first. Each level becomes a scene. Dungeon draws the map just as its Export does, at most {MAP_MAX_SIDE} pixels
        across, and this page pauses for a moment while it does. A map that's in this room already can be refreshed instead with{" "}
        <strong>Update from Dungeon</strong> on its scenes.
      </p>
    </div>
  );
}

// Edit scene › Lighting and line of sight (GM): turn it on, day or dark, how far the party's own
// light reaches, and the walls, doors and lights it goes by (from the map's file: a scene from
// Dungeon or any Universal VTT file has them; Update from Dungeon brings them again). The Build
// tool's walls and doors count too. The darkness itself is drawn by the board (room/vision.ts),
// and what the party has explored is kept by the Room (shared/explore.ts); the GM can forget it.

import { useRef, useState } from "preact/hooks";
import type { Scene, SceneVision } from "../../shared/types";
import { exploreGrid, hasCell } from "../../shared/explore";
import { SIGHT_RANGE, VISION_LIMITS } from "../../shared/sanitize";
import { PARTY_LIGHT, visionFromSight } from "../importScenes";
import { parseUniversalVttLevels } from "../mapImport";
import { ConfirmDialog, useRoom, useRoomState } from "./common";

const NONE: SceneVision = { on: false, daylight: true, partyLight: PARTY_LIGHT, sightRange: SIGHT_RANGE, walls: [], doors: [], lights: [] };

export function LightingSettings(props: { scene: Scene }) {
  const room = useRoom();
  const s = props.scene;
  const v = s.vision ?? NONE;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [forget, setForget] = useState(false);
  const set = (change: Partial<SceneVision>) => room.updateScene(s.id, { vision: { ...v, ...change } });
  // How much of the scene the party has explored, in per cent (0 for none).
  const kept = useRoomState((st) => st.explored[s.id]);
  const grid = exploreGrid(s);
  let explored = 0;
  if (kept && kept.key === grid.key) {
    let n = 0;
    for (let i = 0, total = grid.cols * grid.rows; i < total; i++) if (hasCell(kept.bits, i)) n++;
    explored = (n / (grid.cols * grid.rows)) * 100;
  }

  // Walls, doors and lights from a map file, for a scene brought in without them (or before Tabletop read them).
  const load = async (file: File) => {
    setBusy(true);
    try {
      const maps = parseUniversalVttLevels(await file.text(), file.name);
      const map = maps[s.dungeon && s.dungeon.index < maps.length ? s.dungeon.index : 0];
      if (!map?.sight) {
        room.toast(`${file.name} has no walls, doors or lights in it.`, "error");
        return;
      }
      const perSquare = s.mapRect ? s.width / s.mapRect[2] : s.grid.size;
      const next = visionFromSight(map.sight, perSquare, s.vision);
      room.updateScene(s.id, { vision: next });
      room.toast(`From ${file.name}: ${next.walls.length} walls, ${next.doors.length} doors and ${next.lights.length} lights.`);
    } catch (err) {
      room.toast(`${file.name} ${(err as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Lighting and line of sight</h3>
      <p class="small muted">
        Players see only what the party can see: walls and shut doors block their sight, and in the dark they see only what a light, or the party's own light, falls
        on. The party sees from the characters' tokens and the tokens players put down. You see the dark dimmed (fog's player view shows it whole).
      </p>
      <label class="check">
        <input type="checkbox" checked={v.on} onChange={(e) => set({ on: e.currentTarget.checked })} />
        <span>On for this scene</span>
      </label>
      {v.on && (
        <>
          <div class="row" role="radiogroup" aria-label="Day or dark">
            <label class="check">
              <input type="radio" name={`light-${s.id}`} checked={v.daylight} onChange={() => set({ daylight: true })} />
              <span>Daylight: lit all over</span>
            </label>
            <label class="check">
              <input type="radio" name={`light-${s.id}`} checked={!v.daylight} onChange={() => set({ daylight: false })} />
              <span>Dark</span>
            </label>
          </div>
          {!v.daylight && (
            <label class="field">
              <span>The party's own light (squares)</span>
              <input
                type="number"
                min={0}
                max={VISION_LIMITS.partyLight}
                value={v.partyLight}
                onChange={(e) => {
                  const n = Math.round(Number(e.currentTarget.value));
                  if (Number.isFinite(n)) set({ partyLight: Math.max(0, Math.min(VISION_LIMITS.partyLight, n)) });
                }}
              />
            </label>
          )}
          <label class="field">
            <span>How far the party sees (squares; 0: as far as the walls allow)</span>
            <input
              type="number"
              min={0}
              max={VISION_LIMITS.sightRange}
              value={v.sightRange}
              onChange={(e) => {
                const n = Math.round(Number(e.currentTarget.value));
                if (Number.isFinite(n)) set({ sightRange: Math.max(0, Math.min(VISION_LIMITS.sightRange, n)) });
              }}
            />
          </label>
          <p class="small muted">Click a door's marker on the map to open or shut it (brown: shut; green: open). The fog of war still covers what it covers.</p>
          <p class="small muted">
            Places the party has seen stay on the map for players, dimmed, without the tokens in them
            {explored > 0 ? ` (${explored < 1 ? "under 1" : Math.round(explored)}% of this scene so far)` : ""}.
          </p>
          <button class="btn btn-sm" disabled={!explored} onClick={() => setForget(true)}>
            Forget what the party has explored
          </button>
          {forget && (
            <ConfirmDialog
              title="Forget what the party has explored?"
              message="Players will see only what the party sees now; the places they've been go dark again."
              confirmLabel="Forget it"
              onConfirm={() => room.resetExplored(s.id)}
              onClose={() => setForget(false)}
            />
          )}
        </>
      )}
      <p class="small muted">
        From the map: {v.walls.length} walls, {v.doors.length} doors, {v.lights.length} lights. Walls and doors made with the Build tool count too.
      </p>
      <button class="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        Load walls, doors and lights from a map file
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".dd2vtt,.df2vtt,.uvtt,.json"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void load(f);
        }}
      />
    </>
  );
}

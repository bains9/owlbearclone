// Edit scene › Lighting and line of sight (GM): turn it on, day or dark, how far the party's own
// light reaches, and the walls, doors and lights it goes by (from the map's file: a scene from
// Dungeon or any Universal VTT file has them; Update from Dungeon brings them again). The Build
// tool's walls and doors count too. The darkness itself is drawn by the board (room/vision.ts),
// and what the party has explored is kept by the Room (shared/explore.ts); the GM can forget it.

import { useRef, useState } from "preact/hooks";
import type { Scene, SceneVision } from "../../shared/types";
import { exploreGrid, hasCell } from "../../shared/explore";
import { PARTY_LIGHT, SIGHT_RANGE, VISION_LIMITS } from "../../shared/sanitize";
import { defaultVisionDistances, distanceIn, visionSquares } from "../../shared/units";
import type { GridUnits } from "../../shared/units";
import { visionFromSight } from "../importScenes";
import { parseUniversalVttLevels } from "../mapImport";
import { ConfirmDialog, useRoom, useRoomState } from "./common";

/** A scene's lighting before the GM sets any: off, with the distances it begins with in the scene's unit. */
const none = (units: GridUnits): SceneVision => ({
  on: false,
  daylight: true,
  partyLight: PARTY_LIGHT,
  sightRange: SIGHT_RANGE,
  walls: [],
  doors: [],
  lights: [],
  ...defaultVisionDistances(units),
});

const tenth = (n: number) => Math.round(n * 10) / 10;
const squaresText = (n: number) => `${tenth(n)} square${tenth(n) === 1 ? "" : "s"}`;

export function LightingSettings(props: { scene: Scene }) {
  const room = useRoom();
  const s = props.scene;
  const v = s.vision ?? none(s.grid);
  // Sight and light as distances in the scene's unit (a scene from before distances has squares).
  const unitName = s.grid.unitName;
  const squares = visionSquares(v, s.grid);
  const lightAt = tenth(v.light ? distanceIn(v.light, unitName) : v.partyLight * s.grid.unit);
  const sightAt = tenth(v.sight ? distanceIn(v.sight, unitName) : v.sightRange * s.grid.unit);
  const setDistance = (which: "light" | "sight", raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    const most = (which === "light" ? VISION_LIMITS.partyLight : VISION_LIMITS.sightRange) * s.grid.unit;
    set({ [which]: { d: tenth(Math.min(n, most)), unit: unitName } });
  };
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
      const next = visionFromSight(map.sight, perSquare, s.vision, s.grid);
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
          <div class="row" role="radiogroup" aria-label="Day, night or dark">
            <label class="check">
              <input type="radio" name={`light-${s.id}`} checked={v.daylight} onChange={() => set({ daylight: true, night: false })} />
              <span>Daylight: lit all over</span>
            </label>
            <label class="check">
              <input type="radio" name={`light-${s.id}`} checked={!v.daylight && !!v.night} onChange={() => set({ daylight: false, night: true })} />
              <span>Night: moon or starlight</span>
            </label>
            <label class="check">
              <input type="radio" name={`light-${s.id}`} checked={!v.daylight && !v.night} onChange={() => set({ daylight: false, night: false })} />
              <span>Dark: underground</span>
            </label>
          </div>
          {!v.daylight && v.night && (
            <p class="small muted">
              Characters with nightvision see in black and white, as far as the party sees: the elves (Nyloran, Sylvan, Duga) to 100 m, half-elves to 50 m, from
              their sheet's race. Everyone else sees only what the lights and the party's own light show.
            </p>
          )}
          {!v.daylight && (
            <label class="field">
              <span>
                The party's own light, in {unitName} ({squaresText(squares.light)})
              </span>
              <input
                type="number"
                min={0}
                step="any"
                max={VISION_LIMITS.partyLight * s.grid.unit}
                value={lightAt}
                onChange={(e) => setDistance("light", e.currentTarget.value)}
              />
            </label>
          )}
          <label class="field">
            <span>
              How far the party sees, in {unitName} ({squares.sight > 0 ? squaresText(squares.sight) : "0: as far as the walls allow"})
            </span>
            <input
              type="number"
              min={0}
              step="any"
              max={VISION_LIMITS.sightRange * s.grid.unit}
              value={sightAt}
              onChange={(e) => setDistance("sight", e.currentTarget.value)}
            />
          </label>
          <label class="check">
            <input type="checkbox" checked={!!v.perPlayer} onChange={(e) => set({ perPlayer: e.currentTarget.checked })} />
            <span>Each player sees only through their own character</span>
          </label>
          <p class="small muted">
            {v.perPlayer
              ? "Players pick who they play in the party list (Tokens & images). Each sees through their character's token and the tokens they put down, and keeps their character's own explored map; a player with no token on this scene sees with the whole party. To check, use fog's player view and Look as."
              : "Off: the whole party sees together, through every character's token."}
          </p>
          <label class="check">
            <input type="checkbox" checked={!v.passWalls} onChange={(e) => set({ passWalls: e.currentTarget.checked ? undefined : true })} />
            <span>Walls and shut doors stop players' tokens</span>
          </label>
          <p class="small muted">Click a door's marker on the map to open or shut it (brown: shut; green: open). The fog of war still covers what it covers.</p>
          <p class="small muted">
            Click a light's marker (a dot of its colour) to give it a colour, or make it flicker like a torch. A light's colour from Dungeon comes with it.
          </p>
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

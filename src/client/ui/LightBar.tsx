// GM, lighting on: the light picked on the map (its marker clicked with Move & select; dragging
// the marker moves it). Its colour, which tints what it falls on in the dark, whether it flickers
// like a torch or a fire, how far it reaches, and Remove. Kept in the scene with its map file's
// lights, so a new picture from Dungeon keeps them for a light in the same spot (and keeps the
// lights the GM added).

import { Trash, X } from "lucide-preact";
import type { SceneLight } from "../../shared/types";
import { Swatches, useRoom, useRoomState } from "./common";

/** Candle, torch, fire, moonlight, a green and a violet glow, blood red. */
export const LIGHT_COLORS = ["#ffc27a", "#ff9a3c", "#ff5a1f", "#9fd3ff", "#7dff9b", "#c38cff", "#ff3b3b"];

export function LightBar() {
  const room = useRoom();
  const pick = useRoomState((s) => s.lightPick);
  const scene = useRoomState((s) => (s.lightPick && s.viewSceneId === s.lightPick.sceneId ? s.scenes[s.viewSceneId] : undefined));
  const gm = useRoomState((s) => s.me?.role === "gm");
  const picking = useRoomState((s) => s.selection.length === 0);
  const v = scene?.vision;
  const light = pick && v ? v.lights[pick.index] : undefined;
  if (!gm || !picking || !scene || !v?.on || !pick || !light) return null;
  const g = scene.grid;
  const set = (change: Partial<SceneLight>) => {
    const next = { ...light, ...change };
    if (!next.color) delete next.color;
    if (!next.flicker) delete next.flicker;
    room.updateScene(scene.id, { vision: { ...v, lights: v.lights.map((l, i) => (i === pick.index ? next : l)) } });
  };
  return (
    <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
      <strong class="light-bar-title">Light</strong>
      <Swatches colors={LIGHT_COLORS} value={light.color ?? null} onPick={(color) => set({ color })} size="sm" custom />
      <button class="btn btn-sm" disabled={!light.color} title="Plain light: no colour" onClick={() => set({ color: undefined })}>
        Plain
      </button>
      <label class="check" title="It wavers, as a torch or a fire does">
        <input type="checkbox" checked={!!light.flicker} onChange={(e) => set({ flicker: e.currentTarget.checked })} />
        <span>Flickers</span>
      </label>
      <label class="field inline" title="How far its light reaches">
        <span>Reach</span>
        <input
          type="number"
          class="rounds-input"
          min={0.5}
          step="any"
          value={Math.round((light.r / g.size) * g.unit * 10) / 10}
          onChange={(e) => {
            const d = Number(e.currentTarget.value);
            if (Number.isFinite(d) && d > 0) set({ r: Math.min(g.size * 60, Math.max(g.size * 0.5, (d / g.unit) * g.size)) });
          }}
        />
        <span>{g.unitName}</span>
      </label>
      <button
        class="icon-btn danger"
        title={light.own ? "Remove this light" : "Remove this light (it comes back if the map is brought in again)"}
        aria-label="Remove this light"
        onClick={() => {
          room.store.set({ lightPick: null });
          room.updateScene(scene.id, { vision: { ...v, lights: v.lights.filter((_, i) => i !== pick.index) } });
        }}
      >
        <Trash size={16} />
      </button>
      <button class="icon-btn" title="Done" aria-label="Done" onClick={() => room.store.set({ lightPick: null })}>
        <X size={16} />
      </button>
    </div>
  );
}

// GM, lighting on: the light picked on the map (its marker clicked with Move & select). Its colour,
// which tints what it falls on in the dark, and whether it flickers like a torch or a fire. Kept in
// the scene with its map file's lights, so a new picture from Dungeon keeps them for a light in the
// same spot.

import { X } from "lucide-preact";
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
  const set = (change: Partial<SceneLight>) => {
    const next = { ...light, ...change };
    if (!next.color) delete next.color;
    if (!next.flicker) delete next.flicker;
    room.updateScene(scene.id, { vision: { ...v, lights: v.lights.map((l, i) => (i === pick.index ? next : l)) } });
  };
  return (
    <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
      <span class="selbar-label">Light</span>
      <Swatches colors={LIGHT_COLORS} value={light.color ?? null} onPick={(color) => set({ color })} size="sm" custom />
      <button class="btn btn-sm" disabled={!light.color} title="Plain light: no colour" onClick={() => set({ color: undefined })}>
        Plain
      </button>
      <label class="check" title="It wavers, as a torch or a fire does">
        <input type="checkbox" checked={!!light.flicker} onChange={(e) => set({ flicker: e.currentTarget.checked })} />
        <span>Flickers</span>
      </label>
      <button class="icon-btn" title="Done" aria-label="Done" onClick={() => room.store.set({ lightPick: null })}>
        <X size={16} />
      </button>
    </div>
  );
}

// GM, on a level of a map with several: which level this is, Up and Down to look at the next one
// (players stay where they are), and, on the level players see, Take the party up or down: the
// party's tokens (or the ones selected) to the same squares there, and that level shown to players.

import { ChevronDown, ChevronUp } from "lucide-preact";
import { levelOf, levelsOf, mapNameOf, partyOn, takeParty } from "../levels";
import type { Scene } from "../../shared/types";
import { useRoom, useRoomState } from "./common";

export function LevelBar() {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const scenes = useRoomState((s) => s.scenes);
  const scene = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : undefined));
  const live = useRoomState((s) => !!s.viewSceneId && s.activeSceneId === s.viewSceneId);
  const items = useRoomState((s) => s.items);
  const selection = useRoomState((s) => s.selection);
  if (!gm || !scene) return null;
  const levels = levelsOf(scenes, scene);
  if (levels.length < 2) return null;
  const i = levels.findIndex((s) => s.id === scene.id);
  const up: Scene | undefined = levels[i - 1];
  const down: Scene | undefined = levels[i + 1];
  const name = (s: Scene) => levelOf(s)?.name ?? s.name;
  const party = live ? partyOn(items, scene.id, selection) : [];
  const picked = party.some((t) => selection.includes(t.id));
  const who = picked ? (party.length === 1 ? party[0].label || "the token selected" : `the ${party.length} tokens selected`) : "the party";
  const take = (to: Scene) => {
    const n = takeParty(room, scene, to);
    if (n) room.toast(`${n === 1 ? (party[0].label || "1 token") : `${n} tokens`} to ${name(to)}: players see it now.`);
  };
  return (
    <div class="level-bar" onPointerDown={(e) => e.stopPropagation()}>
      <button
        class="icon-btn"
        disabled={!up}
        title={up ? `Look at ${name(up)} (players stay where they are)` : "The top level"}
        aria-label="Look at the level above"
        onClick={() => up && room.viewSceneLocally(up.id)}
      >
        <ChevronUp size={16} />
      </button>
      <span class="level-name" title={mapNameOf(levels)}>
        {name(scene)} <span class="small muted">{`${i + 1} of ${levels.length}`}</span>
      </span>
      <button
        class="icon-btn"
        disabled={!down}
        title={down ? `Look at ${name(down)} (players stay where they are)` : "The bottom level"}
        aria-label="Look at the level below"
        onClick={() => down && room.viewSceneLocally(down.id)}
      >
        <ChevronDown size={16} />
      </button>
      {party.length > 0 && (up || down) && (
        <span class="level-take">
          <span class="small muted">Take the party</span>
          {up && (
            <button class="btn btn-sm" title={`Take ${who} up to ${name(up)}, to the same squares, and show it to players`} onClick={() => take(up)}>
              <ChevronUp size={14} /> Up
            </button>
          )}
          {down && (
            <button class="btn btn-sm" title={`Take ${who} down to ${name(down)}, to the same squares, and show it to players`} onClick={() => take(down)}>
              <ChevronDown size={14} /> Down
            </button>
          )}
        </span>
      )}
    </div>
  );
}

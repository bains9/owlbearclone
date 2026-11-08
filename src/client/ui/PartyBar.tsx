// GM, looking at a scene players aren't on (Par: "How can Vern drag people to different maps?"):
// Take the party here, then a click on the map where they arrive. Their tokens go there as they
// stood, with the spells on them, and players see this scene (levels.ts takeParty; the click is the
// board's). A map's levels have Take the party Up and Down as well (LevelBar), to the same squares.

import { Footprints } from "lucide-preact";
import { partyOn } from "../levels";
import { useRoom, useRoomState } from "./common";

export function PartyBar() {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const view = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : undefined));
  const from = useRoomState((s) => (s.activeSceneId ? s.scenes[s.activeSceneId] : undefined));
  const items = useRoomState((s) => s.items);
  const armed = useRoomState((s) => !!s.partyTake && s.partyTake.sceneId === s.viewSceneId);
  if (!gm || !view || !from || view.id === from.id) return null;
  const party = partyOn(items, from.id, []);
  if (!party.length) return null;
  const who = party.length === 1 ? party[0].label || "1 token" : `${party.length} tokens`;
  return (
    <div class="level-bar party-bar" onPointerDown={(e) => e.stopPropagation()}>
      {armed ? (
        <>
          <span class="party-bar-ask">Click where the party arrives.</span>
          <button class="btn btn-sm" onClick={() => room.store.set({ partyTake: null })}>
            Cancel
          </button>
        </>
      ) : (
        <button
          class="btn btn-sm"
          title={`Take the party (${who}) from “${from.name}” to this scene: click where they arrive, and players see it`}
          onClick={() => room.store.set({ partyTake: { sceneId: view.id }, lightAdd: null })}
        >
          <Footprints size={14} aria-hidden="true" /> Take the party here
        </button>
      )}
    </div>
  );
}

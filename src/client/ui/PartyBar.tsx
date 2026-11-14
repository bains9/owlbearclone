// GM, looking at a scene players aren't on (Par: "How can Vern drag people to different maps?"):
// Take the party here, then a click on the map where they arrive. Their tokens go there as they
// stood, with the spells on them, and players see this scene (levels.ts takeParty; the click is the
// board's). A map's levels have Take the party Up and Down as well (LevelBar), to the same squares.
//
// The party split (Par, 2026-11-14: "DM being able to choose who to move from map to map"): Send
// here, on any scene, lists the party's characters elsewhere, with who plays them. The ones ticked
// (from one map at a time) arrive where the map is clicked next, and the people who play them see
// this scene from then on, apart from the party; nobody else is told. Sent to the live scene, they're
// back with the party. Show to players puts everyone together again.

import { useState } from "preact/hooks";
import { Footprints, Split } from "lucide-preact";
import { listNames, partyOn, sendables, sentGone } from "../levels";
import type { Sendable } from "../levels";
import { useRoom, useRoomState } from "./common";

export function PartyBar() {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const view = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : undefined));
  const from = useRoomState((s) => (s.activeSceneId ? s.scenes[s.activeSceneId] : undefined));
  const items = useRoomState((s) => s.items);
  const scenes = useRoomState((s) => s.scenes);
  const placed = useRoomState((s) => s.placed);
  const party = useRoomState((s) => s.party);
  // Names come from who's here (room.namesOf): shown again when that changes.
  useRoomState((s) => s.players);
  const take = useRoomState((s) => (s.partyTake && s.partyTake.sceneId === s.viewSceneId ? s.partyTake : null));
  const [picking, setPicking] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  if (!gm || !view) return null;
  const whole = from && from.id !== view.id ? partyOn(items, from.id, []) : [];
  const options = sendables({ items, scenes, placed, activeSceneId: from?.id ?? null, party }, view.id);
  if (!whole.length && !options.length && !take) return null;
  const who = whole.length === 1 ? whole[0].label || "1 token" : `${whole.length} tokens`;
  const open = picking === view.id;
  const close = () => {
    setPicking(null);
    setTicked([]);
  };
  const tick = (o: Sendable, on: boolean) => {
    if (!on) return setTicked(ticked.filter((id) => id !== o.token.id));
    // From one map at a time: they arrive together, around one click.
    const other = (id: string) => {
      const x = options.find((p) => p.token.id === id);
      return !!x && !x.here && !o.here && x.token.sceneId !== o.token.sceneId;
    };
    setTicked([...ticked.filter((id) => !other(id)), o.token.id]);
  };
  const send = () => {
    const chosen = options.filter((o) => ticked.includes(o.token.id));
    const users = [...new Set(chosen.flatMap((o) => o.people.map((p) => p.userId)))];
    const moving = chosen.filter((o) => !o.here).map((o) => o.token.id);
    close();
    if (moving.length) {
      room.store.set({ partyTake: { sceneId: view.id, tokens: moving, users }, lightAdd: null });
    } else if (users.length) {
      room.sendToScene(view.id, users);
      room.toast(sentGone([], `“${view.name}”`, room.namesOf(users)));
    }
  };
  // Grouped by where they are now: this scene first, then the others in the Scenes panel's order.
  const groups: { sceneId: string; list: Sendable[] }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.sceneId === o.token.sceneId);
    if (g) g.list.push(o);
    else groups.push({ sceneId: o.token.sceneId, list: [o] });
  }
  return (
    <div class="level-bar party-bar" onPointerDown={(e) => e.stopPropagation()}>
      {take ? (
        <>
          <span class="party-bar-ask">{take.tokens ? "Click where they arrive." : "Click where the party arrives."}</span>
          <button class="btn btn-sm" onClick={() => room.store.set({ partyTake: null })}>
            Cancel
          </button>
        </>
      ) : (
        <>
          {whole.length > 0 && (
            <button
              class="btn btn-sm"
              title={`Take the party (${who}) from “${from!.name}” to this scene: click where they arrive, and players see it`}
              onClick={() => {
                close();
                room.store.set({ partyTake: { sceneId: view.id }, lightAdd: null });
              }}
            >
              <Footprints size={14} aria-hidden="true" /> Take the party here
            </button>
          )}
          {options.length > 0 && (
            <button
              class={`btn btn-sm${open ? " active" : ""}`}
              aria-expanded={open}
              title="Choose who comes to this scene: their tokens move, and only the people who play them see it"
              onClick={() => (open ? close() : setPicking(view.id))}
            >
              <Split size={14} aria-hidden="true" /> Send here
            </button>
          )}
          {open && (
            <div class="party-pick">
              <p class="party-pick-note">Who comes to “{view.name}”? Their tokens move, and the people who play them see this scene. Nobody else is told.</p>
              {groups.map((g) => (
                <div key={g.sceneId} class="party-pick-group">
                  <div class="party-pick-from">{g.sceneId === view.id ? "Here already, but their players are elsewhere" : `On “${scenes[g.sceneId]?.name ?? ""}”`}</div>
                  {g.list.map((o) => {
                    const people = room.namesOf(o.people.map((p) => p.userId));
                    return (
                      <label key={o.token.id} class="check party-pick-row">
                        <input type="checkbox" checked={ticked.includes(o.token.id)} onChange={(e) => tick(o, e.currentTarget.checked)} />
                        <span class="party-pick-name">{o.token.label || "A token"}</span>
                        <span class="party-pick-who">{people.length ? listNames(people) : "nobody plays them"}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
              <div class="party-pick-actions">
                <button class="btn btn-sm" onClick={close}>
                  Cancel
                </button>
                <button class="btn btn-primary btn-sm" disabled={!ticked.length} onClick={send}>
                  Send them here
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The GM's NPCs list in the Tokens & images panel: a token for any race and class from the
// group's campaign handbook, picked from two lists, shown as it will look, then placed by a
// click (on the preview or Place, in the middle of the view) or by dragging the preview onto the
// map. The icons load when the list first opens, so they don't slow down the room for anyone else.

import { useEffect, useRef, useState } from "preact/hooks";
import { HIDDEN_KEY, loadAddHidden, saveAddHidden } from "../monsters/place";
import { drawNpcArt, previewPx } from "../npcs/art";
import { NPC_CLASSES, NPC_RACES, classesByGroup, findClass, findRace, npcDescription, npcName, racesByGroup } from "../npcs/npcs";
import type { NpcClass, NpcIcons, NpcRace } from "../npcs/npcs";
import { NPCS_LOAD_FAILED, NPC_DRAG_TYPE, loadNpcs, npcDragData, placeNpc } from "../npcs/place";
import { cx, useRoom } from "./common";

/** The preview's size in CSS pixels (.npc-art in styles.css); its canvas gets as many device pixels, so it stays sharp on a dense screen. */
const PREVIEW_CSS_PX = 96;

/** The token as it will look on the map (the same drawing the browser uploads when it's first used). */
function NpcArt(props: { race: NpcRace; cls: NpcClass; icons: NpcIcons }) {
  const { race, cls, icons } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const px = previewPx(PREVIEW_CSS_PX, window.devicePixelRatio);
    c.width = px;
    c.height = px;
    drawNpcArt(ctx, race, cls, icons, px);
  }, [race, cls, icons]);
  return <canvas ref={canvas} class="npc-art" aria-hidden="true" />;
}

export function NpcsSection() {
  const room = useRoom();
  const [icons, setIcons] = useState<NpcIcons | null>(null);
  const [failed, setFailed] = useState(false);
  const [raceId, setRaceId] = useState(NPC_RACES[0].id);
  const [classId, setClassId] = useState(NPC_CLASSES[0].id);
  const [hidden, setHidden] = useState(loadAddHidden);
  // Pairs on their way to the map (the first of each in a room is uploaded first).
  const [busy, setBusy] = useState<string[]>([]);

  const load = () => {
    setFailed(false);
    loadNpcs().then(setIcons, () => setFailed(true));
  };
  useEffect(load, []);
  // Add hidden changed in another tab (or on the Monsters tab): show it here too, so the box says what a click will do.
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key === HIDDEN_KEY || e.key === null) setHidden(loadAddHidden());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  const race = findRace(raceId) ?? NPC_RACES[0];
  const cls = findClass(classId) ?? NPC_CLASSES[0];
  const name = npcName(race, cls);

  const place = async () => {
    setBusy((b) => [...b, name]);
    try {
      // On a phone the panel covers the board, and the new token with it.
      if ((await placeNpc(room, race.id, cls.id, undefined, hidden)) && window.matchMedia("(max-width: 760px)").matches) {
        room.setPanel(null);
      }
    } finally {
      setBusy((b) => b.filter((n) => n !== name));
    }
  };

  if (failed) {
    return (
      <div class="npcs">
        <p class="small muted">{NPCS_LOAD_FAILED}</p>
        <button class="btn btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!icons) return <p class="small muted">Loading NPCs…</p>;

  const what = npcDescription(race, cls);
  return (
    <div class="npcs">
      <div class="row npc-pick">
        <label class="field">
          <span>Race</span>
          <select value={raceId} aria-label="Race" onChange={(e) => setRaceId(e.currentTarget.value)}>
            {racesByGroup().map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.races.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Class</span>
          <select value={classId} aria-label="Class" onChange={(e) => setClassId(e.currentTarget.value)}>
            {classesByGroup().map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <label class="check" title="Players never receive them until you show them, with the eye button or H. Remembered on this device, and shared with the Monsters tab.">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            setHidden(on);
            saveAddHidden(on);
          }}
        />{" "}
        Add hidden
      </label>
      <div class="row npc-place">
        {/* The picture places too, as a monster's does, so a click on it isn't a surprise. */}
        <button
          class={cx("asset npc", busy.includes(name) && "busy")}
          title={`${what}. Click to place${hidden ? " hidden" : ""}, or drag onto the map.`}
          aria-label={`Add ${name}${hidden ? ", hidden" : ""}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer?.setData(NPC_DRAG_TYPE, npcDragData(race.id, cls.id, hidden));
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => void place()}
        >
          <NpcArt race={race} cls={cls} icons={icons} />
          <span class="asset-name">{name}</span>
        </button>
        <div class="npc-place-text">
          <button
            class="btn"
            title={`${what}. Put it in the middle of your view${hidden ? ", hidden" : ""}.`}
            aria-label={`Place ${name}${hidden ? ", hidden" : ""}`}
            disabled={busy.includes(name)}
            onClick={() => void place()}
          >
            Place
          </button>
          <p class="small muted">
            Pick a race and a class, then click <b>Place</b> (or the picture) to put the NPC in the middle of your view, or drag
            the picture onto the map. It's sized for the grid by the race's D&D size.
          </p>
        </div>
      </div>
      <p class="small muted npc-credit">
        The races and classes are the group's own, from the campaign handbook. NPC icons by Delapouite, Lorc, Cathelineau and Caro
        Asercion (recoloured and set on token discs), from{" "}
        <a href="https://game-icons.net" target="_blank" rel="noopener noreferrer">
          game-icons.net
        </a>
        , under{" "}
        <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">
          CC BY 3.0
        </a>
        .
      </p>
    </div>
  );
}

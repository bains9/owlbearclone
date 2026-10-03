// The GM's Monsters list in the Tokens & images panel: ready-made creatures, searchable and
// filterable by type, placed by a click (in the middle of the view) or by dragging onto the map.
// The icons load when the list first opens, so they don't slow down the room for anyone else.

import { useEffect, useState } from "preact/hooks";
import { ART, iconPlacement } from "../monsters/art";
import { CREATURE_TYPES, SIZE_LETTERS, TYPE_COLORS, TYPE_NAMES, filterMonsters, monsterSquares } from "../monsters/monsters";
import type { CreatureType, MonsterIcon } from "../monsters/monsters";
import {
  HIDDEN_KEY,
  MONSTER_DRAG_TYPE,
  loadAddHidden,
  loadMonsters,
  monsterDragData,
  placeMonster,
  saveAddHidden,
} from "../monsters/place";
import { DND_SIZE_NAMES, sizeOptionLabel } from "../room/tokenSizes";
import { cx, useRoom } from "./common";

/** A creature as its token looks (the same parts the browser draws when it's first used). */
function MonsterArt(props: { m: MonsterIcon }) {
  const { m } = props;
  const at = iconPlacement(m.fit, 512);
  return (
    <svg class="monster-art" viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r={ART.rim * 256} fill={ART.rimColor} />
      <circle cx="256" cy="256" r={ART.ringOuter * 256} fill={TYPE_COLORS[m.type]} />
      <circle cx="256" cy="256" r={ART.ringInner * 256} fill={ART.discInner} />
      <path d={m.path} fill={ART.iconColor} transform={`translate(${at.x} ${at.y}) scale(${at.scale})`} />
    </svg>
  );
}

export function MonstersSection() {
  const room = useRoom();
  const [icons, setIcons] = useState<readonly MonsterIcon[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<CreatureType | "">("");
  const [hidden, setHidden] = useState(loadAddHidden);
  // Creatures on their way to the map (the first of each in a room is uploaded first).
  const [busy, setBusy] = useState<string[]>([]);

  const load = () => {
    setFailed(false);
    loadMonsters().then(setIcons, () => setFailed(true));
  };
  useEffect(load, []);
  // Add hidden changed in another tab: show it here too, so the box says what a click will do.
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if (e.key === HIDDEN_KEY || e.key === null) setHidden(loadAddHidden());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  const place = async (m: MonsterIcon) => {
    setBusy((b) => [...b, m.id]);
    try {
      // On a phone the panel covers the board, and the new token with it.
      if ((await placeMonster(room, m.id, undefined, hidden)) && window.matchMedia("(max-width: 760px)").matches) {
        room.setPanel(null);
      }
    } finally {
      setBusy((b) => b.filter((id) => id !== m.id));
    }
  };

  if (failed) {
    return (
      <div class="monsters">
        <p class="small muted">Couldn't load the monsters. Check the connection, then try again.</p>
        <button class="btn btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    );
  }
  if (!icons) return <p class="small muted">Loading monsters…</p>;

  const shown = filterMonsters(icons, query, type);
  return (
    <div class="monsters">
      <div class="row monster-filters">
        <input
          type="search"
          value={query}
          placeholder="Search monsters"
          aria-label="Search monsters"
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <select value={type} aria-label="Creature type" onChange={(e) => setType(e.currentTarget.value as CreatureType | "")}>
          <option value="">All types</option>
          {CREATURE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_NAMES[t]}
            </option>
          ))}
        </select>
      </div>
      <label class="check" title="Players never receive them until you show them, with the eye button or H. Remembered on this device.">
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
      <p class="small muted">
        Click one to place it, or drag it onto the map. Each is sized for the grid by its D&D size: T Tiny, S Small, M
        Medium, L Large, H Huge, G Gargantuan.
      </p>
      {shown.length === 0 ? (
        <p class="small muted">No monsters match.</p>
      ) : (
        <div class="asset-grid monster-grid">
          {shown.map((m) => {
            const squares = monsterSquares(m);
            const what = `${m.name}: ${DND_SIZE_NAMES[m.size]} ${TYPE_NAMES[m.type].toLowerCase()}, ${sizeOptionLabel(squares, false)} squares`;
            return (
              <button
                key={m.id}
                class={cx("asset monster", busy.includes(m.id) && "busy")}
                title={`${what}. Click to place${hidden ? " hidden" : ""}, or drag onto the map.`}
                aria-label={`Add ${m.name}${hidden ? ", hidden" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer?.setData(MONSTER_DRAG_TYPE, monsterDragData(m.id, hidden));
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => void place(m)}
              >
                <MonsterArt m={m} />
                <span class="monster-size" aria-hidden="true">
                  {SIZE_LETTERS[m.size]}
                </span>
                <span class="asset-name">{m.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <p class="small muted monster-credit">
        Monster icons by Lorc, Delapouite, Caro Asercion, Cathelineau and Skoll (recoloured and set on token discs), from{" "}
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

import { useEffect, useRef, useState } from "preact/hooks";
import { CloudSun, Flower2, ImageIcon, Leaf, Shuffle, Snowflake, Sun } from "lucide-preact";
import type { Scene, SceneMapData, SceneSeason, SeasonLook } from "../../shared/types";
import { SEASON_LOOKS } from "../../shared/types";
import { touchedSidecars } from "../importScenes";
import { usesData } from "../room/mapData";
import type { SceneDataState } from "../room/mapData";
import { outdoorKey } from "../room/seasons";
import { useSidecar } from "./AttachDungeondraft";
import { cx, useRoom, useRoomState } from "./common";
import { DD_UI, bareDefault, dataNote, drawnDefault, hasBareTrees, hasPackItems, localDataState, olderExtractor } from "./ddText";
import type { NoteAction } from "./ddText";

const LOOK_NAMES: Record<SeasonLook, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

/** How drastic each look is, gentlest first. */
export const LEVEL_NAMES: Record<SeasonLook, [string, string, string]> = {
  spring: ["Budding", "Blossom", "Full bloom"],
  summer: ["Lush", "Dry", "Drought"],
  autumn: ["Turning", "Autumn", "Late autumn"],
  winter: ["Frost", "Snow", "Deep snow"],
};

const LOOK_ICONS: Record<SeasonLook, typeof Leaf> = {
  spring: Flower2,
  summer: Sun,
  autumn: Leaf,
  winter: Snowflake,
};

/** The season's name as players would say it: "Deep snow", "Autumn". */
export function seasonLabel(season: SceneSeason | undefined): string {
  return season ? LEVEL_NAMES[season.look][season.level - 1] : "As drawn";
}

const LEVELS_KEY = "tabletop-season-levels";

/** The level last picked for each look on this device (so Winter comes back as Deep snow). */
function lastLevel(look: SeasonLook): 1 | 2 | 3 {
  try {
    const v = (JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "{}") as Record<string, unknown>)[look];
    return v === 1 || v === 2 || v === 3 ? v : 2;
  } catch {
    return 2;
  }
}

function rememberLevel(look: SeasonLook, level: 1 | 2 | 3): void {
  try {
    const all = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(LEVELS_KEY, JSON.stringify({ ...all, [look]: level }));
  } catch {
    // Not remembered: next time starts at the middle level.
  }
}

function newSeed(): number {
  return Math.floor(Math.random() * 65536);
}

/** The look buttons, how drastic, and what players will see: in the top bar's pop-up and the scene editor. */
export function SeasonPicker(props: { scene: Scene }) {
  const room = useRoom();
  const s = props.scene;
  const season = s.season;
  const live = useRoomState((st) => st.activeSceneId === s.id);
  const off = useRoomState((st) => st.seasonsOff);
  const gm = useRoomState((st) => st.me?.role === "gm");
  // The scene's Dungeondraft data on this device (the board publishes it once the scene is looked at).
  const md = s.mapData;
  const dataState = useRoomState((st) => st.mapDataState[s.id]) ?? localDataState(s);
  const exact = md !== undefined && usesData(dataState);
  // The indoor hint is kept apart per data: with it, what counts as outdoors comes from the map.
  const outdoor = useRoomState((st) =>
    s.mapAssetId ? st.mapOutdoor[outdoorKey(s.mapAssetId, exact ? { assetId: md.assetId } : undefined)] : undefined,
  );
  const hasBuild = useRoomState((st) => {
    for (const i of Object.values(st.items)) if (i.kind === "terrain" && i.sceneId === s.id) return true;
    return false;
  });

  const set = (next: SceneSeason | null) => {
    const same = next && season && next.look === season.look && next.level === season.level && next.seed === season.seed;
    if (same || (!next && !season)) return;
    if (next) rememberLevel(next.look, next.level);
    room.changeScene(s.id, { season: next }, {});
  };
  const pickLook = (look: SeasonLook | null) => {
    if (!look) return set(null);
    if (season?.look === look) return;
    // Switching looks keeps the pattern (where the snow lies is where the leaves fall).
    set({ look, level: lastLevel(look), seed: season?.seed ?? newSeed() });
  };

  return (
    <div class="season-picker">
      <div class="seg full season-looks" role="group" aria-label="Season">
        <button
          class={cx("seg-btn", !season && "active")}
          title="The map as it was drawn"
          aria-pressed={!season}
          onClick={() => pickLook(null)}
        >
          <ImageIcon size={15} /> <span>As drawn</span>
        </button>
        {SEASON_LOOKS.map((look) => {
          const Icon = LOOK_ICONS[look];
          return (
            <button
              key={look}
              class={cx("seg-btn", season?.look === look && "active")}
              aria-pressed={season?.look === look}
              onClick={() => pickLook(look)}
            >
              <Icon size={15} /> <span>{LOOK_NAMES[look]}</span>
            </button>
          );
        })}
      </div>
      {season && (
        <div class="row season-levels">
          <div class="seg full" role="group" aria-label="How drastic">
            {LEVEL_NAMES[season.look].map((name, i) => {
              const level = (i + 1) as 1 | 2 | 3;
              return (
                <button
                  key={name}
                  class={cx("seg-btn", season.level === level && "active")}
                  aria-pressed={season.level === level}
                  onClick={() => set({ ...season, level })}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <button
            class="icon-btn"
            title="Shuffle: the same season, with the snow, leaves or flowers in other places"
            aria-label="Shuffle the pattern"
            onClick={() => set({ ...season, seed: newSeed() })}
          >
            <Shuffle size={16} />
          </button>
        </div>
      )}
      <p class="small muted season-note">
        {!season
          ? "One click puts the map in season: snow, autumn leaves, blossom or drought. Tokens and drawings stay as they are."
          : live
            ? "Everyone sees it now, on this scene. Undo (Ctrl+Z) puts it back."
            : "Players see it when this scene is live."}
      </p>
      {season && !s.mapAssetId && !hasBuild && (
        <p class="small muted season-note">This scene has no map yet: the season shows on the map once it has one.</p>
      )}
      {season && s.mapAssetId && outdoor !== undefined && outdoor < 0.08 && (
        <p class="small muted season-note">
          This looks like an indoor map: only open ground (grass, trees, water) changes, so there's little to see.
        </p>
      )}
      {season && s.mapAssetId && !exact && (
        <p class="small muted season-note">Snow drifts and leaves are sized by the grid: set the grid first if it's off.</p>
      )}
      {gm && <DataNotes scene={s} state={dataState} />}
      {off && (
        <p class="small season-note">
          Seasons are off on this device, so you see the map as drawn (players and the table display still see the season).{" "}
          <button class="link-btn" onClick={() => room.setSeasonsOff(false)}>
            Turn them on
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The GM's note on the scene's Dungeondraft data (design 6.1), with its links, and the per-scene
 * controls while the data is in use: which season the map is drawn in, what its bare trees do,
 * and Par's asset-pack option. Each control is one undoable step.
 */
function DataNotes(props: { scene: Scene; state: SceneDataState }) {
  const room = useRoom();
  const s = props.scene;
  const md = s.mapData;
  const sidecar = useSidecar(room.roomId, md?.assetId);
  const meta = sidecar?.meta;
  const note = dataNote(props.state, { hasMap: !!s.mapAssetId, olderExtractor: meta ? olderExtractor(meta) : false });
  const open = (mode: "attach" | "check") => room.store.set({ attachDD: { sceneId: s.id, mode } });
  const act = (a: NoteAction) => {
    switch (a) {
      case "attach":
      case "reattach":
        return open("attach");
      case "check":
      case "use":
        return open("check");
      case "remove":
        if (!md) return;
        touchedSidecars.add(md.assetId);
        room.setMapData(s.id, null);
        room.toast(DD_UI.removed);
    }
  };
  const setData = (next: SceneMapData) => room.setMapData(s.id, next);
  // The controls apply while the data is in use; a green map's data (v1 doesn't use it) gets only
  // "drawn in", which may be wrong: Winter then puts the data to use, with the other controls.
  const inUse = usesData(props.state);
  const controls = inUse || props.state === "green";
  const drawn = md?.drawn ?? (meta ? drawnDefault(meta) : "winter");
  const bare = md?.bare ?? bareDefault(drawn);
  const packs = md?.packs ?? "drawn";
  return (
    <>
      {note && (
        <p class="small muted season-note">
          {note.map((p, i) =>
            typeof p === "string" ? (
              p
            ) : (
              <button key={i} class="link-btn" onClick={() => act(p.action)}>
                {p.label}
              </button>
            ),
          )}
        </p>
      )}
      {md && meta && controls && (
        <div class="season-ctl" title={DD_UI.drawnTitle}>
          <span class="small">This map is drawn in</span>
          <div class="seg" role="group" aria-label="This map is drawn in">
            {(["winter", "green"] as const).map((d) => (
              <button key={d} class={cx("seg-btn", drawn === d && "active")} aria-pressed={drawn === d} onClick={() => drawn !== d && setData({ ...md, drawn: d })}>
                {d === "winter" ? "Winter" : "Green"}
              </button>
            ))}
          </div>
        </div>
      )}
      {md && meta && inUse && hasBareTrees(meta) && (
        <div class="season-ctl" title={DD_UI.bareTitle}>
          <span class="small">Bare trees</span>
          <div class="seg" role="group" aria-label="Bare trees">
            {(["leaf", "dead"] as const).map((b) => (
              <button key={b} class={cx("seg-btn", bare === b && "active")} aria-pressed={bare === b} onClick={() => bare !== b && setData({ ...md, bare: b })}>
                {b === "leaf" ? "Come into leaf" : "Stay dead"}
              </button>
            ))}
          </div>
        </div>
      )}
      {md && sidecar && inUse && hasPackItems(sidecar.meta, sidecar.objects) && (
        <div class="season-ctl" title={DD_UI.packsTitle}>
          <span class="small">Asset-pack items</span>
          <div class="seg" role="group" aria-label="Asset-pack items">
            <button
              class={cx("seg-btn", packs === "drawn" && "active")}
              aria-pressed={packs === "drawn"}
              onClick={() => {
                if (packs === "drawn") return;
                const { packs: _drop, ...rest } = md;
                setData(rest);
              }}
            >
              Leave as drawn
            </button>
            <button class={cx("seg-btn", packs === "guess" && "active")} aria-pressed={packs === "guess"} onClick={() => packs !== "guess" && setData({ ...md, packs: "guess" })}>
              Guess from the picture
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The GM's season button in the top bar: shows the scene's look, and opens the picker below it. */
export function SeasonButton() {
  const sceneId = useRoomState((s) => s.viewSceneId);
  const scene = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId] : undefined));
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  // Both listen on the window's capture phase, so they run before the board does (it listens
  // for pointers on its own element, and for keys on the window's bubble phase), and can keep
  // it from acting on a click or key that only closes the pop-up.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current || wrap.current.contains(e.target as Node)) return;
      setOpen(false);
      // A click on the map only closes the pop-up: it doesn't also paint, place, ping or
      // deselect. A click anywhere else (a panel, the top bar) still does what it does.
      if ((e.target as Element | null)?.closest?.(".board")) {
        e.stopPropagation();
        e.preventDefault();
        // Cancelling it also keeps focus where it was: off the pop-up and its button, or
        // Enter would open it again.
        const active = document.activeElement;
        if (active instanceof HTMLElement && wrap.current.contains(active)) active.blur();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A dialog open over the pop-up, or a text box someone has tabbed to, gets Escape itself.
      const t = e.target as HTMLElement | null;
      const field = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (field || document.querySelector(".modal-backdrop")) return;
      // Escape only closes the pop-up: the board keeps its selection and any unfinished wall,
      // fog shape or grid alignment. Focus goes back to the season button if it was in the pop-up.
      e.stopPropagation();
      const active = document.activeElement;
      const refocus = !active || active === document.body || wrap.current?.contains(active);
      setOpen(false);
      if (refocus) btn.current?.focus();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  useEffect(() => setOpen(false), [sceneId]);

  if (!scene) return null;
  const Icon = scene.season ? LOOK_ICONS[scene.season.look] : CloudSun;
  return (
    <div class="season-wrap hide-narrow" ref={wrap}>
      <button
        ref={btn}
        class={cx("icon-btn", (open || scene.season) && "active")}
        title={`Season: ${seasonLabel(scene.season)}`}
        aria-label={`Season: ${seasonLabel(scene.season)}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon size={18} />
      </button>
      {open && (
        <div class="season-pop" role="dialog" aria-label="Season">
          <div class="season-pop-head">
            <strong>Season</strong>
            <span class="muted small">{scene.name}</span>
          </div>
          <SeasonPicker scene={scene} />
        </div>
      )}
    </div>
  );
}

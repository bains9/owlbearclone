// The map in 3D, over the 2D board while it's showing (room/view3d.ts, with three.js, loaded the
// first time a device shows it). The 2D board runs on underneath: it's still where everything is
// done, and the 3D view shows what it shows. While the GM builds (the Build tool) on a screen wide
// enough, the 3D view sits beside the flat map instead, so a wall or a tree shows in 3D as it's
// put down; on a phone it takes the map's place, and the Build tool stays picked for coming back.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Board } from "../room/board";
import { useRoom, useRoomState } from "./common";
import { useMapWeather } from "./CalendarPanel";
import type { View3dControls } from "../room/view3dModel";
import { besideBuild, keeps3d } from "./view3dBeside";

export function View3dLayer(props: { board: Board; boardEl: HTMLElement | null }) {
  const room = useRoom();
  const on = useRoomState((s) => s.view3d && s.map3d);
  const tool = useRoomState((s) => s.tool);
  const narrow = useRoomState((s) => s.stageNarrow);
  /** Building with the 3D view on, with room for both: the 3D view beside the flat map. */
  const beside = besideBuild(on, tool, narrow);
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready">("loading");
  const weather = useMapWeather();
  // The scene's weather region, else the calendar's: what the land round the map looks like in 3D.
  const region = useRoomState((s) => (s.viewSceneId ? s.scenes[s.viewSceneId]?.region : undefined) ?? s.calendar?.climate ?? null);
  const weatherKey = JSON.stringify([weather, region]);
  const view3d = useRef<View3dControls | null>(null);

  useEffect(() => {
    if (!on || !ref.current) return;
    const el = ref.current;
    let dead = false;
    let view: (View3dControls & { dispose(): void }) | null = null;
    setState("loading");
    const back = (message: string) => {
      room.toast(message, "error");
      room.setView3d(false);
    };
    import("../room/view3d")
      .then(({ View3D }) => {
        if (dead) return;
        const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
        view = new View3D(el, props.board.source3d(), {
          follow: room.display,
          touch,
          onLost: () => back("The 3D view stopped: this device needed its graphics back. The map is in 2D again."),
        });
        room.view3d = view;
        view3d.current = view;
        setState("ready");
      })
      .catch((err: unknown) => {
        console.warn("The 3D view couldn't start:", err);
        if (!dead) back("This device can't show the map in 3D (it has no WebGL). The map stays in 2D.");
      });
    return () => {
      dead = true;
      if (room.view3d === view) room.view3d = null;
      view3d.current = null;
      view?.dispose();
    };
  }, [on, room, props.board]);

  // The day's weather, once the view is there and whenever it changes.
  useEffect(() => {
    if (state === "ready") view3d.current?.setWeather(weather, region);
  }, [state, weatherKey]);

  // Beside the flat map, the 3D view starts on the whole scene (it can't follow a half-width map's view).
  // Framed again as its half changes size (the halves laid out, a window made wider), once the
  // view has its new shape: the 3D view's own size watcher, made first, runs first.
  useEffect(() => {
    const el = ref.current;
    if (state !== "ready" || !beside || !el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const refit = () => {
      clearTimeout(t);
      t = setTimeout(() => view3d.current?.fit(), 60);
    };
    refit();
    const watch = new ResizeObserver(refit);
    watch.observe(el);
    return () => {
      clearTimeout(t);
      watch.disconnect();
    };
  }, [state, beside]);

  // The 2D board is under the 3D view: it needn't be shown (the browser draws less). Beside it
  // while building, it's narrowed to its half instead.
  useEffect(() => {
    const el = props.boardEl;
    if (!el) return;
    el.classList.toggle("under3d", on && !beside && state === "ready");
    el.classList.toggle("beside3d", beside);
    return () => {
      el.classList.remove("under3d");
      el.classList.remove("beside3d");
    };
  }, [on, beside, state, props.boardEl]);

  // The tools work on the 2D map: picking one goes back to it, but for the Build tool, which keeps
  // the 3D view to check the build by (beside the map, or for coming back to on a phone).
  const lastTool = useRef(tool);
  useEffect(() => {
    if (lastTool.current === tool) return;
    lastTool.current = tool;
    if (on && !keeps3d(tool)) room.setView3d(false);
  }, [tool]);

  if (!on) return null;
  return (
    <div class={beside ? "view3d beside" : "view3d"} ref={ref}>
      {state === "loading" && <div class="view3d-loading">Loading the 3D view…</div>}
    </div>
  );
}

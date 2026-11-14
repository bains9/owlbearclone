// The map in 3D, over the 2D board while it's showing (room/view3d.ts, with three.js, loaded the
// first time a device shows it). The 2D board runs on underneath: it's still where everything is
// done, and the 3D view shows what it shows.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Board } from "../room/board";
import { useRoom, useRoomState } from "./common";

export function View3dLayer(props: { board: Board; boardEl: HTMLElement | null }) {
  const room = useRoom();
  const on = useRoomState((s) => s.view3d && s.map3d);
  const tool = useRoomState((s) => s.tool);
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    if (!on || !ref.current) return;
    const el = ref.current;
    let dead = false;
    let view: { dispose(): void; zoomBy(f: number): void; fit(): void } | null = null;
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
        setState("ready");
      })
      .catch((err: unknown) => {
        console.warn("The 3D view couldn't start:", err);
        if (!dead) back("This device can't show the map in 3D (it has no WebGL). The map stays in 2D.");
      });
    return () => {
      dead = true;
      if (room.view3d === view) room.view3d = null;
      view?.dispose();
    };
  }, [on, room, props.board]);

  // The 2D board is under the 3D view: it needn't be shown (the browser draws less).
  useEffect(() => {
    const el = props.boardEl;
    if (!el) return;
    el.classList.toggle("under3d", on && state === "ready");
    return () => el.classList.remove("under3d");
  }, [on, state, props.boardEl]);

  // The tools work on the 2D map: picking one goes back to it.
  const lastTool = useRef(tool);
  useEffect(() => {
    if (lastTool.current === tool) return;
    lastTool.current = tool;
    if (on) room.setView3d(false);
  }, [tool]);

  if (!on) return null;
  return (
    <div class="view3d" ref={ref}>
      {state === "loading" && <div class="view3d-loading">Loading the 3D view…</div>}
    </div>
  );
}

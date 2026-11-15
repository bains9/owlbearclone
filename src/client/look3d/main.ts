// The /look3d page: Dungeon's builder's 3D view. Dungeon frames it (and only Dungeon may: the
// worker says so, src/worker/staticFiles.ts) and sends the level being built as it changes
// (dungeonLib/look3d.ts); this page draws it with Table's own 3D view (room/view3d.ts), so there's
// one 3D view for both. It reads nothing from Table's server and sends nothing back but "ready"
// and "lost": what it shows is only what the frame's own parent sends it.

import { cleanLookMap, LOOK3D_VERSION } from "../dungeonLib/look3d";
import { LookSource } from "./lookSource";

const el = document.getElementById("look")!;
const note = document.getElementById("note")!;
const source = new LookSource();
let view: { dispose(): void; fit(): void } | null = null;
let starting: Promise<void> | null = null;

/** To the frame's parent (Dungeon), whatever its address: what's said here gives nothing away. */
const tell = (msg: unknown) => window.parent.postMessage(msg, "*");

const isBitmap = (b: unknown): b is ImageBitmap => typeof ImageBitmap !== "undefined" && b instanceof ImageBitmap;

function start(): Promise<void> {
  starting ??= import("../room/view3d")
    .then(({ View3D }) => {
      const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
      view = new View3D(el, source, {
        follow: false,
        touch,
        onLost: () => {
          view?.dispose();
          view = null;
          starting = null;
          tell({ look3d: "lost" });
        },
      });
    })
    .catch((err: unknown) => {
      starting = null;
      note.textContent = "This device can't show the map in 3D (it has no WebGL).";
      note.hidden = false;
      console.warn("The 3D view couldn't start:", err);
      throw err;
    });
  return starting;
}

window.addEventListener("message", (e: MessageEvent) => {
  // Only the frame's own parent: Dungeon, as the worker lets no other site frame this page.
  if (e.source !== window.parent || window.parent === window) return;
  const m = e.data as { look3d?: unknown; v?: unknown; map?: unknown; on?: unknown } | null;
  if (!m || typeof m !== "object") return;
  if (m.look3d === "map" && m.v === LOOK3D_VERSION) {
    const map = cleanLookMap(m.map, isBitmap);
    if (!map) return;
    note.hidden = true;
    void start().then(() => source.setMap(map), () => {});
  } else if (m.look3d === "roofs" && typeof m.on === "boolean") {
    source.setRoofs(m.on);
  } else if (m.look3d === "fit") {
    view?.fit();
  }
});

tell({ look3d: "ready", v: LOOK3D_VERSION });

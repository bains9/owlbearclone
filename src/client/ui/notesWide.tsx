// The wide reader for Campaign notes (Vern, 4 November 2026: "it needs its own interface"): the panel
// opened out across most of the screen, the vaults' list down its left and the note beside it, as
// Obsidian has them. The map keeps the rest of the screen, still in play: tokens to select and link,
// a token's book button to open its note. Per device; a screen too narrow for it keeps the side panel.
import { useEffect, useState } from "preact/hooks";
import { WIDE_FROM, wideWidth } from "../notesWidth";

const WIDE_KEY = "tabletop-notes-wide";
const WIDTH_KEY = "tabletop-notes-width";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // It lasts as long as the page.
  }
}

export interface NotesWide {
  /** The screen is wide enough to read wide. */
  can: boolean;
  /** Reading wide now. */
  wide: boolean;
  /** The reader's width, in pixels. */
  width: number;
  setWide(on: boolean): void;
  /** While the edge is dragged: the width, not yet kept. */
  drag(px: number): void;
  /** The width to keep on the device (null: back to the usual share). */
  keep(px: number | null): void;
}

export function useNotesWide(): NotesWide {
  const [on, setOn] = useState(() => read(WIDE_KEY) === "1");
  const [dragged, setDragged] = useState<number | null>(() => {
    const n = Number(read(WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [screen, setScreen] = useState(() => window.innerWidth);
  useEffect(() => {
    const resized = () => setScreen(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  const can = screen >= WIDE_FROM;
  return {
    can,
    wide: on && can,
    width: wideWidth(screen, dragged),
    setWide(v) {
      setOn(v);
      write(WIDE_KEY, v ? "1" : null);
    },
    drag: setDragged,
    keep(px) {
      setDragged(px);
      write(WIDTH_KEY, px === null ? null : String(Math.round(px)));
    },
  };
}

/** The reader's left edge: drag it (or use the arrow keys on it) to widen or narrow; double-click for the usual width. */
export function WideEdge(props: { notes: NotesWide }) {
  const { notes } = props;
  return (
    <div
      class="panel-edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Widen or narrow your notes"
      aria-valuenow={notes.width}
      tabIndex={0}
      title="Drag to widen or narrow your notes. Double-click for the usual width."
      onPointerDown={(e) => {
        e.preventDefault();
        const edge = e.currentTarget;
        edge.setPointerCapture(e.pointerId);
        let px = notes.width;
        const move = (m: PointerEvent) => {
          // The panel's right side is the window's: its width is what's right of the pointer.
          px = wideWidth(window.innerWidth, window.innerWidth - m.clientX);
          notes.drag(px);
        };
        const up = () => {
          edge.removeEventListener("pointermove", move);
          edge.removeEventListener("pointerup", up);
          edge.removeEventListener("pointercancel", up);
          notes.keep(px);
        };
        edge.addEventListener("pointermove", move);
        edge.addEventListener("pointerup", up);
        edge.addEventListener("pointercancel", up);
      }}
      onDblClick={() => notes.keep(null)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
        if (!step) return;
        e.preventDefault();
        notes.keep(wideWidth(window.innerWidth, notes.width + step));
      }}
    />
  );
}

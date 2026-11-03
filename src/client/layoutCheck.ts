// A check that the bars round the map keep out of each other's way at any screen size (31 October
// 2026, from Par's "do all": smoke tests at phone and tablet sizes). Development builds put it on
// the page as window.__layoutCheck(): it measures what's on screen now, and names any two pieces
// that overlap and any piece that runs off the screen.

/** The pieces along the map's edges, each kept clear of the others. A stack's pieces are measured one by one. */
export const LAYOUT_PIECES = [
  ".stage-area > .toolbar",
  ".stage-area > .tool-options",
  ".stage-area > .align-banner",
  ".bottom-bars > *",
  ".corner-bl > *",
  ".corner-tr > *",
  ".card-dock",
  ".stage-area > .zoom",
  ".voice-held",
];

/** What may lie over the others (a menu, the side panel on a phone), but must still be all on screen. */
export const LAYOUT_ON_TOP = [".more-pop", ".panel"];

export interface Box {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Lies over the others: only checked for running off the screen. */
  onTop?: boolean;
}

export interface LayoutProblem {
  kind: "overlap" | "offscreen";
  a: string;
  b?: string;
  /** By how many pixels. */
  by: number;
}

/** Pieces that overlap by more than `slack` pixels each way, and pieces running more than `slack` pixels off a w × h screen. */
export function layoutProblems(boxes: readonly Box[], w: number, h: number, slack = 1): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  for (const b of boxes) {
    const by = Math.max(-b.left, -b.top, b.right - w, b.bottom - h);
    if (by > slack) out.push({ kind: "offscreen", a: b.name, by: Math.round(by) });
  }
  const edge = boxes.filter((b) => !b.onTop);
  for (let i = 0; i < edge.length; i++) {
    for (let j = i + 1; j < edge.length; j++) {
      const a = edge[i], b = edge[j];
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > slack && y > slack) out.push({ kind: "overlap", a: a.name, b: b.name, by: Math.round(Math.min(x, y)) });
    }
  }
  return out;
}

/** The pieces on screen now (shown, with some size), named by their tag and classes. */
export function measurePieces(doc: Document): Box[] {
  const out: Box[] = [];
  const add = (selectors: readonly string[], onTop: boolean) => {
    for (const sel of selectors) {
      doc.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === "hidden") return;
        const name = `${el.tagName.toLowerCase()}${Array.from(el.classList, (c) => `.${c}`).join("")}`;
        out.push({ name, left: r.left, top: r.top, right: r.right, bottom: r.bottom, ...(onTop ? { onTop } : {}) });
      });
    }
  };
  add(LAYOUT_PIECES, false);
  add(LAYOUT_ON_TOP, true);
  return out;
}

/** What's wrong with the layout on screen now: an empty list when nothing is. */
export function layoutCheck(): LayoutProblem[] {
  return layoutProblems(measurePieces(document), innerWidth, innerHeight);
}

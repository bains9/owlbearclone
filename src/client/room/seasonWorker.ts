// The seasonal recolouring, off the main thread, so the page only reads and writes each strip
// (kept small so panning carries on while a map is being redrawn for its season). It keeps
// the latest analyses (what's grass, water, trees) and recolours strips of pixels the page
// sends it.

import { analyse, bake, outdoorFraction } from "./seasonPixels";
import type { BakeOptions, SeasonAnalysis } from "./seasonPixels";

type Msg =
  | { t: "analyse"; id: number; key: string; rgba: Uint8ClampedArray; aw: number; ah: number; cellA: number }
  | { t: "bake"; id: number; key: string; rgba: Uint8ClampedArray; width: number; rows: number; opts: Omit<BakeOptions, "a"> };

const analyses = new Map<string, SeasonAnalysis>();
const scope = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<Msg>) => void) | null };

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.t === "analyse") {
      const a = analyse(m.rgba, m.aw, m.ah, m.cellA);
      analyses.delete(m.key);
      analyses.set(m.key, a);
      // Two at most: the one in use and the one before (switching back and forth is quick).
      while (analyses.size > 2) analyses.delete(analyses.keys().next().value!);
      scope.postMessage({ t: "analysed", id: m.id, frac: outdoorFraction(a) });
    } else if (m.t === "bake") {
      const a = analyses.get(m.key);
      if (!a) {
        scope.postMessage({ t: "error", id: m.id, message: "no analysis" });
        return;
      }
      bake(m.rgba, m.width, m.rows, { ...m.opts, a });
      scope.postMessage({ t: "baked", id: m.id, rgba: m.rgba }, [m.rgba.buffer]);
    }
  } catch (err) {
    // The page forgets every analysis on an error and sends them again, so these go too (which
    // also gives back their memory, if running out of it was the trouble).
    analyses.clear();
    scope.postMessage({ t: "error", id: m.id, message: String(err) });
  }
};

scope.postMessage({ t: "ready" });

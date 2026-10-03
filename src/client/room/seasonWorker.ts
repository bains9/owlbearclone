// The seasonal recolouring, off the main thread, so the page only reads and writes each strip
// (kept small so panning carries on while a map is being redrawn for its season). It keeps
// the latest analyses (what's grass, water, trees) and recolours strips of pixels the page
// sends it.

import { analyse, bake, outdoorFraction } from "./seasonPixels";
import type { BakeOptions, SeasonAnalysis } from "./seasonPixels";
import { analyseExact } from "./seasonExact";
import { decodeSidecar } from "../dd/sidecar";
import type { SeasonDdData } from "../dd/messages";

export type Msg =
  | {
      t: "analyse";
      id: number;
      key: string;
      rgba: Uint8ClampedArray;
      aw: number;
      ah: number;
      cellA: number;
      /** The scene's Dungeondraft data (a copy of the page's, handed over). */
      dd?: SeasonDdData;
      /** With dd: the key the analysis guessed from the picture is kept under, when the data is refused. */
      fallbackKey?: string;
    }
  | { t: "bake"; id: number; key: string; rgba: Uint8ClampedArray; width: number; rows: number; opts: Omit<BakeOptions, "a"> };

/** The reply to "analyse". exact: made from the data; false with data means it was refused, for reason. */
export type Analysed = { t: "analysed"; id: number; frac: number; exact: boolean; reason?: string };

/**
 * The analysis for an "analyse" message, and the key it's kept under. With data it's made from the
 * data. When that fails (damaged, a green map, more than the rasteriser draws), it's guessed from
 * the picture as without data, and kept under the fallback key: never the plain map, and never a
 * guess under the data's key. analyseExact doesn't write into rgba, so the guess sees the same picture.
 */
function analyseFor(m: Extract<Msg, { t: "analyse" }>): { a: SeasonAnalysis; key: string; exact: boolean; reason?: string } {
  if (!m.dd) return { a: analyse(m.rgba, m.aw, m.ah, m.cellA), key: m.key, exact: false };
  try {
    const a = analyseExact(m.rgba, m.aw, m.ah, m.cellA, decodeSidecar(m.dd.sidecar), m.dd);
    return { a, key: m.key, exact: true };
  } catch (err) {
    return { a: analyse(m.rgba, m.aw, m.ah, m.cellA), key: m.fallbackKey ?? `${m.key}|guessed`, exact: false, reason: String(err) };
  }
}

const analyses = new Map<string, SeasonAnalysis>();
const scope = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<Msg>) => void) | null };

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.t === "analyse") {
      const { a, key, exact, reason } = analyseFor(m);
      analyses.delete(key);
      analyses.set(key, a);
      // Two at most: the one in use and the one before (switching back and forth is quick).
      while (analyses.size > 2) analyses.delete(analyses.keys().next().value!);
      const reply: Analysed = { t: "analysed", id: m.id, frac: outdoorFraction(a), exact };
      if (reason !== undefined) reply.reason = reason;
      scope.postMessage(reply);
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

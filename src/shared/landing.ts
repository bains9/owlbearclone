// Where tokens stand when they arrive on another map: the party taken there (client/levels.ts), or
// tokens moved to another room (worker/room.ts importTokens). Kept here so the browser and the
// Worker put them down the same way.

import { isOnGrid, snapTokenCenter, type Point } from "./geometry";
import type { DrawingItem, GridSettings, TokenItem } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Where the party stands on another map, put down at `at` (Take the party here): the token nearest
 * their middle on that point (snapped as a token put down is), the rest around it as they stood,
 * the same number of squares away at that map's squares, and one that sat on the grid stays on it.
 */
export function partyLanding(party: readonly TokenItem[], from: GridSettings, to: GridSettings, at: Point, snap: boolean): Map<string, Point> {
  const out = new Map<string, Point>();
  if (!party.length) return out;
  const cx = party.reduce((n, t) => n + t.x, 0) / party.length;
  const cy = party.reduce((n, t) => n + t.y, 0) / party.length;
  const lead = party.reduce((a, t) => (Math.hypot(t.x - cx, t.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? t : a));
  const k = to.size / from.size;
  const home = snap ? snapTokenCenter(at, lead.size, to) : at;
  for (const t of party) {
    let p = { x: home.x + (t.x - lead.x) * k, y: home.y + (t.y - lead.y) * k };
    if (snap && t !== lead && isOnGrid(t, t.size, from)) p = snapTokenCenter(p, t.size, to);
    out.set(t.id, p);
  }
  return out;
}

/**
 * The tokens where they now stand (`where`, by id) on scene `sceneId`, and the spells on them, each
 * keeping its place on its token: moved as the token was, and scaled to the new map's squares (`k`
 * new map pixels to the old map's one).
 */
export function carried(tokens: readonly TokenItem[], spells: readonly DrawingItem[], where: ReadonlyMap<string, Point>, k: number, sceneId: string): { tokens: TokenItem[]; spells: DrawingItem[] } {
  const was = new Map(tokens.map((t) => [t.id, t]));
  const moved = tokens.map((t) => {
    const p = where.get(t.id) ?? t;
    return { ...t, sceneId, x: round2(p.x), y: round2(p.y) };
  });
  const out: DrawingItem[] = [];
  for (const d of spells) {
    const t = d.on ? was.get(d.on) : undefined;
    if (!t) continue;
    const p = where.get(t.id) ?? t;
    const points = d.points.map((v, n) => round2(n % 2 === 0 ? p.x + (v - t.x) * k : p.y + (v - t.y) * k));
    out.push({ ...d, sceneId, points });
  }
  return { tokens: moved, spells: out };
}

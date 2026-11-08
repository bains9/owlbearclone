// A map with levels (Par: "one dungeon with five levels? so that the DM does not have to load 5
// separate maps"): its levels are scenes, brought in together from one file or from Dungeon. Scenes
// lists them as one entry; on the board the GM goes up and down between them, and takes the party
// from one level to the next: their tokens, and the spells on them, to the same squares there, and
// that level shown to players.

import { isOnGrid, snapTokenCenter, type Point } from "../shared/geometry";
import type { ItemMap } from "../shared/ops";
import type { GridSettings, Item, Scene, TokenItem } from "../shared/types";
import type { RoomClient } from "./room/client";
import { isSightToken } from "./room/vision";

/** A scene's level in its map: the levels' group, its place among them, and its name. */
export interface LevelOf {
  group: string;
  index: number;
  name: string;
}

/**
 * A scene's level, or null for a scene that isn't one of several. From Dungeon: by its map and the
 * bringing-in (so a level an update adds joins the rest); from a file: as the file had it.
 */
export function levelOf(s: Scene): LevelOf | null {
  const d = s.dungeon;
  if (d && d.levels.length > 1) return { group: `dungeon:${d.map}:${d.batch}`, index: d.index, name: d.level || `Level ${d.index + 1}` };
  return s.level ? { group: `file:${s.level.group}`, index: s.level.index, name: s.level.name } : null;
}

/** The levels of a scene's map, in order (just the scene, for one that isn't a level). */
export function levelsOf(scenes: Record<string, Scene>, scene: Scene): Scene[] {
  const me = levelOf(scene);
  if (!me) return [scene];
  return Object.values(scenes)
    .filter((s) => levelOf(s)?.group === me.group)
    .sort((a, b) => levelOf(a)!.index - levelOf(b)!.index || a.createdAt - b.createdAt);
}

/** The map's own name: its first level's, without ": <level>" after it. */
export function mapNameOf(levels: readonly Scene[]): string {
  const first = levels[0];
  const l = levelOf(first);
  return l && first.name.endsWith(`: ${l.name}`) ? first.name.slice(0, -(l.name.length + 2)) : first.name;
}

/** What Scenes lists: a scene, or a map's levels as one entry. */
export type SceneEntry = { kind: "scene"; scene: Scene } | { kind: "levels"; group: string; name: string; levels: Scene[] };

/** Scenes in the list's order, a map's levels together where its first one is (one left alone is a scene). */
export function sceneEntries(list: readonly Scene[]): SceneEntry[] {
  const out: SceneEntry[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    const l = levelOf(s);
    if (!l) {
      out.push({ kind: "scene", scene: s });
      continue;
    }
    if (seen.has(l.group)) continue;
    seen.add(l.group);
    const levels = list.filter((x) => levelOf(x)?.group === l.group).sort((a, b) => levelOf(a)!.index - levelOf(b)!.index || a.createdAt - b.createdAt);
    out.push(levels.length > 1 ? { kind: "levels", group: l.group, name: mapNameOf(levels), levels } : { kind: "scene", scene: s });
  }
  return out;
}

/** A point on one level at the same place on another: the same squares, as each level's grid has them. */
export function onLevel(p: Point, from: GridSettings, to: GridSettings): Point {
  return {
    x: to.offsetX + ((p.x - from.offsetX) / from.size) * to.size,
    y: to.offsetY + ((p.y - from.offsetY) / from.size) * to.size,
  };
}

/** The tokens taken from a level: the ones selected on it, or else the party's (characters, and players' tokens). */
export function partyOn(items: ItemMap, sceneId: string, selection: readonly string[]): TokenItem[] {
  const tokens = Object.values(items).filter((i): i is TokenItem => i.kind === "token" && i.sceneId === sceneId);
  const picked = tokens.filter((t) => selection.includes(t.id));
  return picked.length ? picked : tokens.filter(isSightToken);
}

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
 * GM: the party (partyOn) to another scene, with the spells on them, and that scene shown to
 * players. To the same squares on another level; or, with `place`, to where the GM clicked on
 * another map (partyLanding), the whole party whatever's selected. How many tokens went (none:
 * nothing happens).
 */
export function takeParty(room: RoomClient, from: Scene, to: Scene, place?: { at: Point; snap: boolean }): number {
  const s = room.state;
  const party = partyOn(s.items, from.id, place ? [] : s.selection);
  if (!party.length) return 0;
  const where = place
    ? partyLanding(party, from.grid, to.grid, place.at, place.snap)
    : new Map(party.map((t) => [t.id, onLevel(t, from.grid, to.grid)]));
  const k = to.grid.size / from.grid.size;
  const upsert: Item[] = party.map((t) => {
    const p = where.get(t.id)!;
    return { ...t, sceneId: to.id, x: round2(p.x), y: round2(p.y) };
  });
  // A spell on a token keeps its place on it: moved as the token was, and scaled to the new squares.
  const tokens = new Map(party.map((t) => [t.id, t]));
  for (const i of Object.values(s.items)) {
    const t = i.kind === "drawing" && i.on ? tokens.get(i.on) : undefined;
    if (i.kind !== "drawing" || !t) continue;
    const p = where.get(t.id)!;
    const points = i.points.map((v, n) => round2(n % 2 === 0 ? p.x + (v - t.x) * k : p.y + (v - t.y) * k));
    upsert.push({ ...i, sceneId: to.id, points });
  }
  room.change({ upsert });
  room.activateScene(to.id);
  room.select(party.map((t) => t.id));
  return party.length;
}

/** What the GM's told when the party's gone: who, where, and that players see it. */
export function partyGone(party: readonly TokenItem[], where: string): string {
  const who = party.length === 1 ? party[0].label || "1 token" : `${party.length} tokens`;
  return `${who} to ${where}: players see it now.`;
}

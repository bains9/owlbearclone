// Dungeon's floor and ground textures (dungeon.parhome.ca) on built maps. A painted cell keeps
// a character saying what it is (terrain.ts: a room's floor, a patch, grass, water, lava), so
// walls, doors, outdoors and Seasons go on working; the texture is only how it looks. Which
// character a texture paints comes from its name, by the same keyword tables as Dungeondraft's
// textures (dd/roles.ts): wood and carpet are wooden floors, cobbles and marble stone, dirt,
// sand and cave floors earth; in the Terrain tool everything but water and lava is ground.
//
// Dungeon makes each texture pixel by pixel, 512 pixels for 2 by 2 squares, in 30 to 100 ms.
// So each is made when first needed, one at a time between frames (whenTextureMade), showing
// its flat colour until then, and kept as a half-size copy the GPU can hold (1 MB, where Dungeon
// keeps 5), drawn 2 by 2 so Chrome puts it on the GPU at all.

import { DUNGEON_MATERIALS, type DungeonMaterialInfo } from "../../shared/dungeonCatalog";
import { isTextureId } from "../../shared/terrain";
import type { SeasonLook } from "../../shared/types";
import { AR, TR, materialRole, terrainRole } from "../dd/roles";
import { TILE_PX, material } from "../dungeonLib/textures";

/** What a texture lies on, for the character it's painted with. */
export type TextureKind = "grass" | "earth" | "stone" | "wood" | "water" | "lava";

const INFO = new Map<string, DungeonMaterialInfo>(DUNGEON_MATERIALS.filter((m) => m.group !== "wall").map((m) => [m.id, m]));

/** A Dungeon name as the role tables read names: "cobble-mossy" is "cobble_mossy". */
const asName = (id: string) => id.replace(/-/g, "_");

const KIND = new Map<string, TextureKind>(
  [...INFO.values()].map((m) => {
    if (m.id === "water") return [m.id, "water"];
    if (m.id === "lava") return [m.id, "lava"];
    if (m.group === "floor") return [m.id, materialRole(asName(m.id)) === AR.FLOOR ? "wood" : "stone"];
    const role = terrainRole(asName(m.id));
    // Cave floors and the like have no season role (KEEP): earth underfoot.
    return [m.id, role === TR.GRASS ? "grass" : role === TR.ROCK || role === TR.SNOW || role === TR.ICE ? "stone" : "earth"];
  }),
);

export function textureKind(id: string): TextureKind {
  return KIND.get(id) ?? "stone";
}

const WALLS = new Map<string, DungeonMaterialInfo>(DUNGEON_MATERIALS.filter((m) => m.group === "wall").map((m) => [m.id, m]));

/** Dungeon's wall textures, for a scene's walls. */
export const WALL_TEXTURES: readonly string[] = [...WALLS.keys()];

export function textureName(id: string): string {
  return INFO.get(id)?.name ?? WALLS.get(id)?.name ?? id;
}

/** A flat colour for the texture, for before it's made (and for the picker's first look). */
export function textureSwatch(id: string): string {
  return material(id).swatch;
}

/**
 * The character a texture paints a cell with. The Building tool paints a room's floor (with
 * walls, or without as a patch): stone, wood, or dirt for earth and grass. The Terrain tool
 * paints ground: grass for everything but water and lava, so it lies under buildings and its
 * eraser takes it, as with Tabletop's own grass.
 */
export function textureFloor(id: string, tool: "building" | "terrain", walls: boolean): string {
  const kind = textureKind(id);
  if (tool === "terrain") return kind === "water" ? "a" : kind === "lava" ? "l" : "g";
  const ch = kind === "wood" ? "w" : kind === "stone" ? "s" : "d";
  return walls ? ch : ch.toUpperCase();
}

/** The textures each tool offers, in the picker's groups. */
export interface TextureGroup {
  name: string;
  ids: string[];
}

export const TEXTURE_GROUPS: Record<"building" | "terrain", TextureGroup[]> = (() => {
  const all = [...INFO.values()];
  const of = (test: (m: DungeonMaterialInfo, kind: TextureKind) => boolean) => all.filter((m) => test(m, textureKind(m.id))).map((m) => m.id);
  return {
    building: [
      { name: "Stone and tile", ids: of((m, k) => m.group === "floor" && k === "stone") },
      { name: "Wood and cloth", ids: of((m, k) => m.group === "floor" && k === "wood") },
      { name: "Earth, rock and caves", ids: of((m, k) => m.group === "terrain" && k !== "water" && k !== "lava") },
    ],
    terrain: [
      { name: "Grass and leaves", ids: of((m, k) => m.group === "terrain" && k === "grass") },
      { name: "Earth and sand", ids: of((m, k) => m.group === "terrain" && k === "earth") },
      { name: "Rock, snow and ice", ids: of((m, k) => m.group === "terrain" && k === "stone") },
      { name: "Water and lava", ids: of((_, k) => k === "water" || k === "lava") },
    ],
  };
})();

/** Whether a picked floor is one of Dungeon's textures ("t:<id>"), and which. */
export function textureChoice(floor: string): string | null {
  return floor.startsWith("t:") && isTextureId(floor.slice(2)) ? floor.slice(2) : null;
}

/**
 * The season's overlay rule a textured cell follows, as the floor character overlayFor
 * reads: ground painted with a texture keeps its texture in every season, and takes snow by
 * how deep it lies (as paving does), autumn leaves as grass does, and dust in a drought; earth
 * and stone also sprouts in spring. Water, patches and room floors follow their own rules.
 */
export function overlayRuleFor(ch: string, id: string, look: SeasonLook): string {
  if (ch !== "g") return ch;
  if (look === "autumn") return "g";
  if (look === "spring" && textureKind(id) === "grass") return "";
  return "S";
}

// ---------------------------------------------------------------- drawing

/** Texture pixels per square in the copy the map draws from (Dungeon's own are 256). */
const COPY_PX = TILE_PX / 2 / 2;
/** Each texture made so far; null where one can't be (no DOM). */
const tiles = new Map<string, HTMLCanvasElement | null>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();

/** The copy the map draws a texture from, made the first time; null without a DOM. */
function tileFor(id: string): HTMLCanvasElement | null {
  let tile = tiles.get(id);
  if (tile !== undefined) return tile;
  if (typeof document === "undefined") {
    tiles.set(id, null);
    return null;
  }
  // Made at Dungeon's size, read pixel by pixel while it's made (which keeps it off the GPU),
  // then copied at half size, 2 by 2, onto a canvas nothing reads back.
  const made = document.createElement("canvas");
  made.width = TILE_PX;
  made.height = TILE_PX;
  const mc = made.getContext("2d", { willReadFrequently: true });
  if (!mc) return null;
  material(id).generate(mc);
  const half = TILE_PX / 2;
  tile = document.createElement("canvas");
  tile.width = half * 2;
  tile.height = half * 2;
  const tc = tile.getContext("2d");
  if (!tc) return null;
  for (const x of [0, half]) for (const y of [0, half]) tc.drawImage(made, x, y, half, half);
  tiles.set(id, tile);
  return tile;
}

/** Whether a texture has been made yet (or found it can't be): until then, it shows its swatch. */
export function textureMade(id: string): boolean {
  return tiles.has(id);
}

/** Textures waiting to be made, and what to do when each is. */
const waiting = new Map<string, Set<() => void>>();
let scheduled = false;

function makeNext(): void {
  scheduled = false;
  const next = waiting.entries().next();
  if (next.done) return;
  const [id, done] = next.value;
  waiting.delete(id);
  tileFor(id);
  for (const f of done) f();
  if (waiting.size) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(makeNext, 0);
}

/**
 * Calls `then` once a texture is made, making it soon (one texture a task, so the page keeps
 * responding) if it isn't yet. Returns a way to stop waiting.
 */
export function whenTextureMade(id: string, then: () => void): () => void {
  if (textureMade(id)) {
    then();
    return () => {};
  }
  let list = waiting.get(id);
  if (!list) waiting.set(id, (list = new Set()));
  list.add(then);
  schedule();
  return () => {
    list.delete(then);
    if (!list.size) waiting.delete(id);
  };
}

/**
 * A texture's repeating pattern for this canvas, laid out as floorPattern lays out
 * Tabletop's: `cell` map pixels a square, from the grid's offset. Its swatch colour without
 * a DOM.
 */
export function texturePattern(c: CanvasRenderingContext2D, id: string, cell: number, offX: number, offY: number): CanvasPattern | string {
  let byId = patterns.get(c);
  if (!byId) patterns.set(c, (byId = new Map()));
  let p = byId.get(id);
  if (p === undefined) {
    const tile = tileFor(id);
    p = tile ? c.createPattern(tile, "repeat") : null;
    byId.set(id, p);
  }
  if (!p) return textureSwatch(id);
  const k = cell / COPY_PX;
  p.setTransform(new DOMMatrix([k, 0, 0, k, offX, offY]));
  return p;
}

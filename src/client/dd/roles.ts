// Season roles of Dungeondraft's own default assets (design 4.1), shared by the extractor, the
// rasteriser and the runtime.
//
// Every function takes a DEFAULT short name (see defaultName) or null. Null stands for an asset
// pack's item, an embedded texture or anything unrecognised, and always gives the "as drawn"
// role: a pack's file name is never looked at. The runtime re-derives roles from stored names,
// so a fix to these tables reaches old attachments without a re-attach (bump EXACT_VERSION).
//
// Matching: a table of Dungeondraft's default paths first, then keywords on whole words of the
// file name ("campfire" doesn't match "fir"; "pines" matches "pine" and "bushes" "bush", but
// "pineapple" matches nothing). Names come from files of any origin, so nothing here indexes an
// object by a name, and over-long names get the null role.

import type { AssetRef } from "./model";

export const TR = { SNOW: 1, ICE: 2, GRASS: 3, EARTH: 4, SAND: 5, ROCK: 6, PAVED: 7, KEEP: 8 } as const;
export const AR = { WATER: 1, FLOOR: 2, CAVE: 3, CAVE_RIM: 4, ROOF: 5, WALL: 6, PATH_EARTH: 7, PATH_PAVED: 8,
  PATH_KEEP: 9, PAVED: 10, ICE: 11, KEEP: 12 } as const;
export const OR = { EVERGREEN: 1, DECIDUOUS: 2, SHRUB: 3, FLOWER_SHRUB: 4, BARE: 5, GRASS: 6, FLOWERS: 7, REEDS: 8, CROP: 9,
  MUSHROOM: 10, ROOTS: 11, LITTER: 12, DEADWOOD: 13, STUMP: 14, ROCK: 15, SNOW: 16, ICE: 17, WATER_FX: 18, EFFECT: 19,
  FIRE: 20, STRUCTURE: 21, OPAQUE: 22 } as const;
export type TerrainRole = (typeof TR)[keyof typeof TR];
export type AreaRole = (typeof AR)[keyof typeof AR];
export type ObjectRole = (typeof OR)[keyof typeof OR];

/** Longest default name kept (the sidecar's name cap). */
const MAX_NAME = 120;
const NAME_RE = /^[A-Za-z0-9_.\-/]+$/;

/**
 * "vegetation/trees/pine_tree_02" (objects), "terrain_snow" (terrain), "wagon_trail" (paths),
 * "simple/tileset_wood_interlaced" (patterns), "cobblestone_tile" (materials): the path under
 * res://textures/<kind>/ without its extension. Null for packs, embedded or unknown sources,
 * and for names that aren't plain (odd characters, over 120 characters).
 */
export function defaultName(ref: AssetRef | null): string | null {
  if (!ref || ref.source !== "default" || ref.segments.length < 2) return null;
  const name = ref.segments.slice(1).join("/");
  return name.length <= MAX_NAME && NAME_RE.test(name) ? name : null;
}

// ------------------------------------------------------------------ words

interface Words {
  /** Lower-case name, with a leading "/" so folder patterns match at a boundary. */
  path: string;
  /** Folders, lower case. */
  dirs: string[];
  /** Words of the file name: runs of letters, lower case. */
  words: string[];
}

function splitName(name: string): Words {
  const lower = name.toLowerCase();
  const parts = lower.split("/").filter((p) => p.length > 0);
  const stem = parts.pop() ?? "";
  return { path: "/" + lower, dirs: parts, words: stem.split(/[^a-z]+/).filter((w) => w.length > 0) };
}

/** A word of the name is one of `keys`, or its regular plural ("pines", "bushes"; "fires" is not a plural of "fir"). */
function has(w: Words, ...keys: string[]): boolean {
  for (const t of w.words) {
    for (const k of keys) {
      if (t === k || t === k + (/(?:s|x|z|ch|sh)$/.test(k) ? "es" : "s")) return true;
    }
  }
  return false;
}

function inDir(w: Words, ...dirs: string[]): boolean {
  return w.dirs.some((d) => dirs.includes(d));
}

/** The name lies under `pattern` ("vegetation/trees/pine_tree_" or a folder "clutter/rubble/"), at any depth. */
function under(w: Words, pattern: string): boolean {
  return w.path.includes("/" + pattern);
}

const usable = (name: string | null): name is string => name !== null && name.length > 0 && name.length <= MAX_NAME;

// ------------------------------------------------------------------ terrain slots

const TERRAIN_DEFAULTS: ReadonlyArray<readonly [string, TerrainRole]> = [
  ["terrain_snow", TR.SNOW],
  ["terrain_grass", TR.GRASS], ["terrain_moss", TR.GRASS],
  ["terrain_dirt", TR.EARTH],
  ["terrain_sand", TR.SAND],
  ["terrain_rocky", TR.ROCK], ["terrain_gravel", TR.ROCK], ["terrain_limestone", TR.ROCK], ["terrain_sandstone", TR.ROCK],
];

/** A terrain slot's role; null (packs, embedded, unknown) → KEEP, and so does an unrecognised default. */
export function terrainRole(name: string | null): TerrainRole {
  if (!usable(name)) return TR.KEEP;
  const lower = name.toLowerCase();
  for (const [n, role] of TERRAIN_DEFAULTS) if (lower === n) return role;
  const w = splitName(name);
  if (has(w, "snow", "snowy", "snowdrift")) return TR.SNOW;
  if (has(w, "ice", "icy", "frost", "frosty", "frozen")) return TR.ICE;
  if (has(w, "lava", "magma", "water", "acid")) return TR.KEEP;
  if (has(w, "cobble", "cobblestone", "brick", "tile", "tileset", "paving", "flagstone")) return TR.PAVED;
  if (has(w, "grass", "grassy", "meadow", "lawn", "field", "moss", "mossy", "leaves", "leaf") ||
      w.words.join("_").includes("forest_floor")) return TR.GRASS;
  if (has(w, "dirt", "soil", "earth", "mud", "muddy", "swamp", "bog", "cracked")) return TR.EARTH;
  if (has(w, "sand", "sandy", "beach", "desert")) return TR.SAND;
  if (has(w, "rock", "rocky", "stone", "stony", "gravel", "pebble", "cliff", "granite", "slate", "basalt", "marble",
    "limestone", "sandstone")) return TR.ROCK;
  return TR.KEEP;
}

// ------------------------------------------------------------------ objects

/** Dungeondraft's default objects by path (design 4.1, the nine samples' inventory), checked first. */
const OBJECT_DEFAULTS: ReadonlyArray<readonly [string, ObjectRole]> = [
  ["vegetation/trees/pine_tree_", OR.EVERGREEN], ["swamp/mangrove_tree_", OR.EVERGREEN], ["more_trees/eucalyptus_", OR.EVERGREEN],
  ["vegetation/trees/tree_green_simple_", OR.DECIDUOUS], ["vegetation/trees/tree_big_green_", OR.DECIDUOUS],
  ["vegetation/trees/tree_massive_green_", OR.DECIDUOUS], ["vegetation/trees/tree_branch_", OR.DECIDUOUS],
  ["more_trees/oak_", OR.DECIDUOUS],
  ["vegetation/shrubs/bush_flower_", OR.FLOWER_SHRUB],
  ["vegetation/shrubs/bush_green_simple_", OR.SHRUB], ["vegetation/thorns/thorns_", OR.SHRUB],
  ["vegetation/trees/dead_tree_", OR.BARE],
  ["vegetation/grass/grass_", OR.GRASS],
  ["vegetation/flowers/flowers_", OR.FLOWERS], ["garden/flower_bed_", OR.FLOWERS],
  ["vegetation/aquatic/reeds_", OR.REEDS],
  ["farming/cabbage_", OR.CROP],
  ["vegetation/mushrooms/", OR.MUSHROOM],
  ["vegetation/roots/exposed_roots_", OR.ROOTS],
  ["vegetation/fallen/dead_leaves_", OR.LITTER], ["vegetation/fallen/leaves_", OR.LITTER],
  ["vegetation/fallen/log_", OR.DEADWOOD], ["vegetation/fallen/wood_burned_", OR.DEADWOOD], ["logging/log_pile_", OR.DEADWOOD],
  ["vegetation/trees/stump_", OR.STUMP], ["more_trees/mossy_trunks_", OR.STUMP],
  ["clutter/boulders/", OR.ROCK], ["clutter/rubble/", OR.ROCK], ["swamp/swamp_rocks_", OR.ROCK],
  ["environment/snow_", OR.SNOW],
  ["clutter/water/waterfall_color_", OR.WATER_FX], ["clutter/water/water_circle_", OR.WATER_FX],
  ["environment/smoke_", OR.EFFECT], ["environment/fire_", OR.EFFECT],
  ["camp/campfire_", OR.FIRE], ["structures/fireplace_", OR.FIRE],
];

/**
 * Top folders of man-made things: furniture, supplies, props, animals and the like. Whatever
 * their file names say ("log_cutter", "fruit_box", "bear_rug"), they stay as drawn (STRUCTURE),
 * except the listed defaults above and the sub-folders below.
 */
const MAN_MADE = new Set(["activities", "camp", "corpses", "creatures", "crime", "decor", "furniture", "hardware", "magic",
  "military", "stable", "structures", "supplies", "vehicles"]);
const GROWING = ["activities/farming/", "structures/garden/"];

/** A placed object's role; null (packs, embedded, unknown) → OPAQUE. Unrecognised defaults are STRUCTURE. */
export function objectRole(name: string | null): ObjectRole {
  if (!usable(name)) return OR.OPAQUE;
  const w = splitName(name);
  for (const [p, role] of OBJECT_DEFAULTS) if (under(w, p)) return role;
  if (w.dirs.length > 0 && MAN_MADE.has(w.dirs[0]) && !GROWING.some((g) => under(w, g))) return OR.STRUCTURE;
  return objectKeywords(w);
}

function objectKeywords(w: Words): ObjectRole {
  if (inDir(w, "environment")) {
    if (has(w, "snow", "snowdrift", "snowy")) return OR.SNOW;
    if (has(w, "icicle", "ice", "icy", "frost")) return OR.ICE;
    return OR.EFFECT; // smoke, fire, fog, dust, …
  }
  if (has(w, "icicle")) return OR.ICE;
  if (has(w, "waterfall", "ripple", "splash") || has(w, "water") && has(w, "circle")) return OR.WATER_FX;
  if (has(w, "campfire", "bonfire")) return OR.FIRE;
  if (inDir(w, "fallen")) return has(w, "leaves", "leaf") ? OR.LITTER : OR.DEADWOOD;
  if (has(w, "leaves", "leaf") && !has(w, "tree")) return OR.LITTER;
  if (inDir(w, "roots") || has(w, "root")) return OR.ROOTS;
  if (inDir(w, "aquatic") || has(w, "reed", "cattail", "lily", "lilies", "lilypad", "seaweed", "kelp")) return OR.REEDS;
  if (inDir(w, "mushrooms") || has(w, "mushroom", "fungus", "fungi", "toadstool")) return OR.MUSHROOM;
  const shrub = inDir(w, "shrubs", "bushes", "thorns") || has(w, "bush", "shrub", "hedge", "fern", "thorn", "bramble");
  if (shrub && has(w, "flower")) return OR.FLOWER_SHRUB;
  if (shrub) return OR.SHRUB;
  if (inDir(w, "flowers") || has(w, "flower", "tulip", "rose", "daisy", "daisies", "poppy", "poppies", "lavender")) return OR.FLOWERS;
  if (inDir(w, "grass") || has(w, "grass", "tuft", "weed")) return OR.GRASS;
  if (has(w, "trunk", "stump")) return OR.STUMP;
  if (has(w, "log", "driftwood") || has(w, "wood") && has(w, "burned", "burnt") || has(w, "fallen") && has(w, "branch")) return OR.DEADWOOD;
  if (has(w, "dead", "bare") && has(w, "tree") || has(w, "snag", "leafless")) return OR.BARE;
  if (has(w, "pine", "fir", "spruce", "conifer", "cedar", "cypress", "juniper", "yew", "palm", "mangrove", "eucalyptus")) return OR.EVERGREEN;
  // "ash" is left out: an ash pile is not a tree ("ash_tree" is caught by "tree").
  if (inDir(w, "trees") || has(w, "tree", "oak", "maple", "birch", "willow", "elm", "beech", "apple", "cherry", "cherries", "canopy")) return OR.DECIDUOUS;
  if (inDir(w, "farming") || has(w, "cabbage", "wheat", "corn", "crop", "pumpkin", "carrot")) return OR.CROP;
  if (inDir(w, "boulders", "rubble", "rocks") || has(w, "boulder", "rock", "rubble", "stone", "cairn")) return OR.ROCK;
  if (has(w, "snow", "snowdrift")) return OR.SNOW;
  return OR.STRUCTURE;
}

/**
 * The † roles of 4.1: their objects keep their default name in the sidecar, and the runtime
 * re-derives their role from it with the current tables.
 */
export const NAMED_ROLES: ReadonlySet<ObjectRole> = new Set<ObjectRole>([
  OR.EVERGREEN, OR.DECIDUOUS, OR.SHRUB, OR.FLOWER_SHRUB, OR.BARE, OR.GRASS, OR.FLOWERS, OR.REEDS, OR.CROP,
  OR.MUSHROOM, OR.ROOTS, OR.LITTER, OR.DEADWOOD, OR.STUMP, OR.ROCK, OR.SNOW, OR.ICE,
]);

// ------------------------------------------------------------------ paths, patterns, materials, roofs

/** A path's role; null (packs, embedded, unknown) → PATH_KEEP (the full ribbon stays as drawn), as does an unrecognised default. */
export function pathRole(name: string | null): AreaRole {
  if (!usable(name)) return AR.PATH_KEEP;
  const w = splitName(name);
  if (has(w, "cliff", "chain", "rope", "blood") || has(w, "stairs", "stair") && has(w, "wood", "wooden")) return AR.PATH_KEEP;
  if (has(w, "stairs", "stair") && has(w, "stone") || has(w, "road", "cobble", "cobblestone")) return AR.PATH_PAVED;
  if (has(w, "wagon", "trail", "dirt", "mud", "muddy")) return AR.PATH_EARTH;
  return AR.PATH_KEEP;
}

/**
 * A pattern's role: paving-like → PAVED (outdoor paving unless indoor), floor-like → FLOOR, else KEEP.
 * Paving words win over "tileset": a cobbled or brick pattern is as likely a yard or street as a
 * floor, and an enclosed one becomes FLOOR through the wall-loop rule anyway.
 */
export function patternRole(name: string | null): AreaRole {
  if (!usable(name)) return AR.KEEP;
  const w = splitName(name);
  if (has(w, "cobble", "cobblestone", "flagstone", "paving", "brick")) return AR.PAVED;
  if (has(w, "tileset", "wood", "wooden", "plank", "floor", "carpet", "rug", "parquet")) return AR.FLOOR;
  return AR.KEEP;
}

/** A material's role: cobblestone_tile → PAVED, ice_tile → ICE, floor-like → FLOOR; lava_tile, unknown and null → KEEP. */
export function materialRole(name: string | null): AreaRole {
  if (!usable(name)) return AR.KEEP;
  const w = splitName(name);
  if (has(w, "lava", "magma", "water", "acid")) return AR.KEEP;
  if (has(w, "ice", "icy", "frost", "frozen")) return AR.ICE;
  if (has(w, "cobble", "cobblestone", "flagstone", "paving", "brick")) return AR.PAVED;
  if (has(w, "tileset", "wood", "wooden", "plank", "floor", "carpet", "rug", "parquet")) return AR.FLOOR;
  return AR.KEEP;
}

/** A roof's role: any default roof → ROOF; null (a pack's roof) → KEEP. */
export function roofRole(name: string | null): AreaRole {
  return usable(name) ? AR.ROOF : AR.KEEP;
}

/**
 * Drawn-width share of a path's ribbon, by default path name; any other path takes 0.55
 * (Pelcs's 1-square wagon trail is drawn 0.5–0.6 wide). No prototype: `PATH_DRAWN[name]` is
 * undefined for every name not listed, "__proto__" included. See pathDrawn.
 */
export const PATH_DRAWN: Readonly<Record<string, number>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, number>, { wagon_trail: 0.55 }),
);

/** PATH_DRAWN[name], or the 0.55 default. */
export function pathDrawn(name: string | null): number {
  const v = name === null ? undefined : PATH_DRAWN[name];
  return typeof v === "number" ? v : 0.55;
}

// Season roles of Dungeondraft's default assets (src/client/dd/roles.ts, design 4.1).
import { describe, expect, it } from "vitest";
import { parseAssetRef } from "../src/client/dd/assets";
import type { AssetRef } from "../src/client/dd/model";
import { parseDungeondraftMap } from "../src/client/dd/parse";
import {
  AR, NAMED_ROLES, OR, PATH_DRAWN, TR, defaultName, materialRole, objectRole, pathDrawn, pathRole, patternRole, roofRole,
  terrainRole, type ObjectRole,
} from "../src/client/dd/roles";

type FsLike = { readFileSync(path: string | URL, encoding: "utf8"): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as FsLike;

const ref = (path: string): AssetRef | null => parseAssetRef(path, new Map());
const objName = (p: string) => defaultName(ref(`res://textures/objects/${p}.png`));
const roleOf = (p: string) => objectRole(objName(p));
const nameOf = <T extends Record<string, number>>(table: T, v: number) => Object.keys(table).find((k) => table[k] === v);

const inFolder = (folder: string, names: string): string[] => names.split(" ").map((n) => `${folder}/${n}`);

/**
 * Every default object in the nine sample maps (docs/object-inventory.txt, 304 names), with the
 * role it was given on purpose. A table or keyword change that moves one fails here.
 */
const INVENTORY: Partial<Record<keyof typeof OR, string[]>> = {
  STRUCTURE: [
    ...inFolder("activities/administration", "atlas_globe_02 book_01 book_02 book_03 book_04 book_05 book_06 candle_01 candle_02 candle_holder_02 cloth_01 map_01 map_table_big_01 paper_01 paper_02 paper_03 paper_04 paper_05 scroll_04 scroll_05 scroll_07"),
    ...inFolder("activities/bathing", "bathtub_01 bathtub_02 chair_bath"),
    ...inFolder("activities/cooking", "food_fish_01 pan potatoes"),
    ...inFolder("activities/dining", "big_bowl_04 big_bowl_05 bottle bottle_01 cup food_bread_02 knife_02 plate plate_01 saucer_01 saucer_02 spoon"),
    ...inFolder("activities/logging", "log_cutter"),
    ...inFolder("activities/mining", "plank_01"),
    ...inFolder("activities/smithing", "anvil bellows_big coal_bag forge_small_02 hammer workbench"),
    ...inFolder("camp", "camp_bed_02 camp_bed_03 camp_bed_04"),
    ...inFolder("clutter/cobwebs", "spiderweb_01 spiderweb_04 spiderweb_07 spiderweb_08 spiderweb_09 spiderweb_21"),
    ...inFolder("clutter/floor", "broken_pottery_02 broken_pottery_04 broken_pottery_05 broken_pottery_06 broken_pottery_07 broken_pottery_09 broken_pottery_10 broken_pottery_11 floor_cloth_03"),
    ...inFolder("corpses", "corpse_07"),
    ...inFolder("creatures", "bird_nest_04 bird_nest_05 mouse"),
    ...inFolder("crime", "hanging_cage_01 hanging_cage_02"),
    ...inFolder("decor/dungeon", "treasure_chest_01 treasure_chest_02"),
    ...inFolder("decor/floor", "bear_rug big_vase_01 rug_cow_02"),
    ...inFolder("decor/lighting", "bowl_lamp_01 chandelier_01 lantern_01 torch_01 wall_torch_01"),
    ...inFolder("decor/statues", "statue_02"),
    ...inFolder("furniture/beds", "bed_01 bed_02 bed_03 bed_09 bed_10 bed_11"),
    ...inFolder("furniture/broken", "bed_broken_02 chair_broken_02 pillar_broken_12"),
    ...inFolder("furniture/chairs", "arm_chair_01 bench_01 bench_02 round_chair_01"),
    ...inFolder("furniture/desks", "desk_01"),
    ...inFolder("furniture/storage", "chest_01 merchant_shelf_01 merchant_shelf_02 merchant_shelf_03 merchant_shelf_04 merchant_shelf_05 small_chest_01"),
    ...inFolder("furniture/tables", "bar_table round_table_01 round_table_03 small_table_03"),
    ...inFolder("hardware/toilets", "toilet_01"),
    ...inFolder("magic", "altar_02"),
    ...inFolder("military/defense", "barrier_sandbag_01 barrier_sandbag_02"),
    ...inFolder("military/machines", "ballista_02"),
    ...inFolder("military/training", "bowl_w_arrows target_04"),
    ...inFolder("military/weapons", "bow_01 sword_01 sword_02"),
    ...inFolder("stable", "horse_01 horse_03 horse_04 stable_01 trough_barn_04"),
    ...inFolder("structures", "bucket road_sign_01 road_sign_04"),
    ...inFolder("structures/chimneys", "chimney_05"),
    ...inFolder("structures/fountains", "fountain_03"),
    ...inFolder("supplies/barrels", "barrel_01 barrel_02 barrel_03 barrel_04 barrel_05 giant_barrel_02 giant_barrel_03"),
    ...inFolder("supplies/cages", "cage_06"),
    ...inFolder("supplies/crates", "crate_01 crate_03 crate_04 fruit_box_01 fruit_box_02 fruit_box_03 fruit_box_04 fruit_box_05 fruit_box_06"),
    ...inFolder("supplies/sacks", "grain-sack_02 sack_05 sack_06 sack_08 sack_14"),
    ...inFolder("vehicles", "wagon_wreckage_02"),
  ],
  CROP: [
    ...inFolder("activities/farming", "cabbage_01"),
  ],
  DEADWOOD: [
    ...inFolder("activities/logging", "log_pile_01 log_pile_02 log_pile_03 log_pile_04"),
    ...inFolder("vegetation/fallen", "log_02 log_04 log_05 wood_burned_03 wood_burned_04 wood_burned_05 wood_burned_06"),
  ],
  FIRE: [
    ...inFolder("camp", "campfire_06"),
    ...inFolder("structures", "fireplace_02"),
  ],
  ROCK: [
    ...inFolder("clutter/boulders", "boulder_01 boulder_04 boulder_06 boulder_07 boulder_08 boulder_10"),
    ...inFolder("clutter/rubble", "rubble_01 rubble_02 rubble_03 rubble_04 rubble_05 rubble_07 rubble_08 rubble_09 rubble_10 rubble_11 rubble_12 rubble_15 rubble_16"),
    ...inFolder("swamp", "swamp_rocks_03"),
  ],
  WATER_FX: [
    ...inFolder("clutter/water", "water_circle_03 water_circle_04 waterfall_color_05 waterfall_color_09"),
  ],
  EFFECT: [
    ...inFolder("environment", "fire_03 smoke_01 smoke_02 smoke_03 smoke_06"),
  ],
  SNOW: [
    ...inFolder("environment", "snow_01 snow_02 snow_03 snow_04 snow_05 snow_06 snow_07 snow_08 snow_09 snow_10 snow_11 snow_12 snow_13 snow_14 snow_15"),
  ],
  EVERGREEN: [
    ...inFolder("more_trees", "eucalyptus_04"),
    ...inFolder("swamp", "mangrove_tree_04 mangrove_tree_07"),
    ...inFolder("vegetation/trees", "pine_tree_01 pine_tree_02 pine_tree_03 pine_tree_04"),
  ],
  STUMP: [
    ...inFolder("more_trees", "mossy_trunks_06"),
    ...inFolder("vegetation/trees", "stump_01 stump_02 stump_03 stump_04 stump_05"),
  ],
  DECIDUOUS: [
    ...inFolder("more_trees", "oak_04"),
    ...inFolder("vegetation/trees", "tree_big_green_01 tree_big_green_02 tree_big_green_03 tree_branch_01 tree_branch_02 tree_branch_03 tree_green_simple_01 tree_green_simple_02 tree_green_simple_03 tree_green_simple_04 tree_massive_green_01"),
  ],
  FLOWERS: [
    ...inFolder("structures/garden", "flower_bed_03"),
    ...inFolder("vegetation/flowers", "flowers_02 flowers_04 flowers_05"),
  ],
  REEDS: [
    ...inFolder("vegetation/aquatic", "reeds_2"),
  ],
  LITTER: [
    ...inFolder("vegetation/fallen", "dead_leaves_01 dead_leaves_02 dead_leaves_03 dead_leaves_04 dead_leaves_05 leaves_01 leaves_02 leaves_03 leaves_04"),
  ],
  GRASS: [
    ...inFolder("vegetation/grass", "grass_06 grass_07 grass_10 grass_11 grass_12 grass_13 grass_14 grass_15 grass_16 grass_17 grass_18 grass_19 grass_20 grass_21 grass_22 grass_23 grass_24 grass_25 grass_26"),
  ],
  MUSHROOM: [
    ...inFolder("vegetation/mushrooms", "magic_mushrooms_03 magic_mushrooms_07 mushrooms_01"),
  ],
  ROOTS: [
    ...inFolder("vegetation/roots", "exposed_roots_01 exposed_roots_02 exposed_roots_03 exposed_roots_04 exposed_roots_05 exposed_roots_06 exposed_roots_07 exposed_roots_08 exposed_roots_09 exposed_roots_10 exposed_roots_big_1 exposed_roots_big_2 exposed_roots_big_3 exposed_roots_big_4 exposed_roots_big_6"),
  ],
  FLOWER_SHRUB: [
    ...inFolder("vegetation/shrubs", "bush_flower_01 bush_flower_03 bush_flower_04"),
  ],
  SHRUB: [
    ...inFolder("vegetation/shrubs", "bush_green_simple_01 bush_green_simple_03 bush_green_simple_04 bush_green_simple_05 bush_green_simple_06 bush_green_simple_07 bush_green_simple_08 bush_green_simple_09 bush_green_simple_10 bush_green_simple_11 bush_green_simple_12 bush_green_simple_13"),
    ...inFolder("vegetation/thorns", "thorns_16 thorns_18"),
  ],
  BARE: [
    ...inFolder("vegetation/trees", "dead_tree_01 dead_tree_02 dead_tree_03"),
  ],
};

describe("roles: the M0 contract", () => {
  it("keeps the frozen numbers", () => {
    expect(TR).toEqual({ SNOW: 1, ICE: 2, GRASS: 3, EARTH: 4, SAND: 5, ROCK: 6, PAVED: 7, KEEP: 8 });
    expect(AR).toEqual({ WATER: 1, FLOOR: 2, CAVE: 3, CAVE_RIM: 4, ROOF: 5, WALL: 6, PATH_EARTH: 7, PATH_PAVED: 8, PATH_KEEP: 9, PAVED: 10, ICE: 11, KEEP: 12 });
    expect(OR).toEqual({ EVERGREEN: 1, DECIDUOUS: 2, SHRUB: 3, FLOWER_SHRUB: 4, BARE: 5, GRASS: 6, FLOWERS: 7, REEDS: 8, CROP: 9,
      MUSHROOM: 10, ROOTS: 11, LITTER: 12, DEADWOOD: 13, STUMP: 14, ROCK: 15, SNOW: 16, ICE: 17, WATER_FX: 18, EFFECT: 19,
      FIRE: 20, STRUCTURE: 21, OPAQUE: 22 });
  });

  it("names are kept for the † roles only", () => {
    const named = [...NAMED_ROLES].map((r) => nameOf(OR, r)).sort();
    expect(named).toEqual(["BARE", "CROP", "DEADWOOD", "DECIDUOUS", "EVERGREEN", "FLOWERS", "FLOWER_SHRUB", "GRASS", "ICE", "LITTER",
      "MUSHROOM", "REEDS", "ROCK", "ROOTS", "SHRUB", "SNOW", "STUMP"]);
  });

  it("defaultName is the path under res://textures/<kind>/, without its extension", () => {
    expect(defaultName(ref("res://textures/objects/vegetation/trees/pine_tree_02.png"))).toBe("vegetation/trees/pine_tree_02");
    expect(defaultName(ref("res://textures/terrain/terrain_snow.png"))).toBe("terrain_snow");
    expect(defaultName(ref("res://textures/paths/wagon_trail.png"))).toBe("wagon_trail");
    expect(defaultName(ref("res://textures/tilesets/simple/tileset_wood_interlaced.png"))).toBe("simple/tileset_wood_interlaced");
    expect(defaultName(ref("res://textures/materials/cobblestone_tile.png"))).toBe("cobblestone_tile");
    expect(defaultName(ref("res://textures/roofs/round_slate_gray/tiles.png"))).toBe("round_slate_gray/tiles");
    expect(defaultName(null)).toBeNull();
  });
});

describe("roles: every default object in the samples has a deliberate role", () => {
  const all = Object.entries(INVENTORY).flatMap(([role, names]) => names.map((n) => [role, n] as const));

  it("covers the whole inventory, once each", () => {
    expect(all.length).toBe(304);
    expect(new Set(all.map(([, n]) => n)).size).toBe(304);
  });

  it("gives each its role", () => {
    const wrong = all.filter(([role, n]) => roleOf(n) !== OR[role as keyof typeof OR]).map(([role, n]) => `${n}: ${nameOf(OR, roleOf(n))}, not ${role}`);
    expect(wrong).toEqual([]);
  });

  it("Par: eucalyptus and mangrove are evergreen, whatever their number", () => {
    for (const n of ["more_trees/eucalyptus_01", "more_trees/eucalyptus_09", "swamp/mangrove_tree_01", "swamp/mangrove_tree_12"]) {
      expect(roleOf(n), n).toBe(OR.EVERGREEN);
    }
  });
});

describe("roles: packs, embedded and unknown sources are never interpreted", () => {
  const packs = new Map([["AbCd1234", { id: "AbCd1234", name: "P", version: "1", author: "a", allowThirdParty: true }]]);
  const pack = (p: string) => parseAssetRef(`res://packs/AbCd1234/textures/${p}.png`, packs);

  it("null in, the as-drawn role out", () => {
    expect(objectRole(null)).toBe(OR.OPAQUE);
    expect(terrainRole(null)).toBe(TR.KEEP);
    expect(pathRole(null)).toBe(AR.PATH_KEEP);
    expect(patternRole(null)).toBe(AR.KEEP);
    expect(materialRole(null)).toBe(AR.KEEP);
    expect(roofRole(null)).toBe(AR.KEEP);
  });

  it("a pack's names don't count, even when the pack lets third parties read it", () => {
    for (const p of ["objects/vegetation/trees/pine_tree_01", "objects/environment/snow_01", "terrain/terrain_snow", "paths/wagon_trail",
      "tilesets/simple/tileset_cobble", "materials/ice_tile", "roofs/x/tiles"]) {
      expect(pack(p)!.source).toBe("pack");
      expect(defaultName(pack(p)), p).toBeNull();
    }
    expect(objectRole(defaultName(pack("objects/vegetation/trees/pine_tree_01")))).toBe(OR.OPAQUE);
    expect(terrainRole(defaultName(pack("terrain/terrain_snow")))).toBe(TR.KEEP);
    expect(pathRole(defaultName(pack("paths/wagon_trail")))).toBe(AR.PATH_KEEP);
    expect(roofRole(defaultName(pack("roofs/x/tiles")))).toBe(AR.KEEP);
  });

  it("embedded, unknown and malformed sources give null", () => {
    for (const p of ["embedded_key_1", "res://other/objects/pine_tree.png", "res://textures/pine_tree.png", "res://textures/../packs/x/objects/pine.png",
      "user://objects/pine_tree.png", ""]) {
      expect(defaultName(ref(p)), p).toBeNull();
    }
  });
});

describe("roles: terrain, paths, patterns, materials and roofs", () => {
  it("the default terrain textures seen in the samples", () => {
    const seen: Record<string, number> = {
      terrain_dirt: TR.EARTH, terrain_grass: TR.GRASS, terrain_gravel: TR.ROCK, terrain_limestone: TR.ROCK, terrain_moss: TR.GRASS,
      terrain_rocky: TR.ROCK, terrain_sand: TR.SAND, terrain_sandstone: TR.ROCK, terrain_snow: TR.SNOW,
    };
    for (const [n, r] of Object.entries(seen)) expect(terrainRole(defaultName(ref(`res://textures/terrain/${n}.png`))), n).toBe(r);
  });

  it("terrain keywords", () => {
    const cases: Array<[string, number]> = [
      ["terrain_ice", TR.ICE], ["terrain_frozen_lake", TR.ICE], ["terrain_snowy_rocks", TR.SNOW], ["terrain_lava", TR.KEEP],
      ["terrain_water", TR.KEEP], ["terrain_magma_cracked", TR.KEEP], ["terrain_mud", TR.EARTH], ["terrain_swamp", TR.EARTH],
      ["terrain_cracked_earth", TR.EARTH], ["terrain_forest_floor", TR.GRASS], ["terrain_leaves", TR.GRASS], ["terrain_meadow", TR.GRASS],
      ["terrain_beach", TR.SAND], ["terrain_desert", TR.SAND], ["terrain_cobblestone", TR.PAVED], ["terrain_bricks", TR.PAVED],
      ["terrain_tiles", TR.PAVED], ["terrain_slate", TR.ROCK], ["terrain_pebbles", TR.ROCK], ["terrain_mystery", TR.KEEP],
      ["Terrain_Snow", TR.SNOW],
    ];
    for (const [n, r] of cases) expect(terrainRole(n), n).toBe(r);
  });

  it("paths: drawn earth, paving, and the ones left as drawn", () => {
    const cases: Array<[string, number]> = [
      ["wagon_trail", AR.PATH_EARTH], ["dirt_path", AR.PATH_EARTH], ["mud_trail", AR.PATH_EARTH],
      ["stairs_stone_1", AR.PATH_PAVED], ["stairs_stone_2", AR.PATH_PAVED], ["road", AR.PATH_PAVED], ["cobble_road", AR.PATH_PAVED],
      ["cliff", AR.PATH_KEEP], ["stairs_wood_2", AR.PATH_KEEP], ["chain", AR.PATH_KEEP], ["rope_01", AR.PATH_KEEP],
      ["blood_trail", AR.PATH_KEEP], ["fence_wood", AR.PATH_KEEP], ["stairs", AR.PATH_KEEP],
    ];
    for (const [n, r] of cases) expect(pathRole(defaultName(ref(`res://textures/paths/${n}.png`))), n).toBe(r);
  });

  it("patterns: paving before floors (a cobbled tileset may be a yard), else as drawn", () => {
    const cases: Array<[string, number]> = [
      ["simple/tileset_wood_interlaced", AR.FLOOR], ["simple/tileset_carpet", AR.FLOOR], ["simple/tileset_straw", AR.FLOOR],
      ["wood_planks", AR.FLOOR], ["parquet", AR.FLOOR], ["rug_red", AR.FLOOR],
      ["simple/tileset_cobble", AR.PAVED], ["simple/tileset_brick_running", AR.PAVED], ["flagstone_2", AR.PAVED], ["paving_01", AR.PAVED],
      ["stone_2", AR.KEEP], ["colorable/swirl", AR.KEEP],
    ];
    for (const [n, r] of cases) expect(patternRole(n), n).toBe(r);
  });

  it("materials and roofs", () => {
    expect(materialRole("cobblestone_tile")).toBe(AR.PAVED);
    expect(materialRole("ice_tile")).toBe(AR.ICE);
    expect(materialRole("lava_tile")).toBe(AR.KEEP);
    expect(materialRole("water_tile")).toBe(AR.KEEP);
    expect(materialRole("wood_tile")).toBe(AR.FLOOR);
    expect(materialRole("grass_tile")).toBe(AR.KEEP);
    expect(roofRole("round_slate_gray/tiles")).toBe(AR.ROOF);
    expect(roofRole("anything/tiles")).toBe(AR.ROOF);
  });

  it("PATH_DRAWN: 0.55 by default, and no prototype to trip over", () => {
    expect(PATH_DRAWN.wagon_trail).toBe(0.55);
    expect(Object.getPrototypeOf(PATH_DRAWN)).toBeNull();
    expect(Object.isFrozen(PATH_DRAWN)).toBe(true);
    expect(PATH_DRAWN["__proto__"]).toBeUndefined();
    expect(PATH_DRAWN["toString"]).toBeUndefined();
    for (const n of [null, "__proto__", "constructor", "toString", "cliff", "wagon_trail"]) expect(pathDrawn(n), String(n)).toBe(0.55);
  });
});

describe("roles: object keywords for defaults outside the inventory", () => {
  it("by kind", () => {
    const cases: Array<[string, keyof typeof OR]> = [
      ["vegetation/trees/palm_tree_01", "EVERGREEN"], ["vegetation/trees/spruce_02", "EVERGREEN"], ["vegetation/trees/firs_01", "EVERGREEN"],
      ["vegetation/trees/birch_03", "DECIDUOUS"], ["vegetation/trees/tree_autumn_01", "DECIDUOUS"], ["vegetation/trees/willow", "DECIDUOUS"],
      ["vegetation/trees/dead_pine_tree", "BARE"], ["vegetation/trees/snag_01", "BARE"], ["vegetation/trees/leafless_03", "BARE"],
      ["vegetation/shrubs/fern_01", "SHRUB"], ["vegetation/bushes/bush_rose", "SHRUB"], ["vegetation/shrubs/flowering_bush_flowers", "FLOWER_SHRUB"],
      ["vegetation/flowers/tulips_01", "FLOWERS"], ["vegetation/flowers/daisies", "FLOWERS"], ["vegetation/grass/weeds_02", "GRASS"],
      ["vegetation/lily_pads_02", "REEDS"], ["vegetation/aquatic/cattails", "REEDS"], ["vegetation/mushrooms/toadstool", "MUSHROOM"],
      ["vegetation/roots/roots_big", "ROOTS"], ["vegetation/fallen/branch_01", "DEADWOOD"], ["clutter/driftwood", "DEADWOOD"],
      ["vegetation/leaves_pile", "LITTER"], ["vegetation/trees/stump_moss", "STUMP"], ["clutter/stones_01", "ROCK"], ["clutter/cairn", "ROCK"],
      ["environment/icicles_01", "ICE"], ["clutter/icicle_03", "ICE"], ["environment/snowdrift_02", "SNOW"], ["clutter/snow_pile", "SNOW"],
      ["environment/fog_01", "EFFECT"], ["environment/dust_03", "EFFECT"], ["clutter/water/splash_02", "WATER_FX"], ["clutter/bonfire", "FIRE"],
      ["activities/farming/wheat_01", "CROP"], ["activities/farming/pumpkins", "CROP"], ["structures/garden/hedge_02", "SHRUB"],
    ];
    const wrong = cases.filter(([n, r]) => roleOf(n) !== OR[r]).map(([n, r]) => `${n}: ${nameOf(OR, roleOf(n))}, not ${r}`);
    expect(wrong).toEqual([]);
  });

  it("whole words only", () => {
    const cases: Array<[string, keyof typeof OR]> = [
      ["clutter/campfire_ring", "FIRE"], ["clutter/fires_01", "STRUCTURE"], ["clutter/pineapple", "STRUCTURE"], ["clutter/firewood", "STRUCTURE"],
      ["clutter/ashes", "STRUCTURE"], ["clutter/rosemary", "STRUCTURE"], ["clutter/treasure", "STRUCTURE"], ["clutter/rockets", "STRUCTURE"],
    ];
    const wrong = cases.filter(([n, r]) => roleOf(n) !== OR[r]).map(([n, r]) => `${n}: ${nameOf(OR, roleOf(n))}, not ${r}`);
    expect(wrong).toEqual([]);
  });

  it("man-made folders stay as drawn whatever their file names say", () => {
    for (const n of ["furniture/potted_tree_01", "decor/snow_globe", "supplies/crates/pine_crate", "activities/logging/log_cutter",
      "decor/floor/flower_rug", "military/stone_barrier", "stable/hay_grass_bale"]) {
      expect(roleOf(n), n).toBe(OR.STRUCTURE);
    }
    expect(roleOf("unknown_folder/thing_01")).toBe(OR.STRUCTURE);
  });
});

describe("roles: hostile names", () => {
  it("defaultName refuses odd or over-long names", () => {
    for (const p of [`objects/${"a".repeat(130)}`, "objects/pine tree_01", "objects/pine\u0000tree", "objects/<b>tree</b>", "objects/pine%2Etree"]) {
      expect(defaultName(ref(`res://textures/${p}.png`)), p).toBeNull();
    }
  });

  it("role functions are total on any string", () => {
    const odd = ["__proto__", "constructor", "toString", "hasOwnProperty", "", "/", "//", "a/", "x".repeat(10_000), "\u0000", "é/ü"];
    for (const n of odd) {
      for (const f of [objectRole, terrainRole, pathRole, patternRole, materialRole, roofRole] as Array<(n: string | null) => number>) {
        expect(typeof f(n), `${f.name}(${n.slice(0, 20)})`).toBe("number");
      }
    }
    expect(objectRole("__proto__")).toBe(OR.STRUCTURE);
    expect(objectRole("x".repeat(10_000))).toBe(OR.OPAQUE);
    expect(objectRole("")).toBe(OR.OPAQUE);
    expect(terrainRole("x".repeat(10_000))).toBe(TR.KEEP);
    expect(roofRole("x".repeat(10_000))).toBe(AR.KEEP);
  });

  it("stays fast on the longest names", () => {
    const names = Array.from({ length: 5000 }, (_, i) => `vegetation/${"ab_".repeat(38)}${i}`);
    const t0 = performance.now();
    for (const n of names) { objectRole(n); terrainRole(n); pathRole(n); patternRole(n); materialRole(n); }
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("roles: waterfall.dungeondraft_map (4.1)", () => {
  const map = parseDungeondraftMap(fs.readFileSync(new URL("./fixtures/dd/waterfall.dungeondraft_map", import.meta.url), "utf8"));
  const L = map.world.levels[0];

  it("its 71 objects", () => {
    const count: Record<string, number> = {};
    for (const o of L.objects) {
      const r = nameOf(OR, objectRole(defaultName(o.texture)) as ObjectRole)!;
      count[r] = (count[r] ?? 0) + 1;
    }
    expect(count).toEqual({ EVERGREEN: 27, DECIDUOUS: 2, BARE: 8, GRASS: 21, REEDS: 7, DEADWOOD: 1, STUMP: 1, ROCK: 2, WATER_FX: 1, OPAQUE: 1 });
    const evergreen = L.objects.map((o) => defaultName(o.texture)).filter((n) => objectRole(n) === OR.EVERGREEN);
    expect(evergreen.filter((n) => n!.includes("pine_tree")).length).toBe(17);
    expect(evergreen.filter((n) => n!.includes("eucalyptus")).length).toBe(6);
    expect(evergreen.filter((n) => n!.includes("mangrove")).length).toBe(4);
  });

  it("its terrain (snow 81.1%, rock 18.9%) and its two pack cliff paths", () => {
    const t = L.terrain!;
    const n = t.width * t.height;
    const byRole = new Map<number, number>();
    let total = 0;
    for (let k = 0; k < t.slotCount; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += t.weights[k * n + i];
      const r = terrainRole(defaultName(t.slots[k]));
      byRole.set(r, (byRole.get(r) ?? 0) + s);
      total += s;
    }
    expect((100 * byRole.get(TR.SNOW)!) / total).toBeCloseTo(81.1, 1);
    expect((100 * byRole.get(TR.ROCK)!) / total).toBeCloseTo(18.9, 1);
    expect(t.slots.map((s) => nameOf(TR, terrainRole(defaultName(s))))).toEqual(["ROCK", "EARTH", "ROCK", "SAND", "SNOW", "GRASS", "ROCK", "ROCK"]);
    expect(L.paths.map((p) => pathRole(defaultName(p.texture)))).toEqual([AR.PATH_KEEP, AR.PATH_KEEP]);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import { terrainId, type DungeonStampId, type Stamp } from "../src/shared/terrain";
import type { TerrainItem } from "../src/shared/types";
import { OR } from "../src/client/dd/roles";
import { BuildModel, BuildRenderer, computeExposure, indexTerrain } from "../src/client/room/build";
import { hasSeasonalArt, type StampLook } from "../src/client/room/buildArt";
import {
  ERASE,
  VARIETIES,
  changesWithoutSnow,
  colourCss,
  dungeonLook,
  dungeonRole,
  dungeonSeasonal,
  leafInk,
  makesOutdoors,
  parseColour,
  snowDots,
  snowInk,
} from "../src/client/room/dungeonSeasons";
import { drawDungeonStamp, loadDungeonObjects } from "../src/client/room/dungeonStamps";

// Dungeon's objects in the seasons: a role for each from its name, snow on everything outdoors
// in winter, and the plants changing all year as Tabletop's own tree and bush do.

const SCENE = "Scene1234567";
const look = (l: StampLook["look"], level: 1 | 2 | 3, hash = 0.5, cover: 0 | 1 | 2 | 3 = 0): StampLook => ({ look: l, level, hash, cover });

describe("Dungeon objects' season roles", () => {
  it("come from their names, as for Dungeondraft's own objects", () => {
    expect(dungeonRole("d:oak-tree")).toBe(OR.DECIDUOUS);
    expect(dungeonRole("d:fir-tree")).toBe(OR.EVERGREEN);
    expect(dungeonRole("d:pine")).toBe(OR.EVERGREEN);
    expect(dungeonRole("d:dead-tree")).toBe(OR.BARE);
    expect(dungeonRole("d:hedge")).toBe(OR.SHRUB);
    expect(dungeonRole("d:flowers-red")).toBe(OR.FLOWERS);
    expect(dungeonRole("d:campfire")).toBe(OR.FIRE);
    expect(dungeonRole("d:snowdrift")).toBe(OR.SNOW);
    // Nothing man-made is taken for a plant or a rock. What grows outside Nature: the farm's
    // fields (crops) and Light's glowing mushrooms.
    for (const p of DUNGEON_PROPS) {
      const role = dungeonRole(`d:${p.id}` as DungeonStampId);
      if (p.category === "Farm & village" && p.group === "Fields") expect(role, p.id).toBe(OR.CROP);
      else if (p.id.startsWith("glowing-mushrooms")) expect(role, p.id).toBe(OR.MUSHROOM);
      else if (p.category !== "Nature") expect([OR.STRUCTURE, OR.FIRE, OR.DEADWOOD], p.id).toContain(role);
    }
    // And everything in Nature is taken for what it is, so the seasons change it.
    for (const p of DUNGEON_PROPS.filter((x) => x.category === "Nature")) {
      expect([OR.STRUCTURE, OR.OPAQUE], p.id).not.toContain(dungeonRole(`d:${p.id}` as DungeonStampId));
    }
  });

  it("say what makes its squares outdoors and what changes without snow", () => {
    for (const id of ["tree", "bush", "d:oak-tree", "d:pine", "d:flowers-red", "d:grass-tuft", "d:reeds"] as const) expect(makesOutdoors(id), id).toBe(true);
    for (const id of ["table", "rock", "d:table", "d:rock", "d:log", "d:mushrooms", "d:campfire"] as const) expect(makesOutdoors(id), id).toBe(false);
    expect(changesWithoutSnow("d:pine")).toBe(true);
    expect(changesWithoutSnow("d:dead-tree")).toBe(false);
    expect(changesWithoutSnow("d:wagon")).toBe(false);
  });

  it("give everything outdoors snow in winter, and only plants the other seasons", () => {
    for (const p of DUNGEON_PROPS) {
      const id = `d:${p.id}` as DungeonStampId;
      // Snow itself is the one thing winter doesn't add snow to.
      const snow = dungeonRole(id) === OR.SNOW;
      expect(dungeonSeasonal(id, "winter"), p.id).toBe(!snow);
      expect(hasSeasonalArt(id, "winter"), p.id).toBe(!snow);
    }
    expect(dungeonSeasonal("d:oak-tree", "autumn")).toBe(true);
    expect(dungeonSeasonal("d:pine", "autumn")).toBe(false);
    expect(dungeonSeasonal("d:pine", "spring")).toBe(true);
    expect(dungeonSeasonal("d:table", "spring")).toBe(false);
    expect(dungeonSeasonal("d:dead-tree", "summer")).toBe(false);
  });
});

describe("a Dungeon object's look in a season", () => {
  it("is just as drawn when nothing changes", () => {
    expect(dungeonLook("d:oak-tree", look("summer", 1), false)).toBeNull();
    expect(dungeonLook("d:table", look("autumn", 3), false)).toBeNull();
    // Winter with no snow round it: a table is as drawn, a tree still goes wintry.
    expect(dungeonLook("d:table", look("winter", 2, 0.5, 0), false)).toBeNull();
    expect(dungeonLook("d:oak-tree", look("winter", 2, 0.5, 0), false)).toMatchObject({ snow: 0, draw: "oak-tree" });
    expect(dungeonLook("d:table", look("winter", 2, 0.5, 2), false)).toMatchObject({ snow: 2, draw: "table", blossom: null });
  });

  it("leaves 3 in 5 broadleaf trees bare in deep snow, and 2 in 5 in blossom from level 2 of spring, a third of those cherry", () => {
    const hashes = Array.from({ length: VARIETIES }, (_, v) => (v + 0.5) / VARIETIES);
    const bare = hashes.filter((h) => dungeonLook("d:oak-tree", look("winter", 3, h, 3), false)!.draw === "dead-tree");
    expect(bare).toHaveLength(3);
    expect(dungeonLook("d:oak-tree", look("winter", 2, 0.1, 2), false)!.draw).toBe("oak-tree");
    expect(dungeonLook("d:dead-tree", look("winter", 1, 0.1, 1), false)).toMatchObject({ draw: "dead-tree", snowOnStrokes: true });
    const blooms = hashes.map((h) => dungeonLook("d:oak-tree", look("spring", 2, h), false)!.blossom);
    expect(blooms.filter(Boolean)).toHaveLength(2);
    expect(dungeonLook("d:oak-tree", look("spring", 1, 0.1), false)!.blossom).toBeNull();
    expect(dungeonLook("d:pine", look("spring", 3, 0.1), false)!.blossom).toBeNull();
  });

  it("has a key that tells its pictures apart, and the same one for the same look", () => {
    const keys = new Set<string>();
    for (const l of ["spring", "summer", "autumn", "winter"] as const) {
      for (const level of [1, 2, 3] as const) {
        for (const cover of [0, 1, 2, 3] as const) {
          const a = dungeonLook("d:oak-tree", look(l, level, 0.3, l === "winter" ? cover : 0), false);
          if (a) keys.add(a.key);
          expect(dungeonLook("d:oak-tree", look(l, level, 0.3, l === "winter" ? cover : 0), false)?.key).toBe(a?.key);
        }
      }
    }
    expect(keys.size).toBe(3 + 2 + 3 + 3 * 4);
  });
});

describe("colours in a season", () => {
  const ink = (id: DungeonStampId, s: StampLook) => dungeonLook(id, s, false)!.ink;

  it("reads Dungeon's colours", () => {
    expect(parseColour("#2c5220")).toEqual([44, 82, 32, 1]);
    expect(parseColour("#abc")).toEqual([170, 187, 204, 1]);
    expect(parseColour("rgba(20,35,15,0.6)")).toEqual([20, 35, 15, 0.6]);
    expect(parseColour("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(parseColour("red")).toBeNull();
    expect(colourCss([20, 35, 15, 0.6])).toBe("rgba(20,35,15,0.6)");
    expect(colourCss([300, -4, 3.4, 1])).toBe("rgb(255,0,3)");
  });

  it("turn leaves in autumn but not ink, wood or stone", () => {
    const autumn = ink("d:oak-tree", look("autumn", 3, 0.3));
    const turned = new Set<string | null>();
    for (let salt = 1; salt <= 40; salt++) turned.add(autumn("#5a8a36", "fill", salt, true));
    // Some clumps fallen, some still green, the rest turned.
    expect(turned.has(null)).toBe(true);
    expect(turned.has("rgb(90,138,54)")).toBe(true);
    expect(turned.size).toBeGreaterThan(3);
    // A crown's dark base is one fill under all its clumps: it never falls.
    const base = ink("d:oak-tree", look("autumn", 3, 0.3));
    for (let salt = 1; salt <= 40; salt++) expect(base("#1c3614", "fill", salt, false)).not.toBeNull();
    for (const css of ["#1e1712", "#8a5a30", "#a8a6a0", "rgba(0,0,0,0.25)"]) expect(autumn(css, "fill", 1, false)).toBe(css);
  });

  it("are the same on every screen", () => {
    const a = ink("d:oak-tree", look("autumn", 2, 0.7));
    const b = ink("d:oak-tree", look("autumn", 2, 0.7));
    for (let salt = 1; salt <= 30; salt++) expect(a("#2c5220", "fill", salt, true)).toBe(b("#2c5220", "fill", salt, true));
  });

  it("dry the grass in a hot summer and fade the flowers in autumn", () => {
    const hot = ink("d:grass-tuft", look("summer", 3));
    expect(hot("#3a6a24", "stroke", 1, false)).not.toBe("#3a6a24");
    const autumn = ink("d:flowers-red", look("autumn", 3));
    const [r, g, b] = parseColour(autumn("#d8323a", "fill", 1, false) as string)!;
    expect(r - Math.min(g, b)).toBeLessThan(0xd8 - 0x32);
  });
});

describe("where snow and blossom go", () => {
  it("snow lies on what's solid, not on shadows or ink outlines, nor on a flame", () => {
    const snow = snowInk(true, false);
    expect(snow("#8a5a30", "fill", 1, false)).toBe("#fff");
    expect(snow("rgba(0,0,0,0.25)", "fill", 1, false)).toBeNull();
    expect(snow("#1e1712", "stroke", 1, false)).toBe(ERASE);
    expect(snow("rgba(40,24,12,0.35)", "stroke", 1, false)).toBeNull();
    expect(snow("#ff7a1a", "fill", 1, true)).toBe(ERASE);
    // Something that gives no light has no flames: a yellow flower takes snow.
    expect(snowInk(false, false)("#f2c838", "fill", 1, false)).toBe("#fff");
    // A bare tree's branches are strokes, and hold snow.
    expect(snowInk(false, true)("#3a2c22", "stroke", 1, false)).toBe("#fff");
  });

  it("blossom only on leaves", () => {
    const leaf = leafInk();
    expect(leaf("#5a8a36", "fill", 1, true)).toBe("#fff");
    expect(leaf("#e86aa8", "fill", 1, false)).toBe(ERASE);
    expect(leaf("rgba(0,0,0,0.25)", "fill", 1, false)).toBeNull();
  });

  it("snowflakes are the same size in squares on any object", () => {
    const small = snowDots(0.5, 2, 1);
    const big = snowDots(3, 2, 1);
    const mean = (d: { r: number }[], k: number) => (d.reduce((s, x) => s + x.r, 0) / d.length) * k;
    expect(mean(small.dots, 0.5)).toBeCloseTo(mean(big.dots, 3), 1);
    expect(big.dots.length).toBeGreaterThan(small.dots.length * 10);
    expect(snowDots(1, 3, 1).sheet).toBeGreaterThan(snowDots(1, 1, 1).sheet);
  });
});

/** A 2D context that takes any call, logging fills and strokes (Dungeon's drawings use plenty of methods). */
function fakeContext(log: string[]): CanvasRenderingContext2D {
  const state: Record<PropertyKey, unknown> = { fillStyle: "#000", strokeStyle: "#000" };
  const gradient = () => ({ addColorStop: () => undefined });
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_, name) {
      if (name === "createRadialGradient" || name === "createLinearGradient") return gradient;
      if (name in state) return state[name];
      return (..._args: unknown[]) => {
        if (name === "fill" || name === "fillRect") log.push(`fill ${String(state.fillStyle)}`);
        if (name === "stroke" || name === "strokeRect") log.push(`stroke ${String(state.strokeStyle)}`);
      };
    },
    set(_, name, v) {
      state[name] = typeof v === "object" ? "gradient" : v;
      return true;
    },
  });
}

describe("drawing Dungeon objects in a season", () => {
  // They load the first time one is drawn on a page; here, before any is.
  beforeAll(() => loadDungeonObjects());

  it("draws every one in every look, recoloured where its plants are", () => {
    const looks = [null, look("spring", 3, 0.1), look("summer", 3), look("autumn", 3, 0.7), look("winter", 3, 0.1, 3)];
    for (const p of DUNGEON_PROPS) {
      const id = `d:${p.id}` as DungeonStampId;
      const logs = looks.map((s) => {
        const log: string[] = [];
        drawDungeonStamp(fakeContext(log), id, s, 0, 0);
        return log;
      });
      for (const log of logs) expect(log.length, p.id).toBeGreaterThan(0);
      // Outside a browser there are no sprites: the colours change, the snow and blossom don't come.
      if (p.id === "oak-tree") expect(logs[3]).not.toEqual(logs[0]);
      if (p.id === "table") for (const log of logs) expect(log).toEqual(logs[0]);
    }
  });
});

function chunk(rows: string[], stamps: Stamp[]): TerrainItem {
  const cells = Array<string>(256).fill(".");
  rows.forEach((line, r) => [...line].forEach((ch, c) => (cells[r * 16 + c] = ch)));
  return { id: terrainId(SCENE, 0, 0), sceneId: SCENE, kind: "terrain", z: 0, owner: "@gm", cx: 0, cy: 0, cells: cells.join(""), edges: ".".repeat(512), stamps };
}

describe("Dungeon objects on a built map in a season", () => {
  it("plants make their squares outdoors, as Tabletop's tree does", () => {
    const m = new BuildModel();
    m.index = indexTerrain([chunk(["SSSSSSSSSS"], [["d:hedge", 3, 0, 0, 1]])]);
    const e = computeExposure(m);
    expect([0, 3, 6, 9].map((c) => e.dist(c, 0))).toEqual([3, 0, 3, 6]);
    // A table doesn't.
    m.index = indexTerrain([chunk(["SSSSSSSSSS"], [["d:table", 3, 0, 0, 1]])]);
    expect(computeExposure(m).dist(3, 0)).toBeGreaterThan(6);
  });

  it("outdoors they take the season, indoors they don't", () => {
    const r = new BuildRenderer();
    // Grass on the left; a walled stone room on the right.
    r.update([chunk(["ggggssss", "ggggssss"], [["d:oak-tree", 0, 0, 0, 1], ["d:wagon", 2, 0, 0, 1], ["d:oak-tree", 5, 0, 0, 1], ["d:wagon", 6, 1, 0, 1]])]);
    r.setSeason({ look: "winter", level: 2 }, 4);
    // Drawing works out what's outdoors (a season arrives as a scene change, which update() never sees).
    (r as unknown as { updateExposure(): void }).updateExposure();
    expect(r.stampLook("d:oak-tree", 0, 0, 1)).toMatchObject({ look: "winter", cover: 2 });
    expect(r.stampLook("d:wagon", 2, 0, 1)).toMatchObject({ look: "winter", cover: 2 });
    expect(r.stampLook("d:oak-tree", 5, 0, 1)).toBeNull();
    expect(r.stampLook("d:wagon", 6, 1, 1)).toBeNull();
    // Autumn: the tree turns, the wagon doesn't.
    r.setSeason({ look: "autumn", level: 2 }, 4);
    expect(r.stampLook("d:oak-tree", 0, 0, 1)).toMatchObject({ look: "autumn" });
    expect(r.stampLook("d:wagon", 2, 0, 1)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { BuildModel, indexTerrain } from "../src/client/room/build";
import { WallIndex, blockers, crackJoins, doorNear, doorSpots, insidePolygon, isSightToken, segmentsOf, sightPolygon, toggledDoor } from "../src/client/room/vision";
import type { Seg } from "../src/client/room/vision";
import { PARTY_LIGHT, visionFromSight } from "../src/client/importScenes";
import { parseUniversalVtt } from "../src/client/mapImport";
import { SIGHT_RANGE, VISION_LIMITS, sanitizeScene, sanitizeVision } from "../src/shared/sanitize";
import { terrainId } from "../src/shared/terrain";
import type { Scene, SceneVision, TerrainItem, TokenItem } from "../src/shared/types";

// Lighting and line of sight (Par: "build lighting and line of sight"): walls and shut doors block
// the party's sight, and in the dark only lights (and the party's own light) show. The geometry,
// the scene's data, and walls from a map file (from Dungeon) and from the Build tool.

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };

const AREA = { x0: 0, y0: 0, x1: 1000, y1: 1000 };

describe("what can be seen from a point", () => {
  it("sees the whole of an empty room, and nothing past its reach", () => {
    const index = new WallIndex([], AREA, 100);
    const all = sightPolygon(index, 500, 500, 5000);
    for (const [x, y] of [[10, 10], [990, 10], [500, 990], [20, 600]]) expect(insidePolygon(all, x, y), `${x},${y}`).toBe(true);
    const near = sightPolygon(index, 500, 500, 100);
    expect(insidePolygon(near, 560, 500)).toBe(true);
    expect(insidePolygon(near, 650, 500)).toBe(false);
  });

  it("doesn't see past a wall, but round its end", () => {
    // A wall across the middle, from x 200 to 800.
    const index = new WallIndex([[200, 500, 800, 500]], AREA, 100);
    const seen = sightPolygon(index, 500, 300, 5000);
    expect(insidePolygon(seen, 500, 450)).toBe(true);
    expect(insidePolygon(seen, 500, 700)).toBe(false);
    expect(insidePolygon(seen, 400, 900)).toBe(false);
    // Past the wall's end, out to the side (the line there passes beyond x 800).
    expect(insidePolygon(seen, 990, 520)).toBe(true);
  });

  it("is blocked by a shut door and not by an open one", () => {
    const walls = segmentsOf([[0, 500, 450, 500], [550, 500, 1000, 500]]);
    const v: SceneVision = { on: true, daylight: true, partyLight: 0, sightRange: 0, walls: [], doors: [{ line: [450, 500, 550, 500], open: false }], lights: [] };
    const shut = doorSpots(v, []);
    const behind = (doors: typeof shut) => insidePolygon(sightPolygon(new WallIndex(blockers(walls, doors), AREA, 100), 500, 300, 5000), 500, 800);
    expect(behind(shut)).toBe(false);
    const opened = toggledDoor(v, shut[0]);
    expect(opened.doors[0].open).toBe(true);
    expect(behind(doorSpots(opened, []))).toBe(true);
    // And back again.
    expect(toggledDoor(opened, doorSpots(opened, [])[0]).doors[0].open).toBe(false);
  });

  it("opens and shuts the Build tool's doors by their edge, and finds the door nearest a click", () => {
    const v: SceneVision = { on: true, daylight: true, partyLight: 0, sightRange: 0, walls: [], doors: [], lights: [] };
    const built = [{ key: 77, line: [100, 100, 200, 100] as Seg }];
    const doors = doorSpots(v, built);
    expect(doors[0]).toMatchObject({ kind: "built", key: 77, open: false });
    const opened = toggledDoor(v, doors[0]);
    expect(opened.openEdges).toEqual([77]);
    expect(doorSpots(opened, built)[0].open).toBe(true);
    expect(toggledDoor(opened, doorSpots(opened, built)[0]).openEdges).toEqual([]);
    expect(doorNear(doors, 152, 104, 20)?.key).toBe(77);
    expect(doorNear(doors, 152, 160, 20)).toBeNull();
  });

  it("doesn't leak through the crack where one wall stops just short of another, and doors stay open", () => {
    // A room's wall stops at the top of its open door (x 1500, y 2900); the passage's traced edge starts
    // with a rounded corner a hair away, as Dungeon's do. A ray skimming the corner slipped through
    // and ran on over the rock (Par: "should it be doing this?").
    const lines = [
      [1500, 2700, 1500, 2900],
      [1508, 2903, 1512, 2900, 1560, 2886, 1740, 2874],
    ];
    const area = { x0: 0, y0: 0, x1: 4000, y1: 4000 };
    const sees = (segs: Seg[], x: number, y: number) => insidePolygon(sightPolygon(new WallIndex(segs, area, 200), 1350, 3050, 6000), x, y);
    // Far up and to the right, past the corner, over the rock.
    expect(sees(segmentsOf(lines), 1925, 2494)).toBe(true);
    const joins = crackJoins(lines, 20);
    // Each end finds the other (one join from each, harmless).
    expect(joins.some((j) => j[0] === 1500 && j[1] === 2900)).toBe(true);
    expect(sees([...segmentsOf(lines), ...joins], 1925, 2494)).toBe(false);
    // The door itself (1500, 2900 to 3000) is still open: straight through it, far down the passage.
    expect(sees([...segmentsOf(lines), ...joins], 3000, 2950)).toBe(true);
    // Walls that meet, or are a door's width apart, aren't joined.
    expect(crackJoins([[0, 0, 100, 0], [100, 0, 100, 100]], 20)).toEqual([]);
    expect(crackJoins([[0, 0, 0, 100], [0, 200, 0, 300]], 20)).toEqual([]);
  });

  it("sees with the party: characters from the sheets, and tokens players put down", () => {
    const t = (over: Partial<TokenItem>): TokenItem => ({ id: "t1", sceneId: "s1", kind: "token", z: 0, owner: "@gm", x: 0, y: 0, size: 1, rotation: 0, assetId: null, color: "#fff", label: "", hidden: false, locked: false, rings: [], ...over });
    expect(isSightToken(t({ character: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd" }))).toBe(true);
    expect(isSightToken(t({ owner: "alice123456789" }))).toBe(true);
    // The GM's monsters, props, compasses and hidden tokens don't see for the party.
    expect(isSightToken(t({}))).toBe(false);
    expect(isSightToken(t({ owner: "alice123456789", layer: "prop" }))).toBe(false);
    expect(isSightToken(t({ owner: "alice123456789", hidden: true }))).toBe(false);
    expect(isSightToken(t({ owner: "alice123456789", art: "compass" }))).toBe(false);
  });
});

describe("a scene's lighting", () => {
  const vision: SceneVision = {
    on: true,
    daylight: false,
    partyLight: 4,
    sightRange: 10,
    walls: [[0, 0, 10.04, 0, 10, 10]],
    doors: [{ line: [1, 2, 3, 4], open: true }],
    lights: [{ x: 5, y: 5, r: 40 }],
  };

  it("is kept as sent, to a tenth of a unit, and refused when it's malformed", () => {
    expect(sanitizeVision(vision)).toEqual({ ...vision, walls: [[0, 0, 10, 0, 10, 10]] });
    expect(sanitizeVision(null)).toBeNull();
    for (const bad of [{ ...vision, walls: [[1, 2, 3]] }, { ...vision, walls: [[0, 0, NaN, 1]] }, { ...vision, lights: [{ x: 1, y: 1, r: 0 }] }, { ...vision, doors: [{ line: [1, 2] }] }, "x"]) {
      expect(sanitizeVision(bad)).toBeUndefined();
    }
    expect(sanitizeVision({ ...vision, walls: Array.from({ length: VISION_LIMITS.wallLines + 1 }, () => [0, 0, 1, 1]) })).toBeUndefined();
    expect(sanitizeVision({ ...vision, partyLight: 9999 })!.partyLight).toBe(VISION_LIMITS.partyLight);
    // How far the party sees: 12 squares unless the GM says, at most 200, 0 for as far as the walls allow.
    expect(sanitizeVision({ ...vision, sightRange: undefined })!.sightRange).toBe(SIGHT_RANGE);
    expect(SIGHT_RANGE).toBe(12);
    expect(sanitizeVision({ ...vision, sightRange: 0 })!.sightRange).toBe(0);
    expect(sanitizeVision({ ...vision, sightRange: 9999 })!.sightRange).toBe(VISION_LIMITS.sightRange);
  });

  it("stays when a change to the scene leaves it out, and goes when it's null", () => {
    const scene = sanitizeScene({ id: "Scene1234567", name: "Keep", width: 1000, height: 800, vision })!;
    expect(scene.vision?.on).toBe(true);
    expect(sanitizeScene({ id: "Scene1234567", name: "Keep 2" }, scene)!.vision).toEqual(scene.vision);
    expect(sanitizeScene({ id: "Scene1234567", vision: null }, scene)!.vision).toBeUndefined();
  });
});

describe("walls, doors and lights from a map file", () => {
  it("come in with a map from Dungeon, in squares from the picture's corner, dark when its light is", async () => {
    const text = await readFile(new URL("./fixtures/dungeon-old-keep.dd2vtt", import.meta.url), "utf8");
    const map = parseUniversalVtt(text, "Old Keep.dd2vtt");
    expect(map.sight).toBeDefined();
    const sight = map.sight!;
    expect([sight.walls.length, sight.doors.length, sight.lights.length]).toEqual([13, 8, 7]);
    expect(sight.doors[0]).toEqual({ line: [4, 7, 4, 9], open: false });
    expect(sight.lights[0]).toEqual({ x: 8, y: 10.6, r: 8 });
    // Its ambient light is a dark blue: the scene starts dark.
    expect(sight.daylight).toBe(false);
  });

  it("are scaled to the scene, off to begin with, and keep the GM's choices when brought in again", () => {
    const sight = { walls: [[0, 0, 2, 0]], doors: [{ line: [1, 1, 1, 2] as [number, number, number, number], open: false }], lights: [{ x: 3, y: 3, r: 5 }], daylight: true };
    const fresh = visionFromSight(sight, 50);
    expect(fresh).toEqual({ on: false, daylight: true, partyLight: PARTY_LIGHT, sightRange: SIGHT_RANGE, walls: [[0, 0, 100, 0]], doors: [{ line: [50, 50, 50, 100], open: false }], lights: [{ x: 150, y: 150, r: 250 }] });
    // The GM turned it on, made it dark and opened the door; the map is brought in again (Update from Dungeon).
    const mine: SceneVision = { ...fresh, on: true, daylight: false, partyLight: 2, doors: [{ line: [50, 50, 50, 100], open: true }], openEdges: [12] };
    const again = visionFromSight({ ...sight, lights: [] }, 50, mine);
    expect(again).toMatchObject({ on: true, daylight: false, partyLight: 2, lights: [], openEdges: [12] });
    expect(again.doors[0].open).toBe(true);
  });

  it("aren't there for a picture alone", () => {
    const scene: Scene = sanitizeScene({ id: "Scene1234567", name: "Plain", width: 1000, height: 800 })!;
    expect(scene.vision).toBeUndefined();
  });
});

describe("the Build tool's walls and doors", () => {
  it("block sight where its rooms meet empty space, and its doors are doors", () => {
    const cells = [...".".repeat(256)];
    for (const [c, r] of [[1, 1], [2, 1], [1, 2], [2, 2]]) cells[r * 16 + c] = "s";
    const edges = [...".".repeat(512)];
    // A door in the top edge of (1, 1).
    edges[(1 * 16 + 1) * 2] = "d";
    const chunk: TerrainItem = { id: terrainId("Scene1234567", 0, 0), sceneId: "Scene1234567", kind: "terrain", z: 0, owner: "@gm", cx: 0, cy: 0, cells: cells.join(""), edges: edges.join(""), stamps: [] };
    const m = new BuildModel();
    m.index = indexTerrain([chunk]);
    const { walls, doors } = m.sightLines();
    // A 2 by 2 room: 8 edges round it, one of them the door.
    expect(walls).toHaveLength(7);
    expect(doors).toHaveLength(1);
    expect(doors[0].line).toEqual([1, 1, 2, 1]);
    // The right-hand and bottom walls, on the edges of cells outside the room, are there too.
    expect(walls).toContainEqual([3, 1, 3, 2]);
    expect(walls).toContainEqual([1, 3, 2, 3]);
  });
});

describe("in the guide", () => {
  it("leads What's new, has a section of its own, and names the controls as Edit scene does", async () => {
    const { GUIDE } = await import("../src/client/guide");
    expect(GUIDE[0].parts[0].title).toBe("Lighting and line of sight (29 October 2026)");
    const section = GUIDE.find((s) => s.id === "lighting")!;
    expect(section.parts.map((p) => p.title)).toEqual(["Turn it on (GM)", "Doors (GM)", "Who the party sees with", "Walls, doors and lights"]);
    const ui = await readFile(new URL("../src/client/ui/LightingSettings.tsx", import.meta.url), "utf8");
    for (const label of ["Lighting and line of sight", "On for this scene", "Daylight", "Dark", "The party's own light", "How far the party sees", "Load walls, doors and lights from a map file"]) {
      expect(ui, label).toContain(label);
      expect(JSON.stringify(section) + JSON.stringify(GUIDE[0].parts[0]), label).toContain(label);
    }
  });
});

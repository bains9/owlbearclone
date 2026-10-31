import { describe, expect, it } from "vitest";
import { BuildModel, indexTerrain } from "../src/client/room/build";
import { WallIndex, blockers, crackJoins, doorNear, doorSpots, insidePolygon, isSightToken, segmentsOf, sightPolygon, toggledDoor } from "../src/client/room/vision";
import type { Seg } from "../src/client/room/vision";
import { PARTY_LIGHT, visionFromSight } from "../src/client/importScenes";
import { parseUniversalVtt } from "../src/client/mapImport";
import { SIGHT_RANGE, VISION_LIMITS, sanitizeScene, sanitizeVision } from "../src/shared/sanitize";
import { terrainId } from "../src/shared/terrain";
import type { Scene, SceneVision, TerrainItem, TokenItem } from "../src/shared/types";
import { defaultVisionDistances, distanceIn, distanceSquares, squaresDistance, visionSquares } from "../src/shared/units";
import { NIGHTVISION_M, PARTIAL_NIGHTVISION_M, nightvisionOf } from "../src/shared/characters";

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

// Par: "do we want to adjust the site distance based on scale rather then squares?" (yes): sight
// and the party's light are distances, the same however big a square is. The group's handbook
// measures in metres.
describe("how far the party sees and its light reaches, as distances", () => {
  const metres = { unit: 1.5, unitName: "m" }, feet = { unit: 5, unitName: "ft" }, overland = { unit: 10, unitName: "m" };

  it("are squares of the scene's grid, converted between feet and metres, any other unit taken as the grid's", () => {
    expect(distanceSquares({ d: 18, unit: "m" }, metres)).toBe(12);
    expect(distanceSquares({ d: 60, unit: "ft" }, feet)).toBe(12);
    // A room switched between feet and metres: 18 m is 60 ft, still 12 squares.
    expect(distanceSquares({ d: 18, unit: "m" }, feet)).toBeCloseTo(12);
    expect(distanceSquares({ d: 60, unit: "ft" }, metres)).toBeCloseTo(12);
    // A map whose squares are 10 m: 18 m is under two of them.
    expect(distanceSquares({ d: 18, unit: "m" }, overland)).toBeCloseTo(1.8);
    expect(distanceSquares({ d: 3, unit: "km" }, { unit: 1, unitName: "mi" })).toBe(3);
    expect(distanceSquares({ d: 3, unit: "m" }, { unit: 0, unitName: "m" })).toBe(0);
    expect(distanceIn({ d: 60, unit: "feet" }, "metres")).toBeCloseTo(18);
  });

  it("come from the distances when a scene has them, else the squares from before, at most the limits", () => {
    const old = { partyLight: 4, sightRange: 12 };
    expect(visionSquares(old, overland)).toEqual({ sight: 12, light: 4 });
    expect(visionSquares({ ...old, sight: { d: 18, unit: "m" }, light: { d: 6, unit: "m" } }, overland)).toEqual({ sight: 1.8, light: 0.6 });
    expect(visionSquares({ ...old, sight: { d: 0, unit: "m" } }, metres).sight).toBe(0);
    expect(visionSquares({ ...old, sight: { d: 9000, unit: "m" }, light: { d: 9000, unit: "m" } }, metres)).toEqual({ sight: VISION_LIMITS.sightRange, light: VISION_LIMITS.partyLight });
  });

  it("begin at 18 m and 6 m (60 ft and 20 ft), or 12 and 4 squares in another unit", () => {
    expect(defaultVisionDistances(metres)).toEqual({ sight: { d: 18, unit: "m" }, light: { d: 6, unit: "m" } });
    expect(defaultVisionDistances(feet)).toEqual({ sight: { d: 60, unit: "ft" }, light: { d: 20, unit: "ft" } });
    expect(defaultVisionDistances({ unit: 2, unitName: "km" })).toEqual({ sight: { d: 24, unit: "km" }, light: { d: 8, unit: "km" } });
    expect(squaresDistance(12, metres)).toEqual({ d: 18, unit: "m" });
  });

  it("are kept as sent, and dropped when they aren't distances", () => {
    const base = { on: true, daylight: false, partyLight: 4, sightRange: 12, walls: [], doors: [], lights: [] };
    expect(sanitizeVision({ ...base, sight: { d: 18.004, unit: "m" }, light: { d: 6, unit: " m " } })).toMatchObject({ sight: { d: 18, unit: "m" }, light: { d: 6, unit: "m" } });
    for (const bad of [{ d: -1, unit: "m" }, { d: 18, unit: "" }, { d: NaN, unit: "m" }, { d: "18", unit: "m" }, { d: 2e6, unit: "m" }, "18 m"]) {
      expect(sanitizeVision({ ...base, sight: bad }), JSON.stringify(bad)).not.toHaveProperty("sight");
    }
  });

  it("start as distances on a scene brought in, and stay the GM's (and per-player sight stays) when it's brought in again", () => {
    const sight = { walls: [], doors: [], lights: [], daylight: true };
    expect(visionFromSight(sight, 50, undefined, metres)).toMatchObject({ sight: { d: 18, unit: "m" }, light: { d: 6, unit: "m" } });
    const mine: SceneVision = { ...visionFromSight(sight, 50, undefined, metres), on: true, perPlayer: true, sight: { d: 30, unit: "m" } };
    expect(visionFromSight(sight, 50, mine, metres)).toMatchObject({ on: true, perPlayer: true, sight: { d: 30, unit: "m" }, light: { d: 6, unit: "m" } });
    // A scene from before distances keeps its squares.
    const before: SceneVision = { ...visionFromSight(sight, 50), on: true };
    expect(visionFromSight(sight, 50, before, metres)).not.toHaveProperty("sight");
  });

  it("keep Night, and the GM's other choices, when the map is brought in again", () => {
    const sight = { walls: [], doors: [], lights: [], daylight: false };
    const mine: SceneVision = { ...visionFromSight(sight, 50, undefined, metres), on: true, night: true };
    expect(visionFromSight(sight, 50, mine, metres)).toMatchObject({ daylight: false, night: true });
    expect(visionFromSight(sight, 50, undefined, metres)).not.toHaveProperty("night");
  });

  it("are set in Edit scene in the scene's unit, with the squares beside them", async () => {
    const ui = await readFile(new URL("../src/client/ui/LightingSettings.tsx", import.meta.url), "utf8");
    expect(ui).toContain("The party's own light, in {unitName} ({squaresText(squares.light)})");
    expect(ui).toContain('How far the party sees, in {unitName} ({squares.sight > 0 ? squaresText(squares.sight) : "0: as far as the walls allow"})');
    expect(ui).toContain("set({ [which]: { d: tenth(Math.min(n, most)), unit: unitName } });");
    const board = await readFile(new URL("../src/client/room/board.ts", import.meta.url), "utf8");
    expect(board).toContain("const squares = visionSquares(v, scene.grid);");
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

// Par: "yes, build night lighting with nightvision". The group's handbook: nightvision is black and
// white by moon or starlight, to 100 m for the elves and 50 m for half-elves, and nothing underground.
describe("night by moon or starlight, and nightvision", () => {
  it("comes from a character's race, as the handbook has it", () => {
    const of = (race: string, culture = "") => nightvisionOf({ race, culture });
    expect([of("Nyloran"), of("Sylvan"), of("Duga"), of("Elf", "Nyloran")]).toEqual([100, 100, 100, 100]);
    // A half-elf's is partial, whichever elves their family came from.
    expect([of("Half-elf"), of("Half Elf"), of("half-elf", "Sylvan")]).toEqual([50, 50, 50]);
    expect([of("Human", "Wyddin"), of("Human", "Danae"), of("Dwerv"), of("Gnome"), of("")]).toEqual([0, 0, 0, 0, 0]);
    expect(nightvisionOf(null)).toBe(0);
    expect([NIGHTVISION_M, PARTIAL_NIGHTVISION_M]).toEqual([100, 50]);
  });

  it("is a scene's lighting the server keeps, off unless turned on", () => {
    const base = { on: true, daylight: false, partyLight: 4, sightRange: 12, walls: [], doors: [], lights: [] };
    expect(sanitizeVision({ ...base, night: true })?.night).toBe(true);
    expect(sanitizeVision({ ...base, night: "yes" })).not.toHaveProperty("night");
    expect(sanitizeVision(base)).not.toHaveProperty("night");
  });

  it("shows what only nightvision sees dimmed and in black and white, to players only, and as far as the party sees at most", async () => {
    const board = await readFile(new URL("../src/client/room/board.ts", import.meta.url), "utf8");
    // Grey drawn as "saturation" takes the colour from the map and tokens under it.
    expect(board).toContain('this.monoLayer.getNativeCanvasElement().style.mixBlendMode = "saturation";');
    expect(board).toContain("this.stage.add(this.bgLayer, this.drawLayer, this.groundFxLayer, this.tokenLayer, this.airFxLayer, this.monoLayer, this.sightLayer, this.fogLayer, this.uiLayer);");
    expect(board).toContain("this.monoLayer.visible(!gm || preview);");
    // Dim in the dark, whole on the explore grid (it's seen: explored, and its tokens show), and none where a light is.
    expect(board).toContain("paint(c, true, NIGHT_SHOWN);");
    expect(board).toContain("paint(sc);");
    expect(board).toContain("paint(mc, false, 1, MONO_OUT);");
    expect(board).toContain("paint(mc, true, 0);");
    expect(board).toContain("(range ? Math.min(range, n * scene.grid.size) : n * scene.grid.size)");
    expect(board).toContain('const metres = isNight ? nightvisionOf(this.room.characterOf(t)) : 0;');
    const ui = await readFile(new URL("../src/client/ui/LightingSettings.tsx", import.meta.url), "utf8");
    expect(ui).toContain("set({ daylight: false, night: true })");
    expect(ui).toContain("set({ daylight: false, night: false })");
  });
});

describe("in the guide", () => {
  it("is in What's new under erasing what you built, has a section of its own, and names the controls as Edit scene does", async () => {
    const { GUIDE } = await import("../src/client/guide");
    expect(GUIDE[0].parts[6].title).toBe("Lighting and line of sight (29 October 2026)");
    const section = GUIDE.find((s) => s.id === "lighting")!;
    expect(section.parts.map((p) => p.title)).toEqual([
      "Turn it on (GM)",
      "Doors (GM)",
      "Who the party sees with",
      "What the party has explored",
      "Each player's own sight",
      "Walls, doors and lights",
    ]);
    const ui = await readFile(new URL("../src/client/ui/LightingSettings.tsx", import.meta.url), "utf8");
    for (const label of [
      "Lighting and line of sight",
      "On for this scene",
      "Daylight",
      "Dark",
      "The party's own light",
      "How far the party sees",
      "Load walls, doors and lights from a map file",
      "Forget what the party has explored",
      "Each player sees only through their own character",
      "Night: moon or starlight",
    ]) {
      expect(ui, label).toContain(label);
      expect(JSON.stringify(section) + JSON.stringify(GUIDE[0].parts[6]), label).toContain(label);
    }
    // The fog tool's Look as, as the guide names it.
    const bar = await readFile(new URL("../src/client/ui/Toolbar.tsx", import.meta.url), "utf8");
    expect(bar).toContain("<span>Look as</span>");
    expect(JSON.stringify(section)).toContain("**Look as**");
  });
});

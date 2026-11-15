// The map in 3D (room/view3dModel.ts, map3d.ts): walls raised only where a page has seen, standing
// figures, the camera's framing, and the per-device switch (off to begin with) and the display link.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { RoomClient } from "../src/client/room/client";
import { display3dLink, displayWants3d, loadMap3d, loadView3d, saveMap3d, saveView3d } from "../src/client/map3d";
import {
  CARD_TALLEST,
  CARD_WIDTH,
  DOOR_HEIGHT,
  START_TILT,
  WALL_HEIGHT,
  WALL_PIECE_VERTICES,
  WALL_SEEN,
  brightnessAt,
  cameraAt,
  cardSize,
  clampTo,
  coverScale,
  flatSize,
  floorScale,
  frameDistance,
  initialsOf,
  shadeOf,
  standeeLook,
  standeeShown,
  paintAt,
  wallMesh,
  wallPieces,
  wallTint,
  wallsOf,
  type CoverMap,
  type PaintMap,
  type Standee,
  type Walls3d,
} from "../src/client/room/view3dModel";
import type { SceneVision } from "../src/shared/types";

const CELL = 100;

/** A cover map over 10 by 10 squares, a cell a square, covered (255) where `covered` says. */
function coverOf(covered: (col: number, row: number) => number): CoverMap {
  const w = 10, h = 10;
  const alpha = new Uint8ClampedArray(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) alpha[r * w + c] = covered(c, r);
  return { x0: 0, y0: 0, k: 1 / CELL, w, h, alpha };
}

const vision = (v: Partial<SceneVision>): SceneVision => ({
  on: true,
  daylight: true,
  partyLight: 0,
  sightRange: 0,
  walls: [],
  doors: [],
  lights: [],
  ...v,
});

const noBuilt = { walls: [], doors: [] };

describe("what a page has seen", () => {
  it("is all of it with nothing covering it", () => {
    expect(brightnessAt(null, 123, 456)).toBe(1);
  });

  it("reads the cover map, and nothing off the scene", () => {
    const cover = coverOf((c) => (c < 5 ? 0 : 255));
    expect(brightnessAt(cover, 150, 150)).toBe(1);
    expect(brightnessAt(cover, 750, 150)).toBe(0);
    expect(brightnessAt(cover, -10, 150)).toBe(0);
    expect(brightnessAt(cover, 150, 1010)).toBe(0);
  });
});

describe("the scene's walls", () => {
  it("takes the map file's lines apart and its doors as they are", () => {
    const w = wallsOf(
      vision({ walls: [[0, 0, 300, 0, 300, 200]], doors: [{ line: [0, 200, 100, 200], open: true }] }),
      noBuilt,
      { size: CELL, offsetX: 0, offsetY: 0 },
    );
    expect(w.walls).toEqual([
      [0, 0, 300, 0],
      [300, 0, 300, 200],
    ]);
    expect(w.doors).toEqual([{ line: [0, 200, 100, 200], open: true }]);
  });

  it("puts the Build tool's walls and doors in scene units, its open doors open", () => {
    const w = wallsOf(
      vision({ openEdges: [7] }),
      { walls: [[1, 1, 3, 1]], doors: [{ key: 7, line: [3, 1, 4, 1] }, { key: 8, line: [4, 1, 5, 1] }] },
      { size: 50, offsetX: 10, offsetY: 20 },
    );
    expect(w.walls).toEqual([]);
    expect(w.built).toEqual([[60, 70, 160, 70]]);
    expect(w.doors).toEqual([
      { line: [160, 70, 210, 70], open: true },
      { line: [210, 70, 260, 70], open: false },
    ]);
  });

  it("has only built walls on a scene without lighting", () => {
    const w = wallsOf(undefined, { walls: [[0, 0, 1, 0]], doors: [{ key: 1, line: [1, 0, 2, 0] }] }, { size: CELL, offsetX: 0, offsetY: 0 });
    expect(w.walls).toEqual([]);
    expect(w.built).toEqual([[0, 0, 100, 0]]);
    expect(w.doors).toEqual([{ line: [100, 0, 200, 0], open: false }]);
  });
});

describe("walls raised", () => {
  const long: Walls3d = { walls: [[0, 500, 300, 500]], built: [], doors: [] };

  it("cuts walls into half-square pieces that meet end to end", () => {
    const pieces = wallPieces(long, CELL, null, false);
    expect(pieces).toHaveLength(6);
    expect(pieces[0]).toMatchObject({ x0: 0, y0: 500, x1: 50, y1: 500, door: false, light: 1 });
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].x0).toBeCloseTo(pieces[i - 1].x1);
    expect(pieces.at(-1)!.x1).toBeCloseTo(300);
  });

  it("raises nothing a player hasn't seen, so the fog keeps the rooms' shapes to itself", () => {
    const fogged = coverOf(() => 255);
    expect(wallPieces(long, CELL, fogged, false)).toEqual([]);
    // The GM sees them all, as dark as the fog makes them.
    const all = wallPieces(long, CELL, fogged, true);
    expect(all).toHaveLength(6);
    expect(all.every((p) => p.light === 0)).toBe(true);
  });

  it("raises a wall seen from one side only (the room's edge, the dark beyond)", () => {
    // Clear above row 5, covered from row 5 down: the wall runs along y = 500, between them.
    const cover = coverOf((_c, r) => (r < 5 ? 0 : 255));
    const pieces = wallPieces(long, CELL, cover, false);
    expect(pieces).toHaveLength(6);
    expect(pieces.every((p) => p.light === 1)).toBe(true);
  });

  it("raises only the part of a wall in the seen part of the map", () => {
    const cover = coverOf((c) => (c < 2 ? 0 : 255));
    const pieces = wallPieces(long, CELL, cover, false);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.x1 <= 250)).toBe(true);
  });

  it("raises a wall in an explored place dimmer than one in sight", () => {
    // Explored: the dark lets 45% through (boardSight.ts EXPLORED_SHOWN).
    const cover = coverOf(() => Math.round(255 * 0.55));
    const [p] = wallPieces(long, CELL, cover, false);
    expect(p.light).toBeGreaterThan(WALL_SEEN);
    expect(p.light).toBeCloseTo(0.45, 1);
    expect(shadeOf(p.light)).toBeLessThan(shadeOf(1));
    expect(shadeOf(0)).toBeGreaterThan(0);
  });

  it("raises shut doors as doors and leaves open ones out", () => {
    const pieces = wallPieces(
      {
        walls: [],
        built: [],
        doors: [
          { line: [0, 0, 100, 0], open: false },
          { line: [100, 0, 200, 0], open: true },
        ],
      },
      CELL,
      null,
      false,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p) => p.door && p.x1 <= 100)).toBe(true);
  });

  it("skips walls of no length", () => {
    expect(wallPieces({ walls: [[5, 5, 5, 5]], built: [], doors: [] }, CELL, null, true)).toEqual([]);
  });
});

describe("walls in their own material", () => {
  /** A map 10 by 10 squares painted `rgb` everywhere, at 10 pixels a square. */
  const painted = (rgb: [number, number, number]): PaintMap => {
    const w = 100, h = 100;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    return { x0: 0, y0: 0, k: 10 / CELL, w, h, rgba };
  };

  it("takes a wall's colour from what the map paints where it runs", () => {
    const [p] = wallPieces({ walls: [[0, 500, 100, 500]], built: [], doors: [] }, CELL, null, false, painted([153, 76, 51]));
    expect(p.color![0]).toBeCloseTo(0.6, 2);
    expect(p.color![1]).toBeCloseTo(0.298, 2);
    expect(paintAt(painted([1, 2, 3]), -5, 5)).toBeNull();
  });

  it("keeps a wall painted near black from standing up as a black slab", () => {
    const dark = wallTint([0.04, 0.04, 0.05]);
    expect(0.3 * dark[0] + 0.59 * dark[1] + 0.11 * dark[2]).toBeGreaterThan(0.2);
    expect(wallTint([0.6, 0.3, 0.2])).toEqual([0.6, 0.3, 0.2]);
  });

  it("marks the Build tool's walls, which take the scene's wall texture, and paints doors in wood", () => {
    const pieces = wallPieces(
      { walls: [[0, 0, 100, 0]], built: [[0, 200, 100, 200]], doors: [{ line: [0, 400, 100, 400], open: false }] },
      CELL,
      null,
      true,
      painted([200, 200, 200]),
    );
    expect(pieces.map((p) => [!!p.built, p.door, !!p.color])).toEqual([
      [false, false, true],
      [false, false, true],
      [true, false, true],
      [true, false, true],
      [false, true, false],
      [false, true, false],
    ]);
  });

  it("lays a texture along each wall and up it, and across the top, in squares", () => {
    const m = wallMesh([{ x0: 0, y0: 300, x1: 100, y1: 300, door: false, light: 1, built: true }], CELL, true);
    expect(m.uv!.length).toBe(WALL_PIECE_VERTICES * 2);
    for (let v = 0; v < WALL_PIECE_VERTICES; v++) {
      const y = m.position[v * 3 + 1], ny = m.normal[v * 3 + 1];
      // Sides and ends: up the wall is up the texture.
      if (ny < 0.5) expect(m.uv![v * 2 + 1]).toBeCloseTo(y);
    }
    // Along this wall (west to east), the texture runs with x.
    const us = Array.from({ length: WALL_PIECE_VERTICES }, (_, v) => m.uv![v * 2]);
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.9);
    // White under a texture: the texture gives the colour.
    expect([m.color[0], m.color[1], m.color[2]]).toEqual([1, 1, 1]);
  });
});

describe("the walls' mesh", () => {
  it("is five faces a piece, standing on the floor, as tall as a wall (a door less)", () => {
    const m = wallMesh(
      [
        { x0: 0, y0: 0, x1: 100, y1: 0, door: false, light: 1 },
        { x0: 100, y0: 0, x1: 200, y1: 0, door: true, light: 1 },
      ],
      CELL,
    );
    expect(m.position.length).toBe(2 * WALL_PIECE_VERTICES * 3);
    const ys = (from: number, to: number) => {
      const out: number[] = [];
      for (let v = from; v < to; v++) out.push(m.position[v * 3 + 1]);
      return out;
    };
    expect(Math.min(...ys(0, 30))).toBe(0);
    expect(Math.max(...ys(0, 30))).toBeCloseTo(WALL_HEIGHT);
    expect(Math.max(...ys(30, 60))).toBeCloseTo(WALL_HEIGHT * DOOR_HEIGHT);
  });

  it("faces each side outwards, in squares", () => {
    const m = wallMesh([{ x0: 0, y0: 0, x1: 0, y1: 100, door: false, light: 1 }], CELL);
    // A wall down the map (along z) at x = 0: its faces' normals point away from its middle.
    for (let f = 0; f < 5; f++) {
      let cx = 0, cy = 0, cz = 0;
      for (let v = f * 6; v < f * 6 + 6; v++) {
        cx += m.position[v * 3] / 6;
        cy += m.position[v * 3 + 1] / 6;
        cz += m.position[v * 3 + 2] / 6;
      }
      const n = [m.normal[f * 18], m.normal[f * 18 + 1], m.normal[f * 18 + 2]];
      const out = [cx - 0, cy - WALL_HEIGHT / 2, cz - 0.5];
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
    }
    expect(Math.max(...Array.from(m.position).filter((_, i) => i % 3 === 2))).toBeCloseTo(1);
  });

  it("winds each face anticlockwise seen from outside, so it's drawn from there", () => {
    const m = wallMesh([{ x0: 0, y0: 0, x1: 100, y1: 0, door: false, light: 1 }], CELL);
    for (let t = 0; t < WALL_PIECE_VERTICES / 3; t++) {
      const p = (i: number) => [m.position[(t * 3 + i) * 3], m.position[(t * 3 + i) * 3 + 1], m.position[(t * 3 + i) * 3 + 2]];
      const [a, b, c] = [p(0), p(1), p(2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = [m.normal[t * 9], m.normal[t * 9 + 1], m.normal[t * 9 + 2]];
      expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it("shades a piece by how lit it is", () => {
    const lit = wallMesh([{ x0: 0, y0: 0, x1: 100, y1: 0, door: false, light: 1 }], CELL);
    const dim = wallMesh([{ x0: 0, y0: 0, x1: 100, y1: 0, door: false, light: 0.3 }], CELL);
    expect(dim.color[0]).toBeLessThan(lit.color[0]);
    expect(dim.color[0]).toBeCloseTo(lit.color[0] * shadeOf(0.3));
  });
});

describe("figures", () => {
  const img = (src: string) => ({ src, naturalWidth: 100, naturalHeight: 100 }) as HTMLImageElement;
  const base: Standee = {
    id: "t1",
    x: 150,
    y: 150,
    size: 1,
    picture: img("/a.png"),
    flip: false,
    color: "#ff0000",
    label: "Orc",
    opacity: 1,
    flat: false,
    rotation: 0,
    lifted: false,
  };

  it("stand on a card as wide as the token and as tall as the picture, a tall one at most so tall", () => {
    expect(cardSize(1, 100, 100)).toEqual({ w: CARD_WIDTH, h: CARD_WIDTH });
    expect(cardSize(2, 100, 200).h).toBeCloseTo(2 * CARD_WIDTH * 2);
    expect(cardSize(1, 10, 1000).h).toBeCloseTo(CARD_WIDTH * CARD_TALLEST);
    expect(cardSize(1, 0, 0)).toEqual({ w: CARD_WIDTH, h: CARD_WIDTH });
  });

  it("lie flat fitted into their size, as on the map", () => {
    expect(flatSize(2, 200, 100)).toEqual({ w: 2, h: 1 });
    expect(flatSize(1, 0, 50)).toEqual({ w: 1, h: 1 });
  });

  it("are made again when they look different, not when they move", () => {
    const look = standeeLook(base);
    expect(standeeLook({ ...base, x: 900, y: 40 })).toBe(look);
    expect(standeeLook({ ...base, picture: img("/b.png") })).not.toBe(look);
    expect(standeeLook({ ...base, opacity: 0.5 })).not.toBe(look);
    expect(standeeLook({ ...base, flip: true })).not.toBe(look);
    expect(standeeLook({ ...base, lifted: true })).not.toBe(look);
    // A standing figure faces the camera whichever way the token's turned; a flat one turns.
    expect(standeeLook({ ...base, rotation: 90 })).toBe(look);
    expect(standeeLook({ ...base, flat: true, rotation: 90 })).not.toBe(standeeLook({ ...base, flat: true }));
  });

  it("don't stand up out of the fog for a player, as the fog paints over them in 2D; the GM sees them all", () => {
    const cover = coverOf((c) => (c < 5 ? 0 : 255));
    expect(standeeShown(brightnessAt(cover, 150, 150), false)).toBe(true);
    expect(standeeShown(brightnessAt(cover, 750, 150), false)).toBe(false);
    expect(standeeShown(brightnessAt(cover, 750, 150), true)).toBe(true);
    expect(standeeShown(brightnessAt(null, 750, 150), false)).toBe(true);
  });

  it("without a picture show their initials, as the map does", () => {
    expect(initialsOf("Goblin Boss")).toBe("GB");
    expect(initialsOf("orc")).toBe("OR");
    expect(initialsOf("  ")).toBe("");
  });
});

describe("the floor and the camera", () => {
  it("draws the floor at most so big, and never more than twice the map's own pixels", () => {
    expect(floorScale(8000, 4000, 4096)).toBeCloseTo(4096 / 8000);
    expect(floorScale(500, 300, 4096)).toBe(2);
    expect(floorScale(0, 0, 4096)).toBe(1);
  });

  it("keeps the cover map small: about four cells a square", () => {
    expect(coverScale(1000, 1000, 100)).toBeCloseTo(0.04);
    expect(coverScale(100_000, 1000, 100) * 100_000).toBeCloseTo(512);
  });

  it("stands further back for more of the map, and for a narrower screen", () => {
    expect(frameDistance(20, 10, 1.6)).toBeGreaterThan(frameDistance(10, 5, 1.6));
    expect(frameDistance(10, 10, 0.5)).toBeGreaterThan(frameDistance(10, 10, 1.6));
    expect(frameDistance(0.1, 0.1, 1)).toBe(2);
  });

  it("starts south of what it looks at, tilted, so the map's north is away", () => {
    const [x, y, z] = cameraAt(5, 5, 10);
    expect(x).toBeCloseTo(5);
    expect(z).toBeGreaterThan(5);
    expect(y).toBeCloseTo(10 * Math.cos(START_TILT));
    expect(Math.hypot(x - 5, y, z - 5)).toBeCloseTo(10);
    // Turned a quarter round: from the east.
    const [ex, , ez] = cameraAt(5, 5, 10, START_TILT, Math.PI / 2);
    expect(ex).toBeGreaterThan(5);
    expect(ez).toBeCloseTo(5);
  });

  it("keeps a point inside a range (its middle when the range is empty)", () => {
    expect(clampTo(5, 0, 3)).toBe(3);
    expect(clampTo(-1, 0, 3)).toBe(0);
    expect(clampTo(9, 4, 2)).toBe(3);
  });
});

describe("the 3D view on a device", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(): Map<string, string> {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    });
    return m;
  }

  it("is off to begin with, and remembered once turned on", () => {
    stubStorage();
    expect(loadMap3d()).toBe(false);
    expect(loadView3d()).toBe(false);
    saveMap3d(true);
    saveView3d(true);
    expect(loadMap3d()).toBe(true);
    expect(loadView3d()).toBe(true);
    saveMap3d(false);
    expect(loadMap3d()).toBe(false);
  });

  it("is off where the browser keeps nothing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadMap3d()).toBe(false);
    expect(() => saveMap3d(true)).not.toThrow();
  });

  it("shows the map in 3D only where it's offered, and goes back to 2D when it stops being offered", () => {
    stubStorage();
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    expect(room.state.map3d).toBe(false);
    room.setView3d(true);
    expect(room.state.view3d).toBe(false);
    room.setMap3d(true);
    room.setView3d(true);
    expect(room.state.view3d).toBe(true);
    expect(loadView3d()).toBe(true);
    room.setMap3d(false);
    expect(room.state.view3d).toBe(false);
    expect(loadView3d()).toBe(false);
  });

  it("opens in 3D again on a device that was last showing it", () => {
    const m = stubStorage();
    m.set("tabletop-map-3d", "1");
    m.set("tabletop-map-3d-view", "1");
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    expect(room.state.map3d).toBe(true);
    expect(room.state.view3d).toBe(true);
  });

  it("is asked for on a table display by its link", () => {
    expect(displayWants3d("?display=abc&view=3d")).toBe(true);
    expect(displayWants3d("?display=abc")).toBe(false);
    const plain = "https://table.example/r/AbCdEf123456?display=k%2Fey";
    const in3d = display3dLink(plain, true);
    expect(displayWants3d(new URL(in3d).search)).toBe(true);
    expect(new URL(in3d).searchParams.get("display")).toBe("k/ey");
    expect(display3dLink(in3d, false)).toBe(new URL(plain).toString());
  });
});

/** A source file's text (node:fs, which the test types leave out on purpose, as the other tests reach it). */
async function source(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("the guide", () => {
  const section = GUIDE.find((g) => g.id === "map-3d")!;
  const text = JSON.stringify(section);

  it("has a section on the map in 3D, for everyone", () => {
    expect(section.audience).toBe("everyone");
    expect(section.parts.map((p) => p.title)).toEqual(["Turn it on", "Look around", "What it shows", "GM: the table display in 3D"]);
  });

  it("names the switches and buttons as the app shows them", async () => {
    const page = await source("src/client/ui/RoomPage.tsx");
    const display = await source("src/client/ui/TableDisplay.tsx");
    const zoom = await source("src/client/ui/Toolbar.tsx");
    expect(text).toContain("**Offer a 3D view of the map (new)**");
    expect(page).toContain("Offer a 3D view of the map (new)");
    expect(text).toContain("**Show the map in 3D on the display (new)**");
    expect(display).toContain("Show the map in 3D on the display (new)");
    expect(text).toContain("**Flat map (2D)**");
    expect(display).toContain('"Flat map (2D)"');
    expect(text).toContain("**Fit the scene**");
    expect(zoom).toContain('aria-label="Fit the scene" onClick={fit}');
  });

  it("says what stands up on a built map, and that the weather falls", () => {
    expect(text).toContain("trees with trunks and leafy tops");
    expect(text).toContain("Rugs, stains and other things lying on the floor stay painted");
    expect(text).toContain("The day's weather falls on the map");
    expect(text).toContain("**Weather on this map**");
  });

  it("says walls take their own colours and buildings get roofs that lift when the party's in", () => {
    expect(text).toContain("Walls stand in their own colours");
    expect(text).toContain("**Plain walls**");
    expect(text).toContain("its roof lifts off so everyone sees in");
    expect(text).toContain("no roofs");
  });

  it("says a map brought in from Dungeon or with its project file stands its trees up, and names the setting as the app does", async () => {
    expect(text).toContain("knows where its trees, bushes, rocks, stumps and fallen logs are");
    expect(text).toContain("**Dungeondraft data** under **Map** in **Edit scene**");
    expect(JSON.stringify(GUIDE)).toContain("click **Attach…** next to **Dungeondraft data**");
    expect(text).not.toContain("built map (made with the Build tool, or brought in from Dungeon)");
  });

  it("says spells show in 3D, where they hang, and that fog hides them as on the flat map", () => {
    expect(text).toContain("Spells show too, moving as on the flat map");
    expect(text).toContain("A spell being cast shows over the fog, as it does on the flat map");
    expect(text).not.toContain("spell effects playing and compass roses show on the flat map only");
    expect(text).toContain("So are rooms a map's walls close off");
    expect(JSON.stringify(GUIDE)).toContain("Lighting and line of sight");
  });

  it("says a Dungeondraft map's cliffs stand up, and that a project file attached before needs attaching again", () => {
    expect(text).toContain("A Dungeondraft map's cliffs (its cliff paths, Dungeondraft's own or an asset pack's) stand up as rock");
    expect(text).toContain("attach it again (**Dungeondraft data** › **Change…**)");
  });

  it("says players see no more in 3D than on the flat map", () => {
    expect(text).toContain("Players never see more in 3D than on the flat map");
    expect(text).toContain("A token or a built map's object under the fog doesn't stand up for players");
    expect(text).toContain("a building's roof shows to a player only once they've seen the building");
  });
});

// Magic in the 3D view (room/view3dEffects.ts), and rooms found from walls alone
// (room/view3dRoofs.ts enclosedCells): where each spell's sheet lies and how big it's drawn, and
// which squares a map's walls close off.
import { describe, expect, it } from "vitest";
import {
  EFFECT_SHEETS,
  castBounds,
  castVolume,
  effectScale,
  meanColour,
  sameSize,
  sameVolume,
  sheetLayers,
  skinMesh,
  tokenLookBounds,
  zoneBounds,
  zoneVolume,
} from "../src/client/room/view3dEffects";
import { enclosedCells } from "../src/client/room/view3dRoofs";

const CELL = 100;

describe("spell sheets", () => {
  it("lays ground spells on the floor, cast spells and token looks at a figure's middle, and clouds in two sheets above", () => {
    expect(EFFECT_SHEETS.ground.heights).toEqual([0.02]);
    expect(EFFECT_SHEETS.mid.heights).toEqual([0.5]);
    expect(EFFECT_SHEETS.air.heights).toHaveLength(2);
    expect(Math.min(...EFFECT_SHEETS.air.heights)).toBeGreaterThan(0.2);
    expect(EFFECT_SHEETS.air.opacity).toBeLessThan(1);
  });

  it("gives a spell area room round it for its glowing edge, whichever way it was drawn", () => {
    const b = zoneBounds([800, 600, 200, 200], CELL);
    expect(b.x0).toBeLessThan(200);
    expect(b.y0).toBeLessThan(200);
    expect(b.x1).toBeGreaterThan(800);
    expect(b.y1).toBeGreaterThan(600);
    expect(b.x0).toBeGreaterThanOrEqual(200 - 0.12 * 600 - 1);
  });

  it("puts a token's look round the token, out to twice its size", () => {
    expect(tokenLookBounds(500, 500, 50, CELL)).toEqual({ x0: 350, y0: 350, x1: 650, y1: 650 });
  });

  it("covers a spell being cast from where it starts to where it lands, and its reach round both", () => {
    const b = castBounds({ x: 100, y: 100 }, { x: 900, y: 300 }, 400, CELL);
    expect(b).toEqual({ x0: -400, y0: -400, x1: 1400, y1: 800 });
  });

  it("draws a sheet about 32 pixels a square, fewer on a phone, and never past 512 across", () => {
    expect(effectScale({ x0: 0, y0: 0, x1: 500, y1: 500 }, CELL, false)).toBeCloseTo(0.32);
    expect(effectScale({ x0: 0, y0: 0, x1: 500, y1: 500 }, CELL, true)).toBeCloseTo(0.24);
    const big = { x0: 0, y0: 0, x1: 5000, y1: 3000 };
    expect(effectScale(big, CELL, false) * 5000).toBeCloseTo(512);
  });

  it("keeps a moved look's sheet (same size), and makes a new one when it grows", () => {
    expect(sameSize({ x0: 0, y0: 0, x1: 100, y1: 100 }, { x0: 40, y0: 70, x1: 140, y1: 170 })).toBe(true);
    expect(sameSize({ x0: 0, y0: 0, x1: 100, y1: 100 }, { x0: 0, y0: 0, x1: 200, y1: 100 })).toBe(false);
  });
});

describe("how tall each spell stands, from the spell list", () => {
  /** Squares, from metres (a square is 1.5 m). */
  const sq = (metres: number) => metres / 1.5;
  /** A circle `r` squares round (500, 500), or a square `s` squares across from (100, 100). */
  const circle = (r: number) => [500 - r * CELL, 500 - r * CELL, 500 + r * CELL, 500 + r * CELL];
  const square = (s: number) => [100, 100, 100 + s * CELL, 100 + s * CELL];

  it("stands a sphere (Fog Cloud, Darkness) as a dome as tall as its radius, narrowing to its top", () => {
    const v = zoneVolume("fog", "ellipse", circle(sq(8)), CELL, "Fog Cloud");
    expect(v.form).toBe("dome");
    expect(v.top).toBeCloseTo(sq(8));
    const layers = sheetLayers({ level: "air", volume: v });
    expect(layers.length).toBeGreaterThanOrEqual(3);
    expect(layers.length).toBeLessThanOrEqual(8);
    // Narrower going up, and all together hiding as the two sheets did.
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].y).toBeGreaterThan(layers[i - 1].y);
      expect(layers[i].scale).toBeLessThan(layers[i - 1].scale);
    }
    const shows = layers.reduce((p, l) => p * (1 - l.opacity), 1);
    expect(1 - shows).toBeCloseTo(0.84, 2);
    expect(zoneVolume("darkness", "ellipse", circle(sq(5)), CELL, "Darkness").top).toBeCloseTo(sq(5));
  });

  it("raises a cube (Wall of Fog, Stinking Cloud) as tall as its side, straight up", () => {
    const v = zoneVolume("fog", "rect", square(sq(13)), CELL, "Wall of Fog");
    expect(v.form).toBe("block");
    expect(v.top).toBeCloseTo(sq(13));
    expect(new Set(sheetLayers({ level: "air", volume: v }).map((l) => l.scale))).toEqual(new Set([1]));
    expect(zoneVolume("poison-cloud", "rect", square(sq(7)), CELL, "Stinking Cloud").top).toBeCloseTo(sq(7));
  });

  it("stands Moonbeam as a 15 m column of light, and walls 3 m high", () => {
    const beam = zoneVolume("moonbeam", "ellipse", circle(sq(2)), CELL, "Moonbeam");
    expect(beam.form).toBe("block");
    expect(beam.top).toBeCloseTo(sq(15));
    expect(beam.skin).toBeGreaterThan(0);
    expect(beam.glow).toBe(true);
    expect(zoneVolume("water", "rect", square(sq(6)), CELL, "Wall of Water").top).toBeCloseTo(sq(3));
    expect(zoneVolume("force-dome", "rect", [0, 0, 24 * CELL, 0.5 * CELL], CELL, "Forceward").top).toBeCloseTo(sq(3));
  });

  it("rises plants, webs and a ring of fire a metre or two, Briartangle head high", () => {
    expect(zoneVolume("vines", "rect", square(5), CELL, "Entangle").top).toBeCloseTo(sq(1));
    expect(zoneVolume("vines", "ellipse", circle(10), CELL, "Briartangle").top).toBeCloseTo(sq(2));
    expect(zoneVolume("web", "rect", square(4), CELL, "Web").top).toBeCloseTo(sq(2));
    const ring = zoneVolume("fire-ring", "ellipse", circle(2), CELL, "Circle of Flame");
    expect(ring.top).toBeCloseTo(sq(1.5));
    expect(ring.glow).toBe(true);
    // The drawing whole on the ground, as on the flat map; fainter above.
    const layers = sheetLayers({ level: "ground", volume: ring });
    expect(layers[0].opacity).toBe(1);
    expect(layers[1].opacity).toBeLessThan(1);
  });

  it("leaves what lies on the ground flat: grease, spikes, a pit, a spring, a marked zone", () => {
    for (const [look, spell] of [["grease", "Grease"], ["spikes", "Spike Growth"], ["pit", "Pit"], ["water", "Create Spring"], ["marked", "Silence"]] as const) {
      const v = zoneVolume(look, "ellipse", circle(3), CELL, spell);
      expect(v.top).toBeLessThan(0.05);
      expect(v.layers).toBe(1);
      expect(v.skin).toBe(0);
    }
  });

  it("never stands a spell taller than the list's tallest, Cloudburst's 20 m", () => {
    expect(zoneVolume("fog", "ellipse", circle(sq(40)), CELL, "Magic Mist").top).toBeCloseTo(sq(20));
    expect(castVolume("downpour", { x: 0, y: 0 }, { x: 500, y: 500 }, sq(5) * CELL, CELL).top).toBeCloseTo(sq(20));
  });

  it("swells a burst (a Fireball) as a sphere where it lands, and flies a bolt at chest height", () => {
    const fire = castVolume("fire-burst", { x: 0, y: 0 }, { x: 900, y: 500 }, 300, CELL);
    expect(fire.form).toBe("dome");
    expect(fire.top).toBeCloseTo(3);
    expect(fire.area).toEqual({ x0: 600, y0: 200, x1: 1200, y1: 800 });
    const bolt = castVolume("lightning", { x: 0, y: 0 }, { x: 900, y: 500 }, 100, CELL);
    expect(bolt.layers).toBe(1);
    expect(bolt.bottom).toBeCloseTo(sq(1.2));
    expect(castVolume("earth-maw", { x: 0, y: 0 }, { x: 900, y: 500 }, 300, CELL).top).toBeLessThan(0.05);
  });

  it("keeps the old sheets for the looks on tokens", () => {
    expect(sheetLayers({ level: "mid" })).toEqual([{ y: 0.5, scale: 1, opacity: 1 }]);
  });

  it("wraps a skin round a column, and a dome's up to a point over its middle", () => {
    const beam = zoneVolume("moonbeam", "ellipse", circle(2), CELL, "Moonbeam");
    const col = skinMesh(beam, CELL);
    for (let i = 0; i < col.position.length; i += 3) expect(Math.hypot(col.position[i], col.position[i + 2])).toBeCloseTo(2);
    expect(Math.max(...col.rise)).toBe(1);
    const dome = skinMesh(zoneVolume("force-dome", "ellipse", circle(3), CELL, "Tiny Hut"), CELL);
    let top = 0, atTop = Infinity;
    for (let i = 0; i < dome.position.length; i += 3) {
      if (dome.position[i + 1] > top) [top, atTop] = [dome.position[i + 1], Math.hypot(dome.position[i], dome.position[i + 2])];
    }
    expect(top).toBeCloseTo(3);
    expect(atTop).toBeLessThan(0.01);
  });

  it("takes a skin's colour from its drawing, by how solid each pixel is", () => {
    // Two solid red pixels for each faint blue one, and an empty one, over and over.
    const px = new Uint8ClampedArray(Array.from({ length: 8 }, () => [255, 0, 0, 255, 0, 0, 255, 85, 0, 0, 0, 0, 255, 0, 0, 255]).flat());
    const c = meanColour(px, 1)!;
    expect(c[0]).toBeCloseTo(0.86, 1);
    expect(c[2]).toBeCloseTo(0.14, 1);
    expect(meanColour(new Uint8ClampedArray(16), 1)).toBeNull();
  });

  it("makes new sheets when a spell grows taller, not when it moves", () => {
    const a = zoneVolume("fog", "ellipse", circle(3), CELL, "Fog Cloud");
    const moved = zoneVolume("fog", "ellipse", circle(3).map((v) => v + 200), CELL, "Fog Cloud");
    expect(sameVolume(a, moved)).toBe(true);
    expect(sameVolume(a, zoneVolume("fog", "ellipse", circle(5), CELL, "Fog Cloud"))).toBe(false);
    expect(sameVolume(undefined, undefined)).toBe(true);
  });
});

describe("rooms from walls alone", () => {
  const grid = { size: CELL, offsetX: 0, offsetY: 0 };
  const area = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  /** A room's four walls round squares (c0, r0) to (c1, r1), on the grid lines. */
  const room = (c0: number, r0: number, c1: number, r1: number) => {
    const [x0, y0, x1, y1] = [c0 * CELL, r0 * CELL, (c1 + 1) * CELL, (r1 + 1) * CELL];
    return [
      [x0, y0, x1, y0],
      [x1, y0, x1, y1],
      [x1, y1, x0, y1],
      [x0, y1, x0, y0],
    ] as [number, number, number, number][];
  };

  it("finds the squares a room's walls close off", () => {
    const cells = enclosedCells(room(2, 2, 4, 3), area, grid);
    expect(cells).toHaveLength(6);
    expect(cells).toContainEqual([2, 2]);
    expect(cells).toContainEqual([4, 3]);
    expect(cells).not.toContainEqual([1, 2]);
  });

  it("counts a door (in the walls given) as closing the room", () => {
    const walls = room(2, 2, 4, 3);
    // The south wall in two pieces with a square's gap: open to the outside...
    walls[2] = [500, 400, 400, 400];
    walls.push([300, 400, 200, 400]);
    expect(enclosedCells(walls, area, grid)).toEqual([]);
    // ...until a door fills the gap.
    walls.push([400, 400, 300, 400]);
    expect(enclosedCells(walls, area, grid)).toHaveLength(6);
  });

  it("leaves a room with a gap in its walls (an archway) open to the outside", () => {
    const walls = room(2, 2, 4, 3).slice(0, 3);
    expect(enclosedCells(walls, area, grid)).toEqual([]);
  });

  it("leaves a pocket of one square without a roof", () => {
    expect(enclosedCells(room(6, 6, 6, 6), area, grid)).toEqual([]);
  });

  it("finds nothing on a map without walls", () => {
    expect(enclosedCells([], area, grid)).toEqual([]);
  });
});

// Magic in the 3D view (room/view3dEffects.ts), and rooms found from walls alone
// (room/view3dRoofs.ts enclosedCells): where each spell's sheet lies and how big it's drawn, and
// which squares a map's walls close off.
import { describe, expect, it } from "vitest";
import { EFFECT_SHEETS, castBounds, effectScale, sameSize, tokenLookBounds, zoneBounds } from "../src/client/room/view3dEffects";
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

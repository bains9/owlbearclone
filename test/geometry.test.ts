import { describe, expect, it } from "vitest";
import {
  cellDistance,
  formatDistance,
  guessGridSize,
  simplify,
  snapToVertex,
  snapTokenCenter,
} from "../src/shared/geometry";
import { DEFAULT_GRID } from "../src/shared/sanitize";
import type { GridSettings } from "../src/shared/types";

const grid: GridSettings = { ...DEFAULT_GRID, size: 100, offsetX: 0, offsetY: 0 };

describe("snapTokenCenter", () => {
  it("puts 1x1 tokens in the middle of a cell", () => {
    expect(snapTokenCenter({ x: 130, y: 260 }, 1, grid)).toEqual({ x: 150, y: 250 });
  });
  it("puts 2x2 tokens on an intersection", () => {
    expect(snapTokenCenter({ x: 130, y: 260 }, 2, grid)).toEqual({ x: 100, y: 300 });
  });
  it("respects the grid offset", () => {
    expect(snapTokenCenter({ x: 130, y: 260 }, 1, { ...grid, offsetX: 20, offsetY: -10 })).toEqual({ x: 170, y: 240 });
  });
  it("snaps half-size tokens to a half grid", () => {
    expect(snapTokenCenter({ x: 60, y: 10 }, 0.5, grid)).toEqual({ x: 75, y: 25 });
  });
});

describe("snapToVertex", () => {
  it("rounds to the nearest intersection", () => {
    expect(snapToVertex({ x: 149, y: 151 }, grid)).toEqual({ x: 100, y: 200 });
  });
});

describe("cellDistance", () => {
  const a = { x: 50, y: 50 };
  const b = { x: 350, y: 250 }; // 3 across, 2 down
  it("5e: diagonals count as one", () => {
    expect(cellDistance(a, b, grid)).toBe(3);
  });
  it("alternating: every second diagonal counts double", () => {
    expect(cellDistance(a, b, { ...grid, diagonal: "alternating" })).toBe(4);
    expect(cellDistance(a, { x: 450, y: 450 }, { ...grid, diagonal: "alternating" })).toBe(6);
  });
  it("euclidean: straight line", () => {
    expect(cellDistance(a, { x: 350, y: 450 }, { ...grid, diagonal: "euclidean" })).toBe(5);
  });
  it("formats with the unit", () => {
    expect(formatDistance(3, grid)).toBe("15 ft");
    expect(formatDistance(1.25, { ...grid, unit: 1, unitName: "m" })).toBe("1.3 m");
  });
});

describe("guessGridSize", () => {
  it("recognises common map resolutions", () => {
    expect(guessGridSize(3000, 2100)).toBe(100);
    expect(guessGridSize(4200, 2800)).toBe(140);
  });
  it("falls back to roughly 70px cells", () => {
    const s = guessGridSize(1999, 1333);
    expect(1999 / s).toBe(Math.round(1999 / 70));
  });
});

describe("simplify", () => {
  it("drops collinear points and keeps corners", () => {
    const pts = [0, 0, 1, 0, 2, 0, 3, 0, 3, 1, 3, 2, 3, 3];
    expect(simplify(pts, 0.1)).toEqual([0, 0, 3, 0, 3, 3]);
  });
});

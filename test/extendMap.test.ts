import { describe, expect, it } from "vitest";
import { fitBounds, sanitizeBounds, sanitizeScene, LIMITS } from "../src/shared/sanitize";
import { sceneBounds, sceneMiddle, type Scene } from "../src/shared/types";
import { areaCells, sceneAreaCells, sceneCells } from "../src/shared/terrain";

// Extending a map: a scene's area (bounds) can reach past its picture on any side, left and
// top below 0, without anything on the scene moving.

const grid = { type: "square" as const, size: 100, offsetX: 0, offsetY: 0, show: true, snap: true, color: "#000", opacity: 0.3, unit: 5, unitName: "ft", diagonal: "alternating" as const };

function scene(extra: Partial<Scene> = {}): Scene {
  return { id: "s1", name: "S", order: 0, mapAssetId: null, width: 1000, height: 800, background: "#222", grid, fogCover: false, createdAt: 1, ...extra };
}

describe("a scene's area", () => {
  it("is the picture's rectangle until the map is extended", () => {
    expect(sceneBounds(scene())).toEqual({ x0: 0, y0: 0, x1: 1000, y1: 800 });
    expect(sceneBounds(scene({ bounds: [-300, -200, 1500, 800] }))).toEqual({ x0: -300, y0: -200, x1: 1500, y1: 800 });
    expect(sceneMiddle(scene({ bounds: [-300, -200, 1500, 800] }))).toEqual({ x: 600, y: 300 });
  });

  it("covers cells below 0 when extended left and up", () => {
    expect(sceneCells(1000, 800, grid)).toEqual({ c0: 0, r0: 0, c1: 9, r1: 7 });
    expect(sceneAreaCells(scene({ bounds: [-300, -200, 1500, 800] }), grid)).toEqual({ c0: -3, r0: -2, c1: 14, r1: 7 });
    expect(areaCells({ x0: -50, y0: 0, x1: 100, y1: 100 }, { ...grid, offsetX: 25 })).toEqual({ c0: -1, r0: 0, c1: 0, r1: 0 });
  });
});

describe("bounds from the browser", () => {
  it("are four finite numbers enclosing an area, or null to go back", () => {
    expect(sanitizeBounds(null)).toBeNull();
    expect(sanitizeBounds([-1, -2, 3, 4])).toEqual([-1, -2, 3, 4]);
    expect(sanitizeBounds([0, 0, 0, 10])).toBeUndefined();
    expect(sanitizeBounds([0, 0, NaN, 10])).toBeUndefined();
    expect(sanitizeBounds("x")).toBeUndefined();
    expect(sanitizeBounds([1, 2, 3])).toBeUndefined();
  });

  it("always keep the picture inside, reach at most the limit past it, and vanish when they're just the picture", () => {
    expect(fitBounds([100, 100, 500, 500], 1000, 800)).toBeUndefined();
    expect(fitBounds([-300, 50, 1000, 900], 1000, 800)).toEqual([-300, 0, 1000, 900]);
    const m = LIMITS.sceneSizeMax;
    expect(fitBounds([-1e9, -1e9, 1e9, 1e9], 1000, 800)).toEqual([-m, -m, 1000 + m, 800 + m]);
  });
});

describe("changing a scene", () => {
  it("extends it, keeps the extension through other changes, and goes back on null", () => {
    const s = scene();
    const ext = sanitizeScene({ id: "s1", bounds: [-200, 0, 1000, 1200] }, s)!;
    expect(ext.bounds).toEqual([-200, 0, 1000, 1200]);
    const renamed = sanitizeScene({ id: "s1", name: "Bigger" }, ext)!;
    expect(renamed.bounds).toEqual([-200, 0, 1000, 1200]);
    const back = sanitizeScene({ id: "s1", bounds: null }, renamed)!;
    expect(back.bounds).toBeUndefined();
    expect("bounds" in back).toBe(false);
  });

  it("stretches the bounds to fit a larger new picture rather than cutting it off", () => {
    const ext = sanitizeScene({ id: "s1", bounds: [-200, 0, 1000, 1200] }, scene())!;
    const bigger = sanitizeScene({ id: "s1", width: 3000, height: 800 }, ext)!;
    expect(bigger.bounds).toEqual([-200, 0, 3000, 1200]);
  });

  it("leaves scenes that were never extended exactly as they were", () => {
    const s = sanitizeScene({ id: "s1", name: "Plain" }, scene())!;
    expect("bounds" in s).toBe(false);
  });
});

// High and low ground in the 3D view (room/view3dGround.ts): cliffs cut land off from the main
// ground, and it lies a cliff's height lower, with everything on it; the cliff becomes a face from
// the high ground's level down to the low (room/view3dCliffs.ts).
import { describe, expect, it } from "vitest";
import { cliffHeight, cliffMesh, type Cliff3d } from "../src/client/room/view3dCliffs";
import { groundOf, heightAt, onGround } from "../src/client/room/view3dGround";

const CELL = 100;
/** 20 by 15 squares. */
const AREA = { x0: 0, y0: 0, x1: 20 * CELL, y1: 15 * CELL };
const line = (pts: number[], half = 0.25): Cliff3d => ({ pts: Float64Array.from(pts.map((v) => v * CELL)), halfWidth: half * CELL });

describe("high and low ground", () => {
  it("drops the land a ledge cuts off from the main ground, by the cliff's height", () => {
    // A ledge across near the top, its ends just short of the map's sides.
    const g = groundOf([line([0.6, 4, 7, 3.5, 13, 4.5, 19.4, 4])], AREA, CELL)!;
    expect(g).not.toBeNull();
    expect(g.drop).toBeCloseTo(cliffHeight(0.25));
    // North of it, low; the rest, the main ground, level with its top.
    expect(heightAt(g, 10 * CELL, 1 * CELL)).toBeCloseTo(-g.drop);
    expect(heightAt(g, 3 * CELL, 2 * CELL)).toBeCloseTo(-g.drop);
    expect(heightAt(g, 10 * CELL, 10 * CELL)).toBe(0);
    expect(heightAt(g, 1 * CELL, 14 * CELL)).toBe(0);
  });

  it("takes two pieces a couple of squares apart (a building in the gap) as one cliff", () => {
    const g = groundOf([line([0.5, 6, 8, 3]), line([10, 3, 19.5, 6])], AREA, CELL)!;
    expect(g).not.toBeNull();
    expect(heightAt(g, 9 * CELL, 1 * CELL)).toBeLessThan(0);
    expect(heightAt(g, 9 * CELL, 10 * CELL)).toBe(0);
  });

  it("leaves the ground flat where cliffs cut nothing off", () => {
    expect(groundOf([line([6, 7, 14, 7])], AREA, CELL)).toBeNull();
    expect(groundOf([], AREA, CELL)).toBeNull();
    expect(heightAt(null, 5, 5)).toBe(0);
  });

  it("lowers what stands on the low ground, and nothing on the main ground", () => {
    const g = groundOf([line([0.6, 4, 19.4, 4])], AREA, CELL)!;
    // A corner on the low ground at 1 up, one on the main ground at 1 up (squares).
    const pos = Float32Array.from([10, 1, 1, 10, 1, 10]);
    onGround(pos, g, CELL);
    expect(pos[1]).toBeCloseTo(1 - g.drop);
    expect(pos[4]).toBe(1);
  });

  it("makes the cliff a face from the high ground's level down to the low ground", () => {
    const c = line([0.6, 4, 19.4, 4]);
    const g = groundOf([c], AREA, CELL)!;
    const m = cliffMesh([c], CELL, null, true, null, g);
    const ys = Array.from(m.position).filter((_, i) => i % 3 === 1);
    // Its top a little lip above the main ground; its foot on the low ground.
    expect(Math.max(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(0.3);
    expect(Math.min(...ys)).toBeCloseTo(-g.drop);
    // Without high and low ground, a ridge as before.
    const ridge = cliffMesh([c], CELL, null, true, null, null);
    expect(Math.min(...Array.from(ridge.position).filter((_, i) => i % 3 === 1))).toBe(0);
    expect(Math.max(...Array.from(ridge.position).filter((_, i) => i % 3 === 1))).toBeGreaterThan(1);
  });
});

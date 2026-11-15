// Things found in a picture for the 3D view (room/view3dFound.ts): on a map without map data, the
// trees, bushes, bare trees and rocks it paints on open ground, found by colour against the ground
// round them; and the shapes they stand up as, at real-world scale (room/view3dObjects.ts).
import { describe, expect, it } from "vitest";
import type { PaintMap } from "../src/client/room/view3dModel";
import { findThings, foundHoles, foundObjects } from "../src/client/room/view3dFound";
import { treeHeight } from "../src/client/room/view3dObjects";

const CELL = 100;
/** 20 paint pixels a square, 30 by 20 squares. */
const S = 20, W = 30 * S, H = 20 * S;

function snowfield(): PaintMap {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const x = p % W, y = Math.floor(p / W);
    const t = ((x * 7 + y * 13) % 9) - 4;
    rgba.set([232 + t, 236 + t, 242 + t, 255], p * 4);
  }
  return { x0: 0, y0: 0, k: S / CELL, w: W, h: H, rgba };
}

/** Paints a disc (centre and radius in squares) with a darker rim. */
function disc(p: PaintMap, cx: number, cy: number, r: number, col: number[], spiky = false): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx * S, dy = y + 0.5 - cy * S;
      const a = Math.atan2(dy, dx);
      const reach = r * S * (spiky ? 0.62 + 0.38 * Math.abs(Math.cos(a * 4)) : 1);
      const d = Math.hypot(dx, dy);
      if (d < reach) p.rgba.set(d > reach - 1.5 ? col.map((v) => v * 0.6) : col, (y * W + x) * 4);
    }
  }
}

/** Paints a bare tree: thin dark branches out from a dense knot in the middle. */
function bare(p: PaintMap, cx: number, cy: number, r: number): void {
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 36) p.rgba.set([80, 52, 34, 255], ((Math.round(cy * S) + y) * W + Math.round(cx * S) + x) * 4);
  for (let b = 0; b < 14; b++) {
    const a = (b / 14) * Math.PI * 2;
    for (let t = 0; t < r * S; t += 0.5) {
      const x = Math.round(cx * S + Math.cos(a) * t), y = Math.round(cy * S + Math.sin(a) * t);
      for (const dx of [0, 1]) if (x + dx >= 0 && y >= 0 && x + dx < W && y < H) p.rgba.set([80, 52, 34, 255], (y * W + x + dx) * 4);
    }
  }
}

function rect(p: PaintMap, x0: number, y0: number, x1: number, y1: number, col: number[]): void {
  for (let y = y0 * S; y < y1 * S; y++) for (let x = x0 * S; x < x1 * S; x++) p.rgba.set(col, (y * W + x) * 4);
}

const picture = { w: W * (CELL / S), h: H * (CELL / S) };

describe("things found in a picture", () => {
  const p = snowfield();
  disc(p, 4, 4, 1.2, [60, 120, 60]); // a leafy tree, 2.4 squares across
  disc(p, 10, 4, 1, [30, 70, 40], true); // a dark spiky pine
  disc(p, 16, 4, 0.3, [90, 150, 80]); // a bush
  disc(p, 22, 4, 0.6, [130, 130, 128]); // a grey rock
  bare(p, 4, 12, 1.6); // a bare tree
  rect(p, 10, 10, 15, 14, [120, 85, 50]); // a building: too big
  rect(p, 18, 10, 28, 10.4, [120, 120, 120]); // a path or wall: too long
  disc(p, 24, 15, 0.5, [190, 30, 30]); // blood: red
  const found = findThings(p, picture, CELL);
  const at = (x: number, y: number) => found.find((f) => Math.hypot(f.x / CELL - x, f.y / CELL - y) < 0.6);

  it("finds a leafy tree, a pine, a bush, a rock and a bare tree where they're painted", () => {
    expect(at(4, 4)?.shape.kind).toBe("tree");
    expect(at(10, 4)?.shape.kind).toBe("pine");
    expect(at(16, 4)?.shape.kind).toBe("bush");
    expect(at(22, 4)?.shape.kind).toBe("rock");
    expect(at(4, 12)?.shape.kind).toBe("bare");
  });

  it("sizes each as painted", () => {
    expect(at(4, 4)!.w).toBeCloseTo(2.4, 0);
    expect(at(16, 4)!.w).toBeLessThan(0.8);
    // Its reach in every direction covers its painted rim.
    for (const r of at(4, 4)!.r) expect(r / CELL).toBeGreaterThan(1.1);
  });

  it("leaves buildings, paths, walls and blood alone", () => {
    expect(at(12.5, 12)).toBeUndefined();
    expect(at(23, 10.2)).toBeUndefined();
    expect(at(24, 15)).toBeUndefined();
    expect(found).toHaveLength(5);
  });

  it("finds nothing on bare ground", () => {
    expect(findThings(snowfield(), picture, CELL)).toEqual([]);
    expect(findThings(null, picture, CELL)).toEqual([]);
  });

  it("stands them up coloured from the picture, and takes their paint off in the clearing's pixels", () => {
    const objs = foundObjects(found);
    expect(objs.every((o) => o.paint && o.color === null)).toBe(true);
    const holes = foundHoles(found, 0.5);
    const tree = found.indexOf(at(4, 4)!);
    expect(holes[tree].x).toBeCloseTo(found[tree].x * 0.5);
    expect(holes[tree].r[0]).toBeCloseTo(found[tree].r[0] * 0.5);
  });
});

describe("real-world scale", () => {
  it("stands a pine about three times as tall as it's wide, a leafy tree about one and a half, within 30 m", () => {
    expect(treeHeight("pine", 2)).toBeCloseTo(6.3);
    expect(treeHeight("tree", 3)).toBeCloseTo(4.5);
    expect(treeHeight("pine", 50)).toBe(20);
  });
});

describe("cliffs found in a picture", () => {
  /** A band (squares) from x0 to x1 at row y, `half` squares each side, in a colour, its rim darker. */
  function band(p: PaintMap, x0: number, x1: number, y: number, half: number, col: number[]): void {
    for (let py = Math.floor((y - half) * S); py < (y + half) * S; py++) {
      for (let px = x0 * S; px < x1 * S; px++) {
        const rim = py < (y - half) * S + 1.5 || py >= (y + half) * S - 1.5;
        p.rgba.set(rim ? col.map((v) => v * 0.6) : col, (py * W + px) * 4);
      }
    }
  }

  it("stands a long blue-grey ledge up as a cliff along its middle, as wide as it's drawn", () => {
    const p = snowfield();
    band(p, 4, 20, 10, 0.4, [150, 155, 168]);
    const cliffs: { pts: Float64Array; halfWidth: number }[] = [];
    findThings(p, picture, CELL, cliffs);
    expect(cliffs).toHaveLength(1);
    const xs = Array.from(cliffs[0].pts).filter((_, i) => i % 2 === 0).map((v) => v / CELL);
    const ys = Array.from(cliffs[0].pts).filter((_, i) => i % 2 === 1).map((v) => v / CELL);
    expect(Math.min(...xs)).toBeLessThan(5);
    expect(Math.max(...xs)).toBeGreaterThan(19);
    for (const y of ys) expect(Math.abs(y - 10)).toBeLessThan(0.3);
    expect(cliffs[0].halfWidth / CELL).toBeGreaterThan(0.25);
    expect(cliffs[0].halfWidth / CELL).toBeLessThan(0.6);
  });

  it("doesn't take a brown path, or a short grey stone, for a cliff", () => {
    const p = snowfield();
    band(p, 4, 20, 6, 0.4, [150, 120, 90]);
    band(p, 4, 6, 14, 0.4, [150, 155, 168]);
    const cliffs: { pts: Float64Array; halfWidth: number }[] = [];
    findThings(p, picture, CELL, cliffs);
    expect(cliffs).toEqual([]);
  });
});

describe("a rock drawn by its outline", () => {
  it("stands a snow-capped rock up: a grey ring round snow", () => {
    const p = snowfield();
    // A ring 2 pixels thick, 1.5 squares across, with the snow inside.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x + 0.5 - 10 * S, y + 0.5 - 10 * S);
        if (d < 0.75 * S && d > 0.75 * S - 2) p.rgba.set([120, 124, 130, 255], (y * W + x) * 4);
      }
    }
    const found = findThings(p, picture, CELL);
    expect(found).toHaveLength(1);
    expect(found[0].shape.kind).toBe("rock");
    expect(found[0].w).toBeCloseTo(1.5, 0);
  });
});

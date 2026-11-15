// Rock from darkness in the 3D view (room/view3dRock.ts): a cave or dungeon map's black stands up
// as rock, its faces where it meets the ground and its top, only where a player has seen.
import { describe, expect, it } from "vitest";
import { WALL_SEEN, type CoverMap, type PaintMap } from "../src/client/room/view3dModel";
import { ROCK_SHARE, rockMask, rockSides, rockTop } from "../src/client/room/view3dRock";

const CELL = 100;
/** 10 paint pixels a square, 20 by 15 squares. */
const W = 200, H = 150, K = 0.1;

/** A cave map: grey floor, black over its left 6 squares; a speck of black on the floor; a white label on the black. */
function cave(): PaintMap {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const black = i < 60;
      rgba.set(black ? [0, 0, 0, 255] : [120, 115, 110, 255], (j * W + i) * 4);
    }
  }
  // A shadow on the floor, 2 by 2 pixels; a label on the black, 6 by 2.
  for (const [i, j] of [[100, 50], [101, 50], [100, 51], [101, 51]]) rgba.set([10, 10, 10, 255], (j * W + i) * 4);
  for (let i = 20; i < 26; i++) for (const j of [70, 71]) rgba.set([240, 240, 240, 255], (j * W + i) * 4);
  return { x0: 0, y0: 0, k: K, w: W, h: H, rgba };
}

const picture = { w: W / K, h: H / K };

describe("rock from darkness", () => {
  it("finds a map drawn on black, without its specks of shadow or the labels on it", () => {
    const m = rockMask(cave(), picture, CELL)!;
    expect(m).not.toBeNull();
    expect(m.rock[70 * W + 10]).toBe(1);
    expect(m.rock[70 * W + 22]).toBe(1); // the label is rock
    expect(m.rock[50 * W + 100]).toBe(0); // the shadow isn't
    expect(m.rock[70 * W + 120]).toBe(0);
  });

  it("finds nothing on a map that isn't drawn on black", () => {
    const p = cave();
    for (let q = 0; q < W * H; q++) p.rgba.set([120, 115, 110, 255], q * 4);
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) p.rgba.set([0, 0, 0, 255], (j * W + i) * 4);
    expect(rockMask(p, picture, CELL)).toBeNull();
    expect(ROCK_SHARE).toBeGreaterThan(0.01);
  });

  it("stands its faces up where rock meets ground, a wall's height tall, facing the ground, in the colour at their foot", () => {
    const m = rockMask(cave(), picture, CELL)!;
    const s = rockSides(m, CELL, 2, null, true, cave());
    expect(s.position.length).toBeGreaterThan(0);
    for (let v = 0; v < s.position.length; v += 3) {
      const [x, y, z] = [s.position[v], s.position[v + 1], s.position[v + 2]];
      // Along x = 6 squares (and round the picture's edge, like a model's side), from the floor to 2 squares up.
      expect(y === 0 || y === 2).toBe(true);
      if (z > 0.2 && z < 14.8 && x > 0.2) expect(Math.abs(x - 6)).toBeLessThan(0.1);
    }
    // The face along the cave's edge faces the ground (east).
    let east = 0;
    for (let v = 0; v < s.normal.length; v += 3) if (s.normal[v] > 0.9) east++;
    expect(east).toBeGreaterThan(0);
    // Grey from the floor at its foot, not black.
    expect(Math.max(...Array.from(s.color))).toBeGreaterThan(0.25);
  });

  it("winds every face so WebGL draws its front, towards the ground", () => {
    const m = rockMask(cave(), picture, CELL)!;
    const s = rockSides(m, CELL, 2, null, true, cave());
    for (let t = 0; t < s.position.length / 9; t++) {
      const p = (k: number) => [s.position[t * 9 + k * 3], s.position[t * 9 + k * 3 + 1], s.position[t * 9 + k * 3 + 2]];
      const [a, b, c] = [p(0), p(1), p(2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = [s.normal[t * 9], s.normal[t * 9 + 1], s.normal[t * 9 + 2]];
      expect(x[0] * n[0] + x[1] * n[1] + x[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it("shows a player only the rock beside ground they've seen; the GM all of it", () => {
    const m = rockMask(cave(), picture, CELL)!;
    // Seen: the top 5 squares; the rest under fog.
    const cover: CoverMap = { x0: 0, y0: 0, k: 1 / CELL, w: 20, h: 15, alpha: new Uint8ClampedArray(20 * 15).map((_, i) => (Math.floor(i / 20) < 5 ? 0 : 255)) };
    const player = rockSides(m, CELL, 2, cover, false, cave());
    const zs = Array.from(player.position).filter((_, i) => i % 3 === 2);
    expect(zs.length).toBeGreaterThan(0);
    expect(Math.max(...zs)).toBeLessThan(5.5);
    const gm = rockSides(m, CELL, 2, cover, true, cave());
    expect(gm.position.length).toBeGreaterThan(player.position.length);
    // Its top: near what's been seen for a player, all of it for the GM.
    const top = rockTop(m, CELL, cover, false);
    expect(top[(20 * W + 30) * 4 + 3]).toBe(0); // more than a square and a half from seen floor
    expect(top[(100 * W + 55) * 4 + 3]).toBe(0); // beside floor under the fog
    expect(top[(20 * W + 55) * 4 + 3]).toBe(255); // beside seen floor
    expect(top[(2 * W + 55) * 4 + 3]).toBe(255);
    expect(top[(2 * W + 70) * 4 + 3]).toBe(0); // floor is never rock
    const all = rockTop(m, CELL, cover, true);
    expect(all[(140 * W + 10) * 4 + 3]).toBe(255);
    expect(WALL_SEEN).toBeGreaterThan(0);
  });

  it("isn't rock outside the picture (a map extended past it)", () => {
    const m = rockMask(cave(), { w: 1500, h: 1500 }, CELL)!;
    expect(m.rock[70 * W + 10]).toBe(1);
    expect(m.inside[70 * W + 180]).toBe(0);
    expect(m.rock[70 * W + 180]).toBe(0);
  });
});

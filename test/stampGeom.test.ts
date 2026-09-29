import { describe, expect, it } from "vitest";
import { snapDeg } from "../src/shared/terrain";
import type { StampId } from "../src/shared/terrain";
import {
  CLIPBOARD_MAX,
  STAMP_DRAW_AFTER,
  STAMP_DRAW_BEFORE,
  blockOf,
  canResize,
  centreOf,
  clampShift,
  decodeObjects,
  drawnBounds,
  encodeObjects,
  groupBlock,
  groupFits,
  hitsPoint,
  placeGroupAt,
  placedOf,
  rescaleAnchor,
  samePlaced,
  shiftGroup,
  sizeGroup,
  stampFor,
  turnGroup,
} from "../src/client/room/stampGeom";
import type { Placed } from "../src/client/room/stampGeom";

const P = (col: number, row: number, deg = 0, size = 1, id: StampId = "chair"): Placed => ({ id, col, row, deg, size });
/** A scene 20 squares wide and 10 high. */
const scene = { c0: 0, r0: 0, c1: 19, r1: 9 };
const huge = { c0: -1000, r0: -1000, c1: 1000, r1: 1000 };
const SIZES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const ANGLES = Array.from({ length: 72 }, (_, i) => i * 5);

describe("where an object stands", () => {
  it("is stored in the chunk of its block's top-left cell, one way only", () => {
    const p = P(-1, 17, 105, 1.5, "table");
    const s = stampFor(p);
    expect(s).toEqual({ cx: -1, cy: 1, stamp: ["table", 15, 1, 1, 1.5, 15] });
    expect(placedOf(s.cx, s.cy, s.stamp)).toEqual(p);
    // Quarter turns stay five long, as objects always were.
    expect(stampFor(P(3, 4, 270, 2)).stamp).toEqual(["chair", 3, 4, 3, 2]);
    expect(samePlaced(p, { ...p })).toBe(true);
    expect(samePlaced(p, { ...p, deg: 110 })).toBe(false);
  });

  it("stands on 1, 2 or 3 squares, drawn centred on them", () => {
    expect(blockOf(P(4, 5, 0, 0.5))).toEqual({ c0: 4, r0: 5, c1: 4, r1: 5 });
    expect(blockOf(P(4, 5, 0, 1.5))).toEqual({ c0: 4, r0: 5, c1: 5, r1: 6 });
    expect(blockOf(P(4, 5, 0, 2.75))).toEqual({ c0: 4, r0: 5, c1: 6, r1: 7 });
    expect(centreOf(P(4, 5, 0, 1.25))).toEqual({ x: 4.5, y: 5.5 });
    expect(centreOf(P(4, 5, 0, 2))).toEqual({ x: 5, y: 6 });
  });

  it("resizes about its middle, and one step up and down comes back to the same place", () => {
    expect([rescaleAnchor(5, 1, 2), rescaleAnchor(4, 2, 1)]).toEqual([4, 5]);
    expect([rescaleAnchor(4, 2, 3), rescaleAnchor(3, 3, 2)]).toEqual([3, 4]);
    expect([rescaleAnchor(5, 1, 3), rescaleAnchor(4, 3, 1), rescaleAnchor(7, 2, 2)]).toEqual([4, 5, 7]);
    for (let a = -6; a <= 6; a++) {
      for (const [f, t] of [[1, 2], [2, 1], [2, 3], [3, 2], [1, 3], [3, 1]]) {
        expect(rescaleAnchor(rescaleAnchor(a, f, t), t, f), `${a}: ${f} to ${t} and back`).toBe(a);
      }
    }
  });
});

describe("what an object's drawing covers", () => {
  it("is exactly its block when turned by quarter turns at its full size", () => {
    for (const deg of [0, 90, 180, 270]) {
      for (const size of [1, 2, 3]) expect(drawnBounds(P(4, 5, deg, size))).toEqual(blockOf(P(4, 5, deg, size)));
    }
    expect(drawnBounds(P(4, 5, 90, 0.5))).toEqual({ c0: 4, r0: 5, c1: 4, r1: 5 });
  });

  it("reaches one cell before its top-left cell and three after at most (3 squares at 45 degrees)", () => {
    expect(drawnBounds(P(10, 10, 45, 3))).toEqual({ c0: 9, r0: 9, c1: 13, r1: 13 });
    for (const deg of ANGLES) {
      for (const size of SIZES) {
        const b = drawnBounds(P(10, 10, deg, size));
        expect(b.c0).toBeGreaterThanOrEqual(10 - STAMP_DRAW_BEFORE);
        expect(b.r0).toBeGreaterThanOrEqual(10 - STAMP_DRAW_BEFORE);
        expect(b.c1).toBeLessThanOrEqual(10 + STAMP_DRAW_AFTER);
        expect(b.r1).toBeLessThanOrEqual(10 + STAMP_DRAW_AFTER);
      }
    }
  });

  it("is hit where it's drawn, not where its block is", () => {
    // A 1 1/4-square object turned 45 degrees: its corner pokes out of its block, above it.
    expect(hitsPoint(P(10, 10, 45, 1.25), 10.5, 9.7, 0)).toBe(true);
    expect(hitsPoint(P(10, 10, 0, 1.25), 10.5, 9.7, 0)).toBe(false);
    // Half a square, turned 45 degrees: the corner of its block is empty floor.
    expect(hitsPoint(P(10, 10, 45, 0.5), 10.05, 10.05, 0)).toBe(false);
    expect(hitsPoint(P(10, 10, 45, 0.5), 10.5, 10.5, 0)).toBe(true);
    // Half a square, not turned: the floor round it in its block isn't it, unless reached with a finger.
    expect(hitsPoint(P(10, 10, 0, 0.5), 10.1, 10.1, 0)).toBe(false);
    expect(hitsPoint(P(10, 10, 0, 0.5), 10.1, 10.1, 0.2)).toBe(true);
    // Edges count.
    expect(hitsPoint(P(10, 10, 90, 1), 11, 10.5, 0)).toBe(true);
  });
});

describe("moving a group", () => {
  const group = [P(0, 0), P(2, 1, 0, 2)];

  it("stops at every edge of the scene, the whole group together", () => {
    expect(clampShift(group, -3, -1, scene)).toEqual({ dCol: 0, dRow: 0 });
    expect(clampShift(group, 100, 100, scene)).toEqual({ dCol: 16, dRow: 7 });
    expect(clampShift(group, 5, 2, scene)).toEqual({ dCol: 5, dRow: 2 });
    expect(shiftGroup(group, 100, -4, scene)).toEqual([P(16, 0), P(18, 1, 0, 2)]);
  });

  it("doesn't move one way at all where the group can't fit that way", () => {
    const wide = [P(0, 5), P(25, 5)];
    expect(clampShift(wide, 3, 2, scene)).toEqual({ dCol: 0, dRow: 2 });
  });

  it("pulls back on an object already off the scene (the scene was made smaller)", () => {
    expect(clampShift([P(-2, 3)], 1, 0, scene)).toEqual({ dCol: 2, dRow: 0 });
    expect(clampShift([P(22, 3)], 0, 1, scene)).toEqual({ dCol: -3, dRow: 1 });
  });
});

describe("turning a group", () => {
  it("turns one object where it stands, at every angle and size", () => {
    for (const deg of ANGLES) {
      for (const size of SIZES) {
        expect(turnGroup([P(5, 3, 15, size)], deg, huge)).toEqual([P(5, 3, snapDeg(15 + deg), size)]);
      }
    }
  });

  it("keeps a table and its chairs exactly as they were, a quarter turn at a time", () => {
    // Chairs either side of a 2-square table, along its top row: 4 squares by 2.
    const set = [P(4, 5), P(5, 5, 0, 2, "table"), P(7, 5)];
    expect(turnGroup(set, 90, huge)).toEqual([P(6, 4, 90), P(5, 5, 90, 2, "table"), P(6, 7, 90)]);
    expect(turnGroup(set, 180, huge)).toEqual([P(7, 6, 180), P(5, 5, 180, 2, "table"), P(4, 6, 180)]);
    expect(turnGroup(set, 270, huge)).toEqual([P(5, 7, 270), P(5, 5, 270, 2, "table"), P(5, 4, 270)]);
  });

  it("an odd number of cells wider than tall: kept exactly, the whole group shifted half a cell", () => {
    const pair = [P(4, 4), P(5, 4)];
    // Where the pair turned exactly would stand, half a cell up and left of this.
    expect(turnGroup(pair, 90, huge)).toEqual([P(5, 4, 90), P(5, 5, 90)]);
    expect(turnGroup(pair, 180, huge)).toEqual([P(5, 4, 180), P(4, 4, 180)]);
  });

  it("comes back exactly to where it started, from the same base", () => {
    const set = [P(4, 5), P(5, 5, 0, 2, "table"), P(7, 5), P(9, 9, 30, 0.75, "rock")];
    expect(turnGroup(set, 360, huge)).toEqual(set);
    expect(turnGroup(set, 4 * 90, huge)).toEqual(set);
    for (let k = 1; k <= 24; k++) {
      const turned = turnGroup(set, 15 * k, huge);
      if (k % 6 === 0) expect(turned).toEqual(turnGroup(set, (15 * k) % 360, huge));
      for (const p of turned) expect(p.deg).toBe(snapDeg(p.deg));
    }
    expect(turnGroup(set, 24 * 15, huge)).toEqual(set);
    expect(turnGroup(set, -90, huge)).toEqual(turnGroup(set, 270, huge));
  });

  it("stays on the grid, near where turning would take it, at other angles", () => {
    // Two chairs a square apart turned 45 degrees about their middle: one up, one down.
    const pair = [P(4, 4), P(6, 4)];
    const turned = turnGroup(pair, 45, huge);
    expect(turned.map((p) => p.deg)).toEqual([45, 45]);
    expect(turned[0].row).toBeLessThan(turned[1].row);
    expect(turned[0].col).toBeLessThan(turned[1].col);
    expect(turnGroup([P(0, 0, 350)], 15, huge)).toEqual([P(0, 0, 5)]);
  });

  it("stays on the scene", () => {
    // Along the top edge: turned, the row would reach above it.
    const turned = turnGroup([P(0, 0), P(1, 0), P(2, 0)], 90, scene);
    expect(turned).toEqual([P(1, 0, 90), P(1, 1, 90), P(1, 2, 90)]);
    expect(groupFits(turned, scene)).toBe(true);
  });

  it("keeps every object on the scene when the group, turned, is too big for it that way", () => {
    // Trees across nearly all of a scene 40 squares wide and 20 high: turned, the group is
    // taller than the scene, so it can't be moved back onto it whole.
    const wide = { c0: 0, r0: 0, c1: 39, r1: 19 };
    const trees = [P(1, 1), P(38, 1), P(1, 18), P(38, 18), P(20, 10, 0, 2)].map((p) => ({ ...p, id: "tree" as const }));
    for (const deg of [15, 45, 90, 135, 270, 345]) {
      const turned = turnGroup(trees, deg, wide);
      expect(groupFits(turned, wide), `${deg} degrees`).toBe(true);
      expect(turned.map((p) => p.deg)).toEqual(trees.map(() => deg));
    }
    // A quarter turn: those that would be above or below the scene are just inside its edge.
    expect(turnGroup(trees, 90, wide).map((p) => [p.col, p.row])).toEqual([[28, 0], [28, 19], [11, 0], [11, 19], [18, 10]]);
    // Turned back from the same base, all are where they started.
    expect(turnGroup(trees, 360, wide)).toEqual(trees);
  });
});

describe("sizing a group", () => {
  it("sizes each object about its own middle, a quarter square at a time", () => {
    expect(sizeGroup([P(5, 5)], 0.25, scene)).toEqual([P(5, 5, 0, 1.25)]);
    expect(sizeGroup([P(5, 5, 0, 1.25)], 0.25, scene)).toEqual([P(4, 4, 0, 1.5)]);
    expect(sizeGroup([P(4, 4, 0, 1.5)], -0.25, scene)).toEqual([P(5, 5, 0, 1.25)]);
    expect(sizeGroup([P(5, 5), P(8, 2, 0, 2.25)], 0.25, scene)).toEqual([P(5, 5, 0, 1.25), P(7, 1, 0, 2.5)]);
  });

  it("stops at half a square and at 3 squares, and keeps each on the scene", () => {
    expect(sizeGroup([P(5, 5, 0, 3)], 0.25, scene)).toEqual([P(5, 5, 0, 3)]);
    expect(sizeGroup([P(5, 5, 0, 0.5)], -0.25, scene)).toEqual([P(5, 5, 0, 0.5)]);
    expect(sizeGroup([P(0, 0, 0, 1.25)], 0.25, scene)).toEqual([P(0, 0, 0, 1.5)]);
    expect(canResize([P(0, 0, 0, 3), P(0, 0, 0, 0.5)], 1)).toBe(true);
    expect(canResize([P(0, 0, 0, 3)], 1)).toBe(false);
    expect(canResize([P(0, 0, 0, 0.5)], -1)).toBe(false);
    expect(canResize([P(0, 0, 0, 0.75)], -1)).toBe(true);
  });

  it("comes back to where it started, even on the scene's edge, sized from where the steps began", () => {
    // In the top-left corner 1 1/2 squares stand in the corner, whether they came from the
    // corner or from a square in: a step back down on its own can't tell which.
    const corner = [P(0, 0, 0, 1.25)];
    const up = sizeGroup(corner, 0.25, scene, corner);
    expect(up).toEqual([P(0, 0, 0, 1.5)]);
    expect(sizeGroup(up, -0.25, scene)).toEqual([P(1, 1, 0, 1.25)]);
    expect(sizeGroup(up, -0.25, scene, corner)).toEqual(corner);
    expect(sizeGroup(sizeGroup([P(0, 5, 0, 2.25)], 0.25, scene), -0.25, scene, [P(0, 5, 0, 2.25)])).toEqual([P(0, 5, 0, 2.25)]);
    // Any run of steps up and back down, or down and back up, by every edge and away from them.
    for (const size of SIZES) {
      for (const col of [0, 1, 2, 9, 17, 18, 19]) {
        for (const row of [0, 1, 5, 7, 8, 9]) {
          const start = [P(col, row, 0, size), P(9, 4, 30, 1.75, "table")];
          if (!groupFits(start, scene)) continue;
          for (const step of [0.25, -0.25]) {
            for (let k = 1; k <= 10; k++) {
              let ps = start;
              for (let j = 0; j < k; j++) ps = sizeGroup(ps, step, scene, start);
              expect(groupFits(ps, scene)).toBe(true);
              for (let j = 0; j < k; j++) ps = sizeGroup(ps, -step, scene, start);
              // (Unless it stopped at a limit on the way.)
              if (size + k * step >= 0.5 && size + k * step <= 3 && 1.75 + k * step >= 0.5 && 1.75 + k * step <= 3) {
                expect(ps, `${size} at ${col},${row}, ${k} steps of ${step}`).toEqual(start);
              }
            }
          }
        }
      }
    }
  });
});

describe("placing a group", () => {
  const group = [P(3, 3, 0, 2, "table"), P(5, 3)];

  it("centres it on a cell, as near as whole cells allow", () => {
    expect(groupBlock(group)).toEqual({ c0: 3, r0: 3, c1: 5, r1: 4 });
    // 3 by 2: its top-left one left of and one above the cell.
    expect(placeGroupAt(group, 10, 5, scene)).toEqual([P(9, 4, 0, 2, "table"), P(11, 4)]);
  });

  it("keeps it on the scene, or can't if it's bigger", () => {
    expect(placeGroupAt(group, 0, 0, scene)).toEqual([P(0, 0, 0, 2, "table"), P(2, 0)]);
    expect(placeGroupAt(group, 30, 30, scene)).toEqual([P(17, 8, 0, 2, "table"), P(19, 8)]);
    expect(placeGroupAt([P(0, 0), P(20, 0)], 5, 5, scene)).toBeNull();
    expect(groupFits([P(19, 9)], scene)).toBe(true);
    expect(groupFits([P(19, 9, 0, 1.5)], scene)).toBe(false);
  });
});

describe("the clipboard", () => {
  const text = '{"tabletop":"build-objects","v":1,"objects":[["table",0,0,15,1.5],["chair",2,1,0,1]]}';

  it("writes objects from the group's top-left, and reads them back", () => {
    const ps = [P(10, 5, 15, 1.5, "table"), P(12, 6)];
    expect(encodeObjects(ps)).toBe(text);
    expect(decodeObjects(encodeObjects(ps))).toEqual([P(0, 0, 15, 1.5, "table"), P(2, 1)]);
    expect(decodeObjects(`\n  ${text}  \n`)).toEqual([P(0, 0, 15, 1.5, "table"), P(2, 1)]);
  });

  it("ignores what later versions might add", () => {
    const more = '{"tabletop":"build-objects","v":1,"from":"x","objects":[["table",3,4,15,1.5,"mirrored"],["chair",5,5,0,1]]}';
    expect(decodeObjects(more)).toEqual([P(0, 0, 15, 1.5, "table"), P(2, 1)]);
  });

  it("refuses anything else, and never throws", () => {
    const wrap = (objects: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ tabletop: "build-objects", v: 1, objects, ...extra });
    const bad = [
      "",
      "not json {",
      "null",
      "5",
      '"text"',
      "[]",
      text.replace("build-objects", "tokens"),
      wrap([["chair", 0, 0, 0, 1]], { v: 2 }),
      wrap([]),
      wrap(Array.from({ length: CLIPBOARD_MAX + 1 }, () => ["chair", 0, 0, 0, 1])),
      wrap([["throne", 0, 0, 0, 1]]),
      wrap([["chair", 0, 0, 7, 1]]),
      wrap([["chair", 0, 0, 360, 1]]),
      wrap([["chair", 0, 0, 0, 0.3]]),
      wrap([["chair", 0, 0, 0, 3.25]]),
      wrap([["chair", 0, 0, 0, "1"]]),
      wrap([["chair", -1, 0, 0, 1]]),
      wrap([["chair", 0, 1.5, 0, 1]]),
      wrap([["chair", 0, 0, 0]]),
      wrap(["chair"]),
      wrap({ 0: ["chair", 0, 0, 0, 1] }),
    ];
    for (const t of bad) expect(decodeObjects(t), t.slice(0, 80)).toBeNull();
    expect(decodeObjects(wrap(Array.from({ length: CLIPBOARD_MAX }, () => ["chair", 0, 0, 0, 1])))).toHaveLength(CLIPBOARD_MAX);
  });
});

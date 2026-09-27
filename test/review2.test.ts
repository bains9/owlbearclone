import { describe, expect, it } from "vitest";
import { hexCenter, hexStep, isOnGrid, pointToHex, stepByCells } from "../src/shared/geometry";
import { isRoomId } from "../src/shared/ids";
import { inverseOps } from "../src/shared/ops";
import { DEFAULT_GRID, sanitizeSet } from "../src/shared/sanitize";
import type { DrawingItem, GridSettings, TokenItem } from "../src/shared/types";
import { numberedCopy } from "../src/client/room/actions";

const square: GridSettings = { ...DEFAULT_GRID, size: 100, offsetX: 0, offsetY: 0 };
const pointy: GridSettings = { ...square, type: "hex-pointy" };
const flat: GridSettings = { ...square, type: "hex-flat" };

const token: TokenItem = {
  id: "tok1",
  sceneId: "scene1",
  kind: "token",
  z: 0,
  owner: "@gm",
  x: 50,
  y: 50,
  size: 1,
  rotation: 0,
  assetId: null,
  color: "#ff0000",
  label: "Chest",
  hidden: false,
  locked: false,
  rings: [],
};

describe("copy numbering", () => {
  it("keeps the label's own separator", () => {
    expect(numberedCopy("Goblin #2", ["Goblin #2"])).toBe("Goblin #3");
    expect(numberedCopy("Goblin2", ["Goblin2", "Goblin7"])).toBe("Goblin8");
    expect(numberedCopy("Goblin 2", ["Goblin 2"])).toBe("Goblin 3");
  });

  it("numbers plain numbers", () => {
    expect(numberedCopy("1", ["1"])).toBe("2");
    expect(numberedCopy("7", ["7", "9", "Goblin 12"])).toBe("10");
  });

  it("still names unnumbered copies", () => {
    expect(numberedCopy("Goblin", ["Goblin"])).toBe("Goblin 2");
    expect(numberedCopy("Goblin ", ["Goblin "])).toBe("Goblin 2");
  });
});

describe("stepping across hexes", () => {
  it("moves to a neighbouring hex every step", () => {
    for (const grid of [pointy, flat]) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let p = hexCenter({ q: 0, r: 0 }, grid);
        for (let i = 0; i < 6; i++) {
          const next = stepByCells(p, dx, dy, grid);
          expect(Math.hypot(next.x - p.x, next.y - p.y)).toBeCloseTo(100, 5);
          expect(isOnGrid(next, 1, grid)).toBe(true);
          p = next;
        }
      }
    }
  });

  it("goes straight up on pointy hexes instead of drifting sideways", () => {
    const start = hexCenter({ q: 2, r: 3 }, pointy);
    let h = pointToHex(start, pointy);
    for (let i = 0; i < 10; i++) {
      h = hexStep(h, 0, -1, pointy);
      const c = hexCenter(h, pointy);
      expect(Math.abs(c.x - start.x)).toBeLessThanOrEqual(50.001);
      expect(c.y).toBeLessThan(start.y);
    }
  });

  it("goes straight across on flat hexes instead of drifting", () => {
    const start = hexCenter({ q: -1, r: 4 }, flat);
    let h = pointToHex(start, flat);
    for (let i = 0; i < 10; i++) {
      h = hexStep(h, 1, 0, flat);
      expect(Math.abs(hexCenter(h, flat).y - start.y)).toBeLessThanOrEqual(50.001);
    }
  });

  it("moves whole squares on square grids", () => {
    expect(stepByCells({ x: 50, y: 50 }, 1, -2, square)).toEqual({ x: 150, y: -150 });
  });
});

describe("on-grid test", () => {
  it("knows a centred token from one knocked off the grid", () => {
    expect(isOnGrid({ x: 50, y: 150 }, 1, square)).toBe(true);
    expect(isOnGrid({ x: 100, y: 100 }, 1, square)).toBe(false);
    expect(isOnGrid({ x: 100, y: 100 }, 2, square)).toBe(true);
    expect(isOnGrid({ x: 25, y: 75 }, 0.5, square)).toBe(true);
  });
});

describe("undoing a field that was missing", () => {
  it("puts a token that became a prop back to a character", () => {
    const undo = inverseOps({ tok1: token }, { patch: [{ id: "tok1", set: { layer: "prop" } }] });
    expect(undo.patch).toEqual([{ id: "tok1", set: { layer: "character" } }]);
    expect(sanitizeSet(token, undo.patch![0].set)).toEqual({ layer: "character" });
  });

  it("shows a note again that had no hidden flag", () => {
    const note: DrawingItem = {
      id: "note1",
      sceneId: "scene1",
      kind: "drawing",
      z: 0,
      owner: "@gm",
      shape: "text",
      points: [0, 0],
      color: "#ffffff",
      width: 20,
      fill: false,
      text: "Trap here",
    };
    const undo = inverseOps({ note1: note }, { patch: [{ id: "note1", set: { hidden: true } }] });
    expect(undo.patch).toEqual([{ id: "note1", set: { hidden: false } }]);
    expect(sanitizeSet(note, undo.patch![0].set)).toEqual({ hidden: false });
  });
});

describe("room links", () => {
  it("accepts only 12-character ids", () => {
    expect(isRoomId("AbCdEf123456")).toBe(true);
    expect(isRoomId("AbCdEf12345")).toBe(false);
    expect(isRoomId("AbCdEf1234567")).toBe(false);
    expect(isRoomId("AbCdEf12345-")).toBe(false);
  });
});

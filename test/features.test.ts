import { describe, expect, it } from "vitest";
import {
  cellDistance,
  cellSpacing,
  hexCenter,
  hexCorners,
  pointToHex,
  snapToVertex,
  snapTokenCenter,
  templateGeometry,
} from "../src/shared/geometry";
import { DEFAULT_GRID, sanitizeGrid, sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import type { DrawingItem, GridSettings, Initiative, TokenItem } from "../src/shared/types";
import { applyInitOp } from "../src/shared/initiative";
import { numberedCopy } from "../src/client/room/actions";

const square: GridSettings = { ...DEFAULT_GRID, size: 100, offsetX: 0, offsetY: 0 };
const pointy: GridSettings = { ...square, type: "hex-pointy" };
const flat: GridSettings = { ...square, type: "hex-flat" };

describe("hex grids", () => {
  it("round-trips hex centres", () => {
    for (const grid of [pointy, flat]) {
      for (const h of [
        { q: 0, r: 0 },
        { q: 3, r: -1 },
        { q: -2, r: 5 },
      ]) {
        expect(pointToHex(hexCenter(h, grid), grid)).toEqual(h);
      }
    }
  });

  it("puts neighbours one hex width apart", () => {
    for (const grid of [pointy, flat]) {
      const a = hexCenter({ q: 0, r: 0 }, grid);
      for (const n of [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 },
      ]) {
        const b = hexCenter(n, grid);
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(100, 6);
      }
    }
  });

  it("snaps a point near a centre onto that centre", () => {
    const c = hexCenter({ q: 2, r: 3 }, pointy);
    expect(snapTokenCenter({ x: c.x + 20, y: c.y - 15 }, 1, pointy)).toEqual(c);
    expect(snapTokenCenter({ x: c.x + 20, y: c.y - 15 }, 2, pointy)).toEqual(c);
  });

  it("snaps fog corners to hex corners", () => {
    const c = hexCenter({ q: 1, r: 1 }, flat);
    const corners = hexCorners(c, flat);
    const v = snapToVertex({ x: corners[0] + 3, y: corners[1] - 2 }, flat);
    expect(v.x).toBeCloseTo(corners[0], 6);
    expect(v.y).toBeCloseTo(corners[1], 6);
  });

  it("counts distance in hexes", () => {
    const a = hexCenter({ q: 0, r: 0 }, pointy);
    expect(cellDistance(a, hexCenter({ q: 3, r: 0 }, pointy), pointy)).toBe(3);
    expect(cellDistance(a, hexCenter({ q: 2, r: 2 }, pointy), pointy)).toBe(4);
    expect(cellDistance(a, hexCenter({ q: -2, r: 2 }, pointy), pointy)).toBe(2);
  });

  it("reports row/column spacing", () => {
    expect(cellSpacing(square)).toEqual({ x: 100, y: 100 });
    expect(cellSpacing(pointy).x).toBe(100);
    expect(cellSpacing(pointy).y).toBeCloseTo(86.6025, 3);
    expect(cellSpacing(flat).y).toBe(100);
  });

  it("treats scenes saved before hex grids as square", () => {
    const old = { ...square } as GridSettings;
    delete old.type;
    expect(snapTokenCenter({ x: 130, y: 260 }, 1, old)).toEqual({ x: 150, y: 250 });
    expect(sanitizeGrid({}, old).type).toBe("square");
    expect(sanitizeGrid({ type: "hex-flat" }, old).type).toBe("hex-flat");
    expect(sanitizeGrid({ type: "triangles" }, pointy).type).toBe("hex-pointy");
  });
});

describe("spell templates", () => {
  const a = { x: 0, y: 0 };
  it("circle radius snaps to whole squares", () => {
    const t = templateGeometry("circle", a, { x: 190, y: 0 }, square);
    expect(t.cells).toBe(2);
    expect(t.circle).toEqual({ x: 0, y: 0, r: 200 });
    expect(t.label).toBe("10 ft radius");
  });
  it("a cone is as wide at the end as it is long", () => {
    const t = templateGeometry("cone", a, { x: 300, y: 0 }, square);
    expect(t.polygon).toEqual([0, 0, 300, 150, 300, -150]);
    expect(t.label).toBe("15 ft cone");
  });
  it("a cube grows towards the pointer", () => {
    const t = templateGeometry("square", a, { x: -210, y: 90 }, square);
    expect(t.cells).toBe(2);
    expect(t.polygon).toEqual([0, 0, -200, 0, -200, 200, 0, 200]);
  });
  it("a line is one square wide", () => {
    const t = templateGeometry("beam", a, { x: 0, y: 600 }, square);
    const xs = t.polygon!.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 6);
    expect(t.label).toBe("30 ft line");
  });
  it("never shrinks below one square when snapping", () => {
    expect(templateGeometry("circle", a, { x: 5, y: 0 }, square).cells).toBe(1);
  });
});

describe("duplicate naming", () => {
  it("numbers copies", () => {
    expect(numberedCopy("Goblin", ["Goblin"])).toBe("Goblin 2");
    expect(numberedCopy("Goblin", ["Goblin", "Goblin 2", "Goblin 5"])).toBe("Goblin 6");
    expect(numberedCopy("Goblin 2", ["Goblin 1", "Goblin 2"])).toBe("Goblin 3");
    expect(numberedCopy("", [])).toBe("");
    expect(numberedCopy("Orc (big)", ["Orc (big)"])).toBe("Orc (big) 2");
  });
});

describe("new item fields", () => {
  const note: DrawingItem = {
    id: "n1",
    sceneId: "s1",
    kind: "drawing",
    z: 0,
    owner: "a",
    shape: "text",
    points: [10, 20],
    color: "#ffffff",
    width: 24,
    fill: false,
    text: "Trapdoor",
  };
  it("accepts text notes and keeps line breaks", () => {
    expect(sanitizeItem({ ...note, text: "Room 4\r\nSecret door" }, "a")).toMatchObject({ text: "Room 4\nSecret door" });
    expect(sanitizeItem({ ...note, text: "   " }, "a")).toBeNull();
    expect(sanitizeItem({ ...note, points: [1, 2, 3, 4] }, "a")).toBeNull();
    expect(sanitizeSet(note, { text: "Pit" })).toEqual({ text: "Pit" });
  });
  it("only text drawings carry text", () => {
    const line: DrawingItem = { ...note, shape: "line", points: [0, 0, 1, 1] };
    delete line.text;
    expect(sanitizeSet(line, { text: "x" })).toBeNull();
    expect(sanitizeItem({ ...line, text: "sneaky" }, "a")).not.toHaveProperty("text");
  });
  it("accepts closed polygons (pinned templates)", () => {
    expect(sanitizeItem({ ...note, shape: "poly", points: [0, 0, 10, 0, 5, 5], fill: true }, "a")).not.toBeNull();
    expect(sanitizeItem({ ...note, shape: "poly", points: [0, 0, 10, 0] }, "a")).toBeNull();
  });
  it("accepts the prop layer", () => {
    const token: TokenItem = {
      id: "t1",
      sceneId: "s1",
      kind: "token",
      z: 0,
      owner: "a",
      x: 0,
      y: 0,
      size: 1,
      rotation: 0,
      assetId: null,
      color: "#e4572e",
      label: "",
      hidden: false,
      locked: false,
      rings: [],
    };
    expect(sanitizeItem({ ...token, layer: "prop" }, "a")).toMatchObject({ layer: "prop" });
    expect(sanitizeItem({ ...token, layer: "ceiling" }, "a")).not.toHaveProperty("layer");
    expect(sanitizeSet(token, { layer: "prop" })).toEqual({ layer: "prop" });
    expect(sanitizeSet(token, { layer: "ceiling" })).toBeNull();
  });
});

describe("initiative operations", () => {
  const e = (id: string, value: number) => ({ id, name: id, value, color: "#ffffff", tokenId: null });
  const base: Initiative = { entries: [e("a", 20), e("b", 15), e("c", 10)], turn: 1, round: 2 };

  it("adds in order and keeps the turn on the same combatant", () => {
    const next = applyInitOp(base, { op: "add", entry: e("d", 17) });
    expect(next.entries.map((x) => x.id)).toEqual(["a", "d", "b", "c"]);
    expect(next.entries[next.turn].id).toBe("b");
    expect(applyInitOp(next, { op: "add", entry: e("d", 1) })).toBe(next);
  });

  it("re-sorts on a new value without losing the turn", () => {
    const next = applyInitOp(base, { op: "update", id: "c", value: 30 });
    expect(next.entries.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(next.entries[next.turn].id).toBe("b");
  });

  it("passes the turn on when the current combatant is removed", () => {
    const mid = applyInitOp(base, { op: "remove", id: "b" });
    expect(mid.entries[mid.turn].id).toBe("c");
    expect(mid.round).toBe(2);
    const last = applyInitOp({ ...base, turn: 2 }, { op: "remove", id: "c" });
    expect(last.turn).toBe(0);
    expect(last.round).toBe(3);
  });

  it("steps with rounds, and from 'someone you can't see'", () => {
    const end = applyInitOp({ ...base, turn: 2 }, { op: "step", dir: 1 });
    expect([end.turn, end.round]).toEqual([0, 3]);
    const back = applyInitOp({ ...base, turn: 0 }, { op: "step", dir: -1 });
    expect([back.turn, back.round]).toEqual([2, 1]);
    expect(applyInitOp({ ...base, turn: -1 }, { op: "step", dir: 1 }).turn).toBe(0);
    expect(applyInitOp({ ...base, turn: -1 }, { op: "update", id: "a", value: 1 }).turn).toBe(-1);
  });

  it("clears", () => {
    expect(applyInitOp(base, { op: "clear" })).toEqual({ entries: [], turn: 0, round: 1 });
  });
});

describe("fog brush strokes", () => {
  const stroke = { id: "f1", sceneId: "s1", kind: "fog", z: 0, mode: "reveal", shape: "stroke", points: [0, 0, 50, 50], width: 140 };
  it("needs a width and at least two points", () => {
    expect(sanitizeItem(stroke, "@gm")).toMatchObject({ shape: "stroke", width: 140 });
    expect(sanitizeItem({ ...stroke, width: undefined }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...stroke, points: [0, 0] }, "@gm")).toBeNull();
    expect(sanitizeItem({ ...stroke, width: 1e9 }, "@gm")).toMatchObject({ width: 40000 });
  });
  it("other fog shapes don't carry a width", () => {
    expect(sanitizeItem({ ...stroke, shape: "rect", points: [0, 0, 10, 10] }, "@gm")).not.toHaveProperty("width");
  });
});

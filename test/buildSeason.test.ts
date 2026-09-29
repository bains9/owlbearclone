import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { terrainId } from "../src/shared/terrain";
import type { Stamp, StampId } from "../src/shared/terrain";
import type { Scene, TerrainItem } from "../src/shared/types";
import {
  BuildModel,
  BuildRenderer,
  EXPOSURE_REACH,
  SHELTERED,
  cellKey,
  computeExposure,
  groundVariant,
  indexTerrain,
  winterCover,
} from "../src/client/room/build";
import { autumnHues, drawStamp, floorVariant, hasSeasonalArt, mapToStamp, mapToStampDeg, stampHash } from "../src/client/room/buildArt";
import type { StampLook } from "../src/client/room/buildArt";

const SCENE = "Scene1234567";

/** A chunk at (0, 0) from rows of characters (one per cell), with edges and objects. */
function chunk(rows: string[], edges: Record<number, string> = {}, stamps: Stamp[] = [], cx = 0, cy = 0): TerrainItem {
  const cells = Array<string>(256).fill(".");
  rows.forEach((line, r) => [...line].forEach((ch, c) => (cells[r * 16 + c] = ch)));
  const e = Array<string>(512).fill(".");
  for (const [i, ch] of Object.entries(edges)) e[Number(i)] = ch;
  return { id: terrainId(SCENE, cx, cy), sceneId: SCENE, kind: "terrain", z: 0, owner: "@gm", cx, cy, cells: cells.join(""), edges: e.join(""), stamps };
}

/** The edge index of a cell's top ("t") or left ("l") edge within its chunk. */
const edge = (col: number, row: number, side: "t" | "l") => ((row % 16) * 16 + (col % 16)) * 2 + (side === "l" ? 1 : 0);

/** Chunks covering `cols` x `rows` cells from (0, 0), each cell's floor from `at`. */
function area(cols: number, rows: number, at: (col: number, row: number) => string): TerrainItem[] {
  const out: TerrainItem[] = [];
  for (let cy = 0; cy * 16 < rows; cy++) {
    for (let cx = 0; cx * 16 < cols; cx++) {
      const lines = Array.from({ length: 16 }, (_, r) =>
        Array.from({ length: 16 }, (_, c) => (cx * 16 + c < cols && cy * 16 + r < rows ? at(cx * 16 + c, cy * 16 + r) : ".")).join(""),
      );
      out.push(chunk(lines, {}, [], cx, cy));
    }
  }
  return out;
}

function model(...items: TerrainItem[]): BuildModel {
  const m = new BuildModel();
  m.index = indexTerrain(items);
  return m;
}

describe("what counts as outdoors", () => {
  it("reaches out from grass over open floor, up to six squares", () => {
    const e = computeExposure(model(chunk(["gSSSSSSSSS"])));
    expect([...Array(10).keys()].map((c) => e.dist(c, 0))).toEqual([0, 1, 2, 3, 4, 5, 6, SHELTERED, SHELTERED, SHELTERED]);
    expect(EXPOSURE_REACH).toBe(6);
    // Empty cells round it are never outdoors.
    expect(e.dist(0, 1)).toBe(SHELTERED);
  });

  it("walls and doors stop it; an opening doesn't", () => {
    // Grass, then unwalled stone behind a line at column 2.
    for (const [mark, blocked] of [
      ["w", true],
      ["d", true],
      ["D", true],
      ["o", false],
      [".", false],
    ] as const) {
      const e = computeExposure(model(chunk(["ggSSS"], { [edge(2, 0, "l")]: mark })));
      expect(e.dist(2, 0), mark).toBe(blocked ? SHELTERED : 1);
    }
  });

  it("a secret door is a wall to the search too, so the GM and players agree", () => {
    const secretEdges = Array(512)
      .fill(".")
      .map((c, i) => (i === edge(2, 0, "l") ? "s" : c))
      .join("");
    const marker: TerrainItem = { ...chunk([]), id: "AbCdEfGhIjKl", hidden: true, edges: secretEdges };
    const e = computeExposure(model(chunk(["ggSSS"], { [edge(2, 0, "l")]: "w" }), marker));
    expect(e.dist(2, 0)).toBe(SHELTERED);
  });

  it("walled room floors are always indoors, and the search doesn't go through them", () => {
    // Grass, a walled stone room with an opening in its wall, and a stone yard beyond.
    const e = computeExposure(model(chunk(["gsssSS"], { [edge(1, 0, "l")]: "o", [edge(4, 0, "l")]: "o" })));
    expect([1, 2, 3].map((c) => e.dist(c, 0))).toEqual([SHELTERED, SHELTERED, SHELTERED]);
    expect(e.dist(4, 0)).toBe(SHELTERED);
    // The same room with a tree in it (a potted plant) is still indoors.
    const potted = computeExposure(model(chunk(["gsss"], {}, [["tree", 2, 0, 0, 1]])));
    expect(potted.dist(2, 0)).toBe(SHELTERED);
    expect(potted.nearTree(2, 0)).toBe(false);
  });

  it("water is outdoors only when reached from grass", () => {
    // A cave: dirt floor with a tree on it and a pool beside it, no grass anywhere.
    const cave = computeExposure(model(chunk(["DDaa", "DDaa"], {}, [["tree", 0, 0, 0, 1]])));
    expect(cave.dist(0, 0)).toBe(0);
    expect(cave.dist(1, 0)).toBe(1);
    expect(cave.dist(2, 0)).toBe(SHELTERED);
    expect(cave.dist(3, 1)).toBe(SHELTERED);
    // No trees either: nothing is outdoors.
    const bare = computeExposure(model(chunk(["DDaa"])));
    expect([0, 1, 2, 3].map((c) => bare.dist(c, 0))).toEqual([SHELTERED, SHELTERED, SHELTERED, SHELTERED]);
    // A pond in a meadow is.
    const pond = computeExposure(model(chunk(["gaaa"])));
    expect([1, 2, 3].map((c) => pond.dist(c, 0))).toEqual([1, 2, 3]);
    // And paving reached across water from grass only counts from the grass.
    const across = computeExposure(model(chunk(["gaSS"])));
    expect(across.dist(2, 0)).toBe(2);
  });

  it("lava and empty space stop it", () => {
    const e = computeExposure(model(chunk(["glS", "g.S"])));
    expect(e.dist(2, 0)).toBe(SHELTERED);
    expect(e.dist(2, 1)).toBe(SHELTERED);
  });

  it("trees and bushes make the ground round them outdoors, and mark where more leaves fall", () => {
    const e = computeExposure(model(chunk(["SSSSSSSSSS"], {}, [["bush", 3, 0, 0, 1]])));
    expect([0, 3, 6, 9].map((c) => e.dist(c, 0))).toEqual([3, 0, 3, 6]);
    expect([1, 2, 3, 4, 5].map((c) => e.nearTree(c, 0))).toEqual([false, true, true, true, false]);
    // A tree on an uploaded map, with no floor under it, still counts.
    const loose = computeExposure(model(chunk([".SS"], {}, [["tree", 0, 0, 0, 1]])));
    expect(loose.dist(0, 0)).toBe(0);
    expect(loose.dist(2, 0)).toBe(2);
  });

  it("goes by the squares an object stands on, however big it's drawn", () => {
    const paving = ["SSSSSSSSSS", "SSSSSSSSSS", "SSSSSSSSSS", "SSSSSSSSSS"];
    const under = (size: number) => {
      const e = computeExposure(model(chunk(paving, {}, [["tree", 3, 0, 0, size]])));
      return [0, 1, 2, 3].flatMap((row) => [...Array(10).keys()].filter((col) => e.dist(col, row) === 0).map((col) => `${col},${row}`));
    };
    // Half a square and 1 1/4 squares stand on one; 2 1/4 on two by two, 2 1/2 on three by three.
    expect(under(0.5)).toEqual(["3,0"]);
    expect(under(1.25)).toEqual(["3,0"]);
    expect(under(2.25)).toEqual(["3,0", "4,0", "3,1", "4,1"]);
    expect(under(2.5)).toHaveLength(9);
    // More leaves fall a square round the block, not round the drawing.
    const e = computeExposure(model(chunk(paving, {}, [["tree", 3, 0, 0, 2.25]])));
    expect([1, 2, 5, 6].map((c) => e.nearTree(c, 2))).toEqual([false, true, true, false]);
    expect(e.nearTree(4, 3)).toBe(false);
  });

  it("works across chunk borders and for negative cells", () => {
    const left = chunk(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "..............gS"], {}, [], -1, -1);
    const right = chunk(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "SS"], {}, [], 0, -1);
    const e = computeExposure(model(left, right));
    expect([-2, -1, 0, 1].map((c) => e.dist(c, -1))).toEqual([0, 1, 2, 3]);
  });

  it("marks the whole of a lake or river the grass reaches as open water, as far as walls let it go", () => {
    // A lake 20 squares across in a ring of grass: its middle is 10 squares from the shore.
    const lake = computeExposure(model(...area(22, 22, (c, r) => (c === 0 || r === 0 || c === 21 || r === 21 ? "g" : "a"))));
    expect(lake.dist(10, 10)).toBe(SHELTERED);
    expect([1, 10, 20].map((c) => lake.openWater(c, 10))).toEqual([true, true, true]);
    expect(lake.openWater(0, 10)).toBe(false);
    // A channel: a wall across it stops it, as it stops the search from the grass.
    const channel = (edges: Record<number, string>) => computeExposure(model(chunk(["gaaaaaaaaaaaaaaa"], edges)));
    expect(channel({}).openWater(15, 0)).toBe(true);
    expect([8, 9, 15].map((c) => channel({ [edge(9, 0, "l")]: "w" }).openWater(c, 0))).toEqual([true, false, false]);
    // Water only a tree reaches (a pool in a built cave) isn't.
    const cave = computeExposure(model(chunk(["DDaa", "DDaa"], {}, [["tree", 0, 0, 0, 1]])));
    expect(cave.openWater(2, 0)).toBe(false);
  });

  it("ignores a stroke still being drawn, and leaves it as it was", () => {
    const m = model(chunk(["SSS"]));
    const draft = { cells: new Map([[cellKey(0, 0), "g"]]), walls: new Map() };
    m.draft = draft;
    const e = computeExposure(m);
    expect(e.dist(1, 0)).toBe(SHELTERED);
    expect(m.draft).toBe(draft);
  });
});

describe("winter cover and seasonal textures", () => {
  it("thins out away from the grass, more of it at each level", () => {
    expect([0, 2, 3, 6].map((d) => winterCover(d, 1))).toEqual([1, 1, 0, 0]);
    expect([0, 2, 3, 4, 5].map((d) => winterCover(d, 2))).toEqual([2, 2, 1, 1, 0]);
    expect([0, 4, 5, 6, SHELTERED].map((d) => winterCover(d, 3))).toEqual([3, 3, 2, 1, 0]);
  });

  it("changes grass in every look, water and earth only in some, stone, wood and lava never", () => {
    expect(floorVariant("g", "autumn", 2)).toBe("autumn2");
    expect(floorVariant("a", "winter", 1)).toBe("winter1");
    expect(floorVariant("a", "summer", 1)).toBe("");
    expect(floorVariant("a", "summer", 3)).toBe("summer3");
    expect(floorVariant("a", "autumn", 3)).toBe("");
    expect(floorVariant("d", "spring", 1)).toBe("spring1");
    expect(floorVariant("d", "winter", 3)).toBe("");
    for (const f of ["s", "w", "l"] as const) {
      for (const look of ["spring", "summer", "autumn", "winter"] as const) expect(floorVariant(f, look, 3)).toBe("");
    }
  });

  it("colours all of a lake, but freezes it only near the shore", () => {
    const lake = computeExposure(model(...area(22, 22, (c, r) => (c === 0 || r === 0 || c === 21 || r === 21 ? "g" : "a"))));
    const at = (col: number, look: "winter" | "summer", level: 1 | 2 | 3) =>
      groundVariant("a", lake.dist(col, 10), lake.openWater(col, 10), look, level, 0.99);
    // The middle is as cold (or murky) as the edge, rather than changing in a line six squares out.
    expect([2, 6, 7, 10].map((c) => at(c, "winter", 1))).toEqual(["winter1", "winter1", "winter1", "winter1"]);
    expect([2, 10].map((c) => at(c, "summer", 3))).toEqual(["summer3", "summer3"]);
    expect(at(10, "summer", 1)).toBe("");
    // Deep winter: ice near the shore, cold open water in the middle.
    expect([1, 4, 10].map((c) => at(c, "winter", 3))).toEqual(["winter3", "winter3", "winter2"]);
    // Water the grass doesn't reach stays as it is.
    expect(groundVariant("a", SHELTERED, false, "winter", 1, 0)).toBe("");
  });

  it("thins wet or dry earth out over the last two squares of the reach, rather than stopping in a line", () => {
    expect(groundVariant("D", 4, false, "spring", 1, 0.99)).toBe("spring1");
    expect([0.1, 0.5, 0.9].map((h) => groundVariant("D", 5, false, "spring", 1, h))).toEqual(["spring1", "spring1", ""]);
    expect([0.1, 0.5, 0.9].map((h) => groundVariant("D", 6, false, "spring", 1, h))).toEqual(["spring1", "", ""]);
    expect(groundVariant("D", SHELTERED, false, "spring", 1, 0)).toBe("");
    // The edge of the ice the same way.
    expect([0.1, 0.9].map((h) => groundVariant("a", 5, true, "winter", 3, h))).toEqual(["winter3", "winter2"]);
    // Grass always changes; walled earth, stone and wood never.
    expect(groundVariant("g", SHELTERED, false, "autumn", 2, 0)).toBe("autumn2");
    for (const ch of ["d", "s", "S", "W"]) expect(groundVariant(ch, 0, false, "spring", 3, 0)).toBe("");
    // Along a road leading away from a meadow, the wet earth gives out over two squares, differently on each row.
    const road = computeExposure(model(chunk(Array(16).fill("gDDDDDDDDDDDDDDD"))));
    const wet = (col: number) =>
      [...Array(16).keys()].filter((row) => groundVariant("D", road.dist(col, row), false, "spring", 1, stampHash(col, row, 9)) !== "").length;
    expect([4, 5, 6, 7, 8].map(wet)).toEqual([16, expect.any(Number), expect.any(Number), 0, 0]);
    expect(wet(5)).toBeGreaterThan(wet(6));
    expect(wet(6)).toBeGreaterThan(0);
    expect(wet(5)).toBeLessThan(16);
  });

  it("gives furniture no seasonal art, and rocks, wells and campfires only in winter", () => {
    expect(hasSeasonalArt("tree", "spring")).toBe(true);
    expect(hasSeasonalArt("bush", "summer")).toBe(true);
    expect(hasSeasonalArt("rock", "winter")).toBe(true);
    expect(hasSeasonalArt("rock", "autumn")).toBe(false);
    expect(hasSeasonalArt("table", "winter")).toBe(false);
  });
});

describe("snow on turned objects", () => {
  // Objects are drawn inside c.rotate(turns * PI / 2): turning the offset back must land it
  // on the same side of the map whichever way the object faces.
  const rotate = ([x, y]: [number, number], turns: number): [number, number] => {
    const a = (turns * Math.PI) / 2;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  };

  it("counter-rotates the offset so it points the same way on the map", () => {
    for (const v of [
      [-1, -1],
      [-0.3, 0.8],
      [0.5, 0],
    ] as [number, number][]) {
      for (let turns = 0; turns < 4; turns++) {
        const [x, y] = rotate(mapToStamp(v[0], v[1], turns), turns);
        expect(x).toBeCloseTo(v[0], 12);
        expect(y).toBeCloseTo(v[1], 12);
      }
    }
  });

  it("differs from the plain offset once the object is turned", () => {
    expect(mapToStamp(-1, -1, 0)).toEqual([-1, -1]);
    expect(mapToStamp(-1, -1, 1)).toEqual([-1, 1]);
    expect(mapToStamp(-1, -1, 2)).toEqual([1, 1]);
    expect(mapToStamp(-1, -1, 3)).toEqual([1, -1]);
    expect(mapToStamp(-1, -1, 5)).toEqual(mapToStamp(-1, -1, 1));
  });
});

describe("autumn trees", () => {
  const hashes = Array.from({ length: 400 }, (_, i) => (i * 0.6180339887) % 1);

  it("are always a mix, some green, never mostly red, thinner each level", () => {
    const kept = [0, 0, 0];
    const green = [0, 0, 0];
    const red = [0, 0, 0];
    for (const level of [1, 2, 3] as const) {
      for (const h of hashes) {
        const hues = autumnHues(level, h);
        const on = hues.filter((x) => x >= 0);
        expect(new Set(on).size).toBeGreaterThanOrEqual(2);
        expect(on.filter((x) => x === 0).length).toBeGreaterThanOrEqual(1);
        expect(on.filter((x) => x === 3).length).toBeLessThanOrEqual(on.length / 3);
        kept[level - 1] += on.length / hues.length;
        green[level - 1] += on.filter((x) => x === 0).length / on.length;
        red[level - 1] += on.filter((x) => x === 3).length / on.length;
      }
    }
    const mean = (a: number[]) => a.map((v) => v / hashes.length);
    // Thinning about 10%, 22% and 35%; green about 45%, 25% and 12%.
    mean(kept).forEach((v, i) => expect(v).toBeCloseTo([0.9, 0.78, 0.65][i], 1));
    mean(green).forEach((v, i) => expect(v).toBeCloseTo([0.45, 0.25, 0.12][i], 1));
    expect(Math.max(...mean(red))).toBeLessThan(0.34);
  });

  it("differ from tree to tree, the same on every screen", () => {
    const looks = new Set(hashes.slice(0, 50).map((h) => autumnHues(2, h).join()));
    expect(looks.size).toBeGreaterThan(45);
    expect(autumnHues(3, 0.25)).toEqual(autumnHues(3, 0.25));
  });

  it("every one has some red, orange, yellow and green, however few clumps it has", () => {
    for (const n of [17, 12]) {
      for (const level of [1, 2, 3] as const) {
        for (let i = 0; i < 20000; i++) {
          const on = autumnHues(level, ((i * 2654435761) >>> 0) / 4294967296, n).filter((x) => x >= 0);
          const count = [0, 1, 2, 3].map((hue) => on.filter((x) => x === hue).length);
          if (Math.min(...count) < 1 || count[3] > on.length / 3) throw new Error(`${n} clumps, level ${level}, #${i}: ${count}`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------- drawing

/** A canvas stand-in that writes down every call, so two drawings can be compared. */
const fmt = (v: unknown): string => {
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v !== "object" || v === null) return String(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(",")}]`;
  const d = (v as { desc?: () => string }).desc;
  return d ? d() : "{}";
};

class FakePath {
  ops: string[] = [];
  desc = () => `path{${this.ops.join(";")}}`;
  constructor(from?: FakePath) {
    if (from) this.ops = [...from.ops];
    return new Proxy(this, {
      get: (t, p) => (p in t ? t[p as keyof FakePath] : (...a: unknown[]) => t.ops.push(`${String(p)}(${a.map(fmt).join(",")})`)),
    });
  }
}

function fakeCanvas(log: string[] = []): HTMLCanvasElement & { log: string[] } {
  const props: Record<string, unknown> = { width: 300, height: 150 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, p) => {
      if (p in t) return t[p as string];
      if (p === "createPattern") return () => ({ setTransform: (m: unknown) => log.push(`pattern(${fmt(m)})`), desc: () => "pattern" });
      return (...a: unknown[]) => log.push(`${String(p)}(${a.map(fmt).join(",")})`);
    },
    set: (t, p, v) => {
      log.push(`${String(p)}=${fmt(v)}`);
      t[p as string] = v;
      return true;
    },
  });
  return new Proxy(props, {
    get: (t, p) => (p === "getContext" ? () => ctx : p === "log" ? log : p === "desc" ? () => `canvas(${t.width}x${t.height})` : t[p as string]),
    set: (t, p, v) => ((t[p as string] = v), true),
  }) as unknown as HTMLCanvasElement & { log: string[] };
}

const g = globalThis as Record<string, unknown>;
const saved = { Path2D: g.Path2D, DOMMatrix: g.DOMMatrix, document: g.document };
beforeAll(() => {
  g.Path2D = FakePath;
  g.DOMMatrix = class {
    constructor(readonly m: number[]) {}
    desc = () => `matrix${fmt(this.m)}`;
  };
  g.document = { createElement: () => fakeCanvas() };
});
afterAll(() => Object.assign(g, saved));

const scene = {
  id: SCENE,
  width: 20 * 70,
  height: 10 * 70,
  grid: { type: "square", size: 70, offsetX: 0, offsetY: 0 },
} as unknown as Scene;

function sampleBuild(): TerrainItem[] {
  return [
    chunk(
      ["ggggggaaSSSS", "ggggggaaSsss", "DDDDDDDDSsss", "ggggSSSSSsss", "ggllSSSSSWWW"],
      { [edge(9, 1, "t")]: "d" },
      [
        ["tree", 0, 0, 1, 2],
        ["bush", 4, 0, 2, 1],
        ["rock", 5, 3, 3, 1],
        ["well", 8, 3, 0, 1],
        ["campfire", 2, 3, 0, 1],
        ["rubble", 6, 4, 1, 1],
        ["table", 10, 2, 0, 1],
        ["tree", 10, 1, 0, 1],
      ],
    ),
  ];
}

/** Draws the build straight onto the board (zoomed in) and through the cached image (zoomed out). */
function drawBoth(r: BuildRenderer): string[] {
  const view = { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
  const direct = fakeCanvas();
  r.draw(direct.getContext("2d")!, scene, view, 2, 2, true);
  const cache = (r as unknown as { cache: (HTMLCanvasElement & { log: string[] }) | null }).cache;
  if (cache) cache.log.length = 0;
  const zoomedOut = fakeCanvas();
  r.draw(zoomedOut.getContext("2d")!, scene, view, 0.3, 0.3, true);
  const painted = (r as unknown as { cache: { log: string[] } }).cache.log;
  // Patterns are made once per canvas: which draw makes them first isn't a difference.
  return [...direct.log, "---", ...zoomedOut.log, "---", ...painted].filter((l) => !l.startsWith("createPattern"));
}

describe("drawing in a season", () => {
  it("says whether anything visible changed", () => {
    const empty = new BuildRenderer();
    expect(empty.setSeason({ look: "winter", level: 2 }, 5)).toBe(false);
    const r = new BuildRenderer();
    r.update(sampleBuild());
    expect(r.setSeason(null, 5)).toBe(false);
    expect(r.setSeason({ look: "winter", level: 2 }, 5)).toBe(true);
    expect(r.setSeason({ look: "winter", level: 2 }, 5)).toBe(false);
    expect(r.setSeason({ look: "winter", level: 3 }, 5)).toBe(true);
    expect(r.setSeason({ look: "winter", level: 3 }, 6)).toBe(true);
    expect(r.setSeason(null, 6)).toBe(true);
    expect(r.setSeason(null, 7)).toBe(false);
  });

  it("without a season draws exactly as before, having had one or not", () => {
    const plain = new BuildRenderer();
    plain.update(sampleBuild());
    const before = drawBoth(plain);
    expect(plain.setSeason(null, 1)).toBe(false);

    const r = new BuildRenderer();
    r.update(sampleBuild());
    r.setSeason({ look: "autumn", level: 3 }, 1);
    const autumn = drawBoth(r);
    expect(autumn).not.toEqual(before);
    r.setSeason(null, 1);
    expect(drawBoth(r)).toEqual(before);
    // The cached image's key is as it always was.
    const k = Math.min(1, 2560 / scene.width, 40 / 70);
    expect((r as unknown as { cacheKey: string }).cacheKey).toBe(`${SCENE}|1400|700|70|0|0|${k}`);
  });

  it("draws every look and level the same way each time", () => {
    for (const look of ["spring", "summer", "autumn", "winter"] as const) {
      for (const level of [1, 2, 3] as const) {
        const a = new BuildRenderer();
        a.update(sampleBuild());
        a.setSeason({ look, level }, 99);
        const b = new BuildRenderer();
        b.update(sampleBuild());
        b.setSeason({ look, level }, 99);
        expect(drawBoth(a)).toEqual(drawBoth(b));
        expect((a as unknown as { cacheKey: string }).cacheKey.endsWith(`|${look}${level}|99`)).toBe(true);
      }
    }
  });

  it("leaves objects indoors as they are, and gives those outdoors the season", () => {
    const r = new BuildRenderer();
    r.update(sampleBuild());
    r.setSeason({ look: "winter", level: 3 }, 3);
    drawBoth(r);
    // The tree in the walled stone room, and the table, stay as they are.
    expect(r.stampLook("tree", 10, 1, 1)).toBeNull();
    expect(r.stampLook("table", 10, 2, 1)).toBeNull();
    // The tree on the grass, and the rock and well on paving near it, don't.
    expect(r.stampLook("tree", 0, 0, 2)).toMatchObject({ look: "winter", level: 3, cover: 3 });
    expect(r.stampLook("rock", 5, 3, 1)?.cover).toBe(3);
    expect(r.stampLook("well", 8, 3, 1)).not.toBeNull();
    // Only in winter for rocks.
    r.setSeason({ look: "autumn", level: 3 }, 3);
    expect(r.stampLook("rock", 5, 3, 1)).toBeNull();
    expect(r.stampLook("bush", 4, 0, 1)).toMatchObject({ look: "autumn", level: 3 });
  });

  it("works out what's outdoors again when the build changes, repainting only the chunk that changed", () => {
    const r = new BuildRenderer();
    // Paving in the next chunk, out of reach of the grass.
    r.update([...sampleBuild(), chunk(["SSSS"], {}, [["rock", 2, 0, 0, 1]], 1, 0)]);
    r.setSeason({ look: "winter", level: 2 }, 3);
    drawBoth(r);
    expect(r.stampLook("rock", 18, 0, 1)).toBeNull();
    // Grass painted beside it: the rock is outdoors now, and only that chunk (with the three
    // cells round it) is repainted, not the chunks next to it as well.
    r.update([...sampleBuild(), chunk(["gSSS"], {}, [["rock", 2, 0, 0, 1]], 1, 0)]);
    const log = drawBoth(r);
    expect(r.stampLook("rock", 18, 0, 1)?.cover).toBe(2);
    const painted = log.slice(log.lastIndexOf("---") + 1);
    // Columns 13 to 34 at 40 pixels a square, cut off at the scene's edge.
    expect(painted.filter((l) => l.startsWith("clearRect("))).toEqual(["clearRect(520,0,280,400)"]);
  });

  it("works out what's outdoors only when the build changes, not when other items do", () => {
    const r = new BuildRenderer();
    const items = sampleBuild();
    r.update(items);
    r.setSeason({ look: "winter", level: 2 }, 3);
    drawBoth(r);
    const index = r.model.index;
    const exposure = (r as unknown as { exposure: unknown }).exposure;
    // The same terrain items again (a token moved, say).
    expect(r.update([...items])).toBe(false);
    drawBoth(r);
    expect(r.model.index).toBe(index);
    expect((r as unknown as { exposure: unknown }).exposure).toBe(exposure);
  });

  it("repaints what the build changed while the season was off, when it comes back", () => {
    const view = { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
    const zoomedIn = (r: BuildRenderer) => r.draw(fakeCanvas().getContext("2d")!, scene, view, 2, 2, true);
    /** Draws zoomed out, and returns the parts of the cached image painted again, as [x, y, width, height]. */
    const repainted = (r: BuildRenderer): number[][] => {
      const cache = () => (r as unknown as { cache: { log: string[] } | null }).cache;
      if (cache()) cache()!.log.length = 0;
      r.draw(fakeCanvas().getContext("2d")!, scene, view, 0.3, 0.3, true);
      return cache()!
        .log.filter((l) => l.startsWith("clearRect("))
        .map((l) => l.slice(10, -1).split(",").map(Number));
    };
    // Two chunks of paving. With the season off and the board zoomed in (so the cached image
    // isn't painted), grass is painted at the end of the first; then the same season again.
    const pave = Array<string>(10).fill("S".repeat(16));
    const r = new BuildRenderer();
    r.update([chunk(pave, {}, [], 0, 0), chunk(pave, {}, [], 1, 0)]);
    r.setSeason({ look: "winter", level: 3 }, 7);
    repainted(r);
    r.setSeason(null, 7);
    zoomedIn(r);
    r.update([chunk(pave.map((l) => l.slice(0, 15) + "g"), {}, [], 0, 0), chunk(pave, {}, [], 1, 0)]);
    zoomedIn(r);
    r.setSeason({ look: "winter", level: 3 }, 7);
    zoomedIn(r);
    // The snow now reaching columns 16 to 21 is painted into the cached image (the scene
    // ends at column 20, 800 pixels).
    expect(repainted(r).some(([x, , w]) => x <= 16 * 40 && x + w >= 800)).toBe(true);
  });

  it("previews a tree or bush as it will look once placed", () => {
    // No build yet, over an uploaded map: a tree makes its own square outdoors.
    const r = new BuildRenderer();
    r.setSeason({ look: "winter", level: 3 }, 5);
    expect(r.stampLook("tree", 5, 5, 1)).toMatchObject({ look: "winter", level: 3, cover: 3 });
    // A bush on a paved square far from any grass.
    const plaza = new BuildRenderer();
    plaza.update(area(16, 16, () => "S"));
    plaza.setSeason({ look: "autumn", level: 2 }, 5);
    drawBoth(plaza);
    expect(plaza.stampLook("bush", 10, 10, 1)).toMatchObject({ look: "autumn", level: 2 });
    // But not in a walled room, or on water or lava no grass reaches; and a rock still needs grass.
    const room = new BuildRenderer();
    room.update([chunk(["sss", "aal", "SSS"])]);
    room.setSeason({ look: "winter", level: 3 }, 5);
    drawBoth(room);
    expect(room.stampLook("tree", 0, 0, 1)).toBeNull();
    expect(room.stampLook("tree", 0, 1, 1)).toBeNull();
    expect(room.stampLook("bush", 2, 1, 1)).toBeNull();
    expect(room.stampLook("rock", 0, 2, 1)).toBeNull();
    expect(room.stampLook("tree", 0, 2, 1)).not.toBeNull();
  });
});

// ---------------------------------------------------------------- seasonal trees and bushes

/** The colour family of a "#rrggbb" colour, by its hue: 0 green, 1 yellow, 2 orange, 3 red, or -1 for none of those. */
function family(color: string): number {
  if (!/^#[0-9a-f]{6}$/.test(color)) return -1;
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return hue < 18 ? 3 : hue < 36 ? 2 : hue < 60 ? 1 : hue < 160 ? 0 : -1;
}

/** Draws an object and returns its fills, each as the colour and the path filled. */
function fills(id: "tree" | "bush", look: StampLook | null, turns = 0): { color: string; path: string }[] {
  const out: { color: string; path: string }[] = [];
  let color = "";
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, p) => (p === "fill" ? (path: unknown) => out.push({ color, path: fmt(path) }) : () => {}),
    set: (_t, p, v) => {
      if (p === "fillStyle") color = v as string;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  drawStamp(ctx, id, look, turns);
  return out;
}

/** An autumn tree's or bush's clumps (each a curved outline in a fill), by colour family, and how many are left. */
function autumnClumps(id: "tree" | "bush", level: 1 | 2 | 3, hash: number): { byFamily: number[]; kept: number; mix: string } {
  const clumps = (path: string) => (path.includes("quadraticCurveTo") ? path.split("moveTo(").length - 1 : 0);
  const all = fills(id, { look: "autumn", level, hash, cover: 0 }).filter((f) => family(f.color) >= 0 && clumps(f.path));
  const byFamily = [0, 0, 0, 0];
  for (const f of all) byFamily[family(f.color)] += clumps(f.path);
  // Which clumps are which colour.
  const mix = all.map((f) => `${family(f.color)}:${f.path}`).sort().join();
  return { byFamily, kept: byFamily.reduce((a, b) => a + b), mix };
}

describe("autumn trees and bushes as drawn", () => {
  const varieties = Array.from({ length: 64 }, (_, v) => (v + 0.5) / 64);

  for (const id of ["tree", "bush"] as const) {
    it(`every ${id} is a mottled mix of red, orange, yellow and green, never more than a third red, thinner each level`, () => {
      const kept = [0, 0, 0];
      for (const level of [1, 2, 3] as const) {
        const mixes = new Set<string>();
        for (const h of varieties) {
          const { byFamily, kept: n, mix } = autumnClumps(id, level, h);
          expect(Math.min(...byFamily), `${id} level ${level} hash ${h}: ${byFamily}`).toBeGreaterThanOrEqual(1);
          expect(byFamily[3]).toBeLessThanOrEqual(n / 3);
          kept[level - 1] += n;
          mixes.add(mix);
        }
        // Each its own mix.
        expect(mixes.size).toBeGreaterThan(60);
      }
      expect(kept[0]).toBeGreaterThan(kept[1]);
      expect(kept[1]).toBeGreaterThan(kept[2]);
    });
  }
});

describe("remembered drawings", () => {
  const PATH_OPS = new Set(["moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "arc", "ellipse", "rect", "roundRect", "closePath"]);
  /** A drawing's calls, with each path written out where it's filled or stroked (as a remembered drawing does it). */
  function flatten(log: string[]): string[] {
    const out: string[] = [];
    let path: string[] = [];
    for (const l of log) {
      const name = l.slice(0, l.indexOf("("));
      if (l === "beginPath()") path = [];
      else if (PATH_OPS.has(name)) path.push(l);
      else if (l === "fill()" || l === "stroke()") out.push(`${name}(path{${path.join(";")}})`);
      else out.push(l);
    }
    return out;
  }
  const draw = (id: StampId, look: StampLook, turns: number, fine = 0) => {
    const c = fakeCanvas();
    drawStamp(c.getContext("2d")!, id, look, turns, fine);
    return c.log;
  };

  it("draws a tree or bush exactly as drawing it straight onto the canvas would", () => {
    for (const id of ["tree", "bush"] as const) {
      for (const look of ["spring", "summer", "autumn", "winter"] as const) {
        for (const level of [1, 2, 3] as const) {
          for (const [hash, turns] of [
            [0.01, 0],
            [0.3, 1],
            [0.55, 2],
            [0.9, 3],
          ]) {
            const s: StampLook = { look, level, hash, cover: 2 };
            const kept = draw(id, s, turns);
            g.Path2D = undefined;
            try {
              expect(kept, `${id} ${look}${level} ${hash}`).toEqual(flatten(draw(id, s, turns)));
            } finally {
              g.Path2D = FakePath;
            }
          }
        }
      }
    }
  });

  it("has 64 varieties of each, and only in winter does the way it's turned matter", () => {
    const autumn = new Set(Array.from({ length: 500 }, (_, i) => draw("tree", { look: "autumn", level: 2, hash: (i * 0.618034) % 1, cover: 0 }, 0).join()));
    expect(autumn.size).toBeGreaterThan(55);
    expect(autumn.size).toBeLessThanOrEqual(64);
    const look = (l: "autumn" | "winter"): StampLook => ({ look: l, level: 2, hash: 0.4, cover: 0 });
    expect(draw("bush", look("autumn"), 1)).toEqual(draw("bush", look("autumn"), 0));
    expect(draw("bush", look("winter"), 1)).not.toEqual(draw("bush", look("winter"), 0));
    // Nor does the ground round it (snow on it is for rocks and wells).
    expect(draw("tree", { ...look("winter"), cover: 1 }, 2)).toEqual(draw("tree", { ...look("winter"), cover: 3 }, 2));
  });

  it("draws one turned finer exactly as drawing it straight onto the canvas would", () => {
    for (const id of ["tree", "bush"] as const) {
      for (const level of [1, 2, 3] as const) {
        for (const [turns, fine] of [
          [1, 20],
          [3, 85],
          [0, 45],
        ]) {
          const s: StampLook = { look: "winter", level, hash: 0.37, cover: 2 };
          const kept = draw(id, s, turns, fine);
          g.Path2D = undefined;
          try {
            expect(kept, `${id} winter${level} ${turns} ${fine}`).toEqual(flatten(draw(id, s, turns, fine)));
          } finally {
            g.Path2D = FakePath;
          }
        }
      }
    }
  });

  it("in winter, draws trees and bushes turned to the nearest 30 degrees; rocks, rubble and wells exactly", () => {
    const winter: StampLook = { look: "winter", level: 2, hash: 0.4, cover: 3 };
    for (const id of ["tree", "bush"] as const) {
      expect(draw(id, winter, 1, 10)).toEqual(draw(id, winter, 1, 0));
      expect(draw(id, winter, 1, 20)).not.toEqual(draw(id, winter, 1, 0));
      expect(draw(id, winter, 1, 20)).toEqual(draw(id, winter, 1, 40));
      // 85 degrees on is nearest the next quarter turn.
      expect(draw(id, winter, 1, 85)).toEqual(draw(id, winter, 2, 0));
      expect(draw(id, winter, 3, 85)).toEqual(draw(id, winter, 0, 0));
      // In another look the way it's turned doesn't matter at all.
      const autumn: StampLook = { ...winter, look: "autumn" };
      expect(draw(id, autumn, 1, 20)).toEqual(draw(id, autumn, 0, 0));
    }
    for (const id of ["rock", "rubble", "well"] as const) {
      expect(draw(id, winter, 1, 10), id).not.toEqual(draw(id, winter, 1, 0));
      expect(draw(id, winter, 1, 0)).toEqual(draw(id, winter, 1));
    }
  });
});

describe("objects turned to any 5 degrees", () => {
  it("counter-rotate the way to the light at any angle, exactly as before for quarter turns", () => {
    for (let deg = 0; deg < 360; deg += 5) {
      const [x, y] = mapToStampDeg(-Math.SQRT1_2, -Math.SQRT1_2, deg);
      // Turned back onto the map with the object, it points to the top left again.
      const a = (deg * Math.PI) / 180;
      expect(x * Math.cos(a) - y * Math.sin(a)).toBeCloseTo(-Math.SQRT1_2, 9);
      expect(x * Math.sin(a) + y * Math.cos(a)).toBeCloseTo(-Math.SQRT1_2, 9);
      if (deg % 90 === 0) expect(mapToStampDeg(0.3, -0.8, deg)).toEqual(mapToStamp(0.3, -0.8, deg / 90));
    }
  });

  it("are drawn turned and sized about their block's middle, and ones turned by quarter turns exactly as they always were", () => {
    const calls: [string, unknown[]][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, p) => (...a: unknown[]) => calls.push([String(p), a]),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const r = new BuildRenderer();
    r.update([chunk([], {}, [["table", 3, 2, 3, 2], ["chair", 6, 1, 2, 1], ["table", 9, 2, 0, 1.5, 15], ["rock", 12, 3, 1, 0.5, 85]])]);
    r.draw(ctx, scene, { x0: 0, y0: 0, x1: scene.width, y1: scene.height }, 2, 2, true);
    // Each object: the canvas saved, moved, turned and scaled, then its drawing.
    const placed = calls.flatMap(([name, a], i) =>
      name === "translate" && calls[i - 1][0] === "save" && calls[i + 1][0] === "rotate" && calls[i + 2][0] === "scale" ? [[a, calls[i + 1][1], calls[i + 2][1]]] : [],
    );
    expect(placed).toEqual([
      [[280, 210], [(3 * Math.PI) / 2], [140, 140]],
      [[455, 105], [(2 * Math.PI) / 2], [70, 70]],
      [[700, 210], [(15 * Math.PI) / 180], [105, 105]],
      [[875, 245], [Math.PI / 2 + (85 * Math.PI) / 180], [35, 35]],
    ]);
  });
});

describe("objects drawn past the squares they stand on", () => {
  const big = { id: SCENE, width: 40 * 70, height: 40 * 70, grid: { type: "square", size: 70, offsetX: 0, offsetY: 0 } } as unknown as Scene;
  const whole = { x0: 0, y0: 0, x1: big.width, y1: big.height };
  /** The middles (in cells) of the objects drawn straight onto the board over part of the scene. */
  const drawnOver = (r: BuildRenderer, view: { x0: number; y0: number; x1: number; y1: number }): string[] => {
    const calls: [string, unknown[]][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, p) => (...a: unknown[]) => calls.push([String(p), a]),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    r.draw(ctx, big, view, 2, 2, true);
    return calls.flatMap(([name, a], i) =>
      name === "translate" && calls[i - 1][0] === "save" && calls[i + 1][0] === "rotate" ? [`${(a[0] as number) / 70},${(a[1] as number) / 70}`] : [],
    );
  };

  it("are drawn wherever they reach into what's on screen: up to three squares on from their corner", () => {
    const r = new BuildRenderer();
    r.update([
      // 3 squares at 45 degrees: from one square before its corner to three after.
      chunk([], {}, [["table", 15, 15, 0, 3, 45], ["table", 15, 14, 0, 3, 45], ["table", 14, 15, 0, 3, 45]]),
      // 1 1/4 squares, not turned: a little past its one square all round.
      chunk([], {}, [["chair", 1, 1, 0, 1.25], ["chair", 0, 1, 0, 1.25]], 1, 1),
    ]);
    // The screen shows from square 19 on (so from 18, with the margin), both ways.
    expect(drawnOver(r, { x0: 19 * 70, y0: 19 * 70, x1: big.width, y1: big.height })).toEqual(["16.5,16.5", "17.5,17.5"]);
    expect(drawnOver(r, whole)).toHaveLength(5);
  });

  it("and up to one square before it", () => {
    const r = new BuildRenderer();
    r.update([chunk([], {}, [["rock", 3, 3, 0, 1]]), chunk([], {}, [["table", 0, 0, 0, 3, 45], ["table", 1, 0, 0, 3, 45], ["chair", 0, 0, 0, 1.25]], 1, 1)]);
    // The screen shows up to square 14 (so to 15, with the margin), both ways.
    expect(drawnOver(r, { x0: 0, y0: 0, x1: 14 * 70, y1: 14 * 70 })).toEqual(["3.5,3.5", "17.5,17.5", "16.5,16.5"]);
  });

  /** Draws zoomed out, and returns the parts of the cached image painted again, and the objects painted. */
  const repainted = (r: BuildRenderer): { cleared: number[][]; drawn: string[] } => {
    const cache = () => (r as unknown as { cache: { log: string[] } | null }).cache;
    if (cache()) cache()!.log.length = 0;
    r.draw(fakeCanvas().getContext("2d")!, big, whole, 0.3, 0.3, true);
    const log = cache()!.log;
    return {
      cleared: log.filter((l) => l.startsWith("clearRect(")).map((l) => l.slice(10, -1).split(",").map(Number)),
      drawn: log.filter((l, i) => l.startsWith("translate(") && log[i - 1] === "save()" && log[i + 1]?.startsWith("rotate(")),
    };
  };

  it("are painted whole into the cached image when anything in their chunk, or under them, changes", () => {
    const r = new BuildRenderer();
    const table: Stamp = ["table", 15, 15, 0, 3, 45];
    r.update([chunk([], {}, [table]), chunk([], {}, [], 1, 1)]);
    repainted(r);
    // A rock put in the table's chunk: squares -3 to 18 (the table reaches 18) at 40 pixels a square.
    r.update([chunk([], {}, [table, ["rock", 2, 2, 0, 1]]), chunk([], {}, [], 1, 1)]);
    const own = repainted(r);
    expect(own.cleared).toEqual([[0, 0, 760, 760]]);
    expect(own.drawn).toEqual(["translate(1155,1155)", "translate(175,175)"]);
    // Grass under the table's corner, in the next chunk: squares 13 to 34, the whole table in them.
    r.update([chunk([], {}, [table, ["rock", 2, 2, 0, 1]]), chunk(["g"], {}, [], 1, 1)]);
    const next = repainted(r);
    expect(next.cleared).toEqual([[520, 520, 880, 880]]);
    expect(next.drawn).toEqual(["translate(1155,1155)"]);
  });

  it("are painted again where their shadows reach, just past the squares they're drawn on", () => {
    // A tree's shadow falls a little below and right of its square. With the tree in row 12,
    // grass in the chunk below repaints rows 13 on: the tree is painted too (clipped to those
    // rows), or the top of its shadow there would be wiped out.
    const r = new BuildRenderer();
    const tree: Stamp = ["tree", 6, 12, 0, 1];
    r.update([chunk([], {}, [tree]), chunk([], {}, [], 0, 1)]);
    repainted(r);
    r.update([chunk([], {}, [tree]), chunk(["g"], {}, [], 0, 1)]);
    const below = repainted(r);
    expect(below.cleared).toEqual([[0, 520, 760, 880]]);
    expect(below.drawn).toEqual(["translate(455,875)"]);
    // The same for one in column 12, with grass in the chunk to the right (columns 13 on).
    const left: Stamp = ["tree", 12, 3, 0, 1];
    r.update([chunk([], {}, [left]), chunk([], {}, [], 1, 0)]);
    repainted(r);
    r.update([chunk([], {}, [left]), chunk(["g"], {}, [], 1, 0)]);
    const right = repainted(r);
    expect(right.cleared).toEqual([[520, 0, 880, 760]]);
    expect(right.drawn).toEqual(["translate(875,245)"]);
  });

  it("look the season of the squares they stand on", () => {
    const r = new BuildRenderer();
    r.update(sampleBuild());
    r.setSeason({ look: "winter", level: 3 }, 3);
    drawBoth(r);
    // The 2-square tree on the grass, as 2 1/4 squares, and as 1 1/4 standing on one of its squares.
    expect(r.lookFor({ id: "tree", col: 0, row: 0, deg: 15, size: 2.25 })).toEqual(r.stampLook("tree", 0, 0, 2));
    expect(r.lookFor({ id: "tree", col: 0, row: 0, deg: 0, size: 1.25 })).toEqual(r.stampLook("tree", 0, 0, 1));
    expect(r.lookFor({ id: "tree", col: 10, row: 1, deg: 0, size: 0.5 })).toBeNull();
  });
});

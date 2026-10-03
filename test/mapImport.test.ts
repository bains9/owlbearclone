import { describe, expect, it } from "vitest";
import {
  gridFromName,
  gridSizeFor,
  isDungeondraftProject,
  looksLikeMap,
  MAP_FILE_ACCEPT,
  nameFromFile,
  parseUniversalVtt,
  readMapFiles,
} from "../src/client/mapImport";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("grid from a file name", () => {
  it("reads cells across and down", () => {
    expect(gridFromName("Tavern_30x20.jpg")).toEqual({ cols: 30, rows: 20 });
    expect(gridFromName("Crypt [22x30].png")).toEqual({ cols: 22, rows: 30 });
    expect(gridFromName("forest (35 x 25) 140ppi.webp")).toEqual({ cols: 35, rows: 25, pxPerCell: 140 });
    expect(gridFromName("cave-70px.png")).toEqual({ pxPerCell: 70 });
  });

  it("ignores image sizes and plain names", () => {
    expect(gridFromName("Dungeon 4096x2048.png")).toEqual({});
    expect(gridFromName("Goblin Cave.png")).toEqual({});
    expect(gridFromName("map v2.1x3.png")).toEqual({});
  });

  it("turns the numbers round when the image says so", () => {
    // 20x30 on a wide image: 30 across and 20 down gives square cells.
    expect(gridFromName("Hall 20x30.jpg", 4200, 2800)).toEqual({ cols: 30, rows: 20 });
    expect(gridFromName("Hall 30x20.jpg", 4200, 2800)).toEqual({ cols: 30, rows: 20 });
  });
});

describe("files that aren't maps yet", () => {
  it("points old Owlbear Rodeo 1 exports at Owlbear's converter", async () => {
    const { maps, errors } = await readMapFiles([new File(["{}"], "abc123.owlbear")]);
    expect(maps).toEqual([]);
    expect(errors[0]).toMatch(/1to2\.owlbear\.app/);
  });

  it("asks for Dungeondraft's export when given its project file", async () => {
    const { maps, errors } = await readMapFiles([new File(["{}"], "Kdir Topside.dungeondraft_map")]);
    expect(maps).toEqual([]);
    expect(errors).toEqual([
      "Kdir Topside.dungeondraft_map is Dungeondraft's project file, which has no picture in it. In Dungeondraft, export the map as Universal VTT (.dd2vtt) and bring that in instead.",
    ]);
  });

  it("sends a dropped or picked project file to the New scene window, where it gets that message", async () => {
    expect(await looksLikeMap(new File(["{}"], "waterfall.DUNGEONDRAFT_MAP"))).toBe(true);
    expect(isDungeondraftProject(new File(["{}"], "waterfall.dungeondraft_map.png"))).toBe(false);
    expect(MAP_FILE_ACCEPT.split(",")).toContain(".dungeondraft_map");
  });
});

describe("scene name from a file name", () => {
  it("drops grid sizes, grid words and underscores", () => {
    expect(nameFromFile("Goblin_Cave_30x20_gridless.jpg")).toBe("Goblin Cave");
    expect(nameFromFile("Crypt [22x30] 140ppi.png")).toBe("Crypt");
    expect(nameFromFile("Tavern - Night (30x20).webp")).toBe("Tavern Night");
    expect(nameFromFile("30x20.png")).toBe("30x20");
  });
});

describe("grid size on the uploaded image", () => {
  it("scales a known grid to an image that was shrunk", () => {
    const map = { name: "m", image: new File([], "m.png"), pxPerCell: 256, cols: 40, rows: 30, width: 10240, height: 7680 };
    // Shrunk to 6144 across: 6144 / 40 cells.
    expect(gridSizeFor(map, 6144, 4608)).toBe(153.6);
  });

  it("uses cells from the name", () => {
    const map = { name: "m", image: new File([], "m.png"), cols: 30, rows: 20 };
    expect(gridSizeFor(map, 2100, 1400, { width: 2100, height: 1400 })).toBe(70);
  });

  it("uses pixels per cell from the name, scaled", () => {
    const map = { name: "m", image: new File([], "m.png"), pxPerCell: 140 };
    expect(gridSizeFor(map, 3072, 2048, { width: 6144, height: 4096 })).toBe(70);
  });

  it("ignores a name whose numbers don't fit the image", () => {
    // "Room 3x4" on a wide 2:1 image can't be 3 by 4 square cells, either way round.
    const map = { name: "m", image: new File([], "m.png"), cols: 3, rows: 4 };
    expect(gridSizeFor(map, 2000, 1000, { width: 2000, height: 1000 })).toBeNull();
    // Rows and columns the other way round from the image are fine.
    const tall = { name: "m", image: new File([], "m.png"), cols: 32, rows: 44 };
    expect(gridSizeFor(tall, 3168, 2304, { width: 3168, height: 2304 })).toBe(72);
    // A print resolution is not a grid.
    const print = { name: "m", image: new File([], "m.png"), pxPerCell: 300 };
    expect(gridSizeFor(print, 600, 400, { width: 600, height: 400 })).toBeNull();
  });

  it("reads real map makers' names", () => {
    expect(gridFromName("Mana Tree - Spirit - 32x44 - 72 DPI.jpg")).toEqual({ cols: 32, rows: 44, pxPerCell: 72 });
    expect(gridFromName("frigate-composite_100dpi.jpg")).toEqual({ pxPerCell: 100 });
    expect(gridFromName("fortress_of_doom(30x25-3000x2500-gridless).jpeg")).toEqual({ cols: 30, rows: 25 });
    expect(gridFromName("Pirate Cave [35×25].webp")).toEqual({ cols: 35, rows: 25 });
  });

  it("says nothing without a hint", () => {
    expect(gridSizeFor({ name: "m", image: new File([], "m.png") }, 2000, 1000)).toBeNull();
  });
});

describe("Universal VTT files", () => {
  const vtt = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 30, y: 20 }, pixels_per_grid: 256 },
      line_of_sight: [],
      portals: [],
      lights: [],
      image: PNG_1x1,
      ...extra,
    });

  it("reads the image and the grid", () => {
    const map = parseUniversalVtt(vtt(), "Goblin_Cave.dd2vtt");
    expect(map.name).toBe("Goblin Cave");
    expect(map.image.type).toBe("image/png");
    expect(map.image.name).toBe("Goblin Cave.png");
    expect(map).toMatchObject({ cols: 30, rows: 20, pxPerCell: 256, width: 7680, height: 5120, offsetX: 0, offsetY: 0 });
    expect(gridSizeFor(map, 6144, 4096)).toBe(204.8);
  });

  it("moves the grid for a map that starts part-way into a cell", () => {
    const map = parseUniversalVtt(
      vtt({ resolution: { map_origin: { x: -2.25, y: 0.5 }, map_size: { x: 10, y: 10 }, pixels_per_grid: 100 } }),
      "x.uvtt",
    );
    expect(map.offsetX).toBeCloseTo(25);
    expect(map.offsetY).toBeCloseTo(50);
  });

  it("refuses files that aren't maps", () => {
    expect(() => parseUniversalVtt("not json", "x.dd2vtt")).toThrow();
    expect(() => parseUniversalVtt(JSON.stringify({ hello: 1 }), "x.json")).toThrow();
  });

  it("reads files from other tools too", () => {
    // Arkenforge writes format 1.0, CRLF line ends and extra fields; a byte-order mark shouldn't matter.
    const text = "﻿" + vtt({ format: 1.0, software: "Arkenforge", creator: "Nathan" }).replace(/,/g, ",\r\n");
    expect(parseUniversalVtt(text, "Pig and Whistle.uvtt")).toMatchObject({ name: "Pig and Whistle", cols: 30, rows: 20 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VTT_META_POINTS as EXTRACT_VTT_META_POINTS } from "../src/client/dd/extract";
import type { AttachReport } from "../src/client/dd/extract";
import * as attach from "../src/client/dd/attach";
import { DEFAULT_LIMITS } from "../src/client/dd/model";
import { attachNote, describeShift, importFiles, touchedSidecars } from "../src/client/importScenes";
import {
  dungeondraftSquares,
  gridFromName,
  gridSizeFor,
  isDungeondraftFile,
  loneProjectFileNote,
  looksLikeMap,
  MAP_FILE_ACCEPT,
  MAX_MAP_SIDE,
  nameFromFile,
  pairDungeondraft,
  parseUniversalVtt,
  pictureFitsMap,
  readMapFiles,
  sortDroppedFiles,
  VTT_META_POINTS,
} from "../src/client/mapImport";
import { RoomClient } from "../src/client/room/client";
import type { Asset, Scene } from "../src/shared/types";
import { snowyMap } from "./fixtures/ddSynthetic";
import { waterfallText } from "./helpers/ddFixtures";

// The attach path (the dd worker) is WP3b's and tested in ddAttach.test.ts; here it answers what a test says.
vi.mock("../src/client/dd/attach", () => {
  class AttachError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AttachError";
    }
  }
  return { AttachError, prepareAttach: vi.fn(), uploadSidecar: vi.fn(), cleanUpSidecars: vi.fn(async () => 0) };
});

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** A fake image file whose "pixels" are its size, which the stubbed createImageBitmap reads back. */
const img = (name: string, width: number, height: number, type = "image/png") => new File([`${width}x${height}`], name, { type });
/** A Dungeondraft project file of `w` x `h` squares, as the real ones start (header, then world). */
const ddText = (w: number, h: number) =>
  `{\n\t"header": {\n\t\t"creation_build": "1.2.0.1 opulent kirin",\n\t\t"asset_manifest": []\n\t},\n\t"world": {\n\t\t"format": 3,\n\t\t"width": ${w},\n\t\t"height": ${h},\n\t\t"levels": {}\n\t}\n}`;
const dd = (name: string, w = 50, h = 35) => new File([ddText(w, h)], name);

beforeEach(() => {
  vi.stubGlobal("createImageBitmap", async (f: File) => {
    const m = /^(\d+)x(\d+)$/.exec(await f.text());
    if (!m) throw new Error("not an image");
    return { width: Number(m[1]), height: Number(m[2]), close() {} };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(attach.prepareAttach).mockReset();
  vi.mocked(attach.uploadSidecar).mockReset();
  vi.mocked(attach.cleanUpSidecars).mockClear();
  touchedSidecars.clear();
});

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

  it("tells a project file with no picture in the batch to bring both files, or to attach it to a scene (6.1)", async () => {
    const { maps, errors } = await readMapFiles([dd("Kdir Topside.dungeondraft_map")]);
    expect(maps).toEqual([]);
    expect(errors).toEqual([
      "Kdir Topside.dungeondraft_map has no picture in it (it's Dungeondraft's project file). Export the map from Dungeondraft and bring in both files, or attach it to a scene with Edit scene › Map.",
    ]);
    expect(errors[0]).toBe(loneProjectFileNote("Kdir Topside.dungeondraft_map"));
    expect(errors[0]).not.toMatch(/Universal VTT/);
  });
});

describe("Dungeondraft project files", () => {
  it("knows one by its name, whatever the case, and the picker offers it", async () => {
    expect(await isDungeondraftFile(new File(["{}"], "waterfall.DUNGEONDRAFT_MAP"))).toBe(true);
    expect(await looksLikeMap(new File(["{}"], "waterfall.dungeondraft_map"))).toBe(true);
    expect(MAP_FILE_ACCEPT.split(",")).toContain(".dungeondraft_map");
  });

  it("knows one renamed without its extension by its first bytes, and nothing else", async () => {
    expect(await isDungeondraftFile(new File([ddText(20, 12)], "waterfall.json"))).toBe(true);
    expect(await isDungeondraftFile(new File([ddText(20, 12)], "waterfall"))).toBe(true);
    expect(await isDungeondraftFile(new File(["﻿  " + ddText(20, 12)], "waterfall.txt"))).toBe(false);
    expect(await isDungeondraftFile(new File(["﻿  " + ddText(20, 12)], "waterfall.json"))).toBe(true);
    expect(await isDungeondraftFile(new File([waterfallText()], "waterfall.json"))).toBe(true);
    // Not a project file: a Universal VTT file, an image, other JSON, a picture whose name only mentions one.
    expect(await isDungeondraftFile(new File([`{"format":0.3,"resolution":{}}`], "waterfall.dd2vtt"))).toBe(false);
    expect(await isDungeondraftFile(new File([ddText(20, 12)], "waterfall.png", { type: "image/png" }))).toBe(false);
    expect(await isDungeondraftFile(new File([`{"hello": 1}`], "notes.json"))).toBe(false);
    expect(await isDungeondraftFile(new File(["{}"], "waterfall.dungeondraft_map.png"))).toBe(false);
    // Another app's JSON whose first key happens to be "header": nothing of Dungeondraft's in it.
    const other = `{"header": {"version": "2.1", "app": "Some Other Tool"}, "tiles": [], "notes": "the world is round"}`;
    expect(await isDungeondraftFile(new File([other], "export.json"))).toBe(false);
    expect(await isDungeondraftFile(new File([other], "export"))).toBe(false);
  });

  it("reads the map's size in squares from the start of the file", async () => {
    expect(await dungeondraftSquares(dd("w.dungeondraft_map", 50, 35))).toEqual({ w: 50, h: 35 });
    expect(await dungeondraftSquares(new File([waterfallText()], "waterfall.dungeondraft_map"))).toEqual({ w: 50, h: 35 });
    expect(await dungeondraftSquares(new File([snowyMap().text], "snowy.dungeondraft_map"))).toEqual({ w: 20, h: 12 });
    expect(await dungeondraftSquares(new File(["{ not json"], "notes.dungeondraft_map"))).toBeNull();
    expect(await dungeondraftSquares(new File([`{"header":{},"world":{"format":3,"width":0,"height":35}}`], "x.dungeondraft_map"))).toBeNull();
    // Only sizes the parser would accept: a side past its limit, or absurd ("9" four hundred times), is no size.
    expect(MAX_MAP_SIDE).toBe(DEFAULT_LIMITS.maxSide);
    expect(await dungeondraftSquares(dd("big.dungeondraft_map", MAX_MAP_SIDE, MAX_MAP_SIDE))).toEqual({ w: MAX_MAP_SIDE, h: MAX_MAP_SIDE });
    expect(await dungeondraftSquares(dd("big.dungeondraft_map", MAX_MAP_SIDE + 1, 35))).toBeNull();
    expect(await dungeondraftSquares(new File([ddText(50, 35).replace('"width": 50', `"width": ${"9".repeat(400)}`)], "x.dungeondraft_map"))).toBeNull();
  });

  it("says whether a picture could be an export of a map of so many squares (pairing rule 3)", () => {
    const map = { w: 50, h: 35 };
    // Vern's waterfall export: 3600 x 2520 at 72 px a square.
    expect(pictureFitsMap({ width: 3600, height: 2520 }, map)).toBe(true);
    expect(pictureFitsMap({ width: 1800, height: 1261 }, map)).toBe(true);
    expect(pictureFitsMap({ width: 3456, height: 1944 }, map)).toBe(false);
    expect(pictureFitsMap({ width: 0, height: 0 }, map)).toBe(false);
    // With the export's rectangle (a .dd2vtt's map_size, or the scene's mapRect): it must fit inside the map.
    expect(pictureFitsMap({ width: 3456, height: 1944 }, map, [0, 0, 48, 27])).toBe(true);
    expect(pictureFitsMap({ width: 3456, height: 1944 }, map, [2, 1, 48, 35])).toBe(true);
    expect(pictureFitsMap({ width: 3456, height: 1944 }, map, [0, 0, 60, 27])).toBe(false);
    expect(pictureFitsMap({ width: 3456, height: 1944 }, map, [0, 0, 0, 27])).toBe(false);
  });

  it("keeps as many VTT points as the extractor expects", () => {
    expect(VTT_META_POINTS).toBe(EXTRACT_VTT_META_POINTS);
  });
});

describe("pairing project files with their exports", () => {
  it("pairs by name, with export suffixes and the level stripped, and leaves the other pictures alone", async () => {
    const pics = [img("Waterfall_export.png", 3600, 2520), img("Tavern.png", 2100, 1400)];
    const ddf = dd("waterfall.dungeondraft_map");
    const r = await pairDungeondraft([ddf, ...pics]);
    expect(r.pairs).toEqual([{ picture: pics[0], dd: ddf }]);
    expect(r.lone).toEqual([]);
    expect(r.pictures).toEqual([pics[1]]);
    for (const name of ["waterfall.vtt.dd2vtt", "Waterfall - Ground.png", "waterfall_Ground.webp", "waterfall (1).png", "waterfall_50x35.jpg", "WATERFALL.PNG"]) {
      const p = /\.dd2vtt$/.test(name) ? new File(["{}"], name) : img(name, 100, 100);
      const other = img("other.png", 100, 100);
      const got = await pairDungeondraft([p, ddf, other]);
      expect(got.pairs, name).toEqual([{ picture: p, dd: ddf }]);
      expect(got.pictures, name).toEqual([other]);
    }
    // Both the .dd2vtt and a PNG of the same map: the .dd2vtt, which says which level it shows.
    const both = [img("waterfall.png", 3600, 2520), new File(["{}"], "waterfall.dd2vtt")];
    expect((await pairDungeondraft([...both, ddf])).pairs).toEqual([{ picture: both[1], dd: ddf }]);
  });

  it("pairs a map exported level by level with every level's picture: one scene per level (6.5)", async () => {
    const ground = img("Tavern - Ground.png", 3600, 2520);
    const roof = img("Tavern - Roof.png", 3600, 2520);
    const ddf = dd("Tavern.dungeondraft_map");
    const r = await pairDungeondraft([ground, roof, ddf]);
    expect(r.pairs).toEqual([{ picture: ground, dd: ddf }, { picture: roof, dd: ddf }]);
    expect(r.lone).toEqual([]);
    expect(r.pictures).toEqual([]);
    // Levels as .dd2vtt files, with a plain PNG of one of them beside: the PNG is left a picture.
    const groundVtt = new File(["{}"], "Tavern - Ground.dd2vtt");
    const roofVtt = new File(["{}"], "Tavern - Roof.dd2vtt");
    const r2 = await pairDungeondraft([ground, groundVtt, roofVtt, ddf]);
    expect(r2.pairs).toEqual([{ picture: groundVtt, dd: ddf }, { picture: roofVtt, dd: ddf }]);
    expect(r2.pictures).toEqual([ground]);
    // The project file is never a lone one when its pictures are there, so readMapFiles reports nothing.
    const { maps, errors } = await readMapFiles([ground, roof, ddf]);
    expect(errors).toEqual([]);
    expect(maps.map((m) => [m.name, m.dd])).toEqual([["Tavern Ground", ddf], ["Tavern Roof", ddf]]);
  });

  it("measures each picture once, however many project files are waiting, and reads a .dd2vtt once for pairing and reading", async () => {
    let decodes = 0;
    const bitmap = createImageBitmap;
    vi.stubGlobal("createImageBitmap", async (f: File) => {
      decodes++;
      return bitmap(f);
    });
    const pictures = Array.from({ length: 20 }, (_, i) => img(`p${i}.png`, 1000 + i, 1000));
    const dds = Array.from({ length: 5 }, (_, i) => dd(`m${i}.dungeondraft_map`, 60 + i, 60));
    const r = await pairDungeondraft([...pictures, ...dds]);
    expect(r.pairs).toEqual([]);
    expect(r.lone).toEqual(dds);
    expect(decodes).toBe(20);
    // The same files again (dropped on the board, then read for the New scene window): the sizes are kept.
    await pairDungeondraft([...pictures, ...dds]);
    expect(decodes).toBe(20);

    const vtt = new File(
      [JSON.stringify({ resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 48, y: 27 }, pixels_per_grid: 72 }, image: PNG_1x1 })],
      "export.dd2vtt",
    );
    const reads = vi.spyOn(vtt, "text");
    const { maps } = await readMapFiles([vtt, img("other.png", 1000, 1000), dd("kdir.dungeondraft_map", 50, 35)]);
    expect(maps[0].dd).toBeDefined();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("pairs the only picture with the only project file, whatever their names", async () => {
    const p = img("Tavern.png", 100, 100);
    const ddf = dd("kdir.dungeondraft_map", 48, 27);
    expect(await pairDungeondraft([p, ddf])).toEqual({ pairs: [{ picture: p, dd: ddf }], lone: [], pictures: [] });
    // Two project files and one picture: not by that rule (and here not by size either).
    const wide = img("Tavern.png", 100, 70);
    const other = dd("other.dungeondraft_map", 60, 60);
    const r = await pairDungeondraft([wide, ddf, other]);
    expect(r.pairs).toEqual([]);
    expect(r.lone).toEqual([ddf, other]);
    expect(r.pictures).toEqual([wide]);
  });

  it("pairs by size when the names don't match: an image of the map's shape, or a .dd2vtt that fits inside it", async () => {
    const square = img("a.png", 1000, 1000);
    const wide = img("b.png", 3600, 2520);
    const ddf = dd("export-1.dungeondraft_map", 50, 35);
    const r = await pairDungeondraft([square, ddf, wide]);
    expect(r.pairs).toEqual([{ picture: wide, dd: ddf }]);
    expect(r.pictures).toEqual([square]);
    expect(r.lone).toEqual([]);

    const vtt = (sx: number, sy: number, name: string) =>
      new File([JSON.stringify({ resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: sx, y: sy }, pixels_per_grid: 72 }, image: "" })], name);
    const fits = vtt(48, 27, "one.dd2vtt");
    const tooBig = vtt(60, 40, "two.dd2vtt");
    const r2 = await pairDungeondraft([tooBig, fits, ddf]);
    expect(r2.pairs).toEqual([{ picture: fits, dd: ddf }]);
    expect(r2.pictures).toEqual([tooBig]);
    // Two project files, two pictures, sizes telling them apart.
    const small = dd("small.dungeondraft_map", 10, 10);
    const r3 = await pairDungeondraft([wide, square, ddf, small]);
    expect(r3.pairs).toEqual([{ picture: wide, dd: ddf }, { picture: square, dd: small }]);
  });

  it("leaves a project file alone when no picture fits, or several do", async () => {
    const ddf = dd("map.dungeondraft_map", 50, 35);
    const a = img("a.png", 3600, 2520);
    const b = img("b.png", 1800, 1260);
    const r = await pairDungeondraft([a, ddf, b]);
    expect(r).toEqual({ pairs: [], lone: [ddf], pictures: [a, b] });
    const r2 = await pairDungeondraft([img("a.png", 1000, 1000), ddf, img("b.png", 1000, 500)]);
    expect(r2.pairs).toEqual([]);
    expect(r2.lone).toEqual([ddf]);
    // A project file whose size can't be read pairs by name or by being alone only.
    const junk = new File(["{ not json"], "notes.dungeondraft_map");
    expect((await pairDungeondraft([a, junk, b])).lone).toEqual([junk]);
    expect((await pairDungeondraft([a, junk])).pairs).toEqual([{ picture: a, dd: junk }]);
  });

  it("does nothing without a project file", async () => {
    const a = img("a.png", 100, 100);
    const v = new File(["{}"], "b.dd2vtt");
    expect(await pairDungeondraft([a, v, new File(["{}"], "c.ob2")])).toEqual({ pairs: [], lone: [], pictures: [a, v] });
  });

  it("readMapFiles gives a paired picture its project file, and a .dd2vtt its VTT details too", async () => {
    const vttText = JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 2, y: 1 }, map_size: { x: 16, y: 10 }, pixels_per_grid: 32 },
      line_of_sight: [],
      portals: [{ position: { x: 5, y: 5 } }],
      lights: [],
      image: PNG_1x1,
    });
    const ddf = dd("snowy.dungeondraft_map", 20, 12);
    const png = img("Cavern.png", 2000, 1200);
    // Two pictures left over, neither the shape of the 9 x 5 map: that project file stays alone.
    const files = [new File([vttText], "snowy.dd2vtt"), ddf, png, dd("lone.dungeondraft_map", 9, 5), img("Hall.png", 1000, 1000)];
    const { maps, errors } = await readMapFiles(files);
    expect(errors).toEqual([loneProjectFileNote("lone.dungeondraft_map")]);
    expect(maps.map((m) => m.name)).toEqual(["snowy", "Cavern", "Hall"]);
    expect(maps[0].dd).toBe(ddf);
    expect(maps[0].vtt?.resolution).toEqual({ map_origin: { x: 2, y: 1 }, map_size: { x: 16, y: 10 }, pixels_per_grid: 32 });
    expect(maps[0].vtt?.portals).toEqual([{ position: { x: 5, y: 5 } }]);
    expect(maps[1].dd).toBeUndefined();
    expect(maps[1].vtt).toBeUndefined();
  });
});

describe("files dropped or pasted on the board", () => {
  it("sends a small export to the New scene window with its project file, not to a token", async () => {
    const small = img("Pelcs.png", 1400, 1000);
    const ddf = dd("Pelcs.dungeondraft_map", 20, 14);
    expect(await sortDroppedFiles([small, ddf], true)).toEqual({ maps: [small, ddf], tokens: [], refused: false, lone: null });
    // Without the project file it is a token, as before; a big picture a map.
    expect(await sortDroppedFiles([small], true)).toEqual({ maps: [], tokens: [small], refused: false, lone: null });
    const big = img("Big.png", 3600, 2520);
    expect(await sortDroppedFiles([big, small], true)).toEqual({ maps: [big], tokens: [small], refused: false, lone: null });
    // Every image and Universal VTT file goes with it, pictures that turn out unpaired included.
    const vtt = new File(["{}"], "other.dd2vtt");
    const note = new File(["hi"], "notes.txt");
    expect((await sortDroppedFiles([small, vtt, note, ddf, big], true)).maps).toEqual([small, vtt, ddf, big]);
  });

  it("marks a project file dropped on its own as lone, for the scene in view or the New scene window", async () => {
    const ddf = dd("Pelcs.dungeondraft_map", 20, 14);
    expect(await sortDroppedFiles([ddf], true)).toEqual({ maps: [], tokens: [], refused: false, lone: ddf });
    const two = dd("Other.dungeondraft_map", 20, 14);
    expect(await sortDroppedFiles([ddf, two], true)).toEqual({ maps: [ddf, two], tokens: [], refused: false, lone: null });
    // A stray file that is neither a picture nor a map doesn't make it less alone.
    expect(await sortDroppedFiles([ddf, new File(["hi"], "notes.txt")], true)).toEqual({ maps: [], tokens: [], refused: false, lone: ddf });
    expect((await sortDroppedFiles([ddf, new File(["hi"], "notes.txt"), img("Pelcs.png", 1400, 980)], true)).lone).toBeNull();
  });

  it("lets players add tokens only", async () => {
    const small = img("Pelcs.png", 1400, 1000);
    const big = img("Big.png", 3600, 2520);
    const ddf = dd("Pelcs.dungeondraft_map", 20, 14);
    expect(await sortDroppedFiles([small, ddf], false)).toEqual({ maps: [], tokens: [small], refused: true, lone: null });
    expect(await sortDroppedFiles([big], false)).toEqual({ maps: [], tokens: [big], refused: false, lone: null });
    expect(await sortDroppedFiles([new File(["{}"], "x.dd2vtt")], false)).toEqual({ maps: [], tokens: [], refused: true, lone: null });
    expect(await sortDroppedFiles([new File(["{}"], "x.ob2")], false)).toEqual({ maps: [], tokens: [], refused: true, lone: null });
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
    // Dungeondraft 1.2 names its exports "waterfall.vtt.dd2vtt" (Vern's): the ".vtt" is no part of the name.
    const vern = parseUniversalVtt(vtt(), "waterfall.vtt.dd2vtt");
    expect(vern.name).toBe("waterfall");
    expect(vern.image.name).toBe("waterfall.png");
    expect(parseUniversalVtt(vtt(), "Kdir_Topside.vtt.dd2vtt").name).toBe("Kdir Topside");
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

  it("keeps what the attach worker needs: the whole origin and size, and the level clues' positions", () => {
    const map = parseUniversalVtt(
      vtt({
        resolution: { map_origin: { x: 2, y: 1.5 }, map_size: { x: 16, y: 10 }, pixels_per_grid: 72 },
        portals: [{ position: { x: 5, y: 5 }, bounds: [], rotation: 0, closed: true }, { position: { x: "bad", y: 1 } }, null],
        lights: [{ position: { x: 16, y: 5.6 }, range: 2.1, intensity: 1, color: "ffffad58" }],
        line_of_sight: [[{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], "junk", [{ x: 3 }]],
      }),
      "x.dd2vtt",
    );
    expect(map.vtt).toEqual({
      resolution: { map_origin: { x: 2, y: 1.5 }, map_size: { x: 16, y: 10 }, pixels_per_grid: 72 },
      portals: [{ position: { x: 5, y: 5 } }],
      lights: [{ position: { x: 16, y: 5.6 } }],
      line_of_sight: [[{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]],
    });
    // The fraction of the origin still moves the grid lines.
    expect(map.offsetX).toBeCloseTo(0);
    expect(map.offsetY).toBeCloseTo(36);
    // Nothing without a complete grid.
    expect(parseUniversalVtt(vtt({ resolution: { map_size: { x: 16, y: 10 } } }), "x.dd2vtt").vtt).toBeUndefined();
  });

  it("keeps at most VTT_META_POINTS points in all: portals and lights first, then line of sight", () => {
    const portals = Array.from({ length: VTT_META_POINTS - 10 }, (_, i) => ({ position: { x: i, y: 0 } }));
    const lights = Array.from({ length: 6 }, (_, i) => ({ position: { x: i, y: 1 } }));
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 2 }));
    const map = parseUniversalVtt(vtt({ portals, lights, line_of_sight: [line, line] }), "x.dd2vtt");
    expect(map.vtt?.portals.length).toBe(VTT_META_POINTS - 10);
    expect(map.vtt?.lights.length).toBe(6);
    expect(map.vtt?.line_of_sight.map((l) => l.length)).toEqual([4]);
    const total = map.vtt!.portals.length + map.vtt!.lights.length + map.vtt!.line_of_sight.reduce((n, l) => n + l.length, 0);
    expect(total).toBe(VTT_META_POINTS);
    // The cap holds inside the portals and lights too: a file with more portals than that keeps exactly the cap, and nothing after.
    const many = Array.from({ length: VTT_META_POINTS + 500 }, (_, i) => ({ position: { x: i, y: 0 } }));
    const capped = parseUniversalVtt(vtt({ portals: many, lights, line_of_sight: [line] }), "x.dd2vtt");
    expect(capped.vtt?.portals.length).toBe(VTT_META_POINTS);
    expect(capped.vtt?.lights).toEqual([]);
    expect(capped.vtt?.line_of_sight).toEqual([]);
    const lit = parseUniversalVtt(vtt({ portals: [], lights: many, line_of_sight: [line] }), "x.dd2vtt");
    expect(lit.vtt?.lights.length).toBe(VTT_META_POINTS);
    expect(lit.vtt?.line_of_sight).toEqual([]);
  });
});

// ------------------------------------------------------------------ importing with the project file

/** A report as the attach worker gives it for a lined-up single-level map, with `over` changed. */
function report(over: Partial<AttachReport> = {}): AttachReport {
  return {
    levels: [{ key: "0", label: "0", terrainOn: true, why: "only" }],
    level: "0",
    fit: { verdict: "yes", lead: 1.4, sharp: 0.8, best: [0, 0], objects: 71 },
    hold: null,
    gridPxPerSquare: 72,
    snowShare: 1,
    drawn: "winter",
    packItems: 1,
    packPaths: 2,
    packShare: 0.04,
    packNames: ["Icewind Dale"],
    dropped: 0,
    objects: 71,
    water: ["WATER"],
    lowRes: false,
    warnings: [],
    ...over,
  };
}

const TWO_LEVELS: AttachReport["levels"] = [
  { key: "1", label: "Ground", terrainOn: true, why: "vtt", vttScore: 1 },
  { key: "0", label: "Roof", terrainOn: false, why: "vtt", vttScore: 0 },
];

function asset(id: string, width: number, height: number, kind: Asset["kind"] = "map"): Asset {
  return { id, name: id, kind, width, height, mime: "image/png", bytes: 1000, owner: "@gm", createdAt: 1 };
}

/** A GM's room whose uploads are faked: pictures come back at `shrink` of their size, and scenes are collected. */
function gmRoom(shrink = 0.5) {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  room.store.set({ me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" } });
  const scenes: Scene[] = [];
  room.createScene = (scene) => {
    scenes.push(scene);
  };
  let n = 0;
  room.uploadMaps = async (maps) =>
    Promise.all(
      maps.map(async (map) => {
        const m = /^(\d+)x(\d+)$/.exec(await map.image.text());
        const source = m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1, height: 1 };
        return { asset: asset(`map${++n}`, Math.round(source.width * shrink), Math.round(source.height * shrink)), source, map };
      }),
    );
  return { room, scenes };
}

const sidecarBytes = new Uint8Array([1, 2, 3]);
const preview = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as unknown as ImageData;

describe("importing a picture with its Dungeondraft project file", () => {
  it("attaches the data as the scene is made: sidecar uploaded, mapData set, the grid from the data, one report line", async () => {
    const { room, scenes } = gmRoom();
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: report(), sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockResolvedValue(asset("side1", 512, 3, "mapdata"));
    const picture = img("Waterfall.png", 3600, 2520);
    const ddf = dd("waterfall.dungeondraft_map");
    const progress: string[] = [];
    const r = await importFiles(room, [picture, ddf], { name: "The Falls", order: 0, covered: false, onProgress: (t) => progress.push(t) });

    expect(vi.mocked(attach.prepareAttach)).toHaveBeenCalledTimes(1);
    const [file, blob, size, opts] = vi.mocked(attach.prepareAttach).mock.calls[0];
    expect(file).toBe(ddf);
    expect(blob).toBe(picture);
    expect(size).toEqual({ width: 3600, height: 2520 });
    expect(opts.vtt).toBeUndefined();
    expect(vi.mocked(attach.uploadSidecar)).toHaveBeenCalledWith(room, sidecarBytes, "Waterfall");

    expect(scenes.length).toBe(1);
    const scene = scenes[0];
    // Two files, one map: the typed name is used.
    expect(scene.name).toBe("The Falls");
    expect(scene.mapAssetId).toBe("map1");
    expect(scene.mapData).toEqual({ assetId: "side1", forAssetId: "map1" });
    expect(scene.mapRect).toBeUndefined();
    // 72 px a square on the 3600 px picture, uploaded at half size.
    expect(scene.grid.size).toBe(36);
    expect(r.gridFromFile).toBe(1);
    expect(r.notes).toEqual([]);
    expect(r.attach).toEqual([{ sceneId: scene.id, status: "ok", note: "The Falls: Dungeondraft data attached. It lines up with the picture.", warnings: [] }]);
    expect(touchedSidecars.has("side1")).toBe(true);
    expect(vi.mocked(attach.cleanUpSidecars)).toHaveBeenCalledWith(room, touchedSidecars);
    expect(progress).toContain("Saving the Dungeondraft data…");
  });

  it("keeps a .dd2vtt's rectangle on the scene, names the sidecar by the level, and passes the VTT details on", async () => {
    const { room, scenes } = gmRoom(1);
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: report({ levels: TWO_LEVELS, level: "1" }), sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockResolvedValue(asset("side2", 512, 3, "mapdata"));
    const vttText = JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 2, y: 1 }, map_size: { x: 48, y: 27 }, pixels_per_grid: 72 },
      line_of_sight: [],
      portals: [{ position: { x: 5, y: 5 } }],
      lights: [],
      image: PNG_1x1,
    });
    const r = await importFiles(room, [dd("Pelcs.dungeondraft_map", 50, 35), new File([vttText], "Pelcs.dd2vtt")], { name: "", order: 3, covered: true });
    const opts = vi.mocked(attach.prepareAttach).mock.calls[0][3];
    expect(opts.vtt?.resolution).toEqual({ map_origin: { x: 2, y: 1 }, map_size: { x: 48, y: 27 }, pixels_per_grid: 72 });
    expect(opts.vtt?.portals).toEqual([{ position: { x: 5, y: 5 } }]);
    expect(vi.mocked(attach.uploadSidecar)).toHaveBeenCalledWith(room, sidecarBytes, "Pelcs · Ground");
    expect(scenes[0].mapRect).toEqual([2, 1, 48, 27]);
    expect(scenes[0].mapData).toEqual({ assetId: "side2", forAssetId: "map1" });
    expect(scenes[0].fogCover).toBe(true);
    expect(scenes[0].order).toBe(3);
    expect(r.attach[0]).toMatchObject({ status: "ok", note: "Pelcs: Dungeondraft data attached (level Ground). It lines up with the picture." });
  });

  it("puts data on hold when it didn't line up or the level is unclear, and says so", async () => {
    for (const [hold, status, note] of [
      ["fit", "hold", "Waterfall: the Dungeondraft data doesn't seem to line up with the picture, so it isn't used yet."],
      ["level", "level", "Waterfall: check which level this picture shows."],
    ] as const) {
      const { room, scenes } = gmRoom();
      vi.mocked(attach.prepareAttach).mockResolvedValue({
        report: report({ hold, fit: { verdict: "no", lead: 0.6, sharp: 1, best: [0.5, 1], objects: 40 } }),
        sidecar: sidecarBytes,
        preview,
      });
      vi.mocked(attach.uploadSidecar).mockResolvedValue(asset("side3", 512, 3, "mapdata"));
      const ddf = dd("waterfall.dungeondraft_map");
      const r = await importFiles(room, [img("Waterfall.png", 3600, 2520), ddf], { name: "", order: 0, covered: false });
      expect(scenes[0].mapData).toEqual({ assetId: "side3", forAssetId: "map1", hold: true });
      // The project file stays with the line, so Check… can open the attach dialog on it (its levels and preview).
      expect(r.attach).toEqual([{ sceneId: scenes[0].id, status, note, warnings: [], dd: ddf }]);
    }
    // Data attached and in use keeps no file.
    const { room } = gmRoom();
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: report(), sidecar: sidecarBytes, preview });
    const r = await importFiles(room, [img("Waterfall.png", 3600, 2520), dd("waterfall.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(r.attach[0].dd).toBeUndefined();
  });

  it("keeps a .dd2vtt pair's rectangle on the scene even when its data couldn't be attached, and the .dd2vtt's details for Check… on hold", async () => {
    const vttText = JSON.stringify({
      format: 0.3,
      resolution: { map_origin: { x: 2, y: 1 }, map_size: { x: 48, y: 27 }, pixels_per_grid: 72 },
      line_of_sight: [],
      portals: [{ position: { x: 5, y: 5 } }],
      lights: [],
      image: PNG_1x1,
    });
    const files = () => [dd("Pelcs.dungeondraft_map", 50, 35), new File([vttText], "Pelcs.dd2vtt")];
    // Refused by the worker, and the sidecar's upload failing: the scene still knows where its picture lies.
    const { room, scenes } = gmRoom(1);
    vi.mocked(attach.prepareAttach).mockRejectedValueOnce(new attach.AttachError("Pelcs.dungeondraft_map isn't a Dungeondraft map, or it's damaged."));
    const r1 = await importFiles(room, files(), { name: "", order: 0, covered: false });
    expect(r1.attach).toEqual([]);
    expect(scenes[0].mapData).toBeUndefined();
    expect(scenes[0].mapRect).toEqual([2, 1, 48, 27]);
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: report({ levels: TWO_LEVELS, level: "1" }), sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockRejectedValueOnce(new Error("network down"));
    const r2 = await importFiles(room, files(), { name: "", order: 1, covered: false });
    expect(r2.notes).toEqual(["Pelcs: the Dungeondraft data couldn't be saved (network down). Attach it again with Edit scene › Map."]);
    expect(scenes[1].mapData).toBeUndefined();
    expect(scenes[1].mapRect).toEqual([2, 1, 48, 27]);
    // On hold for its level: the line carries the project file and the .dd2vtt's details.
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: report({ levels: TWO_LEVELS, level: "1", hold: "level" }), sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockResolvedValue(asset("side9", 512, 3, "mapdata"));
    const pair = files();
    const r3 = await importFiles(room, pair, { name: "", order: 2, covered: false });
    expect(r3.attach[0]).toMatchObject({ status: "level", dd: pair[0] });
    expect(r3.attach[0].vtt?.resolution.map_origin).toEqual({ x: 2, y: 1 });
    expect(scenes[2].mapRect).toEqual([2, 1, 48, 27]);
    // A .dd2vtt brought in without a project file is a plain picture, as before.
    await importFiles(room, [new File([vttText], "Plain.dd2vtt")], { name: "", order: 3, covered: false });
    expect(scenes[3].mapRect).toBeUndefined();
  });

  it("reports a fit that couldn't be fully checked, a whole-square shift, and the extractor's warnings", async () => {
    const unsure = report({ fit: { verdict: "unsure", lead: 1.05, sharp: 0.97, best: [1, 0], objects: 71 }, warnings: ["Some terrain couldn't be read (a mod?): it stays as drawn."] });
    expect(attachNote("Waterfall", { status: "unsure", report: unsure })).toBe(
      "Waterfall: Dungeondraft data attached, but it couldn't be fully checked against the picture.",
    );
    const { room, scenes } = gmRoom();
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: unsure, sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockResolvedValue(asset("side4", 512, 3, "mapdata"));
    const r = await importFiles(room, [img("Waterfall.png", 3600, 2520), dd("waterfall.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(scenes[0].mapData).toEqual({ assetId: "side4", forAssetId: "map1" });
    expect(r.attach[0]).toMatchObject({ status: "unsure", warnings: ["Some terrain couldn't be read (a mod?): it stays as drawn."] });

    const shifted = report({ shifted: [-2, 0] });
    expect(attachNote("Waterfall", { status: "shifted", report: shifted })).toBe(
      "Waterfall: the map seems to have grown 2 squares on the left since this export, so it was lined up that way.",
    );
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: shifted, sidecar: sidecarBytes, preview });
    const r2 = await importFiles(room, [img("Waterfall.png", 3600, 2520), dd("waterfall.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(r2.attach[0].status).toBe("shifted");
    expect(scenes[1].mapData?.hold).toBeUndefined();
  });

  it("puts a shift into words", () => {
    expect(describeShift([-2, 0])).toBe("grown 2 squares on the left");
    expect(describeShift([0, -1])).toBe("grown 1 square at the top");
    expect(describeShift([1, 0])).toBe("lost 1 square on the left");
    expect(describeShift([-3, 2])).toBe("grown 3 squares on the left and lost 2 squares at the top");
  });

  it("still makes the scene when the data can't be attached, and says why among the notes, which the report shows", async () => {
    const { room, scenes } = gmRoom();
    vi.mocked(attach.prepareAttach).mockRejectedValueOnce(new attach.AttachError("notes.dungeondraft_map isn't a Dungeondraft map, or it's damaged."));
    const r = await importFiles(room, [img("Waterfall.png", 3600, 2520), dd("notes.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(scenes.length).toBe(1);
    expect(scenes[0].mapData).toBeUndefined();
    // No data: the grid is a guess, as for any plain picture.
    expect(r.gridFromFile).toBe(0);
    // The damaged-file line is one of the report's notes (6.1), as it is; nothing to Check… about it.
    expect(r.notes).toEqual(["notes.dungeondraft_map isn't a Dungeondraft map, or it's damaged."]);
    expect(r.attach).toEqual([]);
    expect(vi.mocked(attach.uploadSidecar)).not.toHaveBeenCalled();
    expect(vi.mocked(attach.cleanUpSidecars)).not.toHaveBeenCalled();

    // A refusal about the picture is told after the scene's name, reading as one line.
    vi.mocked(attach.prepareAttach).mockRejectedValueOnce(new attach.AttachError("This picture is 3456×1944 but the map is 50×35 squares, so it isn't an export of the whole map. If you exported part of it, choose its .dd2vtt export too."));
    const r2 = await importFiles(room, [img("Waterfall.png", 3456, 1944), dd("waterfall.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(r2.notes).toEqual(["Waterfall: this picture is 3456×1944 but the map is 50×35 squares, so it isn't an export of the whole map. If you exported part of it, choose its .dd2vtt export too."]);
    expect(r2.attach).toEqual([]);

    // The sidecar's upload failing.
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: report(), sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockRejectedValueOnce(new Error("Too many assets in this room."));
    const r3 = await importFiles(room, [img("Waterfall.png", 3600, 2520), dd("waterfall.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(scenes[2].mapData).toBeUndefined();
    expect(r3.notes).toEqual(["Waterfall: the Dungeondraft data couldn't be saved (Too many assets in this room.). Attach it again with Edit scene › Map."]);
    expect(r3.attach).toEqual([]);
    expect(touchedSidecars.size).toBe(0);

    // One of two attached, one not: the scene that got data has its line, the other its note.
    vi.mocked(attach.prepareAttach).mockRejectedValueOnce(new attach.AttachError("This picture couldn't be read."));
    vi.mocked(attach.prepareAttach).mockResolvedValueOnce({ report: report(), sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockResolvedValue(asset("side5", 512, 3, "mapdata"));
    const r4 = await importFiles(room, [img("Alpha.png", 3600, 2520), dd("alpha.dungeondraft_map"), img("Beta.png", 3600, 2520), dd("beta.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(r4.notes).toEqual(["Alpha: this picture couldn't be read."]);
    expect(r4.attach).toEqual([{ sceneId: scenes[4].id, status: "ok", note: "Beta: Dungeondraft data attached. It lines up with the picture.", warnings: [] }]);
  });

  it("takes the grid from the data over the picture's name", async () => {
    const { room, scenes } = gmRoom();
    vi.mocked(attach.prepareAttach).mockResolvedValue({ report: report({ gridPxPerSquare: 72 }), sidecar: sidecarBytes, preview });
    vi.mocked(attach.uploadSidecar).mockResolvedValue(asset("side6", 512, 3, "mapdata"));
    // The name says 30 across (60 px on the half-size upload); the data says 72 px a square on the 3600 px picture: 36.
    const r = await importFiles(room, [img("Waterfall 30x20.png", 3600, 2520), dd("waterfall.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(scenes[0].grid.size).toBe(36);
    expect(scenes[0].name).toBe("Waterfall");
    expect(r.gridFromFile).toBe(1);
    expect(r.attach[0].status).toBe("ok");
    // When the data can't be attached, the name's grid is still believed.
    vi.mocked(attach.prepareAttach).mockRejectedValueOnce(new attach.AttachError("This picture couldn't be read."));
    await importFiles(room, [img("Waterfall 30x20.png", 3600, 2520), dd("waterfall.dungeondraft_map")], { name: "", order: 0, covered: false });
    expect(scenes[1].grid.size).toBe(60);
  });

  it("makes one attached scene per level when a map was exported level by level (6.5)", async () => {
    const { room, scenes } = gmRoom(1);
    const ground = report({ levels: TWO_LEVELS, level: "1" });
    const roof = report({ levels: TWO_LEVELS, level: "0" });
    vi.mocked(attach.prepareAttach).mockResolvedValueOnce({ report: ground, sidecar: sidecarBytes, preview });
    vi.mocked(attach.prepareAttach).mockResolvedValueOnce({ report: roof, sidecar: sidecarBytes, preview });
    let n = 0;
    vi.mocked(attach.uploadSidecar).mockImplementation(async () => asset(`level${++n}`, 512, 3, "mapdata"));
    const ddf = dd("Tavern.dungeondraft_map");
    const r = await importFiles(room, [img("Tavern - Ground.png", 3600, 2520), img("Tavern - Roof.png", 3600, 2520), ddf], { name: "Typed", order: 0, covered: false });
    expect(vi.mocked(attach.prepareAttach).mock.calls.map((c) => c[0])).toEqual([ddf, ddf]);
    expect(vi.mocked(attach.uploadSidecar).mock.calls.map((c) => c[2])).toEqual(["Tavern Ground · Ground", "Tavern Roof · Roof"]);
    // Several scenes: each keeps its own name, not the typed one.
    expect(scenes.map((s) => [s.name, s.mapData?.assetId])).toEqual([["Tavern Ground", "level1"], ["Tavern Roof", "level2"]]);
    expect(r.notes).toEqual([]);
    expect(r.attach.map((a) => a.note)).toEqual([
      "Tavern Ground: Dungeondraft data attached (level Ground). It lines up with the picture.",
      "Tavern Roof: Dungeondraft data attached (level Roof). It lines up with the picture.",
    ]);
  });

  it("brings plain pictures in as before, with no attach lines", async () => {
    const { room, scenes } = gmRoom();
    const r = await importFiles(room, [img("Tavern 30x20.png", 2100, 1400)], { name: "", order: 0, covered: false });
    expect(vi.mocked(attach.prepareAttach)).not.toHaveBeenCalled();
    expect(scenes[0].mapData).toBeUndefined();
    expect(scenes[0].grid.size).toBe(35);
    expect(r).toMatchObject({ gridFromFile: 1, notes: [], attach: [], owlbear: false });
  });
});

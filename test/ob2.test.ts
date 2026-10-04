import { describe, expect, it } from "vitest";
import { makeZip } from "../src/client/backup";
import { importFiles } from "../src/client/importScenes";
import { gridSizeFor } from "../src/client/mapImport";
import type { MapFile } from "../src/client/mapImport";
import { filledRegions, parseScale, pathContours, readOb2 } from "../src/client/ob2";
import type { RoomClient } from "../src/client/room/client";
import type { Asset, RoomSettings, Scene } from "../src/shared/types";
import { importedUnits } from "../src/shared/units";
import { openZip, readText } from "../src/client/zip";

const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const enc = new TextEncoder();

/** A zip whose entries are deflate-compressed, like JSZip can write. */
async function deflatedZip(entries: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const comp = new Uint8Array(
      await new Response(new Blob([e.data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer(),
    );
    const name = enc.encode(e.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(18, comp.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, comp);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(20, comp.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + comp.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
}

const mapId = "11111111-1111-1111-1111-111111111111";
const sceneId = "22222222-2222-2222-2222-222222222222";
const tokenImg = "assets/images/items/33333333-3333-3333-3333-333333333333.png";
const mapImg = `assets/images/items/${mapId}.png`;

function sceneDoc(overrides: { grid?: object; mapItem?: object; items?: Record<string, object> } = {}) {
  return {
    version: 3,
    grid: { dpi: 150, type: "SQUARE", measurement: "CHEBYSHEV", scale: "5ft", style: {}, ...overrides.grid },
    fog: { filled: true, style: { color: "#222222", strokeWidth: 5 } },
    items: {
      map: {
        id: "map",
        type: "IMAGE",
        layer: "MAP",
        name: "Crypt",
        visible: true,
        locked: true,
        zIndex: 0,
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        image: { width: 2800, height: 1400, mime: "image/png", url: mapImg },
        grid: { dpi: 140, offset: { x: 0, y: 0 } },
        ...overrides.mapItem,
      },
      // A Cut (reveals): a 300 x 150 world-unit rectangle at (150, 300).
      cut: {
        id: "cut",
        type: "SHAPE",
        layer: "FOG",
        visible: false,
        zIndex: 2,
        position: { x: 150, y: 300 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        width: 300,
        height: 150,
        shapeType: "RECTANGLE",
      },
      // Added fog with a hole in it, drawn before the cut.
      ring: {
        id: "ring",
        type: "PATH",
        layer: "FOG",
        visible: true,
        zIndex: 1,
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        fillRule: "evenodd",
        commands: [
          [0, 0, 0],
          [1, 600, 0],
          [1, 600, 600],
          [1, 0, 600],
          [5],
          [0, 150, 150],
          [1, 450, 150],
          [1, 450, 450],
          [1, 150, 450],
          [5],
        ],
      },
      goblin: {
        id: "goblin",
        type: "IMAGE",
        layer: "CHARACTER",
        name: "Goblin",
        visible: false,
        locked: false,
        zIndex: 5,
        position: { x: 225, y: 75 },
        rotation: 90,
        scale: { x: 1, y: 1 },
        image: { width: 300, height: 300, mime: "image/png", url: tokenImg },
        grid: { dpi: 300, offset: { x: 150, y: 150 } },
        text: { plainText: "Grik" },
      },
      ghost: {
        id: "ghost",
        type: "IMAGE",
        layer: "CHARACTER",
        name: "Ghost",
        visible: true,
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        image: { width: 300, height: 300, mime: "image/png", url: "https://images.owlbear.rodeo/x.png" },
        grid: { dpi: 300, offset: { x: 150, y: 150 } },
      },
      doodle: { id: "doodle", type: "CURVE", layer: "DRAWING", points: [], position: { x: 0, y: 0 } },
      ...overrides.items,
    },
  };
}

function ob2Entries(doc: object) {
  const manifest = {
    version: 1,
    assets: {
      [sceneId]: { id: sceneId, type: "SCENE", name: "The Crypt", path: `scenes/${sceneId}`, metadata: { doc: `assets/scenes/docs/${sceneId}.json` } },
      [mapId]: {
        id: mapId,
        type: "IMAGE",
        name: "Crypt map",
        path: `images/maps/${mapId}`,
        metadata: { image: { width: 2800, height: 1400, mime: "image/png", url: mapImg }, grid: { dpi: 140, offset: { x: 0, y: 0 } } },
      },
    },
  };
  return [
    { name: "manifest.json", data: enc.encode(JSON.stringify(manifest)) },
    { name: `assets/scenes/docs/${sceneId}.json`, data: enc.encode(JSON.stringify(doc)) },
    { name: mapImg, data: PNG },
    { name: tokenImg, data: PNG },
  ];
}

const file = (blob: Blob) => new File([blob], "backup.ob2");

describe("zip reading", () => {
  it("reads stored and deflated entries", async () => {
    for (const blob of [makeZip([{ name: "a.txt", data: enc.encode("hello") }]), await deflatedZip([{ name: "a.txt", data: enc.encode("hello") }])]) {
      const zip = openZip(await blob.arrayBuffer());
      expect(await readText(zip.get("a.txt")!)).toBe("hello");
    }
  });

  it("says when a file isn't a zip", () => {
    expect(() => openZip(enc.encode("not a zip at all, just some text here").buffer as ArrayBuffer)).toThrow(/isn't a zip/);
  });
});

describe("filled areas", () => {
  const sq = (x0: number, y0: number, s: number) => [
    { x: x0, y: y0 },
    { x: x0 + s, y: y0 },
    { x: x0 + s, y: y0 + s },
    { x: x0, y: y0 + s },
  ];
  const area = (c: { x: number; y: number }[]) => {
    let a = 0;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) a += c[j].x * c[i].y - c[i].x * c[j].y;
    return a / 2;
  };

  it("makes a ring with an island in its hole into two areas", () => {
    const regions = filledRegions([sq(0, 0, 100), sq(20, 20, 60), sq(40, 40, 20)], "evenodd");
    expect(regions.length).toBe(2);
    // The ring's net area is the square less its hole; the island stands alone.
    expect(Math.abs(area(regions[0]))).toBeCloseTo(100 * 100 - 60 * 60);
    expect(Math.abs(area(regions[1]))).toBeCloseTo(20 * 20);
  });

  it("follows the non-zero rule: a same-way inner outline is not a hole", () => {
    const same = filledRegions([sq(0, 0, 100), sq(20, 20, 60)], "nonzero");
    expect(same.length).toBe(1);
    expect(Math.abs(area(same[0]))).toBeCloseTo(100 * 100);
    const opposite = filledRegions([sq(0, 0, 100), [...sq(20, 20, 60)].reverse()], "nonzero");
    expect(Math.abs(area(opposite[0]))).toBeCloseTo(100 * 100 - 60 * 60);
  });
});

describe("path outlines", () => {
  it("splits subpaths and flattens curves", () => {
    const c = pathContours([
      [0, 0, 0],
      [1, 10, 0],
      [4, 10, 5, 5, 10, 0, 10],
      [5],
      [0, 20, 20],
      [1, 30, 20],
      [1, 30, 30],
      [5],
    ]);
    expect(c.length).toBe(2);
    expect(c[0].length).toBe(2 + 8);
    expect(c[0][c[0].length - 1]).toEqual({ x: 0, y: 10 });
  });
});

describe("Owlbear Rodeo backups", () => {
  it("brings in the map, grid, fog and tokens", async () => {
    const imp = await readOb2(file(await deflatedZip(ob2Entries(sceneDoc()))));
    expect(imp.scenes.length).toBe(1);
    const s = imp.scenes[0];
    expect(s.map).toMatchObject({ name: "The Crypt", pxPerCell: 140, width: 2800, height: 1400, gridType: "square", offsetX: 0, offsetY: 0 });
    expect(s.map.image.type).toBe("image/png");
    expect(gridSizeFor(s.map, 2800, 1400)).toBe(140);
    expect(s.fogCover).toBe(true);

    // Drawn in Owlbear's order: the ring of fog (its hole just isn't painted), then the cut.
    // Each shape also gets Owlbear's fog outline (5 world units = 4.67 px here).
    expect(s.fog.map((f) => `${f.mode} ${f.shape}`)).toEqual([
      "hide poly",
      "hide stroke",
      "hide stroke",
      "reveal poly",
      "reveal stroke",
    ]);
    // World units are 150 per cell; the map has 140 pixels per cell. The hole runs the
    // other way round, joined by a bridge out and back, so it stays empty under a
    // non-zero fill and never clears anything.
    expect(s.fog[0].points).toEqual([
      0, 0, 560, 0, 560, 560, 0, 560, 0, 0, 140, 420, 420, 420, 420, 140, 140, 140, 140, 420, 0, 0,
    ]);
    expect(s.fog[1]).toMatchObject({ width: 4.67, points: [0, 0, 560, 0, 560, 560, 0, 560, 0, 0] });
    expect(s.fog[3].points).toEqual([140, 280, 420, 280, 420, 420, 140, 420]);

    expect(s.tokens).toEqual([
      { image: tokenImg, x: 210, y: 70, size: 1, rotation: 90, label: "Grik", hidden: true, locked: false, prop: false },
    ]);
    expect(imp.notes.join(" ")).toMatch(/1 token left out/);
    expect(imp.notes.join(" ")).toMatch(/1 drawing/);
    const art = await imp.tokenImage(tokenImg);
    expect(art?.size).toBe(PNG.length);
  });

  it("brings in outline-only fog and fog lines as strokes", async () => {
    const doc = sceneDoc({
      items: {
        ring: { id: "ring", type: "PATH", layer: "FOG", commands: [] },
        cut: { id: "cut", type: "PATH", layer: "FOG", commands: [] },
        outline: {
          id: "outline",
          type: "SHAPE",
          layer: "FOG",
          visible: true,
          zIndex: 1,
          position: { x: 0, y: 0 },
          scale: { x: 2, y: 2 },
          width: 150,
          height: 150,
          shapeType: "RECTANGLE",
          style: { fillOpacity: 0 },
        },
        line: {
          id: "line",
          type: "LINE",
          layer: "FOG",
          visible: false,
          zIndex: 1,
          lastModified: "2026-01-02T00:00:00Z",
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          startPosition: { x: 0, y: 0 },
          endPosition: { x: 300, y: 0 },
        },
      },
    });
    const s = (await readOb2(file(makeZip(ob2Entries(doc))))).scenes[0];
    expect(s.fog.map((f) => `${f.mode} ${f.shape}`)).toEqual(["hide stroke", "reveal stroke"]);
    // The outline is scaled with its shape: 5 x 2 world units.
    expect(s.fog[0]).toMatchObject({ width: 9.33, points: [0, 0, 280, 0, 280, 280, 0, 280, 0, 0] });
    expect(s.fog[1]).toMatchObject({ width: 4.67, points: [0, 0, 280, 0] });
  });

  it("works out the grid for a map that was moved and scaled", async () => {
    // The map sits 75 world units right and is drawn at half size: 70 px per cell on the image.
    const doc = sceneDoc({ mapItem: { position: { x: 75, y: 0 }, scale: { x: 2, y: 2 } } });
    const s = (await readOb2(file(makeZip(ob2Entries(doc))))).scenes[0];
    expect(s.map.pxPerCell).toBe(70);
    // Each image pixel covers 2 x 150/140 world units, so world x 0 (a grid line), 75 units
    // left of the map's corner, is image x -35. Lines repeat every 70 px: 35 into the image.
    expect(s.map.offsetX).toBeCloseTo(-35);
    expect(((s.map.offsetX! % 70) + 70) % 70).toBeCloseTo(35);
  });

  it("keeps hex grids", async () => {
    const doc = sceneDoc({ grid: { type: "HEX_VERTICAL" } });
    const s = (await readOb2(file(makeZip(ob2Entries(doc))))).scenes[0];
    expect(s.map.gridType).toBe("hex-pointy");
    // The first hex's centre: world (75, 86.6) -> image (70, 80.83).
    expect(s.map.offsetX).toBeCloseTo(70);
    expect(s.map.offsetY).toBeCloseTo((150 / Math.sqrt(3)) * (140 / 150));
  });

  it("explains a scene exported without its map", async () => {
    const entries = ob2Entries(sceneDoc()).filter((e) => e.name !== mapImg);
    const imp = await readOb2(file(makeZip(entries)));
    expect(imp.scenes.length).toBe(0);
    expect(imp.notes.join(" ")).toMatch(/map image isn't in the file/);
  });

  it("makes a scene from a map exported on its own", async () => {
    const entries = ob2Entries(sceneDoc()).filter((e) => !e.name.includes("scenes"));
    const manifest = JSON.parse(new TextDecoder().decode(entries[0].data));
    delete manifest.assets[sceneId];
    entries[0] = { name: "manifest.json", data: enc.encode(JSON.stringify(manifest)) };
    const imp = await readOb2(file(makeZip(entries)));
    expect(imp.scenes.map((s) => s.map)).toMatchObject([{ name: "Crypt map", pxPerCell: 140 }]);
  });

  it("refuses files that aren't Owlbear backups", async () => {
    await expect(readOb2(file(makeZip([{ name: "room.json", data: enc.encode("{}") }])))).rejects.toThrow(/Owlbear/);
    await expect(readOb2(new File(["hello"], "x.ob2"))).rejects.toThrow(/zip/);
  });
});

describe("Owlbear grid scales", () => {
  it("reads the scale as a distance and a unit", () => {
    expect(parseScale("5ft")).toEqual({ unit: 5, unitName: "ft" });
    expect(parseScale("10 ft")).toEqual({ unit: 10, unitName: "ft" });
    expect(parseScale("1.5m")).toEqual({ unit: 1.5, unitName: "m" });
    expect(parseScale("2,5 m")).toEqual({ unit: 2.5, unitName: "m" });
    expect(parseScale("1")).toEqual({ unit: 1, unitName: "" });
    for (const bad of ["", "ft", "0ft", "-5ft", undefined, 5, null]) expect(parseScale(bad)).toBeUndefined();
  });

  it("keeps each scene's scale for the room to convert", async () => {
    const imp = await readOb2(file(makeZip(ob2Entries(sceneDoc({ grid: { scale: "10ft" } })))));
    expect(imp.scenes[0].map.scale).toEqual({ unit: 10, unitName: "ft" });
    const metric = await readOb2(file(makeZip(ob2Entries(sceneDoc({ grid: { scale: "1.5m" } })))));
    expect(metric.scenes[0].map.scale).toEqual({ unit: 1.5, unitName: "m" });
  });

  it("comes into a metric room in metres, and into a room in feet at 5 ft as before", async () => {
    const units = async (scale: string, metric: boolean | undefined) => {
      const imp = await readOb2(file(makeZip(ob2Entries(sceneDoc({ grid: { scale } })))));
      return importedUnits(imp.scenes[0].map.scale, metric === undefined ? {} : { metric });
    };
    expect(await units("5ft", true)).toEqual({ unit: 1.5, unitName: "m" });
    expect(await units("10ft", true)).toEqual({ unit: 3, unitName: "m" });
    expect(await units("1.5m", true)).toEqual({ unit: 1.5, unitName: "m" });
    expect(await units("1km", true)).toEqual({ unit: 1, unitName: "km" });
    expect(await units("10ft", false)).toEqual({ unit: 5, unitName: "ft" });
    expect(await units("1.5m", undefined)).toEqual({ unit: 5, unitName: "ft" });
  });
});

describe("bringing in maps (Upload map, Owlbear backups)", () => {
  /** Enough of a room for importFiles: uploads come back at the map's size, and scenes are kept. */
  function fakeRoom(settings: RoomSettings | undefined) {
    const created: Scene[] = [];
    let n = 0;
    const asset = (w: number, h: number): Asset => ({
      id: `map${n++}`,
      name: "Map",
      kind: "map",
      width: w,
      height: h,
      mime: "image/png",
      bytes: 1,
      owner: "@gm",
      createdAt: 0,
    });
    const room = {
      state: { room: settings ? { id: "AbCdEf123456", name: "Room", createdAt: 0, settings } : null, me: { userId: "@gm" } },
      uploadMaps: async (maps: MapFile[]) =>
        maps.map((map) => {
          const source = { width: map.width ?? 2800, height: map.height ?? 1400 };
          return { map, asset: asset(source.width, source.height), source };
        }),
      upload: async () => [],
      createScene: (s: Scene) => void created.push(s),
      change: () => {},
    };
    return { room: room as unknown as RoomClient, created };
  }

  const units = async (settings: RoomSettings | undefined) => {
    const { room, created } = fakeRoom(settings);
    const files = [
      new File([PNG as BlobPart], "Crypt.png", { type: "image/png" }),
      file(makeZip(ob2Entries(sceneDoc({ grid: { scale: "10ft" } })))),
    ];
    const result = await importFiles(room, files, { name: "", order: 0, covered: true });
    expect(result.scenes).toEqual(created);
    return created.map((s) => `${s.grid.unit} ${s.grid.unitName}`);
  };

  const old: RoomSettings = { playersCanDraw: true, playersCanAddTokens: true, playersMoveAll: true };

  it("gives an upload the room's metres, and switches an Owlbear scale in feet to them", async () => {
    expect(await units({ ...old, metric: true })).toEqual(["1.5 m", "3 m"]);
  });

  it("starts both at 5 ft in a room in feet, and in a room from before the setting", async () => {
    expect(await units({ ...old, metric: false })).toEqual(["5 ft", "5 ft"]);
    expect(await units(old)).toEqual(["5 ft", "5 ft"]);
    expect(await units(undefined)).toEqual(["5 ft", "5 ft"]);
  });
});

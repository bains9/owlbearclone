// Maps made in Dungeon (dungeon.parhome.ca) get exact seasons the way Dungeondraft maps do: the
// export's "dungeon" payload is picked up as the picture's project file (mapImport.ts), read as a
// Dungeondraft map (dd/fromDungeon.ts) and compiled by the unchanged extractor. Fixture: Dungeon's
// own sample map, the Old Keep, exported with payload version 2 and a 1 x 1 stand-in picture (the
// tests draw pictures from the data, as the Dungeondraft tests do).

import { describe, expect, it } from "vitest";
import { parseUniversalVtt } from "../src/client/mapImport";
import { DungeonVersionError, looksLikeDungeon, parseDungeonPayload, signedArea, withHoles } from "../src/client/dd/fromDungeon";
import { DDParseError } from "../src/client/dd/parse";
import { GRID, type DDMap } from "../src/client/dd/model";
import { AR, OR, TR, defaultName, objectRole, pathRole, terrainRole } from "../src/client/dd/roles";
import { extractSidecar, type PictureRect } from "../src/client/dd/extract";
import { SPRITE_SIZES } from "../src/client/dd/spriteSizes";
import { DD_TEXT, handleDdMessage } from "../src/client/dd/ddWorker";
import type { DdWorkerOut } from "../src/client/dd/messages";
import { analyseExact } from "../src/client/room/seasonExact";
import { bake } from "../src/client/room/seasonPixels";
import { sanitizeMapData } from "../src/shared/sanitize";
import { attachNote } from "../src/client/importScenes";
import { dataNote } from "../src/client/ui/ddText";
import { fakeExportFromMap } from "./fixtures/fakeExport";

type Fs = { readFileSync(path: string | URL, encoding: "utf8"): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
const FIXTURE = fs.readFileSync(new URL("./fixtures/dungeon-old-keep.dd2vtt", import.meta.url), "utf8");
const export0 = JSON.parse(FIXTURE) as { dungeon: Record<string, any> };

/** The fixture's payload, changed by `edit`, as the worker would get it. */
function payload(edit?: (p: Record<string, any>) => void): string {
  const p = structuredClone(export0.dungeon);
  edit?.(p);
  return JSON.stringify(p);
}

const level = (m: DDMap) => m.world.levels[0];
const wholeMap = (m: DDMap): PictureRect => ({ rect: [0, 0, m.world.width * GRID, m.world.height * GRID] });

describe("a Dungeon export brought into Table", () => {
  it("carries its map data as the picture's project file, with the export's grid", async () => {
    const map = parseUniversalVtt(FIXTURE, "Old Keep.dd2vtt");
    expect(map.ddFrom).toBe("dungeon");
    expect(map.dd?.name).toBe("Old Keep.dd2vtt");
    expect(looksLikeDungeon(await map.dd!.text())).toBe(true);
    expect([map.cols, map.rows, map.pxPerCell]).toEqual([36, 24, 128]);
    expect(map.vtt?.resolution.map_size).toEqual({ x: 36, y: 24 });
    expect(map.vtt?.portals).toHaveLength(8);
  });

  it("leaves other Universal VTT files as they were", () => {
    const plain = JSON.parse(FIXTURE);
    delete plain.dungeon;
    const map = parseUniversalVtt(JSON.stringify(plain), "plain.dd2vtt");
    expect(map.dd).toBeUndefined();
    expect(map.ddFrom).toBeUndefined();
  });
});

describe("reading Dungeon's map as Dungeondraft's", () => {
  const { map, sizes } = parseDungeonPayload(payload());
  const L = level(map);

  it("is one level the size of the map", () => {
    expect([map.world.width, map.world.height, map.world.levels.length]).toEqual([36, 24, 1]);
    expect(L.key).toBe("0");
  });

  it("names its ground textures so their roles come out right", () => {
    const t = L.terrain!;
    expect(t.slots.slice(0, 4).map((r) => terrainRole(defaultName(r)))).toEqual([TR.GRASS, TR.EARTH, TR.ROCK, TR.SAND]);
    // Every texel's weights add up to 255, and the painted road shows in its slot.
    const n = t.width * t.height;
    for (let i = 0; i < n; i += 97) expect(t.weights[i] + t.weights[n + i] + t.weights[2 * n + i] + t.weights[3 * n + i]).toBe(255);
    const road = 9 * 4 * t.width + 2 * 4; // the dirt road at (2, 9)
    expect(t.weights[n + road]).toBeGreaterThan(100);
  });

  it("keeps the cave as Dungeondraft's lattice bitmap, its edge a cave wall", () => {
    const c = L.cave!.floor!;
    expect([c.width, c.height, c.step]).toEqual([36 * 4 + 3, 24 * 4 + 3, 64]);
    const at = (x: number, y: number) => c.bits[(y * 4 + 1) * c.width + (x * 4 + 1)];
    expect(at(29, 9)).toBe(1);
    expect(at(10, 8)).toBe(0);
    expect(L.walls.filter((w) => w.type === 2)).toHaveLength(1);
  });

  it("nests the water, puts the floors and walls where Dungeon draws them, doors in their walls", () => {
    expect(L.water.root!.children).toHaveLength(1);
    expect(L.water.root!.children[0].depth).toBe(1);
    expect(L.floorPolygons.length).toBe(4);
    expect(L.walls.map((w) => [w.type, w.loop])).toEqual([[0, true], [1, false], [1, false], [1, false], [2, true]]);
    expect(L.walls.flatMap((w) => w.portals)).toHaveLength(8);
    expect(L.portals).toHaveLength(0);
    // The Great Hall's double door: on the room's outline, two squares wide, closed.
    const door = L.walls[0].portals.find((p) => p.position.x === 4 * GRID && p.position.y === 8 * GRID)!;
    expect([door.radius, door.closed, door.wallId]).toEqual([GRID, true, L.walls[0].nodeId]);
  });

  it("names its objects and paths so seasons know the trees from the furniture", () => {
    const roles = new Map(L.objects.map((o) => [defaultName(o.texture), objectRole(defaultName(o.texture))]));
    expect(roles.get("dungeon/tree")).toBe(OR.DECIDUOUS);
    expect(roles.get("dungeon/pine")).toBe(OR.EVERGREEN);
    expect(roles.get("dungeon/bush")).toBe(OR.SHRUB);
    expect(roles.get("dungeon/boulder")).toBe(OR.ROCK);
    expect(roles.get("dungeon/log")).toBe(OR.DEADWOOD);
    expect(roles.get("dungeon/campfire")).toBe(OR.FIRE);
    expect(roles.get("dungeon/table")).toBe(OR.STRUCTURE);
    expect(L.paths.map((p) => pathRole(defaultName(p.texture)))).toEqual([AR.PATH_EARTH]);
    expect(sizes["dungeon/tree"].r).toBe(Math.round(1.3 * GRID));
  });

  it("puts objects on Dungeondraft's layers: on the floor 100, standing 200, overhead 700", () => {
    const layerOf = (name: string, m: DDMap) => level(m).objects.find((o) => defaultName(o.texture) === name)!.layer;
    expect(layerOf("dungeon/rug", map)).toBe(100);
    expect(layerOf("dungeon/tree", map)).toBe(200);
    const raised = parseDungeonPayload(payload((p) => p.objects.forEach((o: any) => o.asset === "b:tree" && (o.layer = "canopy")))).map;
    expect(layerOf("dungeon/tree", raised)).toBe(700);
  });

  it("refuses an older payload, a newer one and damaged ones", () => {
    expect(() => parseDungeonPayload(payload((p) => (p.payloadVersion = 1)))).toThrow(DungeonVersionError);
    expect(() => parseDungeonPayload(payload((p) => (p.payloadVersion = 3)))).toThrow(DungeonVersionError);
    expect(() => parseDungeonPayload("{ not json")).toThrow(DDParseError);
    expect(() => parseDungeonPayload(payload((p) => (p.width = 9999)))).toThrow(DDParseError);
    expect(() => parseDungeonPayload(payload((p) => (p.format = "other")))).toThrow(DDParseError);
  });
});

describe("floors with holes", () => {
  /** Nonzero winding of (x, y) by an interleaved ring. */
  function winding(r: Float64Array, x: number, y: number): number {
    let w = 0;
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [x0, y0, x1, y1] = [r[2 * j], r[2 * j + 1], r[2 * i], r[2 * i + 1]];
      if (y0 <= y && y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) w++;
      else if (y0 > y && y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) w--;
    }
    return w;
  }
  const sq = (x0: number, y0: number, x1: number, y1: number) => Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1]);

  it("keeps each hole open when filled nonzero", () => {
    const ring = withHoles(sq(0, 0, 10, 10), [sq(2, 2, 4, 4), sq(6, 6, 8, 8)]);
    // The extractor turns a ring positive before filling it.
    const pos = signedArea(ring) < 0 ? Float64Array.from(ring).reverse() : ring;
    const filled = (x: number, y: number) => winding(pos, x, y) !== 0 || winding(ring, x, y) !== 0;
    expect(filled(5, 5)).toBe(true);
    expect(filled(1, 9)).toBe(true);
    expect(winding(ring, 3, 3)).toBe(0);
    expect(winding(ring, 7, 7)).toBe(0);
    expect(Math.abs(signedArea(ring))).toBeCloseTo(100 - 4 - 4);
  });

  it("comes through from Dungeon's cut-away rooms", () => {
    const { map } = parseDungeonPayload(
      payload((p) => {
        p.floors = [{ material: "tiles", shape: [[[[1, 1], [9, 1], [9, 9], [1, 9]], [[4, 4], [6, 4], [6, 6], [4, 6]]]] }];
      }),
    );
    const [ring] = level(map).floorPolygons;
    expect(Math.abs(signedArea(ring))).toBeCloseTo((64 - 4) * GRID * GRID);
    expect(winding(ring, 5 * GRID, 5 * GRID)).toBe(0);
  });
});

describe("compiling a Dungeon map's season data", () => {
  it("lines up with the whole picture, is never held, and has its roles", () => {
    const { map, sizes } = parseDungeonPayload(payload());
    const pic = fakeExportFromMap(map, "0", 16);
    const { sidecar, report } = extractSidecar(map, "0", wholeMap(map), pic, { ...SPRITE_SIZES, ...sizes }, { levels: [], placed: true, shift: [0, 0] });
    expect(report.hold).toBeNull();
    expect(report.placed).toBe(true);
    expect(report.shifted).toBeUndefined();
    expect(report.drawn).toBe("green");
    const areas = new Set(sidecar.shapes.map((s) => s.role));
    for (const r of [AR.WATER, AR.FLOOR, AR.WALL, AR.PATH_EARTH]) expect(areas.has(r)).toBe(true);
    const objRoles = new Set(Array.from(sidecar.objects.role));
    for (const r of [OR.DECIDUOUS, OR.EVERGREEN, OR.SHRUB, OR.ROCK]) expect(objRoles.has(r)).toBe(true);
  });

  it("isn't held even when the picture can't be checked against it (a Dungeondraft file would be)", () => {
    const { map, sizes } = parseDungeonPayload(payload());
    const real = fakeExportFromMap(map, "0", 16);
    const blank = { ...real, rgba: new Uint8ClampedArray(real.rgba.length).fill(128) };
    const all = { ...SPRITE_SIZES, ...sizes };
    expect(extractSidecar(map, "0", wholeMap(map), blank, all, { levels: [] }).report.hold).toBe("fit");
    const placed = extractSidecar(map, "0", wholeMap(map), blank, all, { levels: [], placed: true, shift: [0, 0] }).report;
    expect(placed.fit.verdict).toBe("no");
    expect(placed.hold).toBeNull();
  });

  it("melts a snowy Dungeon map's ground for summer, and leaves its room floors as drawn", () => {
    const { map, sizes } = parseDungeonPayload(payload((p) => (p.terrain.base = "snow")));
    const pps = 16;
    const pic = fakeExportFromMap(map, "0", pps);
    const { sidecar, report } = extractSidecar(map, "0", wholeMap(map), pic, { ...SPRITE_SIZES, ...sizes }, { levels: [], placed: true, shift: [0, 0] });
    expect(report.drawn).toBe("winter");
    const a = analyseExact(pic.rgba, pic.w, pic.h, pps, sidecar, {});
    const img = new Uint8ClampedArray(pic.rgba);
    bake(img, pic.w, pic.h, { x0: 0, y0: 0, scale: 1, cell: pps, seed: 7, look: "summer", level: 2, a, sceneW: pic.w, sceneH: pic.h });
    const px = (x: number, y: number) => (Math.floor(y * pps) * pic.w + Math.floor(x * pps)) * 4;
    const same = (k: number) => [0, 1, 2].every((c) => img[k + c] === pic.rgba[k + c]);
    expect(same(px(12.6, 8.3))).toBe(true); // inside the Great Hall: the floor stays as drawn
    expect(same(px(2, 12.5))).toBe(false); // open ground: the snow melts
  });
});

describe("the attach worker with a Dungeon map", () => {
  async function prepare(text: string): Promise<DdWorkerOut[]> {
    const { map } = parseDungeonPayload(payload());
    const pic = fakeExportFromMap(map, "0", 24);
    const out: DdWorkerOut[] = [];
    const file = new File([text], "Old Keep.dd2vtt", { type: "application/json" });
    const vtt = parseUniversalVtt(FIXTURE, "Old Keep.dd2vtt").vtt;
    await handleDdMessage({ t: "prepare", id: 3, file, pic, picW: pic.w, picH: pic.h, vtt }, (m) => out.push(m));
    return out;
  }

  it("compiles it without the GM checking anything", async () => {
    const posts = await prepare(payload());
    const done = posts.find((m) => m.t === "prepared");
    if (!done || done.t !== "prepared") throw new Error(JSON.stringify(posts.filter((m) => m.t === "error")));
    expect(done.report.placed).toBe(true);
    expect(done.report.hold).toBeNull();
    expect(done.report.levels).toHaveLength(1);
    expect(done.sidecar.length).toBeGreaterThan(0);
  });

  it("says when the export came from an older Dungeon", async () => {
    const posts = await prepare(payload((p) => (p.payloadVersion = 1)));
    expect(posts.at(-1)).toMatchObject({ t: "error", message: DD_TEXT.dungeonOld("Old Keep.dd2vtt") });
  });

  it("says when its data is damaged", async () => {
    const posts = await prepare(payload((p) => (p.width = "wide")));
    expect(posts.at(-1)).toMatchObject({ t: "error", message: DD_TEXT.dungeonDamaged("Old Keep.dd2vtt") });
  });
});

describe("where the data came from", () => {
  it("is kept on the scene, and nothing else is", () => {
    const md = { assetId: "side1", forAssetId: "map1", from: "dungeon" };
    expect(sanitizeMapData(md)).toEqual(md);
    expect(sanitizeMapData({ ...md, from: "elsewhere" })).toBeUndefined();
    expect(sanitizeMapData({ assetId: "side1", forAssetId: "map1" })).toEqual({ assetId: "side1", forAssetId: "map1" });
  });

  it("is what the Season box says, with no project file to attach again", () => {
    const states = ["ok", "loading", "green", "paused", "retrying", "missing", "unreadable", "newer"] as const;
    for (const state of states) {
      for (const olderExtractor of [false, true]) {
        const note = dataNote(state, { hasMap: true, olderExtractor, fromDungeon: true })!;
        const text = note.map((p) => (typeof p === "string" ? p : p.label)).join("");
        expect(text, state).toContain("Dungeon");
        expect(text, state).not.toContain("Dungeondraft");
        expect(note.some((p) => typeof p !== "string" && p.action === "reattach"), state).toBe(false);
      }
    }
    // Without fromDungeon, the Dungeondraft wording as before.
    expect(JSON.stringify(dataNote("ok", { hasMap: true }))).toContain("Dungeondraft data");
  });

  it("is what the import report says", () => {
    const base = parseDungeonPayload(payload());
    const pic = fakeExportFromMap(base.map, "0", 16);
    const { report } = extractSidecar(base.map, "0", wholeMap(base.map), pic, { ...SPRITE_SIZES, ...base.sizes }, { levels: [], placed: true, shift: [0, 0] });
    expect(attachNote("Old Keep", { status: "ok", report })).toContain("map data from Dungeon attached");
    expect(attachNote("Old Keep", { status: "ok", report })).toContain("green maps");
    expect(attachNote("Old Keep", { status: "ok", report: { ...report, drawn: "winter" } })).toBe(
      "Old Keep: map data from Dungeon attached: seasons use its own ground, water and trees.",
    );
  });
});

// The M0 contracts of exact seasons from Dungeondraft data (design 7.1, 2.9, 3.2, 3.3, 5.3): the
// numbers every work package codes against. A change here is a format or convention change.
import { describe, expect, it } from "vitest";
import { ROLE_RADIUS, measureObjects } from "../src/client/dd/measure";
import type { Level, MapObject } from "../src/client/dd/model";
import { canUnpack } from "../src/client/dd/pngBox";
import { REACH_DIRS, rasterSidecar } from "../src/client/dd/raster";
import { AR, OR, TR, type ObjectRole } from "../src/client/dd/roles";
import {
  NO_NAME, OBJ_BYTES, OBJ_FLAG, REACH_N, SECTION, SIDECAR_CAPS, SIDECAR_FORMAT, SIDECAR_HEADER_BYTES, SIDECAR_MAGIC,
  SidecarError, decodeSidecar, encodeSidecar, readFormat, type SeasonSidecar,
} from "../src/client/dd/sidecar";
import { SPRITE_SIZES } from "../src/client/dd/spriteSizes";
import { EXACT_VERSION, SNOWY_SHARE, isSnowy } from "../src/client/room/seasonExact";
import type { ScenePatch } from "../src/shared/protocol";
import type { AssetKind, Scene, SceneMapData } from "../src/shared/types";

/** seasonPixels.ts's diamond(): a direction's position 0..4 around the square, clockwise from +x (y down). */
function diamond(dx: number, dy: number): number {
  const ad = Math.abs(dx) + Math.abs(dy);
  if (ad <= 0) return 0;
  return dy >= 0 ? (dx >= 0 ? dy / ad : 2 - dy / ad) : dx < 0 ? 2 - dy / ad : 4 + dy / ad;
}

const dir = (k: number): [number, number] => [REACH_DIRS[k * 2], REACH_DIRS[k * 2 + 1]];

describe("REACH_DIRS (2.9)", () => {
  it("holds 16 unit vectors", () => {
    expect(REACH_DIRS).toBeInstanceOf(Float64Array);
    expect(REACH_DIRS.length).toBe(REACH_N * 2);
    for (let k = 0; k < 16; k++) expect(Math.hypot(...dir(k))).toBeCloseTo(1, 12);
  });

  it("puts sample k at the centre of the pixel path's sector k (diamond position k + 0.5)", () => {
    for (let k = 0; k < 16; k++) {
      const [x, y] = dir(k);
      expect(diamond(x, y) * 4).toBeCloseTo(k + 0.5, 12);
      expect(Math.floor(diamond(x, y) * 4) & 15).toBe(k);
    }
  });

  it("follows the design's formula per quadrant", () => {
    for (let k = 0; k < 16; k++) {
      const p = ((k & 3) + 0.5) / 4;
      const v = [[1 - p, p], [-p, 1 - p], [p - 1, -p], [p, p - 1]][k >> 2];
      const len = Math.hypot(v[0], v[1]);
      expect(dir(k)[0]).toBeCloseTo(v[0] / len, 14);
      expect(dir(k)[1]).toBeCloseTo(v[1] / len, 14);
    }
  });

  it("starts just below +x and turns clockwise on screen (x right, y down)", () => {
    const [x0, y0] = dir(0);
    expect(x0).toBeGreaterThan(0.9);
    expect(y0).toBeGreaterThan(0);
    // Sample 4 points down, 8 left, 12 up (each a quarter turn on from its quadrant's start).
    expect(dir(4)[1]).toBeGreaterThan(0.9);
    expect(dir(8)[0]).toBeLessThan(-0.9);
    expect(dir(12)[1]).toBeLessThan(-0.9);
    for (let k = 0; k < 16; k++) {
      const [ax, ay] = dir(k), [bx, by] = dir((k + 1) & 15);
      expect(ax * by - ay * bx).toBeGreaterThan(0); // positive with y down: clockwise as seen
      // Four samples on is a quarter turn clockwise: (x, y) -> (-y, x).
      const [cx, cy] = dir((k + 4) & 15);
      expect(cx).toBeCloseTo(-ay, 14);
      expect(cy).toBeCloseTo(ax, 14);
    }
  });
});

describe("roles (7.1)", () => {
  const tables = { TR, AR, OR } as Record<string, Record<string, number>>;
  it.each(Object.keys(tables))("%s values are distinct bytes from 1", (name) => {
    const values = Object.values(tables[name]);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(255);
    }
    expect(Math.max(...values)).toBe(values.length);
  });

  it("gives every object role a positive prior radius, and a pack item the 1.5-square disc", () => {
    for (const role of Object.values(OR)) expect(ROLE_RADIUS[role]).toBeGreaterThan(0);
    expect(Object.keys(ROLE_RADIUS)).toHaveLength(Object.keys(OR).length);
    expect(ROLE_RADIUS[OR.OPAQUE]).toBe(384);
    expect(Object.isFrozen(ROLE_RADIUS)).toBe(true);
  });
});

describe("sidecar (3.3, 7.1)", () => {
  it("has the caps of 7.1", () => {
    expect(SIDECAR_CAPS).toEqual({
      bytes: 8_388_608, terrainBytes: 6_291_456, points: 400_000, rings: 20_000, objects: 20_000,
      bitmaps: 16, bitmapBits: 4_194_304, names: 2000, nameChars: 120, metaBytes: 16_384,
    });
    expect(SIDECAR_CAPS.bytes).toBe(8 * 1024 * 1024);
    expect(SIDECAR_CAPS.terrainBytes).toBe(6 * 1024 * 1024);
    expect(SIDECAR_CAPS.bitmapBits).toBe(4 * 1024 * 1024);
    expect(SIDECAR_CAPS.metaBytes).toBe(16 * 1024);
    // 20,000 objects at 47 bytes fit the payload (the design's 940 KB).
    expect(SIDECAR_CAPS.objects * OBJ_BYTES).toBe(940_000);
  });

  it("has the header, section tags and flags of the layout", () => {
    expect(SIDECAR_FORMAT).toBe(1);
    expect(SIDECAR_MAGIC).toBe("TTSD");
    expect(SIDECAR_HEADER_BYTES).toBe(4 + 2 + 2 + 4 + 4);
    expect(SECTION).toEqual({ META: 1, TERR: 2, BITS: 3, SHAP: 4, OBJS: 5 });
    expect(OBJ_FLAG).toEqual({ MIRROR: 1, CAPPED: 2, TINTED: 4, MEASURED: 8 });
    expect(NO_NAME).toBe(0xffff);
    // role u8, layer i16, x i32, y i32, rot u8, flags u8, name u16, reach u16 x 16.
    expect(OBJ_BYTES).toBe(1 + 2 + 4 + 4 + 1 + 1 + 2 + 2 * REACH_N);
  });

  it("reads the format from a header, and nothing from other bytes", () => {
    const h = new Uint8Array(SIDECAR_HEADER_BYTES);
    h.set([0x54, 0x54, 0x53, 0x44, 2, 1]);
    expect(readFormat(h)).toBe(258);
    expect(readFormat(h.subarray(0, 15))).toBeNull();
    h[0] = 0x55;
    expect(readFormat(h)).toBeNull();
  });

  it("refuses bytes that aren't a sidecar with SidecarError, an Error by name", () => {
    expect(() => decodeSidecar(new Uint8Array(16))).toThrow(SidecarError);
    expect(new SidecarError("x")).toBeInstanceOf(Error);
    expect(new SidecarError("x").name).toBe("SidecarError");
  });

  it("can unpack where DecompressionStream exists", () => {
    expect(canUnpack()).toBe(typeof DecompressionStream === "function");
  });
});

describe("measurement priors (2.5)", () => {
  const obj = (sx: number, sy: number, rotation: number): MapObject => ({
    position: { x: 0, y: 0 }, rotation, scale: { x: sx, y: sy }, texture: null, mirror: false, layer: 100,
    shadow: false, blockLight: false, customColor: null, nodeId: null, index: 0,
  });
  const level = (objects: MapObject[]) => ({ objects }) as unknown as Level;
  const pic = { rgba: new Uint8ClampedArray(4), w: 1, h: 1 };
  const rect = { rect: [0, 0, 256, 256] as [number, number, number, number] };

  it("gives the role's circle times the scale, not measured", () => {
    const [m] = measureObjects(level([obj(-2, 2, 1)]), [OR.ROCK], pic, rect, null, SPRITE_SIZES);
    expect(m.measured).toBe(false);
    expect(m.present).toBeNull();
    expect(m.capped).toBe(false);
    for (const r of m.reach) expect(r).toBeCloseTo(ROLE_RADIUS[OR.ROCK] * 2, 3);
  });

  it("turns a stretched prior with the object's rotation", () => {
    const r = ROLE_RADIUS[OR.EVERGREEN];
    const [flat] = measureObjects(level([obj(2, 1, 0)]), [OR.EVERGREEN as ObjectRole], pic, rect, null, SPRITE_SIZES);
    const [turned] = measureObjects(level([obj(2, 1, Math.PI / 2)]), [OR.EVERGREEN as ObjectRole], pic, rect, null, SPRITE_SIZES);
    // The long axis lies along x, then along y after a quarter turn: sample 0 is near +x, sample 4 near +y.
    expect(flat.reach[0]).toBeGreaterThan(1.8 * r);
    expect(flat.reach[4]).toBeLessThan(1.1 * r);
    expect(turned.reach[4]).toBeCloseTo(flat.reach[0], 2);
  });

  it("keeps SPRITE_SIZES free of a prototype", () => {
    expect(SPRITE_SIZES["constructor"]).toBeUndefined();
    expect(SPRITE_SIZES["__proto__"]).toBeUndefined();
  });
});

describe("exact seasons runtime contract (4.2, 5.6)", () => {
  it("bakes exact scenes under version 1", () => {
    expect(EXACT_VERSION).toBe(1);
  });

  it("decides snowy by the GM's choice, else snow on half the open soft ground", () => {
    const meta = (snowShare: number) => ({ rect: [0, 0, 1, 1], squares: [1, 1], extractor: 1, snowShare, packShare: 0,
      packItems: 0, dropped: 0, names: [] }) as SeasonSidecar["meta"];
    expect(SNOWY_SHARE).toBe(0.5);
    expect(isSnowy(meta(0.5))).toBe(true);
    expect(isSnowy(meta(0.499))).toBe(false);
    expect(isSnowy(meta(1), "green")).toBe(false);
    expect(isSnowy(meta(0), "winter")).toBe(true);
  });
});

describe("SceneMapData (3.2)", () => {
  const full: SceneMapData = { assetId: "sidecar00001", forAssetId: "picture00001", bare: "dead", drawn: "winter", hold: true, packs: "guess" };

  it("round-trips through JSON, with and without its optional fields", () => {
    expect(JSON.parse(JSON.stringify(full))).toEqual(full);
    const bare: SceneMapData = { assetId: "a", forAssetId: "b" };
    expect(JSON.parse(JSON.stringify(bare))).toEqual(bare);
    expect(Object.keys(JSON.parse(JSON.stringify(bare)))).toEqual(["assetId", "forAssetId"]);
  });

  it("rides on a scene, and a scene without it serialises as before", () => {
    const scene = {
      id: "s", name: "Waterfall", order: 0, mapAssetId: "picture00001", width: 100, height: 100, background: "#000",
      grid: { size: 50, offsetX: 0, offsetY: 0, show: true, snap: true, color: "#000", opacity: 1, unit: 5, unitName: "ft", diagonal: "chebyshev" },
      fogCover: false, createdAt: 1,
    } satisfies Scene;
    const withData: Scene = { ...scene, mapData: full, mapRect: [2, 1, 12, 8] };
    expect(JSON.parse(JSON.stringify(withData))).toEqual(withData);
    expect(JSON.stringify(scene)).not.toMatch(/mapData|mapRect/);
  });

  it("clears with null in a scene patch, and mapdata is an asset kind", () => {
    const clear: ScenePatch = { id: "s", mapData: null, mapRect: null };
    expect(JSON.parse(JSON.stringify(clear))).toEqual({ id: "s", mapData: null, mapRect: null });
    const kinds: AssetKind[] = ["map", "token", "mapdata"];
    expect(kinds).toContain("mapdata");
  });
});

describe("the test run", () => {
  it("shows a passing test's console output (timings, verdicts) only with VERBOSE=1 or PERF=1, so npm test and a deploy stay quiet", async () => {
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const config = fs.readFileSync(new URL("../vitest.config.ts", import.meta.url), "utf8");
    expect(config).toContain("const verbose = !!(process.env.VERBOSE || process.env.PERF);");
    expect(config).toContain('silent: verbose ? false : "passed-only",');
    // And the README says how to run the Dungeondraft tests elsewhere.
    const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const word of ["DD_FIXTURES", "DD_VERN", "VERBOSE=1", "PERF=1", "scripts/dd/register.mjs", "mapdata"]) expect(readme).toContain(word);
  });
});

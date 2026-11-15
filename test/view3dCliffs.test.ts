// Cliffs in the 3D view: a Dungeondraft map's own cliff paths kept apart in its map data (the
// sidecar's CLIF section: dd/extract.ts cliffLines, dd/sidecar.ts), read without upsetting
// anything that reads sidecars, and stood up as rock (room/view3dCliffs.ts).
import { describe, expect, it } from "vitest";
import { parseDungeondraftMap } from "../src/client/dd/parse";
import { GRID } from "../src/client/dd/model";
import { isCliffPath, AR } from "../src/client/dd/roles";
import { SECTION, SIDECAR_UNITS, decodeSidecar, encodeSidecar, type SeasonSidecar } from "../src/client/dd/sidecar";
import { cliffLines, extractSidecar, pictureRect } from "../src/client/dd/extract";
import { WALL_SEEN, type CoverMap } from "../src/client/room/view3dModel";
import { CLIFF_HIGHEST, CLIFF_LOWEST, cliffHeight, cliffMesh, mapCliffs, resample } from "../src/client/room/view3dCliffs";
import { FIXTURE_SPRITES, mapText } from "./fixtures/ddSynthetic";
import { fakeExportFromMap } from "./fixtures/fakeExport";

const CELL = 100;

/** A 16 by 12 square snowy map with one path across it, extracted as attaching would. */
function withPath(texture: string) {
  const text = mapText({
    w: 16,
    h: 12,
    currentLevel: 0,
    levels: [
      {
        key: "1",
        label: "Ground",
        terrain: { slots: ["terrain_snow", "terrain_dirt"], weights: () => [255, 0] },
        paths: [{ at: [0, 6], pts: [[1, 0], [6, 0.5], [12, 0]], texture, width: 1 }],
      },
    ],
  });
  const map = parseDungeondraftMap(text);
  const picture = fakeExportFromMap(map, "1", 32);
  const rect = pictureRect(map, picture.w, picture.h);
  if ("error" in rect) throw new Error(rect.error);
  return extractSidecar(map, "1", rect, picture, FIXTURE_SPRITES, { levels: [] }).sidecar;
}

describe("cliffs in the map data", () => {
  it("knows Dungeondraft's own cliffs by name, and not ropes, chains or a pack's", () => {
    expect(isCliffPath("cliff_snow")).toBe(true);
    expect(isCliffPath("cliffs/cliffs_02")).toBe(true);
    expect(isCliffPath("rope")).toBe(false);
    expect(isCliffPath("chain_iron")).toBe(false);
    expect(isCliffPath(null)).toBe(false);
  });

  it("keeps a cliff path's centre line and width when a map is attached", () => {
    const sc = withPath("cliff_snow");
    expect(sc.cliffs).toHaveLength(1);
    const [c] = sc.cliffs!;
    // Width 1 square: half a square each side.
    expect(c.halfWidth).toBeCloseTo(GRID / 2, -1);
    // It runs from about square 1 to square 12, at about row 6.
    const xs = Array.from(c.pts.filter((_, i) => i % 2 === 0)).map((v) => v / SIDECAR_UNITS.coord / GRID);
    const ys = Array.from(c.pts.filter((_, i) => i % 2 === 1)).map((v) => v / SIDECAR_UNITS.coord / GRID);
    expect(Math.min(...xs)).toBeCloseTo(1, 0);
    expect(Math.max(...xs)).toBeCloseTo(12, 0);
    for (const y of ys) expect(Math.abs(y - 6.2)).toBeLessThan(0.6);
    // Seasons see it as before: a path kept as drawn.
    expect(sc.shapes.some((s) => s.role === AR.PATH_KEEP)).toBe(true);
  });

  it("keeps nothing apart for a path that isn't a cliff", () => {
    expect(withPath("rope").cliffs).toBeUndefined();
  });

  it("carries cliffs through the sidecar's bytes and back", () => {
    const sc = withPath("cliff_snow");
    const back = decodeSidecar(encodeSidecar(sc));
    expect(back.cliffs).toHaveLength(1);
    expect(Array.from(back.cliffs![0].pts)).toEqual(Array.from(sc.cliffs![0].pts));
    expect(back.cliffs![0].halfWidth).toBe(sc.cliffs![0].halfWidth);
  });

  it("writes a map without cliffs byte for byte as before, and reads none back", () => {
    const sc = withPath("rope");
    const none = encodeSidecar(sc);
    expect(Array.from(encodeSidecar({ ...sc, cliffs: [] }))).toEqual(Array.from(none));
    expect(none.includes(SECTION.CLIF) && decodeSidecar(none).cliffs).toBeFalsy();
  });

  it("refuses a cliffs section whose lengths don't add up", () => {
    const sc: SeasonSidecar = withPath("cliff_snow");
    const bytes = encodeSidecar(sc);
    // Its point count, two bytes after the line count: claim far more points than there are.
    const at = clifStart(bytes);
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint32(at + 4 + 2, 99999, true);
    fixCrc(bad);
    expect(() => decodeSidecar(bad)).toThrow();
  });

  it("crops a cliff to the picture and a square round it, as everything else is", () => {
    const line = Float64Array.from([-1000, 100, 500, 100, 500, 900]);
    const lines = cliffLines({ line, halfWidth: Float64Array.from([64, 64, 64]), closed: false }, [0, 0, 400, 400]);
    expect(lines).toHaveLength(1);
    const pts = Array.from(lines[0].pts).map((v) => v / SIDECAR_UNITS.coord);
    expect(pts).toEqual([0, 100, 400, 100]);
    expect(lines[0].halfWidth).toBe(64);
  });
});

/** Where the CLIF section's body starts, by walking the sections. */
function clifStart(bytes: Uint8Array): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = 16; p < bytes.length;) {
    const tag = bytes[p], len = dv.getUint32(p + 1, true);
    if (tag === SECTION.CLIF) return p + 5;
    p += 5 + len;
  }
  throw new Error("no CLIF");
}

/** Sets a sidecar's CRC to match its payload again (so a test reaches the check it means). */
function fixCrc(bytes: Uint8Array): void {
  let c = ~0;
  for (let i = 16; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  new DataView(bytes.buffer).setUint32(12, ~c >>> 0, true);
}

describe("cliffs standing up", () => {
  const place = { rect: [0, 0, 16 * GRID, 12 * GRID] as const, width: 16 * CELL, height: 12 * CELL };
  const cliff = {
    halfWidth: GRID / 2,
    pts: Int32Array.from([2 * GRID, 6 * GRID, 12 * GRID, 6 * GRID].map((v) => v * SIDECAR_UNITS.coord)),
  };
  const [c3] = mapCliffs([cliff], place);

  it("puts a cliff where the picture paints it, as wide as it's drawn, in scene units", () => {
    expect(Array.from(c3.pts)).toEqual([200, 600, 1200, 600]);
    expect(c3.halfWidth).toBeCloseTo(50);
  });

  it("follows its line in half-square steps", () => {
    expect(resample(c3.pts, CELL).length / 2).toBe(21);
  });

  it("stands about 2.4 times its half width tall, within limits", () => {
    expect(cliffHeight(0.5)).toBeCloseTo(1.2);
    expect(cliffHeight(0.1)).toBe(CLIFF_LOWEST);
    expect(cliffHeight(5)).toBe(CLIFF_HIGHEST);
    const m = cliffMesh([c3], CELL, null, false, null);
    const ys = Array.from(m.position).filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeGreaterThan(0.9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(cliffHeight(0.5) * 1.2);
  });

  it("winds every face the way it faces, so WebGL draws its outside", () => {
    const m = cliffMesh([c3], CELL, null, false, null);
    for (let t = 0; t < m.position.length / 9; t++) {
      const p = (k: number) => [m.position[t * 9 + k * 3], m.position[t * 9 + k * 3 + 1], m.position[t * 9 + k * 3 + 2]];
      const [a, b, c] = [p(0), p(1), p(2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = [m.normal[t * 9], m.normal[t * 9 + 1], m.normal[t * 9 + 2]];
      expect(x[0] * n[0] + x[1] * n[1] + x[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it("stands up only the stretch a player has seen; the GM sees it all", () => {
    // Clear west of x = 700, covered east of it.
    const cover: CoverMap = { x0: 0, y0: 0, k: 1 / CELL, w: 16, h: 12, alpha: new Uint8ClampedArray(16 * 12).map((_, i) => (i % 16 < 7 ? 0 : 255)) };
    const player = cliffMesh([c3], CELL, cover, false, null);
    const xs = Array.from(player.position).filter((_, i) => i % 3 === 0);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(8);
    const gm = cliffMesh([c3], CELL, cover, true, null);
    expect(Math.max(...Array.from(gm.position).filter((_, i) => i % 3 === 0))).toBeGreaterThan(11.5);
    const hidden: CoverMap = { ...cover, alpha: new Uint8ClampedArray(16 * 12).fill(255) };
    expect(cliffMesh([c3], CELL, hidden, false, null).position.length).toBe(0);
    expect(WALL_SEEN).toBeGreaterThan(0);
  });

  it("takes the picture's colour where it runs", () => {
    const rgba = new Uint8ClampedArray(16 * 12 * 4);
    for (let i = 0; i < 16 * 12; i++) rgba.set([200, 210, 220, 255], i * 4);
    const m = cliffMesh([c3], CELL, null, false, { x0: 0, y0: 0, k: 1 / CELL, w: 16, h: 12, rgba });
    expect(m.color[2]).toBeGreaterThan(m.color[0]);
    expect(m.color[0]).toBeGreaterThan(0.6);
  });
});

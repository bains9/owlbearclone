// Scenery round an outdoor map in the 3D view (room/view3dScenery.ts): the sky in the day's weather,
// the ground running on to the horizon, and hills or mountain ranges by the weather region.
import { describe, expect, it } from "vitest";
import type { Weather } from "../src/shared/calendar";
import { edgeColour, groundMesh, rangeMesh, sceneryOf, skyAt, skyMesh } from "../src/client/room/view3dScenery";

const day = (over: Partial<Weather> = {}): Weather => ({
  low: 8, high: 18, precipitation: "none", kind: "rain", clouds: "clear", wind: "calm", from: "W", text: "", ...over,
});

describe("scenery round an outdoor map", () => {
  it("has none where the weather doesn't reach (indoors, underground)", () => {
    expect(sceneryOf("Temperate", null)).toBeNull();
  });

  it("paints a blue sky on a clear day and a grey one in the rain", () => {
    const clear = sceneryOf("Temperate", day())!;
    const wet = sceneryOf("Temperate", day({ precipitation: "heavy", clouds: "overcast" }))!;
    expect(clear.zenith[2]).toBeGreaterThan(clear.zenith[0] + 0.3);
    expect(Math.abs(wet.zenith[2] - wet.zenith[0])).toBeLessThan(0.15);
    // Heavy rain hides the far ranges in haze.
    expect(wet.haze).toBeGreaterThan(0.8);
    expect(clear.haze).toBe(0);
    expect(skyAt(clear, 0)).toEqual(clear.horizon);
    expect(skyAt(clear, 1)).toEqual(clear.zenith);
  });

  it("raises jagged, snow-capped peaks round a mountain map, low rolling hills elsewhere", () => {
    const mountains = sceneryOf("Mountains", day({ low: -10, high: -2 }))!;
    const temperate = sceneryOf("Temperate", day())!;
    expect(mountains.ranges[0].height).toBeGreaterThan(temperate.ranges[0].height * 1.5);
    expect(mountains.ranges[0].rough).toBeGreaterThan(temperate.ranges[0].rough);
    expect(mountains.ranges[0].snowline).toBeLessThan(0.6);
    // A warm temperate day has no snow on its hills, only on the far peaks' tips.
    expect(temperate.ranges.slice(1).every((r) => r.snowline > 1)).toBe(true);
    expect(temperate.ranges[0].snowline).toBeGreaterThanOrEqual(0.85);
    // A desert's are flat-topped.
    expect(sceneryOf("Hot desert", day({ low: 25, high: 40 }))!.ranges[0].plateau).toBeGreaterThan(0.5);
  });

  it("stands each range in a ring round the map, at its distance, rising from below the ground", () => {
    const s = sceneryOf("Mountains", day())!;
    const r = s.ranges[1];
    const m = rangeMesh(r, s, 10, 20, 30);
    expect(m.position.length).toBeGreaterThan(0);
    for (let i = 0; i < m.position.length; i += 3) {
      const d = Math.hypot(m.position[i] - 10, m.position[i + 2] - 20);
      expect(d).toBeCloseTo(r.dist * 30, 0);
      expect(m.position[i + 1]).toBeGreaterThanOrEqual(-0.5);
    }
    expect(Math.max(...Array.from(m.position).filter((_, i) => i % 3 === 1))).toBeGreaterThan(5);
  });

  it("leaves the sea's side of a coast open", () => {
    const s = sceneryOf("Coast", day())!;
    expect(s.sea).toBe(true);
    const m = rangeMesh(s.ranges[0], s, 0, 0, 30);
    // Nothing stands due south (+z, a quarter turn round).
    for (let i = 0; i < m.position.length; i += 3) {
      const a = Math.atan2(m.position[i + 2], m.position[i]);
      if (Math.abs(a - Math.PI / 2) < 0.2) expect(m.position[i + 1]).toBeLessThanOrEqual(0.01);
    }
  });

  it("runs the map's own ground out from its edges, fading into the horizon", () => {
    const s = sceneryOf("Temperate", day())!;
    const g = groundMesh(s, [0.2, 0.5, 0.2], 0, 0, 30, 200);
    // Near the map, its ground's colour; far off, the horizon's.
    let near = -1, far = -1, nearD = Infinity, farD = 0;
    for (let i = 0; i < g.position.length; i += 3) {
      const d = Math.hypot(g.position[i], g.position[i + 2]);
      if (d < nearD) [nearD, near] = [d, i];
      if (d > farD) [farD, far] = [d, i];
    }
    expect(g.color[near + 1]).toBeCloseTo(0.5, 1);
    expect(Math.abs(g.color[far] - s.horizon[0])).toBeLessThan(0.1);
    // Under the map's floor.
    expect(g.position[1]).toBeLessThan(0);
    expect(skyMesh(s, 0, 0, 100).position.length).toBeGreaterThan(0);
  });

  it("takes the ground's colour from the map's edges", () => {
    const w = 10, h = 10, rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) rgba.set(p % w > 2 && p % w < 7 && p >= 30 && p < 70 ? [0, 0, 0, 255] : [200, 210, 220, 255], p * 4);
    expect(edgeColour(rgba, w, h)!.map((v) => Math.round(v * 255))).toEqual([200, 210, 220]);
  });
});

describe("scenery and what players have seen", () => {
  it("gives nothing of a fogged map's edges away: only seen pixels count, none when too few are", () => {
    const w = 10, h = 10, rgba = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) rgba.set([200, 210, 220, 255], p * 4);
    expect(edgeColour(rgba, w, h, () => false)).toBeNull();
    expect(edgeColour(rgba, w, h, (x) => x < 5)!.map((v) => Math.round(v * 255))).toEqual([200, 210, 220]);
    // Then the land's own ground colour, white on a freezing day.
    expect(sceneryOf("Temperate", day({ low: -12, high: -4 }))!.ground[0]).toBeGreaterThan(0.8);
  });
});

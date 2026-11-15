// The day's weather in the 3D view (room/view3dWeather.ts): rain and snow for the weather the
// calendar gives the map, the wind's slant, mist, lightning in a storm, and what moves.
import { describe, expect, it } from "vitest";
import type { Weather } from "../src/shared/calendar";
import { RAIN_DROPS, SNOW_FLAKES, fallSpace, mistRange, nextLightning, scatter, stepFall, streaks, weatherLook } from "../src/client/room/view3dWeather";

const day = (w: Partial<Weather>): Weather => ({
  low: 5,
  high: 12,
  precipitation: "none",
  kind: "rain",
  clouds: "clear",
  wind: "calm",
  from: "west",
  text: "",
  ...w,
});
const desk = { reducedMotion: false, touch: false };

/** The same "random" numbers every time. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe("how the weather looks", () => {
  it("shows nothing on a clear dry day, or with no weather", () => {
    expect(weatherLook(null, desk)).toBeNull();
    expect(weatherLook(day({ clouds: "a few clouds" }), desk)).toBeNull();
  });

  it("rains, harder in heavy rain, and snows", () => {
    const light = weatherLook(day({ precipitation: "light" }), desk)!;
    const heavy = weatherLook(day({ precipitation: "heavy" }), desk)!;
    expect(light.rain).toBe(RAIN_DROPS.light);
    expect(heavy.rain).toBe(RAIN_DROPS.heavy);
    expect(heavy.rainFall).toBeGreaterThan(light.rainFall);
    expect(light.snow).toBe(0);
    const snow = weatherLook(day({ precipitation: "heavy", kind: "snow" }), desk)!;
    expect(snow.snow).toBe(SNOW_FLAKES.heavy);
    expect(snow.rain).toBe(0);
    expect(snow.snowFall).toBeLessThan(light.rainFall);
  });

  it("makes sleet of both, fewer of each", () => {
    const sleet = weatherLook(day({ precipitation: "light", kind: "sleet" }), desk)!;
    expect(sleet.rain).toBeGreaterThan(0);
    expect(sleet.snow).toBeGreaterThan(0);
    expect(sleet.rain).toBeLessThan(RAIN_DROPS.light);
  });

  it("slants rain and blows snow harder the windier it is", () => {
    const calm = weatherLook(day({ precipitation: "light", wind: "calm" }), desk)!;
    const gale = weatherLook(day({ precipitation: "light", wind: "gale" }), desk)!;
    expect(calm.slant).toBe(0);
    expect(gale.slant).toBeGreaterThan(calm.slant);
    expect(gale.drift).toBeGreaterThan(calm.drift);
  });

  it("thickens the mist with overcast skies and heavy weather", () => {
    const overcast = weatherLook(day({ clouds: "overcast" }), desk)!;
    expect(overcast.rain + overcast.snow).toBe(0);
    expect(overcast.mist).toBeGreaterThan(0);
    const heavy = weatherLook(day({ clouds: "overcast", precipitation: "heavy" }), desk)!;
    expect(heavy.mist).toBeGreaterThan(overcast.mist);
    expect(heavy.mist).toBeLessThanOrEqual(0.85);
  });

  it("flashes lightning only in heavy rain with a strong wind", () => {
    expect(weatherLook(day({ precipitation: "heavy", wind: "gale" }), desk)!.lightning).toBe(true);
    expect(weatherLook(day({ precipitation: "heavy", wind: "windy" }), desk)!.lightning).toBe(true);
    expect(weatherLook(day({ precipitation: "heavy", wind: "breezy" }), desk)!.lightning).toBe(false);
    expect(weatherLook(day({ precipitation: "light", wind: "gale" }), desk)!.lightning).toBe(false);
    expect(weatherLook(day({ precipitation: "heavy", wind: "gale", kind: "snow" }), desk)!.lightning).toBe(false);
  });

  it("keeps still on a device set to reduce motion: no falling, no flashes, the mist only", () => {
    const still = weatherLook(day({ precipitation: "heavy", wind: "gale", clouds: "overcast" }), { reducedMotion: true, touch: false })!;
    expect(still.rain).toBe(0);
    expect(still.snow).toBe(0);
    expect(still.lightning).toBe(false);
    expect(still.mist).toBeGreaterThan(0);
  });

  it("drops half as many on a phone or tablet", () => {
    expect(weatherLook(day({ precipitation: "heavy" }), { reducedMotion: false, touch: true })!.rain).toBe(RAIN_DROPS.heavy / 2);
  });
});

describe("what moves", () => {
  it("falls, and starts again at the top once it reaches the floor, inside the space", () => {
    const rand = seeded(7);
    const pos = scatter(500, rand);
    const before = Array.from(pos);
    stepFall(pos, 0.1, 1.5, 0.2, rand);
    let fell = 0;
    for (let i = 0; i < pos.length; i += 3) {
      expect(pos[i]).toBeGreaterThanOrEqual(-0.5);
      expect(pos[i]).toBeLessThanOrEqual(0.5);
      expect(pos[i + 1]).toBeGreaterThanOrEqual(0);
      expect(pos[i + 1]).toBeLessThanOrEqual(1);
      expect(pos[i + 2]).toBeGreaterThanOrEqual(-0.5);
      expect(pos[i + 2]).toBeLessThanOrEqual(0.5);
      if (pos[i + 1] < before[i + 1]) fell++;
    }
    // Most moved down; those near the floor came back in at the top.
    expect(fell).toBeGreaterThan(300);
    expect(fell).toBeLessThan(500);
  });

  it("blows along with the wind, wrapping round at the side", () => {
    const pos = new Float32Array([0.49, 0.5, 0, -0.2, 0.5, 0]);
    stepFall(pos, 1, 0, 0.1, seeded());
    expect(pos[0]).toBeCloseTo(-0.41);
    expect(pos[3]).toBeCloseTo(-0.1);
  });

  it("draws each drop as a streak up the way it came, leaning with the wind", () => {
    const out = new Float32Array(6);
    streaks(new Float32Array([0.1, 0.4, 0.2]), out, 0.05, 0.3);
    expect(Array.from(out).map((v) => Number(v.toFixed(3)))).toEqual([0.1, 0.4, 0.2, 0.085, 0.45, 0.2]);
  });

  it("falls through a space round the view that widens as the camera stands back", () => {
    expect(fallSpace(5)).toBe(10);
    expect(fallSpace(30)).toBe(42);
    expect(fallSpace(500)).toBe(70);
  });

  it("starts the mist further off when it's thin", () => {
    const thin = mistRange(0.1, 20), thick = mistRange(0.8, 20);
    expect(thin.near).toBeGreaterThan(thick.near);
    expect(thin.far).toBeGreaterThan(thick.far);
    expect(thick.far).toBeGreaterThan(thick.near);
  });

  it("flashes every 5 to 14 seconds", () => {
    expect(nextLightning(() => 0)).toBe(5000);
    expect(nextLightning(() => 0.999)).toBeLessThan(14000);
  });
});

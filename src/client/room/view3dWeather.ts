// The day's weather in the 3D view (view3dWeatherFx.ts draws it): rain and snow falling through
// the scene, slanted and blown by the wind, mist that thickens with heavy weather and overcast
// skies, and lightning in a storm. The weather is the calendar's, where it falls on this map
// (shared/calendar.ts weatherOf and weatherHere): the 2D map shows the same rain and snow, flat.
// Here, what it looks like and how it moves, kept apart from three.js so it's tested.

import type { Weather } from "../../shared/calendar";

export interface WeatherLook {
  /** Rain drops and snowflakes falling at once (sleet has both). */
  rain: number;
  snow: number;
  /** How fast they fall: heights of the falling space per second. */
  rainFall: number;
  snowFall: number;
  /** How far the wind blows rain sideways for each height it falls, and snow sideways per second. */
  slant: number;
  drift: number;
  /** 0 clear to 1 thick: how much the far part of the map fades into the weather. */
  mist: number;
  /** The colour it fades into (the sky's). */
  mistColor: string;
  /** A storm: now and then the sky flashes. */
  lightning: boolean;
}

const SLANT: Record<Weather["wind"], number> = { calm: 0, "light wind": 0.06, breezy: 0.14, windy: 0.26, gale: 0.42 };
const DRIFT: Record<Weather["wind"], number> = { calm: 0.01, "light wind": 0.03, breezy: 0.06, windy: 0.1, gale: 0.16 };
const CLOUD_MIST: Record<Weather["clouds"], number> = { clear: 0, "a few clouds": 0, cloudy: 0.08, overcast: 0.2 };

/** Drops (or flakes) for light and heavy weather, on a computer; a phone or tablet has half. */
export const RAIN_DROPS = { light: 900, heavy: 2200 } as const;
export const SNOW_FLAKES = { light: 700, heavy: 1700 } as const;

/**
 * How the weather looks in 3D, or null for none to show (no rain or snow, and clear or a few
 * clouds). On a device set to reduce motion nothing falls and the sky never flashes: only the mist
 * shows. A touch screen (a phone or tablet) gets half the drops, to stay quick.
 */
export function weatherLook(w: Weather | null, opts: { reducedMotion: boolean; touch: boolean }): WeatherLook | null {
  if (!w) return null;
  const wet = w.precipitation !== "none";
  let mist = CLOUD_MIST[w.clouds];
  if (wet) mist += w.precipitation === "heavy" ? 0.45 : 0.2;
  if (wet && w.kind === "snow" && w.precipitation === "heavy") mist += 0.1;
  mist = Math.min(0.85, mist);
  if (!wet && mist === 0) return null;
  const share = opts.reducedMotion ? 0 : opts.touch ? 0.5 : 1;
  const amount = w.precipitation === "none" ? null : w.precipitation;
  const rainy = wet && w.kind !== "snow";
  const snowy = wet && w.kind !== "rain";
  const both = rainy && snowy ? 0.6 : 1;
  return {
    rain: rainy && amount ? Math.round(RAIN_DROPS[amount] * share * both) : 0,
    snow: snowy && amount ? Math.round(SNOW_FLAKES[amount] * share * both) : 0,
    rainFall: amount === "heavy" ? 2.2 : 1.6,
    snowFall: amount === "heavy" ? 0.2 : 0.12,
    slant: SLANT[w.wind],
    drift: DRIFT[w.wind],
    mist,
    mistColor: snowy ? "#5d636c" : wet ? "#2c3138" : "#262a30",
    lightning: !opts.reducedMotion && rainy && w.precipitation === "heavy" && (w.wind === "windy" || w.wind === "gale"),
  };
}

/** The falling space, in squares, about what the camera looks at: wider the further back it stands. */
export function fallSpace(cameraDistance: number): number {
  return Math.max(10, Math.min(70, cameraDistance * 1.4));
}

/** How far the mist starts and ends, for a camera this far from what it looks at. */
export function mistRange(mist: number, cameraDistance: number): { near: number; far: number } {
  const clear = 1 - Math.max(0, Math.min(1, mist));
  return { near: cameraDistance * (1 + 2 * clear), far: cameraDistance * (2 + 8 * clear) };
}

/**
 * Moves falling things on by `dt` seconds. `pos` holds x, y, z for each, in the falling space's
 * own units: x and z from -0.5 to 0.5, y from 0 (the floor) to 1. Each falls `fall` a second and
 * blows `side` a second along x; one that reaches the floor starts again at the top somewhere new,
 * and one blown off a side comes back in at the other.
 */
export function stepFall(pos: Float32Array, dt: number, fall: number, side: number, rand: () => number): void {
  for (let i = 0; i + 2 < pos.length; i += 3) {
    let x = pos[i] + side * dt;
    let y = pos[i + 1] - fall * dt;
    let z = pos[i + 2];
    if (y < 0) {
      y += 1;
      if (y < 0) y = rand();
      x = rand() - 0.5;
      z = rand() - 0.5;
    }
    if (x > 0.5) x -= 1;
    else if (x < -0.5) x += 1;
    pos[i] = x;
    pos[i + 1] = y;
    pos[i + 2] = z;
  }
}

/** Things scattered through the falling space to begin with. */
export function scatter(count: number, rand: () => number): Float32Array {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = rand() - 0.5;
    pos[i + 1] = rand();
    pos[i + 2] = rand() - 0.5;
  }
  return pos;
}

/** A rain drop's streak, from where it is up along the way it came: a little line, leaning with the wind. */
export function streaks(heads: Float32Array, out: Float32Array, length: number, slant: number): void {
  for (let i = 0, j = 0; i + 2 < heads.length; i += 3, j += 6) {
    out[j] = heads[i];
    out[j + 1] = heads[i + 1];
    out[j + 2] = heads[i + 2];
    out[j + 3] = heads[i] - slant * length;
    out[j + 4] = heads[i + 1] + length;
    out[j + 5] = heads[i + 2];
  }
}

/** When the sky next flashes in a storm (ms from now): every 5 to 14 seconds. */
export function nextLightning(rand: () => number): number {
  return 5000 + rand() * 9000;
}

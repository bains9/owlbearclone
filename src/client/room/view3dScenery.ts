// Scenery round an outdoor map in the 3D view (view3d.ts): a sky, the ground running on from the
// map's edges to the horizon, and distant hills or mountain ranges in rings round it, so the map
// sits in a landscape rather than floating in the dark. How it looks follows the scene's weather
// region (snow-capped peaks for Mountains, white rolling hills for Tundra, mesas for a desert, green
// hills elsewhere), the season's cold (snow on the tops, the hills white in a cold winter) and the
// day's weather (a grey sky under cloud, far ranges fading into rain or snow, gone in a storm).
// Only where the weather reaches the map: none indoors, underground or in a cave. It's all far
// off and painted (unlit, the haze in its colours), and shows nothing of the map, so players see
// it as the GM does. Kept apart from three.js, so it's tested: here, the colours and shapes as arrays.

import type { Weather } from "../../shared/calendar";

type Rgb = [number, number, number];

/** One ring of hills or mountains round the map. */
export interface Range {
  /** How far off and how tall, in the map's radius (half its diagonal). */
  dist: number;
  height: number;
  /** 0 smooth rolling hills to 1 jagged peaks. */
  rough: number;
  /** 0 peaks to 1 flat-topped mesas. */
  plateau: number;
  colour: Rgb;
  /** Above this share of its height it's snow (more than 1: none). */
  snowline: number;
  seed: number;
}

export interface Scenery {
  /** The sky straight up and at the horizon. */
  zenith: Rgb;
  horizon: Rgb;
  ranges: Range[];
  /** A coast: the sea along part of the horizon (the side away from the hills). */
  sea: boolean;
  /** How much far things fade into the horizon's colour, beyond what distance does (the weather's). */
  haze: number;
}

const mix = (a: readonly number[], b: readonly number[], t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The sky's colours for the day's clouds and rain or snow. */
function sky(w: Weather): { zenith: Rgb; horizon: Rgb } {
  const wet = w.precipitation !== "none";
  if (wet && w.kind !== "rain") return { zenith: [0.62, 0.65, 0.7], horizon: [0.8, 0.82, 0.85] };
  if (wet) return { zenith: [0.42, 0.45, 0.5], horizon: [0.62, 0.65, 0.68] };
  if (w.clouds === "overcast") return { zenith: [0.52, 0.55, 0.6], horizon: [0.72, 0.74, 0.77] };
  if (w.clouds === "cloudy") return { zenith: [0.5, 0.6, 0.72], horizon: [0.78, 0.82, 0.86] };
  return { zenith: [0.33, 0.53, 0.8], horizon: [0.76, 0.85, 0.94] };
}

/** How the land round a region looks: its hills' shape and colour, and whether it's coast. */
function land(region: string | null): { tall: number; rough: number; plateau: number; colour: Rgb; snowy: boolean; sea: boolean; peaks: boolean } {
  const r = (region ?? "").toLowerCase();
  if (r.includes("mountain")) return { tall: 0.22, rough: 1, plateau: 0, colour: [0.36, 0.38, 0.42], snowy: true, sea: false, peaks: true };
  if (r.includes("tundra")) return { tall: 0.08, rough: 0.35, plateau: 0, colour: [0.62, 0.64, 0.66], snowy: true, sea: false, peaks: false };
  if (r.includes("cold desert")) return { tall: 0.09, rough: 0.4, plateau: 0.5, colour: [0.55, 0.5, 0.44], snowy: false, sea: false, peaks: false };
  if (r.includes("desert")) return { tall: 0.1, rough: 0.3, plateau: 0.8, colour: [0.72, 0.56, 0.38], snowy: false, sea: false, peaks: false };
  if (r.includes("savanna")) return { tall: 0.07, rough: 0.3, plateau: 0.6, colour: [0.6, 0.55, 0.36], snowy: false, sea: false, peaks: false };
  if (r.includes("coast")) return { tall: 0.1, rough: 0.5, plateau: 0, colour: [0.32, 0.42, 0.34], snowy: false, sea: true, peaks: false };
  if (r.includes("rainforest")) return { tall: 0.13, rough: 0.55, plateau: 0, colour: [0.2, 0.36, 0.24], snowy: false, sea: false, peaks: false };
  if (r.includes("marsh")) return { tall: 0.05, rough: 0.25, plateau: 0, colour: [0.32, 0.4, 0.32], snowy: false, sea: false, peaks: false };
  return { tall: 0.11, rough: 0.55, plateau: 0, colour: [0.3, 0.4, 0.32], snowy: false, sea: false, peaks: true };
}

/**
 * The scenery for a map in this weather region (null: the calendar's) on a day with this weather,
 * or null when there's none to show (`w` null: indoors, underground, or no weather here).
 */
export function sceneryOf(region: string | null, w: Weather | null): Scenery | null {
  if (!w) return null;
  const { zenith, horizon } = sky(w);
  const l = land(region);
  // Cold: snow on the tops, lower the colder; a hard frost whitens the hills.
  const cold = (w.low + w.high) / 2;
  const snowline = l.snowy ? (cold < -5 ? 0.15 : cold < 5 ? 0.4 : 0.6) : cold < -5 ? 0.35 : cold < 2 ? 0.65 : 2;
  const winterHills = cold < -2 ? mix(l.colour, [0.86, 0.88, 0.9], 0.55) : l.colour;
  const wet = w.precipitation !== "none";
  const haze = (wet ? (w.precipitation === "heavy" ? 0.85 : 0.45) : 0) + (w.clouds === "overcast" ? 0.15 : 0);
  const ranges: Range[] = [
    // Far off first: the tallest, palest; the nearest low and darkest.
    { dist: 7, height: l.tall * (l.peaks ? 2.6 : 1.4), rough: Math.min(1, l.rough + 0.2), plateau: l.plateau, colour: winterHills, snowline: l.peaks ? Math.min(snowline, cold < 12 ? 0.55 : 0.85) : snowline, seed: 11 },
    { dist: 4.6, height: l.tall * 1.3, rough: l.rough, plateau: l.plateau, colour: winterHills, snowline, seed: 23 },
    { dist: 3, height: l.tall * 0.55, rough: l.rough * 0.6, plateau: l.plateau * 0.5, colour: mix(winterHills, [0.12, 0.14, 0.12], 0.25), snowline: snowline + 0.15, seed: 37 },
  ];
  return { zenith, horizon, ranges, sea: l.sea, haze: Math.min(0.95, haze) };
}

/** 0 to 1, smooth along `t` (an angle's share of a turn) and the same for the same seed: layered waves. */
function ridgeNoise(t: number, seed: number, rough: number): number {
  let v = 0, amp = 1, total = 0;
  for (let o = 0; o < 5; o++) {
    const f = 3 * 2 ** o;
    const ph = Math.sin(seed * 12.9898 + o * 78.233) * 43758.5453;
    const phase = ph - Math.floor(ph);
    const wave = Math.sin((t * f + phase) * Math.PI * 2 + Math.sin((t * f * 0.5 + phase) * Math.PI * 2));
    // Smooth rolling hills, or sharp crests (peaks) the rougher the land.
    v += amp * ((0.5 + 0.5 * wave) * (1 - rough) + (1 - Math.abs(wave)) * rough);
    total += amp;
    amp *= 0.35 + rough * 0.3;
  }
  return v / total;
}

/**
 * A ring of hills or mountains round (`cx`, `cz`), `radius` being the map's (squares): an upright
 * band of `segs` pieces from below the ground to its ridge, coloured by height (snow above its
 * snowline) and faded into the horizon with distance and haze. On a coast the side facing `seaAt`
 * (a share of a turn) is left low, for the sea. Triangles: positions and colours, three a corner.
 */
export function rangeMesh(r: Range, s: Scenery, cx: number, cz: number, radius: number, segs = 240): { position: Float32Array; color: Float32Array } {
  const position: number[] = [], color: number[] = [];
  const dist = r.dist * radius;
  const top = r.height * radius * 2.5;
  // Aerial perspective: farther ranges, and hazier days, are nearer the sky's colour.
  const fade = Math.min(0.92, 0.22 + r.dist * 0.07 + s.haze * 0.6);
  const base = mix(r.colour, s.horizon, fade);
  const snow = mix([0.95, 0.96, 0.98], s.horizon, fade * 0.7);
  const foot = -0.5;
  const heightAt = (t: number) => {
    let n = ridgeNoise(t, r.seed, r.rough);
    if (r.plateau > 0) n = Math.min(n, 0.55 + (1 - r.plateau) * 0.45) * (1 + r.plateau * 0.3);
    // On a coast, the hills fall away on the sea's side (south, a quarter of a turn either way).
    let k = 1;
    if (s.sea) {
      const d = Math.abs(((t - 0.25 + 1.5) % 1) - 0.5) * 2;
      k = Math.min(1, Math.max(0, (d - 0.3) / 0.35));
    }
    return Math.max(0, top * (0.25 + 0.75 * n) * k);
  };
  const colourAt = (y: number): Rgb => (y > top * r.snowline ? snow : y > top * r.snowline * 0.85 ? mix(base, snow, 0.5) : base);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const a0 = t0 * Math.PI * 2, a1 = t1 * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * dist, z0 = cz + Math.sin(a0) * dist;
    const x1 = cx + Math.cos(a1) * dist, z1 = cz + Math.sin(a1) * dist;
    const h0 = heightAt(t0), h1 = heightAt(t1);
    if (h0 <= 0 && h1 <= 0) continue;
    // Facing the middle: wound so its front is towards the map.
    const quad: [number, number, number][] = [[x0, foot, z0], [x1, foot, z1], [x1, h1, z1], [x0, h0, z0]];
    const cols = [base, base, colourAt(h1), colourAt(h0)];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      position.push(...quad[k]);
      color.push(...cols[k]);
    }
  }
  return { position: Float32Array.from(position), color: Float32Array.from(color) };
}

/**
 * The ground round the map out to `outer` (squares), as rings round (`cx`, `cz`) a little below the
 * map: the map's own edge colour near it, fading into the horizon. On a coast, the sea's side is sea.
 */
export function groundMesh(s: Scenery, ground: Rgb, cx: number, cz: number, inner: number, outer: number, rings = 10, segs = 64): { position: Float32Array; color: Float32Array } {
  const position: number[] = [], color: number[] = [];
  const sea: Rgb = mix([0.16, 0.3, 0.42], s.horizon, 0.3);
  const at = (i: number, j: number): { p: [number, number, number]; c: Rgb } => {
    const f = j / rings;
    const r = inner * 0.5 + (outer - inner * 0.5) * f ** 1.5;
    const t = i / segs, a = t * Math.PI * 2;
    let c = mix(ground, s.horizon, Math.min(0.95, f ** 0.8 * (0.85 + s.haze * 0.15)));
    if (s.sea && r > inner * 1.3) {
      const d = Math.abs(((t - 0.25 + 1.5) % 1) - 0.5) * 2;
      if (d < 0.3) c = mix(sea, s.horizon, Math.min(0.9, f));
    }
    return { p: [cx + Math.cos(a) * r, -0.03, cz + Math.sin(a) * r], c };
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      // Facing up.
      for (const k of [0, 2, 1, 0, 3, 2]) {
        position.push(...v[k].p);
        color.push(...v[k].c);
      }
    }
  }
  return { position: Float32Array.from(position), color: Float32Array.from(color) };
}

/** The sky as a dome round (`cx`, `cz`), `radius` squares, coloured from the horizon up, with a band below the horizon in its colour. */
export function skyMesh(s: Scenery, cx: number, cz: number, radius: number, rings = 10, segs = 48): { position: Float32Array; color: Float32Array } {
  const position: number[] = [], color: number[] = [];
  // From below the horizon (-0.15 of a quarter turn) to straight up.
  const at = (i: number, j: number): { p: [number, number, number]; c: Rgb } => {
    const up = -0.15 + (1.15 * j) / rings;
    const el = (up * Math.PI) / 2, az = (i / segs) * Math.PI * 2;
    return {
      p: [cx + Math.cos(az) * Math.cos(el) * radius, Math.sin(el) * radius, cz + Math.sin(az) * Math.cos(el) * radius],
      c: skyAt(s, up),
    };
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        position.push(...v[k].p);
        color.push(...v[k].c);
      }
    }
  }
  return { position: Float32Array.from(position), color: Float32Array.from(color) };
}

/** The sky's colour at a height over the horizon (0 the horizon, 1 straight up). */
export function skyAt(s: Scenery, up: number): Rgb {
  return mix(s.horizon, s.zenith, Math.min(1, Math.max(0, up)) ** 0.6);
}

/** The middle colour of the map's paint along its edges (rgba, 0-255): the ground it runs on into. */
export function edgeColour(rgba: ArrayLike<number>, w: number, h: number): Rgb | null {
  const ch: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const q = (y * w + x) * 4;
    if (rgba[q + 3] < 128) return;
    for (let c = 0; c < 3; c++) ch[c].push(rgba[q + c]);
  };
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (x < band || y < band || x >= w - band || y >= h - band) take(x, y);
  }
  if (!ch[0].length) return null;
  return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1] / 255) as Rgb;
}

// Copied from Dungeon (src/render/noise.ts) by scripts/sync-dungeon-library.mjs, Dungeon 4445927. Change it there and run the script again.
// Tileable noise for textures that repeat without seams: every lattice wraps at its period.

export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A seeded random-number generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in 0..1 at (x, y) lattice units, repeating every `period` units. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const wrap = (v: number) => ((v % period) + period) % period;
  const x0 = wrap(xi);
  const x1 = wrap(xi + 1);
  const y0 = wrap(yi);
  const y1 = wrap(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * Fractal noise in 0..1 over a texture: (u, v) in 0..1 across the tile, `base` lattice cells
 * across it for the first octave, each next octave twice as fine.
 */
export function fbm(u: number, v: number, base: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = base;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u * period, v * period, period, seed + o * 101) * amp;
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  return sum / norm;
}

/** Ridged noise: sharp creases where plain noise crosses its middle, for cracks and rock. */
export function ridged(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = base;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(u * period, v * period, period, seed + o * 131);
    sum += (1 - Math.abs(n * 2 - 1)) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Tileable Worley (cell) noise: distances to the nearest and second-nearest feature point. */
export function worley(u: number, v: number, points: [number, number][]): { d1: number; d2: number; id: number } {
  let d1 = Infinity;
  let d2 = Infinity;
  let id = 0;
  for (let i = 0; i < points.length; i++) {
    let dx = Math.abs(u - points[i][0]);
    let dy = Math.abs(v - points[i][1]);
    if (dx > 0.5) dx = 1 - dx;
    if (dy > 0.5) dy = 1 - dy;
    const d = dx * dx + dy * dy;
    if (d < d1) {
      d2 = d1;
      d1 = d;
      id = i;
    } else if (d < d2) d2 = d;
  }
  return { d1: Math.sqrt(d1), d2: Math.sqrt(d2), id };
}

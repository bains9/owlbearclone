// Copied from Dungeon (src/render/textures.ts) by scripts/sync-dungeon-library.mjs, Dungeon 509abc4. Change it there and run the script again.
import { fbm, hash2, ridged, rng, valueNoise, worley } from "./noise";
import { css, mix, scale, type RGB } from "./color";

/** Texture tiles are this many pixels square and cover TILE_CELLS by TILE_CELLS grid cells. */
export const TILE_PX = 512;
export const TILE_CELLS = 2;
export const PX_PER_CELL = TILE_PX / TILE_CELLS;

export type MaterialGroup = "floor" | "terrain" | "wall";

export interface Material {
  id: string;
  name: string;
  group: MaterialGroup;
  /** A flat colour for swatches and for drawing before the texture is ready. */
  swatch: string;
  generate: (ctx: CanvasRenderingContext2D) => void;
}

const S = TILE_PX;

/** Fills the tile pixel by pixel; `fn` gets 0..1 tile coordinates and returns a colour. */
function pixels(ctx: CanvasRenderingContext2D, fn: (u: number, v: number, x: number, y: number) => RGB): void {
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = fn(x / S, y / S, x, y);
      const i = (y * S + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Multiplies what's drawn by noise, so laid-out shapes (stones, planks) look worn. */
function weather(ctx: CanvasRenderingContext2D, seed: number, amount: number, base = 6, fine = 0.08): void {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbm(u, v, base, 4, seed);
      const grain = hash2(x, y, seed + 7) - 0.5;
      const f = 1 + (n - 0.5) * amount + grain * fine;
      const i = (y * S + x) * 4;
      d[i] *= f;
      d[i + 1] *= f;
      d[i + 2] *= f;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Draws a shape at its place and again shifted by a tile, so it wraps across the edges. */
function wrapped(draw: (dx: number, dy: number) => void): void {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(dx, dy);
}

function speckle(ctx: CanvasRenderingContext2D, seed: number, count: number, colors: string[], rMin: number, rMax: number): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = rMin + r() * (rMax - rMin);
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    wrapped((dx, dy) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rad, rad * (0.6 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

// ---- Natural ground ----

function ground(a: RGB, b: RGB, seed: number, base = 4, contrast = 1) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v, x, y) => {
      const n = fbm(u, v, base, 5, seed);
      const t = Math.max(0, Math.min(1, (n - 0.5) * 1.6 * contrast + 0.5));
      const c = mix(a, b, t);
      return scale(c, 0.94 + hash2(x, y, seed) * 0.12);
    });
}

function grass(ctx: CanvasRenderingContext2D): void {
  ground([52, 82, 36], [104, 134, 58], 11, 4)(ctx);
  const r = rng(12);
  ctx.lineCap = "round";
  for (let i = 0; i < 2600; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 4 + r() * 7;
    const a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    const light = r();
    ctx.strokeStyle = css(mix([40, 70, 30], [140, 170, 80], light), 0.55);
    ctx.lineWidth = 1 + r();
    wrapped((dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      ctx.stroke();
    });
  }
}

function dirt(ctx: CanvasRenderingContext2D): void {
  ground([88, 64, 42], [140, 106, 70], 21, 4)(ctx);
  speckle(ctx, 22, 260, ["rgba(60,42,28,0.55)", "rgba(170,140,100,0.5)", "rgba(110,95,80,0.6)"], 1.5, 4);
}

function sand(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 3, 4, 31);
    const ripple = Math.sin((v * 10 + u * 2 + n * 1.4) * Math.PI * 2) * 0.5 + 0.5;
    const c = mix([196, 168, 112], [230, 208, 156], n * 0.7 + ripple * 0.3);
    return scale(c, 0.96 + hash2(x, y, 31) * 0.08);
  });
}

function snow(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 3, 5, 41);
    const c = mix([196, 208, 228], [250, 252, 255], Math.min(1, n * 1.3));
    return scale(c, 0.98 + hash2(x, y, 41) * 0.04);
  });
}

function mud(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 4, 5, 51);
    const wet = Math.pow(ridged(u, v, 3, 3, 52), 4);
    const c = mix(mix([52, 40, 28], [92, 70, 46], n), [120, 110, 100], wet * 0.35);
    return scale(c, 0.95 + hash2(x, y, 51) * 0.1);
  });
}

function stoneField(seed: number, count: number, gap: number, light: RGB, dark: RGB, mortar: RGB) {
  return (ctx: CanvasRenderingContext2D) => {
    const r = rng(seed);
    const pts: [number, number][] = Array.from({ length: count }, () => [r(), r()]);
    const tint = pts.map(() => 0.8 + r() * 0.4);
    pixels(ctx, (u, v, x, y) => {
      const w = worley(u, v, pts);
      const edge = w.d2 - w.d1;
      if (edge < gap) return scale(mortar, 0.9 + hash2(x, y, seed) * 0.2);
      const dome = Math.max(0, 1 - w.d1 / (w.d2 + 1e-6));
      const n = fbm(u, v, 8, 3, seed + 1);
      const c = mix(dark, light, Math.min(1, dome * 0.6 + n * 0.5));
      const rim = Math.min(1, (edge - gap) / (gap * 1.5));
      return scale(c, tint[w.id] * (0.75 + rim * 0.25));
    });
  };
}

const gravel = stoneField(61, 260, 0.006, [150, 146, 138], [90, 87, 82], [55, 50, 45]);

function rock(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 3, 5, 71);
    const crack = Math.pow(ridged(u, v, 4, 4, 72), 6);
    const c = mix([88, 88, 90], [150, 147, 142], n);
    return scale(c, (1 - crack * 0.45) * (0.95 + hash2(x, y, 71) * 0.1));
  });
}

function caveFloor(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 4, 5, 81);
    const crack = Math.pow(ridged(u, v, 3, 4, 82), 7);
    const c = mix([52, 47, 43], [98, 90, 80], n);
    return scale(c, (1 - crack * 0.5) * (0.93 + hash2(x, y, 81) * 0.14));
  });
  speckle(ctx, 83, 140, ["rgba(30,26,22,0.5)", "rgba(130,120,108,0.45)"], 1.5, 5);
}

// ---- Built floors ----

/** Rows of stones of random length, mortar between them, worn with noise. */
function rows(seed: number, rowH: number, minW: number, maxW: number, colors: RGB[], mortar: RGB, gap: number, bevel: number) {
  return (ctx: CanvasRenderingContext2D) => {
    const r = rng(seed);
    ctx.fillStyle = css(mortar);
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += rowH) {
      let x = r() * maxW;
      const end = x + S;
      while (x < end) {
        let w = minW + Math.floor(r() * (maxW - minW + 1));
        if (end - x - w < minW) w = end - x;
        const c = scale(colors[Math.floor(r() * colors.length)], 0.85 + r() * 0.3);
        wrapped((dx, dy) => {
          const sx = x + dx + gap / 2;
          const sy = y + dy + gap / 2;
          const sw = w - gap;
          const sh = rowH - gap;
          ctx.fillStyle = css(c);
          ctx.fillRect(sx, sy, sw, sh);
          if (bevel > 0) {
            ctx.fillStyle = "rgba(255,255,255,0.10)";
            ctx.fillRect(sx, sy, sw, bevel);
            ctx.fillRect(sx, sy, bevel, sh);
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.fillRect(sx, sy + sh - bevel, sw, bevel);
            ctx.fillRect(sx + sw - bevel, sy, bevel, sh);
          }
        });
        x += w;
      }
    }
  };
}

function flagstone(ctx: CanvasRenderingContext2D): void {
  rows(101, 128, 96, 224, [[132, 126, 116], [118, 112, 104], [142, 136, 124], [110, 108, 104]], [48, 44, 40], 8, 4)(ctx);
  weather(ctx, 102, 0.5);
  cracks(ctx, 103, 10, "rgba(30,26,22,0.45)");
}

function dungeonTiles(ctx: CanvasRenderingContext2D): void {
  const r = rng(111);
  ctx.fillStyle = "rgb(40,40,44)";
  ctx.fillRect(0, 0, S, S);
  const n = 2;
  const size = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = scale([112, 114, 120], 0.88 + r() * 0.24);
      const g = 7;
      ctx.fillStyle = css(c);
      ctx.fillRect(i * size + g / 2, j * size + g / 2, size - g, size - g);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(i * size + g / 2, j * size + g / 2, size - g, 5);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(i * size + g / 2, (j + 1) * size - g / 2 - 5, size - g, 5);
    }
  }
  weather(ctx, 112, 0.45);
  cracks(ctx, 113, 6, "rgba(25,25,28,0.5)");
}

/**
 * Floorboards: rows of planks of random length, each with its own tone and grain, dark seams
 * between them and nails at the ends. Worked out per pixel so planks wrap across the tile.
 */
function planks(seed: number, base: RGB, seam: RGB) {
  return (ctx: CanvasRenderingContext2D) => {
    const rowH = 64;
    const gap = 3;
    const r = rng(seed);
    // For each row: where its planks start (wrapping at S), with a tone and grain per plank.
    const rows = Array.from({ length: S / rowH }, () => {
      const offset = Math.floor(r() * S);
      const starts: number[] = [];
      let x = 0;
      while (x < S) {
        starts.push(x);
        let w = 200 + Math.floor(r() * 180);
        if (S - x - w < 140) w = S - x;
        x += w;
      }
      return { offset, starts, tone: starts.map(() => 0.9 + r() * 0.16), grain: starts.map(() => Math.floor(r() * 1000)) };
    });
    pixels(ctx, (_u, _v, x, y) => {
      const row = rows[Math.floor(y / rowH)];
      const ly = y % rowH;
      const lx = (x - row.offset + S) % S;
      let k = row.starts.length - 1;
      while (row.starts[k] > lx) k--;
      const start = row.starts[k];
      const end = k + 1 < row.starts.length ? row.starts[k + 1] : S;
      const px = lx - start;
      if (ly < gap || px < gap || end - lx <= gap) return scale(seam, 0.9 + hash2(x, y, seed) * 0.2);
      const nail = (px >= 9 && px < 12) || (end - lx > 9 && end - lx <= 12);
      if (nail && ((ly >= 13 && ly < 16) || (ly >= rowH - 17 && ly < rowH - 14))) return scale(seam, 0.8);
      const gx = px / 256;
      const gy = ly / rowH;
      const g = valueNoise(gx * 3, gy * 6, 1e6, row.grain[k]);
      const ring = Math.sin((gy * 7 + g * 3) * Math.PI) * 0.5 + 0.5;
      const edge = ly < gap + 3 ? 1.06 : ly > rowH - 4 ? 0.9 : 1;
      return scale(base, row.tone[k] * (0.88 + ring * 0.18) * edge * (0.97 + hash2(x, y, row.grain[k]) * 0.06));
    });
    weather(ctx, seed + 1, 0.25, 4, 0.04);
  };
}

const cobble = stoneField(121, 46, 0.012, [150, 142, 128], [96, 90, 82], [42, 38, 34]);

function marble(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const dark = (Math.floor(u * 2) + Math.floor(v * 2)) % 2 === 1;
    const vein = Math.pow(ridged(u, v, 3, 4, dark ? 132 : 131), 10);
    const n = fbm(u, v, 4, 3, 133);
    const base: RGB = dark ? [58, 58, 64] : [222, 218, 210];
    const veinC: RGB = dark ? [120, 120, 128] : [150, 146, 140];
    const c = mix(scale(base, 0.94 + n * 0.12), veinC, vein * 0.8);
    const gu = (u * 2) % 1;
    const gv = (v * 2) % 1;
    const grout = gu < 0.01 || gu > 0.99 || gv < 0.01 || gv > 0.99;
    return grout ? [40, 38, 36] : c;
  });
}

function carpet(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 6, 3, 141);
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : 0.94;
    const c = mix([96, 18, 24], [140, 34, 38], n);
    return scale(c, weave * (0.95 + hash2(x, y, 141) * 0.08));
  });
}

// ---- Walls ----

function wallStone(ctx: CanvasRenderingContext2D): void {
  rows(201, 48, 56, 120, [[92, 88, 82], [80, 77, 72], [100, 96, 88]], [34, 32, 30], 5, 3)(ctx);
  weather(ctx, 202, 0.4);
}

function wallBrick(ctx: CanvasRenderingContext2D): void {
  rows(211, 32, 72, 72, [[138, 64, 46], [124, 58, 42], [150, 74, 52]], [72, 66, 60], 5, 2)(ctx);
  weather(ctx, 212, 0.35);
}

function wallWood(ctx: CanvasRenderingContext2D): void {
  planks(221, [104, 68, 38], [40, 26, 16])(ctx);
}

function wallPlaster(ctx: CanvasRenderingContext2D): void {
  ground([196, 186, 166], [224, 216, 198], 231, 3, 0.8)(ctx);
}

function cracks(ctx: CanvasRenderingContext2D, seed: number, count: number, color: string): void {
  const r = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    let x = r() * S;
    let y = r() * S;
    let a = r() * Math.PI * 2;
    const steps = 4 + Math.floor(r() * 6);
    ctx.lineWidth = 1 + r() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < steps; s++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * (6 + r() * 12);
      y += Math.sin(a) * (6 + r() * 12);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function water(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v) => {
    const n = fbm(u, v, 3, 4, 301);
    const caustic = Math.pow(ridged(u, v, 4, 3, 302), 8);
    return mix(mix([28, 72, 102], [44, 100, 130], n), [150, 200, 220], caustic * 0.35);
  });
}

// ---- The larger library (26 October 2026) ----
// Ids are plain words, because table.parhome.ca's Seasons read a role from them: grass, moss,
// leaves, meadow → grass; dirt, mud, soil, swamp, earth → earth; sand, beach, desert → sand;
// snow; ice; rock, gravel, pebble, sandstone, limestone, marble → rock; flagstone, tile,
// cobble, brick → paved.

function grassOf(a: RGB, b: RGB, blades: [RGB, RGB], seed: number, count = 2600) {
  return (ctx: CanvasRenderingContext2D) => {
    ground(a, b, seed, 4)(ctx);
    const r = rng(seed + 1);
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const x = r() * S;
      const y = r() * S;
      const len = 4 + r() * 7;
      const ang = -Math.PI / 2 + (r() - 0.5) * 1.2;
      ctx.strokeStyle = css(mix(blades[0], blades[1], r()), 0.55);
      ctx.lineWidth = 1 + r();
      wrapped((dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + Math.cos(ang) * len, y + dy + Math.sin(ang) * len);
        ctx.stroke();
      });
    }
  };
}

function withSpeckles(base: (ctx: CanvasRenderingContext2D) => void, seed: number, count: number, colors: string[], rMin: number, rMax: number) {
  return (ctx: CanvasRenderingContext2D) => {
    base(ctx);
    speckle(ctx, seed, count, colors, rMin, rMax);
  };
}

function leafLitter(base: RGB, dark: RGB, colors: string[], seed: number, count: number, needles = 0) {
  return (ctx: CanvasRenderingContext2D) => {
    ground(dark, base, seed, 4)(ctx);
    const r = rng(seed + 1);
    for (let i = 0; i < needles; i++) {
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI;
      ctx.strokeStyle = r() > 0.5 ? "rgba(120,80,40,0.7)" : "rgba(70,90,40,0.6)";
      ctx.lineWidth = 1;
      wrapped((dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + Math.cos(a) * 9, y + dy + Math.sin(a) * 9);
        ctx.stroke();
      });
    }
    for (let i = 0; i < count; i++) {
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI;
      const len = 6 + r() * 6;
      ctx.fillStyle = colors[Math.floor(r() * colors.length)];
      wrapped((dx, dy) => {
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, len, len * 0.45, a, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };
}

function rockOf(a: RGB, b: RGB, seed: number, crackDepth = 0.45) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v, x, y) => {
      const n = fbm(u, v, 3, 5, seed);
      const crack = Math.pow(ridged(u, v, 4, 4, seed + 1), 6);
      return scale(mix(a, b, n), (1 - crack * crackDepth) * (0.95 + hash2(x, y, seed) * 0.1));
    });
}

function caveOf(a: RGB, b: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) => {
    pixels(ctx, (u, v, x, y) => {
      const n = fbm(u, v, 4, 5, seed);
      const crack = Math.pow(ridged(u, v, 3, 4, seed + 1), 7);
      return scale(mix(a, b, n), (1 - crack * 0.5) * (0.93 + hash2(x, y, seed) * 0.14));
    });
    speckle(ctx, seed + 2, 140, ["rgba(30,26,22,0.5)", "rgba(130,120,108,0.45)"], 1.5, 5);
  };
}

function sandOf(a: RGB, b: RGB, seed: number, ripples: number, rippleShare: number) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v, x, y) => {
      const n = fbm(u, v, 3, 4, seed);
      const ripple = Math.sin((v * ripples + u * 2 + n * 1.6) * Math.PI * 2) * 0.5 + 0.5;
      return scale(mix(a, b, n * (1 - rippleShare) + ripple * rippleShare), 0.96 + hash2(x, y, seed) * 0.08);
    });
}

function tilledSoil(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 4, 4, 401);
    const furrow = Math.sin((v * 16 + n * 0.3) * Math.PI * 2) * 0.5 + 0.5;
    return scale(mix([70, 50, 32], [128, 94, 62], furrow * 0.7 + n * 0.3), 0.94 + hash2(x, y, 401) * 0.12);
  });
}

function crackedEarth(ctx: CanvasRenderingContext2D): void {
  const r = rng(411);
  const pts: [number, number][] = Array.from({ length: 34 }, () => [r(), r()]);
  pixels(ctx, (u, v, x, y) => {
    const w = worley(u, v, pts);
    const n = fbm(u, v, 5, 3, 412);
    const c = mix([168, 128, 88], [204, 168, 120], n);
    const edge = w.d2 - w.d1;
    return edge < 0.008 ? scale(c, 0.45) : scale(c, (0.92 + Math.min(1, edge * 8) * 0.08) * (0.96 + hash2(x, y, 411) * 0.08));
  });
}

function ice(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 3, 4, 421);
    const crack = Math.pow(ridged(u, v, 3, 3, 422), 14);
    return mix(mix([150, 196, 220], [214, 236, 246], n), [255, 255, 255], crack * 0.7 + hash2(x, y, 421) * 0.03);
  });
}

function lava(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const n = fbm(u, v, 3, 4, 431);
    const vein = Math.pow(ridged(u, v, 3, 4, 432), 6);
    const crust = mix([34, 26, 24], [70, 52, 44], n);
    return mix(crust, mix([255, 120, 20], [255, 230, 120], vein), Math.min(1, vein * 1.4)).map((c) => c * (0.97 + hash2(x, y, 431) * 0.06)) as RGB;
  });
}

function strawFloor(ctx: CanvasRenderingContext2D): void {
  ground([170, 136, 70], [214, 186, 110], 441, 5)(ctx);
  const r = rng(442);
  ctx.lineCap = "round";
  for (let i = 0; i < 1600; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI * 2;
    const len = 10 + r() * 22;
    ctx.strokeStyle = css(mix([150, 110, 40], [240, 214, 140], r()), 0.7);
    ctx.lineWidth = 1 + r() * 1.5;
    wrapped((dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      ctx.stroke();
    });
  }
}

/** Hexagonal tiles: the cells of an offset grid of 5 columns and 6 rows, which tiles exactly. */
function hexTiles(a: RGB, b: RGB, grout: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) => {
    const pts: [number, number][] = [];
    for (let row = 0; row < 6; row++) for (let col = 0; col < 5; col++) pts.push([(col + (row % 2) * 0.5 + 0.5) / 5, (row + 0.5) / 6]);
    const r = rng(seed);
    const tone = pts.map(() => r());
    pixels(ctx, (u, v, x, y) => {
      const w = worley(u, v, pts);
      if (w.d2 - w.d1 < 0.008) return scale(grout, 0.9 + hash2(x, y, seed) * 0.2);
      const n = fbm(u, v, 6, 3, seed + 1);
      return scale(mix(a, b, tone[w.id]), 0.9 + n * 0.18);
    });
  };
}

/** Planks laid at 45°: seams along x − y, staggered joints along x + y; both repeat every tile. */
function diagonalPlanks(base: RGB, seam: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v, x, y) => {
      const across = (((x - y) % 64) + 64) % 64;
      const row = Math.floor((((x - y) % S) + S) % S / 64);
      const along = (x + y + row * 97) % 256;
      if (across < 3 || along < 3) return scale(seam, 0.9 + hash2(x, y, seed) * 0.2);
      const grain = Math.sin(((across / 64) * 6 + fbm(u, v, 8, 2, seed + row) * 3) * Math.PI) * 0.5 + 0.5;
      return scale(base, (0.88 + grain * 0.16) * (0.9 + hash2(row, Math.floor((x + y + row * 97) / 256), seed) * 0.18));
    });
}

/** Basket-weave parquet: blocks of two planks, alternating direction like a chessboard. */
function parquet(base: RGB, seam: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v, x, y) => {
      const bx = Math.floor(x / 64);
      const by = Math.floor(y / 64);
      const lx = x % 64;
      const ly = y % 64;
      const flat = (bx + by) % 2 === 0;
      const along = flat ? lx : ly;
      const across = flat ? ly : lx;
      if (along < 2 || across < 2 || Math.abs(across - 32) < 1.5) return scale(seam, 0.95);
      const plank = across < 32 ? 0 : 1;
      const grain = Math.sin(((across % 32) / 32) * 5 + fbm(u, v, 8, 2, seed) * 3) * 0.5 + 0.5;
      return scale(base, (0.88 + grain * 0.14) * (0.92 + hash2(bx * 2 + plank, by, seed) * 0.16));
    });
}

function grate(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const gx = x % 32;
    const gy = y % 32;
    const bar = gx < 8 || gy < 8;
    if (!bar) return scale([16, 16, 18], 0.8 + fbm(u, v, 6, 2, 451) * 0.4);
    const n = fbm(u, v, 6, 3, 452);
    const rust = Math.pow(fbm(u, v, 4, 4, 453), 3);
    const edge = gx < 2 || gy < 2 ? 1.2 : gx > 6 && gx < 8 || gy > 6 && gy < 8 ? 0.7 : 1;
    return scale(mix([106, 108, 114], [140, 84, 52], rust * 1.4), (0.85 + n * 0.3) * edge);
  });
}

function mosaic(colors: RGB[], grout: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v, x, y) => {
      const tx = Math.floor(x / 32);
      const ty = Math.floor(y / 32);
      if (x % 32 < 3 || y % 32 < 3) return grout;
      const c = colors[Math.floor(hash2(tx, ty, seed) * colors.length)];
      return scale(c, 0.9 + hash2(x, y, seed) * 0.12 + fbm(u, v, 8, 2, seed) * 0.08);
    });
}

function logWall(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const within = (y % 64) / 64;
    const round = Math.sin(within * Math.PI);
    const n = fbm(u * 0.4, v * 4, 6, 3, 461);
    if (within < 0.04) return [34, 22, 14];
    return scale([118, 78, 44], (0.5 + round * 0.55) * (0.9 + n * 0.2));
  });
}

function ironWall(ctx: CanvasRenderingContext2D): void {
  pixels(ctx, (u, v, x, y) => {
    const px = x % 128;
    const py = y % 64;
    if (px < 3 || py < 3) return [30, 30, 34];
    const rivet = (Math.hypot(px - 10, py - 10) < 4 || Math.hypot(px - 118, py - 10) < 4) ? 1.35 : 1;
    const n = fbm(u, v, 5, 3, 471);
    const rust = Math.pow(fbm(u, v, 3, 4, 472), 3);
    return scale(mix([92, 94, 100], [120, 72, 46], rust * 1.2), (0.85 + n * 0.25) * rivet);
  });
}

function mossy(base: (ctx: CanvasRenderingContext2D) => void, seed: number) {
  return (ctx: CanvasRenderingContext2D) => {
    base(ctx);
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const m = Math.max(0, fbm(x / S, y / S, 4, 4, seed) - 0.52) * 2.6;
        if (m <= 0) continue;
        const i = (y * S + x) * 4;
        const t = Math.min(0.75, m);
        d[i] = d[i] * (1 - t) + 70 * t;
        d[i + 1] = d[i + 1] * (1 - t) + 104 * t;
        d[i + 2] = d[i + 2] * (1 - t) + 44 * t;
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}

function tilesOf(base: RGB, grout: RGB, n: number, seed: number) {
  return (ctx: CanvasRenderingContext2D) => {
    const r = rng(seed);
    ctx.fillStyle = css(grout);
    ctx.fillRect(0, 0, S, S);
    const size = S / n;
    const g = Math.max(3, size * 0.05);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = css(scale(base, 0.9 + r() * 0.2));
        ctx.fillRect(i * size + g / 2, j * size + g / 2, size - g, size - g);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(i * size + g / 2, j * size + g / 2, size - g, Math.max(2, g * 0.7));
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(i * size + g / 2, (j + 1) * size - g / 2 - Math.max(2, g * 0.7), size - g, Math.max(2, g * 0.7));
      }
    }
    weather(ctx, seed + 1, 0.35);
  };
}

function checkerOf(light: RGB, dark: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v) => {
      const isDark = (Math.floor(u * 2) + Math.floor(v * 2)) % 2 === 1;
      const vein = Math.pow(ridged(u, v, 3, 4, seed + (isDark ? 1 : 0)), 10);
      const n = fbm(u, v, 4, 3, seed + 2);
      const base = isDark ? dark : light;
      const c = mix(scale(base, 0.94 + n * 0.12), scale(base, isDark ? 1.8 : 0.7), vein * 0.8);
      const gu = (u * 2) % 1;
      const gv = (v * 2) % 1;
      return gu < 0.01 || gu > 0.99 || gv < 0.01 || gv > 0.99 ? [40, 38, 36] : c;
    });
}

function plainMarble(base: RGB, vein: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v) => {
      const vn = Math.pow(ridged(u, v, 2, 5, seed), 9);
      const n = fbm(u, v, 4, 3, seed + 1);
      return mix(scale(base, 0.95 + n * 0.1), vein, vn * 0.85);
    });
}

function carpetOf(a: RGB, b: RGB, seed: number) {
  return (ctx: CanvasRenderingContext2D) =>
    pixels(ctx, (u, v, x, y) => {
      const n = fbm(u, v, 6, 3, seed);
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : 0.94;
      return scale(mix(a, b, n), weave * (0.95 + hash2(x, y, seed) * 0.08));
    });
}

const MORE_MATERIALS: Material[] = [
  // Floors
  { id: "flagstone-sandstone", name: "Sandstone flags", group: "floor", swatch: "#b89a6a", generate: (c) => { rows(501, 128, 96, 224, [[196, 168, 120], [178, 150, 104], [206, 180, 132]], [92, 74, 52], 8, 4)(c); weather(c, 502, 0.45); } },
  { id: "flagstone-dark", name: "Dark flagstones", group: "floor", swatch: "#4a4a50", generate: (c) => { rows(503, 128, 96, 224, [[84, 84, 92], [72, 72, 80], [96, 94, 100]], [26, 26, 30], 8, 4)(c); weather(c, 504, 0.5); cracks(c, 505, 10, "rgba(10,10,12,0.5)"); } },
  { id: "flagstone-slate", name: "Slate flags", group: "floor", swatch: "#4e5a66", generate: (c) => { rows(506, 96, 128, 256, [[78, 90, 104], [68, 78, 92], [88, 98, 110]], [30, 34, 40], 6, 3)(c); weather(c, 507, 0.4); } },
  { id: "tiles-blue", name: "Blue tiles", group: "floor", swatch: "#4a6a8a", generate: tilesOf([74, 106, 140], [30, 34, 44], 2, 511) },
  { id: "tiles-terracotta", name: "Terracotta tiles", group: "floor", swatch: "#b0603a", generate: tilesOf([176, 98, 60], [80, 60, 48], 4, 512) },
  { id: "tiles-white", name: "White tiles", group: "floor", swatch: "#d8d6d0", generate: tilesOf([214, 212, 206], [120, 118, 112], 4, 513) },
  { id: "tiles-small", name: "Small grey tiles", group: "floor", swatch: "#8a8c92", generate: tilesOf([130, 132, 140], [50, 50, 54], 8, 514) },
  { id: "tiles-hex", name: "Hex tiles", group: "floor", swatch: "#9a8a76", generate: hexTiles([170, 150, 124], [124, 108, 90], [52, 46, 40], 515) },
  { id: "tiles-hex-green", name: "Green hex tiles", group: "floor", swatch: "#4a7a6a", generate: hexTiles([84, 136, 116], [56, 100, 86], [30, 40, 36], 516) },
  { id: "wood-light", name: "Light wood", group: "floor", swatch: "#c8a070", generate: planks(521, [196, 154, 104], [80, 56, 34]) },
  { id: "wood-red", name: "Mahogany", group: "floor", swatch: "#7a3a28", generate: planks(522, [128, 60, 40], [40, 18, 12]) },
  { id: "wood-grey", name: "Weathered wood", group: "floor", swatch: "#8a847a", generate: planks(523, [140, 132, 120], [52, 48, 42]) },
  { id: "wood-diagonal", name: "Diagonal planks", group: "floor", swatch: "#946a40", generate: diagonalPlanks([150, 106, 64], [52, 34, 20], 524) },
  { id: "wood-parquet", name: "Parquet", group: "floor", swatch: "#a06a3a", generate: parquet([164, 108, 62], [60, 38, 22], 525) },
  { id: "cobble-mossy", name: "Mossy cobbles", group: "floor", swatch: "#6a7a5a", generate: mossy(stoneField(531, 46, 0.012, [150, 142, 128], [96, 90, 82], [42, 38, 34]), 532) },
  { id: "cobble-warm", name: "Warm cobbles", group: "floor", swatch: "#9a7a5a", generate: stoneField(533, 46, 0.012, [190, 156, 120], [120, 92, 70], [56, 42, 32]) },
  { id: "cobble-dark", name: "Dark cobbles", group: "floor", swatch: "#4a4a4e", generate: stoneField(534, 52, 0.012, [104, 104, 110], [60, 60, 66], [24, 24, 26]) },
  { id: "marble-white", name: "White marble", group: "floor", swatch: "#e6e2da", generate: plainMarble([232, 228, 220], [150, 146, 140], 541) },
  { id: "marble-green", name: "Green marble", group: "floor", swatch: "#3a6a52", generate: plainMarble([58, 106, 82], [200, 230, 210], 542) },
  { id: "marble-red-checker", name: "Red marble checker", group: "floor", swatch: "#8a3a3a", generate: checkerOf([224, 214, 200], [128, 40, 40], 543) },
  { id: "carpet-blue", name: "Blue carpet", group: "floor", swatch: "#24406a", generate: carpetOf([26, 50, 92], [44, 74, 128], 551) },
  { id: "carpet-green", name: "Green carpet", group: "floor", swatch: "#2a5a3a", generate: carpetOf([30, 70, 44], [50, 100, 64], 552) },
  { id: "carpet-purple", name: "Purple carpet", group: "floor", swatch: "#5a2a6a", generate: carpetOf([70, 28, 86], [104, 48, 124], 553) },
  { id: "straw-floor", name: "Straw", group: "floor", swatch: "#c8a860", generate: strawFloor },
  { id: "metal-grate", name: "Metal grate", group: "floor", swatch: "#5a5c62", generate: grate },
  { id: "mosaic", name: "Mosaic", group: "floor", swatch: "#5a8aa8", generate: mosaic([[60, 110, 160], [230, 226, 214], [176, 98, 60], [40, 70, 120]], [70, 66, 60], 561) },
  { id: "brick-floor", name: "Brick floor", group: "floor", swatch: "#9a5a40", generate: (c) => { rows(562, 32, 64, 64, [[150, 82, 60], [134, 72, 52], [166, 96, 70]], [80, 70, 62], 4, 2)(c); weather(c, 563, 0.3); } },

  // Ground
  { id: "grass-lush", name: "Lush grass", group: "terrain", swatch: "#4a8a30", generate: grassOf([56, 104, 36], [104, 156, 60], [[40, 90, 30], [150, 200, 90]], 601) },
  { id: "grass-dry", name: "Dry grass", group: "terrain", swatch: "#9a9a50", generate: grassOf([120, 116, 60], [172, 160, 92], [[110, 100, 50], [210, 196, 120]], 602) },
  { id: "grass-forest", name: "Forest grass", group: "terrain", swatch: "#2e5226", generate: grassOf([30, 58, 28], [62, 96, 44], [[24, 50, 24], [90, 130, 60]], 603) },
  { id: "meadow", name: "Meadow", group: "terrain", swatch: "#5a8a3a", generate: withSpeckles(grassOf([60, 100, 40], [110, 150, 66], [[50, 90, 34], [150, 190, 90]], 604), 605, 260, ["#f4f0e8", "#f2c838", "#b07ad8", "#e86a8a"], 1.5, 2.8) },
  { id: "moss", name: "Moss", group: "terrain", swatch: "#4a6a2a", generate: withSpeckles(ground([44, 70, 30], [92, 120, 50], 606, 6, 1.3), 607, 500, ["rgba(130,170,70,0.6)", "rgba(30,50,20,0.5)"], 1.5, 4) },
  { id: "leaves-autumn", name: "Autumn leaves", group: "terrain", swatch: "#a8602a", generate: leafLitter([110, 80, 50], [70, 50, 32], ["#c8602a", "#e0a03a", "#a83a22", "#8a5a2a", "#d8c050"], 611, 2400) },
  { id: "forest-floor", name: "Forest floor", group: "terrain", swatch: "#4a3e2a", generate: leafLitter([84, 70, 46], [48, 40, 28], ["#6a5a32", "#4a6a2a", "#8a6a3a"], 612, 700, 1400) },
  { id: "dirt-red", name: "Red clay", group: "terrain", swatch: "#9a4a2e", generate: withSpeckles(ground([122, 60, 40], [170, 96, 64], 621, 4), 622, 220, ["rgba(80,36,24,0.5)", "rgba(200,140,110,0.45)"], 1.5, 4) },
  { id: "dirt-dark", name: "Dark soil", group: "terrain", swatch: "#3e3024", generate: withSpeckles(ground([44, 34, 26], [80, 64, 48], 623, 4), 624, 220, ["rgba(20,16,12,0.5)", "rgba(110,96,80,0.4)"], 1.5, 4) },
  { id: "tilled-soil", name: "Tilled soil", group: "terrain", swatch: "#6a4a30", generate: tilledSoil },
  { id: "cracked-earth", name: "Cracked earth", group: "terrain", swatch: "#b89060", generate: crackedEarth },
  { id: "swamp-mud", name: "Swamp mud", group: "terrain", swatch: "#3e4428", generate: (c) => pixels(c, (u, v, x, y) => { const n = fbm(u, v, 4, 5, 631); const wet = Math.pow(ridged(u, v, 3, 3, 632), 4); return scale(mix(mix([46, 50, 30], [86, 84, 50], n), [70, 96, 70], wet * 0.45), 0.95 + hash2(x, y, 631) * 0.1); }) },
  { id: "beach-sand", name: "Beach sand", group: "terrain", swatch: "#e2cc9a", generate: withSpeckles(sandOf([214, 194, 146], [240, 226, 188], 641, 6, 0.2), 642, 120, ["rgba(250,245,235,0.8)", "rgba(160,140,110,0.5)"], 1, 2.5) },
  { id: "dunes-sand", name: "Dune sand", group: "terrain", swatch: "#d8b070", generate: sandOf([196, 152, 92], [236, 200, 136], 643, 4, 0.55) },
  { id: "desert-sand", name: "Desert sand", group: "terrain", swatch: "#cc9a5a", generate: sandOf([188, 132, 76], [226, 176, 112], 644, 12, 0.25) },
  { id: "snow-packed", name: "Packed snow", group: "terrain", swatch: "#c8d0dc", generate: (c) => pixels(c, (u, v, x, y) => { const n = fbm(u, v, 5, 5, 651); const ruts = Math.pow(ridged(u, v, 2, 3, 652), 8); return scale(mix([176, 186, 202], [232, 238, 246], n), (1 - ruts * 0.15) * (0.98 + hash2(x, y, 651) * 0.04)); }) },
  { id: "ice", name: "Ice", group: "terrain", swatch: "#a8d0e4", generate: ice },
  { id: "gravel-brown", name: "Brown gravel", group: "terrain", swatch: "#8a7660", generate: stoneField(661, 260, 0.006, [168, 146, 120], [104, 88, 70], [60, 48, 38]) },
  { id: "pebbles", name: "Pebbles", group: "terrain", swatch: "#9a948a", generate: stoneField(662, 90, 0.03, [190, 184, 174], [120, 114, 106], [96, 76, 56]) },
  { id: "rocky-ground", name: "Rocky ground", group: "terrain", swatch: "#7a7060", generate: withSpeckles(rockOf([96, 88, 74], [150, 138, 118], 663, 0.3), 664, 160, ["rgba(60,52,44,0.6)", "rgba(190,180,164,0.5)"], 2, 6) },
  { id: "rock-dark", name: "Dark rock", group: "terrain", swatch: "#44444a", generate: rockOf([50, 50, 56], [96, 96, 102], 665) },
  { id: "sandstone", name: "Sandstone", group: "terrain", swatch: "#c09a6a", generate: rockOf([168, 128, 86], [214, 180, 132], 666, 0.35) },
  { id: "limestone", name: "Limestone", group: "terrain", swatch: "#cfc8b8", generate: rockOf([178, 172, 156], [226, 222, 210], 667, 0.3) },
  { id: "cave-brown", name: "Brown cave floor", group: "terrain", swatch: "#5a4636", generate: caveOf([62, 48, 36], [110, 88, 66], 671) },
  { id: "cave-blue", name: "Blue-grey cave floor", group: "terrain", swatch: "#3e4650", generate: caveOf([40, 46, 54], [84, 92, 104], 672) },
  { id: "lava", name: "Lava", group: "terrain", swatch: "#a03a10", generate: lava },
  { id: "ash", name: "Ash", group: "terrain", swatch: "#6a6a6a", generate: withSpeckles(ground([76, 74, 72], [128, 126, 122], 681, 5, 0.8), 682, 400, ["rgba(30,30,30,0.55)", "rgba(200,190,180,0.4)"], 1, 3) },
  { id: "heather", name: "Heather", group: "terrain", swatch: "#6a5a6a", generate: withSpeckles(ground([60, 70, 46], [104, 96, 80], 683, 5), 684, 900, ["rgba(150,90,160,0.7)", "rgba(110,60,120,0.6)", "rgba(80,110,50,0.6)"], 1.5, 3.5) },

  // Walls
  { id: "wall-stone-dark", name: "Dark stone wall", group: "wall", swatch: "#3a3a40", generate: (c) => { rows(701, 48, 56, 120, [[62, 62, 68], [52, 52, 58], [72, 72, 78]], [18, 18, 20], 5, 3)(c); weather(c, 702, 0.4); } },
  { id: "wall-stone-mossy", name: "Mossy stone wall", group: "wall", swatch: "#5a6448", generate: mossy(wallStone, 703) },
  { id: "wall-sandstone", name: "Sandstone wall", group: "wall", swatch: "#b8986a", generate: (c) => { rows(704, 48, 56, 120, [[188, 158, 112], [170, 140, 98], [200, 172, 126]], [90, 72, 50], 5, 3)(c); weather(c, 705, 0.35); } },
  { id: "wall-brick-brown", name: "Brown brick wall", group: "wall", swatch: "#6a4a36", generate: (c) => { rows(706, 32, 72, 72, [[110, 74, 54], [96, 64, 46], [124, 86, 62]], [60, 54, 48], 5, 2)(c); weather(c, 707, 0.35); } },
  { id: "wall-brick-white", name: "Whitewashed brick", group: "wall", swatch: "#d8d2c6", generate: (c) => { rows(708, 32, 72, 72, [[222, 216, 204], [208, 202, 190], [230, 226, 216]], [150, 146, 138], 5, 2)(c); weather(c, 709, 0.25); } },
  { id: "wall-wood-dark", name: "Dark wooden wall", group: "wall", swatch: "#3e2a1a", generate: planks(710, [70, 46, 28], [22, 14, 8]) },
  { id: "wall-logs", name: "Log wall", group: "wall", swatch: "#765030", generate: logWall },
  { id: "wall-plaster-tan", name: "Tan plaster wall", group: "wall", swatch: "#c8aa82", generate: ground([184, 156, 116], [214, 190, 152], 711, 3, 0.8) },
  { id: "wall-cave", name: "Cave rock wall", group: "wall", swatch: "#4a4640", generate: rockOf([60, 56, 50], [110, 104, 96], 712) },
  { id: "wall-marble", name: "Marble wall", group: "wall", swatch: "#e2ded6", generate: plainMarble([226, 222, 214], [140, 136, 130], 713) },
  { id: "wall-iron", name: "Iron wall", group: "wall", swatch: "#5a5c62", generate: ironWall },
  { id: "wall-ice", name: "Ice wall", group: "wall", swatch: "#a8d0e4", generate: ice },
];

export const MATERIALS: Material[] = [
  { id: "flagstone", name: "Flagstones", group: "floor", swatch: "#7e786e", generate: flagstone },
  { id: "tiles", name: "Dungeon tiles", group: "floor", swatch: "#6e7076", generate: dungeonTiles },
  { id: "wood", name: "Wood planks", group: "floor", swatch: "#7a5230", generate: planks(161, [128, 86, 50], [44, 28, 18]) },
  { id: "dark-wood", name: "Dark wood", group: "floor", swatch: "#4a3020", generate: planks(171, [78, 50, 32], [26, 16, 10]) },
  { id: "cobble", name: "Cobblestone", group: "floor", swatch: "#7a7266", generate: cobble },
  { id: "marble", name: "Marble checker", group: "floor", swatch: "#a8a49e", generate: marble },
  { id: "carpet", name: "Red carpet", group: "floor", swatch: "#7a1a20", generate: carpet },
  { id: "grass", name: "Grass", group: "terrain", swatch: "#4f7230", generate: grass },
  { id: "dirt", name: "Dirt", group: "terrain", swatch: "#735638", generate: dirt },
  { id: "sand", name: "Sand", group: "terrain", swatch: "#cfb27a", generate: sand },
  { id: "snow", name: "Snow", group: "terrain", swatch: "#e2e8f2", generate: snow },
  { id: "mud", name: "Mud", group: "terrain", swatch: "#4a3826", generate: mud },
  { id: "gravel", name: "Gravel", group: "terrain", swatch: "#7a766e", generate: gravel },
  { id: "rock", name: "Rock", group: "terrain", swatch: "#77767a", generate: rock },
  { id: "cave", name: "Cave floor", group: "terrain", swatch: "#4b4540", generate: caveFloor },
  { id: "wall-stone", name: "Stone wall", group: "wall", swatch: "#585450", generate: wallStone },
  { id: "wall-brick", name: "Brick wall", group: "wall", swatch: "#8a4030", generate: wallBrick },
  { id: "wall-wood", name: "Wooden wall", group: "wall", swatch: "#684426", generate: wallWood },
  { id: "wall-plaster", name: "Plaster wall", group: "wall", swatch: "#d0c6b2", generate: wallPlaster },
  { id: "water", name: "Water", group: "terrain", swatch: "#2c5f80", generate: water },
  ...MORE_MATERIALS,
];

const byId = new Map(MATERIALS.map((m) => [m.id, m]));

export function material(id: string): Material {
  return byId.get(id) ?? MATERIALS[0];
}

export function materialsIn(group: MaterialGroup): Material[] {
  return MATERIALS.filter((m) => m.group === group && m.id !== "water");
}

const tiles = new Map<string, HTMLCanvasElement>();

/** The texture tile for a material, generated the first time it's asked for. */
export function textureTile(id: string): HTMLCanvasElement {
  let c = tiles.get(id);
  if (!c) {
    c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    material(id).generate(ctx);
    tiles.set(id, c);
  }
  return c;
}

const drawTiles = new Map<string, HTMLCanvasElement>();

/**
 * The tile that patterns are drawn from: a copy of the generated tile, 2 by 2, that nothing
 * ever reads back. The generated tile is read pixel by pixel while it's made, which keeps it
 * on the CPU, and filling from a CPU canvas re-uploads it every time (about 70 ms a fill).
 */
function drawTile(id: string): HTMLCanvasElement {
  let c = drawTiles.get(id);
  if (!c) {
    const src = textureTile(id);
    c = document.createElement("canvas");
    c.width = S * 2;
    c.height = S * 2;
    const ctx = c.getContext("2d")!;
    for (const x of [0, S]) for (const y of [0, S]) ctx.drawImage(src, x, y);
    drawTiles.set(id, c);
  }
  return c;
}

const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/**
 * A repeating pattern of a material for drawing in cell units: with the context's transform
 * mapping cells to pixels, one texture pixel is 1/PX_PER_CELL of a cell.
 */
export function pattern(ctx: CanvasRenderingContext2D, id: string): CanvasPattern {
  let m = patterns.get(ctx);
  if (!m) patterns.set(ctx, (m = new Map()));
  let p = m.get(id);
  if (!p) {
    p = ctx.createPattern(drawTile(id), "repeat")!;
    p.setTransform(new DOMMatrix().scaleSelf(1 / PX_PER_CELL, 1 / PX_PER_CELL));
    m.set(id, p);
  }
  return p;
}

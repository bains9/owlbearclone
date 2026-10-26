// Copied from Dungeon (src/render/color.ts) by scripts/sync-dungeon-library.mjs, Dungeon 4445927. Change it there and run the script again.
export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

export function css(c: RGB, alpha = 1): string {
  const [r, g, b] = c.map((v) => Math.max(0, Math.min(255, Math.round(v))));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

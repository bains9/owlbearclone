// Standing on things in the 3D view (view3d.ts): a figure whose middle is over something it can
// stand on stands on its top there, a pillar's cap, a plinth, a crate, a table, a rock, a step of
// the stairs, rather than inside it. What can be stood on comes from the objects' own 3D forms
// (view3dObjects.ts standMesh): their solid parts, not their leaves or flames, and nothing in the
// canopy (a token under a tree stays under it). Here, those parts' tops as a grid of heights, kept
// apart from three.js so it's tested.

/** The tops of what can be stood on: heights (squares) on a grid of `k` cells a square from (x0, z0); NaN where there's nothing. */
export interface Tops {
  x0: number;
  z0: number;
  k: number;
  w: number;
  h: number;
  top: Float32Array;
}

/** Cells a square: a quarter of a square, so a pillar or a crate is found under a figure's middle. */
const PER_SQUARE = 4;
/** How upright a face must be to stand on (its normal's share upwards): tops and gentle slopes, not sides. */
const FLAT_ENOUGH = 0.5;

/**
 * The tops of the triangles `position` (x, y, z in squares, three corners each) that face up enough
 * to stand on, as the highest at each cell's middle. Null when there are none.
 */
export function topsOf(position: Float32Array, k = PER_SQUARE): Tops | null {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    minX = Math.min(minX, position[i]);
    maxX = Math.max(maxX, position[i]);
    minZ = Math.min(minZ, position[i + 2]);
    maxZ = Math.max(maxZ, position[i + 2]);
  }
  if (!(maxX > minX) || !(maxZ > minZ)) return null;
  const x0 = Math.floor(minX * k) / k, z0 = Math.floor(minZ * k) / k;
  const w = Math.min(2048, Math.ceil((maxX - x0) * k) + 1), h = Math.min(2048, Math.ceil((maxZ - z0) * k) + 1);
  const top = new Float32Array(w * h).fill(NaN);
  let any = false;
  for (let i = 0; i + 8 < position.length; i += 9) {
    const ax = position[i], ay = position[i + 1], az = position[i + 2];
    const bx = position[i + 3], by = position[i + 4], bz = position[i + 5];
    const cx = position[i + 6], cy = position[i + 7], cz = position[i + 8];
    // Its normal: up enough (either way round: a form's winding isn't relied on).
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0) || Math.abs(ny) / len < FLAT_ENOUGH) continue;
    // Each cell whose middle is inside it, from above: the height there.
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const c0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) * k - 0.5)), c1 = Math.min(w - 1, Math.floor((Math.max(ax, bx, cx) - x0) * k - 0.5));
    const r0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) * k - 0.5)), r1 = Math.min(h - 1, Math.floor((Math.max(az, bz, cz) - z0) * k - 0.5));
    for (let r = r0; r <= r1; r++) {
      const pz = z0 + (r + 0.5) / k;
      for (let c = c0; c <= c1; c++) {
        const px = x0 + (c + 0.5) / k;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        const at = r * w + c;
        if (!(top[at] >= y)) top[at] = y;
        any = true;
      }
    }
  }
  return any ? { x0, z0, k, w, h, top } : null;
}

/** The top of what can be stood on at (x, z) (squares), above the ground there: 0 where there's nothing. */
export function topAt(t: Tops | null, x: number, z: number): number {
  if (!t) return 0;
  const c = Math.floor((x - t.x0) * t.k), r = Math.floor((z - t.z0) * t.k);
  if (c < 0 || r < 0 || c >= t.w || r >= t.h) return 0;
  const y = t.top[r * t.w + c];
  return y > 0 ? y : 0;
}

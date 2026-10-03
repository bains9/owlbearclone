// Crops for the hand check that seeds SPRITE_SIZES (design 2.5 item 1): each listed instance at
// 64 px a square, with rings every quarter square round its Dungeondraft centre (every whole
// square brighter) and its sprite's own x axis (after mirror and rotation) drawn in red, so a
// person can read its extent off the rings. Nothing here measures anything.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/hand-check.ts [pair#index[:half] ...]
//
// Writes renders/sizes/hand/<pair>-<index>-<name>.png.

import { mkdirSync, writeFileSync } from "node:fs";
import { GRID } from "../../src/client/dd/model";
import { defaultName } from "../../src/client/dd/roles";
import { Canvas, PAIRS, RENDERS, loadSample } from "./lib";

/** The instances checked by hand: isolated, mostly at scale 1, the commonest default names. */
export const HAND = [
  "tulgi#26", "forest#52", "forest#19", "forest#42", "forest#23", "mill#343", "forest#72", "forest#85", "forest#83",
  "forest#95", "forest#53", "forest#80", "forest#10:3.5", "mill#355", "forest#93", "forest#78", "forest#44", "hobble#5",
  "cavern#159", "mill#250", "mill#251", "pelcs#214", "river#59", "cavern#182", "forest#43", "forest#65", "forest#26", "forest#1",
  "forest#60", "forest#30", "forest#54", "waterfall#7", "waterfall#3", "waterfall#5", "waterfall#26", "waterfall#0",
  "waterfall#67", "waterfall#33", "waterfall#40", "waterfall#19", "waterfall#57", "waterfall#13:2.6", "waterfall#24:2.6",
];

const PPS = 64;
const out = `${RENDERS}/sizes/hand`;
mkdirSync(out, { recursive: true });
const want = process.argv.slice(2).length ? process.argv.slice(2) : HAND;
for (const p of PAIRS) {
  // "pair#index", or "pair#index:half" for a crop reaching half squares from the centre.
  const mine = want.filter((s) => s.startsWith(p.name + "#")).map((s) => s.split("#")[1].split(":").map(Number));
  if (!mine.length) continue;
  const L = await loadSample(p, PPS);
  if (!L) continue;
  const [x0, y0] = L.rect.rect;
  const upp = GRID / L.pps;
  for (const [i, halfSq] of mine) {
    const o = L.level.objects[i];
    const name = defaultName(o.texture) ?? "pack";
    const s = Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y));
    const half = Math.ceil((halfSq || Math.max(1.5, 2.2 * s)) * L.pps);
    const cx = (o.position.x - x0) / upp, cy = (o.position.y - y0) / upp;
    const bx = Math.floor(cx) - half, by = Math.floor(cy) - half;
    const c = new Canvas(L.pic, bx, by, 2 * half, 2 * half, 2);
    const lx = cx - bx, ly = cy - by;
    for (let q = 1; q <= 12; q++) {
      const r = (q / 4) * L.pps;
      if (r > half) break;
      const pts: number[] = [];
      for (let a = 0; a < 96; a++) pts.push(lx + r * Math.cos((a / 96) * 2 * Math.PI), ly + r * Math.sin((a / 96) * 2 * Math.PI));
      c.poly(pts, q % 4 === 0 ? [0, 255, 255] : [255, 0, 255], q % 4 === 0 ? 0.9 : 0.45);
    }
    // The sprite's +x axis in the world: mirror (x -> -x), then rotation.
    const sgn = (o.mirror ? -1 : 1) * Math.sign(o.scale.x || 1);
    c.line(lx, ly, lx + sgn * Math.cos(o.rotation) * half, ly + sgn * Math.sin(o.rotation) * half, [255, 0, 0], 0.9);
    c.dot(lx, ly, [255, 255, 0], 2);
    const file = `${out}/${p.name}-${i}-${name.split("/").pop()}.png`;
    writeFileSync(file, c.png());
    console.log(`${file}  scale ${o.scale.x.toFixed(2)},${o.scale.y.toFixed(2)} rot ${o.rotation.toFixed(2)}${o.mirror ? " mirrored" : ""}  rings every 0.25 sq (cyan: whole squares)`);
  }
}

// M2: why waterfall's object-centre fit says "unsure" on Vern's 1.2 export (design 2.4 wants "yes"
// on a correct pair). The score landscape over half-square shifts (score(o) is objectFit's s0 with
// the rectangle moved by o), the sharpness per object role, and the same for the samples.
//
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-fit.ts [pair ...]

import { GRID } from "../../src/client/dd/model";
import { FIT, levelCentres, objectFit } from "../../src/client/dd/fit";
import { OR, defaultName, objectRole } from "../../src/client/dd/roles";
import type { PictureRect } from "../../src/client/dd/extract";
import { pickLevel } from "./lib";
import { GREEN, SNOWY, atMost, fmt, havePair, loadFull, pair } from "./m2-lib";

const want = process.argv.slice(2).filter((a) => !a.startsWith("--")).length ? process.argv.slice(2).filter((a) => !a.startsWith("--")) : [...SNOWY, ...GREEN];
const RN: Record<number, string> = Object.fromEntries(Object.entries(OR).map(([k, v]) => [v, k]));

for (const name of want) {
  const p = pair(name);
  if (!havePair(p)) continue;
  const f = await loadFull(p);
  const L = pickLevel(f.map, p.level);
  const pic = atMost(f.full, f.sqW, 32);
  const x0 = (f.vtt?.resolution.map_origin.x ?? 0) * GRID, y0 = (f.vtt?.resolution.map_origin.y ?? 0) * GRID;
  const rect: PictureRect = { rect: [x0, y0, x0 + f.sqW * GRID, y0 + f.sqH * GRID] };
  const moved = (ox: number, oy: number): PictureRect => ({ rect: [rect.rect[0] + ox * GRID, rect.rect[1] + oy * GRID, rect.rect[2] + ox * GRID, rect.rect[3] + oy * GRID] });
  const centres = levelCentres(L);
  const r0 = objectFit(centres, rect, pic);
  console.log(`\n== ${name}: ${r0.verdict} lead ${fmt(r0.lead, 3)} sharp ${fmt(r0.sharp, 3)} best ${r0.best} objects ${r0.objects} (rule: yes if lead >= 1 and sharp <= ${FIT.yesSharp})`);
  // The landscape: s0 at each half-square shift of the picture's rectangle, relative to s0 at 0.
  const s = (ox: number, oy: number) => objectFit(centres, moved(ox, oy), pic);
  const base = s(0, 0);
  // objectFit doesn't expose s0; lead = s0 / best, and best is the same search at every rect only
  // approximately, so compare s0 through lead * best is not possible: use the fit's sharp and lead
  // at a few placements instead, which is what the verdicts read.
  console.log("  placement        verdict  lead   sharp");
  for (const [ox, oy] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0], [0, 1], [2, 0], [0, -2], [1.5, 0.5]] as const) {
    const r = ox === 0 && oy === 0 ? base : s(ox, oy);
    console.log(`  ${`${ox},${oy}`.padEnd(16)} ${r.verdict.padEnd(8)} ${fmt(r.lead, 3).padStart(5)}  ${fmt(r.sharp, 3)}  best ${r.best}`);
  }
  // Per role: the fit from that role's centres alone (sharpness is a mean over objects, so this shows who blurs it).
  const byRole = new Map<number, number[]>();
  for (const o of L.objects) {
    const nm = defaultName(o.texture);
    if (nm === null) continue;
    const role = objectRole(nm);
    if (role === OR.EFFECT) continue;
    (byRole.get(role) ?? byRole.set(role, []).get(role)!).push(o.position.x, o.position.y);
  }
  for (const [role, pts] of byRole) {
    if (pts.length < 2 * FIT.minObjects) { console.log(`  ${RN[role].padEnd(12)} ${pts.length / 2} objects (too few to score alone)`); continue; }
    const r = objectFit(Float64Array.from(pts), rect, pic);
    console.log(`  ${RN[role].padEnd(12)} ${String(pts.length / 2).padStart(3)} objects: ${r.verdict.padEnd(7)} lead ${fmt(r.lead, 3)} sharp ${fmt(r.sharp, 3)} best ${r.best}`);
  }
}

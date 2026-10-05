// M2 inventory: per sample map, what the checklist items of design 6.6 need to look at: mirrored
// objects (with their rotation), rotated paths, patterns rotated by shape or by texture, the
// layers used by each kind of thing, and the terrain's blending settings. (Paths and patterns
// have no mirror in Dungeondraft's files, so none is counted; only objects can be mirrored.)
//   node --import ./scripts/dd/register.mjs scripts/dd/m2-inventory.ts
import { readFileSync, existsSync } from "node:fs";
import { parseDungeondraftMap } from "../../src/client/dd/parse";
import { defaultName } from "../../src/client/dd/roles";
import { PAIRS, samplePath } from "./lib";

for (const p of PAIRS) {
  const mp = samplePath(p.map);
  if (!existsSync(mp)) continue;
  const map = parseDungeondraftMap(readFileSync(mp, "utf8"));
  console.log(`\n== ${p.name}: ${map.world.width}x${map.world.height}, format ${map.world.format}, levels ${map.world.levels.map((l) => `${l.key}:${l.label}`).join(", ")}`);
  for (const L of map.world.levels) {
    const t = L.terrain;
    const mirrored = L.objects.filter((o) => o.mirror);
    const layers = (xs: { layer: number }[]) => [...new Set(xs.map((x) => x.layer))].sort((a, b) => a - b).join(",") || "-";
    console.log(`  level ${L.key} (${L.label}): terrain ${t ? `${t.width}x${t.height}, smooth ${t.smoothBlending}, slots ${t.slots.map(defaultName).join("|")}` : "off"}`);
    console.log(`    objects ${L.objects.length} layers [${layers(L.objects)}]; mirrored ${mirrored.length}` +
      (mirrored.length ? ": " + mirrored.slice(0, 12).map((o) => `${defaultName(o.texture)?.split("/").pop() ?? "pack"}@rot${o.rotation.toFixed(2)}`).join(" ") : ""));
    const roots = L.objects.filter((o) => /roots/.test(defaultName(o.texture) ?? ""));
    if (roots.length) console.log(`    roots ${roots.length} at layers [${layers(roots)}]`);
    console.log(`    paths ${L.paths.length} layers [${layers(L.paths)}], rotated ${L.paths.filter((x) => x.rotation !== 0).length}, scaled ${L.paths.filter((x) => x.scale.x !== 1 || x.scale.y !== 1).length}`);
    console.log(`    patterns ${L.patterns.length} layers [${layers(L.patterns)}], shape rotated ${L.patterns.filter((x) => x.shapeRotation !== 0).length}, texture rotated ${L.patterns.filter((x) => x.textureRotation !== 0).length}`);
    console.log(`    walls ${L.walls.length} (loops ${L.walls.filter((w) => w.loop).length}, cave type ${L.walls.filter((w) => w.type === 2).length}); roofs ${L.roofs.length}; materials ${L.materials.length} layers [${layers(L.materials)}]; floors ${L.floorPolygons.length}; tiles ${L.tiles ? "yes" : "no"}; caves ${L.cave ? "yes" : "no"}`);
    const water = L.water.root?.children ?? [];
    console.log(`    water bodies ${water.length} (blend ${water.map((w) => w.blendDistance).join(",")})`);
  }
}

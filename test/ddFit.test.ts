// The object-centre fit (design 2.4, fit.ts): the verdict rule on synthetic pairs (WP9's fake
// exports: correct, swapped, shifted by squares and half squares, a same-aspect half-scale crop),
// from the sidecar alone, and on the public sample pairs (DD_FIXTURES, skipped when absent): the 7
// correct pairs are never "no", the 2 swapped never "yes", and shifted pictures never "yes". The
// sharpness and the peak test come from the small objects (M2: waterfall's big crowns), checked
// on the synthetic maps and on waterfall's 1.2 export (DD_VERN), which must say "yes".
import { describe, expect, it } from "vitest";
import { parseDungeondraftMap } from "../src/client/dd/parse";
import { GRID, type DDMap } from "../src/client/dd/model";
import { FIT, levelCentres, levelRadii, objectFit, sidecarFit } from "../src/client/dd/fit";
import { chooseLevel, extractSidecar, pictureRect, rankLevels, type PictureRect, type PictureSample } from "../src/client/dd/extract";
import { OR } from "../src/client/dd/roles";
import { SPRITE_SIZES } from "../src/client/dd/spriteSizes";
import { FIXTURE_SPRITES, fitPairs, mapText, scatterMap, snowyMap, type ObjSpec } from "./fixtures/ddSynthetic";
import { fakeExport, fakeExportFromMap } from "./fixtures/fakeExport";
import {
  DD_VERN, SAMPLE_PAIRS, SWAPPED_PAIRS, atPxPerSquare, havePair, haveVernExport, readPicture, sampleText, vernPicture, waterfallText,
  type SamplePair,
} from "./helpers/ddFixtures";

const wholeMap = (m: DDMap): PictureRect => ({ rect: [0, 0, m.world.width * GRID, m.world.height * GRID] });
const levelOf = (m: DDMap, key: string) => m.world.levels.find((l) => l.key === key)!;

describe("the fit on synthetic pairs (fake exports at 24 px a square)", () => {
  const pairs = fitPairs();
  for (const p of pairs) {
    it(`${p.name}: ${p.expect}`, () => {
      const map = parseDungeondraftMap(p.mapText);
      const pic = fakeExportFromMap(parseDungeondraftMap(p.pictureText), p.levelKey, 24, p.picture);
      const f = objectFit(levelCentres(levelOf(map, p.levelKey)), wholeMap(map), pic);
      expect(f.objects).toBeGreaterThanOrEqual(FIT.minObjects);
      if (p.expect === "yes") expect(f.verdict).toBe("yes");
      else if (p.expect === "no") {
        expect(f.verdict).toBe("no");
        expect(f.best).toEqual(p.best);
        expect(f.shiftSq).toEqual(p.best);
      } else expect(f.verdict).not.toBe("yes");
    });
  }

  it("the correct pair stays \"yes\" on other seeds and at 32 px a square", () => {
    for (const seed of [3, 4, 5]) {
      const s = scatterMap(seed);
      const map = parseDungeondraftMap(s.text);
      for (const pps of [24, 32]) {
        const f = objectFit(levelCentres(levelOf(map, s.levelKey)), wholeMap(map), fakeExportFromMap(map, s.levelKey, pps));
        expect(f.verdict, `seed ${seed} at ${pps}`).toBe("yes");
        expect(f.lead).toBeGreaterThanOrEqual(1);
        expect(f.sharp).toBeLessThanOrEqual(FIT.yesSharp);
      }
    }
  });

  it("a picture shifted 1 square down and 2 right is \"no\", with best = the correction", () => {
    const s = scatterMap(1);
    const map = parseDungeondraftMap(s.text);
    const pic = fakeExportFromMap(map, s.levelKey, 24, { shift: [2, 1] });
    const f = objectFit(levelCentres(levelOf(map, s.levelKey)), wholeMap(map), pic);
    expect(f.verdict).toBe("no");
    expect(f.best).toEqual([2, 1]);
    // Moving the rectangle by -best lines it up.
    const moved: PictureRect = { rect: [-2 * GRID, -1 * GRID, (20 - 2) * GRID, (12 - 1) * GRID] };
    expect(objectFit(levelCentres(levelOf(map, s.levelKey)), moved, pic).verdict).toBe("yes");
  });

  it("sharpness and the peak come from the small objects (prior radius <= FIT.small squares) when there are 8 of them, else from all", () => {
    const s = scatterMap(1);
    const map = parseDungeondraftMap(s.text);
    const L = levelOf(map, s.levelKey);
    const pic = fakeExportFromMap(map, s.levelKey, 24);
    const c = levelCentres(L), radii = levelRadii(L);
    expect(radii.length).toBe(c.length / 2);
    const smallIdx = Array.from(radii).map((r, i) => (r <= FIT.small * GRID ? i : -1)).filter((i) => i >= 0);
    expect(smallIdx.length).toBeGreaterThanOrEqual(FIT.minObjects);
    expect(smallIdx.length).toBeLessThan(radii.length);
    const f = objectFit(c, wholeMap(map), pic, radii);
    expect(f.small).toBe(smallIdx.length);
    // The same sharpness and peak as the fit of the small objects alone; the lead over every object.
    const sub = objectFit(Float64Array.from(smallIdx.flatMap((i) => [c[i * 2], c[i * 2 + 1]])), wholeMap(map), pic);
    expect(f.sharp).toBeCloseTo(sub.sharp, 6);
    expect(f.peak).toBeCloseTo(sub.peak!, 6);
    const all = objectFit(c, wholeMap(map), pic);
    expect(f.lead).toBe(all.lead);
    expect(all.small).toBe(0);
    // Radii that leave fewer than 8 small objects: every object carries the sharpness, as without radii.
    const big = Float64Array.from(radii, () => 5 * GRID);
    expect(objectFit(c, wholeMap(map), pic, big)).toEqual(all);
    // The correct placement is a peak; half a square off, the true placement is a higher neighbour.
    expect(f.verdict).toBe("yes");
    expect(f.peak).toBeLessThanOrEqual(FIT.peak);
    const half = objectFit(c, wholeMap(map), fakeExportFromMap(map, s.levelKey, 24, { shift: [0.5, 0] }), radii);
    expect(half.peak).toBeGreaterThan(FIT.peak);
    expect(half.verdict).not.toBe("yes");
  });

  it("fewer than 8 objects in the picture: \"unsure\", never \"yes\" or \"no\"", () => {
    const s = scatterMap(1, 6);
    const map = parseDungeondraftMap(s.text);
    const f = objectFit(levelCentres(levelOf(map, s.levelKey)), wholeMap(map), fakeExportFromMap(map, s.levelKey, 24));
    expect(f.objects).toBe(6);
    expect(f.verdict).toBe("unsure");
  });

  it("degenerate input gives \"unsure\" with no objects, never a throw", () => {
    const pic: PictureSample = { rgba: new Uint8ClampedArray(16), w: 2, h: 2 };
    expect(objectFit(new Float64Array(0), { rect: [0, 0, 512, 512] }, pic).verdict).toBe("unsure");
    expect(objectFit(Float64Array.from([10, 10]), { rect: [0, 0, 0, 512] }, pic).verdict).toBe("unsure");
    expect(objectFit(Float64Array.from([NaN, 10]), { rect: [0, 0, 512, 512] }, pic).objects).toBe(0);
  });

  it("pack items are left out of the centres; a coarse picture is scored as it is", () => {
    const sn = snowyMap();
    const map = parseDungeondraftMap(sn.text);
    const L = levelOf(map, sn.levelKey);
    expect(levelCentres(L).length / 2).toBe(L.objects.length - 1);
    const f = objectFit(levelCentres(L), wholeMap(map), fakeExportFromMap(map, sn.levelKey, 12));
    expect(f.verdict).not.toBe("no");
  });

  it("effects (smoke, fire) are left out of the centres, from the level and from the sidecar: drawn see-through and drifting, they don't peak", () => {
    const s = scatterMap(1);
    const base = parseDungeondraftMap(s.text).world.levels[0].objects.length;
    const smoke: ObjSpec[] = [];
    for (let i = 0; i < 12; i++) smoke.push({ name: i % 2 ? "environment/smoke_02" : "environment/fire_01", at: [1.5 + 1.4 * i, 1.5 + 0.7 * i] });
    const scatter = parseDungeondraftMap(s.text).world.levels[0].objects.map((o): ObjSpec => ({
      name: o.texture!.path.replace(/^res:\/\/textures\/objects\//, "").replace(/\.png$/, ""),
      at: [o.position.x / GRID, o.position.y / GRID], rot: o.rotation, scale: [o.scale.x, o.scale.y], mirror: o.mirror,
    }));
    const map = parseDungeondraftMap(mapText({ w: 20, h: 12, levels: [{ key: "0", label: "Ground", terrain: null, objects: [...scatter, ...smoke] }] }));
    const L = levelOf(map, "0");
    expect(L.objects.length).toBe(base + 12);
    expect(levelCentres(L).length / 2).toBe(base);
    const pic = fakeExportFromMap(map, "0", 24);
    const r = extractSidecar(map, "0", wholeMap(map), pic, FIXTURE_SPRITES, { levels: [] });
    expect(Array.from(r.sidecar.objects.role).filter((x) => x === OR.EFFECT).length).toBe(12);
    expect(sidecarFit(r.sidecar, pic).objects).toBe(r.report.fit.objects);
    expect(r.report.fit.objects).toBe(base);
  });

  it("from the sidecar alone (2.4's check): its objects and META.rect", () => {
    const sn = snowyMap();
    const pic = fakeExport(sn.sidecar, 24);
    const f = sidecarFit(sn.sidecar, pic);
    expect(f.objects).toBe(13); // the pack object is left out
    expect(f.verdict).toBe("yes");
    const other = fakeExportFromMap(parseDungeondraftMap(scatterMap(2).text), "0", 24);
    expect(sidecarFit(sn.sidecar, other).verdict).not.toBe("yes");
  });

  it("takes well under its budget on a 20 x 12 map", () => {
    const s = scatterMap(1);
    const map = parseDungeondraftMap(s.text);
    const pic = fakeExportFromMap(map, s.levelKey, 32);
    const c = levelCentres(levelOf(map, s.levelKey));
    objectFit(c, wholeMap(map), pic);
    const t0 = performance.now();
    objectFit(c, wholeMap(map), pic);
    const ms = performance.now() - t0;
    console.log(`fit, 20 x 12 squares at 32 px a square: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
  });
});

// ------------------------------------------------------------------ the public samples

interface Loaded { map: DDMap; key: string; rect: PictureRect; pic: PictureSample }

/** A sample pair at 24 px a square, its rectangle from the .dd2vtt or the whole map, its level from the pair or rankLevels. */
function loadSample(p: SamplePair): Loaded {
  const map = parseDungeondraftMap(sampleText(p.map));
  const full = readPicture(p.picture);
  const r = pictureRect(map, full.w, full.h, full.vtt);
  if ("error" in r) throw new Error(r.error);
  const sq = [(r.rect[2] - r.rect[0]) / GRID, (r.rect[3] - r.rect[1]) / GRID];
  const pic = atPxPerSquare(full, sq[0], sq[1], 24);
  const key = p.level ?? chooseLevel(rankLevels(map, pic, r, full.vtt))!.key;
  return { map, key, rect: r, pic };
}

const shiftRect = (r: PictureRect, dx: number, dy: number): PictureRect =>
  ({ rect: [r.rect[0] + dx * GRID, r.rect[1] + dy * GRID, r.rect[2] + dx * GRID, r.rect[3] + dy * GRID] });

describe("the fit on the public sample pairs (DD_FIXTURES)", () => {
  for (const p of SAMPLE_PAIRS) {
    it.skipIf(!havePair(p))(`${p.map} on ${p.picture}: never "no"; shifted, never "yes"`, () => {
      const s = loadSample(p);
      const c = levelCentres(levelOf(s.map, s.key));
      const t0 = performance.now();
      const f = objectFit(c, s.rect, s.pic);
      const ms = performance.now() - t0;
      const lines = [`${p.map} on ${p.picture} (level ${s.key}): ${f.verdict}, lead ${f.lead.toFixed(2)}, sharp ${f.sharp.toFixed(2)}, ${f.objects} objects, ${ms.toFixed(0)} ms`];
      expect(f.verdict).not.toBe("no");
      for (const [dx, dy] of [[2, 0], [0, -1], [0.5, 0.5]]) {
        const g = objectFit(c, shiftRect(s.rect, dx, dy), s.pic);
        lines.push(`  shifted ${dx},${dy}: ${g.verdict}, best ${g.best}`);
        expect(g.verdict).not.toBe("yes");
      }
      console.log(lines.join("\n"));
    });
  }
  for (const p of SWAPPED_PAIRS) {
    it.skipIf(!havePair(p))(`swapped: ${p.map} on ${p.picture}: never "yes"`, () => {
      const s = loadSample(p);
      const f = objectFit(levelCentres(levelOf(s.map, s.key)), s.rect, s.pic);
      console.log(`swapped ${p.map} on ${p.picture}: ${f.verdict}, lead ${f.lead.toFixed(2)}, sharp ${f.sharp.toFixed(2)}`);
      expect(f.verdict).not.toBe("yes");
    });
  }

  const tulgi = SAMPLE_PAIRS.find((p) => p.map === "fs_tulgi")!;
  it.skipIf(!havePair(tulgi))("roof levels on their roof exports: Tulgi's (27 smoke effects, 2 chimneys) is not \"no\"; Pelcs's is \"yes\"", () => {
    for (const [name, picture, want] of [["fs_tulgi", "fs_tulgi_roof.png", "unsure"], ["fs_pelcs", "fs_pelcs_roof.png", "yes"]] as const) {
      const map = parseDungeondraftMap(sampleText(name));
      const full = readPicture(picture);
      const r = pictureRect(map, full.w, full.h);
      if ("error" in r) throw new Error(r.error);
      const pic = atPxPerSquare(full, map.world.width, map.world.height, 24);
      const roof = map.world.levels.find((l) => l.label === "Roof")!;
      const f = objectFit(levelCentres(roof), r, pic);
      console.log(`${name}'s roof level on ${picture}: ${f.verdict}, lead ${f.lead.toFixed(2)}, ${f.objects} objects`);
      expect(f.verdict, name).toBe(want);
      // Whatever ranks it, the attach isn't held for the fit.
      const ranks = rankLevels(map, pic, r);
      expect(ranks[0].key).toBe(roof.key);
      expect(extractSidecar(map, roof.key, r, pic, SPRITE_SIZES, { levels: ranks }).report.hold).toBe(null);
    }
  });

  it.skipIf(!haveVernExport("waterfall.vtt"))(`waterfall on Vern's 1.2 export (${DD_VERN}): "yes", from its small things; shifted half a square or 2 squares, never "yes"`, () => {
    const map = parseDungeondraftMap(waterfallText());
    const full = vernPicture("waterfall.vtt");
    const r = pictureRect(map, full.w, full.h, full.vtt);
    if ("error" in r) throw new Error(r.error);
    const pic = atPxPerSquare(full, 50, 35, 24);
    const L = map.world.levels[0];
    const c = levelCentres(L), radii = levelRadii(L);
    const f = objectFit(c, r, pic, radii);
    console.log(`waterfall: ${f.verdict}, lead ${f.lead.toFixed(2)}, sharp ${f.sharp.toFixed(2)}, peak ${f.peak!.toFixed(2)}, ${f.small} small of ${f.objects} objects, best ${f.best}`);
    expect(f.verdict).toBe("yes");
    expect(f.lead).toBeGreaterThan(1.2);
    expect(f.small).toBeGreaterThanOrEqual(FIT.minObjects);
    // Over every object (27 pines and eucalyptus wider than the half-square step), the correct
    // placement isn't sharp: that is why the small ones carry it.
    expect(objectFit(c, r, pic).sharp).toBeGreaterThan(FIT.yesSharp);
    for (const [dx, dy] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [2, 0]]) {
      const g = objectFit(c, shiftRect(r, dx, dy), pic, radii);
      expect(g.verdict, `shifted ${dx},${dy}`).not.toBe("yes");
    }
  });
});

import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { BURST_MS, buildHints, canFold } from "../src/client/room/buildInput";
import type { BuildOptions } from "../src/client/room/client";
import { SCATTER_SIZE_SPREAD, SCATTER_SPACING, scatterDab } from "../src/client/room/scatter";
import type { ScatterDensity, ScatterSpec } from "../src/client/room/scatter";
import { centreOf } from "../src/client/room/stampGeom";
import type { Placed } from "../src/client/room/stampGeom";
import { foldOf } from "../src/client/ui/objectGroups";
import { STAMP_POS_STEP, naturalStampSize, stampLayer } from "../src/shared/terrain";
import type { CellBounds, StampId } from "../src/shared/terrain";

/** A seeded stand-in for Math.random, so every run scatters the same. */
function seeded(seed = 1): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const anywhere = () => true;

/** Dabs the brush n times at one spot, as a drag going over the same ground, keeping what each added. */
function dabs(spec: ScatterSpec, n: number, u = 50, v = 50, inside: (b: CellBounds) => boolean = anywhere, start: Placed[] = []) {
  const rand = seeded(7);
  const all = [...start];
  const near = (x: number, y: number, r: number) => all.filter((p) => Math.hypot(centreOf(p).x - x, centreOf(p).y - y) <= r);
  const added: number[] = [];
  for (let i = 0; i < n; i++) {
    const got = scatterDab(spec, u, v, near, inside, rand);
    all.push(...got);
    added.push(got.length);
  }
  return { all: all.slice(start.length), added };
}

const TREES = foldOf("d:oak-tree" as StampId)!.ids;
const spec = (density: ScatterDensity, ids: readonly StampId[] = TREES, brush = 6): ScatterSpec => ({ ids, brush, density });

describe("the scatter brush", () => {
  it("mixes a picked Dungeon object's group, and has nothing to mix for Tabletop's own", () => {
    const fold = foldOf("d:oak-tree" as StampId)!;
    expect(fold.name).toBe("Leafy trees");
    expect(fold.ids).toContain("d:oak-tree");
    expect(fold.ids.length).toBeGreaterThan(20);
    expect(foldOf("d:pine" as StampId)!.name).toBe("Evergreens");
    expect(foldOf("tree")).toBeNull();
  });

  it("puts each object in the brush's circle, anywhere, turned at random, at its own size give or take a fifth", () => {
    const { all } = dabs(spec("medium"), 5);
    expect(all.length).toBeGreaterThan(3);
    for (const p of all) {
      expect(TREES).toContain(p.id);
      const m = centreOf(p);
      // Within the circle (3 squares round 50, 50), give or take where a sixteenth rounds it.
      expect(Math.hypot(m.x - 50, m.y - 50)).toBeLessThanOrEqual(3 + STAMP_POS_STEP);
      expect(p.col / STAMP_POS_STEP).toBe(Math.round(p.col / STAMP_POS_STEP));
      expect(p.deg % 5).toBe(0);
      const natural = naturalStampSize(p.id);
      expect(p.size).toBeGreaterThanOrEqual(Math.max(0.5, natural * (1 - SCATTER_SIZE_SPREAD) - 0.125));
      expect(p.size).toBeLessThanOrEqual(Math.min(3, natural * (1 + SCATTER_SIZE_SPREAD) + 0.125));
    }
    // Not all turned the same way, and not all the same tree.
    expect(new Set(all.map((p) => p.deg)).size).toBeGreaterThan(1);
    expect(new Set(all.map((p) => p.id)).size).toBeGreaterThan(1);
  });

  it("keeps objects of a layer apart by the density's spacing, so going over the same ground again doesn't pile them up", () => {
    for (const density of ["sparse", "medium", "dense"] as ScatterDensity[]) {
      const { all, added } = dabs(spec(density), 40);
      const k = SCATTER_SPACING[density];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = centreOf(all[i]);
          const b = centreOf(all[j]);
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(k * (all[i].size / 2 + all[j].size / 2) - 1e-9);
        }
      }
      // Full by the end: the last dabs find hardly any room.
      expect(added.slice(-10).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
    }
  });

  it("packs more in the denser it's set", () => {
    const count = (d: ScatterDensity) => dabs(spec(d), 40).all.length;
    expect(count("dense")).toBeGreaterThan(count("medium"));
    expect(count("medium")).toBeGreaterThan(count("sparse"));
  });

  it("lets treetops spread over what lies on the floor", () => {
    const leaves = "d:fallen-leaves-brown" as StampId;
    expect(stampLayer(leaves)).toBe(0);
    // A carpet of leaves under the whole brush.
    const floor: Placed[] = [];
    for (let c = 44; c < 56; c++) for (let r = 44; r < 56; r++) floor.push({ id: leaves, col: c, row: r, deg: 0, size: 1 });
    expect(dabs(spec("medium"), 10, 50, 50, anywhere, floor).all.length).toBeGreaterThan(3);
  });

  it("stays on the scene", () => {
    const inside = (b: CellBounds) => b.c0 >= 50 && b.r0 >= 50;
    const { all } = dabs(spec("dense"), 20, 50, 50, inside);
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) expect(p.col >= 50 && p.row >= 50).toBe(true);
  });

  it("scatters just the one picked, when there's nothing to mix", () => {
    const { all } = dabs(spec("medium", ["bush"]), 5);
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((p) => p.id))).toEqual(new Set(["bush"]));
  });

  it("is one undo step for the whole drag, however long it pauses", () => {
    const top = { sceneId: "s1", steps: {}, coalesce: { key: "scatter|b3", at: 1000 } };
    expect(canFold(top, "scatter|b3", "s1", 1000 + BURST_MS + 5000, true, true)).toBe(true);
    expect(canFold(top, "scatter|b3", "s1", 1000 + BURST_MS + 5000, true)).toBe(false);
    // A new drag (a new key) is a step of its own.
    expect(canFold(top, "scatter|b4", "s1", 1100, true, true)).toBe(false);
  });

  it("says along the bottom what the mouse and keys do", () => {
    const o = { mode: "stamps", stampMode: "scatter" } as BuildOptions;
    const hints = buildHints(o, { objects: 0, doors: 0 }, { mac: false, wheel: "auto", backLabel: "Objects" }).map(([k, w]) => `${k} ${w}`);
    expect(hints.slice(0, 3)).toEqual(["Drag scatter", "[ ] brush size", "Alt+drag erase"]);
    expect(hints).toContain("Ctrl+wheel zoom");
  });
});

describe("in the guide", () => {
  it("is in What's new under spell effects, naming the bar's controls", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    const entry = JSON.stringify(news.parts[9]);
    expect(news.parts[9].title).toBe("Scatter forests on the fly (31 October 2026)");
    for (const label of ["**Scatter**", "**Mix", "**Sparse**", "**Dense**"]) expect(entry).toContain(label);
  });

  it("has the how-to with the objects", async () => {
    const building = GUIDE.find((s) => s.id === "building-maps")!;
    expect(building.parts.map((p) => p.title)).toContain("Scatter a forest");
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const bar = fs.readFileSync(new URL("../src/client/ui/Toolbar.tsx", import.meta.url), "utf8");
    expect(bar).toContain("<SprayCan size={14} /> Scatter");
    expect(bar).toContain("SCATTER_DENSITY_LABELS");
  });
});

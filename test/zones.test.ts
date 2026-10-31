import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { drawZone, inZone, seedOf, zoneEdges, zoneMoves, zoneOf } from "../src/client/room/zonefx";
import { sanitizeItem } from "../src/shared/sanitize";
import { SPELL_FX, ZONE_SPELLS, zoneSpell } from "../src/shared/spellfx";
import type { DrawingItem } from "../src/shared/types";
import { ZONE_LOOKS, isZoneLook, type ZoneLook } from "../src/shared/zones";

const zoneDrawing = (over: Record<string, unknown> = {}) => ({
  id: "zone00000001",
  sceneId: "scene1",
  kind: "drawing",
  z: 1,
  shape: "ellipse",
  points: [100, 100, 300, 300],
  color: "#4f9dde",
  width: 2,
  fill: false,
  fx: "fog",
  spell: "Fog Cloud",
  ...over,
});

describe("the spells that stay", () => {
  it("name each spell once, across both lists, each with a look and a size", () => {
    const names = [...SPELL_FX, ...ZONE_SPELLS].map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const z of ZONE_SPELLS) {
      expect(isZoneLook(z.look), z.name).toBe(true);
      expect(z.size, z.name).toBeGreaterThan(0);
    }
    expect(zoneSpell("Spike Growth")).toMatchObject({ look: "spikes", shape: "circle", size: 7 });
    expect(zoneSpell("Pit")).toMatchObject({ shape: "square", size: 7 });
  });

  it("say which change the lighting", () => {
    expect(ZONE_LOOKS.fog.sight).toBe("block");
    expect(ZONE_LOOKS.darkness.sight).toBe("dark");
    expect(ZONE_LOOKS.light.sight).toBe("light");
    expect(ZONE_LOOKS.moonbeam.sight).toBe("light");
    expect(ZONE_LOOKS.spikes.sight).toBeNull();
  });
});

describe("a spell zone, as the Room keeps it", () => {
  it("keeps its look and spell on a circle or a rectangle", () => {
    const item = sanitizeItem(zoneDrawing(), "user1") as DrawingItem;
    expect(item.fx).toBe("fog");
    expect(item.spell).toBe("Fog Cloud");
    const rect = sanitizeItem(zoneDrawing({ shape: "rect", fx: "pit", spell: "Pit" }), "user1") as DrawingItem;
    expect(rect.fx).toBe("pit");
  });

  it("drops a look it doesn't know, or one on any other shape, and keeps the drawing", () => {
    expect((sanitizeItem(zoneDrawing({ fx: "lava-lake" }), "user1") as DrawingItem).fx).toBeUndefined();
    const pen = sanitizeItem(zoneDrawing({ shape: "pen" }), "user1") as DrawingItem;
    expect(pen.fx).toBeUndefined();
    expect(pen.spell).toBeUndefined();
  });

  it("keeps a spell's name short", () => {
    const item = sanitizeItem(zoneDrawing({ spell: "x".repeat(100) }), "user1") as DrawingItem;
    expect(item.spell!.length).toBeLessThanOrEqual(40);
  });
});

describe("drawing a zone", () => {
  it("knows its middle, size, inside and edge", () => {
    const z = zoneOf("fog", "ellipse", [100, 100, 300, 200], 1, "#ffffff");
    expect([z.x, z.y, z.rx, z.ry]).toEqual([200, 150, 100, 50]);
    expect(inZone(z, 200, 150)).toBe(true);
    expect(inZone(z, 290, 150)).toBe(true);
    expect(inZone(z, 290, 190)).toBe(false);
    expect(zoneEdges(z)).toHaveLength(24);
    const r = zoneOf("pit", "rect", [0, 0, 70, 140], 1, "#ffffff");
    expect(zoneEdges(r)).toHaveLength(4);
    expect(inZone(r, 69, 139)).toBe(true);
    expect(inZone(r, 71, 10)).toBe(false);
  });

  it("closes its edge, end to end", () => {
    const edges = zoneEdges(zoneOf("darkness", "ellipse", [0, 0, 100, 100], 1, "#ffffff"));
    edges.forEach((e, i) => {
      const next = edges[(i + 1) % edges.length];
      expect([e[2], e[3]]).toEqual([next[0], next[1]]);
    });
  });

  it("draws every look, and says which keep moving", () => {
    const calls: string[] = [];
    const gradient = { addColorStop: () => {} };
    const c = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === "createRadialGradient" || key === "createLinearGradient") return () => gradient;
          if (key === "measureText") return () => ({ width: 40 });
          return () => {
            calls.push(key);
          };
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    for (const look of Object.keys(ZONE_LOOKS) as ZoneLook[]) {
      calls.length = 0;
      drawZone(c, zoneOf(look, "ellipse", [0, 0, 280, 280], seedOf("abc"), "#4f9dde", "Silence"), 1000, 70, 1, false);
      expect(calls.length, look).toBeGreaterThan(0);
    }
    expect(zoneMoves("fog")).toBe(true);
    expect(zoneMoves("pit")).toBe(false);
  });

  it("draws the same details for the same zone on every screen", () => {
    expect(seedOf("zone00000001")).toBe(seedOf("zone00000001"));
    expect(seedOf("zone00000001")).not.toBe(seedOf("zone00000002"));
  });
});

describe("in the guide", () => {
  it("is in What's new under spells on tokens, and says how to leave and end a spell", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[1].title).toBe("Spells that stay: fog, darkness, light and more (31 October 2026)");
    const section = GUIDE.find((s) => s.id === "spells")!;
    const titles = section.parts.map((p) => p.title);
    expect(titles).toContain("Leave a spell on the map");
    expect(titles).toContain("End a spell");
    for (const z of ZONE_SPELLS) expect(JSON.stringify(section), z.name).toContain(z.name);
    expect(JSON.stringify(section)).toContain("**End spell**");
  });

  it("names the controls as the pages show them", async () => {
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("../src/client/ui/SelectionBar.tsx")).toContain("End spell");
    expect(read("../src/client/ui/Toolbar.tsx")).toContain("On the map:");
    expect(read("../src/client/ui/Toolbar.tsx")).toContain('["Zones that stay", ZONE_SPELLS]');
  });
});

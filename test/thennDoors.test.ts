import { describe, expect, it } from "vitest";
import { parseDungeonPayload } from "../src/client/dd/fromDungeon";
import { PROPS } from "../src/client/dungeonLib/props";

// Thenn's doors and archways from Dungeon (16 November 2026): openings in the frame of Thenn's
// doorway shrine. A Thenn door shuts like a door; a Thenn archway is open like an archway. Dungeon
// sends each one's frame as one of its objects (thenn-door-frame-one or -two, scaled to the
// opening), which Table's copy of Dungeon's library stands up in 3D.

type Fs = { readFileSync(p: URL, e: string): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
const FIXTURE = fs.readFileSync(new URL("./fixtures/dungeon-old-keep.dd2vtt", import.meta.url), "utf8");
const export0 = JSON.parse(FIXTURE) as { dungeon: Record<string, any> };

describe("Thenn's doors and archways from Dungeon", () => {
  it("shut a Thenn door and leave a Thenn archway open", () => {
    const p = structuredClone(export0.dungeon);
    const doors = p.shapes.doors as { kind: string }[];
    expect(doors.length).toBeGreaterThanOrEqual(2);
    doors[0].kind = "thenn";
    doors[1].kind = "thenn-arch";
    const { map } = parseDungeonPayload(JSON.stringify(p));
    const L = map.world.levels[0];
    const portals = [...L.walls.flatMap((w) => w.portals), ...L.portals];
    const byKind = (k: string) => portals.filter((q) => q.texture?.path === `dungeon://portals/${k}`);
    expect(byKind("thenn").map((q) => q.closed)).toEqual([true]);
    expect(byKind("thenn-arch").map((q) => q.closed)).toEqual([false]);
  });

  it("know the frames Dungeon sends with them, and Thenn's shrines", () => {
    for (const id of ["thenn-door-frame-one", "thenn-door-frame-two", "thenn-doorway-great", "thenn-doorway-wild"]) expect(PROPS.some((q) => q.id === id), id).toBe(true);
  });
});

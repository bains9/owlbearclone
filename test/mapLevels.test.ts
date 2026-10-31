// A map from Dungeon with levels comes in as one file, and makes a scene for each level, in
// order (mapImport.ts parseUniversalVttLevels). Fixture: Dungeon's sample map as the first of
// three levels ("Ground floor", then "Cellar" and "Crypt"), exported by Dungeon's own code with
// 1 x 1 stand-in pictures.

import { describe, expect, it } from "vitest";
import { MAX_FILE_LEVELS, parseUniversalVtt, parseUniversalVttLevels, readMapFiles } from "../src/client/mapImport";
import { parseDungeonPayload } from "../src/client/dd/fromDungeon";
import { GUIDE } from "../src/client/guide";

type Fs = { readFileSync(path: string | URL, encoding: "utf8"): string };
const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as Fs;
const FIXTURE = fs.readFileSync(new URL("./fixtures/dungeon-levels.dd2vtt", import.meta.url), "utf8");
const data = JSON.parse(FIXTURE) as Record<string, any>;

describe("a map from Dungeon with levels", () => {
  it("makes a map for each level, in order, named after the map and the level", () => {
    const maps = parseUniversalVttLevels(FIXTURE, "Old Keep.dd2vtt");
    expect(maps.map((m) => m.name)).toEqual(["Old Keep: Ground floor", "Old Keep: Cellar", "Old Keep: Crypt"]);
    for (const m of maps) {
      expect(m.ddFrom).toBe("dungeon");
      expect([m.cols, m.rows, m.pxPerCell]).toEqual([36, 24, 128]);
      expect(m.vtt?.resolution.map_size).toEqual({ x: 36, y: 24 });
    }
    // Each picture is named for its level, so they're told apart among the room's maps.
    expect(maps.map((m) => m.image.name)).toEqual(["Old Keep: Ground floor.png", "Old Keep: Cellar.png", "Old Keep: Crypt.png"]);
  });

  it("gives each level its own map data, which reads as a Dungeon map", async () => {
    const maps = parseUniversalVttLevels(FIXTURE, "Old Keep.dd2vtt");
    const payloads = await Promise.all(maps.map(async (m) => JSON.parse(await m.dd!.text()) as Record<string, any>));
    expect(payloads.map((p) => p.levelName)).toEqual(["Ground floor", "Cellar", "Crypt"]);
    expect(payloads.map((p) => p.floors.length)).toEqual([4, 1, 1]);
    // No level's data carries the others' (nor their pictures).
    for (const p of payloads) expect(p).not.toHaveProperty("dungeon_levels");
    const texts = await Promise.all(maps.map((m) => m.dd!.text()));
    for (const t of texts) expect(() => parseDungeonPayload(t)).not.toThrow();
  });

  it("comes in through the file picker as every level", async () => {
    const file = new File([FIXTURE], "Old Keep.dd2vtt", { type: "application/json" });
    const { maps, errors } = await readMapFiles([file]);
    expect(errors).toEqual([]);
    expect(maps.map((m) => m.name)).toEqual(["Old Keep: Ground floor", "Old Keep: Cellar", "Old Keep: Crypt"]);
  });

  it("is still read as its first level where only one map is wanted", () => {
    const first = parseUniversalVtt(FIXTURE, "Old Keep.dd2vtt");
    expect(first.name).toBe("Old Keep");
    expect(first.ddFrom).toBe("dungeon");
  });

  it("leaves a file without levels as one map, named as before", () => {
    const single = { ...data };
    delete single.dungeon_levels;
    const maps = parseUniversalVttLevels(JSON.stringify(single), "Old Keep.dd2vtt");
    expect(maps.map((m) => m.name)).toEqual(["Old Keep"]);
  });

  it("says which level is damaged, and takes at most as many as Dungeon makes", () => {
    const junk = { ...data, dungeon_levels: [data.dungeon_levels[0], 7] };
    expect(() => parseUniversalVttLevels(JSON.stringify(junk), "Old Keep.dd2vtt")).toThrow("has a level (3) that isn't a map.");
    const noImage = { ...data, dungeon_levels: [{ ...data.dungeon_levels[0], image: undefined }] };
    expect(() => parseUniversalVttLevels(JSON.stringify(noImage), "Old Keep.dd2vtt")).toThrow("(level 2, Cellar) isn't a Universal VTT map");
    const many = { ...data, dungeon_levels: Array.from({ length: 30 }, () => data.dungeon_levels[0]) };
    expect(parseUniversalVttLevels(JSON.stringify(many), "Old Keep.dd2vtt")).toHaveLength(MAX_FILE_LEVELS);
    const unnamed = { ...data, dungeon_levels: [{ ...data.dungeon_levels[0], dungeon: { ...data.dungeon_levels[0].dungeon, levelName: "  " } }] };
    expect(parseUniversalVttLevels(JSON.stringify(unnamed), "Old Keep.dd2vtt")[1].name).toBe("Old Keep: Level 2");
  });
});

describe("the guide", () => {
  const news = GUIDE.find((s) => s.id === "whats-new")!;
  const text = (p: { steps: string[]; notes: string[] }) => [...p.steps, ...p.notes].join("\n");

  it("has maps with levels seventh in What's new, saying how they come in", () => {
    expect(news.parts[22].title).toBe("Maps with levels from Dungeon (26 October 2026)");
    const entry = text(news.parts[22]);
    for (const what of ["a scene for each level", "in order", "Old Keep: Cellar", "**New scene**"]) expect(entry).toContain(what);
  });
});

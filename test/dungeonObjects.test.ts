import { describe, expect, it } from "vitest";
import { cleanStamps, isDungeonStamp, isStampId, makeStamp, naturalStampSize, STAMP_IDS, stampLayer, stampName, type StampId } from "../src/shared/terrain";
import { DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import { OBJECT_COUNT, OBJECT_GROUPS, groupOf, searchObjects } from "../src/client/ui/objectGroups";
import { libraryPartOf } from "../src/client/ui/library";
import { RECENT_MAX, withRecent } from "../src/client/ui/recentPicks";

// Dungeon's objects in the Build tool: ids "d:<dungeon id>", accepted by the server's check,
// sized and named from Dungeon's catalogue, and found in the picker by group or search.

describe("Dungeon's objects as Build tool objects", () => {
  it("are object ids next to the sixteen, and nothing else is", () => {
    expect(isStampId("table")).toBe(true);
    expect(isStampId("d:oak-tree")).toBe(true);
    expect(isDungeonStamp("d:oak-tree")).toBe(true);
    expect(isDungeonStamp("table")).toBe(false);
    for (const bad of ["d:", "d:no-such-thing", "oak-tree", "D:oak-tree", "d:__proto__", 5, null]) expect(isStampId(bad), String(bad)).toBe(false);
    for (const p of DUNGEON_PROPS) expect(isStampId(`d:${p.id}`), p.id).toBe(true);
  });

  it("pass the server's check of a chunk's objects, and unknown ones don't", () => {
    const ok = [makeStamp("d:oak-tree", 3, 4, 45, 3), makeStamp("table", 0, 0, 0, 1)];
    expect(cleanStamps(ok)).toEqual(ok);
    expect(cleanStamps([["d:no-such-thing", 0, 0, 0, 1]])).toBeUndefined();
  });

  it("start at their natural size, within half a square and 3 squares", () => {
    expect(naturalStampSize("d:table")).toBe(2);
    expect(naturalStampSize("d:oak-tree")).toBe(3); // 3.2 squares, the most an object can be
    expect(naturalStampSize("d:chair")).toBe(0.5); // 0.6, to the nearest quarter: 0.5
    expect(naturalStampSize("d:wagon")).toBe(3);
    expect(naturalStampSize("table")).toBe(1);
  });

  it("are named as Dungeon names them", () => {
    expect(stampName("d:oak-tree")).toBe("Oak tree");
    expect(stampName("shelf")).toBe("Bookshelf");
  });
});

describe("the object picker", () => {
  it("has every object once, Tabletop's sixteen first, then Dungeon's categories, each folding into its groups", () => {
    const all = OBJECT_GROUPS.flatMap((g) => g.ids);
    expect(all.length).toBe(STAMP_IDS.length + DUNGEON_PROPS.length);
    expect(OBJECT_COUNT).toBe(all.length);
    expect(new Set(all).size).toBe(all.length);
    expect(OBJECT_GROUPS.map((g) => g.name)).toEqual([
      "Tabletop",
      "Furniture",
      "Containers",
      "Kitchen & tavern",
      "Washroom",
      "Nature",
      "Camp & outdoors",
      "Dungeon",
      "Light",
      "Library & magic",
      "Workshop & smithy",
      "Ship & dock",
      "Farm & village",
      "Temple & graveyard",
      "Arms & armour",
    ]);
    for (const g of OBJECT_GROUPS) expect(g.ids.length, g.name).toBeGreaterThan(0);
    // Dungeon's categories fold again, into their groups, which hold every object once.
    expect(OBJECT_GROUPS[0].parts).toBeUndefined();
    for (const g of OBJECT_GROUPS.slice(1)) expect(g.parts!.flatMap((p) => p.ids), g.name).toEqual(g.ids);
    expect(OBJECT_GROUPS.find((g) => g.name === "Furniture")!.parts!.map((p) => p.name)).toContain("Tables");
    expect(libraryPartOf(OBJECT_GROUPS, "d:table-long-walnut-set")).toBe("Tables");
    expect(libraryPartOf(OBJECT_GROUPS, "campfire")).toBe("");
    expect(groupOf("d:oak-tree")).toBe("Nature");
    expect(groupOf("campfire")).toBe("Tabletop");
  });

  it("are drawn in Dungeon's layers, and the sixteen all stand on the floor as before", () => {
    expect(stampLayer("d:rug")).toBe(0);
    expect(stampLayer("d:trapdoor")).toBe(0);
    expect(stampLayer("d:dining-table")).toBe(1);
    expect(stampLayer("d:oak-tree")).toBe(2);
    expect(stampLayer("d:chandelier")).toBe(2);
    for (const id of STAMP_IDS) expect(stampLayer(id), id).toBe(1);
  });

  it("finds objects by every word typed, in name or group", () => {
    const oaks = ["d:oak-tree", ...DUNGEON_PROPS.filter((p) => p.id.startsWith("oak-tree-")).map((p) => `d:${p.id}`)];
    expect(oaks.length).toBe(7);
    expect(searchObjects("oak")).toEqual(oaks);
    expect(searchObjects("OAK")).toEqual(oaks);
    expect(searchObjects("table walnut set")).toContain("d:table-long-walnut-set");
    const trees = searchObjects("tree nature");
    expect(trees).toContain("d:oak-tree");
    expect(trees).toContain("d:dead-tree");
    expect(trees).not.toContain("tree"); // Tabletop's tree is in the Tabletop group
    expect(searchObjects("tree")).toContain("tree");
    expect(searchObjects("kitchen").length).toBeGreaterThanOrEqual(10);
    expect(searchObjects("")).toEqual([]);
    expect(searchObjects("zzz")).toEqual([]);
  });
});

describe("recent objects", () => {
  it("keeps the last few picked, newest first, without repeats", () => {
    let list: StampId[] = [];
    for (const id of ["table", "d:oak-tree", "chair", "table"] as StampId[]) list = withRecent(list, id);
    expect(list).toEqual(["table", "chair", "d:oak-tree"]);
    for (let i = 0; i < 20; i++) list = withRecent(list, `d:${DUNGEON_PROPS[i].id}` as StampId);
    expect(list.length).toBe(RECENT_MAX);
  });
});

describe("the guide", () => {
  it("has Dungeon's objects fifth in What's new, with the count the picker shows", async () => {
    const { GUIDE } = await import("../src/client/guide");
    const news = GUIDE.find((s) => s.id === "whats-new")!;
    expect(news.parts[4].title).toBe("Over 2,200 objects from Dungeon in the Build tool (27 October 2026)");
    expect(news.parts[5].title).toBe("Maps with levels from Dungeon (26 October 2026)");
    const entry = [...news.parts[4].steps, ...news.parts[4].notes].join("\n");
    expect(entry).toContain(`**Search ${OBJECT_COUNT} objects**`);
    expect(entry).toContain(`all ${OBJECT_COUNT}`);
    expect(entry).toContain(`${DUNGEON_PROPS.length.toLocaleString("en")} from Dungeon`);
    const howTo = GUIDE.flatMap((s) => s.parts).flatMap((p) => p.steps).find((s) => s.startsWith("Pick an object. The bar shows"))!;
    expect(howTo).toContain(`**Search ${OBJECT_COUNT} objects**`);
    for (const g of OBJECT_GROUPS.slice(1)) expect(howTo, g.name).toContain(g.name);
  });
});

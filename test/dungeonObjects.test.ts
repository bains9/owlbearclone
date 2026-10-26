import { describe, expect, it } from "vitest";
import { cleanStamps, isDungeonStamp, isStampId, makeStamp, naturalStampSize, STAMP_IDS, stampName, type StampId } from "../src/shared/terrain";
import { DUNGEON_PROPS } from "../src/shared/dungeonCatalog";
import { OBJECT_COUNT, OBJECT_GROUPS, groupOf, searchObjects } from "../src/client/ui/objectGroups";
import { RECENT_MAX, withRecent } from "../src/client/ui/recentObjects";

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
  it("has every object once, Tabletop's sixteen first, then Dungeon's seven groups", () => {
    const all = OBJECT_GROUPS.flatMap((g) => g.ids);
    expect(all.length).toBe(STAMP_IDS.length + DUNGEON_PROPS.length);
    expect(OBJECT_COUNT).toBe(all.length);
    expect(new Set(all).size).toBe(all.length);
    expect(OBJECT_GROUPS.map((g) => g.name)).toEqual(["Tabletop", "Furniture", "Containers", "Kitchen & tavern", "Nature", "Camp & outdoors", "Dungeon", "Light"]);
    for (const g of OBJECT_GROUPS) expect(g.ids.length, g.name).toBeGreaterThan(0);
    expect(groupOf("d:oak-tree")).toBe("Nature");
    expect(groupOf("campfire")).toBe("Tabletop");
  });

  it("finds objects by every word typed, in name or group", () => {
    expect(searchObjects("oak")).toEqual(["d:oak-tree"]);
    expect(searchObjects("OAK")).toEqual(["d:oak-tree"]);
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

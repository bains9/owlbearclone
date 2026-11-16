import { describe, expect, it } from "vitest";
import { MAP_MAX_SIDE } from "../src/client/api";
import { GUIDE } from "../src/client/guide";

// Dungeon's maps can be 200 squares a side since 16 November 2026 (they were 120). Table keeps a
// map's picture to MAP_MAX_SIDE pixels on its long side, so it went from 6144 to 10240: a map from
// Dungeon comes in at the 51 pixels a square a 120-square map always had, however big it is.

describe("the biggest map picture Table keeps", () => {
  it("holds a 200-square Dungeon map at 51 pixels a square", () => {
    expect(MAP_MAX_SIDE).toBe(10240);
    expect(Math.floor(MAP_MAX_SIDE / 200)).toBeGreaterThanOrEqual(Math.floor(6144 / 120));
  });

  it("is the number the guide gives", () => {
    const text = JSON.stringify(GUIDE);
    expect(text).not.toContain("6144");
    expect(text.match(/10,240 pixels/g)?.length).toBe(3);
  });
});

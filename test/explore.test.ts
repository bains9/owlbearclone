import { describe, expect, it, vi } from "vitest";
import { MAX_EXPLORE_CELLS, addCells, bitsToText, emptyBits, exploreGrid, hasCell, keyCells, textToBits } from "../src/shared/explore";
import { RoomClient } from "../src/client/room/client";
import { DEFAULT_GRID } from "../src/shared/sanitize";

// What the party has explored (Par: "build remembering explored areas"): kept for each scene on a
// grid of half squares, shared by everyone, the GM able to forget it.

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };
const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const scene = { width: 1000, height: 600, grid: { ...DEFAULT_GRID, size: 100 } };

describe("the explore grid", () => {
  it("is half squares over the scene's area, and its key changes with the grid or the area", () => {
    const g = exploreGrid(scene);
    expect([g.x0, g.y0, g.cell, g.cols, g.rows]).toEqual([0, 0, 50, 20, 12]);
    expect(keyCells(g.key)).toBe(240);
    expect(exploreGrid({ ...scene, grid: { ...scene.grid, size: 80 } }).key).not.toBe(g.key);
    const extended = exploreGrid({ ...scene, bounds: [-200, 0, 1000, 600] });
    expect([extended.x0, extended.cols]).toEqual([-200, 24]);
    expect(extended.key).not.toBe(g.key);
  });

  it("stays small on a huge scene", () => {
    const g = exploreGrid({ width: 40000, height: 40000, grid: { ...DEFAULT_GRID, size: 20 } });
    expect(g.cols * g.rows).toBeLessThanOrEqual(MAX_EXPLORE_CELLS);
    expect(keyCells(g.key)).toBe(g.cols * g.rows);
    expect(keyCells("nonsense")).toBe(0);
  });

  it("keeps cells as bits, adds only new ones, and goes to text and back", () => {
    const bits = emptyBits(240);
    expect(addCells(bits, [3, 3, 17, 239, 240, -1, 2.5, "x"], 240)).toEqual([3, 17, 239]);
    expect(addCells(bits, [3, 4], 240)).toEqual([4]);
    expect([hasCell(bits, 3), hasCell(bits, 5), hasCell(bits, 239)]).toEqual([true, false, true]);
    const back = textToBits(bitsToText(bits), 240);
    expect([...back]).toEqual([...bits]);
    expect(textToBits("!!not base64!!", 240).every((b) => b === 0)).toBe(true);
  });
});

describe("a page's explored cells", () => {
  const room = () => new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });

  it("keeps what's just been seen at once, and sends only what's new", () => {
    const r = room();
    const send = vi.spyOn(r as unknown as { submit: (a: unknown) => void }, "submit").mockImplementation(() => undefined);
    const key = exploreGrid(scene).key;
    r.explore("Scene1234567", key, [1, 2, 3]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ t: "explore", sceneId: "Scene1234567", key, cells: [1, 2, 3] });
    const kept = r.state.explored.Scene1234567;
    expect([hasCell(kept.bits, 2), hasCell(kept.bits, 4)]).toEqual([true, false]);
    // Seen again: nothing new, nothing sent, nothing changed.
    r.explore("Scene1234567", key, [2, 3]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.state.explored.Scene1234567).toBe(kept);
    r.explore("Scene1234567", key, [3, 9]);
    expect(send.mock.calls[1][0]).toMatchObject({ cells: [9] });
  });

  it("takes in what others explored, all of a scene's explored cells, and the GM's forgetting", () => {
    const r = room();
    const key = exploreGrid(scene).key;
    const handle = (msg: unknown) => (r as unknown as { onServer(m: unknown): void }).onServer(msg);
    handle({ t: "explore", sceneId: "Scene1234567", key, cells: [5, 6] });
    expect(hasCell(r.state.explored.Scene1234567.bits, 6)).toBe(true);
    const all = emptyBits(240);
    addCells(all, [100, 200], 240);
    handle({ t: "explore", sceneId: "Scene1234567", key, bits: bitsToText(all) });
    expect([hasCell(r.state.explored.Scene1234567.bits, 6), hasCell(r.state.explored.Scene1234567.bits, 200)]).toEqual([false, true]);
    handle({ t: "explore", sceneId: "Scene1234567", key, reset: true });
    expect(r.state.explored.Scene1234567.bits.every((b) => b === 0)).toBe(true);
  });
});

describe("the Room", () => {
  it("keeps explored cells for scenes with lighting on, from anyone but a display, and lets only the GM forget them", async () => {
    const room = await source("src/worker/room.ts");
    const explore = room.slice(room.indexOf('case "explore": {'), room.indexOf('case "explore.reset": {'));
    expect(explore).toContain("if (conn.display) return;");
    expect(explore).toContain("!scene?.vision?.on");
    expect(explore).toContain("if (msg.key !== grid.key) return;");
    const reset = room.slice(room.indexOf('case "explore.reset": {'), room.indexOf('case "roll": {'));
    expect(reset).toContain("if (!gm) return this.deny(ws);");
    // Sent with hello, to players when the live scene changes, and let go with a deleted scene.
    expect(room).toContain("explored,");
    expect(room).toContain("bits: bitsToText(kept.bits) }, (c) => c.role !== \"gm\")");
    expect(room).toContain("DELETE FROM explored WHERE scene_id = ?");
  });
});

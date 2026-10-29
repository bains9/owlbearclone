import { describe, expect, it, vi } from "vitest";
import { MAX_EXPLORE_CELLS, addCells, bitsToText, emptyBits, exploreGrid, exploreSlot, hasCell, isSceneSlot, keyCells, textToBits } from "../src/shared/explore";
import { RoomClient } from "../src/client/room/client";
import { isOwnSightToken } from "../src/client/room/vision";
import { DEFAULT_GRID, GM_OWNER, sanitizeVision } from "../src/shared/sanitize";
import type { TokenItem } from "../src/shared/types";

// What the party has explored (Par: "build remembering explored areas"): kept for each scene on a
// grid of half squares, shared by everyone, the GM able to forget it. With per-player sight (Par:
// "build per-player sight"), each character keeps their own beside the party's.

const SHEET = "1TestSheetAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "1TestSheetBBBBBBBBBBBBBBBBBBBBBBB";

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

describe("the board", () => {
  it("draws the dark again when what's explored changes, or whose eyes it sees with may have", async () => {
    const board = await source("src/client/room/board.ts");
    const at = board.indexOf("if (s.explored !== this.renderedExplored || s.party !== this.renderedParty || s.fogOpts.lookAs !== this.renderedLookAs) {");
    expect(at).toBeGreaterThan(0);
    expect(board.slice(at, at + 600)).toContain("if (scene?.vision?.on) this.redrawSight();");
  });
});

describe("per-player sight's explored maps", () => {
  it("keeps the party's under the scene's id and a character's beside it", () => {
    expect(exploreSlot("Scene1234567")).toBe("Scene1234567");
    expect(exploreSlot("Scene1234567", "")).toBe("Scene1234567");
    expect(exploreSlot("Scene1234567", SHEET)).toBe(`Scene1234567/${SHEET}`);
    expect(isSceneSlot("Scene1234567", "Scene1234567")).toBe(true);
    expect(isSceneSlot(`Scene1234567/${SHEET}`, "Scene1234567")).toBe(true);
    expect(isSceneSlot("Scene12345678", "Scene1234567")).toBe(false);
    expect(isSceneSlot(`Other1234567/${SHEET}`, "Scene1234567")).toBe(false);
  });

  it("a page keeps a character's own, sends who it's for, and takes in others' by who", () => {
    const r = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    const send = vi.spyOn(r as unknown as { submit: (a: unknown) => void }, "submit").mockImplementation(() => undefined);
    const key = exploreGrid(scene).key;
    r.explore("Scene1234567", key, [1, 2], SHEET);
    expect(send.mock.calls[0][0]).toEqual({ t: "explore", sceneId: "Scene1234567", key, cells: [1, 2], who: SHEET });
    expect(hasCell(r.state.explored[`Scene1234567/${SHEET}`].bits, 2)).toBe(true);
    expect(r.state.explored.Scene1234567).toBeUndefined();
    // The party's (no who) is sent without one.
    r.explore("Scene1234567", key, [7]);
    expect(send.mock.calls[1][0]).toEqual({ t: "explore", sceneId: "Scene1234567", key, cells: [7] });
    const handle = (msg: unknown) => (r as unknown as { onServer(m: unknown): void }).onServer(msg);
    handle({ t: "explore", sceneId: "Scene1234567", key, who: OTHER, cells: [9] });
    expect(hasCell(r.state.explored[`Scene1234567/${OTHER}`].bits, 9)).toBe(true);
    expect(hasCell(r.state.explored[`Scene1234567/${SHEET}`].bits, 9)).toBe(false);
  });

  it("the GM's forgetting clears every one of the scene's, and no other scene's", () => {
    const r = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    const key = exploreGrid(scene).key;
    const handle = (msg: unknown) => (r as unknown as { onServer(m: unknown): void }).onServer(msg);
    handle({ t: "explore", sceneId: "Scene1234567", key, cells: [1] });
    handle({ t: "explore", sceneId: "Scene1234567", key, who: SHEET, cells: [2] });
    handle({ t: "explore", sceneId: "Other1234567", key, who: SHEET, cells: [3] });
    handle({ t: "explore", sceneId: "Scene1234567", key, reset: true });
    expect(r.state.explored.Scene1234567.bits.every((b) => b === 0)).toBe(true);
    expect(r.state.explored[`Scene1234567/${SHEET}`]).toBeUndefined();
    expect(hasCell(r.state.explored[`Other1234567/${SHEET}`].bits, 3)).toBe(true);
  });

  it("a player sees through their character's tokens and the ones they put down; the GM plays nobody", () => {
    const token = (extra: Partial<TokenItem>): TokenItem => ({
      id: "t", sceneId: "Scene1234567", kind: "token", z: 0, owner: GM_OWNER, x: 0, y: 0, size: 1, rotation: 0,
      assetId: null, color: "#fff", label: "", hidden: false, locked: false, rings: [], ...extra,
    });
    const malspar = token({ character: SHEET }), nancael = token({ character: OTHER }), mine = token({ owner: "user1" }), theirs = token({ owner: "user2" });
    expect([malspar, nancael, mine, theirs].map((t) => isOwnSightToken(t, SHEET, "user1"))).toEqual([true, false, true, false]);
    // A character's token is its character's, whoever put it down.
    expect(isOwnSightToken(token({ character: OTHER, owner: "user1" }), SHEET, "user1")).toBe(false);
    // Looking as a character (the GM): only theirs; a hidden token or a prop never.
    expect([malspar, mine].map((t) => isOwnSightToken(t, SHEET, null))).toEqual([true, false]);
    expect(isOwnSightToken(token({ character: SHEET, hidden: true }), SHEET, "user1")).toBe(false);
    expect(isOwnSightToken(token({ owner: "user1", layer: "prop" }), SHEET, "user1")).toBe(false);

    const r = new RoomClient("AbCdEf123456", { uid: "user1", name: "Ann", color: "#ff0000" });
    const party = { configured: true, readAt: 1, characters: [{ id: SHEET, players: [{ userId: "user1", name: "Ann" }] }, { id: OTHER }] };
    r.store.set({ party: party as never, me: { connId: "c1", userId: "user1", name: "Ann", color: "#f00", role: "player" } });
    expect(r.myCharacter).toBe(SHEET);
    r.store.set({ me: { connId: "c0", userId: "user1", name: "GM", color: "#f00", role: "gm" } });
    expect(r.myCharacter).toBeNull();
  });

  it("is a scene setting the server keeps, off unless turned on", () => {
    const base = { on: true, daylight: true, partyLight: 4, sightRange: 12, walls: [], doors: [], lights: [] };
    expect(sanitizeVision({ ...base, perPlayer: true })?.perPlayer).toBe(true);
    expect(sanitizeVision({ ...base, perPlayer: "yes" })).not.toHaveProperty("perPlayer");
    expect(sanitizeVision(base)).not.toHaveProperty("perPlayer");
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
    expect(reset).toContain("this.forgetExplored(scene.id);");
    // Sent with hello, to players when the live scene changes, and let go with a deleted scene.
    expect(room).toContain("explored,");
    expect(room).toContain("for (const s of scenes) if (s.vision?.on) Object.assign(explored, this.exploredMaps(s.id));");
    expect(room).toContain("bits: m.bits }, (c) => c.role !== \"gm\")");
    expect(room).toContain("DELETE FROM explored_maps WHERE scene_id = ?");
    const deleted = room.slice(room.indexOf('case "scene.delete": {'));
    expect(deleted.slice(0, 1200)).toContain("this.forgetExplored(scene.id);");
  });

  it("keeps a character's map only for a character on the scene; a character's exploring is the party's too, and the party's every character's there", async () => {
    const room = await source("src/worker/room.ts");
    const explore = room.slice(room.indexOf('case "explore": {'), room.indexOf('case "explore.reset": {'));
    expect(explore).toContain("if (who && !(isSheetId(who) && here.has(who))) return;");
    expect(explore).toContain('const maps = who ? [who, ""] : ["", ...(scene.vision.perPlayer ? [] : here)];');
    // Only so many a scene, and the party's from before characters had their own is kept.
    expect(room).toContain("if (maps >= MAX_EXPLORE_MAPS) return;");
    expect(room).toContain("INSERT OR IGNORE INTO explored_maps (scene_id, who, key, bits) SELECT scene_id, '', key, bits FROM explored");
  });
});

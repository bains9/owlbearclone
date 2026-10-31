// A map's levels as one (31 October 2026; step 2 of "Maps with levels"): a file's levels share a
// group (from Dungeon, its map and bringing-in), Scenes lists them as one entry, and the GM takes
// the party from one level to the same squares on the next, the spells on them too.
import { describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { levelOf, levelsOf, mapNameOf, onLevel, partyOn, sceneEntries, takeParty } from "../src/client/levels";
import { parseUniversalVttLevels } from "../src/client/mapImport";
import { RoomClient } from "../src/client/room/client";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeScene } from "../src/shared/sanitize";
import type { DrawingItem, Player, Scene, TokenItem } from "../src/shared/types";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const FIXTURE = fs.readFileSync(new URL("./fixtures/dungeon-levels.dd2vtt", import.meta.url), "utf8");

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({
  id,
  name: id,
  order: 0,
  mapAssetId: null,
  width: 1000,
  height: 1000,
  background: "#000000",
  grid: { ...DEFAULT_GRID },
  fogCover: false,
  createdAt: 0,
  ...over,
});
const fileLevel = (id: string, index: number, name: string, group = "GroupAbc1234"): Scene =>
  scene(id, { name: `Old Keep: ${name}`, level: { group, index, name }, createdAt: index });
const token = (id: string, sceneId: string, over: Partial<TokenItem> = {}): TokenItem => ({
  id,
  sceneId,
  kind: "token",
  z: 1,
  owner: GM_OWNER,
  x: 175,
  y: 225,
  size: 1,
  rotation: 0,
  assetId: null,
  color: "#d62f2f",
  label: id,
  hidden: false,
  locked: false,
  rings: [],
  ...over,
});

describe("a map's levels", () => {
  it("come from a file with them, sharing a group, each with its place and name", () => {
    const maps = parseUniversalVttLevels(FIXTURE, "Old Keep.dd2vtt");
    expect(maps.map((m) => m.level && [m.level.index, m.level.name])).toEqual([
      [0, "Ground floor"],
      [1, "Cellar"],
      [2, "Crypt"],
    ]);
    expect(new Set(maps.map((m) => m.level?.group)).size).toBe(1);
    expect(maps[0].level!.group).toMatch(/^[A-Za-z0-9]{12}$/);
    // A file with one level is just a map.
    expect(parseUniversalVttLevels(JSON.stringify({ ...JSON.parse(FIXTURE), dungeon_levels: [] }), "Plain.dd2vtt")[0].level).toBeUndefined();
  });

  it("are kept with the scene, and a bad one isn't", () => {
    const base = { id: "Scene1234567", name: "Old Keep: Cellar", width: 1000, height: 800 };
    expect(sanitizeScene({ ...base, level: { group: "GroupAbc1234", index: 1, name: "Cellar" } })!.level).toEqual({ group: "GroupAbc1234", index: 1, name: "Cellar" });
    for (const bad of [{ group: "x", index: 1, name: "C" }, { group: "GroupAbc1234", index: -1, name: "C" }, { group: "GroupAbc1234", index: 1, name: "" }, "Cellar"]) {
      expect(sanitizeScene({ ...base, level: bad })!.level, JSON.stringify(bad)).toBeUndefined();
    }
    // A change without it keeps it; null takes it away.
    const kept = sanitizeScene({ ...base, level: { group: "GroupAbc1234", index: 1, name: "Cellar" } })!;
    expect(sanitizeScene({ ...base, name: "Renamed" }, kept)!.level).toEqual(kept.level);
    expect(sanitizeScene({ ...base, level: null }, kept)!.level).toBeUndefined();
  });

  it("are listed as one entry where the first one is, in level order, by the map's name", () => {
    const a = scene("Alone1234567", { order: 0 });
    const crypt = { ...fileLevel("Crypt1234567", 2, "Crypt"), order: 3 };
    const ground = { ...fileLevel("Ground123456", 0, "Ground floor"), order: 1 };
    const cellar = { ...fileLevel("Cellar123456", 1, "Cellar"), order: 2 };
    const b = scene("Later1234567", { order: 4 });
    const entries = sceneEntries([a, ground, cellar, crypt, b]);
    expect(entries.map((e) => (e.kind === "scene" ? e.scene.id : `${e.name}: ${e.levels.map((s) => levelOf(s)!.name).join(", ")}`))).toEqual([
      "Alone1234567",
      "Old Keep: Ground floor, Cellar, Crypt",
      "Later1234567",
    ]);
    expect(mapNameOf([ground, cellar, crypt])).toBe("Old Keep");
    // One level left on its own (the others deleted) is just a scene.
    expect(sceneEntries([cellar]).map((e) => e.kind)).toEqual(["scene"]);
    const all = Object.fromEntries([a, ground, cellar, crypt, b].map((s) => [s.id, s]));
    expect(levelsOf(all, cellar).map((s) => s.id)).toEqual(["Ground123456", "Cellar123456", "Crypt1234567"]);
    expect(levelsOf(all, a)).toEqual([a]);
  });

  it("from Dungeon go by its map and bringing-in, so a level an update adds joins them", () => {
    const d = (index: number, batch = "BatchAb12345") => ({ map: "MapAbcd12345", batch, level: ["Ground", "Cellar"][index], index, levels: ["Ground", "Cellar"], asset: "Asset1234567" });
    const one = scene("Dun000000001", { dungeon: d(0) });
    const two = scene("Dun000000002", { dungeon: d(1) });
    expect(levelOf(one)).toEqual({ group: "dungeon:MapAbcd12345:BatchAb12345", index: 0, name: "Ground" });
    expect(levelOf(two)!.group).toBe(levelOf(one)!.group);
    // A map from Dungeon with one level isn't one of several.
    expect(levelOf(scene("Dun000000003", { dungeon: { ...d(0), levels: [""], level: "" } }))).toBeNull();
  });
});

describe("taking the party to another level", () => {
  it("puts a point on the same squares, whatever each level's grid", () => {
    const from = { ...DEFAULT_GRID, size: 50, offsetX: 0, offsetY: 0 };
    const to = { ...DEFAULT_GRID, size: 70, offsetX: 10, offsetY: -5 };
    expect(onLevel({ x: 175, y: 225 }, from, to)).toEqual({ x: 10 + 3.5 * 70, y: -5 + 4.5 * 70 });
  });

  it("takes the tokens selected there, or else the party's", () => {
    const items = {
      hero: token("hero", "Ground123456", { character: "1SheetAbcdefghij" }),
      pc: token("pc", "Ground123456", { owner: "player1abcdef" }),
      orc: token("orc", "Ground123456"),
      prop: token("prop", "Ground123456", { owner: "player1abcdef", layer: "prop" }),
      away: token("away", "Cellar123456", { character: "1SheetAbcdefghij" }),
    };
    expect(partyOn(items, "Ground123456", []).map((t) => t.id)).toEqual(["hero", "pc"]);
    expect(partyOn(items, "Ground123456", ["orc", "away"]).map((t) => t.id)).toEqual(["orc"]);
  });

  it("moves them and the spells on them to the same squares there, and shows players that level", () => {
    const room = new RoomClient("AbCdEf123456", { uid: GM_OWNER, name: "GM", color: "#ff0000" });
    const me: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };
    const ground = fileLevel("Ground123456", 0, "Ground floor");
    const cellar = { ...fileLevel("Cellar123456", 1, "Cellar"), grid: { ...DEFAULT_GRID, size: DEFAULT_GRID.size * 2 } };
    const hero = token("hero", ground.id, { character: "1SheetAbcdefghij" });
    const outline: DrawingItem = { id: "spell1", sceneId: ground.id, kind: "drawing", z: 1, owner: GM_OWNER, shape: "ellipse", points: [150, 200, 200, 250], color: "#ff00ff", width: 2, fill: false, fx: "outline", spell: "Faerie Fire", on: "hero" };
    room.store.set({
      me,
      room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
      scenes: { [ground.id]: ground, [cellar.id]: cellar },
      viewSceneId: ground.id,
      activeSceneId: ground.id,
      items: { hero, spell1: outline, orc: token("orc", ground.id) },
    });
    const change = vi.spyOn(room, "change").mockImplementation(() => {});
    const show = vi.spyOn(room, "activateScene").mockImplementation(() => {});
    expect(takeParty(room, ground, cellar)).toBe(1);
    const k = 2;
    const g = DEFAULT_GRID;
    const at = (x: number, y: number) => [g.offsetX + (x - g.offsetX) * k, g.offsetY + (y - g.offsetY) * k];
    expect(change).toHaveBeenCalledWith({
      upsert: [
        { ...hero, sceneId: cellar.id, x: at(175, 225)[0], y: at(175, 225)[1] },
        { ...outline, sceneId: cellar.id, points: [...at(150, 200), ...at(200, 250)] },
      ],
    });
    expect(show).toHaveBeenCalledWith(cellar.id);
    expect(room.state.selection).toEqual(["hero"]);
  });

  it("is on the GM's bar, on a level of a map, with Up and Down", () => {
    const bar = fs.readFileSync(new URL("../src/client/ui/LevelBar.tsx", import.meta.url), "utf8");
    for (const words of ["Take the party", "if (!gm || !scene) return null;", "takeParty(room, scene, to)", "(players stay where they are)"]) expect(bar).toContain(words);
    const page = fs.readFileSync(new URL("../src/client/ui/RoomPage.tsx", import.meta.url), "utf8");
    expect(page).toContain("<LevelBar />");
    const imports = fs.readFileSync(new URL("../src/client/importScenes.ts", import.meta.url), "utf8");
    expect(imports).toContain("scene.level = d.map.level;");
  });
});

describe("in the guide", () => {
  it("leads What's new, and Scenes says how to go up and down and take the party", () => {
    expect(GUIDE[0].parts[2].title).toBe("A map's levels as one: up, down, and taking the party (31 October 2026)");
    const scenes = GUIDE.find((s) => s.id === "scenes")!;
    const part = scenes.parts.find((p) => p.title === "A map with levels");
    expect(part).toBeDefined();
    for (const words of ["**Take the party**", "▲", "▼", "**Show to players**"]) expect(JSON.stringify(part)).toContain(words);
  });
});

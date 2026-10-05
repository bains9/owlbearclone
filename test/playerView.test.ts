import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, GM_OWNER } from "../src/shared/sanitize";
import type { Asset, Player, Scene } from "../src/shared/types";
import { canSeeAsset, helloScenes, playerScene, sceneFor } from "../src/worker/playerView";

// What the server sends players and table displays of the room's assets and scenes (design 3.5,
// 3.7). The Room itself needs the Workers runtime; these are the decisions it makes, and the last
// test checks that it makes them through these and nothing else.

const gm: Player = { connId: "c0", userId: GM_OWNER, name: "GM", color: "#fff", role: "gm" };
const player: Player = { connId: "c1", userId: "user1", name: "Ann", color: "#f00", role: "player" };
const display: Player = { connId: "c2", userId: "user9", name: "Table", color: "#0f0", role: "player", display: true };

function asset(id: string, owner: string, kind: Asset["kind"] = "map"): Asset {
  return { id, name: id, kind, owner, mime: "image/png", width: 10, height: 10, bytes: 100, createdAt: 1 };
}

function scene(id: string, extra: Partial<Scene> = {}): Scene {
  return {
    id, name: id, order: 0, mapAssetId: "map1", width: 3600, height: 2520, background: "#000000",
    grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 5, ...extra,
  };
}

async function source(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("which assets a connection hears of", () => {
  it("the GM all of them; players and displays only their own uploads, never the GM's (mapdata included)", () => {
    const gmMap = asset("a1", GM_OWNER), gmData = asset("a2", GM_OWNER, "mapdata"), mine = asset("a3", "user1", "token"), theirs = asset("a4", "user2", "token");
    for (const a of [gmMap, gmData, mine, theirs]) expect(canSeeAsset(a, gm)).toBe(true);
    expect([gmMap, gmData, mine, theirs].filter((a) => canSeeAsset(a, player))).toEqual([mine]);
    expect([gmMap, gmData, mine, theirs].filter((a) => canSeeAsset(a, display))).toEqual([]);
    // A player whose id were the GM's owner name still doesn't get the GM's assets.
    expect(canSeeAsset(gmData, { role: "player", userId: GM_OWNER })).toBe(false);
  });
});

describe("which scenes a connection is sent", () => {
  const live = scene("s1", { mapData: { assetId: "side1", forAssetId: "map1" } });
  const other = scene("s2", { mapData: { assetId: "side2", forAssetId: "map1" } });

  it("hello: every scene for the GM, only the live one for players and displays, none when nothing is live", () => {
    expect(helloScenes([live, other], gm, "s1")).toEqual([live, other]);
    expect(helloScenes([live, other], player, "s1")).toEqual([live]);
    expect(helloScenes([live, other], display, "s2")).toEqual([other]);
    expect(helloScenes([live, other], player, null)).toEqual([]);
    expect(helloScenes([live, other], gm, null)).toEqual([live, other]);
  });

  it("a scene change: the GM's as stored, a player's only when it's live", () => {
    expect(sceneFor(other, gm, "s1")).toBe(other);
    expect(sceneFor(other, player, "s1")).toBeNull();
    expect(sceneFor(other, display, "s1")).toBeNull();
    expect(sceneFor(live, player, "s1")).toBe(live);
  });

  it("keeps Dungeondraft data that is in use, with every setting", () => {
    const s = scene("s1", { mapData: { assetId: "side1", forAssetId: "map1", bare: "dead", drawn: "winter", packs: "guess" }, mapRect: [0, 0, 50, 35] });
    expect(playerScene(s)).toBe(s);
    expect(playerScene(scene("s1"))).toEqual(scene("s1"));
  });

  it("leaves out data on hold or paused, so players never get a sidecar id their device doesn't use", () => {
    const held = scene("s1", { mapData: { assetId: "lair", forAssetId: "map1", hold: true }, mapRect: [2, 1, 48, 27] });
    const paused = scene("s1", { mapAssetId: "map2", mapData: { assetId: "old", forAssetId: "map1" } });
    const noPicture = scene("s1", { mapAssetId: null, mapData: { assetId: "old", forAssetId: "map1" } });
    for (const s of [held, paused, noPicture]) {
      const out = sceneFor(s, player, "s1")!;
      expect("mapData" in out).toBe(false);
      expect(JSON.stringify(out)).not.toContain(s.mapData!.assetId);
      // Everything else as stored, and the stored scene untouched.
      const { mapData: _md, ...rest } = s;
      expect(out).toEqual(rest);
      expect(s.mapData).toBeDefined();
      expect(sceneFor(s, display, "s1")).toEqual(out);
      expect(sceneFor(s, gm, "s1")).toBe(s);
      expect(helloScenes([s], player, "s1")).toEqual([out]);
    }
  });

  it("the Room decides through these, in hello, every scene broadcast and the live-scene change", async () => {
    const room = await source("../src/worker/room.ts");
    expect(room).toContain('from "./playerView"');
    expect(room).not.toMatch(/private canSeeAsset/);
    expect(room).toContain("scenes: helloScenes(this.scenes.values(), conn, this.activeSceneId)");
    expect(room).toContain("assets: [...this.assets.values()].filter((a) => canSeeAsset(a, conn))");
    expect(room).toContain("sceneFor(scene, c, this.activeSceneId)");
    expect(room).toContain("const scene = live ? playerScene(live) : null;");
    expect(room).toContain("this.broadcastScene(scene, conn.connId, seq)");
    // Every scene.upsert to more than the sender goes through broadcastScene, and every asset
    // broadcast through canSeeAsset.
    expect(room.match(/this\.broadcast\(\s*\{ t: "scene\.upsert"/g)).toBeNull();
    expect(room.match(/this\.broadcast\(\{ t: "asset\.(upsert|delete)"[^\n]*\n/g)?.every((l) => l.includes("canSeeAsset(asset, c)"))).toBe(true);
    // The live scene goes to players only as playerScene gives it.
    const active = room.slice(room.indexOf("private broadcastActive"), room.indexOf("private broadcastScene"));
    expect(active).not.toMatch(/this\.scenes\.get\(this\.activeSceneId\) \?\? null/);
  });
});

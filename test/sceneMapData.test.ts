import { describe, expect, it } from "vitest";
import { RoomClient } from "../src/client/room/client";
import type { ClientAction } from "../src/shared/protocol";
import { DEFAULT_GRID, sanitizeMapData, sanitizeMapRect, sanitizeScene } from "../src/shared/sanitize";
import type { Scene, SceneMapData } from "../src/shared/types";
import { MAX_UPLOAD_BYTES, kindAllowed, uploadKind, uploadType } from "../src/worker/uploads";

const MD: SceneMapData = { assetId: "side1", forAssetId: "map1" };

function scene(extra: Partial<Scene> = {}): Scene {
  return {
    id: "scene1",
    name: "Waterfall",
    order: 0,
    mapAssetId: "map1",
    width: 3600,
    height: 2520,
    background: "#000000",
    grid: { ...DEFAULT_GRID },
    fogCover: false,
    createdAt: 5,
    ...extra,
  };
}

describe("sanitizeMapData", () => {
  it("keeps a valid one, with every option", () => {
    expect(sanitizeMapData(MD)).toEqual(MD);
    const full = { ...MD, bare: "dead", drawn: "green", hold: true, packs: "guess" };
    expect(sanitizeMapData(full)).toEqual(full);
    expect(sanitizeMapData({ ...MD, bare: "leaf", drawn: "winter" })).toEqual({ ...MD, bare: "leaf", drawn: "winter" });
  });

  it("gives null for null, and undefined for anything malformed", () => {
    expect(sanitizeMapData(null)).toBeNull();
    for (const bad of [undefined, 0, "side1", [], [MD], {}, { assetId: "side1" }, { forAssetId: "map1" }]) {
      expect(sanitizeMapData(bad)).toBeUndefined();
    }
  });

  it("refuses ids that aren't ids", () => {
    for (const id of ["", "__proto__", "a b", "x".repeat(65), "../map", 7, null]) {
      expect(sanitizeMapData({ ...MD, assetId: id })).toBeUndefined();
      expect(sanitizeMapData({ ...MD, forAssetId: id })).toBeUndefined();
    }
  });

  it("refuses options that aren't one of their words", () => {
    expect(sanitizeMapData({ ...MD, bare: "alive" })).toBeUndefined();
    expect(sanitizeMapData({ ...MD, bare: null })).toBeUndefined();
    expect(sanitizeMapData({ ...MD, drawn: "autumn" })).toBeUndefined();
    expect(sanitizeMapData({ ...MD, hold: false })).toBeUndefined();
    expect(sanitizeMapData({ ...MD, hold: 1 })).toBeUndefined();
    expect(sanitizeMapData({ ...MD, packs: "drawn" })).toBeUndefined();
    expect(sanitizeMapData({ ...MD, packs: true })).toBeUndefined();
  });

  it("strips extra keys", () => {
    const out = sanitizeMapData({ ...MD, file: "kdir.dungeondraft_map", level: "Ground", __proto__: { x: 1 } });
    expect(out).toEqual(MD);
    expect(Object.keys(out!)).toEqual(["assetId", "forAssetId"]);
  });
});

describe("sanitizeMapRect", () => {
  it("keeps four finite numbers within 10,000 squares with a size", () => {
    expect(sanitizeMapRect([0, 0, 50, 35])).toEqual([0, 0, 50, 35]);
    expect(sanitizeMapRect([-2.5, 1, 0.5, 0.25])).toEqual([-2.5, 1, 0.5, 0.25]);
    expect(sanitizeMapRect([-10_000, 10_000, 10_000, 10_000])).toEqual([-10_000, 10_000, 10_000, 10_000]);
    expect(sanitizeMapRect(null)).toBeNull();
  });

  it("refuses anything else", () => {
    for (const bad of [
      undefined,
      {},
      "0,0,50,35",
      [0, 0, 50],
      [0, 0, 50, 35, 1],
      [0, 0, 0, 35],
      [0, 0, 50, -1],
      [0, 0, 10_001, 35],
      [-10_001, 0, 50, 35],
      [NaN, 0, 50, 35],
      [0, Infinity, 50, 35],
      ["0", 0, 50, 35],
    ]) {
      expect(sanitizeMapRect(bad)).toBeUndefined();
    }
  });
});

describe("sanitizeScene with Dungeondraft data", () => {
  const withData = scene({ mapData: { ...MD, hold: true }, mapRect: [2, 1, 48, 27] });

  it("serialises a scene without the new fields exactly as before", () => {
    const plain = scene();
    expect(JSON.stringify(sanitizeScene(plain))).toBe(JSON.stringify(plain));
    expect(Object.keys(sanitizeScene({ id: "s2", width: 100, height: 100 })!)).not.toContain("mapData");
    expect(Object.keys(sanitizeScene({ id: "s2", width: 100, height: 100 })!)).not.toContain("mapRect");
  });

  it("stores them in order after the season", () => {
    const sc = scene({ season: { look: "summer", level: 2, seed: 9 }, mapData: MD, mapRect: [0, 0, 50, 35] });
    const out = sanitizeScene(sc)!;
    expect(out).toEqual(sc);
    expect(Object.keys(out).slice(-3)).toEqual(["season", "mapData", "mapRect"]);
  });

  it("keeps them when a patch leaves them out", () => {
    const out = sanitizeScene({ id: "scene1", name: "Waterfall (winter)" }, withData)!;
    expect(out.mapData).toEqual(withData.mapData);
    expect(out.mapRect).toEqual(withData.mapRect);
    expect(out.name).toBe("Waterfall (winter)");
  });

  it("removes them with null", () => {
    const out = sanitizeScene({ id: "scene1", mapData: null, mapRect: null }, withData)!;
    expect("mapData" in out).toBe(false);
    expect("mapRect" in out).toBe(false);
    expect(sanitizeScene({ id: "scene1", mapRect: null }, withData)!.mapData).toEqual(withData.mapData);
  });

  it("keeps them when a patch's are malformed", () => {
    const out = sanitizeScene({ id: "scene1", mapData: { assetId: "../x", forAssetId: "map1" }, mapRect: [0, 0, 0, 1] }, withData)!;
    expect(out.mapData).toEqual(withData.mapData);
    expect(out.mapRect).toEqual(withData.mapRect);
  });

  it("replaces them, dropping what the new one leaves out", () => {
    const out = sanitizeScene({ id: "scene1", mapData: { ...MD, forAssetId: "map2", extra: 1 }, mapRect: [0, 0, 32, 18] }, withData)!;
    expect(out.mapData).toEqual({ ...MD, forAssetId: "map2" });
    expect(out.mapRect).toEqual([0, 0, 32, 18]);
  });

  it("drops the rectangle when the picture changes or goes, even from a tab that doesn't say so (2.8, 3.7)", () => {
    for (const mapAssetId of ["map2", null]) {
      const out = sanitizeScene({ id: "scene1", mapAssetId }, withData)!;
      expect(out.mapAssetId).toBe(mapAssetId);
      expect("mapRect" in out).toBe(false);
      // The data stays, paused until it's used with the new picture.
      expect(out.mapData).toEqual(withData.mapData);
      // A malformed rectangle with the new picture is no better.
      expect("mapRect" in sanitizeScene({ id: "scene1", mapAssetId, mapRect: [0, 0, 0, 1] }, withData)!).toBe(false);
    }
    // One sent with the new picture is kept.
    expect(sanitizeScene({ id: "scene1", mapAssetId: "map2", mapRect: [0, 0, 32, 18] }, withData)!.mapRect).toEqual([0, 0, 32, 18]);
    // The same picture again (undoing Cover all records it), or a malformed id, isn't a change.
    expect(sanitizeScene({ id: "scene1", mapAssetId: "map1", width: 3600 }, withData)!.mapRect).toEqual(withData.mapRect);
    expect(sanitizeScene({ id: "scene1", mapAssetId: "../x" }, withData)!.mapRect).toEqual(withData.mapRect);
    // A new scene keeps the one it comes with (a restored backup).
    expect(sanitizeScene(scene({ mapAssetId: "map2", mapRect: [0, 0, 50, 35] }))!.mapRect).toEqual([0, 0, 50, 35]);
  });
});

describe("the client's copy of a scene", () => {
  function client(sc: Scene) {
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    room.store.set({
      me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
      scenes: { [sc.id]: sc },
      viewSceneId: sc.id,
      activeSceneId: sc.id,
    });
    return room;
  }
  const sent = (room: RoomClient) => (room as unknown as { unacked: { action: ClientAction }[] }).unacked.map((u) => u.action);

  it("keeps the data when a change leaves it out, and removes it with null", () => {
    const room = client(scene({ mapData: MD, mapRect: [0, 0, 50, 35] }));
    room.updateScene("scene1", { name: "Falls" });
    expect(room.state.scenes.scene1).toMatchObject({ name: "Falls", mapData: MD, mapRect: [0, 0, 50, 35] });
    room.updateScene("scene1", { mapData: null, mapRect: null });
    expect("mapData" in room.state.scenes.scene1).toBe(false);
    expect("mapRect" in room.state.scenes.scene1).toBe(false);
  });

  it("setMapData attaches and removes in one undoable step each, and tells the server", () => {
    const room = client(scene());
    room.setMapData("scene1", MD, { mapRect: [0, 0, 50, 35] });
    expect(room.state.scenes.scene1).toMatchObject({ mapData: MD, mapRect: [0, 0, 50, 35] });
    const last = sent(room).at(-1);
    expect(last?.t === "items" && last.scene).toEqual({ id: "scene1", mapData: MD, mapRect: [0, 0, 50, 35] });
    room.setMapData("scene1", null);
    expect(room.state.scenes.scene1.mapData).toBeUndefined();
    expect(room.state.scenes.scene1.mapRect).toEqual([0, 0, 50, 35]);
    room.undo();
    expect(room.state.scenes.scene1.mapData).toEqual(MD);
    room.undo();
    expect("mapData" in room.state.scenes.scene1).toBe(false);
    expect("mapRect" in room.state.scenes.scene1).toBe(false);
    // Undo removes it on the server with null, which the server reads the same way.
    const undo = sent(room).at(-1);
    expect(undo?.t === "items" && undo.scene).toEqual({ id: "scene1", mapData: null, mapRect: null });
    expect(sanitizeScene(undo?.t === "items" ? undo.scene : null, scene({ mapData: MD }))!.mapData).toBeUndefined();
    room.redo();
    expect(room.state.scenes.scene1).toMatchObject({ mapData: MD, mapRect: [0, 0, 50, 35] });
  });

  it("choosing the scene's picture: the same one again keeps the .dd2vtt's rectangle; another drops it in the same undoable step, here and on the server", async () => {
    const withRect = scene({ mapData: MD, mapRect: [10, 5, 30, 20] });
    const room = client(withRect);
    // What SceneEditor.setMap sends: the picture, its size and the grid, and nothing about mapRect.
    room.changeScene("scene1", { mapAssetId: "map1", width: 3600, height: 2520, grid: { ...DEFAULT_GRID } }, {});
    expect(room.state.scenes.scene1.mapRect).toEqual([10, 5, 30, 20]);
    let last = sent(room).at(-1);
    expect(last?.t === "items" && last.scene && "mapRect" in last.scene).toBe(false);
    expect(sanitizeScene(last?.t === "items" ? last.scene : null, withRect)!.mapRect).toEqual([10, 5, 30, 20]);
    // Another picture: the rectangle goes with it, the data stays (paused), and undo brings both back.
    room.changeScene("scene1", { mapAssetId: "map2", width: 3456, height: 1944, grid: { ...DEFAULT_GRID } }, {});
    expect("mapRect" in room.state.scenes.scene1).toBe(false);
    expect(room.state.scenes.scene1.mapData).toEqual(MD);
    last = sent(room).at(-1);
    expect(last?.t === "items" && last.scene && last.scene.mapRect).toBeNull();
    room.undo();
    expect(room.state.scenes.scene1).toMatchObject({ mapAssetId: "map1", mapRect: [10, 5, 30, 20] });
    // setMap leaves mapRect to changeScene's rule (its picture's patch has no mapRect).
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const panel = fs.readFileSync(new URL("../src/client/ui/ScenesPanel.tsx", import.meta.url), "utf8");
    const setMap = panel.slice(panel.indexOf("const setMap = (asset: Asset) =>"), panel.indexOf("if (sameSize) {", panel.indexOf("const setMap = (asset: Asset) =>")));
    expect(setMap).toContain("mapAssetId: asset.id,");
    expect(setMap).not.toMatch(/^\s*mapRect:/m);
  });

  it("a setting given as undefined is left alone, here and on the server, never cleared", () => {
    const room = client(scene({ mapRect: [0, 0, 48, 27] }));
    // How an attach with a plain picture (no .dd2vtt, so no rectangle) naturally reads.
    const vtt: [number, number, number, number] | undefined = undefined;
    room.setMapData("scene1", MD, { mapRect: vtt });
    expect(room.state.scenes.scene1).toMatchObject({ mapData: MD, mapRect: [0, 0, 48, 27] });
    const last = sent(room).at(-1);
    expect(last?.t === "items" && last.scene).toEqual({ id: "scene1", mapData: MD });
    room.undo();
    expect(room.state.scenes.scene1.mapRect).toEqual([0, 0, 48, 27]);
    expect("mapData" in room.state.scenes.scene1).toBe(false);
    const undo = sent(room).at(-1);
    expect(undo?.t === "items" && undo.scene).toEqual({ id: "scene1", mapData: null });

    // The same through changeScene and updateScene, for any setting.
    room.changeScene("scene1", { season: undefined, mapRect: undefined, name: "Falls" }, {});
    expect(room.state.scenes.scene1).toMatchObject({ name: "Falls", mapRect: [0, 0, 48, 27] });
    room.updateScene("scene1", { mapRect: undefined, mapData: undefined });
    expect(room.state.scenes.scene1.mapRect).toEqual([0, 0, 48, 27]);
    expect("mapData" in room.state.scenes.scene1).toBe(false);
  });

  it("a new picture drops the rectangle at once, as the server does, and undo puts it back", () => {
    const room = client(scene({ mapData: MD, mapRect: [0, 0, 50, 35] }));
    // ScenesPanel's Remove, and any change that doesn't clear it itself.
    room.updateScene("scene1", { mapAssetId: null });
    expect(room.state.scenes.scene1.mapAssetId).toBeNull();
    expect("mapRect" in room.state.scenes.scene1).toBe(false);
    expect(room.state.scenes.scene1.mapData).toEqual(MD);

    const room2 = client(scene({ mapData: MD, mapRect: [0, 0, 50, 35] }));
    room2.changeScene("scene1", { mapAssetId: "map2", width: 1000, height: 1000 }, {});
    expect("mapRect" in room2.state.scenes.scene1).toBe(false);
    const step = sent(room2).at(-1);
    expect(step?.t === "items" && step.scene).toMatchObject({ mapAssetId: "map2", mapRect: null });
    room2.undo();
    expect(room2.state.scenes.scene1).toMatchObject({ mapAssetId: "map1", width: 3600, mapRect: [0, 0, 50, 35] });
    // The server reads the undo the same way: the old picture with its rectangle.
    const undo = sent(room2).at(-1);
    const onServer = sanitizeScene(undo?.t === "items" ? undo.scene : null, scene({ mapAssetId: "map2", mapData: MD }))!;
    expect(onServer).toMatchObject({ mapAssetId: "map1", mapRect: [0, 0, 50, 35] });
    room2.redo();
    expect("mapRect" in room2.state.scenes.scene1).toBe(false);

    // A scene without one sends nothing extra.
    const room3 = client(scene());
    room3.changeScene("scene1", { mapAssetId: "map2" }, {});
    const plain = sent(room3).at(-1);
    expect(plain?.t === "items" && plain.scene).toEqual({ id: "scene1", mapAssetId: "map2" });
  });
});

describe("uploads of Dungeondraft data", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");

  it("knows the kind", () => {
    expect(uploadKind("mapdata")).toBe("mapdata");
    expect(uploadKind("map")).toBe("map");
    expect(uploadKind("token")).toBe("token");
    expect(uploadKind("sidecar")).toBeNull();
    expect(uploadKind(null)).toBeNull();
  });

  it("is the GM's only: a player gets 403 even where players may add tokens", () => {
    expect(kindAllowed("gm", "mapdata", false)).toBe(true);
    expect(kindAllowed("player", "mapdata", true)).toBe(false);
    expect(kindAllowed("player", "map", true)).toBe(false);
    expect(kindAllowed("player", "token", true)).toBe(true);
    expect(kindAllowed("player", "token", false)).toBe(false);
  });

  it("is a PNG only: anything else gets 415", () => {
    expect(uploadType("mapdata", PNG)).toEqual({ mime: "image/png" });
    for (const head of [JPEG, WEBP, HTML, new Uint8Array(0)]) expect("refusal" in uploadType("mapdata", head)).toBe(true);
    // Pictures still take every image type.
    expect(uploadType("map", JPEG)).toEqual({ mime: "image/jpeg" });
    expect(uploadType("token", WEBP)).toEqual({ mime: "image/webp" });
    expect("refusal" in uploadType("map", HTML)).toBe(true);
  });

  it("has room for the largest sidecar in its PNG box", () => {
    // 8 MiB of payload, a filter byte for every 1,536, and stored deflate blocks.
    const payload = 8 * 1024 * 1024 + 16;
    const raw = payload + Math.ceil(payload / 1536);
    expect(raw + Math.ceil(raw / 65535) * 5 + 1024).toBeLessThan(MAX_UPLOAD_BYTES.mapdata);
    expect(MAX_UPLOAD_BYTES.mapdata).toBeLessThan(MAX_UPLOAD_BYTES.map);
  });
});

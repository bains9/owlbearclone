import { describe, expect, it } from "vitest";
import { RoomClient } from "../src/client/room/client";
import { DEFAULT_GRID } from "../src/shared/sanitize";
import type { FogItem, Scene } from "../src/shared/types";

function client() {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  const scene: Scene = {
    id: "scene1",
    name: "Crypt",
    order: 0,
    mapAssetId: "map1",
    width: 1000,
    height: 1000,
    background: "#000000",
    grid: { ...DEFAULT_GRID },
    fogCover: false,
    createdAt: 0,
  };
  const secret: FogItem = {
    id: "fog1",
    sceneId: "scene1",
    kind: "fog",
    z: 0,
    owner: "@gm",
    mode: "hide",
    shape: "rect",
    points: [0, 0, 100, 100],
  };
  room.store.set({
    me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
    scenes: { scene1: scene },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
    items: { fog1: secret },
  });
  return room;
}

describe("undoing fog steps", () => {
  it("puts the map back with the cover when the map was swapped since", () => {
    const room = client();
    room.resetFog("scene1", true);
    expect(room.state.scenes.scene1.fogCover).toBe(true);
    expect(room.state.items.fog1).toBeUndefined();

    // Another map of the same size, which keeps the fog.
    room.changeScene("scene1", { mapAssetId: "map2" }, {});
    expect(room.state.scenes.scene1.mapAssetId).toBe("map2");

    // Undo the map swap, then Cover all: never the new map uncovered.
    room.undo();
    expect(room.state.scenes.scene1).toMatchObject({ mapAssetId: "map1", fogCover: true });
    room.undo();
    expect(room.state.scenes.scene1).toMatchObject({ mapAssetId: "map1", fogCover: false });
    expect(room.state.items.fog1).toBeDefined();
  });

  it("restores the map it was done on even if another tab changed it", () => {
    const room = client();
    room.resetFog("scene1", true);
    // Someone else's map change arrives from the server.
    const s = room.state.scenes.scene1;
    room.store.set({ scenes: { scene1: { ...s, mapAssetId: "map3", width: 2000 } } });
    room.undo();
    expect(room.state.scenes.scene1).toMatchObject({ mapAssetId: "map1", width: 1000, fogCover: false });
  });

  it("leaves a later grid alignment alone", () => {
    const room = client();
    room.resetFog("scene1", true);
    room.updateScene("scene1", { grid: { ...DEFAULT_GRID, size: 123 } });
    room.undo();
    expect(room.state.scenes.scene1.grid.size).toBe(123);
    expect(room.state.scenes.scene1.fogCover).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { RoomClient } from "../src/client/room/client";
import { DEFAULT_GRID, sanitizeScene, sanitizeSeason } from "../src/shared/sanitize";
import type { Scene } from "../src/shared/types";

describe("sanitizeSeason", () => {
  it("keeps a good season and drops unknown keys", () => {
    expect(sanitizeSeason({ look: "winter", level: 3, seed: 42, extra: "x" })).toEqual({ look: "winter", level: 3, seed: 42 });
    expect(sanitizeSeason({ look: "autumn", level: 1 })).toEqual({ look: "autumn", level: 1 });
  });

  it("turns off with null, and ignores anything malformed", () => {
    expect(sanitizeSeason(null)).toBeNull();
    for (const bad of [undefined, "winter", [], {}, { look: "monsoon", level: 2 }, { look: "winter", level: 4 }, { look: "winter", level: "2" }]) {
      expect(sanitizeSeason(bad)).toBeUndefined();
    }
  });

  it("drops a seed out of range but keeps the season", () => {
    for (const seed of [-1, 65536, 1.5, "7", Number.NaN]) {
      expect(sanitizeSeason({ look: "spring", level: 2, seed })).toEqual({ look: "spring", level: 2 });
    }
    expect(sanitizeSeason({ look: "spring", level: 2, seed: 65535 })).toEqual({ look: "spring", level: 2, seed: 65535 });
  });
});

describe("a scene's season on the server", () => {
  const base = sanitizeScene({ id: "s1", name: "Glade", width: 700, height: 700, season: { look: "winter", level: 2, seed: 5 } })!;

  it("is kept on a new scene, and when an edit leaves it out", () => {
    expect(base.season).toEqual({ look: "winter", level: 2, seed: 5 });
    expect(sanitizeScene({ id: "s1", name: "Renamed" }, base)!.season).toEqual({ look: "winter", level: 2, seed: 5 });
  });

  it("changes, turns off with null, and survives a malformed one", () => {
    expect(sanitizeScene({ id: "s1", season: { look: "autumn", level: 3 } }, base)!.season).toEqual({ look: "autumn", level: 3 });
    const off = sanitizeScene({ id: "s1", season: null }, base)!;
    expect("season" in off).toBe(false);
    expect(sanitizeScene({ id: "s1", season: { look: "monsoon" } }, base)!.season).toEqual(base.season);
  });
});

function client() {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  const scene: Scene = {
    id: "scene1",
    name: "Forest",
    order: 0,
    mapAssetId: "map1",
    width: 1000,
    height: 1000,
    background: "#000000",
    grid: { ...DEFAULT_GRID },
    fogCover: false,
    createdAt: 0,
  };
  room.store.set({
    me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
    scenes: { scene1: scene },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
  });
  return room;
}

describe("undoing a season", () => {
  it("turns it back off, and redo puts it back", () => {
    const room = client();
    room.changeScene("scene1", { season: { look: "winter", level: 3, seed: 9 } }, {});
    expect(room.state.scenes.scene1.season).toEqual({ look: "winter", level: 3, seed: 9 });
    room.undo();
    // Gone, not null: the scene simply has no season.
    expect("season" in room.state.scenes.scene1).toBe(false);
    room.redo();
    expect(room.state.scenes.scene1.season).toEqual({ look: "winter", level: 3, seed: 9 });
  });

  it("steps back through looks and levels", () => {
    const room = client();
    room.changeScene("scene1", { season: { look: "autumn", level: 2, seed: 1 } }, {});
    room.changeScene("scene1", { season: { look: "autumn", level: 3, seed: 1 } }, {});
    room.changeScene("scene1", { season: null }, {});
    expect("season" in room.state.scenes.scene1).toBe(false);
    room.undo();
    expect(room.state.scenes.scene1.season).toEqual({ look: "autumn", level: 3, seed: 1 });
    room.undo();
    expect(room.state.scenes.scene1.season).toEqual({ look: "autumn", level: 2, seed: 1 });
    room.undo();
    expect("season" in room.state.scenes.scene1).toBe(false);
  });

  it("leaves the rest of the scene alone", () => {
    const room = client();
    room.changeScene("scene1", { season: { look: "spring", level: 1 } }, {});
    room.updateScene("scene1", { name: "Spring glade" });
    room.undo();
    expect(room.state.scenes.scene1.name).toBe("Spring glade");
    expect(room.state.scenes.scene1.season).toBeUndefined();
  });
});

describe("seasons on this device", () => {
  it("can be turned off and on", () => {
    const room = client();
    expect(room.state.seasonsOff).toBe(false);
    room.setSeasonsOff(true);
    expect(room.state.seasonsOff).toBe(true);
    room.setSeasonsOff(false);
    expect(room.state.seasonsOff).toBe(false);
  });
});

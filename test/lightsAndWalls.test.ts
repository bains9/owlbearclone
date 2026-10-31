// Lighting extras (31 October 2026): a light's colour and flicker (from its map file, or the GM's,
// set by clicking its marker), and walls and shut doors that stop players' tokens with lighting on.
import { describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { visionFromSight } from "../src/client/importScenes";
import { lightColor, parseUniversalVtt } from "../src/client/mapImport";
import { nudgeSelection } from "../src/client/room/actions";
import { RoomClient } from "../src/client/room/client";
import { WallIndex, blockers, doorSpots, flickerAt, lightNear, moveStop, segmentsOf, toggledDoor } from "../src/client/room/vision";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeVision } from "../src/shared/sanitize";
import type { Player, Scene, SceneVision, TokenItem } from "../src/shared/types";

const { readFile } = (await import("node:" + "fs/promises")) as { readFile(p: URL, e: string): Promise<string> };

const AREA = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
const VISION: SceneVision = { on: true, daylight: false, partyLight: 0, sightRange: 0, walls: [], doors: [], lights: [] };

describe("a light's colour and flicker", () => {
  it("are kept with the scene, a colour as #rrggbb and nothing else", () => {
    const v = sanitizeVision({ ...VISION, lights: [{ x: 1, y: 2, r: 3, color: "#FFA050", flicker: true }, { x: 4, y: 5, r: 6, color: "orange", flicker: "yes" }] })!;
    expect(v.lights).toEqual([{ x: 1, y: 2, r: 3, color: "#ffa050", flicker: true }, { x: 4, y: 5, r: 6 }]);
  });

  it("come from a map file's colour (alpha first), but not a clear or white one, nor when its lighting is in the picture", () => {
    expect(lightColor("ffffc27a")).toBe("#ffc27a");
    expect(lightColor("FF9FD3FF")).toBe("#9fd3ff");
    expect(lightColor("ffffffff")).toBeUndefined();
    expect(lightColor("fff4f8ff")).toBeUndefined();
    expect(lightColor("00ff0000")).toBeUndefined();
    expect(lightColor("red")).toBeUndefined();
    const file = (baked: boolean) =>
      JSON.stringify({
        format: 0.3,
        resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 10 }, pixels_per_grid: 50 },
        line_of_sight: [[{ x: 0, y: 0 }, { x: 5, y: 0 }]],
        portals: [],
        environment: { baked_lighting: baked, ambient_light: "ff101010" },
        lights: [{ position: { x: 2, y: 3 }, range: 4, intensity: 1, color: "ffff5a1f", shadows: true }],
        image: "",
      });
    expect(parseUniversalVtt(file(false), "Cave.dd2vtt").sight!.lights).toEqual([{ x: 2, y: 3, r: 4, color: "#ff5a1f" }]);
    expect(parseUniversalVtt(file(true), "Cave.dd2vtt").sight!.lights).toEqual([{ x: 2, y: 3, r: 4 }]);
  });

  it("the GM gave a light are kept when its map is brought in again, as is letting tokens through walls", () => {
    const sight = { walls: [], doors: [], lights: [{ x: 3, y: 3, r: 5, color: "#ffa050" }, { x: 6, y: 6, r: 5 }], daylight: false };
    const fresh = visionFromSight(sight, 50);
    expect(fresh.lights).toEqual([{ x: 150, y: 150, r: 250, color: "#ffa050" }, { x: 300, y: 300, r: 250 }]);
    const mine: SceneVision = { ...fresh, passWalls: true, lights: [{ ...fresh.lights[0], color: "#9fd3ff" }, { ...fresh.lights[1], flicker: true }] };
    const again = visionFromSight(sight, 50, mine);
    expect(again.lights).toEqual([{ x: 150, y: 150, r: 250, color: "#9fd3ff" }, { x: 300, y: 300, r: 250, flicker: true }]);
    expect(again.passWalls).toBe(true);
  });

  it("is found by a click near its marker", () => {
    const lights = [{ x: 100, y: 100, r: 50 }, { x: 130, y: 100, r: 50 }];
    expect(lightNear(lights, 125, 102, 20)).toBe(1);
    expect(lightNear(lights, 104, 100, 20)).toBe(0);
    expect(lightNear(lights, 300, 300, 20)).toBe(-1);
  });

  it("flickers between 0.7 and 1, and not in step from one light to the next", () => {
    const at = Array.from({ length: 400 }, (_, i) => flickerAt(i * 37, 0));
    expect(Math.min(...at)).toBeGreaterThanOrEqual(0.7);
    expect(Math.max(...at)).toBeLessThanOrEqual(1);
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan(0.15);
    expect(flickerAt(1000, 0)).not.toBeCloseTo(flickerAt(1000, 1), 3);
  });
});

describe("walls that stop tokens", () => {
  // A wall across the middle with a door in it, from x 450 to 550.
  const walls = segmentsOf([[0, 500, 450, 500], [550, 500, 1000, 500]]);
  const v: SceneVision = { ...VISION, doors: [{ line: [450, 500, 550, 500], open: false }] };
  const indexOf = (vision: SceneVision) => new WallIndex(blockers(walls, doorSpots(vision, [])), AREA, 100);

  it("stop a token just short of a wall, or a shut door, in its way", () => {
    const index = indexOf(v);
    const [x, y] = moveStop(index, 200, 300, 200, 700, 5);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(495);
    // Through the shut door, likewise.
    expect(moveStop(index, 500, 300, 500, 700, 5)[1]).toBeCloseTo(495);
    // Nothing in the way: all the way.
    expect(moveStop(index, 200, 300, 400, 450, 5)).toEqual([400, 450]);
  });

  it("let it through a door once it's open", () => {
    const open = indexOf(toggledDoor(v, doorSpots(v, [])[0]));
    expect(moveStop(open, 500, 300, 500, 700, 5)).toEqual([500, 700]);
  });

  it("stop the arrow keys stepping a token through one", () => {
    const room = new RoomClient("AbCdEf123456", { uid: GM_OWNER, name: "GM", color: "#ff0000" });
    const scene: Scene = { id: "scene1", name: "Keep", order: 0, mapAssetId: null, width: 1000, height: 1000, background: "#000000", grid: { ...DEFAULT_GRID }, fogCover: false, createdAt: 0 };
    const token = (id: string, x: number): TokenItem => ({
      id,
      sceneId: "scene1",
      kind: "token",
      z: 1,
      owner: GM_OWNER,
      x,
      y: 475,
      size: 1,
      rotation: 0,
      assetId: null,
      color: "#d62f2f",
      label: id,
      hidden: false,
      locked: false,
      rings: [],
    });
    const me: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" };
    room.store.set({ me, room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } }, scenes: { scene1: scene }, viewSceneId: "scene1", activeSceneId: "scene1", items: { a: token("a", 200), b: token("b", 700) }, selection: ["a", "b"] });
    const change = vi.spyOn(room, "change").mockImplementation(() => {});
    // A wall below "a", none below "b".
    nudgeSelection(room, 0, 1, (from, to) => from.x < 500 && to.y > 500);
    expect(change).toHaveBeenCalledWith({ patch: [{ id: "b", set: { x: 700, y: 475 + DEFAULT_GRID.size } }] });
    change.mockClear();
    nudgeSelection(room, 0, 1);
    expect(change.mock.calls[0][0].patch).toHaveLength(2);
  });

  it("are the board's: a player's token stops as it's dragged and where it's let go, the GM's never", async () => {
    const board = await readFile(new URL("../src/client/room/board.ts", import.meta.url), "utf8");
    expect(board).toContain("if (this.isGm || !v?.on || v.passWalls) return null;");
    expect(board).toContain("const [x, y] = moveStop(walls, from.x, from.y, p.x, p.y, scene.grid.size * WALL_GAP);");
    expect(board).toContain("if (walls) p = this.stoppedAt(walls, g.at.get(id) ?? o, p, item.size, scene, snap);");
    expect(board).toContain("nudgeSelection(room, 0, 1, this.stepBlocked);");
    // Fog and darkness stop sight, not tokens.
    expect(board).toContain("const moveIndex = new WallIndex(blockers(fixed, doors), area, size * 2);");
    // The lights' glow, under the tokens; a flickering one keeps the layer drawing.
    expect(board).toContain("this.drawLightGlows(native(ctx));");
    expect(board).toContain("const flicker = !!v?.on && !v.daylight && v.lights.some((l) => l.flicker);");
  });
});

describe("in the guide and Edit scene", () => {
  it("leads What's new, and says how to colour a light, make it flicker, and let tokens through", async () => {
    expect(GUIDE[0].parts[0].title).toBe("Coloured and flickering lights, and walls that stop tokens (31 October 2026)");
    const lighting = JSON.stringify(GUIDE.find((s) => s.id === "lighting"));
    for (const words of ["Lights (GM)", "**Flickers**", "**Plain**", "Walls stop tokens", "**Walls and shut doors stop players' tokens**"]) expect(lighting).toContain(words);
    const settings = await readFile(new URL("../src/client/ui/LightingSettings.tsx", import.meta.url), "utf8");
    expect(settings).toContain("<span>Walls and shut doors stop players' tokens</span>");
    const bar = await readFile(new URL("../src/client/ui/LightBar.tsx", import.meta.url), "utf8");
    for (const words of ["<span>Flickers</span>", "Plain", '<span class="selbar-label">Light</span>']) expect(bar).toContain(words);
  });
});

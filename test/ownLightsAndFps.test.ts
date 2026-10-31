// Lights the GM places (Add a light, drag to move, Reach and Remove), kept when the map is brought
// in again; and the frame-rate readout (?fps) for seeing how a device runs the board (31 October
// 2026, from Par's "do all").
import { describe, expect, it } from "vitest";
import { GUIDE } from "../src/client/guide";
import { visionFromSight } from "../src/client/importScenes";
import { fpsWanted } from "../src/client/fps";
import { sanitizeVision } from "../src/shared/sanitize";
import type { SceneVision } from "../src/shared/types";

const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const VISION: SceneVision = { on: true, daylight: false, partyLight: 0, sightRange: 0, walls: [], doors: [], lights: [] };

describe("lights the GM places", () => {
  it("are kept with the scene as the GM's own, and still there when the map is brought in again", () => {
    expect(sanitizeVision({ ...VISION, lights: [{ x: 1, y: 2, r: 300, own: true }, { x: 3, y: 4, r: 300, own: "yes" }] })!.lights).toEqual([
      { x: 1, y: 2, r: 300, own: true },
      { x: 3, y: 4, r: 300 },
    ]);
    const sight = { walls: [], doors: [], lights: [{ x: 3, y: 3, r: 5 }], daylight: false };
    const mine: SceneVision = { ...visionFromSight(sight, 50), lights: [{ x: 150, y: 150, r: 250 }, { x: 900, y: 40, r: 420, own: true, color: "#ff9a3c" }] };
    // The map's light moved in the new picture; the GM's own stays where the GM put it.
    const again = visionFromSight({ ...sight, lights: [{ x: 4, y: 3, r: 5 }] }, 50, mine);
    expect(again.lights).toEqual([{ x: 200, y: 150, r: 250 }, { x: 900, y: 40, r: 420, own: true, color: "#ff9a3c" }]);
  });

  it("go where the map's clicked after Add a light, move with their marker, and have Reach and Remove", () => {
    const board = read("src/client/room/board.ts");
    expect(board).toContain("if (s.lightAdd && this.isGm && scene && s.lightAdd.sceneId === scene.id) {");
    expect(board).toContain("const light: SceneLight = { x: round2(world.x), y: round2(world.y), r: scene.grid.size * OWN_LIGHT_SQUARES, own: true };");
    expect(board).toContain('this.gesture = { kind: "light-drag", pointerId, index: i, start: pos, moved: false };');
    expect(board).toContain("const lights = v.lights.map((l, i) => (i === g.index ? { ...l, x: round2(world.x), y: round2(world.y) } : l));");
    expect(board).toContain('else if (room.state.lightAdd && this.gesture.kind === "none") room.store.set({ lightAdd: null });');
    const bar = read("src/client/ui/LightBar.tsx");
    for (const words of ["<span>Reach</span>", 'aria-label="Remove this light"']) expect(bar).toContain(words);
    expect(read("src/client/ui/LightingSettings.tsx")).toContain("room.store.set({ lightAdd: { sceneId: s.id }, lightPick: null });");
    expect(read("src/client/ui/RoomPage.tsx")).toContain("<span>Click the map where the light goes.</span>");
  });
});

describe("the frame-rate readout", () => {
  it("is on with ?fps in the link, off with ?fps=0", () => {
    expect(fpsWanted("?fps")).toBe(true);
    expect(fpsWanted("?fps=1")).toBe(true);
    expect(fpsWanted("?fps=0")).toBe(false);
    expect(fpsWanted("")).toBe(false);
  });

  it("times every layer's drawing on the board, and sits top right", () => {
    const board = read("src/client/room/board.ts");
    expect(board).toContain('layer.on("beforeDraw", () => {');
    expect(board).toContain("drawStats(): { ms: number; draws: number } {");
    const page = read("src/client/ui/RoomPage.tsx");
    expect(page.indexOf("<FpsMeter />")).toBeGreaterThan(page.indexOf("<TopRight>"));
    expect(page.indexOf("<FpsMeter />")).toBeLessThan(page.indexOf("</TopRight>"));
  });
});

describe("in the guide", () => {
  it("leads What's new, and the lights, card and party parts say how", () => {
    expect(GUIDE[0].parts[1].title).toBe("A new day for the party, ki on a Samurai's card, and lights you place yourself (31 October 2026)");
    const all = JSON.stringify(GUIDE);
    for (const words of ["**Add a light**", "Drag a marker to move its light.", "**Ki:**", "**New day for the party**", "?fps"]) expect(all).toContain(words);
  });
});

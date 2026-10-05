import { describe, expect, it } from "vitest";
import {
  BURST_MS,
  DUPLICATE_OFFSETS,
  WheelSteps,
  backLabel,
  buildHints,
  canFold,
  formatDeg,
  formatSize,
  pressX,
  selectionStatus,
  wheelIntent,
} from "../src/client/room/buildInput";
import type { WheelPref } from "../src/client/room/buildInput";
import { BuildEdit, buildUndo, refOf } from "../src/client/room/build";
import { RoomClient } from "../src/client/room/client";
import type { BuildOptions } from "../src/client/room/client";
import { placedOf } from "../src/client/room/stampGeom";
import { applyOps } from "../src/shared/ops";
import { PROTOCOL_VERSION } from "../src/shared/protocol";
import { DEFAULT_GRID } from "../src/shared/sanitize";
import type { Scene } from "../src/shared/types";

const OPTS: BuildOptions = {
  mode: "stamps",
  shape: { building: "rect", terrain: "brush" },
  floor: { building: "s", terrain: "g" },
  brush: 1,
  walls: {},
  wallMode: "add",
  doorStyle: "door",
  stamp: "table",
  stampSize: 1,
  stampDeg: 0,
  stampMode: "place",
  selectReturn: null,
};

/** A wheel event's sample: a Firefox line-mode notch, a Chrome notch, a trackpad's pixels. */
const lines = (n: number) => ({ deltaMode: 1, dx: 0, dy: n * 33 });
const pixels = (dy: number, wheelDeltaY?: number, dx = 0) => ({ deltaMode: 0, dx, dy, wheelDeltaY });

describe("the mouse wheel's steps", () => {
  it("counts Firefox's lines, Chrome's notches and Windows' one-line setting as notches", () => {
    expect(new WheelSteps(false).next(lines(3), 0)).toEqual({ kind: "notch", steps: 1 });
    expect(new WheelSteps(false).next(pixels(100, -120), 0)).toEqual({ kind: "notch", steps: 1 });
    expect(new WheelSteps(false).next(pixels(33, -120), 0)).toEqual({ kind: "notch", steps: 1 });
    expect(new WheelSteps(false).next(pixels(-100, 120), 0)).toEqual({ kind: "notch", steps: -1 });
  });

  it("keeps a trackpad stream smooth even when a flick later in it is fast", () => {
    const w = new WheelSteps(false);
    expect(w.next(pixels(4, -4), 0)).toEqual({ kind: "smooth", steps: 1 });
    expect(w.next(pixels(60, -72), 10).kind).toBe("smooth");
    expect(w.next(pixels(100, -120), 20).kind).toBe("smooth");
  });

  it("starts a new stream after a pause", () => {
    const w = new WheelSteps(false);
    expect(w.next(pixels(4), 0).kind).toBe("smooth");
    expect(w.next(pixels(100, -120), 149).kind).toBe("smooth");
    expect(w.next(pixels(100, -120), 149 + 150).kind).toBe("notch");
  });

  it("never counts two notches closer together than 16 ms", () => {
    const w = new WheelSteps(false);
    expect(w.next(lines(1), 0).steps).toBe(1);
    expect(w.next(lines(1), 10).steps).toBe(0);
    expect(w.next(lines(1), 17).steps).toBe(1);
    expect(w.next(lines(1), 20).steps).toBe(0);
    expect(w.next(lines(1), 40).steps).toBe(1);
  });

  it("steps a smooth stream once at first, then once every 40 pixels, keeping what's left over", () => {
    const w = new WheelSteps(false);
    expect(w.next(pixels(10), 0).steps).toBe(1);
    expect(w.next(pixels(30), 10).steps).toBe(0);
    expect(w.next(pixels(30), 20).steps).toBe(1);
    // 20 left over, and 20 more makes another step.
    expect(w.next(pixels(20), 30).steps).toBe(1);
    expect(w.next(pixels(95), 40).steps).toBe(2);
    expect(w.next(pixels(-10), 50).steps).toBe(0);
    expect(w.next(pixels(-40), 60).steps).toBe(0);
    expect(w.next(pixels(-10), 70).steps).toBe(-1);
  });

  it("counts every notch of several a busy page was sent as one event", () => {
    // Chrome adds up the notches that come while the page is busy: 240 is two of them.
    const w = new WheelSteps(false);
    expect(w.next(pixels(200, -240), 0)).toEqual({ kind: "notch", steps: 2 });
    expect(w.next(pixels(-300, 360), 100)).toEqual({ kind: "notch", steps: -3 });
    // Firefox's lines: a notch is as many lines as the fewest one event has held.
    const f = new WheelSteps(false);
    expect(f.next(lines(3), 0).steps).toBe(1);
    expect(f.next(lines(6), 40).steps).toBe(2);
    expect(f.next(lines(3), 80).steps).toBe(1);
  });

  it("counts notches by when they came, so ones handled back to back after a busy moment all count", () => {
    // Six notches 30 ms apart, handled late and close together: judged by their own times.
    const w = new WheelSteps(false);
    const steps = [0, 30, 60, 90, 120, 150].map((at) => w.next(pixels(100, -120), at).steps);
    expect(steps.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it("still counts a wheel spinning freely at most once each 16 ms, however its notches arrive", () => {
    const w = new WheelSteps(false);
    expect(w.next(pixels(100, -120), 0).steps).toBe(1);
    // Ten notches added up 20 ms later: one step, as ten notches 2 ms apart would be.
    expect(w.next(pixels(1000, -1200), 20).steps).toBe(1);
    // 50 ms on: three steps at most.
    expect(w.next(pixels(1000, -1200), 70).steps).toBe(3);
    // And never more than six from one event.
    expect(new WheelSteps(false).next(pixels(2000, -2400), 0).steps).toBe(6);
  });

  it("counts a Mac mouse's bigger events, and a trackpad's, as before", () => {
    // A Mac speeds a spinning wheel up: its events' sizes aren't counts of notches.
    const m = new WheelSteps(true);
    expect(m.next(pixels(40, -120), 0)).toEqual({ kind: "notch", steps: 1 });
    expect(m.next(pixels(200, -600), 40)).toEqual({ kind: "notch", steps: 1 });
    // A trackpad's stream goes by distance, even where its wheelDeltaY looks like notches.
    const t = new WheelSteps(false);
    expect(t.next(pixels(4, -4), 0).steps).toBe(1);
    expect(t.next(pixels(40, -240), 10)).toEqual({ kind: "smooth", steps: 1 });
    expect(t.next(pixels(10, -240), 20)).toEqual({ kind: "smooth", steps: 0 });
  });

  it("ignores wheelDeltaY on a Mac, where a mouse's notches can be small", () => {
    expect(new WheelSteps(true).next(pixels(33, -120), 0).kind).toBe("smooth");
    expect(new WheelSteps(true).next(pixels(40, -120), 0).kind).toBe("notch");
  });

  it("doesn't take a sideways scroll's wheelDeltaY for a notch", () => {
    expect(new WheelSteps(false).next(pixels(0, -120, 12), 0).kind).toBe("smooth");
  });
});

describe("what the wheel does", () => {
  const e = (over: Partial<Parameters<typeof wheelIntent>[0]> = {}) => ({
    ctrl: false,
    meta: false,
    alt: false,
    z: false,
    dx: 0,
    dy: 100,
    ...over,
  });

  it("zooms with Ctrl or Cmd held, wherever it is", () => {
    expect(wheelIntent(e({ ctrl: true }), "ghost", "notch", "auto")).toBe("zoom");
    expect(wheelIntent(e({ meta: true }), "selection", "notch", "always")).toBe("zoom");
    expect(wheelIntent(e({ ctrl: true }), null, "smooth", "auto")).toBe("zoom");
  });

  it("does what it always did sideways (Shift+wheel, a tilting wheel, Firefox's sideways lines)", () => {
    expect(wheelIntent(e({ dx: 100, dy: 0 }), "ghost", "notch", "always")).toBe("default");
    expect(wheelIntent(e({ dx: 33, dy: 33, alt: true }), "selection", "notch", "auto")).toBe("default");
  });

  it("sizes with Alt, turns 5 degrees with Z, and otherwise turns as the setting says", () => {
    expect(wheelIntent(e({ alt: true }), "ghost", "smooth", "never")).toBe("size");
    expect(wheelIntent(e({ z: true }), "ghost", "smooth", "never")).toBe("fine-turn");
    expect(wheelIntent(e(), "ghost", "notch", "never")).toBe("default");
    expect(wheelIntent(e(), "ghost", "smooth", "always")).toBe("turn");
    expect(wheelIntent(e(), "ghost", "notch", "auto")).toBe("turn");
    expect(wheelIntent(e(), "ghost", "smooth", "auto")).toBe("default");
  });

  it("does what it always did with nothing to turn", () => {
    expect(wheelIntent(e({ alt: true }), null, "notch", "always")).toBe("default");
    expect(wheelIntent(e({ z: true }), null, "notch", "auto")).toBe("default");
  });
});

describe("X", () => {
  const gm = { gm: true, hex: false };

  it("goes from Move & select to Select and back, with the Build tool's mode as it was", () => {
    const into = pressX({ tool: "select", mode: "walls", ret: null, ...gm });
    expect(into).toEqual({ tool: "build", mode: "select", ret: { tool: "select", buildMode: "walls" } });
    const back = pressX({ tool: "build", mode: "select", ret: { tool: "select", buildMode: "walls" }, ...gm });
    expect(back).toEqual({ tool: "select", mode: "walls", ret: null });
    // Even when the Build tool was left in Select: the next B lands there.
    const fromSelect = pressX({ tool: "draw", mode: "select", ret: null, ...gm });
    expect(fromSelect).toEqual({ tool: "build", mode: "select", ret: { tool: "draw", buildMode: "select" } });
    expect(pressX({ tool: "build", mode: "select", ret: { tool: "draw", buildMode: "select" }, ...gm })).toEqual({
      tool: "draw",
      mode: "select",
      ret: null,
    });
  });

  it("goes from Walls to Select and back to Walls", () => {
    const into = pressX({ tool: "build", mode: "walls", ret: null, ...gm });
    expect(into).toEqual({ tool: "build", mode: "select", ret: { tool: "build", buildMode: "walls" } });
    expect(pressX({ tool: "build", mode: "select", ret: { tool: "build", buildMode: "walls" }, ...gm })).toEqual({
      tool: "build",
      mode: "walls",
      ret: null,
    });
  });

  it("goes to Objects when there's nowhere to go back to (the return was forgotten by a change of tool)", () => {
    expect(pressX({ tool: "build", mode: "select", ret: null, ...gm })).toEqual({ tool: "build", mode: "stamps", ret: null });
  });

  it("only says why on a hex grid, and does nothing for a player", () => {
    expect(pressX({ tool: "select", mode: "stamps", ret: null, gm: true, hex: true })).toEqual({ toast: expect.stringMatching(/square grid/) });
    expect(pressX({ tool: "select", mode: "stamps", ret: null, gm: false, hex: false })).toBeNull();
  });

  it("names where Back goes", () => {
    expect(backLabel(null)).toBe("Objects");
    expect(backLabel({ tool: "build", buildMode: "walls" })).toBe("Walls");
    expect(backLabel({ tool: "select", buildMode: "walls" })).toBe("Move & select");
  });
});

describe("folding steps into one undo", () => {
  const top = { sceneId: "s1", steps: {}, coalesce: { key: "b1", at: 1000 } };

  it("folds a step from the same burst on the same scene, soon enough, with nothing to redo", () => {
    expect(canFold(top, "b1", "s1", 1000 + BURST_MS, true)).toBe(true);
    expect(canFold(top, "b1", "s1", 1000, true)).toBe(true);
  });

  it("doesn't fold anything else", () => {
    expect(canFold(top, "b2", "s1", 1100, true)).toBe(false);
    expect(canFold(top, "b1", "s2", 1100, true)).toBe(false);
    expect(canFold(top, "b1", "s1", 1100, false)).toBe(false);
    expect(canFold(top, "b1", "s1", 1000 + BURST_MS + 1, true)).toBe(false);
    expect(canFold({ sceneId: "s1", coalesce: { key: "b1", at: 1000 } }, "b1", "s1", 1100, true)).toBe(false);
    expect(canFold({ sceneId: "s1", steps: {} }, "b1", "s1", 1100, true)).toBe(false);
    expect(canFold(undefined, "b1", "s1", 1100, true)).toBe(false);
  });
});

describe("the controls along the bottom", () => {
  const env = (wheel: WheelPref, mac = false) => ({ mac, wheel, backLabel: "Walls" });
  const keys = (hints: [string, string][]) => hints.map(([k, what]) => `${k} ${what}`);
  const zoomAt = (hints: [string, string][]) => hints.findIndex(([k, what]) => what === "zoom" && /wheel/i.test(k));

  it("always has the way to zoom among the first four in Objects and in Select with objects", () => {
    for (const wheel of ["auto", "always", "never"] as WheelPref[]) {
      const objects = buildHints(OPTS, { objects: 0, doors: 0 }, env(wheel));
      const select = buildHints({ ...OPTS, mode: "select" }, { objects: 2, doors: 0 }, env(wheel));
      expect(zoomAt(objects)).toBeGreaterThanOrEqual(0);
      expect(zoomAt(objects)).toBeLessThan(4);
      expect(zoomAt(select)).toBeGreaterThanOrEqual(0);
      expect(zoomAt(select)).toBeLessThan(4);
    }
    expect(keys(buildHints(OPTS, { objects: 0, doors: 0 }, env("auto"))).slice(0, 4)).toEqual([
      "Click place",
      "Wheel turn 15°",
      "Alt+wheel size",
      "Ctrl+wheel zoom",
    ]);
    expect(keys(buildHints(OPTS, { objects: 0, doors: 0 }, env("never"))).slice(0, 4)).toEqual([
      "Click place",
      "Z+wheel turn 5°",
      "Alt+wheel size",
      "Wheel zoom",
    ]);
  });

  it("says the plain wheel zooms in Select with nothing selected, and where X goes back to", () => {
    const hints = keys(buildHints({ ...OPTS, mode: "select" }, { objects: 0, doors: 0 }, env("auto")));
    expect(hints).toContain("Wheel zoom");
    expect(hints.at(-1)).toBe("X back to Walls");
  });

  it("shows ⌘ on a Mac", () => {
    const hints = keys(buildHints({ ...OPTS, mode: "select" }, { objects: 1, doors: 0 }, env("auto", true)));
    expect(hints).toContain("⌘+wheel zoom");
    expect(hints).toContain("⌘+D duplicate");
  });

  it("has its own short list with only doors selected", () => {
    expect(keys(buildHints({ ...OPTS, mode: "select" }, { objects: 0, doors: 2 }, env("auto")))).toEqual([
      "Del remove door",
      "Esc deselect",
      "Wheel zoom",
      "X back to Walls",
    ]);
  });

  it("offers X in every other mode", () => {
    for (const mode of ["building", "walls", "doors", "terrain"] as const) {
      expect(keys(buildHints({ ...OPTS, mode }, { objects: 0, doors: 0 }, env("auto")))).toContain("X select");
    }
  });
});

describe("the bars' words", () => {
  it("writes sizes in quarters and angles in degrees", () => {
    expect([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3].map(formatSize)).toEqual([
      "½",
      "¾",
      "1",
      "1¼",
      "1½",
      "1¾",
      "2",
      "2¼",
      "2½",
      "2¾",
      "3",
    ]);
    expect(formatDeg(45)).toBe("45°");
    expect(formatDeg(0)).toBe("0°");
  });

  it("says what's selected", () => {
    expect(selectionStatus({ objects: 0, doors: 0 })).toBe("Nothing selected");
    expect(selectionStatus({ objects: 1, doors: 0 })).toBe("1 object");
    expect(selectionStatus({ objects: 3, doors: 0 })).toBe("3 objects");
    expect(selectionStatus({ objects: 0, doors: 1 })).toBe("1 door");
    expect(selectionStatus({ objects: 2, doors: 1 })).toBe("2 objects, 1 door");
  });

  it("tries the copies right, down, left, then up", () => {
    expect(DUPLICATE_OFFSETS.map((o) => [o.dCol, o.dRow])).toEqual([
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]);
  });
});

describe("the room's undo for bursts, and X", () => {
  const SCENE_ID = "scene1";
  function room() {
    const r = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    const scene: Scene = {
      id: SCENE_ID,
      name: "Hall",
      order: 0,
      mapAssetId: null,
      width: 1400,
      height: 1400,
      background: "#000000",
      grid: { ...DEFAULT_GRID },
      fogCover: false,
      createdAt: 0,
    };
    const seed = new BuildEdit({}, SCENE_ID);
    seed.addPlaced({ id: "table", col: 2, row: 2, deg: 0, size: 1 });
    r.store.set({
      me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
      scenes: { [SCENE_ID]: scene },
      viewSceneId: SCENE_ID,
      activeSceneId: SCENE_ID,
      items: applyOps({}, seed.ops()),
    });
    return r;
  }
  const table = (r: RoomClient) => {
    const t = Object.values(r.state.items).find((i) => i.kind === "terrain");
    return t?.kind === "terrain" ? t.stamps[0] : undefined;
  };
  /** Turns the table 15 degrees, as one wheel notch does. */
  const turn = (r: RoomClient, burst?: string) => {
    const before = r.state.items;
    const e = new BuildEdit(before, SCENE_ID);
    const s = table(r)!;
    const p = placedOf(0, 0, s);
    e.place([refOf({ cx: 0, cy: 0, i: 0, stamp: s })], [{ ...p, deg: p.deg + 15 }]);
    const ops = e.ops();
    r.changeWith(ops, SCENE_ID, buildUndo(before, SCENE_ID, ops, e.pairs()), burst);
  };

  it("folds steps of one burst into one undo, and redo does them all again", () => {
    const r = room();
    turn(r, "b1");
    turn(r, "b1");
    turn(r, "b1");
    expect(table(r)).toEqual(["table", 2, 2, 0, 1, 45]);
    r.undo();
    expect(table(r)).toEqual(["table", 2, 2, 0, 1]);
    // The whole burst was one step: nothing more to undo.
    expect(r.state.canUndo).toBe(false);
    r.redo();
    expect(table(r)).toEqual(["table", 2, 2, 0, 1, 45]);
  });

  it("keeps steps of different bursts, or without one, apart", () => {
    const r = room();
    turn(r, "b1");
    turn(r, "b2");
    turn(r);
    turn(r);
    r.undo();
    expect(table(r)).toEqual(["table", 2, 2, 0, 1, 45]);
    r.undo();
    expect(table(r)).toEqual(["table", 2, 2, 0, 1, 30]);
    r.undo();
    expect(table(r)).toEqual(["table", 2, 2, 0, 1, 15]);
  });

  it("goes to Select and back with X, and forgets the way back when the tool is changed another way", () => {
    const r = room();
    r.setTool("draw");
    r.store.set({ buildOpts: { ...r.state.buildOpts, mode: "walls" } });
    r.toggleBuildSelect();
    expect([r.state.tool, r.state.buildOpts.mode]).toEqual(["build", "select"]);
    r.toggleBuildSelect();
    expect([r.state.tool, r.state.buildOpts.mode]).toEqual(["draw", "walls"]);
    r.toggleBuildSelect();
    r.setTool("build");
    expect(r.state.buildOpts.selectReturn).toBeNull();
    r.toggleBuildSelect();
    expect([r.state.tool, r.state.buildOpts.mode]).toEqual(["build", "stamps"]);
    // Picking Select in the bar remembers the mode it was picked from.
    r.setBuildMode("doors");
    r.setBuildMode("select");
    expect(r.state.buildOpts.selectReturn).toEqual({ tool: "build", buildMode: "doors" });
    r.toggleBuildSelect();
    expect(r.state.buildOpts.mode).toBe("doors");
  });

  it("starts the Build tool with no tokens selected", () => {
    const r = room();
    r.store.set({ selection: ["tok1"] });
    r.setTool("build");
    expect(r.state.selection).toEqual([]);
  });
});

describe("the protocol version", () => {
  it("is 4, and the browser sends it", async () => {
    expect(PROTOCOL_VERSION).toBe(4);
    // Node's fs, which the tests' types leave out (they check browser and Worker code).
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const src = fs.readFileSync(new URL("../src/client/room/client.ts", import.meta.url), "utf8");
    expect(src).toContain("v: String(PROTOCOL_VERSION)");
  });
});

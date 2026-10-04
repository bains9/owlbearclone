// Measuring in metres: distances read well in metres, rooms that measure in them give their
// new scenes 1.5 m a square, the GM can switch a room's scenes between feet and metres (one
// undo step), and rooms from before the setting keep exactly what they have.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { importBackup, makeZip } from "../src/client/backup";
import { GUIDE } from "../src/client/guide";
import { sceneFromMap } from "../src/client/importScenes";
import { RoomClient } from "../src/client/room/client";
import { cellDistance, formatDistance, templateGeometry } from "../src/shared/geometry";
import type { TemplateShape } from "../src/shared/geometry";
import { DEFAULT_GRID, DEFAULT_SETTINGS, LIMITS, sanitizeScene, sanitizeSettings } from "../src/shared/sanitize";
import type { Asset, GridSettings, Player, RoomInfo, RoomSettings, Scene } from "../src/shared/types";
import type { ServerMsg } from "../src/shared/protocol";
import type { GridUnits } from "../src/shared/units";
import {
  defaultGrid,
  importedUnits,
  isFeet,
  isMetres,
  isMetric,
  newSceneUnits,
  roundUnit,
  switchUnits,
} from "../src/shared/units";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const metres: GridSettings = { ...DEFAULT_GRID, size: 100, offsetX: 0, offsetY: 0, unit: 1.5, unitName: "m" };
const feet: GridSettings = { ...metres, unit: 5, unitName: "ft" };
const OLD_SETTINGS: RoomSettings = { playersCanDraw: true, playersCanAddTokens: true, playersMoveAll: true };

/** The centre of the cell `cx` across and `cy` down. */
const cell = (cx: number, cy: number) => ({ x: cx * 100 + 50, y: cy * 100 + 50 });

describe("distances in metres", () => {
  it("reads 4.5 m, 6 m, 7.5 m", () => {
    expect(formatDistance(1, metres)).toBe("1.5 m");
    expect(formatDistance(3, metres)).toBe("4.5 m");
    expect(formatDistance(4, metres)).toBe("6 m");
    expect(formatDistance(5, metres)).toBe("7.5 m");
    expect(formatDistance(20, metres)).toBe("30 m");
    expect(formatDistance(0, metres)).toBe("0 m");
  });

  it("never shows .0 or float noise", () => {
    expect(formatDistance(3, { ...metres, unit: 0.1 })).toBe("0.3 m");
    expect(formatDistance(3, { ...metres, unit: 1.1 })).toBe("3.3 m");
    expect(formatDistance(2.9999999, metres)).toBe("4.5 m");
    expect(formatDistance(4.0000001, metres)).toBe("6 m");
    for (let n = 0; n <= 200; n++) {
      expect(formatDistance(n, metres)).toMatch(/^\d+(\.[1-9])? m$/);
      expect(formatDistance(n / 7, metres)).toMatch(/^\d+(\.[1-9])? m$/);
    }
  });

  it("keeps feet as they were", () => {
    expect(formatDistance(3, feet)).toBe("15 ft");
    expect(formatDistance(Math.SQRT2, feet)).toBe("7.1 ft");
    expect(formatDistance(1.25, { ...feet, unit: 1, unitName: "m" })).toBe("1.3 m");
  });

  it("keeps two decimals for tiny distances, and works without a unit name", () => {
    expect(formatDistance(1, { ...metres, unit: 0.03 })).toBe("0.03 m");
    expect(formatDistance(4, { ...metres, unitName: "" })).toBe("6");
  });

  it("reads right with every diagonal rule and grid type", () => {
    // 3 across, 2 down.
    expect(formatDistance(cellDistance(cell(0, 0), cell(3, 2), metres), metres)).toBe("4.5 m");
    expect(formatDistance(cellDistance(cell(0, 0), cell(3, 2), { ...metres, diagonal: "alternating" }), metres)).toBe("6 m");
    expect(formatDistance(cellDistance(cell(0, 0), cell(5, 5), { ...metres, diagonal: "alternating" }), metres)).toBe("10.5 m");
    // 3 across, 4 down: 5 squares in a straight line.
    const straight = { ...metres, diagonal: "euclidean" as const };
    expect(formatDistance(cellDistance(cell(0, 0), cell(3, 4), straight), straight)).toBe("7.5 m");
    expect(formatDistance(cellDistance(cell(0, 0), cell(1, 1), straight), straight)).toBe("2.1 m");
    for (const type of ["hex-pointy", "hex-flat"] as const) {
      const hex = { ...metres, type };
      // Three hexes along a row (pointy) or a column (flat).
      const far = type === "hex-pointy" ? { x: 300, y: 0 } : { x: 0, y: 300 };
      expect(formatDistance(cellDistance({ x: 0, y: 0 }, far, hex), hex)).toBe("4.5 m");
    }
  });

  it("labels every spell area in metres", () => {
    const at = (shape: TemplateShape, to: { x: number; y: number }) => templateGeometry(shape, { x: 0, y: 0 }, to, metres).label;
    expect(at("circle", { x: 400, y: 0 })).toBe("6 m radius");
    expect(at("cone", { x: 300, y: 0 })).toBe("4.5 m cone");
    expect(at("square", { x: 100, y: 100 })).toBe("1.5 m cube");
    expect(at("beam", { x: 0, y: 500 })).toBe("7.5 m line");
    // Unsnapped sizes are fractions of a square, still to 0.1 m.
    const loose = templateGeometry("circle", { x: 0, y: 0 }, { x: 333, y: 0 }, { ...metres, snap: false }).label;
    expect(loose).toBe("5 m radius");
  });
});

describe("switching between feet and metres", () => {
  it("knows feet and metres by their usual names", () => {
    for (const n of ["ft", "FT", "ft.", "feet", "foot", " ft "]) expect(isFeet(n)).toBe(true);
    for (const n of ["m", "M", "metres", "meters", "metre", "m."]) expect(isMetres(n)).toBe(true);
    for (const n of ["km", "cm", "mi", "squares", "", "fathoms"]) {
      expect(isFeet(n)).toBe(false);
      expect(isMetres(n)).toBe(false);
    }
  });

  it("turns feet into metres at 5 ft = 1.5 m, to 0.1 m", () => {
    expect(switchUnits({ unit: 5, unitName: "ft" }, true)).toEqual({ unit: 1.5, unitName: "m" });
    expect(switchUnits({ unit: 10, unitName: "ft" }, true)).toEqual({ unit: 3, unitName: "m" });
    expect(switchUnits({ unit: 7, unitName: "feet" }, true)).toEqual({ unit: 2.1, unitName: "m" });
    expect(switchUnits({ unit: 2.5, unitName: "ft" }, true)).toEqual({ unit: 0.8, unitName: "m" });
    expect(switchUnits({ unit: 0.1, unitName: "ft" }, true)).toEqual({ unit: 0.03, unitName: "m" });
  });

  it("turns metres back into feet at 1.5 m = 5 ft", () => {
    expect(switchUnits({ unit: 1.5, unitName: "m" }, false)).toEqual({ unit: 5, unitName: "ft" });
    expect(switchUnits({ unit: 3, unitName: "m" }, false)).toEqual({ unit: 10, unitName: "ft" });
    expect(switchUnits({ unit: 4.5, unitName: "metres" }, false)).toEqual({ unit: 15, unitName: "ft" });
    expect(switchUnits({ unit: 1, unitName: "m" }, false)).toEqual({ unit: 3.3, unitName: "ft" });
  });

  it("leaves other units alone, and scenes already in the unit", () => {
    for (const unitName of ["squares", "km", "mi", ""]) {
      expect(switchUnits({ unit: 1, unitName }, true)).toBeNull();
      expect(switchUnits({ unit: 1, unitName }, false)).toBeNull();
    }
    expect(switchUnits({ unit: 1.5, unitName: "m" }, true)).toBeNull();
    expect(switchUnits({ unit: 5, unitName: "ft" }, false)).toBeNull();
  });

  it("leaves a scale alone that would be more than a square can be, so switching back gets it back", () => {
    expect(switchUnits({ unit: 30000, unitName: "m" }, false)).toEqual({ unit: 100000, unitName: "ft" });
    expect(switchUnits({ unit: 50000, unitName: "m" }, false)).toBeNull();
    expect(switchUnits({ unit: LIMITS.gridUnitMax, unitName: "m" }, false)).toBeNull();
    // Feet to metres only ever gets smaller, so the biggest still switches, and comes back.
    const big = switchUnits({ unit: LIMITS.gridUnitMax, unitName: "ft" }, true)!;
    expect(big).toEqual({ unit: 30000, unitName: "m" });
    expect(switchUnits(big, false)).toEqual({ unit: LIMITS.gridUnitMax, unitName: "ft" });
    // What the server keeps is the same range.
    expect(sanitizeScene({ id: "s1", name: "A", width: 700, height: 700, grid: { unit: 166666.7 } })!.grid.unit).toBe(LIMITS.gridUnitMax);
  });

  it("leaves a grid that isn't a number and a name alone (a hand-edited backup)", () => {
    expect(switchUnits({ unit: 5 } as GridUnits, true)).toBeNull();
    expect(switchUnits("ft" as unknown as GridUnits, true)).toBeNull();
    expect(switchUnits({ unit: "5", unitName: "ft" } as unknown as GridUnits, false)).toBeNull();
    expect(switchUnits(null as unknown as GridUnits, true)).toBeNull();
  });

  it("rounds without float noise", () => {
    expect(roundUnit(10 * 0.3)).toBe(3);
    expect(roundUnit(1.5 / 0.3)).toBe(5);
    expect(roundUnit(0.75)).toBe(0.8);
    expect(String(roundUnit(7 * 0.3))).toBe("2.1");
  });
});

describe("new scenes", () => {
  it("start in metres in a metric room and at 5 ft otherwise, exactly as before", () => {
    expect(defaultGrid({ metric: true })).toEqual({ ...DEFAULT_GRID, unit: 1.5, unitName: "m" });
    expect(defaultGrid({ metric: false })).toEqual(DEFAULT_GRID);
    expect(defaultGrid(OLD_SETTINGS)).toEqual(DEFAULT_GRID);
    expect(defaultGrid(null)).toEqual(DEFAULT_GRID);
    expect(newSceneUnits({ metric: true })).toEqual({ unit: 1.5, unitName: "m" });
    expect(newSceneUnits(undefined)).toEqual({ unit: 5, unitName: "ft" });
  });

  it("new rooms measure in metres; rooms from before don't", () => {
    expect(DEFAULT_SETTINGS.metric).toBe(true);
    expect(isMetric(DEFAULT_SETTINGS)).toBe(true);
    expect(isMetric(OLD_SETTINGS)).toBe(false);
  });

  const asset: Asset = {
    id: "map1",
    name: "Crypt",
    kind: "map",
    width: 2100,
    height: 1400,
    mime: "image/png",
    bytes: 1,
    owner: "@gm",
    createdAt: 0,
  };

  it("from uploads and the library take the room's units", () => {
    expect(sceneFromMap(asset, "Crypt", 0, true, newSceneUnits({ metric: true })).grid).toMatchObject({ unit: 1.5, unitName: "m", size: 140 });
    expect(sceneFromMap(asset, "Crypt", 0, true, newSceneUnits(OLD_SETTINGS)).grid).toEqual({ ...DEFAULT_GRID, size: 140 });
  });

  it("from Universal VTT files (which have no scale) take the room's units", () => {
    const map = { name: "Crypt", image: new File([], "c.png"), cols: 30, rows: 20, pxPerCell: 70, width: 2100, height: 1400 };
    const from = { map, source: { width: 2100, height: 1400 } };
    expect(sceneFromMap(asset, "Crypt", 0, true, importedUnits(undefined, { metric: true }), from).grid).toMatchObject({ unit: 1.5, unitName: "m" });
    expect(sceneFromMap(asset, "Crypt", 0, true, importedUnits(undefined, OLD_SETTINGS), from).grid).toMatchObject({ unit: 5, unitName: "ft" });
  });

  it("from Owlbear take its scale in metres in a metric room", () => {
    const on = { metric: true };
    expect(importedUnits({ unit: 5, unitName: "ft" }, on)).toEqual({ unit: 1.5, unitName: "m" });
    expect(importedUnits({ unit: 10, unitName: "feet" }, on)).toEqual({ unit: 3, unitName: "m" });
    expect(importedUnits({ unit: 2, unitName: "meters" }, on)).toEqual({ unit: 2, unitName: "m" });
    expect(importedUnits({ unit: 1, unitName: "squares" }, on)).toEqual({ unit: 1, unitName: "squares" });
    // A room in feet ignores Owlbear's scale, as it always has.
    expect(importedUnits({ unit: 3, unitName: "m" }, { metric: false })).toEqual({ unit: 5, unitName: "ft" });
  });

  it("made by the server without grid settings get the room's", () => {
    const raw = { id: "s1", name: "A", width: 700, height: 700 };
    expect(sanitizeScene(raw, undefined, defaultGrid({ metric: true }))!.grid).toMatchObject({ unit: 1.5, unitName: "m" });
    expect(sanitizeScene(raw)!.grid).toEqual(DEFAULT_GRID);
    // An existing scene keeps its own units whatever the room's are.
    const old = sanitizeScene(raw)!;
    expect(sanitizeScene({ id: "s1", name: "B" }, old, defaultGrid({ metric: true }))!.grid).toEqual(DEFAULT_GRID);
  });
});

describe("the room setting", () => {
  it("is a true or false the GM sets, and anything else is ignored", () => {
    expect(sanitizeSettings({ metric: true }, OLD_SETTINGS).metric).toBe(true);
    expect(sanitizeSettings({ metric: false }, DEFAULT_SETTINGS).metric).toBe(false);
    for (const bad of ["yes", 1, null, {}]) {
      expect(sanitizeSettings({ metric: bad }, DEFAULT_SETTINGS).metric).toBe(true);
    }
  });

  it("is left as it is by a page that doesn't know it, and never added to an old room", () => {
    expect(sanitizeSettings({ playersCanDraw: false }, DEFAULT_SETTINGS)).toEqual({ ...DEFAULT_SETTINGS, playersCanDraw: false });
    const old = sanitizeSettings({ playersCanDraw: false }, OLD_SETTINGS);
    expect(old).toEqual({ ...OLD_SETTINGS, playersCanDraw: false });
    expect("metric" in old).toBe(false);
  });
});

// ---------------------------------------------------------------- the server

interface Conn extends Player {
  sid: string;
  v?: number;
}

interface Sock {
  conn: Conn;
  sent: { t: string; room?: RoomInfo; scene?: Scene; message?: string }[];
  send(data: string): void;
  deserializeAttachment(): Conn;
  serializeAttachment(c: Conn): void;
}

interface RoomInside {
  info: RoomInfo | null;
  scenes: Map<string, Scene>;
  create(id: string, name: string): RoomInfo;
  handle(ws: Sock, conn: Conn, msg: object, seq: number | undefined): Promise<void>;
}

let RoomClass: { prototype: object };

beforeAll(async () => {
  // Imported by a path tsc doesn't follow: the tests' types leave out the Workers runtime.
  const mod = (await import(/* @vite-ignore */ "../src/worker/" + "room")) as { Room: { prototype: object } };
  RoomClass = mod.Room;
});

function sock(conn: Conn): Sock {
  const s: Sock = {
    conn,
    sent: [],
    send(data) {
      s.sent.push(JSON.parse(data) as Sock["sent"][number]);
    },
    deserializeAttachment: () => s.conn,
    serializeAttachment(c) {
      s.conn = c;
    },
  };
  return s;
}

const gmConn: Conn = { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm", sid: "s1", v: 4 };
const playerConn: Conn = { connId: "c2", userId: "alice1", name: "Alice", color: "#00ff00", role: "player", sid: "s2", v: 4 };

/** A Room with no storage: `info` as given (null: not made yet), one scene in feet. */
function server(info: RoomInfo | null) {
  const gm = sock(gmConn);
  const player = sock(playerConn);
  const r = Object.create(RoomClass.prototype) as RoomInside;
  const oldScene: Scene = {
    id: "scene1",
    name: "Old",
    order: 0,
    mapAssetId: null,
    width: 700,
    height: 700,
    background: "#000000",
    grid: { ...DEFAULT_GRID },
    fogCover: false,
    createdAt: 0,
  };
  Object.assign(r, {
    sql: { exec: () => ({ toArray: () => [] }) },
    ctx: { storage: { transactionSync: (f: () => void) => f() }, getWebSockets: () => [gm, player] },
    env: {},
    info,
    activeSceneId: info ? "scene1" : null,
    scenes: new Map(info ? [["scene1", oldScene]] : []),
    items: new Map(),
    assets: new Map(),
    initiative: { entries: [], turn: 0, round: 1 },
    sessionSeqs: new Map(),
  });
  return { r, gm, player };
}

const oldInfo = (): RoomInfo => ({ id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...OLD_SETTINGS } });

describe("the server", () => {
  it("makes new rooms in metres, Scene 1 too", () => {
    const { r } = server(null);
    const info = r.create("AbCdEf123456", "New");
    expect(info.settings.metric).toBe(true);
    expect([...r.scenes.values()][0].grid).toMatchObject({ unit: 1.5, unitName: "m" });
  });

  it("lets the GM turn metres on and off, and no player", async () => {
    const { r, gm, player } = server(oldInfo());
    await r.handle(player, playerConn, { t: "room.update", settings: { metric: true } }, 1);
    expect(player.sent.at(-1)).toMatchObject({ t: "error" });
    expect(r.info!.settings.metric).toBeUndefined();
    await r.handle(gm, gmConn, { t: "room.update", settings: { metric: true } }, 1);
    expect(r.info!.settings.metric).toBe(true);
    expect(player.sent.at(-1)).toMatchObject({ t: "room", room: { settings: { metric: true } } });
    await r.handle(gm, gmConn, { t: "room.update", settings: { metric: "no" } }, 2);
    expect(r.info!.settings.metric).toBe(true);
    await r.handle(gm, gmConn, { t: "room.update", settings: { metric: false } }, 3);
    expect(r.info!.settings.metric).toBe(false);
  });

  it("leaves an old room and its scenes exactly as they were", async () => {
    const { r, gm } = server(oldInfo());
    // A page that doesn't know the setting changes another one.
    await r.handle(gm, gmConn, { t: "room.update", settings: { playersCanDraw: false } }, 1);
    expect(r.info!.settings).toEqual({ ...OLD_SETTINGS, playersCanDraw: false });
    expect(r.scenes.get("scene1")!.grid).toEqual(DEFAULT_GRID);
    // A new scene sent without its grid settings is in feet, as before.
    await r.handle(gm, gmConn, { t: "scene.upsert", scene: { id: "scene2", name: "New", width: 700, height: 700 }, create: true }, 2);
    expect(r.scenes.get("scene2")!.grid).toEqual(DEFAULT_GRID);
  });

  it("gives a metric room's new scenes metres, and leaves its old ones alone", async () => {
    const { r, gm } = server(oldInfo());
    await r.handle(gm, gmConn, { t: "room.update", settings: { metric: true } }, 1);
    expect(r.scenes.get("scene1")!.grid).toEqual(DEFAULT_GRID);
    await r.handle(gm, gmConn, { t: "scene.upsert", scene: { id: "scene2", name: "New", width: 700, height: 700, grid: { size: 50 } }, create: true }, 2);
    expect(r.scenes.get("scene2")!.grid).toMatchObject({ size: 50, unit: 1.5, unitName: "m" });
    // A scene sent with its own units keeps them.
    await r.handle(gm, gmConn, { t: "scene.upsert", scene: { id: "scene3", name: "Feet", width: 700, height: 700, grid: { ...DEFAULT_GRID } }, create: true }, 3);
    expect(r.scenes.get("scene3")!.grid).toEqual(DEFAULT_GRID);
  });
});

// ---------------------------------------------------------------- the GM's page

function scene(id: string, unit: number, unitName: string, order = 0): Scene {
  return {
    id,
    name: id,
    order,
    mapAssetId: null,
    width: 700,
    height: 700,
    background: "#000000",
    grid: { ...DEFAULT_GRID, unit, unitName },
    fogCover: false,
    createdAt: 0,
  };
}

function client(settings: RoomSettings) {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  room.store.set({
    me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" },
    room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings },
    scenes: {
      a: scene("a", 5, "ft"),
      b: scene("b", 10, "feet", 1),
      c: scene("c", 1.5, "m", 2),
      d: scene("d", 1, "squares", 3),
    },
    viewSceneId: "a",
    activeSceneId: "a",
    items: {},
  });
  return room;
}

const units = (room: RoomClient) =>
  Object.fromEntries(Object.values(room.state.scenes).map((s) => [s.id, `${s.grid.unit} ${s.grid.unitName}`]));

describe("switching a room's scenes", () => {
  it("switches the scenes in feet to metres as one undoable step", () => {
    const room = client({ ...OLD_SETTINGS, metric: true });
    expect(room.switchSceneUnits(true)).toBe(2);
    expect(units(room)).toEqual({ a: "1.5 m", b: "3 m", c: "1.5 m", d: "1 squares" });
    expect(room.state.canUndo).toBe(true);
    // Undo reaches it from any scene, and takes back all of it at once.
    room.viewSceneLocally("d");
    room.undo();
    expect(units(room)).toEqual({ a: "5 ft", b: "10 feet", c: "1.5 m", d: "1 squares" });
    room.redo();
    expect(units(room)).toEqual({ a: "1.5 m", b: "3 m", c: "1.5 m", d: "1 squares" });
  });

  it("undo puts back only the units, not a later change to the grid", () => {
    const room = client({ ...OLD_SETTINGS, metric: true });
    room.switchSceneUnits(true);
    room.updateScene("a", { grid: { ...room.state.scenes.a.grid, size: 123 } });
    room.undo();
    expect(room.state.scenes.a.grid).toMatchObject({ size: 123, unit: 5, unitName: "ft" });
  });

  it("undoing a new map, before or after the switch, never brings back the other unit", () => {
    // A new map records the scene's whole grid; undo takes back the map and leaves the unit.
    const swapMap = (room: RoomClient) => room.changeScene("a", { grid: { ...room.state.scenes.a.grid, size: 50 } }, {});
    // The switch undone first (from another scene), then the map.
    let room = client({ ...OLD_SETTINGS, metric: true });
    room.switchSceneUnits(true);
    swapMap(room);
    room.viewSceneLocally("b");
    room.undo();
    expect(units(room)).toMatchObject({ a: "5 ft", b: "10 feet" });
    room.viewSceneLocally("a");
    room.undo();
    expect(units(room)).toMatchObject({ a: "5 ft", b: "10 feet" });
    expect(room.state.scenes.a.grid.size).toBe(DEFAULT_GRID.size);
    expect(room.state.canUndo).toBe(false);
    // And redone in the same order: the switch, then the map, still in metres.
    room.viewSceneLocally("b");
    room.redo();
    room.viewSceneLocally("a");
    room.redo();
    expect(units(room)).toMatchObject({ a: "1.5 m", b: "3 m" });
    expect(room.state.scenes.a.grid.size).toBe(50);
    // The map undone first, then the switch.
    room = client({ ...OLD_SETTINGS, metric: true });
    room.switchSceneUnits(true);
    swapMap(room);
    room.undo();
    expect(units(room)).toMatchObject({ a: "1.5 m", b: "3 m" });
    expect(room.state.scenes.a.grid.size).toBe(DEFAULT_GRID.size);
    room.undo();
    expect(units(room)).toMatchObject({ a: "5 ft", b: "10 feet" });
  });

  it("is a new step: what was undone before it can't be redone after", () => {
    const room = client({ ...OLD_SETTINGS, metric: true });
    room.changeScene("a", { fogCover: true }, {});
    room.undo();
    expect(room.state.canRedo).toBe(true);
    room.switchSceneUnits(true);
    expect(room.state.canRedo).toBe(false);
    room.redo();
    expect(room.state.scenes.a.fogCover).toBe(false);
  });

  it("goes away once every scene it switched has been deleted", () => {
    const room = client({ ...OLD_SETTINGS, metric: true });
    room.store.set({ scenes: { a: scene("a", 5, "ft"), c: scene("c", 1.5, "m", 1) }, viewSceneId: "c", activeSceneId: "c" });
    expect(room.switchSceneUnits(true)).toBe(1);
    expect(room.state.canUndo).toBe(true);
    const server = room as unknown as { onServer(msg: ServerMsg): void };
    // Another scene going doesn't touch it; the switched scene going takes it with it.
    room.store.set({ scenes: { ...room.state.scenes, d: scene("d", 1, "squares", 2) } });
    server.onServer({ t: "scene.delete", id: "d" } as ServerMsg);
    expect(room.state.canUndo).toBe(true);
    server.onServer({ t: "scene.delete", id: "a" } as ServerMsg);
    expect(room.state.scenes.a).toBeUndefined();
    expect(room.state.canUndo).toBe(false);
    // With two scenes switched, deleting one keeps the step for the other.
    const two = client({ ...OLD_SETTINGS, metric: true });
    expect(two.switchSceneUnits(true)).toBe(2);
    (two as unknown as { onServer(msg: ServerMsg): void }).onServer({ t: "scene.delete", id: "a" } as ServerMsg);
    expect(two.state.canUndo).toBe(true);
    two.undo();
    expect(two.state.scenes.b.grid).toMatchObject({ unit: 10, unitName: "feet" });
  });

  it("switches back to feet the other way", () => {
    const room = client({ ...OLD_SETTINGS, metric: false });
    expect(room.switchSceneUnits(false)).toBe(1);
    expect(units(room)).toEqual({ a: "5 ft", b: "10 feet", c: "5 ft", d: "1 squares" });
  });

  it("does nothing, and adds no undo step, when no scene needs switching", () => {
    const room = client(OLD_SETTINGS);
    room.store.set({ scenes: { c: scene("c", 1.5, "m") } });
    expect(room.switchSceneUnits(true)).toBe(0);
    expect(room.state.canUndo).toBe(false);
  });
});

describe("restoring a backup", () => {
  const backup = (scenes: Scene[]) =>
    new File(
      [
        makeZip([
          {
            name: "room.json",
            data: new TextEncoder().encode(
              JSON.stringify({ format: "tabletop-backup", version: 1, exportedAt: 0, room: { name: "Old", settings: OLD_SETTINGS }, scenes, items: [], assets: [] }),
            ),
          },
        ]),
      ],
      "old.tabletop.zip",
    );

  it("into a metric room switches scenes in feet to metres and says so", async () => {
    const room = client({ ...OLD_SETTINGS, metric: true });
    room.store.set({ scenes: {} });
    const text = await importBackup(room, backup([scene("x", 5, "ft"), scene("y", 2, "km", 1)]), () => {});
    expect(Object.values(room.state.scenes).map((s) => `${s.grid.unit} ${s.grid.unitName}`).sort()).toEqual(["1.5 m", "2 km"]);
    expect(text).toMatch(/One was measured in feet and now measures in metres/);
  });

  it("into a metric room leaves a scene whose grid isn't a number and a name for the server to fill in", async () => {
    const room = client({ ...OLD_SETTINGS, metric: true });
    room.store.set({ scenes: {} });
    const odd = { ...scene("x", 5, "ft"), grid: { unit: 5 } } as unknown as Scene;
    const text = await importBackup(room, backup([odd, scene("y", 5, "ft", 1)]), () => {});
    expect(Object.keys(room.state.scenes)).toHaveLength(2);
    expect(text).toMatch(/One was measured in feet/);
  });

  it("into a room in feet keeps the scenes as they were", async () => {
    const room = client(OLD_SETTINGS);
    room.store.set({ scenes: {} });
    const text = await importBackup(room, backup([scene("x", 1.5, "m"), scene("y", 5, "ft", 1)]), () => {});
    expect(Object.values(room.state.scenes).map((s) => `${s.grid.unit} ${s.grid.unitName}`).sort()).toEqual(["1.5 m", "5 ft"]);
    expect(text).not.toMatch(/metres/);
  });
});

describe("the guide", () => {
  const parts = GUIDE.flatMap((s) => s.parts);
  const text = (title: string) => {
    const p = parts.find((x) => x.title === title);
    if (!p) throw new Error(`no guide part "${title}"`);
    return [...p.steps, ...p.notes].join("\n");
  };

  it("has metres second in What's new, after the NPCs, keeping the entries before it", () => {
    const news = GUIDE.find((s) => s.id === "whats-new")!.parts.map((p) => p.title);
    expect(news[0]).toBe("NPC tokens by race and class (4 October 2026, later)");
    expect(news[1]).toBe("Measure in metres (4 October 2026)");
    expect(news).toContain("Monsters ready to use (3 October 2026, later)");
    expect(news).toContain("Pointing on the table display (29 September 2026, later)");
  });

  it("explains the setting where room settings are, with how undo works", () => {
    const setting = text("Measure in metres");
    expect(setting).toContain("**Measure in metres (1.5 m a square)**");
    expect(setting).toContain("**Only new scenes**");
    expect(setting).toContain("**Switch them too**");
    expect(setting).toMatch(/Undo/);
  });

  it("mentions metres wherever it gives a distance in feet", () => {
    for (const p of parts) {
      for (const line of [...p.steps, ...p.notes]) {
        if (/\b\d+ ?ft\b/.test(line)) {
          expect(line, `${p.title}: ${line}`).toMatch(/\bm\b|metres/);
        }
      }
    }
  });
});

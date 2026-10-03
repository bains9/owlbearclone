// Compass roses: a token drawn as one (art "compass"), the GM's alone. Validation,
// permissions, undo (one step per change, a burst of turning as one), and the art.
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomClient } from "../src/client/room/client";
import { duplicateSelection } from "../src/client/room/actions";
import { BURST_MS, canFoldPlain } from "../src/client/room/buildInput";
import {
  COMPASS_COLOR,
  COMPASS_CORE,
  COMPASS_SIZE,
  COMPASS_SIZE_MAX,
  COMPASS_SIZE_MIN,
  compassesKey,
  dialValue,
  drawCompass,
  inCompassCore,
  sizeBy,
  tokenCovers,
  turnBy,
} from "../src/client/room/compass";
import type { CompassLook } from "../src/client/room/compass";
import { inverseOps, isPatchOnly, mergePatches } from "../src/shared/ops";
import { canCreate, canDelete, canMove, canPatch, canReplace, visibleToPlayer } from "../src/shared/permissions";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, LIMITS, sanitizeItem, sanitizeSet } from "../src/shared/sanitize";
import { bringsCompass, compassesOn, isCompass } from "../src/shared/types";
import type { Player, Scene, TokenItem } from "../src/shared/types";

const compass: TokenItem = {
  id: "comp1",
  sceneId: "scene1",
  kind: "token",
  z: 0,
  owner: GM_OWNER,
  x: 140,
  y: 140,
  size: 2,
  rotation: 30,
  assetId: null,
  color: "#d62f2f",
  label: "N",
  hidden: false,
  locked: false,
  rings: [],
  layer: "prop",
  art: "compass",
};
const { layer: _layer, art: _art, ...plainToken } = compass;
const goblin: TokenItem = { ...plainToken, id: "gob1", owner: "alice", label: "Goblin", size: 1, rotation: 0 };

const gm = { userId: GM_OWNER, role: "gm" as const };
const alice = { userId: "alice", role: "player" as const };
const settings = DEFAULT_SETTINGS;

describe("a compass's data", () => {
  it("is a token with built-in art", () => {
    expect(isCompass(compass)).toBe(true);
    expect(isCompass(goblin)).toBe(false);
    expect(isCompass(null)).toBe(false);
  });

  it("is accepted as sent", () => {
    expect(sanitizeItem(compass, GM_OWNER)).toEqual(compass);
  });

  it("is always a prop drawn without an image", () => {
    const out = sanitizeItem({ ...compass, assetId: "img1", layer: "character" }, GM_OWNER);
    expect(out).toMatchObject({ art: "compass", assetId: null, layer: "prop" });
  });

  it("gets sensible defaults for what's missing", () => {
    const { size: _s, rotation: _r, color: _c, label: _l, rings: _g, hidden: _h, locked: _k, layer: _y, ...bare } = compass;
    expect(sanitizeItem(bare, GM_OWNER)).toEqual({ ...compass, rotation: 0, size: COMPASS_SIZE, color: COMPASS_COLOR });
  });

  it("keeps any angle, within a turn", () => {
    expect(sanitizeItem({ ...compass, rotation: 725 }, GM_OWNER)).toMatchObject({ rotation: 5 });
    expect(sanitizeItem({ ...compass, rotation: -90 }, GM_OWNER)).toMatchObject({ rotation: 270 });
  });

  it("refuses art it doesn't know, and leaves ordinary tokens without any", () => {
    expect(sanitizeItem({ ...compass, art: "sundial" }, GM_OWNER)).toBeNull();
    expect(sanitizeItem({ ...compass, art: 1 }, GM_OWNER)).toBeNull();
    const plain = sanitizeItem({ ...goblin, art: null }, "alice");
    expect(plain).not.toBeNull();
    expect(plain && "art" in plain).toBe(false);
  });

  it("is held to the token limits", () => {
    expect(sanitizeItem({ ...compass, size: 1000 }, GM_OWNER)).toMatchObject({ size: LIMITS.tokenSizeMax });
    expect(sanitizeItem({ ...compass, x: "far" }, GM_OWNER)).toBeNull();
    expect(LIMITS.compassesPerScene).toBeGreaterThan(1);
  });

  it("counts against a scene's limit however it comes there", () => {
    // Added, a token made into one, or one moved over from another scene.
    expect(bringsCompass(null, compass)).toBe(true);
    expect(bringsCompass(goblin, { ...compass, id: goblin.id })).toBe(true);
    expect(bringsCompass({ ...compass, sceneId: "scene2" }, compass)).toBe(true);
    // A compass changed where it is, or anything that isn't a compass, doesn't.
    expect(bringsCompass(compass, { ...compass, rotation: 90 })).toBe(false);
    expect(bringsCompass(compass, { ...goblin, id: compass.id })).toBe(false);
    expect(bringsCompass(null, goblin)).toBe(false);
  });

  it("is counted per scene", () => {
    const items = [compass, { ...compass, id: "comp2" }, { ...compass, id: "comp3", sceneId: "scene2" }, goblin];
    expect(compassesOn(items, "scene1")).toBe(2);
    expect(compassesOn(items, "scene2")).toBe(1);
    expect(compassesOn(items, "scene3")).toBe(0);
  });

  it("can be moved, turned, sized, locked and hidden by a patch", () => {
    expect(sanitizeSet(compass, { x: 10, y: 20, rotation: 400, size: 3, locked: true, hidden: true })).toEqual({
      x: 10,
      y: 20,
      rotation: 40,
      size: 3,
      locked: true,
      hidden: true,
    });
  });

  it("stays a compass: no patch makes it a character, gives it an image, or changes its art", () => {
    expect(sanitizeSet(compass, { layer: "character" })).toBeNull();
    expect(sanitizeSet(compass, { assetId: "img1" })).toBeNull();
    expect(sanitizeSet(compass, { layer: "prop", assetId: null })).toEqual({ layer: "prop", assetId: null });
    expect(sanitizeSet(compass, { art: null })).toBeNull();
    expect(sanitizeSet(goblin, { art: "compass" })).toBeNull();
  });
});

describe("who may change a compass", () => {
  it("lets players see it, under fog or not", () => {
    expect(visibleToPlayer(compass, "scene1")).toBe(true);
    expect(visibleToPlayer({ ...compass, hidden: true }, "scene1")).toBe(false);
  });

  it("lets the GM do everything", () => {
    expect(canCreate(compass, gm, settings)).toBe(true);
    expect(canMove(compass, gm, settings)).toBe(true);
    expect(canPatch(compass, { rotation: 90 }, gm, settings)).toBe(true);
    expect(canDelete(compass, gm)).toBe(true);
  });

  it("refuses players everything, even with every player permission on", () => {
    const open = { ...settings, playersCanAddTokens: true, playersMoveAll: true };
    expect(canCreate({ ...compass, owner: "alice" }, alice, open)).toBe(false);
    expect(canMove(compass, alice, open)).toBe(false);
    expect(canPatch(compass, { rotation: 90 }, alice, open)).toBe(false);
    expect(canPatch(compass, { x: 0 }, alice, open)).toBe(false);
    expect(canPatch(compass, { size: 3 }, alice, open)).toBe(false);
    expect(canDelete(compass, alice)).toBe(false);
    // Even one that somehow has a player's name on it.
    expect(canDelete({ ...compass, owner: "alice" }, alice)).toBe(false);
    expect(canMove({ ...compass, owner: "alice" }, alice, open)).toBe(false);
    expect(canReplace(compass, { ...compass, rotation: 90 }, alice, open)).toBe(false);
  });

  it("never lets a player turn their token into a compass, or one back", () => {
    expect(canReplace(goblin, { ...goblin, label: "Bob" }, alice, settings)).toBe(true);
    expect(canReplace(goblin, { ...goblin, art: "compass" }, alice, settings)).toBe(false);
    expect(canReplace({ ...compass, owner: "alice" }, { ...compass, owner: "alice", art: undefined }, alice, settings)).toBe(false);
  });
});

describe("compass numbers", () => {
  it("turns round and round", () => {
    expect(turnBy(350, 15)).toBe(5);
    expect(turnBy(5, -15)).toBe(350);
    expect(turnBy(0, -5)).toBe(355);
    expect(turnBy(359.999, 0)).toBe(0);
    expect(turnBy(90, 720)).toBe(90);
  });

  it("sizes in quarter squares, within limits", () => {
    expect(sizeBy(2, 0.25)).toBe(2.25);
    expect(sizeBy(2, -0.25)).toBe(1.75);
    expect(sizeBy(COMPASS_SIZE_MIN, -0.25)).toBe(COMPASS_SIZE_MIN);
    expect(sizeBy(COMPASS_SIZE_MAX, 0.25)).toBe(COMPASS_SIZE_MAX);
    expect(sizeBy(1.1, 0)).toBe(1);
  });

  it("is picked in its middle, and a token is under a point within its disc or picture", () => {
    const at = { x: 100, y: 100, size: 2 };
    // Two squares of 70: radius 70, the middle COMPASS_CORE of it.
    expect(inCompassCore(at, 70, { x: 100, y: 100 })).toBe(true);
    expect(inCompassCore(at, 70, { x: 100 + 70 * COMPASS_CORE - 1, y: 100 })).toBe(true);
    expect(inCompassCore(at, 70, { x: 100 + 70 * COMPASS_CORE + 1, y: 100 })).toBe(false);
    const disc = { x: 0, y: 0, size: 1, rotation: 0, assetId: null };
    expect(tokenCovers(disc, 70, { x: 30, y: 0 })).toBe(true);
    expect(tokenCovers(disc, 70, { x: 30, y: 30 })).toBe(false);
    // A picture: the square it's fitted into, turned with it.
    const pic = { ...disc, assetId: "img1" };
    expect(tokenCovers(pic, 70, { x: 30, y: 30 })).toBe(true);
    expect(tokenCovers({ ...pic, rotation: 45 }, 70, { x: 30, y: 30 })).toBe(false);
    expect(tokenCovers({ ...pic, rotation: 45 }, 70, { x: 0, y: 45 })).toBe(true);
  });

  it("redraws the fog only when a compass itself changes", () => {
    const look: CompassLook = { id: "c", x: 10, y: 20, rotation: 30, r: 70, color: "#d62f2f", shown: true };
    const key = compassesKey([look]);
    expect(compassesKey([{ ...look }])).toBe(key);
    expect(compassesKey([])).toBe("");
    for (const change of [{ x: 11 }, { y: 21 }, { rotation: 35 }, { r: 80 }, { color: "#000000" }, { shown: false }]) {
      expect(compassesKey([{ ...look, ...change }])).not.toBe(key);
    }
    expect(compassesKey([look, { ...look, id: "d" }])).not.toBe(key);
  });

  it("shows the dial in its 5 degree steps", () => {
    expect(dialValue(0)).toBe(0);
    expect(dialValue(47)).toBe(45);
    expect(dialValue(358)).toBe(0);
    expect(dialValue(352.4)).toBe(350);
  });
});

describe("folding a burst of turning into one undo step", () => {
  it("merges patches field by field, the later winning", () => {
    expect(
      mergePatches(
        [{ id: "a", set: { rotation: 15 } }, { id: "b", set: { size: 2 } }],
        [{ id: "a", set: { rotation: 30, size: 3 } }, { id: "c", set: { x: 1 } }],
      ),
    ).toEqual([
      { id: "a", set: { rotation: 30, size: 3 } },
      { id: "b", set: { size: 2 } },
      { id: "c", set: { x: 1 } },
    ]);
  });

  it("only folds plain patches", () => {
    expect(isPatchOnly({ patch: [{ id: "a", set: { x: 1 } }] })).toBe(true);
    expect(isPatchOnly({ patch: [{ id: "a", set: { x: 1 } }], delete: ["b"] })).toBe(false);
    expect(isPatchOnly({ upsert: [compass] })).toBe(false);
    expect(isPatchOnly({})).toBe(false);
  });

  it("folds only into the same burst, on the same scene, soon enough, with nothing to redo", () => {
    const top = { sceneId: "s1", coalesce: { key: "k", at: 1000 } };
    expect(canFoldPlain(top, "k", "s1", 1000 + BURST_MS, true)).toBe(true);
    expect(canFoldPlain(top, "k2", "s1", 1100, true)).toBe(false);
    expect(canFoldPlain(top, "k", "s2", 1100, true)).toBe(false);
    expect(canFoldPlain(top, "k", "s1", 1001 + BURST_MS, true)).toBe(false);
    expect(canFoldPlain(top, "k", "s1", 1100, false)).toBe(false);
    // Never into a build step or a change to the scene, nor a step that wasn't a burst.
    expect(canFoldPlain({ ...top, steps: {} }, "k", "s1", 1100, true)).toBe(false);
    expect(canFoldPlain({ ...top, scene: {} }, "k", "s1", 1100, true)).toBe(false);
    expect(canFoldPlain({ sceneId: "s1" }, "k", "s1", 1100, true)).toBe(false);
    expect(canFoldPlain(undefined, "k", "s1", 1100, true)).toBe(false);
  });

  it("folds a drag still held down however long it pauses, but nothing else", () => {
    const top = { sceneId: "s1", coalesce: { key: "dial|c|1", at: 1000 } };
    expect(canFoldPlain(top, "dial|c|1", "s1", 1000 + 60_000, true, true)).toBe(true);
    expect(canFoldPlain(top, "dial|c|1", "s1", 1000 + 60_000, true, false)).toBe(false);
    // Held or not, a new drag (a new key), another scene or something to redo starts a new step.
    expect(canFoldPlain(top, "dial|c|2", "s1", 1100, true, true)).toBe(false);
    expect(canFoldPlain(top, "dial|c|1", "s2", 1100, true, true)).toBe(false);
    expect(canFoldPlain(top, "dial|c|1", "s1", 1100, false, true)).toBe(false);
  });
});

function client(me: Player = { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" }) {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  const scene: Scene = {
    id: "scene1",
    name: "Crypt",
    order: 0,
    mapAssetId: null,
    width: 1400,
    height: 1000,
    background: "#000000",
    grid: { ...DEFAULT_GRID },
    fogCover: true,
    createdAt: 0,
  };
  room.store.set({
    me,
    room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings: { ...DEFAULT_SETTINGS } },
    scenes: { scene1: scene },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
    items: {},
  });
  return room;
}

const alicePlayer: Player = { connId: "c2", userId: "alice", name: "Alice", color: "#00ff00", role: "player" };

afterEach(() => {
  vi.useRealTimers();
});

describe("adding a compass (GM)", () => {
  it("puts one in the middle of the view, two squares across, North up, selected", () => {
    const room = client();
    room.store.set({ tool: "draw" });
    const c = room.addCompass()!;
    expect(c).toMatchObject({ art: "compass", size: COMPASS_SIZE, rotation: 0, layer: "prop", assetId: null, label: "N" });
    // On the grid: a two-square token's middle is on a grid corner (the scene's middle here).
    expect([c.x, c.y]).toEqual([700, 490]);
    expect(room.state.items[c.id]).toEqual(c);
    expect(room.state.selection).toEqual([c.id]);
    expect(room.state.tool).toBe("select");
    // What it sends passes the server's checks unchanged.
    expect(sanitizeItem(c, GM_OWNER)).toEqual(c);
  });

  it("is one undo step, and redo brings it back", () => {
    const room = client();
    const c = room.addCompass()!;
    room.undo();
    expect(room.state.items[c.id]).toBeUndefined();
    room.redo();
    expect(room.state.items[c.id]).toEqual(c);
  });

  it("isn't offered to players", () => {
    const room = client(alicePlayer);
    expect(room.addCompass()).toBeNull();
    expect(Object.keys(room.state.items)).toEqual([]);
  });

  it("stops at the scene's limit with a message, adding nothing and no undo step", () => {
    const room = client();
    const full: Record<string, TokenItem> = {};
    for (let i = 0; i < LIMITS.compassesPerScene - 1; i++) full[`full${i}`] = { ...compass, id: `full${i}` };
    // Compasses on other scenes don't count.
    full.other = { ...compass, id: "other", sceneId: "scene2" };
    room.store.set({ items: full });
    const last = room.addCompass()!;
    expect(last).not.toBeNull();
    expect(room.state.toasts).toEqual([]);
    expect(room.addCompass()).toBeNull();
    expect(Object.keys(room.state.items)).toHaveLength(LIMITS.compassesPerScene + 1);
    expect(room.state.toasts.at(-1)).toMatchObject({ kind: "error", text: expect.stringContaining(`up to ${LIMITS.compassesPerScene} compasses`) });
    expect(room.state.selection).toEqual([last.id]);
    // The refused one left no step: undo takes back the last one that was added.
    room.undo();
    expect(room.state.items[last.id]).toBeUndefined();
  });
});

describe("changing a compass", () => {
  it("makes each move, turn, size change and delete its own undo step", () => {
    const room = client();
    const c = room.addCompass()!;
    room.change({ patch: [{ id: c.id, set: { x: 300, y: 300 } }] });
    room.change({ patch: [{ id: c.id, set: { rotation: 45 } }] });
    room.change({ patch: [{ id: c.id, set: { size: 3 } }] });
    room.change({ delete: [c.id] });
    expect(room.state.items[c.id]).toBeUndefined();
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ x: 300, rotation: 45, size: 3 });
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ size: 2, rotation: 45 });
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 0, x: 300 });
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ x: c.x, y: c.y });
  });

  it("folds a burst of wheel turns into one undo step", () => {
    const room = client();
    const c = room.addCompass()!;
    let rot = 0;
    for (let i = 0; i < 6; i++) {
      rot = turnBy(rot, 15);
      room.change({ patch: [{ id: c.id, set: { rotation: rot } }] }, true, "compass|b1");
    }
    expect(room.state.items[c.id]).toMatchObject({ rotation: 90 });
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 0 });
    // The compass itself is still there: the burst didn't fold into adding it.
    expect(room.state.items[c.id]).toBeDefined();
    room.redo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 90 });
  });

  it("folds turning and sizing in one burst, and puts both back", () => {
    const room = client();
    const c = room.addCompass()!;
    room.change({ patch: [{ id: c.id, set: { rotation: 15 } }] }, true, "compass|b1");
    room.change({ patch: [{ id: c.id, set: { size: 2.25 } }] }, true, "compass|b1");
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 0, size: 2 });
  });

  it("keeps one drag of the dial one step, however long it's held still", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const room = client();
    const c = room.addCompass()!;
    room.change({ patch: [{ id: c.id, set: { rotation: 20 } }] }, true, "dial|d1", true);
    vi.setSystemTime(10_000 + 5 * BURST_MS);
    room.change({ patch: [{ id: c.id, set: { rotation: 40 } }] }, true, "dial|d1", true);
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 0 });
    // The next drag is its own step.
    room.redo();
    room.change({ patch: [{ id: c.id, set: { rotation: 90 } }] }, true, "dial|d2", true);
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 40 });
  });

  it("starts a new step for a new burst, or after a pause", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const room = client();
    const c = room.addCompass()!;
    room.change({ patch: [{ id: c.id, set: { rotation: 15 } }] }, true, "compass|b1");
    room.change({ patch: [{ id: c.id, set: { rotation: 30 } }] }, true, "compass|b2");
    vi.setSystemTime(10_000 + BURST_MS + 1);
    room.change({ patch: [{ id: c.id, set: { rotation: 45 } }] }, true, "compass|b2");
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 30 });
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 15 });
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 0 });
  });

  it("doesn't fold after an undo (there's something to redo)", () => {
    const room = client();
    const c = room.addCompass()!;
    room.change({ patch: [{ id: c.id, set: { rotation: 15 } }] }, true, "compass|b1");
    room.undo();
    room.change({ patch: [{ id: c.id, set: { rotation: 60 } }] }, true, "compass|b1");
    room.undo();
    expect(room.state.items[c.id]).toMatchObject({ rotation: 0 });
    expect(room.state.items[c.id]).toBeDefined();
  });

  it("can't be moved or turned by the GM while it's locked, but can be unlocked", () => {
    const room = client();
    const c = room.addCompass()!;
    expect(room.canMoveItem(room.state.items[c.id])).toBe(true);
    room.change({ patch: [{ id: c.id, set: { locked: true } }] });
    expect(room.canMoveItem(room.state.items[c.id])).toBe(false);
    // A locked token that isn't a compass still moves for the GM, as before.
    expect(room.canMoveItem({ ...goblin, locked: true })).toBe(true);
    room.change({ patch: [{ id: c.id, set: { locked: false } }] });
    expect(room.canMoveItem(room.state.items[c.id])).toBe(true);
  });

  it("can't be changed by a player's page", () => {
    const room = client(alicePlayer);
    room.store.set({ items: { [compass.id]: compass } });
    expect(room.canMoveItem(compass)).toBe(false);
  });

  it("undoes to exactly what the compass was, art included", () => {
    const before = { [compass.id]: compass };
    expect(inverseOps(before, { delete: [compass.id] })).toEqual({ upsert: [compass] });
  });
});

describe("duplicating a compass", () => {
  it("keeps its N for the GM", () => {
    const room = client();
    const c = room.addCompass()!;
    duplicateSelection(room);
    const copies = Object.values(room.state.items).filter((i) => i.id !== c.id);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ art: "compass", label: "N", rotation: 0, size: 2 });
  });

  it("does nothing for a player", () => {
    const room = client(alicePlayer);
    room.store.set({ items: { [compass.id]: compass }, selection: [compass.id] });
    duplicateSelection(room);
    expect(Object.keys(room.state.items)).toEqual([compass.id]);
  });

  it("copies only as many compasses as the scene has room for, and says so", () => {
    const room = client();
    const items: Record<string, TokenItem> = { [goblin.id]: { ...goblin, owner: GM_OWNER } };
    for (let i = 0; i < LIMITS.compassesPerScene - 1; i++) items[`full${i}`] = { ...compass, id: `full${i}` };
    room.store.set({ items, selection: ["full0", "full1", goblin.id] });
    duplicateSelection(room);
    const copies = room.state.selection.map((id) => room.state.items[id]);
    // One compass copy fits; the goblin is copied too.
    expect(copies.filter((c) => isCompass(c))).toHaveLength(1);
    expect(copies.filter((c) => !isCompass(c))).toHaveLength(1);
    expect(compassesOn(Object.values(room.state.items), "scene1")).toBe(LIMITS.compassesPerScene);
    expect(room.state.toasts.at(-1)?.kind).toBe("error");
    // At the limit, a compass alone isn't copied at all.
    room.store.set({ selection: ["full0"] });
    const before = Object.keys(room.state.items).length;
    duplicateSelection(room);
    expect(Object.keys(room.state.items)).toHaveLength(before);
  });
});

describe("the compass art", () => {
  /** A canvas context that records what's drawn, and where and how turned each letter is. */
  function recorder() {
    const texts: { text: string; font: string; fill: string; x: number; y: number; deg: number }[] = [];
    const fills: string[] = [];
    let fillStyle = "";
    // The transform, as a b c d e f, and the ones saved.
    let m = [1, 0, 0, 1, 0, 0];
    const saved: number[][] = [];
    const ctx = {
      font: "",
      textAlign: "",
      textBaseline: "",
      lineJoin: "",
      lineWidth: 0,
      strokeStyle: "",
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(v: string) {
        fillStyle = v;
      },
      save() {
        saved.push(m);
      },
      restore() {
        m = saved.pop()!;
      },
      rotate(a: number) {
        const [ma, mb, mc, md, me, mf] = m;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        m = [ma * cos + mc * sin, mb * cos + md * sin, mc * cos - ma * sin, md * cos - mb * sin, me, mf];
      },
      translate(x: number, y: number) {
        const [ma, mb, mc, md, me, mf] = m;
        m = [ma, mb, mc, md, me + ma * x + mc * y, mf + mb * x + md * y];
      },
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      stroke() {},
      fill() {
        fills.push(fillStyle);
      },
      strokeText() {},
      fillText(text: string, x: number, y: number) {
        const [ma, mb, mc, md, me, mf] = m;
        const deg = (((Math.atan2(mb, ma) * 180) / Math.PI) % 360 + 360) % 360;
        texts.push({ text, font: ctx.font, fill: fillStyle, x: ma * x + mc * y + me, y: mb * x + md * y + mf, deg });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, fills };
  }

  it("marks North with a bold N and the needle in the compass's colour, and E, S and W smaller", () => {
    const { ctx, texts, fills } = recorder();
    drawCompass(ctx, 70, 0, "#123456", "sans-serif");
    expect(texts.map((t) => t.text)).toEqual(["N", "E", "S", "W"]);
    const size = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
    const [n, ...others] = texts;
    expect(n.fill).toBe("#123456");
    expect(n.font).toMatch(/^bold /);
    for (const o of others) expect(size(o.font)).toBeLessThan(size(n.font));
    // E, S and W are dark letters in a light halo, so they read on light maps as well as dark.
    for (const o of others) expect(o.fill).toBe("#16191f");
    // The needle: one half in the colour, the other a darker shade of it.
    expect(fills).toContain("#123456");
    expect(fills).toContain("#0c2238");
  });

  it("keeps the letters upright however it's turned, with the N where North points", () => {
    for (const rotation of [0, 37, 90, 180, 270, 315]) {
      const { ctx, texts } = recorder();
      // The board turns the canvas by the compass's rotation, then draws it.
      ctx.rotate((rotation * Math.PI) / 180);
      drawCompass(ctx, 70, rotation, "#123456", "sans-serif");
      for (const t of texts) {
        const off = Math.min(t.deg, 360 - t.deg);
        expect(off, `${t.text} at ${rotation}°`).toBeLessThan(1e-6);
      }
      // N sits out along the needle: `rotation` degrees clockwise from up.
      const n = texts.find((t) => t.text === "N")!;
      const a = (rotation * Math.PI) / 180;
      const d = Math.hypot(n.x, n.y);
      expect(n.x / d).toBeCloseTo(Math.sin(a), 6);
      expect(n.y / d).toBeCloseTo(-Math.cos(a), 6);
    }
  });
});

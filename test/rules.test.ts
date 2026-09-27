import { describe, expect, it } from "vitest";
import { applyOps, inverseOps } from "../src/shared/ops";
import { canCreate, canDelete, canMove, canPatch, canReplace, visibleToPlayer } from "../src/shared/permissions";
import {
  DEFAULT_SETTINGS,
  sanitizeInitiative,
  sanitizeItem,
  sanitizeScene,
  sanitizeSet,
} from "../src/shared/sanitize";
import type { DrawingItem, FogItem, TokenItem } from "../src/shared/types";

const token: TokenItem = {
  id: "tok1",
  sceneId: "scene1",
  kind: "token",
  z: 0,
  owner: "gm-user",
  x: 100,
  y: 100,
  size: 1,
  rotation: 0,
  assetId: null,
  color: "#e4572e",
  label: "Goblin",
  hidden: false,
  locked: false,
  rings: [],
};
const drawing: DrawingItem = {
  id: "draw1",
  sceneId: "scene1",
  kind: "drawing",
  z: 0,
  owner: "alice",
  shape: "pen",
  points: [0, 0, 10, 10],
  color: "#ffffff",
  width: 4,
  fill: false,
};
const fog: FogItem = {
  id: "fog1",
  sceneId: "scene1",
  kind: "fog",
  z: 0,
  owner: "gm-user",
  mode: "reveal",
  shape: "rect",
  points: [0, 0, 100, 100],
};
const gm = { userId: "gm-user", role: "gm" as const };
const alice = { userId: "alice", role: "player" as const };
const bob = { userId: "bob", role: "player" as const };
const settings = DEFAULT_SETTINGS;

describe("sanitizeItem", () => {
  it("accepts a valid token and forces the owner", () => {
    const out = sanitizeItem({ ...token, owner: "someone-else" }, "alice");
    expect(out).toEqual({ ...token, owner: "alice" });
  });
  it("rejects bad ids, kinds and coordinates", () => {
    expect(sanitizeItem({ ...token, id: "bad id!" }, "a")).toBeNull();
    expect(sanitizeItem({ ...token, kind: "wizard" }, "a")).toBeNull();
    expect(sanitizeItem({ ...token, x: "12" }, "a")).toBeNull();
    expect(sanitizeItem({ ...token, x: Number.NaN }, "a")).toBeNull();
    expect(sanitizeItem(null, "a")).toBeNull();
  });
  it("clamps and cleans token fields", () => {
    const out = sanitizeItem({ ...token, size: 999, rotation: -90, label: "  Bob\u0000  ", color: "red" }, "a");
    expect(out).toMatchObject({ size: 30, rotation: 270, label: "Bob", color: "#e4572e" });
  });
  it("checks point counts per shape", () => {
    expect(sanitizeItem({ ...drawing, shape: "rect", points: [0, 0, 1] }, "a")).toBeNull();
    expect(sanitizeItem({ ...drawing, shape: "rect", points: [0, 0, 1, 1] }, "a")).not.toBeNull();
    expect(sanitizeItem({ ...fog, shape: "poly", points: [0, 0, 1, 1] }, "a")).toBeNull();
    expect(sanitizeItem({ ...fog, shape: "poly", points: [0, 0, 1, 1, 2, 0] }, "a")).not.toBeNull();
  });
});

describe("sanitizeSet", () => {
  it("accepts fields of the item's kind", () => {
    expect(sanitizeSet(token, { x: 5, label: "Orc" })).toEqual({ x: 5, label: "Orc" });
  });
  it("rejects fields from another kind, unknown fields, and bad values", () => {
    expect(sanitizeSet(token, { points: [0, 0] })).toBeNull();
    expect(sanitizeSet(token, { owner: "me" })).toBeNull();
    expect(sanitizeSet(token, { hidden: "yes" })).toBeNull();
    expect(sanitizeSet(token, {})).toBeNull();
    expect(sanitizeSet(drawing, { shape: "rect" })).toBeNull();
  });
});

describe("sanitizeScene and initiative", () => {
  it("keeps createdAt from the existing scene and fills grid defaults", () => {
    const base = sanitizeScene({ id: "s1", name: "A", width: 700, height: 700 })!;
    expect(base.grid.size).toBe(70);
    const edited = sanitizeScene({ ...base, name: "B", createdAt: 1 }, base)!;
    expect(edited.name).toBe("B");
    expect(edited.createdAt).toBe(base.createdAt);
    expect(sanitizeScene({ ...base, id: "other" }, base)).toBeNull();
  });
  it("clamps the initiative turn", () => {
    const out = sanitizeInitiative({
      entries: [{ id: "e1", name: "A", value: 12, color: "#ffffff", tokenId: null }],
      turn: 7,
      round: 0,
    });
    expect(out).toMatchObject({ turn: 0, round: 1 });
    expect(sanitizeInitiative({ entries: "nope" })).toBeNull();
  });
});

describe("permissions", () => {
  it("hides hidden tokens and other scenes from players", () => {
    expect(visibleToPlayer(token, "scene1")).toBe(true);
    expect(visibleToPlayer({ ...token, hidden: true }, "scene1")).toBe(false);
    expect(visibleToPlayer(token, "scene2")).toBe(false);
  });
  it("players can't create fog or hidden tokens", () => {
    expect(canCreate(fog, alice, settings)).toBe(false);
    expect(canCreate({ ...token, hidden: true }, alice, settings)).toBe(false);
    expect(canCreate(token, alice, settings)).toBe(true);
    expect(canCreate(token, alice, { ...settings, playersCanAddTokens: false })).toBe(false);
    expect(canCreate(drawing, alice, { ...settings, playersCanDraw: false })).toBe(false);
    expect(canCreate(fog, gm, settings)).toBe(true);
  });
  it("players move unlocked tokens, and only their own when the GM says so", () => {
    expect(canMove(token, alice, settings)).toBe(true);
    expect(canMove({ ...token, locked: true }, alice, settings)).toBe(false);
    expect(canMove(token, alice, { ...settings, playersMoveAll: false })).toBe(false);
    expect(canMove({ ...token, owner: "alice" }, alice, { ...settings, playersMoveAll: false })).toBe(true);
  });
  it("players can't hide, lock, or edit others' drawings", () => {
    expect(canPatch(token, { hidden: true }, alice, settings)).toBe(false);
    expect(canPatch(token, { locked: false }, alice, settings)).toBe(false);
    expect(canPatch(token, { x: 1 }, alice, settings)).toBe(true);
    expect(canPatch(drawing, { color: "#000000" }, bob, settings)).toBe(false);
    expect(canPatch(drawing, { color: "#000000" }, alice, settings)).toBe(true);
    expect(canReplace(token, { ...token, hidden: true }, alice, settings)).toBe(false);
  });
  it("players delete only their own things", () => {
    expect(canDelete(token, alice)).toBe(false);
    expect(canDelete({ ...token, owner: "alice" }, alice)).toBe(true);
    expect(canDelete({ ...token, owner: "alice", locked: true }, alice)).toBe(false);
    expect(canDelete(drawing, bob)).toBe(false);
    expect(canDelete(fog, alice)).toBe(false);
    expect(canDelete(fog, gm)).toBe(true);
  });
});

describe("undo", () => {
  it("inverts upsert, patch and delete", () => {
    const before = { [token.id]: token, [drawing.id]: drawing };
    const newFog = fog;
    const ops = {
      upsert: [newFog],
      patch: [{ id: token.id, set: { x: 500, label: "Moved" } }],
      delete: [drawing.id],
    };
    const after = applyOps(before, ops);
    expect(after[token.id]).toMatchObject({ x: 500, label: "Moved" });
    expect(after[drawing.id]).toBeUndefined();
    expect(after[fog.id]).toEqual(fog);
    const restored = applyOps(after, inverseOps(before, ops));
    expect(restored).toEqual(before);
  });
});

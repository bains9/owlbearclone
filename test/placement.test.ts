import { describe, expect, it, vi } from "vitest";
import { GUIDE } from "../src/client/guide";
import { RoomClient } from "../src/client/room/client";
import { DEFAULT_GRID, DEFAULT_SETTINGS, GM_OWNER, sanitizeSettings } from "../src/shared/sanitize";
import { sceneSnaps } from "../src/shared/types";
import type { RoomSettings, Scene } from "../src/shared/types";

function client(settings: RoomSettings = { ...DEFAULT_SETTINGS }) {
  const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
  const scene: Scene = {
    id: "scene1",
    name: "Forest",
    order: 0,
    mapAssetId: null,
    width: 1400,
    height: 1000,
    background: "#000000",
    grid: { ...DEFAULT_GRID, size: 70, offsetX: 0, offsetY: 0, snap: true },
    fogCover: false,
    createdAt: 0,
  };
  room.store.set({
    me: { connId: "c1", userId: GM_OWNER, name: "GM", color: "#ff0000", role: "gm" },
    room: { id: "AbCdEf123456", name: "Room", createdAt: 0, settings },
    scenes: { scene1: scene },
    viewSceneId: "scene1",
    activeSceneId: "scene1",
    items: {},
  });
  return room;
}

describe("never snap to the grid (Room settings)", () => {
  it("is kept by the room, and a page that leaves it out changes nothing", () => {
    expect(sanitizeSettings({ freePlacement: true }, DEFAULT_SETTINGS).freePlacement).toBe(true);
    const on = { ...DEFAULT_SETTINGS, freePlacement: true };
    expect(sanitizeSettings({ playersCanDraw: false }, on).freePlacement).toBe(true);
    expect(sanitizeSettings({ freePlacement: false }, on).freePlacement).toBe(false);
    expect(sanitizeSettings({ freePlacement: "yes" }, on).freePlacement).toBe(true);
    // Rooms that never had it don't get it, and they snap as before.
    expect("freePlacement" in sanitizeSettings({}, DEFAULT_SETTINGS)).toBe(false);
  });

  it("stops every scene snapping, whatever its own box says", () => {
    const snapping = { grid: { ...DEFAULT_GRID, snap: true } };
    expect(sceneSnaps(snapping, DEFAULT_SETTINGS)).toBe(true);
    expect(sceneSnaps(snapping, { freePlacement: true })).toBe(false);
    expect(sceneSnaps({ grid: { ...DEFAULT_GRID, snap: false } }, DEFAULT_SETTINGS)).toBe(false);
    expect(sceneSnaps(snapping, null)).toBe(true);
  });

  it("puts tokens exactly where they're dropped, and the Build tool's objects anywhere", () => {
    const snapped = client().addToken({ label: "Goblin" }, { x: 100, y: 100 })!;
    expect([snapped.x, snapped.y]).toEqual([105, 105]);
    const room = client({ ...DEFAULT_SETTINGS, freePlacement: true });
    const free = room.addToken({ label: "Goblin" }, { x: 100, y: 100 })!;
    expect([free.x, free.y]).toEqual([100, 100]);
    expect(room.snaps(room.viewScene!)).toBe(false);
    // This browser's Snap to squares stays as it was, for when the room snaps again.
    expect(room.state.objectSnap).toBe(true);
    expect(room.objectSnaps()).toBe(false);
    expect(client().objectSnaps()).toBe(true);
  });
});

describe("picture files dropped on the map", () => {
  it("snap where the scene snaps, and go exactly where they land with Alt held", async () => {
    const room = client();
    vi.spyOn(room, "upload").mockResolvedValue([{ id: "a1" }, { id: "a2" }] as Awaited<ReturnType<RoomClient["upload"]>>);
    const placed = () =>
      Object.values(room.state.items)
        .filter((i) => i.kind === "token")
        .map((t) => [t.x, t.y]);
    await room.uploadTokens([], { x: 100, y: 100 }, true);
    // In a row, a square apart, exactly where they were dropped.
    expect(placed()).toEqual([
      [100, 100],
      [170, 100],
    ]);
    room.store.set({ items: {} });
    await room.uploadTokens([], { x: 100, y: 100 });
    expect(placed()).toEqual([
      [105, 105],
      [175, 105],
    ]);
  });
});

describe("the magnet: snapping on this device", () => {
  it("lets a device put tokens exactly where they're let go, without Alt", () => {
    const room = client();
    room.setTokenSnap(false);
    expect(room.state.tokenSnap).toBe(false);
    const t = room.addToken({ label: "Wolf" }, { x: 100, y: 100 })!;
    expect([t.x, t.y]).toEqual([100, 100]);
    expect(room.tokenSnaps(room.viewScene!)).toBe(false);
    // Rulers and spell areas still go by the scene: everyone sees the same.
    expect(room.snaps(room.viewScene!)).toBe(true);
    room.setTokenSnap(true);
    const u = room.addToken({ label: "Wolf" }, { x: 100, y: 100 })!;
    expect([u.x, u.y]).toEqual([105, 105]);
  });

  it("doesn't change a table display", () => {
    const display = new RoomClient("AbCdEf123456", { uid: "d", name: "D", color: "#ff0000" }, "key");
    display.setTokenSnap(false);
    expect(display.state.tokenSnap).toBe(true);
  });
});

describe("in the guide", () => {
  const section = (id: string) => GUIDE.find((s) => s.id === id)!;
  const all = (id: string) => JSON.stringify(section(id));

  it("is in What's new under scattering, naming the setting and the magnet", () => {
    const entry = section("whats-new").parts[2];
    expect(entry.title).toBe("Place tokens and objects anywhere (31 October 2026)");
    expect(JSON.stringify(entry)).toContain("**Never snap to the grid**");
    expect(JSON.stringify(entry)).toContain("tap the magnet");
  });

  it("explains it in Room settings, and where tokens are moved", () => {
    expect(section("room-settings").parts.map((p) => p.title)).toContain("Never snap to the grid");
    expect(all("tokens")).toContain("the magnet in its bar");
  });

  it("names the controls as the pages show them", async () => {
    const fs = (await import(/* @vite-ignore */ "node:" + "fs")) as { readFileSync(path: URL, encoding: "utf8"): string };
    const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("../src/client/ui/SettingsPanel.tsx")).toContain("Never snap to the grid");
    expect(read("../src/client/ui/SettingsPanel.tsx")).toContain("<h3>Placing things</h3>");
    expect(read("../src/client/ui/SelectionBar.tsx")).toContain('aria-label="Snap to the grid"');
  });
});

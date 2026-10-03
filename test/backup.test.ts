import { afterEach, describe, expect, it, vi } from "vitest";
import { importBackup, makeZip, readZip, remapMapData } from "../src/client/backup";
import { RoomClient } from "../src/client/room/client";
import { DEFAULT_GRID } from "../src/shared/sanitize";
import type { Asset, Scene, SceneMapData } from "../src/shared/types";

describe("backup zip", () => {
  it("round-trips files byte for byte", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
    const json = new TextEncoder().encode(JSON.stringify({ hello: "wörld" }));
    const zip = makeZip([
      { name: "room.json", data: json },
      { name: "files/abc123", data: png },
    ]);
    const files = readZip(await zip.arrayBuffer());
    expect([...files.keys()]).toEqual(["room.json", "files/abc123"]);
    expect(new TextDecoder().decode(files.get("room.json"))).toBe('{"hello":"wörld"}');
    expect([...files.get("files/abc123")!]).toEqual([...png]);
  });
  it("rejects things that aren't zips", () => {
    expect(() => readZip(new TextEncoder().encode("not a zip at all, just text").buffer as ArrayBuffer)).toThrow();
  });
});

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

describe("backups with Dungeondraft data", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remapMapData moves both ids, and drops the data when either is missing", () => {
    const ids = new Map([
      ["side1", "SIDE"],
      ["map1", "MAP"],
    ]);
    const md: SceneMapData = { ...MD, bare: "leaf", hold: true, packs: "guess" };
    expect(remapMapData(md, ids)).toEqual({ ...md, assetId: "SIDE", forAssetId: "MAP" });
    expect(remapMapData(md, new Map([["map1", "MAP"]]))).toBeUndefined();
    expect(remapMapData(md, new Map([["side1", "SIDE"]]))).toBeUndefined();
    expect(remapMapData(undefined, ids)).toBeUndefined();
  });

  function asset(id: string, kind: Asset["kind"]): Asset {
    return { id, name: id, kind, width: 512, height: 4, mime: "image/png", bytes: 9, owner: "@gm", createdAt: 1 };
  }

  async function restore(files: string[]) {
    const scenes = [
      scene({ id: "a", mapData: MD, mapRect: [0, 0, 50, 35] }),
      scene({ id: "b", order: 1, mapAssetId: "map2", mapData: { ...MD, forAssetId: "map1" } }),
    ];
    const assets = [asset("map1", "map"), asset("map2", "map"), asset("side1", "mapdata")];
    const backup = { format: "tabletop-backup", version: 1, exportedAt: 1, room: { name: "R", settings: {} }, scenes, items: [], assets };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    const zip = makeZip([
      { name: "room.json", data: new TextEncoder().encode(JSON.stringify(backup)) },
      ...files.map((f) => ({ name: `files/${f}`, data: png })),
    ]);
    const kinds: string[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const q = new URL(url, "http://x").searchParams;
      kinds.push(q.get("kind")!);
      const a = { ...asset(`new${++n}`, q.get("kind") as Asset["kind"]), name: q.get("name")! };
      return new Response(JSON.stringify(a), { status: 201 });
    });
    const room = new RoomClient("AbCdEf123456", { uid: "gmuid", name: "GM", color: "#ff0000" });
    room.store.set({ me: { connId: "c1", userId: "@gm", name: "GM", color: "#ff0000", role: "gm" } });
    await importBackup(room, new File([await zip.arrayBuffer()], "r.tabletop.zip"), () => undefined);
    const byName = (name: string) => Object.values(room.state.assets).find((a) => a.name === name)?.id;
    const out = Object.values(room.state.scenes).sort((x, y) => x.order - y.order);
    return { out, kinds, byName };
  }

  it("restores the sidecar as Dungeondraft data under new ids, with the rectangle as it was", async () => {
    const { out, kinds, byName } = await restore(["map1", "map2", "side1"]);
    expect(kinds).toEqual(["map", "map", "mapdata"]);
    expect(out[0].mapData).toEqual({ assetId: byName("side1"), forAssetId: byName("map1") });
    expect(out[0].mapRect).toEqual([0, 0, 50, 35]);
    // Paused on another picture: still remapped, and still paused.
    expect(out[1]).toMatchObject({ mapAssetId: byName("map2"), mapData: { assetId: byName("side1"), forAssetId: byName("map1") } });
  });

  it("drops the data when the backup is missing the sidecar or the picture", async () => {
    const noSidecar = await restore(["map1", "map2"]);
    expect(noSidecar.out.map((s) => "mapData" in s)).toEqual([false, false]);
    expect(noSidecar.out[0].mapRect).toEqual([0, 0, 50, 35]);
    const noPicture = await restore(["map2", "side1"]);
    expect(noPicture.out.map((s) => "mapData" in s)).toEqual([false, false]);
  });
});

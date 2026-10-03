import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { packPng } from "../src/client/dd/pngBox";
import { NO_NAME, REACH_N, SIDECAR_HEADER_BYTES, encodeSidecar, type SeasonSidecar } from "../src/client/dd/sidecar";
import { SIDECAR_CACHE_SIZE, SidecarCache, sceneDataState, seasonData, usesData, type DataState } from "../src/client/room/mapData";
import { EXACT_VERSION } from "../src/client/room/seasonExact";
import { analyse, bake } from "../src/client/room/seasonPixels";
import type { BakeOptions } from "../src/client/room/seasonPixels";
import { ddKey, outdoorKey } from "../src/client/room/seasons";
import type { SceneMapData } from "../src/shared/types";
import { snowyMap } from "./fixtures/ddSynthetic";
import { fakeExport } from "./fixtures/fakeExport";

// Loading sidecars (design 5.2), a scene's data state (5.1), and the season worker's dispatch with
// its fallback to the pixel path (never the plain map, and never a guess kept under the data's key).

/** A small sidecar: one square of nothing, snowy unless said otherwise. */
function sidecar(snowShare = 1): SeasonSidecar {
  return {
    meta: { rect: [0, 0, 256, 256], squares: [1, 1], extractor: 1, snowShare, packShare: 0, packItems: 0, dropped: 0, names: [] },
    terrain: null,
    bitmaps: [],
    shapes: [],
    objects: {
      n: 0, role: new Uint8Array(0), layer: new Int16Array(0), x: new Int32Array(0), y: new Int32Array(0), rot: new Uint8Array(0),
      flags: new Uint8Array(0), name: new Uint16Array(0).fill(NO_NAME), reach: new Uint16Array(0 * REACH_N),
    },
  };
}

async function boxed(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await (await packPng(bytes)).blob.arrayBuffer());
}

/** What the fake server does for each fetch of an asset, in turn (the last one repeats). */
type Reply = "net" | number | Uint8Array;
let server: Map<string, Reply[]>;
let fetched: string[];

function serve(assetId: string, ...replies: Reply[]): void {
  server.set(assetId, replies);
}

beforeEach(() => {
  server = new Map();
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url);
      const id = url.split("/").pop()!;
      const list = server.get(id) ?? [404];
      const r = list.length > 1 ? list.shift()! : list[0];
      if (r === "net") throw new TypeError("Failed to fetch");
      if (typeof r === "number") return new Response(null, { status: r });
      return new Response(r.slice(), { status: 200, headers: { "Content-Type": "image/png" } });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lets fetches, unpacking and the promise chains after them finish. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => (globalThis as unknown as { setImmediate(f: () => void): void }).setImmediate(r));
};

describe("SidecarCache", () => {
  let good: Uint8Array;
  let png: Uint8Array;
  beforeAll(async () => {
    good = encodeSidecar(sidecar());
    png = await boxed(good);
  });

  it("fetches, unpacks and checks a sidecar once, and keeps it without the PNG's padding", async () => {
    serve("s1", png);
    const changed: string[] = [];
    const cache = new SidecarCache((id) => changed.push(id));
    expect(cache.state("s1")).toBeUndefined();
    const [a, b] = await Promise.all([cache.get("room1", "s1"), cache.get("room1", "s1")]);
    expect(fetched).toEqual(["/api/files/room1/s1"]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok) return;
    expect(a.bytes).toEqual(good);
    expect(a.meta.snowShare).toBe(1);
    expect(cache.state("s1")).toBe("ok");
    expect(cache.meta("s1")?.rect).toEqual([0, 0, 256, 256]);
    expect(changed).toEqual(["s1"]);
    // Asked again: from memory, the same bytes.
    const c = await cache.get("room1", "s1");
    expect(c.ok && c.bytes).toBe(a.bytes);
    expect(fetched.length).toBe(1);
  });

  it("calls a 404 missing, tries again only on wake()", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serve("s1", 404, png);
    const changed: string[] = [];
    const cache = new SidecarCache((id) => changed.push(id));
    expect(await cache.get("room1", "s1")).toEqual({ ok: false, state: "missing" });
    expect(changed).toEqual(["s1"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await cache.get("room1", "s1")).toEqual({ ok: false, state: "missing" });
    expect(fetched.length).toBe(1);
    cache.wake();
    expect(changed).toEqual(["s1", "s1"]);
    expect(cache.state("s1")).toBeUndefined();
    expect((await cache.get("room1", "s1")).ok).toBe(true);
    expect(fetched.length).toBe(2);
  });

  it("tries again after 5 s and 30 s on network errors and 5xx, then calls it missing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serve("s1", "net", 503, "net", png);
    const states: Array<DataState | undefined> = [];
    const cache = new SidecarCache(() => states.push(cache.state("s1")));
    expect(await cache.get("room1", "s1")).toEqual({ ok: false, state: "retrying" });
    // Asked while retrying: no extra fetch.
    expect(await cache.get("room1", "s1")).toEqual({ ok: false, state: "retrying" });
    expect(fetched.length).toBe(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetched.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fetched.length).toBe(2);
    expect(cache.state("s1")).toBe("retrying");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetched.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fetched.length).toBe(3);
    expect(cache.state("s1")).toBe("missing");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetched.length).toBe(3);
    expect(states).toEqual(["retrying", "missing"]);
    // Back in view: tried again, and this time it comes.
    cache.wake();
    expect((await cache.get("room1", "s1")).ok).toBe(true);
    expect(states).toEqual(["retrying", "missing", undefined, "ok"]);
  });

  it("recovers on a retry, and says so", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serve("s1", 500, png);
    const changed: Array<DataState | undefined> = [];
    const cache = new SidecarCache(() => changed.push(cache.state("s1")));
    expect((await cache.get("room1", "s1")).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(changed).toEqual(["retrying", "ok"]);
    expect((await cache.get("room1", "s1")).ok).toBe(true);
  });

  it("calls a damaged sidecar, or not a PNG box, unreadable, and never fetches it again this visit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bad = good.slice();
    bad[SIDECAR_HEADER_BYTES + 3] ^= 1;
    serve("crc", await boxed(bad));
    serve("jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    serve("empty", new Uint8Array(0));
    const cache = new SidecarCache(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const id of ["crc", "jpeg", "empty"]) {
      expect(await cache.get("room1", id)).toEqual({ ok: false, state: "unreadable" });
    }
    await vi.advanceTimersByTimeAsync(60_000);
    cache.wake();
    for (const id of ["crc", "jpeg", "empty"]) expect(await cache.get("room1", id)).toEqual({ ok: false, state: "unreadable" });
    expect(fetched.length).toBe(3);
  });

  it("calls a newer format newer (Update Tabletop), not damaged", async () => {
    const newer = good.slice();
    newer[4] = 2;
    serve("s2", await boxed(newer));
    const cache = new SidecarCache(() => {});
    expect(await cache.get("room1", "s2")).toEqual({ ok: false, state: "newer" });
  });

  it("says noDecompress without fetching on a browser with no DecompressionStream", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    serve("s1", png);
    const cache = new SidecarCache(() => {});
    expect(await cache.get("room1", "s1")).toEqual({ ok: false, state: "noDecompress" });
    expect(fetched).toEqual([]);
  });

  it(`keeps the ${SIDECAR_CACHE_SIZE} most recently used sidecars`, async () => {
    const ids = ["a", "b", "c", "d", "e"];
    for (const id of ids) serve(id, png);
    const cache = new SidecarCache(() => {});
    for (const id of ids.slice(0, 4)) await cache.get("room1", id);
    // "a" used again, so "b" is the oldest when "e" comes.
    await cache.get("room1", "a");
    await cache.get("room1", "e");
    expect(ids.map((id) => cache.state(id))).toEqual(["ok", undefined, "ok", "ok", "ok"]);
    // Let go means loaded again when asked (from the HTTP cache, in a browser).
    expect((await cache.get("room1", "b")).ok).toBe(true);
    expect(fetched.length).toBe(6);
  });

  it("stops its retries when disposed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    serve("s1", "net");
    const changed: string[] = [];
    const cache = new SidecarCache((id) => changed.push(id));
    await cache.get("room1", "s1");
    cache.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetched.length).toBe(1);
    expect(changed.length).toBe(1);
  });
});

describe("a scene's data state", () => {
  const md: SceneMapData = { assetId: "side1", forAssetId: "map1" };
  const cache = (state?: DataState, snowShare = 1) => ({
    state: () => state,
    meta: () => (state === "ok" ? sidecar(snowShare).meta : undefined),
  });
  const none = new Set<string>();

  it("follows the scene, then the sidecar", () => {
    expect(sceneDataState({ mapAssetId: "map1" }, cache("ok"), none)).toBe("none");
    expect(sceneDataState({ mapAssetId: "map2", mapData: md }, cache("ok"), none)).toBe("paused");
    expect(sceneDataState({ mapAssetId: "map1", mapData: { ...md, hold: true } }, cache("ok"), none)).toBe("hold");
    expect(sceneDataState({ mapAssetId: "map1", mapData: md }, cache(), none)).toBe("loading");
    expect(sceneDataState({ mapAssetId: "map1", mapData: md }, cache("ok"), none)).toBe("ok");
    for (const st of ["retrying", "missing", "unreadable", "newer", "noDecompress"] as const) {
      expect(sceneDataState({ mapAssetId: "map1", mapData: md }, cache(st), none)).toBe(st);
    }
  });

  it("calls a green map green in v1, unless the GM says it's drawn in winter", () => {
    expect(sceneDataState({ mapAssetId: "map1", mapData: md }, cache("ok", 0.2), none)).toBe("green");
    expect(sceneDataState({ mapAssetId: "map1", mapData: { ...md, drawn: "winter" } }, cache("ok", 0.2), none)).toBe("ok");
    expect(sceneDataState({ mapAssetId: "map1", mapData: { ...md, drawn: "green" } }, cache("ok", 1), none)).toBe("green");
  });

  it("calls data the analysis refused unreadable, for those options only", () => {
    const refused = new Set([ddKey(seasonData(md))]);
    expect(sceneDataState({ mapAssetId: "map1", mapData: md }, cache("ok"), refused)).toBe("unreadable");
    expect(sceneDataState({ mapAssetId: "map1", mapData: { ...md, bare: "dead" } }, cache("ok"), refused)).toBe("ok");
  });

  it("uses the data only when it's loaded or on its way", () => {
    const used = (["none", "paused", "hold", "green", "ok", "loading", "retrying", "missing", "unreadable", "newer", "noDecompress"] as const).filter(usesData);
    expect(used).toEqual(["ok", "loading"]);
  });

  it("keys a bake by every option it depends on, and only those", () => {
    const d = seasonData({ ...md, hold: undefined });
    expect(d).toEqual({ assetId: "side1" });
    expect(ddKey(d)).toBe(`|dd:side1:auto:auto:drawn:${EXACT_VERSION}`);
    const keys = new Set(
      [md, { ...md, bare: "leaf" }, { ...md, bare: "dead" }, { ...md, drawn: "winter" }, { ...md, packs: "guess" }, { ...md, assetId: "side2" }].map(
        (m) => ddKey(seasonData(m as SceneMapData)),
      ),
    );
    expect(keys.size).toBe(6);
    // The picture's id isn't part of it: "Use it with this picture" bakes the same.
    expect(ddKey(seasonData({ ...md, forAssetId: "map9" }))).toBe(ddKey(seasonData(md)));
    expect(outdoorKey("map1")).toBe("map1");
    expect(outdoorKey("map1", d)).toBe("map1|dd:side1");
  });
});

describe("the season worker", () => {
  type Reply = { t: string; id: number; frac?: number; exact?: boolean; reason?: string; rgba?: Uint8ClampedArray; message?: string };
  let replies: Reply[];
  let onmessage: (e: { data: unknown }) => void;
  const send = (m: Record<string, unknown>): Reply => {
    onmessage({ data: m });
    return replies[replies.length - 1];
  };

  beforeAll(async () => {
    replies = [];
    const scope = { postMessage: (m: Reply) => replies.push(m), onmessage: null as unknown as typeof onmessage };
    vi.stubGlobal("self", scope);
    await import("../src/client/room/seasonWorker");
    vi.unstubAllGlobals();
    onmessage = scope.onmessage;
    expect(replies[0].t).toBe("ready");
  });

  const sm = snowyMap();
  const pic = fakeExport(sm.sidecar, 16);
  const opts: Omit<BakeOptions, "a"> = { x0: 0, y0: 0, scale: 1, cell: 16, seed: 7, look: "summer", level: 2, sceneW: pic.w, sceneH: pic.h };
  let id = 1;
  const analyseMsg = (key: string, sidecarBytes: Uint8Array | null) => ({
    t: "analyse", id: id++, key, rgba: pic.rgba.slice(), aw: pic.w, ah: pic.h, cellA: 16,
    ...(sidecarBytes ? { dd: { sidecar: sidecarBytes }, fallbackKey: key.split("|dd:")[0] } : {}),
  });
  const bakeMsg = (key: string) => send({ t: "bake", id: id++, key, rgba: pic.rgba.slice(), width: pic.w, rows: pic.h, opts });
  /** The pixel path's bytes for the picture. */
  const pixelBytes = () => {
    const a = analyse(pic.rgba.slice(), pic.w, pic.h, 16);
    const out = pic.rgba.slice();
    bake(out, pic.w, pic.h, { ...opts, a });
    return out;
  };

  it("analyses from the data, without touching the picture it was sent", () => {
    const m = analyseMsg("A|dd:s", encodeSidecar(sm.sidecar));
    const before = m.rgba.slice();
    const r = send(m);
    expect(r).toMatchObject({ t: "analysed", exact: true });
    expect(r.reason).toBeUndefined();
    expect(m.rgba).toEqual(before);
    const baked = bakeMsg("A|dd:s");
    expect(baked.t).toBe("baked");
    // Exact: not the pixel path's bytes.
    expect(baked.rgba).not.toEqual(pixelBytes());
  });

  const refusals: Array<[string, () => Uint8Array]> = [
    ["a sidecar that fails the CRC", () => {
      const b = encodeSidecar(sm.sidecar);
      b[SIDECAR_HEADER_BYTES + 9] ^= 0x40;
      return b;
    }],
    ["a newer format", () => {
      const b = encodeSidecar(sm.sidecar);
      b[4] = 2;
      return b;
    }],
    ["an analysis that throws (a green map)", () => encodeSidecar(snowyMap({ green: true }).sidecar)],
  ];
  for (const [what, bytes] of refusals) {
    it(`guesses from the picture for ${what}: exactly the pixel path's bytes, never under the data's key`, () => {
      const r = send(analyseMsg("B|dd:s", bytes()));
      expect(r).toMatchObject({ t: "analysed", exact: false });
      expect(r.reason).toMatch(/\S/);
      expect(bakeMsg("B|dd:s")).toMatchObject({ t: "error", message: "no analysis" });
      const baked = bakeMsg("B");
      expect(baked.t).toBe("baked");
      expect(baked.rgba).toEqual(pixelBytes());
    });
  }

  it("analyses without data as before", () => {
    const r = send(analyseMsg("C", null));
    expect(r).toMatchObject({ t: "analysed", exact: false });
    expect(bakeMsg("C").rgba).toEqual(pixelBytes());
  });
});

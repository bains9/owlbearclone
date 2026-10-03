// Loading scenes' Dungeondraft sidecars for seasons (design 5.2): fetched once, unpacked and fully
// validated on the main thread, kept for the scenes in play. Failures never throw; they become a
// state the Season notes can explain, and the scene's seasons guess from the picture meanwhile.
// Also the board's planning of a scene's seasonal bake from its data state (SeasonPlanner).

import type { Scene, SceneMapData } from "../../shared/types";
import { fileUrl } from "../api";
import { canUnpack, unpackPng } from "../dd/pngBox";
import { SIDECAR_FORMAT, SIDECAR_HEADER_BYTES, SidecarError, decodeSidecar, readFormat } from "../dd/sidecar";
import type { SidecarMeta } from "../dd/sidecar";
import { isSnowy } from "./seasonExact";
import { ALGO_VERSION, seedFrom } from "./seasonPixels";
import { ddKey, seasonSquare } from "./seasons";
import type { SeasonDataSource, SeasonJob, SeasonJobData } from "./seasons";

/**
 * A sidecar's load state. retrying: a network error or 5xx, tried again after 5 s and 30 s;
 * missing: a 404, or the retries failed (tried again on wake()); unreadable: bad magic, CRC or
 * section (not retried this visit); newer: a format this build doesn't know ("Update Tabletop");
 * noDecompress: no DecompressionStream on this device.
 */
export type DataState = "ok" | "loading" | "retrying" | "missing" | "unreadable" | "newer" | "noDecompress";

/**
 * A scene's data state as the board plans it (5.1): none attached, paused (attached to another
 * picture), on hold, a green map (v1), or its sidecar's load state.
 */
export type SceneDataState = "none" | "paused" | "hold" | "green" | DataState;

/** Validated sidecars kept. */
export const SIDECAR_CACHE_SIZE = 4;
/** Waits before each retry after a network error or 5xx, in ms. */
export const SIDECAR_RETRY_MS: readonly number[] = [5000, 30_000];

export type SidecarResult = { ok: true; bytes: Uint8Array; meta: SidecarMeta } | { ok: false; state: DataState };

interface Entry {
  state: DataState;
  roomId: string;
  /** The sidecar itself (header and payload, no padding), once validated. */
  bytes?: Uint8Array;
  meta?: SidecarMeta;
  /** The first try, while it runs (later tries run on their own timers). */
  pending?: Promise<SidecarResult>;
  /** Network errors and 5xx so far. */
  failures: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** A load's outcome: a sidecar, a state, or a network failure (worth trying again). */
type Outcome = SidecarResult | { ok: false; state: "network" };

export class SidecarCache {
  private readonly onChange: (assetId: string) => void;
  /** By asset id; the validated ones in least recently used order. */
  private entries = new Map<string, Entry>();
  private disposed = false;

  /** onChange: a sidecar's state changed (the board re-plans the scene's job). */
  constructor(onChange: (assetId: string) => void) {
    this.onChange = onChange;
  }

  /** Fetches, unpacks and fully validates (decodeSidecar) on the main thread. Never throws. */
  get(roomId: string, assetId: string): Promise<SidecarResult> {
    const e = this.entries.get(assetId);
    if (e?.state === "ok") {
      // The most recently used goes last.
      this.entries.delete(assetId);
      this.entries.set(assetId, e);
      return Promise.resolve({ ok: true, bytes: e.bytes!, meta: e.meta! });
    }
    if (e?.pending) return e.pending;
    if (e || this.disposed) return Promise.resolve({ ok: false, state: e?.state ?? "missing" });
    const entry: Entry = { state: "loading", roomId, failures: 0 };
    this.entries.set(assetId, entry);
    entry.pending = this.attempt(assetId, entry).finally(() => {
      entry.pending = undefined;
    });
    return entry.pending;
  }

  /** The sidecar's state, or undefined when it hasn't been asked for (or was let go to make room). */
  state(assetId: string): DataState | undefined {
    return this.entries.get(assetId)?.state;
  }

  /** A validated sidecar's META (whether the map is snowy), while it's held. */
  meta(assetId: string): SidecarMeta | undefined {
    return this.entries.get(assetId)?.meta;
  }

  /** A scene change or the page becoming visible again: "missing" entries may be tried again. */
  wake(): void {
    for (const [id, e] of [...this.entries]) {
      if (e.state !== "missing") continue;
      this.entries.delete(id);
      this.onChange(id);
    }
  }

  /** Stops the retries (the board is going). */
  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) clearTimeout(e.timer);
    this.entries.clear();
  }

  /** One try at loading. The entry's state follows the outcome, and a later try is set up when worth it. */
  private async attempt(assetId: string, entry: Entry): Promise<SidecarResult> {
    const out = await load(entry.roomId, assetId);
    if (this.entries.get(assetId) !== entry) {
      // Disposed meanwhile: nothing is kept.
      return out.ok ? out : { ok: false, state: out.state === "network" ? "missing" : out.state };
    }
    const before = entry.state;
    if (out.ok) {
      entry.state = "ok";
      entry.bytes = out.bytes;
      entry.meta = out.meta;
      this.entries.delete(assetId);
      this.entries.set(assetId, entry);
      this.trim();
    } else if (out.state === "network") {
      const wait = SIDECAR_RETRY_MS[entry.failures++];
      if (wait === undefined) {
        entry.state = "missing";
      } else {
        entry.state = "retrying";
        entry.timer = setTimeout(() => {
          entry.timer = undefined;
          if (this.entries.get(assetId) === entry) void this.attempt(assetId, entry);
        }, wait);
      }
    } else {
      entry.state = out.state;
    }
    if (entry.state !== before) this.onChange(assetId);
    return entry.state === "ok" ? { ok: true, bytes: entry.bytes!, meta: entry.meta! } : { ok: false, state: entry.state };
  }

  /** Keeps the newest few validated sidecars (the rest load again, from the HTTP cache, when needed). */
  private trim(): void {
    let held = 0;
    for (const e of this.entries.values()) if (e.state === "ok") held++;
    for (const [id, e] of [...this.entries]) {
      if (held <= SIDECAR_CACHE_SIZE) break;
      if (e.state !== "ok") continue;
      this.entries.delete(id);
      held--;
    }
  }
}

/** Fetches a sidecar's PNG box and checks everything in it. */
async function load(roomId: string, assetId: string): Promise<Outcome> {
  if (!canUnpack()) return { ok: false, state: "noDecompress" };
  let png: Uint8Array;
  try {
    const res = await fetch(fileUrl(roomId, assetId), { credentials: "same-origin" });
    // Gone, or never there: not worth asking again until something changes (wake).
    if (res.status >= 400 && res.status < 500) return { ok: false, state: "missing" };
    if (!res.ok) return { ok: false, state: "network" };
    png = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { ok: false, state: "network" };
  }
  try {
    const raw = await unpackPng(png);
    const format = readFormat(raw);
    if (format !== null && format > SIDECAR_FORMAT) return { ok: false, state: "newer" };
    const meta = decodeSidecar(raw).meta;
    // The header and payload only: the rows' zero padding is neither kept nor sent to the worker.
    const len = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(8, true);
    return { ok: true, bytes: raw.slice(0, SIDECAR_HEADER_BYTES + len), meta };
  } catch (err) {
    if (!(err instanceof SidecarError)) console.warn("sidecar check failed", err);
    return { ok: false, state: "unreadable" };
  }
}

/**
 * A scene's data state (5.1). refused: data the season worker couldn't use (by ddKey), which stays
 * "unreadable" for the visit. A sidecar not asked for yet is "loading": the bake asks for it (and
 * the GM's device at once: SeasonPlanner.state).
 */
export function sceneDataState(
  scene: Pick<Scene, "mapAssetId" | "mapData">,
  cache: Pick<SidecarCache, "state" | "meta">,
  refused: ReadonlySet<string>,
): SceneDataState {
  const md = scene.mapData;
  if (!md) return "none";
  if (md.forAssetId !== scene.mapAssetId) return "paused";
  if (md.hold) return "hold";
  if (refused.has(ddKey(seasonData(md)))) return "unreadable";
  const st = cache.state(md.assetId);
  if (st === undefined) return "loading";
  if (st !== "ok") return st;
  // v1: exact seasons for snowy maps only. Decided from META on the main thread, so every device agrees.
  const meta = cache.meta(md.assetId);
  return meta && !isSnowy(meta, md.drawn) ? "green" : "ok";
}

/** Whether a scene's bake uses its data: loaded, or on its way (a failure re-plans without it). */
export function usesData(st: SceneDataState): boolean {
  return st === "ok" || st === "loading";
}

/** What a season bake needs from a scene's data (the options the bake depends on, and nothing else). */
export function seasonData(md: SceneMapData): SeasonJobData {
  const d: SeasonJobData = { assetId: md.assetId };
  if (md.bare) d.bare = md.bare;
  if (md.drawn) d.drawn = md.drawn;
  if (md.packs) d.packs = md.packs;
  return d;
}

/** What planning a scene's seasonal bake reads from the scene. */
export type PlannedScene = Pick<Scene, "id" | "season" | "mapAssetId" | "mapData" | "width" | "height" | "grid">;

/**
 * The board's planning of a scene's seasonal bake (5.1), kept here so it's tested as the board runs
 * it: the scene's data state on this device, the job (using the data while it's usable, its key then
 * ending in ddKey, so nothing guessed from the picture ever shares a key with a bake from the data),
 * and what the season baker says about data it couldn't use.
 */
export class SeasonPlanner {
  /** Data the season analysis or bake refused (by ddKey): guessed from the picture for the rest of the visit. */
  private readonly refused = new Set<string>();
  /** For SeasonBaker: where it gets the data, and whom it tells when the data can't be used. */
  readonly source: SeasonDataSource;

  /** replan: plan the shown scene's bake again (put off by the caller, as it's called from inside a bake). */
  constructor(
    private readonly sidecars: Pick<SidecarCache, "get" | "state" | "meta">,
    private readonly roomId: string,
    replan: () => void,
  ) {
    this.source = {
      sidecars,
      roomId,
      onDataState: (data, state) => {
        // The sidecar's own load state is in the cache; a refusal is remembered here.
        if (state === "unreadable") this.refused.add(ddKey(data));
        replan();
      },
    };
  }

  /**
   * A scene's data state on this device. load: fetch its sidecar now if nothing has (the GM's device,
   * so the Season notes can say whether it's usable before a season is picked). Otherwise only a
   * seasonal bake fetches it, so players load a sidecar only while the scene has a season (3.5), and
   * "loading" may stay until then.
   */
  state(scene: Pick<Scene, "mapAssetId" | "mapData">, load = false): SceneDataState {
    const st = sceneDataState(scene, this.sidecars, this.refused);
    const md = scene.mapData;
    if (load && st === "loading" && md && this.sidecars.state(md.assetId) === undefined) void this.sidecars.get(this.roomId, md.assetId);
    return st;
  }

  /**
   * The seasonal bake for a scene's map, or null when it has no season (or this device has seasons
   * off). With usable data (loaded, or on its way) the bake uses it; otherwise it's guessed from the
   * picture under the plain key.
   */
  job(scene: PlannedScene, img: HTMLImageElement, state: SceneDataState, seasonsOff: boolean): SeasonJob | null {
    const season = scene.season;
    if (!season || !scene.mapAssetId || seasonsOff) return null;
    const seed = season.seed ?? (seedFrom(scene.id) & 0xffff);
    // Everything (snow drifts, what counts as outdoors) is sized by the grid: kept sane when it's badly off.
    const square = seasonSquare(scene.width, scene.height, scene.grid.size);
    const data = scene.mapData && usesData(state) ? seasonData(scene.mapData) : undefined;
    const key = [scene.mapAssetId, season.look, season.level, seed, square, scene.width, scene.height, ALGO_VERSION].join("|") + (data ? ddKey(data) : "");
    const job: SeasonJob = { key, assetId: scene.mapAssetId, img, sceneW: scene.width, sceneH: scene.height, square, look: season.look, level: season.level, seed };
    if (data) job.data = data;
    return job;
  }
}
